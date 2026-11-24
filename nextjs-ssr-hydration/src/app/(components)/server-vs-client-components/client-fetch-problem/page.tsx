import { InitiativesPage } from '../../../../exercises/server-vs-client-components/InitiativesPage.problem';

export default function ClientFetchProblemPage() {
  return (
    <>
      <p className="tag problem">problem</p>
      <h1>Initiatives</h1>
      <p className="muted">The whole page is a Client Component that fetches in an effect.</p>
      <InitiativesPage />
    </>
  );
}
