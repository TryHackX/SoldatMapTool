import C from 'clipper-lib';

type Node={point:C.IntPoint;neighbors:Set<Node>};
/** Join triangulation chords through ordinary bends; keep junctions as separate runs. */
export function joinWallRuns(segments:C.Paths,minBranch:number):C.Paths {
  const nodes=new Map<string,Node>();
  function node(p:C.IntPoint) {
    const key=p.X+','+p.Y;
    let n=nodes.get(key);
    if (!n) {n={point:p,neighbors:new Set()};nodes.set(key,n);}
    return n;
  }
  for(const path of segments) {
    for(let i=1;i<path.length;i++) {
      const a=node(path[i-1]),b=node(path[i]);
      if(a!==b){a.neighbors.add(b);b.neighbors.add(a);}
    }
  }
  const tips=Array.from(nodes.values()).filter(n=>n.neighbors.size===1);
  for(const tip of tips) {
    let next=tip.neighbors.values().next().value;
    if (!next) continue;
    let prev=tip,length=0;
    while (next) {
      length+=Math.hypot(next.point.X-prev.point.X,next.point.Y-prev.point.Y);
      if(length>=minBranch) break;
      if(next.neighbors.size!==2) {
        if(next.neighbors.size>2) {
          // Only prune a dead-end twig. Keep isolated short walls and bridges.
          let current:Node=tip;
          while(current!==next) {
            const adjacent:Node=current.neighbors.values().next().value!;
            adjacent.neighbors.delete(current);current.neighbors.clear();current=adjacent;
          }
        }
        break;
      }
      const following:Node=Array.from(next.neighbors).find(n=>n!==prev)!;
      prev=next;next=following;
    }
  }
  const paths:C.Paths=[];
  const junctions=new Set(Array.from(nodes.values()).filter(n=>n.neighbors.size!==2));
  function walk(start:Node) {
    while(start.neighbors.size) {
      let from=start;
      const path=[from.point];
      do {
        const to:Node=from.neighbors.values().next().value!;
        from.neighbors.delete(to);to.neighbors.delete(from);
        path.push(to.point);from=to;
      } while(from.neighbors.size && !junctions.has(from) && from!==start);
      if (from===start && path.length>3) {
        const half=Math.floor(path.length/2);
        paths.push(path.slice(0,half+1),path.slice(half));
      } else paths.push(path);
    }
  }
  junctions.forEach(walk);
  nodes.forEach(walk);
  return paths;
}

/** Straighten a run only where the shortcut stays inside the permitted inset. */
export function straightenWallRuns(paths:C.Paths,inset:C.Paths,tolerance:number,parallelSlack=0):C.Paths {
  const edges=inset.flatMap(ring=>ring.map((a,i)=>{
    const b=ring[(i+1)%ring.length];
    return {a,b,left:Math.min(a.X,b.X),right:Math.max(a.X,b.X),top:Math.min(a.Y,b.Y),bottom:Math.max(a.Y,b.Y)};
  }));
  function crossesBoundary(a:C.IntPoint,b:C.IntPoint) {
    const left=Math.min(a.X,b.X),right=Math.max(a.X,b.X),top=Math.min(a.Y,b.Y),bottom=Math.max(a.Y,b.Y);
    const dx=b.X-a.X,dy=b.Y-a.Y;
    for(const edge of edges) {
      if(edge.left>right || edge.right<left || edge.top>bottom || edge.bottom<top) continue;
      const u=edge.a,v=edge.b;
      const s1=dx*(u.Y-a.Y)-dy*(u.X-a.X),s2=dx*(v.Y-a.Y)-dy*(v.X-a.X);
      if(s1*s2>0) continue;
      const ex=v.X-u.X,ey=v.Y-u.Y;
      if((ex*(a.Y-u.Y)-ey*(a.X-u.X))*(ex*(b.Y-u.Y)-ey*(b.X-u.X))<=0) return true;
    }
    return false;
  }
  return paths.map(path=>{
    if(path.length<=2) return path;
    const keep=new Set([0,path.length-1]),pending=[[0,path.length-1]];
    while(pending.length) {
      const [first,last]=pending.pop()!;
      if(last<=first+1) continue;
      const a=path[first],b=path[last],dx=b.X-a.X,dy=b.Y-a.Y,len=dx*dx+dy*dy;
      let max=0,middle=Math.floor((first+last)/2);
      for(let i=first+1;i<last;i++) {
        const p=path[i],u=len?Math.max(0,Math.min(1,((p.X-a.X)*dx+(p.Y-a.Y)*dy)/len)):0;
        const d=(p.X-a.X-dx*u)**2+(p.Y-a.Y-dy*u)**2;
        if(d>max){max=d;middle=i;}
      }
      if(max<=tolerance*tolerance && !crossesBoundary(a,b)) continue;
      // For a nearly straight brush gesture, a small parallel shift can keep
      // one rectangle inside a narrow bend instead of splitting it repeatedly.
      if(parallelSlack && first===0 && last===path.length-1 && max<=parallelSlack**2 && len>0) {
        for(let i=1;i<=8;i++) for(const direction of [-1,1]) {
          const factor=parallelSlack*i*direction/(8*Math.sqrt(len));
          const x=Math.round(-dy*factor),y=Math.round(dx*factor);
          const p={X:a.X+x,Y:a.Y+y},q={X:b.X+x,Y:b.Y+y};
          if(crossesBoundary(p,q)) continue;
          const mid={X:Math.round((p.X+q.X)/2),Y:Math.round((p.Y+q.Y)/2)};
          if(inset.reduce((n,ring)=>n+(C.Clipper.PointInPolygon(mid,ring)===1?(C.Clipper.Orientation(ring)?1:-1):0),0)) return [p,q];
        }
      }
      if(max<1) middle=Math.floor((first+last)/2);
      keep.add(middle);pending.push([first,middle],[middle,last]);
    }
    return path.filter((_,i)=>keep.has(i));
  });
}
