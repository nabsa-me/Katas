export interface User {
  name: string;
  team: string;
}

export type SessionAction = { type: 'rename'; name: string };

export const INITIAL_USER: User = { name: 'Marta Vidal', team: 'Platform' };

/**
 * Pure state transitions for the session. Returning the same object when nothing changes matters:
 * React compares the new state with `Object.is` and skips the render (and the context update) if equal.
 */
export function sessionReducer(state: User, action: SessionAction): User {
  switch (action.type) {
    case 'rename': {
      const name = action.name.trim();
      return name === '' || name === state.name ? state : { ...state, name };
    }
  }
}
