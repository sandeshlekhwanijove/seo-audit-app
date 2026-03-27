// Ensure BASE always has a protocol so it's never treated as a relative path.
const _raw = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const BASE = _raw.startsWith("http") ? _raw : `https://${_raw}`;

export interface AuditRequest {
  url: string;
  mode: "page" | "site";
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
  Title: string;
  "Title Length": number;
  "Meta Description": string;
  "Meta Description Length": number;
  "H1 Count": number;
  "H1 First": string;
  "H2 Count": number;
  "Word Count": number;
  "Canonical URL": string;
  Indexable: boolean;
  "WAF Blocked": boolean;
  "Content Timed Out": boolean;
  HTTPS: boolean;
  "Has Structured Data": boolean;
  "Schema Types": string;
  "OG Title": string;
  "OG Image": string;
  "Image Count": number;
  "Images Missing Alt": number;
  "Internal Links": number;
  "External Links": number;
  "Critical Count": number;
  "Warning Count": number;
  "Info Count": number;
  "Critical Issues": string;
  Warnings: string;
  Info: string;
  "Page Size (KB)": number;
  "Flesch Reading Ease": number | string;
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
