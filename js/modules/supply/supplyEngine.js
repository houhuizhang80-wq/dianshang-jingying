/**
 * supplyEngine.js — 供应商谈判与供应链·引擎层
 * 唯一职责:订阅 game:dailyTick(与银行模块同款挂载)驱动每日账款结算。
 */
'use strict';

function initSupplyEngine(supplyState, gameState, gameEngine) {
    const engine = {
        state: supplyState,
        _bound: false,

        init() {
            if (this._bound) return this;
            try {
                if (typeof eventBus !== 'undefined' && eventBus.on) {
                    eventBus.on('game:dailyTick', (payload) => {
                        try {
                            if (this.state && typeof this.state.settleDaily === 'function') {
                                this.state.settleDaily(payload || {});
                            }
                        } catch (e) {
                            try { console.warn('[SupplyEngine] dailyTick:', e); } catch (_) {}
                        }
                    });
                    this._bound = true;
                }
            } catch (_) {}
            return this;
        },

        /** 手动触发一日结算(测试/跳天兜底用,幂等) */
        dailyTick(now) {
            try {
                return this.state && this.state.settleDaily ? this.state.settleDaily({ day: (now && now.day) || (gameState && gameState.state && gameState.state.gameTime && gameState.state.gameTime.day) || 1 }) : null;
            } catch (_) { return null; }
        }
    };
    return engine;
}

if (typeof window !== 'undefined') window.initSupplyEngine = initSupplyEngine;
if (typeof module !== 'undefined' && module.exports) module.exports = { initSupplyEngine };
