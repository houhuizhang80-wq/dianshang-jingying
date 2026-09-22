/**
 * 运行时：读档/开局写入、启动引擎、生命周期保存。
 */
(function (g) {
    'use strict';

    var lifecycleBound = false;

    function applyNewGameTemps(isContinue) {
        if (isContinue) {
            try {
                localStorage.removeItem('temp_shop_name');
                localStorage.removeItem('temp_player_name');
                localStorage.removeItem('temp_player_address');
                localStorage.removeItem('temp_warehouse_city');
                localStorage.removeItem('temp_entity_type');
                localStorage.removeItem('temp_talent');
            } catch (_) {}
            return;
        }

        var tempName = localStorage.getItem('temp_shop_name');
        if (tempName) {
            gameState.setState(function (s) { s.shop.name = tempName; });
            localStorage.removeItem('temp_shop_name');
        }

        var tempPlayerName = localStorage.getItem('temp_player_name');
        var tempPlayerAddr = localStorage.getItem('temp_player_address');
        if (tempPlayerName || tempPlayerAddr) {
            gameState.setState(function (s) {
                s.player = s.player || { name: '', address: '', phone: '' };
                if (tempPlayerName) s.player.name = tempPlayerName;
                if (tempPlayerAddr) s.player.address = tempPlayerAddr;
            });
            localStorage.removeItem('temp_player_name');
            localStorage.removeItem('temp_player_address');
        }

        var tempEntity = localStorage.getItem('temp_entity_type');
        if (tempEntity) {
            var valid = ['individual', 'sole_trader', 'company'].indexOf(tempEntity) >= 0
                ? tempEntity : 'individual';
            gameState.setState(function (s) {
                s.shop = s.shop || {};
                s.shop.entityType = valid;
            });
            localStorage.removeItem('temp_entity_type');
        }

        var tempCity = localStorage.getItem('temp_warehouse_city');
        if (tempCity) {
            var city = typeof getCityById === 'function' ? getCityById(tempCity) : null;
            gameState.setState(function (s) {
                s.warehouse.city = tempCity;
                s.shop = s.shop || {};
                s.shop.city = tempCity;
                if (city && city.effects) {
                    if (city.effects.startMoney) s.shop.funds += city.effects.startMoney;
                    if (city.effects.startCapacity) s.warehouse.startCapacityBonus = city.effects.startCapacity;
                    if (city.effects.startReputation) s.shop.reputation += city.effects.startReputation;
                }
            });
            localStorage.removeItem('temp_warehouse_city');
        }

        // 开局天赋：资金/属性/被动加成（trafficBonus/supplyDiscount/goodEventBonus）
        var tempTalent = localStorage.getItem('temp_talent');
        if (tempTalent) {
            var talent = (typeof TALENTS !== 'undefined' && Array.isArray(TALENTS))
                ? TALENTS.find(function (t) { return t && t.id === tempTalent; }) : null;
            if (talent) {
                gameState.setState(function (s) {
                    s.player = s.player || {};
                    s.player.talent = talent.id;
                    s.player.talentBonus = s.player.talentBonus || {};
                    if (!s.player.attributes || typeof s.player.attributes !== 'object') {
                        s.player.attributes = { operation: 1, selection: 1, negotiation: 1, management: 1, luck: 1 };
                    }
                    var ef = talent.effect || {};
                    if (ef.startMoney) s.shop.funds += Number(ef.startMoney) || 0;
                    ['operation', 'selection', 'negotiation', 'management', 'luck'].forEach(function (k) {
                        if (ef[k]) s.player.attributes[k] = (Number(s.player.attributes[k]) || 1) + Number(ef[k]);
                    });
                    if (ef.trafficBonus) s.player.talentBonus.trafficBonus = Number(ef.trafficBonus) || 0;
                    if (ef.supplyDiscount) s.player.talentBonus.supplyDiscount = Number(ef.supplyDiscount) || 0;
                    if (ef.goodEventBonus) s.player.talentBonus.goodEventBonus = Number(ef.goodEventBonus) || 0;
                });
                try { console.log('[开局] 天赋已应用：' + talent.name); } catch (_) {}
            }
            localStorage.removeItem('temp_talent');
        }
    }

    function bindLifecycleSave() {
        if (lifecycleBound) return;
        lifecycleBound = true;
        if (typeof saveManager === 'undefined') return;

        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'hidden') {
                try { saveManager.emergencySave(); } catch (_) {}
                try { saveManager.flushSave().catch(function () {}); } catch (_) {}
            }
        });
        window.addEventListener('beforeunload', function () {
            try { saveManager.emergencySave(); } catch (_) {}
        });
        window.addEventListener('pagehide', function () {
            try { saveManager.emergencySave(); } catch (_) {}
            try { saveManager.flushSave().catch(function () {}); } catch (_) {}
        });
        saveManager.startSnapshotLoop();
    }

    function bindErrors() {
        if (g.__ecommerceSimErrorBound) return;
        g.__ecommerceSimErrorBound = true;
        var emit = function (payload) {
            try {
                if (typeof eventBus !== 'undefined' && eventBus.emit) eventBus.emit('game:error', payload);
            } catch (_) {}
            try { console.error('[global]', payload); } catch (_) {}
        };
        window.addEventListener('error', function (ev) {
            var msg = (ev && ev.message) || '';
            if (!msg || msg === 'Script error.' || /ResizeObserver/i.test(msg)) return;
            emit({
                method: 'window.onerror',
                error: ev && (ev.error || ev.message),
                message: msg + (ev && ev.filename ? ' @' + String(ev.filename).split('/').pop() + ':' + (ev.lineno || 0) : '')
            });
        });
        window.addEventListener('unhandledrejection', function (ev) {
            var reason = ev && ev.reason;
            var msg = reason && (reason.message || String(reason));
            if (!msg || /ResizeObserver|AbortError/i.test(String(msg))) return;
            emit({ method: 'unhandledrejection', error: reason, message: msg });
        });
    }

    function closeNativeSplash() {
        try {
            if (typeof plus !== 'undefined' && plus.navigator && plus.navigator.closeSplashscreen) {
                plus.navigator.closeSplashscreen();
            }
        } catch (_) {}
    }

    function failCritical() {
        try {
            if (typeof ui !== 'undefined' && ui.showToast) {
                ui.showToast('游戏核心模块加载失败，请刷新重试', 5000);
            } else {
                alert('游戏核心模块加载失败，请刷新页面重试');
            }
        } catch (_) {}
        g.__ecommerceSimInitPromise = null;
        g.__ecommerceSimInited = false;
    }

    function initGame() {
        if (typeof PrivacyFlow !== 'undefined' && PrivacyFlow.canEnterGame && !PrivacyFlow.canEnterGame()) {
            console.warn('[runtime] 未通过隐私协议，拒绝 initGame');
            return Promise.reject(new Error('privacy_required'));
        }
        try {
            if (g.__forceNewGameFlow || g.__ecommerceSimFreshStart) {
                g.__ecommerceSimInited = false;
                g.__ecommerceSimInitPromise = null;
            }
        } catch (_) {}
        if (g.__ecommerceSimInited) return;
        if (g.__ecommerceSimInitPromise) return g.__ecommerceSimInitPromise;

        g.__ecommerceSimInitPromise = (async function () {
            AppFeatures.createPreState();
            await gameState.init();

            var isContinue = !g.__ecommerceSimFreshStart && (
                !!g.__ecommerceSimContinueSave ||
                !!(gameState._loadedFromSource && gameState.state &&
                    gameState.state.gameTime && gameState.state.gameTime.day > 1)
            );
            applyNewGameTemps(isContinue);

            var criticalOk = AppFeatures.initAfterUI();
            if (!criticalOk || !gameState.state) {
                console.error('[runtime] 关键模块未就绪，跳过 gameEngine.start()');
                failCritical();
                return;
            }

            gameEngine.start();
            if (typeof ui._initSaveStatusLight === 'function') {
                try { ui._initSaveStatusLight(); } catch (e) { console.warn('状态灯初始化失败:', e); }
            }
            bindLifecycleSave();
            try {
                await gameState.save();
                if (typeof saveManager !== 'undefined' && saveManager._migratedFromLegacy) {
                    try { saveManager._cleanupLegacyKeysAfterMigrate(); } catch (_) {}
                }
            } catch (e) { console.warn('初始保存失败:', e); }

            console.log('电商经营模拟器启动成功！');
            g.__ecommerceSimInited = true;
            try {
                if (typeof LeaderboardClient !== 'undefined' && LeaderboardClient.startWatch) {
                    LeaderboardClient.startWatch();
                }
            } catch (_) {}
        })().catch(function (e) {
            g.__ecommerceSimInitPromise = null;
            g.__ecommerceSimInited = false;
            throw e;
        });

        return g.__ecommerceSimInitPromise;
    }

    g.AppRuntime = {
        initGame: initGame,
        bindErrors: bindErrors,
        closeNativeSplash: closeNativeSplash,
        splashFallback: closeNativeSplash
    };
    g.initGame = initGame;
})(window);
