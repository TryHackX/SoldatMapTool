export interface RenderLayerVisibility {
  showBackground: boolean;
  showPolygons: boolean;
  showSmoothEdges: boolean;
  showSceneryBack: boolean;
  showSceneryMid: boolean;
  showSceneryFront: boolean;
  frontSceneryOpacity: number; // 0..1 (e.g. 1.0 = full classic, 0.35 = X-Ray hiding spots!)

  // Classic vs HD rendering style
  preferClassicBmp: boolean;   // True = classic Soldat 1.6 .bmp textures over HD .png overrides
  pixelatedFilter: boolean;    // True = GL_NEAREST crisp pixel art filter

  // Tactical / Editor Overlays
  showFlags: boolean;
  showSpawns: boolean;
  showBonuses: boolean;
  showColliders: boolean;
  showPolyTypes: boolean;
  showWireframe: boolean;
  showWaypoints: boolean;
  showGrid: boolean;
}

export const DEFAULT_RENDER_LAYERS: RenderLayerVisibility = {
  showBackground: true,
  showPolygons: true,
  showSmoothEdges: true,
  showSceneryBack: true,
  showSceneryMid: true,
  showSceneryFront: true,
  frontSceneryOpacity: 1.0,

  preferClassicBmp: false,
  pixelatedFilter: false,

  showFlags: false,
  showSpawns: false,
  showBonuses: false,
  showColliders: false,
  showPolyTypes: false,
  showWireframe: false,
  showWaypoints: false,
  showGrid: false,
};

export interface CameraViewport {
  left: number;
  right: number;
  top: number;
  bottom: number;
  zoom: number; // screen pixels per 1.0 Soldat world unit (1.0 = 100% native view!)
}

export interface FullSizeExportSettings {
  scale: number;                      // 1.0 = 100% Full Size View, 0.5 = 50%, 2.0 = 200%
  boundsMode: 'poly' | 'full';        // 'poly' = polygon bounds, 'full' = polygons + scenery + spawns
  paddingPx: number;                  // World padding around bounds (e.g. 64px)
  format: 'png' | 'jpeg' | 'webp';
  quality: number;                    // 1..100 for jpeg/webp
  layers: RenderLayerVisibility;      // Which layers/overlays to bake into the 100% screenshot
  saveToServerExports: boolean;       // Save to exports/screenshots/ on disk
  triggerBrowserDownload: boolean;    // Also download in browser (for single map)
  includeWatermark: boolean;          // Optional subtle map title & dimensions badge
  subfolderMode: 'none' | 'prefix' | 'mode'; // Optional automatic subfolder organization
  skipExisting: boolean;              // Skip maps that already have an exported screenshot in batch mode
  customFolder?: string;              // Optional custom output directory on disk
}
