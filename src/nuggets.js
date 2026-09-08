import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp } from './terrain.js';

const GOLD_MAT = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xe0a000, emissiveIntensity: 0.8, metalness: 0.85, roughness: 0.3 });

function makeHaloTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const grd = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,240,170,0.95)');
  grd.addColorStop(0.35, 'rgba(255,210,63,0.45)');
  grd.addColorStop(1, 'rgba(255,210,63,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}
const HALO_MAT = new THREE.SpriteMaterial({ map: makeHaloTexture(), color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });

function nuggetGeometry(seed) {
  // lumpy blob: a low-poly sphere with jittered vertices
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < p.count; i++) {
    const k = 0.72 + rnd() * 0.5;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * (0.6 + rnd() * 0.4), p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}
const GEOS = [0, 1, 2, 3, 4].map((i) => nuggetGeometry(1234 + i * 77));

/**
 * Physical gold nuggets that pop out of rich ground near bedrock. They sit on the terrain until
 * the player walks over them (or a vehicle drives over them) and go straight into gold on hand.
 */
export class Nuggets {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.sparkleTimer = 0;
  }

  /**
   * Roll for a nugget after a dig. `res` is the terrain.dig() result.
   * Nuggets live in the pay layer: only rich digs, and mostly ones that touch bedrock.
   */
  roll(x, z, res) {
    if (res.volume < 0.005 || res.richness < CONFIG.nuggets.minRichness) return null;
    const c = CONFIG.nuggets;
    const rich = clamp(res.richness, 0, 2.5);
    let p = c.baseChance * rich * Math.sqrt(res.volume);
    if (res.hitBedrock) p = c.bedrockBonus + p * 1.5;
    if (Math.random() > p) return null;
    // log-normal size, skewed by richness: most are small, a few are monsters
    const n = (Math.random() + Math.random() + Math.random() - 1.5) * 1.3; // approx normal
    let grams = 0.25 + Math.exp(n) * 0.8 * (0.5 + rich * 0.6);
    grams = Math.min(c.maxGrams, grams);
    const ang = Math.random() * Math.PI * 2, d = 0.6 + Math.random() * 0.9;
    return this.spawn(x + Math.cos(ang) * d, z + Math.sin(ang) * d, grams, true);
  }

  spawn(x, z, grams, fresh = false) {
    const t = this.game.terrain;
    if (!t.inBounds(x, z, 2)) return null;
    const m = new THREE.Mesh(GEOS[Math.floor(Math.random() * GEOS.length)], GOLD_MAT);
    const r = 0.2 + 0.1 * Math.sqrt(grams);
    m.scale.setScalar(r);
    m.rotation.set(Math.random() * 0.6, Math.random() * Math.PI * 2, Math.random() * 0.6);
    m.castShadow = true;
    // soft glow so nuggets read from the top-down camera (and through shallow water)
    const halo = new THREE.Sprite(HALO_MAT);
    halo.scale.setScalar(1.6 + 0.6 * Math.sqrt(grams));
    halo.position.y = 0.3;
    m.add(halo);
    halo.scale.divideScalar(r); // undo parent scale so the halo size is in world units
    const n = { x, z, grams, mesh: m, halo, haloBase: halo.scale.x, r, phase: Math.random() * 6.28, age: fresh ? 0 : 5, popV: fresh ? 3.2 : 0, popY: 0 };
    m.position.set(x, t.heightAt(x, z) + r * 0.7, z);
    this.group.add(m);
    this.list.push(n);
    if (fresh) this.game.particles.burst(x, m.position.y + 0.2, z, 14, 0xffd23f, 0.6, 3.2, 1.1);
    return n;
  }

  remove(n) {
    this.group.remove(n.mesh);
    const i = this.list.indexOf(n);
    if (i >= 0) this.list.splice(i, 1);
  }

  collect(n, by) {
    const g = this.game, s = g.state;
    s.gold += n.grams;
    s.goldMined += n.grams;
    s.nuggetsFound = (s.nuggetsFound || 0) + 1;
    if (n.grams > (s.biggestNugget || 0)) s.biggestNugget = n.grams;
    g.particles.burst(n.x, n.mesh.position.y + 0.3, n.z, 22, 0xffd23f, 0.8, 3.5, 1.2);
    g.ui.nuggetPop(n.grams, by);
    this.remove(n);
  }

  update(dt) {
    const g = this.game, t = g.terrain, p = g.player.pos;
    this.sparkleTimer -= dt;
    const doSparkle = this.sparkleTimer <= 0;
    if (doSparkle) this.sparkleTimer = 0.35;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const n = this.list[i];
      n.age += dt;
      // fresh nuggets hop out of the dirt
      if (n.popV > 0 || n.popY > 0) {
        n.popV -= 12 * dt;
        n.popY = Math.max(0, n.popY + n.popV * dt);
        if (n.popY === 0) n.popV = 0;
      }
      const ground = t.heightAt(n.x, n.z);
      n.mesh.position.y = ground + n.r * 0.7 + n.popY;
      n.mesh.rotation.y += dt * 0.6;
      n.phase += dt * 2.2;
      n.halo.scale.setScalar(n.haloBase * (0.8 + 0.2 * Math.sin(n.phase)));
      if (n.age > 5 && n.popY === 0) {
        // buried by a dump? sink out of sight and vanish
        if (ground > n.mesh.position.y + 0.6) { this.remove(n); continue; }
      }
      if (doSparkle && Math.random() < 0.5) g.particles.burst(n.x, n.mesh.position.y + 0.15, n.z, 1, 0xfff3b0, 0.4, 1.2, 0.6);

      // pickup: on foot within reach, or any vehicle rolling over it
      if (n.age < 0.35) continue;
      if (!g.state.inVehicle && !g.state.ko && Math.hypot(p.x - n.x, p.z - n.z) < 1.4) { this.collect(n, 'you'); continue; }
      const v = g.state.inVehicle;
      if (v && Math.hypot(v.pos.x - n.x, v.pos.z - n.z) < v.radius * 0.8) { this.collect(n, v.name); continue; }
    }
  }

  serialize() { return this.list.map((n) => [+n.x.toFixed(2), +n.z.toFixed(2), +n.grams.toFixed(2)]); }
  deserialize(arr) {
    for (const n of [...this.list]) this.remove(n);
    if (Array.isArray(arr)) for (const [x, z, grams] of arr) this.spawn(x, z, grams, false);
  }
}
