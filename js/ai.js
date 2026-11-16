/*
 * 장기+ AI: 알파-베타 탐색 + 반복 심화 + 잡기 위주 정적 탐색
 */
(function (global) {
  'use strict';

  const J = global.Janggi;
  const VAL = { K: 100000, R: 1300, C: 700, H: 500, E: 300, A: 300, P: 200 };
  const MATE = 1000000;

  const LEVELS = {
    easy: { depth: 1, noise: 250, time: 400, quiesce: false },
    normal: { depth: 3, noise: 25, time: 1500, quiesce: true },
    hard: { depth: 5, noise: 0, time: 3000, quiesce: true },
  };

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
      case 'E':
        return center * 6;
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
    for (let i = 0; i < board.length; i++) {
      const p = board[i];
      if (!p) continue;
      const v = VAL[p[1]] + positional(p, i);
      s += p[0] === side ? v : -v;
    }
    // 한의 덤 1.5점
    s += side === J.HAN ? 150 : -150;
    return s;
  }

  function genMoves(board, side, capturesOnly) {
    const moves = [];
    for (let i = 0; i < board.length; i++) {
      const p = board[i];
      if (!p || p[0] !== side) continue;
      for (const to of J.pseudoMoves(board, i)) {
        const cap = board[to];
        if (capturesOnly && !cap) continue;
        const score = cap ? VAL[cap[1]] * 10 - VAL[p[1]] / 100 : 0;
        moves.push({ from: i, to, score });
      }
    }
    moves.sort((a, b) => b.score - a.score);
    return moves;
  }

  function timeUp(ctx) {
    ctx.nodes++;
    if ((ctx.nodes & 1023) === 0 && Date.now() > ctx.deadline) ctx.stop = true;
    return ctx.stop;
  }

  function quiesce(board, side, alpha, beta, ply, qdepth, ctx) {
    if (timeUp(ctx)) return 0;
    const stand = evaluate(board, side);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (qdepth <= 0) return stand;
    for (const m of genMoves(board, side, true)) {
      const cap = board[m.to];
      if (cap[1] === 'K') return MATE - ply;
      board[m.to] = board[m.from];
      board[m.from] = null;
      const v = -quiesce(board, J.other(side), -beta, -alpha, ply + 1, qdepth - 1, ctx);
      board[m.from] = board[m.to];
      board[m.to] = cap;
      if (ctx.stop) return 0;
      if (v >= beta) return v;
      if (v > alpha) alpha = v;
    }
    return alpha;
  }

  function search(board, side, depth, alpha, beta, ply, ctx) {
    if (timeUp(ctx)) return 0;
    if (depth <= 0) {
      return ctx.quiesce
        ? quiesce(board, side, alpha, beta, ply, 4, ctx)
        : evaluate(board, side);
    }
    const moves = genMoves(board, side, false);
    if (!moves.length) return evaluate(board, side);
    let best = -Infinity;
    for (const m of moves) {
      const cap = board[m.to];
      if (cap && cap[1] === 'K') return MATE - ply;
      board[m.to] = board[m.from];
      board[m.from] = null;
      const v = -search(board, J.other(side), depth - 1, -beta, -alpha, ply + 1, ctx);
      board[m.from] = board[m.to];
      board[m.to] = cap;
      if (ctx.stop) return 0;
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
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

    const b = board.slice();
    const ctx = { deadline: Date.now() + cfg.time, nodes: 0, stop: false, quiesce: cfg.quiesce };
    let rootMoves = legal.map((m) => ({
      from: m.from,
      to: m.to,
      score: b[m.to] ? VAL[b[m.to][1]] * 10 - VAL[b[m.from][1]] / 100 : 0,
    }));
    rootMoves.sort((a, c) => c.score - a.score);

    let chosen = rootMoves[0];
    for (let d = 1; d <= cfg.depth; d++) {
      let bestVal = -Infinity;
      let bestM = null;
      let alpha = -Infinity;
      const scored = [];
      for (const m of rootMoves) {
        const cap = b[m.to];
        b[m.to] = b[m.from];
        b[m.from] = null;
        let v;
        const facing = J.kingsFacing(b);
        if (facing && bikjangPending) {
          v = bikjangValue(b, side); // 빅장을 유지하면 바로 점수로 끝난다
        } else {
          v = -search(b, J.other(side), d - 1, -Infinity, cfg.noise ? Infinity : -alpha, 1, ctx);
          // 빅장을 걸면 상대가 그대로 끝낼 수 있다
          if (facing) v = Math.min(v, bikjangValue(b, side));
        }
        b[m.from] = b[m.to];
        b[m.to] = cap;
        if (ctx.stop) break;
        if (cfg.noise) v += Math.random() * cfg.noise;
        scored.push({ m, v });
        if (v > bestVal) {
          bestVal = v;
          bestM = m;
        }
        if (!cfg.noise && v > alpha) alpha = v;
      }
      if (ctx.stop) {
        if (d === 1 && bestM) chosen = bestM;
        break;
      }
      chosen = bestM;
      // 다음 깊이에서는 좋은 수부터 살펴본다
      scored.sort((a, c) => c.v - a.v);
      rootMoves = scored.map((s) => s.m);
      if (bestVal >= MATE - 100) break;
    }
    return { from: chosen.from, to: chosen.to };
  }

  global.JanggiAI = { bestMove, evaluate, LEVELS };
})(typeof window !== 'undefined' ? window : globalThis);
