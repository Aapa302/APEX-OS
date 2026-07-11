# APEX Gemini Proxy

Secure backend proxy that exposes an Anthropic-compatible `/v1/messages` endpoint backed by Google Gemini, designed for use with APEX OS.

## Overview

APEX OS was originally built to interface with the Anthropic Claude API. This proxy allows APEX OS to use Google Gemini models without changing its internal message-building or parsing logic. It accepts Anthropic-shaped requests and returns Anthropic-shaped responses, acting as a seamless translation layer.

### Architecture

```
Browser (APEX OS Frontend)
       │
       ▼
POST /v1/messages (Proxy)
       │
       ├─► Validation Middleware
       │
       ├─► Gemini Service (Translation Layer)
       │     │
       │     └─► Google Gemini API
       │
       ▼
Anthropic-compatible JSON Response
```

## Features

- **Anthropic Compatibility**: Supports `messages`, `system`, `max_tokens`, and `model` fields.
- **Image Support**: Handles base64-encoded images for vision-capable models.
- **JSON Mode**: Dedicated `/v1/messages/json` endpoint for structured outputs.
- **Security**: Includes Helmet for secure headers and CORS configuration.
- **Rate Limiting**: Protects your Gemini API key from abuse.
- **Logging**: Structured logging for requests and errors.

## Setup

### Prerequisites

- Node.js >= 18.0.0
- A Google Gemini API Key (get one at [Google AI Studio](https://aistudio.google.com/))

### Installation

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
4. Fill in your `GEMINI_API_KEY` in `.env`.

### Running the Server

- **Development**:
  ```bash
  npm run dev
  ```
- **Production**:
  ```bash
  npm start
  ```

The proxy will be available at `http://localhost:8787`.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GEMINI_API_KEY` | **Required** Your Google Gemini API Key | |
| `GEMINI_MODEL` | The Gemini model to use | `gemini-2.5-flash` |
| `PORT` | Port to run the proxy on | `8787` |
| `CORS_ORIGIN` | Allowed origins (comma-separated) | `*` |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window in milliseconds | `60000` |
| `RATE_LIMIT_MAX_REQUESTS` | Max requests per window per IP | `60` |

## Troubleshooting Connectivity

If you see "Proxy Offline" or "Connection refused" in the APEX OS frontend:

1.  **Mixed Content**: If your frontend is served over HTTPS (e.g., `claude.ai`), your backend **must** also use HTTPS. Use a service like Render, Heroku, or a tunnel like Cloudflare Quick Tunnel/ngrok for development.
2.  **CORS**: Ensure the backend's `CORS_ORIGIN` environment variable includes your frontend's domain (or set it to `*` for testing).
3.  **Browser Extensions**: Privacy extensions (like uBlock Origin or Privacy Badger) sometimes block `onrender.com` or other free hosting domains. Try disabling them for the APEX OS tab.
4.  **Cold Starts**: If using Render's free tier, the first request after 15 minutes of inactivity can take up to 60 seconds to respond. The frontend has a 60s timeout to accommodate this.

## Testing

Run the test suite:
```bash
npm test
```

## License

MIT
