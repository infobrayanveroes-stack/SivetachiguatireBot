const axios = require('axios');
const OpenAI = require('openai');

const REQUIRED_ENV = [
  'WA_TOKEN',
  'VERIFY_TOKEN',
  'PHONE_NUMBER_ID'
];

const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
  console.warn(`Missing env vars: ${missingEnv.join(', ')}`);
}

const WA_TOKEN = process.env.WA_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const AI_ENABLED = String(process.env.AI_ENABLED || '').toLowerCase() === 'true';
const AI_PROVIDER = (process.env.AI_PROVIDER || 'openai').toLowerCase();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
const PAYMENT_MOBILE_TEXT = process.env.PAYMENT_MOBILE_TEXT || 'Pago movil: Banco ___, Cedula ___, Telefono ___.';

const SERVICE_PROMPT = 'Es delivery, para comer en tienda o para llevar? Escribe: delivery, tienda o para llevar.';
const ADDRESS_PROMPT = 'Indica tu zona, direccion y referencia.';
const TIME_PROMPT = 'Para comer en tienda o retirar, dime la hora aproximada.';
const PAYMENT_PROMPT = 'Quieres pagar ahora por pago movil? Responde si o no.';

const chatHistory = [];
let isBotEnabled = true;
const userStates = new Map();

function addChatEvent({ direction, phone, text }) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    direction,
    phone,
    text,
    timestamp: new Date().toISOString()
  };

  chatHistory.push(entry);
  if (chatHistory.length > 200) {
    chatHistory.shift();
  }
}

function normalizeText(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isMenuTrigger(text) {
  const normalized = normalizeText(text);
  return normalized === 'menu' || normalized === 'menu rapido' || normalized === 'opciones';
}

const MENU_TEXT = [
  'Menu (responde con el numero o selecciona haciendo click):',
  '1) Promociones',
  '2) Recomendaciones',
  '3) Love sushi',
  '4) Hamburguesas',
  '5) Perros y pepitos',
  '6) Sucursales',
  '7) Reservas',
  '8) Promos XXXL',
  '9) Horarios'
].join('\n');
const GREETING_REPLIES = [
  'Hola, Soy el bot de sivetachi Restaurante. En que te puedo ayudar?'
];
const DEFAULT_REPLIES = [
  'Gracias por escribir. Escribe "menu" para ver opciones rapidas.',
  'Estoy aqui para ayudarte. Escribe "menu" y te muestro opciones.',
  'Quieres ver el menu? Escribe "menu" y te muestro opciones.'
];

const MENU_CATEGORY_TITLES = {
  '1': 'Promociones',
  '2': 'Recomendaciones',
  '3': 'Love sushi',
  '4': 'Hamburguesas',
  '5': 'Perros y pepitos'
};

const MENU_CATEGORY_ITEMS = {
  '1': [
    { id: 'p1', title: 'Promo 2x1 burger', price: 'Bs. 12', description: '2 clasicas + papas' },
    { id: 'p2', title: 'Combo sushi 24', price: 'Bs. 20', description: '3 rolls surtidos' },
    { id: 'p3', title: 'Promo hotdog', price: 'Bs. 9', description: '2 perros + bebida' },
    { id: 'p4', title: 'Parrilla pareja', price: 'Bs. 18', description: 'carne + pollo' },
    { id: 'p5', title: 'Promo pepito', price: 'Bs. 10', description: 'pepito mixto' }
  ],
  '2': [
    { id: 'c1', title: 'Pollo al limon', price: 'Bs. 9', description: 'arroz y ensalada' },
    { id: 'c2', title: 'Lomo a la plancha', price: 'Bs. 12', description: 'papas rusticas' },
    { id: 'c3', title: 'Pasta cremosa', price: 'Bs. 8', description: 'pollo y queso' },
    { id: 'c4', title: 'Bowl oriental', price: 'Bs. 9', description: 'carne + vegetales' },
    { id: 'c5', title: 'Wrap especial', price: 'Bs. 7', description: 'pollo crispy' }
  ],
  '3': [
    { id: 's1', title: 'California roll', price: 'Bs. 8', description: '8 piezas' },
    { id: 's2', title: 'Tempura roll', price: 'Bs. 9', description: '8 piezas' },
    { id: 's3', title: 'Salmon roll', price: 'Bs. 10', description: '8 piezas' },
    { id: 's4', title: 'Tropical roll', price: 'Bs. 10', description: '8 piezas' },
    { id: 's5', title: 'Crispy roll', price: 'Bs. 11', description: '8 piezas' }
  ],
  '4': [
    { id: 'h1', title: 'Hamburguesa clasica', price: 'Bs. 6', description: 'carne y queso' },
    { id: 'h2', title: 'Doble queso', price: 'Bs. 8', description: 'doble carne' },
    { id: 'h3', title: 'Pollo crispy', price: 'Bs. 7', description: 'salsa especial' },
    { id: 'h4', title: 'BBQ burger', price: 'Bs. 9', description: 'tocineta' },
    { id: 'h5', title: 'Parrilla mixta', price: 'Bs. 14', description: 'carne + pollo' }
  ],
  '5': [
    { id: 'k1', title: 'Perro sencillo', price: 'Bs. 4', description: 'salsas clasicas' },
    { id: 'k2', title: 'Perro especial', price: 'Bs. 6', description: 'queso y tocineta' },
    { id: 'k3', title: 'Pepito de pollo', price: 'Bs. 7', description: 'papas y queso' },
    { id: 'k4', title: 'Pepito de carne', price: 'Bs. 8', description: 'papas y queso' },
    { id: 'k5', title: 'Pepito mixto', price: 'Bs. 9', description: 'carne y pollo' }
  ]
};

function buildCategoryText(categoryId) {
  const title = MENU_CATEGORY_TITLES[categoryId] || 'Menu';
  const items = MENU_CATEGORY_ITEMS[categoryId] || [];
  const lines = items.map((item) => `- ${item.title}: ${item.price}`);
  return `${title}:\n${lines.join('\n')}`;
}

const CATEGORY_TEXT = {
  '1': buildCategoryText('1'),
  '2': buildCategoryText('2'),
  '3': buildCategoryText('3'),
  '4': buildCategoryText('4'),
  '5': buildCategoryText('5')
};

const KEYWORD_RULES = [
  {
    keywords: [
      'hola', 'holi', 'hey', 'epa', 'epale', 'buenas', 'buen dia', 'buenos dias',
      'buenas tardes', 'buenas noches', 'que tal', 'q tal', 'que hubo', 'qlq',
      'qloq', 'que lo que', 'como estas'
    ],
    replies: GREETING_REPLIES
  },
  {
    keywords: ['menu', 'opciones', 'ayuda', 'info', 'informacion'],
    replies: [MENU_TEXT]
  },
  {
    keywords: ['promocion', 'promociones', 'promo', 'menu del dia', 'menu dia'],
    replies: [CATEGORY_TEXT['1']]
  },
  {
    keywords: ['chef', 'recomendacion', 'recomendaciones'],
    replies: [CATEGORY_TEXT['2']]
  },
  {
    keywords: ['sushi', 'maki', 'makis', 'roll', 'rolls', 'salmon', 'tempura'],
    replies: [CATEGORY_TEXT['3']]
  },
  {
    keywords: ['hamburguesa', 'hamburguesas', 'burger', 'burgers', 'hamb'],
    replies: [CATEGORY_TEXT['4']]
  },
  {
    keywords: ['perro', 'perros', 'perro caliente', 'perros calientes', 'hot dog', 'hotdog'],
    replies: [CATEGORY_TEXT['5']]
  },
  {
    keywords: ['pepito', 'pepitos'],
    replies: [CATEGORY_TEXT['5']]
  },
  {
    keywords: ['carta', 'platos', 'comida', 'parrilla', 'pasta', 'pizza', 'postre'],
    replies: [
      'Te paso nuestro menu. Dime si buscas entradas, principales o postres.',
      'Tenemos entradas, principales y postres. Que te provoca hoy?'
    ]
  },
  {
    keywords: ['precio', 'precios', 'costo', 'costos', 'valor', 'tarifa'],
    replies: [
      'Claro. Dime el plato o combo y te paso el precio.',
      'Con gusto. Que plato o combo quieres cotizar?'
    ]
  },
  {
    keywords: ['cotizacion', 'cotizar', 'presupuesto'],
    replies: ['Dime que platos o combos necesitas y te preparo la cotizacion.']
  },
  {
    keywords: ['horario', 'horarios', 'abren', 'abierto', 'cierran', 'cerrado'],
    replies: ['Horario: lunes a jueves 12:00 a 22:00. Viernes y sabado 12:00 a 23:00. Domingo 12:00 a 20:00.']
  },
  {
    keywords: ['ubicacion', 'direccion', 'donde estan', 'donde quedan', 'mapa'],
    replies: ['Estamos en Guatire. Si quieres, te envio la ubicacion exacta y como llegar.']
  },
  {
    keywords: ['reservar', 'reserva', 'reservas', 'mesa', 'agendar'],
    replies: ['Claro. Para reservar dime fecha, hora y cantidad de personas.'],
    action: 'reserve'
  },
  {
    keywords: ['delivery', 'envio', 'entrega', 'domicilio'],
    replies: ['Si tenemos delivery. Indica tu zona y te confirmo disponibilidad y tiempo.'],
    action: 'delivery'
  },
  {
    keywords: ['pago', 'pagos', 'transferencia', 'zelle', 'efectivo', 'pago movil'],
    replies: ['Aceptamos pago movil, transferencia, Zelle y efectivo. Que metodo prefieres?']
  },
  {
    keywords: ['promo', 'promos', 'promocion', 'promociones', 'oferta', 'ofertas'],
    replies: [CATEGORY_TEXT['1']]
  },
  {
    keywords: ['cumple', 'cumpleanos', 'evento', 'eventos', 'grupo'],
    replies: ['Atendemos eventos. Dime fecha, cantidad de personas y tipo de evento.']
  },
  {
    keywords: ['alergia', 'alergias', 'sin gluten', 'vegetariano', 'vegano'],
    replies: ['Tenemos opciones especiales. Dime tu restriccion y te recomiendo platos.']
  },
  {
    keywords: ['reclamo', 'queja', 'problema', 'soporte'],
    replies: ['Lamento el inconveniente. Cuentame que paso y te ayudamos de inmediato.'],
    action: 'handoff'
  },
  {
    keywords: ['asesor', 'humano', 'operador', 'atencion'],
    replies: ['Te paso con un asesor. Deja tu nombre y un resumen de lo que necesitas.'],
    action: 'handoff'
  },
  {
    keywords: ['gracias', 'ok', 'perfecto', 'listo'],
    replies: ['Con gusto. Si necesitas algo mas, avisame.']
  }
];

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function pickRandomAvoidRepeat(state, items, key) {
  if (items.length === 1) {
    return items[0];
  }
  const last = state.lastReplies?.[key];
  let next = pickRandom(items);
  if (last && next === last) {
    const alternatives = items.filter((item) => item !== last);
    next = alternatives.length > 0 ? pickRandom(alternatives) : next;
  }
  state.lastReplies = state.lastReplies || {};
  state.lastReplies[key] = next;
  return next;
}

function getUserState(phone) {
  if (!userStates.has(phone)) {
    userStates.set(phone, {
      greeted: false,
      handoff: false,
      awaitingReservation: false,
      awaitingDelivery: false,
      awaitingOrder: false,
      awaitingService: false,
      awaitingAddress: false,
      awaitingPaymentConfirm: false,
      awaitingItemQuantity: false,
      awaitingItemExtras: false,
      selectedItem: null,
      selectedItemQty: 0,
      orderText: '',
      serviceType: '',
      lastReplies: {}
    });
  }
  return userStates.get(phone);
}

function resetOrderFlow(state) {
  state.awaitingOrder = false;
  state.awaitingService = false;
  state.awaitingAddress = false;
  state.awaitingPaymentConfirm = false;
  state.awaitingItemQuantity = false;
  state.awaitingItemExtras = false;
  state.selectedItem = null;
  state.selectedItemQty = 0;
  state.orderText = '';
  state.serviceType = '';
}

function isCategoryId(value) {
  return ['1', '2', '3', '4', '5'].includes(value);
}

function isActiveFlow(state) {
  return state.awaitingOrder
    || state.awaitingService
    || state.awaitingAddress
    || state.awaitingPaymentConfirm
    || state.awaitingReservation
    || state.awaitingDelivery
    || state.awaitingItemQuantity
    || state.awaitingItemExtras;
}

function getItemFromInteractiveId(interactiveId) {
  if (!interactiveId || !interactiveId.startsWith('item-')) {
    return null;
  }
  const parts = interactiveId.split('-');
  if (parts.length < 3) {
    return null;
  }
  const categoryId = parts[1];
  const itemId = parts.slice(2).join('-');
  const items = MENU_CATEGORY_ITEMS[categoryId] || [];
  return items.find((item) => item.id === itemId) || null;
}

function isYes(text) {
  const normalized = normalizeText(text);
  return ['si', 'sí', 'ok', 'dale', 'pagar', 'pago', 'pagar ahora'].includes(normalized);
}

function isNo(text) {
  const normalized = normalizeText(text);
  return ['no', 'luego', 'despues', 'más tarde', 'mas tarde'].includes(normalized);
}

function getLocalTimeParts() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('es-VE', {
    timeZone: 'America/Caracas',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short'
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  return {
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: parts.weekday
  };
}

function isOpenNow() {
  const { hour, weekday } = getLocalTimeParts();
  const day = weekday.toLowerCase();

  if (['lun', 'mar', 'mie', 'jue'].includes(day)) {
    return hour >= 12 && hour < 22;
  }
  if (['vie', 'sab'].includes(day)) {
    return hour >= 12 && hour < 23;
  }
  return hour >= 12 && hour < 20;
}

function getOutOfHoursNote() {
  if (isOpenNow()) {
    return '';
  }
  return 'Nota: Estamos fuera de horario, pero tomamos tu solicitud y te respondemos apenas abramos.';
}

function withMenuFooter(text) {
  return `${text}\n\nEscribe 0 para volver al menu principal.`;
}

function withDialogEnd(text) {
  return `${text}\n\nDeseas otra cosa? Escribe "menu".`;
}

function getKeywordReply(userInput, state) {
  const text = normalizeText(userInput);

  if (text === '0' || text === 'menu') {
    return MENU_TEXT;
  }

  if (['1', '2', '3', '4', '5'].includes(text)) {
    state.awaitingOrder = true;
    return withMenuFooter(`${CATEGORY_TEXT[text]}\n\nQue deseas pedir? Indica platos y cantidades.`);
  }
  if (text === '6') {
    state.awaitingDelivery = true;
    return withDialogEnd('Para delivery dime tu zona y direccion aproximada.');
  }
  if (text === '7') {
    state.awaitingReservation = true;
    return withDialogEnd('Perfecto. Para reservar dime fecha, hora y cantidad de personas.');
  }
  if (text === '8') {
    return withDialogEnd('Tenemos promos XXXL. Dime cuantas personas son.');
  }
  if (text === '9') {
    return withDialogEnd('Horario: lunes a jueves 12:00 a 22:00. Viernes y sabado 12:00 a 23:00. Domingo 12:00 a 20:00.');
  }

  for (let index = 0; index < KEYWORD_RULES.length; index += 1) {
    const rule = KEYWORD_RULES[index];
    if (rule.keywords.some((keyword) => text.includes(keyword))) {
      if (rule.action === 'handoff') {
        state.handoff = true;
      }
      if (rule.action === 'reserve') {
        state.awaitingReservation = true;
      }
      if (rule.action === 'delivery') {
        state.awaitingDelivery = true;
      }
      const reply = pickRandomAvoidRepeat(state, rule.replies, `rule-${index}`);
      return withDialogEnd(reply);
    }
  }

  return pickRandomAvoidRepeat(state, DEFAULT_REPLIES, 'default');
}

async function getBotReply(phone, userInput) {
  const state = getUserState(phone);
  const normalizedInput = normalizeText(userInput);

  if (state.handoff) {
    return 'Un asesor te atendera en breve. Si quieres agregar algo, escribelo aqui.';
  }

  if (normalizedInput === 'menu' || normalizedInput === '0') {
    resetOrderFlow(state);
    return MENU_TEXT;
  }

  const selectedItem = getItemFromInteractiveId(userInput);
  if (selectedItem) {
    state.selectedItem = selectedItem;
    state.awaitingItemQuantity = true;
    return `Cuantas unidades de ${selectedItem.title}?`;
  }

  if (state.awaitingItemQuantity) {
    const qty = Number.parseInt(normalizedInput, 10);
    if (!Number.isFinite(qty) || qty < 1 || qty > 20) {
      return 'Indica una cantidad valida (1-20).';
    }
    state.selectedItemQty = qty;
    state.awaitingItemQuantity = false;
    state.awaitingItemExtras = true;
    return 'Quieres extras o notas? Responde no si no.';
  }

  if (state.awaitingItemExtras) {
    const item = state.selectedItem;
    const qty = state.selectedItemQty || 1;
    const extras = isNo(userInput) ? '' : userInput.trim();
    const extrasText = extras ? ` Extras: ${extras}.` : '';
    if (item) {
      state.orderText = `${qty}x ${item.title} - ${item.price}.${extrasText}`;
    }
    state.awaitingItemExtras = false;
    state.awaitingService = true;
    return `Perfecto. Anoto tu pedido: ${state.orderText || 'Pedido recibido'}.\n\n${SERVICE_PROMPT}`;
  }

  if (state.awaitingOrder) {
    state.orderText = userInput.trim();
    state.awaitingOrder = false;
    state.awaitingService = true;
    return `Perfecto. Anoto tu pedido: ${state.orderText}.\n\n${SERVICE_PROMPT}`;
  }

  if (state.awaitingService) {
    if (normalizedInput.includes('delivery')) {
      state.serviceType = 'delivery';
      state.awaitingService = false;
      state.awaitingAddress = true;
      return `Perfecto. ${ADDRESS_PROMPT}`;
    }
    if (normalizedInput.includes('tienda') || normalizedInput.includes('comer') || normalizedInput.includes('para llevar') || normalizedInput.includes('llevar') || normalizedInput.includes('retirar')) {
      state.serviceType = 'tienda';
      state.awaitingService = false;
      state.awaitingPaymentConfirm = true;
      return `${TIME_PROMPT}\n\n${PAYMENT_PROMPT}`;
    }
    return SERVICE_PROMPT;
  }

  if (state.awaitingAddress) {
    state.awaitingAddress = false;
    state.awaitingPaymentConfirm = true;
    return `Direccion recibida.\n\n${PAYMENT_PROMPT}`;
  }

  if (state.awaitingPaymentConfirm) {
    if (isYes(userInput)) {
      resetOrderFlow(state);
      return `${PAYMENT_MOBILE_TEXT}\n\nCuando realices el pago, enviame el comprobante.`;
    }
    if (isNo(userInput)) {
      resetOrderFlow(state);
      return 'Ok, puedes pagar al recibir o retirar. Si necesitas algo mas, avisa.';
    }
    return PAYMENT_PROMPT;
  }

  const outOfHoursNote = getOutOfHoursNote();

  if (state.awaitingReservation) {
    if (userInput.trim().length >= 4) {
      state.awaitingReservation = false;
      return `${outOfHoursNote ? `${outOfHoursNote}\n` : ''}Reserva recibida. En breve confirmamos disponibilidad.`;
    }
    return 'Para reservar necesito fecha, hora y cantidad de personas.';
  }

  if (state.awaitingDelivery) {
    if (userInput.trim().length >= 4) {
      state.awaitingDelivery = false;
      state.awaitingPaymentConfirm = true;
      return `${outOfHoursNote ? `${outOfHoursNote}\n` : ''}Direccion recibida.\n\n${PAYMENT_PROMPT}`;
    }
    return 'Para delivery dime tu zona y una direccion aproximada.';
  }

  if (!AI_ENABLED) {
    const reply = getKeywordReply(userInput, state);
    return outOfHoursNote ? `${outOfHoursNote}\n${reply}` : reply;
  }

  if (AI_PROVIDER !== 'openai' || !openai) {
    const reply = getKeywordReply(userInput, state);
    return outOfHoursNote ? `${outOfHoursNote}\n${reply}` : reply;
  }

  try {
    const response = await openai.responses.create({
      model: 'gpt-4.1-mini',
      input: [
        { role: 'system', content: 'Eres un asistente de restaurante. Responde breve y amable. Si no sabes, ofrece el menu o un asesor.' },
        { role: 'user', content: userInput }
      ]
    });

    const aiReply = response.output_text || getKeywordReply(userInput, state);
    return outOfHoursNote ? `${outOfHoursNote}\n${aiReply}` : aiReply;
  } catch (error) {
    console.error('Error AI:', error);
    const reply = getKeywordReply(userInput, state);
    return outOfHoursNote ? `${outOfHoursNote}\n${reply}` : reply;
  }
}

async function sendWhatsApp(to, text) {
  await axios.post(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
    messaging_product: 'whatsapp',
    to,
    text: { body: text }
  }, {
    headers: { Authorization: `Bearer ${WA_TOKEN}` }
  });

  addChatEvent({ direction: 'out', phone: to, text });
}

async function sendMenuWithFallback(to) {
  try {
    await sendInteractiveMenu(to);
  } catch (error) {
    console.error('Error sending interactive menu, falling back to text:', error);
    await sendWhatsApp(to, MENU_TEXT);
  }
}

async function sendCategoryMenu(to, categoryId) {
  const title = MENU_CATEGORY_TITLES[categoryId];
  const items = MENU_CATEGORY_ITEMS[categoryId] || [];
  if (!title || items.length === 0) {
    await sendWhatsApp(to, 'No tengo platos en esa categoria.');
    return;
  }

  await axios.post(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: title },
      body: { text: 'Elige un plato:' },
      footer: { text: 'Sivetachi Restaurante' },
      action: {
        button: 'Ver platos',
        sections: [
          {
            title: title,
            rows: items.map((item) => ({
              id: `item-${categoryId}-${item.id}`,
              title: item.title,
              description: `${item.price} - ${item.description}`
            }))
          },
          {
            title: 'Otros',
            rows: [
              { id: 'menu', title: 'Volver al menu' }
            ]
          }
        ]
      }
    }
  }, {
    headers: { Authorization: `Bearer ${WA_TOKEN}` }
  });
}

async function sendInteractiveMenu(to) {
  await axios.post(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: 'Menu rapido' },
      body: { text: 'Elige una opcion:' },
      footer: { text: 'Sivetachi Restaurante' },
      action: {
        button: 'Ver opciones',
        sections: [
          {
            title: 'Categorias',
            rows: [
              { id: '1', title: 'Promociones' },
              { id: '2', title: 'Recomendaciones' },
              { id: '3', title: 'Love sushi' },
              { id: '4', title: 'Hamburguesas' },
              { id: '5', title: 'Perros y pepitos' },
              { id: '6', title: 'Sucursales' },
              { id: '7', title: 'Reservas' },
              { id: '8', title: 'Promos XXXL' },
              { id: '9', title: 'Horarios' }
            ]
          },
          {
            title: 'Otros',
            rows: [
              { id: 'menu', title: 'Volver al menu' }
            ]
          }
        ]
      }
    }
  }, {
    headers: { Authorization: `Bearer ${WA_TOKEN}` }
  });
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname.replace(/^\/api/, '');

  if (path === '/webhook' && req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (mode && token === process.env.VERIFY_TOKEN) {
      res.statusCode = 200;
      res.end(challenge || '');
      return;
    }

    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  if (path === '/webhook' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      const entry = payload.entry?.[0];
      const changes = entry?.changes?.[0];
      const message = changes?.value?.messages?.[0];

      if (message && (message.type === 'text' || message.type === 'interactive')) {
        const customerPhone = message.from;
        const customerMsg = message.type === 'text' ? message.text.body : '';
        const interactiveId = message.type === 'interactive'
          ? message.interactive?.list_reply?.id || ''
          : '';
        const interactiveTitle = message.type === 'interactive'
          ? message.interactive?.list_reply?.title || ''
          : '';
        const inboundText = interactiveTitle || customerMsg || '';

        addChatEvent({ direction: 'in', phone: customerPhone, text: inboundText });

        if (!isBotEnabled) {
          res.statusCode = 200;
          res.end('OK');
          return;
        }

        const state = getUserState(customerPhone);
        let input = interactiveId || inboundText;
        let didSendMenu = false;

        if (!state.greeted) {
          state.greeted = true;
          await sendWhatsApp(customerPhone, pickRandomAvoidRepeat(state, GREETING_REPLIES, 'greeting'));
          await sendMenuWithFallback(customerPhone);
          res.statusCode = 200;
          res.end('OK');
          return;
        }

        if (!input) {
          res.statusCode = 200;
          res.end('OK');
          return;
        }

        if (!isActiveFlow(state) && interactiveId && isCategoryId(interactiveId)) {
          await sendCategoryMenu(customerPhone, interactiveId);
          res.statusCode = 200;
          res.end('OK');
          return;
        }

        if (!isActiveFlow(state) && !interactiveId && isCategoryId(input)) {
          await sendCategoryMenu(customerPhone, input);
          res.statusCode = 200;
          res.end('OK');
          return;
        }

        if (interactiveId === '0') {
          await sendMenuWithFallback(customerPhone);
        } else if (interactiveId) {
          const response = await getBotReply(customerPhone, interactiveId);
          await sendWhatsApp(customerPhone, response);
        } else if (isMenuTrigger(input) || input === '0') {
          if (!didSendMenu) {
            await sendMenuWithFallback(customerPhone);
          }
        } else {
          const response = await getBotReply(customerPhone, input);
          await sendWhatsApp(customerPhone, response);
        }
      }

      res.statusCode = 200;
      res.end('OK');
    } catch (error) {
      console.error('Error en webhook:', error);
      res.statusCode = 500;
      res.end('Error');
    }
    return;
  }

  if (path === '/history' && req.method === 'GET') {
    sendJson(res, 200, { history: chatHistory, isBotEnabled });
    return;
  }

  if (path === '/status' && req.method === 'GET') {
    sendJson(res, 200, { isBotEnabled });
    return;
  }

  if (path === '/panic' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      const { enabled } = payload || {};

      if (typeof enabled !== 'boolean') {
        sendJson(res, 400, { ok: false, error: 'enabled must be boolean' });
        return;
      }

      isBotEnabled = enabled;
      sendJson(res, 200, { ok: true, isBotEnabled });
    } catch (error) {
      console.error('Error en panic:', error);
      sendJson(res, 500, { ok: false });
    }
    return;
  }

  res.statusCode = 404;
  res.end('Not Found');
};
