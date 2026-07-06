'use strict';

/**
 * Public "live activity" feed for the frontend HUD ticker.
 *  GET /api/activity → recent, anonymized activity derived from REAL
 *  tracked events (see routes/analytics.js). No IP, no visitor hash, no
 * geolocation — just friendly descriptions of what happened, so the
 * feed never fabricates data that didn't actually occur.
 */

const { sendJson } = require('../lib/http');
const { readStore } = require('../lib/store');

const SECTION_LABELS = {
  resume: 'the interactive résumé',
  skills: 'the skills & capabilities section',
  build: 'the "In Motion" demo',
  models: 'the 3D model gallery',
  photography: 'the photography carousel',
  process: 'the process section',
  contact: 'the contact section',
  guestbook: 'the guestbook',
  about: 'the about section',
};

function describe(evt) {
  switch (evt.type) {
    case 'page_view':
      return 'A new visitor arrived';
    case 'section_view': {
      const label = SECTION_LABELS[evt.meta && evt.meta.id] || 'a section';
      return `Someone viewed ${label}`;
    }
    case 'resume_tab': {
      const face = clean((evt.meta && evt.meta.face) || 'a facet');
      return `Someone opened the "${face}" tab on the résumé`;
    }
    case 'contact_submit':
      return 'Someone sent a message';
    case 'guestbook_sign':
      return 'Someone signed the guestbook';
    case 'ask':
      return 'Someone asked the AI a question';
    default:
      return null;
  }
}

// Minimal local sanitizer (avoid pulling in lib/http's `clean`, which caps
// length for form fields — this just guards against odd characters).
function clean(s) {
  return String(s).replace(/[<>]/g, '').slice(0, 40);
}

async function activity(req, res) {
  const events = await readStore('analytics', []);
  const cutoffMs = Date.now() - 2 * 60 * 60 * 1000; // last 2 hours

  const recent = events
    .filter((e) => {
      const t = Date.parse(e.ts);
      return !Number.isNaN(t) && t >= cutoffMs;
    })
    .slice(-80) // safety cap before mapping/describing
    .reverse();  // newest first

  const items = [];
  for (const evt of recent) {
    const text = describe(evt);
    if (text) items.push({ text, ts: evt.ts });
    if (items.length >= 12) break;
  }

  sendJson(req, res, 200, { ok: true, items });
}

module.exports = { activity };
