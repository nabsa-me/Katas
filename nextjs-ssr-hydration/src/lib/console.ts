import type { Page } from '@playwright/test';

/**
 * Collects what the page reports while it loads: console errors and warnings, and uncaught errors.
 * React reports hydration problems through `console.error` (development) or `reportError` (recoverable
 * errors), so both channels are captured.
 */
export function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  return problems;
}

/** Opens a route and waits until React has hydrated it (see `HydrationMarker`). */
export async function openAndHydrate(page: Page, href: string): Promise<void> {
  await page.goto(href);
  await page.waitForFunction(() => document.body.dataset.hydrated === 'true');
}

/** Only the messages about hydration, ignoring unrelated noise such as development tooling logs. */
export function hydrationProblems(problems: readonly string[]): string[] {
  return problems.filter((text) => /hydrat|did(n't| not) match|cannot be a descendant/i.test(text));
}
