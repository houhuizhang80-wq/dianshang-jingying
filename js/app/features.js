/**
 * 玩法装配：按阶段创建 / 初始化，避免 initGame 里堆一长串 if。
 */
(function (g) {
    'use strict';

    function createPreState() {
        if (typeof WarehouseState !== 'undefined') {
            g.warehouseState = new WarehouseState(gameState);
        }
        if (typeof EmployeeState !== 'undefined') {
            g.employeeState = new EmployeeState(gameState);
        }
        if (typeof ProcurementState !== 'undefined') {
            g.procurementState = new ProcurementState(gameState);
        }
    }

    function initAfterUI() {
        var criticalOk = !!(typeof gameState !== 'undefined' && gameState && gameState.state);

        try { ui.init(); } catch (e) {
            criticalOk = false;
            console.error('[features] ui.init 失败:', e);
        }

        if (typeof bankUI !== 'undefined') {
            try { bankUI.init(); } catch (e) { console.warn('[features] bankUI.init', e); }
        }

        if (g.warehouseState) {
            try {
                if (typeof initWarehouseEngine === 'function') {
                    g.warehouseEngine = initWarehouseEngine(g.warehouseState, gameState, gameEngine);
                }
                if (typeof initWarehouseUI === 'function') {
                    g.whUI = initWarehouseUI(g.warehouseState, gameState, ui);
                }
            } catch (e) {
                criticalOk = false;
                console.error('[features] warehouse 初始化失败:', e);
            }
        } else {
            criticalOk = false;
        }

        if (g.employeeState) {
            try {
                g.employeeState.init(gameState);
                if (typeof initEmployeeEngine === 'function') {
                    g.employeeEngine = initEmployeeEngine(g.employeeState, gameState, gameEngine);
                }
                if (typeof initEmployeeUI === 'function') {
                    g.empUI = initEmployeeUI(g.employeeState, gameState, ui);
                }
            } catch (e) {
                criticalOk = false;
                console.error('[features] employee 初始化失败:', e);
            }
        }

        if (g.procurementState) {
            try {
                g.procurementState.init(gameState);
                if (typeof initProcurementEngine === 'function') {
                    g.procurementEngine = initProcurementEngine(g.procurementState, gameState, gameEngine);
                }
                if (typeof initProcurementUI === 'function') {
                    g.procUI = initProcurementUI(g.procurementState, gameState, ui);
                }
            } catch (e) {
                criticalOk = false;
                console.error('[features] procurement 初始化失败:', e);
            }
        }

        try {
            if (typeof SupplyState !== 'undefined') {
                g.supplyState = new SupplyState(gameState);
                g.supplyState.init(gameState);
                if (typeof initSupplyEngine === 'function') {
                    g.supplyEngine = initSupplyEngine(g.supplyState, gameState, gameEngine);
                    g.supplyEngine.init();
                }
                if (typeof initSupplyUI === 'function') {
                    g.initSupplyUI(g.supplyState, gameState, ui);
                }
            }
        } catch (e) {
            console.warn('[features] supply 初始化失败(已降级):', e);
        }

        if (typeof csEngine !== 'undefined') {
            try { csEngine.init(gameState); } catch (e) { console.warn('[features] csEngine.init', e); }
        }
        if (typeof csUI !== 'undefined') {
            try {
                csUI.init(gameState, ui);
                ui.renderServicePage = function (state) {
                    return csUI.renderServicePage(state);
                };
                ui.approveReturn = function (returnId) {
                    csState.auditReturn(returnId, true, '', '商家客服');
                    ui.forceRender();
                };
                ui.rejectReturn = function (returnId) {
                    csState.auditReturn(returnId, false, '申请不符合退换货条件', '商家客服');
                    ui.forceRender();
                };
            } catch (e) { console.warn('[features] csUI.init', e); }
        }

        try {
            if (typeof dashboardUI !== 'undefined' && dashboardUI && typeof dashboardUI.init === 'function') {
                dashboardUI.init(gameState, ui);
            }
        } catch (e) { console.warn('[features] dashboardUI.init', e); }

        try {
            if (typeof AppNav !== 'undefined' && AppNav.validateCatalog) {
                const report = AppNav.validateCatalog(typeof ui !== 'undefined' ? ui : null);
                if (!report.ok) console.warn('[AppNav] 入口属性缺失', report.missing);
            }
        } catch (e) { console.warn('[features] AppNav.validateCatalog', e); }

        return criticalOk;
    }

    g.AppFeatures = {
        createPreState: createPreState,
        initAfterUI: initAfterUI
    };
})(window);
