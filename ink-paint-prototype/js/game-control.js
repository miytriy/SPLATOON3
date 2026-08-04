import { pctx, cctx, W, H } from './stage.js';
import { resetScore } from './score.js';
import { player, resetChargerRuntimeState } from './player.js';

/* ==========================================================================
   game-control.js — ゲーム全体のリセット
   ========================================================================== */

export function resetPaint(){
  pctx.clearRect(0, 0, W, H);
  cctx.clearRect(0, 0, W, H);
  player.ink = player.maxInk;
  resetScore();
  // チャージャー種のランタイム状態は player.js 側の共通ヘルパーで一本化
  // してある（以前は switchWeapon() とここで同じ8行がコピペされていた）。
  resetChargerRuntimeState();
}
