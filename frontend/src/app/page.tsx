"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Search, Download, RefreshCw, AlertCircle, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import ScoreGauge from "@/components/ScoreGauge";
import WinsIssues from "@/components/WinsIssues";
import ChartsRow from "@/components/ChartsRow";
import ResultsTable from "@/components/ResultsTable";
import { startAudit, getStatus, getResults, excelDownloadUrl, AuditStatus, AuditResults } from "@/lib/api";

type Phase = "idle" | "running" | "done" | "error";

function StatCard({ label, value, sub, color = "#2563eb" }: {
  label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col gap-0.5">
      <div className="text-2xl font-extrabold leading-none" style={{ color }}>{value}</div>
      <div className="text-xs font-semibold text-slate-700 mt-1">{label}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

export default function Home() {
  const [url, setUrl]           = useState("");
  const [mode, setMode]         = useState<"page" | "site">("site");
  const [maxPages, setMaxPages] = useState(50);
  const [delay, setDelay]       = useState(1);
  const [showAdv, setShowAdv]   = useState(false);

  const [phase, setPhase]       = useState<Phase>("idle");
  const [status, setStatus]     = useState<AuditStatus | null>(null);
  const [results, setResults]   = useState<AuditResults | null>(null);
  const [error, setError]       = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const jobRef  = useRef<string | null>(null);

  const stopPoll = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const poll = useCallback(async (jid: string) => {
    try {
      const s = await getStatus(jid);
      setStatus(s);
      if (s.status === "done") {
        stopPoll();
        const r = await getResults(jid);
        setResults(r);
        setPhase("done");
      } else if (s.status === "error") {
        stopPoll();
        setError(s.error ?? "Unknown error");
        setPhase("error");
      }
    } catch (e) {
      stopPoll();
      setError(String(e));
      setPhase("error");
    }
  }, [stopPoll]);

  useEffect(() => () => stopPoll(), [stopPoll]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setPhase("running");
    setError(null);
    setResults(null);
    setStatus(null);
    try {
      const normalised = url.trim().startsWith("http") ? url.trim() : `https://${url.trim()}`;
      const { job_id } = await startAudit({ url: normalised, mode, max_pages: maxPages, delay_s: delay });
      jobRef.current = job_id;
      pollRef.current = setInterval(() => poll(job_id), 2000);
    } catch (e) {
      setError(String(e));
      setPhase("error");
    }
  }

  function reset() {
    stopPoll();
    setPhase("idle");
    jobRef.current = null;
    setStatus(null);
    setResults(null);
    setError(null);
  }

  const sum = results?.summary;
  const rtDisplay = sum?.avg_response_ms ? `${sum.avg_response_ms}ms` : "—";
  const rtColor   = (sum?.avg_response_ms ?? 0) > 2000 ? "#dc2626" : (sum?.avg_response_ms ?? 0) > 1000 ? "#d97706" : "#059669";

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Navigation bar ─────────────────────────────────────────────────── */}
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#1a3c5e] flex items-center justify-center">
              <span className="text-white text-sm font-black">S</span>
            </div>
            <span className="font-bold text-[#1a3c5e] text-sm tracking-tight">SEO Audit Tool</span>
            <span className="text-slate-300 text-sm">|</span>
            <span className="text-xs text-slate-500">Technical SEO Crawler</span>
          </div>
          {phase === "done" && results && (
            <div className="flex items-center gap-2">
              <a href={excelDownloadUrl(results.job_id)} download
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 transition-colors">
                <Download size={13} /> Export Excel
              </a>
              <button onClick={reset}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#1a3c5e] hover:bg-[#142f4a] text-white transition-colors">
                <RefreshCw size={13} /> New Audit
              </button>
            </div>
          )}
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-8">

        {/* ── Hero / form ──────────────────────────────────────────────────── */}
        {(phase === "idle" || phase === "error") && (
          <div className="fade-up">
            {/* Hero text */}
            <div className="text-center mb-8">
              <h1 className="text-3xl font-extrabold text-[#1a3c5e] mb-2">
                Technical SEO Audit
              </h1>
              <p className="text-slate-500 max-w-xl mx-auto">
                Crawls your site with a real browser, scores every SEO signal per page, and tells you exactly what to fix.
              </p>
            </div>

            {/* Form card */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 max-w-3xl mx-auto">
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-1.5">
                      Website URL
                    </label>
                    <input
                      type="text"
                      value={url}
                      onChange={e => setUrl(e.target.value)}
                      placeholder="https://example.com"
                      required
                      className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a3c5e]/30 focus:border-[#1a3c5e]"
                    />
                  </div>
                  <div className="w-44">
                    <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-1.5">
                      Mode
                    </label>
                    <select
                      value={mode}
                      onChange={e => setMode(e.target.value as "page" | "site")}
                      className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a3c5e]/30 bg-white"
                    >
                      <option value="site">Full Site Crawl</option>
                      <option value="page">Single Page</option>
                    </select>
                  </div>
                </div>

                <button type="button" onClick={() => setShowAdv(v => !v)}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700 transition-colors">
                  {showAdv ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  Advanced options
                </button>

                {showAdv && (
                  <div className="grid grid-cols-2 gap-4 bg-slate-50 rounded-xl p-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1.5">Max pages (1–200)</label>
                      <input type="number" min={1} max={200} value={maxPages}
                        onChange={e => setMaxPages(Number(e.target.value))}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a3c5e]/30" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1.5">Delay between pages (seconds)</label>
                      <input type="number" min={0} max={10} step={0.5} value={delay}
                        onChange={e => setDelay(Number(e.target.value))}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a3c5e]/30" />
                    </div>
                  </div>
                )}

                {error && (
                  <div className="flex items-start gap-2 text-red-700 bg-red-50 border border-red-200 rounded-xl p-4 text-sm">
                    <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <button type="submit"
                  className="flex items-center gap-2 bg-[#1a3c5e] hover:bg-[#142f4a] text-white font-semibold px-8 py-3 rounded-xl transition-colors">
                  <Search size={16} />
                  Run Audit
                </button>
              </form>
            </div>

            {/* Feature bullets */}
            <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto">
              {[
                { icon: "🔍", title: "Screaming Frog-level depth", desc: "Crawls up to 200 pages with a real Chrome browser" },
                { icon: "📊", title: "Per-parameter scoring", desc: "Every SEO signal gets an individual A–F grade" },
                { icon: "🛡️", title: "WAF detection", desc: "Identifies pages blocked by bot-protection systems" },
              ].map(f => (
                <div key={f.title} className="bg-white rounded-xl border border-slate-200 p-5">
                  <div className="text-2xl mb-2">{f.icon}</div>
                  <div className="font-semibold text-[#1a3c5e] text-sm mb-1">{f.title}</div>
                  <div className="text-xs text-slate-500">{f.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Progress ─────────────────────────────────────────────────────── */}
        {phase === "running" && (
          <div className="max-w-2xl mx-auto bg-white rounded-2xl border border-slate-200 shadow-sm p-8 fade-up">
            <div className="flex items-center gap-3 mb-6">
              <Loader2 size={22} className="text-[#1a3c5e] animate-spin" />
              <div>
                <h2 className="font-bold text-[#1a3c5e]">Audit in progress…</h2>
                <p className="text-xs text-slate-400 mt-0.5">The browser is crawling and scoring each page</p>
              </div>
            </div>
            <div className="mb-3">
              <div className="flex justify-between text-xs text-slate-500 mb-2">
                <span>{status?.pages_done ?? 0} pages crawled</span>
                <span className="font-semibold text-[#1a3c5e]">{status?.progress ?? 0}%</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2.5">
                <div className="bg-[#1a3c5e] h-2.5 rounded-full pulse-bar transition-all duration-500"
                  style={{ width: `${Math.max(3, status?.progress ?? 0)}%` }} />
              </div>
            </div>
            {status?.current_url && (
              <div className="mt-4 p-3 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-400 mb-0.5 font-semibold uppercase tracking-wide">Currently crawling</p>
                <p className="text-xs text-slate-600 font-mono truncate">{status.current_url}</p>
              </div>
            )}
          </div>
        )}

        {/* ── Results dashboard ─────────────────────────────────────────────── */}
        {phase === "done" && results && sum && (
          <div className="fade-up">

            {/* Page header */}
            <div className="flex items-start justify-between mb-6">
              <div>
                <h2 className="text-xl font-extrabold text-[#1a3c5e]">
                  {results.request?.url?.replace(/^https?:\/\//, "")}
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  {sum.total} page{sum.total !== 1 ? "s" : ""} audited
                  {results.finished_at && ` · ${new Date(results.finished_at).toLocaleString()}`}
                </p>
              </div>
            </div>

            {/* ── Score + summary stats ── */}
            <div className="grid grid-cols-12 gap-4 mb-6">
              {/* Score card */}
              <div className="col-span-12 sm:col-span-4 lg:col-span-3 bg-[#1a3c5e] rounded-2xl p-6 flex flex-col items-center justify-center shadow-md">
                <div className="text-xs text-blue-200 uppercase tracking-widest font-semibold mb-3">Overall SEO Score</div>
                <ScoreGauge score={sum.score} />
              </div>

              {/* Stats grid */}
              <div className="col-span-12 sm:col-span-8 lg:col-span-9 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <StatCard label="Pages Audited"  value={sum.total}               color="#1a3c5e" />
                <StatCard label="Critical Issues" value={sum.critical_pages}     sub="pages affected" color="#dc2626" />
                <StatCard label="Warnings"        value={sum.warning_pages}      sub="pages affected" color="#d97706" />
                <StatCard label="Indexable"       value={sum.indexable}          sub={`of ${sum.total} pages`} color="#059669" />
                <StatCard label="Avg Response"    value={rtDisplay}              sub={sum.avg_response_ms ? "server response time" : "no timing data"} color={rtColor} />
                <StatCard label="WAF Blocked"     value={sum.waf_blocked}        sub="bot-protected" color="#7c3aed" />
              </div>
            </div>

            {/* Wins & Issues */}
            <WinsIssues results={results.results} summary={sum} />

            {/* Charts */}
            <ChartsRow results={results.results} summary={sum} />

            {/* Divider */}
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 h-px bg-slate-200" />
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Page-by-page results</span>
              <div className="flex-1 h-px bg-slate-200" />
            </div>

            {/* Table */}
            <ResultsTable results={results.results} />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-16 border-t border-slate-200 bg-white py-6 text-center text-xs text-slate-400">
        SEO Audit Tool · Built with FastAPI + Next.js · Powered by Playwright
      </footer>
    </div>
  );
}
