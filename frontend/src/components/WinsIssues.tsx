"use client";

import { PageResult, AuditSummary } from "@/lib/api";
import { CheckCircle, AlertCircle } from "lucide-react";

interface WinItem { icon: string; text: string; detail: string; }

function pct(n: number, d: number) { return Math.round((n / Math.max(d, 1)) * 100); }

function computeWinsIssues(results: PageResult[], summary: AuditSummary) {
  const total = results.length || 1;
  const wins: WinItem[] = [];
  const issues: WinItem[] = [];

  const httpsN = results.filter(r => r.HTTPS).length;
  const httpsPct = pct(httpsN, total);
  if (httpsPct >= 85) wins.push({ icon: "🔒", text: `${httpsPct}% of pages are served over HTTPS`, detail: `${httpsN} of ${total} pages are secure and trusted` });
  else issues.push({ icon: "⚠️", text: `Only ${httpsPct}% of pages use HTTPS`, detail: `${total - httpsN} pages are not secure — a confirmed ranking factor` });

  const idxPct = pct(summary.indexable, total);
  if (idxPct >= 90) wins.push({ icon: "✅", text: `${idxPct}% of pages are indexable by Google`, detail: `${summary.indexable} of ${total} pages can appear in search results` });
  else if (idxPct < 75) issues.push({ icon: "🚫", text: `Only ${idxPct}% of pages are indexable`, detail: `${summary.non_indexable} pages are excluded from Google search` });

  const h1GoodN = results.filter(r => r["H1 Count"] === 1).length;
  const h1Pct = pct(h1GoodN, total);
  if (h1Pct >= 85) wins.push({ icon: "📝", text: `${h1Pct}% of pages have a proper H1 tag`, detail: "Strong heading structure across audited pages" });
  else issues.push({ icon: "📝", text: `H1 issues on ${100 - h1Pct}% of pages`, detail: `${total - h1GoodN} pages have missing or duplicate H1 tags` });

  const titleGoodN = results.filter(r => r.Title.trim() && r["Title Length"] >= 30 && r["Title Length"] <= 60).length;
  const titlePct = pct(titleGoodN, total);
  if (titlePct >= 80) wins.push({ icon: "🏷️", text: `${titlePct}% of pages have well-optimised titles`, detail: "Titles within the 30–60 character sweet spot" });
  else issues.push({ icon: "🏷️", text: `Title tags need work on ${100 - titlePct}% of pages`, detail: `${total - titleGoodN} pages have missing, too long, or too short titles` });

  const descGoodN = results.filter(r => r["Meta Description"].trim() && r["Meta Description Length"] >= 70 && r["Meta Description Length"] <= 160).length;
  const descPct = pct(descGoodN, total);
  if (descPct >= 75) wins.push({ icon: "📋", text: `${descPct}% of pages have good meta descriptions`, detail: "Good CTR coverage from search result snippets" });
  else issues.push({ icon: "📋", text: `Meta descriptions missing on ${100 - descPct}% of pages`, detail: `${total - descGoodN} pages are missing this important CTR driver` });

  const canonN = results.filter(r => r["Canonical URL"].trim()).length;
  const canonPct = pct(canonN, total);
  if (canonPct >= 85) wins.push({ icon: "🔗", text: `${canonPct}% of pages have canonical tags`, detail: "Good duplicate content prevention in place" });
  else issues.push({ icon: "🔗", text: `Canonical tags missing on ${100 - canonPct}% of pages`, detail: `${total - canonN} pages risk link equity dilution` });

  const schemaN = results.filter(r => r["Has Structured Data"]).length;
  const schemaPct = pct(schemaN, total);
  if (schemaPct >= 50) wins.push({ icon: "🧩", text: `${schemaPct}% of pages have structured data`, detail: "Eligible for rich results in Google SERPs" });
  else issues.push({ icon: "🧩", text: `Structured data absent on ${100 - schemaPct}% of pages`, detail: `${total - schemaN} pages missing Schema markup for rich snippets` });

  const rt = summary.avg_response_ms ?? 0;
  if (rt > 0 && rt < 1200) wins.push({ icon: "⚡", text: `Excellent average response time: ${rt}ms`, detail: "Fast server response is a positive Core Web Vitals signal" });
  else if (rt > 2200) issues.push({ icon: "🐌", text: `Average response time is ${rt}ms — too slow`, detail: "Slow TTFB hurts Core Web Vitals and Google rankings" });

  if (summary.waf_blocked > 0) {
    issues.push({ icon: "🛡️", text: `${summary.waf_blocked} pages blocked by WAF / bot protection`, detail: "These pages could not be fully audited — real content was inaccessible" });
  }

  return { wins, issues };
}

interface Props { results: PageResult[]; summary: AuditSummary }

export default function WinsIssues({ results, summary }: Props) {
  const { wins, issues } = computeWinsIssues(results, summary);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6 fade-up">
      {/* Wins */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        <div className="flex items-center gap-2 mb-4">
          <CheckCircle className="text-emerald-500" size={20} />
          <h3 className="font-bold text-slate-800">What&apos;s Working Well</h3>
          <span className="ml-auto text-xs font-semibold px-2 py-1 rounded-full bg-emerald-50 text-emerald-600">
            {wins.length} item{wins.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="space-y-3">
          {wins.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-4">Run a full site audit for a complete picture.</p>
          )}
          {wins.map((w, i) => (
            <div key={i} className="flex items-start gap-3 pb-3 border-b border-slate-50 last:border-0 last:pb-0">
              <span className="text-lg leading-none mt-0.5">{w.icon}</span>
              <div>
                <p className="text-sm font-semibold text-slate-800">{w.text}</p>
                <p className="text-xs text-slate-400 mt-0.5">{w.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Issues */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        <div className="flex items-center gap-2 mb-4">
          <AlertCircle className="text-red-500" size={20} />
          <h3 className="font-bold text-slate-800">What Needs Attention</h3>
          <span className="ml-auto text-xs font-semibold px-2 py-1 rounded-full bg-red-50 text-red-600">
            {issues.length} item{issues.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="space-y-3">
          {issues.length === 0 && (
            <p className="text-sm text-emerald-500 text-center py-4 font-medium">
              ✨ No significant issues detected!
            </p>
          )}
          {issues.map((w, i) => (
            <div key={i} className="flex items-start gap-3 pb-3 border-b border-slate-50 last:border-0 last:pb-0">
              <span className="text-lg leading-none mt-0.5">{w.icon}</span>
              <div>
                <p className="text-sm font-semibold text-slate-800">{w.text}</p>
                <p className="text-xs text-slate-400 mt-0.5">{w.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
