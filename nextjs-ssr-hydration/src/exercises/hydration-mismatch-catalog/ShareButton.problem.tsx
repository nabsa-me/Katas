'use client';

export function ShareButton() {
  // BUG: the server renders the paragraph, the browser's first render renders the button. React finds a
  // different element while hydrating, discards the server HTML and renders this part again.
  return typeof window === 'undefined' ? (
    <p>Sharing is not available yet.</p>
  ) : (
    <button type="button" onClick={() => navigator.clipboard.writeText(location.href)}>
      Copy link
    </button>
  );
}
