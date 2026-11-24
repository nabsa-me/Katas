import { describe, expect, it } from 'vitest';
import { issueTools, runTool } from './tools';

describe('get_issue tool spec', () => {
  it('describes the input as JSON Schema generated from the zod schema', () => {
    const spec = issueTools.specs[0]?.toolSpec;
    expect(spec?.name).toBe('get_issue');
    expect(spec?.description).toMatch(/issue key such as PLAT-101/);
    expect(spec?.inputSchema?.json).toEqual({
      type: 'object',
      properties: { key: { type: 'string', pattern: '^[A-Z][A-Z0-9_]+-\\d+$', description: 'Jira issue key' } },
      required: ['key'],
      additionalProperties: false,
    });
  });
});

describe('runTool', () => {
  it('returns the issue as JSON for a valid key', async () => {
    const result = await runTool({ toolUseId: 'tooluse-1', name: 'get_issue', input: { key: 'PLAT-105' } });
    expect(result).toEqual({
      toolUseId: 'tooluse-1',
      status: 'success',
      content: [
        {
          json: {
            key: 'PLAT-105',
            summary: 'Rotate the API keys that were committed to the deploy scripts repository',
            status: 'To Do',
            assignee: 'Kofi Mensah',
            priority: 'Highest',
            type: 'Task',
            updated: '2026-11-21T10:05:00.000+0000',
            description: 'A secret scanner flagged two API keys in the history of the deploy scripts repository.',
          },
        },
      ],
    });
  });

  it('turns input the model got wrong into an error result that says what is expected', async () => {
    const result = await runTool({ toolUseId: 'tooluse-2', name: 'get_issue', input: { issue: 'PLAT-105' } });
    expect(result.status).toBe('error');
    expect(result.content?.[0]?.text).toMatch(/Invalid input for get_issue[\s\S]*key/);
  });

  it('reports an issue that does not exist instead of inventing one', async () => {
    const result = await runTool({ toolUseId: 'tooluse-3', name: 'get_issue', input: { key: 'PLAT-999' } });
    expect(result).toEqual({
      toolUseId: 'tooluse-3',
      status: 'error',
      content: [{ text: 'No issue PLAT-999 exists. Ask the user to check the key.' }],
    });
  });

  it('reports an unknown tool name with the list of available tools', async () => {
    const result = await runTool({ toolUseId: 'tooluse-4', name: 'delete_issue', input: {} });
    expect(result.content?.[0]?.text).toBe('Unknown tool "delete_issue". Available tools: get_issue.');
  });
});
