/**
 * expressData.js - 快递合作系统数据层
 * ======================================
 * 包含：合作快递公司、服务类型、价格体系、物流状态、城市距离表、结算规则
 */

// 物流状态枚举（使用对象格式，避免与gameData.js中的数组LOGISTICS_STATUS冲突）
const EXPRESS_LOGISTICS_STATUS = {
    PENDING:    { code: 'pending',     name: '待揽收', color: '#ff9800', stage: 0 },
    COLLECTED:  { code: 'collected',   name: '已揽件', color: '#ff5722', stage: 1 },
    TRANSFER:   { code: 'transfer',    name: '转运中', color: '#ff9800', stage: 2 },
    TRANSIT:    { code: 'in_transit',  name: '运输中', color: '#9c27b0', stage: 3 },
    DELIVERING: { code: 'delivering',  name: '派送中', color: '#2196f3', stage: 4 },
    SIGNED:     { code: 'signed',      name: '已签收', color: '#4caf50', stage: 5 },
    EXCEPTION:  { code: 'exception',   name: '异常',  color: '#f44336', stage: -1 },
    LOST:       { code: 'lost',        name: '已丢失', color: '#b71c1c', stage: -2 },
    RETURNED:   { code: 'returned',    name: '已退回', color: '#795548', stage: -3 }
};
// 按code索引
const LOGISTICS_STATUS_MAP = {};
Object.values(EXPRESS_LOGISTICS_STATUS).forEach(s => { LOGISTICS_STATUS_MAP[s.code] = s; });

const ORDER_DELIVERY_STATUS = {
    UNSHIPPED: 'unshipped',    // 未发货（待打包/待发货）
    SHIPPED:   'shipped',      // 已发货（物流中）
    DELIVERED: 'delivered',    // 已送达（签收）
    RETURNED:  'returned'      // 已退回
};

// 合作快递公司定义
const EXPRESS_COMPANIES = [
    {
        id: 'sf',
        name: '顺丰速运',
        allowedModes: ['air', 'land'],   // 可选空运/陆运
        shortName: '顺丰',
        icon: '🚀',
        color: '#000000',
        bgColor: '#1a1a1a',
        tier: 'premium',
        description: '国内领先的快递物流服务商，时效快、服务好',
        defaultUnlocked: true,          // 默认合作
        serviceQuality: 95,             // 服务质量(0-100)
        complaintRate: 0.002,           // 投诉率
        lossRateBase: 0.0005,           // 基础丢件率
        damageRate: 0.001,              // 破损率
        coverageArea: '全国',
        maxWeight: 50,                  // 最大承接重量(kg)
        specialServices: ['保价', '代收货款', '签收回单', '夜间配送'],
        reputationReq: 0,               // 解锁所需店铺信誉
        minMonthlyVolume: 0             // 解锁所需月发件量
    },
    {
        id: 'jd',
        name: '京东物流',
        allowedModes: ['air', 'land'],   // 可选空运/陆运
        shortName: '京东',
        icon: '🐕',
        color: '#e4393c',
        bgColor: '#e4393c',
        tier: 'premium',
        description: '京东旗下物流，仓配一体化，次日达覆盖率高',
        defaultUnlocked: false,
        serviceQuality: 93,
        complaintRate: 0.003,
        lossRateBase: 0.0008,
        damageRate: 0.0015,
        coverageArea: '全国',
        maxWeight: 40,
        specialServices: ['211限时达', '京准达', '夜间配', '代扔垃圾'],
        reputationReq: 20,
        minMonthlyVolume: 10
    },
    {
        id: 'zt',
        name: '中通快递',
        allowedModes: ['land'],          // 仅陆运
        shortName: '中通',
        icon: '📦',
        color: '#1e88e5',
        bgColor: '#1e88e5',
        tier: 'standard',
        description: '业务量最大的快递公司之一，性价比高',
        defaultUnlocked: true,
        serviceQuality: 80,
        complaintRate: 0.008,
        lossRateBase: 0.002,
        damageRate: 0.004,
        coverageArea: '全国',
        maxWeight: 30,
        specialServices: ['代收货款', '签收回单'],
        reputationReq: 0,
        minMonthlyVolume: 0
    },
    {
        id: 'yt',
        name: '圆通速递',
        allowedModes: ['land'],          // 仅陆运
        shortName: '圆通',
        icon: '📮',
        color: '#d32f2f',
        bgColor: '#d32f2f',
        tier: 'standard',
        description: '老牌快递公司，网络覆盖广',
        defaultUnlocked: true,
        serviceQuality: 78,
        complaintRate: 0.01,
        lossRateBase: 0.0025,
        damageRate: 0.005,
        coverageArea: '全国',
        maxWeight: 30,
        specialServices: ['代收货款'],
        reputationReq: 0,
        minMonthlyVolume: 0
    },
    {
        id: 'yd',
        name: '韵达快递',
        allowedModes: ['land'],          // 仅陆运
        shortName: '韵达',
        icon: '📨',
        color: '#f57c00',
        bgColor: '#f57c00',
        tier: 'economy',
        description: '价格实惠，适合大件轻货',
        defaultUnlocked: true,
        serviceQuality: 75,
        complaintRate: 0.012,
        lossRateBase: 0.003,
        damageRate: 0.006,
        coverageArea: '全国（偏远地区除外）',
        maxWeight: 50,
        specialServices: [],
        reputationReq: 0,
        minMonthlyVolume: 0
    },
    {
        id: 'st',
        name: '申通快递',
        allowedModes: ['land'],          // 仅陆运
        shortName: '申通',
        icon: '✉️',
        color: '#7b1fa2',
        bgColor: '#7b1fa2',
        tier: 'economy',
        description: '价格低，时效稍慢',
        defaultUnlocked: true,
        serviceQuality: 73,
        complaintRate: 0.013,
        lossRateBase: 0.003,
        damageRate: 0.006,
        coverageArea: '全国（偏远地区除外）',
        maxWeight: 30,
        specialServices: [],
        reputationReq: 0,
        minMonthlyVolume: 0
    },
    {
        id: 'ems',
        name: 'EMS邮政',
        allowedModes: ['air', 'land'],   // 可选空运/陆运（含偏远地区）
        shortName: 'EMS',
        icon: '🏤',
        color: '#009688',
        bgColor: '#009688',
        tier: 'standard',
        description: '中国邮政特快专递，覆盖最广，含偏远地区',
        defaultUnlocked: false,
        serviceQuality: 82,
        complaintRate: 0.006,
        lossRateBase: 0.001,
        damageRate: 0.003,
        coverageArea: '全国含港澳台+偏远地区',
        maxWeight: 40,
        specialServices: ['国际件', '港澳台', '保价', '代收货款'],
        reputationReq: 30,
        minMonthlyVolume: 30
    },
    {
        id: 'db',
        name: '德邦快递',
        allowedModes: ['land'],          // 仅陆运（大件）
        shortName: '德邦',
        icon: '🚛',
        color: '#6a1b9a',
        bgColor: '#6a1b9a',
        tier: 'freight',
        description: '大件快递专家，适合重货大件',
        defaultUnlocked: false,
        serviceQuality: 80,
        complaintRate: 0.007,
        lossRateBase: 0.0015,
        damageRate: 0.003,
        coverageArea: '全国',
        maxWeight: 100,
        specialServices: ['大件上楼', '送货入户', '代收货款'],
        reputationReq: 25,
        minMonthlyVolume: 20
    },
    {
        id: 'jt',
        name: '极兔速递',
        allowedModes: ['land'],          // 仅陆运
        shortName: '极兔',
        icon: '🐰',
        color: '#e53935',
        bgColor: '#e53935',
        tier: 'economy',
        description: '新兴快递公司，价格极低，适合低客单价',
        defaultUnlocked: false,
        serviceQuality: 68,
        complaintRate: 0.018,
        lossRateBase: 0.004,
        damageRate: 0.008,
        coverageArea: '全国主要城市',
        maxWeight: 20,
        specialServices: [],
        reputationReq: 10,
        minMonthlyVolume: 5
    }
];

// 服务类型配置
// 运输方式：贵重/高价 → 空运；低价 → 陆运（影响运费与丢件率）
const AIR_SHIP_THRESHOLD = { unitPrice: 500, orderAmount: 2000 };
const SHIPPING_METHODS = {
    air: {
        id: 'air',
        name: '空运',
        icon: '✈️',
        feeMultiplier: 2.15,
        lossMultiplier: 0.35,
        speedMultiplier: 1.4,
        desc: '贵重/高价商品：运费明显高于陆运、丢件率更低、时效更快'
    },
    land: {
        id: 'land',
        name: '陆运',
        icon: '🚚',
        feeMultiplier: 0.88,
        lossMultiplier: 1.2,
        speedMultiplier: 1.0,
        desc: '普通快递默认陆运：运费更低、丢件率略高'
    }
};

function getShippingMethod(id) {
    return SHIPPING_METHODS[id] || SHIPPING_METHODS.land;
}

/** 快递公司可用的运输方式（未配置默认仅陆运） */
function getCompanyAllowedModes(companyId) {
    const c = getCompanyById(companyId);
    return (c && Array.isArray(c.allowedModes) && c.allowedModes.length) ? c.allowedModes : ['land'];
}

/** 该公司是否支持空运 */
function companyAllowsAir(companyId) {
    return getCompanyAllowedModes(companyId).indexOf('air') >= 0;
}

/** 按单件售价/订单金额自动判定运输方式（每次发货强制重算，忽略订单旧字段）；companyId 提供时受该公司 allowedModes 限制 */
function resolveShippingMethodForOrder(order, forceResolve, companyId) {
    if (!order) return 'land';
    // forceResolve 或未显式锁定时，按金额规则重算
    const locked = !forceResolve && order._shippingMethodLocked === true;
    let method = 'land';
    if (locked) {
        if (order.shipping_method === 'air' || order.shipping_method === 'land') method = order.shipping_method;
        else if (order.shippingMethod === 'air' || order.shippingMethod === 'land') method = order.shippingMethod;
    } else {
        const qty = Math.max(1, Number(order.quantity) || 1);
        const total = Number(order.totalAmount) || 0;
        const unit = Number(order.unitPrice) || (total > 0 ? total / qty : 0);
        const thr = AIR_SHIP_THRESHOLD;
        if (unit >= thr.unitPrice || total >= thr.orderAmount) method = 'air';
        else method = 'land';
    }
    // 公司限制：不支持的运输方式回退到该公司允许的首选方式
    if (companyId) {
        const allowed = getCompanyAllowedModes(companyId);
        if (allowed.indexOf(method) < 0) method = allowed[0] || 'land';
    }
    return method;
}

const SERVICE_TYPES = {
    STANDARD: {
        id: 'standard',
        name: '标准快递',
        desc: '常规时效，性价比之选',
        defaultSpeedTier: 1,    // 速度系数
        allowedTiers: ['standard', 'economy', 'premium', 'freight']
    },
    EXPRESS: {
        id: 'express',
        name: '加急快递',
        desc: '优先处理，更快送达',
        defaultSpeedTier: 1.5,
        priceMultiplier: 1.5,
        allowedTiers: ['standard', 'premium']
    },
    NEXT_DAY: {
        id: 'next_day',
        name: '次日达',
        desc: '次日送达，高效快捷',
        defaultSpeedTier: 2,
        priceMultiplier: 2,
        allowedTiers: ['premium']
    },
    SAME_DAY: {
        id: 'same_day',
        name: '当日达',
        desc: '同城当日送达',
        defaultSpeedTier: 3,
        priceMultiplier: 3,
        allowedTiers: ['premium']
    },
    FREIGHT: {
        id: 'freight',
        name: '大件快运',
        desc: '大件重货专用',
        defaultSpeedTier: 0.7,
        priceMultiplier: 0.8,
        weightThreshold: 10,    // 10kg以上推荐
        allowedTiers: ['freight', 'economy']
    }
};

// 合作等级与折扣
const COOPERATION_LEVELS = [
    { level: 1, name: '初步接触', minReputation: 0,   minVolume: 0,    priceDiscount: 1.00, bonusDesc: '原价' },
    { level: 2, name: '试合作期', minReputation: 10,  minVolume: 10,   priceDiscount: 0.97, bonusDesc: '97折' },
    { level: 3, name: '正式合作', minReputation: 25,  minVolume: 30,   priceDiscount: 0.93, bonusDesc: '93折+优先揽件' },
    { level: 4, name: '优质客户', minReputation: 45,  minVolume: 80,   priceDiscount: 0.88, bonusDesc: '88折+专属客服' },
    { level: 5, name: '战略伙伴', minReputation: 70,  minVolume: 200,  priceDiscount: 0.82, bonusDesc: '82折+账期结算' },
    { level: 6, name: 'VIP旗舰',  minReputation: 90,  minVolume: 500,  priceDiscount: 0.75, bonusDesc: '75折+专属客户经理' }
];

// 社交互动方式（好感度）
const FRIENDSHIP_ACTIONS = [
    { id: 'greet',   name: '打个招呼', icon: '👋', friendshipGain: 1,  cost: 0,   cooldownHours: 4,  desc: '和快递员打个招呼，混个脸熟' },
    { id: 'chat',    name: '闲聊几句', icon: '💬', friendshipGain: 3,  cost: 0,   cooldownHours: 8,  desc: '聊聊天气和交通，增进了解' },
    { id: 'water',   name: '送瓶水',   icon: '💧', friendshipGain: 6,  cost: 3,   cooldownHours: 12, desc: '天热买瓶水，人情小投入' },
    { id: 'smoke',   name: '递根烟',   icon: '🚬', friendshipGain: 8,  cost: 5,   cooldownHours: 16, desc: '快速拉近距离（不鼓励，但有效）' },
    { id: 'snack',   name: '递零食',   icon: '🍪', friendshipGain: 10, cost: 8,   cooldownHours: 20, desc: '准备点小零食，跑快递的都辛苦' },
    { id: 'meal',    name: '请吃饭',   icon: '🍱', friendshipGain: 20, cost: 35,  cooldownHours: 48, desc: '请吃顿便饭，建立真正的关系' },
    { id: 'gift',    name: '节日送礼', icon: '🎁', friendshipGain: 35, cost: 100, cooldownHours: 168,desc: '节日送份礼，长期投资' },
    { id: 'hongbao', name: '发红包',   icon: '🧧', friendshipGain: 50, cost: 200, cooldownHours: 336,desc: '过年发红包，感情迅速升温' }
];

// 好感度等级
const FRIENDSHIP_LEVELS = [
    { level: 1, name: '陌生人', minFriendship: 0,   pickupBonus: 0,    speedBonus: 0,    desc: '互不认识，正常服务' },
    { level: 2, name: '熟面孔', minFriendship: 15,  pickupBonus: 0.05, speedBonus: 0.05, desc: '认识你了，稍微优先' },
    { level: 3, name: '老熟人', minFriendship: 35,  pickupBonus: 0.10, speedBonus: 0.10, desc: '关系不错，会优先揽件' },
    { level: 4, name: '称兄道弟', minFriendship: 60, pickupBonus: 0.18, speedBonus: 0.15, desc: '铁哥们，随叫随到' },
    { level: 5, name: '过命交情', minFriendship: 85, pickupBonus: 0.30, speedBonus: 0.25, desc: '过命交情，极致服务' }
];

// 结算周期：统一每月1号月结（保留现结可选）
const SETTLEMENT_CYCLES = [
    { id:'monthly', name:'月结（每月1号）', minLevel:0, discountFactor:0.95, description:'每月1号结算上月运单，95折（全平台默认）' },
    { id:'per_order', name:'现结（每单扣款）', minLevel:0, discountFactor:1.00, description:'发货即时扣款，无账期折扣' },
    { id:'weekly', name:'周结（已停用→改月结）', minLevel:0, discountFactor:0.95, description:'兼容旧档：自动按月结处理' },
    { id:'biweekly', name:'半月结（已停用→改月结）', minLevel:0, discountFactor:0.95, description:'兼容旧档：自动按月结处理' },
    { id:'quarterly', name:'季结（已停用→改月结）', minLevel:0, discountFactor:0.95, description:'兼容旧档：自动按月结处理' }
];
const DEFAULT_SETTLEMENT_CYCLE = 'monthly';

// 对账状态
const RECONCILIATION_STATUS = {
    PENDING:  { code: 'pending',  name: '待确认', color: '#ff9800' },
    CONFIRMED:{ code: 'confirmed',name: '已确认', color: '#2196f3' },
    PAID:     { code: 'paid',     name: '已付款', color: '#4caf50' },
    DISPUTED: { code: 'disputed', name: '有争议', color: '#f44336' },
    OVERDUE:  { code: 'overdue',  name: '已逾期', color: '#b71c1c' }
};

// 基础价格表（首重/续重，单位：元）
// 按公司×区域×服务类型定义基础价格
const BASE_PRICING = {
    // 顺丰：价格高，服务好
    sf: {
        standard: { firstWeight: 12, addWeight: 5, firstWeightKg: 1 },
        express:  { firstWeight: 18, addWeight: 8, firstWeightKg: 1 },
        next_day: { firstWeight: 22, addWeight: 10, firstWeightKg: 1 },
        same_day: { firstWeight: 30, addWeight: 12, firstWeightKg: 1 }
    },
    // 京东
    jd: {
        standard: { firstWeight: 10, addWeight: 4, firstWeightKg: 1 },
        express:  { firstWeight: 15, addWeight: 6, firstWeightKg: 1 },
        next_day: { firstWeight: 20, addWeight: 8, firstWeightKg: 1 },
        same_day: { firstWeight: 25, addWeight: 10, firstWeightKg: 1 }
    },
    // 中通
    zt: {
        standard: { firstWeight: 7,  addWeight: 2, firstWeightKg: 1 },
        express:  { firstWeight: 11, addWeight: 4, firstWeightKg: 1 },
        freight:  { firstWeight: 5,  addWeight: 1.2, firstWeightKg: 3 }
    },
    // 圆通
    yt: {
        standard: { firstWeight: 6.5, addWeight: 2, firstWeightKg: 1 },
        express:  { firstWeight: 10, addWeight: 3.5, firstWeightKg: 1 },
        freight:  { firstWeight: 5,  addWeight: 1, firstWeightKg: 3 }
    },
    // 韵达
    yd: {
        standard: { firstWeight: 5.5, addWeight: 1.5, firstWeightKg: 1 },
        freight:  { firstWeight: 4,  addWeight: 0.8, firstWeightKg: 3 }
    },
    // 申通
    st: {
        standard: { firstWeight: 5.5, addWeight: 1.5, firstWeightKg: 1 },
        freight:  { firstWeight: 4,  addWeight: 0.8, firstWeightKg: 3 }
    },
    // EMS
    ems: {
        standard: { firstWeight: 9, addWeight: 3, firstWeightKg: 1 },
        express:  { firstWeight: 14, addWeight: 5, firstWeightKg: 1 }
    },
    // 德邦
    db: {
        standard: { firstWeight: 8, addWeight: 2, firstWeightKg: 1 },
        freight:  { firstWeight: 3, addWeight: 0.6, firstWeightKg: 5 }
    },
    // 极兔
    jt: {
        standard: { firstWeight: 4.5, addWeight: 1, firstWeightKg: 1 }
    }
};

// 距离加价系数（基于城市距离km）
const DISTANCE_MULTIPLIERS = [
    { maxKm: 200,   multiplier: 1.0,  name: '同城/邻省' },
    { maxKm: 500,   multiplier: 1.1,  name: '跨省内/邻省' },
    { maxKm: 1000,  multiplier: 1.25, name: '跨2-3省' },
    { maxKm: 1500,  multiplier: 1.4,  name: '大半个中国' },
        { maxKm: 2500,  multiplier: 1.6,  name: '南北跨度' },
        { maxKm: 5000,  multiplier: 2.2,  name: '跨境' },
        { maxKm: 99999, multiplier: 3.0,  name: '洲际原产地' }
];

// 物流事件节点（用于生成物流轨迹）
const LOGISTICS_EVENTS = {
    pending: [
        '商家已发货，等待快递公司揽件'
    ],
    collected: [
        '快件已被{courier}揽收，揽收人：{courierMan}',
        '快件已到达{city}营业点'
    ],
    transfer: [
        '快件已从{fromCity}发出，下一站：{toCity}',
        '快件已到达{city}转运中心',
        '快件已离开{city}转运中心'
    ],
    in_transit: [
        '快件正在运输中，已到达{city}',
        '快件已到达{city}分拨中心'
    ],
    delivering: [
        '快件已到达{city}网点，正在安排派送',
        '快递员{courierMan}正在为您派送（电话：{phone}）'
    ],
    signed: [
        '快件已被签收，签收人：{signer}',
        '快件已送达{location}，已签收'
    ],
    exception: [
        '快件出现异常：{reason}',
        '因{reason}，快件暂时无法派送'
    ]
};

// 包装推荐
const PACKAGING_OPTIONS = [
    { id: 'bag',      name: '快递袋',    cost: 0.3, suitableCategories: ['clothing','daily'], maxWeight: 3 },
    { id: 'box_s',    name: '小号纸箱',  cost: 0.8, suitableCategories: ['digital','beauty','daily'], maxWeight: 2 },
    { id: 'box_m',    name: '中号纸箱',  cost: 1.5, suitableCategories: ['daily','food','home'], maxWeight: 5 },
    { id: 'box_l',    name: '大号纸箱',  cost: 2.5, suitableCategories: ['home','outdoor'], maxWeight: 15 },
    { id: 'bubble',   name: '气泡膜',    cost: 0.5, suitableCategories: ['digital','beauty'], maxWeight: 10 },
    { id: 'fragile',  name: '木架加固',  cost: 5.0, suitableCategories: ['digital','home'], maxWeight: 30, note: '易碎品专用' }
];

// 城市距离缓存（简化版，使用seeded随机生成确定性距离）
function getCityDistance(fromCityId, toCityId) {
    if (fromCityId === toCityId) return 30; // 同城30km
    const key = [fromCityId, toCityId].sort().join('|');
    const hash = simpleHash(key);
    const baseDistances = [80, 150, 280, 420, 600, 850, 1100, 1400, 1800, 2200, 2600, 3200];
    return baseDistances[hash % baseDistances.length] + (hash % 50);
}

function simpleHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
}

function getCompanyById(id) {
    return EXPRESS_COMPANIES.find(c => c.id === id) || null;
}

function getServiceType(id) {
    return Object.values(SERVICE_TYPES).find(s => s.id === id) || SERVICE_TYPES.STANDARD;
}

function getCooperationLevel(companyState) {
    if (!companyState) return COOPERATION_LEVELS[0];
    const reputation = companyState.cooperationPoints || 0;
    const volume = companyState.totalShipments || 0;
    let current = COOPERATION_LEVELS[0];
    for (const lvl of COOPERATION_LEVELS) {
        if (reputation >= lvl.minReputation && volume >= lvl.minVolume) {
            current = lvl;
        }
    }
    return current;
}

function getFriendshipLevel(friendship) {
    let current = FRIENDSHIP_LEVELS[0];
    for (const lvl of FRIENDSHIP_LEVELS) {
        if (friendship >= lvl.minFriendship) current = lvl;
    }
    return current;
}

function getLogisticsStatus(code) {
    return LOGISTICS_STATUS_MAP[code] || EXPRESS_LOGISTICS_STATUS.PENDING;
}

function getReconciliationStatus(code) {
    return Object.values(RECONCILIATION_STATUS).find(s => s.code === code) || RECONCILIATION_STATUS.PENDING;
}

// 导出到全局
if (typeof window !== 'undefined') {
    window.EXPRESS_LOGISTICS_STATUS = EXPRESS_LOGISTICS_STATUS;
    window.LOGISTICS_STATUS_MAP = LOGISTICS_STATUS_MAP;
    window.ORDER_DELIVERY_STATUS = ORDER_DELIVERY_STATUS;
    window.EXPRESS_COMPANIES = EXPRESS_COMPANIES;
    window.SERVICE_TYPES = SERVICE_TYPES;
    window.SHIPPING_METHODS = SHIPPING_METHODS;
    window.AIR_SHIP_THRESHOLD = AIR_SHIP_THRESHOLD;
    window.getShippingMethod = getShippingMethod;
    window.resolveShippingMethodForOrder = resolveShippingMethodForOrder;
    window.COOPERATION_LEVELS = COOPERATION_LEVELS;
    window.FRIENDSHIP_ACTIONS = FRIENDSHIP_ACTIONS;
    window.FRIENDSHIP_LEVELS = FRIENDSHIP_LEVELS;
    window.SETTLEMENT_CYCLES = SETTLEMENT_CYCLES;
    window.DEFAULT_SETTLEMENT_CYCLE = DEFAULT_SETTLEMENT_CYCLE;
    window.RECONCILIATION_STATUS = RECONCILIATION_STATUS;
    window.BASE_PRICING = BASE_PRICING;
    window.DISTANCE_MULTIPLIERS = DISTANCE_MULTIPLIERS;
    window.LOGISTICS_EVENTS = LOGISTICS_EVENTS;
    window.PACKAGING_OPTIONS = PACKAGING_OPTIONS;
    window.getCityDistance = getCityDistance;
    window.getCompanyById = getCompanyById;
    window.getServiceType = getServiceType;
    window.getCooperationLevel = getCooperationLevel;
    window.getFriendshipLevel = getFriendshipLevel;
    window.getLogisticsStatus = getLogisticsStatus;
    window.getReconciliationStatus = getReconciliationStatus;
    // 命名空间导出，方便通过ExpressData.xxx访问
    window.ExpressData = {
        LOGISTICS_STATUS: EXPRESS_LOGISTICS_STATUS,
        LOGISTICS_STATUS_MAP,
        COMPANIES: EXPRESS_COMPANIES,
        getCompany: getCompanyById,
        getService: getServiceType,
        getCompanyById,
        getServiceType,
        getCooperationLevel,
        getFriendshipLevel,
        getLogisticsStatus
    };
}
