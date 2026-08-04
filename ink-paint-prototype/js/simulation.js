import { FPS, duPerFrameToPxPerSec } from './config.js';
import { isInsideObstacle, W, H } from './stage.js';
import { sampleInkAt } from './painting.js';
import { player, bias, getCurrentWeapon, lastShotAt, setLastShotAt } from './player.js';
import { keys, mouse, aimLocked } from './input.js';
import { fireShot } from './projectiles.js';
import { tickCharger, chargeLerp, getChargeFraction } from './charger.js';

/* ==========================================================================
   simulation.js — 毎フレーム更新: 操作の結果をゲーム状態に反映する
   ========================================================================== */

export function updatePlayer(dt){
  // 自陣インクの上に乗っているかどうかは form とは独立に判定する
  // （急速回復の条件判定・見た目の演出に使う「地面の状態」）。
  player.isSwimming = sampleInkAt(player.x, player.y);

  const weaponForMove = getCurrentWeapon();

  // 発射後のイカ化不能ロック(リッター4K: squidLockoutFrames)をカウントダウン。
  // ロック中に右クリックを押してもinput.js側でイカ化自体を弾いているので、
  // ここでは残りフレーム数の減算だけを行う。
  if (player.squidLockoutFramesLeft > 0){
    player.squidLockoutFramesLeft = Math.max(0, player.squidLockoutFramesLeft - dt * FPS);
  }

  // チャージャー種のチャージ蓄積・クールダウン・チャージキープの経過処理は
  // charger.jsのtickCharger()に委譲する（イカ状態では今回は未実装のため
  // チャージ不可、クールダウン中(発射直後)も同様に不可、といった判定は
  // その中で行われる）。
  tickCharger(dt, weaponForMove, mouse.down);

  // 移動速度: イカ状態は自陣インク上かどうかでswimOnInkSpeed/swimOffInkSpeed
  // に分岐。ヒト状態はブキ種によってさらに分岐——シューター種は射撃中か
  // どうか、チャージャー種はチャージ中(かつフルチャージ保持中かどうか)で
  // 変わる。イカ状態では左クリック(発射/チャージ)自体を後段で無効化して
  // いるので、mouse.downはヒト状態のときだけ意味を持つ。
  let speed;
  if (player.form === 'squid'){
    speed = player.isSwimming ? player.swimOnInkSpeed : player.swimOffInkSpeed;
  } else if (weaponForMove.type === 'charger'){
    if (player.charging){
      const frac = getChargeFraction();
      const chargeSpeedDU = frac >= 1
        ? weaponForMove.postFullChargeMoveSpeedDU
        : chargeLerp(weaponForMove.chargeMoveSpeedDUNoCharge, weaponForMove.chargeMoveSpeedDUFull, frac);
      speed = duPerFrameToPxPerSec(chargeSpeedDU);
    } else {
      speed = player.walkSpeed;
    }
  } else {
    speed = mouse.down ? player.shootSpeed : player.walkSpeed;
  }

  let dx = 0, dy = 0;
  if (keys.w) dy -= 1;
  if (keys.s) dy += 1;
  if (keys.a) dx -= 1;
  if (keys.d) dx += 1;
  if (dx || dy){
    const len = Math.hypot(dx, dy);
    dx /= len; dy /= len;
    const nx = player.x + dx * speed * dt;
    const ny = player.y + dy * speed * dt;
    // Simple axis-separated collision so sliding along a wall still works.
    if (!isInsideObstacle(nx, player.y, player.radius) &&
        nx > player.radius && nx < W - player.radius) player.x = nx;
    if (!isInsideObstacle(player.x, ny, player.radius) &&
        ny > player.radius && ny < H - player.radius) player.y = ny;
  }

  if (!aimLocked){
    player.aimAngle = Math.atan2(mouse.y - player.y, mouse.x - player.x);
  }

  const now0 = performance.now();
  const weapon0 = getCurrentWeapon();
  const framesSinceLastShot = (now0 - lastShotAt) / 1000 * FPS;
  const inLockout = weapon0.inkRecoveryLockoutFrames !== undefined &&
                     lastShotAt > 0 && framesSinceLastShot < weapon0.inkRecoveryLockoutFrames;
  // チャージャー種はチャージを溜めている間、消費予測ぶんのインクを
  // "確保"している状態として扱い、自然回復も止める
  // （＝チャージ中は白い帯(予測)が伸びるだけで、ゲージの緑残量自体は減らないが、
  // 　自然回復による裏側での増加も同時に止まる、という仕様）。
  const chargingNow = weapon0.type === 'charger' && player.charging;
  // チャージキープ中の潜伏（イカ状態でチャージを保持している状態）は、
  // チャージ操作自体こそ未実装（前隙29F等のCK専用タイミングは無い）だが、
  // 「イカ化してもchargeFramesElapsedはリセットされずそのまま保持される」
  // という挙動は既に成立している。この保持中はインクを"抱えて"いる状態
  // として扱い、自陣インク上の急速回復を含めインク回復を一切無効化する
  // （＝ヒト状態のチャージ中と同じ扱い）。イカ化不能ロック中(squidLockout)
  // や発射直後でチャージが0に戻っていれば通常のイカ回復に戻る。
  const chargeKeepingNow = weapon0.type === 'charger' && player.form === 'squid' && player.chargeKeepActive;
  if (!inLockout && !chargingNow && !chargeKeepingNow){
    // 急速回復はイカ状態でかつ自陣インク上のときだけ。ヒト状態は常に自然回復のみ。
    const rapidRegenActive = player.form === 'squid' && player.isSwimming;
    const regen = rapidRegenActive ? player.swimRegenRate : player.regenRate;
    player.ink = Math.min(player.maxInk, player.ink + regen * dt);
  }

  const now = performance.now();
  const weapon = getCurrentWeapon();
  // イカ状態では左クリック(発射)を無効化する。チャージャー種はここでは
  // 発射しない(input.jsのmouseupハンドラでfireChargerShot()を呼ぶ)。
  if (weapon.type !== 'charger' &&
      player.form === 'human' && mouse.down && now - lastShotAt >= weapon.fireIntervalSec * 1000){
    setLastShotAt(now);
    fireShot(mouse);
  }

  // 補正回復: once you've gone a full fireInterval without firing, the
  // tight-cone angle decays back toward firstShotBiasDeg at biasRecoveryPerFrameDeg/frame.
  if (weapon.firstShotBiasDeg !== undefined &&
      now - bias.lastShotAt >= weapon.fireIntervalSec * 1000){
    bias.currentDeg = Math.max(
      weapon.firstShotBiasDeg,
      bias.currentDeg - weapon.biasRecoveryPerFrameDeg * (dt * FPS)
    );
  }
}
