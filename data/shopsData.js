/**
 * shopsData.js — 多店铺系统（阶段A：地基）
 * 店铺类型配置：线上店 / 零售店 / 外卖店
 * 数据层只做配置常量，不依赖运行时。
 */

// 店铺类型配置
const SHOP_TYPES = {
    online: {
        id: 'online',
        name: '线上店铺',
        icon: '🌐',
        desc: '电商平台店：覆盖广、竞争激烈，靠评分和曝光',
        rentBase: 1500,        // 基础月租
        openCost: 50000,       // 开店一次性费用
        capacity: 2000,        // 店铺库存容量
        baseTraffic: 400,      // 基础流量
        costColor: '#4facfe',
        channelFit: { online: 1.0, retail: 0.7, delivery: 0.6 },
        unlockLevel: 1,
        focus: 'online'
    },
    retail: {
        id: 'retail',
        name: '线下零售店',
        icon: '🏬',
        desc: '临街/商场/社区店：到店体验、试穿连带、会员复购，租金和店员是主要成本',
        rentBase: 5000,
        openCost: 150000,
        capacity: 3000,
        baseTraffic: 800,
        costColor: '#f5576c',
        channelFit: { online: 0.9, retail: 1.0, delivery: 0.5 },
        unlockLevel: 1,
        focus: 'offline'
    },
    delivery: {
        id: 'delivery',
        name: '外卖店铺',
        icon: '🛵',
        desc: '档口/前置仓：接美团饿了么单，拼评分、出餐和配送半径，平台抽成+骑手费',
        rentBase: 800,
        openCost: 30000,
        capacity: 1200,
        baseTraffic: 600,
        costColor: '#43e97b',
        channelFit: { online: 0.8, retail: 0.5, delivery: 1.0 },
        unlockLevel: 1,
        focus: 'offline'
    },
    pinduoduo: {
        id: 'pinduoduo',
        name: '拼多多店铺',
        icon: '🅿️',
        desc: '下沉市场店：流量大客单低、价格敏感，拼团走量、抽成极低',
        rentBase: 1200,
        openCost: 120000,
        capacity: 2500,
        baseTraffic: 1000,
        costColor: '#e02e24',
        channelFit: { pinduoduo: 1.0 },
        unlockLevel: 3,
        focus: 'online'
    },
    douyin: {
        id: 'douyin',
        name: '抖音小店',
        icon: '🎵',
        desc: '内容电商店：直播/短视频带流量，开播日客流暴涨，达人佣金较高',
        rentBase: 1000,
        openCost: 200000,
        capacity: 1500,
        baseTraffic: 700,
        costColor: '#111111',
        channelFit: { douyin: 1.0 },
        unlockLevel: 4,
        focus: 'online'
    }
};

/** 线下零售选址（影响租金、客流、客单） */
const RETAIL_VENUES = [
    { id: 'street', name: '临街铺', icon: '🛣️', rentMul: 1.0, trafficMul: 1.0, ticketMul: 1.0, desc: '路过客多，租金适中' },
    { id: 'community', name: '社区店', icon: '🏘️', rentMul: 0.7, trafficMul: 0.75, ticketMul: 0.9, desc: '租金低、复购稳、客流一般' },
    { id: 'mall', name: '商场专柜', icon: '🛍️', rentMul: 1.8, trafficMul: 1.45, ticketMul: 1.25, desc: '客流旺、客单高，租金贵' },
    { id: 'supermarket', name: '商超专区', icon: '🛒', rentMul: 1.3, trafficMul: 1.2, ticketMul: 0.95, desc: '日用品走量，连带强' }
];
const RETAIL_VENUE_BY_ID = {};
RETAIL_VENUES.forEach(v => { RETAIL_VENUE_BY_ID[v.id] = v; });

/** 外卖平台入驻 */
const DELIVERY_PLATFORMS = [
    { id: 'meituan', name: '美团外卖', icon: '🟡', commission: 0.18, trafficMul: 1.25, desc: '流量最大，抽成约18%' },
    { id: 'eleme', name: '饿了么', icon: '🔵', commission: 0.16, trafficMul: 1.10, desc: '抽成略低，流量次之' },
    { id: 'jdms', name: '京东秒送', icon: '🔴', commission: 0.14, trafficMul: 0.85, desc: '即时零售，客单偏高' },
    { id: 'self', name: '仅自配送', icon: '📦', commission: 0.00, trafficMul: 0.45, desc: '无平台抽成，靠熟客' }
];
const DELIVERY_PLATFORM_BY_ID = {};
DELIVERY_PLATFORMS.forEach(p => { DELIVERY_PLATFORM_BY_ID[p.id] = p; });

// 商品-渠道适配系数（行=商品大类，列=店铺类型）。商品未命中用该表的 default 或 1
const SHOP_CHANNEL_FIT = {
    // category 关键字 → { online, retail, delivery, pinduoduo, douyin }
    clothing:   { online: 0.9, retail: 1.3, delivery: 0.2, pinduoduo: 1.0, douyin: 1.3 }, // 服装(直播展示强)
    digital:    { online: 1.1, retail: 1.2, delivery: 0.3, pinduoduo: 0.8, douyin: 1.2 }, // 数码
    food:       { online: 0.7, retail: 0.8, delivery: 1.4, pinduoduo: 1.2, douyin: 0.9 }, // 食品(下沉走量)
    daily:      { online: 0.9, retail: 0.7, delivery: 1.2, pinduoduo: 1.4, douyin: 1.0 }, // 日用品(拼团爆款)
    beauty:     { online: 1.0, retail: 1.1, delivery: 0.5, pinduoduo: 0.9, douyin: 1.4 }, // 美妆(种草转化)
    home:       { online: 1.0, retail: 1.0, delivery: 0.4, pinduoduo: 1.1, douyin: 1.0 }, // 家居
    outdoor:    { online: 1.1, retail: 0.9, delivery: 0.3, pinduoduo: 1.0, douyin: 1.1 }, // 户外
    default:    { online: 1.0, retail: 1.0, delivery: 0.8, pinduoduo: 1.0, douyin: 1.0 }
};

// 调拨规则（阶段B会用，先定义常量）
const SHOP_TRANSFER_RULES = {
    sameCityHours: [2, 4],      // 同城运输时间区间（小时）
    crossRegionHours: [8, 24],  // 跨区域
    costPerKg: 2                // 每公斤运输成本（元）
};

// ===== 阶段D：渠道店成本参数（可调平衡） =====
const SHOP_COST_PARAMS = {
    // 线上店平台抽成率（随店铺等级微降，Lv1=10% → Lv10=6%）
    onlinePlatformRate: (lv) => Math.max(0.06, 0.10 - (lv - 1) * 0.004),
    // 外卖店每单配送成本（元/单，随等级优化配送降低）
    deliveryFeePerOrder: (lv) => Math.max(1.5, 3 - (lv - 1) * 0.15),
    // 零售店租金日摊 = 月租/30（rent 字段为月租）
    rentDailyShare: 30,
    // 抖音小店达人佣金(按收入抽,随店铺等级微降 20% → 16%)
    douyinCommission: (lv) => Math.max(0.16, 0.20 - (lv - 1) * 0.005),
    // 拼多多平台抽成(极低,百亿补贴扶持)
    pddPlatformRate: (lv) => Math.max(0.004, 0.006 - (lv - 1) * 0.0002)
};

// 平台价格弹性(需求对售价的敏感度,值越大越要低价走量)
const SHOP_ELASTICITY = {
    online: 1.5, retail: 1.2, delivery: 1.3, pinduoduo: 1.8, douyin: 1.2
};

// 商品渠道标签（阶段D：驱动选品，UI 展示）
// category → { tag, desc }
const SHOP_CHANNEL_TAGS = {
    clothing: { tag: '线下体验', desc: '适合零售店试穿' },
    digital:  { tag: '线上热销', desc: '适合线上店爆量' },
    food:     { tag: '即时需求', desc: '适合外卖店急送' },
    daily:    { tag: '高频复购', desc: '各渠道均衡' },
    beauty:   { tag: '线上热销', desc: '适合线上店' },
    home:     { tag: '线下体验', desc: '适合零售店' },
    outdoor:  { tag: '线上热销', desc: '适合线上店' }
};

// 城市→区域归属（用于调拨距离判断，阶段B用；先给常用城市示例）
const SHOP_CITY_REGIONS = {
    '杭州': '华东', '上海': '华东', '南京': '华东', '苏州': '华东', '宁波': '华东',
    '北京': '华北', '天津': '华北', '青岛': '华北', '济南': '华北',
    '广州': '华南', '深圳': '华南', '厦门': '华南', '福州': '华南',
    '成都': '西南', '重庆': '西南', '昆明': '西南',
    '武汉': '华中', '长沙': '华中', '郑州': '华中',
    '西安': '西北', '兰州': '西北',
    '沈阳': '东北', '大连': '东北', '哈尔滨': '东北'
};

// ===== 店铺装修体系（阶段E）：装修档次影响客流与信誉 =====
// trafficBonus 为客流倍率，reputationBonus 为装修后一次性信誉提升
const SHOP_DECOR_STYLES = [
    { id: 'none',   name: '简陋装修', icon: '🧱', cost: 0,      trafficBonus: 1.0,  reputationBonus: 0,  desc: '基础店面，无额外加成' },
    { id: 'simple', name: '简约装修', icon: '🪑', cost: 10000,  trafficBonus: 1.10, reputationBonus: 3,  desc: '清爽简约，客流 +10%' },
    { id: 'quality',name: '品质装修', icon: '🛋️', cost: 50000,  trafficBonus: 1.25, reputationBonus: 8,  desc: '品质感强，客流 +25%' },
    { id: 'luxury', name: '豪华装修', icon: '👑', cost: 200000, trafficBonus: 1.50, reputationBonus: 15, desc: '高端奢华，客流 +50%' },
    { id: 'themed', name: '主题装修', icon: '🎪', cost: 300000, trafficBonus: 1.70, reputationBonus: 20, desc: '网红打卡风，客流 +70%' }
];
const SHOP_DECOR_BY_ID = {};
SHOP_DECOR_STYLES.forEach(s => { SHOP_DECOR_BY_ID[s.id] = s; });

// ==================== 导出兼容（浏览器全局 + Node 测试） ====================
if (typeof window !== 'undefined') {
    window.SHOP_TYPES = SHOP_TYPES;
    window.SHOP_CHANNEL_FIT = SHOP_CHANNEL_FIT;
    window.SHOP_TRANSFER_RULES = SHOP_TRANSFER_RULES;
    window.SHOP_CITY_REGIONS = SHOP_CITY_REGIONS;
    window.SHOP_COST_PARAMS = SHOP_COST_PARAMS;
    window.SHOP_CHANNEL_TAGS = SHOP_CHANNEL_TAGS;
    window.SHOP_ELASTICITY = SHOP_ELASTICITY;
    window.SHOP_DECOR_STYLES = SHOP_DECOR_STYLES;
    window.SHOP_DECOR_BY_ID = SHOP_DECOR_BY_ID;
    window.RETAIL_VENUES = RETAIL_VENUES;
    window.RETAIL_VENUE_BY_ID = RETAIL_VENUE_BY_ID;
    window.DELIVERY_PLATFORMS = DELIVERY_PLATFORMS;
    window.DELIVERY_PLATFORM_BY_ID = DELIVERY_PLATFORM_BY_ID;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SHOP_TYPES, SHOP_CHANNEL_FIT, SHOP_TRANSFER_RULES, SHOP_CITY_REGIONS, SHOP_COST_PARAMS, SHOP_CHANNEL_TAGS, SHOP_ELASTICITY, SHOP_DECOR_STYLES, SHOP_DECOR_BY_ID, RETAIL_VENUES, RETAIL_VENUE_BY_ID, DELIVERY_PLATFORMS, DELIVERY_PLATFORM_BY_ID };
}
