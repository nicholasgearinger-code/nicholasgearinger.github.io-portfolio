'use strict';

/**
 * Projects API — serves portfolio work as JSON and tracks "claps".
 *  GET  /api/projects              → all projects (+ clap counts)
 *  GET  /api/projects/:id          → one project
 *  POST /api/projects/:id/clap     → add a clap (rate-limited, max 10 per visitor)
 */

const { sendJson, clientIp, rateLimited } = require('../lib/http');
const { readStore, updateStore } = require('../lib/store');
const { PROJECTS } = require('../lib/config');

async function withClaps(items) {
  const claps = await readStore('claps', {});
  return items.map((p) => ({ ...p, claps: claps[p.id] || 0 }));
}

async function list(req, res) {
  sendJson(req, res, 200, { ok: true, count: PROJECTS.length, projects: await withClaps(PROJECTS) });
}

async function getOne(req, res, ctx) {
  const p = PROJECTS.find((x) => x.id === ctx.params.id);
  if (!p) return sendJson(req, res, 404, { ok: false, error: 'Project not found' });
  const [withCount] = await withClaps([p]);
  sendJson(req, res, 200, { ok: true, project: withCount });
}

async function clap(req, res, ctx) {
  const p = PROJECTS.find((x) => x.id === ctx.params.id);
  if (!p) return sendJson(req, res, 404, { ok: false, error: 'Project not found' });
  // Up to 10 claps per visitor per project per hour.
  if (rateLimited(`clap:${clientIp(req)}:${p.id}`, 10, 60 * 60 * 1000)) {
    const claps = await readStore('claps', {});
    return sendJson(req, res, 200, { ok: true, claps: claps[p.id] || 0, counted: false });
  }
  const claps = await updateStore('claps', {}, (c) => { c[p.id] = (c[p.id] || 0) + 1; return c; });
  sendJson(req, res, 200, { ok: true, claps: claps[p.id], counted: true });
}

module.exports = { list, getOne, clap };
