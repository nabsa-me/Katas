import { useEffect, useState } from 'react';

export function Ticker() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    // BUG: this callback is created during the first render and keeps that render's `count` (0) forever.
    // Every tick computes 0 + 1, so the counter goes to 1 and stays there.
    const id = setInterval(() => setCount(count + 1), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the flawed version: `count` is missing on purpose
  }, []);

  return (
    <output className="ticker" aria-label="Flawed count">
      {count}
    </output>
  );
}
