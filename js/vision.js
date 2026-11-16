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

  function serializeModel(model) {
    return model.samples.map((s) => ({ label: s.label, v: Array.from(s.v) }));
  }

  function deserializeModel(arr) {
    return { samples: arr.map((s) => ({ label: s.label, v: Float32Array.from(s.v) })) };
  }

  global.JanggiVision = {
    gridPoint, boardToScreen, screenToBoard, extract, learn, read, validate,
    serializeModel, deserializeModel, cellSize,
  };
})(typeof window !== 'undefined' ? window : globalThis);
