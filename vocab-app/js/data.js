// 400フレーズ。英語の言い換え・和訳・例文はアプリ用に書き起こしたもの。
import w1 from './words1.js';
import w2 from './words2.js';
import w3 from './words3.js';
import w4 from './words4.js';

export const POS = { v: '動詞句', a: '形容詞・副詞', n: '名詞', x: '表現' };

export const WORDS = [...w1, ...w2, ...w3, ...w4].map((e, i) => ({
  no: i + 1,
  t: e[0],
  pos: e[1],
  def: e[2],
  ja: e[3],
  ex: e[4],
  exJa: e[5],
  g: e[6] || null, // 類義グループ: 同じグループの言い換えは誤答の選択肢に使わない
}));

export const byNo = (no) => WORDS[no - 1];
export const pad = (no) => String(no).padStart(3, '0');
