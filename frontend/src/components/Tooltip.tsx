"use client";
import { useState, useRef } from "react";
import { Info } from "lucide-react";

interface TooltipProps {
  text: string;
  children?: React.ReactNode;
  size?: number;
  className?: string;
}

export default function Tooltip({ text, children, size = 13, className = "" }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  function show() {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: r.left });
    }
    setVisible(true);
  }

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {children}
      <span
        ref={ref}
        className="cursor-help text-slate-400 hover:text-blue-500 transition-colors"
        onMouseEnter={show}
        onMouseLeave={() => setVisible(false)}
        onFocus={show}
        onBlur={() => setVisible(false)}
        tabIndex={0}
        role="tooltip"
        aria-label={text}
      >
        <Info size={size} />
      </span>
      {visible && pos && (
        <span
          className="fixed z-50 max-w-xs rounded-lg bg-slate-800 text-white text-xs leading-relaxed px-3 py-2 shadow-xl"
          style={{ top: pos.top, left: Math.min(pos.left, window.innerWidth - 280) }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

// Convenience: label with inline tooltip icon
export function InfoLabel({ label, tip }: { label: string; tip: string }) {
  return (
    <Tooltip text={tip}>
      <span>{label}</span>
    </Tooltip>
  );
}
