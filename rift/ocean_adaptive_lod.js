// Phase A — crack-free, camera-biased ocean presentation geometry.
// FFT/shallow-water compute buffers remain unchanged. Only the draw mesh
// varies in density. The caller owns replacement/disposal and cadence.
import * as THREE from "three";

const GRID = 512;  // dyadic coordinates permit exact neighbor stitching
const FFT_N = 128;
const SHALLOW_N = 256;
const DETAIL_DOMAIN = 260;
const SHALLOW_DOMAIN = 360;
const clamp = THREE.MathUtils.clamp;
const fract = x => ((x % 1) + 1) % 1;
const smooth = x => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

export function createAdaptiveOceanGeometry(size, waterY, sampleHeight, focusX = 0, focusZ = 0) {
  if (!Number.isFinite(size) || size <= 0) throw new Error("Invalid ocean LOD domain");
  const stepWorld = size / GRID;
  const half = size * .5;
  const leaves = [];
  let maxLevel = 0;
  const root = { x: 0, z: 0, n: GRID, children: null };
  function split(node) {
    if (node.n <= 1 || node.children) return;
    const h = node.n / 2;
    node.children = [
      {x:node.x,z:node.z,n:h,children:null},
      {x:node.x+h,z:node.z,n:h,children:null},
      {x:node.x,z:node.z+h,n:h,children:null},
      {x:node.x+h,z:node.z+h,n:h,children:null}
    ];
  }
  function targetSpacing(x,z) {
    const cameraDistance = Math.hypot(x-focusX,z-focusZ);
    const islandDistance = Math.hypot(x,z);
    // Highest displacement detail near the camera, including when swimming.
    // Reef and beach retain intermediate density even when camera is offshore.
    let spacing = cameraDistance < 96 ? 3.91 :
      cameraDistance < 185 ? 7.82 :
      cameraDistance < 360 ? 15.63 :
      cameraDistance < 700 ? 31.25 : 62.5;
    if (islandDistance < 145) spacing = Math.min(spacing,7.82);
    return spacing;
  }
  function refine(node) {
    const x = (node.x+node.n*.5)*stepWorld-half;
    const z = (node.z+node.n*.5)*stepWorld-half;
    const radius = node.n*stepWorld*.71;
    // Use distance to a cell's footprint, not just its center: a large
    // cell must subdivide before it engulfs the high-detail camera zone.
    const nearCamera = Math.max(0,Math.hypot(x-focusX,z-focusZ)-radius);
    const nearIsland = Math.max(0,Math.hypot(x,z)-radius);
    const cameraSpacing = nearCamera < 96 ? 3.91 :
      nearCamera < 185 ? 7.82 :
      nearCamera < 360 ? 15.63 :
      nearCamera < 700 ? 31.25 : 62.5;
    const desired = nearIsland < 145 ? Math.min(cameraSpacing,7.82) : cameraSpacing;
    if (node.n > 1 && node.n*stepWorld > desired*1.05) {
      split(node);
      for (const child of node.children) refine(child);
    }
  }
  refine(root);
  function lookup(x,z) {
    if (x < 0 || z < 0 || x >= GRID || z >= GRID) return null;
    let node=root;
    while(node.children){
      const h=node.n/2;
      const right=x >= node.x+h ? 1 : 0;
      const bottom=z >= node.z+h ? 1 : 0;
      node=node.children[bottom*2+right];
    }
    return node;
  }
  function collect(node) {
    if(node.children) for(const child of node.children) collect(child);
    else leaves.push(node);
  }
  // Constrain all touching leaves to at most a 2:1 size ratio.
  // This guarantees at most one hanging vertex per edge, so a stitched fan
  // can join every LOD boundary without T-junction cracks.
  for(let pass=0;pass<10;pass++){
    leaves.length=0;collect(root);
    const splitThese=[];
    for(const cell of leaves){
      if(cell.n <= 1)continue;
      const h=cell.n/2;
      // Sample both halves of every edge. A neighbor can be finer at
      // one corner but not the midpoint, especially near the camera zone.
      const q=cell.n*.25, tq=cell.n*.75;
      const neighbors=[
        lookup(cell.x+q,cell.z-.5),lookup(cell.x+tq,cell.z-.5),
        lookup(cell.x+cell.n+.5,cell.z+q),lookup(cell.x+cell.n+.5,cell.z+tq),
        lookup(cell.x+q,cell.z+cell.n+.5),lookup(cell.x+tq,cell.z+cell.n+.5),
        lookup(cell.x-.5,cell.z+q),lookup(cell.x-.5,cell.z+tq)
      ];
      if(neighbors.some(n=>n && n.n<cell.n/2)) splitThese.push(cell);
    }
    if(!splitThese.length)break;
    for(const cell of splitThese)split(cell);
  }
  leaves.length=0;collect(root);

  const vertices=[];
  const texcoords=[];
  const indices=[];
  const vertexMap=new Map();
  function vert(x,z){
    const key=x* (GRID+1)+z;
    const existing=vertexMap.get(key);
    if(existing!==undefined)return existing;
    const i=vertices.length/3;
    vertices.push(x*stepWorld-half,0,z*stepWorld-half);
    texcoords.push(x/GRID,1-z/GRID);
    vertexMap.set(key,i);
    return i;
  }
  for(const c of leaves){
    const {x,z,n}=c;
    const boundary=[
      [x,z], [x+n,z], [x+n,z+n], [x,z+n]
    ];
    const adjacent=[
      lookup(x+n/2,z-.5),lookup(x+n+.5,z+n/2),
      lookup(x+n/2,z+n+.5),lookup(x-.5,z+n/2)
    ];
    const ring=[];
    for(let edge=0;edge<4;edge++){
      const [ax,az]=boundary[edge];
      const [bx,bz]=boundary[(edge+1)%4];
      ring.push(vert(ax,az));
      if(adjacent[edge] && adjacent[edge].n<n)
        ring.push(vert((ax+bx)/2,(az+bz)/2));
    }
    if(ring.length===4){
      // xz plane: reverse winding to point toward positive Y.
      indices.push(ring[0],ring[2],ring[1],ring[0],ring[3],ring[2]);
    } else {
      const center=vert(x+n/2,z+n/2);
      for(let k=0;k<ring.length;k++)
        indices.push(center,ring[(k+1)%ring.length],ring[k]);
    }
  }

  const count=vertices.length/3;
  const longCoords=new Float32Array(count*2);
  const detailCoords=new Float32Array(count*2);
  const shallowCoords=new Float32Array(count*2);
  const coverage=new Float32Array(count);
  const shore=new Float32Array(count);
  const depthWorld=new Float32Array(count);
  const normals=new Float32Array(count*3);
  for(let i=0;i<count;i++){
    const x=vertices[i*3], z=vertices[i*3+2];
    normals[i*3+1]=1;
    longCoords[i*2]=clamp((x/size+.5)*(FFT_N-1),0,FFT_N-1);
    longCoords[i*2+1]=clamp((z/size+.5)*(FFT_N-1),0,FFT_N-1);
    detailCoords[i*2]=fract(x/DETAIL_DOMAIN+.5)*FFT_N;
    detailCoords[i*2+1]=fract(z/DETAIL_DOMAIN+.5)*FFT_N;
    shallowCoords[i*2]=clamp((x/SHALLOW_DOMAIN+.5)*(SHALLOW_N-1),0,SHALLOW_N-1);
    shallowCoords[i*2+1]=clamp((z/SHALLOW_DOMAIN+.5)*(SHALLOW_N-1),0,SHALLOW_N-1);
    const squareRadius=Math.max(Math.abs(x),Math.abs(z))/(SHALLOW_DOMAIN*.5);
    coverage[i]=1-smooth((squareRadius-.80)/.18);
    const ground=sampleHeight?sampleHeight(x,z):null;
    const signedDepth=ground==null?12:waterY-ground;
    depthWorld[i]=Math.min(24,Math.max(0,signedDepth));
    shore[i]=signedDepth<=-.35?0:
      signedDepth<0?smooth((signedDepth+.35)/.35)*.08:
      .08+smooth(signedDepth/2.5)*.92;
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(vertices,3));
  geometry.setAttribute("normal",new THREE.Float32BufferAttribute(normals,3));
  geometry.setAttribute("uv",new THREE.Float32BufferAttribute(texcoords,2));
  geometry.setAttribute("fftCoordLong",new THREE.Float32BufferAttribute(longCoords,2));
  geometry.setAttribute("fftCoordDetail",new THREE.Float32BufferAttribute(detailCoords,2));
  geometry.setAttribute("shallowCoord",new THREE.Float32BufferAttribute(shallowCoords,2));
  geometry.setAttribute("shallowCoverage",new THREE.Float32BufferAttribute(coverage,1));
  geometry.setAttribute("fftShoreDense",new THREE.Float32BufferAttribute(shore,1));
  geometry.setAttribute("fftDepthWorld",new THREE.Float32BufferAttribute(depthWorld,1));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  geometry.userData.riftLOD={vertices:count,triangles:indices.length/3,patches:leaves.length,
    target:"camera-and-reef",focusX,focusZ};
  return geometry;
}
