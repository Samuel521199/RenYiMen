"use client";

import { useCallback, useRef, useState, type DragEvent } from "react";

interface UseFileDropOptions {
  disabled?: boolean;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
}

export function useFileDrop({ disabled = false, multiple = false, onFiles }: UseFileDropOptions) {
  const [isDragging, setIsDragging] = useState(false);
  const dragDepthRef = useRef(0);

  const handleDragEnter = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (disabled || !event.dataTransfer.types.includes("Files")) return;
    dragDepthRef.current += 1;
    setIsDragging(true);
  }, [disabled]);

  const handleDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!disabled) event.dataTransfer.dropEffect = "copy";
  }, [disabled]);

  const handleDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragging(false);
  }, []);

  const handleDrop = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragging(false);
    if (disabled) return;

    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) onFiles(multiple ? files : files.slice(0, 1));
  }, [disabled, multiple, onFiles]);

  return {
    isDragging,
    dropZoneProps: {
      onDragEnter: handleDragEnter,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
  };
}
