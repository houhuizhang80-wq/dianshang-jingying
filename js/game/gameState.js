/**
 * 经济字段防护（客户端侧）
 * ========================
 * ⚠️ 定位说明：这是单机游戏的**客户端自校验**，只能提高改档/改控制台的成本，
 *    不能替代服务端权威校验（排行榜、云存档必须由服务端再验一次）。
 *
 * 解决的具体问题：
 *   1. 控制台 `gameState.state.shop.funds = 1e9` 直接改钱 —— shop.funds 改为
 *      不可配置的访问器，非游戏脚本来源的写入会被丢弃并记日志。
 *   2. 控制台调用 `gameState.addFunds(1e9)` 刷钱 —— addFunds 先做调用来源检查。
 *   3. 数值没有硬上限：NaN / Infinity / 1e308 / 整型绕回 —— 统一钳制到
 *      [欠款下限, 9e12]（9 万亿，与 UI 软上限一致）。
 *   4. state.shop 被整体替换绕过访问器 —— state.shop 本身也加访问器并在
 *      setState / init 后重装。
 */
const GameEconomyGuard = (function () {
    'use strict';

    const MAX_FUNDS = 9e12;              // 资金硬上限：9 万亿
    const MIN_FUNDS_FALLBACK = -100000;  // SHOP_CONFIG 未就绪时的欠款下限兜底
    const MAX_FUNDS_ABS = MAX_FUNDS;     // 其他经济字段（流水等）的绝对值上限

    // 项目自身脚本（可信调用方）
    const PROJECT_JS = /(?:^|[\\/])(?:js|data)[\\/][\w.-]+[\\/][\w.-]+\.js(?::\d|\)|$)/i;
    // 守卫自身所在文件：这些帧不构成“调用方来自游戏代码”的证据
    const SELF_FILE = /(?:^|[\\/])gameState\.js(?::\d|\)|$)/i;
    // 控制台 / eval / 注入脚本特征
    const OUTSIDE = /<anonymous>|VM\d+|blob:|eval|console|injectedScript|native code|debugger|userscript/i;

    const stats = { blocked: 0, clamped: 0, reset: 0, last: '' };

    function minFunds() {
        try {
            if (typeof SHOP_CONFIG !== 'undefined' && SHOP_CONFIG && isFinite(SHOP_CONFIG.maxDebt)) {
                return Math.min(0, Number(SHOP_CONFIG.maxDebt));
            }
        } catch (_) {}
        return MIN_FUNDS_FALLBACK;
    }

    /**
     * 把任意数字钳制到合法资金区间。
     *  - 溢出方向饱和（+∞ → 上限，-∞ → 欠款下限），**绝不绕回 0 或负数**
     *  - NaN / 非数字 → 0
     */
    function clampFunds(n) {
        if (typeof n !== 'number' || Number.isNaN(n)) { stats.reset++; return 0; }
        const lo = minFunds();
        if (n === Infinity || n > MAX_FUNDS) { stats.clamped++; return MAX_FUNDS; }
        if (n === -Infinity || n < lo) { stats.clamped++; return lo; }
        return n;
    }

    /**
     * 规范化任意输入（数字/字符串/垃圾值）为合法资金。
     * 垃圾值（NaN/undefined/乱码字符串）→ 返回 fallback（写入场景即"保持原值"）。
     */
    function sanitize(v, fallback) {
        const fb = (typeof fallback === 'number' && isFinite(fallback)) ? clampFunds(fallback) : 0;
        if (typeof v === 'number') {
            if (Number.isNaN(v)) { stats.reset++; return fb; }   // NaN：保持原值，不写入
            return clampFunds(v);                                 // ±∞ / 越界：饱和到边界
        }
        if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return clampFunds(Number(v));
        stats.reset++;
        return fb;
    }

    /**
     * 判断本次写入是否来自游戏自身脚本。
     * 控制台 / eval / 注入脚本的赋值会被识别为不可信；
     * 无法判定时一律放行（fail-open），避免误伤正常玩法。
     *
     * 安全阀：只有在调用栈里**确实出现过真实脚本文件路径**时才敢判定不可信。
     * 个别 Android WebView 的 stack 不带文件路径（全是 <anonymous>），
     * 这种情况一律放行，宁可防不住也不能把正常玩法卡死。
     */
    function isTrustedWriter() {
        let stack;
        try { stack = new Error().stack; } catch (_) { return true; }
        if (!stack || typeof stack !== 'string') return true;
        const lines = stack.split('\n');
        let sawRealScriptFile = false;
        let inspected = 0;
        for (let i = 1; i < lines.length; i++) {
            const line = String(lines[i] || '');
            if (!line) continue;
            if (/\.(?:js|html|htm)[:(]/.test(line)) sawRealScriptFile = true;
            if (SELF_FILE.test(line)) continue;             // 守卫自身 / 同文件内部调用链
            inspected++;
            if (PROJECT_JS.test(line)) return true;         // 命中项目脚本 → 可信
            if (OUTSIDE.test(line)) return sawRealScriptFile ? false : true;  // 控制台 / eval / VM 注入
            if (inspected >= 6) break;
        }
        return true;                                        // 判定不了就放行
    }

    function report(kind, detail, amount) {
        stats.blocked++;
        stats.last = kind + ':' + detail;
        try {
            console.warn('[经济防护] 已拦截可疑的资金写入(' + kind + ' ' + detail + ')，' +
                '金额=' + String(amount) + '。该写入不是来自游戏业务代码，已忽略。');
        } catch (_) {}
    }

    /**
     * 给 shop.funds 安装访问器：
     *  - 非游戏代码来源的写入 → 拒绝
     *  - NaN/Infinity/越界 → 收口到合法区间
     *  - 属性不可配置，控制台无法 defineProperty 覆盖
     */
    function installFundsGuard(shop) {
        if (!shop || typeof shop !== 'object') return shop;
        if (shop.__fundsGuarded === true) return shop;
        let value = sanitize(shop.funds, 0);
        try {
            Object.defineProperty(shop, 'funds', {
                configurable: false,
                enumerable: true,
                get() { return value; },
                set(next) {
                    if (!isTrustedWriter()) { report('set', 'untrusted-caller', next); return; }
                    value = sanitize(next, value);
                }
            });
            Object.defineProperty(shop, '__fundsGuarded', {
                value: true, enumerable: false, configurable: false, writable: false
            });
        } catch (_) { /* 已冻结/不可扩展：保持原样，不影响存档流程 */ }
        return shop;
    }

    /** 给 state.shop 安装访问器：整体替换 shop 时自动重新安装资金守卫 */
    function installStateGuard(state) {
        if (!state || typeof state !== 'object') return state;
        if (state.shop && typeof state.shop === 'object') installFundsGuard(state.shop);
        const desc = Object.getOwnPropertyDescriptor(state, 'shop');
        if (desc && desc.configurable === false) return state;
        let shop = (desc && desc.get) ? desc.get() : state.shop;
        try {
            Object.defineProperty(state, 'shop', {
                configurable: true,
                enumerable: true,
                get() { return shop; },
                set(next) {
                    if (!next || typeof next !== 'object') { report('set', 'shop-not-object', next); return; }
                    shop = installFundsGuard(next);
                }
            });
            Object.defineProperty(state, '__shopGuarded', {
                value: true, enumerable: false, configurable: true, writable: true
            });
        } catch (_) {}
        return state;
    }

    /** 巡检：shop 被整体替换或 funds 属性被绕过时重新收口（幂等、开销极小） */
    function verifyState(state) {
        if (!state || typeof state !== 'object') return state;
        if (!state.shop || typeof state.shop !== 'object') return state;
        if (state.shop.__fundsGuarded !== true || state.__shopGuarded !== true) {
            installStateGuard(state);
        }
        return state;
    }

    return {
        MAX_FUNDS: MAX_FUNDS,
        MAX_FUNDS_ABS: MAX_FUNDS_ABS,
        minFunds: minFunds,
        clampFunds: clampFunds,
        sanitize: sanitize,
        isTrustedWriter: isTrustedWriter,
        installFundsGuard: installFundsGuard,
        installStateGuard: installStateGuard,
        verifyState: verifyState,
        stats: stats
    };
})();

// 游戏状态管理器
class GameState {
    constructor() {
        this.state = null;
        this.listeners = [];
    }

    /**
     * 初始化：两阶段加载
     * Phase1: 尝试从存档加载（saveManager 9层fallback），失败则用 INITIAL_GAME_STATE
     * Phase2: 子模块初始化（bank/cs/warehouse/express/live）
     * 注意：此方法为 async，调用方需 await（index.html 的 initGame 已改为 await）
     */
    async init() {
        // ===== Phase 1: 尝试加载存档 =====
        if (typeof saveManager !== 'undefined') {
            saveManager._log('LOAD', '══════════ GameState.init() 两阶段加载开始 ══════════');
        }
        let loadedFullState = null;
        let isNewGame = true;

        // 「重新开始」：跳过读档，强制第1天新档（避免清空后竞态写回又被加载）
        let forceFresh = false;
        try {
            forceFresh = !!(typeof window !== 'undefined' && window.__ecommerceSimFreshStart) ||
                (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('ecommerce_sim_fresh_start') === '1');
        } catch (_) { forceFresh = !!(typeof window !== 'undefined' && window.__ecommerceSimFreshStart); }
        if (forceFresh) {
            try { window.__ecommerceSimFreshStart = false; } catch (_) {}
            try { sessionStorage.removeItem('ecommerce_sim_fresh_start'); } catch (_) {}
            if (typeof saveManager !== 'undefined') {
                saveManager._log('WARN', '[GS] 重新开始：跳过读档，强制 INITIAL 第1天');
            }
            this.state = JSON.parse(JSON.stringify(INITIAL_GAME_STATE));
            try {
                const weekday = (typeof GAME_START_DATE !== 'undefined' && GAME_START_DATE.weekday) ? GAME_START_DATE.weekday : 6;
                const gt = { day: 1, totalDay: 1, hour: 8, speed: 1, isPaused: false, dayOfWeek: weekday, weekday: weekday };
                this.state.gameTime = (typeof GAME_syncRealDateToGameTime === 'function')
                    ? GAME_syncRealDateToGameTime(gt) : gt;
            } catch (_) {}
            this._pendingWarehouseData = null;
            this._loadedFromSource = null;
            isNewGame = true;
            loadedFullState = null;
        }

        if (!forceFresh) {
        try {
            if (typeof saveManager !== 'undefined') {
                loadedFullState = await saveManager._archiveLoad();
            }
        } catch (e) {
            console.error('[GameState] 存档加载异常，使用初始状态:', e);
        }
        }

        if (!forceFresh && loadedFullState && loadedFullState.fullState && loadedFullState.fullState.state) {
            // ===== 有存档：迁移 + 校验 =====
            if (typeof saveManager !== 'undefined') {
                saveManager._log('LOAD', '[GS] 检测到存档，开始迁移+校验 source=' + loadedFullState.source + ' corrupted=' + !!loadedFullState.corrupted);
            }
            const saved = loadedFullState.fullState.state;
            try {
                this.migrateState(saved); // 复用已实现的迁移逻辑（merge + enforceStructuralIntegrity + 结局同步）
            } catch (e) {
                console.error('[GameState] migrateState 异常:', e);
                try {
                    this._repairState(saved);
                } catch (e2) {
                    console.error('[GameState] migrateState 后结构修复仍失败:', e2);
                }
            }

            // 校验前先做可修复字段修复（字符串数字、数组类型等）
            try { this._repairState(saved); } catch (e) {
                console.warn('[GameState] _repairState 异常:', e);
            }

            // ⭐ 关键修复：先赋值 this.state = saved，再做合法性校验。
            // 旧代码在此处 this.state 仍为 null（构造函数初值），导致 _isValidState() 永远返回 false，
            // 存档被误判为无效而回退到 INITIAL_GAME_STATE，进而把初始状态覆盖写入 main 槽位，丢失真实进度。
            this.state = saved;

            if (!this._isValidState()) {
                console.error('[GameState] 存档校验失败，回退初始状态');
                if (typeof saveManager !== 'undefined') saveManager._log('WARN', '[GS] ✗ 存档校验失败(_isValidState=false)，回退 INITIAL_GAME_STATE');
                this.state = JSON.parse(JSON.stringify(INITIAL_GAME_STATE));
                isNewGame = true;
            } else {
                isNewGame = false;
                if (typeof saveManager !== 'undefined') saveManager._log('LOAD', '[GS] ✓ 存档校验通过，已应用 state.version=' + saved.version + ' day=' + saved.gameTime.day + ' funds=' + saved.shop.funds);
            }

            // 恢复 ExpressState（当前丢失的快递数据）
            if (!isNewGame && loadedFullState.fullState.express && typeof saveManager !== 'undefined') {
                saveManager._deserializeExpressState(loadedFullState.fullState.express);
                saveManager._log('LOAD', '[GS] ExpressState 已恢复');
            }

            // 缓存 warehouse 数据，供 warehouseState.init 取用
            this._pendingWarehouseData = (!isNewGame && loadedFullState.fullState.warehouse) ? loadedFullState.fullState.warehouse : null;
            if (this._pendingWarehouseData) {
                if (typeof saveManager !== 'undefined') saveManager._log('LOAD', '[GS] warehouse 数据已缓存，待 warehouseState.init 取用');
            }

            // 记录存档来源（用于自愈回写）
            this._loadedFromSource = loadedFullState.source || 'main';
            if (loadedFullState.corrupted) {
                console.warn('[GameState] 存档哈希校验异常，已尝试恢复');
            }
        } else if (!forceFresh) {
            // ===== 无存档：全新初始状态（forceFresh 时上面已写好第1天，勿覆盖）=====
            if (typeof saveManager !== 'undefined') saveManager._log('LOAD', '[GS] 无存档，使用全新 INITIAL_GAME_STATE');
            this.state = JSON.parse(JSON.stringify(INITIAL_GAME_STATE));
            this._pendingWarehouseData = null;
            this._loadedFromSource = null;
        }

        // ===== Phase 2: 子模块初始化 =====
        // 经济字段收口：读档/开新档后立即安装资金守卫（含读档校验出的异常数值钳制）
        GameEconomyGuard.installStateGuard(this.state);
        this._initDefaultCoupons();
        this._initProductIcons();
        // 累计统计回填（老档一次性从现有订单补齐；此后成就/评价不再依赖订单留存）
        this._backfillCumulativeStats();
        this._repairViewOrderFunnel();
        this._hydrateListingRatings();
        if (typeof bankState !== 'undefined' && typeof bankEngine !== 'undefined') {
            bankState.init(this.state);
            bankEngine.init();
            this._bindBankEvents();
        }
        if (typeof csState !== 'undefined') {
            csState.init(this);
        }
        if (typeof window !== 'undefined' && window.warehouseState) {
            this.warehouse = window.warehouseState;
            this.warehouse.init(this);
            if (!this.state.warehouse) {
                this.state.warehouse = {};
            }
            this.state.warehouse.level = this.warehouse.getLevelInfo().level;
            this.state.warehouse.logs = this.warehouse.state.logs || [];
            this.state.warehouse.packagingMaterials = this.warehouse.state.packagingMaterials;
            this.state.warehouse.packagingLogs = this.warehouse.state.packagingLogs;
            this.state.warehouse.lowStockThreshold = Math.round((this.warehouse.state.thresholds.lowStockRatio || 0.2) * 100);
            this.state.inventory = this._syncInventoryFromWarehouse();
            // 强制回写容量字段，避免个人中心仍显示旧的 10000 满仓
            if (typeof this.warehouse.syncCapacityToGameState === 'function') {
                this.warehouse.syncCapacityToGameState();
            }
        }
        if (typeof ExpressEngine !== 'undefined') {
            this.express = ExpressEngine;
            // 仅全新游戏时初始化默认合作关系（读档时已由 _deserializeExpressState 恢复）
            if (isNewGame) {
                ExpressState.init();
            }
        }
        // ===== 多店铺系统（阶段A：地基） =====
        try {
            if (typeof ShopsState !== 'undefined' && typeof window !== 'undefined' && window.shopsUI) {
                this.shops = new ShopsState(this);
                this.shops.init(this);
                // UI 绑定（shopsUI 需要 ShopsState 实例与 gameState/uiManager）
                if (typeof window.shopsUI.init === 'function') {
                    window.shopsUI.init(this, (typeof ui !== 'undefined') ? ui : null, this.shops);
                }
            } else if (typeof ShopsState !== 'undefined') {
                this.shops = new ShopsState(this);
                this.shops.init(this);
            }
        } catch (e) {
            console.warn('[GameState] 多店铺模块初始化失败:', e);
        }
        if (typeof liveState !== 'undefined' && typeof liveEngine !== 'undefined') {
            liveState.init(this);
        }
        // 纳税 / 法务：tick 每小时会调用，必须在此初始化，否则 LegalState 空引用触发「系统异常 [tick]」
        try {
            if (typeof TaxState !== 'undefined' && TaxState.init) {
                TaxState.init(this);
            }
            if (typeof TaxEngine !== 'undefined' && TaxEngine.init) {
                TaxEngine.init();
                // 纳税账期与游戏真实日历（year/month）对齐，修复旧「每30天一个月」错位
                if (typeof TaxEngine.syncWithGameCalendar === 'function') {
                    TaxEngine.syncWithGameCalendar(this);
                }
            }
        } catch (e) {
            console.warn('[GameState] Tax 模块初始化失败:', e);
        }
        try {
            if (typeof LegalEngine !== 'undefined' && LegalEngine.init) {
                LegalEngine.init(this);
            } else if (typeof LegalState !== 'undefined' && LegalState.init) {
                LegalState.init(this);
            }
        } catch (e) {
            console.warn('[GameState] Legal 模块初始化失败:', e);
        }
        try { this.ensureShopMeta(); } catch (_) {}
        this.notify();
        if (typeof saveManager !== 'undefined') {
            saveManager._log('LOAD', '[GS] Phase2 子模块初始化完成 isNewGame=' + isNewGame + ' loadedFromSource=' + (this._loadedFromSource || 'null'));
        }

        // ===== 自愈回写：非 main 恢复 / 旧版迁移 → 立即写入新版 main =====
        if (typeof saveManager !== 'undefined' && this._loadedFromSource && !isNewGame) {
            const needHeal = this._loadedFromSource !== 'main' || !!saveManager._migratedFromLegacy || !!(loadedFullState && loadedFullState.legacy);
            if (needHeal) {
                saveManager._log('WARN', '[GS] 🔄 自愈回写: 从 ' + this._loadedFromSource +
                    (saveManager._migratedFromLegacy ? '（旧版迁移）' : '') + ' 恢复，立即保存到 main');
                try {
                    saveManager._archiveSave('main').then((r) => {
                        if (r && r.success && saveManager._migratedFromLegacy) {
                            try { saveManager._cleanupLegacyKeysAfterMigrate(); } catch (e) {}
                        }
                    }).catch(() => {});
                } catch (e) {}
            }
        }
    }


    _syncInventoryFromWarehouse() {
        if (!this.warehouse) return this.state.inventory || [];

        // 防止 absorb→createInbound→sync 重入
        if (this._syncingInventory) {
            this._inventorySyncDirty = true;
            return this.state.inventory || [];
        }
        this._syncingInventory = true;
        this._inventorySyncDirty = false;
        try {
            // 1) 自愈孤儿批次 2) 把 _fallback 幽灵库存迁入真实仓批（可售）
            try {
                if (typeof this.warehouse.repairOrphanInventory === 'function') {
                    this.warehouse.repairOrphanInventory();
                }
            } catch (_) {}
            try {
                if (!this._absorbingFallback) {
                    const fallbacks = (this.state && Array.isArray(this.state.inventory))
                        ? this.state.inventory.filter(i => i && i._fallback && i.quantity > 0)
                        : [];
                    if (fallbacks.length && typeof this.warehouse.absorbFallbackInventory === 'function') {
                        this._absorbingFallback = true;
                        try {
                            const abs = this.warehouse.absorbFallbackInventory(fallbacks);
                            this._pendingFallbackRemain = (abs && abs.remain) ? abs.remain : [];
                        } finally {
                            this._absorbingFallback = false;
                        }
                    } else {
                        this._pendingFallbackRemain = fallbacks;
                    }
                }
            } catch (_) {
                this._pendingFallbackRemain = [];
                this._absorbingFallback = false;
            }

            const inventory = [];
            this.warehouse.state.inventory.forEach(inv => {
                const batch = this.warehouse.state.batches.find(b => b.id === inv.batchId);
                if (inv.quantity > 0) {
                    if (batch) {
                        let costPrice = parseFloat(batch.costPrice);
                        if (!(costPrice > 0) && typeof this.warehouse._estimatePurchaseUnitCost === 'function') {
                            costPrice = this.warehouse._estimatePurchaseUnitCost(inv.productId, inv.qualityGrade || batch.qualityGrade || 'B');
                            batch.costPrice = costPrice;
                        }
                        if (!(costPrice > 0)) costPrice = 1;
                        inventory.push({
                            productId: inv.productId,
                            quantity: inv.quantity,
                            costPrice,
                            qualityGrade: inv.qualityGrade || batch.qualityGrade || 'B',
                            purchaseDay: batch.inboundDate,
                            purchaseOrderId: batch.purchaseOrderId,
                            supplier: batch.supplier,
                            batchId: batch.id,
                            locationId: inv.locationId
                        });
                    } else {
                        console.warn(`[_syncInventoryFromWarehouse] batchId=${inv.batchId} 仍缺失，兜底保留。product=${inv.productId}, qty=${inv.quantity}`);
                        const lastInv = (this.state && Array.isArray(this.state.inventory))
                            ? this.state.inventory.find(i => i.batchId === inv.batchId && i.productId === inv.productId)
                            : null;
                        let costPrice = (lastInv && parseFloat(lastInv.costPrice) > 0) ? parseFloat(lastInv.costPrice) : 0;
                        if (!(costPrice > 0) && typeof this.warehouse._estimatePurchaseUnitCost === 'function') {
                            costPrice = this.warehouse._estimatePurchaseUnitCost(inv.productId, inv.qualityGrade || 'B');
                        }
                        if (!(costPrice > 0)) costPrice = 1;
                        inventory.push({
                            productId: inv.productId,
                            quantity: inv.quantity,
                            costPrice,
                            qualityGrade: inv.qualityGrade || 'B',
                            purchaseDay: (lastInv && lastInv.purchaseDay) || (this.state.gameTime?.day) || 1,
                            purchaseOrderId: (lastInv && lastInv.purchaseOrderId) || null,
                            supplier: (lastInv && lastInv.supplier) || null,
                            batchId: inv.batchId,
                            locationId: inv.locationId,
                            _orphan: true
                        });
                    }
                }
            });
            const remainFb = Array.isArray(this._pendingFallbackRemain) ? this._pendingFallbackRemain : [];
            this._pendingFallbackRemain = null;
            remainFb.forEach(oldInv => {
                if (!oldInv || !(oldInv.quantity > 0)) return;
                inventory.push({ ...oldInv, _fallback: true, _unsellable: true });
            });
            return inventory;
        } finally {
            this._syncingInventory = false;
            // 重入期间有新入库：结束后立刻再同步一次，避免可售库存丢货
            if (this._inventorySyncDirty) {
                this._inventorySyncDirty = false;
                try {
                    const again = this._syncInventoryFromWarehouse();
                    if (Array.isArray(again)) this.state.inventory = again;
                } catch (_) {}
            }
        }
    }

    _initDefaultCoupons() {
        const now = this.state.gameTime;
        const defaults = [
            {
                name: '新人专享券',
                type: 'fixed',
                value: 5,
                minAmount: 0,
                quantity: 200,
                perUserLimit: 1,
                startDay: 1,
                endDay: 30,
                validDays: 7,
                scope: 'all',
                scopeIds: [],
                description: '新顾客首单立减5元'
            },
            {
                name: '满99减10',
                type: 'threshold',
                value: 10,
                minAmount: 99,
                quantity: 500,
                perUserLimit: 2,
                startDay: 1,
                endDay: 60,
                validDays: 10,
                scope: 'all',
                scopeIds: [],
                description: '订单满99元可用'
            },
            {
                name: '9折优惠',
                type: 'discount',
                value: 9,
                minAmount: 50,
                maxDiscount: 30,
                quantity: 300,
                perUserLimit: 1,
                startDay: 1,
                endDay: 15,
                validDays: 5,
                scope: 'all',
                scopeIds: [],
                description: '限时9折，最高优惠30元'
            },
            {
                name: '免邮券',
                type: 'freeship',
                value: 0,
                minAmount: 39,
                quantity: 1000,
                perUserLimit: 3,
                startDay: 1,
                endDay: 999,
                validDays: 3,
                scope: 'all',
                scopeIds: [],
                description: '满39元包邮'
            }
        ];
        
        defaults.forEach(config => {
            this.createCouponTemplate(config);
        });
    }

    _initProductIcons() {
        const hasGetIcon = typeof getProductIconInfo === 'function';
        
        // 1. 为所有商品设置emoji图标
        PRODUCTS.forEach(product => {
            let emoji = '📦';
            if (hasGetIcon) {
                const info = getProductIconInfo(product.id, product.name, product.category);
                emoji = info.emoji;
            } else if (typeof PRODUCT_ICONS !== 'undefined') {
                const manual = PRODUCT_ICONS[product.id];
                emoji = (manual && manual.emoji) ? manual.emoji : '📦';
            }
            product.icon = emoji;
            product.defaultGrade = product.baseQuality >= 85 ? 'A' : (product.baseQuality <= 65 ? 'C' : 'B');
        });

        // 2. 初始化商品识别与分类系统（名称识别 + ABC等级分类 + 图片唯一性管理）
        if (typeof ProductClassifier !== 'undefined') {
            ProductClassifier.init(PRODUCTS);
            // 为每个商品设置默认图片（使用默认品质等级），同时保留按等级动态获取能力
            PRODUCTS.forEach(product => {
                product.image = ProductClassifier.getProductImage(product.id, product.defaultGrade);
            });
        } else {
            // 降级方案：如果分类系统未加载，保留旧的SVG渲染逻辑（简化版）
            PRODUCTS.forEach(product => {
                const colors = (typeof CATEGORY_COLORS !== 'undefined')
                    ? (CATEGORY_COLORS[product.category] || CATEGORY_COLORS.daily)
                    : { primary: '#4FC3F7', secondary: '#29B6F6' };
                let gradeColor = '#C0C0C0';
                if (product.defaultGrade === 'A') gradeColor = '#FFD700';
                else if (product.defaultGrade === 'C') gradeColor = '#CD7F32';
                const uid = product.id.replace(/[^a-zA-Z0-9]/g, '_');
                const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
    <defs><linearGradient id="bg_${uid}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${colors.primary}"/><stop offset="100%" stop-color="${colors.secondary}"/>
    </linearGradient></defs>
    <rect x="3" y="3" width="94" height="94" rx="18" fill="url(#bg_${uid})"/>
    <text x="50" y="56" text-anchor="middle" dominant-baseline="middle" font-size="42">${product.icon}</text>
    <circle cx="78" cy="78" r="11" fill="${gradeColor}" stroke="#FFF" stroke-width="1.5"/>
    <text x="78" y="79" text-anchor="middle" dominant-baseline="middle" font-size="12" font-weight="bold" fill="#FFF">${product.defaultGrade}</text>
</svg>`;
                product.image = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
            });
        }
    }

    /**
     * 颜色混合工具（用于 3D SVG 渐变层叠高光/暗部色计算）
     * @param {string} color1 #RRGGBB
     * @param {string} color2 #RRGGBB
     * @param {number} ratio  0~1，1 = 完全使用 color2
     * @returns {string} #RRGGBB
     */
    _mixColor(color1, color2, ratio) {
        const clamp = v => Math.max(0, Math.min(255, v | 0));
        const hex = s => {
            s = s.replace('#', '');
            if (s.length === 3) s = s.split('').map(c => c + c).join('');
            return [parseInt(s.substring(0, 2), 16), parseInt(s.substring(2, 4), 16), parseInt(s.substring(4, 6), 16)];
        };
        const [r1, g1, b1] = hex(color1);
        const [r2, g2, b2] = hex(color2);
        const r = clamp(r1 + (r2 - r1) * ratio);
        const g = clamp(g1 + (g2 - g1) * ratio);
        const b = clamp(b1 + (b2 - b1) * ratio);
        return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    }

    /**
     * 银行授信用的累计销售流水（金额）
     * 优先 shop.totalSalesAmount；旧档可从已完成订单汇总
     */
    _getBankTotalTurnover() {
        try {
            const amt = Number(this.state.shop && this.state.shop.totalSalesAmount);
            if (amt > 0) return amt;
            const orders = (this.state.orders || []).filter(o => o && (o.status === 'completed' || o.status === 'shipped'));
            if (orders.length) {
                const sum = orders.reduce((s, o) => s + (Number(o.totalAmount) || Number(o.finalAmount) || 0), 0);
                if (sum > 0) return Math.round(sum * 100) / 100;
            }
        } catch (_) { /* ignore */ }
        return 0;
    }

    /**
     * 绑定银行模块事件
     * 通过事件总线与银行模块通信
     */
    _bindBankEvents() {
        // 防重复绑定：重新开始/再次 init 时禁止叠加监听（否则存取款会 N 倍扣/加）
        const self = this;
        if (this._bankEventsBound) {
            eventBus._gameContextCache = {
                get shopLevel() { return self.state.shop.level; },
                get shopReputation() { return self.state.shop.reputation; },
                get funds() { return self.state.shop.funds; },
                get day() { return self.state.gameTime.day; },
                get hour() { return self.state.gameTime.hour; },
                // 累计销售流水（金额），用于银行授信（勿用 totalSales：那是件数）
                get totalTurnover() { return self._getBankTotalTurnover(); }
            };
            return;
        }
        this._bankEventsBound = true;

        // 注册游戏上下文请求处理器（通过请求-响应模式）
        eventBus.handle('game:context:get', () => ({
            shopLevel: self.state.shop.level,
            shopReputation: self.state.shop.reputation,
            funds: self.state.shop.funds,
            day: self.state.gameTime.day,
            hour: self.state.gameTime.hour,
            totalTurnover: self._getBankTotalTurnover()
        }));

        // 兼容旧版：提供同步获取方式（缓存值，避免频繁读取）
        eventBus._gameContextCache = {
            get shopLevel() { return self.state.shop.level; },
            get shopReputation() { return self.state.shop.reputation; },
            get funds() { return self.state.shop.funds; },
            get day() { return self.state.gameTime.day; },
            get hour() { return self.state.gameTime.hour; },
            get totalTurnover() { return self._getBankTotalTurnover(); }
        };

        // 银行请求扣减资金
        eventBus.on('bank:funds:spend', (data) => {
            this.spendFunds(data.amount, data.reason);
        });

        // 银行请求增加资金
        eventBus.on('bank:funds:add', (data) => {
            if (data.amount > 0) {
                this.addFunds(data.amount, data.reason);
            }
        });

        // 银行请求扣除信誉
        eventBus.on('bank:reputation:penalty', (data) => {
            this.state.shop.reputation = Math.max(0, this.state.shop.reputation - data.amount);
            this.notify();
        });

        // 银行状态变化时通知全局
        eventBus.on('bank:stateChanged', () => {
            this.notify();
        });
    }

    migrateState(saved) {
        const defaults = JSON.parse(JSON.stringify(INITIAL_GAME_STATE));

        const merge = (target, source) => {
            for (const key of Object.keys(source)) {
                if (target[key] === undefined) {
                    target[key] = source[key];
                } else if (
                    typeof source[key] === 'object' && 
                    source[key] !== null && 
                    !Array.isArray(source[key])
                ) {
                    merge(target[key], source[key]);
                }
            }
        };
        merge(saved, defaults);

        // ===== 时间系统 v2 兜底兼容：无论新老存档，只要 totalDay/day 字段在，就一定同步真实年月日/星期/季节 =====
        // 老存档只有 day 字段 → 自动补齐 year/month/monthDay/weekday/season/totalDay
        try { if (saved.gameTime) GAME_syncRealDateToGameTime(saved.gameTime); } catch (e) {}

        // ⭐ 终极兜底：关键子结构字段（尤其是promotions.active/history）的数组完整性强制校验。
        // 不依赖merge机制（merge只有当target[key] === undefined时才会赋值），主动拦截非数组/缺失的字段。
        // 这解决了：老存档（v7+）中promotions.active可能为undefined/null/非数组/{} 导致 simulateBusiness 崩溃的问题。
        (function enforceStructuralIntegrity(root, _defaults) {
            const ensureObject = (obj, key, fallback) => {
                if (!obj[key] || typeof obj[key] !== 'object' || Array.isArray(obj[key])) {
                    obj[key] = fallback ? JSON.parse(JSON.stringify(fallback)) : {};
                }
            };
            const ensureArray = (obj, key) => {
                if (!Array.isArray(obj[key])) {
                    obj[key] = [];
                }
            };
            // promotions 兜底（simulateBusiness / createPromotion / endPromotion 强依赖）
            ensureObject(root, 'promotions', _defaults.promotions);
            ensureArray(root.promotions, 'active');
            ensureArray(root.promotions, 'history');
            ensureArray(root.promotions, 'campaigns');
            ensureArray(root.promotions, 'activeIds');
            ensureArray(root.promotions, 'participationRecords');
            ensureArray(root.promotions, 'userCoupons'); // ⭐ generateOrders 中 receiveCoupon/useCoupon 需要
            // ===== 新增：逐个兜底 promotions.campaigns 的 rules / statistics 子结构，防 calculateOrderDiscount 崩溃 =====
            (root.promotions.campaigns || []).forEach(c => {
                if (!c.rules || typeof c.rules !== 'object') {
                    c.rules = { tiers: [], minAmount: 0, rate: 1, threshold: 0, sold: 0, totalStock: 0 };
                }
                if (!c.statistics || typeof c.statistics !== 'object') {
                    c.statistics = { views: 0, clicks: 0, orders: 0, sales: 0, discountAmount: 0, participants: 0 };
                }
                if (!Array.isArray(c.rules.tiers)) c.rules.tiers = [];
                // 确保每个 campaign 的 categoryIds / productIds 为数组（_isItemEligibleForPromotion 用到）
                if (!Array.isArray(c.categoryIds)) c.categoryIds = [];
                if (!Array.isArray(c.productIds)) c.productIds = [];
            });
            // ===== 新增：逐个兜底 promotions.userCoupons 的字段，防 useCoupon 崩溃 =====
            (root.promotions.userCoupons || []).forEach(uc => {
                if (!uc) return;
                if (typeof uc.minPurchase !== 'number') uc.minPurchase = 0;
                if (typeof uc.denomination !== 'number') uc.denomination = 0;
            });
            if (!root.promotions.statistics || typeof root.promotions.statistics !== 'object') {
                root.promotions.statistics = JSON.parse(JSON.stringify(_defaults.promotions.statistics));
            }
            if (!root.promotions.antiFraud || typeof root.promotions.antiFraud !== 'object') {
                root.promotions.antiFraud = JSON.parse(JSON.stringify(_defaults.promotions.antiFraud));
            }
            // marketing 兜底（simulateBusiness里读 activeCampaigns/celebrityEndorsements/promotionLogs）
            ensureObject(root, 'marketing', _defaults.marketing);
            ensureArray(root.marketing, 'activeCampaigns');
            ensureArray(root.marketing, 'celebrityEndorsements');
            ensureArray(root.marketing, 'promotionLogs');
            // ===== 新增：逐个兜底 marketing.activeCampaigns / celebrityEndorsements 的 bidPrice 等 =====
            (root.marketing.activeCampaigns || []).forEach(ac => {
                if (ac && typeof ac.bidPrice !== 'number') ac.bidPrice = 0;
            });
            // livestream 兜底
            ensureObject(root, 'livestream', _defaults.livestream);
            // statistics 兜底
            ensureObject(root, 'statistics', _defaults.statistics);
            // customerService 兜底
            ensureObject(root, 'customerService', _defaults.customerService);
            ensureArray(root.customerService, 'consultations');
            ensureArray(root.customerService, 'returns');
            ensureArray(root.customerService, 'disputes');
            ensureArray(root.customerService, 'reviews');
            // coupons 兜底
            ensureObject(root, 'coupons', _defaults.coupons);
            ensureArray(root.coupons, 'templates');
            ensureArray(root.coupons, 'userCoupons');
            // ===== 新增：逐个兜底 coupons.templates（getAvailableCouponsForReceive 用到） =====
            (root.coupons.templates || []).forEach(t => {
                if (!t) return;
                if (typeof t.minAmount !== 'number') t.minAmount = 0;
                if (typeof t.quantity !== 'number') t.quantity = 0;
                if (typeof t.receivedCount !== 'number') t.receivedCount = 0;
                if (!Array.isArray(t.scopeIds)) t.scopeIds = [];
            });
            // members 兜底
            ensureObject(root, 'members', _defaults.members);
            ensureArray(root.members, 'list');
            // bank 兜底
            ensureObject(root, 'bank', _defaults.bank);
            ensureArray(root.bank, 'fixedDeposits');
            ensureArray(root.bank, 'loans');
            ensureArray(root.bank, 'transactionHistory');
            // warehouse 兜底（addInventory / capacity check 需要）
            ensureObject(root, 'warehouse', _defaults.warehouse || {});
            if (!root.warehouse.packagingMaterials || typeof root.warehouse.packagingMaterials !== 'object') {
                root.warehouse.packagingMaterials = {};
            }
            if (!Array.isArray(root.warehouse.packagingLogs)) root.warehouse.packagingLogs = [];
            if (!Array.isArray(root.warehouse.logs)) root.warehouse.logs = [];
            // 顶层数组兜底（防null/非数组导致遍历崩溃）
            ['inventory', 'purchaseOrders', 'listings', 'orders', 'employees', 'tasks',
             'redeemedCodes', 'events', 'combos', 'shops'].forEach(k => ensureArray(root, k));
            // ===== 新增：逐个兜底 listings 的字段（权重/销量等，calculateWeight/simulateBusiness 用到） =====
            (root.listings || []).forEach(l => {
                if (!l) return;
                if (typeof l.price !== 'number' || isNaN(l.price)) l.price = 0;
                if (typeof l.sales !== 'number') l.sales = 0;
                if (typeof l.views !== 'number') l.views = 0;
                if (typeof l.rating !== 'number') l.rating = 5;
                if (typeof l.weight !== 'number') l.weight = 50;
                if (!l.status) l.status = 'active';
                if (!l.createTime) l.createTime = { day: 1, hour: 0 };
            });
            // ===== 新增：逐个兜底 orders 的字段（processOrderUpdates 用到） =====
            (root.orders || []).forEach(o => {
                if (!o) return;
                if (!o.status) o.status = 'pending_payment';
                if (!o.createTime) o.createTime = { day: 1, hour: 0 };
                if (typeof o.totalAmount !== 'number') o.totalAmount = 0;
                if (typeof o.quantity !== 'number') o.quantity = 1;
                if (typeof o.unitPrice !== 'number') o.unitPrice = 0;
                if (typeof o.costAmount !== 'number') o.costAmount = 0;
                if (!Array.isArray(o.statusHistory)) o.statusHistory = [{ status: o.status, time: o.createTime }];
            });
            // ===== 采购单字段兜底（processPurchaseOrders / 供应链 UI 依赖 createTime）=====
            (root.purchaseOrders || []).forEach(po => {
                if (!po) return;
                if (!po.createTime) po.createTime = { day: 1, hour: 0 };
                if (typeof po.expectedArrivalDay !== 'number') {
                    po.expectedArrivalDay = (po.createTime.day || 1) + (po.deliveryDays || 3);
                }
                if (!po.status) po.status = 'pending';
            });
            // shop.rating 空安全
            if (root.shop) {
                if (typeof root.shop.rating !== 'number' || isNaN(root.shop.rating)) root.shop.rating = 5;
            }
            if (root.customerService && !Array.isArray(root.customerService.consultations)) {
                root.customerService.consultations = [];
            }
            if (root.events) {
                ensureArray(root.events, 'activeEvents');
                ensureArray(root.events, 'eventLog');
            }
            if (root.finance) {
                ensureArray(root.finance, 'records');
                ensureArray(root.finance, 'dailyStats');
                if (typeof root.finance.platformCommissionPaid !== 'number' || !isFinite(root.finance.platformCommissionPaid)) {
                    root.finance.platformCommissionPaid = 0;
                }
            }
            // ===== 修改2a：settings 和 _supplyOutageDigest 兜底 =====
            ensureObject(root, 'settings', _defaults.settings || { supplyOutageSilentMode: false, supplyOutageNotifyLevel: 'all' });
            if (typeof root.settings.supplyOutageSilentMode !== 'boolean') root.settings.supplyOutageSilentMode = false;
            if (!['all', 'digest', 'none'].includes(root.settings.supplyOutageNotifyLevel)) root.settings.supplyOutageNotifyLevel = 'all';
            if (typeof root.settings.soundEnabled !== 'boolean') root.settings.soundEnabled = true;
            ensureObject(root, '_supplyOutageDigest', _defaults._supplyOutageDigest || { day: 0, count: 0, lastNames: [] });
            if (typeof root._supplyOutageDigest.day !== 'number') root._supplyOutageDigest.day = 0;
            if (typeof root._supplyOutageDigest.count !== 'number') root._supplyOutageDigest.count = 0;
            if (!Array.isArray(root._supplyOutageDigest.lastNames)) root._supplyOutageDigest.lastNames = [];
            // 员工宿舍兜底（老存档可能缺 housing）
            ensureObject(root, 'housing', _defaults.housing || { level: 0, beds: 0, assigned: {}, monthlyRentPerBed: 180, satisfaction: 60 });
            if (!root.housing.assigned || typeof root.housing.assigned !== 'object' || Array.isArray(root.housing.assigned)) {
                root.housing.assigned = {};
            }
            if (typeof root.housing.level !== 'number') root.housing.level = Number(root.housing.level) || 0;
            if (typeof root.housing.beds !== 'number') root.housing.beds = Number(root.housing.beds) || 0;
            if (typeof root.housing.monthlyRentPerBed !== 'number') root.housing.monthlyRentPerBed = Number(root.housing.monthlyRentPerBed) || 180;
            if (typeof root.housing.satisfaction !== 'number') root.housing.satisfaction = Number(root.housing.satisfaction) || 60;
            if (!Array.isArray(root.housing.buildings)) root.housing.buildings = [];
            if (root.shop) {
                const cr = root.shop.staffOrderCommissionRate;
                if (!root.shop._staffCommissionMigratedV2) {
                    if (typeof cr !== 'number' || cr <= 0 || Math.abs(cr - 0.01) < 1e-9) {
                        root.shop.staffOrderCommissionRate = 0.001;
                    } else if (cr > 0.01) {
                        root.shop.staffOrderCommissionRate = 0.01;
                    } else if (cr < 0.001) {
                        root.shop.staffOrderCommissionRate = 0.001;
                    }
                    root.shop._staffCommissionMigratedV2 = true;
                } else if (typeof cr !== 'number' || cr < 0.001) {
                    root.shop.staffOrderCommissionRate = 0.001;
                }
            }
        })(saved, defaults);

        // ==================== ⭐ 存档结局同步（兼容旧版/修复"100天就不能跳天"）====================
        // 说明：旧逻辑里任何结局（小而美/电商讲师等成就）触发后都会强制 gameOver=true，
        //       导致存档加载后无法继续玩，"跳过一天"按钮也直接被拦截。
        // 新规范：只有破产（bankrupt）结局才强制 gameOver=true；其他成就型结局仅展示不结束。
        //       因此：加载存档时，若 gameOver=true 但 ending 是非破产，自动解除 gameOver=false。
        //       同时把旧版 ending 对象（整条ENDINGS，含condition/forceGameOver等大字段）
        //       统一为新版精简结构 {id,name,icon,description,triggerDay}，避免显示错乱。
        (function normalizeEndingOnLoad(root) {
            try {
                // 如果存档里有 ENDINGS 变量，优先用它补全缺失字段（在游戏上下文里才存在）
                const E = (typeof ENDINGS !== 'undefined') ? ENDINGS : null;
                // 1) 若 ending 是整条 ENDINGS 对象（旧格式，含 condition 字段）→ 统一成精简结构
                if (root.ending && (root.ending.condition || root.ending.forceGameOver !== undefined)) {
                    const old = root.ending;
                    const match = (E && old.id) ? E.find(e => e.id === old.id) : null;
                    root.ending = {
                        id: old.id || (match && match.id) || null,
                        name: old.name || (match && match.name) || '未知结局',
                        icon: old.icon || (match && match.icon) || '🎯',
                        description: old.description || (match && match.description) || '',
                        triggerDay: typeof old.triggerDay === 'number' ? old.triggerDay
                            : (root.gameTime && typeof root.gameTime.day === 'number' ? root.gameTime.day : 1)
                    };
                } else if (root.ending && root.ending.id) {
                    // 2) 已是精简结构但缺少 name/icon/description → 从 ENDINGS 补全
                    const match = E ? E.find(e => e.id === root.ending.id) : null;
                    if (match) {
                        if (!root.ending.name) root.ending.name = match.name;
                        if (!root.ending.icon) root.ending.icon = match.icon;
                        if (!root.ending.description) root.ending.description = match.description;
                    }
                    if (typeof root.ending.triggerDay !== 'number') {
                        root.ending.triggerDay = (root.gameTime && typeof root.gameTime.day === 'number') ? root.gameTime.day : 1;
                    }
                }
                // 3) 关键：非破产结局 → 解除 gameOver，允许继续玩/继续跳天
                if (root.gameOver === true) {
                    const endingId = (root.ending && root.ending.id) ? root.ending.id : null;
                    if (endingId && endingId !== 'bankrupt') {
                        root.gameOver = false;
                        // 不删除 ending 信息（让玩家还能看到自己达成过的结局）
                    }
                }
            } catch (e) {
                console.warn('[存档结局同步] 兼容处理异常，已跳过:', e && e.message);
            }
        })(saved);

        // ==================== ⭐ 包装物料 BUG 一次性修复（兼容旧存档）====================
        // 真·根因：旧版本 BUG 中，库存写在老位置 state.packagingMaterials（对象{quantity,cost}），
        //         但 getPackagingMaterial 迁移只认纯数字，漏掉了对象格式！
        // 结果：calculatePackagingMaterialFee / consumePackagingMaterialsSmart 永远读到库存=0
        //       → 每发一个订单都触发 "包装材料紧急采购(加价50%)" 重复扣费一次，
        //       导致：①今日包装物料费天天是固定值（¥5929.39等），②玩家资金被重复扣，③库存显示永远不动。
        //
        // ⚠️ 2026-08-06 补充发现：脏数据的 category 被错误写成了 purchase（商品采购）！
        //       也就是说，¥3.6一单的紧急采购费全挂在了「商品采购」类别下，
        //       玩家看到的「包装物料 ¥14.77」其实是正常的仓储保管费，真正多扣的钱藏在「商品采购」里！
        //
        // 本函数一次性修复：
        //   1) 从 finance.records 中删除所有 reason 含 "包装*紧急采购" / "包装*临时采购" 的脏扣费记录（不看 category！）
        //   2) 修正每日统计 dailyStats：同时修正 expense_purchase（误归类的包装紧急采购）和 expense_packaging
        //   3) 修正已发货订单中 fees.packagingMaterialFee 字段（如果包装材料充足，应该是 0）
        //   4) 把多扣的钱全部退回玩家资金 saved.shop.funds
        //   5) 再触发一次库存迁移，确保库存真的搬到新位置
        //   6) 加防重入标记，避免用户多次刷新重复退款
        (function fixDirtyPackagingEmergencyPurchaseOnLoad(root) {
            try {
                // ---- 基本兜底：没有 finance 结构就跳过 ----
                if (!root || !root.finance || typeof root.finance !== 'object') return;

                // ======= Step 0: 防重入标记 =======
                //  防止用户刷新一次就退一次款
                if (root._fixPackagingBugApplied === true) {
                    // 已经修过了，只跑库存迁移，不重复退款
                    try {
                        if (!root.warehouse) root.warehouse = {};
                        if (!root.warehouse.packagingMaterials || typeof root.warehouse.packagingMaterials !== 'object') {
                            root.warehouse.packagingMaterials = {};
                        }
                        const std = root.warehouse.packagingMaterials;
                        const PM_REF = (typeof PACKAGING_MATERIALS !== 'undefined') ? PACKAGING_MATERIALS : null;
                        if (root.packagingMaterials && typeof root.packagingMaterials === 'object'
                            && !Array.isArray(root.packagingMaterials)) {
                            for (const [k, v] of Object.entries(root.packagingMaterials)) {
                                if (PM_REF && !PM_REF[k]) continue;
                                let realQty = 0;
                                if (typeof v === 'number' && isFinite(v)) realQty = v;
                                else if (v && typeof v === 'object') {
                                    if (typeof v.quantity === 'number' && isFinite(v.quantity)) realQty = v.quantity;
                                    else if (typeof v.qty === 'number' && isFinite(v.qty)) realQty = v.qty;
                                }
                                if (realQty > 0) {
                                    std[k] = parseFloat((parseFloat(std[k] || 0) + parseFloat(realQty)).toFixed(4));
                                    try { root.packagingMaterials[k] = (typeof v === 'object') ? { ...v, quantity: 0, qty: 0 } : 0; } catch (_) {}
                                }
                            }
                            try { if (Object.keys(root.packagingMaterials).length === 0) root.packagingMaterials = {}; } catch (_) {}
                        }
                        if (root.warehouse.materials && typeof root.warehouse.materials === 'object') {
                            for (const [k, m] of Object.entries(root.warehouse.materials)) {
                                if (!m || typeof m !== 'object') continue;
                                if (PM_REF && !PM_REF[k]) continue;
                                let qty = 0;
                                if (typeof m.qty === 'number' && isFinite(m.qty)) qty = m.qty;
                                else if (typeof m.quantity === 'number' && isFinite(m.quantity)) qty = m.quantity;
                                if (qty > 0) {
                                    std[k] = parseFloat((parseFloat(std[k] || 0) + parseFloat(qty)).toFixed(4));
                                    if ('qty' in m) m.qty = 0;
                                    if ('quantity' in m) m.quantity = 0;
                                }
                            }
                        }
                    } catch (_) {}
                    return;
                }

                const records = Array.isArray(root.finance.records) ? root.finance.records : [];
                const dailyStats = Array.isArray(root.finance.dailyStats) ? root.finance.dailyStats : [];

                // ---- Step 1: 识别所有脏扣费记录（不看 category！只看 reason！） ----
                //    ⭐ 核心修复：之前漏掉了 category=purchase 但 reason 含「包装材料紧急采购」的脏数据（占绝大多数！）
                //    匹配规则：reason 含 "紧急采购" 或 "临时采购" 且 含 "包装" 或 "材料"
                const dirtyIdx = [];
                const perDayRefund = {};          // { [day]: refundAmount } → 用于修正 dailyStats
                const perDayRefundPurchase = {};  // { [day]: refundAmount_of_wrongCategory_purchase } → 专门修正 expense_purchase
                const perDayRefundPackaging = {}; // { [day]: refundAmount_of_category_packaging } → 专门修正 expense_packaging
                let totalRefund = 0;
                for (let i = 0; i < records.length; i++) {
                    const r = records[i];
                    if (!r || typeof r !== 'object') continue;
                    if (r.type !== 'expense') continue;
                    const reason = String(r.reason || '');
                    const isDirtyPackaging =
                        (reason.indexOf('紧急采购') !== -1 || reason.indexOf('临时采购') !== -1) &&
                        (reason.indexOf('包装') !== -1 || reason.indexOf('材料') !== -1);
                    if (!isDirtyPackaging) continue;
                    const amt = typeof r.amount === 'number' ? r.amount : 0;
                    if (amt <= 0) continue;
                    dirtyIdx.push(i);
                    totalRefund += amt;
                    const d = typeof r.day === 'number' ? r.day : (r.createTime && r.createTime.day) || 0;
                    if (d > 0) {
                        perDayRefund[d] = (perDayRefund[d] || 0) + amt;
                        // 区分：脏记录被错误归类到了 purchase 还是 packaging？
                        const cat = String(r.category || '');
                        if (cat === 'purchase') {
                            perDayRefundPurchase[d] = (perDayRefundPurchase[d] || 0) + amt;
                        } else {
                            perDayRefundPackaging[d] = (perDayRefundPackaging[d] || 0) + amt;
                        }
                    }
                }

                // ---- Step 2: 删除脏 records（从后往前删，索引不会错位）----
                if (dirtyIdx.length > 0) {
                    dirtyIdx.sort((a, b) => b - a).forEach(i => records.splice(i, 1));
                    root.finance.records = records;  // 写回，避免引用错乱
                }

                // ---- Step 3: 修正 dailyStats 每一天（核心修复：同时修 expense_purchase 和 expense_packaging）----
                if (dailyStats.length > 0) {
                    const refundDays = Object.keys(perDayRefund);
                    for (let d = 0; d < dailyStats.length; d++) {
                        const ds = dailyStats[d];
                        if (!ds || typeof ds !== 'object') continue;
                        const refundTotal = typeof perDayRefund[ds.day] === 'number' ? perDayRefund[ds.day] : 0;
                        const refundPurchase = typeof perDayRefundPurchase[ds.day] === 'number' ? perDayRefundPurchase[ds.day] : 0;
                        const refundPackaging = typeof perDayRefundPackaging[ds.day] === 'number' ? perDayRefundPackaging[ds.day] : 0;
                        if (refundTotal <= 0) continue;

                        // ⭐ 分别修正：错误挂到 purchase 的部分扣 expense_purchase，其他扣 expense_packaging
                        if (refundPurchase > 0) {
                            ds.expense_purchase = Math.max(0,
                                parseFloat(((ds.expense_purchase || 0) - refundPurchase).toFixed(4)));
                        }
                        if (refundPackaging > 0) {
                            ds.expense_packaging = Math.max(0,
                                parseFloat(((ds.expense_packaging || 0) - refundPackaging).toFixed(4)));
                        }

                        // 总 cost 同步减（合计 refundTotal，不管它被分到哪个 category）
                        if (typeof ds.cost === 'number') {
                            ds.cost = Math.max(0,
                                parseFloat(((ds.cost) - refundTotal).toFixed(4)));
                        }
                        // profit 同步加（profit = sales - cost ，所以这里 + refundTotal）
                        if (typeof ds.profit === 'number') {
                            ds.profit = parseFloat(((ds.profit) + refundTotal).toFixed(4));
                        }
                    }
                }

                // ---- Step 3.5: 修正已发货订单中 fees.packagingMaterialFee 字段 ----
                //    如果某订单的 packagingMaterialFee > 0 但当时其实有包装材料库存（现在有且是旧迁移过来的），
                //    说明这笔 packagingMaterialFee 也是旧 BUG 导致的误扣费，要清零并退钱。
                //    退款金额按单汇总并入 perDayRefund 的 refund 总额
                let orderFeeRefundTotal = 0;
                try {
                    if (root.orders && Array.isArray(root.orders)) {
                        const PACK_REF_AVAIL = (typeof PACKAGING_MATERIALS !== 'undefined') ? PACKAGING_MATERIALS : null;
                        // 先估算一下当前总库存：只要旧位置/新位置有任何包装材料，就认为当时是有库存的
                        let approxHasStock = false;
                        const std = root.warehouse?.packagingMaterials || {};
                        const old = root.packagingMaterials || {};
                        const erp = root.warehouse?.materials || {};
                        function _hasNonZero(obj) {
                            if (!obj || typeof obj !== 'object') return false;
                            for (const [k, v] of Object.entries(obj)) {
                                let q = 0;
                                if (typeof v === 'number' && isFinite(v)) q = v;
                                else if (v && typeof v === 'object') {
                                    if (typeof v.quantity === 'number') q = v.quantity;
                                    else if (typeof v.qty === 'number') q = v.qty;
                                }
                                if (q > 0) return true;
                            }
                            return false;
                        }
                        approxHasStock = _hasNonZero(std) || _hasNonZero(old) || _hasNonZero(erp);

                        if (approxHasStock) {
                            for (let o = 0; o < root.orders.length; o++) {
                                const ord = root.orders[o];
                                if (!ord || typeof ord !== 'object') continue;
                                const fees = ord.fees || {};
                                const pmFee = typeof fees.packagingMaterialFee === 'number' ? fees.packagingMaterialFee : 0;
                                if (pmFee <= 0) continue;
                                const createDay = (ord.createTime && typeof ord.createTime.day === 'number') ? ord.createTime.day : 0;

                                // 重置为 0（既然有库存，包装材料费应该是 0）
                                fees.packagingMaterialFee = 0;
                                if (typeof fees.total === 'number') {
                                    fees.total = Math.max(0, parseFloat((fees.total - pmFee).toFixed(4)));
                                }
                                ord.fees = fees;
                                orderFeeRefundTotal += pmFee;
                                if (createDay > 0) {
                                    // 同时修正 dailyStats（订单 packagingMaterialFee 属于包装物料支出）
                                    const ds = dailyStats.find(x => x.day === createDay);
                                    if (ds) {
                                        ds.expense_packaging = Math.max(0, parseFloat(((ds.expense_packaging || 0) - pmFee).toFixed(4)));
                                        if (typeof ds.cost === 'number') ds.cost = Math.max(0, parseFloat((ds.cost - pmFee).toFixed(4)));
                                        if (typeof ds.profit === 'number') ds.profit = parseFloat((ds.profit + pmFee).toFixed(4));
                                    }
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.warn('[包装物料BUG修复] 修正订单fees异常，已跳过:', e && e.message);
                }
                if (orderFeeRefundTotal > 0) {
                    totalRefund += orderFeeRefundTotal;
                }

                // ---- Step 4: 把多扣的钱全额退给玩家 ----
                if (totalRefund > 0) {
                    totalRefund = Math.round(totalRefund * 100) / 100;
                    if (!root.shop || typeof root.shop !== 'object') root.shop = {};
                    if (typeof root.shop.funds !== 'number') root.shop.funds = 0;
                    root.shop.funds = parseFloat(((root.shop.funds) + totalRefund).toFixed(4));
                }

                // ---- Step 5: 强制触发库存迁移，兼容三种格式 ----
                try {
                    if (!root.warehouse) root.warehouse = {};
                    if (!root.warehouse.packagingMaterials || typeof root.warehouse.packagingMaterials !== 'object') {
                        root.warehouse.packagingMaterials = {};
                    }
                    const std = root.warehouse.packagingMaterials;
                    const PM_REF = (typeof PACKAGING_MATERIALS !== 'undefined') ? PACKAGING_MATERIALS : null;
                    // 格式A：顶层 state.packagingMaterials 纯数字
                    // 格式B：顶层 state.packagingMaterials 对象 {quantity,cost}
                    if (root.packagingMaterials && typeof root.packagingMaterials === 'object'
                        && !Array.isArray(root.packagingMaterials)) {
                        let migrated = false;
                        for (const [k, v] of Object.entries(root.packagingMaterials)) {
                            if (PM_REF && !PM_REF[k]) continue;
                            let realQty = 0;
                            if (typeof v === 'number' && isFinite(v)) {
                                realQty = v;
                            } else if (v && typeof v === 'object') {
                                if (typeof v.quantity === 'number' && isFinite(v.quantity)) realQty = v.quantity;
                                else if (typeof v.qty === 'number' && isFinite(v.qty)) realQty = v.qty;
                            }
                            if (!realQty || realQty <= 0) continue;
                            std[k] = parseFloat((parseFloat(std[k] || 0) + parseFloat(realQty)).toFixed(4));
                            migrated = true;
                        }
                        if (migrated) {
                            try { root.packagingMaterials = {}; } catch (_) {}
                        }
                    }
                    // 格式C：ERP 旧版 state.warehouse.materials[id] = {qty} / {quantity}
                    if (root.warehouse.materials && typeof root.warehouse.materials === 'object') {
                        let migrated2 = false;
                        for (const [k, m] of Object.entries(root.warehouse.materials)) {
                            if (!m || typeof m !== 'object') continue;
                            if (PM_REF && !PM_REF[k]) continue;
                            let qty = 0;
                            if (typeof m.qty === 'number' && isFinite(m.qty)) qty = m.qty;
                            else if (typeof m.quantity === 'number' && isFinite(m.quantity)) qty = m.quantity;
                            if (!qty || qty <= 0) continue;
                            std[k] = parseFloat((parseFloat(std[k] || 0) + parseFloat(qty)).toFixed(4));
                            migrated2 = true;
                            if ('qty' in m) m.qty = 0;
                            if ('quantity' in m) m.quantity = 0;
                        }
                    }
                } catch (_) {}

                // ---- Step 6: 标记「已修复」避免重复退款 ----
                // ⚠️ 必须可序列化：enumerable=false 会导致存档不持久，每次读档都重复退款刷钱
                try {
                    root._fixPackagingBugApplied = true;
                } catch (_) {}
            } catch (e) {
                console.warn('[包装物料BUG修复] 兼容处理异常，已跳过:', e && e.message);
            }
        })(saved);

        // ==================== 员工底薪统一 2500（兼容旧存档）====================
        (function fixEmployeeBaseSalary2500(root) {
            try {
                if (!root || root._fixBaseSalary2500Applied === true) return;
                const emps = Array.isArray(root.employees) ? root.employees : [];
                emps.forEach(emp => {
                    if (!emp || !emp.type) return;
                    const typeInfo = (typeof EMPLOYEE_TYPES !== 'undefined') ? EMPLOYEE_TYPES[emp.type] : null;
                    const fixed = (typeInfo && typeof typeInfo.baseSalary === 'number') ? typeInfo.baseSalary : 2500;
                    emp.baseSalary = fixed;
                    emp.positionSalary = 0;
                });
                root._fixBaseSalary2500Applied = true;
            } catch (_) {}
        })(saved);

        // ==================== 取消「包装材料仓储费」日扣（兼容旧存档）====================
        // 包材买进时已付款；旧版按库存货值 0.08%/天再扣，套装买多后每天几万进「包装物料」
        (function fixPackagingStorageFeeOnLoad(root) {
            try {
                if (!root || !root.finance || typeof root.finance !== 'object') return;
                if (root._fixPackagingStorageFeeApplied === true) return;

                const records = Array.isArray(root.finance.records) ? root.finance.records : [];
                const dailyStats = Array.isArray(root.finance.dailyStats) ? root.finance.dailyStats : [];
                const dirtyIdx = [];
                const perDay = {};
                let totalRefund = 0;

                for (let i = 0; i < records.length; i++) {
                    const r = records[i];
                    if (!r || r.type !== 'expense') continue;
                    const reason = String(r.reason || '');
                    if (reason.indexOf('包装材料仓储费') === -1 && reason.indexOf('包材仓储') === -1) continue;
                    const amt = typeof r.amount === 'number' ? r.amount : 0;
                    if (amt <= 0) continue;
                    dirtyIdx.push(i);
                    totalRefund += amt;
                    const d = typeof r.day === 'number' ? r.day : 0;
                    if (d > 0) perDay[d] = (perDay[d] || 0) + amt;
                }

                if (dirtyIdx.length > 0) {
                    dirtyIdx.sort((a, b) => b - a).forEach(i => records.splice(i, 1));
                    root.finance.records = records;
                }

                for (let d = 0; d < dailyStats.length; d++) {
                    const ds = dailyStats[d];
                    if (!ds || typeof ds !== 'object') continue;
                    const refund = perDay[ds.day] || 0;
                    if (refund <= 0) continue;
                    ds.expense_packaging = Math.max(0, parseFloat(((ds.expense_packaging || 0) - refund).toFixed(4)));
                    if (typeof ds.cost === 'number') {
                        ds.cost = Math.max(0, parseFloat((ds.cost - refund).toFixed(4)));
                    }
                    if (typeof ds.profit === 'number') {
                        ds.profit = parseFloat((ds.profit + refund).toFixed(4));
                    }
                }

                if (totalRefund > 0) {
                    totalRefund = Math.round(totalRefund * 100) / 100;
                    if (!root.shop || typeof root.shop !== 'object') root.shop = {};
                    if (typeof root.shop.funds !== 'number') root.shop.funds = 0;
                    root.shop.funds = parseFloat((root.shop.funds + totalRefund).toFixed(4));
                }

                root._fixPackagingStorageFeeApplied = true;
            } catch (e) {
                console.warn('[包装仓储费修复] 兼容处理异常，已跳过:', e && e.message);
            }
        })(saved);

        return saved;
    }

    _getHourKey(day, hour) {
        return 'D' + day + 'H' + hour;
    }
    
    // 员工处理记录累加
    addEmployeeStat(employeeId, action, amount = 1) {
        const emp = this.state.employees.find(e => e.id === employeeId);
        if (!emp) return;
        if (!emp.stats) emp.stats = { ordersPacked:0, ordersShipped:0, consultationsHandled:0,
                                      marketingRuns:0, marketingOrdersGenerated:0, hourlyCounts:{} };
        if (action === 'pack') emp.stats.ordersPacked += amount;
        else if (action === 'ship') emp.stats.ordersShipped += amount;
        else if (action === 'consultation') emp.stats.consultationsHandled += amount;
        else if (action === 'marketing') emp.stats.marketingRuns += amount;
        else if (action === 'marketingOrders') emp.stats.marketingOrdersGenerated += amount;
        
        // 每小时计数
        const key = this._getHourKey(this.state.gameTime.day, this.state.gameTime.hour);
        if (!emp.stats.hourlyCounts[key]) emp.stats.hourlyCounts[key] = {packed:0, shipped:0, consultation:0, marketing:0};
        const hc = emp.stats.hourlyCounts[key];
        if (action === 'pack') hc.packed += amount;
        else if (action === 'ship') hc.shipped += amount;
        else if (action === 'consultation') hc.consultation += amount;
        else if (action === 'marketing') hc.marketing += amount;
        
        // 清理超72小时的小时计数，避免存档膨胀
        const allKeys = Object.keys(emp.stats.hourlyCounts);
        if (allKeys.length > 72 * 3) {
            // 只保留最近 144 条（6天×24小时）
            allKeys.sort();
            const drop = allKeys.length - 144;
            if (drop > 0) {
                for (let i = 0; i < drop; i++) delete emp.stats.hourlyCounts[allKeys[i]];
            }
        }
    }
    
    // 员工加经验、自动升级
    addEmployeeExp(employeeId, action, expAmount = 1) {
        const emp = this.state.employees.find(e => e.id === employeeId);
        if (!emp) return 0;
        let leveledUp = 0;
        emp.level = emp.level || 1;
        // ===== 员工管理V2：专注任务经验加成（专注方向命中时 1.5 倍经验）=====
        let actualExp = expAmount;
        if (emp.focusTask && emp.focusTask === action) {
            const mult = (typeof EMP_FOCUS_EXP_MULT === 'number') ? EMP_FOCUS_EXP_MULT : 1.5;
            actualExp = expAmount * mult;
        }
        emp.exp = (emp.exp || 0) + actualExp;
        emp._totalExpAccum = (emp._totalExpAccum || 0) + actualExp; // 累计总经验用于福利档位
        while (emp.level < EMPLOYEE_LEVEL_CONFIG.maxLevel) {
            const need = EMPLOYEE_LEVEL_CONFIG.expToNext(emp.level);
            if (emp.exp < need) break;
            emp.exp -= need;
            emp.level++;
            leveledUp++;
            // 每升1级工资按倍率涨（使用统一的重新计算方法）
            this._recalculateEmployeeSalary(emp);
        }
        return leveledUp;
    }
    
    // 获取员工基础效率（含等级倍率）
    getEmployeeEfficiency(emp) {
        const baseEff = emp.efficiency || (EMPLOYEE_TYPES[emp.type]?.efficiency) || 1.0;
        const lvlMult = EMPLOYEE_LEVEL_CONFIG.efficiencyMultiplier(emp.level || 1);
        let eff = baseEff * lvlMult;
        // 店长督促光环：如果团队里有在职店长（非自己），额外加BUFF
        if (emp.type !== 'manager' && this._hasActiveManager()) {
            eff *= 2.0; // 店长督促，员工干活速度翻倍
        }
        try { eff *= this.getPlayerAttrFactor('management', 0.02); } catch (_) {}
        return eff;
    }

    // 检查团队中是否有在职店长（用于督促光环计算）
    _hasActiveManager() {
        if (!this.state || !this.state.employees) return false;
        // 带缓存标记位，避免每员工都遍历（1小时内有效，超过游戏时间1小时重算）
        const now = this.state.gameTime || { day: 0, hour: 0 };
        const cacheKey = now.day + '_' + now.hour;
        if (this._mgrCache && this._mgrCache.key === cacheKey) {
            return this._mgrCache.result;
        }
        const hasMgr = this.state.employees.some(e =>
            e.type === 'manager' && e.status === 'active'
        );
        this._mgrCache = { key: cacheKey, result: hasMgr };
        return hasMgr;
    }

    /** 是否有在职客服或店长（自动上架前置条件） */
    hasActiveCsOrManager() {
        if (!this.state || !this.state.employees) return false;
        const now = this.state.gameTime || { day: 0, hour: 0 };
        const cacheKey = now.day + '_' + now.hour;
        if (this._csOrMgrCache && this._csOrMgrCache.key === cacheKey) {
            return this._csOrMgrCache.result;
        }
        const ok = this.state.employees.some(e =>
            e && e.status === 'active' &&
            (e.type === 'customerService' || e.type === 'manager' ||
             e.position === 'customerService' || e.position === 'manager')
        );
        this._csOrMgrCache = { key: cacheKey, result: ok };
        return ok;
    }

    /** 是否有在职客服（手动上架商品的前置条件；没有客服不能上架） */
    hasActiveCustomerService() {
        if (!this.state || !this.state.employees) return false;
        return this.state.employees.some(e =>
            e && e.status === 'active' &&
            (e.type === 'customerService' || e.position === 'customerService')
        );
    }

    /** 是否有在职改价员（批量改价的前置条件） */
    hasActivePricer() {
        if (!this.state || !this.state.employees) return false;
        return this.state.employees.some(e =>
            e && e.status === 'active' &&
            (e.type === 'pricer' || e.position === 'pricer')
        );
    }

    // 获取店长督促光环的说明信息（供UI显示用）
    getManagerAuraInfo() {
        const hasMgr = this._hasActiveManager();
        if (!hasMgr) return { active: false, multiplier: 1, label: '无（建议雇佣店长提升全员效率）' };
        // 统计在职店长数量和等级（取最高等级作为光环强度参考）
        const mgrs = (this.state.employees || []).filter(e => e.type === 'manager' && e.status === 'active');
        const maxLv = mgrs.reduce((m, e) => Math.max(m, e.level || 1), 1);
        return {
            active: true,
            multiplier: 2.0,
            managerCount: mgrs.length,
            maxManagerLevel: maxLv,
            label: `店长督促中 ×2.0（${mgrs.length}位店长，最高Lv.${maxLv}）`
        };
    }

    // 获取员工某任务类型的实际效率（含专业匹配加成）
    // skillType: 'pack' | 'ship' | 'consultation' | 'marketing'
    getEmployeeTaskEfficiency(emp, skillType) {
        const baseEff = this.getEmployeeEfficiency(emp);
        const typeInfo = EMPLOYEE_TYPES[emp.type];
        const specialty = (typeInfo?.specialtyBonus && typeInfo.specialtyBonus[skillType]) || 1.0;
        let eff = baseEff * specialty;
        // ===== 员工管理V2：专注任务加成（emp.focusTask 命中当前技能）=====
        if (emp && emp.focusTask && emp.focusTask === skillType) {
            const focusBonus = (typeof EMP_FOCUS_BONUS === 'number') ? EMP_FOCUS_BONUS : 0.25;
            eff *= (1 + focusBonus);
        }
        // ===== 员工管理V2：培训永久加成（employeeState.getTrainingBuff，上限由模块控制）=====
        try {
            if (typeof employeeState !== 'undefined' && employeeState && typeof employeeState.getTrainingBuff === 'function') {
                const buff = employeeState.getTrainingBuff(emp, skillType);
                if (buff > 0) eff *= (1 + buff);
            }
        } catch (_) {}
        // ===== 员工管理V2：心情倍率（忠诚度·情绪系统，心情高低影响效率）=====
        try {
            if (typeof employeeState !== 'undefined' && employeeState && typeof employeeState.getMoodEfficiencyMult === 'function') {
                eff *= employeeState.getMoodEfficiencyMult(emp);
            }
        } catch (_) {}
        return eff;
    }

    // 获取员工核心专精技能
    getEmployeePrimarySkill(emp) {
        const typeInfo = EMPLOYEE_TYPES[emp.type];
        return typeInfo?.primarySkill || (emp.skills && emp.skills[0]) || null;
    }

    // 智能任务优先级评估：基于员工专精 + 各环节积压量评分
    // 返回排序后的技能数组，优先执行得分最高的任务
    getPrioritizedSkills(emp, backlogStats) {
        const skills = emp.skills || [];
        if (skills.length <= 1) return skills;
        const primarySkill = this.getEmployeePrimarySkill(emp);
        const isMarketer = emp.type === 'promoter' || emp.type === 'manager'
            || primarySkill === 'marketing' || primarySkill === 'promotion';
        const scored = skills.map(skill => {
            let score = 0;
            // 核心专精基础分 +3
            if (skill === primarySkill) score += 3;
            // 积压量加权分（关键！让员工优先处理瓶颈环节）
            const backlog = backlogStats[skill] || 0;
            // 积压≥5个才开始加分，避免员工在轻积压时频繁切换任务
            if (backlog >= 5) score += Math.min(6, Math.floor(backlog / 5));
            // 店长/推广员：有可推商品时营销优先（打包积压极高才让路）
            if ((skill === 'marketing' || skill === 'promotion') && backlog > 0) {
                score += isMarketer ? 8 : 2;
                if (isMarketer && (backlogStats.pack || 0) < 40) score += 4;
            }
            // 非营销岗位在打包严重积压时仍优先打包
            if (skill === 'pack' && (backlogStats.pack || 0) >= 40 && !isMarketer) score += 5;
            return { skill, score };
        });
        scored.sort((a, b) => b.score - a.score);
        return scored.map(s => s.skill);
    }
    
    // 主动升级员工（消耗金钱晋升1级）— 按等级翻倍的晋升费用机制
    upgradeEmployee(employeeId) {
        const emp = this.state.employees.find(e => e.id === employeeId);
        if (!emp) return { success: false, message: '员工不存在' };
        const curLevel = emp.level || 1;
        if (curLevel >= EMPLOYEE_LEVEL_CONFIG.maxLevel) {
            return { success: false, message: '已满级' };
        }
        const cost = EMPLOYEE_LEVEL_CONFIG.promotionCost(curLevel);
        // ============= 通过 spendFunds 统一扣款（支持欠款机制+自动记录流水）=============
        if (!this.spendFunds(cost, `员工[${emp.name}] Lv.${curLevel}→Lv.${curLevel+1} 晋升费`)) {
            const info = this.getDebtInfo();
            return { success: false, message: '资金不足（欠款上限 ¥' + info.maxDebt.toLocaleString() + '），晋升需 ' + formatMoney(cost) };
        }
        const levels = this._forcePromoteLevel(emp, 1);
        return { success: true, levels, cost, newLevel: emp.level };
    }

    // 直接晋升员工N级（跳过经验累积，直接到 level + n）
    _forcePromoteLevel(emp, n = 1) {
        if (!emp || n <= 0) return 0;
        let levelsGained = 0;
        while (levelsGained < n && (emp.level || 1) < EMPLOYEE_LEVEL_CONFIG.maxLevel) {
            const fromLv = emp.level || 1;
            // 花钱晋升也计入累计经验（满足福利档位门槛，避免永远卡在实习生）
            const need = (typeof EMPLOYEE_LEVEL_CONFIG !== 'undefined' && EMPLOYEE_LEVEL_CONFIG.expToNext)
                ? EMPLOYEE_LEVEL_CONFIG.expToNext(fromLv) : 100;
            emp._totalExpAccum = (emp._totalExpAccum || 0) + need;
            emp.level = fromLv + 1;
            emp.exp = 0; // 晋升后从下一级的0经验开始继续积累
            levelsGained++;
            if (typeof this._onEmployeeLevelUp === 'function') this._onEmployeeLevelUp(emp);
        }
        return levelsGained;
    }

    // 一键升级单员工：按等级翻倍的晋升费，升到满级或没钱为止
    upgradeEmployeeOneKey(employeeId) {
        const emp = this.state.employees.find(e => e.id === employeeId);
        if (!emp) return { success: false, message: '员工不存在' };
        if ((emp.level || 1) >= EMPLOYEE_LEVEL_CONFIG.maxLevel) {
            return { success: false, message: '已满级' };
        }
        const startLevel = emp.level || 1;
        // =========== 先"预演"计算能升多少级 + 累计需要多少总费用，在欠款上限内一次性扣 ========
        let testFunds = this.state.shop.funds;
        let predictedTotalCost = 0;
        let predictedLevels = 0;
        let lv = startLevel;
        let safety = 999;
        while (safety-- > 0 && lv < EMPLOYEE_LEVEL_CONFIG.maxLevel) {
            const cc = EMPLOYEE_LEVEL_CONFIG.promotionCost(lv);
            if (testFunds - cc >= SHOP_CONFIG.maxDebt) {
                testFunds -= cc;
                predictedTotalCost += cc;
                predictedLevels++;
                lv++;
            } else break;
        }
        if (predictedLevels === 0) {
            const info = this.getDebtInfo();
            return {
                success: false, levelsGained: 0, totalCost: 0, newLevel: startLevel,
                message: (this.state.shop.funds <= 0 ? '资金不足（欠款上限 ¥' + info.maxDebt.toLocaleString() + '）' : '已达当前欠款上限可支持的最高等级'),
                reachedMax: false
            };
        }
        // ============ 正式执行：通过 spendFunds 一次性扣总费用 ============
        if (!this.spendFunds(predictedTotalCost, `🚀 一键晋升·员工[${emp.name}] Lv.${startLevel}→Lv.${startLevel + predictedLevels} (${predictedLevels}级)`)) {
            return { success: false, levelsGained: 0, totalCost: 0, newLevel: startLevel, reachedMax: false, message: '扣款失败，已达到欠款上限' };
        }
        const levelsGained = this._forcePromoteLevel(emp, predictedLevels);
        return {
            success: true,
            levelsGained, totalCost: predictedTotalCost, newLevel: emp.level,
            reachedMax: (emp.level || 1) >= EMPLOYEE_LEVEL_CONFIG.maxLevel,
            message: `🎉 已晋升至 Lv.${emp.level}（+${levelsGained}级），花费 ${formatMoney(predictedTotalCost)}`
        };
    }

    // 批量一键升级：所有员工一起按晋升费翻倍机制一键升级
    upgradeEmployeeBatchAll() {
        if (!this.state.employees.length) return { success: false, message: '暂无员工' };

        // ============ 预演：逐个员工计算最高可晋升等级+累计总费用 ============
        const plan = this.state.employees.map(emp => {
            if ((emp.level || 1) >= EMPLOYEE_LEVEL_CONFIG.maxLevel) {
                return { emp, cost: 0, levels: 0, maxed: true };
            }
            let cc = 0, lvUp = 0, lv = emp.level || 1, tFunds = 0, safe = 999;
            // 注意：批量预演时按"已预算的cc"继续往下算（不能真扣）
            let runningCost = 0;
            while (safe-- > 0 && lv < EMPLOYEE_LEVEL_CONFIG.maxLevel) {
                const nextCost = EMPLOYEE_LEVEL_CONFIG.promotionCost(lv);
                if (this.state.shop.funds - cc - nextCost >= SHOP_CONFIG.maxDebt) {
                    cc += nextCost; lvUp++; lv++; runningCost += nextCost;
                } else break;
            }
            return { emp, cost: cc, levels: lvUp, maxed: lvUp === 0 && (emp.level || 1) >= EMPLOYEE_LEVEL_CONFIG.maxLevel };
        });

        const totalCost = plan.reduce((s, p) => s + p.cost, 0);
        const levelsSum = plan.reduce((s, p) => s + p.levels, 0);
        const upgraded = plan.filter(p => p.levels > 0).length;
        const alreadyMaxed = plan.filter(p => p.maxed).length;
        const notAfford = this.state.employees.length - upgraded - alreadyMaxed;

        if (totalCost === 0) {
            return {
                success: false, totalCost: 0, levelsSum: 0, upgraded: 0, alreadyMaxed, notAfford,
                message: `无可晋升员工：${alreadyMaxed}人已满级，${notAfford}人未达欠款上限内的晋升条件`
            };
        }

        // ============ 正式执行：一次性扣总费用 + 逐个员工晋升 ============
        if (!this.spendFunds(totalCost, `🔋 批量晋升·${upgraded}名员工 (共+${levelsSum}级)`)) {
            return { success: false, totalCost: 0, levelsSum: 0, upgraded: 0, alreadyMaxed, notAfford, message: '批量扣款失败，已达欠款上限' };
        }
        plan.forEach(p => { if (p.levels > 0) this._forcePromoteLevel(p.emp, p.levels); });
        return {
            success: true, totalCost, levelsSum, upgraded, alreadyMaxed, notAfford,
            message: `🔋 批量晋升完成：${upgraded}人获晋升（共+${levelsSum}级），花费 ${formatMoney(totalCost)}；${alreadyMaxed}人已满级，${notAfford}人暂未达标`
        };
    }

    subscribe(listener) {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    /**
     * 批量通知：tick / 爆单生成期间合并 UI 刷新，避免每单 notify 卡死主线程
     * beginNotifyBatch() … 大量 addOrder/updateOrderStatus … endNotifyBatch()
     */
    beginNotifyBatch() {
        this._notifyBatchDepth = (this._notifyBatchDepth || 0) + 1;
        this._notifyBatchDirty = !!this._notifyBatchDirty;
    }

    endNotifyBatch(forceNotify = true) {
        this._notifyBatchDepth = Math.max(0, (this._notifyBatchDepth || 0) - 1);
        if (this._notifyBatchDepth === 0 && forceNotify && this._notifyBatchDirty) {
            this._notifyBatchDirty = false;
            // 用户正在点击且订单量大：推迟 UI 刷新，把主线程让给交互
            try {
                const n = (this.state.orders && this.state.orders.length) || 0;
                const uiRef = (typeof ui !== 'undefined') ? ui
                    : (typeof window !== 'undefined' ? window.ui : null);
                if (uiRef && typeof uiRef._isUserInteracting === 'function' && uiRef._isUserInteracting()) {
                    if (this._deferredNotifyTimer) clearTimeout(this._deferredNotifyTimer);
                    this._deferredNotifyTimer = setTimeout(() => {
                        this._deferredNotifyTimer = null;
                        this._flushNotify();
                    }, n >= 400 ? 280 : 160);
                    return;
                }
            } catch (_) {}
            this._flushNotify();
        } else if (this._notifyBatchDepth === 0) {
            this._notifyBatchDirty = false;
        }
    }

    isNotifyBatching() {
        return (this._notifyBatchDepth || 0) > 0;
    }

    /** 爆单索引：按状态取订单（无 OrderPerf 时回退 filter） */
    getOrdersByStatus(status) {
        const orders = this.state.orders || [];
        try {
            if (typeof OrderPerf !== 'undefined' && OrderPerf.getByStatus) {
                return OrderPerf.getByStatus(status, orders);
            }
        } catch (_) {}
        return orders.filter(o => o && o.status === status);
    }

    /** 强制重建订单索引（裁剪/读档后可用） */
    invalidateOrderIndex() {
        try {
            if (typeof OrderPerf !== 'undefined' && OrderPerf.markDirty) OrderPerf.markDirty();
        } catch (_) {}
    }

    /** 当前订单负载档位 0~4（供 UI/引擎节流） */
    getOrderLoadLevel() {
        const n = (this.state.orders && this.state.orders.length) || 0;
        try {
            if (typeof OrderPerf !== 'undefined' && OrderPerf.getLoadLevel) return OrderPerf.getLoadLevel(n);
        } catch (_) {}
        if (n < 500) return 0;
        if (n < 2000) return 1;
        if (n < 5000) return 2;
        if (n < 12000) return 3;
        return 4;
    }

    _flushNotify() {
        const listeners = this.listeners;
        const state = this.state;
        for (let i = 0; i < listeners.length; i++) {
            try { listeners[i](state); } catch (e) { console.warn('[notify]', e); }
        }
    }

    notify() {
        if ((this._notifyBatchDepth || 0) > 0) {
            this._notifyBatchDirty = true;
            return;
        }
        try {
            const n = (this.state.orders && this.state.orders.length) || 0;
            const uiRef = (typeof ui !== 'undefined') ? ui
                : (typeof window !== 'undefined' ? window.ui : null);
            if (uiRef && typeof uiRef._isUserInteracting === 'function' && uiRef._isUserInteracting()) {
                if (this._deferredNotifyTimer) clearTimeout(this._deferredNotifyTimer);
                this._deferredNotifyTimer = setTimeout(() => {
                    this._deferredNotifyTimer = null;
                    this._flushNotify();
                }, n >= 400 ? 280 : 160);
                return;
            }
        } catch (_) {}
        this._flushNotify();
    }

    setState(updater) {
        if (typeof updater === 'function') {
            updater(this.state);
        } else {
            this.state = { ...this.state, ...updater };
        }
        // 守卫巡检：updater 里整体替换 shop、或 { ...state } 展开后丢失访问器时重新收口
        try { GameEconomyGuard.verifyState(this.state); } catch (_) {}
        this.notify();
    }

    // ================= 暂停 / 恢复功能 =================
    // 切换暂停状态（最常用：点一下暂停，再点一下恢复）
    togglePause() {
        this.setState(s => {
            s.gameTime.isPaused = !s.gameTime.isPaused;
            // 触发事件：供引擎/UI做额外视觉反馈
            eventBus && eventBus.emit && eventBus.emit('game:pause:change', { isPaused: s.gameTime.isPaused });
        });
        return this.isPaused();
    }

    // 强制设置暂停(true)或恢复(false)
    setPause(paused) {
        const boolPaused = !!paused;
        if (this.isPaused() === boolPaused) return boolPaused;
        this.setState(s => {
            s.gameTime.isPaused = boolPaused;
            eventBus && eventBus.emit && eventBus.emit('game:pause:change', { isPaused: boolPaused });
        });
        return boolPaused;
    }

    /** 兼容旧调用名 setPaused */
    setPaused(paused) {
        return this.setPause(paused);
    }

    // 返回当前是否处于暂停状态
    isPaused() {
        return !!(this.state && this.state.gameTime && this.state.gameTime.isPaused);
    }

    /**
     * 防抖+节流保存：保证数据及时落盘，同时避免频繁IO
     * 委托 saveManager：快速哈希跳过未变存档 + 动态防抖(5~30s) + 三副本写入
     */
    saveDebounced() {
        if (typeof saveManager !== 'undefined') saveManager.saveDebounced();
    }

    /** 内部调用：检查是否需要保存（hash 变化时触发防抖保存） */
    _saveInternalIfNeeded() {
        if (typeof saveManager !== 'undefined') saveManager.saveDebounced();
    }

    /** 存档体积预警处理（委托 saveManager） */
    _handleArchiveWarn(rawSize) {
        if (typeof saveManager !== 'undefined') saveManager._handleArchiveWarn(rawSize);
    }

    /** 快速状态哈希（委托 saveManager，用于跳过未变存档） */
    _computeFastStateHash() {
        if (typeof saveManager !== 'undefined') return saveManager._computeFastStateHash();
        return '';
    }

    /** 强制立即保存（取消防抖，立即落盘），返回 Promise */
    flushSave() {
        if (typeof saveManager !== 'undefined') return saveManager.flushSave();
        return Promise.resolve({ success: false, error: 'saveManager 未加载' });
    }

    /**
     * 修复可自愈的存档字段（字符串数字、空数组等），避免误清空进度
     */
    _repairState(root) {
        if (!root || typeof root !== 'object') return root;
        const toNum = (v, fallback = 0) => {
            if (typeof v === 'number' && isFinite(v)) return v;
            if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return Number(v);
            return fallback;
        };
        const ensureArr = (obj, key) => {
            if (!obj) return;
            if (!Array.isArray(obj[key])) obj[key] = [];
        };
        if (!root.shop || typeof root.shop !== 'object') root.shop = {};
        // 资金：非数字/NaN/Infinity/负数越界/离谱值统一收口（读档防脏数据）
        root.shop.funds = GameEconomyGuard.sanitize(toNum(root.shop.funds, 0), 0);
        if (root.shop.reputation != null) root.shop.reputation = toNum(root.shop.reputation, 0);
        if (root.shop.level != null) root.shop.level = toNum(root.shop.level, 1);
        if (!root.gameTime || typeof root.gameTime !== 'object') root.gameTime = { day: 1, hour: 0 };
        root.gameTime.day = Math.max(1, Math.floor(toNum(root.gameTime.day, 1)));
        root.gameTime.hour = Math.max(0, Math.min(23, Math.floor(toNum(root.gameTime.hour, 0))));
        ensureArr(root, 'orders');
        ensureArr(root, 'inventory');
        ensureArr(root, 'listings');
        ensureArr(root, 'employees');
        if (!root.settings || typeof root.settings !== 'object') root.settings = {};
        if (typeof root.settings.soundEnabled !== 'boolean') root.settings.soundEnabled = true;
        // 跳一天次数：旧档缺失时补齐为新手额度 50
        if (typeof root.settings.skipDayQuota !== 'number' || !isFinite(root.settings.skipDayQuota)) {
            root.settings.skipDayQuota = 50;
        } else {
            root.settings.skipDayQuota = Math.max(0, Math.floor(root.settings.skipDayQuota));
        }
        return root;
    }

    /** 确保行动次数字段存在（跳一天） */
    ensureActionQuotas() {
        if (!this.state.settings || typeof this.state.settings !== 'object') this.state.settings = {};
        const s = this.state.settings;
        if (typeof s.skipDayQuota !== 'number' || !isFinite(s.skipDayQuota)) s.skipDayQuota = 50;
        else s.skipDayQuota = Math.max(0, Math.floor(s.skipDayQuota));
        return s;
    }

    /** 跳一天剩余次数（看广告 +5 / 花1000万买1次 补给） */
    getSkipDayQuota() {
        return this.ensureActionQuotas().skipDayQuota;
    }

    /** @returns {boolean} 是否成功消耗 1 次 */
    consumeSkipDayQuota() {
        const s = this.ensureActionQuotas();
        if (s.skipDayQuota < 1) return false;
        s.skipDayQuota -= 1;
        try { this.notify(); } catch (_) {}
        try { this.saveDebounced(); } catch (_) {}
        return true;
    }

    /**
     * 看广告增加次数
     * @param {number} [amount=5]
     */
    addActionQuota(amount = 5) {
        const s = this.ensureActionQuotas();
        const n = Math.max(0, Math.floor(Number(amount) || 0));
        s.skipDayQuota += n;
        try { this.notify(); } catch (_) {}
        try { this.saveDebounced(); } catch (_) {}
        return s.skipDayQuota;
    }

    /** 花钱买 1 次跳一天，单价 1000 万 */
    buyActionQuota(kind) {
        const price = 10000000;
        const label = '购买跳一天次数';
        if (typeof this.spendFunds !== 'function' || !this.spendFunds(price, label)) {
            return { ok: false, error: '资金不足，需要 ¥1000万' };
        }
        const left = this.addActionQuota(1);
        return { ok: true, left, price };
    }

    hasAdTrafficBoostToday() {
        try {
            const day = (this.state.gameTime && this.state.gameTime.day) || 1;
            return !!(this.state.settings && this.state.settings.lastAdTrafficDay === day);
        } catch (_) {
            return false;
        }
    }

    isAdTrafficBoostActive() {
        try {
            const until = this.state.settings && this.state.settings.adTrafficUntil;
            if (!until) return false;
            const gt = this.state.gameTime || {};
            const day = gt.day || 1;
            const hour = gt.hour || 0;
            if (day > until.day) return false;
            if (day === until.day && hour >= until.hour) return false;
            return true;
        } catch (_) {
            return false;
        }
    }

    grantAdTrafficBoost(hours = 6) {
        try {
            if (!this.state.settings || typeof this.state.settings !== 'object') this.state.settings = {};
            const n = Math.max(1, Math.floor(Number(hours) || 6));
            const gt = this.state.gameTime || { day: 1, hour: 0 };
            let day = gt.day || 1;
            let hour = (gt.hour || 0) + n;
            while (hour >= 24) { hour -= 24; day += 1; }
            this.state.settings.adTrafficUntil = { day, hour };
            this.state.settings.lastAdTrafficDay = gt.day || 1;
            try { this.notify(); } catch (_) {}
            try { this.saveDebounced(); } catch (_) {}
            return true;
        } catch (_) {
            return false;
        }
    }

    getCostMarkupPrice(productId, qualityGrade = 'B', markup = 1.5) {
        const cost = (typeof this.getPricingCostBasis === 'function')
            ? this.getPricingCostBasis(productId, qualityGrade)
            : (this.getAverageCost(productId, qualityGrade) || 0);
        const basis = cost > 0 ? cost : 0.01;
        return Math.round(basis * (markup > 0 ? markup : 1.5) * 100) / 100;
    }

    /**
     * 玩家设定的「按成本批量改价」百分比（默认150，可调范围 100~400）
     * 存档于 state.shop.costMarkupPct，随主存档持久化；改价员自动改价同样使用该比例
     */
    getCostMarkupPct() {
        const s = this.state && this.state.shop;
        const raw = (s && typeof s.costMarkupPct === 'number' && isFinite(s.costMarkupPct))
            ? Math.round(s.costMarkupPct) : 150;
        return Math.max(100, Math.min(400, raw));
    }

    setCostMarkupPct(pct) {
        const p = Math.max(100, Math.min(400, Math.round(Number(pct) || 150)));
        if (this.state && this.state.shop) {
            this.state.shop.costMarkupPct = p;
            try { this.saveDebounced(); } catch (_) {}
        }
        return p;
    }

    applyCostMarkupToListings(markup = 1.5) {
        // 倍数钳制：仅允许 1.0x~4.0x（对应 100%~400%）
        const mult = Math.max(1, Math.min(4, Number(markup) > 0 ? Number(markup) : 1.5));
        const listings = this.state.listings || [];
        let n = 0;
        listings.forEach(l => {
            if (!l || l.status !== 'active') return;
            const price = this.getCostMarkupPrice(l.productId, l.qualityGrade || 'B', mult);
            if (price > 0 && Math.abs((Number(l.price) || 0) - price) > 0.009) {
                l.price = price;
                l.priceSource = 'cost_markup';
                n++;
            }
        });
        if (n > 0) {
            try { this.notify(); } catch (_) {}
            try { this.saveDebounced(); } catch (_) {}
        }
        return n;
    }

    addReplyCommission(emp, count) {
        if (!emp || !(count > 0)) return 0;
        const cfg = (typeof ROLE_COMMISSION !== 'undefined') ? ROLE_COMMISSION : { csPerTicket: 0.8, csMonthCap: 800 };
        const per = Number(cfg.csPerTicket) || 0.8;
        const cap = Number(cfg.csMonthCap) || 800;
        const used = Number(emp.monthReplyCommission || 0);
        const raw = per * count;
        const room = Math.max(0, cap - used);
        const add = Math.round(Math.min(room, raw) * 100) / 100;
        if (add <= 0) return 0;
        emp.pendingReplyCommission = Math.round(((emp.pendingReplyCommission || 0) + add) * 100) / 100;
        emp.monthReplyCommission = Math.round((used + add) * 100) / 100;
        return add;
    }

    addPricingCommission(emp, listingCount) {
        if (!emp || !(listingCount > 0)) return 0;
        const cfg = (typeof ROLE_COMMISSION !== 'undefined') ? ROLE_COMMISSION : { pricingPerListing: 2, pricingMonthCap: 600 };
        const per = Number(cfg.pricingPerListing) || 2;
        const cap = Number(cfg.pricingMonthCap) || 600;
        const used = Number(emp.monthPricingCommission || 0);
        const raw = per * listingCount;
        const add = Math.round(Math.min(Math.max(0, cap - used), raw) * 100) / 100;
        if (add <= 0) return 0;
        emp.pendingPricingCommission = Math.round(((emp.pendingPricingCommission || 0) + add) * 100) / 100;
        emp.monthPricingCommission = Math.round((used + add) * 100) / 100;
        return add;
    }

    getLawyerCommissionRate() {
        const cfg = (typeof ROLE_COMMISSION !== 'undefined') ? ROLE_COMMISSION : { lawyerDefault: 0.05, lawyerMin: 0.03, lawyerMax: 0.08 };
        const raw = this.state && this.state.shop && this.state.shop.lawyerCommissionRate;
        const n = (typeof raw === 'number' && isFinite(raw)) ? raw : (cfg.lawyerDefault || 0.05);
        return Math.max(cfg.lawyerMin || 0.03, Math.min(cfg.lawyerMax || 0.08, n));
    }

    setLawyerCommissionRate(pct) {
        const cfg = (typeof ROLE_COMMISSION !== 'undefined') ? ROLE_COMMISSION : { lawyerMin: 0.03, lawyerMax: 0.08 };
        const rate = Number(pct) / 100;
        if (!isFinite(rate)) return { success: false, message: '比例无效' };
        const clamped = Math.max(cfg.lawyerMin || 0.03, Math.min(cfg.lawyerMax || 0.08, rate));
        this.state.shop.lawyerCommissionRate = clamped;
        this.notify();
        return { success: true, message: `律师胜诉提成已设为 ${(clamped * 100).toFixed(1)}%` };
    }

    applyPurchaseSpotVariance(unit, product) {
        const base = Number(unit) || 0;
        if (base <= 0) return base;
        const pct = (typeof getPurchaseVariancePct === 'function') ? getPurchaseVariancePct(product) : 0.08;
        const roll = 1 + (Math.random() * 2 - 1) * pct;
        return Math.round(base * roll * 100) / 100;
    }

    addPromoMonthStats(emp, views, orders) {
        if (!emp) return;
        emp.monthPromoViews = (emp.monthPromoViews || 0) + Math.max(0, Number(views) || 0);
        emp.monthPromoOrders = (emp.monthPromoOrders || 0) + Math.max(0, Number(orders) || 0);
    }

    /** 状态合法性校验：关键字段存在且类型正确 */
    _isValidState() {
        const s = this.state;
        const _logFail = (reason) => {
            if (typeof saveManager !== 'undefined') {
                saveManager._log('WARN', '[GS] _isValidState 校验失败: ' + reason);
            }
        };
        if (!s || typeof s !== 'object') { _logFail('state 为空或非对象'); return false; }
        if (!s.shop) { _logFail('缺少 s.shop'); return false; }
        if (typeof s.shop.funds !== 'number' || !isFinite(s.shop.funds)) { _logFail('s.shop.funds 非数字 (实际=' + typeof s.shop.funds + ' 值=' + s.shop.funds + ')'); return false; }
        if (!s.gameTime) { _logFail('缺少 s.gameTime'); return false; }
        if (typeof s.gameTime.day !== 'number' || !isFinite(s.gameTime.day)) { _logFail('s.gameTime.day 非数字 (实际=' + typeof s.gameTime.day + ' 值=' + s.gameTime.day + ')'); return false; }
        if (!Array.isArray(s.orders)) { _logFail('s.orders 非数组 (实际=' + typeof s.orders + ')'); return false; }
        if (!Array.isArray(s.inventory)) { _logFail('s.inventory 非数组 (实际=' + typeof s.inventory + ')'); return false; }
        return true;
    }

    /**
     * 裁剪过期数据，控制存档体积
     * @param {boolean} aggressive - true=激进裁剪（预警/超限时），false=常规裁剪
     * @returns {{ ordersBefore:number, ordersAfter:number }}
     */
    _pruneOldData(aggressive = false) {
        const s = this.state;
        if (!s) return { ordersBefore: 0, ordersAfter: 0 };
        const now = s.gameTime || { day: 1, hour: 0 };
        const shopLv = (s.shop && s.shop.level) || 1;
        // 二心及以后默认更狠：中后期存档体积是卡顿主因
        if (!aggressive && shopLv >= 3) aggressive = true;
        const ordersBefore = Array.isArray(s.orders) ? s.orders.length : 0;
        // ===== 3.6 更狠裁剪：累计统计已接管成就/评价，终态订单可大幅削减 =====
        const keepTerminalDays = aggressive ? 1 : 2;       // 终态订单保留天数
        const maxTerminal = aggressive ? 60 : 150;          // 终态订单数量上限（成就/评价走累计统计，不依赖留存）
        const maxTotalOrders = aggressive ? 500 : 1200;     // 订单总量上限
        const financeLimit = aggressive ? 100 : 250;
        const logLimit = aggressive ? 120 : 250;

        // 1. finance.records
        if (s.finance && Array.isArray(s.finance.records) && s.finance.records.length > financeLimit) {
            s.finance.records = s.finance.records.slice(-financeLimit);
        }
        if (s.finance && Array.isArray(s.finance.dailyStats) && s.finance.dailyStats.length > 90) {
            s.finance.dailyStats = s.finance.dailyStats.slice(-90);
        }

        // 2. promotionLogs
        if (s.marketing && Array.isArray(s.marketing.promotionLogs)) {
            const pl = aggressive ? 100 : 300;
            if (s.marketing.promotionLogs.length > pl) {
                s.marketing.promotionLogs = s.marketing.promotionLogs.slice(-pl);
            }
        }

        // 3. 订单：按天龄清理终态 + 数量硬顶 + 瘦身 statusHistory
        if (Array.isArray(s.orders)) {
            try {
                const ge = (typeof gameEngine !== 'undefined') ? gameEngine
                    : (typeof window !== 'undefined' ? window.gameEngine : null);
                (s.orders || []).forEach(o => {
                    if (!o || o.status !== 'completed' || o.review || o.reviewGenerated) return;
                    if (ge && typeof ge._tryGenerateBuyerReview === 'function') {
                        ge._tryGenerateBuyerReview(o, now);
                    }
                    if (!o.review && !o.reviewGenerated) {
                        o.reviewGenerated = true;
                        this.addReview(o.id, 5, '');
                    }
                });
            } catch (_) {}
            const terminal = new Set(['completed', 'cancelled', 'returned', 'refunded']);
            const keepHours = keepTerminalDays * 24;
            let list = s.orders.filter(o => {
                if (!o) return false;
                if (!terminal.has(o.status)) return true;
                const t = o.completeTime || o.cancelTime || o.createTime;
                if (!t || typeof t.day !== 'number') return false;
                const hours = (now.day - t.day) * 24 + (now.hour - (t.hour || 0));
                return hours < keepHours;
            });
            // 终态订单超额：按时间从新到旧保留
            const active = [];
            const done = [];
            for (let i = 0; i < list.length; i++) {
                (terminal.has(list[i].status) ? done : active).push(list[i]);
            }
            if (done.length > maxTerminal) {
                done.sort((a, b) => {
                    const ta = a.completeTime || a.cancelTime || a.createTime || { day: 0, hour: 0 };
                    const tb = b.completeTime || b.cancelTime || b.createTime || { day: 0, hour: 0 };
                    return ((tb.day || 0) * 24 + (tb.hour || 0)) - ((ta.day || 0) * 24 + (ta.hour || 0));
                });
                done.length = maxTerminal;
            }
            list = active.concat(done);
            if (list.length > maxTotalOrders) {
                // 只砍终态；进行中订单永不裁掉（避免已扣库存的在途单被删）
                const act2 = list.filter(o => !terminal.has(o.status));
                let done2 = list.filter(o => terminal.has(o.status));
                const room = Math.max(0, maxTotalOrders - act2.length);
                if (done2.length > room) done2 = done2.slice(0, room);
                list = act2.concat(done2);
            }
            // ===== 3.6 瘦身：状态轨迹/物流轨迹封顶 + 终态订单深度瘦身（存档体积直降）=====
            for (let i = 0; i < list.length; i++) {
                const o = list[i];
                if (!o) continue;
                if (Array.isArray(o.statusHistory) && o.statusHistory.length > 3) {
                    o.statusHistory = o.statusHistory.slice(-3);
                }
                // 物流轨迹只留最近 2 条（展示够用，体积大头）
                if (o.logistics && Array.isArray(o.logistics.updates) && o.logistics.updates.length > 2) {
                    o.logistics.updates = o.logistics.updates.slice(-2);
                }
                if (o._shipResult) delete o._shipResult;
                if (o.materialsUsed && o.materialsUsed._statsPackagingFee != null) {
                    delete o.materialsUsed._statsPackagingFee;
                }
                // 终态订单：退货/售后已结，删除明细大字段
                if (terminal.has(o.status)) {
                    if (o.items) o.items = [];
                    if (o.buyerAddress && typeof o.buyerAddress === 'object') {
                        // 只保留城市 id（运费/统计），删地址明细
                        o.buyerAddress = o.buyerAddress.cityId ? { cityId: o.buyerAddress.cityId } : {};
                    }
                    if (o.fees && typeof o.fees === 'object') {
                        const total = o.fees.total;
                        o.fees = { total: (typeof total === 'number' ? total : 0) };
                    }
                    if (o.materialsUsed) o.materialsUsed = { _level: o.materialsUsed._level };
                }
                // 已发货订单同样瘦身：运单已建立，明细只用于展示，可安全剥离
                if (o.status === 'shipped') {
                    if (o.items && o.items.length > 1) o.items = o.items.slice(0, 1);
                    if (o.buyerAddress && typeof o.buyerAddress === 'object') {
                        o.buyerAddress = o.buyerAddress.cityId ? { cityId: o.buyerAddress.cityId } : {};
                    }
                }
            }
            s.orders = list;
            try {
                if (typeof OrderPerf !== 'undefined' && OrderPerf.markDirty) OrderPerf.markDirty();
            } catch (_) {}
        }

        // 4. 客服大数据裁剪
        if (s.customerService) {
            const cs = s.customerService;
            const cap = (arr, n) => { if (Array.isArray(arr) && arr.length > n) return arr.slice(-n); return arr; };
            cs.consultations = cap(cs.consultations, aggressive ? 80 : 200);
            cs.returns = cap(cs.returns, aggressive ? 80 : 200);
            cs.disputes = cap(cs.disputes, aggressive ? 40 : 100);
            cs.appeals = cap(cs.appeals, aggressive ? 40 : 100);
            cs.logs = cap(cs.logs, aggressive ? 100 : 300);
            cs.notifications = cap(cs.notifications, aggressive ? 30 : 80);
        }

        // 5. warehouse 日志/单据
        if (s.warehouse) {
            if (Array.isArray(s.warehouse.logs) && s.warehouse.logs.length > logLimit) {
                s.warehouse.logs = s.warehouse.logs.slice(-logLimit);
            }
            if (Array.isArray(s.warehouse.packagingLogs) && s.warehouse.packagingLogs.length > logLimit) {
                s.warehouse.packagingLogs = s.warehouse.packagingLogs.slice(-logLimit);
            }
        }
        // 独立仓储模块
        try {
            if (typeof warehouseState !== 'undefined' && warehouseState && warehouseState.state) {
                const wh = warehouseState.state;
                const capArr = (key, n) => {
                    if (Array.isArray(wh[key]) && wh[key].length > n) wh[key] = wh[key].slice(-n);
                };
                capArr('logs', logLimit);
                capArr('packagingLogs', logLimit);
                capArr('inboundOrders', aggressive ? 80 : 200);
                capArr('outboundOrders', aggressive ? 80 : 200);
                capArr('stocktakeOrders', aggressive ? 20 : 50);
            }
        } catch (e) { /* ignore */ }

        // 6. 快递运单/轨迹：已签收过久的删掉
        try {
            if (typeof ExpressState !== 'undefined' && ExpressState && ExpressState.waybills) {
                const keepDays = aggressive ? 5 : 14;
                const wbs = ExpressState.waybills;
                const tracks = ExpressState.tracks || {};
                const ids = Object.keys(wbs);
                let removed = 0;
                const TERMINAL_ORDER_STATUS = new Set(['completed', 'cancelled', 'returned', 'refunded']);
                // ===== 性能：运单→订单只建一次 Map，避免每个运单 O(n) find（几千运单×几千订单 = 千万次比较）=====
                const ordersArr = this.state.orders || [];
                const orderByWaybill = new Map();
                for (let oi = 0; oi < ordersArr.length; oi++) {
                    const o = ordersArr[oi];
                    if (o && o.waybillId && !orderByWaybill.has(o.waybillId)) {
                        orderByWaybill.set(o.waybillId, o);
                    }
                }
                for (let i = 0; i < ids.length; i++) {
                    const id = ids[i];
                    const w = wbs[id];
                    if (!w) continue;
                    // 终态：delivered/returned/cancelled、stage>=5(已签收)，以及 lost/exception(丢失/异常，stage<0)
                    const done = w.status === 'delivered' || w.status === 'returned' || w.status === 'cancelled' ||
                        (typeof w.statusStage === 'number' && w.statusStage >= 5) ||
                        w.status === 'lost' || w.status === 'exception';
                    if (!done) continue;
                    const t = w.deliveredAt || w.updatedAt || w.createdAt;
                    const day = t && typeof t.day === 'number' ? t.day : 0;
                    if (day > 0 && (now.day - day) > keepDays) {
                        // ===== 修复：关联订单仍 shipped 时保留运单（订单完成后走终态，避免拆掉在途单的运单）=====
                        const linked = orderByWaybill.get(id);
                        if (linked && !TERMINAL_ORDER_STATUS.has(linked.status)) continue;
                        delete wbs[id];
                        delete tracks[id];
                        removed++;
                    }
                }
                // 硬顶：运单超过 2000 时再砍最老已完成（必须确认关联订单已终态，否则拆掉在途订单的运单→订单卡死）
                const remain = Object.keys(wbs);
                if (remain.length > (aggressive ? 800 : 2000)) {
                    const sorted = remain.map(id => wbs[id]).filter(Boolean)
                        .sort((a, b) => {
                            const da = (a.createdAt && a.createdAt.day) || 0;
                            const db = (b.createdAt && b.createdAt.day) || 0;
                            return da - db;
                        });
                    const over = remain.length - (aggressive ? 800 : 2000);
                    for (let i = 0; i < over && i < sorted.length; i++) {
                        const st = sorted[i].status;
                        const sg = sorted[i].statusStage;
                        // 终态：delivered/returned/cancelled/signed(stage>=5)/lost/exception(stage<0)
                        if (st === 'delivered' || st === 'returned' || st === 'cancelled' || st === 'lost' || st === 'exception' ||
                            (typeof sg === 'number' && sg >= 5)) {
                            // ===== 修复：仅当关联订单已终态（或已不存在）才删；订单仍 shipped 时保留运单，等其完成 =====
                            const linked = orderByWaybill.get(sorted[i].id);
                            if (linked && !TERMINAL_ORDER_STATUS.has(linked.status)) continue;
                            const id = sorted[i].id;
                            delete wbs[id];
                            delete tracks[id];
                        }
                    }
                }
                if (removed > 0) {
                    console.log('[prune] 清理过期运单', removed);
                }
            }
        } catch (e) { /* ignore */ }

        // 7. 直播历史 / 事件日志
        if (s.livestream && Array.isArray(s.livestream.history) && s.livestream.history.length > 30) {
            s.livestream.history = s.livestream.history.slice(0, 30);
        }
        if (s.events && Array.isArray(s.events.eventLog) && s.events.eventLog.length > 100) {
            s.events.eventLog = s.events.eventLog.slice(-100);
        }

        // 7.5 法务案件：长期运行会无限增长，限制已结案数量
        try {
            if (s.legal && Array.isArray(s.legal.cases)) {
                const maxCases = aggressive ? 40 : 120;
                if (s.legal.cases.length > maxCases) {
                    const open = [];
                    const closed = [];
                    for (let i = 0; i < s.legal.cases.length; i++) {
                        const c = s.legal.cases[i];
                        if (!c) continue;
                        const st = String(c.status || '');
                        const done = /closed|done|settled|dismissed|buyer_win|seller_win|withdrawn|archived/i.test(st);
                        (done ? closed : open).push(c);
                    }
                    if (closed.length > maxCases) closed.length = maxCases;
                    // 进行中优先保留；已结案再补齐额度
                    const room = Math.max(0, maxCases - open.length);
                    s.legal.cases = open.concat(closed.slice(0, room));
                }
            }
        } catch (_) {}

        // 7.6 海外贸易发货记录
        try {
            if (s.overseas && Array.isArray(s.overseas.shipments) && s.overseas.shipments.length > 80) {
                s.overseas.shipments = s.overseas.shipments.slice(-80);
            }
        } catch (_) {}

        // 7.7 会员：仅裁剪长期沉睡低消费名单，累计总人数不回写（避免卡在 800 不再涨）
        try {
            if (s.members && Array.isArray(s.members.list)) {
                const maxMembers = aggressive ? 4000 : 8000;
                const list = s.members.list;
                if (list.length > maxMembers) {
                    const dayNow = now.day || 1;
                    const scored = list.map((m, idx) => {
                        const last = (m && (m.lastOrderDay || m.lastActiveDay || m.joinDay)) || 0;
                        const spent = (m && (m.spent || m.totalSpent)) || 0;
                        const join = (m && m.joinDay) || 0;
                        const recent = (dayNow - last) <= 45 ? 200000 : 0;
                        const newborn = (dayNow - join) <= 14 ? 300000 : 0;
                        return { m, idx, score: recent + newborn + spent + (m && m.level ? m.level * 10 : 0) };
                    });
                    scored.sort((a, b) => b.score - a.score || a.idx - b.idx);
                    s.members.list = scored.slice(0, maxMembers).map(x => x.m);
                    if (typeof s.members.total !== 'number' || s.members.total < list.length) {
                        s.members.total = Math.max(Number(s.members.total) || 0, list.length);
                    }
                }
                if (Array.isArray(s.members.pointsLogs) && s.members.pointsLogs.length > (aggressive ? 120 : 300)) {
                    s.members.pointsLogs = s.members.pointsLogs.slice(0, aggressive ? 120 : 300);
                }
                if (Array.isArray(s.members.growthLogs) && s.members.growthLogs.length > (aggressive ? 120 : 300)) {
                    s.members.growthLogs = s.members.growthLogs.slice(0, aggressive ? 120 : 300);
                }
            }
        } catch (_) {}

        // 7.8 仓储空批次：出库后残留空 batch 会在 FIFO/修复里反复 .find
        try {
            const pruneBatches = (wh) => {
                if (!wh || !Array.isArray(wh.batches) || !Array.isArray(wh.inventory)) return;
                if (wh.batches.length < 200) return;
                const usedIds = new Set();
                for (let i = 0; i < wh.inventory.length; i++) {
                    const inv = wh.inventory[i];
                    if (inv && inv.batchId && (inv.quantity > 0)) usedIds.add(inv.batchId);
                }
                const keep = [];
                for (let i = 0; i < wh.batches.length; i++) {
                    const b = wh.batches[i];
                    if (!b) continue;
                    if (usedIds.has(b.id)) keep.push(b);
                    else if ((b.remainingQty > 0 || b.quantity > 0) && b.status === 'normal') keep.push(b);
                }
                if (keep.length < wh.batches.length) wh.batches = keep;
            };
            if (s.warehouse) pruneBatches(s.warehouse);
            if (typeof warehouseState !== 'undefined' && warehouseState && warehouseState.state) {
                pruneBatches(warehouseState.state);
            }
        } catch (_) {}

        // 7. 多店铺系统：调拨历史裁剪（防存档膨胀，P3 前车之鉴）
        try {
            const ts = Array.isArray(s.transfers) ? s.transfers : null;
            if (ts) {
                const transferCap = aggressive ? 60 : 150;
                if (ts.length > transferCap) {
                    // 保留最近 transferCap 条（优先保留 in_transit）
                    const inTransit = ts.filter(t => t && t.status === 'in_transit');
                    const rest = ts.filter(t => !t || t.status !== 'in_transit').slice(-Math.max(10, transferCap - inTransit.length));
                    s.transfers = inTransit.concat(rest);
                }
            }
            // 门店 stats 日史 cap
            (Array.isArray(s.shops) ? s.shops : []).forEach(sh => {
                if (sh && Array.isArray(sh.stats && sh.stats.dailyHistory) && sh.stats.dailyHistory.length > 30) {
                    sh.stats.dailyHistory = sh.stats.dailyHistory.slice(-30);
                }
            });
        } catch (_) {}

        const ordersAfter = Array.isArray(s.orders) ? s.orders.length : 0;
        if (ordersBefore !== ordersAfter) {
            console.log('[prune] 订单', ordersBefore, '→', ordersAfter, aggressive ? '(激进)' : '(常规)');
        }
        return { ordersBefore, ordersAfter };
    }

    /** 保存存档（委托 saveManager，主 slot），返回 Promise */
    save() {
        if (typeof saveManager !== 'undefined') return saveManager._archiveSave('main');
        return Promise.resolve({ success: false, error: 'saveManager 未加载' });
    }

    /** 加载存档（委托 saveManager，9层fallback），返回 Promise */
    load() {
        if (typeof saveManager !== 'undefined') return saveManager._archiveLoad();
        return Promise.resolve(null);
    }

    reset() {
        // 先停直播定时器，避免 reset 后仍往旧状态灌礼物/销量
        try {
            if (typeof liveEngine !== 'undefined' && liveEngine && typeof liveEngine.endLive === 'function') {
                const ls = (typeof liveState !== 'undefined' && liveState.getState)
                    ? liveState.getState() : null;
                if (ls && ls.isLive) liveEngine.endLive();
            }
        } catch (e) {}
        this.state = JSON.parse(JSON.stringify(INITIAL_GAME_STATE));
        // 强制回到第1天 / 开局日历（防止模板污染或旧 day 残留）
        try {
            const weekday = (typeof GAME_START_DATE !== 'undefined' && GAME_START_DATE.weekday) ? GAME_START_DATE.weekday : 6;
            const gt = {
                day: 1,
                totalDay: 1,
                hour: 8,
                speed: 1,
                isPaused: false,
                dayOfWeek: weekday,
                weekday: weekday
            };
            this.state.gameTime = (typeof GAME_syncRealDateToGameTime === 'function')
                ? GAME_syncRealDateToGameTime(gt)
                : gt;
        } catch (e) {
            this.state.gameTime = { day: 1, totalDay: 1, hour: 8, speed: 1, isPaused: false };
        }
        this._loadedFromSource = null;
        this._pendingWarehouseData = null;
        try {
            if (typeof OrderPerf !== 'undefined' && OrderPerf.markDirty) OrderPerf.markDirty();
        } catch (_) {}
        this._initDefaultCoupons();
        try {
            if (typeof bankState !== 'undefined' && bankState.reset) {
                bankState.reset(this.state);
            }
            if (typeof csState !== 'undefined' && csState.reset) {
                csState.reset();
            }
        } catch (e) {}
        try {
            if (typeof warehouseState !== 'undefined' && warehouseState.state) {
                warehouseState.state = JSON.parse(JSON.stringify(WarehouseData.getDefaultState()));
                if (typeof warehouseState.ensureDefaults === 'function') {
                    warehouseState.ensureDefaults();
                }
                this.state.warehouse = {
                    level: warehouseState.state.level,
                    packagingMaterials: warehouseState.state.packagingMaterials,
                    packagingLogs: [],
                    logs: [],
                    lowStockThreshold: 20
                };
                this.state.inventory = [];
            }
        } catch (e) {}
        try {
            if (typeof ExpressState !== 'undefined' && typeof ExpressState.init === 'function') {
                ExpressState.init();
            }
        } catch (e) {}
        try {
            if (typeof liveState !== 'undefined') {
                if (typeof liveState.reset === 'function') {
                    liveState.reset();
                } else if (typeof liveState.init === 'function') {
                    liveState.init(this);
                }
            }
        } catch (e) {}
        // 2.3：纳税 / 法务一并清空，避免「重新开始」残留旧账
        try {
            if (typeof TaxState !== 'undefined' && TaxState.reset) {
                TaxState.reset(this);
            } else {
                this.state.tax = null;
            }
        } catch (e) {}
        try {
            if (typeof LegalState !== 'undefined' && LegalState.reset) {
                LegalState.reset(this);
            } else {
                this.state.legal = null;
            }
        } catch (e) {}
        this.listeners = [];
        this.notify();
    }


    // 资金操作：新增支持可控欠款机制（SHOP_CONFIG.maxDebt 为允许的最大欠款）
    // 安全：① 拒绝来自控制台/eval/注入脚本的调用；② 结果钳制到 [欠款下限, 9e12]，杜绝 NaN/Infinity/绕回
    addFunds(amount, reason = '') {
        if (typeof amount !== 'number' || Number.isNaN(amount) || !isFinite(amount) || !amount || amount === 0) return false;
        if (!GameEconomyGuard.isTrustedWriter()) {
            GameEconomyGuard.stats.blocked++;
            GameEconomyGuard.stats.last = 'addFunds:untrusted-caller';
            try {
                console.warn('[经济防护] 已拦截非游戏代码的资金增加调用 addFunds(' +
                    amount + ', "' + String(reason) + '")。正常玩法不受影响。');
            } catch (_) {}
            return false;
        }
        const before = GameEconomyGuard.sanitize(this.state.shop.funds, 0);
        const after = GameEconomyGuard.sanitize(before + amount, before);
        const applied = after - before;             // 可能已被硬上限截断
        if (!applied) return false;
        this.state.shop.funds = after;
        const recordType = applied > 0 ? 'income' : 'expense';
        this.addFinanceRecord({
            type: recordType,
            amount: Math.abs(applied),
            reason: reason,
            day: this.state.gameTime.day,
            hour: this.state.gameTime.hour
        });
        if (recordType === 'income' && /订单|收入|销售|order|sale/i.test(reason)) {
            if (typeof TaxEngine !== 'undefined' && TaxEngine.accumulateMonthlyRevenue) {
                TaxEngine.accumulateMonthlyRevenue(this, Math.abs(applied));
            }
        }
        this.notify();
        return true;
    }

    /** 广告公司配置（无全局常量时用默认） */
    getAdAgencyConfig() {
        if (typeof AD_AGENCY !== 'undefined' && AD_AGENCY) return AD_AGENCY;
        return {
            id: 'xingyun',
            name: '星云广告公司',
            mediaCommissionRate: 0.02,
            endorsementCommissionRate: 0.10,
            minFee: 0.5
        };
    }

    /**
     * 营销推广成交抽成比例：开启中的投放取最高抽成；仅推广员/自动推广用默认 5%。
     * 多渠道不叠加，最高 15%。
     */
    getMarketingSalesCommissionRate(order) {
        let rate = 0;
        try {
            const camps = (this.state.marketing && this.state.marketing.activeCampaigns) || [];
            camps.forEach(c => {
                if (!c || c.status !== 'active') return;
                const mt = (typeof MARKETING_TYPES !== 'undefined') ? MARKETING_TYPES[c.type] : null;
                const r = mt && mt.commission != null ? Number(mt.commission) : 0;
                if (r > rate) rate = r;
            });
            const ends = (this.state.marketing && this.state.marketing.celebrityEndorsements) || [];
            if (ends.some(e => e && e.status === 'active') && rate < 0.06) rate = 0.06;
        } catch (_) {}
        if (!(rate > 0)) {
            const src = order && order.marketingCampaignSource;
            if (src === 'employee' || src === 'shop_auto' || (order && order.fromMarketing)) {
                const cfg = this.getAdAgencyConfig();
                rate = (cfg && cfg.employeeSalesCommissionRate != null)
                    ? Number(cfg.employeeSalesCommissionRate) : 0.05;
            }
        }
        if (!(rate > 0)) return 0;
        return Math.min(0.15, Math.max(0, rate));
    }

    /**
     * 营销扣费：媒体费 + 广告公司服务费
     * @param {number} mediaCost 媒体投放/推广本金
     * @param {string} reason 媒体费流水说明
     * @param {{rate?:number, skipAgency?:boolean}} [options]
     * @returns {{ok:boolean, mediaCost:number, agencyFee:number, total:number, rate:number}}
     */
    chargeMarketingSpend(mediaCost, reason, options = {}) {
        const media = Math.round((Number(mediaCost) || 0) * 100) / 100;
        if (media <= 0) return { ok: false, mediaCost: 0, agencyFee: 0, total: 0, rate: 0 };
        const cfg = this.getAdAgencyConfig();
        const rate = options.skipAgency
            ? 0
            : (options.rate != null ? Number(options.rate) : (cfg.mediaCommissionRate || 0.02));
        let agencyFee = Math.round(media * rate * 100) / 100;
        if (agencyFee > 0 && agencyFee < (cfg.minFee || 0)) agencyFee = cfg.minFee;
        const total = Math.round((media + agencyFee) * 100) / 100;
        const after = (this.state.shop.funds || 0) - total;
        if (after < SHOP_CONFIG.maxDebt) {
            return { ok: false, mediaCost: media, agencyFee, total, rate };
        }
        if (!this.spendFunds(media, reason)) {
            return { ok: false, mediaCost: media, agencyFee, total, rate };
        }
        if (agencyFee > 0) {
            const agencyName = cfg.name || '广告公司';
            this.spendFunds(
                agencyFee,
                `广告公司服务费${Math.round(rate * 100)}% · ${agencyName}`
            );
            if (!this.state.marketing) this.state.marketing = {};
            this.state.marketing.agencyFeesPaid =
                Math.round(((Number(this.state.marketing.agencyFeesPaid) || 0) + agencyFee) * 100) / 100;
        }
        return { ok: true, mediaCost: media, agencyFee, total, rate };
    }

    // 扣钱：支持可控欠款
    // 返回 true=扣款成功；false=超过欠款上限/无效支出被拒绝
    // 无论是否有足够资金，只要扣除后 funds >= SHOP_CONFIG.maxDebt 就允许（可欠钱但不能超额度）
    spendFunds(amount, reason = '') {
        if (typeof amount !== 'number' || Number.isNaN(amount) || !isFinite(amount) || !amount || amount <= 0) return false;
        if (amount > GameEconomyGuard.MAX_FUNDS_ABS) return false;   // 单笔支出离谱值直接拒绝
        const funds = GameEconomyGuard.sanitize(this.state.shop.funds, 0);
        const afterFunds = funds - amount;
        if (afterFunds < SHOP_CONFIG.maxDebt) {
            // 超过欠款上限，拒绝扣款
            return false;
        }
        this.state.shop.funds = afterFunds;
        this.addFinanceRecord({
            type: 'expense',
            amount: amount,
            reason: reason + (afterFunds < 0 ? `（欠款 ${formatMoney(-afterFunds)}）` : ''),
            day: this.state.gameTime.day,
            hour: this.state.gameTime.hour
        });
        let category = null;
        // 分类顺序：仓储费/人工费不能算进「包装物料」；物料采购优先于泛化「采购」
        if (/仓储费|仓库租金|warehouse.?rent/i.test(reason)) category = 'warehouse_rent';
        else if (/平台抽成|平台佣金|平台手续费|platform.?fee|platform.?commission/i.test(reason)) category = 'platform';
        else if (/打包人工|人工费/i.test(reason)) category = 'salary';
        else if (/包装材料|包材套餐|包材采购|紧急采购.*包装|包装.*采购|包装.*临时|耗材/i.test(reason)
            || (/包装|包材|packaging/i.test(reason) && /采购|购买|套餐/i.test(reason))) {
            category = 'packaging';
        }
        else if (/采购|purchase|进货|货款/i.test(reason)) category = 'purchase';
        else if (/快递|运费|快递费|express|shipping/i.test(reason)) category = 'express';
        else if (/工资|薪资|salary|payroll|工资发放/i.test(reason)) category = 'salary';
        else if (/仓库|仓储|租金|warehouse|仓库升级/i.test(reason)) category = 'warehouse_rent';
        else if (/法务|律师|案件|诉讼|受理费|legal|lawyer/i.test(reason)) category = 'legal_fee';
        if (category) {
            if (typeof TaxEngine !== 'undefined' && TaxEngine.accumulateDeductibleCost) {
                TaxEngine.accumulateDeductibleCost(this, category, amount);
            }
        }
        this.notify();
        return true;
    }

    // 返回当前欠款信息（用于UI展示）
    getDebtInfo() {
        const f = this.state?.shop?.funds ?? 0;
        return {
            funds: f,
            inDebt: f < 0,                       // 是否在欠款中
            debtAmount: Math.max(0, -f),         // 欠款金额（正数）
            maxDebt: -SHOP_CONFIG.maxDebt,       // 最大允许欠的额度
            ratio: f < 0 ? Math.min(1, (-f) / (-SHOP_CONFIG.maxDebt)) : 0, // 已占欠款比例 0~1
            bankruptLine: -SHOP_CONFIG.bankruptLine
        };
    }

    // 兑换码
    redeemCode(code) {
        const upperCode = (code || '').trim().toUpperCase();
        if (!upperCode) {
            return { success: false, message: '请输入兑换码' };
        }
        // 中文码不受 toUpperCase 影响；同时兼容原样键名
        const raw = (code || '').trim();
        const codeInfo = REDEEM_CODES[upperCode] || REDEEM_CODES[raw];
        if (!codeInfo) {
            return { success: false, message: '兑换码无效' };
        }
        const recordKey = REDEEM_CODES[upperCode] ? upperCode : raw;

        const usedCount = this.state.redeemedCodes.filter(r => r.code === recordKey || r.code === upperCode || r.code === raw).length;
        if (usedCount >= (codeInfo.maxUses || 1)) {
            return { success: false, message: '该兑换码已使用过' };
        }

        if (codeInfo.type === 'money') {
            this.addFunds(codeInfo.amount, `兑换码: ${codeInfo.name}`);
            // 兑换码注入资金：标记本存档，排行榜跳过上报（避免 100 亿彩蛋码污染成绩）
            try {
                if (!this.state.settings) this.state.settings = {};
                this.state.settings.moneyInjected = true;
            } catch (_) {}
        } else if (codeInfo.type === 'actionQuota') {
            const n = Math.max(0, Math.floor(Number(codeInfo.amount) || 0));
            if (typeof this.addActionQuota === 'function') {
                this.addActionQuota(n);
            } else {
                this.ensureActionQuotas();
                this.state.settings.skipDayQuota += n;
            }
        }

        this.state.redeemedCodes.push({
            code: recordKey,
            name: codeInfo.name,
            type: codeInfo.type,
            amount: codeInfo.amount,
            redeemTime: { ...this.state.gameTime }
        });

        this.notify();
        return { success: true, codeInfo, message: `兑换成功！获得 ${codeInfo.description}` };
    }

    hasRedeemedCode(code) {
        const upperCode = (code || '').trim().toUpperCase();
        return this.state.redeemedCodes.some(r => r.code === upperCode);
    }

    // 财务分类映射（根据reason关键词分类）
    _classifyFinanceReason(reason, type) {
        if (type === 'income') {
            if (!reason) return { category: 'sales', label: '销售收入' };
            const r = reason;
            if (/销售|订单|商品|买家|成交/.test(r)) return { category: 'sales', label: '销售收入' };
            if (/兑换|红包|补偿|奖励/.test(r)) return { category: 'other_income', label: '其他收入' };
            if (/退款|赔偿|赔付/.test(r)) return { category: 'refund', label: '退款收入' };
            if (/利息|存款|银行/.test(r)) return { category: 'interest', label: '利息收入' };
            return { category: 'sales', label: '销售收入' };
        } else {
            if (!reason) return { category: 'other', label: '其他支出' };
            const r = reason;
            // 仓储费单独归类（已买包材不应再因仓储费刷爆「包装物料」）
            if (/仓储费|仓库租金/.test(r)) return { category: 'upgrade', label: '升级扩建' };
            if (/平台抽成|平台佣金|平台手续费/.test(r)) return { category: 'platform', label: '平台抽成' };
            if (/打包人工|人工费/.test(r)) return { category: 'salary', label: '员工工资' };
            // 仅「买包材/紧急补货」记包装物料；耗用库存本身不再扣现金
            if (/包装材料|包材套餐|包材采购|紧急采购.*包装|包装.*采购|包装.*临时|纸箱|气泡膜/.test(r)
                || (/包装|包材/.test(r) && /采购|购买|套餐/.test(r))) {
                return { category: 'packaging', label: '包装物料' };
            }
            if (/采购员|自动补货|一键采购|仓储采购入库|采购|进货|库存|补货/.test(r)) return { category: 'purchase', label: '商品采购' };
            if (/纳税|税款|缴税/.test(r)) return { category: 'other', label: '纳税支出' };
            if (/快递|运费|物流|邮费/.test(r)) return { category: 'express', label: '快递费用' };
            if (/人工|工资|薪资|员工|雇佣|招聘/.test(r)) return { category: 'salary', label: '员工工资' };
            if (/推广|营销|广告|直播|网红|代言|流量/.test(r)) return { category: 'marketing', label: '营销推广' };
            if (/信誉|处罚|罚款|赔付|赔偿/.test(r)) return { category: 'penalty', label: '处罚赔付' };
            if (/升级|扩建|装修|仓库|货架|设备/.test(r)) return { category: 'upgrade', label: '升级扩建' };
            if (/银行|利息|贷款|手续费/.test(r)) return { category: 'finance_cost', label: '财务成本' };
            return { category: 'other', label: '其他支出' };
        }
    }

    // 财务记录
    addFinanceRecord(record) {
        record.id = generateId('fin');
        record.timestamp = Date.now();
        // 防御：金额非有限数（NaN/Infinity）时拒绝写入，避免污染财务汇总 / dailyStats / 存档
        if (!(typeof record.amount === 'number' && Number.isFinite(record.amount))) {
            if (this._lastFinGuard && Date.now() - this._lastFinGuard < 2000) return;
            this._lastFinGuard = Date.now();
            console.warn('[addFinanceRecord] 拒绝写入非有限金额', record.amount, record.reason || '');
            return;
        }
        // 自动分类
        const cls = this._classifyFinanceReason(record.reason, record.type);
        record.category = cls.category;
        record.categoryLabel = cls.label;
        this.state.finance.records.push(record);
        // 增量自裁：防两次 _pruneOldData 之间财务流水无界增长拖大存档/渲染
        // （每笔约 150B，600 笔 ≈ 90KB；_pruneOldData 仍会按 100/250 进一步收紧）
        if (this.state.finance.records.length > 600) {
            this.state.finance.records = this.state.finance.records.slice(-600);
        }
        
        // 累加到当天的 dailyStats（带运行时索引缓存：dailyStats 引用变化自动重建）
        const day = record.day ?? (this.state.gameTime?.day || 1);
        const ds = this.state.finance.dailyStats;
        if (this._dailyStatsIdxList !== ds) {
            const idx = new Map();
            for (let i = 0; i < ds.length; i++) {
                if (ds[i] && typeof ds[i].day === 'number') idx.set(ds[i].day, ds[i]);
            }
            this._dailyStatsIdx = idx;
            this._dailyStatsIdxList = ds;
        }
        let daily = this._dailyStatsIdx.get(day);
        if (!daily) {
            daily = {
                day,
                orders: 0,
                sales: 0,
                profit: 0,
                cost: 0,
                // 收入分类
                income_sales: 0,
                income_other: 0,
                // 支出分类
                expense_purchase: 0,
                expense_express: 0,
                expense_packaging: 0,
                expense_platform: 0,
                expense_salary: 0,
                expense_marketing: 0,
                expense_penalty: 0,
                expense_upgrade: 0,
                expense_other: 0,
            };
            this.state.finance.dailyStats.push(daily);
            // 增量维护索引
            if (this._dailyStatsIdx && this._dailyStatsIdxList === this.state.finance.dailyStats) {
                this._dailyStatsIdx.set(day, daily);
            }
        }
        if (daily.expense_platform == null) daily.expense_platform = 0;
        if (record.type === 'income') {
            daily.sales += record.amount;
            daily.profit += record.amount;
            if (record.category === 'sales') daily.income_sales += record.amount;
            else daily.income_other += record.amount;
        } else {
            daily.cost += record.amount;
            daily.profit -= record.amount;
            const key = 'expense_' + (record.category || 'other');
            if (daily[key] !== undefined) daily[key] += record.amount;
            else daily.expense_other += record.amount;
        }
    }

    /** 平台抽成比例（默认 1%） */
    getPlatformCommissionRate() {
        const r = (typeof SHOP_CONFIG !== 'undefined' && SHOP_CONFIG.platformCommissionRate != null)
            ? Number(SHOP_CONFIG.platformCommissionRate) : 0.01;
        return (isFinite(r) && r >= 0) ? r : 0.01;
    }

    /** 计算订单平台抽成金额（按实收） */
    calcPlatformCommission(amount) {
        const base = Math.max(0, Number(amount) || 0);
        const fee = Math.round(base * this.getPlatformCommissionRate() * 100) / 100;
        return fee;
    }

    /** 累计已交给平台的抽成（优先累计字段，流水可校正） */
    getPlatformCommissionPaid() {
        const fin = this.state.finance || {};
        let paid = Number(fin.platformCommissionPaid) || 0;
        if (!(paid > 0) && Array.isArray(fin.records)) {
            paid = fin.records
                .filter(r => r && r.type === 'expense' && (r.category === 'platform' || /平台抽成/.test(String(r.reason || ''))))
                .reduce((s, r) => s + (Number(r.amount) || 0), 0);
        }
        return Math.round(paid * 100) / 100;
    }

    /**
     * 订单售出结算：入账实收 + 扣平台 1% 抽成（防重复结算）
     */
    settleOrderSale(order) {
        if (!order || typeof order !== 'object') {
            return { success: false, message: '无效订单' };
        }
        if (order._saleSettled) {
            return {
                success: true,
                alreadySettled: true,
                income: Number(order.totalAmount) || 0,
                platformFee: Number(order.platformFee) || 0
            };
        }
        const income = Math.max(0, Math.round((Number(order.totalAmount) || 0) * 100) / 100);
        const rate = this.getPlatformCommissionRate();
        const platformFee = this.calcPlatformCommission(income);
        const walletPaid = Math.min(income, Math.max(0, Number(order.walletPaid) || 0));
        const cashIncome = Math.round((income - walletPaid) * 100) / 100;

        if (cashIncome > 0) {
            this.addFunds(cashIncome, walletPaid > 0 ? '订单收入（部分储值）' : '订单收入');
        }
        if (platformFee > 0) {
            const reason = `平台抽成 ${(rate * 100).toFixed(0)}%（订单${String(order.id || '').slice(-8)}）`;
            const paid = this.spendFunds(platformFee, reason);
            if (!paid) {
                // 抽成必须扣：收入刚入账后仍触顶则强制记账扣款
                this.state.shop.funds = Math.round((this.state.shop.funds - platformFee) * 100) / 100;
                this.addFinanceRecord({
                    type: 'expense',
                    amount: platformFee,
                    reason,
                    day: this.state.gameTime.day,
                    hour: this.state.gameTime.hour
                });
            }
            if (!this.state.finance) this.state.finance = { records: [], dailyStats: [], platformCommissionPaid: 0 };
            this.state.finance.platformCommissionPaid =
                Math.round(((Number(this.state.finance.platformCommissionPaid) || 0) + platformFee) * 100) / 100;
        }

        order.platformFee = platformFee;
        order.platformCommissionRate = rate;
        order._saleSettled = true;

        // 营销推广成交抽成：按开启渠道的百分比从本单实收扣（多渠道取最高，上限 15%）
        try {
            const isMarketingOrder = !!(order.fromMarketing
                || order.marketingCampaignSource === 'activeCampaign'
                || order.marketingCampaignSource === 'employee'
                || order.marketingCampaignSource === 'shop_auto');
            if (isMarketingOrder && income > 0) {
                const mkRate = (typeof this.getMarketingSalesCommissionRate === 'function')
                    ? this.getMarketingSalesCommissionRate(order)
                    : 0.05;
                const mkFee = Math.round(income * mkRate * 100) / 100;
                if (mkFee > 0 && mkRate > 0) {
                    const pct = (mkRate * 100).toFixed(mkRate * 100 % 1 ? 1 : 0);
                    this.spendFunds(mkFee, `营销推广抽成 ${pct}%（订单${String(order.id || '').slice(-8)}）`);
                    order.marketingTakeRate = mkRate;
                    order.marketingTakeFee = mkFee;
                    order.platformEventCommission = mkFee;
                }
            }
        } catch (_) {}

        // 营销利润提成：仅营销/推广订单，利润×1%/2%/3% 阶梯，发给在职推广员与店长
        try {
            const costAmt = Math.max(0, Number(order.costAmount) || 0);
            const peFee = Number(order.platformEventCommission) || 0;
            const profit = Math.max(0, income - platformFee - peFee - costAmt);
            if (typeof this.state.shop.totalSalesAmount !== 'number') {
                this.state.shop.totalSalesAmount = 0;
            }
            this.state.shop.totalSalesAmount = Math.round((this.state.shop.totalSalesAmount + income) * 100) / 100;

            const isMarketingOrder = !!(order.fromMarketing
                || order.marketingCampaignSource === 'activeCampaign'
                || order.marketingCampaignSource === 'employee'
                || order.marketingCampaignSource === 'shop_auto');
            if (isMarketingOrder && profit > 0) {
                const customRate = (this.state.shop && typeof this.state.shop.customCommissionRate === 'number')
                    ? this.state.shop.customCommissionRate
                    : null;
                const tier = (typeof getSalesCommissionRate === 'function')
                    ? getSalesCommissionRate(this.state.shop.totalSalesAmount, customRate)
                    : { rate: 0.01, label: '1%' };
                const commissionTotal = Math.round(profit * (tier.rate || 0.01) * 100) / 100;
                order.salesCommission = commissionTotal;
                order.salesCommissionRate = tier.rate;
                order.marketingCommission = commissionTotal;
                if (commissionTotal > 0) {
                    const actives = (this.state.employees || []).filter(e => {
                        if (!e || e.status !== 'active') return false;
                        if (e.type === 'marketer' || e.type === 'manager') return true;
                        const skills = (typeof EMPLOYEE_TYPES !== 'undefined' && EMPLOYEE_TYPES[e.type])
                            ? (EMPLOYEE_TYPES[e.type].skills || []) : [];
                        return skills.indexOf('marketing') >= 0 || skills.indexOf('promotion') >= 0;
                    });
                    if (actives.length > 0) {
                        const share = Math.round((commissionTotal / actives.length) * 100) / 100;
                        actives.forEach(emp => {
                            emp.pendingSalesCommission = Math.round(((emp.pendingSalesCommission || 0) + share) * 100) / 100;
                        });
                    }
                }
            }
        } catch (_) {}

        // ===== 员工经手订单提成：只发给打包/发货/推广过该单的人，按销售额×店铺设定比例，多人平分 =====
        try {
            const staffRate = (typeof getStaffOrderCommissionRate === 'function')
                ? getStaffOrderCommissionRate(this.state.shop)
                : 0.001;
            const credited = [];
            const seen = {};
            const pushEmp = (id) => {
                if (!id || seen[id]) return;
                const emp = (this.state.employees || []).find(e => e && (e.id === id || String(e.id) === String(id)) && e.status === 'active');
                if (!emp || emp.type === 'buyer') return;
                seen[emp.id] = true;
                credited.push(emp);
            };
            pushEmp(order.packedBy);
            pushEmp(order.shippedBy);
            pushEmp(order.marketingEmployeeId);
            pushEmp(order.csHandledBy);
            const staffTotal = Math.round(income * staffRate * 100) / 100;
            order.staffCommissionRate = staffRate;
            order.staffCommissionTotal = staffTotal;
            if (staffTotal > 0 && credited.length > 0) {
                const share = Math.round((staffTotal / credited.length) * 100) / 100;
                credited.forEach(emp => {
                    emp.pendingStaffCommission = Math.round(((emp.pendingStaffCommission || 0) + share) * 100) / 100;
                    emp.monthStaffOrders = (emp.monthStaffOrders || 0) + 1;
                });
            }
        } catch (_) {}

        this.notify();
        return { success: true, income, platformFee, rate };
    }

    /** 统计当日各营销来源订单数 */
    countTodayMarketingOrdersBySource() {
        const day = (this.state.gameTime && this.state.gameTime.day) || 1;
        const orders = this.state.orders || [];
        let campaign = 0;
        let employee = 0;
        let shopAuto = 0;
        for (let i = 0; i < orders.length; i++) {
            const o = orders[i];
            if (!o) continue;
            const d = (o.createTime && o.createTime.day) || 0;
            if (d !== day) continue;
            const src = o.marketingCampaignSource || '';
            if (src === 'activeCampaign') campaign++;
            else if (src === 'employee') employee++;
            else if (src === 'shop_auto') shopAuto++;
        }
        return { campaign, employee, shopAuto, day };
    }

    /** 推广员日单软顶：每天随机 50~400（可随机大量出单） */
    ensureMarketerDailyCap() {
        const day = (this.state.gameTime && this.state.gameTime.day) || 1;
        const shop = this.state.shop || (this.state.shop = {});
        if (shop._marketerCapDay === day && shop._marketerDailyCap > 0) {
            return shop._marketerDailyCap;
        }
        const gating = (typeof TRAFFIC_GATING !== 'undefined' && TRAFFIC_GATING) ? TRAFFIC_GATING : {};
        let min = Number(gating.marketerOrdersPerDayMin);
        let max = Number(gating.marketerOrdersPerDayMax);
        if (!(min > 0)) min = 50;
        if (!(max >= min)) max = 400;
        min = Math.floor(min);
        max = Math.floor(max);
        shop._marketerDailyCap = min + Math.floor(Math.random() * (max - min + 1));
        shop._marketerCapDay = day;
        return shop._marketerDailyCap;
    }

    /** 推广员今日还可再出多少单（订单无限制，仅保留函数供日志/兼容） */
    getMarketerOrderRemainQuota() {
        return 999999999;
    }
    
    // 获取当天或指定天的分类财务汇总
    getDayFinanceSummary(day) {
        const targetDay = day ?? (this.state.gameTime?.day || 1);
        let daily = this.state.finance.dailyStats.find(d => d.day === targetDay);
        if (!daily) {
            daily = {
                day: targetDay, orders: 0, sales: 0, profit: 0, cost: 0,
                income_sales: 0, income_other: 0,
                expense_purchase: 0, expense_express: 0, expense_packaging: 0,
                expense_platform: 0,
                expense_salary: 0, expense_marketing: 0, expense_penalty: 0,
                expense_upgrade: 0, expense_other: 0,
            };
        }
        if (daily.expense_platform == null) daily.expense_platform = 0;
        return daily;
    }

    // 仓库日志
    addWarehouseLog(type, data) {
        if (!this.state.warehouse.logs) this.state.warehouse.logs = [];
        const log = Object.assign({
            id: 'wl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            type,
            day: this.state.gameTime.day,
            hour: this.state.gameTime.hour,
            timestamp: Date.now()
        }, data || {});
        this.state.warehouse.logs.push(log);
        if (this.state.warehouse.logs.length > 1000) this.state.warehouse.logs = this.state.warehouse.logs.slice(-1000);
    }
    
    // 库存操作
    addInventory(item, options = {}) {
        const badPid = !item || item.productId == null || item.productId === ''
            || String(item.productId) === 'undefined'
            || String(item.productId) === 'null'
            || String(item.productId) === 'NaN';
        if (badPid) {
            console.warn('[addInventory] 拒绝无效 productId', item && item.productId, item && item.purchaseOrderId);
            return { success: false, message: '商品ID无效，无法入库' };
        }
        // 如果新仓储模块可用，使用新模块
        if (this.warehouse) {
            const unitCost = Number(item.costPrice);
            // 进货单到货：显式 prepaid，或「有 PO 且单价>0」视为已预付（到货不再二次扣款）
            // 禁止仅靠 return_xxx 之类 PO + 0 成本跳过扣款白嫖入库
            const explicitPrepaid = !!(options.prepaid || options.skipCharge);
            const prepaid = explicitPrepaid || (!!item.purchaseOrderId && unitCost > 0);
            if (!(unitCost > 0) && !options.allowZeroCost) {
                console.warn('[addInventory] 拒绝0成本入库', item && item.productId);
                return { success: false, message: '入库成本必须大于0' };
            }
            const result = this.warehouse.purchaseIn(
                item.productId,
                item.quantity,
                unitCost > 0 ? unitCost : 0,
                item.purchaseOrderId,
                item.qualityGrade || 'B',
                { buyerId: options.buyerId || null, prepaid, skipCharge: prepaid }
            );
            if (!result || !result.success) {
                const failMsg = (result && result.message) || '仓储入库失败';
                // 仅「已预付」才兜底：防止已扣货款的到货因仓容等原因丢货；未付款失败绝不写库存
                if (prepaid) {
                    console.warn(`[addInventory] purchaseIn失败(${failMsg})，已预付，兜底写入旧格式inventory。product=${item.productId}, qty=${item.quantity}`);
                    const existing = this.state.inventory.find(
                        i => i.productId === item.productId && i.supplierId === item.supplierId && i.qualityGrade === item.qualityGrade
                    );
                    if (existing) {
                        existing.quantity += item.quantity;
                    } else {
                        this.state.inventory.push({
                            id: generateId('inv'),
                            productId: item.productId,
                            supplierId: item.supplierId,
                            quantity: item.quantity,
                            costPrice: item.costPrice || 0,
                            qualityGrade: item.qualityGrade || 'B',
                            purchaseDay: this.state.gameTime?.day || 1,
                            purchaseOrderId: item.purchaseOrderId,
                            _fallback: true
                        });
                    }
                    if (!options.silent && typeof ui !== 'undefined' && ui.showToast) {
                        ui.showToast(`⚠️ ${failMsg}，已兜底保存库存`);
                    }
                } else {
                    console.warn(`[addInventory] 未付款入库失败，不写库存: ${failMsg}`);
                    if (!options.silent && typeof ui !== 'undefined' && ui.showToast) {
                        ui.showToast(`❌ ${failMsg}`);
                    }
                    return result || { success: false, message: failMsg };
                }
            }
            this.state.inventory = this._syncInventoryFromWarehouse();
            this.notify();
            return result || { success: true };
        }
        // 旧逻辑（向后兼容）
        const existing = this.state.inventory.find(
            i => i.productId === item.productId && i.supplierId === item.supplierId && i.qualityGrade === item.qualityGrade
        );
        let addedQty = item.quantity;
        if (existing) {
            existing.quantity += item.quantity;
        } else {
            item.id = generateId('inv');
            this.state.inventory.push(item);
        }
        if (!options.silent) {
            const product = getProductById(item.productId);
            this.addWarehouseLog('inbound', {
                productId: item.productId,
                productName: product?.name || item.productId,
                qualityGrade: item.qualityGrade || 'B',
                quantity: addedQty,
                unitCost: item.costPrice || 0,
                totalCost: (item.costPrice || 0) * addedQty,
                supplierId: item.supplierId,
                note: options.note || (item.purchaseOrderId ? '采购入库' : '入库')
            });
        }
        this.notify();
    }

    // 采购订单
    addPurchaseOrder(order) {
        order.id = generateId('po');
        order.createTime = { ...this.state.gameTime };
        order.status = 'pending';
        order.expectedArrivalDay = this.state.gameTime.day + (order.deliveryDays || 3);
        this.state.purchaseOrders.push(order);
        this.notify();
        // 供应链模块钩子:累计供应商关系值(模块未加载时静默跳过)
        try {
            if (typeof supplyState !== 'undefined' && supplyState && typeof supplyState.onPurchaseOrder === 'function') {
                supplyState.onPurchaseOrder(order);
            }
        } catch (_) {}
    }

    receivePurchaseOrder(orderId) {
        const order = this.state.purchaseOrders.find(o => o.id === orderId);
        if (order && order.status === 'shipping') {
            order.status = 'received';
            order.receiveTime = { ...this.state.gameTime };
            
            // purchaseOrderId 标记：入库侧识别为已预付，避免二次扣款
            // ===== 修复：把采购员透传到入库，采购员的回扣/关联采购单数/绩效才能正确累计 =====
            this.addInventory({
                productId: order.productId,
                supplierId: order.supplierId,
                quantity: order.quantity,
                costPrice: order.unitPrice,
                quality: order.quality,
                qualityGrade: order.qualityGrade,
                purchaseOrderId: order.id
            }, {
                buyerId: order.buyerId || null,
                buyerName: order.buyerName || ''
            });

            try {
                const name = order.productName || order.productId || '商品';
                const grade = order.qualityGrade || 'B';
                const qty = order.quantity || 0;
                const msg = `📦 采购到货：${name}（${grade}）×${qty}，已入库可上架`;
                if (typeof eventBus !== 'undefined' && eventBus.emit) {
                    eventBus.emit('toast:show', { message: msg, type: 'success' });
                    eventBus.emit('purchase:received', {
                        orderId: order.id,
                        productId: order.productId,
                        productName: name,
                        quantity: qty,
                        qualityGrade: grade,
                        buyerId: order.buyerId || null
                    });
                } else if (typeof ui !== 'undefined' && ui && typeof ui.showToast === 'function') {
                    ui.showToast(msg);
                }
            } catch (_) {}
            
            this.notify();
            return true;
        }
        return false;
    }

    // 员工管理
    hireEmployee(typeId, employmentType = 'fulltime', customInfo = {}) {
        const typeInfo = EMPLOYEE_TYPES[typeId];
        if (!typeInfo) {
            return { success: false, message: '无效的员工类型' };
        }
        
        const empTypeInfo = EMPLOYMENT_TYPES[employmentType];
        if (!empTypeInfo) {
            return { success: false, message: '无效的雇佣形式' };
        }
        
        const cityId = this.state.shop.city || 'yiwu';
        const salaryDiscount = getCitySalaryDiscount(cityId);
        const actualEfficiency = typeInfo.efficiency * empTypeInfo.efficiencyMultiplier;
        const department = EMPLOYEE_DEPARTMENT_MAP[typeId] || 'other';
        const startBaseSalary = (typeof typeInfo.baseSalary === 'number') ? typeInfo.baseSalary : 2500;
        const startPositionSalary = 0; // 底薪固定，不再叠岗位工资吃掉封顶额度
        
        const employee = {
            id: generateId('emp'),
            type: typeId,
            employmentType: employmentType,
            name: customInfo.name || (typeInfo.name + (this.state.employees.filter(e => e.type === typeId).length + 1)),
            phone: customInfo.phone || '',
            idCard: customInfo.idCard || '',
            emergencyContact: customInfo.emergencyContact || '',
            emergencyPhone: customInfo.emergencyPhone || '',
            address: customInfo.address || '',
            department: department,
            position: typeInfo.name,
            baseSalary: startBaseSalary,
            positionSalary: startPositionSalary,
            salary: 0, // 临时值，下面重新计算
            efficiency: actualEfficiency,
            skills: typeInfo.skills,
            hireDate: { ...this.state.gameTime },
            joinDate: customInfo.joinDate || { ...this.state.gameTime },
            status: 'active',  // active | onleave | resigning | resigned
            currentTask: null,
            assignedTask: null,
            level: 1,
            exp: 0,
            workDays: 0,
            _totalExpAccum: 0,
            attendancePerfect: true,  // 本月全勤标记
            overtimeHours: 0,         // 本月加班时长
            overtimeHoursToday: 0,    // 当日加班（心情结算用）
            resignEffectiveDay: null,
            performanceScore: 100,    // 本月绩效评分（0-150）
            bonuses: {},              // 本月临时奖金/扣款
            salaryAdjustments: [],    // 薪资调整历史
            leaveDays: 0,             // 本月请假天数
            // ===== 员工管理V2：任务指派/培训/职级字段 =====
            focusTask: null,         // 专注任务（EMP_TASK_TYPES id；null=自动调度）
            rank: 'intern',          // 职级（EMP_RANKS id）
            _rankSalaryMult: 1.0,    // 职级工资倍率（薪酬核算「职级补贴」）
            training: null,          // 培训中：{courseId, startDay, endDay}
            trainingBuffs: {},       // 培训永久加成 {skill|__all__: 倍率}
            // ===== 员工管理V2：忠诚度·情绪·排班字段 =====
            loyalty: 60,             // 忠诚度 0~100（影响离职风险）
            mood: 70,                // 心情 0~100（影响工作效率）
            shift: 'auto',           // 排班：auto | day | night
            stats: {
                ordersPacked: 0, ordersShipped: 0, consultationsHandled: 0,
                marketingRuns: 0, marketingOrdersGenerated: 0,
                hourlyCounts: {}
            }
        };
        
        // 使用统一方法计算工资
        this._recalculateEmployeeSalary(employee);
        
        this.state.employees.push(employee);
        // 采购员岗位：同步到仓储模块，并自动创建「每日补在架」计划（避免招了人不补货）
        if (typeId === 'buyer') {
            try {
                const wh = (typeof warehouseState !== 'undefined' && warehouseState)
                    || (typeof window !== 'undefined' && window.warehouseState)
                    || this.warehouse
                    || null;
                if (wh && typeof wh.syncBuyersFromEmployees === 'function') {
                    wh.gameState = wh.gameState || this;
                    wh.syncBuyersFromEmployees();
                    const linked = (wh.state.buyers || []).find(b => b && b.linkedEmployeeId === employee.id);
                    if (linked && typeof wh.quickStartOnShelfRestock === 'function') {
                        wh.quickStartOnShelfRestock(linked.id);
                    }
                }
            } catch (e) { /* ignore sync errors */ }
        }
        try { this.autoFillHousing({ silent: true }); } catch (_) {}
        this.notify();
        return { success: true, employee };
    }

    /**
     * 批量招聘：一次性生成 count 名同类型员工
     */
    hireEmployeeBatch(typeId, employmentType = 'fulltime', count = 5) {
        const n = Math.max(1, Math.min(50, Math.floor(Number(count) || 0)));
        if (!n) return { success: false, hired: 0, failed: 0, message: '数量无效' };
        const typeInfo = EMPLOYEE_TYPES[typeId];
        if (!typeInfo) return { success: false, hired: 0, failed: 0, message: '无效的员工类型' };
        const empTypeInfo = EMPLOYMENT_TYPES[employmentType];
        if (!empTypeInfo) return { success: false, hired: 0, failed: 0, message: '无效的雇佣形式' };

        let hired = 0;
        let failed = 0;
        let lastMsg = '';
        const employees = [];
        for (let i = 0; i < n; i++) {
            const r = this.hireEmployee(typeId, employmentType);
            if (r && r.success) {
                hired++;
                if (r.employee) employees.push(r.employee);
            } else {
                failed++;
                lastMsg = (r && r.message) || '招聘失败';
                break;
            }
        }
        if (hired <= 0) {
            return { success: false, hired: 0, failed: failed || n, message: lastMsg || '批量招聘失败' };
        }
        return {
            success: true,
            hired,
            failed,
            employees,
            message: failed
                ? `已招聘 ${hired} 名${empTypeInfo.name}${typeInfo.name}，其余失败：${lastMsg}`
                : `成功批量招聘 ${hired} 名${empTypeInfo.name}${typeInfo.name}`
        };
    }

    /**
     * 运营风险指标：近窗取消率 / 退货率
     */
    getOpsRiskMetrics() {
        const cfg = (typeof OPS_RISK_CONFIG !== 'undefined') ? OPS_RISK_CONFIG : {
            cancelRateCap: 0.1, returnRateCap: 0.1, minSampleOrders: 20,
            minCompletedForReturn: 15, windowDays: 30
        };
        const day = (this.state.gameTime && this.state.gameTime.day) || 1;
        const windowDays = cfg.windowDays || 30;
        const fromDay = Math.max(1, day - windowDays + 1);
        const orders = (this.state.orders || []).filter(o => {
            const d = (o && o.createTime && o.createTime.day) || 0;
            return d >= fromDay;
        });
        const total = orders.length;
        const cancelled = orders.filter(o => o.status === 'cancelled').length;
        const completed = orders.filter(o => o.status === 'completed' || o.status === 'delivered').length;
        const returns = ((this.state.customerService && this.state.customerService.returns) || []).filter(r => {
            const d = (r && r.createTime && r.createTime.day)
                || (r && r.createdAt && r.createdAt.day)
                || day;
            return d >= fromDay;
        }).length;
        const cancelRate = total > 0 ? cancelled / total : 0;
        const returnRate = completed > 0 ? returns / completed : 0;
        return {
            windowDays,
            fromDay,
            total,
            cancelled,
            completed,
            returns,
            cancelRate,
            returnRate,
            cancelRateCap: cfg.cancelRateCap,
            returnRateCap: cfg.returnRateCap,
            cancelBreached: total >= (cfg.minSampleOrders || 20) && cancelRate > (cfg.cancelRateCap || 0.1),
            returnBreached: completed >= (cfg.minCompletedForReturn || 15) && returnRate > (cfg.returnRateCap || 0.1),
            isBanned: this.isShopPlatformBanned()
        };
    }

    /** 取消率硬顶（默认 10%）：再取消一单是否仍不超标 */
    getMaxCancelRate() {
        const cfg = (typeof SHOP_CONFIG !== 'undefined' && SHOP_CONFIG) ? SHOP_CONFIG : null;
        const n = cfg && cfg.maxCancelRate != null ? Number(cfg.maxCancelRate) : 0.10;
        if (!(n > 0) || !isFinite(n)) return 0.10;
        return Math.min(1, Math.max(0.01, n));
    }

    /** 订单取消无限制：取消率硬顶已停用 */
    canCancelAnotherOrder() {
        return true;
    }

    isShopPlatformBanned() {
        return false;
    }

    getShopPlatformBanRemainDays() {
        return 0;
    }

    /**
     * 平台风控已关闭：不再因取消/退货率触发封禁或降分。
     */
    checkOpsRiskThresholds() {
        return { triggered: false, disabled: true };
    }

    /**
     * 更新员工信息
     */
    updateEmployeeInfo(employeeId, updates) {
        const emp = this.state.employees.find(e => e.id === employeeId);
        if (!emp) return { success: false, message: '员工不存在' };
        
        const allowedFields = ['name', 'phone', 'idCard', 'emergencyContact', 'emergencyPhone', 'address', 'performanceScore'];
        const oldValues = {};
        
        allowedFields.forEach(field => {
            if (updates[field] !== undefined && updates[field] !== emp[field]) {
                oldValues[field] = emp[field];
                emp[field] = updates[field];
            }
        });
        
        // 处理基本工资调整
        if (updates.baseSalary !== undefined && updates.baseSalary !== emp.baseSalary) {
            oldValues.baseSalary = emp.baseSalary;
            oldValues.salary = emp.salary;
            emp.baseSalary = Math.max(0, Math.round(updates.baseSalary));
            this._recalculateEmployeeSalary(emp);
            
            emp.salaryAdjustments.push({
                date: { ...this.state.gameTime },
                oldBaseSalary: oldValues.baseSalary,
                newBaseSalary: emp.baseSalary,
                reason: updates.adjustReason || '手动调整'
            });
        }
        
        this.notify();
        return { success: true, employee: emp, changed: oldValues };
    }

    /**
     * 重新计算员工工资（根据baseSalary、employmentType、level等）
     */
    _recalculateEmployeeSalary(emp) {
        if (!emp || !emp.type) return;
        const typeInfo = EMPLOYEE_TYPES[emp.type];
        const empTypeInfo = EMPLOYMENT_TYPES[emp.employmentType];
        if (!typeInfo || !empTypeInfo) return;
        
        const cityId = this.state.shop.city || 'yiwu';
        const salaryDiscount = getCitySalaryDiscount(cityId);
        const lvlMult = EMPLOYEE_LEVEL_CONFIG.salaryMultiplier(emp.level || 1);
        // 底薪固定 2500（按岗位配置），岗位工资不再叠加，避免封顶时「看起来扣了底薪」
        const fixedBase = (typeof typeInfo.baseSalary === 'number') ? typeInfo.baseSalary : 2500;
        emp.baseSalary = fixedBase;
        emp.positionSalary = 0;
        const payCap = (emp && emp.type === 'factoryDirector')
            ? 6000
            : ((typeof EMPLOYEE_MONTHLY_PAY_CAP === 'number') ? EMPLOYEE_MONTHLY_PAY_CAP : 2500);
        emp.salary = Math.max(fixedBase, Math.min(payCap, Math.round(
            fixedBase * empTypeInfo.salaryMultiplier * lvlMult * (1 - salaryDiscount)
        )));
        // ===== 员工管理V2：职级工资展示值（实际发放走 calculateEmployeePayroll 的「职级补贴」明细项）=====
        const rankMult = (typeof emp._rankSalaryMult === 'number' && emp._rankSalaryMult > 0) ? emp._rankSalaryMult : 1;
        emp.salaryWithRank = Math.round(emp.salary * rankMult);
    }

    /**
     * 员工状态变更（请假、复职等）
     */
    setEmployeeStatus(employeeId, status, reason = '') {
        const emp = this.state.employees.find(e => e.id === employeeId);
        if (!emp) return { success: false, message: '员工不存在' };
        const validStatuses = ['active', 'onleave', 'resigning', 'resigned'];
        if (!validStatuses.includes(status)) {
            return { success: false, message: '无效的状态' };
        }
        emp.status = status;
        emp.statusReason = reason;
        emp.statusChangeDate = { ...this.state.gameTime };
        this.notify();
        return { success: true };
    }

    getEmployeeMonthlySalary(employee) {
        return employee.salary || 0;
    }

    /**
     * 计算员工月度工资明细（完整工资单）
     */
    calculateEmployeePayroll(emp, monthDay = null) {
        if (!emp || emp.status !== 'active') return null;
        
        const typeInfo = EMPLOYEE_TYPES[emp.type];
        const bonusConfig = this.state.payroll?.bonusConfig || {};
        const isParttime = emp.employmentType === 'parttime';
        
        // ---- 应发工资 ----
        // 底薪固定（默认 2500），岗位工资不再叠加；提成在封顶之外另计
        const typeBase = (typeInfo && typeof typeInfo.baseSalary === 'number') ? typeInfo.baseSalary : 2500;
        const baseSalary = Math.max(typeBase, emp.baseSalary || typeBase);
        const positionSalary = 0;
        
        // 补贴/固定奖金
        let allowances = 0;
        const allowanceItems = [];
        if (!isParttime && bonusConfig.attendance?.enabled && emp.attendancePerfect !== false) {
            const amt = bonusConfig.attendance.amount || BONUS_TYPES.attendance.defaultAmount;
            allowances += amt;
            allowanceItems.push({ name: '全勤奖', amount: amt, icon: '✅' });
        }
        if (bonusConfig.meal?.enabled) {
            const amt = bonusConfig.meal.amount || BONUS_TYPES.meal.defaultAmount;
            allowances += amt;
            allowanceItems.push({ name: '餐补', amount: amt, icon: '🍱' });
        }
        if (bonusConfig.transport?.enabled) {
            const amt = bonusConfig.transport.amount || BONUS_TYPES.transport.defaultAmount;
            allowances += amt;
            allowanceItems.push({ name: '交通补', amount: amt, icon: '🚌' });
        }
        // 高温补贴（6-9月）
        if (bonusConfig.highTemperature?.enabled) {
            const curMonth = Math.floor(((this.state.gameTime?.day || 1) / 30) % 12) + 1;
            if (curMonth >= 6 && curMonth <= 9) {
                const amt = bonusConfig.highTemperature.amount || BONUS_TYPES.highTemperature.defaultAmount;
                allowances += amt;
                allowanceItems.push({ name: '高温补贴', amount: amt, icon: '🔥' });
            }
        }
        
        // 绩效奖金：绩效评分 60-150，对应 0~200% 绩效基数
        const perfScore = Math.max(0, Math.min(150, emp.performanceScore || 100));
        const perfBase = Math.round(baseSalary * 0.1); // 绩效基数为基本工资10%
        const performanceBonus = Math.round(perfBase * (perfScore / 100));
        if (performanceBonus !== 0) {
            allowanceItems.push({ name: `绩效奖金(${perfScore}分)`, amount: performanceBonus, icon: '📊' });
        }
        
        // 加班费
        let overtimePay = 0;
        if (emp.overtimeHours > 0) {
            const hourlyRate = baseSalary / 21.75 / 8; // 月计薪天数21.75，每天8小时
            overtimePay = Math.round(hourlyRate * 1.5 * emp.overtimeHours);
            allowanceItems.push({ name: `加班费(${emp.overtimeHours}h)`, amount: overtimePay, icon: '⏰' });
        }
        
        // 自定义奖金/扣款
        let customBonusTotal = 0;
        const customItems = [];
        if (emp.bonuses && typeof emp.bonuses === 'object') {
            Object.entries(emp.bonuses).forEach(([key, val]) => {
                if (typeof val === 'number' && val !== 0) {
                    customBonusTotal += val;
                    customItems.push({ name: key, amount: val, icon: val >= 0 ? '🎁' : '➖' });
                }
            });
        }
        
        // 福利补贴（来自福利等级体系）
        const welfare = (typeof EMPLOYEE_WELFARE_CONFIG !== 'undefined' && EMPLOYEE_WELFARE_CONFIG.getLevel)
            ? EMPLOYEE_WELFARE_CONFIG.getLevel(emp) : null;
        let welfareAllowance = 0;
        if (welfare && !isParttime) {
            welfare.benefits.forEach(b => {
                const m = b.value.match(/¥(\d+)/);
                if (m) welfareAllowance += parseInt(m[1]);
            });
            if (welfareAllowance > 0) {
                allowanceItems.push({ name: `${welfare.icon}${welfare.name}福利补贴`, amount: welfareAllowance, icon: welfare.icon });
            }
        }
        
        // 自定义奖金不计入硬顶，与提成一样在发薪时全额核算
        const cappedExtras = allowances + performanceBonus + overtimePay + welfareAllowance;
        const payCap = (emp && emp.type === 'factoryDirector')
            ? 6000
            : ((typeof EMPLOYEE_MONTHLY_PAY_CAP === 'number') ? EMPLOYEE_MONTHLY_PAY_CAP : 2500);
        // 封顶只压缩「底薪以外固定津贴」部分，底薪永远不被削减
        const extrasRoom = Math.max(0, payCap - baseSalary);
        let appliedExtras = cappedExtras;
        if (cappedExtras > extrasRoom) {
            const cut = cappedExtras - extrasRoom;
            allowanceItems.push({ name: `津贴封顶调整(底薪¥${baseSalary}不动)`, amount: -cut, icon: '🔒' });
            appliedExtras = extrasRoom;
        }
        // 手动奖金/扣款全额计入（不进硬顶）
        if (customBonusTotal !== 0) {
            customItems.forEach(ci => allowanceItems.push(ci));
        }
        // ===== 员工管理V2：职级补贴（晋升阶梯，全额另计不进硬顶）=====
        const rankMult = (typeof emp._rankSalaryMult === 'number' && emp._rankSalaryMult > 0) ? emp._rankSalaryMult : 1;
        const rankAllowance = rankMult > 1 ? Math.round(baseSalary * (rankMult - 1)) : 0;
        if (rankAllowance > 0) {
            allowanceItems.push({ name: '职级补贴', amount: rankAllowance, icon: '🏅' });
        }
        let grossSalary = baseSalary + appliedExtras + customBonusTotal + rankAllowance;
        // 销售提成单独累加（不计入硬顶、不扣底薪）
        const salesCommission = Math.max(0, Math.round((emp.pendingSalesCommission || 0) * 100) / 100);
        if (salesCommission > 0) {
            allowanceItems.push({ name: '营销利润提成（另计）', amount: salesCommission, icon: '📣' });
        }
        const replyCommission = Math.max(0, Math.round((emp.pendingReplyCommission || 0) * 100) / 100);
        if (replyCommission > 0) {
            allowanceItems.push({ name: '客服处理提成（0.8元/单，月顶800）', amount: replyCommission, icon: '💬' });
        }
        const pricingCommission = Math.max(0, Math.round((emp.pendingPricingCommission || 0) * 100) / 100);
        if (pricingCommission > 0) {
            allowanceItems.push({ name: '改价提成（2元/款，月顶600）', amount: pricingCommission, icon: '💲' });
        }
        const promoViews = Math.max(0, Number(emp.monthPromoViews) || 0);
        const promoOrders = Math.max(0, Number(emp.monthPromoOrders) || 0);
        const convRate = promoViews > 0 ? (promoOrders / promoViews) : 0;
        let promoCommission = Math.max(0, Math.round((emp.pendingPromoCommission || 0) * 100) / 100);
        if ((emp.type === 'marketer' || emp.type === 'manager') && (promoViews > 0 || promoOrders > 0)) {
            const convPay = Math.round(convRate * 20000 * (emp.level || 1));
            const orderPay = promoOrders * 30 * (emp.level || 1);
            promoCommission = Math.max(promoCommission, convPay + orderPay);
            // ===== 爆单保护：月推广单数千时提成公式会算出千万级（曾达 860万+/月），按底薪量级封顶 =====
            // Lv1 1650 / Lv10 3000：小单量时公式原值更小不受影响，仅在大单量时生效
            const PROMO_COMMISSION_CAP = 1500 + (emp.level || 1) * 150;
            promoCommission = Math.min(promoCommission, PROMO_COMMISSION_CAP);
        }
        if (promoCommission > 0) {
            allowanceItems.push({
                name: `推广转化提成（转化${(convRate * 100).toFixed(1)}%）`,
                amount: promoCommission,
                icon: '📣'
            });
        }
        // 律师上诉赔偿提成（另计，不计入硬顶）
        const legalCommission = Math.max(0, Math.round((emp.pendingLegalCommission || 0) * 100) / 100);
        if (legalCommission > 0) {
            allowanceItems.push({ name: '上诉赔偿提成5%（另计）', amount: legalCommission, icon: '⚖️' });
        }
        // 全员经手订单提成（默认 0.1%；采购员走仓储 0.001% 月结，不吃这单）
        const staffCommission = Math.max(0, Math.round((emp.pendingStaffCommission || 0) * 100) / 100);
        if (staffCommission > 0) {
            allowanceItems.push({ name: '经手订单提成', amount: staffCommission, icon: '💰' });
        }
        const payoutGross = Math.round((grossSalary + salesCommission + legalCommission + replyCommission + pricingCommission + promoCommission + staffCommission) * 100) / 100;
        
        // ---- 个人社保公积金扣款（仅全职，基数按封顶后基本应发） ----
        let socialInsurance = 0;
        let housingFund = 0;
        const socialItems = [];
        if (!isParttime && grossSalary > 0) {
            const base = Math.max(grossSalary, 0);
            Object.entries(SOCIAL_INSURANCE_CONFIG).forEach(([key, cfg]) => {
                if (cfg.employeeRate > 0) {
                    const amt = Math.round(base * cfg.employeeRate * 100) / 100;
                    if (key === 'housingFund') housingFund += amt;
                    else socialInsurance += amt;
                    socialItems.push({ name: cfg.name, amount: -amt, icon: cfg.icon });
                }
            });
        }
        
        // ---- 个人所得税计算 ----
        const taxableIncome = Math.max(0, payoutGross - socialInsurance - housingFund - 5000);
        let incomeTax = 0;
        let taxBracket = null;
        for (const bracket of INCOME_TAX_BRACKETS) {
            if (taxableIncome > bracket.min) {
                taxBracket = bracket;
            }
        }
        if (taxBracket && taxBracket.rate > 0) {
            incomeTax = Math.max(0, Math.round((taxableIncome * taxBracket.rate - taxBracket.deduction) * 100) / 100);
        }
        
        // ---- 实发工资 ----
        const totalDeduction = socialInsurance + housingFund + incomeTax;
        const netSalary = Math.round(payoutGross - totalDeduction);
        
        // ---- 企业成本（企业承担的五险一金部分）----
        let companySocialCost = 0;
        if (!isParttime && grossSalary > 0) {
            Object.values(SOCIAL_INSURANCE_CONFIG).forEach(cfg => {
                companySocialCost += Math.round(grossSalary * cfg.companyRate * 100) / 100;
            });
        }
        
        return {
            employeeId: emp.id,
            employeeName: emp.name,
            department: DEPARTMENTS[emp.department]?.name || emp.department,
            position: typeInfo?.name || emp.type,
            employmentType: isParttime ? '兼职' : '全职',
            level: emp.level || 1,
            welfare: welfare ? welfare.name : '',
            items: {
                baseSalary,
                positionSalary,
                allowances: allowanceItems,
                performanceBonus,
                overtimePay,
                customItems,
                welfareAllowance,
                salesCommission,
                replyCommission,
                promoCommission,
                legalCommission,
                staffCommission,
                socialItems,
                incomeTax: Math.round(incomeTax * 100) / 100,
                taxBracket: taxBracket?.name || '免税'
            },
            grossSalary: payoutGross,
            baseGrossCapped: Math.round(grossSalary * 100) / 100,
            salesCommission,
            replyCommission,
            promoCommission,
            legalCommission,
            staffCommission,
            socialInsurance: Math.round(socialInsurance * 100) / 100,
            housingFund: Math.round(housingFund * 100) / 100,
            incomeTax: Math.round(incomeTax * 100) / 100,
            totalDeduction: Math.round(totalDeduction * 100) / 100,
            netSalary,
            companyCost: Math.round((payoutGross + companySocialCost) * 100) / 100,
            workDays: emp.workDays || 0,
            overtimeHours: emp.overtimeHours || 0,
            attendancePerfect: emp.attendancePerfect !== false,
            performanceScore: perfScore
        };
    }

    /**
     * 批量核算全员月工资
     */
    calculateAllPayroll() {
        const employees = this.state.employees.filter(e => e.status === 'active');
        const slips = employees.map(emp => this.calculateEmployeePayroll(emp));
        
        const totals = slips.reduce((acc, slip) => {
            if (!slip) return acc;
            acc.gross += slip.grossSalary;
            acc.net += slip.netSalary;
            acc.social += slip.socialInsurance + slip.housingFund;
            acc.tax += slip.incomeTax;
            acc.companyCost += slip.companyCost;
            acc.count++;
            return acc;
        }, { gross: 0, net: 0, social: 0, tax: 0, companyCost: 0, count: 0 });
        
        return { slips, totals };
    }

    calculateTotalMonthlySalary() {
        const employees = this.state.employees.filter(e => e.status === 'active');
        return employees.reduce((sum, e) => sum + this.getEmployeeMonthlySalary(e), 0);
    }

    /**
     * 发放工资（实际扣款并生成记录）
     */
    settleEmployeeSalaries() {
        const employees = this.state.employees.filter(e => e.status === 'active');
        if (employees.length === 0) return { success: false, message: '暂无在职员工' };
        
        const payroll = this.calculateAllPayroll();
        const totalNet = payroll.totals.net;
        const totalCompanyCost = payroll.totals.companyCost;
        
        if (totalCompanyCost > 0) {
            // 统一走 spendFunds（含欠款上限），失败则整单不发
            if (!this.spendFunds(totalCompanyCost, `员工工资发放（${payroll.totals.count}人，实发¥${totalNet.toLocaleString()}）`)) {
                return {
                    success: false,
                    message: `资金不足！发放工资需要 ¥${totalCompanyCost.toLocaleString()}（含企业社保），当前资金 ¥${this.state.shop.funds.toLocaleString()}`,
                    required: totalCompanyCost,
                    available: this.state.shop.funds
                };
            }
        }
        
        // 生成工资发放记录
        const recordId = generateId('payroll');
        const payRecord = {
            id: recordId,
            date: { ...this.state.gameTime },
            period: `第${Math.floor(this.state.gameTime.day / 30) + 1}月`,
            employeeCount: payroll.totals.count,
            grossTotal: payroll.totals.gross,
            socialTotal: payroll.totals.social,
            taxTotal: payroll.totals.tax,
            netTotal: totalNet,
            companyCost: totalCompanyCost,
            slips: payroll.slips.map(s => ({
                employeeId: s.employeeId,
                employeeName: s.employeeName,
                netSalary: s.netSalary,
                grossSalary: s.grossSalary
            }))
        };
        
        this.state.payroll.records.unshift(payRecord);
        this.state.payroll.salarySlips.push(...payroll.slips.map(s => ({
            ...s,
            payrollId: recordId,
            payDate: { ...this.state.gameTime }
        })));
        
        // 保留最近12个月记录
        if (this.state.payroll.records.length > 12) {
            this.state.payroll.records = this.state.payroll.records.slice(0, 12);
        }
        if ((this.state.payroll.salarySlips || []).length > 200) {
            this.state.payroll.salarySlips = this.state.payroll.salarySlips.slice(-200);
        }

        // 宿舍月租：按入住人数扣款（不影响底薪，企业另付）
        let housingRent = 0;
        try {
            const h = this.cleanupHousingAssignments();
            if (h && (h.beds || 0) > 0) {
                const occupied = this.getHousingOccupiedCount();
                housingRent = Math.round(occupied * (h.monthlyRentPerBed || 180));
                if (housingRent > 0) {
                    this.spendFunds(housingRent, `员工宿舍月租（${occupied}人）`);
                    // 入住提升满意度；满员额外加成
                    const fill = h.beds > 0 ? occupied / h.beds : 0;
                    h.satisfaction = Math.min(100, Math.round((h.satisfaction || 60) * 0.7 + 40 + fill * 20));
                }
            }
        } catch (_) {}
        
        // 重置月度考勤/加班/绩效/提成数据
        employees.forEach(emp => {
            emp.attendancePerfect = true;
            emp.overtimeHours = 0;
            emp.overtimeHoursToday = 0;
            emp.performanceScore = 100;
            emp.bonuses = {};
            emp.leaveDays = 0;
            emp.pendingSalesCommission = 0;
            emp.pendingLegalCommission = 0;
            emp.pendingReplyCommission = 0;
            emp.pendingPricingCommission = 0;
            emp.pendingPromoCommission = 0;
            emp.pendingStaffCommission = 0;
            emp.monthReplyCommission = 0;
            emp.monthPricingCommission = 0;
            emp.monthLegalCommission = 0;
            emp.monthStaffOrders = 0;
            emp.monthPromoViews = 0;
            emp.monthPromoOrders = 0;
            // 有宿舍的员工绩效微幅上浮（下月生效）
            if (emp.housingAssigned) emp.performanceScore = 105;
        });
        try {
            if (this.state.shop) this.state.shop.legalCompensationMonth = 0;
        } catch (_) {}
        
        this.state.lastSalaryPayDay = this.state.gameTime.day;
        this.state.payroll.lastPayrollDay = this.state.gameTime.day;
        
        this.notify();
        return { success: true, record: payRecord, payroll, housingRent };
    }

    /**
     * 给员工发放奖金/扣款
     */
    addEmployeeBonus(employeeId, name, amount, reason = '') {
        const emp = this.state.employees.find(e => e.id === employeeId);
        if (!emp) return { success: false, message: '员工不存在' };
        if (!name || !name.trim()) return { success: false, message: '请填写奖金名称' };
        if (typeof amount !== 'number' || amount === 0) return { success: false, message: '金额不能为0' };
        
        if (!emp.bonuses) emp.bonuses = {};
        const key = name.trim();
        emp.bonuses[key] = (emp.bonuses[key] || 0) + amount;
        
        // 记录奖金发放历史
        this.state.payroll.customBonuses.unshift({
            id: generateId('bonus'),
            employeeId,
            employeeName: emp.name,
            name: key,
            amount,
            reason,
            date: { ...this.state.gameTime }
        });
        if (this.state.payroll.customBonuses.length > 100) {
            this.state.payroll.customBonuses = this.state.payroll.customBonuses.slice(0, 100);
        }
        
        this.notify();
        return { success: true, message: amount >= 0 ? `已发放 ${key} ¥${amount}` : `已扣款 ${key} ¥${Math.abs(amount)}` };
    }

    /**
     * 记录加班
     */
    addEmployeeOvertime(employeeId, hours, type = 'workday') {
        const emp = this.state.employees.find(e => e.id === employeeId);
        if (!emp) return { success: false, message: '员工不存在' };
        if (hours <= 0) return { success: false, message: '加班时长必须大于0' };
        
        const rate = OVERTIME_RATES[type]?.rate || 1.5;
        emp.overtimeHours = (emp.overtimeHours || 0) + hours;
        emp.overtimeHoursToday = (emp.overtimeHoursToday || 0) + hours;
        
        this.state.payroll.overtimeRecords.unshift({
            id: generateId('ot'),
            employeeId,
            employeeName: emp.name,
            hours,
            type,
            rate,
            date: { ...this.state.gameTime }
        });
        
        this.notify();
        return { success: true, message: `已登记${OVERTIME_RATES[type]?.name || '加班'}${hours}小时` };
    }

    /**
     * 更新奖金配置
     */
    updateBonusConfig(bonusId, config) {
        if (!this.state.payroll.bonusConfig) this.state.payroll.bonusConfig = {};
        if (!this.state.payroll.bonusConfig[bonusId]) {
            this.state.payroll.bonusConfig[bonusId] = { enabled: false, amount: 0 };
        }
        if (config.enabled !== undefined) this.state.payroll.bonusConfig[bonusId].enabled = !!config.enabled;
        if (config.amount !== undefined) this.state.payroll.bonusConfig[bonusId].amount = Math.max(0, Math.round(config.amount));
        this.notify();
        return { success: true };
    }

    /**
     * 查询员工（支持关键词搜索）
     */
    searchEmployees(keyword = '', department = '', status = 'active') {
        let list = [...(this.state.employees || [])];
        if (status === 'resigned') return [];
        if (!status || status === 'all') {
            list = list.filter(e => e && e.status && e.status !== 'resigned');
        } else if (status === 'active') {
            list = list.filter(e => e && (e.status === 'active' || e.status === 'resigning'));
        } else {
            list = list.filter(e => e && e.status === status);
        }
        if (department && department !== 'all') {
            list = list.filter(e => e && e.department === department);
        }
        if (keyword && keyword.trim()) {
            const kw = keyword.trim().toLowerCase();
            list = list.filter(e => e && (
                (e.name || '').toLowerCase().includes(kw) ||
                (e.phone || '').includes(kw) ||
                (e.position || '').toLowerCase().includes(kw) ||
                ((typeof DEPARTMENTS !== 'undefined' && DEPARTMENTS[e.department]?.name) || '').includes(kw)
            ));
        }
        return list;
    }

    fireEmployee(employeeId) {
        const idx = this.state.employees.findIndex(e => e.id === employeeId || String(e.id) === String(employeeId));
        if (idx > -1) {
            const emp = this.state.employees[idx];
            // 不是直接删除，而是标记为离职（保留记录用于工资核算和历史追溯）
            // 如果员工在当前月有工作记录，发薪时仍需结算，所以保留到下次发薪后再清理？
            // 简化处理：标记为resigned，发薪时不计算，直接从列表移除
            this.state.employees.splice(idx, 1);
            // 释放宿舍床位，避免离职员工继续占床
            try {
                if (this.state.housing && this.state.housing.assigned && emp) {
                    delete this.state.housing.assigned[emp.id];
                    delete this.state.housing.assigned[String(emp.id)];
                }
            } catch (_) {}
            // 同步仓储采购员状态（关联员工离职 → 采购员标记离职）
            if (emp && emp.type === 'buyer') {
                try {
                    const wh = (typeof warehouseState !== 'undefined' && warehouseState)
                        || (typeof window !== 'undefined' && window.warehouseState)
                        || this.warehouse
                        || null;
                    if (wh && typeof wh.syncBuyersFromEmployees === 'function') {
                        wh.gameState = wh.gameState || this;
                        wh.syncBuyersFromEmployees();
                    }
                } catch (e) { /* ignore */ }
            }
            this.notify();
            return { success: true, employeeName: emp.name };
        }
        return { success: false, message: '员工不存在' };
    }

    /**
     * 一键裁员：批量解雇全部在职员工（可过滤类型）
     * 复用单员工解雇的清理逻辑（宿舍床位释放 / 采购员同步），但仅 notify 一次
     * @param {object} [opts] { onlyTypes: string[], status: 'active' }
     * @returns {{success:boolean, fired:number, names:string[], message:string}}
     */
    fireEmployeeBatchAll(opts) {
        const opt = opts || {};
        let active = (this.state.employees || []).filter(e => e && (opt.status ? e.status === opt.status : (e.status === 'active' || e.status === 'resigning')));
        if (opt.onlyTypes && opt.onlyTypes.length) {
            active = active.filter(e => opt.onlyTypes.indexOf(e.type) >= 0);
        }
        if (!active.length) return { success: false, fired: 0, names: [], message: '没有可解雇的员工' };

        const firedIds = active.map(e => e.id);
        this.state.employees = this.state.employees.filter(e => !e || firedIds.indexOf(e.id) < 0);

        // 批量释放宿舍床位，避免离职员工继续占床
        try {
            if (this.state.housing && this.state.housing.assigned) {
                const assigned = this.state.housing.assigned;
                active.forEach(emp => {
                    delete assigned[emp.id];
                    delete assigned[String(emp.id)];
                });
            }
        } catch (_) {}

        // 同步清理门店派遣记录（多店铺系统：离职员工不再占门店编制）
        try {
            const shops = this.state.shops || [];
            shops.forEach(s => {
                if (s && Array.isArray(s.staff)) {
                    s.staff = s.staff.filter(eid => firedIds.indexOf(eid) < 0);
                }
            });
        } catch (_) {}

        // 同步仓储采购员状态（关联员工离职 → 采购员标记离职）
        try {
            const wh = (typeof warehouseState !== 'undefined' && warehouseState)
                || (typeof window !== 'undefined' && window.warehouseState)
                || this.warehouse
                || null;
            if (wh && typeof wh.syncBuyersFromEmployees === 'function') {
                wh.gameState = wh.gameState || this;
                wh.syncBuyersFromEmployees();
            }
        } catch (e) { /* ignore */ }

        this.notify();
        return {
            success: true,
            fired: active.length,
            names: active.map(e => e.name),
            message: `已一键解雇 ${active.length} 名员工（宿舍床位已释放）`
        };
    }

    getAvailableEmployees(skill) {
        return this.state.employees.filter(e => 
            e.status === 'active' && 
            !e.currentTask && 
            (e.skills || []).includes(skill)
        );
    }

    // 任务分配（通用任务系统，currentTask统一使用对象形式）
    assignTask(task) {
        task.id = generateId('task');
        task.createTime = { ...this.state.gameTime };
        task.status = 'pending';
        this.state.tasks.push(task);
        
        if (task.assigneeId) {
            const emp = this.state.employees.find(e => e.id === task.assigneeId);
            if (emp) {
                emp.currentTask = {
                    type: task.type || 'general',
                    taskId: task.id,
                    startTime: { ...this.state.gameTime },
                    duration: task.duration || 1
                };
                task.status = 'processing';
                task.startTime = { ...this.state.gameTime };
            }
        }
        
        this.notify();
        return task;
    }

    completeTask(taskId) {
        const task = this.state.tasks.find(t => t.id === taskId);
        if (task) {
            task.status = 'completed';
            task.completeTime = { ...this.state.gameTime };
            
            if (task.assigneeId) {
                const emp = this.state.employees.find(e => e.id === task.assigneeId);
                if (emp) emp.currentTask = null;
            }
            
            this.notify();
            return true;
        }
        return false;
    }

    removeInventory(productId, quantity, qualityGrade = null, options = {}) {
        // 如果新仓储模块可用，使用新模块
        if (this.warehouse) {
            const result = this.warehouse.saleOut(productId, quantity, options.orderId, qualityGrade || 'B');
            // saleOut/createOutboundOrder 已同步 inventory；失败时再兜底同步一次
            if (!result || !result.success) {
                try { this.state.inventory = this._syncInventoryFromWarehouse(); } catch (_) {}
            }
            this.notify();
            return !!(result && result.success);
        }
        // 旧逻辑（向后兼容）
        let remaining = quantity;
        let takenQty = 0;
        let takenCost = 0;
        this.state.inventory.sort((a, b) => a.costPrice - b.costPrice);
        
        for (let item of this.state.inventory) {
            if (item.productId === productId && item.quantity > 0 && remaining > 0) {
                if (qualityGrade && item.qualityGrade !== qualityGrade) continue;
                const take = Math.min(item.quantity, remaining);
                item.quantity -= take;
                remaining -= take;
                takenQty += take;
                takenCost += take * (item.costPrice || 0);
            }
        }
        
        this.state.inventory = this.state.inventory.filter(i => i.quantity > 0);
        if (!options.silent && takenQty > 0) {
            const product = getProductById(productId);
            this.addWarehouseLog('outbound', {
                productId, productName: product?.name || productId,
                qualityGrade: qualityGrade || 'B',
                quantity: takenQty,
                unitCost: takenQty > 0 ? takenCost / takenQty : 0,
                totalCost: takenCost,
                orderId: options.orderId,
                note: options.note || '订单出库'
            });
        }
        this.notify();
        return remaining === 0;
    }

    getInventoryQuantity(productId, qualityGrade = null) {
        // 可售数量以仓储 FIFO 可扣库存为准；repair 已按小时节流，勿在热路径强制全量扫描
        if (this.warehouse && typeof this.warehouse.getStockQuantity === 'function') {
            try {
                return this.warehouse.getStockQuantity(productId, qualityGrade);
            } catch (_) {}
        }
        return this.state.inventory
            .filter(i => i.productId === productId
                && (!qualityGrade || i.qualityGrade === qualityGrade)
                && !i._fallback && !i._unsellable)
            .reduce((sum, i) => sum + i.quantity, 0);
    }

    /**
     * 待付款订单已占用、尚未出库的数量。
     * 库存只在付款成功时扣减，若不扣减占用，极少量库存会被刷成大量待付款单。
     * ===== 爆单性能：优先走 OrderPerf 待付款桶 + 小时级记忆化汇总（key 含桶长度，数量变化即失效）=====
     */
    getPendingReservedQuantity(productId, qualityGrade = null) {
        if (!productId) return 0;
        const grade = qualityGrade || null;
        const orders = this.state.orders || [];
        try {
            if (typeof OrderPerf !== 'undefined' && OrderPerf.enabled && OrderPerf.getStatusBucket) {
                OrderPerf.ensure(orders);
                if (!OrderPerf.dirty && OrderPerf.ordersRef === orders) {
                    const bucket = OrderPerf.getStatusBucket('pending_payment');
                    const gt = this.state.gameTime || {};
                    const key = (gt.day || 0) + '_' + (gt.hour || 0) + '_' + bucket.length;
                    let cache = this._pendingReservedCache;
                    if (!cache || cache.key !== key) {
                        // 一次性构建 productId → { byGrade, total } 汇总（O(待付款桶)）
                        const map = new Map();
                        for (let i = 0, len = bucket.length; i < len; i++) {
                            const o = bucket[i];
                            if (!o || !o.productId || o.status !== 'pending_payment') continue;
                            const q = Math.max(0, Number(o.quantity) || 0);
                            if (!q) continue;
                            let rec = map.get(o.productId);
                            if (!rec) { rec = { byGrade: new Map(), total: 0 }; map.set(o.productId, rec); }
                            const g = o.qualityGrade || 'B';
                            rec.byGrade.set(g, (rec.byGrade.get(g) || 0) + q);
                            rec.total += q;
                        }
                        cache = this._pendingReservedCache = { key, map };
                    }
                    const rec = cache.map.get(productId);
                    if (!rec) return 0;
                    return grade ? (rec.byGrade.get(grade) || 0) : rec.total;
                }
            }
        } catch (_) {}
        // 兜底：无 OrderPerf / 索引失效时全表扫描（行为与旧版一致）
        let reserved = 0;
        for (let i = 0; i < orders.length; i++) {
            const o = orders[i];
            if (!o || o.productId !== productId) continue;
            if (o.status !== 'pending_payment') continue;
            if (grade && (o.qualityGrade || 'B') !== grade) continue;
            reserved += Math.max(0, Number(o.quantity) || 0);
        }
        return reserved;
    }

    /** 真正还能再接的新单数量 = 实物库存 − 待付款占用 */
    getSellableQuantity(productId, qualityGrade = null) {
        const stock = this.getInventoryQuantity(productId, qualityGrade);
        const reserved = this.getPendingReservedQuantity(productId, qualityGrade);
        return Math.max(0, (Number(stock) || 0) - reserved);
    }

    getAverageCost(productId, qualityGrade = null) {
        return this.getPricingCostBasis(productId, qualityGrade);
    }

    /**
     * 定价成本基数：只统计正成本库存；无货时回退仓储估价 / basePrice。
     * 杜绝 0 成本批次把均价与售价上限拉崩。
     */
    getPricingCostBasis(productId, qualityGrade = 'B') {
        const grade = qualityGrade || 'B';
        const items = (this.state.inventory || []).filter(i =>
            i && i.productId === productId
            && (!grade || i.qualityGrade === grade)
            && !i._fallback && !i._unsellable
            && Number(i.quantity) > 0
            && Number(i.costPrice) > 0
        );
        const totalQty = items.reduce((sum, i) => sum + Number(i.quantity), 0);
        const totalCost = items.reduce((sum, i) => sum + Number(i.costPrice) * Number(i.quantity), 0);
        let avg = totalQty > 0 ? totalCost / totalQty : 0;

        if (!(avg > 0) && this.warehouse && typeof this.warehouse._estimatePurchaseUnitCost === 'function') {
            try { avg = this.warehouse._estimatePurchaseUnitCost(productId, grade) || 0; } catch (_) {}
        }
        if (!(avg > 0)) {
            const product = (typeof getProductById === 'function') ? getProductById(productId)
                : ((typeof PRODUCTS !== 'undefined') ? PRODUCTS.find(p => p.id === productId) : null);
            avg = product && product.basePrice > 0 ? product.basePrice * 0.7 : 1;
        }
        return Math.round(avg * 100) / 100;
    }

    // ==================== 建议售价 + 高价值识别 ====================

    /**
     * 建议售价：按市场行情均价为主，结合供需与品质微调；并夹在合理成本毛利区间内。
     */
    getSuggestedSellPrice(productId, qualityGrade = 'B') {
        const grade = qualityGrade || 'B';
        const cost = (typeof this.getPricingCostBasis === 'function')
            ? this.getPricingCostBasis(productId, grade)
            : (this.getAverageCost(productId, grade) || 0);
        const basis = (cost > 0) ? cost : 0.01;
        const rules = (typeof PRICE_RULES !== 'undefined') ? PRICE_RULES : null;
        const minMargin = (rules && rules.suggestMinMargin != null) ? rules.suggestMinMargin : 0.15;
        const maxCostMul = (rules && rules.suggestMaxCostMultiplier != null) ? rules.suggestMaxCostMultiplier : 1.8;
        const marketPull = (rules && rules.suggestMarketPull != null) ? rules.suggestMarketPull : 0.85;
        const pressureStrength = (rules && rules.suggestPressureStrength != null) ? rules.suggestPressureStrength : 0.2;

        const product = (typeof getProductById === 'function') ? getProductById(productId)
            : ((typeof PRODUCTS !== 'undefined') ? PRODUCTS.find(p => p.id === productId) : null);
        const gradeInfo = (typeof QUALITY_GRADES !== 'undefined' && QUALITY_GRADES[grade])
            ? QUALITY_GRADES[grade]
            : { priceMultiplier: 1 };

        // 行情均价（竞争对手快照）；无快照时用「成本×品级合理零售带」兜底
        let marketAvg = 0;
        try {
            if (typeof this.getOrCreateMarketSnapshot === 'function') {
                const snap = this.getOrCreateMarketSnapshot(productId);
                marketAvg = snap && snap.summary ? Number(snap.summary.avg) || 0 : 0;
            }
        } catch (_) {}
        if (!(marketAvg > 0)) {
            const bp = (product && product.basePrice > 0) ? product.basePrice : basis;
            marketAvg = bp * (gradeInfo.priceMultiplier || 1) * 1.25;
        }

        // 供需压力（与 getMarketSentiment 一致，避免互相递归）
        const day = this.state.gameTime ? this.state.gameTime.day : 0;
        const stock = (typeof this.getInventoryQuantity === 'function')
            ? this.getInventoryQuantity(productId, grade) : 0;
        let supply = 0.55;
        if (stock <= 0) supply = 0.15;
        else if (stock < 5) supply = 0.25;
        else if (stock < 20) supply = 0.4;
        else if (stock < 50) supply = 0.55;
        else if (stock < 100) supply = 0.7;
        else supply = 0.85;
        const catBoost = (product && product.category === 'digital') ? 0.08
            : (product && product.category === 'beauty') ? 0.05 : 0;
        const dayWave = ((day * 17 + String(productId || '').length * 13) % 100) / 1000;
        const demand = Math.min(0.95, Math.max(0.2, 0.5 + catBoost + dayWave));
        const pressure = demand - supply; // 正=偏热涨价，负=偏冷降价
        const pressureAdj = 1 + Math.max(-pressureStrength, Math.min(pressureStrength, pressure * 0.35));

        // 自身品质相对行情：A 略高、C 略低
        const qualityAdj = grade === 'A' ? 1.06 : (grade === 'C' ? 0.94 : 1.0);

        // 成本锚定：保证建议价不会脱离进货成本太远（高价品尤甚）
        const costAnchor = basis * (1 + Math.min(0.55, Math.max(minMargin, 0.25)));
        let suggested = marketAvg * marketPull + costAnchor * (1 - marketPull);
        suggested *= pressureAdj * qualityAdj;

        const floor = basis * Math.max(1.5, 1 + minMargin);
        const ceil = Math.max(floor, basis * maxCostMul);
        // 再贴近行情：不要明显高于市价高位太多
        const marketCeil = marketAvg > 0 ? marketAvg * 1.12 : ceil;
        // 行情过热（市场均价远高于成本毛利带）时，允许建议价跟随行情上浮，
        // 但保证与行情均价偏差 ≤ 35%（+0.01 抵消四舍五入误差）
        const marketFloor = marketAvg > 0 ? marketAvg * 0.65 + 0.01 : 0;
        const effCeil = Math.max(ceil, Math.min(marketFloor, marketCeil));
        suggested = Math.max(Math.max(floor, marketFloor), Math.min(Math.min(effCeil, marketCeil), suggested));

        return Math.round(suggested * 100) / 100;
    }

    /**
     * 合规售价上限（仅作参考；已取消硬性限价，不再阻断改价/上架）。
     */
    getMaxAllowedPrice(productId, qualityGrade = 'B', minMargin = 0.15) {
        const basis = this.getPricingCostBasis(productId, qualityGrade || 'B');
        const floor = basis * (1 + (typeof minMargin === 'number' ? minMargin : 0.15));
        const rules = (typeof PRICE_RULES !== 'undefined') ? PRICE_RULES : null;
        const thr = (rules && rules.lowCostThreshold != null) ? rules.lowCostThreshold : 3000;
        const lowMul = (rules && rules.lowCostMultiplier != null) ? rules.lowCostMultiplier : 4;
        const highMul = (rules && rules.highCostMultiplier != null) ? rules.highCostMultiplier : 2.5;
        const mult = basis < thr ? lowMul : highMul;
        const policyCap = basis * mult;
        const cap = Math.max(floor, policyCap);
        return Math.round(cap * 100) / 100;
    }

    /** 价格透传（已取消合规硬控，不再自动压价） */
    _clampListingPrice(productId, qualityGrade, price) {
        let p = Number(price);
        if (!isFinite(p) || p < 0.01) p = 0.01;
        return { finalPrice: Math.round(p * 100) / 100, capped: false, cap: Infinity };
    }

    /** 改价入口：直接写入，不再按合规上限压价 */
    setListingPrice(listingId, newPrice) {
        const listing = this.state.listings.find(l => l.id === listingId);
        if (!listing) return { success: false, message: '商品不存在', finalPrice: 0, capped: false };
        const r = this._clampListingPrice(listing.productId, listing.qualityGrade || 'B', newPrice);
        listing.price = r.finalPrice;
        listing.priceClamped = false;
        listing.weight = this.calculateWeight(listing);
        this.notify();
        return { success: true, finalPrice: r.finalPrice, capped: false, cap: r.cap };
    }

    /**
     * 动态建议售价：等同 getSuggestedSellPrice（按行情 + 供需）。
     */
    calculateDynamicSellingPrice(productId, qualityGrade = 'B') {
        return this.getSuggestedSellPrice(productId, qualityGrade);
    }

    /**
     * 市场行情情绪（按天缓存）。
     * 返回 { day, demand, supply, suggested, capPrice2x, avgCost, basePrice }
     */
    getMarketSentiment(productId, qualityGrade = 'B') {
        if (!this.state.market) this.state.market = { lastUpdateDay: 0, snapshots: {}, sentimentByProduct: {} };
        if (!this.state.market.sentimentByProduct) this.state.market.sentimentByProduct = {};
        const day = this.state.gameTime ? this.state.gameTime.day : 0;
        const cacheKey = productId + '|' + (qualityGrade || 'B');
        const cached = this.state.market.sentimentByProduct[cacheKey];
        if (cached && cached.day === day) return cached;

        const product = (typeof getProductById === 'function') ? getProductById(productId)
            : ((typeof PRODUCTS !== 'undefined') ? PRODUCTS.find(p => p.id === productId) : null);
        const basePrice = (product && product.basePrice) || 10;
        const avgCost = this.getAverageCost(productId, qualityGrade);
        const suggested = this.getSuggestedSellPrice(productId, qualityGrade);
        const capPrice2x = this.getMaxAllowedPrice(productId, qualityGrade);
        const stock = this.getInventoryQuantity(productId, qualityGrade);

        // 供给：库存越少越紧张（0~1，低库存→小）
        let supply = 0.55;
        if (stock <= 0) supply = 0.15;
        else if (stock < 5) supply = 0.25;
        else if (stock < 20) supply = 0.4;
        else if (stock < 50) supply = 0.55;
        else if (stock < 100) supply = 0.7;
        else supply = 0.85;

        // 需求：结合品类基础热度 + 轻微日波动（稳定可复现）
        const catBoost = (product && product.category === 'digital') ? 0.08
            : (product && product.category === 'beauty') ? 0.05 : 0;
        const dayWave = ((day * 17 + (productId || '').length * 13) % 100) / 1000; // 0~0.1
        let demand = Math.min(0.95, Math.max(0.2, 0.5 + catBoost + dayWave));

        const result = {
            day: day,
            demand: +demand.toFixed(3),
            supply: +supply.toFixed(3),
            suggested: suggested,
            capPrice2x: capPrice2x,
            avgCost: Math.round((avgCost || 0) * 100) / 100,
            basePrice: basePrice
        };
        this.state.market.sentimentByProduct[cacheKey] = result;
        return result;
    }

    /**
     * 高价值商品：重点品类(digital/beauty)阈值 500×0.7=350，其余 ≥500。
     */
    isHighValueProduct(productIdOrProduct) {
        const product = (typeof productIdOrProduct === 'object' && productIdOrProduct)
            ? productIdOrProduct
            : ((typeof getProductById === 'function') ? getProductById(productIdOrProduct)
                : ((typeof PRODUCTS !== 'undefined') ? PRODUCTS.find(p => p.id === productIdOrProduct) : null));
        if (!product) return false;
        const base = product.basePrice || 0;
        const focus = product.category === 'digital' || product.category === 'beauty';
        const threshold = focus ? 500 * 0.7 : 500;
        return base >= threshold;
    }

    /**
     * 高价值客群：等级≥3 或 累计消费≥3000 或 (订单≥10 且 客单价≥200)
     * 参数可为会员对象 / 会员名 / 会员id
     */
    isHighValueCustomer(memberOrName) {
        let m = memberOrName;
        if (typeof memberOrName === 'string') {
            m = (this.state.members.list || []).find(x => x.name === memberOrName || x.id === memberOrName);
        }
        if (!m) return false;
        if ((m.level || 1) >= 3) return true;
        if ((m.spent || 0) >= 3000) return true;
        const orders = m.orderCount || 0;
        const aov = orders > 0 ? (m.spent || 0) / orders : 0;
        if (orders >= 10 && aov >= 200) return true;
        return false;
    }

    /** 高价值客群评分 0~1（供匹配加成/展示） */
    getHighValueCustomerScore(memberOrName) {
        let m = memberOrName;
        if (typeof memberOrName === 'string') {
            m = (this.state.members.list || []).find(x => x.name === memberOrName || x.id === memberOrName);
        }
        if (!m) return 0;
        if (!this.isHighValueCustomer(m)) {
            // 非高价值：给一个很低的基础分
            const lvl = Math.min(1, (m.level || 1) / 10);
            const spend = Math.min(1, (m.spent || 0) / 5000);
            return Math.round((lvl * 0.3 + spend * 0.3) * 100) / 100;
        }
        const levelScore = Math.min(1, ((m.level || 1) - 1) / 4);          // 1→0, 5→1
        const spendScore = Math.min(1, (m.spent || 0) / 10000);
        const orderScore = Math.min(1, (m.orderCount || 0) / 40);
        const score = 0.35 + levelScore * 0.3 + spendScore * 0.25 + orderScore * 0.1;
        return Math.round(Math.min(1, score) * 100) / 100;
    }

    // 商品上架
    addListing(listing) {
        listing.id = generateId('list');
        listing.createTime = { ...this.state.gameTime };
        listing.sales = 0;
        listing.views = 0;
        // 售价不再做合规硬控（可自由定价）
        if (listing.productId != null && listing.price != null) {
            const r = this._clampListingPrice(listing.productId, listing.qualityGrade || 'B', listing.price);
            listing.price = r.finalPrice;
            listing.priceClampedOnCreate = false;
        }
        listing.reviews = Array.isArray(listing.reviews) ? listing.reviews : [];
        if (typeof listing.rating !== 'number' || isNaN(listing.rating)) listing.rating = 5.0;
        listing.weight = this.calculateWeight(listing);
        this.state.listings.push(listing);
        this.notify();
    }

    updateListing(listingId, updates) {
        const listing = this.state.listings.find(l => l.id === listingId);
        if (listing) {
            const next = Object.assign({}, updates);
            if (next.price != null) {
                const r = this._clampListingPrice(listing.productId, next.qualityGrade || listing.qualityGrade || 'B', next.price);
                next.price = r.finalPrice;
                next.priceClamped = false;
            }
            Object.assign(listing, next);
            listing.weight = this.calculateWeight(listing);
            this.notify();
        }
    }

    calculateWeight(listing) {
        let weight = 50;
        weight += Math.min(40, (listing.sales || 0) * 0.5);
        weight += (listing.rating || 5) * 5;
        const gap = Math.abs(listing.price - (listing.suggestedPrice || listing.price));
        weight -= Math.min(15, gap * 0.1);
        // 店铺等级权重：等级越高商品越靠前
        const lv = this.getCurrentLevel() || {};
        weight += Number(lv.weightBonus) || 0;
        // 高价商品（售价或成本价≥5000）明确加权，确保推广有曝光
        const product = (typeof getProductById === 'function')
            ? getProductById(listing.productId)
            : ((typeof PRODUCTS !== 'undefined') ? PRODUCTS.find(p => p.id === listing.productId) : null);
        const price = Number(listing.price) || 0;
        const base = Number(product && product.basePrice) || 0;
        if (price >= 5000 || base >= 5000) {
            weight += 25;
        } else if (price >= 2000 || base >= 2000) {
            weight += 12;
        }
        return Math.min(180, Math.max(0, weight));
    }

    /**
     * 商品回收：按成本 5~7 折回收库存（随机折扣），扣库存并回款
     */
    recycleInventory(productId, qualityGrade = 'B', quantity = 1) {
        const qty = Math.max(1, parseInt(quantity, 10) || 1);
        const have = this.getInventoryQuantity(productId, qualityGrade);
        if (have <= 0) return { success: false, message: '该商品无库存可回收' };
        const take = Math.min(qty, have);
        const avgCost = this.getAverageCost(productId, qualityGrade) || 0;
        if (!(avgCost > 0)) return { success: false, message: '无法估价，暂不能回收' };
        const discount = 0.5 + Math.random() * 0.2; // 5~7折
        const unitBuyback = Math.round(avgCost * discount * 100) / 100;
        const total = Math.round(unitBuyback * take * 100) / 100;
        const removed = this.removeInventory(productId, take, qualityGrade, {
            note: '商品回收出库'
        });
        if (!removed) return { success: false, message: '扣库存失败' };
        this.addFunds(total, `商品回收（${Math.round(discount * 10)}折×${take}）`);
        // 库存清空且有上架时，提示可下架（不自动下架，尊重玩家）
        const left = this.getInventoryQuantity(productId, qualityGrade);
        this.notify();
        return {
            success: true,
            quantity: take,
            discount,
            unitBuyback,
            total,
            remaining: left,
            message: `已回收 ${take} 件，到账 ¥${total.toFixed(2)}（${(discount * 10).toFixed(1)}折）`
        };
    }

    /** 一键下架在售 listing */
    delistListing(listingId) {
        const listing = (this.state.listings || []).find(l => l.id === listingId);
        if (!listing) return { success: false, message: '商品不存在' };
        listing.status = 'offline';
        listing.offlineTime = { day: this.state.gameTime.day, hour: this.state.gameTime.hour };
        this.notify();
        return { success: true, message: '已下架' };
    }

    // 订单操作
    getMaxOrdersPerDay() {
        const cfg = (typeof SHOP_CONFIG !== 'undefined' && SHOP_CONFIG) ? SHOP_CONFIG : null;
        const n = cfg && cfg.maxOrdersPerDay != null ? Number(cfg.maxOrdersPerDay) : 1000;
        return (n > 0 && isFinite(n)) ? Math.floor(n) : 1000;
    }

    /** 当日已生成订单数（新单计数，跨天自动归零） */
    getTodayOrderCount() {
        const day = (this.state.gameTime && this.state.gameTime.day) || 1;
        if (this.state.shop && this.state.shop._ordersTodayDay === day) {
            return Math.max(0, Number(this.state.shop._ordersToday) || 0);
        }
        let count = 0;
        try {
            const daily = (this.state.finance && this.state.finance.dailyStats)
                ? this.state.finance.dailyStats.find(d => d && d.day === day)
                : null;
            if (daily && typeof daily.orders === 'number') count = daily.orders;
        } catch (_) {}
        if (this.state.shop) {
            this.state.shop._ordersTodayDay = day;
            this.state.shop._ordersToday = count;
        }
        return Math.max(0, count);
    }

    /** 订单无限制：不再设每日订单上限（仅保留积压性能闸门，见 gameEngine） */
    getRemainingDailyOrderQuota() {
        return 999999999;
    }

    /** 无推广日：每天随机一个自然单上限（已停用限制，仅保留函数供日志/兼容） */
    ensureOrganicDailyCap() {
        const day = (this.state.gameTime && this.state.gameTime.day) || 1;
        const shop = this.state.shop || (this.state.shop = {});
        if (shop._organicCapDay === day && shop._organicDailyCap > 0) {
            return shop._organicDailyCap;
        }
        const gating = (typeof TRAFFIC_GATING !== 'undefined' && TRAFFIC_GATING) ? TRAFFIC_GATING : {};
        let min = Number(gating.organicOrdersPerDayMin);
        let max = Number(gating.organicOrdersPerDayMax);
        if (!(min > 0)) min = 4;
        if (!(max >= min)) max = 20;
        min = Math.floor(min);
        max = Math.floor(max);
        shop._organicDailyCap = min + Math.floor(Math.random() * (max - min + 1));
        shop._organicCapDay = day;
        return shop._organicDailyCap;
    }

    getOrganicOrdersToday() {
        const day = (this.state.gameTime && this.state.gameTime.day) || 1;
        return (this.state.orders || []).filter(o => {
            if (!o || o.status === 'cancelled') return false;
            const d = (o.createTime && o.createTime.day) || 0;
            if (d !== day) return false;
            if (o.trafficSource === 'promo' || o.fromLivestream || o.marketingCampaignSource) return false;
            if (this._isLuxuryOrder(o)) return false;
            return true;
        }).length;
    }

    /**
     * 无推广时自然单受每日软顶；开了投放/促销/代言后走 promo，不再卡日上限。
     */
    getOrderGenerationQuota(source = 'organic') {
        if (source === 'promo') return 999999999;
        const cap = this.ensureOrganicDailyCap();
        const used = this.getOrganicOrdersToday();
        return Math.max(0, cap - used);
    }

    ensureLuxuryDailyCap() {
        const day = (this.state.gameTime && this.state.gameTime.day) || 1;
        const shop = this.state.shop || (this.state.shop = {});
        if (shop._luxuryCapDay === day && shop._luxuryDailyCap > 0) {
            return shop._luxuryDailyCap;
        }
        shop._luxuryDailyCap = 2 + Math.floor(Math.random() * 4); // 2~5
        shop._luxuryCapDay = day;
        return shop._luxuryDailyCap;
    }

    getLuxuryOrdersToday() {
        const day = (this.state.gameTime && this.state.gameTime.day) || 1;
        return (this.state.orders || []).filter(o => {
            if (!o || o.status === 'cancelled') return false;
            const d = (o.createTime && o.createTime.day) || 0;
            if (d !== day) return false;
            if (o.trafficSource === 'promo' || o.fromLivestream || o.marketingCampaignSource) return false;
            return this._isLuxuryOrder(o);
        }).length;
    }

    _isLuxuryOrder(o) {
        if (!o) return false;
        if ((Number(o.unitPrice) || 0) >= 5000 || (Number(o.totalAmount) || 0) >= 5000) return true;
        try {
            const p = (typeof getProductById === 'function') ? getProductById(o.productId) : null;
            if (p && (p.category === 'luxury' || (p.basePrice || 0) >= 5000)) return true;
        } catch (_) {}
        return false;
    }

    getLuxuryOrderQuota() {
        const cap = this.ensureLuxuryDailyCap();
        const used = this.getLuxuryOrdersToday();
        return Math.max(0, cap - used);
    }

    addOrder(order) {
        order.id = generateId('ord');
        order.createTime = { ...this.state.gameTime };
        order.status = 'pending_payment';
        order.packed = order.packed || false;
        order.shipped = order.shipped || false;
        order.hidden = false;
        // 初始化状态历史
        if (!order.statusHistory || order.statusHistory.length === 0) {
            order.statusHistory = [{
                status: 'pending_payment',
                day: this.state.gameTime.day,
                hour: this.state.gameTime.hour
            }];
        }
        this.state.orders.push(order);
        try {
            if (typeof OrderPerf !== 'undefined' && OrderPerf.onAdded) OrderPerf.onAdded(order);
        } catch (_) {}
        try {
            if (typeof ui !== 'undefined' && ui && typeof ui.invalidateOrderCounts === 'function') ui.invalidateOrderCounts();
        } catch (_) {}
        this.state.shop.totalOrders++;
        try {
            if (!this.state.statistics) this.state.statistics = {};
            const dayNow = (this.state.gameTime && this.state.gameTime.day) || 1;
            if (this.state.statistics._viewsDay !== dayNow) {
                this.state.statistics.todayViews = 0;
                this.state.statistics._viewsDay = dayNow;
            }
            // 进店漏斗：多数人只逛不买。每成交一单，额外记一批未转化浏览
            const extraViews = 12 + Math.floor(Math.random() * 16);
            this.state.statistics.totalViews = (this.state.statistics.totalViews || 0) + extraViews;
            this.state.statistics.todayViews = (this.state.statistics.todayViews || 0) + extraViews;
        } catch (_) {}
        // 累计当天订单数
        const day = this.state.gameTime.day;
        let daily = this.state.finance.dailyStats.find(d => d.day === day);
        if (!daily) {
            daily = {
                day, orders: 0, sales: 0, profit: 0, cost: 0,
                income_sales: 0, income_other: 0,
                expense_purchase: 0, expense_express: 0, expense_packaging: 0,
                expense_platform: 0,
                expense_salary: 0, expense_marketing: 0, expense_penalty: 0,
                expense_upgrade: 0, expense_other: 0,
            };
            this.state.finance.dailyStats.push(daily);
        }
        daily.orders++;
        if (this.state.shop._ordersTodayDay !== day) {
            this.state.shop._ordersTodayDay = day;
            this.state.shop._ordersToday = 0;
        }
        this.state.shop._ordersToday = (Number(this.state.shop._ordersToday) || 0) + 1;
        this.notify();
        return { success: true, order };
    }

    updateOrderStatus(orderId, status, orderRef = null) {
        // orderRef：调用方已持有订单对象时传入，避免爆单时反复 O(n) find
        let order = orderRef;
        if (!order) {
            try {
                if (typeof OrderPerf !== 'undefined' && OrderPerf.getById) {
                    order = OrderPerf.getById(orderId, this.state.orders);
                }
            } catch (_) {}
            if (!order) order = this.state.orders.find(o => o.id === orderId);
        }
        if (order) {
            const prevStatus = order.status;
            order.status = status;
            try {
                if (typeof OrderPerf !== 'undefined' && OrderPerf.onStatusChanged) {
                    OrderPerf.onStatusChanged(order, prevStatus, status);
                }
            } catch (_) {}
            try {
                if (typeof ui !== 'undefined' && ui && typeof ui.invalidateOrderCounts === 'function') ui.invalidateOrderCounts();
            } catch (_) {}
            order.statusHistory = order.statusHistory || [];
            // 避免重复记录相同状态
            const lastStatus = order.statusHistory[order.statusHistory.length - 1];
            if (!lastStatus || lastStatus.status !== status) {
                order.statusHistory.push({
                    status: status,
                    day: this.state.gameTime.day,
                    hour: this.state.gameTime.hour
                });
            }
            // ===== 新增：状态变更时自动设置关键时间戳 + UI隐藏策略 =====
            const now = { day: this.state.gameTime.day, hour: this.state.gameTime.hour };
            // 取消订单 → 统一写 cancelTime（无论哪里触发的取消，确保 processOrderUpdates 能按小时判断自动隐藏）
            if (status === 'cancelled' && !order.cancelTime) {
                order.cancelTime = { ...now };
            }
            // 已完成（签收/确认收货）→ 立即隐藏（UI列表直接清零，不再等7天）
            // 退换货/统计系统只依赖 status==='completed'，不依赖 !hidden，所以不会影响
            if (status === 'completed') {
                if (!order.completeTime) order.completeTime = { ...now };
                if (!order.hidden) {
                    order.hidden = true;
                    order.hiddenTime = { ...now };
                }
                // ===== 累计统计：订单裁剪后成就/销量仍准确 =====
                if (prevStatus !== 'completed') {
                    try {
                        const cum = this._ensureCumulativeStats();
                        cum.completedOrders += 1;
                        cum.completedSales += Number(order.totalAmount) || 0;
                        const g = order.qualityGrade || '';
                        if (g === 'A') cum.aGrade += 1;
                        else if (g === 'C') cum.cGrade += 1;
                    } catch (_) {}
                }
                // 预约买家评价（快递签收 / 旧物流 / 其它完成入口统一走这里）
                if (!order.review && !order.reviewGenerated && !order.reviewScheduled) {
                    order.reviewScheduled = true;
                    order.reviewTime = { day: now.day + 1, hour: now.hour };
                }
            }
            // 已退货 → 也自动隐藏（用户没提但合理，避免列表堆）
            if (status === 'returned' && !order.hidden) {
                order.hidden = true;
                order.hiddenTime = { ...now };
            }
            this.notify();
        }
    }

    // 获取订单配置
    getOrderConfig() {
        if (!this.state.orderConfig) {
            this.state.orderConfig = {
                completedRetentionDays: 7,
                autoCleanEnabled: true,
                cleanMode: 'hide',
                lastCleanupDay: 0,
                cleanupLogs: [],
                // 待付款超时自动取消（单位：分钟，默认 15 分钟）
                pendingPaymentTimeout: 15
            };
        } else if (this.state.orderConfig.pendingPaymentTimeout == null
            || this.state.orderConfig.pendingPaymentTimeout === 24
            || this.state.orderConfig.pendingPaymentTimeout === 1) {
            // 旧档语义为小时（24 小时 / 1 小时）→ 统一迁移为新单位「15 分钟」
            this.state.orderConfig.pendingPaymentTimeout = 15;
        }
        return this.state.orderConfig;
    }

    // 更新订单配置
    updateOrderConfig(newConfig) {
        const cfg = this.getOrderConfig();
        Object.assign(cfg, newConfig);
        this.notify();
        return cfg;
    }

    // 支付订单（待付款→待打包）
    payOrder(orderId) {
        const order = this.state.orders.find(o => o.id === orderId);
        if (!order) return { success: false, reason: '订单不存在' };
        if (order.status !== 'pending_payment') return { success: false, reason: '订单状态不是待付款' };
        
        this.updateOrderStatus(orderId, 'pending_packing');
        order.paymentTime = { ...this.state.gameTime };
        this.notify();
        return { success: true };
    }

    // 取消待付款订单（订单无限制：取消率硬顶已停用）
    cancelPendingOrder(orderId) {
        const order = this.state.orders.find(o => o.id === orderId);
        if (!order) return { success: false, reason: '订单不存在' };
        if (order.status !== 'pending_payment') return { success: false, reason: '订单状态不是待付款' };
        
        this.updateOrderStatus(orderId, 'cancelled');
        order.cancelTime = { ...this.state.gameTime };
        order.cancelReason = '用户取消';
        this.notify();
        return { success: true };
    }

    // 清理超时未付款订单（nowOverride 供引擎在整点内以 15/30/45 分虚拟时刻多次判定）
    cleanupTimeoutPendingPayments(nowOverride) {
        const cfg = this.getOrderConfig();
        const now = nowOverride || this.state.gameTime;
        const timeoutMinutes = cfg.pendingPaymentTimeout || 15;
        let cancelledCount = 0;
        const cancelledIds = [];

        // ===== 爆单性能：优先只遍历待付款桶（OrderPerf），状态匹配时立即处理 =====
        const orders = this.state.orders;
        let pool = null;
        try {
            if (typeof OrderPerf !== 'undefined' && OrderPerf.enabled && OrderPerf.getStatusBucket) {
                OrderPerf.ensure(orders);
                if (!OrderPerf.dirty && OrderPerf.ordersRef === orders) {
                    pool = OrderPerf.getStatusBucket('pending_payment');
                }
            }
        } catch (_) { pool = null; }
        const list = pool || orders;
        // 爆单性能：单次清理上限（摊平到多个小时，避免几百单集中取消卡顿；与 processOrderUpdates 的分片哲学一致）
        const maxCancelPerCall = (orders && orders.length > 2500) ? 120 : 200;
        // 从尾部向前遍历（元素被移出桶时不破坏前面的索引）
        for (let i = list.length - 1; i >= 0; i--) {
            const order = list[i];
            if (!order) continue;
            if (order.status !== 'pending_payment' || !order.createTime) continue;
            // 分钟级超时比较（订单创建时间无 minute 时视为整点 0 分）
            const minutesPassed = (now.day - order.createTime.day) * 1440
                + ((now.hour || 0) - (order.createTime.hour || 0)) * 60
                + ((now.minute || 0) - (order.createTime.minute || 0));
            if (minutesPassed >= timeoutMinutes) {
                // 订单无限制：超时直接取消，不再受取消率硬顶约束
                this.updateOrderStatus(order.id, 'cancelled');
                order.cancelTime = { ...now };
                order.cancelReason = '超时未付款自动取消';
                cancelledCount++;
                cancelledIds.push(order.id);
                if (cancelledCount >= maxCancelPerCall) break;
            }
        }

        if (cancelledCount > 0) {
            cfg.cleanupLogs.unshift({
                time: { day: now.day, hour: now.hour },
                timestamp: Date.now(),
                type: 'pending_payment_timeout',
                count: cancelledCount,
                orderIds: cancelledIds.slice(0, 20)
            });
            if (cfg.cleanupLogs.length > 100) cfg.cleanupLogs = cfg.cleanupLogs.slice(0, 100);
            this.notify();
        }

        return { success: true, cancelledCount, cancelledIds };
    }

    // 清理超期已完成订单
    // 信誉分
    addReputation(amount) {
        this.state.shop.reputation += amount;
        this.checkLevelUp();
        this.notify();
    }

    checkLevelUp() {
        // 店铺升级改为手动付费+销量门槛，不再靠信誉自动跳级
        return false;
    }

    /** 累计销量件数（用于店铺升级门槛） */
    getTotalSoldQuantity() {
        const fromShop = Number(this.state.shop && this.state.shop.totalSales) || 0;
        if (fromShop > 0) return fromShop;
        const listings = this.state.listings || [];
        return listings.reduce((s, l) => s + (Number(l.sales) || 0), 0);
    }

    /** 下一等级配置；已满级返回 null */
    getNextShopLevel() {
        const cur = this.state.shop.level || 1;
        return SHOP_LEVELS.find(l => l.level === cur + 1) || null;
    }

    /**
     * 手动升级店铺：交升级费 + 达到累计销量件数
     */
    upgradeShopLevel() {
        const next = this.getNextShopLevel();
        if (!next) return { success: false, message: '已达最高等级' };
        const soldQty = this.getTotalSoldQuantity();
        const needQty = Number(next.minSalesQty) || 0;
        if (needQty > 0 && soldQty < needQty) {
            return {
                success: false,
                message: `销量不足：需累计售出 ${needQty} 件，当前 ${soldQty} 件`
            };
        }
        const fee = Number(next.upgradeFee) || 0;
        if (fee > 0) {
            const ok = this.spendFunds(fee, `店铺升级至${next.name}`);
            if (!ok) {
                return { success: false, message: `资金不足，升级需支付 ¥${fee.toLocaleString()}` };
            }
        }
        this.state.shop.level = next.level;
        if (next.overseas) {
            this.state.shop.overseasUnlocked = true;
            if (!this.state.overseas) this.state.overseas = {
                unlocked: true, shipments: [], inquiries: [], orders: [],
                pendingSettlements: [], regulations: [],
                stats: { exportRevenue: 0, shipmentCount: 0, dutyPaid: 0, freightPaid: 0 }
            };
            this.state.overseas.unlocked = true;
        }
        // 店铺升级后：仓库至少升到同级，拥有同等级仓库空间
        let warehouseSynced = false;
        try {
            if (this.warehouse && typeof this.warehouse.ensureLevelAtLeast === 'function') {
                const sync = this.warehouse.ensureLevelAtLeast(next.level);
                warehouseSynced = !!(sync && sync.changed);
            } else if (this.state.warehouse) {
                const curWh = this.state.warehouse.level || 1;
                if (next.level > curWh) {
                    const info = (typeof WAREHOUSE_LEVELS !== 'undefined')
                        ? WAREHOUSE_LEVELS.find(w => w.level === next.level)
                        : null;
                    this.state.warehouse.level = next.level;
                    if (info) {
                        this.state.warehouse.capacity = info.capacity + (this.state.warehouse.startCapacityBonus || 0);
                    }
                    warehouseSynced = true;
                }
            }
        } catch (_) {}
        // 升级后刷新在售权重
        (this.state.listings || []).forEach(l => {
            if (l) l.weight = this.calculateWeight(l);
        });
        try {
            if (!this.state.player) this.state.player = {};
            if (!this.state.player.attributes) {
                this.state.player.attributes = { operation: 1, selection: 1, negotiation: 1, management: 1, luck: 1 };
            }
            this.state.player.attributePoints = (Number(this.state.player.attributePoints) || 0) + 2;
        } catch (_) {}
        this.notify();
        const extra = warehouseSynced ? `，仓库已同步至 Lv.${next.level}` : '';
        return { success: true, level: next.level, name: next.name, fee, message: `已升级为${next.name}${extra}，获得 2 点角色属性` };
    }

    getCurrentLevel() {
        return SHOP_LEVELS.find(l => l.level === this.state.shop.level) || SHOP_LEVELS[0];
    }

    /** 兼容旧档：补齐注册主体 / 品牌标识 / 法务赔偿统计 */
    ensureShopMeta() {
        if (!this.state || !this.state.shop) return;
        const shop = this.state.shop;
        if (!shop.entityType) shop.entityType = 'individual';
        if (!shop.brandBadge) shop.brandBadge = 'normal';
        if (!Array.isArray(shop.unlockedBrandBadges) || !shop.unlockedBrandBadges.length) {
            shop.unlockedBrandBadges = ['normal'];
            if (shop.brandBadge && shop.unlockedBrandBadges.indexOf(shop.brandBadge) < 0) {
                shop.unlockedBrandBadges.push(shop.brandBadge);
            }
        }
        if (typeof shop.legalCompensationMonth !== 'number') shop.legalCompensationMonth = 0;
        if (typeof shop.legalCompensationTotal !== 'number') shop.legalCompensationTotal = 0;
        if (typeof shop.platformBanUntilDay !== 'number') shop.platformBanUntilDay = 0;
        if (typeof shop.lastOpsRiskCheckDay !== 'number') shop.lastOpsRiskCheckDay = 0;
        if (!this.state.warehouse) this.state.warehouse = {};
        if (!this.state.warehouse.city) this.state.warehouse.city = 'yiwu';
        if (!shop.city) shop.city = this.state.warehouse.city || 'yiwu';
        try { this._ensurePlayerAttrs(); } catch (_) {}
    }

    setShopEntityType(typeId) {
        this.ensureShopMeta();
        const list = (typeof SHOP_ENTITY_TYPES !== 'undefined') ? SHOP_ENTITY_TYPES : [];
        const hit = list.find(e => e.id === typeId);
        if (!hit) return { success: false, message: '无效的注册类型' };
        // 仅允许从默认个人改为其他，或保持当前；已设为公司后不可再降级（简化）
        const cur = this.state.shop.entityType || 'individual';
        if (cur !== 'individual' && typeId !== cur) {
            return { success: false, message: '注册类型一经确定不可随意变更' };
        }
        this.state.shop.entityType = typeId;
        this.notify();
        return { success: true, entityType: typeId, name: hit.name, message: `已登记为「${hit.name}」` };
    }

    getBrandBadgeInfo() {
        this.ensureShopMeta();
        const id = this.state.shop.brandBadge || 'normal';
        if (typeof getBrandBadgeById === 'function') return getBrandBadgeById(id);
        const list = (typeof BRAND_BADGES !== 'undefined') ? BRAND_BADGES : [];
        return list.find(b => b.id === id) || { id: 'normal', name: '普通', icon: '🏷️' };
    }

    unlockBrandBadge(badgeId) {
        this.ensureShopMeta();
        const list = (typeof BRAND_BADGES !== 'undefined') ? BRAND_BADGES : [];
        const badge = list.find(b => b.id === badgeId);
        if (!badge) return { success: false, message: '无效的品牌标识' };
        const shop = this.state.shop;
        if (!Array.isArray(shop.unlockedBrandBadges) || !shop.unlockedBrandBadges.length) {
            shop.unlockedBrandBadges = ['normal'];
            if (shop.brandBadge && shop.unlockedBrandBadges.indexOf(shop.brandBadge) < 0) {
                shop.unlockedBrandBadges.push(shop.brandBadge);
            }
        }
        const already = shop.unlockedBrandBadges.indexOf(badge.id) >= 0;
        if (!already && badge.fee > 0) {
            if (!this.spendFunds(badge.fee, `缴纳品牌金「${badge.name}」`)) {
                return { success: false, message: `资金不足，需缴纳品牌金 ¥${badge.fee.toLocaleString()}` };
            }
            shop.unlockedBrandBadges.push(badge.id);
        } else if (!already) {
            shop.unlockedBrandBadges.push(badge.id);
        }
        shop.brandBadge = badge.id;
        this.notify();
        const payHint = (!already && badge.fee > 0)
            ? `已缴纳 ¥${badge.fee.toLocaleString()} 并启用「${badge.name}」`
            : `已启用「${badge.name}」品牌标识`;
        return { success: true, badge: badge.id, message: payHint };
    }

    // 获取可用批发商
    getAvailableSuppliers() {
        return SUPPLIERS.filter(s => s.unlockLevel <= this.state.shop.level);
    }

    // 获取可用明星
    getAvailableCelebrities() {
        return CELEBRITIES.filter(c => c.unlockLevel <= this.state.shop.level);
    }

    _findListingForOrder(order) {
        if (!order) return null;
        const list = this.state.listings || [];
        if (order.listingId) {
            const byId = list.find(l => l && l.id === order.listingId);
            if (byId) return byId;
        }
        if (order.productId) {
            const grade = order.qualityGrade;
            return list.find(l => l && l.productId === order.productId && (!grade || l.qualityGrade === grade))
                || list.find(l => l && l.productId === order.productId)
                || null;
        }
        return null;
    }

    _recomputeListingRating(listing) {
        if (!listing) return;
        const reviews = Array.isArray(listing.reviews) ? listing.reviews : [];
        listing.reviews = reviews;
        if (!reviews.length) {
            if (typeof listing.rating !== 'number' || isNaN(listing.rating)) listing.rating = 5.0;
            return;
        }
        const sum = reviews.reduce((s, r) => s + (Number(r && r.rating) || 0), 0);
        listing.rating = parseFloat((sum / reviews.length).toFixed(1));
        try { listing.weight = this.calculateWeight(listing); } catch (_) {}
    }

    _pushListingReview(listing, rating, content, day) {
        if (!listing) return;
        listing.reviews = listing.reviews || [];
        listing.reviews.push({
            rating: Math.max(1, Math.min(5, Math.round(Number(rating) || 5))),
            content: content || '默认好评',
            day: day || (this.state.gameTime && this.state.gameTime.day) || 1
        });
        if (listing.reviews.length > 60) listing.reviews = listing.reviews.slice(-60);
        this._recomputeListingRating(listing);
    }

    /** 读档补商品分：订单/店铺累计评价写回上架商品；已有销量但无评的补默认评价 */
    _hydrateListingRatings() {
        try {
            const listings = this.state.listings || [];
            if (!listings.length) return;
            const byId = new Map(listings.map(l => [l.id, l]));
            listings.forEach(l => {
                if (!l) return;
                if (!Array.isArray(l.reviews)) l.reviews = [];
            });
            (this.state.orders || []).forEach(o => {
                if (!o || !o.review) return;
                const listing = this._findListingForOrder(o);
                if (!listing) return;
                const day = (o.review.day != null) ? o.review.day : ((o.completeTime && o.completeTime.day) || 0);
                const exists = listing.reviews.some(r => r && r.day === day && r.rating === o.review.rating && (r.content || '') === (o.review.content || ''));
                if (!exists) this._pushListingReview(listing, o.review.rating, o.review.content, day);
            });
            const recent = this.state.statistics && this.state.statistics._cum && this.state.statistics._cum.recentReviews;
            if (Array.isArray(recent)) {
                recent.forEach(item => {
                    if (!item || !item.review || !item.listingId) return;
                    const listing = byId.get(item.listingId);
                    if (!listing) return;
                    const day = item.review.day || 0;
                    const exists = listing.reviews.some(r => r && r.day === day && r.rating === item.review.rating);
                    if (!exists) this._pushListingReview(listing, item.review.rating, item.review.content, day);
                });
            }
            listings.forEach(l => {
                if (!l) return;
                if (l.reviews.length) {
                    this._recomputeListingRating(l);
                    return;
                }
                const sold = Number(l.sales) || 0;
                if (sold <= 0) {
                    l.rating = (typeof l.rating === 'number' && !isNaN(l.rating)) ? l.rating : 5.0;
                    return;
                }
                const n = Math.min(12, Math.max(2, Math.round(Math.min(sold, 20) * 0.5)));
                const grade = l.qualityGrade || 'B';
                const base = grade === 'A' ? 5 : (grade === 'C' ? 4 : 5);
                const day = (this.state.gameTime && this.state.gameTime.day) || 1;
                for (let i = 0; i < n; i++) {
                    const rating = Math.max(3, Math.min(5, base - (Math.random() < 0.2 ? 1 : 0)));
                    this._pushListingReview(l, rating, '默认好评', Math.max(1, day - i));
                }
            });
        } catch (_) {}
    }

    // 添加评价
    addReview(orderId, rating, content) {
        const order = this.state.orders.find(o => o.id === orderId);
        if (order) {
            order.review = { rating, content, day: this.state.gameTime.day };
            this._pushListingReview(
                this._findListingForOrder(order),
                rating,
                content,
                this.state.gameTime.day
            );
            
            // ===== 累计统计：评价永久计数（订单裁剪后不丢失，店铺分不漂移）=====
            const cum = this._ensureCumulativeStats();
            const r = Math.max(1, Math.min(5, Math.round(Number(rating) || 0)));
            cum.ratingSum += r;
            cum.ratingCount += 1;
            cum.dist[r] = (cum.dist[r] || 0) + 1;
            if (r >= 4) cum.goodReviews += 1;
            else if (r === 3) { /* 中评不计入好评/差评 */ }
            else cum.badReviews += 1;
            cum.recentReviews.unshift({
                buyerName: order.buyerName || '匿名买家',
                productName: order.productName || '',
                listingId: order.listingId || null,
                review: { rating: r, content: content || '', day: this.state.gameTime.day }
            });
            if (cum.recentReviews.length > 120) cum.recentReviews.length = 120;
            
            this.updateShopRating();
            this.notify();
        }
    }

    /** 确保累计统计对象存在（挂 statistics._cum，随主存档持久化） */
    _ensureCumulativeStats() {
        const stats = this.state.statistics || (this.state.statistics = {});
        if (!stats._cum || typeof stats._cum !== 'object') {
            stats._cum = {
                completedOrders: 0, completedSales: 0,
                goodReviews: 0, badReviews: 0,
                aGrade: 0, cGrade: 0,
                ratingSum: 0, ratingCount: 0,
                dist: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
                recentReviews: []
            };
        }
        return stats._cum;
    }

    /** 读档一次性回填：旧存档没有累计统计时，从现有订单扫一遍补齐（此后不再依赖订单留存） */
    /** 旧档把浏览量垫成=订单数，读档时按漏斗补一截「只看不买」 */
    _repairViewOrderFunnel() {
        try {
            const stats = this.state.statistics || (this.state.statistics = {});
            if (stats._viewFunnelFixed) return;
            const orders = Number(this.state.shop && this.state.shop.totalOrders) || 0;
            const views = Number(stats.totalViews) || 0;
            if (orders > 0 && views <= orders * 1.35) {
                stats.totalViews = Math.max(views, Math.round(orders * (16 + Math.random() * 8)));
            }
            stats._viewFunnelFixed = true;
        } catch (_) {}
    }

    _backfillCumulativeStats() {
        try {
            if (!this.state || !this.state.statistics) return;
            if (this.state.statistics._cum) return;
            const cum = this._ensureCumulativeStats();
            (this.state.orders || []).forEach(o => {
                if (!o) return;
                if (o.status === 'completed') {
                    cum.completedOrders += 1;
                    cum.completedSales += Number(o.totalAmount) || 0;
                    const g = o.qualityGrade || '';
                    if (g === 'A') cum.aGrade += 1;
                    else if (g === 'C') cum.cGrade += 1;
                }
                if (o.review && o.status === 'completed') {
                    const r = Math.max(1, Math.min(5, Math.round(Number(o.review.rating) || 0)));
                    cum.ratingSum += r;
                    cum.ratingCount += 1;
                    cum.dist[r] = (cum.dist[r] || 0) + 1;
                    if (r >= 4) cum.goodReviews += 1;
                    else if (r <= 2) cum.badReviews += 1;
                    cum.recentReviews.push({
                        buyerName: o.buyerName || '匿名买家',
                        productName: o.productName || '',
                        listingId: o.listingId || null,
                        review: { rating: r, content: (o.review.content || ''), day: o.review.day || (o.completeTime && o.completeTime.day) || 0 }
                    });
                }
            });
            cum.recentReviews.sort((a, b) => (b.review.day || 0) - (a.review.day || 0));
            if (cum.recentReviews.length > 120) cum.recentReviews.length = 120;
        } catch (_) {}
    }

    updateShopRating() {
        // ===== 优先用累计统计（订单裁剪后店铺分不漂移）；老档回填前回退扫描 =====
        const cum = this.state.statistics && this.state.statistics._cum;
        if (cum && cum.ratingCount > 0) {
            const prior = 4.8;
            const priorWeight = 6;
            const avg = (cum.ratingSum + prior * priorWeight) / (cum.ratingCount + priorWeight);
            this.state.shop.rating = parseFloat(avg.toFixed(1));
            return;
        }
        const completedOrders = this.state.orders.filter(o => o.status === 'completed' && o.review);
        if (completedOrders.length > 0) {
            // 贝叶斯先验：早期评价不足时向 4.8 靠拢，避免少数差评砸穿店铺分
            const prior = 4.8;
            const priorWeight = 6;
            const sum = completedOrders.reduce((s, o) => s + o.review.rating, 0);
            const avg = (sum + prior * priorWeight) / (completedOrders.length + priorWeight);
            this.state.shop.rating = parseFloat(avg.toFixed(1));
        } else if (this.state.shop && (typeof this.state.shop.rating !== 'number' || isNaN(this.state.shop.rating))) {
            this.state.shop.rating = 5.0;
        }
    }

    getRatingStats() {
        // ===== 优先用累计统计（订单裁剪后评价页仍完整）；老档无 _cum 时回退扫描 =====
        const cum = this.state.statistics && this.state.statistics._cum;
        if (cum && cum.ratingCount > 0) {
            const total = cum.ratingCount;
            const distribution = { 5: cum.dist[5] || 0, 4: cum.dist[4] || 0, 3: cum.dist[3] || 0, 2: cum.dist[2] || 0, 1: cum.dist[1] || 0 };
            const goodCount = cum.goodReviews || 0;
            const midCount = distribution[3];
            const badCount = cum.badReviews || 0;
            return {
                total,
                averageRating: parseFloat((cum.ratingSum / total).toFixed(1)),
                distribution,
                goodCount,
                midCount,
                badCount,
                goodRate: parseFloat(((goodCount / total) * 100).toFixed(1)),
                reviews: cum.recentReviews || []
            };
        }
        const reviews = this.state.orders.filter(o => o.status === 'completed' && o.review);
        const total = reviews.length;
        
        const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
        reviews.forEach(order => {
            const rating = Math.round(order.review.rating);
            distribution[rating] = (distribution[rating] || 0) + 1;
        });

        const goodCount = reviews.filter(o => o.review.rating >= 4).length;
        const midCount = reviews.filter(o => o.review.rating === 3).length;
        const badCount = reviews.filter(o => o.review.rating <= 2).length;

        return {
            total,
            averageRating: total > 0 ? parseFloat((reviews.reduce((sum, o) => sum + o.review.rating, 0) / total).toFixed(1)) : 5.0,
            distribution,
            goodCount,
            midCount,
            badCount,
            goodRate: total > 0 ? parseFloat(((goodCount / total) * 100).toFixed(1)) : 100,
            reviews
        };
    }

    getReviewsByRating(minRating, maxRating) {
        const cum = this.state.statistics && this.state.statistics._cum;
        if (cum && cum.ratingCount > 0) {
            return (cum.recentReviews || [])
                .filter(r => r && r.review && r.review.rating >= minRating && r.review.rating <= maxRating)
                .sort((a, b) => (b.review.day || 0) - (a.review.day || 0));
        }
        return this.state.orders
            .filter(o => o.status === 'completed' && o.review && 
                        o.review.rating >= minRating && o.review.rating <= maxRating)
            .sort((a, b) => b.review.day - a.review.day);
    }

    // ==================== 评价回复与差评申诉（评分中心深化） ====================
    /**
     * 处理买家评价：道歉安抚 / 正式申诉。
     * 差评(1~2星)处理成功有概率转为中评(3星)，并同步累计统计与信誉。
     */
    respondToReview(orderId, type = 'apologize') {
        const order = (this.state.orders || []).find(o => o && o.id === orderId);
        if (!order || !order.review) return { success: false, message: '评价不存在' };
        if (order.review.responded) return { success: false, message: '该评价已回复处理' };
        const rating = Math.round(Number(order.review.rating) || 5);

        const RESPONSES = {
            apologize: { name: '道歉安抚', icon: '🙏', cost: 300, successRate: 0.5, desc: '诚意道歉并补偿，半数概率获谅解' },
            appeal:    { name: '正式申诉', icon: '⚖️', cost: 800, successRate: 0.7, desc: '提供凭证申诉，成功率更高' }
        };
        const cfg = RESPONSES[type] || RESPONSES.apologize;
        if (cfg.cost > 0 && typeof this.spendFunds === 'function') {
            if (!this.spendFunds(cfg.cost, `评价处理 - ${cfg.name}(${order.productName || orderId})`)) {
                return { success: false, message: `资金不足，处理需 ¥${cfg.cost}` };
            }
        }

        let upgraded = false;
        let message = '';
        if (rating <= 2 && Math.random() < cfg.successRate) {
            const old = rating;
            order.review.rating = 3;
            order.review.responded = true;
            order.review.responseType = type;
            order.review.response = (type === 'appeal' ? '已申诉成功，平台裁定撤销差评' : '感谢您的反馈，已为您妥善处理');
            // 同步累计统计（_cum 为评分主源，需保持一致）
            const cum = this.state.statistics && this.state.statistics._cum;
            if (cum && cum.ratingCount > 0) {
                if (cum.dist && cum.dist[old] > 0) cum.dist[old]--;
                if (cum.dist) cum.dist[3] = (cum.dist[3] || 0) + 1;
                cum.ratingSum = (cum.ratingSum || 0) + (3 - old);
                cum.badReviews = Math.max(0, (cum.badReviews || 0) - 1);
                if (Array.isArray(cum.recentReviews)) {
                    const r = cum.recentReviews.find(x => x && (x.id === orderId || x === order));
                    if (r && r.review) r.review.rating = 3;
                }
            }
            // 信誉 +1
            if (this.state.shop && typeof this.state.shop.reputation === 'number') {
                this.state.shop.reputation = Math.min(100, this.state.shop.reputation + 1);
            }
            upgraded = true;
            message = `✅ ${cfg.name}成功：买家谅解，差评已转为中评（信誉 +1）`;
        } else {
            order.review.responded = true;
            order.review.responseType = type;
            order.review.response = '已回复，感谢您的反馈';
            message = `已回复评价（${cfg.name}），买家暂未改评`;
        }
        try { this.notify(); } catch (_) {}
        return { success: true, upgraded, message };
    }

    // 客服相关（兼容旧API，转发到csState新实现）
    addConsultation(consultation) {
        if (typeof csState !== 'undefined' && csState.createConsultation) {
            csState.createConsultation(consultation);
        } else {
            consultation.id = generateId('cs');
            consultation.createTime = { ...this.state.gameTime };
            consultation.status = 'pending';
            this.state.customerService.consultations.push(consultation);
        }
        this.notify();
    }

    addReturn(returnItem) {
        if (typeof csState !== 'undefined' && csState.createReturn) {
            csState.createReturn(returnItem);
        } else {
            returnItem.id = generateId('ret');
            returnItem.createTime = { ...this.state.gameTime };
            returnItem.status = 'pending';
            this.state.customerService.returns.push(returnItem);
        }
        this.notify();
    }

    addDispute(dispute) {
        if (typeof csState !== 'undefined' && csState.createDispute) {
            csState.createDispute(dispute);
        } else {
            dispute.id = generateId('dis');
            dispute.createTime = { ...this.state.gameTime };
            dispute.status = 'pending';
            this.state.customerService.disputes.push(dispute);
            if (this.state.statistics) this.state.statistics.totalDisputes++;
        }
        this.notify();
    }

    // 营销活动
    addCampaign(campaign) {
        campaign.id = generateId('camp');
        campaign.startTime = { ...this.state.gameTime };
        campaign.status = 'active';
        this.state.marketing.activeCampaigns.push(campaign);
        this.notify();
    }

    addCelebrityEndorsement(endorsement) {
        const celeb = (typeof CELEBRITIES !== 'undefined' && endorsement && endorsement.celebrityId)
            ? CELEBRITIES.find(c => c.id === endorsement.celebrityId) : null;
        const shopLv = (this.state.shop && this.state.shop.level) || 1;
        if (celeb && shopLv < (celeb.unlockLevel || 1)) {
            return { success: false, message: `需店铺 Lv.${celeb.unlockLevel} 才能签约` };
        }
        endorsement.id = generateId('endo');
        endorsement.startTime = { ...this.state.gameTime };
        endorsement.status = 'active';
        this.state.marketing.celebrityEndorsements.push(endorsement);
        this.notify();
        return { success: true };
    }

    getTotalMarketingEffect() {
        let effect = 1;
        const isLive = !!(this.state.livestream && this.state.livestream.isLive);
        this.state.marketing.activeCampaigns.forEach(c => {
            if (c.status === 'active') {
                const mt = MARKETING_TYPES[c.type];
                let mul = (mt && mt.effect) || 1;
                if (mt && mt.liveBonus && isLive) mul *= mt.liveBonus;
                effect *= mul;
            }
        });
        this.state.marketing.celebrityEndorsements.forEach(e => {
            if (e.status === 'active') {
                const celeb = CELEBRITIES.find(c => c.id === e.celebrityId);
                if (celeb) {
                    effect *= celeb.exposureEffect;
                }
            }
        });
        const cap = (typeof MARKETING_EFFECT_CAP === 'number' && MARKETING_EFFECT_CAP > 1)
            ? MARKETING_EFFECT_CAP : 8;
        return Math.min(effect, cap);
    }

    stopCampaign(campaignId) {
        const c = (this.state.marketing.activeCampaigns || []).find(x => x.id === campaignId);
        if (!c || c.status !== 'active') return { success: false, message: '活动不存在或已结束' };
        c.status = 'ended';
        this.notify();
        return { success: true, message: '已停止该推广' };
    }

    // ==================== 推广ROI分析 ====================
    // 聚合所有推广日志的投入/产出/ROI（按推广员工维度 + 按天维度）
    getPromotionROI() {
        const logs = this.state.marketing.promotionLogs || [];
        const orders = this.state.orders || [];

        // 构建订单索引：marketingPromotionId -> 累计GMV + 订单数
        const promoGmvMap = new Map();
        const promoOrderCntMap = new Map();
        for (let i = 0; i < orders.length; i++) {
            const o = orders[i];
            if (!o || !o.fromMarketing || !o.marketingPromotionId) continue;
            if (o.status === 'cancelled') continue;
            const pid = o.marketingPromotionId;
            promoGmvMap.set(pid, (promoGmvMap.get(pid) || 0) + (o.totalAmount || 0));
            promoOrderCntMap.set(pid, (promoOrderCntMap.get(pid) || 0) + 1);
        }

        // 员工维度聚合
        const empAgg = new Map();
        let totalCost = 0, totalGmv = 0, totalOrders = 0, totalExposure = 0;
        logs.forEach(l => {
            const gmv = promoGmvMap.get(l.id) || 0;
            const realOrders = promoOrderCntMap.get(l.id) || (l.generatedOrders || 0);
            const cost = l.cost || 0;
            totalCost += cost;
            totalGmv += gmv;
            totalOrders += realOrders;
            totalExposure += (l.exposureGiven || 0);
            const key = l.employeeId || ('_anon_' + (l.employeeName || 'x'));
            if (!empAgg.has(key)) empAgg.set(key, {
                employeeId: l.employeeId,
                employeeName: l.employeeName || '推广员',
                employeeLevel: l.employeeLevel || 1,
                runs: 0, cost: 0, gmv: 0, orders: 0, exposure: 0
            });
            const a = empAgg.get(key);
            a.runs += 1;
            a.cost += cost;
            a.gmv += gmv;
            a.orders += realOrders;
            a.exposure += (l.exposureGiven || 0);
        });

        // 计算ROI并排序
        const employees = [...empAgg.values()].map(e => {
            e.roi = e.cost > 0 ? +(e.gmv / e.cost).toFixed(2) : (e.gmv > 0 ? 99 : 0);
            e.profit = +(e.gmv - e.cost).toFixed(2);
            e.cpa = e.orders > 0 ? +(e.cost / e.orders).toFixed(2) : 0;
            return e;
        }).sort((a, b) => b.cost - a.cost);

        // 按日聚合（最近14天）
        const dayAgg = new Map();
        logs.forEach(l => {
            const day = l.day || 0;
            if (!dayAgg.has(day)) dayAgg.set(day, { day, cost: 0, gmv: 0, orders: 0, exposure: 0, runs: 0 });
            const d = dayAgg.get(day);
            d.cost += l.cost || 0;
            d.gmv += promoGmvMap.get(l.id) || 0;
            d.orders += promoOrderCntMap.get(l.id) || (l.generatedOrders || 0);
            d.exposure += l.exposureGiven || 0;
            d.runs += 1;
        });
        const daily = [...dayAgg.values()].sort((a, b) => b.day - a.day).map(d => {
            d.roi = d.cost > 0 ? +(d.gmv / d.cost).toFixed(2) : (d.gmv > 0 ? 99 : 0);
            d.profit = +(d.gmv - d.cost).toFixed(2);
            return d;
        });

        const overallRoi = totalCost > 0 ? +(totalGmv / totalCost).toFixed(2) : 0;
        // 效率评级（S/A/B/C/D）
        let grade = 'D', gradeColor = '#9e9e9e';
        if (overallRoi >= 5) { grade = 'S'; gradeColor = '#e91e63'; }
        else if (overallRoi >= 3) { grade = 'A'; gradeColor = '#4caf50'; }
        else if (overallRoi >= 1.5) { grade = 'B'; gradeColor = '#2196f3'; }
        else if (overallRoi >= 1) { grade = 'C'; gradeColor = '#ff9800'; }

        return {
            summary: {
                totalCost: +totalCost.toFixed(2),
                totalGmv: +totalGmv.toFixed(2),
                totalOrders,
                totalExposure,
                roi: overallRoi,
                netProfit: +(totalGmv - totalCost).toFixed(2),
                totalRuns: logs.length,
                grade, gradeColor
            },
            employees,
            daily: daily.slice(0, 14)
        };
    }

    // 成就系统
    unlockAchievement(achievementId) {
        if (this.state.achievements.unlocked.includes(achievementId)) return false;
        
        const achievement = ACHIEVEMENTS.find(a => a.id === achievementId);
        if (!achievement) return false;
        
        this.state.achievements.unlocked.push(achievementId);
        
        if (achievement.reward.type === 'money') {
            this.addFunds(achievement.reward.value, `成就奖励: ${achievement.name}`);
        } else if (achievement.reward.type === 'buff') {
            this.state.achievements.currentBuffs.push({
                id: achievementId,
                type: achievement.reward.buffType,
                value: achievement.reward.value,
                name: achievement.name
            });
            this.recalculateBuffs();
        }
        
        return true;
    }

    isAchievementUnlocked(achievementId) {
        return this.state.achievements.unlocked.includes(achievementId);
    }

    getAchievementProgress() {
        return {
            total: ACHIEVEMENTS.length,
            unlocked: this.state.achievements.unlocked.length
        };
    }

    /**
     * 单个成就的进度（评分中心/成就收集深化）：返回当前值 vs 目标值。
     * 与 gameEngine.checkAchievements 的判定逻辑保持一致。
     * @returns {{current:number, target:number, pct:number, type:string}|null}
     */
    getAchievementMetric(achievement) {
        try {
            if (!achievement || !achievement.condition) return null;
            const state = this.state;
            const stats = state.statistics || {};
            const orders = state.orders || [];
            const completedOrders = orders.filter(o => o && o.status === 'completed');
            const totalSalesAmount = completedOrders.reduce((s, o) => s + (Number(o.totalAmount) || 0), 0);
            const goodReviews = completedOrders.filter(o => o.review && o.review.rating >= 4).length;
            const badReviews = completedOrders.filter(o => o.review && o.review.rating <= 2).length;
            const activeListings = (state.listings || []).filter(l => l && l.status === 'active').length;
            const employees = (state.employees || []).filter(e => e && e.status === 'active').length;
            const aGrade = completedOrders.filter(o => o.qualityGrade === 'A').length;
            const cGrade = completedOrders.filter(o => o.qualityGrade === 'C').length;
            const cum = stats._cum || {};
            const totalCost = (state.finance && Array.isArray(state.finance.records))
                ? state.finance.records.filter(r => r && r.type === 'expense').reduce((s, r) => s + (Number(r.amount) || 0), 0) : 0;
            const totalProfit = Math.max(totalSalesAmount, cum.completedSales || 0) - totalCost;

            const metrics = {
                totalOrders: Math.max(completedOrders.length, cum.completedOrders || 0),
                totalSales: Math.max(totalSalesAmount, cum.completedSales || 0),
                totalProfit,
                goodReviews: Math.max(goodReviews, cum.goodReviews || 0),
                badReviews: Math.max(badReviews, cum.badReviews || 0),
                reputation: (state.shop && typeof state.shop.rating === 'number') ? state.shop.rating : 5,
                activeListings,
                employees,
                shopLevel: (state.shop && state.shop.level) || 1,
                days: (state.gameTime && state.gameTime.day) || 1,
                aGradeOrders: Math.max(aGrade, cum.aGrade || 0),
                cGradeOrders: Math.max(cGrade, cum.cGrade || 0),
                nightOrder: stats.nightOrders || 0,
                earlyOrder: stats.earlyOrders || 0
            };
            const type = achievement.condition.type;
            const current = metrics[type];
            if (current === undefined) return null;
            const target = Number(achievement.condition.value) || 1;
            const pct = Math.min(100, Math.round((current / target) * 100));
            return { current: Math.round(current * 100) / 100, target, pct, type };
        } catch (e) {
            return null;
        }
    }

    recalculateBuffs() {
        let trafficMult = 1.0;
        let conversionMult = 1.0;
        
        this.state.achievements.currentBuffs.forEach(buff => {
            if (buff.type === 'traffic') {
                trafficMult += buff.value;
            } else if (buff.type === 'conversion') {
                conversionMult += buff.value;
            }
        });
        
        this.state.buffs.trafficMultiplier = trafficMult;
        this.state.buffs.conversionMultiplier = conversionMult;
    }

    // 事件系统
    triggerEvent(event) {
        const activeEvent = {
            ...event,
            startTime: { ...this.state.gameTime },
            remainingDuration: event.effect.duration || 0
        };
        
        if (event.effect.duration) {
            this.state.events.activeEvents.push(activeEvent);
        }
        
        this.state.events.eventLog.unshift({
            id: event.id,
            name: event.name,
            icon: event.icon,
            type: event.type,
            message: event.effect.message,
            day: this.state.gameTime.day,
            hour: this.state.gameTime.hour
        });
        
        if (this.state.events.eventLog.length > 50) {
            this.state.events.eventLog.pop();
        }
        
        this.applyEventEffect(event);
        this.notify();
    }

    // ==================== 危机应对决策（事件系统深化） ====================
    /**
     * 危机决策：对带 crisis 配置的坏事事件，玩家可选择「花钱化解」或「硬扛」。
     * @param {string} eventId 事件 id
     * @param {string} action 'mitigate' | 'accept'
     */
    resolveCrisisEvent(eventId, action) {
        const event = (typeof RANDOM_EVENTS !== 'undefined' && Array.isArray(RANDOM_EVENTS))
            ? RANDOM_EVENTS.find(e => e && e.id === eventId) : null;
        if (!event || !event.crisis) return { success: false, message: '该事件不支持危机应对' };
        const day = (this.state.gameTime && this.state.gameTime.day) || 1;
        const hour = (this.state.gameTime && this.state.gameTime.hour) || 0;

        if (action === 'mitigate') {
            const cost = Number(event.crisis.mitigateCost) || 0;
            if (cost > 0 && typeof this.spendFunds === 'function') {
                if (!this.spendFunds(cost, `危机化解 - ${event.name}`)) {
                    return { success: false, message: `资金不足，化解需 ¥${cost.toLocaleString()}` };
                }
            }
            // 化解：不触发事件，仅记录
            this.state.events.eventLog.unshift({
                id: event.id + '_mitigated',
                name: event.name,
                icon: '🛡️',
                type: 'crisis_mitigated',
                message: `${event.name}已被化解（${event.crisis.mitigateDesc}）`,
                day, hour
            });
            if (this.state.events.eventLog.length > 50) this.state.events.eventLog.pop();
            this.notify();
            return { success: true, mitigated: true, message: `🛡️ 已花费 ¥${cost.toLocaleString()} 化解「${event.name}」` };
        }

        // accept：正常触发
        this.triggerEvent(event);
        return { success: true, mitigated: false, message: `已接受「${event.name}」影响` };
    }

    applyEventEffect(event) {
        const effect = event.effect;
        
        switch (effect.type) {
            case 'traffic_boost':
            case 'traffic_drop':
                break;
            case 'bad_reviews':
                this.state.statistics.badReviews += effect.count || 1;
                break;
            case 'fine':
                const fineAmount = Math.floor(this.state.shop.funds * (effect.percent || 0.02));
                this.spendFunds(fineAmount, `罚款: ${event.name}`);
                break;
            case 'product_ban': {
                // 随机挑 1~2 个在架商品施加禁售/禁购
                if (!this.state.productControls) this.state.productControls = { bans: [] };
                if (!Array.isArray(this.state.productControls.bans)) this.state.productControls.bans = [];
                const listings = (this.state.listings || []).filter(l => l.status === 'active');
                const pool = listings.length
                    ? listings.map(l => l.productId)
                    : ((typeof PRODUCTS !== 'undefined' ? PRODUCTS : []).slice(0, 20).map(p => p.id));
                const uniq = [...new Set(pool)].filter(Boolean);
                if (!uniq.length) break;
                const n = Math.min(2, uniq.length);
                const shuffled = uniq.slice().sort(() => Math.random() - 0.5).slice(0, n);
                const untilDay = (this.state.gameTime?.day || 1) + (effect.days || 2);
                const mode = (effect.mode === 'buy' || effect.mode === 'both') ? effect.mode : 'sell';
                shuffled.forEach(pid => {
                    this.state.productControls.bans.push({
                        productId: pid,
                        mode,
                        untilDay,
                        reason: event.name || '货物管制'
                    });
                });
                // 同步写入海外法规提示
                try {
                    if (typeof overseasUI !== 'undefined' && overseasUI.addRegulation) {
                        overseasUI.addRegulation({
                            title: event.name,
                            detail: (effect.message || '') + ' · 涉及 ' + shuffled.join('、'),
                            untilDay
                        });
                    }
                } catch (_) {}
                break;
            }
        }
    }

    /** 检查商品是否被管制。mode: 'sell' | 'buy' */
    isProductControlled(productId, mode = 'sell') {
        try {
            const day = this.state.gameTime?.day || 1;
            const bans = (this.state.productControls && this.state.productControls.bans) || [];
            // 清理过期
            this.state.productControls = this.state.productControls || { bans: [] };
            this.state.productControls.bans = bans.filter(b => b && b.untilDay >= day);
            const hit = this.state.productControls.bans.find(b =>
                b.productId === productId &&
                (b.mode === 'both' || b.mode === mode || (mode === 'sell' && b.mode === 'sell') || (mode === 'buy' && b.mode === 'buy'))
            );
            if (!hit) return null;
            const prod = (typeof getProductById === 'function') ? getProductById(productId) : null;
            return {
                productId,
                mode: hit.mode,
                untilDay: hit.untilDay,
                reason: `${hit.reason || '管制'}：${(prod && prod.name) || productId} 至第${hit.untilDay}天`
            };
        } catch (_) {
            return null;
        }
    }

    /** 近 30 天售出率 = 售出 / (售出+库存) */
    getSellThroughRate(productId, qualityGrade = null) {
        try {
            const day = this.state.gameTime?.day || 1;
            const from = Math.max(1, day - 30);
            let sold = 0;
            (this.state.orders || []).forEach(o => {
                if (!o || o.productId !== productId) return;
                if (qualityGrade && o.qualityGrade && o.qualityGrade !== qualityGrade) return;
                if (o.status !== 'completed' && o.status !== 'shipped' && o.status !== 'pending_shipment' && o.status !== 'pending_packing') return;
                const d = o.createTime?.day || 0;
                if (d < from || d > day) return;
                sold += (o.quantity || 1);
            });
            const stock = this.getInventoryQuantity(productId, qualityGrade);
            const denom = sold + Math.max(0, stock);
            if (denom <= 0) return { sold, stock, rate: 0 };
            return { sold, stock, rate: Math.round((sold / denom) * 1000) / 10 };
        } catch (_) {
            return { sold: 0, stock: 0, rate: 0 };
        }
    }

    // ===== 员工宿舍 =====
    _ensureHousing() {
        if (!this.state.housing || typeof this.state.housing !== 'object') {
            this.state.housing = { level: 0, beds: 0, buildings: [], assigned: {}, monthlyRentPerBed: 180, satisfaction: 60 };
        }
        const h = this.state.housing;
        if (!h.assigned || typeof h.assigned !== 'object') h.assigned = {};
        if (!Array.isArray(h.buildings)) h.buildings = [];
        if (typeof h.level !== 'number') h.level = Number(h.level) || 0;
        if (typeof h.beds !== 'number') h.beds = Number(h.beds) || 0;
        if (typeof h.monthlyRentPerBed !== 'number') h.monthlyRentPerBed = Number(h.monthlyRentPerBed) || 180;
        if (typeof h.satisfaction !== 'number') h.satisfaction = Number(h.satisfaction) || 60;
        if (h.buildings.length === 0 && (h.beds || 0) > 0) {
            h.buildings.push({
                id: 'legacy_' + Date.now(),
                type: (h.beds >= 20 ? 'std' : 'bunk'),
                beds: h.beds,
                rent: h.monthlyRentPerBed || 180,
                sat: h.satisfaction || 70
            });
        }
        this._syncHousingCapacity(h);
        return h;
    }

    _syncHousingCapacity(h) {
        const list = h.buildings || [];
        let beds = 0, rentSum = 0, satSum = 0;
        list.forEach(b => {
            const n = Number(b.beds) || 0;
            beds += n;
            rentSum += (Number(b.rent) || 0) * n;
            satSum += (Number(b.sat) || 70) * n;
        });
        h.beds = beds;
        h.monthlyRentPerBed = beds > 0 ? Math.round(rentSum / beds) : 180;
        h.satisfaction = beds > 0 ? Math.round(satSum / beds) : 60;
        h.level = list.length;
        return h;
    }

    buyHousingBuilding(typeId) {
        const types = (typeof HOUSING_BUILDING_TYPES !== 'undefined') ? HOUSING_BUILDING_TYPES : [];
        const cfg = types.find(t => t.id === typeId);
        if (!cfg) return { success: false, message: '无效楼型' };
        if (!this.spendFunds(cfg.cost, `购置宿舍「${cfg.name}」`)) {
            return { success: false, message: '资金不足' };
        }
        const h = this._ensureHousing();
        h.buildings.push({
            id: 'hb_' + Date.now() + '_' + Math.floor(Math.random() * 999),
            type: cfg.id,
            beds: cfg.beds,
            rent: cfg.rent,
            sat: cfg.sat,
            name: cfg.name
        });
        this._syncHousingCapacity(h);
        const fill = this.autoFillHousing({ silent: true });
        this.notify();
        const extra = fill.filled > 0 ? `，已自动安排 ${fill.filled} 人入住` : '';
        return { success: true, message: `已购置「${cfg.name}」+${cfg.beds}床（合计 ${h.beds} 床）${extra}` };
    }

    _housingAssignPriority(emp) {
        if (!emp) return 0;
        const rank = { intern: 1, junior: 2, senior: 3, lead: 4, manager: 5 };
        const hireDay = (emp.hireDate && emp.hireDate.day) || (emp.joinDate && emp.joinDate.day) || 0;
        return (Number(emp.baseSalary) || 0) * 10
            + (rank[emp.rank] || 1) * 800
            + (Number(emp.level) || 1) * 40
            + hireDay;
    }

    /** 空床自动入住：已入住的不动，空位按底薪/职级补满 */
    autoFillHousing(opts) {
        const silent = !!(opts && opts.silent);
        const h = this.cleanupHousingAssignments({ skipFill: true });
        const beds = h.beds || 0;
        if (beds <= 0) return { filled: 0, occupied: 0, beds: 0 };
        const active = (this.state.employees || []).filter(e => e && e.status === 'active');
        let occupied = Object.keys(h.assigned).filter(id => h.assigned[id]).length;
        const vacancies = Math.max(0, beds - occupied);
        if (vacancies <= 0) {
            return { filled: 0, occupied, beds };
        }
        const homeless = active
            .filter(e => !(h.assigned[e.id] || h.assigned[String(e.id)]))
            .sort((a, b) => this._housingAssignPriority(b) - this._housingAssignPriority(a));
        let filled = 0;
        homeless.forEach(e => {
            if (occupied >= beds) return;
            h.assigned[String(e.id)] = true;
            e.housingAssigned = true;
            occupied += 1;
            filled += 1;
        });
        if (filled > 0 && !silent) this.notify();
        return { filled, occupied, beds };
    }

    /** 床位不够时按优先级重排（一键，不用逐个勾） */
    rebalanceHousing() {
        const h = this._ensureHousing();
        h.assigned = {};
        (this.state.employees || []).forEach(e => { if (e) e.housingAssigned = false; });
        const r = this.autoFillHousing({ silent: true });
        this.notify();
        return {
            success: true,
            message: (h.beds || 0) <= 0
                ? '请先升级宿舍'
                : `已按岗位自动安排 ${r.occupied}/${r.beds} 人入住`
        };
    }

    /** 清理已离职员工占床，并同步 emp.housingAssigned */
    cleanupHousingAssignments(opts) {
        const h = this._ensureHousing();
        const skipFill = !!(opts && opts.skipFill);
        const active = (this.state.employees || []).filter(e => e && (e.status === 'active' || e.status === 'resigning'));
        const activeIds = new Set(active.map(e => String(e.id)));
        Object.keys(h.assigned).forEach(id => {
            if (!h.assigned[id] || !activeIds.has(String(id))) {
                delete h.assigned[id];
            }
        });
        active.forEach(e => {
            const on = !!(h.assigned[e.id] || h.assigned[String(e.id)]);
            e.housingAssigned = on;
            if (on) {
                // 统一用字符串键，避免数字/字符串 id 重复占床
                delete h.assigned[e.id];
                h.assigned[String(e.id)] = true;
            }
        });
        if (!skipFill && (h.beds || 0) > 0) {
            this.autoFillHousing({ silent: true });
        }
        return h;
    }

    getHousingOccupiedCount() {
        const h = this.cleanupHousingAssignments();
        return Object.keys(h.assigned).filter(id => h.assigned[id]).length;
    }

    upgradeHousing(levelOrType) {
        if (typeof levelOrType === 'string') return this.buyHousingBuilding(levelOrType);
        const map = { 1: 'bunk', 2: 'std', 3: 'apt' };
        return this.buyHousingBuilding(map[Number(levelOrType)] || 'bunk');
    }

    setStaffOrderCommissionRate(pct) {
        const n = Number(pct);
        if (!isFinite(n) || n < 0.1 || n > 1) {
            return { success: false, message: '提成比例需在 0.1%～1%' };
        }
        const rate = Math.round(n * 10) / 1000;
        this.state.shop = this.state.shop || {};
        this.state.shop.staffOrderCommissionRate = rate;
        this.state.shop._staffCommissionMigratedV2 = true;
        this.notify();
        return { success: true, rate, message: `经手订单提成已设为 ${n.toFixed(1)}%` };
    }

    /** 主动离职进入无薪缓冲期（默认 7 天），期间不接任务、不发工资 */
    beginEmployeeResignation(employeeId, reason = '员工主动离职', noticeDays) {
        const emp = (this.state.employees || []).find(e => e && (e.id === employeeId || String(e.id) === String(employeeId)));
        if (!emp) return { success: false, message: '员工不存在' };
        if (emp.status === 'resigned') return { success: false, message: '已离职' };
        if (emp.status === 'resigning') {
            return { success: true, already: true, emp, daysLeft: Math.max(0, (emp.resignEffectiveDay || 0) - ((this.state.gameTime && this.state.gameTime.day) || 1)) };
        }
        const days = (typeof noticeDays === 'number' && noticeDays >= 0)
            ? noticeDays
            : ((typeof RESIGN_NOTICE_DAYS === 'number') ? RESIGN_NOTICE_DAYS : 7);
        const day = (this.state.gameTime && this.state.gameTime.day) || 1;
        emp.status = 'resigning';
        emp.statusReason = reason;
        emp.statusChangeDate = { ...this.state.gameTime };
        emp.resignNoticeDay = day;
        emp.resignEffectiveDay = day + days;
        emp.currentTask = null;
        emp.assignedTask = null;
        this.notify();
        return { success: true, emp, days, effectiveDay: emp.resignEffectiveDay };
    }

    assignHousing(empId, on) {
        const h = this.cleanupHousingAssignments();
        const emp = (this.state.employees || []).find(e => e && (e.id === empId || String(e.id) === String(empId)));
        if (!emp || emp.status !== 'active') return { success: false, message: '员工不在职' };
        const key = String(emp.id);
        if (on) {
            if ((h.beds || 0) <= 0) return { success: false, message: '请先升级宿舍' };
            const occupied = Object.keys(h.assigned).filter(id => h.assigned[id]).length;
            if (!h.assigned[key] && occupied >= h.beds) {
                return { success: false, message: '床位已满' };
            }
            h.assigned[key] = true;
            emp.housingAssigned = true;
        } else {
            delete h.assigned[key];
            delete h.assigned[emp.id];
            emp.housingAssigned = false;
        }
        this.notify();
        return { success: true };
    }

    getCurrentTrafficMultiplier() {
        let multiplier = this.state.buffs.trafficMultiplier;
        
        this.state.events.activeEvents.forEach(event => {
            if (event.effect.type === 'traffic_boost') {
                multiplier *= event.effect.value;
            } else if (event.effect.type === 'traffic_drop') {
                multiplier *= event.effect.value;
            }
        });
        
        return multiplier;
    }

    getCurrentConversionMultiplier() {
        let mult = this.state.buffs.conversionMultiplier;
        // ===== 运费险（快递深化）：提供运费险可提升转化率 +5% =====
        try {
            if (this.state.shop && this.state.shop.freightInsurance) {
                mult += 0.05;
            }
        } catch (_) {}
        // ===== 会员日（会员深化）：会员转化率 +5% =====
        try {
            if (this.state.members && this.state.members.memberDay) {
                mult += 0.05;
            }
        } catch (_) {}
        return mult;
    }

    // ==================== 运费险（快递合作深化） ====================
    /** 运费险开关状态 */
    getFreightInsurance() {
        return !!(this.state.shop && this.state.shop.freightInsurance);
    }

    /** 切换运费险：提供运费险 → 转化率 +5%，但每笔订单承担少量保费 */
    toggleFreightInsurance() {
        const shop = this.state.shop || (this.state.shop = {});
        shop.freightInsurance = !shop.freightInsurance;
        this.notify();
        return {
            success: true,
            enabled: shop.freightInsurance,
            message: shop.freightInsurance ? '已开启运费险（转化率 +5%，买家更放心下单）' : '已关闭运费险'
        };
    }

    // ==================== 会员日（会员中心深化） ====================
    /** 会员日开关状态 */
    getMemberDay() {
        return !!(this.state.members && this.state.members.memberDay);
    }

    /** 切换会员日：开启后会员转化率 +5%、会员积分 ×1.5 */
    toggleMemberDay() {
        const members = this.state.members || (this.state.members = {});
        members.memberDay = !members.memberDay;
        this.notify();
        return {
            success: true,
            enabled: members.memberDay,
            message: members.memberDay ? '已开启会员日（会员转化率 +5%、积分 ×1.5）' : '已关闭会员日'
        };
    }

    // ==================== 城市政策补贴（城市地图深化） ====================
    /** 当前城市政策补贴信息 */
    getCityPolicyInfo() {
        const cityId = (this.state.warehouse && this.state.warehouse.city)
            || (this.state.shop && this.state.shop.city) || 'yiwu';
        let city = null;
        try { city = (typeof getCityById === 'function') ? getCityById(cityId) : null; } catch (_) {}
        const subsidyMap = { '简单': 500, '中等': 1500, '困难': 3000 };
        const difficulty = (city && city.difficulty) || '简单';
        const subsidy = subsidyMap[difficulty] || 500;
        const day = (this.state.gameTime && this.state.gameTime.day) || 1;
        const claimedToday = this.state.citySubsidyDay === day;
        return { city, cityId, difficulty, subsidy, claimedToday, day };
    }

    /** 领取城市政策补贴（每日一次，补贴随城市难度递增） */
    claimCitySubsidy() {
        const info = this.getCityPolicyInfo();
        if (info.claimedToday) return { success: false, message: '今日已领取过城市补贴，明日再来' };
        const cityName = (info.city && info.city.name) || info.cityId;
        this.addFunds(info.subsidy, `城市政策补贴 - ${cityName}`);
        this.state.citySubsidyDay = info.day;
        this.notify();
        return { success: true, message: `🏛️ 已领取「${cityName}」政策补贴 ¥${info.subsidy}` };
    }

    // ==================== 环保包装（包装材料深化） ====================
    /** 环保包装开关状态 */
    getEcoPackaging() {
        return !!(this.state.shop && this.state.shop.ecoPackaging);
    }

    /** 切换环保包装：开启后信誉 +3、退货率降低，但每单包装成本略增 */
    toggleEcoPackaging() {
        const shop = this.state.shop || (this.state.shop = {});
        const wasEnabled = !!shop.ecoPackaging;
        shop.ecoPackaging = !wasEnabled;
        if (!wasEnabled && typeof shop.reputation === 'number') {
            shop.reputation = Math.min(100, shop.reputation + 3);
        } else if (wasEnabled && typeof shop.reputation === 'number') {
            shop.reputation = Math.max(0, shop.reputation - 3);
        }
        this.notify();
        return {
            success: true,
            enabled: shop.ecoPackaging,
            message: shop.ecoPackaging ? '🌿 已启用环保包装（信誉 +3、退货率降低）' : '已停用环保包装（信誉 -3）'
        };
    }

    addActiveEvent(eventId, duration, effect) {
        const event = RANDOM_EVENTS.find(e => e.id === eventId);
        if (!event) return;
        
        this.state.events.activeEvents.push({
            id: eventId,
            name: event.name,
            icon: event.icon,
            type: event.type,
            effect: effect || event.effect,
            remainingDuration: duration
        });
    }

    removeActiveEvent(eventId) {
        const index = this.state.events.activeEvents.findIndex(e => e.id === eventId);
        if (index > -1) {
            this.state.events.activeEvents.splice(index, 1);
        }
    }

    // ==================== 会员系统（完整会员中心） ====================
    
    // ====== 玩家个人信息管理 ======
    updatePlayerInfo(info) {
        if (!this.state.player) this.state.player = {};
        const allowed = ['name', 'avatar', 'gender', 'birthday', 'address', 'phone', 'bio'];
        allowed.forEach(key => {
            if (info[key] !== undefined) {
                this.state.player[key] = info[key];
            }
        });
        this.notify();
        return { success: true };
    }

    // ====== 每日签到 ======
    dailySignIn() {
        const player = this.state.player;
        const today = this.state.gameTime.day;
        if (player.lastSignInDay === today) {
            return { success: false, message: '今日已签到' };
        }
        // 连续签到判断
        if (player.lastSignInDay === today - 1) {
            player.continuousSignIn = (player.continuousSignIn || 0) + 1;
        } else {
            player.continuousSignIn = 1;
        }
        player.lastSignInDay = today;
        player.signInDays = (player.signInDays || 0) + 1;
        
        // 签到积分奖励
        let pointsReward = MEMBER_GROWTH_RULES.signIn.daily;
        let growthReward = MEMBER_GROWTH_RULES.signIn.daily;
        let extraMsg = '';
        
        // 连续签到奖励
        if (player.continuousSignIn === 7) {
            pointsReward += MEMBER_GROWTH_RULES.signIn.continuous7;
            growthReward += MEMBER_GROWTH_RULES.signIn.continuous7;
            extraMsg = '连续7天额外奖励！';
        } else if (player.continuousSignIn === 30) {
            pointsReward += MEMBER_GROWTH_RULES.signIn.continuous30;
            growthReward += MEMBER_GROWTH_RULES.signIn.continuous30;
            extraMsg = '连续30天额外奖励！';
            player.continuousSignIn = 0;
        }
        
        this.addPoints(pointsReward, 'earn_signin', '每日签到' + extraMsg);
        this.addGrowth(growthReward, 'signin', '每日签到' + extraMsg);
        
        this.notify();
        return { 
            success: true, 
            points: pointsReward, 
            growth: growthReward, 
            continuousDays: player.continuousSignIn,
            message: `签到成功！获得${pointsReward}积分，${growthReward}成长值`
        };
    }

    _evictSleepingMemberIfNeeded() {
        const list = this.state.members && this.state.members.list;
        if (!list || list.length < 4000) return;
        const dayNow = (this.state.gameTime && this.state.gameTime.day) || 1;
        let worstIdx = -1;
        let worstScore = -Infinity;
        for (let i = 0; i < list.length; i++) {
            const m = list[i];
            if (!m) continue;
            const last = m.lastOrderDay || m.lastActiveDay || m.joinDay || 0;
            const join = m.joinDay || 0;
            if ((dayNow - last) < 21 || (dayNow - join) < 14) continue;
            const score = (dayNow - last) * 10 - (Number(m.spent) || 0);
            if (score > worstScore) {
                worstScore = score;
                worstIdx = i;
            }
        }
        const dropAt = worstIdx >= 0 ? worstIdx : 0;
        const dropped = list.splice(dropAt, 1)[0];
        if (dropped && this._memberNameIdx && this._memberNameIdxList === list) {
            if (this._memberNameIdx.get(dropped.name) === dropped) this._memberNameIdx.delete(dropped.name);
        }
    }

    // ====== 顾客会员管理 ======
    addMember(name, spent = 0) {
        this._evictSleepingMemberIfNeeded();
        const growth = Math.floor(spent * 0.5);
        const level = this.getMemberLevelByGrowth(growth, spent);
        const member = {
            id: generateId('mem'),
            name: name,
            spent: spent,
            growth: growth,
            level: level,
            joinDay: this.state.gameTime.day,
            lastOrderDay: this.state.gameTime.day,
            orderCount: 0,
            points: Math.floor(spent / 10),
            wallet: 0,
            recharged: 0,
            rechargeBonus: 0
        };
        this.state.members.list.push(member);
        // 增量维护 name 索引（若已构建），保证后续 findMemberByName 命中
        if (this._memberNameIdx && this._memberNameIdxList === this.state.members.list) {
            this._memberNameIdx.set(member.name, member);
        }
        this.state.members.total = Math.max((this.state.members.total || 0) + 1, this.state.members.list.length);
        this.state.members.statistics.newMembersThisMonth++;
        // 新会员赠送积分
        const welcomePoints = 100;
        member.points += welcomePoints;
        this.addPointsLog(member.id, member.name, welcomePoints, 'earn_activity', '新会员礼包');
        this.notify();
        return member;
    }

    // 根据成长值和消费计算会员等级（双维度，取较高等级）
    getMemberLevelByGrowth(growth, spent) {
        let levelByGrowth = 1, levelBySpent = 1;
        for (let i = MEMBER_LEVELS.length - 1; i >= 0; i--) {
            if (growth >= MEMBER_LEVELS[i].minGrowth) {
                levelByGrowth = MEMBER_LEVELS[i].level;
                break;
            }
        }
        for (let i = MEMBER_LEVELS.length - 1; i >= 0; i--) {
            if (spent >= MEMBER_LEVELS[i].minSpent) {
                levelBySpent = MEMBER_LEVELS[i].level;
                break;
            }
        }
        return Math.max(levelByGrowth, levelBySpent);
    }

    // 兼容旧方法
    getMemberLevel(spent) {
        return this.getMemberLevelByGrowth(spent * 0.5, spent);
    }

    // 获取会员等级信息
    getMemberLevelInfo(level) {
        return MEMBER_LEVELS.find(l => l.level === level) || MEMBER_LEVELS[0];
    }

    // 获取下一等级所需成长值
    getNextLevelGrowth(currentLevel) {
        const next = MEMBER_LEVELS.find(l => l.level === currentLevel + 1);
        if (!next) return null;
        return { nextLevel: currentLevel + 1, needGrowth: next.minGrowth, needSpent: next.minSpent };
    }

    findMemberByName(name) {
        // ===== 性能优化：name→member 索引缓存 =====
        // 爆单批量完成时每单都查一次，线性扫描 O(members) 是 tick 卡顿主因（5万单实测占 ~1.6s）。
        // 缓存挂运行时实例（不进存档）；list 引用变化（裁剪/读档）自动重建，addMember 增量维护。
        const list = this.state.members.list;
        if (!list) return null;
        if (this._memberNameIdxList !== list) {
            const idx = new Map();
            for (let i = 0; i < list.length; i++) {
                const m = list[i];
                if (m && m.name != null && !idx.has(m.name)) idx.set(m.name, m);
            }
            this._memberNameIdx = idx;
            this._memberNameIdxList = list;
        }
        return this._memberNameIdx.get(name) || null;
    }

    findMemberById(id) {
        return this.state.members.list.find(m => m.id === id);
    }

    // 更新会员消费（订单完成时调用）
    updateMemberSpending(name, amount, orderInfo = {}) {
        const member = this.findMemberByName(name);
        if (!member) {
            return this.addMember(name, amount);
        }
        const oldLevel = member.level;
        member.spent += amount;
        member.lastOrderDay = this.state.gameTime.day;
        member.orderCount = (member.orderCount || 0) + 1;
        
        // 计算成长值：基础10点 + 每元0.05点
        const growthGained = Math.floor(MEMBER_GROWTH_RULES.order.base + amount * MEMBER_GROWTH_RULES.order.perYuan);
        member.growth = (member.growth || 0) + growthGained;
        
        // 检查等级升级
        const newLevel = this.getMemberLevelByGrowth(member.growth, member.spent);
        member.level = newLevel;
        
        // 计算积分
        const levelInfo = MEMBER_LEVELS.find(l => l.level === newLevel) || MEMBER_LEVELS[0];
        const pointsGained = Math.floor((amount / 10) * (levelInfo.pointsRate || 1));
        member.points = (member.points || 0) + pointsGained;
        
        // 记录到店铺积分和成长值
        this.state.members.points += pointsGained;
        this.state.members.totalPointsEarned = (this.state.members.totalPointsEarned || 0) + pointsGained;
        this.state.members.growth = (this.state.members.growth || 0) + growthGained;
        
        // 记录日志
        this.addPointsLog(member.id, member.name, pointsGained, 'earn_order', `订单消费${formatMoney(amount)}`);
        this.addGrowthLog(member.id, member.name, growthGained, 'order', `订单消费${formatMoney(amount)}`);
        
        // 更新店铺会员等级
        this.updateShopMemberLevel();
        
        // 检查升级提示
        const levelUp = newLevel > oldLevel;
        
        this.notify();
        return { member, levelUp, oldLevel, newLevel, pointsGained, growthGained };
    }

    // 更新店铺（店主）会员等级
    updateShopMemberLevel() {
        const m = this.state.members;
        let level = 1;
        for (let i = MEMBER_LEVELS.length - 1; i >= 0; i--) {
            if ((m.growth || 0) >= MEMBER_LEVELS[i].minGrowth || 
                (this.state.shop.totalSales || 0) >= MEMBER_LEVELS[i].minSpent) {
                level = MEMBER_LEVELS[i].level;
                break;
            }
        }
        m.memberLevel = level;
        return level;
    }

    getMemberDiscount(name) {
        const member = this.findMemberByName(name);
        if (!member) return 1.0;
        const levelInfo = MEMBER_LEVELS.find(l => l.level === member.level) || MEMBER_LEVELS[0];
        return levelInfo.discount;
    }

    hasFreeShipping(name) {
        const member = this.findMemberByName(name);
        if (!member) return false;
        const levelInfo = MEMBER_LEVELS.find(l => l.level === member.level) || MEMBER_LEVELS[0];
        return levelInfo.freeShipping;
    }

    // ====== 积分系统 ======
    addPoints(amount, type = 'earn_activity', desc = '', memberId = null, memberName = null) {
        this.state.members.points = Math.max(0, (this.state.members.points || 0) + amount);
        if (amount > 0) {
            this.state.members.totalPointsEarned = (this.state.members.totalPointsEarned || 0) + amount;
        }
        this.addPointsLog(memberId, memberName, amount, type, desc);
        this.notify();
    }

    addPointsLog(memberId, memberName, amount, type, desc) {
        if (!this.state.members.pointsLogs) this.state.members.pointsLogs = [];
        const log = {
            id: 'pl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            memberId,
            memberName,
            amount,
            type,
            desc,
            day: this.state.gameTime.day,
            hour: this.state.gameTime.hour,
            timestamp: Date.now()
        };
        this.state.members.pointsLogs.unshift(log);
        // 保留最近500条
        if (this.state.members.pointsLogs.length > 500) {
            this.state.members.pointsLogs = this.state.members.pointsLogs.slice(0, 500);
        }
    }

    getPointsLogs(filter = 'all', page = 1, pageSize = 20) {
        let logs = this.state.members.pointsLogs || [];
        if (filter !== 'all') {
            if (filter === 'earn') {
                logs = logs.filter(l => l.amount > 0);
            } else if (filter === 'spend') {
                logs = logs.filter(l => l.amount < 0);
            } else {
                logs = logs.filter(l => l.type === filter);
            }
        }
        const start = (page - 1) * pageSize;
        return logs.slice(start, start + pageSize);
    }

    // ====== 成长值系统 ======
    addGrowth(amount, source = 'order', desc = '', memberId = null, memberName = null) {
        this.state.members.growth = Math.max(0, (this.state.members.growth || 0) + amount);
        this.addGrowthLog(memberId, memberName, amount, source, desc);
        this.updateShopMemberLevel();
        this.notify();
    }

    addGrowthLog(memberId, memberName, amount, source, desc) {
        if (!this.state.members.growthLogs) this.state.members.growthLogs = [];
        const log = {
            id: 'gl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            memberId,
            memberName,
            amount,
            source,
            desc,
            day: this.state.gameTime.day,
            hour: this.state.gameTime.hour,
            timestamp: Date.now()
        };
        this.state.members.growthLogs.unshift(log);
        if (this.state.members.growthLogs.length > 500) {
            this.state.members.growthLogs = this.state.members.growthLogs.slice(0, 500);
        }
    }

    // ====== 会员订单查询 ======
    getMemberOrders(memberName, status = 'all', page = 1, pageSize = 20) {
        let orders = this.state.orders || [];
        if (memberName) {
            orders = orders.filter(o => o.buyerName === memberName);
        }
        if (status !== 'all') {
            orders = orders.filter(o => o.status === status);
        }
        // 按时间倒序
        orders.sort((a, b) => (b.createTime || 0) - (a.createTime || 0));
        const start = (page - 1) * pageSize;
        return {
            list: orders.slice(start, start + pageSize),
            total: orders.length,
            page,
            pageSize,
            totalPages: Math.ceil(orders.length / pageSize)
        };
    }

    // 获取会员统计数据
    getMemberStatistics() {
        const members = this.state.members;
        const list = members.list || [];
        const orders = this.state.orders || [];
        const today = this.state.gameTime.day;
        
        // 活跃会员（近7天有订单）
        const activeMembers = list.filter(m => (m.lastOrderDay || 0) >= today - 7).length;
        
        // 本月新增（简化：近30天）
        const newMembersThisMonth = list.filter(m => (m.joinDay || 0) >= today - 30).length;
        
        // 人均消费
        const totalSpent = list.reduce((sum, m) => sum + (m.spent || 0), 0);
        const averageSpent = list.length > 0 ? Math.round(totalSpent / list.length) : 0;
        
        // 各等级分布
        const levelDistribution = {};
        MEMBER_LEVELS.forEach(l => levelDistribution[l.level] = 0);
        list.forEach(m => {
            if (levelDistribution[m.level] !== undefined) {
                levelDistribution[m.level]++;
            }
        });
        
        // 今日/昨日订单中的会员
        const todayMemberOrders = orders.filter(o => o.isMember && o.createDay === today).length;
        
        const customerPoints = list.reduce((s, m) => s + (Number(m.points) || 0), 0);
        const customerWallet = list.reduce((s, m) => s + (Number(m.wallet) || 0), 0);
        return {
            totalMembers: Math.max(Number(members.total) || 0, list.length),
            activeMembers,
            newMembersThisMonth,
            averageSpent,
            totalGrowth: members.growth || 0,
            totalPoints: customerPoints,
            shopPoolPoints: members.points || 0,
            totalPointsEarned: members.totalPointsEarned || 0,
            totalPointsRedeemed: members.totalPointsRedeemed || 0,
            totalWallet: customerWallet,
            totalRecharge: (members.statistics && members.statistics.totalRecharge) || 0,
            levelDistribution,
            todayMemberOrders,
            shopMemberLevel: members.memberLevel || 1
        };
    }

    _ensureMemberRecharge() {
        const m = this.state.members || (this.state.members = {});
        const def = (typeof DEFAULT_MEMBER_RECHARGE !== 'undefined' && DEFAULT_MEMBER_RECHARGE)
            ? DEFAULT_MEMBER_RECHARGE
            : { enabled: false, rules: [{ pay: 1000, bonus: 50 }] };
        if (!m.recharge || typeof m.recharge !== 'object') {
            m.recharge = JSON.parse(JSON.stringify(def));
        }
        if (!Array.isArray(m.recharge.rules)) m.recharge.rules = JSON.parse(JSON.stringify(def.rules || []));
        if (!Array.isArray(m.rechargeLogs)) m.rechargeLogs = [];
        if (!m.statistics) m.statistics = {};
        return m.recharge;
    }

    getMemberRechargeConfig() {
        return this._ensureMemberRecharge();
    }

    setMemberRechargeEnabled(enabled) {
        const cfg = this._ensureMemberRecharge();
        cfg.enabled = !!enabled;
        this.notify();
        return { success: true, enabled: cfg.enabled, message: cfg.enabled ? '已开启会员充值' : '已关闭会员充值' };
    }

    saveMemberRechargeRules(rules) {
        const cfg = this._ensureMemberRecharge();
        const cleaned = [];
        (rules || []).forEach(r => {
            const pay = Math.round(Number(r && r.pay) || 0);
            const bonus = Math.round(Number(r && r.bonus) || 0);
            if (pay > 0 && bonus >= 0) cleaned.push({ pay, bonus });
        });
        cleaned.sort((a, b) => a.pay - b.pay);
        const uniq = [];
        cleaned.forEach(r => {
            const last = uniq[uniq.length - 1];
            if (last && last.pay === r.pay) last.bonus = r.bonus;
            else uniq.push(r);
        });
        cfg.rules = uniq;
        this.notify();
        return { success: true, rules: uniq, message: '充值奖励已保存' };
    }

    getRechargeBonus(payAmount) {
        const cfg = this._ensureMemberRecharge();
        const pay = Math.round(Number(payAmount) || 0);
        if (!(pay > 0)) return 0;
        let best = 0;
        (cfg.rules || []).forEach(r => {
            if (r && r.pay > 0 && pay >= r.pay) best = Math.max(best, Number(r.bonus) || 0);
        });
        const exact = (cfg.rules || []).find(r => r && r.pay === pay);
        if (exact) return Math.max(0, Number(exact.bonus) || 0);
        return best;
    }

    memberRecharge(memberId, payAmount) {
        const cfg = this._ensureMemberRecharge();
        if (!cfg.enabled) return { success: false, message: '尚未开启会员充值' };
        const member = this.findMemberById(memberId) || this.findMemberByName(memberId);
        if (!member) return { success: false, message: '会员不存在' };
        const pay = Math.round((Number(payAmount) || 0) * 100) / 100;
        if (!(pay > 0)) return { success: false, message: '充值金额无效' };
        const bonus = this.getRechargeBonus(pay);
        const credited = Math.round((pay + bonus) * 100) / 100;
        this.addFunds(pay, `会员充值 - ${member.name}`);
        member.wallet = Math.round(((Number(member.wallet) || 0) + credited) * 100) / 100;
        member.recharged = Math.round(((Number(member.recharged) || 0) + pay) * 100) / 100;
        member.rechargeBonus = Math.round(((Number(member.rechargeBonus) || 0) + bonus) * 100) / 100;
        const st = this.state.members.statistics || (this.state.members.statistics = {});
        st.totalRecharge = Math.round(((Number(st.totalRecharge) || 0) + pay) * 100) / 100;
        st.totalRechargeBonus = Math.round(((Number(st.totalRechargeBonus) || 0) + bonus) * 100) / 100;
        this.state.members.rechargeLogs.unshift({
            id: generateId('rcg'),
            memberId: member.id,
            memberName: member.name,
            pay,
            bonus,
            credited,
            day: this.state.gameTime.day,
            hour: this.state.gameTime.hour
        });
        if (this.state.members.rechargeLogs.length > 200) {
            this.state.members.rechargeLogs = this.state.members.rechargeLogs.slice(0, 200);
        }
        if (bonus > 0) {
            this.addPointsLog(member.id, member.name, 0, 'earn_recharge', `充值¥${pay}到账¥${credited}（含赠送¥${bonus}）`);
        }
        this.notify();
        return {
            success: true,
            pay,
            bonus,
            credited,
            wallet: member.wallet,
            message: `${member.name} 充值¥${pay}，到账¥${credited}${bonus ? `（送¥${bonus}）` : ''}`
        };
    }

    applyMemberWalletToOrder(order) {
        if (!order || !order.buyerName) return 0;
        const member = this.findMemberByName(order.buyerName);
        if (!member) return 0;
        const due = Math.max(0, Number(order.totalAmount) || 0);
        const wallet = Math.max(0, Number(member.wallet) || 0);
        if (!(due > 0) || !(wallet > 0)) return 0;
        const use = Math.round(Math.min(wallet, due) * 100) / 100;
        member.wallet = Math.round((wallet - use) * 100) / 100;
        order.walletPaid = use;
        this.addPointsLog(member.id, member.name, 0, 'spend_wallet', `订单储值抵扣¥${use.toFixed(2)}`);
        return use;
    }

    addListingAsRedeemBenefit(listingId, pointsCost) {
        const listing = (this.state.listings || []).find(l => l && l.id === listingId);
        if (!listing) return { success: false, message: '商品未上架' };
        const cost = Math.max(1, Math.round(Number(pointsCost) || 0));
        const stock = (typeof this.getSellableQuantity === 'function')
            ? this.getSellableQuantity(listing.productId, listing.qualityGrade || 'B')
            : (listing.stock || 0);
        const qty = Math.max(1, Math.min(999, Number(stock) || 1));
        return this.addBenefit({
            name: listing.title || listing.productName || '店内商品',
            icon: '📦',
            type: 'physical',
            pointsCost: cost,
            minLevel: 1,
            stock: qty,
            enabled: true,
            productId: listing.productId,
            listingId: listing.id,
            qualityGrade: listing.qualityGrade || 'B',
            desc: `积分兑换店内商品（${listing.qualityGrade || 'B'}）`
        });
    }
    
    // 会员积分兑换奖品（更新版本，带积分日志）
    redeemReward(params) {
        const { rewardId, memberId, owner = 'shop' } = params || {};
        const reward = MEMBER_REWARDS.find(r => r.id === rewardId);
        if (!reward) return { success: false, message: '奖品不存在' };
        
        let member;
        if (owner === 'member') {
            member = this.state.members.list.find(m => m.id === memberId || m.name === memberId);
            if (!member) return { success: false, message: '会员不存在' };
            if ((member.level || 1) < reward.minLevel) {
                const lv = MEMBER_LEVELS.find(x => x.level === reward.minLevel);
                return { success: false, message: `需达到 ${lv?.name || 'Lv.'+reward.minLevel} 才能兑换` };
            }
            if ((member.points || 0) < reward.pointsCost) return { success: false, message: '会员积分不足' };
        } else {
            if (this.state.members.points < reward.pointsCost) return { success: false, message: '积分不足，还差 ' + (reward.pointsCost - this.state.members.points) + ' 分' };
        }
        
        const used = (this.state.members['redeemCount_' + rewardId] || 0);
        if (used >= reward.stock) return { success: false, message: '奖品已兑完' };
        
        // 扣积分
        if (owner === 'member') {
            member.points -= reward.pointsCost;
        }
        this.state.members.points = Math.max(0, this.state.members.points - reward.pointsCost);
        this.state.members.totalPointsRedeemed = (this.state.members.totalPointsRedeemed || 0) + reward.pointsCost;
        this.state.members['redeemCount_' + rewardId] = used + 1;
        
        // 记录积分支出日志
        this.addPointsLog(member?.id || null, member?.name || null, -reward.pointsCost, 'spend_redeem', `兑换${reward.name}`);
        
        // 发放奖励
        let rewardText = '';
        switch (reward.type) {
            case 'coupon': {
                const typeInfo = COUPON_PRESETS.find(c => c.id === reward.couponTypeId);
                const now = this.state.gameTime;
                
                // 类型映射（使用新的COUPON_PRESETS类型）
                let couponType = typeInfo?.type || 'fixed';
                let couponValue = typeInfo?.value || 5;
                let couponMinAmount = typeInfo?.minAmount || 0;
                
                const templateId = reward.couponTypeId || 'points_redeem';
                let template = this.state.coupons.templates.find(t => t.id === templateId);
                if (!template) {
                    template = {
                        id: templateId,
                        name: typeInfo?.name || reward.name || '优惠券',
                        type: couponType,
                        value: couponValue,
                        minAmount: couponMinAmount,
                        maxDiscount: 0,
                        quantity: 99999,
                        perUserLimit: 99,
                        startDay: now.day,
                        endDay: now.day + 3650,
                        validDays: typeInfo?.expireDays || 7,
                        scope: 'all',
                        scopeIds: [],
                        receiveType: 'points',
                        status: 'active',
                        receivedCount: 0,
                        usedCount: 0,
                        createTime: { day: now.day, hour: now.hour }
                    };
                    this.state.coupons.templates.push(template);
                }
                
                const coupon = {
                    id: this.generateUserCouponId(),
                    templateId: templateId,
                    name: typeInfo?.name || reward.name || '优惠券',
                    type: couponType,
                    value: couponValue,
                    minAmount: couponMinAmount,
                    maxDiscount: 0,
                    scope: 'all',
                    scopeIds: [],
                    status: 'available',
                    receiveTime: { day: now.day, hour: now.hour },
                    expireDay: now.day + (typeInfo?.expireDays || 7),
                    useTime: null,
                    orderId: null,
                    fromPointsRedeem: true
                };
                
                if (!this.state.coupons.userCoupons) this.state.coupons.userCoupons = [];
                this.state.coupons.userCoupons.push(coupon);
                template.receivedCount++;
                
                if (this.state.coupons.statistics) {
                    this.state.coupons.statistics.totalReceived = (this.state.coupons.statistics.totalReceived || 0) + 1;
                }
                rewardText = `已发放 1 张 ${typeInfo?.name || '优惠券'}`;
                break;
            }
            case 'cash': {
                // 店铺积分兑现金红包：按配置「直接到账店铺资金」
                const cashAmt = reward.amount || 0;
                if (cashAmt > 0) {
                    this.addFunds(cashAmt, `积分兑换现金红包-${reward.name || ''}`);
                }
                rewardText = `已到账店铺资金 ${formatMoney(cashAmt)}`;
                break;
            }
            case 'freeship': {
                const n = reward.amount || 1;
                const now = this.state.gameTime;
                for (let i = 0; i < n; i++) {
                    const freeshipCoupon = {
                        id: this.generateUserCouponId(),
                        templateId: 'free_shipping',
                        name: '包邮券',
                        type: 'freeship',
                        value: 0,
                        minAmount: 0,
                        maxDiscount: 0,
                        scope: 'all',
                        scopeIds: [],
                        status: 'available',
                        receiveTime: { day: now.day, hour: now.hour },
                        expireDay: now.day + 30,
                        useTime: null,
                        orderId: null,
                        fromPointsRedeem: true
                    };
                    if (!this.state.coupons.userCoupons) this.state.coupons.userCoupons = [];
                    this.state.coupons.userCoupons.push(freeshipCoupon);
                }
                let fsTpl = this.state.coupons.templates.find(t => t.id === 'free_shipping');
                if (!fsTpl) {
                    fsTpl = {
                        id: 'free_shipping',
                        name: '包邮券',
                        type: 'freeship',
                        value: 0,
                        minAmount: 0,
                        maxDiscount: 0,
                        quantity: 99999,
                        perUserLimit: 99,
                        startDay: now.day,
                        endDay: now.day + 3650,
                        validDays: 30,
                        scope: 'all',
                        scopeIds: [],
                        receiveType: 'points',
                        status: 'active',
                        receivedCount: 0,
                        usedCount: 0,
                        createDay: now.day
                    };
                    this.state.coupons.templates.push(fsTpl);
                }
                fsTpl.receivedCount += n;
                if (this.state.coupons.statistics) {
                    this.state.coupons.statistics.totalReceived = (this.state.coupons.statistics.totalReceived || 0) + n;
                }
                rewardText = `获得 ${n} 张包邮券`;
                break;
            }
            case 'reputation': {
                const n = reward.amount || 1;
                this.state.shop.reputation = Math.max(0, (this.state.shop.reputation || 0) + n);
                rewardText = `店铺信誉 +${n}`;
                break;
            }
        }
        
        // 记录历史
        const h = {
            id: 'rh_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            day: this.state.gameTime.day,
            hour: this.state.gameTime.hour,
            rewardId: reward.id,
            rewardName: reward.name,
            rewardIcon: reward.icon,
            pointsCost: reward.pointsCost,
            memberId: member?.id || null,
            memberName: member?.name || null,
            rewardText: rewardText,
            timestamp: Date.now()
        };
        this.state.members.redeemHistory.push(h);
        if (this.state.members.redeemHistory.length > 500) this.state.members.redeemHistory = this.state.members.redeemHistory.slice(-500);
        
        this.notify();
        return { success: true, history: h, rewardText, reward };
    }
    
    // 有包邮资格时可消耗1次免邮（返回true则本次发货免快递费）
    consumeFreeShipCredit() {
        if ((this.state.members.freeShipCredits || 0) <= 0) return false;
        this.state.members.freeShipCredits--;
        return true;
    }

    // ====== 会员活动 ======
    getAvailableActivities() {
        const day = this.state.gameTime.day;
        const dayOfWeek = this.state.gameTime.dayOfWeek;
        const shopLevel = this.state.members.memberLevel || 1;
        const today = this.state.gameTime.day;
        const dayOfMonth = ((day - 1) % 30) + 1;
        
        return MEMBER_ACTIVITIES.filter(act => {
            if (shopLevel < act.level) return false;
            if (act.weekday && act.weekday !== dayOfWeek) return false;
            if (act.dayOfMonth && act.dayOfMonth !== dayOfMonth) return false;
            return true;
        });
    }

    // 加入活动
    joinActivity(activityId) {
        const act = MEMBER_ACTIVITIES.find(a => a.id === activityId);
        if (!act) return { success: false, message: '活动不存在' };
        
        const joined = this.state.members.activitiesJoined || [];
        const recordKey = activityId + '_' + this.state.gameTime.day;
        if (joined.includes(recordKey)) {
            return { success: false, message: '今日已参与此活动' };
        }
        
        joined.push(recordKey);
        this.state.members.activitiesJoined = joined.slice(-100);
        
        // 发放活动奖励
        const rewardParts = [];
        if (act.reward) {
            if (act.reward.points) {
                this.addPoints(act.reward.points, 'earn_activity', act.title);
                rewardParts.push(`${act.reward.points}积分`);
            }
            if (act.reward.coupon) {
                const issued = this.issueCoupon(act.reward.coupon, 1);
                if (issued && (Array.isArray(issued) ? issued.length : issued)) {
                    rewardParts.push('优惠券');
                }
            }
        }
        
        this.notify();
        const extra = rewardParts.length ? `，获得${rewardParts.join('+')}` : '';
        return { success: true, message: `成功参与「${act.title}」${extra}` };
    }
    
    // ==================== 会员权益系统（卖家可配置版） ====================
    
    // 初始化权益配置（首次使用时调用）
    _initBenefitsConfig() {
        if (!this.state.members.benefitsConfig) {
            this.state.members.benefitsConfig = JSON.parse(JSON.stringify(DEFAULT_BENEFITS_CONFIG));
        }
        if (!this.state.members.benefitsStats) {
            this.state.members.benefitsStats = JSON.parse(JSON.stringify(DEFAULT_BENEFITS_STATS));
        }
        return this.state.members.benefitsConfig;
    }
    
    // 获取权益配置
    getBenefitsConfig() {
        this._initBenefitsConfig();
        return this.state.members.benefitsConfig;
    }
    
    // 获取权益统计
    getBenefitsStats() {
        this._initBenefitsConfig();
        return this.state.members.benefitsStats;
    }
    
    // 获取可用权益列表（买家视角）
    getAvailableBenefits(memberLevel = 1) {
        const config = this._initBenefitsConfig();
        if (!config.redeemRule.enabled) return [];
        return config.benefits
            .filter(b => b.enabled && (b.minLevel || 1) <= memberLevel && b.stock > b.sold)
            .sort((a, b) => (a.sort || 0) - (b.sort || 0));
    }
    
    // 获取所有权益（卖家视角）
    getAllBenefits() {
        const config = this._initBenefitsConfig();
        return config.benefits.sort((a, b) => (a.sort || 0) - (b.sort || 0));
    }
    
    // 添加新权益
    addBenefit(benefitData) {
        const config = this._initBenefitsConfig();
        const newBenefit = {
            id: 'bnf_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            name: benefitData.name || '新权益',
            icon: benefitData.icon || '🎁',
            type: benefitData.type || 'coupon',
            pointsCost: Number(benefitData.pointsCost) || 100,
            minLevel: Number(benefitData.minLevel) || 1,
            stock: Number(benefitData.stock) || 999,
            sold: 0,
            enabled: benefitData.enabled !== false,
            sort: config.benefits.length + 1,
            desc: benefitData.desc || '',
            validDays: Number(benefitData.validDays) || 7,
            ...benefitData
        };
        config.benefits.push(newBenefit);
        this.notify();
        return { success: true, benefit: newBenefit };
    }
    
    // 更新权益
    updateBenefit(benefitId, updates) {
        const config = this._initBenefitsConfig();
        const idx = config.benefits.findIndex(b => b.id === benefitId);
        if (idx === -1) return { success: false, message: '权益不存在' };
        config.benefits[idx] = { ...config.benefits[idx], ...updates };
        this.notify();
        return { success: true, benefit: config.benefits[idx] };
    }
    
    // 删除权益
    deleteBenefit(benefitId) {
        const config = this._initBenefitsConfig();
        const idx = config.benefits.findIndex(b => b.id === benefitId);
        if (idx === -1) return { success: false, message: '权益不存在' };
        config.benefits.splice(idx, 1);
        this.notify();
        return { success: true };
    }
    
    // 切换权益启用状态
    toggleBenefit(benefitId) {
        const config = this._initBenefitsConfig();
        const benefit = config.benefits.find(b => b.id === benefitId);
        if (!benefit) return { success: false, message: '权益不存在' };
        benefit.enabled = !benefit.enabled;
        this.notify();
        return { success: true, enabled: benefit.enabled };
    }
    
    // 更新积分规则
    updatePointsRule(ruleData) {
        const config = this._initBenefitsConfig();
        Object.assign(config.pointsRule, ruleData);
        this.notify();
        return { success: true, pointsRule: config.pointsRule };
    }
    
    // 更新兑换规则
    updateRedeemRule(ruleData) {
        const config = this._initBenefitsConfig();
        Object.assign(config.redeemRule, ruleData);
        this.notify();
        return { success: true, redeemRule: config.redeemRule };
    }
    
    // 买家兑换权益（核心兑换逻辑）
    redeemBenefit(params) {
        const { benefitId, memberId, memberName, quantity = 1 } = params || {};
        const config = this._initBenefitsConfig();
        const stats = this.state.members.benefitsStats;
        
        // 检查兑换是否开启
        if (!config.redeemRule.enabled) {
            return { success: false, message: '积分兑换暂未开启' };
        }
        
        // 查找权益
        const benefit = config.benefits.find(b => b.id === benefitId);
        if (!benefit) return { success: false, message: '权益不存在' };
        if (!benefit.enabled) return { success: false, message: '该权益已下架' };
        
        // 查找会员
        const member = memberId ? this.findMemberById(memberId) : 
                     (memberName ? this.findMemberByName(memberName) : null);
        if (!member) return { success: false, message: '会员不存在' };
        
        // 检查会员等级
        if ((member.level || 1) < benefit.minLevel) {
            const lv = MEMBER_LEVELS.find(l => l.level === benefit.minLevel);
            return { success: false, message: `需${lv?.name || 'Lv.'+benefit.minLevel}及以上才能兑换` };
        }
        
        // 检查库存
        if (benefit.stock - benefit.sold < quantity) {
            return { success: false, message: '库存不足' };
        }
        
        // 计算总积分
        const totalPoints = benefit.pointsCost * quantity;
        if ((member.points || 0) < totalPoints) {
            return { success: false, message: `积分不足，还需${totalPoints - (member.points || 0)}分` };
        }
        
        // 检查每日兑换限制
        const today = this.state.gameTime.day;
        const todayRedeems = this.state.members.redeemOrders.filter(
            r => r.memberId === member.id && r.createDay === today && r.status !== 'cancelled'
        ).length;
        if (todayRedeems + quantity > config.redeemRule.dailyRedeemLimit) {
            return { success: false, message: `每日最多兑换${config.redeemRule.dailyRedeemLimit}次` };
        }

        if (benefit.type === 'physical' && benefit.productId) {
            const have = (typeof this.getSellableQuantity === 'function')
                ? this.getSellableQuantity(benefit.productId, benefit.qualityGrade || 'B')
                : 0;
            if (have < quantity) return { success: false, message: '该商品库存不足，无法兑换' };
        }

        // 扣减积分
        member.points -= totalPoints;
        
        // 更新销量
        benefit.sold += quantity;
        
        // 记录积分日志
        this.addPointsLog(member.id, member.name, -totalPoints, 'spend_redeem', `兑换${benefit.name}x${quantity}`);
        
        // 发放权益奖励
        let rewardText = '';
        let rewardValue = 0;
        const issuedBenefits = [];
        
        for (let i = 0; i < quantity; i++) {
            const issued = this._issueBenefitReward(benefit, member);
            issuedBenefits.push(issued);
            if (issued.value) rewardValue += issued.value;
        }
        rewardText = this._getRewardText(benefit, quantity, rewardValue);
        
        // 创建兑换订单记录
        const redeemOrder = {
            id: 'rdo_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            benefitId: benefit.id,
            benefitName: benefit.name,
            benefitIcon: benefit.icon,
            benefitType: benefit.type,
            pointsCost: benefit.pointsCost,
            quantity: quantity,
            totalPoints: totalPoints,
            memberId: member.id,
            memberName: member.name,
            memberLevel: member.level,
            status: 'pending',
            createDay: this.state.gameTime.day,
            createHour: this.state.gameTime.hour,
            createTime: Date.now(),
            processDay: null,
            shipDay: null,
            completeDay: null,
            cancelDeadline: Date.now() + config.redeemRule.allowCancelMinutes * 60 * 1000,
            rewardText: rewardText,
            rewardValue: rewardValue,
            issuedBenefits: issuedBenefits.map(b => b.id),
            remark: ''
        };
        
        this.state.members.redeemOrders.push(redeemOrder);
        
        // 更新统计
        stats.totalRedeemCount += quantity;
        stats.totalPointsRedeemed += totalPoints;
        stats.totalRedeemValue += rewardValue;
        if (!stats._redeemMembers) stats._redeemMembers = new Set();
        stats._redeemMembers.add(member.id);
        stats.totalRedeemMembers = stats._redeemMembers.size;
        stats.todayRedeemCount += quantity;
        stats.todayRedeemPoints += totalPoints;
        
        // 对于虚拟权益（券类、现金、信誉等），直接完成
        if (['coupon', 'freeship', 'cash', 'reputation', 'service', 'discount', 'credit', 'physical'].includes(benefit.type)) {
            redeemOrder.status = 'completed';
            redeemOrder.completeDay = this.state.gameTime.day;
        }
        
        // 清理临时Set
        if (stats._redeemMembers instanceof Set) {
            // 保留Set但不序列化
        }
        
        // 限制记录数量
        if (this.state.members.redeemOrders.length > 1000) {
            this.state.members.redeemOrders = this.state.members.redeemOrders.slice(-800);
        }
        
        this.notify();
        return { 
            success: true, 
            order: redeemOrder, 
            rewardText,
            message: `兑换成功！${rewardText}`
        };
    }
    
    // 发放权益奖励（内部方法）
    _issueBenefitReward(benefit, member) {
        const issued = {
            id: 'ibn_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            benefitId: benefit.id,
            type: benefit.type,
            issueDay: this.state.gameTime.day,
            expireDay: this.state.gameTime.day + (benefit.validDays || 7)
        };
        let value = 0;
        
        switch (benefit.type) {
            case 'coupon': {
                // 查找或创建对应的优惠券模板
                let couponType = 'fixed';
                let couponValue = benefit.couponValue || 5;
                let couponMinAmount = benefit.minOrderAmount || 0;
                let couponMaxDiscount = 0;
                
                // 从COUPON_PRESETS获取类型信息（如果有的话）
                const preset = COUPON_PRESETS.find(c => c.id === benefit.couponTypeId);
                if (preset) {
                    couponType = preset.type || 'fixed';
                    couponValue = preset.value;
                    couponMinAmount = preset.minAmount || 0;
                } else if (benefit.couponTypeId) {
                    // 自定义权益优惠券配置
                    if (benefit.couponValue) couponValue = benefit.couponValue;
                }
                
                const now = this.state.gameTime;
                const templateId = benefit.couponTypeId || 'redeem_custom';
                
                // 确保模板存在（用于统计）
                let template = this.state.coupons.templates.find(t => t.id === templateId);
                if (!template) {
                    // 动态创建一个模板记录（不影响原有的优惠券领取逻辑）
                    template = {
                        id: templateId,
                        name: benefit.name,
                        type: couponType,
                        value: couponValue,
                        minAmount: couponMinAmount,
                        maxDiscount: couponMaxDiscount,
                        quantity: 99999,
                        perUserLimit: 99,
                        startDay: now.day,
                        endDay: now.day + 3650,
                        validDays: benefit.validDays || 7,
                        scope: 'all',
                        scopeIds: [],
                        receiveType: 'redeem',
                        status: 'active',
                        receivedCount: 0,
                        usedCount: 0,
                        createTime: { day: now.day, hour: now.hour }
                    };
                    this.state.coupons.templates.push(template);
                }
                
                // 创建用户优惠券（与receiveCoupon方法完全一致的结构）
                const coupon = {
                    id: this.generateUserCouponId(),
                    templateId: templateId,
                    name: benefit.name,
                    type: couponType,
                    value: couponValue,
                    minAmount: couponMinAmount,
                    maxDiscount: couponMaxDiscount,
                    scope: 'all',
                    scopeIds: [],
                    status: 'available',
                    receiveTime: { day: now.day, hour: now.hour },
                    expireDay: now.day + (benefit.validDays || 7),
                    useTime: null,
                    orderId: null,
                    fromRedeem: true,
                    memberId: member.id
                };
                
                if (!this.state.coupons.userCoupons) this.state.coupons.userCoupons = [];
                this.state.coupons.userCoupons.push(coupon);
                template.receivedCount++;
                
                if (this.state.coupons.statistics) {
                    this.state.coupons.statistics.totalReceived = (this.state.coupons.statistics.totalReceived || 0) + 1;
                }
                
                // 估算兑换价值
                if (coupon.type === 'freeship') {
                    value = 8; // 包邮券估算价值约8元（平均快递费）
                } else if (coupon.type === 'discount') {
                    value = coupon.minAmount > 0 ? coupon.minAmount * (1 - coupon.value / 10) : coupon.value;
                } else {
                    value = coupon.value || 5;
                }
                issued.couponId = coupon.id;
                break;
            }
            case 'freeship': {
                // 包邮券发放为优惠券（与其他券类型一致）
                const now = this.state.gameTime;
                const n = benefit.amount || 1;
                const freeshipTemplateId = benefit.couponTypeId || 'free_shipping';
                
                for (let i = 0; i < n; i++) {
                    const freeshipCoupon = {
                        id: this.generateUserCouponId(),
                        templateId: freeshipTemplateId,
                        name: benefit.name || '包邮券',
                        type: 'freeship',
                        value: 0,
                        minAmount: benefit.minOrderAmount || 0,
                        maxDiscount: 0,
                        scope: 'all',
                        scopeIds: [],
                        status: 'available',
                        receiveTime: { day: now.day, hour: now.hour },
                        expireDay: now.day + (benefit.validDays || 30),
                        useTime: null,
                        orderId: null,
                        fromRedeem: true,
                        memberId: member.id
                    };
                    if (!this.state.coupons.userCoupons) this.state.coupons.userCoupons = [];
                    this.state.coupons.userCoupons.push(freeshipCoupon);
                }
                
                // 更新统计
                let freeshipTpl = this.state.coupons.templates.find(t => t.id === freeshipTemplateId);
                if (!freeshipTpl) {
                    freeshipTpl = {
                        id: freeshipTemplateId,
                        name: benefit.name || '包邮券',
                        type: 'freeship',
                        value: 0,
                        minAmount: benefit.minOrderAmount || 0,
                        maxDiscount: 0,
                        quantity: 99999,
                        perUserLimit: 99,
                        startDay: now.day,
                        endDay: now.day + 3650,
                        validDays: benefit.validDays || 30,
                        scope: 'all',
                        scopeIds: [],
                        receiveType: 'redeem',
                        status: 'active',
                        receivedCount: 0,
                        usedCount: 0,
                        createDay: now.day
                    };
                    this.state.coupons.templates.push(freeshipTpl);
                }
                freeshipTpl.receivedCount += n;
                
                if (this.state.coupons.statistics) {
                    this.state.coupons.statistics.totalReceived = (this.state.coupons.statistics.totalReceived || 0) + n;
                }
                
                value = 0;
                issued.amount = n;
                break;
            }
            case 'cash': {
                // 权益配置：现金红包 → 到账店铺资金（积分消耗换经营资金）
                const n = benefit.amount || 0;
                if (n > 0) {
                    this.addFunds(n, `会员积分兑换现金红包-` + (member.name || '会员'));
                }
                value = n;
                issued.amount = n;
                break;
            }
            case 'reputation': {
                const n = benefit.amount || 0;
                this.state.shop.reputation = Math.max(0, (this.state.shop.reputation || 0) + n);
                value = n;
                issued.amount = n;
                break;
            }
            case 'service': {
                // 服务类权益记录到memberBenefits
                if (!this.state.members.memberBenefits) this.state.members.memberBenefits = [];
                const serviceBenefit = {
                    id: issued.id,
                    memberId: member.id,
                    serviceType: benefit.serviceType,
                    name: benefit.name,
                    issueDay: issued.issueDay,
                    expireDay: issued.expireDay,
                    used: false
                };
                this.state.members.memberBenefits.push(serviceBenefit);
                value = 0;
                break;
            }
            case 'physical': {
                const pid = benefit.productId;
                const grade = benefit.qualityGrade || 'B';
                if (pid) {
                    const ok = this.removeInventory(pid, 1, grade, {
                        note: '会员积分兑换出库-' + (member.name || '')
                    });
                    if (!ok) {
                        issued.failed = true;
                        issued.message = '库存不足，无法兑换该商品';
                        break;
                    }
                }
                value = 0;
                issued.productId = pid;
                issued.quantity = 1;
                break;
            }
            case 'discount':
            case 'credit':
            default:
                value = 0;
                break;
        }
        
        issued.value = value;
        return issued;
    }
    
    // 获取奖励文本
    _getRewardText(benefit, quantity, value) {
        switch (benefit.type) {
            case 'coupon': return `已发放${quantity}张优惠券`;
            case 'freeship': return `获得${benefit.amount * quantity}次包邮资格`;
            case 'cash': return `${formatMoney(value)}已到账`;
            case 'reputation': return `店铺信誉+${value}`;
            case 'service': return `${benefit.name}已激活，有效期${benefit.validDays}天`;
            case 'physical': return '兑换成功，请等待发货';
            case 'discount': return '折扣权益已发放';
            case 'credit': return `赊购额度已增加`;
            default: return '权益已发放';
        }
    }
    
    // 处理兑换订单（卖家操作）
    processRedeemOrder(orderId, action, data = {}) {
        const orders = this.state.members.redeemOrders;
        const idx = orders.findIndex(o => o.id === orderId);
        if (idx === -1) return { success: false, message: '兑换单不存在' };
        const order = orders[idx];
        
        switch (action) {
            case 'process': // 开始处理
                if (order.status !== 'pending') return { success: false, message: '状态不正确' };
                order.status = 'processing';
                order.processDay = this.state.gameTime.day;
                break;
            case 'ship': // 发货（实物商品）
                if (order.status !== 'processing') return { success: false, message: '请先开始处理' };
                order.status = 'shipped';
                order.shipDay = this.state.gameTime.day;
                order.trackingNo = data.trackingNo || '';
                break;
            case 'complete': // 完成
                if (!['shipped', 'processing', 'pending'].includes(order.status)) {
                    return { success: false, message: '状态不正确' };
                }
                order.status = 'completed';
                order.completeDay = this.state.gameTime.day;
                break;
            case 'cancel': // 取消（退还积分）
                if (order.status === 'completed') return { success: false, message: '已完成的订单无法取消' };
                if (order.status === 'cancelled') return { success: false, message: '订单已取消' };
                // 检查是否在可取消时间内
                if (Date.now() > order.cancelDeadline && order.status !== 'pending') {
                    return { success: false, message: '已超过可取消时间' };
                }
                // 退还积分
                const member = this.findMemberById(order.memberId);
                if (member) {
                    member.points = (member.points || 0) + order.totalPoints;
                    this.addPointsLog(member.id, member.name, order.totalPoints, 'adjust', `取消兑换${order.benefitName}`);
                }
                // 恢复库存
                const config = this._initBenefitsConfig();
                const benefit = config.benefits.find(b => b.id === order.benefitId);
                if (benefit) benefit.sold -= order.quantity;
                
                order.status = 'cancelled';
                order.cancelDay = this.state.gameTime.day;
                order.cancelReason = data.reason || '卖家取消';
                break;
            default:
                return { success: false, message: '未知操作' };
        }
        
        this.notify();
        return { success: true, order };
    }
    
    // 获取会员的兑换记录
    getMemberRedeemOrders(memberId, status = null) {
        let orders = this.state.members.redeemOrders.filter(o => o.memberId === memberId);
        if (status) orders = orders.filter(o => o.status === status);
        return orders.sort((a, b) => b.createTime - a.createTime);
    }
    
    // 获取所有兑换记录（卖家视角）
    getAllRedeemOrders(filter = {}) {
        let orders = [...this.state.members.redeemOrders];
        if (filter.status) orders = orders.filter(o => o.status === filter.status);
        if (filter.benefitType) orders = orders.filter(o => o.benefitType === filter.benefitType);
        if (filter.memberId) orders = orders.filter(o => o.memberId === filter.memberId);
        if (filter.day) orders = orders.filter(o => o.createDay === filter.day);
        return orders.sort((a, b) => b.createTime - a.createTime);
    }
    
    // 获取待处理兑换数量
    getPendingRedeemCount() {
        return this.state.members.redeemOrders.filter(o => o.status === 'pending' || o.status === 'processing').length;
    }
    
    // 获取权益详细报表
    getBenefitsReport(days = 30) {
        const orders = this.state.members.redeemOrders;
        const stats = this.getBenefitsStats();
        const config = this.getBenefitsConfig();
        
        // 按权益分组统计
        const benefitStats = {};
        config.benefits.forEach(b => {
            benefitStats[b.id] = {
                id: b.id,
                name: b.name,
                icon: b.icon,
                type: b.type,
                pointsCost: b.pointsCost,
                sold: b.sold,
                stock: b.stock,
                enabled: b.enabled,
                totalPoints: 0,
                totalValue: 0,
                count: 0
            };
        });
        
        orders.forEach(o => {
            if (benefitStats[o.benefitId] && o.status !== 'cancelled') {
                benefitStats[o.benefitId].count += o.quantity;
                benefitStats[o.benefitId].totalPoints += o.totalPoints;
                benefitStats[o.benefitId].totalValue += o.rewardValue || 0;
            }
        });
        
        // 按销量排序
        const popularBenefits = Object.values(benefitStats)
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);
        
        // 每日统计（最近N天）
        const dailyStats = [];
        const today = this.state.gameTime.day;
        for (let i = days - 1; i >= 0; i--) {
            const day = today - i;
            if (day < 1) continue;
            const dayOrders = orders.filter(o => o.createDay === day && o.status !== 'cancelled');
            dailyStats.push({
                day,
                count: dayOrders.reduce((s, o) => s + o.quantity, 0),
                points: dayOrders.reduce((s, o) => s + o.totalPoints, 0),
                value: dayOrders.reduce((s, o) => s + (o.rewardValue || 0), 0)
            });
        }
        
        // 状态分布
        const statusCounts = {
            pending: orders.filter(o => o.status === 'pending').length,
            processing: orders.filter(o => o.status === 'processing').length,
            shipped: orders.filter(o => o.status === 'shipped').length,
            completed: orders.filter(o => o.status === 'completed').length,
            cancelled: orders.filter(o => o.status === 'cancelled').length
        };
        
        return {
            summary: {
                totalRedeemCount: stats.totalRedeemCount,
                totalPointsRedeemed: stats.totalPointsRedeemed,
                totalRedeemValue: stats.totalRedeemValue,
                totalRedeemMembers: stats.totalRedeemMembers,
                pendingCount: statusCounts.pending + statusCounts.processing + statusCounts.shipped,
                todayCount: stats.todayRedeemCount,
                todayPoints: stats.todayRedeemPoints
            },
            benefitStats: Object.values(benefitStats),
            popularBenefits,
            dailyStats,
            statusCounts,
            pointsRule: config.pointsRule,
            redeemRule: config.redeemRule
        };
    }
    
    // 每日重置（由gameEngine调用）
    dailyBenefitsReset() {
        const stats = this.getBenefitsStats();
        stats.todayRedeemCount = 0;
        stats.todayRedeemPoints = 0;
        
        // 清理过期记录
        const config = this.getBenefitsConfig();
        const retentionDays = config.recordRetentionDays || 90;
        const cutoffDay = this.state.gameTime.day - retentionDays;
        this.state.members.redeemOrders = this.state.members.redeemOrders.filter(
            o => o.createDay >= cutoffDay || o.status === 'pending' || o.status === 'processing'
        );
    }
    
    // ==================== 优惠券系统（快捷发放） ====================
    // 快捷发放优惠券：创建优惠券模板供顾客领取
    issueCoupon(typeId, count = 1) {
        const type = COUPON_PRESETS.find(c => c.id === typeId);
        if (!type) return [];
        if (count <= 0) return [];

        const now = this.state.gameTime;
        
        // 查找是否已有同类型的活跃模板（同类型、同门槛、同一天创建）
        const existingTemplate = this.state.coupons.templates.find(t => {
            if (t.status !== 'active') return false;
            if (t.type !== type.type) return false;
            if (t.value !== type.value) return false;
            if (t.minAmount !== type.minAmount) return false;
            if (t.createTime.day === now.day) return true;
            if (now.day <= t.endDay) return true;
            return false;
        });
        
        let template;
        if (existingTemplate) {
            // 增加已有模板数量
            existingTemplate.quantity += count;
            existingTemplate.endDay = Math.max(existingTemplate.endDay, now.day + type.expireDays);
            if (existingTemplate.status === 'depleted' || existingTemplate.receivedCount < existingTemplate.quantity) {
                existingTemplate.status = 'active';
            }
            template = existingTemplate;
        } else {
            // 创建新模板
            template = {
                id: this.generateCouponId(),
                name: type.name,
                type: type.type,
                value: type.value,
                minAmount: type.minAmount,
                maxDiscount: 0,
                quantity: count,
                perUserLimit: 99, // 快捷发放不限制每人领取数
                startDay: now.day,
                endDay: now.day + type.expireDays,
                validDays: type.expireDays,
                scope: 'all',
                scopeIds: [],
                receiveType: 'quick',
                status: 'active',
                receivedCount: 0,
                usedCount: 0,
                createTime: { day: now.day, hour: now.hour },
                description: '快捷发放'
            };
            this.state.coupons.templates.push(template);
        }
        
        this.state.coupons.statistics.totalIssued += count;
        this.notify();
        
        // 返回结果数组（保持接口兼容）
        return new Array(count).fill(null).map((_, i) => ({
            id: template.id + '_' + i,
            templateId: template.id,
            name: type.name
        }));
    }

    // ==================== 仓储系统 ====================
    getWarehouseCity() {
        return this.state.warehouse.city || 'yiwu';
    }

    getWarehouseLevel() {
        let lv = 1;
        if (this.warehouse && this.warehouse.state && this.warehouse.state.level != null) {
            lv = this.warehouse.state.level;
        } else if (this.state.warehouse && this.state.warehouse.level != null) {
            lv = this.state.warehouse.level;
        }
        return Math.max(1, parseInt(lv, 10) || 1);
    }

    getWarehouseCapacity() {
        // 优先用仓储模块实时容量（升级后立刻生效）
        if (this.warehouse && typeof this.warehouse.getCapacity === 'function') {
            try {
                const cap = this.warehouse.getCapacity();
                if (cap > 0) {
                    if (this.state.warehouse) {
                        this.state.warehouse.capacity = cap;
                        this.state.warehouse.level = this.getWarehouseLevel();
                    }
                    return cap;
                }
            } catch (_) {}
        }
        const levelInfo = WAREHOUSE_LEVELS.find(w => w.level === this.getWarehouseLevel());
        let capacity = levelInfo ? levelInfo.capacity : 100;
        if (this.state.warehouse && this.state.warehouse.startCapacityBonus) {
            capacity += this.state.warehouse.startCapacityBonus;
        }
        return capacity;
    }

    getUsedCapacity() {
        if (this.warehouse && typeof this.warehouse.getUsedCapacity === 'function') {
            try {
                const used = this.warehouse.getUsedCapacity();
                if (this.state.warehouse) {
                    this.state.warehouse.used = used;
                    this.state.warehouse.usedCapacity = used;
                }
                return used;
            } catch (_) {}
        }
        return (this.state.inventory || []).reduce((sum, item) => sum + (item.quantity || 0), 0);
    }

    upgradeWarehouse() {
        // 有新仓储模块时走模块升级，保证等级/容量双写一致
        if (this.warehouse && typeof this.warehouse.upgrade === 'function') {
            const result = this.warehouse.upgrade();
            if (result && result.success) {
                try { this.warehouse.syncCapacityToGameState(); } catch (_) {}
                this.notify();
            }
            return result;
        }
        const currentLevel = this.getWarehouseLevel();
        const curInfo = WAREHOUSE_LEVELS.find(w => w.level === currentLevel);
        const nextLevel = WAREHOUSE_LEVELS.find(w => w.level === currentLevel + 1);
        if (!nextLevel) return { success: false, message: '已达最高等级' };
        const cost = Number(curInfo && curInfo.upgradeCost) || 0;
        if (cost <= 0) return { success: false, message: '已达最高等级' };

        if (this.state.shop.funds < cost) {
            return { success: false, message: '资金不足' };
        }

        this.spendFunds(cost, `仓库升级到${nextLevel.name}`);
        this.state.warehouse.level = nextLevel.level;
        this.state.warehouse.capacity = nextLevel.capacity + (this.state.warehouse.startCapacityBonus || 0);
        this.notify();
        return { success: true, level: nextLevel.level };
    }

    canAddStock(quantity) {
        const capacity = this.getWarehouseCapacity();
        const used = this.getUsedCapacity();
        return used + quantity <= capacity;
    }
    
    // 低库存预警：返回库存数量<=阈值的商品列表（按product汇总）
    getLowStockItems() {
        const threshold = this.state.warehouse.lowStockThreshold || 20;
        const map = new Map();
        this.state.inventory.forEach(it => {
            const key = it.productId + '|' + (it.qualityGrade || 'B');
            const cur = map.get(key) || { productId: it.productId, qualityGrade: it.qualityGrade || 'B', quantity: 0, costValue: 0 };
            cur.quantity += it.quantity;
            cur.costValue += it.quantity * (it.costPrice || 0);
            map.set(key, cur);
        });
        return [...map.values()].filter(x => x.quantity <= threshold).map(x => {
            const prod = getProductById(x.productId);
            x.productName = prod?.name || x.productId;
            return x;
        }).sort((a,b) => a.quantity - b.quantity);
    }
    
    setLowStockThreshold(n) {
        this.state.warehouse.lowStockThreshold = Math.max(0, parseInt(n) || 0);
        this.notify();
    }
    
    // 获取库存总价值（成本价）
    getInventoryTotalValue() {
        return this.state.inventory.reduce((s, it) => s + it.quantity * (it.costPrice || 0), 0);
    }

    // ==================== 包装材料管理 ====================
    // 获取包装材料库存（⚠️ quantity 统一走 getPackagingMaterial(id) 取数，保证与 getAllPackagingMaterials 一致
    getPackagingMaterials() {
        const result = {};
        Object.entries(PACKAGING_MATERIALS).forEach(([key, cfg]) => {
            if (!cfg || cfg.active === false) return; // 包材精简：废弃材料不展示
            const qty = this.getPackagingMaterial(key);
            result[key] = {
                ...cfg,
                quantity: qty,
                totalValue: Math.round(qty * cfg.cost * 10000) / 10000
            };
        });
        return result;
    }

    // 采购包装材料
    purchasePackagingMaterials(materialId, quantity, unitCost) {
        // 包材精简：废弃 SKU 自动转核心材料
        if (typeof PACKAGING_MATERIAL_ALIASES !== 'undefined' && PACKAGING_MATERIAL_ALIASES[materialId]) {
            materialId = PACKAGING_MATERIAL_ALIASES[materialId];
        }
        const cfg = PACKAGING_MATERIALS[materialId];
        if (!cfg) return { success: false, message: '未知的包装材料类型' };
        if (quantity <= 0) return { success: false, message: '采购数量必须大于0' };
        
        const cost = Math.round((unitCost || cfg.cost) * quantity * 100) / 100;
        if (!this.spendFunds(cost, `采购${cfg.name} x${quantity}`)) {
            return { success: false, message: '资金不足' };
        }

        if (!this.state.warehouse.packagingMaterials) {
            this.state.warehouse.packagingMaterials = {};
        }
        this.state.warehouse.packagingMaterials[materialId] = (this.state.warehouse.packagingMaterials[materialId] || 0) + quantity;

        // 记录日志
        if (!this.state.warehouse.packagingLogs) {
            this.state.warehouse.packagingLogs = [];
        }
        this.state.warehouse.packagingLogs.unshift({
            id: generateId('pm'),
            type: 'purchase',
            materialId,
            materialName: cfg.name,
            quantity,
            unitCost: unitCost || cfg.cost,
            totalCost: cost,
            day: this.state.gameTime.day,
            hour: this.state.gameTime.hour,
            timestamp: Date.now()
        });
        if (this.state.warehouse.packagingLogs.length > 200) {
            this.state.warehouse.packagingLogs = this.state.warehouse.packagingLogs.slice(0, 200);
        }

        this.addWarehouseLog('package_in', {
            materialId,
            materialName: cfg.name,
            quantity,
            cost,
            memo: '采购入库'
        });

        this.notify();
        return { success: true, message: `成功采购${cfg.name} x${quantity}` };
    }

    // 消耗包装材料（发货打包时调用）
    consumePackagingMaterials(order) {
        const pm = this.state.warehouse.packagingMaterials || {};
        const items = order.items || [];
        const totalQty = items.reduce((s, it) => s + it.quantity, 0);

        const consumed = { carton: 0, bubbleWrap: 0, tape: 0 };
        
        // 根据配置计算消耗量（包/卷按张折算的不可整包向上取整）
        Object.entries(PACKAGING_MATERIALS).forEach(([key, cfg]) => {
            if (cfg.consumption) {
                let need = cfg.consumption.base + cfg.consumption.perItem * totalQty;
                // 统一单位折算：胶带/面单等按卷·包小数消耗，禁止 Math.ceil 成整卷
                if (typeof normalizePackagingConsumeQty === 'function') {
                    need = normalizePackagingConsumeQty(cfg, need);
                } else {
                    const packSheets = Number(cfg.spec && cfg.spec.quantity) || 0;
                    if (packSheets > 1 && (cfg.unit === '包' || cfg.unit === '卷')) {
                        const sheetUnit = 1 / packSheets;
                        need = Math.ceil(need / sheetUnit - 1e-9) * sheetUnit;
                        need = Math.round(need * 10000) / 10000;
                    } else if (cfg.unit === '卷' || cfg.unit === '米' || cfg.unit === 'kg') {
                        need = Math.ceil(need * 1000 - 1e-9) / 1000;
                    } else {
                        need = Math.ceil(need);
                    }
                }
                if (need > 0) consumed[key] = need;
            }
        });

        // 检查库存是否足够
        let insufficient = [];
        Object.entries(consumed).forEach(([key, need]) => {
            if (need > 0 && (pm[key] || 0) < need) {
                insufficient.push({ 
                    materialId: key, 
                    materialName: PACKAGING_MATERIALS[key].name, 
                    need, have: pm[key] || 0 
                });
            }
        });

        let autoBuyCost = 0;
        if (insufficient.length > 0) {
            // 包装材料不足时，自动紧急采购（加价50%）
            insufficient.forEach(item => {
                const cfg = PACKAGING_MATERIALS[item.materialId];
                const buyQty = item.need - item.have;
                const tier = cfg.priceTiers[0]; // 散买价格
                autoBuyCost += tier.price * buyQty * 1.5;
            });
            
            if (autoBuyCost > 0) {
                this.spendFunds(Math.round(autoBuyCost), '紧急采购包装材料');
            }
        }

        // 扣减库存（不足部分已通过紧急采购补充，所以可以正常扣减）
        Object.entries(consumed).forEach(([key, qty]) => {
            if (qty > 0) {
                pm[key] = Math.max(0, (pm[key] || 0) - qty);
            }
        });

        this.state.warehouse.packagingMaterials = pm;
        this.notify();
        return { success: true, consumed, autoBuyCost: Math.round(autoBuyCost) };
    }

    // 获取包装材料库存预警
    getPackagingAlerts() {
        if (!this.state || !this.state.warehouse || !this.state.gameTime) return [];
        const pm = this.state.warehouse.packagingMaterials || {};
        const alerts = [];
        // 使用新的 getAllPackagingMaterials 包含自定义材料
        const allMaterials = this.getAllPackagingMaterials();
        Object.entries(allMaterials).forEach(([key, cfg]) => {
            const qty = pm[key] || 0;
            const threshold = (typeof cfg.lowStockThreshold === 'number')
                ? cfg.lowStockThreshold
                : (key === 'tape' ? 1 : key === 'carton' ? 5 : 10);
            if (qty < threshold) {
                alerts.push({
                    materialId: key,
                    ...cfg,
                    quantity: qty,
                    threshold,
                    level: qty === 0 ? 'critical' : (qty < threshold * 0.4 ? 'high' : 'warning')
                });
            }
        });
        // 超储预警：库存超过阈值5倍以上时提示
        Object.entries(allMaterials).forEach(([key, cfg]) => {
            const qty = pm[key] || 0;
            const threshold = (typeof cfg.lowStockThreshold === 'number') ? cfg.lowStockThreshold : 20;
            if (qty >= threshold * 5 && threshold > 0) {
                alerts.push({
                    materialId: key, ...cfg, quantity: qty,
                    threshold: threshold * 5, level: 'overstock'
                });
            }
        });
        return alerts;
    }

    // ==================== 包装材料ERP模块核心方法（新增） ====================
    // 1. 返回所有材料（内置PACKAGING_MATERIALS + 用户自定义材料）
    // ⚠️ quantity/inventoryCost 统一走 getPackagingMaterial(id) 取数，保证
    //    getPackagingMaterials() / getAllPackagingMaterials() / getPackagingMaterial(id) 三处 100% 一致
    getAllPackagingMaterials() {
        if (!this.state) {
            const res = {};
            Object.entries(PACKAGING_MATERIALS).forEach(([k, v]) => { if (!v || v.active === false) return; res[k] = { ...v, _builtin: true, quantity: 0, inventoryCost: 0 }; });
            return res;
        }
        const custom = (this.state.warehouse && this.state.warehouse.packagingCustomMaterials) || {};
        const overrides = (this.state.warehouse && this.state.warehouse.packagingMaterialOverrides) || {};
        const result = {};
        Object.entries(PACKAGING_MATERIALS).forEach(([k, v]) => {
            if (!v || v.active === false) return; // 3.6 极简：废弃材料不进入任何清单
            const qty = this.getPackagingMaterial(k);
            result[k] = {
                ...v,
                ...(overrides[k] || {}),
                _builtin: true,
                quantity: qty,
                inventoryCost: Math.round(qty * (v.cost || 0) * 10000) / 10000
            };
        });
        Object.entries(custom).forEach(([k, v]) => {
            if (!result[k]) {
                const qty = this.getPackagingMaterial(k);
                result[k] = { ...v, _builtin: false, quantity: qty, inventoryCost: Math.round(qty * (v.cost || 0) * 10000) / 10000 };
            }
        });
        return result;
    }

    // 2. 新增/更新自定义包装材料（材料信息录入）
    addCustomPackagingMaterial(material) {
        if (!material || !material.id || !material.name) {
            return { success: false, message: '材料ID和名称必填' };
        }
        if (PACKAGING_MATERIALS[material.id]) {
            return { success: false, message: '材料ID已存在于内置库，请更换ID' };
        }
        const custom = this.state.warehouse.packagingCustomMaterials || {};
        const now = { day: this.state.gameTime.day, hour: this.state.gameTime.hour };
        const merged = {
            id: material.id,
            category: material.category || 'carton_box',
            name: material.name || '新包装材料',
            icon: material.icon || '📦',
            description: material.description || '',
            unit: material.unit || '个',
            cost: parseFloat(material.cost) || 1,
            suitableWeight: material.suitableWeight || null,
            spec: material.spec || {},
            lowStockThreshold: parseInt(material.lowStockThreshold) || 20,
            consumption: material.consumption || { base: 0, perItem: 0 },
            priceTiers: Array.isArray(material.priceTiers) && material.priceTiers.length
                ? material.priceTiers
                : [{ minQty: 1, price: (parseFloat(material.cost) || 1) * 1.3, name: '散买' }],
            _createdAt: now
        };
        custom[material.id] = { ...(custom[material.id] || {}), ...merged, _updatedAt: now };
        this.state.warehouse.packagingCustomMaterials = custom;
        // 初始库存为0
        if (!(this.state.warehouse.packagingMaterials || {})[material.id]) {
            this.state.warehouse.packagingMaterials = this.state.warehouse.packagingMaterials || {};
            this.state.warehouse.packagingMaterials[material.id] = 0;
        }
        this._appendPackagingLog({ type: 'create_material', materialId: material.id, materialName: material.name });
        this.notify();
        return { success: true, message: `已保存材料：${material.name}` };
    }

    // 3. 更新材料规格参数
    updatePackagingMaterialSpec(id, patch) {
        if (!id || !patch) return { success: false, message: '参数缺失' };
        // 内置材料仅允许更新 lowStockThreshold 和自定义备注；自定义材料可任意更新
        if (PACKAGING_MATERIALS[id]) {
            const allowed = ['lowStockThreshold', 'note', 'userSpec'];
            Object.keys(patch).forEach(k => {
                if (allowed.indexOf(k) < 0) delete patch[k];
            });
        }
        const custom = this.state.warehouse.packagingCustomMaterials || {};
        if (custom[id]) {
            custom[id] = { ...custom[id], ...patch, _updatedAt: { day: this.state.gameTime.day, hour: this.state.gameTime.hour } };
            this.state.warehouse.packagingCustomMaterials = custom;
            this.notify();
            return { success: true, message: `已更新：${custom[id].name}` };
        }
        // 内置材料更新阈值：直接在 packagingMaterials 里存一个覆盖配置
        if (PACKAGING_MATERIALS[id]) {
            this.state.warehouse.packagingMaterialOverrides = this.state.warehouse.packagingMaterialOverrides || {};
            this.state.warehouse.packagingMaterialOverrides[id] = {
                ...(this.state.warehouse.packagingMaterialOverrides[id] || {}), ...patch
            };
            this.notify();
            return { success: true, message: '已更新内置材料配置' };
        }
        return { success: false, message: '材料不存在' };
    }

    // 4. 创建采购申请单（草稿状态，待审批）
    createPackagingPurchaseReq({ items, supplierId, remark }) {
        if (!Array.isArray(items) || items.length === 0) {
            return { success: false, message: '请至少添加一项采购材料' };
        }
        const allMats = this.getAllPackagingMaterials();
        let estimatedTotal = 0;
        const normalizedItems = items.map(it => {
            const mat = allMats[it.materialId];
            if (!mat) throw new Error(`材料不存在：${it.materialId}`);
            const qty = Math.max(0, parseInt(it.quantity) || 0);
            // 找最佳价格档位
            let unitPrice = (mat.priceTiers && mat.priceTiers.length) ? mat.priceTiers[0].price : (mat.cost * 1.3);
            for (const t of (mat.priceTiers || [])) if (qty >= t.minQty) unitPrice = t.price;
            estimatedTotal += unitPrice * qty;
            return {
                materialId: it.materialId, materialName: mat.name,
                icon: mat.icon, unit: mat.unit, quantity: qty, unitPrice,
                subtotal: Math.round(unitPrice * qty * 100) / 100,
                category: mat.category, specSnapshot: mat.spec || null
            };
        }).filter(it => it.quantity > 0);
        if (normalizedItems.length === 0) return { success: false, message: '采购数量必须大于0' };
        const supplier = supplierId
            ? (PACKAGING_SUPPLIERS.find(s => s.id === supplierId) || null)
            : null;
        estimatedTotal = Math.round(estimatedTotal * 100) / 100;
        const req = {
            id: 'pkg_req_' + Date.now().toString(36) + Math.floor(Math.random()*1000),
            status: 'draft',
            items: normalizedItems,
            supplierId: supplierId || null,
            supplierName: supplier ? supplier.name : '市场散买（无供应商）',
            supplierRating: supplier ? supplier.rating : null,
            supplierDeliveryDays: supplier ? supplier.deliveryDays : 3,
            totalAmount: estimatedTotal,
            remark: remark || '',
            history: [{
                action: 'create', status: 'draft',
                day: this.state.gameTime.day, hour: this.state.gameTime.hour,
                operator: '店主', remark: '创建草稿'
            }],
            createdDay: this.state.gameTime.day,
            estimatedArrivalDay: null,
            receivedDay: null,
            actualCost: null
        };
        this.state.warehouse.packagingPurchaseReqs = this.state.warehouse.packagingPurchaseReqs || [];
        this.state.warehouse.packagingPurchaseReqs.unshift(req);
        this.notify();
        return { success: true, req, message: `已创建采购申请（¥${estimatedTotal}）` };
    }

    // 5. 采购申请单状态流转（状态机：draft→pending→approved→purchasing→received；或rejected/canceled）
    transitionPackagingPurchaseReq(reqId, action, remark = '') {
        const reqs = this.state.warehouse.packagingPurchaseReqs || [];
        const req = reqs.find(r => r.id === reqId);
        if (!req) return { success: false, message: '申请单不存在' };
        const statusCfg = PACKAGING_PURCHASE_STATUS.find(s => s.code === req.status);
        if (!statusCfg) return { success: false, message: '状态异常' };
        // action 映射：submit/approve/reject/confirm_purchase/receive/cancel
        const actionMap = {
            submit:   { from: 'draft',      to: 'pending'    },
            approve:  { from: 'pending',    to: 'approved'   },
            reject:   { from: 'pending',    to: 'rejected'   },
            confirm_purchase: { from: 'approved', to: 'purchasing' },
            receive:  { from: 'purchasing', to: 'received'   },
            cancel:   { from: null,         to: 'canceled'   } // cancel允许任意非终态
        };
        const rule = actionMap[action];
        if (!rule) return { success: false, message: '未知操作' };
        if (action !== 'cancel' && statusCfg.next.indexOf(rule.to) < 0) {
            return { success: false, message: `当前状态"${statusCfg.name}"不允许此操作` };
        }
        if (action === 'cancel' && (req.status === 'received' || req.status === 'canceled')) {
            return { success: false, message: '已终态的单据不可取消' };
        }
        const now = { day: this.state.gameTime.day, hour: this.state.gameTime.hour };
        // 执行动作
        const prevStatus = req.status;
        req.status = rule.to;
        req.history.push({
            action, status: rule.to, day: now.day, hour: now.hour,
            operator: '店主', remark
        });
        // ===== side effect: 不同动作联动 =====
        if (action === 'confirm_purchase') {
            // ①审批通过确认采购：立即扣款（因为要向供应商付款）+记录预计到货日
            if (!this.spendFunds(req.totalAmount, `包装材料采购单 ${req.id.substr(-6)}`)) {
                // 回滚状态
                req.status = prevStatus;
                req.history.pop();
                return { success: false, message: '资金不足，无法确认采购' };
            }
            req.actualCost = req.totalAmount;
            req.estimatedArrivalDay = now.day + req.supplierDeliveryDays;
        }
        if (action === 'receive') {
            // ②入库：增加每种材料库存 + 写完整出入库日志 + 写成本记录
            const pm = this.state.warehouse.packagingMaterials || {};
            let totalQty = 0;
            req.items.forEach(it => {
                pm[it.materialId] = parseFloat(((pm[it.materialId] || 0) + it.quantity).toFixed(4));
                totalQty += it.quantity;
                // 写完整出入库明细
                this._appendPackagingInventoryLog({
                    type: 'inbound', subtype: 'purchase',
                    materialId: it.materialId, materialName: it.materialName, icon: it.icon, unit: it.unit,
                    quantity: it.quantity, unitCost: it.unitPrice,
                    subtotal: it.subtotal, relatedId: req.id,
                    supplierId: req.supplierId, supplierName: req.supplierName,
                    day: now.day, hour: now.hour, remark: '采购入库'
                });
            });
            this.state.warehouse.packagingMaterials = pm;
            this._syncPackagingMaterialsToWarehouseState(true);
            req.receivedDay = now.day;
            this._appendPackagingLog({ type: 'req_received', reqId: req.id, totalQty, totalCost: req.actualCost, memo: remark });
            this.addWarehouseLog('package_in', { memo: `采购入库${totalQty}件（采购单${req.id.substr(-6)}）` });
            // 记录当日成本聚合
            this._accumulatePackagingCost('purchase_cost', req.actualCost, now.day);
        }
        if (action === 'cancel' && prevStatus === 'purchasing') {
            // 取消采购中单据：退款
            const refund = req.actualCost || req.totalAmount;
            this.addFunds(refund, `取消包装材料采购单 ${req.id.substr(-6)} 退款`);
        }
        this.notify();
        const targetName = (PACKAGING_PURCHASE_STATUS.find(s => s.code === rule.to) || {}).name;
        return { success: true, req, message: `已流转至"${targetName}"` };
    }

    // 6. 查询采购申请单
    getPackagingPurchaseReqs(filters = {}) {
        if (!this.state || !this.state.warehouse) return { list: [], total: 0, counts: this._countPackagingReqs([]) };
        const reqs = this.state.warehouse.packagingPurchaseReqs || [];
        let list = [...reqs];
        if (filters.status && filters.status !== 'all') {
            list = list.filter(r => r.status === filters.status);
        }
        if (filters.supplierId) list = list.filter(r => r.supplierId === filters.supplierId);
        if (filters.keyword) {
            const kw = filters.keyword.toLowerCase();
            list = list.filter(r =>
                r.id.toLowerCase().indexOf(kw) >= 0 ||
                (r.remark || '').toLowerCase().indexOf(kw) >= 0 ||
                (r.items || []).some(it => (it.materialName || '').toLowerCase().indexOf(kw) >= 0)
            );
        }
        return { list, total: list.length, counts: this._countPackagingReqs(reqs) };
    }

    _countPackagingReqs(reqs) {
        const counts = {};
        (PACKAGING_PURCHASE_STATUS || []).forEach(s => { counts[s.code] = 0; });
        reqs.forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });
        counts.all = reqs.length;
        return counts;
    }

    // 7. 完整出入库明细
    getPackagingInventoryLogs(filters = {}) {
        if (!this.state || !this.state.warehouse) return [];
        const logs = [...(this.state.warehouse.packagingInventoryLogs || [])];
        let result = logs;
        if (filters.type && filters.type !== 'all') {
            result = result.filter(l => l.type === filters.type);
        }
        if (filters.materialId) result = result.filter(l => l.materialId === filters.materialId);
        if (filters.days && parseInt(filters.days) > 0 && this.state.gameTime) {
            const cutoff = this.state.gameTime.day - parseInt(filters.days);
            result = result.filter(l => l.day >= cutoff);
        }
        return result.slice(0, 500);
    }

    // 8. 写入出入库明细
    _appendPackagingInventoryLog(log) {
        if (!this.state || !this.state.warehouse || !this.state.gameTime) return;
        const arr = this.state.warehouse.packagingInventoryLogs || [];
        arr.unshift({ id: 'pkglog_' + Math.random().toString(36).slice(2, 8), ...log });
        if (arr.length > 2000) arr.length = 2000;
        this.state.warehouse.packagingInventoryLogs = arr;
    }
    _appendPackagingLog(log) {
        if (!this.state || !this.state.warehouse || !this.state.gameTime) return;
        const arr = this.state.warehouse.packagingLogs || [];
        arr.unshift({ id: 'pl_' + Math.random().toString(36).slice(2, 8),
            day: this.state.gameTime.day, hour: this.state.gameTime.hour, ...log });
        if (arr.length > 500) arr.length = 500;
        this.state.warehouse.packagingLogs = arr;
    }
    _accumulatePackagingCost(item, amount, day) {
        if (!this.state || !this.state.warehouse) return;
        const stats = this.state.warehouse.packagingCostStats || {};
        const key = 'D' + day;
        stats[key] = stats[key] || { day, purchase_cost: 0, auto_emergency_cost: 0, storage_cost: 0, material_waste: 0, packagingFeeByOrder: 0, ordersShipped: 0, salesAmount: 0 };
        stats[key][item] = (stats[key][item] || 0) + (parseFloat(amount) || 0);
        this.state.warehouse.packagingCostStats = stats;
    }

    // 9. 成本聚合统计
    getPackagingCostStats(dimension = 'day', limit = 30) {
        if (!this.state || !this.state.warehouse) {
            return { trend: [], summary: { purchase_cost: 0, auto_emergency_cost: 0, storage_cost: 0, material_waste: 0, ordersShipped: 0, salesAmount: 0 }, currentInventoryCost: 0 };
        }
        const stats = this.state.warehouse.packagingCostStats || {};
        const days = Object.values(stats).sort((a, b) => b.day - a.day).slice(0, limit);
        const allMats = this.getAllPackagingMaterials();
        const pm = this.state.warehouse.packagingMaterials || {};
        // 平均库存成本（按材料当前库存 * 成本）
        let avgInventoryCost = 0;
        Object.entries(pm).forEach(([id, qty]) => {
            if (allMats[id]) avgInventoryCost += qty * (allMats[id].cost || 0);
        });
        return {
            trend: days,
            summary: days.reduce((acc, d) => {
                acc.purchase_cost += d.purchase_cost || 0;
                acc.auto_emergency_cost += d.auto_emergency_cost || 0;
                acc.storage_cost += d.storage_cost || 0;
                acc.material_waste += d.material_waste || 0;
                acc.ordersShipped += d.ordersShipped || 0;
                acc.salesAmount += d.salesAmount || 0;
                return acc;
            }, { purchase_cost: 0, auto_emergency_cost: 0, storage_cost: 0, material_waste: 0, ordersShipped: 0, salesAmount: 0 }),
            currentInventoryCost: Math.round(avgInventoryCost * 100) / 100
        };
    }

    // 10. KPI报表
    getPackagingReports() {
        if (!this.state || !this.state.gameTime || !this.state.warehouse) {
            // 空数据：返回框架性结果
            const emptyKpis = (PACKAGING_REPORT_CONFIG && PACKAGING_REPORT_CONFIG.kpis)
                ? Object.keys(PACKAGING_REPORT_CONFIG.kpis).map(id => ({ id, value: 0, trend: '-' }))
                : [];
            const cats = (PACKAGING_CATEGORIES && Object.values(PACKAGING_CATEGORIES)) || [];
            return {
                kpis: emptyKpis,
                byCategory: cats.map(c => ({ id: c.id, name: c.name, icon: c.icon, color: c.color, kinds: 0, qty: 0, cost: 0, unit: '' })),
                counters: {
                    materialKinds: Object.keys(PACKAGING_MATERIALS || {}).length,
                    suppliers: Object.keys(PACKAGING_SUPPLIERS || {}).length,
                    currentInventoryCost: 0,
                    last30PurchaseCost: 0,
                    pendingReqs: 0,
                    urgentAlerts: 0,
                    allAlerts: 0
                }
            };
        }
        const today = this.state.gameTime.day;
        const stats = this.getPackagingCostStats('day', Math.min(60, today));
        const s = stats.summary;
        const alerts = this.getPackagingAlerts();
        const allMats = this.getAllPackagingMaterials();
        const totalKinds = Object.keys(allMats).length;
        const lowStock = alerts.filter(a => a.level === 'warning' || a.level === 'critical' || a.level === 'high').length;
        const reqs = this.state.warehouse.packagingPurchaseReqs || [];
        const monthReqs = reqs.filter(r => r.createdDay >= today - 30);
        const totalPurchase = monthReqs.filter(r => r.status === 'received').reduce((a, r) => a + (r.actualCost || 0), 0);
        const emergencyCost = s.auto_emergency_cost || 0;
        // KPI 计算
        const turnover = s.ordersShipped > 0 && stats.currentInventoryCost > 0
            ? parseFloat(((s.purchase_cost + emergencyCost) * 6 / Math.max(stats.currentInventoryCost, 1)).toFixed(2))
            : 0;
        const pkgPerOrder = s.ordersShipped > 0
            ? parseFloat(((s.purchase_cost + emergencyCost) / s.ordersShipped).toFixed(3))
            : 0;
        const pkgRatio = s.salesAmount > 0
            ? parseFloat(((s.purchase_cost + emergencyCost) / s.salesAmount * 100).toFixed(2))
            : 0;
        const urgentRate = (totalPurchase + emergencyCost) > 0
            ? parseFloat((emergencyCost / (totalPurchase + emergencyCost) * 100).toFixed(2))
            : 0;
        const stockAdherence = totalKinds > 0
            ? parseFloat(((totalKinds - lowStock) / totalKinds * 100).toFixed(1))
            : 100;
        return {
            kpis: [
                { id: 'turnover_rate',   value: turnover,       unit: '次/月' },
                { id: 'pkg_per_order',   value: pkgPerOrder,   unit: '元/单' },
                { id: 'pkg_ratio',       value: pkgRatio,       unit: '%' },
                { id: 'urgent_rate',     value: urgentRate,     unit: '%' },
                { id: 'stock_adherence', value: stockAdherence, unit: '%' }
            ],
            counters: {
                materialKinds: totalKinds,
                lowStock,
                pendingReqs: reqs.filter(r => ['draft','pending','approved','purchasing'].indexOf(r.status) >= 0).length,
                suppliers: PACKAGING_SUPPLIERS.length,
                currentInventoryCost: stats.currentInventoryCost,
                last30PurchaseCost: Math.round((totalPurchase + emergencyCost) * 100) / 100
            },
            byCategory: this._sumInventoryByCategory(),
            byTopCost: this._topCostMaterials(10),
            trend: stats.trend.reverse() // 按天从小到大用于图表
        };
    }

    _sumInventoryByCategory() {
        const allMats = this.getAllPackagingMaterials();
        const pm = this.state.warehouse.packagingMaterials || {};
        const byCat = {};
        (PACKAGING_CATEGORIES || []).forEach(c => { byCat[c.id] = { ...c, qty: 0, cost: 0, kinds: 0 }; });
        Object.entries(allMats).forEach(([id, m]) => {
            const catId = m.category || 'carton_box';
            if (!byCat[catId]) byCat[catId] = { id: catId, name: catId, icon: '📦', color: '#999', qty: 0, cost: 0, kinds: 0 };
            const qty = pm[id] || 0;
            byCat[catId].qty += qty;
            byCat[catId].cost += qty * (m.cost || 0);
            byCat[catId].kinds++;
        });
        return Object.values(byCat);
    }
    _topCostMaterials(n = 10) {
        const allMats = this.getAllPackagingMaterials();
        const pm = this.state.warehouse.packagingMaterials || {};
        const arr = Object.entries(allMats).map(([id, m]) => ({
            id, name: m.name, icon: m.icon, unit: m.unit,
            category: m.category,
            qty: pm[id] || 0,
            unitCost: m.cost || 0,
            totalCost: (pm[id] || 0) * (m.cost || 0)
        }));
        return arr.sort((a, b) => b.totalCost - a.totalCost).slice(0, n);
    }

    // 11. 智能打包消耗 v3：统一复用 getPackagingFormula 与 calculatePackagingMaterialFee() 100% 一致
    // 之前版本一堆散 if，品类判定和材料费判定逻辑对不上，导致库存对不上。
    consumePackagingMaterialsSmart(order, packagingLevel = 'standard') {
        // ⭐ 先确保一次性数据迁移已执行（老位置→规范位置），
        //    否则下面直接读 pm[id] 会永远读到 0 → 每次都紧急采购 → 费用固定！
        //    随便查一次库存即可触发迁移
        try { this.getPackagingMaterial('carton'); } catch(_) {}
        const pm = this.state.warehouse.packagingMaterials || (this.state.warehouse.packagingMaterials = {});
        const allMats = this.getAllPackagingMaterials();
        const items = order.items || [];
        const totalQty = items.reduce((s, it) => s + it.quantity, 0) || order.quantity || 1;
        // 总重量 (baseWeight 百分制 → kg)
        // baseWeight 单位为克，必须 /1000 转 kg（旧代码误用 /100，重量放大10倍→大件/耗材暴增）
        const totalWeight = items.reduce((s, it) => {
            const p = getProductById(it.productId);
            return s + (p ? p.baseWeight * it.quantity : 0);
        }, 0) / 1000;
        const orderQty = totalQty;
        const totalWeightKg = Math.max(0.05, totalWeight);

        // ============== Step 1：取主商品 ==============
        let mainProduct = null;
        if (items && items.length > 0) {
            const it = items[0];
            mainProduct = getProductById(it.productId);
        } else if (order.productId) {
            mainProduct = getProductById(order.productId);
        }
        if (!mainProduct) mainProduct = { category: 'daily', name: '商品', baseWeight: 50, basePrice: 0 };

        // ============== Step 2：统一取配方（与 calculatePackagingMaterialFee 完全一致 ==============
        const formulaFn = (typeof getPackagingFormula !== 'undefined') ? getPackagingFormula : null;
        let consumed;
        let flags = {}, outerBoxId = 'carton', useSoftBag = false;
        if (formulaFn) {
            const res = formulaFn(mainProduct, orderQty, totalWeightKg, packagingLevel);
            consumed = { ...res.formula };
            flags = res.flags || {};
            outerBoxId = res.outerBoxId || outerBoxId;
            useSoftBag = !!res.useSoftBag;
        } else {
            // 降级：旧版逻辑
            consumed = {
                carton: 1, tape: 0.05, thermal_label: 0.002, // 1张面单=1/500卷
                bubbleWrap: Math.max(0.5, orderQty * 0.3)
            };
        }

        // ============== Step 3：多商品叠加 + 未覆盖商品关键词兜底（给 V1 旧订单兼容
        // （主商品按上面 v2 已经够了。这里仅做「多商品多数量时缓冲翻倍」
        if (items.length >= 2) {
            if (consumed.bubbleWrap) consumed.bubbleWrap *= 1.2;
            if (consumed.gourd_film) consumed.gourd_film *= 1.2;
        }
        // 商品本身超重 → 胶带再加点
        if (totalWeightKg >= 5 && consumed.tape) consumed.tape += 0.02;

        // 把数量做精度处理 + 材料未启用的删掉
        // ⚠️ 易碎贴/热敏面单：库存单位是「包/卷」（500张），配方已折算成 1张=0.002包
        //    绝不能对「包/卷」再 Math.ceil，否则 0.002 → 1，一单扣光一整包
        Object.keys(consumed).forEach(id => {
            let v = consumed[id];
            if (v == null || v <= 0 || !allMats[id]) { delete consumed[id]; return; }
            const mat = allMats[id];
            if (typeof normalizePackagingConsumeQty === 'function') {
                v = normalizePackagingConsumeQty(mat, v);
            } else {
                const packSheets = Number(mat && mat.spec && mat.spec.quantity) || 0;
                const isSheetStock = packSheets > 1 && (mat.unit === '包' || mat.unit === '卷');
                if (isSheetStock) {
                    const sheetUnit = 1 / packSheets;
                    v = Math.ceil(v / sheetUnit - 1e-9) * sheetUnit;
                    v = Math.round(v * 10000) / 10000;
                } else {
                    v = Math.ceil(v * 1000) / 1000;
                    if (mat?.unit === '个' || mat?.unit === '根') v = Math.ceil(v);
                }
            }
            if (v > 0) consumed[id] = v;
            else delete consumed[id];
        });

        // ==== Step 4：检查库存 & 自动紧急采购（加价50%）====
        // ⭐【核心修复】检查库存必须走 this.getPackagingMaterial(id)，不能直接读 pm[id]！
        //    getPackagingMaterial 会触发一次性库存迁移（老存档 state.packagingMaterials → 规范位置）
        //    之前直接读 pm[id] → 老存档库存没迁移过来，读到 0 → 永远紧急采购 → 费用固定！
        let autoBuyCost = 0;
        const insufficient = [];
        Object.entries(consumed).forEach(([id, need]) => {
            if (need <= 0 || !allMats[id]) return;
            const have = this.getPackagingMaterial(id);  // ✅ 统一入口，强制触发迁移
            if (have < need) insufficient.push({ materialId: id, need, have });
        });
        if (insufficient.length > 0) {
            insufficient.forEach(item => {
                const cfg = allMats[item.materialId];
                if (!cfg) return;
                const deficit = Math.max(0, item.need - item.have);
                // 卷/包等可拆分单位：按实际缺口采购，禁止 Math.ceil(0.002)→1 整卷天价紧急采购
                const unitName = cfg.unit || '';
                let buyQty;
                if (unitName === '卷' || unitName === '包' || unitName === '米' || unitName === 'kg') {
                    buyQty = Math.ceil(deficit * 1000) / 1000;
                    if (buyQty < 0.001) buyQty = 0.001;
                } else {
                    buyQty = Math.max(1, Math.ceil(deficit));
                }
                item.buyQty = buyQty;
                const tier = (cfg.priceTiers && cfg.priceTiers.length) ? cfg.priceTiers[0] : null;
                const unit = tier ? tier.price : (cfg.cost * 1.5);
                autoBuyCost += unit * buyQty * 1.5; // 紧急采购加价50%
            });
            autoBuyCost = Math.round(autoBuyCost * 100) / 100;
            if (autoBuyCost > 0) {
                // 资金不足则不补库存，避免「欠款上限下白嫖包装材料」
                const paid = this.spendFunds(autoBuyCost, '包装材料紧急采购');
                if (!paid) {
                    return { success: false, message: '包装材料不足且资金不够紧急采购', cost: 0, consumed: {} };
                }
                this._accumulatePackagingCost('auto_emergency_cost', autoBuyCost, this.state.gameTime.day);
                this._appendPackagingLog({ type: 'emergency_purchase', cost: autoBuyCost, items: insufficient });
                // 紧急采购补齐到最低需要量（必须写回规范路径 state.warehouse.packagingMaterials，
                // 因为 getPackagingMaterial 迁移后清空了老位置，现在就以规范路径为唯一真实库存）
                insufficient.forEach(it => {
                    const cur = this.state.warehouse.packagingMaterials[it.materialId] || 0;
                    const add = Number(it.buyQty) || Math.max(0, it.need - it.have);
                    this.state.warehouse.packagingMaterials[it.materialId] =
                        parseFloat((cur + add).toFixed(4));
                });
                // 同步共享引用到仓储模块
                this._syncPackagingMaterialsToWarehouseState();
            }
        }

        // ==== Step 5：扣减库存 + 写出库日志 ====
        // ⭐【核心修复2】扣库存必须走 this.consumePackagingMaterial(id, qty)，
        //    该函数内部也是走规范路径 state.warehouse.packagingMaterials，和 getPackagingMaterial 完全对齐。
        //    之前直接写 pm[id] 扣减，如果迁移触发后 pm 指向对象和 this.state.warehouse.packagingMaterials
        //    是同一个引用还好，但如果中间有赋值替换（getPackagingMaterial迁移）会造成漏扣。
        const now = { day: this.state.gameTime.day, hour: this.state.gameTime.hour };
        Object.entries(consumed).forEach(([id, qty]) => {
            if (qty <= 0 || !allMats[id]) return;
            // ✅ 统一扣减入口（如果有库存就真扣，库存不足也返回 false，但我们在 Step 4 已经补齐了）
            this.consumePackagingMaterial(id, qty);
            const cfg = allMats[id];
            this._appendPackagingInventoryLog({
                type: 'outbound', subtype: 'ship',
                materialId: id, materialName: cfg.name, icon: cfg.icon, unit: cfg.unit,
                quantity: qty, unitCost: cfg.cost, subtotal: Math.round(cfg.cost * qty * 100) / 100,
                relatedId: order.id, orderId: order.id, packagingLevel,
                day: now.day, hour: now.hour,
                remark: `订单发货 ${order.id.substr(-6)} 包装${flags.cold ? '冷链' : ''}${flags.fragile ? '易碎' : ''}${flags.highValue ? '高值' : ''}`
            });
        });
        // 同步 pm 引用，防止下面计算 packagingFee 时读到旧值（虽然现在扣减已走统一函数）
        const pmAfter = this.state.warehouse.packagingMaterials || {};
        // 包装材料成本用于计算单均
        const packagingFee = Math.round(Object.entries(consumed).reduce((s, [id, qty]) =>
            s + (allMats[id] ? qty * allMats[id].cost : 0), 0) * 100) / 100;
        this._accumulatePackagingCost('packagingFeeByOrder', packagingFee, now.day);
        // 计数发货订单数 & 销售额
        const dayStats = this.state.warehouse.packagingCostStats || {};
        const k = 'D' + now.day;
        dayStats[k] = dayStats[k] || { day: now.day, purchase_cost: 0, auto_emergency_cost: 0, storage_cost: 0, material_waste: 0, packagingFeeByOrder: 0, ordersShipped: 0, salesAmount: 0 };
        dayStats[k].ordersShipped = (dayStats[k].ordersShipped || 0) + 1;
        dayStats[k].salesAmount = (dayStats[k].salesAmount || 0) + (order.totalAmount || 0);
        this.state.warehouse.packagingCostStats = dayStats;
        this.notify();
        return { success: true, consumed, autoBuyCost, packagingFee, cartonId: outerBoxId, packagingLevel, flags };
    }

    // 12. 供应商+合作统计
    getPackagingSuppliersWithStats() {
        const reqs = this.state.warehouse.packagingPurchaseReqs || [];
        return (PACKAGING_SUPPLIERS || []).map(s => {
            const sReqs = reqs.filter(r => r.supplierId === s.id);
            const totalCost = sReqs.filter(r => r.status === 'received').reduce((a, r) => a + (r.actualCost || r.totalAmount || 0), 0);
            const receivedCount = sReqs.filter(r => r.status === 'received').length;
            const avgDeliverDays = receivedCount > 0
                ? Math.round(sReqs.filter(r => r.status === 'received' && r.receivedDay && r.estimatedArrivalDay).reduce((a, r) =>
                    a + (r.receivedDay - (r.createdDay || r.estimatedArrivalDay + r.supplierDeliveryDays)), 0) / receivedCount * 10) / 10
                : null;
            return { ...s, totalCost, orderCount: sReqs.length, receivedCount, avgDeliverDays };
        });
    }

    // ==================== 库存列表管理 ====================
    // 获取库存列表（支持筛选/排序/搜索）
    getInventoryList(filters = {}) {
        const { keyword = '', category = 'all', sortBy = 'quantity', sortDir = 'desc', abcClass = 'all' } = filters;
        const today = this.state.gameTime.day;
        
        // 聚合库存（同一商品不同批次/品质合并）
        const aggregated = new Map();
        this.state.inventory.forEach(item => {
            const prod = getProductById(item.productId);
            if (!prod) return;
            
            const key = item.productId;
            if (!aggregated.has(key)) {
                aggregated.set(key, {
                    productId: item.productId,
                    product: prod,
                    productName: prod.name,
                    category: prod.category,
                    quantity: 0,
                    totalCost: 0,
                    firstInDay: item.purchaseDay || today,
                    lastInDay: item.purchaseDay || today,
                    lastOutDay: 0
                });
            }
            const agg = aggregated.get(key);
            agg.quantity += item.quantity;
            agg.totalCost += item.quantity * (item.costPrice || prod.basePrice || 0);
            if (item.purchaseDay && item.purchaseDay < agg.firstInDay) agg.firstInDay = item.purchaseDay;
            if (item.purchaseDay && item.purchaseDay > agg.lastInDay) agg.lastInDay = item.purchaseDay;
        });

        let list = [...aggregated.values()].map(item => {
            item.avgCost = item.quantity > 0 ? Math.round(item.totalCost / item.quantity * 100) / 100 : 0;
            item.ageDays = today - item.firstInDay;
            item.daysSinceLastOut = item.lastOutDay > 0 ? today - item.lastOutDay : 999;
            item.totalValue = Math.round(item.totalCost);
            return item;
        });

        // 关键词筛选
        if (keyword) {
            const kw = keyword.toLowerCase();
            list = list.filter(item => 
                item.productName.toLowerCase().includes(kw) ||
                item.productId.toLowerCase().includes(kw)
            );
        }

        // 分类筛选
        if (category && category !== 'all') {
            list = list.filter(item => item.category === category);
        }

        // 排序
        list.sort((a, b) => {
            let va, vb;
            switch (sortBy) {
                case 'name': va = a.productName; vb = b.productName; return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
                case 'quantity': va = a.quantity; vb = b.quantity; break;
                case 'value': va = a.totalValue; vb = b.totalValue; break;
                case 'age': va = a.ageDays; vb = b.ageDays; break;
                case 'cost': va = a.avgCost; vb = b.avgCost; break;
                default: va = a.quantity; vb = b.quantity;
            }
            return sortDir === 'asc' ? va - vb : vb - va;
        });

        return list;
    }

    // 获取单个商品的库存详情
    getProductInventoryDetail(productId) {
        const prod = getProductById(productId);
        if (!prod) return null;

        const batches = this.state.inventory.filter(it => it.productId === productId);
        const totalQty = batches.reduce((s, it) => s + it.quantity, 0);
        const totalCost = batches.reduce((s, it) => s + it.quantity * (it.costPrice || 0), 0);
        const today = this.state.gameTime.day;

        // 出入库记录（筛选该商品的日志）
        const logs = (this.state.warehouse.logs || [])
            .filter(l => l.productId === productId)
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 50);

        // 计算库龄
        const firstIn = batches.reduce((min, it) => Math.min(min, it.purchaseDay || today), today);
        const lastIn = batches.reduce((max, it) => Math.max(max, it.purchaseDay || 0), 0);

        return {
            product: prod,
            productId,
            productName: prod.name,
            category: prod.category,
            totalQuantity: totalQty,
            totalValue: Math.round(totalCost),
            avgCost: totalQty > 0 ? Math.round(totalCost / totalQty * 100) / 100 : 0,
            batches,
            batchCount: batches.length,
            firstInDay: firstIn,
            lastInDay: lastIn,
            ageDays: today - firstIn,
            logs
        };
    }

    // 获取库存预警列表（增强版：缺货+低库存+滞销）
    getStockAlerts() {
        const list = this.getInventoryList();
        const threshold = this.state.warehouse.lowStockThreshold || 20;
        const alerts = [];
        const today = this.state.gameTime.day;

        list.forEach(item => {
            // 缺货预警
            if (item.quantity === 0) {
                alerts.push({ type: 'outOfStock', ...STOCK_ALERT_LEVELS.outOfStock, ...item });
            }
            // 低库存预警
            else if (item.quantity <= threshold) {
                alerts.push({ type: 'lowStock', ...STOCK_ALERT_LEVELS.lowStock, ...item });
            }
            // 滞销预警（库龄>30天且无出库）
            if (item.ageDays > 30 && item.daysSinceLastOut > 15 && item.quantity > 0) {
                alerts.push({ type: 'slowMoving', ...STOCK_ALERT_LEVELS.slowMoving, ...item });
            }
        });

        // 包装材料预警
        const pmAlerts = this.getPackagingAlerts();
        pmAlerts.forEach(a => {
            alerts.push({ type: 'packaging', ...a, material: true });
        });

        return alerts;
    }

    // 库存调整（盘盈/盘亏）
    adjustInventory(productId, quantityDelta, reason, memo = '') {
        if (quantityDelta === 0) return { success: false, message: '调整数量不能为0' };
        
        const prod = getProductById(productId);
        if (!prod) return { success: false, message: '商品不存在' };

        if (quantityDelta < 0) {
            // 盘亏：减少库存
            let remaining = Math.abs(quantityDelta);
            const batches = this.state.inventory.filter(it => it.productId === productId);
            for (const batch of batches.sort((a, b) => (a.purchaseDay || 0) - (b.purchaseDay || 0))) {
                if (remaining <= 0) break;
                const take = Math.min(batch.quantity, remaining);
                batch.quantity -= take;
                remaining -= take;
            }
            // 移除空批次
            this.state.inventory = this.state.inventory.filter(it => it.quantity > 0);
            
            const lossCost = Math.round(Math.abs(quantityDelta) * prod.basePrice);
            this.addWarehouseLog('adjust', {
                productId, productName: prod.name, quantity: quantityDelta,
                cost: lossCost, reason, memo, type: '盘亏'
            });
        } else {
            // 盘盈：增加库存（新建批次）
            this.state.inventory.push({
                id: generateId('inv'),
                productId,
                quantity: quantityDelta,
                costPrice: prod.basePrice,
                qualityGrade: 'B',
                purchaseDay: this.state.gameTime.day,
                source: 'adjustment'
            });
            this.addWarehouseLog('adjust', {
                productId, productName: prod.name, quantity: quantityDelta,
                cost: 0, reason, memo, type: '盘盈'
            });
        }

        this.notify();
        return { success: true, message: quantityDelta > 0 ? `盘盈 +${quantityDelta}` : `盘亏 ${quantityDelta}` };
    }

    // ==================== 仓库聚合分析 ====================
    // 分层：日志层(Logs) / 库存操作层(Ops) / 分析层(Analytics)
    getWarehouseAnalytics() {
        const inv = this.state.inventory || [];
        const logs = this.state.warehouse?.logs || [];
        const today = this.state.gameTime.day;

        // -------- 基础指标 --------
        const totalQty = this.getUsedCapacity();
        const totalValue = this.getInventoryTotalValue();
        const capacity = this.getWarehouseCapacity();
        const usagePct = capacity > 0 ? (totalQty / capacity * 100) : 0;

        // -------- SKU维度聚合 --------
        const skuMap = new Map();
        inv.forEach(it => {
            const key = it.productId + '|' + (it.qualityGrade || 'B');
            if (!skuMap.has(key)) {
                skuMap.set(key, {
                    key, productId: it.productId, qualityGrade: it.qualityGrade || 'B',
                    productName: (getProductById(it.productId)?.name) || it.productId,
                    category: (getProductById(it.productId)?.category) || 'other',
                    quantity: 0, costValue: 0,
                    firstInboundDay: null, lastInboundDay: null
                });
            }
            const s = skuMap.get(key);
            s.quantity += it.quantity;
            s.costValue += it.quantity * (it.costPrice || 0);
        });
        const skus = [...skuMap.values()];
        const skuCount = skus.length;

        // -------- 日志匹配最后入库时间（用于库存年龄） --------
        logs.forEach(l => {
            if (!l || l.type !== 'inbound') return;
            const k = (l.productId || '') + '|' + (l.qualityGrade || 'B');
            const s = skuMap.get(k);
            if (!s) return;
            const d = l.day || 0;
            if (s.firstInboundDay == null || d < s.firstInboundDay) s.firstInboundDay = d;
            if (s.lastInboundDay == null || d > s.lastInboundDay) s.lastInboundDay = d;
        });

        // -------- 库龄分层 --------
        let age0_7 = 0, age7_30 = 0, age30_90 = 0, age90 = 0;
        let slowQty = 0, slowValue = 0; // 库龄>30天视为滞销
        skus.forEach(s => {
            const age = s.lastInboundDay == null ? 0 : Math.max(0, today - s.lastInboundDay);
            if (age <= 7) age0_7 += s.quantity;
            else if (age <= 30) age7_30 += s.quantity;
            else if (age <= 90) age30_90 += s.quantity;
            else age90 += s.quantity;
            if (age > 30 && s.quantity > 0) { slowQty += s.quantity; slowValue += s.costValue; }
            s.ageDays = age;
        });

        // -------- 近N日出入库汇总（近7日/近30日） --------
        let in7 = 0, out7 = 0, in7Val = 0, out7Val = 0;
        let in30 = 0, out30 = 0, in30Val = 0, out30Val = 0;
        let moveTotal = 0, checkCount = 0, checkDeltaSum = 0;
        logs.forEach(l => {
            if (!l) return;
            const ageD = today - (l.day || 0);
            if (l.type === 'inbound') {
                const q = l.quantity || 0, v = l.totalCost || 0;
                if (ageD < 7) { in7 += q; in7Val += v; }
                if (ageD < 30) { in30 += q; in30Val += v; }
            } else if (l.type === 'outbound') {
                const q = l.quantity || 0, v = l.totalCost || 0;
                if (ageD < 7) { out7 += q; out7Val += v; }
                if (ageD < 30) { out30 += q; out30Val += v; }
            } else if (l.type === 'move') {
                moveTotal++;
            } else if (l.type === 'check') {
                checkCount++;
                checkDeltaSum += (l.valueDelta || 0);
            }
        });

        // -------- 库存周转率估算：近30日出库成本 ÷ 平均库存成本 --------
        // 平均库存简化 = (当前+近30日峰值估计)/2，此处用当前作为近似
        const turnoverRate = totalValue > 0 ? +(out30Val / totalValue).toFixed(2) : 0;
        const turnoverDays = turnoverRate > 0 ? Math.round(30 / turnoverRate) : 999; // 周转天数

        // -------- 分类价值分布 --------
        const catMap = new Map();
        skus.forEach(s => {
            const c = s.category || 'other';
            if (!catMap.has(c)) catMap.set(c, { key: c, quantity: 0, costValue: 0 });
            const x = catMap.get(c);
            x.quantity += s.quantity;
            x.costValue += s.costValue;
        });
        const categoryNames = {daily:'日用',digital:'数码',clothing:'服装',food:'食品',beauty:'美妆',home:'家居',outdoor:'户外',other:'其他'};
        const categories = [...catMap.values()].map(c => ({
            ...c,
            name: categoryNames[c.key] || c.key,
            valuePct: totalValue > 0 ? +(c.costValue / totalValue * 100).toFixed(1) : 0
        })).sort((a, b) => b.costValue - a.costValue);

        // -------- 低库存 --------
        const lowStockItems = this.getLowStockItems();
        const outOfStock = lowStockItems.filter(x => x.quantity <= 0).length;
        const lowStock = lowStockItems.length;

        // -------- 库存健康度评分（满分100） --------
        let healthScore = 100;
        // 1. 容量占用（30分）：70%左右最佳，>90%或<10%扣分
        let scoreCap = 30;
        if (usagePct > 95) scoreCap = 5;
        else if (usagePct > 90) scoreCap = 12;
        else if (usagePct > 80) scoreCap = 20;
        else if (usagePct > 70) scoreCap = 28;
        else if (usagePct < 5) scoreCap = 8;
        else if (usagePct < 15) scoreCap = 18;
        else if (usagePct < 30) scoreCap = 24;
        // 2. 缺货预警（30分）：每有一个缺货SKU扣3，低库存扣1
        let scoreStock = 30;
        scoreStock -= Math.min(20, outOfStock * 3);
        scoreStock -= Math.min(10, Math.max(0, lowStock - outOfStock));
        scoreStock = Math.max(0, scoreStock);
        // 3. 周转速度（20分）：周转天数越少越好，>180天扣满
        let scoreTurn = 20;
        if (turnoverDays <= 15) scoreTurn = 20;
        else if (turnoverDays <= 45) scoreTurn = 16;
        else if (turnoverDays <= 90) scoreTurn = 12;
        else if (turnoverDays <= 180) scoreTurn = 7;
        else scoreTurn = 2;
        if (totalValue === 0 && totalQty === 0) scoreTurn = 10; // 空仓中性
        // 4. 盘点差异累积（20分）：盘差绝对值/货值 的比例
        let scoreCheck = 20;
        const diffRatio = totalValue > 0 ? Math.abs(checkDeltaSum) / totalValue : 0;
        if (checkCount === 0) scoreCheck = 14; // 未盘点略扣
        else if (diffRatio > 0.15) scoreCheck = 4;
        else if (diffRatio > 0.08) scoreCheck = 10;
        else if (diffRatio > 0.03) scoreCheck = 16;
        healthScore = scoreCap + scoreStock + scoreTurn + scoreCheck;
        // 评级
        let healthGrade = 'D', gradeColor = '#f44336';
        if (healthScore >= 90) { healthGrade = 'S'; gradeColor = '#e91e63'; }
        else if (healthScore >= 75) { healthGrade = 'A'; gradeColor = '#4caf50'; }
        else if (healthScore >= 60) { healthGrade = 'B'; gradeColor = '#2196f3'; }
        else if (healthScore >= 45) { healthGrade = 'C'; gradeColor = '#ff9800'; }

        // -------- 近10次盘点盈亏（供可视化） --------
        const checkHistory = logs
            .filter(l => l && l.type === 'check')
            .sort((a, b) => (a.day - b.day) || ((a.timestamp || 0) - (b.timestamp || 0)))
            .slice(-10)
            .map(l => ({ day: l.day, valueDelta: l.valueDelta || 0, qty: l.checkedQty || 0 }));

        return {
            // 基础
            totalQty, totalValue, capacity, usagePct: +usagePct.toFixed(1), skuCount,
            // 库龄
            ageBuckets: { age0_7, age7_30, age30_90, age90 },
            slowQty, slowValue,
            // 出入库汇总
            in7, out7, in7Val, out7Val,
            in30, out30, in30Val, out30Val,
            moveTotal, checkCount, checkDeltaSum: +checkDeltaSum.toFixed(2),
            turnoverRate, turnoverDays,
            // 分类
            categories,
            // 低库存
            lowStock, outOfStock,
            // 健康
            healthScore, healthGrade, gradeColor,
            healthBreakdown: { scoreCap, scoreStock, scoreTurn, scoreCheck },
            // 盘点历史
            checkHistory,
            // SKU明细（仅关键）
            topSlowSkus: skus.filter(s => s.ageDays > 30 && s.quantity > 0)
                .sort((a, b) => b.costValue - a.costValue).slice(0, 8)
        };
    }

    // ==================== 市场行情系统 ====================
    /**
     * 获取或创建商品的市场行情快照。
     * - 首次访问：生成稳定的竞争对手基础信息+初始价格，记录到priceHistory
     * - 再次访问：直接返回缓存的competitors，不走随机生成
     *   （只有每日tick触发refreshMarketDaily才会做EMA平滑调价）
     * 返回：{ competitors:[...], summary:{avg,low,high,prevAvg,changePct}, priceHistory:[{day,avg,low,high}] }
     */
    getOrCreateMarketSnapshot(productId, count = 5) {
        const product = getProductById(productId);
        if (!product) return { competitors: generateCompetitors({ basePrice: 10 }, count), summary: { avg: 0, low: 0, high: 0, changePct: 0, trend: '→' }, priceHistory: [] };
        if (!this.state.market) this.state.market = { lastUpdateDay: 0, snapshots: {} };
        if (!this.state.market.snapshots) this.state.market.snapshots = {};

        const today = this.state.gameTime.day;
        let snap = this.state.market.snapshots[productId];
        // --- 首次访问：初始化快照 ---
        if (!snap) {
            const bases = generateStableCompetitorBase(product, count);
            const gradeInfoOf = (q) => QUALITY_GRADES[q] || QUALITY_GRADES.B;
            const competitors = bases.map(b => {
                const gradeInfo = gradeInfoOf(b.quality);
                const cost = product.basePrice * gradeInfo.priceMultiplier;
                return {
                    ...b,
                    price: generateCompetitorPrice(product, b.quality),
                    sales: b.baseSales,
                    _cost: cost,
                    isSelf: false
                };
            }).sort((a, b) => a.price - b.price);
            const prices = competitors.map(c => c.price);
            const avg = +(prices.reduce((s, x) => s + x, 0) / prices.length).toFixed(2);
            const low = Math.min(...prices);
            const high = Math.max(...prices);
            snap = {
                createdDay: today,
                lastPriceDay: today,
                competitors,
                priceHistory: [{ day: today, avg, low, high }],
                prevDayAvg: avg
            };
            this.state.market.snapshots[productId] = snap;
        }

        // --- 组装返回值（带涨跌统计） ---
        const prices = snap.competitors.map(c => c.price);
        const avg = +(prices.reduce((s, x) => s + x, 0) / prices.length).toFixed(2);
        const low = Math.min(...prices);
        const high = Math.max(...prices);
        const prevAvg = snap.prevDayAvg != null ? snap.prevDayAvg : avg;
        const changePct = prevAvg > 0 ? +(((avg - prevAvg) / prevAvg) * 100).toFixed(2) : 0;
        let trend = '→';
        if (changePct > 0.3) trend = '↑';
        else if (changePct < -0.3) trend = '↓';
        return {
            competitors: snap.competitors.slice().sort((a, b) => a.price - b.price),
            summary: { avg, low, high, prevAvg, changePct, trend },
            priceHistory: snap.priceHistory || []
        };
    }

    /**
     * 每日tick触发：对已缓存的所有snapshot批量执行EMA平滑调价
     * - 只在 gameTime.day !== market.lastUpdateDay 时执行（防止一天内多次刷）
     * - 每个competitor执行smoothPriceUpdate
     * - 追加priceHistory（保留近14天）
     */
    refreshMarketDaily() {
        if (!this.state.market) this.state.market = { lastUpdateDay: 0, snapshots: {} };
        if (!this.state.market.snapshots) this.state.market.snapshots = {};
        const today = this.state.gameTime.day;
        if (this.state.market.lastUpdateDay === today) return 0;
        let updated = 0;
        for (const productId of Object.keys(this.state.market.snapshots)) {
            const snap = this.state.market.snapshots[productId];
            if (!snap || !snap.competitors || snap.lastPriceDay === today) continue;
            const product = getProductById(productId);
            const gradeInfoOf = (q) => QUALITY_GRADES[q] || QUALITY_GRADES.B;
            // 对每个competitor执行EMA平滑调价
            snap.competitors.forEach(c => {
                const cost = product ? product.basePrice * gradeInfoOf(c.quality).priceMultiplier : c._cost || 1;
                c.price = smoothPriceUpdate(c.price, cost);
                // 销量每日自然波动±3%，模拟真实市场
                const delta = c.sales * randomFloat(-0.03, 0.03);
                c.sales = Math.max(1, Math.round(c.sales + delta));
            });
            const prices = snap.competitors.map(c => c.price);
            const avg = +(prices.reduce((s, x) => s + x, 0) / prices.length).toFixed(2);
            const low = Math.min(...prices);
            const high = Math.max(...prices);
            // 记录昨日均价作为比较基准
            snap.prevDayAvg = snap.priceHistory && snap.priceHistory.length
                ? snap.priceHistory[snap.priceHistory.length - 1].avg
                : avg;
            snap.priceHistory = snap.priceHistory || [];
            snap.priceHistory.push({ day: today, avg, low, high });
            if (snap.priceHistory.length > 14) snap.priceHistory.splice(0, snap.priceHistory.length - 14);
            snap.lastPriceDay = today;
            updated++;
        }
        this.state.market.lastUpdateDay = today;
        return updated;
    }

    // 移仓：搬仓到新城市，按件收搬运费+跨城市运费
    moveWarehouseCity(newCityId) {
        const oldCity = this.state.warehouse.city;
        if (!newCityId) return { success: false, message: '城市无效' };
        if (oldCity === newCityId) return { success: false, message: '已在该城市' };
        if (typeof isOriginCity === 'function' && isOriginCity(newCityId)) {
            return { success: false, message: '原产地节点不可搬仓，对应商品会从国外直发国内' };
        }
        const cityInfo = WAREHOUSE_CITIES.find(c => c.id === newCityId)
                        || ALL_CITIES.find(c => c.id === newCityId);
        if (!cityInfo) return { success: false, message: '找不到该城市' };
        
        const totalQty = this.getUsedCapacity();
        const totalValue = this.getInventoryTotalValue();
        // 搬仓费：每件 0.5元 + 货值 1% 保险 + 跨区运输费50元
        const moveCost = Math.max(50,
            Math.round(totalQty * 0.5 + totalValue * 0.01 + (oldCity !== newCityId ? 50 : 0)));
        if (this.state.shop.funds < moveCost) {
            return { success: false, message: '资金不足，搬仓需 ' + formatMoney(moveCost) };
        }
        this.spendFunds(moveCost, `搬仓费(${WAREHOUSE_CITIES.find(c=>c.id===oldCity)?.name || ALL_CITIES.find(c=>c.id===oldCity)?.name || oldCity} → ${cityInfo.name})`);
        const oldCityName = (WAREHOUSE_CITIES.find(c => c.id === oldCity)?.name)
                          || (ALL_CITIES.find(c => c.id === oldCity)?.name) || oldCity;
        this.state.warehouse.city = newCityId;
        this.state.shop.city = newCityId;
        this.state.warehouse.startCapacityBonus = cityInfo.startCapacityBonus || 0;
        this.addWarehouseLog('move', {
            fromCityId: oldCity, fromCityName: oldCityName,
            toCityId: newCityId, toCityName: cityInfo.name,
            movedQty: totalQty, moveCost
        });
        this.notify();
        return { success: true, from: oldCityName, to: cityInfo.name, cost: moveCost, qty: totalQty };
    }
    
    // 仓库盘点：随机调整部分库存盈亏 + 对账校验
    doWarehouseCheck() {
        const today = this.state.gameTime.day;
        const last = this.state.warehouse.lastCheckDay || 0;
        if (today - last < 1) {
            return { success: false, message: '每天最多盘点一次' };
        }
        this.state.warehouse.lastCheckDay = today;
        const items = this.state.inventory.filter(i => i.quantity > 0);
        const totalQty = items.reduce((s, i) => s + i.quantity, 0);
        const totalValue = this.getInventoryTotalValue();
        // 盈亏比例：-1.0% ~ +0.5%（实际仓库一般损耗略多于盘盈）
        const profitRatio = -0.01 + Math.random() * 0.015;
        const diffValue = totalValue * profitRatio;
        let checkedValue = 0;
        // 调整库存数量（对每个sku按比例微扰，最多±3件）
        const changedItems = [];
        items.forEach(it => {
            if (it.quantity <= 0) return;
            const localRatio = profitRatio * (0.5 + Math.random());
            const delta = Math.round(it.quantity * localRatio + (Math.random() < 0.2 ? randomInt(-2, 1) : 0));
            if (delta === 0) return;
            const oldQty = it.quantity;
            it.quantity = Math.max(0, it.quantity + delta);
            const realDelta = it.quantity - oldQty;
            if (realDelta === 0) return;
            const prod = getProductById(it.productId);
            changedItems.push({
                productId: it.productId,
                productName: prod?.name || it.productId,
                qualityGrade: it.qualityGrade || 'B',
                before: oldQty,
                after: it.quantity,
                delta: realDelta,
                unitCost: it.costPrice || 0,
                valueDelta: realDelta * (it.costPrice || 0)
            });
            checkedValue += realDelta * (it.costPrice || 0);
        });
        this.state.inventory = this.state.inventory.filter(i => i.quantity > 0);
        
        let financeNote = '';
        if (checkedValue > 0.01) {
            this.addFunds(checkedValue, '仓库盘点盘盈');
            financeNote = '盘盈 ' + formatMoney(checkedValue);
        } else if (checkedValue < -0.01) {
            this.spendFunds(-checkedValue, '仓库盘点盘亏');
            financeNote = '盘亏 ' + formatMoney(-checkedValue);
        } else {
            financeNote = '账实相符';
        }
        
        this.addWarehouseLog('check', {
            day: today,
            checkedSkuCount: items.length,
            checkedQty: totalQty,
            bookValue: totalValue,
            changedCount: changedItems.length,
            valueDelta: checkedValue,
            financeNote,
            detail: changedItems.slice(0, 50)
        });
        this.notify();
        return {
            success: true,
            day: today,
            checkedSkuCount: items.length,
            checkedQty: totalQty,
            bookValue: totalValue,
            changedCount: changedItems.length,
            valueDelta: checkedValue,
            financeNote,
            sample: changedItems.slice(0, 10)
        };
    }
    
    // ==================== 促销系统 ====================
    createPromotion(type, productId, config) {
        const typeInfo = PROMOTION_TYPES[type];
        if (!typeInfo) return { success: false, message: '无效的促销类型' };

        const promotion = {
            id: generateId('prom'),
            type: type,
            productId: productId,
            name: typeInfo.name,
            icon: typeInfo.icon,
            config: config || {},
            startTime: { ...this.state.gameTime },
            status: 'active'
        };

        // 安全兜底：确保 promotions.active 存在（兼容旧存档/迁移漏网场景）
        if (!this.state.promotions) this.state.promotions = {};
        if (!Array.isArray(this.state.promotions.active)) this.state.promotions.active = [];
        this.state.promotions.active.push(promotion);

        this.notify();
        return { success: true, promotion };
    }

    endPromotion(promotionId) {
        if (!this.state.promotions) return false;
        if (!Array.isArray(this.state.promotions.active)) this.state.promotions.active = [];
        const index = this.state.promotions.active.findIndex(p => p.id === promotionId);
        if (index === -1) return false;

        const promotion = this.state.promotions.active[index];
        promotion.status = 'ended';
        promotion.endTime = { ...this.state.gameTime };
        this.state.promotions.active.splice(index, 1);

        if (!Array.isArray(this.state.promotions.history)) this.state.promotions.history = [];
        this.state.promotions.history.push(promotion);

        this.notify();
        return true;
    }

    // ==================== 供应商关系 ====================
    addSupplierOrder(supplierId, amount) {
        if (!this.state.supplierRelations[supplierId]) {
            this.state.supplierRelations[supplierId] = {
                totalOrders: 0,
                totalAmount: 0,
                level: 1
            };
        }

        const relation = this.state.supplierRelations[supplierId];
        relation.totalOrders++;
        relation.totalAmount += amount;

        let newLevel = 1;
        for (let i = SUPPLIER_RELATION_LEVELS.length - 1; i >= 0; i--) {
            if (relation.totalOrders >= SUPPLIER_RELATION_LEVELS[i].minOrders) {
                newLevel = SUPPLIER_RELATION_LEVELS[i].level;
                break;
            }
        }
        relation.level = newLevel;

        this.notify();
        return relation;
    }

    getSupplierRelation(supplierId) {
        const relation = this.state.supplierRelations[supplierId];
        if (!relation) {
            return SUPPLIER_RELATION_LEVELS[0];
        }
        return SUPPLIER_RELATION_LEVELS.find(l => l.level === relation.level) || SUPPLIER_RELATION_LEVELS[0];
    }

    getSupplierPriceDiscount(supplierId) {
        const relation = this.getSupplierRelation(supplierId);
        return relation.priceDiscount;
    }

    // ==================== 直播系统 ====================
    startLivestream(streamerId, productIds, plannedDuration, settings) {
        if (this.state.livestream.isLive) {
            return { success: false, message: '已有直播进行中' };
        }

        const streamer = STREAMER_TYPES.find(s => s.id === streamerId);
        if (!streamer) {
            return { success: false, message: '无效的主播类型' };
        }

        if (streamer.costPerHour > 0) {
            const totalCost = streamer.costPerHour * (plannedDuration || 4);
            if (this.state.shop.funds < totalCost) {
                return { success: false, message: `资金不足，主播费用需 ¥${totalCost.toFixed(2)}` };
            }
        }

        if (streamer.costPerHour > 0) {
            const totalCost = streamer.costPerHour * (plannedDuration || 4);
            this.spendFunds(totalCost, `直播 - ${streamer.name}费用`);
        }

        this.state.livestream.isLive = true;
        this.state.livestream.streamer = {
            id: streamerId,
            name: streamer.name,
            icon: streamer.icon,
            baseFans: streamer.baseFans,
            conversionBonus: streamer.conversionBonus,
            costPerHour: streamer.costPerHour
        };
        this.state.livestream.productIds = productIds || [];
        this.state.livestream.viewers = 0;
        this.state.livestream.peakViewers = 0;
        this.state.livestream.duration = 0;
        this.state.livestream.plannedDuration = plannedDuration || 4;
        this.state.livestream.totalSales = 0;
        this.state.livestream.orderCount = 0;
        this.state.livestream.startTime = { ...this.state.gameTime };
        this.state.livestream.settings = {
            autoEnd: settings?.autoEnd !== false,
            showDiscount: settings?.showDiscount !== false,
            discountRate: settings?.discountRate || 0.9
        };
        this.notify();
        return { success: true };
    }

    endLivestream() {
        if (!this.state.livestream.isLive) return false;

        const record = {
            id: generateId('live'),
            streamer: this.state.livestream.streamer,
            productIds: this.state.livestream.productIds,
            viewers: this.state.livestream.viewers,
            peakViewers: this.state.livestream.peakViewers,
            duration: this.state.livestream.duration,
            totalSales: this.state.livestream.totalSales,
            orderCount: this.state.livestream.orderCount,
            startTime: this.state.livestream.startTime,
            endTime: { ...this.state.gameTime },
            settings: { ...this.state.livestream.settings }
        };

        this.state.livestream.history.unshift(record);
        if (this.state.livestream.history.length > 50) {
            this.state.livestream.history = this.state.livestream.history.slice(0, 50);
        }

        this.state.livestream.isLive = false;
        this.state.livestream.streamer = null;
        this.state.livestream.productIds = [];
        this.state.livestream.viewers = 0;
        this.state.livestream.peakViewers = 0;
        this.state.livestream.duration = 0;
        this.state.livestream.plannedDuration = 4;
        this.state.livestream.totalSales = 0;
        this.state.livestream.orderCount = 0;
        this.state.livestream.startTime = null;

        // 同步停止新直播引擎定时器，避免幽灵刷单/刷弹幕
        try {
            if (typeof liveEngine !== 'undefined' && liveEngine && typeof liveEngine.endLive === 'function') {
                const ls = (typeof liveState !== 'undefined' && liveState.getState) ? liveState.getState() : null;
                if (ls && ls.isLive) liveEngine.endLive();
            }
        } catch (e) { /* ignore */ }

        this.notify();
        return true;
    }

    updateLivestreamViewers(viewers) {
        if (!this.state.livestream.isLive) return;
        this.state.livestream.viewers = viewers;
        if (viewers > this.state.livestream.peakViewers) {
            this.state.livestream.peakViewers = viewers;
        }
    }

    addLivestreamSale(amount) {
        if (!this.state.livestream.isLive) return;
        this.state.livestream.totalSales += amount;
        this.state.livestream.orderCount++;
    }

    getLivestreamHistory() {
        return this.state.livestream.history || [];
    }

    // ==================== 玩家属性 ====================
    _ensurePlayerAttrs() {
        if (!this.state.player) this.state.player = {};
        if (!this.state.player.attributes || typeof this.state.player.attributes !== 'object') {
            this.state.player.attributes = { operation: 1, selection: 1, negotiation: 1, management: 1, luck: 1 };
        }
        const a = this.state.player.attributes;
        ['operation', 'selection', 'negotiation', 'management', 'luck'].forEach(k => {
            if (!(Number(a[k]) > 0)) a[k] = 1;
        });
        if (!(Number(this.state.player.attributePoints) >= 0)) this.state.player.attributePoints = 0;
        return a;
    }

    getPlayerAttrLevel(attr) {
        const a = this._ensurePlayerAttrs();
        const n = Number(a[attr]);
        return isFinite(n) && n > 0 ? n : 1;
    }

    /** 每高出 1 级，乘以 (1 + perLevel)，最低 1 */
    getPlayerAttrFactor(attr, perLevel) {
        const lv = this.getPlayerAttrLevel(attr);
        const step = Number(perLevel) || 0;
        return Math.max(0.5, 1 + Math.max(0, lv - 1) * step);
    }

    applyNegotiationToPrice(unit) {
        const raw = Number(unit) || 0;
        if (raw <= 0) return raw;
        const mul = Math.max(0.7, 1 - (this.getPlayerAttrLevel('negotiation') - 1) * 0.015);
        return Math.round(raw * mul * 100) / 100;
    }

    getWarehouseCityId() {
        return (this.state.warehouse && this.state.warehouse.city)
            || (this.state.shop && this.state.shop.city)
            || 'yiwu';
    }

    /** 进货单价：城市选址折扣/加价 + 谈判属性 + 天赋「供应链专家」折扣 */
    applyPurchaseUnitPrice(unit, category) {
        let p = Number(unit) || 0;
        if (p <= 0) return p;
        try {
            if (typeof getCityPurchaseDiscount === 'function') {
                const d = Number(getCityPurchaseDiscount(this.getWarehouseCityId(), category)) || 0;
                p = p * (1 - d);
            }
        } catch (_) {}
        try {
            const sd = Math.min(0.5, this.getTalentBonus('supplyDiscount'));
            if (sd > 0) p = p * (1 - sd);
        } catch (_) {}
        return this.applyNegotiationToPrice(p);
    }

    /** 进货到货天数：城市速度加成（正数更快） */
    applyPurchaseLeadDays(days, category) {
        let d = Number(days) || 1;
        try {
            if (typeof getCityPurchaseSpeedBonus === 'function') {
                d -= Number(getCityPurchaseSpeedBonus(this.getWarehouseCityId(), category)) || 0;
            }
        } catch (_) {}
        return Math.max(1, Math.round(d));
    }

    addAttributePoint(attr, amount) {
        const a = this._ensurePlayerAttrs();
        if (!Object.prototype.hasOwnProperty.call(a, attr)) return false;
        a[attr] += Number(amount) || 0;
        this.notify();
        return true;
    }

    /** 看广告升级：不消耗属性点 */
    upgradeAttributeByAd(attr, maxLevel) {
        const a = this._ensurePlayerAttrs();
        if (!Object.prototype.hasOwnProperty.call(a, attr)) {
            return { success: false, message: '无效属性' };
        }
        const cap = Number(maxLevel) || 20;
        if ((a[attr] || 1) >= cap) return { success: false, message: '该属性已满级' };
        a[attr] = (a[attr] || 1) + 1;
        this.notify();
        return { success: true, level: a[attr], message: '已升级至 Lv.' + a[attr] };
    }

    spendAttributePoint(attr, maxLevel) {
        const a = this._ensurePlayerAttrs();
        if (!Object.prototype.hasOwnProperty.call(a, attr)) {
            return { success: false, message: '无效属性' };
        }
        const pts = Number(this.state.player.attributePoints) || 0;
        if (pts < 1) return { success: false, message: '没有可用属性点' };
        const cap = Number(maxLevel) || 20;
        if ((a[attr] || 1) >= cap) return { success: false, message: '该属性已满级' };
        this.state.player.attributePoints = pts - 1;
        a[attr] = (a[attr] || 1) + 1;
        this.notify();
        return { success: true, level: a[attr], left: this.state.player.attributePoints, message: `已用属性点升至 Lv.${a[attr]}` };
    }

    getAttribute(attr) {
        return this.getPlayerAttrLevel(attr);
    }

    /** 开局天赋被动加成（无该加成返回 0） */
    getTalentBonus(key) {
        try {
            const tb = this.state.player && this.state.player.talentBonus;
            const v = tb ? Number(tb[key]) : 0;
            return isFinite(v) && v > 0 ? v : 0;
        } catch (_) { return 0; }
    }

    /** 自有品牌加成（未创建品牌返回 null） */
    getOwnBrandBuff() {
        try {
            const shop = this.state.shop;
            if (!shop || !shop.hasOwnBrand) return null;
            const b = shop.ownBrandBuff;
            return (b && typeof b === 'object') ? b : null;
        } catch (_) { return null; }
    }

    /**
     * 创建自有品牌：Lv.6+、品牌费 500 万。
     * 效果：转化率 +8%、自然流量 +10%；触发「品牌创始人」结局徽章（不结束游戏）。
     */
    createOwnBrand(name) {
        const shop = this.state.shop;
        if (!shop) return { success: false, message: '状态不可用' };
        if ((shop.level || 1) < 6) return { success: false, message: '店铺达到 Lv.6 皇冠店铺后才能创立自有品牌' };
        if (shop.hasOwnBrand) return { success: false, message: '已拥有自有品牌' };
        const brandName = String(name || '').trim();
        if (brandName.length < 2 || brandName.length > 12) return { success: false, message: '品牌名需 2~12 字' };
        if (typeof validateShopName === 'function') {
            const v = validateShopName(brandName);
            if (!v.valid) return { success: false, message: '品牌名：' + v.message };
        }
        const fee = 5000000;
        if (typeof this.spendFunds !== 'function' || !this.spendFunds(fee, '创立自有品牌')) {
            return { success: false, message: '资金不足，需要 ¥500万' };
        }
        shop.hasOwnBrand = true;
        shop.ownBrandName = brandName;
        shop.ownBrandSinceDay = (this.state.gameTime && this.state.gameTime.day) || 1;
        shop.ownBrandBuff = { conversion: 0.08, traffic: 0.10 };
        this.notify();
        try { if (this.saveDebounced) this.saveDebounced(); } catch (_) {}
        return { success: true, message: `品牌「${brandName}」创立成功！转化率 +8%、自然流量 +10%。可购置工厂生产自制服饰。` };
    }

    buyOwnBrandFactory() {
        const shop = this.state.shop;
        if (!shop) return { success: false, message: '状态不可用' };
        if (!shop.hasOwnBrand) return { success: false, message: '请先创立自有品牌' };
        if (shop.hasOwnFactory) return { success: false, message: '已拥有服饰工厂' };
        const fac = (typeof OWN_BRAND_FACTORY !== 'undefined') ? OWN_BRAND_FACTORY : null;
        if (!fac) return { success: false, message: '工厂配置未加载' };
        const cost = Number(fac.cost) || 2000000;
        if (!this.spendFunds(cost, '购置' + (fac.name || '服饰工厂'))) {
            return { success: false, message: '资金不足，需要 ¥' + cost.toLocaleString() };
        }
        shop.hasOwnFactory = true;
        shop.ownFactory = {
            id: fac.id,
            name: fac.name,
            boughtDay: (this.state.gameTime && this.state.gameTime.day) || 1,
            dailyCapacity: fac.dailyCapacity || 240,
            usedToday: 0,
            usedDay: 0,
            lines: [],
            queue: []
        };
        this.notify();
        try { if (this.saveDebounced) this.saveDebounced(); } catch (_) {}
        return { success: true, message: `已购置「${fac.name}」，初始日产能 ${fac.dailyCapacity || 240} 件` };
    }

    _ensureOwnFactory() {
        const shop = this.state.shop;
        if (!shop || !shop.hasOwnFactory) return null;
        if (!shop.ownFactory || typeof shop.ownFactory !== 'object') {
            shop.ownFactory = { id: 'cloth_gz', name: '广州服饰工厂', lines: [], queue: [], usedToday: 0, usedDay: 0 };
        }
        const f = shop.ownFactory;
        if (!Array.isArray(f.lines)) f.lines = [];
        if (!Array.isArray(f.queue)) f.queue = [];
        const cfgCap = (typeof OWN_BRAND_FACTORY !== 'undefined' && OWN_BRAND_FACTORY.dailyCapacity) || 240;
        if (!(Number(f.dailyCapacity) > 0) || (Number(f.dailyCapacity) === 80 && f.lines.length === 0 && !(f.queue || []).length)) {
            f.dailyCapacity = cfgCap;
        }
        return f;
    }

    hasFactoryDirector() {
        return (this.state.employees || []).some(e =>
            e && e.status === 'active' && (e.type === 'factoryDirector' || e.position === 'factoryDirector')
        );
    }

    buyFactoryLine(lineType) {
        const shop = this.state.shop;
        const f = this._ensureOwnFactory();
        if (!f) return { success: false, message: '请先购置工厂' };
        const cfg = (typeof OWN_BRAND_FACTORY !== 'undefined') ? OWN_BRAND_FACTORY : {};
        const spec = lineType === 'advanced' ? cfg.lineAdvanced : cfg.lineNormal;
        if (!spec) return { success: false, message: '产线配置缺失' };
        const maxLines = Number(cfg.maxLines) || 8;
        if ((f.lines || []).length >= maxLines) return { success: false, message: `产线已满（最多 ${maxLines} 条）` };
        const cost = Number(spec.cost) || 500000;
        if (!this.spendFunds(cost, '购置' + (spec.name || '产线'))) {
            return { success: false, message: '资金不足，需要 ¥' + cost.toLocaleString() };
        }
        f.lines.push({
            id: 'fl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            type: spec.type || lineType,
            name: spec.name,
            capacity: spec.capacity || 200,
            boughtDay: (this.state.gameTime && this.state.gameTime.day) || 1
        });
        this.notify();
        try { if (this.saveDebounced) this.saveDebounced(); } catch (_) {}
        const cap = (typeof getFactoryDailyCapacity === 'function') ? getFactoryDailyCapacity(f) : (240 + f.lines.length * 200);
        return { success: true, message: `已购置${spec.name}，日产能现为 ${cap} 件` };
    }

    produceOwnBrand(skuId, qty, opts) {
        opts = opts || {};
        const shop = this.state.shop;
        const f = this._ensureOwnFactory();
        if (!shop || !f) return { success: false, message: '请先购置工厂' };
        const fac = (typeof OWN_BRAND_FACTORY !== 'undefined') ? OWN_BRAND_FACTORY : {};
        const product = (typeof getProductById === 'function') ? getProductById(skuId) : null;
        if (!product || !product.ownBrandOnly) return { success: false, message: '不是可生产的自有款' };
        const n = Math.max(1, Math.floor(Number(qty) || 0));
        if (!n) return { success: false, message: '请输入生产数量' };
        const tierId = opts.costTier || 'standard';
        const tier = (typeof getFactoryCostTier === 'function') ? getFactoryCostTier(tierId) : { costMul: 0.52, grade: 'C' };
        const hasAdv = (typeof factoryHasAdvancedLine === 'function') ? factoryHasAdvancedLine(f) : false;
        if (tier.needAdvanced && !hasAdv) return { success: false, message: '精做需先购置高级产线' };
        let grade = tier.grade || 'C';
        if (hasAdv && tier.gradeWithAdv) grade = tier.gradeWithAdv;
        if (tier.needAdvanced && hasAdv) grade = tier.grade || 'A';
        const customName = String(opts.customName || '').trim().slice(0, 16);
        const unit = Math.round((product.basePrice || 50) * (Number(tier.costMul) || fac.costMul || 0.52) * 100) / 100;
        const total = Math.round(unit * n * 100) / 100;
        const brand = shop.ownBrandName || '自有品牌';
        const displayName = customName || (product.name || '自制款');
        if (!this.spendFunds(total, `工厂下单 ${brand}·${displayName} ×${n}`)) {
            return { success: false, message: '资金不足，需 ¥' + total.toFixed(2) };
        }
        let lead = Number(fac.leadDays) || 4;
        if (this.hasFactoryDirector()) lead = Math.max(1, lead - 2);
        const day = (this.state.gameTime && this.state.gameTime.day) || 1;
        f.queue.push({
            id: 'fq_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            skuId: product.id,
            displayName: brand + ' · ' + displayName,
            remaining: n,
            qty: n,
            unitCost: unit,
            qualityGrade: grade,
            quality: grade === 'A' ? 90 : (grade === 'B' ? 72 : 52),
            startDay: day + lead,
            costTier: tier.id || tierId
        });
        this.notify();
        try { if (this.saveDebounced) this.saveDebounced(); } catch (_) {}
        const cap = (typeof getFactoryDailyCapacity === 'function') ? getFactoryDailyCapacity(f) : 240;
        return { success: true, message: `已下单 ${n} 件（成本一次结清 ¥${total.toFixed(2)}），第${day + lead}天起按日产 ${cap} 件排队入库` };
    }

    tickOwnFactoryProduction() {
        const f = this._ensureOwnFactory();
        if (!f) return;
        const day = (this.state.gameTime && this.state.gameTime.day) || 1;
        if (f.usedDay === day && f._producedDay === day) return;
        if (f.usedDay !== day) {
            f.usedDay = day;
            f.usedToday = 0;
        }
        const cap = (typeof getFactoryDailyCapacity === 'function') ? getFactoryDailyCapacity(f) : (Number(f.dailyCapacity) || 240);
        let left = Math.max(0, cap - (f.usedToday || 0));
        if (left <= 0) {
            f._producedDay = day;
            return;
        }
        const scrap = this.hasFactoryDirector() ? 0.01 : 0.03;
        for (let i = 0; i < (f.queue || []).length && left > 0; i++) {
            const job = f.queue[i];
            if (!job || !(job.remaining > 0) || day < (job.startDay || 0)) continue;
            const take = Math.min(job.remaining, left);
            job.remaining -= take;
            left -= take;
            f.usedToday = (f.usedToday || 0) + take;
            const good = Math.max(1, Math.round(take * (1 - scrap)));
            this.addPurchaseOrder({
                productId: job.skuId,
                supplierId: 'own_factory',
                productName: job.displayName,
                quantity: good,
                unitPrice: job.unitCost,
                quality: job.quality || 52,
                qualityGrade: job.qualityGrade || 'C',
                deliveryDays: 1,
                ownBrand: true
            });
        }
        f.queue = (f.queue || []).filter(j => j && j.remaining > 0);
        f._producedDay = day;
    }

    // ==================== 结局系统 ====================
    checkEndings() {
        const triggered = [];

        for (const ending of ENDINGS) {
            if (this.state.ending) break;
            const condition = ending.condition;
            let triggered_flag = false;

            switch (condition.type) {
                case 'totalSales':
                    triggered_flag = this.state.shop.totalSales >= condition.value;
                    break;
                case 'days':
                    triggered_flag = this.state.gameTime.day >= condition.value;
                    break;
                case 'bankrupt':
                    // 与 gameEngine.checkGameEndings 统一：资金触及破产线（-10万）即破产
                    triggered_flag = this.state.shop.funds <= ((typeof SHOP_CONFIG !== 'undefined' && SHOP_CONFIG.bankruptLine) || -100000);
                    break;
                case 'achievements':
                    triggered_flag = this.state.achievements.unlocked.length >= condition.value;
                    break;
                case 'ownBrand':
                    // 与 gameEngine 统一：看 hasOwnBrand（创建入口：我的 → 自有品牌）
                    triggered_flag = condition.value === true && !!(this.state.shop && this.state.shop.hasOwnBrand);
                    break;
            }

            if (triggered_flag) {
                this.triggerEnding(ending.id);
                triggered.push(ending.id);
            }
        }

        return triggered;
    }

    triggerEnding(endingId) {
        const ending = ENDINGS.find(e => e.id === endingId);
        if (!ending || this.state.ending) return false;

        this.state.ending = {
            id: endingId,
            name: ending.name,
            icon: ending.icon,
            description: ending.description,
            triggerDay: this.state.gameTime.day
        };
        // ⭐ 修复：只有 forceGameOver 为 true 的结局（仅破产）才强制 gameOver；
        //    成就型结局（小而美/首富/品牌/讲师）仅记录ending信息，游戏可继续玩（无限跳天）
        if (ending.forceGameOver === true) {
            this.state.gameOver = true;
        }
        this.notify();
        return true;
    }

    // ==================== 包装材料系统 ====================
    /**
     * ⭐ 统一读取包装材料库存（规范入口，彻底修复"不同界面数量不一致"的核心BUG）
     * 
     * 修复前问题（3套库存源各自为政导致UI两边不一样）：
     *   - UI A（材料卡片单个查）用 getPackagingMaterial('carton') → 会把 carton_small+carton+carton_large
     *     + state.packagingMaterials(老位置) + warehouse.materials(ERP旧版) 三套全加起来 → 数字偏大
     *   - UI B（材料列表遍历）用 getPackagingMaterials() → 只读 state.warehouse.packagingMaterials[carton]
     *     不合并老位置和 ERP → 数字偏小 → 两边就对不上了
     * 
     * 修复后统一策略（保证 UI A / B / C 所有界面 100% 一致）：
     *   1. 【一次性数据迁移】：把老位置 state.packagingMaterials 和 ERP 旧版 warehouse.materials 的值
     *      全部加回到规范位置 state.warehouse.packagingMaterials，然后把老位置清空，
     *      以后永远只维护这一套，避免多套重复合并。
     *   2. 【取消按大类合并】：不再把 carton_small + carton + carton_large 合并算成 carton 总数，
     *      每个材料 ID 独立返回数量（这样材料列表里 carton=30、carton_small=20 加起来是 50，
     *      和单查 carton=30 不会对不上，用户能看清每一类）。
     *   3. 【getPackagingMaterials / getAllPackagingMaterials 统一复用本函数】：遍历列表时
     *      每个材料的数量也用这个函数取，保证单查/列表查/批量查，三处绝对一致。
     */
    getPackagingMaterial(materialId) {
        if (!this.state) return 0;
        if (!this.state.warehouse) this.state.warehouse = {};
        const std = this.state.warehouse.packagingMaterials || (this.state.warehouse.packagingMaterials = {});

        // ========== 【1】一次性数据迁移：老位置 → 规范位置（从根源消灭多套库存） ==========
        // ⭐ 兼容老存档的多种数据格式：
        //   格式 A（纯数字型）：state.packagingMaterials['carton'] = 5000  <-- 最简单，之前支持
        //   格式 B（对象型）  ：state.packagingMaterials['carton'] = { quantity: 5000, cost: 0.8, totalCost: 4000 } <-- 浏览器实际跑出来的格式！之前漏掉没迁！
        //   格式 C（ERP旧版） ：state.warehouse.materials['carton'] = { qty: 5000, ... } / { quantity: 5000 }
        // 三种格式都要识别并且全部迁到 state.warehouse.packagingMaterials[id] = 数字（统一成纯数字）
        if (this.state.packagingMaterials && typeof this.state.packagingMaterials === 'object' && Array.isArray(this.state.packagingMaterials) === false) {
            let migrated = false;
            for (const [k, v] of Object.entries(this.state.packagingMaterials)) {
                if (!PACKAGING_MATERIALS || !PACKAGING_MATERIALS[k]) continue;  // 防脏数据
                // --- 解析多种格式的真实库存数 ---
                let realQty = 0;
                if (typeof v === 'number' && isFinite(v)) {
                    realQty = v;                                          // 格式 A：纯数字
                } else if (v && typeof v === 'object') {
                    // 格式 B：{ quantity, ... }  或者  { qty, ... }
                    if (typeof v.quantity === 'number' && isFinite(v.quantity)) realQty = v.quantity;
                    else if (typeof v.qty === 'number' && isFinite(v.qty)) realQty = v.qty;
                }
                if (!realQty || realQty <= 0) continue;
                // 包材精简：废弃 SKU 的旧库存合并进核心材料
                const target = (typeof PACKAGING_MATERIAL_ALIASES !== 'undefined' && PACKAGING_MATERIAL_ALIASES[k])
                    ? PACKAGING_MATERIAL_ALIASES[k] : k;
                std[target] = parseFloat((parseFloat(std[target] || 0) + parseFloat(realQty)).toFixed(4));
                migrated = true;
            }
            if (migrated) {
                // 迁移完成，清空老位置（避免下次再合并）：
                // 直接清空成空对象（防止极端老代码因为访问 state.packagingMaterials 报错）
                try { this.state.packagingMaterials = {}; } catch (e) {}
            }
        }
        // ERP 旧版 warehouse.materials 也同样迁移（格式 C）
        try {
            const erp = this.state.warehouse.materials;
            if (erp && typeof erp === 'object') {
                let migrated = false;
                for (const [k, m] of Object.entries(erp)) {
                    if (!m || typeof m !== 'object') continue;
                    let qty = 0;
                    if (typeof m.qty === 'number' && isFinite(m.qty)) qty = m.qty;
                    else if (typeof m.quantity === 'number' && isFinite(m.quantity)) qty = m.quantity;
                    if (!qty || qty <= 0) continue;
                    if (!PACKAGING_MATERIALS || !PACKAGING_MATERIALS[k]) continue;
                    // 包材精简：废弃 SKU 的旧库存合并进核心材料
                    const target = (typeof PACKAGING_MATERIAL_ALIASES !== 'undefined' && PACKAGING_MATERIAL_ALIASES[k])
                        ? PACKAGING_MATERIAL_ALIASES[k] : k;
                    std[target] = parseFloat((parseFloat(std[target] || 0) + parseFloat(qty)).toFixed(4));
                    migrated = true;
                }
                if (migrated) {
                    // ERP 清零但保留结构（防止极端老代码 undefined）
                    for (const m of Object.values(erp)) {
                        if (m && typeof m === 'object') {
                            if ('qty' in m) m.qty = 0;
                            if ('quantity' in m) m.quantity = 0;
                        }
                    }
                }
            }
        } catch (e) {}

        // ========== 【2】直接返回规范位置的该材料数量（不再做任何合并/汇总） ==========
        let v = 0;
        if (materialId === 'carton_aggregate') {
            v = (std.carton || 0) + (std.carton_small || 0) + (std.carton_large || 0)
              + (std.airplane_box || 0) + (std.long_box || 0) + (std.flat_box || 0)
              + (std.gift_box || 0);
        } else if (materialId === 'bubbleWrap_aggregate') {
            v = (std.bubbleWrap || 0) + (std.gourd_film || 0)
              + (std.air_column || 0) + (std.epe_foam || 0)
              + (std.kraft_cushion || 0);
        } else {
            v = std[materialId] || 0;
        }
        return parseFloat((v || 0).toFixed(4));
    }

    buyPackagingMaterial(materialId, quantity) {
        // 包材精简：废弃 SKU 自动转核心材料
        if (typeof PACKAGING_MATERIAL_ALIASES !== 'undefined' && PACKAGING_MATERIAL_ALIASES[materialId]) {
            materialId = PACKAGING_MATERIAL_ALIASES[materialId];
        }
        const material = PACKAGING_MATERIALS[materialId];
        if (!material) return { success: false, message: '无效的包装材料' };

        const priceTier = this.getMaterialPriceTier(materialId, quantity);
        const totalCost = priceTier.price * quantity;

        if (this.state.shop.funds < totalCost) {
            return { success: false, message: '资金不足' };
        }

        this.spendFunds(totalCost, `购买${material.name} x${quantity}`);

        // ====== 唯一真值：warehouse.packagingMaterials（禁止再写 legacy，否则迁移会翻倍）======
        if (!this.state.warehouse) this.state.warehouse = {};
        if (!this.state.warehouse.packagingMaterials) this.state.warehouse.packagingMaterials = {};
        const std = this.state.warehouse.packagingMaterials;
        std[materialId] = parseFloat(((std[materialId] || 0) + quantity).toFixed(3));

        // 仓储模块共享同一对象引用（加一次即可，禁止二次 +=）
        this._syncPackagingMaterialsToWarehouseState(true);

        this.notify();
        return { success: true, cost: totalCost, quantity, priceTier };
    }

    /**
     * 将包装库存规范路径共享/同步到 warehouseState，供仓储管理 UI 显示。
     * @param {boolean} shareRef 为 true 时直接共享同一对象，避免双写翻倍与显示为空
     */
    _syncPackagingMaterialsToWarehouseState(shareRef = true) {
        try {
            if (!this.state.warehouse) this.state.warehouse = {};
            if (!this.state.warehouse.packagingMaterials) this.state.warehouse.packagingMaterials = {};
            const gsPM = this.state.warehouse.packagingMaterials;
            const whS = (typeof window !== 'undefined' && window.warehouseState) ||
                        (typeof warehouseState !== 'undefined' ? warehouseState : null) ||
                        this.warehouse || null;
            if (!whS || !whS.state) return;
            if (shareRef) {
                // 若两侧曾分叉，先取较大值合并，再共享引用
                if (whS.state.packagingMaterials && whS.state.packagingMaterials !== gsPM) {
                    Object.entries(whS.state.packagingMaterials).forEach(([id, qty]) => {
                        const a = parseFloat(gsPM[id] || 0);
                        const b = parseFloat(qty || 0);
                        gsPM[id] = Math.max(a, b);
                    });
                }
                whS.state.packagingMaterials = gsPM;
            } else {
                if (!whS.state.packagingMaterials) whS.state.packagingMaterials = {};
                Object.entries(gsPM).forEach(([id, qty]) => {
                    whS.state.packagingMaterials[id] = parseFloat(qty || 0);
                });
            }
            if (typeof whS._saveToStorage === 'function') whS._saveToStorage();
        } catch (e) { /* ignore */ }
    }

    getMaterialPriceTier(materialId, quantity) {
        const material = PACKAGING_MATERIALS[materialId];
        if (!material) return { price: 0, name: '未知' };

        let currentTier = material.priceTiers[0];
        for (let tier of material.priceTiers) {
            if (quantity >= tier.minQty) {
                currentTier = tier;
            }
        }
        return currentTier;
    }

    /**
     * 消耗包装材料（v2简化版：
     *   - 配合 getPackagingMaterial 一次性数据迁移后，所有库存都在规范位置
     *     state.warehouse.packagingMaterials[id]，直接扣这里，不再分 规范/老位置/ERP 三段
     *   - 先调用 getPackagingMaterial(materialId) 校验库存是否充足
     */
    consumePackagingMaterial(materialId, amount) {
        if (!this.state.warehouse) this.state.warehouse = {};
        if (!this.state.warehouse.packagingMaterials) this.state.warehouse.packagingMaterials = {};
        const std = this.state.warehouse.packagingMaterials;
        const have = this.getPackagingMaterial(materialId);
        if (have < amount) return false;
        // 直接从规范位置扣（迁移后库存都在这里了）
        std[materialId] = parseFloat(((std[materialId] || 0) - amount).toFixed(4));
        if (std[materialId] < 0) std[materialId] = 0;

        // 共享引用时无需再扣一次；仅在分叉时对齐
        this._syncPackagingMaterialsToWarehouseState(true);

        return true;
    }

    /**
     * 检查是否有足够包装材料（v2，完全对齐 calculatePackagingMaterialFee：
     *    先通过 getPackagingFormula 计算本单所有需要的材料 + 数量
     *    然后逐一用统一 getPackagingMaterial(id) 检查库存）
     */
    hasEnoughPackagingMaterials(order, product, packagingLevel = 'standard') {
        if (!product) return { enough: false, reason: '未找到商品信息' };
        const orderQty = order.quantity || 1;
        const totalWeightKg = ((product.baseWeight || 50) * orderQty / 1000) + 0.05;
        let formulaMap;
        if (typeof getPackagingFormula !== 'undefined') {
            formulaMap = getPackagingFormula(product, orderQty, totalWeightKg, packagingLevel).formula;
        } else {
            formulaMap = {
                carton: 1, tape: 0.05, thermal_label: 0.002,
                bubbleWrap: Math.max(0.5, orderQty * 0.3)
            };
        }
        const details = [];
        let enough = true;
        Object.entries(formulaMap).forEach(([mid, need]) => {
            if (need <= 0) return;
            const have = this.getPackagingMaterial(mid);
            const cfg = PACKAGING_MATERIALS ? PACKAGING_MATERIALS[mid] : null;
            details.push({
                materialId: mid,
                name: cfg ? cfg.name : mid,
                icon: cfg ? cfg.icon : '📦',
                need, have,
                ok: have >= need
            });
            if (have < need) enough = false;
        });
        return { enough, details, formula: formulaMap };
    }

    // ==================== 快递议价系统（已下线） ====================
    // v2 快递合作系统（ExpressEngine）统一计算运费折扣：合作等级 × 好感度 × 累计成功订单，
    // 月结95折仅在出账 createBill 时应用一次。旧议价等级/月量折扣无调用方，已移除。

    hasPackingEmployee() {
        return this.state.employees.some(e => 
            e.status === 'active' && 
            (e.skills || []).includes('pack')
        );
    }

    getDefaultExpress() {
        const shippingEmployees = this.state.employees.filter(e => 
            e.status === 'active' && 
            (e.skills || []).includes('ship')
        );
        
        if (shippingEmployees.length === 0) {
            return 'standard';
        }
        
        shippingEmployees.sort((a, b) => {
            const aEff = EMPLOYEE_TYPES[a.type]?.efficiency || 1;
            const bEff = EMPLOYEE_TYPES[b.type]?.efficiency || 1;
            return bEff - aEff;
        });
        
        for (const emp of shippingEmployees) {
            const typeInfo = EMPLOYEE_TYPES[emp.type];
            if (typeInfo?.defaultExpress) {
                return typeInfo.defaultExpress;
            }
        }
        
        return 'standard';
    }

    // ==================== 优惠券系统核心方法 ====================
    
    generateCouponId() {
        return 'cp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }

    generateUserCouponId() {
        return 'uc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }

    createCouponTemplate(config) {
        const now = this.state.gameTime;
        const template = {
            id: this.generateCouponId(),
            name: config.name || '未命名优惠券',
            type: config.type || 'fixed',
            value: config.value || 0,
            minAmount: config.minAmount || 0,
            maxDiscount: config.maxDiscount || 0,
            quantity: config.quantity || 100,
            perUserLimit: config.perUserLimit || 1,
            startDay: config.startDay ?? now.day,
            endDay: config.endDay ?? now.day + 7,
            validDays: config.validDays || 7,
            scope: config.scope || 'all',
            scopeIds: config.scopeIds || [],
            receiveType: config.receiveType || 'all',
            status: 'active',
            receivedCount: 0,
            usedCount: 0,
            createTime: { day: now.day, hour: now.hour },
            description: config.description || ''
        };
        
        this.state.coupons.templates.push(template);
        this.state.coupons.statistics.totalIssued += template.quantity;
        this.notify();
        return { success: true, template };
    }

    getAvailableCouponsForReceive() {
        const now = this.state.gameTime;
        return this.state.coupons.templates.filter(t => {
            if (t.status !== 'active') return false;
            if (now.day < t.startDay || now.day > t.endDay) return false;
            if (t.receivedCount >= t.quantity) return false;
            return true;
        });
    }

    getUserReceivedCount(templateId, userId = null) {
        return this.state.coupons.userCoupons.filter(uc => {
            if (uc.templateId !== templateId) return false;
            // 传入买家标识时按人统计；未传则统计全量（仅用于运营汇总）
            if (userId) {
                return uc.userId === userId || uc.buyerName === userId;
            }
            return true;
        }).length;
    }

    canUserReceiveCoupon(templateId, userId = null) {
        const template = this.state.coupons.templates.find(t => t.id === templateId);
        if (!template) return { can: false, reason: '优惠券不存在' };
        if (template.status !== 'active') return { can: false, reason: '优惠券未启用' };
        
        const now = this.state.gameTime;
        if (now.day < template.startDay) return { can: false, reason: '活动未开始' };
        if (now.day > template.endDay) return { can: false, reason: '活动已结束' };
        if (template.receivedCount >= template.quantity) return { can: false, reason: '优惠券已领完' };
        
        // 每人限领必须带买家标识；否则会把全服领取数当成“单人已领”导致几乎无人可领
        if (userId) {
            const limit = Math.max(1, parseInt(template.perUserLimit, 10) || 1);
            const received = this.getUserReceivedCount(templateId, userId);
            if (received >= limit) return { can: false, reason: '已达领取上限' };
        }
        
        return { can: true };
    }

    receiveCoupon(templateId, userId = null) {
        const check = this.canUserReceiveCoupon(templateId, userId);
        if (!check.can) {
            return { success: false, message: check.reason };
        }
        
        const template = this.state.coupons.templates.find(t => t.id === templateId);
        const now = this.state.gameTime;
        
        const userCoupon = {
            id: this.generateUserCouponId(),
            templateId: template.id,
            name: template.name,
            type: template.type,
            value: template.value,
            minAmount: template.minAmount,
            maxDiscount: template.maxDiscount,
            scope: template.scope,
            scopeIds: template.scopeIds,
            status: 'available',
            userId: userId || null,
            buyerName: userId || null,
            receiveTime: { day: now.day, hour: now.hour },
            expireDay: now.day + template.validDays,
            useTime: null,
            orderId: null
        };
        
        this.state.coupons.userCoupons.push(userCoupon);
        template.receivedCount++;
        this.state.coupons.statistics.totalReceived++;
        
        if (template.receivedCount >= template.quantity) {
            template.status = 'depleted';
        }
        
        this.notify();
        return { success: true, userCoupon, message: '领取成功' };
    }

    getAvailableUserCoupons() {
        const now = this.state.gameTime;
        return this.state.coupons.userCoupons.filter(uc => {
            if (uc.status !== 'available') return false;
            if (uc.expireDay < now.day) return false;
            return true;
        });
    }

    validateCouponForOrder(userCouponId, orderAmount, productIds = [], categoryIds = []) {
        const userCoupon = this.state.coupons.userCoupons.find(uc => uc.id === userCouponId);
        if (!userCoupon) return { valid: false, reason: '优惠券不存在', discount: 0 };
        if (userCoupon.status !== 'available') return { valid: false, reason: '优惠券已使用或过期', discount: 0 };
        
        const now = this.state.gameTime;
        if (userCoupon.expireDay < now.day) return { valid: false, reason: '优惠券已过期', discount: 0 };
        
        const template = this.state.coupons.templates.find(t => t.id === userCoupon.templateId);
        
        if (userCoupon.minAmount > 0 && orderAmount < userCoupon.minAmount) {
            return { valid: false, reason: `订单金额需满${userCoupon.minAmount}元`, discount: 0 };
        }
        
        if (userCoupon.scope !== 'all') {
            let inScope = false;
            if (userCoupon.scope === 'category' && categoryIds) {
                inScope = categoryIds.some(c => userCoupon.scopeIds.includes(c));
            } else if (userCoupon.scope === 'product' && productIds) {
                inScope = productIds.some(p => userCoupon.scopeIds.includes(p));
            }
            if (!inScope) {
                return { valid: false, reason: '该优惠券不适用于此订单商品', discount: 0 };
            }
        }
        
        let discount = 0;
        switch (userCoupon.type) {
            case 'fixed':
                discount = Math.min(userCoupon.value, orderAmount);
                break;
            case 'discount':
                discount = orderAmount * (1 - userCoupon.value / 10);
                if (userCoupon.maxDiscount > 0) {
                    discount = Math.min(discount, userCoupon.maxDiscount);
                }
                discount = Math.round(discount * 100) / 100;
                break;
            case 'threshold':
                if (orderAmount >= userCoupon.minAmount) {
                    discount = Math.min(userCoupon.value, orderAmount);
                }
                break;
            case 'freeship':
                discount = 0;
                break;
        }
        
        return { valid: true, discount, isFreeShip: userCoupon.type === 'freeship' };
    }

    useCoupon(userCouponId, orderId, orderAmount) {
        const userCoupon = this.state.coupons.userCoupons.find(uc => uc.id === userCouponId);
        if (!userCoupon) return { success: false, message: '优惠券不存在' };
        
        const validation = this.validateCouponForOrder(userCouponId, orderAmount);
        if (!validation.valid) {
            return { success: false, message: validation.reason };
        }
        
        const now = this.state.gameTime;
        userCoupon.status = 'used';
        userCoupon.useTime = { day: now.day, hour: now.hour };
        userCoupon.orderId = orderId;
        
        const template = this.state.coupons.templates.find(t => t.id === userCoupon.templateId);
        if (template) {
            template.usedCount++;
        }
        
        this.state.coupons.statistics.totalUsed++;
        if (validation.discount > 0) {
            this.state.coupons.statistics.totalDiscount += validation.discount;
        }
        
        this.notify();
        return { success: true, discount: validation.discount, isFreeShip: validation.isFreeShip };
    }

    returnCoupon(userCouponId) {
        const userCoupon = this.state.coupons.userCoupons.find(uc => uc.id === userCouponId);
        if (!userCoupon || userCoupon.status !== 'used') {
            return { success: false };
        }
        
        const now = this.state.gameTime;
        if (userCoupon.expireDay >= now.day) {
            userCoupon.status = 'available';
            userCoupon.useTime = null;
            userCoupon.orderId = null;
            
            const template = this.state.coupons.templates.find(t => t.id === userCoupon.templateId);
            if (template) {
                template.usedCount = Math.max(0, template.usedCount - 1);
            }
            
            this.state.coupons.statistics.totalUsed = Math.max(0, this.state.coupons.statistics.totalUsed - 1);
        }
        
        this.notify();
        return { success: true };
    }

    processCouponExpiry() {
        const now = this.state.gameTime;
        if (this.state.coupons.lastCheckDay === now.day) return;
        
        let expiredCount = 0;
        this.state.coupons.userCoupons.forEach(uc => {
            if (uc.status === 'available' && uc.expireDay < now.day) {
                uc.status = 'expired';
                expiredCount++;
            }
        });
        
        this.state.coupons.templates.forEach(t => {
            if (t.status === 'active' && t.endDay < now.day) {
                t.status = 'expired';
            }
        });
        
        this.state.coupons.statistics.totalExpired += expiredCount;
        this.state.coupons.lastCheckDay = now.day;
        
        if (expiredCount > 0) {
            this.notify();
        }
    }

    getCouponStatistics() {
        const stats = this.state.coupons.statistics;
        const templates = this.state.coupons.templates;
        const userCoupons = this.state.coupons.userCoupons;
        
        return {
            totalTemplates: templates.length,
            activeTemplates: templates.filter(t => t.status === 'active').length,
            totalIssued: stats.totalIssued,
            totalReceived: stats.totalReceived,
            totalUsed: stats.totalUsed,
            totalExpired: stats.totalExpired,
            totalDiscount: stats.totalDiscount,
            receiveRate: stats.totalIssued > 0 ? (stats.totalReceived / stats.totalIssued * 100).toFixed(1) : 0,
            useRate: stats.totalReceived > 0 ? (stats.totalUsed / stats.totalReceived * 100).toFixed(1) : 0,
            availableCount: userCoupons.filter(uc => uc.status === 'available').length
        };
    }

    /**
     * 优惠券核销与 ROI 分析（深化）：按模板聚合领取/核销/让利，计算每让利 1 元撬动的订单金额。
     * 返回整体指标 + 模板表现排名（核销率排序），供优惠券管理页「核销分析」展示。
     */
    getCouponAnalytics() {
        const stats = this.state.coupons.statistics || {};
        const templates = Array.isArray(this.state.coupons.templates) ? this.state.coupons.templates : [];
        const userCoupons = Array.isArray(this.state.coupons.userCoupons) ? this.state.coupons.userCoupons : [];

        // 按模板聚合：领取数 / 已核销数 / 累计让利
        const byTemplate = {};
        userCoupons.forEach(uc => {
            if (!uc || !uc.templateId) return;
            if (!byTemplate[uc.templateId]) byTemplate[uc.templateId] = { received: 0, used: 0, discount: 0 };
            const b = byTemplate[uc.templateId];
            b.received++;
            if (uc.status === 'used') {
                b.used++;
                b.discount += Number(uc.discountAmount) || Number(uc.value) || 0;
            }
        });

        const rows = templates.map(t => {
            const b = byTemplate[t.id] || { received: 0, used: 0, discount: 0 };
            return {
                templateId: t.id,
                name: t.name || '未命名优惠券',
                type: t.type || 'fixed',
                received: b.received,
                used: b.used,
                useRate: b.received > 0 ? Math.round(b.used / b.received * 100) : 0,
                totalDiscount: Math.round(b.discount * 100) / 100
            };
        }).sort((a, b) => b.useRate - a.useRate || b.used - a.used);

        const totalDiscount = rows.reduce((s, r) => s + r.totalDiscount, 0);
        // 让利撬动估算：假设每张核销券对应一笔平均 ¥(让利 × 6) 的订单（近似客单/让利比）
        const estimatedGMV = Math.round(totalDiscount * 6 * 100) / 100;
        const overallUseRate = (stats.totalReceived || 0) > 0
            ? Math.round((stats.totalUsed || 0) / stats.totalReceived * 100) : 0;

        return {
            overall: {
                totalIssued: stats.totalIssued || 0,
                totalReceived: stats.totalReceived || 0,
                totalUsed: stats.totalUsed || 0,
                totalExpired: stats.totalExpired || 0,
                totalDiscount: Math.round((stats.totalDiscount || 0) * 100) / 100,
                useRate: overallUseRate,
                estimatedGMV
            },
            templates: rows,
            best: rows[0] || null,
            worst: rows.length ? rows[rows.length - 1] : null
        };
    }

    pauseCoupon(templateId) {
        const template = this.state.coupons.templates.find(t => t.id === templateId);
        if (!template) return { success: false, message: '优惠券不存在' };
        template.status = 'paused';
        this.notify();
        return { success: true };
    }

    resumeCoupon(templateId) {
        const template = this.state.coupons.templates.find(t => t.id === templateId);
        if (!template) return { success: false, message: '优惠券不存在' };
        if (template.receivedCount >= template.quantity) {
            return { success: false, message: '优惠券已领完' };
        }
        template.status = 'active';
        this.notify();
        return { success: true };
    }

    deleteCoupon(templateId) {
        const index = this.state.coupons.templates.findIndex(t => t.id === templateId);
        if (index === -1) return { success: false, message: '优惠券不存在' };
        this.state.coupons.templates.splice(index, 1);
        this.notify();
        return { success: true };
    }

    updateCouponTemplate(templateId, updates) {
        const template = this.state.coupons.templates.find(t => t.id === templateId);
        if (!template) return { success: false, message: '优惠券不存在' };
        if (!updates || typeof updates !== 'object') return { success: false, message: '更新参数无效' };

        const allowedFields = [
            'name', 'description', 'type', 'value', 'minAmount', 'maxDiscount',
            'quantity', 'perUserLimit', 'startDay', 'endDay', 'validDays',
            'scope', 'scopeIds', 'receiveType', 'status'
        ];

        let changed = false;
        for (const key of allowedFields) {
            if (updates[key] !== undefined && updates[key] !== template[key]) {
                // 数量调整：不能小于已领取数量
                if (key === 'quantity' && Number(updates[key]) < (template.receivedCount || 0)) {
                    return { success: false, message: `发放数量不能低于已领取数量(${template.receivedCount || 0})` };
                }
                // 数值类字段校验
                if (['value', 'minAmount', 'maxDiscount', 'quantity', 'perUserLimit', 'startDay', 'endDay', 'validDays'].includes(key)) {
                    const num = Number(updates[key]);
                    if (isNaN(num) || num < 0) return { success: false, message: `${key} 必须为非负数字` };
                    template[key] = num;
                } else {
                    template[key] = updates[key];
                }
                changed = true;
            }
        }

        // 校验时间合理性
        if (template.startDay > template.endDay) {
            return { success: false, message: '开始天数不能大于结束天数' };
        }

        if (changed) {
            template.updateTime = { day: this.state.gameTime.day, hour: this.state.gameTime.hour };
            this.notify();
        }
        return { success: true, changed };
    }

    // ==================== 促销活动系统核心方法 ====================
    
    /**
     * 创建促销活动
     * @param {Object} config 活动配置
     * @returns {Object} 创建结果
     */
    createPromotion(config) {
        const now = this.state.gameTime;
        const id = generateId('promo');
        
        const campaign = {
            id,
            name: config.name || '未命名活动',
            type: config.type || 'full_reduction',
            status: config.status || 'draft',
            description: config.description || '',
            
            // 时间配置
            startTime: config.startTime || { day: now.day, hour: 8 },
            endTime: config.endTime || { day: now.day + 7, hour: 22 },
            
            // 适用范围
            scope: config.scope || 'all',
            categoryIds: config.categoryIds || [],
            productIds: config.productIds || [],
            
            // 活动规则
            rules: this._normalizePromotionRules(config.type, config.rules || {}),
            
            // 参与限制
            participationLimit: config.participationLimit || { type: 'unlimited', count: 0 },
            
            // 成本预算
            budget: config.budget || { total: 0, used: 0, dailyLimit: 0 },
            
            // 统计数据
            statistics: {
                participants: 0,
                orders: 0,
                sales: 0,
                discountAmount: 0,
                views: 0,
                clicks: 0,
                conversionRate: 0
            },
            
            // 时间戳
            createdAt: now.day,
            createdHour: now.hour,
            updatedAt: now.day,
            pausedAt: null,
            startedAt: null,
            endedAt: null
        };
        
        this.state.promotions.campaigns.push(campaign);
        this.state.promotions.statistics.totalCampaigns++;
        
        this._updateActivePromotions();
        this.notify();
        
        return { success: true, campaignId: id, campaign };
    }

    /**
     * 标准化活动规则
     */
    _normalizePromotionRules(type, rules) {
        const normalized = { ...rules };
        switch (type) {
            case 'full_reduction':
                normalized.tiers = rules.tiers || PROMOTION_DEFAULTS.fullReductionTiers;
                normalized.stackable = rules.stackable !== false;
                break;
            case 'discount':
                normalized.rate = Math.max(0.1, Math.min(0.99, rules.rate || 0.8));
                normalized.minAmount = rules.minAmount || 0;
                break;
            case 'coupon':
                normalized.denomination = rules.denomination || 10;
                normalized.minPurchase = rules.minPurchase || 50;
                normalized.quantity = rules.quantity || 100;
                normalized.claimed = 0;
                normalized.validDays = rules.validDays || 7;
                break;
            case 'flash_sale':
                normalized.discountRate = Math.max(0.1, Math.min(0.9, rules.discountRate || 0.5));
                normalized.stock = rules.stock || PROMOTION_DEFAULTS.flashSaleDefaultStock;
                normalized.sold = 0;
                normalized.perUserLimit = rules.perUserLimit || 1;
                break;
            case 'free_shipping':
                normalized.threshold = rules.threshold || PROMOTION_DEFAULTS.freeShippingThreshold;
                break;
            case 'gift':
                normalized.giftProductId = rules.giftProductId || null;
                normalized.giftQuantity = rules.giftQuantity || 1;
                normalized.minPurchase = rules.minPurchase || 0;
                normalized.giftStock = rules.giftStock || 50;
                normalized.giftsGiven = 0;
                break;
        }
        return normalized;
    }

    /**
     * 更新促销活动
     */
    updatePromotion(campaignId, updates) {
        const campaign = this.state.promotions.campaigns.find(c => c.id === campaignId);
        if (!campaign) return { success: false, message: '活动不存在' };
        updates = updates || {};
        
        if (campaign.status === 'active' && !updates.status) {
            return { success: false, message: '进行中的活动请先暂停再编辑' };
        }

        // 状态切换：启动 / 暂停 / 结束
        if (updates.status) {
            const next = updates.status;
            if (next === 'active') {
                if (campaign.status === 'ended') return { success: false, message: '已结束的活动无法启动' };
                const now = this.state.gameTime;
                if (this._isTimeAfter(now, campaign.endTime)) {
                    campaign.status = 'ended';
                    return { success: false, message: '活动已过结束时间，无法启动' };
                }
                campaign.status = 'active';
                campaign.startedAt = campaign.startedAt || { day: now.day, hour: now.hour };
                campaign.pausedAt = null;
            } else if (next === 'paused') {
                return this.pausePromotion(campaignId);
            } else if (next === 'ended') {
                campaign.status = 'ended';
                campaign.endedAt = { day: this.state.gameTime.day, hour: this.state.gameTime.hour };
            } else {
                campaign.status = next;
            }
        }
        
        if (updates.name) campaign.name = updates.name;
        if (updates.description) campaign.description = updates.description;
        if (updates.startTime) campaign.startTime = updates.startTime;
        if (updates.endTime) campaign.endTime = updates.endTime;
        if (updates.scope) campaign.scope = updates.scope;
        if (updates.categoryIds) campaign.categoryIds = updates.categoryIds;
        if (updates.productIds) campaign.productIds = updates.productIds;
        if (updates.participationLimit) campaign.participationLimit = updates.participationLimit;
        if (updates.budget) campaign.budget = { ...campaign.budget, ...updates.budget };
        if (updates.rules) {
            campaign.rules = this._normalizePromotionRules(campaign.type, { ...campaign.rules, ...updates.rules });
        }
        
        campaign.updatedAt = this.state.gameTime.day;
        
        this._updateActivePromotions();
        this.notify();
        
        return { success: true, campaign };
    }

    /**
     * 暂停活动
     */
    pausePromotion(campaignId) {
        const campaign = this.state.promotions.campaigns.find(c => c.id === campaignId);
        if (!campaign) return { success: false, message: '活动不存在' };
        if (campaign.status !== 'active') return { success: false, message: '只有进行中的活动可以暂停' };
        
        campaign.status = 'paused';
        campaign.pausedAt = { day: this.state.gameTime.day, hour: this.state.gameTime.hour };
        
        this._updateActivePromotions();
        this.notify();
        
        return { success: true };
    }

    /**
     * 恢复活动
     */
    resumePromotion(campaignId) {
        const campaign = this.state.promotions.campaigns.find(c => c.id === campaignId);
        if (!campaign) return { success: false, message: '活动不存在' };
        if (campaign.status !== 'paused') return { success: false, message: '只有已暂停的活动可以恢复' };
        
        const now = this.state.gameTime;
        if (this._isTimeAfter(now, campaign.endTime)) {
            campaign.status = 'ended';
            return { success: false, message: '活动已过结束时间，无法恢复' };
        }
        
        campaign.status = 'active';
        campaign.pausedAt = null;
        
        this._updateActivePromotions();
        this.notify();
        
        return { success: true };
    }

    /**
     * 取消/删除活动
     */
    deletePromotion(campaignId) {
        const index = this.state.promotions.campaigns.findIndex(c => c.id === campaignId);
        if (index === -1) return { success: false, message: '活动不存在' };
        
        const campaign = this.state.promotions.campaigns[index];
        if (campaign.status === 'active') {
            return { success: false, message: '请先暂停活动再删除' };
        }
        
        this.state.promotions.campaigns.splice(index, 1);
        
        this._updateActivePromotions();
        this.notify();
        
        return { success: true };
    }

    /**
     * 复制活动
     */
    duplicatePromotion(campaignId) {
        const campaign = this.state.promotions.campaigns.find(c => c.id === campaignId);
        if (!campaign) return { success: false, message: '活动不存在' };
        
        const copy = JSON.parse(JSON.stringify(campaign));
        copy.id = generateId('promo');
        copy.name = campaign.name + ' (副本)';
        copy.status = 'draft';
        copy.statistics = {
            participants: 0, orders: 0, sales: 0, discountAmount: 0,
            views: 0, clicks: 0, conversionRate: 0
        };
        copy.createdAt = this.state.gameTime.day;
        copy.startedAt = null;
        copy.endedAt = null;
        copy.pausedAt = null;
        
        if (copy.rules) {
            if (copy.rules.claimed !== undefined) copy.rules.claimed = 0;
            if (copy.rules.sold !== undefined) copy.rules.sold = 0;
            if (copy.rules.giftsGiven !== undefined) copy.rules.giftsGiven = 0;
        }
        
        this.state.promotions.campaigns.push(copy);
        this.state.promotions.statistics.totalCampaigns++;
        
        this.notify();
        
        return { success: true, campaignId: copy.id, campaign: copy };
    }

    /**
     * 更新生效中的活动列表缓存
     */
    _updateActivePromotions() {
        const now = this.state.gameTime;
        this.state.promotions.activeIds = this.state.promotions.campaigns
            .filter(c => c.status === 'active' && this._isPromotionActive(c, now))
            .map(c => c.id);
    }

    /**
     * 判断活动是否在生效时间内
     */
    _isPromotionActive(campaign, now) {
        if (!campaign || !campaign.startTime || !campaign.endTime || !now) return false;
        // 生效窗口：startTime <= now <= endTime
        // _isTimeAfter(a,b) 表示 a 晚于 b
        const started = !this._isTimeAfter(campaign.startTime, now); // start <= now
        const notEnded = !this._isTimeAfter(now, campaign.endTime);  // now <= end
        return started && notEnded;
    }

    /**
     * 比较游戏时间 a 是否晚于 b
     */
    _isTimeAfter(a, b) {
        if (a.day > b.day) return true;
        if (a.day < b.day) return false;
        return a.hour > b.hour;
    }

    /**
     * 获取所有活动
     */
    getPromotions(filter = {}) {
        let campaigns = [...this.state.promotions.campaigns];
        
        if (filter.status) {
            campaigns = campaigns.filter(c => c.status === filter.status);
        }
        if (filter.type) {
            campaigns = campaigns.filter(c => c.type === filter.type);
        }
        
        return campaigns.sort((a, b) => b.createdAt - a.createdAt);
    }

    /**
     * 获取当前生效的活动
     */
    getActivePromotions() {
        this._updateActivePromotions();
        return this.state.promotions.activeIds.map(id => 
            this.state.promotions.campaigns.find(c => c.id === id)
        ).filter(Boolean);
    }

    /**
     * 检查用户参与资格
     */
    checkParticipationEligibility(campaignId, userId = 'default_user') {
        const campaign = this.state.promotions.campaigns.find(c => c.id === campaignId);
        if (!campaign) return { eligible: false, reason: '活动不存在' };
        if (campaign.status !== 'active') return { eligible: false, reason: '活动未在进行中' };
        
        const now = this.state.gameTime;
        if (!this._isPromotionActive(campaign, now)) {
            return { eligible: false, reason: '活动不在有效时间内' };
        }
        
        // 防刷检查
        const fraudCheck = this._checkAntiFraud(userId, campaign.type);
        if (!fraudCheck.passed) {
            return { eligible: false, reason: fraudCheck.reason };
        }
        
        // 参与限制检查
        const limit = campaign.participationLimit;
        const records = this.state.promotions.participationRecords.filter(
            r => r.campaignId === campaignId && r.userId === userId
        );
        
        switch (limit.type) {
            case 'daily':
                const todayRecords = records.filter(r => r.day === now.day);
                if (todayRecords.length >= limit.count) {
                    return { eligible: false, reason: `今日参与次数已达上限（${limit.count}次）` };
                }
                break;
            case 'total':
                if (records.length >= limit.count) {
                    return { eligible: false, reason: `活动期间参与次数已达上限（${limit.count}次）` };
                }
                break;
            case 'new_user':
                const userOrders = this.state.orders.filter(o => o.customerId === userId);
                if (userOrders.length > 0) {
                    return { eligible: false, reason: '该活动仅限新用户参与' };
                }
                break;
        }
        
        return { eligible: true };
    }

    /**
     * 用户领取优惠券
     */
    claimCoupon(campaignId, userId = 'default_user') {
        const campaign = this.state.promotions.campaigns.find(c => c.id === campaignId);
        if (!campaign || campaign.type !== 'coupon') {
            return { success: false, message: '优惠券活动不存在' };
        }
        
        const eligibility = this.checkParticipationEligibility(campaignId, userId);
        if (!eligibility.eligible) {
            return { success: false, message: eligibility.reason };
        }
        
        if (campaign.rules.claimed >= campaign.rules.quantity) {
            return { success: false, message: '优惠券已领完' };
        }
        
        const couponId = generateId('uc');
        const now = this.state.gameTime;
        const expireDay = now.day + campaign.rules.validDays;
        
        const userCoupon = {
            id: couponId,
            campaignId: campaign.id,
            userId: userId,
            denomination: campaign.rules.denomination,
            minPurchase: campaign.rules.minPurchase,
            status: 'available',
            claimedDay: now.day,
            expireDay: expireDay,
            usedDay: null,
            orderId: null
        };
        
        this.state.promotions.userCoupons.push(userCoupon);
        campaign.rules.claimed++;
        campaign.statistics.participants++;
        this.state.promotions.statistics.totalCouponsIssued++;
        
        this._recordParticipation(campaignId, userId, 'claim_coupon', {
            couponId,
            day: now.day,
            hour: now.hour
        });
        
        this.notify();
        
        return { success: true, coupon: userCoupon };
    }

    /**
     * 获取用户可用优惠券
     */
    getUserCoupons(userId = 'default_user', status = 'available') {
        return this.state.promotions.userCoupons.filter(
            uc => uc.userId === userId && uc.status === status
        );
    }

    /**
     * 计算订单优惠金额
     * @param {Array} items 订单商品 [{productId, price, quantity}]
     * @param {string} couponId 用户选择的优惠券ID（可选）
     * @returns {Object} 优惠计算结果
     */
    calculateOrderDiscount(items, couponId = null) {
        const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
        let totalDiscount = 0;
        let appliedPromotions = [];
        let freeShipping = false;
        
        const activePromotions = this.getActivePromotions();
        
        for (const campaign of activePromotions) {
            if (!campaign) continue;
            if (!this._isItemEligibleForPromotion(items, campaign)) continue;
            
            // ===== 关键修复：rules 为 null/非对象时兜底，防止 TypeError =====
            const rules = campaign.rules || {};
            let discount = 0;
            switch (campaign.type) {
                case 'full_reduction':
                case 'fullReduction': // 兼容两种命名
                    discount = this._calculateFullReduction(subtotal, rules.tiers);
                    break;
                case 'discount':
                    if (subtotal >= (rules.minAmount || 0)) {
                        const rate = typeof rules.rate === 'number' ? rules.rate : 1;
                        discount = subtotal * Math.max(0, Math.min(1, 1 - rate));
                    }
                    break;
                case 'free_shipping':
                case 'freeShipping':
                    if (subtotal >= (rules.threshold || 0)) {
                        freeShipping = true;
                    }
                    break;
                case 'flash_sale':
                case 'flashSale': {
                    // 兼容 discountRate（规范化字段）与 rate（旧字段）
                    const flashRate = typeof rules.discountRate === 'number' ? rules.discountRate
                        : (typeof rules.rate === 'number' ? rules.rate : 1);
                    const sold = typeof rules.sold === 'number' ? rules.sold : 0;
                    const stock = typeof rules.stock === 'number' ? rules.stock
                        : (typeof rules.totalStock === 'number' ? rules.totalStock : 0);
                    // 限时特价：无限库存或未售罄才给折扣
                    if (stock <= 0 || sold < stock) {
                        discount = subtotal * Math.max(0, Math.min(1, 1 - flashRate));
                    }
                    break;
                }
                case 'group_buy':
                case 'groupBuy':
                    const groupRate = typeof rules.rate === 'number' ? rules.rate : 1;
                    discount = subtotal * Math.max(0, Math.min(1, 1 - groupRate));
                    break;
                // 其他未知类型：静默跳过不崩溃
            }
            
            if (discount > 0) {
                totalDiscount += discount;
                appliedPromotions.push({
                    campaignId: campaign.id,
                    name: campaign.name || '促销活动',
                    type: campaign.type,
                    discount: Math.round(discount * 100) / 100
                });
            }
        }
        
        if (couponId) {
            const coupon = Array.isArray(this.state.promotions.userCoupons)
                ? this.state.promotions.userCoupons.find(
                    uc => uc && uc.id === couponId && uc.status === 'available'
                  )
                : null;
            const minPurchase = coupon ? (typeof coupon.minPurchase === 'number' ? coupon.minPurchase : 0) : 0;
            const denomination = coupon ? (typeof coupon.denomination === 'number' ? coupon.denomination : 0) : 0;
            if (coupon && subtotal >= minPurchase && denomination > 0) {
                totalDiscount += denomination;
                appliedPromotions.push({
                    campaignId: coupon.campaignId,
                    name: '优惠券',
                    type: 'coupon',
                    discount: denomination,
                    couponId: coupon.id
                });
            }
        }
        
        totalDiscount = Math.min(totalDiscount, Math.max(0, subtotal * 0.9));
        
        return {
            subtotal: Math.round(subtotal * 100) / 100,
            discount: Math.round(totalDiscount * 100) / 100,
            finalAmount: Math.round(Math.max(0, subtotal - totalDiscount) * 100) / 100,
            appliedPromotions,
            freeShipping
        };
    }

    _isItemEligibleForPromotion(items, campaign) {
        if (!campaign) return false;
        if (campaign.scope === 'all') return true;
        
        const productIds = items.map(i => i && i.productId).filter(Boolean);
        if (campaign.scope === 'product') {
            const cpIds = Array.isArray(campaign.productIds) ? campaign.productIds : [];
            return productIds.some(pid => cpIds.includes(pid));
        }
        if (campaign.scope === 'category') {
            const ccIds = Array.isArray(campaign.categoryIds) ? campaign.categoryIds : [];
            return items.some(item => {
                if (!item) return false;
                const product = PRODUCTS.find(p => p.id === item.productId);
                return product && ccIds.includes(product.category);
            });
        }
        return false;
    }

    _calculateFullReduction(subtotal, tiers) {
        if (!tiers || !Array.isArray(tiers) || tiers.length === 0) return 0;
        const sortedTiers = [...tiers]
            .filter(t => t && typeof t.threshold === 'number' && typeof t.discount === 'number')
            .sort((a, b) => b.threshold - a.threshold);
        for (const tier of sortedTiers) {
            if (subtotal >= tier.threshold) {
                return Math.max(0, tier.discount);
            }
        }
        return 0;
    }

    /**
     * 应用优惠到订单（订单创建后调用）
     */
    applyPromotionToOrder(order, discountResult) {
        const now = this.state.gameTime;
        const orderItemsQty = Array.isArray(order.items)
            ? order.items.reduce((sum, i) => sum + (i && typeof i.quantity === 'number' ? i.quantity : 0), 0)
            : 1;
        const orderFinal = typeof order.finalAmount === 'number' ? order.finalAmount : (typeof order.total === 'number' ? order.total : 0);
        const drDiscount = typeof (discountResult && discountResult.discount) === 'number' ? discountResult.discount : 0;
        const drFinal = typeof (discountResult && discountResult.finalAmount) === 'number' ? discountResult.finalAmount : orderFinal;
        const appliedPromotions = Array.isArray(discountResult && discountResult.appliedPromotions)
            ? discountResult.appliedPromotions
            : [];
        
        for (const applied of appliedPromotions) {
            if (!applied) continue;
            const campaign = Array.isArray(this.state.promotions.campaigns)
                ? this.state.promotions.campaigns.find(c => c && c.id === applied.campaignId)
                : null;
            if (!campaign) continue;
            
            // ===== 关键修复：statistics/rules 为 null 时兜底 =====
            if (!campaign.statistics || typeof campaign.statistics !== 'object') {
                campaign.statistics = { views: 0, clicks: 0, orders: 0, sales: 0, discountAmount: 0, participants: 0 };
            }
            if (typeof campaign.statistics.orders !== 'number') campaign.statistics.orders = 0;
            if (typeof campaign.statistics.sales !== 'number') campaign.statistics.sales = 0;
            if (typeof campaign.statistics.discountAmount !== 'number') campaign.statistics.discountAmount = 0;
            
            campaign.statistics.orders++;
            campaign.statistics.sales += orderFinal;
            campaign.statistics.discountAmount += typeof applied.discount === 'number' ? applied.discount : 0;
            
            if (applied.type === 'coupon' && applied.couponId) {
                const coupon = Array.isArray(this.state.promotions.userCoupons)
                    ? this.state.promotions.userCoupons.find(uc => uc && uc.id === applied.couponId)
                    : null;
                if (coupon) {
                    coupon.status = 'used';
                    coupon.usedDay = now.day;
                    coupon.orderId = order.id;
                    if (typeof this.state.promotions.statistics.totalCouponsUsed !== 'number') {
                        this.state.promotions.statistics.totalCouponsUsed = 0;
                    }
                    this.state.promotions.statistics.totalCouponsUsed++;
                }
            }
            
            if ((campaign.type === 'flash_sale' || campaign.type === 'flashSale') && campaign.rules) {
                if (typeof campaign.rules.sold !== 'number') campaign.rules.sold = 0;
                campaign.rules.sold += orderItemsQty;
            }
            if (campaign.type === 'gift' && campaign.rules) {
                if (typeof campaign.rules.giftsGiven !== 'number') campaign.rules.giftsGiven = 0;
                campaign.rules.giftsGiven += typeof campaign.rules.giftQuantity === 'number' ? campaign.rules.giftQuantity : 1;
            }
            
            this._recordParticipation(campaign.id, order.customerId || 'guest', 'order', {
                orderId: order.id,
                discount: typeof applied.discount === 'number' ? applied.discount : 0,
                day: now.day,
                hour: now.hour
            });
        }
        
        // ===== 修复：promotions.statistics 为 null/缺字段时兜底 =====
        if (!this.state.promotions.statistics || typeof this.state.promotions.statistics !== 'object') {
            this.state.promotions.statistics = {
                totalCampaigns: 0, activeCampaigns: 0, totalParticipants: 0,
                totalDiscountAmount: 0, totalSalesFromPromo: 0,
                totalCouponsIssued: 0, totalCouponsUsed: 0
            };
        }
        if (typeof this.state.promotions.statistics.totalDiscountAmount !== 'number') {
            this.state.promotions.statistics.totalDiscountAmount = 0;
        }
        if (typeof this.state.promotions.statistics.totalSalesFromPromo !== 'number') {
            this.state.promotions.statistics.totalSalesFromPromo = 0;
        }
        this.state.promotions.statistics.totalDiscountAmount += drDiscount;
        this.state.promotions.statistics.totalSalesFromPromo += drFinal;
        
    }

    _recordParticipation(campaignId, userId, action, data) {
        this.state.promotions.participationRecords.push({
            id: generateId('pr'),
            campaignId,
            userId,
            action,
            data,
            day: data.day || this.state.gameTime.day,
            hour: data.hour || this.state.gameTime.hour,
            timestamp: Date.now()
        });
    }

    _checkAntiFraud(userId, actionType) {
        const now = Date.now();
        const antiFraud = this.state.promotions.antiFraud;
        
        if (antiFraud.blacklistedUsers[userId]) {
            return { passed: false, reason: '您已被限制参与活动' };
        }
        
        const timestamps = actionType === 'coupon' 
            ? antiFraud.couponClaimTimestamps 
            : antiFraud.orderTimestamps;
        
        const oneHourAgo = now - 3600000;
        const recentActions = timestamps.filter(t => t > oneHourAgo && t.userId === userId);
        
        const maxActions = actionType === 'coupon' 
            ? ANTI_FRAUD_CONFIG.maxCouponClaimPerHour 
            : ANTI_FRAUD_CONFIG.maxOrdersPerHour;
        
        if (recentActions.length >= maxActions) {
            if (!antiFraud.suspiciousUsers[userId]) {
                antiFraud.suspiciousUsers[userId] = { count: 0, firstDetected: now };
            }
            antiFraud.suspiciousUsers[userId].count++;
            
            if (antiFraud.suspiciousUsers[userId].count >= ANTI_FRAUD_CONFIG.suspiciousThreshold) {
                antiFraud.blacklistedUsers[userId] = true;
            }
            
            return { passed: false, reason: '操作过于频繁，请稍后再试' };
        }
        
        timestamps.push({ userId, timestamp: now });
        
        if (timestamps.length > 1000) {
            timestamps.splice(0, timestamps.length - 500);
        }
        
        return { passed: true };
    }

    /**
     * 获取活动统计数据
     */
    getPromotionStatistics(campaignId = null) {
        if (campaignId) {
            const campaign = this.state.promotions.campaigns.find(c => c.id === campaignId);
            if (!campaign) return null;
            
            const stats = campaign.statistics;
            const records = this.state.promotions.participationRecords.filter(r => r.campaignId === campaignId);
            
            const dailyStats = {};
            records.forEach(r => {
                const key = `D${r.day}`;
                if (!dailyStats[key]) {
                    dailyStats[key] = { day: r.day, participants: 0, orders: 0, discount: 0 };
                }
                dailyStats[key].participants++;
                if (r.action === 'order') {
                    dailyStats[key].orders++;
                    dailyStats[key].discount += r.data.discount || 0;
                }
            });
            
            return {
                overview: {
                    name: campaign.name,
                    type: campaign.type,
                    status: campaign.status,
                    duration: `${campaign.startTime.day}天-${campaign.endTime.day}天`,
                    ...stats,
                    conversionRate: stats.views > 0 ? ((stats.orders / stats.views) * 100).toFixed(1) + '%' : '0%'
                },
                dailyStats: Object.values(dailyStats).sort((a, b) => a.day - b.day)
            };
        }
        
        const all = this.state.promotions.statistics;
        const activeCount = this.getActivePromotions().length;
        
        return {
            overview: {
                totalCampaigns: all.totalCampaigns,
                activeCampaigns: activeCount,
                totalParticipants: all.totalParticipants,
                totalDiscountAmount: all.totalDiscountAmount,
                totalSalesFromPromo: all.totalSalesFromPromo,
                totalCouponsIssued: all.totalCouponsIssued,
                totalCouponsUsed: all.totalCouponsUsed,
                couponUsageRate: all.totalCouponsIssued > 0 
                    ? ((all.totalCouponsUsed / all.totalCouponsIssued) * 100).toFixed(1) + '%' 
                    : '0%'
            },
            campaigns: this.state.promotions.campaigns.map(c => ({
                id: c.id,
                name: c.name,
                type: c.type,
                status: c.status,
                participants: c.statistics.participants,
                orders: c.statistics.orders,
                sales: c.statistics.sales,
                discount: c.statistics.discountAmount
            }))
        };
    }

    /**
     * 每日更新活动状态
     */
    dailyPromotionUpdate() {
        const now = this.state.gameTime;
        let needNotify = false;
        
        for (const campaign of this.state.promotions.campaigns) {
            // draft / pending 到点自动启动
            if ((campaign.status === 'draft' || campaign.status === 'pending') &&
                !this._isTimeAfter(campaign.startTime, now) &&
                !this._isTimeAfter(now, campaign.endTime)) {
                campaign.status = 'active';
                campaign.startedAt = { day: now.day, hour: now.hour };
                needNotify = true;
            }
            
            if (campaign.status === 'active' && this._isTimeAfter(now, campaign.endTime)) {
                campaign.status = 'ended';
                campaign.endedAt = { day: now.day, hour: now.hour };
                needNotify = true;
            }
        }
        
        const now_day = now.day;
        this.state.promotions.userCoupons.forEach(uc => {
            if (uc.status === 'available' && uc.expireDay < now_day) {
                uc.status = 'expired';
                needNotify = true;
            }
        });
        
        this._updateActivePromotions();
        
        if (now_day - this.state.promotions.lastCleanupDay > 7) {
            this._cleanupOldRecords();
            this.state.promotions.lastCleanupDay = now_day;
        }
        
        if (needNotify) {
            this.notify();
        }
    }

    _cleanupOldRecords() {
        const cutoff = this.state.gameTime.day - 30;
        this.state.promotions.participationRecords = 
            this.state.promotions.participationRecords.filter(r => r.day >= cutoff);
        
        const antiFraud = this.state.promotions.antiFraud;
        const now = Date.now();
        const oneDayAgo = now - 86400000;
        antiFraud.orderTimestamps = antiFraud.orderTimestamps.filter(t => t.timestamp > oneDayAgo);
        antiFraud.couponClaimTimestamps = antiFraud.couponClaimTimestamps.filter(t => t.timestamp > oneDayAgo);
        
        Object.keys(antiFraud.suspiciousUsers).forEach(userId => {
            if (now - antiFraud.suspiciousUsers[userId].firstDetected > 86400000 * 7) {
                delete antiFraud.suspiciousUsers[userId];
            }
        });
    }
}

const gameState = new GameState();

// ⚠️ 安全（破解面收敛）：
// 旧代码 `window.gameState = gameState;` 会把**可写**的经济对象挂到 window 上，
// F12 执行 `window.gameState.state.shop.funds = 1e9` 即可直接刷钱，正式版必须去掉。
// 这里只暴露「构造函数」+「冻结的只读诊断快照」，排查问题够用但改不动钱。
if (typeof window !== 'undefined') {
    try {
        Object.defineProperty(window, 'GameState', {
            value: GameState, writable: false, configurable: false, enumerable: false
        });
    } catch (_) {}

    const _diagSnapshot = function () {
        const s = (gameState && gameState.state) || {};
        const shop = s.shop || {};
        const gt = s.gameTime || {};
        return Object.freeze({
            day: gt.day,
            hour: gt.hour,
            funds: GameEconomyGuard.sanitize(shop.funds, 0),
            level: shop.level,
            reputation: shop.reputation,
            orderCount: Array.isArray(s.orders) ? s.orders.length : 0,
            economyGuard: Object.freeze(Object.assign({}, GameEconomyGuard.stats))
        });
    };
    try {
        Object.defineProperty(window, '__ecommerceSimDiag', {
            value: Object.freeze({
                snapshot: _diagSnapshot,
                version: (typeof APP_VERSION !== 'undefined') ? String(APP_VERSION) : ''
            }),
            writable: false, configurable: false, enumerable: false
        });
    } catch (_) {}
}
