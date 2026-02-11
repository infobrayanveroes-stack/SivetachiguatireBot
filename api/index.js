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

const chatHistory = [];
let isBotEnabled = true;

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

const KEYWORD_RULES = [
  {
    keywords: [
      'hola', 'holi', 'hey', 'epa', 'epale', 'buenas', 'buen dia', 'buenos dias',
      'buenas tardes', 'buenas noches', 'que tal', 'q tal', 'que hubo', 'qlq',
      'qloq', 'que lo que', 'como estas'
    ],
    reply: 'Hola. Soy el bot de Sivetachi Restaurante. En que te puedo ayudar?'
  },
  {
    keywords: ['menu', 'opciones', 'ayuda', 'info', 'informacion'],
    reply: 'Menu rapido: 1) Menu del dia 2) Reservas 3) Horarios 4) Ubicacion 5) Delivery 6) Promos.'
  },
  {
    keywords: ['menu', 'carta', 'platos', 'comida', 'sushi', 'parrilla', 'pasta', 'pizza', 'postre'],
    reply: 'Te paso nuestro menu. Dime si buscas entradas, principales o postres.'
  },
  {
    keywords: ['precio', 'precios', 'costo', 'costos', 'valor', 'tarifa'],
    reply: 'Claro. Dime el plato o combo y te paso el precio.'
  },
  {
    keywords: ['horario', 'horarios', 'abren', 'abierto', 'cierran', 'cerrado'],
    reply: 'Horario: lunes a jueves 12:00 a 22:00. Viernes y sabado 12:00 a 23:00. Domingo 12:00 a 20:00.'
  },
  {
    keywords: ['ubicacion', 'direccion', 'donde estan', 'donde quedan'],
    reply: 'Estamos en Guatire. Si quieres, te envio la ubicacion exacta y como llegar.'
  },
  {
    keywords: ['reservar', 'reserva', 'reservas', 'mesa', 'agendar'],
    reply: 'Claro. Para reservar dime fecha, hora y cantidad de personas.'
  },
  {
    keywords: ['delivery', 'envio', 'entrega', 'domicilio'],
    reply: 'Si tenemos delivery. Indica tu zona y te confirmo disponibilidad y tiempo.'
  },
  {
    keywords: ['pago', 'pagos', 'transferencia', 'zelle', 'efectivo', 'pago movil'],
    reply: 'Aceptamos pago movil, transferencia, Zelle y efectivo. Que metodo prefieres?'
  },
  {
    keywords: ['promo', 'promos', 'promocion', 'promociones', 'oferta', 'ofertas'],
    reply: 'Tenemos promos activas. Dime si prefieres combos, bebidas o postres.'
  },
  {
    keywords: ['cumple', 'cumpleanos', 'evento', 'eventos', 'grupo'],
    reply: 'Atendemos eventos. Dime fecha, cantidad de personas y tipo de evento.'
  },
  {
    keywords: ['alergia', 'alergias', 'sin gluten', 'vegetariano', 'vegano'],
    reply: 'Tenemos opciones especiales. Dime tu restriccion y te recomiendo platos.'
  },
  {
    keywords: ['reclamo', 'queja', 'problema', 'soporte'],
    reply: 'Lamento el inconveniente. Cuentame que paso y te ayudamos de inmediato.'
  },
  {
    keywords: ['asesor', 'humano', 'operador', 'atencion'],
    reply: 'Te paso con un asesor. Deja tu nombre y un resumen de lo que necesitas.'
  },
  {
    keywords: ['gracias', 'ok', 'perfecto', 'listo'],
    reply: 'Con gusto. Si necesitas algo mas, avisame.'
  }
];

function getKeywordReply(userInput) {
  const text = normalizeText(userInput);

  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.some((keyword) => text.includes(keyword))) {
      return rule.reply;
    }
  }

  return 'Gracias por escribir. Escribe "menu" para ver opciones rapidas.';
}

async function getBotReply(userInput) {
  if (!AI_ENABLED) {
    return getKeywordReply(userInput);
  }

  if (AI_PROVIDER !== 'openai' || !openai) {
    return getKeywordReply(userInput);
  }

  try {
    const response = await openai.responses.create({
      model: 'gpt-4.1-mini',
      input: [
        { role: 'system', content: 'Eres un asistente de restaurante. Responde breve y amable. Si no sabes, ofrece el menu o un asesor.' },
        { role: 'user', content: userInput }
      ]
    });

    return response.output_text || getKeywordReply(userInput);
  } catch (error) {
    console.error('Error AI:', error);
    return getKeywordReply(userInput);
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

      if (message && message.type === 'text') {
        const customerPhone = message.from;
        const customerMsg = message.text.body;
        addChatEvent({ direction: 'in', phone: customerPhone, text: customerMsg });

        if (isBotEnabled) {
          const response = await getBotReply(customerMsg);
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
