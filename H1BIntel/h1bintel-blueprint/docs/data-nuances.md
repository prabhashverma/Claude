# H1BIntel — DOL Data Nuances
# Every agent and API must handle these correctly

## LCA-Specific Nuances

### 1. One LCA = Multiple Workers
TOTAL_WORKERS field indicates how many workers are covered.
Never count LCA rows as worker count — always sum TOTAL_WORKERS.
Display: "12,450 LCA filings covering 18,230 workers"

### 2. Amended Filings Inflate Counts
VISA_CLASS contains "H-1B" or "H-1B Amendment" or "H-1B1" etc.
Flag is_amendment = TRUE if VISA_CLASS contains "Amendment".
Strip "Amendment" suffix before storing visa_class.
Exclude amendments from:
- Primary filing counts
- Approval rate calculations
- Trend charts (show note: "excludes amendments")
Include amendments in:
- Full data export
- Raw search results (with amendment badge)

### 3. Worksite ≠ Employer HQ (Critical)
EMPLOYER_CITY/STATE = company headquarters (where mail goes)
WORKSITE_CITY/STATE = where the actual work happens
ALWAYS use worksite for:
- Map visualization
- "Top states" analysis
- "H1B jobs in California" queries
NEVER use employer address for geographic features.
Note: Consulting firms file LCAs with client sites as worksites.

### 4. Withdrawn ≠ Denied
WITHDRAWN = employer pulled the application
Reasons: hired someone else, worker got different visa, cancelled role
DENIED = DOL actually rejected it (much rarer for H-1B)
Approval rate formula:
  approved / (approved + denied)  ← CORRECT
  approved / total                ← WRONG (penalizes good employers who withdraw)

### 5. Part-Time Wages are Misleading
is_full_time = FALSE → wage is for part-time role
$60,000/yr for part-time ≠ $60,000/yr for full-time
Rules:
- Store part-time records but flag them
- EXCLUDE from salary benchmarks
- EXCLUDE from wage competitiveness scoring
- INCLUDE in full data export with clear part-time label

### 6. Wage Levels Matter for Comparison
Level I   = entry level (bottom 17th percentile of OES)
Level II  = qualified worker (between 17th and 34th percentile)
Level III = experienced (between 34th and 50th percentile)
Level IV  = fully competent (above 50th percentile)
Never compare wages without controlling for level.
"Google pays $180K" is meaningless without knowing it's Level III.
Salary benchmarks MUST be segmented by wage level.

### 7. Fiscal Year vs Calendar Year Confusion
DOL Fiscal Year: October 1 → September 30
FY2025 = October 1, 2024 → September 30, 2025
Users think in calendar years. Always show:
- "FY2025 (Oct 2024 – Sep 2025)" on first reference
- Use decision_date year for calendar_year field
- In UI, default display to fiscal year (matches DOL data)

### 8. Employment Begin Date Lag
EMPLOYMENT_START_DATE can be months after DECISION_DATE
A case decided in March 2025 might not start until October 2025.
For "active sponsors" definition: use last_filing_year (decision year),
not employment start year.

### 9. H-1B1 and E-3 are Different Visas
H-1B1 Chile / H-1B1 Singapore = special treaty visas, not H-1B cap subject
E-3 = Australian nationals only
Much lower volume than H-1B.
Keep separate in data but include in LCA search by default.
Allow filter by visa type.

### 10. Consulting Firm Problem
Companies like TCS, Infosys, Wipro, Cognizant file thousands of LCAs.
Their worksites = their clients' offices (Google, JPMorgan, etc.)
If user searches "Google", they won't find TCS workers at Google.
This is a known limitation — document it clearly in UI.
Future feature: "Also see consulting firms working at Google" section.

---

## PERM-Specific Nuances

### 11. PERM Has Multi-Year Lifecycle
Filed → (possible audit) → Certified/Denied
Timeline: 6 months to 3 years depending on audit
"Denied" PERM often means "audit requested, employer gave up"
Not a true denial — classify separately if AUDIT_COMPLETION field shows audit.
was_audited flag: check if audit fields are populated.

### 12. Person-Specific vs Generic PERM
FOREIGN_WORKER_INFO fields populated = PERM for specific H-1B worker
No foreign worker info = generic PERM for future hire
Person-specific = employer already has the worker on H-1B
Generic = building a pipeline
This distinction is important for GC pipeline analysis.
Currently: flag is_person_specific based on presence of foreign worker education field.

### 13. Country of Citizenship = Backlog Intelligence
COUNTRY_OF_CITIZENSHIP field in PERM
India and China nationals face 50+ year green card backlogs
This is the only DOL dataset with nationality information
Use for: "What % of [employer]'s PERM filings are for Indian nationals?"
Note: country not available in LCA data

### 14. Prevailing Wage Source Affects Analysis
PW_SOURCE values: OES, CBA (union), SCA, Other
OES = Bureau of Labor Statistics (standard for most companies)
CBA = Collective Bargaining Agreement (usually higher)
When comparing wages: ideally compare within same PW_SOURCE.
For simplicity: note PW_SOURCE when showing wage delta.

### 15. PERM Wages vs LCA Wages
PERM wages are often set 2-4 years before the worker is certified.
They may lag current market rates.
Don't compare PERM wages directly to current LCA wages.
Clearly label year when showing PERM wage data.

---

## Cross-Dataset Nuances

### 16. No Shared Key Between LCA and PERM
DOL does not provide a case number that links an LCA to its PERM.
The linker agent creates probabilistic links:
Match on: employer_id + soc_code + worksite_state + year_window(±2yr)
This is a BEST ESTIMATE, not exact.
Label GC pipeline stats as "estimated" in the UI.

### 17. Employer Name Inconsistency is Severe
Same employer can appear 20+ different ways across years.
Pre-2020 data especially inconsistent.
Entity reconciliation (pipeline stage 5) handles this.
After reconciliation, always query by employer_id, never by name string.

### 18. SOC Code Version Change in FY2020
Pre-FY2020: SOC 2010 codes (e.g., "15-1132" for Software Developers)
FY2020+: SOC 2018 codes (e.g., "15-1252" for same occupation)
Cross-year queries MUST map via soc_crosswalk table.
Always store the normalized soc_code (2018 version) in cleaned tables.
Store raw soc_code_raw for debugging.

### 19. Geographic Inconsistency Over Years
Pre-2020: Some records have state names ("California"), some have codes ("CA")
Normalizer handles this.
Some records have no worksite (especially older data) — set to NULL, don't default to HQ.

### 20. Data Completeness Varies by Year
FY2020+ data from FLAG system is more complete than pre-2020.
Pre-2020 data may lack: wage levels, total workers, worksite details.
Add data_completeness flag to UI: "Full data" (FY2020+) vs "Partial data" (pre-FY2020).

---

## UI Communication Guidelines

These nuances should be surfaced to users clearly:

1. Show "FY2025 (Oct 2024 – Sep 2025)" not just "FY2025"
2. Show "Approval rate excludes withdrawals" tooltip on rate display
3. Show "Salary data: full-time positions only, Level II–III" on benchmarks  
4. Show "Location = worksite, not company HQ" note on map
5. Show "Includes H-1B, H-1B1, E-3" on LCA search
6. Show "Green card pipeline is estimated" on GC pipeline section
7. Show amendment count separately: "12,450 original filings + 890 amendments"
8. Show "Data source: US DOL OFLC Disclosure Data" with link in footer
