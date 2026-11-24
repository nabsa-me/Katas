import { z } from 'zod';
import type { GraphqlClient, GraphqlError } from './graphql-client';

/**
 * Goals search with Relay cursor pagination. The field, its arguments and the selection are the ones in Atlassian's
 * Goals examples; the examples write the values inline, so the variable types declared here (`ID!`, `String!`…) are
 * the part to check in the GraphQL Explorer (see the README). Values always travel as variables, never interpolated
 * into the query text.
 */
export const GOALS_SEARCH_QUERY = /* GraphQL */ `
  query GoalsSearch($containerId: ID!, $searchString: String!, $first: Int, $after: String) {
    goals_search(
      containerId: $containerId
      searchString: $searchString
      first: $first
      after: $after
      sort: [NAME_ASC]
    ) {
      edges {
        node {
          id
          name
          status {
            value
          }
          owner {
            aaid
          }
          targetDate
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// Everything an error can null is nullable here: with partial errors, the failed field comes back as `null` and
// its siblings still resolve. Only `id` and `name` are required to make a goal worth keeping.
const goalNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.object({ value: z.string() }).nullable(),
  owner: z.object({ aaid: z.string() }).nullable(),
  targetDate: z.string().nullable(), // a date without time, YYYY-MM-DD
});

const goalsSearchDataSchema = z.object({
  goals_search: z
    .object({
      edges: z.array(z.object({ node: goalNodeSchema.nullable() }).nullable()),
      pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
    })
    .nullable(),
});

export interface Goal {
  id: string;
  name: string;
  status: string | null;
  ownerAccountId: string | null;
  targetDate: string | null;
}

export interface GoalsSearchResult {
  goals: Goal[];
  /** Every error the server reported, from every page, with its `path`. */
  errors: GraphqlError[];
  /** False when a page could not be read and the search stopped early: `goals` is then a prefix. */
  allPagesRead: boolean;
}

export interface GoalsSearchInput {
  /** `ari:cloud:townsquare::site/{siteId}` */
  containerId: string;
  /** Goals search language, such as `status = on_track`. */
  searchString: string;
  pageSize?: number;
}

/**
 * Reads every page of a goals search. Valid data is kept even when errors come with it, and those errors are
 * returned with their path so the caller can tell "no owner" from "owner not readable".
 */
export async function searchGoals(
  client: GraphqlClient,
  { containerId, searchString, pageSize = 25 }: GoalsSearchInput,
): Promise<GoalsSearchResult> {
  const goals: Goal[] = [];
  const errors: GraphqlError[] = [];
  let after: string | undefined;

  for (;;) {
    const result = await client.execute(GOALS_SEARCH_QUERY, { containerId, searchString, first: pageSize, after });
    errors.push(...result.errors);
    if (result.data === null) return { goals, errors, allPagesRead: false };

    const parsed = goalsSearchDataSchema.safeParse(result.data);
    if (!parsed.success) {
      errors.push({ message: `Unexpected response shape: ${z.prettifyError(parsed.error)}` });
      return { goals, errors, allPagesRead: false };
    }
    const connection = parsed.data.goals_search;
    if (connection === null) return { goals, errors, allPagesRead: false };

    for (const edge of connection.edges) {
      if (edge?.node) goals.push(toGoal(edge.node));
    }
    const { hasNextPage, endCursor } = connection.pageInfo;
    if (!hasNextPage || endCursor === null) return { goals, errors, allPagesRead: true };
    after = endCursor;
  }
}

function toGoal(node: z.infer<typeof goalNodeSchema>): Goal {
  return {
    id: node.id,
    name: node.name,
    status: node.status?.value ?? null,
    ownerAccountId: node.owner?.aaid ?? null,
    targetDate: node.targetDate,
  };
}
