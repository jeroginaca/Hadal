import * as THREE from 'three';

// Signature moment #2. With the floodlights off, the pointer disturbs the
// water and animals answer with light. A fixed ring buffer of glowing points;
// spawning just rewrites a slot's position and birth time.
// Colours sit around 470–490 nm, the band that travels furthest in seawater
// (and the one most deep-sea animals evolved to use).

export function createBiolum({ count = 700 } = {}) {
  const pos = new Float32Array(count * 3);
  const birth = new Float32Array(count).fill(-100);
  const hue = new Float32Array(count);
  const size = new Float32Array(count);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aBirth', new THREE.BufferAttribute(birth, 1));
  geo.setAttribute('aHue', new THREE.BufferAttribute(hue, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPixel: { value: 1 }, uGain: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aBirth, aHue, aSize;
      uniform float uTime, uPixel;
      varying float vA; varying float vHue;
      void main() {
        float age = uTime - aBirth;
        float env = age < 0.0 ? 0.0 : smoothstep(0.0, 0.07, age) * exp(-age * 1.6);
        env *= 0.75 + 0.25 * sin(age * 38.0 + aHue * 20.0);
        vA = env; vHue = aHue;
        vec3 p = position + vec3(0.0, age * 0.05, 0.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = env > 0.001 ? aSize * uPixel * (1.0 + age * 0.6) * (70.0 / -mv.z) : 0.0;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uGain;
      varying float vA; varying float vHue;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float core = exp(-d * d * 18.0);
        float halo = exp(-d * d * 3.0) * 0.35;
        float a = (core + halo) * vA * uGain;
        if (a < 0.002) discard;
        vec3 c = mix(vec3(0.15, 0.55, 1.0), vec3(0.2, 1.0, 0.75), vHue);
        gl_FragColor = vec4(c * a * 3.0 + core * vA * 0.9, a);
      }`,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 7;

  let head = 0;
  const tmp = new THREE.Vector3();
  const ray = new THREE.Raycaster();

  function put(p, t, hueV, s) {
    const i = head;
    head = (head + 1) % count;
    pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
    birth[i] = t; hue[i] = hueV; size[i] = s;
  }
  function flush() {
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aBirth.needsUpdate = true;
    geo.attributes.aHue.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
  }

  // Spawn a cluster where the pointer ray meets the water at a random range.
  function burst(ndc, camera, t, { chainChance = 0.18, near = 5, far = 14 } = {}) {
    ray.setFromCamera(ndc, camera);
    const dist = near + Math.random() * (far - near);
    const c = ray.ray.at(dist, tmp).clone();
    const h = Math.random() < 0.7 ? 0.1 + Math.random() * 0.3 : 0.6 + Math.random() * 0.4;
    const n = 3 + Math.floor(Math.random() * 4);
    for (let k = 0; k < n; k++) {
      const p = c.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.9));
      put(p, t + Math.random() * 0.12, h, 1.0 + Math.random() * 2.0);
    }
    // Sometimes a siphonophore-like chain: a pulse of light travelling a curve.
    if (Math.random() < chainChance) {
      const dir = new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.6, Math.random() - 0.5).normalize();
      const bend = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.08);
      const p = c.clone();
      const len = 10 + Math.floor(Math.random() * 12);
      for (let k = 0; k < len; k++) {
        dir.add(bend).normalize();
        p.addScaledVector(dir, 0.22);
        put(p, t + 0.08 + k * 0.045, h, 1.3);
      }
    }
    flush();
  }

  return { points, mat, burst };
}
