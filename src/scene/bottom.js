import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbm } from './noise.js';

// Challenger Deep floor: soft sediment, a bait canister, and supergiant
// amphipods (Alicella-like) working the bait. Revealed by a single lamp.

function amphipodGeometry() {
  const parts = [];
  const SEG = 9;
  for (let i = 0; i < SEG; i++) {
    const t = i / (SEG - 1);
    const a = -1.1 + t * 2.0; // curl along the body
    const r = 0.055 * (1 - Math.abs(t - 0.4) * 0.9);
    const s = new THREE.SphereGeometry(1, 8, 6);
    s.scale(r * 1.25, r, r * 0.9);
    s.translate(Math.cos(a) * 0.12, Math.sin(a) * 0.09 + 0.06, 0);
    parts.push(s);
  }
  // Antennae + a few legs.
  const ant = new THREE.CylinderGeometry(0.004, 0.006, 0.18, 4);
  ant.rotateZ(-1.0);
  ant.translate(0.2, 0.1, 0.02);
  const ant2 = ant.clone().translate(0, 0, -0.04);
  parts.push(ant, ant2);
  for (let i = 0; i < 5; i++) {
    const leg = new THREE.CylinderGeometry(0.004, 0.004, 0.08, 3);
    leg.rotateX(i % 2 ? 0.5 : -0.5);
    leg.translate(-0.06 + i * 0.035, -0.0, i % 2 ? 0.03 : -0.03);
    parts.push(leg);
  }
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  g.computeVertexNormals();
  return g;
}

export function createBottom({ lowPower = false } = {}) {
  const group = new THREE.Group();

  const seg = lowPower ? 90 : 140;
  const floorGeo = new THREE.PlaneGeometry(90, 90, seg, seg);
  floorGeo.rotateX(-Math.PI / 2);
  const p = floorGeo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    let h = (fbm(x * 0.08, z * 0.08) - 0.5) * 0.9;
    h += Math.sin(x * 2.2 + fbm(x * 0.4, z * 0.4) * 5) * 0.025; // current ripples
    h += (fbm(x * 1.4, z * 1.4, 2) - 0.5) * 0.06;
    p.setY(i, h);
  }
  floorGeo.computeVertexNormals();
  const floor = new THREE.Mesh(floorGeo, new THREE.MeshLambertMaterial({ color: '#a39580' }));
  group.add(floor);

  // Bait canister on a small weighted plate.
  const bait = new THREE.Group();
  const can = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.14, 0.34, 16),
    new THREE.MeshStandardMaterial({ color: '#d9d4c7', roughness: 0.6 })
  );
  can.position.y = 0.2;
  const plate = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.36, 0.05, 20),
    new THREE.MeshStandardMaterial({ color: '#c3421e', roughness: 0.7 })
  );
  plate.position.y = 0.03;
  bait.add(can, plate);
  bait.position.set(4.6, 0, 0.6);
  group.add(bait);

  // Amphipods.
  const N = lowPower ? 28 : 48;
  const amph = new THREE.InstancedMesh(
    amphipodGeometry(),
    new THREE.MeshStandardMaterial({ color: '#f0d9cf', roughness: 0.35, emissive: '#2a1a18', transparent: true, opacity: 0.93 }),
    N
  );
  amph.frustumCulled = false;
  group.add(amph);
  const bugs = Array.from({ length: N }, (_, i) => ({
    ang: Math.random() * Math.PI * 2,
    r: 0.25 + Math.pow(Math.random(), 1.4) * 2.2,
    speed: (0.3 + Math.random() * 0.9) * (Math.random() < 0.5 ? -1 : 1),
    phase: Math.random() * 10,
    scale: 0.45 + Math.random() * 0.45,
    arrive: i / N, // swarm grows as the chapter progresses
  }));
  const dummy = new THREE.Object3D();

  // The reveal lamp, independent of the user's floodlight toggle.
  const lamp = new THREE.SpotLight('#fff1d8', 0, 22, 0.55, 0.6, 1.3);
  lamp.position.set(2.6, 2.2, 0.2);
  lamp.target.position.set(4.6, 0, 0.6);
  group.add(lamp, lamp.target);

  return {
    group,
    lamp,
    update(t, dt, gather, reduced) {
      const bx = bait.position.x, bz = bait.position.z;
      bugs.forEach((b, i) => {
        const on = gather > b.arrive ? 1 : 0;
        if (!reduced) {
          b.ang += b.speed * dt * (0.6 + 0.4 * Math.sin(t * 3 + b.phase));
        }
        const r = b.r * (1.6 - gather * 0.6) + (1 - on) * 30;
        const x = bx + Math.cos(b.ang) * r;
        const z = bz + Math.sin(b.ang) * r;
        const hop = reduced ? 0 : Math.max(0, Math.sin(t * 5 + b.phase)) * 0.03;
        dummy.position.set(x, 0.05 + hop, z);
        dummy.rotation.set(0, -b.ang - Math.sign(b.speed) * Math.PI / 2, 0);
        dummy.scale.setScalar(b.scale * on);
        dummy.updateMatrix();
        amph.setMatrixAt(i, dummy.matrix);
      });
      amph.instanceMatrix.needsUpdate = true;
    },
  };
}

// A deep-red jellyfish (Atolla-like) for the twilight zone. Deep-sea animals
// are often red because red is invisible down here — it vanishes on cue.
export function createJelly() {
  const g = new THREE.Group();
  const bell = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.MeshStandardMaterial({ color: '#b3121c', roughness: 0.3, emissive: '#3a0306', transparent: true, opacity: 0.9, side: THREE.DoubleSide })
  );
  bell.scale.set(1, 0.55, 1);
  g.add(bell);
  const tMat = new THREE.LineBasicMaterial({ color: '#e0343a', transparent: true, opacity: 0.8 });
  const tentacles = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const pts = Array.from({ length: 12 }, (_, k) => new THREE.Vector3(Math.cos(a) * 0.42, -k * 0.12, Math.sin(a) * 0.42));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), tMat);
    line.userData = { a, pts };
    tentacles.push(line);
    g.add(line);
  }
  return {
    group: g,
    update(t) {
      const pulse = Math.sin(t * 1.6);
      bell.scale.set(1 + pulse * 0.06, 0.55 - pulse * 0.05, 1 + pulse * 0.06);
      tentacles.forEach((l) => {
        const pos = l.geometry.attributes.position;
        for (let k = 0; k < 12; k++) {
          const sway = Math.sin(t * 1.3 - k * 0.45 + l.userData.a * 2) * 0.03 * k;
          pos.setXYZ(k, Math.cos(l.userData.a) * (0.42 - k * 0.012) + sway, -k * 0.12, Math.sin(l.userData.a) * (0.42 - k * 0.012));
        }
        pos.needsUpdate = true;
      });
    },
  };
}
