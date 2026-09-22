/**
 * 采购中心模块（V2 重制）- 引擎集成
 * 负责智能推荐快照的每日刷新与采购到货后的失效重算。
 */
class ProcurementEngine {
    constructor(procurementState, gameState, gameEngine) {
        this.procState = procurementState;
        this.gameState = gameState;
        this.gameEngine = gameEngine;
        this.initialized = false;
        this._lastRefreshDay = 0;
    }

    init() {
        if (this.initialized) return;
        // gameEngine 实例未挂 eventBus 时回退全局 eventBus（与 gameEngine 内部 emit 一致）
        const bus = (this.gameEngine && this.gameEngine.eventBus)
            || (typeof eventBus !== 'undefined' ? eventBus : null);
        if (bus) {
            bus.on('game:dailyTick', this.onDailyTick.bind(this));
            bus.on('day:update', this.onDailyTick.bind(this)); // 兼容其他模块使用的事件名
            bus.on('purchase:received', this.onPurchaseReceived.bind(this));
        }
        this.initialized = true;
    }

    /** 跨日刷新推荐（每日仅一次） */
    onDailyTick(payload) {
        try {
            const day = (payload && typeof payload === 'object' && payload.day)
                || (this.gameState.state.gameTime && this.gameState.state.gameTime.day)
                || 1;
            if (this._lastRefreshDay === day) return;
            this._lastRefreshDay = day;
            const settings = this.procState.state.settings || {};
            if (settings.autoRefresh === false) return;
            this.refresh();
        } catch (e) {
            console.error('[ProcurementEngine] 每日刷新异常：', e);
        }
    }

    /** 采购到货：推荐快照已过时，下次获取时自动重算 */
    onPurchaseReceived() {
        try {
            if (this.procState.state) this.procState.state.lastRefreshDay = 0;
        } catch (_) {}
    }

    /** 立即重算智能推荐 */
    refresh() {
        try {
            return this.procState.buildRecommendations(true);
        } catch (e) {
            console.error('[ProcurementEngine] 推荐刷新失败：', e);
            return null;
        }
    }
}

let procurementEngineInstance = null;

function initProcurementEngine(procurementState, gameState, gameEngine) {
    if (!procurementEngineInstance) {
        procurementEngineInstance = new ProcurementEngine(procurementState, gameState, gameEngine);
        procurementEngineInstance.init();
    }
    return procurementEngineInstance;
}

// 导出兼容（浏览器全局 + Node 测试）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ProcurementEngine, initProcurementEngine };
}
