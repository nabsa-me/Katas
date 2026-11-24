import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { LabelEditor as FixedEditor } from './LabelEditor';
import { LabelEditor as FlawedEditor } from './LabelEditor.problem';

async function addLabelThroughTheForm(label: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('New label'), label);
  await user.click(screen.getByRole('button', { name: 'Add' }));
  return within(screen.getByRole('list', { name: 'Labels' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent);
}

describe('state mutated in place', () => {
  it('does not show the new label: the same array reference skips the render', async () => {
    render(<FlawedEditor />);
    expect(await addLabelThroughTheForm('urgent')).toEqual(['backend']);
  });

  it('with a new array, the label shows up immediately', async () => {
    render(<FixedEditor />);
    expect(await addLabelThroughTheForm('urgent')).toEqual(['backend', 'urgent']);
  });
});
