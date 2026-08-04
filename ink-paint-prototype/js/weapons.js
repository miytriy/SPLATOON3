import { framesToSeconds } from './config.js';

/* ==========================================================================
   weapons.js — ブキ定義
   --------------------------------------------------------------------------
   検証済みのフレーム精度データ（連射フレーム・時間ベースのダメージ減衰・
   正確なインク消費量・初速DU/F・拡散/補正角度）をそのまま持たせている。
   ========================================================================== */

export const WEAPONS = [
  {
    name: 'スプラシューター',
    weightClass: '中量級',
    rangeLines: 2.6,          // 有効射程 (effective range)
    maxRangeLines: 2.7,       // カス当たり射程 (max distance a chip-damage hit still lands)
    confirmedKillRangeLines: 2.5, // 確定数維持射程 (range within which the 3-hit kill still holds)
    reticleRangeLines: 2.4,   // レティクル反応射程 — max distance the reticle still highlights a target; not wired into aim-assist yet (no aim-assist in this prototype)
    paintRangeLines: 3.4,     // 塗り射程 — average crab-walking paint reach; descriptive only, not used by the sim (塗りPT comes from actual splats)
    fireIntervalSec: framesToSeconds(6),  // 連射フレーム 6F = 0.100s exactly
    inkPerShot: 100 / 108,                // インク消費量 0.92%（装弾数108発）
    // 単発塗りポイント: 地面と並行に1発ずつ射撃して得られた塗りポイントの
    // 平均を、ナワバリバトルの塗りポイントカウンターを用いて算出した公称値
    // (4.0p)。この値は「1発で塗れる上限」として厳守する: 実面積比例の
    // 換算方式(POINTS_PER_LINE_SQUARED、score.js参照)で計算した実際の新規
    // 塗り面積ぶんの点数と、この公称値の小さい方を採用する
    // (score.js の creditCappedPaintPoints() を参照)。これにより「新規面積
    // が公称値を超えても公称値で頭打ち」「既に塗った場所を撃っても加算され
    // ない(実面積側がほぼ0になるため)」「加算がマイナスになることはない」
    // の3つを同時に満たす。
    singleShotPaintPoints: 4.0,
    speedDU: 22.66,                       // 初速 (initial shot speed, DU/F)
    shootMoveSpeedDU: 0.72,               // 射撃時ヒト速 — ブキ固有データ（重量級カテゴリ非依存）
    directFrames: 4,                      // 直進フレーム — flies straight at full speed for this many frames, then decelerates
    // 減速状態・自由落下状態のパラメータ（シューター種の実測値、単位はm/F・m/F^2）。
    // 直進状態終了後、XZ速度は毎F(1-D)を乗算しfloorXZで下げ止まり、Y速度は
    // (1-D)を乗算した後Eを減算しfloorYで下げ止まる。両方が下限に達すると
    // 自由落下状態へ移行し、以後は(G,H)を使った同様の式で減衰する。
    decelAirResistXZ: 0.36,   // 減速時の空気抵抗 (D)
    decelGravityY: 0.07,      // 減速時の重力 (E) [m/F^2]
    decelFloorXZ_mF: 0.2355,  // 減速状態の下限XZ速度 (F) [m/F]
    decelFloorY_mF: -0.15,    // 減速状態の下限Y速度 (F) [m/F]
    freefallAirResistXZ: 0.02, // 自由落下時の空気抵抗 (G)
    freefallGravityY: 0.016,   // 自由落下時の重力 (H) [m/F^2]
    spreadDeg: 4.86,                      // 拡散 (max cone half-angle for the "wide" branch below)
    jumpSpreadDeg: 11.66,                 // ジャンプ中拡散 — stored for future use; no jump input in this prototype yet
    jumpShotBiasDeg: 4.664,               // ジャンプ撃ち補正 — the fixed (non-decaying) bias cone used while airborne; stored for future use, no jump input yet
    // 前隙・後隙: frames of forced windup/cooldown around firing. Not
    // enforced by the sim yet (mouse-down fires every fireIntervalSec
    // immediately) — stored here so the timing model can be tightened later.
    preShotFramesHumanoid: 2,   // 射撃前隙(ヒト) — delay before the first shot when already in humanoid form
    preShotFramesSquid: 10,     // 射撃前隙(イカ) — delay before the first shot when coming out of squid form
    postShotFrames: 4,          // 射撃後隙 — forced delay after the last shot before other actions (e.g. squidding) are free
    // インク回復不能時間: frames after a shot during which ink regen stays at
    // zero even if you've released the trigger, before regenRate kicks in.
    inkRecoveryLockoutFrames: 20,
    // 初弾補正・ブレ: accuracy degrades with sustained fire, then recovers.
    firstShotBiasDeg: 0.0486,       // 初弾補正 — tight-cone angle for a fresh burst
    biasWorsenPerShotDeg: 0.0486,   // 補正悪化量 — added to the tight-cone angle per shot fired
    maxBiasDeg: 1.215,              // 最低補正 — ceiling the tight-cone angle worsens to (144F to reach it)
    biasRecoveryPerFrameDeg: 0.0729, // 補正回復量 — per-frame recovery once you've stopped firing for one fireInterval
    // ダメージ(対応経過時間): 36.0 at <=8F of flight, falling to 18.0 by 40F.
    // Hits-to-kill (3~6) is NOT hardcoded — it emerges naturally from this
    // falloff plus the dummy's HP pool, same as in the real game.
    damageFalloff: {
      startFrame: 8, startDamage: 36.0,     // 非減衰F, 最大DMG
      endFrame: 40, endDamage: 18.0,        // 減衰終了F, 最小DMG
      perFrameDecay: 0.5625,                // 1Fあたり減衰量 = (36-18)/(40-8)、wiki記載値と一致確認済み
    },
    // 弾の大きさ: 直径で指定（wiki注記により、塗り半径等と異なりこの項目だけ
    // 直径を単位として採用しているため）。当たり判定に使う際は半径に変換する
    // 必要がある（projectiles.jsのupdateProjectiles内で /2 している）。
    projectileSizeEnemyLines: 0.114,
    projectileSizeTerrainLines: 0.08,
    // 着弾塗り半径: shrinks slightly from 0.39 to 0.34 lines as impact
    // distance goes from 0.22 to 4.00 lines.
    splatRadiusFalloff: { startDist: 0.22, startRadius: 0.39, endDist: 4.00, endRadius: 0.34 },
    // 着弾塗りの前方伸び率: the landing splat extends forward (in the shot's
    // flight direction) past the impact point by up to this multiple of its
    // radius; the multiplier shrinks with impact distance, same distance
    // range as the radius falloff above.
    stretchFalloff: { startDist: 0.22, startRatio: 2.24, endDist: 4.00, endRatio: 1.12 },
    // 足元塗り: every 4th shot also paints a blob at the player's feet.
    // footPaintAvgInterval is the *average* shot-count between foot paints,
    // fed through the same floor(n/avg) cumulative-trigger logic used for
    // 中間塗り's fractional count (see shouldFootPaint() in projectiles.js).
    // For a weapon like this one where the interval is a fixed integer (4),
    // that logic just reduces to "every 4th shot" — so it doubles as the
    // general case that also covers わかばシューター's alternating
    // "3→4発毎" interval below.
    // 資料には「4発毎（22F毎）」という補足があるが、連射F(6F)×4発=24Fとは
    // 2Fの差異がある（前隙等の詳細タイミングは未モデル化のため要因不明）。
    // 現状のfootPaintAvgIntervalは発数ベースのロジックなので「4発毎」の方を
    // 採用し、22Fという時間情報は参考として残すのみで計算には使わない。
    footPaintAvgInterval: 4,
    footPaintRadiusLines: 0.41,
    // 中間塗り: extra blobs along the flight path between player and impact,
    // spaced every 1.84 lines。wikiの documented rule: each weapon has a
    // fixed 最大飛沫数 (max drop count) per shot; when that count is
    // fractional (average ~1.5/shot for スプラシューター), the actual
    // per-shot count follows a fixed cumulative pattern tied to shot index
    // within the current burst — floor(avg*n) - floor(avg*(n-1)) — NOT a
    // distance/interval-derived guess. See midPaintDropsForShot() in
    // projectiles.js. The interval below still caps how many of those drops
    // actually fit along a given shot's (possibly short) travel distance.
    midPaintIntervalLines: 1.84,
    midPaintAvgPerShot: 1.5,
    midPaintRadiusLines: 0.29,
  },
  {
    name: 'わかばシューター',
    weightClass: '軽量級',
    rangeLines: 2.3,           // 有効射程
    // カス当たり射程は記載なし＝「最大射程まで有効な射程」（wiki注記の
    // ルール通り）なので、実際の最大到達距離(maxRangeLines)も有効射程と
    // 同じ ライン2.3 として扱う。
    maxRangeLines: 2.3,
    confirmedKillRangeLines: 2.3, // 確定数維持射程
    reticleRangeLines: 2.1,       // レティクル反応距離
    paintRangeLines: 3.5,         // 塗り射程（表示用、シムには未使用）
    fireIntervalSec: framesToSeconds(5),  // 連射フレーム 5F = 0.083s
    inkPerShot: 100 * 1.1 / 255,          // インク消費量0.43%は「通常100タンク基準」の値。
                                           // このブキはタンク容量+10%(下記mainInkCapacityMultiplier)
                                           // なので、実際に255発撃ち切るには 0.43%×255≈110% 分の
                                           // インクが必要 → 100*1.1/255 という式で0.43%と整合させる。
    mainInkCapacityMultiplier: 1.1,       // インクタンク容量+10%（他ブキの1.1倍）
    speedDU: 22.66,                       // 初速
    shootMoveSpeedDU: 0.76,               // 射撃時ヒト速
    directFrames: 3,                      // 直進フレーム 3F
    // 減速状態・自由落下状態のパラメータ: 「ブキ種ごとの設定値一覧」表より、
    // これらの値はスプラシューター固有ではなく「シューター種」共通の実測値
    // であることが判明したため、同じシューター種であるわかばシューターにも
    // 正式に設定する。以前は「未検証」としてprojectiles.js側のフォール
    // バック（簡易指数減衰）に頼っていたが、指数減衰は理論上いつまでも
    // 速度が0に収束しきらず、射程が収束値ギリギリだと着弾判定が成立しない
    // まま弾が残り続ける（画面に白玉が残る）ことがあったため、これが根本的
    // な修正になる。
    decelAirResistXZ: 0.36,   // 減速時の空気抵抗 (D)　シューター種共通
    decelGravityY: 0.07,      // 減速時の重力 (E) [m/F^2]　シューター種共通
    decelFloorXZ_mF: 0.2355,  // 減速状態の下限XZ速度 (F) [m/F]　シューター種共通
    decelFloorY_mF: -0.15,    // 減速状態の下限Y速度 (F) [m/F]　シューター種共通
    freefallAirResistXZ: 0.02, // 自由落下時の空気抵抗 (G)　シューター種共通
    freefallGravityY: 0.016,   // 自由落下時の重力 (H) [m/F^2]　シューター種共通
    spreadDeg: 11.66,                     // 拡散
    jumpSpreadDeg: 14.58,                 // ジャンプ中拡散
    jumpShotBiasDeg: 5.832,               // ジャンプ撃ち補正
    preShotFramesHumanoid: 2,
    preShotFramesSquid: 9,
    postShotFrames: 2,
    inkRecoveryLockoutFrames: 15,
    firstShotBiasDeg: 0.4664,
    biasWorsenPerShotDeg: 0.2332,
    maxBiasDeg: 4.664,
    biasRecoveryPerFrameDeg: 0.1166,
    damageFalloff: {
      startFrame: 8, startDamage: 28.0,
      endFrame: 24, endDamage: 14.0,
      perFrameDecay: 0.875, // = (28-14)/(24-8)、wiki記載値と一致確認済み
    },
    projectileSizeEnemyLines: 0.12,
    projectileSizeTerrainLines: 0.08,
    splatRadiusFalloff: { startDist: 0.22, startRadius: 0.42, endDist: 4.00, endRadius: 0.15 },
    stretchFalloff: { startDist: 0.22, startRatio: 2.62, endDist: 4.00, endRatio: 1.12 },
    // 足元塗り間隔:3→4発毎。固定間隔ではなく3発と4発を行き来する可変間隔
    // なので、中間塗りと同じ「平均値をfloor(n/avg)で累積判定する」ロジック
    // (shouldFootPaint()) に平均3.5を渡すことで、3,4,3,4,...と近い交互
    // パターンを再現する（スプラシューターのfootPaintAvgInterval:4は
    // この仕組みの特殊ケースとして同じ関数で扱える）。
    footPaintAvgInterval: 3.5,
    footPaintRadiusLines: 0.42,
    midPaintIntervalLines: 1.9,
    midPaintAvgPerShot: 1.4,
    midPaintRadiusLines: 0.30,
    // 単発塗りポイント: スプラシューターと同じ仕組みで「1発で塗れる上限」
    // として厳守する(4.5p。score.jsのcreditCappedPaintPoints()参照)。
    singleShotPaintPoints: 4.5,
  },
  // --------------------------------------------------------------------------
  // リッター4K — シューター種とは別の「チャージャー種」。左クリックを押し
  // 続けるとチャージが溜まり(chargeFrames)、離すと現在のチャージ量に応じた
  // 威力・射程・初速・インク消費で1発だけ即着弾(ヒットスキャン)の弾を撃つ。
  // フルチャージ(chargeFraction>=1)は99%チャージ地点までの値と別枠の値へ
  // 不連続にジャンプする(ダメージ40.0→79.9の直線的な伸びとは別に、フル
  // チャージでいきなり180.0になる、というのが実際のゲームの仕様)。
  //
  // 補足(実装上の単純化・注意点 — わからない/確認できなかった点):
  //  - 射程・塗り射程・初速は「ノーチャージ〜半チャージ(99%)」の区間で線形
  //    補間し、半チャージ最大値=フルチャージ値と資料に明記されている項目
  //    (射程・塗り射程)はそのまま同じ値をフルチャージ側にも使っている。
  //    初速はフルチャージのみ別枠(63.9→96.0への不連続ジャンプ)として扱った。
  //  - ダメージ・インク消費量・単発塗りポイントは「ノーチャージ→半チャージ
  //    最大(99%)」を線形補間し、フルチャージ(100%)でだけ別枠の値に切り替える
  //    実装にした。インク消費量は資料に半チャージ最大値の明記がなかったため、
  //    フルチャージの25%に向けて99%地点まで線形に近づける近似にしている
  //    (「インク消費増加/秒:16.25%/秒」等の秒間増加量はチャージ時間の刻み方
  //    が不明だったため今回は使わず、チャージ進捗の割合で直接補間した)。
  //  - 軌跡塗り(横半径・縦半径・発生数)や着弾先端塗り半径は、資料に半チャージ
  //    最大値の区切りがなかったため、ノーチャージ→フルチャージへ chargeFraction
  //    (0〜1)でそのまま連続的に線形補間している。
  //  - チャージ前隙・チャージ時間(NC=8F/FC=92F)・発射隙(1st=1F)・発射後隙の
  //    各項目(チャージ再開まで6F／サブ使用可能まで15F／イカ化可能まで16F／
  //    インク回復開始まで19F)は、資料の「リッター4K フレームデータ」表から
  //    フレーム精度で確定している値をそのまま採用した。FC/NCで発射後隙が
  //    完全に同一という点も資料通り(=チャージ量による補間はしない、フラット
  //    な固定値)。サブウェポン枠はこのプロトタイプに未実装のため
  //    subWeaponLockoutFramesは保持のみで参照していない。
  //  - チャージキープ(CK: イカ状態でチャージを保持する仕様)は今回は未実装。
  //    このプロトタイプは既存のシューター群と同じく「左クリック＝ヒト状態限定」
  //    という制約を踏襲しており、イカ状態中はチャージ操作自体を無効化して
  //    いる。CK関連のフレーム値(チャージ前隙29F・チャージF1F・発射隙1F・
  //    サブ0F・インク3F・持続75F)は将来実装するときのためckStats以下に
  //    まとめて保持してあるだけで、現状のシミュレーションには一切影響しない。
  //  - 非射撃時ヒト速度・イカ速(自陣インク上)は、以前は重量級カテゴリの
  //    代表値(WEIGHT_CLASS_STATS.重量級)を流用していたが、ブキ固有の実測値
  //    (ヒト速0.88DU/F・イカ速1.74DU/F)が判明したため walkSpeedDU /
  //    swimOnInkSpeedDU としてこのエントリに直接持たせ、そちらを優先する
  //    （player.jsのapplyWeaponSpeeds()参照）。イカ速(インク外)は重量級
  //    カテゴリ共通の実測値のままなので、引き続きWEIGHT_CLASS_STATS側を使う。
  //  - チャージ中の消費インク予測(白い帯)・チャージ中は自然回復が止まる、
  //    という仕様はチャージャー種共通のUI/挙動として実装した
  //    （ui.jsのrender()内のink-predict-band更新、charger.jsのtickCharger()
  //    によるchargingNow中の自然回復停止を参照）。
  //  - 8F未満(minChargeFramesToFire未満)でZRを離した場合の扱い: 実機は
  //    「離した時点のチャージ量」で不発になるのではなく、チャージ自体は
  //    そのままヒト状態で継続し、8Fへ到達した瞬間にノーチャージ相当の
  //    弾が自動的に発射される。この挙動を player.pendingChargeFire で
  //    表現している（詳細はplayer.js/charger.jsの各コメント参照）。
  //  - 貫通(ピアシング): インクショットはヒト(ダミー)を貫通し、射程内で
  //    あればダミーの奥まで届く(＝1発で複数対象にダメージ判定/ヒット判定
  //    が可能なチャージャーの仕様)。地形(壁)だけは貫通しないため、壁に
  //    当たった時点でショットはそこで止まる。charger.jsのfireChargerShot()
  //    内のマーチングループを参照(壁でのみbreakし、ダミーヒットは
  //    hitDummyFlagを立てるだけで継続する)。
  //    一方、発射前のチャージ中に表示される照準レーザー(見える射線)は
  //    実際の弾道とは別物で、地形にもヒト(ダミー)にも貫通せず、最初に
  //    当たった地点で表示を止める(＝視認できるレーザー光線として不自然に
  //    ならないようにするための見た目上の制約。computeLaserStopDistance()
  //    参照)。
  // --------------------------------------------------------------------------
  {
    name: 'リッター4K',
    type: 'charger',
    weightClass: '重量級',
    walkSpeedDU: 0.88,        // 非射撃時ヒト速度（ブキ固有の実測値。重量級代表値[≒0.893]より優先）
    swimOnInkSpeedDU: 1.74,   // イカ速・自陣インク上（ブキ固有の実測値。重量級代表値[≒1.667]より優先）
    chargeFrames: 92,                 // フルチャージ時間 92F(1.533s)
    minChargeFramesToFire: 8,         // ノーチャージ時のチャージ時間 8F — これより早く離すと、8Fに到達するまで
                                       // チャージを継続し、到達した瞬間に自動発射される(不発にはならない)
    chargeSlowdownMultiplier: 3,      // インク不足時のチャージ時間倍率(×3=チャージ速度1/3)
    chargePreDelayHumanoidFrames: 1,  // チャージ前隙(ヒト)
    chargePreDelaySquidFrames: 6,     // チャージ前隙(イカ) — 未実装(イカ中はチャージ不可)
    shotDelayFrames: 1,               // 発射隙(1st) — チャージ完了/離した瞬間から実際に発射されるまでの遅延
    // 発射後隙: FC(フルチャージ)・NCどちらで撃っても資料上まったく同じ値
    // だったため、チャージ量で補間せずフラットな固定値として扱う。
    chargeRestartFrames: 6,           // 次のチャージを開始できるまで(発射後)
    subWeaponLockoutFrames: 15,       // サブウェポンを使えるまで(発射後) — サブ未実装のため参照はしていない
    squidLockoutFrames: 16,           // イカ状態になれるまで(発射後)
    inkRecoveryLockoutFrames: 19,     // インク回復(インクロック解除)が始まるまで(発射後) — 既存の汎用ロックアウト機構(simulation.js)をそのまま流用
    // チャージキープ(CK)関連 — 未実装。将来実装する際の参考値としてのみ保持。
    ckStats: {
      chargePreDelaySquidFrames: 29,  // チャージキープ解除〜射撃可能になるまで(イカ)
      chargeFrames: 1,                // チャージF
      shotDelayFrames: 1,             // 発射隙
      subWeaponLockoutFrames: 0,      // サブ
      inkRecoveryLockoutFrames: 3,    // インク
      keepDurationFrames: 75,         // チャージキープ持続時間(1.25秒)
    },
    rangeLinesNoCharge: 2.3, rangeLinesFull: 6.2,             // 射程
    paintRangeLinesNoCharge: 3.1, paintRangeLinesFull: 6.7,   // 塗り射程
    speedDUNoCharge: 24.0, speedDUHalfChargeMax: 63.9, speedDUFull: 96.0, // 初速
    damageNoCharge: 40.0, damageHalfChargeMax: 79.9, damageFull: 180.0,   // ダメージ
    inkPerShotNoCharge: 2.25, inkPerShotFull: 25,             // インク消費量(%)
    singleShotPaintPointsNoCharge: 6.6, singleShotPaintPointsFull: 32,    // 単発塗りポイント(参考値、計算には未使用)
    chargeMoveSpeedDUNoCharge: 0.88, chargeMoveSpeedDUFull: 0.16, // チャージ中のヒト移動速度
    postFullChargeMoveSpeedDU: 0.15,  // フルチャージ保持中(発射前)のヒト移動速度
    chargeKeepDurationFrames: 75,     // チャージキープ持続時間 — 未実装(ckStats.keepDurationFramesと同値、互換のため残置)
    footPaintRadiusLines: 0.24,       // 足元塗り半径(発射のたび毎回発生)
    projectileSizeEnemyLines: 0.045,
    projectileSizeTerrainLines: 0.008,
    trailRadiusHorizontalNoCharge: 0.19, trailRadiusHorizontalFull: 0.37, // 軌跡塗りの横半径
    trailRadiusVerticalNoCharge: 0.65, trailRadiusVerticalFull: 0.37,    // 軌跡塗りの縦半径(進行方向)
    trailDropCountNoCharge: 3, trailDropCountFull: 13,        // 軌跡塗り発生数
    trailTipRadiusMultiplier: 1.5,    // 軌跡塗りの先端(着弾直前の一粒)の半径倍率
    // 着弾時の先端塗り半径: wiki記載値(0.21→0.77)だと画面上でやや大きく
    // 見えたため、見た目調整として一回り小さく(0.16→0.60、約25%減)して
    // ある。塗りポイントはこの見た目上の面積からではなく単発塗りポイント
    // (singleShotPaintPointsNoCharge/Full)を直接加算する方式に変更した
    // ため(charger.jsのfireChargerShot()末尾の塗りポイント加算処理を参照)、
    // この半径を縮めてもスコアには影響しない。
    tipSplatRadiusNoCharge: 0.16, tipSplatRadiusFull: 0.60,
    // 以下は参考値（このシミュレーションでは他の値から実質的に再現される
    // 派生統計であり、直接は計算に使っていない）:
    //   連射フレーム: 14F(0.233s, ノーチャージ) 〜 98F(1.633s, フルチャージ)
    //   キルタイム: 0.667s/kill(ノーチャージ) 〜 1.600s/kill(フルチャージ、チャージ時間込み)
    //   DPS: 171.4/秒(ノーチャージ) 〜 110.2/秒(フルチャージ)
    //   確定数: 3〜2(ノーチャージ〜半チャージ) / 1(フルチャージ)
    //   インク効率(ダメージ): 1778/14.8kill(NC) 〜 720/4.0kill(FC)
    //   インク効率(塗り): 290p(NC) 〜 130p(FC)
  },
];
