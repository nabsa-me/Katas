import { useState } from 'react';
import { Comparison } from '../../lib/Comparison';
import { Ticker as FixedTicker } from './Ticker';
import { Ticker as FlawedTicker } from './Ticker.problem';

const STEPS = [1, 5, 10];

function FixedTickerWithControls() {
  const [step, setStep] = useState(1);
  const [running, setRunning] = useState(true);

  return (
    <>
      <div className="controls">
        <label>
          Step
          <select value={step} onChange={(e) => setStep(Number(e.target.value))}>
            {STEPS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <button type="button" aria-pressed={!running} onClick={() => setRunning((r) => !r)}>
          {running ? 'Pause' : 'Resume'}
        </button>
      </div>
      <FixedTicker step={step} delay={running ? 1000 : null} />
    </>
  );
}

export function StaleClosures() {
  return (
    <Comparison
      title="Stale closures"
      instructions={
        <>
          Both counters tick every second. The problem stops at 1. The solution keeps counting, applies a new step on
          the next tick without restarting the timer, and can be paused.
        </>
      }
      problem={<FlawedTicker />}
      solution={<FixedTickerWithControls />}
    />
  );
}
