/* eslint-disable @typescript-eslint/no-explicit-any -- the flawed version keeps the untyped code it is about */
import { GOALS_SEARCH_QUERY } from './goals';

/**
 * Flawed: treats GraphQL like REST. It expects failures as HTTP errors, reads `data` blindly and stops at the
 * first page. The query itself is fine; the handling of the response is not.
 */
export async function fetchGoals(
  endpoint: string,
  authorization: string,
  containerId: string,
  searchString: string,
): Promise<any[]> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ query: GOALS_SEARCH_QUERY, variables: { containerId, searchString, first: 25 } }),
  });
  // BUG: assumes GraphQL errors arrive as HTTP errors. They come in the body's `errors`, usually with a 200.
  if (!response.ok) throw new Error(`GraphQL request failed with ${response.status}`);

  const body: any = await response.json();
  // BUG: `body.errors` is never read, so a field nulled by an error looks like a real "no value".
  // BUG: when the error nulls `data` (or `goals_search`), this line throws a TypeError that says nothing useful.
  // BUG: first page only; `pageInfo.hasNextPage` and `endCursor` are ignored.
  return body.data.goals_search.edges.map((edge: any) => edge.node);
}
