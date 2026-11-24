import { setThemeAction } from './actions';
import type { Theme } from './theme';

/**
 * A Server Component: a plain form posting to a Server Action. It works before the JavaScript loads
 * (and without it), and after hydration Next.js submits it without a full page load.
 */
export function CookieThemeForm({ current }: { current: Theme }) {
  return (
    <form action={setThemeAction} className="controls" aria-label="Theme">
      {(['light', 'dark'] as const).map((theme) => (
        <button key={theme} type="submit" name="theme" value={theme} aria-pressed={current === theme}>
          {theme === 'light' ? 'Light' : 'Dark'}
        </button>
      ))}
    </form>
  );
}
