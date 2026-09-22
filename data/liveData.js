// ============================================================================
// 直播中心系统 - 数据定义层
// 包含：主播类型、礼物配置、弹幕类型、直播间配置等静态数据
// ============================================================================

// 主播类型配置（直播系统专用，避免与旧版STREAMER_TYPES冲突）
const LIVE_STREAMER_TYPES = [
    {
        id: 'self',
        name: '店主亲自直播',
        icon: '👨‍💼',
        cost: 0,
        baseFans: 0,
        trafficBonus: 1.0,
        conversionBonus: 1.0,
        giftRate: 0.02,
        description: '自己动手，丰衣足食',
        unlockLevel: 1,
        costPerHour: 0,
        riskLevel: 0
    },
    {
        id: 'newbie',
        name: '新人主播',
        icon: '👩‍🎤',
        cost: 500,
        baseFans: 500,
        trafficBonus: 1.2,
        conversionBonus: 1.1,
        giftRate: 0.03,
        description: '刚入行的新人主播，价格实惠',
        unlockLevel: 2,
        costPerHour: 125,
        riskLevel: 0.02
    },
    {
        id: 'professional',
        name: '专业主播',
        icon: '🎤',
        cost: 2000,
        baseFans: 3000,
        trafficBonus: 1.5,
        conversionBonus: 1.3,
        giftRate: 0.05,
        description: '经验丰富的带货主播',
        unlockLevel: 5,
        costPerHour: 500,
        riskLevel: 0.03
    },
    {
        id: 'celebrity',
        name: '网红主播',
        icon: '⭐',
        cost: 8000,
        baseFans: 20000,
        trafficBonus: 2.0,
        conversionBonus: 1.6,
        giftRate: 0.08,
        description: '自带流量的人气主播',
        unlockLevel: 6,
        costPerHour: 2000,
        riskLevel: 0.05
    },
    {
        id: 'top',
        name: '头部主播',
        icon: '👑',
        cost: 30000,
        baseFans: 100000,
        trafficBonus: 3.0,
        conversionBonus: 2.0,
        giftRate: 0.12,
        description: '顶级带货王，销量保证',
        unlockLevel: 7,
        costPerHour: 7500,
        riskLevel: 0.08
    }
];

// 礼物配置
const LIVE_GIFTS = [
    { id: 'heart', name: '小心心', icon: '❤️', price: 1, effect: 'float', fanValue: 1 },
    { id: 'flower', name: '鲜花', icon: '🌸', price: 10, effect: 'burst', fanValue: 10 },
    { id: 'rocket', name: '小火箭', icon: '🚀', price: 100, effect: 'rocket', fanValue: 100 },
    { id: 'crown', name: '皇冠', icon: '👑', price: 500, effect: 'crown', fanValue: 500 },
    { id: 'castle', name: '豪华城堡', icon: '🏰', price: 2000, effect: 'castle', fanValue: 2000 },
    { id: 'dragon', name: '龙腾四海', icon: '🐉', price: 10000, effect: 'dragon', fanValue: 10000 }
];

// 弹幕类型
const DANMAKU_TYPES = {
    normal: { color: '#ffffff', name: '普通弹幕' },
    vip: { color: '#ffd700', name: 'VIP弹幕' },
    fan: { color: '#ff69b4', name: '粉丝弹幕' },
    gift: { color: '#00ff00', name: '礼物弹幕' },
    system: { color: '#ffff00', name: '系统消息' }
};

// 直播间状态
const LIVE_STATUS = {
    idle: 'idle',
    preparing: 'preparing',
    live: 'live',
    paused: 'paused',
    ended: 'ended'
};

// 直播场景模板
const LIVE_SCENES = [
    { id: 'product_show', name: '商品展示', icon: '🛍️', desc: '重点展示商品细节', conversionBonus: 1.1 },
    { id: 'flash_sale', name: '限时秒杀', icon: '⚡', desc: '营造紧张抢购氛围', conversionBonus: 1.3, pricePenalty: 0.8 },
    { id: 'qa', name: '答疑互动', icon: '💬', desc: '解答观众疑问', trustBonus: 1.2 },
    { id: 'new_product', name: '新品发布', icon: '🆕', desc: '首发新品优惠', trafficBonus: 1.2 },
    { id: 'festival', name: '节日大促', icon: '🎉', desc: '节日专属活动', trafficBonus: 1.4, conversionBonus: 1.2 }
];

// 模拟观众昵称库
const MOCK_VIEWER_NAMES = [
    '快乐购物家', '剁手小仙女', '省钱小能手', '品质生活家', '时尚达人',
    '数码爱好者', '美食探店', '居家小能手', '美妆博主', '运动达人',
    '母婴好物', '数码测评', '穿搭博主', '家居改造', '零食控',
    '咖啡爱好者', '旅行家', '书虫一枚', '健身达人', '萌宠铲屎官',
    '追剧少女', '吃货本货', '懒人必备', '精致女孩', '佛系买家',
    '宝妈一枚', '学生党', '职场新人', '退休阿姨', '老顾客了'
];

// 模拟弹幕内容库
const MOCK_DANMAKU_CONTENT = [
    '这个多少钱？', '有优惠吗？', '主播说得好！', '买过了，质量不错',
    '已经下单了', '什么时候发货？', '能便宜点吗？', '有运费险吗？',
    '支持7天无理由吗？', '这个颜色好看', '尺码标准吗？', '质量怎么样？',
    '是正品吗？', '什么时候补货？', '可以组合买吗？', '有赠品吗？',
    '这个我要了！', '已拍，坐等收货', '主播好专业', '讲得很详细',
    '回购好几次了', '老粉报道', '新来的，关注了', '直播间专属价吗？',
    '还有库存吗？', '太划算了吧！', '买买买！', '冲冲冲！',
    '主播推荐的确实好用', '讲解很清楚', '链接在哪里？', '小黄车几号？',
    '这个适合送人吗？', '保质期多久？', '可以开发票吗？', '包邮吗？'
];

// 直播成就
const LIVE_ACHIEVEMENTS = [
    { id: 'first_live', name: '初次直播', icon: '🎬', desc: '完成第一次直播', reward: { funds: 500 } },
    { id: 'hundred_viewers', name: '百人观众', icon: '👥', desc: '单场观众达到100人', reward: { funds: 1000 } },
    { id: 'thousand_viewers', name: '千人直播间', icon: '🔥', desc: '单场观众达到1000人', reward: { funds: 5000 } },
    { id: 'first_gift', name: '第一份礼物', icon: '🎁', desc: '收到第一份观众礼物', reward: { funds: 200 } },
    { id: 'gift_king', name: '礼物收割机', icon: '👑', desc: '单场礼物收入达到1000元', reward: { funds: 2000 } },
    { id: 'sales_master', name: '带货达人', icon: '💰', desc: '单场销售额达到10000元', reward: { funds: 3000 } },
    { id: 'long_stream', name: '耐力主播', icon: '⏱️', desc: '单场直播时长达到8小时', reward: { funds: 800 } },
    { id: 'ten_streams', name: '十场直播', icon: '📺', desc: '累计完成10场直播', reward: { funds: 2000 } },
    // P3：粉丝向成就
    { id: 'hundred_fans', name: '百粉起步', icon: '👥', desc: '累计粉丝达到100人', reward: { funds: 1000 } },
    { id: 'thousand_fans', name: '千人粉丝团', icon: '👨‍👩‍👧‍👦', desc: '累计粉丝达到1000人', reward: { funds: 5000 } },
    { id: 'first_loyal', name: '初拥铁粉', icon: '💛', desc: '拥有第一位铁粉', reward: { funds: 800 } },
    { id: 'first_true', name: '真爱降临', icon: '💜', desc: '拥有第一位真爱粉', reward: { funds: 2000 } }
];

// ==================== 直播IP养成：全局数值配置（P0，调参只改这里）====================
const LIVE_CONFIG = {
    // 每日手动直播次数
    dailyLimit: 1,
    // 单场时长档位（现实分钟）与默认值
    durations: [3, 6, 10],
    defaultDuration: 6,
    // 热度
    initialHeat: 30,
    maxHeat: 100,
    heatDecayPer15s: 2,          // 每 15 秒衰减
    tapHeatGain: [1, 3],         // 点热度单次 +min~+max
    tapHeatCooldownMs: 500,      // 点热度冷却
    answerCorrectGain: [8, 12],  // 答题正确 +min~+max
    answerWrongPenalty: 5,       // 答题错误 -热度
    // 观众
    baseInitialViewers: 100,     // 初始观众（真爱粉保底 P1 再加）
    // 涨粉（每分钟）：观众 × fanGainRate × 热度系数；单场上限 = 峰值观众 × fanGainCapRatio
    fanGainRate: 0.02,
    fanGainCapRatio: 0.10,
    // 直播带货：先看后买（远低于店铺自然单）
    liveConversionBase: 0.0018,
    // 活跃粉丝窗口
    activeFanRetention: 0.40,        // 本场新增粉丝 × 留存率 进入窗口
    activeFanWindowHours: 8,         // 窗口时长（游戏小时）
    activeFanOrderRate: 0.0008,      // 每小时每粉丝出单概率
    activeFanDailyOrderMaxRatio: 0.15, // 日上限 = min(count × 0.15, cap)
    activeFanDailyOrderMaxCap: 300,
    // 互动（升级规则用）
    interactionUpgradeThreshold: 10,
    // ===== P1 粉丝分层 =====
    // 路人粉基础流量：每 100 路人粉 → +2% 自然曝光（封顶 +20%）
    fanBaseTrafficPer: 100,
    fanBaseTrafficGain: 0.02,
    fanBaseTrafficCap: 0.20,
    // 铁粉每日口碑：每 100 铁粉 → +2% 自然搜索（封顶 +15%）
    loyalWordOfMouthPer: 100,
    loyalWordOfMouthGain: 0.02,
    loyalWordOfMouthCap: 0.15,
    // 升级 casual→loyal：单场互动 ≥10 且热度均值 ≥50 → 本场新粉 ×8% × 热度系数
    loyalUpgradeMinInteractions: 10,
    loyalUpgradeHeatAvg: 50,
    loyalUpgradeRate: 0.08,
    // 升级 loyal→true：累计场次 ≥10 或 累计直播销售额 ≥¥500 → 每场 loyal ×1.5%
    trueUpgradeMinStreams: 10,
    trueUpgradeMinSales: 500,
    trueUpgradeRate: 0.015,
    // 真爱粉保底：每真爱粉 +2 初始观众；有真爱粉则初始热度 +10
    trueFanBaselineViewers: 2,
    trueFanBaselineHeat: 10,
    // 长期不直播掉粉：每 7 天 -2% 路人粉（保底不归零）
    decayNoLiveDays: 7,
    decayRate: 0.02,
    // 画像系数进自然单：每 1 万画像粉 +5% 品类转化（封顶 +20%）
    profileBonusBase: 10000,
    profileBonusStep: 0.05,
    profileBonusCap: 0.20,
    // ===== P2 随机事件 =====
    liveBoomBaseChance: 0.12,        // 口才爆发基准概率（每 60 秒判定一次）
    liveBoomHeatThreshold: 70,       // 热度≥70 → 概率×2
    liveBoomMultiplier: 3,           // 爆单：订单×3
    liveBoomShrink: 0.5,             // 未补货 → 爆单缩水为 ×(3×0.5)=×1.5
    liveBoomRestockQty: 50,          // 紧急补货数量
    liveBoomCooldownTicks: 20,       // 事件冷却（tick 数，约 100 秒）
    liveFlipBaseChance: 0.10,        // 翻车基准概率
    liveFlipHeatThreshold: 25,       // 热度≤25 → 概率×2
    liveFlipFanLoss: [0.03, 0.08],   // 翻车掉粉 3%~8%
    liveFlipHeatPenalty: 20,         // 翻车热度 -20
    liveMaxEventsPerStream: 2,       // 单场上限事件数
    eventCheckIntervalSec: 60,       // 事件判定间隔（现实秒）
    prApologySuccess: 0.50,          // 道歉成功率
    prApologyFailLoss: 0.01,         // 道歉失败再掉 1%
    prCouponCost: 500,               // 发券花费
    prCouponHeatGain: 15,            // 发券回热度
    prCouponHaterToLoyal: 0.30,      // 发券黑粉 30% 转铁粉
    prIgnoreHeatPenalty: 10,         // 无视再掉热度
    // ===== P3 价格策略博弈 =====
    priceStrategyVolumeDiscount: 0.8,   // 低价冲量：直播中售价 ×0.8
    priceStrategyMarginMult: 1.1,       // 高价厚利：直播中售价 ×1.1
    priceStrategyVolumeSales: 1.8,      // 低价冲量：销量 ×1.8
    priceStrategyMarginSales: 0.6,      // 高价厚利：销量 ×0.6
    priceStrategyVolumeFan: 1.2,        // 低价冲量：涨粉 ×1.2（划算人设）
    priceStrategyMarginFan: 0.9,        // 高价厚利：涨粉 ×0.9
    postStreamPremiumMult: 1.08,        // 直播后高价窗口：activeFans 窗口内售价 ×1.08
    // ===== P3 助播（回归）：花钱买起量，不自动出单 =====
    assistantViewerRatio: 0.1,          // 助播 baseFans×10% 转初始观众
    assistantHeatBase: 5                // 助播初始热度加成（+baseFans/10000，封顶 20）
};

// 直播话题（粉丝画像）：profile 品类→转化系数；人货匹配（话题品类×选品品类一致）→ 热度+10
const LIVE_TOPICS = [
    { id: 'fashion', name: '穿搭', icon: '👗', category: 'clothing', profile: { clothing: 1.35, beauty: 1.15 }, desc: '吸引时尚粉，服装/美妆转化↑' },
    { id: 'digital', name: '数码', icon: '📱', category: 'digital', profile: { digital: 1.35, home: 1.10 }, desc: '吸引数码粉，数码/家居转化↑' },
    { id: 'home', name: '家居', icon: '🏠', category: 'home', profile: { home: 1.30, daily: 1.15 }, desc: '吸引家居粉，家居/日用转化↑' },
    { id: 'food', name: '美食', icon: '🍜', category: 'food', profile: { food: 1.35, daily: 1.20 }, desc: '吸引吃货粉，食品/日用转化↑' },
    { id: 'beauty', name: '美妆', icon: '💄', category: 'beauty', profile: { beauty: 1.35, clothing: 1.10 }, desc: '吸引美妆粉，美妆/服装转化↑' },
    { id: 'mixed', name: '综合', icon: '🌟', category: 'mixed', profile: {}, desc: '泛粉画像，稳定无加成' }
];

// 弹幕互动问答池（2 选 1）
const LIVE_QUESTIONS = [
    { q: '这款商品支持7天无理由退换吗？', options: ['支持', '不支持'], correctIndex: 0 },
    { q: '现在下单什么时候发货？', options: ['48小时内', '一个月后'], correctIndex: 0 },
    { q: '直播间价格和店铺日常价一样吗？', options: ['一样', '直播间更便宜'], correctIndex: 1 },
    { q: '这款商品有运费险吗？', options: ['有', '没有'], correctIndex: 0 },
    { q: '今天下单有赠品吗？', options: ['有', '没有'], correctIndex: 1 },
    { q: '支持开发票吗？', options: ['支持', '不支持'], correctIndex: 0 },
    { q: '包邮吗？', options: ['全场包邮', '不包邮'], correctIndex: 0 },
    { q: '这个尺码准吗？', options: ['标准尺码', '偏大'], correctIndex: 0 },
    { q: '买多件有优惠吗？', options: ['有优惠', '没有'], correctIndex: 0 },
    { q: '是正品吗？', options: ['官方正品', '高仿'], correctIndex: 0 }
];

// 随机事件池（P2）
const LIVE_EVENTS = [
    { id: 'eloquence_boom', type: 'positive', name: '口才爆发', icon: '💥', desc: '观众被你的口才打动，订单暴增！库存不足时快去补货', effect: 'boom' },
    { id: 'live_flip', type: 'negative', name: '直播翻车', icon: '😱', desc: '说错价格/展示翻车，粉丝正在流失……', effect: 'flip' }
];

// 价格策略（P3：低价冲量 vs 高价厚利）
const PRICE_STRATEGIES = [
    { id: 'volume', name: '低价冲量', icon: '📉', priceMult: 0.8, salesMult: 1.8, fanGainMult: 1.2, desc: '全场低价快速清库存，销量暴涨，单件毛利低' },
    { id: 'margin', name: '高价厚利', icon: '📈', priceMult: 1.1, salesMult: 0.6, fanGainMult: 0.9, desc: '高价慢慢卖，单件毛利高，适合高价值/库存少的商品' }
];

// 直播初始状态
const INITIAL_LIVESTREAM_STATE = {
    // 当前直播状态
    isLive: false,
    status: LIVE_STATUS.idle,
    streamer: null,
    scene: null,
    
    // 直播间基础信息
    roomId: null,
    title: '',
    coverImage: '🎥',
    notice: '欢迎来到直播间！',
    
    // 观众数据
    viewers: 0,
    peakViewers: 0,
    totalViews: 0,
    likes: 0,
    shares: 0,
    newFollowers: 0,
    
    // 直播时间
    duration: 0,
    plannedDuration: 4,
    startTime: null,
    endTime: null,
    
    // 销售数据
    totalSales: 0,
    orderCount: 0,
    productIds: [],
    currentProductIndex: 0,
    
    // 礼物收入
    giftIncome: 0,
    giftCount: 0,
    
    // 弹幕数据
    danmakus: [],
    danmakuCount: 0,
    blockedUsers: [],
    mutedUsers: [],
    
    // 直播设置
    settings: {
        autoEnd: true,
        showDiscount: true,
        discountRate: 0.9,
        enableDanmaku: true,
        enableGifts: true,
        enableAutoReply: true,
        danmakuSpeed: 'normal',
        noticeMessage: ''
    },
    
    // 历史记录
    history: [],
    replays: [],
    
    // 直播成就
    achievements: [],
    totalStats: {
        totalStreams: 0,
        totalDuration: 0,
        totalViewers: 0,
        totalSales: 0,
        totalGifts: 0,
        totalOrders: 0
    },
    
    // 直播间UI状态
    ui: {
        activeTab: 'overview',
        danmakuInput: '',
        selectedGift: null,
        showGiftPanel: false,
        showProductList: false,
        showSettingsPanel: false,
        isFullscreen: false,
        showChat: true
    },

    // ===== IP养成（P0）：粉丝资产 / 每日配额 / 本场热度 / 话题 / 活跃粉丝窗口 =====
    fans: { casual: 0, loyal: 0, true: 0, profile: {} },  // 粉丝资产（跨场持久）
    daily: { day: 0, used: 0 },                           // 每日直播配额
    heat: 30,                                             // 本场热度 0~100
    topicId: 'mixed',                                     // 本场话题
    topic: null,
    fansGained: 0,                                        // 本场累计涨粉（实时累加，endLive 落账）
    interactions: { taps: 0, correct: 0, wrong: 0 },      // 本场互动计数
    currentQuestion: null,                                // 当前待答弹幕题
    activeFans: {                                         // 活跃粉丝窗口（直播后自动带单）
        count: 0,
        expireDay: 0,
        expireHour: 0,
        dayOrdersUsed: 0,
        dayOrdersMax: 0,
        lastOrderDay: 0,
        lastCheckDay: 0,
        lastCheckHour: 0
    },
    settlement: null,                                     // 最近一场结算（涨粉/窗口提示）
    lastLiveDay: 0,                                       // 上次开播日（掉粉衰减 P1 用）
    startTimeReal: null,                                  // 开播现实时间戳（防幽灵直播兜底）
    // ===== P2 随机事件 =====
    events: [],                                           // 本场事件日志（持久化，结算页可回放）
    activeEvent: null,                                    // 待处理事件（翻车公关）
    eventCooldown: 0,                                     // 事件冷却（tick 数）
    eventCount: 0,                                        // 本场已触发事件数
    boom: null,                                           // 爆单状态 { productId, restocked, expiresDay, expiresHour }
    // ===== P3 价格策略 =====
    priceStrategy: 'volume'                               // volume 低价冲量 | margin 高价厚利
};

// 导出到全局
if (typeof window !== 'undefined') {
    window.LIVE_STREAMER_TYPES = LIVE_STREAMER_TYPES;
    window.LIVE_GIFTS = LIVE_GIFTS;
    window.DANMAKU_TYPES = DANMAKU_TYPES;
    window.LIVE_STATUS = LIVE_STATUS;
    window.LIVE_SCENES = LIVE_SCENES;
    window.MOCK_VIEWER_NAMES = MOCK_VIEWER_NAMES;
    window.MOCK_DANMAKU_CONTENT = MOCK_DANMAKU_CONTENT;
    window.LIVE_ACHIEVEMENTS = LIVE_ACHIEVEMENTS;
    window.LIVE_CONFIG = LIVE_CONFIG;
    window.LIVE_TOPICS = LIVE_TOPICS;
    window.LIVE_QUESTIONS = LIVE_QUESTIONS;
    window.LIVE_EVENTS = LIVE_EVENTS;
    window.PRICE_STRATEGIES = PRICE_STRATEGIES;
    window.INITIAL_LIVESTREAM_STATE = INITIAL_LIVESTREAM_STATE;
}
