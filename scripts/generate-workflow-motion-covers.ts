import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

interface MotionCoverTarget {
  skuId: string;
  coverFile: string;
  prompt: string;
}

interface GenerationStateEntry {
  provider?: string;
  imageUrl?: string;
  taskId?: string;
  resultUrl?: string;
  status?: "submitted" | "succeeded" | "failed";
  error?: string;
  updatedAt?: string;
}

const TARGETS: MotionCoverTarget[] = [
  {
    skuId: "RH_PROMPT_REVERSE",
    coverFile: "prompt-reverse.webp",
    prompt: "A luminous AI analysis beam scans across the source image and extracts visual concepts into organized flowing prompt ribbons and semantic nodes. The interface reacts intelligently as details are recognized. Preserve the original composition and art direction. No random camera zoom, no scene cut, no watermark.",
  },
  {
    skuId: "GPT_IMAGE2_REF",
    coverFile: "ai-image-generation.webp",
    prompt: "The creative canvas actively generates a polished image from an initial field of light: shapes, color, texture, and fine detail resolve progressively into the finished artwork. Make the generation process visually clear and purposeful. Preserve the cover design. No scene cut, no watermark.",
  },
  {
    skuId: "RH_BG_REPLACE",
    coverFile: "background-replace.webp",
    prompt: "Keep the foreground subject perfectly stable while the background is cleanly detected and replaced through a controlled vertical transition, changing from the original setting into a vivid cinematic city environment. Strong subject-edge consistency, no subject morphing, no scene cut, no watermark.",
  },
  {
    skuId: "RH_MATTING",
    coverFile: "portrait-cutout.webp",
    prompt: "An accurate glowing contour traces around the person, then the background smoothly dissolves away to reveal a clean transparent-style neutral field while the isolated subject remains sharp and unchanged. Show precise hair-edge extraction. No camera zoom, no identity change, no watermark.",
  },
  {
    skuId: "RH_HD_UPSCALE",
    coverFile: "hd-upscale.webp",
    prompt: "A high-resolution restoration scan travels across the image, changing soft low-detail regions into crisp texture, sharp edges, and refined highlights. The before-and-after improvement must be obvious while preserving all objects and composition. No scene cut, no watermark.",
  },
  {
    skuId: "RH_FACE_SWAP",
    coverFile: "face-swap.webp",
    prompt: "A precise facial alignment mesh activates between the portrait references, then the target face is naturally integrated while the body, clothing, pose, lighting, and background remain unchanged. Show a controlled professional face-compositing process, no grotesque morphing, no scene cut, no watermark.",
  },
  {
    skuId: "RH_TXT2IMG_SHORTDRAMA",
    coverFile: "text-to-image.webp",
    prompt: "Creative prompt energy flows from the input area and constructs a complete cinematic image layer by layer, first composition, then characters, lighting, color, and final detail. The visual should clearly demonstrate text-to-image creation without adding readable text. No random zoom, no watermark.",
  },
  {
    skuId: "RH_STORYBOARD",
    coverFile: "storyboard-generator.webp",
    prompt: "A storyboard production sequence comes alive panel by panel: framing guides activate, successive cinematic shots appear in order, and the highlighted panel advances across the story while character identity and art style remain consistent. No chaotic motion, no watermark.",
  },
  {
    skuId: "CHARACTER_TURNAROUND",
    coverFile: "character-turnaround.webp",
    prompt: "The same full-body character performs a controlled turntable presentation from front view to strict side profile and then toward the back view, maintaining identical face, outfit, proportions, neutral T-pose, centered framing, and studio lighting. No extra limbs, no identity drift, no scene cut, no watermark.",
  },
  {
    skuId: "BAILIAN_TRIPO_3D",
    coverFile: "tripo-3d.webp",
    prompt: "The pictured asset is reconstructed into a professional 3D model on a turntable. A wireframe and geometry pass briefly resolves into a fully textured PBR surface while the model rotates smoothly for inspection. Stable shape, studio lighting, no scene cut, no watermark.",
  },
  {
    skuId: "LOCAL_AUTO_SUBTITLES",
    coverFile: "auto-subtitles.webp",
    prompt: "The presenter speaks naturally with subtle mouth and hand movement while clean subtitle lines appear in precise timed segments along the lower safe area, synchronized to each phrase. Keep the editing timeline and speaker composition stable. No random camera motion, no watermark.",
  },
  {
    skuId: "LOCAL_AUDIO_EXTRACTION",
    coverFile: "video-audio-extraction.webp",
    prompt: "Demonstrate functional video-to-audio extraction: the video preview on the left plays with subtle natural presenter motion, its visible sound signal flows purposefully through the central extraction device, and the independent waveform on the right builds in synchronization before resolving into the audio file tile. Keep the left-to-right workflow and all object designs stable. No scene cut, no random zoom, no added text, no watermark.",
  },
  {
    skuId: "ONE_PROMPT_30S_VIDEO",
    coverFile: "animated-cover.webp",
    prompt: "A single creative idea expands into a complete production workflow: story beats organize into storyboard panels, approved keyframes come alive in sequence, and the shots assemble along a cinematic timeline into one finished video. Preserve the visual language and layout, no random zoom, no watermark.",
  },
  {
    skuId: "RH_VIDEO_ENHANCE",
    coverFile: "video-enhance.webp",
    prompt: "A professional restoration scanner passes across the low-quality video preview, progressively removing blur and compression artifacts while revealing crisp architecture, sharp reflections, clean edges, and fine texture. Make the before-and-after enhancement unmistakable while preserving the exact scene composition. No cut, no watermark.",
  },
  {
    skuId: "KLING_CINEMA_PRO",
    coverFile: "image-to-video.webp",
    prompt: "Transform the still cinematic scene into a coherent short video: the subject performs a natural purposeful action, environmental details move with realistic physics, and the camera executes a smooth restrained cinematic push with depth parallax. Preserve subject identity and design. No scene cut, no morphing, no watermark.",
  },
  {
    skuId: "KLING_STD_I2V",
    coverFile: "kling-standard.webp",
    prompt: "The futuristic motorcycle rider accelerates decisively through the luminous portal into the neon city. Wheels rotate, water spray reacts with realistic physics, light trails flow backward, and the camera tracks smoothly while preserving rider and motorcycle design. No scene cut, no morphing, no watermark.",
  },
  {
    skuId: "BAILIAN_WAN22_ANIMATE_MOVE",
    coverFile: "dance-motion-transfer.webp",
    prompt: "The featured dancer performs a fluid expressive choreography with clear full-body arm and leg motion, natural cloth response, accurate anatomy, and rhythmic movement while preserving the dancer's identity, costume, and stage. Stable camera, no scene cut, no watermark.",
  },
  {
    skuId: "BAILIAN_WAN27_CAMERA_REPLICATION",
    coverFile: "camera-movement-replication.webp",
    prompt: "Demonstrate professional camera movement replication: execute a smooth cinematic arc and dolly around the central subject with strong foreground-background parallax, consistent subject scale, and stable scene geometry. The motion path should be unmistakable. No subject morphing, no cut, no watermark.",
  },
  {
    skuId: "BAILIAN_WAN27_EFFECT_REPLICATION",
    coverFile: "effect-replication.webp",
    prompt: "A controlled cinematic energy effect is transferred onto the central character: luminous particles, electric arcs, and flowing fire wrap around the body and respond to the character's movement while identity and costume remain intact. No scene cut, no watermark.",
  },
  {
    skuId: "BAILIAN_WAN22_S2V",
    coverFile: "talking-character-video.webp",
    prompt: "The featured character delivers a short line naturally with convincing lip movement, facial expression, breathing, and subtle hand gesture. The surrounding audio waveform pulses in synchronization with the speech. Preserve identity and framing, no scene cut, no watermark.",
  },
  {
    skuId: "BAILIAN_VOICE_CLONE",
    coverFile: "voice-cloning.webp",
    prompt: "A speaker records a short voice sample into the studio microphone; the source waveform travels through a cloning interface and resolves into a matching second waveform that pulses with the same vocal character. Purposeful audio-production motion, stable composition, no watermark.",
  },
  {
    skuId: "BAILIAN_COSYVOICE_VOICE_DESIGN",
    coverFile: "voice-design-from-text.webp",
    prompt: "A voice-design interface turns descriptive creative signals into a new vocal identity: several colored waveform traits combine, reshape, and settle into one distinctive polished waveform beside the microphone. Smooth purposeful motion, no readable added text, no watermark.",
  },
  {
    skuId: "BAILIAN_EMOTIONAL_TTS",
    coverFile: "expressive-voiceover.webp",
    prompt: "The narrator performs an expressive voiceover, shifting naturally from calm to excited emotion through facial expression and gesture while the colored sound waveform changes intensity, rhythm, and shape in sync. Stable studio framing, no scene cut, no watermark.",
  },
  {
    skuId: "BAILIAN_HAPPYHORSE_VIDEO_EDIT",
    coverFile: "local-video-edit.webp",
    prompt: "A precise selection mask highlights one local element in the scene, then only that selected object changes color and appearance while the person, background, lighting, and every unselected region remain perfectly stable. Clear local video editing demonstration, no cut, no watermark.",
  },
  {
    skuId: "BAILIAN_SCENE_LIGHT_VIDEO_EDIT",
    coverFile: "scene-light-transform.webp",
    prompt: "The same fixed scene transforms continuously from warm golden daylight into a dramatic neon night environment; sky, practical lights, reflections, and atmosphere change while the subject and camera movement remain consistent. Smooth lighting transformation, no cut, no watermark.",
  },
  {
    skuId: "BAILIAN_OVERALL_STYLE_TRANSFER",
    coverFile: "overall-style-transfer.webp",
    prompt: "The entire moving scene undergoes a cohesive visual style transfer from photoreal cinematic imagery into a refined illustrated animation style, with the subject, action, framing, and geometry preserved throughout the transition. No identity drift, no cut, no watermark.",
  },
  {
    skuId: "BAILIAN_HIGH_DYNAMIC_REDRAW",
    coverFile: "high-motion-redraw.webp",
    prompt: "The action hero launches into a fast athletic movement through the environment with strong body motion, cloth response, speed trails, and dynamic redraw detail while anatomy and identity remain coherent. Energetic tracking camera, no scene cut, no watermark.",
  },
  {
    skuId: "BAILIAN_WANX_I2V",
    coverFile: "multimodal-image-to-video.webp",
    prompt: "Multiple visual reference streams converge around the central subject and fuse into one coherent moving cinematic shot. The final subject acts naturally while design, environment, and motion cues from the references remain visibly consistent. Smooth integration, no cut, no watermark.",
  },
  {
    skuId: "BAILIAN_WAN27_VIDEO_CONTINUATION",
    coverFile: "video-continuation.webp",
    prompt: "The existing scene continues naturally beyond its apparent endpoint: the subject keeps moving forward, the landscape reveals new space, and lighting and camera velocity remain perfectly continuous as the timeline extends. No restart, no abrupt cut, no watermark.",
  },
  {
    skuId: "BAILIAN_MULTI_REF_I2V",
    coverFile: "multi-reference-drama.webp",
    prompt: "The multiple referenced characters enter the same cinematic drama scene and interact through natural eye contact and restrained gestures. Preserve each character's distinct face, clothing, and role while maintaining coherent lighting and staging. No identity blending, no cut, no watermark.",
  },
  {
    skuId: "RH_SVD_IMG2VID",
    coverFile: "first-last-frame.webp",
    prompt: "Create a smooth first-to-last-frame transition: the scene travels continuously from the starting composition into the destination composition through coherent camera motion, changing light, and connected environmental movement. Both endpoints remain recognizable, no abrupt cut, no watermark.",
  },
];

const ROOT = process.cwd();
const WORK_DIR = path.join(ROOT, "artifacts", "workflow-motion-covers");
const RAW_DIR = path.join(WORK_DIR, "raw");
const STATE_PATH = path.join(WORK_DIR, "state.json");
const PUBLIC_COVERS_DIR = path.join(ROOT, "public", "covers");
const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 15 * 60_000;
const PROVIDER = "aliyun-bailian:happyhorse-1.1-i2v";
const ESTIMATED_CREDITS_PER_VIDEO = 750;

function outputName(coverFile: string): string {
  return coverFile.replace(/\.[^.]+$/, "-motion.mp4");
}

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadState(): Promise<Record<string, GenerationStateEntry>> {
  try {
    return JSON.parse(await readFile(STATE_PATH, "utf8")) as Record<string, GenerationStateEntry>;
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  if (!process.argv.includes("--confirm-billable")) {
    throw new Error("Refusing to submit paid jobs without --confirm-billable");
  }

  const { loadEnvConfig } = await import("@next/env");
  loadEnvConfig(ROOT, true);
  const [{ BailianAdapter }, { uploadMediaBufferToOss }] = await Promise.all([
    import("../src/services/providers/BailianAdapter"),
    import("../src/services/video-orchestrator/oss-media"),
  ]);

  await mkdir(RAW_DIR, { recursive: true });
  const state = await loadState();
  let saveChain = Promise.resolve();
  const saveState = async (): Promise<void> => {
    saveChain = saveChain.then(() => writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8"));
    await saveChain;
  };

  const only = parseArg("only")?.split(",").map((value) => value.trim()).filter(Boolean);
  const force = process.argv.includes("--force");
  const requestedConcurrency = Number(parseArg("concurrency") ?? "3");
  const concurrency = Math.max(1, Math.min(4, Number.isFinite(requestedConcurrency) ? Math.floor(requestedConcurrency) : 3));
  const targets = only?.length ? TARGETS.filter((target) => only.includes(target.skuId)) : TARGETS;
  const adapter = new BailianAdapter();
  const credentials = { skuId: "BAILIAN_WANX_I2V" };

  if (only?.length && targets.length !== only.length) {
    const found = new Set(targets.map((target) => target.skuId));
    throw new Error(`Unknown SKU IDs: ${only.filter((skuId) => !found.has(skuId)).join(", ")}`);
  }

  console.log(`[motion-covers] provider=${PROVIDER} targets=${targets.length} concurrency=${concurrency} estimatedCredits=${targets.length * ESTIMATED_CREDITS_PER_VIDEO}`);

  const processTarget = async (target: MotionCoverTarget): Promise<void> => {
    const sourcePath = path.join(PUBLIC_COVERS_DIR, target.coverFile);
    const finalPath = path.join(PUBLIC_COVERS_DIR, outputName(target.coverFile));
    const rawPath = path.join(RAW_DIR, `${target.skuId}.mp4`);
    const entry = state[target.skuId] ?? {};
    state[target.skuId] = entry;
    if (entry.provider && entry.provider !== PROVIDER) {
      entry.taskId = undefined;
      entry.resultUrl = undefined;
      entry.status = undefined;
      entry.error = undefined;
    }
    entry.provider = PROVIDER;

    if (!force) {
      try {
        const existing = await readFile(finalPath);
        if (existing.byteLength > 10_000) {
          console.log(`[motion-covers] skip existing ${target.skuId}`);
          return;
        }
      } catch {
        // Generate missing output.
      }
    }

    try {
      if (!entry.imageUrl) {
        const source = await readFile(sourcePath);
        const digest = createHash("sha256").update(source).digest("hex").slice(0, 16);
        entry.imageUrl = await uploadMediaBufferToOss({
          key: `workflow-motion-cover-sources/${path.basename(target.coverFile, path.extname(target.coverFile))}-${digest}.webp`,
          body: source,
          contentType: "image/webp",
        });
        entry.updatedAt = new Date().toISOString();
        await saveState();
      }

      if (!entry.taskId || entry.status === "failed") {
        const submitted = await adapter.generate({
          templateId: `motion-cover:${target.skuId}`,
          nodeInputs: {
            input: {
              modelName: "happyhorse-1.1-i2v",
              image_url: entry.imageUrl,
              prompt: target.prompt,
              duration: 5,
              resolution: "720P",
              ratio: "16:9",
            },
          },
          inputs: { duration: 5 },
          flags: {
            imageUrl: entry.imageUrl,
            prompt: target.prompt,
            duration: 5,
            modelName: "happyhorse-1.1-i2v",
            resolution: "720P",
            ratio: "16:9",
            watermark: false,
          },
        }, credentials);
        entry.taskId = submitted.taskId;
        entry.status = "submitted";
        entry.error = undefined;
        entry.updatedAt = new Date().toISOString();
        await saveState();
        console.log(`[motion-covers] submitted ${target.skuId} task=${entry.taskId}`);
      } else {
        console.log(`[motion-covers] resume ${target.skuId} task=${entry.taskId}`);
      }

      if (!entry.resultUrl) {
        const deadline = Date.now() + POLL_TIMEOUT_MS;
        while (Date.now() < deadline) {
          const result = await adapter.queryTask(entry.taskId, credentials);
          if (result.status === "succeeded" && result.resultUrl) {
            entry.resultUrl = result.resultUrl;
            entry.status = "succeeded";
            entry.updatedAt = new Date().toISOString();
            await saveState();
            break;
          }
          if (result.status === "failed") {
            throw new Error(result.errorMessage || "Alibaba Model Studio generation failed");
          }
          await sleep(POLL_INTERVAL_MS);
        }
      }

      if (!entry.resultUrl) throw new Error("Timed out waiting for Alibaba Model Studio result");
      const response = await fetch(entry.resultUrl);
      if (!response.ok) throw new Error(`Failed to download result HTTP ${response.status}`);
      await writeFile(rawPath, Buffer.from(await response.arrayBuffer()));

      const transcoded = spawnSync("ffmpeg", [
        "-y",
        "-i", rawPath,
        "-t", "5",
        "-vf", "scale=960:540:flags=lanczos,fps=24",
        "-an",
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "26",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        finalPath,
      ], { encoding: "utf8" });
      if (transcoded.status !== 0) {
        throw new Error(`ffmpeg failed: ${transcoded.stderr.slice(-800)}`);
      }
      console.log(`[motion-covers] completed ${target.skuId} -> ${path.basename(finalPath)}`);
    } catch (error) {
      entry.status = "failed";
      entry.error = error instanceof Error ? error.message : String(error);
      entry.updatedAt = new Date().toISOString();
      await saveState();
      console.error(`[motion-covers] failed ${target.skuId}: ${entry.error}`);
      throw error;
    }
  };

  let cursor = 0;
  const failures: string[] = [];
  const workers = Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
    while (cursor < targets.length) {
      const target = targets[cursor++];
      try {
        await processTarget(target);
      } catch {
        failures.push(target.skuId);
      }
    }
  });
  await Promise.all(workers);
  await saveChain;

  if (failures.length) {
    throw new Error(`Motion cover generation failed for: ${failures.join(", ")}`);
  }
  console.log(`[motion-covers] all ${targets.length} targets completed`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
