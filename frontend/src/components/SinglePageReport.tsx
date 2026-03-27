"use client";
import { useState } from "react";
import { PageResult } from "@/lib/api";
import { ChevronDown, ChevronRight, ExternalLink, Download } from "lucide-react";
import Tooltip from "./Tooltip";
import ScoreGauge from "./ScoreGauge";

// ─── Scoring helpers (mirrors PageDetailPanel) ────────────────────────────────
interface SR { score: number; label: string; tip?: string }

function gradeOf(s: number) {
  if (s >= 90) return { grade: "A", color: "#059669", bg: "#d1fae5" };
  if (s >= 75) return { grade: "B", color: "#16a34a", bg: "#dcfce7" };
  if (s >= 55) return { grade: "C", color: "#d97706", bg: "#fef3c7" };
  if (s >= 35) return { grade: "D", color: "#ea580c", bg: "#ffedd5" };
  return { grade: "F", color: "#dc2626", bg: "#fee2e2" };
}

const scorers = {
  title: (len: number): SR => {
    if (len === 0) return { score: 0, label: "Missing", tip: "Add a unique <title> tag (30–60 chars)" };
    if (len < 20) return { score: 25, label: `${len} chars — very short`, tip: "Expand to at least 30 characters" };
    if (len < 30) return { score: 60, label: `${len} chars — slightly short`, tip: "Aim for 30–60 characters" };
    if (len <= 60) return { score: 100, label: `${len} chars — optimal` };
    if (len <= 70) return { score: 72, label: `${len} chars — slightly long`, tip: "Trim to under 60 chars to avoid SERP truncation" };
    return { score: 35, label: `${len} chars — too long, will be cut off`, tip: "Shorten to under 60 characters" };
  },
  desc: (len: number): SR => {
    if (len === 0) return { score: 0, label: "Missing", tip: "Write a 70–160 char meta description to improve CTR" };
    if (len < 50) return { score: 30, label: `${len} chars — very short`, tip: "Expand to at least 70 characters" };
    if (len < 70) return { score: 62, label: `${len} chars — short`, tip: "Aim for 70–160 characters" };
    if (len <= 160) return { score: 100, label: `${len} chars — optimal` };
    return { score: 50, label: `${len} chars — too long`, tip: "Trim to under 160 characters" };
  },
  h1: (count: number): SR => {
    if (count === 0) return { score: 0, label: "Missing", tip: "Add exactly one H1 containing your primary keyword" };
    if (count === 1) return { score: 100, label: "Exactly one H1 — perfect" };
    return { score: 45, label: `${count} H1 tags found`, tip: "Use only one H1 per page — demote others to H2/H3" };
  },
  words: (wc: number, isWaf: boolean): SR => {
    if (isWaf) return { score: 0, label: "WAF blocked — unmeasurable" };
    if (wc === 0) return { score: 0, label: "No content detected", tip: "Ensure the page renders full content before auditing" };
    if (wc < 100) return { score: 20, label: `${wc} words — thin content`, tip: "Expand to at least 300 words for competitive ranking" };
    if (wc < 300) return { score: 55, label: `${wc} words — below average`, tip: "Aim for 300+ words to improve topical depth" };
    if (wc < 700) return { score: 80, label: `${wc} words — good` };
    return { score: 100, label: `${wc} words — excellent depth` };
  },
  rt: (ms: number): SR => {
    if (!ms) return { score: 0, label: "N/A" };
    if (ms < 500) return { score: 100, label: `${ms}ms — excellent` };
    if (ms < 1000) return { score: 90, label: `${ms}ms — very fast` };
    if (ms < 1500) return { score: 75, label: `${ms}ms — good` };
    if (ms < 2500) return { score: 55, label: `${ms}ms — moderate`, tip: "Investigate server caching and CDN to reduce TTFB" };
    if (ms < 3500) return { score: 30, label: `${ms}ms — slow`, tip: "TTFB > 2.5s is a Core Web Vitals concern" };
    return { score: 10, label: `${ms}ms — very slow`, tip: "Critical: TTFB > 3.5s will hurt Google rankings" };
  },
  images: (count: number, missing: number): SR => {
    if (count === 0) return { score: 100, label: "No images" };
    if (missing === 0) return { score: 100, label: `All ${count} images have alt text` };
    const pct = Math.round(((count - missing) / count) * 100);
    return {
      score: pct >= 80 ? 80 : pct >= 50 ? 50 : 20,
      label: `${missing} of ${count} images missing alt text`,
      tip: "Add descriptive alt attributes to all images for SEO and accessibility",
    };
  },
  og: (hasTitle: boolean, hasDesc: boolean, hasImg: boolean): SR => {
    const c = [hasTitle, hasDesc, hasImg].filter(Boolean).length;
    if (c === 3) return { score: 100, label: "All OG tags present" };
    const missing = [!hasTitle && "og:title", !hasDesc && "og:description", !hasImg && "og:image"].filter(Boolean).join(", ");
    return { score: c * 33, label: `${c}/3 tags — missing: ${missing}`, tip: `Add ${missing} for better social sharing previews` };
  },
};

function computeScore(r: PageResult): number {
  if (r["WAF Blocked"]) return 0;
  const w: [number, number][] = [
    [scorers.title(r["Title Length"] ?? 0).score, 20],
    [scorers.desc(r["Meta Description Length"] ?? 0).score, 15],
    [scorers.h1(r["H1 Count"] ?? 0).score, 15],
    [r.HTTPS ? 100 : 0, 15],
    [r["Canonical URL"]?.trim() ? 100 : 30, 10],
    [scorers.rt(r["Response Time (ms)"] ?? 0).score, 10],
    [scorers.words(r["Word Count"] ?? 0, false).score, 8],
    [r["Has Structured Data"] ? 100 : 55, 4],
    [scorers.og(!!r["OG Title"], !!r["OG Description"], !!r["OG Image"]).score, 3],
  ];
  const total = w.reduce((a, [, x]) => a + x, 0);
  return Math.round(w.reduce((a, [s, x]) => a + s * x, 0) / total);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function GradePill({ score }: { score: number }) {
  const { grade, color, bg } = gradeOf(score);
  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, background: color }} />
      </div>
      <span className="text-xs font-black w-6 text-right" style={{ color }}>{score}</span>
      <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{ color, background: bg }}>{grade}</span>
    </div>
  );
}

interface ParamRowProps {
  label: string;
  value: React.ReactNode;
  sub?: string;
  scored?: SR;
  tip?: string;
  improveTip?: string;
}
function ParamRow({ label, value, sub, scored, tip, improveTip }: ParamRowProps) {
  const [showTip, setShowTip] = useState(false);
  const needsWork = scored && scored.score < 80;
  return (
    <div className="group">
      <div className="flex items-start gap-3 py-2.5 px-1">
        <div className="w-40 flex-shrink-0 pt-0.5">
          <Tooltip text={tip || label}>
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">{label}</span>
          </Tooltip>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-slate-800 font-medium break-words">{value}</div>
          {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
          {scored && <div className="text-xs mt-0.5" style={{ color: gradeOf(scored.score).color }}>{scored.label}</div>}
        </div>
        {scored && <GradePill score={scored.score} />}
        {needsWork && (scored.tip || improveTip) && (
          <button
            className="flex-shrink-0 text-xs text-blue-500 hover:text-blue-700 font-semibold mt-0.5"
            onClick={() => setShowTip(t => !t)}
            title="Toggle improvement tip"
          >
            💡
          </button>
        )}
      </div>
      {showTip && (scored?.tip || improveTip) && (
        <div className="mx-1 mb-2 px-3 py-2 bg-blue-50 border-l-2 border-blue-400 rounded-r-lg text-xs text-blue-800 leading-relaxed">
          <span className="font-bold">How to improve: </span>{scored?.tip || improveTip}
        </div>
      )}
    </div>
  );
}

interface SectionProps {
  icon: string;
  title: string;
  score: number; // average 0–100
  count: string; // e.g. "4 of 6 optimal"
  children: React.ReactNode;
  defaultOpen?: boolean;
}
function Section({ icon, title, score, count, children, defaultOpen = false }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const { color, bg, grade } = gradeOf(score);
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-3">
      <button
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-50 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-xl">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-800 text-sm">{title}</span>
            <span className="text-xs text-slate-400">{count}</span>
          </div>
        </div>
        <span className="text-xs font-bold px-2 py-1 rounded-lg" style={{ color, background: bg }}>
          {score} — {grade}
        </span>
        {open ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
      </button>
      {open && (
        <div className="border-t border-slate-100 divide-y divide-slate-50 px-4">
          {children}
        </div>
      )}
    </div>
  );
}

function avg(...scores: number[]) {
  const valid = scores.filter(s => s > 0);
  return valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : 0;
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function SinglePageReport({
  page,
  htmlReportHref,
  excelHref,
  onBack,
}: {
  page: PageResult;
  htmlReportHref?: string;
  excelHref?: string;
  onBack?: () => void;
}) {
  const overall = computeScore(page);
  const { grade, color } = gradeOf(overall);
  const isWaf = page["WAF Blocked"] ?? false;

  // Pre-compute scores for section averages
  const tScore = scorers.title(page["Title Length"] ?? 0);
  const dScore = scorers.desc(page["Meta Description Length"] ?? 0);
  const h1Score = scorers.h1(page["H1 Count"] ?? 0);
  const wcScore = scorers.words(page["Word Count"] ?? 0, isWaf);
  const rtScore = scorers.rt(page["Response Time (ms)"] ?? 0);
  const imgScore = scorers.images(page["Image Count"] ?? 0, page["Images Missing Alt"] ?? 0);
  const ogScore = scorers.og(!!page["OG Title"], !!page["OG Description"], !!page["OG Image"]);
  const canonScore = { score: page["Canonical URL"]?.trim() ? 100 : 30, label: page["Canonical URL"] ? "Canonical tag present" : "Missing — duplicate content risk", tip: "Add <link rel='canonical'> to specify the preferred URL" };
  const httpsScore = { score: page.HTTPS ? 100 : 0, label: page.HTTPS ? "Secure HTTPS" : "HTTP only — ranking penalty", tip: "Migrate to HTTPS — it's a confirmed Google ranking signal" };
  const schemaScore = { score: page["Has Structured Data"] ? 100 : 55, label: page["Has Structured Data"] ? `Types: ${page["Schema Types"] || "detected"}` : "No Schema markup found", tip: "Add JSON-LD Schema (Article, BreadcrumbList, etc.) to unlock rich results" };

  const criticals = (page["Critical Issues"] ?? "").split(";").map(s => s.trim()).filter(Boolean);
  const warnings = (page.Warnings ?? "").split(";").map(s => s.trim()).filter(Boolean);
  const info = (page.Info ?? "").split(";").map(s => s.trim()).filter(Boolean);

  return (
    <div className="fade-up">
      {/* Back button */}
      {onBack && (
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 mb-4 transition-colors">
          ← Run another audit
        </button>
      )}

      {/* Hero */}
      <div className="bg-[#1a3c5e] rounded-2xl p-6 mb-6 flex flex-col sm:flex-row items-start sm:items-center gap-5">
        <div className="flex-shrink-0">
          <ScoreGauge score={overall} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className={`text-xs font-bold px-2 py-0.5 rounded ${(page["Status Code"] || 0) === 200 ? "bg-emerald-500 text-white" : "bg-red-500 text-white"}`}>
              {page["Status Code"] || 0}
            </span>
            {isWaf && <span className="text-xs font-bold px-2 py-0.5 rounded bg-purple-500 text-white">WAF Blocked</span>}
            {page.HTTPS && <span className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-600 text-white">HTTPS</span>}
            {page.Indexable
              ? <span className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-600 text-white">Indexable</span>
              : <span className="text-xs font-bold px-2 py-0.5 rounded bg-red-500 text-white">Not Indexable</span>}
            {page["Duplicate Content"] && <span className="text-xs font-bold px-2 py-0.5 rounded bg-amber-400 text-slate-900">Duplicate Content</span>}
          </div>
          <a href={page.URL} target="_blank" rel="noopener noreferrer"
            className="text-blue-200 text-sm hover:text-white flex items-center gap-1.5 break-all mb-1">
            <ExternalLink size={13} className="flex-shrink-0" />
            {page.URL}
          </a>
          {page["Final URL"] && page["Final URL"] !== page.URL && (
            <div className="text-xs text-blue-300">→ Redirects to: {page["Final URL"].substring(0, 60)}</div>
          )}
          <div className="text-xs text-blue-300 mt-1">
            Overall grade: <span className="font-black" style={{ color }}>{grade}</span>
            {page["Response Time (ms)"] ? ` · TTFB: ${page["Response Time (ms)"]}ms` : ""}
            {page["Word Count"] && !isWaf ? ` · ${page["Word Count"]} words` : ""}
          </div>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {htmlReportHref && (
            <a href={htmlReportHref} download className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors">
              <Download size={13} /> HTML Report
            </a>
          )}
          {excelHref && (
            <a href={excelHref} download className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors">
              <Download size={13} /> Excel
            </a>
          )}
        </div>
      </div>

      {/* WAF warning */}
      {isWaf && (
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 mb-4 text-sm text-purple-800">
          <strong>⚠️ WAF / Bot Protection Detected</strong>
          <p className="mt-1 text-xs leading-relaxed">This page returned a bot-protection challenge. The SEO metrics below reflect the challenge page content — not your actual page. Consider auditing with authenticated access.</p>
        </div>
      )}

      {/* Issues callout — always visible */}
      {(criticals.length > 0 || warnings.length > 0) && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 mb-4">
          <h3 className="font-bold text-slate-800 text-sm mb-3 flex items-center gap-2">
            🚨 Issues Found
            {criticals.length > 0 && <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">{criticals.length} critical</span>}
            {warnings.length > 0 && <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{warnings.length} warnings</span>}
          </h3>
          <div className="space-y-1">
            {criticals.map((issue, i) => (
              <div key={i} className="flex items-start gap-2 text-sm text-red-700 py-1">
                <span className="flex-shrink-0">❌</span>{issue}
              </div>
            ))}
            {warnings.map((issue, i) => (
              <div key={i} className="flex items-start gap-2 text-sm text-amber-700 py-1">
                <span className="flex-shrink-0">⚠️</span>{issue}
              </div>
            ))}
            {info.map((issue, i) => (
              <div key={i} className="flex items-start gap-2 text-sm text-blue-600 py-1">
                <span className="flex-shrink-0">ℹ️</span>{issue}
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-slate-500 mb-3">Click any section to expand. Click 💡 on a failing parameter for improvement advice.</p>

      {/* ── Section: Content Quality ── */}
      <Section
        icon="📝" title="Content Quality"
        score={avg(tScore.score, dScore.score, h1Score.score, wcScore.score)}
        count={`${[tScore, dScore, h1Score, wcScore].filter(s => s.score >= 80).length} of 4 signals optimal`}
        defaultOpen={true}
      >
        <ParamRow label="Meta Title"
          tip="Displayed as the blue headline in Google search results. Optimal: 30–60 characters with your primary keyword near the front."
          value={page.Title ? `"${page.Title.substring(0, 80)}"` : <span className="text-red-500 italic">Not set</span>}
          scored={tScore} />
        <ParamRow label="Meta Description"
          tip="Shown as grey text under the title in SERPs. Doesn't rank directly but heavily influences click-through rates."
          value={page["Meta Description"] ? `"${page["Meta Description"].substring(0, 120)}"` : <span className="text-amber-500 italic">Not set</span>}
          scored={dScore} />
        <ParamRow label="H1 Tag"
          tip="Main heading on the page. Have exactly one H1 containing your primary keyword."
          value={page["H1 First"] || <span className="text-red-500 italic">Missing</span>}
          sub={page["H1 Count"] > 1 ? `⚠ ${page["H1 Count"]} H1 tags found` : undefined}
          scored={h1Score} />
        <ParamRow label="H2 Tags"
          tip="Subheadings that structure content. Great for secondary keywords and readability."
          value={`${page["H2 Count"] ?? 0} found`}
          sub={page["H2 First"] ? `First: "${page["H2 First"].substring(0, 50)}"` : undefined} />
        <ParamRow label="H3 Tags" value={`${page["H3 Count"] ?? 0} found`} />
        <ParamRow label="Word Count"
          tip="Content depth signal. Pages with <300 words are considered 'thin content'. 700+ words typically ranks better."
          value={isWaf ? "N/A" : `${page["Word Count"] ?? 0} words`}
          sub={page["Paragraph Count"] ? `${page["Paragraph Count"]} paragraphs` : undefined}
          scored={isWaf ? undefined : wcScore} />
        {page["Flesch Reading Ease"] !== "" && page["Flesch Reading Ease"] !== undefined && (
          <ParamRow label="Readability"
            tip="Flesch Reading Ease: 60–100 = easy (recommended for most audiences). Lower scores = harder to read."
            value={`Flesch: ${page["Flesch Reading Ease"]}`}
            sub={Number(page["Flesch Reading Ease"]) >= 60 ? "Easy to read" : Number(page["Flesch Reading Ease"]) >= 30 ? "Moderate" : "Difficult"} />
        )}
        <ParamRow label="Meta Keywords" value={page["Meta Keywords"] || <span className="text-slate-400 italic">Not set (not a ranking factor)</span>} />
      </Section>

      {/* ── Section: Technical SEO ── */}
      <Section
        icon="⚙️" title="Technical SEO"
        score={avg(httpsScore.score, canonScore.score, rtScore.score, page.Indexable ? 100 : 0)}
        count={`${[httpsScore, canonScore, rtScore].filter(s => s.score >= 80).length + (page.Indexable ? 1 : 0)} of 4 signals optimal`}
        defaultOpen={criticals.length > 0}
      >
        <ParamRow label="HTTPS"
          tip="Confirmed Google ranking signal. HTTP pages are labelled 'Not Secure' in Chrome."
          value={page.HTTPS ? "✅ Secure connection" : "❌ HTTP only"}
          scored={httpsScore} />
        <ParamRow label="Indexability"
          tip="Whether Googlebot can index this page. Non-indexable pages won't appear in search results."
          value={page.Indexable ? "✅ Indexable" : "❌ Not indexable"}
          sub={page["Indexability Issues"] || undefined}
          scored={{ score: page.Indexable ? 100 : 0, label: page.Indexable ? "Can appear in Google" : "Excluded from search" }} />
        <ParamRow label="Canonical URL"
          tip="Tells Google which URL is the canonical (preferred) version. Prevents duplicate content issues."
          value={page["Canonical URL"] ? <span className="font-mono text-xs break-all">{page["Canonical URL"].substring(0, 80)}</span> : <span className="text-amber-500 italic">Missing</span>}
          scored={canonScore} />
        <ParamRow label="Meta Robots"
          tip="Controls crawler directives. Default (absent) is 'index, follow'. 'noindex' removes the page from search."
          value={page["Meta Robots"] || <span className="text-slate-400 italic">Not set (index, follow)</span>} />
        <ParamRow label="X-Robots-Tag"
          tip="HTTP header equivalent of meta robots — applies to non-HTML files too."
          value={page["X-Robots-Tag"] || <span className="text-slate-400 italic">Not set</span>} />
        <ParamRow label="Response Time (TTFB)"
          tip="Time To First Byte via Navigation Timing API. Google considers <800ms excellent, >1800ms poor — a Core Web Vitals signal."
          value={page["Response Time (ms)"] ? `${page["Response Time (ms)"]}ms` : "N/A"}
          scored={rtScore.label !== "N/A" ? rtScore : undefined} />
        {(page["Full Load Time (ms)"] ?? 0) > 0 && page["Full Load Time (ms)"] !== page["Response Time (ms)"] && (
          <ParamRow label="Full JS Load"
            tip="Total time including JavaScript hydration/rendering. This tool waits for the SPA to fully render before measuring."
            value={`${page["Full Load Time (ms)"]}ms`}
            sub="Includes SPA hydration time" />
        )}
        <ParamRow label="Page Size"
          tip="Large pages (>5MB) slow down crawling and rendering. Optimise images and minify CSS/JS."
          value={page["Page Size (KB)"] ? `${page["Page Size (KB)"]} KB` : "N/A"}
          sub={(page["Text to HTML Ratio (%)"] ?? 0) > 0 ? `${page["Text to HTML Ratio (%)"]}% text-to-HTML ratio` : undefined} />
        <ParamRow label="Server" value={page.Server || <span className="text-slate-400 italic">Not disclosed</span>} />
        {page["Blocked by robots.txt"] && (
          <ParamRow label="robots.txt" value="⚠️ Disallowed by robots.txt" scored={{ score: 0, label: "This URL is blocked by robots.txt rules", tip: "Review robots.txt to ensure Googlebot can access this page" }} />
        )}
        {page["Duplicate Content"] && (
          <ParamRow label="Duplicate Content"
            tip="Another page on this site has identical body text. This can dilute PageRank — use a canonical tag to specify the preferred version."
            value="⚠️ Duplicate content detected"
            sub={page["Duplicate Of"] ? `Same as: ${page["Duplicate Of"].substring(0, 60)}` : undefined}
            scored={{ score: 20, label: "Consider adding/updating canonical tag", tip: "Set <link rel='canonical'> to the preferred URL" }} />
        )}
      </Section>

      {/* ── Section: Media & Links ── */}
      <Section
        icon="🖼️" title="Media & Links"
        score={imgScore.score}
        count={`${page["Image Count"] ?? 0} images · ${page["Total Links"] ?? 0} links`}
      >
        <ParamRow label="Images"
          tip="Alt text helps Google understand images and is required for WCAG accessibility compliance."
          value={`${page["Image Count"] ?? 0} total`}
          sub={page["Images Missing Alt"] ? `${page["Images Missing Alt"]} missing alt text` : "All images have alt text"}
          scored={imgScore} />
        <ParamRow label="Internal Links" value={`${page["Internal Links"] ?? 0} links`}
          tip="Internal links distribute PageRank and help Googlebot discover content." />
        <ParamRow label="External Links" value={`${page["External Links"] ?? 0} links`}
          tip="Outbound links to authoritative sources can be a positive quality signal." />
        <ParamRow label="Nofollow Links" value={`${page["Nofollow Links"] ?? 0} links`}
          tip="rel='nofollow' tells crawlers not to pass PageRank to the linked page." />
        <ParamRow label="Scripts" value={`${page["Scripts Count"] ?? 0} external scripts`}
          tip="Excessive third-party scripts slow page load time and can affect Core Web Vitals." />
        <ParamRow label="Stylesheets" value={`${page["Stylesheets Count"] ?? 0} external`} />
        <ParamRow label="iFrames" value={`${page["Iframes Count"] ?? 0}`}
          tip="Content in iframes is not indexed by Google — ensure important content is not inside iframes." />
      </Section>

      {/* ── Section: Social & Schema ── */}
      <Section
        icon="🌐" title="Social Sharing & Schema"
        score={avg(ogScore.score, page["Has Structured Data"] ? 100 : 55)}
        count={`OG: ${ogScore.score === 100 ? "complete" : "incomplete"} · Schema: ${page["Has Structured Data"] ? "present" : "missing"}`}
      >
        <ParamRow label="Open Graph"
          tip="OG tags control how your page appears when shared on Facebook, LinkedIn, Slack. Missing og:image is the most common issue — use 1200×630px images."
          value={page["OG Title"] ? `"${page["OG Title"].substring(0, 60)}"` : <span className="text-slate-400 italic">og:title not set</span>}
          sub={[
            `og:description ${page["OG Description"] ? "✅" : "❌"}`,
            `og:image ${page["OG Image"] ? "✅" : "❌"}`,
            page["OG Type"] ? `type: ${page["OG Type"]}` : "",
          ].filter(Boolean).join("  ·  ")}
          scored={ogScore} />
        <ParamRow label="Twitter Card"
          tip="Controls Twitter/X preview. 'summary_large_image' gives the best visual presence in feeds."
          value={page["Twitter Card"] || <span className="text-slate-400 italic">Not set</span>} />
        <ParamRow label="Structured Data"
          tip="Schema.org markup unlocks rich results in Google SERPs (star ratings, breadcrumbs, FAQs). Rich results typically have much higher CTR."
          value={page["Has Structured Data"] ? (page["Schema Types"] || "Present") : <span className="text-slate-400 italic">None detected</span>}
          scored={schemaScore} />
        <ParamRow label="Hreflang"
          tip="Tells Google which language/region variant to show different users. Required for multilingual sites."
          value={page["Hreflang Languages"] || <span className="text-slate-400 italic">None (may be intentional)</span>} />
      </Section>
    </div>
  );
}
