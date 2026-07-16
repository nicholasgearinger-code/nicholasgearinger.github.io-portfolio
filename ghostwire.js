
/* -- GHOSTWIRE: a small arcade game built with plain Canvas 2D — no
      engine, no external library. You're a hunter-process diving through a
      perspective data tunnel: obstacles and pickups spawn near a vanishing
      point and grow as they close in, rather than sliding down a flat 2D
      plane. Steer left-right to dodge "corrupted fragment" hazards and pull
      in "verified data" pickups. Difficulty (dive speed + spawn rate) ramps
      up the longer you survive, and the tunnel itself gets glitchier.
      Fully playable offline — only score submission and the leaderboard
      display need the backend. -- */
(function ghostwire() {
  const canvas = document.getElementById('game-canvas');
  const gameWrap = document.getElementById('game-wrap');
  // one listener covers every current and future button in the game
  // (settings, tabs, zone select, play/menu, pause, mute, fullscreen,
  // radio skip, quit, the gate button...) rather than wiring each
  // individually — all synthesized; the real success.mp3 sting is
  // reserved for achievement unlocks, see unlockAchievement()
  if (gameWrap) {
    gameWrap.addEventListener('click', (e) => {
      if (e.target.closest('button')) sfxUiClick();
    });
  }
  const overlay = document.getElementById('game-overlay');
  const titleSeqEl = document.getElementById('game-title-seq');
  const overlayMainEl = document.getElementById('game-overlay-main');
  const titleGateEl = document.getElementById('game-title-gate');
  const titleGateBtn = document.getElementById('game-title-gate-btn');
  const overlayTitle = document.getElementById('game-overlay-title');
  const overlaySub = document.getElementById('game-overlay-sub');
  const startBtn = document.getElementById('game-start-btn');
  const dailyBtn = document.getElementById('game-daily-btn');
  const dailyNoteEl = document.getElementById('game-daily-note');
  const scoreEntry = document.getElementById('game-score-entry');
  const nameInput = document.getElementById('game-name-input');
  const submitBtn = document.getElementById('game-submit-btn');
  const submitNote = document.getElementById('game-submit-note');
  const statEl = document.getElementById('game-stat');
  const bestStatEl = document.getElementById('game-best-stat');
  const pillText = document.getElementById('game-pill-text');
  const leaderboardList = document.getElementById('game-leaderboard-list');
  const fireBtn = document.getElementById('game-fire-btn');
  const gyroBtn = document.getElementById('game-gyro-btn');
  const gyroLabel = document.getElementById('game-gyro-label');
  const muteBtn = document.getElementById('game-mute-btn');
  const fullscreenBtn = document.getElementById('game-fullscreen-btn');
  const pauseBtn = document.getElementById('game-pause-btn');
  const ICON_PAUSE_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><rect x="6" y="5" width="4.2" height="14" rx="1"/><rect x="13.8" y="5" width="4.2" height="14" rx="1"/></svg>';
  const ICON_PLAY_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M7.5 4.5v15l13-7.5z"/></svg>';
  function setPauseIcon(showPlay) {
    if (pauseBtn) pauseBtn.innerHTML = showPlay ? ICON_PLAY_SVG : ICON_PAUSE_SVG;
  }
  const ICON_EXPAND_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>';
  const ICON_COLLAPSE_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4M15 4v5h5M15 20v-5h5M9 20v-5H4"/></svg>';
  function setFullscreenIcon(isFullscreen) {
    const iconEl = fullscreenBtn && fullscreenBtn.querySelector('.gfs-icon');
    if (iconEl) iconEl.innerHTML = isFullscreen ? ICON_COLLAPSE_SVG : ICON_EXPAND_SVG;
  }
  // Keeps the icon, the "Full Screen"/"Exit Full Screen" label text, the
  // aria-label, and the red gfs-active styling all in lockstep so none of
  // them can drift out of sync with each other.
  function setFullscreenActiveState(isFullscreen) {
    setFullscreenIcon(isFullscreen);
    if (!fullscreenBtn) return;
    fullscreenBtn.classList.toggle('gfs-active', isFullscreen);
    fullscreenBtn.setAttribute('aria-label', isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen');
    const labelEl = fullscreenBtn.querySelector('.gfs-label');
    if (labelEl) labelEl.textContent = isFullscreen ? 'Exit Full Screen' : 'Full Screen';
  }
  // labeled ("Full Screen") on the title screen / level-select / any other
  // pre- or post-run menu state; icon-only once a run is actually active,
  // since screen space matters more there and the icon's meaning is
  // already established by the time someone's mid-game.
  function syncFullscreenLabel() {
    if (fullscreenBtn) fullscreenBtn.classList.toggle('gfs-labeled', !running);
    if (gameWrap) gameWrap.classList.toggle('gw-fs-menu', !running);
  }
  const ICON_SOUND_ON_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.3 8.6a5 5 0 0 1 0 6.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M18.9 6.1a8.7 8.7 0 0 1 0 11.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity=".65"/></svg>';
  const ICON_SOUND_OFF_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M15.3 9.3l5 5.4M20.3 9.3l-5 5.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  function setMuteIcon(muted) {
    if (muteBtn) muteBtn.innerHTML = muted ? ICON_SOUND_OFF_SVG : ICON_SOUND_ON_SVG;
  }
  const ICON_X_SVG = '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const shareBtn = document.getElementById('game-share-btn');
  const statsDetailEl = document.getElementById('game-stats-detail');
  const quitBtn = document.getElementById('game-quit-btn');
  const quitBtnFs = document.getElementById('game-quit-fs-btn');
  const settingsBtn = document.getElementById('game-settings-btn');
  const settingsPanel = document.getElementById('game-settings-panel');
  const panelCloseBtn = document.getElementById('game-panel-close');
  const tabSettingsBtn = document.getElementById('gp-tab-settings');
  const tabAchvBtn = document.getElementById('gp-tab-achv');
  const tabStatsBtn = document.getElementById('gp-tab-stats');
  const settingsBody = document.getElementById('gp-body-settings');
  const achvBody = document.getElementById('gp-body-achv');
  const statsBody = document.getElementById('gp-body-stats');
  const statsListEl = document.getElementById('gp-stats-list');
  const hapticsCheck = document.getElementById('gp-haptics');
  const hapticsNote = document.getElementById('gp-haptics-note');
  const colorblindCheck = document.getElementById('gp-colorblind');
  const graphicsSeg = document.getElementById('gp-graphics');
  const difficultySeg = document.getElementById('gp-difficulty');
  const sfxVolSlider = document.getElementById('gp-sfx-vol');
  const musicVolSlider = document.getElementById('gp-music-vol');
  const achvListEl = document.getElementById('gp-achv-list');
  const gameMenuRoot = document.getElementById('game-menu-root');
  const gameMenuPlay = document.getElementById('game-menu-play');
  const gameMenuPlayBtn = document.getElementById('game-menu-play-btn');
  const gameMenuMenuBtn = document.getElementById('game-menu-menu-btn');
  const gameMenuRebootBtn = document.getElementById('game-menu-reboot-btn');
  const gameMenuBackBtn = document.getElementById('game-menu-back-btn');
  const achvCountEl = document.getElementById('gp-achv-count');
  if (!canvas || !startBtn) return;
  if (fireBtn) fireBtn.hidden = false;
  const DEFAULT_TITLE = overlayTitle.textContent;
  const DEFAULT_SUB = overlaySub.textContent;

  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const VP_X = W / 2, VP_Y = H * 0.24;         // vanishing point the tunnel dives from
  const PLAYER_W = 40, PLAYER_H = 24, PLAYER_Y = H - 40;   // near plane, where the player sits
  const MOVE_SPEED = 460;
  const MIN_SCALE = 0.1;                        // how small items are right at the vanishing point
  const REMOVE_P = 1.35;                        // progress past which a missed item is culled
  const RED_THREAT = 0.78;                      // threat level (0-1) at which the meter goes red and hits become lethal
  const HIT_INVULN = 0.9;                        // seconds of invulnerability after a non-lethal hit
  const THREAT_RISE_PER_SEC = 1 / 75;            // passive climb while you're not collecting anything
  const THREAT_RELIEF_PER_CATCH = 0.05;          // how much a clean catch pulls the meter back down
  const FIRE_COOLDOWN = 0.32;
  const PROJECTILE_SPEED = 2.0;                  // depth units/sec the shot travels toward the vanishing point
  const FIZZLE_DUR = 0.4;
  const GYRO_SENSITIVITY = 6.5;                  // px of steering per degree of tilt from the calibrated center

  const POWERUP_TYPES = ['rapid', 'magnet', 'shield', 'slow', 'score', 'overload'];
  const POWERUP_MIN = 9, POWERUP_MAX = 16;       // seconds between power-up spawns
  const RAPID_DURATION = 6, MAGNET_DURATION = 6, SHIELD_DURATION = 4.5;
  const SLOW_DURATION = 5, SLOW_FACTOR = 0.5;    // time-dilation power-up: halves fall speed of everything in-flight
  const SCORE_ORB_BONUS = 75;                     // instant score power-up payout
  const MAGNET_PULL = 3.2;
  const COMBO_STEP = 5, COMBO_MAX_MULT = 4;      // every 5-streak bumps the score multiplier, up to x4
  const SURGE_MIN = 22, SURGE_MAX = 32, SURGE_DURATION = 4;
  const FORMATION_MIN = 11, FORMATION_MAX = 19;  // seconds between spawned hazard "walls" with a gap to thread
  const CHARGE_MAX = 1.1, CHARGE_TAP_MAX = 0.16; // hold this long for a full charge; shorter releases fire a normal tap-shot
  const CHARGE_MAX_OVERCHARGED = 1.9;             // extended hold cap once the OVERCHARGE weapon is unlocked

  // -- meta-progression: weapon upgrades earned by reaching a level in any
  //    run, then kept forever across runs (stored alongside ghostwireBest).
  //    SPREAD upgrades the quick tap-shot, HOMING upgrades the charged shot,
  //    OVERCHARGE raises how far a charge can be held past CHARGE_MAX.
  const WEAPON_UNLOCK_LEVELS = { spread: 5, homing: 10, overcharge: 15 };
  const WEAPON_UNLOCK_LABEL = { spread: 'SPREAD SHOT UNLOCKED', homing: 'HOMING CHARGE UNLOCKED', overcharge: 'OVERCHARGE UNLOCKED' };
  const DRIFT_MIN_LEVEL = 3;                      // bad items start weaving laterally from this level on
  const SPLITTER_CHANCE_BASE = 0.12;              // chance a bad item (past DRIFT_MIN_LEVEL) is a splitter

  const CODE_TOKENS_BAD = ['0xFF', 'NaN', 'SEGV', 'ERR', 'null', '!=', 'undef', '0x00', 'panic!'];
  const CODE_TOKENS_GOOD = ['OK', '{ }', '=>', '200', 'ACK', '0x1A', 'sync', 'true'];
  const CODE_DRIFT_TOKENS = [
    'function scan()', 'const ptr =', 'while(true){', '} catch(e)', 'GC.mark()', 'ptr++;',
    '0b1010_1101', 'if (err)', 'return null;', 'async () =>', 'await fetch', 'heap[i] =',
    'stack.pop()', 'yield*', '0xC0FFEE', 'try {', 'segfault', 'let corrupt =', '!== undefined',
  ];
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

  const SKYLINE_KINDS = ['chip', 'capacitor', 'diode', 'resistor', 'antenna', 'tower', 'rack', 'girder'];
  // Each level era (violet/blue/green/yellow/orange/red, looping every 5
  // levels) now gets its own skyline silhouette mix, ring shape, and a
  // distinct backdrop overlay — not just a hue-rotate of the same shapes —
  // so the tunnel actually reads as a different "zone" per era, not just a
  // different color of the same zone. 'rack' (blinking server rack) and
  // 'girder' (industrial cross-braced beam) are dedicated to the server-farm
  // and hazard-zone eras so those two also get a shape found nowhere else.
  const ERA_SKYLINE_KINDS = [
    ['chip', 'capacitor', 'diode', 'resistor'],   // 0 violet — circuit board (original look)
    ['chip', 'antenna', 'tower'],                  // 1 blue — network/relay zone
    ['tower', 'antenna', 'rack'],                   // 2 green — server farm
    ['resistor', 'diode', 'girder'],                // 3 yellow — industrial/hazard zone
    ['tower', 'resistor', 'antenna'],               // 4 orange — reactor zone
    ['antenna', 'tower', 'diode'],                  // 5 red — critical/breach zone
  ];
  const ERA_RING_SHAPES = ['line', 'dashed', 'double', 'zigzag', 'dashed', 'double'];
  const ERA_OVERLAYS = ['none', 'grid', 'rain', 'stripes', 'embers', 'scanlines'];
  // Human-readable zone names shown on the HUD and flashed on transition —
  // gives each 5-level era an identity beyond just a color shift.
  const ERA_NAMES = ['GRID SECTOR', 'RELAY NETWORK', 'SERVER FARM', 'HAZARD ZONE', 'REACTOR CORE', 'BREACH ZONE'];
  function currentEraIdx() { return Math.floor(level / 5) % LEVEL_ERA_HUES.length; }
  function currentEraName() { return ERA_NAMES[currentEraIdx()]; }
  // The tunnel/skyline/circuit palette steps through a fixed 6-color era
  // every 5 levels — violet, blue, green, yellow, orange, red — then loops.
  // Each value is a hue-rotate offset (deg) from the scene's native violet
  // base (~270°) to that era's target hue: violet 270, blue 220, green 130,
  // yellow 55, orange 30, red 0.
  const LEVEL_ERA_HUES = [0, -50, -140, -215, -240, -270];
  function levelHueDeg() {
    const era = Math.floor(level / 5) % LEVEL_ERA_HUES.length;
    return LEVEL_ERA_HUES[era];
  }

  function projectPoint(lane, p) {
    return { x: VP_X + (lane - VP_X) * p, y: VP_Y + (PLAYER_Y - VP_Y) * p };
  }

  function generateCircuitTraces() {
    const traces = [];
    const count = 9;
    for (let i = 0; i < count; i++) {
      let lane = ((i + 0.5) / count) * W + (Math.random() - 0.5) * 30;
      let p = 0.04 + Math.random() * 0.08;
      const pts = [{ lane, p }];
      const segs = 3 + Math.floor(Math.random() * 3);
      for (let s = 0; s < segs; s++) {
        if (s % 2 === 0) {
          p = Math.min(0.98, p + 0.14 + Math.random() * 0.22);
        } else {
          lane = Math.max(20, Math.min(W - 20, lane + (Math.random() - 0.5) * 90));
        }
        pts.push({ lane, p });
      }
      traces.push({
        pts, phase: Math.random(), speed: 0.15 + Math.random() * 0.18,
        hue: Math.random() < 0.5 ? 'violet' : 'magenta',
      });
    }
    return traces;
  }

  // Perspective depth constant for the skyline: converts a true world-space
  // distance (z) into the tunnel's 0-1 screen-lerp parameter (p) using the
  // standard perspective divide p = D/(D+z), same shape as a real camera
  // projection. z shrinks at a CONSTANT rate (constant forward velocity),
  // so p — and therefore on-screen size/position — grows slowly while a
  // part is far out near the vanishing point and accelerates sharply as it
  // nears the player. That's what actually reads as "we're flying forward
  // into the skyline" rather than "the skyline is being fired at us": the
  // old system incremented p itself at a constant rate, which is constant
  // *apparent screen speed* the whole way — visually closer to objects
  // being conveyor-belted toward the camera than to forward motion through
  // a scene.
  const SKYLINE_PERSPECTIVE_D = 1.6;
  const SKYLINE_Z_FAR = 10;   // spawn distance
  const SKYLINE_Z_NEAR = 0.1; // despawn distance (right at the player plane)
  function skylineZtoP(z) { return SKYLINE_PERSPECTIVE_D / (SKYLINE_PERSPECTIVE_D + z); }

  function generateSkyline() {
    // A distant "skyline" flanking the tunnel — silhouettes shaped like
    // circuit components (chip packages, capacitors, diodes, resistors)
    // instead of buildings, drifting past on both sides. Density roughly
    // doubled (16 -> 34) so the backdrop reads as a dense, layered scene
    // instead of a handful of sparse shapes — makes each era's silhouette
    // mix (rack/girder/tower/etc) actually register as a skyline.
    const parts = [];
    const count = 34;
    for (let i = 0; i < count; i++) {
      parts.push({
        side: i % 2 === 0 ? -1 : 1,
        laneOffset: 1.4 + Math.random() * 2.6,   // lane-widths out from center beyond the play field
        z: SKYLINE_Z_NEAR + Math.random() * (SKYLINE_Z_FAR - SKYLINE_Z_NEAR), // true depth, staggered so parts aren't all in lockstep
        speed: 0.55 + Math.random() * 0.5,        // world-space closing speed (z units/sec, scaled by difficulty at update time)
        kind: pick(ERA_SKYLINE_KINDS[currentEraIdx()]),
        scale: 0.7 + Math.random() * 0.9,
        seed: Math.random() * 1000,
      });
    }
    return parts;
  }

  function generateStarfield() {
    // A faint parallax star layer behind the tunnel for extra depth —
    // drifts slowly downward and wraps, twinkling with tunnelHue.
    const arr = [];
    const count = 34;
    for (let i = 0; i < count; i++) {
      arr.push({
        x: Math.random() * W, y: Math.random() * H * 0.9,
        r: 0.5 + Math.random() * 1.3,
        depth: 0.15 + Math.random() * 0.5,
        seed: Math.random() * 1000,
      });
    }
    return arr;
  }

  function pointAlongTrace(trace, t) {
    const segCount = trace.pts.length - 1;
    const segT = Math.max(0, Math.min(0.9999, t)) * segCount;
    const idx = Math.min(segCount - 1, Math.floor(segT));
    const localT = segT - idx;
    const a = trace.pts[idx], b = trace.pts[idx + 1];
    return projectPoint(a.lane + (b.lane - a.lane) * localT, a.p + (b.p - a.p) * localT);
  }


  function randRange(a, b) { return a + Math.random() * (b - a); }
  // -- DAILY CHALLENGE: same obstacle sequence for every player on a given
  //    day. Rather than threading a seeded generator through every one of
  //    the ~66 existing Math.random() call sites, this temporarily swaps
  //    out Math.random itself for a seeded one for the run's duration —
  //    every spawn/particle/drift call already in the codebase becomes
  //    deterministic for free, and normal (non-daily) runs are completely
  //    unaffected since the swap is reverted the moment the run ends.
  const _nativeMathRandom = Math.random.bind(Math);
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seedFromString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    return h;
  }
  function todaySeedString() {
    const d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  let isDailyChallenge = false;
  function enableDailySeed() { Math.random = mulberry32(seedFromString(todaySeedString())); }
  function disableDailySeed() { Math.random = _nativeMathRandom; }
  let dailyBest = 0;
  try { dailyBest = parseInt(localStorage.getItem('ghostwireDailyBest_' + todaySeedString()) || '0', 10) || 0; } catch (_) {}
  function saveDailyBest(s) {
    dailyBest = s;
    try { localStorage.setItem('ghostwireDailyBest_' + todaySeedString(), String(s)); } catch (_) {}
  }

  // Interpolates an "r,g,b" string between a calm/cool color and a
  // danger/warm color, driven by threat (0 = safe, 1 = critical) — used to
  // shift the tunnel background and circuit traces from violet/blue/cyan
  // toward orange/red as speed and difficulty ramp up.
  function lerpColorStr(cool, warm, t) {
    t = Math.max(0, Math.min(1, t));
    const r = Math.round(cool[0] + (warm[0] - cool[0]) * t);
    const g = Math.round(cool[1] + (warm[1] - cool[1]) * t);
    const b = Math.round(cool[2] + (warm[2] - cool[2]) * t);
    return r + ',' + g + ',' + b;
  }

  // Manual RGB->HSL->RGB hue rotation. We used to lean on ctx.filter =
  // 'hue-rotate(...)' for the level-era color shift, but canvas 2D `filter`
  // support is flaky on iOS Safari (silently does nothing on some versions
  // rather than throwing), so the effect was invisible on a real iPhone even
  // though the level/era math was correct. Rotating the actual RGB values
  // ourselves works everywhere.
  function rotateHueRGB(rgb, deg) {
    if (!deg) return rgb;
    let [r, g, b] = [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    h = ((h * 360 + deg) % 360 + 360) % 360 / 360;
    function hue2rgb(p, q, t) {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    let r2, g2, b2;
    if (s === 0) { r2 = g2 = b2 = l; }
    else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r2 = hue2rgb(p, q, h + 1 / 3);
      g2 = hue2rgb(p, q, h);
      b2 = hue2rgb(p, q, h - 1 / 3);
    }
    return [Math.round(r2 * 255), Math.round(g2 * 255), Math.round(b2 * 255)];
  }
  // Rotates a base RGB triple by the current level era's hue offset.
  function eraRGB(rgb) { return rotateHueRGB(rgb, levelHueDeg()); }

  let playerX = W / 2, targetX = playerX, playerVX = 0;
  let items = [], particles = [], codeBits = [], projectiles = [], fizzles = [];
  let powerups = [], floatTexts = [], shockwaves = [];
  let score = 0, running = false, dying = false, deathTimer = 0, rafId = null, lastTime = 0;
  let idleRafId = null, idleLastTime = 0; // "attract mode" loop — keeps the tunnel drifting behind the title/menu screens instead of sitting on one static frame
  let spawnTimer = 0, codeBitTimer = 0, elapsed = 0, difficulty = 1, level = 1;
  let shakeMag = 0, flash = 0, tunnelHue = 0, threat = 0;
  let streak = 0, invulnTimer = 0, fireTimer = 0;
  let rapidTimer = 0, magnetTimer = 0, shieldTimer = 0, slowTimer = 0, powerupTimer = randRange(POWERUP_MIN, POWERUP_MAX);
  let overloadReady = false;
  let surging = false, surgeCountdown = randRange(SURGE_MIN, SURGE_MAX), surgeElapsed = 0, surgeCount = 0;
  let bossTierSpawned = -1;   // last level-tier (floor(level/5)) a milestone boss was already spawned for
  let wormToggle = false;     // alternates worm/firewall on successive tier-boss spawns
  // weapon unlocks persist across runs, same storage pattern as ghostwireBest
  let unlocks = { spread: false, homing: false, overcharge: false };
  try {
    const saved = JSON.parse(localStorage.getItem('ghostwireUnlocks') || '{}');
    unlocks.spread = !!saved.spread; unlocks.homing = !!saved.homing; unlocks.overcharge = !!saved.overcharge;
  } catch (_) { /* corrupt/missing storage — start with nothing unlocked */ }
  function saveUnlocks() {
    try { localStorage.setItem('ghostwireUnlocks', JSON.stringify(unlocks)); } catch (_) {}
  }
  function checkWeaponUnlocks() {
    Object.keys(WEAPON_UNLOCK_LEVELS).forEach((key) => {
      if (!unlocks[key] && level >= WEAPON_UNLOCK_LEVELS[key]) {
        unlocks[key] = true;
        saveUnlocks();
        spawnFloatText(W / 2, VP_Y + 100, '\u2605 ' + WEAPON_UNLOCK_LABEL[key], '#F59E0B');
        shakeMag = Math.max(shakeMag, 8);
        haptic([20, 40, 20]);
        sfxPowerup();
        if (unlocks.spread && unlocks.homing && unlocks.overcharge) unlockAchievement('fully_loaded');
      }
    });
  }
  let gyroEnabled = false, gyroNeutral = null, gyroX = null;
  window.__TILT_DEBUG = false; // diagnostic done — normal compact "TILT" label restored
  let soundOn = true;
  let paused = false;
  let charging = false, chargeTimer = 0;
  let eraFlashTimer = 0, currentEra = 0;
  let pendingZone = 0;   // which of the 6 level-eras the next run should start in — set by the zone-select buttons
  let formationTimer = randRange(FORMATION_MIN, FORMATION_MAX);
  let playerTrail = [];
  let stars = generateStarfield();
  let longestStreak = 0, shotsFired = 0, shotsHit = 0, hitsThisRun = 0;
  // -- GHOST REPLAY: samples steering position every 100ms through a run;
  //    if it beats the saved best for that zone, it's persisted and
  //    played back (as a translucent echo, not a full simulation) the
  //    next time that zone is played.
  let ghostRecording = [], ghostRecordTimer = 0;
  let ghostPlayback = null, ghostPlaybackScore = 0;
  function loadGhostForZone(zoneIdx) {
    try {
      const raw = localStorage.getItem('ghostwireGhost_' + zoneIdx);
      if (!raw) { ghostPlayback = null; return; }
      const parsed = JSON.parse(raw);
      ghostPlayback = parsed.samples || null;
      ghostPlaybackScore = parsed.score || 0;
    } catch (_) { ghostPlayback = null; }
  }
  function saveGhostIfBest(zoneIdx, finalScore, samples) {
    try {
      const raw = localStorage.getItem('ghostwireGhost_' + zoneIdx);
      const prevScore = raw ? (JSON.parse(raw).score || 0) : 0;
      if (finalScore > prevScore && samples.length > 2) {
        localStorage.setItem('ghostwireGhost_' + zoneIdx, JSON.stringify({ score: finalScore, samples }));
      }
    } catch (_) {}
  }
  function ghostXAtElapsed(t) {
    if (!ghostPlayback || !ghostPlayback.length) return null;
    if (t <= ghostPlayback[0][0]) return ghostPlayback[0][1];
    const last = ghostPlayback[ghostPlayback.length - 1];
    if (t >= last[0]) return null; // ghost run ended before this point — fade out
    for (let i = 1; i < ghostPlayback.length; i++) {
      if (ghostPlayback[i][0] >= t) {
        const a = ghostPlayback[i - 1], b = ghostPlayback[i];
        const span = b[0] - a[0];
        const f = span > 0 ? (t - a[0]) / span : 0;
        return a[1] + (b[1] - a[1]) * f;
      }
    }
    return null;
  }
  let circuitTraces = generateCircuitTraces();
  let skylineParts = generateSkyline();
  let best = parseInt(localStorage.getItem('ghostwireBest') || '0', 10);
  bestStatEl.innerHTML = 'best: <strong>' + best + '</strong>';

  // -- settings: haptics / colorblind-safe palette / graphics quality /
  //    difficulty / volume — persisted alongside the existing
  //    ghostwireBest/ghostwireUnlocks keys.
  let settings = { haptics: true, colorblind: false, graphics: 'auto', difficulty: 'normal', sfxVolume: 1, musicVolume: 1 };
  try {
    const savedSettings = JSON.parse(localStorage.getItem('ghostwireSettings') || '{}');
    if (typeof savedSettings.haptics === 'boolean') settings.haptics = savedSettings.haptics;
    if (typeof savedSettings.colorblind === 'boolean') settings.colorblind = savedSettings.colorblind;
    if (['auto', 'high', 'low'].includes(savedSettings.graphics)) settings.graphics = savedSettings.graphics;
    if (['easy', 'normal', 'hard'].includes(savedSettings.difficulty)) settings.difficulty = savedSettings.difficulty;
    if (typeof savedSettings.sfxVolume === 'number') settings.sfxVolume = Math.min(1, Math.max(0, savedSettings.sfxVolume));
    if (typeof savedSettings.musicVolume === 'number') settings.musicVolume = Math.min(1, Math.max(0, savedSettings.musicVolume));
  } catch (_) { /* corrupt/missing storage — defaults above stand */ }
  function saveSettings() { try { localStorage.setItem('ghostwireSettings', JSON.stringify(settings)); } catch (_) {} }
  // difficulty scales the threat-rise rate and spawn cadence — applied at
  // the two single choke points that already drive that pacing
  const DIFFICULTY_MULT = { easy: 0.7, normal: 1, hard: 1.4 };
  function difficultyThreatMult() { return DIFFICULTY_MULT[settings.difficulty] || 1; }
  function difficultySpawnMult() { return DIFFICULTY_MULT[settings.difficulty] || 1; }

  function haptic(pattern) {
    if (!settings.haptics || !navigator.vibrate) return;
    try { navigator.vibrate(pattern); } catch (_) {}
  }

  // "bad" red swaps to an amber that reads more distinctly than red/cyan
  // does under protanopia/deuteranopia; "good" cyan is left alone since
  // it's already a safe pairing against red.
  let COL_BAD = '#F87171';
  function applyColorblind() {
    COL_BAD = settings.colorblind ? '#FB923C' : '#F87171';
    if (gameWrap) gameWrap.classList.toggle('cb-safe', settings.colorblind);
  }

  // 'auto' guesses low-end from core count / reduced-motion; particle count
  // and screen-shake magnitude both scale off this single multiplier so any
  // future effect can opt in by reading PARTICLE_SCALE / SHAKE_SCALE.
  let PARTICLE_SCALE = 1, SHAKE_SCALE = 1;
  function effectiveGraphics() {
    if (settings.graphics !== 'auto') return settings.graphics;
    const lowEnd = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4)
      || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    return lowEnd ? 'low' : 'high';
  }
  function applyGraphics() {
    const g = effectiveGraphics();
    PARTICLE_SCALE = g === 'low' ? 0.35 : 1;
    SHAKE_SCALE = g === 'low' ? 0.4 : 1;
  }
  applyColorblind();
  applyGraphics();

  // -- achievements: persisted unlock map + definitions used by both the
  //    in-canvas unlock toast and the achievements tab in the settings panel.
  const ACHIEVEMENT_DEFS = [
    { id: 'first_purge', label: 'First Purge', desc: 'Fizzle your first corrupted fragment.' },
    { id: 'boss_slayer', label: 'Boss Slayer', desc: 'Take down a FIREWALL or WORM mini-boss.' },
    { id: 'clean_run', label: 'Clean Sweep', desc: 'Reach level 5 without taking a hit.' },
    { id: 'streak_20', label: 'On a Roll', desc: 'Build a 20-catch streak in one run.' },
    { id: 'fully_loaded', label: 'Fully Loaded', desc: 'Unlock all three weapon upgrades.' },
    { id: 'deep_diver', label: 'Deep Diver', desc: 'Reach level 20 in a single run.' },
    { id: 'sharpshooter', label: 'Sharpshooter', desc: 'Finish a run with 90%+ accuracy (20+ shots fired).' },
    { id: 'six_zones', label: 'Zone Explorer', desc: 'Start a run from all six zones at least once.' },
  ];
  let achievements = {};
  try { achievements = JSON.parse(localStorage.getItem('ghostwireAchievements') || '{}'); } catch (_) {}
  function saveAchievements() { try { localStorage.setItem('ghostwireAchievements', JSON.stringify(achievements)); } catch (_) {} }
  let visitedZones = [];
  try { visitedZones = JSON.parse(localStorage.getItem('ghostwireZones') || '[]'); } catch (_) {}
  function saveVisitedZones() { try { localStorage.setItem('ghostwireZones', JSON.stringify(visitedZones)); } catch (_) {} }
  // -- STORY MODE: zones unlock in order as the player actually reaches
  //    them, rather than all being selectable from the start. A zone's
  //    "start level" (1/6/11/16/21/26) doubles as its unlock threshold.
  const ZONE_START_LEVELS = [1, 6, 11, 16, 21, 26];
  let highestLevelReached = 1;
  try { highestLevelReached = parseInt(localStorage.getItem('ghostwireProgress') || '1', 10) || 1; } catch (_) {}
  function saveProgress() { try { localStorage.setItem('ghostwireProgress', String(highestLevelReached)); } catch (_) {} }
  function isZoneUnlocked(zoneIdx) { return highestLevelReached >= ZONE_START_LEVELS[zoneIdx]; }
  function frontierZoneIdx() {
    let idx = 0;
    for (let i = 0; i < ZONE_START_LEVELS.length; i++) if (isZoneUnlocked(i)) idx = i;
    return idx;
  }
  function unlockAchievement(id) {
    if (achievements[id]) return;
    achievements[id] = true;
    saveAchievements();
    const def = ACHIEVEMENT_DEFS.find((d) => d.id === id);
    if (def) {
      spawnFloatText(W / 2, VP_Y + 130, '\u2605 ACHIEVEMENT: ' + def.label.toUpperCase(), '#FBBF24');
      haptic([20, 40, 20, 40, 20]);
      playClickSfx();
    }
    const newTracks = tracksUnlockedByAchievement(id);
    if (newTracks.length) {
      setTimeout(() => {
        spawnFloatText(W / 2, VP_Y + 155, '\u266A UNLOCKED: ' + newTracks.map((t) => t.title).join(', '), '#22D3EE');
      }, 260); // stagger after the achievement toast so they don't overlap
    }
    if (achvBody && !achvBody.hidden) renderAchievements();
  }
  function renderAchievements() {
    if (!achvListEl) return;
    const unlockedCount = ACHIEVEMENT_DEFS.filter((d) => achievements[d.id]).length;
    if (achvCountEl) achvCountEl.textContent = unlockedCount + '/' + ACHIEVEMENT_DEFS.length;
    achvListEl.innerHTML = ACHIEVEMENT_DEFS.map((d) => {
      const unlocked = !!achievements[d.id];
      const tracks = tracksUnlockedByAchievement(d.id);
      const trackNote = tracks.length
        ? '<span class="gp-achv-unlock">\u266A Unlocks: ' + tracks.map((t) => escapeHtml(t.title)).join(', ') + '</span>'
        : '';
      return '<li class="gp-achv' + (unlocked ? ' unlocked' : '') + '">'
        + '<span class="gp-achv-ico">' + (unlocked ? '\u2605' : '\u25CB') + '</span>'
        + '<span class="gp-achv-text"><strong>' + escapeHtml(d.label) + '</strong><br>' + escapeHtml(d.desc) + trackNote + '</span>'
        + '</li>';
    }).join('');
  }

  function syncSettingsUI() {
    if (hapticsCheck) hapticsCheck.checked = settings.haptics;
    if (hapticsNote && !navigator.vibrate) {
      hapticsNote.hidden = false;
      hapticsCheck.disabled = true;
    }
    if (colorblindCheck) colorblindCheck.checked = settings.colorblind;
    if (graphicsSeg) {
      graphicsSeg.querySelectorAll('.gp-seg-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.val === settings.graphics);
      });
    }
    if (difficultySeg) {
      difficultySeg.querySelectorAll('.gp-seg-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.val === settings.difficulty);
      });
    }
    if (sfxVolSlider) sfxVolSlider.value = Math.round(settings.sfxVolume * 100);
    if (musicVolSlider) musicVolSlider.value = Math.round(settings.musicVolume * 100);
  }
  function showSettingsTab(tab) {
    if (tabSettingsBtn) tabSettingsBtn.classList.toggle('active', tab === 'settings');
    if (tabAchvBtn) tabAchvBtn.classList.toggle('active', tab === 'achv');
    if (tabStatsBtn) tabStatsBtn.classList.toggle('active', tab === 'stats');
    if (settingsBody) settingsBody.hidden = tab !== 'settings';
    if (achvBody) achvBody.hidden = tab !== 'achv';
    if (statsBody) statsBody.hidden = tab !== 'stats';
    if (tab === 'achv') renderAchievements();
    if (tab === 'stats') renderStats();
  }
  function openSettingsPanel(tab) {
    if (!settingsPanel) return;
    settingsPanel.hidden = false;
    showSettingsTab(tab || 'settings');
    if (running && !paused) togglePause();
  }
  function closeSettingsPanel() { if (settingsPanel) settingsPanel.hidden = true; }
  if (settingsBtn) settingsBtn.addEventListener('click', () => openSettingsPanel('settings'));
  if (panelCloseBtn) panelCloseBtn.addEventListener('click', closeSettingsPanel);
  if (tabSettingsBtn) tabSettingsBtn.addEventListener('click', () => showSettingsTab('settings'));
  if (tabAchvBtn) tabAchvBtn.addEventListener('click', () => showSettingsTab('achv'));
  if (tabStatsBtn) tabStatsBtn.addEventListener('click', () => showSettingsTab('stats'));
  function renderStats() {
    if (!statsListEl) return;
    const achvCount = ACHIEVEMENT_DEFS.filter((d) => achievements[d.id]).length;
    const weaponCount = Object.values(unlocks).filter(Boolean).length;
    const trackCount = unlockedTrackIndices().length;
    const rows = [
      ['Best score', best.toLocaleString()],
      ['Achievements', achvCount + ' / ' + ACHIEVEMENT_DEFS.length],
      ['Weapons unlocked', weaponCount + ' / 3'],
      ['Tracks unlocked', trackCount + ' / ' + RADIO_TRACKS.length],
      ['Zones visited', visitedZones.length + ' / 6'],
    ];
    statsListEl.innerHTML = rows.map(([label, val]) =>
      '<li class="gp-stat-row"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(String(val)) + '</strong></li>'
    ).join('');
  }
  function fadeReveal(el) {
    if (!el) return;
    el.hidden = false;
    el.classList.remove('is-visible');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-visible')));
  }
  function fadeHide(el, andThen) {
    if (!el) { if (andThen) andThen(); return; }
    el.classList.remove('is-visible');
    setTimeout(() => { el.hidden = true; if (andThen) andThen(); }, 350);
  }
  if (titleGateBtn) {
    titleGateBtn.addEventListener('click', () => {
      unlockMenuMusic();
      if (titleGateEl) {
        titleGateEl.classList.add('fading-out');
        setTimeout(() => { titleGateEl.hidden = true; }, 350);
      }
      playInitialTitleCard();
    });
  }
  if (gameMenuPlayBtn) {
    gameMenuPlayBtn.addEventListener('click', () => {
      if (titleSeqEl) {
        titleSeqEl.classList.add('fading-out');
        setTimeout(() => {
          titleSeqEl.hidden = true;
          titleSeqEl.classList.remove('fading-out');
          fadeReveal(overlayMainEl);
          fadeReveal(gameMenuPlay);
        }, 350);
      } else {
        fadeReveal(overlayMainEl);
        fadeReveal(gameMenuPlay);
      }
    });
  }
  if (gameMenuBackBtn) {
    gameMenuBackBtn.addEventListener('click', () => {
      overlayMainEl && overlayMainEl.classList.remove('is-visible');
      gameMenuPlay && gameMenuPlay.classList.remove('is-visible');
      setTimeout(() => {
        if (overlayMainEl) overlayMainEl.hidden = true;
        if (gameMenuPlay) gameMenuPlay.hidden = true;
        if (titleSeqEl) titleSeqEl.hidden = false;
        fadeReveal(gameMenuRoot);
      }, 350);
    });
  }
  if (gameMenuMenuBtn) gameMenuMenuBtn.addEventListener('click', () => openSettingsPanel('settings'));
  if (gameMenuRebootBtn) {
    gameMenuRebootBtn.addEventListener('click', () => {
      stopMenuMusic();
      titleSeqEl && titleSeqEl.classList.add('fading-out');
      gameMenuRoot && gameMenuRoot.classList.remove('is-visible');
      setTimeout(() => {
        if (titleSeqEl) { titleSeqEl.hidden = true; titleSeqEl.classList.remove('fading-out'); }
        if (gameMenuRoot) gameMenuRoot.hidden = true;
        if (titleGateEl) {
          titleGateEl.hidden = false;
          titleGateEl.classList.remove('fading-out');
          loopGateWordDecode();
        }
      }, 350);
    });
  }
  if (hapticsCheck) {
    hapticsCheck.addEventListener('change', () => {
      settings.haptics = hapticsCheck.checked;
      saveSettings();
      if (settings.haptics) haptic(15);
    });
  }
  if (colorblindCheck) {
    colorblindCheck.addEventListener('change', () => {
      settings.colorblind = colorblindCheck.checked;
      saveSettings();
      applyColorblind();
    });
  }
  if (graphicsSeg) {
    graphicsSeg.querySelectorAll('.gp-seg-btn').forEach((b) => {
      b.addEventListener('click', () => {
        settings.graphics = b.dataset.val;
        saveSettings();
        applyGraphics();
        syncSettingsUI();
      });
    });
  }
  if (difficultySeg) {
    difficultySeg.querySelectorAll('.gp-seg-btn').forEach((b) => {
      b.addEventListener('click', () => {
        settings.difficulty = b.dataset.val;
        saveSettings();
        syncSettingsUI();
      });
    });
  }
  if (sfxVolSlider) {
    sfxVolSlider.addEventListener('input', () => {
      settings.sfxVolume = Number(sfxVolSlider.value) / 100;
      saveSettings();
    });
  }
  if (musicVolSlider) {
    musicVolSlider.addEventListener('input', () => {
      settings.musicVolume = Number(musicVolSlider.value) / 100;
      saveSettings();
      if (gwMenuMusicEl) gwMenuMusicEl.volume = MENU_MUSIC_VOL * settings.musicVolume;
      if (radioAudioEl) radioAudioEl.volume = 0.5 * settings.musicVolume;
    });
  }
  syncSettingsUI();

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function reset() {
    items = []; particles = []; codeBits = []; projectiles = []; fizzles = [];
    powerups = []; floatTexts = []; shockwaves = [];
    // Starting point follows the zone-select buttons: zone 0 is the normal
    // level-1 start, zones 1-5 drop the player straight into that era (each
    // era spans 5 levels / ~100s of elapsed time, mirroring the level/era
    // formulas used during normal play) so difficulty and hue land correctly
    // from frame one instead of needing to be played up to. Story mode:
    // selecting your current frontier zone continues exactly from your
    // furthest level reached rather than restarting that zone from level 1.
    const isContinuing = pendingZone === frontierZoneIdx() && highestLevelReached > ZONE_START_LEVELS[pendingZone];
    level = isContinuing ? highestLevelReached : 1 + pendingZone * 5;
    elapsed = (level - 1) * 20;
    score = 0; difficulty = 1; threat = 0;
    spawnTimer = 0; codeBitTimer = 0; fireTimer = 0;
    playerX = W / 2; targetX = playerX; playerVX = 0;
    shakeMag = 0; flash = 0; dying = false; deathTimer = 0;
    streak = 0; invulnTimer = 0; hitsThisRun = 0;
    ghostRecording = []; ghostRecordTimer = 0;
    loadGhostForZone(pendingZone);
    if (!visitedZones.includes(pendingZone)) {
      visitedZones.push(pendingZone);
      saveVisitedZones();
      if (visitedZones.length >= 6) unlockAchievement('six_zones');
    }
    rapidTimer = 0; magnetTimer = 0; shieldTimer = 0; slowTimer = 0; powerupTimer = randRange(POWERUP_MIN, POWERUP_MAX);
    overloadReady = false; bossTierSpawned = -1; wormToggle = false;
    surging = false; surgeCountdown = randRange(SURGE_MIN, SURGE_MAX); surgeElapsed = 0; surgeCount = 0;
    paused = false; charging = false; chargeTimer = 0;
    eraFlashTimer = 0; currentEra = pendingZone;
    formationTimer = randRange(FORMATION_MIN, FORMATION_MAX);
    playerTrail = [];
    longestStreak = 0; shotsFired = 0; shotsHit = 0;
    circuitTraces = generateCircuitTraces();
    skylineParts = generateSkyline();
    statEl.innerHTML = 'score: <strong>0</strong>';
  }

  function spawnItem() {
    const isGood = Math.random() < 0.55;
    // Bad (red/corrupted) items ease in even slower than the general
    // difficulty ramp — starts at 30% speed, full speed by ~16s — so new
    // players get more reaction time on hazards specifically, while good
    // items are dodging/collecting practice from the start.
    const badRamp = isGood ? 1 : Math.min(1, 0.3 + elapsed / 16);
    // From DRIFT_MIN_LEVEL on, some bad fragments weave laterally instead of
    // falling straight down their lane, and a slice of those are "splitters"
    // that fizzle into smaller fast fragments instead of just disappearing.
    const canDrift = !isGood && level >= DRIFT_MIN_LEVEL;
    const drifting = canDrift && Math.random() < 0.35;
    const splitter = canDrift && !drifting && Math.random() < SPLITTER_CHANCE_BASE;
    items.push({
      lane: 24 + Math.random() * (W - 48),   // x position once it reaches the near plane
      baseLane: 0,                            // set below once lane is known — drift center
      z: 1,                                   // 1 = at the vanishing point, 0 = at the player
      baseR: isGood ? 10 : (splitter ? 13 : 15),
      type: isGood ? 'good' : 'bad',
      token: isGood ? pick(CODE_TOKENS_GOOD) : pick(CODE_TOKENS_BAD),
      vz: (isGood ? 0.46 : 0.54 * badRamp) * difficulty * (surging ? 1.18 : 1),
      spin: (Math.random() - 0.5) * 3,
      seed: Math.random() * 1000,
      x: VP_X, y: VP_Y, r: 1, glitchT: 0,
      drift: drifting, driftAmp: drifting ? 30 + Math.random() * 40 : 0,
      driftFreq: drifting ? 1.2 + Math.random() * 1.4 : 0,
      splitter, mini: false,
    });
    items[items.length - 1].baseLane = items[items.length - 1].lane;
  }

  function spawnCodeBit() {
    codeBits.push({
      lane: 10 + Math.random() * (W - 20),
      p: 0,
      vp: 0.16 + Math.random() * 0.1,
      token: pick(CODE_DRIFT_TOKENS),
      hue: Math.random() < 0.5 ? 'violet' : 'magenta',
    });
  }

  function spawnPowerup(forceType) {
    powerups.push({
      lane: 40 + Math.random() * (W - 80),
      z: 1,
      baseR: 13,
      type: forceType || pick(POWERUP_TYPES),
      vz: 0.4 * difficulty,
      seed: Math.random() * 1000,
      x: VP_X, y: VP_Y, r: 1,
    });
  }

  function spawnFormation() {
    // A hazard "wall" — several corrupted fragments spanning the lanes at
    // once with exactly one gap, so the player has to thread it rather
    // than just dodge a single item.
    const slots = 4;
    const gapLane = Math.floor(Math.random() * slots);
    const margin = 30;
    const usable = W - margin * 2;
    const vz = 0.48 * difficulty;
    for (let s = 0; s < slots; s++) {
      if (s === gapLane) continue;
      const lane = margin + (s + 0.5) * (usable / slots);
      items.push({
        lane, z: 1, baseR: 13, type: 'bad', token: pick(CODE_TOKENS_BAD),
        vz, spin: (Math.random() - 0.5) * 3, seed: Math.random() * 1000,
        x: VP_X, y: VP_Y, r: 1, glitchT: 0,
      });
    }
    spawnFloatText(W / 2, VP_Y + 50, 'WALL DETECTED', COL_BAD);
  }

  function spawnBoss() {
    // A mini-boss "firewall" — bigger, blocks a lane, and takes multiple
    // shots to bring down instead of fizzling in one hit.
    const hp = 3;
    items.push({
      lane: 60 + Math.random() * (W - 120), baseLane: 0, z: 1, baseR: 30, type: 'bad', boss: true,
      hp, maxHp: hp, token: 'FIREWALL', vz: 0.26 * difficulty, spin: 0, seed: Math.random() * 1000,
      x: VP_X, y: VP_Y, r: 1, glitchT: 0, drift: false, driftAmp: 0, driftFreq: 0, splitter: false, mini: false,
    });
    spawnFloatText(W / 2, VP_Y + 70, '\u26A0 FIREWALL', COL_BAD);
    shakeMag = Math.max(shakeMag, 6);
  }

  function spawnWorm() {
    // A mini-boss "worm" — snakes laterally across the tunnel while it
    // approaches, so unlike FIREWALL you have to track a moving target
    // while still landing enough shots to bring its hp down.
    const hp = 4;
    const lane = W / 2;
    items.push({
      lane, baseLane: lane, z: 1, baseR: 22, type: 'bad', boss: true, worm: true,
      hp, maxHp: hp, token: 'WORM', vz: 0.24 * difficulty, spin: 0, seed: Math.random() * 1000,
      x: VP_X, y: VP_Y, r: 1, glitchT: 0,
      drift: true, driftAmp: W * 0.32, driftFreq: 0.55 + Math.random() * 0.2, splitter: false, mini: false,
    });
    spawnFloatText(W / 2, VP_Y + 70, '\u26A0 WORM DETECTED', '#818CF8');
    shakeMag = Math.max(shakeMag, 6);
  }

  function spawnSentinel() {
    // A third mini-boss reserved for the later zones (Reactor/Breach) —
    // higher HP than either FIREWALL or WORM, and drifts faster/wider
    // than WORM so those zones get their own distinct encounter instead
    // of just reusing the same two bosses at higher difficulty.
    const hp = 5;
    const lane = W / 2;
    items.push({
      lane, baseLane: lane, z: 1, baseR: 24, type: 'bad', boss: true, worm: true,
      hp, maxHp: hp, token: 'SENTINEL', vz: 0.3 * difficulty, spin: 0, seed: Math.random() * 1000,
      x: VP_X, y: VP_Y, r: 1, glitchT: 0,
      drift: true, driftAmp: W * 0.42, driftFreq: 0.85 + Math.random() * 0.25, splitter: false, mini: false,
    });
    spawnFloatText(W / 2, VP_Y + 70, '\u26A0 SENTINEL ONLINE', '#F59E0B');
    shakeMag = Math.max(shakeMag, 7);
  }

  function spawnFloatText(x, y, text, color) {
    floatTexts.push({ x, y, text, color, life: 0.9, maxLife: 0.9 });
  }

  function spawnShockwave(x, y, color, maxR) {
    shockwaves.push({ x, y, r: 0, maxR: maxR || 100, life: 0, maxLife: 0.55, color });
  }

  function spawnParticles(x, y, color, n, spread, speed) {
    const count = Math.max(1, Math.round(n * PARTICLE_SCALE));
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - spread,
        life: 0.4 + Math.random() * 0.4, maxLife: 0.4 + Math.random() * 0.4,
        color, size: 1.5 + Math.random() * 2.5,
      });
    }
  }

  // -- synthesized audio: oscillators/noise, no sample assets, consistent
  //    with the rest of this zero-dependency build. Filtered sweeps +
  //    detuned unison layers are what give these that cyberpunk/synth
  //    edge instead of plain beeps. ---------------------------------
  let audioCtx = null, ambientOsc = null, ambientGain = null, ambientFilter = null;
  function ensureAudio() {
    if (audioCtx) { if (audioCtx.state === 'suspended') audioCtx.resume(); return; }
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (_) { audioCtx = null; }
  }
  // real sound effect for the boot sequence's glitch beat, replacing the
  // synthesized chime that used to play there — plain <audio> rather than
  // routed through the Web Audio graph, since it's a one-shot sting with
  // nothing (like the radio's waveform) needing to tap its output
  let gwBootSfxEl = null;
  function playBootGlitchSfx() {
    if (!soundOn) return;
    if (!gwBootSfxEl) {
      gwBootSfxEl = new Audio('sfx/boot-glitch.wav');
      gwBootSfxEl.preload = 'auto';
    }
    gwBootSfxEl.volume = 0.55 * settings.sfxVolume;
    try { gwBootSfxEl.currentTime = 0; } catch (_) {}
    gwBootSfxEl.play().catch((err) => console.warn('[ghostwire boot] sfx play() failed:', err));
  }
  let gwCrashSfxEl = null;
  function playComputerCrashSfx() {
    if (!soundOn) return;
    if (!gwCrashSfxEl) {
      gwCrashSfxEl = new Audio('sfx/computer-crash.mp3');
      gwCrashSfxEl.preload = 'auto';
    }
    gwCrashSfxEl.volume = 0.55 * settings.sfxVolume;
    try { gwCrashSfxEl.currentTime = 0; } catch (_) {}
    gwCrashSfxEl.play().catch((err) => console.warn('[ghostwire boot] crash sfx play() failed:', err));
  }
  // one shared click sound for every button in the game — settings,
  // achievements/stats tabs, zone select, play/menu, pause, mute,
  // fullscreen, skip, quit, everything. currentTime resets on each call
  // so rapid taps restart it instead of queueing/piling up.
  let gwClickSfxEl = null;
  function playClickSfx() {
    if (!soundOn) return;
    if (!gwClickSfxEl) {
      gwClickSfxEl = new Audio('sfx/success.mp3');
      gwClickSfxEl.preload = 'auto';
    }
    gwClickSfxEl.volume = 0.45 * settings.sfxVolume;
    try { gwClickSfxEl.currentTime = 0; } catch (_) {}
    gwClickSfxEl.play().catch((err) => console.warn('[ghostwire] click sfx play() failed:', err));
  }
  // menu music — plays through the title screen and level-select, stops
  // the instant a level is actually chosen (handlePlayClick), and resumes
  // when the player's back at level-select after quitting or a run ending
  let gwMenuMusicEl = null;
  const MENU_MUSIC_VOL = 0.35, MENU_MUSIC_FADE_MS = 1200;
  let menuMusicFadeRaf = null;
  function fadeMenuMusic(targetVol, durMs, onDone) {
    if (!gwMenuMusicEl) { if (onDone) onDone(); return; }
    if (menuMusicFadeRaf) cancelAnimationFrame(menuMusicFadeRaf);
    const startVol = gwMenuMusicEl.volume;
    const t0 = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - t0) / durMs);
      gwMenuMusicEl.volume = startVol + (targetVol - startVol) * t;
      if (t < 1) { menuMusicFadeRaf = requestAnimationFrame(tick); }
      else { menuMusicFadeRaf = null; if (onDone) onDone(); }
    }
    menuMusicFadeRaf = requestAnimationFrame(tick);
  }
  // browsers only grant unprompted play() to a real user-gesture window —
  // starting this several seconds into the boot sequence (deep inside a
  // setTimeout chain from the original click) falls well outside that
  // window and gets silently blocked. Priming the element synchronously
  // inside the actual click handler (play, then instantly pause) "unlocks"
  // it, so the later async play() call from startMenuMusic succeeds.
  function unlockMenuMusic() {
    if (gwMenuMusicEl) return;
    gwMenuMusicEl = new Audio('sfx/menu-music.mp3');
    gwMenuMusicEl.preload = 'auto';
    gwMenuMusicEl.loop = true;
    gwMenuMusicEl.volume = MENU_MUSIC_VOL * settings.musicVolume;
    gwMenuMusicEl.play().then(() => gwMenuMusicEl.pause()).catch((err) => console.warn('[ghostwire] menu music unlock failed:', err));
  }
  function startMenuMusicInternal() {
    if (!gwMenuMusicEl) unlockMenuMusic();
    if (!gwMenuMusicEl) return;
    if (gwMenuMusicEl.paused) {
      gwMenuMusicEl.volume = 0;
      gwMenuMusicEl.play().catch((err) => console.warn('[ghostwire] menu music play() failed:', err));
      fadeMenuMusic(MENU_MUSIC_VOL * settings.musicVolume, MENU_MUSIC_FADE_MS);
    } else {
      fadeMenuMusic(MENU_MUSIC_VOL * settings.musicVolume, MENU_MUSIC_FADE_MS);
    }
  }
  function stopMenuMusicInternal() {
    if (!gwMenuMusicEl || gwMenuMusicEl.paused) return;
    fadeMenuMusic(0, MENU_MUSIC_FADE_MS, () => { if (gwMenuMusicEl) gwMenuMusicEl.pause(); });
  }
  let menuMusicWanted = false;
  function startMenuMusic() {
    menuMusicWanted = true;
    updateMenuMusicPlayback();
  }
  function stopMenuMusic() {
    menuMusicWanted = false;
    updateMenuMusicPlayback();
  }
  // menu music has no dedicated on-screen control once the player has
  // scrolled away from the game to browse the rest of the site — rather
  // than requiring them to scroll back down to find the mute button,
  // it auto-pauses (with the same fade) the moment the game section
  // leaves the viewport, and resumes if they scroll back while still on
  // a menu/level-select screen (not mid-run).
  let gwSectionVisible = true;
  function updateMenuMusicPlayback() {
    const shouldPlay = soundOn && menuMusicWanted && gwSectionVisible;
    if (shouldPlay) startMenuMusicInternal();
    else stopMenuMusicInternal();
  }
  if (gameWrap && 'IntersectionObserver' in window) {
    const gwVisibilityObserver = new IntersectionObserver((entries) => {
      gwSectionVisible = entries[0].isIntersecting;
      updateMenuMusicPlayback();
    }, { threshold: 0.15 });
    gwVisibilityObserver.observe(gameWrap);
  }
  function playTone(freq, dur, type, vol, slideTo, delay, opts) {
    if (!audioCtx || !soundOn) return;
    opts = opts || {};
    const t0 = audioCtx.currentTime + (delay || 0);
    function voice(detuneCents, voiceVol) {
      const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      if (detuneCents) osc.detune.setValueAtTime(detuneCents, t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
      let lastNode = osc;
      if (opts.filterFreq) {
        const filt = audioCtx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.setValueAtTime(opts.filterFreq, t0);
        filt.Q.value = opts.filterQ || 7;
        if (opts.filterSlideTo) filt.frequency.exponentialRampToValueAtTime(Math.max(80, opts.filterSlideTo), t0 + dur);
        lastNode.connect(filt);
        lastNode = filt;
      }
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(voiceVol, t0 + Math.min(0.01, dur * 0.2));
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      lastNode.connect(gain); gain.connect(audioCtx.destination);
      osc.start(t0); osc.stop(t0 + dur + 0.03);
    }
    voice(0, (vol || 0.15) * settings.sfxVolume);
    if (opts.detune) voice(opts.detune, (vol || 0.15) * 0.55 * settings.sfxVolume);
  }
  function playNoise(dur, vol, delay) {
    if (!audioCtx || !soundOn) return;
    const n = Math.max(1, Math.floor(audioCtx.sampleRate * dur));
    const buffer = audioCtx.createBuffer(1, n, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = audioCtx.createBufferSource(), gain = audioCtx.createGain();
    src.buffer = buffer;
    const t0 = audioCtx.currentTime + (delay || 0);
    gain.gain.setValueAtTime((vol || 0.15) * settings.sfxVolume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(gain); gain.connect(audioCtx.destination);
    src.start(t0);
  }
  function sfxShoot() { playTone(1500, 0.09, 'square', 0.065, 260, 0, { filterFreq: 3400, filterSlideTo: 500, filterQ: 6 }); }
  function sfxUiClick() { ensureAudio(); playTone(880, 0.05, 'sine', 0.05, 1300, 0, { filterFreq: 3000, filterQ: 4 }); }
  function sfxCatch(mult) { playTone(660 + mult * 70, 0.11, 'triangle', 0.13, 1150 + mult * 90, 0, { detune: 16 }); }
  function sfxFizzle() { playNoise(0.1, 0.12); playTone(340, 0.12, 'sawtooth', 0.07, 70, 0, { filterFreq: 2100, filterSlideTo: 220, filterQ: 5 }); }
  function sfxHit() { playTone(170, 0.2, 'sawtooth', 0.19, 45, 0, { filterFreq: 1300, filterSlideTo: 150, filterQ: 10 }); playNoise(0.12, 0.11); }
  function sfxDeath() { playNoise(0.55, 0.22); playTone(240, 0.65, 'sawtooth', 0.17, 26, 0, { filterFreq: 900, filterSlideTo: 55, filterQ: 6 }); }
  function sfxPowerup() {
    playTone(540, 0.1, 'square', 0.1, null, 0, { detune: 11 });
    playTone(720, 0.1, 'square', 0.1, null, 0.07, { detune: 11 });
    playTone(960, 0.15, 'square', 0.11, null, 0.14, { detune: 11 });
  }
  function sfxSurge() { playTone(90, 0.45, 'sawtooth', 0.15, 140, 0, { filterFreq: 650, filterSlideTo: 2400, filterQ: 12 }); }
  function sfxCharged() { playTone(220, 0.24, 'sawtooth', 0.19, 900, 0, { filterFreq: 3200, filterSlideTo: 700, filterQ: 6, detune: 10 }); playNoise(0.08, 0.09); }
  function sfxLevelUp() {
    playTone(440, 0.09, 'triangle', 0.11, null, 0, { detune: 8 });
    playTone(660, 0.09, 'triangle', 0.11, null, 0.08, { detune: 8 });
    playTone(880, 0.16, 'triangle', 0.13, null, 0.16, { detune: 8 });
  }
  function startAmbient() {
    if (!audioCtx) return;
    ambientOsc = audioCtx.createOscillator();
    ambientGain = audioCtx.createGain();
    ambientFilter = audioCtx.createBiquadFilter();
    ambientOsc.type = 'sawtooth';
    ambientOsc.frequency.value = 46;
    ambientFilter.type = 'lowpass';
    ambientFilter.frequency.value = 180;
    ambientFilter.Q.value = 5;
    ambientGain.gain.value = 0.0001;
    ambientOsc.connect(ambientFilter); ambientFilter.connect(ambientGain); ambientGain.connect(audioCtx.destination);
    ambientOsc.start();
  }
  function stopAmbient() {
    if (ambientOsc) { try { ambientOsc.stop(); } catch (_) {} ambientOsc = null; }
    ambientGain = null;
    ambientFilter = null;
  }
  function updateAmbient() {
    if (!audioCtx || !ambientOsc || !ambientGain) return;
    if (!soundOn) { ambientGain.gain.setTargetAtTime(0.0001, audioCtx.currentTime, 0.1); return; }
    const freq = 44 + threat * 42;
    ambientOsc.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.25);
    if (ambientFilter) ambientFilter.frequency.setTargetAtTime(160 + threat * 950, audioCtx.currentTime, 0.3);
    const pulseRate = 1.3 + threat * 3.4;
    const g = 0.009 + (0.5 + 0.5 * Math.sin(tunnelHue * pulseRate * Math.PI * 2)) * (0.007 + threat * 0.02);
    ambientGain.gain.setTargetAtTime(g, audioCtx.currentTime, 0.05);
  }

  // -- RADIO: plays real audio files listed in music/tracks.js
  //    (window.GHOSTWIRE_TRACKS) — no procedural synthesis here, just
  //    playback + a waveform tap. A random track starts on first
  //    interaction, auto-advances when one ends, and is skippable via the
  //    radio widget's button. Gracefully hides itself if no tracks are
  //    configured yet.
  const RADIO_TRACKS = (window.GHOSTWIRE_TRACKS || []).filter((t) => t && t.file);
  if (!RADIO_TRACKS.length) {
    console.warn('[ghostwire radio] No tracks found — check that music/tracks.js loaded '
      + '(window.GHOSTWIRE_TRACKS is ' + (window.GHOSTWIRE_TRACKS === undefined ? 'undefined, so tracks.js likely 404\'d or didn\'t load' : 'an empty array — add entries to music/tracks.js') + '). '
      + 'Also check the Network tab for 404s on the .mp3 files themselves.');
  }
  // -- RADIO UNLOCKS: only the first few tracks are available from the
  //    start; the rest unlock in slices as achievements are earned. Reuses
  //    the existing achievement system rather than a separate progress
  //    mechanic — no new persistence needed, since achievement completion
  //    already persists to localStorage. The remaining (non-default)
  //    tracks are split as evenly as possible across ACHIEVEMENT_DEFS, in
  //    that array's order, so this scales automatically if tracks or
  //    achievements are added/removed later rather than relying on
  //    hardcoded filenames.
  const RADIO_DEFAULT_UNLOCKED = Math.min(4, RADIO_TRACKS.length);
  function tracksUnlockedByAchievement(achId) {
    const bonusCount = RADIO_TRACKS.length - RADIO_DEFAULT_UNLOCKED;
    if (bonusCount <= 0 || !ACHIEVEMENT_DEFS.length) return [];
    const perAchievement = bonusCount / ACHIEVEMENT_DEFS.length;
    const achIdx = ACHIEVEMENT_DEFS.findIndex((d) => d.id === achId);
    if (achIdx < 0) return [];
    const start = RADIO_DEFAULT_UNLOCKED + Math.round(achIdx * perAchievement);
    const end = RADIO_DEFAULT_UNLOCKED + Math.round((achIdx + 1) * perAchievement);
    return RADIO_TRACKS.slice(start, end);
  }
  function isTrackUnlocked(idx) {
    if (idx < RADIO_DEFAULT_UNLOCKED) return true;
    const bonusCount = RADIO_TRACKS.length - RADIO_DEFAULT_UNLOCKED;
    if (bonusCount <= 0 || !ACHIEVEMENT_DEFS.length) return false;
    const perAchievement = bonusCount / ACHIEVEMENT_DEFS.length;
    const achIdx = Math.floor((idx - RADIO_DEFAULT_UNLOCKED) / perAchievement);
    const def = ACHIEVEMENT_DEFS[achIdx];
    return !!(def && achievements[def.id]);
  }
  function unlockedTrackIndices() {
    const out = [];
    for (let i = 0; i < RADIO_TRACKS.length; i++) if (isTrackUnlocked(i)) out.push(i);
    return out;
  }
  const radioWidget = document.getElementById('game-radio');
  const radioWaveEl = document.getElementById('game-radio-wave');
  const radioTrackEl = document.getElementById('game-radio-track');
  const radioSkipBtn = document.getElementById('game-radio-skip');
  const radioWaveCtx = radioWaveEl ? radioWaveEl.getContext('2d') : null;
  let radioAudioEl = null, radioAnalyser = null, radioSource = null, radioMuteGain = null;
  let radioIdx = -1, radioStarted = false;

  function ensureRadioGraph() {
    if (radioAudioEl || !audioCtx) return;
    radioAudioEl = new Audio();
    radioAudioEl.preload = 'auto';
    radioAudioEl.volume = 0.5 * settings.musicVolume;
    radioAudioEl.addEventListener('ended', nextRadioTrack);
    // createMediaElementSource() permanently reroutes this element's audio
    // output through the Web Audio graph the instant it's called — if
    // anything after that throws, the element is left connected to
    // nothing (silently "playing" with zero sound) unless we explicitly
    // patch it straight to destination as a fallback. The analyser/
    // visualizer is optional flourish; audible playback is not.
    try {
      radioSource = audioCtx.createMediaElementSource(radioAudioEl);
      radioAnalyser = audioCtx.createAnalyser();
      radioAnalyser.fftSize = 64;
      radioMuteGain = audioCtx.createGain();
      radioMuteGain.gain.value = soundOn ? 1 : 0;
      radioSource.connect(radioAnalyser);
      radioAnalyser.connect(radioMuteGain);
      radioMuteGain.connect(audioCtx.destination);
    } catch (err) {
      console.warn('[ghostwire radio] waveform tap failed, falling back to direct playback:', err);
      radioAnalyser = null;
      try {
        if (radioSource) {
          radioMuteGain = audioCtx.createGain();
          radioMuteGain.gain.value = soundOn ? 1 : 0;
          radioSource.connect(radioMuteGain);
          radioMuteGain.connect(audioCtx.destination);
        }
      } catch (_) {}
    }
  }
  function pickRadioIdx(excludeIdx) {
    const pool = unlockedTrackIndices();
    if (!pool.length) return -1;
    if (pool.length === 1) return pool[0];
    let i;
    do { i = pool[Math.floor(Math.random() * pool.length)]; } while (i === excludeIdx);
    return i;
  }
  function playRadioTrack(idx) {
    if (!radioAudioEl || !RADIO_TRACKS[idx]) return;
    radioIdx = idx;
    const track = RADIO_TRACKS[idx];
    radioAudioEl.src = 'music/' + track.file;
    radioAudioEl.muted = !soundOn;
    radioAudioEl.play().catch((err) => console.warn('[ghostwire radio] play() failed:', err));
    if (radioTrackEl) radioTrackEl.textContent = track.title + (track.artist ? ' — ' + track.artist : '');
    if (radioWidget) radioWidget.hidden = false;
  }
  function nextRadioTrack() { playRadioTrack(pickRadioIdx(radioIdx)); }
  function startRadio() {
    if (!RADIO_TRACKS.length) { if (radioWidget) radioWidget.hidden = true; return; }
    ensureRadioGraph();
    if (!radioAudioEl) return;
    if (audioCtx && audioCtx.state === 'suspended') {
      // Belt-and-suspenders: don't fire the very first play() until the
      // context has actually confirmed it's running — on iOS a freshly
      // resumed context can report success asynchronously, and playing
      // through it before that settles is exactly what produced silent
      // "it's playing but no sound" first attempts.
      audioCtx.resume().then(beginRadioPlayback).catch(beginRadioPlayback);
    } else {
      beginRadioPlayback();
    }
  }
  function beginRadioPlayback() {
    if (!radioAudioEl) return;
    if (!radioStarted) { radioStarted = true; playRadioTrack(pickRadioIdx(-1)); }
    else if (radioAudioEl.paused) { radioAudioEl.play().catch((err) => console.warn('[ghostwire radio] play() failed:', err)); }
  }
  function stopRadio() {
    if (radioAudioEl) radioAudioEl.pause();
    radioStarted = false; // next startRadio() picks a fresh random track rather than resuming
    if (radioWidget) radioWidget.hidden = true;
  }
  if (radioSkipBtn) radioSkipBtn.addEventListener('click', nextRadioTrack);

  function drawRadioWave() {
    if (!radioWaveCtx || !radioWaveEl) return;
    const w = radioWaveEl.width, h = radioWaveEl.height;
    radioWaveCtx.clearRect(0, 0, w, h);
    if (!radioAnalyser || !radioAudioEl || radioAudioEl.paused) {
      radioWaveCtx.strokeStyle = 'rgba(148,163,184,.35)';
      radioWaveCtx.lineWidth = 1.5;
      radioWaveCtx.beginPath(); radioWaveCtx.moveTo(0, h / 2); radioWaveCtx.lineTo(w, h / 2); radioWaveCtx.stroke();
      return;
    }
    const data = new Uint8Array(radioAnalyser.frequencyBinCount);
    radioAnalyser.getByteFrequencyData(data);
    const barW = w / data.length;
    for (let i = 0; i < data.length; i++) {
      const barH = Math.max(2, (data[i] / 255) * h);
      // hue cycles with the game's own tunnel-hue clock so the waveform's
      // color drifts through the same cyan/violet/magenta palette as
      // everything else, in sync rather than an unrelated random cycle
      const hue = (tunnelHue * 40 + i * (360 / data.length)) % 360;
      radioWaveCtx.fillStyle = 'hsl(' + hue + ', 90%, 60%)';
      radioWaveCtx.fillRect(i * barW, h - barH, Math.max(1, barW - 1), barH);
    }
  }
  (function radioLoop() { drawRadioWave(); requestAnimationFrame(radioLoop); })();

  function rectCircleCollide(px, py, pw, ph, cx, cy, cr) {
    const closestX = Math.max(px, Math.min(cx, px + pw));
    const closestY = Math.max(py, Math.min(cy, py + ph));
    const dx = cx - closestX, dy = cy - closestY;
    return (dx * dx + dy * dy) < (cr * cr);
  }

  const keyState = { left: false, right: false };
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keyState.left = true;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keyState.right = true;
    if ((e.key === ' ' || e.code === 'Space') && !e.repeat) { e.preventDefault(); startCharge(); }
    if (e.key === 'p' || e.key === 'P') togglePause();
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keyState.left = false;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keyState.right = false;
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); releaseCharge(); }
  });
  if (fireBtn) {
    fireBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); startCharge(); });
    fireBtn.addEventListener('pointerup', (e) => { e.preventDefault(); e.stopPropagation(); releaseCharge(); });
    fireBtn.addEventListener('pointercancel', (e) => { e.stopPropagation(); releaseCharge(); });
    fireBtn.addEventListener('pointerleave', (e) => { e.stopPropagation(); if (charging) releaseCharge(); });
  }
  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      soundOn = !soundOn;
      setMuteIcon(!soundOn);
      muteBtn.classList.toggle('is-muted', !soundOn);
      if (radioAudioEl) radioAudioEl.muted = !soundOn;
      if (radioMuteGain) radioMuteGain.gain.value = soundOn ? 1 : 0;
      updateMenuMusicPlayback();
      if (soundOn) { ensureAudio(); startRadio(); }
    });
  }

  // -- fullscreen: the native Fullscreen API isn't available for arbitrary
  //    elements in mobile Safari outside a home-screen PWA, so the actual
  //    "fullscreen" here is a fixed, full-viewport CSS layout that
  //    letterboxes the 4:3 canvas to fit either portrait or landscape via
  //    min()/calc() — no JS resize math needed, it just recalculates on
  //    rotation. requestFullscreen() is still attempted as a bonus on
  //    browsers that do support it. --------------------------------------
  function isNativeFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
  }
  // A `transform` (or `will-change: transform`) on any ancestor — which
  // .panel has, for its scroll-reveal effect — re-anchors position:fixed
  // descendants to that ancestor instead of the real viewport. So instead
  // of fighting that, game-wrap is physically moved to be a direct child
  // of <body> while fullscreen, then moved back to its original spot on
  // exit.
  const gwHomeParent = gameWrap ? gameWrap.parentNode : null;
  const gwHomeNextSibling = gameWrap ? gameWrap.nextSibling : null;
  let gwLockScrollY = 0;
  function lockScroll() {
    gwLockScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.style.position = 'fixed';
    document.body.style.top = (-gwLockScrollY) + 'px';
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.documentElement.classList.add('gw-fs-lock');
    document.body.classList.add('gw-fs-lock');
  }
  function unlockScroll() {
    document.documentElement.classList.remove('gw-fs-lock');
    document.body.classList.remove('gw-fs-lock');
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    window.scrollTo(0, gwLockScrollY);
  }
  // Rapid taps on the in-canvas fire button can trigger Safari's
  // double-tap-to-zoom gesture even with touch-action: manipulation set,
  // since .game-wrap's own touch-action: none can interact oddly with a
  // fake (non-native) fullscreen. Belt-and-suspenders fix: hard-disable
  // pinch/double-tap zoom via the viewport meta while fullscreen, restore
  // the normal (accessible, zoomable) viewport on exit.
  const viewportMeta = document.querySelector('meta[name="viewport"]');
  const viewportMetaDefault = viewportMeta ? viewportMeta.getAttribute('content') : null;
  function lockViewportZoom() {
    if (viewportMeta) viewportMeta.setAttribute('content', viewportMetaDefault + ', maximum-scale=1, user-scalable=no');
  }
  function unlockViewportZoom() {
    if (viewportMeta && viewportMetaDefault) viewportMeta.setAttribute('content', viewportMetaDefault);
  }
  function enterFullscreenMode() {
    if (!gameWrap) return;
    document.body.appendChild(gameWrap);
    gameWrap.classList.add('gw-fullscreen');
    lockScroll();
    lockViewportZoom();
    if (fullscreenBtn) { setFullscreenActiveState(true); syncFullscreenLabel(); }
    const reqFs = gameWrap.requestFullscreen || gameWrap.webkitRequestFullscreen || gameWrap.mozRequestFullScreen || gameWrap.msRequestFullscreen;
    if (reqFs) { try { const p = reqFs.call(gameWrap); if (p && p.catch) p.catch(() => {}); } catch (_) {} }
    // requestFullscreen() isn't available for arbitrary elements on
    // mobile Safari — this nudge (the classic "hide the URL bar" trick)
    // is the closest that context gets to true fullscreen, since the
    // layout above now uses dvh/dvw and will actually expand into
    // whatever space Safari reclaims once its chrome collapses.
    setTimeout(() => window.scrollTo(0, 1), 50);
    try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('any').catch(() => {}); } catch (_) {}
  }
  function exitFullscreenMode(skipNativeExit) {
    if (!gameWrap) return;
    gameWrap.classList.remove('gw-fullscreen');
    unlockScroll();
    unlockViewportZoom();
    if (gwHomeParent) {
      if (gwHomeNextSibling) gwHomeParent.insertBefore(gameWrap, gwHomeNextSibling);
      else gwHomeParent.appendChild(gameWrap);
    }
    if (fullscreenBtn) setFullscreenActiveState(false);
    if (!skipNativeExit && isNativeFullscreen()) {
      const exitFs = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
      if (exitFs) { try { const p = exitFs.call(document); if (p && p.catch) p.catch(() => {}); } catch (_) {} }
    }
    try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (_) {}
  }
  if (fullscreenBtn && gameWrap) {
    fullscreenBtn.addEventListener('click', () => {
      if (gameWrap.classList.contains('gw-fullscreen')) exitFullscreenMode(); else enterFullscreenMode();
    });
    ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'].forEach((evt) => {
      document.addEventListener(evt, () => {
        if (!isNativeFullscreen() && gameWrap.classList.contains('gw-fullscreen')) exitFullscreenMode(true);
      });
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && gameWrap.classList.contains('gw-fullscreen')) exitFullscreenMode();
    });
  }

  let dragging = false;
  function pointerToCanvasX(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    return (clientX - rect.left) * (W / rect.width);
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (e.target !== canvas || !running || dying || paused) return;
    if (!gyroEnabled) { dragging = true; targetX = pointerToCanvasX(e); }
    startCharge();
  });
  canvas.addEventListener('pointermove', (e) => { if (dragging && e.target === canvas) targetX = pointerToCanvasX(e); });
  window.addEventListener('pointerup', () => { dragging = false; if (charging) releaseCharge(); });
  window.addEventListener('pointercancel', () => { dragging = false; if (charging) releaseCharge(); });

  // -- gyro/tilt steering (mobile only) --------------------------------
  const hasOrientation = typeof window.DeviceOrientationEvent !== 'undefined'
    && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
  // On this device, gamma is the responsive axis in portrait (left-right
  // roll) but reads as front-back ("up/down") once rotated to landscape —
  // beta is the one that actually tracks left-right roll in landscape.
  // Confirmed by live on-device testing, not just theory. Beta's range is
  // -180..180 (2x gamma's -90..90), so it needs its own higher sensitivity
  // to feel equally responsive for the same physical tilt.
  const GYRO_SENSITIVITY_LANDSCAPE = GYRO_SENSITIVITY * 2;
  function currentOrientationAngle() {
    if (window.screen && window.screen.orientation && typeof window.screen.orientation.angle === 'number') return window.screen.orientation.angle;
    if (typeof window.orientation === 'number') return window.orientation;
    return 0;
  }
  function steerAxisValue(e) {
    const angle = currentOrientationAngle();
    if (angle === 90) return (e.beta == null) ? null : { v: -e.beta, landscape: true };
    if (angle === -90 || angle === 270) return (e.beta == null) ? null : { v: e.beta, landscape: true };
    return (e.gamma == null) ? null : { v: e.gamma, landscape: false };
  }
  function handleOrientation(e) {
    const r = steerAxisValue(e);
    if (window.__TILT_DEBUG && gyroBtn) {
      gyroBtn.textContent = `∠${currentOrientationAngle()} β${e.beta==null?'-':e.beta.toFixed(0)} γ${e.gamma==null?'-':e.gamma.toFixed(0)} v${r==null?'-':r.v.toFixed(0)} n${gyroNeutral==null?'-':gyroNeutral.toFixed(0)}`;
    }
    if (r === null) return;
    const v = r.v;
    if (gyroNeutral === null) gyroNeutral = v; // calibrate to however they're holding the phone
    const sens = r.landscape ? GYRO_SENSITIVITY_LANDSCAPE : GYRO_SENSITIVITY;
    gyroX = W / 2 - (v - gyroNeutral) * sens; // inverted: tilt right now steers right
  }
  function setGyroActive(active) {
    gyroEnabled = active;
    if (gyroBtn) {
      if (gyroLabel) gyroLabel.textContent = active ? 'TILT: ON' : 'TILT: OFF';
      gyroBtn.classList.toggle('is-active', active);
    }
    if (active) { gyroNeutral = null; gyroX = null; }
  }
  if (hasOrientation && gyroBtn) {
    gyroBtn.hidden = false;
    gyroBtn.addEventListener('click', async () => {
      if (gyroEnabled) { setGyroActive(false); return; }
      try {
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
          const state = await DeviceOrientationEvent.requestPermission();
          if (state !== 'granted') return;
        }
        window.addEventListener('deviceorientation', handleOrientation);
        setGyroActive(true);
      } catch (_) { /* permission denied or unsupported — stay in manual steering */ }
    });
    // recalibrate on rotation — the axis mapping above changes, and the
    // old neutral value belongs to the previous orientation's axis
    window.addEventListener('orientationchange', () => { if (gyroEnabled) gyroNeutral = null; });
    if (window.screen && window.screen.orientation) {
      window.screen.orientation.addEventListener('change', () => { if (gyroEnabled) gyroNeutral = null; });
    }
  }

  function fireWeapon(power) {
    power = power || 0;
    if (!running || dying || paused || fireTimer > 0) return;
    // OVERLOAD power-up: the next shot is free (no cooldown) and fires at
    // max charge, consumed on use regardless of how it was triggered.
    const overloadedShot = overloadReady;
    if (overloadedShot) { overloadReady = false; power = Math.max(power, 1); }
    const cool = FIRE_COOLDOWN * (1 + power * 1.6);
    fireTimer = overloadedShot ? 0 : (rapidTimer > 0 ? cool * 0.3 : cool);
    const homing = unlocks.homing && power > 0.35;
    if (power <= 0.001 && unlocks.spread) {
      // SPREAD unlock: a quick tap fires 3 shots across nearby lanes instead of 1
      const offsets = [-26, 0, 26];
      offsets.forEach((off) => {
        const lane = Math.max(10, Math.min(W - 10, playerX + off));
        projectiles.push({ lane, p: 1, x: lane, y: PLAYER_Y, power, homing: false });
      });
    } else {
      projectiles.push({ lane: playerX, p: 1, x: playerX, y: PLAYER_Y, power, homing });
    }
    spawnParticles(playerX, PLAYER_Y - PLAYER_H / 2, overloadedShot ? '#F59E0B' : '#E879F9', 6 + Math.round(power * 10), 40 + power * 30, 140 + power * 60);
    shotsFired++;
    if (power > 0.35) sfxCharged(); else sfxShoot();
  }

  function startCharge() {
    if (!running || dying || paused || fireTimer > 0 || charging) return;
    charging = true; chargeTimer = 0;
  }

  function releaseCharge() {
    if (!charging) return;
    charging = false;
    const t = chargeTimer;
    chargeTimer = 0;
    if (!running || dying || paused) return;
    if (t < CHARGE_TAP_MAX) fireWeapon(0);
    else {
      const cap = unlocks.overcharge ? CHARGE_MAX_OVERCHARGED : CHARGE_MAX;
      fireWeapon(Math.min(unlocks.overcharge ? 1.7 : 1, t / cap));
    }
  }

  function togglePause() {
    if (!running || dying) return;
    setPaused(!paused);
  }

  function setPaused(p) {
    paused = p;
    if (paused) { charging = false; chargeTimer = 0; }
    else { lastTime = performance.now(); }
    if (pauseBtn) {
      setPauseIcon(paused);
      pauseBtn.setAttribute('aria-label', paused ? 'Resume' : 'Pause');
    }
    if (pillText) pillText.textContent = paused ? 'PAUSED' : 'HUNTING';
  }
  if (pauseBtn) pauseBtn.addEventListener('click', togglePause);

  function fizzleItem(it) {
    fizzles.push({ x: it.x, y: it.y, r: it.r, t: 0, seed: it.seed });
    spawnParticles(it.x, it.y, COL_BAD, 10, 20, 140);
    spawnParticles(it.x, it.y, '#E879F9', 6, 12, 110);
    spawnFloatText(it.x, it.y, 'FIZZLED', '#E879F9');
    sfxFizzle();
    unlockAchievement('first_purge');
  }


  function triggerDeath(hitItem) {
    dying = true;
    deathTimer = 0.42;
    shakeMag = 20;
    flash = 1;
    if (pillText) pillText.textContent = 'BREACH DETECTED';
    spawnParticles(hitItem.x, hitItem.y, COL_BAD, 26, 40, 220);
    spawnParticles(playerX, PLAYER_Y, COL_BAD, 16, 20, 160);
    spawnShockwave(playerX, PLAYER_Y, COL_BAD, 160);
    haptic([40, 30, 80]);
    sfxDeath();
  }

  function triggerHit(hitItem) {
    // a glancing hit while the system isn't critical yet — costs points and a
    // brief invulnerability window, but doesn't end the run
    invulnTimer = HIT_INVULN;
    streak = 0;
    hitsThisRun += 1;
    score = Math.max(0, score - 5);
    statEl.innerHTML = 'score: <strong>' + score + '</strong>';
    shakeMag = 9;
    flash = 0.5;
    spawnParticles(hitItem.x, hitItem.y, COL_BAD, 12, 20, 130);
    spawnFloatText(playerX, PLAYER_Y - 30, '-5', COL_BAD);
    haptic(30);
    sfxHit();
  }

  function activatePowerup(type) {
    let label = 'POWER-UP', color = '#E879F9';
    if (type === 'rapid') { rapidTimer = RAPID_DURATION; label = 'RAPID FIRE'; color = '#E879F9'; }
    else if (type === 'magnet') { magnetTimer = MAGNET_DURATION; label = 'MAGNET'; color = '#22D3EE'; }
    else if (type === 'shield') { shieldTimer = SHIELD_DURATION; label = 'SHIELD'; color = '#818CF8'; }
    else if (type === 'slow') { slowTimer = SLOW_DURATION; label = 'TIME DILATION'; color = '#7DD3FC'; }
    else if (type === 'score') {
      score += SCORE_ORB_BONUS; label = '+' + SCORE_ORB_BONUS + ' ORB'; color = '#F59E0B';
      statEl.innerHTML = 'score: <strong>' + score + '</strong>';
    } else if (type === 'overload') { overloadReady = true; label = 'OVERLOAD READY'; color = '#F59E0B'; }
    spawnFloatText(playerX, PLAYER_Y - 30, label, color);
    haptic(15);
    sfxPowerup();
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 260 * dt; p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function updateFloatTexts(dt) {
    for (let i = floatTexts.length - 1; i >= 0; i--) {
      const f = floatTexts[i];
      f.y -= 26 * dt; f.life -= dt;
      if (f.life <= 0) floatTexts.splice(i, 1);
    }
  }

  function updateShockwaves(dt) {
    for (let i = shockwaves.length - 1; i >= 0; i--) {
      const s = shockwaves[i];
      s.life += dt;
      if (s.life >= s.maxLife) { shockwaves.splice(i, 1); continue; }
      s.r = (s.life / s.maxLife) * s.maxR;
    }
  }

  function update(dt) {
    updateParticles(dt);
    updateFloatTexts(dt);
    updateShockwaves(dt);
    updateAmbient();
    ghostRecordTimer += dt;
    if (ghostRecordTimer >= 0.1) {
      ghostRecordTimer = 0;
      ghostRecording.push([elapsed, targetX]);
    }
    shakeMag = Math.max(0, shakeMag - dt * 70);
    flash = Math.max(0, flash - dt * 3.2);
    eraFlashTimer = Math.max(0, eraFlashTimer - dt * 2);
    tunnelHue += dt;

    stars.forEach((s) => {
      s.y += s.depth * 14 * dt;
      if (s.y > H) { s.y = -4; s.x = Math.random() * W; }
    });

    if (charging) chargeTimer = Math.min(unlocks.overcharge ? CHARGE_MAX_OVERCHARGED : CHARGE_MAX, chargeTimer + dt);

    circuitTraces.forEach((t) => { t.phase = (t.phase + t.speed * dt) % 1; });
    skylineParts.forEach((s) => {
      // Constant closing speed in true depth-space (see skylineZtoP above) —
      // this is what actually produces forward-motion-style acceleration
      // near the player instead of a flat, constant on-screen speed.
      s.z -= s.speed * dt * Math.min(1.5, difficulty);
      if (s.z <= SKYLINE_Z_NEAR) {
        s.z = SKYLINE_Z_FAR + Math.random() * 3;
        s.laneOffset = 1.4 + Math.random() * 2.6;
        s.kind = pick(ERA_SKYLINE_KINDS[currentEraIdx()]);
        s.scale = 0.7 + Math.random() * 0.9;
      }
    });

    codeBitTimer -= dt;
    if (codeBitTimer <= 0) { spawnCodeBit(); codeBitTimer = 0.4 + Math.random() * 0.35; }
    for (let i = codeBits.length - 1; i >= 0; i--) {
      const c = codeBits[i];
      c.p += c.vp * dt * Math.min(1.6, difficulty);
      if (c.p > 1.05) codeBits.splice(i, 1);
    }

    if (dying) {
      deathTimer -= dt;
      if (deathTimer <= 0) gameOver();
      return;
    }

    elapsed += dt;
    // Difficulty now starts at half speed and only steps up every 5 levels
    // (one tier per color era), instead of climbing continuously with time.
    // A short in-run ramp still smooths the very start of each attempt.
    const RAMP_START = 0.4, RAMP_TIME = 8;
    const rampFactor = Math.min(1, RAMP_START + (1 - RAMP_START) * (elapsed / RAMP_TIME));
    const levelTier = Math.floor((level - 1) / 5);
    const baseDifficulty = 0.5 + levelTier * 0.3;
    difficulty = baseDifficulty * rampFactor;

    // levels — one every 20s, mirroring the difficulty ramp's own pacing,
    // so "LEVEL n" is a legible progress marker for the same slow→fast climb
    const newLevel = 1 + Math.floor(elapsed / 20);
    if (newLevel > level) {
      level = newLevel;
      if (level > highestLevelReached) { highestLevelReached = level; saveProgress(); }
      if (level >= 20) unlockAchievement('deep_diver');
      if (level >= 5 && hitsThisRun === 0) unlockAchievement('clean_run');
      spawnFloatText(W / 2, VP_Y + 60, 'LEVEL ' + level, '#7DD3FC');
      shakeMag = Math.max(shakeMag, 4);
      sfxLevelUp();
      const era = Math.floor(level / 5) % LEVEL_ERA_HUES.length;
      if (era !== currentEra) {
        currentEra = era;
        eraFlashTimer = 0.6;
        shakeMag = Math.max(shakeMag, 10);
        spawnFloatText(W / 2, VP_Y + 80, '// ENTERING ' + ERA_NAMES[era], '#F0F8FF');
      }
      checkWeaponUnlocks();
      // a milestone boss (alternating FIREWALL/WORM) greets every new color
      // era, on top of the surge-triggered bosses — a level-tied cadence
      // rather than only a survival-time one
      const tier = Math.floor((level - 1) / 5);
      if (tier > 0 && tier !== bossTierSpawned) {
        bossTierSpawned = tier;
        if (tier >= 4) {
          const pick = tier % 3;
          if (pick === 0) spawnBoss(); else if (pick === 1) spawnWorm(); else spawnSentinel();
        } else if (wormToggle) spawnWorm(); else spawnBoss();
        wormToggle = !wormToggle;
      }
    }
    threat = Math.max(0, Math.min(1, threat + dt * THREAT_RISE_PER_SEC * difficultyThreatMult()));
    invulnTimer = Math.max(0, invulnTimer - dt);
    fireTimer = Math.max(0, fireTimer - dt);
    rapidTimer = Math.max(0, rapidTimer - dt);
    magnetTimer = Math.max(0, magnetTimer - dt);
    shieldTimer = Math.max(0, shieldTimer - dt);
    slowTimer = Math.max(0, slowTimer - dt);
    const slowFactor = slowTimer > 0 ? SLOW_FACTOR : 1;

    formationTimer -= dt;
    if (formationTimer <= 0 && !surging) { spawnFormation(); formationTimer = randRange(FORMATION_MIN, FORMATION_MAX); }

    // -- surge events: a periodic denser, faster burst that rewards a guaranteed power-up if survived
    if (surging) {
      surgeElapsed += dt;
      if (surgeElapsed >= SURGE_DURATION) {
        surging = false;
        surgeCountdown = randRange(SURGE_MIN, SURGE_MAX);
        surgeCount++;
        spawnPowerup();
        spawnFloatText(W / 2, PLAYER_Y - 60, 'SURGE CLEARED', '#E879F9');
        if (surgeCount % 3 === 0) spawnBoss();
      }
    } else {
      surgeCountdown -= dt;
      if (surgeCountdown <= 0) {
        surging = true; surgeElapsed = 0;
        spawnFloatText(W / 2, VP_Y + 40, 'BREACH SURGE', COL_BAD);
        sfxSurge();
      }
    }

    spawnTimer -= dt;
    const spawnInterval = Math.max(0.24, 0.82 - elapsed / 38) / (surging ? 2.2 : 1) / difficultySpawnMult();
    if (spawnTimer <= 0) { spawnItem(); spawnTimer = spawnInterval; }

    powerupTimer -= dt;
    if (powerupTimer <= 0) { spawnPowerup(); powerupTimer = randRange(POWERUP_MIN, POWERUP_MAX); }

    for (let i = fizzles.length - 1; i >= 0; i--) {
      fizzles[i].t += dt;
      if (fizzles[i].t >= FIZZLE_DUR) fizzles.splice(i, 1);
    }

    for (let i = projectiles.length - 1; i >= 0; i--) {
      const pr = projectiles[i];
      pr.p -= PROJECTILE_SPEED * dt;
      if (pr.p <= 0.03) { projectiles.splice(i, 1); continue; }
      if (pr.homing) {
        // steer toward the nearest bad item's current lane as the shot travels
        let nearest = null, nearestD = Infinity;
        for (let k = 0; k < items.length; k++) {
          if (items[k].type !== 'bad') continue;
          const d = Math.abs(items[k].lane - pr.lane);
          if (d < nearestD) { nearestD = d; nearest = items[k]; }
        }
        if (nearest) pr.lane += (nearest.lane - pr.lane) * Math.min(1, dt * 6);
      }
      const s = projectPoint(pr.lane, pr.p);
      pr.x = s.x; pr.y = s.y;
      const power = pr.power || 0;
      const pierce = power > 0.35;
      let hitSomething = false;
      for (let j = items.length - 1; j >= 0; j--) {
        const it = items[j];
        if (it.type !== 'bad') continue;
        const dx = it.x - pr.x, dy = it.y - pr.y;
        const rr = it.r + 6 + power * 30;
        if (dx * dx + dy * dy < rr * rr) {
          if (it.boss) {
            it.hp -= 1;
            spawnParticles(it.x, it.y, COL_BAD, 8, 15, 100);
            if (it.hp <= 0) {
              fizzleItem(it);
              items.splice(j, 1);
              score += 40;
              statEl.innerHTML = 'score: <strong>' + score + '</strong>';
              haptic([25, 50, 25, 50, 60]);
              unlockAchievement('boss_slayer');
            }
          } else if (it.splitter && !it.mini) {
            // splits into 2-3 smaller, faster fragments instead of just fizzling
            fizzleItem(it);
            items.splice(j, 1);
            score += 5;
            statEl.innerHTML = 'score: <strong>' + score + '</strong>';
            const shards = 2 + (Math.random() < 0.5 ? 1 : 0);
            for (let sIdx = 0; sIdx < shards; sIdx++) {
              const lane = Math.max(20, Math.min(W - 20, it.lane + (Math.random() - 0.5) * 60));
              items.push({
                lane, baseLane: lane, z: it.z, baseR: 8, type: 'bad', token: pick(CODE_TOKENS_BAD),
                vz: it.vz * 1.5, spin: (Math.random() - 0.5) * 4, seed: Math.random() * 1000,
                x: it.x, y: it.y, r: it.r * 0.55, glitchT: 0,
                drift: false, driftAmp: 0, driftFreq: 0, splitter: false, mini: true,
              });
            }
          } else {
            fizzleItem(it);
            items.splice(j, 1);
            score += 5;
            statEl.innerHTML = 'score: <strong>' + score + '</strong>';
          }
          shotsHit++;
          hitSomething = true;
          if (!pierce) break;
        }
      }
      if (hitSomething && !pierce) projectiles.splice(i, 1);
    }

    if (gyroEnabled && gyroX !== null) {
      targetX = gyroX;
    } else if (keyState.left || keyState.right) {
      if (keyState.left) targetX -= MOVE_SPEED * dt;
      if (keyState.right) targetX += MOVE_SPEED * dt;
    }
    targetX = Math.max(0, Math.min(W, targetX));

    const prevX = playerX;
    playerX += (targetX - playerX) * Math.min(1, dt * 14);
    playerX = Math.max(PLAYER_W / 2, Math.min(W - PLAYER_W / 2, playerX));
    playerVX = dt > 0 ? (playerX - prevX) / dt : 0;

    if (Math.abs(playerVX) > 40) {
      playerTrail.push({ x: playerX, y: PLAYER_Y, t: 0 });
      if (playerTrail.length > 10) playerTrail.shift();
    }
    for (let i = playerTrail.length - 1; i >= 0; i--) {
      playerTrail[i].t += dt;
      if (playerTrail[i].t > 0.35) playerTrail.splice(i, 1);
    }

    if (Math.random() < 0.6) {
      spawnParticles(playerX, PLAYER_Y + 8, '#7DD3FC', 1, -30, 30);
    }

    // power-ups: drift down the tunnel exactly like items, but pure pickup
    for (let i = powerups.length - 1; i >= 0; i--) {
      const pu = powerups[i];
      pu.z -= pu.vz * dt;
      const p = 1 - pu.z;
      pu.x = VP_X + (pu.lane - VP_X) * p;
      pu.y = VP_Y + (PLAYER_Y - VP_Y) * p;
      pu.r = pu.baseR * (MIN_SCALE + (1 - MIN_SCALE) * p);
      const px2 = playerX - PLAYER_W / 2;
      if (p > 0 && rectCircleCollide(px2, PLAYER_Y - PLAYER_H / 2, PLAYER_W, PLAYER_H, pu.x, pu.y, pu.r)) {
        activatePowerup(pu.type);
        powerups.splice(i, 1);
      } else if (p > REMOVE_P) {
        powerups.splice(i, 1);
      }
    }

    const py = PLAYER_Y - PLAYER_H / 2;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      // the magnet power-up gently curves nearby clean data toward the player
      if (it.type === 'good' && magnetTimer > 0 && it.z < 0.75) {
        it.lane += (playerX - it.lane) * Math.min(1, dt * MAGNET_PULL);
      }
      it.z -= it.vz * dt * slowFactor;
      const p = 1 - it.z;                        // progress toward the player: 0 = far, 1 = arrived
      if (it.drift) {
        // weave the lane sinusoidally around its spawn position; the worm
        // boss uses a much wider amplitude so it reads as "snaking" rather
        // than just jittering in place
        it.lane = Math.max(20, Math.min(W - 20, it.baseLane + Math.sin(elapsed * it.driftFreq + it.seed) * it.driftAmp));
      }
      it.x = VP_X + (it.lane - VP_X) * p;
      it.y = VP_Y + (PLAYER_Y - VP_Y) * p;
      it.r = it.baseR * (MIN_SCALE + (1 - MIN_SCALE) * p);
      if (it.type === 'bad') it.glitchT += dt;

      const px = playerX - PLAYER_W / 2;
      if (p > 0 && rectCircleCollide(px, py, PLAYER_W, PLAYER_H, it.x, it.y, it.r)) {
        if (it.type === 'good') {
          const mult = 1 + Math.min(COMBO_MAX_MULT - 1, Math.floor(streak / COMBO_STEP));
          const gained = 10 * mult;
          score += gained;
          streak += 1;
          if (streak > longestStreak) longestStreak = streak;
          if (streak >= 20) unlockAchievement('streak_20');
          threat = Math.max(0, threat - THREAT_RELIEF_PER_CATCH);
          statEl.innerHTML = 'score: <strong>' + score + '</strong>';
          spawnParticles(it.x, it.y, '#22D3EE', 14, 30, 150);
          spawnFloatText(it.x, it.y, '+' + gained + (mult > 1 ? ' ×' + mult : ''), '#22D3EE');
          sfxCatch(mult);
          items.splice(i, 1);
        } else if (shieldTimer > 0) {
          spawnParticles(it.x, it.y, '#818CF8', 10, 15, 120);
          items.splice(i, 1); // shielded — the hit just deflects off harmlessly
        } else if (invulnTimer > 0) {
          items.splice(i, 1); // still invulnerable from the last hit — pass through harmlessly
        } else if (threat >= RED_THREAT) {
          triggerDeath(it);
          items.splice(i, 1);
          return;
        } else {
          triggerHit(it);
          items.splice(i, 1);
        }
      } else if (p > REMOVE_P) {
        items.splice(i, 1);
      }
    }
  }

  function drawTunnel() {
    // threat (0 → 1) drives the whole tunnel from a cool cyan/violet palette
    // at low danger toward a hot orange/red palette as speed/difficulty climb
    const coreColor = lerpColorStr(eraRGB([34, 211, 238]), eraRGB([251, 146, 60]), threat);   // cyan -> orange
    const midColor = lerpColorStr(eraRGB([88, 28, 135]), eraRGB([153, 27, 27]), threat);      // violet -> deep red

    const g = ctx.createRadialGradient(VP_X, VP_Y, 4, VP_X, VP_Y, H * 0.95);
    g.addColorStop(0, 'rgba(' + coreColor + ',.16)');
    g.addColorStop(0.35, 'rgba(' + midColor + ',.14)');
    g.addColorStop(0.7, 'rgba(9,16,28,1)');
    g.addColorStop(1, '#030308');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // radiating lanes from the vanishing point to the bottom edge
    ctx.strokeStyle = 'rgba(' + coreColor + ',.10)';
    ctx.lineWidth = 1;
    for (let k = -4; k <= 4; k++) {
      const bx = VP_X + k * (W / 8);
      ctx.beginPath(); ctx.moveTo(VP_X, VP_Y); ctx.lineTo(bx, H); ctx.stroke();
    }

    // scrolling depth rings, closing in toward the viewer — style (solid,
    // dashed, doubled, or zigzag) varies per level era so each zone reads
    // structurally different, not just differently colored
    const ringSpeed = 0.32 * Math.min(2.2, difficulty);
    const ringShape = ERA_RING_SHAPES[currentEraIdx()];
    for (let k = 0; k < 6; k++) {
      const rp = ((tunnelHue * ringSpeed) + k / 6) % 1;
      const lx = VP_X + (0 - VP_X) * rp, rx = VP_X + (W - VP_X) * rp;
      const ry = VP_Y + (PLAYER_Y - VP_Y) * rp;
      const ringAlpha = (0.05 + rp * 0.22).toFixed(3);
      ctx.strokeStyle = 'rgba(' + coreColor + ',' + ringAlpha + ')';
      ctx.lineWidth = 1;
      if (ringShape === 'dashed') {
        ctx.save(); ctx.setLineDash([6, 5]);
        ctx.beginPath(); ctx.moveTo(lx, ry); ctx.lineTo(rx, ry); ctx.stroke();
        ctx.restore();
      } else if (ringShape === 'double') {
        ctx.beginPath(); ctx.moveTo(lx, ry - 2); ctx.lineTo(rx, ry - 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(lx, ry + 2); ctx.lineTo(rx, ry + 2); ctx.stroke();
      } else if (ringShape === 'zigzag') {
        const teeth = 10;
        ctx.beginPath(); ctx.moveTo(lx, ry);
        for (let t = 1; t <= teeth; t++) {
          const tx = lx + (rx - lx) * (t / teeth);
          ctx.lineTo(tx, ry + (t % 2 === 0 ? -3 : 3));
        }
        ctx.stroke();
      } else {
        ctx.beginPath(); ctx.moveTo(lx, ry); ctx.lineTo(rx, ry); ctx.stroke();
      }
    }

    // vanishing-point core glow — grows bigger and brighter, then dims
    // back down to a small point and repeats. Rendered as a soft white
    // "sun": a radial-gradient bloom (genuinely blurred falloff, not just
    // a shadowBlur halo) plus a bright core, rather than tracking the
    // tunnel's threat-driven color.
    const corePulse = 0.5 + 0.5 * Math.sin(tunnelHue * 0.9);
    const coreR = (3.6 + corePulse * 13.5) * 0.7 * 0.5; // 30% smaller, then another 50% on top
    const coreAlpha = 0.22 + corePulse * 0.68;
    const haloR = coreR * 5.5; // much wider soft falloff — reads as more radial blur
    const halo = ctx.createRadialGradient(VP_X, VP_Y, 0, VP_X, VP_Y, haloR);
    halo.addColorStop(0, 'rgba(255,255,255,' + (coreAlpha * 0.9).toFixed(3) + ')');
    halo.addColorStop(0.22, 'rgba(255,255,255,' + (coreAlpha * 0.5).toFixed(3) + ')');
    halo.addColorStop(0.5, 'rgba(255,255,255,' + (coreAlpha * 0.2).toFixed(3) + ')');
    halo.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.fillStyle = halo;
    ctx.arc(VP_X, VP_Y, haloR, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = 'rgba(255,255,255,' + Math.min(1, coreAlpha + 0.2).toFixed(3) + ')';
    ctx.shadowColor = '#fff'; ctx.shadowBlur = (12 + corePulse * 54) * 0.7;
    ctx.arc(VP_X, VP_Y, coreR, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    if (surging) {
      ctx.fillStyle = 'rgba(248,113,113,.08)';
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawHazardStripes(color, y0) {
    const bandH = 14, step = 16;
    ctx.fillStyle = 'rgba(' + color + ',.07)';
    for (let x = -bandH; x < W + bandH; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, y0 + bandH); ctx.lineTo(x + bandH, y0); ctx.lineTo(x + bandH + 6, y0); ctx.lineTo(x + 6, y0 + bandH);
      ctx.closePath(); ctx.fill();
    }
  }

  function drawEraOverlay() {
    // A structural backdrop layer unique to each level era — grid lines,
    // falling code-rain, hazard stripes, rising embers, or scanlines —
    // layered under the gameplay so each zone feels like a different place,
    // not just a hue-shift of the same one. All positions are derived from
    // tunnelHue + a per-item index so nothing needs its own persisted state.
    const overlay = ERA_OVERLAYS[currentEraIdx()];
    if (overlay === 'none') return;
    if (overlay === 'grid') {
      const c = eraRGB([125, 211, 252]).join(',');
      ctx.strokeStyle = 'rgba(' + c + ',.05)'; ctx.lineWidth = 1;
      const cols = 8, rows = 5;
      for (let i = 1; i < cols; i++) { const x = (W / cols) * i; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let j = 1; j < rows; j++) { const y = (H / rows) * j; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    } else if (overlay === 'rain') {
      const c = eraRGB([110, 231, 183]).join(',');
      for (let i = 0; i < 14; i++) {
        const seed = i * 97.13;
        const x = (seed * 37) % W;
        const speed = 40 + (i % 5) * 18;
        const y = ((tunnelHue * speed + seed * 13) % (H + 40)) - 20;
        const len = 14 + (i % 4) * 8;
        ctx.strokeStyle = 'rgba(' + c + ',' + (0.1 + (i % 3) * 0.04).toFixed(3) + ')'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + len); ctx.stroke();
      }
    } else if (overlay === 'stripes') {
      const c = eraRGB([253, 224, 71]).join(',');
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, 14); ctx.clip(); drawHazardStripes(c, 0); ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.rect(0, H - 14, W, 14); ctx.clip(); drawHazardStripes(c, H - 14); ctx.restore();
    } else if (overlay === 'embers') {
      const c = eraRGB([251, 146, 60]).join(',');
      for (let i = 0; i < 16; i++) {
        const seed = i * 53.7;
        const x = (seed * 31) % W + Math.sin(tunnelHue * 2 + seed) * 10;
        const speed = 20 + (i % 5) * 10;
        const y = H - ((tunnelHue * speed + seed * 17) % (H + 30));
        ctx.beginPath();
        ctx.fillStyle = 'rgba(' + c + ',' + (0.18 + (i % 4) * 0.05).toFixed(3) + ')';
        ctx.arc(x, y, 1 + (i % 3), 0, Math.PI * 2); ctx.fill();
      }
    } else if (overlay === 'scanlines') {
      const c = eraRGB([248, 113, 113]).join(',');
      const sweepY = (tunnelHue * 60) % (H + 60) - 30;
      ctx.fillStyle = 'rgba(' + c + ',.05)'; ctx.fillRect(0, sweepY, W, 3);
      ctx.strokeStyle = 'rgba(' + c + ',.02)';
      for (let y = 0; y < H; y += 6) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    }
  }

  // One bespoke set-piece per era, on top of the generic overlay above —
  // these are the elements that make each zone feel like an actual different
  // place (a network relay, a reactor core, a breach in progress) rather than
  // just a different palette on the same grid/rain/stripes/embers/scanlines.
  function drawEraAccent() {
    const idx = currentEraIdx();
    if (idx === 0) {
      // GRID SECTOR — drifting holographic data-node blips, diamonds slowly
      // rising and pulsing, like a circuit board's own telemetry made visible
      const c = eraRGB([125, 211, 252]);
      for (let i = 0; i < 10; i++) {
        const seed = i * 71.3;
        const x = (seed * 41) % W;
        const speed = 10 + (i % 4) * 6;
        const y = H - ((tunnelHue * speed + seed * 19) % (H + 20));
        const pulse = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(tunnelHue * 2.6 + seed));
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4);
        const r = 2 + (i % 3);
        ctx.fillStyle = 'rgba(' + c.join(',') + ',' + (0.1 + pulse * 0.14).toFixed(3) + ')';
        ctx.fillRect(-r, -r, r * 2, r * 2);
        ctx.restore();
      }
    } else if (idx === 1) {
      // RELAY NETWORK — signal pulse rings expanding outward from a couple
      // of fixed relay points flanking the tunnel, like ping sweeps
      const c = eraRGB([232, 121, 249]);
      const relays = [{ lane: VP_X - W * 0.32, p: 0.12 }, { lane: VP_X + W * 0.32, p: 0.12 }];
      relays.forEach((r, ri) => {
        const pos = projectPoint(r.lane, r.p);
        for (let k = 0; k < 3; k++) {
          const rp = ((tunnelHue * 0.45 + k / 3 + ri * 0.4) % 1);
          const rad = 3 + rp * 26;
          ctx.beginPath();
          ctx.strokeStyle = 'rgba(' + c.join(',') + ',' + ((1 - rp) * 0.22).toFixed(3) + ')';
          ctx.lineWidth = 1;
          ctx.arc(pos.x, pos.y, rad, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    } else if (idx === 2) {
      // SERVER FARM — a soft rising data-flow bar near each edge, like
      // activity graphs climbing on a rack readout, on top of the rack silhouettes
      const c = eraRGB([110, 231, 183]);
      [24, W - 24].forEach((x, i) => {
        const barH = 20 + 14 * (0.5 + 0.5 * Math.sin(tunnelHue * (2 + i) + i * 3));
        const g = ctx.createLinearGradient(0, H - barH, 0, H);
        g.addColorStop(0, 'rgba(' + c.join(',') + ',0)');
        g.addColorStop(1, 'rgba(' + c.join(',') + ',.10)');
        ctx.fillStyle = g;
        ctx.fillRect(x - 5, H - barH, 10, barH);
      });
    } else if (idx === 3) {
      // HAZARD ZONE — a slow amber warning strobe sweeping across the frame,
      // layered with the existing hazard-stripe overlay
      const c = eraRGB([253, 224, 71]);
      const sweep = 0.5 + 0.5 * Math.sin(tunnelHue * 1.6);
      if (sweep > 0.82) {
        ctx.fillStyle = 'rgba(' + c.join(',') + ',' + ((sweep - 0.82) * 0.6).toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);
      }
    } else if (idx === 4) {
      // REACTOR CORE — pulsing concentric rings breathing out from the
      // vanishing point, like a containment field cycling
      const c = eraRGB([251, 146, 60]);
      for (let k = 0; k < 3; k++) {
        const rp = (tunnelHue * 0.3 + k / 3) % 1;
        const rad = 6 + rp * 70;
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(' + c.join(',') + ',' + ((1 - rp) * 0.18).toFixed(3) + ')';
        ctx.lineWidth = 1.4;
        ctx.arc(VP_X, VP_Y, rad, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (idx === 5) {
      // BREACH ZONE — short-lived glitch-tear slices: thin horizontal bands
      // of the frame get yanked sideways with a chromatic split, on top of
      // the scanline sweep, selling active system corruption
      if (Math.sin(tunnelHue * 7.3) > 0.75) {
        const c1 = eraRGB([248, 113, 113]), c2 = eraRGB([34, 211, 238]);
        const y = ((tunnelHue * 130) % H) | 0;
        const th = 3 + (Math.sin(tunnelHue * 30) > 0 ? 3 : 0);
        const shift = 4 + Math.sin(tunnelHue * 40) * 4;
        ctx.fillStyle = 'rgba(' + c1.join(',') + ',.10)';
        ctx.fillRect(shift, y, W, th);
        ctx.fillStyle = 'rgba(' + c2.join(',') + ',.10)';
        ctx.fillRect(-shift, y + th, W, th);
      }
    }
  }

  function drawStarfield() {
    // faint parallax stars for extra depth, tinted with the level era
    const c = eraRGB([224, 242, 254]);
    stars.forEach((s) => {
      const tw = 0.35 + 0.4 * (0.5 + 0.5 * Math.sin(tunnelHue * 3 + s.seed));
      ctx.beginPath();
      ctx.fillStyle = 'rgba(' + c.join(',') + ',' + (tw * 0.5).toFixed(3) + ')';
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawWarpStreaks() {
    const count = 5 + Math.floor(threat * 9) + (surging ? 5 : 0);
    const speedMul = 0.5 + threat * 1.1 + (surging ? 0.6 : 0);
    for (let i = 0; i < count; i++) {
      const laneK = (i % 9) - 4;
      const bx = VP_X + laneK * (W / 8);
      const rp = ((tunnelHue * speedMul * 0.5) + i * 0.61803) % 1;
      const p1 = rp, p2 = Math.max(0, rp - 0.06);
      const a = projectPoint(bx, p1), b = projectPoint(bx, p2);
      ctx.strokeStyle = 'rgba(' + eraRGB([232, 121, 249]).join(',') + ',' + (0.12 + rp * 0.32).toFixed(3) + ')';
      ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  }

  function drawSkyline() {
    // City-skyline silhouettes flanking the tunnel — but shaped like circuit
    // components (chip packages, capacitors, diodes, resistors) instead of
    // buildings, drifting past on both sides as the run progresses.
    const colorSets = {
      chip: eraRGB([125, 211, 252]).join(','), capacitor: eraRGB([196, 181, 253]).join(','),
      diode: eraRGB([110, 231, 183]).join(','), resistor: eraRGB([253, 224, 71]).join(','),
      antenna: eraRGB([232, 121, 249]).join(','), tower: eraRGB([148, 163, 184]).join(','),
      rack: eraRGB([148, 163, 184]).join(','), girder: eraRGB([253, 224, 71]).join(','),
    };
    skylineParts.slice().sort((a, b) => b.z - a.z).forEach((s) => {
      const p = skylineZtoP(s.z);
      if (p < 0 || p > 1) return;
      const lane = VP_X + s.side * s.laneOffset * (W / 8);
      const pos = projectPoint(lane, p);
      const depthScale = 0.12 + p * 0.95;
      const h = 30 * s.scale * depthScale;
      const w = 16 * s.scale * depthScale;
      const alpha = 0.08 + p * 0.2;
      const color = colorSets[s.kind] || '148,163,184';
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.fillStyle = 'rgba(' + color + ',' + alpha.toFixed(3) + ')';
      ctx.strokeStyle = 'rgba(' + color + ',' + (alpha + 0.16).toFixed(3) + ')';
      ctx.lineWidth = Math.max(0.6, depthScale);
      if (s.kind === 'chip') {
        ctx.fillRect(-w / 2, -h, w, h);
        ctx.strokeRect(-w / 2, -h, w, h);
        const pins = 4;
        for (let i = 0; i < pins; i++) {
          const px = -w / 2 + (i + 0.5) * (w / pins);
          ctx.beginPath(); ctx.moveTo(px, -h); ctx.lineTo(px, -h - 3 * depthScale); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, 3 * depthScale); ctx.stroke();
        }
      } else if (s.kind === 'capacitor') {
        const r = w / 2;
        ctx.beginPath();
        ctx.moveTo(-r, 0);
        ctx.lineTo(-r, -h + r);
        ctx.arc(0, -h + r, r, Math.PI, 0);
        ctx.lineTo(r, 0);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
      } else if (s.kind === 'diode') {
        ctx.fillRect(-w / 2, -h, w, h);
        ctx.strokeRect(-w / 2, -h, w, h);
        ctx.fillStyle = 'rgba(' + color + ',' + (alpha + 0.3).toFixed(3) + ')';
        ctx.fillRect(-w / 2, -h + h * 0.2, w, Math.max(1, h * 0.08));
      } else if (s.kind === 'antenna') {
        // a thin mast with a small dish and a blinking tip light
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -h); ctx.lineWidth = Math.max(0.6, depthScale * 0.8); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-w * 0.35, -h * 0.55); ctx.lineTo(w * 0.35, -h * 0.55); ctx.stroke();
        const blink = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(tunnelHue * 6 + s.seed));
        ctx.beginPath();
        ctx.fillStyle = 'rgba(' + color + ',' + Math.min(1, alpha + blink * 0.6).toFixed(3) + ')';
        ctx.arc(0, -h, Math.max(1, w * 0.14), 0, Math.PI * 2); ctx.fill();
      } else if (s.kind === 'tower') {
        // a tapered lattice tower — a couple of crossbars between two slanted legs
        ctx.beginPath();
        ctx.moveTo(-w / 2, 0); ctx.lineTo(-w * 0.14, -h); ctx.lineTo(w * 0.14, -h); ctx.lineTo(w / 2, 0);
        ctx.stroke();
        for (let i = 1; i <= 2; i++) {
          const yy = -h * (i / 3);
          const ww = (w / 2) * (1 - i / 3.4);
          ctx.beginPath(); ctx.moveTo(-ww, yy); ctx.lineTo(ww, yy); ctx.stroke();
        }
      } else if (s.kind === 'rack') {
        // a server rack — stacked blade units, each with its own asynchronously
        // blinking status LED so the "server farm" era reads as actual machines
        // idling out there, not just another silhouette shape
        ctx.fillRect(-w / 2, -h, w, h);
        ctx.strokeRect(-w / 2, -h, w, h);
        const blades = 5;
        for (let i = 0; i < blades; i++) {
          const by = -h + (h / blades) * (i + 0.15);
          const bh = (h / blades) * 0.7;
          ctx.strokeStyle = 'rgba(' + color + ',' + (alpha + 0.1).toFixed(3) + ')';
          ctx.strokeRect(-w / 2 + w * 0.08, by, w * 0.84, bh);
          const blink = 0.5 + 0.5 * Math.sin(tunnelHue * (3 + i * 1.7) + s.seed + i);
          const ledColor = blink > 0.55 ? eraRGB([110, 231, 183]) : eraRGB([248, 113, 113]);
          ctx.beginPath();
          ctx.fillStyle = 'rgba(' + ledColor.join(',') + ',' + Math.min(1, alpha + 0.5).toFixed(3) + ')';
          ctx.arc(w / 2 - w * 0.18, by + bh / 2, Math.max(0.6, w * 0.05), 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (s.kind === 'girder') {
        // an industrial cross-braced support beam — two uprights with a
        // zigzagging lattice of diagonal braces between them, hazard-zone flavor
        ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(-w / 2, -h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, -h); ctx.stroke();
        const braces = 4;
        for (let i = 0; i < braces; i++) {
          const y0 = -h * (i / braces), y1 = -h * ((i + 1) / braces);
          ctx.beginPath();
          if (i % 2 === 0) { ctx.moveTo(-w / 2, y0); ctx.lineTo(w / 2, y1); }
          else { ctx.moveTo(w / 2, y0); ctx.lineTo(-w / 2, y1); }
          ctx.stroke();
        }
        // a slow amber warning light at the top, same cadence as the era's strobe
        const warn = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(tunnelHue * 2.4 + s.seed));
        ctx.beginPath();
        ctx.fillStyle = 'rgba(' + color + ',' + Math.min(1, warn).toFixed(3) + ')';
        ctx.arc(0, -h, Math.max(1, w * 0.12), 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillRect(-w / 2, -h, w, h);
        ctx.strokeRect(-w / 2, -h, w, h);
        const stripes = [eraRGB([248, 113, 113]).join(','), eraRGB([232, 121, 249]).join(','), eraRGB([34, 211, 238]).join(',')];
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = 'rgba(' + stripes[i] + ',' + (alpha + 0.25).toFixed(3) + ')';
          ctx.fillRect(-w / 2, -h + h * (0.25 + i * 0.2), w, Math.max(1, h * 0.08));
        }
      }
      ctx.restore();
    });
  }

  // Eased perspective scale shared by every circuit-floor element: tiny at
  // the vanishing point (p=0), growing to `regular` up close (p=1). The
  // >1 exponent keeps things small for most of the distance and only
  // grows quickly right near the front — reads as actual distance rather
  // than a flat near-to-far ramp.
  function perspSize(p, regular) {
    return regular * 0.15 + Math.pow(p, 1.6) * regular * 0.85;
  }
  function drawCircuitFloor(boost) {
    boost = boost || 1;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // a slow, shared breathing pulse on every glow below — ties the whole
    // circuit floor together instead of each element glowing at one flat,
    // static intensity the whole time
    const glowPulse = 0.6 + 0.4 * Math.sin(tunnelHue * 1.6);
    circuitTraces.forEach((t) => {
      const nearP = t.pts[t.pts.length - 1].p;
      // each trace's cool base hue (violet or magenta) shifts toward
      // orange/red as threat rises, matching the tunnel background
      const cool = eraRGB(t.hue === 'violet' ? [167, 139, 250] : [232, 121, 249]);
      const warm = eraRGB(t.hue === 'violet' ? [249, 115, 22] : [239, 68, 68]);
      const color = lerpColorStr(cool, warm, threat);

      // each segment drawn (and tapered) separately, rather than one
      // constant-width stroke for the whole trace — about half the old
      // regular width up close (0.6px vs 1.2px), thinning to barely-there
      // near the vanishing point
      for (let i = 0; i < t.pts.length - 1; i++) {
        const a = t.pts[i], b = t.pts[i + 1];
        const segP = (a.p + b.p) / 2;
        const sa = projectPoint(a.lane, a.p), sb = projectPoint(b.lane, b.p);
        const fade = Math.min(1, (0.06 + Math.pow(segP, 1.6) * 0.15) * boost);
        ctx.beginPath();
        ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y);
        ctx.strokeStyle = 'rgba(' + color + ',' + fade.toFixed(3) + ')';
        ctx.lineWidth = perspSize(segP, 0.6) * boost;
        ctx.shadowColor = 'rgb(' + color + ')'; ctx.shadowBlur = 3 * boost * glowPulse;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // solder-pad vias at each waypoint — tiny out near the vanishing
      // point, growing to about half their old size up close
      t.pts.forEach((pt) => {
        const s = projectPoint(pt.lane, pt.p);
        const r = perspSize(pt.p, 1.55) * boost;
        const fade = Math.min(1, (0.09 + Math.pow(pt.p, 1.6) * 0.12) * boost + 0.12 * boost);
        ctx.beginPath();
        ctx.fillStyle = 'rgba(' + color + ',' + fade.toFixed(3) + ')';
        ctx.shadowColor = 'rgb(' + color + ')'; ctx.shadowBlur = 5 * boost * glowPulse;
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      // a pulse of "current" traveling along the trace toward the player —
      // shifts with the level era like the rest of the circuit floor
      const pulse = pointAlongTrace(t, t.phase);
      const pulseR = perspSize(nearP, 1.75) * Math.min(1.6, boost);
      const pulseColor = 'rgb(' + eraRGB([232, 121, 249]).join(',') + ')';
      ctx.beginPath();
      ctx.fillStyle = pulseColor;
      ctx.shadowColor = pulseColor; ctx.shadowBlur = 8 * boost * glowPulse;
      ctx.arc(pulse.x, pulse.y, pulseR, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    });
  }

  function drawCodeBits() {
    ctx.textAlign = 'center';
    codeBits.forEach((c) => {
      const s = projectPoint(c.lane, Math.min(1, c.p));
      const fade = Math.sin(Math.min(1, c.p) * Math.PI); // fades in, peaks mid-tunnel, fades out
      const size = 8 + Math.min(1, c.p) * 6;
      ctx.font = size.toFixed(1) + 'px "JetBrains Mono", monospace';
      // kept strictly in the violet/magenta family — cyan and red stay reserved for
      // the actual pickups/hazards so the background never competes with them
      ctx.fillStyle = (c.hue === 'violet' ? 'rgba(167,139,250,' : 'rgba(232,121,249,') + (fade * 0.22).toFixed(3) + ')';
      ctx.fillText(c.token, s.x, s.y);
    });
    ctx.textAlign = 'left';
  }

  function drawItem(it) {
    const p = 1 - it.z;
    if (it.type === 'good') {
      const wobble = Math.sin(tunnelHue * 4 + it.seed) * 0.15;
      ctx.save();
      ctx.translate(it.x, it.y);
      ctx.rotate(tunnelHue * it.spin * 0.4 + wobble);
      ctx.beginPath();
      ctx.fillStyle = '#22D3EE'; ctx.shadowColor = '#22D3EE'; ctx.shadowBlur = 10 * (it.r / it.baseR + 0.3);
      ctx.moveTo(0, -it.r); ctx.lineTo(it.r * 0.72, 0); ctx.lineTo(0, it.r); ctx.lineTo(-it.r * 0.72, 0);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(240,255,255,.7)'; ctx.lineWidth = Math.max(0.6, it.r * 0.06);
      ctx.stroke();
      ctx.restore();
      ctx.shadowBlur = 0;
    } else if (it.boss) {
      // mini-boss: FIREWALL is a static hexagonal shield; WORM is a softer
      // snaking blob (drawn as a rounded diamond) in violet to read as a
      // different threat type while it weaves across lanes
      const bossColor = it.worm ? '#818CF8' : COL_BAD;
      ctx.save();
      ctx.translate(it.x, it.y);
      ctx.rotate(Math.sin(tunnelHue * 1.5 + it.seed) * 0.06);
      ctx.beginPath();
      if (it.worm) {
        const sides = 4;
        for (let k = 0; k < sides; k++) {
          const a = (Math.PI / 2) * k;
          const wob = 1 + Math.sin(tunnelHue * 5 + it.seed + k) * 0.12;
          const px = Math.cos(a) * it.r * wob, py = Math.sin(a) * it.r * wob;
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
      } else {
        for (let k = 0; k < 6; k++) {
          const a = (Math.PI / 3) * k - Math.PI / 6;
          const px = Math.cos(a) * it.r, py = Math.sin(a) * it.r;
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
      }
      ctx.closePath();
      ctx.fillStyle = bossColor; ctx.shadowColor = bossColor; ctx.shadowBlur = 14 * (it.r / it.baseR + 0.3);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(240,248,255,.85)'; ctx.lineWidth = Math.max(1, it.r * 0.08);
      ctx.stroke();
      ctx.restore();
      if (p > 0.25) {
        const pipW = Math.max(3, it.r * 0.35);
        const startX = it.x - ((it.maxHp - 1) * pipW) / 2;
        for (let k = 0; k < it.maxHp; k++) {
          ctx.fillStyle = k < it.hp ? '#F0F8FF' : 'rgba(240,248,255,.25)';
          ctx.fillRect(startX + k * pipW - pipW * 0.35, it.y - it.r - 12, pipW * 0.7, 3);
        }
      }
    } else {
      // corrupted fragment: jittery glitch-square with a flickering fault line through it
      const jitter = (Math.sin(it.glitchT * 40 + it.seed) > 0.7) ? (Math.random() - 0.5) * it.r * 0.5 : 0;
      ctx.save();
      ctx.translate(it.x + jitter, it.y);
      ctx.rotate(Math.PI / 4 + Math.sin(tunnelHue * 2 + it.seed) * 0.08);
      ctx.fillStyle = COL_BAD; ctx.shadowColor = COL_BAD; ctx.shadowBlur = 10 * (it.r / it.baseR + 0.3);
      ctx.fillRect(-it.r, -it.r, it.r * 2, it.r * 2);
      ctx.shadowBlur = 0;
      if (Math.sin(it.glitchT * 30 + it.seed) > 0.4) {
        ctx.fillStyle = 'rgba(3,8,17,.65)';
        ctx.fillRect(-it.r, -it.r * 0.2, it.r * 2, it.r * 0.3);
      }
      ctx.restore();
    }
    // a code-token tag riding just above the item once it's close enough to read
    if (p > 0.3 && it.token) {
      const jag = it.type === 'bad' && Math.sin(it.glitchT * 50 + it.seed) > 0.75;
      ctx.font = Math.max(8, 8 + p * 5).toFixed(1) + 'px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = it.type === 'good'
        ? 'rgba(34,211,238,' + (0.5 + p * 0.4).toFixed(3) + ')'
        : 'rgba(248,113,113,' + (0.5 + p * 0.4).toFixed(3) + ')';
      ctx.fillText(it.token, it.x + (jag ? (Math.random() - 0.5) * 3 : 0), it.y - it.r - 5);
      ctx.textAlign = 'left';
    }
  }

  function drawPlayerTrail() {
    if (playerTrail.length < 2) return;
    const c = eraRGB([232, 121, 249]);
    playerTrail.forEach((pt) => {
      const k = 1 - pt.t / 0.35;
      if (k <= 0) return;
      ctx.beginPath();
      ctx.fillStyle = 'rgba(' + c.join(',') + ',' + (k * 0.35).toFixed(3) + ')';
      ctx.arc(pt.x, pt.y, PLAYER_W * 0.18 * k, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawGhost() {
    if (!ghostPlayback) return;
    const gx = ghostXAtElapsed(elapsed);
    if (gx === null) return;
    ctx.save();
    ctx.translate(gx, PLAYER_Y);
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(232,121,249,.8)';
    ctx.lineWidth = 1.4;
    ctx.moveTo(0, -PLAYER_H / 2);
    ctx.lineTo(PLAYER_W / 2, PLAYER_H / 2 - 4);
    ctx.lineTo(PLAYER_W * 0.18, PLAYER_H / 2);
    ctx.lineTo(-PLAYER_W * 0.18, PLAYER_H / 2);
    ctx.lineTo(-PLAYER_W / 2, PLAYER_H / 2 - 4);
    ctx.closePath(); ctx.stroke();
    ctx.restore();
  }
  function drawPlayer() {
    const lean = Math.max(-0.5, Math.min(0.5, -playerVX * 0.0016));
    const flickering = invulnTimer > 0 && Math.floor(invulnTimer * 16) % 2 === 0;
    if (flickering) return; // brief hit-flicker to signal temporary invulnerability
    const critical = !dying && threat >= RED_THREAT;
    ctx.save();
    ctx.translate(playerX, PLAYER_Y);
    ctx.rotate(lean);
    ctx.beginPath();
    ctx.fillStyle = dying ? COL_BAD : '#F0F8FF';
    ctx.shadowColor = dying ? COL_BAD : (critical ? COL_BAD : '#7DD3FC');
    ctx.shadowBlur = critical ? 12 + Math.sin(tunnelHue * 10) * 5 : 12;
    ctx.moveTo(0, -PLAYER_H / 2);
    ctx.lineTo(PLAYER_W / 2, PLAYER_H / 2 - 4);
    ctx.lineTo(PLAYER_W * 0.18, PLAYER_H / 2);
    ctx.lineTo(-PLAYER_W * 0.18, PLAYER_H / 2);
    ctx.lineTo(-PLAYER_W / 2, PLAYER_H / 2 - 4);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = critical ? 'rgba(248,113,113,.9)' : 'rgba(34,211,238,.9)';
    ctx.lineWidth = 1.5; ctx.stroke();
    ctx.shadowBlur = 0;
    if (shieldTimer > 0) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(129,140,248,' + (0.5 + Math.sin(tunnelHue * 6) * 0.25).toFixed(3) + ')';
      ctx.lineWidth = 1.4;
      ctx.arc(0, -2, PLAYER_W * 0.62, tunnelHue * 2, tunnelHue * 2 + Math.PI * 1.5);
      ctx.stroke();
    }
    if (charging && chargeTimer > CHARGE_TAP_MAX) {
      const k = Math.min(1, chargeTimer / (unlocks.overcharge ? CHARGE_MAX_OVERCHARGED : CHARGE_MAX));
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(232,121,249,' + (0.3 + k * 0.5).toFixed(3) + ')';
      ctx.lineWidth = 1.5 + k * 2;
      ctx.arc(0, -PLAYER_H * 0.3, PLAYER_W * 0.5 + k * 10, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawParticles() {
    particles.forEach((p) => {
      const a = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function drawFizzles() {
    fizzles.forEach((f) => {
      const k = f.t / FIZZLE_DUR;
      const r = f.r * (1 - k * 0.4);
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - k);
      ctx.translate(f.x, f.y);
      ctx.rotate(Math.PI / 4);
      const slices = 4;
      for (let s = 0; s < slices; s++) {
        const sy = -r + (s / slices) * r * 2;
        const sh = (r * 2) / slices;
        const drift = Math.sin(f.seed + s * 3 + k * 18) * k * r * 0.9;
        ctx.fillStyle = COL_BAD;
        ctx.fillRect(-r + drift, sy, r * 2, sh * 0.65);
      }
      ctx.restore();
    });
    ctx.globalAlpha = 1;
  }

  function drawProjectiles() {
    projectiles.forEach((pr) => {
      const power = pr.power || 0;
      ctx.save();
      ctx.beginPath();
      ctx.fillStyle = '#F0F8FF';
      ctx.shadowColor = '#E879F9'; ctx.shadowBlur = 10 + power * 10;
      ctx.arc(pr.x, pr.y, 3.2 + power * 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
    });
  }

  const POWERUP_GLYPH = { rapid: 'R', magnet: 'M', shield: 'S', slow: 'T', score: '$', overload: 'O' };
  const POWERUP_COLOR = { rapid: '#E879F9', magnet: '#22D3EE', shield: '#818CF8', slow: '#7DD3FC', score: '#F59E0B', overload: '#F59E0B' };
  function drawPowerups() {
    powerups.forEach((pu) => {
      const hue = (tunnelHue * 90 + pu.seed) % 360;
      ctx.save();
      ctx.translate(pu.x, pu.y);
      ctx.rotate(tunnelHue * 1.4);
      ctx.beginPath();
      ctx.strokeStyle = 'hsl(' + hue.toFixed(0) + ',90%,68%)';
      ctx.lineWidth = 1.6;
      ctx.shadowColor = POWERUP_COLOR[pu.type]; ctx.shadowBlur = 10;
      const r = pu.r;
      ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0); ctx.closePath();
      ctx.fillStyle = POWERUP_COLOR[pu.type] + '33';
      ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();
      if (pu.r > 5) {
        ctx.font = Math.max(8, pu.r).toFixed(1) + 'px "JetBrains Mono", monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#F0F8FF';
        ctx.fillText(POWERUP_GLYPH[pu.type], pu.x, pu.y + 0.5);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      }
    });
  }

  function drawFloatTexts() {
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    floatTexts.forEach((f) => {
      ctx.globalAlpha = Math.max(0, f.life / f.maxLife);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    });
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }

  function drawShockwaves() {
    shockwaves.forEach((s) => {
      const a = Math.max(0, 1 - s.life / s.maxLife);
      ctx.beginPath();
      ctx.strokeStyle = s.color; ctx.globalAlpha = a * 0.7; ctx.lineWidth = 2.2;
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }

  function mixCyanMagenta(t) {
    const c1 = [34, 211, 238], c2 = [232, 121, 249];
    const r = Math.round(c1[0] + (c2[0] - c1[0]) * t);
    const gg = Math.round(c1[1] + (c2[1] - c1[1]) * t);
    const b = Math.round(c1[2] + (c2[2] - c1[2]) * t);
    return 'rgb(' + r + ',' + gg + ',' + b + ')';
  }

  function drawHUD() {
    const m = 10, bl = 15;
    // The corner DOM buttons (TILT/mute/fullscreen/fire) are a fixed real
    // CSS size regardless of how big the canvas is drawn on screen, but
    // this HUD text lives in the canvas's fixed 480x360 logical coordinate
    // space, which gets stretched to fit whatever size the canvas is
    // displayed at. In fullscreen landscape the canvas is now stretched
    // non-uniformly (full-bleed fill, not a locked 4:3 box), so width and
    // height scale by different amounts — convert the ~34px real button
    // footprint into logical units separately for each axis instead of
    // reusing one scale for both, so corner readouts clear the buttons
    // correctly at any display size/aspect.
    const rect = canvas.getBoundingClientRect();
    const dispScaleX = rect.width > 0 ? (W / rect.width) : 1;
    const dispScaleY = rect.height > 0 ? (H / rect.height) : 1;
    const btnPx = 34; // real button footprint (circle diameter / chip height), in CSS px
    const clearX = m + btnPx * dispScaleX;
    const clearY = m + btnPx * dispScaleY;

    // corner targeting brackets with a small accent dot at each vertex
    ctx.strokeStyle = 'rgba(232,121,249,.6)';
    ctx.lineWidth = 1.5;
    [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]].forEach(([x, y, dx, dy]) => {
      ctx.beginPath();
      ctx.moveTo(x, y + bl * dy); ctx.lineTo(x, y); ctx.lineTo(x + bl * dx, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.fillStyle = 'rgba(232,121,249,.85)';
      ctx.arc(x + dx * 3, y + dy * 3, 1.3, 0, Math.PI * 2);
      ctx.fill();
    });

    // scanline sweep — a soft magenta band drifting down the whole frame, CRT-style
    const scanY = ((elapsed * 34) % (H + 30)) - 15;
    const sg = ctx.createLinearGradient(0, scanY - 7, 0, scanY + 7);
    sg.addColorStop(0, 'rgba(232,121,249,0)');
    sg.addColorStop(0.5, 'rgba(232,121,249,.10)');
    sg.addColorStop(1, 'rgba(232,121,249,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, scanY - 7, W, 14);

    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(125,211,252,.8)';
    ctx.fillText('LVL ' + level + '  ·  ' + currentEraName(), clearX + 6, clearY);

    // live score readout, top-center — replaces the old SYS status text
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(34,211,238,.85)';
    ctx.fillText('SCORE: ' + score, W / 2, m + 12);

    // streak — consecutive clean catches since the last hit, with its combo multiplier
    const comboMult = 1 + Math.min(COMBO_MAX_MULT - 1, Math.floor(streak / COMBO_STEP));
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(196,181,253,.75)';
    ctx.fillText('STREAK ' + streak + (comboMult > 1 ? '  ×' + comboMult : ''), m + bl + 6, H - clearY + m);

    // invulnerability readout, only while it's active (distinct from the SHIELD power-up)
    if (invulnTimer > 0) {
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(125,211,252,' + (0.4 + Math.sin(tunnelHue * 14) * 0.3).toFixed(3) + ')';
      ctx.fillText('INVULN', W - m - bl - 6, H - clearY + m);
    }

    // surge warning takes priority over the power-up readout on the same line
    if (surging) {
      ctx.textAlign = 'center';
      ctx.fillStyle = Math.sin(tunnelHue * 10) > 0 ? 'rgba(248,113,113,.95)' : 'rgba(248,113,113,.4)';
      ctx.fillText('⚠ BREACH SURGE', W / 2, clearY + 13);
    } else {
      const puParts = [];
      if (rapidTimer > 0) puParts.push('RAPID ' + rapidTimer.toFixed(1));
      if (magnetTimer > 0) puParts.push('MAGNET ' + magnetTimer.toFixed(1));
      if (shieldTimer > 0) puParts.push('SHIELD ' + shieldTimer.toFixed(1));
      if (slowTimer > 0) puParts.push('DILATION ' + slowTimer.toFixed(1));
      if (overloadReady) puParts.push('OVERLOAD READY');
      if (puParts.length) {
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(232,121,249,.75)';
        ctx.fillText(puParts.join('   '), W / 2, clearY + 13);
      }
    }

    const segs = 10, segW = 7, segH = 8, gap = 2;
    const totalW = segs * segW + (segs - 1) * gap;
    const startX = W - m - bl - 6 - totalW;
    const filled = Math.round(threat * segs);
    // THREAT sits under three side-by-side buttons (pause, fullscreen,
    // mute) in that corner, so it needs real extra vertical clearance
    // beyond the single-button baseline, not just a small nudge.
    const threatClear = clearY + 26 * dispScaleY;
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(232,121,249,.75)';
    ctx.fillText('THREAT', startX - 6, threatClear);
    for (let i = 0; i < segs; i++) {
      const x = startX + i * (segW + gap);
      const segT = i / segs;
      let color = 'rgba(148,163,184,.12)';
      if (i < filled) {
        if (segT >= RED_THREAT) {
          const pulse = 0.6 + Math.sin(tunnelHue * 12 + i) * 0.4;
          color = 'rgba(248,113,113,' + pulse.toFixed(3) + ')';
        } else {
          color = mixCyanMagenta(Math.min(1, segT / RED_THREAT));
        }
      }
      ctx.fillStyle = color;
      ctx.fillRect(x, threatClear - 8, segW, segH);
    }
    ctx.textAlign = 'left';
  }

  // Background-only render used for the "attract mode" loop that plays
  // behind the title gate / menu / game-over screens — the exact same
  // background layers real gameplay's draw() uses (same functions, same
  // arguments, no idle-specific boosts or extra effects), just without
  // the player, items, projectiles, particles, or HUD on top.
  function drawAmbientBackground() {
    drawTunnel();
    drawEraOverlay();
    drawEraAccent();
    drawStarfield();
    drawSkyline();
    drawWarpStreaks();
    drawCircuitFloor();
    drawCodeBits();
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.85);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,.6)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  function idleLoop(ts) {
    if (running) { idleRafId = null; return; }
    const dt = Math.min(0.05, (ts - idleLastTime) / 1000 || 0);
    idleLastTime = ts;
    tunnelHue += dt; // same rate real gameplay runs at, for an exact visual match
    // the circuit floor's "current" pulses only ever advanced inside real
    // gameplay's update() loop, so without this they sat completely frozen
    // on the title screen the whole time — this is the same line update()
    // runs, just driven off the idle loop's own dt instead
    circuitTraces.forEach((t) => { t.phase = (t.phase + t.speed * dt) % 1; });
    ctx.clearRect(0, 0, W, H);
    drawAmbientBackground();
    idleRafId = requestAnimationFrame(idleLoop);
  }

  function startIdleAnim() {
    if (running || idleRafId) return;
    idleLastTime = performance.now();
    idleRafId = requestAnimationFrame(idleLoop);
  }

  function stopIdleAnim() {
    if (idleRafId) { cancelAnimationFrame(idleRafId); idleRafId = null; }
  }

  function draw() {
    ctx.save();
    const shakeAmt = shakeMag * SHAKE_SCALE;
    if (shakeAmt > 0.3) {
      ctx.translate((Math.random() - 0.5) * shakeAmt, (Math.random() - 0.5) * shakeAmt);
    }

    drawTunnel();
    drawEraOverlay();
    drawEraAccent();
    drawStarfield();
    drawSkyline();
    drawWarpStreaks();
    drawCircuitFloor();
    drawCodeBits();

    drawPlayerTrail();
    items.slice().sort((a, b) => a.z - b.z).reverse().forEach(drawItem);
    drawPowerups();
    drawFizzles();
    drawShockwaves();
    drawProjectiles();
    drawParticles();
    drawGhost();
    drawPlayer();
    drawFloatTexts();

    // vignette
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.85);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    if (flash > 0) {
      ctx.fillStyle = 'rgba(248,113,113,' + (flash * 0.45).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }

    if (eraFlashTimer > 0) {
      // a brief flash + chromatic bar to sell the level-era color shift,
      // instead of leaving it as a gradual, easy-to-miss change
      const k = eraFlashTimer / 0.6;
      ctx.fillStyle = 'rgba(' + eraRGB([240, 248, 255]).join(',') + ',' + (k * 0.5).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
      const barY = (Math.random() * H) | 0;
      ctx.fillStyle = 'rgba(' + eraRGB([232, 121, 249]).join(',') + ',' + (k * 0.4).toFixed(3) + ')';
      ctx.fillRect(0, barY, W, 6);
    }

    // a cheap chromatic-fringe edge glitch once things get critical
    if (!dying && threat >= RED_THREAT) {
      const fringe = 0.1 + Math.sin(tunnelHue * 8) * 0.05;
      ctx.fillStyle = 'rgba(248,113,113,' + fringe.toFixed(3) + ')';
      ctx.fillRect(0, 0, 4, H);
      ctx.fillStyle = 'rgba(34,211,238,' + fringe.toFixed(3) + ')';
      ctx.fillRect(W - 4, 0, 4, H);
    }
    ctx.restore();

    drawHUD(); // fixed instrument overlay — stays steady even while the world shakes
    if (paused) drawPauseOverlay();
  }

  function drawPauseOverlay() {
    ctx.save();
    ctx.fillStyle = 'rgba(3,8,17,.72)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#F0F8FF';
    ctx.font = '600 22px "Syne", sans-serif';
    ctx.shadowColor = '#22D3EE'; ctx.shadowBlur = 14;
    ctx.fillText('PAUSED', W / 2, H / 2 - 6);
    ctx.shadowBlur = 0;
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(224,242,254,.7)';
    ctx.fillText('tap pause or press P to resume', W / 2, H / 2 + 18);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  function loop(ts) {
    if (!running) return;
    const dt = Math.min(0.05, (ts - lastTime) / 1000 || 0);
    lastTime = ts;
    if (!paused) update(dt);
    if (running) draw();
    rafId = requestAnimationFrame(loop);
  }

  function start() {
    stopIdleAnim();
    reset();
    overlay.hidden = true;
    scoreEntry.hidden = true;
    submitNote.textContent = '';
    overlayTitle.classList.remove('gt-over');
    running = true;
    syncFullscreenLabel();
    lastTime = performance.now();
    if (pillText) pillText.textContent = 'HUNTING';
    if (quitBtn) quitBtn.hidden = false;
    if (quitBtnFs) quitBtnFs.hidden = false;
    if (pauseBtn) { pauseBtn.hidden = false; setPauseIcon(false); pauseBtn.setAttribute('aria-label', 'Pause'); }
    if (settingsBtn) settingsBtn.hidden = false;
    if (shareBtn) shareBtn.hidden = true;
    if (statsDetailEl) statsDetailEl.hidden = true;
    ensureAudio();
    startAmbient();
    rafId = requestAnimationFrame(loop);
  }

  function gameOver() {
    running = false;
    syncFullscreenLabel();
    dying = false;
    if (rafId) cancelAnimationFrame(rafId);
    stopAmbient();
    startMenuMusic();
    if (quitBtn) quitBtn.hidden = true;
    if (quitBtnFs) quitBtnFs.hidden = true;
    if (pauseBtn) pauseBtn.hidden = true;
    if (settingsBtn) settingsBtn.hidden = true;
    if (score > best) {
      best = score;
      localStorage.setItem('ghostwireBest', String(best));
      bestStatEl.innerHTML = 'best: <strong>' + best + '</strong>';
    }
    saveGhostIfBest(pendingZone, score, ghostRecording);
    if (isDailyChallenge) {
      if (score > dailyBest) saveDailyBest(score);
      disableDailySeed();
      isDailyChallenge = false;
    }
    overlay.hidden = false;
    overlayTitle.textContent = 'Connection Corrupted';
    overlayTitle.classList.add('gt-over');
    overlaySub.textContent = 'Purge failed — final score: ' + score + '  ·  reached level ' + level;
    updateZoneLocks();
    scoreEntry.hidden = false;
    if (statsDetailEl) {
      const accuracy = shotsFired > 0 ? Math.round((shotsHit / shotsFired) * 100) : 0;
      const eraName = currentEraName();
      statsDetailEl.textContent = 'Longest streak: ' + longestStreak + '  ·  Accuracy: ' + accuracy + '%  ·  Era: ' + eraName;
      statsDetailEl.hidden = false;
      if (shotsFired >= 20 && accuracy >= 90) unlockAchievement('sharpshooter');
    }
    if (shareBtn) { shareBtn.hidden = false; shareBtn.textContent = '\u21EA Share Score'; }
    if (pillText) pillText.textContent = 'CORRUPTED';
    startIdleAnim();
  }

  function quitGame() {
    if (!running && !dying) return;
    running = false;
    syncFullscreenLabel();
    dying = false;
    if (rafId) cancelAnimationFrame(rafId);
    stopAmbient();
    stopRadio();
    startMenuMusic();
    saveGhostIfBest(pendingZone, score, ghostRecording);
    if (isDailyChallenge) { disableDailySeed(); isDailyChallenge = false; }
    if (quitBtn) quitBtn.hidden = true;
    if (quitBtnFs) quitBtnFs.hidden = true;
    if (pauseBtn) pauseBtn.hidden = true;
    if (settingsBtn) settingsBtn.hidden = true;
    if (shareBtn) shareBtn.hidden = true;
    if (statsDetailEl) statsDetailEl.hidden = true;
    overlay.hidden = false;
    overlayTitle.textContent = DEFAULT_TITLE;
    overlayTitle.classList.remove('gt-over');
    overlaySub.textContent = DEFAULT_SUB;
    startBtn.textContent = '\u25B6 Play';
    scoreEntry.hidden = true;
    submitNote.textContent = '';
    if (pillText) pillText.textContent = 'READY';
    if (titleSeqEl) titleSeqEl.hidden = true;
    updateZoneLocks();
    fadeReveal(overlayMainEl);
    fadeReveal(gameMenuPlay);
    if (gameWrap && gameWrap.classList.contains('gw-fullscreen')) exitFullscreenMode();
    startIdleAnim();
  }

  async function loadLeaderboard() {
    if (!leaderboardList) return;
    try {
      const r = await fetch(window.__API_BASE + '/api/leaderboard');
      const data = await r.json();
      if (data.ok && data.entries && data.entries.length) {
        leaderboardList.innerHTML = data.entries.map((e, i) =>
          '<li><span class="glb-rank">#' + (i + 1) + '</span><span class="glb-name">' + escapeHtml(e.name) + '</span><span class="glb-score">' + e.score + '</span></li>'
        ).join('');
      }
    } catch (_) {}
  }

  function handlePlayClick() {
    stopMenuMusic();
    ensureAudio();
    startRadio();
    startBtn.disabled = true;
    startBtn.textContent = '\u25B6 Play';
    start();
    startBtn.disabled = false;
  }
  startBtn.addEventListener('click', handlePlayClick);
  if (dailyBtn) {
    dailyBtn.addEventListener('click', () => {
      pendingZone = 0;
      isDailyChallenge = true;
      enableDailySeed();
      handlePlayClick();
    });
  }
  const zoneBtns = document.querySelectorAll('.game-zone-btn');
  function setActiveZoneBtn(idx) {
    zoneBtns.forEach((b) => b.classList.toggle('gz-active', Number(b.dataset.zone) === idx));
  }
  function updatePlayButtonLabel() {
    const isContinuing = pendingZone === frontierZoneIdx() && highestLevelReached > ZONE_START_LEVELS[pendingZone];
    startBtn.textContent = isContinuing ? '\u25B6 Continue (Lv ' + highestLevelReached + ')' : '\u25B6 Play';
  }
  function updateZoneLocks() {
    const frontier = frontierZoneIdx();
    zoneBtns.forEach((btn) => {
      const idx = Number(btn.dataset.zone);
      const unlocked = isZoneUnlocked(idx);
      btn.classList.toggle('gz-locked', !unlocked);
      btn.disabled = !unlocked;
      const lvEl = btn.querySelector('.gz-lv');
      if (lvEl) lvEl.textContent = unlocked ? 'Lv ' + ZONE_START_LEVELS[idx] : '\u{1F512} Locked';
    });
    // if the previously-selected zone is somehow locked (e.g. storage was
    // cleared), fall back to the current frontier so selection is never
    // stuck on an unreachable zone
    if (!isZoneUnlocked(pendingZone)) pendingZone = frontier;
    setActiveZoneBtn(pendingZone);
    updatePlayButtonLabel();
    updateLoadoutPreview();
    if (dailyNoteEl) {
      dailyNoteEl.hidden = false;
      dailyNoteEl.textContent = dailyBest > 0 ? "Today's best: " + dailyBest : 'No daily run yet today';
    }
  }
  function updateLoadoutPreview() {
    const spreadEl = document.getElementById('game-loadout-spread');
    const homingEl = document.getElementById('game-loadout-homing');
    const overchargeEl = document.getElementById('game-loadout-overcharge');
    if (spreadEl) spreadEl.classList.toggle('gl-unlocked', !!unlocks.spread);
    if (homingEl) homingEl.classList.toggle('gl-unlocked', !!unlocks.homing);
    if (overchargeEl) overchargeEl.classList.toggle('gl-unlocked', !!unlocks.overcharge);
  }
  zoneBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.zone);
      if (!isZoneUnlocked(idx)) return;
      pendingZone = idx;
      setActiveZoneBtn(pendingZone);
      updatePlayButtonLabel();
    });
  });
  updateZoneLocks();
  if (quitBtn) quitBtn.addEventListener('click', quitGame);
  if (quitBtnFs) quitBtnFs.addEventListener('click', quitGame);
  submitBtn.addEventListener('click', async () => {
    const name = (nameInput.value || 'ANON').trim().toUpperCase().slice(0, 12) || 'ANON';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting\u2026';
    try {
      const r = await fetch(window.__API_BASE + '/api/leaderboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, score }),
      });
      const data = await r.json();
      if (data.ok) {
        scoreEntry.hidden = true;
        submitNote.textContent = data.madeTop10 ? 'Made the top 10!' : 'Score saved.';
        loadLeaderboard();
      } else {
        submitNote.textContent = data.error || 'Couldn\u2019t save that score.';
      }
    } catch (_) {
      submitNote.textContent = 'Couldn\u2019t reach the leaderboard just now.';
    }
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Score';
  });

  function generateShareCardBlob() {
    return new Promise((resolve) => {
      const w = 800, h = 420;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      const bgGrad = g.createLinearGradient(0, 0, w, h);
      bgGrad.addColorStop(0, '#050912'); bgGrad.addColorStop(1, '#0a0f1e');
      g.fillStyle = bgGrad; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(34,211,238,.15)'; g.lineWidth = 1;
      for (let x = 0; x < w; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      for (let y = 0; y < h; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      g.strokeStyle = 'rgba(232,121,249,.6)'; g.lineWidth = 2;
      g.strokeRect(12, 12, w - 24, h - 24);
      g.textAlign = 'left';
      g.font = '700 34px "JetBrains Mono", monospace';
      g.fillStyle = '#22D3EE'; g.shadowColor = 'rgba(34,211,238,.7)'; g.shadowBlur = 14;
      g.fillText('</> GHOSTWIRE', 48, 80);
      g.shadowBlur = 0;
      g.font = '400 15px "JetBrains Mono", monospace';
      g.fillStyle = 'rgba(148,163,184,.85)';
      g.fillText('SYSTEM BREACH REPORT', 48, 110);
      g.font = '700 92px "JetBrains Mono", monospace';
      g.fillStyle = '#F0F8FF'; g.shadowColor = 'rgba(232,121,249,.5)'; g.shadowBlur = 18;
      g.fillText(String(score), 48, 225);
      g.shadowBlur = 0;
      g.font = '400 16px "JetBrains Mono", monospace';
      g.fillStyle = 'rgba(148,163,184,.85)';
      g.fillText('POINTS', 50, 250);
      const stats = [
        ['LEVEL REACHED', String(level)],
        ['ZONE', currentEraName()],
        ['LONGEST STREAK', String(longestStreak)],
      ];
      let sx = 48;
      stats.forEach(([label, val]) => {
        g.font = '400 12px "JetBrains Mono", monospace';
        g.fillStyle = 'rgba(148,163,184,.7)';
        g.fillText(label, sx, 310);
        g.font = '700 22px "JetBrains Mono", monospace';
        g.fillStyle = '#E879F9';
        g.fillText(val, sx, 340);
        sx += 230;
      });
      g.font = '400 13px "JetBrains Mono", monospace';
      g.fillStyle = 'rgba(148,163,184,.5)';
      g.textAlign = 'right';
      g.fillText(window.location.hostname || 'ghostwire', w - 40, h - 32);
      c.toBlob((blob) => resolve(blob), 'image/png');
    });
  }
  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      const text = 'I scored ' + score + ' on GHOSTWIRE (reached level ' + level + '). Beat me:';
      const url = window.location.href.split('#')[0];
      const blob = await generateShareCardBlob();
      const file = blob ? new File([blob], 'ghostwire-score.png', { type: 'image/png' }) : null;
      if (navigator.share && file && navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ title: 'GHOSTWIRE', text, url, files: [file] }); return; } catch (_) { /* user cancelled */ return; }
      }
      if (navigator.share) {
        try { await navigator.share({ title: 'GHOSTWIRE', text, url }); return; } catch (_) { /* user cancelled */ return; }
      }
      // no Web Share API — download the image directly instead of just
      // copying text, so there's still something visual to actually post
      if (blob) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'ghostwire-score.png';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        shareBtn.textContent = 'Saved!';
        setTimeout(() => { shareBtn.textContent = '\u21EA Share Score'; }, 1800);
      } else if (navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(text + ' ' + url);
          shareBtn.textContent = 'Copied!';
          setTimeout(() => { shareBtn.textContent = '\u21EA Share Score'; }, 1800);
        } catch (_) { /* clipboard unavailable */ }
      }
    });
  }

  // -- animated title sequence: a condensed version of the site's own
  //    boot-glyph intro, scoped to this card — the </> glyph decodes in
  //    character-by-character (same cyan/violet/magenta mapping as the
  //    nav logo), a status line decodes, "GHOSTWIRE" glitch-decodes with a
  //    corruption blip before settling into a slow idle glow. The animated
  //    version of this now plays full-screen (see runGwBoot below) the
  //    moment "Initialize" is pressed; the in-card copy here just shows
  //    the already-settled final state once that collapses, rather than
  //    re-running the decode a second time at a smaller size. --------------
  const ICON_CHARS = ['<', '/', '>'];
  const ICON_CLASSES = ['gt-lt', 'gt-slash', 'gt-gt'];
  const GT_GLYPHS = '!<>-_\\/[]{}=+*^?#';
  function decodeText(el, text, dur, onDone, onChar) {
    const stagger = dur / text.length;
    const t0 = performance.now();
    let lockedCount = 0;
    function tick(now) {
      const e = now - t0;
      let out = '';
      for (let i = 0; i < text.length; i++) {
        out += e >= i * stagger
          ? '<span class="gt-char-locked">' + text[i] + '</span>'
          : GT_GLYPHS[(Math.random() * GT_GLYPHS.length) | 0];
      }
      el.innerHTML = out;
      const newlyLocked = Math.min(text.length, Math.floor(e / stagger) + 1);
      if (onChar) { while (lockedCount < newlyLocked) { onChar(lockedCount); lockedCount++; } }
      if (e < dur) requestAnimationFrame(tick);
      else {
        el.innerHTML = text.split('').map((c) => '<span class="gt-char-locked">' + c + '</span>').join('');
        if (onDone) onDone();
      }
    }
    requestAnimationFrame(tick);
  }
  // the glyph decodes each of its 3 characters into its own color, same
  // mapping as the nav logo, instead of just appearing pre-formed
  function decodeIconInto(el, dur, onDone) {
    const stagger = dur / ICON_CHARS.length;
    const t0 = performance.now();
    function tick(now) {
      const e = now - t0;
      let out = '';
      for (let i = 0; i < ICON_CHARS.length; i++) {
        out += e >= i * stagger
          ? '<span class="' + ICON_CLASSES[i] + '">' + ICON_CHARS[i] + '</span>'
          : '<span class="gt-scramble">' + GT_GLYPHS[(Math.random() * GT_GLYPHS.length) | 0] + '</span>';
      }
      el.innerHTML = out;
      if (e < dur) requestAnimationFrame(tick);
      else {
        el.innerHTML = ICON_CHARS.map((c, i) => '<span class="' + ICON_CLASSES[i] + '">' + c + '</span>').join('');
        if (onDone) onDone();
      }
    }
    requestAnimationFrame(tick);
  }
  function runTitleSeq() {
    // No animation here anymore — just the final settled state, instantly.
    const iconEl = document.getElementById('game-title-icon');
    const statusEl = document.getElementById('game-title-status');
    const wordEl = document.getElementById('game-title-word');
    if (!iconEl || !statusEl || !wordEl) return;
    iconEl.innerHTML = ICON_CHARS.map((c, i) => '<span class="' + ICON_CLASSES[i] + '">' + c + '</span>').join('');
    iconEl.classList.add('gt-grown', 'gt-idle');
    statusEl.innerHTML = 'LINK ESTABLISHED';
    wordEl.innerHTML = 'GHOSTWIRE'.split('').map((c) => '<span class="gt-char-locked">' + c + '</span>').join('');
  }

  // Continuous idle decode on the title-gate wordmark — re-scrambles and
  // re-locks "GHOSTWIRE" on a loop for as long as the gate is on screen,
  // instead of decoding once and sitting static. Each letter fades in
  // individually the moment it locks, then once the whole word is settled
  // and has held for a beat, the whole word fades out and the cycle
  // restarts. Stops scheduling as soon as the gate is hidden (Initialize
  // pressed) so it's not running for nothing behind the menu/game.
  // Skipped entirely under reduced motion.
  //
  // Uses its own decode routine rather than the shared decodeText() —
  // decodeText rewrites the element's entire innerHTML every frame, which
  // is fine for a one-shot decode but would recreate every already-locked
  // character's <span> on every subsequent frame here, retriggering its
  // fade-in CSS animation from scratch each time instead of playing once.
  // This keeps one persistent span per character and only touches a
  // span's content/class when that character actually locks.
  const GATE_WORD_DECODE_MS = 900, GATE_WORD_HOLD_MS = 1800, GATE_WORD_FADE_MS = 500;
  function decodeGateWord(el, text, dur, onDone) {
    const chars = text.split('');
    el.innerHTML = chars.map(() => '<span class="gt-char-locked"></span>').join('');
    const spans = el.querySelectorAll('span');
    const stagger = dur / chars.length;
    const t0 = performance.now();
    function lockChar(i) {
      const span = spans[i];
      span.textContent = chars[i];
      span.classList.remove('gt-char-in'); void span.offsetWidth; span.classList.add('gt-char-in');
      span.dataset.locked = '1';
    }
    function tick(now) {
      const e = now - t0;
      for (let i = 0; i < chars.length; i++) {
        if (spans[i].dataset.locked === '1') continue;
        if (e >= i * stagger) lockChar(i);
        else spans[i].textContent = GT_GLYPHS[(Math.random() * GT_GLYPHS.length) | 0];
      }
      if (e < dur) requestAnimationFrame(tick);
      else {
        for (let i = 0; i < chars.length; i++) { if (spans[i].dataset.locked !== '1') lockChar(i); }
        if (onDone) onDone();
      }
    }
    requestAnimationFrame(tick);
  }
  function loopGateWordDecode() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const wordEl = document.getElementById('game-title-gate-word');
    if (!wordEl || !titleGateEl || titleGateEl.hidden) return;
    wordEl.classList.remove('gt-word-fade-out');
    decodeGateWord(wordEl, 'GHOSTWIRE', GATE_WORD_DECODE_MS, () => {
      setTimeout(() => {
        wordEl.classList.add('gt-word-fade-out');
        setTimeout(loopGateWordDecode, GATE_WORD_FADE_MS);
      }, GATE_WORD_HOLD_MS);
    });
  }

  // quiet per-character typing blip — tiny pitch variance so a whole line
  // decoding doesn't sound like one note repeated
  function typingBlip() {
    ensureAudio();
    const f = 1800 + Math.random() * 900;
    playTone(f, 0.025, 'square', 0.012, null, 0, { filterFreq: 3400 });
  }
  function rgbSplitBlip(el) {
    if (!el) return;
    el.classList.remove('gwb-rgbsplit'); void el.offsetWidth;
    el.classList.add('gwb-rgbsplit');
    setTimeout(() => el.classList.remove('gwb-rgbsplit'), 320);
  }
  // screen-tear: a thin colored band flashes at a random height while the
  // content wrapper jumps sideways for a couple frames
  function triggerScreenTear() {
    const content = document.getElementById('gw-boot-content');
    const bars = [document.getElementById('gw-boot-tearbar-1'), document.getElementById('gw-boot-tearbar-2')];
    const bar = bars[(Math.random() * bars.length) | 0];
    if (bar) {
      bar.style.top = (10 + Math.random() * 80) + '%';
      bar.classList.add('gwb-tear-show');
      setTimeout(() => bar.classList.remove('gwb-tear-show'), 90);
    }
    if (content) {
      content.classList.remove('gwb-tear'); void content.offsetWidth;
      content.classList.add('gwb-tear');
      setTimeout(() => content.classList.remove('gwb-tear'), 130);
    }
  }
  // hex/coordinate readouts near each corner — flicker through random
  // values while active, purely atmospheric (no "correct" value to lock)
  const HEX_CHARS = '0123456789ABCDEF';
  function randomHex(len) {
    let out = '0x';
    for (let i = 0; i < len; i++) out += HEX_CHARS[(Math.random() * 16) | 0];
    return out;
  }
  let hexReadoutTimer = null;
  function startHexReadouts() {
    const els = ['gw-boot-hex-tl', 'gw-boot-hex-tr', 'gw-boot-hex-bl', 'gw-boot-hex-br'].map((id) => document.getElementById(id));
    const labels = ['SEC://', 'MEM::', 'SYNC#', 'NODE::'];
    function tick() {
      els.forEach((el, i) => { if (el) el.textContent = labels[i] + randomHex(4); });
    }
    tick();
    hexReadoutTimer = setInterval(tick, 180);
  }
  function stopHexReadouts() {
    if (hexReadoutTimer) clearInterval(hexReadoutTimer);
    hexReadoutTimer = null;
  }
  // sparse falling-character background stream, density ramping up with
  // the boot's own progress (0-1) rather than running at full density
  // the whole time
  let gwStreamRaf = null;
  function startGwStream(getProgress) {
    const canvas = document.getElementById('gw-boot-stream');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const DPR = Math.min(2, window.devicePixelRatio || 1);
    function resize() {
      canvas.width = window.innerWidth * DPR;
      canvas.height = window.innerHeight * DPR;
    }
    resize();
    const cols = Math.floor(window.innerWidth / 22);
    const drops = Array.from({ length: cols }, () => Math.random() * -40);
    const chars = '01<>{}[]/\\+=-_#?';
    function draw() {
      const p = getProgress();
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.fillStyle = 'rgba(2,8,16,.16)';
      ctx.fillRect(0, 0, canvas.width / DPR, canvas.height / DPR);
      ctx.font = '14px "JetBrains Mono", monospace';
      const activeCols = Math.max(1, Math.floor(cols * Math.min(1, p * 1.3)));
      for (let i = 0; i < activeCols; i++) {
        const ch = chars[(Math.random() * chars.length) | 0];
        const x = i * 22;
        const y = drops[i] * 18;
        ctx.fillStyle = i % 5 === 0 ? 'rgba(232,121,249,' + (0.12 + p * 0.1) + ')' : 'rgba(34,211,238,' + (0.1 + p * 0.09) + ')';
        ctx.fillText(ch, x, y);
        drops[i] += 0.55 + Math.random() * 0.4;
        if (y > window.innerHeight && Math.random() > 0.975) drops[i] = Math.random() * -20;
      }
      gwStreamRaf = requestAnimationFrame(draw);
    }
    window.addEventListener('resize', resize);
    gwStreamRaf = requestAnimationFrame(draw);
  }
  function stopGwStream() {
    if (gwStreamRaf) cancelAnimationFrame(gwStreamRaf);
    gwStreamRaf = null;
    const canvas = document.getElementById('gw-boot-stream');
    if (canvas) { const ctx = canvas.getContext('2d'); ctx && ctx.clearRect(0, 0, canvas.width, canvas.height); }
  }

  // -- GHOSTWIRE BOOT: the actual animated decode, full-page and centered
  //    regardless of portrait/landscape, matching the site's own boot
  //    sequence (#boot-seq) — same glyph-decode/status-decode/progress-bar
  //    recipe, just triggered on demand instead of once per session. Once
  //    done, it collapses (scale + fade) to make room for the compact
  //    in-card title + Play/Menu buttons.
  const BOOT_LOG_LINES = ['SYS CHECK... OK', 'UPLINK: STABLE', 'LOADING ZONE DATA...'];
  const gwBootHomeParent = document.getElementById('gw-boot') ? document.getElementById('gw-boot').parentNode : null;
  const gwBootHomeNextSibling = document.getElementById('gw-boot') ? document.getElementById('gw-boot').nextSibling : null;
  function runGwBoot(onDone) {
    const boot = document.getElementById('gw-boot');
    const iconEl = document.getElementById('gw-boot-icon');
    const statusEl = document.getElementById('gw-boot-status');
    const wordEl = document.getElementById('gw-boot-word');
    const barFill = document.getElementById('gw-boot-bar-fill');
    const pctEl = document.getElementById('gw-boot-pct');
    if (!boot) { if (onDone) onDone(); return; }
    // .panel (an ancestor at this point, before any fullscreen has been
    // engaged) has a transform for its scroll-reveal effect, which
    // creates a containing block for position:fixed descendants — so
    // without this, gw-boot's "inset:0" resolves against .panel's own
    // box instead of the true viewport, compressing it into whatever
    // space .panel happens to occupy instead of centering on the page.
    document.body.appendChild(boot);
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    boot.hidden = false;
    boot.classList.remove('gw-boot-collapse');
    requestAnimationFrame(() => boot.classList.add('gw-boot-active'));
    if (reduceMotion) {
      if (iconEl) iconEl.innerHTML = ICON_CHARS.map((c, i) => '<span class="' + ICON_CLASSES[i] + '">' + c + '</span>').join('');
      if (statusEl) statusEl.innerHTML = 'LINK ESTABLISHED';
      if (wordEl) wordEl.innerHTML = 'GHOSTWIRE'.split('').map((c) => '<span class="gt-char-locked">' + c + '</span>').join('');
      if (barFill) barFill.style.width = '100%';
      if (pctEl) pctEl.textContent = '100%';
      setTimeout(() => { if (onDone) onDone(); }, 200);
      return;
    }
    // boot-log lines decode one after another in the status slot before
    // settling on "LINK ESTABLISHED" — real extra content rather than a
    // padded delay, each with its own quiet per-character typing blip
    const LOG_LINE_MS = 320, LOG_HOLD_MS = 220;
    const LOG_TOTAL_MS = BOOT_LOG_LINES.length * (LOG_LINE_MS + LOG_HOLD_MS);
    const ICON_MS = 320, STATUS_MS = 420, WORD_MS = 650, HOLD_MS = 400;
    const TOTAL_MS = LOG_TOTAL_MS + ICON_MS + 150 + STATUS_MS + 200 + WORD_MS + HOLD_MS;

    if (iconEl) {
      decodeIconInto(iconEl, ICON_MS, () => rgbSplitBlip(iconEl));
    }
    if (statusEl) statusEl.classList.add('gwb-typing');
    let logDelay = 180;
    BOOT_LOG_LINES.forEach((line) => {
      const atDelay = logDelay;
      setTimeout(() => { if (statusEl) decodeText(statusEl, line, LOG_LINE_MS, null, typingBlip); }, atDelay);
      logDelay += LOG_LINE_MS + LOG_HOLD_MS;
    });
    setTimeout(() => { if (statusEl) decodeText(statusEl, 'LINK ESTABLISHED', STATUS_MS, null, typingBlip); }, logDelay + 100);
    const wordDelay = logDelay + 100 + STATUS_MS + 200;
    setTimeout(() => { if (statusEl) statusEl.classList.remove('gwb-typing'); }, wordDelay);
    setTimeout(() => { if (wordEl) decodeText(wordEl, 'GHOSTWIRE', WORD_MS, () => rgbSplitBlip(iconEl), typingBlip); }, wordDelay);
    if (barFill) {
      barFill.style.transition = 'width ' + TOTAL_MS + 'ms linear';
      requestAnimationFrame(() => { barFill.style.width = '100%'; });
    }
    // corner brackets finish their snap-in around .9s; network traces
    // draw themselves out to each one right after
    startHexReadouts();
    // a couple of screen-tear glitches at points that don't collide with
    // a decode already being mid-flight, so they read as interference
    // rather than covering up the text
    setTimeout(triggerScreenTear, 120);
    setTimeout(triggerScreenTear, wordDelay + WORD_MS + 80);
    // live percentage readout, ticking alongside the bar fill — also
    // drives the background stream's density via the same progress value
    const t0 = performance.now();
    function currentProgress() { return Math.min(1, (performance.now() - t0) / TOTAL_MS); }
    startGwStream(currentProgress);
    if (pctEl) {
      (function tickPct() {
        const pct = Math.round(currentProgress() * 100);
        pctEl.textContent = pct + '%';
        if (pct < 100) requestAnimationFrame(tickPct);
      })();
    }
    // real sound effect instead of the synthesized chime — timed to start
    // alongside the icon decode so its glitch/interference character
    // plays out under the visual decode rather than as a separate sting
    ensureAudio();
    playBootGlitchSfx();
    // near the end: computer-crash plays alone, timed to finish right as
    // the sequence collapses
    const crashDelay = Math.max(0, TOTAL_MS - 1300);
    setTimeout(() => { playComputerCrashSfx(); }, crashDelay);
    setTimeout(() => { stopGwStream(); stopHexReadouts(); if (onDone) onDone(); }, TOTAL_MS);
  }

  function playInitialTitleCard() {
    if (!titleSeqEl) return;
    const boot = document.getElementById('gw-boot');
    runGwBoot(() => {
      // settle the compact in-card title first, then collapse the
      // full-screen boot away to reveal it + the Play/Menu buttons —
      // the two happen together so there's no bare gap in between
      runTitleSeq();
      titleSeqEl.hidden = false;
      if (boot) boot.classList.add('gw-boot-collapse');
      if (gameMenuRoot) fadeReveal(gameMenuRoot);
      startMenuMusic();
      setTimeout(() => {
        if (boot) {
          boot.hidden = true;
          boot.classList.remove('gw-boot-active', 'gw-boot-collapse');
          if (gwBootHomeParent) {
            if (gwBootHomeNextSibling) gwBootHomeParent.insertBefore(boot, gwBootHomeNextSibling);
            else gwBootHomeParent.appendChild(boot);
          }
        }
      }, 520);
    });
  }

  syncFullscreenLabel();
  startIdleAnim(); // tunnel keeps drifting behind the title/menu screens instead of one static frame
  loopGateWordDecode();
  loadLeaderboard();
})();
