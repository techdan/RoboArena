import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { instanceRigidParts, teamMaterials } from "./models.js";

describe("robot material ownership", () => {
  it("releases per-robot clones without disposing the shared model materials", () => {
    const paint = new THREE.MeshStandardMaterial();
    paint.name = "TeamPaint";
    const shared = new THREE.MeshStandardMaterial();
    const materials = teamMaterials("red");
    const resolved = materials.resolve(paint);
    expect(materials.resolve(paint)).toBe(resolved);
    expect(materials.resolve(shared)).toBe(shared);
    const releaseClone = vi.spyOn(resolved, "dispose");
    const releaseCharred = vi.spyOn(materials.charred, "dispose");
    const releaseOriginal = vi.spyOn(paint, "dispose");
    const releaseShared = vi.spyOn(shared, "dispose");
    materials.dispose();
    expect(releaseClone).toHaveBeenCalledOnce();
    expect(releaseCharred).toHaveBeenCalledOnce();
    expect(releaseOriginal).not.toHaveBeenCalled();
    expect(releaseShared).not.toHaveBeenCalled();
  });
});

describe("rigid part instancing", () => {
  it("preserves geometry and animated joint transforms and follows material changes", () => {
    const root = new THREE.Group();
    root.position.set(3, 4, 5);
    root.scale.setScalar(2);
    const joint = new THREE.Group();
    joint.rotation.y = 0.7;
    root.add(joint);
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshStandardMaterial();
    const first = new THREE.Mesh(geometry, material);
    const second = new THREE.Mesh(geometry, material);
    first.position.x = -2;
    second.position.x = 2;
    joint.add(first, second);
    const batch = instanceRigidParts(root);
    const mesh = root.children.find(
      (child) => child instanceof THREE.InstancedMesh,
    ) as THREE.InstancedMesh;
    expect(mesh.count).toBe(2);
    expect(mesh.geometry).toBe(geometry);
    expect(first.visible).toBe(false);
    for (const angle of [0.7, 1.4]) {
      joint.rotation.y = angle;
      batch.update();
      const matrix = new THREE.Matrix4();
      mesh.getMatrixAt(0, matrix);
      matrix.premultiply(root.matrixWorld);
      matrix.elements.forEach((value, index) =>
        expect(value).toBeCloseTo(first.matrixWorld.elements[index]!, 5),
      );
    }
    first.material = new THREE.MeshStandardMaterial({ color: 0x111111 });
    batch.update();
    expect(mesh.material).toBe(first.material);
    const releaseGeometry = vi.spyOn(geometry, "dispose");
    const releaseInstances = vi.spyOn(mesh, "dispose");
    batch.dispose();
    expect(releaseInstances).toHaveBeenCalledOnce();
    expect(releaseGeometry).not.toHaveBeenCalled();
  });

  it("keeps transparent pieces separate for depth sorting", () => {
    const root = new THREE.Group();
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshBasicMaterial({ transparent: true });
    root.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
    instanceRigidParts(root);
    expect(
      root.children.every((child) => child.visible && !(child instanceof THREE.InstancedMesh)),
    ).toBe(true);
  });
});
