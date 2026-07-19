"use client";

import { useEffect, useRef, useState } from "react";
import type { Texture } from "pixi.js";
import type { Arena, Terrain } from "../engine/types";
import { ARENA_ASSET_URLS, highResSvg, TERRAIN_ASSETS } from "./assets";

const TILE_SIZE = 20;

export interface PixiArenaProps {
  readonly arena: Arena;
}

export function PixiArena({ arena }: PixiArenaProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let disposed = false;
    let destroyApplication: (() => void) | undefined;

    const renderArena = async () => {
      const { Application, Assets, Sprite } = await import("pixi.js");
      if (disposed) return;

      const app = new Application();
      await app.init({
        width: arena.width * TILE_SIZE,
        height: arena.height * TILE_SIZE,
        antialias: true,
        autoDensity: true,
        autoStart: false,
        background: "#151816",
        preference: "webgl",
        preserveDrawingBuffer: true,
        resolution: Math.min(window.devicePixelRatio, 2),
      });
      if (disposed) {
        app.destroy(true);
        return;
      }

      destroyApplication = () => app.destroy(true);
      const canvas = app.canvas as HTMLCanvasElement;
      canvas.dataset.arenaCanvas = arena.sizeName;
      canvas.setAttribute("aria-label", `${arena.sizeName} terrain preview`);
      canvas.setAttribute("role", "img");
      hostRef.current?.appendChild(canvas);

      let loaded = 0;
      const textureEntries = await Promise.all(
        ARENA_ASSET_URLS.map(async (url) => {
          const texture = await Assets.load<Texture>(highResSvg(url));
          loaded += 1;
          if (!disposed) setProgress(Math.round((loaded / ARENA_ASSET_URLS.length) * 100));
          return [url, texture] as const;
        }),
      );
      if (disposed) return;

      const textures = new Map(textureEntries);
      for (let y = 0; y < arena.height; y += 1) {
        const row = arena.tiles[y];
        if (row === undefined) continue;
        for (let x = 0; x < arena.width; x += 1) {
          const terrain = row[x]?.terrain;
          if (terrain === undefined) continue;
          const texture = textures.get(TERRAIN_ASSETS[terrain as Terrain]);
          if (texture === undefined) continue;
          const sprite = new Sprite(texture);
          sprite.position.set(x * TILE_SIZE, y * TILE_SIZE);
          sprite.width = TILE_SIZE;
          sprite.height = TILE_SIZE;
          app.stage.addChild(sprite);
        }
      }
      app.render();
      setStatus("ready");
    };

    void renderArena().catch((error: unknown) => {
      if (!disposed) {
        setStatus("error");
        console.error(`Could not render ${arena.sizeName}.`, error);
      }
    });

    return () => {
      disposed = true;
      destroyApplication?.();
    };
  }, [arena]);

  return (
    <div
      className="relative overflow-hidden rounded-[18px] border border-white/10 bg-[#151816] shadow-[0_24px_70px_rgba(0,0,0,0.35)]"
      data-pixi-arena={arena.sizeName}
      data-ready={status === "ready" ? "true" : "false"}
      style={{ width: arena.width * TILE_SIZE, height: arena.height * TILE_SIZE }}
    >
      <div ref={hostRef} className="absolute inset-0" />
      {status !== "ready" ? (
        <div
          className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_center,#26322b_0%,#151816_68%)] p-8"
          role="status"
          aria-live="polite"
        >
          <div className="w-64 text-center">
            <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl border border-emerald-300/20 bg-emerald-300/10 text-xl font-black tracking-[-0.08em] text-emerald-200">
              RA
            </div>
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-white/70">
              {status === "error" ? "Renderer unavailable" : "Loading terrain"}
            </p>
            <div
              className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10"
              role={status === "loading" ? "progressbar" : undefined}
              aria-label={status === "loading" ? "Terrain loading progress" : undefined}
              aria-valuemin={status === "loading" ? 0 : undefined}
              aria-valuemax={status === "loading" ? 100 : undefined}
              aria-valuenow={status === "loading" ? progress : undefined}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-lime-300 transition-[width] duration-200 motion-reduce:transition-none"
                style={{ width: `${status === "error" ? 100 : progress}%` }}
              />
            </div>
            <p className="mt-2 font-mono text-[11px] text-white/40">
              {status === "error" ? "Check WebGL support" : `${progress}% cached`}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
