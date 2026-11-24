import { InitiativeRecord } from '../../../../exercises/server-vs-client-components/initiative-record';
import { getInitiatives } from '../../../../exercises/server-vs-client-components/initiatives';
import { LateInitiatives } from '../../../../exercises/server-vs-client-components/LateInitiatives.problem';

// Rendered per request, so the error appears when the route is opened rather than during `next build`.
export const dynamic = 'force-dynamic';

export default async function ClassInstanceProblemPage() {
  const records = (await getInitiatives()).map((initiative) => new InitiativeRecord(initiative));
  // BUG: class instances are not plain objects; their methods cannot travel to the browser.
  return <LateInitiatives records={records} today="2026-11-24" />;
}
