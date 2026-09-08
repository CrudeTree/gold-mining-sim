import * as THREE from 'three';
import { box, cyl } from './world.js';
import { CONFIG } from './config.js';

const STEEL = 0x8b939c, DARK = 0x2f333a, BLUE = 0x3d7ec2, GREEN = 0x3f9a44;

function std(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.15, ...extra });
}

export class WashPlant {
  constructor(game, pos) {
    this.game = game;
    this.terrain = game.terrain;
    this.pos = new THREE.Vector3(pos.x, this.terrain.heightAt(pos.x, pos.z), pos.z);
    this.capacity = CONFIG.washPlant.capacity;
    this.rate = CONFIG.washPlant.rate[0];
    this.hopper = 0;
    this.hopperGold = 0;
    this.goldTrap = 0;
    this.tailings = 0;
    this.tailingsTotal = 0;
    this.radius = 4.6;
    this.maxHp = CONFIG.washPlant.hp;
    this.hp = this.maxHp;
    this.damaged = false;
    this.stolen = 0;
    this.smokeTimer = 0;

    const g = new THREE.Group();
    this.group = g;
    g.position.copy(this.pos);
    g.rotation.y = -Math.PI / 2; // hopper faces camp (east side)

    // frame legs
    for (const [x, z] of [[-1.6, -2.4], [1.6, -2.4], [-1.6, 1.4], [1.6, 1.4]]) {
      cyl(0.12, 0.12, 3.2, STEEL, x, 1.6, z, g, 8);
    }
    box(3.6, 0.2, 4.4, STEEL, 0, 3.15, -0.5, g);
    // hopper: inverted pyramid at the back (+z side, where trucks approach)
    this.hopperMesh = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 0.7, 2.0, 4), std(0xe08a2a));
    this.hopperMesh.rotation.y = Math.PI / 4;
    this.hopperMesh.position.set(0, 3.9, 1.6);
    this.hopperMesh.castShadow = true;
    g.add(this.hopperMesh);
    // grizzly bars
    for (let i = -2; i <= 2; i++) box(0.08, 0.08, 3.2, DARK, i * 0.7, 4.95, 1.6, g);
    this.hopperFill = box(2.9, 0.4, 2.9, std(0x8a5a30, { roughness: 1 }), 0, 4.6, 1.6, g);
    this.hopperFill.castShadow = false;
    // trommel
    this.trommel = cyl(1.05, 1.05, 4.2, std(0x5f8fc9, { metalness: 0.3 }), 0, 3.0, -0.6, g, 16);
    this.trommel.rotation.x = Math.PI / 2 - 0.1;
    for (let i = 0; i < 6; i++) {
      const ring = cyl(1.12, 1.12, 0.15, STEEL, 0, 0, -1.8 + i * 0.72, this.trommel, 16);
      ring.rotation.x = 0; // rings along the trommel axis (local y after parent rotation)
      ring.position.set(0, -1.8 + i * 0.72, 0);
    }
    // sluice run
    const sluice = box(1.5, 0.15, 4.0, std(GREEN), 0, 1.6, -3.9, g);
    sluice.rotation.x = 0.22;
    box(0.1, 0.35, 4.0, STEEL, 0.75, 1.75, -3.9, g).rotation.x = 0.22;
    box(0.1, 0.35, 4.0, STEEL, -0.75, 1.75, -3.9, g).rotation.x = 0.22;
    this.riffleLocal = [];
    for (let i = 0; i < 6; i++) {
      const riffle = box(1.4, 0.08, 0.1, DARK, 0, 1.72 - i * 0.14, -2.3 - i * 0.62, g);
      riffle.rotation.x = 0.22;
      this.riffleLocal.push(new THREE.Vector3(0, 1.72 - i * 0.14 + 0.1, -2.3 - i * 0.62 + 0.14));
    }
    // gold caught behind the riffles: tiny nuggets that appear as the trap fills
    this.nuggets = [];
    const nugGeo = new THREE.SphereGeometry(0.085, 6, 5);
    const nugMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffb300, emissiveIntensity: 0.9, metalness: 0.8, roughness: 0.3 });
    for (let i = 0; i < 18; i++) {
      const r = this.riffleLocal[i % 6];
      const m = new THREE.Mesh(nugGeo, nugMat);
      m.position.set(r.x + (Math.random() - 0.5) * 1.1, r.y, r.z + Math.random() * 0.15);
      m.scale.setScalar(0.7 + Math.random() * 0.7);
      m.visible = false;
      g.add(m);
      this.nuggets.push(m);
    }
    this.sparkleTimer = 0;
    // tailings chute
    const chute = box(1.2, 0.1, 2.4, STEEL, 2.4, 2.4, -1.4, g);
    chute.rotation.z = -0.35;
    chute.rotation.x = 0.1;
    // water pump & pipe
    box(0.9, 0.7, 0.9, BLUE, -2.6, 0.35, 0.5, g);
    cyl(0.1, 0.1, 4.6, BLUE, -1.4, 2.5, 0.2, g, 8).rotation.z = 0.55;
    // lamp pole
    cyl(0.08, 0.08, 5.0, DARK, -2.2, 2.5, 2.6, g, 8);
    this.lampMesh = box(0.5, 0.2, 0.5, new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xfff0a0, emissiveIntensity: 0 }), -2.0, 5.05, 2.6, g);
    this.lamp = new THREE.PointLight(0xfff0c0, 0, 22, 2);
    this.lamp.position.set(-2.0, 4.9, 2.6);
    g.add(this.lamp);

    // water spray (cosmetic)
    this.spray = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.4, 8), new THREE.MeshStandardMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.55 }));
    this.spray.position.set(0, 4.3, 0.4);
    this.spray.rotation.x = Math.PI;
    g.add(this.spray);

    this.game.scene.add(g);
    this.updateHopperMesh();

    // world positions
    g.updateMatrixWorld(true);
    this.hopperPos = g.localToWorld(new THREE.Vector3(0, 4.6, 1.6));
    this.tailingsPos = g.localToWorld(new THREE.Vector3(6.8, 0, -2.6));
    this.collectPos = g.localToWorld(new THREE.Vector3(0, 0, -5.5));
    this.raidPos = g.localToWorld(new THREE.Vector3(0, 0, -3.2));
    this.raidPos.y = this.terrain.heightAt(this.raidPos.x, this.raidPos.z);
    this.riffleWorld = this.riffleLocal.map((p) => g.localToWorld(p.clone()));
  }

  /** Show gold in the sluice box: nuggets scale with the amount caught, sparkles fly off it. */
  updateSluiceGold(dt) {
    const gld = this.goldTrap;
    // 0 nuggets at 0 g, all 18 by ~3 g (log curve so the first bits show quickly)
    const show = gld < 0.01 ? 0 : Math.min(this.nuggets.length, Math.ceil(4 + 6 * Math.log2(1 + gld)));
    for (let i = 0; i < this.nuggets.length; i++) this.nuggets[i].visible = i < show;
    if (show === 0) return;
    this.sparkleTimer -= dt;
    if (this.sparkleTimer <= 0) {
      // more gold → sparkle more often
      this.sparkleTimer = Math.max(0.08, 0.7 / (1 + gld * 2));
      const p = this.riffleWorld[Math.floor(Math.random() * this.riffleWorld.length)];
      this.game.particles.burst(p.x + (Math.random() - 0.5) * 1.0, p.y + 0.1, p.z, 2 + Math.floor(Math.random() * 2), 0xffe37a, 0.15, 1.2, 0.7);
    }
  }

  /** Skeletons hit the plant: damage it and steal gold from the sluice. */
  raid(dmg) {
    if (this.goldTrap > 0) {
      const steal = Math.min(this.goldTrap, 0.15);
      this.goldTrap -= steal;
      this.stolen += steal;
    }
    if (this.damaged) return;
    this.hp -= dmg;
    this.game.particles.burst(this.raidPos.x, this.raidPos.y + 1.5, this.raidPos.z, 6, 0xffb060, 0.8, 2, 0.4);
    if (this.hp <= 0) {
      this.hp = 0;
      this.damaged = true;
      this.game.ui.toast('The wash plant has been wrecked! Repair it from your phone (TAB).', 'bad');
    }
  }

  repair() {
    this.hp = this.maxHp;
    this.damaged = false;
  }

  get fill() { return this.hopper / this.capacity; }
  get richness() { return this.hopper > 0 ? this.hopperGold / this.hopper : 0; }
  get processing() { return this.hopper > 0.001; }

  addPaydirt(vol, gold) {
    const accept = Math.max(0, Math.min(vol, this.capacity - this.hopper));
    if (accept <= 0) return 0;
    this.hopper += accept;
    this.hopperGold += gold * (accept / vol);
    this.updateHopperMesh();
    return accept;
  }

  collect() {
    const g = this.goldTrap;
    this.goldTrap = 0;
    return g;
  }

  updateHopperMesh() {
    const f = Math.max(0.03, this.fill);
    this.hopperFill.visible = this.hopper > 0.01;
    this.hopperFill.scale.y = f * 1.6;
    this.hopperFill.position.y = 4.15 + f * 0.4;
  }

  update(dt, night, daylight = 1, rateMul = 1) {
    this.updateSluiceGold(dt);
    if (this.damaged) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = 0.25;
        this.game.particles.burst(this.pos.x, this.pos.y + 3.5, this.pos.z, 2, 0x333333, 1.5, 1.2, 1.6);
      }
      this.spray.visible = false;
      this.lamp.intensity = 0;
      this.lampMesh.material.emissiveIntensity = 0;
      return;
    }
    if (daylight > 0.5 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + 8 * dt);
    if (this.hopper > 0.001) {
      const v = Math.min(this.hopper, this.rate * rateMul * dt);
      const frac = v / this.hopper;
      const g = this.hopperGold * frac;
      this.goldTrap += g * CONFIG.washPlant.efficiency;
      this.hopperGold -= g;
      this.hopper -= v;
      if (this.hopper < 0.001) { this.hopper = 0; this.hopperGold = 0; }
      this.trommel.rotation.y += dt * 1.8;
      this.tailings += v;
      this.tailingsTotal += v;
      if (this.tailings > 6) {
        this.tailings = 0;
        this.terrain.raise(this.tailingsPos.x, this.tailingsPos.z, 2.6, 0.14, 2.2);
      }
      this.updateHopperMesh();
      this.spray.visible = true;
      this.spray.scale.y = 0.9 + 0.2 * Math.sin(performance.now() * 0.02);
    } else {
      this.spray.visible = false;
    }
    const on = night > 0.3 ? night : 0;
    this.lamp.intensity = on * 40;
    this.lampMesh.material.emissiveIntensity = on * 1.5;
  }

  serialize() {
    return { hopper: this.hopper, hopperGold: this.hopperGold, goldTrap: this.goldTrap, tailingsTotal: this.tailingsTotal, hp: this.hp, damaged: this.damaged, stolen: this.stolen };
  }
  deserialize(d) {
    if (!d) return;
    this.hopper = d.hopper || 0;
    this.hopperGold = d.hopperGold || 0;
    this.goldTrap = d.goldTrap || 0;
    this.tailingsTotal = d.tailingsTotal || 0;
    this.hp = d.hp ?? this.maxHp;
    this.damaged = !!d.damaged;
    this.stolen = d.stolen || 0;
    this.updateHopperMesh();
  }
}
