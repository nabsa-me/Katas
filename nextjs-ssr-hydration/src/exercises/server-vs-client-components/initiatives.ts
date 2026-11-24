import 'server-only';
import data from '../../data/initiatives.json';
import { parseInitiatives, type Initiative } from './initiative';

const SIMULATED_LATENCY_MS = 300;

/**
 * Data access that must never reach the browser: in a real app this module holds the database client,
 * its connection string and its credentials. `import 'server-only'` turns an accidental import from a
 * Client Component into a build error instead of a secret shipped in a bundle.
 */
export async function getInitiatives(): Promise<Initiative[]> {
  await new Promise((resolve) => setTimeout(resolve, SIMULATED_LATENCY_MS));
  return parseInitiatives(data);
}
