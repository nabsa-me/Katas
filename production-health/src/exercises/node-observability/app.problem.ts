import type { RequestListener } from 'node:http';
import type { IssueRepository, IssueStatus } from './issues';

/**
 * Flawed: the same issues endpoints, written the way a service often starts. It works on a laptop, and in
 * production it hides its failures and gives nobody a way to tell one request from another.
 */
export function createProblemApp(issues: IssueRepository): RequestListener {
  return async (req, res) => {
    // BUG: free text on stdout. No level, no timestamp, no request id: with 50 requests in flight, the lines of
    // one request can't be told apart from the others, and nothing can query them.
    console.log('Incoming request ' + req.method + ' ' + req.url);
    const url = new URL(req.url ?? '/', 'http://localhost');
    let body: unknown = { issues: [] };
    try {
      if (url.pathname === '/issues') {
        const status = url.searchParams.get('status') as IssueStatus;
        const list = await issues.list({ status, limit: Number(url.searchParams.get('limit') ?? 20) });
        console.log('Found ' + list.length + ' issues');
        body = { issues: list };
      } else if (url.pathname.startsWith('/issues/')) {
        const issue = await issues.get(url.pathname.slice('/issues/'.length));
        if (!issue) res.statusCode = 404;
        body = issue ?? { error: 'not found' };
      } else {
        // BUG: no /healthz or /readyz. The orchestrator can only check that the port is open, so an instance whose
        // database is gone keeps receiving traffic.
        res.statusCode = 404;
      }
    } catch {
      // BUG: the error disappears. The client gets 200 and an empty list, the dashboards show 200s, no alarm
      // fires, and the stack trace that would explain it is lost.
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  };
}
