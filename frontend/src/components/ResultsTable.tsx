"use client";

import { useState, useMemo } from "react";
import { PageResult } from "@/lib/api";
import { ExternalLink, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";

type SortDir = "asc" | "desc" | null;

interface ColDef { key: keyof PageResult; label: string; width?: string }
const COLS: ColDef[] = [
  { key: "URL",                      label: "URL",       width: "w-52" },
  { key: "Status Code",              label: "Status",    width: "w-16" },
  { key: "Response Time (ms)",       label: "Time",      width: "w-20" },
  { key: "Title",                    label: "Title",     width: "w-44" },
  { key: "Title Length",             label: "TL",        width: "w-10" },
  { key: "Meta Description Length",  label: "DL",        width: "w-10" },
  { key: "H1 Count",                 label: "H1",        width: "w-10" },
  { key: "Word Count",               label: "Words",     width: "w-14" },
  { key: "Canonical URL",            label: "Canon",     width: "w-12" },
  { key: "Indexable",                label: "Idx",       width: "w-10" },
  { key: "WAF Blocked",              label: "WAF",       width: "w-10" },
  { key: "Critical Count",           label: "Crit",      width: "w-10" },
  { key: "Warning Count",            label: "Warn",      width: "w-10" },
];

function scColor(sc: number) {
  if (sc >= 200 && sc < 300) return "text-emerald-600 font-bold";
  if (sc >= 300 && sc < 400) return "text-amber-500 font-bold";
  return "text-red-500 font-bold";
}
function rtColor(rt: number) {
  if (rt > 3000) return "text-red-500 font-bold";
  if (rt > 1500) return "text-amber-500 font-bold";
  return "text-emerald-600 font-bold";
}

interface Props { results: PageResult[] }

export default function ResultsTable({ results }: Props) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<keyof PageResult>("Critical Count");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<PageResult | null>(null);
  const PER_PAGE = 50;

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return results.filter(r =>
      !q ||
      (r.URL ?? "").toLowerCase().includes(q) ||
      (r.Title ?? "").toLowerCase().includes(q) ||
      (r["Critical Issues"] ?? "").toLowerCase().includes(q)
    );
  }, [results, search]);

  const sorted = useMemo(() => {
    if (!sortDir) return filtered;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? "";
      const bv = b[sortKey] ?? "";
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  const paged = sorted.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
  const totalPages = Math.ceil(sorted.length / PER_PAGE);

  function toggleSort(key: keyof PageResult) {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : d === "desc" ? null : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(0);
  }

  function SortIcon({ k }: { k: keyof PageResult }) {
    if (sortKey !== k) return <ChevronsUpDown size={12} className="text-slate-400" />;
    return sortDir === "asc" ? <ChevronUp size={12} /> : sortDir === "desc" ? <ChevronDown size={12} /> : <ChevronsUpDown size={12} className="text-slate-400" />;
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden fade-up">
      <div className="flex items-center justify-between p-4 border-b border-slate-100">
        <h3 className="font-bold text-slate-800">All Pages <span className="text-slate-400 font-normal text-sm">({sorted.length} of {results.length})</span></h3>
        <input
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-56"
          placeholder="Filter by URL, title, issue…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0); }}
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-900 text-white text-xs">
              {COLS.map(col => (
                <th
                  key={col.key}
                  className={`px-3 py-3 text-left font-semibold whitespace-nowrap cursor-pointer select-none hover:bg-slate-700 ${col.width ?? ""}`}
                  onClick={() => toggleSort(col.key)}
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    <SortIcon k={col.key} />
                  </div>
                </th>
              ))}
              <th className="px-3 py-3 text-left text-xs font-semibold">Top Issue</th>
              <th className="px-3 py-3 w-12"></th>
            </tr>
          </thead>
          <tbody>
            {paged.map((r, i) => {
              const isWaf = r["WAF Blocked"];
              const isCrit = (r["Critical Count"] ?? 0) > 0;
              const isWarn = (r["Warning Count"] ?? 0) > 0;
              const rowClass = isWaf
                ? "bg-purple-50 border-l-4 border-purple-400"
                : isCrit
                ? "bg-red-50 border-l-4 border-red-400"
                : isWarn
                ? "bg-amber-50 border-l-4 border-amber-400"
                : "bg-emerald-50 border-l-4 border-emerald-400";

              const topIssue = ((r["Critical Issues"] ?? "") + " " + (r.Warnings ?? "")).trim().split(";")[0].trim();

              return (
                <tr key={i} className={`${rowClass} hover:opacity-90 transition-opacity border-b border-slate-100`}>
                  <td className="px-3 py-2.5 max-w-[200px] truncate">
                    <a href={r.URL} target="_blank" rel="noopener noreferrer" title={r.URL}
                      className="text-blue-600 hover:underline text-xs">
                      {r.URL.replace(/^https?:\/\//, "").substring(0, 48)}
                    </a>
                    {isWaf && <span className="ml-1 text-xs px-1 py-0.5 rounded bg-purple-100 text-purple-700 font-semibold">WAF</span>}
                  </td>
                  <td className={`px-3 py-2.5 ${scColor(r["Status Code"] ?? 0)}`}>{r["Status Code"]}</td>
                  <td className={`px-3 py-2.5 ${rtColor(r["Response Time (ms)"] ?? 0)}`}>{r["Response Time (ms)"]}ms</td>
                  <td className="px-3 py-2.5 max-w-[160px] truncate text-xs text-slate-700" title={r.Title}>
                    {isWaf ? <span className="italic text-slate-400">WAF challenge page</span> : r.Title?.substring(0, 40)}
                  </td>
                  <td className={`px-3 py-2.5 text-center ${!isWaf && ((r["Title Length"] ?? 0) > 60 || ((r["Title Length"] ?? 0) > 0 && (r["Title Length"] ?? 0) < 30)) ? "text-red-600 font-bold" : ""}`}>
                    {isWaf ? "—" : r["Title Length"]}
                  </td>
                  <td className={`px-3 py-2.5 text-center ${!isWaf && ((r["Meta Description Length"] ?? 0) > 160 || ((r["Meta Description Length"] ?? 0) > 0 && (r["Meta Description Length"] ?? 0) < 70)) ? "text-amber-600 font-bold" : ""}`}>
                    {isWaf ? "—" : r["Meta Description Length"]}
                  </td>
                  <td className={`px-3 py-2.5 text-center ${!isWaf && (r["H1 Count"] ?? 0) !== 1 ? "text-red-600 font-bold" : ""}`}>
                    {isWaf ? "—" : r["H1 Count"]}
                  </td>
                  <td className="px-3 py-2.5 text-center text-slate-600">{isWaf ? "—" : r["Word Count"]}</td>
                  <td className="px-3 py-2.5 text-center">
                    {r["Canonical URL"] ? "✅" : "❌"}
                  </td>
                  <td className="px-3 py-2.5 text-center font-bold">
                    <span style={{ color: r.Indexable ? "#10b981" : "#ef4444" }}>
                      {r.Indexable ? "✓" : "✗"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {isWaf ? <span className="text-purple-600 font-bold">✗</span> : ""}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-xs font-bold">
                      {r["Critical Count"]}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-xs font-bold">
                      {r["Warning Count"]}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 max-w-[180px] truncate text-xs text-slate-500" title={topIssue}>
                    {topIssue.substring(0, 55)}
                  </td>
                  <td className="px-3 py-2.5">
                    <button
                      onClick={() => setSelected(r)}
                      className="p-1 rounded hover:bg-slate-200 text-slate-500"
                      title="View details"
                    >
                      <ExternalLink size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-sm text-slate-600">
          <span>Showing {page * PER_PAGE + 1}–{Math.min((page + 1) * PER_PAGE, sorted.length)} of {sorted.length}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="px-3 py-1 rounded border disabled:opacity-40 hover:bg-slate-50">Prev</button>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
              className="px-3 py-1 rounded border disabled:opacity-40 hover:bg-slate-50">Next</button>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-800 text-sm truncate max-w-md" title={selected.URL}>
                {selected.URL.replace(/^https?:\/\//, "").substring(0, 60)}
              </h3>
              <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">&times;</button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {(Object.entries(selected) as [string, unknown][])
                .filter(([k]) => !k.startsWith("_"))
                .map(([k, v]) => (
                  <div key={k} className="flex flex-col border-b border-slate-50 pb-1">
                    <span className="text-xs text-slate-400 font-medium">{k}</span>
                    <span className="text-slate-700 break-words">
                      {v === true ? "✅" : v === false ? "❌" : String(v ?? "—").substring(0, 120)}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
