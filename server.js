const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const root = path.join(__dirname, 'public');
const port = Number(process.env.PORT || 3000);
const apiBaseUrl = (process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
const apiKey = process.env.AI_API_KEY || process.env.OPENROUTER_API_KEY;
const model = process.env.AI_MODEL || process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b:free';
const usesOpenRouter = new URL(apiBaseUrl).hostname === 'openrouter.ai';
const maxBodyBytes = 24_000;

const tutorInstructions = [
  'You are HackerAI, a cybersecurity learning tutor. Respond in the language used by the learner.',
  'Teach concepts, defensive analysis, secure configuration, and authorized practice in isolated labs, CTFs, or systems the learner owns or has explicit permission to test.',
  'Do not provide actionable guidance for unauthorized access, credential theft, malware, stealth, persistence, exfiltration, or exploitation of real third-party targets. Do not automate scans or interact with targets.',
  'If a request concerns a real target or harmful activity, briefly explain the boundary and redirect to a safe lab exercise, high-level concept, or defensive remediation.',
  'Be clear about uncertainty. Do not claim that you tested, scanned, or verified any system.'
].join(' ');

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  response.end(JSON.stringify(data));
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBodyBytes) {
      throw Object.assign(new Error('Request is too large.'), { statusCode: 413 });
    }
  }
  try {
    return JSON.parse(body);
  } catch {
    throw Object.assign(new Error('Request must contain valid JSON.'), { statusCode: 400 });
  }
}

async function handleChat(request, response) {
  if (usesOpenRouter && !apiKey) {
    return sendJson(response, 503, { error: 'Set AI_API_KEY in .env or .env.local, then restart the server.' });
  }

  let payload;
  try {
    payload = await readJson(request);
  } catch (error) {
    return sendJson(response, error.statusCode || 400, { error: error.message });
  }

  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    return sendJson(response, 400, { error: 'Add a message before sending.' });
  }

  const messages = payload.messages.slice(-12).map((message) => {
    if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') {
      return null;
    }
    return { role: message.role, content: message.content.slice(0, 4000) };
  });

  if (messages.some((message) => message === null) || messages[messages.length - 1].role !== 'user') {
    return sendJson(response, 400, { error: 'Conversation format is not valid.' });
  }

  try {
    const headers = { 'content-type': 'application/json' };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    if (usesOpenRouter) {
      headers['http-referer'] = `http://localhost:${port}`;
      headers['x-title'] = 'HackerAI Learning';
    }

    const upstream = await fetch(`${apiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: 900,
        messages: [{ role: 'system', content: tutorInstructions }, ...messages]
      }),
      signal: AbortSignal.timeout(45_000)
    });

    const result = await upstream.json();
    if (!upstream.ok) {
      console.error('OpenRouter returned status', upstream.status);
      return sendJson(response, 502, { error: 'AI service request failed. Check the selected model and API account.' });
    }

    const answer = result.choices?.[0]?.message?.content;
    if (typeof answer !== 'string' || !answer.trim()) {
      return sendJson(response, 502, { error: 'The AI service returned an empty response.' });
    }
    return sendJson(response, 200, { answer });
  } catch (error) {
    console.error('OpenRouter request failed:', error.name || 'UnknownError');
    return sendJson(response, 502, { error: 'Could not reach the AI service. Try again shortly.' });
  }
}

async function handleStatic(pathname, response) {
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(root, `.${decodeURIComponent(requestedPath)}`);
  if (!filePath.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end();
    return;
  }

  const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8'
  };

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      'content-type': contentTypes[path.extname(filePath)] || 'application/octet-stream',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:",
      'referrer-policy': 'no-referrer'
    });
    response.end(content);
  } catch {
    response.writeHead(404).end('Not found');
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (request.method === 'GET' && url.pathname === '/api/status') {
    return sendJson(response, 200, { configured: !usesOpenRouter || Boolean(apiKey), model });
  }
  if (request.method === 'POST' && url.pathname === '/api/chat') {
    return handleChat(request, response);
  }
  if (request.method === 'GET') {
    return handleStatic(url.pathname, response);
  }
  response.writeHead(405, { allow: 'GET, POST' }).end();
});

server.listen(port, () => {
  console.log(`HackerAI Learning is running at http://localhost:${port}`);
});