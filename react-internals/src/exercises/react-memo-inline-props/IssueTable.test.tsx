import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderLog } from '../../lib/render-log';
import { IssueTable as FixedTable } from './IssueTable';
import { IssueTable as FlawedTable } from './IssueTable.problem';
import { TABLE_ISSUES } from './table';

/** Renders committed by each row, keyed by issue key. */
function rowRenders(prefix: string): Record<string, number> {
  return Object.fromEntries(TABLE_ISSUES.map((issue) => [issue.key, renderLog.count(`${prefix} row ${issue.key}`)]));
}

const [first, second, third] = TABLE_ISSUES.map((issue) => issue.key);

describe('flawed table: inline style, columns and handler', () => {
  it('renders every row again when one row is selected', async () => {
    const user = userEvent.setup();
    render(<FlawedTable />);
    await user.click(screen.getByRole('button', { name: `Select ${second}` }));

    expect(Object.values(rowRenders('Flawed'))).toEqual(TABLE_ISSUES.map(() => 2));
  });
});

describe('fixed table: hoisted constants and a stable handler', () => {
  it('renders only the row whose selection changed', async () => {
    const user = userEvent.setup();
    render(<FixedTable />);
    await user.click(screen.getByRole('button', { name: `Select ${second}` }));

    const renders = rowRenders('Fixed');
    expect(renders[second!]).toBe(2);
    expect(Object.entries(renders).filter(([key]) => key !== second)).toEqual(
      TABLE_ISSUES.filter((i) => i.key !== second).map((i) => [i.key, 1]),
    );
  });

  it('moving the selection renders the old and the new row, nothing else', async () => {
    const user = userEvent.setup();
    render(<FixedTable />);
    await user.click(screen.getByRole('button', { name: `Select ${second}` }));
    await user.click(screen.getByRole('button', { name: `Select ${third}` }));

    const renders = rowRenders('Fixed');
    expect(renders[first!]).toBe(1);
    expect(renders[second!]).toBe(3);
    expect(renders[third!]).toBe(2);
    expect(screen.getByRole('button', { name: `Select ${third}` })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: `Select ${second}` })).toHaveAttribute('aria-pressed', 'false');
  });
});
