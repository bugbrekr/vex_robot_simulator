import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { SimSettings } from "./settings";
import { gradientTexture, laminateTexture, woodTexture } from "./textures";

const ENVIRONMENTS: Record<SimSettings["environment"], { top: string; bottom: string; hemi: number; sun: number; env: number; exposure: number }> = {
  studio: { top: "#eef3f9", bottom: "#c4cfdb", hemi: 0.9, sun: 2.4, env: 0.55, exposure: 1.0 },
  workshop: { top: "#f3e6d4", bottom: "#a89580", hemi: 0.8, sun: 2.2, env: 0.5, exposure: 1.0 },
  night: { top: "#2a3443", bottom: "#0d1117", hemi: 0.35, sun: 2.0, env: 0.35, exposure: 0.95 },
};
const QUALITY = { low: 1, medium: 1.5, high: 2 };

/** Renderer + camera + lights + table. World units are millimetres, +Z is up (like the arm). */
export class Viewport {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  private tickers: ((dt: number) => void)[] = [];
  private clock = new THREE.Clock();
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private fill: THREE.DirectionalLight;
  private table = new THREE.Group();
  private axes = new THREE.Group();

  constructor(private host: HTMLElement) {
    THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    host.appendChild(this.renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.camera = new THREE.PerspectiveCamera(38, 1, 5, 6000);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.resetView();

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8a7d70, 1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff4e6, 2.2);
    this.sun.position.set(380, -260, 720);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -380; sc.right = 380; sc.top = 380; sc.bottom = -380; sc.near = 100; sc.far = 2000;
    this.sun.target.position.set(80, 70, 0);
    this.scene.add(this.sun, this.sun.target);
    this.fill = new THREE.DirectionalLight(0xdfe8ff, 0.6);
    this.fill.position.set(-400, 500, 300);
    this.scene.add(this.fill);
    this.scene.add(this.table, this.axes);
    this.buildAxes();

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.renderer.setAnimationLoop(() => {
      const dt = Math.min(0.1, this.clock.getDelta());
      for (const t of this.tickers) t(dt);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  /** Apply environment / table / shadow / quality settings. */
  apply(s: SimSettings): void {
    const env = ENVIRONMENTS[s.environment];
    this.scene.background = gradientTexture(env.top, env.bottom);
    this.scene.environmentIntensity = env.env;
    this.hemi.intensity = env.hemi;
    this.sun.intensity = env.sun;
    this.sun.color.set(s.environment === "night" ? 0xc8d6ff : 0xfff4e6);
    this.renderer.toneMappingExposure = env.exposure;
    this.renderer.shadowMap.enabled = s.shadows;
    this.sun.castShadow = s.shadows;
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (m) (Array.isArray(m) ? m : [m]).forEach((mm) => (mm.needsUpdate = true));
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[s.quality]));
    this.sun.shadow.mapSize.set(s.quality === "low" ? 1024 : 2048, s.quality === "low" ? 1024 : 2048);
    this.sun.shadow.map?.dispose();
    (this.sun.shadow as unknown as { map: null }).map = null;
    this.buildTable(s.table);
    this.axes.visible = s.axes;
    this.resize();
  }

  private buildTable(kind: SimSettings["table"]): void {
    this.table.clear();
    if (kind === "none") return;
    const map = kind === "wood" ? woodTexture() : laminateTexture();
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(1400, 900, 30),
      new THREE.MeshStandardMaterial({ map, roughness: kind === "wood" ? 0.55 : 0.7, metalness: 0 }),
    );
    top.position.set(80, 60, -28 - 15);
    top.receiveShadow = true;
    this.table.add(top);
  }

  private buildAxes(): void {
    const mk = (dir: THREE.Vector3, color: number, label: string) => {
      const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(0, 0, 0.5), 60, color, 10, 6);
      arrow.position.set(-100, -100, 0.5);
      this.axes.add(arrow);
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      const g = c.getContext("2d")!;
      g.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
      g.font = "bold 44px sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(label, 32, 34);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c) }));
      sprite.scale.set(14, 14, 1);
      sprite.position.copy(dir.clone().multiplyScalar(72)).add(new THREE.Vector3(-100, -100, 0.5));
      this.axes.add(sprite);
    };
    mk(new THREE.Vector3(1, 0, 0), 0xe03131, "X");
    mk(new THREE.Vector3(0, 1, 0), 0x2f9e44, "Y");
    mk(new THREE.Vector3(0, 0, 1), 0x1c7ed6, "Z");
  }

  resetView(): void {
    this.camera.position.set(600, -430, 470);
    this.controls.target.set(90, 70, 40);
    this.controls.update();
  }

  sideView(): void {
    this.camera.position.set(90, -720, 140);
    this.controls.target.set(90, 0, 110);
    this.controls.update();
  }

  topView(): void {
    // like VEX's top-down diagrams: +X points down the screen, +Y to the right
    this.camera.position.set(75.5, 75, 900);
    this.controls.target.set(75, 75, 0);
    this.controls.update();
  }

  onTick(fn: (dt: number) => void): void {
    this.tickers.push(fn);
  }

  private resize(): void {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
