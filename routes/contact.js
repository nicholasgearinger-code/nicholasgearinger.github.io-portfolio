'use strict';

const crypto = require('crypto');
const { sendJson, readBody, clean, EMAIL_RE, clientIp, rateLimited } = require('../lib/http');
const { updateStore } = require('../lib/store');
const { CONFIG } = require('../lib/config');
const analytics = require('./analytics');

/* Optional outbound notifications (email via Resend + chat webhook). */
async function notify(msg) {
  const jobs = [];
  if (CONFIG.resendApiKey && CONFIG.contactTo) {
    jobs.push(fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${CONFIG.resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: CONFIG.contactFrom,
        to: [CONFIG.contactTo],
        reply_to: msg.email,
        subject: `New portfolio message from ${msg.name}`,
        text: `From: ${msg.name} <${msg.email}>\n\n${msg.message}`,
      }),
    }).catch((e) => console.error('[notify:resend]', e.message)));
  }
  if (CONFIG.webhookUrl) {
    jobs.push(fetch(CONFIG.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `📬 New message from ${msg.name} <${msg.email}>\n${msg.message}`,
        text: `📬 New message from ${msg.name} <${msg.email}>\n${msg.message}`,
      }),
    }).catch((e) => console.error('[notify:webhook]', e.message)));
  }
  if (jobs.length) await Promise.allSettled(jobs);
}

async function post(req, res, ctx) {
  const ip = clientIp(req);
  if (rateLimited(`contact:${ip}`, 5, 60 * 1000)) {
    return sendJson(req, res, 429, { ok: false, error: 'Too many messages — please try again shortly.' });
  }
  const body = ctx.body || (await readBody(req));

  // Honeypot fields — bots fill them, humans don't.
  if (clean(body.website, 100) || clean(body.company_url, 100)) {
    return sendJson(req, res, 200, { ok: true, id: 'ignored' });
  }

  const name = clean(body.name, 120);
  const email = clean(body.email, 200);
  const message = clean(body.message, 4000);
  const subject = clean(body.subject, 200);

  const fields = {};
  if (name.length < 2) fields.name = 'Please enter your name.';
  if (!EMAIL_RE.test(email)) fields.email = 'Please enter a valid email.';
  if (message.length < 10) fields.message = 'Message should be at least 10 characters.';
  if (Object.keys(fields).length) {
    return sendJson(req, res, 422, { ok: false, error: 'Validation failed', fields });
  }

  const record = {
    id: crypto.randomUUID(),
    name, email, subject, message,
    read: false,
    ip,
    userAgent: clean(req.headers['user-agent'], 300),
    createdAt: new Date().toISOString(),
  };
  await updateStore('messages', [], (list) => { list.push(record); return list; });
  analytics.record(req, 'contact_submit', { meta: { hasSubject: Boolean(subject) } }).catch(() => {});
  notify(record).catch(() => {});

  sendJson(req, res, 201, { ok: true, id: record.id, message: 'Thanks — your message was received.' });
}

module.exports = { post };
