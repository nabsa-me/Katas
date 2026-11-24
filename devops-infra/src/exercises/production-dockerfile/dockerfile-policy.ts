export interface Instruction {
  /** Upper-cased keyword: `FROM`, `RUN`, `COPY`… */
  keyword: string;
  args: string;
}

export interface Stage {
  /** The image (or earlier stage) this stage starts from. */
  base: string;
  name?: string;
  instructions: Instruction[];
}

/**
 * Splits a Dockerfile into stages of instructions. Continuation lines (`\` at the end) are joined
 * and comments dropped. It is a reading aid for the policy below, not a full Dockerfile parser:
 * heredocs and escape directives are out of scope.
 */
export function parseDockerfile(text: string): Stage[] {
  const logicalLines = text
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
    .replace(/\\\n/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

  const stages: Stage[] = [];
  for (const line of logicalLines) {
    const [keyword = '', ...rest] = line.split(/\s+/);
    const instruction = { keyword: keyword.toUpperCase(), args: rest.join(' ') };
    if (instruction.keyword === 'FROM') {
      const [base = '', as, name] = rest.filter((word) => !word.startsWith('--platform='));
      stages.push({ base, name: as?.toUpperCase() === 'AS' ? name : undefined, instructions: [] });
    } else {
      stages.at(-1)?.instructions.push(instruction);
    }
  }
  return stages;
}

const ROOT_USERS = new Set(['root', '0']);

/**
 * Production rules that hadolint does not cover, checked on the Dockerfile text. Each finding says what
 * is wrong and what it costs. An empty list means the Dockerfile follows every rule.
 */
export function dockerfileFindings(text: string): string[] {
  const stages = parseDockerfile(text);
  const runtime = stages.at(-1);
  if (!runtime) return ['no FROM instruction'];

  const stageNames = new Set(stages.map((stage) => stage.name));
  const findings = stages
    .filter((stage) => !stageNames.has(stage.base) && !/@sha256:[0-9a-f]{64}$/.test(stage.base))
    .map((stage) => `base image not pinned by digest: ${stage.base} can change under the same tag`);

  if (stages.length < 2) {
    findings.push('single stage: compilers, dev dependencies and sources ship in the runtime image');
  }
  const runtimeOf = (keyword: string) => runtime.instructions.filter((i) => i.keyword === keyword);
  const user = runtimeOf('USER').at(-1)?.args.split(':')[0];
  if (user === undefined || ROOT_USERS.has(user)) {
    findings.push('runs as root: a compromised process owns the whole container filesystem');
  }
  if (runtimeOf('HEALTHCHECK').length === 0) {
    findings.push('no HEALTHCHECK: Docker cannot tell a hung server from a healthy one');
  }
  if (runtimeOf('RUN').some((i) => /\bnpm (install|i|ci)\b/.test(i.args) && !i.args.includes('--omit=dev'))) {
    findings.push('installs dev dependencies in the runtime image');
  }
  if (runtimeOf('COPY').some((i) => !i.args.includes('--from=') && /(^|\s)\.\s+\.?\/?$/.test(i.args))) {
    findings.push('copies the whole build context into the runtime image');
  }
  if (runtimeOf('CMD').some((i) => /^\[?\s*"?npm\b/.test(i.args))) {
    findings.push('npm is the main process: extra processes in front of the server, and a stop exits with code 1');
  }
  return findings;
}
