// 進捗・設定・学習中セッションを localStorage に保存する。
const KEY = 'phrase400.v1';

const DEFAULT_SETTINGS = {
  required: 3, // マスターに必要な「一発正解」の回数（1日1回まで数える）
  batch: 20, // 1回に学ぶ数
};

function fresh() {
  return { settings: { ...DEFAULT_SETTINGS }, progress: {}, learnedUpTo: 0, session: null, days: {} };
}

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const s = JSON.parse(raw);
    return { ...fresh(), ...s, settings: { ...DEFAULT_SETTINGS, ...s.settings } };
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

export function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  save();
}

export function exportJSON() {
  return JSON.stringify(state, null, 2);
}

export function importJSON(text) {
  const s = JSON.parse(text);
  if (!s || typeof s !== 'object' || !s.progress) throw new Error('形式が正しくありません');
  localStorage.setItem(KEY, JSON.stringify(s));
  state = load();
}

export function resetAll() {
  state = fresh();
  save();
}
