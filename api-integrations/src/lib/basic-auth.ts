/**
 * `Authorization` header value for HTTP Basic auth: `Basic` plus the base64 of `user:secret` in UTF-8.
 * Atlassian Cloud accepts it with an account email and an API token, for the REST and the GraphQL APIs.
 * Base64 is an encoding, not encryption: send it only over HTTPS and treat the header as a secret.
 */
export function basicAuth(user: string, secret: string): string {
  if (user.includes(':')) throw new Error('A Basic auth user name cannot contain ":"');
  return `Basic ${Buffer.from(`${user}:${secret}`, 'utf8').toString('base64')}`;
}
