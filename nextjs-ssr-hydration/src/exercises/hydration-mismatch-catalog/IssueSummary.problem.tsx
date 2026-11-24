/** A Server Component: invalid nesting breaks hydration whatever kind of component renders it. */
export function IssueSummary() {
  return (
    // BUG: a <div> inside a <p> is invalid HTML. The browser's parser closes the <p> before the <div>,
    // so the DOM it builds is not the tree React rendered, and the hydration fails.
    <p>
      Open issues this week:
      <div className="card">12 to do, 5 in progress</div>
    </p>
  );
}
