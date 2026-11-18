/*
 * 장기+ AI
 * 반복 심화 + 알파-베타(PVS) + 치환표(Zobrist) + 장군 연장 + 널 무브 가지치기
 * + 킬러/히스토리 수 정렬 + 잡기 위주 정적 탐색
 * (자기 궁이 잡히는지는 탐색 안에서 '궁을 잡는 수'로 판단한다)
 */
(function (global) {
  'use strict';

  const J = global.Janggi;
  const VAL = { K: 0, R: 1300, C: 700, H: 500, E: 300, A: 300, P: 200 };
  const ORDER_VAL = { K: 100000, R: 1300, C: 700, H: 500, E: 300, A: 300, P: 200 };
  const MATE = 1000000;
  const MATE_BOUND = MATE - 1000;

  const LEVELS = {
    easy: { depth: 1, noise: 250, time: 400, quiesce: false },
    normal: { depth: 3, noise: 20, time: 1000, quiesce: true },
    hard: { depth: 7, noise: 0, time: 2500, quiesce: true },
    max: { depth: 30, noise: 0, time: 7000, quiesce: true },
  };

  // ---------- 평가 ----------

  function positional(p, i) {
    const x = J.xOf(i);
    const y = J.yOf(i);
    const center = 4 - Math.abs(x - 4);
    switch (p[1]) {
      case 'P': {
        const advance = p[0] === J.CHO ? 6 - y : y - 3;
        return advance * 12 + (x === 4 ? 8 : 0);
      }
      case 'H':
        return center * 8;
      case 'E':
        return center * 5;
      case 'C':
        return center * 3;
      case 'R':
        return center * 2;
      default:
        return 0;
    }
  }

  function evaluate(board, side) {
    let s = 0;
    for (let i = 0; i < 90; i++) {
      const p = board[i];
      if (!p) continue;
      const v = VAL[p[1]] + positional(p, i);
      s += p[0] === side ? v : -v;
    }
    s += side === J.HAN ? 150 : -150; // 한의 덤 1.5점
    return s;
  }

  // ---------- Zobrist 해시 ----------

  const PIECES = ['cK', 'cA', 'cR', 'cC', 'cH', 'cE', 'cP', 'hK', 'hA', 'hR', 'hC', 'hH', 'hE', 'hP'];
  const PIDX = {};
  PIECES.forEach((p, k) => { PIDX[p] = k; });
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed | 0;
  };
  const Z1 = new Int32Array(14 * 90);
  const Z2 = new Int32Array(14 * 90);
  for (let k = 0; k < Z1.length; k++) {
    Z1[k] = rnd();
    Z2[k] = rnd();
  }
  const SIDE1 = rnd();
  const SIDE2 = rnd();

  // ---------- 치환표 ----------

  const TT_BITS = 20;
  const TT_SIZE = 1 << TT_BITS;
  const TT_MASK = TT_SIZE - 1;
  const ttKey = new Int32Array(TT_SIZE);
  const ttScore = new Int32Array(TT_SIZE);
  const ttMove = new Int16Array(TT_SIZE).fill(-1);
  const ttDepth = new Int8Array(TT_SIZE);
  const ttFlag = new Int8Array(TT_SIZE); // 0 없음, 1 정확, 2 하한, 3 상한
  const EXACT = 1;
  const LOWER = 2;
  const UPPER = 3;

  function clearTT() {
    ttFlag.fill(0);
  }

  // ---------- 탐색 ----------

  function moveScore(board, from, to) {
    const cap = board[to];
    return cap ? ORDER_VAL[cap[1]] * 10 - ORDER_VAL[board[from][1]] / 100 : 0;
  }

  function genMoves(board, side, capturesOnly) {
    const moves = [];
    for (let i = 0; i < 90; i++) {
      const p = board[i];
      if (!p || p[0] !== side) continue;
      for (const to of J.pseudoMoves(board, i)) {
        if (capturesOnly && !board[to]) continue;
        moves.push(i * 90 + to);
      }
    }
    return moves;
  }

  function attacked(board, sq, bySide) {
    for (let i = 0; i < 90; i++) {
      const p = board[i];
      if (p && p[0] === bySide && J.pseudoMoves(board, i).includes(sq)) return true;
    }
    return false;
  }

  function inCheck(board, side) {
    const k = J.findKing(board, side);
    return k < 0 || attacked(board, k, J.other(side));
  }

  function hasPieces(board, side) {
    for (const p of board) if (p && p[0] === side && (p[1] === 'R' || p[1] === 'C' || p[1] === 'H')) return true;
    return false;
  }

  function createSearch(board, cfg) {
    const ctx = {
      deadline: Date.now() + cfg.time,
      nodes: 0,
      stop: false,
      h1: 0,
      h2: 0,
      killers: [],
      history: new Int32Array(90 * 90),
    };
    for (let i = 0; i < 90; i++) {
      const p = board[i];
      if (p) {
        ctx.h1 ^= Z1[PIDX[p] * 90 + i];
        ctx.h2 ^= Z2[PIDX[p] * 90 + i];
      }
    }

    function make(from, to) {
      const p = board[from];
      const cap = board[to];
      const pi = PIDX[p] * 90;
      ctx.h1 ^= Z1[pi + from] ^ Z1[pi + to] ^ SIDE1;
      ctx.h2 ^= Z2[pi + from] ^ Z2[pi + to] ^ SIDE2;
      if (cap) {
        const ci = PIDX[cap] * 90 + to;
        ctx.h1 ^= Z1[ci];
        ctx.h2 ^= Z2[ci];
      }
      board[to] = p;
      board[from] = null;
      return cap;
    }

    function unmake(from, to, cap) {
      const p = board[to];
      board[from] = p;
      board[to] = cap;
      const pi = PIDX[p] * 90;
      ctx.h1 ^= Z1[pi + from] ^ Z1[pi + to] ^ SIDE1;
      ctx.h2 ^= Z2[pi + from] ^ Z2[pi + to] ^ SIDE2;
      if (cap) {
        const ci = PIDX[cap] * 90 + to;
        ctx.h1 ^= Z1[ci];
        ctx.h2 ^= Z2[ci];
      }
    }

    function timeUp() {
      ctx.nodes++;
      if ((ctx.nodes & 2047) === 0 && Date.now() > ctx.deadline) ctx.stop = true;
      return ctx.stop;
    }

    function quiesce(side, alpha, beta, ply, qdepth) {
      if (timeUp()) return 0;
      const stand = evaluate(board, side);
      if (stand >= beta) return stand;
      if (stand > alpha) alpha = stand;
      if (qdepth <= 0) return stand;
      const moves = genMoves(board, side, true);
      moves.sort((a, b) => moveScore(board, (b / 90) | 0, b % 90) - moveScore(board, (a / 90) | 0, a % 90));
      for (const m of moves) {
        const from = (m / 90) | 0;
        const to = m % 90;
        if (board[to][1] === 'K') return MATE - ply;
        const cap = make(from, to);
        const v = -quiesce(J.other(side), -beta, -alpha, ply + 1, qdepth - 1);
        unmake(from, to, cap);
        if (ctx.stop) return 0;
        if (v >= beta) return v;
        if (v > alpha) alpha = v;
      }
      return alpha;
    }

    function search(side, depth, alpha, beta, ply, allowNull) {
      if (timeUp()) return 0;

      const slot = ctx.h1 & TT_MASK;
      let ttBest = -1;
      if (ttFlag[slot] && ttKey[slot] === ctx.h2) {
        ttBest = ttMove[slot];
        if (ttDepth[slot] >= depth && ply > 0) {
          let s = ttScore[slot];
          if (s > MATE_BOUND) s -= ply;
          else if (s < -MATE_BOUND) s += ply;
          const f = ttFlag[slot];
          if (f === EXACT || (f === LOWER && s >= beta) || (f === UPPER && s <= alpha)) return s;
        }
      }

      const checked = depth > 0 && inCheck(board, side);
      if (checked && ply < 40) depth++; // 장군이면 한 수 더 읽는다

      if (depth <= 0) return cfg.quiesce ? quiesce(side, alpha, beta, ply, 6) : evaluate(board, side);

      // 널 무브: 한 수 쉬어도 충분히 좋으면 더 볼 필요가 없다
      if (allowNull && !checked && depth >= 3 && beta < MATE_BOUND && hasPieces(board, side)) {
        ctx.h1 ^= SIDE1;
        ctx.h2 ^= SIDE2;
        const v = -search(J.other(side), depth - 3, -beta, -beta + 1, ply + 1, false);
        ctx.h1 ^= SIDE1;
        ctx.h2 ^= SIDE2;
        if (ctx.stop) return 0;
        if (v >= beta) return beta;
      }

      const moves = genMoves(board, side, false);
      if (!moves.length) return evaluate(board, side);
      const killers = ctx.killers[ply] || [];
      const scores = moves.map((m) => {
        if (m === ttBest) return 1e9;
        const from = (m / 90) | 0;
        const to = m % 90;
        if (board[to]) return 1e7 + moveScore(board, from, to);
        if (m === killers[0]) return 9e6;
        if (m === killers[1]) return 8e6;
        return ctx.history[m];
      });
      const idx = moves.map((_, k) => k).sort((a, b) => scores[b] - scores[a]);

      const alphaOrig = alpha;
      let best = -Infinity;
      let bestMove = -1;
      let first = true;
      for (const k of idx) {
        const m = moves[k];
        const from = (m / 90) | 0;
        const to = m % 90;
        const target = board[to];
        if (target && target[1] === 'K') return MATE - ply;
        const cap = make(from, to);
        let v;
        if (first) {
          v = -search(J.other(side), depth - 1, -beta, -alpha, ply + 1, true);
        } else {
          v = -search(J.other(side), depth - 1, -alpha - 1, -alpha, ply + 1, true);
          if (!ctx.stop && v > alpha && v < beta) v = -search(J.other(side), depth - 1, -beta, -alpha, ply + 1, true);
        }
        unmake(from, to, cap);
        if (ctx.stop) return 0;
        first = false;
        if (v > best) {
          best = v;
          bestMove = m;
        }
        if (v > alpha) alpha = v;
        if (alpha >= beta) {
          if (!cap) {
            if (killers[0] !== m) ctx.killers[ply] = [m, killers[0]];
            ctx.history[m] += depth * depth;
          }
          break;
        }
      }

      // 장군이 아닌데 모든 수가 궁을 잃는 경우는 한수쉼을 하면 된다
      if (best <= -MATE_BOUND && !checked) best = evaluate(board, side);

      let store = best;
      if (store > MATE_BOUND) store += ply;
      else if (store < -MATE_BOUND) store -= ply;
      ttKey[slot] = ctx.h2;
      ttScore[slot] = store;
      ttMove[slot] = bestMove;
      ttDepth[slot] = Math.min(depth, 127);
      ttFlag[slot] = best <= alphaOrig ? UPPER : best >= beta ? LOWER : EXACT;
      return best;
    }

    return { ctx, make, unmake, search };
  }

  // 빅장으로 게임이 끝났을 때 side 입장의 값 (점수가 높은 쪽 승리)
  function bikjangValue(board, side) {
    const mine = J.materialScore(board, side);
    const theirs = J.materialScore(board, J.other(side));
    return mine > theirs ? MATE / 2 : -MATE / 2;
  }

  /**
   * 주어진 진영의 가장 좋은 수를 찾는다. 둘 수 있는 수가 없으면 null (한수쉼)
   * bikjangPending: 직전 수로 빅장이 걸려 있는지 (풀지 않으면 그대로 게임 종료)
   */
  function bestMove(board, side, level, bikjangPending) {
    const cfg = LEVELS[level] || LEVELS.normal;
    const legal = J.legalMoves(board, side);
    if (!legal.length) return null;
    if (legal.length === 1) return { from: legal[0].from, to: legal[0].to };

    const b = board.slice();
    clearTT();
    const S = createSearch(b, cfg);
    let rootMoves = legal.map((m) => ({ from: m.from, to: m.to }));
    rootMoves.sort((a, c) => moveScore(b, c.from, c.to) - moveScore(b, a.from, a.to));

    let chosen = rootMoves[0];
    for (let d = 1; d <= cfg.depth; d++) {
      let bestVal = -Infinity;
      let bestM = null;
      let alpha = -Infinity;
      const scored = [];
      for (const m of rootMoves) {
        const cap = S.make(m.from, m.to);
        let v;
        const facing = J.kingsFacing(b);
        if (facing && bikjangPending) {
          v = bikjangValue(b, side); // 빅장을 유지하면 바로 점수로 끝난다
        } else {
          const beta = cfg.noise ? Infinity : -alpha;
          if (cfg.noise || !bestM) {
            v = -S.search(J.other(side), d - 1, -Infinity, beta, 1, true);
          } else {
            v = -S.search(J.other(side), d - 1, -alpha - 1, -alpha, 1, true);
            if (!S.ctx.stop && v > alpha) v = -S.search(J.other(side), d - 1, -Infinity, -alpha, 1, true);
          }
          if (facing) v = Math.min(v, bikjangValue(b, side)); // 빅장을 걸면 상대가 그대로 끝낼 수 있다
        }
        S.unmake(m.from, m.to, cap);
        if (S.ctx.stop) break;
        if (cfg.noise) v += Math.random() * cfg.noise;
        scored.push({ m, v });
        if (v > bestVal) {
          bestVal = v;
          bestM = m;
        }
        if (!cfg.noise && v > alpha) alpha = v;
      }
      if (S.ctx.stop) {
        // 이전 최선 수를 먼저 끝까지 봤으므로, 그보다 좋다고 확인된 수가 있으면 그것을 쓴다
        if (bestM) chosen = bestM;
        break;
      }
      chosen = bestM;
      scored.sort((a, c) => c.v - a.v);
      rootMoves = scored.map((s) => s.m).concat(rootMoves.filter((m) => !scored.some((s) => s.m === m)));
      if (bestVal >= MATE_BOUND || bestVal <= -MATE_BOUND) break; // 외통수를 찾았거나 피할 수 없음
    }
    return { from: chosen.from, to: chosen.to };
  }

  global.JanggiAI = { bestMove, evaluate, LEVELS };
})(typeof window !== 'undefined' ? window : globalThis);
