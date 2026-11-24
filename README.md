# Bastion — Brand-as-Code Compliance & Pre-Publication Governance

Bastion transforms static brand guidelines into a version-controlled `BrandManifest` JSON schema, runs sub-10ms deterministic pre-flight checks, orchestrates a parallel Claude Audit Triad, and surfaces word-level surgical diffs with a self-healing Reverse-Governance loop[cite: 16, 17, 19].

- **Live Frontend:** https://bastion-vert.vercel.app/
- **Backend API & Health:** https://bastion-1693.onrender.com/api/v1/health
- **Repository:** https://github.com/jatin-giroti/bastion[cite: 23]
- **Team Bastion:** Jatin Giroti, Anmol, Shobhit, Abhijeet, and Aniket[cite: 21]

---

## Architecture & Tech Stack

| Layer | Stack | Deployment |
| :--- | :--- | :--- |
| **Frontend** | React 18, Vite, Tailwind CSS, Lucide Icons | Vercel (`frontend/dist`) |
| **Backend** | Python 3.11, FastAPI, Pydantic v2, `asyncio.gather()`[cite: 19] | Render (`backend/`) |
| **Database** | MongoDB Atlas (`bastion_db`) via Motor + automatic in-memory fallback[cite: 19] | MongoDB Atlas[cite: 19] |
| **AI, Parsing & Alerts** | Anthropic Claude (structured JSON + vision), `pypdf`, `Pillow`, `wcag-contrast-ratio`, `httpx`[cite: 19] | Anthropic API / Render |

### Core Features
1. **3-Pane Governance Studio & Interactive Guide (`? Guide`):** Active Brand-as-Code Vault (`Rules` | `RAG` | `JSON`), Draft & WCAG Contrast Canvas, filterable Surgical Diff Rail (`All` | `Legal` | `Lexicon` | `WCAG`), and a 4-step floating walkthrough bar.
2. **PDF Brand-Book RAG Ingestion (`POST /api/v1/manifests/ingest-pdf`):** Extracts page-level chunks (~550 chars with keywords), compiles a `BrandManifest`, supports multi-brand switching, includes a one-click sample fintech PDF, and falls back cleanly in-browser if offline.
3. **Live Web Content Linter & Chrome Extension (`Web Linter`):** Real-time browser editor sandbox with sub-10ms local linting, inline highlights, one-click fixes, and copyable Manifest V3 Shadow-DOM extension code.
4. **RBAC Session Locking & Slack/Teams Webhooks (`POST /api/v1/webhooks/test`):** Freezes raw copy editing for `Creator` roles during `LEGAL_HOLD` until resolved or escalated to a `Legal Reviewer`, and dispatches formatted webhook alerts on `LEGAL_HOLD` and 3x-override `GuidelinePR` events.
5. **Reliability & Edge-Case Hardening:** Wrapped in an `ErrorBoundary` with double-click protection, `%PDF-` / 15 MB upload checks, SSRF webhook URL validation, and deterministic/in-memory fallbacks.

---
