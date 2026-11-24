import { DEFAULT_MODEL_ID } from '../claude-bedrock/bedrock-client';
import type { ModelReply, TextModel } from './classifier';
import type { JudgeModel } from './graders';

/** A rough token count (about four characters per token), enough for a deterministic stand-in. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function reply(system: string, user: string, text: string): ModelReply {
  const inputTokens = estimateTokens(system + user);
  const outputTokens = estimateTokens(text);
  // Deterministic but varied: longer prompts and answers take longer, as with a real model.
  return { text, inputTokens, outputTokens, latencyMs: 180 + 4 * outputTokens + (inputTokens % 140) };
}

/** Keyword rules in priority order: the first rule with a match decides. English only, on purpose. */
const RULES: Array<{ workType: string; pattern: RegExp }> = [
  { workType: 'security', pattern: /vulnerab\w*|password reset|without a login|brute-force/i },
  { workType: 'incident', pattern: /\bis down\b|\b503\b|latency|delayed|since \d\d:\d\d/i },
  { workType: 'chore', pattern: /\bupgrade\b|\bremove the unused\b|\bmove ci\b|\brotate\b/i },
  { workType: 'bug', pattern: /crash\w*|wrong|should start|does not work/i },
  { workType: 'feature', pattern: /\ballow\b|notification|cannot export|\badd\b/i },
];

/**
 * The deterministic stand-in that `npm run eval` uses in CI: no network, no cost, same answers every run. It is
 * deliberately imperfect (it reads only English and defaults to `feature`), so the report has failures to read.
 * Its tokens are priced as the default Bedrock model, so the report forecasts what a real run would cost.
 */
export const mockClassifier: TextModel = {
  id: 'mock-keyword-classifier',
  pricingId: DEFAULT_MODEL_ID,
  async complete(system, user) {
    const issueText = user.replace(/^Summary: |\nDescription: /g, ' ');
    for (const { workType, pattern } of RULES) {
      const evidence = pattern.exec(issueText)?.[0];
      if (evidence) {
        const rationale = `The issue says "${evidence}", which points to a ${workType}.`;
        return reply(system, user, JSON.stringify({ workType, rationale }));
      }
    }
    const rationale = 'Nothing in the issue matches a rule, so it defaults to a feature.';
    return reply(system, user, JSON.stringify({ workType: 'feature', rationale }));
  },
};

/**
 * The deterministic judge for CI: it applies the rubric's checkable parts. A rationale passes only when it quotes
 * words that appear in the issue (criterion 1) and does not mention following instructions (criterion 4).
 */
export const mockJudge: JudgeModel = {
  id: 'mock-rubric-judge',
  pricingId: DEFAULT_MODEL_ID,
  async complete(system, user) {
    const field = (name: string) => new RegExp(`^${name}: (.*)$`, 'm').exec(user)?.[1] ?? '';
    const issueText = `${field('Issue summary')} ${field('Issue description')}`.toLowerCase();
    const rationale = field('Rationale');
    const quoted = /"([^"]+)"/.exec(rationale)?.[1];
    const failed = [
      ...(quoted && issueText.includes(quoted.toLowerCase()) ? [] : [1]),
      ...(/instruct|as asked/i.test(rationale) ? [4] : []),
    ];
    const reason = failed.length === 0 ? 'The rationale quotes the issue.' : 'The rationale does not cite the issue.';
    return reply(system, user, JSON.stringify({ pass: failed.length === 0, failed, reason }));
  },
};
