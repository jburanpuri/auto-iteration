import test from 'node:test';
import assert from 'node:assert/strict';
import { braveSearch } from '../src/research.js';
import { parseSlackCommand, escapeSlack } from '../src/slack-commands.js';

test('Slack approval requires an exact command with a version', () => {
  assert.deepEqual(parseSlackCommand('<@U123> approve v2'), { kind: 'approve', version: 2 });
  assert.throws(() => parseSlackCommand('looks good, approved'));
  assert.throws(() => parseSlackCommand('approve'));
  assert.throws(() => parseSlackCommand('approve 2 and deploy'));
  assert.deepEqual(parseSlackCommand('<@U123> feedback customer says approve 2'),
    { kind: 'feedback', text: 'customer says approve 2' });
  assert.equal(escapeSlack('<!channel> & <@U123>'), '&lt;!channel&gt; &amp; &lt;@U123&gt;');
});

test('Brave adapter sends only the supplied query and returns usable public source links', async () => {
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, 'api.search.brave.com');
    assert.equal(url.searchParams.get('q'), 'CSV empty rows');
    assert.equal((init?.headers as Record<string, string>)['X-Subscription-Token'], 'test-key');
    return new Response(JSON.stringify({ web: { results: [
      { title: 'Docs', url: 'https://example.test/docs', description: 'CSV format' },
      { title: 'Unsafe link', url: 'javascript:alert(1)', description: 'Ignore' },
      { title: 'Missing fields' },
    ] } }), { status: 200 });
  };
  assert.deepEqual(await braveSearch('CSV empty rows', 'test-key', fetcher),
    [{ title: 'Docs', url: 'https://example.test/docs', description: 'CSV format' }]);
});

test('Brave failures and missing credentials are explicit; no invented results', async () => {
  await assert.rejects(braveSearch('query', ''), /BRAVE_SEARCH_API_KEY/);
  await assert.rejects(braveSearch('', 'test'), /query/);
  const fetcher: typeof fetch = async () => new Response('', { status: 429 });
  await assert.rejects(braveSearch('query', 'test', fetcher), /HTTP 429/);
});
