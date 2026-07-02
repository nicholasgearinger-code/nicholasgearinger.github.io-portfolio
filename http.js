'use strict';

const crypto = require('crypto');
const { CONFIG } = require('./config');

/* ── Client IP (respects a single proxy hop) ── */
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

/* ── Privacy-preserving IP hash for analytics ── */
function hashIp(req) {
  return crypto.createHash('sha256').update(CONFIG.ipSalt + '|' + clientIp(req)).digest('hex').slice(0, 16);
}

/* ── CORS ── */
function corsHeaders(req) {
  const origin = req.headers.origin;
  const allow =
    CONFIG.corsOrigins.includes('*') ? '*'
    : origin && CONFIG.corsOrigins.includes(origin) ? origin
    : CONFIG.corsOrigins[0] || '';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
    'Access-Control-Max-Age': '600',
  };
}

/* ── Responders ── */
function sendJson(req, res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    ...corsHeaders(req),
  });
  res.end(body);
}

function sendText(req, res, status, text, contentType) {
  res.writeHead(status, {
    'Content-Type': contentType || 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    ...corsHeaders(req),
  });
  res.end(text);
}

/* ── Body parsing with a hard size cap ── */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > CONFIG.maxBodyBytes) {
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (_) { reject(Object.assign(new Error('Invalid JSON body'), { statusCode: 400 })); }
    });
    req.on('error', reject);
  });
}

/* ── Validation helpers ── */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ── In-memory sliding-window rate limiter ── */
const rlHits = new Map();
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  max = max || CONFIG.rateLimit.max;
  windowMs = windowMs || CONFIG.rateLimit.windowMs;
  const arr = (rlHits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  rlHits.set(key, arr);
  return arr.length > max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of rlHits) {
    const keep = arr.filter((t) => now - t < CONFIG.rateLimit.windowMs);
    if (keep.length) rlHits.set(k, keep);
    else rlHits.delete(k);
  }
}, 5 * 60 * 1000).unref();

/* ── Admin auth guard ── */
function requireAdmin(req, res) {
  if (!CONFIG.adminToken) {
    sendJson(req, res, 403, { ok: false, error: 'Admin access is not configured.' });
    return false;
  }
  if ((req.headers['x-admin-token'] || '') !== CONFIG.adminToken) {
    sendJson(req, res, 401, { ok: false, error: 'Unauthorized' });
    return false;
  }
  return true;
}

module.exports = {
  clientIp, hashIp, corsHeaders, sendJson, sendText, readBody,
  EMAIL_RE, clean, escapeHtml, rateLimited, requireAdmin,
};
