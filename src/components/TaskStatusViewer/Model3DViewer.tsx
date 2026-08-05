"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Material, Object3D, Texture } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { useT } from "@/i18n";

type ViewerStatus = "loading" | "ready" | "error";

export interface Model3DViewerProps {
  src: string;
  posterUrl?: string;
}

function buildModelProxyUrl(src: string): string {
  return `/api/download-external-image?mediaKind=model&url=${encodeURIComponent(src)}`;
}

function disposeObject(root: Object3D): void {
  const disposedTextures = new Set<Texture>();
  const disposeMaterial = (material: Material) => {
    for (const value of Object.values(material)) {
      if (value && typeof value === "object" && "isTexture" in value && (value as Texture).isTexture) {
        const texture = value as Texture;
        if (!disposedTextures.has(texture)) {
          disposedTextures.add(texture);
          texture.dispose();
        }
      }
    }
    material.dispose();
  };

  root.traverse((object) => {
    const renderable = object as Object3D & {
      geometry?: { dispose: () => void };
      material?: Material | Material[];
    };
    renderable.geometry?.dispose();
    if (Array.isArray(renderable.material)) renderable.material.forEach(disposeMaterial);
    else if (renderable.material) disposeMaterial(renderable.material);
  });
}

export function Model3DViewer({ src, posterUrl }: Model3DViewerProps) {
  const t = useT();
  const mountRef = useRef<HTMLDivElement>(null);
  const resetViewRef = useRef<() => void>(() => undefined);
  const keyboardControlRef = useRef<(event: ReactKeyboardEvent<HTMLDivElement>) => void>(() => undefined);
  const [status, setStatus] = useState<ViewerStatus>("loading");
  const [progress, setProgress] = useState<number | null>(null);
  const [errorDetail, setErrorDetail] = useState("");
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;
    let cleanup = () => undefined;
    setStatus("loading");
    setProgress(null);
    setErrorDetail("");

    const initialize = async () => {
      try {
        const [THREE, { GLTFLoader }, { OrbitControls }, { RoomEnvironment }] = await Promise.all([
          import("three"),
          import("three/examples/jsm/loaders/GLTFLoader.js"),
          import("three/examples/jsm/controls/OrbitControls.js"),
          import("three/examples/jsm/environments/RoomEnvironment.js"),
        ]);
        if (disposed) return;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 10_000);
        const renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
        });
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.domElement.className = "block h-full w-full touch-none outline-none";
        renderer.domElement.setAttribute("aria-hidden", "true");
        mount.replaceChildren(renderer.domElement);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.07;
        controls.enablePan = true;
        controls.screenSpacePanning = true;
        controls.zoomToCursor = true;
        controls.maxPolarAngle = Math.PI * 0.98;

        scene.add(new THREE.HemisphereLight(0xdbeafe, 0x24153f, 2.4));
        const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
        keyLight.position.set(4, 7, 6);
        scene.add(keyLight);
        const fillLight = new THREE.DirectionalLight(0x8be9fd, 1.5);
        fillLight.position.set(-5, 2, 3);
        scene.add(fillLight);
        const rimLight = new THREE.DirectionalLight(0xc4b5fd, 2.1);
        rimLight.position.set(2, 3, -5);
        scene.add(rimLight);

        const pmrem = new THREE.PMREMGenerator(renderer);
        const environmentTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
        scene.environment = environmentTarget.texture;
        pmrem.dispose();
        const cleanupCallbacks: Array<() => void> = [];
        cleanupCallbacks.push(() => {
          controls.dispose();
          environmentTarget.dispose();
          renderer.dispose();
          renderer.forceContextLoss();
          renderer.domElement.remove();
        });
        cleanup = () => {
          while (cleanupCallbacks.length > 0) cleanupCallbacks.pop()?.();
        };

        const loader = new GLTFLoader();
        const load = (url: string) => new Promise<GLTF>((resolve, reject) => {
          loader.load(
            url,
            resolve,
            (event) => {
              if (disposed) return;
              setProgress(event.total > 0 ? Math.min(99, Math.round((event.loaded / event.total) * 100)) : null);
            },
            reject,
          );
        });

        let gltf: GLTF;
        try {
          gltf = await load(src);
        } catch (directError) {
          if (disposed) return;
          setProgress(null);
          console.warn("[Model3DViewer] 直连模型失败，改用同源代理", directError);
          gltf = await load(buildModelProxyUrl(src));
        }
        if (disposed) {
          disposeObject(gltf.scene);
          cleanup();
          return;
        }

        const modelRoot = gltf.scene;
        cleanupCallbacks.push(() => {
          scene.remove(modelRoot);
          disposeObject(modelRoot);
        });
        const bounds = new THREE.Box3().setFromObject(modelRoot);
        if (bounds.isEmpty()) throw new Error("GLB scene has no visible geometry");
        const center = bounds.getCenter(new THREE.Vector3());
        const sphere = bounds.getBoundingSphere(new THREE.Sphere());
        modelRoot.position.sub(center);
        scene.add(modelRoot);

        const radius = Math.max(sphere.radius, 0.01);
        const fitView = () => {
          const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
          const distance = (radius / Math.sin(halfFov)) * 1.15;
          camera.near = Math.max(distance / 1000, 0.001);
          camera.far = Math.max(distance * 100, 100);
          camera.position.set(distance * 0.78, distance * 0.48, distance * 0.98);
          camera.updateProjectionMatrix();
          controls.target.set(0, 0, 0);
          controls.minDistance = radius * 0.3;
          controls.maxDistance = radius * 12;
          controls.update();
        };
        fitView();
        resetViewRef.current = fitView;

        keyboardControlRef.current = (event) => {
          const supported = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-", "_", "r", "R"];
          if (!supported.includes(event.key)) return;
          event.preventDefault();
          if (event.key.toLowerCase() === "r") {
            fitView();
            return;
          }
          const offset = camera.position.clone().sub(controls.target);
          const spherical = new THREE.Spherical().setFromVector3(offset);
          if (event.key === "ArrowLeft") spherical.theta -= 0.12;
          if (event.key === "ArrowRight") spherical.theta += 0.12;
          if (event.key === "ArrowUp") spherical.phi = Math.max(0.08, spherical.phi - 0.1);
          if (event.key === "ArrowDown") spherical.phi = Math.min(Math.PI - 0.08, spherical.phi + 0.1);
          if (event.key === "+" || event.key === "=") spherical.radius = Math.max(controls.minDistance, spherical.radius * 0.88);
          if (event.key === "-" || event.key === "_") spherical.radius = Math.min(controls.maxDistance, spherical.radius * 1.12);
          camera.position.setFromSpherical(spherical).add(controls.target);
          camera.lookAt(controls.target);
          controls.update();
        };

        const mixer = gltf.animations.length > 0 ? new THREE.AnimationMixer(modelRoot) : null;
        if (mixer && gltf.animations[0]) mixer.clipAction(gltf.animations[0]).play();
        if (mixer) cleanupCallbacks.push(() => mixer.stopAllAction());
        const clock = new THREE.Clock();
        let animationFrame = 0;

        const resize = () => {
          const width = Math.max(1, mount.clientWidth);
          const height = Math.max(1, mount.clientHeight);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          renderer.setSize(width, height, false);
        };
        resize();
        const resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(mount);
        cleanupCallbacks.push(() => resizeObserver.disconnect());

        const render = () => {
          if (disposed) return;
          animationFrame = window.requestAnimationFrame(render);
          mixer?.update(clock.getDelta());
          controls.update();
          renderer.render(scene, camera);
        };
        render();
        cleanupCallbacks.push(() => window.cancelAnimationFrame(animationFrame));
        setProgress(100);
        setStatus("ready");
      } catch (error) {
        if (disposed) return;
        console.error("[Model3DViewer] 模型预览加载失败", error);
        cleanup();
        cleanup = () => undefined;
        mount.replaceChildren();
        setErrorDetail(error instanceof Error ? error.message : String(error));
        setStatus("error");
      }
    };

    void initialize();
    return () => {
      disposed = true;
      resetViewRef.current = () => undefined;
      keyboardControlRef.current = () => undefined;
      cleanup();
    };
  }, [retryToken, src]);

  return (
    <div
      className="group/model relative h-full min-h-72 w-full overflow-hidden rounded-lg bg-[#050a12] focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/80"
      role="application"
      tabIndex={0}
      aria-label={t.modelPreviewAriaLabel}
      onKeyDown={(event) => keyboardControlRef.current(event)}
    >
      {posterUrl && status === "loading" && (
        // eslint-disable-next-line @next/next/no-img-element -- 百炼临时渲染预览作为 3D 加载占位
        <img
          src={posterUrl}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-contain opacity-25 blur-[2px]"
        />
      )}
      <div ref={mountRef} className="absolute inset-0 z-10" />

      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[#050a12]/55 text-center backdrop-blur-sm">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-violet-300/25 border-t-violet-300 motion-reduce:animate-none" />
          <p className="text-sm font-medium text-slate-200">{t.modelPreviewLoading}</p>
          <p className="text-xs tabular-nums text-slate-400">
            {progress == null ? t.modelPreviewPreparing : `${progress}%`}
          </p>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[#050a12]/90 px-6 text-center">
          <AlertTriangle className="h-9 w-9 text-amber-300" strokeWidth={1.5} aria-hidden />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-slate-100">{t.modelPreviewError}</p>
            <p className="max-w-sm text-xs leading-relaxed text-slate-400">{t.modelPreviewErrorHint}</p>
          </div>
          <button
            type="button"
            onClick={() => setRetryToken((value) => value + 1)}
            className="mt-1 inline-flex min-h-11 items-center rounded-xl border border-amber-300/30 bg-amber-300/10 px-4 text-sm font-medium text-amber-200 transition-colors hover:bg-amber-300/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60"
            title={errorDetail}
          >
            {t.modelPreviewRetry}
          </button>
        </div>
      )}

      {status === "ready" && (
        <>
          <button
            type="button"
            onClick={() => resetViewRef.current()}
            className="absolute right-3 top-3 z-20 inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/45 px-3 text-xs font-medium text-slate-200 opacity-80 backdrop-blur-md transition-colors hover:bg-black/65 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/70 sm:opacity-0 sm:group-hover/model:opacity-100 sm:group-focus-within/model:opacity-100"
            aria-label={t.modelPreviewReset}
          >
            <RotateCcw className="h-4 w-4" strokeWidth={1.8} aria-hidden />
            <span className="hidden sm:inline">{t.modelPreviewReset}</span>
          </button>
          <p className="pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-full border border-white/10 bg-black/45 px-3 py-1.5 text-center text-[11px] text-slate-300/90 backdrop-blur-md">
            {t.modelPreviewHint}
          </p>
        </>
      )}
    </div>
  );
}
