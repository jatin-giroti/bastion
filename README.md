# Bastion — Brand-as-Code Compliance & Pre-Publication Governance

Bastion is an active pre-publication compliance gate for enterprise marketing, product, and legal teams. It compiles static brand guidelines into a version-controlled `BrandManifest` JSON schema, runs a sub-10ms deterministic pre-flight engine, orchestrates a parallel Claude Audit Triad, and surfaces 1-click surgical diffs with a self-healing Reverse-Governance loop.

---

## Architecture Overview

| Layer | Stack | Deployment |
| :--- | :--- | :--- |
| **Frontend** | React 18, Vite, Tailwind CSS, Lucide Icons | Vercel (`frontend/dist`) |
| **Backend** | Python 3.11, FastAPI, Pydantic v2, Pillow, `pypdf`, `httpx` | Render (`backend/`) |
| **Database** | MongoDB Atlas (`bastion_db`) via Motor (`AsyncIOMotorClient`) + in-memory fallback | MongoDB Atlas |
| **AI Triad** | Anthropic Claude (`AsyncAnthropic` forced tool-use JSON schemas) + deterministic fallbacks | Anthropic API |

### Key Capabilities (Including All 3 Round 3 Improvements)
1. **PDF Brand-Book RAG Ingestion (`POST /api/v1/manifests/ingest-pdf`)**: Upload a brand guidelines PDF (or load the built-in sample fintech PDF) to extract page chunks, index RAG passages, compile a new `BrandManifest`, and switch brands live.
2. **Live Browser Content Linter (`Web Linter`)**: Interactive `<10ms` local pre-flight sandbox with floating compliance pill, 1-click surgical fixes, and copyable Chrome Manifest V3 extension code.
3. **RBAC Session Locking & Slack/Teams Webhooks (`POST /api/v1/webhooks/test`)**: Freezes editing for `Creator` roles during `LEGAL_HOLD` until resolved by a `Legal Reviewer`, and dispatches real-time Slack/Teams alerts on `LEGAL_HOLD` and `3/3 Override Guideline PR` events.
4. **Interactive Walkthrough (`? Guide`)**: Built-in 4-step floating guide bar for first-time reviewers.

---

## Clone & Run Locally (Under 2 Minutes)

### Prerequisites
- **Python 3.11+**
- **Node.js 18+** & `npm`

### 1. Clone the repository
```bash
git clone https://github.com/jatin-giroti/bastion.git
cd bastion
```

### 2. Start the FastAPI Backend
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
*Note: `MONGODB_URI`, `ANTHROPIC_API_KEY`, and `SLACK_WEBHOOK_URL` are optional for local testing—Bastion automatically degrades cleanly to its in-memory store and deterministic audit engine if unset.*

### 3. Start the React/Vite Frontend
Open a second terminal:
```bash
cd frontend
npm install
npm run dev
```
Open **`http://localhost:5173`** in your browser.

---

## Environment Variables

| Variable | Where | Purpose |
| :--- | :--- | :--- |
| `MONGODB_URI` | Backend (Render) | MongoDB Atlas connection string (`bastion_db`) |
| `ANTHROPIC_API_KEY` | Backend (Render) | Claude API key for the parallel audit triad & PDF compiler |
| `ANTHROPIC_MODEL` | Backend (Render) | Defaults to `claude-sonnet-5-5` |
| `SLACK_WEBHOOK_URL` | Backend (Render) | Optional default Slack/Teams webhook URL |
| `VITE_API_URL` | Frontend (Vercel) | Live Render backend URL (e.g. `https://bastion-1693.onrender.com`) |

---

## 4-Step Judge Verification Checklist
1. **Audit & Surgical Diffs**: Load the default preset, click **Run Audit**, and click **Accept fix** on a highlighted violation to watch the score and inline highlights update instantly.
2. **PDF RAG Ingestion**: Click **Ingest PDF** in the top bar → click **Load Sample Fintech PDF** → inspect the compiled rules and **RAG** chunks in the left vault.
3. **Live Web Linter**: Click **Web Linter** in the top bar → type `"risk-free returns"` to see sub-10ms local linting and 1-click patching.
4. **Session Locking & Webhooks**: Trigger a `LEGAL_HOLD` while role is `Creator` to see the editor lock automatically; switch to `Legal Reviewer` to unlock/override, and open the **Bell** icon to inspect or test webhook alerts.
