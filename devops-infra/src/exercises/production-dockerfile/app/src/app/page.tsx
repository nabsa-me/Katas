/** Prerendered at build time: the image serves it from .next/standalone without running React per request. */
export default function HomePage() {
  return (
    <main>
      <h1>Katas sample app</h1>
      <p>A minimal Next.js app running from the standalone output, as a non-root user, in a pinned base image.</p>
      <p>
        Health check: <a href="/api/health">/api/health</a>
      </p>
    </main>
  );
}
