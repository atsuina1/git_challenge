// Claude API 連携（任意機能）。APIキーは端末の localStorage にのみ保存され、Anthropic API へ直接送信される。
import { settings } from './store.js';

let sdk = null;

async function client() {
  const key = settings().apiKey;
  if (!key) throw new Error('APIキーが設定されていません（設定画面で入力してください）');
  if (!sdk) sdk = await import('https://esm.sh/@anthropic-ai/sdk');
  const Anthropic = sdk.default;
  return { Anthropic, client: new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true }) };
}

export const aiEnabled = () => !!settings().apiKey;

async function askJSON({ system, prompt, schema, effort = 'low', maxTokens = 4000 }) {
  const { Anthropic, client: c } = await client();
  let res;
  try {
    res = await c.beta.messages.create({
      model: settings().model || 'claude-opus-5-5',
      max_tokens: maxTokens,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort, format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('APIキーが無効です');
    if (e instanceof Anthropic.RateLimitError) throw new Error('リクエストが多すぎます。少し待ってから再試行してください');
    if (e instanceof Anthropic.APIConnectionError) throw new Error('ネットワークに接続できません');
    if (e instanceof Anthropic.APIError) throw new Error(`APIエラー (${e.status ?? '?'}): ${e.message}`);
    throw e;
  }
  if (res.stop_reason === 'refusal') throw new Error('AIが応答を拒否しました');
  if (res.stop_reason === 'max_tokens') throw new Error('AIの応答が途中で切れました');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text);
}

const GRADE_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'integer', description: '0-100' },
    uses_target_correctly: { type: 'boolean' },
    natural: { type: 'boolean' },
    feedback_ja: { type: 'string' },
    corrected: { type: 'string' },
    better_example: { type: 'string' },
  },
  required: ['score', 'uses_target_correctly', 'natural', 'feedback_ja', 'corrected', 'better_example'],
  additionalProperties: false,
};

export async function gradeSentence(word, sentence) {
  const r = await askJSON({
    system:
      'You are an English coach for a Japanese professional studying C1-level vocabulary for daily and business (especially IT) conversation. ' +
      'Grade whether the learner used the target expression correctly and naturally. Write feedback_ja in concise Japanese (2-4 sentences). ' +
      '"corrected" is the learner\'s sentence minimally fixed (identical if already fine). "better_example" is one natural C1-level example using the target.',
    prompt:
      `Target expression: "${word.t}" (meaning: ${word.ja})\n` +
      `Learner's sentence: """${sentence}"""\n\n` +
      'Scoring: 80-100 = correct meaning and grammar, natural; 60-79 = correct meaning with minor errors; below 60 = misused or missing the target.',
    schema: GRADE_SCHEMA,
  });
  return r;
}

const COACH_SCHEMA = {
  type: 'object',
  properties: {
    analysis_ja: { type: 'string' },
    new_per_session: { type: 'integer' },
    max_level: { type: 'integer', enum: [1, 2, 3] },
    focus_categories: { type: 'array', items: { type: 'string', enum: ['daily', 'biz', 'it'] } },
    ja2en_style: { type: 'string', enum: ['choice', 'hint', 'free'] },
    new_words: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          t: { type: 'string' },
          k: { type: 'string', enum: ['word', 'idiom', 'phrase'] },
          c: { type: 'string', enum: ['daily', 'biz', 'it'] },
          lv: { type: 'integer', enum: [1, 2, 3] },
          ja: { type: 'string' },
          ex: { type: 'string' },
          m: { type: 'string' },
          exJa: { type: 'string' },
          hl: { type: 'string' },
        },
        required: ['t', 'k', 'c', 'lv', 'ja', 'ex', 'm', 'exJa', 'hl'],
        additionalProperties: false,
      },
    },
  },
  required: ['analysis_ja', 'new_per_session', 'max_level', 'focus_categories', 'ja2en_style', 'new_words'],
  additionalProperties: false,
};

export async function coach(report, wantWords) {
  const r = await askJSON({
    system:
      'You are an adaptive vocabulary coach for a Japanese learner targeting CEFR C1 English for daily conversation and business, especially the IT industry. ' +
      'Given their learning statistics, diagnose strengths and weaknesses, and tune the study parameters. ' +
      'analysis_ja: 3-6 sentences in Japanese, specific and actionable. ' +
      'new_per_session: 0-10 new words per session (lower when accuracy is poor or the review backlog is large). ' +
      'max_level: highest difficulty (1-3) to introduce. ja2en_style: choice (multiple choice), hint (typing with first letter), free (typing). ' +
      `new_words: exactly ${wantWords} C1-level words, idioms or phrases that are NOT in the known list, chosen to fit the learner's weak areas and level. ` +
      'For each: ja = concise Japanese meaning; ex = natural example sentence; m = the exact substring of ex that is the target (as inflected); ' +
      'exJa = Japanese translation of ex; hl = the exact substring of exJa corresponding to m.',
    prompt: JSON.stringify(report),
    schema: COACH_SCHEMA,
    effort: 'medium',
    maxTokens: 12000,
  });
  // 例文中に見つからない強調部分は除外する
  r.new_words = (r.new_words || []).filter((w) => w.ex.includes(w.m) && w.exJa.includes(w.hl));
  return r;
}
