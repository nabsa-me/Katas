import { ConverseCommand, ThrottlingException, ValidationException } from '@aws-sdk/client-bedrock-runtime';
import { NodeHttp2Handler } from '@smithy/node-http-handler';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ConfigError,
  createBedrockClient,
  DEFAULT_MODEL_ID,
  loadBedrockConfig,
  type BedrockConfig,
} from './bedrock-client';
import { askClaude, createProblemClient } from './claude-bedrock.problem';
import { converseReply, errorReply, FAKE_CREDENTIALS, startFakeBedrock, type FakeReply } from './fake-bedrock-server';

describe('loadBedrockConfig', () => {
  it('needs only the Region and defaults the rest, model id included', () => {
    expect(loadBedrockConfig({ AWS_REGION: 'eu-west-1' })).toEqual({
      region: 'eu-west-1',
      modelId: DEFAULT_MODEL_ID,
      timeoutMs: 120_000,
      maxAttempts: 3,
      maxTokens: 16_000,
    });
  });

  it('reads the model or inference profile id from the environment', () => {
    const config = loadBedrockConfig({ AWS_REGION: 'us-east-1', BEDROCK_MODEL_ID: 'us.anthropic.claude-sonnet-5-5' });
    expect(config.modelId).toBe('us.anthropic.claude-sonnet-5-5');
  });

  it('fails fast listing every invalid value', () => {
    const load = () =>
      loadBedrockConfig({ AWS_REGION: 'Ireland', BEDROCK_MAX_ATTEMPTS: '0', BEDROCK_TIMEOUT_MS: 'soon' });
    expect(load).toThrow(ConfigError);
    expect(load).toThrow(/AWS_REGION[\s\S]*BEDROCK_TIMEOUT_MS[\s\S]*BEDROCK_MAX_ATTEMPTS/);
  });
});

const CONFIG: BedrockConfig = {
  region: 'us-east-1',
  modelId: DEFAULT_MODEL_ID,
  timeoutMs: 300,
  maxAttempts: 3,
  maxTokens: 1024,
};

let closeServer: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closeServer?.();
  closeServer = undefined;
});

async function fakeBedrock(replies: FakeReply[]) {
  const fake = await startFakeBedrock(replies);
  closeServer = fake.close;
  return fake;
}

function ask(config: BedrockConfig, endpoint: string) {
  const client = createBedrockClient(config, { endpoint, credentials: FAKE_CREDENTIALS });
  const command = new ConverseCommand({
    modelId: config.modelId,
    messages: [{ role: 'user', content: [{ text: 'What is the status of PLAT-104?' }] }],
  });
  return client.send(command).finally(() => client.destroy());
}

describe('createBedrockClient', () => {
  it('keeps the HTTP/2 handler the SDK uses by default and adds the request timeout', async () => {
    const client = createBedrockClient(CONFIG);
    expect(client.config.requestHandler).toBeInstanceOf(NodeHttp2Handler);
    expect(await client.config.maxAttempts()).toBe(3);
    client.destroy();
  });

  it('sends Converse to the model id path over HTTP/2', async () => {
    const fake = await fakeBedrock([converseReply('PLAT-104 is in progress.')]);
    const response = await ask(CONFIG, fake.endpoint);
    expect(response.output?.message?.content?.[0]?.text).toBe('PLAT-104 is in progress.');
    expect(fake.requests).toEqual([
      { path: `/model/${DEFAULT_MODEL_ID}/converse`, body: expect.objectContaining({ messages: expect.any(Array) }) },
    ]);
  });

  it('retries a throttled call with backoff and succeeds', async () => {
    const fake = await fakeBedrock([errorReply(429, 'ThrottlingException', 'Too many requests'), converseReply('ok')]);
    const response = await ask(CONFIG, fake.endpoint);
    expect(response.stopReason).toBe('end_turn');
    expect(fake.requests).toHaveLength(2);
    expect(response.$metadata.attempts).toBe(2);
  });

  it('gives a stalled attempt up after the timeout and retries it', async () => {
    const fake = await fakeBedrock(['stall', converseReply('ok')]);
    const response = await ask(CONFIG, fake.endpoint);
    expect(response.stopReason).toBe('end_turn');
    expect(fake.requests).toHaveLength(2);
  });

  it('stops after maxAttempts with a TimeoutError when every attempt stalls', async () => {
    const fake = await fakeBedrock(['stall']);
    await expect(ask(CONFIG, fake.endpoint)).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(fake.requests).toHaveLength(3);
  });

  it('does not retry an invalid request', async () => {
    const fake = await fakeBedrock([
      errorReply(400, 'ValidationException', 'The provided model identifier is invalid.'),
    ]);
    await expect(ask(CONFIG, fake.endpoint)).rejects.toBeInstanceOf(ValidationException);
    expect(fake.requests).toHaveLength(1);
  });
});

describe('flawed client', () => {
  it('fails on the first throttle because it makes a single attempt', async () => {
    const fake = await fakeBedrock([errorReply(429, 'ThrottlingException', 'Too many requests'), converseReply('ok')]);
    const client = createProblemClient({ endpoint: fake.endpoint, credentials: FAKE_CREDENTIALS });
    await expect(askClaude('What is the status of PLAT-104?', client)).rejects.toBeInstanceOf(ThrottlingException);
    expect(fake.requests).toHaveLength(1);
    client.destroy();
  });

  it('is still waiting on a stalled request long after the solution would have retried', async () => {
    const fake = await fakeBedrock(['stall']);
    const client = createProblemClient({ endpoint: fake.endpoint, credentials: FAKE_CREDENTIALS });
    const pending = askClaude('What is the status of PLAT-104?', client).then(
      () => 'answered',
      () => 'failed',
    );
    const after = await Promise.race([pending, new Promise((resolve) => setTimeout(() => resolve('waiting'), 1_000))]);
    expect(after).toBe('waiting');
    expect(fake.requests).toHaveLength(1);
    await fake.close(); // ends the stalled request; otherwise it would wait for the session's idle timeout
    expect(await pending).toBe('failed');
    closeServer = undefined;
    client.destroy();
  });
});
