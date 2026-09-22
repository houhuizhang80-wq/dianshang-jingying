/**
 * 采购中心模块（V2 重制）- 数据与配置
 * 统一入口：商品进货（货源）、采购订单、采购员、自动采购计划、包装材料采购 + 智能采购推荐。
 */

// 采购中心 Tab 定义
const PROC_TABS = [
    { id: 'smart',     name: '智能推荐', icon: '✨' },
    { id: 'supply',    name: '商品进货', icon: '🏭' },
    { id: 'orders',    name: '采购订单', icon: '📋' },
    { id: 'buyers',    name: '采购员',   icon: '🛒' },
    { id: 'plans',     name: '采购计划', icon: '🗓️' },
    { id: 'packaging', name: '包装材料', icon: '📦' },
    { id: 'relations', name: '供应商关系', icon: '🤝' }
];

// 智能采购推荐配置
const SMART_REC_CONFIG = {
    safetyDays: 2,        // 建议补货量 = 日销量 × 安全天数（再扣现有库存/在途）
    salesWindowDays: 7,   // 销量统计窗口（近 N 天）
    minDailySales: 0.1,   // 近窗内售出 ≥1 件即纳入推荐（放宽，保证早期也有推荐）
    maxItems: 12,         // 最多推荐条数（从全部商品随机选品，商品不单一）
    marginWeight: 0.4,    // 评分中的利润率权重（销量权重为 1）
    refreshIntervalDays: 1, // 快照每日刷新
    pendingWeight: 0.6,   // 未发货订单计入补货需求的比例
    lowStockSuggest: 20,  // 在架商品库存低于该值时，即使暂无销量也建议补货（缺货预警）
    fundsRatio: 0.7,      // 推荐预算 = 现有资金 × 该比例（70%），仓容分配后再按资金裁剪
    bundleMinItems: 3,    // 推荐组合最少商品数
    bundleMaxItems: 8,    // 推荐组合最多商品数
    bundleDiscount: 0.96, // 推荐组合整单 9.6 折
    warehouseSlotFirst: true, // 数量优先按仓库空位分配，不再按资金放大到仓容之外
    logicVersion: 7       // 推荐逻辑版本：仓容优先；旧快照自动失效重算
};

// 采购中心模块附加状态默认值（挂在 gameState.state.procurementModule，随主存档持久化）
function getProcurementModuleDefaults() {
    return {
        version: 1,
        settings: { autoRefresh: true },
        lastRefreshDay: 0,
        smartSnapshot: null,        // { day, items: [...] }
        quickBuyLog: []             // [{id, productId, productName, quantity, cost, supplierName, day}]
    };
}

// 导出兼容（浏览器全局 + Node 测试）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PROC_TABS, SMART_REC_CONFIG, getProcurementModuleDefaults };
}
