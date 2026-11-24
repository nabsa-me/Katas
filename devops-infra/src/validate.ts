import { validators } from './exercises';
import { dockerRunArgs, isDockerRunning, runDocker } from './lib/run-in-docker';
import { evaluate } from './lib/validator';

/**
 * Runs the exercises' validators in pinned Docker images, so nothing but Docker needs installing.
 * Usage: `tsx src/validate.ts [name…]` (all of them without names). Exit code 1 if any check fails.
 */
const requested = process.argv.slice(2);
const known = validators.map((validator) => validator.name);
const unknown = requested.filter((name) => !known.includes(name));
if (unknown.length > 0) {
  console.error(`Unknown validator: ${unknown.join(', ')}. Known: ${known.join(', ') || 'none'}.`);
  process.exit(2);
}
if (!isDockerRunning()) {
  console.error('Docker is not running. Start Docker Desktop (or the Docker daemon) and try again.');
  process.exit(1);
}

const selected = requested.length > 0 ? validators.filter((v) => requested.includes(v.name)) : validators;
let failures = 0;
for (const validator of selected) {
  for (const check of validator.checks) {
    console.log(`\n> ${validator.name}: ${check.title}`);
    const result = await runDocker(dockerRunArgs({ ...check.run, hostDir: process.cwd() }));
    const outcome = evaluate(check, result);
    console.log(`${outcome.passed ? 'PASS' : 'FAIL'} ${validator.name}: ${check.title} (${outcome.reason})`);
    if (!outcome.passed) failures++;
  }
}
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exitCode = failures === 0 ? 0 : 1;
