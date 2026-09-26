// The master value. Everything on the page is a function of `depth` (metres).
// Scroll → depth uses section boundaries so each ocean zone gets equal scroll
// length; depth is linear *within* a zone, never across the whole page.

export const MAX_DEPTH = 10935;

export const ZONES = [
  { id: 'sunlight', name: 'Sunlight zone', from: 0, to: 200 },
  { id: 'twilight', name: 'Twilight zone', from: 200, to: 1000 },
  { id: 'midnight', name: 'Midnight zone', from: 1000, to: 4000 },
  { id: 'abyssal', name: 'Abyssal zone', from: 4000, to: 6000 },
  { id: 'hadal', name: 'Hadal zone', from: 6000, to: MAX_DEPTH },
];

export function zoneAt(d) {
  if (d <= 0.5) return { id: 'surface', name: 'Surface' };
  return ZONES.find((z) => d <= z.to) || ZONES[ZONES.length - 1];
}

// Reads every <section data-d0 data-d1> and builds a piecewise-linear map from
// scrollY to depth, plus per-section progress for chapters that hold depth.
export class ScrollDepthMap {
  constructor(sections) {
    this.sections = sections;
    this.measure();
  }
  measure() {
    const y0 = window.scrollY;
    this.spans = this.sections.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.dataset.chapter,
        top: r.top + y0,
        h: Math.max(1, r.height),
        d0: parseFloat(el.dataset.d0),
        d1: parseFloat(el.dataset.d1),
      };
    });
    this.maxScroll = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  }
  // Returns { depth, chapter, t } where t is progress through that chapter.
  sample(scrollY) {
    const s = this.spans;
    let cur = s[0];
    for (const span of s) if (scrollY >= span.top - 1) cur = span;
    // The last section is one viewport tall; treat reaching max scroll as t=1.
    const len = cur === s[s.length - 1] ? Math.max(1, this.maxScroll - cur.top) : cur.h;
    const t = clamp((scrollY - cur.top) / len, 0, 1);
    return { depth: cur.d0 + (cur.d1 - cur.d0) * t, chapter: cur.id, t };
  }
  topOf(id) {
    const span = this.spans.find((x) => x.id === id);
    return span ? span.top : 0;
  }
}

// ---- Physical readouts -------------------------------------------------------

// ~1 atm per 10.06 m of seawater, plus the atmosphere on top.
export const pressureAtm = (d) => 1 + d / 10.06;

// kgf per cm² ≈ 1.033 × atm. Used for the "a tonne per square centimetre" line.
export const kgPerCm2 = (d) => (pressureAtm(d) * 1.0332);

// Sunlight falls to 1% at ~200 m (the bottom of the euphotic zone).
const L = 200 / Math.log(100);
export const lightFraction = (d) => Math.exp(-d / L);

// A plausible western-Pacific profile: warm surface, a steep thermocline,
// near-freezing abyss, then slight adiabatic warming in the trench.
const TEMP = [
  [0, 24.0], [50, 23.2], [200, 15.0], [500, 8.0], [1000, 4.5],
  [2000, 3.0], [4000, 1.9], [6000, 1.5], [9000, 2.0], [MAX_DEPTH, 2.5],
];
export function temperatureC(d) {
  for (let i = 1; i < TEMP.length; i++) {
    const [d1, t1] = TEMP[i];
    const [d0, t0] = TEMP[i - 1];
    if (d <= d1) return t0 + ((t1 - t0) * (d - d0)) / (d1 - d0);
  }
  return TEMP[TEMP.length - 1][1];
}

// ---- helpers ----------------------------------------------------------------
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
