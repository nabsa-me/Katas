import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ticker as FixedTicker } from './Ticker';
import { Ticker as FlawedTicker } from './Ticker.problem';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('flawed ticker: the interval closes over the first render', () => {
  it('gets stuck at 1', () => {
    render(<FlawedTicker />);
    advance(3000);
    expect(screen.getByLabelText('Flawed count')).toHaveTextContent('1');
  });
});

describe('fixed ticker: functional update and the latest callback', () => {
  it('counts every tick', () => {
    render(<FixedTicker step={1} delay={1000} />);
    advance(3000);
    expect(screen.getByLabelText('Fixed count')).toHaveTextContent('3');
  });

  it('applies a new step on the next tick without restarting the interval', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const { rerender } = render(<FixedTicker step={1} delay={1000} />);
    advance(1500); // one tick so far, halfway to the next one

    rerender(<FixedTicker step={10} delay={1000} />);
    advance(500); // the tick due at 2000 ms arrives on time, with the new step

    expect(screen.getByLabelText('Fixed count')).toHaveTextContent('11');
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it('pauses with a null delay and resumes with a number', () => {
    const { rerender } = render(<FixedTicker step={1} delay={1000} />);
    advance(2000);
    rerender(<FixedTicker step={1} delay={null} />);
    advance(5000);
    expect(screen.getByLabelText('Fixed count')).toHaveTextContent('2');

    rerender(<FixedTicker step={1} delay={1000} />);
    advance(1000);
    expect(screen.getByLabelText('Fixed count')).toHaveTextContent('3');
  });
});
