import { WORDS, POS, byNo, pad } from './data.js';
import { settings, updateSettings, exportJSON, importJSON, resetAll } from './store.js';
import {
  startSession, currentSession, abandonSession, answer, advance, buildChoices, summary,
  nextNewRange, progressOf, hasStarted, isMastered, dueList,
} from './engine.js';

const APP_NAME = 'Phrase Master 400';
const view = document.getElementById('view');
const $ = (sel, root = view) => root.querySelector(sel);
const $$ = (sel, root = view) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function dots(c) {
  const req = settings().required;
  return '●'.repeat(Math.min(c, req)) + '○'.repeat(Math.max(0, req - c));
}

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/\b(sth|sb)\b/g, (m) => (m === 'sth' ? 'something' : 'somebody')));
  u.lang = 'en-US';
  u.rate = 0.95;
  speechSynthesis.speak(u);
}

const speakBtn = (text) =>
  'speechSynthesis' in window ? `<button class="iconbtn" data-say="${esc(text)}" aria-label="発音">🔊</button>` : '';

function bindSpeak(root = view) {
  $$('[data-say]', root).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); speak(b.dataset.say); }));
}

function setHeader(title, right = '') {
  document.getElementById('title').textContent = title;
  document.getElementById('top-right').textContent = right;
}

// ================= タブ =================
document.querySelectorAll('nav.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

function showTab(tab) {
  document.body.classList.remove('studying');
  document.querySelectorAll('nav.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  window.scrollTo(0, 0);
  if (tab === 'home') renderHome();
  else if (tab === 'words') renderWords();
  else renderSettings();
}

// ================= ホーム =================
function renderHome() {
  setHeader(APP_NAME);
  const s = summary();
  const range = nextNewRange();
  const sess = currentSession();
  const batch = settings().batch;

  view.innerHTML = `
    <div class="card">
      <div class="stats3">
        <div><div class="num" style="color:var(--ok)">${s.mastered}</div><div class="lbl">マスター</div></div>
        <div><div class="num" style="color:var(--primary)">${s.learning}</div><div class="lbl">学習中</div></div>
        <div><div class="num">${s.unseen}</div><div class="lbl">未学習</div></div>
      </div>
      <div class="bar ok" style="margin-top:12px"><i style="width:${(s.mastered / s.total) * 100}%"></i></div>
      <div class="row spread muted small" style="margin-top:6px">
        <span>${s.total}語中 ${s.mastered}語マスター</span><span>🔥 ${s.streak}日連続</span>
      </div>
    </div>

    ${sess ? `
    <div class="card">
      <h2>学習の途中です</h2>
      <p class="muted small" style="margin-top:0">${sess.type === 'new' ? `No.${pad(sess.range.from)}–${pad(sess.range.to)}` : '復習'} ・ ラウンド${sess.round} ・ ${sess.i + 1}/${sess.queue.length}問目</p>
      <button class="btn" id="resume">続きから再開</button>
      <button class="btn ghost" id="discard">中断して破棄</button>
    </div>` : `
    <div class="card">
      <div class="row spread"><h2 style="margin:0">復習</h2><span class="muted small">期限の来た語: ${s.due}</span></div>
      <p class="muted small" style="margin:6px 0 12px">前日までに学んだ語を${batch}語ずつ。間違えた語は全問正解するまで繰り返します。</p>
      <button class="btn" id="review" ${s.due ? '' : 'disabled'}>${s.due ? `復習する（${Math.min(s.due, batch)}語）` : '今日の復習はありません'}</button>
    </div>
    <div class="card">
      <div class="row spread"><h2 style="margin:0">新しい語を学ぶ</h2><span class="muted small">${range ? `No.${pad(range.from)}–${pad(range.to)}` : ''}</span></div>
      <p class="muted small" style="margin:6px 0 12px">${range ? `${range.to - range.from + 1}語を一気に出題。全問正解したら次の${batch}語に進めます。` : '400語すべてに取り組みました！あとは復習でマスターを目指しましょう。'}</p>
      <button class="btn ${s.due ? 'secondary' : ''}" id="new" ${range ? '' : 'disabled'}>${range ? '新しい語を始める' : '完了'}</button>
    </div>`}

    <div class="card">
      <h2>ルール</h2>
      <ul class="small" style="margin:0;padding-left:18px">
        <li>フレーズを見て、意味に合う英語の言い換えを4択から選びます。</li>
        <li>セッションで最初の解答が正解だと「一発正解」。1日1回まで数え、通算${settings().required}回でマスター。</li>
        <li>一発正解できた語は 1日後 → 3日後… に、間違えた語は翌日に復習します。</li>
      </ul>
    </div>`;

  $('#resume')?.addEventListener('click', () => beginStudy());
  $('#discard')?.addEventListener('click', () => {
    if (confirm('このセッションを破棄しますか？（解答済みの記録は残ります）')) { abandonSession(); renderHome(); }
  });
  $('#review')?.addEventListener('click', () => { if (startSession('review')) beginStudy(); });
  $('#new')?.addEventListener('click', () => { if (startSession('new')) beginStudy(); });
}

// ================= 学習 =================
function beginStudy() {
  document.body.classList.add('studying');
  renderQuestion();
}

function renderQuestion() {
  const s = currentSession();
  const no = s.queue[s.i];
  const w = byNo(no);
  const p = progressOf(no);
  const choices = buildChoices(no);
  const label = s.type === 'new' ? `No.${pad(s.range.from)}–${pad(s.range.to)}` : '復習';
  setHeader(label, `R${s.round} ・ ${s.i + 1}/${s.queue.length}`);
  window.scrollTo(0, 0);

  view.innerHTML = `
    <div class="study-top">
      <button class="iconbtn" id="quit" aria-label="中断">✕</button>
      <div class="bar"><i style="width:${(s.i / s.queue.length) * 100}%"></i></div>
    </div>
    <div class="qmeta">
      <span class="chip">No.${pad(no)}</span><span class="chip">${POS[w.pos]}</span>
      ${s.round > 1 ? `<span class="chip" style="background:var(--ng-weak);color:var(--ng)">再出題</span>` : ''}
      <span class="dots" title="一発正解の回数">${dots(p.c)}</span>
    </div>
    <div class="prompt">
      <div class="term">${esc(w.t)} ${speakBtn(w.t)}</div>
      <div class="muted small" style="margin-top:6px">このフレーズの意味は？</div>
    </div>
    <div class="choices">${choices.map((c, i) => `<button class="choice" data-i="${i}">${esc(c.text)}</button>`).join('')}</div>
    <button class="btn ghost" id="idk" style="margin-top:10px">わからない</button>
    <div id="fb"></div>
    <div id="next" class="sticky-next"></div>`;
  bindSpeak();

  $('#quit').addEventListener('click', () => {
    if (confirm('中断しますか？ホームの「続きから再開」で再開できます。')) showTab('home');
  });

  const pick = (i) => {
    const ok = i >= 0 && choices[i].correct;
    $$('.choice').forEach((b, j) => {
      b.disabled = true;
      if (choices[j].correct) b.classList.add('correct');
      else if (j === i) b.classList.add('wrong');
    });
    $('#idk').remove();
    const r = answer(no, ok);
    showFeedback(w, ok, r);
  };
  $$('.choice').forEach((b) => b.addEventListener('click', () => pick(Number(b.dataset.i))));
  $('#idk').addEventListener('click', () => pick(-1));
}

function showFeedback(w, ok, r) {
  const p = progressOf(w.no);
  const req = settings().required;
  let status;
  if (r.mastered) status = '🏆 マスターしました！';
  else if (r.first && ok && r.counted) status = `一発正解 ${p.c}/${req}`;
  else if (r.first && ok) status = `一発正解（今日はカウント済み） ${p.c}/${req}`;
  else if (r.first) status = `一発正解 ${p.c}/${req} ・ このあともう一度出題します`;
  else status = ok ? '再出題で正解' : 'このあともう一度出題します';

  $('#fb').innerHTML = `
    <div class="feedback ${ok ? 'ok' : 'ng'}">
      <div class="head">${ok ? '◯ 正解' : '✕ 不正解'}</div>
      <div><b>${esc(w.t)}</b> ${speakBtn(w.t)}</div>
      <div class="small">= ${esc(w.def)}</div>
      <div style="margin-top:6px">${esc(w.ja)}</div>
      <div class="example"><div class="en">${esc(w.ex)} ${speakBtn(w.ex)}</div><div class="jp">${esc(w.exJa)}</div></div>
      <div class="small" style="margin-top:8px">${status}</div>
    </div>`;
  bindSpeak($('#fb'));
  $('#next').innerHTML = '<button class="btn" id="go">次へ</button>';
  $('#go').addEventListener('click', onNext);
  $('#go').focus({ preventScroll: true });
}

function onNext() {
  const res = advance();
  if (res === 'next') return renderQuestion();
  const s = currentSession();
  if (res === 'round') {
    setHeader('もう一度', '');
    view.innerHTML = `
      <div class="card center">
        <div class="big-emoji">🔁</div>
        <h2 style="font-size:20px">ラウンド${s.round}</h2>
        <p>間違えた <b>${s.queue.length}問</b> をもう一度出題します。<br>全問正解するまで続けましょう。</p>
      </div>
      <button class="btn" id="go">始める</button>`;
    $('#go').addEventListener('click', renderQuestion);
    return;
  }
  // done
  const total = s.items.length;
  abandonSession();
  setHeader('完了', '');
  const range = nextNewRange();
  const due = dueList().length;
  view.innerHTML = `
    <div class="card center">
      <div class="big-emoji">${s.firstNg === 0 ? '🎉' : '👍'}</div>
      <h2 style="font-size:20px">全問正解しました！</h2>
      <p>一発正解 <b style="color:var(--ok)">${s.firstOk}</b> / ${total} ・ ラウンド数 ${s.round}</p>
      ${s.mastered.length ? `<p>🏆 マスター: <b>${s.mastered.map((n) => esc(byNo(n).t)).join(', ')}</b></p>` : ''}
    </div>
    ${due ? `<button class="btn" id="rev">続けて復習する（残り${due}語）</button>` : ''}
    ${range ? `<button class="btn ${due ? 'secondary' : ''}" id="nx">次の${range.to - range.from + 1}語へ（No.${pad(range.from)}–${pad(range.to)}）</button>` : ''}
    <button class="btn ghost" id="home">ホームへ戻る</button>`;
  $('#rev')?.addEventListener('click', () => { if (startSession('review')) beginStudy(); });
  $('#nx')?.addEventListener('click', () => { if (startSession('new')) beginStudy(); });
  $('#home').addEventListener('click', () => showTab('home'));
}

// ================= 単語帳 =================
let filter = { status: 'all', block: 0, q: '' };

function statusOf(no) {
  if (isMastered(no)) return 'mastered';
  if (hasStarted(no)) return 'learning';
  return 'unseen';
}

function renderWords() {
  setHeader('単語帳');
  const statuses = { all: 'すべて', learning: '学習中', mastered: 'マスター', unseen: '未学習' };
  const blocks = [0, 1, 2, 3, 4];
  const list = WORDS.filter((w) => {
    if (filter.block && Math.ceil(w.no / 100) !== filter.block) return false;
    if (filter.status !== 'all' && statusOf(w.no) !== filter.status) return false;
    if (filter.q && !(w.t + ' ' + w.ja + ' ' + w.def + ' ' + pad(w.no)).toLowerCase().includes(filter.q.toLowerCase())) return false;
    return true;
  });
  view.innerHTML = `
    <input class="text" id="search" placeholder="検索（英語・日本語・番号）" value="${esc(filter.q)}" style="margin-top:4px" />
    <div class="filters" id="fs">${Object.entries(statuses).map(([k, l]) => `<button data-s="${k}" class="${filter.status === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="filters" id="fb" style="padding-top:0">${blocks.map((b) => `<button data-b="${b}" class="${filter.block === b ? 'on' : ''}">${b ? `${pad((b - 1) * 100 + 1)}–${pad(b * 100)}` : '全番号'}</button>`).join('')}</div>
    <div class="card" style="padding-top:4px;padding-bottom:4px">
      ${list.length ? list.map(wordRow).join('') : '<p class="muted center">該当する語はありません</p>'}
    </div>
    <p class="muted small center">${list.length} 語</p>`;

  $('#search').addEventListener('input', (e) => {
    filter.q = e.target.value;
    const pos = e.target.selectionStart;
    renderWords();
    const el = $('#search'); el.focus(); el.setSelectionRange(pos, pos);
  });
  $$('#fs button').forEach((b) => b.addEventListener('click', () => { filter.status = b.dataset.s; renderWords(); }));
  $$('#fb button').forEach((b) => b.addEventListener('click', () => { filter.block = Number(b.dataset.b); renderWords(); }));
  $$('.wordrow').forEach((row) => row.addEventListener('click', () => { const d = $('.detail', row); d.hidden = !d.hidden; }));
  bindSpeak();
}

function wordRow(w) {
  const st = statusOf(w.no);
  const p = hasStarted(w.no) ? progressOf(w.no) : null;
  const badge = st === 'mastered' ? '🏆' : '';
  return `<div class="wordrow">
    <div class="row spread"><span class="t"><span class="muted small">${pad(w.no)}</span> ${badge} ${esc(w.t)}</span>
      <span class="dots" style="${st === 'mastered' ? 'color:var(--ok)' : ''}">${p ? dots(p.c) : ''}</span></div>
    <div class="muted small">${esc(w.ja)}</div>
    <div class="detail" hidden>
      <div class="small" style="margin-top:6px">= ${esc(w.def)}</div>
      <div class="example"><div class="en">${esc(w.ex)} ${speakBtn(w.ex)}</div><div class="jp">${esc(w.exJa)}</div></div>
      ${p ? `<div class="muted small" style="margin-top:6px">正解 ${p.right} ・ 不正解 ${p.wrong}</div>` : ''}
    </div>
  </div>`;
}

// ================= 設定 =================
function renderSettings() {
  setHeader('設定');
  const st = settings();
  const seg = (name, opts, cur) => `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  view.innerHTML = `
    <div class="card">
      <h2>学習ルール</h2>
      <div class="field"><label>マスターに必要な一発正解の回数</label>${seg('required', [[1, '1回'], [2, '2回'], [3, '3回'], [4, '4回'], [5, '5回']], st.required)}
        <div class="muted small">一発正解は1日1回まで数えます。</div></div>
      <div class="field"><label>1回に学ぶ数</label>${seg('batch', [[10, '10'], [20, '20'], [30, '30']], st.batch)}</div>
    </div>
    <div class="card">
      <h2>データ</h2>
      <p class="muted small" style="margin-top:0">進捗はこの端末のブラウザに保存されています。機種変更やバックアップにはエクスポートを使ってください。</p>
      <button class="btn secondary" id="export">エクスポート（JSONを保存）</button>
      <button class="btn secondary" id="import">インポート</button>
      <input type="file" id="file" accept="application/json,.json" hidden />
      <button class="btn danger" id="reset">進捗をすべてリセット</button>
    </div>
    <p class="muted small center">${APP_NAME} ・ 収録 ${WORDS.length} 語</p>`;

  $$('[data-seg]').forEach((g) => $$('button', g).forEach((b) => b.addEventListener('click', () => {
    updateSettings({ [g.dataset.seg]: Number(b.dataset.v) });
    renderSettings();
  })));
  $('#export').addEventListener('click', () => {
    const blob = new Blob([exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `phrase400-${new Date().toISOString().slice(0, 10)}.json`;
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
    if (confirm('学習進捗をすべて削除します。よろしいですか？')) { resetAll(); renderSettings(); }
  });
}

// ================= 起動 =================
showTab('home');
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
