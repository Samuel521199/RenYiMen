"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";

interface AudioPlayerProps {
  src: string;
  className?: string;
}

function finiteDuration(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function formatTime(value: number): string {
  const seconds = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function AudioPlayer({ src, className }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.load();
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [src]);

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      await audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  };

  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const volumeProgress = muted ? 0 : volume * 100;

  return (
    <div className={cn(
      "flex min-h-11 w-full items-center gap-3 rounded-xl border border-[#9ef5d8]/15 bg-[#07111b]/95 px-2.5 py-2 text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.035),0_10px_28px_-20px_rgba(0,0,0,0.9)]",
      className,
    )}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={(event) => setDuration(finiteDuration(event.currentTarget.duration))}
        onDurationChange={(event) => setDuration(finiteDuration(event.currentTarget.duration))}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onVolumeChange={(event) => {
          setVolume(event.currentTarget.volume);
          setMuted(event.currentTarget.muted);
        }}
      />

      <button
        type="button"
        onClick={() => void togglePlayback()}
        aria-label={playing ? "Pause audio" : "Play audio"}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#9ef5d8]/20 bg-[#9ef5d8]/[0.09] text-[#9ef5d8] transition hover:border-[#9ef5d8]/35 hover:bg-[#9ef5d8]/[0.16] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9ef5d8]/20"
      >
        {playing ? <Pause className="h-3.5 w-3.5" fill="currentColor" /> : <Play className="ml-0.5 h-3.5 w-3.5" fill="currentColor" />}
      </button>

      <span className="shrink-0 text-[11px] font-medium tabular-nums text-slate-400">
        {formatTime(currentTime)} <span className="text-white/20">/</span> {formatTime(duration)}
      </span>

      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.01}
        value={Math.min(currentTime, duration || 0)}
        disabled={duration <= 0}
        onChange={(event) => {
          const nextTime = Number(event.target.value);
          if (!audioRef.current || !Number.isFinite(nextTime)) return;
          audioRef.current.currentTime = nextTime;
          setCurrentTime(nextTime);
        }}
        aria-label="Audio progress"
        className="audio-player-slider min-w-16 flex-1"
        style={{ background: `linear-gradient(90deg, rgb(158 245 216 / 0.88) 0% ${progress}%, rgb(255 255 255 / 0.12) ${progress}% 100%)` }}
      />

      <button
        type="button"
        onClick={() => {
          if (!audioRef.current) return;
          audioRef.current.muted = !audioRef.current.muted;
        }}
        aria-label={muted ? "Unmute audio" : "Mute audio"}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/[0.055] hover:text-[#9ef5d8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9ef5d8]/20"
      >
        {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </button>

      <input
        type="range"
        min={0}
        max={1}
        step={0.02}
        value={muted ? 0 : volume}
        onChange={(event) => {
          const nextVolume = Number(event.target.value);
          if (!audioRef.current || !Number.isFinite(nextVolume)) return;
          audioRef.current.muted = false;
          audioRef.current.volume = nextVolume;
        }}
        aria-label="Audio volume"
        className="audio-player-slider hidden w-14 shrink-0 sm:block"
        style={{ background: `linear-gradient(90deg, rgb(158 245 216 / 0.7) 0% ${volumeProgress}%, rgb(255 255 255 / 0.12) ${volumeProgress}% 100%)` }}
      />
    </div>
  );
}
