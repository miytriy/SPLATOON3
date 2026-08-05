import { WEIGHT_CLASS_STATS, duPerFrameToPxPerSec, lineSecondsToDuPerFrame } from './config.js';
import { WEAPONS } from './weapons.js';
import { W, H } from './stage.js';

/* ==========================================================================
   player.js — プレイヤー状態・ブキ切替
   --------------------------------------------------------------------------
   Player state. Speed and ink-regen rate both depend on whether the player
   is currently standing on their own ink — this is the mechanic that makes
   painting the floor matter beyond a scoreboard: paint is also a resource
   and a mobility tool ("swim in your own ink to move faster / refill").
   ========================================================================== */

export const player = {
  x: W / 2, y: H / 2,
  radius: 12,
  // 非射撃時ヒト速・イカ速（自陣インク上／インクなし）は重量級カテゴリ由来
  // （ブキ非依存）、射撃時ヒト速は装備ブキ固有のデータ。全て applyWeaponSpeeds()
  // が現在のブキから算出してここに書き込む（起動時はプレースホルダとして0）。
  walkSpeed: 0,
  shootSpeed: 0,       // slower: you can't strafe at full speed while firing
  swimOnInkSpeed: 0,   // イカ状態・自陣インク上
  swimOffInkSpeed: 0,  // イカ状態・インクが無い地面上
  aimAngle: 0,
  ink: 100,         // 0-100 gauge
  maxInk: 100,
  regenRate: 10,          // ink/sec — ヒト状態は常にこちら（自然回復のみ）
  swimRegenRate: 32,      // ink/sec — イカ状態かつ自陣インク上のときだけこちら（急速回復）
  isSwimming: false,      // 自陣インクの上に乗っているか（フォームとは独立の判定）
  form: 'human',          // 'human' | 'squid' — デフォルトはヒト状態
  // --- チャージャー種(リッター4K)用のチャージ状態 ---
  chargeFramesElapsed: 0,  // 現在溜まっているチャージのフレーム数(0〜weapon.chargeFrames)
  charging: false,         // 左クリックを押し続けてチャージ中か
  chargeCooldownFramesLeft: 0, // 発射後、次のチャージを開始できるまでの残りフレーム数
  squidLockoutFramesLeft: 0,   // 発射後、イカ状態になれるまでの残りフレーム数(リッター4Kのsquidロック用)
  // 早離しの自動発射待ち: minChargeFramesToFire(8F)未満で左クリックを
  // 離した場合にtrueになる。trueの間はマウスが離されていてもヒト状態の
  // ままチャージを継続させ、chargeFramesElapsedが8Fに到達した瞬間
  // charger.js側で自動的にfireChargerShot()を呼んでノーチャージ弾を
  // 発射する（＝実機の「8F未満で離しても不発にはならず、8F分は必ず
  // チャージしてから発射される」という仕様の再現）。
  pendingChargeFire: false,
  // --- チャージキープ(CK)関連 ---
  chargeKeepActive: false,      // フルチャージ後に潜伏して発生した「本物の」チャージキープ中か
  chargeKeepFramesLeft: 0,      // チャージキープの残り持続フレーム数(潜伏中のみ減少。0で灯が消えチャージも失う)
  ckResurfaceDelayFramesLeft: 0, // チャージキープ解除(浮上)後、発射可能になるまでの残りフレーム数(前隙29F+チャージ1F)
};

// 直近の発射時刻（performance.now()）。シューター種の連射間隔判定・チャー
// ジャー種のインク回復ロックアウト判定の両方から共通で参照される
// （simulation.js / charger.js）。
export let lastShotAt = 0;
export function setLastShotAt(t){ lastShotAt = t; }

// 現在選択中のブキのインデックス。
export let currentWeaponIndex = 0;
export function getCurrentWeapon(){ return WEAPONS[currentWeaponIndex]; }

// 装備中のブキのweightClass（非射撃時ヒト速・イカ速×2種）とshootMoveSpeedDU
// （射撃時ヒト速、ブキ固有）から player の各移動速度を算出する。
// ブキ切り替え時にも呼び直せるよう関数化してある。
export function applyWeaponSpeeds(){
  const weapon = getCurrentWeapon();
  const stats = WEIGHT_CLASS_STATS[weapon.weightClass];
  // 非射撃時ヒト速・イカ速(自陣インク上)は、ブキ固有の実測値が判明している
  // 場合（weapon.walkSpeedDU / weapon.swimOnInkSpeedDU）はそちらを優先する。
  // 未判明のブキは引き続き重量級カテゴリの代表値(WEIGHT_CLASS_STATS)に
  // フォールバックする。イカ速(インク外)はどの重量級カテゴリでも共通の
  // 実測値なので、常にカテゴリ代表値を使う。
  player.walkSpeed = weapon.walkSpeedDU !== undefined
    ? duPerFrameToPxPerSec(weapon.walkSpeedDU)
    : duPerFrameToPxPerSec(lineSecondsToDuPerFrame(stats.walkSeconds50DU));
  player.swimOnInkSpeed = weapon.swimOnInkSpeedDU !== undefined
    ? duPerFrameToPxPerSec(weapon.swimOnInkSpeedDU)
    : duPerFrameToPxPerSec(stats.swimOnInkDU);
  player.swimOffInkSpeed = duPerFrameToPxPerSec(stats.swimOffInkDU);
  player.shootSpeed = weapon.shootMoveSpeedDU !== undefined ? duPerFrameToPxPerSec(weapon.shootMoveSpeedDU) : player.walkSpeed;
  // インクタンク容量: ほとんどのブキは基準100（マルチプライヤ未設定=1倍）。
  // わかばシューターのように「他ブキの1.1倍」等の特性を持つブキは
  // mainInkCapacityMultiplier で表現し、maxInk自体を伸縮させる。inkPerShot
  // 側は常に「基準100タンク換算の%」で統一してあるので、ここでmaxInkを
  // 伸ばすことで「同じ%消費でも実際に撃てる発数が増える」効果が両立する。
  const capMult = weapon.mainInkCapacityMultiplier !== undefined ? weapon.mainInkCapacityMultiplier : 1;
  player.maxInk = 100 * capMult;
  player.ink = Math.min(player.ink, player.maxInk);
}
applyWeaponSpeeds();

// --------------------------------------------------------------------------
// 初弾補正・ブレ (shot-bias) state — only meaningful for weapons that define
// firstShotBiasDeg (currently just スプラシューター). currentDeg is the
// tight-cone half-angle for the NEXT shot: it starts at firstShotBiasDeg,
// grows by biasWorsenPerShotDeg each shot fired (capped at maxBiasDeg), and
// decays back down once you've stopped firing for a full fireInterval.
// --------------------------------------------------------------------------
export const bias = { currentDeg: 0, lastShotAt: -Infinity };

export function resetBiasState(){
  const w = getCurrentWeapon();
  bias.currentDeg = w.firstShotBiasDeg !== undefined ? w.firstShotBiasDeg : 0;
  bias.lastShotAt = -Infinity;
}
resetBiasState();

// 連射中の足元塗り・中間塗りのパターンは「トリガーを押し続けている間」の
// 射撃回数を基準に進む固定パターンなので、トリガーを離したら都度リセット
// する（projectiles.jsのfireShot()が加算、input.jsのmouseupハンドラと
// switchWeapon()がリセットを呼ぶ）。
export let burstShotCount = 0;
export function incrementBurstShotCount(){ return ++burstShotCount; }
export function resetBurstShotCount(){ burstShotCount = 0; }

// チャージャー種のランタイム状態（チャージ量・クールダウン・CK関連）を
// まとめてリセットする共通ヘルパー。以前は switchWeapon() / resetPaint()
// (game-control.js) の2箇所にまったく同じ8行がコピペされていたため、
// ここに一本化した。
export function resetChargerRuntimeState(){
  player.charging = false;
  player.chargeFramesElapsed = 0;
  player.chargeCooldownFramesLeft = 0;
  player.squidLockoutFramesLeft = 0;
  player.pendingChargeFire = false;
  player.chargeKeepActive = false;
  player.chargeKeepFramesLeft = 0;
  player.ckResurfaceDelayFramesLeft = 0;
}

// ブキ切り替え: ui.jsのボタンから呼ばれる。移動速度・インクタンク容量の
// 再計算(applyWeaponSpeeds)に加え、ブレ状態・連射バーストのカウント・
// チャージャー状態はブキ固有のものなのでリセットする（他ブキの状態を
// 引き継がない）。UI側の表示更新(HUDテキスト・ボタンのactive状態・
// charge-wrapの表示切替)は呼び出し側(ui.js)の責務とし、ここでは状態の
// 更新のみを行う。
export function switchWeapon(index){
  if (index === currentWeaponIndex) return false;
  currentWeaponIndex = index;
  applyWeaponSpeeds();
  resetBiasState();
  resetBurstShotCount();
  resetChargerRuntimeState();
  return true;
}

// --- サブウェポン / スペシャル用の操作 API ---
// input.js から呼ばれる軽いハンドラ群。サブウェポン/スペシャルの本体処理
// は別モジュール（未実装）または既存のロジック側で CustomEvent を受けて
// 実行する想定。まずはキーイベントから安全に呼べる共通フックを提供する。

// フラグ: E を押して構えている状態を保持（UI 用や後続ロジックで参照可能）
player.subWeaponArmRequested = false;
player.subWeaponArmHeld = false;
player.subWeaponArmStartedAt = 0;

/**
 * 押したときに呼ぶ — 「構え」を開始する（実際の投擲は離したときに行う）。
 */
export function requestSubWeaponArm(){
  player.subWeaponArmRequested = true;
  player.subWeaponArmHeld = true;
  player.subWeaponArmStartedAt = performance.now();
  // 将来的に UI の発光や弾道表示を開始したければここで発火:
  window.dispatchEvent(new CustomEvent('subWeaponArmStart', { detail: { startedAt: player.subWeaponArmStartedAt } }));
}

/**
 * イカ化やキャンセル時に呼ぶ — 構え状態を解除する。
 */
export function cancelSubWeaponArm(){
  player.subWeaponArmRequested = false;
  player.subWeaponArmHeld = false;
  player.subWeaponArmStartedAt = 0;
  window.dispatchEvent(new CustomEvent('subWeaponArmCancel'));
}

/**
 * 離したときに呼ぶ — 実際にサブウェポンを使用する。
 * 引数は不要（input.js からそのまま呼ばれる）だが、将来的に
 * マウス座標等が要る場合はそれを渡すように拡張してください。
 */
export function useSubWeapon(){
  if (!player.subWeaponArmRequested) return;
  // サブ使用時の共通副作用: 構えフラグクリア／サブ使用後の後隙等は
  // ここで発火するか、sub-weapon モジュール側で受けて処理させる。
  player.subWeaponArmRequested = false;
  player.subWeaponArmHeld = false;
  player.subWeaponArmStartedAt = 0;

  // event を投げて実体処理を分離（既存コードに手を入れず安全に連携可能）。
  window.dispatchEvent(new CustomEvent('useSubWeapon', { detail: { at: performance.now() } }));
}

/**
 * スペシャル発動トリガー（Rを押した瞬間に呼ばれる）。
 * ここも実処理は別モジュール／リスナで受ける想定にしておくと安全です。
 */
export function fireSpecialWeapon(){
  // スペシャル発動時の共通副作用（インク消費チェック等）は別モジュールで行ってください。
  window.dispatchEvent(new CustomEvent('fireSpecialWeapon', { detail: { at: performance.now() } }));
}
