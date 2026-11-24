import { createContext, memo, use, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { Badge } from '../../lib/Comparison';
import { useRenderCount } from '../../lib/useRenderCount';
import { INITIAL_USER, type User } from './session';

interface UserContextValue {
  user: User;
  setUser: Dispatch<SetStateAction<User>>;
}

const UserContext = createContext<UserContextValue | null>(null);

function useUserContext(): UserContextValue {
  const value = use(UserContext);
  if (!value) throw new Error('useUserContext must be used inside <UserProvider>');
  return value;
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState(INITIAL_USER);
  // BUG: a new object on every render of the provider. React compares the context value with
  // `Object.is`, so every consumer renders again, even the ones that only use `setUser`.
  return <UserContext value={{ user, setUser }}>{children}</UserContext>;
}

function UserName() {
  const { user } = useUserContext();
  const renders = useRenderCount('Flawed user name');
  return (
    <p>
      Signed in as <strong>{user.name}</strong> <Badge label="renders" ref={renders} />
    </p>
  );
}

/** Only changes the user; it never shows it. */
function RenameForm() {
  const { setUser } = useUserContext();
  const [draft, setDraft] = useState('');
  const renders = useRenderCount('Flawed rename form');
  return (
    <form
      className="controls"
      onSubmit={(e) => {
        e.preventDefault();
        setUser((user) => ({ ...user, name: draft.trim() || user.name }));
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

/** Memoized so that only the context, not the parent, can make the consumers render. */
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
