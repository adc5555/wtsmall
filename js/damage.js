/* Thunder Skies - hitboxes and limited module damage */
(function (global) {
  'use strict';
  const TS = global.TS = global.TS || {};
  const U = TS.Utils;

  const _qinv = new THREE.Quaternion();
  const _p0 = new THREE.Vector3();
  const _p1 = new THREE.Vector3();
  const _v = new THREE.Vector3();

  function toLocal(fighter, worldPoint) {
    _qinv.copy(fighter.quaternion).invert();
    return worldPoint.clone().sub(fighter.pos).applyQuaternion(_qinv);
  }

  const Damage = {
    moduleNames: ['fuselage', 'leftWing', 'rightWing', 'tail'],

    classifySegment(fighter, p0, p1) {
      if (!fighter || !fighter.alive) return null;
      _qinv.copy(fighter.quaternion).invert();
      _p0.copy(p0).sub(fighter.pos).applyQuaternion(_qinv);
      _p1.copy(p1).sub(fighter.pos).applyQuaternion(_qinv);
      let best = null;
      for (const name of this.moduleNames) {
        const box = fighter.hitboxes[name];
        if (!box) continue;
        const min = { x: box.min[0], y: box.min[1], z: box.min[2] };
        const max = { x: box.max[0], y: box.max[1], z: box.max[2] };
        const t = U.segmentAABB(_p0, _p1, min, max);
        if (t != null && (!best || t < best.t)) {
          best = { module: name, t, local: _p0.clone().lerp(_p1, t) };
        }
      }
      if (!best) return null;
      const eb = fighter.hitboxes.engine;
      let engineHit = false;
      if (eb) {
        const l = best.local;
        if (l.x >= eb.min[0] && l.x <= eb.max[0] && l.y >= eb.min[1] && l.y <= eb.max[1] && l.z >= eb.min[2] && l.z <= eb.max[2]) engineHit = true;
      }
      const worldHit = new THREE.Vector3().subVectors(p1, p0).multiplyScalar(best.t).add(p0);
      return { module: best.module, t: best.t, local: best.local, world: worldHit, engineHit };
    },

    applyGunHit(game, fighter, hit, damage, attacker) {
      if (!fighter.alive) return;
      const module = hit.module;
      fighter.takeHit(module, damage, attacker, hit.world);
      if (hit.engineHit) {
        fighter.takeHit('engine', damage * .55, attacker, hit.world);
      }
      game.onFighterHit(fighter, attacker, module, hit.world, damage);
    },

    applyBlast(game, fighter, damage, source, hitPos) {
      if (!fighter.alive) return;
      const dist = fighter.pos.distanceTo(hitPos || fighter.pos);
      const falloff = U.clamp(1 - dist / 42, .15, 1);
      const dmg = damage * falloff;
      // A proximity burst damages the airframe, engine and nearby wings/tail.
      fighter.takeHit('fuselage', dmg * 1.0, source, hitPos);
      fighter.takeHit('engine', dmg * .62, source, hitPos);
      fighter.takeHit('leftWing', dmg * .3, source, hitPos);
      fighter.takeHit('rightWing', dmg * .3, source, hitPos);
      fighter.takeHit('tail', dmg * .26, source, hitPos);
      game.onFighterHit(fighter, source, 'explosion', hitPos || fighter.pos, dmg);
    },

    sphereHit(fighter, a, b, radius) {
      return U.segmentSphere(a, b, fighter.pos, radius);
    }
  };

  TS.Damage = Damage;
})(window);
