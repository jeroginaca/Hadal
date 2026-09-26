# Hadal

A scroll-driven descent to 10,935 m for the (fictional) Hadal Trench Institute. Built with three.js and Vite, with no image, model or audio files: everything is generated in code, so the whole site is about 160 KB gzipped.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static output in dist/
```

## The one number

`depth` (metres) is the master value. `src/depth.js` maps scroll to depth and derives the physical readouts (pressure, temperature, light). `applyDepth()` in `src/main.js` then feeds that one value into every uniform, light, fog setting and audio gain, and the HUD reads it too.

**Scroll mapping.** Each `<section data-d0 data-d1>` declares the depth range it covers. Every ocean zone gets the same scroll length (`--zone: 300lvh`). Depth is linear within a zone, never across the whole page, so the 4,935 m of the hadal zone takes no more scroll than the 200 m of the sunlight zone. Two chapters hold depth still: the vessel at 4,000 m and the bottom at 10,935 m. They use chapter progress for their own animation.

## Signature moments

1. **Colour absorption** (`src/scene/absorption.js`). This is a post pass over the scene render. Each hue has a cut-off depth: red at about 380 m, orange 540 m, yellow 700 m, green 860 m. Past its cut-off, a hue loses its chroma and falls back to a dim, blue-cast grey. The camera sits on a 24-patch colour chart mounted on the sub's bow through the twilight zone. Once the floodlights take over (below about 1,000 m), the effective depth for each pixel becomes the camera-to-surface distance read from the depth buffer. Colour comes back up close under a lamp and is gone a few metres away. That's why the bait plate at the bottom is orange again. The HUD's spectrum strip uses the same cut-offs.
   *Artistic licence:* in real water, red is mostly gone by a few tens of metres. The cut-offs are stretched across 200–1,000 m so the effect plays out in the twilight chapter.
2. **Floodlights off → bioluminescence** (`src/scene/biolum.js`). This is a ring buffer of glowing points. Moving the pointer (or dragging on touch) spawns flashes and occasional siphonophore-like chains. The colours stay in the 470–490 nm band, the one that travels furthest in seawater. There are also ambient flashes, so touch users see some without touching.
3. **Sonar sweep** (`src/scene/seafloor.js`). Pings expand from under the sub and draw the abyssal plain as a point cloud with bathymetric contour lines. Solid geometry then fills in from the centre as you scroll. The points and the mesh share one heightfield.

## Constraints

- **HUD** stays on screen throughout and shows depth, pressure (atm), temperature, light remaining (physical, so it prints as ×10⁻ⁿ %), zone, a zone-equal gauge and the visible spectrum.
- **Sound is off by default.** Everything is synthesised with Web Audio (`src/audio.js`): surface wash, hull hum, sonar pings, hull creaks in the trench that come faster with depth, and a chime for bioluminescence. The bottom is silent. The AudioContext is only created when the user turns sound on. The loader's "ping per tick" is therefore visual on first load, because browsers block audio before a user gesture.
- **`prefers-reduced-motion`**: depth and camera follow scroll without easing. Waves, snow drift, camera sway and lamp flicker are frozen. The "Surface." ascent cuts straight to the sign-up form instead of animating.
- **Mid-range phones**: lower geometry and particle counts on touch or low-core devices, no MSAA, DPR capped at 1.5. Resolution drops automatically if frames run slow (throttled background tabs are ignored). If WebGL is unavailable, the page falls back to the depth-driven CSS backdrop and still drives the HUD.

## Using your own sub model

Drop a GLB at `public/models/sub.glb` and it replaces the procedural hull on load; nothing else to change. The loader (`attachModel()` in `src/scene/sub.js`) auto-fits it to the scene (turns its long axis to X, scales to ~5.4 units, centres it) and gives it the depth-driven reflections. The bow stays procedural: floodlights, beams and the colour chart the twilight chapter depends on. If the model faces the wrong way, pass `{ yaw: Math.PI }` to `attachModel`. An arbitrary model can't explode into parts, so the vessel chapter just rotates it. Keep it under ~5 MB (compress with `npx gltf-transform optimize in.glb out.glb`) so phones still load fast.

**Parked (not in the repo):** `parked/yellow_submarine.glb` — “Yellow Submarine” by Landon Wright ([Sketchfab](https://sketchfab.com/3d-models/yellow-submarine-0dcb53b8f0734509a83a51e672d27dc4)), CC BY 4.0. Copy it to `public/models/sub.glb` to use it, and restore a visible credit (CC BY requires attribution).

## Notes

- The sign-up form validates and confirms on the client only; it is **not connected to a backend**. Wire `#signup-form` to your list provider.
- Dev only: `?snap` disables easing (handy for checking a single depth), `window.__hadal` exposes state, and `__hadal.shot(name)` saves a frame to `.shots/` through the dev server.
