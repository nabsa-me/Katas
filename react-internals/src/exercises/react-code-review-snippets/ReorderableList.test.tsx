import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ReorderableList as FixedList } from './ReorderableList';
import { ReorderableList as FlawedList } from './ReorderableList.problem';
import { SNIPPET_ISSUES } from './snippets';

const [first, second] = SNIPPET_ISSUES.map((issue) => issue.key);

async function typeNoteAndMoveUp() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(`Note for ${second}`), 'blocked');
  await user.click(screen.getByRole('button', { name: `Move ${second} up` }));
}

describe('key={index} in a reorderable list', () => {
  it('leaves the typed note at the old position, next to another issue', async () => {
    render(<FlawedList />);
    await typeNoteAndMoveUp();
    expect(screen.getByLabelText(`Note for ${second}`)).toHaveValue('');
    expect(screen.getByLabelText(`Note for ${first}`)).toHaveValue('blocked');
  });

  it('with a stable key, the note moves with its issue', async () => {
    render(<FixedList />);
    await typeNoteAndMoveUp();
    expect(screen.getByLabelText(`Note for ${second}`)).toHaveValue('blocked');
    expect(screen.getByLabelText(`Note for ${first}`)).toHaveValue('');
  });
});
