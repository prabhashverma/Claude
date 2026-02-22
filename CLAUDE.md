# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a monorepo of AI/ML projects — multiple independent applications sharing a single directory. Each subdirectory is a self-contained project. The primary active projects are:

| Project | Type | Stack |
|---|---|---|
| `boarding-agent-api/` | Python FastAPI backend | Python 3.10+, FastAPI, Agno, OpenAI, PostgreSQL |
| `BoardingAgent/` | Next.js AI chatbot | Next.js 16, React 19, TypeScript, Drizzle ORM, AI SDK |
| `boarding-agent-website/` | Vite React SPA | Vite, React, TypeScript, Tailwind, Supabase |
| `boarding-agent-extension/` | Chrome extension | Manifest V3, plain JS |
| `AgentNotebookLM/` | Chrome extension | Manifest V3, OAuth2, plain JS |
| `AgentNotebookLMWebsite/` | Next.js marketing site | Next.js 15, Supabase, Stripe |
| `AgenticJobSearch/` | Python multi-agent | Python, Agno, LangChain, CrewAI |
| `AgentVOC/` | Python Streamlit agent | Python, CrewAI, Firecrawl, Streamlit |

---

## Commands by Project

### boarding-agent-api (Python / FastAPI)
```bash
cd boarding-agent-api
pip install -r requirements.txt
python -m app.main          # run dev server on port 7777 (Agno default — matches frontend proxy)
pytest test/test02.py       # run a single test
pytest test/                # run all tests
docker build -t boarding-agent-api . && docker run -p 8080:8080 boarding-agent-api
```
> **Note:** Do NOT use `uvicorn main:app --reload` for local dev — uvicorn defaults to port 8000, which won't match the frontend proxy (targets 7777). Use `python -m app.main` instead.

### BoardingAgent (Next.js)
```bash
cd BoardingAgent
pnpm install
pnpm dev          # dev server
pnpm build        # production build
pnpm lint         # ESLint (ultracite)
pnpm format       # format code
pnpm test         # Playwright E2E tests
pnpm db:migrate   # run Drizzle migrations
```

### boarding-agent-website (Vite + React)
```bash
cd boarding-agent-website
npm install
npm run dev       # dev server
npm run build     # production build
npm run lint      # ESLint
npm run preview   # preview production build
```

### AgentVOC (Streamlit)
```bash
cd AgentVOC
pip install -r requirements.txt
python -m streamlit run app.py   # web UI at localhost:8501
python main.py                   # CLI mode
python tests/test_voc.py         # run tests
```

### AgenticJobSearch (Python)
```bash
cd AgenticJobSearch
pip install -r requirements.txt
python main.py
python test_agent.py
```

### Chrome Extensions (no build needed)
Load as unpacked in `chrome://extensions/` → "Load unpacked" → select extension directory.

---

## Architecture

### Agent Framework (boarding-agent-api)

Uses the **Agno** framework with a hierarchical team pattern:

```
JourneyMaster (Team Orchestrator)
├── VisaComplianceAgent      → country-level visa rules
├── TravelAdvisoryAgent      → country-level advisories
├── AirportExperienceAgent   → airport-level traveller experiences
└── LayoverVisaAgent         → transit/layover visa requirements
```

Key patterns:
- **Scope split**: country-level agents handle rules; airport-level agents handle experiences
- **Single-member optimization**: `respond_directly=True` on teams with one member bypasses the team model round-trip
- **Tool call limiting**: `tool_call_limit=5` prevents runaway loops
- **Streaming**: SSE (`stream=true` query param) with event types `status | thinking | agent_event | reasoning | leg_done | done`

The streaming endpoint is `POST /v1/checkmyflight` — see `boarding-agent-api/docs/STREAMING_ARCHITECTURE.md` for the full SSE event flow.

### Multi-Agent Orchestration (AgenticJobSearch)

6-agent pattern coordinated by a Central Orchestrator:
- `JobSearchAgent`, `DataProcessingAgent`, `NotificationAgent`, `SchedulingAgent`, `StorageAgent`
- All agents extend `BaseAgent` with abstract `process()` and `get_capabilities()`

### Frontend (BoardingAgent)

Next.js App Router with:
- Server Components (RSC) + Server Actions for data mutations
- Drizzle ORM + PostgreSQL for persistence
- NextAuth 5.0 for authentication
- Vercel AI SDK for LLM streaming integration
- shadcn/ui + Radix UI component system

### Chrome Extensions

Both extensions use **Manifest V3** with service worker backgrounds. `AgentNotebookLM` uses OAuth2 with Google and has a full localization system (`_locales/`) supporting multiple languages.

---

## Environment Variables

Each project has its own `.env` (or `.env.example`). Key variables:

| Variable | Used by | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | boarding-agent-api, AgentVOC, AgenticJobSearch | LLM calls |
| `DATABASE_URL` | boarding-agent-api, BoardingAgent | PostgreSQL connection |
| `FIRECRAWL_API_KEY` | AgentVOC | Web scraping |
| `STRIPE_SECRET_KEY` | AgentNotebookLMWebsite, boarding-agent-website | Payments |
| `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` | boarding-agent-website, AgentNotebookLMWebsite | Supabase |
| `MODEL_ID_JOURNEY_MASTER` etc. | boarding-agent-api | Per-agent model selection (default: gpt-4o / gpt-4o-mini) |
| `VALIDATION_CACHE_TTL_SECONDS` | boarding-agent-api | Cache duration (default: 86400) |

---

## Deployment

- **boarding-agent-api** → Railway (Dockerfile present, reads `PORT` env var)
- **BoardingAgent**, **AgentNotebookLMWebsite** → Vercel
- **Chrome extensions** → Chrome Web Store (.crx packaging)
