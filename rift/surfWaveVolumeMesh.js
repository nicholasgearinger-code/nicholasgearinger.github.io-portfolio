// CPU implicit surface reconstruction for ONE localized 3D crashing wave.
// Marching tetrahedra over a compact scalar field of SPH/PBF water particles.
// Produces an actual closed, overturning volume that follows the simulated
// particle positions -- NOT a scripted ribbon, heightfield or spray sprites.
// The mesh is rebuilt <=10Hz mobile and shares a fixed GPU vertex buffer.
//
// Deliberately independent of Three.js: can be regression-tested with Node.
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const CORNERS = [
  [0,0,0],[1,0,0],[1,1,0],[0,1,0],
  [0,0,1],[1,0,1],[1,1,1],[0,1,1],
];
const TETS = [
  [0,5,1,6],[0,1,2,6],[0,2,3,6],
  [0,3,7,6],[0,7,4,6],[0,4,5,6],
];

/**
 * All vertex/index storage is allocated once. Marching tetrahedra emits
 * unindexed triangles (smooth normals are sampled from the density field).
 */
export function createSurfVolumeField(mobile = true) {
  const nx = mobile ? 14 : 23, ny = mobile ? 10 : 16,
    nz = mobile ? 12 : 19;
  const dx = mobile ? 0.88 : 0.53, dy = mobile ? 0.70 : 0.42,
    dz = mobile ? 0.92 : 0.56;
  const n = nx * ny * nz, maxVerts = mobile ? 12000 : 28000;
  return {
    nx, ny, nz, dx, dy, dz,
    baseX: -(nx - 1) * dx * 0.5,
    baseY: -0.38,
    baseZ: -(nz - 1) * dz * 0.5,
    iso: mobile ? 0.32 : 0.39,
    kernelRadius: mobile ? 1.16 : 0.84,
    density: new Float32Array(n),
    gx: new Float32Array(n), gy: new Float32Array(n),
    gz: new Float32Array(n),
    positions: new Float32Array(maxVerts * 3),
    normals: new Float32Array(maxVerts * 3),
    colors: new Float32Array(maxVerts * 3),
    maxVerts, vertexCount: 0, activeParticles: 0,
    originX: 0, originZ: 0,
  };
}

export function buildSurfVolumeField(field, pool, {
  seaY = 8, shoreX = 0, shoreZ = -1,
} = {}) {
  if (!field || !pool?.particles) return { triangles: 0, active: 0 };
  const particles = pool.particles;
  const shoreLen = Math.hypot(shoreX, shoreZ) || 1;
  const sx = shoreX / shoreLen, sz = shoreZ / shoreLen;
  // Orthonormal shore-tangent basis, +localZ points toward beach.
  const tx = -sz, tz = sx;
  let active = 0, cx = 0, cz = 0;
  for (const p of particles) {
    if (p.life <= 0) continue;
    if (![p.x,p.y,p.z].every(Number.isFinite)) continue;
    cx += p.x; cz += p.z; active++;
  }
  field.activeParticles = active;
  field.vertexCount = 0;
  if (active < 7) return { triangles: 0, active };
  cx /= active; cz /= active;
  field.originX = cx; field.originZ = cz;
  const {nx,ny,nz,dx,dy,dz,baseX,baseY,baseZ} = field;
  const density=field.density, gx=field.gx,gy=field.gy,gz=field.gz;
  density.fill(0);
  const radius = field.kernelRadius, r2 = radius*radius;
  const invX=1/dx, invY=1/dy, invZ=1/dz;

  // Compact 3D SPH surface-density splats; no particle-to-pixel loops.
  // The field is an actual scalar reconstruction of the live 3D water.
  for (const p of particles) {
    if (p.life <= 0) continue;
    const relX = p.x-cx, relZ = p.z-cz;
    const localX = relX*tx + relZ*tz;
    const localZ = relX*sx + relZ*sz;
    const localY = p.y-seaY;
    const ii=(localX-baseX)*invX, jj=(localY-baseY)*invY,
      kk=(localZ-baseZ)*invZ;
    const ri=Math.ceil(radius*invX),rj=Math.ceil(radius*invY),
      rk=Math.ceil(radius*invZ);
    const i0=Math.max(1,Math.floor(ii)-ri),i1=Math.min(nx-2,Math.ceil(ii)+ri);
    const j0=Math.max(1,Math.floor(jj)-rj),j1=Math.min(ny-2,Math.ceil(jj)+rj);
    const k0=Math.max(1,Math.floor(kk)-rk),k1=Math.min(nz-2,Math.ceil(kk)+rk);
    for(let k=k0;k<=k1;k++){
      const zz=(baseZ+k*dz-localZ)**2;
      for(let j=j0;j<=j1;j++){
        const yz=zz+(baseY+j*dy-localY)**2;
        if(yz>=r2)continue;
        for(let i=i0;i<=i1;i++){
          const dist2=yz+(baseX+i*dx-localX)**2;
          if(dist2>=r2)continue;
          const q=1-dist2/r2;
          density[(k*ny+j)*nx+i]+=q*q;
        }
      }
    }
  }
  // Smooth analytical normals from the same density used to extract
  // triangles. Fixed boundaries are zero, naturally closing water lobes.
  for(let k=1;k<nz-1;k++)for(let j=1;j<ny-1;j++)
    for(let i=1;i<nx-1;i++){
      const id=(k*ny+j)*nx+i;
      gx[id]=(density[id+1]-density[id-1])/(2*dx);
      gy[id]=(density[id+nx]-density[id-nx])/(2*dy);
      gz[id]=(density[id+nx*ny]-density[id-nx*ny])/(2*dz);
    }

  const positions=field.positions, normals=field.normals, colors=field.colors;
  const cubeNode=new Array(8), cubeValue=new Array(8);
  const localCorner=new Array(8);
  for(let i=0;i<8;i++)localCorner[i]=[0,0,0];
  const threshold=field.iso;
  let cursor=0;
  const nodeId=(i,j,k)=>(k*ny+j)*nx+i;
  function between(a,b){
    const va=cubeValue[a],vb=cubeValue[b];
    const t=clamp((threshold-va)/((vb-va)||1e-6),0,1);
    const idA=cubeNode[a],idB=cubeNode[b];
    const ca=localCorner[a],cb=localCorner[b];
    const lx=ca[0]+(cb[0]-ca[0])*t;
    const ly=ca[1]+(cb[1]-ca[1])*t;
    const lz=ca[2]+(cb[2]-ca[2])*t;
    const gnX=-(gx[idA]*(1-t)+gx[idB]*t);
    const gnY=-(gy[idA]*(1-t)+gy[idB]*t);
    const gnZ=-(gz[idA]*(1-t)+gz[idB]*t);
    const mag=Math.hypot(gnX,gnY,gnZ)||1;
    return {
      x:cx+tx*lx+sx*lz, y:seaY+ly, z:cz+tz*lx+sz*lz,
      nx:(tx*gnX+sx*gnZ)/mag,ny:gnY/mag,
      nz:(tz*gnX+sz*gnZ)/mag,
    };
  }
  function emit(a,b,c){
    if(cursor+3>field.maxVerts)return;
    // Orient outward using the local density gradient so reflections
    // don't flip as a breaker folds over or separates into blobs.
    const ex=b.x-a.x,ey=b.y-a.y,ez=b.z-a.z;
    const fx=c.x-a.x,fy=c.y-a.y,fz=c.z-a.z;
    const nx=ey*fz-ez*fy,ny=ez*fx-ex*fz,nz=ex*fy-ey*fx;
    if(nx*a.nx+ny*a.ny+nz*a.nz<0){const t=b;b=c;c=t;}
    for(const p of [a,b,c]){
      const o=cursor*3;
      positions[o]=p.x;positions[o+1]=p.y;positions[o+2]=p.z;
      normals[o]=p.nx;normals[o+1]=p.ny;normals[o+2]=p.nz;
      // Foam collects where fluid crests; transparent teal body below.
      const foam=clamp((p.y-seaY-1.3)/3.3,0,0.5);
      colors[o]=0.065+foam*0.62;
      colors[o+1]=0.43+foam*0.54;
      colors[o+2]=0.54+foam*0.43;
      cursor++;
    }
  }

  outer: for(let k=0;k<nz-1;k++)for(let j=0;j<ny-1;j++)
    for(let i=0;i<nx-1;i++){
      let below=0,above=0;
      for(let m=0;m<8;m++){
        const d=CORNERS[m], a=i+d[0],b=j+d[1],c=k+d[2];
        const node=nodeId(a,b,c);
        cubeNode[m]=node;cubeValue[m]=density[node];
        const corner=localCorner[m];
        corner[0]=baseX+a*dx;corner[1]=baseY+b*dy;
        corner[2]=baseZ+c*dz;
        if(density[node]>=threshold)above++;else below++;
      }
      if(!below||!above)continue;
      for(const tet of TETS){
        const inside=[],outside=[];
        for(let q=0;q<4;q++){
          const ci=tet[q];
          (cubeValue[ci]>=threshold?inside:outside).push(ci);
        }
        if(!inside.length||inside.length===4)continue;
        if(inside.length===1){
          const a=inside[0];
          emit(between(a,outside[0]),between(a,outside[1]),
            between(a,outside[2]));
        }else if(inside.length===3){
          const a=outside[0];
          emit(between(a,inside[0]),between(a,inside[1]),
            between(a,inside[2]));
        }else{
          const a=inside[0],b=inside[1],c=outside[0],d=outside[1];
          const ac=between(a,c),ad=between(a,d),
            bc=between(b,c),bd=between(b,d);
          emit(ac,ad,bc);
          emit(ad,bd,bc);
        }
        if(cursor>=field.maxVerts-3)break outer;
      }
    }
  field.vertexCount=cursor;
  return { triangles:cursor/3, active, capped:cursor>=field.maxVerts-3 };
}
