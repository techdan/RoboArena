"""Builds RoboArena's 3D robot and arena models with Blender's Python API.

Run headless (Blender 4.2+/bpy wheel; no GUI needed):

    python tools/blender/build_models.py            # with `pip install bpy`
    blender -b -P tools/blender/build_models.py     # with a Blender install

Outputs binary glTF files into public/assets/models/. They are generated
artifacts: edit this script, not the .glb files.

Conventions the runtime (src/renderer3d/) depends on:

* 1 Blender unit = 1 arena tile. Exported glTF is Y-up; robots face +Z.
  (Blender authoring: Z-up, forward = -Y.)
* Robots are rigid articulated parts, not skinned meshes. Each robot file has
  `Hull`, `Turret`, `Barrel`, `LegUpper`, `LegLower` and `Foot` meshes plus
  empties `Hip0..HipN` (hull space), `TurretMount` (hull space), `BarrelMount`
  (turret space) and `Muzzle0..` (barrel space). Leg segments are modelled
  along +X from their pivot so the runtime can solve two-bone IK per leg and
  plant feet on the ground: that is what makes the robots skitter.
* Mesh parts are authored at their pivot: the runtime parents them to the
  matching empties, so each part's origin is its joint.
* Material names are the runtime's hooks: `TeamPaint` is recoloured per team,
  `Glow` drives emissive bloom, `Optic` is the scanner lens.
"""

from __future__ import annotations

import math
import os
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_DIR = os.path.join(ROOT, "public", "assets", "models")

# --------------------------------------------------------------------------
# Scene + material helpers


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


MATERIALS: dict[str, bpy.types.Material] = {}


def material(
    name: str,
    color: tuple[float, float, float],
    metallic: float = 0.0,
    roughness: float = 0.5,
    emission: tuple[float, float, float] | None = None,
    strength: float = 0.0,
) -> bpy.types.Material:
    existing = bpy.data.materials.get(name)
    if existing is not None:
        return existing
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    return mat


def robot_materials() -> dict[str, bpy.types.Material]:
    return {
        "paint": material("TeamPaint", (0.85, 0.85, 0.85), metallic=0.35, roughness=0.38),
        "metal": material("Gunmetal", (0.11, 0.12, 0.13), metallic=0.85, roughness=0.32),
        "steel": material("Steel", (0.46, 0.47, 0.49), metallic=1.0, roughness=0.22),
        "dark": material("Rubber", (0.035, 0.035, 0.04), metallic=0.0, roughness=0.8),
        "hazard": material("Hazard", (0.95, 0.62, 0.08), metallic=0.2, roughness=0.45),
        "glow": material("Glow", (0.4, 0.9, 1.0), emission=(0.35, 0.9, 1.0), strength=6.0),
        "optic": material("Optic", (0.9, 0.15, 0.08), metallic=0.3, roughness=0.1,
                          emission=(1.0, 0.18, 0.05), strength=8.0),
    }


def link(obj: bpy.types.Object) -> bpy.types.Object:
    bpy.context.collection.objects.link(obj)
    return obj


def finish(obj: bpy.types.Object, mat: bpy.types.Material, bevel: float, segments: int = 2):
    obj.data.materials.append(mat)
    if bevel > 0:
        mod = obj.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = "ANGLE"
        mod.angle_limit = math.radians(35)
        mod.harden_normals = True
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


def box(name, size, loc, mat, bevel=0.015, segments=2, rot=(0.0, 0.0, 0.0), taper=None):
    """Axis-aligned box; `taper` scales the +Z face (x, y) for wedge shapes."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)  # `size` arguments are half-extents
    for v in bm.verts:
        v.co.x *= size[0]
        v.co.y *= size[1]
        v.co.z *= size[2]
        if taper is not None and v.co.z > 0:
            v.co.x *= taper[0]
            v.co.y *= taper[1]
    bm.to_mesh(mesh)
    bm.free()
    obj = link(bpy.data.objects.new(name, mesh))
    obj.location = loc
    obj.rotation_euler = rot
    return finish(obj, mat, bevel, segments)


def cyl(name, radius, depth, loc, mat, rot=(0.0, 0.0, 0.0), verts=20, bevel=0.01, radius2=None):
    """Cylinder along local Z; `radius2` makes a cone/frustum."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        segments=verts,
        radius1=radius,
        radius2=radius if radius2 is None else radius2,
        depth=depth,
    )
    bm.to_mesh(mesh)
    bm.free()
    obj = link(bpy.data.objects.new(name, mesh))
    obj.location = loc
    obj.rotation_euler = rot
    return finish(obj, mat, bevel, 1)


def sphere(name, radius, loc, mat, scale=(1.0, 1.0, 1.0), subdiv=2):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=radius)
    bm.to_mesh(mesh)
    bm.free()
    obj = link(bpy.data.objects.new(name, mesh))
    obj.location = loc
    obj.scale = scale
    return finish(obj, mat, 0)


def empty(name, loc, parent=None):
    obj = link(bpy.data.objects.new(name, None))
    obj.empty_display_size = 0.05
    obj.location = loc
    if parent is not None:
        obj.parent = parent
    return obj


def join(name: str, parts: list[bpy.types.Object]) -> bpy.types.Object:
    """Applies modifiers and transforms, then merges parts into one mesh object."""
    bpy.ops.object.select_all(action="DESELECT")
    for part in parts:
        part.select_set(True)
        bpy.context.view_layer.objects.active = part
        for mod in list(part.modifiers):
            bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.context.view_layer.objects.active = parts[0]
    if len(parts) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    obj.data.name = name
    # Weighted normals keep bevelled hard-surface edges crisp.
    mod = obj.modifiers.new("wn", "WEIGHTED_NORMAL")
    mod.keep_sharp = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.select_all(action="DESELECT")
    return obj


def set_origin(obj: bpy.types.Object, pivot: tuple[float, float, float]) -> None:
    """Moves the object's origin to `pivot` (world) without moving its geometry."""
    offset = Vector(pivot) - obj.location
    obj.data.transform(Matrix.Translation(-offset))
    obj.location = Vector(pivot)


def export(path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_extras=False,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
    )
    print(f"wrote {os.path.relpath(path, ROOT)} ({os.path.getsize(path) // 1024} KB)")


# --------------------------------------------------------------------------
# Robot parts. Authoring frame: Z up, -Y forward, ground at z=0.


def leg_parts(m, upper_len: float, lower_len: float, heavy: float) -> None:
    """Spider-leg segments modelled along +X from their joint at the origin.

    Box sizes are half-extents, so `t` is half the beam thickness.
    """
    t = 0.028 * heavy
    upper = [
        # Twin side plates around a dark core read as a machined linkage.
        box("u_plate_a", (upper_len * 0.5, 0.006, t * 1.05), (upper_len * 0.5, t * 0.85, 0),
            m["paint"], bevel=0.004),
        box("u_plate_b", (upper_len * 0.5, 0.006, t * 1.05), (upper_len * 0.5, -t * 0.85, 0),
            m["paint"], bevel=0.004),
        box("u_core", (upper_len * 0.44, t * 0.8, t * 0.75), (upper_len * 0.5, 0, 0), m["metal"],
            bevel=0.006),
        box("u_cap", (upper_len * 0.3, t * 0.95, t * 0.18), (upper_len * 0.42, 0, t * 1.05),
            m["paint"], bevel=0.004),
        cyl("u_joint", t * 1.25, t * 2.2, (0, 0, 0), m["metal"], rot=(math.pi / 2, 0, 0), verts=16),
        cyl("u_hub", t * 0.55, t * 2.4, (0, 0, 0), m["steel"], rot=(math.pi / 2, 0, 0), verts=10),
        cyl("u_knee", t * 1.05, t * 2.0, (upper_len, 0, 0), m["metal"], rot=(math.pi / 2, 0, 0),
            verts=16),
        cyl("u_knee_hub", t * 0.5, t * 2.2, (upper_len, 0, 0), m["steel"],
            rot=(math.pi / 2, 0, 0), verts=10),
        cyl("u_piston", t * 0.28, upper_len * 0.62, (upper_len * 0.48, 0, -t * 1.05), m["steel"],
            rot=(0, math.pi / 2, 0), verts=8),
        cyl("u_sleeve", t * 0.42, upper_len * 0.28, (upper_len * 0.3, 0, -t * 1.05), m["metal"],
            rot=(0, math.pi / 2, 0), verts=8),
        box("u_light", (t * 0.35, t * 0.5, 0.004), (upper_len * 0.22, 0, t * 1.24), m["glow"],
            bevel=0),
    ]
    join("LegUpper", upper)

    lower = [
        box("l_blade", (lower_len * 0.5, t * 0.6, t * 0.8), (lower_len * 0.5, 0, 0), m["metal"],
            bevel=0.006, taper=(1.0, 0.6)),
        box("l_armor", (lower_len * 0.28, t * 0.7, t * 0.4), (lower_len * 0.32, 0, t * 0.75),
            m["paint"], bevel=0.006),
        box("l_hazard", (lower_len * 0.05, t * 0.72, t * 0.42), (lower_len * 0.68, 0, t * 0.55),
            m["hazard"], bevel=0.003),
        cyl("l_rod", t * 0.2, lower_len * 0.5, (lower_len * 0.45, 0, -t * 0.85), m["steel"],
            rot=(0, math.pi / 2, 0), verts=8),
    ]
    join("LegLower", lower)

    foot = [
        cyl("f_pad", t * 1.15, t * 0.5, (0, 0, -t * 0.55), m["dark"], verts=14, radius2=t * 0.8),
        cyl("f_ankle", t * 0.55, t * 1.3, (0, 0, 0), m["steel"], rot=(math.pi / 2, 0, 0), verts=10),
    ]
    for i in range(3):
        a = i * 2 * math.pi / 3 + math.pi / 6
        foot.append(
            box(f"f_claw{i}", (t * 0.7, t * 0.16, t * 0.14),
                (math.cos(a) * t * 1.1, math.sin(a) * t * 1.1, -t * 0.85), m["metal"],
                bevel=0.003, rot=(0, 0.3, a))
        )
    join("Foot", foot)


def vents(name, m, center, count, spacing, size, axis="y"):
    """A row of thin raised slats: cheap, reads as machined detail at a distance."""
    parts = []
    for i in range(count):
        offset = (i - (count - 1) / 2) * spacing
        loc = (center[0] + (offset if axis == "x" else 0), center[1] + (offset if axis == "y" else 0),
               center[2])
        parts.append(box(f"{name}{i}", size, loc, m["metal"], bevel=0.002))
    return parts


def bolts(name, m, points, radius=0.008):
    return [cyl(f"{name}{i}", radius, 0.01, p, m["steel"], verts=8) for i, p in enumerate(points)]


def hip_sockets(hull_z: float, positions: list[tuple[float, float]]) -> None:
    for i, (x, y) in enumerate(positions):
        empty(f"Hip{i}", (x, y, hull_z))


def build_robot(kind: str) -> None:
    reset_scene()
    m = robot_materials()

    if kind == "rifle":
        # "Strider": sleek wedge hull, long legs, single long-barrel rail rifle.
        hull_z, legs, upper, lower, heavy = 0.42, 4, 0.34, 0.44, 1.0
        hull = [
            box("h_core", (0.2, 0.27, 0.09), (0, 0, 0), m["paint"], bevel=0.03, taper=(0.8, 0.7)),
            box("h_belly", (0.15, 0.2, 0.06), (0, 0.02, -0.1), m["metal"], bevel=0.02),
            box("h_nose", (0.11, 0.08, 0.05), (0, -0.28, -0.02), m["paint"], bevel=0.02,
                taper=(0.6, 0.5)),
            box("h_vent_l", (0.025, 0.12, 0.03), (0.17, 0.05, 0.06), m["metal"], bevel=0.008),
            box("h_vent_r", (0.025, 0.12, 0.03), (-0.17, 0.05, 0.06), m["metal"], bevel=0.008),
            box("h_strip", (0.012, 0.18, 0.012), (0, -0.05, 0.095), m["glow"], bevel=0),
            box("h_pack", (0.13, 0.08, 0.08), (0, 0.27, 0.0), m["metal"], bevel=0.02),
            cyl("h_ant", 0.006, 0.28, (0.1, 0.28, 0.17), m["steel"], verts=6),
            sphere("h_ant_tip", 0.014, (0.1, 0.28, 0.31), m["optic"]),
            box("h_stripe", (0.05, 0.2, 0.005), (0.09, -0.02, 0.093), m["hazard"], bevel=0.002),
            box("h_side_l", (0.012, 0.16, 0.05), (0.205, -0.02, -0.02), m["metal"], bevel=0.004),
            box("h_side_r", (0.012, 0.16, 0.05), (-0.205, -0.02, -0.02), m["metal"], bevel=0.004),
            *vents("h_vt", m, (-0.08, 0.12, 0.092), 4, 0.03, (0.04, 0.008, 0.006)),
            *bolts("h_bolt", m, [(0.13, -0.18, 0.08), (-0.13, -0.18, 0.08), (0.13, 0.17, 0.08),
                                 (-0.13, 0.17, 0.08)]),
        ]
        hips = [(0.17, -0.15), (-0.17, -0.15), (0.17, 0.16), (-0.17, 0.16)]
        turret = [
            box("t_base", (0.12, 0.14, 0.05), (0, 0, 0.05), m["paint"], bevel=0.02,
                taper=(0.85, 0.85)),
            box("t_scope", (0.03, 0.12, 0.03), (0.08, -0.04, 0.12), m["metal"], bevel=0.008),
            cyl("t_lens", 0.022, 0.012, (0.08, -0.165, 0.12), m["optic"],
                rot=(math.pi / 2, 0, 0), verts=14),
            box("t_eye", (0.06, 0.012, 0.016), (0, -0.14, 0.07), m["glow"], bevel=0),
        ]
        barrel_mount = (0, -0.1, 0.07)
        barrel = [
            cyl("b_main", 0.022, 0.5, (0, -0.25, 0), m["metal"], rot=(math.pi / 2, 0, 0),
                verts=14),
            cyl("b_rail", 0.012, 0.42, (0, -0.24, 0.034), m["steel"], rot=(math.pi / 2, 0, 0),
                verts=8),
            cyl("b_brake", 0.032, 0.07, (0, -0.48, 0), m["steel"], rot=(math.pi / 2, 0, 0),
                verts=8),
            box("b_coil1", (0.032, 0.02, 0.032), (0, -0.12, 0), m["glow"], bevel=0.004),
            box("b_coil2", (0.032, 0.02, 0.032), (0, -0.22, 0), m["glow"], bevel=0.004),
        ]
        muzzles = [(0, -0.52, 0)]
    elif kind == "burst":
        # "Hornet": rounded armoured shell, triple-barrel burst cannon.
        hull_z, legs, upper, lower, heavy = 0.4, 4, 0.3, 0.4, 1.1
        hull = [
            sphere("h_shell", 0.2, (0, 0, 0), m["paint"], scale=(1.05, 1.25, 0.6), subdiv=3),
            box("h_skirt", (0.2, 0.25, 0.03), (0, 0, -0.06), m["metal"], bevel=0.02),
            box("h_vis", (0.1, 0.025, 0.025), (0, -0.25, 0.0), m["glow"], bevel=0.005),
            box("h_fin_l", (0.02, 0.12, 0.08), (0.13, 0.18, 0.08), m["paint"], bevel=0.01,
                taper=(1.0, 0.5)),
            box("h_fin_r", (0.02, 0.12, 0.08), (-0.13, 0.18, 0.08), m["paint"], bevel=0.01,
                taper=(1.0, 0.5)),
            cyl("h_exh_l", 0.03, 0.08, (0.08, 0.28, 0.0), m["metal"], rot=(math.pi / 2, 0, 0),
                verts=10),
            cyl("h_exh_r", 0.03, 0.08, (-0.08, 0.28, 0.0), m["metal"], rot=(math.pi / 2, 0, 0),
                verts=10),
            box("h_band", (0.215, 0.03, 0.012), (0, -0.12, 0.05), m["metal"], bevel=0.004),
            box("h_stripe", (0.012, 0.18, 0.004), (0, 0.02, 0.122), m["hazard"], bevel=0.002),
            *bolts("h_bolt", m, [(0.15, -0.05, 0.06), (-0.15, -0.05, 0.06), (0.15, 0.1, 0.06),
                                 (-0.15, 0.1, 0.06)]),
        ]
        hips = [(0.18, -0.14), (-0.18, -0.14), (0.18, 0.15), (-0.18, 0.15)]
        turret = [
            cyl("t_ring", 0.11, 0.05, (0, 0, 0.06), m["metal"], verts=24),
            box("t_box", (0.1, 0.12, 0.06), (0, -0.02, 0.12), m["paint"], bevel=0.025,
                taper=(0.8, 0.9)),
            box("t_eye", (0.07, 0.01, 0.018), (0, -0.14, 0.13), m["optic"], bevel=0),
            box("t_mag", (0.05, 0.08, 0.05), (0.11, 0.03, 0.1), m["hazard"], bevel=0.01),
        ]
        barrel_mount = (0, -0.1, 0.11)
        barrel = [
            box("b_shroud", (0.065, 0.12, 0.05), (0, -0.1, 0), m["metal"], bevel=0.015),
        ]
        muzzles = []
        for i, (bx, bz) in enumerate([(-0.035, -0.012), (0.035, -0.012), (0.0, 0.03)]):
            barrel.append(cyl(f"b_{i}", 0.016, 0.3, (bx, -0.3, bz), m["steel"],
                              rot=(math.pi / 2, 0, 0), verts=10))
            muzzles.append((bx, -0.45, bz))
        barrel.append(cyl("b_clamp", 0.07, 0.03, (0, -0.33, 0.005), m["metal"],
                          rot=(math.pi / 2, 0, 0), verts=14))
    elif kind == "auto":
        # "Bulldog": six stubby legs, slab armour, rotary cannon with ammo drum.
        hull_z, legs, upper, lower, heavy = 0.36, 6, 0.26, 0.34, 1.35
        hull = [
            box("h_slab", (0.24, 0.3, 0.09), (0, 0, 0), m["paint"], bevel=0.035,
                taper=(0.88, 0.88)),
            box("h_under", (0.2, 0.26, 0.05), (0, 0, -0.11), m["metal"], bevel=0.02),
            box("h_plate_l", (0.035, 0.26, 0.07), (0.25, 0, -0.01), m["metal"], bevel=0.012),
            box("h_plate_r", (0.035, 0.26, 0.07), (-0.25, 0, -0.01), m["metal"], bevel=0.012),
            box("h_haz", (0.18, 0.02, 0.02), (0, -0.31, -0.02), m["hazard"], bevel=0.004),
            box("h_lamp_l", (0.025, 0.012, 0.018), (0.13, -0.3, 0.04), m["glow"], bevel=0),
            box("h_lamp_r", (0.025, 0.012, 0.018), (-0.13, -0.3, 0.04), m["glow"], bevel=0),
            cyl("h_drum", 0.08, 0.13, (0, 0.2, 0.12), m["metal"], rot=(0, math.pi / 2, 0),
                verts=18),
            cyl("h_drum_band", 0.083, 0.02, (0, 0.2, 0.12), m["hazard"], rot=(0, math.pi / 2, 0),
                verts=18),
            *vents("h_vt", m, (0, -0.1, 0.09), 5, 0.045, (0.008, 0.07, 0.006), axis="x"),
            *bolts("h_bolt", m, [(0.19, -0.24, 0.07), (-0.19, -0.24, 0.07), (0.19, 0.24, 0.07),
                                 (-0.19, 0.24, 0.07)]),
            box("h_tow", (0.05, 0.03, 0.03), (0, 0.31, -0.05), m["steel"], bevel=0.006),
        ]
        hips = [(0.22, -0.19), (-0.22, -0.19), (0.25, 0.0), (-0.25, 0.0), (0.22, 0.19),
                (-0.22, 0.19)]
        turret = [
            cyl("t_ring", 0.13, 0.06, (0, 0, 0.06), m["metal"], verts=24),
            box("t_house", (0.12, 0.13, 0.07), (0, -0.02, 0.14), m["paint"], bevel=0.03,
                taper=(0.8, 0.8)),
            box("t_eye", (0.09, 0.01, 0.02), (0, -0.155, 0.15), m["optic"], bevel=0),
            box("t_feed", (0.03, 0.12, 0.03), (0.1, 0.05, 0.11), m["hazard"], bevel=0.008),
        ]
        barrel_mount = (0, -0.12, 0.13)
        barrel = [
            cyl("b_body", 0.05, 0.12, (0, -0.06, 0), m["metal"], rot=(math.pi / 2, 0, 0),
                verts=16),
            cyl("b_front", 0.055, 0.025, (0, -0.33, 0), m["metal"], rot=(math.pi / 2, 0, 0),
                verts=16),
        ]
        for i in range(6):
            a = i * math.pi / 3
            barrel.append(cyl(f"b_{i}", 0.012, 0.32, (math.cos(a) * 0.03, -0.25,
                                                       math.sin(a) * 0.03),
                              m["steel"], rot=(math.pi / 2, 0, 0), verts=8))
        muzzles = [(0, -0.42, 0)]
    elif kind == "missile":
        # "Atlas": heavy walker carrying twin six-cell missile pods.
        hull_z, legs, upper, lower, heavy = 0.46, 4, 0.36, 0.46, 1.4
        hull = [
            box("h_core", (0.24, 0.27, 0.11), (0, 0, 0), m["paint"], bevel=0.035,
                taper=(0.9, 0.85)),
            box("h_cab", (0.12, 0.08, 0.06), (0, -0.25, -0.02), m["metal"], bevel=0.02),
            box("h_vis", (0.09, 0.012, 0.02), (0, -0.33, -0.01), m["glow"], bevel=0),
            box("h_haz_l", (0.02, 0.2, 0.02), (0.24, 0, 0.09), m["hazard"], bevel=0.004),
            box("h_haz_r", (0.02, 0.2, 0.02), (-0.24, 0, 0.09), m["hazard"], bevel=0.004),
            box("h_reactor", (0.1, 0.07, 0.06), (0, 0.27, 0.02), m["metal"], bevel=0.02),
            box("h_core_glow", (0.06, 0.012, 0.03), (0, 0.34, 0.02), m["glow"], bevel=0),
            *vents("h_vt", m, (0.12, 0.12, 0.112), 4, 0.03, (0.04, 0.008, 0.006)),
            *vents("h_vt2", m, (-0.12, 0.12, 0.112), 4, 0.03, (0.04, 0.008, 0.006)),
            box("h_spine", (0.03, 0.22, 0.012), (0, 0, 0.116), m["metal"], bevel=0.004),
            *bolts("h_bolt", m, [(0.2, -0.22, 0.09), (-0.2, -0.22, 0.09), (0.2, 0.22, 0.09),
                                 (-0.2, 0.22, 0.09)], radius=0.01),
            cyl("h_ant", 0.006, 0.22, (-0.17, 0.24, 0.2), m["steel"], verts=6),
            sphere("h_ant_tip", 0.013, (-0.17, 0.24, 0.31), m["optic"]),
        ]
        hips = [(0.21, -0.17), (-0.21, -0.17), (0.21, 0.17), (-0.21, 0.17)]
        turret = [
            cyl("t_ring", 0.12, 0.05, (0, 0, 0.06), m["metal"], verts=24),
            box("t_spine", (0.06, 0.12, 0.06), (0, 0, 0.13), m["metal"], bevel=0.02),
            box("t_eye", (0.05, 0.01, 0.015), (0, -0.125, 0.15), m["optic"], bevel=0),
        ]
        barrel_mount = (0, 0.0, 0.16)
        barrel = []
        muzzles = []
        for side in (1, -1):
            px = side * 0.15
            barrel.append(box(f"b_pod{side}", (0.085, 0.16, 0.075), (px, -0.03, 0), m["paint"],
                              bevel=0.02))
            barrel.append(box(f"b_face{side}", (0.075, 0.012, 0.065), (px, -0.19, 0), m["metal"],
                              bevel=0.006))
            for r in range(2):
                for c in range(3):
                    cx = px + (c - 1) * 0.048
                    cz = (r - 0.5) * 0.06
                    barrel.append(cyl(f"b_cell{side}{r}{c}", 0.019, 0.02, (cx, -0.2, cz),
                                      m["dark"], rot=(math.pi / 2, 0, 0), verts=10))
                    barrel.append(cyl(f"b_tip{side}{r}{c}", 0.013, 0.025, (cx, -0.205, cz),
                                      m["hazard"], rot=(math.pi / 2, 0, 0), verts=8,
                                      radius2=0.004))
            muzzles.append((px, -0.22, 0))
    else:
        raise ValueError(kind)

    # Hull is authored around its pivot at the origin, then placed at hull height.
    hull_obj = join("Hull", hull)
    turret_obj = join("Turret", turret)
    barrel_obj = join("Barrel", barrel)
    leg_parts(m, upper, lower, heavy)

    empty("TurretMount", (0, 0, 0.05 if kind != "auto" else 0.06))
    empty("BarrelMount", barrel_mount)
    for i, muzzle in enumerate(muzzles):
        mz = (muzzle[0] - barrel_mount[0], muzzle[1] - barrel_mount[1], muzzle[2] - barrel_mount[2])
        empty(f"Muzzle{i}", mz)
    # Barrel geometry is authored in turret space; shift it so the BarrelMount is
    # its origin (recoil slides it along its own forward axis).
    set_origin(barrel_obj, barrel_mount)
    barrel_obj.location = (0, 0, 0)
    hip_sockets(0.0, hips)

    # Rig metrics travel as an extra-free empty name so the runtime needs no
    # hand-maintained table: Rig_<hullHeight>_<upper>_<lower> (millitiles).
    empty(f"Rig_{int(hull_z * 1000)}_{int(upper * 1000)}_{int(lower * 1000)}", (0, 0, 0))
    del hull_obj, turret_obj
    export(os.path.join(OUT_DIR, "robots", f"{kind}.glb"))


# --------------------------------------------------------------------------
# Arena props. Each prop sits on a 1x1 tile centred at the origin, ground z=0.


def arena_materials():
    return {
        "concrete": material("Concrete", (0.26, 0.25, 0.23), roughness=0.85),
        "concrete_dark": material("ConcreteDark", (0.16, 0.16, 0.16), roughness=0.9),
        "brick": material("Brick", (0.32, 0.12, 0.08), roughness=0.82),
        "rebar": material("Rebar", (0.25, 0.14, 0.08), metallic=0.8, roughness=0.6),
        "steel": material("ArenaSteel", (0.2, 0.21, 0.23), metallic=0.9, roughness=0.35),
        "hazard": material("ArenaHazard", (0.95, 0.6, 0.06), roughness=0.5),
        "leaf": material("Foliage", (0.13, 0.32, 0.1), roughness=0.75),
        "leaf_light": material("FoliageLight", (0.3, 0.48, 0.14), roughness=0.7),
        "bark": material("Bark", (0.2, 0.13, 0.08), roughness=0.9),
        "rock": material("Rock", (0.24, 0.22, 0.2), roughness=0.92),
        "wood": material("CrateWood", (0.3, 0.2, 0.11), roughness=0.8),
        "glow": material("ArenaGlow", (0.4, 0.85, 1.0), emission=(0.3, 0.85, 1.0), strength=5.0),
        "sandbag": material("Sandbag", (0.3, 0.26, 0.18), roughness=0.95),
        "seat_glow": material("SeatGlow", (1.0, 0.6, 0.25), emission=(1.0, 0.55, 0.2), strength=0.35),
        "capstone": material("CapStone", (0.105, 0.1, 0.095), roughness=0.95),
        "ribbon": material("RibbonLED", (1.0, 0.45, 0.12), emission=(1.0, 0.42, 0.1), strength=1.6),
        "canopy_light": material("CanopyLight", (1.0, 0.93, 0.8), emission=(1.0, 0.92, 0.78), strength=2.2),
        "crowd": [material(f"Crowd{i}", c, roughness=0.85) for i, c in enumerate([
            (0.42, 0.08, 0.06), (0.08, 0.16, 0.42), (0.5, 0.42, 0.12), (0.12, 0.3, 0.12),
            (0.35, 0.33, 0.3), (0.06, 0.06, 0.07), (0.45, 0.2, 0.05), (0.22, 0.1, 0.3)])],
        "skin": material("CrowdHead", (0.36, 0.27, 0.2), roughness=0.7),
        "banners": [material(f"Banner{i}", c, roughness=0.8) for i, c in enumerate([
            (0.62, 0.08, 0.06), (0.06, 0.2, 0.62), (0.08, 0.42, 0.14), (0.72, 0.5, 0.06)])],
    }


def jitter_mesh(obj, amount: float, seed: int) -> None:
    """Deterministic vertex jitter so rubble does not read as perfect boxes."""
    import random

    rnd = random.Random(seed)
    for v in obj.data.vertices:
        v.co.x += rnd.uniform(-amount, amount)
        v.co.y += rnd.uniform(-amount, amount)
        v.co.z += rnd.uniform(-amount, amount) * 0.6


def build_arena() -> None:
    reset_scene()
    m = arena_materials()
    objects: list[bpy.types.Object] = []
    import random

    # Wall: a ruined brick-and-concrete block with exposed rebar.
    rnd = random.Random(7)
    parts = [box("w_base", (0.5, 0.5, 0.08), (0, 0, 0.08), m["concrete_dark"], bevel=0.02)]
    for row in range(4):
        offset = 0.125 if row % 2 else 0.0
        for col in range(4):
            x = -0.375 + col * 0.25 + offset
            if x > 0.42:
                continue
            h = 0.16 + row * 0.15
            if row == 3 and rnd.random() < 0.35:
                continue
            parts.append(box(f"w_b{row}{col}", (0.118, 0.47, 0.068), (x, 0, h), m["brick"],
                             bevel=0.012, rot=(0, 0, rnd.uniform(-0.02, 0.02))))
    # Broken capstones: two weathered slabs with a gap and a tilted, chipped end.
    parts.append(box("w_cap0", (0.27, 0.5, 0.04), (-0.23, 0, 0.7), m["capstone"], bevel=0.018))
    parts.append(box("w_cap1", (0.19, 0.48, 0.035), (0.29, -0.01, 0.695), m["capstone"],
                     bevel=0.018, rot=(0.05, -0.06, 0.03)))
    for i in range(3):
        parts.append(box(f"w_chip{i}", (0.035, 0.03, 0.02),
                         (rnd.uniform(-0.4, 0.4), rnd.uniform(-0.4, 0.4), 0.755),
                         m["capstone"], bevel=0.008, rot=(0, 0, rnd.uniform(0, 3))))
    objects.append(join("Wall", parts))

    # Low wall: a sandbag-topped concrete barrier, crouch-height.
    parts = [box("lw_base", (0.48, 0.3, 0.17), (0, 0, 0.17), m["concrete"], bevel=0.04,
                 taper=(1.0, 0.7))]
    for i in range(5):
        bag = sphere(f"lw_bag{i}", 0.11, (-0.4 + i * 0.2, 0, 0.38), m["sandbag"],
                     scale=(1.0, 1.2, 0.5), subdiv=2)
        parts.append(bag)
    parts.append(box("lw_haz", (0.49, 0.302, 0.025), (0, 0, 0.08), m["hazard"], bevel=0.005,
                     taper=(1.0, 0.9)))
    objects.append(join("LowWall", parts))

    # Outer wall: armoured arena barrier with a light strip on its inner face.
    parts = [
        box("ow_core", (0.5, 0.5, 0.7), (0, 0, 0.7), m["steel"], bevel=0.02),
        box("ow_cap", (0.52, 0.52, 0.04), (0, 0, 1.42), m["concrete_dark"], bevel=0.01),
        box("ow_rib", (0.06, 0.52, 0.66), (0, 0, 0.7), m["concrete_dark"], bevel=0.01),
        box("ow_haz", (0.51, 0.51, 0.04), (0, 0, 0.12), m["hazard"], bevel=0.004),
        box("ow_light", (0.44, 0.515, 0.012), (0, 0, 1.25), m["glow"], bevel=0),
    ]
    objects.append(join("OuterWall", parts))

    # Bush: clustered faceted foliage around a short trunk.
    parts = [cyl("b_trunk", 0.04, 0.2, (0, 0, 0.1), m["bark"], verts=6)]
    rnd = random.Random(3)
    for i in range(9):
        a = rnd.uniform(0, 2 * math.pi)
        r = rnd.uniform(0.05, 0.25)
        s = rnd.uniform(0.13, 0.22)
        leaf = sphere(f"b_leaf{i}", s, (math.cos(a) * r, math.sin(a) * r, 0.18 + rnd.uniform(0, 0.22)),
                      m["leaf"] if i % 3 else m["leaf_light"], subdiv=1)
        parts.append(leaf)
    obj = join("Bush", parts)
    jitter_mesh(obj, 0.025, 11)
    objects.append(obj)

    # Rough-ground rubble chunks (three variants, instanced randomly at runtime).
    for v in range(3):
        rnd = random.Random(20 + v)
        parts = []
        for i in range(5):
            s = rnd.uniform(0.05, 0.12)
            parts.append(box(f"r{v}_{i}", (s, s * rnd.uniform(0.7, 1.3), s * 0.6),
                             (rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), s * 0.4),
                             m["rock"] if i % 2 else m["concrete"], bevel=0.015,
                             rot=(rnd.uniform(-0.4, 0.4), rnd.uniform(-0.4, 0.4),
                                  rnd.uniform(0, 3))))
        obj = join(f"Rubble{v}", parts)
        jitter_mesh(obj, 0.012, 30 + v)
        objects.append(obj)

    # Crate prop.
    parts = [box("c_body", (0.2, 0.2, 0.2), (0, 0, 0.2), m["wood"], bevel=0.015)]
    for sx in (-1, 1):
        parts.append(box(f"c_band{sx}", (0.21, 0.025, 0.21), (0, sx * 0.13, 0.2), m["steel"],
                         bevel=0.004))
    objects.append(join("Crate", parts))

    # Floodlight tower for the stadium dressing beyond the outer wall.
    parts = [
        cyl("ft_pole", 0.08, 4.0, (0, 0, 2.0), m["steel"], verts=8),
        box("ft_frame", (0.6, 0.08, 0.35), (0, 0, 4.1), m["steel"], bevel=0.01),
    ]
    for i in range(4):
        parts.append(box(f"ft_lamp{i}", (0.12, 0.05, 0.12), (-0.42 + i * 0.28, -0.1, 4.1),
                         m["glow"], bevel=0.01))
    objects.append(join("FloodTower", parts))

    # Grandstand section: tiered seating packed with a crowd, an LED ribbon board
    # on the front rail, team banners on the back wall and a lit canopy above.
    parts = []
    crowd_rnd = random.Random(99)
    for tier in range(5):
        top = 0.24 + tier * 0.4
        parts.append(box(f"gs_t{tier}", (2.0, 0.3, 0.12 + tier * 0.2),
                         (0, tier * 0.6, 0.12 + tier * 0.2), m["concrete_dark"], bevel=0.02))
        parts.append(box(f"gs_s{tier}", (1.9, 0.04, 0.02),
                         (0, tier * 0.6 - 0.27, top + 0.01), m["seat_glow"], bevel=0))
        for seat in range(17):
            if crowd_rnd.random() < 0.18:
                continue
            x = -1.84 + seat * 0.23 + crowd_rnd.uniform(-0.03, 0.03)
            y = tier * 0.6 - 0.08 + crowd_rnd.uniform(-0.03, 0.03)
            lean = crowd_rnd.uniform(-0.12, 0.12)
            shirt = m["crowd"][crowd_rnd.randrange(len(m["crowd"]))]
            parts.append(box(f"gs_p{tier}_{seat}", (0.07, 0.05, 0.1), (x, y, top + 0.1), shirt,
                             bevel=0.02, rot=(lean, 0, crowd_rnd.uniform(-0.2, 0.2))))
            parts.append(sphere(f"gs_h{tier}_{seat}", 0.052, (x, y - 0.01, top + 0.25),
                                m["skin"], subdiv=1))
            if crowd_rnd.random() < 0.22:  # an arm or a flag raised in the air
                parts.append(box(f"gs_a{tier}_{seat}", (0.018, 0.018, 0.1),
                                 (x + 0.06, y, top + 0.33), shirt, bevel=0.006,
                                 rot=(0, crowd_rnd.uniform(-0.4, 0.4), 0)))
    parts.append(box("gs_rail", (2.0, 0.025, 0.1), (0, -0.3, 0.26), m["concrete_dark"], bevel=0.008))
    parts.append(box("gs_ribbon", (1.98, 0.006, 0.055), (0, -0.327, 0.27), m["ribbon"], bevel=0))
    parts.append(box("gs_back", (2.0, 0.08, 1.3), (0, 2.98, 1.3), m["concrete_dark"], bevel=0.02))
    for i in range(6):
        x = -1.6 + i * 0.64
        parts.append(box(f"gs_banner{i}", (0.16, 0.008, 0.36), (x, 2.89, 2.0),
                         m["banners"][i % 4], bevel=0, rot=(0.04, 0, 0)))
        parts.append(box(f"gs_bpole{i}", (0.19, 0.012, 0.012), (x, 2.885, 2.37), m["steel"], bevel=0))
    parts.append(box("gs_canopy", (2.05, 0.9, 0.03), (0, 2.25, 2.62), m["steel"], bevel=0.01,
                     rot=(-0.12, 0, 0)))
    for i in range(5):
        parts.append(box(f"gs_clight{i}", (0.14, 0.04, 0.008), (-1.6 + i * 0.8, 1.55, 2.53),
                         m["canopy_light"], bevel=0, rot=(-0.12, 0, 0)))
    objects.append(join("Grandstand", parts))

    # Lay props out in a row so the file previews sensibly; the runtime reads them
    # by name and resets each to the origin.
    for i, obj in enumerate(objects):
        obj.location = (i * 1.5, 0, 0)
    export(os.path.join(OUT_DIR, "arena", "props-coliseum.glb"))


def layout_and_export(objects, name: str) -> None:
    for i, obj in enumerate(objects):
        obj.location = (i * 1.5, 0, 0)
    export(os.path.join(OUT_DIR, "arena", f"props-{name}.glb"))


def torus(name, major, minor, loc, mat, rot=(0.0, 0.0, 0.0), segments=24, rings=10):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor,
                                     major_segments=segments, minor_segments=rings,
                                     location=loc, rotation=rot)
    obj = bpy.context.active_object
    obj.name = name
    return finish(obj, mat, 0)


def edge_strips(prefix, half, top, mat, thickness=0.012):
    """Emissive trims along the four top edges of a box footprint."""
    hx, hy = half
    return [
        box(f"{prefix}_n", (hx, thickness, thickness), (0, -hy, top), mat, bevel=0),
        box(f"{prefix}_s", (hx, thickness, thickness), (0, hy, top), mat, bevel=0),
        box(f"{prefix}_e", (thickness, hy, thickness), (hx, 0, top), mat, bevel=0),
        box(f"{prefix}_w", (thickness, hy, thickness), (-hx, 0, top), mat, bevel=0),
    ]


def build_arena_neon() -> None:
    """Neon Grid: obsidian monoliths with light-trim edges and data crystals."""
    reset_scene()
    import random

    body = material("NeonBody", (0.018, 0.022, 0.034), metallic=0.7, roughness=0.22)
    panel = material("NeonPanel", (0.04, 0.05, 0.08), metallic=0.8, roughness=0.3)
    cyan = material("NeonCyan", (0.2, 0.9, 1.0), emission=(0.15, 0.85, 1.0), strength=1.4)
    magenta = material("NeonMagenta", (1.0, 0.2, 0.8), emission=(1.0, 0.15, 0.75), strength=1.4)
    amber = material("NeonAmber", (1.0, 0.6, 0.1), emission=(1.0, 0.55, 0.1), strength=1.4)
    crystal = material("NeonCrystal", (0.25, 0.95, 0.85), metallic=0.1, roughness=0.1,
                       emission=(0.1, 0.7, 0.6), strength=0.9)
    objects = []

    parts = [box("w_core", (0.47, 0.47, 0.36), (0, 0, 0.36), body, bevel=0.025)]
    parts += [box("w_inset", (0.4, 0.475, 0.22), (0, 0, 0.34), panel, bevel=0.01)]
    parts += edge_strips("w_trim", (0.47, 0.47), 0.725, cyan)
    parts += [box("w_seam", (0.006, 0.476, 0.2), (0, 0, 0.34), cyan, bevel=0)]
    objects.append(join("Wall", parts))

    parts = [box("lw_core", (0.47, 0.22, 0.17), (0, 0, 0.17), body, bevel=0.03, taper=(1.0, 0.8))]
    parts += [box("lw_strip", (0.47, 0.012, 0.012), (0, 0, 0.345), magenta, bevel=0)]
    parts += [box("lw_foot", (0.48, 0.24, 0.01), (0, 0, 0.012), magenta, bevel=0)]
    objects.append(join("LowWall", parts))

    parts = [box("ow_core", (0.5, 0.5, 0.65), (0, 0, 0.65), body, bevel=0.015)]
    parts += edge_strips("ow_trim", (0.5, 0.5), 1.31, magenta)
    parts += [box("ow_mid", (0.505, 0.505, 0.01), (0, 0, 0.6), cyan, bevel=0)]
    objects.append(join("OuterWall", parts))

    rnd = random.Random(5)
    parts = [cyl("b_base", 0.22, 0.04, (0, 0, 0.02), body, verts=6)]
    for i in range(5):
        a = rnd.uniform(0, 2 * math.pi)
        r = rnd.uniform(0.0, 0.14)
        h = rnd.uniform(0.25, 0.55)
        shard = cyl(f"b_c{i}", rnd.uniform(0.04, 0.07), h, (math.cos(a) * r, math.sin(a) * r, h / 2),
                    crystal, verts=6, radius2=0.0,
                    rot=(rnd.uniform(-0.35, 0.35), rnd.uniform(-0.35, 0.35), 0))
        parts.append(shard)
    objects.append(join("Bush", parts))

    for v in range(3):
        rnd = random.Random(40 + v)
        parts = []
        for i in range(4):
            sz = rnd.uniform(0.04, 0.1)
            parts.append(box(f"r{v}_{i}", (sz, sz, sz * 0.5),
                             (rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), sz * 0.5),
                             body, bevel=0.01, rot=(0, 0, rnd.uniform(0, 3))))
        for i in range(3):
            parts.append(cyl(f"r{v}_s{i}", 0.018, 0.12, (rnd.uniform(-0.3, 0.3),
                                                          rnd.uniform(-0.3, 0.3), 0.04),
                             cyan if i % 2 else amber, verts=5, radius2=0.0,
                             rot=(rnd.uniform(0.6, 1.4), 0, rnd.uniform(0, 6))))
        objects.append(join(f"Rubble{v}", parts))

    parts = [box("c_body", (0.18, 0.18, 0.18), (0, 0, 0.18), panel, bevel=0.015)]
    parts += [box("c_band", (0.185, 0.185, 0.012), (0, 0, 0.24), amber, bevel=0)]
    objects.append(join("Crate", parts))

    parts = [cyl("ft_pole", 0.06, 4.2, (0, 0, 2.1), body, verts=8)]
    for i in range(3):
        parts.append(torus(f"ft_ring{i}", 0.3 - i * 0.06, 0.018, (0, 0, 3.6 + i * 0.35),
                           magenta if i % 2 else cyan))
    parts.append(box("ft_frame", (0.6, 0.08, 0.3), (0, 0, 4.4), body, bevel=0.01))
    for i in range(4):
        parts.append(box(f"ft_lamp{i}", (0.12, 0.05, 0.1), (-0.42 + i * 0.28, -0.1, 4.4), cyan,
                         bevel=0.01))
    objects.append(join("FloodTower", parts))

    parts = []
    for tier in range(5):
        parts.append(box(f"gs_t{tier}", (2.0, 0.3, 0.12 + tier * 0.2),
                         (0, tier * 0.6, 0.12 + tier * 0.2), body, bevel=0.02))
        parts.append(box(f"gs_s{tier}", (1.95, 0.01, 0.01),
                         (0, tier * 0.6 - 0.3, 0.24 + tier * 0.4), magenta if tier % 2 else cyan,
                         bevel=0))
    objects.append(join("Grandstand", parts))
    layout_and_export(objects, "neon")


def build_arena_scrapyard() -> None:
    """Scrapyard Sunset: rusted container walls, tyre stacks, cacti and scrap."""
    reset_scene()
    import random

    rust = material("Rust", (0.34, 0.14, 0.06), metallic=0.55, roughness=0.75)
    paint_teal = material("ContainerTeal", (0.13, 0.33, 0.33), metallic=0.4, roughness=0.65)
    paint_orange = material("ContainerOrange", (0.55, 0.22, 0.06), metallic=0.4, roughness=0.6)
    steel = material("ScrapSteel", (0.32, 0.31, 0.3), metallic=0.85, roughness=0.45)
    rubber = material("Tyre", (0.03, 0.03, 0.03), roughness=0.9)
    cactus = material("Cactus", (0.2, 0.33, 0.13), roughness=0.75)
    wood = material("DryWood", (0.36, 0.25, 0.14), roughness=0.9)
    sand = material("SandStone", (0.55, 0.42, 0.28), roughness=0.95)
    drum = material("DrumRed", (0.55, 0.12, 0.06), metallic=0.5, roughness=0.5)
    lamp = material("SodiumLamp", (1.0, 0.7, 0.35), emission=(1.0, 0.65, 0.3), strength=6.0)
    objects = []

    # Wall: a cut shipping-container section with corrugated sides.
    for variant, paint in ((0, paint_teal), (1, paint_orange)):
        rnd = random.Random(60 + variant)
        parts = [box("w_frame", (0.48, 0.48, 0.34), (0, 0, 0.36), paint, bevel=0.01)]
        for i in range(9):
            x = -0.42 + i * 0.105
            parts.append(box(f"w_rib_n{i}", (0.022, 0.012, 0.32), (x, -0.485, 0.36), paint,
                             bevel=0.004))
            parts.append(box(f"w_rib_s{i}", (0.022, 0.012, 0.32), (x, 0.485, 0.36), paint,
                             bevel=0.004))
        for z in (0.03, 0.7):
            parts.append(box(f"w_rail{z}", (0.5, 0.5, 0.025), (0, 0, z), rust, bevel=0.004))
        for i in range(5):
            parts.append(box(f"w_patch{i}", (rnd.uniform(0.04, 0.12), 0.006, rnd.uniform(0.03, 0.1)),
                             (rnd.uniform(-0.35, 0.35), -0.5 if i % 2 else 0.5,
                              rnd.uniform(0.15, 0.6)), rust, bevel=0))
        objects.append(join("Wall" if variant == 0 else "WallB", parts))

    # Low wall: stacked tyres on a sandbag base.
    parts = [box("lw_base", (0.46, 0.2, 0.06), (0, 0, 0.06), sand, bevel=0.03)]
    for i in range(3):
        for j in range(2):
            parts.append(torus(f"lw_t{i}{j}", 0.13, 0.055, (-0.3 + i * 0.3, 0, 0.17 + j * 0.11),
                               rubber))
    objects.append(join("LowWall", parts))

    parts = [box("ow_core", (0.5, 0.5, 0.6), (0, 0, 0.6), rust, bevel=0.01)]
    for i in range(10):
        parts.append(box(f"ow_rib{i}", (0.02, 0.51, 0.58), (-0.45 + i * 0.1, 0, 0.6), rust,
                         bevel=0.004))
    parts.append(box("ow_cap", (0.52, 0.52, 0.03), (0, 0, 1.22), steel, bevel=0.006))
    objects.append(join("OuterWall", parts))

    # "Bush": a desert saguaro with a dry shrub at its foot.
    parts = [cyl("b_trunk", 0.07, 0.55, (0, 0, 0.275), cactus, verts=10),
             sphere("b_top", 0.07, (0, 0, 0.55), cactus)]
    for side in (1, -1):
        parts.append(cyl(f"b_arm{side}", 0.045, 0.14, (side * 0.11, 0, 0.25), cactus, verts=8,
                         rot=(0, math.pi / 2, 0)))
        parts.append(cyl(f"b_up{side}", 0.045, 0.18, (side * 0.17, 0, 0.33), cactus, verts=8))
        parts.append(sphere(f"b_tip{side}", 0.045, (side * 0.17, 0, 0.42), cactus))
    rnd = random.Random(9)
    for i in range(7):
        a = rnd.uniform(0, 6.28)
        parts.append(cyl(f"b_twig{i}", 0.008, 0.2, (0.15 + math.cos(a) * 0.08, math.sin(a) * 0.08 + 0.12,
                                                    0.07), wood, verts=4,
                         rot=(rnd.uniform(-0.8, 0.8), rnd.uniform(-0.8, 0.8), 0)))
    objects.append(join("Bush", parts))

    # Rough ground: scrap heaps (bent plates, pipes and a cog).
    for v in range(3):
        rnd = random.Random(80 + v)
        parts = []
        for i in range(3):
            parts.append(box(f"r{v}_p{i}", (rnd.uniform(0.08, 0.14), rnd.uniform(0.06, 0.1), 0.008),
                             (rnd.uniform(-0.28, 0.28), rnd.uniform(-0.28, 0.28), 0.03),
                             rust if i % 2 else steel, bevel=0.002,
                             rot=(rnd.uniform(-0.5, 0.5), rnd.uniform(-0.5, 0.5), rnd.uniform(0, 3))))
        parts.append(cyl(f"r{v}_pipe", 0.025, 0.3, (rnd.uniform(-0.2, 0.2), rnd.uniform(-0.2, 0.2),
                                                     0.03), steel, verts=10,
                         rot=(math.pi / 2, 0, rnd.uniform(0, 3))))
        cog_at = (rnd.uniform(-0.25, 0.25), rnd.uniform(-0.25, 0.25), 0.012)
        parts.append(cyl(f"r{v}_cog", 0.07, 0.02, cog_at, rust, verts=16))
        for t in range(8):
            a = t * math.pi / 4
            parts.append(box(f"r{v}_tooth{t}", (0.015, 0.012, 0.01),
                             (cog_at[0] + math.cos(a) * 0.08, cog_at[1] + math.sin(a) * 0.08, 0.012),
                             rust, bevel=0, rot=(0, 0, a)))
        objects.append(join(f"Rubble{v}", parts))

    parts = [cyl("c_drum", 0.13, 0.36, (0, 0, 0.18), drum, verts=18)]
    for z in (0.1, 0.26):
        parts.append(torus(f"c_rim{z}", 0.13, 0.008, (0, 0, z), steel, segments=24, rings=6))
    objects.append(join("Crate", parts))

    parts = [cyl("ft_pole", 0.07, 4.0, (0, 0, 2.0), wood, verts=8),
             box("ft_arm", (0.5, 0.04, 0.04), (0, 0, 3.9), steel, bevel=0.005)]
    for i in range(3):
        parts.append(box(f"ft_lamp{i}", (0.09, 0.07, 0.06), (-0.35 + i * 0.35, -0.04, 3.82), lamp,
                         bevel=0.01))
    objects.append(join("FloodTower", parts))

    # Backdrop: stacked containers instead of stands.
    parts = []
    rnd = random.Random(99)
    for i in range(4):
        for level in range(rnd.randint(1, 3)):
            paint = (paint_teal, paint_orange, rust)[(i + level) % 3]
            parts.append(box(f"gs_c{i}{level}", (0.48, 0.3, 0.3),
                             (-1.5 + i * 1.0, rnd.uniform(-0.1, 0.3), 0.3 + level * 0.6), paint,
                             bevel=0.01, rot=(0, 0, rnd.uniform(-0.08, 0.08))))
    objects.append(join("Grandstand", parts))
    layout_and_export(objects, "scrapyard")


def main() -> None:
    for kind in ("rifle", "burst", "auto", "missile"):
        build_robot(kind)
    build_arena()
    build_arena_neon()
    build_arena_scrapyard()


if __name__ == "__main__":
    main()
    sys.exit(0)
