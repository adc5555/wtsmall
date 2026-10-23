/* Thunder Skies - physically simplified but energetic air-to-air missiles */
(function (global) {
  'use strict';
  const TS = global.TS = global.TS || {};
  const U = TS.Utils;
  const Y_UP = new THREE.Vector3(0, 1, 0);

  function aspectFactor(owner, target) {
    const toOwner = new THREE.Vector3().subVectors(owner.pos, target.pos).normalize();
    const dot = target.forward.dot(toOwner);
    return U.clamp((1 - dot) * .5, 0, 1); // 1 = rear aspect, 0 = head-on
  }

  const MissileHelper = {
    aspectFactor,

    irRange(owner, target) {
      const cfg = TS.CONFIG.MISSILES.ir;
      const aspect = aspectFactor(owner, target);
      let range = U.lerp(cfg.rangeFront, cfg.rangeRear, aspect);
      if (target.throttle > 100 || target.afterburnerOn) range += cfg.afterburnerBonus * (.35 + .65 * aspect);
      if (target.engineOut) range *= .55;
      return range;
    },

    rangeFor(owner, target, kind) {
      if (kind === 'ir') return this.irRange(owner, target);
      return TS.CONFIG.MISSILES.sarh.rangeRear;
    },

    angleOffBoresight(owner, target) {
      const dir = new THREE.Vector3().subVectors(target.pos, owner.pos).normalize();
      return owner.forward.angleTo(dir);
    },

    canLaunch(game, owner, target, kind) {
      const cfg = TS.CONFIG.MISSILES[kind];
      if (!owner || !target || !owner.alive || !target.alive) return { ok: false, reason: '无有效目标' };
      if (!cfg) return { ok: false, reason: '未知弹种' };
      if ((owner.missileCounts[kind] || 0) <= 0) return { ok: false, reason: '导弹已用尽' };
      if (owner.missileCooldown > 0) return { ok: false, reason: '挂架冷却中' };
      const dist = owner.pos.distanceTo(target.pos);
      const maxRange = this.rangeFor(owner, target, kind);
      const minRange = cfg.minRange;
      if (dist < minRange) return { ok: false, reason: '距离过近' };
      if (dist > maxRange) return { ok: false, reason: kind === 'ir' ? '红外锁定距离外' : '雷达弹射程外' };
      const off = this.angleOffBoresight(owner, target);
      if (off > cfg.launchAngle) return { ok: false, reason: '目标不在发射包线' };
      if (kind === 'sarh') {
        if (!owner.radar || !owner.radar.lockTarget || owner.radar.lockTarget !== target || !owner.radar.lockValid) {
          return { ok: false, reason: '需要稳定雷达锁定' };
        }
        if (!game.world.getLosClear(owner.pos, target.pos, 6)) return { ok: false, reason: '目标被地形遮挡' };
      }
      if (kind === 'ir' && target.engineOut && dist > 2200) return { ok: false, reason: '目标热信号不足' };
      return { ok: true, distance: dist, maxRange };
    }
  };

  class Missile {
    constructor(game, owner, target, kind, index) {
      this.game = game;
      this.cfg = TS.CONFIG.MISSILES[kind];
      this.kind = kind;
      this.owner = owner;
      this.team = owner.team;
      this.target = target;
      this.initialTarget = target;
      this.age = 0;
      this.alive = true;
      this.armed = false;
      this.ignitionDelay = .18;
      this.mass = this.cfg.mass;
      this.initialMass = this.cfg.mass;
      this.dryMass = this.cfg.dryMass;
      this.phase = 'launch';
      this.guidanceValid = true;
      this.guidanceLostTime = 0;
      this.seekerLost = false;
      this.decoy = false;
      this.trailTimer = 0;
      this.smokeTimer = 0;
      this.id = 'msl-' + Math.random().toString(36).slice(2, 8);
      this.pos = owner.getMissileHardpoint(kind, index == null ? Math.max(0, (owner.missileCounts[kind] || 1) - 1) : index);
      this.prevPos = this.pos.clone();
      this.velocity = owner.getVelocity(new THREE.Vector3()).addScaledVector(owner.forward, 28);
      this.initialSpeed = this.velocity.length();
      this.speed = this.velocity.length();
      this.mesh = TS.Models.createMissileEntityMesh(kind);
      this.mesh.position.copy(this.pos);
      game.world.scene.add(this.mesh);
      this.alignMesh();
      this.flame = this.mesh.userData.glow;
      this.emitLaunchBurst();
    }

    alignMesh() {
      if (this.speed < .1) return;
      const dir = this.velocity.clone().normalize();
      U.makeBasisQuaternion(dir, Y_UP, 0, this.mesh.quaternion);
    }

    emitLaunchBurst() {
      if (!this.game.effects) return;
      this.game.effects.muzzle(this.pos, this.kind === 'ir' ? 0xffb765 : 0xffdf8d);
      this.game.effects.smokePuff(this.pos, {
        size: 3, endSize: 18, life: 1.4, alpha: .27, color: 0xd4dbd5, gravity: 0, drag: 1.5
      });
      if (this.game.audio) this.game.audio.missileLaunch();
    }

    burnTime() {
      const cfg = this.cfg;
      return Math.max(0.01, this.age - this.ignitionDelay);
    }

    motorState() {
      const b = this.burnTime();
      if (this.age < this.ignitionDelay) return 'launch';
      if (b < this.cfg.boostTime) return 'boost';
      if (b < this.cfg.boostTime + this.cfg.sustainTime) return 'sustain';
      return 'coast';
    }

    update(dt, game) {
      if (!this.alive) return;
      this.age += dt;
      this.prevPos.copy(this.pos);
      const prevAlive = this.alive;
      if (this.age > this.cfg.life) {
        this.detonate(game, null, true);
        return;
      }
      this.phase = this.motorState();
      const powered = this.phase === 'boost' || this.phase === 'sustain';
      this.armed = this.age >= this.cfg.armTime;

      // guidance target can be a flare decoy
      let gt = this.target;
      if (this.decoy) {
        if (!gt || gt.ttl <= 0 || gt.alive === false) {
          this.guidanceValid = false;
          this.guidanceLostTime += dt;
          if (this.guidanceLostTime > 1.2) {
            this.detonate(game, null, true);
            return;
          }
        }
      }
      if (gt && gt.alive !== false) {
        // flare seduction check
        if (!this.decoy && this.kind === 'ir' && this.armed) {
          this.checkFlares(game, dt);
          gt = this.target;
        }
        // seeker field of view
        const dir = this.velocity.clone().normalize();
        const toTarget = new THREE.Vector3().subVectors(gt.pos, this.pos);
        const dist = toTarget.length();
        const losAngle = dir.angleTo(toTarget.clone().normalize());
        if (losAngle > this.cfg.seekerFov) {
          this.guidanceLostTime += dt;
          if (this.guidanceLostTime > .72) this.guidanceValid = false;
        } else {
          if (!this.decoy) this.guidanceLostTime = Math.max(0, this.guidanceLostTime - dt * .8);
        }
        // SARH depends on the shooter's radar lock
        if (this.kind === 'sarh') {
          const shooterOk = this.owner.alive && this.owner.radar &&
            this.owner.radar.lockTarget === this.target && this.owner.radar.lockValid;
          if (!shooterOk) {
            this.guidanceLostTime += dt;
            if (this.guidanceLostTime > .9) this.guidanceValid = false;
          }
        }
        if (this.owner && !this.owner.alive) this.guidanceValid = false;

        if (this.guidanceValid) {
          this.steer(gt, dt, game);
        }
      } else {
        this.guidanceValid = false;
        this.guidanceLostTime += dt;
      }

      if (!this.guidanceValid && this.guidanceLostTime > (this.kind === 'sarh' ? 3.2 : 2.6) && this.burnTime() > this.cfg.boostTime + this.cfg.sustainTime) {
        this.detonate(game, null, true);
        return;
      }

      // propulsion, drag and gravity
      const dir = this.velocity.lengthSq() > .01 ? this.velocity.clone().normalize() : new THREE.Vector3(0, -1, 0);
      let thrust = 0;
      if (this.phase === 'boost') thrust = this.cfg.boostAccel;
      else if (this.phase === 'sustain') thrust = this.cfg.sustainAccel;

      const burnTotal = Math.max(.01, this.cfg.boostTime + this.cfg.sustainTime);
      const burnProgress = U.clamp(this.burnTime() / burnTotal, 0, 1);
      this.mass = this.dryMass + (this.initialMass - this.dryMass) * (1 - burnProgress);
      if (powered) thrust *= Math.pow(this.initialMass / Math.max(this.dryMass, this.mass), .22);

      const rho = Math.exp(-Math.max(0, this.pos.y) / 8500);
      const dragAccel = this.cfg.dragK * rho * this.speed * this.speed;
      this.velocity.addScaledVector(dir, thrust * dt);
      this.velocity.addScaledVector(dir, -dragAccel * dt);
      this.velocity.y -= 9.81 * dt;
      this.speed = this.velocity.length();
      if (this.speed > 1200) this.speed = 1200;
      if (this.speed < .1) this.speed = .1;

      this.pos.addScaledVector(this.velocity, dt);
      this.mesh.position.copy(this.pos);
      this.alignMesh();

      // visual motor / trails
      if (this.flame) {
        this.flame.visible = powered;
        if (powered) {
          const flicker = .72 + Math.random() * .5;
          this.flame.scale.set(flicker, flicker, .85 + Math.random() * .4);
        }
      }
      if (powered) {
        this.trailTimer -= dt;
        if (this.trailTimer <= 0) {
          this.trailTimer = this.cfg.rocketSmoke;
          game.effects.missileTrail(
            new THREE.Vector3().copy(this.pos).addScaledVector(dir, -1.5),
            this.kind,
            dt
          );
        }
      }

      // ground / ceiling
      const ground = game.world.heightAt(this.pos.x, this.pos.z);
      if (this.pos.y <= ground + 1) {
        this.detonate(game, null, false, true);
        return;
      }
      if (this.pos.y > 16000) { this.detonate(game, null, true); return; }

      // proximity / direct collision with enemy aircraft
      if (this.armed) {
        let closest = null;
        for (const f of game.fighters) {
          if (!f.alive || f.team === this.team) continue;
          const t = U.segmentSphere(this.prevPos, this.pos, f.pos, this.cfg.proxRadius + 4);
          if (t != null && (!closest || t < closest.t)) closest = { fighter: f, t };
        }
        if (closest) {
          this.detonate(game, closest.fighter, false, false, closest.fighter.pos);
          return;
        }
        if (this.decoy && this.target && this.target.alive !== false) {
          if (this.pos.distanceTo(this.target.pos) < 22) {
            this.detonate(game, null, true);
            return;
          }
        }
      }
      if (!this.alive && prevAlive) return;

      // keep a hard kill switch on extreme ballistic decay
      if (this.phase === 'coast' && this.speed < 42 && this.age > 5) {
        this.detonate(game, null, true);
      }
    }

    steer(gt, dt, game) {
      const targetVel = gt.velocity ? gt.velocity.clone() : new THREE.Vector3();
      const los = new THREE.Vector3().subVectors(gt.pos, this.pos);
      const dist = los.length();
      if (dist < .5) return;
      const closing = Math.max(40, this.speed + targetVel.dot(los.clone().normalize()) * .35);
      const tgo = U.clamp(dist / closing, .08, 7.5);
      const predicted = gt.pos.clone().addScaledVector(targetVel, tgo * .9);
      const desired = predicted.sub(this.pos).normalize();
      const dir = this.velocity.clone().normalize();
      const angle = dir.angleTo(desired);
      const rho = Math.exp(-Math.max(0, this.pos.y) / 8500);
      const q = U.clamp((rho * this.speed * this.speed) / (1.225 * 250 * 250), .12, 1.5);
      const availableG = this.cfg.maxG * Math.min(1, q);
      let maxTurn = (availableG * 9.81) / Math.max(70, this.speed);
      maxTurn = Math.min(maxTurn, 1.9);
      if (angle > .0002) {
        const axis = new THREE.Vector3().crossVectors(dir, desired);
        if (axis.lengthSq() > 1e-8) {
          const step = Math.min(angle, maxTurn * dt);
          const qTurn = new THREE.Quaternion().setFromAxisAngle(axis.normalize(), step);
          this.velocity.applyQuaternion(qTurn);
        }
      }
    }

    checkFlares(game, dt) {
      if (!this.armed) return;
      this.flareCheckTimer = (this.flareCheckTimer || 0) - dt;
      if (this.flareCheckTimer > 0) return;
      this.flareCheckTimer = .16;
      const dir = this.velocity.clone().normalize();
      let candidates = [];
      for (const f of game.flares) {
        if (!f.alive || f.team === this.team) continue;
        const v = new THREE.Vector3().subVectors(f.pos, this.pos);
        const d = v.length();
        if (d > 1800 || d < 2) continue;
        const a = dir.angleTo(v.normalize());
        if (a <= this.cfg.seekerFov * .9) {
          candidates.push({ flare: f, angle: a, dist: d });
        }
      }
      if (!candidates.length) return;
      candidates.sort((a, b) => a.angle - b.angle);
      const best = candidates[0];
      const flareFactor = this.cfg.flareSusceptibility *
        U.clamp(1.15 - best.angle / this.cfg.seekerFov, .1, 1) *
        U.clamp(1.15 - best.dist / 1800, .2, 1);
      if (Math.random() < flareFactor * .55) {
        this.target = best.flare;
        this.decoy = true;
        this.guidanceLostTime = 0;
        this.guidanceValid = true;
        if (this.owner && this.owner.isPlayer && game.toast) game.toast('红外弹被热诱弹诱骗');
      }
    }

    detonate(game, victim, silent, ground, hitPos) {
      if (!this.alive) return;
      this.alive = false;
      const pos = this.pos.clone();
      if (ground) {
        game.effects.groundImpact(pos);
        game.audio.explosion(.8);
      } else {
        game.effects.explosion(pos, victim ? .7 : .45);
        game.audio.explosion(victim ? .8 : .45);
        game.world.addShake(pos.distanceTo(game.player ? game.player.pos : pos) < 180 ? 1.5 : .3);
        if (victim && victim.alive) {
          TS.Damage.applyBlast(game, victim, this.cfg.damage, this.owner, hitPos || pos);
          if (this.owner && this.owner.isPlayer && game.toast) game.toast(this.kind === 'ir' ? '红外弹命中' : '雷达弹命中');
        }
        if (this.decoy && this.target && this.target.alive !== false) {
          this.target.alive = false;
          this.target.ttl = 0;
        }
      }
      this.mesh.visible = false;
      if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
      game.onMissileEnd(this);
    }
  }

  TS.Missile = Missile;
  TS.MissileHelper = MissileHelper;
})(window);
