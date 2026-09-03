// Fluid V8 M8.3.2 — iOS/WebKit WGSL reserved-word compatibility sweep.
// The restored M7.5.x scene shaders contain identifiers that are now formally
// reserved by WGSL (including `target` and `meta`). Rewrite the complete WGSL
// reserved-word set before shader compilation so later restored/M8 shaders do
// not fail one identifier at a time on current WebKit implementations.

const sim=window.__sim;
if(!sim?.dev) throw new Error('M8.3.2 WGSL compatibility: GPU device unavailable.');
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
let patchedModules=0;
let patchedTokens=0;
const seen=new Map();

function safeName(word){
  return `compat_${word}`;
}

function patchWGSL(code,label){
  let local=0;
  const words=new Set();
  const patched=code.replace(reservedRE,word=>{
    local++;
    words.add(word);
    seen.set(word,(seen.get(word)||0)+1);
    return safeName(word);
  });
  if(local){
    patchedModules++;
    patchedTokens+=local;
    console.info('[Fluid V8 M8.3.2] WGSL reserved-word sweep',label||'shader',Array.from(words).join(', '));
  }
  return patched;
}

dev.createShaderModule=function(desc){
  if(desc?.code&&typeof desc.code==='string'){
    const code=patchWGSL(desc.code,desc.label);
    if(code!==desc.code) desc={...desc,code};
  }
  return baseCreateShaderModule(desc);
};

window.__v5M832WGSLCompat={
  online:true,
  backend:'wgsl-reserved-word-sweep-m832',
  get patchedModules(){return patchedModules},
  get patchedTokens(){return patchedTokens},
  get identifiers(){return Object.fromEntries(seen)},
};
console.info('[Fluid V8 M8.3.2] full WGSL reserved-word compatibility online.');
