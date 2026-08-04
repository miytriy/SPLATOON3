/* ==========================================================================
   config.js — ゲーム定義: 単位系・フレームレート・重量級別ステータス
   --------------------------------------------------------------------------
   Splatoon本編の距離・速度データは「ライン」単位（練習場の床の目盛り由来）
   で公開されている。コミュニティの実測により 1ライン=5m=50内部データ単位
   (DU) であることが確認されているため、本プロトタイプもこの換算に統一する。
   PIXELS_PER_LINEだけは本プロトタイプ独自のレンダースケール（本編由来では
   ない）で、~12px半径のプレイヤーがアリーナに対して人間/イカサイズに見える
   よう100px/lineに決めている。
   ========================================================================== */

export const METERS_PER_LINE = 5;
export const DU_PER_METER = 10;                  // 内部データ単位（コミュニティ実測による検証値）
export const DU_PER_LINE = METERS_PER_LINE * DU_PER_METER; // 50
export const PIXELS_PER_LINE = 100;              // 本プロトタイプ独自のレンダースケール
export const PIXELS_PER_METER = PIXELS_PER_LINE / METERS_PER_LINE;
export const FPS = 60;

export function lines(n){ return n * PIXELS_PER_LINE; }     // line -> px（ゲームプレイ定数用）
export function toLines(px){ return px / PIXELS_PER_LINE; } // px -> line（HUD/デバッグ表示用）

// 本編の内部パラメータは60fps基準・DU/F（フレームあたりDU）で記載されている
// ため、その換算をここに集約する。
export function duPerFrameToPxPerSec(v){
  return v * (PIXELS_PER_LINE / DU_PER_LINE) * FPS;
}
export function framesToSeconds(f){ return f / FPS; }

// 減速状態・自由落下状態のパラメータは "m/F"（m/F^2）単位で記載されている。
// DU_PER_METER(=10)を介して既存のDU/F系ヘルパーに接続し、他の速度値と
// 同じpx/secスケールに変換する。
export function mPerFrameToPxPerSec(v){ return duPerFrameToPxPerSec(v * DU_PER_METER); }

// 「Nライン(=N*50DU)の距離をtime秒で移動した」という実測データからDU/Fを
// 逆算する共通ヘルパー。以前は1ライン基準・3ライン基準でそれぞれ別関数
// (lineSecondsToDuPerFrame / threeLineSecondsToDuPerFrame)を持っていたが、
// 中身は「掛けるライン数が違うだけ」の同一計算だったため、ここに一本化した。
export function distanceSecondsToDuPerFrame(numLines, seconds){
  return (numLines * DU_PER_LINE) / (seconds * FPS);
}
// 呼び出し側の意図が分かりやすいよう、意味の残る名前の薄いラッパーとして
// 残してある（中身は distanceSecondsToDuPerFrame への委譲のみ）。
export function lineSecondsToDuPerFrame(seconds){ return distanceSecondsToDuPerFrame(1, seconds); }
export function threeLineSecondsToDuPerFrame(seconds){ return distanceSecondsToDuPerFrame(3, seconds); }

// --------------------------------------------------------------------------
// 重量級カテゴリ別のデフォルト移動速度（ブキ非依存）。
// 非射撃時ヒト速は「50DU(=1ライン=5m)移動にかかる秒数」として検証されている
// ため、distanceSecondsToDuPerFrame(1, seconds)へ渡す形にしてある。
// イカ速は「自陣インク上」と「インクが無い地面上」で異なる値が検証されて
// いる。3ライン(150DU)移動にかかる時間の実測値から算出（軽量級・中量級・
// 重量級の全カテゴリで分離データが確認できたため、「軽量級・重量級は暫定的
// に単一値を流用」という扱いは撤廃済み）:
//   軽量級: ヒト速2.40s／イカ速(オフインク)3.45s／イカ速(オンインク)1.30s
//   中量級: ヒト速2.60s／イカ速(オフインク)3.45s／イカ速(オンインク)1.40s
//   重量級: ヒト速2.80s／イカ速(オフインク)3.45s／イカ速(オンインク)1.50s
// オフインクのイカ速はどの重量級カテゴリでも同一（3.45s/3ライン）という
// 実測値だった点に注意——重量級間で差がつくのはヒト速とオンインクのイカ速
// のみ。射撃時ヒト速はブキ固有のデータなのでここには含めない
// (weapons.jsの各エントリの shootMoveSpeedDU を参照)。
//
// 個別ブキの実測値が判明している場合（例: リッター4K）は、weapon.walkSpeedDU
// / weapon.swimOnInkSpeedDU として weapons.js 側に直接持たせ、
// player.js の applyWeaponSpeeds() 側でこのカテゴリ代表値より優先して使う。
// まだ実測値の無いブキは引き続きこのカテゴリ代表値にフォールバックする。
// --------------------------------------------------------------------------
export const WEIGHT_CLASS_STATS = {
  '軽量級': {
    walkSeconds50DU: 2.40 / 3,
    swimOnInkDU: distanceSecondsToDuPerFrame(3, 1.30),
    swimOffInkDU: distanceSecondsToDuPerFrame(3, 3.45),
  },
  '中量級': {
    walkSeconds50DU: 2.60 / 3,
    swimOnInkDU: distanceSecondsToDuPerFrame(3, 1.40),
    swimOffInkDU: distanceSecondsToDuPerFrame(3, 3.45),
  },
  '重量級': {
    walkSeconds50DU: 2.80 / 3,
    swimOnInkDU: distanceSecondsToDuPerFrame(3, 1.50),
    swimOffInkDU: distanceSecondsToDuPerFrame(3, 3.45),
  },
};
