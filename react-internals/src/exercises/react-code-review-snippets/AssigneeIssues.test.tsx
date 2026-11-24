import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { issues } from '../../lib/issues';
import { renderLog } from '../../lib/render-log';
import { AssigneeIssues as FixedList } from './AssigneeIssues';
import { AssigneeIssues as FlawedList } from './AssigneeIssues.problem';
import { ASSIGNEES, issuesFor } from './snippets';

const other = ASSIGNEES[1]!;

describe('derived data in an effect', () => {
  it('renders twice on mount and twice on every change', async () => {
    const user = userEvent.setup();
    render(<FlawedList />);
    expect(renderLog.count('Flawed assignee list')).toBe(2);

    await user.selectOptions(screen.getByLabelText('Assignee'), other);
    expect(renderLog.count('Flawed assignee list')).toBe(4);
    expect(screen.getByText(`${issuesFor(issues, other).length} issues`, { exact: false })).toBeInTheDocument();
  });

  it('computed during render, it renders once per change and is never stale', async () => {
    const user = userEvent.setup();
    render(<FixedList />);
    expect(renderLog.count('Fixed assignee list')).toBe(1);

    await user.selectOptions(screen.getByLabelText('Assignee'), other);
    expect(renderLog.count('Fixed assignee list')).toBe(2);
    expect(screen.getByText(`${issuesFor(issues, other).length} issues`, { exact: false })).toBeInTheDocument();
  });
});
