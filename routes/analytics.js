'use strict';

/**
 * Lightweight, privacy-conscious analytics.
 *  POST /api/track   → record an event { type, path, meta }
 *  GET  /api/analytics (admin) → aggregated summary
 *
 * IPs are hashed (never stored raw). The event log is capped so the
 * file can't grow without bound.
 */

const { sendJson, readBody, clean, hashIp, rateLimited, requireAdmin } = require('../lib/http');
const { updateStore, readStore } = require('../lib/store');
const bus = require('../lib/bus');

const MAX_EVENTS = 5000;

/** Reusable recorder so other routes can log events too. */
async function record(req, type, extra) {
  const evt = {
    type: clean(type, 60) || 'event',
    path: clean((extra && extra.path) || '', 200),
    meta: (extra && extra.meta && typeof extra.meta === 'object') ? extra.meta : {},
    ref: clean((req.headers && req.headers.referer) || '', 200),
    ua: clean((req.headers && req.headers['user-agent']) || '', 200),
    visitor: hashIp(req),
    ts: new Date().toISOString(),
  };
  await updateStore('analytics', [], (list) => {
    list.push(evt);
    if (list.length > MAX_EVENTS) list.splice(0, list.length - MAX_EVENTS);
    return list;
  });
  bus.emit('event', evt); // wake up any connected SSE clients
  return evt;
}

async function track(req, res, ctx) {
  if (rateLimited('track:' + hashIp(req), 120, 60 * 1000)) {
    return sendJson(req, res, 429, { ok: false, error: 'Slow down.' });
  }
  const body = ctx.body || (await readBody(req));
  await record(req, body.type, { path: body.path, meta: body.meta });
  sendJson(req, res, 202, { ok: true });
}

function bump(map, key) { if (key) map[key] = (map[key] || 0) + 1; }

async function summary(req, res) {
  if (!requireAdmin(req, res)) return;
  const events = await readStore('analytics', []);
  const byType = {}, byPath = {}, byDay = {}, byRef = {};
  const visitors = new Set();
  for (const e of events) {
    bump(byType, e.type);
    bump(byPath, e.path);
    bump(byDay, (e.ts || '').slice(0, 10));
    if (e.ref) { try { bump(byRef, new URL(e.ref).hostname); } catch (_) {} }
    if (e.visitor) visitors.add(e.visitor);
  }
  const top = (obj, n) =>
    Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ key: k, count: v }));

  sendJson(req, res, 200, {
    ok: true,
    totalEvents: events.length,
    uniqueVisitors: visitors.size,
    byType,
    topPaths: top(byPath, 10),
    topReferrers: top(byRef, 10),
    daily: byDay,
  });
}

module.exports = { track, summary, record };
