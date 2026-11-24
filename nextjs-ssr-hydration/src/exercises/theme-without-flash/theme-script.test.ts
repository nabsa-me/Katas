import { describe, expect, it } from 'vitest';
import { THEME_SCRIPT } from './theme-script';

/** Runs the inline script against a fake document and window, as the browser would in `<head>`. */
function runScript(cookie: string, prefersDark: boolean) {
  const classes = new Set<string>();
  const root = {
    classList: { toggle: (token: string, force: boolean) => (force ? classes.add(token) : classes.delete(token)) },
    style: { colorScheme: '' },
  };
  const document = { cookie, documentElement: root };
  const window = {
    matchMedia: (query: string) => ({ matches: prefersDark && query === '(prefers-color-scheme: dark)' }),
  };
  new Function('document', 'window', THEME_SCRIPT)(document, window);
  return { dark: classes.has('dark'), colorScheme: root.style.colorScheme };
}

describe('THEME_SCRIPT', () => {
  it('applies the theme stored in the cookie', () => {
    expect(runScript('theme=dark', false)).toEqual({ dark: true, colorScheme: 'dark' });
  });

  it('prefers the stored choice over the system preference', () => {
    expect(runScript('a=1; theme=light', true)).toEqual({ dark: false, colorScheme: 'light' });
  });

  it('follows the system preference when there is no choice', () => {
    expect(runScript('', true)).toEqual({ dark: true, colorScheme: 'dark' });
    expect(runScript('', false)).toEqual({ dark: false, colorScheme: 'light' });
  });

  it('ignores unknown values instead of injecting them', () => {
    expect(runScript('theme=evil', true)).toEqual({ dark: true, colorScheme: 'dark' });
  });

  it('never throws, even without matchMedia', () => {
    const document = { cookie: '', documentElement: {} };
    expect(() => new Function('document', 'window', THEME_SCRIPT)(document, {})).not.toThrow();
  });
});
