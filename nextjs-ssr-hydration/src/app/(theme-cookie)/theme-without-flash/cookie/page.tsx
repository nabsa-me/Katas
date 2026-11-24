import { cookies } from 'next/headers';
import { CookieThemeForm } from '../../../../exercises/theme-without-flash/CookieThemeForm';
import { parseTheme, THEME_COOKIE } from '../../../../exercises/theme-without-flash/theme';
import { ThemeDemoContent } from '../../../../exercises/theme-without-flash/ThemeDemoContent';

export default async function CookieThemePage() {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value) ?? 'light';
  return (
    <main className="page">
      <CookieThemeForm current={theme} />
      <ThemeDemoContent
        kind="solution"
        title="Theme from a cookie, rendered on the server"
        description="The server reads the cookie and renders <html> with the theme class. Switching posts a Server Action that sets the cookie."
      />
    </main>
  );
}
