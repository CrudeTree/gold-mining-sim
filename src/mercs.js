import * as THREE from 'three';
import { CONFIG } from './config.js';
import { WATER_LEVEL } from './terrain.js';

/**
 * Mercenaries: hired swordsmen who live at the Barracks. By day they loiter around the yard; when a
 * skeleton comes within earshot they run it down and fight. They can be killed. While you sleep at
 * the Inn they are the units on your side of the night battle (see battle.js).
 */

const UP = new THREE.Vector3(0, 1, 0);
const G = {
  leg: new THREE.BoxGeometry(0.16, 0.5, 0.16),
  boot: new THREE.BoxGeometry(0.18, 0.12, 0.24),
  torso: new THREE.BoxGeometry(0.5, 0.6, 0.3),
  belt: new THREE.BoxGeometry(0.52, 0.08, 0.32),
  head: new THREE.SphereGeometry(0.2, 12, 10),
  helm: new THREE.CylinderGeometry(0.23, 0.24, 0.18, 12),
  helmTop: new THREE.SphereGeometry(0.23, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  plume: new THREE.BoxGeometry(0.06, 0.16, 0.3),
  arm: new THREE.BoxGeometry(0.13, 0.5, 0.13),
  hand: new THREE.SphereGeometry(0.08, 8, 6),
  blade: new THREE.BoxGeometry(0.07, 0.8, 0.03),
  hilt: new THREE.BoxGeometry(0.24, 0.05, 0.06),
  shield: new THREE.CylinderGeometry(0.3, 0.3, 0.05, 14),
  hpBg: new THREE.PlaneGeometry(0.8, 0.09),
  hpFg: new THREE.PlaneGeometry(0.8, 0.09),
  ring: new THREE.RingGeometry(0.55, 0.68, 28),
};
const RING_MAT = new THREE.MeshBasicMaterial({ color: 0x9cf0a8, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
const M = {
  skin: new THREE.MeshStandardMaterial({ color: 0xe2b58c, roughness: 0.8 }),
  tunic: new THREE.MeshStandardMaterial({ color: 0x3f6fb5, roughness: 0.85 }),
  leather: new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 0.9 }),
  pants: new THREE.MeshStandardMaterial({ color: 0x4a4a55, roughness: 0.9 }),
  steel: new THREE.MeshStandardMaterial({ color: 0xb8c0c8, metalness: 0.6, roughness: 0.35 }),
  plume: new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.9 }),
  shield: new THREE.MeshStandardMaterial({ color: 0x8a2f24, roughness: 0.7 }),
  hpBg: new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.8, depthTest: false }),
  hpFg: new THREE.MeshBasicMaterial({ color: 0x4caf50, depthTest: false }),
};

function mesh(geo, mat, x = 0, y = 0, z = 0, parent) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  if (parent) parent.add(m);
  return m;
}

export class Merc {
  constructor(mgr, x, z) {
    this.mgr = mgr;
    this.game = mgr.game;
    const cfg = CONFIG.mercs;
    this.cfg = cfg;
    this.hp = cfg.hp;
    this.maxHp = cfg.hp;
    this.pos = new THREE.Vector3(x, 0, z);
    this.vel = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.alive = true;
    this.radius = cfg.radius;
    this.attackTimer = 0.5;
    this.attackAnim = 0;
    this.flash = 0;
    this.cycle = Math.random() * 6;
    this.target = null;
    this.wanderTo = null;
    this.wanderTimer = Math.random() * 3;
    this.thinkTimer = Math.random() * 0.3;
    this.selected = false;
    this.stuck = 0;        // seconds spent making no progress toward a goal
    this.sideSign = 1;     // which way to sidestep around an obstacle
    /** Standing order from the player: null (guard the barracks) or
     *  { type: 'move'|'hold'|'patrol'|'attack', x, z, x2, z2, leg, enemy } */
    this.order = null;

    const g = new THREE.Group();
    this.group = g;
    this.ring = new THREE.Mesh(G.ring, RING_MAT);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.06;
    this.ring.visible = false;
    this.ring.renderOrder = 5;
    g.add(this.ring);
    this.bodyMat = M.tunic.clone();
    this.legL = new THREE.Group(); this.legL.position.set(-0.14, 0.55, 0);
    this.legR = new THREE.Group(); this.legR.position.set(0.14, 0.55, 0);
    for (const l of [this.legL, this.legR]) {
      mesh(G.leg, M.pants, 0, -0.25, 0, l);
      mesh(G.boot, M.leather, 0, -0.5, 0.03, l);
    }
    g.add(this.legL, this.legR);
    mesh(G.torso, this.bodyMat, 0, 0.9, 0, g);
    mesh(G.belt, M.leather, 0, 0.62, 0, g);
    mesh(G.head, M.skin, 0, 1.42, 0, g);
    mesh(G.helm, M.steel, 0, 1.5, 0, g);
    mesh(G.helmTop, M.steel, 0, 1.58, 0, g);
    mesh(G.plume, M.plume, 0, 1.82, -0.02, g);
    this.armL = new THREE.Group(); this.armL.position.set(-0.34, 1.15, 0);
    this.armR = new THREE.Group(); this.armR.position.set(0.34, 1.15, 0);
    for (const a of [this.armL, this.armR]) {
      mesh(G.arm, this.bodyMat, 0, -0.22, 0, a);
      mesh(G.hand, M.skin, 0, -0.5, 0, a);
    }
    g.add(this.armL, this.armR);
    const blade = mesh(G.blade, M.steel, 0, -0.92, 0.08, this.armR); blade.rotation.x = 0.3;
    mesh(G.hilt, M.leather, 0, -0.55, 0.08, this.armR).rotation.x = 0.3;
    const shield = mesh(G.shield, M.shield, -0.1, -0.35, 0.05, this.armL);
    shield.rotation.z = Math.PI / 2;
    this.armL.rotation.x = -0.4;

    this.hpBar = new THREE.Group();
    this.hpBar.position.y = 2.05;
    this.hpBar.add(new THREE.Mesh(G.hpBg, M.hpBg));
    this.hpFg = new THREE.Mesh(G.hpFg, M.hpFg);
    this.hpFg.position.z = 0.01;
    this.hpBar.add(this.hpFg);
    this.hpBar.visible = false;
    this.hpBar.renderOrder = 20;
    g.add(this.hpBar);

    this.game.scene.add(g);
    this.place();
  }

  turnToward(want, k) {
    let dy = want - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * Math.min(1, k);
  }

  place() {
    this.pos.y = this.game.terrain.heightAt(this.pos.x, this.pos.z);
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
  }

  /** The spot this merc is anchored to: its order location, or the barracks. */
  anchor() {
    const o = this.order;
    if (o && o.type !== 'attack') return o.type === 'patrol' && o.leg === 1 ? { x: o.x2, z: o.z2 } : { x: o.x, z: o.z };
    return this.mgr.home;
  }

  think() {
    const g = this.game, cfg = this.cfg, o = this.order;
    // an attack order locks onto its enemy
    if (o && o.type === 'attack') {
      if (o.enemy && o.enemy.alive) { this.target = o.enemy; return; }
      this.order = { type: 'hold', x: this.pos.x, z: this.pos.z };
    }
    // otherwise: nearest living skeleton near me or near my post. Guarding the barracks looks
    // far and wide; on orders they're "defensive" — they only break off for enemies close by.
    const post = this.anchor();
    const onOrders = !!this.order;
    const alertMe = onOrders ? (this.order.type === 'patrol' ? 12 : 9) : 14;
    const alertPost = onOrders ? 6 : cfg.alert;
    const leash = onOrders ? 18 : cfg.leash;
    let best = null, bd = Infinity;
    for (const e of g.enemies.list) {
      if (!e.alive) continue;
      const dMe = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
      const dPost = Math.hypot(e.pos.x - post.x, e.pos.z - post.z);
      if (dPost > leash) continue;
      if (dMe > alertMe && dPost > alertPost) continue;
      if (dMe < bd) { bd = dMe; best = e; }
    }
    this.target = best;
  }

  /** Player command. Each merc gets its own spot (formation offset applied by the caller). */
  command(order) {
    this.order = order;
    this.wanderTo = null;
    this.target = null;
    this.thinkTimer = 0;
    this.stuck = 0;
  }

  update(dt, camera, night) {
    if (!this.alive) return;
    const g = this.game, cfg = this.cfg, t = g.terrain, home = this.mgr.home;
    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0 || (this.target && !this.target.alive)) { this.think(); this.thinkTimer = 0.35; }

    let mx = 0, mz = 0, speed = cfg.speed, facing = null, goal = null;
    if (this.target) {
      const dx = this.target.pos.x - this.pos.x, dz = this.target.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      const reach = cfg.range + this.target.radius;
      if (d > reach) { mx = dx / d; mz = dz / d; goal = this.target.pos; }
      facing = Math.atan2(dx, dz);
      this.attackTimer -= dt;
      if (d <= reach + 0.3 && this.attackTimer <= 0) {
        this.attackTimer = cfg.attackInterval;
        this.attackAnim = 1;
        this.target.damage(cfg.dmg * (1 + 0.3 * (g.state.upgrades.mercTraining || 0)), this.pos, 3);
        if (!this.target.alive) g.state.mercKills = (g.state.mercKills || 0) + 1;
      }
    } else if (this.order) {
      // follow orders
      const o = this.order;
      const dest = o.type === 'patrol' && o.leg === 1 ? { x: o.x2, z: o.z2 } : { x: o.x, z: o.z };
      const dx = dest.x - this.pos.x, dz = dest.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      const arrive = o.type === 'hold' ? 0.35 : 0.6;
      if (this.stuck > 3.5 && d > arrive) {
        // boxed in by rocks, machines or the palisade: settle for where we are / turn around
        this.stuck = 0;
        if (o.type === 'patrol') o.leg = o.leg === 1 ? 0 : 1;
        else this.order = { type: 'hold', x: this.pos.x, z: this.pos.z, facing: Math.atan2(dx, dz) };
      } else if (d > arrive) {
        mx = dx / d; mz = dz / d; facing = Math.atan2(dx, dz); goal = dest;
        if (o.type === 'hold') speed = cfg.speed * 0.7;
      } else if (o.type === 'move') {
        this.order = { type: 'hold', x: o.x, z: o.z, facing: o.facing };
      } else if (o.type === 'patrol') {
        o.leg = o.leg === 1 ? 0 : 1;
      }
      if (d <= arrive && o.facing != null) facing = o.facing;
      this.attackTimer = Math.min(this.attackTimer, 0.4);
      const dHome = Math.hypot(this.pos.x - home.x, this.pos.z - home.z);
      if (night < 0.3 && this.hp < this.maxHp && dHome < cfg.wander + 2) this.hp = Math.min(this.maxHp, this.hp + cfg.healRate * dt);
    } else {
      // stroll around the yard; at night stand a little closer to the fire
      this.wanderTimer -= dt;
      const dHome = Math.hypot(this.pos.x - home.x, this.pos.z - home.z);
      if (!this.wanderTo && (this.wanderTimer <= 0 || dHome > cfg.wander + 3)) {
        const r = (night > 0.5 ? 0.55 : 1) * cfg.wander * (0.3 + Math.random() * 0.7);
        const a = Math.random() * Math.PI * 2;
        const wx = home.x + Math.cos(a) * r, wz = home.z + Math.sin(a) * r;
        if (t.inBounds(wx, wz, 4) && t.heightAt(wx, wz) > WATER_LEVEL + 0.2) this.wanderTo = { x: wx, z: wz };
        this.wanderTimer = 2 + Math.random() * 5;
      }
      if (this.wanderTo) {
        const dx = this.wanderTo.x - this.pos.x, dz = this.wanderTo.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.5 || this.stuck > 2) { this.wanderTo = null; this.stuck = 0; }
        else { mx = dx / d; mz = dz / d; speed = cfg.speed * 0.45; facing = Math.atan2(dx, dz); goal = this.wanderTo; }
      }
      this.attackTimer = Math.min(this.attackTimer, 0.4);
      // patch up at home by day
      if (night < 0.3 && this.hp < this.maxHp && dHome < cfg.wander + 2) this.hp = Math.min(this.maxHp, this.hp + cfg.healRate * dt);
    }

    this.vel.multiplyScalar(Math.max(0, 1 - dt * 6));
    let moving = 0;
    const before = goal ? Math.hypot(goal.x - this.pos.x, goal.z - this.pos.z) : 0;
    if (mx !== 0 || mz !== 0) {
      if (this.stuck > 0.4) {
        // blocked: blend in a sidestep so we slide around whatever is in the way
        const k = Math.min(1, (this.stuck - 0.4) * 1.2) * this.sideSign;
        const nx = mx - mz * k, nz = mz + mx * k, n = Math.hypot(nx, nz) || 1;
        mx = nx / n; mz = nz / n;
      }
      let sx = this.pos.x + (mx * speed + this.vel.x) * dt;
      let sz = this.pos.z + (mz * speed + this.vel.z) * dt;
      if (t.heightAt(sx, sz) < WATER_LEVEL - 0.5) { sx = this.pos.x + (-mz * speed) * dt; sz = this.pos.z + (mx * speed) * dt; }
      if (t.inBounds(sx, sz, 3)) { this.pos.x = sx; this.pos.z = sz; }
      moving = 1;
    } else {
      this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    }
    if (facing != null) this.turnToward(facing, dt * 10);
    // keep apart from other mercs and skeletons
    for (const o of this.mgr.list) {
      if (o === this || !o.alive) continue;
      const ox = this.pos.x - o.pos.x, oz = this.pos.z - o.pos.z;
      const od = Math.hypot(ox, oz), min = this.radius + o.radius + 0.15;
      if (od < min && od > 1e-4) { this.pos.x += (ox / od) * (min - od) * 0.5; this.pos.z += (oz / od) * (min - od) * 0.5; }
    }
    for (const o of g.enemies.list) {
      if (!o.alive) continue;
      const ox = this.pos.x - o.pos.x, oz = this.pos.z - o.pos.z;
      const od = Math.hypot(ox, oz), min = this.radius + o.radius + 0.1;
      if (od < min && od > 1e-4) { this.pos.x += (ox / od) * (min - od) * 0.5; this.pos.z += (oz / od) * (min - od) * 0.5; }
    }
    g.resolveCollisions(this.pos, this.radius);

    // progress check: no headway toward the goal for a while → sidestep, then give up
    if (goal && moving) {
      const after = Math.hypot(goal.x - this.pos.x, goal.z - this.pos.z);
      if (before - after < speed * dt * 0.25) {
        this.stuck += dt;
        if (this.stuck > 2 && this.stuck - dt <= 2) this.sideSign = -this.sideSign; // try the other way round
      } else this.stuck = Math.max(0, this.stuck - dt * 3);
    } else this.stuck = 0;

    // animation
    if (moving) this.cycle += dt * (speed > cfg.speed * 0.6 ? 10 : 6);
    const sw = moving ? Math.sin(this.cycle) * (speed > cfg.speed * 0.6 ? 0.8 : 0.45) : 0;
    this.legL.rotation.x = sw;
    this.legR.rotation.x = -sw;
    this.attackAnim = Math.max(0, this.attackAnim - dt * 3.2);
    const a = this.attackAnim;
    this.armR.rotation.x = a > 0 ? -2.4 + (1 - a) * 2.1 : (this.target ? -0.9 : -0.2 + sw * 0.5);
    this.armL.rotation.x = this.target ? -1.0 : -0.4 - sw * 0.4;
    if (this.flash > 0) {
      this.flash -= dt;
      this.bodyMat.emissive.setScalar(this.flash > 0 ? 0.7 : 0);
    }
    this.ring.visible = this.selected;
    this.hpBar.visible = this.selected || this.hp < this.maxHp - 0.5;
    if (this.hpBar.visible) {
      this.hpBar.quaternion.copy(camera.quaternion);
      const f = this.hp / this.maxHp;
      this.hpFg.scale.x = f;
      this.hpFg.position.x = -(1 - f) * 0.4;
    }
    this.place();
  }

  damage(amount, fromPos, knock = 3) {
    if (!this.alive) return false;
    this.hp -= amount;
    this.flash = 0.12;
    this.bodyMat.emissive.setScalar(0.7);
    if (fromPos) {
      const dx = this.pos.x - fromPos.x, dz = this.pos.z - fromPos.z;
      const d = Math.hypot(dx, dz) || 1;
      this.vel.x += (dx / d) * knock;
      this.vel.z += (dz / d) * knock;
    }
    if (this.hp <= 0) { this.die(true); return true; }
    return false;
  }

  die(notify, count = true) {
    if (!this.alive) return;
    this.alive = false;
    const g = this.game;
    if (count) {
      g.particles.burst(this.pos.x, this.pos.y + 0.9, this.pos.z, 22, 0x3f6fb5, 1.2, 3, 1.0);
      g.particles.burst(this.pos.x, this.pos.y + 0.9, this.pos.z, 10, 0xb8c0c8, 1.0, 2.5, 0.9);
      g.state.mercsLost = (g.state.mercsLost || 0) + 1;
    }
    g.scene.remove(this.group);
    if (notify) g.ui.toast('A mercenary has fallen', 'bad');
  }
}

// ------------------------------------------------------------------
export class Mercs {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.home = new THREE.Vector3();
  }

  get count() { return this.list.filter((m) => m.alive).length; }

  /** Where the squad rallies: the barracks' front yard (or wherever it last stood). */
  refreshHome() {
    const b = this.game.buildings.first('barracks');
    if (b) this.home.set(b.door.x, 0, b.door.z);
  }

  recruit(barracks, silent = false) {
    this.refreshHome();
    const home = barracks ? barracks.door : this.home;
    const a = Math.random() * Math.PI * 2, r = 1.5 + Math.random() * 3;
    const m = new Merc(this, home.x + Math.cos(a) * r, home.z + Math.sin(a) * r);
    this.game.resolveCollisions(m.pos, m.radius);
    m.place();
    this.list.push(m);
    if (!silent) this.game.particles.burst(m.pos.x, m.pos.y + 1, m.pos.z, 16, 0xe6b422, 1.2, 2.5, 0.8);
    return m;
  }

  /** Remove one mercenary (battle losses). Returns false when none left. */
  loseOne() {
    const m = this.list.find((x) => x.alive);
    if (!m) return false;
    m.die(false);
    this.list.splice(this.list.indexOf(m), 1);
    return true;
  }

  update(dt, camera, night) {
    if (!this.list.length) return;
    this.refreshHome();
    for (const m of this.list) m.update(dt, camera, night);
    for (let i = this.list.length - 1; i >= 0; i--) if (!this.list[i].alive) this.list.splice(i, 1);
  }

  serialize() {
    return {
      home: [+this.home.x.toFixed(2), +this.home.z.toFixed(2)],
      list: this.list.filter((m) => m.alive).map((m) => {
        const o = m.order && m.order.type !== 'attack' ? { ...m.order } : null;
        return [+m.pos.x.toFixed(2), +m.pos.z.toFixed(2), Math.round(m.hp), o];
      }),
    };
  }

  get selected() { return this.list.filter((m) => m.alive && m.selected); }
  deserialize(d) {
    for (const m of this.list) m.die(false, false);
    this.list.length = 0;
    if (d?.home) this.home.set(d.home[0], 0, d.home[1]);
    this.refreshHome(); // a standing barracks always wins
    const rows = Array.isArray(d) ? d : d?.list;
    for (const [x, z, hp, order] of rows || []) {
      const m = new Merc(this, x, z);
      m.hp = hp ?? m.maxHp;
      if (order && order.type) m.order = order;
      this.list.push(m);
    }
  }
}
