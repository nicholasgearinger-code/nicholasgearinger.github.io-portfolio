'use strict';

/**
 * Public "site telemetry" endpoint powering the frontend dashboard.
 *  GET /api/stats → aggregate, non-identifying numbers only.
 * No IPs, no visitor hashes, no individual events — just counts, safe to
 * expose publicly as a showcase of the real backend behind this site.
 */

const { sendJson } = require('../lib/http');
const { readStore } = require('../lib/store');

const SECTION_LABELS = {
  resume: 'Résumé',
  tools: 'Toolkit',
  skills: 'Capabilities',
  build: 'In Motion',
  algorithm: 'Deep Learning Demo',
  boids: 'Flocking Simulation',
  classifier: 'Image Classifier',
  models: '3D Craft',
  photography: 'Photography',
  process: 'Process',
  contact: 'Contact',
  guestbook: 'Guestbook',
};

function bump(map, key) {
  if (key) map[key] = (map[key] || 0) + 1;
}

async function stats(req, res) {
  const [events, guestbook, siteStats] = await Promise.all([
    readStore('analytics', []),
    readStore('guestbook', []),
    readStore('stats', { views: 0 }),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  let pageViewEvents = 0;
  let viewsToday = 0;
  const sectionCounts = {};
  const tabCounts = {};

  for (const e of events) {
    const day = (e.ts || '').slice(0, 10);
    if (e.type === 'page_view') {
      pageViewEvents++;
      if (day === today) viewsToday++;
    }
    if (e.type === 'section_view' && e.meta && e.meta.id) {
      bump(sectionCounts, e.meta.id);
    }
    if (e.type === 'resume_tab' && e.meta && e.meta.face) {
      bump(tabCounts, e.meta.face);
    }
  }

  const topSections = Object.entries(sectionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([id, count]) => ({ id, label: SECTION_LABELS[id] || id, count }));

  sendJson(req, res, 200, {
    ok: true,
    totalViews: siteStats.views || pageViewEvents,
    viewsToday,
    topSections,
    resumeTabViews: tabCounts,
    guestbookEntries: Array.isArray(guestbook) ? guestbook.length : 0,
    totalEvents: events.length,
    uptimeSeconds: Math.floor(process.uptime()),
    generatedAt: new Date().toISOString(),
  });
}

module.exports = { stats };
