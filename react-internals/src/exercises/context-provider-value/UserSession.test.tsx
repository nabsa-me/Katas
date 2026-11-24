import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderLog } from '../../lib/render-log';
import { SessionPanel as FixedPanel } from './UserSession';
import { SessionPanel as FlawedPanel } from './UserSession.problem';

async function pressUnrelatedUpdate(times: number) {
  const user = userEvent.setup();
  for (let i = 0; i < times; i++) await user.click(screen.getByRole('button', { name: /unrelated update/i }));
}

/** Types a name, then submits; returns the render counts right before submitting. */
async function rename(name: string, prefix: 'Flawed' | 'Fixed') {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('New name'), name);
  const before = { name: renderLog.count(`${prefix} user name`), form: renderLog.count(`${prefix} rename form`) };
  await user.click(screen.getByRole('button', { name: 'Rename' }));
  return before;
}

describe('flawed provider: inline value object', () => {
  it('renders every consumer when the provider renders for an unrelated reason', async () => {
    render(<FlawedPanel />);
    await pressUnrelatedUpdate(3);
    expect(renderLog.count('Flawed user name')).toBe(1 + 3);
    expect(renderLog.count('Flawed rename form')).toBe(1 + 3);
  });

  it('renders the actions-only consumer when the user changes', async () => {
    render(<FlawedPanel />);
    const before = await rename('Pau Serra', 'Flawed');
    expect(screen.getByText('Pau Serra')).toBeInTheDocument();
    expect(renderLog.count('Flawed rename form')).toBe(before.form + 1);
  });
});

describe('fixed provider: memoized actions in their own context', () => {
  it('renders no consumer when the provider renders for an unrelated reason', async () => {
    render(<FixedPanel />);
    await pressUnrelatedUpdate(3);
    expect(renderLog.count('Fixed user name')).toBe(1);
    expect(renderLog.count('Fixed rename form')).toBe(1);
  });

  it('renders only the state consumer when the user changes', async () => {
    render(<FixedPanel />);
    const before = await rename('Pau Serra', 'Fixed');
    expect(screen.getByText('Pau Serra')).toBeInTheDocument();
    expect(renderLog.count('Fixed user name')).toBe(before.name + 1);
    expect(renderLog.count('Fixed rename form')).toBe(before.form);
  });
});
