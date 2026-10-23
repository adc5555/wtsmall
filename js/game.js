/* Thunder Skies - game state, team battles, input handling, loop */
(function (global) {
  'use strict';
  const TS = global.TS = global.TS || {};
  const U = TS.Utils;
  const $ = id => document.getElementById(id);
  const Y_AXIS = new THREE.Vector3(0, 1, 0);

  class Game {
    constructor() {
      this.canvas = $('scene');
      this.state = 'hangar';
      this.selectedAircraftId = 'p51';
      this.matchSize = 8;
      this.time = 0;
      this.matchTime = 0;
      this.lastDt = .016;
      this.fighters = [];
      this.missiles = [];
      this.flares = [];
      this.chaffClouds = [];
      this.player = null;
      this.spectatedFighter = null;
      this.spectateFast = false;
      this.zoomActive = false;
      this.targetLockedOnce = false;
      this.countdownTime = 0;
      this.prevFreeLook = false;
      this.aimDir = new THREE.Vector3(0, 0, -1);
      this.displayModel = null;
      this.endPending = false;
      this.resultShown = false;

      this.audio = TS.Audio;
      this.world = new TS.World(this.canvas);
      this.effects = new TS.Effects(this.world);
      this.combat = new TS.Combat(this);
      this.ai = new TS.AIController(this);
      this.input = TS.Input;
      this.hud = new TS.HUD(this);
      this.installInput();
      this.input.setActive(false);
      this.hud.showMenu(true);
      this.hud.showHud(false);
      this.audio.setMuted(TS.Settings.muted);
      this.lastFrame = performance.now();
      this.sceneTime = 0;
      this.loop = this.loop.bind(this);
      requestAnimationFrame(this.loop);
      this.installTestHooks();
    }

    installInput() {
      this.input.onEscape = () => this.handleEscape();
      this.input.onLockChange = (locked) => {
        this.pointerLocked = locked;
        if (locked) this.everLocked = true;
        if (!locked && this.everLocked && (this.state === 'battle' || this.state === 'spectating' || this.state === 'countdown')) {
          this.pause();
        }
      };
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && (this.state === 'battle' || this.state === 'spectating' || this.state === 'countdown')) {
          this.pause();
        }
      });
    }

    buildDisplayModel(id) {
      if (this.displayModel) {
        if (this.displayModel.group.parent) this.displayModel.group.parent.remove(this.displayModel.group);
        this.displayModel = null;
      }
      const model = TS.Models.createAircraftModel(id, 'blue');
      this.displayModel = model;
      this.world.displayGroup.add(model.group);
      model.group.position.set(0, 3200, 0);
      this.world.displayGroup.visible = true;
      TS.Models.updateAircraftVisual(model, {
        propSpin: 0, throttle: 0, boostActive: false, alive: true,
        leftWingDestroyed: false, rightWingDestroyed: false, tailDestroyed: false
      }, 0);
    }

    setSelectedAircraft(id) {
      this.selectedAircraftId = id;
      if (this.state === 'hangar') this.buildDisplayModel(id);
    }

    setMatchSize(size) { this.matchSize = size === 12 ? 12 : 8; }

    matchRemaining() { return Math.max(0, TS.CONFIG.MATCH.timeLimit - this.matchTime); }

    aliveCount(team) { return this.fighters.filter(f => f.alive && f.team === team).length; }

    inBattleView() {
      return this.state === 'battle' || this.state === 'spectating' || this.state === 'countdown';
    }

    isScoreboardVisible() {
      return this.inBattleView() && this.input.isDown('scoreboard');
    }

    getHudSubject() {
      if (this.state === 'spectating' && this.spectatedFighter) return this.spectatedFighter;
      return this.player;
    }

    toast(text, duration = 2.2) {
      if (this.hud) this.hud.toast(text, duration);
    }

    installTestHooks() {
      const params = new URLSearchParams(location.search);
      if (!params.has('test')) return;
      const self = this;
      window.__thunder = {
        game: self,
        startBattle(aircraft = 'f4e', size = 8) {
          if (aircraft && TS.CONFIG.AIRCRAFT[aircraft]) {
            self.hud.selectAircraft(aircraft);
          }
          self.hud.selectSize(size);
          self.audio.init();
          self.startBattle();
          return self.snapshot();
        },
        skipCountdown() {
          if (self.state === 'countdown') {
            self.countdownTime = 0;
          }
        },
        snapshot() { return self.snapshot(); },
        setThrottle(v) { if (self.player) self.player.throttle = U.clamp(v, 0, 110); },
        setAim(x, y) {
          // Debug helper using screen coordinates: x right and y down, each -1..1.
          const camera = self.world.camera;
          const dir = new THREE.Vector3(U.clamp(x, -1, 1), -U.clamp(y, -1, 1), .5)
            .unproject(camera).sub(camera.position).normalize();
          self.aimDir.copy(dir);
        },
        setFreeLook(v) { self.input.look.yaw = v ? .6 : 0; },
        setFighterPos(id, x, y, z) {
          const f = self.getFighter(id);
          if (!f) return;
          f.pos.set(x, y, z); f.prevPos.copy(f.pos);
          f.model.group.position.copy(f.pos);
        },
        setFighterHeading(id, heading, pitch = 0) {
          const f = self.getFighter(id);
          if (!f) return;
          f.orientFromYaw(U.rad(heading), U.rad(pitch));
          f.model.group.quaternion.copy(f.quaternion);
        },
        hitFighter(id, module, damage, attackerId) {
          const f = self.getFighter(id);
          if (!f) return;
          const attacker = attackerId ? self.getFighter(attackerId) : self.player;
          if (module === 'explosion') TS.Damage.applyBlast(self, f, damage, attacker, f.pos);
          else TS.Damage.applyGunHit(self, f, { module, world: f.pos.clone(), engineHit: module === 'engine' }, damage, attacker);
          return f.serialize();
        },
        killFighter(id, attackerId) {
          const f = self.getFighter(id);
          if (!f) return;
          const attacker = attackerId ? self.getFighter(attackerId) : self.player;
          self.onFighterDestroyed(f, attacker, '测试击落');
        },
        killTeam(team) {
          for (const f of self.fighters) {
            if (f.team === team && f.alive) self.onFighterDestroyed(f, team === 'red' ? self.player : null, '测试清场');
          }
        },
        forceTarget(id) {
          const f = self.getFighter(id);
          if (!f || !self.player) return false;
          self.player.selectedTarget = f;
          if (self.player.radar) {
            const ok = TS.Radar.attemptLock(self.player, f, self);
            return ok;
          }
          return true;
        },
        clearTarget() { if (self.player) { self.player.selectedTarget = null; if (self.player.radar) TS.Radar.breakLock(self.player, self, 'debug'); } },
        launchMissile(kind = 'ir', targetId) {
          if (!self.player) return { ok: false };
          if (targetId) {
            const f = self.getFighter(targetId);
            if (f) self.player.selectedTarget = f;
          }
          if (self.player.radar && self.player.selectedTarget) TS.Radar.attemptLock(self.player, self.player.selectedTarget, self);
          return self.combat.fireMissile(self.player, kind, self.player.selectedTarget);
        },
        deployFlares() { return self.player ? self.combat.deployFlares(self.player) : false; },
        deployChaff() { return self.player ? self.combat.deployChaff(self.player) : false; },
        forceIncomingMissile(kind = 'ir', targetIndex = 1) {
          const ai = self.fighters.find(f => f.ai && f.alive && f.team === 'red');
          const target = self.fighters.filter(f => f.alive && f.team === 'blue')[targetIndex] || self.player;
          if (!ai || !target) return null;
          ai.selectedTarget = target;
          if (ai.radar) TS.Radar.attemptLock(ai, target, self);
          return self.combat.fireMissile(ai, kind, target);
        },
        forceAIState(id, state) {
          const f = self.getFighter(id);
          if (f) { f.ai.state = state; f.ai.desired = f.forward.clone(); }
        },
        endMatch() { self.finishMatch(); },
        quit() { self.quitToHangar(); },
        getFighter(id) { return self.getFighter(id); }
      };
    }

    getFighter(id) {
      return this.fighters.find(f => f.id === id);
    }

    snapshot() {
      const p = this.player;
      return {
        state: this.state,
        time: this.time,
        matchTime: this.matchTime,
        alive: { blue: this.aliveCount('blue'), red: this.aliveCount('red') },
        player: p ? p.serialize() : null,
        fighters: this.fighters.map(f => f.serialize()),
        missiles: this.missiles.map(m => ({
          id: m.id, kind: m.kind, owner: m.owner.id, target: m.target && m.target.id,
          phase: m.phase, speed: m.speed, alive: m.alive,
          guidanceValid: m.guidanceValid, decoy: m.decoy,
          pos: { x: m.pos.x, y: m.pos.y, z: m.pos.z }
        })),
        flares: this.flares.length,
        chaffClouds: this.chaffClouds.length,
        aimDir: { x: this.aimDir.x, y: this.aimDir.y, z: this.aimDir.z },
        selectedTarget: p && p.selectedTarget ? p.selectedTarget.id : null,
        radarLock: p && p.radar && p.radar.lockTarget ? p.radar.lockTarget.id : null,
        radarContacts: p && p.radar ? (p.radar.contacts || []).map(c => ({ id: c.fighter.id, dist: c.dist, clutter: c.clutter })) : [],
        rwr: p && p.rwr ? { status: p.rwr.status, threats: p.rwr.threats.length, missile: p.rwr.missileWarning } : null,
        pointerLocked: !!document.pointerLockElement,
        hudSubject: this.getHudSubject() ? this.getHudSubject().id : null,
        scoreboard: this.isScoreboardVisible(),
        endPending: this.endPending
      };
    }

    spawnTeams(aircraftId, size) {
      const cfg = TS.CONFIG.getAircraft(aircraftId);
      const match = TS.CONFIG.MATCH;
      const isJetLate = aircraftId === 'f4e';
      const dist = isJetLate ? match.sizes[size].f4SpawnDistance : match.sizes[size].spawnDistance;
      const baseAlt = match.altitudes[aircraftId];
      const startSpeed = aircraftId === 'p51' ? 135 : aircraftId === 'mig15' ? 195 : 260;
      const blue = [];
      const red = [];
      const spacing = isJetLate ? 380 : 260;

      const makePositions = (team, n) => {
        const z = team === 'blue' ? dist / 2 : -dist / 2;
        const yaw = team === 'blue' ? 0 : Math.PI;
        const out = [];
        for (let i = 0; i < n; i++) {
          const row = i % 2;
          const col = Math.floor(i / 2);
          const center = (n - 1) / 2;
          const x = (i - center) * spacing;
          const zOff = row === 0 ? -150 : 150;
          out.push({ x, z: z + (team === 'blue' ? zOff : -zOff), altitude: baseAlt + row * 120 + U.rand(-25, 25), yaw });
        }
        return out;
      };

      const bluePositions = makePositions('blue', size);
      const redPositions = makePositions('red', size);
      // Player takes the central slot; reposition to avoid off-screen at spawn.
      const playerSpec = {
        id: 'blue-1', aircraftId, team: 'blue', callsign: 'BLUE 1', isPlayer: true,
        x: 0, z: dist / 2, altitude: baseAlt, yaw: 0, speed: startSpeed,
        throttle: cfg.startThrottle
      };
      this.player = new TS.Fighter(this, playerSpec);
      blue.push(this.player);

      for (let i = 1; i < size; i++) {
        const slot = bluePositions[i];
        const f = new TS.Fighter(this, {
          id: 'blue-' + (i + 1), aircraftId, team: 'blue', callsign: 'BLUE ' + (i + 1),
          x: slot.x, z: slot.z, altitude: slot.altitude, yaw: slot.yaw,
          speed: startSpeed - U.rand(0, 12), throttle: cfg.startThrottle
        });
        blue.push(f);
      }
      for (let i = 0; i < size; i++) {
        const slot = redPositions[i];
        const f = new TS.Fighter(this, {
          id: 'red-' + (i + 1), aircraftId, team: 'red', callsign: 'RED ' + (i + 1),
          x: slot.x, z: slot.z, altitude: slot.altitude, yaw: slot.yaw,
          speed: startSpeed - U.rand(0, 12), throttle: cfg.startThrottle
        });
        red.push(f);
      }
      this.fighters = blue.concat(red);
      this.player = blue[0];
      // Give the player a little distance from wingmen.
      this.player.pos.x = 0;
      this.player.pos.z = dist / 2 - 260;
      this.player.pos.y = baseAlt;
      this.player.model.group.position.copy(this.player.pos);
      this.spectatedFighter = null;
      this.input.setActive(true);
      this.input.resetAim();
      this.aimDir.copy(this.player.forward);
      this.audio.setEngineType(aircraftId === 'p51' ? 'prop' : 'jet');
      this.snapCameraTo(this.player);
    }

    snapCameraTo(fighter) {
      const fwd = fighter.getForward(new THREE.Vector3());
      const cfg = fighter.cfg.camera;
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      const camUp = new THREE.Vector3().crossVectors(right, fwd).normalize();
      this.world.camPos.copy(fighter.pos).addScaledVector(fwd, -cfg.distance).addScaledVector(camUp, cfg.height);
      this.world.camLook.copy(fighter.pos).addScaledVector(fwd, cfg.lookAhead);
      this.world.camera.position.copy(this.world.camPos);
      this.world.camera.up.copy(camUp);
      this.world.camera.lookAt(this.world.camLook);
      this.world.camera.fov = 55;
      this.world.camera.updateProjectionMatrix();
    }

    startBattle() {
      this.audio.init();
      this.cleanupBattle();
      this.hud.hideResult();
      this.hud.showPause(false);
      this.hud.showHelp(false);
      this.hud.closeSettings();
      this.hud.showMenu(false);
      this.hud.showHud(true);
      this.hud.setSpectating(false);
      this.hud.setWarning('');
      this.hud.dom.scoreboard.classList.add('hidden');
      this.world.displayGroup.visible = false;
      this.state = 'countdown';
      this.countdownTime = 3.05;
      this.lastCountdownDisplayed = 3;
      this.matchTime = 0;
      this.time = 0;
      this.spectateFast = false;
      this.zoomActive = false;
      this.resultShown = false;
      this.endPending = false;
      this.spawnTeams(this.selectedAircraftId, this.matchSize);
      this.state = 'countdown';
      this.hud.showCountdown('3');
      this.input.setActive(true);
      this.input.clearHeld();
      this.input.resetAim();
      this.prevFreeLook = false;
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      document.body.classList.add('in-battle');
      this.input.requestPointerLock();
      this.audio.setGunFiring(false);
      this.audio.updateEngine(this.player.spool, 0, this.player.speed, true);
      this.autoAcquirePending = true;
    }

    cleanupBattle() {
      this.combat.clear();
      for (const f of this.fighters) {
        if (f.model && f.model.group.parent) f.model.group.parent.remove(f.model.group);
      }
      this.fighters = [];
      this.missiles = [];
      this.flares = [];
      this.chaffClouds = [];
      this.player = null;
      this.spectatedFighter = null;
      this.effects.clear();
      this.world.cameraShake = 0;
      this.audio.setGunFiring(false);
    }

    quitToHangar() {
      this.cleanupBattle();
      this.state = 'hangar';
      this.zoomActive = false;
      this.input.setActive(false);
      this.input.exitPointerLock();
      this.input.resetAim();
      this.hud.showMenu(true);
      this.hud.showHud(false);
      this.hud.showPause(false);
      this.hud.hideResult();
      this.hud.closeSettings();
      this.hud.showHelp(false);
      this.hud.showCountdown(null);
      this.hud.setSpectating(false);
      this.hud.setWarning('');
      this.world.displayGroup.visible = true;
      this.buildDisplayModel(this.selectedAircraftId);
      document.body.classList.remove('in-battle');
      this.audio.setGunFiring(false);
      this.audio.updateEngine(0, 0, 0, false);
      this.audio.setEngineType(this.selectedAircraftId === 'p51' ? 'prop' : 'jet');
      this.lastFrame = performance.now();
    }

    pause() {
      if (!(this.state === 'battle' || this.state === 'spectating' || this.state === 'countdown')) return;
      this.pausedFrom = this.state;
      this.state = 'paused';
      this.input.setActive(false);
      this.input.clearEdges();
      this.hud.showPause(true, this.state === 'countdown' ? '倒计时已冻结。' : '战斗模拟已冻结，鼠标已释放。');
      this.hud.dom.scoreboard.classList.add('hidden');
      document.body.classList.remove('in-battle');
      this.audio.setGunFiring(false);
      this.audio.updateEngine(0, 0, 0, false);
      this.input.exitPointerLock();
    }

    resume() {
      if (this.state !== 'paused') return;
      if (this.hud.dom.settings.classList.contains('active')) {
        this.hud.closeSettings();
      }
      this.state = this.pausedFrom || 'battle';
      this.hud.showPause(false);
      this.input.setActive(true);
      this.input.clearHeld();
      this.input.resetAim();
      if (this.player) this.aimDir.copy(this.player.forward);
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      document.body.classList.add('in-battle');
      this.input.requestPointerLock();
      this.lastFrame = performance.now();
    }

    handleEscape() {
      if (this.hud.dom.settings.classList.contains('active')) {
        this.hud.closeSettings();
        return;
      }
      if (this.hud.dom.help.classList.contains('active')) {
        this.hud.showHelp(false);
        return;
      }
      if (this.state === 'paused') {
        this.resume();
      } else if (this.state === 'battle' || this.state === 'spectating' || this.state === 'countdown') {
        this.pause();
      }
    }

    restart() {
      const aircraft = this.selectedAircraftId;
      const size = this.matchSize;
      this.cleanupBattle();
      this.state = 'hangar';
      this.hud.hideResult();
      this.hud.showPause(false);
      this.setSelectedAircraft(aircraft);
      this.matchSize = size;
      this.hud.showMenu(false);
      this.startBattle();
    }

    loop(now) {
      try {
        this.frame(now);
      } catch (err) {
        console.error('Game loop error:', err);
      } finally {
        requestAnimationFrame(this.loop);
      }
    }

    frame(now) {
      const raw = (now - this.lastFrame) / 1000;
      this.lastFrame = now;
      const dt = U.clamp(raw, 0, .05);
      this.lastDt = dt;
      this.sceneTime += dt;
      this.frameCount = (this.frameCount || 0) + 1;
      if (this.state === 'hangar') {
        this.world.updateShowcase(this.displayModel ? this.displayModel.group : null, dt, this.sceneTime);
        if (this.displayModel) TS.Models.updateAircraftVisual(this.displayModel, {
          propSpin: 2.5, throttle: 0, boostActive: false, alive: true,
          leftWingDestroyed: false, rightWingDestroyed: false, tailDestroyed: false
        }, dt);
        this.effects.update(dt);
      } else if (this.state === 'paused') {
        // frozen simulation, keep a still render
      } else if (this.state === 'result') {
        this.effects.update(dt);
      } else if (this.state === 'countdown') {
        this.countdownTime -= dt;
        if (this.countdownTime <= 0) {
          this.state = 'battle';
          this.hud.showCountdown(null);
          this.toast('交战！', 2.4);
          if (this.player) {
            this.aimDir.copy(this.player.forward);
            this.input.clearAimDelta();
          }
          if (this.player && this.player.radar) TS.Radar.scan(this.player, this);
          this.autoAcquireIfNeeded();
        } else {
          const n = Math.ceil(this.countdownTime);
          if (n !== this.lastCountdownDisplayed) {
            this.lastCountdownDisplayed = n;
            this.hud.showCountdown(String(n));
          }
        }
        this.input.clearAimDelta();
        this.updateLookDecay(dt);
        this.world.updateChase(this.player, dt, false, this.input.look, this.zoomActive);
        this.updateEngineSound();
        this.hud.update(this, dt);
        this.effects.update(dt);
      } else if (this.state === 'battle' || this.state === 'spectating') {
        this.handleFrameActions(dt);
        const steps = this.state === 'spectating' && this.spectateFast ? 4 : 1;
        for (let i = 0; i < steps; i++) {
          if (!(this.state === 'battle' || this.state === 'spectating')) break;
          this.simulate(dt);
        }
        this.updateLookDecay(dt);
        this.updateCamera(dt);
        this.updateEngineSound();
        this.effects.update(dt);
        this.hud.update(this, dt);
        this.updateRwrSounds();
      }
      this.world.updateEffects(dt);
      this.world.render();
    }

    onMissileEnd(missile) {
      if (!missile) return;
      // The combat manager removes the entity on its next update. Nothing else to own here,
      // but keep the hook stable for effects/telemetry and future kill attribution.
    }

    updateLookDecay(dt) {
      const holding = this.input.isDown('freeLook');
      if (!holding) {
        this.input.look.yaw = U.damp(this.input.look.yaw, 0, 10, dt);
        this.input.look.pitch = U.damp(this.input.look.pitch, 0, 10, dt);
      }
    }

    updateCamera(dt) {
      if (this.state === 'spectating') {
        if (!this.spectatedFighter || !this.spectatedFighter.alive) this.pickSpectator();
        if (this.spectatedFighter) this.world.updateSpectator(this.spectatedFighter, dt, this.zoomActive);
        else if (this.player) this.world.updateChase(this.player, dt, false, this.input.look, this.zoomActive);
        return;
      }
      if (this.player) {
        const free = this.input.isDown('freeLook');
        this.world.updateChase(this.player, dt, free, this.input.look, this.zoomActive);
      }
    }

    updateEngineSound() {
      if (!this.player || this.state === 'spectating') {
        this.audio.updateEngine(0, 0, 0, false);
        this.audio.setGunFiring(false);
        return;
      }
      const active = this.player.alive && (this.state === 'battle' || this.state === 'countdown');
      this.audio.updateEngine(this.player.spool, this.player.boostActive ? 1 : 0, this.player.speed, active);
      const firing = active && this.input.isDown('fireGun') && this.player.gunAmmo > 0;
      this.audio.setGunFiring(firing);
    }

    updateRwrSounds() {
      if (!this.player || !this.player.rwr || !this.player.alive) return;
      if (this.player.rwr.missileWarning) this.audio.lockBeep(true);
      else if (this.player.rwr.lockCount > 0) this.audio.lockBeep(false);
    }

    handleFrameActions(dt) {
      const input = this.input;
      if (!input.active) return;
      if (input.consumePressed('mute')) {
        TS.Settings.setMuted(!TS.Settings.muted);
        this.audio.setMuted(TS.Settings.muted);
        this.toast(TS.Settings.muted ? '已静音' : '取消静音');
      }
      if (input.consumePressed('zoom')) {
        this.zoomActive = !this.zoomActive;
        this.toast(this.zoomActive ? '视野放大 ×5' : '恢复普通视野');
      }
      if (this.state === 'spectating') {
        this.input.clearAimDelta();
        if (input.consumePressed('spectateNext')) this.cycleSpectator();
        if (input.consumePressed('spectateSpeed')) {
          this.spectateFast = !this.spectateFast;
          this.toast(this.spectateFast ? '观战加速 ×4' : '观战速度 ×1');
        }
        return;
      }
      if (!this.player || !this.player.alive) return;
      const free = input.isDown('freeLook');
      if (free && !this.prevFreeLook) {
        // Free look suspends the mouse flight director and centers the aim
        // direction on the current nose before orbiting the camera.
        this.input.clearAimDelta();
        this.input.look.yaw = 0;
        this.input.look.pitch = 0;
        this.aimDir.copy(this.player.forward);
      }
      if (!free && this.prevFreeLook) {
        this.input.clearAimDelta();
        this.aimDir.copy(this.player.forward);
      }
      this.prevFreeLook = free;

      if (input.consumePressed('targetNext')) this.cycleTarget();
      if (input.consumePressed('selectIR')) this.selectMissile('ir');
      if (input.consumePressed('selectSARH')) this.selectMissile('sarh');
      if (this.player && this.player.alive) {
        // A short tap gives a predictable 4% step. Holding additionally advances
        // a purely linear throttle axis at a constant rate.
        let throttleStep = 0;
        if (input.consumePressed('throttleUp')) throttleStep += 4;
        if (input.consumePressed('throttleDown')) throttleStep -= 4;
        if (throttleStep) {
          this.player.throttle = U.clamp(this.player.throttle + throttleStep, 0, 110);
        }
      }
      if (input.consumePressed('fireMissile')) {
        if (!this.player.cfg.missiles) this.toast('本机没有挂载导弹');
        else if (!this.player.selectedTarget) this.toast('没有选定目标');
        else this.combat.fireMissile(this.player, this.player.selectedMissile, this.player.selectedTarget);
      }
      if (input.consumePressed('flare')) {
        if (!this.player.cfg.countermeasures) this.toast('本机没有干扰弹');
        else if (!this.combat.deployFlares(this.player)) this.toast(this.player.cmCooldown > 0 ? '投放冷却中' : '热诱弹已用尽');
      }
      if (input.consumePressed('chaff')) {
        if (!this.player.cfg.countermeasures) this.toast('本机没有干扰弹');
        else if (!this.combat.deployChaff(this.player)) this.toast(this.player.cmCooldown > 0 ? '投放冷却中' : '箔条已用尽');
      }
      if (this.player.selectedTarget && !this.player.selectedTarget.alive) {
        this.player.selectedTarget = null;
        if (this.player.radar) TS.Radar.breakLock(this.player, this, 'target-lost');
      }
    }

    updatePlayer(dt) {
      const p = this.player;
      if (!p || !p.alive) return;
      const input = this.input;
      const free = input.isDown('freeLook');
      const keyRoll = (input.isDown('rollRight') ? 1 : 0) - (input.isDown('rollLeft') ? 1 : 0);

      if (free) {
        // Observation mode: freeze the flight director and level the wings while
        // the camera orbits. Throttle and guns remain available.
        input.clearAimDelta();
        p.applyControl(0, 0, keyRoll, dt, 1);
        if (!keyRoll) p.bankToward(0, dt, 1.2);
      } else {
        const camera = this.world.camera;
        const worldUp = new THREE.Vector3(0, 1, 0);
        const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        const delta = input.consumeAimDelta();
        if (delta.x || delta.y) {
          // Convert screen-space mouse movement into a rotation of a world-space
          // aim direction. As the aircraft/camera align, the aim marker therefore
          // drifts back toward the centre by itself.
          const fovY = U.rad(camera.fov);
          const aspect = camera.aspect || (window.innerWidth / Math.max(1, window.innerHeight));
          const horizPerPx = (2 * Math.atan(Math.tan(fovY * .5) * aspect)) / Math.max(1, window.innerWidth);
          const vertPerPx = fovY / Math.max(1, window.innerHeight);
          const sens = input.mouseSensitivity;
          this.aimDir.applyAxisAngle(worldUp, -delta.x * horizPerPx * sens);
          this.aimDir.applyAxisAngle(camRight, -delta.y * vertPerPx * sens);
          this.aimDir.normalize();
        }

        const keyPitch = (input.isDown('pitchUp') ? 1 : 0) - (input.isDown('pitchDown') ? 1 : 0);
        const keyYaw = (input.isDown('yawRight') ? 1 : 0) - (input.isDown('yawLeft') ? 1 : 0);
        if (keyPitch || keyYaw) {
          const aimRate = this.zoomActive ? .32 : .85;
          this.aimDir.applyAxisAngle(worldUp, -keyYaw * aimRate * dt);
          this.aimDir.applyAxisAngle(camRight, keyPitch * aimRate * dt);
          this.aimDir.normalize();
        }

        // Convert the world direction into local pitch/yaw error and guide the
        // nose toward it. This is a direction-following controller, not a stick.
        const inv = p.quaternion.clone().invert();
        const localAim = this.aimDir.clone().applyQuaternion(inv).normalize();
        const yawErr = Math.atan2(localAim.x, -localAim.z);
        const pitchErr = Math.asin(U.clamp(localAim.y, -1, 1));
        let yawCmd = U.clamp(yawErr * 2.8 - p.rate.yaw * .45, -1, 1);
        let pitchCmd = U.clamp(pitchErr * 2.8 - p.rate.pitch * .45, -1, 1);
        if (Math.abs(yawErr) < .0025) yawCmd = 0;
        if (Math.abs(pitchErr) < .0025) pitchCmd = 0;
        p.applyControl(pitchCmd, yawCmd, keyRoll, dt, 1);
        if (!keyRoll) {
          // Coordinated auto-bank follows the requested turn, then levels as the
          // nose converges on the aim direction.
          p.bankToward(U.clamp(yawCmd, -1, 1) * .82, dt, 1.35);
        }
      }

      let targetThrottle = p.throttle;
      const up = input.isDown('throttleUp');
      const down = input.isDown('throttleDown');
      // Linear axis: a constant 32% per second while held, plus a 4% tap step.
      if (up && !down) targetThrottle = Math.min(110, targetThrottle + 32 * dt);
      else if (down && !up) targetThrottle = Math.max(0, targetThrottle - 32 * dt);
      p.throttle = targetThrottle;
      this.combat.fireGuns(p, input.isDown('fireGun'), dt);
    }

    simulate(dt) {
      if (!this.fighters.length) return;
      this.time += dt;
      if (this.state === 'battle' || this.state === 'spectating') this.matchTime += dt;
      if (this.player && this.player.alive && this.state === 'battle') this.updatePlayer(dt);
      this.ai.updateAll(dt);
      for (const f of this.fighters) {
        if (f.alive) {
          f.update(dt);
          f.damageSmokeTimer -= dt;
          this.emitDamageSmoke(f, dt);
        } else if (f.deathTimer > 0) {
          f.deathTimer -= dt;
          f.pos.y -= (22 + (2.2 - f.deathTimer) * 14) * dt;
          const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(f.deathSpin.x * dt, f.deathSpin.y * dt, f.deathSpin.z * dt, 'XYZ'));
          f.quaternion.multiply(q).normalize();
          f.model.group.position.copy(f.pos);
          f.model.group.quaternion.copy(f.quaternion);
          if (f.deathTimer <= 0) f.hideModel();
        }
      }
      TS.Radar.updateAll(this, dt);
      this.combat.updateBullets(dt);
      this.combat.updateMissiles(dt);
      this.combat.updateCountermeasures(dt);
      this.checkGroundCollisions();
      if (this.state === 'spectating') {
        if (!this.spectatedFighter || !this.spectatedFighter.alive) this.pickSpectator();
        if (!this.trackedTargetValid() && this.player) {
          this.player.selectedTarget = null;
        }
      }
      this.checkMatchEnd();
    }

    emitDamageSmoke(f, dt) {
      if (f.damageSmokeTimer > 0) return;
      const ratios = [f.getModuleRatio('engine'), f.getModuleRatio('fuselage'), f.getModuleRatio('leftWing'), f.getModuleRatio('rightWing'), f.getModuleRatio('tail')];
      const min = Math.min(...ratios);
      if (min > .62) return;
      const interval = min < .25 ? .07 : .14;
      f.damageSmokeTimer = interval;
      const offsets = f.model && f.model.parts.smokeOffsets ? f.model.parts.smokeOffsets : [];
      const off = offsets[0] || new THREE.Vector3(0, 0, 2);
      const wp = new THREE.Vector3(off.x, off.y, off.z).applyQuaternion(f.quaternion).add(f.pos);
      this.effects.smokePuff(wp, {
        size: min < .25 ? U.rand(5, 9) : U.rand(3, 6),
        endSize: U.rand(20, 38), life: U.rand(1.1, 2.4),
        alpha: min < .25 ? .5 : .28,
        color: min < .25 ? 0x2e3230 : 0x707b76,
        velocity: f.getVelocity(new THREE.Vector3()).multiplyScalar(.06).add(new THREE.Vector3(0, 3, 0)),
        gravity: -.2, drag: .8
      });
      if (min < .18) {
        this.effects.firePuff(wp, { size: 3, endSize: 7, life: .15, color: 0xff8844, alpha: .6, drag: 1 });
      }
    }

    checkGroundCollisions() {
      for (const f of this.fighters) {
        if (!f.alive) continue;
        const ground = this.world.heightAt(f.pos.x, f.pos.z);
        if (f.pos.y <= ground + 2.5) {
          this.effects.groundImpact(f.pos);
          this.onFighterDestroyed(f, null, '撞地');
        }
      }
    }

    onFighterHit(fighter, attacker, module, worldPoint, damage) {
      if (!fighter || !this.player) return;
      if (fighter === this.player) {
        this.world.addShake(U.clamp(damage * .09, .1, 1.4));
      }
      if (attacker === this.player) {
        this.hud.showHitMarker();
      }
    }

    onPlayerHitConfirm(fighter, damage, module) {
      if (this.hud) this.hud.showHitMarker();
    }

    onRadarLockLost(fighter, former, reason) {
      if (fighter.isPlayer && fighter === this.player) {
        const msg = reason === 'chaff' ? '雷达脱锁 · 箔条干扰' : reason === 'clutter' ? '雷达脱锁 · 地杂波' : '雷达脱锁';
        this.toast(msg);
      }
    }

    onWingDestroyed(fighter, side, attacker) {
      this.onStructuralLoss(fighter, attacker, side === 'left' ? '左翼断裂' : '右翼断裂');
    }

    onStructuralLoss(fighter, attacker, reason) {
      if (!fighter.alive) return;
      this.onFighterDestroyed(fighter, attacker, reason);
    }

    onFighterDestroyed(fighter, attacker, reason) {
      if (!fighter || fighter.killed) return;
      fighter.killed = true;
      fighter.alive = false;
      fighter.deaths++;
      fighter.deathTimer = 2.2;
      fighter.deathSpin.set(U.rand(-1.6, 1.6), U.rand(-1.9, 1.9), U.rand(-2.8, 2.8));
      fighter.model.parts.flames.forEach(f => f.visible = false);
      if (fighter.model.parts.prop) fighter.model.parts.prop.visible = false;
      if (attacker && attacker !== fighter && attacker.team !== fighter.team) {
        attacker.kills++;
        attacker.score += fighter.cfg.scoreValue;
        if (attacker === this.player) {
          this.hud.showHitMarker();
          this.toast(`击落 ${fighter.callsign} · +${fighter.cfg.scoreValue}`);
        }
      }
      const killerName = attacker && attacker !== fighter ? attacker.callsign : reason;
      if (this.hud) this.hud.addKill(
        killerName, fighter.callsign,
        attacker && attacker !== fighter ? attacker.team : null,
        fighter.team
      );
      this.effects.explosion(fighter.pos, fighter.isPlayer ? 1.15 : .9);
      this.audio.explosion(fighter === this.player ? 1.2 : .8);
      const d = this.player ? fighter.pos.distanceTo(this.player.pos) : 9999;
      this.world.addShake(d < 400 ? 1.8 : .5);
      if (this.player && this.player.selectedTarget === fighter) {
        this.player.selectedTarget = null;
        if (this.player.radar) TS.Radar.breakLock(this.player, this, 'target-lost');
      }
      if (fighter.ai) fighter.ai.target = null;
      if (fighter.isPlayer) {
        this.onPlayerDown();
      }
    }

    onPlayerDown() {
      if (!this.player) return;
      this.state = 'spectating';
      this.input.setActive(true);
      this.hud.setSpectating(true);
      this.hud.showCountdown(null);
      this.audio.setGunFiring(false);
      this.audio.updateEngine(0, 0, 0, false);
      this.pickSpectator(true);
      this.toast('你已被击落 · 可以继续观战或按 Esc 退出', 4);
      this.updateLookDecay(1);
      this.hud.update(this, .016);
    }

    pickSpectator(snap = false) {
      const allies = this.fighters.filter(f => f.alive && f.team === 'blue' && f !== this.player);
      if (!allies.length) {
        this.spectatedFighter = null;
        this.hud.setSpectating(true);
        return;
      }
      const current = this.spectatedFighter;
      let next = allies[0];
      if (current && allies.includes(current)) {
        const idx = allies.indexOf(current);
        next = allies[(idx + 1) % allies.length];
      }
      this.spectatedFighter = next;
      if (snap) this.snapCameraTo(next);
    }

    cycleSpectator() {
      const allies = this.fighters.filter(f => f.alive && f.team === 'blue' && f !== this.player);
      if (!allies.length) { this.toast('没有可观的队友'); return; }
      let idx = allies.indexOf(this.spectatedFighter);
      idx = (idx + 1) % allies.length;
      this.spectatedFighter = allies[idx];
      this.snapCameraTo(this.spectatedFighter);
    }

    handledTargetCandidates() {
      if (!this.player) return [];
      const range = this.player.radar ? this.player.cfg.radar.range : 16000;
      const enemies = this.fighters.filter(f => f.alive && f.team !== this.player.team);
      if (this.player.radar) {
        const contacts = (this.player.radar.contacts || []).filter(c => !c.clutter);
        return contacts.map(c => c.fighter).filter(Boolean);
      }
      return enemies.filter(f => f.pos.distanceTo(this.player.pos) <= range);
    }

    autoAcquireIfNeeded() {
      if (!this.player || this.player.selectedTarget) return;
      const candidates = this.handledTargetCandidates();
      if (!candidates.length) return;
      candidates.sort((a, b) => a.pos.distanceTo(this.player.pos) - b.pos.distanceTo(this.player.pos));
      this.player.selectedTarget = candidates[0];
      if (this.player.radar) TS.Radar.attemptLock(this.player, candidates[0], this);
    }

    cycleTarget() {
      if (!this.player) return;
      const p = this.player;
      if (p.radar) {
        // First try to recover a lost lock on the current target.
        if (p.selectedTarget && p.selectedTarget.alive && !p.radar.lockValid) {
          const ok = TS.Radar.attemptLock(p, p.selectedTarget, this);
          this.toast(ok ? '雷达重新锁定' : '目标无法锁定');
          if (ok) return;
        }
      }
      let candidates = this.handledTargetCandidates();
      if (!candidates.length) {
        candidates = this.fighters.filter(f => f.alive && f.team !== p.team);
        this.toast('雷达无接触，尝试目视目标');
      }
      if (!candidates.length) { this.toast('没有可锁定目标'); return; }
      candidates.sort((a, b) => a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos));
      const current = p.selectedTarget;
      let idx = candidates.indexOf(current);
      idx = (idx + 1) % candidates.length;
      p.selectedTarget = candidates[idx];
      if (p.radar) {
        const ok = TS.Radar.attemptLock(p, p.selectedTarget, this);
        this.toast(ok ? `雷达锁定 ${p.selectedTarget.callsign}` : '雷达未能锁定');
      } else {
        this.toast(`目视目标 ${p.selectedTarget.callsign}`);
      }
    }

    selectMissile(kind) {
      if (!this.player) return;
      if (!this.player.cfg.missiles) { this.toast('本机没有挂载导弹'); return; }
      if (this.player.missileCounts[kind] <= 0) { this.toast(`${TS.CONFIG.MISSILES[kind].name} 已用尽`); return; }
      this.player.selectedMissile = kind;
      this.toast(kind === 'ir' ? '已选择 AIM-9E 红外弹' : '已选择 AIM-7E-2 雷达弹');
    }

    checkMatchEnd() {
      if (this.state !== 'battle' && this.state !== 'spectating') return;
      if (this.matchTime >= TS.CONFIG.MATCH.timeLimit) {
        this.finishMatch();
        return;
      }
      const blue = this.aliveCount('blue');
      const red = this.aliveCount('red');
      if (blue === 0 || red === 0) {
        this.finishMatch();
      }
    }

    finishMatch() {
      if (this.state === 'result' || this.state === 'hangar') return;
      if (this.resultShown) return;
      this.resultShown = true;
      const blue = this.aliveCount('blue');
      const red = this.aliveCount('red');
      const draw = blue === red || (blue === 0 && red === 0);
      const victory = !draw && blue > red;
      this.state = 'result';
      this.input.setActive(false);
      this.input.exitPointerLock();
      this.hud.showPause(false);
      this.hud.dom.scoreboard.classList.add('hidden');
      this.hud.setSpectating(false);
      this.hud.showCountdown(null);
      this.audio.setGunFiring(false);
      this.audio.updateEngine(0, 0, 0, false);
      document.body.classList.remove('in-battle');
      const player = this.player;
      const subtitle = draw
        ? '双方机群同时失去作战能力。'
        : victory
          ? (player && player.alive ? '你与蓝队控制了这片空域。' : '你的队伍为你赢得了这场空战。')
          : (player && player.alive ? '蓝队被击溃，你被迫撤离空域。' : '你的战机坠毁，蓝队也未能守住空域。');
      this.hud.showResult({
        draw, victory,
        kills: player ? player.kills : 0,
        score: player ? player.score : 0,
        time: U.formatTime(this.matchTime),
        status: player ? (player.alive ? '幸存' : '被击落') : '—',
        subtitle
      });
      this.hud.update(this, .016);
    }

    trackedTargetValid() {
      return !!(this.player && this.player.selectedTarget && this.player.selectedTarget.alive);
    }
  }

  function showFatal(message) {
    const e = document.getElementById('errorScreen');
    const t = document.getElementById('errorText');
    if (t) t.textContent = message;
    if (e) e.classList.remove('hidden');
  }

  function boot() {
    if (!window.THREE) {
      showFatal('Three.js 未能加载。请确认 vendor/three.min.js 存在，并通过本地浏览器打开页面。');
      return;
    }
    try {
      window.__tsGame = new Game();
    } catch (err) {
      console.error(err);
      showFatal('启动失败：' + (err && err.message ? err.message : err) + '。请使用支持 WebGL 的 Chrome 或 Edge 打开。');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
