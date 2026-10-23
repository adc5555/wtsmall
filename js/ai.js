/* Thunder Skies - lightweight tactical AI: B&Z, beam/39, missiles, countermeasures */
(function (global) {
  'use strict';
  const TS = global.TS = global.TS || {};
  const U = TS.Utils;
  const UP = new THREE.Vector3(0, 1, 0);
  const _v = new THREE.Vector3();
  const _v2 = new THREE.Vector3();

  class AIController {
    constructor(game) {
      this.game = game;
    }

    updateAll(dt) {
      const game = this.game;
      for (const f of game.fighters) {
        if (!f.alive || f.isPlayer) continue;
        if (!f.ai) continue;
        f.ai.decisionTimer -= dt;
        if (f.ai.decisionTimer <= 0) {
          f.ai.decisionTimer = TS.CONFIG.AI.decisionInterval + Math.random() * .035;
          this.decide(f);
        }
        this.steer(f, dt);
        this.manageSystems(f, dt);
      }
    }

    liveEnemiesOf(f) {
      return this.game.fighters.filter(x => x.alive && x.team !== f.team);
    }

    targetThreatCount(f, target) {
      let n = 0;
      for (const a of this.game.fighters) {
        if (!a.alive || !a.ai || a.team !== f.team || a === f) continue;
        if (a.ai.target === target) n++;
      }
      return n;
    }

    chooseTarget(f) {
      const enemies = this.liveEnemiesOf(f);
      if (!enemies.length) return null;
      let visible = [];
      const isRadar = !!f.radar;
      const contacts = isRadar ? (f.radar.contacts || []).filter(c => !c.clutter) : null;
      if (isRadar) {
        for (const c of contacts) {
          if (c.fighter && c.fighter.alive) visible.push({ enemy: c.fighter, dist: c.dist });
        }
      }
      // visual acquisition
      for (const e of enemies) {
        const dist = f.pos.distanceTo(e.pos);
        if (dist < 8800 && this.game.world.getLosClear(f.pos, e.pos, 5)) {
          if (!visible.some(v => v.enemy === e)) visible.push({ enemy: e, dist });
        }
      }
      if (!visible.length) return null;
      visible.sort((a, b) => {
        const countA = this.targetThreatCount(f, a.enemy);
        const countB = this.targetThreatCount(f, b.enemy);
        const scoreA = a.dist + countA * 2600 + (a.enemy.isPlayer ? 450 : 0) + Math.random() * 500;
        const scoreB = b.dist + countB * 2600 + (b.enemy.isPlayer ? 450 : 0) + Math.random() * 500;
        return scoreA - scoreB;
      });
      // avoid dogpiling the same target when alternatives exist
      const least = visible.find(v => this.targetThreatCount(f, v.enemy) < 2);
      const best = least || visible[0];
      return best.enemy;
    }

    findIncomingMissile(f) {
      let best = null;
      for (const m of this.game.missiles) {
        if (!m.alive || m.target !== f) continue;
        const d = f.pos.distanceTo(m.pos);
        if (!best || d < best.dist) best = { missile: m, dist: d };
      }
      return best;
    }

    decide(f) {
      const AI = TS.CONFIG.AI;
      const ai = f.ai;
      let target = ai.target;
      if (!target || !target.alive || ai.targetAssignedAt == null || this.game.time - ai.targetAssignedAt > 7) {
        target = this.chooseTarget(f);
        ai.target = target;
        ai.targetAssignedAt = this.game.time;
        if (target && f.radar) {
          TS.Radar.attemptLock(f, target, this.game);
        }
      }
      if (!target) {
        ai.state = 'patrol';
        return;
      }
      if (f.radar && f.radar.lockTarget !== target) {
        // Re-attempt lock after radar loss; with a short delay.
        if (this.game.time - (f.radar.lastLockAttempt || -99) > 1.2) {
          TS.Radar.attemptLock(f, target, this.game);
        }
      }

      const dist = f.pos.distanceTo(target.pos);
      const altDiff = f.pos.y - target.pos.y;
      const incoming = this.findIncomingMissile(f);
      const irIncoming = incoming && incoming.missile.kind === 'ir' && incoming.dist < AI.flareReactionRange;
      const sarhIncoming = incoming && incoming.missile.kind === 'sarh';
      const rwrLocked = f.rwr && f.rwr.lockCount > 0;
      const now = this.game.time;

      // defensive priority
      if (irIncoming) {
        const breakDir = new THREE.Vector3().crossVectors(
          new THREE.Vector3().subVectors(incoming.missile.pos, f.pos).normalize(), UP
        ).normalize();
        if (breakDir.lengthSq() < .01) breakDir.set(1, 0, 0);
        ai.state = 'ir_break';
        ai.stateSince = now;
        ai.evadeDir.copy(breakDir).multiplyScalar(ai.beamSide);
        if (f.flares > 0 && (f.ai.flareTimer || 0) <= now) {
          this.game.combat.deployFlares(f);
          f.ai.flareTimer = now + .9;
        }
        ai.throttleTarget = 110;
        ai.desired = f.forward.clone().multiplyScalar(.3).addScaledVector(ai.evadeDir, .8).add(new THREE.Vector3(0, .15, 0)).normalize();
        ai.state = 'ir_break';
        return;
      }
      if (sarhIncoming || (rwrLocked && !incoming && f.rwr.missileWarning)) {
        const threatPos = sarhIncoming ? incoming.missile.pos : (f.rwr.threats[0] ? f.rwr.threats[0].fighter?.pos : target.pos);
        const away = new THREE.Vector3().subVectors(threatPos || target.pos, f.pos).setY(0).normalize();
        const beam = new THREE.Vector3().crossVectors(away, UP).normalize();
        if (beam.lengthSq() < .01) beam.set(1, 0, 0);
        ai.state = 'beam39';
        ai.stateSince = ai.stateSince || now;
        ai.evadeDir.copy(beam).multiplyScalar(ai.beamSide);
        if (!ai._beamStart || ai.state !== 'beam39') ai._beamStart = now;
        // chaff while keeping the threat at 90 degrees; dive toward clutter
        if (f.chaff > 0 && now - (ai.chaffTimer || 0) > 1.1) {
          this.game.combat.deployChaff(f);
          ai.chaffTimer = now;
        }
        const desired = new THREE.Vector3().copy(ai.evadeDir).setY(-.15).normalize();
        // Keep enough altitude, do not dive into terrain.
        const agl = f.pos.y - this.game.world.heightAt(f.pos.x, f.pos.z);
        if (agl < 500) desired.y = .22;
        ai.desired = desired;
        ai.throttleTarget = 110;
        return;
      }

      // normal offensive / B&Z state machine
      const desiredThrottleReady = f.boostSeconds < f.cfg.engine.maxBoostTime - 4 && f.heat < 125;
      if (ai.state === 'beam39' || ai.state === 'ir_break') {
        ai.state = 'setup';
        ai.stateSince = now;
      }

      if (ai.state === 'extend' && now - (ai.stateSince || 0) < AI.bzExtendTime) {
        const away = new THREE.Vector3().subVectors(f.pos, target.pos).setY(0).normalize();
        const climb = new THREE.Vector3(0, .5, 0);
        ai.desired = away.multiplyScalar(.8).add(climb).normalize();
        ai.throttleTarget = desiredThrottleReady ? 110 : 100;
        this._tryMissiles(f, target, dist);
        return;
      }
      if (ai.state === 'extend') {
        ai.state = 'setup';
        ai.stateSince = now;
      }

      if (dist < 780 && ai.state === 'attack') {
        ai.state = 'extend';
        ai.stateSince = now;
        const away = new THREE.Vector3().subVectors(f.pos, target.pos).setY(0).normalize();
        ai.desired = away.multiplyScalar(.8).add(new THREE.Vector3(0, .3, 0)).normalize();
        ai.throttleTarget = desiredThrottleReady ? 110 : 100;
        return;
      }

      if (dist < 2300 && (altDiff > 170 || dist < 1050)) {
        ai.state = 'attack';
        ai.stateSince = ai.stateSince || now;
        const gunSpeed = f.cfg.guns.speed;
        const toTarget = new THREE.Vector3().subVectors(target.pos, f.pos);
        const tgo = U.clamp(toTarget.length() / Math.max(250, gunSpeed), 0, 2.2);
        const aim = target.pos.clone().addScaledVector(target.velocity, tgo * .65);
        // aim slightly above a climbing target to make the AI feel alive, not perfect
        const jitter = new THREE.Vector3(U.rand(-1, 1), U.rand(-1, 1), U.rand(-1, 1)).multiplyScalar(TS.CONFIG.AI.aimJitter * dist);
        ai.desired = aim.add(jitter).sub(f.pos).normalize();
        ai.throttleTarget = desiredThrottleReady && dist > 1400 ? 108 : 100;
        this._tryMissiles(f, target, dist);
      } else if (dist <= AI.bzAttackRange && altDiff >= AI.bzHeight) {
        ai.state = 'attack';
        ai.desired = new THREE.Vector3().subVectors(target.pos, f.pos).normalize();
        ai.throttleTarget = desiredThrottleReady ? 108 : 100;
        this._tryMissiles(f, target, dist);
      } else {
        ai.state = 'setup';
        const climbBias = U.clamp((target.pos.y + AI.bzHeight - f.pos.y) / 1600, -.25, .8);
        const towards = new THREE.Vector3().subVectors(target.pos, f.pos).setY(0).normalize();
        ai.desired = towards.add(new THREE.Vector3(0, climbBias, 0)).normalize();
        ai.throttleTarget = desiredThrottleReady ? 108 : 100;
        this._tryMissiles(f, target, dist);
      }

      // ground avoidance always wins
      const agl = f.pos.y - this.game.world.heightAt(f.pos.x, f.pos.z);
      if (agl < 360 || (ai.desired && ai.desired.y < -.2 && agl < 760)) {
        const away = ai.desired ? new THREE.Vector3(ai.desired.x, 0, ai.desired.z).normalize() : f.forward.clone().setY(0).normalize();
        ai.desired = away.multiplyScalar(.55).add(new THREE.Vector3(0, 1.3, 0)).normalize();
        ai.throttleTarget = 105;
      }
      const radius = Math.hypot(f.pos.x, f.pos.z);
      if (radius > 16500) {
        ai.desired = new THREE.Vector3(-f.pos.x, .15, -f.pos.z).normalize();
      }
      ai.stateSince = ai.stateSince || now;
    }

    _tryMissiles(f, target, dist) {
      if (!f.cfg.missiles || !target || !f.radar) return;
      const now = this.game.time;
      if (now < (f.ai.missileTimer || 0)) return;
      const active = this.game.missiles.filter(m => m.alive && m.team === f.team).length;
      if (active >= TS.CONFIG.AI.maxTeamActiveMissiles) return;
      const angle = TS.MissileHelper.angleOffBoresight(f, target);
      // radar missile at range, keeping lock; IR as a closer follow-up
      if (dist > 2100 && dist < 8600 && angle < .55 && f.missileCounts.sarh > 0 &&
          f.radar.lockValid && f.radar.lockTarget === target) {
        const check = TS.MissileHelper.canLaunch(this.game, f, target, 'sarh');
        if (check.ok && Math.random() < .55) {
          this.game.combat.fireMissile(f, 'sarh', target);
          f.ai.missileTimer = now + TS.CONFIG.AI.sarhCooldown + Math.random() * 3;
          return;
        }
      }
      if (dist < 4700 && angle < .5 && f.missileCounts.ir > 0) {
        const check = TS.MissileHelper.canLaunch(this.game, f, target, 'ir');
        if (check.ok && Math.random() < .35) {
          this.game.combat.fireMissile(f, 'ir', target);
          f.ai.missileTimer = now + TS.CONFIG.AI.missileCooldown + Math.random() * 3;
        }
      }
    }

    steer(f, dt) {
      const ai = f.ai;
      let desired = ai.desired;
      if (!desired) {
        desired = f.forward.clone();
      }
      const agl = f.pos.y - this.game.world.heightAt(f.pos.x, f.pos.z);
      if (agl < 220) {
        desired = f.forward.clone().setY(0).normalize().multiplyScalar(.3).add(new THREE.Vector3(0, 1, 0)).normalize();
      }
      const skill = TS.CONFIG.AI.skillTurn * (ai.state === 'beam39' || ai.state === 'ir_break' ? 1.1 : 1);
      f.steerToward(desired, dt, skill, 1);
      const targetThrottle = ai.throttleTarget == null ? 100 : ai.throttleTarget;
      if (f.boostSeconds >= f.cfg.engine.maxBoostTime - 1) {
        f.applyAutoThrottle(dt, 98);
      } else {
        f.applyAutoThrottle(dt, targetThrottle * TS.CONFIG.AI.skillThrottle * (f.modules.engine / f.moduleMax.engine));
      }
    }

    manageSystems(f, dt) {
      const ai = f.ai;
      const target = ai.target;
      if (!target || !target.alive) {
        if (f.isPlayer) this.game.combat.fireGuns(f, false, dt);
        return;
      }
      const now = this.game.time;
      const dist = f.pos.distanceTo(target.pos);
      const toTarget = new THREE.Vector3().subVectors(target.pos, f.pos);
      const angle = f.forward.angleTo(toTarget.normalize());
      if (ai.state === 'attack' && dist < (f.cfg.guns? 1000 : 1000) && angle < TS.CONFIG.AI.fireAngle + .025) {
        // burst discipline
        if (!ai.burstOn && now >= (ai.nextBurst || 0)) {
          ai.burstOn = true;
          ai.burstEnd = now + U.rand(.45, 1.1);
          ai.nextBurst = ai.burstEnd + U.rand(.8, 1.8);
        }
        if (ai.burstOn && now > ai.burstEnd) ai.burstOn = false;
        this.game.combat.fireGuns(f, ai.burstOn, dt);
      } else {
        ai.burstOn = false;
        this.game.combat.fireGuns(f, false, dt);
      }

      // Periodically pre-empt a radar lock, but do not waste all chaff at extreme
      // range before the fight has actually closed.
      if (f.rwr && f.rwr.status === 'LOCKED' && f.chaff > 0 && dist < 14000 &&
          now - (ai.chaffSweep || 0) > 2.0) {
        this.game.combat.deployChaff(f);
        ai.chaffSweep = now;
      }
    }
  }

  TS.AIController = AIController;
})(window);
