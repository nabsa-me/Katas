/** When the fictional data set was last synchronised: data from the server, identical for everybody. */
export const LAST_SYNC = '2026-11-24T08:30:00Z';

/**
 * Formats a timestamp with an explicit locale and time zone. The result depends only on the input,
 * so the server and every browser produce the same text.
 */
export function formatTimestamp(iso: string): string {
  const formatter = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  return `${formatter.format(new Date(iso))} UTC`;
}
