'use client';

import type { InitiativeRecord } from './initiative-record';

/** BUG: expects class instances, with methods, from a Server Component. */
export function LateInitiatives({ records, today }: { records: InitiativeRecord[]; today: string }) {
  return (
    <ul>
      {records
        .filter((record) => record.isLate(today))
        .map((record) => (
          <li key={record.name}>{record.name}</li>
        ))}
    </ul>
  );
}
