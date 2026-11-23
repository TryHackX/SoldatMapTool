import type {JumpSample} from './climbSamples';
import {verifyClimbRoute} from './climbPhysics';
import {makeQuadPolys} from './editorTemplates';

export interface SectionSequence {previous:JumpSample;next:JumpSample}
export interface NumericFamily {holdout:boolean;knownAuthor:boolean;sequences:SectionSequence[]}
export interface ExperimentDataset {families:NumericFamily[];selected:number;skipped:number;unreadable:number}
interface Prediction {gap:number;rise:number;landingWidth:number}
export interface ExperimentScore extends Prediction {passed:number;probes:number;predictionMs:number}
const metrics=['gap','rise','landingWidth'] as const;
const bounds={gap:[6,170],rise:[-80,80],landingWidth:[7,220]} as const;
const limit=(n:number,a:number,b:number)=>Math.min(b,Math.max(a,n));
const vector=(s:JumpSample)=>[s.gap/100,s.rise/80,(s.landingWidth ?? 40)/100,limit(s.rebound ?? 0,0,4)/4];
type Observation = {row:SectionSequence;weight:number};
type Predict = (row:JumpSample)=>Prediction;

function medianBaseline(examples:Observation[]):Predict {
  const total=examples.reduce((sum,x)=>sum+x.weight,0);
  const proposal:Prediction={gap:0,rise:0,landingWidth:0};
  for(const key of metrics){
    const ordered=[...examples].sort((a,b)=>a.row.next[key]!-b.row.next[key]!);
    let sum=0;
    for(const {row,weight} of ordered){
      sum+=weight;
      if(sum>=total/2){proposal[key]=row.next[key]!;break;}
    }
  }
  return ()=>proposal;
}

/** Small ridge regression with an unpenalized intercept. All four input features have a
 * fixed physical scale; fitting and regularisation use only reference families. */
function fitRegression(examples:Observation[]):Predict {
  const dimensions=5, total=examples.reduce((sum,x)=>sum+x.weight,0);
  const matrix=Array.from({length:dimensions},()=>Array<number>(dimensions+metrics.length).fill(0));
  for(const {row,weight} of examples){
    const values=[1,...vector(row.previous)];
    for(let i=0;i<dimensions;i++){
      const w=weight*values[i]/total;
      for(let j=0;j<dimensions;j++) matrix[i][j]+=w*values[j];
      for(let k=0;k<metrics.length;k++) matrix[i][dimensions+k]+=w*row.next[metrics[k]]!;
    }
  }
  for(let i=1;i<dimensions;i++) matrix[i][i]+=0.015;
  for(let i=0;i<dimensions;i++){
    // The regularised Gram matrix is positive definite, so each symmetric pivot is positive.
    const pivot=matrix[i][i];
    for(let col=i;col<matrix[i].length;col++) matrix[i][col]/=pivot;
    for(let j=0;j<dimensions;j++){
      if(j===i) continue;
      const scale=matrix[j][i];
      for(let col=i;col<matrix[i].length;col++) matrix[j][col]-=scale*matrix[i][col];
    }
  }
  return previous=>{
    const values=[1,...vector(previous)];
    const result:Prediction={gap:0,rise:0,landingWidth:0};
    metrics.forEach((key,k)=>{
      const estimate=values.reduce((s,v,i)=>s+v*matrix[i][dimensions+k],0);
      result[key]=limit(estimate,bounds[key][0],bounds[key][1]);
    });
    return result;
  };
}

function probe(previous:JumpSample, next:Prediction){
  const middleLeft=previous.gap, middleRight=middleLeft+previous.landingWidth!;
  const lastLeft=middleRight+next.gap, lastRight=lastLeft+next.landingWidth;
  const middleY=-previous.rise,lastY=middleY-next.rise;
  const rect=(left:number,right:number,y:number)=>makeQuadPolys(left,y,right,y+10);
  const spawnpoints=[{x:-24,y:-26,team:1,active:true,index:0},{x:(lastLeft+lastRight)/2,y:lastY-16,team:6,active:true,index:1}];
  return verifyClimbRoute({polygons:[...rect(-58,0,0),...rect(middleLeft,middleRight,middleY),...rect(lastLeft,lastRight,lastY)],spawnpoints,colliders:[]}).reached;
}

function score(families:NumericFamily[],predict:Predict,probes:SectionSequence[]):ExperimentScore {
  const output:ExperimentScore={gap:0,rise:0,landingWidth:0,passed:0,probes:probes.length,predictionMs:0};
  for(const family of families){
    const start=performance.now();
    const predicted=family.sequences.map(row=>predict(row.previous));
    output.predictionMs+=performance.now()-start;
    for(const [i,{next}] of family.sequences.entries()) for(const key of metrics){
      output[key]+=Math.abs(predicted[i][key]-next[key]!)/(family.sequences.length*families.length);
    }
  }
  for(const row of probes) if(probe(row.previous,predict(row.previous))) output.passed++;
  return output;
}

export function evaluateSectionExperiment(dataset:ExperimentDataset) {
  const families=dataset.families.filter(f=>f.sequences.length);
  const train=families.filter(f=>!f.holdout), test=families.filter(f=>f.holdout);
  const counts={selected:dataset.selected,skipped:dataset.skipped,unreadable:dataset.unreadable,training:train.length,heldOut:test.length,
    unknownAuthors:families.filter(f=>!f.knownAuthor).length,trainPairs:train.reduce((sum,f)=>sum+f.sequences.length,0),
    testPairs:test.reduce((sum,f)=>sum+f.sequences.length,0)};
  if(train.length<2 || !test.length || counts.trainPairs<6) return {counts,scores:null};
  const examples=train.flatMap(f=>f.sequences.map(row=>({row,weight:1/f.sequences.length})));
  const baseline=medianBaseline(examples), learned=fitRegression(examples);
  // Space at most 32 probes evenly across held-out families; both methods see the same first jump.
  const n=Math.min(32,test.length);
  const probes=Array.from({length:n},(_,i)=>{
    const {sequences}=test[Math.floor((i+0.5)*test.length/n)];
    return sequences[Math.floor(sequences.length/2)];
  });
  return {counts,scores:{baseline:score(test,baseline,probes),learned:score(test,learned,probes)}};
}
export type ExperimentReport=ReturnType<typeof evaluateSectionExperiment>;

