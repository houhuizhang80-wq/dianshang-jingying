// ============================================================================
// 客户服务管理系统 - 数据层
// 包含：状态枚举、快捷回复模板、退换货原因库、纠纷类型、操作日志类型
// ============================================================================

// ==================== 咨询状态枚举 ====================
const CONSULTATION_STATUS = {
    PENDING: 'pending',         // 待回复
    REPLIED: 'replied',         // 已回复
    RESOLVED: 'resolved',        // 已解决
    MISSED: 'missed',            // 超时未回
    CLOSED: 'closed'             // 已关闭
};

const CONSULTATION_STATUS_LABEL = {
    pending: { name: '待回复', color: '#f44336', icon: '⏳' },
    replied: { name: '已回复', color: '#2196f3', icon: '✉️' },
    resolved: { name: '已解决', color: '#4caf50', icon: '✅' },
    missed: { name: '已超时', color: '#9e9e9e', icon: '⌛' },
    closed: { name: '已关闭', color: '#607d8b', icon: '🔒' }
};

// ==================== 退换货类型枚举 ====================
const RETURN_TYPES = {
    RETURN_REFUND: 'return_refund',    // 退货退款
    EXCHANGE: 'exchange',          // 换货
    REFUND_ONLY: 'refund_only'     // 仅退款
};

const RETURN_TYPE_LABEL = {
    return_refund: { name: '退货退款', icon: '↩️' },
    exchange: { name: '换货', icon: '🔄' },
    refund_only: { name: '仅退款', icon: '💰' }
};

// ==================== 退换货状态枚举 ====================
const RETURN_STATUS = {
    PENDING: 'pending',                 // 待审核
    APPROVED: 'approved',               // 审核通过-待买家寄回
    REJECTED: 'rejected',               // 审核拒绝
    BUYER_SHIPPED: 'buyer_shipped',     // 买家已寄回
    SELLER_RECEIVED: 'seller_received', // 商家已收货（待质检）
    CS_INSPECTION: 'cs_inspection',     // 售后客服质检中
    INSPECTION_PASS: 'inspection_pass', // 质检通过-待退款
    INSPECTION_FAIL: 'inspection_fail', // 质检不通过-拒绝退款
    REFUNDING: 'refunding',             // 退款中
    EXCHANGING: 'exchanging',           // 换货中
    COMPLETED: 'completed',              // 已完成
    CLOSED: 'closed'                     // 已关闭
};

const RETURN_STATUS_LABEL = {
    pending:         { name: '待商家审核', color: '#ff9800', icon: '⏳' },
    approved:        { name: '等待买家寄回', color: '#2196f3', icon: '📦' },
    rejected:        { name: '申请已拒绝', color: '#f44336', icon: '❌' },
    buyer_shipped:   { name: '买家已寄回', color: '#9c27b0', icon: '🚚' },
    seller_received: { name: '商家已收货', color: '#673ab7', icon: '✅' },
    cs_inspection:   { name: '售后客服质检中', color: '#795548', icon: '🔍' },
    inspection_pass: { name: '质检通过-待退款', color: '#2e7d32', icon: '✔️' },
    inspection_fail: { name: '质检不通过', color: '#c62828', icon: '🚫' },
    refunding:       { name: '退款处理中', color: '#ff5722', icon: '💰' },
    exchanging:     { name: '换货处理中', color: '#00bcd4', icon: '🔄' },
    completed:       { name: '已完成', color: '#4caf50', icon: '🎉' },
    closed:         { name: '已关闭', color: '#9e9e9e', icon: '🔒' }
};

// ==================== 售后客服质检配置 ====================
const CS_INSPECTION_CONFIG = {
    // 质检等级
    grades: [
        { id: 'A_PLUS',  name: '全新未拆',   icon: '💎', passRate: 1.00, refundRatio: 1.00 },
        { id: 'A',       name: '完好不影响二次销售', icon: '🟢', passRate: 1.00, refundRatio: 1.00 },
        { id: 'B',       name: '轻微使用痕迹', icon: '🟡', passRate: 0.92, refundRatio: 0.85 },
        { id: 'C',       name: '有明显污渍/破损', icon: '🟠', passRate: 0.25, refundRatio: 0.30 },
        { id: 'D',       name: '严重损坏/缺失配件', icon: '🔴', passRate: 0.00, refundRatio: 0.00 }
    ],
    // 质检流程耗时（小时，随机区间）
    inspectionDurationHours: [2, 8],
    // 质检项目
    checkItems: [
        '商品外观完好度',
        '配件/包装完整性',
        '商品功能可用性',
        '是否人为损坏',
        '防伪/发票核验'
    ],
    // 质检通过的综合判定阈值（0-1）
    passThreshold: 0.60
};

// ==================== 法律上诉状态枚举 ====================
const APPEAL_STATUS = {
    SUBMITTED: 'submitted',           // 买家已提交-待受理
    ACCEPTED: 'accepted',             // 法院已受理-进入审核
    REVIEWING: 'reviewing',           // 材料审核中
    HEARING_SCHEDULED: 'hearing_scheduled', // 已排期开庭
    RULED_BUYER: 'ruled_buyer',       // 判决：买家胜诉
    RULED_SELLER: 'ruled_seller',     // 判决：商家胜诉
    COMPENSATED: 'compensated',       // 已执行赔偿
    COMPLETED: 'completed',           // 已结案
    CLOSED: 'closed'                  // 已关闭/撤诉
};

const APPEAL_STATUS_LABEL = {
    submitted:          { name: '已提交，待受理', color: '#1976d2', icon: '📮' },
    accepted:           { name: '法院已受理', color: '#0288d1', icon: '📋' },
    reviewing:          { name: '材料审核中', color: '#7b1fa2', icon: '🔎' },
    hearing_scheduled:  { name: '已排期开庭', color: '#f57c00', icon: '⚖️' },
    ruled_buyer:        { name: '判决买家胜诉', color: '#2e7d32', icon: '🏆' },
    ruled_seller:       { name: '判决商家胜诉', color: '#c62828', icon: '🛡️' },
    compensated:        { name: '已执行赔偿', color: '#388e3c', icon: '💵' },
    completed:          { name: '已结案', color: '#607d8b', icon: '✅' },
    closed:             { name: '已关闭/撤诉', color: '#9e9e9e', icon: '🔒' }
};

// ==================== 法律上诉字段模板 ====================
const APPEAL_GROUNDS = [
    { id: 'contract',  name: '违反合同约定', weight: 1.1 },
    { id: 'fraud',     name: '涉嫌欺诈/虚假宣传', weight: 1.3 },
    { id: 'quality',   name: '商品质量缺陷造成损失', weight: 1.2 },
    { id: 'consumer',  name: '侵害消费者权益', weight: 1.15 },
    { id: 'safety',    name: '涉及人身/财产安全', weight: 1.4 },
    { id: 'privacy',   name: '个人信息泄露/隐私侵权', weight: 1.25 },
    { id: 'other',     name: '其他民事纠纷', weight: 1.0 }
];

const APPEAL_CLAIM_TYPES = [
    { id: 'refund',    name: '全额退款', icon: '💰' },
    { id: 'compensation', name: '赔偿损失（含精神损害）', icon: '💴' },
    { id: 'triple',    name: '要求退一赔三（欺诈）', icon: '💎' },
    { id: 'ten',       name: '要求退一赔十（食品安全）', icon: '🥇' },
    { id: 'apology',   name: '公开赔礼道歉', icon: '📢' }
];

const APPEAL_CONFIG = {
    // 上诉需在仅退款被拒/纠纷败诉后 N 小时内提出
    fileWithinHours: 72,
    // 受理费（由败诉方承担）
    courtFeeBase: 50,
    // 买家胜诉概率加成（上诉理由越严重加成越高）
    buyerWinBase: 0.48,
    // 排期时长
    scheduleHours: [24, 96],
    // 审理时长
    reviewHours: [48, 168]
};

// ==================== 纠纷状态枚举 ====================
const DISPUTE_STATUS = {
    ACCEPTED: 'accepted',             // 已受理
    EVIDENCE: 'evidence',            // 举证阶段
    MEDIATION: 'mediation',          // 调解中
    ARBITRATION: 'arbitration',    // 仲裁中
    RULED_BUYER: 'ruled_buyer',    // 判买家胜
    RULED_SELLER: 'ruled_seller',  // 判商家胜
    COMPLETED: 'completed',         // 已完成
    CLOSED: 'closed'               // 已关闭
};

const DISPUTE_STATUS_LABEL = {
    accepted:      { name: '平台已受理', color: '#ff9800', icon: '📋' },
    evidence:     { name: '双方举证中', color: '#2196f3', icon: '📎' },
    mediation:  { name: '平台调解中', color: '#9c27b0', icon: '🤝' },
    arbitration:{ name: '平台仲裁中', color: '#f44336', icon: '⚖️' },
    ruled_buyer: { name: '判定买家胜诉', color: '#4caf50', icon: '🛡️' },
    ruled_seller:{ name: '判定商家胜诉', color: '#ff5722', icon: '🏪' },
    completed:  { name: '已完成', color: '#607d8b', icon: '✅' },
    closed:     { name: '已关闭', color: '#9e9e9e', icon: '🔒' }
};

// ==================== 纠纷类型 ====================
const DISPUTE_TYPES = [
    { id: 'quality', name: '商品质量问题', icon: '⚠️' },
    { id: 'mismatch', name: '商品与描述不符', icon: '❓' },
    { id: 'damaged', name: '商品破损/变形', icon: '💥' },
    { id: 'fake', name: '怀疑假冒伪劣', icon: '🚫' },
    { id: 'lost', name: '包裹丢失/未收到', icon: '📭' },
    { id: 'refund', name: '退款问题', icon: '💸' },
    { id: 'shipping', name: '物流/运费争议', icon: '🚚' },
    { id: 'service', name: '服务态度问题', icon: '😤' },
    { id: 'other', name: '其他争议', icon: '📝' }
];

// ==================== 退换货原因库 ====================
const RETURN_REASONS = [
    { id: 'quality', name: '商品质量问题', tip: '有瑕疵、做工差、功能异常等' },
    { id: 'mismatch', name: '商品与描述不符', tip: '颜色/款式/型号与商品描述不一致' },
    { id: 'size', name: '尺码/规格不合适', tip: '大小不合适需要退换' },
    { id: 'damaged', name: '收到商品破损', tip: '运输途中破损、变形、漏液等' },
    { id: 'not_want', name: '不想要了/拍错了', tip: '七天无理由退换' },
    { id: 'fake', name: '怀疑是假货', tip: '与正品不符' },
    { id: 'late', name: '发货/物流太慢', tip: '未按约定时间发货或送达' },
    { id: 'missing', name: '少发/漏发/错发', tip: '商品数量不对或发错商品' },
    { id: 'other', name: '其他原因', tip: '请补充说明具体原因' }
];

// ==================== 快捷回复模板库 ====================
const QUICK_REPLIES = [
    {
        category: '商品咨询',
        items: [
            { id: 'stock_yes', text: '亲，这款商品目前有货的哦，拍下后24小时内发货~', hot: true },
            { id: 'stock_no', text: '亲，这款商品暂时缺货了，您可以先收藏，补货后第一时间通知您！' },
            { id: 'ship_time', text: '亲，我们下单后24小时内发货，默认发圆通/中通快递~', hot: true },
            { id: 'ship_company', text: '亲，默认发中通快递，如需指定快递请备注哦~' },
            { id: 'quality', text: '亲，我们的商品都是正品保证，支持七天无理由退换，请放心购买！' },
            { id: 'discount', text: '亲，现在已经是活动优惠价了哦，多买还有更多优惠~' },
            { id: 'gift', text: '亲，这款商品现在下单有精美小礼品赠送哦，数量有限先到先得~' }
        ]
    },
    {
        category: '售后处理',
        items: [
            { id: '7day', text: '亲，支持七天无理由退换，商品不影响二次销售即可申请哦~', hot: true },
            { id: 'return_process', text: '亲，您可以在订单详情页点击"申请售后"，我们会尽快为您处理~' },
            { id: 'refund_time', text: '亲，退款审核通过后1-3个工作日原路返回您的支付账户~' },
            { id: 'return_address', text: '亲，退货地址审核通过后会发送给您，请按地址寄回哦~' },
            { id: 'exchange', text: '亲，换货请先申请退货，再重新下单您需要的款式哦~' }
        ]
    },
    {
        category: '安抚话术',
        items: [
            { id: 'sorry', text: '非常抱歉给您带来不好的体验了！我们一定为您妥善处理~', hot: true },
            { id: 'understand', text: '亲理解您的心情，我们会尽快处理，给您一个满意的答复~' },
            { id: 'patient', text: '亲请您稍等，这边正在为您核实处理，请耐心等待~' },
            { id: 'compensate', text: '为了表示歉意，我们可以为您提供5元优惠券补偿，您看可以吗？' }
        ]
    },
    {
        category: '物流查询',
        items: [
            { id: 'track', text: '亲，您的包裹正在运输中，请您耐心等待，预计1-2天内送达~' },
            { id: 'delay', text: '亲，非常抱歉物流有所延迟，这边已帮您催促快递尽快派送~' },
            { id: 'lost', text: '亲，您的包裹物流异常，这边马上为您核实处理！' }
        ]
    }
];

// ==================== 操作日志类型 ====================
const CS_LOG_TYPES = {
    CONSULTATION_CREATED: 'consultation_created',
    CONSULTATION_REPLIED: 'consultation_replied',
    CONSULTATION_RESOLVED: 'consultation_resolved',
    CONSULTATION_MISSED: 'consultation_missed',
    RETURN_CREATED: 'return_created',
    RETURN_APPROVED: 'return_approved',
    RETURN_REJECTED: 'return_rejected',
    RETURN_BUYER_SHIPPED: 'return_buyer_shipped',
    RETURN_SELLER_RECEIVED: 'return_seller_received',
    RETURN_CS_INSPECTION_START: 'return_cs_inspection_start',
    RETURN_CS_INSPECTION_PASS: 'return_cs_inspection_pass',
    RETURN_CS_INSPECTION_FAIL: 'return_cs_inspection_fail',
    RETURN_REFUNDED: 'return_refunded',
    RETURN_COMPLETED: 'return_completed',
    DISPUTE_CREATED: 'dispute_created',
    DISPUTE_EVIDENCE: 'dispute_evidence',
    DISPUTE_MEDIATION: 'dispute_mediation',
    DISPUTE_ARBITRATION: 'dispute_arbitration',
    DISPUTE_RULED: 'dispute_ruled',
    DISPUTE_COMPLETED: 'dispute_completed',
    APPEAL_CREATED: 'appeal_created',
    APPEAL_ACCEPTED: 'appeal_accepted',
    APPEAL_REVIEWING: 'appeal_reviewing',
    APPEAL_HEARING_SCHEDULED: 'appeal_hearing_scheduled',
    APPEAL_RULED: 'appeal_ruled',
    APPEAL_COMPENSATED: 'appeal_compensated',
    APPEAL_COMPLETED: 'appeal_completed'
};

const CS_LOG_LABEL = {
    consultation_created: '买家发起咨询',
    consultation_replied: '客服回复咨询',
    consultation_resolved: '咨询已解决',
    consultation_missed: '咨询超时未回复',
    return_created: '买家提交退换货申请',
    return_approved: '审核通过退换货',
    return_rejected: '拒绝退换货申请',
    return_buyer_shipped: '买家已寄出退换货',
    return_seller_received: '商家已收到退换货',
    return_cs_inspection_start: '售后客服开始质检',
    return_cs_inspection_pass: '质检通过，进入退款流程',
    return_cs_inspection_fail: '质检不通过，拒绝退款',
    return_refunded: '退款已完成',
    return_completed: '退换货流程完成',
    dispute_created: '买家发起纠纷',
    dispute_evidence: '双方举证',
    dispute_mediation: '平台介入调解',
    dispute_arbitration: '进入仲裁程序',
    dispute_ruled: '平台仲裁判定',
    dispute_completed: '纠纷处理完成',
    appeal_created: '买家提交法律上诉',
    appeal_accepted: '法院已受理上诉',
    appeal_reviewing: '进入材料审核阶段',
    appeal_hearing_scheduled: '已安排开庭排期',
    appeal_ruled: '法院已作出判决',
    appeal_compensated: '赔偿已执行',
    appeal_completed: '法律上诉案件结案'
};

// ==================== 自动回复触发关键词 ====================
const AUTO_REPLY_KEYWORDS = [
    { keywords: ['你好', '您好', '在吗', 'hello', 'hi'], reply: '亲~您好！欢迎光临，请问有什么可以帮您的？😊' },
    { keywords: ['发货', '什么时候发', '多久发'], reply: '亲，我们下单后24小时内发货，活动期间可能稍有延迟，请您耐心等待~' },
    { keywords: ['快递', '物流', '发什么'], reply: '亲，默认发中通快递，如需顺丰请备注哦~' },
    { keywords: ['退货', '退款', '退换'], reply: '亲，支持七天无理由退换！您可以在订单详情页点击"申请售后"~' },
    { keywords: ['质量', '正品', '真假'], reply: '亲，我们的商品都是正品保证，质量问题包退换，请您放心购买！' },
    { keywords: ['优惠', '便宜', '打折', '降价'], reply: '亲，现在已经是活动优惠价了哦，关注店铺还有更多优惠券~' }
];

// ==================== 客服标识 ====================
const CS_STAFF_NAMES = [
    '小客服-小美', '小客服-阿杰', '客服-小云', '客服-小乐', '专属客服-小智'
];

// ==================== 仲裁判定规则（简单模拟） ====================
const ARBITRATION_RULES = {
    // 买家胜诉情况（70%概率）
    buyerWinRate: 0.7,
    // 证据权重
    evidenceWeight: {
        buyerEvidenceCount: 0.3,   // 买家举证数量权重
        sellerEvidenceCount: 0.3, // 商家举证数量权重
        orderAge: 0.15,           // 订单时间新旧（越新越有利于买家）
        reputationImpact: 0.25     // 商家信誉影响
    }
};

// ==================== 系统初始化的初始状态结构 ====================
const CS_INITIAL_STATE_STRUCTURE = {
    consultations: [],    // 咨询记录
    returns: [],          // 退换货记录
    disputes: [],       // 纠纷记录
    appeals: [],         // 法律上诉记录
    logs: [],            // 操作日志
    notifications: [],    // 消息通知
    statistics: {
        totalConsultations: 0,
        totalReturns: 0,
        totalDisputes: 0,
        totalAppeals: 0,
        avgResponseTime: 0,    // 平均响应时间（小时）
        resolutionRate: 0,       // 解决率
        returnApproveRate: 0,   // 退换货通过率
        inspectionPassRate: 0,  // 质检通过率
        buyerSatisfaction: 0   // 买家满意度
    }
};
