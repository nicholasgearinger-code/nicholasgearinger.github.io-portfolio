'use strict';

/**
 * Downloads & SEO, all generated on the fly from the profile in config.
 *  GET /api/vcard      → a .vcf contact card ("Save my contact")
 *  GET /api/resume     → structured JSON résumé
 *  GET /robots.txt     → robots file
 *  GET /sitemap.xml    → sitemap
 */

const { sendJson, sendText } = require('../lib/http');
const { PROFILE } = require('../lib/config');

function vcard(req, res) {
  const s = PROFILE.socials || {};
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${PROFILE.name.split(' ').reverse().join(';')};;;`,
    `FN:${PROFILE.name}`,
    `TITLE:${PROFILE.title}`,
    `EMAIL;TYPE=INTERNET:${PROFILE.email}`,
    `ADR;TYPE=WORK:;;${PROFILE.location};;;;`,
    `URL:${PROFILE.siteUrl}`,
    s.linkedin ? `X-SOCIALPROFILE;TYPE=linkedin:${s.linkedin}` : '',
    s.github ? `X-SOCIALPROFILE;TYPE=github:${s.github}` : '',
    `NOTE:${PROFILE.summary}`,
    'END:VCARD',
  ].filter(Boolean);
  const body = lines.join('\r\n');
  res.writeHead(200, {
    'Content-Type': 'text/vcard; charset=utf-8',
    'Content-Disposition': `attachment; filename="${PROFILE.name.replace(/\s+/g, '_')}.vcf"`,
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function resume(req, res) {
  sendJson(req, res, 200, {
    ok: true,
    resume: {
      name: PROFILE.name,
      title: PROFILE.title,
      location: PROFILE.location,
      email: PROFILE.email,
      summary: PROFILE.summary,
      education: PROFILE.education,
      experience: PROFILE.experience,
      skills: PROFILE.skills,
      links: PROFILE.socials,
    },
  });
}

function robots(req, res) {
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    `Sitemap: ${PROFILE.siteUrl.replace(/\/$/, '')}/sitemap.xml`,
  ].join('\n');
  sendText(req, res, 200, body, 'text/plain; charset=utf-8');
}

function sitemap(req, res) {
  const base = PROFILE.siteUrl.replace(/\/$/, '');
  const paths = ['/', '/#about', '/#resume', '/#work', '/#contact'];
  const today = new Date().toISOString().slice(0, 10);
  const urls = paths.map((p) =>
    `  <url><loc>${base}${p}</loc><lastmod>${today}</lastmod></url>`).join('\n');
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls + '\n</urlset>';
  sendText(req, res, 200, body, 'application/xml; charset=utf-8');
}

module.exports = { vcard, resume, robots, sitemap };
