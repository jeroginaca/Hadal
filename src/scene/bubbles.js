import * as THREE from 'three';

// Bubbles venting from the sub (ballast vents and thruster housings). Each
// bubble rises from an emitter, wobbles, grows a little as pressure drops,
// and loops. Drawn as small bright-rimmed discs, which is how bubbles read
// on camera: a dark core with a lit edge.

export function createBubbles({ count = 90 } = {}) {
  const EMITTERS = [
    [-1.2, 1.35, 0.2], [0.4, 1.4, -0.15], [-2.9, 0.45, 0.0], [-1.35, 0.7, 0.98], [-1.35, 0.7, -0.98],
  ].map((p) => new THREE.Vector3(...p));
  const RISE = 9; // units a bubble travels before it recycles

  const base = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const e = EMITTERS[i % EMITTERS.length];
    base[i * 3] = e.x + (Math.random() - 0.5) * 0.2;
    base[i * 3 + 1] = e.y;
    base[i * 3 + 2] = e.z + (Math.random() - 0.5) * 0.2;
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(base, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uLight: { value: 1 }, uPixel: { value: 1 }, uRise: { value: RISE } },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime, uPixel, uRise;
      varying float vFade;
      void main() {
        float t = fract(uTime * (0.12 + aSeed * 0.1) + aSeed);
        vec3 p = position;
        p.y += t * uRise;
        p.x += sin(t * 18.0 + aSeed * 40.0) * 0.06 * (0.5 + t);
        p.z += cos(t * 15.0 + aSeed * 23.0) * 0.06 * (0.5 + t);
        vFade = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.75, 1.0, t));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (0.05 + aSeed * 0.06) * (1.0 + t * 0.6) * uPixel * (900.0 / -mv.z);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uLight;
      varying float vFade;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float rim = smoothstep(0.55, 0.9, d) * (1.0 - smoothstep(0.9, 1.0, d));
        float glint = smoothstep(0.35, 0.0, length(gl_PointCoord - vec2(0.35, 0.3)));
        float a = (rim * 0.8 + glint * 0.9 + 0.06) * vFade * uLight;
        gl_FragColor = vec4(vec3(0.85, 0.97, 1.0) * a, a);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 6;
  return { points, mat };
}
