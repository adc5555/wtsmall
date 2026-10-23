/* Thunder Skies - shared helpers */
(function (global) {
  'use strict';
  const TS = global.TS = global.TS || {};

  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const invLerp = (a, b, v) => (v - a) / (b - a);
  const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
  const rad = d => d * Math.PI / 180;
  const deg = r => r * 180 / Math.PI;
  const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const wrap = (v, min, max) => {
    const span = max - min;
    return ((v - min) % span + span) % span + min;
  };
  const wrapAngle = a => wrap(a, -Math.PI, Math.PI);
  const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const angleBetween = (a, b) => {
    const d = clamp(a.dot(b) / Math.max(1e-8, a.length() * b.length()), -1, 1);
    return Math.acos(d);
  };
  const degToRad = rad;
  const formatTime = s => {
    s = Math.max(0, Math.ceil(s));
    const m = Math.floor(s / 60), ss = s % 60;
    return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  };
  const formatNumber = n => {
    if (!isFinite(n)) return '---';
    return Math.round(n).toString();
  };
  const cardinal = heading => {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round(heading / 45) % 8];
  };
  const headingFromForward = f => (Math.atan2(f.x, -f.z) * 180 / Math.PI + 360) % 360;
  const randomSign = () => Math.random() < .5 ? -1 : 1;

  // deterministic 2D value noise for terrain
  function hash2(x, y) {
    let h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return h - Math.floor(h);
  }
  function smoothNoise2(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }
  function fbm2(x, y, octaves = 4) {
    let value = 0, amp = .5, freq = 1;
    for (let i = 0; i < octaves; i++) {
      value += amp * smoothNoise2(x * freq, y * freq);
      freq *= 2.04;
      amp *= .5;
    }
    return value;
  }

  function makeBasisQuaternion(forward, upHint, roll, out) {
    out = out || new THREE.Quaternion();
    const f = forward.clone().normalize();
    let up = (upHint || new THREE.Vector3(0, 1, 0)).clone();
    if (Math.abs(f.dot(up)) > 0.98) up.set(1, 0, 0);
    let right = new THREE.Vector3().crossVectors(f, up).normalize();
    let realUp = new THREE.Vector3().crossVectors(right, f).normalize();
    if (roll) {
      right.applyAxisAngle(f, roll);
      realUp.applyAxisAngle(f, roll);
    }
    const back = f.clone().negate();
    const m = new THREE.Matrix4().makeBasis(right, realUp, back);
    out.setFromRotationMatrix(m);
    return out;
  }

  function forwardFromQuat(q, out) {
    out = out || new THREE.Vector3();
    return out.set(0, 0, -1).applyQuaternion(q);
  }
  function upFromQuat(q, out) {
    out = out || new THREE.Vector3();
    return out.set(0, 1, 0).applyQuaternion(q);
  }
  function rightFromQuat(q, out) {
    out = out || new THREE.Vector3();
    return out.set(1, 0, 0).applyQuaternion(q);
  }

  // Segment vs axis aligned box. Returns entry t in [0,1] or null.
  function segmentAABB(p0, p1, min, max) {
    let tmin = 0, tmax = 1;
    const d = new THREE.Vector3().subVectors(p1, p0);
    for (const axis of ['x', 'y', 'z']) {
      if (Math.abs(d[axis]) < 1e-9) {
        if (p0[axis] < min[axis] || p0[axis] > max[axis]) return null;
      } else {
        const inv = 1 / d[axis];
        let t1 = (min[axis] - p0[axis]) * inv;
        let t2 = (max[axis] - p0[axis]) * inv;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return null;
      }
    }
    return tmin;
  }

  function segmentSphere(p0, p1, center, radius) {
    const d = new THREE.Vector3().subVectors(p1, p0);
    const f = new THREE.Vector3().subVectors(p0, center);
    const a = d.dot(d);
    const b = 2 * f.dot(d);
    const c = f.dot(f) - radius * radius;
    if (a < 1e-8) return c <= 0 ? 0 : null;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    const t1 = (-b - sq) / (2 * a);
    const t2 = (-b + sq) / (2 * a);
    if (t1 >= 0 && t1 <= 1) return t1;
    if (t2 >= 0 && t2 <= 1) return t2;
    if (t1 < 0 && t2 > 1) return 0;
    return null;
  }

  function makeCanvasTexture(size, painter) {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    painter(ctx, size);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  TS.Utils = {
    clamp, lerp, invLerp, damp, rad, deg, rand, randInt, pick, wrap, wrapAngle,
    smoothstep, angleBetween, formatTime, formatNumber, cardinal, headingFromForward,
    randomSign, fbm2, hash2, smoothNoise2, makeBasisQuaternion, forwardFromQuat,
    upFromQuat, rightFromQuat, segmentAABB, segmentSphere, makeCanvasTexture
  };
})(window);
