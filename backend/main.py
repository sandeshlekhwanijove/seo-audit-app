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



# ─── HTML Report constants (pure strings — no f-string, so JS/CSS {} are literal) ──
_R_CSS = """
<style>
:root{--navy:#1a3c5e;--blue:#2563eb}
body{font-family:'Segoe UI',sans-serif;background:#f8fafc;color:#1e293b;position:relative}
.dyn-bg{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden}
.dyn-bg span{position:absolute;border-radius:50%;filter:blur(90px)}
.dyn-bg span:nth-child(1){width:600px;height:600px;background:radial-gradient(circle,#2563eb22,transparent 70%);top:-150px;left:-150px;animation:bgf1 28s ease-in-out infinite}
.dyn-bg span:nth-child(2){width:500px;height:500px;background:radial-gradient(circle,#1a3c5e18,transparent 70%);bottom:-100px;right:-100px;animation:bgf2 35s ease-in-out infinite}
@keyframes bgf1{0%,100%{transform:translate(0,0)}50%{transform:translate(50px,-40px)}}
@keyframes bgf2{0%,100%{transform:translate(0,0)}50%{transform:translate(-40px,50px)}}
.hero{background:linear-gradient(135deg,var(--navy),#2d7dd2);color:#fff;padding:2.5rem 0;position:relative;z-index:1}
.score-circle{width:100px;height:100px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;font-weight:900;font-size:2rem;margin:0 auto;border:5px solid rgba(255,255,255,.3);background:rgba(255,255,255,.08)}
.card{border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 1px 8px rgba(0,0,0,.05);position:relative;z-index:1}
.param-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f1f5f9}
.param-row:last-child{border-bottom:0}
.param-label{width:160px;flex-shrink:0;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#64748b}
.param-val{flex:1;font-size:.84rem;color:#1e293b}
.grade-badge{font-size:.75rem;font-weight:800;padding:2px 8px;border-radius:6px}
.score-bar-wrap{width:80px;flex-shrink:0}
.score-bar{height:6px;border-radius:3px;background:#e2e8f0;overflow:hidden}
.score-bar-fill{height:100%;border-radius:3px}
.section-hdr{font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:var(--navy);border-bottom:2px solid var(--navy);padding-bottom:6px;margin:16px 0 4px}
.issue-crit{color:#dc2626}.issue-warn{color:#d97706}.issue-info{color:#2563eb}
.row-crit{border-left:3px solid #ef4444}.row-warn{border-left:3px solid #f59e0b}
.row-ok{border-left:3px solid #10b981}.row-waf{border-left:3px solid #7c3aed;background:#faf5ff}
.win-item,.issue-item{padding:8px 0;border-bottom:1px solid #f8fafc;font-size:.85rem;display:flex;align-items:start;gap:8px}
.win-item:last-child,.issue-item:last-child{border-bottom:0}
.priority-card{border-left:4px solid #dc2626;background:#fff5f5;border-radius:0 10px 10px 0;padding:12px 16px;margin-bottom:10px}
.priority-card.warn{border-color:#f59e0b;background:#fffbeb}
.priority-card.opp{border-color:#2563eb;background:#eff6ff}
th{white-space:nowrap;font-size:.75rem}
td{font-size:.8rem;vertical-align:middle}
#detailPane{display:none;position:fixed;right:0;top:0;bottom:0;width:500px;background:#fff;box-shadow:-4px 0 24px rgba(0,0,0,.12);overflow-y:auto;z-index:9999;padding:20px}
.close-pane{position:sticky;top:0;background:#fff;padding-bottom:8px;border-bottom:1px solid #e2e8f0;margin-bottom:12px;z-index:1}
.stat-filter-btn{cursor:pointer;border:2px solid transparent;border-radius:10px;padding:10px;text-align:center;transition:all .2s;background:#fff}
.stat-filter-btn:hover{border-color:#2563eb;box-shadow:0 0 0 3px #2563eb22}
.stat-filter-btn.active{border-color:var(--active-c,#2563eb);box-shadow:0 0 0 3px rgba(37,99,235,.15)}
@media print{#detailPane{display:none!important}}
</style>
"""

_R_JS = r"""
<script>
(function(){
var D = JSON.parse(document.getElementById('__audit_data__').textContent);
var SUM = D.summary, RESULTS = D.results;
var activeFilter = null;

function gradeOf(s){
  if(s>=90)return{g:'A',c:'#059669',bg:'#d1fae5'};
  if(s>=75)return{g:'B',c:'#16a34a',bg:'#dcfce7'};
  if(s>=55)return{g:'C',c:'#d97706',bg:'#fef3c7'};
  if(s>=35)return{g:'D',c:'#ea580c',bg:'#ffedd5'};
  return{g:'F',c:'#dc2626',bg:'#fee2e2'};
}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function pageScore(r){
  if(r['WAF Blocked'])return 0;
  var tl=r['Title Length']||0,dl=r['Meta Description Length']||0,h1=r['H1 Count']||0;
  var ts=tl===0?0:tl>=30&&tl<=60?100:tl<20?25:tl<30?60:tl<=70?72:35;
  var ds=dl===0?0:dl>=70&&dl<=160?100:dl<50?30:dl<70?62:50;
  var hs=h1===0?0:h1===1?100:45;
  var ht=r.HTTPS?100:0;
  var cn=r['Canonical URL']?100:30;
  var rt2=r['Response Time (ms)']||0;
  var rts=rt2===0?0:rt2<500?100:rt2<1000?90:rt2<1500?75:rt2<2500?55:rt2<3500?30:10;
  return Math.round((ts*20+ds*15+hs*15+ht*15+cn*10+rts*10)/85);
}

// Hero
(function(){
  var score=SUM.score||0;
  var gd=gradeOf(score);
  var el=document.getElementById('heroScore');
  if(el){el.textContent=score;el.style.borderColor=gd.c;}
  var gr=document.getElementById('heroGrade');
  if(gr)gr.innerHTML='Grade <b style="color:'+gd.c+'">'+gd.g+'</b>';
  var stats=[
    {l:'Pages Audited',v:SUM.total,c:'#fff',filter:'all'},
    {l:'Critical Issues',v:SUM.critical_pages,c:'#fca5a5',filter:'critical'},
    {l:'Warnings',v:SUM.warning_pages,c:'#fcd34d',filter:'warning'},
    {l:'Indexable',v:SUM.indexable,c:'#6ee7b7',filter:'indexable'},
    {l:'Avg TTFB',v:(SUM.avg_response_ms||0)>0?(SUM.avg_response_ms+'ms'):'—',c:'#93c5fd',filter:null},
    {l:'WAF Blocked',v:SUM.waf_blocked,c:'#c4b5fd',filter:'waf'},
  ];
  var hs=document.getElementById('heroStats');
  if(!hs)return;
  hs.innerHTML=stats.map(function(s){
    return '<div class="col-6 col-md-4 col-lg-2">'
      +(s.filter?'<div class="stat-filter-btn" data-filter="'+s.filter+'" id="sfbtn-'+s.filter+'" onclick="applyFilter(\''+s.filter+'\')">':'<div>')
      +'<div style="font-size:1.8rem;font-weight:900;color:'+s.c+'">'+esc(String(s.v))+'</div>'
      +'<div style="font-size:.7rem;opacity:.75">'+esc(s.l)+'</div>'
      +(s.filter?'<div style="font-size:.6rem;opacity:.5">click to filter</div>':'')
      +'</div></div>';
  }).join('');
})();

// Filter
function applyFilter(f){
  activeFilter=(activeFilter===f)?null:f;
  document.querySelectorAll('.stat-filter-btn').forEach(function(b){b.classList.remove('active');});
  if(activeFilter){var b=document.getElementById('sfbtn-'+activeFilter);if(b)b.classList.add('active');}
  rebuildTable();
  document.getElementById('tableSection').scrollIntoView({behavior:'smooth'});
}

// Priority improvements
(function(){
  var total=RESULTS.length||1;
  var items=[];
  var nonWaf=RESULTS.filter(function(r){return !r['WAF Blocked'];});
  var noTitle=nonWaf.filter(function(r){return !r.Title;});
  if(noTitle.length)items.push({sev:'crit',n:noTitle.length,issue:'Missing title tags',fix:'Add a unique <title> (30-60 chars) to every page. Most impactful on-page SEO fix.',impact:'High'});
  var badT=nonWaf.filter(function(r){var l=r['Title Length']||0;return r.Title&&(l<30||l>60);});
  if(badT.length>Math.round(total*0.15))items.push({sev:'warn',n:badT.length,issue:'Title tags outside 30-60 chars',fix:'Rewrite titles to 30-60 characters. Too short = missed keywords; too long = truncated in SERPs.',impact:'High'});
  var noDesc=nonWaf.filter(function(r){return !r['Meta Description'];});
  if(noDesc.length>Math.round(total*0.1))items.push({sev:'warn',n:noDesc.length,issue:'Missing meta descriptions',fix:'Write unique meta descriptions (70-160 chars). Boosts click-through rates from search results.',impact:'Medium'});
  var noH1=nonWaf.filter(function(r){return !r['H1 Count'];});
  if(noH1.length)items.push({sev:'crit',n:noH1.length,issue:'Missing H1 tags',fix:'Add exactly one H1 per page with the primary keyword. Strong on-page ranking signal.',impact:'High'});
  var noCanon=nonWaf.filter(function(r){return !r['Canonical URL'];});
  if(noCanon.length>Math.round(total*0.3))items.push({sev:'warn',n:noCanon.length,issue:'Missing canonical tags',fix:'Add <link rel="canonical"> to prevent duplicate content and consolidate PageRank.',impact:'Medium'});
  var altM=nonWaf.filter(function(r){return (r['Images Missing Alt']||0)>0;});
  if(altM.length)items.push({sev:'warn',n:altM.length,issue:'Images missing alt text',fix:'Add descriptive alt attributes — improves image SEO and WCAG accessibility compliance.',impact:'Medium'});
  var slowP=nonWaf.filter(function(r){return (r['Response Time (ms)']||0)>2000;});
  if(slowP.length>Math.round(total*0.2))items.push({sev:'warn',n:slowP.length,issue:'Slow server TTFB (>2s)',fix:'Use server caching, CDN, and DB optimisation. TTFB is a confirmed Google ranking factor.',impact:'High'});
  var noSch=nonWaf.filter(function(r){return !r['Has Structured Data'];});
  if(noSch.length>Math.round(total*0.5))items.push({sev:'opp',n:noSch.length,issue:'No Schema.org structured data',fix:'Add JSON-LD Schema (Article, Product, BreadcrumbList) to unlock rich results in SERPs.',impact:'Medium'});
  var waf=RESULTS.filter(function(r){return r['WAF Blocked'];});
  if(waf.length)items.push({sev:'crit',n:waf.length,issue:'Pages blocked by WAF/bot protection',fix:'Crawler was blocked. If Googlebot is also blocked, these pages cannot be indexed.',impact:'High'});
  var pl=document.getElementById('priorityList');
  if(!pl)return;
  if(!items.length){pl.innerHTML='<div class="text-success fw-semibold">No major issues detected!</div>';return;}
  items.sort(function(a,b){return (['crit','warn','opp'].indexOf(a.sev)-['crit','warn','opp'].indexOf(b.sev));});
  pl.innerHTML=items.map(function(it){
    var bc=it.sev==='crit'?'#dc2626':it.sev==='warn'?'#d97706':'#2563eb';
    var pct=Math.round(it.n/total*100);
    return '<div class="priority-card '+it.sev+'">'
      +'<div class="d-flex align-items-center gap-2 flex-wrap mb-1">'
      +'<span class="badge" style="background:'+bc+'">'+it.n+' page'+(it.n!==1?'s':'')+'</span>'
      +'<strong style="font-size:.88rem">'+esc(it.issue)+'</strong>'
      +'<span class="ms-auto badge bg-light text-muted" style="font-size:.65rem">'+pct+'% affected · '+esc(it.impact)+' impact</span>'
      +'</div>'
      +'<div class="w-100 mb-1" style="height:4px;background:#fff8;border-radius:2px"><div style="height:4px;border-radius:2px;background:'+bc+';width:'+pct+'%"></div></div>'
      +'<div style="font-size:.8rem;color:#475569">'+esc(it.fix)+'</div>'
      +'</div>';
  }).join('');
})();

// Wins & Issues
(function(){
  var total=RESULTS.length||1;
  function pct(n){return Math.round(n/total*100);}
  var wins=[],issues=[];
  var httpsN=RESULTS.filter(function(r){return r.HTTPS;}).length;
  if(pct(httpsN)>=85)wins.push([pct(httpsN)+'% of pages are HTTPS',httpsN+' of '+total+' pages are secure']);
  else issues.push(['Only '+pct(httpsN)+'% of pages use HTTPS',(total-httpsN)+' pages not secure — ranking penalty']);
  var idxP=pct(SUM.indexable);
  if(idxP>=90)wins.push([idxP+'% of pages indexable',SUM.indexable+' of '+total+' can appear in Google']);
  else if(idxP<75)issues.push(['Only '+idxP+'% indexable',SUM.non_indexable+' pages excluded from Google']);
  var h1N=RESULTS.filter(function(r){return r['H1 Count']===1;}).length;
  if(pct(h1N)>=85)wins.push([pct(h1N)+'% of pages have one H1','Strong heading structure']);
  else issues.push(['H1 issues on '+(100-pct(h1N))+'% of pages',(total-h1N)+' pages with missing/duplicate H1s']);
  var tN=RESULTS.filter(function(r){var l=r['Title Length']||0;return r.Title&&l>=30&&l<=60;}).length;
  if(pct(tN)>=80)wins.push([pct(tN)+'% have optimal title tags','Within 30-60 char sweet spot']);
  else issues.push(['Title issues on '+(100-pct(tN))+'% of pages',(total-tN)+' pages with suboptimal titles']);
  var sN=RESULTS.filter(function(r){return r['Has Structured Data'];}).length;
  if(pct(sN)>=50)wins.push([pct(sN)+'% of pages have Schema data','Eligible for rich results']);
  else issues.push(['Schema absent on '+(100-pct(sN))+'% of pages',(total-sN)+' pages missing structured data']);
  var rt=SUM.avg_response_ms||0;
  if(rt>0&&rt<1200)wins.push(['Excellent TTFB: '+rt+'ms','Fast server response — Core Web Vitals signal']);
  else if(rt>2200)issues.push(['TTFB is '+rt+'ms — too slow','Slow server response hurts rankings']);
  if(SUM.waf_blocked>0)issues.push([SUM.waf_blocked+' pages blocked by WAF','Could not be fully audited — Googlebot may also be blocked']);
  function wi(it){return '<div class="win-item"><span>✅</span><div><div class="fw-semibold">'+esc(it[0])+'</div><div class="text-muted small">'+esc(it[1])+'</div></div></div>';}
  function ii(it){return '<div class="issue-item"><span>⚠️</span><div><div class="fw-semibold">'+esc(it[0])+'</div><div class="text-muted small">'+esc(it[1])+'</div></div></div>';}
  var wl=document.getElementById('winsList'),il=document.getElementById('issuesList');
  if(wl)wl.innerHTML=wins.map(wi).join('')||'<div class="text-muted small">Run a full crawl for more wins.</div>';
  if(il)il.innerHTML=issues.map(ii).join('')||'<div class="text-success small">No significant issues found!</div>';
})();

// Table
var DT=null;
function rebuildTable(){
  var body=document.getElementById('auditBody');
  if(!body)return;
  var filtered=RESULTS;
  if(activeFilter&&activeFilter!=='all'){
    filtered=RESULTS.filter(function(r){
      if(activeFilter==='critical')return (r['Critical Count']||0)>0;
      if(activeFilter==='warning')return (r['Warning Count']||0)>0;
      if(activeFilter==='indexable')return r.Indexable;
      if(activeFilter==='non-indexable')return !r.Indexable;
      if(activeFilter==='waf')return r['WAF Blocked'];
      return true;
    });
  }
  if(DT){DT.destroy();DT=null;}
  body.innerHTML=filtered.map(function(r,i){
    var score=pageScore(r);
    var gd=gradeOf(score);
    var isWaf=r['WAF Blocked'];
    var sc=r['Status Code']||0;
    var scC=sc>=200&&sc<300?'#059669':sc>=300&&sc<400?'#d97706':'#dc2626';
    var rt=r['Response Time (ms)']||0;
    var rtC=rt>3000?'#dc2626':rt>1500?'#d97706':'#059669';
    var tl=r['Title Length']||0,dl=r['Meta Description Length']||0,h1=r['H1 Count']||0;
    var cls=isWaf?'row-waf':r['Critical Count']>0?'row-crit':r['Warning Count']>0?'row-warn':'row-ok';
    var allIssues=((r['Critical Issues']||'')+';'+(r.Warnings||'')).split(';').filter(Boolean);
    var top=allIssues.length?allIssues[0].trim():'';
    var ri=RESULTS.indexOf(r);
    return '<tr class="'+cls+'" style="cursor:pointer" onclick="showDetail('+ri+')">'
      +'<td><a href="'+esc(r.URL)+'" target="_blank" onclick="event.stopPropagation()" style="font-size:.75rem">'+esc((r.URL||'').replace(/^https?:\/\//,'').substring(0,55))+'</a>'
      +(isWaf?'<span class="badge ms-1" style="background:#7c3aed;font-size:.6rem">WAF</span>':'')+'</td>'
      +'<td style="color:'+scC+';font-weight:700">'+sc+'</td>'
      +'<td style="color:'+rtC+';font-weight:600">'+(rt?rt+'ms':'—')+'</td>'
      +'<td><span class="grade-badge" style="color:'+gd.c+';background:'+gd.bg+'">'+score+' '+gd.g+'</span></td>'
      +'<td class="'+((!isWaf&&(tl>60||(tl<30&&tl>0)))?'text-danger fw-bold':'')+'">'+(isWaf?'—':tl)+'</td>'
      +'<td class="'+((!isWaf&&(dl>160||(dl<70&&dl>0)))?'text-warning fw-bold':'')+'">'+(isWaf?'—':dl)+'</td>'
      +'<td class="'+((!isWaf&&h1!==1)?'text-danger fw-bold':'')+'">'+(isWaf?'—':h1)+'</td>'
      +'<td>'+(isWaf?'—':(r['Word Count']||0))+'</td>'
      +'<td>'+(r['Canonical URL']?'✅':'❌')+'</td>'
      +'<td style="color:'+(r.Indexable?'#059669':'#dc2626')+';font-weight:700">'+(r.Indexable?'✓':'✗')+'</td>'
      +'<td><span class="badge bg-danger">'+(r['Critical Count']||0)+'</span></td>'
      +'<td><span class="badge bg-warning text-dark">'+(r['Warning Count']||0)+'</span></td>'
      +'<td style="font-size:.73rem;color:#64748b;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(top.substring(0,70))+'</td>'
      +'</tr>';
  }).join('');
  DT=$('#auditTable').DataTable({pageLength:50,order:[[10,'desc']],scrollX:true,destroy:true});
}

rebuildTable();

// SF comparison
(function(){
  var rows=[
    ['Meta Title','✅ Length, content, missing','✅ + duplicate detection + pixel width',''],
    ['Meta Description','✅ Length, content, missing','✅ + duplicates',''],
    ['H1/H2/H3 Tags','✅ Count + first instance','✅ All instances, duplicates',''],
    ['Canonical URLs','✅ Present, cross-domain check','✅ + chains + loops',''],
    ['Meta Robots / noindex','✅','✅',''],
    ['X-Robots-Tag (HTTP header)','✅','✅',''],
    ['Response Time (TTFB)','✅ Navigation Timing API','✅ HTTP TTFB','Both browser-level'],
    ['Full JS Render Time','✅ full_load_ms (unique!)','❌ HTTP only','We wait for JS hydration'],
    ['HTTPS detection','✅','✅',''],
    ['HTTP Status Codes','✅','✅',''],
    ['Redirects','✅ Detected','✅ Full chain tracing',''],
    ['Image Alt Text','✅ Missing / empty','✅ + too long',''],
    ['Internal/External Links','✅ Counts','✅ Full link export',''],
    ['Open Graph Tags','✅ title/desc/image/type','✅',''],
    ['Twitter Card','✅','✅',''],
    ['Schema.org / Structured Data','✅ Types detected','✅ + validation',''],
    ['Hreflang','✅ Languages detected','✅ + return link validation',''],
    ['Word Count','✅','✅',''],
    ['Flesch Readability','✅ (unique!)','❌','SF omits this; we include it'],
    ['Duplicate Content','✅ Hash-based detection','✅ Hash-based','Newly implemented'],
    ['robots.txt Parsing','✅ Disallow rules, sitemaps','✅','Newly implemented'],
    ['WAF / Bot Detection','✅ (unique!)','❌','We flag bot-blocked pages'],
    ['JS / SPA Rendering','✅ Playwright headless Chrome','✅ Custom rendering','Both use real browsers'],
    ['Page Speed / Core Web Vitals','⚠️ TTFB + Full Load Time','✅ Full CWV suite','LCP/CLS planned'],
    ['Sitemap crawl mode','⚠️ Partial','✅ Full','Planned improvement'],
    ['Custom extraction (XPath)','❌ Future','✅',''],
    ['Excel Export','✅','✅',''],
    ['Interactive HTML Report','✅ (unique!)','❌','Shareable self-contained file'],
  ];
  var t=document.getElementById('sfTable');
  if(!t)return;
  t.innerHTML=rows.map(function(row){
    var us=row[1],sf=row[2],note=row[3];
    return '<tr>'
      +'<td class="fw-semibold">'+esc(row[0])+'</td>'
      +'<td style="color:'+(us.startsWith('✅')?'#059669':us.startsWith('⚠️')?'#d97706':'#94a3b8')+'">'+us+'</td>'
      +'<td style="color:'+(sf.startsWith('✅')?'#059669':sf.startsWith('⚠️')?'#d97706':'#94a3b8')+'">'+sf+'</td>'
      +'<td class="text-muted fst-italic">'+esc(note)+'</td>'
      +'</tr>';
  }).join('');
})();

// Detail pane
function showDetail(i){
  var r=RESULTS[i];if(!r)return;
  var score=pageScore(r);var gd=gradeOf(score);
  var isWaf=r['WAF Blocked'];
  function pr(label,val,sub){
    return '<div class="param-row"><div class="param-label">'+esc(label)+'</div>'
      +'<div class="param-val">'+val+(sub?'<br><span style="color:#94a3b8;font-size:.72rem">'+esc(sub)+'</span>':'')+'</div></div>';
  }
  function prScore(label,val,sub,s){
    var g=gradeOf(s);
    return '<div class="param-row"><div class="param-label">'+esc(label)+'</div>'
      +'<div class="param-val">'+val+(sub?'<br><span style="color:'+g.c+';font-size:.72rem">'+esc(sub)+'</span>':'')+'</div>'
      +'<div style="display:flex;align-items:center;gap:6px;flex-shrink:0">'
      +'<div class="score-bar-wrap"><div class="score-bar"><div class="score-bar-fill" style="width:'+s+'%;background:'+g.c+'"></div></div></div>'
      +'<span class="grade-badge" style="color:'+g.c+';background:'+g.bg+'">'+s+' '+g.g+'</span>'
      +'</div></div>';
  }
  var crits=(r['Critical Issues']||'').split(';').filter(Boolean);
  var warns=(r.Warnings||'').split(';').filter(Boolean);
  var infos=(r.Info||'').split(';').filter(Boolean);
  var tl=r['Title Length']||0,dl=r['Meta Description Length']||0,h1=r['H1 Count']||0;
  var ts=tl===0?0:tl>=30&&tl<=60?100:tl<20?25:tl<30?60:tl<=70?72:35;
  var ds=dl===0?0:dl>=70&&dl<=160?100:dl<50?30:dl<70?62:50;
  var rt=r['Response Time (ms)']||0;
  var rts=rt===0?0:rt<500?100:rt<1000?90:rt<1500?75:rt<2500?55:rt<3500?30:10;
  var sc=r['Status Code']||0;
  document.getElementById('detailContent').innerHTML=
    '<div class="d-flex align-items-center gap-2 mb-3 flex-wrap">'
    +'<span class="badge bg-'+(sc===200?'success':'danger')+'">'+sc+'</span>'
    +(isWaf?'<span class="badge" style="background:#7c3aed">WAF Blocked</span>':'')
    +(r.HTTPS?'<span class="badge bg-success">HTTPS</span>':'')
    +(r.Indexable?'<span class="badge bg-success">Indexable</span>':'<span class="badge bg-danger">Not Indexable</span>')
    +'<span class="ms-auto grade-badge" style="color:'+gd.c+';background:'+gd.bg+';font-size:1rem">'+score+' — Grade '+gd.g+'</span>'
    +'</div>'
    +'<div class="mb-2 small"><a href="'+esc(r.URL)+'" target="_blank" style="word-break:break-all">'+esc(r.URL)+'</a></div>'
    +(r['Final URL']&&r['Final URL']!==r.URL?'<div class="mb-2 small text-muted">→ Redirects to: '+esc(r['Final URL'].substring(0,70))+'</div>':'')
    +(isWaf?'<div class="alert alert-warning py-2 small"><b>⚠️ WAF Detected</b> — Metrics below reflect the challenge page, not real content.</div>':'')
    +'<div class="section-hdr">📝 Content</div>'
    +prScore('Meta Title',r.Title?'"'+esc(r.Title.substring(0,70))+'"':'<span class="text-danger">Missing</span>',tl+' chars',ts)
    +prScore('Meta Description',r['Meta Description']?'"'+esc(r['Meta Description'].substring(0,100))+'"':'<span class="text-warning">Missing</span>',dl+' chars',ds)
    +prScore('H1 Tag',r['H1 First']?esc(r['H1 First']):'<span class="text-danger">Missing</span>',h1===1?'Perfect — exactly one H1':h1>1?(h1+' H1 tags — only 1 recommended'):'Missing',h1===1?100:0)
    +pr('H2 / H3',(r['H2 Count']||0)+' H2 · '+(r['H3 Count']||0)+' H3',r['H2 First']?'First H2: "'+esc(r['H2 First'].substring(0,50))+'"':'')
    +pr('Word Count',isWaf?'N/A':((r['Word Count']||0)+' words'),isWaf?'WAF blocked':((r['Paragraph Count']||0)+' paragraphs'))
    +(r['Flesch Reading Ease']?pr('Readability','Flesch: '+r['Flesch Reading Ease'],r['Flesch Reading Ease']>=60?'Easy to read':r['Flesch Reading Ease']>=30?'Moderate':'Difficult'):'')
    +'<div class="section-hdr">⚙️ Technical</div>'
    +prScore('HTTPS',r.HTTPS?'✅ Secure':'❌ HTTP only',r.HTTPS?'Secure connection':'Ranking penalty',r.HTTPS?100:0)
    +prScore('Response Time (TTFB)',rt?rt+'ms':'N/A','Time To First Byte — what Google measures',rts)
    +(r['Full Load Time (ms)']&&r['Full Load Time (ms)']!==rt?pr('Full JS Load Time',r['Full Load Time (ms)']+'ms','Includes JS rendering + SPA hydration'):'')
    +pr('Canonical URL',r['Canonical URL']?'<code style="font-size:.72rem">'+esc(r['Canonical URL'].substring(0,70))+'</code>':'<span class="text-warning">Missing</span>',r['Canonical URL']?'Canonical tag present':'Duplicate content risk')
    +pr('Meta Robots',r['Meta Robots']||'Not set (defaults to index, follow)')
    +pr('Page Size',(r['Page Size (KB)']||0)+' KB',(r['Text to HTML Ratio (%)']||0)+'% text-to-HTML ratio')
    +'<div class="section-hdr">🖼️ Media &amp; Links</div>'
    +pr('Images',(r['Image Count']||0)+' total',r['Images Missing Alt']?(r['Images Missing Alt']+' missing alt text'):'All images have alt text')
    +pr('Links',(r['Internal Links']||0)+' internal · '+(r['External Links']||0)+' external · '+(r['Nofollow Links']||0)+' nofollow')
    +'<div class="section-hdr">🌐 Social &amp; Schema</div>'
    +pr('Open Graph',r['OG Title']?'"'+esc(r['OG Title'].substring(0,55))+'"':'og:title not set','desc '+(r['OG Description']?'✅':'❌')+' · image '+(r['OG Image']?'✅':'❌'))
    +pr('Structured Data',r['Has Structured Data']?esc(r['Schema Types']):'None detected')
    +pr('Hreflang',r['Hreflang Languages']||'None (may be intentional)')
    +((crits.length||warns.length||infos.length)?
      '<div class="section-hdr">🚨 Issues</div>'
      +crits.map(function(x){return '<div class="issue-crit py-1 small">❌ '+esc(x)+'</div>';}).join('')
      +warns.map(function(x){return '<div class="issue-warn py-1 small">⚠️ '+esc(x)+'</div>';}).join('')
      +infos.map(function(x){return '<div class="issue-info py-1 small">ℹ️ '+esc(x)+'</div>';}).join('')
    :'')
    +'<div style="height:32px"></div>';
  document.getElementById('detailPane').style.display='block';
}
function closePane(){document.getElementById('detailPane').style.display='none';}
})();
</script>
"""


def _build_html_report(data_json: str, site_url: str, generated_at: str) -> str:
    import html as _html
    site_esc = _html.escape(site_url)
    date_str = generated_at[:10]
    # Escape </script> in JSON to prevent premature tag closure in browser
    data_safe = data_json.replace("</", "<\\/")

    return (
        "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n"
        "<meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n"
        f"<title>SEO Audit \u2014 {site_esc}</title>\n"
        "<link href=\"https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css\" rel=\"stylesheet\">\n"
        "<link href=\"https://cdn.datatables.net/1.13.8/css/dataTables.bootstrap5.min.css\" rel=\"stylesheet\">\n"
        + _R_CSS
        + "</head>\n<body>\n"
        "<div class=\"dyn-bg\"><span></span><span></span></div>\n"
        "<div class=\"hero mb-4\">\n<div class=\"container\">\n"
        "<div class=\"d-flex align-items-center gap-3 mb-3\">\n"
        "  <div style=\"width:38px;height:38px;background:rgba(255,255,255,.15);border-radius:8px;"
        "display:flex;align-items:center;justify-content:center;font-size:20px\">&#x1F525;</div>\n"
        "  <div><div class=\"fw-bold\">SEO Audit Report</div>"
        f"<div class=\"opacity-75 small\">{site_esc}</div></div>\n"
        f"  <div class=\"ms-auto opacity-60 small\">{date_str}</div>\n"
        "</div>\n"
        "<div class=\"row g-3 align-items-center\">\n"
        "  <div class=\"col-auto\">"
        "<div class=\"score-circle\" id=\"heroScore\">&#8212;</div>"
        "<div class=\"text-center mt-1 small opacity-75\" id=\"heroGrade\"></div></div>\n"
        "  <div class=\"col\"><div class=\"row g-2\" id=\"heroStats\"></div></div>\n"
        "</div>\n</div>\n</div>\n"
        "<div class=\"container pb-5\">\n"
        "  <div class=\"card p-4 mb-4\">\n"
        "    <h5 class=\"fw-bold mb-3\" style=\"color:var(--navy)\">&#127919; Priority Improvements</h5>\n"
        "    <div id=\"priorityList\"><div class=\"text-muted small\">Loading&#8230;</div></div>\n"
        "  </div>\n"
        "  <div class=\"row g-3 mb-4\">\n"
        "    <div class=\"col-lg-6\"><div class=\"card p-4 h-100\">"
        "<h6 class=\"fw-bold text-success mb-3\">&#9989; What's Working Well</h6>"
        "<div id=\"winsList\"></div></div></div>\n"
        "    <div class=\"col-lg-6\"><div class=\"card p-4 h-100\">"
        "<h6 class=\"fw-bold text-danger mb-3\">&#9888;&#65039; What Needs Attention</h6>"
        "<div id=\"issuesList\"></div></div></div>\n"
        "  </div>\n"
        "  <div class=\"card p-0 mb-4 overflow-hidden\" id=\"tableSection\">\n"
        "    <div class=\"px-4 py-3 border-bottom d-flex justify-content-between align-items-center\""
        " style=\"background:var(--navy)\">\n"
        "      <span class=\"text-white fw-bold\">All Pages"
        "<span id=\"filterBadge\" class=\"ms-2 badge bg-warning text-dark\" style=\"display:none\"></span></span>\n"
        "      <span class=\"text-white opacity-60 small\">click row for full SEO breakdown</span>\n"
        "    </div>\n"
        "    <div class=\"table-responsive\">\n"
        "      <table id=\"auditTable\" class=\"table table-hover mb-0\">\n"
        "        <thead class=\"table-dark\"><tr>"
        "<th>URL</th><th>Status</th><th>TTFB</th><th>Score</th>"
        "<th title=\"Title Length\">TL</th><th title=\"Description Length\">DL</th>"
        "<th>H1</th><th>Words</th><th>Canon</th><th>Idx</th>"
        "<th>Crit</th><th>Warn</th><th>Top Issue</th>"
        "</tr></thead>\n"
        "        <tbody id=\"auditBody\"></tbody>\n"
        "      </table>\n"
        "    </div>\n"
        "  </div>\n"
        "  <div class=\"card p-4 mb-4\">\n"
        "    <h5 class=\"fw-bold mb-3\" style=\"color:var(--navy)\">&#128203; Coverage vs. Screaming Frog</h5>\n"
        "    <div class=\"table-responsive\">\n"
        "      <table class=\"table table-sm table-bordered\" style=\"font-size:.8rem\">\n"
        "        <thead class=\"table-light\"><tr><th>Signal</th><th>This Tool</th><th>Screaming Frog</th><th>Notes</th></tr></thead>\n"
        "        <tbody id=\"sfTable\"></tbody>\n"
        "      </table>\n"
        "    </div>\n"
        "  </div>\n"
        "</div>\n"
        "<div id=\"detailPane\">\n"
        "  <div class=\"close-pane d-flex justify-content-between align-items-center\">\n"
        "    <strong>Page Detail</strong>\n"
        "    <button class=\"btn btn-sm btn-outline-secondary\" onclick=\"closePane()\">&#10005; Close</button>\n"
        "  </div>\n"
        "  <div id=\"detailContent\"></div>\n"
        "</div>\n"
        f"<script type=\"application/json\" id=\"__audit_data__\">{data_safe}</script>\n"
        "<script src=\"https://code.jquery.com/jquery-3.7.1.min.js\"></script>\n"
        "<script src=\"https://cdn.datatables.net/1.13.8/js/jquery.dataTables.min.js\"></script>\n"
        "<script src=\"https://cdn.datatables.net/1.13.8/js/dataTables.bootstrap5.min.js\"></script>\n"
        + _R_JS
        + "</body>\n</html>"
    )



@app.delete("/api/audit/{job_id}")
def delete_job(job_id: str):
    with _JOBS_LOCK:
        if job_id not in _JOBS:
            raise HTTPException(status_code=404, detail="Job not found")
        del _JOBS[job_id]
    return {"deleted": job_id}
