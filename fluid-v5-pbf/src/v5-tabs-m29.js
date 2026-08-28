// Fluid V5 M2.9 tab-shell loader. Reuse the stable tab implementation and update the compact HUD label.
const srcUrl = new URL('./v5-tabs.js', import.meta.url);
const response = await fetch(srcUrl, { cache:'no-store' });
if (!response.ok) throw new Error(`Fluid V5 tabs M2.9: unable to load tab shell (${response.status}).`);
let src = await response.text();
const needle = "hud.textContent=`V5 M2.4 · ${q}${state?.autoQuality?' AUTO':''}\\nFPS ${fps} · SSFR ${scale}% · GPU ${pressure}%\\nPBF ${total.toLocaleString()} · fluid ${fluid.toLocaleString()} · rigid ${rigid.toLocaleString()}\\nsecondary ${m2?.secondaryCapacity?.toLocaleString?.()||'--'} · drained ${m2?.drainedTotal?.toLocaleString?.()||'0'}\\natomic ${atomic.trim()} · UW ${uw.toFixed(2)} m`;";
const replacement = "hud.textContent=`V5 M2.9 · ${q}${state?.autoQuality?' AUTO':''}\\nFPS ${fps} · SSFR ${scale}% · GPU ${pressure}%\\nPBF ${total.toLocaleString()} · fluid ${fluid.toLocaleString()} · rigid ${rigid.toLocaleString()}\\nsecondary ${m2?.secondaryCapacity?.toLocaleString?.()||'--'} · drained ${m2?.drainedTotal?.toLocaleString?.()||'0'}\\natomic ${atomic.trim()} · UW ${uw.toFixed(2)} m`;";
if (!src.includes(needle)) throw new Error('Fluid V5 tabs M2.9: compact HUD signature changed.');
src = src.replace(needle, replacement);
const blobUrl = URL.createObjectURL(new Blob([src], { type:'text/javascript' }));
try { await import(blobUrl); }
finally { URL.revokeObjectURL(blobUrl); }
console.info('[Fluid V5 UI] M2.9 tabbed control lab enabled.');
