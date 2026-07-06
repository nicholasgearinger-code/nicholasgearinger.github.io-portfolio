'use strict';

/**
 * POST /api/translate  { text, targetLanguage }  → { ok, translated, source }
 *
 * Deliberately separate from routes/ask.js — that endpoint's system prompt
 * is narrowly scoped to "answer questions about Nicholas from his résumé"
 * and explicitly told to decline anything off-topic, so it can't be reused
 * for general translation without confusing the model.
 *
 * Honest by design: without a real ANTHROPIC_API_KEY, there's no sensible
 * "canned" substitute for translating arbitrary text (unlike /api/ask,
 * which can fall back to real facts about Nicholas), so this returns a
 * clear ok:false explaining that AI translation isn't currently configured,
 * rather than pretending to translate with wrong or static output.
 */

const { sendJson, readBody, clean, hashIp, rateLimited } = require('../lib/http');
const { CONFIG } = require('../lib/config');

async function translate(req, res, ctx) {
  if (rateLimited('translate:' + hashIp(req), 10, 5 * 60 * 1000)) {
    return sendJson(req, res, 429, { ok: false, error: 'You have reached the translation limit — try again in a few minutes.' });
  }
  const body = ctx.body || (await readBody(req));
  const text = clean(body.text, 500);
  const targetLanguage = clean(body.targetLanguage, 40);
  if (text.length < 1) return sendJson(req, res, 422, { ok: false, error: 'Nothing to translate yet.' });
  if (!targetLanguage) return sendJson(req, res, 422, { ok: false, error: 'Pick a language first.' });

  if (!CONFIG.anthropicApiKey) {
    return sendJson(req, res, 200, {
      ok: false,
      error: 'AI translation isn\u2019t configured on this deployment right now (no API key set) \u2014 the rest of the demo still works.',
      source: 'unconfigured',
    });
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': CONFIG.anthropicApiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: CONFIG.askModel,
        max_tokens: 400,
        system: 'You are a precise translation engine. Translate the given text into ' + targetLanguage + '. Respond with ONLY the translated text — no explanation, no quotation marks, no commentary.',
        messages: [{ role: 'user', content: text }],
      }),
    });
    if (!r.ok) throw new Error('Upstream ' + r.status);
    const data = await r.json();
    const translated = (data.content || []).map((b) => b.text || '').join('').trim();
    if (!translated) throw new Error('Empty response');
    sendJson(req, res, 200, { ok: true, translated, source: 'ai' });
  } catch (err) {
    console.error('[translate]', err.message);
    sendJson(req, res, 200, { ok: false, error: 'The translation service is temporarily unavailable \u2014 try again in a moment.', source: 'error' });
  }
}

module.exports = { translate };
