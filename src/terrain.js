import * as THREE from 'three';
import { Noise2D } from './noise.js';

export const WATER_LEVEL = 1.0;

export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const COL = {
  grassA: new THREE.Color(0x6dbb4c),
  grassB: new THREE.Color(0xa8dc5e),
  grassC: new THREE.Color(0x469c47),
  sand: new THREE.Color(0xd2bd85),
  mud: new THREE.Color(0x6e5b3a),
  dirtA: new THREE.Color(0x9c6636),
  dirtB: new THREE.Color(0x6e4522),
  gravel: new THREE.Color(0x8e7f69),
  rock: new THREE.Color(0x7a7c82),
  bedrock: new THREE.Color(0x63666e),
  gold: new THREE.Color(0xe0b64a),
};

/**
 * Smooth heightmap terrain with a separate bedrock height field.
 * Digging lowers the surface with a soft, noisy falloff and is clamped
 * to bedrock. Gold richness is a function of position and how close to
 * bedrock the material was.
 */
export class Terrain {
  constructor(seed, size = 220, segments = 220) {
    this.seed = seed;
    this.size = size;
    this.segs = segments;
    this.n = segments + 1;
    this.cell = size / segments;
    this.half = size / 2;

    const N = this.n * this.n;
    this.height = new Float32Array(N);
    this.orig = new Float32Array(N);
    this.bedrock = new Float32Array(N);
    this.tint = new Float32Array(N);
    this.protect = new Uint8Array(N);
    this.reveal = new Float32Array(N); // 0..1 how much the metal detector has uncovered here

    this.noise = new Noise2D(seed);
    this.rich = new Noise2D(seed + 101);
    this.detail = new Noise2D(seed + 202);

    this._tmpN = new THREE.Vector3();
    this._tmpC = new THREE.Color();
    this._tmpC2 = new THREE.Color();
    this._tmp4 = [0, 0, 0, 0];

    this.computeSites();
    this.generate();
    this.buildMesh();
    this.buildWater();
  }

  // ---------- layout ----------
  streamZ(x) {
    return 6 + 18 * this.noise.fbm(x * 0.011 + 3.3, 7.7, 2) + 3 * this.noise.noise(x * 0.06, 2.2);
  }
  streamX(z) {
    return -52 + 15 * this.noise.fbm(z * 0.012 + 9.1, 1.3, 2);
  }
  streamDist(x, z) {
    return Math.min(Math.abs(z - this.streamZ(x)), Math.abs(x - this.streamX(z)));
  }
  hill(x, z) {
    return 4.7 + 2.6 * this.noise.fbm(x * 0.016, z * 0.016, 4) + 0.4 * this.detail.fbm(x * 0.08, z * 0.08, 2);
  }

  computeSites() {
    const cx = 16;
    const cz = this.streamZ(cx) + 17;
    const wx = cx + 18;
    this.sites = {
      camp: { x: cx, z: cz },
      spawn: { x: cx, z: cz - 3 },
      shop: { x: cx - 9, z: cz + 1 },
      fire: { x: cx, z: cz + 2 },
      tent: { x: cx - 3, z: cz + 6 },
      truck: { x: cx + 7, z: cz + 5, yaw: Math.PI * 0.5 },
      excavator: { x: cx + 13, z: cz + 4, yaw: Math.PI * 0.5 },
      loader: { x: cx + 9, z: cz - 6, yaw: -Math.PI * 0.5 },
      dozer: { x: cx + 3, z: cz - 9, yaw: -Math.PI * 0.5 },
      washPlant: { x: wx, z: this.streamZ(wx) + 7.5 },
    };
    this.campLevel = Math.max(WATER_LEVEL + 3.2, this.hill(cx, cz));
  }

  baseHeight(x, z) {
    const s = this.sites;
    let h = this.hill(x, z);
    const dc = Math.hypot(x - s.camp.x, z - s.camp.z);
    h = lerp(h, this.campLevel, 1 - smoothstep(9, 21, dc));
    const d = this.streamDist(x, z);
    h = lerp(h, WATER_LEVEL + 0.25, 1 - smoothstep(2.5, 9.5, d));
    h -= 1.05 * (1 - smoothstep(0, 3.4, d));
    const dw = Math.hypot(x - s.washPlant.x, z - s.washPlant.z);
    h = lerp(h, WATER_LEVEL + 0.8, 1 - smoothstep(4.5, 8.5, dw));
    return h;
  }

  generate() {
    const { n, sites } = this;
    for (let j = 0; j < n; j++) {
      const z = this.worldZ(j);
      for (let i = 0; i < n; i++) {
        const x = this.worldX(i);
        const k = j * n + i;
        const h = this.baseHeight(x, z);
        const d = this.streamDist(x, z);
        let bd = 1.5 + 2.4 * (0.5 + 0.5 * this.noise.fbm(x * 0.03 + 50, z * 0.03 + 50, 3));
        bd = lerp(bd, 0.75, 1 - smoothstep(1.5, 7, d));
        this.height[k] = h;
        this.orig[k] = h;
        this.bedrock[k] = h - bd;
        this.tint[k] = 0.5 + 0.5 * this.detail.fbm(x * 0.05 + 7, z * 0.05 + 7, 2);
        const prot =
          Math.hypot(x - sites.washPlant.x, z - sites.washPlant.z) < 5.2 ||
          Math.hypot(x - sites.shop.x, z - sites.shop.z) < 5 ||
          Math.hypot(x - sites.fire.x, z - sites.fire.z) < 1.6 ||
          Math.hypot(x - sites.tent.x, z - sites.tent.z) < 2.6;
        this.protect[k] = prot ? 1 : 0;
      }
    }
  }

  // ---------- grid helpers ----------
  idx(i, j) { return j * this.n + i; }
  worldX(i) { return -this.half + i * this.cell; }
  worldZ(j) { return -this.half + j * this.cell; }

  sampleField(arr, x, z) {
    const fx = clamp((x + this.half) / this.cell, 0, this.segs - 1e-6);
    const fz = clamp((z + this.half) / this.cell, 0, this.segs - 1e-6);
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const n = this.n;
    const h00 = arr[j * n + i], h10 = arr[j * n + i + 1];
    const h01 = arr[(j + 1) * n + i], h11 = arr[(j + 1) * n + i + 1];
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
  }
  heightAt(x, z) { return this.sampleField(this.height, x, z); }
  origAt(x, z) { return this.sampleField(this.orig, x, z); }
  bedrockAt(x, z) { return this.sampleField(this.bedrock, x, z); }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = this.cell;
    const hL = this.heightAt(x - e, z), hR = this.heightAt(x + e, z);
    const hU = this.heightAt(x, z - e), hD = this.heightAt(x, z + e);
    return out.set(hL - hR, 2 * e, hU - hD).normalize();
  }

  inBounds(x, z, margin = 0) {
    return Math.abs(x) < this.half - margin && Math.abs(z) < this.half - margin;
  }

  // ---------- gold ----------
  /** Grams of gold per cubic unit of material at (x, z) taken from height y. */
  richnessAt(x, z, y, bedrockY = this.bedrockAt(x, z), origY = this.origAt(x, z)) {
    const above = Math.max(0, y - bedrockY);
    const depthF = Math.exp(-above / 0.7);
    let streak = 0.5 + 0.5 * this.rich.fbm(x * 0.045, z * 0.045, 3);
    streak = Math.pow(streak, 1.7);
    const placer = origY < WATER_LEVEL + 0.45 ? 0.6 : 0;
    return (0.2 + 1.8 * streak + placer) * depthF;
  }

  // ---------- editing ----------
  _rangeFor(cx, cz, r) {
    const i0 = clamp(Math.floor((cx - r + this.half) / this.cell), 0, this.segs);
    const i1 = clamp(Math.ceil((cx + r + this.half) / this.cell), 0, this.segs);
    const j0 = clamp(Math.floor((cz - r + this.half) / this.cell), 0, this.segs);
    const j1 = clamp(Math.ceil((cz + r + this.half) / this.cell), 0, this.segs);
    return { i0, i1, j0, j1 };
  }

  /**
   * Remove material in a soft crater. Returns { volume, gold, richness, hitBedrock }.
   */
  dig(cx, cz, radius, amount) {
    const { i0, i1, j0, j1 } = this._rangeFor(cx, cz, radius);
    const area = this.cell * this.cell;
    let vol = 0, gold = 0, hitBedrock = false, blocked = false;
    for (let j = j0; j <= j1; j++) {
      const z = this.worldZ(j);
      for (let i = i0; i <= i1; i++) {
        const x = this.worldX(i);
        const d = Math.hypot(x - cx, z - cz);
        if (d >= radius) continue;
        const k = j * this.n + i;
        if (this.protect[k]) { blocked = true; continue; }
        let w = 1 - (d / radius) * (d / radius);
        w = w * w;
        w *= 0.7 + 0.6 * (0.5 + 0.5 * this.detail.noise(x * 0.9 + 11, z * 0.9 - 5));
        const room = this.height[k] - this.bedrock[k];
        if (room <= 0.005) { if (d < radius * 0.6) hitBedrock = true; continue; }
        const dh = Math.min(amount * w, room);
        if (dh <= 1e-4) continue;
        if (dh >= room - 1e-4 && d < radius * 0.6) hitBedrock = true;
        const yMid = this.height[k] - dh * 0.5;
        const rich = this.richnessAt(x, z, yMid, this.bedrock[k], this.orig[k]);
        this.height[k] -= dh;
        const v = dh * area;
        vol += v;
        gold += v * rich;
      }
    }
    if (vol > 0) this.updateRegion(i0, j0, i1, j1);
    return { volume: vol, gold, richness: vol > 0 ? gold / vol : 0, hitBedrock, blocked };
  }

  /** Add material as a soft pile. Returns volume added. */
  raise(cx, cz, radius, amount, cap = 2.5) {
    const { i0, i1, j0, j1 } = this._rangeFor(cx, cz, radius);
    const area = this.cell * this.cell;
    let vol = 0;
    for (let j = j0; j <= j1; j++) {
      const z = this.worldZ(j);
      for (let i = i0; i <= i1; i++) {
        const x = this.worldX(i);
        const d = Math.hypot(x - cx, z - cz);
        if (d >= radius) continue;
        const k = j * this.n + i;
        if (this.protect[k]) continue;
        let w = 1 - (d / radius) * (d / radius);
        w = w * w;
        w *= 0.75 + 0.5 * (0.5 + 0.5 * this.detail.noise(x * 0.8 - 3, z * 0.8 + 9));
        const maxH = this.orig[k] + cap;
        const dh = Math.max(0, Math.min(amount * w, maxH - this.height[k]));
        if (dh <= 1e-4) continue;
        this.height[k] += dh;
        vol += dh * area;
      }
    }
    if (vol > 0) this.updateRegion(i0, j0, i1, j1);
    return vol;
  }

  // ---------- mesh ----------
  buildMesh() {
    const { n, segs } = this;
    const N = n * n;
    const positions = new Float32Array(N * 3);
    const normals = new Float32Array(N * 3);
    const colors = new Float32Array(N * 3);
    const index = new Uint32Array(segs * segs * 6);

    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        positions[k * 3] = this.worldX(i);
        positions[k * 3 + 1] = this.height[k];
        positions[k * 3 + 2] = this.worldZ(j);
      }
    }
    let p = 0;
    for (let j = 0; j < segs; j++) {
      for (let i = 0; i < segs; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        index[p++] = a; index[p++] = c; index[p++] = b;
        index[p++] = b; index[p++] = c; index[p++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    this.geometry = geo;

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.0 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.name = 'terrain';

    // Underground overlay: shares positions/index with the terrain, has its own RGBA colors.
    // Unlit so the gold "glows"; alpha comes from how much the detector has revealed.
    const ogeo = new THREE.BufferGeometry();
    ogeo.setAttribute('position', geo.attributes.position);
    ogeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 4), 4));
    ogeo.setIndex(geo.index);
    this.overlayGeometry = ogeo;
    this.overlay = new THREE.Mesh(
      ogeo,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, opacity: 0.7 })
    );
    this.overlay.position.y = 0.06;
    this.overlay.renderOrder = 2;
    this.overlay.name = 'underground';
    this.mesh.add(this.overlay);

    this.updateRegion(0, 0, segs, segs);
  }

  /** RGBA of the underground overlay at vertex k (alpha already scaled by reveal). */
  overlayColor(k, out) {
    const rv = this.reveal[k];
    if (rv < 0.005) { out[0] = out[1] = out[2] = out[3] = 0; return; }
    const h = this.height[k], b = this.bedrock[k], o = this.orig[k];
    const i = k % this.n, j = (k - i) / this.n;
    const x = this.worldX(i), z = this.worldZ(j);
    const room = h - b;
    // gold still sitting on bedrock (nothing left once dug out)
    const rich = room > 0.04 ? this.richnessAt(x, z, b + 0.05, b, o) : 0;
    // Gold shows as veins/flecks over dark ground; richer ground â†’ denser, brighter veins.
    const rn = clamp(rich / 1.8, 0, 1);
    const vein = 0.5 + 0.5 * this.detail.noise(x * 0.75 + 31, z * 0.75 - 17);
    const speck = 0.5 + 0.5 * this.rich.noise(x * 2.6 - 9, z * 2.6 + 4);
    const thr = 0.88 - 0.62 * rn;
    const mask = Math.max(smoothstep(thr - 0.12, thr + 0.12, vein), 0.6 * smoothstep(thr + 0.05, thr + 0.2, speck));
    const g = rich < 0.06 ? 0 : mask * (0.45 + 0.55 * rn);
    const depth = clamp(room / 4, 0, 1);
    // slate "see-through ground", darker where the overburden is deep
    let r = 0.05, gg = 0.07, bb = 0.13, a = 0.45 + 0.3 * depth;
    // gold veins
    const gr = lerp(0.7, 1.0, g), gG = lerp(0.45, 0.8, g), gB = lerp(0.05, 0.15, g);
    r = lerp(r, gr, g); gg = lerp(gg, gG, g); bb = lerp(bb, gB, g);
    a = lerp(a, 1.0, g);
    out[0] = r; out[1] = gg; out[2] = bb; out[3] = a * rv;
  }

  updateOverlayRegion(i0, j0, i1, j1) {
    const col = this.overlayGeometry.attributes.color;
    const n = this.n, tmp = this._tmp4;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * n + i;
        this.overlayColor(k, tmp);
        col.array[k * 4] = tmp[0]; col.array[k * 4 + 1] = tmp[1]; col.array[k * 4 + 2] = tmp[2]; col.array[k * 4 + 3] = tmp[3];
      }
    }
    col.needsUpdate = true;
  }

  /** Metal detector sweep: raise reveal in a feathered circle. Returns newly revealed amount. */
  revealArea(cx, cz, radius, amount) {
    const { i0, i1, j0, j1 } = this._rangeFor(cx, cz, radius);
    let gained = 0;
    for (let j = j0; j <= j1; j++) {
      const z = this.worldZ(j);
      for (let i = i0; i <= i1; i++) {
        const x = this.worldX(i);
        const d = Math.hypot(x - cx, z - cz);
        if (d >= radius) continue;
        const k = j * this.n + i;
        const w = 1 - smoothstep(radius * 0.45, radius, d);
        const before = this.reveal[k];
        this.reveal[k] = Math.min(1, before + amount * w);
        gained += this.reveal[k] - before;
      }
    }
    if (gained > 0) this.updateOverlayRegion(i0, j0, i1, j1);
    return gained;
  }

  /** Detector reading at a point: gold on bedrock and how deep it is. */
  probe(x, z) {
    const b = this.bedrockAt(x, z), h = this.heightAt(x, z), o = this.origAt(x, z);
    const room = h - b;
    return { richness: room > 0.04 ? this.richnessAt(x, z, b + 0.05, b, o) : 0, depth: Math.max(0, room) };
  }

  buildWater() {
    const geo = new THREE.PlaneGeometry(this.size * 1.6, this.size * 1.6, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x3aa6dd,
      transparent: true,
      opacity: 0.72,
      roughness: 0.15,
      metalness: 0.05,
      depthWrite: false,
    });
    this.water = new THREE.Mesh(geo, mat);
    this.water.position.y = WATER_LEVEL;
    this.water.receiveShadow = true;
    this.water.name = 'water';
  }

  computeNormal(i, j, out) {
    const iL = Math.max(i - 1, 0), iR = Math.min(i + 1, this.segs);
    const jU = Math.max(j - 1, 0), jD = Math.min(j + 1, this.segs);
    const hL = this.height[j * this.n + iL], hR = this.height[j * this.n + iR];
    const hU = this.height[jU * this.n + i], hD = this.height[jD * this.n + i];
    const sx = (iR - iL) * this.cell, sz = (jD - jU) * this.cell;
    return out.set((hL - hR) / sx, 1, (hU - hD) / sz).normalize();
  }

  vertexColor(k, ny, out) {
    const h = this.height[k], o = this.orig[k], b = this.bedrock[k], t = this.tint[k];
    const tmp = this._tmpC2;
    out.copy(COL.grassA).lerp(COL.grassB, t);
    const alt = clamp((o - 1.5) / 4.5, 0, 1);
    out.lerp(COL.grassC, (1 - alt) * 0.4);
    const sandMix = 1 - smoothstep(0.05, 0.7, o - WATER_LEVEL);
    out.lerp(COL.sand, sandMix * 0.9);
    if (h < WATER_LEVEL) out.lerp(COL.mud, 0.55 * smoothstep(0, 0.8, WATER_LEVEL - h));
    const dug = Math.abs(o - h);
    const dirtMix = smoothstep(0.03, 0.3, dug);
    const steep = (1 - smoothstep(0.55, 0.8, ny)) * (1 - dirtMix);
    out.lerp(COL.rock, steep * 0.85);
    tmp.copy(COL.dirtA).lerp(COL.dirtB, t);
    out.lerp(tmp, dirtMix);
    const above = h - b;
    const gravelMix = (1 - smoothstep(0.1, 1.0, above)) * dirtMix;
    if (gravelMix > 0.001) {
      out.lerp(COL.gravel, gravelMix);
      const i = k % this.n, j = (k - i) / this.n;
      const rich = this.richnessAt(this.worldX(i), this.worldZ(j), h, b, o);
      out.lerp(COL.gold, gravelMix * clamp(rich / 2.2, 0, 1) * 0.55);
    }
    const bedMix = 1 - smoothstep(0.015, 0.09, above);
    if (bedMix > 0.001) out.lerp(COL.bedrock, bedMix * (0.8 + 0.2 * t));
    return out;
  }

  updateRegion(i0, j0, i1, j1) {
    const pos = this.geometry.attributes.position;
    const nor = this.geometry.attributes.normal;
    const col = this.geometry.attributes.color;
    const n = this.n;
    const ia = Math.max(0, i0 - 1), ib = Math.min(this.segs, i1 + 1);
    const ja = Math.max(0, j0 - 1), jb = Math.min(this.segs, j1 + 1);
    const nv = this._tmpN, c = this._tmpC;
    for (let j = ja; j <= jb; j++) {
      for (let i = ia; i <= ib; i++) {
        const k = j * n + i;
        pos.array[k * 3 + 1] = this.height[k];
        this.computeNormal(i, j, nv);
        nor.array[k * 3] = nv.x; nor.array[k * 3 + 1] = nv.y; nor.array[k * 3 + 2] = nv.z;
        this.vertexColor(k, nv.y, c);
        col.array[k * 3] = c.r; col.array[k * 3 + 1] = c.g; col.array[k * 3 + 2] = c.b;
      }
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    col.needsUpdate = true;
    this.geometry.computeBoundingSphere();
    this.updateOverlayRegion(ia, ja, ib, jb);
    this.overlayGeometry.boundingSphere = this.geometry.boundingSphere;
  }

  serializeReveal() {
    const q = new Uint8Array(this.reveal.length);
    let any = false;
    for (let k = 0; k < q.length; k++) { q[k] = Math.round(this.reveal[k] * 255); if (q[k]) any = true; }
    if (!any) return null;
    let s = '';
    for (let i = 0; i < q.length; i += 8192) s += String.fromCharCode.apply(null, q.subarray(i, i + 8192));
    return { n: this.n, data: btoa(s) };
  }

  deserializeReveal(obj) {
    if (!obj || obj.n !== this.n) return;
    const bin = atob(obj.data);
    for (let k = 0; k < this.reveal.length && k < bin.length; k++) this.reveal[k] = bin.charCodeAt(k) / 255;
    this.updateOverlayRegion(0, 0, this.segs, this.segs);
  }

  /**
   * Earthworks brush: move the ground inside a soft circle toward targetY, at most `rate` metres
   * per call at the centre. Cuts stop at bedrock; fills stop at orig + fillCap. Nothing is
   * conserved â€” this is paid-for earthmoving. Returns { cut, fill } volumes in mÂ³.
   */
  flatten(cx, cz, radius, targetY, rate, fillCap = 6) {
    const { i0, i1, j0, j1 } = this._rangeFor(cx, cz, radius);
    const area = this.cell * this.cell;
    let cut = 0, fill = 0, blocked = false;
    for (let j = j0; j <= j1; j++) {
      const z = this.worldZ(j);
      for (let i = i0; i <= i1; i++) {
        const x = this.worldX(i);
        const d = Math.hypot(x - cx, z - cz);
        if (d >= radius) continue;
        const k = j * this.n + i;
        if (this.protect[k]) { blocked = true; continue; }
        const w = 1 - smoothstep(radius * 0.55, radius, d);
        const h = this.height[k];
        const diff = targetY - h;
        if (Math.abs(diff) < 0.004) continue;
        let dh = Math.sign(diff) * Math.min(Math.abs(diff), rate * w);
        if (dh < 0) dh = -Math.min(-dh, Math.max(0, h - this.bedrock[k]));
        else dh = Math.min(dh, Math.max(0, this.orig[k] + fillCap - h));
        if (Math.abs(dh) <= 1e-5) continue;
        this.height[k] += dh;
        if (dh < 0) cut -= dh * area; else fill += dh * area;
      }
    }
    if (cut > 0 || fill > 0) this.updateRegion(i0, j0, i1, j1);
    return { cut, fill, blocked };
  }

  // ---------- persistence ----------
  serializeHeights() {
    let min = Infinity, max = -Infinity;
    for (let k = 0; k < this.height.length; k++) {
      const v = this.height[k];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const scale = (max - min) || 1;
    const q = new Uint16Array(this.height.length);
    for (let k = 0; k < q.length; k++) q[k] = Math.round(((this.height[k] - min) / scale) * 65535);
    const bytes = new Uint8Array(q.buffer);
    let s = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    return { min, scale, n: this.n, data: btoa(s) };
  }

  deserializeHeights(obj) {
    if (!obj || obj.n !== this.n) return false;
    const bin = atob(obj.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const q = new Uint16Array(bytes.buffer);
    for (let k = 0; k < this.height.length; k++) {
      this.height[k] = obj.min + (q[k] / 65535) * obj.scale;
    }
    this.updateRegion(0, 0, this.segs, this.segs);
    return true;
  }
}
