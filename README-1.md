# APEX OS — Gemini Proxy Backend

A **secure backend proxy** that exposes an Anthropic-compatible `/v1/messages` API endpoint backed by **Google Gemini**. The [APEX OS React frontend](../APEX-OS-v4.jsx) calls this proxy instead of Claude directly, so the `GEMINI_API_KEY` never touches the browser.

```
Browser (APEX-OS-v4.jsx)
    └──► POST http://localhost:8787/v1/messages
             └──► src/services/geminiService.js
                      └──► https://generativelanguage.googleapis.com (Gemini API)
```

---

## Quick start (local, 3 steps)

### 1. Prerequisites
- Node.js 18+ (`node --version`)
- A Gemini API key from https://aistudio.google.com/app/apikey (free tier works)

### 2. Configure
```bash
cp .env.example .env
# Edit .env and set:  GEMINI_API_KEY=your_key_here
```

### 3. Run
```bash
npm install
npm start
# Server starts on http://localhost:8787
```

Test it:
```bash
curl http://localhost:8787/health
# {"status":"ok","provider":"gemini","model":"gemini-2.0-flash", ...}
```

---

## Quick start (Docker)

```bash
cp .env.example .env
# Edit .env — set GEMINI_API_KEY

docker-compose up --build
```

---

## Connecting APEX OS frontend

`APEX-OS-v4.jsx` already has `PROXY_BASE_URL` set at line 18:

```js
const PROXY_BASE_URL = "http://localhost:8787";
```

That's it — all 11 AI employees (CEO, CTO, Research Engineer, etc.), the planner, reviewer, and autonomous orchestrator automatically route through the proxy. **No other frontend changes needed.**

To deploy the frontend and proxy on different domains, update `PROXY_BASE_URL` to the proxy's public URL and set `CORS_ORIGIN` in the proxy's `.env` to the frontend's origin.

---

## API reference

### `POST /v1/messages`
Accepts an Anthropic-compatible request body. Returns an Anthropic-compatible response.

**Request:**
```json
{
  "system": "You are an expert CEO.",
  "messages": [
    { "role": "user", "content": "What should our Q3 priorities be?" }
  ],
  "max_tokens": 1000
}
```

**Response:**
```json
{
  "id": "proxy_1720000000000",
  "type": "message",
  "role": "assistant",
  "model": "gemini-2.0-flash",
  "provider": "gemini",
  "content": [{ "type": "text", "text": "Based on your company context..." }],
  "stop_reason": "end_turn"
}
```

**Image uploads** (base64 multipart content from the CEO chat file-attach feature) are automatically translated to Gemini's `inlineData` format.

---

### `POST /v1/messages/json`
Same as above but activates Gemini's native JSON mode (`response_mime_type: "application/json"`). Used by the Planner and Reviewer code paths.

---

### `GET /health`
Liveness probe. Returns `200 OK` with server status.

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | ✅ | — | Your Google Gemini API key |
| `GEMINI_MODEL` | | `gemini-2.0-flash` | Any current Gemini model name |
| `AI_PROVIDER` | | `gemini` | Reserved for future use |
| `PORT` | | `8787` | Server port |
| `NODE_ENV` | | `development` | `development` or `production` |
| `CORS_ORIGIN` | | `*` | Comma-separated allowed origins, or `*` |
| `RATE_LIMIT_WINDOW_MS` | | `60000` | Rate limit window in ms |
| `RATE_LIMIT_MAX_REQUESTS` | | `60` | Max requests per window per IP |

---

## Running tests

```bash
# Unit + integration tests (no API key needed, no server needed):
npm test

# Live server tests (needs running server + valid GEMINI_API_KEY):
npm start &
node test/live.test.js
```

---

## Project structure

```
apex-gemini-proxy/
├── src/
│   ├── server.js               # Express app entry point
│   ├── config/
│   │   └── env.js              # Env var loader + startup validation
│   ├── services/
│   │   └── geminiService.js    # Gemini API client + Anthropic↔Gemini translation
│   ├── routes/
│   │   ├── messages.js         # POST /v1/messages and /v1/messages/json
│   │   └── health.js           # GET /health
│   └── middleware/
│       ├── validate.js         # Request body validation
│       ├── errorHandler.js     # Centralised error → JSON response
│       └── logger.js           # Morgan HTTP logger + structured log helper
├── test/
│   ├── geminiService.test.js   # 41 unit tests (pure translation logic)
│   ├── integration.test.js     # 34 integration tests (mocked fetch)
│   ├── live.test.js            # Live server tests (real Gemini API)
│   └── run-tests.js            # Test runner
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── package.json
```

---

## Deploying to production

### Railway / Render / Fly.io (recommended)
1. Push this folder to a Git repo.
2. Create a new service pointing at the repo.
3. Set `GEMINI_API_KEY` as a secret environment variable in the service dashboard.
4. Set `CORS_ORIGIN` to your frontend's URL (e.g. `https://your-apex-app.com`).
5. Deploy — the health check endpoint (`/health`) confirms it's running.

### Docker (self-hosted)
```bash
docker build -t apex-gemini-proxy .
docker run -d -p 8787:8787 \
  -e GEMINI_API_KEY=your_key \
  -e CORS_ORIGIN=https://your-frontend.com \
  --name apex-proxy \
  apex-gemini-proxy
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Missing required environment variable: GEMINI_API_KEY` | Copy `.env.example` → `.env` and add your key |
| `400 API key not valid` from Gemini | Check the key at https://aistudio.google.com |
| `CORS error` in browser | Set `CORS_ORIGIN` in `.env` to match your frontend URL |
| `429 Too many requests` | Increase `RATE_LIMIT_MAX_REQUESTS` in `.env` |
| Frontend still using Claude | Check `PROXY_BASE_URL` in `APEX-OS-v4.jsx` line 18 is set correctly |
| Gemini returns empty text | Model hit a safety filter — try rephrasing the system prompt |

---

## Security notes

- `GEMINI_API_KEY` is **only** read server-side from `.env` — it never reaches the browser.
- Helmet sets secure HTTP headers on all responses.
- Rate limiting prevents API key abuse: 60 requests/minute/IP by default.
- The `Dockerfile` runs as a non-root user.
- In production, always set `CORS_ORIGIN` to your specific frontend URL — never leave it as `*`.
