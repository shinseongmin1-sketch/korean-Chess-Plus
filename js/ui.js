/*
 * 장기+ 화면 (SVG 판 그리기, 클릭 처리, AI 차례 진행)
 */
(function () {
  'use strict';

  const J = window.Janggi;
  const AI = window.JanggiAI;
  const NS = 'http://www.w3.org/2000/svg';
  const CELL = 60;
  const MARGIN = 40;
  const PIECE_R = { K: 27, R: 23, C: 23, H: 23, E: 23, A: 18, P: 18 };

  const $ = (id) => document.getElementById(id);
  const svg = $('board');

  const state = {
    game: null,
    mode: 'ai',
    humanSide: J.CHO,
    level: 'normal',
    flipped: false,
    selected: null,
    thinking: false,
    aiTimer: null,
  };

  const layers = {};

  function el(tag, attrs, parent) {
    const node = document.createElementNS(NS, tag);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }

  function toScreen(i) {
    let x = J.xOf(i);
    let y = J.yOf(i);
    if (state.flipped) {
      x = 8 - x;
      y = 9 - y;
    }
    return [MARGIN + x * CELL, MARGIN + y * CELL];
  }

  // ---------- 판 그리기 ----------

  function drawBase() {
    const base = el('g', { class: 'base' }, svg);
    el('rect', { x: 4, y: 4, width: 552, height: 612, rx: 14, class: 'board-bg' }, base);
    el('rect', { x: MARGIN, y: MARGIN, width: 8 * CELL, height: 9 * CELL, class: 'board-frame' }, base);
    for (let x = 0; x < 9; x++) {
      el('line', { x1: MARGIN + x * CELL, y1: MARGIN, x2: MARGIN + x * CELL, y2: MARGIN + 9 * CELL, class: 'grid' }, base);
    }
    for (let y = 0; y < 10; y++) {
      el('line', { x1: MARGIN, y1: MARGIN + y * CELL, x2: MARGIN + 8 * CELL, y2: MARGIN + y * CELL, class: 'grid' }, base);
    }
    // 궁성 대각선 (위아래 대칭이라 판을 돌려도 그대로)
    for (const top of [0, 7]) {
      const x1 = MARGIN + 3 * CELL;
      const x2 = MARGIN + 5 * CELL;
      const y1 = MARGIN + top * CELL;
      const y2 = MARGIN + (top + 2) * CELL;
      el('line', { x1, y1, x2, y2, class: 'grid palace' }, base);
      el('line', { x1: x2, y1, x2: x1, y2, class: 'grid palace' }, base);
    }
    layers.marks = el('g', { class: 'marks' }, svg);
    layers.pieces = el('g', { class: 'pieces' }, svg);
    layers.hints = el('g', { class: 'hints' }, svg);
  }

  function octagon(r) {
    const pts = [];
    for (let k = 0; k < 8; k++) {
      const a = ((k * 45 + 22.5) * Math.PI) / 180;
      pts.push(`${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`);
    }
    return pts.join(' ');
  }

  function drawPiece(p, i, fromIdx) {
    const r = PIECE_R[p[1]];
    const side = p[0] === J.CHO ? 'cho' : 'han';
    const g = el('g', { class: `piece ${side}` }, layers.pieces);
    const [sx, sy] = toScreen(i);
    if (fromIdx != null) {
      const [fx, fy] = toScreen(fromIdx);
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
    el('polygon', { points: octagon(r), class: 'piece-body' }, g);
    el('polygon', { points: octagon(r - 4), class: 'piece-inner' }, g);
    const t = el('text', { class: 'piece-label', 'font-size': Math.round(r * 1.05), y: 1 }, g);
    t.textContent = J.LABELS[p[0]][p[1]];
    return g;
  }

  function render(opts = {}) {
    const g = state.game;
    layers.marks.textContent = '';
    layers.pieces.textContent = '';
    layers.hints.textContent = '';

    // 마지막 수 표시
    const lm = g.lastMove;
    if (lm && !lm.pass) {
      const [fx, fy] = toScreen(lm.from);
      const [tx, ty] = toScreen(lm.to);
      el('circle', { cx: fx, cy: fy, r: 10, class: 'mark-from' }, layers.marks);
      el('circle', { cx: tx, cy: ty, r: 30, class: 'mark-to' }, layers.marks);
    }

    // 장군 표시
    if (g.inCheck && !g.result) {
      const k = J.findKing(g.board, g.turn);
      if (k >= 0) {
        const [kx, ky] = toScreen(k);
        el('circle', { cx: kx, cy: ky, r: 34, class: 'mark-check' }, layers.marks);
      }
    }

    // 선택한 말
    if (state.selected !== null) {
      const [sx, sy] = toScreen(state.selected);
      el('circle', { cx: sx, cy: sy, r: 31, class: 'mark-selected' }, layers.marks);
    }

    // 말
    const anim = opts.animate;
    g.board.forEach((p, i) => {
      if (p) drawPiece(p, i, anim && anim.to === i ? anim.from : null);
    });

    // 이동 가능한 곳
    if (state.selected !== null) {
      for (const to of g.movesFrom(state.selected)) {
        const [hx, hy] = toScreen(to);
        if (g.board[to]) el('circle', { cx: hx, cy: hy, r: 29, class: 'hint-capture' }, layers.hints);
        else el('circle', { cx: hx, cy: hy, r: 9, class: 'hint-move' }, layers.hints);
      }
    }

    renderPanel();
  }

  // ---------- 옆 패널 ----------

  function sideLabel(side) {
    const name = J.SIDE_NAMES[side];
    if (state.mode !== 'ai') return name;
    return side === state.humanSide ? `${name}(나)` : `${name}(AI)`;
  }

  function statusText() {
    const g = state.game;
    if (g.result) {
      if (!g.result.winner) return `무승부 — ${g.result.reason}`;
      return `${sideLabel(g.result.winner)} 승리! — ${g.result.reason}`;
    }
    if (state.thinking) return 'AI가 수를 생각하고 있어요…';
    const who = sideLabel(g.turn);
    if (g.inCheck) return `장군! ${who} 차례 — 궁을 지키세요`;
    if (g.bikjang) return `빅장! ${who} 차례 — 풀지 않으면 무승부`;
    if (g.legal.length === 0) return `${who} 차례 — 둘 수가 없어요. 한수쉼을 눌러주세요`;
    return `${who} 차례`;
  }

  function isHumanTurn() {
    return state.mode === 'pvp' || state.game.turn === state.humanSide;
  }

  function renderPanel() {
    const g = state.game;
    const status = $('status');
    status.textContent = statusText();
    status.className = 'status';
    if (g.result) status.classList.add('over');
    else if (g.inCheck) status.classList.add('check');
    else status.classList.add(g.turn === J.CHO ? 'turn-cho' : 'turn-han');

    for (const side of [J.CHO, J.HAN]) {
      $(`score-${side}`).textContent = `${g.score(side)}점`;
      $(`who-${side}`).textContent = state.mode === 'ai' ? (side === state.humanSide ? '나' : 'AI') : '';
      $(`player-${side}`).classList.toggle('active', !g.result && g.turn === side);
      const cap = $(`cap-${side}`);
      cap.textContent = '';
      for (const p of g.captured[side]) {
        const s = document.createElement('span');
        s.className = `cap ${p[0] === J.CHO ? 'cho' : 'han'}`;
        s.textContent = J.LABELS[p[0]][p[1]];
        cap.appendChild(s);
      }
    }

    // 플레이어 순서: 화면 아래쪽 진영을 아래에
    const players = document.querySelector('.players');
    const bottomSide = state.flipped ? J.HAN : J.CHO;
    players.appendChild($(`player-${J.other(bottomSide)}`));
    players.appendChild($(`player-${bottomSide}`));

    const busy = state.thinking;
    $('btn-undo').disabled = busy || g.history.length === 0;
    $('btn-pass').disabled = busy || !g.canPass() || !isHumanTurn();
    $('btn-resign').disabled = busy || !!g.result;

    const log = $('log');
    log.textContent = '';
    g.log.forEach((line) => {
      const li = document.createElement('li');
      li.textContent = line;
      log.appendChild(li);
    });
    log.scrollTop = log.scrollHeight;

    const banner = $('banner');
    if (g.result) {
      $('banner-text').textContent = statusText();
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }
  }

  // ---------- 조작 ----------

  function squareFromEvent(e) {
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
    if (state.flipped) {
      gx = 8 - gx;
      gy = 9 - gy;
    }
    return J.idx(gx, gy);
  }

  function onSquare(i) {
    const g = state.game;
    if (state.thinking || g.result || !isHumanTurn()) return;
    if (state.selected !== null && g.canMove(state.selected, i)) {
      doMove(state.selected, i);
      return;
    }
    const p = g.board[i];
    if (p && p[0] === g.turn) {
      state.selected = state.selected === i ? null : i;
    } else {
      state.selected = null;
    }
    render();
  }

  function doMove(from, to) {
    state.game.move(from, to);
    state.selected = null;
    render({ animate: { from, to } });
    maybeAI();
  }

  function maybeAI() {
    const g = state.game;
    if (state.mode !== 'ai' || g.result || g.turn === state.humanSide) return;
    state.thinking = true;
    renderPanel();
    state.aiTimer = setTimeout(() => {
      state.aiTimer = null;
      const mv = AI.bestMove(g.board, g.turn, state.level, g.bikjang);
      state.thinking = false;
      if (mv) {
        g.move(mv.from, mv.to);
        render({ animate: mv });
      } else {
        g.pass();
        render();
      }
    }, 300);
  }

  function stopAI() {
    if (state.aiTimer) clearTimeout(state.aiTimer);
    state.aiTimer = null;
    state.thinking = false;
  }

  function undo() {
    const g = state.game;
    if (state.thinking) return;
    if (state.mode === 'ai') {
      g.undo();
      while (g.history.length && g.turn !== state.humanSide) g.undo();
    } else {
      g.undo();
    }
    state.selected = null;
    render();
    maybeAI();
  }

  function newGame(opts) {
    stopAI();
    state.mode = opts.mode;
    state.humanSide = opts.side;
    state.level = opts.level;
    state.flipped = opts.mode === 'ai' && opts.side === J.HAN;
    state.selected = null;
    state.game = new J.Game({ choSetup: opts.choSetup, hanSetup: opts.hanSetup });
    render();
    maybeAI();
  }

  // ---------- 새 게임 창 ----------

  const dialog = $('new-game');
  const form = dialog.querySelector('form');

  function fillSetups() {
    for (const name of ['choSetup', 'hanSetup']) {
      const sel = form.elements[name];
      J.SETUPS.forEach((s) => {
        const o = document.createElement('option');
        o.value = s;
        o.textContent = s;
        sel.appendChild(o);
      });
    }
  }

  function syncAiFields() {
    const ai = form.elements.mode.value === 'ai';
    dialog.querySelectorAll('.ai-only').forEach((f) => { f.disabled = !ai; });
  }

  function openDialog() {
    syncAiFields();
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else startFromForm();
  }

  function startFromForm() {
    newGame({
      mode: form.elements.mode.value,
      side: form.elements.side.value,
      level: form.elements.level.value,
      choSetup: form.elements.choSetup.value,
      hanSetup: form.elements.hanSetup.value,
    });
  }

  form.addEventListener('change', syncAiFields);
  dialog.addEventListener('close', () => {
    if (dialog.returnValue === 'start') startFromForm();
  });

  // ---------- 시작 ----------

  drawBase();
  fillSetups();
  svg.addEventListener('click', (e) => {
    const i = squareFromEvent(e);
    if (i !== null) onSquare(i);
  });
  $('btn-new').addEventListener('click', openDialog);
  $('banner-new').addEventListener('click', openDialog);
  $('btn-undo').addEventListener('click', undo);
  $('btn-pass').addEventListener('click', () => {
    if (state.thinking || !isHumanTurn()) return;
    if (state.game.pass()) {
      state.selected = null;
      render();
      maybeAI();
    }
  });
  $('btn-flip').addEventListener('click', () => {
    state.flipped = !state.flipped;
    render();
  });
  $('btn-resign').addEventListener('click', () => {
    const g = state.game;
    if (state.thinking || g.result) return;
    const side = state.mode === 'ai' ? state.humanSide : g.turn;
    if (!confirm(`${J.SIDE_NAMES[side]}이(가) 기권할까요?`)) return;
    g.resign(side);
    state.selected = null;
    render();
  });

  startFromForm();
  openDialog();
})();
