import { describe, expect, it } from 'vitest';
import { readText } from '../../lib/documents';
import { dockerfileFindings, parseDockerfile } from './dockerfile-policy';

const solution = readText(new URL('./Dockerfile', import.meta.url));
const problem = readText(new URL('./Dockerfile.problem', import.meta.url));
const ignoreFile = readText(new URL('./Dockerfile.dockerignore', import.meta.url));

describe('parseDockerfile', () => {
  it('splits stages, joins continuation lines and drops comments', () => {
    const stages = parseDockerfile(
      '# comment\nFROM node:22 AS build\nRUN npm ci \\\n  --no-audit\nFROM build\nCMD ["node", "server.js"]\n',
    );
    expect(stages).toEqual([
      { base: 'node:22', name: 'build', instructions: [{ keyword: 'RUN', args: 'npm ci --no-audit' }] },
      { base: 'build', name: undefined, instructions: [{ keyword: 'CMD', args: '["node", "server.js"]' }] },
    ]);
  });

  it('reads the production Dockerfile as a base, two build stages and a runtime stage', () => {
    expect(parseDockerfile(solution).map((stage) => stage.name)).toEqual(['base', 'deps', 'build', 'runtime']);
  });
});

describe('Dockerfile.problem', () => {
  it('breaks every production rule', () => {
    expect(dockerfileFindings(problem)).toEqual([
      'base image not pinned by digest: node:latest can change under the same tag',
      'single stage: compilers, dev dependencies and sources ship in the runtime image',
      'runs as root: a compromised process owns the whole container filesystem',
      'no HEALTHCHECK: Docker cannot tell a hung server from a healthy one',
      'installs dev dependencies in the runtime image',
      'copies the whole build context into the runtime image',
      'npm is the main process: extra processes in front of the server, and a stop exits with code 1',
    ]);
  });
});

describe('production Dockerfile', () => {
  it('follows every rule', () => {
    expect(dockerfileFindings(solution)).toEqual([]);
  });

  it('runs the standalone server with Node as the main process, as the numeric node user', () => {
    const runtime = parseDockerfile(solution).at(-1)?.instructions ?? [];
    expect(runtime.filter((i) => i.keyword === 'USER').map((i) => i.args)).toEqual(['1000:1000']);
    expect(runtime.find((i) => i.keyword === 'CMD')?.args).toBe('["node", "server.js"]');
  });

  it('has an ignore file that keeps dependencies, build output and local secrets out of the context', () => {
    const rules = ignoreFile.split(/\r?\n/).filter((line) => line !== '' && !line.startsWith('#'));
    expect(rules).toEqual(expect.arrayContaining(['node_modules', '.next', '.env', '.env.*', '.git']));
  });
});

describe('dockerfileFindings', () => {
  it('treats user 0 as root', () => {
    expect(dockerfileFindings('FROM a AS b\nFROM b\nUSER 0:0\n')).toContain(
      'runs as root: a compromised process owns the whole container filesystem',
    );
  });

  it('accepts a runtime install that omits dev dependencies', () => {
    const text = 'FROM node@sha256:' + '0'.repeat(64) + ' AS base\nFROM base\nRUN npm ci --omit=dev\n';
    expect(dockerfileFindings(text)).not.toContain('installs dev dependencies in the runtime image');
  });
});
