/* Thunder Skies - action based keyboard / mouse input */
(function (global) {
  'use strict';
  const TS = global.TS = global.TS || {};
  const U = TS.Utils;

  class InputManager {
    constructor() {
      this.settings = TS.Settings;
      this.downKeys = new Map();       // code -> count for keydown/up
      this.downNormalized = new Map(); // normalized code -> count
      this.downMouse = new Set();
      this.edgeActions = new Set();
      this.aimDelta = { x: 0, y: 0 };
      this.look = { yaw: 0, pitch: 0 };
      this.active = false;
      this.capturing = null;
      this.captureCallback = null;
      this.pointerLocked = false;
      this.onLockChange = null;
      this.onEscape = null;
      this.onMute = null;
      this.mouseSensitivity = 0.85;
      this.bound = false;
      this.bind();
    }

    bind() {
      if (this.bound) return;
      this.bound = true;
      window.addEventListener('keydown', e => this.handleKeyDown(e), { passive: false });
      window.addEventListener('keyup', e => this.handleKeyUp(e), { passive: false });
      window.addEventListener('mousedown', e => this.handleMouseDown(e), { passive: false });
      window.addEventListener('mouseup', e => this.handleMouseUp(e));
      window.addEventListener('mousemove', e => this.handleMouseMove(e), { passive: false });
      window.addEventListener('contextmenu', e => {
        if (this.active) e.preventDefault();
      });
      window.addEventListener('blur', () => this.clearHeld());
      document.addEventListener('pointerlockchange', () => {
        this.pointerLocked = document.pointerLockElement === document.getElementById('scene');
        if (this.onLockChange) this.onLockChange(this.pointerLocked);
      });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.clearHeld();
      });
      window.addEventListener('wheel', e => {
        if (this.active) e.preventDefault();
      }, { passive: false });
    }

    normalize(code) {
      if (!code) return code;
      if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Shift';
      if (code === 'ControlLeft' || code === 'ControlRight') return 'Control';
      if (code === 'AltLeft' || code === 'AltRight') return 'Alt';
      return code;
    }

    boundCode(action) {
      return this.normalize(this.settings.get(action));
    }

    addNormalized(code) {
      const c = this.normalize(code);
      this.downNormalized.set(c, (this.downNormalized.get(c) || 0) + 1);
    }
    removeNormalized(code) {
      const c = this.normalize(code);
      const n = (this.downNormalized.get(c) || 0) - 1;
      if (n > 0) this.downNormalized.set(c, n);
      else this.downNormalized.delete(c);
    }

    actionFromEventCode(code) {
      const normalized = this.normalize(code);
      const action = this.settings.findActionForCode(normalized);
      return action;
    }

    shouldPrevent(code) {
      return [
        'Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
        'Slash', 'Quote', 'Backslash', 'Semicolon'
      ].includes(code);
    }

    handleKeyDown(e) {
      if (this.capturing) {
        e.preventDefault();
        e.stopPropagation();
        if (e.repeat) return;
        if (e.code === 'Escape') {
          this.cancelCapture();
          return;
        }
        this.finishCapture(e.code);
        return;
      }
      if (e.code === 'Escape') {
        if (this.onEscape) this.onEscape();
        return;
      }
      const normalized = this.normalize(e.code);
      // Ignore OS auto-repeat. Only a physical keydown/keyup pair changes the
      // held state; otherwise a held key remains logically down after release.
      if (e.repeat) {
        if (this.active) {
          const repeatedAction = this.settings.findActionForCode(normalized);
          if (repeatedAction && this.shouldPrevent(e.code)) e.preventDefault();
        }
        return;
      }
      if (!this.downKeys.has(e.code)) {
        this.downKeys.set(e.code, 1);
        this.addNormalized(e.code);
      }
      if (this.active) {
        const action = this.settings.findActionForCode(normalized);
        if (action) {
          this.edgeActions.add(action);
          if (this.shouldPrevent(e.code)) e.preventDefault();
        }
        // prevent browser tab focus / scrolling only for bound keys or common flight keys
        if (this.shouldPrevent(e.code)) e.preventDefault();
      }
    }

    handleKeyUp(e) {
      if (this.capturing) { e.preventDefault(); return; }
      if (!this.downKeys.has(e.code)) return;
      const count = this.downKeys.get(e.code) - 1;
      if (count <= 0) {
        this.downKeys.delete(e.code);
        this.removeNormalized(e.code);
      } else {
        this.downKeys.set(e.code, count);
      }
      if (this.active && this.shouldPrevent(e.code)) e.preventDefault();
    }

    handleMouseDown(e) {
      if (this.capturing) {
        e.preventDefault();
        e.stopPropagation();
        this.finishCapture('Mouse' + e.button);
        return;
      }
      if (!this.active) return;
      const action = this.settings.findActionForCode('Mouse' + e.button);
      if (action) this.edgeActions.add(action);
      if (action || e.button === 2) {
        this.downMouse.add(e.button);
        e.preventDefault();
      }
    }

    handleMouseUp(e) {
      this.downMouse.delete(e.button);
    }

    handleMouseMove(e) {
      if (!this.active) return;
      if (this.isDown('freeLook')) {
        this.look.yaw = U.clamp(this.look.yaw + (e.movementX || 0) * 0.0024, -Math.PI, Math.PI);
        this.look.pitch = U.clamp(this.look.pitch + (e.movementY || 0) * 0.0022, -1.15, 1.25);
        if (document.pointerLockElement) e.preventDefault();
        return;
      }
      // Mouse movement is consumed once and applied to a world-space aim point
      // by the game. It is not a persistent stick offset.
      this.aimDelta.x += (e.movementX || 0);
      this.aimDelta.y += (e.movementY || 0);
    }

    setActive(v) {
      this.active = !!v;
      if (!v) {
        this.clearHeld();
        this.edgeActions.clear();
      }
    }

    clearHeld() {
      this.downKeys.clear();
      this.downNormalized.clear();
      this.downMouse.clear();
      this.edgeActions.clear();
      this.aimDelta.x = 0;
      this.aimDelta.y = 0;
    }

    consumeAimDelta() {
      const dx = this.aimDelta.x, dy = this.aimDelta.y;
      this.aimDelta.x = 0;
      this.aimDelta.y = 0;
      return { x: dx, y: dy };
    }

    clearAimDelta() {
      this.aimDelta.x = 0;
      this.aimDelta.y = 0;
    }

    isDown(action) {
      if (!action) return false;
      const code = this.boundCode(action);
      if (!code) return false;
      if (code.startsWith('Mouse')) return this.downMouse.has(Number(code.slice(5)));
      return (this.downNormalized.get(code) || 0) > 0;
    }

    consumePressed(action) {
      if (this.edgeActions.has(action)) {
        this.edgeActions.delete(action);
        return true;
      }
      return false;
    }

    clearEdges() { this.edgeActions.clear(); }

    resetAim() {
      this.aimDelta.x = 0;
      this.aimDelta.y = 0;
      this.look.yaw = 0;
      this.look.pitch = 0;
    }

    requestPointerLock() {
      const canvas = document.getElementById('scene');
      if (!canvas || document.pointerLockElement === canvas) return;
      try {
        const p = canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      } catch (err) {}
    }

    exitPointerLock() {
      if (document.pointerLockElement) {
        try { document.exitPointerLock(); } catch (err) {}
      }
    }

    startCapture(actionId, callback) {
      this.capturing = actionId;
      this.captureCallback = callback;
      this.clearHeld();
    }

    finishCapture(code) {
      const action = this.capturing;
      const cb = this.captureCallback;
      this.capturing = null;
      this.captureCallback = null;
      if (action) {
        const result = this.settings.setBinding(action, code);
        if (cb) cb(result, code);
      }
    }

    cancelCapture() {
      const cb = this.captureCallback;
      this.capturing = null;
      this.captureCallback = null;
      if (cb) cb({ ok: false, reason: 'cancelled' }, null);
    }
  }

  TS.Input = new InputManager();
})(window);
