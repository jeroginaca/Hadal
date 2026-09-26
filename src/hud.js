import { pressureAtm, temperatureC, lightFraction, kgPerCm2, zoneAt, smoothstep, MAX_DEPTH } from './depth.js';

// Same cut-offs as the absorption shader, for the spectrum strip.
const SWATCH_CUT = [380, 540, 700, 860, 1150, Infinity];

const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
function formatLight(d) {
  const pct = lightFraction(d) * 100;
  if (pct >= 10) return pct.toFixed(0);
  if (pct >= 0.1) return pct.toFixed(pct >= 1 ? 1 : 2);
  const exp = Math.floor(Math.log10(pct));
  const mant = pct / Math.pow(10, exp);
  const e = String(exp).split('').map((c) => SUP[c]).join('');
  return `${mant.toFixed(1)}×10${e}`;
}

// Gauge position uses the same zone-equal mapping as the scroll.
const GAUGE = [0, 200, 1000, 4000, 6000, MAX_DEPTH];
export function zoneU(d) {
  for (let i = 1; i < GAUGE.length; i++) {
    if (d <= GAUGE[i]) return i - 1 + (d - GAUGE[i - 1]) / (GAUGE[i] - GAUGE[i - 1]);
  }
  return GAUGE.length - 1;
}
export function depthFromZoneU(u) {
  const i = Math.min(GAUGE.length - 2, Math.max(0, Math.floor(u)));
  return GAUGE[i] + (GAUGE[i + 1] - GAUGE[i]) * Math.min(1, u - i);
}

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const el = {
    depth: $('hud-depth'),
    zone: $('hud-zone'),
    pressure: $('hud-pressure'),
    temp: $('hud-temp'),
    light: $('hud-light'),
    mark: $('gauge-mark'),
    swatches: [...document.querySelectorAll('#hud-spectrum i')],
    atm: document.querySelector('[data-live="atm"]'),
    kg: document.querySelector('[data-live="kg"]'),
    tonne: document.querySelector('[data-live="tonne-note"]'),
  };
  const last = {};
  const set = (key, node, value) => {
    if (last[key] !== value) {
      last[key] = value;
      node.textContent = value;
    }
  };
  const root = document.documentElement;

  return function update(d) {
    set('depth', el.depth, Math.round(d).toLocaleString('en-US'));
    set('zone', el.zone, zoneAt(d).name);
    const atm = pressureAtm(d);
    set('pressure', el.pressure, atm < 100 ? atm.toFixed(1) : Math.round(atm).toLocaleString('en-US'));
    set('temp', el.temp, temperatureC(d).toFixed(1));
    set('light', el.light, formatLight(d));

    const u = zoneU(d) / 5;
    if (last.u !== u.toFixed(4)) {
      last.u = u.toFixed(4);
      el.mark.style.left = `${u * 100}%`;
      el.swatches.forEach((s, i) => {
        const gone = smoothstep(SWATCH_CUT[i] - 200, SWATCH_CUT[i], d);
        const dark = i === 5 ? smoothstep(1000, 1600, d) * 0.75 : 0;
        s.style.opacity = (0.1 + 0.9 * (1 - gone) * (1 - dark)).toFixed(3);
        s.style.filter = `saturate(${(1 - gone).toFixed(2)})`;
      });
      const light = Math.max(0, 1 - smoothstep(0, 1100, d) * 0.9 - smoothstep(0, 200, d) * 0.1);
      root.style.setProperty('--light', light.toFixed(3));
      root.style.setProperty('--deep', u.toFixed(3));
    }

    if (el.atm) {
      set('atm', el.atm, Math.round(atm).toLocaleString('en-US'));
      const kg = kgPerCm2(d);
      set('kg', el.kg, Math.round(kg).toLocaleString('en-US'));
      set('tonne', el.tonne, kg >= 1000 ? 'More than a tonne.' : '');
    }
  };
}
