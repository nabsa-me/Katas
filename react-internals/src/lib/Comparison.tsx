import type { ReactNode, Ref } from 'react';

interface ComparisonProps {
  title: string;
  /** What to do in the demo to see the difference. */
  instructions: ReactNode;
  problem: ReactNode;
  solution: ReactNode;
}

/** Layout shared by every exercise: the flawed version next to the fixed one. */
export function Comparison({ title, instructions, problem, solution }: ComparisonProps) {
  return (
    <section className="exercise">
      <h2>{title}</h2>
      <p className="instructions">{instructions}</p>
      <div className="comparison">
        <article className="card" aria-label="Problem">
          <h3 className="tag problem">Problem</h3>
          {problem}
        </article>
        <article className="card" aria-label="Solution">
          <h3 className="tag solution">Solution</h3>
          {solution}
        </article>
      </div>
    </section>
  );
}

interface BadgeProps {
  label: string;
  /** The ref returned by `useRenderCount` or `useChangeCount`, which writes the number. */
  ref: Ref<HTMLSpanElement>;
}

/** A counter whose number is written by an effect, not by React state. */
export function Badge({ label, ref }: BadgeProps) {
  return (
    <span className="badge">
      <span ref={ref}>0</span> {label}
    </span>
  );
}
