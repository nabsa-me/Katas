import { ACCESS_REVIEW } from './admin-report';

/**
 * BUG: no check at all. The page only shows the "Admin report" button to admins, so the API "can't be
 * reached" by anyone else, but anyone can call the URL directly: with curl, from the console, or with a
 * stolen token. Hiding a button is user experience, not authorization.
 */
export function problemAdminReportResponse(): Response {
  return Response.json({ entries: ACCESS_REVIEW });
}
