import { useState } from 'react';
import { useInterval } from './useInterval';

interface TickerProps {
  /** How much each tick adds. It can change while the ticker runs. */
  step: number;
  /** Milliseconds between ticks, or `null` to pause. */
  delay: number | null;
}

export function Ticker({ step, delay }: TickerProps) {
  const [count, setCount] = useState(0);

  // Functional update: React passes the current count, so the callback never reads a captured `count`.
  // `useInterval` always calls the latest callback, so a new `step` applies on the next tick.
  useInterval(() => setCount((current) => current + step), delay);

  return (
    <output className="ticker" aria-label="Fixed count">
      {count}
    </output>
  );
}
