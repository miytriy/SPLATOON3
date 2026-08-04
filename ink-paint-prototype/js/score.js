import { toLines } from './config.js';
import { coverageLayer, W, H } from './stage.js';

/* ==========================================================================
   score.js — 塗りポイント (paint points)
   --------------------------------------------------------------------------
   Real Splatoon's turf score is area-based: painting is only worth points
   the first time a given patch of floor turns your color; repainting ink
   you already own scores nothing further. We approximate that here by
   downscaling coverageLayer (wiki-exact shapes only, see stage.js's
   architecture note) to a cheap SAMPLE_W x SAMPLE_H grid, and on each tick
   comparing it against the PREVIOUS tick's painted mask: only pixels that
   just flipped from unpainted -> painted count as "new" area, so already-
   painted ground adds nothing even if a fresh splat lands on top of it.

   換算係数(POINTS_PER_LINE_SQUARED)について:
   以前はスプラシューターの公称「単発塗りポイント(4.0p)」から着弾塗り半径の
   平均値を使って面積を逆算し、そこから1ライン²あたりのpt数を導出していた。
   しかし今回、ユーザーがゲーム内で実際に計測した結果、スプラ3の塗り量は
   「ブキの単発塗りポイント」経由の推定に頼らずとも、ほぼ実面積に比例して
   いる可能性が高いという実測ベースの暫定値が得られたため、そちらに全面的
   に切り替える。
     1p ≒ 0.1265 ライン²　（1ライン² ≒ 7.9p、100ライン² ≒ 約790p）
   この値は「間を取った」暫定値であり、ユーザーの実測に基づくものの、まだ
   確定情報ではない（変更の可能性あり）。ブキ固有の単発塗りポイントを経由
   しないため、新しいブキを追加してもこの定数は一切調整不要になる。
   ========================================================================== */

const POINTS_PER_LINE_SQUARED = 1 / 0.1265; // 1p ≒ 0.1265 line²（実測・暫定値） ≒ 7.905 pt/line²

const SAMPLE_W = 100, SAMPLE_H = Math.round(SAMPLE_W * (H / W));
const LINE_AREA_PER_SAMPLE_PIXEL = toLines(W / 100) * toLines(H / Math.round(100 * (H / W)));

const sampleCanvas = document.createElement('canvas');
sampleCanvas.width = SAMPLE_W; sampleCanvas.height = SAMPLE_H;
const sctx = sampleCanvas.getContext('2d');

let prevSampleMask = new Uint8Array(SAMPLE_W * SAMPLE_H); // 0/1 painted-or-not from the previous tick
let totalPaintPoints = 0;

export function getTotalPaintPoints(){ return totalPaintPoints; }

export function resetScore(){
  totalPaintPoints = 0;
  prevSampleMask.fill(false);
}

export function tickPaintPoints(){
  sctx.clearRect(0, 0, SAMPLE_W, SAMPLE_H);
  sctx.drawImage(coverageLayer, 0, 0, SAMPLE_W, SAMPLE_H);
  const data = sctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
  let newlyPainted = 0;
  for (let i = 0, px = 0; i < data.length; i += 4, px++){
    const isPainted = data[i + 3] > 40 ? 1 : 0;
    if (isPainted && !prevSampleMask[px]) newlyPainted++;
    prevSampleMask[px] = isPainted;
  }
  totalPaintPoints += newlyPainted * LINE_AREA_PER_SAMPLE_PIXEL * POINTS_PER_LINE_SQUARED;
  return totalPaintPoints;
}

// 単発塗りポイントの上限を厳守するための共通ヘルパー。ブキ固有の公称値
// (nominalPoints — 例: スプラシューター4.0p、わかばシューター4.5p、
// リッター4Kはチャージ量で補間した値)は「1発で塗れる上限」を表す。
// tickPaintPoints()をその場で呼んで実面積比例の実測加算分(0以上)を求め、
// その実測値と公称値の小さい方だけを実際にtotalPaintPointsへ反映する:
//   - 新規面積が公称値以上 → 公称値で頭打ち
//   - 既に塗った場所ばかりで新規面積がほぼ0 → 実測値のまま(≒加算されない)
//   - 実測値・公称値のどちらも0以上なので、結果が負になることはない
// tickPaintPoints()自体は毎回prevSampleMaskを更新するので、ここで消費した
// 新規面積が後続の定期サンプリング(setInterval, ui.js側)で二重加算される
// こともない。シューター種(projectiles.js)・チャージャー種(charger.js)の
// どちらの着弾処理でもこのヘルパーを共通で使う。
export function creditCappedPaintPoints(nominalPoints){
  if (nominalPoints === undefined) return;
  const before = totalPaintPoints;
  tickPaintPoints();
  const areaBasedDelta = totalPaintPoints - before; // 常に0以上
  const credited = Math.min(areaBasedDelta, nominalPoints);
  totalPaintPoints = before + credited;
}
