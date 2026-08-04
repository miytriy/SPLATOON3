/* ==========================================================================
   stage.js — ゲーム定義: キャンバス・描画レイヤー・障害物
   --------------------------------------------------------------------------
   The core design problem this prototype is exploring: ink coverage needs to
   PERSIST on the floor independent of the render loop, while the player /
   projectiles are DYNAMIC and redrawn every frame. Mixing those into one
   canvas would force us to either redraw all accumulated ink every frame
   (expensive) or destroy old ink whenever we clear for the next frame.

   Solution: two-canvas compositing, PLUS a data/visual split within the
   persistent layer itself:
     - `coverageLayer` (offscreen, never cleared) holds ONLY the wiki-exact
       shapes: circles sized precisely to splatRadiusFalloff / footPaintRadius
       / midPaintRadius, with no decoration. This is the single source of
       truth for "how much floor is painted" and "am I standing in ink" —
       both score.js's tickPaintPoints() and painting.js's sampleInkAt() read
       exclusively from this layer, so gameplay-relevant numbers always match
       the wiki's per-shot area, regardless of how the ink is drawn on screen.
     - `paintLayer` (offscreen, never cleared) is the VISUAL layer: the same
       wiki-exact core shape from coverageLayer, plus cosmetic tendrils /
       spatter / secondary lobes on top, so it reads as real Splatoon ink
       instead of a flat circle. It is never sampled for game logic — only
       blitted to the screen by ui.js's render().
     - `stage` (the visible canvas) is cleared and redrawn every frame as:
         floor color -> paintLayer (blitted as an image) -> walls -> player
       This keeps the per-frame cost proportional to "what's moving", not
       "how much ink has ever been fired".
   ========================================================================== */

export const stage = document.getElementById('stage');
export const ctx = stage.getContext('2d');
export const W = stage.width, H = stage.height;

// Visual ink layer — wiki-exact core shape + cosmetic decoration. This is
// what actually gets blitted to the screen every frame.
export const paintLayer = document.createElement('canvas');
paintLayer.width = W; paintLayer.height = H;
export const pctx = paintLayer.getContext('2d');

// Data/coverage ink layer — wiki-exact core shapes ONLY (no tendrils, no
// spatter, no secondary lobes). This is the "territory" data model of the
// game: score.js's tickPaintPoints() and painting.js's sampleInkAt() (swim/
// regen check) read only from here, so gameplay numbers never drift from the
// wiki's documented per-shot area no matter how elaborate the on-screen
// decoration gets.
export const coverageLayer = document.createElement('canvas');
coverageLayer.width = W; coverageLayer.height = H;
export const cctx = coverageLayer.getContext('2d');

export const TEAM_COLOR = '#ff5a1f';
export const TEAM_COLOR_RGB = [255, 90, 31];

// Obstacles: unpaintable, un-walkable rectangles. Ink is clipped away from
// them (see isInsideObstacle() below) so walls always stay clean.
export const OBSTACLES = [
  { x: 360, y: 120, w: 80, h: 120 },
  { x: 150, y: 380, w: 180, h: 40 },
  { x: 560, y: 340, w: 160, h: 40 },
];

export function rectsOverlap(x, y, r, rect){
  return x + r > rect.x && x - r < rect.x + rect.w &&
         y + r > rect.y && y - r < rect.y + rect.h;
}

// 共通ヘルパー: 「この座標(半径r)は何らかの障害物に重なっているか」。
// 以前はpainting.js側の壁クリップ判定とcharger.jsの軌跡塗りクリップ判定が
// それぞれ個別に rectsOverlap(x, y, 1, o) を呼ぶ同じワンライナーを持って
// いたため、ここに一本化した。
export function isInsideObstacle(x, y, radius = 1){
  return OBSTACLES.some(o => rectsOverlap(x, y, radius, o));
}
