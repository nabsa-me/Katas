import { expect, test } from '@playwright/test';
import data from '../../data/initiatives.json' with { type: 'json' };
import { collectProblems, openAndHydrate } from '../../lib/console';

const names = data.map((row) => row.name);

test.describe('data fetched in a client effect', () => {
  test('the server HTML only has the loading state', async ({ request }) => {
    const html = await (await request.get('/server-vs-client-components/client-fetch-problem')).text();
    expect(html).toContain('Loading initiatives…');
    for (const name of names) expect(html).not.toContain(name);
  });

  test('the browser asks for the data only after hydrating', async ({ page }) => {
    const apiRequest = page.waitForRequest('**/api/initiatives');
    await openAndHydrate(page, '/server-vs-client-components/client-fetch-problem');
    await apiRequest;
    await expect(page.getByText(names[0]!)).toBeVisible();
  });
});

test.describe('data fetched in a Server Component', () => {
  test('the server HTML already contains every initiative', async ({ request }) => {
    const html = await (await request.get('/server-vs-client-components')).text();
    for (const name of names) expect(html).toContain(name);
  });

  test('no request for data after loading, and the client island is interactive', async ({ page }) => {
    const apiCalls: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/initiatives')) apiCalls.push(request.url());
    });
    const problems = collectProblems(page);
    await openAndHydrate(page, '/server-vs-client-components');

    await page.getByRole('button', { name: 'Done' }).click();
    const done = data.filter((row) => row.status === 'done');
    await expect(page.getByRole('list', { name: 'Initiatives' }).getByRole('listitem')).toHaveCount(done.length);
    expect(apiCalls).toEqual([]);
    expect(problems).toEqual([]);
  });
});

test.describe('props that cannot cross the server/client boundary', () => {
  test('a function prop fails the server render', async ({ request }) => {
    const response = await request.get('/server-vs-client-components/function-prop-problem');
    expect(response.status()).toBe(500);
    expect(await response.text()).toContain('Functions cannot be passed directly to Client Components');
  });

  test('a class instance prop fails the server render', async ({ request }) => {
    const response = await request.get('/server-vs-client-components/class-instance-problem');
    expect(response.status()).toBe(500);
    expect(await response.text()).toContain('Only plain objects');
  });
});
