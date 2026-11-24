import { expect, test } from '@playwright/test';
import { collectProblems, hydrationProblems, openAndHydrate } from './console';
import { allRoutes } from './exercises';

test('the home page hydrates cleanly and links every exercise route', async ({ page }) => {
  const problems = collectProblems(page);
  await openAndHydrate(page, '/');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Next.js SSR and hydration katas');
  for (const route of allRoutes()) {
    await expect(page.getByRole('link', { name: route.label })).toHaveAttribute('href', route.href);
  }
  expect(hydrationProblems(problems)).toEqual([]);
});
