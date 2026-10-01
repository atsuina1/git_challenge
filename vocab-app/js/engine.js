// 出題スケジュール・合否判定・ルールベースのレベル調整。
import {
  MODES, settings, getState, allWords, wordById, progressOf, hasProgress, logAnswer, save,
} from './store.js';

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
// n回目の正解後に次に出題するまでの間隔（1回目は同じセッション内で再出題）
const INTERVALS = [10 * MIN, 1 * DAY, 3 * DAY, 7 * DAY, 14 * DAY];

export const enabledModes = () => MODES.filter((m) => settings().modes[m]);

export function isPassed(p, mode) {
  return p.modes[mode].c >= settings().required;
}

export function isMastered(id) {
  if (!hasProgress(id)) return false;
  const p = progressOf(id);
  return enabledModes().every((m) => isPassed(p, m));
}

// 認識（英→和）から産出（例文作成）へ、前のモードで1回正解すると次のモードが解放される
export function isUnlocked(p, mode) {
  const modes = enabledModes();
  const i = modes.indexOf(mode);
  if (i <= 0) return i === 0;
  return p.modes[modes[i - 1]].c >= 1;
}

// ---------- 理解度の推定 ----------
function accuracy(entries) {
  if (entries.length === 0) return null;
  return entries.filter((e) => e.ok).length / entries.length;
}

export function levelProfile() {
  const h = getState().history;
  const recent = h.slice(-60);
  const byMode = {};
  for (const m of MODES) byMode[m] = accuracy(h.filter((e) => e.mode === m).slice(-30));
  const byCat = {};
  for (const c of ['daily', 'biz', 'it']) byCat[c] = accuracy(h.filter((e) => e.cat === c).slice(-40));
  const overall = accuracy(recent);
  return { overall, byMode, byCat, answered: h.length };
}

// 正答率から出題パラメータを決める。AIコーチの提案があれば優先する。
export function adaptiveParams() {
  const lp = levelProfile();
  const ov = activeOverride();
  const acc = lp.overall;

  let newPerSession = 5;
  if (acc !== null) {
    if (acc >= 0.85) newPerSession = 8;
    else if (acc >= 0.7) newPerSession = 5;
    else if (acc >= 0.55) newPerSession = 3;
    else newPerSession = 1;
  }
  const backlog = dueCards().length;
  if (backlog > settings().sessionSize * 2) newPerSession = 0;

  let maxLv = 2;
  if (acc !== null && lp.answered >= 20) maxLv = acc >= 0.8 ? 3 : acc >= 0.6 ? 2 : 1;

  const distractor = {};
  for (const m of MODES) {
    const a = lp.byMode[m];
    distractor[m] = a === null ? 'normal' : a >= 0.8 ? 'hard' : a >= 0.6 ? 'normal' : 'easy';
  }

  const aJ = lp.byMode.ja2en;
  let ja2enStyle = aJ === null ? 'hint' : aJ >= 0.85 ? 'free' : aJ >= 0.55 ? 'hint' : 'choice';

  let focus = [];
  // 正答率が低いカテゴリを苦手として優先復習
  const cats = Object.entries(lp.byCat).filter(([, v]) => v !== null && v < 0.7).sort((a, b) => a[1] - b[1]);
  focus = cats.map(([c]) => c);

  if (ov) {
    if (Number.isFinite(ov.newPerSession) && backlog <= settings().sessionSize * 2) newPerSession = ov.newPerSession;
    if (Array.isArray(ov.focusCategories) && ov.focusCategories.length) focus = ov.focusCategories;
    if (['choice', 'hint', 'free'].includes(ov.ja2enStyle)) ja2enStyle = ov.ja2enStyle;
    if ([1, 2, 3].includes(ov.maxLevel)) maxLv = ov.maxLevel;
  }

  return { newPerSession, maxLv, distractor, ja2enStyle, focus, profile: lp, fromAI: !!ov };
}

function activeOverride() {
  const ov = settings().aiOverride;
  if (!ov) return null;
  if (ov.until && Date.now() > ov.until) return null;
  return ov;
}

// ---------- セッション生成 ----------
export function dueCards(now = Date.now()) {
  const cards = [];
  for (const w of allWords()) {
    if (!hasProgress(w.id)) continue;
    const p = progressOf(w.id);
    for (const m of enabledModes()) {
      if (!isUnlocked(p, m) || isPassed(p, m)) continue;
      if (p.modes[m].due <= now) cards.push({ id: w.id, mode: m });
    }
  }
  return cards;
}

export function unseenWords() {
  return allWords().filter((w) => !hasProgress(w.id));
}

function weakness(card, focus) {
  const w = wordById(card.id);
  const pm = progressOf(card.id).modes[card.mode];
  let s = (pm.wrong + 1) / (pm.right + pm.wrong + 2);
  if (focus.includes(w.c)) s += 0.3;
  s += Math.min(0.3, (Date.now() - pm.due) / (7 * DAY));
  return s + Math.random() * 0.1;
}

export function buildSession() {
  const params = adaptiveParams();
  const size = settings().sessionSize;
  const due = dueCards().sort((a, b) => weakness(b, params.focus) - weakness(a, params.focus));

  const newCount = Math.min(params.newPerSession, Math.max(0, size - Math.min(due.length, size - 1)));
  const introduced = {};
  for (const w of allWords()) if (hasProgress(w.id)) introduced[w.c] = (introduced[w.c] || 0) + 1;

  const candidates = unseenWords()
    .filter((w) => (w.lv || 2) <= params.maxLv)
    .sort((a, b) => {
      const fa = params.focus.includes(a.c) ? 0 : 1;
      const fb = params.focus.includes(b.c) ? 0 : 1;
      if (fa !== fb) return fa - fb;
      const ia = introduced[a.c] || 0, ib = introduced[b.c] || 0;
      if (ia !== ib) return ia - ib; // カテゴリが偏らないように
      return (a.lv || 2) - (b.lv || 2) || Math.random() - 0.5;
    });
  const fresh = [];
  for (const w of candidates) {
    if (fresh.length >= newCount) break;
    fresh.push(w);
    introduced[w.c] = (introduced[w.c] || 0) + 1;
  }

  const queue = due.slice(0, size - fresh.length);
  // 新出単語は復習の合間に混ぜる
  fresh.forEach((w, i) => {
    const pos = Math.min(queue.length, Math.floor(((i + 1) * queue.length) / (fresh.length + 1)) + i);
    queue.splice(pos, 0, { id: w.id, mode: enabledModes()[0], isNew: true });
  });
  return { queue, params };
}

// ---------- 解答処理 ----------
export function answer(card, ok, meta = {}) {
  const w = wordById(card.id);
  const p = progressOf(card.id);
  if (!p.introduced) p.introduced = Date.now();
  const pm = p.modes[card.mode];
  const req = settings().required;
  const result = { passedNow: false, masteredNow: false, requeueIn: null, unlocked: null };
  const wasMastered = isMastered(card.id);

  if (ok) {
    pm.right++;
    pm.c = Math.min(req, pm.c + 1);
    if (pm.c >= req) {
      result.passedNow = true;
      pm.due = Number.MAX_SAFE_INTEGER;
    } else {
      const base = INTERVALS[Math.min(pm.c - 1, INTERVALS.length - 1)];
      // 間違いが多い単語は間隔を短めにする
      const factor = p.lapses >= 3 ? 0.5 : p.lapses >= 1 ? 0.75 : 1;
      pm.due = Date.now() + (pm.c === 1 ? base : base * factor);
      if (pm.c === 1) result.requeueIn = 5; // 1回目の正解はセッション内でもう一度
    }
    if (pm.c === 1) {
      const modes = enabledModes();
      const next = modes[modes.indexOf(card.mode) + 1];
      if (next && p.modes[next].c === 0) {
        p.modes[next].due = Date.now();
        result.unlocked = next;
      }
    }
  } else {
    pm.wrong++;
    p.lapses++;
    pm.c = settings().wrongPenalty === 'reset' ? 0 : Math.max(0, pm.c - 1);
    pm.due = Date.now();
    result.requeueIn = 3;
  }

  result.masteredNow = !wasMastered && isMastered(card.id);
  logAnswer({ id: card.id, mode: card.mode, ok, cat: w.c, ...meta });
  save();
  return result;
}

// ---------- 選択肢・判定 ----------
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function buildChoices(word, mode, strategy, n = 4) {
  const field = mode === 'en2ja' ? 'ja' : mode === 'ctx2ja' ? 'hl' : 't';
  let pool = allWords().filter((w) => w.id !== word.id && w[field] !== word[field]);
  if (strategy === 'hard') {
    const close = pool.filter((w) => w.c === word.c && w.k === word.k);
    const same = pool.filter((w) => w.c === word.c);
    pool = close.length >= n - 1 ? close : same.length >= n - 1 ? same : pool;
  } else if (strategy === 'normal') {
    const same = pool.filter((w) => w.k === word.k);
    if (same.length >= n - 1) pool = same;
  }
  const distractors = shuffle(pool).slice(0, n - 1).map((w) => w[field]);
  return shuffle([word[field], ...distractors]).map((text) => ({ text, correct: text === word[field] }));
}

const PLACEHOLDERS = /\b(sth|sb|something|someone|somebody|one's|oneself)\b/g;

export function normalize(s) {
  return s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[-–—]/g, ' ')
    .replace(PLACEHOLDERS, ' ')
    .replace(/[^a-z' ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function lev(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

// 和→英の入力判定: 'ok' | 'typo' | 'ng'
export function checkTyped(word, input) {
  const got = normalize(input);
  if (!got) return 'ng';
  const answers = [word.t, ...(word.alt || [])].map(normalize);
  if (answers.includes(got)) return 'ok';
  if (answers.some((a) => a.length >= 6 && lev(a, got) <= 1)) return 'typo';
  return 'ng';
}

// 例文作成（AIなし）: 見出し語の主要部分が文中に含まれているか簡易チェック（警告表示のみに使う）
export function containsTerm(word, sentence) {
  const s = normalize(sentence);
  const tokens = normalize(word.t).split(' ').filter((t) => t && !['a', 'the', 'my', 'your'].includes(t));
  return tokens.every((t) => {
    const stem = t.length > 4 ? t.slice(0, Math.max(3, t.length - 3)) : t; // 不規則変化(throw→threw)も拾えるよう短めに
    return s.split(' ').some((x) => x.startsWith(stem));
  });
}

// ---------- 統計 ----------
export function summary() {
  const words = allWords();
  let mastered = 0, learning = 0;
  for (const w of words) {
    if (isMastered(w.id)) mastered++;
    else if (hasProgress(w.id)) learning++;
  }
  const byCat = {};
  for (const w of words) {
    byCat[w.c] = byCat[w.c] || { total: 0, mastered: 0 };
    byCat[w.c].total++;
    if (isMastered(w.id)) byCat[w.c].mastered++;
  }
  const days = getState().days;
  let streak = 0;
  for (let d = new Date(); ; d.setDate(d.getDate() - 1)) {
    const key = d.toISOString().slice(0, 10);
    if (days[key]) streak++;
    else if (streak > 0 || key !== new Date().toISOString().slice(0, 10)) break;
  }
  const today = days[new Date().toISOString().slice(0, 10)] || 0;
  return { total: words.length, mastered, learning, unseen: words.length - mastered - learning, byCat, streak, today, due: dueCards().length };
}

export function weakWords(limit = 10) {
  return allWords()
    .filter((w) => hasProgress(w.id))
    .map((w) => {
      const p = progressOf(w.id);
      const wrong = MODES.reduce((s, m) => s + p.modes[m].wrong, 0);
      const right = MODES.reduce((s, m) => s + p.modes[m].right, 0);
      return { w, wrong, right };
    })
    .filter((x) => x.wrong > 0)
    .sort((a, b) => b.wrong / (b.right + b.wrong) - a.wrong / (a.right + a.wrong) || b.wrong - a.wrong)
    .slice(0, limit);
}
