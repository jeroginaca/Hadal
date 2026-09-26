import * as THREE from 'three';

// Signature moment #1. Water absorbs long wavelengths first: red, then
// orange, yellow, green, until only blue is left. This pass does the same
// thing in hue space. Each hue has a "cut-off" depth; past it, that hue loses
// its chroma and falls back to a dim, blue-cast luminance.
//
// The effective depth per pixel is a blend of:
//   - ambient: the sub's depth (sunlight has travelled that far through water)
//   - artificial: the camera→surface distance, for things lit by floodlights.
//     Up close under a lamp, colour comes back; a few metres away it's gone.

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const fragment = /* glsl */ `
  #include <packing>
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform float uDepth;       // metres, the master value
  uniform float uArtificial;  // 0 = sunlit, 1 = floodlit
  uniform float uPathScale;   // metres of "equivalent water" per world unit
  uniform float uNear, uFar;
  uniform float uTime;
  uniform float uGrain;
  uniform float uExposure;
  uniform vec2 uRes;
  uniform sampler2D tBloom;
  uniform float uBloom;

  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
  }

  // Depth (m) at which a hue has fully lost its colour. Hue 0..1.
  float cutoff(float h) {
    // red, orange, yellow, green, cyan, blue, violet, magenta, red
    const float NEVER = 100000.0;
    if (h < 1.0/12.0) return mix(380.0, 540.0, h * 12.0);
    if (h < 1.0/6.0)  return mix(540.0, 700.0, (h - 1.0/12.0) * 12.0);
    if (h < 1.0/3.0)  return mix(700.0, 860.0, (h - 1.0/6.0) * 6.0);
    if (h < 0.5)      return mix(860.0, 1150.0, (h - 1.0/3.0) * 6.0);
    if (h < 2.0/3.0)  return mix(1150.0, NEVER, smoothstep(0.5, 0.62, h));
    if (h < 0.75)     return mix(NEVER, 1050.0, smoothstep(0.70, 0.75, h));
    if (h < 5.0/6.0)  return mix(1050.0, 440.0, (h - 0.75) * 12.0);
    return mix(440.0, 380.0, (h - 5.0/6.0) * 6.0);
  }

  vec3 aces(vec3 x) {
    const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
  }
  vec3 toSRGB(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  void main() {
    vec3 col = texture2D(tColor, vUv).rgb;

    float z = texture2D(tDepth, vUv).x;
    float viewZ = perspectiveDepthToViewZ(z, uNear, uFar);
    float dist = z >= 1.0 ? 1.0e4 : -viewZ;
    float e = mix(uDepth, dist * uPathScale, uArtificial);

    vec3 hsv = rgb2hsv(max(col, 0.0));
    float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    float gone = smoothstep(cutoff(hsv.x) - 200.0, cutoff(hsv.x), e);

    // What's left of a colour once its wavelength is gone: a dim, blue-cast grey.
    vec3 tint = vec3(0.12, 0.34, 0.70);
    tint /= dot(tint, vec3(0.2126, 0.7152, 0.0722));
    vec3 stripped = luma * mix(vec3(1.0), tint, 0.65) * 0.75; // blue-grey, not neon
    col = mix(col, stripped, gone * smoothstep(0.02, 0.18, hsv.y));

    // Low-saturation pixels still pick up a water cast as depth builds.
    col = mix(col, luma * tint * 0.9, smoothstep(40.0, 900.0, e) * 0.35 * (1.0 - smoothstep(0.02, 0.18, hsv.y)));

    // Glow: light spilling around anything brighter than white (sun, lamps,
    // bioluminescence, sonar). Added in linear light, before tone mapping.
    col += texture2D(tBloom, vUv).rgb * uBloom;

    col = aces(col * uExposure);

    // Vignette + film grain.
    vec2 q = vUv - 0.5;
    col *= 1.0 - dot(q, q) * 0.9;
    float g = hash(vUv * uRes + fract(uTime) * 91.7) - 0.5;
    col += g * uGrain;

    gl_FragColor = vec4(toSRGB(clamp(col, 0.0, 1.0)), 1.0);
  }
`;

// ---- Bloom ----------------------------------------------------------------
// Bright-pass at quarter resolution (4-tap box to avoid shimmer), then a few
// rounds of separable 9-tap gaussian (5 linear-filtered fetches each way).
const brightFrag = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tColor; uniform vec2 uTexel; uniform float uThreshold;
  void main() {
    vec3 c = texture2D(tColor, vUv + uTexel * vec2(-1.0, -1.0)).rgb
           + texture2D(tColor, vUv + uTexel * vec2( 1.0, -1.0)).rgb
           + texture2D(tColor, vUv + uTexel * vec2(-1.0,  1.0)).rgb
           + texture2D(tColor, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
    c *= 0.25;
    // A single NaN pixel would be blurred into a streak: drop it.
    #if __VERSION__ >= 300
    if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
    #endif
    float l = max(max(c.r, c.g), c.b);
    // Soft knee so the glow fades in instead of switching on.
    float k = clamp(l - uThreshold + 0.5, 0.0, 1.0);
    float w = max(l - uThreshold, 0.0) + k * k * 0.5 * 0.5;
    c *= w / max(l, 1e-4);
    gl_FragColor = vec4(min(c, vec3(24.0)), 1.0);
  }
`;
const blurFrag = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tColor; uniform vec2 uDir;
  void main() {
    vec3 c = texture2D(tColor, vUv).rgb * 0.2270270270;
    c += texture2D(tColor, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
    c += texture2D(tColor, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
    c += texture2D(tColor, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
    c += texture2D(tColor, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
    gl_FragColor = vec4(c, 1.0);
  }
`;

export function createAbsorptionPass(renderer, { samples = 0, bloomIterations = 3 } = {}) {
  const gl = renderer.getContext();
  const canHalf =
    renderer.extensions.has('EXT_color_buffer_half_float') ||
    renderer.extensions.has('EXT_color_buffer_float');

  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const depthTexture = new THREE.DepthTexture(size.x, size.y);
  depthTexture.type = THREE.UnsignedIntType;
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: canHalf ? THREE.HalfFloatType : THREE.UnsignedByteType,
    samples: gl instanceof WebGL2RenderingContext ? samples : 0,
    depthTexture,
    depthBuffer: true,
  });

  const material = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tColor: { value: target.texture },
      tDepth: { value: depthTexture },
      uDepth: { value: 0 },
      uArtificial: { value: 0 },
      uPathScale: { value: 38 },
      uNear: { value: 0.1 },
      uFar: { value: 400 },
      uTime: { value: 0 },
      uGrain: { value: 0.035 },
      uExposure: { value: 1 },
      uRes: { value: new THREE.Vector2(size.x, size.y) },
      tBloom: { value: null },
      uBloom: { value: 0.45 },
    },
  });

  const bloomType = canHalf ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const mkTarget = () => new THREE.WebGLRenderTarget(1, 1, { type: bloomType, depthBuffer: false });
  const bloomA = mkTarget();
  const bloomB = mkTarget();
  material.uniforms.tBloom.value = bloomA.texture;
  const brightMat = new THREE.ShaderMaterial({
    vertexShader: vertex, fragmentShader: brightFrag, depthTest: false, depthWrite: false,
    uniforms: { tColor: { value: target.texture }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: canHalf ? 2.2 : 0.9 } },
  });
  const blurMat = new THREE.ShaderMaterial({
    vertexShader: vertex, fragmentShader: blurFrag, depthTest: false, depthWrite: false,
    uniforms: { tColor: { value: null }, uDir: { value: new THREE.Vector2() } },
  });
  function sizeBloom(w, h) {
    const bw = Math.max(1, Math.floor(w / 4)), bh = Math.max(1, Math.floor(h / 4));
    bloomA.setSize(bw, bh);
    bloomB.setSize(bw, bh);
    brightMat.uniforms.uTexel.value.set(1 / w, 1 / h);
  }
  sizeBloom(size.x, size.y);

  // One oversized triangle covers the screen.
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const quad = new THREE.Mesh(geo, material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const runPass = (mat, out) => {
    quad.material = mat;
    renderer.setRenderTarget(out);
    renderer.render(scene, cam);
  };
  function renderBloom() {
    runPass(brightMat, bloomA);
    const texel = new THREE.Vector2(1 / bloomA.width, 1 / bloomA.height);
    for (let i = 0; i < bloomIterations; i++) {
      const spread = 1 + i;
      blurMat.uniforms.tColor.value = bloomA.texture;
      blurMat.uniforms.uDir.value.set(texel.x * spread, 0);
      runPass(blurMat, bloomB);
      blurMat.uniforms.tColor.value = bloomB.texture;
      blurMat.uniforms.uDir.value.set(0, texel.y * spread);
      runPass(blurMat, bloomA);
    }
    quad.material = material;
  }

  return {
    uniforms: material.uniforms,
    setSize(w, h) {
      target.setSize(w, h);
      sizeBloom(w, h);
      material.uniforms.uRes.value.set(w, h);
    },
    // Compile scene programs against the render target (linear output), so
    // the first real frame doesn't stall.
    compile(sceneToDraw, camera) {
      renderer.setRenderTarget(target);
      renderer.compile(sceneToDraw, camera);
      renderer.setRenderTarget(null);
      renderer.compile(scene, cam);
      [brightMat, blurMat].forEach((m) => {
        quad.material = m;
        renderer.compile(scene, cam);
      });
      quad.material = material;
    },
    render(sceneToDraw, camera) {
      material.uniforms.uNear.value = camera.near;
      material.uniforms.uFar.value = camera.far;
      renderer.setRenderTarget(target);
      renderer.render(sceneToDraw, camera);
      if (material.uniforms.uBloom.value > 0) renderBloom();
      renderer.setRenderTarget(null);
      renderer.render(scene, cam);
    },
  };
}
