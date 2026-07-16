/**
 * Generates the production robot sprite set from the locked "Foundry Plate"
 * art direction (see public/assets/robots/art-directions/*-c-foundry-plate.svg
 * and the 2026-07-08 art-direction session).
 *
 * Emits, per class (rifle, burst, auto, missile, stealth):
 *   public/assets/robots/<class>/body-upright.svg
 *   public/assets/robots/<class>/body-ducking.svg
 *   public/assets/robots/<class>/body-crouching.svg   (spec.md §Postures: 3 postures ship in v1)
 *   public/assets/robots/<class>/turret.svg
 *
 * Rig contract:
 *  - Body files: viewBox 0 0 128 128; layers shadow → legs → body (NO team
 *    ring — the ring is a selection indicator, shipped as
 *    public/assets/markers/selection-ring.svg). Ground anchor (64,93),
 *    shadow center (64,101). Each file stamps `data-turret-pivot` — the
 *    turret mount point for THAT posture (the hull drops as it hunkers).
 *  - Turret files: viewBox 0 0 96 96, pivot at the exact center (48,48) so a
 *    Pixi sprite with anchor 0.5 rotates correctly. The 1.18× readability
 *    scale from the art-direction session is BAKED IN here (data-scale-baked).
 *  - Legs are the shared quadruped chassis; class identity = turret + hull
 *    plate (double-coded per the locked 2026-07-08 decision). Postures reuse
 *    one leg rig via fold transforms so all five classes stay in sync.
 *  - Team color: recolor the `.team-paint` / `.team-paint-accent` /
 *    `.team-paint-edge` hooks in the SVG source before rasterizing.
 *
 * Run: node scripts/generate-robot-assets.mjs
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "assets", "robots");

/** Shared gradient defs. Uniform `fp-` ids: files inlined into one document
 *  collide only with identical copies of themselves, which is harmless. */
const DEFS = `  <defs>
    <linearGradient id="fp-steel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#dfe5ea"/>
      <stop offset="40%" stop-color="#a9b2bc"/>
      <stop offset="75%" stop-color="#6a7480"/>
      <stop offset="100%" stop-color="#454d58"/>
    </linearGradient>
    <linearGradient id="fp-iron" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#8b95a1"/>
      <stop offset="55%" stop-color="#3a414b"/>
      <stop offset="100%" stop-color="#22272f"/>
    </linearGradient>
    <linearGradient id="fp-paint" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#d8453a"/>
      <stop offset="55%" stop-color="#a3241f"/>
      <stop offset="100%" stop-color="#5f1213"/>
    </linearGradient>
    <linearGradient id="fp-gun" x1="72" y1="0" x2="82" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#39404a"/>
      <stop offset="45%" stop-color="#9aa5b1"/>
      <stop offset="58%" stop-color="#c7d0d8"/>
      <stop offset="100%" stop-color="#2c323b"/>
    </linearGradient>
    <radialGradient id="fp-pod" cx="50%" cy="42%" r="70%">
      <stop offset="0%" stop-color="#cfd6dd"/>
      <stop offset="60%" stop-color="#7e8894"/>
      <stop offset="100%" stop-color="#3a414b"/>
    </radialGradient>
  </defs>`;

const SHADOW = `  <ellipse class="shadow" cx="64" cy="101" rx="45" ry="11.5" fill="#0a0d12" opacity="0.25"/>`;

/** Shared quadruped chassis, upright pose (audited geometry from the
 *  art-direction composites — byte-identical across all five class files). */
const LEGS = `    <g class="leg rear-left">
      <polygon points="47,59.5 47,66.5 29,67.6 29,62.4" fill="url(#fp-steel)" stroke="#22272f" stroke-width="1"/>
      <path d="M44 61.5 32 63" stroke="#eef2f5" stroke-width="1" opacity="0.6"/>
      <polygon points="31,63.5 26.5,65.5 19,84 23,86 " fill="url(#fp-iron)" stroke="#181d24" stroke-width="1"/>
      <path d="M27.5 68 22 82" stroke="#b9c2cb" stroke-width="1.4" opacity="0.9"/>
      <circle cx="29" cy="65" r="4" fill="url(#fp-steel)" stroke="#22272f" stroke-width="1"/>
      <circle cx="29" cy="65" r="1.4" fill="#22272f"/>
      <polygon points="24,84 13.5,86.5 16,90.5 26,89.5" fill="url(#fp-iron)" stroke="#14181e" stroke-width="1"/>
      <path d="M19.5 86 20.5 89.8" stroke="#0f1318" stroke-width="1.1"/>
    </g>
    <g class="leg rear-right">
      <polygon points="81,59.5 81,66.5 99,67.6 99,62.4" fill="url(#fp-steel)" stroke="#22272f" stroke-width="1"/>
      <path d="M84 61.5 96 63" stroke="#eef2f5" stroke-width="1" opacity="0.6"/>
      <polygon points="97,63.5 101.5,65.5 109,84 105,86" fill="url(#fp-iron)" stroke="#181d24" stroke-width="1"/>
      <path d="M100.5 68 106 82" stroke="#b9c2cb" stroke-width="1.4" opacity="0.9"/>
      <circle cx="99" cy="65" r="4" fill="url(#fp-steel)" stroke="#22272f" stroke-width="1"/>
      <circle cx="99" cy="65" r="1.4" fill="#22272f"/>
      <polygon points="104,84 114.5,86.5 112,90.5 102,89.5" fill="url(#fp-iron)" stroke="#14181e" stroke-width="1"/>
      <path d="M108.5 86 107.5 89.8" stroke="#0f1318" stroke-width="1.1"/>
    </g>
    <g class="leg front-left">
      <polygon points="51,80.5 48,87.5 33,98 31.5,93" fill="url(#fp-steel)" stroke="#22272f" stroke-width="1"/>
      <path d="M48 84 36 93.5" stroke="#eef2f5" stroke-width="1" opacity="0.6"/>
      <polygon points="38,94 32.5,95.5 26.5,107.5 31,109" fill="url(#fp-iron)" stroke="#181d24" stroke-width="1"/>
      <path d="M33.5 98.5 29.5 106.5" stroke="#b9c2cb" stroke-width="1.4" opacity="0.9"/>
      <circle cx="36" cy="96" r="4.3" fill="url(#fp-steel)" stroke="#22272f" stroke-width="1"/>
      <circle cx="36" cy="96" r="1.5" fill="#22272f"/>
      <polygon points="32,106.5 20.5,110 24,114.5 34.5,112" fill="url(#fp-iron)" stroke="#14181e" stroke-width="1"/>
      <path d="M27 109.5 28.5 113.5" stroke="#0f1318" stroke-width="1.1"/>
    </g>
    <g class="leg front-right">
      <polygon points="77,80.5 80,87.5 95,98 96.5,93" fill="url(#fp-steel)" stroke="#22272f" stroke-width="1"/>
      <path d="M80 84 92 93.5" stroke="#eef2f5" stroke-width="1" opacity="0.6"/>
      <polygon points="90,94 95.5,95.5 101.5,107.5 97,109" fill="url(#fp-iron)" stroke="#181d24" stroke-width="1"/>
      <path d="M94.5 98.5 98.5 106.5" stroke="#b9c2cb" stroke-width="1.4" opacity="0.9"/>
      <circle cx="92" cy="96" r="4.3" fill="url(#fp-steel)" stroke="#22272f" stroke-width="1"/>
      <circle cx="92" cy="96" r="1.5" fill="#22272f"/>
      <polygon points="96,106.5 107.5,110 104,114.5 93.5,112" fill="url(#fp-iron)" stroke="#14181e" stroke-width="1"/>
      <path d="M101 109.5 99.5 113.5" stroke="#0f1318" stroke-width="1.1"/>
    </g>`;

/** Hull interiors per class (drawn in rifle hull space; class transform bakes
 *  the silhouette variant around the ground anchor (64,93)). */
const HULLS = {
  rifle: {
    transform: "",
    body: `    <ellipse cx="64" cy="92" rx="17" ry="6" fill="#14181e"/>
    <path d="M38 73 Q39 58 46 54 Q54 48.5 64 48.5 Q74 48.5 82 54 Q89 58 90 73 Q89 83 80 89.5 Q72 94.5 64 94.5 Q56 94.5 48 89.5 Q39 83 38 73 Z"
          fill="url(#fp-steel)" stroke="#1c2127" stroke-width="1.4"/>
    <path class="team-paint" d="M64 53 L80 60 L84 72 L76 86 L64 90 L52 86 L44 72 L48 60 Z" fill="url(#fp-paint)" stroke="#4a0f10" stroke-width="1"/>
    <path class="team-paint-edge" d="M49 60.5 L64 54 L79 60.5" fill="none" stroke="#ff9d8c" stroke-width="1" opacity="0.55"/>
    <path d="M48 60 L42 56.5 M80 60 L86 56.5 M84 72 L90 72 M44 72 L38 72 M76 86 L80 90 M52 86 L48 90" stroke="#262c34" stroke-width="1" opacity="0.85"/>
    <circle cx="64" cy="57" r="1.1" fill="#e3e9ee" stroke="#333a42" stroke-width="0.5"/>
    <circle cx="80" cy="61.5" r="1.1" fill="#e3e9ee" stroke="#333a42" stroke-width="0.5"/>
    <circle cx="48" cy="61.5" r="1.1" fill="#e3e9ee" stroke="#333a42" stroke-width="0.5"/>
    <circle cx="82.5" cy="71.5" r="1.1" fill="#e3e9ee" stroke="#333a42" stroke-width="0.5"/>
    <circle cx="45.5" cy="71.5" r="1.1" fill="#e3e9ee" stroke="#333a42" stroke-width="0.5"/>
    <circle cx="64" cy="87.5" r="1.1" fill="#e3e9ee" stroke="#333a42" stroke-width="0.5"/>
    <rect x="41" y="63.5" width="5" height="1.7" rx="0.8" transform="rotate(18 43.5 64.3)" fill="#14181e"/>
    <rect x="42" y="67.5" width="5" height="1.7" rx="0.8" transform="rotate(18 44.5 68.3)" fill="#14181e"/>
    <rect x="60" y="43" width="8" height="12" rx="2" fill="url(#fp-iron)" stroke="#14181e" stroke-width="1"/>
    <path d="M60.5 47 h7 M60.5 50 h7" stroke="#0f1318" stroke-width="1" opacity="0.8"/>`,
  },
  burst: {
    transform: "translate(64 93) scale(0.87) translate(-64 -93)",
    body: `    <ellipse cx="64" cy="92" rx="17" ry="6" fill="#14181e"/>
    <path d="M38 73 Q39 58 46 54 Q54 48.5 64 48.5 Q74 48.5 82 54 Q89 58 90 73 Q89 83 80 89.5 Q72 94.5 64 94.5 Q56 94.5 48 89.5 Q39 83 38 73 Z"
          fill="url(#fp-steel)" stroke="#1c2127" stroke-width="1.4"/>
    <path class="team-paint" d="M64 55 L82 63 L82 77 L64 88 L46 77 L46 63 Z" fill="url(#fp-paint)" stroke="#4a0f10" stroke-width="1"/>
    <path class="team-paint-edge" d="M50 62.5 L64 55.5 L78 62.5" fill="none" stroke="#ff9d8c" stroke-width="1" opacity="0.55"/>
    <path d="M46 63 L40 59.5 M82 63 L88 59.5 M82 77 L88 80 M46 77 L40 80" stroke="#262c34" stroke-width="1" opacity="0.85"/>
    <circle cx="64" cy="57.5" r="1.1" fill="#e3e9ee" stroke="#333a42" stroke-width="0.5"/>
    <circle cx="80" cy="63.5" r="1.1" fill="#e3e9ee" stroke="#333a42" stroke-width="0.5"/>
    <circle cx="48" cy="63.5" r="1.1" fill="#e3e9ee" stroke="#333a42" stroke-width="0.5"/>
    <circle cx="80" cy="76.5" r="1.1" fill="#e3e9ee" stroke="#333a42" stroke-width="0.5"/>
    <circle cx="48" cy="76.5" r="1.1" fill="#e3e9ee" stroke="#333a42" stroke-width="0.5"/>
    <circle cx="64" cy="85.5" r="1.1" fill="#e3e9ee" stroke="#333a42" stroke-width="0.5"/>
    <rect x="41" y="63.5" width="5" height="1.7" rx="0.8" transform="rotate(18 43.5 64.3)" fill="#14181e"/>
    <rect x="42" y="67.5" width="5" height="1.7" rx="0.8" transform="rotate(18 44.5 68.3)" fill="#14181e"/>
    <rect x="60" y="43" width="8" height="12" rx="2" fill="url(#fp-iron)" stroke="#14181e" stroke-width="1"/>
    <path d="M60.5 47 h7 M60.5 50 h7" stroke="#0f1318" stroke-width="1" opacity="0.8"/>`,
  },
  auto: {
    transform: "translate(64 93) scale(1.13 0.94) translate(-64 -93)",
    body: `    <ellipse cx="64" cy="92" rx="17" ry="6" fill="#14181e"/>
    <path d="M38 73 Q39 58 46 54 Q54 48.5 64 48.5 Q74 48.5 82 54 Q89 58 90 73 Q89 83 80 89.5 Q72 94.5 64 94.5 Q56 94.5 48 89.5 Q39 83 38 73 Z"
          fill="url(#fp-steel)" stroke="#1c2127" stroke-width="1.4"/>
    <path class="team-paint" d="M64 55 L84 61 L88 72 L80 85 L64 89 L48 85 L40 72 L44 61 Z" fill="url(#fp-paint)" stroke="#4a0f10" stroke-width="1"/>
    <path class="team-paint-edge" d="M46 61.5 L64 55.5 L82 61.5" fill="none" stroke="#ff9d8c" stroke-width="1" opacity="0.55"/>
    <rect x="50" y="69.5" width="28" height="3.2" fill="#14181e" opacity="0.4"/>
    <path d="M44 61 L39.5 58 M84 61 L88.5 58 M88 72 L89.5 72 M40 72 L38.5 72 M80 85 L83 88.5 M48 85 L45 88.5" stroke="#262c34" stroke-width="1" opacity="0.85"/>
    <circle cx="64" cy="57" r="1.1" fill="#e3e9ee" stroke="#333a42" stroke-width="0.5"/>
    <circle cx="80" cy="61.5" r="1.1" fill="#e3e9ee" stroke="#333a42" stroke-width="0.5"/>
    <circle cx="48" cy="61.5" r="1.1" fill="#e3e9ee" stroke="#333a42" stroke-width="0.5"/>
    <circle cx="82.5" cy="71.5" r="1.1" fill="#e3e9ee" stroke="#333a42" stroke-width="0.5"/>
    <circle cx="45.5" cy="71.5" r="1.1" fill="#e3e9ee" stroke="#333a42" stroke-width="0.5"/>
    <circle cx="64" cy="87.5" r="1.1" fill="#e3e9ee" stroke="#333a42" stroke-width="0.5"/>
    <rect x="41" y="63.5" width="5" height="1.7" rx="0.8" transform="rotate(18 43.5 64.3)" fill="#14181e"/>
    <rect x="42" y="67.5" width="5" height="1.7" rx="0.8" transform="rotate(18 44.5 68.3)" fill="#14181e"/>
    <rect x="60" y="43" width="8" height="12" rx="2" fill="url(#fp-iron)" stroke="#14181e" stroke-width="1"/>
    <path d="M60.5 47 h7 M60.5 50 h7" stroke="#0f1318" stroke-width="1" opacity="0.8"/>`,
  },
  missile: {
    transform: "",
    body: `    <ellipse cx="64" cy="92" rx="17" ry="6" fill="#14181e"/>
    <path d="M38 73 Q39 58 46 54 Q54 48.5 64 48.5 Q74 48.5 82 54 Q89 58 90 73 Q89 83 80 89.5 Q72 94.5 64 94.5 Q56 94.5 48 89.5 Q39 83 38 73 Z"
          fill="url(#fp-steel)" stroke="#1c2127" stroke-width="1.4"/>
    <path class="team-paint" d="M64 53 L82 60 L84 74 L76 87 L52 87 L44 74 L46 60 Z" fill="url(#fp-paint)" stroke="#4a0f10" stroke-width="1"/>
    <path class="team-paint-edge" d="M48 60.5 L64 54 L80 60.5" fill="none" stroke="#ff9d8c" stroke-width="1" opacity="0.55"/>
    <path d="M46 60 L42 56.5 M82 60 L86 56.5 M84 74 L90 74 M44 74 L38 74 M76 87 L80 90.5 M52 87 L48 90.5" stroke="#262c34" stroke-width="1" opacity="0.85"/>
    <circle cx="64" cy="57" r="1.1" fill="#e3e9ee" stroke="#333a42" stroke-width="0.5"/>
    <circle cx="80" cy="61.5" r="1.1" fill="#e3e9ee" stroke="#333a42" stroke-width="0.5"/>
    <circle cx="48" cy="61.5" r="1.1" fill="#e3e9ee" stroke="#333a42" stroke-width="0.5"/>
    <circle cx="82.5" cy="73.5" r="1.1" fill="#e3e9ee" stroke="#333a42" stroke-width="0.5"/>
    <circle cx="45.5" cy="73.5" r="1.1" fill="#e3e9ee" stroke="#333a42" stroke-width="0.5"/>
    <rect x="52" y="78.5" width="24" height="9" rx="1.5" fill="#22272f"/>
    <rect x="54" y="80" width="17" height="2.6" rx="1.3" fill="#8b95a1" stroke="#14181e" stroke-width="0.5"/>
    <circle cx="72.5" cy="81.3" r="1.5" fill="#e0742f"/>
    <rect x="54" y="83.9" width="17" height="2.6" rx="1.3" fill="#8b95a1" stroke="#14181e" stroke-width="0.5"/>
    <circle cx="72.5" cy="85.2" r="1.5" fill="#e0742f"/>
    <rect x="41" y="63.5" width="5" height="1.7" rx="0.8" transform="rotate(18 43.5 64.3)" fill="#14181e"/>
    <rect x="42" y="67.5" width="5" height="1.7" rx="0.8" transform="rotate(18 44.5 68.3)" fill="#14181e"/>
    <rect x="60" y="43" width="8" height="12" rx="2" fill="url(#fp-iron)" stroke="#14181e" stroke-width="1"/>
    <path d="M60.5 47 h7 M60.5 50 h7" stroke="#0f1318" stroke-width="1" opacity="0.8"/>`,
  },
  stealth: {
    transform: "translate(64 93) scale(1.05 0.84) translate(-64 -93)",
    body: `    <ellipse cx="64" cy="92" rx="17" ry="6" fill="#14181e"/>
    <path d="M38 73 Q39 58 46 54 Q54 48.5 64 48.5 Q74 48.5 82 54 Q89 58 90 73 Q89 83 80 89.5 Q72 94.5 64 94.5 Q56 94.5 48 89.5 Q39 83 38 73 Z"
          fill="url(#fp-steel)" stroke="#1c2127" stroke-width="1.4"/>
    <path class="team-paint" d="M64 58 L78 68 L72 84 L64 80 L56 84 L50 68 Z" fill="url(#fp-paint)" stroke="#4a0f10" stroke-width="1"/>
    <path class="team-paint-edge" d="M52 67 L64 59 L76 67" fill="none" stroke="#ff9d8c" stroke-width="1" opacity="0.55"/>
    <path d="M50 68 L44 66 M78 68 L84 66 M72 84 L76 88 M56 84 L52 88" stroke="#262c34" stroke-width="1" opacity="0.85"/>
    <circle cx="64" cy="61" r="1.1" fill="#e3e9ee" stroke="#333a42" stroke-width="0.5"/>
    <circle cx="75" cy="69" r="1.1" fill="#e3e9ee" stroke="#333a42" stroke-width="0.5"/>
    <circle cx="53" cy="69" r="1.1" fill="#e3e9ee" stroke="#333a42" stroke-width="0.5"/>
    <circle cx="64" cy="76" r="1.1" fill="#e3e9ee" stroke="#333a42" stroke-width="0.5"/>
    <rect x="41" y="63.5" width="5" height="1.7" rx="0.8" transform="rotate(18 43.5 64.3)" fill="#14181e"/>
    <rect x="42" y="67.5" width="5" height="1.7" rx="0.8" transform="rotate(18 44.5 68.3)" fill="#14181e"/>
    <rect x="60" y="43" width="8" height="12" rx="2" fill="url(#fp-iron)" stroke="#14181e" stroke-width="1"/>
    <path d="M60.5 47 h7 M60.5 50 h7" stroke="#0f1318" stroke-width="1" opacity="0.8"/>`,
  },
};

/** Turret groups per class (drawn top-down pointing N, pivot (64,42)). */
const TURRETS = {
  rifle: `    <circle cx="64" cy="42" r="11" fill="url(#fp-iron)" stroke="#14181e" stroke-width="1.2"/>
    <circle cx="56.5" cy="34.5" r="1" fill="#cfd6dd"/>
    <circle cx="71.5" cy="34.5" r="1" fill="#cfd6dd"/>
    <circle cx="56.5" cy="49.5" r="1" fill="#cfd6dd"/>
    <circle cx="71.5" cy="49.5" r="1" fill="#cfd6dd"/>
    <polygon points="71.85,45.25 67.25,49.85 60.75,49.85 56.15,45.25 56.15,38.75 60.75,34.15 67.25,34.15 71.85,38.75"
             fill="url(#fp-pod)" stroke="#1c2127" stroke-width="1.2"/>
    <polygon points="69.2,44.15 66.15,47.2 61.85,47.2 58.8,44.15 58.8,39.85 61.85,36.8 66.15,36.8 69.2,39.85" fill="url(#fp-iron)"/>
    <rect x="59.5" y="32.2" width="9" height="4.6" rx="2.3" fill="#3ad9ee" opacity="0.3"/>
    <rect x="60.5" y="33.4" width="7" height="2.6" rx="1.2" fill="#6ff2ff"/>
    <path d="M69.5 47.5 73 51" stroke="#8b95a1" stroke-width="1.2"/>
    <circle cx="73.4" cy="51.4" r="1" fill="#6ff2ff"/>
    <rect x="70" y="39" width="7" height="6.4" rx="1.2" fill="url(#fp-iron)" stroke="#14181e" stroke-width="1"/>
    <rect x="74.9" y="49.5" width="4.2" height="8.5" rx="1.4" fill="#22272f"/>
    <path d="M75.4 56.5 h3.2" stroke="#454d58" stroke-width="1.2"/>
    <rect x="73" y="28.5" width="8" height="21.5" rx="1.8" fill="url(#fp-gun)" stroke="#14181e" stroke-width="1"/>
    <rect class="team-paint-accent" x="73.6" y="45.5" width="6.8" height="2.4" fill="#c8362e"/>
    <circle cx="81.6" cy="34" r="1.6" fill="#cfd6dd" stroke="#14181e" stroke-width="0.6"/>
    <rect x="70.9" y="18" width="2.6" height="13" rx="1.3" fill="url(#fp-iron)" stroke="#0e1116" stroke-width="0.8"/>
    <circle cx="72.2" cy="19.2" r="1" fill="#6ff2ff"/>
    <rect x="75.7" y="9.5" width="2.8" height="20" fill="url(#fp-gun)" stroke="#14181e" stroke-width="0.8"/>
    <rect x="74.6" y="22" width="5" height="1.4" fill="#22272f"/>
    <rect x="74.6" y="25.5" width="5" height="1.4" fill="#22272f"/>
    <rect x="74.6" y="29" width="5" height="1.4" fill="#22272f"/>
    <rect x="74.8" y="8.8" width="4.6" height="5" rx="1" fill="#22272f"/>
    <path d="M76.1 9.8 v3 M78.1 9.8 v3" stroke="#6a7480" stroke-width="0.9"/>`,
  burst: `    <circle cx="64" cy="42" r="11" fill="url(#fp-iron)" stroke="#14181e" stroke-width="1.2"/>
    <circle cx="56.5" cy="34.5" r="1" fill="#cfd6dd"/>
    <circle cx="71.5" cy="34.5" r="1" fill="#cfd6dd"/>
    <circle cx="56.5" cy="49.5" r="1" fill="#cfd6dd"/>
    <circle cx="71.5" cy="49.5" r="1" fill="#cfd6dd"/>
    <polygon points="71.85,45.25 67.25,49.85 60.75,49.85 56.15,45.25 56.15,38.75 60.75,34.15 67.25,34.15 71.85,38.75"
             fill="url(#fp-pod)" stroke="#1c2127" stroke-width="1.2"/>
    <polygon points="69.2,44.15 66.15,47.2 61.85,47.2 58.8,44.15 58.8,39.85 61.85,36.8 66.15,36.8 69.2,39.85" fill="url(#fp-iron)"/>
    <rect x="59.5" y="32.2" width="9" height="4.6" rx="2.3" fill="#3ad9ee" opacity="0.3"/>
    <rect x="60.5" y="33.4" width="7" height="2.6" rx="1.2" fill="#6ff2ff"/>
    <path d="M69.5 47.5 73 51" stroke="#8b95a1" stroke-width="1.2"/>
    <circle cx="73.4" cy="51.4" r="1" fill="#6ff2ff"/>
    <rect x="70" y="39" width="7" height="6.4" rx="1.2" fill="url(#fp-iron)" stroke="#14181e" stroke-width="1"/>
    <rect x="74.9" y="47.5" width="4.2" height="7" rx="1.4" fill="#22272f"/>
    <rect x="72.4" y="31" width="10.2" height="17" rx="2" fill="url(#fp-gun)" stroke="#14181e" stroke-width="1"/>
    <rect class="team-paint-accent" x="73.2" y="42.5" width="8.6" height="2.4" fill="#c8362e"/>
    <circle cx="81.6" cy="35" r="1.6" fill="#cfd6dd" stroke="#14181e" stroke-width="0.6"/>
    <rect x="73.2" y="20" width="2.2" height="12.5" fill="url(#fp-gun)" stroke="#14181e" stroke-width="0.7"/>
    <rect x="76.3" y="18" width="2.2" height="14.5" fill="url(#fp-gun)" stroke="#14181e" stroke-width="0.7"/>
    <rect x="79.4" y="20" width="2.2" height="12.5" fill="url(#fp-gun)" stroke="#14181e" stroke-width="0.7"/>
    <rect x="72.6" y="26.5" width="9.8" height="2" fill="#22272f"/>
    <circle cx="74.3" cy="19.6" r="1.2" fill="#14181e"/>
    <circle cx="77.4" cy="17.6" r="1.2" fill="#14181e"/>
    <circle cx="80.5" cy="19.6" r="1.2" fill="#14181e"/>`,
  auto: `    <circle cx="64" cy="42" r="11" fill="url(#fp-iron)" stroke="#14181e" stroke-width="1.2"/>
    <circle cx="56.5" cy="34.5" r="1" fill="#cfd6dd"/>
    <circle cx="71.5" cy="34.5" r="1" fill="#cfd6dd"/>
    <circle cx="56.5" cy="49.5" r="1" fill="#cfd6dd"/>
    <circle cx="71.5" cy="49.5" r="1" fill="#cfd6dd"/>
    <polygon points="71.85,45.25 67.25,49.85 60.75,49.85 56.15,45.25 56.15,38.75 60.75,34.15 67.25,34.15 71.85,38.75"
             fill="url(#fp-pod)" stroke="#1c2127" stroke-width="1.2"/>
    <polygon points="69.2,44.15 66.15,47.2 61.85,47.2 58.8,44.15 58.8,39.85 61.85,36.8 66.15,36.8 69.2,39.85" fill="url(#fp-iron)"/>
    <rect x="59.5" y="32.2" width="9" height="4.6" rx="2.3" fill="#3ad9ee" opacity="0.3"/>
    <rect x="60.5" y="33.4" width="7" height="2.6" rx="1.2" fill="#6ff2ff"/>
    <path d="M69.5 47.5 73 51" stroke="#8b95a1" stroke-width="1.2"/>
    <circle cx="73.4" cy="51.4" r="1" fill="#6ff2ff"/>
    <rect x="70" y="39" width="7" height="6.4" rx="1.2" fill="url(#fp-iron)" stroke="#14181e" stroke-width="1"/>
    <circle cx="77.5" cy="48.5" r="4.6" fill="url(#fp-iron)" stroke="#14181e" stroke-width="1"/>
    <path d="M77.5 44.5 v8 M73.6 48.5 h7.8" stroke="#0f1318" stroke-width="0.8" opacity="0.7"/>
    <circle cx="77.5" cy="48.5" r="1.4" fill="#0f1318"/>
    <rect x="73" y="32" width="9" height="13" rx="1.8" fill="url(#fp-gun)" stroke="#14181e" stroke-width="1"/>
    <rect class="team-paint-accent" x="73.6" y="41" width="7.8" height="2.4" fill="#c8362e"/>
    <rect x="74.2" y="13" width="6.6" height="20" fill="url(#fp-gun)" stroke="#14181e" stroke-width="0.9"/>
    <path d="M76 14 V32 M77.5 14 V32 M79 14 V32" stroke="#2c323b" stroke-width="0.9"/>
    <rect x="73.4" y="24" width="8.2" height="2.2" fill="#22272f"/>
    <rect x="73.6" y="10.8" width="7.8" height="3.6" rx="1.4" fill="#22272f"/>
    <circle cx="75.9" cy="12.6" r="0.9" fill="#6a7480"/>
    <circle cx="77.5" cy="12.6" r="0.9" fill="#6a7480"/>
    <circle cx="79.1" cy="12.6" r="0.9" fill="#6a7480"/>`,
  missile: `    <circle cx="64" cy="42" r="11" fill="url(#fp-iron)" stroke="#14181e" stroke-width="1.2"/>
    <circle cx="56.5" cy="34.5" r="1" fill="#cfd6dd"/>
    <circle cx="71.5" cy="34.5" r="1" fill="#cfd6dd"/>
    <circle cx="56.5" cy="49.5" r="1" fill="#cfd6dd"/>
    <circle cx="71.5" cy="49.5" r="1" fill="#cfd6dd"/>
    <polygon points="71.85,45.25 67.25,49.85 60.75,49.85 56.15,45.25 56.15,38.75 60.75,34.15 67.25,34.15 71.85,38.75"
             fill="url(#fp-pod)" stroke="#1c2127" stroke-width="1.2"/>
    <polygon points="69.2,44.15 66.15,47.2 61.85,47.2 58.8,44.15 58.8,39.85 61.85,36.8 66.15,36.8 69.2,39.85" fill="url(#fp-iron)"/>
    <circle cx="64" cy="36.2" r="3.4" fill="#3ad9ee" opacity="0.3"/>
    <circle cx="64" cy="36.2" r="2.2" fill="#6ff2ff"/>
    <circle cx="64" cy="36.2" r="0.9" fill="#0f1318"/>
    <path d="M58.5 47.5 55 51" stroke="#8b95a1" stroke-width="1.2"/>
    <circle cx="54.6" cy="51.4" r="1" fill="#6ff2ff"/>
    <rect x="70" y="38" width="6" height="8" rx="1.2" fill="url(#fp-iron)" stroke="#14181e" stroke-width="1"/>
    <rect x="70.8" y="17.5" width="13.4" height="26" rx="2" fill="url(#fp-iron)" stroke="#14181e" stroke-width="1"/>
    <rect x="72.3" y="19" width="3.1" height="23" rx="1.5" fill="url(#fp-gun)" stroke="#14181e" stroke-width="0.6"/>
    <rect x="75.95" y="19" width="3.1" height="23" rx="1.5" fill="url(#fp-gun)" stroke="#14181e" stroke-width="0.6"/>
    <rect x="79.6" y="19" width="3.1" height="23" rx="1.5" fill="url(#fp-gun)" stroke="#14181e" stroke-width="0.6"/>
    <circle cx="73.85" cy="20.6" r="1.35" fill="#e0742f"/>
    <circle cx="77.5" cy="20.6" r="1.35" fill="#e0742f"/>
    <circle cx="81.15" cy="20.6" r="1.35" fill="#e0742f"/>
    <rect x="70.8" y="26" width="13.4" height="1.6" fill="#22272f"/>
    <rect x="70.8" y="34" width="13.4" height="1.6" fill="#22272f"/>
    <rect class="team-paint-accent" x="70.8" y="40.5" width="13.4" height="2.2" fill="#c8362e"/>`,
  stealth: `    <circle cx="64" cy="42" r="9.5" fill="url(#fp-iron)" stroke="#14181e" stroke-width="1.1"/>
    <polygon points="64,32.5 70.5,38 70.5,46 64,51.5 57.5,46 57.5,38" fill="url(#fp-pod)" stroke="#1c2127" stroke-width="1.1"/>
    <polygon points="64,35.5 68,39 68,45 64,48.5 60,45 60,39" fill="url(#fp-iron)"/>
    <rect x="60.6" y="33.8" width="6.8" height="3.4" rx="1.6" fill="#3ad9ee" opacity="0.28"/>
    <rect x="61.4" y="34.6" width="5.2" height="1.8" rx="0.9" fill="#6ff2ff"/>
    <path d="M58.5 47.5 53.5 53.5" stroke="#454d58" stroke-width="1.6"/>
    <path d="M69.5 47.5 74.5 53.5" stroke="#454d58" stroke-width="1.6"/>
    <circle cx="53.2" cy="53.8" r="1" fill="#6ff2ff" opacity="0.8"/>
    <circle cx="74.8" cy="53.8" r="1" fill="#6ff2ff" opacity="0.8"/>
    <rect x="70.5" y="39.5" width="5" height="5.4" rx="1.1" fill="url(#fp-iron)" stroke="#14181e" stroke-width="0.9"/>
    <rect x="74.4" y="30" width="4.4" height="11" rx="1.6" fill="url(#fp-gun)" stroke="#14181e" stroke-width="0.8"/>
    <rect class="team-paint-accent" x="74.8" y="36.5" width="3.6" height="2" fill="#c8362e"/>
    <rect x="75.6" y="22.5" width="2" height="8" fill="url(#fp-gun)" stroke="#14181e" stroke-width="0.6"/>
    <rect x="74.9" y="17.5" width="3.4" height="6" rx="1.6" fill="#22272f"/>`,
};

/**
 * Posture rig. Legs fold via transforms around the ground line (y=101) so
 * feet stay planted while knees splay; the hull drops and flattens around its
 * belly line (y=94.5). The turret pivot is the hull mount point mapped
 * through the hull posture transform — recompute it if you tune these:
 *   pivotY = round(dropY + 94.5 - (94.5 - 42) * flattenY)
 */
const POSTURES = {
  upright: {
    legsTransform: "",
    bodyTransform: "",
    pivot: [64, 42],
    desc: "full height; standard travel posture",
  },
  ducking: {
    legsTransform: "translate(64 101) scale(1.04 0.82) translate(-64 -101)",
    bodyTransform: "translate(0 6) translate(64 94.5) scale(1 0.96) translate(-64 -94.5)",
    pivot: [64, 50],
    desc: "combat hunker; knees bent, hull dropped ~6px, same traversal as upright",
  },
  crouching: {
    legsTransform: "translate(64 101) scale(1.14 0.5) translate(-64 -101)",
    bodyTransform: "translate(0 4) translate(64 94.5) scale(1 0.85) translate(-64 -94.5)",
    pivot: [64, 54],
    desc: "near-prone; legs splayed flat, belly at the ground line, best cover class",
  },
};

/** Bake order matters: posture fold is applied OUTSIDE the class hull scale. */
function bodyFile(className, postureName) {
  const hull = HULLS[className];
  const posture = POSTURES[postureName];
  const transform = [posture.bodyTransform, hull.transform].filter(Boolean).join(" ");
  const bodyOpen = transform ? `  <g class="body" transform="${transform}">` : `  <g class="body">`;
  const legsOpen = posture.legsTransform
    ? `  <g class="legs" stroke-linejoin="round" transform="${posture.legsTransform}">`
    : `  <g class="legs" stroke-linejoin="round">`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" class="robot-body ${className}" data-class="${className}" data-posture="${postureName}" data-turret-pivot="${posture.pivot[0]} ${posture.pivot[1]}" role="img" aria-label="${className} bot body, ${postureName}">
  <desc>Foundry Plate ${className} chassis, ${postureName} posture (${posture.desc}). Layers: shadow, legs, body. Turret ships separately in turret.svg and mounts at data-turret-pivot. Generated by scripts/generate-robot-assets.mjs — do not hand-edit.</desc>
${DEFS}
${SHADOW}
${legsOpen}
${LEGS}
  </g>
${bodyOpen}
${hull.body}
  </g>
</svg>
`;
}

/** Turret in its own 96×96 box, pivot at the exact center (48,48), with the
 *  1.18× small-size readability scale baked in. Pixi: anchor 0.5, rotate. */
function turretFile(className) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" class="robot-turret ${className}" data-class="${className}" data-pivot="48 48" data-scale-baked="1.18" role="img" aria-label="${className} bot turret">
  <desc>Foundry Plate ${className} turret, top-down pointing N. Pivot at the viewBox center (48,48); rotate the whole sprite around its center to aim. The 1.18x readability scale is baked in. Generated by scripts/generate-robot-assets.mjs — do not hand-edit.</desc>
${DEFS}
  <g class="turret" transform="translate(48 48) scale(1.18) translate(-64 -42)">
${TURRETS[className]}
  </g>
</svg>
`;
}

let count = 0;
for (const className of Object.keys(HULLS)) {
  const dir = join(OUT, className);
  mkdirSync(dir, { recursive: true });
  for (const postureName of Object.keys(POSTURES)) {
    writeFileSync(join(dir, `body-${postureName}.svg`), bodyFile(className, postureName));
    count += 1;
  }
  writeFileSync(join(dir, "turret.svg"), turretFile(className));
  count += 1;
}
console.log(`Wrote ${count} robot sprite files to public/assets/robots/<class>/`);
