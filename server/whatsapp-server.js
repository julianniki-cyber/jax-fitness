/*
  JAX Fitness Studio: WhatsApp sending server (optional).

  Only needed for automatic sending. The dashboard posts each message here,
  and this server sends it through the WhatsApp Business Cloud API.

  Needs Node.js 18 or newer. No packages to install.
  Start:  cd server  then  npm start
  Setup:  copy .env.example to .env and fill in your keys (see README.md).
*/
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

/* ---------- load .env without extra packages ---------- */
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  });
}

const PORT = Number(process.env.PORT || 8787);
const TOKEN = process.env.WA_TOKEN || '';
const PHONE_ID = process.env.WA_PHONE_NUMBER_ID || '';
const API_VERSION = process.env.WA_API_VERSION || 'v21.0';
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const DRY_RUN = process.env.DRY_RUN === '1';

// Maps each dashboard message type to a template approved in Meta Business Manager.
const templatesPath = path.join(__dirname, 'templates.json');
const TEMPLATES = fs.existsSync(templatesPath) ? JSON.parse(fs.readFileSync(templatesPath, 'utf8')) : {};

const configured = Boolean(TOKEN && PHONE_ID);

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 100000) { reject(new Error('Request too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error('Body is not valid JSON')); }
    });
  });
}

// Builds the Cloud API payload: an approved template when one is mapped, otherwise plain text.
function buildPayload({ to, text, templateKey, vars }) {
  const tpl = templateKey && TEMPLATES[templateKey];
  if (tpl && tpl.name) {
    const params = (tpl.params || []).map((p) => ({ type: 'text', text: String((vars && vars[p]) ?? '') || '-' }));
    return {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: tpl.name,
        language: { code: tpl.language || 'en' },
        components: params.length ? [{ type: 'body', parameters: params }] : []
      }
    };
  }
  // Free text is only delivered inside a 24-hour window after the person last messaged you.
  return { messaging_product: 'whatsapp', to, type: 'text', text: { body: text, preview_url: false } };
}

async function sendWhatsApp(msg) {
  const payload = buildPayload(msg);
  if (DRY_RUN) {
    console.log('[dry run]', JSON.stringify(payload));
    return { id: 'dry-run-' + Date.now() };
  }
  if (!configured) throw new Error('WA_TOKEN and WA_PHONE_NUMBER_ID are not set in server/.env');
  const url = `https://graph.facebook.com/${API_VERSION}/${PHONE_ID}/messages`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    const reason = (json.error && (json.error.error_data && json.error.error_data.details || json.error.message)) || `WhatsApp replied ${r.status}`;
    throw new Error(reason);
  }
  return { id: json.messages && json.messages[0] && json.messages[0].id };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'OPTIONS') return send(res, 204, {});

  if (req.method === 'GET' && url.pathname === '/health') {
    return send(res, 200, { ok: true, configured: configured || DRY_RUN, dryRun: DRY_RUN, templates: Object.keys(TEMPLATES) });
  }

  if (req.method === 'POST' && url.pathname === '/send') {
    try {
      const body = await readBody(req);
      const to = String(body.to || '').replace(/\D/g, '');
      if (to.length < 11) return send(res, 400, { ok: false, error: 'Phone number must include the country code' });
      if (!body.text && !(body.templateKey && TEMPLATES[body.templateKey])) return send(res, 400, { ok: false, error: 'Nothing to send' });
      const result = await sendWhatsApp({ to, text: body.text, templateKey: body.templateKey, vars: body.vars });
      console.log(new Date().toISOString(), 'sent', body.templateKey || 'text', 'to', to.slice(0, -4) + '****');
      return send(res, 200, { ok: true, id: result.id });
    } catch (err) {
      console.error(new Date().toISOString(), 'failed:', err.message);
      return send(res, 502, { ok: false, error: err.message });
    }
  }

  send(res, 404, { ok: false, error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`JAX WhatsApp server on http://localhost:${PORT}`);
  console.log(DRY_RUN ? 'DRY RUN: messages are printed here, not sent.' : configured ? 'Connected to WhatsApp Cloud API.' : 'WhatsApp keys missing: fill in server/.env');
});
