const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const REQUIRED_ENV = [
  'GEMINI_API_KEY',
  'WA_TOKEN',
  'VERIFY_TOKEN',
  'PHONE_NUMBER_ID'
];

const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
  console.warn(`Missing env vars: ${missingEnv.join(', ')}`);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const GEMINI_MODEL = (process.env.GEMINI_MODEL || 'gemini-1.5-flash').trim();
const MODEL_CANDIDATES = Array.from(new Set([
  GEMINI_MODEL,
  'gemini-1.5-flash',
  'gemini-1.5-flash-002',
  'gemini-1.5-pro',
  'gemini-1.0-pro'
]));
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

async function askAssistant(userInput) {
  let lastError;

  for (const modelName of MODEL_CANDIDATES) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(userInput);
      if (modelName !== GEMINI_MODEL) {
        console.warn(`Model ${GEMINI_MODEL} failed, using ${modelName}`);
      }
      return result.response.text();
    } catch (error) {
      const message = String(error?.message || '');
      const isNotFound = message.includes('404') || message.toLowerCase().includes('not found');
      lastError = error;

      if (!isNotFound) {
        throw error;
      }
    }
  }

  throw lastError;
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
          const response = await askAssistant(customerMsg);
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
