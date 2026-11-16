/*
 * 장기+ 규칙 엔진
 * 판: 가로 9줄(x 0~8) × 세로 10줄(y 0~9), 칸 번호 = y * 9 + x
 * 위쪽(y 0~3)이 한(漢), 아래쪽(y 6~9)이 초(楚). 초가 먼저 둔다.
 * 말 표기: 진영 글자 + 종류 글자. 예) 'cR' = 초 차, 'hK' = 한 궁
 *   K 궁, A 사, R 차, C 포, H 마, E 상, P 졸/병
 */
(function (global) {
  'use strict';

  const COLS = 9;
  const ROWS = 10;
  const CHO = 'c';
  const HAN = 'h';

  const PIECE_VALUES = { K: 0, R: 13, C: 7, H: 5, E: 3, A: 3, P: 2 };
  const HAN_BONUS = 1.5; // 후수(한) 덤

  const LABELS = {
    c: { K: '楚', R: '車', C: '包', H: '馬', E: '象', A: '士', P: '卒' },
    h: { K: '漢', R: '車', C: '包', H: '馬', E: '象', A: '士', P: '兵' },
  };
  const NAMES = {
    c: { K: '궁', R: '차', C: '포', H: '마', E: '상', A: '사', P: '졸' },
    h: { K: '궁', R: '차', C: '포', H: '마', E: '상', A: '사', P: '병' },
  };
  const SIDE_NAMES = { c: '초', h: '한' };

  // 마·상 차림 (각 진영 자기 쪽에서 봤을 때 왼쪽부터)
  const SETUPS = ['마상마상', '상마상마', '마상상마', '상마마상'];

  const ORTH = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  const DIAG = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

  const idx = (x, y) => y * COLS + x;
  const xOf = (i) => i % COLS;
  const yOf = (i) => (i / COLS) | 0;
  const inBoard = (x, y) => x >= 0 && x < COLS && y >= 0 && y < ROWS;
  const other = (s) => (s === CHO ? HAN : CHO);

  function inPalace(x, y) {
    return x >= 3 && x <= 5 && ((y >= 0 && y <= 2) || (y >= 7 && y <= 9));
  }

  function isPalaceCenter(x, y) {
    return x === 4 && (y === 1 || y === 8);
  }

  // 궁성 대각선을 따라 한 칸 이동할 수 있는지
  function diagStep(x, y, dx, dy) {
    const nx = x + dx;
    const ny = y + dy;
    if (!inPalace(x, y) || !inPalace(nx, ny)) return false;
    return isPalaceCenter(x, y) || isPalaceCenter(nx, ny);
  }

  function placeSetup(board, side, setup, row) {
    const kinds = setup.split('').map((ch) => (ch === '마' ? 'H' : 'E'));
    // 초는 아래에서 위를 보므로 왼쪽이 x=0, 한은 위에서 아래를 보므로 왼쪽이 x=8
    const xs = side === CHO ? [1, 2, 6, 7] : [7, 6, 2, 1];
    xs.forEach((x, i) => {
      board[idx(x, row)] = side + kinds[i];
    });
  }

  function initialBoard(choSetup, hanSetup) {
    const b = new Array(COLS * ROWS).fill(null);

    // 한 (위)
    b[idx(0, 0)] = 'hR';
    b[idx(8, 0)] = 'hR';
    b[idx(3, 0)] = 'hA';
    b[idx(5, 0)] = 'hA';
    b[idx(4, 1)] = 'hK';
    b[idx(1, 2)] = 'hC';
    b[idx(7, 2)] = 'hC';
    [0, 2, 4, 6, 8].forEach((x) => { b[idx(x, 3)] = 'hP'; });
    placeSetup(b, HAN, hanSetup || SETUPS[0], 0);

    // 초 (아래)
    b[idx(0, 9)] = 'cR';
    b[idx(8, 9)] = 'cR';
    b[idx(3, 9)] = 'cA';
    b[idx(5, 9)] = 'cA';
    b[idx(4, 8)] = 'cK';
    b[idx(1, 7)] = 'cC';
    b[idx(7, 7)] = 'cC';
    [0, 2, 4, 6, 8].forEach((x) => { b[idx(x, 6)] = 'cP'; });
    placeSetup(b, CHO, choSetup || SETUPS[0], 9);

    return b;
  }

  /**
   * 자기 궁이 잡히는지는 따지지 않은 이동 후보 (도착 칸 번호 배열)
   */
  function pseudoMoves(board, from) {
    const p = board[from];
    if (!p) return [];
    const side = p[0];
    const type = p[1];
    const x = xOf(from);
    const y = yOf(from);
    const out = [];

    const tryAdd = (nx, ny) => {
      const t = idx(nx, ny);
      const q = board[t];
      if (!q || q[0] !== side) out.push(t);
    };

    switch (type) {
      case 'K':
      case 'A': {
        for (const [dx, dy] of ORTH) {
          const nx = x + dx;
          const ny = y + dy;
          if (inPalace(nx, ny)) tryAdd(nx, ny);
        }
        for (const [dx, dy] of DIAG) {
          if (diagStep(x, y, dx, dy)) tryAdd(x + dx, y + dy);
        }
        break;
      }

      case 'R': {
        for (const [dx, dy] of ORTH) {
          let nx = x + dx;
          let ny = y + dy;
          while (inBoard(nx, ny)) {
            const q = board[idx(nx, ny)];
            if (!q) {
              out.push(idx(nx, ny));
            } else {
              if (q[0] !== side) out.push(idx(nx, ny));
              break;
            }
            nx += dx;
            ny += dy;
          }
        }
        for (const [dx, dy] of DIAG) {
          let cx = x;
          let cy = y;
          while (diagStep(cx, cy, dx, dy)) {
            cx += dx;
            cy += dy;
            const q = board[idx(cx, cy)];
            if (!q) {
              out.push(idx(cx, cy));
            } else {
              if (q[0] !== side) out.push(idx(cx, cy));
              break;
            }
          }
        }
        break;
      }

      case 'C': {
        // 포는 포가 아닌 말 하나를 넘어야 하고, 포를 잡을 수 없다
        for (const [dx, dy] of ORTH) {
          let nx = x + dx;
          let ny = y + dy;
          while (inBoard(nx, ny) && !board[idx(nx, ny)]) {
            nx += dx;
            ny += dy;
          }
          if (!inBoard(nx, ny)) continue;
          const screen = board[idx(nx, ny)];
          if (screen[1] === 'C') continue;
          nx += dx;
          ny += dy;
          while (inBoard(nx, ny)) {
            const q = board[idx(nx, ny)];
            if (!q) {
              out.push(idx(nx, ny));
            } else {
              if (q[0] !== side && q[1] !== 'C') out.push(idx(nx, ny));
              break;
            }
            nx += dx;
            ny += dy;
          }
        }
        for (const [dx, dy] of DIAG) {
          if (!diagStep(x, y, dx, dy)) continue;
          const mx = x + dx;
          const my = y + dy;
          if (!diagStep(mx, my, dx, dy)) continue;
          const screen = board[idx(mx, my)];
          if (!screen || screen[1] === 'C') continue;
          const tx = mx + dx;
          const ty = my + dy;
          const q = board[idx(tx, ty)];
          if (!q || (q[0] !== side && q[1] !== 'C')) out.push(idx(tx, ty));
        }
        break;
      }

      case 'H': {
        for (const [dx, dy] of ORTH) {
          const mx = x + dx;
          const my = y + dy;
          if (!inBoard(mx, my) || board[idx(mx, my)]) continue; // 멱
          for (const s of [-1, 1]) {
            const nx = dx !== 0 ? x + 2 * dx : x + s;
            const ny = dy !== 0 ? y + 2 * dy : y + s;
            if (inBoard(nx, ny)) tryAdd(nx, ny);
          }
        }
        break;
      }

      case 'E': {
        for (const [dx, dy] of ORTH) {
          const m1x = x + dx;
          const m1y = y + dy;
          if (!inBoard(m1x, m1y) || board[idx(m1x, m1y)]) continue;
          for (const s of [-1, 1]) {
            const ddx = dx !== 0 ? dx : s;
            const ddy = dy !== 0 ? dy : s;
            const m2x = m1x + ddx;
            const m2y = m1y + ddy;
            if (!inBoard(m2x, m2y) || board[idx(m2x, m2y)]) continue;
            const nx = m2x + ddx;
            const ny = m2y + ddy;
            if (inBoard(nx, ny)) tryAdd(nx, ny);
          }
        }
        break;
      }

      case 'P': {
        const fwd = side === CHO ? -1 : 1;
        for (const [dx, dy] of [[0, fwd], [-1, 0], [1, 0]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (inBoard(nx, ny)) tryAdd(nx, ny);
        }
        // 상대 궁성 안에서는 대각선 앞으로도 갈 수 있다
        for (const dx of [-1, 1]) {
          if (diagStep(x, y, dx, fwd)) tryAdd(x + dx, y + fwd);
        }
        break;
      }

      default:
        break;
    }
    return out;
  }

  function findKing(board, side) {
    const k = side + 'K';
    for (let i = 0; i < board.length; i++) if (board[i] === k) return i;
    return -1;
  }

  function isInCheck(board, side) {
    const k = findKing(board, side);
    if (k < 0) return true;
    for (let i = 0; i < board.length; i++) {
      const p = board[i];
      if (p && p[0] !== side && pseudoMoves(board, i).includes(k)) return true;
    }
    return false;
  }

  function applyMove(board, from, to) {
    const b = board.slice();
    b[to] = b[from];
    b[from] = null;
    return b;
  }

  function legalMoves(board, side) {
    const moves = [];
    for (let i = 0; i < board.length; i++) {
      const p = board[i];
      if (!p || p[0] !== side) continue;
      for (const to of pseudoMoves(board, i)) {
        if (!isInCheck(applyMove(board, i, to), side)) moves.push({ from: i, to });
      }
    }
    return moves;
  }

  // 빅장: 두 궁이 같은 세로줄에서 사이에 아무것도 없이 마주 보는 상태
  function kingsFacing(board) {
    const a = findKing(board, CHO);
    const b = findKing(board, HAN);
    if (a < 0 || b < 0 || xOf(a) !== xOf(b)) return false;
    const x = xOf(a);
    const y1 = Math.min(yOf(a), yOf(b));
    const y2 = Math.max(yOf(a), yOf(b));
    for (let y = y1 + 1; y < y2; y++) if (board[idx(x, y)]) return false;
    return true;
  }

  function materialScore(board, side) {
    let s = side === HAN ? HAN_BONUS : 0;
    for (const p of board) if (p && p[0] === side) s += PIECE_VALUES[p[1]];
    return s;
  }

  // 한국식 좌표: 세로줄 번호(1~9,0) + 가로줄 번호(1~9)
  function coord(i) {
    return `${(yOf(i) + 1) % 10}${xOf(i) + 1}`;
  }

  class Game {
    constructor(opts = {}) {
      this.choSetup = opts.choSetup || SETUPS[0];
      this.hanSetup = opts.hanSetup || SETUPS[0];
      this.board = initialBoard(this.choSetup, this.hanSetup);
      this.turn = CHO;
      this.history = [];
      this.captured = { c: [], h: [] }; // captured[c] = 초가 잡은 말
      this.lastMove = null;
      this.result = null;
      this.bikjang = false;
      this.log = [];
      this._refresh();
    }

    _snapshot() {
      return {
        board: this.board.slice(),
        turn: this.turn,
        captured: { c: this.captured.c.slice(), h: this.captured.h.slice() },
        lastMove: this.lastMove,
        result: this.result,
        bikjang: this.bikjang,
        logLength: this.log.length,
      };
    }

    _restore(s) {
      this.board = s.board;
      this.turn = s.turn;
      this.captured = s.captured;
      this.lastMove = s.lastMove;
      this.result = s.result;
      this.bikjang = s.bikjang;
      this.log.length = s.logLength;
      this._refresh();
    }

    _refresh() {
      this.legal = legalMoves(this.board, this.turn);
      this.inCheck = isInCheck(this.board, this.turn);
    }

    movesFrom(from) {
      return this.legal.filter((m) => m.from === from).map((m) => m.to);
    }

    canMove(from, to) {
      return this.legal.some((m) => m.from === from && m.to === to);
    }

    move(from, to) {
      if (this.result || !this.canMove(from, to)) return false;
      this.history.push(this._snapshot());
      const piece = this.board[from];
      const cap = this.board[to];
      this.board = applyMove(this.board, from, to);
      if (cap) this.captured[this.turn].push(cap);
      this.lastMove = { from, to, piece, captured: cap };
      const mover = this.turn;
      let text = `${SIDE_NAMES[mover]} ${NAMES[mover][piece[1]]} ${coord(from)}→${coord(to)}`;
      if (cap) text += ` (${NAMES[cap[0]][cap[1]]} 잡음)`;
      this.turn = other(mover);
      this._refresh();
      if (this.inCheck) text += ' 장군';
      this.log.push(text);
      this._afterAction(mover);
      return true;
    }

    canPass() {
      return !this.result && !this.inCheck;
    }

    pass() {
      if (!this.canPass()) return false;
      this.history.push(this._snapshot());
      const mover = this.turn;
      this.lastMove = { pass: true, side: mover };
      this.log.push(`${SIDE_NAMES[mover]} 한수쉼`);
      this.turn = other(mover);
      this._refresh();
      this._afterAction(mover);
      return true;
    }

    _afterAction(mover) {
      if (this.legal.length === 0 && this.inCheck) {
        this.result = { winner: mover, reason: '외통수' };
        return;
      }
      const facing = kingsFacing(this.board);
      if (facing && this.bikjang) {
        // 빅장이 풀리지 않으면 점수가 높은 쪽이 이긴다 (한의 덤 1.5점 때문에 동점은 없다)
        const c = this.score(CHO);
        const h = this.score(HAN);
        this.result = { winner: c > h ? CHO : HAN, reason: `빅장 점수승 (초 ${c} : 한 ${h})` };
      }
      this.bikjang = facing;
    }

    undo() {
      const s = this.history.pop();
      if (!s) return false;
      this._restore(s);
      return true;
    }

    resign(side) {
      if (this.result) return false;
      this.history.push(this._snapshot());
      this.result = { winner: other(side), reason: `${SIDE_NAMES[side]} 기권` };
      return true;
    }

    score(side) {
      return materialScore(this.board, side);
    }
  }

  global.Janggi = {
    COLS, ROWS, CHO, HAN,
    PIECE_VALUES, HAN_BONUS, LABELS, NAMES, SIDE_NAMES, SETUPS,
    idx, xOf, yOf, inBoard, other, inPalace,
    initialBoard, pseudoMoves, legalMoves, isInCheck, applyMove,
    findKing, kingsFacing, materialScore, coord,
    Game,
  };
})(typeof window !== 'undefined' ? window : globalThis);
