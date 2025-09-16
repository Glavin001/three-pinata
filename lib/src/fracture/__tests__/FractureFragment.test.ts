import * as THREE from "three";
import { fracture } from "../../fracture/Fracture";
import { FractureOptions } from "../../entities/FractureOptions";
import { Vector3 as PinataVector3 } from "../../utils/Vector3";

describe("Voronoi fracture patterns", () => {
  const baseGeometry = new THREE.BoxGeometry(1.5, 1.5, 1.5, 6, 6, 6);

  it("limits fragments to the requested fragment count", () => {
    const options = new FractureOptions({
      fragmentCount: 6,
      pattern: {
        type: "Voronoi",
        distribution: "uniform",
        seedCount: 18,
      },
    });

    const fragments = fracture(baseGeometry, options);
    expect(fragments.length).toBeGreaterThan(0);
    expect(fragments.length).toBeLessThanOrEqual(6);
  });

  it("creates a fragment per Voronoi seed when possible", () => {
    const seedCount = 8;
    const options = new FractureOptions({
      fragmentCount: 12,
      pattern: {
        type: "Voronoi",
        distribution: "clustered",
        seedCount,
        clusterCount: 3,
        clusterJitter: 0.2,
      },
    });

    const fragments = fracture(baseGeometry, options);
    expect(fragments.length).toBe(seedCount);
  });

  it("supports anisotropic grain-aligned shards", () => {
    const seedCount = 5;
    const options = new FractureOptions({
      fragmentCount: seedCount,
      pattern: {
        type: "Voronoi",
        distribution: "anisotropic",
        seedCount,
        anisotropyStrength: 4,
        grainDirection: new PinataVector3(0, 1, 0),
      },
    });

    const elongated = fracture(baseGeometry, options);
    expect(elongated.length).toBe(seedCount);

    const uniformOptions = new FractureOptions({
      fragmentCount: seedCount,
      pattern: {
        type: "Voronoi",
        distribution: "uniform",
        seedCount,
      },
    });

    const uniform = fracture(baseGeometry, uniformOptions);

    const averageHeight = (geometries: THREE.BufferGeometry[]) => {
      return (
        geometries.reduce((acc, geometry) => {
          geometry.computeBoundingBox();
          const size = new THREE.Vector3();
          geometry.boundingBox?.getSize(size);
          return acc + size.y;
        }, 0) / geometries.length
      );
    };

    const anisotropicHeight = averageHeight(elongated);
    const uniformHeight = averageHeight(uniform);

    expect(anisotropicHeight).toBeGreaterThan(uniformHeight);
  });
});
