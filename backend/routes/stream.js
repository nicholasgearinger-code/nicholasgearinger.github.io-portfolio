'use strict';

/**
 * GET /api/stream — Server-Sent Events. Pushes a fresh stats snapshot the
 * instant a new analytics event is recorded (via lib/bus), instead of the
 * frontend polling on a timer. Falls back gracefully: if a client's browser
 * or a proxy in between doesn't support SSE, the connection simply never
 * opens and the frontend's own polling fallback takes over (see
 * wireTelemetry() in the page's JS).
 *
 * Only meaningful on a single, always-warm instance — this deliberately
 * doesn't try to work across multiple horizontally-scaled processes (there's
 * no shared pub/sub backing it, just an in-memory EventEmitter). That's a
 * fine tradeoff for this project's actual deployment (one free-tier Render
 * web service), but worth knowing if this code is ever reused somewhere
 * that autoscales.
 */

const bus = require('../lib/bus');
const { computeStats } = require('./stats');

const HEARTBEAT_MS = 20000; // keep intermediary proxies from timing out an idle connection

async function stream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable buffering on proxies that respect this (e.g., nginx)
  });

  function send(payload) {
    res.write('data: ' + JSON.stringify(payload) + '\n\n');
  }

  // Initial snapshot immediately on connect, so the dashboard doesn't sit
  // empty waiting for the next event to happen somewhere on the site.
  try { send(await computeStats()); } catch (_) {}

  const onEvent = async () => {
    try { send(await computeStats()); } catch (_) {}
  };
  bus.on('event', onEvent);

  const heartbeat = setInterval(() => {
    res.write(': ping\n\n'); // SSE comment line — invisible to the client's onmessage, just keeps the pipe open
  }, HEARTBEAT_MS);

  req.on('close', () => {
    clearInterval(heartbeat);
    bus.off('event', onEvent);
  });
}

module.exports = { stream };
