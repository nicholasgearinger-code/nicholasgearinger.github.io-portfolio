'use strict';

/**
 * "Ask my AI" — a grounded assistant that answers questions about
 * Nicholas using the profile in config as context.
 *  POST /api/ask  { question }  → { answer }
 *
 * Proxies to Anthropic if ANTHROPIC_API_KEY is set (the key stays server
 * side — never exposed to the browser). Without a key it returns a
 * helpful canned reply so the feature still degrades gracefully.
 */

const { sendJson, readBody, clean, hashIp, rateLimited } = require('../lib/http');
const { CONFIG, PROFILE } = require('../lib/config');
const analytics = require('./analytics');

function systemPrompt() {
  const edu = PROFILE.education.map((e) => `${e.year} — ${e.credential}, ${e.org}`).join('; ');
  const exp = PROFILE.experience.map((e) => `${e.period} — ${e.role} at ${e.org}`).join('; ');
  return [
    `You are the friendly AI assistant on ${PROFILE.name}'s portfolio website.`,
    `Answer visitor questions about ${PROFILE.name} concisely (2-4 sentences), warmly, and only from the facts below.`,
    `If asked something not covered, say you're not sure and point them to the contact form.`,
    ``,
    `PROFILE`,
    `Name: ${PROFILE.name}`,
    `Title: ${PROFILE.title}`,
    `Location: ${PROFILE.location}`,
    `Summary: ${PROFILE.summary}`,
    `Education: ${edu}`,
    `Experience: ${exp}`,
    `Skills: ${PROFILE.skills.join(', ')}`,
    `Contact: ${PROFILE.email}`,
  ].join('\n');
}

function cannedAnswer(q) {
  const lc = q.toLowerCase();
  if (/skill|tech|stack|tool/.test(lc)) return `${PROFILE.name} works across ${PROFILE.skills.slice(0, 6).join(', ')} and more.`;
  if (/school|study|degree|educat/.test(lc)) {
    return PROFILE.education.map((e) => `${e.credential} (${e.org}, ${e.year})`).join('; ') + '.';
  }
  if (/experience|work|job|role|company/.test(lc)) {
    return PROFILE.experience.map((e) => `${e.role} at ${e.org} (${e.period})`).join('; ') + '.';
  }
  if (/contact|email|hire|reach/.test(lc)) return `You can reach ${PROFILE.name} at ${PROFILE.email}.`;
  if (/location|where|based/.test(lc)) return `${PROFILE.name} is based in ${PROFILE.location}.`;
  return `${PROFILE.summary} Ask about skills, experience, education, or how to get in touch.`;
}

async function ask(req, res, ctx) {
  if (rateLimited('ask:' + hashIp(req), 10, 5 * 60 * 1000)) {
    return sendJson(req, res, 429, { ok: false, error: 'You have reached the question limit — try again in a few minutes.' });
  }
  const body = ctx.body || (await readBody(req));
  const question = clean(body.question, 500);
  if (question.length < 3) return sendJson(req, res, 422, { ok: false, error: 'Please ask a question.' });

  analytics.record(req, 'ask', { meta: { len: question.length } }).catch(() => {});

  // No key → graceful canned reply.
  if (!CONFIG.anthropicApiKey) {
    return sendJson(req, res, 200, { ok: true, answer: cannedAnswer(question), source: 'canned' });
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
        max_tokens: 300,
        system: systemPrompt(),
        messages: [{ role: 'user', content: question }],
      }),
    });
    if (!r.ok) throw new Error('Upstream ' + r.status);
    const data = await r.json();
    const answer = (data.content || []).map((b) => b.text || '').join('').trim() || cannedAnswer(question);
    sendJson(req, res, 200, { ok: true, answer, source: 'ai' });
  } catch (err) {
    console.error('[ask]', err.message);
    sendJson(req, res, 200, { ok: true, answer: cannedAnswer(question), source: 'fallback' });
  }
}

module.exports = { ask };
