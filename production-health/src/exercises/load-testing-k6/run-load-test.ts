import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkServiceReady, k6DockerArgs } from './k6-docker';

// `npm run load-test [-- <k6 run options>]`: checks the service, then runs load-test.js with k6 in Docker.
// The exit code is k6's: 0 when every threshold passed, 99 when one failed.

const serviceUrl = process.env.SERVICE_URL ?? 'http://127.0.0.1:5808';
const baseUrl = process.env.BASE_URL ?? 'http://host.docker.internal:5808';

const service = await checkServiceReady(serviceUrl);
if (!service.ok) {
  console.error(`The service at ${serviceUrl} is not ready (${service.reason}).`);
  console.error('Start it first: docker compose up -d --wait, then npm start');
  process.exit(1);
}

const script = fileURLToPath(new URL('./load-test.js', import.meta.url));
const k6 = spawn('docker', k6DockerArgs({ baseUrl, k6Args: process.argv.slice(2) }), {
  stdio: ['pipe', 'inherit', 'inherit'],
});
createReadStream(script).pipe(k6.stdin);
k6.on('error', (error) => {
  console.error(`Could not run docker: ${error.message}. Is Docker running?`);
  process.exitCode = 1;
});
k6.on('close', (code) => {
  process.exitCode = code ?? 1;
});
