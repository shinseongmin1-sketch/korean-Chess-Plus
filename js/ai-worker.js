/*
 * 장기+ AI 계산을 화면과 따로 돌리는 워커 (계산 중에도 화면이 멈추지 않게)
 */
/* global importScripts, JanggiAI */
importScripts('rules.js', 'ai.js');

self.onmessage = (e) => {
  const { id, board, side, level, bikjang } = e.data;
  let mv = null;
  try {
    mv = JanggiAI.bestMove(board, side, level, bikjang);
  } catch (err) {
    mv = null;
  }
  self.postMessage({ id, mv });
};
