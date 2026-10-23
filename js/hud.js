/* Thunder Skies - battle HUD, radar, RWR, menu and settings UI */
(function (global) {
  'use strict';
  const TS = global.TS = global.TS || {};
  const U = TS.Utils;

  const $ = id => document.getElementById(id);

  class HUD {
    constructor(game) {
      this.game = game;
      this.input = TS.Input;
      this.settings = TS.Settings;
      this.fxCtx = $('hudFx').getContext('2d');
      this.radarCtx = $('radarCanvas').getContext('2d');
      this.rwrCtx = $('rwrCanvas').getContext('2d');
      this.hitMarkerTimer = 0;
      this.killfeed = [];
      this.toastTimer = 0;
      this.currentAircraft = 'p51';
      this.matchSize = 8;
      this.lastRadarDraw = 0;
      this.cacheDom();
      this.bind();
      this.selectAircraft('p51');
      this.selectSize(8);
      this.updateControlsText();
      this.buildBindings();
      this.setupTargetModuleBars();
      this.resizeHud();
    }

    cacheDom() {
      const ids = [
        'hud', 'hudFx', 'blueAlive', 'redAlive', 'objective', 'matchClock', 'headingText',
        'compassLeft', 'compassRight', 'topAlt', 'speedValue', 'altValue', 'vsValue',
        'throttleValue', 'throttleFill', 'boostMarker', 'engineValue', 'engineFill',
        'boostLabel', 'boostValue', 'boostFill', 'engineTemp', 'boostStatus',
        'hpFuselage', 'hpLeftWing', 'hpRightWing', 'hpTail', 'hpEngine',
        'flareCount', 'chaffCount', 'cmPanel', 'targetName', 'targetType', 'targetRange',
        'targetClosure', 'targetAltDiff', 'targetRadar', 'targetIr', 'targetModules', 'rwrStatus',
        'radarTitle', 'radarRange', 'radarMode', 'radarLock',
        'gunName', 'gunAmmo', 'irName', 'irAmmo', 'sarhName', 'sarhAmmo',
        'irWeapon', 'sarhWeapon', 'missilePhase', 'weaponHint', 'killfeed', 'toast',
        'warning', 'spectateBanner', 'scoreboard', 'scoreboardBody', 'scoreboardTime',
        'hints', 'menu', 'settings', 'help', 'pause', 'result', 'countdown', 'errorScreen', 'errorText',
        'aircraftList', 'showcaseClass', 'showcaseName', 'selectedName', 'selectedTier',
        'selectedDesc', 'statBars', 'armamentList', 'cmLoadoutBlock', 'cmTotal', 'cmSlider',
        'cmFlareValue', 'cmChaffValue', 'sortieBtn', 'bindingsGrid', 'settingsNote',
        'resetBindingsBtn', 'closeSettingsBtn', 'saveSettingsBtn', 'pauseStatus', 'pauseControls',
        'resumeBtn', 'pauseSettingsBtn', 'restartBtn', 'quitBtn', 'resultEyebrow', 'resultTitle',
        'resultSubtitle', 'resultKills', 'resultScore', 'resultTime', 'resultStatus',
        'resultAgainBtn', 'resultHangarBtn', 'openSettingsBtn', 'openHelpBtn', 'closeHelpBtn',
        'helpDoneBtn', 'menuControls', 'menuControls2', 'targetName'
      ];
      this.dom = {};
      ids.forEach(id => { this.dom[id] = $(id); });
      this.dom.rwrPanel = document.querySelector('.rwr-panel');
      this.dom.aircraftCards = Array.from(document.querySelectorAll('.aircraft-card'));
      this.dom.sizeButtons = Array.from(document.querySelectorAll('.size-btn'));
      this.dom.radarCanvas = $('radarCanvas');
      this.dom.rwrCanvas = $('rwrCanvas');
      this.targetModuleBars = [];
    }

    bind() {
      this.dom.aircraftCards.forEach(btn => {
        btn.addEventListener('click', () => {
          this.selectAircraft(btn.dataset.aircraft);
          this.game.audio.click();
        });
      });
      this.dom.sizeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          this.selectSize(Number(btn.dataset.size));
          this.game.audio.click();
        });
      });
      this.dom.cmSlider.addEventListener('input', () => {
        this.settings.setCmFlare(Number(this.dom.cmSlider.value));
        this.updateCmUi();
      });
      this.dom.sortieBtn.addEventListener('click', () => {
        this.game.audio.init();
        this.game.audio.click();
        this.game.startBattle();
      });
      this.dom.openSettingsBtn.addEventListener('click', () => this.openSettings());
      this.dom.closeSettingsBtn.addEventListener('click', () => this.closeSettings());
      this.dom.saveSettingsBtn.addEventListener('click', () => this.closeSettings());
      this.dom.resetBindingsBtn.addEventListener('click', () => {
        this.settings.resetBindings();
        this.buildBindings();
        this.updateControlsText();
        this.dom.settingsNote.textContent = '已恢复默认键位。';
      });
      this.dom.openHelpBtn.addEventListener('click', () => this.showHelp(true));
      this.dom.closeHelpBtn.addEventListener('click', () => this.showHelp(false));
      this.dom.helpDoneBtn.addEventListener('click', () => this.showHelp(false));
      this.dom.resumeBtn.addEventListener('click', () => this.game.resume());
      this.dom.pauseSettingsBtn.addEventListener('click', () => this.openSettings());
      this.dom.restartBtn.addEventListener('click', () => this.game.restart());
      this.dom.quitBtn.addEventListener('click', () => this.game.quitToHangar());
      this.dom.resultAgainBtn.addEventListener('click', () => this.game.restart());
      this.dom.resultHangarBtn.addEventListener('click', () => this.game.quitToHangar());
      this.dom.aircraftCards.forEach(b => b.addEventListener('mouseenter', () => this.game.audio.click()));
      window.addEventListener('resize', () => this.resizeHud());
    }

    resizeHud() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth, h = window.innerHeight;
      this.dom.hudFx.width = Math.round(w * dpr);
      this.dom.hudFx.height = Math.round(h * dpr);
      this.hudDpr = dpr;
      this.hudW = w; this.hudH = h;
      // radar/rwr canvases are CSS-sized; keep a crisp backing store
      const rc = this.dom.radarCanvas;
      rc.width = 460; rc.height = 460;
      const rw = this.dom.rwrCanvas;
      rw.width = 300; rw.height = 300;
    }

    setupTargetModuleBars() {
      this.dom.targetModules.innerHTML = '';
      this.targetModuleBars = [];
      ['fuselage', 'leftWing', 'rightWing', 'tail', 'engine'].forEach(name => {
        const i = document.createElement('i');
        const b = document.createElement('b');
        i.appendChild(b);
        this.dom.targetModules.appendChild(i);
        this.targetModuleBars.push(b);
      });
    }

    selectAircraft(id) {
      const cfg = TS.CONFIG.getAircraft(id);
      this.currentAircraft = id;
      this.game.setSelectedAircraft(id);
      this.dom.aircraftCards.forEach(b => b.classList.toggle('selected', b.dataset.aircraft === id));
      this.dom.showcaseClass.textContent = cfg.classNameEn;
      this.dom.showcaseName.textContent = `${cfg.shortName.toUpperCase()} / ${cfg.className}`;
      this.dom.selectedName.textContent = cfg.displayName;
      this.dom.selectedTier.textContent = cfg.tier;
      this.dom.selectedDesc.textContent = cfg.description;
      // stats
      const stats = [
        ['极速', cfg.stats.speed], ['盘旋', cfg.stats.turn],
        ['火力', cfg.stats.fire], ['生存', cfg.stats.survival]
      ];
      this.dom.statBars.innerHTML = stats.map(([label, val]) =>
        `<div class="stat-row"><span>${label}</span><i><b style="width:${val}%"></b></i><span>${val}</span></div>`
      ).join('');
      // armament
      const rows = [];
      rows.push([cfg.guns.name, `${cfg.guns.ammo} 发`]);
      rows.push(['发动机', cfg.engine.boostLabel === 'A/B' ? '涡喷 + 加力' : cfg.engine.boostLabel === 'WEP' ? '活塞机械增压 + WEP' : '涡喷 + 应急推力']);
      if (cfg.radar) rows.push(['雷达', `${Math.round(cfg.radar.range / 1000)} km 脉冲搜索`]);
      if (cfg.missiles) {
        rows.push(['红外弹', `AIM-9E ×${cfg.missiles.ir}`]);
        rows.push(['雷达弹', `AIM-7E-2 ×${cfg.missiles.sarh}`]);
      }
      if (cfg.countermeasures) rows.push(['干扰弹', '总量 60 枚 · 可分配']);
      if (cfg.rwr) rows.push(['RWR', '雷达锁定 / 发射告警']);
      this.dom.armamentList.innerHTML = rows.map(([a, b]) =>
        `<div><span>${a}</span><b>${b}</b></div>`
      ).join('');
      const cm = !!(cfg.countermeasures);
      this.dom.cmLoadoutBlock.classList.toggle('hidden', !cm);
      this.updateCmUi();
      this.showcaseModelRefresh && this.showcaseModelRefresh(id);
      if (this.game.onAircraftSelectionChanged) this.game.onAircraftSelectionChanged(id);
    }

    updateCmUi() {
      const val = this.settings.cmFlare;
      this.dom.cmSlider.value = val;
      this.dom.cmFlareValue.textContent = val;
      this.dom.cmChaffValue.textContent = this.settings.CM_TOTAL - val;
      this.dom.cmTotal.textContent = `${this.settings.CM_TOTAL} 枚`;
    }

    selectSize(n) {
      this.matchSize = n;
      this.game.setMatchSize(n);
      this.dom.sizeButtons.forEach(b => b.classList.toggle('active', Number(b.dataset.size) === n));
    }

    updateControlsText() {
      const s = this.settings;
      this.dom.menuControls.textContent =
        `鼠标瞄准 · ${s.labelForAction('pitchUp')}/${s.labelForAction('pitchDown')} 俯仰 · ` +
        `${s.labelForAction('rollLeft')}/${s.labelForAction('rollRight')} 滚转 · ` +
        `${s.labelForAction('yawLeft')}/${s.labelForAction('yawRight')} 偏航`;
      this.dom.menuControls2.textContent =
        `${s.labelForAction('throttleUp')}/${s.labelForAction('throttleDown')} 油门（含加力） · ` +
        `${s.labelForAction('freeLook')} 按住环视 · ${s.labelForAction('fireGun')} 机炮 · ${s.labelForAction('fireMissile')} 导弹 · ${s.labelForAction('zoom')} 切换 5×`;
      this.dom.hints.innerHTML = [
        '鼠标瞄准',
        `${s.labelForAction('freeLook')} 按住环视`,
        `${s.labelForAction('fireGun')} 机炮`,
        `${s.labelForAction('fireMissile')} 导弹`,
        `${s.labelForAction('zoom')} 5×`,
        `${s.labelForAction('targetNext')} 目标`,
        `${s.labelForAction('flare')}/${s.labelForAction('chaff')} 干扰`
      ].map(x => `<span>${x}</span>`).join('');
      this.dom.pauseControls.innerHTML =
        `<b>飞行</b> 鼠标瞄准 · ${s.labelForAction('pitchUp')}/${s.labelForAction('pitchDown')} 俯仰 · ` +
        `${s.labelForAction('rollLeft')}/${s.labelForAction('rollRight')} 滚转 · ` +
        `${s.labelForAction('yawLeft')}/${s.labelForAction('yawRight')} 偏航 · ` +
        `${s.labelForAction('throttleUp')}/${s.labelForAction('throttleDown')} 油门<br>` +
        `<b>武器</b> ${s.labelForAction('fireGun')} 机炮 · ${s.labelForAction('fireMissile')} 导弹 · ` +
        `${s.labelForAction('targetNext')} 目标 · ${s.labelForAction('zoom')} 切换 5× · ${s.labelForAction('flare')} 热诱 · ${s.labelForAction('chaff')} 箔条<br>` +
        `<b>其他</b> ${s.labelForAction('freeLook')} 自由观察 · ${s.labelForAction('scoreboard')} 战况板 · ${s.labelForAction('mute')} 静音`;
    }

    openSettings() {
      this.buildBindings();
      this.dom.settingsNote.textContent = this.settings.available
        ? '浏览器可能保留 Ctrl+W 等组合快捷键，如有冲突请重新绑定。'
        : '本地存储不可用，修改只在本次游戏中有效。';
      this.dom.settings.classList.add('active');
    }

    closeSettings() {
      if (this.input.capturing) this.input.cancelCapture();
      this.dom.settings.classList.remove('active');
    }

    buildBindings() {
      const groups = {};
      this.settings.actions.forEach(a => {
        if (!groups[a.group]) groups[a.group] = [];
        groups[a.group].push(a);
      });
      const html = [];
      Object.keys(groups).forEach(group => {
        html.push(`<div class="binding-group">${group}</div>`);
        groups[group].forEach(a => {
          const label = this.settings.labelForAction(a.id);
          html.push(`<div class="binding-row" data-action="${a.id}"><span>${a.label}</span><button class="binding-key" data-action="${a.id}">${label}</button></div>`);
        });
      });
      this.dom.bindingsGrid.innerHTML = html.join('');
      this.dom.bindingsGrid.querySelectorAll('.binding-key').forEach(btn => {
        btn.addEventListener('click', () => this.captureBinding(btn));
      });
    }

    captureBinding(btn) {
      this.input.startCapture(btn.dataset.action, (result) => {
        if (result.ok) {
          this.dom.settingsNote.textContent = '键位已更新并保存。';
          this.buildBindings();
          this.updateControlsText();
        } else if (result.reason === 'conflict') {
          this.dom.settingsNote.textContent = `无法绑定：该键已用于「${result.label}」，请先修改另一个动作。`;
          this.buildBindings();
        } else if (result.reason === 'reserved') {
          this.dom.settingsNote.textContent = 'Esc 是固定的界面保险键，不能绑定到战斗动作。';
          this.buildBindings();
        } else if (result.reason === 'browser') {
          this.dom.settingsNote.textContent = '该功能键被浏览器保留，请选择其他按键。';
          this.buildBindings();
        } else {
          this.buildBindings();
        }
      });
      btn.classList.add('capturing');
      btn.textContent = '按下按键或鼠标键…';
    }

    showHelp(show) {
      this.dom.help.classList.toggle('active', !!show);
    }

    showMenu(show) {
      this.dom.menu.classList.toggle('active', !!show);
      if (show) this.dom.hud.classList.add('hidden');
    }

    showHud(show) {
      this.dom.hud.classList.toggle('hidden', !show);
    }

    showPause(show, statusText) {
      this.dom.pause.classList.toggle('active', !!show);
      if (statusText) this.dom.pauseStatus.textContent = statusText;
    }

    showResult(result) {
      this.dom.result.classList.add('active');
      this.dom.pause.classList.remove('active');
      this.dom.settings.classList.remove('active');
      this.dom.resultEyebrow.textContent = result.draw ? 'MUTUAL DESTRUCTION' : (result.victory ? 'MISSION COMPLETE' : 'MISSION FAILED');
      this.dom.resultTitle.textContent = result.draw ? '平局' : (result.victory ? '蓝队胜利' : '蓝队战败');
      this.dom.resultTitle.style.color = result.draw ? 'var(--ink)' : (result.victory ? 'var(--gold)' : 'var(--red)');
      this.dom.resultSubtitle.textContent = result.subtitle || '';
      this.dom.resultKills.textContent = result.kills;
      this.dom.resultScore.textContent = result.score;
      this.dom.resultTime.textContent = result.time;
      this.dom.resultStatus.textContent = result.status;
    }

    hideResult() { this.dom.result.classList.remove('active'); }

    showCountdown(text) {
      if (text == null) {
        this.dom.countdown.classList.add('hidden');
        return;
      }
      this.dom.countdown.classList.remove('hidden');
      const b = this.dom.countdown.querySelector('b');
      b.textContent = text;
      b.classList.remove('pop');
      void b.offsetWidth;
      b.classList.add('pop');
    }

    setSpectating(on) {
      this.dom.spectateBanner.classList.toggle('hidden', !on);
    }

    toast(text, duration = 2.2) {
      if (!text) return;
      this.dom.toast.textContent = text;
      this.dom.toast.classList.add('show');
      this.toastTimer = duration;
    }

    addKill(killer, victim, killerTeam, victimTeam) {
      const el = document.createElement('div');
      const kc = killerTeam || 'neutral';
      const vc = victimTeam || 'neutral';
      el.innerHTML = `<span class="${kc}">${killer}</span> <span>击落</span> <span class="${vc}">${victim}</span>`;
      this.dom.killfeed.appendChild(el);
      while (this.dom.killfeed.children.length > 6) this.dom.killfeed.removeChild(this.dom.killfeed.firstChild);
      this.killfeed.push({ el, ttl: 6 });
    }

    showHitMarker() { this.hitMarkerTimer = .14; }

    setWarning(text) {
      if (text) {
        this.dom.warning.textContent = text;
        this.dom.warning.classList.remove('hidden');
      } else {
        this.dom.warning.classList.add('hidden');
      }
    }

    updateScoreboard(game) {
      if (!game || !game.fighters) return;
      const live = game.isScoreboardVisible();
      this.dom.scoreboard.classList.toggle('hidden', !live);
      if (!live) return;
      const blue = game.fighters.filter(f => f.team === 'blue');
      const red = game.fighters.filter(f => f.team === 'red');
      const row = (f, color) => `<div class="pilot ${color} ${f.alive ? '' : 'dead'}"><b>${f.callsign}${f.isPlayer ? ' (你)' : ''}</b><span>${f.alive ? f.cfg.shortName : '已击落'}</span><span>${f.kills}</span></div>`;
      this.dom.scoreboardBody.innerHTML =
        `<div class="team-col">${blue.map(f => row(f, 'blue')).join('')}</div>` +
        `<div class="team-col">${red.map(f => row(f, 'red')).join('')}</div>`;
      this.dom.scoreboardTime.textContent = U.formatTime(Math.max(0, game.matchRemaining()));
    }

    update(game, dt) {
      const player = game.getHudSubject ? game.getHudSubject() : game.player;
      if (!player) return;
      // timers
      if (this.hitMarkerTimer > 0) this.hitMarkerTimer = Math.max(0, this.hitMarkerTimer - dt);
      if (this.toastTimer > 0) {
        this.toastTimer -= dt;
        if (this.toastTimer <= 0) this.dom.toast.classList.remove('show');
      }
      for (let i = this.killfeed.length - 1; i >= 0; i--) {
        const k = this.killfeed[i];
        k.ttl -= dt;
        if (k.ttl <= 0) {
          k.el.remove();
          this.killfeed.splice(i, 1);
        }
      }
      this.dom.blueAlive.textContent = game.aliveCount('blue');
      this.dom.redAlive.textContent = game.aliveCount('red');
      this.dom.matchClock.textContent = U.formatTime(game.matchRemaining());
      this.dom.objective.textContent = game.state === 'spectating' ? '观战 · 我方战斗继续' : '歼灭敌方机群';
      const heading = player.getHeading();
      this.dom.headingText.textContent = String(Math.round(heading)).padStart(3, '0');
      this.dom.compassLeft.textContent = U.cardinal((heading + 315) % 360);
      this.dom.compassRight.textContent = U.cardinal((heading + 45) % 360);
      this.dom.topAlt.textContent = Math.round(player.pos.y);
      this.dom.speedValue.textContent = Math.round(player.speed * 3.6);
      this.dom.altValue.textContent = `${Math.round(player.pos.y)} m`;
      const vs = (player.pos.y - player.prevPos.y) / Math.max(.001, game.lastDt || .016);
      this.dom.vsValue.textContent = `${vs >= 0 ? '+' : ''}${Math.round(vs)} m/s`;
      this.dom.throttleValue.textContent = `${Math.round(player.throttle)}%`;
      this.dom.throttleFill.style.width = `${U.clamp(player.throttle / 110 * 100, 0, 100)}%`;
      this.dom.engineValue.textContent = `${Math.round(player.engineOut ? 0 : player.enginePower)}%`;
      this.dom.engineFill.style.width = `${U.clamp(player.engineOut ? 0 : player.enginePower, 0, 100)}%`;
      const maxBoost = player.cfg.engine.maxBoostTime;
      const remaining = Math.max(0, maxBoost - player.boostSeconds);
      this.dom.boostLabel.textContent = player.cfg.engine.boostLabel === 'A/B' ? '加力可用' : '应急加力';
      this.dom.boostValue.textContent = player.engineOut ? 'ENGINE OUT' : player.boostExceeded ? '过热!' : `${remaining.toFixed(1)}s`;
      this.dom.boostFill.style.width = `${U.clamp(remaining / maxBoost * 100, 0, 100)}%`;
      this.dom.boostFill.style.background = player.boostExceeded ? 'var(--red)' : '';
      this.dom.engineTemp.textContent = `油温 ${Math.round(player.heat || 0)}°C`;
      this.dom.boostStatus.textContent = player.engineOut ? 'ENGINE STOP' : player.throttle > 100.2 ? (player.cfg.engine.boostLabel === 'A/B' ? 'AFTERBURNER' : 'BOOST') : 'MIL';
      this.dom.boostStatus.style.color = player.boostExceeded ? 'var(--red)' : (player.throttle > 100.2 ? 'var(--gold)' : '');
      // modules
      this.setModuleBar(this.dom.hpFuselage, player.getModuleRatio('fuselage'));
      this.setModuleBar(this.dom.hpLeftWing, player.getModuleRatio('leftWing'));
      this.setModuleBar(this.dom.hpRightWing, player.getModuleRatio('rightWing'));
      this.setModuleBar(this.dom.hpTail, player.getModuleRatio('tail'));
      this.setModuleBar(this.dom.hpEngine, player.getModuleRatio('engine'));
      this.dom.flareCount.textContent = player.flares;
      this.dom.chaffCount.textContent = player.chaff;
      this.dom.cmPanel.classList.toggle('hidden', !player.cfg.countermeasures);
      // weapons
      this.dom.gunName.textContent = player.cfg.guns.short;
      this.dom.gunAmmo.textContent = player.gunAmmo;
      this.dom.irName.textContent = TS.CONFIG.MISSILES.ir.name;
      this.dom.sarhName.textContent = TS.CONFIG.MISSILES.sarh.name;
      this.dom.irAmmo.textContent = player.missileCounts.ir;
      this.dom.sarhAmmo.textContent = player.missileCounts.sarh;
      this.dom.irWeapon.classList.toggle('empty', player.missileCounts.ir <= 0);
      this.dom.sarhWeapon.classList.toggle('empty', player.missileCounts.sarh <= 0);
      this.dom.irWeapon.classList.toggle('selected', player.selectedMissile === 'ir' && player.missileCounts.ir > 0);
      this.dom.sarhWeapon.classList.toggle('selected', player.selectedMissile === 'sarh' && player.missileCounts.sarh > 0);
      this.dom.irWeapon.style.opacity = player.cfg.missiles ? '' : '.35';
      this.dom.sarhWeapon.style.opacity = player.cfg.missiles ? '' : '.35';
      this.dom.weaponHint.textContent = player.cfg.missiles
        ? `${this.settings.labelForAction('selectIR')} 红外 · ${this.settings.labelForAction('selectSARH')} 雷达 · ${this.settings.labelForAction('fireMissile')} 发射`
        : '本机仅装备机炮';
      const last = player.lastMissile;
      if (last && last.alive) {
        const phaseLabel = last.phase === 'launch' ? '点火' :
          last.phase === 'boost' ? '助推段' :
            last.phase === 'sustain' ? '续航段' : '滑翔段';
        this.dom.missilePhase.textContent = `${last.cfg.name} · ${phaseLabel} · ${Math.round(last.speed)} m/s`;
      } else {
        this.dom.missilePhase.textContent = '';
      }
      // target
      this.updateTarget(player, game);
      this.updateRwr(player);
      this.drawRadar(player, game);
      this.updateScoreboard(game);
      this.updateWarnings(player, game);
      this.drawHud(player, game, dt);
      this.dom.rwrPanel.classList.toggle('hidden', !player.cfg.rwr);
      this.dom.radarTitle.textContent = player.cfg.radar ? 'F-4E RADAR' : 'TACTICAL MAP';
      this.dom.radarRange.textContent = player.cfg.radar ? '38 KM' : '12 KM';
      this.dom.radarMode.textContent = player.cfg.radar ? (player.radar.lockValid ? 'STT LOCK' : 'SEARCH') : 'VISUAL';
      this.dom.radarLock.textContent = player.radar && player.radar.lockValid ? 'LOCK' : 'NO LOCK';
      this.dom.radarLock.style.color = player.radar && player.radar.lockValid ? 'var(--gold)' : '';
    }

    setModuleBar(el, ratio) {
      if (!el) return;
      el.style.width = `${U.clamp(ratio, 0, 1) * 100}%`;
      el.style.background = ratio < .28 ? 'var(--red)' : ratio < .6 ? 'var(--orange)' : 'var(--green)';
    }

    updateTarget(player, game) {
      const t = player.selectedTarget;
      if (!t || !t.alive) {
        this.dom.targetName.textContent = '无锁定';
        this.dom.targetType.textContent = player.cfg.radar ? 'SEARCH' : 'VISUAL';
        this.dom.targetRange.textContent = '---';
        this.dom.targetClosure.textContent = '---';
        this.dom.targetAltDiff.textContent = '---';
        this.dom.targetRadar.textContent = player.radar && player.radar.lockValid ? 'LOCK' : 'NO LOCK';
        this.dom.targetRadar.style.color = '';
        this.dom.targetIr.textContent = player.cfg.missiles ? 'NO SEEKER' : '—';
        this.dom.targetIr.style.color = '';
        this.targetModuleBars.forEach(b => b.style.width = '0%');
        return;
      }
      const dist = player.pos.distanceTo(t.pos);
      const toT = new THREE.Vector3().subVectors(t.pos, player.pos).normalize();
      const closure = -player.getVelocity(new THREE.Vector3()).sub(t.getVelocity(new THREE.Vector3())).dot(toT);
      this.dom.targetName.textContent = `${t.callsign} · ${t.cfg.shortName}`;
      this.dom.targetType.textContent = t.team === 'red' ? 'HOSTILE' : 'FRIENDLY';
      this.dom.targetType.style.color = t.team === 'red' ? 'var(--red)' : 'var(--blue)';
      this.dom.targetRange.textContent = `${(dist / 1000).toFixed(dist < 2000 ? 2 : 1)} km`;
      this.dom.targetClosure.textContent = `${closure >= 0 ? '+' : ''}${Math.round(closure)} m/s`;
      this.dom.targetAltDiff.textContent = `${t.pos.y - player.pos.y >= 0 ? '+' : ''}${Math.round(t.pos.y - player.pos.y)} m`;
      const locked = player.radar && player.radar.lockValid && player.radar.lockTarget === t;
      this.dom.targetRadar.textContent = locked ? 'LOCK' : (player.radar ? 'NO LOCK' : 'VISUAL');
      this.dom.targetRadar.style.color = locked ? 'var(--gold)' : '';
      if (player.cfg.missiles) {
        const ir = TS.MissileHelper.canLaunch(game, player, t, 'ir');
        this.dom.targetIr.textContent = ir.ok ? 'LOCK' : (player.missileCounts.ir > 0 ? (ir.reason || 'NO LOCK') : 'NO MISSILE');
        this.dom.targetIr.style.color = ir.ok ? 'var(--gold)' : '';
      } else {
        this.dom.targetIr.textContent = '—';
        this.dom.targetIr.style.color = '';
      }
      const mods = t.getDamageSummary();
      const vals = [mods.fuselage, mods.leftWing, mods.rightWing, mods.tail, mods.engine];
      this.targetModuleBars.forEach((b, i) => {
        b.style.width = `${vals[i] * 100}%`;
        b.style.background = vals[i] < .28 ? 'var(--red)' : vals[i] < .6 ? 'var(--orange)' : 'var(--red)';
        b.style.opacity = .42 + vals[i] * .5;
      });
    }

    updateWarnings(player, game) {
      let warning = '';
      const agl = player.pos.y - game.world.heightAt(player.pos.x, player.pos.z);
      if (player.engineOut) warning = '发动机停车 · 立即寻找迫降机会';
      else if (player.boostExceeded || player.heat > 135) warning = '发动机过热 · 收油门冷却';
      else if (agl < 260 && player.forward.y < -.1) warning = '拉起！地形接近';
      else if (player.getModuleRatio('leftWing') < .25 || player.getModuleRatio('rightWing') < .25) warning = '翼面严重受损';
      else if (player.speed < player.cfg.flight.stallSpeed * 1.25) warning = '速度过低 · 注意失速';
      else if (Math.hypot(player.pos.x, player.pos.z) > 17200) warning = '离开战区 · 请返航';
      this.setWarning(warning);
    }

    updateRwr(player) {
      const ctx = this.rwrCtx;
      const canvas = this.dom.rwrCanvas;
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2, r = w * .39;
      ctx.strokeStyle = 'rgba(131,224,238,.2)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(131,224,238,.08)';
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath(); ctx.arc(cx, cy, r * i / 3, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(cx - 8, cy); ctx.lineTo(cx + 8, cy);
      ctx.moveTo(cx, cy - 8); ctx.lineTo(cx, cy + 8);
      ctx.strokeStyle = 'rgba(131,224,238,.4)'; ctx.stroke();
      ctx.fillStyle = 'rgba(131,224,238,.8)';
      ctx.beginPath(); ctx.moveTo(cx, cy - 8); ctx.lineTo(cx - 4, cy - 2); ctx.lineTo(cx + 4, cy - 2); ctx.closePath(); ctx.fill();
      if (!player.cfg.rwr) {
        this.dom.rwrStatus.textContent = '本机无 RWR';
        this.dom.rwrStatus.classList.remove('active');
        return;
      }
      const rwr = player.rwr;
      const active = rwr.status !== 'CLEAR';
      this.dom.rwrStatus.textContent = rwr.status === 'MISSILE' ? '雷达弹发射！' : rwr.status === 'LOCKED' ? '被雷达锁定' : '无告警';
      this.dom.rwrStatus.classList.toggle('active', active);
      const threats = rwr.threats || [];
      threats.forEach(th => {
        const ang = th.rel - Math.PI / 2; // display forward at top: bearing 0 -> top
        const rr = r * .78;
        const x = cx + Math.cos(ang) * rr;
        const y = cy + Math.sin(ang) * rr;
        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = th.type === 'missile' ? '#ff6259' : '#ffbe65';
        ctx.strokeStyle = 'rgba(255,255,255,.7)';
        if (th.type === 'missile') {
          ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(7, 0); ctx.lineTo(0, 8); ctx.lineTo(-7, 0); ctx.closePath(); ctx.fill();
        } else {
          ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(6, 6); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      });
    }

    drawRadar(player, game) {
      const ctx = this.radarCtx;
      const canvas = this.dom.radarCanvas;
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(3, 10, 12, .68)';
      ctx.fillRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2, r = w * .43;
      // background radial
      const grd = ctx.createRadialGradient(cx, cy, 6, cx, cy, r);
      grd.addColorStop(0, 'rgba(41, 104, 98, .22)');
      grd.addColorStop(1, 'rgba(10, 24, 25, .16)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      // range rings
      ctx.font = `${Math.max(14, w * .035)}px Bahnschrift, Segoe UI, sans-serif`;
      ctx.textAlign = 'left';
      const maxRange = player.cfg.radar ? 38000 : 12000;
      const rings = player.cfg.radar ? [10000, 20000, 30000, 38000] : [3000, 6000, 9000, 12000];
      rings.forEach(range => {
        const rr = U.clamp(range / maxRange, 0, 1) * r;
        ctx.strokeStyle = 'rgba(131,224,238,.14)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(170,209,206,.45)';
        ctx.fillText(`${Math.round(range / 1000)}`, cx + 5, cy - rr + 15);
      });
      // forward cone for radar
      if (player.cfg.radar) {
        ctx.strokeStyle = 'rgba(131,224,238,.14)';
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        const left = -Math.PI / 2 - U.rad(45);
        const right = -Math.PI / 2 + U.rad(45);
        ctx.lineTo(cx + Math.cos(left) * r, cy + Math.sin(left) * r);
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(right) * r, cy + Math.sin(right) * r);
        ctx.stroke();
        // clutter noise based on look-down; static seed-ish
        const alt = player.pos.y;
        const clutterStrength = U.clamp((3800 - alt) / 3000, 0, 1);
        if (clutterStrength > 0) {
          const count = Math.floor(20 + 60 * clutterStrength);
          for (let i = 0; i < count; i++) {
            const a = Math.random() * Math.PI * 2;
            const rr = Math.sqrt(Math.random()) * r * (0.35 + clutterStrength * .5);
            const xx = cx + Math.cos(a) * rr;
            const yy = cy + Math.sin(a) * rr;
            ctx.fillStyle = `rgba(131, 224, 180, ${.03 + Math.random() * .09})`;
            ctx.fillRect(xx, yy, 2, 2);
          }
        }
      }
      const contacts = player.radar ? (player.radar.contacts || []) : [];
      const drawBlip = (pos, color, size = 5, lock = false, ghost = false) => {
        const vec = pos.clone().sub(player.pos);
        const dist = vec.length();
        if (dist > maxRange) return;
        const bearing = Math.atan2(vec.x, -vec.z);
        const rel = bearing - U.rad(player.getHeading());
        const rr = U.clamp(dist / maxRange, 0, 1) * r;
        const x = cx + Math.sin(rel) * rr;
        const y = cy - Math.cos(rel) * rr;
        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.globalAlpha = ghost ? .3 : .95;
        ctx.beginPath();
        if (lock) {
          ctx.strokeRect(-size, -size, size * 2, size * 2);
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(0, -size - 4); ctx.lineTo(0, -size - 1); ctx.moveTo(0, size + 1); ctx.lineTo(0, size + 4);
          ctx.moveTo(-size - 4, 0); ctx.lineTo(-size - 1, 0); ctx.moveTo(size + 1, 0); ctx.lineTo(size + 4, 0); ctx.stroke();
        } else {
          ctx.arc(0, 0, size, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      };
      if (player.cfg.radar) {
        contacts.forEach(c => {
          if (c.clutter) return;
          const isLocked = player.radar.lockTarget === c.fighter;
          drawBlip(c.fighter.pos, isLocked ? '#ffd57a' : '#ff766d', isLocked ? 6 : 4, isLocked);
        });
        (player.radar.falseContacts || []).forEach(fc => {
          drawBlip(fc.pos, '#c5ded7', 3, false, true);
        });
        ctx.strokeStyle = 'rgba(131,224,238,.12)';
        ctx.beginPath(); ctx.moveTo(cx - 14, cy); ctx.lineTo(cx + 14, cy); ctx.moveTo(cx, cy - 14); ctx.lineTo(cx, cy + 14); ctx.stroke();
      } else {
        // tactical map: friendlies and nearby hostiles, north-up style with forward up
        for (const f of game.fighters) {
          if (!f.alive || f === player) continue;
          const vec = f.pos.clone().sub(player.pos);
          const dist = vec.length();
          if (f.team === player.team && dist < 12000) {
            drawBlip(f.pos, '#6fb7ff', 3, false, false);
          } else if (f.team !== player.team && (dist < 12000 || f === player.selectedTarget)) {
            drawBlip(f.pos, f === player.selectedTarget ? '#ffd57a' : '#ff766d', f === player.selectedTarget ? 6 : 4, f === player.selectedTarget);
          }
        }
        ctx.fillStyle = 'rgba(131,224,238,.65)';
        ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
      }
      // sweep line
      if (player.cfg.radar) {
        const t = (game.time || 0) * .9;
        const sweep = -Math.PI / 2 + Math.sin(t) * U.rad(55);
        ctx.strokeStyle = 'rgba(131,224,238,.18)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(sweep) * r, cy + Math.sin(sweep) * r); ctx.stroke();
      }
    }

    drawHud(player, game, dt) {
      const ctx = this.fxCtx;
      const w = this.hudW, h = this.hudH;
      ctx.setTransform(this.hudDpr, 0, 0, this.hudDpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!this.game.inBattleView()) return;
      const cx = w / 2, cy = h / 2;
      const camera = game.world.camera;
      const project = pos => {
        const v = pos.clone().project(camera);
        if (v.z < -1 || v.z > 1) return null;
        return { x: (v.x * .5 + .5) * w, y: (-v.y * .5 + .5) * h, behind: v.z > 1 };
      };

      // target markers
      let count = 0;
      const sorted = game.fighters.filter(f => f.alive && f !== player).sort((a, b) => a.pos.distanceTo(player.pos) - b.pos.distanceTo(player.pos));
      for (const f of sorted) {
        const dist = f.pos.distanceTo(player.pos);
        if (f.team !== player.team && dist > 15000 && player.selectedTarget !== f) continue;
        if (f.team === player.team && dist > 13000) continue;
        if (count > 15) break;
        const p = project(f.pos);
        if (!p || p.x < -100 || p.x > w + 100 || p.y < -100 || p.y > h + 100) {
          if (f === player.selectedTarget) this.drawTargetArrow(ctx, cx, cy, f.pos, camera, w, h, f);
          continue;
        }
        count++;
        const isSelected = player.selectedTarget === f;
        const isLocked = player.radar && player.radar.lockValid && player.radar.lockTarget === f;
        if (f.team === player.team) {
          this.drawFriendlyMarker(ctx, p.x, p.y, f, dist, isSelected);
        } else {
          this.drawEnemyMarker(ctx, p.x, p.y, f, dist, isSelected, isLocked);
        }
      }

      // central gun reticle and mouse steering ring (hidden while orbiting)
      if (!this.input.isDown('freeLook')) {
        ctx.save();
        ctx.strokeStyle = 'rgba(214, 249, 247, .85)';
        ctx.fillStyle = 'rgba(214, 249, 247, .85)';
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(cx, cy, 11, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - 21, cy); ctx.lineTo(cx - 13, cy); ctx.moveTo(cx + 13, cy); ctx.lineTo(cx + 21, cy); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, 1.4, 0, Math.PI * 2); ctx.fill();
        // The amber aim marker is the world-space flight-director point. Since
        // the camera follows the nose, it visibly drifts back to the centre as
        // the aircraft turns toward it.
        const camera = game.world.camera;
        const camFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const aimFront = game.aimDir.dot(camFwd);
        if (aimFront > .02) {
          const aimWorld = game.player.pos.clone().addScaledVector(game.aimDir, 1200);
          const v = aimWorld.project(camera);
          let ax = (v.x * .5 + .5) * w;
          let ay = (-v.y * .5 + .5) * h;
          ax = U.clamp(ax, 26, w - 26);
          ay = U.clamp(ay, 26, h - 26);
          ctx.strokeStyle = 'rgba(242, 197, 109, .18)';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ax, ay); ctx.stroke();
          ctx.strokeStyle = 'rgba(242, 197, 109, .72)';
          ctx.beginPath(); ctx.arc(ax, ay, 9, 0, Math.PI * 2); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(ax - 3, ay); ctx.lineTo(ax + 3, ay); ctx.moveTo(ax, ay - 3); ctx.lineTo(ax, ay + 3); ctx.stroke();
        }
        ctx.restore();
      }
      if (this.input.isDown('freeLook')) {
        ctx.fillStyle = 'rgba(242,197,109,.75)';
        ctx.font = '11px Bahnschrift, Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('自由观察 · 围绕机体旋转 · 松开返回瞄准', cx, cy + 54);
      } else if (game.zoomActive) {
        ctx.fillStyle = 'rgba(242,197,109,.7)';
        ctx.font = '10px Bahnschrift, Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('ZOOM ×5', cx, cy + 44);
      }
      // hit marker
      if (this.hitMarkerTimer > 0) {
        ctx.strokeStyle = 'rgba(255, 224, 135, .9)';
        ctx.lineWidth = 1.5;
        const s = 5;
        ctx.beginPath();
        ctx.moveTo(cx - 8, cy - 8); ctx.lineTo(cx - 8 + s, cy - 8 + s);
        ctx.moveTo(cx + 8, cy - 8); ctx.lineTo(cx + 8 - s, cy - 8 + s);
        ctx.moveTo(cx - 8, cy + 8); ctx.lineTo(cx - 8 + s, cy + 8 - s);
        ctx.moveTo(cx + 8, cy + 8); ctx.lineTo(cx + 8 - s, cy + 8 - s);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawTargetArrow(ctx, cx, cy, pos, camera, w, h, f) {
      const v = pos.clone().project(camera);
      let x = v.x, y = -v.y;
      if (v.z > 1) { x = -x; y = -y; }
      const angle = Math.atan2(y, x);
      const rx = Math.min(w, h) * .37;
      const px = cx + Math.cos(angle) * rx;
      const py = cy + Math.sin(angle) * rx;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(angle + Math.PI / 2);
      ctx.fillStyle = 'rgba(255, 102, 94, .9)';
      ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(5, 4); ctx.lineTo(-5, 4); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.fillStyle = 'rgba(255, 172, 139, .8)';
      ctx.font = '10px Bahnschrift, Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(f.callsign, px, py + 18);
    }

    drawFriendlyMarker(ctx, x, y, f, dist, selected) {
      ctx.save();
      ctx.translate(x, y);
      ctx.strokeStyle = 'rgba(111, 183, 255, .65)';
      ctx.fillStyle = 'rgba(111, 183, 255, .7)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(4, 0); ctx.lineTo(0, 4); ctx.lineTo(-4, 0); ctx.closePath(); ctx.stroke();
      ctx.font = '9px Bahnschrift, Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(143, 195, 238, .62)';
      ctx.fillText(`${f.callsign} ${Math.round(dist / 100) / 10}km`, 0, -10);
      ctx.restore();
    }

    drawEnemyMarker(ctx, x, y, f, dist, selected, locked) {
      const size = selected ? 15 : 8;
      ctx.save();
      ctx.translate(x, y);
      ctx.strokeStyle = selected ? (locked ? 'rgba(242,197,109,.95)' : 'rgba(255,110,97,.85)') : 'rgba(255,110,97,.65)';
      ctx.lineWidth = selected ? 1.4 : 1;
      const c = 5;
      ctx.beginPath();
      ctx.moveTo(-size, -size + c); ctx.lineTo(-size, -size); ctx.lineTo(-size + c, -size);
      ctx.moveTo(size, -size + c); ctx.lineTo(size, -size); ctx.lineTo(size - c, -size);
      ctx.moveTo(-size, size - c); ctx.lineTo(-size, size); ctx.lineTo(-size + c, size);
      ctx.moveTo(size, size - c); ctx.lineTo(size, size); ctx.lineTo(size - c, size);
      ctx.stroke();
      if (selected) {
        ctx.fillStyle = 'rgba(255, 110, 97, .8)';
        ctx.font = '10px Bahnschrift, Segoe UI, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`${f.callsign} · ${(dist / 1000).toFixed(1)} km`, size + 6, -4);
        const mods = f.getDamageSummary();
        const barW = 44;
        ctx.fillStyle = 'rgba(0,0,0,.35)';
        ctx.fillRect(size + 7, 4, barW, 4);
        ctx.fillStyle = mods.fuselage > .5 ? 'rgba(255,110,97,.76)' : 'rgba(255,75,65,.9)';
        ctx.fillRect(size + 7, 4, barW * mods.fuselage, 4);
      }
      ctx.restore();
    }

    menuStart() {
      this.game.audio.init();
      this.game.audio.click();
      this.game.startBattle();
    }
  }

  TS.HUD = HUD;
})(window);
