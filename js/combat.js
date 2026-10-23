/* Thunder Skies - guns, missiles, countermeasures */
(function (global) {
  'use strict';
  const TS = global.TS = global.TS || {};
  const U = TS.Utils;

  const _tmp = new THREE.Vector3();
  const _tmp2 = new THREE.Vector3();

  class Combat {
    constructor(game) {
      this.game = game;
      this.bullets = [];
    }

    rateInterval(fighter) {
      return 1 / Math.max(1, fighter.cfg.guns.rate);
    }

    fireGuns(fighter, firing, dt) {
      if (!firing || !fighter.alive) {
        return;
      }
      if (fighter.gunAmmo <= 0 || fighter.gunCooldown > 0) return;
      const gun = fighter.cfg.guns;
      fighter.gunCooldown = this.rateInterval(fighter);
      fighter.gunAmmo = Math.max(0, fighter.gunAmmo - 1);
      const idx = fighter.gunIndex++;
      const origin = fighter.getMuzzleWorld(idx);
      const dir = fighter.forward.clone();
      const spread = gun.spread + (fighter.isPlayer ? 0 : .003);
      const rx = (Math.random() - .5) * 2 * spread;
      const ry = (Math.random() - .5) * 2 * spread;
      dir.addScaledVector(fighter.right, rx).addScaledVector(fighter.up, ry).normalize();
      const vel = fighter.velocity.clone().addScaledVector(dir, gun.speed);
      const bullet = {
        pos: origin.clone(), prev: origin.clone(),
        initial: origin.clone(),
        velocity: vel,
        dir: dir.clone(),
        team: fighter.team,
        owner: fighter,
        damage: gun.damage,
        life: gun.life,
        age: 0,
        alive: true,
        tracerColor: gun.tracer
      };
      this.bullets.push(bullet);
      if (this.bullets.length > 700) {
        this.bullets.shift();
      }
      if (this.game.effects) this.game.effects.muzzle(origin, gun.tracer);
      if (this.game.audio && fighter.isPlayer) this.game.audio.gunShot();
    }

    updateBullets(dt) {
      const list = this.bullets;
      const enemies = this.game.fighters;
      const world = this.game.world;
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        b.age += dt;
        b.prev.copy(b.pos);
        b.pos.addScaledVector(b.velocity, dt);
        if (b.age > b.life) { b.alive = false; }
        if (b.pos.y < world.heightAt(b.pos.x, b.pos.z)) {
          b.alive = false;
        }
        if (!b.alive) continue;
        // segment broad phase against opposing planes
        for (const f of enemies) {
          if (!f.alive || f.team === b.team) continue;
          if (U.segmentSphere(b.prev, b.pos, f.pos, f.hitRadius) == null) continue;
          const hit = TS.Damage.classifySegment(f, b.prev, b.pos);
          if (!hit) continue;
          b.alive = false;
          TS.Damage.applyGunHit(this.game, f, hit, b.damage, b.owner);
          if (this.game.effects) {
            this.game.effects.hitSpark(hit.world, f.pos, f.team);
          }
          if (b.owner && b.owner.isPlayer) {
            this.game.onPlayerHitConfirm(f, b.damage, hit.module);
            if (this.game.audio) this.game.audio.beep(1280, .018, .012, 'square');
          }
          break;
        }
      }
      this.bullets = list.filter(b => b.alive);
      if (this.game.effects) this.game.effects.updateTracers(this.bullets);
    }

    fireMissile(fighter, kind, target) {
      if (!fighter || !fighter.alive) return { ok: false, reason: '无法发射' };
      target = target || fighter.selectedTarget;
      const check = TS.MissileHelper.canLaunch(this.game, fighter, target, kind);
      if (!check.ok) {
        if (fighter.isPlayer) this.game.toast(check.reason);
        return check;
      }
      const teamActive = this.game.missiles.filter(m => m.alive && m.team === fighter.team).length;
      if (teamActive >= TS.CONFIG.AI.maxTeamActiveMissiles) {
        if (fighter.isPlayer) this.game.toast('导弹发射通道占用中');
        return { ok: false, reason: 'too-many' };
      }
      fighter.missileCounts[kind] = Math.max(0, fighter.missileCounts[kind] - 1);
      fighter.missileCooldown = kind === 'sarh' ? .95 : .7;
      const msl = new TS.Missile(this.game, fighter, target, kind, fighter.missileCounts[kind]);
      this.game.missiles.push(msl);
      fighter.lastMissile = msl;
      if (fighter.isPlayer) {
        this.game.audio.missileLaunch();
        this.game.toast(kind === 'ir' ? 'FOX 2 · 红外弹发射' : 'FOX 1 · 雷达弹发射 · 保持锁定');
        this.game.world.addShake(1.2);
      }
      return { ok: true, missile: msl };
    }

    deployFlares(fighter) {
      if (!fighter || !fighter.alive || !fighter.cfg.countermeasures) return false;
      if (fighter.flares <= 0 || fighter.cmCooldown > 0) return false;
      const n = Math.min(2, fighter.flares);
      fighter.flares -= n;
      fighter.cmCooldown = .55;
      for (let i = 0; i < n; i++) {
        const off = new THREE.Vector3(U.rand(-1.6, 1.6), -.8, 1.5).applyQuaternion(fighter.quaternion).add(fighter.pos);
        const flare = {
          pos: off,
          velocity: fighter.getVelocity(new THREE.Vector3()).multiplyScalar(.22)
            .add(new THREE.Vector3(U.rand(-12, 12), U.rand(-10, -2), U.rand(-12, 12))),
          ttl: 4.1, life: 4.1, alive: true, team: fighter.team,
          owner: fighter, isFlare: true, isDecoy: true, emitTimer: 0
        };
        this.game.flares.push(flare);
        this.game.effects.flareBurst(off);
      }
      if (fighter.isPlayer) {
        this.game.toast('热诱弹投放');
        this.game.audio.pop();
      }
      return true;
    }

    deployChaff(fighter) {
      if (!fighter || !fighter.alive || !fighter.cfg.countermeasures) return false;
      if (fighter.chaff <= 0 || fighter.cmCooldown > 0) return false;
      const n = Math.min(2, fighter.chaff);
      fighter.chaff -= n;
      fighter.cmCooldown = .55;
      for (let i = 0; i < n; i++) {
        const off = new THREE.Vector3(U.rand(-2.2, 2.2), -.5, 1.2).applyQuaternion(fighter.quaternion).add(fighter.pos);
        const chaff = {
          pos: off,
          velocity: fighter.getVelocity(new THREE.Vector3()).multiplyScalar(.13)
            .add(new THREE.Vector3(U.rand(-6, 6), U.rand(-3, 3), U.rand(-6, 6))),
          ttl: 4.6, alive: true, team: fighter.team, owner: fighter
        };
        this.game.chaffClouds.push(chaff);
        this.game.effects.chaffBurst(off);
      }
      if (fighter.isPlayer) {
        this.game.toast('箔条投放');
        this.game.audio.pop();
      }
      return true;
    }

    updateCountermeasures(dt) {
      const game = this.game;
      for (let i = game.flares.length - 1; i >= 0; i--) {
        const f = game.flares[i];
        f.ttl -= dt;
        f.pos.addScaledVector(f.velocity, dt);
        f.velocity.y -= 14 * dt;
        f.velocity.multiplyScalar(Math.exp(-.1 * dt));
        if (f.ttl <= 0) { f.alive = false; game.flares.splice(i, 1); continue; }
        f.emitTimer = (f.emitTimer || 0) - dt;
        if (f.emitTimer <= 0) {
          f.emitTimer = .12;
          game.effects.flareBurst(f.pos);
        }
      }
      for (let i = game.chaffClouds.length - 1; i >= 0; i--) {
        const c = game.chaffClouds[i];
        c.ttl -= dt;
        c.pos.addScaledVector(c.velocity, dt);
        c.velocity.multiplyScalar(Math.exp(-1.1 * dt));
        if (c.ttl <= 0) { c.alive = false; game.chaffClouds.splice(i, 1); }
      }
    }

    updateMissiles(dt) {
      const game = this.game;
      for (let i = game.missiles.length - 1; i >= 0; i--) {
        const m = game.missiles[i];
        if (!m.alive) {
          game.missiles.splice(i, 1);
          continue;
        }
        m.update(dt, game);
        if (!m.alive) game.missiles.splice(i, 1);
      }
    }

    clear() {
      this.bullets = [];
      this.game.missiles.forEach(m => { if (m.mesh.parent) m.mesh.parent.remove(m.mesh); });
      this.game.missiles.length = 0;
      this.game.flares.length = 0;
      this.game.chaffClouds.length = 0;
    }
  }

  TS.Combat = Combat;
})(window);
