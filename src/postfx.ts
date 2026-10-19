/**
 * Cinematic post-processing on the finished frame: bloom (bright things glow), a per-terrain
 * color grade, a soft vignette and fine film grain.
 *
 * It works on the final, display-ready image (after tone mapping), copied from the screen, so
 * the sky's exact colors are kept. Bloom is computed at low resolution, which keeps it cheap:
 * one copy, a bright pass, four small blur passes and one full-screen composite per frame.
 */
import * as THREE from "three";
import { MapDef } from "./maps";

export interface Grade {
  /** Contrast around mid-grey (1 = unchanged). */
  contrast: number;
  /** Color saturation (1 = unchanged). */
  saturation: number;
  /** Per-channel tint multiplier (warm / cool look). */
  tint: [number, number, number];
  /** How strongly bright things glow, and how bright they must be (0..1 display value). */
  bloom: number;
  threshold: number;
}

/** The look of each terrain: warm deserts, cool ice, punchy neon nights, flat grey rain. */
export function gradeFor(map: MapDef): Grade {
  const g: Grade = { contrast: 1.07, saturation: 1.1, tint: [1, 1, 1], bloom: 0.35, threshold: 0.84 };
  const warm = ["desert", "beach", "outback", "savanna", "canyon", "mars", "volcano", "autumn"];
  const cool = ["snow", "glacier", "highlands"];
  if (warm.includes(map.id)) g.tint = [1.045, 1.0, 0.93];
  if (cool.includes(map.id)) {
    g.tint = [0.96, 1.0, 1.06];
    g.saturation = 0.98;
  }
  if (map.stars) {
    g.saturation = 1.2;
    g.bloom = 0.95;
    g.threshold = 0.55;
  }
  if (map.id === "neon") g.bloom = 1.25;
  if (map.id === "moon") g.saturation = 0.9;
  if (map.bubbles) g.tint = [0.94, 1.02, 1.08];
  if (map.wet) {
    g.saturation *= 1 - 0.18 * map.wet;
    g.contrast = 1.0;
    g.bloom *= 0.7;
  }
  return g;
}

const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export class PostFX {
  private sceneTex: THREE.FramebufferTexture | null = null;
  private quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private quadScene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private rtA: THREE.WebGLRenderTarget;
  private rtB: THREE.WebGLRenderTarget;
  private rtC: THREE.WebGLRenderTarget;
  private rtD: THREE.WebGLRenderTarget;
  private bright: THREE.ShaderMaterial;
  private blur: THREE.ShaderMaterial;
  private composite: THREE.ShaderMaterial;
  private size = new THREE.Vector2();
  private grade: Grade = { contrast: 1, saturation: 1, tint: [1, 1, 1], bloom: 0.4, threshold: 0.75 };

  constructor(private renderer: THREE.WebGLRenderer) {
    const rt = () =>
      new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    this.rtA = rt();
    this.rtB = rt();
    this.rtC = rt();
    this.rtD = rt();
    this.bright = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uThreshold: { value: 0.75 } },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc; uniform float uThreshold; varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tSrc, vUv).rgb;
          float l = max(c.r, max(c.g, c.b));
          float k = smoothstep(uThreshold, 1.0, l);
          gl_FragColor = vec4(c * k, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.blur = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tSrc, vUv).rgb * 0.227;
          c += texture2D(tSrc, vUv + uDir * 1.385).rgb * 0.316;
          c += texture2D(tSrc, vUv - uDir * 1.385).rgb * 0.316;
          c += texture2D(tSrc, vUv + uDir * 3.231).rgb * 0.070;
          c += texture2D(tSrc, vUv - uDir * 3.231).rgb * 0.070;
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.composite = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null },
        tBloomA: { value: null },
        tBloomB: { value: null },
        uBloom: { value: 0.4 },
        uContrast: { value: 1 },
        uSaturation: { value: 1 },
        uTint: { value: new THREE.Vector3(1, 1, 1) },
        uTime: { value: 0 },
        uVignette: { value: 0.22 },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene, tBloomA, tBloomB;
        uniform float uBloom, uContrast, uSaturation, uTime, uVignette;
        uniform vec3 uTint;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tScene, vUv).rgb;
          // Bloom: a tight glow and a wide soft halo, added like light (screen blend keeps whites clean)
          vec3 b = texture2D(tBloomA, vUv).rgb * 0.65 + texture2D(tBloomB, vUv).rgb * 0.8;
          c = 1.0 - (1.0 - c) * (1.0 - clamp(b * uBloom, 0.0, 1.0));
          // Grade: tint, saturation, gentle S-curve contrast
          c *= uTint;
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(vec3(l), c, uSaturation);
          c = (c - 0.5) * uContrast + 0.5;
          // Vignette: corners fall off softly, drawing the eye to the middle
          vec2 d = vUv - 0.5;
          c *= 1.0 - uVignette * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
          // Fine film grain (animated, very faint)
          float n = fract(sin(dot(vUv * 913.7 + uTime * 37.1, vec2(12.9898, 78.233))) * 43758.5453);
          c += (n - 0.5) * 0.018;
          gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.composite);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  setGrade(g: Grade): void {
    this.grade = g;
    const u = this.composite.uniforms;
    u.uBloom.value = g.bloom;
    u.uContrast.value = g.contrast;
    u.uSaturation.value = g.saturation;
    (u.uTint.value as THREE.Vector3).set(...g.tint);
    this.bright.uniforms.uThreshold.value = g.threshold;
  }

  /** Match the drawing buffer; `fast` uses a smaller bloom buffer. */
  resize(fast: boolean): void {
    this.renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, this.size.x);
    const h = Math.max(1, this.size.y);
    this.sceneTex?.dispose();
    this.sceneTex = new THREE.FramebufferTexture(w, h);
    this.sceneTex.minFilter = THREE.LinearFilter;
    this.sceneTex.magFilter = THREE.LinearFilter;
    const d1 = fast ? 6 : 4;
    const d2 = d1 * 2;
    this.rtA.setSize(Math.ceil(w / d1), Math.ceil(h / d1));
    this.rtB.setSize(Math.ceil(w / d1), Math.ceil(h / d1));
    this.rtC.setSize(Math.ceil(w / d2), Math.ceil(h / d2));
    this.rtD.setSize(Math.ceil(w / d2), Math.ceil(h / d2));
  }

  private pass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.cam);
  }

  private blurInto(src: THREE.WebGLRenderTarget, tmp: THREE.WebGLRenderTarget): void {
    const u = this.blur.uniforms;
    u.tSrc.value = src.texture;
    (u.uDir.value as THREE.Vector2).set(1 / src.width, 0);
    this.pass(this.blur, tmp);
    u.tSrc.value = tmp.texture;
    (u.uDir.value as THREE.Vector2).set(0, 1 / src.height);
    this.pass(this.blur, src);
  }

  /** Applies the effects to what's on screen now. Call after the main scene has rendered. */
  apply(time: number): void {
    const r = this.renderer;
    r.getDrawingBufferSize(this.size);
    if (!this.sceneTex || this.sceneTex.image.width !== this.size.x || this.sceneTex.image.height !== this.size.y) return;
    const prevScissor = r.getScissorTest();
    r.setScissorTest(false);
    r.setViewport(0, 0, this.size.x / r.getPixelRatio(), this.size.y / r.getPixelRatio());
    r.copyFramebufferToTexture(this.sceneTex);
    // Bright parts → small buffer → blurred; then a smaller, wider blur for the halo
    this.bright.uniforms.tSrc.value = this.sceneTex;
    this.pass(this.bright, this.rtA);
    this.blurInto(this.rtA, this.rtB);
    this.blur.uniforms.tSrc.value = this.rtA.texture;
    (this.blur.uniforms.uDir.value as THREE.Vector2).set(0, 0);
    this.pass(this.blur, this.rtC);
    this.blurInto(this.rtC, this.rtD);
    const u = this.composite.uniforms;
    u.tScene.value = this.sceneTex;
    u.tBloomA.value = this.rtA.texture;
    u.tBloomB.value = this.rtC.texture;
    u.uTime.value = time % 100;
    this.pass(this.composite, null);
    r.setScissorTest(prevScissor);
  }
}
