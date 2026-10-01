// 学習ロジック:
// - 新規: 番号順に20語ずつ。間違えた問題だけを繰り返し、全問正解で次の20語へ。
// - 復習: 翌日以降、期限が来た語を20語ずつ同じ方式で出題。
// - 各語の「一発正解」（セッション内で最初の解答が正解）を1日1回まで数え、規定回数でマスター。
import { WORDS, byNo } from './data.js';
import { getState, settings, save } from './store.js';

// 一発正解の回数 → 次の復習までの日数
const INTERVAL_DAYS = [1, 1, 3, 7, 14];

export function today() {
  const d = new Date();
  return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);
}

export function progressOf(no) {
  const p = getState().progress;
  if (!p[no]) p[no] = { c: 0, due: 0, lastOkDay: -1, seen: 0, right: 0, wrong: 0 };
  return p[no];
}

export const hasStarted = (no) => !!getState().progress[no]?.seen;
export const isMastered = (no) => hasStarted(no) && progressOf(no).c >= settings().required;

export function dueList() {
  const t = today();
  return WORDS.filter((w) => hasStarted(w.no) && !isMastered(w.no) && progressOf(w.no).due <= t)
    .sort((a, b) => progressOf(a.no).due - progressOf(b.no).due || a.no - b.no)
    .map((w) => w.no);
}

export function nextNewRange() {
  const from = getState().learnedUpTo + 1;
  const to = Math.min(WORDS.length, from + settings().batch - 1);
  return from > WORDS.length ? null : { from, to };
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- セッション ----------
export const currentSession = () => getState().session;

export function startSession(type) {
  let items;
  let range = null;
  if (type === 'new') {
    range = nextNewRange();
    if (!range) return null;
    items = [];
    for (let n = range.from; n <= range.to; n++) items.push(n);
  } else {
    items = dueList().slice(0, settings().batch);
  }
  if (!items.length) return null;
  getState().session = {
    type, range, items, round: 1, queue: shuffle(items), i: 0,
    tried: {}, wrong: [], firstOk: 0, firstNg: 0, mastered: [],
  };
  save();
  return getState().session;
}

export function abandonSession() {
  getState().session = null;
  save();
}

// 解答を記録。セッション内で最初の解答なら進捗に反映する。
export function answer(no, ok) {
  const s = getState().session;
  const p = progressOf(no);
  const first = !s.tried[no];
  const res = { first, counted: false, mastered: false };
  if (first) {
    s.tried[no] = ok ? 'ok' : 'ng';
    const t = today();
    p.seen++;
    if (ok) {
      p.right++;
      s.firstOk++;
      if (p.lastOkDay !== t) {
        p.c++;
        p.lastOkDay = t;
        res.counted = true;
        p.due = t + INTERVAL_DAYS[Math.min(p.c, INTERVAL_DAYS.length - 1)];
        if (p.c >= settings().required) {
          res.mastered = true;
          s.mastered.push(no);
        }
      }
    } else {
      p.wrong++;
      s.firstNg++;
      p.due = t + 1;
    }
  }
  if (!ok) s.wrong.push(no);
  save();
  return res;
}

// 次の問題へ。'next' | 'round'（間違えた問題の再出題開始）| 'done'
export function advance() {
  const s = getState().session;
  s.i++;
  if (s.i < s.queue.length) {
    save();
    return 'next';
  }
  if (s.wrong.length) {
    s.round++;
    s.queue = shuffle([...new Set(s.wrong)]);
    s.wrong = [];
    s.i = 0;
    save();
    return 'round';
  }
  if (s.type === 'new') getState().learnedUpTo = Math.max(getState().learnedUpTo, s.range.to);
  const day = new Date().toISOString().slice(0, 10);
  getState().days[day] = (getState().days[day] || 0) + s.items.length;
  save();
  return 'done';
}

// 正解の言い換え＋似た誤答3つ（同じ品詞を優先、類義グループ・同一文は除外）
export function buildChoices(no) {
  const w = byNo(no);
  const ok = (o) => o.no !== no && o.def !== w.def && !(w.g && o.g === w.g);
  const samePos = shuffle(WORDS.filter((o) => ok(o) && o.pos === w.pos));
  const others = shuffle(WORDS.filter((o) => ok(o) && o.pos !== w.pos));
  const picked = [];
  for (const o of [...samePos, ...others]) {
    if (picked.length >= 3) break;
    if (picked.some((x) => x.def === o.def || (o.g && x.g === o.g))) continue;
    picked.push(o);
  }
  return shuffle([w, ...picked]).map((o) => ({ text: o.def, correct: o.no === no }));
}

// ---------- 統計 ----------
export function summary() {
  let mastered = 0, learning = 0;
  for (const w of WORDS) {
    if (isMastered(w.no)) mastered++;
    else if (hasStarted(w.no)) learning++;
  }
  const days = getState().days;
  let streak = 0;
  const key = (d) => d.toISOString().slice(0, 10);
  const todayKey = key(new Date());
  for (let d = new Date(); ; d.setDate(d.getDate() - 1)) {
    if (days[key(d)]) streak++;
    else if (streak > 0 || key(d) !== todayKey) break;
  }
  return { total: WORDS.length, mastered, learning, unseen: WORDS.length - mastered - learning, due: dueList().length, streak };
}
