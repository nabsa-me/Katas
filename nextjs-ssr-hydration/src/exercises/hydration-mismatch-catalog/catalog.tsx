import type { ComponentType } from 'react';
import type { Variant } from './cases';
import { EmailField } from './EmailField';
import { EmailField as FlawedEmailField } from './EmailField.problem';
import { IssueSummary } from './IssueSummary';
import { IssueSummary as FlawedIssueSummary } from './IssueSummary.problem';
import { LastSync } from './LastSync';
import { LastSync as FlawedLastSync } from './LastSync.problem';
import { ShareButton } from './ShareButton';
import { ShareButton as FlawedShareButton } from './ShareButton.problem';
import { ViewportWidth } from './ViewportWidth';
import { ViewportWidth as FlawedViewportWidth } from './ViewportWidth.problem';
import { ViewportWidthWithoutSsr } from './ViewportWidthWithoutSsr';

/** Two ways to read a browser value without a mismatch, side by side. */
function BrowserApiAlternatives() {
  return (
    <>
      <ViewportWidth />
      <ViewportWidthWithoutSsr />
    </>
  );
}

/** What each route renders, by case slug and variant. */
export const CASE_COMPONENTS: Record<string, Record<Variant, ComponentType>> = {
  'date-during-render': { problem: FlawedLastSync, solution: LastSync },
  'random-ids': { problem: FlawedEmailField, solution: EmailField },
  'typeof-window-branch': { problem: FlawedShareButton, solution: ShareButton },
  'browser-api-during-render': { problem: FlawedViewportWidth, solution: BrowserApiAlternatives },
  'invalid-html-nesting': { problem: FlawedIssueSummary, solution: IssueSummary },
};
