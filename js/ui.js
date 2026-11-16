/*
 * 장기+ 대국 화면 (클릭 처리, AI 차례 진행, 훈수)
 */
(function () {
  'use strict';

  const J = window.Janggi;
  const AI = window.JanggiAI;
  const BV = window.JanggiBoardView;

  const $ = (id) => document.getElementById(id);
  const svg = $('board');
  const view = BV.create(svg);

  const state = {
    game: null,
    mode: 'ai',
    humanSide: J.CHO,
    level: 'normal',
    selected: null,
    thinking: false,
    aiTimer: null,
    hint: null,
  };

  // ---------- 판 그리기 ----------

  function render(opts = {}) {
    const g = state.game;
    view.clear();

    const lm = g.lastMove;
    if (lm && !lm.pass) {
      view.circle('marks', lm.from, 10, 'mark-from');
      view.circle('marks', lm.to, 30, 'mark-to');
    }

    if (g.inCheck && !g.result) {
      const k = J.findKing(g.board, g.turn);
      if (k >= 0) view.circle('marks', k, 34, 'mark-check');
    }

    if (state.selected !== null) view.circle('marks', state.selected, 31, 'mark-selected');

    view.pieces(g.board, opts.animate);

    if (state.selected !== null) {
      for (const to of g.movesFrom(state.selected)) {
        if (g.board[to]) view.circle('hints', to, 29, 'hint-capture');
        else view.circle('hints', to, 9, 'hint-move');
      }
    }

    if (state.hint) view.arrow(state.hint.from, state.hint.to);

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
    if (g.bikjang) return `빅장! ${who} 차례 — 풀지 않으면 점수로 승부`;
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

    const players = document.querySelector('.players');
    const bottomSide = view.flipped ? J.HAN : J.CHO;
    players.appendChild($(`player-${J.other(bottomSide)}`));
    players.appendChild($(`player-${bottomSide}`));

    const busy = state.thinking;
    $('btn-undo').disabled = busy || g.history.length === 0;
    $('btn-pass').disabled = busy || !g.canPass() || !isHumanTurn();
    $('btn-resign').disabled = busy || !!g.result;
    $('btn-hint').disabled = busy || !!g.result || !isHumanTurn() || g.legal.length === 0;

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
    state.hint = null;
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

  function showHint() {
    const g = state.game;
    if (state.thinking || g.result || !isHumanTurn()) return;
    state.thinking = true;
    renderPanel();
    setTimeout(() => {
      // 훈수는 항상 '어려움' 수준으로 계산
      const mv = AI.bestMove(g.board, g.turn, 'hard', g.bikjang);
      state.thinking = false;
      state.hint = mv;
      state.selected = mv ? mv.from : null;
      render();
    }, 30);
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
    state.hint = null;
    render();
    maybeAI();
  }

  function newGame(opts) {
    stopAI();
    state.mode = opts.mode;
    state.humanSide = opts.side;
    state.level = opts.level;
    view.flipped = opts.mode === 'ai' && opts.side === J.HAN;
    state.selected = null;
    state.hint = null;
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

  fillSetups();
  svg.addEventListener('click', (e) => {
    const i = view.squareFromEvent(e);
    if (i !== null) onSquare(i);
  });
  $('btn-new').addEventListener('click', openDialog);
  $('banner-new').addEventListener('click', openDialog);
  $('btn-undo').addEventListener('click', undo);
  $('btn-hint').addEventListener('click', showHint);
  $('btn-pass').addEventListener('click', () => {
    if (state.thinking || !isHumanTurn()) return;
    if (state.game.pass()) {
      state.selected = null;
      state.hint = null;
      render();
      maybeAI();
    }
  });
  $('btn-flip').addEventListener('click', () => {
    view.flipped = !view.flipped;
    render();
  });
  $('btn-resign').addEventListener('click', () => {
    const g = state.game;
    if (state.thinking || g.result) return;
    const side = state.mode === 'ai' ? state.humanSide : g.turn;
    if (!confirm(`${J.SIDE_NAMES[side]}이(가) 기권할까요?`)) return;
    g.resign(side);
    state.selected = null;
    state.hint = null;
    render();
  });

  startFromForm();
  openDialog();
})();
