import { getInitiatives } from '../../../../exercises/server-vs-client-components/initiatives';

/** The endpoint the flawed client page has to call after hydrating. */
export async function GET() {
  return Response.json(await getInitiatives());
}
