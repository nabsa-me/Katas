import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import policyData from './iam-policy.json';

const statementSchema = z.object({
  Sid: z.string(),
  Effect: z.literal('Allow'),
  Action: z.array(z.string()),
  Resource: z.union([z.string(), z.array(z.string())]),
  Condition: z.record(z.string(), z.record(z.string(), z.string())).optional(),
});
const policy = z.object({ Version: z.literal('2012-10-17'), Statement: z.array(statementSchema) }).parse(policyData);
const resources = (statement: z.infer<typeof statementSchema>) => [statement.Resource].flat();

const PROFILE_ARN = 'arn:aws:bedrock:us-east-1:111122223333:inference-profile/global.anthropic.claude-opus-5-5';

describe('IAM policy for the Bedrock client', () => {
  it('allows only the two invoke actions that Converse and ConverseStream need', () => {
    const actions = new Set(policy.Statement.flatMap((statement) => statement.Action));
    expect([...actions].sort()).toEqual(['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream']);
  });

  it('names specific resources, with no wildcards', () => {
    const all = policy.Statement.flatMap(resources);
    expect(all).toContain(PROFILE_ARN);
    expect(all.some((arn) => arn.includes('*'))).toBe(false);
  });

  it('allows the foundation model only when the call goes through the inference profile', () => {
    const modelStatements = policy.Statement.filter((statement) =>
      resources(statement).some((arn) => arn.includes(':foundation-model/')),
    );
    expect(modelStatements).toHaveLength(1);
    expect(modelStatements[0]?.Condition).toEqual({ StringLike: { 'bedrock:InferenceProfileArn': PROFILE_ARN } });
    // A global profile routes to any commercial Region: the model is listed in the source Region and Region-less.
    expect(resources(modelStatements[0]!)).toEqual([
      'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-opus-5-5',
      'arn:aws:bedrock:::foundation-model/anthropic.claude-opus-5-5',
    ]);
  });
});
