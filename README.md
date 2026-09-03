# DataFrame

**A node-based canvas where every node runs real Python — in your browser.**

Live at **[dataframe.space](https://dataframe.space)**

Built at **DRHX (UTM)**, March 2026.

---

## What it is

Notebooks are linear. Real analysis isn't — you branch, you backtrack, you keep four
versions of the same transform side by side and compare them. DataFrame puts Python on an
infinite canvas instead of in a column.

Each node holds a Python snippet with a proper CodeMirror editor. Nodes wire into each
other, and the output of one becomes the input of the next. Everything executes
**client-side through Pyodide** — no execution server, no container per user, no cold
start. Your code never leaves the tab.

An AI chat panel sits alongside, backed by Gemini, so you can ask about a node without
losing the canvas.

## How it works

```
┌───────────────────────────────────┐
│  React + Vite + tldraw            │   infinite canvas, node graph, connections
│    ├── CodeMirror (Python)        │   per-node editor
│    └── Pyodide / react-py         │   CPython in WebAssembly — runs in the browser
└───────────────┬───────────────────┘
                │  REST
┌───────────────▼───────────────────┐
│  FastAPI + SQLModel               │   canvases, shapes, users
│    ├── Auth0                      │   session auth, post-login/logout flow
│    └── google-genai               │   Gemini chat endpoint
└───────────────────────────────────┘
```

**Why Pyodide.** The obvious build is a sandboxed container per session. That costs money
per visitor, adds a cold start to every first run, and becomes a security surface the
moment it's public. Running CPython compiled to WebAssembly moves all of it into the
client: execution is free, instant, and isolated by the browser rather than by us.

The tradeoff is real and worth stating — no native wheels that Pyodide hasn't built, and
a first-load cost while the runtime downloads.

## Running it

**Frontend**

```bash
cd treeHacks
npm install
npm run dev          # localhost:5173
```

**Backend**

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env   # fill in Auth0 + Gemini values
fastapi dev main.py    # localhost:8000
```

The frontend needs `VITE_API_BASE_URL` pointing at the backend.

## API

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/chat` | Gemini-backed chat over canvas context |
| `GET/POST/DELETE` | `/canvas/`, `/canvas/{id}` | canvas CRUD |
| `GET/POST` | `/canvas/{id}/shapes` | node and connection persistence |
| `GET/POST/DELETE` | `/users/`, `/users/{id}` | user records |
| `GET` | `/post-login`, `/post-logout` | Auth0 redirect handling |

## Deployment

Runs on **DigitalOcean App Platform**, auto-deploying from `main` — the static frontend and
the FastAPI service as separate components behind Cloudflare, with secrets as encrypted
App Platform environment variables.

> The Kubernetes manifests under `deploy/` describe an **abandoned Vultr VKE attempt** and
> are not how this is deployed. They're kept for reference only; see the note at the top of
> `deploy/README.md`.

## Credits

Team project built at DRHX. My contribution was 43 of the commits — the canvas and node
execution layer, the backend API, and the deployment.
