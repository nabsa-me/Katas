export type InitiativeStatus = 'planned' | 'in_progress' | 'done';

/** A plain, serializable shape: it can travel from a Server Component to a Client Component as a prop. */
export interface Initiative {
  id: string;
  name: string;
  team: string;
  status: InitiativeStatus;
  /** ISO date (`YYYY-MM-DD`): a string, so it serializes the same everywhere. */
  targetDate: string;
}

export const STATUS_LABELS: Record<InitiativeStatus, string> = {
  planned: 'Planned',
  in_progress: 'In progress',
  done: 'Done',
};

const STATUSES = Object.keys(STATUS_LABELS) as InitiativeStatus[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Data from a store or an API is external: only complete, well-formed rows get through. */
export function parseInitiatives(json: unknown): Initiative[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((row): Initiative[] => {
    if (!isRecord(row)) return [];
    const { id, name, team, status, targetDate } = row;
    const valid =
      typeof id === 'string' &&
      typeof name === 'string' &&
      typeof team === 'string' &&
      STATUSES.includes(status as InitiativeStatus) &&
      typeof targetDate === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(targetDate);
    return valid ? [{ id, name, team, status: status as InitiativeStatus, targetDate }] : [];
  });
}

export function filterByStatus(items: readonly Initiative[], status: InitiativeStatus | 'all'): Initiative[] {
  return status === 'all' ? [...items] : items.filter((item) => item.status === status);
}
