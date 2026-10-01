import { CATEGORIES, KINDS } from './data.js';
import {
  MODES, MODE_LABELS, settings, getState, allWords, wordById, progressOf, hasProgress,
  updateSettings, exportJSON, importJSON, resetAll, addCustomWords, removeCustomWord, setCoachNote,
} from './store.js';
import {
  buildSession, answer, buildChoices, checkTyped, containsTerm, adaptiveParams, summary, weakWords,
  isMastered, isPassed, enabledModes, unseenWords, levelProfile,
} from './engine.js';
import { aiEnabled, gradeSentence, coach } from './ai.js';

const view = document.getElementById('view');
const $ = (sel, root = view) => root.querySelector(sel);
const $$ = (sel, root = view) => [...root.querySelectorAll(sel)];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pct = (v) => (v === null || v === undefined ? '—' : Math.round(v * 100) + '%');
const STYLE_LABELS = { choice: '選択式', hint: 'ヒント付き入力', free: '自由入力' };

function highlight(text, part) {
  const i = text.indexOf(part);
  if (i < 0) return esc(text);
  return esc(text.slice(0, i)) + '<mark>' + esc(part) + '</mark>' + esc(text.slice(i + part.length));
}

function dots(c) {
  const req = settings().required;
  return '●'.repeat(Math.min(c, req)) + '○'.repeat(Math.max(0, req - c));
}

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 0.95;
  speechSynthesis.speak(u);
}

function catChip(w) {
  return `<span class="chip ${w.c}">${CATEGORIES[w.c] || w.c}</span>` + (w.ai ? ' <span class="chip ai">AI</span>' : '');
}

// ================= タブ =================
let currentTab = 'home';
document.querySelectorAll('nav.tabs button').forEach((b) =>
  b.addEventListener('click', () => showTab(b.dataset.tab)),
);

function showTab(tab) {
  currentTab = tab;
  document.body.classList.remove('studying');
  document.querySelectorAll('nav.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('top-right').textContent = '';
  window.scrollTo(0, 0);
  if (tab === 'home') renderHome();
  else if (tab === 'words') renderWords();
  else renderSettings();
}

// ================= ホーム =================
function renderHome() {
  document.getElementById('title').textContent = 'C1 Vocab Master';
  const s = summary();
  const params = adaptiveParams();
  const lp = params.profile;
  const newAvail = Math.min(params.newPerSession, unseenWords().filter((w) => (w.lv || 2) <= params.maxLv).length);
  const weak = weakWords(6);
  const note = getState().coachNote;

  view.innerHTML = `
    <div class="card">
      <div class="stats3">
        <div><div class="num" style="color:var(--ok)">${s.mastered}</div><div class="lbl">マスター</div></div>
        <div><div class="num" style="color:var(--primary)">${s.learning}</div><div class="lbl">学習中</div></div>
        <div><div class="num">${s.unseen}</div><div class="lbl">未学習</div></div>
      </div>
      <div class="bar ok" style="margin-top:12px"><i style="width:${(s.mastered / s.total) * 100}%"></i></div>
      <div class="row spread muted small" style="margin-top:6px">
        <span>全${s.total}語中 ${Math.round((s.mastered / s.total) * 100)}% マスター</span>
        <span>🔥 ${s.streak}日連続 ・ 今日 ${s.today}問</span>
      </div>
    </div>

    <div class="card">
      <div class="row spread"><h2 style="margin:0">今日の学習</h2><span class="muted small">復習 ${s.due} ・ 新出 ${newAvail}</span></div>
      <p class="muted small" style="margin:6px 0 12px">
        各単語を「${enabledModes().map((m) => MODE_LABELS[m]).join(' → ')}」の順に、それぞれ ${settings().required} 回正解でパス。
      </p>
      <button class="btn" id="start" ${s.due + newAvail === 0 ? 'disabled' : ''}>
        ${s.due + newAvail === 0 ? '今は出題できる問題がありません' : '学習を始める'}
      </button>
      ${s.due + newAvail === 0 && s.learning > 0 ? '<button class="btn secondary" id="extra">先取り復習する</button>' : ''}
    </div>

    <div class="card">
      <h2>レベル調整の状態 ${params.fromAI ? '<span class="chip ai">AI調整中</span>' : '<span class="chip">自動</span>'}</h2>
      <div class="small">
        <div>・直近の正答率: <b>${pct(lp.overall)}</b></div>
        <div>・新出単語: 1回あたり <b>${params.newPerSession}</b> 語 / 難易度 Lv.${params.maxLv} まで</div>
        <div>・和→英の出題形式: <b>${STYLE_LABELS[params.ja2enStyle]}</b></div>
        <div>・重点カテゴリ: <b>${params.focus.length ? params.focus.map((c) => CATEGORIES[c]).join('、') : 'なし（バランス）'}</b></div>
      </div>
    </div>

    <div class="card">
      <h2>カテゴリ別</h2>
      ${Object.entries(CATEGORIES).map(([k, label]) => {
        const c = s.byCat[k] || { total: 0, mastered: 0 };
        return `<div class="barrow"><span>${label}</span><div class="bar ok"><i style="width:${c.total ? (c.mastered / c.total) * 100 : 0}%"></i></div><span class="v">${c.mastered}/${c.total}</span></div>`;
      }).join('')}
      <div class="muted small" style="margin-top:6px">正答率: ${Object.entries(CATEGORIES).map(([k, l]) => `${l} ${pct(lp.byCat[k])}`).join(' ・ ')}</div>
    </div>

    <div class="card">
      <h2>出題形式別の正答率</h2>
      ${MODES.map((m) => `<div class="barrow"><span>${MODE_LABELS[m]}</span><div class="bar"><i style="width:${(lp.byMode[m] ?? 0) * 100}%"></i></div><span class="v">${pct(lp.byMode[m])}</span></div>`).join('')}
    </div>

    ${weak.length ? `<div class="card"><h2>苦手な単語</h2>${weak.map((x) => `<div class="row spread small" style="padding:4px 0"><span><b>${esc(x.w.t)}</b> <span class="muted">${esc(x.w.ja)}</span></span><span class="muted">✕${x.wrong}</span></div>`).join('')}</div>` : ''}

    <div class="card">
      <h2>🤖 AIコーチ</h2>
      ${aiEnabled()
        ? `<p class="muted small" style="margin-top:0">学習データをAIが分析し、出題レベルを調整して、あなたに合った新しい単語を追加します。</p>
           <div class="row" style="margin-bottom:10px"><label class="small" for="nw">追加する単語数</label>
             <select id="nw" style="width:auto;padding:6px 10px;font-size:14px"><option>0</option><option selected>5</option><option>10</option></select></div>
           <button class="btn secondary" id="coach">分析・レベル調整する</button>`
        : `<p class="muted small" style="margin:0">設定画面で Anthropic の APIキーを入力すると、AIによる分析・レベル調整・例文の自動採点・単語追加が使えます（未設定でも自動調整で学習できます）。</p>`}
      <div id="coach-out">${note ? `<div class="feedback neutral" style="margin-bottom:0"><div class="muted small">${new Date(note.t).toLocaleString('ja-JP')} の分析</div><div class="coach-note">${esc(note.text)}</div></div>` : ''}</div>
    </div>
  `;

  $('#start')?.addEventListener('click', () => startSession());
  $('#extra')?.addEventListener('click', () => startSession(true));
  $('#coach')?.addEventListener('click', runCoach);
}

async function runCoach() {
  const btn = $('#coach');
  const out = $('#coach-out');
  const want = Number($('#nw').value);
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 分析中…';
  try {
    const lp = levelProfile();
    const s = summary();
    const report = {
      summary: { total: s.total, mastered: s.mastered, learning: s.learning, unseen: s.unseen, reviewBacklog: s.due, streakDays: s.streak },
      accuracy: { overall: lp.overall, byMode: lp.byMode, byCategory: lp.byCat, answeredTotal: lp.answered },
      weakWords: weakWords(15).map((x) => ({ term: x.w.t, category: x.w.c, wrong: x.wrong, right: x.right })),
      currentParams: (({ newPerSession, maxLv, ja2enStyle, focus }) => ({ newPerSession, maxLv, ja2enStyle, focus }))(adaptiveParams()),
      knownTerms: allWords().map((w) => w.t),
    };
    const r = await coach(report, want);
    updateSettings({
      aiOverride: {
        newPerSession: Math.max(0, Math.min(10, r.new_per_session)),
        maxLevel: r.max_level,
        focusCategories: r.focus_categories,
        ja2enStyle: r.ja2en_style,
        until: Date.now() + 7 * 24 * 3600 * 1000,
      },
    });
    const added = addCustomWords(r.new_words);
    const text = r.analysis_ja + (added.length ? `\n\n追加した単語: ${added.map((w) => w.t).join(', ')}` : '');
    setCoachNote({ t: Date.now(), text });
    renderHome();
  } catch (e) {
    out.innerHTML = `<div class="feedback ng"><div class="head">エラー</div>${esc(e.message)}</div>`;
    btn.disabled = false;
    btn.textContent = '分析・レベル調整する';
  }
}

// ================= 学習セッション =================
let session = null;

function startSession(extra = false) {
  let { queue, params } = buildSession();
  if (extra && queue.length === 0) {
    // 期限前の学習中カードを前倒しで出題
    const cards = [];
    for (const w of allWords()) {
      if (!hasProgress(w.id)) continue;
      const p = progressOf(w.id);
      for (const m of enabledModes()) if (p.modes[m].c > 0 && !isPassed(p, m)) cards.push({ id: w.id, mode: m });
    }
    queue = cards.sort(() => Math.random() - 0.5).slice(0, settings().sessionSize);
  }
  if (!queue.length) return;
  session = { queue, params, i: 0, right: 0, wrong: 0, passed: 0, mastered: [], requeues: {}, maxLen: queue.length * 2 + 10 };
  document.body.classList.add('studying');
  renderCard();
}

function endSession() {
  const s = session;
  document.getElementById('top-right').textContent = '';
  view.innerHTML = `
    <div class="card center">
      <div class="big-emoji">${s.wrong === 0 ? '🎉' : '👍'}</div>
      <h2 style="font-size:20px">おつかれさまでした！</h2>
      <p>正解 <b style="color:var(--ok)">${s.right}</b> ・ 不正解 <b style="color:var(--ng)">${s.wrong}</b></p>
      <p class="muted small">今回パスした項目: ${s.passed}</p>
      ${s.mastered.length ? `<p>🏆 マスター: <b>${s.mastered.map(esc).join(', ')}</b></p>` : ''}
    </div>
    <button class="btn" id="again">続けて学習する</button>
    <button class="btn ghost" id="home">ホームへ戻る</button>`;
  $('#again').addEventListener('click', () => {
    const { queue } = buildSession();
    if (queue.length) startSession();
    else showTab('home');
  });
  $('#home').addEventListener('click', () => showTab('home'));
  session = null;
}

function renderCard() {
  const s = session;
  if (s.i >= s.queue.length) return endSession();
  const card = s.queue[s.i];
  const w = wordById(card.id);
  if (!w) { s.i++; return renderCard(); }
  const pm = progressOf(card.id).modes[card.mode];

  document.getElementById('title').textContent = MODE_LABELS[card.mode];
  document.getElementById('top-right').textContent = `${s.i + 1} / ${s.queue.length}`;
  window.scrollTo(0, 0);

  const head = `
    <div class="study-top">
      <button class="iconbtn" id="quit" aria-label="終了">✕</button>
      <div class="bar"><i style="width:${(s.i / s.queue.length) * 100}%"></i></div>
    </div>
    <div class="qmeta">${catChip(w)} <span class="chip">${KINDS[w.k] || ''}</span>
      ${card.isNew && pm.right + pm.wrong === 0 ? '<span class="chip" style="background:var(--mark);color:inherit">NEW</span>' : ''}
      <span class="dots" title="正解回数">${dots(pm.c)}</span></div>`;

  const renderers = { en2ja: renderEn2Ja, ctx2ja: renderCtx2Ja, ja2en: renderJa2En, compose: renderCompose };
  view.innerHTML = head + '<div id="q"></div><div id="fb"></div><div id="next" class="sticky-next"></div>';
  $('#quit').addEventListener('click', () => {
    if (confirm('学習を終了しますか？（ここまでの結果は保存されています）')) { session = null; showTab('home'); }
  });
  renderers[card.mode](w, card);
}

function speakBtn(text) {
  return 'speechSynthesis' in window ? `<button class="iconbtn" data-say="${esc(text)}" aria-label="発音">🔊</button>` : '';
}

function bindSpeak(root = view) {
  $$('[data-say]', root).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); speak(b.dataset.say); }));
}

function exampleBlock(w) {
  return `<div class="example"><div class="en">${highlight(w.ex, w.m)} ${speakBtn(w.ex)}</div><div class="jp">${highlight(w.exJa, w.hl)}</div></div>`;
}

function choiceQuestion(w, card, promptHTML, choices) {
  $('#q').innerHTML = `<div class="prompt">${promptHTML}</div>
    <div class="choices">${choices.map((c, i) => `<button class="choice" data-i="${i}">${esc(c.text)}</button>`).join('')}</div>
    <button class="btn ghost" id="idk" style="margin-top:10px">わからない</button>`;
  bindSpeak();
  const pick = (i) => {
    const ok = i >= 0 && choices[i].correct;
    $$('.choice').forEach((b, j) => {
      b.disabled = true;
      if (choices[j].correct) b.classList.add('correct');
      else if (j === i) b.classList.add('wrong');
    });
    $('#idk').remove();
    finish(card, w, ok);
  };
  $$('.choice').forEach((b) => b.addEventListener('click', () => pick(Number(b.dataset.i))));
  $('#idk').addEventListener('click', () => pick(-1));
}

function renderEn2Ja(w, card) {
  const choices = buildChoices(w, 'en2ja', session.params.distractor.en2ja);
  choiceQuestion(w, card, `<div class="term">${esc(w.t)} ${speakBtn(w.t)}</div><div class="muted small" style="margin-top:6px">この表現の意味は？</div>`, choices);
  if (card.mode === 'en2ja' && progressOf(card.id).modes.en2ja.right === 0) speak(w.t);
}

function renderCtx2Ja(w, card) {
  const choices = buildChoices(w, 'ctx2ja', session.params.distractor.ctx2ja);
  choiceQuestion(
    w, card,
    `<div class="sentence">${highlight(w.ex, w.m)} ${speakBtn(w.ex)}</div><div class="muted small" style="margin-top:10px">マーカー部分の訳として最も適切なものは？</div>`,
    choices,
  );
}

function renderJa2En(w, card) {
  const style = session.params.ja2enStyle;
  const prompt = `<div class="ja">${esc(w.ja)}</div><div class="muted small" style="margin-top:6px">${KINDS[w.k]}・英語で言うと？</div>`;
  if (style === 'choice') {
    return choiceQuestion(w, card, prompt, buildChoices(w, 'ja2en', session.params.distractor.ja2en));
  }
  const hint = style === 'hint'
    ? `<div class="hint">${esc(w.t.replace(/[a-zA-Z]/g, (ch, i) => (i === 0 || w.t[i - 1] === ' ' ? ch : '_')))}</div>`
    : '';
  $('#q').innerHTML = `<div class="prompt">${prompt}${hint}
      <div class="example" style="text-align:left;margin-top:14px"><div class="jp">例: ${highlight(w.exJa, w.hl)}</div></div></div>
    <form id="f"><input class="text" id="ans" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="英語で入力" enterkeyhint="done" />
    <button class="btn" style="margin-top:10px">答える</button></form>
    <button class="btn ghost" id="idk">わからない</button>`;
  const input = $('#ans');
  input.focus();
  const submit = (val) => {
    const r = val === null ? 'ng' : checkTyped(w, val);
    input.disabled = true;
    $('#f button').remove();
    $('#idk').remove();
    const note = r === 'typo' ? '（スペルに注意: 正しくは <b>' + esc(w.t) + '</b>）' : '';
    finish(card, w, r !== 'ng', { note, extra: r === 'ng' && val ? `あなたの解答: ${esc(val)}` : '' });
  };
  $('#f').addEventListener('submit', (e) => { e.preventDefault(); if (input.value.trim()) submit(input.value); });
  $('#idk').addEventListener('click', () => submit(null));
}

function renderCompose(w, card) {
  $('#q').innerHTML = `<div class="prompt"><div class="term">${esc(w.t)} ${speakBtn(w.t)}</div><div class="muted">${esc(w.ja)}</div>
      <div class="muted small" style="margin-top:8px">この表現を使って英文を1つ作ってください</div></div>
    <textarea id="sent" autocapitalize="sentences" placeholder="例文を入力…"></textarea>
    <button class="btn" id="submit" style="margin-top:10px">${aiEnabled() ? 'AIに採点してもらう' : '模範例と比べる'}</button>
    <button class="btn ghost" id="skip">思いつかない</button>`;
  bindSpeak();
  const ta = $('#sent');
  ta.focus();
  $('#skip').addEventListener('click', () => {
    $('#submit').remove(); $('#skip').remove(); ta.disabled = true;
    finish(card, w, false);
  });
  $('#submit').addEventListener('click', async () => {
    const text = ta.value.trim();
    if (!text) return ta.focus();
    const btn = $('#submit');
    ta.disabled = true;
    $('#skip').remove();
    if (aiEnabled()) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> 採点中…';
      try {
        const g = await gradeSentence(w, text);
        btn.remove();
        const ok = g.uses_target_correctly && g.score >= 70;
        const extra = `<div style="margin-top:6px"><b>${g.score}点</b> ${g.natural ? '' : '（不自然な箇所あり）'}</div>
          <div>${esc(g.feedback_ja)}</div>
          ${g.corrected && g.corrected.trim() !== text ? `<div class="example"><div class="muted small">添削</div><div class="en">${esc(g.corrected)}</div></div>` : ''}
          <div class="example"><div class="muted small">AIの例文</div><div class="en">${esc(g.better_example)}</div></div>`;
        finish(card, w, ok, { extra, meta: { score: g.score } });
        return;
      } catch (e) {
        btn.remove();
        $('#fb').innerHTML = `<div class="feedback ng"><div class="head">AI採点に失敗しました</div>${esc(e.message)}<div class="small">自己採点に切り替えます。</div></div>`;
      }
    } else {
      btn.remove();
    }
    selfGrade(w, card, text);
  });
}

function selfGrade(w, card, text) {
  const has = containsTerm(w, text);
  const box = document.createElement('div');
  box.innerHTML = `<div class="feedback neutral">
      <div class="head">模範例と比べて自己採点</div>
      ${has ? '' : `<div style="color:var(--warn)" class="small">⚠️ 「${esc(w.t)}」が文中に見つかりません</div>`}
      ${exampleBlock(w)}
      <ul class="small muted" style="margin:8px 0 0;padding-left:18px">
        <li>意味（${esc(w.ja)}）どおりに使えている</li><li>文法・語形（時制・前置詞など）が正しい</li></ul>
    </div>
    <div class="row"><button class="btn" id="sg-ok" style="background:var(--ok)">◯ 正しく使えた</button></div>
    <button class="btn ghost" id="sg-ng" style="margin-top:8px">✕ 自信なし</button>`;
  $('#fb').appendChild(box);
  bindSpeak(box);
  $('#sg-ok').addEventListener('click', () => { box.remove(); finish(card, w, has, { note: has ? '' : '見出し語が含まれていないため不正解扱いです' }); });
  $('#sg-ng').addEventListener('click', () => { box.remove(); finish(card, w, false); });
}

function finish(card, w, ok, opts = {}) {
  const s = session;
  const r = answer(card, ok, opts.meta || {});
  const c = progressOf(card.id).modes[card.mode].c;
  ok ? s.right++ : s.wrong++;
  if (r.passedNow) s.passed++;
  if (r.masteredNow) s.mastered.push(w.t);

  // 再出題（1回正解・不正解の項目はセッション内でもう一度）
  const key = card.id + ':' + card.mode;
  if (r.requeueIn && (s.requeues[key] || 0) < 2 && s.queue.length < s.maxLen) {
    s.requeues[key] = (s.requeues[key] || 0) + 1;
    s.queue.splice(Math.min(s.queue.length, s.i + 1 + r.requeueIn), 0, { id: card.id, mode: card.mode });
  }
  if (r.unlocked && s.queue.length < s.maxLen) s.queue.push({ id: card.id, mode: r.unlocked });

  let status = '';
  if (r.masteredNow) status = '🏆 この単語をマスターしました！';
  else if (r.passedNow) status = `✅ 「${MODE_LABELS[card.mode]}」パス！`;
  else if (ok) status = `正解 ${c}/${settings().required}` + (c === 1 ? '（あとでもう一度出題します）' : '');
  else status = `正解カウント: ${c}/${settings().required}`;
  if (r.unlocked) status += `<br><span class="small">🔓 「${MODE_LABELS[r.unlocked]}」が解放されました</span>`;

  $('#fb').insertAdjacentHTML('beforeend', `<div class="feedback ${ok ? 'ok' : 'ng'}">
      <div class="head">${ok ? '◯ 正解' : '✕ 不正解'}</div>
      ${opts.note ? `<div class="small">${opts.note}</div>` : ''}
      <div><b>${esc(w.t)}</b> … ${esc(w.ja)} ${speakBtn(w.t)}</div>
      ${opts.extra ? `<div class="small" style="margin-top:4px">${opts.extra}</div>` : ''}
      ${exampleBlock(w)}
      <div class="small" style="margin-top:8px">${status}</div>
    </div>`);
  bindSpeak($('#fb'));
  $('#next').innerHTML = '<button class="btn" id="go">次へ</button>';
  const go = $('#go');
  go.addEventListener('click', () => { s.i++; renderCard(); });
  if (card.mode !== 'compose' && card.mode !== 'ja2en') go.focus({ preventScroll: true });
}

// ================= 単語帳 =================
let wordFilter = { status: 'all', cat: 'all', q: '' };

function wordStatus(w) {
  if (isMastered(w.id)) return 'mastered';
  if (hasProgress(w.id)) return 'learning';
  return 'unseen';
}

function renderWords() {
  document.getElementById('title').textContent = '単語帳';
  const weakIds = new Set(weakWords(1000).map((x) => x.w.id));
  const statuses = { all: 'すべて', learning: '学習中', mastered: 'マスター', unseen: '未学習', weak: '苦手' };
  const words = allWords().filter((w) => {
    if (wordFilter.cat !== 'all' && w.c !== wordFilter.cat) return false;
    if (wordFilter.status === 'weak' ? !weakIds.has(w.id) : wordFilter.status !== 'all' && wordStatus(w) !== wordFilter.status) return false;
    if (wordFilter.q && !(w.t + w.ja).toLowerCase().includes(wordFilter.q.toLowerCase())) return false;
    return true;
  });
  view.innerHTML = `
    <input class="text" id="search" placeholder="検索（英語・日本語）" value="${esc(wordFilter.q)}" style="margin-top:4px" />
    <div class="filters" id="fs">${Object.entries(statuses).map(([k, l]) => `<button data-s="${k}" class="${wordFilter.status === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="filters" id="fc" style="padding-top:0"><button data-c="all" class="${wordFilter.cat === 'all' ? 'on' : ''}">全カテゴリ</button>${Object.entries(CATEGORIES).map(([k, l]) => `<button data-c="${k}" class="${wordFilter.cat === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="card" style="padding-top:4px;padding-bottom:4px">
      ${words.length ? words.map(wordRow).join('') : '<p class="muted center">該当する単語はありません</p>'}
    </div>
    <p class="muted small center">${words.length} 語</p>`;

  $('#search').addEventListener('input', (e) => {
    wordFilter.q = e.target.value;
    const pos = e.target.selectionStart;
    renderWords();
    const el = $('#search'); el.focus(); el.setSelectionRange(pos, pos);
  });
  $$('#fs button').forEach((b) => b.addEventListener('click', () => { wordFilter.status = b.dataset.s; renderWords(); }));
  $$('#fc button').forEach((b) => b.addEventListener('click', () => { wordFilter.cat = b.dataset.c; renderWords(); }));
  $$('.wordrow').forEach((row) => row.addEventListener('click', () => {
    const d = $('.detail', row);
    d.hidden = !d.hidden;
  }));
  $$('[data-del]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (confirm('このAI追加単語を削除しますか？')) { removeCustomWord(b.dataset.del); renderWords(); }
  }));
  bindSpeak();
}

function wordRow(w) {
  const p = hasProgress(w.id) ? progressOf(w.id) : null;
  const st = wordStatus(w);
  const badge = st === 'mastered' ? '🏆' : st === 'learning' ? '📖' : '';
  return `<div class="wordrow">
    <div class="row spread"><span class="t">${badge} ${esc(w.t)}</span>${catChip(w)}</div>
    <div class="muted small">${esc(w.ja)}</div>
    ${p ? `<div class="modeprog">${enabledModes().map((m) => `<span class="${isPassed(p, m) ? 'done' : ''}">${MODE_LABELS[m]}<br><b>${dots(p.modes[m].c)}</b></span>`).join('')}</div>` : ''}
    <div class="detail" hidden>
      ${exampleBlock(w)}
      <div class="row" style="margin-top:8px">${speakBtn(w.t)}<span class="muted small">${KINDS[w.k]} ・ 難易度 Lv.${w.lv || 2}</span>
      ${w.ai ? `<button class="btn inline danger" data-del="${esc(w.id)}" style="margin-left:auto">削除</button>` : ''}</div>
    </div>
  </div>`;
}

// ================= 設定 =================
function renderSettings() {
  document.getElementById('title').textContent = '設定';
  const st = settings();
  const seg = (name, opts, cur) => `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  view.innerHTML = `
    <div class="card">
      <h2>学習ルール</h2>
      <div class="field"><label>パスに必要な正解回数（形式ごと）</label>${seg('required', [[1, '1回'], [2, '2回'], [3, '3回'], [4, '4回'], [5, '5回']], st.required)}
        <div class="muted small">1回目の正解後は同じセッション内で再出題、2回目以降は1日→3日…と間隔を空けて出題します。</div></div>
      <div class="field"><label>不正解のとき</label>${seg('wrongPenalty', [['minus1', '正解数を1減らす'], ['reset', '0に戻す']], st.wrongPenalty)}</div>
      <div class="field"><label>1回の問題数</label>${seg('sessionSize', [[10, '10'], [15, '15'], [20, '20'], [30, '30']], st.sessionSize)}</div>
      <div class="field"><label>出題形式</label>
        ${MODES.map((m) => `<label class="toggle"><span>${MODE_LABELS[m]}</span><input type="checkbox" data-mode="${m}" ${st.modes[m] ? 'checked' : ''}/></label>`).join('')}
        <div class="muted small">上から順に、前の形式で1回正解すると次の形式が出題されるようになります。</div></div>
    </div>

    <div class="card">
      <h2>AI（任意）</h2>
      <div class="field"><label for="key">Anthropic APIキー</label>
        <input class="text" id="key" type="password" autocomplete="off" placeholder="sk-ant-..." value="${esc(st.apiKey)}" />
        <div class="muted small">キーはこの端末のブラウザ内にのみ保存され、Anthropic API へ直接送信されます。エクスポートには含まれません。利用料は従量課金です。</div></div>
      <div class="field"><label for="model">モデル</label>
        <input class="text" id="model" autocomplete="off" autocapitalize="off" value="${esc(st.model)}" /></div>
      ${st.aiOverride ? `<div class="field"><div class="muted small">AIによるレベル調整が有効です（${new Date(st.aiOverride.until).toLocaleDateString('ja-JP')} まで）</div>
        <button class="btn ghost" id="clear-ov" style="margin-top:6px">AI調整を解除して自動調整に戻す</button></div>` : ''}
    </div>

    <div class="card">
      <h2>データ</h2>
      <p class="muted small" style="margin-top:0">進捗はこの端末のブラウザに保存されています。機種変更やバックアップにはエクスポートを使ってください。</p>
      <button class="btn secondary" id="export">エクスポート（JSONを保存）</button>
      <button class="btn secondary" id="import">インポート</button>
      <input type="file" id="file" accept="application/json,.json" hidden />
      <button class="btn danger" id="reset">進捗をすべてリセット</button>
    </div>
    <p class="muted small center">C1 Vocab Master ・ 収録 ${allWords().length} 語</p>`;

  $$('[data-seg]').forEach((g) => $$('button', g).forEach((b) => b.addEventListener('click', () => {
    const name = g.dataset.seg;
    const v = b.dataset.v;
    updateSettings({ [name]: name === 'wrongPenalty' ? v : Number(v) });
    renderSettings();
  })));
  $$('[data-mode]').forEach((cb) => cb.addEventListener('change', () => {
    const modes = { ...settings().modes, [cb.dataset.mode]: cb.checked };
    if (!Object.values(modes).some(Boolean)) { cb.checked = true; return alert('少なくとも1つの形式を選んでください'); }
    updateSettings({ modes });
  }));
  $('#key').addEventListener('change', (e) => updateSettings({ apiKey: e.target.value.trim() }));
  $('#model').addEventListener('change', (e) => updateSettings({ model: e.target.value.trim() || 'claude-opus-5-5' }));
  $('#clear-ov')?.addEventListener('click', () => { updateSettings({ aiOverride: null }); renderSettings(); });
  $('#export').addEventListener('click', () => {
    const blob = new Blob([exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `c1vocab-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#import').addEventListener('click', () => $('#file').click());
  $('#file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      importJSON(await f.text());
      alert('インポートしました');
      renderSettings();
    } catch (err) {
      alert('インポートに失敗しました: ' + err.message);
    }
  });
  $('#reset').addEventListener('click', () => {
    if (confirm('学習進捗・AI追加単語をすべて削除します。よろしいですか？')) { resetAll(); renderSettings(); }
  });
}

// ================= 起動 =================
showTab('home');
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
