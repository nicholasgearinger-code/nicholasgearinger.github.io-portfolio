'use strict';

const { sendJson, readBody, requireAdmin } = require('../lib/http');
const { readStore, updateStore } = require('../lib/store');
const { CONFIG } = require('../lib/config');

async function health(req, res) {
  sendJson(req, res, 200, {
    ok: true,
    service: 'portfolio-backend',
    version: '1.1.0',
    uptimeSeconds: Math.round(process.uptime()),
    time: new Date().toISOString(),
    features: {
      email: Boolean(CONFIG.resendApiKey && CONFIG.contactTo),
      webhook: Boolean(CONFIG.webhookUrl),
      askAI: Boolean(CONFIG.anthropicApiKey),
      admin: Boolean(CONFIG.adminToken),
    },
  });
}

/* Availability badge the front-end can read ("open to work"). */
const DEFAULT_STATUS = { available: true, headline: 'Open to roles & select freelance', updatedAt: null };

async function getStatus(req, res) {
  const s = await readStore('status', DEFAULT_STATUS);
  sendJson(req, res, 200, { ok: true, ...s });
}

async function setStatus(req, res, ctx) {
  if (!requireAdmin(req, res)) return;
  const body = ctx.body || (await readBody(req));
  const s = await updateStore('status', DEFAULT_STATUS, (cur) => ({
    available: typeof body.available === 'boolean' ? body.available : cur.available,
    headline: body.headline != null ? String(body.headline).slice(0, 140) : cur.headline,
    updatedAt: new Date().toISOString(),
  }));
  sendJson(req, res, 200, { ok: true, ...s });
}

module.exports = { health, getStatus, setStatus };
