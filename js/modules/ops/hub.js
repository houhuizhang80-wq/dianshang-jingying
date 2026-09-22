/**
 * Ops Hub — 初始化售后 / 纳税 / 法务
 */
const OpsHub = (function () {
    'use strict';

    function init(gameState, uiManager) {
        try {
            if (typeof AfterSalesState !== 'undefined' && AfterSalesState.init) AfterSalesState.init(gameState);
            if (typeof AfterSalesEngine !== 'undefined' && AfterSalesEngine.init) AfterSalesEngine.init(gameState);
            if (typeof AfterSalesUI !== 'undefined' && AfterSalesUI.init) AfterSalesUI.init(gameState, uiManager);
        } catch (e) { console.warn('[OpsHub] afterSales init failed', e); }

        try {
            if (typeof TaxState !== 'undefined' && TaxState.init) TaxState.init(gameState);
            if (typeof TaxEngine !== 'undefined' && TaxEngine.init) TaxEngine.init();
        } catch (e) { console.warn('[OpsHub] tax init failed', e); }

        try {
            if (typeof LegalEngine !== 'undefined' && LegalEngine.init) LegalEngine.init(gameState);
            else if (typeof LegalState !== 'undefined' && LegalState.init) LegalState.init(gameState);
        } catch (e) { console.warn('[OpsHub] legal init failed', e); }

        try {
            if (typeof legalUI !== 'undefined' && legalUI.init) legalUI.init(gameState, uiManager);
        } catch (_) {}

        return { success: true };
    }

    return { init };
})();

if (typeof window !== 'undefined') window.OpsHub = OpsHub;
