import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderLog } from '../../lib/render-log';
import { HighlightedSummary as FixedSummary } from './HighlightFrame';
import { HighlightedSummary as FlawedSummary } from './HighlightFrame.problem';

const TOGGLES = 3;

async function toggleHighlight(times: number) {
  const user = userEvent.setup();
  for (let i = 0; i < times; i++) await user.click(screen.getByRole('button', { name: 'Highlight' }));
}

describe('composition with children', () => {
  it('the flawed frame renders the summary again on every toggle', async () => {
    render(<FlawedSummary />);
    await toggleHighlight(TOGGLES);
    expect(renderLog.count('Flawed summary')).toBe(1 + TOGGLES);
  });

  it('the summary passed as children renders once, although the frame renders on every toggle', async () => {
    render(<FixedSummary />);
    await toggleHighlight(TOGGLES);
    expect(renderLog.count('Fixed summary')).toBe(1);
    expect(screen.getByRole('button', { name: 'Highlight' })).toHaveAttribute('aria-pressed', 'true');
  });
});
