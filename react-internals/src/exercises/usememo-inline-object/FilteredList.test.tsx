import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMemo, useState, type ComponentType } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { issues, type Issue } from '../../lib/issues';
import { expensiveFilter, type IssueFilters } from './filter';
import { FilteredList as FixedList, IssueBoard as FixedBoard } from './FilteredList';
import { FilteredList as FlawedList, IssueBoard as FlawedBoard } from './FilteredList.problem';

// The real function wrapped in a spy: it counts how many times the components run the filter.
vi.mock('./filter', async (importOriginal) => {
  const original = await importOriginal<typeof import('./filter')>();
  return { ...original, expensiveFilter: vi.fn(original.expensiveFilter) };
});

const UNRELATED_UPDATES = 5;

async function pressUnrelatedUpdate(times: number) {
  const user = userEvent.setup();
  for (let i = 0; i < times; i++) {
    await user.click(screen.getByRole('button', { name: /unrelated update/i }));
  }
}

beforeEach(() => {
  vi.mocked(expensiveFilter).mockClear();
});

describe('flawed board: inline object in the parent, object dependency in the child', () => {
  it('runs the filter again on every render, even when nothing it depends on changed', async () => {
    render(<FlawedBoard />);
    await pressUnrelatedUpdate(UNRELATED_UPDATES);
    expect(expensiveFilter).toHaveBeenCalledTimes(1 + UNRELATED_UPDATES);
  });
});

describe('fixed board', () => {
  it('runs the filter once, however many unrelated renders happen', async () => {
    render(<FixedBoard />);
    await pressUnrelatedUpdate(UNRELATED_UPDATES);
    expect(expensiveFilter).toHaveBeenCalledTimes(1);
  });

  it('still runs the filter when the filter really changes', async () => {
    const user = userEvent.setup();
    render(<FixedBoard />);
    await user.selectOptions(screen.getByLabelText('Status'), 'done');
    expect(expensiveFilter).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/^\d+ issues/)).toHaveTextContent(
      `${issues.filter((i) => i.status === 'done').length} issues`,
    );
  });
});

interface ListProps {
  items: readonly Issue[];
  filters: IssueFilters;
}

/** Recreates the filters object on every render, like the flawed parent. */
function InlineObjectParent({ List }: { List: ComponentType<ListProps> }) {
  const [, setUnrelated] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setUnrelated((n) => n + 1)}>
        Unrelated update
      </button>
      <List items={issues} filters={{ status: 'all', query: '' }} />
    </>
  );
}

/** Keeps the filters object stable, like the fixed parent. */
function MemoizedObjectParent({ List }: { List: ComponentType<ListProps> }) {
  const [, setUnrelated] = useState(0);
  const filters = useMemo<IssueFilters>(() => ({ status: 'all', query: '' }), []);
  return (
    <>
      <button type="button" onClick={() => setUnrelated((n) => n + 1)}>
        Unrelated update
      </button>
      <List items={issues} filters={filters} />
    </>
  );
}

describe('each fix is enough on its own', () => {
  it('primitive dependencies in the child survive a parent that recreates the object', async () => {
    render(<InlineObjectParent List={FixedList} />);
    await pressUnrelatedUpdate(UNRELATED_UPDATES);
    expect(expensiveFilter).toHaveBeenCalledTimes(1);
  });

  it('a memoized object in the parent fixes the child that depends on the object', async () => {
    render(<MemoizedObjectParent List={FlawedList} />);
    await pressUnrelatedUpdate(UNRELATED_UPDATES);
    expect(expensiveFilter).toHaveBeenCalledTimes(1);
  });
});
