import { describe, expect, it } from 'vitest';
import roster from '../../data/team-roster-sheet.json';
import { parseRows, SheetFormatError } from './parse-rows';

const HEADER = ['Name', 'Email', 'Team', 'Allocation'];

describe('parseRows', () => {
  it('returns typed valid rows, with text trimmed and the allocation as a number', () => {
    const { valid, invalid } = parseRows([HEADER, ['Ona Mas', ' ona.mas@example.com ', 'Web', '75']]);
    expect(valid).toEqual([{ name: 'Ona Mas', email: 'ona.mas@example.com', team: 'Web', allocation: 75 }]);
    expect(invalid).toEqual([]);
  });

  it('reports every invalid row with its sheet row number and all its problems', () => {
    const { valid, invalid } = parseRows(roster.values);
    expect(valid.map((member) => member.name)).toEqual(['Marta Vidal', 'Jordi Puig', 'Ona Mas']);
    expect(invalid).toEqual([
      { rowNumber: 4, issues: ['Email is not a valid address'] },
      { rowNumber: 6, issues: ['Allocation must be a whole number of percent'] },
      { rowNumber: 7, issues: ['Allocation cannot be above 100'] },
      { rowNumber: 8, issues: ['Allocation must be a whole number of percent'] },
      { rowNumber: 9, issues: ['Team is required'] },
    ]);
  });

  it('accounts for valid + invalid + blank rows: nothing disappears silently', () => {
    const { valid, invalid } = parseRows(roster.values);
    const dataRows = roster.values.length - 1;
    const blankRows = roster.values.filter((row) => row.length === 0).length;
    expect(valid.length + invalid.length + blankRows).toBe(dataRows);
  });

  it('collects several problems of the same row', () => {
    const { invalid } = parseRows([HEADER, ['', 'nobody', '', '-5']]);
    expect(invalid).toEqual([
      {
        rowNumber: 2,
        issues: [
          'Name is required',
          'Email is not a valid address',
          'Team is required',
          'Allocation must be a whole number of percent',
        ],
      },
    ]);
  });

  it('treats an empty allocation as missing, not as zero', () => {
    const { invalid } = parseRows([HEADER, ['Pau Serra', 'pau.serra@example.com', 'Data', '']]);
    expect(invalid[0]?.issues).toEqual(['Allocation must be a whole number of percent']);
  });

  it('numbers rows from where the range starts', () => {
    const { invalid } = parseRows([HEADER, ['Pau Serra', 'bad', 'Data', '10']], 5);
    expect(invalid[0]?.rowNumber).toBe(6);
  });

  it('refuses a sheet whose columns changed', () => {
    expect(() => parseRows([['Name', 'Team', 'Email', 'Allocation']])).toThrow(SheetFormatError);
    expect(() => parseRows([])).toThrow(SheetFormatError);
  });
});
