import { DARK_QUERY, THEME_COOKIE } from './theme';

/**
 * Source of the inline script placed in `<head>`. The browser runs it while parsing the HTML: before
 * the first paint and before any React code has loaded, so the page is never painted with the wrong
 * theme. It is plain ES5 inside a try/catch (it must never break the page) and repeats the small
 * amount of logic it needs, because it runs before any bundle exists.
 */
export const THEME_SCRIPT = [
  '(function () {',
  '  try {',
  `    var match = document.cookie.match(/(?:^|;\\s*)${THEME_COOKIE}=(light|dark)(?:;|$)/);`,
  `    var theme = match ? match[1] : window.matchMedia(${JSON.stringify(DARK_QUERY)}).matches ? 'dark' : 'light';`,
  '    var root = document.documentElement;',
  "    root.classList.toggle('dark', theme === 'dark');",
  '    root.style.colorScheme = theme;',
  '  } catch (error) {}',
  '})();',
].join('\n');
