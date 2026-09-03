// M8.5.2 HUD correction: detach the V4 bridge's stale FPS element reference and display
// the faucet laboratory's independently measured requestAnimationFrame rate.
const old=document.getElementById('v4fps');
let fps=old;
if(old){fps=old.cloneNode(true);old.replaceWith(fps);}
setInterval(()=>{
  const f=window.__v5M852Faucet?.raf;
  if(fps&&Number.isFinite(f))fps.textContent=`${Math.round(f)} FPS`;
},250);
window.__v5M852FpsHud={online:true};