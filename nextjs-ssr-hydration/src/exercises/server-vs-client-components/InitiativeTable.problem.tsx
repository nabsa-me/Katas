'use client';

import type { Initiative } from './initiative';

interface InitiativeTableProps {
  initiatives: Initiative[];
  /** BUG: a function prop. A Server Component cannot send a function to the browser. */
  formatDate: (iso: string) => string;
}

export function InitiativeTable({ initiatives, formatDate }: InitiativeTableProps) {
  return (
    <ul>
      {initiatives.map((item) => (
        <li key={item.id}>
          {item.name}: {formatDate(item.targetDate)}
        </li>
      ))}
    </ul>
  );
}
