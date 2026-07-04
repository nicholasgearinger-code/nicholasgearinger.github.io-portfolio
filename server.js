'use strict';

/**
 * Nicholas Gearinger — Portfolio backend
 * ------------------------------------------------------------------
 * Dependency-free Node.js (18+). Run:  node server.js
 *
 * Serves the static portfolio and a small, practical JSON API. State
 * persists to flat files in ./data (no database). Optional email, chat
 * webhook, and AI features activate only when their env vars are set.
 *
 * API
 *   GET  /api/health                 service status & enabled features
 *   GET  /api/status                 availability badge ("open to work")
 *   POST /api/status            [A]  update availability
 *   POST /api/contact                contact-form submissions
 *   GET  /api/messages          [A]  list messages
 *   PATCH  /api/messages/:id/read [A] mark message read
 *   DELETE /api/messages/:id    [A]  delete message
 *   GET  /api/views                  read page-view counter
 *   POST /api/views                  increment page-view counter
 *   POST /api/subscribe              newsletter sign-up
 *   POST /api/track                  record an analytics event
 *   GET  /api/analytics         [A]  aggregated analytics summary
 *   GET  /api/guestbook              approved guestbook entries
 *   POST /api/guestbook              sign the guestbook
 *   PATCH  /api/guestbook/:id   [A]  approve entry
 *   DELETE /api/guestbook/:id   [A]  delete entry
 *   GET  /api/projects               projects + clap counts
 *   GET  /api/projects/:id           one project
 *   POST /api/projects/:id/clap      clap for a project
 *   POST /api/ask                    ask the profile-grounded AI assistant
 *   GET  /api/vcard                  download a .vcf contact card
 *   GET  /api/resume                 structured JSON résumé
 *   GET  /robots.txt, /sitemap.xml   SEO
 *   GET  /*                          static site
 *
 *   [A] = requires the X-Admin-Token header (set ADMIN_TOKEN)
 */

const http = require('http');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { URL } = require('url');

const { CONFIG } = require('./lib/config');
const { sendJson, readBody, corsHeaders } = require('./lib/http');

const health = require('./routes/status'); // health + status live together
const contact = require('./routes/contact');
const engagement = require('./routes/engagement');
const analytics = require('./routes/analytics');
const guestbook = require('./routes/guestbook');
const projects = require('./routes/projects');
const download = require('./routes/download');
const ask = require('./routes/ask');
const activityRoute = require('./routes/activity');
const statsRoute = require('./routes/stats');

/* ── Route table. Patterns support :params. ── */
const routes = [
  ['GET', '/api/health', health.health],
  ['GET', '/api/status', health.getStatus],
  ['POST', '/api/status', health.setStatus],

  ['POST', '/api/contact', contact.post],
  ['GET', '/api/messages', engagement.listMessages],
  ['PATCH', '/api/messages/:id/read', engagement.markRead],
  ['DELETE', '/api/messages/:id', engagement.deleteMessage],

  ['GET', '/api/views', engagement.getViews],
  ['POST', '/api/views', engagement.bumpViews],
  ['POST', '/api/subscribe', engagement.subscribe],

  ['POST', '/api/track', analytics.track],
  ['GET', '/api/analytics', analytics.summary],
  ['GET', '/api/activity', activityRoute.activity],
  ['GET', '/api/stats', statsRoute.stats],

  ['GET', '/api/guestbook', guestbook.list],
  ['POST', '/api/guestbook', guestbook.create],
  ['PATCH', '/api/guestbook/:id', guestbook.approve],
  ['DELETE', '/api/guestbook/:id', guestbook.remove],

  ['GET', '/api/projects', projects.list],
  ['GET', '/api/projects/:id', projects.getOne],
  ['POST', '/api/projects/:id/clap', projects.clap],

  ['POST', '/api/ask', ask.ask],

  ['GET', '/api/vcard', download.vcard],
  ['GET', '/api/resume', download.resume],
  ['GET', '/robots.txt', download.robots],
  ['GET', '/sitemap.xml', download.sitemap],
].map(([method, pattern, handler]) => {
  const names = [];
  const regex = new RegExp(
    '^' + pattern.replace(/:[^/]+/g, (m) => { names.push(m.slice(1)); return '([^/]+)'; }) + '$'
  );
  return { method, regex, names, handler };
});

function matchRoute(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = pathname.match(r.regex);
    if (!m) continue;
    const params = {};
    r.names.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1])));
    return { handler: r.handler, params };
  }
  return null;
}

/* ── Static file serving (path-traversal safe) ── */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.mp4': 'video/mp4',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
};

function resolvePublicDir() {
  for (const dir of CONFIG.publicDirs) {
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const idx of CONFIG.indexCandidates) {
        if (fs.existsSync(path.join(dir, idx))) return { dir, index: idx };
      }
    } catch (_) {}
  }
  for (const dir of CONFIG.publicDirs) {
    try { if (fs.statSync(dir).isDirectory()) return { dir, index: CONFIG.indexCandidates[0] }; } catch (_) {}
  }
  return null;
}

async function serveStatic(req, res, pathname) {
  const site = resolvePublicDir();
  if (!site) return sendJson(req, res, 404, { ok: false, error: 'Not found' });

  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/' + site.index;
  const target = path.join(site.dir, path.normalize(rel));
  if (!target.startsWith(path.resolve(site.dir))) {
    return sendJson(req, res, 403, { ok: false, error: 'Forbidden' });
  }
  try {
    const stat = await fsp.stat(target);
    const file = stat.isDirectory() ? path.join(target, site.index) : target;
    const data = await fsp.readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': file.endsWith('.html') ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  } catch (_) {
    try {
      const data = await fsp.readFile(path.join(site.dir, site.index));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    } catch (e) {
      sendJson(req, res, 404, { ok: false, error: 'Not found' });
    }
  }
}

/* ── Server ── */
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (req.method === 'OPTIONS') { res.writeHead(204, corsHeaders(req)); return res.end(); }

    const route = matchRoute(req.method, pathname);
    if (route) {
      const ctx = { params: route.params, query: url.searchParams };
      if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
        ctx.body = await readBody(req).catch((e) => { throw e; });
      }
      return route.handler(req, res, ctx);
    }

    if (pathname.startsWith('/api/')) {
      return sendJson(req, res, 404, { ok: false, error: 'Unknown endpoint' });
    }
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, pathname);
    sendJson(req, res, 405, { ok: false, error: 'Method not allowed' });
  } catch (err) {
    const status = err.statusCode || 500;
    if (status >= 500) console.error('[server]', err);
    sendJson(req, res, status, { ok: false, error: err.message || 'Server error' });
  }
});

server.listen(CONFIG.port, CONFIG.host, () => {
  const site = resolvePublicDir();
  console.log(`▶ Portfolio backend on http://${CONFIG.host}:${CONFIG.port}`);
  console.log(`  Static:   ${site ? site.dir : '(none found)'}`);
  console.log(`  Data:     ${CONFIG.dataDir}`);
  console.log(`  Email:    ${CONFIG.resendApiKey && CONFIG.contactTo ? 'on' : 'off'}   ` +
              `Webhook: ${CONFIG.webhookUrl ? 'on' : 'off'}   ` +
              `Ask AI: ${CONFIG.anthropicApiKey ? 'on' : 'off'}   ` +
              `Admin: ${CONFIG.adminToken ? 'on' : 'off'}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n${sig} — shutting down.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

module.exports = server;
