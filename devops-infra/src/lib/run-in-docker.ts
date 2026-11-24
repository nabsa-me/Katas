import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

/** Where the kata folder is mounted inside every validator container. */
export const CONTAINER_ROOT = '/work';

export interface DockerRun {
  /** Pinned image: a validator that changes version under you proves nothing. */
  image: string;
  /** Host folder mounted read-only at `/work`: the kata folder (`process.cwd()` when run through npm). */
  hostDir: string;
  /** Folder inside the kata where the command runs, relative and with forward slashes. */
  workdir: string;
  args: readonly string[];
  /** Overrides the image's entrypoint, for images whose entrypoint is the tool itself. */
  entrypoint?: string;
  env?: Readonly<Record<string, string>>;
}

export interface DockerResult {
  exitCode: number;
  /** Standard output and error together, as the tool printed them. */
  output: string;
}

/**
 * Builds the `docker run` arguments as an array, never as a shell string: a path with spaces stays one
 * argument and nothing depends on the shell (npm runs scripts in `cmd.exe` on Windows, where `$PWD` does
 * not exist). The mount is read-only, so a validator can never change the files it checks.
 */
export function dockerRunArgs({ image, hostDir, workdir, args, entrypoint, env = {} }: DockerRun): string[] {
  if (hostDir.includes(',')) {
    throw new Error(`The kata path cannot contain a comma (it separates --mount options): ${hostDir}`);
  }
  if (path.posix.isAbsolute(workdir) || workdir.split('/').includes('..')) {
    throw new Error(`workdir must be a relative path inside the kata: ${workdir}`);
  }
  return [
    'run',
    '--rm',
    '--mount',
    `type=bind,source=${hostDir},target=${CONTAINER_ROOT},readonly`,
    '--workdir',
    path.posix.join(CONTAINER_ROOT, workdir),
    ...Object.entries(env).flatMap(([name, value]) => ['--env', `${name}=${value}`]),
    ...(entrypoint ? ['--entrypoint', entrypoint] : []),
    image,
    ...args,
  ];
}

/** Runs `docker` with the given arguments, echoing its output while capturing it. */
export function runDocker(args: readonly string[]): Promise<DockerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on('error', (error) => reject(new Error('Docker is required to run the validators.', { cause: error })));
    child.on('close', (code) => resolve({ exitCode: code ?? 1, output }));
  });
}

/**
 * The Docker CLI exits with 1 when the daemon is down, the same code a linter uses for findings.
 * Checking first keeps a stopped Docker from passing as "the flawed file has findings".
 */
export function isDockerRunning(): boolean {
  const result = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8' });
  return result.status === 0 && result.stdout.trim() !== '';
}
