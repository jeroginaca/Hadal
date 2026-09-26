import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// HTI-01 "Tenebra". A Shinkai-style deep submergence vehicle: a streamlined
// syntactic-foam fairing, titanium crew sphere slung under the bow, ducted
// stern thruster with X-tail, skids, and a working bow. Built entirely in
// code (lathe/tube/extrude geometry + PBR), so nothing to download.
// Long axis is X, bow at +X. Each part group knows its explode direction for
// the vessel chapter. A GLB can replace the hull: see attachModel().

// Colour checker (sRGB, the classic 24-patch layout). The camera frames this
// in the twilight zone so the absorption pass has something honest to eat.
const CHECKER = [
  [115, 82, 68], [194, 150, 130], [98, 122, 157], [87, 108, 67], [133, 128, 177], [103, 189, 170],
  [214, 126, 44], [80, 91, 166], [193, 90, 99], [94, 60, 108], [157, 188, 64], [224, 163, 46],
  [56, 61, 150], [70, 148, 73], [175, 54, 60], [231, 199, 31], [187, 86, 149], [8, 133, 161],
  [243, 243, 242], [200, 200, 200], [160, 160, 160], [122, 122, 121], [85, 85, 85], [52, 52, 52],
];

function checkerTexture() {
  const c = document.createElement('canvas');
  c.width = 384; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#111'; g.fillRect(0, 0, 384, 256);
  CHECKER.forEach(([r, gg, b], i) => {
    const x = (i % 6) * 62 + 10, y = Math.floor(i / 6) * 60 + 10;
    g.fillStyle = `rgb(${r},${gg},${b})`;
    g.fillRect(x, y, 54, 54);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Hull livery: name, registration and a pinstripe, drawn along the hull axis.
// Canvas X runs around the hull (lathe u), canvas Y runs along it (lathe v).
function liveryTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 1024;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 1024);
  g.fillStyle = '#e4572e';
  g.fillRect(238, 0, 10, 1024);        // pinstripe just under the rub rail
  g.fillStyle = '#1d2a33';
  g.fillRect(229, 0, 3, 1024);
  g.save();
  g.translate(128, 512);
  g.rotate(-Math.PI / 2);
  g.textAlign = 'center';
  g.fillStyle = '#16222b';
  g.font = '600 64px "IBM Plex Mono", Menlo, monospace';
  g.fillText('HTI-01  TENEBRA', 0, -12);
  g.font = '500 22px "IBM Plex Mono", Menlo, monospace';
  g.fillStyle = '#3a4a55';
  g.fillText('HADAL TRENCH INSTITUTE · RATED 11,000 M', 0, 34);
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Hull surface detail on the lathe UVs (x = around, y = along the axis):
// panel seams, rivet lines and an access hatch as a bump map, plus uneven
// grime/wear as a roughness map. Paint that has been to 11 km and back.
function hullDetailMaps() {
  const S = 1024;
  const bump = document.createElement('canvas');
  bump.width = bump.height = S;
  const b = bump.getContext('2d');
  b.fillStyle = '#808080'; b.fillRect(0, 0, S, S);
  b.strokeStyle = '#3c3c3c'; b.lineWidth = 3;
  [0.33, 0.66].forEach((u) => { b.beginPath(); b.moveTo(u * S, 0); b.lineTo(u * S, S); b.stroke(); });
  [0.12, 0.3, 0.47, 0.64, 0.8].forEach((v) => { b.beginPath(); b.moveTo(0, v * S); b.lineTo(S, v * S); b.stroke(); });
  b.fillStyle = '#b4b4b4';
  [0.12, 0.3, 0.47, 0.64, 0.8].forEach((v) => {
    for (let x = 6; x < S; x += 22) { b.beginPath(); b.arc(x, v * S + 9, 2.2, 0, Math.PI * 2); b.fill(); }
  });
  b.strokeStyle = '#4a4a4a'; b.lineWidth = 3;
  b.strokeRect(0.42 * S, 0.5 * S, 0.12 * S, 0.1 * S);   // access hatch
  b.strokeRect(0.1 * S, 0.33 * S, 0.08 * S, 0.12 * S);
  const rough = document.createElement('canvas');
  rough.width = rough.height = 256;
  const r = rough.getContext('2d');
  r.fillStyle = '#6e6e6e'; r.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    const g = 90 + Math.random() * 80 | 0;
    r.fillStyle = `rgba(${g},${g},${g},0.22)`;
    const x = Math.random() * 256, y = Math.random() * 256;
    r.fillRect(x, y, 1 + Math.random() * 3, 4 + Math.random() * 30); // streaks
  }
  const bt = new THREE.CanvasTexture(bump);
  const rt = new THREE.CanvasTexture(rough);
  [bt, rt].forEach((t) => { t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping; });
  return { bump: bt, rough: rt };
}

// Adds animated caustics to the upward-facing, submerged parts of the hull.
export const causticUniforms = {
  uTime: { value: 0 },
  uCaustic: { value: 1 },
  uSurfaceY: { value: 0 },
};
function withCaustics(mat) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, causticUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCW; varying vec3 vCN;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvCW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvCN = normalize(mat3(modelMatrix) * objectNormal);'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vCW; varying vec3 vCN;
        uniform float uTime, uCaustic, uSurfaceY;
        float caustic(vec2 p) {
          vec2 i = p; float c = 1.0; float inten = 0.005;
          for (int n = 0; n < 3; n++) {
            float t = uTime * (1.0 - (3.5 / float(n + 1)));
            i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
            c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
          }
          c /= 3.0; c = 1.17 - pow(c, 1.4);
          return clamp(pow(abs(c), 8.0), 0.0, 1.0);
        }`
      )
      .replace(
        '#include <opaque_fragment>',
        `float cm = uCaustic * smoothstep(-0.1, 0.7, vCN.y) * step(vCW.y, uSurfaceY);
        if (cm > 0.001) {
          // Two scales of rippled light, projected from above, drifting.
          float cs = caustic(vCW.xz * 1.9 + vec2(uTime * 0.05, 0.0)) * 0.7 + caustic(vCW.xz * 3.7 - vec2(0.0, uTime * 0.04)) * 0.5;
          outgoingLight += vec3(0.8, 0.97, 1.0) * cs * cm * 0.9;
        }
        #include <opaque_fragment>`
      );
  };
  return mat;
}

// ---- Hull profile ---------------------------------------------------------
// (radius, axial position) from stern tip to bow tip, smoothed by a spline.
const PROFILE_KEYS = [
  [0.0, -2.72], [0.2, -2.68], [0.36, -2.55], [0.52, -2.3], [0.68, -1.88], [0.8, -1.35],
  [0.88, -0.7], [0.91, 0.1], [0.9, 0.85], [0.85, 1.4], [0.75, 1.8], [0.58, 2.1], [0.34, 2.28], [0.0, 2.36],
];
function hullProfile(n) {
  const curve = new THREE.SplineCurve(PROFILE_KEYS.map(([r, a]) => new THREE.Vector2(r, a)));
  return curve.getSpacedPoints(n).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
}
const PROFILE = hullProfile(200);
function radiusAt(a) {
  for (let i = 1; i < PROFILE.length; i++) {
    if (PROFILE[i].y >= a) {
      const p0 = PROFILE[i - 1], p1 = PROFILE[i];
      return p0.x + ((p1.x - p0.x) * (a - p0.y)) / Math.max(1e-6, p1.y - p0.y);
    }
  }
  return 0;
}
// Lathe around Y, then turn it so the lathe axis becomes +X.
function latheX(points, segments, phiStart, phiLength) {
  const g = new THREE.LatheGeometry(points, segments, phiStart, phiLength);
  g.rotateZ(-Math.PI / 2);
  return g;
}

// A capsule "limb" between two points (arms, struts).
function limb(a, b, r, mat, seg = 12) {
  const d = b.clone().sub(a);
  const len = d.length();
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, len), 4, seg), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

// Ducted thruster: nozzle-profiled duct (inner + outer skin), stator vanes,
// hub with a nose cone, five-blade prop. Thrust axis = local +Y.
function makeThruster({ radius = 0.26, length = 0.38, seg, M }) {
  const g = new THREE.Group();
  const R = radius, L = length, t = 0.045;
  const duct = [
    new THREE.Vector2(R, -L / 2), new THREE.Vector2(R + t * 0.6, -L / 2 + 0.02),
    new THREE.Vector2(R + t, -L * 0.1), new THREE.Vector2(R + t * 0.7, L / 2 - 0.02),
    new THREE.Vector2(R + 0.005, L / 2), new THREE.Vector2(R - 0.004, L * 0.1),
    new THREE.Vector2(R, -L / 2),
  ];
  g.add(new THREE.Mesh(new THREE.LatheGeometry(duct, seg), M.orange));
  const hub = new THREE.Mesh(
    new THREE.LatheGeometry(
      [new THREE.Vector2(0, -L * 0.55), new THREE.Vector2(0.07, -L * 0.45), new THREE.Vector2(0.08, L * 0.2), new THREE.Vector2(0.05, L * 0.45), new THREE.Vector2(0, L * 0.5)],
      16
    ),
    M.darkMetal
  );
  g.add(hub);
  for (let i = 0; i < 4; i++) {
    const vane = new THREE.Mesh(new THREE.BoxGeometry(0.018, L * 0.3, R - 0.07), M.darkMetal);
    vane.position.y = -L * 0.3;
    vane.rotation.y = (i / 4) * Math.PI * 2;
    vane.translateZ((R - 0.07) / 2 + 0.07);
    g.add(vane);
  }
  const prop = new THREE.Group();
  const bladeGeo = new THREE.BoxGeometry(0.1, 0.012, R - 0.08);
  bladeGeo.translate(0, 0, (R - 0.08) / 2 + 0.07);
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Mesh(bladeGeo, M.black);
    b.rotation.y = (i / 5) * Math.PI * 2;
    b.rotateZ(0.5); // pitch
    prop.add(b);
  }
  prop.position.y = L * 0.08;
  g.add(prop);
  return { group: g, prop };
}

export function createSub({ lowPower = false, renderer = null } = {}) {
  const seg = lowPower ? 32 : 64;
  const root = new THREE.Group();      // world placement, bob, roll
  const body = new THREE.Group();      // rotated in the vessel chapter
  root.add(body);

  // Reflections make or break PBR. A small procedural studio environment,
  // whose strength is driven by depth (no reflections in the dark).
  let envMap = null;
  if (renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }
  const detail = hullDetailMaps();
  const mats = [];
  const P = (params, caustic = true) => {
    const m = new THREE.MeshPhysicalMaterial({ envMap, envMapIntensity: 1, ...params });
    mats.push(m);
    return caustic ? withCaustics(m) : m;
  };
  const M = {
    hull: P({ color: '#ecebe6', roughness: 0.55, roughnessMap: detail.rough, bumpMap: detail.bump, bumpScale: 5, clearcoat: 0.55, clearcoatRoughness: 0.3 }),
    hullInner: P({ color: '#8d9197', roughness: 0.8, side: THREE.BackSide }, false),
    orange: P({ color: '#e0512a', roughness: 0.4, clearcoat: 0.7, clearcoatRoughness: 0.2, side: THREE.DoubleSide }),
    foam: P({ color: '#e3a83c', roughness: 0.92 }),
    titanium: P({ color: '#aeb3ba', metalness: 1, roughness: 0.26 }),
    steel: P({ color: '#c8ccd1', metalness: 0.75, roughness: 0.32 }),
    darkMetal: P({ color: '#2d3136', metalness: 0.6, roughness: 0.42 }),
    black: P({ color: '#141619', roughness: 0.7 }),
    rubber: P({ color: '#1b1d20', roughness: 0.9 }),
    glass: P({ color: '#0a1620', roughness: 0.04, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02 }, false),
    lamp: new THREE.MeshBasicMaterial({ color: '#fff6de' }),
  };

  const parts = [];
  const part = (name, dir, dist, anchor) => {
    const g = new THREE.Group();
    g.name = name;
    body.add(g);
    const p = { g, dir: new THREE.Vector3(...dir).normalize(), dist, anchor: new THREE.Vector3(...anchor) };
    parts.push(p);
    return p;
  };

  const HULL_Y = 0.42;       // hull axis height
  const Z_SCALE = 0.8;       // hull is taller than it is wide

  // 01 — Crew sphere + lower hull (the core; stays put)
  const core = part('sphere', [0, 0, 1], 0, [1.95, -0.55, 0.62]);
  const hullLower = new THREE.Group();
  hullLower.position.y = HULL_Y;
  hullLower.scale.z = Z_SCALE;
  core.g.add(hullLower);
  hullLower.add(new THREE.Mesh(latheX(PROFILE, seg, 0, Math.PI), M.hull));
  hullLower.add(new THREE.Mesh(latheX(PROFILE, seg, 0, Math.PI), M.hullInner));

  // Livery band, a hair proud of the hull, just below the equator (+Z side).
  const band = PROFILE.filter((p) => p.y > -1.25 && p.y < 1.35).map((p) => new THREE.Vector2(p.x + 0.004, p.y));
  const livery = new THREE.Mesh(
    latheX(band, 24, 0.02, 0.5),
    new THREE.MeshPhysicalMaterial({ map: liveryTexture(), transparent: true, roughness: 0.4, clearcoat: 0.8, envMap, polygonOffset: true, polygonOffsetFactor: -2 })
  );
  mats.push(livery.material);
  hullLower.add(livery);

  // Rub rail along the equator seam.
  const railPts = [];
  for (let i = 0; i <= 80; i++) {
    const a = -2.55 + (i / 80) * 4.75;
    railPts.push(new THREE.Vector3(a, 0, (radiusAt(a) + 0.012) * Z_SCALE));
  }
  const railCurve = new THREE.CatmullRomCurve3(railPts);
  [1, -1].forEach((s) => {
    const rail = new THREE.Mesh(new THREE.TubeGeometry(railCurve, 80, 0.022, 8), M.darkMetal);
    rail.scale.z = s;
    rail.position.y = HULL_Y;
    core.g.add(rail);
  });

  // The sphere itself, slung under the bow.
  const SPH = new THREE.Vector3(1.32, -0.48, 0);
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.66, seg, seg / 2), M.titanium);
  sphere.position.copy(SPH);
  core.g.add(sphere);
  // Equatorial flange where the two forged hemispheres bolt together.
  const flange = new THREE.Mesh(new THREE.TorusGeometry(0.665, 0.025, 10, seg), M.titanium);
  flange.position.copy(SPH);
  core.g.add(flange);
  // Viewports: thick acrylic cones in retaining rings, looking forward and down.
  [[0, -0.42], [0.62, -0.25], [-0.62, -0.25]].forEach(([yaw, pitch]) => {
    const dir = new THREE.Vector3(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch));
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.08, 32), M.titanium);
    ring.position.copy(SPH).addScaledVector(dir, 0.665);
    ring.quaternion.copy(q);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.glass);
    lens.scale.y = 0.35;
    lens.position.copy(SPH).addScaledVector(dir, 0.7);
    lens.quaternion.copy(q);
    const bolts = new THREE.Group();
    for (let i = 0; i < 10; i++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.02, 6), M.darkMetal);
      const a = (i / 10) * Math.PI * 2;
      b.position.set(Math.cos(a) * 0.142, 0.045, Math.sin(a) * 0.142);
      bolts.add(b);
    }
    bolts.position.copy(ring.position);
    bolts.quaternion.copy(q);
    core.g.add(ring, lens, bolts);
  });

  // 02 — Upper fairing (lifts off) with the sail, and the foam it covers.
  const shell = part('shell', [0, 1, 0], 2.1, [0.4, 1.9, 0.5]);
  const hullUpper = new THREE.Group();
  hullUpper.position.y = HULL_Y;
  hullUpper.scale.z = Z_SCALE;
  shell.g.add(hullUpper);
  hullUpper.add(new THREE.Mesh(latheX(PROFILE, seg, Math.PI, Math.PI), M.hull));
  hullUpper.add(new THREE.Mesh(latheX(PROFILE, seg, Math.PI, Math.PI), M.hullInner));

  // Sail: a swept fin, orange, with a mast, strobe and antenna.
  const fin = new THREE.Shape();
  fin.moveTo(-0.55, 0);
  fin.bezierCurveTo(-0.35, 0.35, -0.1, 0.52, 0.2, 0.55);
  fin.lineTo(0.62, 0.55);
  fin.bezierCurveTo(0.78, 0.55, 0.86, 0.4, 0.9, 0.22);
  fin.lineTo(1.0, 0);
  fin.lineTo(-0.55, 0);
  const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 4, curveSegments: 24 });
  finGeo.translate(0, 0, -0.1);
  const sail = new THREE.Mesh(finGeo, M.orange);
  sail.position.set(-0.1, HULL_Y + 0.82, 0);
  shell.g.add(sail);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.45, 8), M.steel);
  mast.position.set(0.25, HULL_Y + 1.6, 0);
  const strobeMat = new THREE.MeshBasicMaterial({ color: '#dff4ff' });
  const strobe = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.08, 12), strobeMat);
  strobe.position.set(0.25, HULL_Y + 1.86, 0);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.01, 0.7, 6), M.black);
  antenna.position.set(-0.05, HULL_Y + 1.7, 0);
  antenna.rotation.z = 0.25;
  // Forward-looking camera pod on the sail's leading edge.
  const camPod = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.14, 4, 12), M.darkMetal);
  camPod.rotation.z = Math.PI / 2;
  camPod.position.set(0.9, HULL_Y + 1.12, 0);
  const camLens = new THREE.Mesh(new THREE.CircleGeometry(0.045, 20), M.glass);
  camLens.rotation.y = Math.PI / 2;
  camLens.position.set(1.035, HULL_Y + 1.12, 0);
  shell.g.add(mast, strobe, antenna, camPod, camLens);
  // Lifting eye.
  const eye = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.02, 8, 20), M.steel);
  eye.position.set(-1.2, HULL_Y + 0.92, 0);
  shell.g.add(eye);

  const foam = part('foam', [0, 1, 0], 1.0, [-0.6, 1.05, 0.6]);
  const foamBlocks = [
    [-1.75, 0.6, 0.6], [-1.05, 0.8, 1.0], [-0.05, 1.05, 1.15], [0.95, 0.9, 1.0], [1.7, 0.5, 0.75],
  ];
  foamBlocks.forEach(([x, w, d], i) => {
    const h = radiusAt(x) * 0.78;
    const b = new THREE.Mesh(new RoundedBoxGeometry(w * 0.92, h, d * Z_SCALE, 3, 0.06), M.foam);
    b.position.set(x, HULL_Y + h / 2 + 0.02, 0);
    foam.g.add(b);
    if (i % 2 === 0) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.05, h + 0.02, d * Z_SCALE + 0.02), M.darkMetal);
      strap.position.copy(b.position);
      foam.g.add(strap);
    }
  });

  // 03 — Thrusters
  const props = [];
  const thrusterParts = [];
  const addThruster = (pos, axis, dir, opts = {}) => {
    const p = part('thruster', dir, 1.1, pos.clone().add(new THREE.Vector3(0, 0.3, 0.3)).toArray());
    const t = makeThruster({ seg: seg / 2, M, ...opts });
    t.group.position.copy(pos);
    t.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    p.g.add(t.group);
    props.push(t.prop);
    thrusterParts.push(p);
    return p;
  };
  // Main stern thruster, on stators off the tail cone.
  const main = addThruster(new THREE.Vector3(-3.0, HULL_Y, 0), new THREE.Vector3(-1, 0, 0), [-1, 0, 0], { radius: 0.4, length: 0.5 });
  main.g.add(limb(new THREE.Vector3(-2.7, HULL_Y, 0), new THREE.Vector3(-3.0, HULL_Y, 0), 0.07, M.darkMetal));
  // Vertical thrusters in side pods, lateral ones low on the hull.
  [1, -1].forEach((s) => {
    const pv = addThruster(new THREE.Vector3(-1.35, HULL_Y + 0.2, s * 0.98), new THREE.Vector3(0, 1, 0), [0, 0.3, s], { radius: 0.22, length: 0.32 });
    pv.g.add(limb(new THREE.Vector3(-1.35, HULL_Y + 0.2, s * 0.6), new THREE.Vector3(-1.35, HULL_Y + 0.2, s * 0.74), 0.04, M.darkMetal));
    const pl = addThruster(new THREE.Vector3(0.35, HULL_Y - 0.62, s * 0.66), new THREE.Vector3(1, 0, 0), [0.2, -0.4, s], { radius: 0.16, length: 0.3 });
    pl.g.add(limb(new THREE.Vector3(0.35, HULL_Y - 0.5, s * 0.5), new THREE.Vector3(0.35, HULL_Y - 0.58, s * 0.6), 0.03, M.darkMetal));
  });
  // X-tail fins (part of the stern thruster group so they explode together).
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0);
  finShape.lineTo(0.42, 0);
  finShape.bezierCurveTo(0.4, 0.14, 0.3, 0.3, 0.16, 0.36);
  finShape.lineTo(0, 0.36);
  finShape.lineTo(0, 0);
  const tailGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2 });
  tailGeo.translate(0, 0, -0.015);
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(tailGeo, i % 2 ? M.hull : M.orange);
    f.position.set(-2.28, HULL_Y, 0);
    f.rotation.set((i / 4) * Math.PI * 2 + Math.PI / 4, 0, 0);
    f.scale.x = -1;
    f.translateY(0.4);
    main.g.add(f);
  }

  // 04 — Frame: skids, struts, drop weights, battery pods
  const frame = part('frame', [0, -1, 0], 1.2, [-0.6, -1.32, 0.62]);
  [0.56, -0.56].forEach((z) => {
    const skid = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-2.0, -1.12, z), new THREE.Vector3(-1.9, -1.3, z), new THREE.Vector3(1.6, -1.3, z),
      new THREE.Vector3(2.1, -1.2, z), new THREE.Vector3(2.32, -0.98, z),
    ]);
    frame.g.add(new THREE.Mesh(new THREE.TubeGeometry(skid, 64, 0.045, 10), M.steel));
    [-1.45, -0.2, 0.95].forEach((x) => {
      const top = new THREE.Vector3(x, HULL_Y - radiusAt(x) * 0.78, z * 0.55);
      frame.g.add(limb(new THREE.Vector3(x, -1.3, z), top, 0.03, M.steel, 8));
    });
  });
  [-1.7, 0.2, 1.8].forEach((x) => frame.g.add(limb(new THREE.Vector3(x, -1.28, 0.56), new THREE.Vector3(x, -1.28, -0.56), 0.03, M.steel, 8)));
  // Steel drop weights (released to surface).
  [-0.95, -0.45].forEach((x) => {
    const w = new THREE.Mesh(new RoundedBoxGeometry(0.38, 0.26, 0.5, 2, 0.04), M.darkMetal);
    w.position.set(x, -1.05, 0);
    frame.g.add(w);
  });
  // Oil-compensated battery pods with orange end caps.
  [0.36, -0.36].forEach((z) => {
    const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 1.2, 6, 20), M.darkMetal);
    pod.rotation.z = Math.PI / 2;
    pod.position.set(-1.35, -0.72, z);
    const capA = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.06, 20), M.orange);
    capA.rotation.z = Math.PI / 2;
    capA.position.set(-0.8, -0.72, z);
    const capB = capA.clone();
    capB.position.x = -1.9;
    frame.g.add(pod, capA, capB);
  });

  // 05 — Bow: floodlight bar, manipulator, sample basket, colour chart
  const bow = part('bow', [1, 0, 0], 1.3, [2.62, -0.25, 0.9]);
  const lampPositions = [new THREE.Vector3(2.28, 0.1, 0.6), new THREE.Vector3(2.28, 0.1, -0.6)];
  bow.g.add(limb(new THREE.Vector3(2.05, 0.1, 0.62), new THREE.Vector3(2.05, 0.1, -0.62), 0.03, M.steel, 8));
  const lamps = [];
  lampPositions.forEach((p) => {
    const housing = new THREE.Mesh(
      new THREE.LatheGeometry(
        [new THREE.Vector2(0, -0.2), new THREE.Vector2(0.1, -0.2), new THREE.Vector2(0.13, -0.05), new THREE.Vector2(0.14, 0.12), new THREE.Vector2(0.13, 0.13)],
        24
      ),
      M.darkMetal
    );
    housing.rotation.z = -Math.PI / 2;
    housing.position.copy(p).add(new THREE.Vector3(-0.1, 0, 0));
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.125, 28), M.lamp.clone());
    lens.rotation.y = Math.PI / 2;
    lens.position.copy(p).add(new THREE.Vector3(0.035, 0, 0));
    const bracket = limb(p.clone().add(new THREE.Vector3(-0.2, 0, 0)), new THREE.Vector3(2.05, 0.1, p.z), 0.025, M.steel, 6);
    lamps.push(lens);
    bow.g.add(housing, lens, bracket);
  });
  // Sample basket: a tube frame box at the front of the skids.
  const bx0 = 2.0, bx1 = 2.55, by0 = -1.18, by1 = -0.9, bz = 0.5;
  const corners = [
    [bx0, by0, bz], [bx1, by0, bz], [bx1, by0, -bz], [bx0, by0, -bz],
    [bx0, by1, bz], [bx1, by1, bz], [bx1, by1, -bz], [bx0, by1, -bz],
  ].map((c) => new THREE.Vector3(...c));
  [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(([a, b]) =>
    bow.g.add(limb(corners[a], corners[b], 0.016, M.steel, 6))
  );
  const tray = new THREE.Mesh(new THREE.BoxGeometry(bx1 - bx0, 0.02, bz * 2), M.black);
  tray.position.set((bx0 + bx1) / 2, by0 + 0.01, 0);
  bow.g.add(tray);
  // Seven-function manipulator on the port side (-Z).
  const sh = new THREE.Vector3(2.0, -0.62, -0.42);
  const el = new THREE.Vector3(2.35, -0.38, -0.66);
  const wr = new THREE.Vector3(2.7, -0.72, -0.62);
  bow.g.add(limb(sh, el, 0.05, M.hull), limb(el, wr, 0.042, M.hull));
  [sh, el, wr].forEach((j) => {
    const joint = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.12, 16), M.darkMetal);
    joint.position.copy(j);
    joint.rotation.x = Math.PI / 2;
    bow.g.add(joint);
  });
  [0.35, -0.35].forEach((a) => {
    const jaw = limb(wr, wr.clone().add(new THREE.Vector3(0.12, -0.12, a * 0.2)), 0.014, M.darkMetal, 6);
    bow.g.add(jaw);
  });
  // Colour chart on a stalk off the basket, angled to the camera.
  const chartTex = checkerTexture();
  // A touch of self-illumination (scaled by ambient light) keeps the chart
  // readable as the light fades; the absorption pass still strips its colour.
  const chart = withCaustics(new THREE.MeshStandardMaterial({ map: chartTex, emissiveMap: chartTex, emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.8 }));
  const CH = new THREE.Vector3(2.62, -0.2, 0.95);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.74), chart);
  panel.position.copy(CH);
  panel.rotation.y = 0.75;
  const panelBack = new THREE.Mesh(new RoundedBoxGeometry(1.18, 0.82, 0.04, 2, 0.015), M.black);
  panelBack.position.copy(CH).add(new THREE.Vector3(-0.03 * Math.sin(0.75), 0, -0.03 * Math.cos(0.75)));
  panelBack.rotation.y = 0.75;
  const stalk = limb(new THREE.Vector3(2.45, -0.9, 0.5), CH.clone().add(new THREE.Vector3(-0.04, -0.3, -0.05)), 0.018, M.steel, 6);
  // These stay visible when a custom GLB replaces the hull (see attachModel).
  [panel, panelBack, stalk].forEach((m) => (m.userData.withModel = true));
  bow.g.add(panel, panelBack, stalk);

  // Floodlights. Kept in the scene at all times (intensity 0 when off) so
  // toggling never triggers a shader recompile.
  const floods = lampPositions.map((p) => {
    const light = new THREE.SpotLight('#fff3dc', 0, 32, 0.42, 0.55, 1.2);
    light.position.copy(p).add(new THREE.Vector3(0.05, 0, 0));
    light.target.position.copy(p).add(new THREE.Vector3(10, -2.6, p.z > 0 ? 1.2 : -1.2));
    bow.g.add(light, light.target);
    return light;
  });

  // Visible beam cones (additive), apex at each lamp.
  const beamLen = 22;
  const beamGeo = new THREE.ConeGeometry(Math.tan(0.42) * beamLen, beamLen, 72, 1, true);
  beamGeo.translate(0, -beamLen / 2, 0);
  const beamMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uOpacity: { value: 0 }, uLen: { value: beamLen } },
    vertexShader: /* glsl */ `
      varying float vAlong; varying vec3 vN; varying vec3 vV;
      void main() {
        vAlong = -position.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity, uLen;
      varying float vAlong; varying vec3 vN; varying vec3 vV;
      void main() {
        float f = 1.0 - clamp(vAlong / uLen, 0.0, 1.0);
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
        float a = f * f * edge * uOpacity * 0.3;
        gl_FragColor = vec4(vec3(1.0, 0.96, 0.86) * a, a);
      }`,
  });
  const beams = floods.map((light) => {
    const m = new THREE.Mesh(beamGeo, beamMat);
    m.position.copy(light.position);
    const dir = light.target.position.clone().sub(light.position).normalize();
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    m.renderOrder = 5;
    m.userData.withModel = true;
    bow.g.add(m);
    return m;
  });

  const base = parts.map((p) => p.g.position.clone());
  const lampTint = new THREE.Color('#fff6de');

  return {
    root,
    body,
    parts,
    floods,
    beams,
    beamMat,
    lamps,
    thrusters: props,
    chart,
    mats,
    setExplode(e) {
      parts.forEach((p, i) => p.g.position.copy(base[i]).addScaledVector(p.dir, p.dist * e));
    },
    setFlood(k) {
      floods.forEach((l) => (l.intensity = 75 * k));
      beamMat.uniforms.uOpacity.value = k;
      // Lens brightness above 1.0 so the glow pass picks it up.
      lamps.forEach((l) => l.material.color.copy(lampTint).multiplyScalar(0.25 + 7.75 * k));
    },
    // Recovery strobe on the mast: a short bright flash every two seconds.
    setStrobe(on, t) {
      const flash = on && t % 2 < 0.09 ? 30 : 0.35;
      strobeMat.color.setRGB(0.87, 0.95, 1).multiplyScalar(flash);
    },
    // Reflection strength: full at the surface and in the studio-lit vessel
    // chapter, nothing in the dark (there's nothing down there to reflect).
    setEnv(k) {
      mats.forEach((m) => (m.envMapIntensity = k));
    },
    // Label anchors for the vessel chapter callouts.
    anchors: {
      sphere: core,
      foam,
      thrusters: thrusterParts[1],
      frame,
      bow,
    },
  };
}

// Optional: swap the procedural hull for a GLB (public/models/sub.glb).
// The model is auto-fitted to the procedural sub's length and centred; the
// bow (lights, beams, chart) stays procedural so every chapter still works.
// If the GLB has nodes named sphere / foam / thrusters / frame, they explode
// like the procedural parts; otherwise the vessel chapter just rotates it.
export async function attachModel(sub, url, { yaw = 0 } = {}) {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(url);
  const model = gltf.scene;
  model.rotation.y = yaw;
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const long = Math.max(size.x, size.z);
  if (size.z > size.x && yaw === 0) model.rotation.y = Math.PI / 2; // make its long axis X
  model.scale.setScalar(5.4 / long);
  const box2 = new THREE.Box3().setFromObject(model);
  const c = box2.getCenter(new THREE.Vector3());
  model.position.sub(c).add(new THREE.Vector3(-0.2, 0.1, 0));

  // Hide the procedural hull; of the bow keep only the chart and light beams.
  sub.parts.forEach((p) => {
    if (p.g.name !== 'bow') p.g.visible = false;
    else p.g.traverse((o) => o.isMesh && !o.userData.withModel && (o.visible = false));
  });
  sub.custom = true; // callouts point at procedural parts, so main.js hides them
  const holder = new THREE.Group();
  holder.add(model);
  sub.body.add(holder);
  model.traverse((o) => {
    if (o.isMesh && o.material) {
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
        if ('envMapIntensity' in m) {
          m.envMap = sub.mats[0].envMap;
          sub.mats.push(m);
        }
      });
    }
  });
  return model;
}
