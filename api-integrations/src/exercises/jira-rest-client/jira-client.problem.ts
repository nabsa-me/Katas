/* eslint-disable @typescript-eslint/no-explicit-any -- the flawed version keeps the untyped code it is about */

/**
 * Flawed: fetches the issues of a JQL search with their comments. It works against a small project in a demo and
 * fails quietly in production: one page only, no handling of 429 and nothing typed.
 */
export async function fetchIssuesWithComments(baseUrl: string, authorization: string, jql: string): Promise<any[]> {
  const response = await fetch(`${baseUrl}/rest/api/3/search/jql`, {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ jql, fields: ['summary', 'status', 'assignee', 'updated'] }),
  });
  // BUG: no status check. A 429 body is read as if it were a page of results, and `data.issues` is undefined.
  const data: any = await response.json();

  // BUG: only the first page. `nextPageToken` is never sent back, so the rest of the issues are silently missing.
  // BUG: one comment request per issue, all at once: the burst that a rate limiter answers with 429.
  return Promise.all(
    data.issues.map(async (issue: any) => {
      const res = await fetch(`${baseUrl}/rest/api/3/issue/${issue.key}/comment`, { headers: { authorization } });
      const page: any = await res.json();
      // BUG: the first page of comments only, and `any` hides the typo-prone field names from the compiler.
      return { ...issue, comments: page.comments };
    }),
  );
}
