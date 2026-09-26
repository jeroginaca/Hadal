import './style.css';
import * as THREE from 'three';
import { ScrollDepthMap, MAX_DEPTH, clamp, lerp, smoothstep, damp } from './depth.js';
import { createHud, zoneU, depthFromZoneU } from './hud.js';
import { Sound } from './audio.js';
import { createAbsorptionPass } from './scene/absorption.js';
import { createSub, causticUniforms, attachModel } from './scene/sub.js';
import { createSurface, SUN_DIR, UNDER_SUN } from './scene/surface.js';
import { createSnow } from './scene/snow.js';
import { createBiolum } from './scene/biolum.js';
import { createSeafloor, createTrench } from './scene/seafloor.js';
import { createBottom, createJelly } from './scene/bottom.js';
import { createBubbles } from './scene/bubbles.js';
import { createFish } from './scene/fish.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
let reduced = motionQuery.matches || (import.meta.env.DEV && location.search.includes('snap'));
motionQuery.addEventListener?.('change', (e) => (reduced = e.matches));
const coarse = matchMedia('(pointer: coarse)').matches;
const lowPower = coarse || (navigator.hardwareConcurrency || 8) <= 4 || innerWidth < 760;

const canvas = document.getElementById('scene');
const sound = new Sound();
const updateHud = createHud();
const map = new ScrollDepthMap([...document.querySelectorAll('[data-chapter]')]);

// ---------------------------------------------------------------------------
// Loader: real build steps, each one a tick with a sonar ping.
// ---------------------------------------------------------------------------
const loader = document.getElementById('loader');
const loaderBar = loader.querySelector('.loader-bar i');
const loaderPct = document.getElementById('loader-pct');
const loaderMsg = document.getElementById('loader-msg');
const sonarEl = loader.querySelector('.sonar');
function tick(i, n, msg) {
  const pct = Math.round((i / n) * 100);
  loaderBar.style.width = `${pct}%`;
  loaderPct.textContent = pct;
  loaderMsg.textContent = msg;
  const ring = document.createElement('span');
  ring.className = 'ring';
  sonarEl.appendChild(ring);
  setTimeout(() => ring.remove(), 1200);
  sound.ping(0.6);
}
// Yield so the progress paints; setTimeout, not rAF, so a throttled tab can't stall loading.
const frame = () => new Promise((r) => setTimeout(r, reduced ? 0 : 70));

// ---------------------------------------------------------------------------
// Scene objects (filled in by the loader)
// ---------------------------------------------------------------------------
let renderer, post, scene, camera;
let sub, bubbles, fish, surface, snow, bokeh, biolum, seafloor, trench, bottom, jelly;
let hemi, sun, studio, work;
const W = { lowPower };

async function build() {
  const steps = [
    ['sealing hatch', () => {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
      W.maxDpr = Math.min(devicePixelRatio || 1, lowPower ? 1.5 : 1.75);
      W.dpr = W.maxDpr;
      renderer.setPixelRatio(W.dpr);
      renderer.setSize(innerWidth, innerHeight, false);
      renderer.setClearColor(0x000000, 1);
      post = createAbsorptionPass(renderer, { samples: lowPower ? 0 : 4, bloomIterations: lowPower ? 2 : 3 });
      scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0x000000, 0.02);
      camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 1800); // ocean rim reaches ~1570
      hemi = new THREE.HemisphereLight(0xffffff, 0x0a1a22, 1);
      sun = new THREE.DirectionalLight(0xffd8b0, 2);
      studio = new THREE.DirectionalLight(0xe6f1ff, 0);
      studio.position.set(-4, 6, 8);
      // Wide work light carried by the sub: it's what shows the trench walls.
      work = new THREE.PointLight(0xdfe8ff, 0, 0, 1);
      work.position.set(14, 6, 0); // well ahead of the bow: lights the walls more than the hull
      scene.add(hemi, sun, sun.target, studio, work);
    }],
    ['charging batteries', () => {
      sub = createSub({ lowPower, renderer });
      scene.add(sub.root);
      // Vented ballast air: the descent starts by flooding the tanks.
      bubbles = createBubbles({ count: lowPower ? 50 : 90 });
      sub.root.add(bubbles.points);
    }],
    ['flooding ballast tanks', () => {
      surface = createSurface({ lowPower });
      scene.add(surface.group, surface.rays, surface.sky, surface.water);
      // A school of sardines in the sunlit water; their flanks mirror the same backdrop.
      fish = createFish({ count: lowPower ? 120 : 260, waterUniforms: surface.waterMat.uniforms });
      scene.add(fish.mesh);
      jelly = createJelly();
      scene.add(jelly.group);
    }],
    ['calibrating sonar', () => {
      seafloor = createSeafloor({ lowPower });
      scene.add(seafloor.group);
    }],
    ['surveying trench', () => {
      trench = createTrench({ lowPower });
      scene.add(trench.group);
    }],
    ['priming floodlights', () => {
      snow = createSnow({ count: lowPower ? 1600 : 3200 });
      // A few big, out-of-focus motes right in front of the lens.
      bokeh = createSnow({ count: lowPower ? 60 : 120, size: 6, soft: true });
      bokeh.mat.uniforms.uLampP = snow.mat.uniforms.uLampP;
      bokeh.mat.uniforms.uLampD = snow.mat.uniforms.uLampD;
      scene.add(bokeh.points);
      biolum = createBiolum({ count: lowPower ? 450 : 800 });
      scene.add(snow.points, biolum.points);
    }],
    ['baiting the lander', () => {
      bottom = createBottom({ lowPower });
      scene.add(bottom.group);
    }],
    ['pressure test', () => {
      post.compile(scene, camera);
    }],
  ];
  for (let i = 0; i < steps.length; i++) {
    tick(i, steps.length, steps[i][0]);
    await frame();
    steps[i][1]();
  }
  tick(steps.length, steps.length, 'hull sealed');
}

// ---------------------------------------------------------------------------
// Camera path. One key per chapter end; each chapter eases from the previous
// key to its own. Positions are in world units around the sub at the origin.
// ---------------------------------------------------------------------------
const V = (x, y, z) => new THREE.Vector3(x, y, z);
function keys() {
  const portrait = innerWidth / innerHeight < 0.8;
  return {
    surface: portrait
      ? { pos: V(0.3, 3.4, 13), look: V(0.3, 2.1, 0) }
      : { pos: V(-3.2, 2.3, 12.5), look: V(-3.4, 0.5, 0) },
    sunlight: { pos: V(5.2, 0.2, 4.7), look: portrait ? V(2.1, -0.15, 0.6) : V(1.3, -0.15, 1.5), ease: [0.25, 1] },
    twilight: { pos: V(4.6, -0.1, 3.4), look: portrait ? V(2.4, -0.25, 0.9) : V(1.95, -0.2, 1.5) },
    midnight: { pos: V(-4.2, 2.2, 8), look: V(5, -0.9, 0), ease: [0, 0.5] },
    vessel: portrait
      ? { pos: V(0, 3.8, 15), look: V(0, 1.8, 0), ease: [0, 0.18] }
      : { pos: V(-3.2, 2.0, 12.5), look: V(-2.9, 0.5, 0), ease: [0, 0.18] },
    abyssal: { pos: V(-11, 7, 15), look: V(4, -6, -2), ease: [0, 0.35] },
    hadal: { pos: V(-8.5, 2.2, 2.6), look: V(6, -1.6, -0.8), ease: [0, 0.6] },
    bottom: { pos: V(2.3, -0.35, 3.3), look: V(4.6, -1.75, 0.6), ease: [0, 0.3] },
    cta: { pos: V(0.6, 0.4, 6.8), look: V(3.8, -1.5, 0.4) },
  };
}
let KEYS = keys();
const ORDER = ['surface', 'sunlight', 'twilight', 'midnight', 'vessel', 'abyssal', 'hadal', 'bottom', 'cta'];
const camTarget = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
function cameraFor(chapter, t) {
  const i = ORDER.indexOf(chapter);
  const a = KEYS[ORDER[Math.max(0, i - 1)]];
  const b = KEYS[chapter];
  const [e0, e1] = b.ease || [0, 1];
  const k = smoothstep(e0, e1, t);
  camTarget.pos.lerpVectors(a.pos, b.pos, k);
  camTarget.look.lerpVectors(a.look, b.look, k);
  // Portrait screens: pull back so the sub fits.
  if (innerWidth / innerHeight < 0.8 && chapter !== 'vessel') {
    const off = camTarget.pos.clone().sub(camTarget.look).multiplyScalar(1.45);
    camTarget.pos.copy(camTarget.look).add(off);
  }
  return camTarget;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  depth: 0,          // THE master value (metres)
  target: 0,
  chapter: 'surface',
  t: 0,
  floodsOn: true,    // user toggle
  flood: 0,          // actual floodlight level, damped
  ascending: false,
  camPos: new THREE.Vector3(0, 2.1, 10.5),
  camLook: new THREE.Vector3(0, 0.4, 0),
};

// Perceptual ambient light ("camera gain"): physically, sunlight is ~1% at
// 200 m, but the eye and the camera adapt. HUD shows the physical number.
const AMBIENT = [[0, 1], [30, 0.8], [200, 0.62], [600, 0.42], [900, 0.24], [1100, 0.08], [1300, 0]];
const interp = (table, x) => {
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1], [x1, y1] = table[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return table[table.length - 1][1];
};

const colShallow = new THREE.Color(0.05, 0.26, 0.33);
const colTwilight = new THREE.Color(0.012, 0.05, 0.11);
const colDeep = new THREE.Color(0.0, 0.004, 0.012);
const colHaze = new THREE.Color(0.85, 0.55, 0.42);
const tmpC = new THREE.Color();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

// Everything below is a function of state.depth (plus chapter progress for the
// two chapters that hold depth still: the vessel and the bottom).
function applyDepth(d, time, dt) {
  const { chapter, t } = state;
  const surfaceY = d * 0.6;
  const underwater = camera.position.y < surfaceY; // same test the sky/backdrop swap uses
  const amb = interp(AMBIENT, d);

  // --- surface, sky, rays, caustics ---
  surface.ocean.visible = d < 90;
  surface.update(reduced ? 0 : time, surfaceY, camera, smoothstep(0.5, 5, d) * (1 - smoothstep(15, 195, d)), 1 - smoothstep(0.2, 1.5, d));
  causticUniforms.uTime.value = reduced ? 0 : time * 0.7;
  causticUniforms.uCaustic.value = (1 - smoothstep(15, 160, d)) * 1.8;
  causticUniforms.uSurfaceY.value = surfaceY;

  // --- water colour and fog ---
  if (!underwater) {
    scene.fog.color.copy(colHaze);
    scene.fog.density = 0.004;
  } else {
    if (d < 200) tmpC.lerpColors(colShallow, colTwilight, smoothstep(0, 200, d));
    else tmpC.lerpColors(colTwilight, colDeep, smoothstep(200, 1100, d));
    scene.fog.color.copy(tmpC);
    let dens = lerp(0.05, 0.035, smoothstep(0, 1000, d)); // clear blue water: the sub stays crisp, distance hazes
    if (chapter === 'abyssal') dens = 0.012;
    if (d > 6000) dens = 0.013;
    scene.fog.density = dens;
  }
  renderer.setClearColor(scene.fog.color);
  surface.waterMat.uniforms.uColor.value.copy(scene.fog.color);
  surface.waterMat.uniforms.uLight.value = amb * (1 - smoothstep(200, 900, d));
  surface.oceanMat.uniforms.uLight.value = surface.waterMat.uniforms.uLight.value;
  surface.oceanMat.uniforms.uFogColor.value.copy(scene.fog.color);

  // --- ambient and sun ---
  // Underwater, light comes hard from above: weak ambient fill, strong top key,
  // near-black from below. That top-down falloff is most of what reads as "wet".
  hemi.intensity = amb * (underwater ? 0.55 : 1.6);
  hemi.color.setRGB(1, 0.86, 0.72).lerp(tmpC.setRGB(0.45, 0.78, 1.0), smoothstep(0, 60, d));
  hemi.groundColor.setRGB(0.01, 0.03, 0.05);
  sun.intensity = (1 - smoothstep(0, 220, d)) * (underwater ? 2.6 : 2.4);
  if (underwater) sun.color.setRGB(0.78, 0.95, 1.0); else sun.color.set(0xffd8b0);
  if (underwater) sun.position.copy(UNDER_SUN).multiplyScalar(30); // refracted sun, same angle as the shafts
  else sun.position.copy(SUN_DIR).multiplyScalar(50);

  // --- floodlights: ignite through the late twilight, obey the toggle ---
  const auto = smoothstep(820, 1000, d);
  let want = auto * (state.floodsOn ? 1 : 0);
  if (chapter === 'vessel') want = Math.max(want, 0.6);
  // A lamp striking: brief stutter as it comes up.
  if (auto > 0 && auto < 1 && !reduced) want *= 0.75 + 0.25 * Math.sign(Math.sin(time * 37 + Math.sin(time * 13) * 4));
  state.flood = reduced ? want : damp(state.flood, want, 8, dt);
  sub.setFlood(state.flood);
  sub.chart.emissiveIntensity = amb * 0.8;

  // Studio light for the vessel chapter.
  const vesselK = chapter === 'vessel' ? smoothstep(0, 0.12, t) * (1 - smoothstep(0.9, 1, t)) : 0;
  studio.intensity = vesselK * 2.4;
  // Flood backscatter faintly lights the hull via its reflections only (not the seafloor).
  sub.setEnv(Math.max(amb * (underwater ? 0.18 : 1), vesselK * 0.9, state.flood * 0.22 * smoothstep(900, 1300, d)));
  hemi.intensity += vesselK * 0.5;


  // --- sub pose, vessel explode ---
  const atSurface = 1 - smoothstep(0, 4, d);
  const sway = reduced ? 0 : 1;
  // At the surface she floats low: sail and upper hull above the waterline.
  sub.root.position.set(0, -0.62 * atSurface + Math.sin(time * 0.9) * 0.12 * atSurface * sway, 0);
  sub.root.rotation.set(Math.sin(time * 0.5) * 0.03 * sway, 0, Math.sin(time * 0.7) * (0.035 * atSurface + 0.01) * sway);
  const explode = chapter === 'vessel' ? smoothstep(0.12, 0.38, t) * (1 - smoothstep(0.84, 0.97, t)) : 0;
  sub.setExplode(state.ascending ? 0 : explode);
  sub.body.rotation.y = chapter === 'vessel' && !state.ascending ? smoothstep(0.05, 0.95, t) * Math.PI * 2 : 0;
  sub.setStrobe(d < 30 && !reduced, time);
  sub.thrusters.forEach((p) => (p.rotation.y += dt * (reduced ? 0 : 6 + 20 * atSurface)));
  updateLabels(explode);

  // --- bubbles: strongest right after leaving the surface ---
  bubbles.points.visible = underwater && d < 260;
  bubbles.mat.uniforms.uTime.value = reduced ? 0 : time;
  bubbles.mat.uniforms.uLight.value = (0.4 + amb) * (1 - smoothstep(40, 250, d));

  // --- fish school: sunlit water only ---
  // Fades into the blue slowly across the twilight zone, gone by the "Blue." line.
  const fishK = 1 - smoothstep(170, 800, d);
  fish.mesh.visible = underwater && fishK > 0;
  if (fish.mesh.visible) {
    fish.setFade(fishK);
    fish.update(reduced ? 0 : time);
  }

  // --- the red jellyfish of the twilight zone ---
  jelly.group.visible = d > 120 && d < 1300;
  jelly.group.position.set(0.6, 0.9 + (reduced ? 0 : Math.sin(time * 0.4) * 0.15), -2.6);
  jelly.update(reduced ? 0 : time);

  // --- marine snow ---
  snow.points.visible = d > 3;
  snow.mat.uniforms.uTime.value = reduced ? 0 : time;
  snow.mat.uniforms.uOffset.value = zoneU(d) * 140;
  // Plankton and silt sparkle in the sunlit water.
  snow.mat.uniforms.uAmbient.value = amb * (0.25 + 0.45 * (1 - smoothstep(30, 250, d))) * smoothstep(1, 10, d) + (d > 1000 ? 0.012 : 0);
  snow.mat.uniforms.uFlood.value = state.flood;
  sub.floods.forEach((l, i) => {
    l.getWorldPosition(snow.mat.uniforms.uLampP.value[i]);
    l.target.getWorldPosition(tmpV);
    snow.mat.uniforms.uLampD.value[i].copy(tmpV).sub(snow.mat.uniforms.uLampP.value[i]).normalize();
  });
  // Bokeh shares the snow's drift and lighting.
  for (const k of ['uTime', 'uOffset', 'uAmbient', 'uFlood']) bokeh.mat.uniforms[k].value = snow.mat.uniforms[k].value;
  bokeh.points.visible = snow.points.visible;

  // --- abyssal plain + sonar ---
  const floorY = -6 - 90 * (1 - smoothstep(3600, 4400, d)) - 220 * smoothstep(5750, 6300, d);
  seafloor.group.visible = d > 3600 && d < 6300;
  seafloor.group.position.set(-(d - 4000) * 0.012, floorY, 0);
  const s = seafloor.shared;
  const reveal = smoothstep(4000, 5100, d) * 78;
  s.uReveal.value = reveal;
  s.uFill.value = Math.pow(clamp((d - 4950) / 900, 0, 1), 1.6) * 100;
  s.uTime.value = time;
  if (seafloor.group.visible) {
    if (reduced) s.uPing.value = reveal;
    else {
      const period = 2.6;
      const phase = (time % period) / period;
      s.uPing.value = phase * (reveal + 8);
      if (phase < state.lastPhase && reveal > 1 && reveal < 78) sound.ping(0.9);
      state.lastPhase = phase;
    }
  }

  // --- hadal trench ---
  trench.group.visible = d > 5800;
  work.intensity = smoothstep(5900, 6600, d) * (1 - smoothstep(10700, 10935, d)) * 60;
  trench.update(lerp(46, 6.5, smoothstep(6000, 10600, d)), -160 + (d - 6000) * 0.055);

  // --- bottom ---
  bottom.group.visible = d > 10150;
  bottom.group.position.y = lerp(-60, -2.0, smoothstep(10300, 10935, d));
  const reveal2 = chapter === 'bottom' ? smoothstep(0.08, 0.3, t) : chapter === 'cta' ? 1 : 0;
  let lamp = reveal2;
  if (reveal2 > 0 && reveal2 < 1 && !reduced) lamp *= 0.6 + 0.4 * Math.sign(Math.sin(time * 41));
  bottom.lamp.intensity = lamp * 34;
  if (bottom.group.visible) bottom.update(time, dt, chapter === 'bottom' ? smoothstep(0.05, 0.55, t) : chapter === 'cta' ? 1 : 0, reduced);

  // --- bioluminescence: live when it's dark enough to see it ---
  state.biolumLive = d > 950 && state.flood < 0.25;
  biolum.mat.uniforms.uTime.value = time;
  biolum.mat.uniforms.uGain.value = 1 - state.flood * 0.8;

  // --- post: the absorption pass ---
  const u = post.uniforms;
  u.uDepth.value = d;
  u.uArtificial.value = smoothstep(950, 1300, d);
  u.uPathScale.value = chapter === 'vessel' ? 14 : chapter === 'bottom' || chapter === 'cta' ? 24 : 36;
  u.uTime.value = reduced ? 0 : time;
  u.uExposure.value = underwater ? 1.05 : 0.95;
}

// ---------------------------------------------------------------------------
// Vessel chapter callouts (3D anchors projected to the screen)
// ---------------------------------------------------------------------------
const labelsEl = document.getElementById('labels');
const LABELS = [
  ['sphere', '01 Crew sphere'],
  ['foam', '02 Syntactic foam'],
  ['thrusters', '03 Thrusters'],
  ['frame', '04 Frame & power'],
  ['bow', '05 Bow'],
];
const labelNodes = LABELS.map(([, text]) => {
  const n = document.createElement('div');
  n.className = 'label';
  n.textContent = text;
  labelsEl.appendChild(n);
  return n;
});
const specItems = [...document.querySelectorAll('.spec-list li')];
let activeSpec = -1;
function updateLabels(explode) {
  const show = explode > 0.6 && !state.ascending && !sub.custom;
  const narrow = innerWidth < 760;
  LABELS.forEach(([key], i) => {
    const node = labelNodes[i];
    const p = sub.anchors[key];
    if (!show || !p || (narrow && i !== activeSpec)) {
      node.style.opacity = 0;
      return;
    }
    p.g.localToWorld(tmpV2.copy(p.anchor)).project(camera);
    const x = (tmpV2.x * 0.5 + 0.5) * innerWidth;
    const y = (-tmpV2.y * 0.5 + 0.5) * innerHeight;
    node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translateY(-50%)`;
    node.style.opacity = tmpV2.z < 1 ? (i === activeSpec ? 1 : 0.55) : 0;
  });
  const idx = state.chapter === 'vessel' ? clamp(Math.floor((state.t - 0.3) / 0.11), -1, 4) : -1;
  if (idx !== activeSpec) {
    activeSpec = idx;
    specItems.forEach((li, i) => li.classList.toggle('on', i === idx || (idx < 0 && !narrow)));
  }
}

// ---------------------------------------------------------------------------
// Input: floodlight toggle, bioluminescence, sound
// ---------------------------------------------------------------------------
const btnSound = document.getElementById('btn-sound');
const btnLights = document.getElementById('btn-lights');
const lightButtons = [btnLights, ...document.querySelectorAll('.js-lights')];

btnSound.addEventListener('click', async () => {
  const on = !sound.enabled;
  await sound.setEnabled(on);
  btnSound.setAttribute('aria-pressed', String(on));
  btnSound.lastChild.textContent = on ? 'Sound on' : 'Sound off';
  if (on) sound.ping(0.8);
});

function setFloods(on) {
  state.floodsOn = on;
  btnLights.setAttribute('aria-pressed', String(on));
  document.querySelectorAll('.js-lights').forEach((b) => {
    b.setAttribute('aria-pressed', String(!on));
    b.lastChild.textContent = on ? 'Kill the floodlights' : 'Floodlights back on';
  });
}
lightButtons.forEach((b) => b.addEventListener('click', () => setFloods(!state.floodsOn)));

const ndc = new THREE.Vector2();
let lastX = 0, lastY = 0, lastBurst = 0, lastChime = 0;
function disturb(x, y, force = false) {
  if (!state.biolumLive || !camera) return;
  const now = performance.now();
  const moved = Math.hypot(x - lastX, y - lastY);
  if (!force && (moved < 26 || now - lastBurst < 35)) return;
  lastX = x; lastY = y; lastBurst = now;
  ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  biolum.burst(ndc, camera, clock.elapsedTime, { chainChance: force ? 0.6 : 0.16 });
  if (now - lastChime > 180) {
    sound.chime();
    lastChime = now;
  }
}
addEventListener('pointermove', (e) => disturb(e.clientX, e.clientY), { passive: true });
addEventListener('pointerdown', (e) => disturb(e.clientX, e.clientY, true), { passive: true });
addEventListener('touchmove', (e) => {
  const tt = e.touches[0];
  if (tt) disturb(tt.clientX, tt.clientY);
}, { passive: true });

// ---------------------------------------------------------------------------
// CTA: "Surface." Fast reverse ascent through the zones (skipping the two
// holds), colour returning band by band, landing on the sign-up form.
// ---------------------------------------------------------------------------
const signup = document.getElementById('signup');
const form = document.getElementById('signup-form');
const done = signup.querySelector('.signup-done');
// User scrolling is blocked only while the ascent plays. These listeners are
// attached for its duration so normal scrolling stays passive.
const blockScroll = (e) => e.cancelable && e.preventDefault();
const blockKeys = (e) => [' ', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) && e.preventDefault();
function lockScroll(on) {
  const fn = (on ? window.addEventListener : window.removeEventListener).bind(window);
  fn('wheel', blockScroll, { passive: false });
  fn('touchmove', blockScroll, { passive: false });
  fn('keydown', blockKeys);
}

// Scroll position (inside the zone sections) that produces a given depth.
function scrollForDepth(d) {
  const span = map.spans.find((s) => s.d1 > s.d0 && d >= s.d0 && d <= s.d1) || map.spans[1];
  return span.top + ((d - span.d0) / (span.d1 - span.d0)) * span.h;
}

// Seconds spent in each zone on the way up: lingers where the colour returns.
const ASCENT = [1.6, 2.2, 1.0, 0.8, 1.1]; // sunlight, twilight, midnight, abyssal, hadal
function ascend() {
  if (state.ascending) return;
  const finish = () => {
    state.ascending = false;
    lockScroll(false);
    document.body.classList.remove('ascending');
    window.scrollTo(0, 0);
    document.body.classList.add('surfaced');
    signup.hidden = false;
    form.querySelector('input').focus({ preventScroll: true });
  };
  if (reduced) return finish();
  state.ascending = true;
  lockScroll(true);
  document.body.classList.add('ascending');
  const total = ASCENT.reduce((a, b) => a + b, 0);
  sound.whoosh(total);
  const t0 = performance.now();
  const step = () => {
    const el = (performance.now() - t0) / 1000;
    // Walk the zone timeline backwards: hadal first, sunlight last.
    let acc = 0, u = 0;
    for (let z = 4; z >= 0; z--) {
      if (el <= acc + ASCENT[z]) {
        const k = (el - acc) / ASCENT[z];
        u = z + 1 - (z === 0 ? 1 - Math.pow(1 - k, 2) : k); // ease into the surface
        break;
      }
      acc += ASCENT[z];
    }
    if (el >= total) return finish();
    window.scrollTo(0, scrollForDepth(depthFromZoneU(u)));
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
document.getElementById('btn-surface').addEventListener('click', ascend);

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const err = form.querySelector('.form-error');
  const name = form.elements.namedItem('name').value.trim();
  const email = form.elements.namedItem('email').value.trim();
  const msg = !name ? 'We need a name for the manifest.' : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? 'That email address doesn’t look right.' : '';
  err.hidden = !msg;
  err.textContent = msg;
  if (msg) return;
  form.hidden = true;
  done.hidden = false;
  sound.ping(0.7);
});
function closeSignup() {
  signup.hidden = true;
  document.body.classList.remove('surfaced');
}
document.getElementById('btn-close-signup').addEventListener('click', closeSignup);
document.getElementById('btn-dive-again').addEventListener('click', () => {
  closeSignup();
  window.scrollTo({ top: map.topOf('sunlight'), behavior: reduced ? 'auto' : 'smooth' });
});
addEventListener('keydown', (e) => e.key === 'Escape' && !signup.hidden && closeSignup());

// ---------------------------------------------------------------------------
// Resize + adaptive resolution
// ---------------------------------------------------------------------------
function resize() {
  map.measure();
  KEYS = keys();
  if (!renderer) return;
  camera.aspect = innerWidth / innerHeight;
  camera.fov = camera.aspect < 0.8 ? 55 : 45;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(W.dpr);
  renderer.setSize(innerWidth, innerHeight, false);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  post.setSize(size.x, size.y);
  snow.mat.uniforms.uPixel.value = W.dpr;
  bubbles.mat.uniforms.uPixel.value = W.dpr;
  bokeh.mat.uniforms.uPixel.value = W.dpr;
  biolum.mat.uniforms.uPixel.value = W.dpr;
  seafloor.shared.uPixel.value = W.dpr;
}
addEventListener('resize', resize);
// Section heights can settle after first paint (fonts, injected CSS).
new ResizeObserver(() => {
  map.measure();
  state.snap = true; // a layout change is not a dive: jump, don't animate
}).observe(document.getElementById('chapters'));
addEventListener('load', () => map.measure());
let frames = 0, frameAcc = 0;
function adapt(dt, raw) {
  if (raw > 0.25) return; // throttled or backgrounded tab: not a real measurement
  frames++;
  frameAcc += dt;
  if (frames < 90) return;
  const avg = frameAcc / frames;
  frames = 0; frameAcc = 0;
  if (avg > 1 / 40 && W.dpr > 0.75) {
    W.dpr = Math.max(0.75, W.dpr - 0.2);
    resize();
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const timer = new THREE.Timer();
const clock = { elapsedTime: 0 };
let bioTimer = 0;
function loop(ts) {
  requestAnimationFrame(loop);
  frameStep(ts);
}
function frameStep(ts) {
  timer.update(ts);
  const raw = timer.getDelta();
  clock.elapsedTime = timer.getElapsed();
  const dt = Math.min(raw, 0.1);
  const time = clock.elapsedTime;

  const smp = map.sample(scrollY);
  state.target = smp.depth;
  state.chapter = smp.chapter;
  state.t = smp.t;
  state.depth = reduced || state.ascending || state.snap ? state.target : damp(state.depth, state.target, 7, dt);
  state.snap = false;
  if (Math.abs(state.depth - state.target) < 0.05) state.depth = state.target;
  const d = clamp(state.depth, 0, MAX_DEPTH);

  updateHud(d);
  const floodAvail = d >= 900;
  if (btnLights.disabled === floodAvail) btnLights.disabled = !floodAvail;

  if (!renderer) return;

  const c = cameraFor(state.chapter, state.t);
  const k = reduced ? 1 : 1 - Math.exp(-(state.ascending ? 5 : 4) * dt);
  state.camPos.lerp(c.pos, k);
  state.camLook.lerp(c.look, k);
  camera.position.copy(state.camPos);
  if (!reduced) {
    camera.position.x += Math.sin(time * 0.31) * 0.08;
    camera.position.y += Math.sin(time * 0.43) * 0.06;
  }
  camera.lookAt(state.camLook);
  if (state.camOverride) {
    camera.position.copy(state.camOverride.pos);
    camera.lookAt(state.camOverride.look);
  }

  applyDepth(d, time, dt);

  // Ambient flashes so the dark is never empty (and touch users see some).
  // With the floods on they're rarer and further out, past the beams.
  if (d > 950 && d < 10800 && !reduced && !state.ascending) {
    bioTimer -= dt;
    if (bioTimer <= 0) {
      const dark = state.biolumLive;
      bioTimer = dark ? 0.5 + Math.random() * 1.2 : 1.4 + Math.random() * 2.6;
      ndc.set(Math.random() * 1.6 - 0.8, Math.random() * 1.2 - 0.6);
      biolum.burst(ndc, camera, time, dark ? { chainChance: 0.35 } : { chainChance: 0.5, near: 16, far: 30 });
    }
  }

  sound.update(d, time);
  post.render(scene, camera);
  adapt(dt, raw);
}

// Drop a model at public/models/sub.glb and it replaces the procedural hull.
async function loadCustomModel() {
  const url = `${import.meta.env.BASE_URL}models/sub.glb`;
  try {
    const head = await fetch(url, { method: 'HEAD' });
    const type = head.headers.get('content-type') || '';
    if (!head.ok || type.includes('text/html')) return; // absent (dev servers answer with index.html)
    await attachModel(sub, url);
  } catch (err) {
    console.warn('Custom sub model failed to load; keeping the procedural one.', err);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(async function boot() {
  try {
    await build();
    resize();
  } catch (err) {
    console.warn('WebGL unavailable, falling back to CSS depth backdrop.', err);
    renderer = null;
    document.documentElement.classList.add('no-webgl');
    btnLights.hidden = true;
    document.querySelectorAll('.js-lights').forEach((b) => (b.hidden = true));
  }
  // Start where the page is (e.g. reload mid-dive) without an animated descent.
  map.measure();
  const smp = map.sample(scrollY);
  state.depth = state.target = smp.depth;
  const c = renderer ? cameraFor(smp.chapter, smp.t) : null;
  if (c) {
    state.camPos.copy(c.pos);
    state.camLook.copy(c.look);
  }
  requestAnimationFrame(loop);
  setTimeout(() => loader.classList.add('done'), reduced ? 0 : 350);
  if (renderer) loadCustomModel();
})();

if (import.meta.env.DEV) {
  window.__hadal = {
    state,
    map,
    setFloods,
    get seafloor() { return seafloor; },
    get post() { return post; },
    get fish() { return fish; },
    THREE,
    step: () => frameStep(performance.now()),
    // Render one frame synchronously and save it via the dev server.
    async shot(name) {
      for (let i = 0; i < 3; i++) frameStep(performance.now());
      const url = canvas.toDataURL('image/jpeg', 0.82);
      await fetch(`/__shot?name=${name}`, { method: 'POST', body: url });
      return name;
    },
  };
}
