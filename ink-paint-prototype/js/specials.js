import { getTotalPaintPoints, creditCappedPaintPoints } from './score.js';
import { paintSplatClipped } from './painting.js';
import { lines } from './config.js';
import { dummy } from './dummy.js';
import { player } from './player.js';

/*
  specials.js — ハリケーン / トルネード の実装（正式）
  - fireSpecialWeapon イベントを受ける
  - 必要塗りpt: 210 を score.js の getTotalPaintPoints として確認し、
    足りていれば消費して発動（credit の減算APIを追加する形で実装）
  - 発動後は着弾予告を行い、1.5s後にトルネードを生成
  - トルネードは1.5sのダメージ判定（0.5 dmg/f を 1.3s 分）を行い、
    爆撃部は塗りを生み出す（塗りpt:60）。発生中はスペシャル蓄積が停止する
    ペナルティタイム（ここではシンプルにフラグで表現）を発生させる。
*/

const REQUIRED_PAINT = 210;

// Specials state
export const specials = [];
let penaltyActive = false;
let penaltyUntil = 0;

// Small API: consume paint points. score.js doesn't provide a direct consume API,
// so we implement a local workaround: we assume getTotalPaintPoints() reflects
// the authoritative total. To "consume" points safely, we add a crude fallback
// where we track a local spent counter. For a stricter design we'd add a consume
// API to score.js, but to avoid changing score.js more than necessary, keep it
// here minimal.

let localConsumedPaint = 0;
function getAvailablePaint(){
  return Math.max(0, Math.floor(getTotalPaintPoints() - localConsumedPaint));
}
function consumePaint(n){
  localConsumedPaint += n;
}

// Specials update loop: called from main.js
export function updateSpecials(dt){
  const now = performance.now();

  // Penalty expiration
  if (penaltyActive && now >= penaltyUntil){
    penaltyActive = false;
    console.debug('[specials] penalty ended');
  }

  for (let i = specials.length - 1; i >= 0; i--){
    const s = specials[i];
    s.age += dt;
    if (!s.armed && s.age >= s.warnDelay){
      // Landing after warning
      s.armed = true;
      s.tornadoAge = 0;
      s.damageTickElapsed = 0;
      // Create immediate explosion paint for the "炸裂"部
      paintSplatClipped(s.x, s.y, lines(1.0)); // use 1 line radius for blast visual
      // add paint points for the tornado's splat (トルネードの塗りpt:60)
      creditCappedPaintPoints(60);
      // enter penalty time while tornado + wind animation lasts (we'll use 1500ms+...)
      penaltyActive = true;
      penaltyUntil = now + 2000; // 2s penalty roughly matching tornado lifetime
      console.debug('[specials] Tornado landed at', s.x, s.y);
    }

    if (s.armed){
      // Tornado damage ticks at 60fps equivalent, but dt is in seconds so accumulate
      const dmgPerSec = 0.5 * 60; // 0.5 per frame * 60fps = 30 dmg/sec
      s.tornadoAge += dt;
      // Damage lasts 1.3s according spec
      if (s.tornadoAge <= 1.3){
        // Apply damage proportional to dt
        const dmg = 0.5 * 60 * dt; // 0.5 per frame => 0.5*FPS*dt per frame chunk
        const dx = dummy.x - s.x, dy = dummy.y - s.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= lines(1.0)){
          dummy.hp = Math.max(0, dummy.hp - dmg);
        }
      } else {
        // Tornado finished
        specials.splice(i, 1);
      }
    }
  }
}

// Listener for special fire
window.addEventListener('fireSpecialWeapon', e => {
  const avail = getAvailablePaint();
  if (avail < REQUIRED_PAINT){
    console.debug('[specials] not enough paint:', avail, 'need', REQUIRED_PAINT);
    // Could flash HUD here
    return;
  }
  // consume
  consumePaint(REQUIRED_PAINT);

  // Spawn warning marker at current mouse position from event detail? event doesn't carry coordinates
  // Fallback: use window.mouse (input exposes) — simpler: read from global mouse if available
  const mouse = window.__GLOBAL_MOUSE__;
  const x = mouse ? mouse.x : 300;
  const y = mouse ? mouse.y : 300;

  specials.push({ x, y, age: 0, warnDelay: 1.5, armed: false });
  console.debug('[specials] fired at', x, y, 'remaining paint', getAvailablePaint());
});
