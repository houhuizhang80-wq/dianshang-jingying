/**
 * supplyData.js — 供应商谈判与供应链·数据与配置
 * 体系:采购累积关系值 → 自动升级合作等级(普通→熟客→战略伙伴→独家)
 *      熟客可谈账期(先货后款);战略伙伴可开通源头直采(92折);顶级可签独家代理(85折)。
 * 所有数值默认关闭(等级不足时乘数=1、无账期),对既有存档/测试零影响。
 */
'use strict';

const SUPPLY_TIERS = [
    { id: 'regular',   name: '普通合作', points: 0,    benefits: [] },
    { id: 'trusted',   name: '熟客',     points: 500,  benefits: ['credit'] },
    { id: 'strategic', name: '战略伙伴', points: 2000, benefits: ['credit', 'direct'] },
    { id: 'exclusive', name: '独家代理', points: 5000, benefits: ['credit', 'direct', 'exclusive'] }
];

const SUPPLY_CONFIG = {
    pointsPerYuan: 0.01,         // 每消费 ¥1 积 0.01 分(消费 1 万 ≈ 100 分)
    directMultiplier: 0.92,      // 源头直采:采购价 ×0.92
    exclusiveMultiplier: 0.85,   // 独家代理:采购价 ×0.85
    directActivationFee: 20000,  // 开通直采一次性费用
    exclusiveAgencyFee: 50000,   // 独家代理费
    creditOptions: [7, 15, 30],  // 可谈账期天数
    creditGraceDays: 3,          // 到期后宽限天数(不罚息)
    creditPenaltyRate: 0.02,     // 逾期罚息 2%/天(计入欠款)
    creditReputationHit: 1       // 逾期每天信誉 -1
};

/** 供应链模块附加状态默认值(挂在 gameState.state.supply,随主存档持久化) */
function getSupplyDefaults() {
    return {
        version: 1,
        relations: {}   // { [supplierId]: { points, tier, lastBuyDay, direct, exclusive, credit: { days, liability, dueDay, overdueDays } | null } }
    };
}

// 导出兼容(浏览器全局 + Node 测试)
if (typeof window !== 'undefined') {
    window.SUPPLY_TIERS = SUPPLY_TIERS;
    window.SUPPLY_CONFIG = SUPPLY_CONFIG;
    window.getSupplyDefaults = getSupplyDefaults;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SUPPLY_TIERS, SUPPLY_CONFIG, getSupplyDefaults };
}
