# chat-demo

English | [简体中文](README.zh-CN.md)

A static chat demo with pluggable model providers. There is no application backend: the browser talks directly to the model service you configure.

- Supports both **OpenAI-compatible** (`POST {baseUrl}/chat/completions`) and **Anthropic-compatible** (`POST {baseUrl}/messages`) APIs.
- Built-in presets for DeepSeek, OpenAI, DeepSeek (OpenAI-compatible), SiliconFlow, Alibaba Cloud Bailian, Zhipu GLM, Kimi, OpenRouter, Anthropic, Ollama and LM Studio — or fill in everything by hand.
- Keep several providers configured and switch between them; each one has its own key, model, extra headers and extra request body.
- Ships with a [Docker Compose](#run-with-docker-compose) deployment that includes a forwarding proxy for CORS.

## Run with Docker Compose

Requires Docker with Compose v2.

```sh
docker compose up -d --build
```

Open <http://localhost:8080> and add a provider under **Settings → Model services**.

### Optional configuration

Copy `.env.example` to `.env`, adjust, then `docker compose up -d` (no rebuild needed).

| Variable              | Default       | Description                                                                                  |
| --------------------- | ------------- | -------------------------------------------------------------------------------------------- |
| `WEB_PORT`            | `8080`        | Published port                                                                                |
| `CHAT_PROXY_URL`      | `/api/proxy`  | Same-origin endpoint the browser posts provider requests to; leave empty to call providers directly |
| `CHAT_PROXY_TOKEN`    | empty         | Shared secret for the proxy; recommended on public hosts                                      |
| `PROXY_ALLOWED_HOSTS` | empty (any)   | Only forward to these hosts, comma separated, e.g. `api.openai.com,api.siliconflow.cn`        |
| `CHAT_PROVIDERS`      | `[]`          | Providers to seed as a JSON array; users can still add their own                               |

Seeded provider example:

```json
[
  {
    "name": "SiliconFlow",
    "protocol": "openai",
    "baseUrl": "https://api.siliconflow.cn/v1",
    "model": "deepseek-ai/DeepSeek-V3",
    "apiKey": "sk-xxx"
  }
]
```

> Keys live in each visitor's browser localStorage. Keys seeded with `CHAT_PROVIDERS` are shipped to the browser in `config.js`, so use that only for personal or internal deployments.

### Why the forwarding proxy

Browsers hit CORS when calling third-party APIs directly, and most model services do not allow it. The `api` service accepts `GET|POST /api/proxy?target=<url>`, forwards the request and streams the response back chunk by chunk (nginx buffering is off, so token-by-token output is unaffected). If a provider allows CORS, set `CHAT_PROXY_URL` to empty and skip the proxy.

## Getting started locally

Install Node.js 22.12+ and pnpm:

```sh
pnpm install
pnpm dev
```

Open <http://localhost:8090>.

To build the static site:

```sh
pnpm build
```

The output is written to `dist/`. Deploy it to a static web server or open `dist/index.html` directly (this requires browser support for storage on `file://` pages and an API service that permits their cross-origin requests).

## Configuring providers

Under **Settings → Model services**:

1. Choose **Add provider** and pick a preset (base URL and model are filled in), or **Custom** to type everything.
2. Enter the **base URL** (up to the version segment, e.g. `https://api.openai.com/v1`), a **model**, and an **API key**.
3. **Test connection** calls `GET {baseUrl}/models`. Services without that endpoint report "connected, but nothing to verify against" — that is fine.
4. Save, then click the radio dot to make it the provider **in use**. All new chats use it.

Under **Advanced** you can add:

- **Extra headers** — one `Name: value` per line, e.g. OpenRouter's `HTTP-Referer`.
- **Extra request body** — JSON merged into the request body, e.g. `{"temperature": 0.7}`, `{"reasoning_effort": "high"}`, `{"enable_thinking": true}`. This is how you adapt vendor-specific switches.

### Capabilities by protocol

| Capability                              | OpenAI compatible                       | Anthropic compatible                          |
| --------------------------------------- | --------------------------------------- | --------------------------------------------- |
| Streaming chat, stop, regenerate        | Yes                                     | Yes                                           |
| Reasoning display                       | Reads `reasoning_content` / `reasoning` | Official `thinking` events                    |
| Auto title                              | Derived from the first prompt           | Server-side only with "DeepSeek-specific API" |
| File attachments                        | No                                      | Requires "File attachments (Files API)"       |
| Web search / link reading               | No                                      | Requires "DeepSeek-specific API" + "Web search" |
| Voice input and read aloud              | No                                      | Requires voice enabled and a voice endpoint   |
| Continue generation (prefill)           | No (API has no prefix completion)       | Yes                                           |

With the OpenAI-compatible protocol the "deep thinking" toggle sends no extra field; use the extra request body for vendor-specific switches.

## New API one-click import

[New API](https://github.com/QuantumNous/new-api) is only an OAuth *client* today: it has no OAuth/OIDC authorization server (no `/authorize`, no discovery — see [issue #6572](https://github.com/QuantumNous/new-api/issues/6572)), so "jump there, authorize, come back with a token" is not possible. What it does offer is chat presets: a root user configures a link template with placeholders, and users click it to land in the target app with their own key.

chat-demo understands that link. The parameters are `newapi` (the New API server address) and `key` (the API key):

```json
{ "chat-demo": "http://your-chat-demo:8080/?newapi={address}&key={key}" }
```

Add that line under New API's `System settings → Console content → Chat` (root only). Users can then come from the "Chat" section in the sidebar or from `⋯ → Chat → chat-demo` on an API key row.

What happens on open:

- A provider named "New API" is created and activated, with the base URL taken from `{address}/v1` (an existing config for the same address is updated in place instead of duplicated).
- The key is used to call `/v1/models` and the first model becomes the default.
- If the model list cannot be fetched (bad key, unreachable address) the config is still saved and Settings → Model services opens so the user can confirm.
- The URL parameters are stripped immediately; the key has already been visible in the address bar and browser history, which is fine for private/internal use but not for shared machines.

Loopback addresses (`localhost`, `127.0.0.1`) bypass the Docker forwarding proxy — `127.0.0.1` inside the container is not the user's machine.

## Features

- Multiple conversations with automatic titles, renaming, and deletion; edit prompts, regenerate replies, and switch between message branches.
- Streaming replies, deep thinking, smart search, link reading, and source citations; stop generation or continue eligible replies.
- Upload, paste, or drag and drop attachments; use voice input and read replies aloud. A live audio spectrum appears in the first row of the input area while recording on mobile.
- Markdown, syntax highlighting, KaTeX math, and Mermaid diagrams.
- Simplified Chinese and English, light and dark themes, mobile layouts, location settings, and chat history import and export.
- Pluggable providers: multiple configurations, connection test, presets and advanced parameters.

## Data and storage

Provider settings (including API keys) and preferences live in the browser's localStorage; conversations and original attachments live in IndexedDB. Local data is isolated by browser profile and site origin. Sending messages, uploading attachments, and using speech features sends the relevant content to the configured model service.

History import and export in Settings use ZIP archives. After confirmation and successful validation, importing replaces all local conversations and attachments. Exports include conversations and locally available original images, but exclude provider settings, preferences, and original non-image attachments. See the [history import/export documentation (Chinese)](src/services/chat/history/README.md) for the archive format and preservation details.

Settings → Data → Delete all chats clears all local conversations, original attachments, and unsent drafts after confirmation. It stops ongoing replies and returns to a new chat. Provider settings and preferences are preserved; files already uploaded to the model service are not deleted.

## Development

| Command          | Description                  |
| ---------------- | ---------------------------- |
| `pnpm dev`       | Start the development server |
| `pnpm build`     | Build into `dist/`           |
| `pnpm type`      | Run TypeScript type checks   |
| `pnpm lint`      | Lint with oxlint             |
| `pnpm format`    | Format with oxfmt            |
| `pnpm docker:up` | Build and start containers   |

[rspack.config.ts](rspack.config.ts) `createConfig({ apiOrigin, devServer })` sets the default base URL for the DeepSeek preset (`https://api.deepseek.com`); the provider actually used at runtime comes from Settings.

```text
src/
  app/                 Application layout, themes, and global styles
  components/          Chat, settings, Markdown, and other UI components
  i18n/                English and Chinese translations
  services/
    api/               Provider config, both protocols, SSE, protocol types
      providers.ts     Provider config, presets, capabilities, URLs and auth headers
      client.ts        Single streaming entry point (dispatches by protocol)
      anthropic.ts     Anthropic-compatible protocol
      openai.ts        OpenAI-compatible protocol (translates deltas into internal events)
    chat/              Conversations, message branches, storage, history import/export
    markdown/          Markdown parsing, syntax highlighting, diagrams
    speech/            Audio recording and read-aloud playback
  utils/               Shared utilities
deploy/                nginx config, runtime config script, forwarding proxy
```

## License

[MIT](LICENSE). The build copies the license to `dist/LICENSE`; include it when distributing the app. Third-party dependencies are subject to their own licenses.
