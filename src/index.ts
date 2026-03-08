import { error } from './log';
import { startNode } from './Node';

process.on('unhandledRejection', (err) => error('ERROR:', '[MAIN] Unhandled rejection', {err}))
process.on('uncaughtException', (err) => error('ERROR:', '[MAIN] Uncaught exception', {err}))

await startNode()
// TODO: Merge duplicate artists from diff plugins
