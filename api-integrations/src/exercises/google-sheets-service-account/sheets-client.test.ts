import { generateKeyPairSync, verify } from 'node:crypto';
import { HttpResponse, http } from 'msw/http';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import roster from '../../data/team-roster-sheet.json';
import { createSheetsAuth, loadServiceAccountKey, SHEETS_READONLY_SCOPE } from './service-account';
import { firstRowNumber, readTeamRoster, SheetsApiError } from './sheets-client';
import { readTeamRoster as readTeamRosterFlawed } from './sheets.problem';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const VALUES_URL = 'https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range';
const SPREADSHEET_ID = 'fictional-spreadsheet-id';
const ISSUED_TOKEN = 'test-access-token';
const CLIENT_EMAIL = 'roster-reader@fictional-project.iam.gserviceaccount.com';

/** A service account key pair generated for this run. The fake token endpoint only knows the public half. */
function rsaKeys() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
}
const keys = rsaKeys();
const keyJson = (privateKey: string) =>
  JSON.stringify({
    type: 'service_account',
    private_key_id: 'fictional-key-id',
    private_key: privateKey,
    client_email: CLIENT_EMAIL,
  });

/** Verifies an RS256 JWT with the public key and returns its claims, or null if the signature is wrong. */
function verifyAssertion(jwt: string): Record<string, unknown> | null {
  const [header = '', payload = '', signature = ''] = jwt.split('.');
  const valid = verify(
    'RSA-SHA256',
    Buffer.from(`${header}.${payload}`),
    keys.publicKey,
    Buffer.from(signature, 'base64url'),
  );
  return valid ? JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) : null;
}

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** Fake Google: the OAuth token endpoint (JWT bearer grant) and the Sheets values endpoint. */
function fakeGoogle() {
  const assertions: Record<string, unknown>[] = [];
  const valuesRequests: { authorization: string | null; range: string; spreadsheetId: string }[] = [];
  server.use(
    http.post(TOKEN_URL, async ({ request }) => {
      const form = new URLSearchParams(await request.text());
      const claims = verifyAssertion(form.get('assertion') ?? '');
      if (form.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:jwt-bearer' || !claims) {
        return HttpResponse.json(
          { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' },
          { status: 400 },
        );
      }
      assertions.push(claims);
      return HttpResponse.json({ access_token: ISSUED_TOKEN, expires_in: 3599, token_type: 'Bearer' });
    }),
    http.get(VALUES_URL, ({ request, params }) => {
      const authorization = request.headers.get('authorization');
      valuesRequests.push({
        authorization,
        range: decodeURIComponent(String(params.range)),
        spreadsheetId: String(params.spreadsheetId),
      });
      if (authorization !== `Bearer ${ISSUED_TOKEN}`) {
        return HttpResponse.json({ error: { code: 401, status: 'UNAUTHENTICATED' } }, { status: 401 });
      }
      return HttpResponse.json(roster);
    }),
  );
  return { assertions, valuesRequests };
}

describe('flawed roster read', () => {
  it('sends the personal token pasted in the code', async () => {
    const google = fakeGoogle();
    await readTeamRosterFlawed(SPREADSHEET_ID).catch(() => undefined);
    expect(google.valuesRequests[0]?.authorization).toBe('Bearer replace-with-a-personal-oauth-token');
  });

  it('returns broken rows as if they were people', async () => {
    server.use(http.get(VALUES_URL, () => HttpResponse.json(roster)));
    const rows = await readTeamRosterFlawed(SPREADSHEET_ID);
    expect(rows).toHaveLength(roster.values.length - 1); // blank and invalid rows included
    expect(rows).toContainEqual({ name: undefined, email: undefined, team: undefined, allocation: NaN });
    expect(rows).toContainEqual({
      name: 'Arnau Soler',
      email: 'arnau.soler@example.com',
      team: 'Web',
      allocation: NaN,
    });
  });
});

describe('service account roster read', () => {
  it('exchanges a signed JWT for a token, impersonating the subject, and validates the rows', async () => {
    const google = fakeGoogle();
    const auth = createSheetsAuth(loadServiceAccountKey(keyJson(keys.privateKey)), { subject: 'ada@example.com' });

    const { valid, invalid } = await readTeamRoster(auth, SPREADSHEET_ID);

    expect(valid).toHaveLength(3);
    expect(invalid.map((row) => row.rowNumber)).toEqual([4, 6, 7, 8, 9]);
    expect(google.assertions).toHaveLength(1);
    const [claims] = google.assertions;
    expect(claims).toMatchObject({
      iss: CLIENT_EMAIL,
      sub: 'ada@example.com',
      scope: SHEETS_READONLY_SCOPE,
      aud: TOKEN_URL,
    });
    expect(Number(claims?.exp) - Number(claims?.iat)).toBe(3600);
    expect(google.valuesRequests).toEqual([
      { authorization: `Bearer ${ISSUED_TOKEN}`, range: 'Roster!A1:D', spreadsheetId: SPREADSHEET_ID },
    ]);
  });

  it('acts as the service account itself, with no sub claim, when the sheet is shared with it', async () => {
    const google = fakeGoogle();
    await readTeamRoster(createSheetsAuth(loadServiceAccountKey(keyJson(keys.privateKey))), SPREADSHEET_ID);
    expect(google.assertions[0]).not.toHaveProperty('sub');
  });

  it('reuses the cached access token for later reads', async () => {
    const google = fakeGoogle();
    const auth = createSheetsAuth(loadServiceAccountKey(keyJson(keys.privateKey)));
    await readTeamRoster(auth, SPREADSHEET_ID);
    await readTeamRoster(auth, SPREADSHEET_ID);
    expect(google.assertions).toHaveLength(1);
    expect(google.valuesRequests).toHaveLength(2);
  });

  it('gets no token with a key the service account does not own', async () => {
    const google = fakeGoogle();
    const auth = createSheetsAuth(loadServiceAccountKey(keyJson(rsaKeys().privateKey)));
    await expect(readTeamRoster(auth, SPREADSHEET_ID)).rejects.toThrow(/invalid_grant/);
    expect(google.valuesRequests).toEqual([]);
  });

  it('turns a Sheets API error into a typed error with the status', async () => {
    fakeGoogle();
    server.use(
      http.get(VALUES_URL, () =>
        HttpResponse.json({ error: { code: 403, status: 'PERMISSION_DENIED' } }, { status: 403 }),
      ),
    );
    const auth = createSheetsAuth(loadServiceAccountKey(keyJson(keys.privateKey)));
    const error = await readTeamRoster(auth, SPREADSHEET_ID).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SheetsApiError);
    expect((error as SheetsApiError).status).toBe(403);
  });
});

describe('firstRowNumber', () => {
  it('reads the starting row of an A1 range', () => {
    expect(firstRowNumber('Roster!A1:D10')).toBe(1);
    expect(firstRowNumber("'Team roster'!B5:E")).toBe(5);
    expect(firstRowNumber('Roster')).toBe(1);
  });
});
