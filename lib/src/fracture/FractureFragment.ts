import {
  FractureOptions,
  VoronoiPatternOptions,
} from "../entities/FractureOptions";
import { Fragment } from "../entities/Fragment";
import { sliceFragment } from "./SliceFragment";
import { UnionFind } from "../utils/UnionFind";
import { Vector3 } from "../utils/Vector3";
import { hash3 } from "../utils/MathUtils";

/**
 * Takes in raw geometry data and fractures it into multiple fragments
 * @param positions The positions of the vertices
 * @param normals The normals of the vertices
 * @param uvs The uvs of the vertices
 * @param indices The indices of the vertices
 * @param options Options for fracturing
 */
export function fractureRawData(
  positions: Float32Array,
  normals: Float32Array,
  uvs: Float32Array,
  indices: Uint32Array,
  options: FractureOptions,
): Fragment[] {
  const fragment = new Fragment({
    positions,
    normals,
    uvs,
    indices,
  });

  return fractureFragment(fragment, options);
}

/**
 * Fractures a single fragment into multiple fragments
 * @param fragment The fragment to fracture
 * @param options Options for fracturing
 */
export function fractureFragment(
  fragment: Fragment,
  options: FractureOptions,
): Fragment[] {
  if (options.pattern.type === "Voronoi") {
    fragment.calculateBounds();
    return fractureFragmentVoronoi(fragment, options);
  }

  return fractureFragmentRandom(fragment, options);
}

function fractureFragmentRandom(
  fragment: Fragment,
  options: FractureOptions,
): Fragment[] {
  const fragments: Fragment[] = [fragment];

  while (fragments.length < options.fragmentCount) {
    const current = fragments.shift();
    if (!current) {
      break;
    }

    current.calculateBounds();

    const normal = new Vector3(
      options.fracturePlanes.x ? 2.0 * Math.random() - 1 : 0,
      options.fracturePlanes.y ? 2.0 * Math.random() - 1 : 0,
      options.fracturePlanes.z ? 2.0 * Math.random() - 1 : 0,
    ).normalize();

    const center = new Vector3();
    current.bounds.getCenter(center);

    if (options.fractureMode === "Non-Convex") {
      const { topSlice, bottomSlice } = sliceFragment(
        current,
        normal,
        center,
        options.textureScale,
        options.textureOffset,
        false,
      );

      const topFragments = findIsolatedGeometry(topSlice);
      const bottomFragments = findIsolatedGeometry(bottomSlice);

      fragments.push(...topFragments, ...bottomFragments);
    } else {
      const { topSlice, bottomSlice } = sliceFragment(
        current,
        normal,
        center,
        options.textureScale,
        options.textureOffset,
        true,
      );

      fragments.push(topSlice, bottomSlice);
    }

    if (fragments.length === 0) {
      break;
    }
  }

  return fragments;
}

type SeedFragmentAssignment = {
  seedIndex: number;
  fragment: Fragment;
};

type AnisotropyConfig = {
  basis: [Vector3, Vector3, Vector3];
  strength: number;
};

function fractureFragmentVoronoi(
  fragment: Fragment,
  options: FractureOptions,
): Fragment[] {
  const pattern = options.pattern as VoronoiPatternOptions;
  const targetCount = Math.max(
    1,
    Math.min(options.fragmentCount, pattern.seedCount ?? options.fragmentCount),
  );

  const anisotropy =
    pattern.distribution === "anisotropic"
      ? createAnisotropyConfig(
          pattern.grainDirection,
          pattern.anisotropyStrength,
        )
      : undefined;

  const seeds = generateVoronoiSeeds(fragment, targetCount, pattern, anisotropy);
  if (seeds.length === 0) {
    return [fragment];
  }

  const treatAsConvex = options.fractureMode === "Convex";

  const assignments: SeedFragmentAssignment[] = [
    { seedIndex: 0, fragment },
  ];

  for (let seedIndex = 1; seedIndex < seeds.length; seedIndex++) {
    const seed = seeds[seedIndex];
    let candidate: Fragment | null = null;

    for (let i = 0; i < assignments.length; i++) {
      const existing = assignments[i];
      const plane = createVoronoiPlane(
        seed,
        seeds[existing.seedIndex],
        anisotropy,
      );

      if (!plane) {
        continue;
      }

      const { topSlice } = sliceFragment(
        existing.fragment,
        plane.normal,
        plane.origin,
        options.textureScale,
        options.textureOffset,
        treatAsConvex,
      );

      if (topSlice.triangleCount === 0) {
        assignments.splice(i, 1);
        i--;
      } else {
        assignments[i].fragment = topSlice;
      }

      const source = candidate ?? fragment;
      const { bottomSlice } = sliceFragment(
        source,
        plane.normal,
        plane.origin,
        options.textureScale,
        options.textureOffset,
        treatAsConvex,
      );

      if (bottomSlice.triangleCount === 0) {
        candidate = null;
        break;
      }

      candidate = bottomSlice;
    }

    if (candidate && candidate.triangleCount > 0) {
      assignments.push({ seedIndex, fragment: candidate });
    }

    if (assignments.length >= targetCount) {
      break;
    }
  }

  return assignments.map((entry) => entry.fragment);
}

function generateVoronoiSeeds(
  fragment: Fragment,
  count: number,
  pattern: VoronoiPatternOptions,
  anisotropy?: AnisotropyConfig,
): Vector3[] {
  const bounds = fragment.bounds;
  const seeds: Vector3[] = [];
  const distribution = pattern.distribution ?? "uniform";

  const min = bounds.min;
  const max = bounds.max;
  const rangeX = max.x - min.x;
  const rangeY = max.y - min.y;
  const rangeZ = max.z - min.z;
  const diagonal = Math.hypot(rangeX, rangeY, rangeZ);

  switch (distribution) {
    case "clustered": {
      const clusterCount = Math.max(
        1,
        pattern.clusterCount ?? Math.round(Math.sqrt(count)),
      );
      const jitterScale = (pattern.clusterJitter ?? 0.25) * diagonal;
      const clusters: Vector3[] = [];
      for (let i = 0; i < clusterCount; i++) {
        clusters.push(randomPoint(bounds));
      }

      for (let i = 0; i < count; i++) {
        const cluster = clusters[Math.floor(Math.random() * clusters.length)] ??
          randomPoint(bounds);
        const offset = randomDirection().multiplyScalar(jitterScale * Math.random());
        const point = cluster.clone().add(offset);
        seeds.push(clampToBounds(point, bounds));
      }
      break;
    }
    case "radial": {
      const center = (pattern.radialCenter
        ? pattern.radialCenter.clone()
        : bounds.getCenter(new Vector3())) as Vector3;
      const falloff = Math.max(pattern.radialFalloff ?? 0.4, 1e-3);
      let maxRadius = 0;
      for (const corner of getBoundsCorners(bounds)) {
        const distance = corner.sub(center).length();
        if (distance > maxRadius) {
          maxRadius = distance;
        }
      }

      for (let i = 0; i < count; i++) {
        const direction = randomDirection();
        const radius = maxRadius * Math.pow(Math.random(), falloff);
        const point = center.clone().add(direction.multiplyScalar(radius));
        seeds.push(clampToBounds(point, bounds));
      }
      break;
    }
    case "anisotropic": {
      const config = anisotropy ??
        createAnisotropyConfig(pattern.grainDirection, pattern.anisotropyStrength);
      const anisotropicBounds = computeAnisotropicBounds(bounds, config);
      const centerPrime = new Vector3(
        (anisotropicBounds.min.x + anisotropicBounds.max.x) * 0.5,
        (anisotropicBounds.min.y + anisotropicBounds.max.y) * 0.5,
        (anisotropicBounds.min.z + anisotropicBounds.max.z) * 0.5,
      );
      const extentPrime = new Vector3(
        anisotropicBounds.max.x - anisotropicBounds.min.x,
        anisotropicBounds.max.y - anisotropicBounds.min.y,
        anisotropicBounds.max.z - anisotropicBounds.min.z,
      );
      const crossScale = 1 / Math.max(config.strength, 1);

      for (let i = 0; i < count; i++) {
        const sample = new Vector3(
          anisotropicBounds.min.x + Math.random() * extentPrime.x,
          centerPrime.y + (Math.random() - 0.5) * extentPrime.y * crossScale,
          centerPrime.z + (Math.random() - 0.5) * extentPrime.z * crossScale,
        );

        const worldPoint = fromAnisotropicSpace(sample, config);
        worldPoint.add(
          randomDirection().multiplyScalar(diagonal * 0.02 * Math.random()),
        );
        seeds.push(clampToBounds(worldPoint, bounds));
      }
      break;
    }
    case "uniform":
    default: {
      for (let i = 0; i < count; i++) {
        seeds.push(randomPoint(bounds));
      }
      break;
    }
  }

  return seeds;
}

function createVoronoiPlane(
  seed: Vector3,
  other: Vector3,
  anisotropy?: AnisotropyConfig,
): { normal: Vector3; origin: Vector3 } | null {
  if (anisotropy) {
    const seedPrime = toAnisotropicSpace(seed, anisotropy);
    const otherPrime = toAnisotropicSpace(other, anisotropy);
    const normalPrime = seedPrime.clone().sub(otherPrime);

    if (normalPrime.length() === 0) {
      return null;
    }

    const originPrime = seedPrime.clone().add(otherPrime).multiplyScalar(0.5);

    const normal = fromAnisotropicSpace(normalPrime, anisotropy).normalize();
    const origin = fromAnisotropicSpace(originPrime, anisotropy);

    return { normal, origin };
  }

  const normal = seed.clone().sub(other);
  if (normal.length() === 0) {
    return null;
  }

  const origin = seed.clone().add(other).multiplyScalar(0.5);
  return { normal: normal.normalize(), origin };
}

function randomPoint(bounds: { min: Vector3; max: Vector3 }): Vector3 {
  return new Vector3(
    bounds.min.x + Math.random() * (bounds.max.x - bounds.min.x),
    bounds.min.y + Math.random() * (bounds.max.y - bounds.min.y),
    bounds.min.z + Math.random() * (bounds.max.z - bounds.min.z),
  );
}

function clampToBounds(point: Vector3, bounds: { min: Vector3; max: Vector3 }): Vector3 {
  point.x = Math.max(bounds.min.x, Math.min(bounds.max.x, point.x));
  point.y = Math.max(bounds.min.y, Math.min(bounds.max.y, point.y));
  point.z = Math.max(bounds.min.z, Math.min(bounds.max.z, point.z));
  return point;
}

function randomDirection(): Vector3 {
  let direction = new Vector3();
  do {
    direction.set(
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
    );
  } while (direction.length() === 0);
  return direction.normalize();
}

function getBoundsCorners(bounds: { min: Vector3; max: Vector3 }): Vector3[] {
  const { min, max } = bounds;
  return [
    new Vector3(min.x, min.y, min.z),
    new Vector3(max.x, min.y, min.z),
    new Vector3(min.x, max.y, min.z),
    new Vector3(max.x, max.y, min.z),
    new Vector3(min.x, min.y, max.z),
    new Vector3(max.x, min.y, max.z),
    new Vector3(min.x, max.y, max.z),
    new Vector3(max.x, max.y, max.z),
  ];
}

function createAnisotropyConfig(
  grainDirection?: Vector3,
  anisotropyStrength?: number,
): AnisotropyConfig {
  const direction = (grainDirection ? grainDirection.clone() : new Vector3(1, 0, 0))
    .normalize();

  if (direction.length() === 0) {
    direction.set(1, 0, 0);
  }

  let helper = new Vector3(0, 1, 0);
  if (Math.abs(direction.dot(helper)) > 0.999) {
    helper = new Vector3(0, 0, 1);
  }

  const e1 = helper
    .clone()
    .sub(direction.clone().multiplyScalar(helper.dot(direction)))
    .normalize();
  const e2 = new Vector3().crossVectors(direction, e1).normalize();

  const strength = Math.max(anisotropyStrength ?? 4, 1);

  return {
    basis: [direction, e1, e2],
    strength,
  };
}

function toAnisotropicSpace(point: Vector3, config: AnisotropyConfig): Vector3 {
  return new Vector3(
    point.dot(config.basis[0]),
    point.dot(config.basis[1]) * config.strength,
    point.dot(config.basis[2]) * config.strength,
  );
}

function fromAnisotropicSpace(point: Vector3, config: AnisotropyConfig): Vector3 {
  return config.basis[0]
    .clone()
    .multiplyScalar(point.x)
    .add(config.basis[1].clone().multiplyScalar(point.y / config.strength))
    .add(config.basis[2].clone().multiplyScalar(point.z / config.strength));
}

function computeAnisotropicBounds(
  bounds: { min: Vector3; max: Vector3 },
  config: AnisotropyConfig,
): { min: Vector3; max: Vector3 } {
  const corners = getBoundsCorners(bounds);
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);

  for (const corner of corners) {
    const projected = toAnisotropicSpace(corner, config);
    min.x = Math.min(min.x, projected.x);
    min.y = Math.min(min.y, projected.y);
    min.z = Math.min(min.z, projected.z);
    max.x = Math.max(max.x, projected.x);
    max.y = Math.max(max.y, projected.y);
    max.z = Math.max(max.z, projected.z);
  }

  return { min, max };
}

/**
 * Uses the union-find algorithm to find isolated groups of geometry
 * within a fragment that are not connected together. These groups
 * are identified and split into separate fragments.
 * @returns An array of fragments
 */
function findIsolatedGeometry(fragment: Fragment): Fragment[] {
  // Initialize the union-find data structure
  const uf = new UnionFind(fragment.vertexCount);
  // Triangles for each submesh are stored separately
  const rootTriangles: Record<number, number[][]> = {};

  const N = fragment.vertices.length;
  const M = fragment.cutVertices.length;

  const adjacencyMap = new Map<number, number>();

  // Hash each vertex based on its position. If a vertex already exists
  // at that location, union this vertex with the existing vertex so they are
  // included in the same geometry group.
  fragment.vertices.forEach((vertex, index) => {
    const key = hash3(vertex.position);
    const existingIndex = adjacencyMap.get(key);
    if (existingIndex === undefined) {
      adjacencyMap.set(key, index);
    } else {
      uf.union(existingIndex, index);
    }
  });

  // First, union each cut-face vertex with its coincident non-cut-face vertex
  // The union is performed so no cut-face vertex can be a root.
  for (let i = 0; i < M; i++) {
    uf.union(fragment.vertexAdjacency[i], i + N);
  }

  // Group vertices by analyzing which vertices are connected via triangles
  // Analyze the triangles of each submesh separately
  const indices = fragment.triangles;
  for (let submeshIndex = 0; submeshIndex < indices.length; submeshIndex++) {
    for (let i = 0; i < indices[submeshIndex].length; i += 3) {
      const a = indices[submeshIndex][i];
      const b = indices[submeshIndex][i + 1];
      const c = indices[submeshIndex][i + 2];
      uf.union(a, b);
      uf.union(b, c);

      // Store triangles by root representative
      const root = uf.find(a);
      if (!rootTriangles[root]) {
        rootTriangles[root] = [[], []];
      }

      rootTriangles[root][submeshIndex].push(a, b, c);
    }
  }

  // New fragments created from geometry, mapped by root index
  const rootFragments: Record<number, Fragment> = {};
  const vertexMap: number[] = Array(fragment.vertexCount);

  // Iterate over each vertex and add it to correct mesh
  for (let i = 0; i < N; i++) {
    const root = uf.find(i);

    // If there is no fragment for this root yet, create it
    if (!rootFragments[root]) {
      rootFragments[root] = new Fragment();
    }

    rootFragments[root].vertices.push(fragment.vertices[i]);
    vertexMap[i] = rootFragments[root].vertices.length - 1;
  }

  // Do the same for the cut-face vertices
  for (let i = 0; i < M; i++) {
    const root = uf.find(i + N);
    rootFragments[root].cutVertices.push(fragment.cutVertices[i]);
    vertexMap[i + N] =
      rootFragments[root].vertices.length +
      rootFragments[root].cutVertices.length -
      1;
  }

  // Iterate over triangles and add to the correct mesh
  for (const key of Object.keys(rootTriangles)) {
    let i = Number(key);

    // Minor optimization here:
    // Access the parent directly rather than using find() since the paths
    // for all indices have been compressed in the last two for loops
    let root = uf.parent[i];

    for (
      let submeshIndex = 0;
      submeshIndex < fragment.triangles.length;
      submeshIndex++
    ) {
      for (const vertexIndex of rootTriangles[i][submeshIndex]) {
        const mappedIndex = vertexMap[vertexIndex];
        rootFragments[root].triangles[submeshIndex].push(mappedIndex);
      }
    }
  }

  return Object.values(rootFragments);
}
