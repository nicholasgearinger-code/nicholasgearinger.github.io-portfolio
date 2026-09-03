// Fluid V8 M8.5.7.1 — mobile browser-chrome HUD correction.
// iOS browsers can visually overlay the top of a fixed-position page even when
// env(safe-area-inset-top) is satisfied. Move the test HUD below that chrome and
// stack the title/FPS cards on narrow or coarse-pointer devices.

const style=document.createElement('style');
style.id='m857MobileHudFix';
style.textContent=`
@media (max-width:700px), (pointer:coarse) {
  .hud.card.title {
    top:max(76px, calc(env(safe-area-inset-top) + 64px)) !important;
    left:max(12px, env(safe-area-inset-left)) !important;
    right:auto !important;
    z-index:60 !important;
    font-size:11px !important;
    padding:8px 11px !important;
  }
  .hud.card.perf {
    top:max(116px, calc(env(safe-area-inset-top) + 104px)) !important;
    left:max(12px, env(safe-area-inset-left)) !important;
    right:auto !important;
    z-index:60 !important;
    min-width:188px !important;
    max-width:calc(100vw - 24px) !important;
    text-align:left !important;
    padding:8px 10px !important;
  }
  .hud.card.perf .fps {
    font-size:22px !important;
    line-height:1.05 !important;
  }
  .hud.card.perf .status {
    font-size:8px !important;
    line-height:1.35 !important;
  }
}
`;
document.head.appendChild(style);

// Keep the FPS number unmistakable during mobile performance tests.
const fps=document.getElementById('v4fps');
if(fps)fps.setAttribute('aria-label','Current frames per second');

window.__v5M857MobileHud={online:true,backend:'ios-browser-chrome-safe-stacked-hud-m8571'};
console.info('[Fluid V8 M8.5.7.1] mobile browser-safe HUD placement online.');
