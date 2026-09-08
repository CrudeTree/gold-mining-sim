import * as THREE from 'three';
import { CONFIG } from './config.js';
import { box, cyl } from './world.js';

const UP = new THREE.Vector3(0, 1, 0);
const tracerGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 5);
const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe28a, transparent: true, opacity: 0.9 });

export function buildTurretMesh(ghost = false) {
  const g = new THREE.Group();
  const dark = ghost
    ? new THREE.MeshStandardMaterial({ color: 0x66ccff, transparent: true, opacity: 0.45, depthWrite: false })
    : 0x3a3f47;
  const steel = ghost ? dark : new THREE.MeshStandardMaterial({ color: 0x8b939c, metalness: 0.4, roughness: 0.5 });
  const accent = ghost ? dark : 0xe0a52a;
  cyl(0.75, 0.85, 0.3, dark, 0, 0.15, 0, g, 14);
  cyl(0.28, 0.32, 0.75, steel, 0, 0.65, 0, g, 10);
  const head = new THREE.Group();
  head.position.y = 1.1;
  box(0.8, 0.5, 0.9, accent, 0, 0, 0, head);
  box(0.9, 0.12, 0.5, dark, 0, 0.31, -0.1, head);
  const barrel = cyl(0.07, 0.08, 1.0, steel, 0, 0, 0.85, head, 8);
  barrel.rotation.x = Math.PI / 2;
  const muzzle = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xffd37a, emissive: 0xffb040, emissiveIntensity: 0, transparent: ghost, opacity: ghost ? 0.4 : 1 })
  );
  muzzle.position.set(0, 0, 1.38);
  head.add(muzzle);
  const lamp = box(0.12, 0.12, 0.12, ghost ? dark : new THREE.MeshStandardMaterial({ color: 0x40ff70, emissive: 0x20ff50, emissiveIntensity: 1.5 }), 0.3, 0.3, -0.35, head);
  g.add(head);
  return { group: g, head, muzzle, lamp };
}

export class Turret {
  constructor(game, x, z) {
    this.game = game;
    this.pos = new THREE.Vector3(x, game.terrain.heightAt(x, z), z);
    this.hp = CONFIG.turret.hp;
    this.maxHp = CONFIG.turret.hp;
    this.alive = true;
    this.fireTimer = Math.random() * 0.5;
    this.flash = 0;
    this.yaw = Math.random() * Math.PI * 2;
    this.target = null;
    const m = buildTurretMesh(false);
    this.group = m.group;
    this.head = m.head;
    this.muzzle = m.muzzle;
    this.lamp = m.lamp;
    this.group.position.copy(this.pos);
    this.head.rotation.y = this.yaw;
    game.scene.add(this.group);
    this.tracer = new THREE.Mesh(tracerGeo, tracerMat);
    this.tracer.visible = false;
    game.scene.add(this.tracer);
    this.tracerTimer = 0;
    // health bar
    this.hpBar = new THREE.Group();
    this.hpBar.position.y = 1.9;
    this.hpBar.add(new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.09), new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.8, depthTest: false })));
    this.hpFg = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.09), new THREE.MeshBasicMaterial({ color: 0x4caf50, depthTest: false }));
    this.hpFg.position.z = 0.01;
    this.hpBar.add(this.hpFg);
    this.hpBar.visible = false;
    this.hpBar.renderOrder = 20;
    this.group.add(this.hpBar);
  }

  get damageValue() { return CONFIG.turret.damage[this.game.state.upgrades.turretDmg || 0]; }

  update(dt, daylight, camera) {
    if (!this.alive) return;
    const g = this.game;
    // daytime auto-repair
    if (daylight > 0.5 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + CONFIG.turret.repairRate * dt);

    // targeting
    if (!this.target || !this.target.alive || Math.hypot(this.target.pos.x - this.pos.x, this.target.pos.z - this.pos.z) > CONFIG.turret.range + 1) {
      this.target = g.enemies.nearest(this.pos.x, this.pos.z, CONFIG.turret.range);
    }
    if (this.target) {
      const dx = this.target.pos.x - this.pos.x, dz = this.target.pos.z - this.pos.z;
      const want = Math.atan2(dx, dz);
      let dy = want - this.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this.yaw += dy * Math.min(1, dt * 9);
      this.head.rotation.y = this.yaw;
      this.fireTimer -= dt;
      if (this.fireTimer <= 0 && Math.abs(dy) < 0.25) {
        this.fireTimer = CONFIG.turret.interval;
        this.fire();
      }
    } else {
      this.fireTimer = Math.min(this.fireTimer, 0.2);
      this.head.rotation.y = this.yaw += dt * 0.4; // idle scan
    }

    // visuals
    if (this.flash > 0) { this.flash -= dt; this.muzzle.material.emissiveIntensity = Math.max(0, this.flash * 30); }
    if (this.tracerTimer > 0) { this.tracerTimer -= dt; if (this.tracerTimer <= 0) this.tracer.visible = false; }
    this.hpBar.visible = this.hp < this.maxHp - 0.5;
    if (this.hpBar.visible) {
      this.hpBar.quaternion.copy(camera.quaternion);
      const f = this.hp / this.maxHp;
      this.hpFg.scale.x = f;
      this.hpFg.position.x = -(1 - f) * 0.5;
    }
  }

  fire() {
    const e = this.target;
    if (!e || !e.alive) return;
    const start = new THREE.Vector3(0, 0, 1.4);
    this.head.updateWorldMatrix(true, false);
    this.head.localToWorld(start);
    const end = e.pos.clone(); end.y += 1.0 * e.cfg.scale;
    const dir = end.clone().sub(start);
    const len = dir.length();
    this.tracer.position.copy(start).addScaledVector(dir, 0.5);
    this.tracer.scale.set(1, len, 1);
    this.tracer.quaternion.setFromUnitVectors(UP, dir.normalize());
    this.tracer.visible = true;
    this.tracerTimer = 0.07;
    this.flash = 0.1;
    this.game.particles.burst(end.x, end.y, end.z, 4, 0xfff0b0, 0.3, 1.5, 0.3);
    e.damage(this.damageValue, this.pos, 1.5);
  }

  damage(d) {
    if (!this.alive) return;
    this.hp -= d;
    if (this.hp <= 0) this.destroy();
  }

  destroy(silent = false) {
    this.alive = false;
    const g = this.game;
    g.particles.burst(this.pos.x, this.pos.y + 1, this.pos.z, 30, 0x555a60, 1.5, 3, 1.2);
    g.particles.burst(this.pos.x, this.pos.y + 1, this.pos.z, 12, 0xff8a30, 1.0, 3, 0.6);
    g.scene.remove(this.group);
    g.scene.remove(this.tracer);
    if (!silent) g.ui.toast('A turret was destroyed!', 'bad');
  }

  serialize() { return { x: this.pos.x, z: this.pos.z, hp: this.hp }; }
}
