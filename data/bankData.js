/**
 * 银行模块 - 配置数据
 * 独立的银行系统配置，与游戏主配置解耦
 * 利率说明：按国内真实年利率设定（参考央行基准与大行挂牌利率），
 *   - 活期 0.10%/年，按日计息
 *   - 30天定期 0.80%/年（参考3个月定期）
 *   - 90天定期 1.10%/年（参考半年~1年期）
 *   - 一年定期 1.45%/年（参考中小银行1年期）
 *   - 贷款 3.10%~3.85%/年（参考1年期LPR及经营贷加点）
 *   - 理财产品：浮动收益，高风险可能亏损本金
 */
const BankData = {
    // 活期存款（年化 0.10%，按日计息）
    currentDeposit: {
        annualRate: 0.001,
        interestRate: 0.001 / 365,
        minAmount: 1,
        description: '随存随取，按日计息，年化0.10%'
    },

    // 定期存款产品（按国家年利率设定）
    fixedDeposits: [
        {
            id: 'fixed_30',
            name: '30天定期',
            termDays: 30,
            annualRate: 0.008,
            interestRate: 0.008 / 365,
            minAmount: 1000,
            earlyWithdrawPenalty: 0.5,
            description: '30天期限，年化0.80%，提前支取按活期计息'
        },
        {
            id: 'fixed_90',
            name: '90天定期',
            termDays: 90,
            annualRate: 0.011,
            interestRate: 0.011 / 365,
            minAmount: 5000,
            earlyWithdrawPenalty: 0.4,
            description: '90天期限，年化1.10%，提前支取按活期计息'
        },
        {
            id: 'fixed_365',
            name: '一年定期',
            termDays: 365,
            annualRate: 0.0145,
            interestRate: 0.0145 / 365,
            minAmount: 10000,
            earlyWithdrawPenalty: 0.3,
            description: '365天期限，年化1.45%，提前支取按活期计息'
        }
    ],

    // 理财产品（浮动收益，有风险；到期一次结算，可提前赎回收0.5%手续费）
    wealthProducts: [
        {
            id: 'w_stable',
            name: '稳健理财',
            termDays: 30,
            annualRate: 0.02,
            volatility: 0.006,
            minAmount: 1000,
            riskIcon: '🟢',
            riskLevel: '低风险',
            description: '预期年化约2.0%，波动很小，基本不亏本金'
        },
        {
            id: 'w_bond',
            name: '债券基金',
            termDays: 90,
            annualRate: 0.035,
            volatility: 0.04,
            minAmount: 5000,
            riskIcon: '🟡',
            riskLevel: '中风险',
            description: '预期年化约3.5%，有波动，可能小幅亏损'
        },
        {
            id: 'w_gold',
            name: '黄金理财',
            termDays: 90,
            annualRate: 0.05,
            volatility: 0.08,
            minAmount: 5000,
            riskIcon: '🟠',
            riskLevel: '中高风险',
            description: '预期年化约5.0%，跟随金价波动，可能亏损'
        },
        {
            id: 'w_stock',
            name: '股票基金',
            termDays: 180,
            annualRate: 0.08,
            volatility: 0.15,
            minAmount: 10000,
            riskIcon: '🔴',
            riskLevel: '高风险',
            description: '预期年化约8.0%，波动剧烈，可能大幅亏损本金'
        }
    ],

    // 贷款产品（单笔上限随信用额度走，creditRatio 为占总信用额度比例）
    // 期限对齐进货到货周期：90 / 180 / 270 天，避免「货未到就要还完」
    // 利率参考 1年期LPR 3.0% + 经营贷加点
    loanProducts: [
        {
            id: 'emergency',
            name: '应急贷款',
            minAmount: 500,
            maxAmount: 10000000000,
            creditRatio: 0.2,
            annualRate: 0.031,
            interestRate: 0.031 / 365, // 年化 3.10%
            minTerm: 90,
            maxTerm: 90,
            minLevel: 1,
            description: '90天期小额应急，年化3.10%，覆盖一次进货到货回款周期'
        },
        {
            id: 'working_capital',
            name: '经营周转贷',
            minAmount: 1000,
            maxAmount: 10000000000,
            creditRatio: 0.6,
            annualRate: 0.036,
            interestRate: 0.036 / 365, // 年化 3.60%
            minTerm: 180,
            maxTerm: 180,
            minLevel: 2,
            description: '180天经营周转，年化3.60%，适合多轮进货与回款'
        },
        {
            id: 'expansion',
            name: '扩大经营贷',
            minAmount: 10000,
            maxAmount: 10000000000,
            creditRatio: 1.0,
            annualRate: 0.0385,
            interestRate: 0.0385 / 365, // 年化 3.85%
            minTerm: 270,
            maxTerm: 270,
            minLevel: 3,
            description: '270天大额长期贷款，年化3.85%；可用满额信用额度'
        }
    ],

    // 信用额度规则：随店铺等级 + 累计销售流水提升，最高一百亿
    creditLimit: {
        baseLimit: 20000,
        // 等级阶梯额度（Lv1→Lv7）
        levelLimits: {
            1: 20000,
            2: 100000,
            3: 500000,
            4: 5000000,
            5: 50000000,
            6: 500000000,
            7: 5000000000
        },
        // 兼容旧字段：无 levelLimits 时的线性加成
        levelBonus: 5000,
        // 累计销售额（流水）加成比例
        turnoverRatio: 0.25,
        // 信誉点加成（每点）
        reputationBonus: 200,
        reputationMultiplier: 0.01, // 兼容旧字段
        maxLimit: 10000000000 // 一百亿
    },

    // 信用评级体系：由信用分（店铺等级 + 信誉 + 销售流水）映射到评级档位，
    // 影响贷款利率（rateDiscount 为负表示利率上浮）
    creditRatings: [
        { id: 'AAA', name: 'AAA 卓越', icon: '💎', minScore: 800, rateDiscount: 0.15, desc: '顶级信用，利率 -15%' },
        { id: 'AA',  name: 'AA 优质',  icon: '🥇', minScore: 650, rateDiscount: 0.10, desc: '优质信用，利率 -10%' },
        { id: 'A',   name: 'A 良好',   icon: '🥈', minScore: 500, rateDiscount: 0.05, desc: '良好信用，利率 -5%' },
        { id: 'B',   name: 'B 一般',   icon: '🥉', minScore: 350, rateDiscount: 0,    desc: '一般信用，标准利率' },
        { id: 'C',   name: 'C 谨慎',   icon: '⚠️', minScore: 200, rateDiscount: -0.05, desc: '信用偏弱，利率 +5%' },
        { id: 'D',   name: 'D 高风险', icon: '🚫', minScore: 0,   rateDiscount: -0.10, desc: '高风险，利率 +10%' }
    ],

    // 逾期规则
    overdue: {
        penaltyRate: 0.002,
        maxOverdueDays: 30,
        reputationPenalty: 5,
        reputationPenaltyInterval: 3
    },

    // 交易类型
    transactionTypes: {
        DEPOSIT: 'deposit',
        WITHDRAW: 'withdraw',
        FIXED_DEPOSIT: 'fixed_deposit',
        FIXED_WITHDRAW: 'fixed_withdraw',
        FIXED_INTEREST: 'fixed_interest',
        WEALTH_DEPOSIT: 'wealth_deposit',
        WEALTH_WITHDRAW: 'wealth_withdraw',
        LOAN_DISBURSE: 'loan_disburse',
        LOAN_REPAY: 'loan_repay',
        LOAN_OVERDUE: 'loan_overdue',
        INTEREST: 'interest'
    },

    // 交易类型中文映射
    transactionTypeNames: {
        deposit: '活期存入',
        withdraw: '活期支取',
        fixed_deposit: '定期存入',
        fixed_withdraw: '定期支取',
        fixed_interest: '定期利息',
        wealth_deposit: '理财申购',
        wealth_withdraw: '理财赎回',
        loan_disburse: '贷款发放',
        loan_repay: '贷款还款',
        loan_overdue: '逾期罚息',
        interest: '活期利息'
    },

    // 交易类型图标
    transactionTypeIcons: {
        deposit: '📥',
        withdraw: '📤',
        fixed_deposit: '🏦',
        fixed_withdraw: '💰',
        fixed_interest: '📈',
        wealth_deposit: '🧧',
        wealth_withdraw: '💹',
        loan_disburse: '💳',
        loan_repay: '💸',
        loan_overdue: '⚠️',
        interest: '📊'
    }
};
