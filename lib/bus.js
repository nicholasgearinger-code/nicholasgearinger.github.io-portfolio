'use strict';

/**
 * Minimal in-process pub/sub so the SSE stream (routes/stream.js) can be
 * notified the instant a new analytics event is recorded (routes/analytics.js
 * calls bus.emit() after every write), instead of polling the data file.
 *
 * Deliberately just a plain EventEmitter wrapper — no external dependency,
 * consistent with the rest of this zero-dependency backend. Since Node
 * process state isn't shared across instances, this only works for a
 * single-instance deployment (true of this project's free-tier Render
 * service — see note in server.js about not scaling to multiple instances
 * while relying on this).
 */

const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(50); // generous headroom for concurrent SSE clients

module.exports = bus;
