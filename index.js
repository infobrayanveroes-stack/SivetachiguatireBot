const express = require('express');
const axios = require('axios');
const OpenAI = require('openai');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());

const REQUIRED_ENV = [
  'WA_TOKEN',
  'VERIFY_TOKEN',
  'PHONE_NUMBER_ID'
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.warn(`Missing env var: ${key}`);
  }
}

const WA_TOKEN = process.env.WA_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const AI_ENABLED = String(process.env.AI_ENABLED || '').toLowerCase() === 'true';
const AI_PROVIDER = (process.env.AI_PROVIDER || 'openai').toLowerCase();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

const chatHistory = [];
let isBotEnabled = true;
const userStates = new Map();

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token === process.env.VERIFY_TOKEN) {
    res.status(200).send(challenge);
    return;
  }

  res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
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
        res.sendStatus(200);
        return;
      }

      const state = getUserState(customerPhone);
      let input = interactiveId || inboundText;
      let didSendMenu = false;

      if (!state.greeted) {
        state.greeted = true;
        await sendWhatsApp(customerPhone, pickRandomAvoidRepeat(state, GREETING_REPLIES, 'greeting'));
        await sendMenuWithFallback(customerPhone);
        res.sendStatus(200);
        return;
      }

      if (!input) {
        res.sendStatus(200);
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

    res.sendStatus(200);
  } catch (error) {
    console.error('Error en webhook:', error);
    res.sendStatus(500);
  }
});

app.get('/', (req, res) => {
  res.redirect('/dashboard');
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard', 'index.html'));
});

app.use('/public', express.static(path.join(__dirname, 'public')));

app.get('/api/history', (req, res) => {
  res.json({ history: chatHistory, isBotEnabled });
});

app.get('/api/status', (req, res) => {
  res.json({ isBotEnabled });
});

app.post('/api/panic', (req, res) => {
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ ok: false, error: 'enabled must be boolean' });
    return;
  }

  isBotEnabled = enabled;
  res.json({ ok: true, isBotEnabled });
});

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
  'Menu rapido (responde con el numero):',
  '1) Menu del dia',
  '2) Sushi',
  '3) Hamburguesas',
  '4) Perros calientes',
  '5) Pepitos',
  '6) Delivery',
  '7) Reservas',
  '8) Promos',
  '9) Horarios',
  '10) Ubicacion',
  '0) Volver a menu'
].join('\n');
const GREETING_REPLIES = [
  'Hola, Soy el bot de sivetachi Restaurante. En que te puedo ayudar?'
];
const DEFAULT_REPLIES = [
  'Gracias por escribir. Escribe "menu" para ver opciones rapidas.',
  'Estoy aqui para ayudarte. Escribe "menu" y te muestro opciones.',
  'Quieres ver el menu? Escribe "menu" y te muestro opciones.'
];

const MENU_DIA_TEXT = [
  'Menu del dia (ejemplo):',
  '- Pollo a la plancha + ensalada: Bs. 6',
  '- Pasta bolognesa: Bs. 7',
  '- Arroz mixto: Bs. 6',
  '- Pabellon: Bs. 8',
  '- Ensalada cesar: Bs. 6'
].join('\n');

const SUSHI_TEXT = [
  'Sushi (ejemplo):',
  '- California roll (8): Bs. 8',
  '- Tempura roll (8): Bs. 9',
  '- Salmon roll (8): Bs. 10',
  '- Tropical roll (8): Bs. 10',
  '- Crispy roll (8): Bs. 11'
].join('\n');

const BURGER_TEXT = [
  'Hamburguesas (ejemplo):',
  '- Clasica: Bs. 6',
  '- Doble queso: Bs. 8',
  '- Pollo crispy: Bs. 7',
  '- BBQ: Bs. 9',
  '- Especial de la casa: Bs. 10'
].join('\n');

const HOTDOG_TEXT = [
  'Perros calientes (ejemplo):',
  '- Sencillo: Bs. 4',
  '- Especial: Bs. 6',
  '- Full toppings: Bs. 7',
  '- Super perro: Bs. 8',
  '- Perro mixto: Bs. 9'
].join('\n');

const PEPITO_TEXT = [
  'Pepitos (ejemplo):',
  '- Pollo: Bs. 7',
  '- Carne: Bs. 8',
  '- Mixto: Bs. 9',
  '- Pepito especial: Bs. 11',
  '- Pepito full queso: Bs. 12'
].join('\n');

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
    keywords: ['menu del dia', 'menu dia', 'almuerzo', 'almorzar'],
    replies: [MENU_DIA_TEXT]
  },
  {
    keywords: ['sushi', 'maki', 'makis', 'roll', 'rolls', 'salmon', 'tempura'],
    replies: [SUSHI_TEXT]
  },
  {
    keywords: ['hamburguesa', 'hamburguesas', 'burger', 'burgers', 'hamb'],
    replies: [BURGER_TEXT]
  },
  {
    keywords: ['perro', 'perros', 'perro caliente', 'perros calientes', 'hot dog', 'hotdog'],
    replies: [HOTDOG_TEXT]
  },
  {
    keywords: ['pepito', 'pepitos'],
    replies: [PEPITO_TEXT]
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
    replies: ['Tenemos promos activas. Dime si prefieres combos, bebidas o postres.']
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
      lastReplies: {}
    });
  }
  return userStates.get(phone);
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

  if (['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].includes(text)) {
    if (text === '1') {
      return withMenuFooter(MENU_DIA_TEXT);
    }
    if (text === '2') {
      return withMenuFooter(SUSHI_TEXT);
    }
    if (text === '3') {
      return withMenuFooter(BURGER_TEXT);
    }
    if (text === '4') {
      return withMenuFooter(HOTDOG_TEXT);
    }
    if (text === '5') {
      return withMenuFooter(PEPITO_TEXT);
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
      return withDialogEnd('Tenemos promos activas. Dime si prefieres combos, bebidas o postres.');
    }
    if (text === '9') {
      return withDialogEnd('Horario: lunes a jueves 12:00 a 22:00. Viernes y sabado 12:00 a 23:00. Domingo 12:00 a 20:00.');
    }
    return withDialogEnd('Estamos en Guatire. Si quieres, te envio la ubicacion exacta.');
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

  if (state.handoff) {
    return 'Un asesor te atendera en breve. Si quieres agregar algo, escribelo aqui.';
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
      return `${outOfHoursNote ? `${outOfHoursNote}\n` : ''}Listo. Confirmo delivery a esa zona y te aviso el tiempo.`;
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
              { id: '1', title: 'Menu del dia' },
              { id: '2', title: 'Sushi' },
              { id: '3', title: 'Hamburguesas' },
              { id: '4', title: 'Perros calientes' },
              { id: '5', title: 'Pepitos' },
              { id: '6', title: 'Delivery' },
              { id: '7', title: 'Reservas' },
              { id: '8', title: 'Promos' },
              { id: '9', title: 'Horarios' },
              { id: '10', title: 'Ubicacion' },
              { id: '0', title: 'Volver a menu' }
            ]
          }
        ]
      }
    }
  }, {
    headers: { Authorization: `Bearer ${WA_TOKEN}` }
  });
}

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor activo en puerto ${PORT}`);
});
