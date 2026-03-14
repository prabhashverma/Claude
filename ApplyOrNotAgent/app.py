"""
Immigration Sponsorship Search API — FastAPI backend.
Search employers and see their PERM (green card) and LCA (H-1B) filings.
"""

import sqlite3
from pathlib import Path
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

DB_PATH = Path(__file__).parent / "perm.db"

app = FastAPI(title="Immigration Sponsorship Search")
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
               FILING_COUNT, NAME_VARIANTS,
               COALESCE(LCA_FILING_COUNT, 0) as LCA_FILING_COUNT,
               COALESCE(LCA_TOTAL_POSITIONS, 0) as LCA_TOTAL_POSITIONS
        FROM employer
        WHERE CANONICAL_NAME LIKE ? OR NAME_VARIANTS LIKE ?
        ORDER BY FILING_COUNT DESC
        LIMIT ?
        """,
        (f"%{q}%", f"%{q}%", limit),
    ).fetchall()

    # Check if lca table exists
    has_lca = conn.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='lca'"
    ).fetchone()[0]

    results = []
    for emp in employers:
        emp_dict = dict(emp)
        fein = emp_dict["FEIN"]
        # Get PERM filings
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

        # Get LCA filings
        if has_lca:
            lca_filings = conn.execute(
                """
                SELECT EMPLOYER_NAME, EMPLOYER_CITY, EMPLOYER_STATE,
                       JOB_TITLE, SOC_TITLE, SOC_CODE, WAGE_FROM, WAGE_TO, WAGE_UNIT,
                       CASE_STATUS, FISCAL_YEAR, WORKSITE_CITY, WORKSITE_STATE,
                       ATTORNEY_FIRM, DECISION_DATE, VISA_CLASS,
                       PREVAILING_WAGE, PW_UNIT, PW_WAGE_LEVEL,
                       TOTAL_WORKER_POSITIONS, BEGIN_DATE, END_DATE,
                       TRADE_NAME_DBA, H1B_DEPENDENT
                FROM lca
                WHERE EMPLOYER_FEIN = ?
                ORDER BY DECISION_DATE DESC
                LIMIT 200
                """,
                (fein,),
            ).fetchall()
            emp_dict["lca_filings"] = [dict(f) for f in lca_filings]

        emp_dict["NAME_VARIANTS"] = emp_dict["NAME_VARIANTS"].split("|") if emp_dict["NAME_VARIANTS"] else []
        results.append(emp_dict)

    conn.close()
    return results


@app.get("/api/stats")
def get_stats():
    """DB summary stats for PERM and LCA."""
    conn = get_db()
    perm_total = conn.execute("SELECT COUNT(*) FROM perm").fetchone()[0]
    employers = conn.execute("SELECT COUNT(DISTINCT EMPLOYER_NAME) FROM perm").fetchone()[0]
    fy_counts = conn.execute(
        "SELECT FISCAL_YEAR, COUNT(*) as cnt FROM perm GROUP BY FISCAL_YEAR ORDER BY FISCAL_YEAR"
    ).fetchall()

    result = {
        "perm_records": perm_total,
        "total_records": perm_total,
        "unique_employers": employers,
        "by_fiscal_year": {r[0]: r[1] for r in fy_counts},
    }

    # LCA stats
    has_lca = conn.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='lca'"
    ).fetchone()[0]
    if has_lca:
        lca_total = conn.execute("SELECT COUNT(*) FROM lca").fetchone()[0]
        result["lca_records"] = lca_total
        result["total_records"] = perm_total + lca_total
        lca_fy = conn.execute(
            "SELECT FISCAL_YEAR, COUNT(*) as cnt FROM lca GROUP BY FISCAL_YEAR ORDER BY FISCAL_YEAR"
        ).fetchall()
        result["lca_by_fiscal_year"] = {r[0]: r[1] for r in lca_fy}
        visa_counts = conn.execute(
            "SELECT VISA_CLASS, COUNT(*) as cnt FROM lca GROUP BY VISA_CLASS ORDER BY cnt DESC"
        ).fetchall()
        result["lca_by_visa_class"] = {r[0]: r[1] for r in visa_counts}

    conn.close()
    return result


# Serve frontend
app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")


@app.get("/")
def serve_frontend():
    return FileResponse(Path(__file__).parent / "static" / "index.html")
