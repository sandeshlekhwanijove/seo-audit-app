# SEO Audit Tool

A technical SEO crawler built with **FastAPI** (Python / Playwright) and **Next.js** (React / TypeScript).

```
seo-audit-app/
├── backend/          FastAPI + Playwright crawling engine
│   ├── auditor.py    Core crawling logic
│   ├── main.py       FastAPI routes & job management
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/         Next.js + Tailwind UI
│   └── src/
│       ├── app/      Next.js App Router pages
│       ├── components/
│       └── lib/api.ts  Type-safe API client
├── docker-compose.yml
└── README.md
```

---

## Run locally (without Docker)

### 1. Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium --with-deps
uvicorn main:app --reload --port 8000
```

API docs: http://localhost:8000/docs

### 2. Frontend

```bash
cd frontend
npm install
npm run dev          # http://localhost:3000
```

---

## Run with Docker Compose (one command)

```bash
docker compose up --build
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000

---

## Deploy for free

### Backend → Railway  (recommended — supports Docker, has Playwright-compatible memory)

1. Go to https://railway.app → **New Project → Deploy from GitHub repo**
2. Select the `backend/` folder (or point to the repo root and set **Root Directory = backend**)
3. Railway auto-detects the Dockerfile and builds it
4. Set environment variable: `CORS_ORIGINS=https://your-vercel-app.vercel.app`
5. Note the generated URL, e.g. `https://seo-audit-api-production.up.railway.app`

Railway's free "Hobby" tier gives **$5 credit / month** — enough for ~100 audits.
Sign up at https://railway.app (GitHub login, no card required initially).

### Frontend → Vercel  (completely free forever)

1. Push your repo to GitHub
2. Go to https://vercel.com → **Add New Project** → import the repo
3. Set **Root Directory = frontend**
4. Add environment variable:
   ```
   NEXT_PUBLIC_API_URL = https://seo-audit-api-production.up.railway.app
   ```
5. Click **Deploy** — done. Vercel gives you a URL like `https://seo-audit.vercel.app`

### Share with your team

Give them the Vercel URL. No installs needed — it runs entirely in the browser,
hitting your Railway backend for all the actual crawling work.

---

## Alternative free backends

| Platform   | Free tier details                                 | Playwright support |
|------------|---------------------------------------------------|--------------------|
| **Railway** | $5/month credit, 512 MB RAM                      | ✅ Good            |
| **Render**  | 512 MB RAM, sleeps after 15 min inactivity        | ⚠️ Marginal        |
| **Fly.io**  | 2× shared-cpu-1x (256 MB) always-on              | ❌ Too little RAM  |
| **Koyeb**   | 512 MB + 0.1 CPU always-on                       | ⚠️ Marginal        |

**Recommendation**: Railway for now. Upgrade to a $10/mo Render or Fly.io paid instance
when you need it for a team of > 3.

---

## API reference

All endpoints are documented at `<backend-url>/docs` (FastAPI auto-generates Swagger UI).

| Method | Path | Description |
|--------|------|-------------|
| POST   | `/api/audit/start` | Start an audit job |
| GET    | `/api/audit/status/{job_id}` | Poll progress |
| GET    | `/api/audit/results/{job_id}` | Fetch full results |
| GET    | `/api/audit/download/{job_id}/excel` | Download Excel report |
| DELETE | `/api/audit/{job_id}` | Clean up job |

### Start audit body

```json
{
  "url": "https://example.com",
  "mode": "site",
  "max_pages": 50,
  "delay_s": 1.0
}
```

---

## Tech stack

| Layer | Tech | Why |
|-------|------|-----|
| Crawler | Playwright (Python) | Real Chrome, bypasses most WAF/bot detection |
| Backend | FastAPI + Pydantic v2 | Async, auto-docs, type-safe |
| Frontend | Next.js 14 App Router | Free Vercel hosting, SSR |
| Styling | Tailwind CSS | No build-time CSS overhead |
| Charts | Recharts | React-native, lightweight |
| Reports | openpyxl | Excel export |
