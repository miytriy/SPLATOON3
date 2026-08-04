import { FPS, PIXELS_PER_LINE, lines, toLines } from './config.js';
import { ctx, W, H, paintLayer, OBSTACLES, TEAM_COLOR, TEAM_COLOR_RGB } from './stage.js';
import { WEAPONS } from './weapons.js';
import { player, bias, currentWeaponIndex, getCurrentWeapon, switchWeapon } from './player.js';
import { dummy } from './dummy.js';
import { projectiles, computeHitProbability } from './projectiles.js';
import { chargerFlashes, getChargeFraction, chargeLerp, computeLaserStopDistance } from './charger.js';
import { tickPaintPoints } from './score.js';
import { resetPaint } from './game-control.js';

/* ==========================================================================
   ui.js — HUD表示・ブキ切替ボタン・描画(render)
   ========================================================================== */

const coverageValueEl = document.getElementById('coverage-value');
const inkGaugeEl = document.getElementById('ink-gauge-inner');
const inkPredictBandEl = document.getElementById('ink-predict-band');
const swimBadgeEl = document.getElementById('swim-badge');
const weaponNameEl = document.getElementById('weapon-name');
const weaponStatsEl = document.getElementById('weapon-stats');
const dummyStatusEl = document.getElementById('dummy-status');
const hitProbabilityEl = document.getElementById('hit-probability');
const chargeGaugeInnerEl = document.getElementById('charge-gauge-inner');
const chargeWrapEl = document.getElementById('charge-wrap');
const weaponSwitchEl = document.getElementById('weapon-switch');

function updateWeaponDisplay(){
  const w = getCurrentWeapon();
  weaponNameEl.textContent = w.name;
  if (w.type === 'charger'){
    weaponStatsEl.textContent =
      `射程 ライン${w.rangeLinesNoCharge}〜${w.rangeLinesFull} ／ ` +
      `チャージ${w.chargeFrames}F(${(w.chargeFrames / FPS).toFixed(3)}s)／NC${w.minChargeFramesToFire}F ／ ` +
      `ダメージ ${w.damageNoCharge}〜${w.damageHalfChargeMax}／フル${w.damageFull} ／ ` +
      `インク消費${w.inkPerShotNoCharge}〜${w.inkPerShotFull}% ／ ` +
      `発射後隙 チャ${w.chargeRestartFrames}F・イカ${w.squidLockoutFrames}F・インク${w.inkRecoveryLockoutFrames}F`;
  } else {
    const capNote = w.mainInkCapacityMultiplier !== undefined && w.mainInkCapacityMultiplier !== 1
      ? ` ／ タンク容量×${w.mainInkCapacityMultiplier}`
      : '';
    weaponStatsEl.textContent =
      `有効射程 ライン${w.rangeLines} ／ 確定数維持射程 ライン${w.confirmedKillRangeLines} ／ ` +
      `連射${(w.fireIntervalSec * FPS).toFixed(0)}F(${w.fireIntervalSec.toFixed(3)}s) ／ ` +
      `ダメージ ${w.damageFalloff.startDamage}→${w.damageFalloff.endDamage} ／ ` +
      `インク消費${(w.inkPerShot).toFixed(2)}%${capNote}`;
  }
}

function updateWeaponSwitchButtons(){
  weaponSwitchEl.querySelectorAll('button').forEach((btn, i) => {
    btn.classList.toggle('active', i === currentWeaponIndex);
  });
}

function updateChargeWrapVisibility(){
  chargeWrapEl.style.display = getCurrentWeapon().type === 'charger' ? 'block' : 'none';
}

// 武器切り替えボタンをWEAPONSから動的に生成し、現在選択中のブキに
// activeクラスを付与する。武器数が増えてもここは触らずに済む。
// player.jsのswitchWeapon()はブキの状態遷移だけを担当するので、UI側の
// 表示更新(HUDテキスト・ボタンのactive状態・charge-wrapの表示切替)は
// この click ハンドラでまとめて行う。
WEAPONS.forEach((w, i) => {
  const btn = document.createElement('button');
  btn.textContent = w.name;
  btn.addEventListener('click', () => {
    if (!switchWeapon(i)) return;
    updateWeaponDisplay();
    updateWeaponSwitchButtons();
    updateChargeWrapVisibility();
  });
  weaponSwitchEl.appendChild(btn);
});

document.getElementById('reset-btn').addEventListener('click', resetPaint);

setInterval(() => {
  coverageValueEl.textContent = Math.round(tickPaintPoints()) + 'pt';
}, 300);

updateWeaponDisplay();
updateWeaponSwitchButtons();
updateChargeWrapVisibility();

// --------------------------------------------------------------------------
// Render: floor -> accumulated ink -> walls -> aim line -> player.
// Nothing here mutates paint state; this function only reads it.
// --------------------------------------------------------------------------
export function render(){
  ctx.fillStyle = '#2a2d38';
  ctx.fillRect(0, 0, W, H);

  ctx.drawImage(paintLayer, 0, 0);

  ctx.fillStyle = '#0b0c10';
  ctx.strokeStyle = '#33384a';
  for (const o of OBSTACLES){
    ctx.fillRect(o.x, o.y, o.w, o.h);
    ctx.strokeRect(o.x + 0.5, o.y + 0.5, o.w - 1, o.h - 1);
  }

  // ライン markers: full-field practice-range grid, spaced 1 line (5m) apart
  // in both directions. 縦ライン (vertical, running top-to-bottom) are drawn
  // in green; 横ライン (horizontal, running left-to-right) are drawn in gray.
  ctx.lineWidth = 1;
  ctx.font = '10px sans-serif';

  ctx.strokeStyle = 'rgba(70,220,140,0.35)';
  ctx.fillStyle = 'rgba(70,220,140,0.55)';
  for (let n = 1; n * PIXELS_PER_LINE < W; n++){
    const lx = n * PIXELS_PER_LINE;
    ctx.beginPath();
    ctx.moveTo(lx, 0);
    ctx.lineTo(lx, H);
    ctx.stroke();
    ctx.fillText(String(n), lx + 3, 14);
  }

  ctx.strokeStyle = 'rgba(125,131,148,0.45)';
  ctx.fillStyle = 'rgba(125,131,148,0.65)';
  for (let n = 1; n * PIXELS_PER_LINE < H; n++){
    const ly = n * PIXELS_PER_LINE;
    ctx.beginPath();
    ctx.moveTo(0, ly);
    ctx.lineTo(W, ly);
    ctx.stroke();
    ctx.fillText(String(n), 3, ly - 3);
  }

  // Practice dummy: a static target so weapon differences (hits-to-kill,
  // kill time) are felt directly instead of only read off the HUD.
  ctx.fillStyle = '#4b5063';
  ctx.beginPath();
  ctx.arc(dummy.x, dummy.y, dummy.radius, 0, Math.PI * 2);
  ctx.fill();
  const hpFrac = dummy.hp / dummy.maxHp;
  ctx.fillStyle = '#0b0c10';
  ctx.fillRect(dummy.x - 20, dummy.y - dummy.radius - 12, 40, 5);
  ctx.fillStyle = hpFrac > 0.3 ? '#33e6c0' : '#ff5a1f';
  ctx.fillRect(dummy.x - 20, dummy.y - dummy.radius - 12, 40 * hpFrac, 5);

  const weaponNow = getCurrentWeapon();
  const biasText = weaponNow.firstShotBiasDeg !== undefined
    ? `　照準ブレ: ${bias.currentDeg.toFixed(3)}°(最大${weaponNow.maxBiasDeg}°)`
    : '';
  dummyStatusEl.textContent = `ダミーHP ${dummy.hp}/${dummy.maxHp}　直近キルタイム: ${dummy.lastKillTimeText}${biasText}`;

  // 命中率(理論値): 照準が的にピッタリ合っている前提で、現在の距離とブレ
  // 補正値から算出。ブレ機構を持たないブキでは null になり非表示にする。
  const distToDummyPx = Math.hypot(dummy.x - player.x, dummy.y - player.y);
  const r1Px = dummy.radius;
  const r2Px = weaponNow.projectileSizeEnemyLines !== undefined ? lines(weaponNow.projectileSizeEnemyLines) / 2 : 0;
  const hitProb = computeHitProbability(weaponNow, distToDummyPx, r1Px, r2Px);
  if (hitProb === null){
    hitProbabilityEl.textContent = '';
  } else {
    hitProbabilityEl.textContent = `命中率(理論値・照準完全一致時): ${hitProb.toFixed(1)}%　距離: ライン${toLines(distToDummyPx).toFixed(2)}`;
  }

  // Projectiles in flight, drawn as small bright dots that shrink as they
  // decelerate — a visual stand-in for "falling" in this top-down 2D view.
  ctx.fillStyle = '#ffd8c2';
  for (const p of projectiles){
    const speedRatio = Math.min(1, Math.max(0, p.xzSpeed / p.initialSpeed));
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.5 + 2 * speedRatio, 0, Math.PI * 2);
    ctx.fill();
  }

  // チャージャーの光跡フラッシュ: 発射直後だけ明るく、150msでフェードアウト。
  const FLASH_LIFETIME_MS = 150;
  for (let i = chargerFlashes.length - 1; i >= 0; i--){
    const f = chargerFlashes[i];
    const age = performance.now() - f.bornAt;
    if (age >= FLASH_LIFETIME_MS){ chargerFlashes.splice(i, 1); continue; }
    const alpha = 1 - age / FLASH_LIFETIME_MS;
    ctx.strokeStyle = `rgba(255, 216, 194, ${alpha})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(f.x1, f.y1);
    ctx.lineTo(f.x2, f.y2);
    ctx.stroke();
  }

  // チャージャー種の定義: チャージ中は予測線（見える射線・チャージレーザー）
  // を表示する。実機では味方・敵の両方から見える情報として扱われる
  // （このプロトタイプは自チーム視点のみのため常時描画で代用）。線の色は
  // 自陣のインク色(TEAM_COLOR)を使う——陣営ごとにレーザー色が変わる、
  // という実機の見た目(オレンジ/パープル等)を再現するため。長さは現在の
  // チャージ量に応じた射程(ライン)まで伸びるが、実際のインクショットとは
  // 異なりこのレーザー表示自体は地形にもヒト(ダミー)にも貫通しないため、
  // 最初に何かへぶつかった地点でそこから先は描画しない
  // (charger.jsのcomputeLaserStopDistance()参照)。
  const chargerAiming = weaponNow.type === 'charger' && player.form === 'human' && player.charging;
  if (chargerAiming){
    const laserFrac = getChargeFraction();
    const laserMaxRangePx = lines(chargeLerp(weaponNow.rangeLinesNoCharge, weaponNow.rangeLinesFull, laserFrac));
    const laserDirX = Math.cos(player.aimAngle), laserDirY = Math.sin(player.aimAngle);
    const laserProjRadiusTerrainPx = weaponNow.projectileSizeTerrainLines !== undefined ? lines(weaponNow.projectileSizeTerrainLines) / 2 : 3;
    const laserProjRadiusEnemyPx = weaponNow.projectileSizeEnemyLines !== undefined ? lines(weaponNow.projectileSizeEnemyLines) / 2 : 0;
    const laserVisibleDist = computeLaserStopDistance(
      laserMaxRangePx, laserDirX, laserDirY, laserProjRadiusTerrainPx, laserProjRadiusEnemyPx
    );
    const laserEndX = player.x + laserDirX * laserVisibleDist;
    const laserEndY = player.y + laserDirY * laserVisibleDist;
    ctx.save();
    // 1) 外側の柔らかいハロー(太め・低不透明度・強いぼかし)
    ctx.strokeStyle = TEAM_COLOR;
    ctx.shadowColor = TEAM_COLOR;
    ctx.shadowBlur = 18;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(player.x, player.y);
    ctx.lineTo(laserEndX, laserEndY);
    ctx.stroke();
    // 2) 中間の彩度の高い本体色レイヤー
    ctx.shadowBlur = 10;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(player.x, player.y);
    ctx.lineTo(laserEndX, laserEndY);
    ctx.stroke();
    // 3) 中心の白く輝くコア(レーザーらしい高輝度の芯)
    ctx.strokeStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 6;
    ctx.globalAlpha = 1;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(player.x, player.y);
    ctx.lineTo(laserEndX, laserEndY);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();
  } else {
    // Aim guide, subtle.
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(player.x, player.y);
    ctx.lineTo(player.x + Math.cos(player.aimAngle) * 40,
               player.y + Math.sin(player.aimAngle) * 40);
    ctx.stroke();
  }

  // チャージキープ中の潜伏を発光させる（画像参照仕様）:
  // 実機の見た目は「イカ本体そのものが強く発光する」のが主役で、地面側は
  // その光がインク面にぼんやり映り込む程度——なので「地面の帯全体をブルー
  // ムさせる」演出はせず、代わりに(1)インク面への光の映り込み(プレイヤー
  // 位置中心のやわらかい反射グロー。イカが完全に潜っていて画面上イカ本体が
  // 見えない場合でも、光そのものはインク上に映る、という指定のため
  // isSwimming の有無に関わらず常に描く)と、(2)イカ本体の発光(後述の
  // プレイヤー描画ブロックで、白〜ピンクの明るいコア＋外周のチーム色ハロー
  // として描画)の2段構成にする。持続時間(chargeKeepFramesLeft)が尽きる
  // につれてフェードし、0で完全に消える。pulseはsin波の脈動係数。
  //
  // このフラグは「潜伏中に発光させるか」の判定として render() 内で複数回
  // 参照されるため、以前は chargeKeepGlowing / chargeKeepingDisplay という
  // 名前違いの全く同じ式を2箇所で計算していた。ここで1つにまとめてある。
  const chargeKeepGlowing = weaponNow.type === 'charger' && player.form === 'squid' && player.chargeKeepActive;
  const glowFade = (chargeKeepGlowing && weaponNow.ckStats)
    ? Math.max(0, player.chargeKeepFramesLeft / weaponNow.ckStats.keepDurationFrames)
    : 0;
  if (chargeKeepGlowing && glowFade > 0){
    const [tr, tg, tb] = TEAM_COLOR_RGB;
    const pulse = 0.8 + 0.2 * Math.sin(performance.now() / 130);
    const intensity = glowFade * pulse;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // インク面への光の映り込み: プレイヤー位置を中心にした、地面に落ちる
    // 柔らかい反射グロー。中心はほんのりピンクがかった白、外側へチーム色
    // にじんで消える——「イカ自体が光り、その光が塗られたインクの上に
    // 映っている」印象を狙う。潜伏中(isSwimming)かどうかに関わらず描画する。
    const groundRadius = player.radius * 5.5;
    const groundGrad = ctx.createRadialGradient(player.x, player.y, 0, player.x, player.y, groundRadius);
    groundGrad.addColorStop(0, `rgba(255,205,240,${0.5 * intensity})`);
    groundGrad.addColorStop(0.4, `rgba(${tr},${tg},${tb},${0.32 * intensity})`);
    groundGrad.addColorStop(1, `rgba(${tr},${tg},${tb},0)`);
    ctx.fillStyle = groundGrad;
    ctx.beginPath();
    ctx.arc(player.x, player.y, groundRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  // Player: a squid-like teardrop that stretches slightly while swimming,
  // just enough to make the state change legible at a glance.
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.rotate(player.aimAngle);
  const stretch = player.form === 'squid' ? 1.35 : 1;

  // イカ本体の発光(画像参照): ハロー・コアはイカ本体のstretch変形の影響を
  // 受けない真円として描くため、本体を塗るscale(stretch, 1/√stretch)の
  // 外側(translate+rotateのみが効いている座標系)で描画する。
  if (chargeKeepGlowing && glowFade > 0){
    const [tr, tg, tb] = TEAM_COLOR_RGB;
    const pulseBody = 0.8 + 0.2 * Math.sin(performance.now() / 130);
    const bodyIntensity = glowFade * pulseBody;

    // 外側のチーム色ハロー(発光ブルーム) — 真円
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = `rgb(${tr},${tg},${tb})`;
    ctx.shadowBlur = 26 * bodyIntensity;
    ctx.fillStyle = `rgba(${tr},${tg},${tb},${0.55 * bodyIntensity})`;
    ctx.beginPath();
    ctx.arc(0, 0, player.radius * 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.scale(stretch, 1 / Math.sqrt(stretch));
  ctx.fillStyle = TEAM_COLOR;
  ctx.beginPath();
  ctx.arc(0, 0, player.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (chargeKeepGlowing && glowFade > 0){
    // 中心の明るいピンク〜白のコア発光(画像参照) — 真円
    const pulseBody = 0.8 + 0.2 * Math.sin(performance.now() / 130);
    const coreIntensity = glowFade * pulseBody;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const coreGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, player.radius * 0.9);
    coreGrad.addColorStop(0, `rgba(255,255,255,${0.95 * coreIntensity})`);
    coreGrad.addColorStop(0.45, `rgba(255,150,225,${0.8 * coreIntensity})`);
    coreGrad.addColorStop(1, `rgba(255,150,225,0)`);
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(0, 0, player.radius * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else {
    ctx.save();
    ctx.scale(stretch, 1 / Math.sqrt(stretch));
    ctx.fillStyle = '#fff4';
    ctx.beginPath();
    ctx.arc(player.radius * 0.4, 0, player.radius * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();


  inkGaugeEl.style.width = (player.ink / player.maxInk * 100) + '%';

  // チャージ中の消費インク予測（白い帯）:
  // 現在のチャージ量(chargeFraction)から算出した「今離したら消費される
  // であろうインク量」を、インクゲージの現在値の右端(高インク側)から
  // 差し引いた区間に白帯として重ねて表示する。チャージ時間が伸びるほど
  // 予測消費量(predictedCost)も増えるので帯が左へ広がっていき、実際に
  // 発射するとインクが本当に減って帯は消える(player.charging=falseになる
  // ため)——見た目上は白帯が消えてオレンジのゲージがその位置まで縮む形
  // になり、「白い帯が右から順番に消えていく」という見た目に近づく。
  // ヒト状態でチャージ中のときだけ表示し、イカ状態になった瞬間
  // （チャージ不可）は非表示にする。
  if (weaponNow.type === 'charger' && player.form === 'human' && player.charging){
    const frac = getChargeFraction();
    const predictedCost = chargeLerp(weaponNow.inkPerShotNoCharge, weaponNow.inkPerShotFull, frac);
    const beforeFrac = Math.min(1, player.ink / player.maxInk);
    const afterFrac = Math.max(0, (player.ink - predictedCost) / player.maxInk);
    inkPredictBandEl.style.left = (afterFrac * 100) + '%';
    inkPredictBandEl.style.width = Math.max(0, (beforeFrac - afterFrac) * 100) + '%';
    inkPredictBandEl.style.opacity = '1';
  } else {
    inkPredictBandEl.style.opacity = '0';
    inkPredictBandEl.style.width = '0%';
  }

  if (weaponNow.type === 'charger'){
    chargeGaugeInnerEl.style.width = (getChargeFraction() * 100) + '%';
  }

  // フォーム表示: ヒト状態は常に「自然回復のみ」。イカ状態は自陣インク上か
  // どうかで急速回復が効いているかが変わるので、それも合わせて表示する。
  // ただしチャージキープ中(イカ状態でチャージ保持中)は自陣インク上でも
  // 回復自体が無効化されるので、その旨を優先して表示する。
  const rapidRegenActive = player.form === 'squid' && player.isSwimming && !chargeKeepGlowing;
  if (chargeKeepGlowing){
    swimBadgeEl.textContent = '◆ イカ状態(チャージキープ中)：インク回復は無効';
  } else if (player.form === 'squid'){
    swimBadgeEl.textContent = rapidRegenActive
      ? '◆ イカ状態(自陣インク上)：移動速度UP／急速回復中'
      : '◆ イカ状態(インク外)：移動速度UP／回復は自然回復のみ';
  } else if (weaponNow.type === 'charger' && player.charging){
    swimBadgeEl.textContent = player.pendingChargeFire
      ? '◆ ヒト状態：チャージ中(自然回復は停止／早離し・8F到達で自動発射)'
      : '◆ ヒト状態：チャージ中(自然回復は停止)';
  } else {
    swimBadgeEl.textContent = '◆ ヒト状態：自然回復のみ';
  }
  swimBadgeEl.classList.toggle('active', rapidRegenActive);
}
