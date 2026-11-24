import { expect, test, type Page } from '@playwright/test';
import { LOCAL_SERVICES } from '../../lib/local-services';

const PROVIDER_LOGIN = new RegExp(`^${LOCAL_SERVICES.issuer}/authorize`);

/** The mock provider's form accepts any username; docker-compose.yml gives `ada` and `grace` their groups. */
async function signInAtProvider(page: Page, username: string) {
  await expect(page).toHaveURL(PROVIDER_LOGIN);
  await page.getByPlaceholder('Enter any user/subject').fill(username);
  await page.getByRole('button', { name: 'Sign-in' }).click();
}

test.describe('solution: server-side code flow, httpOnly session and server-side role checks', () => {
  test('an anonymous visitor of /admin is sent to log in, and the admin API answers 401', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(PROVIDER_LOGIN);
    expect((await page.request.get('/api/admin/report')).status()).toBe(401);
  });

  test('ada, in the admins group, logs in and lands back on /admin', async ({ page }) => {
    await page.goto('/admin');
    await signInAtProvider(page, 'ada');
    await expect(page).toHaveURL('/admin');
    await expect(page.getByRole('heading', { name: 'Admin · access review' })).toBeVisible();
    expect((await page.request.get('/api/admin/report')).status()).toBe(200);
  });

  test('grace, only in the readers group, gets 403 on /admin when typing the URL, and on the API', async ({ page }) => {
    await page.goto('/oidc-nextjs');
    await page.getByRole('link', { name: 'Log in' }).click();
    await signInAtProvider(page, 'grace');
    await expect(page.getByText('Signed in as Grace Hopper · roles: reader')).toBeVisible();

    const response = await page.goto('/admin');
    expect(response?.status()).toBe(403);
    await expect(page.getByRole('heading', { name: '403 · Forbidden' })).toBeVisible();
    expect((await page.request.get('/api/admin/report')).status()).toBe(403);
  });

  test('the session cookie is httpOnly, Secure and SameSite=Lax, and the browser holds no token', async ({
    page,
    context,
  }) => {
    await page.goto('/api/auth/login?returnTo=%2Foidc-nextjs');
    await signInAtProvider(page, 'ada');
    await expect(page.getByText('Signed in as Ada Lovelace')).toBeVisible();

    const session = (await context.cookies()).find((cookie) => cookie.name === 'session');
    expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
    expect(await page.evaluate(() => document.cookie)).not.toContain('session=');
    expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  });

  test('logout clears the session and ends the provider session too', async ({ page, context }) => {
    await page.goto('/api/auth/login?returnTo=%2Foidc-nextjs');
    await signInAtProvider(page, 'ada');
    await page.getByRole('button', { name: 'Log out' }).click();

    await expect(page).toHaveURL('/oidc-nextjs');
    await expect(page.getByText('Not signed in.')).toBeVisible();
    expect((await context.cookies()).map((cookie) => cookie.name)).not.toContain('session');
    await page.goto('/admin');
    await expect(page).toHaveURL(PROVIDER_LOGIN);
  });
});

test.describe('problem: tokens in localStorage and the role checked only in the UI', () => {
  test('grace sees no admin button, yet any script reads her token and the admin data is served', async ({ page }) => {
    await page.goto('/oidc-nextjs/problem');
    await page.getByRole('button', { name: 'Log in (tokens kept in localStorage)' }).click();
    await signInAtProvider(page, 'grace');
    await expect(page.getByText('Signed in as Grace Hopper')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Admin report' })).toHaveCount(0);

    // What an injected script would do: read the bearer token and send it anywhere.
    const token = await page.evaluate(() => localStorage.getItem('access_token'));
    expect(token?.split('.')).toHaveLength(3);

    const response = await page.request.get('/api/problem/admin-report');
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ entries: expect.any(Array) });
  });
});
