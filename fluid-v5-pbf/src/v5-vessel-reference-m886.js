// Fluid V8 M8.8.6 — centered catch + refined reference pitcher/glass layer.
// Preserve the proven M8.8.1 PBF/CFL/energy model while improving vessel presentation.
// Changes are limited to receiving-glass placement, pitcher geometry/collision shape,
// and transparent vessel shading. The moving-boundary water physics remain unchanged.

import {dev,glass,profile,outerProfile,spoutPath} from './v5-pitcher-fluid-physics-m872.js';
if(!dev||!glass||!profile||!outerProfile||!spoutPath)
  throw new Error('M8.8.6 reference vessel: base vessel data unavailable.');

// Shift the receiving tumbler farther right so the natural M8.8.1 stream lands nearer center.
glass.cx=.846;

// Fuller lower belly + smoother shoulder + slightly tighter upper neck.
// Keep the collision scale close to M8.8.5 so fluid stability and pour timing are preserved.
const inner=[
  [-.225,.078],[-.192,.114],[-.118,.149],[-.030,.160],
  [.050,.157],[.112,.140],[.165,.103],[.205,.075]
];
const outer=[
  [-.255,.100],[-.222,.136],[-.145,.169],[-.050,.184],
  [.040,.181],[.112,.161],[.172,.123],[.225,.095]
];
profile.splice(0,profile.length,...inner.map(p=>[...p]));
outerProfile.splice(0,outerProfile.length,...outer.map(p=>[...p]));

// Retain the proven high, gently rising M8.8.5 spout geometry.
const spout=[
  [.058,.170,0],[.104,.186,0],[.154,.211,0],
  [.205,.224,0],[.252,.210,0],[.278,.194,0]
];
spoutPath.splice(0,spoutPath.length,...spout.map(p=>[...p]));

const baseCreateShaderModule=dev.createShaderModule.bind(dev);
dev.createShaderModule=function(desc){
  if(!desc||typeof desc.code!=='string')return baseCreateShaderModule(desc);
  let code=desc.code;

  if(desc.label==='m880MovingBoundaryWGSL'){
    // Match analytic moving-boundary collision to the M8.8.6 silhouette.
    code=code.replace(
`fn bodyR(y:f32)->f32{
  if(y<=-.225){return .074;} if(y<-.190){return mix(.074,.105,(y+.225)/.035);}
  if(y<-.100){return mix(.105,.137,(y+.190)/.090);} if(y<.020){return mix(.137,.145,(y+.100)/.120);}
  if(y<.105){return mix(.145,.127,(y-.020)/.085);} if(y<.165){return mix(.127,.095,(y-.105)/.060);}
  if(y<.205){return mix(.095,.070,(y-.165)/.040);} return .070;
}`,
`fn bodyR(y:f32)->f32{
  if(y<=-.225){return .078;} if(y<-.192){return mix(.078,.114,(y+.225)/.033);}
  if(y<-.118){return mix(.114,.149,(y+.192)/.074);} if(y<-.030){return mix(.149,.160,(y+.118)/.088);}
  if(y<.050){return mix(.160,.157,(y+.030)/.080);} if(y<.112){return mix(.157,.140,(y-.050)/.062);}
  if(y<.165){return mix(.140,.103,(y-.112)/.053);} if(y<.205){return mix(.103,.075,(y-.165)/.040);}
  return .075;
}`);
    code=code.replace(
`fn outerR(y:f32)->f32{
  if(y<=-.255){return .095;} if(y<-.220){return mix(.095,.125,(y+.255)/.035);}
  if(y<-.135){return mix(.125,.158,(y+.220)/.085);} if(y<-.020){return mix(.158,.166,(y+.135)/.115);}
  if(y<.095){return mix(.166,.147,(y+.020)/.115);} if(y<.165){return mix(.147,.118,(y-.095)/.070);}
  if(y<.225){return mix(.118,.090,(y-.165)/.060);} return .090;
}`,
`fn outerR(y:f32)->f32{
  if(y<=-.255){return .100;} if(y<-.222){return mix(.100,.136,(y+.255)/.033);}
  if(y<-.145){return mix(.136,.169,(y+.222)/.077);} if(y<-.050){return mix(.169,.184,(y+.145)/.095);}
  if(y<.040){return mix(.184,.181,(y+.050)/.090);} if(y<.112){return mix(.181,.161,(y-.040)/.072);}
  if(y<.172){return mix(.161,.123,(y-.112)/.060);} if(y<.225){return mix(.123,.095,(y-.172)/.053);}
  return .095;
}`);
    code=code.replace(
`fn spoutY(x:f32)->f32{
  if(x<=.060){return .145;} if(x<.105){return mix(.145,.165,(x-.060)/.045);}
  if(x<.155){return mix(.165,.192,(x-.105)/.050);} if(x<.205){return mix(.192,.198,(x-.155)/.050);}
  return mix(.198,.182,clamp((x-.205)/.045,0.0,1.0));
}`,
`fn spoutY(x:f32)->f32{
  if(x<=.058){return .170;} if(x<.104){return mix(.170,.186,(x-.058)/.046);}
  if(x<.154){return mix(.186,.211,(x-.104)/.050);} if(x<.205){return mix(.211,.224,(x-.154)/.051);}
  if(x<.252){return mix(.224,.210,(x-.205)/.047);}
  return mix(.210,.194,clamp((x-.252)/.026,0.0,1.0));
}`);
    code=code.replace(
`return q.x>.035-pr && q.x<.275+pr && abs(q.z)<.078+pr*.25 && q.y>.112-pr*.35 && q.y<.235+pr;`,
`return q.x>.035-pr && q.x<.300+pr && abs(q.z)<.078+pr*.25 && q.y>.137-pr*.25 && q.y<.258+pr;`);
    code=code.replace(`if(q.x<.040-pr || q.x>.275+pr){return false;}`,
                      `if(q.x<.040-pr || q.x>.300+pr){return false;}`);
    code=code.replace(`if((doorway(l,pr)||wasSpout||spoutSpace(l,pr)) && l.x<.266+pr){`,
                      `if((doorway(l,pr)||wasSpout||spoutSpace(l,pr)) && l.x<.294+pr){`);
    code=code.replace(`let floor=sy-.034+pr*.62;`,`let floor=sy-.030+pr*.62;`);
  }

  if(desc.label==='m872VesselRenderWGSL'){
    // Clear optical glass with stronger edge Fresnel and visibly thicker rim/base highlights.
    code=code.replace(
`let fres=pow(1.0-ndv,2.2);let spec=pow(max(dot(reflect(-l,n),v),0.0),80.0);`,
`let fres=pow(1.0-ndv,3.2);let spec=pow(max(dot(reflect(-l,n),v),0.0),150.0);`);
    code=code.replace(
`var base=vec3f(.69,.89,.96);var alpha=.060+.29*fres;if(i.mat>.5&&i.mat<1.5){base=vec3f(.76,.92,.98);alpha=.075+.31*fres;}if(i.mat>1.5){base=vec3f(.86,.96,1.0);alpha=.15+.34*fres;}`,
`var base=vec3f(.82,.95,.995);var alpha=.030+.22*fres;if(i.mat>.5&&i.mat<1.5){base=vec3f(.84,.96,.998);alpha=.036+.245*fres;}if(i.mat>1.5){base=vec3f(.92,.985,1.0);alpha=.155+.40*fres;}`);
    code=code.replace(
`let col=base*(.78+.12*max(n.y,0.0))+vec3f(1.0)*spec*.82;return vec4f(col,clamp(alpha,.04,.56));`,
`let edgeTint=vec3f(.85,.96,1.0)*(fres*.22);var col=base*(.70+.13*max(n.y,0.0))+edgeTint+vec3f(1.0)*spec*1.05;if(i.mat>1.5){col+=vec3f(1.0)*(.06+.10*fres);}return vec4f(col,clamp(alpha,.022,.62));`);
  }

  return baseCreateShaderModule({...desc,code});
};

window.__v5M886Reference={
  online:true,glassX:glass.cx,spoutThroat:.170,
  geometry:'fuller-rounded-belly-smooth-shoulder-tight-neck',glass:'strong-edge-rim-base-optics',physics:'m881-unchanged'
};
console.info('[Fluid V8 M8.8.6] centered catch + refined pitcher geometry + optical glass layer installed.');
