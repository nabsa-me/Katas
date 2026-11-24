'use client';

export function ViewportWidth() {
  // BUG: the server has no window and renders "unknown"; the browser's first render reads the real
  // width. Different text, so the hydration fails.
  const width = typeof window === 'undefined' ? null : window.innerWidth;
  return <p>Viewport width: {width === null ? 'unknown' : `${width}px`}</p>;
}
