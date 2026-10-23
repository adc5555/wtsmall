/* Thunder Skies - simplified pulse radar, clutter, chaff and RWR */
(function (global) {
  'use strict';
  const TS = global.TS = global.TS || {};
  const U = TS.Utils;

  const _v = new THREE.Vector3();
  const _local = new THREE.Vector3();
  const _inv = new THREE.Quaternion();

  class Radar {
    static updateAll(game, dt) {
      for (const f of game.fighters) {
        if (!f.alive) continue;
        if (f.radar) {
          f.radar.scanTimer -= dt;
          if (f.radar.scanTimer <= 0) {
            f.radar.scanTimer = f.cfg.radar.scanInterval;
            this.scan(f, game);
            this.validateLock(f, game);
          }
          this.updateRwr(f, game, dt);
        }
      }
    }

    static radarVector(fighter, target, out) {
      return out.subVectors(target.pos, fighter.pos);
    }

    static inRadarCone(fighter, target, distance) {
      const cfg = fighter.cfg.radar;
      const vec = _v.subVectors(target.pos, fighter.pos);
      if (vec.lengthSq() < 1) return true;
      const inv = _inv.copy(fighter.quaternion).invert();
      const local = _local.copy(vec).applyQuaternion(inv);
      const horiz = Math.hypot(local.x, local.z);
      const az = Math.abs(Math.atan2(local.x, -local.z));
      const el = Math.abs(Math.atan2(local.y, horiz));
      return az <= U.rad(cfg.azimuth) && el <= U.rad(cfg.elevation);
    }

    static targetInClutter(fighter, target, game) {
      const agl = target.pos.y - game.world.heightAt(target.pos.x, target.pos.z);
      const lookDown = fighter.pos.y - target.pos.y;
      return agl < fighter.cfg.radar.clutterAgl && lookDown > 180;
    }

    static canSee(fighter, target, game) {
      if (!fighter.radar || !target.alive) return false;
      const cfg = fighter.cfg.radar;
      const dist = fighter.pos.distanceTo(target.pos);
      if (dist > cfg.range || dist < 20) return false;
      if (!this.inRadarCone(fighter, target, dist)) return false;
      if (!game.world.getLosClear(fighter.pos, target.pos, 7)) return false;
      if (this.targetInClutter(fighter, target, game)) return false;
      return true;
    }

    static scan(fighter, game) {
      const cfg = fighter.cfg.radar;
      const contacts = [];
      for (const other of game.fighters) {
        if (!other.alive || other.team === fighter.team) continue;
        const dist = fighter.pos.distanceTo(other.pos);
        if (dist > cfg.range) continue;
        if (!this.inRadarCone(fighter, other, dist)) continue;
        if (!game.world.getLosClear(fighter.pos, other.pos, 7)) continue;
        const clutter = this.targetInClutter(fighter, other, game);
        if (clutter) {
          // Unstable ghost only, cannot be selected / locked
          contacts.push({ fighter: other, dist, clutter: true, unstable: true });
        } else {
          contacts.push({ fighter: other, dist, clutter: false });
        }
      }
      contacts.sort((a, b) => a.dist - b.dist);
      fighter.radar.contacts = contacts;

      // chaff false returns
      const falseContacts = [];
      for (const chaff of game.chaffClouds) {
        if (chaff.ttl <= 0 || chaff.team === fighter.team) continue;
        const dist = fighter.pos.distanceTo(chaff.pos);
        if (dist > cfg.range) continue;
        const fake = { pos: chaff.pos, dist, chaff: true };
        if (this.inRadarCone(fighter, chaff, dist)) falseContacts.push(fake);
      }
      fighter.radar.falseContacts = falseContacts;
    }

    static attemptLock(fighter, target, game) {
      if (!fighter.radar || !target) return false;
      if (!this.canSee(fighter, target, game)) return false;
      // direct lock on a low/clutter target is not stable
      fighter.radar.lockTarget = target;
      fighter.radar.lockValid = true;
      fighter.radar.lockAge = 0;
      fighter.radar.lastLockAttempt = game.time;
      return true;
    }

    static breakLock(fighter, game, reason) {
      if (!fighter.radar || !fighter.radar.lockTarget) return;
      const former = fighter.radar.lockTarget;
      fighter.radar.lockTarget = null;
      fighter.radar.lockValid = false;
      if (game && game.onRadarLockLost) game.onRadarLockLost(fighter, former, reason);
    }

    static validateLock(fighter, game) {
      const radar = fighter.radar;
      if (!radar || !radar.lockTarget) return;
      const target = radar.lockTarget;
      if (!target.alive) { this.breakLock(fighter, game, 'target-lost'); return; }
      const cfg = fighter.cfg.radar;
      const dist = fighter.pos.distanceTo(target.pos);
      if (dist > cfg.range || !this.inRadarCone(fighter, target, dist) ||
          !game.world.getLosClear(fighter.pos, target.pos, 7) ||
          this.targetInClutter(fighter, target, game)) {
        this.breakLock(fighter, game, 'clutter');
        return;
      }
      // chaff near the target breaks the lock probabilistically
      let chaffNear = false;
      for (const chaff of game.chaffClouds) {
        if (chaff.ttl <= 0 || chaff.team === fighter.team) continue;
        if (chaff.pos.distanceTo(target.pos) < 260) { chaffNear = true; break; }
      }
      if (chaffNear) {
        const chance = cfg.chaffBreakChance != null ? cfg.chaffBreakChance : .3;
        if (Math.random() < chance) {
          this.breakLock(fighter, game, 'chaff');
          return;
        }
      }
      radar.lockAge += cfg.scanInterval;
    }

    static updateRwr(fighter, game, dt) {
      const rwr = fighter.rwr;
      if (!rwr) return;
      const threats = [];
      let missileThreat = null;
      for (const other of game.fighters) {
        if (!other.alive || other.team === fighter.team) continue;
        if (other.radar && other.radar.lockTarget === fighter && other.radar.lockValid) {
          const bearing = Math.atan2(other.pos.x - fighter.pos.x, -(other.pos.z - fighter.pos.z));
          threats.push({
            fighter: other,
            bearing,
            rel: U.wrapAngle(bearing - U.rad(fighter.getHeading())),
            dist: fighter.pos.distanceTo(other.pos),
            type: 'lock',
            locked: true
          });
        }
      }
      for (const m of game.missiles) {
        if (!m.alive || m.kind !== 'sarh' || m.target !== fighter) continue;
        const bearing = Math.atan2(m.pos.x - fighter.pos.x, -(m.pos.z - fighter.pos.z));
        threats.push({
          missile: m,
          bearing,
          rel: U.wrapAngle(bearing - U.rad(fighter.getHeading())),
          dist: fighter.pos.distanceTo(m.pos),
          type: 'missile',
          locked: true
        });
        missileThreat = m;
      }
      // closest/most urgent first, cap at 6
      threats.sort((a, b) => (a.type === 'missile' ? -1 : 1) - (b.type === 'missile' ? -1 : 1) || a.dist - b.dist);
      rwr.threats = threats.slice(0, 6);
      rwr.lockCount = threats.filter(t => t.type === 'lock').length;
      rwr.missileWarning = !!missileThreat;
      rwr.missileThreat = missileThreat;
      if (missileThreat) rwr.status = 'MISSILE';
      else if (rwr.lockCount) rwr.status = 'LOCKED';
      else rwr.status = 'CLEAR';
    }
  }

  TS.Radar = Radar;
})(window);
