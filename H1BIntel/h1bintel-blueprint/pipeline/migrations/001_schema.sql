-- H1BIntel Database Schema
-- Run on Neon Postgres before anything else
-- File: pipeline/migrations/001_schema.sql

-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- trigram search
CREATE EXTENSION IF NOT EXISTS "vector";     -- pgvector for RAG

-- ============================================================
-- REFERENCE TABLES
-- ============================================================

-- Canonical SOC occupations (loaded from BLS crosswalk)
CREATE TABLE soc_codes (
    soc_code            VARCHAR(10) PRIMARY KEY,  -- e.g. "15-1252"
    soc_title           TEXT NOT NULL,            -- "Software Developers"
    soc_group           TEXT,                     -- "Computer and Mathematical"
    soc_major_group     TEXT,                     -- "15-0000"
    soc_version         SMALLINT DEFAULT 2018,    -- 2010 or 2018
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- SOC 2010 → 2018 crosswalk for historical data
CREATE TABLE soc_crosswalk (
    soc_2010            VARCHAR(10),
    soc_2018            VARCHAR(10) REFERENCES soc_codes(soc_code),
    crosswalk_note      TEXT,
    PRIMARY KEY (soc_2010, soc_2018)
);

-- US states reference
CREATE TABLE states (
    state_code          CHAR(2) PRIMARY KEY,      -- "CA"
    state_name          TEXT NOT NULL,            -- "California"
    region              TEXT,                     -- "West"
    division            TEXT                      -- "Pacific"
);

-- ============================================================
-- EMPLOYERS (Canonical, deduplicated)
-- ============================================================
CREATE TABLE employers (
    employer_id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    canonical_name      TEXT NOT NULL,
    canonical_name_lower TEXT GENERATED ALWAYS AS (LOWER(canonical_name)) STORED,
    
    -- Classification
    employer_type       TEXT CHECK (employer_type IN (
                            'direct',       -- hires worker directly
                            'staffing',     -- consulting/body shop
                            'nonprofit',    -- universities, hospitals
                            'government'    -- rare but exists
                        )) DEFAULT 'direct',
    industry            TEXT,
    naics_code          VARCHAR(6),
    
    -- Location (HQ)
    hq_city             TEXT,
    hq_state            CHAR(2) REFERENCES states(state_code),
    hq_country          VARCHAR(3) DEFAULT 'USA',
    
    -- Metadata
    is_active_sponsor   BOOLEAN DEFAULT TRUE,    -- filed in last 2 years
    first_filing_year   SMALLINT,
    last_filing_year    SMALLINT,
    
    -- Reconciliation tracking
    name_variants       TEXT[],                  -- all raw names seen
    reconciliation_confidence NUMERIC(4,3),      -- LLM confidence score
    manually_verified   BOOLEAN DEFAULT FALSE,
    
    -- Timestamps
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for employer search
CREATE INDEX idx_employers_canonical_lower ON employers(canonical_name_lower);
CREATE INDEX idx_employers_trgm ON employers USING gin(canonical_name gin_trgm_ops);
CREATE INDEX idx_employers_state ON employers(hq_state);
CREATE INDEX idx_employers_active ON employers(is_active_sponsor);
CREATE INDEX idx_employers_type ON employers(employer_type);

-- ============================================================
-- LCA FILINGS (H-1B, H-1B1, E-3)
-- ============================================================
CREATE TABLE lca_filings (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- DOL identifiers
    case_number         TEXT NOT NULL UNIQUE,    -- DOL case number
    case_status         TEXT NOT NULL CHECK (case_status IN (
                            'certified',
                            'certified_withdrawn',
                            'withdrawn',
                            'denied'
                        )),
    
    -- Employer
    employer_id         UUID REFERENCES employers(employer_id),
    employer_name_raw   TEXT NOT NULL,           -- original from DOL
    
    -- Job details
    job_title_raw       TEXT NOT NULL,
    job_title_canonical TEXT,                    -- normalized
    soc_code            VARCHAR(10) REFERENCES soc_codes(soc_code),
    wage_level          SMALLINT CHECK (wage_level BETWEEN 1 AND 4),
    
    -- Visa type
    visa_class          TEXT NOT NULL CHECK (visa_class IN (
                            'H-1B', 'H-1B1 Chile', 'H-1B1 Singapore', 'E-3'
                        )),
    is_amendment        BOOLEAN DEFAULT FALSE,   -- amended filing flag
    is_new_employment   BOOLEAN DEFAULT TRUE,
    is_full_time        BOOLEAN DEFAULT TRUE,
    
    -- Workers
    total_workers       SMALLINT DEFAULT 1,      -- can cover multiple
    
    -- Wages (all normalized to annual)
    wage_offered_annual NUMERIC(12,2),
    wage_offered_raw    NUMERIC(12,2),           -- original amount
    wage_unit_raw       TEXT,                    -- Year/Hour/Week/Month
    prevailing_wage     NUMERIC(12,2),
    prevailing_wage_level SMALLINT,
    wage_above_prevailing NUMERIC(12,2) GENERATED ALWAYS AS 
                        (wage_offered_annual - prevailing_wage) STORED,
    
    -- Location (WORKSITE, not HQ — critical distinction)
    worksite_city       TEXT,
    worksite_state      CHAR(2) REFERENCES states(state_code),
    worksite_postal     VARCHAR(10),
    
    -- Dates
    fiscal_year         SMALLINT NOT NULL,       -- DOL fiscal year
    calendar_year       SMALLINT NOT NULL,       -- derived for UI
    decision_date       DATE,
    employment_start    DATE,
    employment_end      DATE,
    
    -- Embeddings (for RAG / semantic search)
    embedding           vector(1536),            -- for future RAG
    
    -- Pipeline metadata
    source_file         TEXT,                    -- which xlsx file
    loaded_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast search
CREATE INDEX idx_lca_employer ON lca_filings(employer_id);
CREATE INDEX idx_lca_soc ON lca_filings(soc_code);
CREATE INDEX idx_lca_state ON lca_filings(worksite_state);
CREATE INDEX idx_lca_fiscal_year ON lca_filings(fiscal_year);
CREATE INDEX idx_lca_calendar_year ON lca_filings(calendar_year);
CREATE INDEX idx_lca_status ON lca_filings(case_status);
CREATE INDEX idx_lca_visa_class ON lca_filings(visa_class);
CREATE INDEX idx_lca_wage ON lca_filings(wage_offered_annual);
CREATE INDEX idx_lca_full_time ON lca_filings(is_full_time);
CREATE INDEX idx_lca_amendment ON lca_filings(is_amendment);
CREATE INDEX idx_lca_title_trgm ON lca_filings USING gin(job_title_canonical gin_trgm_ops);

-- Compound indexes for common query patterns
CREATE INDEX idx_lca_employer_year ON lca_filings(employer_id, fiscal_year);
CREATE INDEX idx_lca_soc_state_year ON lca_filings(soc_code, worksite_state, fiscal_year);
CREATE INDEX idx_lca_employer_status ON lca_filings(employer_id, case_status);

-- ============================================================
-- PERM FILINGS (Green Card Labor Certification)
-- ============================================================
CREATE TABLE perm_filings (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- DOL identifiers
    case_number         TEXT NOT NULL UNIQUE,
    case_status         TEXT NOT NULL CHECK (case_status IN (
                            'certified',
                            'denied',
                            'withdrawn',
                            'certified_expired'
                        )),
    
    -- Employer
    employer_id         UUID REFERENCES employers(employer_id),
    employer_name_raw   TEXT NOT NULL,
    
    -- Job details
    job_title_raw       TEXT NOT NULL,
    job_title_canonical TEXT,
    soc_code            VARCHAR(10) REFERENCES soc_codes(soc_code),
    
    -- Education & experience requirements
    education_level     TEXT,                    -- Bachelor's, Master's etc
    experience_required SMALLINT,               -- years required
    
    -- Is this for a specific foreign worker? (person-specific PERM)
    is_person_specific  BOOLEAN DEFAULT FALSE,
    worker_citizenship  VARCHAR(3),              -- country code (from PERM data)
    
    -- Wages
    wage_offered_annual NUMERIC(12,2),
    prevailing_wage     NUMERIC(12,2),
    prevailing_wage_source TEXT,                -- OES, CBA, SCA, Other
    wage_above_prevailing NUMERIC(12,2) GENERATED ALWAYS AS
                        (wage_offered_annual - prevailing_wage) STORED,
    
    -- Location
    worksite_city       TEXT,
    worksite_state      CHAR(2) REFERENCES states(state_code),
    worksite_postal     VARCHAR(10),
    
    -- Dates
    fiscal_year         SMALLINT NOT NULL,
    calendar_year       SMALLINT NOT NULL,
    decision_date       DATE,
    received_date       DATE,
    processing_days     INTEGER GENERATED ALWAYS AS
                        (decision_date - received_date) STORED,
    
    -- Audit info
    was_audited         BOOLEAN DEFAULT FALSE,
    audit_response_date DATE,
    
    -- Embeddings
    embedding           vector(1536),
    
    -- Pipeline metadata
    source_file         TEXT,
    loaded_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_perm_employer ON perm_filings(employer_id);
CREATE INDEX idx_perm_soc ON perm_filings(soc_code);
CREATE INDEX idx_perm_state ON perm_filings(worksite_state);
CREATE INDEX idx_perm_fiscal_year ON perm_filings(fiscal_year);
CREATE INDEX idx_perm_status ON perm_filings(case_status);
CREATE INDEX idx_perm_citizenship ON perm_filings(worker_citizenship);
CREATE INDEX idx_perm_employer_year ON perm_filings(employer_id, fiscal_year);

-- ============================================================
-- LCA ↔ PERM LINKS (Green Card Pipeline)
-- ============================================================
CREATE TABLE lca_perm_links (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employer_id         UUID NOT NULL REFERENCES employers(employer_id),
    soc_code            VARCHAR(10) REFERENCES soc_codes(soc_code),
    worksite_state      CHAR(2),
    
    -- Counts for this employer+soc+state combination
    lca_count           INTEGER DEFAULT 0,
    perm_count          INTEGER DEFAULT 0,
    
    -- Year window used for matching
    lca_year_start      SMALLINT,
    lca_year_end        SMALLINT,
    perm_year_start     SMALLINT,
    perm_year_end       SMALLINT,
    
    -- Link quality
    link_strength       TEXT CHECK (link_strength IN ('strong','medium','weak')),
    conversion_rate     NUMERIC(5,4),            -- perm/lca ratio
    
    computed_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_links_employer ON lca_perm_links(employer_id);

-- ============================================================
-- SPONSOR STATS (Precomputed per employer per year)
-- ============================================================
CREATE TABLE sponsor_stats (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employer_id         UUID NOT NULL REFERENCES employers(employer_id),
    fiscal_year         SMALLINT NOT NULL,
    
    -- LCA stats (exclude amendments for accuracy)
    lca_total           INTEGER DEFAULT 0,
    lca_certified       INTEGER DEFAULT 0,
    lca_withdrawn       INTEGER DEFAULT 0,
    lca_denied          INTEGER DEFAULT 0,
    lca_certified_withdrawn INTEGER DEFAULT 0,
    lca_approval_rate   NUMERIC(5,4),            -- certified / (certified + denied)
    
    -- PERM stats
    perm_total          INTEGER DEFAULT 0,
    perm_certified      INTEGER DEFAULT 0,
    perm_denied         INTEGER DEFAULT 0,
    perm_withdrawn      INTEGER DEFAULT 0,
    perm_approval_rate  NUMERIC(5,4),
    
    -- Worker counts
    total_workers_sponsored INTEGER DEFAULT 0,
    
    -- Salary stats (full-time only, exclude part-time)
    avg_wage_offered    NUMERIC(12,2),
    median_wage_offered NUMERIC(12,2),
    p25_wage            NUMERIC(12,2),
    p75_wage            NUMERIC(12,2),
    avg_prevailing_wage NUMERIC(12,2),
    avg_wage_premium    NUMERIC(12,2),           -- avg above prevailing
    
    -- Top job titles (JSON array of {title, count})
    top_titles          JSONB,
    
    -- Top worksites (JSON array of {state, city, count})
    top_worksites       JSONB,
    
    -- Top SOC codes
    top_soc_codes       JSONB,
    
    -- GC pipeline
    perm_conversion_rate NUMERIC(5,4),           -- 3-year rolling
    gc_pipeline_strength TEXT CHECK (gc_pipeline_strength IN (
                            'strong', 'moderate', 'weak', 'none', 'staffing'
                        )),
    
    -- Sponsor Score (0-100)
    sponsor_score       NUMERIC(5,2),
    score_breakdown     JSONB,                   -- component scores
    score_tier          TEXT CHECK (score_tier IN (
                            'excellent',  -- 80-100
                            'good',       -- 60-79
                            'fair',       -- 40-59
                            'poor',       -- 20-39
                            'new'         -- insufficient data
                        )),
    
    computed_at         TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(employer_id, fiscal_year)
);

CREATE INDEX idx_stats_employer ON sponsor_stats(employer_id);
CREATE INDEX idx_stats_year ON sponsor_stats(fiscal_year);
CREATE INDEX idx_stats_score ON sponsor_stats(sponsor_score DESC);
CREATE INDEX idx_stats_tier ON sponsor_stats(score_tier);

-- ============================================================
-- SALARY BENCHMARKS (Precomputed per SOC per state per year)
-- ============================================================
CREATE TABLE salary_benchmarks (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    soc_code            VARCHAR(10) REFERENCES soc_codes(soc_code),
    worksite_state      CHAR(2) REFERENCES states(state_code),
    fiscal_year         SMALLINT NOT NULL,
    wage_level          SMALLINT,                -- NULL = all levels
    
    -- From LCA data (full-time only)
    sample_size         INTEGER,
    p10_wage            NUMERIC(12,2),
    p25_wage            NUMERIC(12,2),
    p50_wage            NUMERIC(12,2),           -- median
    p75_wage            NUMERIC(12,2),
    p90_wage            NUMERIC(12,2),
    avg_wage            NUMERIC(12,2),
    
    -- DOL prevailing wage for comparison
    dol_prevailing_wage NUMERIC(12,2),
    
    computed_at         TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(soc_code, worksite_state, fiscal_year, wage_level)
);

CREATE INDEX idx_benchmarks_soc_state ON salary_benchmarks(soc_code, worksite_state);
CREATE INDEX idx_benchmarks_year ON salary_benchmarks(fiscal_year);

-- ============================================================
-- PIPELINE STATE (Resumability)
-- ============================================================
CREATE TABLE pipeline_runs (
    run_id              TEXT PRIMARY KEY,        -- e.g. "FY2025_Q4_20250314"
    status              TEXT CHECK (status IN (
                            'running', 'paused_for_review', 
                            'completed', 'failed'
                        )),
    lca_source_file     TEXT,
    perm_source_file    TEXT,
    
    completed_stages    TEXT[] DEFAULT '{}',
    current_stage       TEXT,
    
    -- Stats
    lca_rows_raw        INTEGER,
    lca_rows_clean      INTEGER,
    perm_rows_raw       INTEGER,
    perm_rows_clean     INTEGER,
    new_employers       INTEGER,
    updated_employers   INTEGER,
    review_items_count  INTEGER DEFAULT 0,
    
    -- Errors log
    errors              JSONB DEFAULT '[]',
    
    started_at          TIMESTAMPTZ DEFAULT NOW(),
    completed_at        TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ENTITY RECONCILIATION REVIEW QUEUE
-- ============================================================
CREATE TABLE reconciliation_queue (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id              TEXT REFERENCES pipeline_runs(run_id),
    
    review_type         TEXT CHECK (review_type IN (
                            'entity_match',      -- employer name matching
                            'title_ambiguous',   -- job title unclear
                            'wage_anomaly',      -- suspicious wage value
                            'new_employer'       -- never seen before
                        )),
    
    -- The raw value from DOL
    raw_value           TEXT NOT NULL,
    
    -- LLM suggestion
    suggested_canonical TEXT,
    suggested_id        UUID,
    confidence          NUMERIC(4,3),
    llm_evidence        TEXT,
    
    -- Human decision
    status              TEXT CHECK (status IN (
                            'pending',
                            'approved',
                            'rejected',
                            'edited'
                        )) DEFAULT 'pending',
    final_canonical     TEXT,
    final_id            UUID,
    reviewed_by         TEXT DEFAULT 'admin',
    reviewed_at         TIMESTAMPTZ,
    
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_queue_run ON reconciliation_queue(run_id);
CREATE INDEX idx_queue_status ON reconciliation_queue(status);

-- ============================================================
-- ASK INTEL — Conversation Logs
-- ============================================================
CREATE TABLE ask_intel_logs (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id          TEXT NOT NULL,           -- anonymous cookie
    
    question            TEXT NOT NULL,
    sql_generated       TEXT,                    -- for debugging
    answer              TEXT,
    result_row_count    INTEGER,
    
    -- Performance
    model_used          TEXT,                    -- deepseek/groq
    tokens_input        INTEGER,
    tokens_output       INTEGER,
    latency_ms          INTEGER,
    
    -- Quality signals
    was_sql_valid       BOOLEAN,
    had_error           BOOLEAN DEFAULT FALSE,
    error_message       TEXT,
    
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_intel_session ON ask_intel_logs(session_id);
CREATE INDEX idx_intel_created ON ask_intel_logs(created_at DESC);

-- ============================================================
-- SEARCH ANALYTICS
-- ============================================================
CREATE TABLE search_events (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id          TEXT,
    search_type         TEXT CHECK (search_type IN ('lca', 'perm', 'employer', 'ask_intel')),
    
    -- Filter values used
    query_text          TEXT,
    filter_employer     TEXT,
    filter_soc          TEXT,
    filter_state        TEXT,
    filter_year         SMALLINT,
    filter_visa_class   TEXT,
    filter_wage_min     NUMERIC,
    filter_wage_max     NUMERIC,
    
    result_count        INTEGER,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_search_type ON search_events(search_type);
CREATE INDEX idx_search_created ON search_events(created_at DESC);

-- ============================================================
-- STAGING TABLES (for zero-downtime uploads)
-- Mirror of main tables, pipeline writes here first
-- ============================================================
CREATE TABLE lca_filings_staging (LIKE lca_filings INCLUDING ALL);
CREATE TABLE perm_filings_staging (LIKE perm_filings INCLUDING ALL);
CREATE TABLE employers_staging (LIKE employers INCLUDING ALL);
CREATE TABLE sponsor_stats_staging (LIKE sponsor_stats INCLUDING ALL);
CREATE TABLE salary_benchmarks_staging (LIKE salary_benchmarks INCLUDING ALL);

-- ============================================================
-- VIEWS (convenience for API queries)
-- ============================================================

-- Active sponsors with latest scores
CREATE VIEW v_active_sponsors AS
SELECT 
    e.employer_id,
    e.canonical_name,
    e.employer_type,
    e.hq_state,
    s.fiscal_year,
    s.lca_total,
    s.lca_certified,
    s.lca_approval_rate,
    s.perm_total,
    s.perm_certified,
    s.avg_wage_offered,
    s.sponsor_score,
    s.score_tier,
    s.gc_pipeline_strength,
    s.top_titles,
    s.top_worksites
FROM employers e
JOIN sponsor_stats s ON e.employer_id = s.employer_id
WHERE e.is_active_sponsor = TRUE
  AND s.fiscal_year = (SELECT MAX(fiscal_year) FROM sponsor_stats);

-- Salary benchmark view with SOC titles
CREATE VIEW v_salary_benchmarks AS
SELECT
    sb.*,
    sc.soc_title,
    sc.soc_group
FROM salary_benchmarks sb
JOIN soc_codes sc ON sb.soc_code = sc.soc_code;

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Atomic swap for zero-downtime upload
CREATE OR REPLACE FUNCTION swap_staging_to_production()
RETURNS void AS $$
BEGIN
    -- Employers
    ALTER TABLE employers RENAME TO employers_old;
    ALTER TABLE employers_staging RENAME TO employers;
    DROP TABLE employers_old;
    CREATE TABLE employers_staging (LIKE employers INCLUDING ALL);
    
    -- LCA
    ALTER TABLE lca_filings RENAME TO lca_filings_old;
    ALTER TABLE lca_filings_staging RENAME TO lca_filings;
    DROP TABLE lca_filings_old;
    CREATE TABLE lca_filings_staging (LIKE lca_filings INCLUDING ALL);
    
    -- PERM
    ALTER TABLE perm_filings RENAME TO perm_filings_old;
    ALTER TABLE perm_filings_staging RENAME TO perm_filings;
    DROP TABLE perm_filings_old;
    CREATE TABLE perm_filings_staging (LIKE perm_filings INCLUDING ALL);
    
    -- Stats
    ALTER TABLE sponsor_stats RENAME TO sponsor_stats_old;
    ALTER TABLE sponsor_stats_staging RENAME TO sponsor_stats;
    DROP TABLE sponsor_stats_old;
    CREATE TABLE sponsor_stats_staging (LIKE sponsor_stats INCLUDING ALL);
    
    -- Benchmarks
    ALTER TABLE salary_benchmarks RENAME TO salary_benchmarks_old;
    ALTER TABLE salary_benchmarks_staging RENAME TO salary_benchmarks;
    DROP TABLE salary_benchmarks_old;
    CREATE TABLE salary_benchmarks_staging (LIKE salary_benchmarks INCLUDING ALL);
END;
$$ LANGUAGE plpgsql;

-- Update employer active status
CREATE OR REPLACE FUNCTION refresh_active_sponsors()
RETURNS void AS $$
BEGIN
    UPDATE employers
    SET is_active_sponsor = (
        last_filing_year >= EXTRACT(YEAR FROM NOW()) - 2
    );
END;
$$ LANGUAGE plpgsql;
