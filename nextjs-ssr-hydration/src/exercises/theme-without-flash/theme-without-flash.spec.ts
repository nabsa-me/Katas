import { expect, test, type Page } from '@playwright/test';
import { collectProblems, hydrationProblems, openAndHydrate } from '../../lib/console';

const BASE = 'http://localhost:5803';
const darkCookie = { name: 'theme', value: 'dark', url: BASE };

/** Stores a dark preference in localStorage before any script of the page runs. */
async function storeDarkInLocalStorage(page: Page) {
  await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
}

const htmlHasDark = (page: Page) => page.evaluate(() => document.documentElement.classList.contains('dark'));

test.describe('theme from a cookie, rendered on the server', () => {
  test('the raw HTML already carries the theme class', async ({ request }) => {
    const response = await request.get('/theme-without-flash/cookie', { headers: { Cookie: 'theme=dark' } });
    expect(await response.text()).toMatch(/<html[^>]*class="dark"/);
  });

  test('without a cookie the server renders the default theme', async ({ request }) => {
    const response = await request.get('/theme-without-flash/cookie');
    expect(await response.text()).toMatch(/<html[^>]*class="light"/);
  });

  test('hydrates without warnings', async ({ page, context }) => {
    await context.addCookies([darkCookie]);
    const problems = collectProblems(page);
    await openAndHydrate(page, '/theme-without-flash/cookie');
    expect(await htmlHasDark(page)).toBe(true);
    expect(problems).toEqual([]);
  });

  test('switching posts a Server Action that sets the cookie and survives a reload', async ({ page, context }) => {
    await openAndHydrate(page, '/theme-without-flash/cookie');
    await page.getByRole('button', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveClass('dark');
    expect((await context.cookies()).find((cookie) => cookie.name === 'theme')?.value).toBe('dark');

    await page.reload();
    await expect(page.locator('html')).toHaveClass('dark');
    await expect(page.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('theme read from localStorage during render', () => {
  test('React reports a hydration mismatch and does not patch the class', async ({ page }) => {
    await storeDarkInLocalStorage(page);
    const problems = collectProblems(page);
    await openAndHydrate(page, '/theme-without-flash/stored-in-render');

    expect(hydrationProblems(problems).join('\n')).toMatch(/hydrated but some attributes/);
    // React's state says "dark", but the DOM keeps every attribute the server rendered.
    const toggle = page.getByRole('button', { name: 'Dark theme' });
    await expect(page.locator('.theme-root')).not.toHaveClass(/dark/);
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    // The first click goes from the state React believes (dark) to light: nothing changes on screen.
    await toggle.click();
    await expect(page.locator('.theme-root')).not.toHaveClass(/dark/);
    await toggle.click();
    await expect(page.locator('.theme-root')).toHaveClass(/dark/);
  });
});

test.describe('theme from an inline script', () => {
  test('follows the system preference and hydrates without warnings', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    const problems = collectProblems(page);
    await openAndHydrate(page, '/theme-without-flash/system');
    expect(await htmlHasDark(page)).toBe(true);
    await expect(page.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true');
    expect(problems).toEqual([]);
  });

  test('an explicit choice is stored in the cookie and wins over the system', async ({ page, context }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openAndHydrate(page, '/theme-without-flash/system');
    await page.getByRole('button', { name: 'Light' }).click();
    expect(await htmlHasDark(page)).toBe(false);
    expect((await context.cookies()).find((cookie) => cookie.name === 'theme')?.value).toBe('light');

    await page.reload();
    expect(await htmlHasDark(page)).toBe(false);
  });
});

test.describe('the first paint, before any JavaScript bundle runs', () => {
  // With the bundles blocked, React never loads: the page stays exactly as the browser painted it from
  // the HTML and the inline scripts. That is what the user sees until hydration.
  test.beforeEach(async ({ page }) => {
    await page.route('**/_next/static/**/*.js', (route) => route.abort());
  });

  test('localStorage read in an effect paints the light theme first (flash)', async ({ page }) => {
    await storeDarkInLocalStorage(page);
    await page.goto('/theme-without-flash/stored-in-effect');
    expect(await htmlHasDark(page)).toBe(false);
  });

  test('the cookie variant paints the stored theme', async ({ page, context }) => {
    await context.addCookies([darkCookie]);
    await page.goto('/theme-without-flash/cookie');
    expect(await htmlHasDark(page)).toBe(true);
  });

  test('the inline script paints the system preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/theme-without-flash/system');
    expect(await htmlHasDark(page)).toBe(true);
  });

  test('the inline script paints the stored choice over the system preference', async ({ page, context }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await context.addCookies([{ ...darkCookie, value: 'light' }]);
    await page.goto('/theme-without-flash/system');
    expect(await htmlHasDark(page)).toBe(false);
  });
});
