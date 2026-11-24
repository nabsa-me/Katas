import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { IssueEditor as FixedEditor } from './IssueEditor';
import { IssueEditor as FlawedEditor } from './IssueEditor.problem';
import { SNIPPET_ISSUES } from './snippets';

const [first, second] = SNIPPET_ISSUES;

describe('state copied from props', () => {
  it('keeps the first issue title after selecting another issue', async () => {
    const user = userEvent.setup();
    render(<FlawedEditor />);
    await user.click(screen.getByRole('button', { name: second!.key }));
    expect(screen.getByRole('heading', { name: second!.key })).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue(first!.title);
  });

  it('with a key per issue, the draft starts from the selected issue', async () => {
    const user = userEvent.setup();
    render(<FixedEditor />);
    await user.clear(screen.getByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), 'Draft that belongs to the first issue');
    await user.click(screen.getByRole('button', { name: second!.key }));
    expect(screen.getByLabelText('Title')).toHaveValue(second!.title);
  });
});
