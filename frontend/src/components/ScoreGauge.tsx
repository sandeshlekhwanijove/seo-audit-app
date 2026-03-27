"use client";

interface Props { score: number }

const gradeInfo = (s: number) => {
  if (s >= 90) return { grade: "A", color: "#10b981", label: "Excellent" };
  if (s >= 75) return { grade: "B", color: "#22c55e", label: "Good" };
  if (s >= 60) return { grade: "C", color: "#f59e0b", label: "Needs work" };
  if (s >= 40) return { grade: "D", color: "#f97316", label: "Poor" };
  return { grade: "F", color: "#ef4444", label: "Critical" };
};

export default function ScoreGauge({ score }: Props) {
  const { grade, color, label } = gradeInfo(score);
  const R = 80;
  const arcLen = Math.PI * R; // half-circle
  const filled = (score / 100) * arcLen;
  const offset = arcLen - filled;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 220 130" width="220" height="130">
        {/* Track */}
        <path
          d="M 30 115 A 80 80 0 0 1 190 115"
          fill="none"
          stroke="rgba(0,0,0,0.08)"
          strokeWidth="18"
          strokeLinecap="round"
        />
        {/* Arc */}
        <path
          d="M 30 115 A 80 80 0 0 1 190 115"
          fill="none"
          stroke={color}
          strokeWidth="18"
          strokeLinecap="round"
          strokeDasharray={arcLen}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 1.2s ease, stroke 0.5s" }}
        />
        {/* Score number */}
        <text
          x="110" y="100"
          textAnchor="middle"
          fill="#1e293b"
          fontSize="44"
          fontWeight="800"
          fontFamily="Inter,sans-serif"
        >
          {score}
        </text>
      </svg>
      <div
        className="text-2xl font-black mt-[-8px]"
        style={{ color }}
      >
        Grade {grade}
      </div>
      <div className="text-xs text-slate-500 uppercase tracking-widest mt-1">
        {label}
      </div>
    </div>
  );
}
