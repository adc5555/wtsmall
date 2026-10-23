/* Thunder Skies - GPU-light particle effects and tracers */
(function (global) {
  'use strict';
  const TS = global.TS = global.TS || {};
  const U = TS.Utils;

  const POINT_VERT = `
    attribute float aSize;
    attribute float aAlpha;
    attribute vec3 aColor;
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      vColor = aColor;
      vAlpha = aAlpha;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = clamp(aSize * (360.0 / max(1.0, -mv.z)), 0.0, 180.0);
      gl_Position = projectionMatrix * mv;
    }
  `;
  const POINT_FRAG = `
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      vec2 p = gl_PointCoord - vec2(0.5);
      float d = length(p);
      if (d > 0.5) discard;
      float a = smoothstep(0.5, 0.04, d) * vAlpha;
      gl_FragColor = vec4(vColor, a);
    }
  `;

  class ParticlePool {
    constructor(scene, capacity, blending, softness) {
      this.capacity = capacity;
      this.particles = [];
      this.geometry = new THREE.BufferGeometry();
      this.positions = new Float32Array(capacity * 3);
      this.colors = new Float32Array(capacity * 3);
      this.sizes = new Float32Array(capacity);
      this.alphas = new Float32Array(capacity);
      this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
      this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
      this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
      this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
      this.geometry.setDrawRange(0, 0);
      this.material = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending,
        vertexShader: POINT_VERT, fragmentShader: POINT_FRAG
      });
      this.points = new THREE.Points(this.geometry, this.material);
      this.points.frustumCulled = false;
      scene.add(this.points);
    }

    add(p) {
      if (this.particles.length >= this.capacity) {
        this.particles.shift();
      }
      p.age = 0;
      p.maxAge = p.life;
      p.size0 = p.size;
      p.size1 = p.endSize || p.size * 1.7;
      p.alpha0 = p.alpha == null ? .5 : p.alpha;
      p.alpha1 = p.endAlpha == null ? 0 : p.endAlpha;
      this.particles.push(p);
    }

    update(dt, camera) {
      const arr = this.particles;
      let n = 0;
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i];
        p.age += dt;
        if (p.age >= p.maxAge) {
          arr.splice(i, 1);
          i--;
          continue;
        }
        const t = p.age / p.maxAge;
        p.velocity.y -= (p.gravity || 0) * dt;
        p.velocity.multiplyScalar(Math.exp(-(p.drag || .2) * dt));
        p.position.addScaledVector(p.velocity, dt);
        const size = U.lerp(p.size0, p.size1, t);
        const alpha = U.lerp(p.alpha0, p.alpha1, t);
        this.positions[n * 3] = p.position.x;
        this.positions[n * 3 + 1] = p.position.y;
        this.positions[n * 3 + 2] = p.position.z;
        this.colors[n * 3] = p.color.r;
        this.colors[n * 3 + 1] = p.color.g;
        this.colors[n * 3 + 2] = p.color.b;
        this.sizes[n] = size;
        this.alphas[n] = alpha;
        n++;
      }
      // remove dead from end occurs during loop; n equals remaining
      this.geometry.setDrawRange(0, n);
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.attributes.aColor.needsUpdate = true;
      this.geometry.attributes.aSize.needsUpdate = true;
      this.geometry.attributes.aAlpha.needsUpdate = true;
      this.geometry.setDrawRange(0, n);
    }

    clear() {
      this.particles.length = 0;
      this.geometry.setDrawRange(0, 0);
    }
  }

  class Effects {
    constructor(world) {
      this.world = world;
      this.scene = world.scene;
      this.smoke = new ParticlePool(this.scene, 520, THREE.NormalBlending, true);
      this.glow = new ParticlePool(this.scene, 300, THREE.AdditiveBlending, true);
      this.tracerMax = 600;
      const tg = new THREE.BufferGeometry();
      this.tracerPositions = new Float32Array(this.tracerMax * 6);
      this.tracerColors = new Float32Array(this.tracerMax * 6);
      tg.setAttribute('position', new THREE.BufferAttribute(this.tracerPositions, 3));
      tg.setAttribute('color', new THREE.BufferAttribute(this.tracerColors, 3));
      tg.setDrawRange(0, 0);
      this.tracerGeo = tg;
      this.tracerMat = new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false
      });
      this.tracers = new THREE.LineSegments(tg, this.tracerMat);
      this.tracers.frustumCulled = false;
      this.scene.add(this.tracers);
      this.smokeTick = new Map();
      this.tmp = new THREE.Vector3();
    }

    smokePuff(pos, options = {}) {
      const c = new THREE.Color(options.color == null ? 0x9ba7a2 : options.color);
      this.smoke.add({
        position: pos.clone(),
        velocity: options.velocity ? options.velocity.clone() : new THREE.Vector3(U.rand(-2, 2), U.rand(1, 5), U.rand(-2, 2)),
        life: options.life || U.rand(2.2, 4.2),
        size: options.size || U.rand(4, 9),
        endSize: options.endSize || U.rand(26, 48),
        alpha: options.alpha == null ? .36 : options.alpha,
        endAlpha: 0,
        drag: options.drag == null ? 1.2 : options.drag,
        gravity: options.gravity == null ? -0.2 : options.gravity,
        color: c
      });
    }

    firePuff(pos, options = {}) {
      this.glow.add({
        position: pos.clone(),
        velocity: options.velocity ? options.velocity.clone() : new THREE.Vector3(U.rand(-4, 4), U.rand(3, 10), U.rand(-4, 4)),
        life: options.life || U.rand(.25, .65),
        size: options.size || U.rand(8, 20),
        endSize: options.endSize || U.rand(26, 42),
        alpha: options.alpha == null ? .8 : options.alpha,
        endAlpha: 0,
        drag: options.drag == null ? 3 : options.drag,
        gravity: options.gravity == null ? 0 : options.gravity,
        color: new THREE.Color(options.color == null ? 0xffa247 : options.color)
      });
    }

    addSmoke(pos, amount = 1, options = {}) {
      for (let i = 0; i < amount; i++) this.smokePuff(pos, options);
    }

    engineTrail(pos, team, boost, dt) {
      const interval = boost ? .018 : .055;
      const key = 'engine' + pos.x.toFixed(0) + ':' + pos.y.toFixed(0) + ':' + pos.z.toFixed(0);
      // cheap timers keyed by fighter id are better; upstream calls this with id instead.
    }

    missileTrail(pos, kind, dt) {
      this.smokePuff(pos, {
        size: U.rand(2, 4.5), endSize: U.rand(15, 25), life: U.rand(1.2, 2.4),
        alpha: .22, color: 0xc8d0c9, gravity: 0, drag: 2
      });
      this.firePuff(pos, {
        size: U.rand(2.5, 6), endSize: U.rand(6, 12), life: U.rand(.10, .22),
        color: kind === 'sarh' ? 0xffd47a : 0xffa35a, alpha: .9, gravity: 0, drag: 1
      });
    }

    bulletTracer(pos, color) {
      // reserved for tests; actual tracers are batched
      this.glow.add({
        position: pos.clone(), velocity: new THREE.Vector3(), life: .02, size: 4,
        endSize: 4, alpha: .8, endAlpha: .8, color: new THREE.Color(color || 0xffdf9b)
      });
    }

    updateTracers(bullets) {
      const pos = this.tracerPositions;
      const col = this.tracerColors;
      let n = 0;
      for (let i = 0; i < bullets.length && n < this.tracerMax; i++) {
        const b = bullets[i];
        if (!b.alive) continue;
        const len = Math.min(20, b.prev.distanceTo(b.pos) + 8);
        const f = b.dir ? b.dir : this.tmp.copy(b.pos).sub(b.prev).normalize();
        const x2 = b.pos.x - f.x * len;
        const y2 = b.pos.y - f.y * len;
        const z2 = b.pos.z - f.z * len;
        pos[n * 6] = b.pos.x; pos[n * 6 + 1] = b.pos.y; pos[n * 6 + 2] = b.pos.z;
        pos[n * 6 + 3] = x2; pos[n * 6 + 4] = y2; pos[n * 6 + 5] = z2;
        const c = b.team === 'blue' ? [1.0, .82, .46] : [1.0, .4, .27];
        col[n * 6] = c[0]; col[n * 6 + 1] = c[1]; col[n * 6 + 2] = c[2];
        col[n * 6 + 3] = c[0] * .5; col[n * 6 + 4] = c[1] * .5; col[n * 6 + 5] = c[2] * .5;
        n++;
      }
      this.tracerGeo.setDrawRange(0, n * 2);
      this.tracerGeo.attributes.position.needsUpdate = true;
      this.tracerGeo.attributes.color.needsUpdate = true;
    }

    muzzle(pos, color) {
      this.firePuff(pos, { size: U.rand(5, 10), endSize: 14, life: .08, alpha: .85, color: color || 0xffcf77, gravity: 0, drag: 1 });
    }

    hitSpark(pos, normal, team) {
      for (let i = 0; i < 3; i++) {
        this.firePuff(pos, {
          size: U.rand(2, 5), endSize: U.rand(5, 10), life: U.rand(.08, .24),
          velocity: new THREE.Vector3(U.rand(-25, 25), U.rand(-20, 30), U.rand(-25, 25)),
          color: 0xffd28c, alpha: .95, gravity: 0, drag: 2
        });
      }
      this.smokePuff(pos, { size: 2, endSize: 10, life: .9, alpha: .25, color: 0x59615d });
    }

    explosion(pos, scale = 1) {
      const s = scale || 1;
      for (let i = 0; i < 10; i++) {
        this.glow.add({
          position: pos.clone().add(new THREE.Vector3(U.rand(-5, 5), U.rand(-5, 5), U.rand(-5, 5))),
          velocity: new THREE.Vector3(U.rand(-30, 30), U.rand(5, 40), U.rand(-30, 30)),
          life: U.rand(.35, 1.0),
          size: U.rand(15, 32) * s,
          endSize: U.rand(45, 80) * s,
          alpha: .95, endAlpha: 0,
          drag: 2.0, gravity: 4, color: new THREE.Color(i % 2 ? 0xffa244 : 0xffd778)
        });
      }
      for (let i = 0; i < 12; i++) {
        this.smoke.add({
          position: pos.clone().add(new THREE.Vector3(U.rand(-8, 8), U.rand(-8, 8), U.rand(-8, 8))),
          velocity: new THREE.Vector3(U.rand(-20, 20), U.rand(-3, 22), U.rand(-20, 20)),
          life: U.rand(1.8, 4.2),
          size: U.rand(12, 24) * s,
          endSize: U.rand(50, 100) * s,
          alpha: .42, endAlpha: 0,
          drag: 1.1, gravity: .8, color: new THREE.Color(i % 3 ? 0x3e403e : 0x8a5d42)
        });
      }
      for (let i = 0; i < 4; i++) {
        this.firePuff(pos.clone().add(new THREE.Vector3(U.rand(-2, 2), U.rand(-2, 2), U.rand(-2, 2))), {
          size: U.rand(6, 12), endSize: 20, life: .25, color: 0xfff3cc, alpha: 1, gravity: 0, drag: 2
        });
      }
    }

    groundImpact(pos) {
      this.smokePuff(pos, { size: 7, endSize: 38, life: 2.6, alpha: .42, color: 0x7a705d, gravity: -.3 });
      this.firePuff(pos, { size: 10, endSize: 25, life: .4, color: 0xffc568, alpha: .7, gravity: 0 });
    }

    flareBurst(pos) {
      for (let i = 0; i < 2; i++) {
        const velocity = new THREE.Vector3(U.rand(-18, 18), U.rand(-4, 4), U.rand(-18, 18));
        this.glow.add({
          position: pos.clone(), velocity: velocity.clone(),
          life: U.rand(2.8, 4.5), size: 6, endSize: 3,
          alpha: 1, endAlpha: .1, drag: .3, gravity: 18, color: new THREE.Color(0xfff0a0)
        });
        this.smokePuff(pos, { size: 2, endSize: 15, life: 1.2, alpha: .18, color: 0xa9a49c, gravity: -1, drag: 1.5 });
      }
    }

    chaffBurst(pos) {
      for (let i = 0; i < 5; i++) {
        this.glow.add({
          position: pos.clone().add(new THREE.Vector3(U.rand(-6, 6), U.rand(-6, 6), U.rand(-6, 6))),
          velocity: new THREE.Vector3(U.rand(-8, 8), U.rand(-5, 5), U.rand(-8, 8)),
          life: U.rand(1.8, 3.2), size: 5, endSize: 13,
          alpha: .32, endAlpha: .03, drag: 1.8, gravity: 2,
          color: new THREE.Color(0xdfe9ed)
        });
      }
    }

    update(dt) {
      this.smoke.update(dt);
      this.glow.update(dt);
    }

    clear() {
      this.smoke.clear();
      this.glow.clear();
      this.tracerGeo.setDrawRange(0, 0);
    }
  }

  TS.Effects = Effects;
})(window);
