// Fluid V8 M8.3.3 — WebKit WGSL compatibility + legacy sparse-source suppression.
// M8.3.3 replaces the old M7.5.2 faucet/waterfall packet emitters with a frame-rate-aware
// continuous source pass. Keep the M7.5.2 controller for scene state/controls, but compile
// its faucet and waterfall branches unreachable so no detached legacy droplets are injected.

const sim=window.__sim;
if(!sim?.dev) throw new Error('M8.3.3 WGSL/source compatibility: GPU device unavailable.');
const dev=sim.dev;
const baseCreateShaderModule=dev.createShaderModule.bind(dev);

const RESERVED=`
NULL Self abstract active alignas alignof as asm asm_fragment async attribute auto await
become cast catch class co_await co_return co_yield coherent column_major common compile
compile_fragment concept const_cast consteval constexpr constinit crate debugger decltype
delete demote demote_to_helper do dynamic_cast enum explicit export extends extern external
fallthrough filter final finally friend from fxgroup get goto groupshared highp impl implements
import inline instanceof interface layout lowp macro macro_rules match mediump meta mod module
move mut mutable namespace new nil noexcept noinline nointerpolation non_coherent noncoherent
noperspective null nullptr of operator package packoffset partition pass patch pixelfragment
precise precision premerge priv protected pub public readonly ref regardless register
reinterpret_cast require resource restrict self set shared sizeof smooth snorm static
static_assert static_cast std subroutine super target template this thread_local throw trait try
type typedef typeid typename typeof union unless unorm unsafe unsized use using varying virtual
volatile wgsl where with writeonly yield
`.trim().split(/\s+/);
const escaped=RESERVED.map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
const reservedRE=new RegExp(`\\b(?:${escaped.join('|')})\\b`,'g');
let patchedModules=0,patchedTokens=0,suppressedSources=0;

function patchReserved(code){
  let local=0;
  const out=code.replace(reservedRE,word=>{local++;return `compat_${word}`});
  if(local){patchedModules++;patchedTokens+=local;}
  return out;
}
function suppressLegacySources(code,label){
  if(label!=='fluidV5M752ScenesWGSL')return code;
  let out=code;
  const faucet='if(mode==3u && rank>=0){';
  const waterfall='if(mode==4u && rank>=0){';
  if(out.includes(faucet)){out=out.replace(faucet,'if(mode==300u && rank>=0){');suppressedSources++;}
  if(out.includes(waterfall)){out=out.replace(waterfall,'if(mode==400u && rank>=0){');suppressedSources++;}
  return out;
}

dev.createShaderModule=function(desc){
  if(desc?.code&&typeof desc.code==='string'){
    let code=suppressLegacySources(desc.code,desc.label);
    code=patchReserved(code);
    if(code!==desc.code)desc={...desc,code};
  }
  return baseCreateShaderModule(desc);
};
window.__v5M833WGSLCompat={
  online:true,backend:'reserved-sweep-plus-source-suppression-m833',
  get patchedModules(){return patchedModules},get patchedTokens(){return patchedTokens},get suppressedSources(){return suppressedSources}
};
console.info('[Fluid V8 M8.3.3] WGSL compatibility + legacy faucet/waterfall suppression online.');