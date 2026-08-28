// Fluid V5 M3.4 atomic handoff. Day/Sunset retain the validated directional atomic sun pass;
// Night uses the dedicated submerged six-fixture renderer and therefore disables solar photons.
await import('./v5-atomic-multilight-m32.js');
if(window.__v5ProjectedCaustics)window.__v5ProjectedCaustics.backend='time-sun-m34';
if(window.__v5AtomicStatus)window.__v5AtomicStatus.backend='time-sun-m34';
console.info('[Fluid V5 M3.4] day/sunset atomic handoff enabled; night uses submerged fixture shimmer.');
