import { describe, expect, it } from 'vitest';
import {
  applyTheme,
  parseTheme,
  readThemeCookie,
  resolveTheme,
  themeCookieAssignment,
  themeCookieOptions,
  type ThemeTarget,
} from './theme';

describe('parseTheme', () => {
  it('accepts only the known themes', () => {
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('Dark')).toBeNull();
    expect(parseTheme('system')).toBeNull();
    expect(parseTheme(undefined)).toBeNull();
    expect(parseTheme('<script>')).toBeNull();
  });
});

describe('readThemeCookie', () => {
  it('finds the theme among other cookies', () => {
    expect(readThemeCookie('session=abc; theme=dark; other=1')).toBe('dark');
    expect(readThemeCookie('theme=light')).toBe('light');
  });

  it('ignores missing, unknown and look-alike cookies', () => {
    expect(readThemeCookie('')).toBeNull();
    expect(readThemeCookie('theme=purple')).toBeNull();
    expect(readThemeCookie('mytheme=dark')).toBeNull();
  });
});

describe('resolveTheme', () => {
  it('uses the explicit choice regardless of the system', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('follows the system preference for "system"', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('themeCookieAssignment', () => {
  it('stores a theme for a year', () => {
    expect(themeCookieAssignment('dark', false)).toBe('theme=dark; Path=/; SameSite=Lax; Max-Age=31536000');
  });

  it('deletes the cookie when going back to the system preference', () => {
    expect(themeCookieAssignment(null, true)).toBe('theme=; Path=/; SameSite=Lax; Max-Age=0; Secure');
  });
});

describe('themeCookieOptions', () => {
  it('is readable by the inline script and survives a year', () => {
    expect(themeCookieOptions(true)).toEqual({
      path: '/',
      sameSite: 'lax',
      maxAge: 31536000,
      httpOnly: false,
      secure: true,
    });
  });
});

describe('applyTheme', () => {
  it('toggles the dark class and sets color-scheme', () => {
    const classes = new Set<string>();
    const root: ThemeTarget = {
      classList: { toggle: (token, force) => (force ? classes.add(token) : classes.delete(token), !!force) },
      style: { colorScheme: '' },
    };
    applyTheme(root, 'dark');
    expect([...classes]).toEqual(['dark']);
    expect(root.style.colorScheme).toBe('dark');
    applyTheme(root, 'light');
    expect([...classes]).toEqual([]);
    expect(root.style.colorScheme).toBe('light');
  });
});
