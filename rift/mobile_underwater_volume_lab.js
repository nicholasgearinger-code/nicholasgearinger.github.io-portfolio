// Rift Mobile Volume Lab v1 — independent, opt-in underwater presentation.
// Does not touch Three.js materials, render targets, FFT compute or PostProcessing.
// ?riftMobileVolume=1 enables; remove the flag to restore the stable v34 image.
export function startMobileVolumeLab() {
  if (new URLSearchParams(location.search).get("riftMobileVolume") !== "1") return;
  const viewport = document.getElementById("rift-viewport");
  if (!viewport || viewport.querySelector("#rift-mobile-volume-lab")) return;
  const layer = document.createElement("div");
  layer.id = "rift-mobile-volume-lab";
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = [
    "position:absolute","inset:0","z-index:2","pointer-events:none",
    "overflow:hidden","opacity:0","transition:opacity 280ms ease",
    "isolation:isolate"
  ].join(";");
  // This tint acts on the ALREADY-rendered scene. It is deliberately
  // independent of the fragile WebGPU post-processing output graph.
  const absorption = document.createElement("div");
  absorption.style.cssText = [
    "position:absolute","inset:0","mix-blend-mode:multiply",
    "background:linear-gradient(180deg,rgba(21,158,193,.66) 0%,rgba(6,104,145,.76) 47%,rgba(2,49,88,.91) 100%)"
  ].join(";");
  const haze = document.createElement("div");
  haze.style.cssText = [
    "position:absolute","inset:0","mix-blend-mode:screen",
    "background:radial-gradient(ellipse 105% 62% at 54% 5%,rgba(59,205,228,.27),transparent 84%),linear-gradient(180deg,transparent 7%,rgba(5,74,107,.06) 65%,rgba(1,18,42,.10))"
  ].join(";");
  const rays = document.createElement("canvas");
  rays.width = 240;
  rays.height = 400;
  rays.style.cssText = "position:absolute;inset:0;width:100%;height:100%;mix-blend-mode:screen;opacity:.75";
  const ctx = rays.getContext("2d", {alpha:true});
  const depthLabel = document.createElement("span");
  depthLabel.textContent = "VOLUME LAB";
  depthLabel.style.cssText = [
    "position:absolute","right:12px","bottom:54px","color:#a8f3f8",
    "font:10px monospace","letter-spacing:.1em","opacity:.72"
  ].join(";");
  layer.append(absorption,haze,rays,depthLabel);
  viewport.appendChild(layer);
  globalThis.__riftMobileVolumeLab = {enabled:true, mode:"independent-2d", version:1};
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let last=0;
  function paint(t,depth) {
    if (!ctx) return;
    const w=rays.width,h=rays.height;
    ctx.clearRect(0,0,w,h);
    const sunlight=Math.exp(-Math.max(0,depth)*0.055);
    const strength=Math.max(.15,.62*sunlight);
    const phase=reduced?0:t*.00014;
    // Broad, soft shafts drift at different rates; no geometry-aligned grid.
    for(let i=0;i<7;i++){
      const x=w*(.06+i*.16+Math.sin(phase*1.1+i*2.3)*.055);
      const width=w*(.15+.045*Math.sin(i*1.9+phase));
      const gradient=ctx.createLinearGradient(x-width*.5,0,x+width*.65,h);
      const alpha=strength*(.07+.045*Math.sin(phase*2+i*1.7)**2);
      gradient.addColorStop(0,"rgba(153,244,252,"+(alpha*1.6)+")");
      gradient.addColorStop(.35,"rgba(70,200,222,"+alpha+")");
      gradient.addColorStop(1,"rgba(27,115,173,0)");
      ctx.fillStyle=gradient;
      ctx.beginPath();
      ctx.moveTo(x-width*.25,-8);
      ctx.lineTo(x+width*.24,-8);
      ctx.lineTo(x+width*.9,h);
      ctx.lineTo(x-width*.8,h);
      ctx.closePath();
      ctx.fill();
    }
    const top=ctx.createLinearGradient(0,0,0,h*.43);
    top.addColorStop(0,"rgba(100,235,241,"+(.21*sunlight)+")");
    top.addColorStop(1,"rgba(19,139,171,0)");
    ctx.fillStyle=top;ctx.fillRect(0,0,w,h*.43);
  }
  function frame(t) {
    if (!layer.isConnected) return;
    const state=globalThis.__riftWaterVolumeProbe;
    const active=Boolean(state && state.active && state.blend>.05);
    const mix=active?Math.min(1,Math.max(0,state.blend)):0;
    layer.style.opacity=mix.toFixed(3);
    if(active && t-last>85) {
      last=t;
      const depth=Math.max(0,state.depth||0);
      absorption.style.opacity=Math.min(1,.72+depth*.012).toFixed(2);
      haze.style.opacity=Math.max(.22,.92-depth*.009).toFixed(2);
      paint(t,depth);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
