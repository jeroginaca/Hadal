import * as THREE from 'three';
import { fbm } from './noise.js';

// Signature moment #3. The abyssal plain is first drawn by sonar as a point
// cloud, ping by ping, then solid geometry fills in behind it as you scroll.
// Points and mesh share one heightfield.

export function createSeafloor({ lowPower = false } = {}) {
  const SIZE = 150;
  const heightAt = (x, z) => {
    let h = (fbm(x * 0.035, z * 0.035) - 0.5) * 3.2;
    h += Math.pow(fbm(x * 0.012 + 7, z * 0.012 - 3, 3), 3) * 16;
    h += (fbm(x * 0.3, z * 0.3, 2) - 0.5) * 0.25;
    return h - 1.5;
  };
  const pseg = lowPower ? 180 : 300;
  const N = pseg + 1;
  const pts = new Float32Array(N * N * 3);
  const heights = new Float32Array(N * N);
  const step = SIZE / pseg;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) heights[i * N + j] = heightAt((i / pseg - 0.5) * SIZE, (j / pseg - 0.5) * SIZE);
  }
  // Per-point hillshade from neighbouring heights, so relief reads in the
  // cloud before any mesh exists. Regular grid: perspective makes it ground.
  const shade = new Float32Array(N * N);
  const L = new THREE.Vector3(-0.5, 0.7, 0.5).normalize();
  const nrm = new THREE.Vector3();
  const H = (i, j) => heights[Math.min(N - 1, Math.max(0, i)) * N + Math.min(N - 1, Math.max(0, j))];
  let k = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const idx = i * N + j;
      pts[k++] = (i / pseg - 0.5) * SIZE; pts[k++] = heights[idx] + 0.05; pts[k++] = (j / pseg - 0.5) * SIZE;
      nrm.set(H(i - 1, j) - H(i + 1, j), 2 * step, H(i, j - 1) - H(i, j + 1)).normalize();
      shade[idx] = Math.max(0, nrm.dot(L));
    }
  }
  // Solid mesh at half the grid resolution, reusing the same heights.
  const seg = pseg / 2;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    // Abyssal plains are flat, broken by low hills and the odd seamount.
    const gi = Math.round((p.getX(i) / SIZE + 0.5) * pseg), gj = Math.round((p.getZ(i) / SIZE + 0.5) * pseg);
    p.setY(i, H(gi, gj));
  }
  geo.computeVertexNormals();

  const pointGeo = new THREE.BufferGeometry();
  pointGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  pointGeo.setAttribute('aShade', new THREE.BufferAttribute(shade, 1));

  const shared = {
    uCenter: { value: new THREE.Vector2() },
    uReveal: { value: 0 },  // radius the sonar has mapped
    uFill: { value: 0 },    // radius of solid geometry
    uPing: { value: 0 },    // current ping front radius
    uTime: { value: 0 },
    uPixel: { value: 1 },
  };

  // --- point cloud -------------------------------------------------------
  const pointMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: shared,
    vertexShader: /* glsl */ `
      attribute float aShade;
      uniform vec2 uCenter; uniform float uReveal, uFill, uPing, uPixel;
      varying float vA; varying float vH;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        float r = length(wp.xz - uCenter);
        float mapped = 1.0 - smoothstep(uReveal - 2.0, uReveal, r);
        float rq = (r - uPing) / 1.2;
        float ring = exp(-rq * rq) * step(r, uReveal + 1.0);
        float filled = smoothstep(uFill - 6.0, uFill, r); // fade points once mesh is there
        // Bathymetric contour lines: what a multibeam survey actually draws.
        float contour = smoothstep(0.72, 1.0, fract(position.y * 2.2));
        float lit = pow(aShade, 3.0);
        vA = (mapped * (0.45 + 0.8 * lit + 0.7 * contour) + ring * 3.0) * mix(0.1, 1.0, filled);
        vH = position.y;
        vec4 mv = viewMatrix * wp;
        vA *= 1.0 - smoothstep(30.0, 75.0, -mv.z); // far returns are weaker
        gl_Position = projectionMatrix * mv;
        gl_PointSize = max(1.3, (1.4 + ring * 3.0 + contour * 0.8) * (26.0 / -mv.z)) * uPixel;
      }`,
    fragmentShader: /* glsl */ `
      varying float vA; varying float vH;
      void main() {
        if (vA < 0.01) discard;
        float d = length(gl_PointCoord - 0.5);
        float a = (1.0 - smoothstep(0.1, 0.5, d)) * vA;
        vec3 c = mix(vec3(0.2, 0.6, 0.8), vec3(0.7, 1.0, 0.95), clamp((vH + 3.0) / 10.0, 0.0, 1.0)) * 0.7;
        gl_FragColor = vec4(c * a, a);
      }`,
  });
  const points = new THREE.Points(pointGeo, pointMat);
  points.frustumCulled = false;
  points.renderOrder = 4;

  // --- solid mesh (Lambert so the floodlights work), clipped to uFill -----
  const meshMat = new THREE.MeshLambertMaterial({ color: '#5b5549' });
  meshMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSW; varying vec3 vSN;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvSW = (modelMatrix * vec4(transformed,1.0)).xyz; vSN = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSW; varying vec3 vSN; uniform vec2 uCenter; uniform float uFill;')
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        float rr = length(vSW.xz - uCenter);
        float dth = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        if (rr > uFill - 1.5 * dth) discard;`
      )
      .replace(
        '#include <opaque_fragment>',
        `// Low-light hillshade + a sonar-lit seam at the fill edge.
        float shade = clamp(dot(normalize(vSN), normalize(vec3(-0.4, 0.8, 0.3))), 0.0, 1.0);
        outgoingLight += vec3(0.07, 0.12, 0.16) * shade * 0.35;
        outgoingLight += vec3(0.1, 0.35, 0.4) * smoothstep(0.9, 1.0, fract((vSW.y + 6.0) * 2.2)) * 0.035;
        float sq = (uFill - rr) / 1.5;
        outgoingLight += vec3(0.2, 0.8, 0.9) * exp(-sq * sq) * 0.8;
        #include <opaque_fragment>`
      );
  };
  const mesh = new THREE.Mesh(geo, meshMat);

  const group = new THREE.Group();
  group.add(mesh, points);
  return { group, shared };
}

// Trench walls: two long faceted rock faces either side of the sub that rise
// past the camera and close in as depth increases.
export function createTrench({ lowPower = false } = {}) {
  const make = (sign) => {
    const g = new THREE.PlaneGeometry(320, 320, lowPower ? 90 : 140, lowPower ? 70 : 110);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      const d = (fbm(x * 0.03 + sign * 10, y * 0.03) - 0.5) * 16 + (fbm(x * 0.12, y * 0.12, 3) - 0.5) * 4;
      // Strata: faint horizontal banding.
      p.setZ(i, d + Math.sin(y * 0.8 + fbm(x * 0.05, y * 0.05) * 6) * 0.35);
    }
    g.computeVertexNormals();
    const m = new THREE.Mesh(
      g,
      new THREE.MeshLambertMaterial({ color: '#4b4741', flatShading: true, emissive: '#0b1822', emissiveIntensity: 0.35 })
    );
    m.rotation.y = sign > 0 ? Math.PI : 0; // face inward
    return m;
  };
  const left = make(1);
  const right = make(-1);
  const group = new THREE.Group();
  group.add(left, right);
  return {
    group,
    update(halfWidth, y) {
      left.position.set(80, y, halfWidth + 4);
      right.position.set(80, y, -halfWidth - 4);
    },
  };
}
