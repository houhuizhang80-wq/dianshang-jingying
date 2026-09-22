/**
 * 资源清单：唯一加载顺序。改玩法依赖时只改这里。
 * 层：core → data → game → features → app(boot)
 */
(function (g) {
    'use strict';

    g.AppManifest = {
        scripts: [
            // core
            'js/core/eventBus.js',
            'js/core/saveManager.js',
            'js/core/orderPerf.js',
            'js/core/soundManager.js',
            'js/core/rewardedAdManager.js',
            'js/core/leaderboardClient.js',

            // data（配置与协议）
            'data/gameData.js',
            'data/luxuryCatalog.js',
            'data/shopsData.js',
            'data/productIcons.js',
            'data/assetManifest.js',
            'data/customerServiceData.js',
            'data/privacyPolicy.js',
            'data/legalData.js',
            'data/taxData.js',
            'data/bankData.js',
            'data/warehouseData.js',
            'data/employeeData.js',
            'data/procurementData.js',
            'data/expressData.js',
            'data/liveData.js',
            'data/supplyData.js',

            // features: 分类 / 银行 / 仓储
            'js/modules/product/productClassifier.js',
            'js/modules/bank/bankState.js',
            'js/modules/bank/bankEngine.js',
            'js/modules/bank/bankUI.js',
            'js/modules/warehouse/warehouseState.js',
            'js/modules/warehouse/warehouseEngine.js',
            'js/modules/warehouse/warehouseUI.js',

            // features: 员工 / 采购 / 纳税
            'js/modules/employee/employeeState.js',
            'js/modules/employee/employeeEngine.js',
            'js/modules/procurement/procurementState.js',
            'js/modules/procurement/procurementEngine.js',
            'js/modules/ops/tax/state.js',
            'js/modules/ops/tax/engine.js',
            'js/modules/ops/tax/ui.js',

            // features: 快递 + 游戏内核
            'js/modules/express/expressState.js',
            'js/modules/express/expressEngine.js',
            'js/modules/express/expressUI.js',
            'js/game/gameState.js',

            // features: 售后 / 直播 / 法务 / 海外
            'js/modules/ops/afterSales/state.js',
            'js/modules/livestream/liveState.js',
            'js/game/gameEngine.js',
            'js/modules/quests/dailyQuests.js',
            'js/modules/ops/afterSales/engine.js',
            'js/modules/livestream/liveEngine.js',
            'js/modules/ops/legal/state.js',
            'js/modules/ops/legal/engine.js',
            'js/modules/ops/legal/ui.js',
            'js/modules/ops/overseas/ui.js',
            'js/modules/ops/hub.js',

            // features: 店铺 / UI / 供应链 / 看板
            'js/modules/shops/shopsState.js',
            'js/modules/shops/shopsUI.js',
            'js/game/uiManager.js',
            'js/modules/employee/employeeUI.js',
            'js/modules/procurement/procurementUI.js',
            'js/modules/supply/supplyState.js',
            'js/modules/supply/supplyEngine.js',
            'js/modules/supply/supplyUI.js',
            'js/modules/ops/afterSales/ui.js',
            'js/modules/livestream/liveUI.js',
            'js/modules/dashboard/dashboardData.js',
            'js/modules/dashboard/dashboardUI.js',

            // app：开局与运行时（最后启动）
            'js/app/overlays.js',
            'js/app/navSchema.js',
            'js/app/privacy.js',
            'js/app/onboarding.js',
            'js/app/features.js',
            'js/app/runtime.js',
            'js/app/boot.js'
        ]
    };
})(window);
