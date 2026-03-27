import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SEO Audit Tool",
  description: "Technical SEO crawler — Screaming Frog-style audits in your browser",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {/* Subtle animated background */}
        <div className="dyn-bg" aria-hidden="true">
          <div className="dyn-bg-blob" />
          <div className="dyn-bg-blob" />
          <div className="dyn-bg-blob" />
        </div>
        <div className="relative z-10">
          {children}
        </div>
      </body>
    </html>
  );
}
