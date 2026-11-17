/*
 * 장기+ 화면 인식
 * 캡처한 장기 앱 화면에서 90개 교차점마다 작은 원 모양 영역을 떼어 내고,
 * 대국 시작 배치에서 익힌 견본(말 종류별, 빈칸)과 가장 비슷한 것을 고른다.
 *
 * calib: { x1, y1, x2, y2 } — 화면 기준 왼쪽 위 교차점과 오른쪽 아래 교차점의 픽셀 좌표
 * bottom: 화면 아래쪽에 있는 진영 ('c' 또는 'h')
 */
(function (global) {
  'use strict';

  const J = global.Janggi;
  const N = 12; // 영역 하나를 N×N 점으로 샘플링 (원 안쪽만 사용)
  const EMPTY = '.';

  function cellSize(calib) {
    return [(calib.x2 - calib.x1) / 8, (calib.y2 - calib.y1) / 9];
  }

  // 화면 격자 좌표(gx 0~8, gy 0~9) → 픽셀 좌표
  function gridPoint(calib, gx, gy) {
    const [cw, ch] = cellSize(calib);
    return [calib.x1 + gx * cw, calib.y1 + gy * ch];
  }

  // 판 칸 번호 → 화면 격자 좌표
  function boardToScreen(i, bottom) {
    const x = J.xOf(i);
    const y = J.yOf(i);
    return bottom === J.CHO ? [x, y] : [8 - x, 9 - y];
  }

  function screenToBoard(gx, gy, bottom) {
    return bottom === J.CHO ? J.idx(gx, gy) : J.idx(8 - gx, 9 - gy);
  }

  function extract(img, calib, gx, gy) {
    const [cw, ch] = cellSize(calib);
    const r = 0.4 * Math.min(cw, ch);
    const [cx, cy] = gridPoint(calib, gx, gy);
    const { data, width, height } = img;
    const v = [];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const u = ((i + 0.5) / N) * 2 - 1;
        const w = ((j + 0.5) / N) * 2 - 1;
        if (u * u + w * w > 1) continue;
        const px = Math.min(width - 1, Math.max(0, Math.round(cx + u * r)));
        const py = Math.min(height - 1, Math.max(0, Math.round(cy + w * r)));
        const o = (py * width + px) * 4;
        v.push(data[o], data[o + 1], data[o + 2]);
      }
    }
    return Float32Array.from(v);
  }

  function dist(a, b) {
    let s = 0;
    for (let k = 0; k < a.length; k++) {
      const d = a[k] - b[k];
      s += d * d;
    }
    return s;
  }

  /**
   * 대국 시작 화면에서 말 모양을 익힌다
   */
  function learn(img, calib, bottom, choSetup, hanSetup) {
    const start = J.initialBoard(choSetup, hanSetup);
    const samples = [];
    for (let gy = 0; gy < 10; gy++) {
      for (let gx = 0; gx < 9; gx++) {
        const p = start[screenToBoard(gx, gy, bottom)];
        samples.push({ label: p || EMPTY, v: extract(img, calib, gx, gy) });
      }
    }
    return { samples };
  }

  /**
   * 현재 화면을 읽어 판(칸 번호 기준 배열)을 돌려준다
   */
  function read(img, calib, bottom, model) {
    const board = new Array(90).fill(null);
    let worst = 0;
    for (let gy = 0; gy < 10; gy++) {
      for (let gx = 0; gx < 9; gx++) {
        const v = extract(img, calib, gx, gy);
        let best = Infinity;
        let label = EMPTY;
        for (const s of model.samples) {
          const d = dist(v, s.v);
          if (d < best) {
            best = d;
            label = s.label;
          }
        }
        worst = Math.max(worst, best / v.length);
        board[screenToBoard(gx, gy, bottom)] = label === EMPTY ? null : label;
      }
    }
    return { board, worst };
  }

  // 인식 결과가 장기판으로 말이 되는지 간단히 확인
  function validate(board) {
    const count = {};
    for (const p of board) if (p) count[p] = (count[p] || 0) + 1;
    if (count.cK !== 1 || count.hK !== 1) return '궁을 찾지 못했어요';
    const max = { R: 2, C: 2, H: 2, E: 2, A: 2, P: 5 };
    for (const side of [J.CHO, J.HAN]) {
      for (const t in max) {
        if ((count[side + t] || 0) > max[t]) return '같은 말이 너무 많이 보여요';
      }
    }
    for (const side of [J.CHO, J.HAN]) {
      const k = J.findKing(board, side);
      if (!J.inPalace(J.xOf(k), J.yOf(k))) return '궁이 궁성 밖에 있어요';
    }
    return null;
  }

  // ---------- 자동 인식: 판 위치 찾기 ----------

  function luminance(img) {
    const { data } = img;
    const g = new Float32Array(img.width * img.height);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) {
      g[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
    }
    return g;
  }

  // 가는 어두운 선의 세기를 세로줄(cols)·가로줄(rows)별로 더한다 (진한 선일수록 크게)
  function lineProfiles(g, W, H, k, x0, x1, y0, y1) {
    const cols = new Float32Array(W);
    const rows = new Float32Array(H);
    const T = 25;
    const xa = Math.max(k, Math.floor(x0));
    const xb = Math.min(W - k, Math.ceil(x1));
    const ya = Math.max(k, Math.floor(y0));
    const yb = Math.min(H - k, Math.ceil(y1));
    const kW = k * W;
    for (let y = ya; y < yb; y++) {
      const row = y * W;
      for (let x = xa; x < xb; x++) {
        const i = row + x;
        const c = g[i];
        const dv = Math.min(g[i - k], g[i + k]) - c;
        if (dv > T) cols[x] += Math.min(dv, 120);
        const dh = Math.min(g[i - kW], g[i + kW]) - c;
        if (dh > T) rows[y] += Math.min(dh, 120);
      }
    }
    return { cols, rows };
  }

  // 판 안쪽 선 세기에서, 판 바깥으로 이어지는 선(화면의 다른 테두리 등)을 빼준다
  function insideMinusOutside(g, W, H, k, axis, lo, hi, s) {
    const span = hi - lo;
    const margin = [0.2 * s, 0.45 * s];
    const outW = margin[1] - margin[0];
    if (axis === 'rows') {
      const inside = lineProfiles(g, W, H, k, lo, hi, 0, H).rows;
      const o1 = lineProfiles(g, W, H, k, lo - margin[1], lo - margin[0], 0, H).rows;
      const o2 = lineProfiles(g, W, H, k, hi + margin[0], hi + margin[1], 0, H).rows;
      const ratio = span / (2 * outW);
      return inside.map((v, i) => Math.max(0, v - ratio * (o1[i] + o2[i])));
    }
    const inside = lineProfiles(g, W, H, k, 0, W, lo, hi).cols;
    const o1 = lineProfiles(g, W, H, k, 0, W, lo - margin[1], lo - margin[0]).cols;
    const o2 = lineProfiles(g, W, H, k, 0, W, hi + margin[0], hi + margin[1]).cols;
    const ratio = span / (2 * outW);
    return inside.map((v, i) => Math.max(0, v - ratio * (o1[i] + o2[i])));
  }

  // 같은 간격으로 n개 늘어선 선을 찾는다
  function fitLines(P, n, minS, maxS) {
    const L = P.length;
    const S = new Float32Array(L);
    let mx = 0;
    for (let i = 0; i < L; i++) {
      let m = 0;
      for (let d = -2; d <= 2; d++) {
        const j = i + d;
        if (j >= 0 && j < L && P[j] > m) m = P[j];
      }
      S[i] = m;
      if (m > mx) mx = m;
    }
    if (mx <= 0) return null;
    const peaks = [];
    for (let i = 1; i < L - 1; i++) {
      if (P[i] >= 0.15 * mx && P[i] >= P[i - 1] && P[i] > P[i + 1]) peaks.push(i);
    }
    peaks.sort((a, b) => P[b] - P[a]);
    peaks.length = Math.min(peaks.length, 80);
    let best = null;
    for (const a of peaks) {
      for (const b of peaks) {
        if (b <= a) continue;
        const s = (b - a) / (n - 1);
        if (s < minS || s > maxS) continue;
        let sum = 0;
        let mn = Infinity;
        for (let k = 0; k < n; k++) {
          const v = S[Math.round(a + k * s)];
          sum += v;
          if (v < mn) mn = v;
        }
        const score = sum + n * mn;
        if (!best || score > best.score) best = { a, b, s, score, mn };
      }
    }
    return best;
  }

  /**
   * 화면 전체에서 장기판(세로선 9개, 가로선 10개)을 찾는다. 못 찾으면 null
   */
  function detectGrid(img) {
    const W = img.width;
    const H = img.height;
    const g = luminance(img);
    const k = Math.max(2, Math.round(Math.min(W, H) / 260));
    const p = lineProfiles(g, W, H, k, 0, W, 0, H);
    let cx = fitLines(p.cols, 9, W / 45, W / 8);
    let cy = fitLines(p.rows, 10, H / 80, H / 9);
    if (!cx || !cy) return null;
    for (let it = 0; it < 4; it++) {
      const rowsP = insideMinusOutside(g, W, H, k, 'rows', cx.a, cx.b, cx.s);
      const colsP = insideMinusOutside(g, W, H, k, 'cols', cy.a, cy.b, cy.s);
      const ny = fitLines(rowsP, 10, cx.s * 0.7, cx.s * 1.4);
      const nx = fitLines(colsP, 9, cy.s * 0.7, cy.s * 1.4);
      if (!nx || !ny) return null;
      const same = nx.a === cx.a && nx.b === cx.b && ny.a === cy.a && ny.b === cy.b;
      cx = nx;
      cy = ny;
      if (same) break;
    }
    const ratio = cx.s / cy.s;
    if (ratio < 0.75 || ratio > 1.33) return null;
    // 모든 선이 어느 정도 보여야 진짜 장기판 (첫 배치에서는 바깥 선이 말에 많이 가려진다)
    const lineMin = 25 * 0.2;
    if (cx.mn < lineMin * (cy.b - cy.a) || cy.mn < lineMin * (cx.b - cx.a)) return null;
    return { x1: cx.a, y1: cy.a, x2: cx.b, y2: cy.b };
  }

  // ---------- 자동 인식: 첫 배치 알아보기 ----------

  function pixel(img, x, y) {
    const px = Math.min(img.width - 1, Math.max(0, Math.round(x)));
    const py = Math.min(img.height - 1, Math.max(0, Math.round(y)));
    const o = (py * img.width + px) * 4;
    return [img.data[o], img.data[o + 1], img.data[o + 2]];
  }

  // 원 안쪽을 n×n 점으로 훑는다
  function eachInCircle(img, cx, cy, r, n, fn) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const u = ((i + 0.5) / n) * 2 - 1;
        const w = ((j + 0.5) / n) * 2 - 1;
        if (u * u + w * w > 1) continue;
        fn(pixel(img, cx + u * r, cy + w * r));
      }
    }
  }

  const colorDist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

  // 판 바탕색: 칸 한가운데(말이 닿지 않는 곳) 색의 중앙값
  function woodColor(img, calib) {
    const [cw, ch] = cellSize(calib);
    const rs = [];
    const gs = [];
    const bs = [];
    for (let gy = 0; gy < 9; gy++) {
      for (let gx = 0; gx < 8; gx++) {
        const p = pixel(img, calib.x1 + (gx + 0.5) * cw, calib.y1 + (gy + 0.5) * ch);
        rs.push(p[0]);
        gs.push(p[1]);
        bs.push(p[2]);
      }
    }
    const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
    return [med(rs), med(gs), med(bs)];
  }

  // 교차점에 말이 있을 가능성 (바탕색과 다른 점의 비율)
  function pieceness(img, calib, gx, gy, wood) {
    const [cw, ch] = cellSize(calib);
    const [cx, cy] = gridPoint(calib, gx, gy);
    let diff = 0;
    let total = 0;
    eachInCircle(img, cx, cy, 0.32 * Math.min(cw, ch), 10, (p) => {
      total++;
      if (colorDist(p, wood) > 60) diff++;
    });
    return diff / total;
  }

  // 첫 배치에서 말이 있는 화면 칸 (초가 아래든 한이 아래든 같은 모양)
  const START_SQUARES = (() => {
    const b = J.initialBoard();
    const s = new Set();
    b.forEach((p, i) => { if (p) s.add(i); });
    return s;
  })();

  function isStartPosition(img, calib) {
    const wood = woodColor(img, calib);
    const scores = [];
    for (let gy = 0; gy < 10; gy++) {
      for (let gx = 0; gx < 9; gx++) scores.push({ i: J.idx(gx, gy), v: pieceness(img, calib, gx, gy, wood) });
    }
    scores.sort((a, b) => b.v - a.v);
    for (let k = 0; k < 32; k++) if (!START_SQUARES.has(scores[k].i)) return false;
    return scores[31].v - scores[32].v > 0.08;
  }

  // 아래쪽 말들이 더 빨가면 아래가 한
  function detectBottom(img, calib) {
    const wood = woodColor(img, calib);
    const [cw, ch] = cellSize(calib);
    const red = [0, 0];
    const cnt = [0, 0];
    START_SQUARES.forEach((i) => {
      const gx = J.xOf(i);
      const gy = J.yOf(i);
      const half = gy >= 5 ? 1 : 0;
      const [cx, cy] = gridPoint(calib, gx, gy);
      eachInCircle(img, cx, cy, 0.35 * Math.min(cw, ch), 10, (p) => {
        if (colorDist(p, wood) <= 60) return;
        red[half] += p[0] - (p[1] + p[2]) / 2;
        cnt[half]++;
      });
    });
    const top = red[0] / Math.max(1, cnt[0]);
    const bottom = red[1] / Math.max(1, cnt[1]);
    return bottom > top ? J.HAN : J.CHO;
  }

  // 밝기만 본 무늬 (평균 0, 표준편차 1로 맞춤). 뒤집어 비교하려면 배열을 거꾸로 하면 된다
  function zscore(v) {
    let m = 0;
    for (const x of v) m += x;
    m /= v.length;
    let s = 0;
    for (const x of v) s += (x - m) ** 2;
    s = Math.sqrt(s / v.length) || 1;
    return v.map((x) => (x - m) / s);
  }

  const GLYPH_N = 16;

  function inkVector(img, calib, gx, gy) {
    const [cw, ch] = cellSize(calib);
    const [cx, cy] = gridPoint(calib, gx, gy);
    const v = [];
    eachInCircle(img, cx, cy, 0.4 * Math.min(cw, ch), GLYPH_N, (p) => {
      v.push(0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]);
    });
    return zscore(v);
  }

  function corr(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s / a.length;
  }

  // 위아래가 뒤집혀 그려지는 앱도 있으니 둘 중 더 비슷한 쪽
  function sim(a, b) {
    return Math.max(corr(a, b), corr(a, b.slice().reverse()));
  }

  let glyphRefs = null;
  function getGlyphRefs() {
    if (glyphRefs) return glyphRefs;
    const D = 64;
    const c = document.createElement('canvas');
    c.width = D;
    c.height = D;
    const x = c.getContext('2d', { willReadFrequently: true });
    const make = (ch, scale) => {
      x.fillStyle = '#fff';
      x.fillRect(0, 0, D, D);
      x.fillStyle = '#000';
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.font = `bold ${Math.round(D * scale)}px "Noto Serif KR", "Batang", "Songti SC", "SimSun", serif`;
      x.fillText(ch, D / 2, D / 2 + 1);
      const img = x.getImageData(0, 0, D, D);
      const v = [];
      eachInCircle(img, D / 2, D / 2, D / 2, GLYPH_N, (p) => v.push(p[0]));
      return zscore(v);
    };
    const scales = [0.55, 0.7, 0.85];
    glyphRefs = {
      H: ['馬', '마'].flatMap((ch) => scales.map((s) => make(ch, s))),
      E: ['象', '상'].flatMap((ch) => scales.map((s) => make(ch, s))),
    };
    return glyphRefs;
  }

  /**
   * 첫 배치 화면에서 마·상 차림을 알아낸다.
   * 1) 같은 쪽 네 말 중 서로 닮은 둘씩 짝을 짓고  2) 위아래 짝을 맞춘 뒤
   * 3) 글자 모양이 '馬'에 더 가까운 무리를 마로 정한다 (틀리면 실제 움직임을 보고 나중에 고친다)
   */
  function detectSetups(img, calib, bottom) {
    const bv = [1, 2, 6, 7].map((x) => inkVector(img, calib, x, 9));
    const tv = [7, 6, 2, 1].map((x) => inkVector(img, calib, x, 0));
    const pairing = (v) => (sim(v[0], v[2]) + sim(v[1], v[3]) >= sim(v[0], v[3]) + sim(v[1], v[2])
      ? [[0, 2], [1, 3]] : [[0, 3], [1, 2]]);
    const pb = pairing(bv);
    const pt = pairing(tv);
    const gsim = (va, ia, vb, ib) => {
      let s = 0;
      for (const a of ia) for (const b of ib) s += sim(va[a], vb[b]);
      return s / (ia.length * ib.length);
    };
    const same = gsim(bv, pb[0], tv, pt[0]) + gsim(bv, pb[1], tv, pt[1]);
    const cross = gsim(bv, pb[0], tv, pt[1]) + gsim(bv, pb[1], tv, pt[0]);
    const tMatch = same >= cross ? pt : [pt[1], pt[0]];

    const refs = getGlyphRefs();
    const horseLike = (v) => Math.max(...refs.H.map((r) => sim(v, r))) - Math.max(...refs.E.map((r) => sim(v, r)));
    const groupScore = (k) => {
      const vs = pb[k].map((i) => bv[i]).concat(tMatch[k].map((i) => tv[i]));
      return vs.reduce((s, v) => s + horseLike(v), 0) / vs.length;
    };
    const horseGroup = groupScore(0) >= groupScore(1) ? 0 : 1;
    const letters = (idx) => {
      const l = ['상', '상', '상', '상'];
      for (const i of idx) l[i] = '마';
      return l.join('');
    };
    const bottomSetup = letters(pb[horseGroup]);
    const topSetup = letters(tMatch[horseGroup]);
    return bottom === J.CHO
      ? { choSetup: bottomSetup, hanSetup: topSetup }
      : { choSetup: topSetup, hanSetup: bottomSetup };
  }

  // 마↔상 이름표를 바꾼다 (실제 움직임이 반대였을 때)
  function swapHorseElephant(model, side) {
    for (const s of model.samples) {
      if (s.label === side + 'H') s.label = side + 'E';
      else if (s.label === side + 'E') s.label = side + 'H';
    }
  }

  function serializeModel(model) {
    return model.samples.map((s) => ({ label: s.label, v: Array.from(s.v) }));
  }

  function deserializeModel(arr) {
    return { samples: arr.map((s) => ({ label: s.label, v: Float32Array.from(s.v) })) };
  }

  global.JanggiVision = {
    gridPoint, boardToScreen, screenToBoard, extract, learn, read, validate,
    serializeModel, deserializeModel, cellSize,
    detectGrid, isStartPosition, detectBottom, detectSetups, swapHorseElephant,
  };
})(typeof window !== 'undefined' ? window : globalThis);
