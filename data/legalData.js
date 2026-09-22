// ============================================================================
// 法务/律师系统 - 数据配置层
// 包含：律师岗位配置、部门配置、案由库、诉讼状态枚举
// ============================================================================

// ==================== 律师岗位配置 ====================
const LEGAL_STAFF_CONFIG = {
    lawyer: {
        id: 'lawyer',
        name: '律师',
        icon: '⚖️',
        department: 'legal',
        description: '专业法务人才，擅长诉讼代理、合同审核与风险防控',
        skills: ['litigation', 'contract', 'risk_control'],
        primarySkill: 'litigation',
        specialtyBonus: {
            litigation: 1.6,
            contract: 1.5,
            risk_control: 1.4
        },
        baseSalary: 6800,
        efficiency: 1.0
    }
};

// ==================== 部门配置：新增法务部 ====================
const DEPARTMENT_CONFIG = {
    legal: {
        id: 'legal',
        name: '法务部',
        icon: '⚖️',
        color: '#7b1fa2'
    }
};

// ==================== 岗位→部门映射 ====================
const EMPLOYEE_TYPE_DEPT_MAP = {
    lawyer: 'legal'
};

// ==================== 7种上诉案由 ====================
const APPEAL_REASONS = [
    {
        id: 'malicious_refund',
        name: '恶意仅退款',
        description: '买家无正当理由申请仅退款，涉嫌不当得利',
        baseWinRate: 0.65,
        suggestedClaims: ['refund_recovery', 'compensation'],
        icon: '💰'
    },
    {
        id: 'return_fraud',
        name: '退货欺诈（调包/假货）',
        description: '买家退货时寄回非原商品或假货、空包',
        baseWinRate: 0.70,
        suggestedClaims: ['refund_recovery', 'triple_damages'],
        icon: '📦'
    },
    {
        id: 'defamation_review',
        name: '恶意差评/诽谤',
        description: '买家捏造事实发布恶意差评，损害店铺名誉',
        baseWinRate: 0.55,
        suggestedClaims: ['remove_review', 'apology', 'compensation'],
        icon: '⭐'
    },
    {
        id: 'breach_of_contract',
        name: '违反交易约定',
        description: '买家违反双方确认的交易条款或约定',
        baseWinRate: 0.60,
        suggestedClaims: ['refund_recovery', 'compensation'],
        icon: '📝'
    },
    {
        id: 'platform_arbitration_unfair',
        name: '平台仲裁不公',
        description: '平台仲裁结果存在明显偏袒或程序瑕疵',
        baseWinRate: 0.45,
        suggestedClaims: ['reverse_ruling', 'compensation'],
        icon: '⚖️'
    },
    {
        id: 'intellectual_property',
        name: '知识产权侵权',
        description: '买家盗用商品图片、描述或仿冒品牌反诉',
        baseWinRate: 0.75,
        suggestedClaims: ['triple_damages', 'injunction'],
        icon: '©️'
    },
    {
        id: 'goods_not_returned',
        name: '已退款未退货',
        description: '买家已收退款却不寄回商品，构成不当得利，应返还货款或货物',
        baseWinRate: 0.82,
        suggestedClaims: ['refund_recovery', 'compensation', 'return_goods'],
        icon: '📦',
        statuteIds: ['cc_985', 'cpl_25']
    },
    {
        id: 'courier_loss_unpaid',
        name: '快递丢件拒赔',
        description: '快件丢失后承运人拒赔或限额过低，依法应按实际损失赔偿',
        baseWinRate: 0.74,
        suggestedClaims: ['compensation', 'freight_loss'],
        icon: '🚚',
        statuteIds: ['cc_832', 'express_27', 'cpl_26']
    },
    {
        id: 'other_civil_dispute',
        name: '其他民事纠纷',
        description: '其他涉及合同、侵权等民事法律争议',
        baseWinRate: 0.50,
        suggestedClaims: ['compensation'],
        icon: '📋'
    }
];

/** 判决说理用的法条（简化摘录，供律师起诉与法院认定） */
const LEGAL_STATUTES = {
    cc_985: {
        id: 'cc_985',
        cite: '《中华人民共和国民法典》第985条',
        text: '得利人没有法律根据取得不当利益的，受损失的人可以请求得利人返还取得的利益。'
    },
    cc_157: {
        id: 'cc_157',
        cite: '《中华人民共和国民法典》第157条',
        text: '民事法律行为无效、被撤销或确定不发生效力后，行为人因该行为取得的财产，应当予以返还。'
    },
    cc_832: {
        id: 'cc_832',
        cite: '《中华人民共和国民法典》第832条',
        text: '承运人对运输过程中货物的毁损、灭失承担赔偿责任。但是，承运人证明货物的毁损、灭失是因不可抗力、货物本身的自然性质或者合理损耗以及托运人、收货人的过错造成的，不承担赔偿责任。'
    },
    express_27: {
        id: 'express_27',
        cite: '《快递暂行条例》第27条',
        text: '快件延误、丢失、损毁或者内件短少的，对保价的快件，应当按照约定的保价规则确定赔偿责任；对未保价的快件，依照民事法律的有关规定确定赔偿责任。'
    },
    cpl_25: {
        id: 'cpl_25',
        cite: '《中华人民共和国消费者权益保护法》第25条',
        text: '经营者采用网络等销售商品，消费者有权自收到商品之日起七日内退货，但商品应当完好。经营者应当自收到退回商品之日起七日内返还消费者支付的商品价款。'
    },
    cpl_26: {
        id: 'cpl_26',
        cite: '《中华人民共和国消费者权益保护法》第26条',
        text: '经营者不得以格式条款、通知、声明、店堂告示等方式，作出排除或者限制消费者权利、减轻或者免除经营者责任、加重消费者责任等对消费者不公平、不合理的规定。'
    }
};

// ==================== 诉讼状态枚举 ====================
const LITIGATION_STATUS = {
    submitted: 'submitted',
    accepted: 'accepted',
    review: 'review',
    mediation: 'mediation',
    settlement_pending: 'settlement_pending',
    scheduled: 'scheduled',
    buyer_win: 'buyer_win',
    merchant_win: 'merchant_win',
    partial_win: 'partial_win',
    compensation: 'compensation',
    closed: 'closed'
};

const LITIGATION_STATUS_LABEL = {
    submitted:          { name: '已提交',   color: '#1976d2', icon: '📮' },
    accepted:           { name: '已受理',   color: '#0288d1', icon: '📋' },
    review:             { name: '审核中',   color: '#7b1fa2', icon: '🔎' },
    mediation:          { name: '调解中',   color: '#00897b', icon: '🤝' },
    settlement_pending: { name: '和解待确认', color: '#00838f', icon: '✍️' },
    scheduled:          { name: '排期中',   color: '#f57c00', icon: '📅' },
    buyer_win:          { name: '买家胜诉', color: '#2e7d32', icon: '🏆' },
    merchant_win:       { name: '商家胜诉', color: '#c62828', icon: '🛡️' },
    partial_win:        { name: '部分胜诉', color: '#ef6c00', icon: '⚖️' },
    compensation:       { name: '赔偿中',   color: '#388e3c', icon: '💵' },
    closed:             { name: '已结案',   color: '#607d8b', icon: '✅' }
};

/** 维权策略：诉讼 / 调解 / 和解 */
const LEGAL_STRATEGY = {
    litigate: { id: 'litigate', name: '坚持诉讼', desc: '走完整开庭流程，回款弹性最大', icon: '⚔️' },
    mediate:  { id: 'mediate',  name: '申请调解', desc: '法院主持调解，成功率更高、回款略保守', icon: '🤝' },
    settle:   { id: 'settle',   name: '主动和解', desc: '快速结案，按谈判比例回款', icon: '🕊️' }
};

/** 阶梯式胜诉结果 → 经济索赔回款比例 */
const LEGAL_OUTCOME_TIERS = {
    full:     { id: 'full',     name: '全部支持',   recoveryMin: 0.90, recoveryMax: 1.00 },
    majority: { id: 'majority', name: '大部分支持', recoveryMin: 0.70, recoveryMax: 0.85 },
    half:     { id: 'half',     name: '半数支持',   recoveryMin: 0.45, recoveryMax: 0.55 },
    token:    { id: 'token',    name: '象征性支持', recoveryMin: 0.15, recoveryMax: 0.30 },
    lose:     { id: 'lose',     name: '驳回诉求',   recoveryMin: 0,    recoveryMax: 0 }
};

// ==================== 诉讼请求类型 ====================
const LITIGATION_CLAIM_TYPES = [
    { id: 'refund_recovery',  name: '追回已退款项',      icon: '💰' },
    { id: 'compensation',     name: '赔偿经济损失',      icon: '💴' },
    { id: 'return_goods',     name: '判令返还货物',      icon: '📦' },
    { id: 'freight_loss',     name: '赔偿运费损失',      icon: '🚚' },
    { id: 'triple_damages',   name: '退一赔三（欺诈）',  icon: '💎' },
    { id: 'reverse_ruling',   name: '撤销原仲裁裁决',    icon: '🔄' },
    { id: 'remove_review',    name: '删除恶意差评',      icon: '🗑️' },
    { id: 'apology',          name: '公开赔礼道歉',      icon: '📢' },
    { id: 'injunction',       name: '停止侵权行为',      icon: '🚫' }
];

// ==================== 法务流程基础配置 ====================
const LEGAL_PROCESS_CONFIG = {
    filingFee: 50,
    appealWindowHours: 72,
    reputationDeltaWin: 1,
    reputationDeltaLose: -1,
    /** 胜诉/和解回款后，律师按赔偿额抽成 */
    lawyerAppealCommissionRate: 0.05,
    statusTransitionHours: {
        submitted_to_accepted: [4, 12],
        accepted_to_review: [48, 96],
        review_to_scheduled: [24, 48],
        review_to_mediation: [24, 48],
        scheduled_to_judgment: [72, 168]
    },
    baseMerchantWinRate: 0.42,
    /** 经济索赔默认基数（律师/档位会再调整） */
    compensationBaseRatio: 0.55,
    /** 调解接受基础概率 */
    mediationAcceptBase: 0.55,
    /** 和解默认回款比例区间 */
    settlementRatioRange: [0.35, 0.65],
    /** 在职律师自动立案：已退款未退货 / 快递拒赔 */
    autoFile: {
        requireLawyer: true,
        goodsNotReturnedHours: 18,
        courierWaitHours: 12,
        courierRefuseChance: 0.34,
        maxAutoPerTick: 3
    }
};

// ==================== 商标注册与品牌保护 ====================
// 一次性注册，逐档升级；信誉加成立即生效，品牌溢价为描述性收益
const LEGAL_TRADEMARK_TIERS = [
    { id: 'basic',     name: '普通商标', icon: '™️', cost: 5000,   reputationBonus: 5,  desc: '基础品牌保护，信誉 +5' },
    { id: 'famous',    name: '著名商标', icon: '🏅', cost: 50000,  reputationBonus: 15, desc: '品牌溢价 +5%，信誉 +15' },
    { id: 'wellknown', name: '驰名商标', icon: '👑', cost: 200000, reputationBonus: 30, desc: '品牌溢价 +10%，信誉 +30' }
];
