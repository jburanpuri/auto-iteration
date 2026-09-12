import { readFile } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// A fixed, task-scoped snapshot supplied by the trusted host; callers cannot select a file or tenant.
const snapshot = JSON.parse(await readFile(process.argv[2], 'utf8'));
const server = new McpServer({ name: 'auto-iteration-observability', version: '0.1.0' });
server.registerTool('query_product_logs', {
  description: 'Read recent Demo CRM browser error/timing logs and the complaint signal for this task. Logs are client-reported evidence, not proof of root cause. Empty results mean no evidence was captured.',
  inputSchema: { event: z.enum(['all', 'export_failed', 'export_succeeded', 'search_completed']).default('all') },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}, async ({ event }) => ({ content: [{ type: 'text', text: JSON.stringify({
  signal: snapshot.signal, logs: snapshot.logs.filter(log => event === 'all' || log.event === event),
}) }] }));
await server.connect(new StdioServerTransport());
