import { Comparison } from '../../lib/Comparison';
import { SessionPanel as FlawedPanel } from './UserSession.problem';
import { SessionPanel as FixedPanel } from './UserSession';

export function ContextProviderValue() {
  return (
    <Comparison
      title="Inline value in a Context Provider"
      instructions={
        <>
          Press <strong>Unrelated update</strong>: in the problem both consumers render again, in the solution neither
          does. Then rename the user: in the solution only the name renders; the form, which only uses the actions,
          stays still.
        </>
      }
      problem={<FlawedPanel />}
      solution={<FixedPanel />}
    />
  );
}
