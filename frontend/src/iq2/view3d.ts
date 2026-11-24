import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { gradientTexture } from "../scene/textures";

/** A three.js view (mm, +Z up) that only renders while its host is visible. */
export class View3D {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly sun: THREE.DirectionalLight;
  private tickers: ((dt: number) => void)[] = [];
  private clock = new THREE.Clock();

  constructor(readonly host: HTMLElement, shadowExtent = 1400) {
    THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    host.appendChild(this.renderer.domElement);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.5;
    this.scene.background = gradientTexture("#eef3f9", "#c4cfdb");

    this.camera = new THREE.PerspectiveCamera(40, 1, 5, 20000);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.495;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7d70, 0.9));
    this.sun = new THREE.DirectionalLight(0xfff4e6, 2.3);
    this.sun.position.set(900, -700, 1800);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.8;
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -shadowExtent; sc.right = shadowExtent; sc.top = shadowExtent; sc.bottom = -shadowExtent;
    sc.near = 100; sc.far = 5000;
    this.scene.add(this.sun, this.sun.target);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.6);
    fill.position.set(-800, 900, 600);
    this.scene.add(fill);

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
}
