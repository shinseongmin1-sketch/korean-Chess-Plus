/*
 * 장기+ 훈수 모드
 * 화면 공유(또는 이미지)로 받은 장기 앱 화면에서 판과 말을 자동으로 읽고,
 * 추천 수를 화살표로 보여준다.
 */
(function () {
  'use strict';

  const J = window.Janggi;
  const AI = window.JanggiAI;
  const BV = window.JanggiBoardView;
  const V = window.JanggiVision;
  const STORE_KEY = 'janggi-plus-advisor-v2';

  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const video = $('video');
  const image = $('image');
  const overlay = $('overlay');
  const mirrorView = BV.create($('mirror'));

  const state = {
    src: null, // { kind, el, w, h }
    calib: null,
    calibManual: false,
    calibStep: null, // 'tl' | 'br'
    calibTmp: null,
    model: null,
    confirmed: { c: false, h: false }, // 마·상 구분을 실제 움직임으로 확인했는지
    bottom: J.CHO,
    choSetup: J.SETUPS[0],
    hanSetup: J.SETUPS[0],
    board: null,
    boardKey: '',
    candKey: '',
    candCount: 0,
    failCount: 0,
    tick: 0,
    lastMove: null,
    turn: J.CHO,
    hint: null,
    hintToken: 0,
    level: 'hard',
    viewMode: 'side',
    opacity: 0.35,
    timer: null,
    warn: '',
    notice: '',
  };

  // ---------- 저장 / 불러오기 ----------

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        bottom: state.bottom,
        choSetup: state.choSetup,
        hanSetup: state.hanSetup,
        model: state.model ? V.serializeModel(state.model) : null,
        confirmed: state.confirmed,
        viewMode: state.viewMode,
        opacity: state.opacity,
        level: state.level,
      }));
    } catch (e) { /* 저장할 수 없는 환경이면 무시 */ }
  }

  function load() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    } catch (e) {
      saved = null;
    }
    if (!saved) return;
    state.bottom = saved.bottom || J.CHO;
    state.choSetup = saved.choSetup || J.SETUPS[0];
    state.hanSetup = saved.hanSetup || J.SETUPS[0];
    state.viewMode = saved.viewMode || 'side';
    state.opacity = typeof saved.opacity === 'number' ? saved.opacity : 0.35;
    state.level = saved.level || 'hard';
    if (saved.model) state.model = V.deserializeModel(saved.model);
    if (saved.confirmed) state.confirmed = saved.confirmed;
  }

  // ---------- 상태 표시 ----------

  function setStatus(text, kind) {
    const s = $('adv-status');
    s.textContent = text;
    s.className = 'status' + (kind ? ` ${kind}` : '');
  }

  function guide() {
    if (!state.src) return setStatus('1단계: 핸드폰 화면을 연결해 주세요');
    if (state.calibStep === 'tl') return setStatus('장기판 왼쪽 위 꼭짓점(선이 만나는 점)을 클릭하세요', 'turn-han');
    if (state.calibStep === 'br') return setStatus('이제 오른쪽 아래 꼭짓점을 클릭하세요', 'turn-han');
    if (state.notice) return setStatus(state.notice, 'turn-cho');
    if (!state.calib) return setStatus('장기판을 찾고 있어요… 장기 앱 화면이 보이게 해주세요');
    if (!state.model) return setStatus('새 대국을 시작해 주세요. 첫 배치 화면에서 말 모양을 자동으로 익혀요');
    if (state.warn) return setStatus(`판을 읽는 중… (${state.warn})`, 'check');
    if (!state.board) return setStatus('판을 읽는 중…');
    return setStatus(`인식 중 — ${J.SIDE_NAMES[state.turn]} 차례`, state.turn === J.CHO ? 'turn-cho' : 'turn-han');
  }

  // 잠깐 보여줄 안내 (몇 초 뒤 원래 상태 표시로 돌아감)
  let noticeTimer = null;
  function notify(text) {
    state.notice = text;
    guide();
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      state.notice = '';
      guide();
    }, 4000);
  }

  function setInfo(id, text, ok) {
    const d = $(id);
    d.textContent = text;
    d.className = ok ? 'ok' : 'wait';
  }

  function renderInfo() {
    setInfo('info-grid', state.calib ? (state.calibManual ? '직접 지정함' : '찾음') : '찾는 중…', !!state.calib);
    setInfo('info-model', state.model ? '익힘' : '첫 배치 화면을 기다리는 중', !!state.model);
    setInfo('info-bottom', state.model ? J.SIDE_NAMES[state.bottom] : '—', !!state.model);
    const mark = (side) => (state.confirmed[side] ? '' : '?');
    setInfo('info-setup', state.model
      ? `초 ${state.choSetup}${mark(J.CHO)} · 한 ${state.hanSetup}${mark(J.HAN)}`
      : '—', !!state.model);
    $('sel-bottom').value = state.bottom;
    $('sel-cho').value = state.choSetup;
    $('sel-han').value = state.hanSetup;
  }

  // ---------- 화면 소스 ----------

  function setSource(kind, el, w, h) {
    const sameSize = state.src && state.src.w === w && state.src.h === h;
    state.src = { kind, el, w, h };
    video.hidden = kind !== 'video';
    image.hidden = kind !== 'image';
    stage.classList.remove('empty');
    overlay.setAttribute('viewBox', `0 0 ${w} ${h}`);
    if (!sameSize) {
      state.calib = null;
      state.calibManual = false;
    }
    state.boardKey = '';
    state.candKey = '';
    state.failCount = 0;
    startLoop();
    renderAll();
  }

  async function startCapture() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      setStatus('이 브라우저는 화면 공유를 지원하지 않아요. PC의 크롬이나 엣지에서 열어주세요', 'check');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 10 }, audio: false });
      video.srcObject = stream;
      await video.play();
      if (!video.videoWidth) await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }));
      setSource('video', video, video.videoWidth, video.videoHeight);
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        stopLoop();
        setStatus('화면 연결이 끊겼어요. 다시 연결해 주세요', 'check');
      });
    } catch (e) {
      setStatus('화면 연결이 취소됐어요', 'check');
    }
  }

  function openImage(file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    image.onload = () => {
      setSource('image', image, image.naturalWidth, image.naturalHeight);
      process();
    };
    image.src = url;
  }

  // ---------- 화면 읽기 ----------

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // 영상 크기가 바뀌었으면 판 위치도 같은 비율로 옮긴다
  function syncVideoSize() {
    const src = state.src;
    if (!src || src.kind !== 'video') return true;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return false;
    if (w !== src.w || h !== src.h) {
      if (state.calib) {
        const sx = w / src.w;
        const sy = h / src.h;
        const c = state.calib;
        state.calib = { x1: c.x1 * sx, y1: c.y1 * sy, x2: c.x2 * sx, y2: c.y2 * sy };
      }
      src.w = w;
      src.h = h;
      overlay.setAttribute('viewBox', `0 0 ${w} ${h}`);
    }
    return true;
  }

  // 화면 전체 (판 찾기용, 너무 크면 줄여서)
  function grabFull() {
    const src = state.src;
    if (!src || !syncVideoSize()) return null;
    const scale = Math.min(1, 1600 / Math.max(src.w, src.h));
    const w = Math.round(src.w * scale);
    const h = Math.round(src.h * scale);
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(src.el, 0, 0, w, h);
    return { img: ctx.getImageData(0, 0, w, h), scale };
  }

  // 판 주변만 잘라서 읽는다 (빠르게)
  function grab() {
    const src = state.src;
    if (!src || !state.calib || !syncVideoSize()) return null;
    const c = state.calib;
    const [cw, ch] = V.cellSize(c);
    const left = Math.max(0, Math.floor(c.x1 - cw));
    const top = Math.max(0, Math.floor(c.y1 - ch));
    const right = Math.min(src.w, Math.ceil(c.x2 + cw));
    const bottom = Math.min(src.h, Math.ceil(c.y2 + ch));
    const w = Math.max(1, right - left);
    const h = Math.max(1, bottom - top);
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(src.el, left, top, w, h, 0, 0, w, h);
    return {
      img: ctx.getImageData(0, 0, w, h),
      calib: { x1: c.x1 - left, y1: c.y1 - top, x2: c.x2 - left, y2: c.y2 - top },
    };
  }

  function autoGrid() {
    const f = grabFull();
    if (!f) return false;
    const g = V.detectGrid(f.img);
    if (!g) return false;
    const s = f.scale;
    state.calib = { x1: g.x1 / s, y1: g.y1 / s, x2: g.x2 / s, y2: g.y2 / s };
    state.calibManual = false;
    state.boardKey = '';
    renderAll();
    return true;
  }

  const boardKeyOf = (b) => b.map((p) => p || '').join(',');

  function startKey() {
    return boardKeyOf(J.initialBoard(state.choSetup, state.hanSetup));
  }

  function learnFrom(f, bottom, choSetup, hanSetup) {
    state.bottom = bottom;
    state.choSetup = choSetup;
    state.hanSetup = hanSetup;
    state.model = V.learn(f.img, f.calib, bottom, choSetup, hanSetup);
    state.board = null;
    state.boardKey = '';
    state.lastMove = null;
    state.turn = J.CHO;
    save();
    accept(J.initialBoard(choSetup, hanSetup));
  }

  function autoLearn(f) {
    const bottom = V.detectBottom(f.img, f.calib);
    const s = V.detectSetups(f.img, f.calib, bottom);
    state.confirmed = { c: false, h: false };
    learnFrom(f, bottom, s.choSetup, s.hanSetup);
    notify(`말 모양을 익혔어요! 아래쪽은 ${J.SIDE_NAMES[bottom]}이에요. 대국을 진행하세요`);
  }

  function process() {
    if (!state.src || state.calibStep) return;
    state.tick++;

    if (!state.calib) {
      // 판 찾기는 무거워서 영상일 때는 1초에 한 번만
      if (state.src.kind === 'video' && state.tick % 2) return;
      if (!autoGrid()) {
        guide();
        return;
      }
    }

    const f = grab();
    if (!f) return;
    const start = V.isStartPosition(f.img, f.calib);

    if (!state.model) {
      if (start) autoLearn(f);
      else guide();
      return;
    }

    const r = V.read(f.img, f.calib, state.bottom, state.model);
    const key = boardKeyOf(r.board);

    // 새 대국의 첫 배치인데 지금 익힌 모양으로 읽은 결과가 첫 배치가 아니면 (차림이나 진영이 바뀜) 다시 익힌다
    if (start && key !== startKey()) {
      const ok = V.validate(r.board) === null;
      const isAnyStart = ok && J.SETUPS.some((a) => J.SETUPS.some((b) => key === boardKeyOf(J.initialBoard(a, b))));
      if (!isAnyStart) {
        autoLearn(f);
        return;
      }
    }

    const err = V.validate(r.board);
    if (err) {
      state.failCount++;
      if (state.warn !== err) {
        state.warn = err;
        guide();
      }
      // 계속 못 읽으면 판 위치를 다시 찾아본다 (창을 옮겼거나 크기를 바꾼 경우)
      if (!state.calibManual && state.failCount % 10 === 0) {
        state.calib = null;
        renderAll();
      }
      return;
    }
    state.failCount = 0;
    if (state.warn) {
      state.warn = '';
      guide();
    }
    if (key === state.boardKey) {
      state.candKey = '';
      return;
    }
    if (key === state.candKey) state.candCount++;
    else {
      state.candKey = key;
      state.candCount = 1;
    }
    // 영상은 두 번 연속 같은 결과가 나와야 확정 (말이 움직이는 도중 화면 무시)
    if (state.candCount >= (state.src.kind === 'image' ? 1 : 2)) accept(r.board);
  }

  // 마·상이 실제로 움직인 모양을 보고 이름표가 맞는지 확인한다. 고친 진영 목록을 돌려준다
  function checkHorseElephant(piece, from, to) {
    const side = piece[0];
    const ax = Math.abs(J.xOf(to) - J.xOf(from));
    const ay = Math.abs(J.yOf(to) - J.yOf(from));
    const horseMove = (ax === 1 && ay === 2) || (ax === 2 && ay === 1);
    const elephantMove = (ax === 2 && ay === 3) || (ax === 3 && ay === 2);
    if (!horseMove && !elephantMove) return null;
    const wrong = (piece[1] === 'H' && elephantMove) || (piece[1] === 'E' && horseMove);
    if (!wrong) {
      if (!state.confirmed[side]) {
        state.confirmed[side] = true;
        save();
      }
      return null;
    }
    const sides = [side];
    const other = J.other(side);
    if (!state.confirmed[other]) sides.push(other); // 두 진영을 함께 판단했으므로 같이 고친다
    const flip = (s) => s.replace(/마|상/g, (m) => (m === '마' ? '상' : '마'));
    for (const s of sides) {
      V.swapHorseElephant(state.model, s);
      if (s === J.CHO) state.choSetup = flip(state.choSetup);
      else state.hanSetup = flip(state.hanSetup);
    }
    state.confirmed[side] = true;
    save();
    notify('마와 상을 바꿔서 알아봤었네요. 움직임을 보고 고쳤어요');
    return sides;
  }

  function swapBoardLabels(board, sides) {
    return board.map((p) => {
      if (!p || !sides.includes(p[0])) return p;
      if (p[1] === 'H') return p[0] + 'E';
      if (p[1] === 'E') return p[0] + 'H';
      return p;
    });
  }

  function accept(board) {
    const prev = state.board;
    const key = boardKeyOf(board);
    const isStart = J.SETUPS.some((a) => J.SETUPS.some((b) => key === boardKeyOf(J.initialBoard(a, b))));
    if (isStart) {
      state.turn = J.CHO;
      state.lastMove = null;
    } else if (prev) {
      const changed = [];
      for (let i = 0; i < 90; i++) if (prev[i] !== board[i]) changed.push(i);
      // 한 수 움직임: 빈칸이 된 곳(출발)과 새로 말이 생긴 곳(도착)
      const from = changed.filter((i) => prev[i] && !board[i]);
      const to = changed.filter((i) => board[i] && prev[i] !== board[i]);
      if (changed.length <= 2 && from.length === 1 && to.length === 1 && prev[from[0]] === board[to[0]]) {
        const piece = board[to[0]];
        state.turn = J.other(piece[0]);
        state.lastMove = { from: from[0], to: to[0] };
        if (piece[1] === 'H' || piece[1] === 'E') {
          const swapped = checkHorseElephant(piece, from[0], to[0]);
          if (swapped) board = swapBoardLabels(board, swapped);
        }
      } else {
        state.lastMove = null;
      }
    }
    state.board = board;
    state.boardKey = boardKeyOf(board);
    state.candKey = '';
    computeHint();
    renderInfo();
    guide();
  }

  function computeHint() {
    state.hint = null;
    renderAll();
    if (!state.board) return;
    const token = ++state.hintToken;
    $('hint-text').textContent = '수를 계산하고 있어요…';
    setTimeout(() => {
      if (token !== state.hintToken) return;
      const mv = AI.bestMove(state.board, state.turn, state.level, false);
      if (token !== state.hintToken) return;
      state.hint = mv ? { from: mv.from, to: mv.to, side: state.turn } : null;
      renderAll();
    }, 30);
  }

  function hintText() {
    if (!state.board) return '—';
    const turn = state.turn;
    if (!state.hint) {
      if (J.legalMoves(state.board, turn).length === 0) {
        return J.isInCheck(state.board, turn)
          ? `${J.SIDE_NAMES[turn]}은(는) 외통수에 걸렸어요`
          : `${J.SIDE_NAMES[turn]}은(는) 둘 수 있는 수가 없어요 (한수쉼)`;
      }
      return '수를 계산하고 있어요…';
    }
    const { from, to } = state.hint;
    const p = state.board[from];
    const cap = state.board[to];
    let t = `${J.SIDE_NAMES[turn]} 추천: ${J.NAMES[p[0]][p[1]]}(${J.LABELS[p[0]][p[1]]}) ${J.coord(from)} → ${J.coord(to)}`;
    if (cap) t += ` · ${J.NAMES[cap[0]][cap[1]]} 잡기`;
    const after = J.applyMove(state.board, from, to);
    if (J.isInCheck(after, J.other(turn))) t += ' · 장군!';
    if (J.isInCheck(state.board, turn)) t = `장군 받는 중! ${t}`;
    return t;
  }

  function startLoop() {
    stopLoop();
    if (state.src && state.src.kind === 'video') state.timer = setInterval(process, 500);
  }

  function stopLoop() {
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
  }

  // ---------- 그리기 ----------

  const el = BV.el;
  const overlayMarker = BV.arrowMarker(overlay, 'arrow-head');
  const dyn = el('g', {}, overlay);

  function pt(i) {
    const [gx, gy] = V.boardToScreen(i, state.bottom);
    return V.gridPoint(state.calib, gx, gy);
  }

  function renderOverlay() {
    dyn.textContent = '';
    if (!state.src) return;
    const unit = Math.max(state.src.w, state.src.h) / 400;

    if (state.calibStep && state.calibTmp) {
      el('circle', { cx: state.calibTmp.x, cy: state.calibTmp.y, r: 6 * unit, class: 'calib-mark' }, dyn);
    }
    const c = state.calib;
    if (!c || state.calibStep) return;
    const [cw, ch] = V.cellSize(c);

    if (state.viewMode === 'overlay') {
      const g = el('g', { opacity: state.opacity }, dyn);
      el('rect', {
        x: c.x1 - cw * 0.6, y: c.y1 - ch * 0.6, width: c.x2 - c.x1 + cw * 1.2, height: c.y2 - c.y1 + ch * 1.2,
        rx: cw * 0.2, class: 'board-bg',
      }, g);
      const lines = el('g', { class: 'ov-grid', 'stroke-width': Math.max(1, cw * 0.025) }, g);
      for (let x = 0; x < 9; x++) el('line', { x1: c.x1 + x * cw, y1: c.y1, x2: c.x1 + x * cw, y2: c.y2 }, lines);
      for (let y = 0; y < 10; y++) el('line', { x1: c.x1, y1: c.y1 + y * ch, x2: c.x2, y2: c.y1 + y * ch }, lines);
      for (const top of [0, 7]) {
        const xa = c.x1 + 3 * cw;
        const xb = c.x1 + 5 * cw;
        const ya = c.y1 + top * ch;
        const yb = c.y1 + (top + 2) * ch;
        el('line', { x1: xa, y1: ya, x2: xb, y2: yb }, lines);
        el('line', { x1: xb, y1: ya, x2: xa, y2: yb }, lines);
      }
      if (state.board) {
        const scale = (Math.min(cw, ch) / 60) * 0.95;
        state.board.forEach((p, i) => {
          if (!p) return;
          const [x, y] = pt(i);
          const wrap = el('g', { transform: `translate(${x},${y})` }, g);
          BV.pieceGroup(p, wrap, scale);
        });
      }
    } else {
      // 판 위치가 맞는지 확인할 수 있게 교차점에 작은 점
      for (let gy = 0; gy < 10; gy++) {
        for (let gx = 0; gx < 9; gx++) {
          const [x, y] = V.gridPoint(c, gx, gy);
          el('circle', { cx: x, cy: y, r: Math.max(2, cw * 0.06), class: 'calib-dot' }, dyn);
        }
      }
    }

    if (state.hint) {
      const [x1, y1] = pt(state.hint.from);
      const [x2, y2] = pt(state.hint.to);
      el('circle', { cx: x1, cy: y1, r: Math.min(cw, ch) * 0.5, class: 'arrow-from', 'stroke-width': cw * 0.06 }, dyn);
      const line = BV.arrow(dyn, x1, y1, x2, y2, overlayMarker, 'arrow-line', Math.min(cw, ch) * 0.3);
      line.style.strokeWidth = `${Math.max(3, cw * 0.13)}px`;
    }
  }

  function renderMirror() {
    const v = mirrorView;
    v.flipped = state.bottom === J.HAN;
    v.clear();
    if (!state.board) return;
    if (state.lastMove) {
      v.circle('marks', state.lastMove.from, 10, 'mark-from');
      v.circle('marks', state.lastMove.to, 30, 'mark-to');
    }
    const k = J.findKing(state.board, state.turn);
    if (k >= 0 && J.isInCheck(state.board, state.turn)) v.circle('marks', k, 34, 'mark-check');
    v.pieces(state.board);
    if (state.hint) v.arrow(state.hint.from, state.hint.to);
  }

  function renderAll() {
    renderOverlay();
    renderMirror();
    renderInfo();
    $('turn-label').textContent = J.SIDE_NAMES[state.turn];
    $('turn-label').className = state.turn === J.CHO ? 'cho-text' : 'han-text';
    $('hint-text').textContent = hintText();
    document.body.classList.toggle('mode-overlay', state.viewMode === 'overlay');
    guide();
  }

  // ---------- 조작 ----------

  function overlayPoint(e) {
    const p = overlay.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    return p.matrixTransform(overlay.getScreenCTM().inverse());
  }

  overlay.addEventListener('click', (e) => {
    if (!state.calibStep) return;
    const p = overlayPoint(e);
    if (state.calibStep === 'tl') {
      state.calibTmp = { x: p.x, y: p.y };
      state.calibStep = 'br';
    } else {
      const a = state.calibTmp;
      if (p.x - a.x < 20 || p.y - a.y < 20) {
        setStatus('오른쪽 아래 꼭짓점은 왼쪽 위보다 오른쪽 아래에 있어야 해요. 다시 클릭하세요', 'check');
        return;
      }
      state.calib = { x1: a.x, y1: a.y, x2: p.x, y2: p.y };
      state.calibManual = true;
      state.calibStep = null;
      state.calibTmp = null;
      stage.classList.remove('calibrating');
      state.boardKey = '';
      process();
    }
    renderAll();
  });

  $('btn-capture').addEventListener('click', startCapture);
  $('file-input').addEventListener('change', (e) => openImage(e.target.files[0]));

  $('btn-reset').addEventListener('click', () => {
    state.calib = null;
    state.calibManual = false;
    state.model = null;
    state.board = null;
    state.boardKey = '';
    state.hint = null;
    state.confirmed = { c: false, h: false };
    save();
    renderAll();
    process();
  });

  $('btn-calib').addEventListener('click', () => {
    if (!state.src) {
      setStatus('먼저 화면을 연결해 주세요', 'check');
      return;
    }
    state.calibStep = 'tl';
    state.calibTmp = null;
    stage.classList.add('calibrating');
    renderAll();
  });

  $('btn-learn').addEventListener('click', () => {
    if (!state.src || !state.calib) {
      setStatus('화면 연결과 판 위치를 먼저 맞춰 주세요', 'check');
      return;
    }
    const f = grab();
    if (!f) return;
    // 직접 고른 차림은 사람이 확인한 것이므로 확정으로 본다
    state.confirmed = { c: true, h: true };
    learnFrom(f, $('sel-bottom').value, $('sel-cho').value, $('sel-han').value);
    notify('말 모양을 익혔어요! 이제 대국을 진행하면 훈수가 나와요');
  });

  $('btn-turn').addEventListener('click', () => {
    state.turn = J.other(state.turn);
    computeHint();
  });

  $('sel-level').addEventListener('change', (e) => {
    state.level = e.target.value;
    save();
    computeHint();
  });

  document.querySelectorAll('input[name="view"]').forEach((r) => {
    r.addEventListener('change', () => {
      state.viewMode = document.querySelector('input[name="view"]:checked').value;
      save();
      renderAll();
    });
  });

  $('opacity').addEventListener('input', (e) => {
    state.opacity = Number(e.target.value) / 100;
    save();
    renderOverlay();
  });

  // ---------- 시작 ----------

  function fillSelect(sel) {
    J.SETUPS.forEach((s) => {
      const o = document.createElement('option');
      o.value = s;
      o.textContent = s;
      sel.appendChild(o);
    });
  }

  load();
  fillSelect($('sel-cho'));
  fillSelect($('sel-han'));
  $('sel-level').value = state.level;
  $('opacity').value = Math.round(state.opacity * 100);
  document.querySelector(`input[name="view"][value="${state.viewMode}"]`).checked = true;
  renderAll();

  // 테스트용
  window.__advisor = { state, process, accept, renderAll };
})();
