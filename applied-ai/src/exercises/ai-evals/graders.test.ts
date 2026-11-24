import { describe, expect, it } from 'vitest';
import { classificationSchema, type TextModel } from './classifier';
import { exactMatch, jsonSchema, llmJudge, RATIONALE_RUBRIC, regexMatch } from './graders';
import { mockJudge } from './mock-models';

const ISSUE = { summary: 'Search is down in the EU region', description: 'All search requests time out.' };

/** A judge that always answers `text`, recording what it was asked. */
function scriptedJudge(text: string) {
  const prompts: Array<{ system: string; user: string }> = [];
  const judge: TextModel = {
    id: 'scripted-judge',
    pricingId: 'scripted-judge',
    async complete(system, user) {
      prompts.push({ system, user });
      return { text, inputTokens: 100, outputTokens: 20, latencyMs: 50 };
    },
  };
  return { judge, prompts };
}

describe('deterministic graders', () => {
  it('exactMatch passes only the expected label', () => {
    expect(exactMatch('incident', 'incident')).toEqual({ grader: 'label', pass: true });
    expect(exactMatch('incident', 'bug')).toEqual({
      grader: 'label',
      pass: false,
      detail: 'expected incident, got bug',
    });
    expect(exactMatch('incident', undefined).detail).toBe('expected incident, got nothing');
  });

  it('regexMatch accepts any label the pattern allows', () => {
    expect(regexMatch('^(incident|bug)$', 'bug').pass).toBe(true);
    expect(regexMatch('^(incident|bug)$', 'chore')).toMatchObject({
      pass: false,
      detail: 'expected ^(incident|bug)$, got chore',
    });
  });

  it('jsonSchema returns the parsed value, or says what is wrong', () => {
    const ok = jsonSchema(classificationSchema, '{"workType":"incident","rationale":"The issue says search is down."}');
    expect(ok).toEqual({
      grade: { grader: 'json schema', pass: true },
      value: { workType: 'incident', rationale: 'The issue says search is down.' },
    });
    expect(jsonSchema(classificationSchema, 'It is an incident.').grade.detail).toBe('the reply is not JSON');
    const invalid = jsonSchema(classificationSchema, '{"workType":"outage","rationale":"x"}');
    expect(invalid.grade).toMatchObject({ pass: false, detail: expect.stringMatching(/workType[\s\S]*rationale/) });
  });
});

describe('llmJudge', () => {
  const output = { workType: 'incident', rationale: 'The issue says "is down", which points to an incident.' };

  it('sends the rubric as the system prompt and the issue with the output to grade', async () => {
    const { judge, prompts } = scriptedJudge('{"pass": true, "failed": [], "reason": "Cites the issue."}');
    const grade = await llmJudge(judge, ISSUE, output);
    expect(grade).toMatchObject({ grader: 'judge', pass: true });
    expect(prompts[0]?.system).toBe(RATIONALE_RUBRIC);
    expect(prompts[0]?.user).toContain('Issue summary: Search is down in the EU region');
    expect(prompts[0]?.user).toContain('Chosen work type: incident');
  });

  it('reports the failed criteria and the judge’s reason', async () => {
    const { judge } = scriptedJudge('{"pass": false, "failed": [2], "reason": "Invents a cause."}');
    expect(await llmJudge(judge, ISSUE, output)).toMatchObject({
      pass: false,
      detail: 'Invents a cause. (criteria 2)',
    });
  });

  it('never counts an unreadable verdict as a pass', async () => {
    const { judge } = scriptedJudge('Looks good to me!');
    expect(await llmJudge(judge, ISSUE, output)).toMatchObject({
      pass: false,
      detail: 'the judge did not return a valid verdict',
    });
  });

  it('the mock judge fails a rationale that does not quote the issue', async () => {
    const vague = { workType: 'incident', rationale: 'Probably an outage caused by the last deploy.' };
    expect((await llmJudge(mockJudge, ISSUE, vague)).pass).toBe(false);
    expect((await llmJudge(mockJudge, ISSUE, output)).pass).toBe(true);
  });
});
