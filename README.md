# Bastion

Pre-publication brand governance: a Brand-as-Code manifest, a <10 ms deterministic pre-flight, a parallel Claude triad, intent-preserving surgical diffs, and a reverse-governance loop that turns repeated overrides into guideline PRs.

## Run locally

Backend (Python 3.11+):

    cd backend
    pip install -r requirements.txt
    cp ../.env.example .env        # optional: add ANTHROPIC_API_KEY and MONGODB_URI
    uvicorn main:app --reload --port 8000

Frontend:

    cd frontend
    npm install
    npm run dev                    # http://localhost:5173

Without an API key the triad uses deterministic fallbacks; without MONGODB_URI the backend stores data in memory; without a running backend the UI uses its offline demo engine.

## Deploy

- Render: `render.yaml` (set ANTHROPIC_API_KEY and MONGODB_URI).
- Vercel: `vercel.json`; set `VITE_API_URL` to the Render URL.

## Try the self-healing loop

Load "Hype vocabulary", switch role to Brand Manager, override the three TERM-06 flags with reasons. The third override opens a guideline PR; accept it to publish manifest v2.4.1.
