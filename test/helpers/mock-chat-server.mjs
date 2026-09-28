// A test fixture, and nothing else: a mock OpenAI-compatible server whose POST /v1/chat/completions echoes what it
// was sent, so the inspector's API test can check that a request reached a server intact over HTTP. The app never
// uses it; the inspector and the CLI talk only to the endpoints .env names.
import http from 'node:http';

export function createMockChatServer({ model = 'mock-model' } = {}) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET' && req.url === '/v1/models') { res.end(JSON.stringify({ object: 'list', data: [{ id: model, object: 'model' }] })); return; }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      requests.push({ headers: req.headers, body });
      const system = body.messages.find(m => m.role === 'system')?.content ?? '';
      const user = body.messages.find(m => m.role === 'user')?.content ?? '';
      const ids = [...user.matchAll(/<evidence id="([^"]+)"/g)].map(m => m[1]);
      const content = `Mock answer from ${body.model}: ${system.length} system characters, ${user.length} user characters, evidence ${ids.map(id => `[${id}]`).join(' ') || 'none'}.`;
      res.end(JSON.stringify({ id: 'chatcmpl-mock', object: 'chat.completion', model: body.model, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
        usage: { prompt_tokens: Math.ceil((system.length + user.length) / 4), completion_tokens: Math.ceil(content.length / 4) } }));
      return;
    }
    res.statusCode = 404; res.end(JSON.stringify({ error: `no ${req.method} ${req.url}` }));
  });
  server.requests = requests;
  return server;
}
