/*
 * 장기+ 판 그리기 (대국 화면과 훈수 화면이 함께 사용)
 */
(function (global) {
  'use strict';

  const J = global.Janggi;
  const NS = 'http://www.w3.org/2000/svg';
  const CELL = 60;
  const MARGIN = 40;
  const PIECE_R = { K: 27, R: 23, C: 23, H: 23, E: 23, A: 18, P: 18 };
  let markerSeq = 0;

  function el(tag, attrs, parent) {
    const node = document.createElementNS(NS, tag);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }

  function octagon(r) {
    const pts = [];
    for (let k = 0; k < 8; k++) {
      const a = ((k * 45 + 22.5) * Math.PI) / 180;
      pts.push(`${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`);
    }
    return pts.join(' ');
  }

  // 말 하나를 (0,0) 기준으로 그린다. scale로 크기 조절
  function pieceGroup(p, parent, scale = 1) {
    const r = PIECE_R[p[1]] * scale;
    const g = el('g', { class: `piece ${p[0] === J.CHO ? 'cho' : 'han'}` }, parent);
    el('polygon', { points: octagon(r), class: 'piece-body' }, g);
    el('polygon', { points: octagon(r - 4 * scale), class: 'piece-inner' }, g);
    const t = el('text', { class: 'piece-label', 'font-size': Math.round(r * 1.05), y: 1 }, g);
    t.textContent = J.LABELS[p[0]][p[1]];
    return g;
  }

  // 화살표 머리 모양 정의
  function arrowMarker(svg, cls) {
    let defs = svg.querySelector('defs');
    if (!defs) defs = el('defs', {}, svg);
    const id = `arrowhead-${++markerSeq}`;
    const m = el('marker', {
      id, viewBox: '0 0 10 10', refX: 5, refY: 5,
      markerWidth: 3.2, markerHeight: 3.2, orient: 'auto-start-reverse',
    }, defs);
    el('path', { d: 'M0,0 L10,5 L0,10 z', class: cls }, m);
    return id;
  }

  // 두 점 사이에 화살표를 그린다 (양 끝을 조금 줄여서 말을 가리지 않게)
  function arrow(parent, x1, y1, x2, y2, markerId, cls, shrink) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const s = Math.min(shrink, len / 3);
    return el('line', {
      x1: x1 + (dx / len) * s, y1: y1 + (dy / len) * s,
      x2: x2 - (dx / len) * s, y2: y2 - (dy / len) * s,
      class: cls, 'marker-end': `url(#${markerId})`,
    }, parent);
  }

  function create(svg) {
    const view = { flipped: false, svg };

    const base = el('g', { class: 'base' }, svg);
    el('rect', { x: 4, y: 4, width: 552, height: 612, rx: 14, class: 'board-bg' }, base);
    el('rect', { x: MARGIN, y: MARGIN, width: 8 * CELL, height: 9 * CELL, class: 'board-frame' }, base);
    for (let x = 0; x < 9; x++) {
      el('line', { x1: MARGIN + x * CELL, y1: MARGIN, x2: MARGIN + x * CELL, y2: MARGIN + 9 * CELL, class: 'grid' }, base);
    }
    for (let y = 0; y < 10; y++) {
      el('line', { x1: MARGIN, y1: MARGIN + y * CELL, x2: MARGIN + 8 * CELL, y2: MARGIN + y * CELL, class: 'grid' }, base);
    }
    for (const top of [0, 7]) {
      const x1 = MARGIN + 3 * CELL;
      const x2 = MARGIN + 5 * CELL;
      const y1 = MARGIN + top * CELL;
      const y2 = MARGIN + (top + 2) * CELL;
      el('line', { x1, y1, x2, y2, class: 'grid palace' }, base);
      el('line', { x1: x2, y1, x2: x1, y2, class: 'grid palace' }, base);
    }
    const layers = {
      marks: el('g', { class: 'marks' }, svg),
      pieces: el('g', { class: 'pieces' }, svg),
      hints: el('g', { class: 'hints' }, svg),
      arrows: el('g', { class: 'arrows' }, svg),
    };
    const markerId = arrowMarker(svg, 'arrow-head');
    view.layers = layers;

    view.toScreen = (i) => {
      let x = J.xOf(i);
      let y = J.yOf(i);
      if (view.flipped) {
        x = 8 - x;
        y = 9 - y;
      }
      return [MARGIN + x * CELL, MARGIN + y * CELL];
    };

    view.clear = () => {
      for (const k in layers) layers[k].textContent = '';
    };

    view.circle = (layer, i, r, cls) => {
      const [x, y] = view.toScreen(i);
      return el('circle', { cx: x, cy: y, r, class: cls }, layers[layer]);
    };

    view.piece = (p, i, fromIdx) => {
      const g = pieceGroup(p, layers.pieces);
      const [sx, sy] = view.toScreen(i);
      if (fromIdx != null) {
        const [fx, fy] = view.toScreen(fromIdx);
        g.style.transition = 'none';
        g.style.transform = `translate(${fx}px, ${fy}px)`;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            g.style.transition = '';
            g.style.transform = `translate(${sx}px, ${sy}px)`;
          });
        });
      } else {
        g.style.transform = `translate(${sx}px, ${sy}px)`;
      }
      return g;
    };

    view.pieces = (board, anim) => {
      board.forEach((p, i) => {
        if (p) view.piece(p, i, anim && anim.to === i ? anim.from : null);
      });
    };

    view.arrow = (from, to) => {
      const [x1, y1] = view.toScreen(from);
      const [x2, y2] = view.toScreen(to);
      el('circle', { cx: x1, cy: y1, r: 31, class: 'arrow-from' }, layers.arrows);
      arrow(layers.arrows, x1, y1, x2, y2, markerId, 'arrow-line', 20);
    };

    view.squareFromEvent = (e) => {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const p = pt.matrixTransform(svg.getScreenCTM().inverse());
      let gx = Math.round((p.x - MARGIN) / CELL);
      let gy = Math.round((p.y - MARGIN) / CELL);
      if (gx < 0 || gx > 8 || gy < 0 || gy > 9) return null;
      const dx = p.x - (MARGIN + gx * CELL);
      const dy = p.y - (MARGIN + gy * CELL);
      if (dx * dx + dy * dy > (CELL * 0.5) ** 2) return null;
      if (view.flipped) {
        gx = 8 - gx;
        gy = 9 - gy;
      }
      return J.idx(gx, gy);
    };

    return view;
  }

  global.JanggiBoardView = { create, el, octagon, pieceGroup, arrowMarker, arrow, PIECE_R, CELL, MARGIN };
})(window);
