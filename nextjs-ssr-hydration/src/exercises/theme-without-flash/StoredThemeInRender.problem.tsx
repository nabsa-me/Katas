'use client';

import { useState, type ReactNode } from 'react';
import { parseTheme, THEME_STORAGE_KEY, type Theme } from './theme';

export function StoredThemeInRender({ children }: { children: ReactNode }) {
  // BUG: browser storage read while rendering. The server has no localStorage and renders "light";
  // the browser's first render reads "dark". While hydrating, React finds a class that does not
  // match what it would render, reports it and does not patch it: the page stays light.
  const [theme, setTheme] = useState<Theme>(() =>
    typeof window === 'undefined' ? 'light' : (parseTheme(localStorage.getItem(THEME_STORAGE_KEY)) ?? 'light'),
  );

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_STORAGE_KEY, next);
    setTheme(next);
  }

  return (
    <div className={`theme-root ${theme}`}>
      <div className="page">
        <button type="button" aria-pressed={theme === 'dark'} onClick={toggle}>
          Dark theme
        </button>
        {children}
      </div>
    </div>
  );
}
