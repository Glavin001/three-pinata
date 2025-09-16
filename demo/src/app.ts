import * as THREE from "three";
import { FolderApi, Pane } from "tweakpane";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Demo } from "./types/Demo";
import { PhysicsDemo } from "./examples/physics";
import { ExplodeDemo } from "./examples/explode";
import {
  UniformVoronoiDemo,
  ClusteredVoronoiDemo,
  RadialVoronoiDemo,
  AnisotropicVoronoiDemo,
} from "./examples/voronoi";
import { ThreePerf } from "three-perf";

// Add imports for postprocessing
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
} from "postprocessing";

const RAPIER = await import("@dimforge/rapier3d");

let activeDemo: Demo | null = null;
let demoFolder: FolderApi | null = null;

const clock = new THREE.Clock();
const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.1,
  100,
);
const renderer = new THREE.WebGLRenderer();
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(0x000000);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setAnimationLoop(animate);
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const perf = new ThreePerf({
  anchorX: "right",
  anchorY: "bottom",
  domElement: document.body,
  renderer,
});

// Set up post-processing
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(new THREE.Scene(), camera); // We'll update the scene later
composer.addPass(renderPass);

// Create and configure the bloom effect
const bloomEffect = new BloomEffect({
  intensity: 1.5,
  luminanceThreshold: 0.4,
  luminanceSmoothing: 0.9,
  height: 480,
});

// Add the effects to the composer
const effectPass = new EffectPass(camera, bloomEffect);
composer.addPass(effectPass);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.autoRotate = true;
controls.autoRotateSpeed = 10;
controls.enableZoom = true;
controls.dampingFactor = 0.25;
controls.enablePan = false;

// Create GUI
const pane = new Pane();
pane.title = "three-pinata";

// Style the Tweakpane element
const tweakpaneElement = pane.element;
tweakpaneElement.parentElement!.style.width = "300px"; // Set your desired width

// Setup demo selection
const demoOptions = {
  current: "Physics",
};

// Initialize demos
const physicsDemo = new PhysicsDemo(camera, controls, RAPIER);
const explodeDemo = new ExplodeDemo(camera, controls);
const uniformVoronoiDemo = new UniformVoronoiDemo(camera, controls);
const clusteredVoronoiDemo = new ClusteredVoronoiDemo(camera, controls);
const radialVoronoiDemo = new RadialVoronoiDemo(camera, controls);
const anisotropicVoronoiDemo = new AnisotropicVoronoiDemo(camera, controls);

const demoRegistry: Record<string, Demo> = {
  Physics: physicsDemo,
  Explode: explodeDemo,
  "Voronoi: Uniform Stone": uniformVoronoiDemo,
  "Voronoi: Clustered Rubble": clusteredVoronoiDemo,
  "Voronoi: Radial Impact": radialVoronoiDemo,
  "Voronoi: Anisotropic Wood": anisotropicVoronoiDemo,
};

const demoBindingOptions = Object.keys(demoRegistry).reduce(
  (acc, key) => ({ ...acc, [key]: key }),
  {} as Record<string, string>,
);

loadDemo(physicsDemo);

async function loadDemo(demo: Demo) {
  // Dispose of the current demo
  if (activeDemo) {
    activeDemo.destroy();
  }

  activeDemo = demo;

  if (demoFolder) {
    demoFolder.dispose();
    pane.remove(demoFolder);
  }

  await demo.load();
  demoFolder = demo.setupGUI(pane);

  // Update the render pass with the new scene
  if (renderPass) {
    renderPass.mainScene = demo.scene;
  }
}

// Add demo selector to GUI
pane
  .addBinding(demoOptions, "current", {
    options: demoBindingOptions,
    label: "Select Demo",
  })
  .on("change", async (ev) => {
    const nextDemo = demoRegistry[ev.value];
    if (!nextDemo) {
      console.warn("Unknown demo:", ev.value);
      return;
    }
    await loadDemo(nextDemo);
  });

// Add a separator to the GUI
pane.addBlade({ view: "separator" });

// Animation loop with delta time
function animate() {
  perf.begin();

  const dt = clock.getDelta();

  if (activeDemo) {
    activeDemo.update(dt);

    // Use the composer instead of directly rendering
    composer.render(dt);
  }

  controls.update();
  perf.end();
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);

  // Update composer size when window is resized
  composer.setSize(window.innerWidth, window.innerHeight);
});

animate();
