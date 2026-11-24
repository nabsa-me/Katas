import { SystemThemeSwitcher } from '../../../../exercises/theme-without-flash/SystemThemeSwitcher';
import { ThemeDemoContent } from '../../../../exercises/theme-without-flash/ThemeDemoContent';

export default function SystemThemePage() {
  return (
    <main className="page">
      <SystemThemeSwitcher />
      <ThemeDemoContent
        kind="solution"
        title="Theme from an inline script, with the system preference"
        description="A blocking script in <head> reads the cookie, or the system preference when there is none, before the first paint."
      />
    </main>
  );
}
