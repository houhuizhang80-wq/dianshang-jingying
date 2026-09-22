/**
 * 纳税模块 - 配置数据
 * 独立的纳税系统配置，与游戏主配置解耦
 */

const TAX_CONFIG = {
    vatRate: 0.01,
    surchargeRate: 0.12,
    corporateTaxRate: 0.05,
    corporateTaxHighRate: 0.25,
    vatThreshold: 100000,
    corporateTaxThreshold: 3000000,
    lateFeeRate: 0.0005,
    fineRate: 0.5,
    taxWindowDays: 15,
    declarationGraceDays: 10
};

/** 按注册主体区分税率（与 SHOP_ENTITY_TYPES 对齐） */
const SHOP_ENTITY_TAX = {
    individual: {
        id: 'individual',
        name: '个人',
        vatRate: 0,
        vatThreshold: 0,
        incomeTaxRate: 0.01,
        corporateTaxRate: 0,
        corporateTaxHighRate: 0,
        corporateTaxThreshold: 0,
        incomeLabel: '所得税'
    },
    sole_trader: {
        id: 'sole_trader',
        name: '个体工商户',
        vatRate: 0.01,
        vatThreshold: 100000,
        incomeTaxRate: 0,
        corporateTaxRate: 0.05,
        corporateTaxHighRate: 0.05,
        corporateTaxThreshold: 999999999,
        incomeLabel: '所得税'
    },
    company: {
        id: 'company',
        name: '公司',
        vatRate: 0.03,
        vatThreshold: 100000,
        incomeTaxRate: 0,
        corporateTaxRate: 0.05,
        corporateTaxHighRate: 0.25,
        corporateTaxThreshold: 3000000,
        incomeLabel: '企业所得税'
    }
};

function getShopEntityTaxRates(entityType) {
    const id = entityType || 'individual';
    return SHOP_ENTITY_TAX[id] || SHOP_ENTITY_TAX.individual;
}

const TAX_DEDUCTION_CATEGORIES = [
    'purchase',
    'express',
    'salary',
    'packaging',
    'warehouse_rent',
    'legal_fee',
    'platform'
];

const TAX_DEDUCTION_NAMES = {
    purchase: '采购成本',
    express: '快递费用',
    salary: '员工薪资',
    packaging: '包装材料',
    warehouse_rent: '仓库租金',
    legal_fee: '法务咨询',
    platform: '平台抽成'
};

const TAX_DEDUCTION_ICONS = {
    purchase: '🛒',
    express: '📦',
    salary: '💼',
    packaging: '📮',
    warehouse_rent: '🏭',
    legal_fee: '⚖️',
    platform: '🏛️'
};

const TAX_INITIAL_STATE = {
    records: [],
    monthlyReports: [],
    quarterlyReports: [],
    annualReports: [],
    currentPeriod: {
        // 与游戏真实日历对齐（默认开局：2026年8月）；旧 2024/1 假周期已废弃
        year: (typeof GAME_START_DATE !== 'undefined' && GAME_START_DATE.year) ? GAME_START_DATE.year : 2026,
        month: (typeof GAME_START_DATE !== 'undefined' && GAME_START_DATE.month) ? GAME_START_DATE.month : 8,
        revenue: 0,
        deductibleCosts: {
            purchase: 0,
            express: 0,
            salary: 0,
            packaging: 0,
            warehouse_rent: 0,
            legal_fee: 0,
            platform: 0
        },
        taxableIncome: 0,
        vatPayable: 0,
        surchargePayable: 0,
        corporateTaxPayable: 0,
        totalPayable: 0,
        declared: false,
        paid: false,
        declareDate: null,
        payDate: null,
        overdueDays: 0,
        lateFees: 0,
        fines: 0
    },
    pendingPenalties: [],
    taxCredit: 0,
    warnings: [],
    status: {
        overdue: false,
        underInvestigation: false,
        restrictedFlow: false,
        forcedClose: false
    }
};

function generateTaxId(prefix) {
    const p = prefix || 'tax';
    return p + '_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
}
