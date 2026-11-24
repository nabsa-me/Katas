/** A Server Component with valid nesting: a block element wraps the paragraph and the card. */
export function IssueSummary() {
  return (
    <div>
      <p>Open issues this week:</p>
      <div className="card">12 to do, 5 in progress</div>
    </div>
  );
}
