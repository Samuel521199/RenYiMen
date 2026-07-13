"use client";

import { useState } from "react";
import { useLanguage } from "@workbench/lib/LanguageContext";

interface WhitespacePositionPickerProps {
  value: string[];
  onChange: (positions: string[]) => void;
}

const WHITESPACE_OPTIONS = [
  { value: "top", label: "顶部 Top" },
  { value: "center", label: "中心 Center" },
  { value: "left", label: "左侧 Left" },
  { value: "right", label: "右侧 Right" },
  { value: "bottom", label: "底部 Bottom" },
];

const WHITESPACE_REGION_LAYOUT = [
  { value: "top", label: "顶部 Top", x: 8, y: 8, width: 144, height: 56 },
  { value: "bottom", label: "底部 Bottom", x: 8, y: 144, width: 144, height: 48 },
  { value: "left", label: "左侧 Left", x: 8, y: 64, width: 48, height: 80 },
  { value: "right", label: "右侧 Right", x: 104, y: 64, width: 48, height: 80 },
  { value: "center", label: "中心 Center", x: 56, y: 64, width: 48, height: 80 },
] as const;

function selectChipClass(active: boolean) {
  return active
    ? "rounded-full border border-emerald-500 bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white"
    : "rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-emerald-400 hover:text-emerald-700";
}

export default function WhitespacePositionPicker({
  value,
  onChange,
}: WhitespacePositionPickerProps) {
  const { t } = useLanguage();
  const [hovered, setHovered] = useState<string | null>(null);

  function togglePosition(position: string) {
    if (value.includes(position)) {
      onChange(value.filter((item) => item !== position));
      return;
    }
    onChange([...value, position]);
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
      <div className="shrink-0">
        <svg width={160} height={200} viewBox="0 0 160 200" className="overflow-visible" aria-label="留白位置示意图">
          <rect x={0.5} y={0.5} width={159} height={199} rx={8} fill="white" stroke="#d1d5db" />
          {WHITESPACE_REGION_LAYOUT.map((region) => {
            const active = value.includes(region.value);
            const isHovered = hovered === region.value;
            return (
              <g key={region.value}>
                <rect
                  x={region.x}
                  y={region.y}
                  width={region.width}
                  height={region.height}
                  rx={6}
                  fill={active ? "rgba(0,0,0,0.15)" : isHovered ? "rgba(0,0,0,0.06)" : "transparent"}
                  stroke="#d1d5db"
                  strokeWidth={0.5}
                  strokeDasharray="3 3"
                  className="cursor-pointer transition-colors"
                  onMouseEnter={() => setHovered(region.value)}
                  onMouseLeave={() => setHovered((current) => (current === region.value ? null : current))}
                  onClick={() => togglePosition(region.value)}
                />
                <text
                  x={region.x + region.width / 2}
                  y={region.y + region.height / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="pointer-events-none fill-gray-500 text-[11px]"
                >
                  {t(region.label)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="flex flex-wrap content-start gap-2">
        {WHITESPACE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => togglePosition(option.value)}
            aria-pressed={value.includes(option.value)}
            className={selectChipClass(value.includes(option.value))}
          >
            {t(option.label)}
          </button>
        ))}
      </div>
    </div>
  );
}
