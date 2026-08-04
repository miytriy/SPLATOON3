import './input.js';     // 副作用: キーボード/マウスのイベントリスナーを登録
import './ui.js';        // 副作用: HUD初期表示・ブキ切替ボタン生成・スコアの定期更新を開始
import { updatePlayer } from './simulation.js';
import { updateProjectiles } from './projectiles.js';
import { render } from './ui.js';

/* ==========================================================================
   main.js — エントリポイント・メインループ
   --------------------------------------------------------------------------
   dt-based so behavior is consistent regardless of frame rate.
   ========================================================================== */

let lastTime = performance.now();
function loop(now){
  const dt = Math.min((now - lastTime) / 1000, 0.05); // clamp to avoid huge steps on tab-switch
  lastTime = now;

  updatePlayer(dt);
  updateProjectiles(dt);
  render();

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
