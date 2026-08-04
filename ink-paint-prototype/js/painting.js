import { lines } from './config.js';
import { pctx, cctx, TEAM_COLOR, TEAM_COLOR_RGB, W, H, isInsideObstacle } from './stage.js';

/* ==========================================================================
   painting.js — 塗り描画ロジック
   --------------------------------------------------------------------------
   Splat rendering (organic version): a filled circle reads as a "sticker",
   not ink, and even overlapping circles still read as "circles" up close.
   Real ink splashes are irregular-edged blobs with a few thin tendrils
   flung outward (sometimes ending in a droplet) plus a scatter of tiny
   isolated spatter dots further out. We build all three cheaply out of
   canvas paths:
     1. one core blob, sized EXACTLY to the wiki radius, drawn identically
        onto both coverageLayer (data) and paintLayer (visual) — this is
        what score.js's tickPaintPoints() / sampleInkAt() (below) see, and
        it's also what the screen shows underneath the decoration.
     2. a handful of tapering tendril shapes shot outward from the blob
        edge, each optionally capped with a tiny droplet at the tip.
     3. a scatter of isolated 1-3px droplets further from the blob, for the
        fine spatter you see around a real ink hit.
   Tendrils/spatter (2) and (3) are DECORATION ONLY: drawn to paintLayer
   alone, never to coverageLayer, so they change how the ink looks but never
   how much "counts" as painted floor or where the player can swim/regen.
   ========================================================================== */

const SPLAT_RADIUS = lines(0.15); // ink splat radius (fallback for weapons with no falloff data)

// Build an irregular ring of points around (cx,cy). `stretchDir`/`stretchAmt`
// optionally bias the radius forward along a direction (used for the
// directional landing splat) — points near stretchDir get up to stretchAmt×
// baseRadius, points on the opposite side stay close to baseRadius.
function blobPoints(cx, cy, baseRadius, numPoints, irregularity, stretchDir, stretchAmt){
  const points = [];
  for (let i = 0; i < numPoints; i++){
    const angle = (i / numPoints) * Math.PI * 2 + (Math.random() - 0.5) * (Math.PI / numPoints);
    let r = baseRadius * (0.75 + Math.random() * 0.35);
    if (Math.random() < 0.22) r *= 1.35 + Math.random() * 0.5; // occasional spike toward tendril territory
    if (stretchDir !== undefined){
      const rel = Math.atan2(Math.sin(angle - stretchDir), Math.cos(angle - stretchDir));
      const forwardFactor = (Math.cos(rel) + 1) / 2; // 0 = directly behind, 1 = directly ahead
      r *= 1 + (stretchAmt - 1) * forwardFactor;
    }
    r *= (1 + (Math.random() - 0.5) * 2 * irregularity);
    points.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
  }
  return points;
}

// Trace a smooth-but-irregular closed path through a point ring by curving
// through the midpoint of each consecutive pair, using the sampled points
// themselves as quadratic control points. Cheap, and reads as an organic
// wobbly blob rather than a faceted polygon or a perfect circle.
function drawSmoothBlobPath(pathCtx, points){
  const n = points.length;
  const first = points[0], last = points[n - 1];
  pathCtx.beginPath();
  pathCtx.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);
  for (let i = 0; i < n; i++){
    const p = points[i];
    const next = points[(i + 1) % n];
    const mx = (p.x + next.x) / 2, my = (p.y + next.y) / 2;
    pathCtx.quadraticCurveTo(p.x, p.y, mx, my);
  }
  pathCtx.closePath();
}

// A thin tapering strand flung outward from the splat, optionally ending in
// a tiny droplet — the "flick" marks you see radiating off a real ink hit.
// Decoration only: always drawn to pctx (visual layer), never to cctx.
function paintTendril(cx, cy, angle, startDist, length, width){
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const px = -dy, py = dx;
  const sx = cx + dx * startDist, sy = cy + dy * startDist;
  const ex = cx + dx * (startDist + length), ey = cy + dy * (startDist + length);
  const bend = (Math.random() - 0.5) * width * 3;
  const mx = cx + dx * (startDist + length * 0.55) + px * bend;
  const my = cy + dy * (startDist + length * 0.55) + py * bend;

  pctx.globalAlpha = 0.85 + Math.random() * 0.15;
  pctx.beginPath();
  pctx.moveTo(sx + px * width, sy + py * width);
  pctx.quadraticCurveTo(mx + px * width * 0.35, my + py * width * 0.35, ex, ey);
  pctx.quadraticCurveTo(mx - px * width * 0.35, my - py * width * 0.35, sx - px * width, sy - py * width);
  pctx.closePath();
  pctx.fill();

  if (Math.random() < 0.65){
    pctx.beginPath();
    pctx.arc(ex, ey, width * (1 + Math.random() * 1.4), 0, Math.PI * 2);
    pctx.fill();
  }
}

// Fine spatter: a handful of isolated tiny dots scattered outside the main
// blob. `biasDir` clusters more of them forward (used for landing splats).
// Decoration only: always drawn to pctx (visual layer), never to cctx.
function paintSpatter(cx, cy, baseRadius, biasDir){
  const count = 4 + Math.floor(Math.random() * 5);
  for (let i = 0; i < count; i++){
    const angle = (biasDir !== undefined && Math.random() < 0.55)
      ? biasDir + (Math.random() - 0.5) * 1.3
      : Math.random() * Math.PI * 2;
    const dist = baseRadius * (1.05 + Math.random() * 1.4);
    const r = baseRadius * (0.04 + Math.random() * 0.1);
    pctx.globalAlpha = 0.65 + Math.random() * 0.35;
    pctx.beginPath();
    pctx.arc(cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist, r, 0, Math.PI * 2);
    pctx.fill();
  }
}

// Draws the wiki-exact core blob shape identically to both the coverage
// (data) layer and the paint (visual) layer, using the given target ctx's
// fillStyle/globalAlpha convention. `targetCtx` lets callers draw the core
// shape onto coverageLayer once and reuse the exact same point set logic
// for the visual layer, so the two never drift apart in size.
function drawCoreBlob(targetCtx, points){
  targetCtx.fillStyle = TEAM_COLOR;
  drawSmoothBlobPath(targetCtx, points);
  targetCtx.globalAlpha = 0.9 + Math.random() * 0.1;
  targetCtx.fill();
}

// Plain (non-directional) organic splat — used for footpaint/midpaint dots,
// so it stays a single irregular blob plus light spatter (no tendrils; those
// are reserved for the bigger landing-impact splat to keep the per-shot cost
// down when several mid dots are drawn along one flight path).
// The core blob is drawn to BOTH layers (same point set, so coverage exactly
// matches the visible core shape); spatter is decoration, visual layer only.
export function paintSplat(cx, cy, baseRadius){
  const numPoints = 8 + Math.floor(Math.random() * 4);
  const corePoints = blobPoints(cx, cy, baseRadius, numPoints, 0.3);
  drawCoreBlob(cctx, corePoints);
  drawCoreBlob(pctx, corePoints);

  if (Math.random() < 0.6){
    const angle = Math.random() * Math.PI * 2;
    const dist = baseRadius * (0.15 + Math.random() * 0.3);
    const subPoints = blobPoints(cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist,
                                  baseRadius * (0.4 + Math.random() * 0.3), 7, 0.35);
    // Secondary lobe: still part of the "core" reading (not a flick/spatter),
    // so it counts toward coverage too — keeps the wiki radius from reading
    // as an unnaturally perfect single blob without inflating area beyond
    // what a slightly-irregular wiki-radius splat would already cover.
    drawCoreBlob(cctx, subPoints);
    drawCoreBlob(pctx, subPoints);
  }

  paintSpatter(cx, cy, baseRadius);
  pctx.globalAlpha = 1;
}

// 着弾地点の伸び: the landing splat — an irregular blob elongated forward
// along the shot's flight direction, with a burst of tendrils and spatter
// biased the same way, matching the "ink keeps traveling past the impact
// point" look of a real hit. The forward stretch itself comes straight from
// the wiki's 着弾塗りの前方伸び率 table, so the elongated CORE blob is drawn
// to coverageLayer too (it's a documented part of the splat's footprint,
// not decoration) — only the tendrils/spatter flicked off of it are
// visual-only.
export function paintSplatStretched(cx, cy, baseRadius, dirAngle, stretchRatio){
  // Shift the blob's center slightly forward so the supplied (cx,cy) reads
  // as the leading edge of impact, with the body trailing back from it.
  const centerShift = baseRadius * (stretchRatio - 1) * 0.3;
  const bx = cx + Math.cos(dirAngle) * centerShift;
  const by = cy + Math.sin(dirAngle) * centerShift;

  const numPoints = 10 + Math.floor(Math.random() * 4);
  const corePoints = blobPoints(bx, by, baseRadius, numPoints, 0.28, dirAngle, stretchRatio);
  drawCoreBlob(cctx, corePoints);
  drawCoreBlob(pctx, corePoints);

  // one or two secondary lobes for a less-perfectly-round silhouette —
  // part of the documented splat footprint, so counted on both layers.
  const secondaryCount = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < secondaryCount; i++){
    const angle = dirAngle + (Math.random() - 0.5) * 2.2;
    const dist = baseRadius * (0.2 + Math.random() * 0.4);
    const sx = bx + Math.cos(angle) * dist, sy = by + Math.sin(angle) * dist;
    const subPoints = blobPoints(sx, sy, baseRadius * (0.35 + Math.random() * 0.3), 7, 0.35);
    drawCoreBlob(cctx, subPoints);
    drawCoreBlob(pctx, subPoints);
  }

  // tendrils flung mostly forward, a few stragglers in other directions —
  // pure decoration (the "ink keeps traveling" flick marks), visual only.
  // Their reach is capped relative to baseRadius so the on-screen splat
  // still reads as "this one hit landed here", not a wide smear.
  const tendrilCount = 3 + Math.floor(Math.random() * 4);
  for (let i = 0; i < tendrilCount; i++){
    const angle = Math.random() < 0.7
      ? dirAngle + (Math.random() - 0.5) * 1.5
      : Math.random() * Math.PI * 2;
    const startDist = baseRadius * (0.55 + Math.random() * 0.3);
    const length = baseRadius * (0.35 + Math.random() * 0.55) * (0.6 + stretchRatio * 0.4);
    const width = baseRadius * (0.08 + Math.random() * 0.07);
    paintTendril(bx, by, angle, startDist, length, width);
  }

  paintSpatter(bx, by, baseRadius, dirAngle);
  pctx.globalAlpha = 1;
}

// Clip painting so ink never lands inside an obstacle's footprint — walls
// stay clean, matching the "ink can't stick to raised terrain" rule.
// dirAngle/stretchRatio are optional; when given, uses the stretched
// (directional) splat instead of the plain symmetric one.
export function paintSplatClipped(cx, cy, baseRadius, dirAngle, stretchRatio){
  if (isInsideObstacle(cx, cy, 1)) return;
  if (dirAngle !== undefined && stretchRatio !== undefined){
    paintSplatStretched(cx, cy, baseRadius, dirAngle, stretchRatio);
  } else {
    paintSplat(cx, cy, baseRadius);
  }
}

// だ円形の軌跡塗りブロブ用の点群生成（リッター4Kの軌跡塗り用）。
// radiusAlongは進行方向(縦半径)、radiusAcrossは進行方向に直交する幅(横半径)。
// blobPoints()のstretchDir/stretchAmt(前方だけ伸びる非対称ストレッチ)とは
// 違い、こちらは進行方向の前後に対称に伸びる楕円を作る(軌跡塗りは弾の通り道
// に沿って前後対称に伸びる、というwikiの図と合わせるため)。
function ellipseBlobPoints(cx, cy, radiusAlong, radiusAcross, angle, numPoints, irregularity){
  const points = [];
  for (let i = 0; i < numPoints; i++){
    const t = (i / numPoints) * Math.PI * 2 + (Math.random() - 0.5) * (Math.PI / numPoints);
    let rAlong = radiusAlong * (0.85 + Math.random() * 0.25);
    let rAcross = radiusAcross * (0.85 + Math.random() * 0.25);
    rAlong *= (1 + (Math.random() - 0.5) * 2 * irregularity);
    rAcross *= (1 + (Math.random() - 0.5) * 2 * irregularity);
    const lx = Math.cos(t) * rAlong;
    const ly = Math.sin(t) * rAcross;
    const rx = lx * Math.cos(angle) - ly * Math.sin(angle);
    const ry = lx * Math.sin(angle) + ly * Math.cos(angle);
    points.push({ x: cx + rx, y: cy + ry });
  }
  return points;
}

// 軌跡塗りの1粒。着弾splat同様、coverageLayer(判定用)とpaintLayer(見た目用)
// の両方に同じ点群でコアの楕円ブロブを描く(=軌跡塗りは装飾ではなくwiki記載
// の実面積なので、塗りポイント・自陣インク判定にもそのままカウントされる)。
export function paintTrailDot(cx, cy, radiusAlongPx, radiusAcrossPx, angle){
  if (isInsideObstacle(cx, cy, 1)) return;
  const numPoints = 9 + Math.floor(Math.random() * 3);
  const pts = ellipseBlobPoints(cx, cy, radiusAlongPx, radiusAcrossPx, angle, numPoints, 0.16);
  drawCoreBlob(cctx, pts);
  drawCoreBlob(pctx, pts);
  pctx.globalAlpha = 1;
}

// Landing-splat radius: flat for placeholder weapons, or interpolated from
// the verified 着弾塗り半径 falloff (shrinks slightly with impact distance)
// for weapons that have one.
export function getSplatRadius(weapon, traveledLines){
  const f = weapon.splatRadiusFalloff;
  if (!f) return SPLAT_RADIUS;
  if (traveledLines <= f.startDist) return lines(f.startRadius);
  if (traveledLines >= f.endDist) return lines(f.endRadius);
  const t = (traveledLines - f.startDist) / (f.endDist - f.startDist);
  return lines(f.startRadius + (f.endRadius - f.startRadius) * t);
}

// 着弾塗りの前方伸び率: how far the landing splat stretches forward past the
// impact point, interpolated the same way as the splat radius above.
export function getStretchRatio(weapon, traveledLines){
  const f = weapon.stretchFalloff;
  if (!f) return 1;
  if (traveledLines <= f.startDist) return f.startRatio;
  if (traveledLines >= f.endDist) return f.endRatio;
  const t = (traveledLines - f.startDist) / (f.endDist - f.startDist);
  return f.startRatio + (f.endRatio - f.startRatio) * t;
}

// --------------------------------------------------------------------------
// Movement + the swim check. We sample a single pixel from the COVERAGE
// layer (wiki-exact shapes only, no decoration) under the player's feet to
// decide whether they're "in their own ink" — cheap (1 pixel read) and,
// crucially, immune to visual-only tendrils/spatter making the player able
// to swim/regen in spots that aren't actually documented as painted.
// --------------------------------------------------------------------------
export function sampleInkAt(x, y){
  const data = cctx.getImageData(
    Math.min(Math.max(Math.round(x), 0), W - 1),
    Math.min(Math.max(Math.round(y), 0), H - 1),
    1, 1
  ).data;
  if (data[3] < 40) return false; // effectively unpainted
  const [r, g, b] = TEAM_COLOR_RGB;
  const dist = Math.abs(data[0]-r) + Math.abs(data[1]-g) + Math.abs(data[2]-b);
  return dist < 90; // close enough to team color, allowing for blob alpha blending
}
