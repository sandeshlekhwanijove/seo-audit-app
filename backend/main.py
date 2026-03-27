"""
main.py — FastAPI application for the SEO Audit tool.
Replaces the Flask web layer from master_analyser.py.
"""
from __future__ import annotations

import io
import os
import threading
import uuid
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, HttpUrl, field_validator

import auditor

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------
app = FastAPI(
    title="SEO Audit API",
    description="Technical SEO crawler powered by Playwright",
    version="2.0.0",
)

# Allow the Next.js frontend (localhost:3000 in dev, Vercel URL in prod)
_ALLOWED_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:3000,http://localhost:3001"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS + ["*"],   # tighten in production via env var
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# In-memory job store  (swap for Redis if you scale horizontally)
# ---------------------------------------------------------------------------
_JOBS: dict[str, dict] = {}
_JOBS_LOCK = threading.Lock()


def _get_job(job_id: str) -> dict:
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def _update_job(job_id: str, **kwargs):
    with _JOBS_LOCK:
        if job_id in _JOBS:
            _JOBS[job_id].update(kwargs)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class AuditRequest(BaseModel):
    url: str
    mode: str = "site"        # "page" | "site"
    max_pages: int = 50
    delay_s: float = 1.0

    @field_validator("mode")
    @classmethod
    def mode_must_be_valid(cls, v):
        if v not in ("page", "site"):
            raise ValueError("mode must be 'page' or 'site'")
        return v

    @field_validator("max_pages")
    @classmethod
    def cap_max_pages(cls, v):
        return max(1, min(v, 200))


# ---------------------------------------------------------------------------
# Background audit runner
# ---------------------------------------------------------------------------
def _run_audit(job_id: str, req: AuditRequest):
    try:
        _update_job(job_id, status="running", progress=0, current_url="")

        results: list[dict] = []

        if req.mode == "page":
            _update_job(job_id, current_url=req.url)
            result = auditor.audit_page(req.url)
            results = [result]
            _update_job(job_id, progress=100)
        else:
            def _progress(done: int, total: int, url: str):
                pct = round(done / max(total, 1) * 100)
                _update_job(job_id, progress=pct, current_url=url,
                            pages_done=done)

            results = auditor.crawl_site(
                req.url,
                max_pages=req.max_pages,
                delay_s=req.delay_s,
                progress_callback=_progress,
            )
            _update_job(job_id, progress=100)

        # Compute summary stats
        total = len(results)
        critical_pages = sum(1 for r in results if (r.get("Critical Count") or 0) > 0)
        warning_pages = sum(1 for r in results if (r.get("Warning Count") or 0) > 0)
        indexable = sum(1 for r in results if r.get("Indexable"))
        waf_count = sum(1 for r in results if r.get("WAF Blocked"))
        avg_rt = round(sum(r.get("Response Time (ms)") or 0 for r in results) / max(total, 1))
        https_count = sum(1 for r in results if r.get("HTTPS"))

        # SEO score (100 = no issues)
        max_deductions = total * 2  # max 1 crit + 1 warn per page
        actual_deductions = sum(
            min((r.get("Critical Count") or 0) * 2 + (r.get("Warning Count") or 0), 4)
            for r in results
        )
        score = max(0, round(100 - (actual_deductions / max(max_deductions, 1)) * 100))

        _update_job(
            job_id,
            status="done",
            results=results,
            summary={
                "total": total,
                "critical_pages": critical_pages,
                "warning_pages": warning_pages,
                "indexable": indexable,
                "non_indexable": total - indexable,
                "waf_blocked": waf_count,
                "avg_response_ms": avg_rt,
                "https_count": https_count,
                "score": score,
            },
            finished_at=datetime.utcnow().isoformat(),
        )
    except Exception as e:
        _update_job(job_id, status="error", error=str(e))


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/")
def health():
    return {"status": "ok", "service": "seo-audit-api", "version": "2.0.0"}


@app.post("/api/audit/start")
def start_audit(req: AuditRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    with _JOBS_LOCK:
        _JOBS[job_id] = {
            "job_id": job_id,
            "status": "queued",
            "progress": 0,
            "current_url": "",
            "pages_done": 0,
            "results": [],
            "summary": {},
            "error": None,
            "created_at": datetime.utcnow().isoformat(),
            "finished_at": None,
            "request": req.model_dump(),
        }
    background_tasks.add_task(_run_audit, job_id, req)
    return {"job_id": job_id}


@app.get("/api/audit/status/{job_id}")
def get_status(job_id: str):
    job = _get_job(job_id)
    # Never send the full results list in a status poll — that can be MB of data.
    # Return summary + progress; use /results endpoint for full data.
    return {
        "job_id": job_id,
        "status": job["status"],
        "progress": job.get("progress", 0),
        "current_url": job.get("current_url", ""),
        "pages_done": job.get("pages_done", 0),
        "summary": job.get("summary", {}),
        "error": job.get("error"),
        "created_at": job.get("created_at"),
        "finished_at": job.get("finished_at"),
    }


@app.get("/api/audit/results/{job_id}")
def get_results(job_id: str):
    job = _get_job(job_id)
    if job["status"] not in ("done",):
        raise HTTPException(status_code=202, detail="Audit not complete yet")

    # Strip private fields before sending to frontend
    clean = []
    for r in job.get("results", []):
        row = {k: v for k, v in r.items() if not k.startswith("_")}
        clean.append(row)

    return {
        "job_id": job_id,
        "summary": job.get("summary", {}),
        "results": clean,
        "request": job.get("request", {}),
        "finished_at": job.get("finished_at"),
    }


@app.get("/api/audit/download/{job_id}/excel")
def download_excel(job_id: str):
    job = _get_job(job_id)
    if job["status"] != "done":
        raise HTTPException(status_code=202, detail="Audit not complete yet")

    xlsx_bytes = auditor.export_excel(job.get("results", []))
    if not xlsx_bytes:
        raise HTTPException(status_code=500, detail="Excel export unavailable (openpyxl not installed)")

    site = job.get("request", {}).get("url", "site").replace("https://", "").replace("http://", "").split("/")[0]
    filename = f"seo-audit-{site}-{datetime.utcnow().strftime('%Y%m%d')}.xlsx"

    return StreamingResponse(
        io.BytesIO(xlsx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.delete("/api/audit/{job_id}")
def delete_job(job_id: str):
    with _JOBS_LOCK:
        if job_id not in _JOBS:
            raise HTTPException(status_code=404, detail="Job not found")
        del _JOBS[job_id]
    return {"deleted": job_id}
