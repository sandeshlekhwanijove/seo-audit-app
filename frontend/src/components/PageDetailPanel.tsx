"use client";

import { PageResult } from "@/lib/api";
import { X, ExternalLink, XCircle, AlertCircle, Info } from "lucide-react";
import Tooltip from "./Tooltip";

// ─── Scoring helpers ──────────────────────────────────────────────────────────

interface ScoreResult { score: number; label: string }

function gradeOf(s: number): { grade: string; color: string; bg: string } {
  if (s >= 90) return { grade: "A", color: "#059669", bg: "#d1fae5" };
  if (s >= 75) return { grade: "B", color: "#16a34a", bg: "#dcfce7" };
  if (s >= 55) return { grade: "C", color: "#d97706", bg: "#fef3c7" };
  if (s >= 35) return { grade: "D", color: "#ea580c", bg: "#ffedd5" };
  return { grade: "F", color: "#dc2626", bg: "#fee2e2" };
}

function scoreTitle(len: number): ScoreResult {
  if (len === 0) return { score: 0,   label: "Missing — critical SEO issue" };
  if (len < 20)  return { score: 25,  label: `${len} chars — very short (≥30 recommended)` };
  if (len < 30)  return { score: 60,  label: `${len} chars — slightly short (≥30 recommended)` };
  if (len <= 60) return { score: 100, label: `${len} chars — optimal (30–60)` };
  if (len <= 70) return { score: 72,  label: `${len} chars — slightly long (≤60 recommended)` };
  return         { score: 35,  label: `${len} chars — too long, may be truncated in SERPs` };
}

function scoreDesc(len: number): ScoreResult {
  if (len === 0)   return { score: 0,   label: "Missing — will use auto-generated snippet" };
  if (len < 50)    return { score: 30,  label: `${len} chars — very short (70–160 recommended)` };
  if (len < 70)    return { score: 62,  label: `${len} chars — short (≥70 recommended)` };
  if (len <= 160)  return { score: 100, label: `${len} chars — optimal (70–160)` };
  return           { score: 50,  label: `${len} chars — too long, Google will truncate` };
}

function scoreH1(count: number): ScoreResult {
  if (count === 0) return { score: 0,   label: "Missing — important ranking signal" };
  if (count === 1) return { score: 100, label: "Perfect — exactly one H1" };
  return           { score: 45,  label: `${count} H1s — only one H1 per page recommended` };
}

function scoreWordCount(wc: number, isWaf: boolean): ScoreResult {
  if (isWaf)    return { score: 0,   label: "WAF blocked — content not measurable" };
  if (wc === 0) return { score: 0,   label: "No content detected" };
  if (wc < 100) return { score: 20,  label: `${wc} words — thin content (≥300 recommended)` };
  if (wc < 300) return { score: 55,  label: `${wc} words — below average` };
  if (wc < 700) return { score: 80,  label: `${wc} words — good content depth` };
  return         { score: 100, label: `${wc} words — excellent content depth` };
}

function scoreResponseTime(ms: number): ScoreResult {
  if (!ms || ms === 0) return { score: 0,   label: "N/A" };
  if (ms < 500)        return { score: 100, label: `${ms}ms — excellent` };
  if (ms < 1000)       return { score: 90,  label: `${ms}ms — very fast` };
  if (ms < 1500)       return { score: 75,  label: `${ms}ms — good` };
  if (ms < 2500)       return { score: 55,  label: `${ms}ms — moderate` };
  if (ms < 3500)       return { score: 30,  label: `${ms}ms — slow` };
  return               { score: 10,  label: `${ms}ms — very slow` };
}

function scoreImages(count: number, missing: number): ScoreResult {
  if (count === 0) return { score: 100, label: "No images — not applicable" };
  if (missing === 0) return { score: 100, label: `All ${count} images have alt text` };
  const pct = Math.round(((count - missing) / count) * 100);
  if (pct >= 80) return { score: 80, label: `${pct}% alt text coverage (${missing} missing)` };
  if (pct >= 50) return { score: 50, label: `${pct}% alt text coverage (${missing} missing)` };
  return          { score: 20, label: `Only ${pct}% have alt text (${missing} missing)` };
}

function scoreOG(hasTitle: boolean, hasDesc: boolean, hasImage: boolean): ScoreResult {
  const count = [hasTitle, hasDesc, hasImage].filter(Boolean).length;
  if (count === 3) return { score: 100, label: "All OG tags present" };
  if (count === 2) return { score: 70,  label: `${count}/3 OG tags — ${!hasImage ? "og:image missing" : !hasTitle ? "og:title missing" : "og:description missing"}` };
  if (count === 1) return { score: 35,  label: "Only 1/3 OG tags present" };
  return           { score: 0,   label: "No Open Graph tags found" };
}

// Compute the overall weighted page score from individual metrics
function computePageScore(r: PageResult): number {
  if (r["WAF Blocked"]) return 0;
  const weights: [number, number][] = [
    [scoreTitle(r["Title Length"] ?? 0).score, 20],
    [scoreDesc(r["Meta Description Length"] ?? 0).score, 15],
    [scoreH1(r["H1 Count"] ?? 0).score, 15],
    [r.HTTPS ? 100 : 0, 15],
    [r["Canonical URL"]?.trim() ? 100 : 30, 10],
    [scoreResponseTime(r["Response Time (ms)"] ?? 0).score, 10],
    [scoreWordCount(r["Word Count"] ?? 0, false).score, 8],
    [r["Has Structured Data"] ? 100 : 55, 4],
    [scoreOG(!!r["OG Title"], !!r["OG Description"], !!r["OG Image"]).score, 3],
  ];
  const total = weights.reduce((a, [, w]) => a + w, 0);
  return Math.round(weights.reduce((a, [s, w]) => a + s * w, 0) / total);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number }) {
  const { grade, color, bg } = gradeOf(score);
  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      <div className="w-20 bg-slate-100 rounded-full h-1.5">
        <div className="h-1.5 rounded-full transition-all" style={{ width: `${score}%`, background: color }} />
      </div>
      <span className="text-xs font-bold w-6 text-right" style={{ color }}>{score}</span>
      <span className="text-xs font-bold w-5 text-center rounded px-1 py-0.5" style={{ color, background: bg }}>{grade}</span>
    </div>
  );
}

interface ParamRowProps {
  label: string;
  tip?: string;
  value: React.ReactNode;
  sub?: string;
  score?: ScoreResult;
  na?: boolean;
}
function ParamRow({ label, tip, value, sub, score, na }: ParamRowProps) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-slate-50 last:border-0">
      <div className="w-36 flex-shrink-0">
        {tip ? (
          <Tooltip text={tip}>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</span>
          </Tooltip>
        ) : (
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-slate-800 font-medium break-words">{value}</div>
        {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
        {score && !na && (
          <div className="text-xs mt-1" style={{ color: gradeOf(score.score).color }}>{score.label}</div>
        )}
      </div>
      {score && !na && <ScoreBadge score={score.score} />}
      {na && <span className="text-xs text-slate-300 flex-shrink-0">N/A</span>}
    </div>
  );
}

function SectionHeader({ title, icon }: { title: string; icon: string }) {
  return (
    <div className="flex items-center gap-2 pt-4 pb-2 border-b-2 border-[#1a3c5e] mb-1">
      <span className="text-base">{icon}</span>
      <h4 className="text-xs font-bold text-[#1a3c5e] uppercase tracking-widest">{title}</h4>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

interface Props { page: PageResult | null; onClose: () => void }

export default function PageDetailPanel({ page, onClose }: Props) {
  if (!page) return null;

  const pageScore = computePageScore(page);
  const { grade, color: gradeColor } = gradeOf(pageScore);
  const isWaf = page["WAF Blocked"] ?? false;

  const tScore = scoreTitle(page["Title Length"] ?? 0);
  const dScore = scoreDesc(page["Meta Description Length"] ?? 0);
  const h1Score = scoreH1(page["H1 Count"] ?? 0);
  const wcScore = scoreWordCount(page["Word Count"] ?? 0, isWaf);
  const rtScore = scoreResponseTime(page["Response Time (ms)"] ?? 0);
  const imgScore = scoreImages(page["Image Count"] ?? 0, page["Images Missing Alt"] ?? 0);
  const ogScore = scoreOG(!!page["OG Title"], !!page["OG Description"], !!page["OG Image"]);
  const canonScore = { score: page["Canonical URL"]?.trim() ? 100 : 30, label: page["Canonical URL"]?.trim() ? "Canonical tag present" : "Missing — duplicate content risk" };
  const httpsScore = { score: page.HTTPS ? 100 : 0, label: page.HTTPS ? "Secure HTTPS connection" : "HTTP only — ranking penalty" };
  const schemaScore = { score: page["Has Structured Data"] ? 100 : 55, label: page["Has Structured Data"] ? `Schema types: ${page["Schema Types"] || "present"}` : "Missing — rich result opportunities lost" };

  const criticals = (page["Critical Issues"] ?? "").split(";").map(s => s.trim()).filter(Boolean);
  const warnings  = (page.Warnings ?? "").split(";").map(s => s.trim()).filter(Boolean);
  const info      = (page.Info ?? "").split(";").map(s => s.trim()).filter(Boolean);

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      {/* Backdrop */}
      <div className="flex-1 bg-black/30 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="w-full max-w-2xl bg-white h-full overflow-y-auto shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Panel header */}
        <div className="sticky top-0 z-10 bg-[#1a3c5e] text-white px-6 py-4 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`text-xs font-bold px-2 py-0.5 rounded ${page["Status Code"] === 200 ? "bg-emerald-500" : "bg-red-500"}`}>
                {page["Status Code"]}
              </span>
              {isWaf && <span className="text-xs font-bold px-2 py-0.5 rounded bg-purple-500">WAF Blocked</span>}
              {page.HTTPS && <span className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-600">HTTPS</span>}
              {page.Indexable
                ? <span className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-600">Indexable</span>
                : <span className="text-xs font-bold px-2 py-0.5 rounded bg-red-500">Not Indexable</span>}
            </div>
            <p className="text-xs text-blue-200 break-all line-clamp-2">{page.URL}</p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {/* Overall score */}
            <div className="text-center">
              <div className="text-3xl font-black" style={{ color: gradeColor }}>{pageScore}</div>
              <div className="text-xs text-blue-200">Grade {grade}</div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Score bar */}
        <div className="w-full bg-slate-100 h-2">
          <div className="h-2 transition-all" style={{ width: `${pageScore}%`, background: gradeColor }} />
        </div>

        {/* Open in new tab */}
        <div className="px-6 py-2 border-b border-slate-100 flex items-center gap-2">
          <a href={page.URL} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-blue-600 hover:underline">
            <ExternalLink size={12} />
            Open page in new tab
          </a>
          {page["Final URL"] && page["Final URL"] !== page.URL && (
            <span className="text-xs text-slate-400">→ Redirects to: <span className="font-mono">{page["Final URL"].substring(0, 50)}</span></span>
          )}
        </div>

        {/* Body */}
        <div className="px-6 py-2 flex-1">

          {/* WAF warning */}
          {isWaf && (
            <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 my-3 text-sm text-purple-800">
              <strong>⚠️ WAF / Bot Protection Detected</strong>
              <p className="mt-1 text-xs">This page was intercepted by a bot-protection system (e.g., Cloudflare, AWS WAF). The metrics below reflect the challenge page, not your real content. SEO signals cannot be accurately measured.</p>
            </div>
          )}

          {/* ── Content Signals ── */}
          <SectionHeader title="Content Signals" icon="📝" />
          <ParamRow
            label="Meta Title"
            tip="The <title> tag is displayed as the blue headline in Google search results. It should be 30–60 characters, include your primary keyword near the front, and be unique for every page. It's one of the most important on-page SEO signals."
            value={page.Title ? `"${page.Title.substring(0, 80)}"` : <span className="text-red-500 italic">Not set</span>}
            sub={page.Title ? `${page["Title Length"]} characters` : undefined}
            score={tScore}
          />
          <ParamRow
            label="Meta Description"
            tip="The meta description appears as the grey text under the title in Google search results. It doesn't directly affect rankings but heavily influences click-through rates (CTR). Optimal length is 70–160 characters. Write it like ad copy — it's your SERP sales pitch."
            value={page["Meta Description"] ? `"${page["Meta Description"].substring(0, 120)}"` : <span className="text-amber-500 italic">Not set</span>}
            sub={page["Meta Description"] ? `${page["Meta Description Length"]} characters` : undefined}
            score={dScore}
          />
          <ParamRow
            label="H1 Tag"
            tip="The H1 is the main visible heading on a page. There should be exactly one H1 per page, and it should contain your primary keyword. It helps both users and Google understand the page's main topic."
            value={page["H1 First"] || <span className="text-red-500 italic">Missing</span>}
            sub={page["H1 Count"] > 1 ? `⚠ ${page["H1 Count"]} H1 tags found — only 1 recommended` : undefined}
            score={h1Score}
          />
          <ParamRow
            label="H2 Tags"
            tip="H2 tags are subheadings that structure your content. They help Google understand content hierarchy and are a secondary keyword placement opportunity. Use them to break up long content and improve readability."
            value={`${page["H2 Count"] ?? 0} found`}
            sub={page["H2 First"] ? `First: "${page["H2 First"].substring(0, 60)}"` : undefined}
          />
          <ParamRow
            label="H3 Tags"
            value={`${page["H3 Count"] ?? 0} found`}
          />
          <ParamRow
            label="Word Count"
            tip="Content length is a quality signal. Pages with <300 words are considered 'thin content' and may rank poorly. Long-form content (>700 words) tends to rank better for competitive keywords as it demonstrates depth and expertise."
            value={isWaf ? "N/A" : `${page["Word Count"] ?? 0} words`}
            sub={page["Paragraph Count"] ? `${page["Paragraph Count"]} paragraphs` : undefined}
            score={isWaf ? undefined : wcScore}
            na={isWaf}
          />
          {page["Flesch Reading Ease"] !== "" && page["Flesch Reading Ease"] !== undefined && (
            <ParamRow
              label="Readability"
              value={`Flesch score: ${page["Flesch Reading Ease"]}`}
              sub={
                Number(page["Flesch Reading Ease"]) >= 60 ? "Easy to read (general audience)"
                : Number(page["Flesch Reading Ease"]) >= 30 ? "Moderate — may suit academic content"
                : "Difficult — consider simplifying"
              }
            />
          )}
          <ParamRow
            label="Meta Keywords"
            value={page["Meta Keywords"] || <span className="text-slate-400 italic">Not set (not a ranking factor)</span>}
          />

          {/* ── Technical SEO ── */}
          <SectionHeader title="Technical SEO" icon="⚙️" />
          <ParamRow
            label="HTTPS"
            tip="HTTPS (SSL/TLS encryption) is a confirmed Google ranking signal. Pages served over HTTP are marked 'Not Secure' in Chrome and will be ranked lower than equivalent HTTPS pages."
            value={page.HTTPS ? "✅ Secure" : "❌ HTTP only"}
            score={httpsScore}
          />
          <ParamRow
            label="Indexability"
            tip="An indexable page can appear in Google search results. Pages can be non-indexable due to noindex meta tags, X-Robots-Tag headers, robots.txt blocks, 4xx/5xx status codes, or canonical tags pointing elsewhere."
            value={page.Indexable ? "✅ Indexable" : `❌ Not indexable`}
            sub={page["Indexability Issues"] || undefined}
          />
          <ParamRow
            label="Canonical URL"
            tip="The canonical tag (<link rel='canonical'>) tells Google which URL is the 'official' version of a page. This prevents duplicate content issues from URL variations (e.g., with/without trailing slash, query parameters). If pointing to a different domain, it consolidates ranking signals there."
            value={page["Canonical URL"] ? <span className="font-mono text-xs break-all">{page["Canonical URL"].substring(0, 80)}</span> : <span className="text-amber-500 italic">Missing</span>}
            score={canonScore}
          />
          <ParamRow
            label="Meta Robots"
            tip="The robots meta tag controls how search engines index this page and follow its links. 'noindex' prevents the page from appearing in search results. 'nofollow' prevents crawlers from following links on this page. Default behaviour (when absent) is 'index, follow'."
            value={page["Meta Robots"] || <span className="text-slate-400 italic">Not set (defaults to index, follow)</span>}
          />
          <ParamRow
            label="X-Robots-Tag"
            tip="An HTTP response header equivalent to the meta robots tag. Applied at the server level, it can apply to non-HTML files (PDFs, images). Takes precedence over meta robots if both are set."
            value={page["X-Robots-Tag"] || <span className="text-slate-400 italic">Not set</span>}
          />
          <ParamRow
            label="Response Time (TTFB)"
            tip="Time To First Byte — the time from when a browser sends a request until it receives the first byte from the server. Google considers <800ms excellent, <1800ms 'needs improvement', and >1800ms poor. This is a Core Web Vitals signal."
            value={page["Response Time (ms)"] ? `${page["Response Time (ms)"]}ms` : "N/A"}
            score={rtScore.label !== "N/A" ? rtScore : undefined}
            na={!page["Response Time (ms)"]}
          />
          {(page["Full Load Time (ms)"] ?? 0) > 0 && page["Full Load Time (ms)"] !== page["Response Time (ms)"] && (
            <ParamRow
              label="Full Load Time"
              tip="Total time for the page to fully load including all JavaScript rendering and hydration. This is higher than TTFB because modern SPAs (React, Next.js etc.) need additional time to execute JavaScript and render content. Google's TTFB measures the first byte, not the full JS render time."
              value={`${page["Full Load Time (ms)"]}ms`}
              sub="Includes JS rendering / SPA hydration time"
            />
          )}
          <ParamRow
            label="Page Size"
            value={page["Page Size (KB)"] ? `${page["Page Size (KB)"]} KB` : "N/A"}
            sub={
              (page["Page Size (KB)"] ?? 0) > 5000 ? "⚠ Very large page" :
              (page["Page Size (KB)"] ?? 0) > 2000 ? "ℹ Consider optimising" : undefined
            }
          />
          <ParamRow
            label="Text:HTML Ratio"
            tip="The percentage of the page's HTML that is actual text content (vs. markup, scripts, styles). A higher ratio generally indicates a more content-rich page. Very low ratios (<5%) can signal thin content or excessive code bloat."
            value={page["Text to HTML Ratio (%)"] ? `${page["Text to HTML Ratio (%)"]}%` : "N/A"}
            sub="Higher is better — more content relative to markup"
          />
          <ParamRow label="Server" value={page.Server || <span className="text-slate-400 italic">Not disclosed</span>} />

          {/* ── Media & Links ── */}
          <SectionHeader title="Media &amp; Links" icon="🖼️" />
          <ParamRow
            label="Images"
            tip="Alt text (alternative text) is an HTML attribute added to <img> tags that describes the image. It serves three purposes: (1) search engines use it to understand image content for image search, (2) screen readers use it for accessibility (WCAG compliance), and (3) it's displayed when images fail to load."
            value={`${page["Image Count"] ?? 0} total`}
            sub={page["Images Missing Alt"] ? `${page["Images Missing Alt"]} missing alt text` : "All images have alt text"}
            score={imgScore}
          />
          <ParamRow label="Internal Links" value={`${page["Internal Links"] ?? 0} links`} />
          <ParamRow label="External Links" value={`${page["External Links"] ?? 0} links`} />
          <ParamRow label="Nofollow Links" value={`${page["Nofollow Links"] ?? 0} links`} />
          <ParamRow label="Total Links"    value={`${page["Total Links"] ?? 0} links`} />
          <ParamRow label="Scripts"        value={`${page["Scripts Count"] ?? 0} external`} />
          <ParamRow label="Stylesheets"    value={`${page["Stylesheets Count"] ?? 0} external`} />
          <ParamRow label="iFrames"        value={`${page["Iframes Count"] ?? 0}`} />

          {/* ── Social & Schema ── */}
          <SectionHeader title="Social &amp; Schema" icon="🌐" />
          <ParamRow
            label="Open Graph"
            tip="Open Graph tags (og:title, og:description, og:image) control how your page appears when shared on Facebook, LinkedIn, Slack, and other platforms. The og:image is especially important — use a 1200×630px image for best results. Without OG tags, platforms generate their own often-poor previews."
            value={page["OG Title"] ? `"${page["OG Title"].substring(0, 60)}"` : <span className="text-slate-400 italic">og:title not set</span>}
            sub={[
              page["OG Description"] ? `og:description ✅` : "og:description ❌",
              page["OG Image"] ? "og:image ✅" : "og:image ❌",
              page["OG Type"] ? `type: ${page["OG Type"]}` : "",
            ].filter(Boolean).join("  ·  ")}
            score={ogScore}
          />
          <ParamRow
            label="Twitter Card"
            tip="Twitter Card tags control how links appear when shared on Twitter/X. 'summary_large_image' displays a large image preview and is the recommended type for article and content pages."
            value={page["Twitter Card"] || <span className="text-slate-400 italic">Not set</span>}
          />
          <ParamRow
            label="Structured Data"
            tip="Schema.org structured data (JSON-LD format) helps Google understand your content semantically and can unlock rich results in SERPs: star ratings, FAQs, breadcrumbs, recipes, events, job postings, etc. Rich results typically have significantly higher click-through rates than standard results."
            value={page["Has Structured Data"] ? page["Schema Types"] || "Present" : <span className="text-slate-400 italic">None detected</span>}
            score={schemaScore}
          />
          <ParamRow
            label="Hreflang"
            tip="Hreflang tags tell Google which language and region variant of a page to show to users in different locations. Essential for multilingual or multi-regional sites. Without hreflang, Google may show users the wrong language version of your content."
            value={page["Hreflang Languages"] || <span className="text-slate-400 italic">None (may be intentional)</span>}
          />

          {/* ── Issues ── */}
          {(criticals.length > 0 || warnings.length > 0 || info.length > 0) && (
            <>
              <SectionHeader title="Detected Issues" icon="🚨" />
              {criticals.map((issue, i) => (
                <div key={i} className="flex items-start gap-2 py-1.5 text-sm">
                  <XCircle size={15} className="text-red-500 mt-0.5 flex-shrink-0" />
                  <span className="text-red-700">{issue}</span>
                </div>
              ))}
              {warnings.map((issue, i) => (
                <div key={i} className="flex items-start gap-2 py-1.5 text-sm">
                  <AlertCircle size={15} className="text-amber-500 mt-0.5 flex-shrink-0" />
                  <span className="text-amber-700">{issue}</span>
                </div>
              ))}
              {info.map((issue, i) => (
                <div key={i} className="flex items-start gap-2 py-1.5 text-sm">
                  <Info size={15} className="text-blue-400 mt-0.5 flex-shrink-0" />
                  <span className="text-slate-600">{issue}</span>
                </div>
              ))}
            </>
          )}
          <div className="h-8" />
        </div>
      </div>
    </div>
  );
}
