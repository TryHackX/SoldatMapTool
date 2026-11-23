import C from 'clipper-lib';

const rules=[new Uint8Array(256),new Uint8Array(256)];
for(let bits=0;bits<256;bits++) {
  const b=Array.from({length:8},(_,i)=>(bits>>i)&1);
  const count=b.reduce((sum,v)=>sum+v,0);
  const changes=b.filter((v,i)=>!v && b[(i+1)%8]).length;
  if(count<2 || count>6 || changes!==1) continue;
  rules[0][bits]=Number(!(b[0]*b[2]*b[4] || b[2]*b[4]*b[6]));
  rules[1][bits]=Number(!(b[0]*b[2]*b[6] || b[0]*b[4]*b[6]));
}

// Thinning the combined wall silhouette gives one spine through bends and
// branches, independently of the artist's original triangle layout.
export function medialWallSegments(region:C.ExPolygon, step:number) {
  const bounds=C.JS.BoundsOfPath(region.outer);
  const w=2*Math.ceil((bounds.right-bounds.left)/(2*step))+5,h=2*Math.ceil((bounds.bottom-bounds.top)/(2*step))+5;
  const x0=(bounds.left+bounds.right-(w-1)*step)/2,y0=(bounds.top+bounds.bottom-(h-1)*step)/2;
  const pixels=new Uint8Array(w*h);
  const rows:number[][]=Array.from({length:h},()=>[]);
  for(const ring of [region.outer,...region.holes]) {
    for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
      const a=ring[j],b=ring[i];
      if(a.Y===b.Y) continue;
      const start=Math.ceil((Math.min(a.Y,b.Y)-y0)/step),end=Math.ceil((Math.max(a.Y,b.Y)-y0)/step);
      for(let y=start;y<end;y++) rows[y].push(a.X+(b.X-a.X)*(y0+y*step-a.Y)/(b.Y-a.Y));
    }
  }
  let foreground:number[]=[];
  rows.forEach((crossings,y)=>{
    crossings.sort((a,b)=>a-b);
    for(let i=1;i<crossings.length;i+=2) {
      const start=Math.ceil((crossings[i-1]-x0)/step),end=Math.ceil((crossings[i]-x0)/step);
      for(let x=start;x<end;x++) {const k=y*w+x;pixels[k]=1;foreground.push(k);}
    }
  });
  const directions=[-w,1-w,1,w+1,w,w-1,-1,-w-1];
  // Zhang-Suen thinning. Both substeps delete simultaneously and preserve
  // endpoints, holes, and eight-connected junctions of the raster.
  let changed=true;
  while(changed) {
    changed=false;
    for(const rule of rules) {
      const remove:number[]=[];
      for(const k of foreground) {
        if (pixels[k-w]+pixels[k+1]+pixels[k+w]+pixels[k-1]===4) continue;
        let bits=0;
        for(let i=0;i<8;i++) bits|=pixels[k+directions[i]]<<i;
        if(rule[bits]) remove.push(k);
      }
      if(!remove.length) continue;
      for(const k of remove) pixels[k]=0;
      foreground=foreground.filter(k=>pixels[k]!==0);changed=true;
    }
  }
  const point=(k:number)=>({X:Math.round(x0+k%w*step),Y:Math.round(y0+Math.floor(k/w)*step)});
  const segments:C.Paths=[];
  const parts:C.Paths=[];
  for(const k of foreground) {
    if(pixels[k]===1) {
      const queue=[k];pixels[k]=2;
      for(let i=0;i<queue.length;i++) for(const offset of directions) {
        const next=queue[i]+offset;
        if(pixels[next]===1) {pixels[next]=2;queue.push(next);}
      }
      parts.push(queue.map(point));
    }
    const a=point(k);
    if(pixels[k+1]) segments.push([a,point(k+1)]);
    if(pixels[k+w]) segments.push([a,point(k+w)]);
    // Diagonal links only bridge a corner when there is no orthogonal link.
    if(!pixels[k+w]) for(const dx of [-1,1]) {
      if(!pixels[k+dx] && pixels[k+w+dx]) segments.push([a,point(k+w+dx)]);
    }
  }
  return {segments,parts};
}

/** A subpixel neck can split the sampled spine. Bridge its pieces through
 * adjacent triangles of the exact inset, so a connection cannot jump a hole. */
export function bridgeWallParts(parts:C.Paths, points:C.Path,faces:[number,number,number][]):C.Paths {
  const neighbors=faces.map(()=>new Map<number,C.IntPoint>());
  const edges=new Map<number,number>();
  faces.forEach((face,id)=>face.forEach((a,i)=>{
    const b=face[(i+1)%3], key=Math.min(a,b)*points.length+Math.max(a,b),other=edges.get(key);
    if(other===undefined) {edges.set(key,id);return;}
    const mid={X:Math.round((points[a].X+points[b].X)/2),Y:Math.round((points[a].Y+points[b].Y)/2)};
    neighbors[id].set(other,mid);neighbors[other].set(id,mid);
  }));
  const triangles=faces.map(face=>face.map(i=>points[i]));
  const bounds=triangles.map(tri=>C.JS.BoundsOfPath(tri));
  const faceOf=(p:C.IntPoint)=>bounds.findIndex((b,i)=>p.X>=b.left && p.X<=b.right && p.Y>=b.top && p.Y<=b.bottom &&
    C.Clipper.PointInPolygon(p,triangles[i])!==0);
  const samples=parts.map(part=>part.filter((_,i)=>i%Math.max(1,Math.ceil(part.length/256))===0));
  const candidates:{a:number;b:number;start:C.IntPoint;end:C.IntPoint;cost:number}[]=[];
  for(let a=0;a<parts.length;a++) for(let b=a+1;b<parts.length;b++) {
    let cost=Infinity,start=samples[a][0],end=samples[b][0];
    for(const p of samples[a]) for(const q of samples[b]) {
      const d=(p.X-q.X)**2+(p.Y-q.Y)**2;
      if(d<cost){cost=d;start=p;end=q;}
    }
    candidates.push({a,b,start,end,cost});
  }
  const parent=parts.map((_,i)=>i);
  const root=(i:number)=>{while(i!==parent[i]) i=parent[i];return i;};
  const bridges:C.Paths=[];
  for(const {a,b,start,end} of candidates.sort((l,r)=>l.cost-r.cost)) {
    if(root(a)===root(b)) continue;
    const first=faceOf(start),last=faceOf(end);
    if(first<0 || last<0) continue;
    const prev=new Int32Array(faces.length).fill(-1),queue=[first];
    prev[first]=first;
    for(let j=0;j<queue.length && prev[last]===-1;j++) for(const next of neighbors[queue[j]].keys()) {
      if(prev[next]!==-1) continue;
      prev[next]=queue[j];queue.push(next);
    }
    if(prev[last]===-1) continue;
    const path=[end];
    for(let j=last;j!==first;j=prev[j]) path.push(neighbors[j].get(prev[j])!);
    path.push(start);
    bridges.push(path);parent[root(a)]=root(b);
  }
  return bridges;
}
