import { FPS, lines } from './config.js';
import { W, H, isInsideObstacle } from './stage.js';
import { paintSplatClipped, paintTrailDot } from './painting.js';
import { creditCappedPaintPoints } from './score.js';
import { player, getCurrentWeapon, setLastShotAt, resetChargerRuntimeState } from './player.js';
import { dummy, respawnDummy } from './dummy.js';

/* ==========================================================================
   charger.js — チャージャー種 (リッター4K) のロジック
   --------------------------------------------------------------------------
   シューター種とは別の武器系統。左クリックを押し続けるとチャージが溜まり
   (chargeFrames)、離すと現在のチャージ量に応じた威力・射程・初速・インク
   消費で1発だけ即着弾(ヒットスキャン)の弾を撃つ。射程・ダメージ・初速・
   軌跡塗りの見た目がすべてチャージ量(0〜1)に応じて変化する。

   chargeLerp: ノーチャージ→フルチャージへ frac(0〜1)で連続的に線形補間する
   汎用ヘルパー。資料に半チャージ最大値の区切りが無い項目(軌跡塗りの半径・
   発生数・着弾先端塗り半径・インク消費量・単発塗りポイント)に使う。

   chargeLerpJump: ダメージ・初速のように「ノーチャージ→半チャージ(99%)まで
   は線形に伸びるが、フルチャージ(100%)だけ別枠の値に不連続ジャンプする」
   項目用のヘルパー。frac>=1 (フルチャージ)でfullValを返し、それ未満は
   frac/0.99を線形補間の進捗として使う。
   ========================================================================== */

export const chargerFlashes = [];

export function chargeLerp(noVal, fullVal, frac){
  return noVal + (fullVal - noVal) * frac;
}
export function chargeLerpJump(noVal, halfMaxVal, fullVal, frac){
  if (frac >= 1) return fullVal;
  const t = Math.min(frac / 0.99, 1);
  return noVal + (halfMaxVal - noVal) * t;
}

export function getChargeFraction(){
  const weapon = getCurrentWeapon();
  if (weapon.type !== 'charger') return 0;
  return Math.min(player.chargeFramesElapsed / weapon.chargeFrames, 1);
}

// チャージ中に表示する照準レーザー(見える射線)の可視距離を求める。実際の
// インクショット(fireChargerShot内のマーチング)はヒト(ダミー)を貫通する
// が、これはあくまで着弾判定・塗り処理のロジック。レーザー"表示"は見える
// 光線なので、実機の見た目に合わせて地形(壁)にもヒト(ダミー)にも貫通させず、
// 最初に当たった地点で止める。壁・ダミーいずれにも当たらなければ
// maxDistPx(=現在のチャージ量に応じた射程)まで届く。
export function computeLaserStopDistance(maxDistPx, dirX, dirY, projRadiusTerrainPx, projRadiusEnemyPx){
  const STEP = 4;
  let dist = 0;
  while (dist < maxDistPx){
    const nextDist = dist + STEP;
    const nx = player.x + dirX * nextDist;
    const ny = player.y + dirY * nextDist;
    if (nx < 0 || nx > W || ny < 0 || ny > H) return Math.min(dist, maxDistPx);
    if (isInsideObstacle(nx, ny, projRadiusTerrainPx)) return dist; // 地形で止める(貫通しない)
    if (dummy.hp > 0 && Math.hypot(nx - dummy.x, ny - dummy.y) < dummy.radius + projRadiusEnemyPx){
      return nextDist; // ヒト(ダミー)の位置で止める(貫通しない、実際のショットとは別扱い)
    }
    dist = nextDist;
  }
  return Math.min(dist, maxDistPx);
}

// チャージャーの発射本体。「離した瞬間、8F以上溜まっていた場合」の
// input.jsのmouseupハンドラ、または「8F未満で離した後、チャージが8Fに
// 到達した瞬間」のtickCharger()側の自動発射から、それぞれ1回だけ呼ばれる。
// 弾速がシューターに比べて桁違いに速い(初速24〜96DU/F)ためヒットスキャン
// (瞬間着弾)として扱い、プレイヤー位置から照準方向へ小刻みに進めながら
// 壁/ダミーへの当たり判定を先に解決してから、着弾点までまとめて塗りを行う。
export function fireChargerShot(){
  const weapon = getCurrentWeapon();
  const frac = getChargeFraction();
  player.charging = false;
  player.pendingChargeFire = false;

  // ここに来るのは常にchargeFramesElapsed >= minChargeFramesToFireのはず
  // (input.jsのmouseupハンドラ・tickCharger()の自動発射トリガーの両方が
  // その条件を満たしてから呼ぶため)。念のための保険としてこのガードは
  // 残しておく——万が一0Fやそれ未満で呼ばれても、チャージを破棄するだけで
  // 何も発射しない。
  if (frac <= 0 || player.chargeFramesElapsed < weapon.minChargeFramesToFire){
    player.chargeFramesElapsed = 0;
    player.chargeKeepActive = false;
    player.chargeKeepFramesLeft = 0;
    player.ckResurfaceDelayFramesLeft = 0;
    return;
  }

  // インク消費量: 資料に半チャージ最大値の明記が無いため、ノーチャージ→
  // フルチャージへchargeLerpで連続補間する近似値を採用(chargeLerpJumpは
  // 使わない)。
  const inkCost = chargeLerp(weapon.inkPerShotNoCharge, weapon.inkPerShotFull, frac);
  // チャージャー種の定義: インク不足時でも専用の(遅い)チャージ時間で
  // チャージを溜めることができ(tickCharger()内、player.ink < curInkCost
  // のときchargeSlowdownMultiplierで速度を落とす処理を参照)、そのチャージ
  // が完了すれば——たとえその時点でインクが足りていなくても——ショットは
  // 発射できる。発射時のインク消費は残量を上限に(Math.max(0, ...)で0未満
  // にはならない)差し引くだけにする——本来のゲームでもインクタンクが
  // マイナスになることはない。
  player.ink = Math.max(0, player.ink - inkCost);

  const hitRangePx = lines(chargeLerp(weapon.rangeLinesNoCharge, weapon.rangeLinesFull, frac));
  const paintRangePx = lines(chargeLerp(weapon.paintRangeLinesNoCharge, weapon.paintRangeLinesFull, frac));
  const maxMarchPx = Math.max(hitRangePx, paintRangePx);
  const angle = player.aimAngle;
  const dirX = Math.cos(angle), dirY = Math.sin(angle);
  const projRadiusEnemyPx = lines(weapon.projectileSizeEnemyLines) / 2;
  const projRadiusTerrainPx = lines(weapon.projectileSizeTerrainLines) / 2;

  // 貫通仕様: リッター4Kのインクショットはヒト(ダミー)を貫通し、射程内で
  // あればダミーの奥までそのまま届く。地形(壁)だけは貫通しないので、壁に
  // 当たった時点でそこより先には進まない。ダミーへのヒット判定は一度だけ
  // 記録し(hitDummyFlagで多重ヒットを防止)、その後もマーチングを続けて
  // 着弾点(dist)を壁または最大距離(maxMarchPx)まで押し進める。
  const STEP = 4; // ヒットスキャン判定のマーチングステップ幅(px)
  let dist = 0;
  let hitDummyFlag = false;
  while (dist < maxMarchPx){
    const nextDist = dist + STEP;
    const nx = player.x + dirX * nextDist;
    const ny = player.y + dirY * nextDist;
    if (nx < 0 || nx > W || ny < 0 || ny > H) break;
    if (isInsideObstacle(nx, ny, projRadiusTerrainPx)) break; // 地形は貫通しない
    if (!hitDummyFlag && nextDist <= hitRangePx && dummy.hp > 0 &&
        Math.hypot(nx - dummy.x, ny - dummy.y) < dummy.radius + projRadiusEnemyPx){
      hitDummyFlag = true; // ヒットは記録するが、貫通するのでbreakしない
    }
    dist = nextDist;
  }
  dist = Math.min(dist, maxMarchPx);
  const endX = player.x + dirX * dist;
  const endY = player.y + dirY * dist;

  if (hitDummyFlag){
    const damage = chargeLerpJump(weapon.damageNoCharge, weapon.damageHalfChargeMax, weapon.damageFull, frac);
    if (dummy.firstHitAt === null) dummy.firstHitAt = performance.now();
    dummy.hp = Math.max(0, dummy.hp - damage);
    if (dummy.hp === 0){
      dummy.lastKillTimeText = ((performance.now() - dummy.firstHitAt) / 1000).toFixed(3) + '秒';
      setTimeout(respawnDummy, 500);
    }
  }

  // 足元塗り: このブキは平均間隔ではなく発射のたび毎回発生(資料に間隔の
  // 記載が無かったため)。
  paintSplatClipped(player.x, player.y, lines(weapon.footPaintRadiusLines));

  // 軌跡塗り: プレイヤー〜着弾点の間にdropCount個のブロブを均等配置する。
  // wikiの「軌跡塗り発生数」は経路上のドロップ総数として記載されており、
  // 着弾点そのものに置かれる最後の1個（＝着弾先端塗り）もこの総数に含まれる。
  // 経路上の最後の1個(i===dropCount)を着弾点(endX,endY)に置く円形splat
  // （着弾時の先端塗り半径テーブルの値を使用）として扱い、これで経路上の
  // 総ブロブ数は常にdropCount個ちょうどになる。着弾"直前"の1個
  // (i===dropCount-1)には引き続きtrailTipRadiusMultiplier(1.5倍)を適用する。
  const dropCount = Math.max(1, Math.round(chargeLerp(weapon.trailDropCountNoCharge, weapon.trailDropCountFull, frac)));
  const radiusAcrossPx = lines(chargeLerp(weapon.trailRadiusHorizontalNoCharge, weapon.trailRadiusHorizontalFull, frac));
  const radiusAlongPx = lines(chargeLerp(weapon.trailRadiusVerticalNoCharge, weapon.trailRadiusVerticalFull, frac));
  const tipRadiusPx = lines(chargeLerp(weapon.tipSplatRadiusNoCharge, weapon.tipSplatRadiusFull, frac));
  for (let i = 1; i <= dropCount; i++){
    if (i === dropCount){
      // 着弾先端塗り: 経路上の最後の1個は着弾点そのものに置く円形splat。
      paintSplatClipped(endX, endY, tipRadiusPx);
      continue;
    }
    const t = i / dropCount;
    const dx0 = player.x + (endX - player.x) * t;
    const dy0 = player.y + (endY - player.y) * t;
    const isPreLanding = (i === dropCount - 1);
    const mult = isPreLanding ? weapon.trailTipRadiusMultiplier : 1;
    paintTrailDot(dx0, dy0, radiusAlongPx * mult, radiusAcrossPx * mult, angle);
  }

  // 塗りポイントの定義を2つとも守る:
  //   (1) 1回塗った場所を重ねて撃っても加算されない
  //   (2) 塗りポイントの増分がマイナスになることは絶対にない
  // このブキは単発塗りポイントがwikiでノーチャージ6.6p〜フルチャージ32.0p
  // と明記されており、この値は「1発で塗れる上限」を表す公称値である。
  // 共通ヘルパーcreditCappedPaintPoints()（実測値と公称値の小さい方だけを
  // 加算する。詳細はscore.js参照）に一本化してあり、シューター種
  // (projectiles.js)の着弾時にも同じヘルパーを使っている。
  const nominalShotPoints = chargeLerp(weapon.singleShotPaintPointsNoCharge, weapon.singleShotPaintPointsFull, frac);
  creditCappedPaintPoints(nominalShotPoints);

  // 発射後隙: 資料により、次のチャージ開始まで(chargeRestartFrames)・
  // イカ化まで(squidLockoutFrames)・インク回復開始まで(inkRecoveryLockoutFrames、
  // simulation.js側の汎用ロックアウト機構をlastShotAt経由でそのまま流用)は
  // いずれもFC/NCで完全に同一のフラット値なので、チャージ量による補間は
  // 行わない。実際にトリガーが動くのは「発射隙(shotDelayFrames=1F)」ぶん
  // 遅れてからなので、次のチャージが開始できるまでの合計は
  // shotDelayFrames + chargeRestartFrames としている。
  player.chargeCooldownFramesLeft = weapon.shotDelayFrames + weapon.chargeRestartFrames;
  player.squidLockoutFramesLeft = weapon.shotDelayFrames + weapon.squidLockoutFrames;
  player.chargeFramesElapsed = 0;
  player.chargeKeepActive = false;
  player.chargeKeepFramesLeft = 0;
  player.ckResurfaceDelayFramesLeft = 0;
  // インク回復ロックアウトは既存の汎用機構(simulation.js、weapon.inkRecoveryLockoutFrames
  // とlastShotAtを見る)をそのまま使うため、シューターの発射と同じくlastShotAt
  // を更新しておく。
  setLastShotAt(performance.now());

  // 見た目用の光跡(150ms程度でフェードアウト)。判定・塗りには無関係。
  chargerFlashes.push({ x1: player.x, y1: player.y, x2: endX, y2: endY, bornAt: performance.now() });
}

// --------------------------------------------------------------------------
// チャージャー種のランタイム状態を1フレーム分だけ進める
// （元々はupdatePlayer()内にインラインで書かれていたチャージ蓄積・
// クールダウン・チャージキープ関連の処理を、責務ごとに分離してここへ
// 切り出したもの）。simulation.jsのupdatePlayer()から毎フレーム呼ばれる。
// mouse.downは呼び出し側(input.js)のmouseオブジェクトをそのまま渡す。
// --------------------------------------------------------------------------
export function tickCharger(dt, weaponForMove, mouseDown){
  if (weaponForMove.type !== 'charger') return;

  // チャージキープ持続時間のカウントダウン: 潜伏中のみ減少する。0になると
  // 「イカ状態のときの灯が消えると同時にチャージキープ状態が解除される」
  // ——このときチャージそのものも失われる。
  if (player.chargeKeepActive && player.form === 'squid'){
    player.chargeKeepFramesLeft = Math.max(0, player.chargeKeepFramesLeft - dt * FPS);
    if (player.chargeKeepFramesLeft <= 0){
      player.chargeKeepActive = false;
      player.chargeFramesElapsed = 0;
    }
  }
  // チャージキープ解除(浮上)後の再チャージ遅延(チャージ前隙29F＋
  // チャージ時間1F)。フォームに関わらずカウントダウンし、0になった
  // 時点で既に左クリックが離されていれば(mouseDownがfalse)その場で
  // 自動発射する——まだ押されたままなら、通常の左クリックmouseup
  // ハンドラ側の発射に委ねる。
  if (player.ckResurfaceDelayFramesLeft > 0){
    player.ckResurfaceDelayFramesLeft = Math.max(0, player.ckResurfaceDelayFramesLeft - dt * FPS);
    if (player.ckResurfaceDelayFramesLeft <= 0 && !mouseDown){
      fireChargerShot();
    }
  }
  if (player.chargeCooldownFramesLeft > 0){
    player.chargeCooldownFramesLeft = Math.max(0, player.chargeCooldownFramesLeft - dt * FPS);
  }
  // wantsToCharge: 通常は左クリック押下中(mouseDown)。加えて、
  // 「minChargeFramesToFire(8F)未満でZRを離した」直後は
  // player.pendingChargeFireがtrueになっており、この間はマウスが
  // 離されていてもヒト状態のままチャージを継続させる——実機の
  // 「離すのが早すぎても、8F分のチャージは必ず消費してから発射される
  // (不発にはならない)」という仕様の再現。8Fに到達した瞬間、下の
  // if内で自動的にfireChargerShot()を呼んで発射する。
  const wantsToCharge = mouseDown || player.pendingChargeFire;
  if (player.form === 'human' && wantsToCharge && player.chargeCooldownFramesLeft <= 0){
    player.charging = true;
    const curFrac = getChargeFraction();
    const curInkCost = chargeLerp(weaponForMove.inkPerShotNoCharge, weaponForMove.inkPerShotFull, curFrac);
    // インク不足時はチャージ時間が延びる(×3)。現在のチャージ量で撃つのに
    // 必要なインクすら足りていない場合をその判定として使う近似。
    const slow = player.ink < curInkCost ? weaponForMove.chargeSlowdownMultiplier : 1;
    player.chargeFramesElapsed = Math.min(
      weaponForMove.chargeFrames,
      player.chargeFramesElapsed + (dt * FPS) / slow
    );
    // 早離し後の自動発射: pendingChargeFireが立っている間にチャージが
    // minChargeFramesToFire(8F)へ到達したら、その場でノーチャージ相当の
    // 弾を発射する。mouseDownは既にfalseのままなので、mouseupハンドラ側
    // ではなくこの経路だけが発射のトリガーになる。
    if (player.pendingChargeFire && player.chargeFramesElapsed >= weaponForMove.minChargeFramesToFire){
      player.pendingChargeFire = false;
      fireChargerShot();
    }
  } else {
    player.charging = false;
  }
}
