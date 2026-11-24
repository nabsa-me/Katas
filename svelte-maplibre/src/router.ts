/**
 * Minimal router based on the URL hash: `#/clustering` or `#/integrated-viewer?z=9&lat=41.6`.
 * The hash is used so it works without any server configuration.
 */
export interface Route {
  id: string | null;
  query: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const clean = hash.replace(/^#\/?/, '');
  const [path = '', query = ''] = clean.split('?');
  return { id: path || null, query: new URLSearchParams(query) };
}

export function buildHash(id: string, query?: URLSearchParams): string {
  const qs = query?.toString();
  return qs ? `#/${id}?${qs}` : `#/${id}`;
}

/** Turns a title into a URL-safe route id: `ICGC WMS layer` → `icgc-wms-layer`. */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
