import * as THREE from 'three';

// Marine snow: organic debris drifting down from above. Particles live in a
// box around the sub and wrap vertically; the wrap offset is driven by depth,
// so descending makes the snow stream upward past the camera. Each flake is
// lit only when it sits inside a floodlight cone.

export function createSnow({ count = 3000, size = 1, soft = false } = {}) {
  const BOX = new THREE.Vector3(44, 30, 36);
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.3) * BOX.x;
    pos[i * 3 + 1] = Math.random() * BOX.y;
    pos[i * 3 + 2] = (Math.random() - 0.5) * BOX.z;
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uOffset: { value: 0 },
      uH: { value: BOX.y },
      uAmbient: { value: 0 },
      uFlood: { value: 0 },
      uLampP: { value: [new THREE.Vector3(), new THREE.Vector3()] },
      uLampD: { value: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(1, 0, 0)] },
      uPixel: { value: 1 },
      uSize: { value: size },
    },
    defines: soft ? { SOFT: 1 } : {},
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime, uOffset, uH, uAmbient, uFlood, uPixel, uSize;
      uniform vec3 uLampP[2]; uniform vec3 uLampD[2];
      varying float vB;
      void main() {
        vec3 p = position;
        p.y = mod(p.y + uOffset - uTime * (0.05 + aSeed * 0.08), uH) - uH * 0.5;
        p.x += sin(uTime * 0.2 + aSeed * 40.0) * 0.3;
        p.z += cos(uTime * 0.17 + aSeed * 23.0) * 0.3;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        float lit = 0.0;
        for (int i = 0; i < 2; i++) {
          vec3 v = wp.xyz - uLampP[i];
          float along = dot(v, uLampD[i]);
          if (along > 0.0) {
            float perp = length(v - uLampD[i] * along);
            float cone = 1.0 - smoothstep(0.35, 0.46, perp / along);
            lit += cone / (1.0 + along * 0.18);
          }
        }
        vB = uAmbient * (0.3 + aSeed * 0.7) + lit * uFlood * 2.6;
        vec4 mv = viewMatrix * wp;
        #ifdef SOFT
          // Out-of-focus motes: only close to the lens, dim and large.
          vB *= smoothstep(0.3, 0.9, -mv.z) * (1.0 - smoothstep(3.0, 6.0, -mv.z)) * 0.18;
        #else
          vB *= smoothstep(0.4, 2.0, -mv.z);
        #endif
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (1.5 + aSeed * 2.8) * uSize * uPixel * (16.0 / -mv.z);
      }`,
    fragmentShader: /* glsl */ `
      varying float vB;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        #ifdef SOFT
          float a = (1.0 - smoothstep(0.3, 0.5, d)) * (0.6 + 0.4 * smoothstep(0.35, 0.5, d)) * vB; // disc with a bright rim
        #else
          float a = (1.0 - smoothstep(0.0, 0.5, d)) * vB;
        #endif
        if (a < 0.003) discard;
        gl_FragColor = vec4(vec3(0.92, 0.95, 1.0) * a, a);
      }`,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 6;
  return { points, mat };
}
