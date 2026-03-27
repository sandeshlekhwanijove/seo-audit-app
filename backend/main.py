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
        # Only average over pages that actually have a timing (exclude error results)
        timed = [r["Response Time (ms)"] for r in results if r.get("Response Time (ms)")]
        avg_rt = round(sum(timed) / len(timed)) if timed else 0
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


@app.get("/api/audit/download/{job_id}/report")
def download_html_report(job_id: str):
    """Generate a fully interactive self-contained HTML report."""
    job = _get_job(job_id)
    if job["status"] != "done":
        raise HTTPException(status_code=202, detail="Audit not complete yet")

    results = [
        {k: v for k, v in r.items() if not k.startswith("_")}
        for r in job.get("results", [])
    ]
    summary = job.get("summary", {})
    site_url = job.get("request", {}).get("url", "")
    generated_at = job.get("finished_at", datetime.utcnow().isoformat())

    import json
    data_json = json.dumps({"summary": summary, "results": results, "url": site_url, "generated_at": generated_at})

    html = _build_html_report(data_json, site_url, generated_at)
    domain = site_url.replace("https://", "").replace("http://", "").split("/")[0]
    filename = f"seo-report-{domain}-{datetime.utcnow().strftime('%Y%m%d')}.html"

    return StreamingResponse(
        io.BytesIO(html.encode("utf-8")),
        media_type="text/html",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _build_html_report(data_json: str, site_url: str, generated_at: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SEO Audit Report — {site_url}</title>
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
<link href="https://cdn.datatables.net/1.13.8/css/dataTables.bootstrap5.min.css" rel="stylesheet">
<style>
  :root{{--navy:#1a3c5e;--blue:#2563eb}}
  body{{font-family:'Segoe UI',sans-serif;background:#f8fafc;color:#1e293b}}
  .hero{{background:linear-gradient(135deg,var(--navy),#2d7dd2);color:#fff;padding:2.5rem 0}}
  .score-circle{{width:110px;height:110px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;font-weight:900;font-size:2rem;margin:0 auto;border:6px solid rgba(255,255,255,.3)}}
  .card{{border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 1px 8px rgba(0,0,0,.05)}}
  .stat-val{{font-size:1.8rem;font-weight:900;line-height:1}}
  .param-row{{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f1f5f9}}
  .param-row:last-child{{border-bottom:0}}
  .param-label{{width:160px;flex-shrink:0;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#64748b}}
  .param-val{{flex:1;font-size:.84rem;color:#1e293b}}
  .grade-badge{{font-size:.75rem;font-weight:800;padding:2px 8px;border-radius:6px}}
  .score-bar-wrap{{width:80px;flex-shrink:0}}
  .score-bar{{height:6px;border-radius:3px;background:#e2e8f0;overflow:hidden}}
  .score-bar-fill{{height:100%;border-radius:3px;transition:width .8s}}
  .section-hdr{{font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:var(--navy);border-bottom:2px solid var(--navy);padding-bottom:6px;margin:16px 0 4px}}
  .issue-crit{{color:#dc2626}} .issue-warn{{color:#d97706}} .issue-info{{color:#2563eb}}
  .row-crit{{border-left:3px solid #ef4444}} .row-warn{{border-left:3px solid #f59e0b}}
  .row-ok{{border-left:3px solid #10b981}} .row-waf{{border-left:3px solid #7c3aed;background:#faf5ff}}
  .win-item,.issue-item{{padding:8px 0;border-bottom:1px solid #f8fafc;font-size:.85rem;display:flex;align-items:start;gap:8px}}
  .win-item:last-child,.issue-item:last-child{{border-bottom:0}}
  .priority-card{{border-left:4px solid #dc2626;background:#fff5f5;border-radius:0 10px 10px 0;padding:12px 16px;margin-bottom:10px}}
  .priority-card.warn{{border-color:#f59e0b;background:#fffbeb}}
  .priority-card.opp{{border-color:#2563eb;background:#eff6ff}}
  th{{white-space:nowrap;font-size:.75rem}}
  td{{font-size:.8rem;vertical-align:middle}}
  #detailPane{{display:none;position:fixed;right:0;top:0;bottom:0;width:480px;background:#fff;box-shadow:-4px 0 24px rgba(0,0,0,.12);overflow-y:auto;z-index:1000;padding:20px}}
  .close-pane{{position:sticky;top:0;background:#fff;padding-bottom:8px;border-bottom:1px solid #e2e8f0;margin-bottom:12px}}
  @media print{{#detailPane{{display:none!important}}}}
</style>
</head>
<body>
<div class="hero mb-4">
  <div class="container">
    <div class="d-flex align-items-center gap-3 mb-3">
      <div style="width:38px;height:38px;background:rgba(255,255,255,.15);border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:900;color:#fff">S</div>
      <div><div class="fw-bold">SEO Audit Report</div><div class="opacity-75 small">{site_url}</div></div>
      <div class="ms-auto opacity-60 small">{generated_at[:10]}</div>
    </div>
    <div class="row g-3 align-items-center">
      <div class="col-auto">
        <div class="score-circle" id="heroScore" style="color:#fff">—</div>
        <div class="text-center mt-1 small opacity-75" id="heroGrade"></div>
      </div>
      <div class="col">
        <div class="row g-2" id="heroStats"></div>
      </div>
    </div>
  </div>
</div>

<div class="container pb-5">

  <!-- Priority Improvements -->
  <div class="card p-4 mb-4">
    <h5 class="fw-bold mb-3" style="color:var(--navy)">🎯 Priority Improvements</h5>
    <div id="priorityList"><div class="text-muted small">Loading…</div></div>
  </div>

  <!-- Wins & Issues -->
  <div class="row g-3 mb-4">
    <div class="col-lg-6">
      <div class="card p-4 h-100">
        <h6 class="fw-bold text-success mb-3">✅ What's Working Well</h6>
        <div id="winsList"></div>
      </div>
    </div>
    <div class="col-lg-6">
      <div class="card p-4 h-100">
        <h6 class="fw-bold text-danger mb-3">⚠️ What Needs Attention</h6>
        <div id="issuesList"></div>
      </div>
    </div>
  </div>

  <!-- Pages table -->
  <div class="card p-0 mb-4 overflow-hidden">
    <div class="px-4 py-3 border-bottom" style="background:var(--navy)">
      <span class="text-white fw-bold">All Pages</span>
      <span class="text-white opacity-60 small ms-2">click any row to see full breakdown</span>
    </div>
    <div class="table-responsive">
      <table id="auditTable" class="table table-hover mb-0">
        <thead class="table-dark">
          <tr>
            <th>URL</th><th>Status</th><th>TTFB</th><th>Score</th>
            <th title="Title Length">TL</th><th title="Description Length">DL</th>
            <th>H1</th><th>Words</th><th>Canon</th><th>Idx</th>
            <th>Crit</th><th>Warn</th><th>Top Issue</th>
          </tr>
        </thead>
        <tbody id="auditBody"></tbody>
      </table>
    </div>
  </div>

  <!-- Screaming Frog comparison -->
  <div class="card p-4 mb-4">
    <h5 class="fw-bold mb-3" style="color:var(--navy)">📋 Coverage vs. Screaming Frog</h5>
    <div class="table-responsive">
      <table class="table table-sm table-bordered" style="font-size:.8rem">
        <thead class="table-light"><tr><th>Signal</th><th>This Tool</th><th>Screaming Frog</th><th>Notes</th></tr></thead>
        <tbody id="sfTable"></tbody>
      </table>
    </div>
  </div>

</div>

<!-- Detail pane -->
<div id="detailPane">
  <div class="close-pane d-flex justify-content-between align-items-center">
    <strong>Page Detail</strong>
    <button class="btn btn-sm btn-outline-secondary" onclick="closePane()">✕ Close</button>
  </div>
  <div id="detailContent"></div>
</div>

<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
<script src="https://cdn.datatables.net/1.13.8/js/jquery.dataTables.min.js"></script>
<script src="https://cdn.datatables.net/1.13.8/js/dataTables.bootstrap5.min.js"></script>
<script>
const DATA = {data_json};
const {{summary: SUM, results: RESULTS}} = DATA;

function gradeOf(s){{
  if(s>=90)return{{g:'A',c:'#059669',bg:'#d1fae5'}};
  if(s>=75)return{{g:'B',c:'#16a34a',bg:'#dcfce7'}};
  if(s>=55)return{{g:'C',c:'#d97706',bg:'#fef3c7'}};
  if(s>=35)return{{g:'D',c:'#ea580c',bg:'#ffedd5'}};
  return{{g:'F',c:'#dc2626',bg:'#fee2e2'}};
}}
function esc(s){{return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}}

function pageScore(r){{
  if(r['WAF Blocked'])return 0;
  const tl=r['Title Length']||0,dl=r['Meta Description Length']||0,h1=r['H1 Count']||0;
  const ts=tl===0?0:tl>=30&&tl<=60?100:tl<20?25:tl<30?60:tl<=70?72:35;
  const ds=dl===0?0:dl>=70&&dl<=160?100:dl<50?30:dl<70?62:50;
  const hs=h1===0?0:h1===1?100:45;
  const ht=r.HTTPS?100:0;
  const cn=r['Canonical URL']?100:30;
  const rt2=r['Response Time (ms)']||0;
  const rts=rt2===0?0:rt2<500?100:rt2<1000?90:rt2<1500?75:rt2<2500?55:rt2<3500?30:10;
  return Math.round((ts*20+ds*15+hs*15+ht*15+cn*10+rts*10)/85);
}}

// Hero score
$(()=>{{
  const score=SUM.score||0;
  const{{g,c}}=gradeOf(score);
  $('#heroScore').text(score).css('background',c+'22').css('border-color',c).css('color',c).css('background','#fff');
  $('#heroGrade').html(`Grade <b style="color:${{c}}">${{g}}</b>`);
  $('#heroStats').html([
    ['Pages Audited',SUM.total,'#1a3c5e'],
    ['Critical Issues',SUM.critical_pages,'#dc2626'],
    ['Warnings',SUM.warning_pages,'#d97706'],
    ['Indexable',SUM.indexable,'#059669'],
    ['Avg TTFB',SUM.avg_response_ms?(SUM.avg_response_ms+'ms'):'—','#2563eb'],
    ['WAF Blocked',SUM.waf_blocked,'#7c3aed'],
  ].map(([l,v,c])=>`<div class="col-6 col-md-4 col-lg-2"><div class="text-white-50 small">${{l}}</div><div class="fw-black fs-4" style="color:${{c}};mix-blend-mode:screen">${{v}}</div></div>`).join(''));
}});

// Priority improvements
$(()=>{{
  const total=RESULTS.length||1;
  const items=[];
  const noTitle=RESULTS.filter(r=>!r.Title&&!r['WAF Blocked']);
  if(noTitle.length)items.push({{sev:'crit',count:noTitle.length,issue:'Missing title tags',fix:'Add unique, descriptive <title> tags (30–60 chars) to every page. This is the most impactful on-page SEO change you can make.',impact:'High'}});
  const badTitle=RESULTS.filter(r=>r.Title&&(r['Title Length']<30||r['Title Length']>60)&&!r['WAF Blocked']);
  if(badTitle.length>Math.round(total*0.2))items.push({{sev:'warn',count:badTitle.length,issue:'Title tags outside optimal length (30–60 chars)',fix:'Rewrite titles to be 30–60 characters. Too short = missed keyword opportunity; too long = Google truncates in SERPs.',impact:'High'}});
  const noDesc=RESULTS.filter(r=>!r['Meta Description']&&!r['WAF Blocked']);
  if(noDesc.length)items.push({{sev:'warn',count:noDesc.length,issue:'Missing meta descriptions',fix:'Write unique meta descriptions (70–160 chars) for each page. While not a direct ranking factor, they significantly improve click-through rates from search results.',impact:'Medium'}});
  const noH1=RESULTS.filter(r=>!r['H1 Count']&&!r['WAF Blocked']);
  if(noH1.length)items.push({{sev:'crit',count:noH1.length,issue:'Missing H1 tags',fix:'Add exactly one H1 tag per page containing the primary keyword. H1 is a strong on-page ranking signal.',impact:'High'}});
  const noCanon=RESULTS.filter(r=>!r['Canonical URL']&&!r['WAF Blocked']);
  if(noCanon.length>Math.round(total*0.3))items.push({{sev:'warn',count:noCanon.length,issue:'Missing canonical tags',fix:'Add <link rel="canonical"> to every page pointing to the preferred URL. This prevents duplicate content issues and consolidates link equity.',impact:'Medium'}});
  const missingAlt=RESULTS.filter(r=>(r['Images Missing Alt']||0)>0&&!r['WAF Blocked']);
  if(missingAlt.length)items.push({{sev:'warn',count:missingAlt.length,issue:`Images missing alt text`,fix:'Add descriptive alt attributes to all images. This helps image search rankings and improves web accessibility (WCAG compliance).',impact:'Medium'}});
  const slowPages=RESULTS.filter(r=>(r['Response Time (ms)']||0)>2000&&!r['WAF Blocked']);
  if(slowPages.length>Math.round(total*0.2))items.push({{sev:'warn',count:slowPages.length,issue:'Slow server response / TTFB (>2s)',fix:'Investigate server-side caching, CDN, and database query optimisation. TTFB is a Core Web Vitals signal and a confirmed Google ranking factor.',impact:'High'}});
  const noSchema=RESULTS.filter(r=>!r['Has Structured Data']&&!r['WAF Blocked']);
  if(noSchema.length>Math.round(total*0.5))items.push({{sev:'opp',count:noSchema.length,issue:'No Schema.org structured data',fix:'Add relevant Schema markup (Article, Product, BreadcrumbList, etc.) to enable rich results in Google SERPs — these significantly improve CTR.',impact:'Medium'}});
  const waf=RESULTS.filter(r=>r['WAF Blocked']);
  if(waf.length)items.push({{sev:'crit',count:waf.length,issue:'Pages blocked by WAF / bot protection',fix:'The crawler could not access these pages. Consider whitelisting the crawler IP or auditing these pages separately using a browser with credentials.',impact:'High'}});

  if(!items.length){{
    $('#priorityList').html('<div class="text-success fw-semibold">✨ No major issues detected — keep it up!</div>');
    return;
  }}
  items.sort((a,b)=>(['crit','warn','opp'].indexOf(a.sev)-['crit','warn','opp'].indexOf(b.sev)));
  $('#priorityList').html(items.map(it=>`
    <div class="priority-card ${{it.sev}}">
      <div class="d-flex align-items-center gap-2 mb-1">
        <span class="badge" style="background:${{it.sev==='crit'?'#dc2626':it.sev==='warn'?'#d97706':'#2563eb'}}">${{it.count}} page${{it.count!==1?'s':''}}</span>
        <strong style="font-size:.88rem">${{esc(it.issue)}}</strong>
        <span class="ms-auto badge bg-light text-muted" style="font-size:.65rem">Impact: ${{it.impact}}</span>
      </div>
      <div style="font-size:.8rem;color:#475569">${{esc(it.fix)}}</div>
    </div>`).join(''));
}});

// Wins & Issues
$(()=>{{
  const total=RESULTS.length||1;
  const pct=(n,d)=>Math.round(n/Math.max(d,1)*100);
  const wins=[],issues=[];
  const httpsN=RESULTS.filter(r=>r.HTTPS).length,hPct=pct(httpsN,total);
  if(hPct>=85)wins.push([`${{hPct}}% of pages are served over HTTPS`,`${{httpsN}} of ${{total}} pages are secure`]);
  else issues.push([`Only ${{hPct}}% of pages use HTTPS`,`${{total-httpsN}} pages not secure — confirmed ranking penalty`]);
  const idxPct=pct(SUM.indexable,total);
  if(idxPct>=90)wins.push([`${{idxPct}}% of pages are indexable`,`${{SUM.indexable}} of ${{total}} can appear in Google`]);
  else if(idxPct<75)issues.push([`Only ${{idxPct}}% indexable`,`${{SUM.non_indexable}} pages excluded from Google search`]);
  const h1N=RESULTS.filter(r=>r['H1 Count']===1).length,h1Pct=pct(h1N,total);
  if(h1Pct>=85)wins.push([`${{h1Pct}}% of pages have exactly one H1`,`Strong heading structure across audited pages`]);
  else issues.push([`H1 issues on ${{100-h1Pct}}% of pages`,`${{total-h1N}} pages have missing or duplicate H1s`]);
  const tN=RESULTS.filter(r=>{{const l=r['Title Length']||0;return r.Title&&l>=30&&l<=60;}}).length;
  const tPct=pct(tN,total);
  if(tPct>=80)wins.push([`${{tPct}}% of pages have optimised title tags`,`Titles within the 30–60 char sweet spot`]);
  else issues.push([`Title issues on ${{100-tPct}}% of pages`,`${{total-tN}} pages have suboptimal title tags`]);
  const sN=RESULTS.filter(r=>r['Has Structured Data']).length;
  if(pct(sN,total)>=50)wins.push([`${{pct(sN,total)}}% of pages have structured data`,`Eligible for rich results in Google SERPs`]);
  else issues.push([`Structured data absent on ${{100-pct(sN,total)}}% of pages`,`${{total-sN}} pages missing Schema markup`]);
  const rt=SUM.avg_response_ms||0;
  if(rt>0&&rt<1200)wins.push([`Excellent average TTFB: ${{rt}}ms`,`Fast server response is a Core Web Vitals signal`]);
  else if(rt>2200)issues.push([`Average TTFB is ${{rt}}ms — too slow`,`Slow TTFB hurts Core Web Vitals and rankings`]);
  if(SUM.waf_blocked>0)issues.push([`${{SUM.waf_blocked}} pages blocked by WAF`,`These pages could not be fully audited`]);
  const winHtml=it=>`<div class="win-item"><span>✅</span><div><div class="fw-semibold">${{esc(it[0])}}</div><div class="text-muted small">${{esc(it[1])}}</div></div></div>`;
  const issHtml=it=>`<div class="issue-item"><span>⚠️</span><div><div class="fw-semibold">${{esc(it[0])}}</div><div class="text-muted small">${{esc(it[1])}}</div></div></div>`;
  $('#winsList').html(wins.map(winHtml).join('')||'<div class="text-muted small">Run a full crawl for more wins.</div>');
  $('#issuesList').html(issues.map(issHtml).join('')||'<div class="text-success small">No significant issues detected!</div>');
}});

// Table
$(()=>{{
  const rows=RESULTS.map((r,i)=>{{
    const score=pageScore(r);
    const{{g,c,bg}}=gradeOf(score);
    const isWaf=r['WAF Blocked'];
    const sc=r['Status Code']||0;
    const scC=sc>=200&&sc<300?'#059669':sc>=300&&sc<400?'#d97706':'#dc2626';
    const rt=r['Response Time (ms)']||0;
    const rtC=rt>3000?'#dc2626':rt>1500?'#d97706':'#059669';
    const tl=r['Title Length']||0,dl=r['Meta Description Length']||0,h1=r['H1 Count']||0;
    const cls=isWaf?'row-waf':r['Critical Count']>0?'row-crit':r['Warning Count']>0?'row-warn':'row-ok';
    const top=((r['Critical Issues']||'')+';'+(r.Warnings||'')).split(';').filter(Boolean)[0]?.trim()||'';
    return `<tr class="${{cls}}" style="cursor:pointer" onclick="showDetail(${{i}})">
      <td><a href="${{esc(r.URL)}}" target="_blank" onclick="event.stopPropagation()" style="font-size:.75rem">${{esc(r.URL.replace(/^https?:\\/\\//,'').substring(0,55))}}</a>${{isWaf?'<span class="badge bg-purple ms-1" style="background:#7c3aed;font-size:.6rem">WAF</span>':''}}</td>
      <td style="color:${{scC}};font-weight:700">${{sc}}</td>
      <td style="color:${{rtC}};font-weight:600">${{rt?rt+'ms':'—'}}</td>
      <td><span class="grade-badge" style="color:${{c}};background:${{bg}}">${{score}} ${{g}}</span></td>
      <td class="${{!isWaf&&(tl>60||tl<30&&tl>0)?'text-danger fw-bold':''}}">${{isWaf?'—':tl}}</td>
      <td class="${{!isWaf&&(dl>160||dl<70&&dl>0)?'text-warning fw-bold':''}}">${{isWaf?'—':dl}}</td>
      <td class="${{!isWaf&&h1!==1?'text-danger fw-bold':''}}">${{isWaf?'—':h1}}</td>
      <td>${{isWaf?'—':r['Word Count']||0}}</td>
      <td>${{r['Canonical URL']?'✅':'❌'}}</td>
      <td style="color:${{r.Indexable?'#059669':'#dc2626'}};font-weight:700">${{r.Indexable?'✓':'✗'}}</td>
      <td><span class="badge bg-danger">${{r['Critical Count']||0}}</span></td>
      <td><span class="badge bg-warning text-dark">${{r['Warning Count']||0}}</span></td>
      <td style="font-size:.73rem;color:#64748b;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${{esc(top.substring(0,60))}}</td>
    </tr>`;
  }});
  $('#auditBody').html(rows.join(''));
  $('#auditTable').DataTable({{pageLength:50,order:[[10,'desc']],scrollX:true}});
}});

// Screaming Frog comparison
$(()=>{{
  const sfRows=[
    ['Meta Title','✅ Length, content, pixel width','✅ + duplicate detection','We flag duplicates as warnings'],
    ['Meta Description','✅ Length, content, missing','✅ + duplicates',''],
    ['H1/H2/H3 Tags','✅ Count, first instance','✅ + all instances','We return first H1/H2/H3'],
    ['Canonical URLs','✅ Present, self-ref check','✅ + chains',''],
    ['Meta Robots / noindex','✅','✅',''],
    ['X-Robots-Tag','✅','✅',''],
    ['Response Time (TTFB)','✅ Navigation Timing API','✅',''],
    ['Full JS Load Time','✅ (new: full_load_ms)','❌ (HTTP only)','We wait for JS hydration'],
    ['HTTPS / HTTP','✅','✅',''],
    ['Status Codes','✅','✅',''],
    ['Redirects','✅','✅ + chains',''],
    ['Image Alt Text','✅ Missing/empty/too long','✅',''],
    ['Internal / External Links','✅ Counts','✅ + full link list export',''],
    ['Open Graph Tags','✅ title/desc/image/type','✅',''],
    ['Twitter Card','✅','✅',''],
    ['Schema / Structured Data','✅ Types detected','✅ + validation','We list types but don't validate'],
    ['Hreflang','✅ Languages detected','✅ + return links',''],
    ['Word Count','✅','✅',''],
    ['Flesch Readability','✅','❌','We include this; SF does not'],
    ['WAF / Bot Detection','✅ (unique feature)','❌',''],
    ['JavaScript Rendering','✅ (Playwright)','✅ (custom rendering)','Both use real browsers'],
    ['Duplicate Content','⚠️ Partial (canonical check)','✅ Full hash comparison','Planned improvement'],
    ['Pagination (rel=next/prev)','✅ Detected','✅',''],
    ['Breadcrumbs','✅ Detected','✅',''],
    ['Page Speed / Core Web Vitals','⚠️ TTFB only','✅ Full CWV','Planned improvement'],
    ['Sitemap crawling','❌','✅','Planned improvement'],
    ['robots.txt parsing','❌','✅','Planned improvement'],
    ['Custom extraction (XPath/RegEx)','❌','✅','Future feature'],
  ];
  $('#sfTable').html(sfRows.map(([s,us,sf,note])=>`<tr>
    <td class="fw-semibold">${{esc(s)}}</td>
    <td>${{us}}</td><td>${{sf}}</td>
    <td class="text-muted">${{esc(note)}}</td>
  </tr>`).join(''));
}});

// Detail pane
function showDetail(i){{
  const r=RESULTS[i];if(!r)return;
  const score=pageScore(r);const{{g,c,bg}}=gradeOf(score);
  const isWaf=r['WAF Blocked'];
  function pr(label,val,sub){{
    return `<div class="param-row">
      <div class="param-label">${{esc(label)}}</div>
      <div class="param-val">${{val}}<br><span class="text-muted" style="font-size:.72rem">${{esc(sub||'')}}</span></div>
    </div>`;
  }}
  function prScore(label,val,sub,score){{
    const{{g,c,bg}}=gradeOf(score);
    return `<div class="param-row">
      <div class="param-label">${{esc(label)}}</div>
      <div class="param-val">${{val}}<br><span style="font-size:.72rem;color:${{c}}">${{esc(sub||'')}}</span></div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <div class="score-bar-wrap"><div class="score-bar"><div class="score-bar-fill" style="width:${{score}}%;background:${{c}}"></div></div></div>
        <span class="grade-badge" style="color:${{c}};background:${{bg}}">${{score}} ${{g}}</span>
      </div>
    </div>`;
  }}
  const criticals=(r['Critical Issues']||'').split(';').filter(Boolean);
  const warnings=(r.Warnings||'').split(';').filter(Boolean);
  const info=(r.Info||'').split(';').filter(Boolean);
  const tl=r['Title Length']||0,dl=r['Meta Description Length']||0,h1=r['H1 Count']||0;
  const ts=tl===0?0:tl>=30&&tl<=60?100:tl<20?25:tl<30?60:tl<=70?72:35;
  const ds=dl===0?0:dl>=70&&dl<=160?100:dl<50?30:dl<70?62:50;
  const rt=r['Response Time (ms)']||0;
  const rts=rt===0?0:rt<500?100:rt<1000?90:rt<1500?75:rt<2500?55:rt<3500?30:10;
  document.getElementById('detailContent').innerHTML=`
    <div class="d-flex align-items-center gap-2 mb-3 flex-wrap">
      <span class="badge bg-${{(r['Status Code']||0)===200?'success':'danger'}}">${{r['Status Code']||0}}</span>
      ${{isWaf?'<span class="badge" style="background:#7c3aed">WAF Blocked</span>':''}}
      ${{r.HTTPS?'<span class="badge bg-success">HTTPS</span>':''}}
      ${{r.Indexable?'<span class="badge bg-success">Indexable</span>':'<span class="badge bg-danger">Not Indexable</span>'}}
      <span class="ms-auto grade-badge" style="color:${{c}};background:${{bg}};font-size:1rem">${{score}} — Grade ${{g}}</span>
    </div>
    <div class="mb-2"><a href="${{esc(r.URL)}}" target="_blank" style="font-size:.78rem;word-break:break-all">${{esc(r.URL)}}</a></div>
    <div class="section-hdr">📝 Content</div>
    ${{prScore('Meta Title',r.Title?`"${{esc(r.Title.substring(0,70))}}"`:'<span class="text-danger">Missing</span>',`${{tl}} chars`,ts)}}
    ${{prScore('Meta Description',r['Meta Description']?`"${{esc(r['Meta Description'].substring(0,100))}}"`:'<span class="text-warning">Missing</span>',`${{dl}} chars`,ds)}}
    ${{prScore('H1 Tag',r['H1 First']?esc(r['H1 First']):'<span class="text-danger">Missing</span>',h1===1?'Perfect — one H1':h1>1?h1+' H1 tags (only 1 recommended)':'Missing',h1===1?100:0)}}
    ${{pr('H2 / H3',(r['H2 Count']||0)+' H2 · '+(r['H3 Count']||0)+' H3',r['H2 First']?`First H2: "${{esc(r['H2 First'])}}"`:'' )}}
    ${{pr('Word Count',isWaf?'N/A':(r['Word Count']||0)+' words',isWaf?'WAF blocked':(r['Paragraph Count']||0)+' paragraphs')}}
    ${{r['Flesch Reading Ease']?pr('Readability','Flesch: '+r['Flesch Reading Ease'],r['Flesch Reading Ease']>=60?'Easy to read':r['Flesch Reading Ease']>=30?'Moderate':'Difficult'):''}}
    <div class="section-hdr">⚙️ Technical</div>
    ${{prScore('HTTPS',r.HTTPS?'✅ Secure':'❌ HTTP only',r.HTTPS?'Secure connection':'Ranking penalty',r.HTTPS?100:0)}}
    ${{prScore('Response Time (TTFB)',rt?rt+'ms':'N/A','Time To First Byte (what Google measures)',rts)}}
    ${{r['Full Load Time (ms)']&&r['Full Load Time (ms)']!==rt?pr('Full JS Load Time',r['Full Load Time (ms)']+'ms','Includes JS rendering / hydration time'):''}}\
    ${{pr('Canonical URL',r['Canonical URL']?`<code style="font-size:.72rem">${{esc(r['Canonical URL'].substring(0,70))}}</code>`:'<span class="text-warning">Missing</span>',r['Canonical URL']?'Canonical tag present':'Duplicate content risk')}}
    ${{pr('Meta Robots',r['Meta Robots']||'Not set (defaults to index, follow)')}}
    ${{pr('Page Size',(r['Page Size (KB)']||0)+' KB',(r['Text to HTML Ratio (%)']||0)+'% text-to-HTML ratio')}}
    <div class="section-hdr">🖼️ Media &amp; Links</div>
    ${{pr('Images',(r['Image Count']||0)+' total',r['Images Missing Alt']?r['Images Missing Alt']+' missing alt text':'All images have alt text')}}
    ${{pr('Links',(r['Internal Links']||0)+' internal · '+(r['External Links']||0)+' external · '+(r['Nofollow Links']||0)+' nofollow')}}
    <div class="section-hdr">🌐 Social &amp; Schema</div>
    ${{pr('Open Graph',r['OG Title']?`"${{esc(r['OG Title'].substring(0,60))}}"`:'og:title missing',`desc ${{r['OG Description']?'✅':'❌'}} · image ${{r['OG Image']?'✅':'❌'}}`)}}
    ${{pr('Structured Data',r['Has Structured Data']?esc(r['Schema Types']):'None detected')}}
    ${{(criticals.length||warnings.length||info.length)?`
    <div class="section-hdr">🚨 Issues</div>
    ${{criticals.map(i=>`<div class="issue-crit py-1" style="font-size:.83rem">❌ ${{esc(i)}}</div>`).join('')}}
    ${{warnings.map(i=>`<div class="issue-warn py-1" style="font-size:.83rem">⚠️ ${{esc(i)}}</div>`).join('')}}
    ${{info.map(i=>`<div class="issue-info py-1" style="font-size:.83rem">ℹ️ ${{esc(i)}}</div>`).join('')}}
    `:''}}
  `;
  document.getElementById('detailPane').style.display='block';
}}
function closePane(){{document.getElementById('detailPane').style.display='none';}}
</script>
</body></html>"""


@app.delete("/api/audit/{job_id}")
def delete_job(job_id: str):
    with _JOBS_LOCK:
        if job_id not in _JOBS:
            raise HTTPException(status_code=404, detail="Job not found")
        del _JOBS[job_id]
    return {"deleted": job_id}
