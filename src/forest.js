import * as THREE from 'three';
import { CONFIG } from './config.js';

const M4 = new THREE.Matrix4();
const M4b = new THREE.Matrix4();
const M4t = new THREE.Matrix4();
const V = new THREE.Vector3();
const S = new THREE.Vector3();
const Q = new THREE.Quaternion();
const AXIS = new THREE.Vector3();

/**
 * Tree chopping on top of the instanced trunk/canopy meshes built in world.js.
 * A tree takes CONFIG.treeHits swings, then topples away from the player and disappears,
 * leaving a stump and giving the player logs.
 */
export class Forest {
  constructor(game, forest, colliders) {
    this.game = game;
    this.trees = forest.trees;
    this.trunkMesh = forest.trunkMesh;
    this.blobMesh = forest.blobMesh;
    this.colliders = colliders;
    this.falling = [];
    this.wobbling = [];
    this.chopped = [];
    for (const t of this.trees) { t.hp = CONFIG.treeHits; t.alive = true; }
    // remember rest matrices so we can animate around them
    this.trunkRest = new Float32Array(this.trunkMesh.instanceMatrix.array);
    this.blobRest = new Float32Array(this.blobMesh.instanceMatrix.array);
    this.stumpGeo = new THREE.CylinderGeometry(0.22, 0.3, 0.45, 8);
    this.stumpMat = new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.95 });
  }

  /** Nearest standing tree whose trunk is within `maxD` of (x,z). */
  nearest(x, z, maxD) {
    let best = null, bd = maxD;
    for (const t of this.trees) {
      if (!t.alive) continue;
      const d = Math.hypot(t.x - x, t.z - z) - 0.45 * t.s;
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  /** One axe hit. Returns true if the tree fell. */
  chop(t, fromPos) {
    if (!t.alive) return false;
    t.hp--;
    const g = this.game;
    g.particles.burst(t.x, t.y + 1.0 * t.s, t.z, 8, 0xc9925a, 0.6, 2, 0.5);
    const dx = t.x - fromPos.x, dz = t.z - fromPos.z;
    const d = Math.hypot(dx, dz) || 1;
    if (t.hp <= 0) {
      t.alive = false;
      const ci = this.colliders.indexOf(t.collider);
      if (ci >= 0) this.colliders.splice(ci, 1);
      this.falling.push({ t, dir: { x: dx / d, z: dz / d }, time: 0 });
      this.chopped.push(t.index);
      return true;
    }
    this.wobbling.push({ t, dir: { x: dx / d, z: dz / d }, time: 0 });
    return false;
  }

  /** Apply a rotation about the trunk base to every instance of a tree. */
  _pose(t, angle, dir, scale = 1) {
    // rotation axis is perpendicular to fall direction, in the ground plane
    AXIS.set(dir.z, 0, -dir.x).normalize();
    Q.setFromAxisAngle(AXIS, angle);
    M4b.compose(V.set(t.x, t.y, t.z), Q, S.set(scale, scale, scale));
    M4t.makeTranslation(-t.x, -t.y, -t.z);
    // M = T(base) R S T(-base) Rest
    M4.fromArray(this.trunkRest, t.index * 16).premultiply(M4t).premultiply(M4b);
    this.trunkMesh.setMatrixAt(t.index, M4);
    for (let i = 0; i < t.blobCount; i++) {
      const k = t.blobStart + i;
      M4.fromArray(this.blobRest, k * 16).premultiply(M4t).premultiply(M4b);
      this.blobMesh.setMatrixAt(k, M4);
    }
  }

  _hide(t) {
    M4.makeScale(0, 0, 0);
    this.trunkMesh.setMatrixAt(t.index, M4);
    for (let i = 0; i < t.blobCount; i++) this.blobMesh.setMatrixAt(t.blobStart + i, M4);
  }

  _stump(t) {
    const s = new THREE.Mesh(this.stumpGeo, this.stumpMat);
    s.scale.setScalar(t.s);
    s.position.set(t.x, t.y + 0.2 * t.s, t.z);
    s.castShadow = true;
    this.game.scene.add(s);
  }

  /** Instantly remove a tree (used when loading a save). */
  removeSilently(index) {
    const t = this.trees[index];
    if (!t || !t.alive) return;
    t.alive = false;
    t.hp = 0;
    const ci = this.colliders.indexOf(t.collider);
    if (ci >= 0) this.colliders.splice(ci, 1);
    this._hide(t);
    this._stump(t);
    this.chopped.push(index);
    this.trunkMesh.instanceMatrix.needsUpdate = true;
    this.blobMesh.instanceMatrix.needsUpdate = true;
  }

  update(dt) {
    if (!this.falling.length && !this.wobbling.length) return;
    for (let i = this.wobbling.length - 1; i >= 0; i--) {
      const w = this.wobbling[i];
      w.time += dt;
      const k = Math.max(0, 1 - w.time / 0.45);
      const ang = Math.sin(w.time * 28) * 0.06 * k;
      if (w.t.alive) this._pose(w.t, ang, w.dir);
      if (k <= 0) { if (w.t.alive) this._pose(w.t, 0, w.dir); this.wobbling.splice(i, 1); }
    }
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      f.time += dt;
      const p = Math.min(1, f.time / 1.3);
      const ang = (Math.PI / 2 - 0.08) * p * p; // accelerating topple
      if (p < 1) this._pose(f.t, ang, f.dir);
      else {
        // fade out: shrink into the ground over 0.5 s
        const q = Math.min(1, (f.time - 1.3) / 0.5);
        this._pose(f.t, Math.PI / 2 - 0.08, f.dir, 1 - q);
        if (q >= 1) {
          this._hide(f.t);
          this._stump(f.t);
          const t = f.t;
          this.game.particles.burst(t.x + f.dir.x * 2 * t.s, t.y + 0.5, t.z + f.dir.z * 2 * t.s, 20, 0x6b8e3a, 2.5, 1.5, 0.9);
          this.falling.splice(i, 1);
        }
      }
    }
    this.trunkMesh.instanceMatrix.needsUpdate = true;
    this.blobMesh.instanceMatrix.needsUpdate = true;
  }

  serialize() { return this.chopped.slice(); }
  deserialize(list) { for (const i of list || []) this.removeSilently(i); }
}
