import * as THREE from 'three';

export class Input {
  constructor(dom) {
    this.keys = new Set();
    this.justPressed = new Set();
    this.buttons = new Set();
    this.justClicked = new Set();
    this.ndc = new THREE.Vector2(0, 0);
    this.wheel = 0;
    this.hasMouse = false;

    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (!e.repeat) this.justPressed.add(k);
      this.keys.add(k);
      if (k === ' ' || k === 'tab') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => { this.keys.clear(); this.buttons.clear(); });

    dom.addEventListener('mousemove', (e) => {
      const r = dom.getBoundingClientRect();
      this.ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      this.hasMouse = true;
    });
    dom.addEventListener('mousedown', (e) => {
      this.buttons.add(e.button);
      this.justClicked.add(e.button);
    });
    window.addEventListener('mouseup', (e) => this.buttons.delete(e.button));
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('wheel', (e) => { this.wheel += e.deltaY; }, { passive: true });
  }

  down(k) { return this.keys.has(k); }
  pressed(k) { return this.justPressed.has(k); }
  mouseDown(b = 0) { return this.buttons.has(b); }
  clicked(b = 0) { return this.justClicked.has(b); }

  endFrame() {
    this.justPressed.clear();
    this.justClicked.clear();
    this.wheel = 0;
  }
}
