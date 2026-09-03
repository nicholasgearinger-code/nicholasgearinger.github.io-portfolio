// Fluid V5 M3.3 atomic handoff.
// Reuse the validated M3.2 Sun/Spot/Point implementation. The M3.3 light controller presents
// Day/Sunset as a directional sun and Night as an underwater source (causticCode 4 = disabled).
await import('./v5-atomic-multilight-m32.js');
if(window.__v5ProjectedCaustics)window.__v5ProjectedCaustics.backend='time-sun-m33';
if(window.__v5AtomicStatus)window.__v5AtomicStatus.backend='time-sun-m33';
console.info('[Fluid V5 M3.3] time-of-day atomic handoff enabled.');
