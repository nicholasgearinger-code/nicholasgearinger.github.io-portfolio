'use strict';

const { sendJson, readBody, clean, EMAIL_RE, clientIp, rateLimited, requireAdmin } = require('../lib/http');
const { readStore, updateStore } = require('../lib/store');

/* ── Page-view counter ── */
async function getViews(req, res) {
  const s = await readStore('stats', { views: 0 });
  sendJson(req, res, 200, { ok: true, views: s.views || 0 });
}
async function bumpViews(req, res) {
  // one increment per visitor per short window to reduce refresh inflation
  if (rateLimited('view:' + clientIp(req), 1, 30 * 60 * 1000)) {
    const s = await readStore('stats', { views: 0 });
    return sendJson(req, res, 200, { ok: true, views: s.views || 0, counted: false });
  }
  const s = await updateStore('stats', { views: 0 }, (cur) => {
    cur.views = (cur.views || 0) + 1;
    cur.lastView = new Date().toISOString();
    return cur;
  });
  sendJson(req, res, 200, { ok: true, views: s.views, counted: true });
}

/* ── Newsletter subscribe ── */
async function subscribe(req, res, ctx) {
  if (rateLimited('subscribe:' + clientIp(req), 5, 60 * 1000)) {
    return sendJson(req, res, 429, { ok: false, error: 'Too many attempts — try again soon.' });
  }
  const body = ctx.body || (await readBody(req));
  if (clean(body.website, 100)) return sendJson(req, res, 200, { ok: true }); // honeypot
  const email = clean(body.email, 200).toLowerCase();
  if (!EMAIL_RE.test(email)) return sendJson(req, res, 422, { ok: false, error: 'Please enter a valid email.' });

  let already = false;
  await updateStore('subscribers', [], (list) => {
    if (list.some((s) => s.email === email)) { already = true; return list; }
    list.push({ email, createdAt: new Date().toISOString(), ip: clientIp(req) });
    return list;
  });
  sendJson(req, res, already ? 200 : 201, {
    ok: true,
    message: already ? "You're already subscribed." : 'Subscribed — thank you!',
  });
}

/* ── Admin: list / read / delete messages ── */
async function listMessages(req, res) {
  if (!requireAdmin(req, res)) return;
  const list = await readStore('messages', []);
  sendJson(req, res, 200, { ok: true, count: list.length, unread: list.filter((m) => !m.read).length, messages: list });
}
async function markRead(req, res, ctx) {
  if (!requireAdmin(req, res)) return;
  let found = false;
  await updateStore('messages', [], (list) => {
    for (const m of list) if (m.id === ctx.params.id) { m.read = true; found = true; }
    return list;
  });
  sendJson(req, res, found ? 200 : 404, { ok: found });
}
async function deleteMessage(req, res, ctx) {
  if (!requireAdmin(req, res)) return;
  let removed = false;
  await updateStore('messages', [], (list) => {
    const next = list.filter((m) => m.id !== ctx.params.id);
    removed = next.length !== list.length;
    return next;
  });
  sendJson(req, res, removed ? 200 : 404, { ok: removed });
}

module.exports = { getViews, bumpViews, subscribe, listMessages, markRead, deleteMessage };
