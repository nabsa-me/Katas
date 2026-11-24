import { createContext, memo, use, useMemo, useReducer, useState, type ReactNode } from 'react';
import { Badge } from '../../lib/Comparison';
import { useRenderCount } from '../../lib/useRenderCount';
import { INITIAL_USER, sessionReducer, type User } from './session';

interface UserActions {
  rename(name: string): void;
}

// Two contexts: what changes often (the user) and what never changes (the actions).
const UserStateContext = createContext<User | null>(null);
const UserActionsContext = createContext<UserActions | null>(null);

export function useUser(): User {
  const user = use(UserStateContext);
  if (!user) throw new Error('useUser must be used inside <UserProvider>');
  return user;
}

export function useUserActions(): UserActions {
  const actions = use(UserActionsContext);
  if (!actions) throw new Error('useUserActions must be used inside <UserProvider>');
  return actions;
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, dispatch] = useReducer(sessionReducer, INITIAL_USER);
  // `dispatch` is stable, so this object is created once and the actions context never changes.
  const actions = useMemo<UserActions>(() => ({ rename: (name) => dispatch({ type: 'rename', name }) }), []);

  // `user` is state: its reference only changes when the reducer returns a new object.
  return (
    <UserActionsContext value={actions}>
      <UserStateContext value={user}>{children}</UserStateContext>
    </UserActionsContext>
  );
}

function UserName() {
  const user = useUser();
  const renders = useRenderCount('Fixed user name');
  return (
    <p>
      Signed in as <strong>{user.name}</strong> <Badge label="renders" ref={renders} />
    </p>
  );
}

/** Subscribes to the actions only, so a new user does not render it. */
function RenameForm() {
  const { rename } = useUserActions();
  const [draft, setDraft] = useState('');
  const renders = useRenderCount('Fixed rename form');
  return (
    <form
      className="controls"
      onSubmit={(e) => {
        e.preventDefault();
        rename(draft);
      }}
    >
      <label>
        New name
        <input value={draft} onChange={(e) => setDraft(e.target.value)} />
      </label>
      <button type="submit">Rename</button>
      <Badge label="renders" ref={renders} />
    </form>
  );
}

const Toolbar = memo(function Toolbar() {
  return (
    <>
      <UserName />
      <RenameForm />
    </>
  );
});

export function SessionPanel() {
  const [unrelated, setUnrelated] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setUnrelated((n) => n + 1)}>
        Unrelated update ({unrelated})
      </button>
      <UserProvider>
        <Toolbar />
      </UserProvider>
    </>
  );
}
