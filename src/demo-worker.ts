import { prepareProductDemo } from './demo-runtime.js';
await prepareProductDemo();
await import('./worker.js');
