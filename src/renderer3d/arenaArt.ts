/** Arena surface detail (concept prototype, opt-in with `?art=next`).
 *
 *  Detail lives in textures and shaders rather than triangles, because the
 *  target GPU (integrated Iris Xe) is bound by scene geometry and AO passes:
 *  - the floor gains a generated normal map and a packed occlusion/roughness
 *    map (bevelled plates, pitting, hairline cracks);
 *  - masonry and metal props gain a world-space weathering hook (colour
 *    breakup, ground grime, roughness variation, micro-bump) at zero draw cost;
 *  - bushes become instanced alpha-card foliage, far fewer triangles than the
 *    faceted icosphere clusters they replace;
 *  - floodlight beams use a soft volumetric shader instead of flat cones.
 *
 *  Legibility comes first: detail adds grit through surface texture, never by
 *  dimming the scene, and floors avoid glossy high-frequency sparkle.
 *
 *  All variation is hashed from tile coordinates, so every replay shows the
 *  identical arena.
 */

import * as THREE from "three";
import type { Arena } from "../engine/types";
import { hash01 } from "./kinematics";

export const artPreviewEnabled = (): boolean => {
  try {
    return new URLSearchParams(window.location.search).get("art") === "next";
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// Floor: height field -> tangent-space normal map + ORM (occlusion, roughness).

export interface FloorDetail {
  readonly normal: HTMLCanvasElement;
  /** R = cavity occlusion, G = roughness, B = metalness (glTF ORM layout). */
  readonly orm: HTMLCanvasElement;
}

export interface FloorDetailStyle {
  /** Baseline roughness of dry plates, 0..1. */
  readonly roughness: number;
  readonly metalness: number;
  /** Normal strength; larger reads as deeper seams and rougher concrete. */
  readonly relief: number;
}

export const paintFloorDetail = (
  arena: Arena,
  px: number,
  style: FloorDetailStyle,
): FloorDetail => {
  const width = arena.width * px;
  const height = arena.height * px;
  const h = new Float32Array(width * height).fill(0.6);
  const rough = new Float32Array(width * height).fill(style.roughness);

  const stamp = (cx: number, cy: number, r: number, depth: number, field = h) => {
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(width - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(height - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y += 1)
      for (let x = x0; x <= x1; x += 1) {
        const d = Math.hypot(x - cx, y - cy) / r;
        if (d >= 1) continue;
        const falloff = 1 - d * d;
        field[y * width + x]! += depth * falloff * falloff;
      }
  };

  // Broad undulation, then concrete pores and aggregate.
  for (let i = 0; i < arena.width * arena.height * 0.6; i += 1)
    stamp(
      hash01("fu-x", i) * width,
      hash01("fu-y", i) * height,
      px * (0.4 + hash01("fu-r", i) * 0.9),
      (hash01("fu-d", i) - 0.5) * 0.12,
    );
  for (let i = 0; i < arena.width * arena.height * 70; i += 1)
    stamp(
      hash01("fp-x", i) * width,
      hash01("fp-y", i) * height,
      0.8 + hash01("fp-r", i) * 1.6,
      hash01("fp-d", i) > 0.35 ? -0.05 : 0.03,
    );

  // Plates: bevelled edges falling into recessed seams.
  const bevel = Math.max(3, Math.round(px * 0.07));
  for (let y = 0; y < height; y += 1) {
    const ly = y % px;
    for (let x = 0; x < width; x += 1) {
      const lx = x % px;
      const edge = Math.min(lx, ly, px - 1 - lx, px - 1 - ly);
      if (edge < bevel) {
        const t = edge / bevel;
        h[y * width + x] = h[y * width + x]! * (0.85 + 0.15 * t * t * (3 - 2 * t));
        rough[y * width + x] = Math.min(1, rough[y * width + x]! + (1 - t) * 0.2);
      }
    }
  }

  // Per tile: hairline cracks on some plates, gravel on rough ground, chasm.
  for (let ty = 0; ty < arena.height; ty += 1)
    for (let tx = 0; tx < arena.width; tx += 1) {
      const key = `${tx},${ty}`;
      const terrain = arena.tiles[ty]?.[tx]?.terrain;
      const ox = tx * px;
      const oy = ty * px;
      if (terrain === "rough") {
        for (let n = 0; n < 90; n += 1)
          stamp(
            ox + hash01(key, 1000 + n) * px,
            oy + hash01(key, 1200 + n) * px,
            1.5 + hash01(key, 1400 + n) * 3,
            0.25 + hash01(key, 1600 + n) * 0.25,
          );
      }
      if (terrain === "crevice") {
        for (let y = oy + px * 0.3; y < oy + px * 0.7; y += 1)
          for (let x = ox; x < ox + px; x += 1) h[Math.floor(y) * width + x] = 0;
      }
      if (hash01(key, 21) < 0.28 && terrain !== "crevice") {
        let x = ox + hash01(key, 22) * px;
        let y = oy + hash01(key, 23) * px;
        let angle = hash01(key, 24) * Math.PI * 2;
        const steps = 10 + Math.floor(hash01(key, 25) * 16);
        for (let n = 0; n < steps; n += 1) {
          angle += (hash01(key, 30 + n) - 0.5) * 1.1;
          x += Math.cos(angle) * 2.2;
          y += Math.sin(angle) * 2.2;
          if (x < ox || y < oy || x >= ox + px || y >= oy + px) break;
          stamp(x, y, 1.6, -0.35);
        }
      }
    }

  const normal = document.createElement("canvas");
  normal.width = width;
  normal.height = height;
  const orm = document.createElement("canvas");
  orm.width = width;
  orm.height = height;
  const nImage = new ImageData(width, height);
  const oImage = new ImageData(width, height);
  const at = (x: number, y: number) =>
    h[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))]!;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      // Canvas y runs down, texture v runs up: flip the y gradient's sign.
      const dx = (at(x + 1, y) - at(x - 1, y)) * style.relief;
      const dy = (at(x, y + 1) - at(x, y - 1)) * style.relief;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * width + x) * 4;
      nImage.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      nImage.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      nImage.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      nImage.data[i + 3] = 255;
      const cavity = THREE.MathUtils.clamp(0.92 + h[y * width + x]! * 0.2, 0, 1);
      oImage.data[i] = cavity * 255;
      oImage.data[i + 1] = THREE.MathUtils.clamp(rough[y * width + x]!, 0.04, 1) * 255;
      oImage.data[i + 2] = style.metalness * 255;
      oImage.data[i + 3] = 255;
    }
  normal.getContext("2d")?.putImageData(nImage, 0, 0);
  orm.getContext("2d")?.putImageData(oImage, 0, 0);
  return { normal, orm };
};

// ---------------------------------------------------------------------------
// Weathering: world-space procedural detail injected into prop materials.

type WeatherProfile = "masonry" | "metal" | "soft" | "floor";

const MATERIAL_PROFILES: Readonly<Record<string, WeatherProfile>> = {
  Brick: "masonry",
  Concrete: "masonry",
  ConcreteDark: "masonry",
  CapStone: "masonry",
  Rock: "masonry",
  Sandbag: "soft",
  CrateWood: "soft",
  ArenaSteel: "metal",
  Rebar: "metal",
  ArenaHazard: "metal",
  ArenaFloor: "floor",
};

const PROFILE_UNIFORMS: Readonly<
  Record<
    WeatherProfile,
    { scale: number; tone: number; bump: number; grime: number; rough: number }
  >
> = {
  masonry: { scale: 7, tone: 0.24, bump: 0.02, grime: 0.2, rough: 0.12 },
  soft: { scale: 12, tone: 0.16, bump: 0.008, grime: 0.18, rough: 0.05 },
  metal: { scale: 4, tone: 0.08, bump: 0.003, grime: 0.18, rough: 0.22 },
  // Fine grain for enlarged tiles: sharp up close, no ground grime (it is the ground).
  floor: { scale: 22, tone: 0.1, bump: 0.006, grime: 0, rough: 0.08 },
};

/** Tileable detail noise, generated once: R = fine grain, G = broad blotches,
 *  B = vertical streaks, A = bump height. One fetch replaces dozens of hashes
 *  of procedural noise per pixel, which integrated GPUs pay for heavily. */
const NOISE_SIZE = 256;
let noiseTexture: THREE.DataTexture | null = null;
export const weatherNoise = (): THREE.DataTexture => {
  if (noiseTexture !== null) return noiseTexture;
  const size = NOISE_SIZE;
  const lattice = (period: number, salt: string) => {
    const values = new Float32Array(period * period);
    for (let i = 0; i < values.length; i += 1) values[i] = hash01(salt, i);
    return (x: number, y: number) => {
      const fx = (x / size) * period;
      const fy = (y / size) * period;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const v = (ix: number, iy: number) =>
        values[(((iy % period) + period) % period) * period + (((ix % period) + period) % period)]!;
      return THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(v(x0, y0), v(x0 + 1, y0), sx),
        THREE.MathUtils.lerp(v(x0, y0 + 1), v(x0 + 1, y0 + 1), sx),
        sy,
      );
    };
  };
  const fine = [lattice(16, "wn-a"), lattice(32, "wn-b"), lattice(64, "wn-c")];
  const blot = [lattice(4, "wn-d"), lattice(8, "wn-e")];
  const streakX = lattice(64, "wn-f");
  const bump = [lattice(32, "wn-g"), lattice(64, "wn-h"), lattice(128, "wn-i")];
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      data[i] = (fine[0]!(x, y) * 0.5 + fine[1]!(x, y) * 0.3 + fine[2]!(x, y) * 0.2) * 255;
      data[i + 1] = (blot[0]!(x, y) * 0.65 + blot[1]!(x, y) * 0.35) * 255;
      // Streaks: fine across, stretched along v (world height on walls).
      data[i + 2] = streakX(x, y / 16) * 255;
      data[i + 3] = (bump[0]!(x, y) * 0.5 + bump[1]!(x, y) * 0.3 + bump[2]!(x, y) * 0.2) * 255;
    }
  noiseTexture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  noiseTexture.wrapS = THREE.RepeatWrapping;
  noiseTexture.wrapT = THREE.RepeatWrapping;
  noiseTexture.magFilter = THREE.LinearFilter;
  noiseTexture.minFilter = THREE.LinearMipmapLinearFilter;
  noiseTexture.generateMipmaps = true;
  noiseTexture.needsUpdate = true;
  return noiseTexture;
};

const weathered = new WeakSet<THREE.Material>();

/** Adds procedural weathering to a prop material in place (idempotent). */
export const weatherMaterial = (material: THREE.Material): void => {
  if (!(material instanceof THREE.MeshStandardMaterial) || weathered.has(material)) return;
  const profile = MATERIAL_PROFILES[material.name];
  if (profile === undefined) return;
  weathered.add(material);
  const values = PROFILE_UNIFORMS[profile];
  const noise = weatherNoise();
  material.onBeforeCompile = (shader) => {
    shader.uniforms["uArtNoise"] = { value: noise };
    shader.uniforms["uArtScale"] = { value: values.scale / 8 };
    shader.uniforms["uArtTone"] = { value: values.tone };
    shader.uniforms["uArtBump"] = { value: values.bump };
    shader.uniforms["uArtGrime"] = { value: values.grime };
    shader.uniforms["uArtRough"] = { value: values.rough };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vArtWorld;\nvarying vec3 vArtNormal;",
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        vec4 artWorld = vec4(transformed, 1.0);
        vec3 artNormal = objectNormal;
        #ifdef USE_INSTANCING
          artWorld = instanceMatrix * artWorld;
          artNormal = mat3(instanceMatrix) * artNormal;
        #endif
        vArtWorld = (modelMatrix * artWorld).xyz;
        vArtNormal = mat3(modelMatrix) * artNormal;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vArtWorld;
        varying vec3 vArtNormal;
        uniform sampler2D uArtNoise;
        uniform float uArtScale, uArtTone, uArtBump, uArtGrime, uArtRough;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        // Project along the dominant world axis: props are boxy, one fetch suffices.
        vec3 artAxis = abs(vArtNormal);
        vec2 artUv = artAxis.y > max(artAxis.x, artAxis.z) ? vArtWorld.xz
          : (artAxis.x > artAxis.z ? vec2(vArtWorld.z, vArtWorld.y) : vArtWorld.xy);
        artUv *= uArtScale;
        vec4 artTex = texture2D(uArtNoise, artUv);
        diffuseColor.rgb *= 1.0 + (artTex.r - 0.5) * uArtTone * 2.0 + (artTex.g - 0.5) * uArtTone;
        float artGround = 1.0 - smoothstep(0.0, 0.32, vArtWorld.y);
        float artGrime = clamp(artGround * (0.6 + artTex.g * 0.6) + artTex.b * artTex.g * 0.35, 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.42, 0.38, 0.33), artGrime * uArtGrime);`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (artTex.r - 0.5) * uArtRough * 2.0 + artGrime * 0.08, 0.04, 1.0);`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        {
          // Surface-gradient bump from the noise height (Mikkelsen 2010).
          float artH = artTex.a * uArtBump;
          vec3 sx = dFdx(-vViewPosition);
          vec3 sy = dFdy(-vViewPosition);
          vec3 r1 = cross(sy, normal);
          vec3 r2 = cross(normal, sx);
          float det = dot(sx, r1);
          vec2 dh = vec2(dFdx(artH), dFdy(artH));
          normal = normalize(abs(det) * normal - sign(det) * (dh.x * r1 + dh.y * r2));
        }`,
      );
  };
  material.customProgramCacheKey = () => `art-weather-${profile}`;
  material.needsUpdate = true;
};

// ---------------------------------------------------------------------------
// Foliage: crossed alpha cards with soft volumetric normals.

const LEAF_ATLAS_SIZE = 256;

const leafAtlas = (palette: readonly string[]): THREE.CanvasTexture => {
  const size = LEAF_ATLAS_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context !== null) {
    // Leaves fan out from the card's centre so card edges fade into gaps.
    for (let i = 0; i < 170; i += 1) {
      const radius = Math.pow(hash01("leaf-r", i), 0.7) * size * 0.42;
      const angle = hash01("leaf-a", i) * Math.PI * 2;
      const x = size / 2 + Math.cos(angle) * radius;
      const y = size / 2 + Math.sin(angle) * radius;
      const length = 16 + hash01("leaf-l", i) * 16;
      context.save();
      context.translate(x, y);
      context.rotate(angle + (hash01("leaf-t", i) - 0.5) * 1.4);
      context.beginPath();
      context.moveTo(-length / 2, 0);
      context.quadraticCurveTo(0, -length * 0.32, length / 2, 0);
      context.quadraticCurveTo(0, length * 0.32, -length / 2, 0);
      context.fillStyle = palette[Math.floor(hash01("leaf-c", i) * palette.length)]!;
      context.fill();
      context.strokeStyle = "rgba(10, 24, 6, 0.55)";
      context.lineWidth = 1;
      context.stroke();
      context.beginPath();
      context.moveTo(-length / 2, 0);
      context.lineTo(length / 2, 0);
      context.strokeStyle = "rgba(220, 255, 170, 0.18)";
      context.stroke();
      context.restore();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
};

/** One bush: crossed cards whose normals point away from the bush centre. */
const bushGeometry = (): THREE.BufferGeometry => {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const center = new THREE.Vector3(0, 0.3, 0);
  const cards = 27;
  for (let c = 0; c < cards; c += 1) {
    // Cards distributed over a squashed dome, each turned to a random facing.
    const phi = hash01("bush-phi", c) * Math.PI * 2;
    // A third of the cards lie near flat on top, so the clump reads from above.
    const canopy = c % 3 === 0;
    const lift = hash01("bush-lift", c);
    const radius = 0.06 + hash01("bush-rad", c) * 0.2;
    const origin = new THREE.Vector3(
      Math.cos(phi) * radius,
      canopy ? 0.34 + lift * 0.16 : 0.2 + lift * 0.28,
      Math.sin(phi) * radius,
    );
    const size = 0.42 + hash01("bush-size", c) * 0.16;
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        canopy
          ? -Math.PI / 2 + (hash01("bush-rx", c) - 0.5) * 0.7
          : (hash01("bush-rx", c) - 0.5) * 1.2,
        hash01("bush-ry", c) * Math.PI,
        (hash01("bush-rz", c) - 0.5) * 0.6,
      ),
    );
    const right = new THREE.Vector3(size / 2, 0, 0).applyQuaternion(q);
    const up = new THREE.Vector3(0, size / 2, 0).applyQuaternion(q);
    const base = positions.length / 3;
    for (const [sx, sy, u, v] of [
      [-1, -1, 0, 0],
      [1, -1, 1, 0],
      [1, 1, 1, 1],
      [-1, 1, 0, 1],
    ] as const) {
      const p = origin.clone().addScaledVector(right, sx).addScaledVector(up, sy);
      positions.push(p.x, Math.max(0.02, p.y), p.z);
      // Volumetric normal: mostly radial, so the clump shades as one soft mass.
      const n = p.clone().sub(center).normalize();
      n.y = n.y * 0.7 + 0.3;
      n.normalize();
      normals.push(n.x, n.y, n.z);
      uvs.push(u, v);
      // Self-shadowing by depth inside the clump, standing in for AO.
      const shade = THREE.MathUtils.clamp(
        0.72 + p.y * 0.7 + p.clone().setY(0).length() * 0.5,
        0,
        1,
      );
      colors.push(shade, shade, shade);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  return geometry;
};

/** Instanced bushes at the given tile matrices; excluded from the GTAO normal pass. */
export const buildFoliage = (
  matrices: readonly THREE.Matrix4[],
  palette: readonly string[],
): { mesh: THREE.InstancedMesh; dispose(): void } => {
  const geometry = bushGeometry();
  const map = leafAtlas(palette);
  const material = new THREE.MeshStandardMaterial({
    map,
    vertexColors: true,
    alphaTest: 0.45,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
    roughness: 0.78,
    metalness: 0,
  });
  material.name = "FoliageCards";
  // Light passing through leaves: a soft wrap term keeps back-lit cards alive.
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <alphatest_fragment>",
        `{
          // Mips average leaves with gaps, so distant cards would dissolve under
          // the alpha test. Scale alpha up with mip level to keep coverage.
          vec2 texel = vMapUv * ${LEAF_ATLAS_SIZE}.0;
          vec2 tx = dFdx(texel);
          vec2 ty = dFdy(texel);
          float mip = max(0.0, 0.5 * log2(max(dot(tx, tx), dot(ty, ty))));
          diffuseColor.a *= 1.0 + mip * 0.3;
        }
        #include <alphatest_fragment>`,
      )
      .replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>
      reflectedLight.indirectDiffuse += diffuseColor.rgb * 0.06;`,
      );
  };
  material.customProgramCacheKey = () => "art-foliage";
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
  const tint = new THREE.Color();
  matrices.forEach((matrix, index) => {
    mesh.setMatrixAt(index, matrix);
    const t = hash01("bush-tint", index);
    mesh.setColorAt(index, tint.setHSL(0.24 + (t - 0.5) * 0.08, 0.4, 0.9 + t * 0.1));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = "terrain:Bush";
  mesh.userData["noAO"] = true;
  mesh.computeBoundingSphere();
  return {
    mesh,
    dispose: () => {
      geometry.dispose();
      map.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
};

// ---------------------------------------------------------------------------
// Floodlight beams: soft-edged volumetric cones instead of flat translucent wedges.

export const beamMaterial = (color: number, opacity: number): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormalView;
      varying vec3 vViewDir;
      varying float vAlong;
      void main() {
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        vNormalView = normalize(normalMatrix * normal);
        vViewDir = normalize(-view.xyz);
        vAlong = uv.y;
        gl_Position = projectionMatrix * view;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec3 vNormalView;
      varying vec3 vViewDir;
      varying float vAlong;
      void main() {
        // Thick through the beam's core, vanishing at its silhouette edges.
        float facing = abs(dot(normalize(vNormalView), normalize(vViewDir)));
        float core = pow(facing, 2.2);
        // Brightest at the lamp, fading toward the floor.
        float along = smoothstep(0.0, 0.25, vAlong) * mix(0.25, 1.0, vAlong);
        gl_FragColor = vec4(uColor * core * along * uOpacity * 5.0, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
