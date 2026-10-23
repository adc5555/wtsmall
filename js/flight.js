/* Thunder Skies - aircraft entity, engine and arcade flight model */
(function (global) {
  'use strict';
  const TS = global.TS = global.TS || {};
  const U = TS.Utils;

  const X_AXIS = new THREE.Vector3(1, 0, 0);
  const Y_AXIS = new THREE.Vector3(0, 1, 0);
  const Z_AXIS = new THREE.Vector3(0, 0, 1);

  function sampleCurve(curve, alt) {
    if (!curve || !curve.length) return 1;
    if (alt <= curve[0][0]) return curve[0][1];
    for (let i = 1; i < curve.length; i++) {
      if (alt <= curve[i][0]) {
        const a = curve[i - 1], b = curve[i];
        return U.lerp(a[1], b[1], (alt - a[0]) / (b[0] - a[0]));
      }
    }
    return curve[curve.length - 1][1];
  }

  class Fighter {
    constructor(game, spec) {
      this.game = game;
      this.aircraftId = spec.aircraftId;
      this.cfg = TS.CONFIG.getAircraft(spec.aircraftId);
      this.team = spec.team;
      this.teamColor = TS.CONFIG.teamColor(spec.team);
      this.callsign = spec.callsign || 'BANDIT';
      this.isPlayer = !!spec.isPlayer;
      this.id = spec.id || (this.team + '-' + this.callsign);
      this.alive = true;
      this.killed = false;
      this.kills = 0;
      this.deaths = 0;
      this.score = 0;
      this.lastDamageAt = -99;
      this.lastAttacker = null;
      this.deathTimer = 0;
      this.deathSpin = new THREE.Vector3(U.rand(-2, 2), U.rand(-2, 2), U.rand(-1, 1));

      const alt = spec.altitude == null ? TS.CONFIG.MATCH.altitudes[this.aircraftId] : spec.altitude;
      this.pos = new THREE.Vector3(spec.x || 0, alt, spec.z || 0);
      this.prevPos = this.pos.clone();
      this.quaternion = new THREE.Quaternion();
      this.forward = new THREE.Vector3(0, 0, -1);
      this.up = new THREE.Vector3(0, 1, 0);
      this.right = new THREE.Vector3(1, 0, 0);
      this.velocity = new THREE.Vector3();
      this.orientFromYaw(spec.yaw == null ? 0 : spec.yaw, 0);
      this.speed = spec.speed || 150;
      this.throttle = spec.throttle == null ? this.cfg.startThrottle : spec.throttle;
      this.spool = this.throttle / 100;
      this.rate = { pitch: 0, yaw: 0, roll: 0 };
      this.controlInputs = { pitch: 0, yaw: 0, roll: 0 };
      this.engineTemp = 42;
      this.heat = 42;
      this.boostSeconds = 0;
      this.boostExceeded = false;
      this.engineOut = false;
      this.enginePower = 0;
      this.boostActive = false;
      this.propPhase = 0;
      this.damageSmokeTimer = 0;
      this.contrailTimer = 0;
      this.afterburnerOn = false;

      this.modules = {};
      this.moduleMax = Object.assign({}, this.cfg.modules.max);
      for (const k in this.moduleMax) this.modules[k] = this.moduleMax[k];
      this.destroyed = { leftWing: false, rightWing: false, tail: false };
      this.hitboxes = this.cfg.modules.hitboxes;

      this.gunAmmo = this.cfg.guns.ammo;
      this.gunCooldown = 0;
      this.gunIndex = 0;
      this.missileCounts = {
        ir: this.cfg.missiles ? this.cfg.missiles.ir : 0,
        sarh: this.cfg.missiles ? this.cfg.missiles.sarh : 0
      };
      this.missileCooldown = 0;
      this.selectedMissile = 'ir';
      this.lastMissile = null;
      this.flares = 0;
      this.chaff = 0;
      if (this.cfg.countermeasures) {
        if (this.isPlayer) {
          this.flares = TS.Settings.cmFlare;
          this.chaff = TS.Settings.getCmChaff();
        } else {
          this.flares = this.cfg.countermeasures.total / 2;
          this.chaff = this.cfg.countermeasures.total / 2;
        }
      }
      this.cmCooldown = 0;

      this.radar = this.cfg.radar ? {
        contacts: [],
        scanTimer: 0,
        lockTarget: null,
        lockValid: false,
        lockAge: 0,
        chaffTimer: 0,
        signalNoise: 0,
        lastLockAttempt: -99
      } : null;
      this.rwr = this.cfg.rwr ? {
        threats: [],
        lockCount: 0,
        missileWarning: false,
        missileThreat: null,
        lastBeep: -99,
        lastLaunchBeep: -99,
        status: 'CLEAR'
      } : null;

      this.selectedTarget = null;
      this.radarOnlyTarget = null;
      this.ai = {
        state: 'setup', target: null, decisionTimer: 0, extendTimer: 0,
        fireTimer: 0, burstTimer: 0, burstOn: false, missileTimer: 0,
        flareTimer: 0, chaffTimer: 0, beamSide: U.randomSign(),
        lastStateTime: 0, evadeDir: new THREE.Vector3(0, 0, -1),
        targetAssignedAt: 0
      };

      this.hitRadius = 8.5;
      this.visual = TS.Models.createAircraftModel(this.aircraftId, this.team);
      this.model = this.visual;
      this.model.group.position.copy(this.pos);
      this.model.group.quaternion.copy(this.quaternion);
      game.world.activeFightersGroup.add(this.model.group);
      this.updateVisual(0);
    }

    orientFromYaw(yaw, pitch = 0) {
      const forward = new THREE.Vector3(
        Math.sin(yaw) * Math.cos(pitch),
        Math.sin(pitch),
        -Math.cos(yaw) * Math.cos(pitch)
      ).normalize();
      U.makeBasisQuaternion(forward, Y_AXIS, 0, this.quaternion);
      this.forward.copy(forward);
      this.up.set(0, 1, 0).applyQuaternion(this.quaternion);
      this.right.set(1, 0, 0).applyQuaternion(this.quaternion);
    }

    getForward(out) {
      out = out || new THREE.Vector3();
      return out.set(0, 0, -1).applyQuaternion(this.quaternion);
    }
    getUp(out) {
      out = out || new THREE.Vector3();
      return out.set(0, 1, 0).applyQuaternion(this.quaternion);
    }
    getRight(out) {
      out = out || new THREE.Vector3();
      return out.set(1, 0, 0).applyQuaternion(this.quaternion);
    }
    getVelocity(out) {
      out = out || new THREE.Vector3();
      return out.copy(this.forward).multiplyScalar(this.speed);
    }
    getHeading() {
      return U.headingFromForward(this.forward);
    }
    getBankAngle() {
      const right = this.getRight(new THREE.Vector3());
      const up = this.getUp(new THREE.Vector3());
      return Math.atan2(-right.y, up.y);
    }
    getAltitudeAGL(world) {
      return this.pos.y - world.heightAt(this.pos.x, this.pos.z);
    }
    getModuleRatio(name) {
      return U.clamp(this.modules[name] / this.moduleMax[name], 0, 1);
    }
    getEngineHealthRatio() {
      return U.clamp(this.modules.engine / this.moduleMax.engine, 0, 1);
    }
    isDisabled() {
      return !this.alive;
    }

    updateEngine(dt) {
      const eng = this.cfg.engine;
      const throttle = this.throttle;
      const boostFrac = U.clamp((throttle - 100) / 10, 0, 1);
      this.boostActive = throttle > 100.05 && !this.engineOut;
      this.afterburnerOn = this.boostActive;
      const health = U.clamp(this.modules.engine / this.moduleMax.engine, 0, 1);
      if (health <= 0.001) {
        this.engineOut = true;
        this.enginePower = 0;
      }
      this.spool = U.damp(this.spool, U.clamp(throttle / 100, 0, 1.1), throttle > this.spool * 100 ? eng.spoolUp : eng.spoolDown, dt);

      if (this.boostActive && !this.engineOut) {
        this.boostSeconds += dt;
        if (this.boostSeconds > eng.maxBoostTime) {
          this.boostExceeded = true;
          this.heat = Math.min(160, (this.heat || 40) + 21 * dt);
          this.modules.engine = Math.max(0, this.modules.engine - eng.overheatDamageRate * dt);
        } else {
          this.heat = U.damp(this.heat || 40, 72 + 34 * (this.boostSeconds / eng.maxBoostTime), 1.4, dt);
        }
      } else {
        this.boostExceeded = false;
        this.heat = U.damp(this.heat || 42, 42, 0.42, dt);
        this.boostSeconds = Math.max(0, this.boostSeconds - dt * (0.65 + this.spool * 0.4));
      }
      if (this.heat > 135) {
        this.modules.engine = Math.max(0, this.modules.engine - eng.overheatDamageRate * 1.8 * dt);
      }
      if (this.modules.engine <= 0.001) {
        this.engineOut = true;
        this.enginePower = 0;
      }
      const altFactor = sampleCurve(eng.altitudeCurve, this.pos.y);
      const health2 = U.clamp(this.modules.engine / this.moduleMax.engine, 0, 1);
      this.enginePower = this.engineOut ? 0 : altFactor * health2 * U.clamp(this.spool, 0, 1.1) * 100;
      this.engineHeat = this.heat;
      if (this.modules.engine / this.moduleMax.engine < .28) this.engineOut = true;
    }

    updateSpeed(dt) {
      const eng = this.cfg.engine;
      const altFactor = sampleCurve(eng.altitudeCurve, this.pos.y);
      const density = Math.exp(-Math.max(0, this.pos.y) / 8500);
      const health = U.clamp(this.modules.engine / this.moduleMax.engine, .0, 1);
      const engineOutFactor = this.engineOut ? 0 : 1;
      const boostFrac = U.clamp((this.throttle - 100) / 10, 0, 1);
      const thrust = eng.thrust * altFactor * (this.spool) * health * engineOutFactor *
        (1 + boostFrac * (eng.boostThrustMul - 1));
      // Density has a softened effect on drag in the arcade model. This keeps
      // high-altitude true airspeed in a believable band instead of ballooning
      // toward thin-air values.
      const drag = eng.dragK * Math.pow(density, .6) * this.speed * this.speed;
      const controlLoad = (Math.abs(this.rate.pitch) / this.cfg.flight.pitchRate +
        Math.abs(this.rate.yaw) / this.cfg.flight.yawRate * .55);
      const induced = controlLoad * (this.speed / 200) * 1.3;
      const gravity = 9.81 * Math.max(-1, Math.min(1, this.forward.y)) * .82;
      let accel = thrust - drag - gravity - induced;
      if (this.modules.tail / this.moduleMax.tail < .25) accel -= 2.5;
      this.speed = U.clamp(this.speed + accel * dt, 20, 520);
      if (!this.alive) this.speed = Math.max(10, this.speed - 8 * dt);
    }

    applyControl(pitch, yaw, roll, dt, rateScale = 1) {
      const flight = this.cfg.flight;
      // Keep the arcade model out of the pitch singularity. This also prevents
      // the bank controller and chase camera from spinning when aiming far up/down.
      if (this.forward.y > .93 && pitch > 0) pitch = 0;
      if (this.forward.y < -.93 && pitch < 0) pitch = 0;
      const stallFactor = U.clamp(this.speed / Math.max(40, flight.stallSpeed * 1.5), .28, 1.15);
      const tailFactor = U.clamp(this.modules.tail / this.moduleMax.tail, .15, 1);
      const wingFactorL = U.clamp(this.modules.leftWing / this.moduleMax.leftWing, 0, 1);
      const wingFactorR = U.clamp(this.modules.rightWing / this.moduleMax.rightWing, 0, 1);
      const wingsFactor = .55 + .45 * Math.min(wingFactorL, wingFactorR);
      const ctl = U.clamp(stallFactor * tailFactor * wingsFactor * rateScale, .12, 1.15);
      const targetPitch = U.clamp(pitch, -1, 1) * flight.pitchRate * ctl;
      const targetYaw = U.clamp(yaw, -1, 1) * flight.yawRate * ctl;
      const targetRoll = U.clamp(roll, -1, 1) * flight.rollRate * ctl;
      this.rate.pitch = U.damp(this.rate.pitch, targetPitch, flight.pitchAccel, dt);
      this.rate.yaw = U.damp(this.rate.yaw, targetYaw, flight.yawAccel, dt);
      this.rate.roll = U.damp(this.rate.roll, targetRoll, flight.rollAccel, dt);
      this.rotateRates(dt);
      // asymmetric damage roll bias
      if (wingFactorL < .52 || wingFactorR < .52) {
        const bias = (wingFactorR - wingFactorL) * .65;
        this.rotateLocalRoll(bias * dt);
        this.rate.roll += bias * .25;
      }
    }

    rotateRates(dt) {
      if (!this.rate) return;
      const qPitch = new THREE.Quaternion().setFromAxisAngle(X_AXIS, this.rate.pitch * dt);
      const qYaw = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, -this.rate.yaw * dt);
      const qRoll = new THREE.Quaternion().setFromAxisAngle(Z_AXIS, -this.rate.roll * dt);
      const dq = new THREE.Quaternion().multiplyQuaternions(qPitch, qYaw).multiply(qRoll).normalize();
      this.quaternion.multiply(dq).normalize();
      this.updateAxes();
    }

    rotateLocalRoll(angle) {
      const dq = new THREE.Quaternion().setFromAxisAngle(Z_AXIS, angle);
      this.quaternion.multiply(dq).normalize();
      this.updateAxes();
    }

    bankToward(targetBank, dt, rateScale = 1) {
      const worldUp = Y_AXIS;
      const dot = this.forward.dot(worldUp);
      if (Math.abs(dot) > .96) return;
      const levelUp = worldUp.clone().addScaledVector(this.forward, -dot);
      if (levelUp.lengthSq() < .001) return;
      levelUp.normalize();
      const targetUp = levelUp.applyAxisAngle(this.forward, targetBank).normalize();
      const cross = new THREE.Vector3().crossVectors(this.up, targetUp);
      const sin = this.forward.dot(cross);
      const cos = this.up.dot(targetUp);
      if (Math.abs(sin) < .0004 && cos > 0) return;
      const angle = Math.atan2(sin, cos);
      const max = this.cfg.flight.rollRate * 1.2 * rateScale * dt;
      const step = U.clamp(angle, -max, max);
      if (Math.abs(step) < 1e-5) return;
      const q = new THREE.Quaternion().setFromAxisAngle(this.forward, step);
      this.quaternion.premultiply(q).normalize();
      this.updateAxes();
    }

    levelWings(dt, rateScale = 1) {
      this.bankToward(0, dt, rateScale);
    }

    updateAxes() {
      this.forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
      this.up.set(0, 1, 0).applyQuaternion(this.quaternion).normalize();
      this.right.set(1, 0, 0).applyQuaternion(this.quaternion).normalize();
    }

    steerToward(desiredDir, dt, rateScale = 1, bankScale = 1) {
      if (desiredDir.lengthSq() < .001) return;
      desiredDir = desiredDir.clone().normalize();
      const crossY = new THREE.Vector3().crossVectors(this.forward, desiredDir).y;
      const bank = U.clamp(crossY * 2.6, -.9, .9) * bankScale;
      const targetQ = U.makeBasisQuaternion(desiredDir, Y_AXIS, bank, new THREE.Quaternion());
      const angle = this.forward.angleTo(desiredDir);
      const maxStep = this.cfg.flight.pitchRate * .9 * rateScale * dt * (1 + Math.min(.4, angle * .25));
      this.quaternion.rotateTowards(targetQ, Math.max(.0001, maxStep));
      this.updateAxes();
      this.rate.pitch = U.damp(this.rate.pitch, 0, 3, dt);
      this.rate.yaw = U.damp(this.rate.yaw, 0, 3, dt);
      this.rate.roll = U.damp(this.rate.roll, 0, 3, dt);
    }

    applyAutoThrottle(dt, targetThrottle) {
      const diff = targetThrottle - this.throttle;
      const rate = 38;
      this.throttle += U.clamp(diff, -rate * dt, rate * dt);
      this.throttle = U.clamp(this.throttle, 0, 110);
    }

    enforcePitchLimit() {
      const limit = .90; // about 64 degrees; avoids the camera/controller singularity
      const f = this.forward;
      if (Math.abs(f.y) <= limit) return;
      const current = Math.asin(U.clamp(f.y, -1, 1));
      const target = Math.sign(f.y) * Math.asin(limit);
      const delta = target - current;
      if (Math.abs(delta) < 1e-5) return;
      const q = new THREE.Quaternion().setFromAxisAngle(X_AXIS, delta);
      this.quaternion.multiply(q).normalize();
      this.updateAxes();
    }

    update(dt) {
      this.prevPos.copy(this.pos);
      this.enforcePitchLimit();
      this.updateEngine(dt);
      this.updateSpeed(dt);
      this.forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
      this.up.set(0, 1, 0).applyQuaternion(this.quaternion).normalize();
      this.right.set(1, 0, 0).applyQuaternion(this.quaternion).normalize();
      let vx = this.forward.x * this.speed;
      let vy = this.forward.y * this.speed;
      let vz = this.forward.z * this.speed;
      const altFactor = sampleCurve(this.cfg.engine.altitudeCurve, this.pos.y);
      const health = U.clamp(this.modules.engine / this.moduleMax.engine, 0, 1);
      const climbCap = this.cfg.flight.maxClimbRate * (0.45 + 0.55 * U.clamp(altFactor * health * this.spool, 0, 1));
      if (vy > climbCap) vy = climbCap;
      this.velocity.set(vx, vy, vz);
      this.pos.x += vx * dt;
      this.pos.y += vy * dt;
      this.pos.z += vz * dt;
      this.model.group.position.copy(this.pos);
      this.model.group.quaternion.copy(this.quaternion);
      this.gunCooldown = Math.max(0, this.gunCooldown - dt);
      this.missileCooldown = Math.max(0, this.missileCooldown - dt);
      this.cmCooldown = Math.max(0, this.cmCooldown - dt);
      this.updateVisual(dt);
    }

    updateVisual(dt) {
      if (!this.model) return;
      const spin = (this.engineOut ? 0 : 30 + this.throttle * .8) * (this.aircraftId === 'p51' ? 1 : 0);
      this.propPhase += spin * dt;
      TS.Models.updateAircraftVisual(this.model, {
        propSpin: spin,
        throttle: this.engineOut ? 0 : this.throttle,
        boostActive: this.boostActive && !this.engineOut,
        alive: this.alive,
        engineOut: this.engineOut,
        leftWingDestroyed: this.destroyed.leftWing,
        rightWingDestroyed: this.destroyed.rightWing,
        tailDestroyed: this.destroyed.tail,
        missiles: this.missileCounts
      }, dt);
      if (this.model.parts.prop) this.model.parts.prop.rotation.z = this.propPhase;
    }

    hideModel() {
      if (this.model) this.model.group.visible = false;
    }

    getMuzzleWorld(index = 0) {
      const offsets = this.cfg.guns.muzzleOffsets;
      const o = offsets[(index || 0) % offsets.length];
      return new THREE.Vector3(o[0], o[1], o[2]).applyQuaternion(this.quaternion).add(this.pos)
        .addScaledVector(this.forward, 0.1);
    }

    getMissileHardpoint(kind, index) {
      const X = this.aircraftId;
      let x = 0, y = -.5, z = 1;
      if (X === 'f4e') {
        if (kind === 'ir') {
          const positions = [[-4.0, -.5, 1.2], [4.0, -.5, 1.2], [-4.0, -.5, 2.5], [4.0, -.5, 2.5]];
          const p = positions[index % positions.length];
          x = p[0]; y = p[1]; z = p[2];
        } else {
          const positions = [[-2.55, -.7, .5], [2.55, -.7, .5]];
          const p = positions[index % positions.length];
          x = p[0]; y = p[1]; z = p[2];
        }
      }
      return new THREE.Vector3(x, y, z).applyQuaternion(this.quaternion).add(this.pos);
    }

    takeHit(module, damage, attacker, hitPoint) {
      if (!this.alive) return;
      this.modules[module] = Math.max(0, this.modules[module] - damage);
      this.lastDamageAt = this.game ? this.game.time : 0;
      if (attacker) this.lastAttacker = attacker;
      if (module === 'fuselage') {
        const engineChance = .28;
        this.modules.engine = Math.max(0, this.modules.engine - damage * engineChance);
      }
      if (module === 'leftWing' && this.modules.leftWing <= 0 && !this.destroyed.leftWing) {
        this.destroyed.leftWing = true;
        this.game.onWingDestroyed(this, 'left', attacker);
      }
      if (module === 'rightWing' && this.modules.rightWing <= 0 && !this.destroyed.rightWing) {
        this.destroyed.rightWing = true;
        this.game.onWingDestroyed(this, 'right', attacker);
      }
      if (module === 'tail' && this.modules.tail <= 0 && !this.destroyed.tail) {
        this.destroyed.tail = true;
        this.game.onStructuralLoss(this, attacker, '尾翼断裂');
      }
      if (this.modules.fuselage <= 0) {
        this.game.onFighterDestroyed(this, attacker, '机体结构损毁');
      }
      if (this.modules.engine <= 0) this.engineOut = true;
    }

    getDamageSummary() {
      return {
        fuselage: this.getModuleRatio('fuselage'),
        leftWing: this.getModuleRatio('leftWing'),
        rightWing: this.getModuleRatio('rightWing'),
        tail: this.getModuleRatio('tail'),
        engine: this.getModuleRatio('engine')
      };
    }

    serialize() {
      return {
        id: this.id,
        team: this.team,
        callsign: this.callsign,
        isPlayer: this.isPlayer,
        aircraftId: this.aircraftId,
        pos: { x: this.pos.x, y: this.pos.y, z: this.pos.z },
        speed: this.speed,
        heading: this.getHeading(),
        throttle: this.throttle,
        boostSeconds: this.boostSeconds,
        engineTemp: this.heat,
        enginePower: this.enginePower,
        alive: this.alive,
        modules: this.getDamageSummary(),
        flares: this.flares,
        chaff: this.chaff,
        missiles: Object.assign({}, this.missileCounts),
        gunAmmo: this.gunAmmo,
        selectedTarget: this.selectedTarget ? this.selectedTarget.id : null,
        radarLock: this.radar && this.radar.lockTarget ? this.radar.lockTarget.id : null,
        aiState: this.ai.state
      };
    }
  }

  TS.Fighter = Fighter;
  TS.sampleEngineCurve = sampleCurve;
})(window);
