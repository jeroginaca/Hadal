import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WATER_BG } from './surface.js';

// A school of sardine-like fish for the sunlit water.
//
// What makes real schools read as real:
// - Silver flanks are vertical mirrors (guanine platelets). They show the
//   water around them, so a fish is nearly invisible until it rolls and
//   catches the bright water above: that is the flash. We reflect the same
//   backdrop the scene uses instead of a generic environment map.
// - A dark blue-green back, a thin iridescent band, a white belly.
// - Carangiform swimming: the front third is almost rigid, the wave grows
//   toward the tail, and the tail beats faster when a fish speeds up.
// - A polarised school: everyone heads the same way, spacing ~1 body length,
//   the turn starts at the front and sweeps back, fish bank into turns.

// Body length is 1 (snout at z = +0.5), scaled per instance.
const PED = 0.82; // where the body narrows into the tail (fraction of length)
const halfH = (s) => {
  let p;
  if (s < 0.3) p = 1 - Math.pow(1 - s / 0.3, 2.4);
  else p = 0.2 + 0.8 * Math.pow(Math.cos(((s - 0.3) / (PED - 0.3)) * Math.PI * 0.5), 1.3);
  return 0.085 * p;
};
const halfW = (s) => 0.048 * Math.pow(halfH(s) / 0.085, 0.9);

function bodyGeometry() {
  const NS = 30, NA = 16;
  const pos = [], body = [], idx = [];
  // Tip vertex, then rings.
  pos.push(0, -0.004, 0.5); body.push(0, 0, 0);
  for (let i = 1; i <= NS; i++) {
    const s = PED * Math.pow(i / NS, 1.25);
    const H = halfH(s), W = halfW(s);
    for (let j = 0; j < NA; j++) {
      const th = (j / NA) * Math.PI * 2;
      const sn = Math.sin(th), cs = Math.cos(th);
      // Keeled belly, rounder back.
      const x = W * cs * (1 - 0.35 * Math.pow(Math.max(-sn, 0), 2));
      const y = H * sn * (sn > 0 ? 0.96 : 1.04) - 0.004;
      pos.push(x, y, 0.5 - s);
      body.push(s, sn, 0);
    }
  }
  // Tail cap centre.
  pos.push(0, -0.004, 0.5 - PED); body.push(PED, 0, 0);
  const ring = (i, j) => 1 + (i - 1) * NA + (j % NA);
  for (let j = 0; j < NA; j++) idx.push(0, ring(1, j + 1), ring(1, j));
  for (let i = 1; i < NS; i++) {
    for (let j = 0; j < NA; j++) {
      const a = ring(i, j), b = ring(i, j + 1), c = ring(i + 1, j), d = ring(i + 1, j + 1);
      idx.push(a, b, c, b, d, c);
    }
  }
  const cap = pos.length / 3 - 1;
  for (let j = 0; j < NA; j++) idx.push(cap, ring(NS, j), ring(NS, j + 1));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aBody', new THREE.Float32BufferAttribute(body, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

// A flat fin from a 2D outline in the (z, y) plane, then placed.
function finGeometry(shape, place) {
  const g = new THREE.ShapeGeometry(shape, 6);
  const p = g.attributes.position;
  const out = new Float32Array(p.count * 3);
  const body = new Float32Array(p.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(0, p.getY(i), p.getX(i));
    place?.(v);
    out.set([v.x, v.y, v.z], i * 3);
    body.set([0.5 - p.getX(i), 0, 1], i * 3);
  }
  const f = new THREE.BufferGeometry();
  f.setAttribute('position', new THREE.BufferAttribute(out, 3));
  f.setAttribute('aBody', new THREE.BufferAttribute(body, 3));
  f.setIndex(g.index);
  f.computeVertexNormals();
  return f.toNonIndexed();
}

function fishGeometry() {
  // Deeply forked caudal fin.
  const tail = new THREE.Shape();
  tail.moveTo(-0.3, 0.022);
  tail.quadraticCurveTo(-0.41, 0.06, -0.5, 0.12);
  tail.quadraticCurveTo(-0.44, 0.05, -0.405, 0.0);
  tail.quadraticCurveTo(-0.44, -0.05, -0.5, -0.12);
  tail.quadraticCurveTo(-0.41, -0.06, -0.3, -0.022);
  tail.lineTo(-0.3, 0.022);
  // Dorsal fin, mid-back.
  const dorsal = new THREE.Shape();
  dorsal.moveTo(0.13, 0.072);
  dorsal.quadraticCurveTo(0.1, 0.11, 0.08, 0.14);
  dorsal.quadraticCurveTo(0.03, 0.1, -0.01, 0.085);
  dorsal.lineTo(-0.01, 0.06);
  dorsal.lineTo(0.13, 0.072);
  // Small anal fin.
  const anal = new THREE.Shape();
  anal.moveTo(-0.13, -0.06);
  anal.lineTo(-0.2, -0.095);
  anal.quadraticCurveTo(-0.23, -0.06, -0.27, -0.04);
  anal.lineTo(-0.13, -0.045);
  // Paired fins: pectorals behind the gill, pelvics under the belly.
  const pect = new THREE.Shape();
  pect.moveTo(0.3, -0.02);
  pect.quadraticCurveTo(0.2, -0.03, 0.17, -0.07);
  pect.lineTo(0.3, -0.045);
  const pelv = new THREE.Shape();
  pelv.moveTo(0.04, -0.085);
  pelv.lineTo(-0.06, -0.12);
  pelv.lineTo(-0.02, -0.09);
  const paired = (shape, x, roll) =>
    [1, -1].map((sg) =>
      finGeometry(shape, (v) => {
        v.applyAxisAngle(new THREE.Vector3(0, 0, 1), sg * roll);
        v.x += sg * x;
      })
    );
  const g = mergeGeometries([
    bodyGeometry(),
    finGeometry(tail),
    finGeometry(dorsal),
    finGeometry(anal),
    ...paired(pect, 0.045, 0.5),
    ...paired(pelv, 0.02, 0.45),
  ]);
  return g;
}

export function createFish({ count = 260, waterUniforms } = {}) {
  const geo = fishGeometry();
  const swim = new Float32Array(count); // tail-beat phase, integrated on the CPU
  const amp = new Float32Array(count).fill(1);
  const swimAttr = new THREE.InstancedBufferAttribute(swim, 1).setUsage(THREE.DynamicDrawUsage);
  const ampAttr = new THREE.InstancedBufferAttribute(amp, 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aSwim', swimAttr);
  geo.setAttribute('aAmp', ampAttr);

  const fade = { value: 1 };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWaterColor = waterUniforms.uColor;
    shader.uniforms.uWaterLight = waterUniforms.uLight;
    shader.uniforms.uFade = fade;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aBody; attribute float aSwim; attribute float aAmp;
        varying vec3 vBody; varying vec3 vObj;`
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        // Swimming wave, rigid at the head, growing toward the tail.
        float sS = aBody.x;
        float sPh = 6.2831 * 0.85 * sS - aSwim;
        float sA = aAmp * (0.01 + 0.1 * sS * sS);
        float sOff = sA * sin(sPh);
        float sSlope = aAmp * 0.2 * sS * sin(sPh) + sA * cos(sPh) * 6.2831 * 0.85; // d(offset)/ds
        objectNormal.z += sSlope * objectNormal.x;
        objectNormal = normalize(objectNormal);`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vBody = aBody; vObj = position;
        transformed.x += sOff;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vBody; varying vec3 vObj;
        uniform vec3 uWaterColor; uniform float uWaterLight; uniform float uFade;
        ${WATER_BG}`
      )
      .replace(
        '#include <fog_fragment>',
        `#include <fog_fragment>
        // Leaving the school behind: dissolve into the water behind each fish.
        gl_FragColor.rgb = mix(waterBg(-inverseTransformDirection(normalize(vViewPosition), viewMatrix), uWaterColor, uWaterLight), gl_FragColor.rgb, uFade);`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float yn = vBody.y, fin = vBody.z;
        float backK = smoothstep(0.28, 0.55, yn);
        float bellyK = 1.0 - smoothstep(-0.75, -0.45, yn);
        vec3 back = vec3(0.018, 0.05, 0.062);
        vec3 side = vec3(0.07, 0.08, 0.085);
        vec3 belly = vec3(0.5, 0.52, 0.54);
        vec3 base = mix(mix(side, belly, bellyK), back, backK);
        // A dark stripe down the spine, and a tapering snout.
        base *= 1.0 - 0.5 * smoothstep(0.85, 0.98, yn);
        // Eye: black pupil in a silvery iris, large as in real sardines.
        float er = length(vec2(vObj.z - 0.415, vObj.y - 0.012));
        float eye = (1.0 - fin) * (1.0 - smoothstep(0.024, 0.028, er));
        float pupil = (1.0 - fin) * (1.0 - smoothstep(0.013, 0.016, er));
        // Gill cover edge.
        float gill = (1.0 - fin) * smoothstep(0.006, 0.0, abs(vObj.z - 0.335 - 0.25 * vObj.y * vObj.y * 20.0)) * step(abs(yn), 0.7);
        base = mix(base, vec3(0.03), gill * 0.6);
        base = mix(base, vec3(0.35, 0.33, 0.28), eye);
        base = mix(base, vec3(0.0), pupil);
        // Fins: dusky, darker toward the edges (caudal tips are near black in sardines).
        float finEdge = smoothstep(0.86, 1.0, vBody.x) + smoothstep(0.05, 0.13, abs(vObj.y)) * 0.6;
        vec3 finCol = mix(vec3(0.16, 0.17, 0.15), vec3(0.03, 0.05, 0.06), clamp(finEdge, 0.0, 1.0));
        base = mix(base, finCol, fin);
        diffuseColor.rgb = base;
        // How much of each part acts as a mirror.
        float mirror = mix(mix(0.9, 0.55, bellyK), 0.1, backK);
        mirror = mix(mirror, 0.25, eye);
        mirror *= 1.0 - pupil;
        mirror = mix(mirror, 0.0, fin);`
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 nW = inverseTransformDirection(normal, viewMatrix);
          vec3 vW = inverseTransformDirection(normalize(vViewPosition), viewMatrix);
          // Scale platelets stand vertical, so the mirror is flatter than the body.
          vec3 nM = normalize(vec3(nW.x, nW.y * 0.75, nW.z));
          vec3 R = reflect(-vW, nM);
          vec3 refl = waterBg(R, uWaterColor, uWaterLight);
          float ndv = abs(dot(nM, vW));
          // Thin-film iridescence: a faint blue-violet-green shift with angle,
          // strongest in the band between the back and the silver flank.
          vec3 irid = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + ndv * 1.4 + vObj.z * 1.5));
          float band = smoothstep(0.1, 0.35, yn) * (1.0 - smoothstep(0.4, 0.62, yn));
          refl *= mix(vec3(1.0), irid * 1.3, 0.1 + 0.3 * band);
          outgoingLight += refl * mirror * mix(1.0, 1.3, 1.0 - ndv);
          // Fins: thin and translucent, so they show the water behind them.
          vec3 behind = waterBg(-vW, uWaterColor, uWaterLight);
          outgoingLight = mix(outgoingLight, behind * 0.7 + outgoingLight * 0.6, fin * 0.35);
        }
        #include <opaque_fragment>`
      );
  };

  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;

  // Formation: a flattened ellipsoid, fish kept about a body length apart.
  const fish = [];
  const tries = new THREE.Vector3();
  while (fish.length < count) {
    tries.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
    if (tries.lengthSq() > 1) continue;
    const off = new THREE.Vector3(tries.x * 1.7, tries.y * 0.85, tries.z * 2.2);
    const minD = fish.length > count * 0.9 ? 0.18 : 0.26;
    if (fish.some((f) => f.off.distanceToSquared(off) < minD * minD)) continue;
    fish.push({
      off,
      // The front of the school turns first; the turn sweeps back.
      lag: (2.2 - off.z) * 0.2 + Math.random() * 0.1,
      size: 0.24 + Math.random() * 0.09,
      seed: Math.random() * 100,
    });
  }

  // The school mills in a slow loop in the open water off the sub's stern:
  // it swings in close to the camera, turns, and heads away into the blue.
  // A points away from the sunlight-chapter camera, B across its view.
  const LOOP_C = new THREE.Vector3(-7.4, 0.9, 0.33);
  const LOOP_A = new THREE.Vector3(-2.47, 0, -2.03);
  const LOOP_B = new THREE.Vector3(-1.4, 0, 1.7);
  const path = (t, out) => {
    const a = t * ((Math.PI * 2) / 32);
    return out.copy(LOOP_C).addScaledVector(LOOP_A, Math.cos(a)).addScaledVector(LOOP_B, Math.sin(a)).setY(LOOP_C.y + Math.sin(2 * a + 1) * 0.5);
  };
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  const C = new THREE.Vector3(), C2 = new THREE.Vector3();
  function posAt(f, t, out) {
    const tt = t - f.lag;
    path(tt, C);
    path(tt + 0.05, C2);
    fwd.subVectors(C2, C).normalize();
    right.crossVectors(fwd, Y).normalize();
    up.crossVectors(right, fwd);
    // Each fish shuffles around its slot, and surges forward and back.
    const s = f.seed;
    const ox = f.off.x + Math.sin(t * 0.23 + s) * 0.18;
    const oy = f.off.y + Math.sin(t * 0.31 + s * 1.7) * 0.1;
    const oz = f.off.z + Math.sin(t * 0.47 + s * 2.3) * 0.25;
    return out.copy(C).addScaledVector(right, ox).addScaledVector(up, oy).addScaledVector(fwd, oz);
  }

  const P0 = new THREE.Vector3(), P1 = new THREE.Vector3(), P2 = new THREE.Vector3();
  const vel = new THREE.Vector3(), acc = new THREE.Vector3();
  const bx = new THREE.Vector3(), by = new THREE.Vector3(), bz = new THREE.Vector3(), rx = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const h = 0.08;
  let lastT = null;

  return {
    mesh,
    mat,
    setFade(k) {
      fade.value = k;
    },
    update(t) {
      const dt = lastT === null ? 0 : Math.min(Math.max(t - lastT, 0), 0.1);
      lastT = t;
      for (let i = 0; i < count; i++) {
        const f = fish[i];
        posAt(f, t - h, P0);
        posAt(f, t, P1);
        posAt(f, t + h, P2);
        vel.subVectors(P2, P0).multiplyScalar(1 / (2 * h));
        acc.copy(P2).add(P0).addScaledVector(P1, -2).multiplyScalar(1 / (h * h));
        const speed = vel.length();
        bz.copy(vel).normalize();
        bx.crossVectors(Y, bz).normalize();
        by.crossVectors(bz, bx);
        // Bank into turns, plus a small individual roll: this is what flashes.
        const lat = acc.dot(bx);
        const roll = THREE.MathUtils.clamp(lat * 0.35, -0.6, 0.6) + Math.sin(t * (0.9 + (f.seed % 1) * 0.8) + f.seed * 7) * 0.28;
        const cr = Math.cos(roll), sr = Math.sin(roll);
        rx.copy(bx).multiplyScalar(cr).addScaledVector(by, sr);
        by.multiplyScalar(cr).addScaledVector(bx, -sr);
        m.makeBasis(rx, by, bz).scale(tries.setScalar(f.size)).setPosition(P1);
        mesh.setMatrixAt(i, m);
        // Tail beat: faster when a fish is catching up, with brief glides.
        const glide = THREE.MathUtils.smoothstep(Math.sin(t * 0.41 + f.seed * 3.1), 0.75, 0.95);
        swim[i] += dt * Math.PI * 2 * (1.6 + speed * 1.3) * (1 - glide * 0.6);
        amp[i] = (0.75 + Math.min(Math.abs(lat), 1.5) * 0.25) * (1 - glide * 0.75);
      }
      mesh.instanceMatrix.needsUpdate = true;
      swimAttr.needsUpdate = true;
      ampAttr.needsUpdate = true;
    },
  };
}
