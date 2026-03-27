"use client";
import { PageResult, AuditSummary } from "@/lib/api";
import { AlertCircle, AlertTriangle, Lightbulb, TrendingUp } from "lucide-react";
import Tooltip from "./Tooltip";

interface Improvement {
  sev: "critical" | "warning" | "opportunity";
  affectedCount: number;
  total: number;
  issue: string;
  fix: string;
  impact: "High" | "Medium" | "Low";
  tip: string;
}

function buildImprovements(results: PageResult[], summary: AuditSummary): Improvement[] {
  const total = results.length || 1;
  const pct = (n: number) => Math.round((n / total) * 100);
  const nonWaf = results.filter((r) => !r["WAF Blocked"]);
  const items: Improvement[] = [];

  // Missing / bad titles
  const noTitle = nonWaf.filter((r) => !r.Title);
  if (noTitle.length)
    items.push({
      sev: "critical",
      affectedCount: noTitle.length,
      total,
      issue: "Missing title tags",
      fix: "Add a unique, descriptive <title> element (30–60 characters) to every page. The title is the single most visible element in search results and is Google's primary on-page relevancy signal.",
      impact: "High",
      tip: "Google uses the title tag to understand page topic. Missing titles are one of the easiest critical fixes.",
    });

  const badTitle = nonWaf.filter((r) => {
    const l = r["Title Length"] ?? 0;
    return r.Title && (l < 30 || l > 60);
  });
  if (badTitle.length > Math.round(total * 0.15))
    items.push({
      sev: "warning",
      affectedCount: badTitle.length,
      total,
      issue: "Title tags outside optimal length (30–60 chars)",
      fix: "Rewrite titles to 30–60 characters. Too short misses keyword opportunities; too long gets truncated in SERPs, reducing click-through rates.",
      impact: "High",
      tip: "Google typically displays ~60 characters in SERPs. Longer titles are cut off with '…' and appear unprofessional.",
    });

  // Meta descriptions
  const noDesc = nonWaf.filter((r) => !r["Meta Description"]);
  if (noDesc.length > Math.round(total * 0.1))
    items.push({
      sev: "warning",
      affectedCount: noDesc.length,
      total,
      issue: "Missing meta descriptions",
      fix: "Write unique meta descriptions (70–160 chars) for each page. While not a direct ranking factor, well-written descriptions significantly improve click-through rates from search results.",
      impact: "Medium",
      tip: "When meta descriptions are missing, Google auto-generates them from page content — often poorly. Writing them yourself gives you control over your SERP snippet.",
    });

  // H1
  const noH1 = nonWaf.filter((r) => !r["H1 Count"]);
  if (noH1.length)
    items.push({
      sev: "critical",
      affectedCount: noH1.length,
      total,
      issue: "Missing H1 heading tags",
      fix: "Add exactly one H1 tag per page, containing the primary keyword. The H1 is a strong on-page relevancy signal that helps Google confirm the page topic.",
      impact: "High",
      tip: "H1 is the most prominent heading on a page. Google uses it alongside the title tag to understand page content.",
    });

  const multiH1 = nonWaf.filter((r) => (r["H1 Count"] ?? 0) > 1);
  if (multiH1.length > Math.round(total * 0.15))
    items.push({
      sev: "warning",
      affectedCount: multiH1.length,
      total,
      issue: "Multiple H1 tags on same page",
      fix: "Each page should have exactly one H1. Review the page structure and demote secondary headings to H2 or H3.",
      impact: "Medium",
      tip: "Multiple H1s can dilute the page's primary topic signal and confuse crawlers about the page's main subject.",
    });

  // Canonical
  const noCanon = nonWaf.filter((r) => !r["Canonical URL"]);
  if (noCanon.length > Math.round(total * 0.25))
    items.push({
      sev: "warning",
      affectedCount: noCanon.length,
      total,
      issue: "Missing canonical tags",
      fix: "Add <link rel=\"canonical\"> to every page pointing to the preferred URL. This prevents duplicate content issues and consolidates link equity (PageRank) to the canonical version.",
      impact: "Medium",
      tip: "Canonical tags tell Google which URL to index when multiple URLs serve the same or similar content (e.g., with query parameters).",
    });

  // Images
  const missingAlt = nonWaf.filter((r) => (r["Images Missing Alt"] ?? 0) > 0);
  if (missingAlt.length > 0)
    items.push({
      sev: "warning",
      affectedCount: missingAlt.length,
      total,
      issue: "Images missing alt text",
      fix: "Add descriptive alt attributes to all images. This improves image search rankings, helps Google understand content in context, and is required for WCAG 2.1 accessibility compliance.",
      impact: "Medium",
      tip: "Alt text is what Google reads when it can't 'see' your images. Descriptive alt text improves image SEO and accessibility.",
    });

  // Slow TTFB
  const slowPages = nonWaf.filter((r) => (r["Response Time (ms)"] ?? 0) > 2000);
  if (slowPages.length > Math.round(total * 0.2))
    items.push({
      sev: "warning",
      affectedCount: slowPages.length,
      total,
      issue: "Slow server response time / TTFB (>2s)",
      fix: "Investigate server-side caching (Redis/Varnish), CDN deployment, database query optimisation, and server hardware. TTFB is a Core Web Vitals signal that directly impacts Google rankings.",
      impact: "High",
      tip: "TTFB (Time To First Byte) is the time between a browser requesting a page and receiving the first byte. Google considers <800ms good, <1800ms needs improvement.",
    });

  // Structured data
  const noSchema = nonWaf.filter((r) => !r["Has Structured Data"]);
  if (noSchema.length > Math.round(total * 0.5))
    items.push({
      sev: "opportunity",
      affectedCount: noSchema.length,
      total,
      issue: "No Schema.org structured data",
      fix: "Add relevant Schema markup (Article, Product, BreadcrumbList, FAQ, etc.) to enable rich results in Google SERPs. Rich results typically show significantly higher click-through rates.",
      impact: "Medium",
      tip: "Schema.org structured data helps Google understand your content and display enhanced results (star ratings, breadcrumbs, FAQs) in search.",
    });

  // Non-indexable (unexpected — more than 30% non-indexable is a problem)
  if (summary.non_indexable > Math.round(total * 0.3) && summary.non_indexable > 5)
    items.push({
      sev: "critical",
      affectedCount: summary.non_indexable,
      total,
      issue: "High proportion of non-indexable pages",
      fix: "Review pages blocked by noindex directives, robots.txt, or non-200 status codes. Ensure only intentionally excluded pages are non-indexable.",
      impact: "High",
      tip: "Non-indexable pages cannot appear in Google Search. A high proportion may indicate accidental blocks or CMS misconfiguration.",
    });

  // WAF blocked
  if (summary.waf_blocked > 0)
    items.push({
      sev: "critical",
      affectedCount: summary.waf_blocked,
      total,
      issue: "Pages blocked by WAF / bot protection",
      fix: "These pages could not be fully audited — the site's WAF rejected the crawler. Consider auditing with authenticated access or whitelisting crawler IPs. Googlebot may also face similar challenges.",
      impact: "High",
      tip: "If a WAF blocks crawlers, Googlebot may be blocked too — preventing these pages from being indexed. This is a critical finding.",
    });

  // Sort: critical first, then warning, then opportunity
  const order = { critical: 0, warning: 1, opportunity: 2 };
  return items.sort((a, b) => order[a.sev] - order[b.sev]);
}

const sevConfig = {
  critical: {
    icon: <AlertCircle size={16} />,
    label: "Critical",
    bar: "bg-red-500",
    border: "border-l-red-500",
    bg: "bg-red-50",
    text: "text-red-700",
    badge: "bg-red-100 text-red-700",
  },
  warning: {
    icon: <AlertTriangle size={16} />,
    label: "Warning",
    bar: "bg-amber-500",
    border: "border-l-amber-400",
    bg: "bg-amber-50",
    text: "text-amber-700",
    badge: "bg-amber-100 text-amber-700",
  },
  opportunity: {
    icon: <Lightbulb size={16} />,
    label: "Opportunity",
    bar: "bg-blue-500",
    border: "border-l-blue-400",
    bg: "bg-blue-50",
    text: "text-blue-700",
    badge: "bg-blue-100 text-blue-700",
  },
};

export default function PriorityImprovements({
  results,
  summary,
}: {
  results: PageResult[];
  summary: AuditSummary;
}) {
  const improvements = buildImprovements(results, summary);

  if (!improvements.length) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp size={20} className="text-green-600" />
          <h2 className="font-bold text-slate-800 text-lg">Priority Improvements</h2>
        </div>
        <p className="text-green-700 font-semibold">✨ No major issues detected — this site is in great shape!</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6">
      <div className="flex items-center gap-2 mb-1">
        <TrendingUp size={20} className="text-blue-700" />
        <h2 className="font-bold text-slate-800 text-lg">
          <Tooltip text="These are the highest-impact SEO improvements identified from the audit. Fixing these issues first will produce the greatest gains in search visibility.">
            Priority Improvements
          </Tooltip>
        </h2>
      </div>
      <p className="text-slate-500 text-sm mb-5">
        Fix these issues first for maximum impact on search rankings. Listed by severity.
      </p>
      <div className="space-y-3">
        {improvements.map((item, i) => {
          const cfg = sevConfig[item.sev];
          const pct = Math.round((item.affectedCount / item.total) * 100);
          return (
            <div
              key={i}
              className={`border-l-4 ${cfg.border} ${cfg.bg} rounded-r-xl px-4 py-3`}
            >
              <div className="flex items-start gap-3">
                <span className={`${cfg.text} mt-0.5 flex-shrink-0`}>{cfg.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center flex-wrap gap-2 mb-1">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${cfg.badge}`}>
                      {cfg.label}
                    </span>
                    <span className="font-semibold text-slate-800 text-sm">{item.issue}</span>
                    <span className="ml-auto flex-shrink-0 text-xs text-slate-500 font-medium">
                      {item.affectedCount} page{item.affectedCount !== 1 ? "s" : ""} ({pct}%)
                      &nbsp;·&nbsp;
                      <span className={item.impact === "High" ? "text-red-600 font-bold" : item.impact === "Medium" ? "text-amber-600 font-bold" : "text-blue-600 font-bold"}>
                        {item.impact} impact
                      </span>
                    </span>
                  </div>
                  {/* Progress bar showing how many pages affected */}
                  <div className="h-1.5 w-full bg-white/60 rounded-full overflow-hidden mb-2">
                    <div
                      className={`h-full ${cfg.bar} rounded-full transition-all`}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  <p className="text-sm text-slate-700 leading-relaxed">
                    <Tooltip text={item.tip}>
                      <span>{item.fix}</span>
                    </Tooltip>
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
