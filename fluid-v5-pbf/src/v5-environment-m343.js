// Fluid V5 M3.4.5 supplied panorama environment loader.
// Day = user-supplied lake panorama, Sunset = user-supplied coastal sunset panorama,
// Night = true black equirectangular map. Assets are embedded as WebP modules so the
// raw.githack development preview has no external image-host dependency.

import { TIME_PRESETS } from './v5-light-presets.js';
import { DAY_ENV_WEBP_B64 } from './v5-env-day-asset-m345.js';
import { SUNSET_ENV_WEBP_B64 } from './v5-env-sunset-asset-m345.js';

const ssfr = window.__ssfr;
const lab = window.__v5LightLab;
const env = ssfr?.env;
if (!ssfr?.dev || !env?.load || !lab?.state) throw new Error('Fluid V5 M3.4.5 environment: runtime unavailable.');

const BLACK_ENV_WEBP_B64 = 'UklGRhYAAABXRUJQVlA4TAkAAAAvD8ABAIiI/gcA';
const cache = new Map();
let generation = 0;

window.__v5EnvironmentStatus = {
  online:false,
  stage:'idle',
  backend:'supplied-panorama-m345',
  mode:lab.state.time || 'day',
  error:'',
};

function fileFromBase64(b64, name) {
  const key = name;
  if (cache.has(key)) return cache.get(key);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const file = new File([bytes], name, { type:'image/webp' });
  cache.set(key, file);
  return file;
}

function envFile(mode) {
  if (mode === 'sunset') return fileFromBase64(SUNSET_ENV_WEBP_B64, 'fluid-v5-sunset-user-m345.webp');
  if (mode === 'night') return fileFromBase64(BLACK_ENV_WEBP_B64, 'fluid-v5-night-black-m345.webp');
  return fileFromBase64(DAY_ENV_WEBP_B64, 'fluid-v5-day-user-m345.webp');
}

function ensureStatusBadge() {
  const root = document.getElementById('v5LightLab');
  if (!root) return null;
  let el = document.getElementById('v5EnvironmentStatus');
  if (!el) {
    el = document.createElement('div');
    el.id = 'v5EnvironmentStatus';
    el.style.cssText = 'margin-top:9px;padding:8px 10px;border:1px solid rgba(78,214,220,.22);border-radius:10px;background:rgba(3,17,24,.55);font:700 8px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.045em;color:#9fc5d0;overflow-wrap:anywhere';
    root.appendChild(el);
  }
  return el;
}

function paintStatus() {
  const s = window.__v5EnvironmentStatus;
  const el = ensureStatusBadge();
  if (!el) return;
  let text, color;
  if (s.online) {
    const kind = s.mode === 'night' ? 'BLACK ENV' : 'USER PANORAMA';
    text = `ENVIRONMENT · ${String(s.mode).toUpperCase()} · ${kind} · READY`;
    color = '#9dffc8';
  } else if (s.stage === 'loading') {
    text = `ENVIRONMENT · ${String(s.mode).toUpperCase()} · LOADING…`;
    color = '#ffd890';
  } else {
    text = `ENVIRONMENT · FALLBACK · ${s.error || s.stage}`;
    color = '#ffaaaa';
  }
  if (el.textContent !== text) el.textContent = text;
  if (el.style.color !== color) el.style.color = color;
}

async function applyEnvironment(mode) {
  mode = TIME_PRESETS[mode] ? mode : 'day';
  const mood = TIME_PRESETS[mode];
  const token = ++generation;
  window.__v5EnvironmentStatus = {
    online:false, stage:'loading', backend:'supplied-panorama-m345', mode, error:''
  };
  paintStatus();

  // Avoid a previous bright map flashing while switching into Night.
  env.intensity = mode === 'night' ? 0.0 : Math.min(0.12, mood.envIntensity);
  try {
    const status = await env.load(envFile(mode));
    if (token !== generation) return;
    env.intensity = mood.envIntensity;
    env.yaw = mood.envYaw || 0;
    ssfr.bindCache = null;
    window.__v5EnvironmentStatus = {
      online:true, stage:'online', backend:'supplied-panorama-m345', mode, error:'', status
    };
    paintStatus();
  } catch (err) {
    if (token !== generation) return;
    // A failed Night load must stay dark rather than falling back to the inherited blue sky.
    env.intensity = mode === 'night' ? 0.0 : mood.envIntensity;
    window.__v5EnvironmentStatus = {
      online:false, stage:'rejected', backend:'supplied-panorama-m345', mode,
      error:String(err?.message || err)
    };
    paintStatus();
    console.error('[Fluid V5 M3.4.5 supplied environment]', err);
  }
}

window.addEventListener('fluid-v5-light-change', e => {
  const mode = e.detail?.timeOfDay || lab.state.time || 'day';
  setTimeout(() => { void applyEnvironment(mode); }, 0);
});

const observer = new MutationObserver(() => paintStatus());
const panel = document.getElementById('settingsPanel');
if (panel) observer.observe(panel, { childList:true, subtree:true });

void applyEnvironment(lab.state.time || 'day');
window.__v5Environment = { version:'M3.4.5', apply:applyEnvironment, backend:'supplied-panorama-m345' };
console.info('[Fluid V5 M3.4.5] supplied Day/Sunset panoramas + pure black Night environment enabled.');
