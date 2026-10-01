// 進捗・設定・AI追加単語を localStorage に保存する。
import { WORDS } from './data.js';

const KEY = 'c1vocab.v1';

export const MODES = ['en2ja', 'ctx2ja', 'ja2en', 'compose'];
export const MODE_LABELS = {
  en2ja: '英→和',
  ctx2ja: '例文→和訳',
  ja2en: '和→英',
  compose: '例文作成',
};

const DEFAULT_SETTINGS = {
  required: 3,           // パスに必要な正解回数（モードごと）
  wrongPenalty: 'minus1', // 'minus1' | 'reset'
  sessionSize: 15,
  modes: { en2ja: true, ctx2ja: true, ja2en: true, compose: true },
  apiKey: '',
  model: 'claude-opus-5-5',
  aiOverride: null,      // AIコーチが提案した調整 { newPerSession, focusCategories, ja2enStyle, until }
};

function fresh() {
  return { settings: { ...DEFAULT_SETTINGS }, progress: {}, history: [], customWords: [], days: {}, coachNote: null };
}

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const s = JSON.parse(raw);
    const base = fresh();
    return {
      ...base,
      ...s,
      settings: { ...base.settings, ...s.settings, modes: { ...base.settings.modes, ...(s.settings?.modes || {}) } },
    };
  } catch {
    return fresh();
  }
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('保存に失敗しました', e);
  }
}

export const getState = () => state;
export const settings = () => state.settings;

export function allWords() {
  return [...WORDS, ...state.customWords];
}

export function wordById(id) {
  return allWords().find((w) => w.id === id);
}

export function addCustomWords(words) {
  const existing = new Set(allWords().map((w) => w.t.toLowerCase()));
  const added = [];
  for (const w of words) {
    if (!w || !w.t || existing.has(w.t.toLowerCase())) continue;
    const id = 'ai-' + w.t.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString(36);
    const word = { ...w, id, ai: true };
    state.customWords.push(word);
    existing.add(w.t.toLowerCase());
    added.push(word);
  }
  save();
  return added;
}

export function removeCustomWord(id) {
  state.customWords = state.customWords.filter((w) => w.id !== id);
  delete state.progress[id];
  save();
}

export function progressOf(id) {
  if (!state.progress[id]) {
    const modes = {};
    for (const m of MODES) modes[m] = { c: 0, due: 0, right: 0, wrong: 0 };
    state.progress[id] = { introduced: 0, modes, lapses: 0 };
  }
  return state.progress[id];
}

export function hasProgress(id) {
  return !!state.progress[id]?.introduced;
}

export function logAnswer(entry) {
  state.history.push({ t: Date.now(), ...entry });
  if (state.history.length > 3000) state.history.splice(0, state.history.length - 3000);
  const day = new Date().toISOString().slice(0, 10);
  state.days[day] = (state.days[day] || 0) + 1;
}

export function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  save();
}

export function setCoachNote(note) {
  state.coachNote = note;
  save();
}

export function exportJSON() {
  return JSON.stringify({ ...state, settings: { ...state.settings, apiKey: '' } }, null, 2);
}

export function importJSON(text) {
  const s = JSON.parse(text);
  if (!s || typeof s !== 'object' || !s.progress) throw new Error('形式が正しくありません');
  const key = state.settings.apiKey;
  localStorage.setItem(KEY, JSON.stringify(s));
  state = load();
  if (!state.settings.apiKey) state.settings.apiKey = key;
  save();
}

export function resetAll() {
  const key = state.settings.apiKey;
  state = fresh();
  state.settings.apiKey = key;
  save();
}
