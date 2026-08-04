import { stage } from './stage.js';
import { player, getCurrentWeapon, resetBurstShotCount } from './player.js';
import { fireChargerShot } from './charger.js';
import { resetPaint } from './game-control.js';

/* ==========================================================================
   input.js — 操作: キーボード・マウス
   ========================================================================== */

export const keys = { w:false, a:false, s:false, d:false };
export const mouse = { x: player.x, y: player.y, down: false };

// 照準ロック: 実機のスティック操作では、右スティックに触れていない限り狙う
// 方向はワールド座標で固定されたまま体だけ平行移動する（カニ歩き）。
// マウスは常に「カーソルの絶対位置」を狙ってしまうため、Shift押下中は
// aimAngleの更新を止めて、正面を向いたまま横移動する状況を再現できるように
// している（実際の更新はsimulation.jsのupdatePlayer()側）。ロックしていない
// とカーソルとの相対角度が動くたびに着弾点が弧を描いて振れ、塗りが繋がらな
// くなる。
export let aimLocked = false;

window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k in keys) keys[k] = true;
  if (k === 'r') resetPaint();
  if (e.key === 'Shift') aimLocked = true;
});
window.addEventListener('keyup', e => {
  const k = e.key.toLowerCase();
  if (k in keys) keys[k] = false;
  if (e.key === 'Shift') aimLocked = false;
});
stage.addEventListener('mousemove', e => {
  const r = stage.getBoundingClientRect();
  mouse.x = e.clientX - r.left;
  mouse.y = e.clientY - r.top;
});
stage.addEventListener('mousedown', e => {
  if (e.button === 0) mouse.down = true;
  if (e.button === 2){
    // イカ化不能ロック中(発射後squidLockoutFrames)は右クリック長押しでも
    // イカ状態に入れない — リッター4Kの発射後隙(16F)を再現するための制約。
    if (player.squidLockoutFramesLeft <= 0){
      const weapon = getCurrentWeapon();
      // チャージキープの定義: フルチャージが完了してからの潜伏でないと
      // 発生しない。フルチャージに満たない状態で潜伏した場合、チャージ
      // キープにはならず、溜めていたチャージそのものを失う。
      if (weapon.type === 'charger' && weapon.ckStats){
        // イカ化する時点で「早離し後の自動発射待ち」は破棄する
        // (スクイッドに入る＝チャージ操作自体を手放す操作なので、後から
        // 勝手にノーチャージ弾が飛ぶのは不自然なため)。
        player.pendingChargeFire = false;
        if (player.chargeFramesElapsed >= weapon.chargeFrames){
          player.chargeKeepActive = true;
          player.chargeKeepFramesLeft = weapon.ckStats.keepDurationFrames;
        } else {
          player.chargeFramesElapsed = 0;
          player.chargeKeepActive = false;
        }
      }
      player.form = 'squid';
    }
  }
});
window.addEventListener('mouseup', e => {
  const weapon = getCurrentWeapon();
  if (e.button === 0) {
    mouse.down = false;
    // 足元塗り・中間塗りのパターンは「連射し続けている間」の射撃回数を基準に
    // 進む固定パターンなので、トリガーを離したらカウントをリセットする。
    resetBurstShotCount();
    // チャージャー種はここが「離した瞬間」＝発射トリガー…だが、実機は
    // 「離した時点のチャージ量」で即座に不発になるわけではない。8F
    // (minChargeFramesToFire)未満でしか溜まっていない状態で離した場合、
    // ここでは発射せず、pendingChargeFireを立ててcharger.jsのtickCharger()
    // 側でヒト状態のままチャージを継続させる。8Fに到達した瞬間、そちらが
    // 自動的にfireChargerShot()を呼ぶ(＝ノーチャージ弾が出る)。
    // チャージキープ解除後の再チャージ遅延(ckResurfaceDelayFramesLeft)が
    // 残っている間に離した場合は、ここでは発射せず、その遅延が明けた
    // 瞬間にtickCharger()側で自動的に発射される（この時点でmouse.downが
    // 既にfalseになっていることがそのトリガーになる）。
    if (weapon.type === 'charger' && player.ckResurfaceDelayFramesLeft <= 0 && player.charging){
      if (player.chargeFramesElapsed >= weapon.minChargeFramesToFire){
        fireChargerShot();
      } else {
        player.pendingChargeFire = true;
      }
    }
  }
  if (e.button === 2){
    // チャージキープ中に浮上(右クリックを離す)した場合だけ、専用の
    // 再チャージ遅延(チャージ前隙29F＋チャージ時間1F)を発生させる。
    // チャージキープに至っていなかった通常の潜伏からの復帰では、この
    // 遅延は発生しない(通常通りヒト状態でチャージし直す)。
    if (weapon.type === 'charger' && weapon.ckStats && player.chargeKeepActive){
      player.ckResurfaceDelayFramesLeft = weapon.ckStats.chargePreDelaySquidFrames + weapon.ckStats.chargeFrames;
    }
    player.chargeKeepActive = false;
    player.form = 'human'; // 右クリックを離すとヒト状態に戻る
  }
});
// ブラウザ標準の右クリックメニューはイカ状態トグルの邪魔になるので抑制する。
stage.addEventListener('contextmenu', e => e.preventDefault());
