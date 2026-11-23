export type Posting = Map<string,{members:number[];total:number}>;

export function ngrams(s:string) {
  const result=new Set<string>(),padded='^'+s+'$';
  for(let i=0;i+2<padded.length;i++)result.add(padded.slice(i,i+3));
  return result;
}

export function intersection<T>(a:ReadonlySet<T>,b:ReadonlySet<T>):number {
  if(a.size>b.size)return intersection(b,a);
  let count=0;
  for(const x of a)if(b.has(x))count++;
  return count;
}

/** Keep a bounded sample from both ends of a large posting, including early anchor maps. */
export function insertCandidate(index:Posting,keys:string[],i:number) {
  for(const k of keys){
    const bin=index.get(k)??{members:[],total:0};
    if(bin.members.length===32)bin.members.splice(4,1);
    bin.members.push(i);bin.total++;index.set(k,bin);
  }
}

export function nearby(index:Posting,keys:string[]) {
  const votes=new Map<number,number>();
  for(const k of keys){
    const bucket=index.get(k);if(!bucket)continue;
    const weight=1/Math.log2(2+bucket.total);
    for(const j of bucket.members)votes.set(j,(votes.get(j)??0)+weight);
  }
  return [...votes].sort((a,b)=>b[1]-a[1]||a[0]-b[0]).slice(0,96).map(([j])=>j);
}
