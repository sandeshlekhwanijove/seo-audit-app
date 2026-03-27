"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

const rows = [
  ["Meta Title", "✅ Length, content, missing", "✅ + duplicate detection", "We flag duplicates as warnings in Issues"],
  ["Meta Description", "✅ Length, content, missing", "✅ + pixel width + duplicates", ""],
  ["H1 / H2 / H3 Tags", "✅ Count + first instance", "✅ All instances, duplicates", "We capture first H1/H2/H3 text"],
  ["Canonical URLs", "✅ Present, points-elsewhere check", "✅ + chains + loops", ""],
  ["Meta Robots / noindex", "✅", "✅", ""],
  ["X-Robots-Tag (HTTP header)", "✅", "✅", ""],
  ["Response Time (TTFB)", "✅ Navigation Timing API", "✅ HTTP TTFB", "Both use browser-level timing"],
  ["Full JS Render Time", "✅ full_load_ms (unique)", "❌ HTTP only", "We wait for JS hydration — Screaming Frog doesn't always do this"],
  ["HTTPS / HTTP detection", "✅", "✅", ""],
  ["HTTP Status Codes", "✅", "✅", ""],
  ["Redirects (3xx)", "✅ Detected", "✅ Full chain tracing", "We log the final URL; SF maps entire chain"],
  ["Image Alt Text", "✅ Missing / empty", "✅ + too long", ""],
  ["Internal / External Links", "✅ Counts", "✅ Full link export", "SF provides a full link graph; we provide totals"],
  ["Open Graph Tags", "✅ title / desc / image / type", "✅", ""],
  ["Twitter Card", "✅", "✅", ""],
  ["Schema.org / Structured Data", "✅ Types detected", "✅ + validation", "We list Schema types; SF validates against spec"],
  ["Hreflang", "✅ Languages detected", "✅ + return-link validation", ""],
  ["Word Count", "✅", "✅", ""],
  ["Flesch Readability Score", "✅ (unique feature)", "❌", "SF does not include readability scoring"],
  ["WAF / Bot-protection Detection", "✅ (unique feature)", "❌", "We flag pages that returned challenge/skeleton content"],
  ["JavaScript SPA Rendering", "✅ Playwright headless Chrome", "✅ Custom rendering mode", "Both use real browser engines"],
  ["Duplicate Content Detection", "✅ Hash-based body text comparison", "✅ Hash-based full comparison", "Newly implemented — MD5 hash of page body"],
  ["Pagination (rel=next/prev)", "✅ Detected", "✅", ""],
  ["Page Speed / Core Web Vitals", "⚠️ TTFB + Full Load Time", "✅ Full CWV suite", "LCP, CLS, FID planned"],
  ["Sitemap Crawl Mode", "❌ Planned", "✅", ""],
  ["robots.txt Parsing", "✅ Disallow rules, sitemaps, crawl-delay", "✅", "Newly implemented"],
  ["Custom Extraction (XPath/RegEx)", "❌ Future feature", "✅", ""],
  ["Bulk Export (Excel)", "✅", "✅", ""],
  ["Interactive HTML Report", "✅ (unique feature)", "❌", "Download a shareable self-contained HTML report"],
];

export default function SFComparison() {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-6">
      <button
        className="w-full flex items-center gap-3 px-6 py-4 text-left hover:bg-slate-50 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown size={18} className="text-slate-500" /> : <ChevronRight size={18} className="text-slate-500" />}
        <span className="font-bold text-slate-800">📋 Coverage vs. Screaming Frog</span>
        <span className="ml-auto text-xs text-slate-500 font-medium">
          {open ? "Collapse" : "Expand to see what we cover vs. SF"}
        </span>
      </button>
      {open && (
        <div className="overflow-x-auto border-t border-slate-100">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-left text-slate-600 font-semibold">
                <th className="px-4 py-3 w-48">Signal</th>
                <th className="px-4 py-3 w-52">This Tool</th>
                <th className="px-4 py-3 w-52">Screaming Frog</th>
                <th className="px-4 py-3">Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([signal, us, sf, note], i) => (
                <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                  <td className="px-4 py-2 font-semibold text-slate-700">{signal}</td>
                  <td className={`px-4 py-2 ${us.startsWith("✅") ? "text-green-700" : us.startsWith("⚠️") ? "text-amber-700" : "text-slate-400"}`}>
                    {us}
                  </td>
                  <td className={`px-4 py-2 ${sf.startsWith("✅") ? "text-green-700" : sf.startsWith("⚠️") ? "text-amber-700" : "text-slate-400"}`}>
                    {sf}
                  </td>
                  <td className="px-4 py-2 text-slate-500 italic">{note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
