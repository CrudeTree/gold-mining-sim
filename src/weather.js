import * as THREE from 'three';
import { CONFIG } from './config.js';

// target values per weather type: [cloud, rain, fog]
const TYPES = {
  clear: [0, 0, 0],
  cloudy: [0.6, 0, 0.05],
  rain: [0.85, 0.7, 0.2],
  storm: [1.0, 1.0, 0.3],
  fog: [0.5, 0, 1.0],
};
const NEXT = {
  clear: [['clear', 4], ['cloudy', 4], ['fog', 1.2], ['rain', 1]],
  cloudy: [['clear', 3], ['rain', 3], ['storm', 1], ['cloudy', 1.5], ['fog', 1]],
  rain: [['cloudy', 3], ['storm', 1.5], ['clear', 1.5], ['rain', 1]],
  storm: [['rain', 3], ['cloudy', 2]],
  fog: [['clear', 3], ['cloudy', 2]],
};
/** A thin vertical streak so rain points read as falling drops, not squares. */
function makeStreakTexture() {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 64;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(6, 0, 4, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const WEATHER_LABEL = { clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', storm: 'Thunderstorm', fog: 'Fog' };

export class Weather {
  constructor(scene) {
    this.scene = scene;
    this.type = 'clear';
    this.hoursLeft = 3 + Math.random() * 3;
    this.cloud = 0; this.rain = 0; this.fog = 0;
    this.flash = 0;
    this.flashTimer = 8;
    this.strobe = 0;
    this.strobeTimer = 0;
    this.wind = 0.6;

    const count = 2200;
    this.count = count;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) pos[i * 3 + 1] = -1000;
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.points = new THREE.Points(
      this.geo,
      new THREE.PointsMaterial({ color: 0xdfeeff, size: 0.9, map: makeStreakTexture(), transparent: true, opacity: 0, depthWrite: false, alphaTest: 0.05 })
    );
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
    this._init = false;
  }

  pickNext() {
    const opts = NEXT[this.type];
    let total = 0;
    for (const o of opts) total += o[1];
    let r = Math.random() * total;
    for (const o of opts) { r -= o[1]; if (r <= 0) { this.type = o[0]; break; } }
    const w = CONFIG.weather;
    this.hoursLeft = w.minHours + Math.random() * (w.maxHours - w.minHours);
    if (this.type === 'storm') this.hoursLeft *= 0.6;
  }

  update(dt, hoursDelta, target, terrain) {
    this.hoursLeft -= hoursDelta;
    if (this.hoursLeft <= 0) this.pickNext();
    const [tc, tr, tf] = TYPES[this.type];
    const k = Math.min(1, dt * 0.18);
    this.cloud += (tc - this.cloud) * k;
    this.rain += (tr - this.rain) * k;
    this.fog += (tf - this.fog) * k;

    // lightning
    if (this.type === 'storm') {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) {
        this.flash = 1;
        // most strikes flicker: a second, sometimes third, pulse right after the first
        this.strobe = Math.random() < 0.7 ? 1 + (Math.random() < 0.4 ? 1 : 0) : 0;
        this.strobeTimer = 0.12 + Math.random() * 0.1;
        this.flashTimer = 4 + Math.random() * 9;
      }
      if (this.strobe > 0) {
        this.strobeTimer -= dt;
        if (this.strobeTimer <= 0) { this.flash = 0.8 + Math.random() * 0.2; this.strobe--; this.strobeTimer = 0.1 + Math.random() * 0.12; }
      }
    }
    this.flash *= Math.exp(-dt * 8);

    // rain particles
    const vis = this.rain > 0.03;
    this.points.visible = vis;
    if (vis) {
      const pos = this.geo.attributes.position.array;
      const active = Math.floor(this.count * Math.min(1, this.rain * 1.2));
      const R = 34;
      for (let i = 0; i < this.count; i++) {
        const j = i * 3;
        if (i >= active) { pos[j + 1] = -1000; continue; }
        let x = pos[j], y = pos[j + 1], z = pos[j + 2];
        const dead = y < -900 || Math.abs(x - target.x) > R + 4 || Math.abs(z - target.z) > R + 4;
        if (dead || !this._init) {
          x = target.x + (Math.random() - 0.5) * 2 * R;
          z = target.z + (Math.random() - 0.5) * 2 * R;
          y = target.y + Math.random() * 30;
        } else {
          y -= (24 + (i % 7)) * dt;
          x += this.wind * 4 * dt;
          if (y < terrain.heightAt(x, z) || y < target.y - 4) {
            x = target.x + (Math.random() - 0.5) * 2 * R;
            z = target.z + (Math.random() - 0.5) * 2 * R;
            y = target.y + 26 + Math.random() * 6;
          }
        }
        pos[j] = x; pos[j + 1] = y; pos[j + 2] = z;
      }
      this._init = true;
      this.geo.attributes.position.needsUpdate = true;
      this.points.material.opacity = 0.55 * Math.min(1, this.rain);
    } else {
      this._init = false;
    }
  }

  /** Bonus multiplier for the wash plant (more water when it rains). */
  get plantBonus() { return 1 + 0.3 * this.rain; }

  serialize() { return { type: this.type, hoursLeft: this.hoursLeft }; }
  deserialize(d) {
    if (!d) return;
    if (TYPES[d.type]) this.type = d.type;
    this.hoursLeft = d.hoursLeft ?? 3;
    const [c, r, f] = TYPES[this.type];
    this.cloud = c; this.rain = r; this.fog = f;
  }
}
