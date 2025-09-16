import * as THREE from "three";
import { Pane, FolderApi } from "tweakpane";
import {
  fracture,
  FractureOptions,
  Vector3 as PinataVector3,
  VoronoiPatternOptions,
} from "@dgreenheck/three-pinata";
import { Demo } from "../types/Demo";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import stoneColorUrl from "../assets/stone_color.jpg";
import stoneDispUrl from "../assets/stone_disp.jpg";

interface VoronoiDemoConfig {
  title: string;
  geometry: () => THREE.BufferGeometry;
  createMaterials: () => Promise<{
    outer: THREE.Material;
    inner: THREE.Material;
  }>;
  fracture: {
    fragmentCount: number;
    pattern: VoronoiPatternOptions & { seedCount: number };
  };
  cameraPosition: THREE.Vector3;
  controlsTarget?: THREE.Vector3;
  backgroundColor?: number;
  baseFragmentDistance: number;
  animationAmplitude: number;
  animationSpeed?: number;
  autoRotate?: boolean;
  description?: string;
}

function clonePattern(
  pattern: VoronoiPatternOptions & { seedCount: number },
): VoronoiPatternOptions {
  const cloned: VoronoiPatternOptions = {
    type: "Voronoi",
    distribution: pattern.distribution,
    seedCount: pattern.seedCount,
    clusterCount: pattern.clusterCount,
    clusterJitter: pattern.clusterJitter,
    radialFalloff: pattern.radialFalloff,
    anisotropyStrength: pattern.anisotropyStrength,
  };

  if (pattern.radialCenter) {
    cloned.radialCenter = pattern.radialCenter.clone();
  }

  if (pattern.grainDirection) {
    cloned.grainDirection = pattern.grainDirection.clone();
  }

  return cloned;
}

function createWoodTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Unable to create canvas context for wood texture");
  }

  ctx.fillStyle = "#5b3a1a";
  ctx.fillRect(0, 0, size, size);

  const ringCount = 18;
  for (let i = 0; i < ringCount; i++) {
    const hue = 28 + Math.sin(i * 0.6) * 6;
    const saturation = 52 + Math.cos(i * 0.5) * 8;
    const lightness = 32 + Math.sin(i * 0.8) * 6;
    ctx.strokeStyle = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    ctx.lineWidth = 6 + Math.sin(i) * 2;
    const offset = (i / ringCount) * size * 0.35;
    ctx.beginPath();
    ctx.ellipse(
      size / 2 + offset * 0.15,
      size / 2,
      size * 0.45 - offset,
      size * 0.18 - offset * 0.32,
      Math.PI / 8,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 1);
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

class VoronoiShowcaseDemo implements Demo {
  scene = new THREE.Scene();
  fragmentGroup = new THREE.Group();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  fractureOptions: FractureOptions;
  pattern: VoronoiPatternOptions;
  config: VoronoiDemoConfig;
  outerMaterial!: THREE.Material;
  innerMaterial!: THREE.Material;
  ground: THREE.Mesh | null = null;
  animationTime = 0;
  animateFragments = true;
  baseFragmentDistance: number;
  animationAmplitude: number;
  animationSpeed: number;

  constructor(
    config: VoronoiDemoConfig,
    camera: THREE.PerspectiveCamera,
    controls: OrbitControls,
  ) {
    this.camera = camera;
    this.controls = controls;
    this.config = config;

    this.baseFragmentDistance = config.baseFragmentDistance;
    this.animationAmplitude = config.animationAmplitude;
    this.animationSpeed = config.animationSpeed ?? 0.6;

    this.scene.background = new THREE.Color(config.backgroundColor ?? 0x111216);
    this.scene.add(this.fragmentGroup);

    const pattern = clonePattern(config.fracture.pattern);
    this.fractureOptions = new FractureOptions({
      fragmentCount: config.fracture.fragmentCount,
      pattern,
    });
    this.pattern = this.fractureOptions.pattern;

    this.setupLighting();
    this.setupGround();
  }

  async load() {
    const materials = await this.config.createMaterials();
    this.outerMaterial = materials.outer;
    this.innerMaterial = materials.inner;

    this.camera.position.copy(this.config.cameraPosition);
    this.camera.updateProjectionMatrix();

    const target = this.config.controlsTarget ?? new THREE.Vector3(0, 0, 0);
    this.controls.target.copy(target);
    this.controls.autoRotate = this.config.autoRotate ?? false;
    this.controls.autoRotateSpeed = 0.6;
    this.controls.update();

    this.fractureAndBuild();
  }

  update(dt: number) {
    if (this.animateFragments) {
      this.animationTime += dt * this.animationSpeed;
      const distance =
        this.baseFragmentDistance +
        Math.sin(this.animationTime) * this.animationAmplitude;
      this.updateFragmentPositions(distance);
    }

    this.fragmentGroup.rotation.y += dt * 0.1;
  }

  destroy() {
    this.clearFragments();
    if (this.outerMaterial) {
      this.outerMaterial.dispose();
    }
    if (this.innerMaterial) {
      this.innerMaterial.dispose();
    }

    if (this.ground) {
      (this.ground.geometry as THREE.BufferGeometry).dispose();
      (this.ground.material as THREE.Material).dispose();
      this.scene.remove(this.ground);
      this.ground = null;
    }

    this.scene.clear();
  }

  setupGUI(pane: Pane): FolderApi {
    const folder = pane.addFolder({ title: this.config.title });

    folder
      .addBinding(this.fractureOptions, "fragmentCount", {
        min: 3,
        max: 120,
        step: 1,
        label: "Fragments",
      })
      .on("change", (ev) => {
        if (!ev.last) return;
        this.handleOptionChange();
      });

    if (this.pattern.type === "Voronoi") {
      folder
        .addBinding(this.pattern, "seedCount", {
          min: 2,
          max: 200,
          step: 1,
          label: "Seed Count",
        })
        .on("change", (ev) => {
          if (!ev.last) return;
          this.handleOptionChange();
        });

      switch (this.pattern.distribution) {
        case "clustered":
          folder
            .addBinding(this.pattern, "clusterCount", {
              min: 1,
              max: 12,
              step: 1,
              label: "Clusters",
            })
            .on("change", (ev) => {
              if (!ev.last) return;
              this.handleOptionChange();
            });

          folder
            .addBinding(this.pattern, "clusterJitter", {
              min: 0,
              max: 1,
              step: 0.01,
              label: "Cluster Jitter",
            })
            .on("change", (ev) => {
              if (!ev.last) return;
              this.handleOptionChange();
            });
          break;
        case "radial":
          folder
            .addBinding(this.pattern, "radialFalloff", {
              min: 0.05,
              max: 1.5,
              step: 0.01,
              label: "Falloff",
            })
            .on("change", (ev) => {
              if (!ev.last) return;
              this.handleOptionChange();
            });
          break;
        case "anisotropic":
          folder
            .addBinding(this.pattern, "anisotropyStrength", {
              min: 1,
              max: 12,
              step: 0.1,
              label: "Grain Strength",
            })
            .on("change", (ev) => {
              if (!ev.last) return;
              this.handleOptionChange();
            });
          break;
      }
    }

    folder
      .addBinding(this, "animateFragments", { label: "Animate" })
      .on("change", () => {
        if (!this.animateFragments) {
          this.updateFragmentPositions(this.baseFragmentDistance);
        }
      });

    folder
      .addBinding(this, "animationSpeed", {
        min: 0.1,
        max: 2.0,
        step: 0.05,
        label: "Anim Speed",
      })
      .on("change", () => {
        this.animationTime = 0;
      });

    folder
      .addButton({ title: "Regenerate" })
      .on("click", () => this.fractureAndBuild());

    return folder;
  }

  private handleOptionChange() {
    if (this.pattern.type === "Voronoi") {
      const maxSeeds = this.fractureOptions.fragmentCount;
      if (this.pattern.seedCount) {
        this.pattern.seedCount = Math.max(
          1,
          Math.min(this.pattern.seedCount, maxSeeds),
        );
      }
    }

    this.fractureAndBuild();
  }

  private setupLighting() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.45);
    this.scene.add(ambient);

    const fill = new THREE.HemisphereLight(0x6f7aad, 0x1a1b1e, 0.35);
    this.scene.add(fill);

    const directional = new THREE.DirectionalLight(0xffffff, 1.1);
    directional.position.set(4, 6, 5);
    directional.castShadow = true;
    directional.shadow.mapSize.set(1024, 1024);
    directional.shadow.bias = -0.0004;
    this.scene.add(directional);
  }

  private setupGround() {
    const geometry = new THREE.CircleGeometry(6, 64);
    const material = new THREE.MeshStandardMaterial({
      color: 0x181a20,
      roughness: 0.95,
      metalness: 0.05,
    });

    const ground = new THREE.Mesh(geometry, material);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.25;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.ground = ground;
  }

  private fractureAndBuild() {
    this.clearFragments();

    if (this.pattern.type === "Voronoi") {
      const maxSeeds = this.fractureOptions.fragmentCount;
      this.pattern.seedCount = Math.max(
        1,
        Math.min(this.pattern.seedCount ?? maxSeeds, maxSeeds),
      );
    }

    const sourceGeometry = this.config.geometry();
    const fragments = fracture(sourceGeometry, this.fractureOptions);
    sourceGeometry.dispose();

    fragments.forEach((fragment) => {
      const mesh = new THREE.Mesh(fragment, [
        this.outerMaterial,
        this.innerMaterial,
      ]);

      fragment.computeBoundingBox();
      const center = new THREE.Vector3();
      fragment.boundingBox?.getCenter(center);

      if (center.length() === 0) {
        center.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
      }

      mesh.userData.direction = center.normalize();
      mesh.userData.spin = new THREE.Vector3(
        (Math.random() - 0.5) * 0.15,
        (Math.random() - 0.5) * 0.25,
        (Math.random() - 0.5) * 0.15,
      );

      mesh.castShadow = true;
      mesh.receiveShadow = true;

      this.fragmentGroup.add(mesh);
    });

    this.updateFragmentPositions(this.baseFragmentDistance);
  }

  private updateFragmentPositions(distance: number) {
    this.fragmentGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        const direction: THREE.Vector3 = obj.userData.direction;
        const spin: THREE.Vector3 = obj.userData.spin;
        obj.position.copy(direction).multiplyScalar(distance);
        obj.rotation.x += spin.x * 0.01;
        obj.rotation.y += spin.y * 0.01;
        obj.rotation.z += spin.z * 0.01;
      }
    });
  }

  private clearFragments() {
    this.fragmentGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
      }
    });
    this.fragmentGroup.clear();
  }
}

async function createStoneMaterials(): Promise<{
  outer: THREE.Material;
  inner: THREE.Material;
}> {
  const loader = new THREE.TextureLoader();
  const [colorMap, dispMap] = await Promise.all([
    loader.loadAsync(stoneColorUrl),
    loader.loadAsync(stoneDispUrl),
  ]);

  colorMap.colorSpace = THREE.SRGBColorSpace;
  colorMap.wrapS = colorMap.wrapT = THREE.RepeatWrapping;
  colorMap.repeat.set(2.5, 2.5);

  dispMap.wrapS = dispMap.wrapT = THREE.RepeatWrapping;
  dispMap.repeat.copy(colorMap.repeat);

  const outer = new THREE.MeshStandardMaterial({
    map: colorMap,
    bumpMap: dispMap,
    bumpScale: 0.1,
    roughness: 0.78,
    metalness: 0.08,
    color: 0xdddddd,
  });

  const inner = new THREE.MeshStandardMaterial({
    color: 0x9f9ea2,
    roughness: 0.85,
    metalness: 0.05,
  });

  return { outer, inner };
}

function createMetalMaterials(): { outer: THREE.Material; inner: THREE.Material } {
  const outer = new THREE.MeshPhysicalMaterial({
    color: 0xbcc6d6,
    metalness: 0.95,
    roughness: 0.22,
    reflectivity: 0.9,
    clearcoat: 0.6,
    clearcoatRoughness: 0.2,
  });

  const inner = new THREE.MeshStandardMaterial({
    color: 0x2a2e3a,
    roughness: 0.9,
    metalness: 0.15,
  });

  return { outer, inner };
}

function createWoodMaterials(): { outer: THREE.Material; inner: THREE.Material } {
  const woodTexture = createWoodTexture();

  const outer = new THREE.MeshStandardMaterial({
    map: woodTexture,
    roughness: 0.62,
    metalness: 0.05,
    color: 0xffffff,
  });

  const inner = new THREE.MeshStandardMaterial({
    color: 0x3b2612,
    roughness: 0.8,
    metalness: 0.03,
  });

  return { outer, inner };
}

export class UniformVoronoiDemo extends VoronoiShowcaseDemo {
  constructor(camera: THREE.PerspectiveCamera, controls: OrbitControls) {
    super(
      {
        title: "Voronoi · Uniform Stone",
        geometry: () => new THREE.BoxGeometry(1.7, 1.7, 1.7, 28, 28, 28),
        createMaterials: createStoneMaterials,
        fracture: {
          fragmentCount: 32,
          pattern: {
            type: "Voronoi",
            distribution: "uniform",
            seedCount: 32,
          },
        },
        cameraPosition: new THREE.Vector3(3.3, 2.4, 3.3),
        controlsTarget: new THREE.Vector3(0, 0, 0),
        backgroundColor: 0x0f1014,
        baseFragmentDistance: 0.42,
        animationAmplitude: 0.22,
        autoRotate: false,
        description: "Evenly spaced seeds create chunky concrete-like debris.",
      },
      camera,
      controls,
    );
  }
}

export class ClusteredVoronoiDemo extends VoronoiShowcaseDemo {
  constructor(camera: THREE.PerspectiveCamera, controls: OrbitControls) {
    super(
      {
        title: "Voronoi · Clustered Rubble",
        geometry: () => new THREE.BoxGeometry(2.0, 1.4, 1.2, 26, 26, 18),
        createMaterials: createStoneMaterials,
        fracture: {
          fragmentCount: 36,
          pattern: {
            type: "Voronoi",
            distribution: "clustered",
            seedCount: 36,
            clusterCount: 4,
            clusterJitter: 0.28,
          },
        },
        cameraPosition: new THREE.Vector3(3.6, 2.5, 3.1),
        controlsTarget: new THREE.Vector3(0, 0, 0),
        backgroundColor: 0x101118,
        baseFragmentDistance: 0.45,
        animationAmplitude: 0.26,
        autoRotate: false,
        description:
          "Dense seeds near impact create heavy concrete slabs with gritty chips.",
      },
      camera,
      controls,
    );
  }
}

export class RadialVoronoiDemo extends VoronoiShowcaseDemo {
  constructor(camera: THREE.PerspectiveCamera, controls: OrbitControls) {
    super(
      {
        title: "Voronoi · Radial Impact",
        geometry: () => new THREE.SphereGeometry(1.15, 48, 48),
        createMaterials: async () => createMetalMaterials(),
        fracture: {
          fragmentCount: 42,
          pattern: {
            type: "Voronoi",
            distribution: "radial",
            seedCount: 42,
            radialCenter: new PinataVector3(0, 0.25, 0.1),
            radialFalloff: 0.32,
          },
        },
        cameraPosition: new THREE.Vector3(2.9, 2.6, 2.4),
        controlsTarget: new THREE.Vector3(0, 0.2, 0),
        backgroundColor: 0x0b0c11,
        baseFragmentDistance: 0.58,
        animationAmplitude: 0.3,
        animationSpeed: 0.8,
        autoRotate: false,
        description: "Seeds focused around an impact point produce explosive shards.",
      },
      camera,
      controls,
    );
  }
}

export class AnisotropicVoronoiDemo extends VoronoiShowcaseDemo {
  constructor(camera: THREE.PerspectiveCamera, controls: OrbitControls) {
    super(
      {
        title: "Voronoi · Anisotropic Wood",
        geometry: () => new THREE.BoxGeometry(0.65, 3.1, 0.65, 12, 60, 12),
        createMaterials: async () => createWoodMaterials(),
        fracture: {
          fragmentCount: 28,
          pattern: {
            type: "Voronoi",
            distribution: "anisotropic",
            seedCount: 28,
            anisotropyStrength: 5.2,
            grainDirection: new PinataVector3(0, 1, 0),
          },
        },
        cameraPosition: new THREE.Vector3(2.6, 3.4, 2.2),
        controlsTarget: new THREE.Vector3(0, 0.6, 0),
        backgroundColor: 0x120e0a,
        baseFragmentDistance: 0.55,
        animationAmplitude: 0.28,
        animationSpeed: 0.7,
        autoRotate: false,
        description: "Scaled seeds along the grain stretch shards into splintered wood.",
      },
      camera,
      controls,
    );
  }
}
