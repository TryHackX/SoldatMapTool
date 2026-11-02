import { PmsMapData } from '@shared/pmsParser';
import { SOLDIER_COLLISION } from '@shared/soldatConstants';
import { EditorSpatialIndex } from './spatialIndex';

export interface PlaytestInputState {
  left: boolean;
  right: boolean;
  jump: boolean;
  crouch: boolean;
  jetpack: boolean;
}

export type SoldierPlaytestInput = PlaytestInputState;

export interface SoldierPlaytestState {
  active: boolean;
  /** Soldier body center X */
  x: number;
  /** Soldier body center Y */
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  grounded: boolean;
  onIce: boolean;
  crouching: boolean;
  jetpacking: boolean;
  team: 1 | 2 | 3 | 4;
  carryingFlag: boolean;
  jetFuel: number;
  maxJetFuel: number;
  hazardState: 'none' | 'hurts' | 'deadly' | 'regen';
  spawnX: number;
  spawnY: number;
  trail: Array<{ x: number; y: number; jet: boolean }>;
}

const GRAVITY_PER_TICK = 0.068; // ~OpenSoldat 60 Hz gravity feel
const RUN_ACCEL = 0.22;
const AIR_ACCEL = 0.11;
const MAX_RUN_SPEED = 2.65;
const JUMP_VY = -2.85;
const JET_ACCEL = 0.165;
const MAX_FALL_SPEED = 8.5;
// Hard cap after bounces so a bouncy polygon can never launch the soldier through a ceiling
const MAX_SPEED_AFTER_BOUNCE = 12;

export function doesPolyCollideSoldier(
  polyType: number,
  team: 1 | 2 | 3 | 4,
  carryingFlag: boolean
): boolean {
  if (polyType === 1 || polyType === 3 || polyType === 23 || polyType === 24 || polyType === 25) {
    return false;
  }
  if (polyType === 10 || polyType === 12 || polyType === 14 || polyType === 16) {
    return false;
  }
  if (polyType === 11) return team === 1;
  if (polyType === 13) return team === 2;
  if (polyType === 15) return team === 3;
  if (polyType === 17) return team === 4;
  if (polyType === 21) return carryingFlag;
  if (polyType === 22) return !carryingFlag;
  return true;
}

export function createSoldierPlaytestState(
  x: number,
  y: number,
  map: PmsMapData,
  teamOrOpts: 1 | 2 | 3 | 4 | { team?: 1 | 2 | 3 | 4; carryingFlag?: boolean } = 1,
  carryingFlagArg = false
): SoldierPlaytestState {
  const team: 1 | 2 | 3 | 4 =
    typeof teamOrOpts === 'object' ? (teamOrOpts.team ?? 1) : teamOrOpts;
  const carryingFlag: boolean =
    typeof teamOrOpts === 'object' ? Boolean(teamOrOpts.carryingFlag) : carryingFlagArg;
  const maxJet = Math.max(0, map.startJetGame > 0 ? map.startJetGame : 120);
  return {
    active: true,
    x,
    y,
    vx: 0,
    vy: 0,
    facing: 1,
    grounded: false,
    onIce: false,
    crouching: false,
    jetpacking: false,
    team,
    carryingFlag,
    jetFuel: maxJet,
    maxJetFuel: maxJet,
    hazardState: 'none',
    spawnX: x,
    spawnY: y,
    trail: [{ x, y, jet: false }],
  };
}

function closestPointOnSeg(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): { cx: number; cy: number; dist: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-8) {
    return { cx: ax, cy: ay, dist: Math.hypot(px - ax, py - ay) };
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  return { cx, cy, dist: Math.hypot(px - cx, py - cy) };
}

/**
 * When (px, py) lies inside the triangle, the shortest move that puts a sphere of `radius` outside it,
 * with the outward unit normal of the edge it leaves through; null when the point is outside.
 */
function pushOutOfTriangle(
  px: number,
  py: number,
  vs: ReadonlyArray<{ x: number; y: number }>,
  radius: number
): { dx: number; dy: number; nx: number; ny: number } | null {
  const area2 = (vs[1].x - vs[0].x) * (vs[2].y - vs[0].y) - (vs[1].y - vs[0].y) * (vs[2].x - vs[0].x);
  if (Math.abs(area2) < 1e-6) return null;
  const sign = area2 > 0 ? 1 : -1; // works for either winding
  let best: { dist: number; nx: number; ny: number } | null = null;
  for (let e = 0; e < 3; e++) {
    const a = vs[e];
    const b = vs[(e + 1) % 3];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len < 1e-6) return null;
    // Outward normal of this edge for the triangle's winding (Y points down)
    const nx = (sign * ey) / len;
    const ny = (-sign * ex) / len;
    const d = -((px - a.x) * nx + (py - a.y) * ny); // > 0 inside
    if (d < 0) return null;
    if (!best || d < best.dist) best = { dist: d, nx, ny };
  }
  if (!best) return null;
  const move = best.dist + radius;
  return { dx: best.nx * move, dy: best.ny * move, nx: best.nx, ny: best.ny };
}

/**
 * Advances the Soldat soldier playtest simulation by one 60 Hz physics tick.
 * Models a 2-circle vertical capsule (`width = 7`, `height = 14`, or `9.5` crouched) colliding
 * against CW map polygons (including Ice, Bouncy `bounciness`, Deadly/Lava, Team walls) and Colliders (`d/2`).
 */
export function stepSoldierPlaytest(
  prev: SoldierPlaytestState,
  input: PlaytestInputState,
  map: PmsMapData,
  spatialIndex: EditorSpatialIndex,
  _dt?: number
): SoldierPlaytestState {
  if (!prev.active) return prev;

  let { x, y, vx, vy, grounded, onIce, jetFuel, facing } = prev;
  const crouching = input.crouch;
  const radius = SOLDIER_COLLISION.width * 0.5; // 3.5 units
  const halfH = crouching ? 4.75 : SOLDIER_COLLISION.height * 0.5; // 7 units standing
  const spineHalf = Math.max(0, halfH - radius); // 3.5 standing, 1.25 crouching

  // Horizontal movement
  const moveDir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (moveDir > 0) facing = 1;
  else if (moveDir < 0) facing = -1;
  const accel = grounded ? (onIce ? RUN_ACCEL * 0.32 : RUN_ACCEL) : AIR_ACCEL;
  if (moveDir !== 0) {
    const maxSpd = crouching && grounded ? MAX_RUN_SPEED * 0.6 : MAX_RUN_SPEED;
    if (moveDir > 0 && vx < maxSpd) vx = Math.min(maxSpd, vx + accel);
    if (moveDir < 0 && vx > -maxSpd) vx = Math.max(-maxSpd, vx - accel);
  } else if (grounded) {
    const friction = onIce ? 0.985 : 0.78;
    vx *= friction;
    if (Math.abs(vx) < 0.02) vx = 0;
  } else {
    vx *= 0.992;
  }

  // Jump
  if (input.jump && grounded) {
    vy = JUMP_VY;
    grounded = false;
  }

  // Jetpack thrust & fuel regen
  let usingJet = false;
  if (input.jetpack && jetFuel > 0) {
    vy -= JET_ACCEL;
    if (moveDir !== 0) vx += moveDir * 0.045;
    jetFuel = Math.max(0, jetFuel - 1);
    usingJet = true;
  } else if (prev.maxJetFuel > 0) {
    jetFuel = Math.min(prev.maxJetFuel, jetFuel + (grounded ? 1.25 : 0.35));
  }

  // Gravity
  vy = Math.min(MAX_FALL_SPEED, vy + GRAVITY_PER_TICK);

  // Sub-step integration: each step moves at most half the sphere radius, so a fast fall can never put the feet
  // sphere's centre past a floor edge (its push-out would then be rejected as "inward" and the soldier sinks)
  let nextGrounded = false;
  let nextOnIce = false;
  let hazard: SoldierPlaytestState['hazardState'] = 'none';

  const subSteps = Math.max(2, Math.min(16, Math.ceil(Math.max(Math.abs(vx), Math.abs(vy)) / (radius * 0.5))));
  for (let step = 0; step < subSteps; step++) {
    x += vx / subSteps;
    y += vy / subSteps;

    const queryPad = halfH + 8;
    const polyCandidates = spatialIndex.queryPolygonCandidates(
      x - queryPad,
      y - queryPad,
      x + queryPad,
      y + queryPad
    );

    // Check head & foot spheres of the soldier capsule
    const spheres = [
      { offsetY: spineHalf, isFeet: true },
      { offsetY: -spineHalf, isFeet: false },
    ];

    for (const pi of polyCandidates) {
      const poly = map.polygons[pi];
      if (!poly || !doesPolyCollideSoldier(poly.polyType, prev.team, prev.carryingFlag)) continue;
      const vs = poly.vertices;

      for (const sph of spheres) {
        const sx = x;
        const sy = y + sph.offsetY;

        // Centre already inside the triangle (teleport, spawn in a wall): leave through the nearest edge
        const inside = pushOutOfTriangle(sx, sy, vs, radius);
        if (inside) {
          x += inside.dx;
          y += inside.dy;
          const vnIn = vx * inside.nx + vy * inside.ny;
          if (vnIn < 0) {
            vx -= vnIn * inside.nx;
            vy -= vnIn * inside.ny;
          }
          if (sph.isFeet && inside.ny < -0.45) nextGrounded = true;
          continue;
        }

        for (let e = 0; e < 3; e++) {
          const va = vs[e];
          const vb = vs[(e + 1) % 3];
          const cp = closestPointOnSeg(sx, sy, va.x, va.y, vb.x, vb.y);
          if (cp.dist >= radius) continue;

          // Push direction out of polygon: use push vector from contact point, biased outward from CW edge
          const edgeDx = vb.x - va.x;
          const edgeDy = vb.y - va.y;
          const edgeLen = Math.hypot(edgeDx, edgeDy);
          if (edgeLen < 1e-4) continue;
          // Outward unit normal of edge (va -> vb) in Y-down space: (edgeDy/len, -edgeDx/len) for clockwise
          // triangles, the opposite for counter-clockwise ones (old maps have those)
          const winding = (vs[1].x - vs[0].x) * (vs[2].y - vs[0].y) - (vs[1].y - vs[0].y) * (vs[2].x - vs[0].x) < 0 ? -1 : 1;
          const outX = (winding * edgeDy) / edgeLen;
          const outY = (-winding * edgeDx) / edgeLen;

          let nx = cp.dist > 1e-4 ? (sx - cp.cx) / cp.dist : outX;
          let ny = cp.dist > 1e-4 ? (sy - cp.cy) / cp.dist : outY;
          // Only push toward the exterior side of the edge so internal mesh seams don't snag
          if (nx * outX + ny * outY < -0.15) continue;

          const pen = radius - cp.dist;
          x += nx * pen;
          y += ny * pen;

          if (poly.polyType === 5 || poly.polyType === 6 || poly.polyType === 9 || poly.polyType === 19) {
            hazard = 'deadly';
          } else if (poly.polyType === 7 || (poly.polyType === 20 && prev.carryingFlag)) {
            if (hazard === 'none') hazard = 'hurts';
          } else if (poly.polyType === 8 && hazard === 'none') {
            hazard = 'regen';
          }

          const vn = vx * nx + vy * ny;
          if (vn < 0) {
            if (poly.polyType === 18) {
              // Restitution from the polygon's bounciness (the speed cap below stops runaway launches)
              const bounce = Math.max(0.2, Math.min(1.6, poly.bounciness || 1));
              vx -= (1 + bounce) * vn * nx;
              vy -= (1 + bounce) * vn * ny;
              const speed = Math.hypot(vx, vy);
              if (speed > MAX_SPEED_AFTER_BOUNCE) {
                vx *= MAX_SPEED_AFTER_BOUNCE / speed;
                vy *= MAX_SPEED_AFTER_BOUNCE / speed;
              }
            } else {
              vx -= vn * nx;
              vy -= vn * ny;
            }
          }

          // Grounded if surface normal points sufficiently upward (ny < -0.45 in Y-down space)
          if (sph.isFeet && ny < -0.45 && poly.polyType !== 18) {
            nextGrounded = true;
            if (poly.polyType === 4) nextOnIce = true;
          }
        }
      }
    }

    // Circular map colliders (player collision radius = diameter / 2)
    for (const col of map.colliders) {
      if (!col.active) continue;
      const colR = Math.max(1, Math.abs(col.radius) * 0.5);
      for (const sph of spheres) {
        const sx = x;
        const sy = y + sph.offsetY;
        const dx = sx - col.x;
        const dy = sy - col.y;
        const dist = Math.hypot(dx, dy);
        const minDist = radius + colR;
        if (dist < minDist) {
          const nx = dist > 1e-4 ? dx / dist : 0;
          const ny = dist > 1e-4 ? dy / dist : -1;
          const pen = minDist - dist;
          x += nx * pen;
          y += ny * pen;
          const vn = vx * nx + vy * ny;
          if (vn < 0) {
            vx -= vn * nx;
            vy -= vn * ny;
          }
          if (sph.isFeet && ny < -0.45) {
            nextGrounded = true;
          }
        }
      }
    }
  }

  const nextTrail =
    prev.trail.length === 0 ||
    Math.hypot(x - prev.trail[prev.trail.length - 1].x, y - prev.trail[prev.trail.length - 1].y) >= 4
      ? [...prev.trail.slice(-140), { x, y, jet: usingJet }]
      : prev.trail;

  return {
    ...prev,
    x,
    y,
    vx,
    vy,
    facing,
    grounded: nextGrounded,
    onIce: nextOnIce,
    crouching,
    jetpacking: usingJet,
    jetFuel,
    hazardState: hazard,
    trail: nextTrail,
  };
}
