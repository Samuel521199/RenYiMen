"use client";

import { useState, useCallback } from "react";
import { saveFileWithPicker } from "@/lib/save-file-with-picker";

interface TextResultDisplayProps {
  text: string;
}

export function TextResultDisplay({ text }: TextResultDisplayProps) {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 降级：选中文本
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [text]);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    try {
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      await saveFileWithPicker(blob, "prompt.txt", [
        { description: "文本文件", accept: { "text/plain": [".txt"] } },
      ]);
    } finally {
      setDownloading(false);
    }
  }, [text]);

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold text-foreground">提示词已生成</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/30">
            ✓ 完成
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
              bg-white/10 hover:bg-white/20 border border-white/20 hover:border-white/30
              transition-all duration-150 active:scale-95"
          >
            {copied ? (
              <>
                <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-green-400">已复制</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span>复制</span>
              </>
            )}
          </button>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
              bg-primary/20 hover:bg-primary/30 border border-primary/40 hover:border-primary/60
              text-primary-foreground transition-all duration-150 active:scale-95
              disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {downloading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                <span>保存中…</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span>下载 .txt</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Text content */}
      <div className="relative rounded-xl border border-white/15 bg-white/5 overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary/60 via-primary/30 to-transparent" />
        <pre className="p-4 text-sm text-foreground/90 whitespace-pre-wrap break-words leading-relaxed font-sans max-h-96 overflow-y-auto">
          {text}
        </pre>
      </div>

      <p className="text-xs text-muted-foreground text-center">
        可将上方提示词粘贴到 AI 绘画工具（如 Stable Diffusion、Midjourney 等）的正向提示词栏中使用
      </p>
    </div>
  );
}
