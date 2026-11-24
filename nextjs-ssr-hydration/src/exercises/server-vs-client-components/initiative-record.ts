import type { Initiative } from './initiative';

/**
 * A class with behaviour, convenient on the server. Its instances cannot be props of a Client
 * Component: serialization keeps plain data only, and the prototype (the methods) would be lost.
 */
export class InitiativeRecord {
  readonly name: string;
  readonly targetDate: string;

  constructor(initiative: Initiative) {
    this.name = initiative.name;
    this.targetDate = initiative.targetDate;
  }

  isLate(today: string): boolean {
    return this.targetDate < today;
  }
}
