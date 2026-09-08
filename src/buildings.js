import * as THREE from 'three';
import { CONFIG } from './config.js';
import { G } from './conveyors.js';

/**
 * Grid-placed buildings. They share the conveyor grid so everything lines up: a building's footprint
 * cells are registered in the conveyor cell map (type 'building', dir −1) so belts can't run through
 * them, and each building gets a round collider for the player and vehicles.
 *
 * Types live in CONFIG.buildings. Currently: the Inn — sleep through the night, Minecraft-style.
 */

const WOOD = new THREE.MeshStandardMaterial({ color: 0x9a6b3f, roughness: 0.85 });
const WOOD_DARK = new THREE.MeshStandardMaterial({ color: 0x6b4426, roughness: 0.9 });
const ROOF = new THREE.MeshStandardMaterial({ color: 0x8a3b2b, roughness: 0.8 });
const STONE = new THREE.MeshStandardMaterial({ color: 0x8b8d90, roughness: 0.95 });
const DOOR = new THREE.MeshStandardMaterial({ color: 0x3d2614, roughness: 0.9 });
const GHOST_OK = new THREE.MeshBasicMaterial({ color: 0x7ee08a, transparent: true, opacity: 0.4, depthWrite: false });
const GHOST_BAD = new THREE.MeshBasicMaterial({ color: 0xff6b5a, transparent: true, opacity: 0.4, depthWrite: false });

function box(w, h, d, mat, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function signTexture(text) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#5a3a1e';
  ctx.fillRect(0, 0, 128, 64);
  ctx.strokeStyle = '#e6b422';
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, 120, 56);
  ctx.fillStyle = '#ffe9a8';
  ctx.font = 'bold 34px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 34);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

/** Log-cabin inn. Local +z is the front (door side). Footprint 3×3 cells = 6×6 m. */
function buildInn(b) {
  const g = new THREE.Group();
  box(6.0, 0.4, 6.0, STONE, 0, 0.2, 0, g);                      // foundation
  box(5.4, 3.0, 5.0, WOOD, 0, 1.9, -0.2, g);                     // walls
  for (let i = 0; i < 5; i++) {                                  // log lines on the front & sides
    box(5.5, 0.08, 0.06, WOOD_DARK, 0, 0.75 + i * 0.55, 2.31, g);
    box(0.06, 0.08, 5.1, WOOD_DARK, 2.71, 0.75 + i * 0.55, -0.2, g);
    box(0.06, 0.08, 5.1, WOOD_DARK, -2.71, 0.75 + i * 0.55, -0.2, g);
  }
  // attic: a triangular prism closing the gable ends, then two roof slabs meeting at a ridge along x
  const tri = new THREE.Shape();
  tri.moveTo(-2.5, 0); tri.lineTo(2.5, 0); tri.lineTo(0, 1.8); tri.closePath();
  const attic = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: 5.4, bevelEnabled: false }), WOOD);
  attic.rotation.y = -Math.PI / 2;           // extrude along world x
  attic.position.set(2.7, 3.38, -0.2);       // triangle spans z −2.7..2.3 with the apex at the ridge
  attic.castShadow = true;
  g.add(attic);
  const pitch = 0.62;
  const l = box(6.6, 0.22, 3.4, ROOF, 0, 4.35, -1.55, g); l.rotation.x = -pitch; // back slab: eave at −z
  const r = box(6.6, 0.22, 3.4, ROOF, 0, 4.35, 1.15, g); r.rotation.x = pitch;   // front slab: eave at +z
  box(6.7, 0.28, 0.5, WOOD_DARK, 0, 5.38, -0.2, g);              // ridge beam
  // porch
  box(3.4, 0.16, 1.6, WOOD_DARK, 0, 0.48, 3.0, g);
  box(3.6, 0.14, 1.9, ROOF, 0, 3.2, 3.0, g).rotation.x = 0.12;
  box(0.14, 2.6, 0.14, WOOD_DARK, -1.6, 1.85, 3.7, g);
  box(0.14, 2.6, 0.14, WOOD_DARK, 1.6, 1.85, 3.7, g);
  box(1.1, 2.0, 0.12, DOOR, 0, 1.45, 2.36, g);                   // door
  b.doorLocal = new THREE.Vector3(0, 0, 4.4);
  // windows (glow at night)
  b.windowMat = new THREE.MeshStandardMaterial({ color: 0x5b7f9e, emissive: 0xffb347, emissiveIntensity: 0, roughness: 0.3 });
  for (const x of [-1.75, 1.75]) box(0.9, 0.9, 0.1, b.windowMat, x, 1.9, 2.36, g);
  box(0.1, 0.9, 0.9, b.windowMat, 2.76, 1.9, -0.6, g);
  box(0.1, 0.9, 0.9, b.windowMat, -2.76, 1.9, -0.6, g);
  // chimney
  box(0.7, 2.0, 0.7, STONE, 1.8, 4.9, -1.4, g);
  b.chimneyLocal = new THREE.Vector3(1.8, 6.0, -1.4);
  // hanging sign
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.7), new THREE.MeshStandardMaterial({ map: signTexture('INN'), roughness: 0.8 }));
  sign.position.set(0, 2.75, 3.9);
  g.add(sign);
  const back = sign.clone(); back.rotation.y = Math.PI; back.position.z = 3.89; g.add(back);
  // lantern by the door
  b.lamp = new THREE.PointLight(0xffb347, 0, 12, 2);
  b.lamp.position.set(-0.9, 2.4, 2.7);
  g.add(b.lamp);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffd28a }));
  bulb.position.copy(b.lamp.position);
  g.add(bulb);
  return g;
}

const CANVAS = new THREE.MeshStandardMaterial({ color: 0x7a8a5a, roughness: 0.95 });
const CANVAS_DARK = new THREE.MeshStandardMaterial({ color: 0x5c6a43, roughness: 0.95 });
const IRON = new THREE.MeshStandardMaterial({ color: 0x555a60, roughness: 0.6, metalness: 0.5 });
const FLAG = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.9, side: THREE.DoubleSide });

/** Barracks: palisade yard with a canvas mess tent, an armoury shed, training dummy and a flagpole. Front is +z. */
function buildBarracks(b) {
  const g = new THREE.Group();
  box(6.0, 0.3, 6.0, STONE, 0, 0.15, 0, g);                      // packed-earth pad
  // palisade posts around three sides (front stays open)
  for (let i = -5; i <= 5; i++) {
    const x = i * 0.55;
    box(0.28, 1.6 + (i % 2 ? 0.15 : 0), 0.28, WOOD_DARK, x, 1.1, -2.85, g);
    if (Math.abs(i) <= 3) {
      box(0.28, 1.6, 0.28, WOOD_DARK, -2.85, 1.1, i * 0.55 - 1.0, g);
      box(0.28, 1.6, 0.28, WOOD_DARK, 2.85, 1.1, i * 0.55 - 1.0, g);
    }
  }
  // mess tent: triangular prism along x
  const tri = new THREE.Shape();
  tri.moveTo(-1.7, 0); tri.lineTo(1.7, 0); tri.lineTo(0, 2.3); tri.closePath();
  const tent = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: 3.6, bevelEnabled: false }), CANVAS);
  tent.rotation.y = -Math.PI / 2;
  tent.position.set(1.8, 0.3, -0.9);
  tent.castShadow = true; tent.receiveShadow = true;
  g.add(tent);
  box(3.8, 0.12, 0.12, WOOD_DARK, 0, 2.62, -0.9, g);              // ridge pole
  box(0.12, 2.4, 0.12, WOOD_DARK, -1.75, 1.5, -0.9, g);
  box(0.12, 2.4, 0.12, WOOD_DARK, 1.75, 1.5, -0.9, g);
  box(1.0, 1.6, 0.06, CANVAS_DARK, 0, 1.0, 0.83, g);              // tent flap
  // armoury shed with weapons rack
  box(1.6, 1.5, 1.4, WOOD, -2.0, 1.05, 1.7, g);
  box(1.9, 0.12, 1.7, ROOF, -2.0, 1.86, 1.7, g).rotation.x = 0.18;
  for (let i = 0; i < 3; i++) {
    const s = box(0.08, 0.9, 0.04, IRON, -1.45 + i * 0.28, 1.1, 2.45, g);
    s.rotation.z = (i - 1) * 0.12;
    box(0.3, 0.06, 0.06, WOOD_DARK, -1.45 + i * 0.28, 0.75, 2.45, g);
  }
  // training dummy
  box(0.14, 1.7, 0.14, WOOD_DARK, 1.9, 1.15, 1.6, g);
  box(1.1, 0.12, 0.12, WOOD_DARK, 1.9, 1.5, 1.6, g);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), CANVAS_DARK);
  head.position.set(1.9, 2.15, 1.6); head.castShadow = true; g.add(head);
  box(0.6, 0.7, 0.4, CANVAS_DARK, 1.9, 1.15, 1.6, g);
  // flagpole
  box(0.1, 4.6, 0.1, WOOD_DARK, 2.5, 2.4, -2.4, g);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.8, 6, 1), FLAG);
  flag.position.set(1.8, 4.3, -2.4);
  g.add(flag);
  b.flag = flag;
  // brazier (the mercs' night fire)
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.3, 0.4, 10), IRON);
  bowl.position.set(0, 0.7, 2.0); bowl.castShadow = true; g.add(bowl);
  box(0.08, 0.6, 0.08, IRON, 0, 0.3, 2.0, g);
  b.lamp = new THREE.PointLight(0xff8c3a, 0, 14, 2);
  b.lamp.position.set(0, 1.4, 2.0);
  g.add(b.lamp);
  b.fireLocal = new THREE.Vector3(0, 0.95, 2.0);
  b.doorLocal = new THREE.Vector3(0, 0, 4.2);
  // sign
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.7), new THREE.MeshStandardMaterial({ map: signTexture('MERCS'), roughness: 0.8 }));
  sign.position.set(0, 2.2, 3.1);
  g.add(sign);
  box(0.1, 2.2, 0.1, WOOD_DARK, -0.9, 1.1, 3.1, g);
  box(0.1, 2.2, 0.1, WOOD_DARK, 0.9, 1.1, 3.1, g);
  return g;
}

const BUILDERS = { inn: buildInn, barracks: buildBarracks };

export class Buildings {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.smokeTimer = 0;
    this._v = new THREE.Vector3();

    // ghost footprint used by build mode
    this.ghost = new THREE.Group();
    this.ghost.visible = false;
    this.ghostBox = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), GHOST_OK);
    this.ghostArrow = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.0, 8), GHOST_OK);
    this.ghostArrow.rotation.x = Math.PI / 2;
    this.ghost.add(this.ghostBox, this.ghostArrow);
    game.scene.add(this.ghost);
  }

  def(type) { return CONFIG.buildings[type]; }

  /** Footprint cells for a building of `size` cells centred on (gx,gz). Size is odd. */
  cellsFor(gx, gz, size) {
    const out = [], h = (size - 1) / 2;
    for (let j = -h; j <= h; j++) for (let i = -h; i <= h; i++) out.push([gx + i, gz + j]);
    return out;
  }

  canPlace(type, gx, gz) {
    const d = this.def(type), cv = this.game.conveyors;
    let hi = -Infinity, lo = Infinity;
    for (const [i, j] of this.cellsFor(gx, gz, d.size)) {
      const r = cv.canPlace(i, j, 'building');
      if (!r.ok) return r;
      const c = cv.centre(i, j);
      const y = this.game.terrain.heightAt(c.x, c.z);
      hi = Math.max(hi, y); lo = Math.min(lo, y);
    }
    if (hi - lo > d.maxRise) return { ok: false, reason: 'Ground too uneven — flatten it with the dozer' };
    return { ok: true, reason: '' };
  }

  place(type, gx, gz, dir, silent = false) {
    const d = this.def(type), cv = this.game.conveyors;
    const c = cv.centre(gx, gz);
    const b = { type, gx, gz, dir, x: c.x, z: c.z, y: 0, size: d.size, group: null, cells: [], collider: null };
    // sit on the average ground height so a slightly uneven pad doesn't float a corner
    let sum = 0;
    for (const [i, j] of this.cellsFor(gx, gz, d.size)) { const cc = cv.centre(i, j); sum += this.game.terrain.heightAt(cc.x, cc.z); }
    b.y = sum / (d.size * d.size);
    b.group = BUILDERS[type](b);
    b.group.position.set(c.x, b.y, c.z);
    b.group.rotation.y = dir * Math.PI / 2;
    this.group.add(b.group);
    b.group.updateMatrixWorld(true);
    b.door = b.doorLocal ? b.group.localToWorld(b.doorLocal.clone()) : new THREE.Vector3(c.x, b.y, c.z);
    b.collider = { x: c.x, z: c.z, r: d.size * G * 0.5 - 0.2, building: true };
    this.game.colliders.push(b.collider);
    for (const [i, j] of this.cellsFor(gx, gz, d.size)) {
      const cell = { type: 'building', building: b, gx: i, gz: j, dir: -1 };
      cv.cells.set(`${i},${j}`, cell);
      b.cells.push(cell);
      const cc = cv.centre(i, j);
      cv._protect(cc.x, cc.z, 1);
    }
    for (const [i, j] of this.cellsFor(gx, gz, d.size)) cv._refreshAround(i, j);
    this.list.push(b);
    if (!silent) this.game.particles.burst(c.x, b.y + 2, c.z, 30, 0xe6b422, 3, 2.5, 0.8);
    return b;
  }

  remove(b) {
    const cv = this.game.conveyors;
    this.list.splice(this.list.indexOf(b), 1);
    this.group.remove(b.group);
    const ci = this.game.colliders.indexOf(b.collider);
    if (ci >= 0) this.game.colliders.splice(ci, 1);
    for (const cell of b.cells) {
      cv.cells.delete(`${cell.gx},${cell.gz}`);
      const cc = cv.centre(cell.gx, cell.gz);
      cv._protect(cc.x, cc.z, -1);
    }
    for (const cell of b.cells) cv._refreshAround(cell.gx, cell.gz);
  }

  first(type) { return this.list.find((b) => b.type === type) || null; }

  nearest(x, z, maxD, type = null) {
    let best = null, bd = maxD;
    for (const b of this.list) {
      if (type && b.type !== type) continue;
      const d = Math.hypot(b.door.x - x, b.door.z - z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  /** Ghost for build mode. */
  showGhost(type, gx, gz, dir, ok) {
    const d = this.def(type), cv = this.game.conveyors, c = cv.centre(gx, gz);
    const w = d.size * G - 0.2;
    this.ghost.visible = true;
    this.ghost.position.set(c.x, this.game.terrain.heightAt(c.x, c.z), c.z);
    this.ghost.rotation.y = dir * Math.PI / 2;
    this.ghostBox.scale.set(w, d.ghostHeight, w);
    this.ghostBox.position.y = d.ghostHeight / 2;
    this.ghostArrow.position.set(0, 0.6, w / 2 + 0.7);
    this.ghostBox.material = this.ghostArrow.material = ok ? GHOST_OK : GHOST_BAD;
  }
  hideGhost() { this.ghost.visible = false; }

  update(dt, night) {
    // windows and lanterns glow after dark; chimney smokes
    this.time = (this.time || 0) + dt;
    for (const b of this.list) {
      if (b.windowMat) b.windowMat.emissiveIntensity = 1.4 * night;
      if (b.lamp) b.lamp.intensity = (b.fireLocal ? 14 * (0.85 + 0.15 * Math.sin(this.time * 9)) : 18) * night;
      if (b.flag) b.flag.rotation.y = Math.sin(this.time * 2.3) * 0.25;
    }
    this.smokeTimer -= dt;
    if (this.smokeTimer <= 0) {
      this.smokeTimer = 0.35;
      for (const b of this.list) {
        if (b.chimneyLocal) {
          const p = this._v.copy(b.chimneyLocal).applyMatrix4(b.group.matrixWorld);
          this.game.particles.burst(p.x, p.y, p.z, 1, 0xb9b9b9, 0.3, 0.8, 2.4, -0.4); // drifts upward
        }
        if (b.fireLocal && night > 0.3) {
          const p = this._v.copy(b.fireLocal).applyMatrix4(b.group.matrixWorld);
          this.game.particles.burst(p.x, p.y, p.z, 2, 0xff9a3c, 0.4, 1.2, 0.6, -1.5);
        }
      }
    }
  }

  serialize() { return this.list.map((b) => [b.type, b.gx, b.gz, b.dir]); }
  deserialize(d) {
    for (const b of [...this.list]) this.remove(b);
    for (const [type, gx, gz, dir] of d || []) if (BUILDERS[type]) this.place(type, gx, gz, dir, true);
  }
}
