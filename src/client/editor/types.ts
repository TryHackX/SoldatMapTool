import { PmsBounds } from '@shared/pmsParser';
import { RgbaColor } from '@shared/soldatConstants';

export type EditorToolId =
  | 'select'
  | 'lasso'
  | 'vertex'
  | 'poly_tri'
  | 'poly_strip'
  | 'poly_fan'
  | 'poly_shape'
  | 'poly_laser'
  | 'color_brush'
  | 'uv'
  | 'scenery'
  | 'spawn'
  | 'collider'
  | 'waypoint'
  | 'light'
  | 'ruler'
  | 'playtest';

export type SelectionFilterMode = 'all' | 'polygons' | 'sceneries' | 'entities';

export type EditorObjectKind = 'polygon' | 'prop' | 'spawn' | 'collider' | 'waypoint';

export interface EditorVertexRef {
  polyIndex: number;
  vertexIndex: 0 | 1 | 2;
}

export interface EditorSelection {
  polygons: number[];
  vertices: EditorVertexRef[];
  props: number[];
  spawns: number[];
  colliders: number[];
  waypoints: number[]; // 0-based indices into map.waypoints
}

export interface EditorLayerLocks {
  polygons: boolean;
  sceneryBack: boolean;
  sceneryMid: boolean;
  sceneryFront: boolean;
  spawns: boolean;
  flags: boolean;
  bonuses: boolean;
  colliders: boolean;
  waypoints: boolean;
}

export const DEFAULT_EDITOR_LOCKS: EditorLayerLocks = {
  polygons: false,
  sceneryBack: false,
  sceneryMid: false,
  sceneryFront: false,
  spawns: false,
  flags: false,
  bonuses: false,
  colliders: false,
  waypoints: false,
};

export interface EditorSnapSettings {
  snapToGrid: boolean;
  gridSize: number;
  snapToVertices: boolean;
  snapToEdges: boolean;
  angleSnap: boolean;
  angleStepDeg: number;
  smartGuides: boolean;
  weldSharedVertices: boolean;
}

export const DEFAULT_EDITOR_SNAP: EditorSnapSettings = {
  snapToGrid: false,
  gridSize: 16,
  snapToVertices: true,
  snapToEdges: true,
  angleSnap: false,
  angleStepDeg: 15,
  smartGuides: true,
  weldSharedVertices: true,
};

export type ColorBlendMode = 'replace' | 'multiply' | 'screen' | 'alpha_only';

export interface EditorBrushSettings {
  color: RgbaColor;
  radius: number; // world units
  strength: number; // 0..1
  blendMode: ColorBlendMode;
  affectSelectedOnly: boolean;
  affectSceneries: boolean;
  lightRadius: number;
  lightIntensity: number;
}

export const DEFAULT_BRUSH_SETTINGS: EditorBrushSettings = {
  color: { r: 255, g: 255, b: 255, a: 255 },
  radius: 48,
  strength: 0.35,
  blendMode: 'replace',
  affectSelectedOnly: false,
  affectSceneries: false,
  lightRadius: 220,
  lightIntensity: 0.75,
};

export interface EditorPlacementDefaults {
  polyType: number;
  bounciness: number;
  polyColor: RgbaColor;
  polyShapeMode: 'polygon' | 'rect';
  laserDetail: number;
  laserSmoothPasses: number;
  laserAutoShade: boolean;
  sceneryFilename: string;
  sceneryLevel: 0 | 1 | 2;
  sceneryScaleX: number;
  sceneryScaleY: number;
  sceneryRotationDeg: number;
  sceneryAlpha: number;
  sceneryTint: RgbaColor;
  sceneryLockAspect: boolean;
  sceneryStampAlways: boolean;
  sceneryRandomize: boolean;
  sceneryScaleJitter: number; // 0..0.6
  sceneryRotJitterDeg: number; // 0..180
  sceneryRandomFlipX: boolean;
  spawnTeam: number;
  colliderDiameter: number;
  waypointPathNum: number;
  waypointAction: number;
}

export const DEFAULT_PLACEMENT_SETTINGS: EditorPlacementDefaults = {
  polyType: 0,
  bounciness: 1.5,
  polyColor: { r: 220, g: 226, b: 234, a: 255 },
  polyShapeMode: 'polygon',
  laserDetail: 8,
  laserSmoothPasses: 1,
  laserAutoShade: true,
  sceneryFilename: '',
  sceneryLevel: 1,
  sceneryScaleX: 1,
  sceneryScaleY: 1,
  sceneryRotationDeg: 0,
  sceneryAlpha: 255,
  sceneryTint: { r: 255, g: 255, b: 255, a: 255 },
  sceneryLockAspect: true,
  sceneryStampAlways: false,
  sceneryRandomize: false,
  sceneryScaleJitter: 0.15,
  sceneryRotJitterDeg: 12,
  sceneryRandomFlipX: false,
  spawnTeam: 0,
  colliderDiameter: 32,
  waypointPathNum: 1,
  waypointAction: 0,
};

export interface EditorBlueprintOverlay {
  image: HTMLImageElement | HTMLCanvasElement;
  width: number;
  height: number;
  name: string;
  x: number;
  y: number;
  scale: number;
  opacity: number; // 0..1
  visible: boolean;
}

export type GizmoHandleKind =
  | 'move'
  | 'rotate'
  | 'scale_nw'
  | 'scale_ne'
  | 'scale_se'
  | 'scale_sw'
  | 'scale_n'
  | 'scale_s'
  | 'scale_w'
  | 'scale_e'
  | 'collider_rim';

export interface SnapIndicator {
  x: number;
  y: number;
  kind: 'grid' | 'vertex' | 'edge' | 'guide';
}

export interface SmartGuideLine {
  axis: 'x' | 'y';
  coord: number;
  from: number;
  to: number;
}

export interface SelectionSummary {
  totalObjects: number;
  vertexCount: number;
  bounds: PmsBounds | null;
}

export type LeftDockTab = 'layers' | 'outliner' | 'assets' | 'prefabs';
export type RightDockTab = 'properties' | 'settings' | 'validation' | 'history';
