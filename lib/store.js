'use strict';

/**
 * Flat-file JSON store. Reads are cheap; writes for a given file are
 * serialized through a per-file promise queue and committed atomically
 * (write temp + rename) so concurrent requests never corrupt data.
 */

const fs = require('fs').promises;
const path = require('path');
const { CONFIG } = require('./config');

const writeQueues = new Map();

function storePath(name) {
  return path.join(CONFIG.dataDir, `${name}.json`);
}

async function readStore(name, fallback) {
  try {
    const raw = await fs.readFile(storePath(name), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return typeof fallback === 'function' ? fallback() : fallback;
    throw err;
  }
}

/**
 * updateStore(name, fallback, mutator)
 * mutator(current) → next value (may be async). Returns the persisted value.
 */
function updateStore(name, fallback, mutator) {
  const prev = writeQueues.get(name) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      const current = await readStore(name, fallback);
      const updated = await mutator(current);
      await fs.mkdir(CONFIG.dataDir, { recursive: true });
      const tmp = storePath(name) + '.tmp';
      await fs.writeFile(tmp, JSON.stringify(updated, null, 2));
      await fs.rename(tmp, storePath(name));
      return updated;
    });
  writeQueues.set(name, next);
  return next;
}

module.exports = { readStore, updateStore, storePath };
