const axios = require('axios');

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
    keywords: ['hola', 'buenas', 'buenos dias', 'buenas tardes', 'buenas noches'],
    reply: 'Hola. Soy el bot de Sivetachi. En que te puedo ayudar?'
  },
  {
    keywords: ['menu', 'opciones', 'ayuda', 'info', 'informacion'],
    reply: 'Menu rapido: 1) Precios 2) Horarios 3) Ubicacion 4) Catalogo 5) Agendar 6) Hablar con asesor.'
  },
  {
    keywords: ['precio', 'precios', 'costo', 'costos', 'valor', 'tarifa'],
    reply: 'Tenemos planes y precios segun el servicio. Dime que necesitas y te paso la info.'
  },
  {
    keywords: ['cotizacion', 'cotizar', 'presupuesto'],
    reply: 'Con gusto. Dime que servicio necesitas y te preparo una cotizacion.'
  },
  {
    keywords: ['horario', 'horarios', 'abren', 'abierto', 'cierran', 'cerrado'],
    reply: 'Nuestro horario es de lunes a viernes de 9 a 18. Sabado de 9 a 13.'
  },
  {
    keywords: ['ubicacion', 'direccion', 'donde estan', 'donde quedan'],
    reply: 'Estamos en Guatire. Si quieres, te envio la ubicacion exacta por aqui.'
  },
  {
    keywords: ['pago', 'pagos', 'transferencia', 'zelle', 'efectivo'],
    reply: 'Aceptamos transferencia, Zelle y efectivo. Dime que metodo prefieres.'
  },
  {
    keywords: ['garantia', 'garantias'],
    reply: 'Ofrecemos garantia segun el servicio. Dime cual necesitas y te explico los terminos.'
  },
  {
    keywords: ['envio', 'entrega', 'delivery'],
    reply: 'Si hacemos entregas. Indica tu zona para confirmar disponibilidad.'
  },
  {
    keywords: ['catalogo', 'productos', 'servicios'],
    reply: 'Tenemos varios servicios. Dime que buscas y te paso el catalogo.'
  },
  {
    keywords: ['agendar', 'cita', 'reservar'],
    reply: 'Claro, dime que dia y hora te conviene y lo agendamos.'
  },
  {
    keywords: ['asesor', 'humano', 'operador', 'atencion'],
    reply: 'Te paso con un asesor. Por favor deja tu nombre y un resumen de lo que necesitas.'
  },
  {
    keywords: ['reclamo', 'queja', 'problema', 'soporte'],
    reply: 'Lamento el inconveniente. Describe el problema y un asesor te ayudara.'
  },
  {
    keywords: ['promocion', 'promociones', 'oferta', 'ofertas'],
    reply: 'Tenemos promos activas esta semana. Dime que servicio te interesa y te doy detalles.'
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
          const response = getKeywordReply(customerMsg);
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
