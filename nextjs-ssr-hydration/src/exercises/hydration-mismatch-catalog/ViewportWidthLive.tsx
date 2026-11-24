'use client';

/**
 * Reads `window` directly while rendering. Safe only because it is never rendered on the server:
 * it is loaded with `dynamic(..., { ssr: false })` from `ViewportWidthWithoutSsr`.
 */
export default function ViewportWidthLive() {
  return <p>Viewport width when loaded, without server rendering: {window.innerWidth}px</p>;
}
