# H1BIntel Frontend + Backend — Build Specification
# Next.js 14 app with API routes, TypeScript, Tailwind CSS

## Overview
Five-screen web application for H1B job seekers.
Mobile-first. Fast. No login required for core features.

## Tech Stack
- Framework:    Next.js 14 (App Router)
- Language:     TypeScript (strict mode)
- Styling:      Tailwind CSS
- Database:     Neon Postgres via @neondatabase/serverless
- Cache:        Upstash Redis (@upstash/redis)
- AI Chat:      OpenAI SDK pointed at DeepSeek V3 / Groq
- UI Libs:      shadcn/ui, Recharts (charts), react-map-gl (map)
- Icons:        Lucide React
- Forms:        React Hook Form + Zod
- Tables:       TanStack Table

## Install
```bash
npx create-next-app@latest h1bintel-web --typescript --tailwind --app
cd h1bintel-web
npx shadcn-ui@latest init
npm install @neondatabase/serverless @upstash/redis openai
npm install recharts react-map-gl maplibre-gl
npm install @tanstack/react-table lucide-react
npm install react-hook-form zod @hookform/resolvers
```

## App Structure
```
web/
├── app/
│   ├── layout.tsx               # Root layout, nav, footer
│   ├── page.tsx                 # Home / search landing
│   ├── lca/
│   │   └── page.tsx             # LCA search
│   ├── perm/
│   │   └── page.tsx             # PERM search
│   ├── sponsor/
│   │   └── [employerId]/
│   │       └── page.tsx         # Sponsor profile
│   ├── ask/
│   │   └── page.tsx             # Ask Intel chat
│   ├── admin/
│   │   ├── layout.tsx           # Admin auth guard
│   │   ├── page.tsx             # Upload dashboard
│   │   └── review/
│   │       └── page.tsx         # Entity reconciliation review
│   └── api/
│       ├── lca/
│       │   └── route.ts         # LCA search API
│       ├── perm/
│       │   └── route.ts         # PERM search API
│       ├── sponsor/
│       │   └── [employerId]/
│       │       └── route.ts     # Sponsor profile API
│       ├── search/
│       │   └── employers/
│       │       └── route.ts     # Employer autocomplete
│       ├── ask/
│       │   └── route.ts         # Ask Intel streaming API
│       ├── salary/
│       │   └── route.ts         # Salary benchmark API
│       └── admin/
│           ├── upload/
│           │   └── route.ts     # File upload trigger
│           └── review/
│               └── route.ts     # Review queue API
├── components/
│   ├── layout/
│   │   ├── Navbar.tsx
│   │   └── Footer.tsx
│   ├── search/
│   │   ├── SearchBar.tsx        # Main home search
│   │   ├── FilterPanel.tsx      # Shared filter panel
│   │   ├── ResultsTable.tsx     # Shared results table
│   │   └── MapView.tsx          # Map visualization
│   ├── sponsor/
│   │   ├── SponsorCard.tsx      # Used in search results
│   │   ├── SponsorScore.tsx     # Score display component
│   │   ├── SponsorCharts.tsx    # Trend charts
│   │   └── GCPipeline.tsx       # Green card pipeline indicator
│   ├── ask/
│   │   ├── ChatInterface.tsx    # Main chat UI
│   │   ├── ChatMessage.tsx      # Individual message
│   │   └── ResultTable.tsx      # Data table in chat response
│   ├── salary/
│   │   └── SalaryBenchmark.tsx  # Salary percentile display
│   └── ui/                      # shadcn components
├── lib/
│   ├── db.ts                    # Neon connection
│   ├── cache.ts                 # Upstash Redis helpers
│   ├── llm.ts                   # DeepSeek/Groq client
│   ├── text-to-sql.ts           # Ask Intel SQL generation
│   └── types.ts                 # Shared TypeScript types
└── hooks/
    ├── useSearch.ts             # LCA/PERM search state
    └── useDebounce.ts           # Input debouncing
```

---

## Screen 1: Home Page (app/page.tsx)

### Purpose
Fast, clean entry point. Communicates what H1BIntel does in 3 seconds.

### Layout
```
┌─────────────────────────────────────────────┐
│  H1BIntel                    [LCA] [PERM] [Ask Intel] │
├─────────────────────────────────────────────┤
│                                             │
│     Find companies that sponsor H1B visas   │
│     Real data from 4M+ DOL filings          │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ 🔍 Search companies, job titles...  │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  [LCA Search]  [PERM Search]  [Ask Intel]  │
│                                             │
│  ── Popular searches ──────────────────    │
│  Google  |  Amazon  |  Software Engineer   │
│  Tata    |  Infosys |  Data Scientist      │
│                                             │
│  ── Stats ─────────────────────────────    │
│  4.2M LCA filings  |  890K PERM filings    │
│  45,000 sponsors   |  Updated FY2025       │
└─────────────────────────────────────────────┘
```

### Behavior
- Typing in search bar → live autocomplete (employers + SOC titles)
- Pressing enter → goes to LCA search with query pre-filled
- Clicking "LCA Search" tile → /lca
- Stats fetched from API and cached for 24h

---

## Screen 2: LCA Search (app/lca/page.tsx)

### Layout
```
┌─────────────────────────────────────────────┐
│ Filters (left sidebar or top bar on mobile) │
│                                             │
│ Company    [________________] autocomplete  │
│ Job Title  [________________] autocomplete  │
│ State      [Dropdown ▼     ]               │
│ Year       [2025 ▼         ]               │
│ Visa Type  [H-1B ▼         ]               │
│ Wage       [$___] to [$___]                │
│ Status     ☑ Certified  ☐ Denied  ☐ Withdrawn│
│ Full time  ☑ Full time only                │
│                                             │
│ [Search]                [Clear filters]     │
├─────────────────────────────────────────────┤
│ 12,450 results  [Table view] [Map view]    │
│ Sort: [Wage ▼]              [Export CSV]   │
├─────────────────────────────────────────────┤
│ Company        │ Title      │ State │ Wage  │
│ Google         │ SWE        │ CA    │$180K  │
│ [Score: 94 ●] │ FY2025     │ MTV   │+12%▲  │
│ ─────────────────────────────────────────  │
│ Amazon         │ Data Sci   │ WA    │$165K  │
│ [Score: 91 ●] │ FY2025     │ SEA   │+8%▲   │
└─────────────────────────────────────────────┘
```

### Table Columns
- Company name (clickable → sponsor profile)
- Sponsor Score badge (colored by tier)
- Job title (canonical)
- Visa type
- Worksite state + city
- Wage offered (annual, formatted)
- Wage vs prevailing (+X% or -X%)
- Wage level (I/II/III/IV)
- Year
- Status badge
- Workers count (if >1)

### Map View
Toggle to show worksite locations as dots on US map.
Dot size = number of filings.
Click dot → show employer name + count in popup.
Use react-map-gl with MapLibre (free, no API key needed).
Map tiles: OpenStreetMap via public tile server.

### Pagination
50 results per page. "Load more" button (not numbered pages).
Show total count.

### Export
CSV download of current filtered results (max 5000 rows).
Include all columns.

---

## Screen 3: PERM Search (app/perm/page.tsx)

### Same pattern as LCA Search with PERM-specific differences:

### Additional Filters
- Country of citizenship (India, China, Mexico, Other, All)
- Was audited (checkbox)
- Prevailing wage source (OES, CBA, Other)

### Additional Columns
- Processing time (days from received to decision)
- Audit indicator
- Wage delta (offered vs prevailing, shows GC intent)
- Country of citizenship

### Special Feature: Cross-reference button
On each row: "See LCA filings →" 
Links to LCA search pre-filtered to same employer.

---

## Screen 4: Sponsor Profile (app/sponsor/[employerId]/page.tsx)

### Layout
```
┌─────────────────────────────────────────────┐
│ ← Back to search                            │
│                                             │
│ Google                           [Direct ▼] │
│ Technology · Mountain View, CA              │
│                                             │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐       │
│ │  94  │ │12.4K │ │ 98% │ │Strong│       │
│ │Score │ │LCAs  │ │Appr.│ │GC   │       │
│ └──────┘ └──────┘ └──────┘ └──────┘       │
├─────────────────────────────────────────────┤
│ Score Breakdown          What this means    │
│ Approval Rate    ████████ 98%  →            │
│ Wage Quality     ███████  92%  →            │
│ GC Pipeline      █████    71%  →            │
│ Consistency      ████████ 95%  →            │
├─────────────────────────────────────────────┤
│ [LCA Trend] [Top Roles] [Salary] [Locations]│
│                                             │
│ LCA Filings by Year (bar chart)             │
│ ████ ████ ████ ████ ████                   │
│ 2021 2022 2023 2024 2025                    │
├─────────────────────────────────────────────┤
│ Top Job Titles           Top States         │
│ 1. Software Developer    1. CA (45%)        │
│ 2. Data Scientist        2. WA (22%)        │
│ 3. Product Manager       3. NY (15%)        │
├─────────────────────────────────────────────┤
│ Green Card Pipeline                         │
│ "Google files PERM for ~18% of H1B workers"│
│ [View PERM filings →]                       │
├─────────────────────────────────────────────┤
│ Recent LCA Filings                [View all]│
│ Software Engineer · CA · $185K · FY2025    │
│ Data Scientist    · WA · $172K · FY2025    │
└─────────────────────────────────────────────┘
```

### Sponsor Score Display
Large number (0-100) with color:
80-100 → green (excellent)
60-79  → blue (good)
40-59  → yellow (fair)
20-39  → orange (poor)
<20    → gray (new/insufficient data)

Show score breakdown as horizontal bar chart.
Tooltip on each bar: "What does this mean?"

### Tabs
1. LCA Trend — filings per year (bar chart)
2. Top Roles — top 10 job titles with counts
3. Salary — wage distribution by title + year
4. Locations — map of worksite concentrations

---

## Screen 5: Ask Intel (app/ask/page.tsx)

### Layout
```
┌─────────────────────────────────────────────┐
│ Ask Intel                     [Clear chat]  │
│ Powered by AI · Data from DOL FY2020-2025   │
├─────────────────────────────────────────────┤
│                                             │
│  Try asking:                                │
│  "Who are the top H1B sponsors in CA?"      │
│  "What does Amazon pay Data Scientists?"    │
│  "Which companies sponsor PERM in Seattle?" │
│  "Compare Google vs Meta H1B approval rates"│
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│  [User message bubble]                      │
│  Who in California filed the most H1Bs      │
│  in 2025?                                   │
│                                             │
│  [AI response]                              │
│  Here are the top H1B sponsors in           │
│  California for FY2025:                     │
│                                             │
│  ┌────────────────────────────────────┐    │
│  │ # │ Company    │ Filings │ Avg Wage│    │
│  │ 1 │ Google     │  3,421  │ $182K  │    │
│  │ 2 │ Apple      │  2,891  │ $175K  │    │
│  │ 3 │ Meta       │  1,654  │ $191K  │    │
│  └────────────────────────────────────┘    │
│                                             │
│  [View full LCA data →]                     │
│                                             │
├─────────────────────────────────────────────┤
│ [Ask a follow-up question...          ] [→] │
└─────────────────────────────────────────────┘
```

### Behavior
- Streaming response (text streams token by token)
- Data tables rendered inline in AI response
- "View full LCA data →" link pre-fills LCA search with relevant filters
- Session stored in localStorage (persists across page refreshes)
- Max 10 messages per session (encourages exploration)

---

## API Routes

### GET /api/lca
```typescript
// Query params:
// employer_id, employer_name, soc_code, state, year, 
// visa_class, wage_min, wage_max, status, full_time_only
// page (default 1), per_page (default 50), sort_by, sort_dir

// Response:
{
  total: number,
  page: number,
  results: LCAFiling[],
  facets: {
    states: {state: string, count: number}[],
    years: {year: number, count: number}[],
    visa_classes: {type: string, count: number}[]
  }
}

// Cache: Upstash Redis, TTL 1 hour
// Key: "lca:" + hash(queryParams)
```

### GET /api/perm
```typescript
// Same pattern as LCA, PERM-specific params:
// citizenship, was_audited, pw_source
```

### GET /api/sponsor/:employerId
```typescript
// Response:
{
  employer: Employer,
  latestStats: SponsorStats,
  historicalStats: SponsorStats[],  // last 5 years
  topTitles: {title: string, count: number, avgWage: number}[],
  topStates: {state: string, count: number}[],
  recentFilings: LCAFiling[],
  gcPipeline: {
    strength: string,
    lcaCount: number,
    permCount: number,
    conversionRate: number
  },
  salaryBenchmarks: SalaryBenchmark[]
}

// Cache: TTL 24 hours
```

### GET /api/search/employers
```typescript
// Autocomplete endpoint
// Query: ?q=goog&limit=10
// Response: {id, canonical_name, hq_state, score_tier}[]
// Cache: TTL 1 hour
// Uses pg_trgm index for fast partial matching
```

### POST /api/ask (streaming)
```typescript
// Body: { question: string, session_id: string, history: Message[] }
// Returns: text/event-stream (SSE)

// Flow:
// 1. Generate SQL from question using LLM
// 2. Validate SQL (read-only, no DROP/DELETE/UPDATE)
// 3. Execute against Neon
// 4. Stream formatted response + data table
// 5. Log to ask_intel_logs table

// SQL generation prompt (in lib/text-to-sql.ts):
// Include: full schema, data nuances, examples, safety rules
```

### GET /api/salary
```typescript
// Query: ?soc_code=15-1252&state=CA&year=2025&level=2
// Response: SalaryBenchmark with percentiles
```

---

## lib/text-to-sql.ts (Ask Intel Brain)

```typescript
const SYSTEM_PROMPT = `
You are a SQL expert for the H1BIntel database.
Generate PostgreSQL queries to answer questions about H1B and PERM filings.

DATABASE SCHEMA:
[include condensed schema here — table names, key columns only]

KEY RULES:
1. ONLY generate SELECT queries. Never INSERT, UPDATE, DELETE, DROP.
2. Always use canonical tables (not staging tables).
3. For employer searches, use ILIKE with canonical_name.
4. Wage statistics: always filter is_full_time=true AND is_amendment=false.
5. Approval rate: certified / (certified + denied) — EXCLUDE withdrawn.
6. For "top sponsors" queries: ORDER BY lca_certified DESC.
7. Always include fiscal_year in WHERE clause unless user says "all time".
8. For salary queries: filter wage_offered_annual > 30000 (exclude anomalies).
9. Join to soc_codes to show human-readable job titles.
10. Join to employers to show canonical company names.
11. Limit results: default 20, max 100.
12. For state queries: use worksite_state not employer HQ state.

Return ONLY valid JSON:
{
  "sql": "SELECT ...",
  "explanation": "One sentence: what this query finds",
  "columns": ["col1", "col2", ...]  // for rendering the table
}
`

export async function generateSQL(question: string, history: Message[]): Promise<SQLResult>
export async function formatAnswer(question: string, rows: any[], columns: string[]): Promise<string>
```

---

## lib/cache.ts

```typescript
// Upstash Redis wrapper
// Pattern: cache-aside (check cache → miss → DB → write cache)

export async function getCached<T>(key: string): Promise<T | null>
export async function setCached<T>(key: string, value: T, ttlSeconds: number): Promise<void>
export async function invalidatePattern(pattern: string): Promise<void>

// Key conventions:
// "lca:{hash}"         TTL: 3600 (1 hour)
// "perm:{hash}"        TTL: 3600
// "sponsor:{id}"       TTL: 86400 (24 hours)
// "autocomplete:{q}"   TTL: 3600
// "salary:{soc}:{state}:{year}" TTL: 86400
// "stats:home"         TTL: 86400 (homepage stats)
```

---

## TypeScript Types (lib/types.ts)

```typescript
export interface LCAFiling {
  id: string
  caseNumber: string
  caseStatus: 'certified' | 'certified_withdrawn' | 'withdrawn' | 'denied'
  employerId: string
  employerName: string
  jobTitleRaw: string
  jobTitleCanonical: string
  socCode: string
  socTitle: string
  wageLevel: 1 | 2 | 3 | 4 | null
  visaClass: string
  isAmendment: boolean
  isFullTime: boolean
  totalWorkers: number
  wageOfferedAnnual: number
  prevailingWage: number
  wageAbovePrevailing: number
  worksiteCity: string
  worksiteState: string
  fiscalYear: number
  calendarYear: number
  decisionDate: string
}

export interface Employer {
  employerId: string
  canonicalName: string
  employerType: 'direct' | 'staffing' | 'nonprofit' | 'government'
  industry: string | null
  hqState: string | null
  isActiveSponsor: boolean
  firstFilingYear: number
  lastFilingYear: number
}

export interface SponsorStats {
  employerId: string
  fiscalYear: number
  lcaTotal: number
  lcaCertified: number
  lcaApprovalRate: number
  permTotal: number
  permCertified: number
  avgWageOffered: number
  medianWageOffered: number
  sponsorScore: number
  scoreTier: 'excellent' | 'good' | 'fair' | 'poor' | 'new'
  gcPipelineStrength: 'strong' | 'moderate' | 'weak' | 'none' | 'staffing'
  topTitles: {title: string, count: number}[]
  topWorksites: {state: string, city: string, count: number}[]
}

export interface SalaryBenchmark {
  socCode: string
  socTitle: string
  worksiteState: string
  fiscalYear: number
  wageLevel: number | null
  sampleSize: number
  p25Wage: number
  p50Wage: number
  p75Wage: number
  avgWage: number
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  dataTable?: {columns: string[], rows: any[][]}
  lcaSearchLink?: string
}
```

---

## Admin Section (app/admin/)

### Auth
Simple middleware: check `Authorization: Bearer {ADMIN_SECRET}` header.
Or check cookie set after password entry on /admin/login.

### Upload Page (app/admin/page.tsx)
```
Upload new DOL data files

LCA File:  [Choose file...] LCA_FY2025_Q4.xlsx
PERM File: [Choose file...] PERM_FY2025.xlsx

[Start Pipeline]

Pipeline Status:
✓ parse_lca         (687,423 rows)
✓ parse_perm        (156,832 rows)  
✓ normalize_lca     (651,209 clean)
→ normalize_perm    (running...)
○ entity_recon
○ title_normalization
○ link_lca_perm
○ compute_scores
○ load_staging
⚠ human_review      (24 items pending)
○ load_production
```

### Review Page (app/admin/review/page.tsx)
```
Entity Reconciliation Review — 24 items

[Approve All High Confidence] [Export JSON]

┌────────────────────────────────────────────────────┐
│ Raw name: "AMAZON WEB SERVICES INC"                │
│ Suggested: Amazon (confidence: 81%)                │
│ Evidence: "AWS is Amazon subsidiary, common filer" │
│                                                    │
│ [✓ Approve: Amazon] [Create New] [Edit name___]   │
└────────────────────────────────────────────────────┘
...

[Apply All Decisions] → triggers load_production stage
```

---

## Design System

### Colors
```css
--brand-blue: #1B4FD8      /* primary actions */
--brand-dark: #0F172A      /* text */
--score-excellent: #16A34A  /* 80-100 */
--score-good: #2563EB       /* 60-79 */
--score-fair: #D97706       /* 40-59 */
--score-poor: #DC2626       /* 20-39 */
--score-new: #6B7280        /* insufficient data */
```

### Typography
- Font: Inter (Google Fonts)
- Headings: font-bold text-gray-900
- Body: text-gray-700
- Muted: text-gray-500

### Key UI Patterns
- Sponsor Score: large circular badge, colored by tier
- Status badges: colored pills (green=certified, red=denied, gray=withdrawn)
- Wage delta: "+12% above prevailing" in green, "-3% below" in red
- Loading: skeleton screens (not spinners)
- Empty state: helpful message + suggested searches
- Error state: friendly message + retry button

---

## Performance Requirements
- Home page: < 1s LCP
- Search results: < 500ms (cached), < 2s (uncached)
- Sponsor profile: < 1s (24h cache)
- Ask Intel first token: < 800ms
- Map loads with results (no separate request)

## SEO
- Static pages: home, sponsor profiles (SSG with ISR)
- Dynamic pages: search results (SSR)
- Meta tags per page (title, description, og:image)
- Sitemap: generate for top 10,000 sponsor profile pages
- robots.txt: allow all

## Accessibility  
- WCAG 2.1 AA
- All interactive elements keyboard accessible
- Color not the only differentiator (icons + text alongside score colors)
- Screen reader friendly table structure

## Mobile
- Breakpoints: mobile (<640px), tablet (640-1024px), desktop (>1024px)
- Search filters: collapsible panel on mobile
- Table: horizontal scroll on mobile with sticky first column
- Map: full-screen on mobile
