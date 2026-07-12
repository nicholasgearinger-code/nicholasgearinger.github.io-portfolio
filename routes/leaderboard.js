'use strict';

/**
 * Real backend-powered leaderboard for the Signal Runner game.
 *  GET  /api/leaderboard   → top 10 scores, highest first
 *  POST /api/leaderboard   → submit a score { name, score }
 *
 * Deliberately simple and honest: no server-side gameplay validation is
 * possible for a client-side canvas game (there's no authoritative replay
 * to check against), so this is a genuine "honor system" leaderboard, same
 * as almost any browser game leaderboard without a full server-authoritative
 * architecture behind it. A basic sanity cap on submitted scores and rate
 * limiting keep it from being trivially spammed, not from being spoofed by
 * someone determined to fake a request.
 */

const { sendJson, readBody, clean, clientIp, rateLimited } = require('../lib/http');
const { readStore, updateStore } = require('../lib/store');

const MAX_ENTRIES = 10;
const MAX_PLAUSIBLE_SCORE = 999999; // sanity cap, not real anti-cheat

async function list(req, res) {
  const entries = await readStore('leaderboard', []);
  const top = entries
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_ENTRIES)
    .map((e) => ({ name: e.name, score: e.score, createdAt: e.createdAt }));
  sendJson(req, res, 200, { ok: true, entries: top });
}

async function create(req, res, ctx) {
  if (rateLimited('leaderboard:' + clientIp(req), 10, 5 * 60 * 1000)) {
    return sendJson(req, res, 429, { ok: false, error: 'Too many submissions — try again in a few minutes.' });
  }
  const body = ctx.body || (await readBody(req));
  const name = clean(body.name, 12) || 'ANON';
  const score = Math.floor(Number(body.score));

  if (!Number.isFinite(score) || score < 0 || score > MAX_PLAUSIBLE_SCORE) {
    return sendJson(req, res, 422, { ok: false, error: 'Invalid score.' });
  }

  const entry = { name, score, createdAt: new Date().toISOString() };
  let rank = null;
  await updateStore('leaderboard', [], (list) => {
    list.push(entry);
    list.sort((a, b) => b.score - a.score);
    rank = list.indexOf(entry) + 1;
    // Keep only a generous buffer beyond the public top 10, so the file
    // doesn't grow forever, while still letting rankings shift over time.
    return list.slice(0, 100);
  });

  const entries = await readStore('leaderboard', []);
  const top = entries.slice().sort((a, b) => b.score - a.score).slice(0, MAX_ENTRIES);
  sendJson(req, res, 200, { ok: true, rank, madeTop10: rank !== null && rank <= MAX_ENTRIES, entries: top });
}

module.exports = { list, create };
