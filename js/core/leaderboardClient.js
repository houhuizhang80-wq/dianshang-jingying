/**
 * 全服排行榜客户端
 * 对接当前阿里云 ECS（默认 http://8.163.49.40 ，80 端口）
 * Windows 服务器用云助手整段执行 server/leaderboard/install-on-ecs.ps1
 * 不要在 ECS 上 cd 本地项目路径，也不需要安装 Node。
 * 可用 localStorage.ecommerce_sim_lb_api 覆盖地址。
 */
(function (global) {
    'use strict';

    const DEFAULT_BASE = 'http://8.163.49.40';
    const LS_ID = 'ecommerce_sim_lb_player_id';
    const LS_TOKEN = 'ecommerce_sim_lb_token';
    const LS_OPT_IN = 'ecommerce_sim_lb_opt_in';
    const LS_LAST_SUBMIT = 'ecommerce_sim_lb_last_submit';

    function _base() {
        try {
            if (typeof localStorage !== 'undefined') {
                const custom = localStorage.getItem('ecommerce_sim_lb_api');
                if (custom) return String(custom).replace(/\/+$/, '');
            }
        } catch (_) {}
        return DEFAULT_BASE;
    }

    function _uuid() {
        try {
            if (global.crypto && typeof global.crypto.randomUUID === 'function') {
                return global.crypto.randomUUID().replace(/-/g, '');
            }
        } catch (_) {}
        let s = '';
        for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
        return s;
    }

    function getIdentity() {
        let id = null;
        let token = null;
        try {
            id = localStorage.getItem(LS_ID);
            token = localStorage.getItem(LS_TOKEN);
        } catch (_) {}
        if (!id || !token || id.length < 8 || token.length < 16) {
            id = 'p_' + _uuid().slice(0, 24);
            token = _uuid() + _uuid().slice(0, 16);
            try {
                localStorage.setItem(LS_ID, id);
                localStorage.setItem(LS_TOKEN, token);
            } catch (_) {}
        }
        return { playerId: id, token };
    }

    function isOptIn() {
        try {
            return localStorage.getItem(LS_OPT_IN) === '1';
        } catch (_) {
            return false;
        }
    }

    function setOptIn(on) {
        try {
            localStorage.setItem(LS_OPT_IN, on ? '1' : '0');
        } catch (_) {}
    }

    // ==================== 上报数据清洗（本地拦截） ====================
    // 排行榜是"客户端可能说谎"的场景：本地必须先把明显不可能的数据挡掉，
    // 服务端仍必须按同样的规则再验一次（负数分、HTML/脚本昵称、超长名）。

    const MAX_LABEL_LEN = 16;      // 昵称/店名最大长度
    const MAX_SCORE = 9e12;        // 与游戏内资金硬上限一致：9 万亿
    const HTML_LIKE = /<[^>]*>|&lt;|&gt;|&#\d+;|javascript:|on\w+\s*=/i;
    const SCRIPT_LIKE = /<script|<\/script|<\?|<!\[cdata|eval\(|function\s*\(|=>|\\x[0-9a-f]{2}/i;

    /**
     * 昵称/店名清洗：剥标签 → 去控制字符/危险符号 → 压缩空白 → 限长。
     * @returns {string} 清洗结果，无法得到安全值时返回 fallback
     */
    function sanitizeLabel(value, fallback, maxLen) {
        let s = String(value == null ? '' : value);
        s = s.replace(/<[^>]*>/g, ' ')                 // HTML 标签
             .replace(/[<>"'`\\]/g, '')                // 引号/尖括号等注入符号
             .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, '')  // 控制字符/零宽字符
             .replace(/\s+/g, ' ')
             .trim();
        if (!s || HTML_LIKE.test(s) || SCRIPT_LIKE.test(s)) return fallback;
        const len = maxLen || MAX_LABEL_LEN;
        if (s.length > len) s = s.slice(0, len);
        return s;
    }

    /** 分值清洗：非有限数 / 负数 / 超过硬上限 → 钳制到 [0, MAX_SCORE] */
    function sanitizeScore(v) {
        const n = Number(v);
        if (!isFinite(n)) return 0;
        if (n < 0) return 0;
        if (n > MAX_SCORE) return MAX_SCORE;
        return n;
    }

    /** 正整数清洗（天数/等级等） */
    function sanitizePositiveInt(v, min, max) {
        const n = Math.floor(Number(v));
        if (!isFinite(n)) return min;
        if (n < min) return min;
        if (n > max) return max;
        return n;
    }

    function _fetch(path, opts) {
        const url = _base() + path;
        const method = String((opts && opts.method) || 'GET').toUpperCase();
        const timeout = (opts && opts.timeout) || 12000;
        const body = (opts && opts.body) ? String(opts.body) : null;
        return new Promise(function (resolve, reject) {
            let xhr = null;
            try {
                if (typeof plus !== 'undefined' && plus.net && plus.net.XMLHttpRequest) {
                    xhr = new plus.net.XMLHttpRequest();
                }
            } catch (_) {}
            if (!xhr) {
                try { xhr = new XMLHttpRequest(); } catch (e) {
                    reject(e);
                    return;
                }
            }
            let done = false;
            const timer = setTimeout(function () {
                if (done) return;
                done = true;
                try { xhr.abort(); } catch (_) {}
                reject(new Error('timeout'));
            }, timeout);
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4) return;
                if (done) return;
                done = true;
                clearTimeout(timer);
                let data = null;
                try { data = JSON.parse(xhr.responseText || 'null'); } catch (_) { data = null; }
                const status = Number(xhr.status) || 0;
                if (status >= 200 && status < 300) {
                    resolve(data);
                    return;
                }
                const err = new Error((data && data.error) || ('HTTP ' + status));
                err.status = status;
                err.data = data;
                reject(err);
            };
            try {
                xhr.open(method, url, true);
                if (body && method !== 'GET' && method !== 'HEAD') {
                    xhr.setRequestHeader('Content-Type', 'application/json');
                }
                xhr.send(body);
            } catch (e) {
                if (done) return;
                done = true;
                clearTimeout(timer);
                reject(e);
            }
        });
    }

    function collectSnapshot(gameState) {
        const s = (gameState && gameState.state) || {};
        const shop = s.shop || {};
        const player = s.player || {};
        const gt = s.gameTime || {};
        const bank = s.bank || {};
        let bankSavings = 0;
        try {
            if (typeof bankState !== 'undefined' && bankState && bankState.state) {
                bankSavings = Number(bankState.state.savings) || 0;
                if (Array.isArray(bankState.state.fixedDeposits)) {
                    bankSavings += bankState.state.fixedDeposits
                        .filter(d => d && d.status === 'active')
                        .reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
                }
            } else {
                bankSavings = Number(bank.savings) || 0;
            }
        } catch (_) {}

        let sales = Number(shop.totalSalesAmount);
        if (!isFinite(sales) || sales < 0) sales = 0;
        try {
            if ((!sales || sales <= 0) && gameState && typeof gameState._getBankTotalTurnover === 'function') {
                sales = Number(gameState._getBankTotalTurnover()) || 0;
            }
        } catch (_) {}
        sales = sanitizeScore(sales);

        // 资金：负数/NaN/离谱值本地先收口，绝不上报负分或天文数字
        let funds = Number(shop.funds);
        if (!isFinite(funds)) funds = 0;
        if (funds < 0) funds = 0;
        funds = sanitizeScore(funds);
        bankSavings = sanitizeScore(bankSavings);
        const netWorth = sanitizeScore(funds + bankSavings);
        const appVersion = (typeof APP_VERSION !== 'undefined') ? String(APP_VERSION) : '';

        // 流水证据：财务记录数 + 订单数 + 简易哈希（供服务端校验）
        const financeRecords = (s.finance && Array.isArray(s.finance.records)) ? s.finance.records : [];
        const orders = Array.isArray(s.orders) ? s.orders : [];
        const financeRecordCount = financeRecords.length;
        const orderCount = orders.length;
        let ledgerHash = '';
        try {
            const sample = financeRecords.slice(-20).map(r =>
                [r.category || '', r.amount || 0, r.day || r.date || ''].join(':')
            ).join('|');
            const salesPart = String(Math.round(sales));
            // 轻量哈希（非加密，仅防空数据乱报）
            let h = 2166136261;
            const str = sample + '#' + salesPart + '#' + financeRecordCount + '#' + orderCount;
            for (let i = 0; i < str.length; i++) {
                h ^= str.charCodeAt(i);
                h = Math.imul(h, 16777619);
            }
            ledgerHash = (h >>> 0).toString(16).padStart(8, '0');
        } catch (_) {
            ledgerHash = financeRecordCount > 0 ? 'has_flow' : '';
        }

        return {
            name: sanitizeLabel(player.name, '店主', MAX_LABEL_LEN),
            shopName: sanitizeLabel(shop.name, '未命名店铺', MAX_LABEL_LEN),
            days: sanitizePositiveInt(gt.day, 1, 1e7),
            level: sanitizePositiveInt(shop.level, 1, 999),
            reputation: sanitizePositiveInt(shop.reputation, 0, 1e9),
            funds,
            sales,
            bankSavings,
            netWorth,
            financeRecordCount: sanitizePositiveInt(financeRecordCount, 0, 1e9),
            orderCount: sanitizePositiveInt(orderCount, 0, 1e9),
            ledgerHash,
            appVersion: String(appVersion || '').slice(0, 32)
        };
    }

    /**
     * 上报前的最后一道本地校验（负数分、脚本昵称、超长名、离谱值）。
     * 注意：这里只是"本地拦下明显造假"，服务端必须用同样的规则再验一次。
     * @returns {{ok:boolean, reason?:string, snap?:Object}}
     */
    function validateSnapshot(snap) {
        if (!snap || typeof snap !== 'object') return { ok: false, reason: 'empty_snapshot' };
        const scores = ['funds', 'sales', 'bankSavings', 'netWorth'];
        for (let i = 0; i < scores.length; i++) {
            const v = snap[scores[i]];
            if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > MAX_SCORE) {
                return { ok: false, reason: 'invalid_score:' + scores[i] };
            }
        }
        const labels = [snap.name, snap.shopName];
        for (let i = 0; i < labels.length; i++) {
            const s = String(labels[i] || '');
            if (!s || s.length > MAX_LABEL_LEN) return { ok: false, reason: 'invalid_label_length' };
            if (HTML_LIKE.test(s) || SCRIPT_LIKE.test(s)) return { ok: false, reason: 'invalid_label_content' };
        }
        if (!(snap.days >= 1) || !(snap.level >= 1) || snap.reputation < 0) {
            return { ok: false, reason: 'invalid_progress' };
        }
        return { ok: true, snap };
    }

    function fetchBoard(board, limit) {
        const { playerId } = getIdentity();
        const q = '?board=' + encodeURIComponent(board || 'netWorth')
            + '&limit=' + encodeURIComponent(String(limit || 50))
            + '&playerId=' + encodeURIComponent(playerId);
        return _fetch('/api/leaderboard' + q, { method: 'GET', timeout: 12000 });
    }

    function health() {
        return _fetch('/api/health', { method: 'GET', timeout: 6000 });
    }

    function prepareAdWatch(purpose) {
        const { playerId } = getIdentity();
        return _fetch('/api/ad/prepare', {
            method: 'POST',
            body: JSON.stringify({ playerId, purpose: purpose || '' }),
            timeout: 6000
        }).catch(() => ({ ok: false }));
    }

    function fetchAdTicket(purpose) {
        const { playerId } = getIdentity();
        const q = '?playerId=' + encodeURIComponent(playerId)
            + '&purpose=' + encodeURIComponent(purpose || '');
        return _fetch('/api/ad/ticket' + q, { method: 'GET', timeout: 8000 });
    }

    function consumeAdTicket(transId) {
        const { playerId } = getIdentity();
        return _fetch('/api/ad/consume', {
            method: 'POST',
            body: JSON.stringify({ playerId, trans_id: transId }),
            timeout: 8000
        });
    }

    function submit(gameState, force) {
        if (!isOptIn() && !force) {
            return Promise.resolve({ ok: false, skipped: true, reason: 'opt_out' });
        }
        const now = Date.now();
        try {
            const last = parseInt(localStorage.getItem(LS_LAST_SUBMIT) || '0', 10) || 0;
            if (!force && now - last < 20000) {
                return Promise.resolve({ ok: false, skipped: true, reason: 'throttle' });
            }
        } catch (_) {}

        const id = getIdentity();
        // 本存档注入过广告/兑换码/救援资金 → 不上报，保持榜单公平
        try {
            if (gameState && gameState.state && gameState.state.settings && gameState.state.settings.moneyInjected) {
                return Promise.resolve({ ok: false, skipped: true, reason: 'money_injected' });
            }
        } catch (_) {}
        const snap = collectSnapshot(gameState);
        // 本地拦下：负数分 / 脚本昵称 / 超长名 / 离谱值 → 直接拒绝上报（服务端仍需再验一次）
        const check = validateSnapshot(snap);
        if (!check.ok) {
            try { console.warn('[排行榜] 上报数据未通过本地校验，已拦截：' + check.reason); } catch (_) {}
            return Promise.resolve({ ok: false, skipped: true, reason: check.reason });
        }
        const body = Object.assign({}, snap, {
            playerId: id.playerId,
            token: id.token
        });

        return _fetch('/api/leaderboard/submit', {
            method: 'POST',
            body: JSON.stringify(body),
            timeout: 12000
        }).then((data) => {
            try { localStorage.setItem(LS_LAST_SUBMIT, String(Date.now())); } catch (_) {}
            return data;
        });
    }

    /** 游戏日推进时自动尝试上报（需已同意上榜） */
    let _lastDaySubmitted = -1;
    function onGameDayMaybeSubmit(gameState) {
        try {
            if (!isOptIn()) return;
            const day = gameState && gameState.state && gameState.state.gameTime
                ? gameState.state.gameTime.day : 0;
            if (!day || day === _lastDaySubmitted) return;
            // 每 3 个游戏日上报一次，减轻服务器压力
            if (day % 3 !== 0 && day !== 1) return;
            _lastDaySubmitted = day;
            submit(gameState, false).catch(() => {});
        } catch (_) {}
    }

    let _online = false;
    let _onlineAt = 0;
    let _pinging = null;
    let _watchTimer = null;
    const ONLINE_TTL = 25000;

    function _syncTiles(online) {
        try {
            document.querySelectorAll('[data-guide="grid-leaderboard"]').forEach(function (el) {
                el.style.display = online ? '' : 'none';
            });
            if (!online && typeof ui !== 'undefined' && ui && ui._findModalOverlay) {
                const m = ui._findModalOverlay('🏅 全服排行榜', 'leaderboardModal');
                if (m) ui.closeModal({ force: true });
            }
            if (typeof ui !== 'undefined' && ui && typeof ui.render === 'function') {
                if (ui.currentPage === 'dashboard' || ui.currentPage === 'profile' || !ui.currentPage) {
                    ui.render();
                }
            }
        } catch (_) {}
    }

    function pingHealth(force) {
        const now = Date.now();
        if (!force && _pinging) return _pinging;
        if (!force && _onlineAt && (now - _onlineAt) < ONLINE_TTL) {
            return Promise.resolve(_online);
        }
        _pinging = health().then(function (data) {
            const next = !!(data && data.ok);
            const changed = next !== _online;
            _online = next;
            _onlineAt = Date.now();
            _pinging = null;
            if (changed) _syncTiles(_online);
            return _online;
        }).catch(function () {
            const changed = _online !== false;
            _online = false;
            _onlineAt = Date.now();
            _pinging = null;
            if (changed) _syncTiles(false);
            return false;
        });
        return _pinging;
    }

    function startWatch() {
        pingHealth(true);
        if (_watchTimer) return;
        _watchTimer = setInterval(function () { pingHealth(true); }, 40000);
    }

    const api = {
        DEFAULT_BASE,
        getBase: _base,
        getIdentity,
        isOptIn,
        setOptIn,
        collectSnapshot,
        validateSnapshot,
        sanitizeLabel,
        sanitizeScore,
        MAX_LABEL_LEN,
        MAX_SCORE,
        fetchBoard,
        health,
        prepareAdWatch,
        fetchAdTicket,
        consumeAdTicket,
        submit,
        onGameDayMaybeSubmit,
        isOnline: function () { return !!_online; },
        ping: pingHealth,
        startWatch: startWatch,
        BOARDS: [
            { id: 'netWorth', name: '净资产', icon: '💎' },
            { id: 'funds', name: '资金', icon: '💰' },
            { id: 'sales', name: '流水', icon: '📈' },
            { id: 'reputation', name: '信誉', icon: '⭐' }
        ]
    };

    global.LeaderboardClient = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
