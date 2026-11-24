import { StoredThemeInRender } from '../../../../exercises/theme-without-flash/StoredThemeInRender.problem';
import { ThemeDemoContent } from '../../../../exercises/theme-without-flash/ThemeDemoContent';

export default function StoredInRenderPage() {
  return (
    <StoredThemeInRender>
      <ThemeDemoContent
        kind="problem"
        title="Theme read from localStorage during render"
        description="The first client render reads localStorage; the server could not. Hydration finds a different class."
      />
    </StoredThemeInRender>
  );
}
