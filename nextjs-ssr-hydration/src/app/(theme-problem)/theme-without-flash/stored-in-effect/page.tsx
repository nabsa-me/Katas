import { StoredThemeInEffect } from '../../../../exercises/theme-without-flash/StoredThemeInEffect.problem';
import { ThemeDemoContent } from '../../../../exercises/theme-without-flash/ThemeDemoContent';

export default function StoredInEffectPage() {
  return (
    <main className="page">
      <StoredThemeInEffect />
      <ThemeDemoContent
        kind="problem"
        title="Theme read from localStorage in an effect"
        description="No hydration warning, but the effect only runs after the light page has been painted."
      />
    </main>
  );
}
