import { describe, expect, it } from 'vitest';
import { dockerRunArgs } from './run-in-docker';

const base = {
  image: 'hadolint/hadolint:v2.15.1',
  hostDir: 'C:\\Projects\\My Katas\\devops-infra',
  workdir: 'src/exercises/production-dockerfile',
  args: ['hadolint', 'Dockerfile'],
};

describe('dockerRunArgs', () => {
  it('mounts the kata read-only at /work and runs the tool in the exercise folder', () => {
    expect(dockerRunArgs(base)).toEqual([
      'run',
      '--rm',
      '--mount',
      'type=bind,source=C:\\Projects\\My Katas\\devops-infra,target=/work,readonly',
      '--workdir',
      '/work/src/exercises/production-dockerfile',
      'hadolint/hadolint:v2.15.1',
      'hadolint',
      'Dockerfile',
    ]);
  });

  it('keeps a host path with spaces as a single argument', () => {
    const args = dockerRunArgs(base);
    expect(args.filter((arg) => arg.includes('My Katas'))).toHaveLength(1);
  });

  it('puts the environment and the entrypoint before the image, and the tool arguments after it', () => {
    const args = dockerRunArgs({
      ...base,
      image: 'hashicorp/terraform:1.17.2',
      entrypoint: '/bin/sh',
      env: { TF_DATA_DIR: '/tmp/terraform' },
      args: ['-c', 'terraform validate'],
    });
    const imageAt = args.indexOf('hashicorp/terraform:1.17.2');
    expect(args.indexOf('--env')).toBeLessThan(imageAt);
    expect(args[args.indexOf('--env') + 1]).toBe('TF_DATA_DIR=/tmp/terraform');
    expect(args.indexOf('--entrypoint')).toBeLessThan(imageAt);
    expect(args.slice(imageAt + 1)).toEqual(['-c', 'terraform validate']);
  });

  it('uses the kata root when the workdir is empty', () => {
    expect(dockerRunArgs({ ...base, workdir: '' })).toContain('/work');
  });

  it('rejects a workdir outside the kata', () => {
    expect(() => dockerRunArgs({ ...base, workdir: '../other-kata' })).toThrow(/relative path inside the kata/);
    expect(() => dockerRunArgs({ ...base, workdir: '/etc' })).toThrow(/relative path inside the kata/);
  });

  it('rejects a host path that would break the --mount option list', () => {
    expect(() => dockerRunArgs({ ...base, hostDir: '/home/a,b/devops-infra' })).toThrow(/comma/);
  });
});
