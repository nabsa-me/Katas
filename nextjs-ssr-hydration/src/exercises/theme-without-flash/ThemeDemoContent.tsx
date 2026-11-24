interface ThemeDemoContentProps {
  kind: 'problem' | 'solution';
  title: string;
  description: string;
}

/** The same content on every variant, so only the theme handling differs. */
export function ThemeDemoContent({ kind, title, description }: ThemeDemoContentProps) {
  return (
    <>
      <p className={`tag ${kind}`}>{kind}</p>
      <h1>{title}</h1>
      <p className="muted">{description}</p>
      <div className="card">
        <p>
          Reload the page with a dark preference stored, and watch the first frame. Open the console to see what React
          reports while hydrating.
        </p>
        <p>
          <a href="/">All exercises</a>
        </p>
      </div>
    </>
  );
}
