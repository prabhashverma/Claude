"""
PERM Data Search API — FastAPI backend.
Search employers and see their PERM filings (jobs + salaries).
"""

import sqlite3
from pathlib import Path
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

DB_PATH = Path(__file__).parent / "perm.db"

app = FastAPI(title="PERM Search")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


@app.get("/api/search")
def search_employer(q: str = Query(..., min_length=2), limit: int = Query(50, le=200)):
    """Search employers by name. Returns jobs + salaries grouped by employer."""
    conn = get_db()
    rows = conn.execute(
        """
        SELECT EMPLOYER_NAME, EMPLOYER_CITY, EMPLOYER_STATE, EMPLOYER_NUM_EMPLOYEES,
               JOB_TITLE, SOC_TITLE, SOC_CODE, WAGE_FROM, WAGE_TO, WAGE_UNIT,
               CASE_STATUS, FISCAL_YEAR, WORKSITE_CITY, WORKSITE_STATE,
               ATTORNEY_FIRM, NAICS_CODE, DECISION_DATE
        FROM perm
        WHERE EMPLOYER_NAME LIKE ?
        ORDER BY DECISION_DATE DESC
        LIMIT ?
        """,
        (f"%{q}%", limit),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/employer/{name}")
def get_employer(name: str, limit: int = Query(100, le=500)):
    """Get all filings for a specific employer (exact match)."""
    conn = get_db()
    rows = conn.execute(
        """
        SELECT EMPLOYER_NAME, EMPLOYER_CITY, EMPLOYER_STATE, EMPLOYER_NUM_EMPLOYEES,
               JOB_TITLE, SOC_TITLE, SOC_CODE, WAGE_FROM, WAGE_TO, WAGE_UNIT,
               CASE_STATUS, FISCAL_YEAR, WORKSITE_CITY, WORKSITE_STATE,
               ATTORNEY_FIRM, NAICS_CODE, DECISION_DATE
        FROM perm
        WHERE EMPLOYER_NAME = ?
        ORDER BY DECISION_DATE DESC
        LIMIT ?
        """,
        (name, limit),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/employer-search")
def employer_search(q: str = Query(..., min_length=2), limit: int = Query(50, le=200)):
    """Search via employer reference table (FEIN-based entity resolution).
    Returns employers with all filings grouped by FEIN."""
    conn = get_db()

    # Check if employer table exists
    has_employer_table = conn.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='employer'"
    ).fetchone()[0]

    if not has_employer_table:
        # Fall back to basic search
        conn.close()
        return search_employer(q, limit)

    # Search employer reference table
    employers = conn.execute(
        """
        SELECT FEIN, CANONICAL_NAME, CITY, STATE, NAICS_CODE, NUM_EMPLOYEES,
               FILING_COUNT, NAME_VARIANTS
        FROM employer
        WHERE CANONICAL_NAME LIKE ? OR NAME_VARIANTS LIKE ?
        ORDER BY FILING_COUNT DESC
        LIMIT ?
        """,
        (f"%{q}%", f"%{q}%", limit),
    ).fetchall()

    results = []
    for emp in employers:
        emp_dict = dict(emp)
        fein = emp_dict["FEIN"]
        # Get all filings for this FEIN
        filings = conn.execute(
            """
            SELECT EMPLOYER_NAME, EMPLOYER_CITY, EMPLOYER_STATE, EMPLOYER_NUM_EMPLOYEES,
                   JOB_TITLE, SOC_TITLE, SOC_CODE, WAGE_FROM, WAGE_TO, WAGE_UNIT,
                   CASE_STATUS, FISCAL_YEAR, WORKSITE_CITY, WORKSITE_STATE,
                   ATTORNEY_FIRM, NAICS_CODE, DECISION_DATE, EMPLOYER_FEIN
            FROM perm
            WHERE EMPLOYER_FEIN = ?
            ORDER BY DECISION_DATE DESC
            LIMIT 200
            """,
            (fein,),
        ).fetchall()
        emp_dict["filings"] = [dict(f) for f in filings]
        emp_dict["NAME_VARIANTS"] = emp_dict["NAME_VARIANTS"].split("|") if emp_dict["NAME_VARIANTS"] else []
        results.append(emp_dict)

    conn.close()
    return results


@app.get("/api/stats")
def get_stats():
    """DB summary stats."""
    conn = get_db()
    total = conn.execute("SELECT COUNT(*) FROM perm").fetchone()[0]
    employers = conn.execute("SELECT COUNT(DISTINCT EMPLOYER_NAME) FROM perm").fetchone()[0]
    fy_counts = conn.execute(
        "SELECT FISCAL_YEAR, COUNT(*) as cnt FROM perm GROUP BY FISCAL_YEAR ORDER BY FISCAL_YEAR"
    ).fetchall()
    conn.close()
    return {
        "total_records": total,
        "unique_employers": employers,
        "by_fiscal_year": {r[0]: r[1] for r in fy_counts},
    }


# Serve frontend
app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")


@app.get("/")
def serve_frontend():
    return FileResponse(Path(__file__).parent / "static" / "index.html")
