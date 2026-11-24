import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

/**
 * How the `server-only` guard works. A bundler resolves packages with "export conditions": the Server
 * Component graph uses `react-server`, the Client Component graph does not. The package maps each
 * condition to a different file.
 */
describe('server-only', () => {
  it('resolves to an empty module for Server Components', () => {
    // The package does not export its package.json, so it is read from the resolved folder.
    const folder = dirname(require.resolve('server-only'));
    const pkg = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')) as { exports: unknown };
    expect(pkg.exports).toEqual({ '.': { 'react-server': './empty.js', default: './index.js' } });
  });

  it('throws when resolved without the react-server condition, as in a client bundle', async () => {
    await expect(import('server-only')).rejects.toThrow(
      'This module cannot be imported from a Client Component module',
    );
  });

  it('protects the data module the same way', async () => {
    await expect(import('./initiatives')).rejects.toThrow('cannot be imported from a Client Component');
  });
});
