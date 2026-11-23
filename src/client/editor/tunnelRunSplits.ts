import type { TunnelPoint } from '@shared/climbTunnel';

export interface TunnelRunSplit {
  /** One-based indices into the editable knot sequence, inclusive. */
  knotIndex: number;
  lastKnotIndex: number;
  status: 'complete' | 'stopped' | 'unreached';
  /** Elapsed 60 Hz ticks in this range and since spawn. The final flag tick is integral. */
  ticks?: number;
  cumulativeTicks?: number;
  point: TunnelPoint;
}

interface Checkpoint { center: TunnelPoint; along: number }
interface SplitRange { first: number; last: number; gate?: number; point: TunnelPoint }
export interface SplitStamp { tick: number; point: TunnelPoint; previous?: SplitStamp }

/** Cut the run at existing mandatory checkpoints. Adding an extra steering target would change
 * the pilot's trajectory. Several close edit handles can share one measured interval. */
export function planRunSplits(anchors: readonly number[], gates: readonly Checkpoint[], flag: TunnelPoint): SplitRange[] {
  if (!anchors.length || anchors.length > 800 ||
    anchors.some((along,i) => !Number.isFinite(along) || along < 0 || (i > 0 && along < anchors[i-1]))) return [];
  const cuts = new Map<number,{last:number;error:number}>();
  let gate = 0;
  for (let i = 1; i < anchors.length && gates.length; i++) {
    const halfway = (anchors[i-1]+anchors[i])/2;
    while (gate+1 < gates.length && Math.abs(gates[gate+1].along-halfway) < Math.abs(gates[gate].along-halfway)) gate++;
    const error = Math.abs(gates[gate].along-halfway);
    // Keep the closest boundary if several are served by the same checkpoint.
    if (error < (cuts.get(gate)?.error ?? Infinity)) cuts.set(gate,{last:i,error});
  }
  const ranges: SplitRange[] = [];
  let first = 1;
  for (const [gate,{last}] of cuts) {
    ranges.push({first,last,gate,point:gates[gate].center});
    first = last+1;
  }
  ranges.push({first,last:anchors.length,point:{x:flag.x,y:flag.y}});
  return ranges;
}

/** Stamps are persistent branch prefixes: a failed search branch can never contribute time to
 * a chosen successful run, including after the search restarts at an earlier shaft landing. */
export function finishRunSplits(ranges: readonly SplitRange[], latest: SplitStamp | undefined,
  ticks: number, reached: boolean, end: TunnelPoint): TunnelRunSplit[] {
  const crossings: SplitStamp[] = [];
  for (let stamp = latest; stamp; stamp = stamp.previous) crossings.push(stamp);
  crossings.reverse();
  let start = 0;
  return ranges.map((range,i) => {
    const row = {knotIndex:range.first,lastKnotIndex:range.last};
    const stamp = crossings[i];
    if (stamp) {
      const elapsed = stamp.tick-start;
      start = stamp.tick;
      return {...row,status:'complete',ticks:elapsed,cumulativeTicks:stamp.tick,point:stamp.point};
    }
    if (i === crossings.length) {
      return {...row,status:reached ? 'complete' : 'stopped',ticks:ticks-start,cumulativeTicks:ticks,
        point:{x:end.x,y:end.y}};
    }
    return {...row,status:'unreached',point:range.point};
  });
}
