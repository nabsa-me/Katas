import * as Sentry from '@sentry/node';
import { loadConfig } from './config';
import { sentryOptions } from './sentry';

// Loaded with `node --import` before main.ts, so Sentry hooks into `http` and `pg` before the application imports
// them (Sentry 11 dropped `--require`; ES modules can only be instrumented if the hooks are registered first).
// An invalid configuration throws here and stops the process before it listens.
const options = sentryOptions(loadConfig(process.env));
if (options) Sentry.init(options);
