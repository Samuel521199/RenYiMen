"use client";

import { useEffect, useRef, useState } from "react";

import { useLanguage } from "@/lib/LanguageContext";
import type { PostConfig } from "@/lib/video-workflow";

interface Props {
  config: PostConfig;
  finalVideoUrl?: string;
  onChange: (config: PostConfig) => void;
  onCompose?: () => void;
  composing?: boolean;
  onLogoSelect: (url: string, assetId: number) => void;
}

function Toggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
        value ? "bg-blue-600" : "bg-gray-200"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          value ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function LogoPickerModal({
  onSelect,
  onClose,
}: {
  onSelect: (url: string, assetId: number) => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [items, setItems] = useState<{ id: number; url: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("token") ?? "";
    fetch("/api/assets?category=logo&page=1&page_size=20", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((response) => response.json())
      .then((res) => {
        if (res?.code === 0) {
          setItems(
            (res.data ?? []).map((asset: any) => ({
              id: asset.id,
              url: asset.url?.startsWith("http") ? asset.url : `http://localhost:8000${asset.url}`,
            })),
          );
        }
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-[480px] max-w-[95vw] rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold">{t("选择 Logo")}</h3>
          <button onClick={onClose} className="text-xl text-gray-400 hover:text-gray-600">
            ×
          </button>
        </div>
        {loading ? (
          <div className="py-8 text-center text-gray-400">{t("加载中...")}</div>
        ) : items.length === 0 ? (
          <div className="py-8 text-center text-gray-400">
            <div className="mb-2 text-3xl">🏷</div>
            <div className="text-sm">{t("素材库中还没有 Logo")}</div>
            <div className="mt-1 text-xs text-gray-300">{t("请先在素材库上传 Logo 图片")}</div>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-3">
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => onSelect(item.url, item.id)}
                className="aspect-square overflow-hidden rounded-xl border-2 border-gray-200 bg-gray-50 hover:border-blue-400"
              >
                <img src={item.url} alt="" className="h-full w-full object-contain p-1" />
              </button>
            ))}
          </div>
        )}
        <div className="mt-4 border-t border-gray-100 pt-4 text-center">
          <button onClick={onClose} className="text-sm text-gray-400 hover:text-gray-600">
            {t("取消")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PostProcessor({
  config,
  finalVideoUrl,
  onChange,
  onCompose,
  composing = false,
  onLogoSelect,
}: Props) {
  const { t } = useLanguage();
  const previewRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const configRef = useRef(config);
  const draggingRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const currentTimeRef = useRef(0);
  const rafRef = useRef<number>(0);
  const [showLogoPicker, setShowLogoPicker] = useState(false);
  const [showFullPreview, setShowFullPreview] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [displayTime, setDisplayTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const update = <K extends keyof PostConfig>(layer: K, value: Partial<PostConfig[K]>) => {
    const next = {
      ...configRef.current,
      [layer]: {
        ...configRef.current[layer],
        ...value,
      },
    } as PostConfig;
    configRef.current = next;
    onChange(next);
  };

  const handleLogoMouseDown = (event: React.MouseEvent) => {
    event.preventDefault();
    draggingRef.current = true;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    dragOffsetRef.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!draggingRef.current || !previewRef.current) return;
      const container = previewRef.current.getBoundingClientRect();
      const x = ((event.clientX - container.left - dragOffsetRef.current.x) / container.width) * 100;
      const y = ((event.clientY - container.top - dragOffsetRef.current.y) / container.height) * 100;
      update("logo", {
        x: Math.max(0, Math.min(85, x)),
        y: Math.max(0, Math.min(85, y)),
      });
    };
    const handleMouseUp = () => {
      draggingRef.current = false;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const hasAnyLayer = config.logo.enabled || config.subtitle.enabled || config.cta.enabled;

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (playing) {
      videoRef.current.pause();
    } else {
      void videoRef.current.play();
    }
  };

  const handleTimeUpdate = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    currentTimeRef.current = (event.target as HTMLVideoElement).currentTime;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      setDisplayTime(currentTimeRef.current);
    });
  };

  const renderOverlays = (fullPreview = false) => (
    <>
      {config.logo.enabled && config.logo.url && (
        <div
          style={{
            position: "absolute",
            left: `${config.logo.x}%`,
            top: `${config.logo.y}%`,
            width: `${config.logo.size}%`,
            cursor: fullPreview ? "default" : "move",
            userSelect: "none",
            pointerEvents: fullPreview ? "none" : "auto",
          }}
          onMouseDown={fullPreview ? undefined : handleLogoMouseDown}
        >
          <img
            src={config.logo.url}
            alt="logo"
            style={{ width: "100%", height: "auto", display: "block" }}
            draggable={false}
          />
        </div>
      )}

      {config.subtitle.enabled && config.subtitle.text && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            textAlign: "center",
            padding: "0 8px",
            pointerEvents: "none",
            ...(config.subtitle.position === "top"
              ? { top: "8%" }
              : config.subtitle.position === "center"
                ? { top: "50%", transform: "translateY(-50%)" }
                : { bottom: "8%" }),
          }}
        >
          <span
            style={{
              display: "inline-block",
              borderRadius: "4px",
              background: "rgba(0,0,0,0.6)",
              color: "white",
              padding: "4px 12px",
              fontSize: `${config.subtitle.fontSize}px`,
            }}
          >
            {config.subtitle.text}
          </span>
        </div>
      )}

      {config.cta.enabled && config.cta.text && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            textAlign: "center",
            pointerEvents: "none",
            ...(config.cta.position === "top" ? { top: "4%" } : { bottom: "4%" }),
          }}
        >
          <span
            style={{
              display: "inline-block",
              borderRadius: "20px",
              background: "#2563eb",
              color: "white",
              padding: "6px 20px",
              fontSize: "14px",
              fontWeight: "bold",
            }}
          >
            {config.cta.text}
          </span>
        </div>
      )}
    </>
  );

  return (
    <div>
      <h2 className="mb-1 text-base font-semibold text-gray-900">{t("后处理")}</h2>
      <p className="mb-5 text-sm text-gray-500">{t("后处理说明")}</p>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div className="space-y-3">
          <div className="space-y-3 rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span>🏷</span>
                <div>
                  <div className="text-sm font-medium text-gray-700">{t("Logo 水印")}</div>
                  <div className="text-xs text-gray-400">{t("拖动预览区的 Logo 调整位置")}</div>
                </div>
              </div>
              <Toggle value={config.logo.enabled} onChange={(value) => update("logo", { enabled: value })} />
            </div>

            {config.logo.enabled && (
              <div className="space-y-3 border-t border-gray-100 pt-1">
                <div className="flex items-center gap-3">
                  {config.logo.url ? (
                    <img
                      src={config.logo.url}
                      alt="logo"
                      className="h-10 w-10 rounded-lg border border-gray-200 bg-gray-50 object-contain"
                    />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg border-2 border-dashed border-gray-200 text-gray-300">
                      🏷
                    </div>
                  )}
                  <button
                    onClick={() => setShowLogoPicker(true)}
                    className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-left text-sm text-gray-600 hover:bg-gray-50"
                  >
                    {config.logo.url ? t("重新选择 Logo") : t("从素材库选择 Logo")}
                  </button>
                </div>

                {config.logo.url && (
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <div className="text-xs text-gray-500">{t("Logo 大小")}</div>
                      <div className="text-xs text-gray-400">{config.logo.size}%</div>
                    </div>
                    <input
                      type="range"
                      min={5}
                      max={50}
                      value={config.logo.size}
                      onChange={(event) => update("logo", { size: Number(event.target.value) })}
                      className="w-full"
                    />
                  </div>
                )}
                <div className="text-xs text-gray-400">{t("请上传透明背景 PNG 以获得最佳效果")}</div>
              </div>
            )}
          </div>

          <div className="space-y-3 rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span>🔤</span>
                <div className="text-sm font-medium text-gray-700">{t("字幕")}</div>
              </div>
              <Toggle
                value={config.subtitle.enabled}
                onChange={(value) => update("subtitle", { enabled: value })}
              />
            </div>
            {config.subtitle.enabled && (
              <div className="space-y-2 border-t border-gray-100 pt-1">
                <textarea
                  value={config.subtitle.text}
                  onChange={(event) => update("subtitle", { text: event.target.value })}
                  placeholder={t("输入字幕文字...")}
                  rows={2}
                  className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
                  maxLength={100}
                />
                <div className="flex gap-2">
                  {(["top", "center", "bottom"] as const).map((position) => (
                    <button
                      key={position}
                      onClick={() => update("subtitle", { position })}
                      className={`flex-1 rounded-lg border py-1 text-xs transition-all ${
                        config.subtitle.position === position
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-gray-200 text-gray-500"
                      }`}
                    >
                      {position === "top" ? t("顶部") : position === "center" ? t("中部") : t("底部")}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-3 rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span>📢</span>
                <div className="text-sm font-medium text-gray-700">{t("CTA 文字")}</div>
              </div>
              <Toggle value={config.cta.enabled} onChange={(value) => update("cta", { enabled: value })} />
            </div>
            {config.cta.enabled && (
              <div className="space-y-2 border-t border-gray-100 pt-1">
                <input
                  type="text"
                  value={config.cta.text}
                  onChange={(event) => update("cta", { text: event.target.value })}
                  placeholder={t("如：立即领取 / Claim Now")}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
                  maxLength={50}
                />
                <div className="flex gap-2">
                  {(["top", "bottom"] as const).map((position) => (
                    <button
                      key={position}
                      onClick={() => update("cta", { position })}
                      className={`flex-1 rounded-lg border py-1 text-xs transition-all ${
                        config.cta.position === position
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-gray-200 text-gray-500"
                      }`}
                    >
                      {position === "top" ? t("顶部") : t("底部")}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="flex items-center gap-2">
              <span>🎵</span>
              <div>
                <div className="text-sm font-medium text-gray-600">{t("背景音乐")}</div>
                <div className="mt-0.5 text-xs text-gray-400">{t("音频素材库开发中，暂时跳过")}</div>
              </div>
            </div>
          </div>

          {onCompose && (
            <>
              <button
                onClick={onCompose}
                disabled={composing || !hasAnyLayer || !finalVideoUrl}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {composing ? (
                  <>
                    <span className="animate-spin">⏳</span>
                    {t("合成中...")}
                  </>
                ) : (
                  <>
                    <span>⚙</span>
                    {t("合成全部效果")}
                  </>
                )}
              </button>
              {!hasAnyLayer && (
                <p className="text-center text-xs text-gray-400">{t("请先开启至少一个效果层")}</p>
              )}
            </>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-medium text-gray-500">{t("实时预览")}</div>
            {finalVideoUrl && (
              <button onClick={() => setShowFullPreview(true)} className="text-xs text-blue-500 hover:underline">
                {t("放大预览")}
              </button>
            )}
          </div>
          <div className="relative overflow-hidden rounded-xl border border-gray-200 bg-black" ref={previewRef}>
            {finalVideoUrl ? (
              <video
                ref={videoRef}
                src={finalVideoUrl}
                preload="auto"
                className="w-full"
                style={{ maxHeight: "360px", display: "block" }}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={(event) => setDuration((event.target as HTMLVideoElement).duration)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
              />
            ) : (
              <div className="flex h-48 items-center justify-center text-sm text-gray-400">
                {t("请先在 Step 5 选择终稿")}
              </div>
            )}
            {renderOverlays()}
          </div>

          {finalVideoUrl && (
            <div className="mt-2 flex items-center gap-2 px-1">
              <button
                onClick={togglePlay}
                className="w-7 flex-shrink-0 text-lg text-gray-600 hover:text-blue-600"
              >
                {playing ? "⏸" : "▶"}
              </button>
              <div
                className="relative h-1.5 flex-1 cursor-pointer rounded-full bg-gray-200"
                onClick={(event) => {
                  if (!videoRef.current || !duration) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  const pct = (event.clientX - rect.left) / rect.width;
                  videoRef.current.currentTime = pct * duration;
                }}
              >
                <div
                  className="absolute left-0 top-0 h-full rounded-full bg-blue-500"
                  style={{ width: duration ? `${(displayTime / duration) * 100}%` : "0%" }}
                />
              </div>
              <div className="flex-shrink-0 text-xs text-gray-400">
                {Math.floor(displayTime)}/{Math.floor(duration)}s
              </div>
            </div>
          )}

          {hasAnyLayer && (
            <div className="mt-2 text-center text-xs text-gray-400">
              {t("预览仅供参考，合成后效果可能略有差异")}
            </div>
          )}
        </div>
      </div>

      {showLogoPicker && (
        <LogoPickerModal
          onSelect={(url, assetId) => {
            onLogoSelect(url, assetId);
            setShowLogoPicker(false);
          }}
          onClose={() => setShowLogoPicker(false)}
        />
      )}
      {showFullPreview && finalVideoUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setShowFullPreview(false)}
        >
          <div className="relative mx-4 w-full max-w-lg" onClick={(event) => event.stopPropagation()}>
            <div className="relative overflow-hidden rounded-xl bg-black">
              <video src={finalVideoUrl} autoPlay controls className="w-full" style={{ maxHeight: "80vh" }} />
              {renderOverlays(true)}
            </div>
            <button
              onClick={() => setShowFullPreview(false)}
              className="absolute -right-3 -top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white text-gray-600 shadow hover:text-red-500"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
