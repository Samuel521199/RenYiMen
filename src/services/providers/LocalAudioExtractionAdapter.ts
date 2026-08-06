import { randomUUID } from "node:crypto";
import { GenerationHistoryStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { extractAudioFromVideo, type AudioExtractionFormat } from "@/services/media/audio-extraction";
import { isOwnOssUrl } from "@/services/video-orchestrator/oss-media";
import type { TaskStatusPollData } from "@/types/task-status";
import type { IProviderAdapter, ProviderCostResult, ProviderResponse, StandardPayload } from "./types";
import { ProviderError } from "./types";

interface LocalAudioExtractionInput {
  videoUrl: string;
  outputFormat: AudioExtractionFormat;
}

type Dependencies = {
  extract: typeof extractAudioFromVideo;
  isAllowedSource: typeof isOwnOssUrl;
};

export function buildLocalAudioExtractionInput(payload: StandardPayload): LocalAudioExtractionInput {
  const input = payload.nodeInputs.input ?? {};
  const videoUrl = typeof input.video_url === "string" ? input.video_url.trim() : "";
  const requestedFormat = typeof input.output_format === "string" ? input.output_format.trim().toLowerCase() : "mp3";
  if (!/^https?:\/\//i.test(videoUrl)) {
    throw new ProviderError("请先上传需要提取音频的视频", "AUDIO_EXTRACT_VIDEO_REQUIRED", 400);
  }
  if (requestedFormat !== "mp3" && requestedFormat !== "wav" && requestedFormat !== "m4a") {
    throw new ProviderError("不支持的音频输出格式", "AUDIO_EXTRACT_FORMAT_INVALID", 400);
  }
  return { videoUrl, outputFormat: requestedFormat };
}

export class LocalAudioExtractionAdapter implements IProviderAdapter {
  constructor(
    private readonly dependencies: Dependencies = {
      extract: extractAudioFromVideo,
      isAllowedSource: isOwnOssUrl,
    },
  ) {}

  calculateCost(): ProviderCostResult {
    return { cost: 0, sellPrice: 0 };
  }

  async generate(payload: StandardPayload): Promise<ProviderResponse> {
    const input = buildLocalAudioExtractionInput(payload);
    if (!this.dependencies.isAllowedSource(input.videoUrl)) {
      throw new ProviderError(
        "仅支持处理通过本平台上传的视频，请重新上传源文件",
        "AUDIO_EXTRACT_SOURCE_NOT_ALLOWED",
        400,
      );
    }
    const taskId = `audio_extract_${randomUUID().replace(/-/g, "")}`;
    try {
      const result = await this.dependencies.extract(input.videoUrl, input.outputFormat, taskId);
      return {
        taskId,
        raw: {
          directResult: {
            status: "succeeded",
            resultUrls: [result.url],
            resultMediaType: "audio",
            providerCost: 0,
            audio: result,
          },
        },
      };
    } catch (error) {
      throw new ProviderError(
        error instanceof Error ? error.message : "音频提取失败",
        "AUDIO_EXTRACT_FAILED",
        400,
        error,
      );
    }
  }

  async queryTask(taskId: string): Promise<TaskStatusPollData> {
    const record = await prisma.generationHistory.findUnique({
      where: { taskId },
      select: { status: true, resultUrl: true, errorMessage: true },
    });
    if (!record) return { status: "failed", errorMessage: "音频提取记录不存在" };
    if (record.status === GenerationHistoryStatus.SUCCESS && record.resultUrl) {
      return { status: "succeeded", resultUrl: record.resultUrl, resultMediaType: "audio", providerCost: 0 };
    }
    if (record.status === GenerationHistoryStatus.FAILED) {
      return { status: "failed", errorMessage: record.errorMessage || "音频提取失败" };
    }
    return { status: "running", progress: 90 };
  }
}
