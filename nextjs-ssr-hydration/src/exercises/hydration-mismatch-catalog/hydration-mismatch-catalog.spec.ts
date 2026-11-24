import { expect, test } from '@playwright/test';
import { collectProblems, hydrationProblems, openAndHydrate } from '../../lib/console';
import { caseHref, CASES } from './cases';
import { formatTimestamp, LAST_SYNC } from './format';

// A browser in another time zone and locale than the server (which runs with TZ=UTC), like real users.
test.use({ timezoneId: 'Pacific/Auckland', locale: 'ja-JP', viewport: { width: 1024, height: 700 } });

for (const entry of CASES) {
  test.describe(entry.title, () => {
    test('the flawed version is reported while hydrating', async ({ page }) => {
      const problems = collectProblems(page);
      await openAndHydrate(page, caseHref(entry.slug, 'problem'));
      expect(hydrationProblems(problems)).not.toEqual([]);
    });

    test('the solution hydrates with an empty console', async ({ page }) => {
      const problems = collectProblems(page);
      await openAndHydrate(page, caseHref(entry.slug, 'solution'));
      expect(problems).toEqual([]);
    });
  });
}

test.describe('what the solutions show after hydrating', () => {
  test('the date has the same text on the server and in the browser', async ({ page, request }) => {
    const html = await (await request.get(caseHref('date-during-render', 'solution'))).text();
    expect(html).toContain(formatTimestamp(LAST_SYNC));
    await openAndHydrate(page, caseHref('date-during-render', 'solution'));
    await expect(page.locator('time')).toHaveText(formatTimestamp(LAST_SYNC));
  });

  test('the label stays connected to its input', async ({ page }) => {
    await openAndHydrate(page, caseHref('random-ids', 'solution'));
    await expect(page.getByLabel('Email')).toBeVisible();
  });

  test('the browser-only button appears right after hydration', async ({ page, request }) => {
    const html = await (await request.get(caseHref('typeof-window-branch', 'solution'))).text();
    expect(html).toContain('Sharing is not available yet.');
    await openAndHydrate(page, caseHref('typeof-window-branch', 'solution'));
    await expect(page.getByRole('button', { name: 'Copy link' })).toBeVisible();
  });

  test('the viewport width is read in the browser, with and without server rendering', async ({ page, request }) => {
    const html = await (await request.get(caseHref('browser-api-during-render', 'solution'))).text();
    expect(html).toContain('Viewport width: <!-- -->unknown');
    expect(html).toContain('Loading the viewport width…');

    await openAndHydrate(page, caseHref('browser-api-during-render', 'solution'));
    await expect(page.getByText('Viewport width: 1024px')).toBeVisible();
    await expect(page.getByText('Viewport width when loaded, without server rendering: 1024px')).toBeVisible();

    await page.setViewportSize({ width: 800, height: 700 });
    await expect(page.getByText('Viewport width: 800px')).toBeVisible();
  });
});
