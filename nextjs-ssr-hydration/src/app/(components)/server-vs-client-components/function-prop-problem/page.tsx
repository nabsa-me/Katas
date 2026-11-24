import { getInitiatives } from '../../../../exercises/server-vs-client-components/initiatives';
import { InitiativeTable } from '../../../../exercises/server-vs-client-components/InitiativeTable.problem';

// Rendered per request, so the error appears when the route is opened rather than during `next build`.
export const dynamic = 'force-dynamic';

export default async function FunctionPropProblemPage() {
  const initiatives = await getInitiatives();
  // BUG: a function cannot be serialized into the payload sent to the browser.
  return <InitiativeTable initiatives={initiatives} formatDate={(iso) => new Date(iso).toDateString()} />;
}
