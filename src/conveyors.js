import * as THREE from 'three';
import { CONFIG } from './config.js';
import { WATER_LEVEL, clamp } from './terrain.js';

/**
 * Factorio-style conveyor logistics on a 2 m world grid.
 *
 *  - Belts occupy one grid cell each and point in one of four directions. A belt fed from the
 *    side (and not from behind) renders and routes as a 90° curve.
 *  - A belt hopper is a structure vehicles dump paydirt into; it drips lumps onto the belt in
 *    front of it. Lumps ride the belts and fall into the wash plant hopper when a belt ends there.
 *  - Lumps are discrete 0.5 m³ chunks of paydirt that carry their own gold, so nothing is lost
 *    in transit; a blocked belt just backs up.
 */
export const G = 2; // grid cell size in metres
const DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]]; // dir → (dx, dz): 0 = +z, 1 = +x, 2 = −z, 3 = −x
const key = (gx, gz) => `${gx},${gz}`;

const BELT_BASE = new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.9 });
const HOPPER_MAT = new THREE.MeshStandardMaterial({ color: 0x6b7480, roughness: 0.6, metalness: 0.35 });
const HOPPER_DARK = new THREE.MeshStandardMaterial({ color: 0x2b2e34, roughness: 0.9 });
const HOPPER_YELLOW = new THREE.MeshStandardMaterial({ color: 0xe6b422, roughness: 0.7 });
const GHOST_OK = new THREE.MeshBasicMaterial({ color: 0x7ee08a, transparent: true, opacity: 0.45, depthWrite: false });
const GHOST_BAD = new THREE.MeshBasicMaterial({ color: 0xff6b5a, transparent: true, opacity: 0.45, depthWrite: false });
const GRID_MAT = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false });

function makeStripeTexture() {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#4a4e57';
  ctx.fillRect(0, 0, 32, 64);
  ctx.fillStyle = '#2a2d33';
  for (let y = 0; y < 64; y += 16) ctx.fillRect(0, y, 32, 7);
  // chevron pointing along +v (direction of travel). CanvasTexture flips Y, so the apex goes to lower canvas y.
  ctx.strokeStyle = '#e6b422';
  ctx.lineWidth = 3;
  for (let y = 0; y < 64; y += 32) {
    ctx.beginPath();
    ctx.moveTo(6, y + 18); ctx.lineTo(16, y + 10); ctx.lineTo(26, y + 18);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.anisotropy = 4;
  return tex;
}

/** Path through a belt cell in local space (cell centre at origin, travel toward +z). */
function beltPath(curve, t, out) {
  if (curve === 0) return out.set(0, -1 + 2 * t);
  const a = -Math.PI / 2 + (Math.PI / 2) * t;
  return out.set(curve - curve * Math.cos(a), 1 + Math.sin(a));
}
const PATH_LEN = [Math.PI / 2, 2, Math.PI / 2]; // index curve+1

/** Ribbon mesh following beltPath, UV v along travel so the stripe texture scrolls with the lumps. */
function ribbonGeometry(curve, width, segs = 10) {
  const pos = [], uv = [], idx = [];
  const p = new THREE.Vector2(), q = new THREE.Vector2();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    beltPath(curve, t, p);
    beltPath(curve, Math.min(1, t + 0.01), q);
    if (t >= 1) { beltPath(curve, 0.99, q); q.set(2 * p.x - q.x, 2 * p.y - q.y); }
    const tx = q.x - p.x, tz = q.y - p.y, l = Math.hypot(tx, tz) || 1;
    const nx = -tz / l, nz = tx / l; // left normal
    pos.push(p.x + nx * width / 2, 0, p.y + nz * width / 2, p.x - nx * width / 2, 0, p.y - nz * width / 2);
    const v = t * PATH_LEN[curve + 1] / 2;
    uv.push(0, v, 1, v);
    if (i < segs) { const b = i * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class Conveyors {
  constructor(game) {
    this.game = game;
    this.cells = new Map(); // key → belt | hopper
    this.belts = [];
    this.hoppers = [];
    this.group = new THREE.Group();
    game.scene.add(this.group);

    this.stripes = makeStripeTexture();
    this.beltMat = new THREE.MeshStandardMaterial({ map: this.stripes, roughness: 0.85 });
    this.ribbonGeos = [ribbonGeometry(-1, 1.5), ribbonGeometry(0, 1.5, 2), ribbonGeometry(1, 1.5)];
    this.baseGeo = new THREE.BoxGeometry(G - 0.1, 0.18, G - 0.1);
    this.baseGeo.translate(0, 0.09, 0);

    // lumps of paydirt riding the belts
    const lumpGeo = new THREE.IcosahedronGeometry(0.24, 1);
    const lp = lumpGeo.attributes.position;
    for (let i = 0; i < lp.count; i++) lp.setY(i, lp.getY(i) * 0.7);
    this.lumpMesh = new THREE.InstancedMesh(lumpGeo, new THREE.MeshStandardMaterial({ roughness: 1, vertexColors: false }), CONFIG.conveyor.maxLumps);
    this.lumpMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.lumpMesh.count = 0;
    this.lumpMesh.castShadow = true;
    this.lumpMesh.frustumCulled = false;
    this.group.add(this.lumpMesh);
    this._m4 = new THREE.Matrix4();
    this._up = new THREE.Vector3(0, 1, 0);
    this._n = new THREE.Vector3();
    this._qYaw = new THREE.Quaternion();
    this._qTilt = new THREE.Quaternion();
    this._v2 = new THREE.Vector2();
    this._v3 = new THREE.Vector3();
    this._col = new THREE.Color();
    this._brown = new THREE.Color(0x8a5a30);
    this._gold = new THREE.Color(0xd9a441);

    // build mode
    this.build = { active: false, tool: 'belt', dir: 0, lastCell: null, dragging: false };
    this.ghost = new THREE.Group();
    this.ghost.visible = false;
    this.ghostBase = new THREE.Mesh(this.baseGeo, GHOST_OK);
    this.ghostRibbon = new THREE.Mesh(this.ribbonGeos[1], this.ghostBeltMat = new THREE.MeshBasicMaterial({ map: this.stripes, transparent: true, opacity: 0.8, depthWrite: false }));
    this.ghostRibbon.position.y = 0.26;
    this.ghostArrow = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.8, 8), GHOST_OK);
    this.ghostArrow.rotation.x = Math.PI / 2;
    this.ghostArrow.position.set(0, 0.5, 0.6);
    this.ghostHopper = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 2.2), GHOST_OK);
    this.ghostHopper.position.y = 0.8;
    this.ghost.add(this.ghostBase, this.ghostRibbon, this.ghostArrow, this.ghostHopper);
    this.group.add(this.ghost);
    // grid overlay shown around the cursor while building: short per-cell edges so it drapes over hills
    const gridPts = [];
    const R = 5;
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
      const x0 = (i - 0.5) * G, z0 = (j - 0.5) * G;
      gridPts.push(x0, 0, z0, x0 + G, 0, z0);
      gridPts.push(x0, 0, z0, x0, 0, z0 + G);
      if (i === R) gridPts.push(x0 + G, 0, z0, x0 + G, 0, z0 + G);
      if (j === R) gridPts.push(x0, 0, z0 + G, x0 + G, 0, z0 + G);
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3));
    this.gridLines = new THREE.LineSegments(gg, GRID_MAT);
    this.gridLines.visible = false;
    this.gridLines.frustumCulled = false;
    this.group.add(this.gridLines);
    this._gridPos = new Float32Array(gridPts);
  }

  // ------------------------------------------------------------ grid helpers
  cellOf(x, z) { return { gx: Math.round(x / G), gz: Math.round(z / G) }; }
  centre(gx, gz) { return { x: gx * G, z: gz * G }; }
  at(gx, gz) { return this.cells.get(key(gx, gz)) || null; }
  nextOf(c) { return { gx: c.gx + DIRS[c.dir][0], gz: c.gz + DIRS[c.dir][1] }; }

  /** Where a belt's output lands: another cell, the wash plant, or nothing. */
  target(belt) {
    const n = this.nextOf(belt);
    const cell = this.at(n.gx, n.gz);
    if (cell && cell.type === 'belt') return { kind: 'belt', belt: cell };
    const hp = this.game.washPlant.hopperPos;
    const c = this.centre(n.gx, n.gz);
    if (Math.hypot(hp.x - c.x, hp.z - c.z) < CONFIG.conveyor.intakeRadius) return { kind: 'plant' };
    return { kind: 'none' };
  }

  /** Can a structure go on this cell? Returns { ok, reason }. */
  canPlace(gx, gz, tool) {
    const t = this.game.terrain;
    const c = this.centre(gx, gz);
    if (!t.inBounds(c.x, c.z, 4)) return { ok: false, reason: 'Out of bounds' };
    if (this.at(gx, gz)) return { ok: false, reason: 'Occupied' };
    const h = t.heightAt(c.x, c.z);
    if (h < WATER_LEVEL + 0.15) return { ok: false, reason: 'Too wet — raise the ground first' };
    const slope = Math.max(
      Math.abs(t.heightAt(c.x + 1, c.z) - t.heightAt(c.x - 1, c.z)),
      Math.abs(t.heightAt(c.x, c.z + 1) - t.heightAt(c.x, c.z - 1))
    );
    if (slope > CONFIG.conveyor.maxSlope) return { ok: false, reason: 'Too steep — flatten it with the dozer' };
    const wp = this.game.washPlant.pos;
    if (Math.hypot(wp.x - c.x, wp.z - c.z) < 2.6) return { ok: false, reason: 'Inside the wash plant' };
    const r = tool === 'hopper' ? 2.2 : 1.2;
    for (const col of this.game.colliders) {
      if (col.plant || col.belt) continue; // plant body handled above; belt hoppers are handled by the cell map
      if (Math.hypot(col.x - c.x, col.z - c.z) < col.r + r * 0.6) return { ok: false, reason: 'Blocked by an obstacle' };
    }
    for (const v of this.game.vehicles) if (Math.hypot(v.pos.x - c.x, v.pos.z - c.z) < v.radius + r * 0.5) return { ok: false, reason: 'A vehicle is in the way' };
    for (const tr of this.game.turrets) if (tr.alive && Math.hypot(tr.pos.x - c.x, tr.pos.z - c.z) < 1.6) return { ok: false, reason: 'Turret in the way' };
    const p = this.game.player.pos;
    if (Math.hypot(p.x - c.x, p.z - c.z) > CONFIG.conveyor.buildRange) return { ok: false, reason: 'Too far away' };
    return { ok: true, reason: '' };
  }

  // ------------------------------------------------------------ placement
  placeBelt(gx, gz, dir, silent = false) {
    if (this.at(gx, gz)) return null;
    const c = this.centre(gx, gz);
    const belt = { type: 'belt', gx, gz, dir, curve: 0, items: [], y: this.game.terrain.heightAt(c.x, c.z), x: c.x, z: c.z, group: null, ribbon: null };
    this.cells.set(key(gx, gz), belt);
    this.belts.push(belt);
    this._buildBeltMesh(belt);
    this._protect(c.x, c.z, 1);
    this._refreshAround(gx, gz);
    if (!silent) this.game.particles.burst(c.x, belt.y + 0.3, c.z, 6, 0xe6b422, 1, 1.5, 0.5);
    return belt;
  }

  placeHopper(gx, gz, dir, silent = false) {
    if (this.at(gx, gz)) return null;
    const c = this.centre(gx, gz);
    const h = { type: 'hopper', gx, gz, dir, vol: 0, gold: 0, x: c.x, z: c.z, y: this.game.terrain.heightAt(c.x, c.z), capacity: CONFIG.conveyor.hopperCapacity, group: null, emitTimer: 0, collider: null };
    h.collider = { x: c.x, z: c.z, r: 1.5, belt: true };
    this.game.colliders.push(h.collider);
    this.cells.set(key(gx, gz), h);
    this.hoppers.push(h);
    this._buildHopperMesh(h);
    this._protect(c.x, c.z, 1);
    this._refreshAround(gx, gz);
    if (!silent) this.game.particles.burst(c.x, h.y + 0.5, c.z, 12, 0xe6b422, 1.6, 2, 0.6);
    return h;
  }

  /** Remove whatever is on the cell. Returns the removed structure (with any lost material). */
  remove(gx, gz) {
    const c = this.at(gx, gz);
    if (!c) return null;
    this.cells.delete(key(gx, gz));
    if (c.type === 'belt') this.belts.splice(this.belts.indexOf(c), 1);
    else {
      this.hoppers.splice(this.hoppers.indexOf(c), 1);
      const i = this.game.colliders.indexOf(c.collider);
      if (i >= 0) this.game.colliders.splice(i, 1);
    }
    this.group.remove(c.group);
    this._protect(c.x, c.z, -1);
    this._refreshAround(gx, gz);
    return c;
  }

  rotate(gx, gz, dir) {
    const c = this.at(gx, gz);
    if (!c || c.dir === dir) return;
    c.dir = dir;
    if (c.type === 'belt') this._buildBeltMesh(c); else this._seat(c);
    this._refreshAround(gx, gz);
  }

  _protect(x, z, delta) {
    const t = this.game.terrain;
    const i0 = Math.round((x - 0.9 + t.half) / t.cell), i1 = Math.round((x + 0.9 + t.half) / t.cell);
    const j0 = Math.round((z - 0.9 + t.half) / t.cell), j1 = Math.round((z + 0.9 + t.half) / t.cell);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (i < 0 || j < 0 || i >= t.n || j >= t.n) continue;
      const k = j * t.n + i;
      if (t.protect[k] === 1) continue; // camp stays camp
      t.protect[k] = Math.max(0, t.protect[k] + delta * 2);
    }
  }

  /** Recompute curve shapes for this cell and its neighbours. */
  _refreshAround(gx, gz) {
    for (const [dx, dz] of [[0, 0], ...DIRS]) {
      const c = this.at(gx + dx, gz + dz);
      if (c && c.type === 'belt') this._updateCurve(c);
    }
  }

  /** Which shape a belt at (gx,gz) facing dir would take: 0 straight, ±1 curve fed from a side. */
  _curveFor(gx, gz, dir) {
    let fromBehind = false, side = 0;
    for (let d = 0; d < 4; d++) {
      const n = this.at(gx - DIRS[d][0], gz - DIRS[d][1]); // neighbour on the −d side
      if (!n || n.dir !== d) continue; // it must point at us
      if (d === dir) fromBehind = true;
      else if (d !== (dir + 2) % 4) {
        // a feeder pointing in direction dir+1 sits on our local −x side; dir+3 sits on +x
        side = d === (dir + 1) % 4 ? -1 : 1;
      }
    }
    return fromBehind || side === 0 ? 0 : side;
  }

  /** Does anything already feed this cell? */
  _hasInput(gx, gz) {
    for (let d = 0; d < 4; d++) {
      const n = this.at(gx - DIRS[d][0], gz - DIRS[d][1]);
      if (n && n.dir === d) return true;
    }
    return false;
  }

  /**
   * Factorio-style corner: when a belt is dropped beside the dead end of a line, the dead-end belt
   * turns to face it (becoming a curve if it had a belt behind it). Only for single placements —
   * dragging already steers its own corners.
   */
  _connectDeadEnds(belt) {
    if (this._hasInput(belt.gx, belt.gz)) return;
    const out = this.nextOf(belt);
    for (let d = 0; d < 4; d++) {
      const nx = belt.gx + DIRS[d][0], nz = belt.gz + DIRS[d][1];
      if (nx === out.gx && nz === out.gz) continue; // that's where we point; don't make a head-on pair
      const n = this.at(nx, nz);
      if (!n || n.type !== 'belt') continue;
      if (this.target(n).kind !== 'none') continue; // it already goes somewhere
      const toUs = (d + 2) % 4;
      if (n.dir === toUs) continue;
      if (n.dir === belt.dir || n.dir === (belt.dir + 2) % 4) continue; // parallel lines are left alone
      this.rotate(nx, nz, toUs);
      return;
    }
  }

  _updateCurve(belt) {
    const curve = this._curveFor(belt.gx, belt.gz, belt.dir);
    if (curve !== belt.curve) {
      belt.curve = curve;
      this._buildBeltMesh(belt);
    }
  }

  _buildBeltMesh(belt) {
    if (belt.group) this.group.remove(belt.group);
    const g = new THREE.Group();
    const base = new THREE.Mesh(this.baseGeo, BELT_BASE);
    base.receiveShadow = true;
    g.add(base);
    const ribbon = new THREE.Mesh(this.ribbonGeos[belt.curve + 1], this.beltMat);
    ribbon.position.y = 0.2;
    g.add(ribbon);
    if (belt.curve === 0) {
      for (const sx of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, G - 0.1), HOPPER_YELLOW);
        rail.position.set(sx * 0.85, 0.25, 0);
        g.add(rail);
      }
    }
    belt.group = g;
    this._seat(belt);
    this.group.add(g);
  }

  /** Sit a structure on the ground; belts tilt with the slope so lines can run up hills. */
  _seat(c) {
    const t = this.game.terrain;
    c.y = t.heightAt(c.x, c.z);
    c.group.position.set(c.x, c.y, c.z);
    this._qYaw.setFromAxisAngle(this._up, c.dir * Math.PI / 2);
    if (c.type === 'belt') {
      t.normalAt(c.x, c.z, this._n);
      this._qTilt.setFromUnitVectors(this._up, this._n);
      c.group.quaternion.copy(this._qTilt).multiply(this._qYaw);
    } else c.group.quaternion.copy(this._qYaw);
  }

  _buildHopperMesh(h) {
    const g = new THREE.Group();
    const legs = [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]];
    for (const [x, z] of legs) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.2, 0.16), HOPPER_DARK); l.position.set(x, 0.6, z); g.add(l); }
    const bin = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.1, 2.3), HOPPER_MAT);
    bin.position.y = 1.55;
    bin.castShadow = true;
    g.add(bin);
    const rim = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.16, 2.5), HOPPER_YELLOW);
    rim.position.y = 2.15;
    g.add(rim);
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 1.9), HOPPER_DARK);
    mouth.position.y = 2.24;
    g.add(mouth);
    const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.9, 0.7, 8), HOPPER_MAT);
    funnel.position.y = 0.7;
    g.add(funnel);
    const chute = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.14, 1.2), HOPPER_MAT);
    chute.position.set(0, 0.42, 0.9);
    chute.rotation.x = 0.25;
    g.add(chute);
    // fill indicator inside the bin
    const fill = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1, 1.8), new THREE.MeshStandardMaterial({ color: 0x8a5a30, roughness: 1 }));
    fill.position.y = 1.2;
    fill.scale.y = 0.01;
    g.add(fill);
    h.fillMesh = fill;
    h.group = g;
    this._seat(h);
    this.group.add(g);
  }

  // ------------------------------------------------------------ material in / out
  /** Vehicles / player dump into a belt hopper. Returns accepted volume. */
  hopperAdd(h, vol, gold) {
    const room = h.capacity - h.vol;
    const acc = Math.max(0, Math.min(vol, room));
    if (acc <= 0) return 0;
    h.gold += gold * (acc / vol);
    h.vol += acc;
    this._updateHopperFill(h);
    return acc;
  }

  nearestHopper(x, z, maxD) {
    let best = null, bd = maxD;
    for (const h of this.hoppers) {
      const d = Math.hypot(h.x - x, h.z - z);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }

  _updateHopperFill(h) {
    const f = clamp(h.vol / h.capacity, 0, 1);
    h.fillMesh.scale.y = Math.max(0.01, f);
    h.fillMesh.position.y = 1.02 + 0.5 * f;
    h.fillMesh.visible = f > 0.01;
  }

  /** Try to put a lump on `belt` at parameter t. */
  _accept(belt, t, spacing) {
    for (const it of belt.items) if (Math.abs(it.t - t) < spacing) return false;
    return true;
  }

  // ------------------------------------------------------------ simulation
  update(dt) {
    const C = CONFIG.conveyor;
    const spacing = C.spacing;
    this.stripes.offset.y -= (C.speed / 2) * dt; // texture v spans 2 m per unit
    if (this.stripes.offset.y < -1000) this.stripes.offset.y += 1000;
    this._reseatTimer = (this._reseatTimer || 0) - dt;
    if (this._reseatTimer <= 0) { this._reseatTimer = 0.4; this.reseat(); }

    // hoppers drip lumps onto the belt in front of them
    for (const h of this.hoppers) {
      h.emitTimer -= dt;
      if (h.vol < C.lumpVol * 0.999 || h.emitTimer > 0) continue;
      const n = this.nextOf(h);
      const belt = this.at(n.gx, n.gz);
      if (!belt || belt.type !== 'belt') continue;
      if (!this._accept(belt, 0, spacing)) continue;
      const vol = C.lumpVol;
      const gold = h.gold * (vol / h.vol);
      h.vol -= vol; h.gold -= gold;
      if (h.vol < 1e-3) { h.vol = 0; h.gold = 0; }
      belt.items.push({ t: 0, vol, gold });
      h.emitTimer = 0.05;
      this._updateHopperFill(h);
    }

    // belts: advance lumps front-to-back; the front lump may hand off to the next belt or the plant
    for (const b of this.belts) {
      if (!b.items.length) continue;
      b.items.sort((p, q) => q.t - p.t);
      const len = PATH_LEN[b.curve + 1];
      const step = (C.speed / len) * dt;
      let limit = Infinity; // t the next lump may not exceed
      for (let i = 0; i < b.items.length; i++) {
        const it = b.items[i];
        let nt = Math.min(it.t + step, limit);
        if (nt >= 1) {
          const overflow = nt - 1;
          const tgt = this.target(b);
          let moved = false;
          if (tgt.kind === 'belt') {
            const nb = tgt.belt;
            // entering from behind → t=0; side-feeding a straight belt → merge at the middle
            const fromBehind = nb.dir === b.dir;
            const entry = fromBehind || nb.curve !== 0 ? 0 : 0.5;
            if (this._accept(nb, entry, spacing)) {
              b.items.splice(i, 1); i--;
              nb.items.push({ t: entry + Math.min(overflow, spacing * 0.5), vol: it.vol, gold: it.gold });
              moved = true;
              limit = Infinity;
            }
          } else if (tgt.kind === 'plant') {
            const wp = this.game.washPlant;
            if (!wp.damaged) {
              const acc = wp.addPaydirt(it.vol, it.gold);
              if (acc >= it.vol - 1e-4) {
                b.items.splice(i, 1); i--;
                moved = true;
                limit = Infinity;
                if (Math.random() < 0.5) this.game.particles.burst(wp.hopperPos.x, wp.hopperPos.y, wp.hopperPos.z, 3, 0x8a5a30, 1.2, 1.2, 0.6);
              } else if (acc > 0) { it.gold -= it.gold * (acc / it.vol); it.vol -= acc; }
            }
          }
          if (!moved) { it.t = 1; limit = 1 - spacing; }
        } else {
          it.t = nt;
          limit = nt - spacing;
        }
      }
    }

    this._renderLumps();
  }

  _renderLumps() {
    let n = 0;
    const max = this.lumpMesh.instanceMatrix.count;
    const p = this._v2, w = this._v3, m = this._m4, terrain = this.game.terrain;
    for (const b of this.belts) {
      const yaw = b.dir * Math.PI / 2, cy = Math.cos(yaw), sy = Math.sin(yaw);
      for (const it of b.items) {
        if (n >= max) break;
        beltPath(b.curve, it.t, p);
        w.set(b.x + p.x * cy + p.y * sy, 0, b.z - p.x * sy + p.y * cy);
        w.y = terrain.heightAt(w.x, w.z) + 0.42;
        const s = 0.8 + 0.5 * Math.sqrt(it.vol / CONFIG.conveyor.lumpVol);
        m.makeScale(s, s, s).setPosition(w);
        this.lumpMesh.setMatrixAt(n, m);
        const rich = it.vol > 0 ? it.gold / it.vol : 0;
        this._col.copy(this._brown).lerp(this._gold, clamp(rich / 1.5, 0, 1));
        this.lumpMesh.setColorAt(n, this._col);
        n++;
      }
    }
    this.lumpMesh.count = n;
    this.lumpMesh.instanceMatrix.needsUpdate = true;
    if (this.lumpMesh.instanceColor) this.lumpMesh.instanceColor.needsUpdate = true;
  }

  // ------------------------------------------------------------ build mode
  toggleBuild(on = !this.build.active) {
    this.build.active = on;
    this.ghost.visible = on;
    this.gridLines.visible = on;
    this.build.lastCell = null;
    this.build.dragging = false;
    if (!on) { this.game.buildings?.hideGhost(); return; }
    // start on something you can actually place: an unplaced building kit first, then belts, then hoppers
    const s = this.game.state, b = this.build;
    const have = (tool) => tool === 'belt' ? s.belts : tool === 'hopper' ? s.hoppers : (s.kits[tool] || 0);
    if (have(b.tool) <= 0) {
      const kit = Object.keys(CONFIG.buildings).find((t) => (s.kits[t] || 0) > 0);
      b.tool = kit || (s.belts > 0 ? 'belt' : s.hoppers > 0 ? 'hopper' : b.tool);
    }
  }

  /**
   * Carry something standing on a belt: pushes `pos` along the belt at belt speed and nudges it toward
   * the belt's centreline so it rides curves instead of drifting off the edge. Returns the belt or null.
   */
  carry(pos, dt) {
    const { gx, gz } = this.cellOf(pos.x, pos.z);
    const c = this.at(gx, gz);
    if (!c || c.type !== 'belt') return null;
    const [dx, dz] = DIRS[c.dir];
    const speed = CONFIG.conveyor.speed;
    pos.x += dx * speed * dt;
    pos.z += dz * speed * dt;
    // sideways offset from the centreline, pulled in gently
    const ox = pos.x - c.x, oz = pos.z - c.z;
    const side = ox * dz - oz * dx; // signed distance perpendicular to travel
    const k = Math.min(1, dt * 3);
    pos.x -= dz * side * k;
    pos.z += dx * side * k;
    return c;
  }

  /**
   * Per-frame build-mode handling. `aim` is the terrain point under the mouse (or null).
   * Returns a status string for the HUD.
   */
  buildUpdate(aim, input) {
    const b = this.build, s = this.game.state, ui = this.game.ui, bl = this.game.buildings;
    if (input.pressed('1')) b.tool = 'belt';
    if (input.pressed('2')) b.tool = 'hopper';
    if (input.pressed('3')) {
      if (s.owned.inn) b.tool = 'inn';
      else ui.toast('Buy the Inn on your phone (TAB) first', 'bad');
    }
    if (input.pressed('4')) {
      if (s.owned.barracks) b.tool = 'barracks';
      else ui.toast('Buy the Barracks on your phone (TAB) first', 'bad');
    }
    if (input.pressed('5')) {
      if (s.owned.church) b.tool = 'church';
      else ui.toast('Buy the Church on your phone (TAB) first', 'bad');
    }
    const isBuilding = !!CONFIG.buildings[b.tool];
    if (!aim) {
      if (input.pressed('r')) b.dir = (b.dir + 1) % 4;
      this.ghost.visible = false; this.gridLines.visible = false; bl.hideGhost();
      return 'Aim at the ground';
    }
    const { gx, gz } = this.cellOf(aim.x, aim.z);
    const c = this.centre(gx, gz);
    const y = this.game.terrain.heightAt(c.x, c.z);

    // grid overlay follows the cursor and drapes over the terrain
    this.gridLines.visible = true;
    const pa = this.gridLines.geometry.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      const lx = this._gridPos[i * 3], lz = this._gridPos[i * 3 + 2];
      pa.setXYZ(i, c.x + lx, this.game.terrain.heightAt(c.x + lx, c.z + lz) + 0.15, c.z + lz);
    }
    pa.needsUpdate = true;

    const existing = this.at(gx, gz);
    const existingName = existing ? (existing.type === 'belt' ? 'Belt here — R to rotate it, RMB to remove' : existing.type === 'hopper' ? 'Hopper here — RMB to remove' : `${CONFIG.buildings[existing.building.type].name} here — RMB to remove`) : '';
    const check = existing ? { ok: false, reason: existingName } : isBuilding ? bl.canPlace(b.tool, gx, gz) : this.canPlace(gx, gz, b.tool);
    const have = b.tool === 'belt' ? s.belts : b.tool === 'hopper' ? s.hoppers : (s.kits[b.tool] || 0);
    const ok = check.ok && have > 0;

    // remove whatever is under the cursor
    if (input.clicked(2) && existing) {
      if (existing.type === 'building') {
        bl.remove(existing.building);
        s.kits[existing.building.type] = (s.kits[existing.building.type] || 0) + 1;
        ui.toast(`${CONFIG.buildings[existing.building.type].name} packed up — place it again from build mode`);
      } else {
        const r = this.remove(gx, gz);
        if (r.type === 'belt') {
          s.belts++;
          const lost = r.items.reduce((a, it) => a + it.gold, 0);
          if (lost > 0.05) ui.toast(`Belt removed — ${lost.toFixed(2)} g of gold spilled`, 'bad');
        } else {
          s.hoppers++;
          if (r.gold > 0.05) ui.toast(`Hopper removed — ${r.gold.toFixed(2)} g of gold spilled`, 'bad');
        }
      }
      return existingName;
    }

    if (isBuilding) {
      this.ghost.visible = false;
      if (existing) bl.hideGhost(); else bl.showGhost(b.tool, gx, gz, b.dir, ok);
      if (input.pressed('r')) b.dir = (b.dir + 1) % 4;
      if (input.clicked(0) && !existing) {
        if (have <= 0) ui.toast(`You've already placed your ${CONFIG.buildings[b.tool].name}`, 'bad');
        else if (!check.ok) ui.toast(check.reason, 'bad');
        else { bl.place(b.tool, gx, gz, b.dir); s.kits[b.tool]--; ui.toast(`${CONFIG.buildings[b.tool].name} built!`, 'gold'); }
      }
      if (!existing && check.ok && have <= 0) return `Your ${CONFIG.buildings[b.tool].name} is already placed — RMB on it to move it`;
      return check.reason;
    }
    bl.hideGhost();

    this.ghost.visible = true;
    this.ghost.position.set(c.x, y, c.z);
    this._qYaw.setFromAxisAngle(this._up, b.dir * Math.PI / 2);
    this.game.terrain.normalAt(c.x, c.z, this._n);
    this._qTilt.setFromUnitVectors(this._up, this._n);
    this.ghost.quaternion.copy(this._qTilt).multiply(this._qYaw);
    this.ghostBase.visible = this.ghostArrow.visible = true;
    this.ghostHopper.visible = b.tool === 'hopper';
    // preview the shape the belt will take here (curves when a neighbour feeds it from the side)
    this.ghostRibbon.visible = b.tool === 'belt' && !existing;
    if (this.ghostRibbon.visible) this.ghostRibbon.geometry = this.ribbonGeos[this._curveFor(gx, gz, b.dir) + 1];
    const mat = ok ? GHOST_OK : GHOST_BAD;
    this.ghostBase.material = this.ghostArrow.material = this.ghostHopper.material = mat;
    this.ghostBeltMat.color.setHex(ok ? 0xbfffc6 : 0xffb0a6);

    // R: rotate the structure under the cursor, otherwise the ghost
    if (input.pressed('r')) {
      if (existing && existing.type !== 'building' && !input.mouseDown(0)) { b.dir = (existing.dir + 1) % 4; this.rotate(gx, gz, b.dir); }
      else b.dir = (b.dir + 1) % 4;
    }

    // place: click, or drag to lay a line of belts (direction follows the drag)
    const held = input.mouseDown(0);
    if (!held) { b.dragging = false; b.lastCell = null; }
    if (held && !existing) {
      const cellKey = key(gx, gz);
      if (!b.lastCell || b.lastCell.key !== cellKey) {
        let dir = b.dir;
        if (b.tool === 'belt' && b.lastCell && b.dragging) {
          const ddx = gx - b.lastCell.gx, ddz = gz - b.lastCell.gz;
          if (Math.abs(ddx) + Math.abs(ddz) === 1) {
            dir = DIRS.findIndex(([x, z]) => x === ddx && z === ddz);
            b.dir = dir;
            // the belt we came from turns to follow the drag
            const prev = this.at(b.lastCell.gx, b.lastCell.gz);
            if (prev && prev.type === 'belt' && prev.dir !== dir) this.rotate(prev.gx, prev.gz, dir);
          }
        }
        if (have <= 0) { if (input.clicked(0)) ui.toast(`No ${b.tool === 'belt' ? 'belts' : 'hoppers'} left — buy more on your phone (TAB)`, 'bad'); }
        else if (!check.ok) { if (input.clicked(0)) ui.toast(check.reason, 'bad'); }
        else {
          if (b.tool === 'belt') {
            const nb = this.placeBelt(gx, gz, dir);
            s.belts--;
            if (!b.dragging) this._connectDeadEnds(nb); // first belt of a click/drag: hook up to a neighbouring dead end
          } else if (input.clicked(0)) { this.placeHopper(gx, gz, dir); s.hoppers--; }
          b.dragging = b.tool === 'belt';
        }
        b.lastCell = { key: cellKey, gx, gz };
      }
    } else if (held && existing && b.tool === 'belt' && b.dragging) {
      // dragging across an existing belt re-points it along the drag
      const cellKey = key(gx, gz);
      if (b.lastCell && b.lastCell.key !== cellKey) {
        const ddx = gx - b.lastCell.gx, ddz = gz - b.lastCell.gz;
        if (Math.abs(ddx) + Math.abs(ddz) === 1) {
          const dir = DIRS.findIndex(([x, z]) => x === ddx && z === ddz);
          b.dir = dir;
          const prev = this.at(b.lastCell.gx, b.lastCell.gz);
          if (prev && prev.type === 'belt' && prev.dir !== dir) this.rotate(prev.gx, prev.gz, dir);
          if (existing.type === 'belt') this.rotate(gx, gz, dir);
        }
        b.lastCell = { key: cellKey, gx, gz };
      }
    }

    if (!existing && check.ok && have <= 0) return `No ${b.tool === 'belt' ? 'belts' : 'hoppers'} left — buy more on your phone`;
    return check.reason;
  }

  // ------------------------------------------------------------ persistence
  serialize() {
    return {
      belts: this.belts.map((b) => [b.gx, b.gz, b.dir, b.items.map((it) => [+it.t.toFixed(3), +it.vol.toFixed(3), +it.gold.toFixed(4)])]),
      hoppers: this.hoppers.map((h) => [h.gx, h.gz, h.dir, +h.vol.toFixed(3), +h.gold.toFixed(4)]),
    };
  }

  deserialize(d) {
    for (const c of [...this.belts, ...this.hoppers]) this.remove(c.gx, c.gz);
    if (!d) return;
    for (const [gx, gz, dir, items] of d.belts || []) {
      const b = this.placeBelt(gx, gz, dir, true);
      if (b && items) b.items = items.map(([t, vol, gold]) => ({ t, vol, gold }));
    }
    for (const [gx, gz, dir, vol, gold] of d.hoppers || []) {
      const h = this.placeHopper(gx, gz, dir, true);
      if (h) { h.vol = vol; h.gold = gold; this._updateHopperFill(h); }
    }
    this._renderLumps();
  }

  /** Belts re-seat on the terrain if the ground under them moves (dozer, dumps). */
  reseat() {
    for (const c of this.belts) this._seat(c);
    for (const c of this.hoppers) this._seat(c);
  }
}
