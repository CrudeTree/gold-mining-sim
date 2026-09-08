import * as THREE from 'three';
import { WATER_LEVEL } from './terrain.js';

/**
 * Age of Empires-style control of the mercenaries, active while the Command standard (slot 8) is out.
 *
 *   LMB on a merc          select it (Shift adds / toggles)      double-click a merc: select all
 *   LMB drag on the ground box-select                            LMB on empty ground: deselect
 *   RMB on the ground      move the selection there (formation)  RMB on a skeleton: attack it
 *   M / Z + LMB            move / patrol to the clicked spot     X stand ground   H back to barracks
 *   RMB                    also cancels a pending M/Z command
 *
 * Mercs on orders are "defensive": they break off to fight skeletons that come close, then go back
 * to their post or resume the patrol.
 */

const PICK_PX = 26;         // screen-space radius for clicking a unit
const DRAG_PX = 6;          // mouse travel before a click becomes a box
const DOUBLE_MS = 350;
const SPACING = 1.4;        // formation spacing in metres
const LINE_MAX = 64;        // max line segments for order visuals

export class Command {
  constructor(game) {
    this.game = game;
    this.mode = null;          // pending command awaiting a ground click: 'move' | 'patrol'
    this.drag = null;          // { x, y, box }
    this.lastClick = { t: 0, merc: null };
    this.waving = 0;
    this.markers = [];
    this.el = { box: document.getElementById('selBox'), panel: document.getElementById('cmdPanel'), count: document.getElementById('cmdCount'), hint: document.getElementById('cmdHint') };
    for (const b of this.el.panel.querySelectorAll('.cmdBtn')) {
      b.onmousedown = (e) => e.stopPropagation();
      b.onclick = (e) => { e.stopPropagation(); this.button(b.dataset.cmd); };
    }

    // order visuals: patrol routes / move lines for selected units, plus fading rings at command targets
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LINE_MAX * 2 * 3), 3));
    lineGeo.setDrawRange(0, 0);
    this.lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0x9cf0a8, transparent: true, opacity: 0.8, depthTest: false }));
    this.lines.renderOrder = 6;
    this.lines.frustumCulled = false;
    game.scene.add(this.lines);
    this.markerGeo = new THREE.RingGeometry(0.35, 0.5, 24);
    this.markerMat = new THREE.MeshBasicMaterial({ color: 0x9cf0a8, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
    this.attackMat = new THREE.MeshBasicMaterial({ color: 0xff6b5a, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
    this._v = new THREE.Vector3();
    this._scr = new THREE.Vector2();
  }

  get active() { return this.game.state.hotbar === 7 && !this.game.state.inVehicle; }
  get selected() { return this.game.mercs.selected; }

  // ------------------------------------------------------------ selection helpers
  mousePx(input) {
    return this._scr.set((input.ndc.x + 1) * 0.5 * window.innerWidth, (1 - input.ndc.y) * 0.5 * window.innerHeight);
  }

  /** Unit whose feet/body are under the cursor (screen-space pick, forgiving on a tilted camera). */
  pick(list, px, radiusPx = PICK_PX) {
    let best = null, bd = radiusPx;
    for (const u of list) {
      if (!u.alive) continue;
      this._v.copy(u.pos); this._v.y += 0.9;
      const s = this.game.toScreen(this._v);
      if (!s) continue;
      const d = Math.hypot(s.x - px.x, s.y - px.y);
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  }

  select(mercs, add = false) {
    if (!add) for (const m of this.game.mercs.list) m.selected = false;
    for (const m of mercs) m.selected = true;
  }

  clearSelection() { for (const m of this.game.mercs.list) m.selected = false; this.mode = null; }

  // ------------------------------------------------------------ orders
  /** Spread n destinations around (tx,tz) in ranks facing the direction of travel. */
  formation(units, tx, tz) {
    const n = units.length;
    if (n === 1) return [{ m: units[0], x: tx, z: tz }];
    let cx = 0, cz = 0;
    for (const u of units) { cx += u.pos.x; cz += u.pos.z; }
    cx /= n; cz /= n;
    let hx = tx - cx, hz = tz - cz;
    const hl = Math.hypot(hx, hz);
    if (hl < 0.5) { hx = 0; hz = 1; } else { hx /= hl; hz /= hl; }
    const rx = hz, rz = -hx; // right-hand axis of the formation
    const cols = Math.min(n, Math.ceil(Math.sqrt(n)) + (n > 4 ? 1 : 0));
    const rows = Math.ceil(n / cols);
    const slots = [];
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols), c = i % cols;
      const inRow = Math.min(cols, n - r * cols);
      const off = (c - (inRow - 1) / 2) * SPACING;
      const back = (r - (rows - 1) / 2) * SPACING;
      slots.push({ x: tx + rx * off - hx * back, z: tz + rz * off - hz * back, side: off });
    }
    // hand out slots left-to-right so units don't cross paths
    const byside = [...units].sort((a, b) => ((a.pos.x - cx) * rx + (a.pos.z - cz) * rz) - ((b.pos.x - cx) * rx + (b.pos.z - cz) * rz));
    slots.sort((a, b) => a.side - b.side);
    const t = this.game.terrain;
    return byside.map((m, i) => {
      let { x, z } = slots[i];
      if (!t.inBounds(x, z, 3) || t.heightAt(x, z) < WATER_LEVEL - 0.3) { x = tx; z = tz; }
      return { m, x, z, facing: Math.atan2(hx, hz) };
    });
  }

  issue(type, tx, tz) {
    const sel = this.selected;
    if (!sel.length) return;
    const spots = this.formation(sel, tx, tz);
    for (const s of spots) {
      if (type === 'move') s.m.command({ type: 'move', x: s.x, z: s.z, facing: s.facing });
      else if (type === 'patrol') s.m.command({ type: 'patrol', x: s.m.pos.x, z: s.m.pos.z, x2: s.x, z2: s.z, leg: 1 });
    }
    this.marker(tx, tz, false);
    this.waving = 0.5;
    this.mode = null;
  }

  attack(enemy) {
    for (const m of this.selected) m.command({ type: 'attack', enemy });
    this.marker(enemy.pos.x, enemy.pos.z, true);
    this.waving = 0.5;
    this.mode = null;
  }

  button(cmd) {
    const sel = this.selected;
    if (cmd === 'move' || cmd === 'patrol') { if (sel.length) this.mode = this.mode === cmd ? null : cmd; return; }
    if (cmd === 'stop') { for (const m of sel) m.command({ type: 'hold', x: m.pos.x, z: m.pos.z }); this.waving = 0.4; }
    if (cmd === 'home') { for (const m of sel) m.command(null); this.waving = 0.4; if (sel.length) this.game.ui.toast('Mercenaries returning to the barracks'); }
    this.mode = null;
  }

  marker(x, z, hostile) {
    const m = new THREE.Mesh(this.markerGeo, (hostile ? this.attackMat : this.markerMat).clone());
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, this.game.terrain.heightAt(x, z) + 0.08, z);
    m.renderOrder = 6;
    this.game.scene.add(m);
    this.markers.push({ mesh: m, t: 0 });
  }

  // ------------------------------------------------------------ per frame
  /** Called every on-foot frame; only reacts to the mouse while the standard is out. */
  update(dt, aim, input, enabled = true) {
    const g = this.game;
    this.waving = Math.max(0, this.waving - dt);
    // fading target rings
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const k = this.markers[i];
      k.t += dt;
      const f = k.t / 1.1;
      k.mesh.scale.setScalar(1 + f * 1.6);
      k.mesh.material.opacity = 0.9 * (1 - f);
      if (f >= 1) { g.scene.remove(k.mesh); k.mesh.material.dispose(); this.markers.splice(i, 1); }
    }

    if (!this.active || !enabled) {
      if (this.selected.length || this.mode) this.clearSelection();
      this.el.panel.classList.add('hidden');
      this.el.box.classList.add('hidden');
      this.drag = null;
      document.body.style.cursor = '';
      this._drawLines();
      return;
    }

    const px = this.mousePx(input);
    const mercs = g.mercs.list;
    const shift = input.down('shift');

    // ---- hotkeys
    if (input.pressed('m')) this.button('move');
    if (input.pressed('z')) this.button('patrol');
    if (input.pressed('x')) this.button('stop');
    if (input.pressed('h')) this.button('home');

    // ---- left button: select / box / confirm pending command
    if (input.clicked(0)) {
      const hitMerc = this.pick(mercs, px);
      if (this.mode && aim && !hitMerc) {
        this.issue(this.mode, aim.x, aim.z);
      } else {
        this.drag = { x: px.x, y: px.y, box: false, merc: hitMerc };
      }
    }
    if (this.drag && input.mouseDown(0)) {
      if (!this.drag.box && Math.hypot(px.x - this.drag.x, px.y - this.drag.y) > DRAG_PX) this.drag.box = true;
      if (this.drag.box) {
        const b = this.el.box.style;
        this.el.box.classList.remove('hidden');
        b.left = `${Math.min(this.drag.x, px.x)}px`; b.top = `${Math.min(this.drag.y, px.y)}px`;
        b.width = `${Math.abs(px.x - this.drag.x)}px`; b.height = `${Math.abs(px.y - this.drag.y)}px`;
      }
    } else if (this.drag && !input.mouseDown(0)) {
      const d = this.drag;
      this.drag = null;
      this.el.box.classList.add('hidden');
      if (d.box) {
        const x0 = Math.min(d.x, px.x), x1 = Math.max(d.x, px.x), y0 = Math.min(d.y, px.y), y1 = Math.max(d.y, px.y);
        const inBox = mercs.filter((m) => {
          if (!m.alive) return false;
          this._v.copy(m.pos); this._v.y += 0.9;
          const s = g.toScreen(this._v);
          return s && s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1;
        });
        if (inBox.length) this.select(inBox, shift);
        else if (!shift) this.select([]);
      } else if (d.merc) {
        const now = performance.now();
        const dbl = now - this.lastClick.t < DOUBLE_MS && this.lastClick.merc === d.merc;
        this.lastClick = { t: now, merc: d.merc };
        if (dbl) this.select(mercs.filter((m) => m.alive));
        else if (shift) { d.merc.selected = !d.merc.selected; }
        else this.select([d.merc]);
      } else if (!shift) {
        this.select([]); // empty ground: deselect
        this.mode = null;
      }
    }

    // ---- right button: move / attack, or cancel a pending command
    if (input.clicked(2)) {
      if (this.mode) this.mode = null;
      else if (this.selected.length) {
        const enemy = this.pick(g.enemies.list, px, PICK_PX + 6);
        if (enemy) this.attack(enemy);
        else if (aim) this.issue('move', aim.x, aim.z);
      }
    }

    // ---- panel + cursor
    const sel = this.selected;
    this.el.panel.classList.remove('hidden');
    const total = mercs.filter((m) => m.alive).length;
    const key = `${sel.length}|${total}|${this.mode}|${sel.map((m) => m.order?.type || 'g').join('')}`;
    if (key !== this._panelKey) {
      this._panelKey = key;
      this.el.count.textContent = total ? `${sel.length} of ${total} selected` : 'none hired';
      for (const b of this.el.panel.querySelectorAll('.cmdBtn')) {
        b.classList.toggle('active', b.dataset.cmd === this.mode);
        b.classList.toggle('disabled', !sel.length);
      }
      const orders = sel.map((m) => m.order?.type || 'guard');
      const summary = !sel.length ? '' : orders.every((o) => o === orders[0]) ? ({ guard: 'guarding the barracks', hold: 'standing ground', move: 'moving', patrol: 'on patrol', attack: 'attacking' })[orders[0]] : 'mixed orders';
      this.el.hint.textContent = this.mode === 'move' ? 'Click the ground to move there (RMB cancels)'
        : this.mode === 'patrol' ? 'Click the ground to patrol between here and there (RMB cancels)'
        : !total ? 'Recruit mercenaries on your phone (Buildings)'
        : !sel.length ? 'LMB a soldier or drag a box · double-click for everyone'
        : `${summary} · RMB ground = move · RMB skeleton = attack`;
    }
    document.body.style.cursor = this.mode ? 'crosshair' : '';
    this._drawLines();
  }

  /** Patrol routes and move lines for the selected units. */
  _drawLines() {
    const pos = this.lines.geometry.attributes.position;
    const t = this.game.terrain;
    let n = 0;
    const put = (x1, z1, x2, z2) => {
      if (n >= LINE_MAX) return;
      pos.setXYZ(n * 2, x1, t.heightAt(x1, z1) + 0.25, z1);
      pos.setXYZ(n * 2 + 1, x2, t.heightAt(x2, z2) + 0.25, z2);
      n++;
    };
    if (this.active) {
      for (const m of this.selected) {
        const o = m.order;
        if (!o) continue;
        if (o.type === 'patrol') put(o.x, o.z, o.x2, o.z2);
        else if (o.type === 'move') put(m.pos.x, m.pos.z, o.x, o.z);
        else if (o.type === 'attack' && o.enemy?.alive) put(m.pos.x, m.pos.z, o.enemy.pos.x, o.enemy.pos.z);
      }
    }
    pos.needsUpdate = true;
    this.lines.geometry.setDrawRange(0, n * 2);
    this.lines.visible = n > 0;
  }
}
