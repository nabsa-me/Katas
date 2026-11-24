import type { Tool, ToolInputSchema, ToolResultBlock, ToolUseBlock } from '@aws-sdk/client-bedrock-runtime';
import { z } from 'zod';
import { findIssue, ISSUE_KEY_PATTERN, toIssueView } from '../../lib/issues';

/** The SDK's JSON document type (`@smithy/types` `DocumentType`), reached through a type it exports. */
type DocumentType = ToolInputSchema.JsonMember['json'];

/** The tools offered to the model and how to run the calls it makes. */
export interface ToolRegistry {
  specs: Tool[];
  run(toolUse: ToolUseBlock): Promise<ToolResultBlock>;
}

export const getIssueInputSchema = z.object({
  key: z.string().regex(ISSUE_KEY_PATTERN, 'expected a Jira issue key such as PLAT-101').describe('Jira issue key'),
});

/** A zod schema as the JSON Schema a tool spec carries. The `$schema` dialect line is dropped: the model needs the shape. */
export function toToolInputSchema(schema: z.ZodType): DocumentType {
  const json: Record<string, unknown> = { ...z.toJSONSchema(schema) };
  delete json.$schema;
  return json as DocumentType;
}

const getIssueSpec: Tool = {
  toolSpec: {
    name: 'get_issue',
    description:
      'Returns the summary, status, assignee, priority, type, last update and description of one Jira issue, by key. ' +
      'Use it whenever the user mentions an issue key such as PLAT-101. It cannot search or list issues.',
    inputSchema: { json: toToolInputSchema(getIssueInputSchema) },
  },
};

function errorResult(toolUseId: string | undefined, text: string): ToolResultBlock {
  return { toolUseId, status: 'error', content: [{ text }] };
}

/**
 * Runs one tool call. The input comes from the model, so it is external data: it is validated before use, and every
 * failure becomes an error result the model can read and act on (ask the user, fix the key), never an exception
 * that ends the conversation.
 */
export async function runTool(toolUse: ToolUseBlock): Promise<ToolResultBlock> {
  const { toolUseId, name, input } = toolUse;
  if (name !== 'get_issue') return errorResult(toolUseId, `Unknown tool "${name}". Available tools: get_issue.`);

  const parsed = getIssueInputSchema.safeParse(input);
  if (!parsed.success) return errorResult(toolUseId, `Invalid input for get_issue: ${z.prettifyError(parsed.error)}`);

  const issue = findIssue(parsed.data.key);
  if (!issue) return errorResult(toolUseId, `No issue ${parsed.data.key} exists. Ask the user to check the key.`);

  const view = toIssueView(issue, { withDescription: true });
  return { toolUseId, status: 'success', content: [{ json: { ...view } as DocumentType }] };
}

export const issueTools: ToolRegistry = { specs: [getIssueSpec], run: runTool };
