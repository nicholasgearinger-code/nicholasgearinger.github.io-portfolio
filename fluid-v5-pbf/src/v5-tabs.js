// Fluid V5 M2.4 tabbed mobile control shell.
// Reorganizes already-wired controls by moving their live DOM nodes; event handlers/state remain intact.

const panel=document.getElementById('settingsPanel');
if(!panel) throw new Error('Fluid V5 tabs: settings panel unavailable.');

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
for(let i=0;i<40;i++){
 if(document.getElementById('v5Lab')&&document.getElementById('v4LiveWaterTune')&&document.getElementById('v44RealismLab'))break;
 await sleep(50);
}
if(document.getElementById('v5Tabs')){
 console.info('[Fluid V5 UI] tabbed controls already mounted.');
}else{
 const style=document.createElement('style');
 style.textContent=`
 #settingsPanel{width:min(430px,calc(100vw - 24px))!important;max-height:min(76vh,720px)!important;overflow:hidden!important;padding:10px!important}
 #settingsPanel>.settingsTitle{margin-bottom:8px!important;color:#9dffc8!important}
 .v5TabBar{display:flex;gap:5px;overflow-x:auto;overscroll-behavior-x:contain;padding:1px 0 7px;scrollbar-width:none;-webkit-overflow-scrolling:touch}
 .v5TabBar::-webkit-scrollbar{display:none}.v5Tab{flex:0 0 auto;appearance:none;border:1px solid rgba(78,214,220,.30);background:rgba(4,17,24,.82);color:#9fc1cf;border-radius:999px;padding:7px 9px;font:800 8px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em;white-space:nowrap}
 .v5Tab.active{border-color:#f1ad43;color:#ffd890;background:rgba(77,54,17,.48)}
 .v5TabPanel{display:none;max-height:min(62vh,590px);overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;padding:2px 1px 8px}.v5TabPanel.active{display:block}
 .v5TabIntro{padding:8px 9px;margin:0 0 8px;border:1px solid rgba(78,214,220,.16);border-radius:9px;background:rgba(5,20,27,.62);font-size:7.7px;line-height:1.45;color:#91b6c3}
 .v5TabPanel .v5Lab,.v5TabPanel .v4Tune,.v5TabPanel .v44Lab,.v5TabPanel .v4WaveTest{margin-top:7px!important;padding-top:7px!important}
 .v5TabPanel>.v5SectionTitle:first-of-type{margin-top:4px}.v5TabPanel .qualityRow{margin-top:2px}
 #v5M2DevHud{white-space:pre-wrap!important;overflow-wrap:anywhere!important;word-break:normal!important;max-width:min(300px,calc(100vw - 24px))!important;width:min(300px,calc(100vw - 24px))!important;font-size:7.3px!important;line-height:1.45!important;box-sizing:border-box!important}
 .v5AtomicDetail{margin-top:8px;padding:8px 9px;border:1px solid rgba(78,214,220,.18);border-radius:9px;background:rgba(4,17,24,.68);font-size:7.3px;line-height:1.45;color:#9fc1cf;overflow-wrap:anywhere}
 .v5AtomicDetail.ok{border-color:rgba(157,255,200,.34);color:#9dffc8}.v5AtomicDetail.bad{border-color:rgba(255,159,159,.35);color:#ffb5b5}
 @media(max-width:600px){#settingsPanel{right:12px!important;left:12px!important;width:auto!important;top:max(92px,calc(env(safe-area-inset-top) + 92px))!important}.v5Tab{font-size:7.3px;padding:7px 8px}.v5TabPanel{max-height:58vh}.v5TabIntro{font-size:7.2px}}
 `;
 document.head.appendChild(style);
 const title=panel.querySelector('.settingsTitle');if(title)title.textContent='FLUID V5 · CONTROL LAB';
 const tabs=document.createElement('div');tabs.id='v5Tabs';tabs.className='v5TabBar';
 const host=document.createElement('div');host.id='v5TabHost';
 panel.insertBefore(tabs,title?.nextSibling||panel.firstChild);panel.insertBefore(host,tabs.nextSibling);

 const defs=[
  ['quality','QUALITY','Choose a fixed simulation tier or enable AUTO. AUTO adjusts rendering pressure first, then changes tiers only after sustained performance changes.'],
  ['scenes','SCENES','Change the physical experiment: pool, wave tank, rain, pour, dam break, or drain. These alter real PBF forcing and particle behavior.'],
  ['physics','PHYSICS','Experiment with rigid-body shape, density, buoyancy, drain strength, and other mechanics that directly interact with the PBF solver.'],
  ['light','LIGHT + WATER','Tune water optics, sun direction/intensity, exposure, absorption, and projected caustics. These controls determine how the live surface bends and focuses light.'],
  ['realism','REALISM','Layer secondary spray/foam and the V4.4 realism effects: micro-ripples, shafts, dispersion, wet lines, shadows, scattering, and temporal accumulation.'],
  ['camera','CAMERA','Move into the water and tune the underwater medium. Underwater mode constrains the real camera below the live water surface rather than swapping scenes.'],
  ['developer','DEVELOPER','Inspect particles, velocity, normals, depth, thickness, drain masks, secondary particles, and atomic caustics. This tab also reports GPU pipeline status.'],
 ];
 const panels={};
 function activate(key){
  tabs.querySelectorAll('.v5Tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===key));
  Object.entries(panels).forEach(([k,p])=>p.classList.toggle('active',k===key));
  try{localStorage.setItem('fluidV5ActiveTab',key)}catch{}
 }
 for(const [key,label,desc] of defs){
  const b=document.createElement('button');b.type='button';b.className='v5Tab';b.dataset.tab=key;b.textContent=label;b.onclick=e=>{e.preventDefault();e.stopPropagation();activate(key)};tabs.appendChild(b);
  const p=document.createElement('div');p.className='v5TabPanel';p.dataset.panel=key;const intro=document.createElement('div');intro.className='v5TabIntro';intro.textContent=desc;p.appendChild(intro);host.appendChild(p);panels[key]=p;
 }

 const move=(node,key)=>{if(node&&panels[key])panels[key].appendChild(node)};
 const qualityRow=panel.querySelector('.qualityRow');const qualityNote=document.getElementById('qualityNote');move(qualityRow,'quality');move(qualityNote,'quality');
 const lab=document.getElementById('v5Lab');
 function collectSection(root,text){
  if(!root)return[];const kids=[...root.children];const i=kids.findIndex(n=>n.classList?.contains('v5SectionTitle')&&(n.textContent||'').includes(text));if(i<0)return[];
  const out=[];for(let j=i;j<kids.length;j++){const n=kids[j];if(j>i&&n.classList?.contains('v5SectionTitle'))break;if(n.id==='v5Milestone2')break;out.push(n);}return out;
 }
 const sceneNodes=collectSection(lab,'SCENARIO');const physicsNodes=collectSection(lab,'RIGID BODY');const cameraFxNodes=collectSection(lab,'CAMERA + GPU EFFECTS');const devNodes=collectSection(lab,'DEVELOPER VIEW');
 sceneNodes.forEach(n=>move(n,'scenes'));physicsNodes.forEach(n=>move(n,'physics'));devNodes.forEach(n=>move(n,'developer'));
 // Split CAMERA + GPU EFFECTS by live control identity instead of keeping the old mixed section.
 cameraFxNodes.forEach(n=>{if(n.classList?.contains('v5SectionTitle'))return;const id=n.id||n.querySelector?.('input,button')?.id||'';if(id==='v5UnderwaterCamera'||n.id==='v5UnderwaterCamera')move(n,'camera');else if(n.querySelector?.('#v5Projected'))move(n,'light');else if(n.querySelector?.('#v5Spray'))move(n,'realism');else move(n,'camera')});
 const underwater=document.querySelector('#v5Lab button.v5Wide');if(underwater&&(underwater.textContent||'').includes('UNDERWATER'))move(underwater,'camera');
 move(document.getElementById('v4WaveTest'),'scenes');move(document.getElementById('v4LiveWaterTune'),'light');move(document.getElementById('v44RealismLab'),'realism');

 const m2=document.getElementById('v5Milestone2');
 const sec=document.getElementById('v5Secondary')?.closest('.v5Slider');const drain=document.getElementById('v5DrainRate')?.closest('.v5Slider');const haze=document.getElementById('v5UnderwaterHaze')?.closest('.v5Slider');
 move(sec,'realism');move(drain,'physics');move(haze,'camera');
 if(m2){
  const grids=[...m2.querySelectorAll('.v5Grid')];grids.forEach(g=>{if(g.querySelector('[data-m2debug]'))move(g,'developer')});
  move(document.getElementById('v5DevHudToggle'),'developer');
 }
 const atomicDetail=document.createElement('div');atomicDetail.id='v5AtomicDetail';atomicDetail.className='v5AtomicDetail';panels.developer.appendChild(atomicDetail);
 // Hide empty wrapper headers left behind after moving the active controls.
 if(lab){[...lab.children].forEach(n=>{if(n.classList?.contains('v5Top')||n.id==='v5Milestone2')n.style.display='none'});lab.style.display='none'}
 if(m2)m2.style.display='none';

 function compactHud(){
  const hud=document.getElementById('v5M2DevHud');if(!hud)return;
  const sim=window.__sim,ssfr=window.__ssfr,cam=window.__cam,state=window.__v5State,auto=window.__v5AutoBudget,m2=window.__v5M2,ast=window.__v5AtomicStatus,pc=window.__v5ProjectedCaustics;
  const q=(new URLSearchParams(location.search).get('quality')||'medium').toUpperCase();const fps=auto?.ema?.toFixed?.(1)??'--';const pressure=Math.round((auto?.pressure||0)*100);const scale=Math.round((ssfr?.renderScale||0)*100);
  const fluid=sim?.scene?.nFluid||0,rigid=sim?.nBodyParts||0,total=sim?.n||0;const uw=sim&&cam?Math.max(0,sim.params.box[1]*.28-cam.eye()[1]):0;
  const atomic=pc?.online?`${pc.width}×${pc.height} ${pc.backend||''}`:`${ast?.stage||'offline'} ${ast?.backend||''}`;
  hud.textContent=`V5 M2.4 · ${q}${state?.autoQuality?' AUTO':''}\nFPS ${fps} · SSFR ${scale}% · GPU ${pressure}%\nPBF ${total.toLocaleString()} · fluid ${fluid.toLocaleString()} · rigid ${rigid.toLocaleString()}\nsecondary ${m2?.secondaryCapacity?.toLocaleString?.()||'--'} · drained ${m2?.drainedTotal?.toLocaleString?.()||'0'}\natomic ${atomic.trim()} · UW ${uw.toFixed(2)} m`;
  const ok=!!pc?.online;atomicDetail.className='v5AtomicDetail '+(ok?'ok':ast?.stage==='rejected'?'bad':'');
  atomicDetail.textContent=ok?`Atomic caustics ONLINE · ${pc.width}×${pc.height} · ${pc.backend||'unknown backend'}. The map is generated from live refracted sunlight and projected across the pool floor.`:`Atomic caustics ${String(ast?.stage||'offline').toUpperCase()} · ${ast?.backend||'unknown backend'}${ast?.error?' · '+ast.error:''}`;
 }
 setInterval(compactHud,320);compactHud();
 let initial='quality';try{const saved=localStorage.getItem('fluidV5ActiveTab');if(panels[saved])initial=saved}catch{}activate(initial);
 panel.addEventListener('pointerdown',e=>e.stopPropagation());panel.addEventListener('click',e=>e.stopPropagation());
 console.info('[Fluid V5 UI] tabbed mobile control lab enabled.');
}
