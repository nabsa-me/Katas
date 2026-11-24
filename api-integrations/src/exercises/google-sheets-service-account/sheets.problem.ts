/* eslint-disable @typescript-eslint/no-explicit-any -- the flawed version keeps the untyped code it is about */

// BUG: a personal OAuth access token pasted into the code. It belongs to one person, expires within the hour, can
// do everything that person can, ends up in the repository history, and stops working when they leave.
const ACCESS_TOKEN = 'replace-with-a-personal-oauth-token';

/** Flawed: reads the team roster with a personal token and trusts every row. */
export async function readTeamRoster(spreadsheetId: string): Promise<any[]> {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Roster!A1:D`, {
    headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
  });
  const body: any = await response.json();

  // BUG: no validation. A missing cell becomes undefined, "full time" becomes NaN, a broken email goes straight
  // into the target system, and a blank row becomes an empty person. Nobody is told which row was wrong.
  return body.values.slice(1).map(([name, email, team, allocation]: string[]) => ({
    name,
    email,
    team,
    allocation: Number(allocation),
  }));
}
