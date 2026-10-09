# BlueprintLens

Turns process blueprint documents (DOCX/PDF) into an interactive process model: AI extraction → author review → published, drillable viewer. Built from `BlueprintLens_PRD.docx`.

**Stack:** Next.js 15 (App Router, TS, Tailwind) · Vercel AI SDK + Claude (`claude-sonnet-5-5`) · Drizzle ORM · Postgres (Neon in cloud, in-process PGlite locally) · Vercel Blob (private) for uploads · React Flow for diagrams · jose/bcrypt auth (roles: author / reviewer / viewer).

## Run locally (no external services needed)

```bash
npm install
npm run dev -- --port 3100
```

Open http://localhost:3100. The first account you register becomes the **author/admin**. Data lives in `.data/` (PGlite DB + uploaded files).

Without `ANTHROPIC_API_KEY` the app runs in **offline mode**: a rough heading/list heuristic (low confidence) so you can exercise the whole flow. Set a key for real AI extraction (including diagram images) and Q&A:

```bash
# .env.local
ANTHROPIC_API_KEY=sk-ant-...
AUTH_SECRET=<long random string>
```

Tick "Start from sample" when creating a blueprint to get a ready-made Order-to-Cash model.

## Environment variables

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | AI extraction + Q&A (optional locally) |
| `ANTHROPIC_MODEL` | Override model id (default `claude-sonnet-5-5`) |
| `AUTH_SECRET` | Session signing secret (**required in production**) |
| `DATABASE_URL` | Neon/Postgres URL. Unset = local PGlite |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob (private store). Unset = local disk |
| `ALLOW_SIGNUP` | `true` to allow open self-registration (default: first user only; authors add users) |

## Deploy to Vercel

1. `vercel login`, then `vercel link` in this folder.
2. Storage: add **Neon Postgres** (sets `DATABASE_URL`) and a **private Blob store** (sets `BLOB_READ_WRITE_TOKEN`) from the Vercel dashboard → Storage.
3. Set `ANTHROPIC_API_KEY` and `AUTH_SECRET` (Project → Settings → Environment Variables).
4. `vercel deploy --prod`. Tables are created automatically on first request.

## How extraction works on serverless

Upload is direct-to-Blob (bypasses the 4.5 MB function body limit; up to 50 MB). The document is parsed and split into chunks (12 PDF pages or ~14k characters of DOCX). The browser then calls `POST /api/jobs/:id` once per chunk, so every request stays inside the function time limit; the model is merged and normalised after the last chunk and saved as the draft. Authors review/edit it (with the source excerpt beside it) and publish a numbered version.

## Embedding in Teams / SharePoint

Add a website tab pointing at `https://<your-app>/b/<blueprint-id>?embed=1` (hides the app header). Frame-ancestors for Teams/SharePoint/Office are allowed and the session cookie is `SameSite=None; Secure` in production. Deep links: `?view=flow&p=<processId>&s=<stepId>`.

## Not built / deviations from the PRD

- Entra ID SSO — simple email/password login now; swap in at `src/lib/auth.ts`.
- VSDX input and Visio export; ISO 42001 prompt/output logging.
- BPMN export has process semantics but no diagram layout (BPMNDI).
- `@mentions` are stored as text, not notifications.
- Heatmap uses pain points / step counts / automation / low confidence (no volume data in the model).
