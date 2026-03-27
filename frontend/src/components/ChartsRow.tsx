"use client";

import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { PageResult, AuditSummary } from "@/lib/api";

interface Props { results: PageResult[]; summary: AuditSummary }

export default function ChartsRow({ results, summary }: Props) {
  const idxData = [
    { name: "Indexable", value: summary.indexable, color: "#10b981" },
    { name: "Non-Indexable", value: summary.non_indexable, color: "#ef4444" },
  ];

  const speedBuckets = [
    { name: "Fast (<1s)",    count: results.filter(r => (r["Response Time (ms)"] ?? 0) < 1000).length,  fill: "#10b981" },
    { name: "OK (1–2s)",     count: results.filter(r => { const t = r["Response Time (ms)"] ?? 0; return t >= 1000 && t < 2000; }).length, fill: "#f59e0b" },
    { name: "Slow (2–3s)",   count: results.filter(r => { const t = r["Response Time (ms)"] ?? 0; return t >= 2000 && t < 3000; }).length, fill: "#f97316" },
    { name: "Very Slow (>3s)", count: results.filter(r => (r["Response Time (ms)"] ?? 0) >= 3000).length, fill: "#ef4444" },
  ];

  const issueBreakdown = [
    { name: "Missing Canonical", count: results.filter(r => !r["Canonical URL"]?.trim() && !r["WAF Blocked"]).length },
    { name: "Missing Meta Desc", count: results.filter(r => !r["Meta Description"]?.trim() && !r["WAF Blocked"]).length },
    { name: "H1 Issues",         count: results.filter(r => r["H1 Count"] !== 1 && !r["WAF Blocked"]).length },
    { name: "Missing Alt Text",  count: results.filter(r => (r["Images Missing Alt"] ?? 0) > 0 && !r["WAF Blocked"]).length },
    { name: "Title Issues",      count: results.filter(r => { const l = r["Title Length"] ?? 0; return (l < 30 || l > 60) && !r["WAF Blocked"]; }).length },
    { name: "Thin Content",      count: results.filter(r => { const w = r["Word Count"] ?? 0; return w > 0 && w < 100 && !r["WAF Blocked"]; }).length },
  ].sort((a, b) => b.count - a.count);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6 fade-up">
      {/* Indexability donut */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        <h3 className="font-bold text-slate-800 mb-4 text-sm">Indexability</h3>
        <ResponsiveContainer width="100%" height={160}>
          <PieChart>
            <Pie data={idxData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value">
              {idxData.map((entry, index) => (
                <Cell key={index} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip formatter={(v: number) => [`${v} pages`]} />
            <Legend iconType="circle" iconSize={8} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Response time */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        <h3 className="font-bold text-slate-800 mb-4 text-sm">Response Time Distribution</h3>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={speedBuckets} layout="vertical" margin={{ left: 4, right: 16 }}>
            <XAxis type="number" tick={{ fontSize: 10 }} />
            <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={80} />
            <Tooltip formatter={(v: number) => [`${v} pages`]} />
            <Bar dataKey="count" radius={[0, 4, 4, 0]}>
              {speedBuckets.map((entry, index) => (
                <Cell key={index} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Issue breakdown */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        <h3 className="font-bold text-slate-800 mb-4 text-sm">Top Issue Categories</h3>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={issueBreakdown} layout="vertical" margin={{ left: 4, right: 16 }}>
            <XAxis type="number" tick={{ fontSize: 10 }} />
            <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={100} />
            <Tooltip formatter={(v: number) => [`${v} pages`]} />
            <Bar dataKey="count" fill="#f59e0b" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
