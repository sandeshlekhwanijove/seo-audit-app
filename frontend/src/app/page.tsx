"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Search, Download, RefreshCw, AlertCircle, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import ScoreGauge from "@/components/ScoreGauge";
import StatCard from "@/components/StatCard";
import WinsIssues from "@/components/WinsIssues";
import ChartsRow from "@/components/ChartsRow";
import ResultsTable from "@/components/ResultsTable";
import { startAudit, getStatus, getResults, excelDownloadUrl, AuditStatus, AuditResults } from "@/lib/api";

type Phase = "idle" | "running" | "done" | "error";

export default function Home() {
  const [url, setUrl]             = useState("");
  const [mode, setMode]           = useState<"page" | "site">("site");
  const [maxPages, setMaxPages]   = useState(50);
  const [delay, setDelay]         = useState(1);
  const [showAdv, setShowAdv]     = useState(false);

  const [phase, setPhase]         = useState<Phase>("idle");
  const [jobId, setJobId]         = useState<string | null>(null);
  const [status, setStatus]       = useState<AuditStatus | null>(null);
  const [results, setResults]     = useState<AuditResults | null>(null);
  const [error, setError]         = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  useEffect(() => {
    return () => stopPoll();
  }, [stopPoll]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setPhase("running");
    setError(null);
    setResults(null);
    setStatus(null);
    try {
      const { job_id } = await startAudit({
        url: url.trim().startsWith("http") ? url.trim() : `https://${url.trim()}`,
        mode,
        max_pages: maxPages,
        delay_s: delay,
      });
      setJobId(job_id);
      pollRef.current = setInterval(() => poll(job_id), 2000);
    } catch (e) {
      setError(String(e));
      setPhase("error");
    }
  }

  function reset() {
    stopPoll();
    setPhase("idle");
    setJobId(null);
    setStatus(null);
    setResults(null);
    setError(null);
  }

  const sum = results?.summary;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-gradient-to-r from-[#1a3c5e] to-[#2d7dd2] text-white py-8 px-4 shadow-lg">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-3 mb-1">
            <span className="text-2xl">📊</span>
            <h1 className="text-2xl font-extrabold tracking-tight">SEO Audit Tool</h1>
          </div>
          <p className="text-blue-200 text-sm ml-10">
            Technical SEO crawler — catches what Screaming Frog catches, in your browser
          </p>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Audit form */}
        {(phase === "idle" || phase === "error") && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 mb-6 fade-up">
            <h2 className="text-lg font-bold text-slate-800 mb-5">Start a New Audit</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide block mb-1.5">
                    URL to Audit
                  </label>
                  <input
                    type="text"
                    value={url}
                    onChange={e => setUrl(e.target.value)}
                    placeholder="https://example.com"
                    required
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide block mb-1.5">
                    Audit Mode
                  </label>
                  <select
                    value={mode}
                    onChange={e => setMode(e.target.value as "page" | "site")}
                    className="border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    <option value="site">Full Site Crawl</option>
                    <option value="page">Single Page</option>
                  </select>
                </div>
              </div>

              {/* Advanced options */}
              <button
                type="button"
                onClick={() => setShowAdv(v => !v)}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
              >
                {showAdv ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                Advanced options
              </button>

              {showAdv && (
                <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50 rounded-xl">
                  <div>
                    <label className="text-xs font-semibold text-slate-600 block mb-1.5">Max pages</label>
                    <input type="number" min={1} max={200} value={maxPages}
                      onChange={e => setMaxPages(Number(e.target.value))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600 block mb-1.5">Delay between pages (s)</label>
                    <input type="number" min={0} max={10} step={0.5} value={delay}
                      onChange={e => setDelay(Number(e.target.value))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 text-red-600 bg-red-50 rounded-xl p-4 text-sm">
                  <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-3 rounded-xl transition-colors"
              >
                <Search size={16} />
                Start Audit
              </button>
            </form>
          </div>
        )}

        {/* Progress */}
        {phase === "running" && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 mb-6 fade-up">
            <div className="flex items-center gap-3 mb-4">
              <Loader2 size={20} className="text-blue-500 animate-spin" />
              <h2 className="text-lg font-bold text-slate-800">Auditing in progress…</h2>
            </div>
            <div className="mb-4">
              <div className="flex justify-between text-xs text-slate-500 mb-1.5">
                <span>{status?.pages_done ?? 0} pages crawled</span>
                <span>{status?.progress ?? 0}%</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-3">
                <div
                  className="bg-blue-500 h-3 rounded-full pulse-bar transition-all duration-500"
                  style={{ width: `${Math.max(4, status?.progress ?? 0)}%` }}
                />
              </div>
            </div>
            {status?.current_url && (
              <p className="text-xs text-slate-400 truncate">
                Current: <span className="text-slate-600 font-mono">{status.current_url}</span>
              </p>
            )}
          </div>
        )}

        {/* Results */}
        {phase === "done" && results && sum && (
          <>
            {/* Top bar */}
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-xl font-extrabold text-slate-800">
                  {results.request?.url?.replace(/^https?:\/\//, "")}
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {sum.total} pages · Generated {new Date(results.finished_at).toLocaleString()}
                </p>
              </div>
              <div className="flex gap-2">
                <a
                  href={excelDownloadUrl(results.job_id)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold hover:bg-slate-50 transition-colors"
                  download
                >
                  <Download size={15} />
                  Excel
                </a>
                <button
                  onClick={reset}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
                >
                  <RefreshCw size={15} />
                  New Audit
                </button>
              </div>
            </div>

            {/* Score + stats */}
            <div className="grid grid-cols-2 lg:grid-cols-7 gap-4 mb-6 fade-up">
              <div className="col-span-2 lg:col-span-1 bg-gradient-to-br from-[#1a3c5e] to-[#2d7dd2] rounded-2xl p-5 flex flex-col items-center justify-center shadow-md">
                <div className="text-xs text-blue-200 uppercase tracking-widest mb-2 font-semibold">SEO Score</div>
                <ScoreGauge score={sum.score} />
              </div>
              <div className="col-span-2 lg:col-span-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <StatCard label="Pages"        value={sum.total}                                  color="#2563eb" />
                <StatCard label="Critical"     value={sum.critical_pages}  sub="pages affected"  color="#ef4444" />
                <StatCard label="Warnings"     value={sum.warning_pages}   sub="pages affected"  color="#f59e0b" />
                <StatCard label="Indexable"    value={sum.indexable}       sub={`of ${sum.total}`} color="#10b981" />
                <StatCard label="Avg Response" value={`${sum.avg_response_ms}ms`}                 color={sum.avg_response_ms > 2000 ? "#f97316" : "#10b981"} />
                <StatCard label="WAF Blocked"  value={sum.waf_blocked}     sub="pages"           color="#7c3aed" />
              </div>
            </div>

            {/* Wins & Issues */}
            <WinsIssues results={results.results} summary={sum} />

            {/* Charts */}
            <ChartsRow results={results.results} summary={sum} />

            {/* Table */}
            <ResultsTable results={results.results} />
          </>
        )}
      </main>
    </div>
  );
}
