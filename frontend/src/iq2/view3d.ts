import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { gradientTexture } from "../scene/textures";
import { type DisplaySettings, LIGHTING, QUALITY, display } from "./display";

/** A three.js view (mm, +Z up) that only renders while its host is visible. */
export class View3D {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private fill: THREE.DirectionalLight;
  private rim: THREE.DirectionalLight;
  private tickers: ((dt: number) => void)[] = [];
  private clock = new THREE.Clock();
  /** called after display settings change; `rebuild` = quality changed (re-create models) */
  onDisplay: (s: DisplaySettings, rebuild: boolean) => void = () => {};

  constructor(readonly host: HTMLElement, private shadowExtent = 1400) {
    THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.camera = new THREE.PerspectiveCamera(40, 1, 5, 20000);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.495;

    // key (shadow-casting), fill from the opposite side, and a rim light from behind/above
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8a7d70, 0.8);
    this.sun = new THREE.DirectionalLight(0xfff4e6, 2.4);
    this.sun.position.set(900, -700, 1800);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.6;
    this.sun.shadow.radius = 3;
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -shadowExtent; sc.right = shadowExtent; sc.top = shadowExtent; sc.bottom = -shadowExtent;
    sc.near = 100; sc.far = 5000;
    this.fill = new THREE.DirectionalLight(0xdfe8ff, 0.6);
    this.fill.position.set(-900, 800, 700);
    this.rim = new THREE.DirectionalLight(0xffffff, 0.9);
    this.rim.position.set(-300, 1200, 400);
    this.scene.add(this.hemi, this.sun, this.sun.target, this.fill, this.rim);

    this.apply(display.value);
    display.onChange((s, rebuild) => { this.apply(s); this.onDisplay(s, rebuild); });

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.renderer.setAnimationLoop(() => {
      const dt = Math.min(0.1, this.clock.getDelta());
      if (!this.host.clientWidth) return; // hidden tab: don't render
      for (const t of this.tickers) t(dt);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  apply(s: DisplaySettings): void {
    const q = QUALITY[s.quality];
    const L = LIGHTING[s.lighting];
    this.scene.background = gradientTexture(L.top, L.bottom);
    this.scene.environmentIntensity = L.env;
    this.hemi.color.set(L.hemiSky);
    this.hemi.groundColor.set(L.hemiGround);
    this.hemi.intensity = L.hemi;
    this.sun.color.set(L.keyColor);
    this.sun.intensity = L.key;
    this.fill.intensity = L.fill;
    this.rim.intensity = L.rim;
    this.renderer.toneMappingExposure = L.exposure;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.renderer.shadowMap.enabled = s.shadows;
    this.sun.castShadow = s.shadows;
    this.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
    this.sun.shadow.map?.dispose();
    (this.sun.shadow as unknown as { map: null }).map = null;
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (m) (Array.isArray(m) ? m : [m]).forEach((mm) => (mm.needsUpdate = true));
    });
    this.resize();
  }

  /** Keep the shadow camera centred on a point of interest (e.g. the robot). */
  shadowFollow(x: number, y: number): void {
    this.sun.position.set(x + 900, y - 700, 1800);
    this.sun.target.position.set(x, y, 0);
  }

  look(pos: [number, number, number], target: [number, number, number]): void {
    this.camera.position.set(...pos);
    this.controls.target.set(...target);
    this.controls.update();
  }

  onTick(fn: (dt: number) => void): void {
    this.tickers.push(fn);
  }

  /** Ground-plane (z = h) point under a pointer event, or null. */
  floorPoint(e: PointerEvent | MouseEvent, h = 0): THREE.Vector3 | null {
    const ray = this.raycaster(e);
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -h), p) ? p : null;
  }

  raycaster(e: PointerEvent | MouseEvent): THREE.Raycaster {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    return rc;
  }

  resize(): void {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  get extent(): number {
    return this.shadowExtent;
  }
}
