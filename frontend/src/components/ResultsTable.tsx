"use client";

import { useState, useMemo, useEffect } from "react";
import { PageResult } from "@/lib/api";
import { ChevronUp, ChevronDown, ChevronsUpDown, X } from "lucide-react";
import PageDetailPanel from "./PageDetailPanel";
import type { FilterMode } from "@/app/page";

type SortDir = "asc" | "desc" | null;
type SortKey = keyof PageResult | "_pageScore";

function scColor(sc: number) {
  if (sc >= 200 && sc < 300) return "#059669";
  if (sc >= 300 && sc < 400) return "#d97706";
  return "#dc2626";
}
function rtColor(rt: number) {
  if (rt > 3000) return "#dc2626";
  if (rt > 1500) return "#d97706";
  return "#059669";
}

// Lightweight page score for the table (mirrors PageDetailPanel logic)
function quickPageScore(r: PageResult): number {
  if (r["WAF Blocked"]) return 0;
  const tl = r["Title Length"] ?? 0;
  const dl = r["Meta Description Length"] ?? 0;
  const h1 = r["H1 Count"] ?? 0;
  const ts = tl === 0 ? 0 : tl >= 30 && tl <= 60 ? 100 : tl < 20 ? 25 : tl < 30 ? 60 : tl <= 70 ? 72 : 35;
  const ds = dl === 0 ? 0 : dl >= 70 && dl <= 160 ? 100 : dl < 50 ? 30 : dl < 70 ? 62 : 50;
  const hs = h1 === 0 ? 0 : h1 === 1 ? 100 : 45;
  const ht = r.HTTPS ? 100 : 0;
  const cn = r["Canonical URL"]?.trim() ? 100 : 30;
  const rt2 = r["Response Time (ms)"] ?? 0;
  const rts = rt2 === 0 ? 0 : rt2 < 500 ? 100 : rt2 < 1000 ? 90 : rt2 < 1500 ? 75 : rt2 < 2500 ? 55 : rt2 < 3500 ? 30 : 10;
  return Math.round((ts * 20 + ds * 15 + hs * 15 + ht * 15 + cn * 10 + rts * 10) / 85);
}

function ScorePill({ score }: { score: number }) {
  const color = score >= 75 ? "#059669" : score >= 55 ? "#d97706" : "#dc2626";
  const bg = score >= 75 ? "#d1fae5" : score >= 55 ? "#fef3c7" : "#fee2e2";
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold" style={{ color, background: bg }}>
      {score}
    </span>
  );
}

const FILTER_LABELS: Record<NonNullable<FilterMode>, string> = {
  critical: "Critical Issues",
  warning: "Warnings",
  indexable: "Indexable pages",
  "non-indexable": "Non-indexable pages",
  waf: "WAF-blocked pages",
  all: "All pages",
};

export default function ResultsTable({ results, filterMode, onClearFilter }: {
  results: PageResult[];
  filterMode?: FilterMode;
  onClearFilter?: () => void;
}) {
  const [search, setSearch]     = useState("");
  const [sortKey, setSortKey]   = useState<SortKey>("Critical Count");
  const [sortDir, setSortDir]   = useState<SortDir>("desc");
  const [page, setPage]         = useState(0);
  const [detail, setDetail]     = useState<PageResult | null>(null);
  const PER_PAGE = 50;

  // Reset page when filter changes
  useEffect(() => { setPage(0); }, [filterMode]);

  const withScore = useMemo(() =>
    results.map(r => ({ ...r, _pageScore: quickPageScore(r) })),
    [results]
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return withScore.filter(r => {
      // Apply stat-card filter
      if (filterMode && filterMode !== "all") {
        if (filterMode === "critical" && (r["Critical Count"] ?? 0) < 1) return false;
        if (filterMode === "warning" && (r["Warning Count"] ?? 0) < 1) return false;
        if (filterMode === "indexable" && !r.Indexable) return false;
        if (filterMode === "non-indexable" && r.Indexable) return false;
        if (filterMode === "waf" && !r["WAF Blocked"]) return false;
      }
      // Apply text search
      return !q ||
        (r.URL ?? "").toLowerCase().includes(q) ||
        (r.Title ?? "").toLowerCase().includes(q) ||
        (r["Critical Issues"] ?? "").toLowerCase().includes(q) ||
        (r.Warnings ?? "").toLowerCase().includes(q);
    });
  }, [withScore, search, filterMode]);

  const sorted = useMemo(() => {
    if (!sortDir) return filtered;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey as keyof typeof a] ?? "";
      const bv = b[sortKey as keyof typeof b] ?? "";
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  const paged = sorted.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
  const totalPages = Math.ceil(sorted.length / PER_PAGE);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : d === "desc" ? null : "asc");
    else { setSortKey(k); setSortDir("desc"); }
    setPage(0);
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <ChevronsUpDown size={11} className="opacity-40" />;
    return sortDir === "asc" ? <ChevronUp size={11} /> : sortDir === "desc" ? <ChevronDown size={11} /> : <ChevronsUpDown size={11} className="opacity-40" />;
  }

  const thClass = "px-3 py-3 text-left text-xs font-bold uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:bg-[#0f2840] transition-colors";

  return (
    <>
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h3 className="font-bold text-[#1a3c5e] flex items-center gap-2">
              All Pages
              {filterMode && filterMode !== "all" && (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-100 text-blue-700">
                  {FILTER_LABELS[filterMode]}
                  <button onClick={onClearFilter} className="hover:text-blue-900 ml-0.5">
                    <X size={11} />
                  </button>
                </span>
              )}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">Click any row to view detailed SEO breakdown</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">{sorted.length} of {results.length} pages</span>
            <input
              className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a3c5e]/30 w-56"
              placeholder="Filter by URL, title, issue…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-[#1a3c5e] text-white text-xs">
                <th className={`${thClass} w-8 text-center`}>#</th>
                <th className={`${thClass}`} onClick={() => toggleSort("URL")}>
                  <div className="flex items-center gap-1">URL <SortIcon k="URL" /></div>
                </th>
                <th className={`${thClass} w-14`} onClick={() => toggleSort("Status Code")}>
                  <div className="flex items-center gap-1">Status <SortIcon k="Status Code" /></div>
                </th>
                <th className={`${thClass} w-20`} onClick={() => toggleSort("Response Time (ms)")}>
                  <div className="flex items-center gap-1">Time <SortIcon k="Response Time (ms)" /></div>
                </th>
                <th className={`${thClass} w-14 text-center`} onClick={() => toggleSort("_pageScore")}>
                  <div className="flex items-center gap-1 justify-center">Score <SortIcon k="_pageScore" /></div>
                </th>
                <th className={`${thClass} w-10 text-center`} onClick={() => toggleSort("Title Length")}>
                  <div className="flex items-center gap-1 justify-center" title="Title Length">TL <SortIcon k="Title Length" /></div>
                </th>
                <th className={`${thClass} w-10 text-center`} onClick={() => toggleSort("Meta Description Length")}>
                  <div className="flex items-center gap-1 justify-center" title="Description Length">DL <SortIcon k="Meta Description Length" /></div>
                </th>
                <th className={`${thClass} w-10 text-center`} onClick={() => toggleSort("H1 Count")}>
                  <div className="flex items-center gap-1 justify-center">H1 <SortIcon k="H1 Count" /></div>
                </th>
                <th className={`${thClass} w-16 text-center`} onClick={() => toggleSort("Word Count")}>
                  <div className="flex items-center gap-1 justify-center">Words <SortIcon k="Word Count" /></div>
                </th>
                <th className={`${thClass} w-12 text-center`}>Canon</th>
                <th className={`${thClass} w-10 text-center`}>Idx</th>
                <th className={`${thClass} w-12 text-center`} onClick={() => toggleSort("Critical Count")}>
                  <div className="flex items-center gap-1 justify-center">Crit <SortIcon k="Critical Count" /></div>
                </th>
                <th className={`${thClass} w-12 text-center`} onClick={() => toggleSort("Warning Count")}>
                  <div className="flex items-center gap-1 justify-center">Warn <SortIcon k="Warning Count" /></div>
                </th>
                <th className={`${thClass}`}>Top Issue</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((r, i) => {
                const isWaf  = r["WAF Blocked"] ?? false;
                const isCrit = (r["Critical Count"] ?? 0) > 0;
                const isWarn = (r["Warning Count"] ?? 0) > 0;

                const rowBorder = isWaf ? "border-l-4 border-purple-400" :
                  isCrit ? "border-l-4 border-red-400" :
                  isWarn ? "border-l-4 border-amber-400" :
                  "border-l-4 border-emerald-400";
                const rowBg = isWaf ? "bg-purple-50/50" :
                  isCrit ? "bg-red-50/50" :
                  isWarn ? "bg-amber-50/30" : "bg-emerald-50/20";

                const topIssue = ((r["Critical Issues"] ?? "") + ";" + (r.Warnings ?? ""))
                  .split(";").map(s => s.trim()).filter(Boolean)[0] ?? "";

                const tl = r["Title Length"] ?? 0;
                const dl = r["Meta Description Length"] ?? 0;

                return (
                  <tr
                    key={i}
                    className={`${rowBorder} ${rowBg} hover:bg-blue-50/40 cursor-pointer transition-colors border-b border-slate-100 last:border-0`}
                    onClick={() => setDetail(r)}
                  >
                    <td className="px-3 py-2.5 text-xs text-slate-400 text-center">{page * PER_PAGE + i + 1}</td>
                    <td className="px-3 py-2.5 max-w-[220px]">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="text-xs text-[#1a3c5e] font-medium truncate" title={r.URL}>
                          {r.URL.replace(/^https?:\/\//, "").substring(0, 52)}
                        </span>
                        {isWaf && <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-bold">WAF</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs font-bold text-center" style={{ color: scColor(r["Status Code"] ?? 0) }}>
                      {r["Status Code"]}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-semibold text-center" style={{ color: rtColor(r["Response Time (ms)"] ?? 0) }}>
                      {r["Response Time (ms)"] ? `${r["Response Time (ms)"]}ms` : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <ScorePill score={r._pageScore ?? 0} />
                    </td>
                    <td className={`px-3 py-2.5 text-xs text-center font-semibold ${!isWaf && (tl > 60 || (tl > 0 && tl < 30)) ? "text-red-600" : "text-slate-600"}`}>
                      {isWaf ? "—" : tl}
                    </td>
                    <td className={`px-3 py-2.5 text-xs text-center font-semibold ${!isWaf && (dl > 160 || (dl > 0 && dl < 70)) ? "text-amber-600" : "text-slate-600"}`}>
                      {isWaf ? "—" : dl}
                    </td>
                    <td className={`px-3 py-2.5 text-xs text-center font-bold ${!isWaf && (r["H1 Count"] ?? 0) !== 1 ? "text-red-600" : "text-slate-600"}`}>
                      {isWaf ? "—" : r["H1 Count"]}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-center text-slate-600">
                      {isWaf ? "—" : (r["Word Count"] ?? 0).toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-center text-sm">
                      {r["Canonical URL"]?.trim() ? "✅" : "❌"}
                    </td>
                    <td className="px-3 py-2.5 text-center text-sm font-bold">
                      <span style={{ color: r.Indexable ? "#059669" : "#dc2626" }}>
                        {r.Indexable ? "✓" : "✗"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="inline-block min-w-[22px] text-center px-1.5 py-0.5 rounded text-xs font-bold bg-red-100 text-red-700">
                        {r["Critical Count"] ?? 0}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="inline-block min-w-[22px] text-center px-1.5 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-700">
                        {r["Warning Count"] ?? 0}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 max-w-[200px] truncate text-xs text-slate-500" title={topIssue}>
                      {topIssue.substring(0, 60)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 text-sm text-slate-500">
            <span>Showing {page * PER_PAGE + 1}–{Math.min((page + 1) * PER_PAGE, sorted.length)} of {sorted.length}</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-40 hover:bg-slate-50 transition-colors">← Prev</button>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
                className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-40 hover:bg-slate-50 transition-colors">Next →</button>
            </div>
          </div>
        )}
      </div>

      {/* Detail panel */}
      {detail && <PageDetailPanel page={detail} onClose={() => setDetail(null)} />}
    </>
  );
}
