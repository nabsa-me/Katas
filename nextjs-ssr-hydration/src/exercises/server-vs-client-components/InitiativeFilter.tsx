'use client';

import { useState } from 'react';
import { filterByStatus, STATUS_LABELS, type Initiative, type InitiativeStatus } from './initiative';

const FILTERS: (InitiativeStatus | 'all')[] = ['all', 'planned', 'in_progress', 'done'];

/**
 * The only interactive part of the page, so the only Client Component. It receives plain data that
 * the server already fetched: strings in plain objects, which serialize without surprises.
 */
export function InitiativeFilter({ initiatives }: { initiatives: Initiative[] }) {
  const [status, setStatus] = useState<InitiativeStatus | 'all'>('all');
  const visible = filterByStatus(initiatives, status);

  return (
    <>
      <div className="controls" role="group" aria-label="Status">
        {FILTERS.map((value) => (
          <button key={value} type="button" aria-pressed={status === value} onClick={() => setStatus(value)}>
            {value === 'all' ? 'All' : STATUS_LABELS[value]}
          </button>
        ))}
      </div>
      <ul aria-label="Initiatives">
        {visible.map((item) => (
          <li key={item.id}>
            <strong>{item.name}</strong>{' '}
            <span className="muted">
              {item.team} · {STATUS_LABELS[item.status]} · {item.targetDate}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
