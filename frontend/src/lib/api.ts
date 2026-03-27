// Ensure BASE always has a protocol so it's never treated as a relative path.
const _raw = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const BASE = _raw.startsWith("http") ? _raw : `https://${_raw}`;

export interface AuditRequest {
  url: string;
  mode: "page" | "site" | "sitemap";
  max_pages?: number;
  delay_s?: number;
}

export interface AuditStatus {
  job_id: string;
  status: "queued" | "running" | "done" | "error";
  progress: number;
  current_url: string;
  pages_done: number;
  summary: AuditSummary;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface AuditSummary {
  total: number;
  critical_pages: number;
  warning_pages: number;
  indexable: number;
  non_indexable: number;
  waf_blocked: number;
  avg_response_ms: number;
  https_count: number;
  score: number;
}

export interface PageResult {
  URL: string;
  "Final URL": string;
  "Status Code": number;
  "Response Time (ms)": number;
  "Page Size (KB)": number;
  "Page Size (bytes)": number;
  "Content Type": string;
  "Last Modified": string;
  Server: string;
  HTTPS: boolean;

  // Titles & descriptions
  Title: string;
  "Title Length": number;
  "Meta Description": string;
  "Meta Description Length": number;
  "Meta Keywords": string;
  "Meta Robots": string;
  "Meta Viewport": string;
  "X-Robots-Tag": string;

  // Headings
  "H1 Count": number;
  "H1 First": string;
  "H2 Count": number;
  "H2 First": string;
  "H3 Count": number;

  // Canonical & indexability
  "Canonical URL": string;
  Indexable: boolean;
  "Indexability Issues": string;

  // Images
  "Image Count": number;
  "Images Missing Alt": number;
  "Images Empty Alt": number;
  "Images Alt Too Long": number;

  // Links
  "Internal Links": number;
  "External Links": number;
  "Nofollow Links": number;
  "Total Links": number;

  // Open Graph
  "OG Title": string;
  "OG Description": string;
  "OG Image": string;
  "OG Type": string;
  "OG URL": string;

  // Twitter
  "Twitter Card": string;
  "Twitter Title": string;

  // Schema & hreflang
  "Schema Types": string;
  "Has Structured Data": boolean;
  "Hreflang Languages": string;
  "Has Hreflang": boolean;

  // Content metrics
  "Word Count": number;
  "Paragraph Count": number;
  "HTML Size (bytes)": number;
  "Text to HTML Ratio (%)": number;
  "Scripts Count": number;
  "Stylesheets Count": number;
  "Iframes Count": number;
  "Flesch Reading Ease": number | string;

  // Timing (new: TTFB vs full JS load)
  "Full Load Time (ms)": number;
  "Redirect URL": string;

  // Duplicate content detection
  "Duplicate Content": boolean;
  "Duplicate Of": string;

  // robots.txt
  "Blocked by robots.txt": boolean;
  "Robots.txt Sitemaps": string;

  // Crawl metadata
  "Crawl Depth": number;

  // Audit flags
  "WAF Blocked": boolean;
  "Content Timed Out": boolean;

  // Issue counts & lists
  "Critical Count": number;
  "Warning Count": number;
  "Info Count": number;
  "Critical Issues": string;
  Warnings: string;
  Info: string;

  // Computed in table
  _pageScore?: number;
}

export interface AuditResults {
  job_id: string;
  summary: AuditSummary;
  results: PageResult[];
  request: AuditRequest;
  finished_at: string;
}

export async function startAudit(req: AuditRequest): Promise<{ job_id: string }> {
  const res = await fetch(`${BASE}/api/audit/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getStatus(jobId: string): Promise<AuditStatus> {
  const res = await fetch(`${BASE}/api/audit/status/${jobId}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getResults(jobId: string): Promise<AuditResults> {
  const res = await fetch(`${BASE}/api/audit/results/${jobId}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export function excelDownloadUrl(jobId: string): string {
  return `${BASE}/api/audit/download/${jobId}/excel`;
}

export function htmlReportUrl(jobId: string): string {
  return `${BASE}/api/audit/download/${jobId}/report`;
}
