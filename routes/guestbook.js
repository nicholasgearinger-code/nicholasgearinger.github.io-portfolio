'use strict';

/**
 * A little public guestbook / wall.
 *  GET  /api/guestbook            → approved entries (newest first)
 *  POST /api/guestbook            → submit an entry (held for moderation
 *                                   unless GUESTBOOK_AUTO_APPROVE=true)
 *  PATCH  /api/guestbook/:id      → admin approve
 *  DELETE /api/guestbook/:id      → admin delete
 */

const crypto = require('crypto');
const { sendJson, readBody, clean, escapeHtml, clientIp, rateLimited, requireAdmin } = require('../lib/http');
const { readStore, updateStore } = require('../lib/store');
const { CONFIG } = require('../lib/config');
const analytics = require('./analytics');

const BLOCKLIST = /(viagra|casino|crypto\s*giveaway|\bporn\b|\bloan\b|http:\/\/|https:\/\/)/i;

async function list(req, res) {
  const entries = await readStore('guestbook', []);
  const publicView = entries
    .filter((e) => e.approved)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((e) => ({ id: e.id, name: e.name, message: e.message, createdAt: e.createdAt }));
  sendJson(req, res, 200, { ok: true, count: publicView.length, entries: publicView });
}

async function create(req, res, ctx) {
  if (rateLimited('guestbook:' + clientIp(req), 3, 5 * 60 * 1000)) {
    return sendJson(req, res, 429, { ok: false, error: 'You are posting too fast — try again soon.' });
  }
  const body = ctx.body || (await readBody(req));
  if (clean(body.website, 100)) return sendJson(req, res, 200, { ok: true }); // honeypot

  const name = clean(body.name, 60);
  const message = clean(body.message, 280);
  if (name.length < 2) return sendJson(req, res, 422, { ok: false, error: 'Please add your name.' });
  if (message.length < 3) return sendJson(req, res, 422, { ok: false, error: 'Please add a short message.' });
  if (BLOCKLIST.test(name + ' ' + message)) {
    return sendJson(req, res, 422, { ok: false, error: 'That message looks like spam.' });
  }

  const entry = {
    id: crypto.randomUUID(),
    name: escapeHtml(name),
    message: escapeHtml(message),
    approved: Boolean(CONFIG.guestbookAutoApprove),
    ip: clientIp(req),
    createdAt: new Date().toISOString(),
  };
  await updateStore('guestbook', [], (l) => { l.push(entry); return l; });
  analytics.record(req, 'guestbook_sign').catch(() => {});

  sendJson(req, res, 201, {
    ok: true,
    pending: !entry.approved,
    message: entry.approved ? 'Signed — thanks!' : 'Thanks! Your note will appear once approved.',
    entry: entry.approved ? { id: entry.id, name: entry.name, message: entry.message, createdAt: entry.createdAt } : undefined,
  });
}

async function approve(req, res, ctx) {
  if (!requireAdmin(req, res)) return;
  let found = false;
  await updateStore('guestbook', [], (l) => {
    for (const e of l) if (e.id === ctx.params.id) { e.approved = true; found = true; }
    return l;
  });
  sendJson(req, res, found ? 200 : 404, { ok: found });
}

async function remove(req, res, ctx) {
  if (!requireAdmin(req, res)) return;
  let removed = false;
  await updateStore('guestbook', [], (l) => {
    const next = l.filter((e) => e.id !== ctx.params.id);
    removed = next.length !== l.length;
    return next;
  });
  sendJson(req, res, removed ? 200 : 404, { ok: removed });
}

module.exports = { list, create, approve, remove };
