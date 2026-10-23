/* Thunder Skies - bindings and local settings */
(function (global) {
  'use strict';
  const TS = global.TS = global.TS || {};
  const STORAGE_KEY = 'thunderskies.settings.v1';
  const CM_TOTAL = 60;

  const ACTIONS = [
    { group: '飞行控制', id: 'pitchUp', label: '抬头 / 俯仰上', def: 'KeyW' },
    { group: '飞行控制', id: 'pitchDown', label: '低头 / 俯仰下', def: 'KeyS' },
    { group: '飞行控制', id: 'rollLeft', label: '左滚转', def: 'KeyA' },
    { group: '飞行控制', id: 'rollRight', label: '右滚转', def: 'KeyD' },
    { group: '飞行控制', id: 'yawLeft', label: '左偏航', def: 'KeyQ' },
    { group: '飞行控制', id: 'yawRight', label: '右偏航', def: 'KeyE' },
    { group: '飞行控制', id: 'throttleUp', label: '增加油门（含加力）', def: 'Shift' },
    { group: '飞行控制', id: 'throttleDown', label: '减少油门', def: 'Control' },
    { group: '飞行控制', id: 'freeLook', label: '自由观察（按住）', def: 'KeyC' },
    { group: '武器与目标', id: 'fireGun', label: '机炮', def: 'Mouse0' },
    { group: '武器与目标', id: 'fireMissile', label: '发射所选导弹', def: 'Space' },
    { group: '武器与目标', id: 'zoom', label: '视野放大（点击切换，约 5×）', def: 'Mouse2' },
    { group: '武器与目标', id: 'selectIR', label: '选择红外弹', def: 'Digit1' },
    { group: '武器与目标', id: 'selectSARH', label: '选择雷达弹', def: 'Digit2' },
    { group: '武器与目标', id: 'targetNext', label: '切换 / 锁定目标', def: 'KeyT' },
    { group: '武器与目标', id: 'flare', label: '释放热诱弹', def: 'KeyF' },
    { group: '武器与目标', id: 'chaff', label: '释放箔条', def: 'KeyG' },
    { group: '界面与观战', id: 'scoreboard', label: '战况板', def: 'Tab' },
    { group: '界面与观战', id: 'mute', label: '静音', def: 'KeyM' },
    { group: '界面与观战', id: 'spectateNext', label: '观战切换队友', def: 'KeyV' },
    { group: '界面与观战', id: 'spectateSpeed', label: '观战加速', def: 'KeyX' },
  ];

  const ACTION_MAP = {};
  ACTIONS.forEach(a => { ACTION_MAP[a.id] = a; });

  const DEFAULT_BINDINGS = {};
  ACTIONS.forEach(a => { DEFAULT_BINDINGS[a.id] = a.def; });

  const MODIFIER_FAMILIES = {
    ShiftLeft: 'Shift', ShiftRight: 'Shift',
    ControlLeft: 'Control', ControlRight: 'Control',
    AltLeft: 'Alt', AltRight: 'Alt'
  };

  function labelForCode(code) {
    if (!code) return '未绑定';
    if (code.startsWith('Mouse')) {
      const n = Number(code.slice(5));
      return n === 0 ? '鼠标左键' : n === 1 ? '鼠标中键' : n === 2 ? '鼠标右键' : `鼠标 ${n}`;
    }
    if (code === 'Shift') return 'Shift';
    if (code === 'Control') return 'Ctrl';
    if (code === 'Alt') return 'Alt';
    if (code === 'Space') return '空格';
    if (code === 'Tab') return 'Tab';
    if (code === 'Escape') return 'Esc';
    if (code.startsWith('Key')) return code.slice(3).toUpperCase();
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
    const named = {
      ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
      Backspace: 'Backspace', Enter: 'Enter', CapsLock: 'Caps', BracketLeft: '[', BracketRight: ']',
      Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
      Minus: '-', Equal: '=', Backquote: '`'
    };
    if (named[code]) return named[code];
    if (/^F\d+$/.test(code)) return code;
    return code.replace('Left', ' L').replace('Right', ' R');
  }

  const Settings = {
    STORAGE_KEY,
    CM_TOTAL,
    actions: ACTIONS,
    actionMap: ACTION_MAP,
    defaults: DEFAULT_BINDINGS,
    bindings: Object.assign({}, DEFAULT_BINDINGS),
    cmFlare: 30,
    muted: false,
    available: true,

    init() {
      this.load();
      return this;
    },

    normalizeCode(raw) {
      if (!raw) return null;
      return MODIFIER_FAMILIES[raw] || raw;
    },

    label(code) { return labelForCode(code); },

    get(actionId) {
      return this.bindings[actionId] || null;
    },

    labelForAction(actionId) {
      return labelForCode(this.get(actionId));
    },

    findActionForCode(code) {
      const normalized = this.normalizeCode(code);
      for (const id in this.bindings) {
        if (this.normalizeCode(this.bindings[id]) === normalized) return id;
      }
      return null;
    },

    setBinding(actionId, rawCode) {
      if (!ACTION_MAP[actionId] || !rawCode) return { ok: false, reason: 'invalid' };
      const code = this.normalizeCode(rawCode);
      if (code === 'Escape') return { ok: false, reason: 'reserved' };
      if (code.startsWith('F') && /^F\d+$/.test(code) && ['F5', 'F11', 'F12'].includes(code)) {
        return { ok: false, reason: 'browser' };
      }
      const conflict = this.findActionForCode(code);
      if (conflict && conflict !== actionId) {
        return { ok: false, reason: 'conflict', action: conflict, label: (ACTION_MAP[conflict] ? ACTION_MAP[conflict].label : conflict) };
      }
      this.bindings[actionId] = code;
      this.save();
      return { ok: true };
    },

    resetBindings() {
      this.bindings = Object.assign({}, DEFAULT_BINDINGS);
      this.save();
    },

    setCmFlare(value) {
      this.cmFlare = Math.max(0, Math.min(CM_TOTAL, Math.round(Number(value) / 2) * 2));
      if (!isFinite(this.cmFlare)) this.cmFlare = 30;
      this.save();
    },

    getCmChaff() { return CM_TOTAL - this.cmFlare; },

    setMuted(m) { this.muted = !!m; this.save(); },

    save() {
      try {
        const data = {
          version: 1,
          bindings: this.bindings,
          cmFlare: this.cmFlare,
          muted: this.muted
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch (e) {
        this.available = false;
      }
    },

    load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        if (!data || data.version !== 1) return;
        const merged = Object.assign({}, DEFAULT_BINDINGS);
        if (data.bindings && typeof data.bindings === 'object') {
          ACTIONS.forEach(a => {
            const code = this.normalizeCode(data.bindings[a.id]);
            if (code && code !== 'Escape' && typeof code === 'string') merged[a.id] = code;
          });
        }
        // ensure no duplicate bindings
        const seen = new Set();
        ACTIONS.forEach(a => {
          let code = merged[a.id];
          if (seen.has(code)) merged[a.id] = DEFAULT_BINDINGS[a.id];
          seen.add(merged[a.id]);
        });
        this.bindings = merged;
        const cm = Number(data.cmFlare);
        if (isFinite(cm)) this.cmFlare = Math.max(0, Math.min(CM_TOTAL, Math.round(cm / 2) * 2));
        this.muted = !!data.muted;
      } catch (e) {
        this.available = false;
        this.bindings = Object.assign({}, DEFAULT_BINDINGS);
      }
    }
  };

  TS.Settings = Settings.init();
  TS.keyLabel = labelForCode;
})(window);
