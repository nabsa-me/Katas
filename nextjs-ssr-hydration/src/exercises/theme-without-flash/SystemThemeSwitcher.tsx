'use client';

import { useLayoutEffect, useSyncExternalStore } from 'react';
import {
  applyTheme,
  DARK_QUERY,
  readThemeCookie,
  resolveTheme,
  themeCookieAssignment,
  type ThemePreference,
} from './theme';

// The stored preference lives in a cookie, outside React: a tiny external store over it.
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

const getSnapshot = (): ThemePreference => readThemeCookie(document.cookie) ?? 'system';

// The server cannot know the preference; React uses this value during hydration so the first client
// render matches the server HTML, and re-renders with the real snapshot right after.
const getServerSnapshot = (): ThemePreference | null => null;

/** Writes the cookie (read by the inline script on the next load) and notifies the subscribers. */
function storePreference(next: ThemePreference) {
  document.cookie = themeCookieAssignment(next === 'system' ? null : next, location.protocol === 'https:');
  listeners.forEach((notify) => notify());
}

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

export function SystemThemeSwitcher() {
  const preference = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Keeps <html> in sync with the preference before the browser paints. On load the inline script has
  // already done it; this also re-applies the class after the development-only Strict Mode remount,
  // which resets the attributes of <html>, and follows the system while the preference is "system".
  useLayoutEffect(() => {
    if (preference === null) return;
    const media = window.matchMedia(DARK_QUERY);
    const apply = () => applyTheme(document.documentElement, resolveTheme(preference, media.matches));
    apply();
    if (preference !== 'system') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [preference]);

  return (
    <div className="controls" role="group" aria-label="Theme">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={preference === option.value}
          onClick={() => storePreference(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
