import type { PmsMapData, PmsPolygon, PmsSpawnpoint } from './pmsParser';
import { SOLDIER_COLLISION } from './soldatConstants';

interface ClimbPad {
  left: number;
  right: number;
  top: number;
  bottom: number;
  type: number;
  rebound: number;
}
export interface ClimbPoint { x: number; y: number }
interface Runner extends ClimbPoint { vx: number; vy: number; ticks: number; trace?: ClimbPoint[] }
export interface ClimbRun { reached: boolean; jumps: number; ticks: number; failedLeg?: number; trace?: ClimbPoint[] }

export function reboundImpulse(vx: number, vy: number, coefficient: number) {
  return Math.hypot(vx, vy) * Math.max(0, coefficient);
}
const GRAVITY = 0.06, DAMPING = 0.99, AIR = 0.03, RUN = 0.118;
const RADIUS = SOLDIER_COLLISION.halfWidth, HEIGHT = SOLDIER_COLLISION.height + 4; // Allow headroom for landing.

function horizontalPad(a: PmsPolygon, b: PmsPolygon): ClimbPad | undefined {
  if (a.polyType !== b.polyType || Math.abs(a.bounciness - b.bounciness) > 0.0001) return;
  const vs = [...a.vertices, ...b.vertices];
  const left = Math.min(...vs.map(v => v.x)), right = Math.max(...vs.map(v => v.x));
  const top = Math.min(...vs.map(v => v.y)), bottom = Math.max(...vs.map(v => v.y));
  if (!(left < right && top < bottom) || vs.some(v => (v.x !== left && v.x !== right) || (v.y !== top && v.y !== bottom))) return;
  const corners = (p: PmsPolygon) => new Set(p.vertices.map(v => (v.x === right ? 1 : 0) + (v.y === bottom ? 2 : 0)));
  const first = corners(a), second = corners(b);
  const shared = [...first].filter(corner => second.has(corner));
  // Opposite rectangle corners have opposite horizontal and vertical bits.
  if (first.size !== 3 || second.size !== 3 || shared.length !== 2 || (shared[0] ^ shared[1]) !== 3) return;
  return { left, right, top, bottom, type: a.polyType, rebound: a.bounciness };
}

// Sweep the body between ticks, including headroom and the sides of platforms.
function crosses(s: Runner, x: number, y: number, p: ClimbPad) {
  let enter = 0, exit = 1;
  for (const [a, b, min, max] of [[s.x, x, p.left - RADIUS, p.right + RADIUS], [s.y, y, p.top, p.bottom + HEIGHT]]) {
    if (a === b) {
      if (a <= min || a >= max) return false;
      continue;
    }
    const lo = (min - a) / (b - a), hi = (max - a) / (b - a);
    enter = Math.max(enter, Math.min(lo, hi));
    exit = Math.min(exit, Math.max(lo, hi));
    if (enter >= exit) return false;
  }
  return true;
}

function walk(s: Runner, p: ClimbPad, goal: number, world: readonly ClimbPad[]) {
  if (s.y !== p.top || p.type !== 0) return false;
  const dir = Math.sign(goal - s.x);
  let speed = 0;
  for (let i = 0; i < 140 && (goal - s.x) * dir > 1.4; i++) {
    speed = Math.min(1.4, (speed + RUN) * DAMPING);
    const x = s.x + dir * speed;
    if (x < p.left + RADIUS || x > p.right - RADIUS || world.some(o => o !== p && crosses(s, x, s.y, o))) return false;
    s.x = x;
    s.ticks++;
    if (s.ticks % 6 === 0) s.trace?.push({ x: s.x, y: s.y });
  }
  // Stand stops on normal terrain.
  s.vx = 0;
  s.vy = 0;
  s.ticks++;
  return Math.abs(goal - s.x) <= 1.4;
}

function flight(start: Runner, from: ClimbPad | undefined, to: ClimbPad, world: readonly ClimbPad[], side: boolean, aim: number) {
  const s = { ...start, trace: start.trace?.slice() };
  const jump = from?.type === 0;
  const windup = side ? 3 : 8, impulses = side ? 7 : 6;
  if (jump) s.ticks += windup;
  for (let i = 0; i < 280; i++) {
    const pushing = jump && i < impulses;
    const direction = Math.sign(aim - s.x - s.vx * 12);
    const ax = pushing ? (side ? 0.30 : 0) : AIR * direction;
    const ay = GRAVITY + (pushing ? (side ? -0.25 : -0.66) : 0);
    const vx = s.vx + ax, vy = s.vy + ay;
    const x = s.x + vx, y = s.y + vy;
    s.ticks++;
    if (vy > 0 && s.y <= to.top && y >= to.top) {
      const u = (to.top - s.y) / vy, contact = s.x + vx * u;
      if (contact >= to.left + RADIUS + 1 && contact <= to.right - RADIUS - 1 &&
        !world.some(p => p !== to && crosses(s, contact, to.top, p))) {
        // On a horizontal bouncy face Soldat subtracts the inward normal times total impact speed.
        const outY = to.type === 18 ? DAMPING * (vy - reboundImpulse(vx, vy, to.rebound)) : 0;
        if (to.type === 18 && outY >= -0.15) return;
        s.trace?.push({ x: contact, y: to.top });
        return { x: contact, y: to.top, vx: to.type === 18 ? vx * DAMPING : 0, vy: outY, ticks: s.ticks, trace: s.trace };
      }
    }
    if (world.some(p => crosses(s, x, y, p)) || y > to.top + 140) return;
    s.x = x;
    s.y = y;
    s.vx = vx * DAMPING;
    s.vy = vy * DAMPING;
    if (s.ticks % 4 === 0) s.trace?.push({ x, y });
  }
}

function* landings(start: Runner, from: ClimbPad, to: ClimbPad, world: readonly ClimbPad[]) {
  for (const offset of [5, 12, 22]) {
    const takeoff = { ...start, trace: start.trace?.slice() };
    if (from.type === 0 && !walk(takeoff, from, Math.max(from.left + 5, from.right - offset), world)) continue;
    for (const side of from.type === 18 ? [false] : [true, false]) {
      for (const aim of [(to.left + to.right) / 2, to.left + 6, to.right - 6]) {
        const landing = flight(takeoff, from, to, world, side, aim);
        if (landing) yield landing;
      }
    }
    if (from.type === 18) break;
  }
}

function support(spawn: PmsSpawnpoint, pads: ClimbPad[]) {
  return pads.filter(p => p.type === 0 && spawn.x >= p.left + RADIUS && spawn.x <= p.right - RADIUS && spawn.y <= p.top)
    .sort((a, b) => a.top - b.top)[0];
}

/** Replays the supported generated rectangle course from Alpha spawn to the Bravo flag, without jets. */
export function verifyClimbRoute(map: Pick<PmsMapData, 'polygons' | 'spawnpoints' | 'colliders'>, trace = false): ClimbRun {
  const failed = (jumps = 0, ticks = 0): ClimbRun => ({ reached: false, jumps, ticks, failedLeg: jumps + 1 });
  if (map.colliders.some(c => c.active) || map.polygons.length % 2) return failed();
  const pads: ClimbPad[] = [];
  for (let i = 0; i < map.polygons.length; i += 2) {
    const pad = horizontalPad(map.polygons[i], map.polygons[i + 1]);
    if (!pad || ![0, 5, 6, 7, 18].includes(pad.type)) return failed();
    pads.push(pad);
  }
  const spawn = map.spawnpoints.find(p => p.active && p.team === 1), flag = map.spawnpoints.find(p => p.active && p.team === 6);
  if (!spawn || !flag || spawn.x >= flag.x) return failed();
  const first = support(spawn, pads), last = support(flag, pads);
  if (!first || !last || last.top - flag.y > HEIGHT + 5) return failed();
  const start = { x: spawn.x, y: spawn.y + 8 };
  const landing = flight({ ...start, vx: 0, vy: 0, ticks: 0, trace: trace ? [start] : undefined }, undefined, first, pads, false, spawn.x);
  if (!landing) return failed();
  let s: Runner = landing;
  const course = pads.filter(p => (p.type === 0 || p.type === 18) && p.left >= first.left && p.left <= last.left).sort((a, b) => a.left - b.left);
  for (let i = 1; i < course.length; i++) {
    let next: Runner | undefined;
    for (const contact of landings(s, course[i - 1], course[i], pads)) {
      if (course[i].type !== 18) {
        next = contact;
        break;
      }
      const target = course[i + 1];
      if (!target) break;
      const after = landings(contact, course[i], target, pads).next().value;
      if (after) {
        next = after;
        i++;
        break;
      }
    }
    if (!next) return failed(i - 1, s.ticks);
    s = next;
  }
  if (!walk(s, last, flag.x, pads)) return failed(course.length - 1, s.ticks);
  s.trace?.push({ x: s.x, y: s.y });
  return { reached: true, jumps: course.length - 1, ticks: s.ticks, trace: s.trace };
}
