import * as THREE from 'three';

/** Tiny CPU particle system for dirt puffs and gold sparkles. */
export class Particles {
  constructor(scene, max = 600) {
    this.max = max;
    this.items = [];
    const pos = new Float32Array(max * 3);
    const col = new Float32Array(max * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.geo.setDrawRange(0, 0);
    this.points = new THREE.Points(
      this.geo,
      new THREE.PointsMaterial({ size: 0.28, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false })
    );
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  burst(x, y, z, count, color, spread = 1, up = 3, life = 0.8, gravity = 9) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      if (this.items.length >= this.max) this.items.shift();
      this.items.push({
        p: new THREE.Vector3(x + (Math.random() - 0.5) * spread, y, z + (Math.random() - 0.5) * spread),
        v: new THREE.Vector3((Math.random() - 0.5) * spread * 2, up * (0.5 + Math.random()), (Math.random() - 0.5) * spread * 2),
        c: c.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.15),
        life: life * (0.6 + Math.random() * 0.6),
        g: gravity,
      });
    }
  }

  update(dt) {
    const pos = this.geo.attributes.position.array;
    const col = this.geo.attributes.color.array;
    let n = 0;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life -= dt;
      if (it.life <= 0) { this.items.splice(i, 1); continue; }
      it.v.y -= it.g * dt;
      it.p.addScaledVector(it.v, dt);
      pos[n * 3] = it.p.x; pos[n * 3 + 1] = it.p.y; pos[n * 3 + 2] = it.p.z;
      col[n * 3] = it.c.r; col[n * 3 + 1] = it.c.g; col[n * 3 + 2] = it.c.b;
      n++;
    }
    this.geo.setDrawRange(0, n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}
