# HackerAI Learning

Cybersecurity concepts, defensive analysis, and authorized lab/CTF learning with an OpenRouter-backed tutor. The app does not scan targets or run security tools.

## Run locally

1. Copy `.env.example` to `.env` or `.env.local`.
2. Put your OpenRouter API key in `AI_API_KEY` in that private file. Never put a real key in `.env.example`; `.env` and `.env.local` are ignored by Git.
3. Run `npm run dev` and open <http://localhost:3000>.

`AI_MODEL` defaults to `openrouter/free`; set it to another model ID in `.env.local` if needed. Free model availability and rate limits are controlled by OpenRouter and may change. Later, an OpenAI-compatible local server can be used by changing `AI_BASE_URL`, `AI_MODEL`, and (if required) `AI_API_KEY`.

The API key stays on the server and is never sent to the browser. Replies follow the language of the latest message, and supported Markdown is rendered safely in the chat. The server refuses some clearly phrased requests for website break-in steps and instructs the model to focus on defense. These safeguards are not a complete security boundary, and model responses can still be inaccurate; use only systems you own or have explicit permission to test.