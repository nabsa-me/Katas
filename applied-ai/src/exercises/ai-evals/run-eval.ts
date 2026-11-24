import { createBedrockClient, loadBedrockConfig } from '../claude-bedrock/bedrock-client';
import { createBedrockTextModel } from './bedrock-models';
import type { TextModel } from './classifier';
import { loadGoldenCases } from './dataset';
import type { JudgeModel } from './graders';
import { mockClassifier, mockJudge } from './mock-models';
import { formatReport } from './report';
import { loadEvalConfig, runEval } from './runner';

/**
 * The CI gate:
 *   npm run eval                      deterministic mock model and judge: no network, no cost
 *   EVAL_MODEL=bedrock npm run eval   Claude on Amazon Bedrock (AWS credentials and `.env`, see the claude-bedrock exercise)
 * Exit codes: 0 the pass rate meets `eval.config.json`, 1 it does not, 2 the eval could not run.
 */
function createModels(env: NodeJS.ProcessEnv): { model: TextModel; judge: JudgeModel; close: () => void } {
  if ((env.EVAL_MODEL ?? 'mock') === 'mock') return { model: mockClassifier, judge: mockJudge, close: () => {} };
  if (env.EVAL_MODEL !== 'bedrock') throw new Error(`EVAL_MODEL must be "mock" or "bedrock", got "${env.EVAL_MODEL}"`);
  const config = loadBedrockConfig(env);
  const client = createBedrockClient(config);
  const options = { client, maxTokens: config.maxTokens };
  return {
    model: createBedrockTextModel({ ...options, modelId: config.modelId }),
    // A judge on a different model than the one it grades avoids grading its own habits as correct.
    judge: createBedrockTextModel({ ...options, modelId: env.EVAL_JUDGE_MODEL_ID || config.modelId }),
    close: () => client.destroy(),
  };
}

async function main(): Promise<number> {
  const config = loadEvalConfig();
  const cases = loadGoldenCases();
  const { model, judge, close } = createModels(process.env);
  try {
    const { summary } = await runEval({ cases, model, judge, config });
    process.stdout.write(formatReport(summary));
    return summary.ok ? 0 : 1;
  } finally {
    close();
  }
}

main().then(
  (code) => (process.exitCode = code),
  (error: unknown) => {
    process.stderr.write(`The eval could not run: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  },
);
