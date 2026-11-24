import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSheetsAuth, loadServiceAccountKey, SHEETS_READONLY_SCOPE } from './service-account';

// A key generated for the test run: nothing secret is stored anywhere.
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const KEY_FILE = {
  type: 'service_account',
  project_id: 'fictional-project',
  private_key_id: 'fictional-key-id',
  private_key: privateKey,
  client_email: 'roster-reader@fictional-project.iam.gserviceaccount.com',
};

describe('loadServiceAccountKey', () => {
  it('reads the fields the client needs', () => {
    expect(loadServiceAccountKey(JSON.stringify(KEY_FILE))).toEqual({
      type: 'service_account',
      private_key_id: 'fictional-key-id',
      private_key: privateKey,
      client_email: 'roster-reader@fictional-project.iam.gserviceaccount.com',
    });
  });

  it('rejects text that is not JSON', () => {
    expect(() => loadServiceAccountKey('not json')).toThrow('not valid JSON');
  });

  it('names the wrong fields without echoing the key', () => {
    const broken = JSON.stringify({ ...KEY_FILE, client_email: 'nope', private_key: 'secret-material' });
    expect(() => loadServiceAccountKey(broken)).toThrow('check: client_email, private_key');
    expect(() => loadServiceAccountKey(broken)).not.toThrow(/secret-material/);
  });

  it('rejects a personal OAuth credential file', () => {
    const personal = JSON.stringify({ type: 'authorized_user', client_id: 'x', refresh_token: 'replace-with-a-token' });
    expect(() => loadServiceAccountKey(personal)).toThrow(/type/);
  });
});

describe('createSheetsAuth', () => {
  it('asks only for the read-only Sheets scope, and impersonates only when given a subject', () => {
    const key = loadServiceAccountKey(JSON.stringify(KEY_FILE));
    const shared = createSheetsAuth(key);
    const delegated = createSheetsAuth(key, { subject: 'ada@example.com' });
    expect(shared.scopes).toEqual([SHEETS_READONLY_SCOPE]);
    expect(shared.subject).toBeUndefined();
    expect(delegated.subject).toBe('ada@example.com');
    expect(delegated.email).toBe(KEY_FILE.client_email);
  });
});
