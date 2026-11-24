import { z } from 'zod';

/** The columns the importer expects, in order. A different header means the sheet changed shape. */
export const ROSTER_HEADER = ['Name', 'Email', 'Team', 'Allocation'] as const;

// Cells arrive as the strings the sheet displays. Every rule is explicit: `z.coerce.number()` would turn an empty
// cell into 0 and accept it, which is exactly the silent bad data this exercise is about.
const rosterRowSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  email: z.string().trim().pipe(z.email('Email is not a valid address')),
  team: z.string().trim().min(1, 'Team is required'),
  allocation: z
    .string()
    .trim()
    .regex(/^\d+$/, 'Allocation must be a whole number of percent')
    .transform(Number)
    .pipe(z.number().max(100, 'Allocation cannot be above 100')),
});

export type TeamMember = z.output<typeof rosterRowSchema>;

export interface InvalidRow {
  /** The row number people see in the sheet, so whoever fixes it can go straight there. */
  rowNumber: number;
  issues: string[];
}

export interface ParsedRows {
  valid: TeamMember[];
  invalid: InvalidRow[];
}

export class SheetFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SheetFormatError';
  }
}

/**
 * Validates the rows of a range whose first row is the header. Valid rows are returned typed; invalid rows are
 * returned with their sheet row number and every problem found, never dropped silently. Blank rows are layout,
 * not data, and are skipped. A wrong header throws: if the columns moved, no row can be trusted.
 */
export function parseRows(values: readonly (readonly string[])[], headerRowNumber = 1): ParsedRows {
  const [header, ...rows] = values;
  if (!header || ROSTER_HEADER.some((name, i) => header[i]?.trim() !== name)) {
    throw new SheetFormatError(
      `Expected the header ${ROSTER_HEADER.join(', ')}, got ${header?.join(', ') || 'nothing'}`,
    );
  }

  const result: ParsedRows = { valid: [], invalid: [] };
  rows.forEach((row, index) => {
    if (row.every((cell) => cell.trim() === '')) return;
    // The API omits trailing empty cells, so a row can be shorter than the header: missing means empty.
    const [name = '', email = '', team = '', allocation = ''] = row;
    const parsed = rosterRowSchema.safeParse({ name, email, team, allocation });
    if (parsed.success) {
      result.valid.push(parsed.data);
    } else {
      const issues = parsed.error.issues.map((issue) => issue.message);
      result.invalid.push({ rowNumber: headerRowNumber + 1 + index, issues });
    }
  });
  return result;
}
