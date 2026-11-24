import { InitiativeFilter } from '../../../exercises/server-vs-client-components/InitiativeFilter';
import { getInitiatives } from '../../../exercises/server-vs-client-components/initiatives';

/**
 * A Server Component: it fetches during the server render, so the HTML already contains the data, and
 * its code never reaches the browser. Only the interactive island is a Client Component.
 */
export default async function InitiativesPage() {
  const initiatives = await getInitiatives();
  return (
    <>
      <p className="tag solution">solution</p>
      <h1>Initiatives</h1>
      <p className="muted">Fetched on the server; only the filter is a Client Component.</p>
      <InitiativeFilter initiatives={initiatives} />
    </>
  );
}
