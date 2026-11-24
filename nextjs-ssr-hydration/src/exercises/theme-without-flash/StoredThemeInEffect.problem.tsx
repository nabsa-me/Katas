'use client';

import { useEffect } from 'react';
import { applyTheme, parseTheme, THEME_STORAGE_KEY } from './theme';

export function StoredThemeInEffect() {
  useEffect(() => {
    // BUG: effects run after hydration, and hydration happens after the browser has painted the server
    // HTML. There is no hydration warning, but a user with a dark preference sees the light page first.
    applyTheme(document.documentElement, parseTheme(localStorage.getItem(THEME_STORAGE_KEY)) ?? 'light');
  }, []);

  function toggle() {
    const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
    localStorage.setItem(THEME_STORAGE_KEY, next);
    applyTheme(document.documentElement, next);
  }

  return (
    <button type="button" onClick={toggle}>
      Toggle theme
    </button>
  );
}
