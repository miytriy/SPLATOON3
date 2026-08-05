import { mouse } from './input.js';
import { player } from './player.js';
import { paintSplatClipped, getSplatRadius } from './painting.js';
import { lines } from './config.js';
import { dummy } from './dummy.js';

/*
  subweapons.js — サブウェポンの実装（プロトタイプ）
  - 現在は「クイックボム(Quick Bomb)」を実装
  - input.js -> player.js 経由で発火される 'useSubWeapon' カスタムイベントを受けて処理
*/

// Quick Bomb parameters (from specs)
const QUICK_BOMB = {
  inkCostPercent: 45,
  // radii (lines)
  nearRadiusLines: 0.56,
  farRadiusLines: 0.80,
  // damage
  directHit: 25.0,     // direct hit component
  nearDamage: 35.0,
  farDamage: 25.0,
  paintRadiusLines: 0.80,
};

// Utility: clamp target to max throw range (3.0 lines)
function clampTargetToRange(tx, ty){
  const maxPx = lines(3.0);
  const dx = tx - player.x, dy = ty - player.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= maxPx) return { x: tx, y: ty };
  const ux = dx / dist, uy = dy / dist;
  return { x: player.x + ux * maxPx, y: player.y + uy * maxPx };
}

window.addEventListener('useSubWeapon', (e) => {
  // For the prototype we throw to the current mouse cursor
  const target = clampTargetToRange(mouse.x, mouse.y);

  // Create immediate explosion effect at target
  const paintRadiusPx = lines(QUICK_BOMB.paintRadiusLines);
  paintSplatClipped(target.x, target.y, paintRadiusPx);

  // Damage dummy if inside radii
  const d = Math.hypot(dummy.x - target.x, dummy.y - target.y);
  const nearPx = lines(QUICK_BOMB.nearRadiusLines);
  const farPx = lines(QUICK_BOMB.farRadiusLines);

  // Direct hit heuristic: if the target location is very close to the dummy center,
  // treat as direct hit (apply directHit + nearDamage)
  if (d <= 8) { // within ~8px treated as direct contact (very close)
    const total = QUICK_BOMB.directHit + QUICK_BOMB.nearDamage;
    dummy.hp = Math.max(0, dummy.hp - total);
  } else if (d <= nearPx) {
    dummy.hp = Math.max(0, dummy.hp - QUICK_BOMB.nearDamage);
  } else if (d <= farPx) {
    dummy.hp = Math.max(0, dummy.hp - QUICK_BOMB.farDamage);
  }

  // Visual/log feedback for debugging
  console.debug('[subweapon] Quick Bomb thrown at', target, 'dummyDistPx=', d, 'dummyHP=', dummy.hp);
});
