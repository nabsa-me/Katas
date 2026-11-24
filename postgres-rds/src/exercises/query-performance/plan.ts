import type { Queryable } from '../../lib/database';

/** The fields of an `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` node that the exercise reads. */
export interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Actual Rows'?: number;
  'Actual Loops'?: number;
  'Shared Hit Blocks'?: number;
  'Shared Read Blocks'?: number;
  Plans?: PlanNode[];
}

export interface ExplainResult {
  plan: PlanNode;
  executionTimeMs: number;
}

function isPlanNode(value: unknown): value is PlanNode {
  if (typeof value !== 'object' || value === null) return false;
  const node = value as Record<string, unknown>;
  return (
    typeof node['Node Type'] === 'string' &&
    (node.Plans === undefined || (Array.isArray(node.Plans) && node.Plans.every(isPlanNode)))
  );
}

/** Runs the query for real (ANALYZE) and returns its plan with actual rows, buffers and timing. */
export async function explainAnalyze(db: Queryable, sql: string, params: unknown[] = []): Promise<ExplainResult> {
  const { rows } = await db.query<{ 'QUERY PLAN': unknown }>(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params);
  const [output] = (rows[0]?.['QUERY PLAN'] ?? []) as Array<{ Plan?: unknown; 'Execution Time'?: unknown }>;
  if (!output || !isPlanNode(output.Plan) || typeof output['Execution Time'] !== 'number') {
    throw new Error('Unexpected EXPLAIN output');
  }
  return { plan: output.Plan, executionTimeMs: output['Execution Time'] };
}

/** The same, as the text you would read in psql. */
export async function explainAnalyzeText(db: Queryable, sql: string, params: unknown[] = []): Promise<string> {
  const { rows } = await db.query<{ 'QUERY PLAN': string }>(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`, params);
  return rows.map((row) => row['QUERY PLAN']).join('\n');
}

/** Every node of the plan tree, depth first, root included. */
export function planNodes(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(planNodes)];
}

/** Scans of a table: sequential, index, index-only or bitmap heap scans, parallel or not. */
export function scansOf(plan: PlanNode, table: string): PlanNode[] {
  return planNodes(plan).filter((node) => node['Relation Name'] === table && node['Node Type'].includes('Scan'));
}

/** Names of the indexes the plan reads. */
export function indexesUsed(plan: PlanNode): string[] {
  return planNodes(plan).flatMap((node) => (node['Index Name'] ? [node['Index Name']] : []));
}

/** Pages read from shared buffers or disk. A node's counters include its children, so the root's is the total. */
export function sharedBlocks(plan: PlanNode): number {
  return (plan['Shared Hit Blocks'] ?? 0) + (plan['Shared Read Blocks'] ?? 0);
}
