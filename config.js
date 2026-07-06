'use strict';

/**
 * Central configuration + site profile.
 * Everything is env-overridable with sensible defaults so the server
 * runs out of the box with `node server.js`.
 */

const path = require('path');

const CONFIG = {
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  dataDir: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),

  publicDirs: [
    process.env.PUBLIC_DIR,
    path.join(__dirname, '..', 'public'),
    path.join(__dirname, '..', '..'),
    path.join(__dirname, '..'),
  ].filter(Boolean),
  indexCandidates: ['index.html', 'portfolio.html'],

  corsOrigins: (process.env.CORS_ORIGINS || '*').split(',').map((s) => s.trim()),
  maxBodyBytes: Number(process.env.MAX_BODY_BYTES) || 32 * 1024,

  rateLimit: {
    windowMs: Number(process.env.RATE_WINDOW_MS) || 60 * 1000,
    max: Number(process.env.RATE_MAX) || 8,
  },

  adminToken: process.env.ADMIN_TOKEN || '',

  // Contact notifications (optional)
  resendApiKey: process.env.RESEND_API_KEY || '',
  contactTo: process.env.CONTACT_TO || '',
  contactFrom: process.env.CONTACT_FROM || 'Portfolio <onboarding@resend.dev>',
  webhookUrl: process.env.CONTACT_WEBHOOK_URL || '',

  // "Ask my AI" proxy (optional)
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  askModel: process.env.ASK_MODEL || 'claude-3-5-haiku-latest',

  // Privacy salt for hashing IPs in analytics
  ipSalt: process.env.IP_SALT || 'change-me-in-prod',

  // Guestbook: hold entries for manual approval, or publish immediately
  guestbookAutoApprove: process.env.GUESTBOOK_AUTO_APPROVE === 'true',
};

/**
 * Site profile — the single source of truth used by /api/ask (system
 * prompt), /api/vcard, /api/projects and SEO. Edit this to match reality.
 */
const PROFILE = {
  name: 'Nicholas Gearinger',
  title: 'AI Product Designer & Engineer',
  email: 'nicholasgearinger@gmail.com',
  location: 'San Francisco, CA',
  siteUrl: process.env.SITE_URL || 'https://nicholasgearinger.com',
  summary:
    'AI product designer and engineer with 5+ years shaping products at the ' +
    'edge of human and machine intelligence — generative interfaces, LLM ' +
    'products, design systems, and creative coding.',
  education: [
    { year: '2020', credential: "Bachelor's in Communications", org: 'Shepherd University' },
    { year: '2017', credential: "Associate's in Simulation & Digital Entertainment", org: 'Hagerstown Community College' },
  ],
  experience: [
    { period: '2022–Now', role: 'Senior AI Product Designer', org: 'Anthology Labs' },
    { period: '2020–2022', role: 'Product Designer, AI Platform', org: 'Northstar AI' },
    { period: '2018–2020', role: 'UX Engineer', org: 'Fieldwork Studio' },
  ],
  skills: [
    'Product & UI Design', 'Design Systems', 'Motion & Prototyping',
    'LLMs & Prompt Design', 'RAG & Fine-tuning', 'Model Evaluation',
    'Web Development', 'React / TypeScript', 'Three.js / WebGL', 'Python',
    'Art', '3D Modeling', 'Photography', 'Animation', 'Game Development',
  ],
  socials: {
    linkedin: 'https://www.linkedin.com/in/nicholasgearinger',
    github: 'https://github.com/nicholasgearinger',
    dribbble: 'https://dribbble.com/nicholasgearinger',
  },
};

/** Portfolio projects served by /api/projects (edit freely). */
const PROJECTS = [
  {
    id: 'sentient',
    title: 'Sentient — AI Operations Platform',
    tagline: 'Enterprise AI monitoring for 40M+ daily inferences',
    year: 2024,
    role: 'Lead Product Design',
    tags: ['Product Design', 'AI/ML', 'Data Viz', 'Enterprise UX'],
    featured: true,
  },
  {
    id: 'muse',
    title: 'Muse — Generative Creative Suite',
    tagline: 'Steer diffusion models by gesture and sketch',
    year: 2023,
    role: 'Design & Front-end',
    tags: ['Generative AI', 'Creative Tool', 'Canvas API'],
    featured: false,
  },
  {
    id: 'cortex',
    title: 'Cortex — Internal Knowledge Agent',
    tagline: 'RAG agent that cut research time to under 90s',
    year: 2022,
    role: 'Full-stack',
    tags: ['RAG', 'LLM', 'Full-stack'],
    featured: false,
  },
];

module.exports = { CONFIG, PROFILE, PROJECTS };
