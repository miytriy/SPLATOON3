import { FPS, lines, toLines, duPerFrameToPxPerSec, mPerFrameToPxPerSec } from './config.js';
import { W, H, isInsideObstacle } from './stage.js';
import { paintSplatClipped, getSplatRadius, getStretchRatio } from './painting.js';
import { creditCappedPaintPoints } from './score.js';
import { player, bias, getCurrentWeapon, incrementBurstShotCount } from './player.js';
import { dummy, respawnDummy } from './dummy.js';

/* ==========================================================================
   projectiles.js — シューター種の弾道・発射ロジック
   --------------------------------------------------------------------------
   Projectiles: fired pellets fly straight at full 初速 for directFrames,
   then transition through 減速状態 (XZ/Y speed each decay toward their own
   floor) and finally 自由落下状態 (slower decay, no floor). This is the
   documented 3-phase model, stepped per-frame by stepProjectilePhysics()
   below. Y speed is tracked only as hidden state to time the decel→freefall
   switch — this prototype is top-down, so height itself is never rendered
   or used to decide where a shot lands. Where the shot actually lands is
   still governed by our own range cap (max range / cursor distance) plus
   wall/enemy/bounds hits — the 3-phase model only changes how fast it
   travels along the way, not where that cap sits.
   A crude exponential fallback is kept for any future weapon added without
   verified decel/freefall constants.
   ========================================================================== */

export const projectiles = [];
const DECAY_RATE_PER_FRAME_FALLBACK = 0.75; // speed multiplier per frame (only used if a weapon lacks decel/freefall data)

// Damage at hit time: flat for placeholder weapons, or interpolated from the
// verified time-based falloff table for weapons that have one (currently
// only スプラシューター). frameNumber is the integer frame count since the
// shot was fired (from p.frameCount, the same discrete per-frame counter the
// ballistic physics model uses — NOT a continuous age*FPS value, since the
// wiki's table is defined in terms of exact frame numbers).
// 端数処理: 減衰中のダメージは小数点第1位までで切り捨てる
// （wiki記載の実例: 9F目 36-0.5625=35.4375 → 35.4、12F目 33.75 → 33.7）。
function getProjectileDamage(weapon, frameNumber){
  const f = weapon.damageFalloff;
  if (!f) return weapon.damage;
  if (frameNumber <= f.startFrame) return f.startDamage;
  if (frameNumber >= f.endFrame) return f.endDamage;
  const decayPerFrame = f.perFrameDecay;
  const raw = f.startDamage - decayPerFrame * (frameNumber - f.startFrame);
  return Math.floor(raw * 10) / 10;
}

// Per-shot spread angle (degrees). Weapons with bias data (初弾補正・ブレ)
// use the documented gamma-correction formula:
//   y = s * x^(log_0.5(b))
// where x is a uniform random draw in [0,1], s is the weapon's 拡散
// (spreadDeg), and b = bias.currentDeg / s is the current bias value
// expressed as a fraction of the max spread. By construction, at x=0.5 this
// yields y = s*b = bias.currentDeg exactly — i.e. half of all shots land
// within the current tight-cone angle, and the other half are distributed
// out toward the full spread cone, biased toward the center. The result is
// a magnitude in [0, s]; a random sign gives the final left/right offset.
// Weapons without bias data just use a flat uniform draw over spreadDeg.
function sampleShotSpreadDeg(weapon){
  if (weapon.firstShotBiasDeg === undefined){
    return (Math.random() - 0.5) * weapon.spreadDeg;
  }
  const s = weapon.spreadDeg;
  const b = Math.min(bias.currentDeg / s, 0.999); // 拡散に対するブレ補正値の比率
  const x = Math.random();
  const exponent = Math.log(0.5) / Math.log(b); // = log_0.5(b)
  const magnitude = s * Math.pow(x, exponent);
  const sign = Math.random() < 0.5 ? -1 : 1;
  return sign * magnitude;
}

// --------------------------------------------------------------------------
// 命中率の理論値 (hit-probability formula):
//   p = ( atan(1 / sqrt(d^2/(r1+r2)^2 - 1)) / s )^log_b(0.5)
// where r1 = 的の当たり判定半径, r2 = 弾の大きさ半径, d = 的までの距離,
// s = 拡散(ラジアン), b = 現在のブレ補正値 / 拡散 (sampleShotSpreadDegと
// 同じ比率・同じ exponent = log(0.5)/log(b) を使う — 式の中の "log_b(0.5)"
// 表記は log(0.5)/log(b) を指しているため、Math.pow の指数計算はどちらも
// 全く同じ式になる).
// 前提: 照準は的にピッタリ合っているものとする（wikiの注記通り）ので、実際の
// マウスカーソル位置には依存せず、プレイヤー⇔ダミー間の直線距離だけを使う。
// ブレ機構(初弾補正)を持たないブキにはこの式が定義されていないので null を返す。
// --------------------------------------------------------------------------
export function computeHitProbability(weapon, distancePx, r1Px, r2Px){
  if (weapon.firstShotBiasDeg === undefined) return null;
  const sumR = r1Px + r2Px;
  if (sumR <= 0) return null;
  // d < r1+r2 は「的の当たり判定に自分がめり込んでいる」距離で式が未定義に
  // なるため、この距離では理論上必中として扱う。
  if (distancePx <= sumR) return 100;

  const sRad = weapon.spreadDeg * Math.PI / 180; // 拡散(ラジアン)
  const b = Math.min(bias.currentDeg / weapon.spreadDeg, 0.999); // 現在のブレ補正値の比率
  if (b <= 0) return 100; // ブレ0（理論上）なら必中

  const ratio = distancePx / sumR;
  const innerSqrt = Math.sqrt(ratio * ratio - 1);
  const theta = Math.atan(1 / innerSqrt); // ラジアン
  const base = theta / sRad;
  const exponent = Math.log(0.5) / Math.log(b); // = log_b(0.5)（sampleShotSpreadDegと同じ指数式）
  const p = Math.pow(Math.min(Math.max(base, 0), 1), exponent);
  return Math.min(100, Math.max(0, p * 100));
}

// 「平均値をfloor(avg*n)の累積差分で判定する」共通ロジック。足元塗り
// (bool版・shouldFootPaint)と中間塗り(個数版・midPaintDropsForShot)は
// どちらも本質的に同じ「累積個数の差分」という考え方の派生形なので、
// このコアヘルパーに一本化してある。
function cumulativeCount(avg, n){ return Math.floor(avg * n); }

// 足元塗りの発生判定: footPaintAvgInterval発に1回のペースで発生させる。
// 整数間隔（スプラシューターの4発毎）はcumulativeCount(avg,n)が単純な
// 等間隔トリガーになるのでそのまま「Nの倍数」と同じ結果になり、わかば
// シューターのような非整数の平均間隔（3.5＝3発と4発の交互）も同じ式で
// カバーできる。
function shouldFootPaint(weapon, shotIndex){
  if (weapon.footPaintAvgInterval === undefined) return false;
  const avg = weapon.footPaintAvgInterval;
  return cumulativeCount(avg, shotIndex) > cumulativeCount(avg, shotIndex - 1);
}

// 中間塗りの滴数: fixed pattern tied to shot index within the current burst,
// not to travel distance. For a fractional 最大飛沫数 (average per shot),
// the wiki gives this exact rule via the スプラシューター(1.5) example:
// cumulative総数 = floor(avg * shotIndex); a given shot's drop count is the
// difference from the previous shot's cumulative total. For avg=1.5 this
// yields the documented 1,2,1,2,... alternating pattern.
function midPaintDropsForShot(weapon, shotIndex){
  if (weapon.midPaintAvgPerShot === undefined) return 0;
  const avg = weapon.midPaintAvgPerShot;
  return cumulativeCount(avg, shotIndex) - cumulativeCount(avg, shotIndex - 1);
}

// 中間塗り: extra blobs placed along the flight path between the player and
// the impact point, spaced every midPaintIntervalLines, up to the fixed
// per-shot drop count from midPaintDropsForShot(). A short travel distance
// (close-range shot) can still fit fewer drops than the pattern allows —
// that's the "射程が短いブキは飛沫がスカスカになる" effect from the wiki.
function paintMidDots(weapon, startX, startY, endX, endY, shotIndex){
  if (weapon.midPaintIntervalLines === undefined) return;
  const dx = endX - startX, dy = endY - startY;
  const lenPx = Math.hypot(dx, dy);
  if (lenPx < 1) return;
  const ux = dx / lenPx, uy = dy / lenPx;
  const intervalPx = lines(weapon.midPaintIntervalLines);
  const maxByPattern = midPaintDropsForShot(weapon, shotIndex || 1);
  const maxByDistance = Math.floor(lenPx / intervalPx);
  const count = Math.min(maxByPattern, maxByDistance);
  for (let i = 1; i <= count; i++){
    const d = i * intervalPx;
    if (d >= lenPx) break;
    paintSplatClipped(startX + ux * d, startY + uy * d, lines(weapon.midPaintRadiusLines));
  }
}

export function fireShot(mouse){
  const weapon = getCurrentWeapon();
  if (player.ink < weapon.inkPerShot) return;
  player.ink -= weapon.inkPerShot;
  const spreadDeg = sampleShotSpreadDeg(weapon);
  const angle = player.aimAngle + spreadDeg * Math.PI / 180;
  if (weapon.firstShotBiasDeg !== undefined){
    bias.currentDeg = Math.min(bias.currentDeg + weapon.biasWorsenPerShotDeg, weapon.maxBiasDeg);
    bias.lastShotAt = performance.now();
  }

  const shotIndex = incrementBurstShotCount();
  // 足元塗り: on a fixed cumulative pattern tied to shots fired in this
  // burst (see shouldFootPaint), independent of where the actual pellet lands.
  if (shouldFootPaint(weapon, shotIndex)){
    paintSplatClipped(player.x, player.y, lines(weapon.footPaintRadiusLines));
  }

  const initialSpeedPxPerSec = duPerFrameToPxPerSec(weapon.speedDU);
  // Ink lands at the cursor's distance, capped at the weapon's max range —
  // so aiming closer brings the splat closer, while aiming past max range
  // still only reaches max range.
  const cursorDist = Math.hypot(mouse.x - player.x, mouse.y - player.y);
  const targetRange = Math.min(cursorDist, lines(weapon.maxRangeLines));
  projectiles.push({
    x: player.x, y: player.y,
    startX: player.x, startY: player.y, // kept so 中間塗り can be spaced along the full flight path
    dirX: Math.cos(angle), dirY: Math.sin(angle), // fixed flight direction; speed varies over time below
    initialSpeed: initialSpeedPxPerSec,
    xzSpeed: initialSpeedPxPerSec,  // 現在のXZ速度（直進→減速→自由落下で更新）
    ySpeed: 0,                      // 隠しY速度。描画には使わず、減速→自由落下の遷移タイミング判定にのみ使う
    phase: 'direct',                // 'direct' | 'decel' | 'freefall'
    frameCount: 0,                  // 経過フレーム数。物理更新はこの整数フレーム単位で刻む
    traveled: 0,
    age: 0,
    range: targetRange,
    weapon,
    burstShotIndex: shotIndex, // which shot in the current burst fired this pellet — drives 中間塗り count
    alive: true,
  });
}

// 3段階弾道モデルを1フレーム分だけ進める。フレーム単位の離散漸化式（wiki記載
// の式そのまま）で、updateProjectiles側のループから経過フレーム数ぶん呼ばれる。
function stepProjectilePhysics(p, weapon){
  const n = p.frameCount;

  if (weapon.decelAirResistXZ === undefined){
    // 減速・自由落下パラメータ未設定のブキ用フォールバック（簡易指数減衰）
    if (n > weapon.directFrames) p.xzSpeed *= DECAY_RATE_PER_FRAME_FALLBACK;
    return;
  }

  if (n <= weapon.directFrames){
    // 直進状態：(A)一定、Yは0
    p.xzSpeed = p.initialSpeed;
    p.ySpeed = 0;
    p.phase = 'direct';
    return;
  }

  if (p.phase === 'direct') p.phase = 'decel';

  if (p.phase === 'decel'){
    const D = weapon.decelAirResistXZ;
    const E = mPerFrameToPxPerSec(weapon.decelGravityY);
    const floorXZ = mPerFrameToPxPerSec(weapon.decelFloorXZ_mF);
    const floorY = mPerFrameToPxPerSec(weapon.decelFloorY_mF);
    let nextXZ = p.xzSpeed * (1 - D);
    let nextY = p.ySpeed * (1 - D) - E;
    if (nextXZ < floorXZ) nextXZ = floorXZ;
    if (nextY < floorY) nextY = floorY;
    p.xzSpeed = nextXZ;
    p.ySpeed = nextY;
    // XZ・Yの両方が下限に達したら自由落下状態へ移行
    if (nextXZ <= floorXZ && nextY <= floorY) p.phase = 'freefall';
    return;
  }

  // 自由落下状態：空気抵抗(G)・重力(H)は減速状態と別値、下限クランプはない
  const G = weapon.freefallAirResistXZ;
  const H2 = mPerFrameToPxPerSec(weapon.freefallGravityY);
  p.xzSpeed = p.xzSpeed * (1 - G);
  p.ySpeed = p.ySpeed * (1 - G) - H2;
}

export function updateProjectiles(dt){
  for (const p of projectiles){
    if (!p.alive) continue;
    const weapon = p.weapon;
    p.age += dt;
    const framesAlive = p.age * FPS;

    // 経過フレーム数ぶんだけ物理を1F刻みで進める（描画は可変フレームレートでも、
    // 弾道の漸化式自体は60FPS基準の離散ステップで計算する）。
    while (p.frameCount < framesAlive){
      p.frameCount++;
      stepProjectilePhysics(p, weapon);
    }

    const speed = p.xzSpeed;
    const stepX = p.dirX * speed * dt, stepY = p.dirY * speed * dt;
    const nx = p.x + stepX, ny = p.y + stepY;
    p.traveled += Math.hypot(stepX, stepY);

    // 弾の大きさ（敵）・弾の大きさ（地形）は直径で記載されている値（wiki注記:
    // 「数値が小さいことを踏まえて単位は直径を採用」）なので、半径として使う
    // 際は2で割る。
    const projRadiusEnemyPx = weapon.projectileSizeEnemyLines !== undefined ? lines(weapon.projectileSizeEnemyLines) / 2 : 0;
    const projRadiusTerrainPx = weapon.projectileSizeTerrainLines !== undefined ? lines(weapon.projectileSizeTerrainLines) / 2 : 3;
    const hitDummy = dummy.hp > 0 && Math.hypot(nx - dummy.x, ny - dummy.y) < dummy.radius + projRadiusEnemyPx;
    const hitWall = isInsideObstacle(nx, ny, projRadiusTerrainPx);
    const outOfRange = p.traveled >= p.range;
    const outOfBounds = nx < 0 || nx > W || ny < 0 || ny > H;
    // 失速判定: わかばシューターにも正式な減速・自由落下パラメータ（シューター
    // 種共通値）を設定したため、現状の2ブキではこの判定はほぼ発火しない。
    // ただし今後、減速・自由落下パラメータが未検証のブキを追加した場合は
    // stepProjectilePhysics側が簡易指数減衰(毎F×0.75)にフォールバックし、
    // 指数減衰は理論上いつまでも0になりきらないため、targetRangeが収束値
    // ギリギリのときoutOfRange判定が成立しないまま弾が生き続けてしまう
    // （＝画面に薄い"白玉"が消えずに居座るバグ）ことがある。速度が実用上
    // ゼロとみなせるところまで落ちたら、その場に着弾したものとして強制的に
    // 解決する保険として残しておく。
    const STALL_SPEED_PX_PER_SEC = 4;
    const stalled = p.xzSpeed < STALL_SPEED_PX_PER_SEC;
    const splatRadius = getSplatRadius(weapon, toLines(p.traveled));
    const dirAngle = Math.atan2(p.dirY, p.dirX);
    const stretch = getStretchRatio(weapon, toLines(p.traveled));

    if (hitDummy){
      const damage = getProjectileDamage(weapon, p.frameCount);
      if (dummy.firstHitAt === null) dummy.firstHitAt = performance.now();
      dummy.hp = Math.max(0, dummy.hp - damage);
      if (dummy.hp === 0){
        dummy.lastKillTimeText = ((performance.now() - dummy.firstHitAt) / 1000).toFixed(3) + '秒';
        setTimeout(respawnDummy, 500);
      }
      paintSplatClipped(nx, ny, splatRadius, dirAngle, stretch);
      paintMidDots(weapon, p.startX, p.startY, nx, ny, p.burstShotIndex);
      creditCappedPaintPoints(weapon.singleShotPaintPoints);
      p.alive = false;
    } else if (hitWall || outOfRange || outOfBounds || stalled) {
      const landX = Math.min(Math.max(nx, 0), W);
      const landY = Math.min(Math.max(ny, 0), H);
      paintSplatClipped(landX, landY, splatRadius, dirAngle, stretch);
      paintMidDots(weapon, p.startX, p.startY, landX, landY, p.burstShotIndex);
      creditCappedPaintPoints(weapon.singleShotPaintPoints);
      p.alive = false;
    } else {
      p.x = nx; p.y = ny;
    }
  }
  // Drop dead projectiles so the array doesn't grow forever.
  for (let i = projectiles.length - 1; i >= 0; i--){
    if (!projectiles[i].alive) projectiles.splice(i, 1);
  }
}
