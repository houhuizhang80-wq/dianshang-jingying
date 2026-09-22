/**
 * 轻量音效 + 背景音乐管理：本地 WAV，失败静默；设置项 soundEnabled / bgmEnabled 控制开关。
 * 不改变玩法逻辑。BGM 无文件时用 WebAudio 柔和垫底音循环。
 */
const SoundManager = {
    _cache: Object.create(null),
    _unlocked: false,
    _bgmAudio: null,
    _bgmCtx: null,
    _bgmNodes: null,
    _bgmUsingSynth: false,

    isEnabled() {
        try {
            const s = (typeof gameState !== 'undefined' && gameState.state && gameState.state.settings)
                ? gameState.state.settings
                : null;
            if (s && typeof s.soundEnabled === 'boolean') return s.soundEnabled;
            if (typeof localStorage !== 'undefined') {
                const v = localStorage.getItem('soundEnabled');
                if (v === '0' || v === 'false') return false;
            }
        } catch (_) {}
        return true;
    },

    setEnabled(on) {
        const enabled = !!on;
        try {
            if (typeof gameState !== 'undefined' && gameState.state) {
                if (!gameState.state.settings) gameState.state.settings = {};
                gameState.state.settings.soundEnabled = enabled;
                if (typeof gameState.save === 'function') gameState.save();
            }
        } catch (_) {}
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem('soundEnabled', enabled ? '1' : '0');
            }
        } catch (_) {}
        if (!enabled) this.stopBgm();
    },

    isBgmEnabled() {
        try {
            const s = (typeof gameState !== 'undefined' && gameState.state && gameState.state.settings)
                ? gameState.state.settings : null;
            if (s && typeof s.bgmEnabled === 'boolean') return s.bgmEnabled;
            if (typeof localStorage !== 'undefined') {
                const v = localStorage.getItem('bgmEnabled');
                if (v === '1' || v === 'true') return true;
                if (v === '0' || v === 'false') return false;
            }
        } catch (_) {}
        return false;
    },

    getBgmVolume() {
        try {
            const s = (typeof gameState !== 'undefined' && gameState.state && gameState.state.settings)
                ? gameState.state.settings : null;
            if (s && typeof s.bgmVolume === 'number') return Math.max(0, Math.min(1, s.bgmVolume));
            if (typeof localStorage !== 'undefined') {
                const v = parseFloat(localStorage.getItem('bgmVolume'));
                if (Number.isFinite(v)) return Math.max(0, Math.min(1, v));
            }
        } catch (_) {}
        return 0.35;
    },

    setBgmEnabled(on) {
        const enabled = !!on;
        try {
            if (typeof gameState !== 'undefined' && gameState.state) {
                if (!gameState.state.settings) gameState.state.settings = {};
                gameState.state.settings.bgmEnabled = enabled;
                if (typeof gameState.save === 'function') gameState.save();
            }
        } catch (_) {}
        try {
            if (typeof localStorage !== 'undefined') localStorage.setItem('bgmEnabled', enabled ? '1' : '0');
        } catch (_) {}
        if (enabled) this.playBgm();
        else this.stopBgm();
    },

    setBgmVolume(vol) {
        const v = Math.max(0, Math.min(1, Number(vol) || 0));
        try {
            if (typeof gameState !== 'undefined' && gameState.state) {
                if (!gameState.state.settings) gameState.state.settings = {};
                gameState.state.settings.bgmVolume = v;
                if (typeof gameState.save === 'function') gameState.save();
            }
        } catch (_) {}
        try {
            if (typeof localStorage !== 'undefined') localStorage.setItem('bgmVolume', String(v));
        } catch (_) {}
        try {
            if (this._bgmAudio) this._bgmAudio.volume = v;
            if (this._bgmNodes && this._bgmNodes.gain) this._bgmNodes.gain.gain.value = v * 0.15;
        } catch (_) {}
    },

    unlock() {
        this._unlocked = true;
        if (this.isBgmEnabled()) {
            try { this.playBgm(); } catch (_) {}
        }
    },

    _resolvePath(name) {
        if (typeof getAudioAssetPath === 'function') {
            const p = getAudioAssetPath(name);
            if (p) return p;
        }
        if (typeof ASSET_MANIFEST !== 'undefined' && ASSET_MANIFEST.audio && ASSET_MANIFEST.audio[name]) {
            return ASSET_MANIFEST.audio[name];
        }
        return 'assets/audio/' + name + '.wav';
    },

    play(name, { volume = 0.35 } = {}) {
        if (!name || !this.isEnabled()) return;
        try {
            if (typeof Audio === 'undefined') return;
            const path = this._resolvePath(name);
            let audio = this._cache[name];
            if (!audio) {
                audio = new Audio(path);
                audio.preload = 'auto';
                this._cache[name] = audio;
            }
            audio.volume = Math.max(0, Math.min(1, volume));
            audio.currentTime = 0;
            const p = audio.play();
            if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch (_) {}
    },

    _startSynthBgm() {
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return false;
            if (!this._bgmCtx) this._bgmCtx = new AC();
            const ctx = this._bgmCtx;
            if (ctx.state === 'suspended') ctx.resume();
            this._stopSynthBgm(false);
            const master = ctx.createGain();
            master.gain.value = this.getBgmVolume() * 0.15;
            master.connect(ctx.destination);
            const freqs = [220, 277.18, 329.63];
            const oscs = freqs.map((f, i) => {
                const o = ctx.createOscillator();
                const g = ctx.createGain();
                o.type = i === 0 ? 'sine' : 'triangle';
                o.frequency.value = f;
                g.gain.value = 0.22 / freqs.length;
                o.connect(g);
                g.connect(master);
                o.start();
                return o;
            });
            this._bgmNodes = { gain: master, oscs };
            this._bgmUsingSynth = true;
            return true;
        } catch (_) {
            return false;
        }
    },

    _stopSynthBgm(closeCtx) {
        try {
            if (this._bgmNodes && this._bgmNodes.oscs) {
                this._bgmNodes.oscs.forEach(o => { try { o.stop(); } catch (_) {} });
            }
        } catch (_) {}
        this._bgmNodes = null;
        this._bgmUsingSynth = false;
        if (closeCtx && this._bgmCtx) {
            try { this._bgmCtx.close(); } catch (_) {}
            this._bgmCtx = null;
        }
    },

    playBgm() {
        if (!this.isBgmEnabled()) return;
        const vol = this.getBgmVolume();
        try {
            if (typeof Audio !== 'undefined') {
                const path = this._resolvePath('bgm');
                if (!this._bgmAudio) {
                    this._bgmAudio = new Audio(path);
                    this._bgmAudio.loop = true;
                    this._bgmAudio.preload = 'auto';
                }
                this._bgmAudio.volume = vol;
                const p = this._bgmAudio.play();
                if (p && typeof p.then === 'function') {
                    p.then(() => { this._bgmUsingSynth = false; }).catch(() => {
                        // 无 bgm 文件时回退合成垫底音
                        this._startSynthBgm();
                    });
                    return;
                }
            }
        } catch (_) {}
        this._startSynthBgm();
    },

    stopBgm() {
        try {
            if (this._bgmAudio) {
                this._bgmAudio.pause();
                this._bgmAudio.currentTime = 0;
            }
        } catch (_) {}
        this._stopSynthBgm(false);
    }
};

if (typeof window !== 'undefined') {
    window.SoundManager = SoundManager;
    // 首次用户手势后解锁自动播放策略
    const unlock = () => {
        try { SoundManager.unlock(); } catch (_) {}
        document.removeEventListener('pointerdown', unlock, true);
        document.removeEventListener('keydown', unlock, true);
    };
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
}
