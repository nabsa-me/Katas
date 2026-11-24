import { JWT } from 'google-auth-library';
import { z } from 'zod';

/** Read-only access to spreadsheets: the narrowest scope that can read values. */
export const SHEETS_READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

/** The fields of a service account JSON key this app needs (the file has more). */
const serviceAccountKeySchema = z.object({
  type: z.literal('service_account'),
  client_email: z.email(),
  private_key: z.string().startsWith('-----BEGIN PRIVATE KEY-----'),
  private_key_id: z.string().optional(),
});

export type ServiceAccountKey = z.infer<typeof serviceAccountKeySchema>;

/**
 * Parses a service account key given as JSON text: from an environment variable or a secret manager, never from
 * a file in the repository. Errors name the fields that are wrong and never echo the key itself.
 * A personal OAuth credential (`"type": "authorized_user"`) is rejected: that is exactly what this replaces.
 */
export function loadServiceAccountKey(json: string): ServiceAccountKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('The service account key is not valid JSON');
  }
  const result = serviceAccountKeySchema.safeParse(parsed);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.') || '(root)');
    throw new Error(`Invalid service account key, check: ${[...new Set(fields)].join(', ')}`);
  }
  return result.data;
}

export interface SheetsAuthOptions {
  /**
   * Domain-wide delegation: the Workspace user the service account acts as. Leave it out when the sheet is
   * shared with the service account's email, which needs no admin setup and is the simpler option.
   */
  subject?: string;
}

/**
 * A JWT client for the service account. It signs an assertion with the private key (`iss` = the service account,
 * `sub` = the impersonated user when delegating, `scope`, `aud` = Google's token endpoint), exchanges it for an
 * access token and caches the token until it expires. Create it once and reuse it.
 */
export function createSheetsAuth(key: ServiceAccountKey, { subject }: SheetsAuthOptions = {}): JWT {
  return new JWT({
    email: key.client_email,
    key: key.private_key,
    keyId: key.private_key_id,
    scopes: [SHEETS_READONLY_SCOPE],
    subject,
  });
}
