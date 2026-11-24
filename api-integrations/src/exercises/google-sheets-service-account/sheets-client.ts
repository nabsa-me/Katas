import { z } from 'zod';
import { parseRows, type ParsedRows } from './parse-rows';

/** `GET …/values/{range}` response. `values` is absent when the range is empty; trailing empty cells are omitted. */
const valueRangeSchema = z.object({
  range: z.string(),
  majorDimension: z.literal('ROWS'),
  values: z.array(z.array(z.string())).optional(),
});

/** Anything that can produce the `Authorization` header: the service account's JWT client in this exercise. */
export interface AuthHeadersProvider {
  getRequestHeaders(url?: string): Promise<Headers>;
}

export class SheetsApiError extends Error {
  readonly status: number;

  constructor(status: number, detail: string) {
    super(`Sheets API answered ${status}: ${detail.slice(0, 300)}`);
    this.name = 'SheetsApiError';
    this.status = status;
  }
}

export interface SheetValues {
  /** The range the API actually returned, in A1 notation (`Roster!A1:D10`). */
  range: string;
  values: string[][];
}

/**
 * Reads a range as rows of displayed strings (`FORMATTED_VALUE`): what people see in the sheet, so "50" stays
 * "50" and a date stays a date string. The auth client adds `Authorization: Bearer …`, getting or refreshing the
 * access token first if needed.
 */
export async function readSheetValues(
  auth: AuthHeadersProvider,
  spreadsheetId: string,
  range: string,
): Promise<SheetValues> {
  const query = new URLSearchParams({ majorDimension: 'ROWS', valueRenderOption: 'FORMATTED_VALUE' });
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?${query}`;
  const response = await fetch(url, { headers: await auth.getRequestHeaders(url) });
  if (!response.ok) throw new SheetsApiError(response.status, await response.text());
  const body = valueRangeSchema.parse(await response.json());
  return { range: body.range, values: body.values ?? [] };
}

/** The team roster: read the range, then validate every row. */
export async function readTeamRoster(
  auth: AuthHeadersProvider,
  spreadsheetId: string,
  range = 'Roster!A1:D',
): Promise<ParsedRows> {
  const sheet = await readSheetValues(auth, spreadsheetId, range);
  return parseRows(sheet.values, firstRowNumber(sheet.range));
}

/** The first row of an A1 range (`'Team roster'!B5:E` → 5), so reported row numbers match the sheet. */
export function firstRowNumber(a1Range: string): number {
  const cells = a1Range.slice(a1Range.lastIndexOf('!') + 1);
  const match = /^[A-Za-z]*(\d+)/.exec(cells);
  return match?.[1] ? Number(match[1]) : 1;
}
