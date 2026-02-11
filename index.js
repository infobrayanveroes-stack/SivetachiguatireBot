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

    if (message && message.type === 'text') {
      const customerPhone = message.from;
      const customerMsg = message.text.body;
      addChatEvent({ direction: 'in', phone: customerPhone, text: customerMsg });

      if (!isBotEnabled) {
        res.sendStatus(200);
        return;
      }

      const response = await getBotReply(customerPhone, customerMsg);
      await sendWhatsApp(customerPhone, response);
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

const MENU_TEXT = 'Menu rapido: 1) Menu del dia 2) Reservas 3) Horarios 4) Ubicacion 5) Delivery 6) Promos.';
const GREETING_REPLIES = [
  'Hola. Soy el bot de Sivetachi Restaurante. En que te puedo ayudar?',
  'Hola! Bienvenido a Sivetachi Restaurante. Como te ayudo hoy?',
  'Hola, gracias por escribir. Soy el bot de Sivetachi Restaurante.'
];
const DEFAULT_REPLIES = [
  'Gracias por escribir. Escribe "menu" para ver opciones rapidas.',
  'Estoy aqui para ayudarte. Escribe "menu" y te muestro opciones.',
  'Quieres ver el menu? Escribe "menu" y te muestro opciones.'
];

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
    keywords: ['menu', 'carta', 'platos', 'comida', 'sushi', 'parrilla', 'pasta', 'pizza', 'postre'],
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

function getUserState(phone) {
  if (!userStates.has(phone)) {
    userStates.set(phone, {
      greeted: false,
      handoff: false,
      awaitingReservation: false,
      awaitingDelivery: false
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

function getKeywordReply(userInput, state) {
  const text = normalizeText(userInput);

  if (['1', '2', '3', '4', '5', '6'].includes(text)) {
    if (text === '1') {
      return 'Menu del dia: Dime si prefieres entradas, principales o postres.';
    }
    if (text === '2') {
      state.awaitingReservation = true;
      return 'Perfecto. Para reservar dime fecha, hora y cantidad de personas.';
    }
    if (text === '3') {
      return 'Horario: lunes a jueves 12:00 a 22:00. Viernes y sabado 12:00 a 23:00. Domingo 12:00 a 20:00.';
    }
    if (text === '4') {
      return 'Estamos en Guatire. Si quieres, te envio la ubicacion exacta.';
    }
    if (text === '5') {
      state.awaitingDelivery = true;
      return 'Para delivery dime tu zona y direccion aproximada.';
    }
    return 'Tenemos promos activas. Dime si prefieres combos, bebidas o postres.';
  }

  for (const rule of KEYWORD_RULES) {
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
      return pickRandom(rule.replies);
    }
  }

  return pickRandom(DEFAULT_REPLIES);
}

async function getBotReply(phone, userInput) {
  const state = getUserState(phone);

  if (!state.greeted) {
    state.greeted = true;
    return `${pickRandom(GREETING_REPLIES)}\n${MENU_TEXT}`;
  }

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
