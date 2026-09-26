import * as THREE from 'three';

// Dawn sky, the wave shader, and god rays. All of it lives near 0 m and is
// hidden once the sub is deep enough that none of it could be on screen.

export const SUN_DIR = new THREE.Vector3(0.35, 0.09, -1).normalize();

// Sunlight refracts steeply as it enters the water. RAY_DIR is the direction
// light travels underwater (down, and away from the sun); UNDER_SUN points
// back up along it. Real shafts are parallel: perspective makes them fan out
// from the point where UNDER_SUN meets the surface.
const RAY_TILT = THREE.MathUtils.degToRad(33);
const sunH = new THREE.Vector3(SUN_DIR.x, 0, SUN_DIR.z).normalize();
export const RAY_DIR = sunH.clone().multiplyScalar(-Math.sin(RAY_TILT)).add(new THREE.Vector3(0, -Math.cos(RAY_TILT), 0)).normalize();
export const UNDER_SUN = RAY_DIR.clone().negate();
const v3 = (v) => `vec3(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;

// Large swell only: the mesh can't resolve short waves, so those live in the
// fragment shader as normal detail. (dirX, dirZ, steepness, wavelength)
const WAVES = /* glsl */ `
  const vec4 W[3] = vec4[3](
    vec4(1.0, 0.25, 0.10, 23.0),
    vec4(0.75, -0.55, 0.08, 13.0),
    vec4(0.35, 0.9, 0.06, 8.0)
  );
  vec3 gerstner(vec2 p, float t, out vec3 n) {
    vec3 o = vec3(0.0); vec3 tx = vec3(1.0, 0.0, 0.0); vec3 tz = vec3(0.0, 0.0, 1.0);
    for (int i = 0; i < 3; i++) {
      vec2 d = normalize(W[i].xy);
      float k = 6.2831 / W[i].w;
      float a = W[i].z / k;
      float f = k * (dot(d, p) - sqrt(9.8 / k) * t);
      o += vec3(d.x * a * cos(f), a * sin(f), d.y * a * cos(f));
      tx += vec3(-d.x * d.x * W[i].z * sin(f), d.x * W[i].z * cos(f), -d.x * d.y * W[i].z * sin(f));
      tz += vec3(-d.x * d.y * W[i].z * sin(f), d.y * W[i].z * cos(f), -d.y * d.y * W[i].z * sin(f));
    }
    n = normalize(cross(tz, tx));
    return o;
  }
`;

// One dawn sky, used by the sky dome AND by the ocean's reflections, so the
// water always mirrors the sky that's actually there.
const SKY = /* glsl */ `
  uniform float uCloudT;
  float sh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(sh(i), sh(i + vec2(1.0, 0.0)), u.x), mix(sh(i + vec2(0.0, 1.0)), sh(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < CLOUD_OCT; i++) { s += a * n2(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
    return s;
  }
  // Gradient + sun, no clouds (horizon, below-horizon mirror, far water).
  vec3 skyBase(vec3 d, vec3 sun) {
    float h = max(d.y, 0.0);
    vec3 zenith = vec3(0.03, 0.075, 0.2);
    vec3 mid = vec3(0.22, 0.32, 0.52);
    vec3 horizon = vec3(1.1, 0.6, 0.36);
    float side = pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(sun.x, 0.0, sun.z))), 0.0), 3.0);
    horizon = mix(horizon * vec3(0.7, 0.75, 0.95), horizon * vec3(1.3, 1.05, 0.8), side);
    vec3 c = mix(horizon, mid, smoothstep(0.0, 0.13, h));
    c = mix(c, zenith, smoothstep(0.12, 0.65, h));
    float s = max(dot(d, sun), 0.0);
    c += vec3(1.6, 0.8, 0.38) * pow(s, 8.0) * 0.5;      // wide dawn glow
    c += vec3(3.0, 1.6, 0.7) * pow(s, 90.0);            // halo
    c += vec3(60.0, 36.0, 16.0) * smoothstep(0.99955, 0.99975, s); // disc (blooms)
    return c;
  }
  // Water at the horizon: at grazing angles it mirrors the sky just above
  // the horizon, a touch darker. Used by
  // both the far ocean and the dome below the horizon, so they match.
  vec3 farWater(vec3 d, vec3 sun) {
    return skyBase(normalize(vec3(d.x, 0.05, d.z)), sun) * 0.68 + vec3(0.01, 0.03, 0.05);
  }
  // Full sky: a thin layer of dawn stratocumulus, lit from below by the sun.
  vec3 skyColor(vec3 d, vec3 sun) {
    vec3 c = skyBase(d, sun);
    if (d.y < 0.004) return c;
    vec2 uv = d.xz / (d.y + 0.06) * 0.55 + vec2(uCloudT * 0.004, uCloudT * 0.0015);
    float n = fbm(uv * 1.6);
    float dens = smoothstep(0.48, 0.78, n);
    dens *= smoothstep(0.004, 0.06, d.y) * (1.0 - smoothstep(0.3, 0.75, d.y));
    float s = max(dot(d, sun), 0.0);
    vec3 shadow = vec3(0.16, 0.17, 0.25);
    vec3 lit = mix(vec3(0.95, 0.52, 0.45), vec3(1.6, 0.95, 0.55), pow(s, 6.0));
    float edge = smoothstep(0.78, 0.5, n); // thin edges catch the light
    vec3 cloud = mix(shadow, lit, 0.35 + 0.65 * edge);
    cloud += vec3(3.0, 1.8, 0.9) * pow(s, 40.0) * edge; // silver lining near the sun
    return mix(c, cloud, dens * 0.9);
  }
`;

// Underwater backdrop colour for a view direction. Shared by the backdrop
// sphere and the underside of the surface, so the two meet without a seam.
export const WATER_BG = /* glsl */ `
  vec3 waterBg(vec3 d, vec3 col, float light) {
    float h = d.y;
    vec3 c = col * (1.0 + smoothstep(0.0, 1.0, h) * 3.0 * light);
    c += vec3(0.25, 0.45, 0.5) * pow(max(h, 0.0), 6.0) * light;
    // Forward scattering: a broad glow toward the (refracted, steep) sun.
    vec3 sunW = ${v3(UNDER_SUN)};
    float fs = max(dot(d, sunW), 0.0);
    c += vec3(0.35, 0.6, 0.62) * (pow(fs, 3.0) * 0.5 + pow(fs, 18.0) * 0.6) * light;
    // Toward the abyss: deep blue, much darker than the water around you.
    c = mix(c, col * vec3(0.35, 0.55, 0.9) * 0.35, 1.0 - smoothstep(-0.7, 0.05, h));
    return c;
  }
`;

// Short waves as analytic slopes: many directional sine waves spread around
// the wind, each octave shorter and fainter, faded out with distance so they
// never alias into shimmer.
const DETAIL = /* glsl */ `
  float h11(float n) { return fract(sin(n * 127.1) * 43758.5453); }
  vec2 waveSlope(vec2 p, float t, float dist) {
    vec2 g = vec2(0.0);
    float wl = 7.0;
    float steep = 0.12;
    for (int i = 0; i < DETAIL_WAVES; i++) {
      float fi = float(i);
      float ang = 0.25 + (h11(fi) - 0.5) * 3.8 + sin(fi * 2.3) * 0.4;
      vec2 d = vec2(cos(ang), sin(ang));
      float k = 6.2831 / wl;
      float ph = k * dot(d, p) - sqrt(9.8 * k) * t + h11(fi + 17.0) * 6.2831;
      float lod = (1.0 - smoothstep(45.0, 150.0, dist / wl)) * (1.0 - smoothstep(160.0, 1100.0, dist) * 0.85); // gentle: no hard texture edge, less moiré
      g += d * steep * cos(ph) * lod;
      wl *= 0.8 + h11(fi + 5.0) * 0.08;
      steep *= 0.94;
    }
    return g;
  }
`;

export function createSurface({ lowPower = false } = {}) {
  const group = new THREE.Group();

  // ---- Sky -----------------------------------------------------------------
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uSun: { value: SUN_DIR }, uCloudT: { value: 0 } },
    defines: { CLOUD_OCT: 5 },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun; varying vec3 vDir;
      ${SKY}
      void main() {
        vec3 d = normalize(vDir);
        // Below the horizon (past the ocean mesh's edge) show what far water
        // shows at grazing angles: the mirrored sky, slightly darker.
        vec3 c = d.y >= 0.0 ? skyColor(d, uSun) : farWater(d, uSun);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), skyMat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;

  // Underwater backdrop: matches the fog colour at the horizon, brighter
  // toward the surface, darker below. Fades to flat black as light dies.
  const waterMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uColor: { value: new THREE.Color() }, uLight: { value: 1 } },
    vertexShader: skyMat.vertexShader,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uLight; varying vec3 vDir;
      ${WATER_BG}
      void main() {
        gl_FragColor = vec4(waterBg(normalize(vDir), uColor, uLight), 1.0);
      }`,
  });
  const water = new THREE.Mesh(new THREE.SphereGeometry(280, 32, 16), waterMat);
  water.renderOrder = -10;
  water.frustumCulled = false;

  // ---- Ocean surface -------------------------------------------------------
  const seg = lowPower ? 96 : 160;
  const oceanGeo = new THREE.PlaneGeometry(260, 260, seg, seg);
  oceanGeo.rotateX(-Math.PI / 2);
  const oceanMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uSun: { value: SUN_DIR },
      uFogColor: { value: new THREE.Color() },
      uCloudT: { value: 0 },
      uFoam: { value: 1 },
      uLight: { value: 1 },
      uHull: { value: new THREE.Vector3(-0.18, -0.2, 0) }, // hull axis centre, set each frame
    },
    defines: { DETAIL_WAVES: lowPower ? 12 : 22, CLOUD_OCT: lowPower ? 3 : 4 },
    vertexShader: /* glsl */ `
      ${WAVES}
      uniform float uTime;
      varying vec3 vW; varying vec3 vN; varying float vH;
      void main() {
        vec3 p = position;
        // Stretch the outer ring of the grid toward the horizon (edge 130 → ~1560
        // units) while the centre keeps its density: the plane's rim then sits
        // a fraction of a degree under the true horizon instead of leaving a band.
        float r0 = length(p.xz);
        float rn = r0 / 130.0;
        p.xz *= 1.0 + rn * rn * rn * rn * 11.0;
        vec4 wp0 = modelMatrix * vec4(p, 1.0);
        // Dampen the swell toward the far edge.
        float fade = 1.0 - smoothstep(60.0, 125.0, r0);
        vec3 n;
        vec3 off = gerstner(wp0.xz, uTime, n);
        p += off * fade;
        vH = off.y * fade;
        vN = normalize(mix(vec3(0.0, 1.0, 0.0), n, fade));
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun; uniform vec3 uFogColor; uniform float uTime; uniform float uFoam; uniform float uLight; uniform vec3 uHull;
      varying vec3 vW; varying vec3 vN; varying float vH;
      ${SKY}
      ${DETAIL}
      ${WATER_BG}
      void main() {
        vec3 toCam = cameraPosition - vW;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        if (!gl_FrontFacing) {
          // Seen from below: the surface as a divers sees it. Inside Snell's
          // window (~49° from vertical) the sky shows through, bright and
          // wobbling with the waves; outside it the surface mirrors the dim
          // water below, broken by shimmering highlights. It only blends into
          // the backdrop far away, where the plane reaches the horizon.
          vec3 dir = -V;
          vec3 bg = waterBg(dir, uFogColor, uLight);
          vec2 g = waveSlope(vW.xz, uTime, dist);
          float up = clamp(dir.y, 0.0, 1.0);
          float shimmer = pow(0.5 + 0.5 * sin(dot(g, vec2(22.0, 13.0)) + vW.x * 0.7), 5.0)
                        * pow(0.5 + 0.5 * sin(dot(g, vec2(-9.0, 19.0)) - vW.z * 0.9), 3.0);
          float window = smoothstep(0.6, 0.72, up + (g.x - g.y) * 0.35);
          vec3 mirror = (uFogColor * (0.9 + 0.8 * uLight) + vec3(0.55, 0.85, 0.9) * shimmer * uLight * 1.4)
                      * mix(0.75, 1.0, smoothstep(0.0, 0.5, up)); // grazing: mirrors the darker deep
          vec3 sky = vec3(0.75, 0.95, 1.0) * uLight * (1.7 + shimmer * 1.2);
          vec3 c = mix(mirror, sky, window);
          // Haze swallows the surface toward the horizon (no hard edge).
          c = mix(c, bg, 1.0 - exp(-dist * 0.045));
          gl_FragColor = vec4(c, 1.0);
          return;
        }
        vec2 g = waveSlope(vW.xz, uTime, dist);
        vec3 N = normalize(normalize(vN) + vec3(-g.x, 0.0, -g.y));

        // Fresnel (Schlick, water F0 = 0.02).
        float NdV = max(dot(N, V), 0.0);
        float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);

        // Reflection: the actual sky, mirrored. Keep it above the horizon.
        vec3 R = reflect(-V, N);
        R.y = abs(R.y);
        vec3 refl = skyColor(normalize(R), uSun);
        // The sub, mirrored: trace the reflected ray against an ellipsoid the
        // size of the hull, so the water beside it carries its white.
        if (uFoam > 0.0) {
          vec3 rad = vec3(2.54, 0.91, 0.73);
          vec3 o = (vW - uHull) / rad;
          vec3 rd = normalize(R) / rad;
          float a = dot(rd, rd), b = dot(o, rd), cc = dot(o, o) - 1.0;
          float disc = b * b - a * cc;
          if (disc > 0.0) {
            float th = (-b - sqrt(disc)) / a;
            if (th > 0.0) {
              vec3 hn = normalize((o + rd * th) / rad);
              vec3 hull = vec3(0.62, 0.6, 0.57) * (0.45 + 0.55 * max(dot(hn, uSun), 0.0)) + vec3(0.12, 0.15, 0.2) * max(hn.y, 0.0);
              refl = mix(refl, hull, uFoam * 0.8);
            }
          }
        }

        // Body colour + light scattering up through thin wave crests,
        // strongest looking toward the low sun.
        vec3 deep = vec3(0.004, 0.028, 0.045);
        vec3 sssCol = vec3(0.02, 0.16, 0.15);
        vec3 Lh = normalize(vec3(uSun.x, 0.0, uSun.z));
        float crest = clamp(vH * 1.2 + 0.35 + dot(g, vec2(0.6)), 0.0, 1.0);
        vec3 body = deep + sssCol * crest * (0.25 + 0.75 * pow(max(dot(normalize(-V.xz), Lh.xz), 0.0), 2.0)) * 0.9;

        vec3 c = mix(body, refl, F);

        // Sun glitter: a tight lobe on the choppy normals, plus a soft sheen.
        vec3 H = normalize(uSun + V);
        float NdH = max(dot(N, H), 0.0);
        c += vec3(1.0, 0.72, 0.45) * (pow(NdH, 1400.0) * 22.0 + pow(NdH, 90.0) * 0.3);

        // Sparse whitecaps on the steepest swell crests.
        float foam = smoothstep(0.42, 0.62, vH + length(g) * 0.35);
        foam *= smoothstep(0.55, 0.8, n2(vW.xz * 3.0 + uTime * 0.3) * 0.7 + n2(vW.xz * 9.0) * 0.3);
        c = mix(c, vec3(0.85, 0.82, 0.8) * (0.4 + 0.6 * refl.r), foam * 0.35 * (1.0 - smoothstep(20.0, 60.0, dist)));

        // Contact foam where the hull meets the water: a broken ring around
        // the sub's waterline, churned by the chop.
        if (uFoam > 0.0) {
          vec2 q = (vW.xz - vec2(-0.25, 0.0)) / vec2(2.95, 0.95);
          float r = length(q);
          float n = n2(vW.xz * 2.2 + uTime * 0.6) * 0.6 + n2(vW.xz * 6.0 - uTime) * 0.4;
          float ring = smoothstep(1.55, 0.95, r + n * 0.35) * smoothstep(0.75, 0.95, r);
          float f = ring * smoothstep(0.45, 0.75, n + 0.2);
          c = mix(c, vec3(0.92, 0.9, 0.88) * (0.55 + 0.45 * refl), f * 0.75 * uFoam);
        }

        // Far water converges to the mirrored horizon (matches the sky dome).
        vec3 horiz = farWater(-V, uSun);
        c = mix(c, horiz, smoothstep(120.0, 1500.0, dist));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const ocean = new THREE.Mesh(oceanGeo, oceanMat);
  ocean.frustumCulled = false;

  // ---- God rays ----------------------------------------------------------
  // One mesh of parallel shafts along RAY_DIR, each billboarded around its own
  // axis in the vertex shader. They start at the surface, sway as the waves
  // above refocus the light, and vary in width, strength and flicker.
  const RAYS = lowPower ? 16 : 30;
  const SEG = 6;
  const hit = [], tAlong = [], side = [], width = [], seed = [], strength = [], index = [];
  for (let r = 0; r < RAYS; r++) {
    // Where the shaft crosses y = 0: spread over the region the camera sees.
    const hx = (Math.random() - 0.5) * 70;
    const hz = -55 + Math.random() * 48; // always well in front of the camera
    const w = 0.7 + Math.pow(Math.random(), 1.8) * 5.0;   // mostly slim, a few broad
    const st = 0.25 + Math.random() * 0.75;
    const sd = Math.random();
    const base = hit.length / 3;
    for (let k = 0; k <= SEG; k++) {
      for (const sgn of [-1, 1]) {
        hit.push(hx, 0, hz); tAlong.push(k / SEG); side.push(sgn); width.push(w); seed.push(sd); strength.push(st);
      }
      if (k < SEG) {
        const i = base + k * 2;
        index.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
      }
    }
  }
  const rayGeo = new THREE.BufferGeometry();
  rayGeo.setAttribute('position', new THREE.Float32BufferAttribute(hit, 3)); // aHit
  rayGeo.setAttribute('aT', new THREE.Float32BufferAttribute(tAlong, 1));
  rayGeo.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  rayGeo.setAttribute('aWidth', new THREE.Float32BufferAttribute(width, 1));
  rayGeo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
  rayGeo.setAttribute('aStrength', new THREE.Float32BufferAttribute(strength, 1));
  rayGeo.setIndex(index);
  const rayMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uSurfaceY: { value: 0 }, uTop: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aT, aSide, aWidth, aSeed, aStrength;
      uniform float uTime, uTop, uSurfaceY;
      varying float vAcross, vBelow, vSeed, vStrength;
      const vec3 D = ${v3(RAY_DIR)};
      const float LEN = 75.0;
      void main() {
        vec3 H = position;
        // Waves overhead keep refocusing the light: shafts drift and breathe.
        H.xz += vec2(sin(uTime * 0.21 + aSeed * 20.0), cos(uTime * 0.17 + aSeed * 13.0)) * 1.1;
        vec3 start = H + D * ((uTop - H.y) / D.y);
        vec3 P = start + D * aT * LEN;
        vec3 S = normalize(cross(D, cameraPosition - P));
        float w = aWidth * (0.75 + 0.25 * sin(uTime * 0.45 + aSeed * 7.0));
        P += S * aSide * w * 0.5;
        vAcross = aSide; vBelow = uSurfaceY - P.y; vSeed = aSeed; vStrength = aStrength;
        gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uOpacity;
      varying float vAcross, vBelow, vSeed, vStrength;
      void main() {
        float across = pow(max(1.0 - abs(vAcross), 0.0), 1.2); // max(): pow of a negative is NaN, which the bloom smears
        float along = exp(-vBelow / 18.0) * smoothstep(0.0, 0.8, vBelow);
        float flick = 0.55 + 0.45 * sin(uTime * (0.35 + vSeed * 0.6) + vSeed * 30.0) * sin(uTime * 0.13 + vSeed * 9.0);
        float a = across * along * flick * vStrength * uOpacity * 0.7;
        gl_FragColor = vec4(vec3(0.75, 0.95, 1.0) * a, a);
      }`,
  });
  const rays = new THREE.Mesh(rayGeo, rayMat);
  rays.frustumCulled = false;
  rays.renderOrder = 3;

  group.add(ocean);

  return {
    group,
    sky,
    water,
    waterMat,
    ocean,
    oceanMat,
    rays,
    rayMat,
    update(t, surfaceY, camera, raysK, foam = 0) {
      oceanMat.uniforms.uTime.value = t;
      oceanMat.uniforms.uCloudT.value = t;
      skyMat.uniforms.uCloudT.value = t;
      oceanMat.uniforms.uFoam.value = foam;
      ocean.position.y = surfaceY;
      rayMat.uniforms.uTime.value = t;
      rayMat.uniforms.uOpacity.value = raysK;
      rays.visible = raysK > 0.002;
      // Shafts start at the surface; deep down, cap the start near the camera
      // (they've faded out by then anyway).
      rayMat.uniforms.uTop.value = Math.min(surfaceY + 0.3, camera.position.y + 40);
      rayMat.uniforms.uSurfaceY.value = surfaceY;
      sky.position.copy(camera.position);
      sky.visible = camera.position.y >= surfaceY;
      water.position.copy(camera.position);
      water.visible = !sky.visible;
    },
  };
}
