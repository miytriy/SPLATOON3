import { W, H } from './stage.js';

/* ==========================================================================
   dummy.js — 練習用ターゲットダミー
   --------------------------------------------------------------------------
   Practice-range target dummy — lets you actually feel the difference
   between weapons (hits-to-kill, kill time) instead of just reading numbers.
   Fixed position so the line markers drawn from it stay meaningful.
   ========================================================================== */

export const dummy = {
  x: W - 120, y: H / 2,
  radius: 16,
  hp: 100, maxHp: 100,
  firstHitAt: null,
  lastKillTimeText: '–',
};

export function respawnDummy(){
  dummy.hp = dummy.maxHp;
  dummy.firstHitAt = null;
}
