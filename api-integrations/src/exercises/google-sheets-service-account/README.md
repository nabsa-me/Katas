# Google Sheets with a service account

## Statement

The team roster (name, email, team, allocation) lives in a Google Sheet, and a nightly job imports it. The current code:

```ts
const ACCESS_TOKEN = 'replace-with-a-personal-oauth-token'; // copied from a browser session
const body: any = await (await fetch(url, { headers: { authorization: `Bearer ${ACCESS_TOKEN}` } })).json();
return body.values
  .slice(1)
  .map(([name, email, team, allocation]) => ({ name, email, team, allocation: Number(allocation) }));
```

Symptoms: the job fails every morning until someone pastes a fresh token; and when it runs, the target system receives people with `allocation: NaN`, empty names from blank rows and malformed emails, with nothing saying which row of the sheet is wrong. Replace the token with a service account (with domain-wide delegation, and explain when simply sharing the sheet is better), read the range through the Sheets API, and validate every row with zod, reporting invalid rows instead of dropping or importing them.

## What gets assessed

- Server-to-server auth with a service account: the signed JWT, the token exchange, the access token cache.
- Domain-wide delegation (`subject`) versus sharing the sheet with the service account, and when to pick each.
- Least privilege: the read-only scope, and where the key lives.
- Reading a range with `spreadsheets.values.get` and knowing its quirks (strings, omitted trailing cells, missing `values`).
- Validation that reports: valid rows typed, invalid rows with their sheet row number and every problem.

## How to approach it, step by step

1. Fake Google with msw: the token endpoint `https://oauth2.googleapis.com/token` and `GET …/spreadsheets/{id}/values/{range}`, returning a roster with good and bad rows.
2. Write `parseRows(values)` first, as a pure function: header check, one zod schema per row, `{ valid, invalid: [{ rowNumber, issues }] }`.
3. Validate the service account key itself (`type`, `client_email`, `private_key`) when loading it, without echoing it in errors.
4. Create the `JWT` client from `google-auth-library` with the read-only scope and, for delegation, the `subject`.
5. Read the range with `fetch` and the headers from `auth.getRequestHeaders()`, and validate the response shape.
6. In the fake token endpoint, verify the assertion's signature with the public key and check its claims, so the test proves the real library's flow.

## Solution explained

[`service-account.ts`](./service-account.ts) loads the key and creates the auth client, [`sheets-client.ts`](./sheets-client.ts) reads the range, [`parse-rows.ts`](./parse-rows.ts) validates the rows, and [`sheets.problem.ts`](./sheets.problem.ts) is the flawed version. [`sheets-client.test.ts`](./sheets-client.test.ts) runs both against a fake Google built with msw; [`parse-rows.test.ts`](./parse-rows.test.ts) and [`service-account.test.ts`](./service-account.test.ts) cover the pure parts. The roster is in [`src/data/team-roster-sheet.json`](../../data/team-roster-sheet.json).

**Why the pasted token fails.** An OAuth access token copied from a browser session belongs to a person, expires within the hour, carries everything that person can do, and lands in the repository history. A service account is an identity for the application: it has its own key, gets only the scopes it asks for, and keeps working when people change teams.

**How the service account authenticates.** `new JWT({ email, key, keyId, scopes, subject })` from `google-auth-library` does the OAuth 2.0 JWT bearer flow:

1. It builds a JWT with `iss` = the service account email, `scope` = the requested scopes, `aud` = `https://oauth2.googleapis.com/token`, `iat` and `exp` (one hour), plus `sub` when delegating, and signs it with the private key (RS256).
2. It POSTs it to the token endpoint with `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` and gets an access token.
3. It caches the token until it expires; `getRequestHeaders()` returns `Authorization: Bearer …`, refreshing first when needed.

The fake token endpoint in the test does what Google does: it verifies the assertion's signature with the public key and returns a token only if it is valid. The tests then check the claims (`iss`, `sub`, `scope`, `aud`, one-hour lifetime), that a key the account does not own gets `invalid_grant`, and that two reads with the same client request one token. Keys are generated with `crypto.generateKeyPairSync` at test time, so no key is stored anywhere.

**Delegation or sharing.** Two ways to give the service account access to the sheet:

- **Share the sheet with the service account's email** (`…@….iam.gserviceaccount.com`), as you would with a person, and leave `subject` out. The account acts as itself. No admin involved, access is visible in the sheet's sharing settings, and it is limited to what was shared. Prefer it whenever the set of sheets is known.
- **Domain-wide delegation** with `subject: 'user@your-domain'`: the account acts as that Workspace user and sees what the user sees. A Workspace admin must authorize the service account's client ID and exact scopes in the Admin console (Security › Access and data control › API controls › Manage Domain Wide Delegation). It is powerful (it can impersonate any user for those scopes), so use it only when the app must act on behalf of users or reach files nobody can share with it, and keep the scopes minimal.

Both are tested: with `subject` the assertion carries `sub`, without it there is no `sub` claim.

**Least privilege and the key.** The scope is `https://www.googleapis.com/auth/spreadsheets.readonly`, not `spreadsheets` or `drive`. The key is a long-lived credential: it is read from an environment variable or a secret manager (AWS Secrets Manager, for example) and parsed by [`loadServiceAccountKey()`](./service-account.ts), which validates its fields, rejects a personal credential file (`"type": "authorized_user"`) and never puts the key in an error message. Rotate keys, and prefer keyless options (such as workload identity federation) where the platform supports them.

**Reading the range.** `GET https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}/values/{range}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE` returns `{ range, majorDimension, values }`. Three quirks shape the parser:

- With `FORMATTED_VALUE` every cell is the string the sheet displays (`"50"`, not `50`), so numbers are parsed on purpose.
- Trailing empty cells are omitted: a row with an empty last column is shorter than the header, and missing cells are treated as empty strings.
- `values` is absent for an empty range, so it defaults to `[]`.

The response is validated with zod too: a number where a string is expected means someone changed the render option.

**Validating rows without losing any.** [`parseRows()`](./parse-rows.ts) checks the header first (if the columns moved, no row can be trusted) and then validates each row: trimmed name and team required, a valid email, an allocation that is a whole number up to 100. There is no `z.coerce.number()`: it would turn an empty cell into `0` and accept it. Each invalid row is returned with the row number people see in the sheet (taken from the response's `range`, so a range starting at row 5 numbers from there) and every problem found. Blank rows are layout and are skipped. A test checks the bookkeeping: valid + invalid + blank = all data rows.

## Common mistakes

| Symptom                                                      | Cause                                                                                                    |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| The job works for an hour after each deploy                  | A personal access token in the code or config; it expires and belongs to someone.                        |
| 403 `PERMISSION_DENIED` from the Sheets API                  | The sheet is not shared with the service account email, or the impersonated user cannot open it.         |
| `unauthorized_client` from the token endpoint with `subject` | Domain-wide delegation not authorized for this client ID, or for exactly these scopes.                   |
| `invalid_grant` from the token endpoint                      | The key was deleted or rotated, the email does not match the key, or the machine's clock is off.         |
| A key decoding error when creating the client                | The private key's newlines arrived as the two characters `\n` (common when pasted into an env variable). |
| `allocation: 0` for people with an empty cell                | `Number('')` or `z.coerce.number()` turn empty into 0.                                                   |
| Rows "disappear" from the import                             | Invalid rows filtered out without reporting them.                                                        |
| Row numbers in the report don't match the sheet              | Array indexes reported instead of sheet rows (header row, and ranges that don't start at row 1).         |

## Practice

Add a `--dry-run` command that prints the invalid rows as a table and exits 1 when there are any, so whoever owns the sheet can fix it before the import runs.
