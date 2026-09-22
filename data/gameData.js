// 游戏初始数据配置

/** 对外展示版本号（个人中心底部 / 打包 manifest 应对齐） */
const APP_VERSION = '4.0.0';
const APP_VERSION_NAME = '电商经营模拟器 v' + APP_VERSION;

/**
 * 安全转义HTML特殊字符，防止XSS（用于将用户输入内容插入到innerHTML模板中）
 */
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// 商品品类
const CATEGORIES = [
    { id: 'daily', name: '日用百货', icon: '🏠' },
    { id: 'digital', name: '数码家电', icon: '📱' },
    { id: 'clothing', name: '服饰箱包', icon: '👕' },
    { id: 'food', name: '食品生鲜', icon: '🍎' },
    { id: 'beauty', name: '美妆个护', icon: '💄' },
    { id: 'home', name: '家居建材', icon: '🛋️' },
    { id: 'outdoor', name: '户外文娱', icon: '⚽' },
    { id: 'luxury', name: '奢侈品', icon: '💎' },
    { id: 'precious', name: '贵金属', icon: '🟡' }
];

// 批发商数据
const SUPPLIERS = [
    {
        id: 's1',
        name: '义乌小商品批发市场',
        level: 1,
        categories: ['daily', 'home'],
        qualityBase: 60,
        priceMultiplier: 0.7,
        minOrder: 10,
        deliveryDays: 3,
        availableGrades: ['C', 'B'],
        description: '价格低廉，品质一般，起订量低',
        unlockLevel: 1
    },
    {
        id: 's2',
        name: '深圳电子市场',
        level: 2,
        categories: ['digital'],
        qualityBase: 70,
        priceMultiplier: 0.85,
        minOrder: 5,
        deliveryDays: 2,
        availableGrades: ['B', 'A'],
        description: '数码产品专业供货商',
        unlockLevel: 1
    },
    {
        id: 's3',
        name: '杭州服装批发城',
        level: 2,
        categories: ['clothing'],
        qualityBase: 65,
        priceMultiplier: 0.8,
        minOrder: 8,
        deliveryDays: 2,
        availableGrades: ['C', 'B'],
        description: '服饰箱包一手货源',
        unlockLevel: 1
    },
    {
        id: 's4',
        name: '广州美妆供应链',
        level: 2,
        categories: ['beauty'],
        qualityBase: 75,
        priceMultiplier: 0.9,
        minOrder: 6,
        deliveryDays: 2,
        availableGrades: ['B', 'A'],
        description: '美妆个护正品渠道',
        unlockLevel: 2
    },
    {
        id: 's5',
        name: '山东生鲜基地',
        level: 2,
        categories: ['food'],
        qualityBase: 70,
        priceMultiplier: 0.75,
        minOrder: 15,
        deliveryDays: 1,
        availableGrades: ['C', 'B'],
        description: '新鲜直达，配送快',
        unlockLevel: 2
    },
    {
        id: 's6',
        name: '福建户外用品工厂',
        level: 2,
        categories: ['outdoor'],
        qualityBase: 72,
        priceMultiplier: 0.82,
        minOrder: 8,
        deliveryDays: 3,
        availableGrades: ['B', 'A'],
        description: '户外文娱用品专业厂家',
        unlockLevel: 2
    },
    {
        id: 's7',
        name: '品牌直供商城',
        level: 3,
        categories: ['daily', 'digital', 'clothing', 'food', 'beauty', 'home', 'outdoor'],
        qualityBase: 88,
        priceMultiplier: 1.1,
        minOrder: 3,
        deliveryDays: 1,
        availableGrades: ['B', 'A'],
        description: '全品类品牌正品，品质保证',
        unlockLevel: 3
    },
    {
        id: 's8',
        name: '进口精品保税仓',
        level: 4,
        categories: ['beauty', 'food', 'digital'],
        qualityBase: 95,
        priceMultiplier: 1.3,
        minOrder: 2,
        deliveryDays: 4,
        availableGrades: ['A'],
        description: '海外进口，高端品质',
        unlockLevel: 4
    }
];

// 商品品质等级（价格越高的商品品控越严格，差评率越低）
const QUALITY_GRADES = {
    A: { grade: 'A', name: 'A品', description: '优质商品，品质保证', qualityBase: 90, priceMultiplier: 1.3, negativeRate: 0.0 },
    B: { grade: 'B', name: 'B品', description: '中等品质，性价比高', qualityBase: 70, priceMultiplier: 1.0, negativeRate: 0.02 },
    C: { grade: 'C', name: 'C品', description: '基础品质，价格实惠', qualityBase: 50, priceMultiplier: 0.7, negativeRate: 0.05 }
};
// 动态差评率修正：根据商品价格降低C品/基础品质的差评概率（高价商品严格品控）
function getAdjustedNegativeRate(product, baseGrade) {
    const price = product?.basePrice || 50;
    const grade = baseGrade || 'B';
    const info = QUALITY_GRADES[grade] || QUALITY_GRADES.B;
    let rate = info.negativeRate;
    // 高价商品随价格降低差评率（品控更严，同时避免高价值品把店铺信誉砸穿）
    if (price >= 3000) rate *= 0.35;
    else if (price >= 1000) rate *= 0.55;
    else if (price >= 500) rate *= 0.75;
    else if (price >= 200) rate *= 0.9;
    return Math.min(rate, 0.15);
}

// 基础商品库（大众货 + 奢侈品约100款，价格覆盖约15元-数十万）
const PRODUCTS = [
    // ============== 日用百货（30个） ==============
    { id: 'p1001', category: 'daily', name: '竹纤维抹布洗碗布10片', basePrice: 16, baseWeight: 28, baseQuality: 64, procurementDays: 2 },
    { id: 'p1002', category: 'daily', name: '超细纤维吸水地垫浴室防滑', basePrice: 39, baseWeight: 42, baseQuality: 70, procurementDays: 3 },
    { id: 'p1003', category: 'daily', name: '浓缩洗衣液2kg留香型', basePrice: 52, baseWeight: 72, baseQuality: 68, procurementDays: 3 },
    { id: 'p1004', category: 'daily', name: '厨房洗洁精1.5kg柠檬香', basePrice: 22, baseWeight: 55, baseQuality: 62, procurementDays: 2 },
    { id: 'p1005', category: 'daily', name: '加厚背心垃圾袋5卷装', basePrice: 19, baseWeight: 36, baseQuality: 58, procurementDays: 2 },
    { id: 'p1006', category: 'daily', name: '本色卷纸12卷整提', basePrice: 36, baseWeight: 68, baseQuality: 66, procurementDays: 3 },
    { id: 'p1007', category: 'daily', name: '抽纸面巾纸27包箱装', basePrice: 49, baseWeight: 80, baseQuality: 65, procurementDays: 3 },
    { id: 'p1008', category: 'daily', name: '不锈钢保温杯双层500ml', basePrice: 79, baseWeight: 48, baseQuality: 74, procurementDays: 4 },
    { id: 'p1009', category: 'daily', name: '玻璃密封罐储物罐3件套', basePrice: 59, baseWeight: 55, baseQuality: 72, procurementDays: 4 },
    { id: 'p1010', category: 'daily', name: '家用体温计电子额温枪', basePrice: 89, baseWeight: 18, baseQuality: 76, procurementDays: 4 },
    { id: 'p1011', category: 'daily', name: '雨伞全自动折叠防风伞', basePrice: 69, baseWeight: 32, baseQuality: 70, procurementDays: 3 },
    { id: 'p1012', category: 'daily', name: '拖鞋家居防滑静音四季', basePrice: 35, baseWeight: 28, baseQuality: 66, procurementDays: 2 },
    { id: 'p1013', category: 'daily', name: '衣架无痕防滑宽肩20只', basePrice: 29, baseWeight: 40, baseQuality: 64, procurementDays: 2 },
    { id: 'p1014', category: 'daily', name: '桌面收纳盒抽屉式三层', basePrice: 45, baseWeight: 38, baseQuality: 68, procurementDays: 3 },
    { id: 'p1015', category: 'daily', name: '香薰蜡烛礼盒助眠套装', basePrice: 99, baseWeight: 35, baseQuality: 74, procurementDays: 4 },
    { id: 'p1016', category: 'daily', name: '宠物猫粮成猫粮10kg', basePrice: 189, baseWeight: 85, baseQuality: 76, procurementDays: 5 },
    { id: 'p1017', category: 'daily', name: '豆腐猫砂除臭结团6L×4', basePrice: 79, baseWeight: 78, baseQuality: 70, procurementDays: 4 },
    { id: 'p1018', category: 'daily', name: '婴儿湿巾手口专用80抽×10', basePrice: 69, baseWeight: 62, baseQuality: 74, procurementDays: 3 },
    { id: 'p1019', category: 'daily', name: '电动牙刷成人声波软毛', basePrice: 169, baseWeight: 30, baseQuality: 78, procurementDays: 5 },
    { id: 'p1020', category: 'daily', name: '空气炸锅家用5L无油炸', basePrice: 299, baseWeight: 70, baseQuality: 80, procurementDays: 6 },
    { id: 'p1021', category: 'daily', name: '扫地机器人扫拖一体智能', basePrice: 1299, baseWeight: 75, baseQuality: 86, procurementDays: 10 },
    { id: 'p1022', category: 'daily', name: '空气净化器除醛除菌家用', basePrice: 899, baseWeight: 72, baseQuality: 84, procurementDays: 8 },
    { id: 'p1023', category: 'daily', name: '洗碗海绵百洁布24片装', basePrice: 18, baseWeight: 22, baseQuality: 60, procurementDays: 2 },
    { id: 'p1024', category: 'daily', name: '厨房保鲜膜切割盒2卷', basePrice: 26, baseWeight: 30, baseQuality: 64, procurementDays: 2 },
    { id: 'p1025', category: 'daily', name: '除湿袋衣柜吸湿盒10袋', basePrice: 32, baseWeight: 40, baseQuality: 66, procurementDays: 2 },
    { id: 'p1026', category: 'daily', name: '洗衣液凝珠洗衣球50颗', basePrice: 59, baseWeight: 35, baseQuality: 72, procurementDays: 3 },
    { id: 'p1027', category: 'daily', name: '电热水壶双层防烫1.7L', basePrice: 89, baseWeight: 42, baseQuality: 74, procurementDays: 4 },
    { id: 'p1028', category: 'daily', name: '蒸汽挂烫机家用手持式', basePrice: 159, baseWeight: 38, baseQuality: 76, procurementDays: 4 },
    { id: 'p1029', category: 'daily', name: '宠物狗粮成犬粮8kg', basePrice: 169, baseWeight: 82, baseQuality: 74, procurementDays: 5 },
    { id: 'p1030', category: 'daily', name: '婴儿纸尿裤L码66片', basePrice: 99, baseWeight: 48, baseQuality: 78, procurementDays: 3 },

    // ============== 数码家电（32个） ==============
    { id: 'p2001', category: 'digital', name: 'Type-C编织数据线1米', basePrice: 19, baseWeight: 8, baseQuality: 62, procurementDays: 1 },
    { id: 'p2002', category: 'digital', name: '磁吸手机壳防摔透明壳', basePrice: 39, baseWeight: 12, baseQuality: 66, procurementDays: 2 },
    { id: 'p2003', category: 'digital', name: '氮化镓快充头65W双口', basePrice: 89, baseWeight: 15, baseQuality: 74, procurementDays: 3 },
    { id: 'p2004', category: 'digital', name: '固态U盘256G高速读写', basePrice: 129, baseWeight: 8, baseQuality: 76, procurementDays: 3 },
    { id: 'p2005', category: 'digital', name: '真无线降噪蓝牙耳机', basePrice: 299, baseWeight: 18, baseQuality: 80, procurementDays: 4 },
    { id: 'p2006', category: 'digital', name: '磁吸充电宝10000mAh', basePrice: 159, baseWeight: 28, baseQuality: 76, procurementDays: 4 },
    { id: 'p2007', category: 'digital', name: '大容量移动电源30000mAh', basePrice: 199, baseWeight: 45, baseQuality: 74, procurementDays: 4 },
    { id: 'p2008', category: 'digital', name: '机械键盘热插拔RGB', basePrice: 349, baseWeight: 48, baseQuality: 80, procurementDays: 5 },
    { id: 'p2009', category: 'digital', name: '无线静音鼠标可充电', basePrice: 79, baseWeight: 14, baseQuality: 70, procurementDays: 2 },
    { id: 'p2010', category: 'digital', name: '智能手表运动血氧监测', basePrice: 459, baseWeight: 20, baseQuality: 82, procurementDays: 5 },
    { id: 'p2011', category: 'digital', name: 'WiFi6千兆双频路由器', basePrice: 199, baseWeight: 32, baseQuality: 76, procurementDays: 4 },
    { id: 'p2012', category: 'digital', name: '4K网络摄像头家用监控', basePrice: 169, baseWeight: 22, baseQuality: 74, procurementDays: 4 },
    { id: 'p2013', category: 'digital', name: '平板电脑10.9英寸学习版', basePrice: 1299, baseWeight: 42, baseQuality: 84, procurementDays: 8 },
    { id: 'p2014', category: 'digital', name: '轻薄本14寸商务办公本', basePrice: 3999, baseWeight: 55, baseQuality: 88, procurementDays: 12 },
    { id: 'p2015', category: 'digital', name: '旗舰智能手机5G全网通', basePrice: 4499, baseWeight: 35, baseQuality: 90, procurementDays: 10 },
    { id: 'p2016', category: 'digital', name: '微单相机入门套机18-55', basePrice: 3599, baseWeight: 48, baseQuality: 88, procurementDays: 12 },
    { id: 'p2017', category: 'digital', name: '27寸2K显示器护眼IPS', basePrice: 1199, baseWeight: 78, baseQuality: 84, procurementDays: 8 },
    { id: 'p2018', category: 'digital', name: '蓝牙音箱便携防水音响', basePrice: 129, baseWeight: 24, baseQuality: 72, procurementDays: 3 },
    { id: 'p2019', category: 'digital', name: '智能门锁指纹密码锁', basePrice: 799, baseWeight: 55, baseQuality: 82, procurementDays: 7 },
    { id: 'p2020', category: 'digital', name: '投影仪家用1080P便携', basePrice: 999, baseWeight: 42, baseQuality: 80, procurementDays: 7 },
    { id: 'p2021', category: 'digital', name: '游戏手柄无线双模震动', basePrice: 189, baseWeight: 28, baseQuality: 76, procurementDays: 4 },
    { id: 'p2022', category: 'digital', name: 'NAS家用双盘位存储', basePrice: 1699, baseWeight: 58, baseQuality: 84, procurementDays: 9 },
    { id: 'p2023', category: 'digital', name: '无人机航拍4K折叠便携', basePrice: 2799, baseWeight: 40, baseQuality: 86, procurementDays: 10 },
    { id: 'p2024', category: 'digital', name: '电子书阅读器6.8寸墨水屏', basePrice: 1099, baseWeight: 22, baseQuality: 86, procurementDays: 7 },
    { id: 'p2025', category: 'digital', name: '一拖三数据线快充套装', basePrice: 29, baseWeight: 10, baseQuality: 64, procurementDays: 1 },
    { id: 'p2026', category: 'digital', name: '手机支架桌面可调节', basePrice: 35, baseWeight: 14, baseQuality: 66, procurementDays: 2 },
    { id: 'p2027', category: 'digital', name: '蓝牙耳机半入耳长续航', basePrice: 129, baseWeight: 12, baseQuality: 74, procurementDays: 3 },
    { id: 'p2028', category: 'digital', name: '手机散热器背夹降温', basePrice: 79, baseWeight: 16, baseQuality: 70, procurementDays: 3 },
    { id: 'p2029', category: 'digital', name: '拓展坞雷电4八合一', basePrice: 399, baseWeight: 22, baseQuality: 80, procurementDays: 5 },
    { id: 'p2030', category: 'digital', name: '智能手环心率睡眠监测', basePrice: 199, baseWeight: 12, baseQuality: 76, procurementDays: 4 },
    { id: 'p2031', category: 'digital', name: '直播补光灯环形美颜灯', basePrice: 169, baseWeight: 30, baseQuality: 74, procurementDays: 4 },
    { id: 'p2032', category: 'digital', name: '外接移动硬盘2TB高速', basePrice: 499, baseWeight: 26, baseQuality: 82, procurementDays: 5 },

    // ============== 服饰箱包（27个） ==============
    { id: 'p3001', category: 'clothing', name: '纯棉短袖T恤男女同款', basePrice: 69, baseWeight: 22, baseQuality: 70, procurementDays: 3 },
    { id: 'p3002', category: 'clothing', name: '新疆棉内裤男4条装', basePrice: 59, baseWeight: 18, baseQuality: 72, procurementDays: 2 },
    { id: 'p3003', category: 'clothing', name: '运动速干短裤男夏', basePrice: 79, baseWeight: 20, baseQuality: 70, procurementDays: 3 },
    { id: 'p3004', category: 'clothing', name: '直筒牛仔裤男弹力修身', basePrice: 159, baseWeight: 40, baseQuality: 74, procurementDays: 4 },
    { id: 'p3005', category: 'clothing', name: '防晒衣男女UPF50+', basePrice: 129, baseWeight: 18, baseQuality: 74, procurementDays: 3 },
    { id: 'p3006', category: 'clothing', name: '连帽卫衣加绒秋冬款', basePrice: 189, baseWeight: 45, baseQuality: 76, procurementDays: 4 },
    { id: 'p3007', category: 'clothing', name: '雪纺连衣裙女夏季碎花', basePrice: 199, baseWeight: 28, baseQuality: 76, procurementDays: 5 },
    { id: 'p3008', category: 'clothing', name: '羽绒服男短款90白鸭绒', basePrice: 599, baseWeight: 55, baseQuality: 84, procurementDays: 7 },
    { id: 'p3009', category: 'clothing', name: '商务休闲衬衫男免烫', basePrice: 169, baseWeight: 24, baseQuality: 74, procurementDays: 4 },
    { id: 'p3010', category: 'clothing', name: '真皮皮带男自动扣', basePrice: 99, baseWeight: 16, baseQuality: 72, procurementDays: 3 },
    { id: 'p3011', category: 'clothing', name: '网面运动鞋男轻便跑鞋', basePrice: 259, baseWeight: 42, baseQuality: 76, procurementDays: 5 },
    { id: 'p3012', category: 'clothing', name: '女士小白鞋厚底百搭', basePrice: 229, baseWeight: 38, baseQuality: 74, procurementDays: 5 },
    { id: 'p3013', category: 'clothing', name: '双肩背包电脑包防泼水', basePrice: 189, baseWeight: 35, baseQuality: 76, procurementDays: 4 },
    { id: 'p3014', category: 'clothing', name: '女士托特包大容量帆布', basePrice: 159, baseWeight: 28, baseQuality: 72, procurementDays: 4 },
    { id: 'p3015', category: 'clothing', name: '铝框行李箱24寸万向轮', basePrice: 399, baseWeight: 62, baseQuality: 78, procurementDays: 6 },
    { id: 'p3016', category: 'clothing', name: '羊绒围巾女冬季保暖', basePrice: 299, baseWeight: 18, baseQuality: 82, procurementDays: 5 },
    { id: 'p3017', category: 'clothing', name: '男士商务西装外套单西', basePrice: 699, baseWeight: 48, baseQuality: 84, procurementDays: 8 },
    { id: 'p3018', category: 'clothing', name: '女士短靴切尔西靴真皮', basePrice: 399, baseWeight: 45, baseQuality: 80, procurementDays: 6 },
    { id: 'p3019', category: 'clothing', name: '机械手表男防水日历款', basePrice: 1299, baseWeight: 20, baseQuality: 88, procurementDays: 8 },
    { id: 'p3020', category: 'clothing', name: '银项链女锁骨链轻奢', basePrice: 259, baseWeight: 6, baseQuality: 84, procurementDays: 4 },
    { id: 'p3021', category: 'clothing', name: '纯棉袜子女中筒5双装', basePrice: 39, baseWeight: 14, baseQuality: 68, procurementDays: 2 },
    { id: 'p3022', category: 'clothing', name: '运动内衣女防震高强度', basePrice: 99, baseWeight: 16, baseQuality: 74, procurementDays: 3 },
    { id: 'p3023', category: 'clothing', name: '针织开衫女春秋薄款', basePrice: 149, baseWeight: 26, baseQuality: 74, procurementDays: 4 },
    { id: 'p3024', category: 'clothing', name: '男士休闲裤直筒宽松', basePrice: 139, baseWeight: 32, baseQuality: 72, procurementDays: 3 },
    { id: 'p3025', category: 'clothing', name: '棒球帽男女鸭舌遮阳', basePrice: 59, baseWeight: 12, baseQuality: 70, procurementDays: 2 },
    { id: 'p3026', category: 'clothing', name: '斜挎小包女链条包', basePrice: 129, baseWeight: 18, baseQuality: 74, procurementDays: 3 },
    { id: 'p3027', category: 'clothing', name: '马丁靴男工装短靴', basePrice: 329, baseWeight: 48, baseQuality: 78, procurementDays: 5 },

    // ============== 食品生鲜（25个） ==============
    { id: 'p4001', category: 'food', name: '膨化零食大礼包混合装', basePrice: 49, baseWeight: 55, baseQuality: 64, procurementDays: 2 },
    { id: 'p4002', category: 'food', name: '方便面桶装12桶箱', basePrice: 42, baseWeight: 70, baseQuality: 62, procurementDays: 2 },
    { id: 'p4003', category: 'food', name: '每日坚果混合果仁750g', basePrice: 89, baseWeight: 40, baseQuality: 74, procurementDays: 3 },
    { id: 'p4004', category: 'food', name: '进口黑巧克力礼盒装', basePrice: 129, baseWeight: 32, baseQuality: 80, procurementDays: 4 },
    { id: 'p4005', category: 'food', name: '五常大米10kg真空装', basePrice: 99, baseWeight: 90, baseQuality: 76, procurementDays: 4 },
    { id: 'p4006', category: 'food', name: '特级初榨橄榄油1L', basePrice: 119, baseWeight: 38, baseQuality: 80, procurementDays: 4 },
    { id: 'p4007', category: 'food', name: '云南普洱茶饼357g', basePrice: 189, baseWeight: 35, baseQuality: 82, procurementDays: 5 },
    { id: 'p4008', category: 'food', name: '智利车厘子2斤JJ级', basePrice: 159, baseWeight: 45, baseQuality: 78, procurementDays: 2 },
    { id: 'p4009', category: 'food', name: '原切牛排套餐10片装', basePrice: 299, baseWeight: 55, baseQuality: 82, procurementDays: 3 },
    { id: 'p4010', category: 'food', name: '海鲜礼盒帝王蟹腿虾', basePrice: 499, baseWeight: 70, baseQuality: 84, procurementDays: 3 },
    { id: 'p4011', category: 'food', name: '猫山王榴莲液氮保鲜', basePrice: 399, baseWeight: 65, baseQuality: 86, procurementDays: 3 },
    { id: 'p4012', category: 'food', name: '即食燕窝礼盒6瓶', basePrice: 699, baseWeight: 40, baseQuality: 88, procurementDays: 6 },
    { id: 'p4013', category: 'food', name: '青岛啤酒500ml×12罐', basePrice: 69, baseWeight: 88, baseQuality: 70, procurementDays: 3 },
    { id: 'p4014', category: 'food', name: '赤霞珠干红葡萄酒750ml', basePrice: 159, baseWeight: 32, baseQuality: 78, procurementDays: 4 },
    { id: 'p4015', category: 'food', name: '酱香型白酒500ml礼盒', basePrice: 899, baseWeight: 38, baseQuality: 90, procurementDays: 6 },
    { id: 'p4016', category: 'food', name: '手撕牛肉干内蒙古500g', basePrice: 99, baseWeight: 28, baseQuality: 74, procurementDays: 3 },
    { id: 'p4017', category: 'food', name: '冻干水果脆混合装', basePrice: 59, baseWeight: 22, baseQuality: 72, procurementDays: 2 },
    { id: 'p4018', category: 'food', name: '有机鸡蛋30枚礼盒', basePrice: 79, baseWeight: 48, baseQuality: 76, procurementDays: 2 },
    { id: 'p4019', category: 'food', name: '速溶咖啡三合一30条', basePrice: 45, baseWeight: 28, baseQuality: 66, procurementDays: 2 },
    { id: 'p4020', category: 'food', name: '龙井绿茶明前特级250g', basePrice: 168, baseWeight: 24, baseQuality: 84, procurementDays: 4 },
    { id: 'p4021', category: 'food', name: '牛肉酱拌饭酱下饭菜3瓶', basePrice: 56, baseWeight: 48, baseQuality: 70, procurementDays: 3 },
    { id: 'p4022', category: 'food', name: '酸奶块冻干固体酸奶', basePrice: 49, baseWeight: 18, baseQuality: 72, procurementDays: 2 },
    { id: 'p4023', category: 'food', name: '泰国香米5kg真空装', basePrice: 79, baseWeight: 85, baseQuality: 74, procurementDays: 3 },
    { id: 'p4024', category: 'food', name: '进口牛奶全脂1L×12盒', basePrice: 119, baseWeight: 78, baseQuality: 76, procurementDays: 3 },
    { id: 'p4025', category: 'food', name: '精酿啤酒IPA六联包', basePrice: 99, baseWeight: 70, baseQuality: 74, procurementDays: 3 },

    // ============== 美妆个护（25个） ==============
    { id: 'p5001', category: 'beauty', name: '氨基酸洁面乳温和120g', basePrice: 59, baseWeight: 18, baseQuality: 72, procurementDays: 3 },
    { id: 'p5002', category: 'beauty', name: '玻尿酸面膜补水10片', basePrice: 69, baseWeight: 22, baseQuality: 74, procurementDays: 3 },
    { id: 'p5003', category: 'beauty', name: '护手霜套装植物香氛', basePrice: 49, baseWeight: 16, baseQuality: 70, procurementDays: 2 },
    { id: 'p5004', category: 'beauty', name: '哑光口红丝绒雾面', basePrice: 89, baseWeight: 8, baseQuality: 76, procurementDays: 3 },
    { id: 'p5005', category: 'beauty', name: '无硅油洗发水500ml', basePrice: 79, baseWeight: 35, baseQuality: 72, procurementDays: 3 },
    { id: 'p5006', category: 'beauty', name: '防晒霜SPF50+隔离', basePrice: 99, baseWeight: 16, baseQuality: 78, procurementDays: 3 },
    { id: 'p5007', category: 'beauty', name: '烟酰胺精华原液30ml', basePrice: 129, baseWeight: 12, baseQuality: 80, procurementDays: 4 },
    { id: 'p5008', category: 'beauty', name: '气垫BB霜遮瑕持妆', basePrice: 149, baseWeight: 14, baseQuality: 78, procurementDays: 4 },
    { id: 'p5009', category: 'beauty', name: '淡香水女士花香调50ml', basePrice: 259, baseWeight: 18, baseQuality: 82, procurementDays: 5 },
    { id: 'p5010', category: 'beauty', name: '护肤水乳套装基础护理', basePrice: 299, baseWeight: 40, baseQuality: 82, procurementDays: 5 },
    { id: 'p5011', category: 'beauty', name: '抗老精华小棕瓶50ml', basePrice: 699, baseWeight: 15, baseQuality: 88, procurementDays: 6 },
    { id: 'p5012', category: 'beauty', name: '贵妇面霜修护50ml', basePrice: 899, baseWeight: 18, baseQuality: 90, procurementDays: 7 },
    { id: 'p5013', category: 'beauty', name: '男士古龙香水100ml', basePrice: 399, baseWeight: 22, baseQuality: 84, procurementDays: 5 },
    { id: 'p5014', category: 'beauty', name: '电动牙刷替换刷头4支', basePrice: 79, baseWeight: 10, baseQuality: 74, procurementDays: 2 },
    { id: 'p5015', category: 'beauty', name: '卸妆油温和眼唇可用', basePrice: 109, baseWeight: 28, baseQuality: 76, procurementDays: 3 },
    { id: 'p5016', category: 'beauty', name: '眉笔防水双头自动', basePrice: 45, baseWeight: 6, baseQuality: 70, procurementDays: 2 },
    { id: 'p5017', category: 'beauty', name: '染发剂植物遮白自然黑', basePrice: 69, baseWeight: 30, baseQuality: 68, procurementDays: 3 },
    { id: 'p5018', category: 'beauty', name: '高端香水礼盒限量款', basePrice: 1599, baseWeight: 28, baseQuality: 92, procurementDays: 8 },
    { id: 'p5019', category: 'beauty', name: '身体乳保湿滋润400ml', basePrice: 69, baseWeight: 32, baseQuality: 72, procurementDays: 3 },
    { id: 'p5020', category: 'beauty', name: '男士控油洗面奶150g', basePrice: 55, baseWeight: 20, baseQuality: 70, procurementDays: 2 },
    { id: 'p5021', category: 'beauty', name: '睫毛膏纤长防水不晕染', basePrice: 79, baseWeight: 8, baseQuality: 74, procurementDays: 3 },
    { id: 'p5022', category: 'beauty', name: '润唇膏保湿防干裂2支', basePrice: 39, baseWeight: 6, baseQuality: 68, procurementDays: 2 },
    { id: 'p5023', category: 'beauty', name: '护发精油柔顺防毛躁', basePrice: 109, baseWeight: 14, baseQuality: 76, procurementDays: 3 },
    { id: 'p5024', category: 'beauty', name: '冲牙器便携水牙线', basePrice: 199, baseWeight: 28, baseQuality: 78, procurementDays: 4 },
    { id: 'p5025', category: 'beauty', name: '负离子吹风机家用大功率', basePrice: 229, baseWeight: 35, baseQuality: 78, procurementDays: 4 },

    // ============== 家居家装（27个） ==============
    { id: 'p6001', category: 'home', name: '无痕挂钩强力粘钩20只', basePrice: 19, baseWeight: 12, baseQuality: 60, procurementDays: 1 },
    { id: 'p6002', category: 'home', name: '记忆棉枕头护颈一对', basePrice: 129, baseWeight: 45, baseQuality: 76, procurementDays: 4 },
    { id: 'p6003', category: 'home', name: '陶瓷花瓶装饰摆件', basePrice: 89, baseWeight: 35, baseQuality: 74, procurementDays: 4 },
    { id: 'p6004', category: 'home', name: '收纳箱带盖大号3个', basePrice: 99, baseWeight: 55, baseQuality: 70, procurementDays: 3 },
    { id: 'p6005', category: 'home', name: '客厅装饰画三联画', basePrice: 159, baseWeight: 40, baseQuality: 72, procurementDays: 5 },
    { id: 'p6006', category: 'home', name: '全遮光窗帘卧室加厚', basePrice: 199, baseWeight: 50, baseQuality: 74, procurementDays: 5 },
    { id: 'p6007', category: 'home', name: '香薰加湿器静音夜灯', basePrice: 149, baseWeight: 32, baseQuality: 76, procurementDays: 4 },
    { id: 'p6008', category: 'home', name: '纯棉床上四件套1.8m', basePrice: 299, baseWeight: 55, baseQuality: 80, procurementDays: 5 },
    { id: 'p6009', category: 'home', name: '乳胶床垫独立弹簧1.8m', basePrice: 1999, baseWeight: 90, baseQuality: 86, procurementDays: 12 },
    { id: 'p6010', category: 'home', name: '布艺沙发三人位北欧', basePrice: 2599, baseWeight: 88, baseQuality: 84, procurementDays: 14 },
    { id: 'p6011', category: 'home', name: '智能马桶盖即热烘干', basePrice: 1299, baseWeight: 55, baseQuality: 84, procurementDays: 9 },
    { id: 'p6012', category: 'home', name: '双开门冰箱风冷变频', basePrice: 3499, baseWeight: 92, baseQuality: 88, procurementDays: 15 },
    { id: 'p6013', category: 'home', name: '滚筒洗衣机10kg洗烘', basePrice: 2799, baseWeight: 90, baseQuality: 86, procurementDays: 12 },
    { id: 'p6014', category: 'home', name: '吸油烟机侧吸式静音', basePrice: 1599, baseWeight: 80, baseQuality: 82, procurementDays: 10 },
    { id: 'p6015', category: 'home', name: '燃气灶双灶嵌入式', basePrice: 899, baseWeight: 55, baseQuality: 80, procurementDays: 8 },
    { id: 'p6016', category: 'home', name: '台灯护眼学习读写灯', basePrice: 199, baseWeight: 28, baseQuality: 78, procurementDays: 4 },
    { id: 'p6017', category: 'home', name: '地毯客厅北欧可水洗', basePrice: 259, baseWeight: 48, baseQuality: 74, procurementDays: 5 },
    { id: 'p6018', category: 'home', name: '工具箱套装家用维修', basePrice: 159, baseWeight: 58, baseQuality: 72, procurementDays: 4 },
    { id: 'p6019', category: 'home', name: '净水器厨下RO反渗透', basePrice: 1499, baseWeight: 65, baseQuality: 84, procurementDays: 9 },
    { id: 'p6020', category: 'home', name: '全屋智能开关面板套装', basePrice: 999, baseWeight: 35, baseQuality: 82, procurementDays: 7 },
    { id: 'p6021', category: 'home', name: '浴室置物架免打孔三层', basePrice: 69, baseWeight: 28, baseQuality: 68, procurementDays: 3 },
    { id: 'p6022', category: 'home', name: '乳胶枕护颈一只装', basePrice: 99, baseWeight: 32, baseQuality: 76, procurementDays: 3 },
    { id: 'p6023', category: 'home', name: 'LED台灯触控调光护眼', basePrice: 129, baseWeight: 24, baseQuality: 74, procurementDays: 3 },
    { id: 'p6024', category: 'home', name: '厨房刀具套装六件套', basePrice: 159, baseWeight: 40, baseQuality: 74, procurementDays: 4 },
    { id: 'p6025', category: 'home', name: '洗碗机台式免安装', basePrice: 1299, baseWeight: 70, baseQuality: 82, procurementDays: 8 },
    { id: 'p6026', category: 'home', name: '电热水器60升储水式', basePrice: 999, baseWeight: 78, baseQuality: 80, procurementDays: 8 },
    { id: 'p6027', category: 'home', name: '挂机空调大1.5匹变频', basePrice: 2299, baseWeight: 85, baseQuality: 84, procurementDays: 12 },

    // ============== 户外文娱（22个） ==============
    { id: 'p7001', category: 'outdoor', name: 'TPE瑜伽垫加厚防滑', basePrice: 79, baseWeight: 40, baseQuality: 70, procurementDays: 3 },
    { id: 'p7002', category: 'outdoor', name: '运动水壶不锈钢1L', basePrice: 59, baseWeight: 28, baseQuality: 72, procurementDays: 2 },
    { id: 'p7003', category: 'outdoor', name: '钢丝跳绳竞速可调节', basePrice: 39, baseWeight: 12, baseQuality: 68, procurementDays: 2 },
    { id: 'p7004', category: 'outdoor', name: '飞盘户外竞技专业盘', basePrice: 49, baseWeight: 14, baseQuality: 70, procurementDays: 2 },
    { id: 'p7005', category: 'outdoor', name: '拼图1000片风景款', basePrice: 69, baseWeight: 30, baseQuality: 72, procurementDays: 3 },
    { id: 'p7006', category: 'outdoor', name: '滑板双翘初学专业板', basePrice: 229, baseWeight: 45, baseQuality: 76, procurementDays: 5 },
    { id: 'p7007', category: 'outdoor', name: '羽毛球拍碳素对拍套装', basePrice: 259, baseWeight: 35, baseQuality: 78, procurementDays: 4 },
    { id: 'p7008', category: 'outdoor', name: '野餐垫防潮加大加厚', basePrice: 89, baseWeight: 32, baseQuality: 70, procurementDays: 3 },
    { id: 'p7009', category: 'outdoor', name: '登山杖碳纤维可折叠', basePrice: 149, baseWeight: 22, baseQuality: 76, procurementDays: 4 },
    { id: 'p7010', category: 'outdoor', name: '可调节哑铃套装20kg', basePrice: 299, baseWeight: 85, baseQuality: 78, procurementDays: 5 },
    { id: 'p7011', category: 'outdoor', name: '帐篷户外3-4人双层', basePrice: 459, baseWeight: 70, baseQuality: 80, procurementDays: 6 },
    { id: 'p7012', category: 'outdoor', name: '公路自行车21速铝架', basePrice: 1899, baseWeight: 88, baseQuality: 84, procurementDays: 12 },
    { id: 'p7013', category: 'outdoor', name: '运动相机4K防抖防水', basePrice: 1299, baseWeight: 18, baseQuality: 86, procurementDays: 8 },
    { id: 'p7014', category: 'outdoor', name: '民谣吉他41寸初学', basePrice: 399, baseWeight: 55, baseQuality: 76, procurementDays: 6 },
    { id: 'p7015', category: 'outdoor', name: '露营睡袋春秋保暖', basePrice: 199, baseWeight: 42, baseQuality: 74, procurementDays: 4 },
    { id: 'p7016', category: 'outdoor', name: '折叠露营桌椅套装', basePrice: 279, baseWeight: 60, baseQuality: 74, procurementDays: 5 },
    { id: 'p7017', category: 'outdoor', name: '足球5号成人训练球', basePrice: 89, baseWeight: 30, baseQuality: 70, procurementDays: 3 },
    { id: 'p7018', category: 'outdoor', name: '乒乓球拍成品拍两支装', basePrice: 99, baseWeight: 22, baseQuality: 72, procurementDays: 3 },
    { id: 'p7019', category: 'outdoor', name: '呼啦圈可拆卸加重款', basePrice: 69, baseWeight: 28, baseQuality: 68, procurementDays: 2 },
    { id: 'p7020', category: 'outdoor', name: '尤克里里23寸初学套装', basePrice: 249, baseWeight: 30, baseQuality: 74, procurementDays: 4 },
    { id: 'p7021', category: 'outdoor', name: '天幕帐篷户外遮阳棚', basePrice: 329, baseWeight: 55, baseQuality: 76, procurementDays: 5 },
    { id: 'p7022', category: 'outdoor', name: '电动滑板车成人折叠', basePrice: 1599, baseWeight: 72, baseQuality: 82, procurementDays: 9 },

    // ============== 扩展商品库（200个，7大品类） ==============
    // 日用百货（29个）
    { id: 'p1031', category: 'daily', name: '静电除尘掸子可伸缩长柄', basePrice: 29, baseWeight: 22, baseQuality: 62, procurementDays: 2 },
    { id: 'p1032', category: 'daily', name: '不锈钢盆洗菜盆三件套', basePrice: 39, baseWeight: 45, baseQuality: 66, procurementDays: 3 },
    { id: 'p1033', category: 'daily', name: '陶瓷马克杯带盖勺办公室', basePrice: 35, baseWeight: 30, baseQuality: 68, procurementDays: 3 },
    { id: 'p1034', category: 'daily', name: '保温饭盒便当盒三层', basePrice: 59, baseWeight: 38, baseQuality: 72, procurementDays: 4 },
    { id: 'p1035', category: 'daily', name: '玻璃保鲜盒微波炉专用3件', basePrice: 49, baseWeight: 42, baseQuality: 70, procurementDays: 3 },
    { id: 'p1036', category: 'daily', name: '厨房剪刀鸡骨剪多功能', basePrice: 39, baseWeight: 16, baseQuality: 68, procurementDays: 2 },
    { id: 'p1037', category: 'daily', name: '菜板竹木砧板双面防霉', basePrice: 69, baseWeight: 55, baseQuality: 72, procurementDays: 4 },
    { id: 'p1038', category: 'daily', name: '电煮锅多功能宿舍小锅', basePrice: 119, baseWeight: 40, baseQuality: 74, procurementDays: 5 },
    { id: 'p1039', category: 'daily', name: '电饭煲智能预约3L', basePrice: 199, baseWeight: 60, baseQuality: 78, procurementDays: 6 },
    { id: 'p1040', category: 'daily', name: '电磁炉家用大火力2200W', basePrice: 169, baseWeight: 50, baseQuality: 76, procurementDays: 6 },
    { id: 'p1041', category: 'daily', name: '沥水篮双层洗菜滤水', basePrice: 29, baseWeight: 20, baseQuality: 62, procurementDays: 2 },
    { id: 'p1042', category: 'daily', name: '儿童餐具辅食碗吸盘', basePrice: 49, baseWeight: 22, baseQuality: 70, procurementDays: 3 },
    { id: 'p1043', category: 'daily', name: '婴儿推车轻便可折叠', basePrice: 399, baseWeight: 80, baseQuality: 78, procurementDays: 8 },
    { id: 'p1044', category: 'daily', name: '儿童安全座椅汽车用', basePrice: 899, baseWeight: 90, baseQuality: 82, procurementDays: 10 },
    { id: 'p1045', category: 'daily', name: '爬行垫婴儿加厚XPE', basePrice: 129, baseWeight: 65, baseQuality: 74, procurementDays: 5 },
    { id: 'p1046', category: 'daily', name: '玩具收纳架多层卡通', basePrice: 99, baseWeight: 50, baseQuality: 70, procurementDays: 4 },
    { id: 'p1047', category: 'daily', name: '宠物自动喂食器定时', basePrice: 159, baseWeight: 45, baseQuality: 76, procurementDays: 5 },
    { id: 'p1048', category: 'daily', name: '猫咪饮水机静音循环', basePrice: 99, baseWeight: 30, baseQuality: 74, procurementDays: 4 },
    { id: 'p1049', category: 'daily', name: '猫爬架剑麻柱多层', basePrice: 259, baseWeight: 70, baseQuality: 76, procurementDays: 6 },
    { id: 'p1050', category: 'daily', name: '狗窝四季通用可拆洗', basePrice: 89, baseWeight: 40, baseQuality: 70, procurementDays: 4 },
    { id: 'p1051', category: 'daily', name: '宠物牵引绳胸背带套装', basePrice: 59, baseWeight: 18, baseQuality: 68, procurementDays: 2 },
    { id: 'p1052', category: 'daily', name: '宠物零食鸡肉干500g', basePrice: 49, baseWeight: 25, baseQuality: 70, procurementDays: 3 },
    { id: 'p1053', category: 'daily', name: '猫砂盆半封闭除臭', basePrice: 79, baseWeight: 45, baseQuality: 70, procurementDays: 4 },
    { id: 'p1054', category: 'daily', name: '车用手机支架重力感应', basePrice: 39, baseWeight: 12, baseQuality: 66, procurementDays: 2 },
    { id: 'p1055', category: 'daily', name: '车载吸尘器无线大吸力', basePrice: 169, baseWeight: 38, baseQuality: 76, procurementDays: 5 },
    { id: 'p1056', category: 'daily', name: '行车记录仪高清夜视', basePrice: 299, baseWeight: 20, baseQuality: 78, procurementDays: 6 },
    { id: 'p1057', category: 'daily', name: '文具套装学生礼盒', basePrice: 49, baseWeight: 25, baseQuality: 66, procurementDays: 2 },
    { id: 'p1058', category: 'daily', name: '计算器办公财务专用', basePrice: 29, baseWeight: 15, baseQuality: 64, procurementDays: 2 },
    { id: 'p1059', category: 'daily', name: '雨鞋套防滑加厚便携', basePrice: 25, baseWeight: 16, baseQuality: 62, procurementDays: 2 },

    // 数码家电（29个）
    { id: 'p2033', category: 'digital', name: '手机钢化膜防爆全屏3片', basePrice: 29, baseWeight: 6, baseQuality: 66, procurementDays: 2 },
    { id: 'p2034', category: 'digital', name: '手机支架磁吸车载两用', basePrice: 39, baseWeight: 20, baseQuality: 66, procurementDays: 2 },
    { id: 'p2035', category: 'digital', name: '蓝牙自拍杆三脚架一体', basePrice: 69, baseWeight: 25, baseQuality: 70, procurementDays: 3 },
    { id: 'p2036', category: 'digital', name: '无线充电器15W快充', basePrice: 89, baseWeight: 15, baseQuality: 74, procurementDays: 3 },
    { id: 'p2037', category: 'digital', name: '车载充电器双口快充', basePrice: 49, baseWeight: 10, baseQuality: 68, procurementDays: 2 },
    { id: 'p2038', category: 'digital', name: '智能音箱AI语音助手', basePrice: 149, baseWeight: 35, baseQuality: 76, procurementDays: 4 },
    { id: 'p2039', category: 'digital', name: '蓝牙键盘便携折叠', basePrice: 159, baseWeight: 30, baseQuality: 76, procurementDays: 4 },
    { id: 'p2040', category: 'digital', name: '无线鼠标人体工学', basePrice: 99, baseWeight: 12, baseQuality: 72, procurementDays: 3 },
    { id: 'p2041', category: 'digital', name: '电竞鼠标垫加大加厚', basePrice: 39, baseWeight: 18, baseQuality: 66, procurementDays: 2 },
    { id: 'p2042', category: 'digital', name: '显示器支架臂双屏', basePrice: 199, baseWeight: 55, baseQuality: 76, procurementDays: 5 },
    { id: 'p2043', category: 'digital', name: '桌面麦克风USB电容', basePrice: 129, baseWeight: 25, baseQuality: 74, procurementDays: 4 },
    { id: 'p2044', category: 'digital', name: '摄影补光灯手持口袋', basePrice: 99, baseWeight: 22, baseQuality: 74, procurementDays: 3 },
    { id: 'p2045', category: 'digital', name: '数码相机入门卡片机', basePrice: 1599, baseWeight: 30, baseQuality: 82, procurementDays: 8 },
    { id: 'p2046', category: 'digital', name: '拍立得相机套装', basePrice: 499, baseWeight: 25, baseQuality: 78, procurementDays: 6 },
    { id: 'p2047', category: 'digital', name: '智能翻译笔扫描词典笔', basePrice: 699, baseWeight: 12, baseQuality: 84, procurementDays: 7 },
    { id: 'p2048', category: 'digital', name: '学习平板儿童早教机', basePrice: 899, baseWeight: 40, baseQuality: 80, procurementDays: 7 },
    { id: 'p2049', category: 'digital', name: '电视盒子4K网络机顶盒', basePrice: 199, baseWeight: 18, baseQuality: 74, procurementDays: 4 },
    { id: 'p2050', category: 'digital', name: '智能电视55寸4K', basePrice: 2499, baseWeight: 88, baseQuality: 86, procurementDays: 12 },
    { id: 'p2051', category: 'digital', name: '空调扇冷风机家用', basePrice: 399, baseWeight: 70, baseQuality: 76, procurementDays: 7 },
    { id: 'p2052', category: 'digital', name: '破壁机家用静音豆浆机', basePrice: 499, baseWeight: 60, baseQuality: 80, procurementDays: 8 },
    { id: 'p2053', category: 'digital', name: '咖啡机半自动意式', basePrice: 1299, baseWeight: 65, baseQuality: 84, procurementDays: 9 },
    { id: 'p2054', category: 'digital', name: '空气循环扇静音落地', basePrice: 299, baseWeight: 55, baseQuality: 76, procurementDays: 6 },
    { id: 'p2055', category: 'digital', name: '除湿机家用静音大容量', basePrice: 899, baseWeight: 75, baseQuality: 80, procurementDays: 9 },
    { id: 'p2056', category: 'digital', name: '吸尘器无线手持大吸力', basePrice: 999, baseWeight: 60, baseQuality: 82, procurementDays: 9 },
    { id: 'p2057', category: 'digital', name: '智能门铃可视对讲', basePrice: 299, baseWeight: 25, baseQuality: 78, procurementDays: 6 },
    { id: 'p2058', category: 'digital', name: '智能插座WiFi远程', basePrice: 59, baseWeight: 8, baseQuality: 70, procurementDays: 3 },
    { id: 'p2059', category: 'digital', name: '体脂秤智能蓝牙', basePrice: 99, baseWeight: 35, baseQuality: 74, procurementDays: 4 },
    { id: 'p2060', category: 'digital', name: '智能手写板液晶涂鸦', basePrice: 69, baseWeight: 20, baseQuality: 68, procurementDays: 3 },
    { id: 'p2061', category: 'digital', name: '无人机儿童遥控玩具', basePrice: 199, baseWeight: 30, baseQuality: 72, procurementDays: 5 },

    // 服饰箱包（29个）
    { id: 'p3028', category: 'clothing', name: '棉麻衬衫男夏季短袖', basePrice: 129, baseWeight: 22, baseQuality: 72, procurementDays: 3 },
    { id: 'p3029', category: 'clothing', name: '针织背心女秋冬内搭', basePrice: 89, baseWeight: 18, baseQuality: 70, procurementDays: 3 },
    { id: 'p3030', category: 'clothing', name: '风衣女中长款外套', basePrice: 329, baseWeight: 45, baseQuality: 78, procurementDays: 6 },
    { id: 'p3031', category: 'clothing', name: '冲锋衣男女三合一', basePrice: 499, baseWeight: 55, baseQuality: 80, procurementDays: 7 },
    { id: 'p3032', category: 'clothing', name: '羽绒马甲男轻薄款', basePrice: 259, baseWeight: 30, baseQuality: 76, procurementDays: 5 },
    { id: 'p3033', category: 'clothing', name: '运动卫衣女宽松套头', basePrice: 159, baseWeight: 32, baseQuality: 74, procurementDays: 4 },
    { id: 'p3034', category: 'clothing', name: '打底衫女高领保暖', basePrice: 69, baseWeight: 20, baseQuality: 70, procurementDays: 3 },
    { id: 'p3035', category: 'clothing', name: '西装裤男商务直筒', basePrice: 199, baseWeight: 35, baseQuality: 74, procurementDays: 4 },
    { id: 'p3036', category: 'clothing', name: '阔腿裤女垂感高腰', basePrice: 149, baseWeight: 30, baseQuality: 72, procurementDays: 4 },
    { id: 'p3037', category: 'clothing', name: '休闲短裤男工装多口袋', basePrice: 89, baseWeight: 22, baseQuality: 70, procurementDays: 3 },
    { id: 'p3038', category: 'clothing', name: '半身裙女A字显瘦', basePrice: 119, baseWeight: 20, baseQuality: 72, procurementDays: 4 },
    { id: 'p3039', category: 'clothing', name: '针织连衣裙女秋冬', basePrice: 229, baseWeight: 32, baseQuality: 76, procurementDays: 5 },
    { id: 'p3040', category: 'clothing', name: '睡衣套装女纯棉春秋', basePrice: 129, baseWeight: 25, baseQuality: 72, procurementDays: 3 },
    { id: 'p3041', category: 'clothing', name: '儿童羽绒服男童中长款', basePrice: 399, baseWeight: 40, baseQuality: 78, procurementDays: 6 },
    { id: 'p3042', category: 'clothing', name: '儿童运动鞋透气网面', basePrice: 169, baseWeight: 30, baseQuality: 74, procurementDays: 4 },
    { id: 'p3043', category: 'clothing', name: '亲子装卫衣三件套', basePrice: 259, baseWeight: 40, baseQuality: 74, procurementDays: 5 },
    { id: 'p3044', category: 'clothing', name: '丝巾女真丝方巾', basePrice: 99, baseWeight: 8, baseQuality: 76, procurementDays: 3 },
    { id: 'p3045', category: 'clothing', name: '渔夫帽男女防晒大檐', basePrice: 59, baseWeight: 14, baseQuality: 68, procurementDays: 2 },
    { id: 'p3046', category: 'clothing', name: '毛线帽男冬季保暖', basePrice: 49, baseWeight: 15, baseQuality: 66, procurementDays: 2 },
    { id: 'p3047', category: 'clothing', name: '太阳镜男女偏光墨镜', basePrice: 129, baseWeight: 12, baseQuality: 74, procurementDays: 3 },
    { id: 'p3048', category: 'clothing', name: '领带商务真丝条纹', basePrice: 79, baseWeight: 8, baseQuality: 72, procurementDays: 3 },
    { id: 'p3049', category: 'clothing', name: '袜子男中筒纯棉10双装', basePrice: 59, baseWeight: 15, baseQuality: 68, procurementDays: 2 },
    { id: 'p3050', category: 'clothing', name: '雪地靴女加绒防滑', basePrice: 299, baseWeight: 50, baseQuality: 76, procurementDays: 5 },
    { id: 'p3051', category: 'clothing', name: '乐福鞋女平底真皮', basePrice: 259, baseWeight: 35, baseQuality: 74, procurementDays: 5 },
    { id: 'p3052', category: 'clothing', name: '人字拖情侣沙滩凉拖', basePrice: 45, baseWeight: 20, baseQuality: 66, procurementDays: 2 },
    { id: 'p3053', category: 'clothing', name: '泳衣女保守连体裙式', basePrice: 139, baseWeight: 18, baseQuality: 72, procurementDays: 3 },
    { id: 'p3054', category: 'clothing', name: '泳镜高清防雾成人', basePrice: 59, baseWeight: 10, baseQuality: 70, procurementDays: 2 },
    { id: 'p3055', category: 'clothing', name: '钱包男短款真皮', basePrice: 99, baseWeight: 12, baseQuality: 72, procurementDays: 3 },
    { id: 'p3056', category: 'clothing', name: '卡包女多卡位轻薄', basePrice: 39, baseWeight: 8, baseQuality: 66, procurementDays: 2 },

    // 食品生鲜（29个）
    { id: 'p4026', category: 'food', name: '螺蛳粉柳州正宗3袋', basePrice: 39, baseWeight: 60, baseQuality: 68, procurementDays: 2 },
    { id: 'p4027', category: 'food', name: '酸辣粉重庆风味6桶', basePrice: 49, baseWeight: 55, baseQuality: 66, procurementDays: 2 },
    { id: 'p4028', category: 'food', name: '挂面手工空心500g×3', basePrice: 29, baseWeight: 45, baseQuality: 64, procurementDays: 2 },
    { id: 'p4029', category: 'food', name: '燕麦片即食无糖1kg', basePrice: 49, baseWeight: 40, baseQuality: 72, procurementDays: 2 },
    { id: 'p4030', category: 'food', name: '蜂蜜土蜂蜜纯正500g', basePrice: 89, baseWeight: 28, baseQuality: 78, procurementDays: 3 },
    { id: 'p4031', category: 'food', name: '红糖姜茶块装20粒', basePrice: 39, baseWeight: 25, baseQuality: 68, procurementDays: 2 },
    { id: 'p4032', category: 'food', name: '枸杞宁夏特级250g', basePrice: 59, baseWeight: 15, baseQuality: 74, procurementDays: 3 },
    { id: 'p4033', category: 'food', name: '红枣新疆灰枣500g', basePrice: 39, baseWeight: 22, baseQuality: 72, procurementDays: 2 },
    { id: 'p4034', category: 'food', name: '核桃仁原味500g', basePrice: 59, baseWeight: 25, baseQuality: 74, procurementDays: 3 },
    { id: 'p4035', category: 'food', name: '碧根果奶油味500g', basePrice: 69, baseWeight: 25, baseQuality: 72, procurementDays: 3 },
    { id: 'p4036', category: 'food', name: '夏威夷果奶油500g', basePrice: 89, baseWeight: 25, baseQuality: 76, procurementDays: 3 },
    { id: 'p4037', category: 'food', name: '水果罐头黄桃425g×5', basePrice: 49, baseWeight: 55, baseQuality: 68, procurementDays: 2 },
    { id: 'p4038', category: 'food', name: '午餐肉罐头340g×3', basePrice: 59, baseWeight: 45, baseQuality: 70, procurementDays: 2 },
    { id: 'p4039', category: 'food', name: '火腿肠即食玉米热狗30支', basePrice: 49, baseWeight: 50, baseQuality: 66, procurementDays: 2 },
    { id: 'p4040', category: 'food', name: '酸奶机家用全自动', basePrice: 99, baseWeight: 35, baseQuality: 70, procurementDays: 4 },
    { id: 'p4041', category: 'food', name: '冰淇淋机家用小型', basePrice: 299, baseWeight: 45, baseQuality: 74, procurementDays: 5 },
    { id: 'p4042', category: 'food', name: '空气炸锅纸托硅油纸', basePrice: 25, baseWeight: 15, baseQuality: 60, procurementDays: 1 },
    { id: 'p4043', category: 'food', name: '一次性餐具套装50套', basePrice: 35, baseWeight: 40, baseQuality: 62, procurementDays: 1 },
    { id: 'p4044', category: 'food', name: '保温杯垫恒温加热', basePrice: 59, baseWeight: 12, baseQuality: 68, procurementDays: 3 },
    { id: 'p4045', category: 'food', name: '便携榨汁杯无线', basePrice: 99, baseWeight: 30, baseQuality: 74, procurementDays: 4 },
    { id: 'p4046', category: 'food', name: '电炖锅隔水炖盅家用', basePrice: 189, baseWeight: 55, baseQuality: 76, procurementDays: 6 },
    { id: 'p4047', category: 'food', name: '摩卡壶手冲咖啡壶', basePrice: 129, baseWeight: 35, baseQuality: 74, procurementDays: 4 },
    { id: 'p4048', category: 'food', name: '咖啡豆阿拉比卡500g', basePrice: 89, baseWeight: 25, baseQuality: 76, procurementDays: 3 },
    { id: 'p4049', category: 'food', name: '抹茶粉烘焙专用100g', basePrice: 69, baseWeight: 12, baseQuality: 76, procurementDays: 3 },
    { id: 'p4050', category: 'food', name: '黑芝麻糊即食500g', basePrice: 39, baseWeight: 25, baseQuality: 70, procurementDays: 2 },
    { id: 'p4051', category: 'food', name: '藕粉羹桂花坚果500g', basePrice: 49, baseWeight: 25, baseQuality: 72, procurementDays: 2 },
    { id: 'p4052', category: 'food', name: '虾仁菜脯下饭酱', basePrice: 39, baseWeight: 22, baseQuality: 68, procurementDays: 2 },
    { id: 'p4053', category: 'food', name: '火锅底料牛油500g', basePrice: 59, baseWeight: 30, baseQuality: 72, procurementDays: 2 },
    { id: 'p4054', category: 'food', name: '预制菜酸菜鱼速食', basePrice: 79, baseWeight: 65, baseQuality: 70, procurementDays: 3 },

    // 美妆个护（28个）
    { id: 'p5026', category: 'beauty', name: '身体磨砂膏去角质250g', basePrice: 79, baseWeight: 25, baseQuality: 74, procurementDays: 3 },
    { id: 'p5027', category: 'beauty', name: '沐浴露香氛持久750ml', basePrice: 69, baseWeight: 40, baseQuality: 72, procurementDays: 3 },
    { id: 'p5028', category: 'beauty', name: '洗手液抑菌泡沫500ml×2', basePrice: 39, baseWeight: 45, baseQuality: 68, procurementDays: 2 },
    { id: 'p5029', category: 'beauty', name: '洗衣凝珠持久留香50颗', basePrice: 59, baseWeight: 30, baseQuality: 70, procurementDays: 2 },
    { id: 'p5030', category: 'beauty', name: '变色唇膏温感口红', basePrice: 35, baseWeight: 6, baseQuality: 68, procurementDays: 2 },
    { id: 'p5031', category: 'beauty', name: '眼霜淡化细纹20g', basePrice: 199, baseWeight: 8, baseQuality: 80, procurementDays: 4 },
    { id: 'p5032', category: 'beauty', name: '面霜补水保湿50g', basePrice: 129, baseWeight: 15, baseQuality: 78, procurementDays: 4 },
    { id: 'p5033', category: 'beauty', name: '爽肤水收缩毛孔200ml', basePrice: 99, baseWeight: 25, baseQuality: 74, procurementDays: 3 },
    { id: 'p5034', category: 'beauty', name: '眼影盘大地色12色', basePrice: 79, baseWeight: 10, baseQuality: 74, procurementDays: 3 },
    { id: 'p5035', category: 'beauty', name: '腮红自然裸妆', basePrice: 59, baseWeight: 6, baseQuality: 72, procurementDays: 2 },
    { id: 'p5036', category: 'beauty', name: '粉底液持妆遮瑕', basePrice: 129, baseWeight: 12, baseQuality: 76, procurementDays: 4 },
    { id: 'p5037', category: 'beauty', name: '散粉定妆控油', basePrice: 89, baseWeight: 10, baseQuality: 74, procurementDays: 3 },
    { id: 'p5038', category: 'beauty', name: '睫毛膏浓密卷翘防水', basePrice: 69, baseWeight: 6, baseQuality: 72, procurementDays: 2 },
    { id: 'p5039', category: 'beauty', name: '眼线笔防水不晕染', basePrice: 49, baseWeight: 5, baseQuality: 70, procurementDays: 2 },
    { id: 'p5040', category: 'beauty', name: '指甲油套装12色', basePrice: 59, baseWeight: 12, baseQuality: 70, procurementDays: 2 },
    { id: 'p5041', category: 'beauty', name: '美甲灯UV光疗机', basePrice: 89, baseWeight: 25, baseQuality: 72, procurementDays: 3 },
    { id: 'p5042', category: 'beauty', name: '卷发棒陶瓷自动', basePrice: 129, baseWeight: 30, baseQuality: 74, procurementDays: 4 },
    { id: 'p5043', category: 'beauty', name: '直发梳负离子防烫', basePrice: 99, baseWeight: 25, baseQuality: 72, procurementDays: 3 },
    { id: 'p5044', category: 'beauty', name: '吹风机高速无刷大风力', basePrice: 199, baseWeight: 45, baseQuality: 78, procurementDays: 5 },
    { id: 'p5045', category: 'beauty', name: '美容仪导入提拉', basePrice: 899, baseWeight: 25, baseQuality: 84, procurementDays: 8 },
    { id: 'p5046', category: 'beauty', name: '脱毛仪家用冰点', basePrice: 999, baseWeight: 30, baseQuality: 84, procurementDays: 8 },
    { id: 'p5047', category: 'beauty', name: '剃须刀电动浮动三头', basePrice: 299, baseWeight: 20, baseQuality: 78, procurementDays: 5 },
    { id: 'p5048', category: 'beauty', name: '牙膏美白去渍120g×3', basePrice: 49, baseWeight: 25, baseQuality: 70, procurementDays: 2 },
    { id: 'p5049', category: 'beauty', name: '漱口水清新500ml×2', basePrice: 45, baseWeight: 50, baseQuality: 68, procurementDays: 2 },
    { id: 'p5050', category: 'beauty', name: '卫生巾日夜组合装', basePrice: 59, baseWeight: 30, baseQuality: 72, procurementDays: 2 },
    { id: 'p5051', category: 'beauty', name: '卫生棉条导管式16支', basePrice: 69, baseWeight: 10, baseQuality: 74, procurementDays: 3 },
    { id: 'p5052', category: 'beauty', name: '洗脸巾一次性加厚60抽', basePrice: 39, baseWeight: 20, baseQuality: 68, procurementDays: 2 },
    { id: 'p5053', category: 'beauty', name: '卸妆湿巾便携30片', basePrice: 29, baseWeight: 12, baseQuality: 66, procurementDays: 2 },

    // 家居家装（28个）
    { id: 'p6028', category: 'home', name: '厨房置物架落地多层', basePrice: 129, baseWeight: 45, baseQuality: 72, procurementDays: 4 },
    { id: 'p6029', category: 'home', name: '鞋架简易多层家用', basePrice: 79, baseWeight: 40, baseQuality: 68, procurementDays: 3 },
    { id: 'p6030', category: 'home', name: '衣帽架落地实木', basePrice: 139, baseWeight: 45, baseQuality: 72, procurementDays: 4 },
    { id: 'p6031', category: 'home', name: '床头柜简约带抽屉', basePrice: 199, baseWeight: 55, baseQuality: 72, procurementDays: 6 },
    { id: 'p6032', category: 'home', name: '书桌电脑桌简约', basePrice: 399, baseWeight: 80, baseQuality: 74, procurementDays: 7 },
    { id: 'p6033', category: 'home', name: '办公椅人体工学可躺', basePrice: 599, baseWeight: 85, baseQuality: 78, procurementDays: 7 },
    { id: 'p6034', category: 'home', name: '晾衣架折叠落地X型', basePrice: 89, baseWeight: 45, baseQuality: 68, procurementDays: 3 },
    { id: 'p6035', category: 'home', name: '电风扇落地静音遥控', basePrice: 159, baseWeight: 50, baseQuality: 74, procurementDays: 5 },
    { id: 'p6036', category: 'home', name: '电热毯单人双控调温', basePrice: 99, baseWeight: 40, baseQuality: 72, procurementDays: 4 },
    { id: 'p6037', category: 'home', name: '暖风机家用速热', basePrice: 149, baseWeight: 38, baseQuality: 74, procurementDays: 4 },
    { id: 'p6038', category: 'home', name: '保温壶家用大容量2L', basePrice: 99, baseWeight: 45, baseQuality: 72, procurementDays: 4 },
    { id: 'p6039', category: 'home', name: '茶具套装功夫茶具', basePrice: 189, baseWeight: 50, baseQuality: 76, procurementDays: 5 },
    { id: 'p6040', category: 'home', name: '餐具套装碗盘筷12件', basePrice: 159, baseWeight: 60, baseQuality: 72, procurementDays: 5 },
    { id: 'p6041', category: 'home', name: '磨刀器家用快速磨刀', basePrice: 39, baseWeight: 20, baseQuality: 66, procurementDays: 2 },
    { id: 'p6042', category: 'home', name: '调味罐套装玻璃', basePrice: 49, baseWeight: 35, baseQuality: 68, procurementDays: 3 },
    { id: 'p6043', category: 'home', name: '米桶防虫密封10kg', basePrice: 59, baseWeight: 35, baseQuality: 68, procurementDays: 3 },
    { id: 'p6044', category: 'home', name: '垃圾桶家用脚踏分类', basePrice: 69, baseWeight: 40, baseQuality: 68, procurementDays: 3 },
    { id: 'p6045', category: 'home', name: '拖把平板免手洗', basePrice: 69, baseWeight: 35, baseQuality: 68, procurementDays: 3 },
    { id: 'p6046', category: 'home', name: '马桶刷套装壁挂', basePrice: 29, baseWeight: 15, baseQuality: 62, procurementDays: 2 },
    { id: 'p6047', category: 'home', name: '花洒增压淋浴头', basePrice: 89, baseWeight: 20, baseQuality: 72, procurementDays: 3 },
    { id: 'p6048', category: 'home', name: '浴帘防水加厚', basePrice: 39, baseWeight: 25, baseQuality: 64, procurementDays: 2 },
    { id: 'p6049', category: 'home', name: '毛巾架免打孔太空铝', basePrice: 49, baseWeight: 25, baseQuality: 68, procurementDays: 3 },
    { id: 'p6050', category: 'home', name: '梳妆台化妆桌带灯', basePrice: 899, baseWeight: 85, baseQuality: 78, procurementDays: 9 },
    { id: 'p6051', category: 'home', name: '斗柜储物五层抽屉', basePrice: 699, baseWeight: 80, baseQuality: 74, procurementDays: 8 },
    { id: 'p6052', category: 'home', name: '屏风隔断玄关折叠', basePrice: 499, baseWeight: 70, baseQuality: 72, procurementDays: 7 },
    { id: 'p6053', category: 'home', name: '挂钟客厅静音简约', basePrice: 99, baseWeight: 30, baseQuality: 70, procurementDays: 3 },
    { id: 'p6054', category: 'home', name: '绿萝盆栽室内净化', basePrice: 39, baseWeight: 45, baseQuality: 66, procurementDays: 2 },
    { id: 'p6055', category: 'home', name: '多肉植物组合盆', basePrice: 49, baseWeight: 35, baseQuality: 66, procurementDays: 2 },

    // 户外文娱（28个）
    { id: 'p7023', category: 'outdoor', name: '篮球7号室内外通用', basePrice: 129, baseWeight: 35, baseQuality: 72, procurementDays: 3 },
    { id: 'p7024', category: 'outdoor', name: '排球5号软式训练', basePrice: 99, baseWeight: 30, baseQuality: 70, procurementDays: 3 },
    { id: 'p7025', category: 'outdoor', name: '网球拍入门碳素', basePrice: 199, baseWeight: 30, baseQuality: 74, procurementDays: 4 },
    { id: 'p7026', category: 'outdoor', name: '乒乓球网架便携', basePrice: 39, baseWeight: 20, baseQuality: 62, procurementDays: 2 },
    { id: 'p7027', category: 'outdoor', name: '飞镖盘磁性安全', basePrice: 59, baseWeight: 25, baseQuality: 68, procurementDays: 2 },
    { id: 'p7028', category: 'outdoor', name: '轮滑鞋成人可调', basePrice: 299, baseWeight: 45, baseQuality: 76, procurementDays: 5 },
    { id: 'p7029', category: 'outdoor', name: '儿童平衡车无脚踏', basePrice: 259, baseWeight: 40, baseQuality: 74, procurementDays: 5 },
    { id: 'p7030', category: 'outdoor', name: '自行车头盔骑行', basePrice: 129, baseWeight: 28, baseQuality: 74, procurementDays: 3 },
    { id: 'p7031', category: 'outdoor', name: '骑行手套半指减震', basePrice: 49, baseWeight: 10, baseQuality: 68, procurementDays: 2 },
    { id: 'p7032', category: 'outdoor', name: '跑步腰包防水贴身', basePrice: 39, baseWeight: 10, baseQuality: 66, procurementDays: 2 },
    { id: 'p7033', category: 'outdoor', name: '运动护膝篮球跑步', basePrice: 49, baseWeight: 12, baseQuality: 70, procurementDays: 2 },
    { id: 'p7034', category: 'outdoor', name: '拉力绳套装弹力带', basePrice: 39, baseWeight: 15, baseQuality: 66, procurementDays: 2 },
    { id: 'p7035', category: 'outdoor', name: '健腹轮自动回弹', basePrice: 59, baseWeight: 20, baseQuality: 70, procurementDays: 2 },
    { id: 'p7036', category: 'outdoor', name: '瑜伽球加厚防爆65cm', basePrice: 69, baseWeight: 25, baseQuality: 70, procurementDays: 3 },
    { id: 'p7037', category: 'outdoor', name: '泡沫轴按摩放松', basePrice: 49, baseWeight: 20, baseQuality: 68, procurementDays: 2 },
    { id: 'p7038', category: 'outdoor', name: '动感单车家用静音', basePrice: 1299, baseWeight: 85, baseQuality: 82, procurementDays: 10 },
    { id: 'p7039', category: 'outdoor', name: '跑步机家用折叠', basePrice: 1999, baseWeight: 90, baseQuality: 84, procurementDays: 12 },
    { id: 'p7040', category: 'outdoor', name: '划船机家用磁控', basePrice: 1599, baseWeight: 80, baseQuality: 82, procurementDays: 11 },
    { id: 'p7041', category: 'outdoor', name: '台钓竿碳素超轻', basePrice: 199, baseWeight: 25, baseQuality: 76, procurementDays: 4 },
    { id: 'p7042', category: 'outdoor', name: '路亚套装假饵组合', basePrice: 99, baseWeight: 20, baseQuality: 70, procurementDays: 3 },
    { id: 'p7043', category: 'outdoor', name: '浮潜面镜呼吸管套装', basePrice: 159, baseWeight: 30, baseQuality: 74, procurementDays: 4 },
    { id: 'p7044', category: 'outdoor', name: '泳圈成人加厚', basePrice: 49, baseWeight: 20, baseQuality: 66, procurementDays: 2 },
    { id: 'p7045', category: 'outdoor', name: '充气床户外露营加厚', basePrice: 189, baseWeight: 45, baseQuality: 72, procurementDays: 4 },
    { id: 'p7046', category: 'outdoor', name: '露营灯充电式超亮', basePrice: 89, baseWeight: 25, baseQuality: 72, procurementDays: 3 },
    { id: 'p7047', category: 'outdoor', name: '保温箱户外冷藏箱30L', basePrice: 199, baseWeight: 45, baseQuality: 74, procurementDays: 4 },
    { id: 'p7048', category: 'outdoor', name: '望远镜高清双筒', basePrice: 299, baseWeight: 35, baseQuality: 78, procurementDays: 5 },
    { id: 'p7049', category: 'outdoor', name: '天文望远镜入门级', basePrice: 699, baseWeight: 65, baseQuality: 80, procurementDays: 7 },
    { id: 'p7050', category: 'outdoor', name: '风筝成人大型软体', basePrice: 59, baseWeight: 30, baseQuality: 66, procurementDays: 2 },

    // ============== 二扩商品库（200个，7大品类） ==============
    // 日用百货（29个）
    { id: 'p1060', category: 'daily', name: '不锈钢筷子家用10双装', basePrice: 22, baseWeight: 20, baseQuality: 64, procurementDays: 2 },
    { id: 'p1061', category: 'daily', name: '硅胶锅铲不粘锅专用套装', basePrice: 39, baseWeight: 18, baseQuality: 68, procurementDays: 2 },
    { id: 'p1062', category: 'daily', name: '厨房置物篮水槽沥水架', basePrice: 45, baseWeight: 32, baseQuality: 66, procurementDays: 3 },
    { id: 'p1063', category: 'daily', name: '旋转调料架不锈钢两层', basePrice: 59, baseWeight: 38, baseQuality: 70, procurementDays: 3 },
    { id: 'p1064', category: 'daily', name: '真空保鲜袋抽气泵套装', basePrice: 69, baseWeight: 24, baseQuality: 72, procurementDays: 3 },
    { id: 'p1065', category: 'daily', name: '家用灭蚊灯静音吸入式', basePrice: 89, baseWeight: 28, baseQuality: 72, procurementDays: 4 },
    { id: 'p1066', category: 'daily', name: '粘毛器滚筒替换装10卷', basePrice: 29, baseWeight: 20, baseQuality: 62, procurementDays: 2 },
    { id: 'p1067', category: 'daily', name: '桌面迷你吸尘器无线', basePrice: 79, baseWeight: 22, baseQuality: 70, procurementDays: 3 },
    { id: 'p1068', category: 'daily', name: '马桶清洁泡腾片48粒', basePrice: 32, baseWeight: 26, baseQuality: 64, procurementDays: 2 },
    { id: 'p1069', category: 'daily', name: '管道疏通剂强力500g×2', basePrice: 36, baseWeight: 40, baseQuality: 66, procurementDays: 2 },
    { id: 'p1070', category: 'daily', name: '多功能螺丝刀套装32件', basePrice: 49, baseWeight: 28, baseQuality: 68, procurementDays: 3 },
    { id: 'p1071', category: 'daily', name: '家用急救包车载便携', basePrice: 59, baseWeight: 24, baseQuality: 74, procurementDays: 3 },
    { id: 'p1072', category: 'daily', name: '电子体重秤精准充电', basePrice: 69, baseWeight: 30, baseQuality: 70, procurementDays: 3 },
    { id: 'p1073', category: 'daily', name: '蒸汽清洁机高温除垢', basePrice: 199, baseWeight: 48, baseQuality: 76, procurementDays: 6 },
    { id: 'p1074', category: 'daily', name: '衣物护理机除皱除味', basePrice: 259, baseWeight: 42, baseQuality: 76, procurementDays: 6 },
    { id: 'p1075', category: 'daily', name: '婴儿奶瓶消毒柜紫外线', basePrice: 229, baseWeight: 45, baseQuality: 80, procurementDays: 6 },
    { id: 'p1076', category: 'daily', name: '儿童学饮杯防漏吸管', basePrice: 45, baseWeight: 16, baseQuality: 72, procurementDays: 3 },
    { id: 'p1077', category: 'daily', name: '孕妇枕侧睡托腹靠枕', basePrice: 129, baseWeight: 55, baseQuality: 74, procurementDays: 5 },
    { id: 'p1078', category: 'daily', name: '宠物指甲剪磨甲器套装', basePrice: 35, baseWeight: 10, baseQuality: 66, procurementDays: 2 },
    { id: 'p1079', category: 'daily', name: '猫玩具逗猫棒羽毛套装', basePrice: 29, baseWeight: 12, baseQuality: 64, procurementDays: 2 },
    { id: 'p1080', category: 'daily', name: '狗狗雨衣反光四脚衣', basePrice: 49, baseWeight: 18, baseQuality: 68, procurementDays: 3 },
    { id: 'p1081', category: 'daily', name: '车载香薰出风口固体膏', basePrice: 39, baseWeight: 10, baseQuality: 66, procurementDays: 2 },
    { id: 'p1082', category: 'daily', name: '汽车脚垫全包围绒面', basePrice: 159, baseWeight: 58, baseQuality: 72, procurementDays: 5 },
    { id: 'p1083', category: 'daily', name: '后备箱收纳箱折叠箱', basePrice: 69, baseWeight: 35, baseQuality: 68, procurementDays: 3 },
    { id: 'p1084', category: 'daily', name: 'A4复印纸70g整箱5包', basePrice: 89, baseWeight: 80, baseQuality: 66, procurementDays: 3 },
    { id: 'p1085', category: 'daily', name: '中性笔0.5黑蓝红30支', basePrice: 25, baseWeight: 16, baseQuality: 62, procurementDays: 2 },
    { id: 'p1086', category: 'daily', name: '订书机省力订书钉套装', basePrice: 28, baseWeight: 18, baseQuality: 64, procurementDays: 2 },
    { id: 'p1087', category: 'daily', name: '桌面文件架多层金属', basePrice: 55, baseWeight: 32, baseQuality: 68, procurementDays: 3 },
    { id: 'p1088', category: 'daily', name: '雨伞架门口沥水收纳', basePrice: 49, baseWeight: 28, baseQuality: 66, procurementDays: 3 },

    // 数码家电（29个）
    { id: 'p2062', category: 'digital', name: 'Type-C转HDMI投屏线', basePrice: 49, baseWeight: 10, baseQuality: 68, procurementDays: 2 },
    { id: 'p2063', category: 'digital', name: '手机防水袋潜水触控', basePrice: 29, baseWeight: 8, baseQuality: 64, procurementDays: 1 },
    { id: 'p2064', category: 'digital', name: '磁吸车载无线充15W', basePrice: 99, baseWeight: 18, baseQuality: 74, procurementDays: 3 },
    { id: 'p2065', category: 'digital', name: '头戴降噪耳机蓝牙5.3', basePrice: 259, baseWeight: 28, baseQuality: 80, procurementDays: 5 },
    { id: 'p2066', category: 'digital', name: '骨传导运动耳机防水', basePrice: 199, baseWeight: 14, baseQuality: 76, procurementDays: 4 },
    { id: 'p2067', category: 'digital', name: '平板保护套带笔槽11寸', basePrice: 69, baseWeight: 16, baseQuality: 68, procurementDays: 2 },
    { id: 'p2068', category: 'digital', name: '电容笔触控压感手写笔', basePrice: 89, baseWeight: 8, baseQuality: 74, procurementDays: 3 },
    { id: 'p2069', category: 'digital', name: '笔记本支架铝合金升降', basePrice: 119, baseWeight: 32, baseQuality: 74, procurementDays: 4 },
    { id: 'p2070', category: 'digital', name: '机械轴键盘矮轴办公', basePrice: 229, baseWeight: 40, baseQuality: 78, procurementDays: 5 },
    { id: 'p2071', category: 'digital', name: '游戏鼠标宏编程RGB', basePrice: 149, baseWeight: 16, baseQuality: 76, procurementDays: 4 },
    { id: 'p2072', category: 'digital', name: '摄像头带麦1080P直播', basePrice: 129, baseWeight: 18, baseQuality: 74, procurementDays: 4 },
    { id: 'p2073', category: 'digital', name: 'USB麦克风防喷罩套装', basePrice: 159, baseWeight: 22, baseQuality: 76, procurementDays: 4 },
    { id: 'p2074', category: 'digital', name: '读卡器多合一高速传输', basePrice: 39, baseWeight: 6, baseQuality: 66, procurementDays: 2 },
    { id: 'p2075', category: 'digital', name: '内存卡128G高速存储卡', basePrice: 79, baseWeight: 4, baseQuality: 74, procurementDays: 2 },
    { id: 'p2076', category: 'digital', name: '千兆交换机5口分流器', basePrice: 89, baseWeight: 20, baseQuality: 72, procurementDays: 3 },
    { id: 'p2077', category: 'digital', name: 'Mesh子母路由器套装', basePrice: 399, baseWeight: 38, baseQuality: 80, procurementDays: 6 },
    { id: 'p2078', category: 'digital', name: '智能窗帘电机开合套装', basePrice: 459, baseWeight: 42, baseQuality: 80, procurementDays: 7 },
    { id: 'p2079', category: 'digital', name: 'VR眼镜一体机体感游戏', basePrice: 1299, baseWeight: 48, baseQuality: 84, procurementDays: 9 },
    { id: 'p2080', category: 'digital', name: '数位板手绘入门套装', basePrice: 349, baseWeight: 26, baseQuality: 78, procurementDays: 5 },
    { id: 'p2081', category: 'digital', name: '运动相机配件自拍套装', basePrice: 199, baseWeight: 22, baseQuality: 74, procurementDays: 4 },
    { id: 'p2082', category: 'digital', name: '儿童电话手表4G定位', basePrice: 299, baseWeight: 14, baseQuality: 78, procurementDays: 5 },
    { id: 'p2083', category: 'digital', name: '学习机小学同步辅导', basePrice: 1599, baseWeight: 40, baseQuality: 82, procurementDays: 8 },
    { id: 'p2084', category: 'digital', name: '回音壁家庭影院蓝牙', basePrice: 699, baseWeight: 55, baseQuality: 80, procurementDays: 7 },
    { id: 'p2085', category: 'digital', name: '激光投影仪100寸巨幕', basePrice: 2499, baseWeight: 62, baseQuality: 86, procurementDays: 12 },
    { id: 'p2086', category: 'digital', name: '智能猫眼可视门铃一体', basePrice: 399, baseWeight: 28, baseQuality: 78, procurementDays: 6 },
    { id: 'p2087', category: 'digital', name: '机箱风扇ARGB套装3把', basePrice: 129, baseWeight: 24, baseQuality: 72, procurementDays: 4 },
    { id: 'p2088', category: 'digital', name: '笔记本散热器支架风扇', basePrice: 89, baseWeight: 30, baseQuality: 70, procurementDays: 3 },
    { id: 'p2089', category: 'digital', name: '有线耳机入耳K歌监听', basePrice: 59, baseWeight: 10, baseQuality: 68, procurementDays: 2 },
    { id: 'p2090', category: 'digital', name: 'AR智能眼镜轻量显示', basePrice: 1899, baseWeight: 18, baseQuality: 86, procurementDays: 10 },

    // 服饰箱包（29个）
    { id: 'p3057', category: 'clothing', name: '纯棉长袖衬衫男免烫', basePrice: 149, baseWeight: 26, baseQuality: 74, procurementDays: 4 },
    { id: 'p3058', category: 'clothing', name: '针织衫女圆领打底毛衣', basePrice: 129, baseWeight: 24, baseQuality: 74, procurementDays: 4 },
    { id: 'p3059', category: 'clothing', name: '真皮皮衣男头层牛皮夹克', basePrice: 899, baseWeight: 48, baseQuality: 84, procurementDays: 8 },
    { id: 'p3060', category: 'clothing', name: '双面呢大衣女中长羊毛', basePrice: 699, baseWeight: 50, baseQuality: 82, procurementDays: 7 },
    { id: 'p3061', category: 'clothing', name: '汉服女马面裙日常款', basePrice: 259, baseWeight: 32, baseQuality: 76, procurementDays: 5 },
    { id: 'p3062', category: 'clothing', name: '旗袍女改良日常连衣裙', basePrice: 229, baseWeight: 26, baseQuality: 78, procurementDays: 5 },
    { id: 'p3063', category: 'clothing', name: '西装套装女职业两件套', basePrice: 459, baseWeight: 40, baseQuality: 80, procurementDays: 6 },
    { id: 'p3064', category: 'clothing', name: '休闲皮鞋男软底英伦', basePrice: 259, baseWeight: 40, baseQuality: 76, procurementDays: 5 },
    { id: 'p3065', category: 'clothing', name: '高跟鞋女细跟防水台', basePrice: 199, baseWeight: 28, baseQuality: 74, procurementDays: 4 },
    { id: 'p3066', category: 'clothing', name: '过膝长靴女高筒显瘦', basePrice: 329, baseWeight: 48, baseQuality: 76, procurementDays: 5 },
    { id: 'p3067', category: 'clothing', name: '商务公文包男真皮手提', basePrice: 399, baseWeight: 32, baseQuality: 80, procurementDays: 5 },
    { id: 'p3068', category: 'clothing', name: '登机箱20寸铝框拉杆箱', basePrice: 359, baseWeight: 55, baseQuality: 78, procurementDays: 6 },
    { id: 'p3069', category: 'clothing', name: '银手镯女999足银开口', basePrice: 189, baseWeight: 8, baseQuality: 82, procurementDays: 4 },
    { id: 'p3070', category: 'clothing', name: '黄金素圈戒指足金细戒', basePrice: 899, baseWeight: 4, baseQuality: 88, procurementDays: 6 },
    { id: 'p3071', category: 'clothing', name: '情侣对戒925银一对', basePrice: 159, baseWeight: 5, baseQuality: 78, procurementDays: 4 },
    { id: 'p3072', category: 'clothing', name: '儿童棉服女童加厚外套', basePrice: 189, baseWeight: 32, baseQuality: 74, procurementDays: 4 },
    { id: 'p3073', category: 'clothing', name: 'JK格裙水手服套装', basePrice: 169, baseWeight: 22, baseQuality: 72, procurementDays: 4 },
    { id: 'p3074', category: 'clothing', name: '羊绒围巾男冬季商务', basePrice: 199, baseWeight: 16, baseQuality: 80, procurementDays: 4 },
    { id: 'p3075', category: 'clothing', name: '真丝方巾女桑蚕丝印花', basePrice: 129, baseWeight: 8, baseQuality: 80, procurementDays: 3 },
    { id: 'p3076', category: 'clothing', name: '增高运动鞋男老爹鞋', basePrice: 229, baseWeight: 40, baseQuality: 74, procurementDays: 5 },
    { id: 'p3077', category: 'clothing', name: '棉鞋女冬季加绒保暖', basePrice: 159, baseWeight: 36, baseQuality: 72, procurementDays: 4 },
    { id: 'p3078', category: 'clothing', name: '皮带女细腰带装饰百搭', basePrice: 59, baseWeight: 10, baseQuality: 68, procurementDays: 2 },
    { id: 'p3079', category: 'clothing', name: '手套女触屏加绒保暖', basePrice: 49, baseWeight: 10, baseQuality: 68, procurementDays: 2 },
    { id: 'p3080', category: 'clothing', name: '耳钉女纯银简约小巧', basePrice: 69, baseWeight: 3, baseQuality: 76, procurementDays: 3 },
    { id: 'p3081', category: 'clothing', name: '发箍女宽边高级感发卡', basePrice: 35, baseWeight: 6, baseQuality: 66, procurementDays: 2 },
    { id: 'p3082', category: 'clothing', name: '男士商务正装皮鞋系带', basePrice: 299, baseWeight: 42, baseQuality: 78, procurementDays: 5 },
    { id: 'p3083', category: 'clothing', name: '女士手提包头层牛皮', basePrice: 459, baseWeight: 28, baseQuality: 82, procurementDays: 6 },
    { id: 'p3084', category: 'clothing', name: '儿童书包护脊减负双肩', basePrice: 149, baseWeight: 30, baseQuality: 74, procurementDays: 4 },
    { id: 'p3085', category: 'clothing', name: '婚纱礼服新娘轻婚纱', basePrice: 1299, baseWeight: 45, baseQuality: 86, procurementDays: 10 },

    // 食品生鲜（29个）
    { id: 'p4055', category: 'food', name: '铁观音安溪浓香250g', basePrice: 128, baseWeight: 22, baseQuality: 82, procurementDays: 4 },
    { id: 'p4056', category: 'food', name: '大红袍武夷岩茶肉桂', basePrice: 168, baseWeight: 20, baseQuality: 84, procurementDays: 4 },
    { id: 'p4057', category: 'food', name: '福鼎白茶白毫银针100g', basePrice: 199, baseWeight: 14, baseQuality: 86, procurementDays: 5 },
    { id: 'p4058', category: 'food', name: '碧螺春明前新茶特级', basePrice: 188, baseWeight: 16, baseQuality: 84, procurementDays: 4 },
    { id: 'p4059', category: 'food', name: '雀巢速溶咖啡100条', basePrice: 69, baseWeight: 32, baseQuality: 68, procurementDays: 2 },
    { id: 'p4060', category: 'food', name: '胶囊咖啡兼容套装50粒', basePrice: 99, baseWeight: 24, baseQuality: 74, procurementDays: 3 },
    { id: 'p4061', category: 'food', name: '耶加雪菲手冲咖啡豆227g', basePrice: 119, baseWeight: 18, baseQuality: 80, procurementDays: 4 },
    { id: 'p4062', category: 'food', name: '汾酒青花20年53度500ml', basePrice: 599, baseWeight: 36, baseQuality: 88, procurementDays: 6 },
    { id: 'p4063', category: 'food', name: '牛栏山二锅头500ml×12', basePrice: 129, baseWeight: 85, baseQuality: 70, procurementDays: 4 },
    { id: 'p4064', category: 'food', name: '张裕干红解百纳750ml', basePrice: 89, baseWeight: 32, baseQuality: 74, procurementDays: 4 },
    { id: 'p4065', category: 'food', name: '德国精酿白啤500ml×6', basePrice: 79, baseWeight: 72, baseQuality: 74, procurementDays: 3 },
    { id: 'p4066', category: 'food', name: '清酒纯米大吟酿720ml', basePrice: 259, baseWeight: 30, baseQuality: 82, procurementDays: 5 },
    { id: 'p4067', category: 'food', name: '威士忌苏格兰调和700ml', basePrice: 199, baseWeight: 32, baseQuality: 80, procurementDays: 5 },
    { id: 'p4068', category: 'food', name: '三只松鼠坚果年货礼盒', basePrice: 129, baseWeight: 50, baseQuality: 76, procurementDays: 3 },
    { id: 'p4069', category: 'food', name: '西洋参片花旗参100g', basePrice: 159, baseWeight: 12, baseQuality: 82, procurementDays: 5 },
    { id: 'p4070', category: 'food', name: '阿胶块东阿驴皮125g', basePrice: 199, baseWeight: 18, baseQuality: 84, procurementDays: 5 },
    { id: 'p4071', category: 'food', name: '铁皮石斛枫斗50g礼盒', basePrice: 299, baseWeight: 14, baseQuality: 86, procurementDays: 6 },
    { id: 'p4072', category: 'food', name: '即食燕窝鲜炖70ml×6', basePrice: 399, baseWeight: 28, baseQuality: 86, procurementDays: 6 },
    { id: 'p4073', category: 'food', name: '五常稻花香大米5kg', basePrice: 79, baseWeight: 86, baseQuality: 76, procurementDays: 3 },
    { id: 'p4074', category: 'food', name: '拉面日式豚骨3人份', basePrice: 45, baseWeight: 40, baseQuality: 68, procurementDays: 2 },
    { id: 'p4075', category: 'food', name: '黑巧克力85%可可排块', basePrice: 49, baseWeight: 16, baseQuality: 76, procurementDays: 3 },
    { id: 'p4076', category: 'food', name: '进口车厘子JJJ级1斤', basePrice: 89, baseWeight: 28, baseQuality: 78, procurementDays: 2 },
    { id: 'p4077', category: 'food', name: '冷冻虾仁去虾线400g', basePrice: 69, baseWeight: 32, baseQuality: 74, procurementDays: 3 },
    { id: 'p4078', category: 'food', name: '原切牛腱肉熟食即食', basePrice: 79, baseWeight: 26, baseQuality: 74, procurementDays: 3 },
    { id: 'p4079', category: 'food', name: '有机蔬菜沙拉混合250g', basePrice: 29, baseWeight: 22, baseQuality: 70, procurementDays: 1 },
    { id: 'p4080', category: 'food', name: '低脂鸡胸肉即食8袋', basePrice: 59, baseWeight: 40, baseQuality: 72, procurementDays: 2 },
    { id: 'p4081', category: 'food', name: '蛋白棒代餐能量12支', basePrice: 79, baseWeight: 24, baseQuality: 74, procurementDays: 3 },
    { id: 'p4082', category: 'food', name: '无糖苏打气泡水12罐', basePrice: 39, baseWeight: 70, baseQuality: 66, procurementDays: 2 },
    { id: 'p4083', category: 'food', name: '鲜榨橙汁NFC1L×6盒', basePrice: 89, baseWeight: 68, baseQuality: 74, procurementDays: 3 },

    // 美妆个护（28个）
    { id: 'p5054', category: 'beauty', name: '男士护肤水乳霜三件套', basePrice: 169, baseWeight: 32, baseQuality: 76, procurementDays: 4 },
    { id: 'p5055', category: 'beauty', name: '氨基酸洁面泡沫150ml', basePrice: 69, baseWeight: 18, baseQuality: 74, procurementDays: 3 },
    { id: 'p5056', category: 'beauty', name: '烟酰胺身体乳焕亮400ml', basePrice: 79, baseWeight: 34, baseQuality: 74, procurementDays: 3 },
    { id: 'p5057', category: 'beauty', name: '防脱洗发水固发500ml', basePrice: 99, baseWeight: 36, baseQuality: 76, procurementDays: 3 },
    { id: 'p5058', category: 'beauty', name: '鱼子酱发膜修护250ml', basePrice: 89, baseWeight: 28, baseQuality: 76, procurementDays: 3 },
    { id: 'p5059', category: 'beauty', name: '花漾甜心女士淡香水50ml', basePrice: 329, baseWeight: 16, baseQuality: 84, procurementDays: 5 },
    { id: 'p5060', category: 'beauty', name: '男士蔚蓝古龙香水100ml', basePrice: 459, baseWeight: 22, baseQuality: 86, procurementDays: 6 },
    { id: 'p5061', category: 'beauty', name: '气垫粉底替换芯两只', basePrice: 89, baseWeight: 10, baseQuality: 74, procurementDays: 3 },
    { id: 'p5062', category: 'beauty', name: '修容高光盘两色一体', basePrice: 79, baseWeight: 8, baseQuality: 74, procurementDays: 3 },
    { id: 'p5063', category: 'beauty', name: '唇釉镜面水光不易掉色', basePrice: 69, baseWeight: 6, baseQuality: 74, procurementDays: 2 },
    { id: 'p5064', category: 'beauty', name: '美瞳日抛自然棕30片', basePrice: 89, baseWeight: 8, baseQuality: 76, procurementDays: 3 },
    { id: 'p5065', category: 'beauty', name: '防蓝光眼镜框平光镜', basePrice: 79, baseWeight: 12, baseQuality: 70, procurementDays: 3 },
    { id: 'p5066', category: 'beauty', name: '声波电动牙刷情侣款', basePrice: 199, baseWeight: 22, baseQuality: 78, procurementDays: 4 },
    { id: 'p5067', category: 'beauty', name: '抗敏感牙膏舒适达120g', basePrice: 45, baseWeight: 16, baseQuality: 72, procurementDays: 2 },
    { id: 'p5068', category: 'beauty', name: '电动剃须刀三刀头浮动', basePrice: 259, baseWeight: 22, baseQuality: 78, procurementDays: 5 },
    { id: 'p5069', category: 'beauty', name: '直板夹负离子不伤发', basePrice: 129, baseWeight: 24, baseQuality: 74, procurementDays: 4 },
    { id: 'p5070', category: 'beauty', name: '自动卷发棒大卷羊毛卷', basePrice: 159, baseWeight: 26, baseQuality: 74, procurementDays: 4 },
    { id: 'p5071', category: 'beauty', name: '鼻毛修剪器电动充电', basePrice: 59, baseWeight: 10, baseQuality: 70, procurementDays: 2 },
    { id: 'p5072', category: 'beauty', name: '修眉刀安全型20支装', basePrice: 19, baseWeight: 6, baseQuality: 64, procurementDays: 1 },
    { id: 'p5073', category: 'beauty', name: '化妆刷套装12支软毛', basePrice: 79, baseWeight: 14, baseQuality: 72, procurementDays: 3 },
    { id: 'p5074', category: 'beauty', name: '美妆蛋不吃粉4个装', basePrice: 29, baseWeight: 8, baseQuality: 68, procurementDays: 2 },
    { id: 'p5075', category: 'beauty', name: '防晒霜男士户外SPF50', basePrice: 89, baseWeight: 16, baseQuality: 76, procurementDays: 3 },
    { id: 'p5076', category: 'beauty', name: '补水面膜睡眠免洗10片', basePrice: 59, baseWeight: 20, baseQuality: 74, procurementDays: 3 },
    { id: 'p5077', category: 'beauty', name: '眼贴膜淡化黑眼圈20对', basePrice: 49, baseWeight: 12, baseQuality: 72, procurementDays: 2 },
    { id: 'p5078', category: 'beauty', name: '护手霜乳木果30g×5', basePrice: 45, baseWeight: 14, baseQuality: 70, procurementDays: 2 },
    { id: 'p5079', category: 'beauty', name: '止汗露走珠男女50ml', basePrice: 39, baseWeight: 12, baseQuality: 68, procurementDays: 2 },
    { id: 'p5080', category: 'beauty', name: '私处护理洗液温和200ml', basePrice: 49, baseWeight: 22, baseQuality: 72, procurementDays: 3 },
    { id: 'p5081', category: 'beauty', name: '压缩面膜纸蚕丝100粒', basePrice: 25, baseWeight: 10, baseQuality: 64, procurementDays: 2 },

    // 家居家装（28个）
    { id: 'p6056', category: 'home', name: '嵌入式洗碗机全自动除菌', basePrice: 2499, baseWeight: 88, baseQuality: 84, procurementDays: 12 },
    { id: 'p6057', category: 'home', name: '燃气热水器16升零冷水', basePrice: 1699, baseWeight: 70, baseQuality: 84, procurementDays: 10 },
    { id: 'p6058', category: 'home', name: '顶侧双吸抽油烟机静音', basePrice: 1899, baseWeight: 82, baseQuality: 82, procurementDays: 10 },
    { id: 'p6059', category: 'home', name: '集成灶蒸烤一体环保灶', basePrice: 3999, baseWeight: 92, baseQuality: 86, procurementDays: 15 },
    { id: 'p6060', category: 'home', name: '滚筒洗烘套装热泵烘干', basePrice: 4599, baseWeight: 90, baseQuality: 86, procurementDays: 14 },
    { id: 'p6061', category: 'home', name: '柜机空调3匹一级变频', basePrice: 4299, baseWeight: 90, baseQuality: 86, procurementDays: 14 },
    { id: 'p6062', category: 'home', name: '65英寸4K高刷智能电视', basePrice: 2799, baseWeight: 86, baseQuality: 84, procurementDays: 12 },
    { id: 'p6063', category: 'home', name: '智能马桶一体机虹吸', basePrice: 2199, baseWeight: 75, baseQuality: 84, procurementDays: 11 },
    { id: 'p6064', category: 'home', name: '恒温花洒全铜淋雨套装', basePrice: 599, baseWeight: 48, baseQuality: 80, procurementDays: 7 },
    { id: 'p6065', category: 'home', name: '浴室柜洗手洗脸盆一体', basePrice: 1299, baseWeight: 80, baseQuality: 78, procurementDays: 10 },
    { id: 'p6066', category: 'home', name: '电动升降智能晾衣架', basePrice: 899, baseWeight: 55, baseQuality: 78, procurementDays: 8 },
    { id: 'p6067', category: 'home', name: '强化复合地板12mm耐磨', basePrice: 89, baseWeight: 70, baseQuality: 74, procurementDays: 6 },
    { id: 'p6068', category: 'home', name: '通体大理石瓷砖800×800', basePrice: 79, baseWeight: 85, baseQuality: 74, procurementDays: 6 },
    { id: 'p6069', category: 'home', name: '乳胶漆自刷白色18L', basePrice: 199, baseWeight: 78, baseQuality: 72, procurementDays: 5 },
    { id: 'p6070', category: 'home', name: '实木复合门卧室烤漆门', basePrice: 1299, baseWeight: 88, baseQuality: 78, procurementDays: 12 },
    { id: 'p6071', category: 'home', name: '风暖浴霸五合一集成', basePrice: 399, baseWeight: 42, baseQuality: 76, procurementDays: 6 },
    { id: 'p6072', category: 'home', name: '冲击钻家用多功能套装', basePrice: 229, baseWeight: 50, baseQuality: 74, procurementDays: 5 },
    { id: 'p6073', category: 'home', name: '电动螺丝刀充电式套装', basePrice: 99, baseWeight: 22, baseQuality: 72, procurementDays: 3 },
    { id: 'p6074', category: 'home', name: '五金工具箱家用维修80件', basePrice: 189, baseWeight: 62, baseQuality: 74, procurementDays: 4 },
    { id: 'p6075', category: 'home', name: '北欧落地灯客厅阅读灯', basePrice: 259, baseWeight: 38, baseQuality: 74, procurementDays: 5 },
    { id: 'p6076', category: 'home', name: '乳胶床垫薄垫5cm可折叠', basePrice: 399, baseWeight: 70, baseQuality: 78, procurementDays: 7 },
    { id: 'p6077', category: 'home', name: '记忆棉坐垫办公室椅垫', basePrice: 69, baseWeight: 22, baseQuality: 70, procurementDays: 3 },
    { id: 'p6078', category: 'home', name: '遮光窗帘轨道电动开合', basePrice: 459, baseWeight: 48, baseQuality: 76, procurementDays: 6 },
    { id: 'p6079', category: 'home', name: '陶瓷花瓶干花插花套装', basePrice: 79, baseWeight: 30, baseQuality: 72, procurementDays: 4 },
    { id: 'p6080', category: 'home', name: '玄关换鞋凳带储物', basePrice: 229, baseWeight: 55, baseQuality: 72, procurementDays: 6 },
    { id: 'p6081', category: 'home', name: '儿童学习桌椅可升降', basePrice: 699, baseWeight: 78, baseQuality: 76, procurementDays: 8 },
    { id: 'p6082', category: 'home', name: '加湿器落地大容量4L', basePrice: 169, baseWeight: 36, baseQuality: 74, procurementDays: 4 },
    { id: 'p6083', category: 'home', name: '空气净化器滤芯原装', basePrice: 129, baseWeight: 20, baseQuality: 74, procurementDays: 4 },

    // 户外文娱（28个）
    { id: 'p7051', category: 'outdoor', name: '民谣吉他单板41寸初学', basePrice: 699, baseWeight: 58, baseQuality: 80, procurementDays: 7 },
    { id: 'p7052', category: 'outdoor', name: '电吉他双摇入门套装', basePrice: 899, baseWeight: 60, baseQuality: 80, procurementDays: 8 },
    { id: 'p7053', category: 'outdoor', name: '电钢琴88键重锤便携', basePrice: 1599, baseWeight: 75, baseQuality: 84, procurementDays: 10 },
    { id: 'p7054', category: 'outdoor', name: '小提琴手工实木4/4', basePrice: 599, baseWeight: 32, baseQuality: 80, procurementDays: 7 },
    { id: 'p7055', category: 'outdoor', name: '古筝桐木素面163cm', basePrice: 1299, baseWeight: 80, baseQuality: 82, procurementDays: 10 },
    { id: 'p7056', category: 'outdoor', name: '二胡小叶紫檀专业级', basePrice: 799, baseWeight: 28, baseQuality: 82, procurementDays: 8 },
    { id: 'p7057', category: 'outdoor', name: '全自动麻将机过山车', basePrice: 2999, baseWeight: 92, baseQuality: 82, procurementDays: 14 },
    { id: 'p7058', category: 'outdoor', name: '手搓麻将牌象牙色家用', basePrice: 129, baseWeight: 40, baseQuality: 72, procurementDays: 3 },
    { id: 'p7059', category: 'outdoor', name: '实木象棋大号棋盘套装', basePrice: 79, baseWeight: 28, baseQuality: 70, procurementDays: 3 },
    { id: 'p7060', category: 'outdoor', name: '围棋五子棋双面棋盘', basePrice: 89, baseWeight: 30, baseQuality: 72, procurementDays: 3 },
    { id: 'p7061', category: 'outdoor', name: '扑克牌塑料防水10副', basePrice: 29, baseWeight: 16, baseQuality: 64, procurementDays: 1 },
    { id: 'p7062', category: 'outdoor', name: '速开帐篷3-4人防雨加厚', basePrice: 399, baseWeight: 68, baseQuality: 78, procurementDays: 6 },
    { id: 'p7063', category: 'outdoor', name: '蛋卷桌折叠露营桌椅', basePrice: 259, baseWeight: 52, baseQuality: 74, procurementDays: 5 },
    { id: 'p7064', category: 'outdoor', name: '涂银蝶形天幕遮阳棚', basePrice: 289, baseWeight: 48, baseQuality: 76, procurementDays: 5 },
    { id: 'p7065', category: 'outdoor', name: '羽毛球12只装鹅毛球', basePrice: 59, baseWeight: 14, baseQuality: 70, procurementDays: 2 },
    { id: 'p7066', category: 'outdoor', name: '网球3只装比赛用球', basePrice: 39, baseWeight: 12, baseQuality: 68, procurementDays: 2 },
    { id: 'p7067', category: 'outdoor', name: '瑜伽砖泡沫轴套装', basePrice: 55, baseWeight: 22, baseQuality: 68, procurementDays: 2 },
    { id: 'p7068', category: 'outdoor', name: '可调节哑铃单只10kg', basePrice: 169, baseWeight: 70, baseQuality: 76, procurementDays: 5 },
    { id: 'p7069', category: 'outdoor', name: '登山包40L防水双肩', basePrice: 199, baseWeight: 35, baseQuality: 76, procurementDays: 4 },
    { id: 'p7070', category: 'outdoor', name: '头灯夜骑充电超亮', basePrice: 69, baseWeight: 14, baseQuality: 72, procurementDays: 3 },
    { id: 'p7071', category: 'outdoor', name: '对讲机户外远距离一对', basePrice: 159, baseWeight: 20, baseQuality: 74, procurementDays: 4 },
    { id: 'p7072', category: 'outdoor', name: '滑雪手套防水加绒', basePrice: 89, baseWeight: 16, baseQuality: 72, procurementDays: 3 },
    { id: 'p7073', category: 'outdoor', name: '轮滑护具六件套成人', basePrice: 79, baseWeight: 22, baseQuality: 70, procurementDays: 3 },
    { id: 'p7074', category: 'outdoor', name: '飞盘高尔夫趣味套装', basePrice: 69, baseWeight: 18, baseQuality: 68, procurementDays: 2 },
    { id: 'p7075', category: 'outdoor', name: '拼图2000片世界名画', basePrice: 89, baseWeight: 36, baseQuality: 74, procurementDays: 3 },
    { id: 'p7076', category: 'outdoor', name: '遥控车越野四驱充电', basePrice: 199, baseWeight: 32, baseQuality: 74, procurementDays: 4 },
    { id: 'p7077', category: 'outdoor', name: '积木拼装城市街景盒', basePrice: 149, baseWeight: 40, baseQuality: 74, procurementDays: 4 },
    { id: 'p7078', category: 'outdoor', name: '旱地冰球杆便携训练', basePrice: 119, baseWeight: 26, baseQuality: 70, procurementDays: 3 }
];

// 货源进货价整体上调（大众货）。奢侈品在 luxuryCatalog 里单独标高价，不再叠乘。
(function applySupplyPriceFactor() {
    try {
        PRODUCTS.forEach(p => {
            if (p && typeof p.basePrice === 'number' && p.basePrice > 0 && p.category !== 'luxury') {
                p.basePrice = Math.round(p.basePrice * 2.2 * 100) / 100;
            }
        });
    } catch (e) {
        try { console.warn('[supply price]', e); } catch (_) {}
    }
})();

// 明星/达人资源
const CELEBRITIES = [
    {
        id: 'c1',
        name: '网红小达人',
        level: 1,
        type: 'influencer',
        fee: 5000,
        exposureEffect: 1.2,
        conversionBoost: 1.1,
        fans: '10万+',
        description: '性价比高，适合中小卖家',
        unlockLevel: 1
    },
    {
        id: 'c2',
        name: '腰部主播',
        level: 2,
        type: 'streamer',
        fee: 20000,
        exposureEffect: 1.5,
        conversionBoost: 1.2,
        fans: '50万+',
        description: '带货能力不错',
        unlockLevel: 1
    },
    {
        id: 'c3',
        name: '知名博主',
        level: 3,
        type: 'blogger',
        fee: 50000,
        exposureEffect: 1.8,
        conversionBoost: 1.3,
        fans: '200万+',
        description: '粉丝粘性高',
        unlockLevel: 2
    },
    {
        id: 'c4',
        name: '二线明星',
        level: 4,
        type: 'star',
        fee: 150000,
        exposureEffect: 2.2,
        conversionBoost: 1.4,
        fans: '500万+',
        description: '品牌背书效果好',
        unlockLevel: 2
    },
    {
        id: 'c5',
        name: '一线明星',
        level: 5,
        type: 'superstar',
        fee: 500000,
        exposureEffect: 3.0,
        conversionBoost: 1.6,
        fans: '2000万+',
        description: '顶级流量，效果显著',
        unlockLevel: 3
    }
];

// 营销活动类型（多开时效果相乘，总倍率封顶见 MARKETING_EFFECT_CAP）
const MARKETING_TYPES = {
    searchAds: {
        id: 'searchAds',
        name: '搜索广告',
        description: '买关键词抢搜索位，按点击付费',
        type: 'cpc',
        basePrice: 0.8,
        commission: 0.03,
        effect: 1.22,
        unlockLevel: 1,
        icon: '🔍',
        tag: 'CPC'
    },
    directTrain: {
        id: 'directTrain',
        name: '直通车推广',
        description: '按点击付费，精准引流（另付广告公司服务费）',
        type: 'cpc',
        basePrice: 1.2,
        commission: 0.04,
        effect: 1.5,
        unlockLevel: 2,
        icon: '🚀',
        tag: 'CPC'
    },
    memberPush: {
        id: 'memberPush',
        name: '会员触达',
        description: '站内信 / 短信召回老客，按千次展示预付',
        type: 'cpm',
        basePrice: 180,
        commission: 0.03,
        effect: 1.28,
        unlockLevel: 1,
        icon: '📩',
        tag: 'CPM'
    },
    homepageBanner: {
        id: 'homepageBanner',
        name: '首页展位',
        description: '按展示付费，品牌曝光（另付广告公司服务费）',
        type: 'cpm',
        basePrice: 600,
        commission: 0.05,
        effect: 2.0,
        unlockLevel: 2,
        icon: '🏪',
        tag: 'CPM'
    },
    communityGroup: {
        id: 'communityGroup',
        name: '社群团购',
        description: '团长带货裂变，入场费 + 成交分成',
        type: 'fee+commission',
        basePrice: 800,
        commission: 0.06,
        effect: 1.55,
        unlockLevel: 2,
        icon: '👥',
        tag: '分成'
    },
    superRecommend: {
        id: 'superRecommend',
        name: '超级推荐',
        description: '信息流「猜你喜欢」，按点击扣费',
        type: 'cpc',
        basePrice: 2.0,
        commission: 0.05,
        effect: 1.72,
        unlockLevel: 4,
        icon: '✨',
        tag: 'CPC'
    },
    kolSeeding: {
        id: 'kolSeeding',
        name: '达人种草',
        description: '中腰部达人笔记 / 测评，一次性投放',
        type: 'cpa',
        basePrice: 2200,
        commission: 0.06,
        effect: 1.68,
        unlockLevel: 4,
        icon: '📝',
        tag: '一口价'
    },
    shortVideo: {
        id: 'shortVideo',
        name: '短视频投流',
        description: '按效果付费，内容营销（另付广告公司服务费）',
        type: 'cpa',
        basePrice: 15,
        commission: 0.07,
        effect: 1.8,
        unlockLevel: 5,
        icon: '📱',
        tag: '一口价'
    },
    liveBoost: {
        id: 'liveBoost',
        name: '直播加热',
        description: '给直播间买热度；开播时效果再加 20%',
        type: 'cpa',
        basePrice: 1800,
        commission: 0.06,
        effect: 1.75,
        liveBonus: 1.2,
        unlockLevel: 5,
        icon: '🔥',
        tag: '一口价'
    },
    platformEvent: {
        id: 'platformEvent',
        name: '平台活动',
        description: '固定入场费 + 销售额分成（另付广告公司服务费）',
        type: 'fee+commission',
        basePrice: 1500,
        commission: 0.08,
        effect: 2.5,
        unlockLevel: 6,
        icon: '🎉',
        tag: '分成'
    },
    festivalPreheat: {
        id: 'festivalPreheat',
        name: '大促预热',
        description: '会场报名预热，入场费 + 销售分成',
        type: 'fee+commission',
        basePrice: 5000,
        commission: 0.10,
        effect: 2.2,
        unlockLevel: 6,
        icon: '🧨',
        tag: '分成'
    }
};

/** 多条付费推广同时开启时的流量倍率上限，防止叠乘爆单 */
const MARKETING_EFFECT_CAP = 8;

/**
 * 广告公司：所有付费推广须经其执行，按媒体费抽服务费
 * - mediaCommissionRate：直通车/展位/短视频/平台活动入场/推广员推广费
 * - endorsementCommissionRate：明星代言经纪费
 * - 平台活动销售分成仍用 MARKETING_TYPES.platformEvent.commission
 */
const AD_AGENCY = {
    id: 'xingyun',
    name: '星云广告公司',
    description: '平台广告投放须经广告公司执行，按媒体费抽取服务费',
    mediaCommissionRate: 0.02,
    endorsementCommissionRate: 0.10,
    /** 推广员/店长自动推广带来的订单，按成交额抽成 */
    employeeSalesCommissionRate: 0.05,
    minFee: 0.5
};

/**
 * 流量闸门：不推广不能爆单
 * - 无付费推广/代言时：仅保留极少量自然流量
 * - 开启直通车/展位/短视频/平台活动/明星代言后：放开自然流量并叠加营销倍率，
 *   但仍有「单商品每小时成交上限」（修复原 Infinity 导致的推广当天冲数万单爆单）
 * - 仅直播：中等流量（直播本身算推广动作）
 * - 推广员每日可出单 50~400（当日随机上限，可随机爆单）；仍受全店日单硬顶约束
 */
const TRAFFIC_GATING = {
    // 无推广/促销/代言时：几乎只能靠自然进店，逼玩家去投流
    organicViewScale: 0.06,
    organicMaxOrdersPerListingHour: 1,
    organicOrdersPerDayMin: 6,
    organicOrdersPerDayMax: 14,
    // 推广员：全天出单总量随机区间（可随机带来大量订单）
    marketerOrdersPerDayMin: 50,
    marketerOrdersPerDayMax: 400,
    // 无推广时：大促节日倍率封顶（避免双11无投流也爆单）
    organicFestivalCap: 1.15,
    // 仅直播（无付费推广）时的自然流量缩放与单商品小时上限
    livestreamViewScale: 0.4,
    livestreamMaxOrdersPerListingHour: 3,
    // 有付费推广/代言时：完整自然流量
    paidViewScale: 1.0,
    // 有付费推广/代言时：单商品每小时成交上限（爆单闸门，生产端可消化）
    paidMaxOrdersPerListingHour: 20,
    // 无推广时压制新手/高价品自然加成（避免白嫖爆发）
    suppressOrganicBoostsWithoutPromo: true
};

// ================ 店铺全局经营配置（资金/风险/欠款机制）================
const SHOP_CONFIG = {
    // 店铺允许的最大欠款额度（负数：允许欠多少钱）
    // 当支出扣完后 funds 低于 maxDebt 时，该笔支出会被拒绝（返回false）
    // ⚠️ 必须与 bankruptLine 对齐：若 maxDebt 高于破产线，则永远无法触发破产
    maxDebt: -100000,
    // 破产线：欠款达到此额度立即触发破产结局（checkGameEndings）
    bankruptLine: -100000,
    // 平台成交抽成：每笔已售出（签收完成）订单按实收金额抽取
    platformCommissionRate: 0.01,
    // 每日最高新单上限（含待付款起的所有新生成订单）
    maxOrdersPerDay: 1000,
    // 买家购后退货率硬顶：100 单最多退 10 单（全店与单品均不可超过）
    maxReturnRate: 0.10,
    // 订单取消率硬顶：100 单最多取消 10 单
    maxCancelRate: 0.10
};

/** 运营风险阈值：突破后触发封禁/降评分等惩罚 */
const OPS_RISK_CONFIG = {
    cancelRateCap: 0.10,
    /** 与退货生成硬顶一致：卖 100 最多退 10 */
    returnRateCap: 0.10,
    minSampleOrders: 20,
    minCompletedForReturn: 15,
    windowDays: 30,
    checkCooldownDays: 1,
    banDaysMin: 1,
    banDaysMax: 3,
    reputationPenaltyMin: 8,
    reputationPenaltyMax: 20,
    ratingPenaltyMin: 0.15,
    ratingPenaltyMax: 0.4
};

/** 六城在写实中国轮廓图上的坐标（百分比） */
const CITY_MAP_LAYOUT = {
    shanghai: { x: 78, y: 46, lon: 121.47, lat: 31.23 },
    hangzhou: { x: 74, y: 50, lon: 120.15, lat: 30.28 },
    yiwu: { x: 72, y: 54, lon: 120.07, lat: 29.31 },
    wuhan: { x: 56, y: 49, lon: 114.31, lat: 30.59 },
    guangzhou: { x: 59, y: 71, lon: 113.26, lat: 23.13 },
    shenzhen: { x: 64, y: 75, lon: 114.06, lat: 22.54 },
    geneva: { x: 10, y: 16, lon: 6.14, lat: 46.20 },
    milan: { x: 16, y: 24, lon: 9.19, lat: 45.46 },
    paris: { x: 8, y: 20, lon: 2.35, lat: 48.86 },
    tokyo: { x: 93, y: 30, lon: 139.69, lat: 35.68 }
};

// ================ 定价规则（交易系统核心参数）================
const PRICE_RULES = {
    // 绝对阻断倍率：售卖价超过 basePrice 的 buyBlockRatio 倍 → 转化率直接归零，100%无人购买
    buyBlockRatio: 30,
    // 警告倍率：超过 basePrice 的 warningRatio 倍 → 转化率线性衰减，超得越多衰减越剧烈
    warningRatio: 5,
    // 绝对最高定价（元）：普通货上限；顶奢走 getMaxAbsolutePrice 按底价放宽
    maxAbsolutePrice: 999999,
    // 建议售价：以市场行情均价为主，供需微调；成本底价与行情倍率作边界
    suggestMinMargin: 0.15,          // 建议价不低于成本 ×(1+该值)
    suggestMaxCostMultiplier: 1.8,   // 建议价不高于成本 ×该值（贴近真实电商毛利）
    suggestMarketPull: 0.85,         // 向行情均价靠拢的权重（其余靠成本锚定）
    suggestPressureStrength: 0.2,    // 供需压力对建议价的最大影响幅度约 ±该值
    // 旧政策限价参数（已取消硬控，仅保留参考）
    lowCostThreshold: 3000,
    lowCostMultiplier: 4,
    highCostMultiplier: 2.5
};

function getMaxAbsolutePrice(product) {
    const baseCap = (typeof PRICE_RULES !== 'undefined' && PRICE_RULES.maxAbsolutePrice) || 999999;
    const bp = Number(product && product.basePrice) || 0;
    return Math.max(baseCap, Math.round(bp * 10), 8000000);
}

function getProductOriginCity(productOrId) {
    const p = typeof productOrId === 'string'
        ? ((typeof getProductById === 'function') ? getProductById(productOrId) : null)
        : productOrId;
    return (p && p.originCity) ? p.originCity : '';
}

function resolveShipFromCity(productOrId, fallbackCity) {
    const origin = getProductOriginCity(productOrId);
    if (origin) return origin;
    return fallbackCity || 'yiwu';
}

function isOriginCity(cityId) {
    if (!cityId || typeof ORIGIN_CITIES === 'undefined') return false;
    return ORIGIN_CITIES.some(c => c && c.id === cityId);
}

/** 店铺注册主体：影响增值税与所得税 */
const SHOP_ENTITY_TYPES = [
    {
        id: 'individual',
        name: '个人',
        icon: '👤',
        desc: '免增值税；经营利润按 1% 简易所得税'
    },
    {
        id: 'sole_trader',
        name: '个体工商户',
        icon: '🏪',
        desc: '增值税 1%（月收入超 10 万）；利润所得税 5%'
    },
    {
        id: 'company',
        name: '公司',
        icon: '🏢',
        desc: '增值税 3%（月收入超 10 万）；企税 5%/25% 分档'
    }
];

/** 品牌标识：缴纳品牌金解锁（普通免费） */
const BRAND_BADGES = [
    { id: 'normal', name: '普通', icon: '🏷️', unlockSales: 0, fee: 0, desc: '普通店铺，无需缴纳品牌金' },
    { id: 'flagship', name: '旗舰', icon: '🏆', unlockSales: 0, fee: 10000000, desc: '旗舰店铺，需缴纳品牌金 1000 万' },
    { id: 'gold', name: '金标', icon: '🥇', unlockSales: 0, fee: 50000000, desc: '品牌金标，需缴纳品牌金 5000 万' },
    { id: 'black_gold', name: '黑金', icon: '♠️', unlockSales: 0, fee: 100000000, desc: '品牌黑金标，需缴纳品牌金 1 亿' }
];

function getBrandBadgeById(id) {
    return BRAND_BADGES.find(b => b.id === id) || BRAND_BADGES[0];
}

function getShopEntityTypeById(id) {
    return SHOP_ENTITY_TYPES.find(e => e.id === id) || SHOP_ENTITY_TYPES[0];
}

const OWN_BRAND_FACTORY = {
    id: 'cloth_gz',
    name: '广州服饰工厂',
    icon: '🏭',
    cost: 2000000,
    category: 'clothing',
    dailyCapacity: 240,
    costMul: 0.52,
    leadDays: 4,
    city: 'guangzhou',
    qualityGrade: 'C',
    maxLines: 8,
    lineNormal: { type: 'normal', name: '普通产线', cost: 500000, capacity: 200 },
    lineAdvanced: { type: 'advanced', name: '高级产线', cost: 1200000, capacity: 200 },
    costTiers: {
        cheap: { id: 'cheap', name: '省料', costMul: 0.40, grade: 'C' },
        standard: { id: 'standard', name: '标准', costMul: 0.52, grade: 'C', gradeWithAdv: 'B' },
        premium: { id: 'premium', name: '精做', costMul: 0.70, grade: 'A', needAdvanced: true }
    },
    desc: '创立自有品牌后可购置。初始日产240件，可买产线扩产；下单不限量，按日产能排队出货。'
};

function getFactoryDailyCapacity(factory) {
    const cfg = (typeof OWN_BRAND_FACTORY !== 'undefined') ? OWN_BRAND_FACTORY : {};
    const base = Number(cfg.dailyCapacity) || 240;
    const lines = (factory && factory.lines) || [];
    let extra = 0;
    for (let i = 0; i < lines.length; i++) extra += Number(lines[i] && lines[i].capacity) || 200;
    return base + extra;
}

function factoryHasAdvancedLine(factory) {
    const lines = (factory && factory.lines) || [];
    return lines.some(l => l && l.type === 'advanced');
}

function getFactoryCostTier(tierId) {
    const cfg = (typeof OWN_BRAND_FACTORY !== 'undefined') ? OWN_BRAND_FACTORY : {};
    const tiers = cfg.costTiers || {};
    return tiers[tierId] || tiers.standard || { id: 'standard', name: '标准', costMul: 0.52, grade: 'C' };
}

function getLuxuryDisplayGrade(amount) {
    const n = Number(amount) || 0;
    if (n >= 150000) return 'SS';
    if (n >= 30000) return 'S';
    return 'A';
}

function getPurchaseVariancePct(product) {
    if (!product) return 0.08;
    if (product.sellByGram || product.category === 'precious' || product.id === 'p_gold_1g') return 0.15;
    if (product.category === 'luxury') return 0.12;
    return 0.08;
}

const ROLE_COMMISSION = {
    csPerTicket: 0.8,
    csMonthCap: 800,
    pricingPerListing: 2,
    pricingMonthCap: 600,
    lawyerMin: 0.03,
    lawyerMax: 0.08,
    lawyerDefault: 0.05,
    lawyerMonthCap: 5000
};

const OWN_BRAND_SKUS = [
    { id: 'ob_c01', name: '自制纯棉短袖T恤', basePrice: 49, baseWeight: 20, procurementDays: 3 },
    { id: 'ob_c02', name: '自制连帽卫衣', basePrice: 89, baseWeight: 42, procurementDays: 4 },
    { id: 'ob_c03', name: '自制直筒牛仔裤', basePrice: 99, baseWeight: 40, procurementDays: 4 },
    { id: 'ob_c04', name: '自制雪纺连衣裙', basePrice: 119, baseWeight: 28, procurementDays: 5 },
    { id: 'ob_c05', name: '自制商务衬衫', basePrice: 79, baseWeight: 24, procurementDays: 4 },
    { id: 'ob_c06', name: '自制防晒衣', basePrice: 69, baseWeight: 18, procurementDays: 3 },
    { id: 'ob_c07', name: '自制运动鞋', basePrice: 129, baseWeight: 40, procurementDays: 5 },
    { id: 'ob_c08', name: '自制帆布托特包', basePrice: 59, baseWeight: 26, procurementDays: 3 }
];

(function injectOwnBrandSkus() {
    if (typeof PRODUCTS === 'undefined' || !Array.isArray(PRODUCTS)) return;
    const exist = {};
    PRODUCTS.forEach(p => { if (p && p.id) exist[p.id] = true; });
    OWN_BRAND_SKUS.forEach(row => {
        if (exist[row.id]) return;
        PRODUCTS.push({
            id: row.id,
            category: 'clothing',
            name: row.name,
            basePrice: row.basePrice,
            baseWeight: row.baseWeight,
            baseQuality: 88,
            procurementDays: row.procurementDays,
            unlockShopLevel: 6,
            ownBrandOnly: true
        });
        exist[row.id] = true;
    });
})();

// 店铺等级配置（升级需交费 + 累计销量件数；等级越高流量/权重越高）
const SHOP_LEVELS = [
    { level: 1, name: '新手店铺', upgradeFee: 0, minSalesQty: 0, minReputation: 0, benefits: ['基础功能', '3个批发商', '搜索广告'], trafficBonus: 1.0, weightBonus: 0 },
    { level: 2, name: '一心店铺', upgradeFee: 100000, minSalesQty: 1000, minReputation: 0, benefits: ['6个批发商', '直通车', '会员触达'], trafficBonus: 1.2, weightBonus: 10 },
    { level: 3, name: '二心店铺', upgradeFee: 200000, minSalesQty: 10000, minReputation: 0, benefits: ['6个批发商', '首页展位', '社群团购'], trafficBonus: 1.4, weightBonus: 20 },
    { level: 4, name: '三心店铺', upgradeFee: 500000, minSalesQty: 50000, minReputation: 0, benefits: ['全部批发商', '超级推荐', '达人种草'], trafficBonus: 1.6, weightBonus: 30 },
    { level: 5, name: '钻石店铺', upgradeFee: 1000000, minSalesQty: 100000, minReputation: 0, benefits: ['明星代言', '短视频投流', '直播加热'], trafficBonus: 1.85, weightBonus: 40 },
    { level: 6, name: '皇冠店铺', upgradeFee: 2000000, minSalesQty: 120000, minReputation: 0, benefits: ['平台活动', '大促预热', '轻奢货源'], trafficBonus: 2.1, weightBonus: 50, luxuryTier: true },
    { level: 7, name: '金冠店铺', upgradeFee: 10000000, minSalesQty: 150000, minReputation: 0, benefits: ['专属客服', '流量扶持', '可扩展海外市场'], trafficBonus: 2.5, weightBonus: 70, overseas: true, luxuryTier: true },
    { level: 8, name: '双金冠', upgradeFee: 25000000, minSalesQty: 250000, minReputation: 0, benefits: ['高货值奢侈品', '跨境保税货源', '品牌权重'], trafficBonus: 2.9, weightBonus: 85, overseas: true, luxuryTier: true },
    { level: 9, name: '五金冠', upgradeFee: 60000000, minSalesQty: 450000, minReputation: 0, benefits: ['顶级货源通道', '全站流量倾斜'], trafficBonus: 3.4, weightBonus: 100, overseas: true, luxuryTier: true },
    { level: 10, name: '至尊旗舰', upgradeFee: 120000000, minSalesQty: 800000, minReputation: 0, benefits: ['满级店铺', '数十万级奢侈品', '最高权重'], trafficBonus: 4.0, weightBonus: 120, overseas: true, luxuryTier: true }
];

// 营销利润提成：按累计销售额阶梯（仅营销/推广订单，利润×比率 → 推广员/店长）
// 店铺可自定义 customCommissionRate（0~0.2）覆盖阶梯默认值
const SALES_COMMISSION_TIERS = [
    { minSalesAmount: 10000000, rate: 0.03, label: '3%（累计销售≥1000万）' },
    { minSalesAmount: 1000000, rate: 0.02, label: '2%（累计销售≥100万）' },
    { minSalesAmount: 0, rate: 0.01, label: '1%（基础）' }
];
/** 员工宿舍楼型：可重复购买，不再卡在 20 床 */
const HOUSING_BUILDING_TYPES = [
    { id: 'bunk', name: '上下铺宿舍', beds: 8, cost: 12000, rent: 90, sat: 64, icon: '🛏️', desc: '8 人间，便宜扩容' },
    { id: 'std', name: '标准公寓', beds: 20, cost: 40000, rent: 150, sat: 76, icon: '🏠', desc: '一栋 20 床' },
    { id: 'apt', name: '员工公寓楼', beds: 50, cost: 120000, rent: 200, sat: 86, icon: '🏢', desc: '一栋 50 床' },
    { id: 'park', name: '人才社区', beds: 100, cost: 280000, rent: 240, sat: 93, icon: '🏘️', desc: '一栋 100 床' }
];

function getHousingBuildingType(id) {
    return (HOUSING_BUILDING_TYPES || []).find(t => t.id === id) || HOUSING_BUILDING_TYPES[0];
}

/** 员工经手订单提成：默认/最低 0.1%（0.001），可在「提成设置」改 0.1%～1% */
const STAFF_ORDER_COMMISSION = { defaultRate: 0.001, minRate: 0.001, maxRate: 0.01 };
function getStaffOrderCommissionRate(shop) {
    const raw = shop && typeof shop.staffOrderCommissionRate === 'number'
        ? shop.staffOrderCommissionRate
        : STAFF_ORDER_COMMISSION.defaultRate;
    return Math.max(STAFF_ORDER_COMMISSION.minRate, Math.min(STAFF_ORDER_COMMISSION.maxRate, Number(raw) || STAFF_ORDER_COMMISSION.defaultRate));
}

/** 店铺星级档位：影响流量、转化、能否接收藏家订单 */
const SHOP_RATING_TIERS = [
    { min: 4.9, id: 'legend', name: '传说口碑', icon: '👑', conv: 1.22, traffic: 1.12, vip: true, color: '#c62828', desc: '转化+22% · 流量+12% · 收藏家订单' },
    { min: 4.8, id: 'gold', name: '金牌口碑', icon: '🥇', conv: 1.15, traffic: 1.08, vip: true, color: '#f9a825', desc: '转化+15% · 流量+8% · 收藏家订单' },
    { min: 4.5, id: 'good', name: '优质店铺', icon: '⭐', conv: 1.08, traffic: 1.04, vip: false, color: '#43a047', desc: '转化+8% · 流量+4%' },
    { min: 4.0, id: 'ok', name: '口碑平稳', icon: '🙂', conv: 1.00, traffic: 1.00, vip: false, color: '#546e7a', desc: '无额外加减' },
    { min: 3.5, id: 'warn', name: '口碑预警', icon: '😟', conv: 0.90, traffic: 0.88, vip: false, color: '#ef6c00', desc: '转化-10% · 流量-12%' },
    { min: 0,   id: 'danger', name: '口碑危机', icon: '⚠️', conv: 0.72, traffic: 0.75, vip: false, color: '#c62828', desc: '转化-28% · 流量-25% · 奢侈品滞销' }
];
function getShopRatingTier(rating) {
    const r = Number(rating);
    const n = isFinite(r) ? r : 5;
    for (let i = 0; i < SHOP_RATING_TIERS.length; i++) {
        if (n >= SHOP_RATING_TIERS[i].min) return SHOP_RATING_TIERS[i];
    }
    return SHOP_RATING_TIERS[SHOP_RATING_TIERS.length - 1];
}

function getSalesCommissionRate(totalSalesAmount, customRate) {
    if (typeof customRate === 'number' && isFinite(customRate) && customRate >= 0) {
        const rate = Math.max(0, Math.min(0.2, customRate));
        return { minSalesAmount: 0, rate, label: `${(rate * 100).toFixed(1)}%（自定义）`, custom: true };
    }
    const amt = Number(totalSalesAmount) || 0;
    for (let i = 0; i < SALES_COMMISSION_TIERS.length; i++) {
        if (amt >= SALES_COMMISSION_TIERS[i].minSalesAmount) return SALES_COMMISSION_TIERS[i];
    }
    return SALES_COMMISSION_TIERS[SALES_COMMISSION_TIERS.length - 1];
}

// 员工月薪硬顶（含福利补贴后的应发工资上限；不含销售提成、不含手动发放的自定义奖金）
// ===== 修复：旧值 2500 与底薪持平，导致全勤奖/餐补/绩效/福利补贴被「津贴封顶调整」全额清零 =====
// ===== 现给津贴留出 500 空间（全勤+餐补+交通+绩效 ≈ 430 可全额发放），奖金体系真实生效且不失控 =====
const EMPLOYEE_MONTHLY_PAY_CAP = 3000;

// 兑换码配置
const REDEEM_CODES = {
    'START10W': {
        name: '新手大礼包',
        type: 'money',
        amount: 100000,
        description: '10万启动资金',
        maxUses: 1,
        icon: '🎁'
    },
    'BOSS100W': {
        name: '老板扶持金',
        type: 'money',
        amount: 1000000,
        description: '100万经营资金',
        maxUses: 1,
        icon: '💼'
    },
    'TYCOON1000W': {
        name: '商业大亨礼包',
        type: 'money',
        amount: 10000000,
        description: '1000万创业基金',
        maxUses: 1,
        icon: '👑'
    },
    '冯智轩': {
        name: '超级土豪礼包',
        type: 'money',
        amount: 10000000000,
        description: '100亿巨额资金',
        maxUses: 1,
        icon: '💰'
    },
    // 跳一天次数：+1000
    'YUEBU1000': {
        name: '次数补给大礼包',
        type: 'actionQuota',
        amount: 1000,
        description: '跳一天与排行刷新各 +1000 次',
        maxUses: 1,
        icon: '⏩'
    }
};

// 员工数据（月薪制）
// specialtyBonus: 专业技能匹配加成 - 专业岗位做专业事获得额外效率加成（1.8=+80%）
// primarySkill: 核心专精技能（用于智能任务调度时的优先级判断）
const EMPLOYEE_TYPES = {
    packer: { 
        name: '打包员', 
        icon: '📦',
        description: '负责订单打包工作，专业打包极速高效',
        baseSalary: 2500, 
        efficiency: 1.0, 
        skills: ['pack'],
        primarySkill: 'pack',
        specialtyBonus: { pack: 1.8 }
    },
    shipper: { 
        name: '发货员', 
        icon: '🚚',
        description: '负责订单发货和物流单打印，超级批量发货能手',
        baseSalary: 2500, 
        efficiency: 1.0, 
        skills: ['ship', 'print'],
        primarySkill: 'ship',
        defaultExpress: 'economy',
        specialtyBonus: { ship: 1.8, print: 1.6 }
    },
    customerService: { 
        name: '客服', 
        icon: '💬',
        description: '负责客户咨询、售后处理，并可协助上架商品',
        baseSalary: 2500, 
        efficiency: 1.0, 
        skills: ['consultation', 'listing'],
        primarySkill: 'consultation',
        specialtyBonus: { consultation: 2.0, listing: 1.3 }
    },
    marketer: {
        name: '推广员',
        icon: '📣',
        description: '负责每小时营销推广，也可把库存商品上架售卖',
        baseSalary: 2500,
        efficiency: 1.0,
        skills: ['marketing', 'promotion', 'listing'],
        primarySkill: 'marketing',
        // ===== 专业加成再下调：marketing 1.3 → 1.15（防止高等级强度 × 加成叠加导致费用过大）=====
        specialtyBonus: { marketing: 1.15, promotion: 1.1, listing: 1.2 }
    },
    manager: { 
        name: '店长', 
        icon: '👔',
        description: '全能型管理人才，擅长统筹调度、推广与上架',
        baseSalary: 2500, 
        efficiency: 1.5, 
        skills: ['pack', 'ship', 'print', 'consultation', 'marketing', 'listing'],
        primarySkill: 'marketing', // 店长优先做推广等高价值事
        defaultExpress: 'standard',
        // ===== 店长全能加成再下调（marketing 1.2 → 1.1，匹配推广员的下调幅度）=====
        specialtyBonus: { consultation: 1.2, marketing: 1.1, ship: 1.2, pack: 1.2, listing: 1.25 }
    },
    buyer: {
        name: '采购员',
        icon: '🛒',
        description: '负责商品采购与供应链对接，专业议价降低采购成本',
        baseSalary: 2500,
        efficiency: 1.0,
        skills: ['procurement', 'sourcing', 'warehouse'],
        primarySkill: 'procurement',
        department: 'purchase',
        specialtyBonus: { procurement: 1.6, sourcing: 1.5, warehouse: 1.3 }
    },
    lawyer: {
        id: 'lawyer',
        name: '律师',
        icon: '⚖️',
        department: 'legal',
        description: '专业法务人才，擅长诉讼代理、合同审核与风险防控',
        baseSalary: 2500,
        efficiency: 1.0,
        skills: ['litigation', 'contract', 'risk_control'],
        primarySkill: 'litigation',
        specialtyBonus: { litigation: 1.6, contract: 1.5, risk_control: 1.4 }
    },
    pricer: {
        name: '改价员',
        icon: '💲',
        description: '自动把在架商品售价调整为成本价比例（商品页可设 100%~400%，默认150%），并跟随市场建议价',
        baseSalary: 2500,
        efficiency: 1.0,
        skills: ['pricing'],
        primarySkill: 'pricing',
        specialtyBonus: { pricing: 1.8 }
    },
    factoryDirector: {
        name: '厂长',
        icon: '🏭',
        description: '管理自有工厂：缩短开工等待、降低废品，不直接增加日产能',
        baseSalary: 5500,
        efficiency: 1.2,
        skills: ['factory_manage'],
        primarySkill: 'factory_manage',
        specialtyBonus: { factory_manage: 1.8 },
        payCap: 6000
    }
};

// 员工升级配置：每级所需经验、效率倍率、工资加成、晋升费用
// ================ 用户要求：晋升费用每级翻倍；效率每级翻倍 ================
const EMPLOYEE_LEVEL_CONFIG = {
    maxLevel: 10,
    // ========= 基础晋升费用（Lv1 → Lv2 的价格），每升一级费用翻倍 =========
    // Lv1→2: 500,  Lv2→3: 1000,  Lv3→4: 2000,  Lv4→5: 4000,  Lv5→6: 8000
    // Lv6→7: 16000, Lv7→8: 32000, Lv8→9: 64000, Lv9→10: 128000
    // 满级累计：500+1000+2000+4000+8000+16000+32000+64000+128000 = 255500
    promotionBaseCost: 500,
    // 返回"从当前 level 晋升到下一级 level+1 所需的晋升费用"
    // level必须为 1~9，因为maxLevel=10没有下一级
    promotionCost: (level) => {
        const lv = Math.max(1, Math.min(EMPLOYEE_LEVEL_CONFIG.maxLevel - 1, level || 1));
        return EMPLOYEE_LEVEL_CONFIG.promotionBaseCost * Math.pow(2, lv - 1);
    },
    // 返回"从fromLevel升到toLevel的累计晋升费用"（用于一键升级UI预览）
    promotionCostRange: (fromLevel, toLevel) => {
        let total = 0;
        const start = Math.max(1, fromLevel || 1);
        const end = Math.min(EMPLOYEE_LEVEL_CONFIG.maxLevel - 1, toLevel || EMPLOYEE_LEVEL_CONFIG.maxLevel);
        for (let lv = start; lv < end; lv++) {
            total += EMPLOYEE_LEVEL_CONFIG.promotionCost(lv);
        }
        return total;
    },

    // 返回升到下一级所需经验（自然工作累积升级用，免费路径保留）
    expToNext: (curLevel) => 50 + curLevel * 50, // lv1→lv2需100，lv2→lv3需150，...
    // ========= 效率每级翻倍：Lv1=1.0, Lv2=2.0, Lv3=4.0, Lv4=8.0, ... , Lv10=512.0 =========
    // 新手加速：Lv1~Lv2 保底 ×3，让起步期打包/发货不再拖后腿（Lv3 起仍严格每级翻倍）
    efficiencyMultiplier: (level) => {
        const lv = Math.max(1, Math.min(EMPLOYEE_LEVEL_CONFIG.maxLevel, level || 1));
        return Math.max(3, Math.pow(2, lv - 1));
    },
    // 返回该等级的工资倍数（不翻倍保持温和增长，避免工资爆炸）
    salaryMultiplier: (level) => 1 + (level - 1) * 0.03, // 每级+3%，配合月薪硬顶2500
    // 单次任务获得的经验
    expPerTask: {
        pack: 1,         // 每成功打包1单+1 exp
        ship: 1,         // 每成功发货1单+1 exp
        consultation: 1, // 每处理1个客服+1 exp
        marketing: 2,    // 每小时做推广+2 exp
        listing: 2,      // 每自动上架1个SKU+2 exp
        litigation: 3,   // 每立案/结案诉讼+3 exp（律师）
    },
    // 每级打包数量上限（单次打包任务可同时处理的订单数）
    // 提速×10：Lv1=56, Lv10=200（原 Lv1=6, Lv10=24）
    packCapacity: (level) => {
        const lv = Math.max(1, Math.min(EMPLOYEE_LEVEL_CONFIG.maxLevel, level || 1));
        return 40 + lv * 16; // Lv1=56, Lv10=200
    },
    // 每级发货数量上限（发货员支持批量发货）
    // 提速×10：发货员 Lv1=56, Lv10=200；其他有ship技能的员工 Lv1=36, Lv10=108
    shipCapacity: (level, isShipper) => {
        const lv = Math.max(1, Math.min(EMPLOYEE_LEVEL_CONFIG.maxLevel, level || 1));
        if (isShipper) return 40 + lv * 16; // Lv1=56, Lv10=200
        return 28 + lv * 8; // Lv1=36, Lv10=108
    },
    // 每级客服单次处理咨询数量上限
    // 客服: Lv1=10, Lv10=28；其他consultation岗位: Lv1=6, Lv10=15
    csCapacity: (level, isCS) => {
        const lv = Math.max(1, Math.min(EMPLOYEE_LEVEL_CONFIG.maxLevel, level || 1));
        if (isCS) return 8 + lv * 2; // Lv1=10, Lv10=28
        return 5 + lv; // Lv1=6, Lv10=15
    },
    // 质量影响系数：等级越高，工作质量越好（差评率降低、转化率提升）
    // 取值 1.0 ~ 0.4，越高等级质量修正越强（负数乘子，降负面）
    qualityFactor: (level) => Math.max(0.4, 1 - (Math.max(1, level || 1) - 1) * 0.07)
};

// 员工福利等级体系（5档）
// 晋升条件：员工等级阈值 + 累计工作经验累计 + 在职天数
const EMPLOYEE_WELFARE_CONFIG = [
    {
        level: 1, name: '实习生', short: '实习', icon: '🌱', color: '#9e9e9e', bgColor: '#f5f5f5',
        minEmployeeLevel: 1, minTotalExp: 0, minWorkDays: 0,
        benefits: [
            { label: '餐补', value: '¥0/月' },
            { label: '交通补', value: '¥0/月' },
            { label: '全勤奖', value: '¥0/月' },
            { label: '年假', value: '0天/年' },
            { label: '年终奖', value: '0月工资' }
        ],
        description: '新入职员工，享受基础培训与试用期保障'
    },
    {
        level: 2, name: '正式员工', short: '正式', icon: '🌿', color: '#4caf50', bgColor: '#e8f5e9',
        // Lv≥3 即转正（不再卡累计经验/在职天数，避免花钱晋升后永远停在实习生）
        minEmployeeLevel: 3, minTotalExp: 0, minWorkDays: 0,
        benefits: [
            { label: '餐补', value: '¥80/月' },
            { label: '交通补', value: '¥50/月' },
            { label: '全勤奖', value: '¥70/月' },
            { label: '年假', value: '3天/年' },
            { label: '年终奖', value: '0.3月工资' }
        ],
        description: '达到Lv3后自动转正，享受正式员工补贴福利'
    },
    {
        level: 3, name: '资深员工', short: '资深', icon: '🌳', color: '#2196f3', bgColor: '#e3f2fd',
        minEmployeeLevel: 5, minTotalExp: 2000, minWorkDays: 7,
        benefits: [
            { label: '餐补', value: '¥120/月' },
            { label: '交通补', value: '¥80/月' },
            { label: '全勤奖', value: '¥100/月' },
            { label: '年假', value: '5天/年' },
            { label: '年终奖', value: '0.5月工资' }
        ],
        description: '稳定贡献的老员工，福利适度提升'
    },
    {
        level: 4, name: '精英骨干', short: '精英', icon: '⭐', color: '#ff9800', bgColor: '#fff3e0',
        minEmployeeLevel: 7, minTotalExp: 6000, minWorkDays: 14,
        benefits: [
            { label: '餐补', value: '¥150/月' },
            { label: '交通补', value: '¥100/月' },
            { label: '全勤奖', value: '¥120/月' },
            { label: '年假', value: '7天/年' },
            { label: '年终奖', value: '0.8月工资' }
        ],
        description: '团队核心成员（月薪含福利仍不超过2500）'
    },
    {
        level: 5, name: '核心合伙人', short: '核心', icon: '💎', color: '#e91e63', bgColor: '#fce4ec',
        minEmployeeLevel: 9, minTotalExp: 15000, minWorkDays: 25,
        benefits: [
            { label: '餐补', value: '¥180/月' },
            { label: '交通补', value: '¥120/月' },
            { label: '全勤奖', value: '¥150/月' },
            { label: '年假', value: '10天/年' },
            { label: '年终奖', value: '1月工资' }
        ],
        description: '最高荣誉档，享受销售提成分红'
    }
];
// 根据员工当前状态计算其福利档位
EMPLOYEE_WELFARE_CONFIG.getLevel = (emp) => {
    if (!emp) return EMPLOYEE_WELFARE_CONFIG[0];
    const lv = emp.level || 1;
    const totalExp = (emp.exp || 0) + (emp._totalExpAccum || 0); // 估算累计（含历史）
    const days = emp.workDays || 0;
    let best = EMPLOYEE_WELFARE_CONFIG[0];
    for (let i = EMPLOYEE_WELFARE_CONFIG.length - 1; i >= 0; i--) {
        const w = EMPLOYEE_WELFARE_CONFIG[i];
        if (lv >= w.minEmployeeLevel && totalExp >= w.minTotalExp && days >= w.minWorkDays) {
            best = w; break;
        }
    }
    return best;
};

// 雇佣形式
const EMPLOYMENT_TYPES = {
    fulltime: {
        name: '全职',
        salaryMultiplier: 1.0,
        efficiencyMultiplier: 1.0,
        description: '全职员工，全天在岗，效率稳定'
    },
    parttime: {
        name: '兼职',
        salaryMultiplier: 0.6,
        efficiencyMultiplier: 0.65,
        description: '兼职员工，按小时计酬，工资较低，效率稍低'
    }
};

// ============================================================
// 薪酬管理系统配置（国家规定 + 企业自定义规则）
// ============================================================

// 社保公积金配置（国家标准，模拟2024年五险一金比例）
const SOCIAL_INSURANCE_CONFIG = {
    // 养老保险
    pension: { employeeRate: 0.08, companyRate: 0.16, name: '养老保险', icon: '👴' },
    // 医疗保险
    medical: { employeeRate: 0.02, companyRate: 0.095, name: '医疗保险', icon: '🏥' },
    // 失业保险
    unemployment: { employeeRate: 0.005, companyRate: 0.005, name: '失业保险', icon: '📋' },
    // 工伤保险（企业全额承担）
    injury: { employeeRate: 0, companyRate: 0.004, name: '工伤保险', icon: '⛑️' },
    // 生育保险（企业全额承担）
    maternity: { employeeRate: 0, companyRate: 0.008, name: '生育保险', icon: '👶' },
    // 住房公积金
    housingFund: { employeeRate: 0.07, companyRate: 0.07, name: '住房公积金', icon: '🏠' }
};

// 个人所得税税率表（2024年综合所得适用，月度预扣预缴简化版）
const INCOME_TAX_BRACKETS = [
    { min: 0, max: 5000, rate: 0, deduction: 0, name: '起征点内' },
    { min: 5000, max: 8000, rate: 0.03, deduction: 0, name: '3%档' },
    { min: 8000, max: 17000, rate: 0.10, deduction: 210, name: '10%档' },
    { min: 17000, max: 30000, rate: 0.20, deduction: 1410, name: '20%档' },
    { min: 30000, max: 40000, rate: 0.25, deduction: 2660, name: '25%档' },
    { min: 40000, max: 60000, rate: 0.30, deduction: 4410, name: '30%档' },
    { min: 60000, max: 85000, rate: 0.35, deduction: 7160, name: '35%档' },
    { min: 85000, max: Infinity, rate: 0.45, deduction: 15160, name: '45%档' }
];

// 法定节假日加班工资倍率
const OVERTIME_RATES = {
    workday: { rate: 1.5, name: '工作日加班', label: '1.5倍' },
    weekend: { rate: 2.0, name: '周末加班', label: '2倍' },
    holiday: { rate: 3.0, name: '法定节假日加班', label: '3倍' }
};

// 企业自定义奖金项目（可配置开关和金额）
const BONUS_TYPES = {
    performance: {
        id: 'performance',
        name: '绩效奖金',
        icon: '📊',
        description: '根据月度工作绩效发放',
        type: 'variable', // variable=浮动，fixed=固定
        defaultAmount: 0,
        enabled: true,
        editable: true
    },
    attendance: {
        id: 'attendance',
        name: '全勤奖',
        icon: '✅',
        description: '当月无迟到早退缺勤',
        type: 'fixed',
        defaultAmount: 200,
        enabled: true,
        editable: true
    },
    meal: {
        id: 'meal',
        name: '餐补',
        icon: '🍱',
        description: '月度餐饮补贴',
        type: 'fixed',
        defaultAmount: 300,
        enabled: true,
        editable: true
    },
    transport: {
        id: 'transport',
        name: '交通补贴',
        icon: '🚌',
        description: '月度交通费用补贴',
        type: 'fixed',
        defaultAmount: 200,
        enabled: true,
        editable: true
    },
    highTemperature: {
        id: 'highTemperature',
        name: '高温补贴',
        icon: '🔥',
        description: '夏季防暑降温补贴（6-9月）',
        type: 'fixed',
        defaultAmount: 150,
        enabled: false,
        editable: true,
        seasonal: { startMonth: 6, endMonth: 9 }
    },
    overtime: {
        id: 'overtime',
        name: '加班费',
        icon: '⏰',
        description: '按加班时长计算',
        type: 'variable',
        defaultAmount: 0,
        enabled: true,
        editable: false
    },
    yearEnd: {
        id: 'yearEnd',
        name: '年终奖',
        icon: '🧧',
        description: '年底根据表现发放（N月工资）',
        type: 'variable',
        defaultAmount: 0,
        enabled: true,
        editable: false
    },
    other: {
        id: 'other',
        name: '其他奖金/扣款',
        icon: '💰',
        description: '自定义奖励或扣款（负数为扣款）',
        type: 'variable',
        defaultAmount: 0,
        enabled: true,
        editable: true
    }
};

// 员工部门配置
const DEPARTMENTS = {
    warehouse: { id: 'warehouse', name: '仓储部', icon: '🏭', color: '#ff9800' },
    logistics: { id: 'logistics', name: '物流部', icon: '🚚', color: '#2196f3' },
    service: { id: 'service', name: '客服部', icon: '💬', color: '#4caf50' },
    marketing: { id: 'marketing', name: '市场部', icon: '📣', color: '#9c27b0' },
    management: { id: 'management', name: '管理层', icon: '👔', color: '#607d8b' },
    purchase: { id: 'purchase', name: '采购部', icon: '🛒', color: '#43a047' },
    legal: { id: 'legal', name: '法务部', icon: '⚖️', color: '#7b1fa2' }
};

// 员工岗位与部门映射
const EMPLOYEE_DEPARTMENT_MAP = {
    packer: 'warehouse',
    shipper: 'logistics',
    customerService: 'service',
    marketer: 'marketing',
    manager: 'management',
    buyer: 'purchase',
    lawyer: 'legal',
    pricer: 'management'
};

// 薪酬核算周期
const PAYROLL_CYCLE = {
    monthly: { id: 'monthly', name: '月薪', days: 30 },
    daily: { id: 'daily', name: '日薪', days: 1 },
    hourly: { id: 'hourly', name: '时薪', hours: 8 }
};

// ==================== 优惠券系统配置 ====================
const COUPON_TYPES = {
    FIXED: { id: 'fixed', name: '固定金额券', icon: '💰', color: '#ff6b6b', desc: '直接抵扣固定金额' },
    DISCOUNT: { id: 'discount', name: '折扣券', icon: '🏷️', color: '#feca57', desc: '按比例折扣优惠' },
    THRESHOLD: { id: 'threshold', name: '满减券', icon: '🎫', color: '#54a0ff', desc: '满指定金额减免' },
    FREESHIP: { id: 'freeship', name: '免运费券', icon: '🚚', color: '#5f27cd', desc: '免除快递费用' }
};

const COUPON_STATUS = {
    DRAFT: 'draft',
    ACTIVE: 'active',
    PAUSED: 'paused',
    EXPIRED: 'expired',
    DEPLETED: 'depleted'
};

const COUPON_USER_STATUS = {
    AVAILABLE: 'available',
    USED: 'used',
    EXPIRED: 'expired'
};

const COUPON_SCOPE = {
    ALL: 'all',
    CATEGORY: 'category',
    PRODUCT: 'product'
};

const COUPON_RECEIVE_TYPE = {
    ALL: 'all',
    NEW_USER: 'new_user',
    MEMBER: 'member',
    ACTIVITY: 'activity'
};

// 订单状态（新流程：待付款→待打包→待发货→已发货→已完成）
const ORDER_STATUS = [
    { code: 'pending_payment', name: '待付款', color: '#ff9800' },
    { code: 'pending_packing', name: '待打包', color: '#ff5722' },
    { code: 'pending_shipment', name: '待发货', color: '#f44336' },
    { code: 'shipped', name: '已发货', color: '#2196f3' },
    { code: 'completed', name: '已完成', color: '#4caf50' },
    { code: 'cancelled', name: '已取消', color: '#9e9e9e' },
    { code: 'returning', name: '退货中', color: '#ff5722' },
    { code: 'returned', name: '已退货', color: '#9e9e9e' }
];

// 已完成订单保留天数配置
const COMPLETED_ORDER_RETENTION_DAYS = 7;

// 发货→完成：必须在 1～3 天内完成（物流再快也不能当天签收，再慢也不超过 3 天）
const MIN_SHIP_TO_COMPLETE_HOURS = 24;  // 1 天
const MAX_SHIP_TO_COMPLETE_HOURS = 72;  // 3 天

// 初始游戏状态
const GAME_STATE_VERSION = 8;

// ==================== 游戏时间系统 v2（真实年月+大小月+闰年+星期+季节） ====================
// 游戏「第1天」= GAME_START_DATE 作为基准，用累计天数 totalDay 推算真实年月日
// 好处：
//   - 旧代码里到处都是 gameTime.day - xxxDays > threshold，不用改（totalDay 兼容旧语义）
//   - 新代码可用 year/month/monthDay 做真实日期判断（例如：每月1号发工资、春节/双11活动）

const GAME_START_DATE = Object.freeze({
    year: 2026,       // 起始年
    month: 8,         // 起始月：8月
    day: 1,           // 起始日：1号
    weekday: 6        // 起始星期：6 = 周六（2026年8月1日是周六）
});

// 闰年判断
function GAME_isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

// 每月天数（含大小月+闰年2月）
function GAME_daysInMonth(year, month) {
    const m = ((month - 1) % 12 + 12) % 12 + 1; // 防止负数，归一到1-12
    switch (m) {
        case 1: case 3: case 5: case 7: case 8: case 10: case 12: return 31;
        case 4: case 6: case 9: case 11: return 30;
        case 2: return GAME_isLeapYear(year) ? 29 : 28;
    }
    return 30;
}

// 中文月份名
const GAME_MONTH_NAMES = ['', '1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
const GAME_WEEKDAY_NAMES = ['', '周一','周二','周三','周四','周五','周六','周日'];
const GAME_SEASON_NAMES = { 3:'春季', 4:'春季', 5:'春季',  6:'夏季', 7:'夏季', 8:'夏季',  9:'秋季',10:'秋季',11:'秋季', 12:'冬季', 1:'冬季', 2:'冬季' };

/**
 * 从「累计天数 totalDay」反推真实年月日 + 月内日 + 星期 + 季节
 *  - totalDay = 1  → 返回 GAME_START_DATE 基准日期
 *  - totalDay = 32 → 自动跳到起始月后的次月对应日（含大小月）
 *  - weekDay 采用 1~7（周一到周日），保持与原 dayOfWeek 语义一致
 * @returns { year:number, month:number(1-12), monthDay:number(1-N), weekday:number(1-7), season:string }
 */
function GAME_fromTotalDays(totalDay) {
    let { year, month, day: monthDay, weekday } = GAME_START_DATE;
    let remain = Math.max(0, (totalDay || 1) - 1); // totalDay=1 时 remain=0，即基准日

    weekday = (((weekday - 1) + remain) % 7 + 7) % 7 + 1;  // 保持 1-7（周一到周日）

    while (remain > 0) {
        const dim = GAME_daysInMonth(year, month);
        if (monthDay + remain <= dim) {
            monthDay += remain;
            remain = 0;
        } else {
            remain -= (dim - monthDay + 1);
            monthDay = 1;
            if (month >= 12) { month = 1; year++; } else { month++; }
        }
    }
    const season = GAME_SEASON_NAMES[month] || '春季';
    return { year, month, monthDay, weekday, season, totalDay };
}

/**
 * 真实年月日 → 累计天数 totalDay（与 GAME_fromTotalDays 互逆）
 * 早于开局日期时返回 1
 */
function GAME_toTotalDays(year, month, monthDay) {
    const sy = GAME_START_DATE.year;
    const sm = GAME_START_DATE.month;
    const sd = GAME_START_DATE.day;
    const y = Number(year) || sy;
    const m = Number(month) || sm;
    const md = Number(monthDay) || 1;
    if (y < sy || (y === sy && m < sm) || (y === sy && m === sm && md < sd)) return 1;

    let cy = sy, cm = sm, cd = sd;
    let days = 0;
    while (cy < y || (cy === y && cm < m)) {
        days += GAME_daysInMonth(cy, cm) - cd + 1;
        cd = 1;
        cm++;
        if (cm > 12) { cm = 1; cy++; }
    }
    days += (md - cd);
    return days + 1;
}

/**
 * 对某个 gameTime 对象：基于 totalDay=day，写入 year/month/monthDay/weekday/season 真实日期字段
 *  - 老存档兼容：只有 day 老字段，其他不存在时会自动补齐
 *  - 调用方：loadFromStorage 之后、游戏初始化、每次跨天推进后
 */
function GAME_syncRealDateToGameTime(gt) {
    if (!gt) return;
    // 保底 day 字段（totalDay 语义）
    if (typeof gt.day !== 'number' || gt.day < 1) gt.day = 1;
    const real = GAME_fromTotalDays(gt.day);
    gt.year = real.year;
    gt.month = real.month;
    gt.monthDay = real.monthDay;
    gt.weekday = real.weekday;
    gt.season = real.season;
    gt.totalDay = gt.day;    // totalDay 作为 day 的别名（语义更清晰）
    // dayOfWeek 同步成 weekday（保持旧字段兼容，以前1=周一现在也1=周一）
    gt.dayOfWeek = real.weekday;
    return gt;
}

const INITIAL_GAME_TIME_V2 = (function initGameTime() {
    const base = {
        day: 1,        // 累计天数（兼容旧代码：gameTime.day - prevDay > 7 这种写法完全不用改）
        totalDay: 1,   // day 的别名（语义更清晰）
        hour: 8,
        dayOfWeek: GAME_START_DATE.weekday, // 星期（1-7，周一到周日）
        weekday: GAME_START_DATE.weekday,   // 新字段，和 dayOfWeek 同值
        speed: 1,
        isPaused: false
    };
    return GAME_syncRealDateToGameTime(base);
})();

/**
 * 统一格式化：把 gameTime 对象渲染成 UI 可读的时间字符串
 * 格式："2026年8月1日 周六 第1天 08:00"
 *   - 若提供 minute（0-59）则显示 ":00"/":30" 等具体分钟（用于 60fps 高刷新插值）
 *   - 若 showPaused=true 且当前已暂停，会追加 ⏸
 */
function GAME_formatGameTime(gt, { minute = null, showPaused = false, showSeason = false } = {}) {
    if (!gt) return '';
    // 如果缺失真实日期字段（比如 uiManager 初始化时还没跑 init），立即补齐再显示
    try { if (typeof gt.year !== 'number') GAME_syncRealDateToGameTime(gt); } catch (e) {}
    const y = gt.year || GAME_START_DATE.year;
    const m = gt.month || 1;
    const md = gt.monthDay || 1;
    const wd = GAME_WEEKDAY_NAMES[gt.weekday || gt.dayOfWeek || 1] || '周一';
    const day = gt.day || 1;
    const hh = String(gt.hour || 0).padStart(2, '0');
    const mm = (minute === null || minute === undefined) ? '00' : String(minute).padStart(2, '0');
    const season = gt.season || GAME_SEASON_NAMES[m] || '';
    const pauseStr = (showPaused && gt.isPaused) ? ' ⏸' : '';
    const seasonStr = showSeason ? ` ${season}` : '';
    return `${y}年${m}月${md}日 ${wd}${seasonStr} 第${day}天 ${hh}:${mm}${pauseStr}`;
}

const INITIAL_GAME_STATE = {
    version: GAME_STATE_VERSION,
    // 玩家个人信息（店主姓名+联系地址等）与玩家属性（合并：旧版两个 player 键，后者覆盖前者导致姓名/签到字段丢失）
    player: {
        name: '',          // 店主姓名，新游戏时必填
        avatar: '👨‍💼',      // 头像emoji
        gender: 'secret',  // 性别：male/female/secret
        birthday: '',      // 生日 MM-DD
        address: '',       // 详细地址（可选，与仓库城市配套）
        phone: '',         // 联系电话（可选）
        bio: '',           // 个人简介
        signInDays: 0,     // 累计签到天数
        lastSignInDay: 0,  // 上次签到日期
        continuousSignIn: 0, // 连续签到天数
        talent: 'normal',  // 开局天赋（TALENTS）
        talentBonus: {},   // 天赋被动加成 { trafficBonus, supplyDiscount, goodEventBonus }
        attributes: {
            operation: 1,
            selection: 1,
            negotiation: 1,
            management: 1,
            luck: 1
        },
        attributePoints: 0
    },
    shop: {
        name: '我的小店',
        level: 1,
        reputation: 0,
        funds: 9000000000000,
        rating: 5.0,
        totalOrders: 0,
        totalSales: 0,
        totalSalesAmount: 0,
        /** 营销利润提成自定义比率（null=走阶梯；0~0.2） */
        customCommissionRate: null,
        /** 员工经手订单提成（销售额 × 该比例，多人经手平分） */
        staffOrderCommissionRate: 0.001,
        entityType: 'individual',
        brandBadge: 'normal',
        legalCompensationMonth: 0,
        legalCompensationTotal: 0,
        platformBanUntilDay: 0,
        lastOpsRiskCheckDay: 0,
        lastOpsRiskPenalty: null
    },
    inventory: [],
    purchaseOrders: [],
    listings: [],
    orders: [],
    customerService: {
        consultations: [],
        returns: [],
        disputes: [],
        reviews: []
    },
    marketing: {
        activeCampaigns: [],
        celebrityEndorsements: [],
        promotionLogs: [],
        adBudget: 0
    },
    finance: {
        records: [],
        dailyStats: [],
        platformCommissionPaid: 0  // 累计交给平台的抽成总额
    },
    employees: [],
    // 薪酬管理系统
    payroll: {
        records: [],           // 工资发放记录
        salarySlips: [],       // 工资单明细（每个员工每次发薪一条）
        bonusConfig: {         // 奖金配置（配合月薪硬顶2500）
            attendance: { enabled: true, amount: 50 },
            meal: { enabled: true, amount: 80 },
            transport: { enabled: true, amount: 50 },
            highTemperature: { enabled: false, amount: 40 }
        },
        customBonuses: [],     // 自定义奖金/扣款记录
        customBonusTypes: [],  // 自定义奖金类型（名称+默认金额）
        overtimeRecords: [],   // 加班记录
        lastPayrollDay: 1,     // 上次发薪日
        payDay: 15             // 发薪日（每月15号）
    },
    tasks: [],
    redeemedCodes: [],
    // ⭐ gameTime v2：深拷贝，避免运行中污染 INITIAL_GAME_TIME_V2 导致「重新开始回不到第1天」
    gameTime: JSON.parse(JSON.stringify(INITIAL_GAME_TIME_V2)),
    lastSalaryPayDay: 1,
    statistics: {
        totalViews: 0,
        totalClicks: 0,
        totalConversions: 0,
        totalReturns: 0,
        totalDisputes: 0,
        totalProfit: 0,
        goodReviews: 0,
        badReviews: 0,
        aGradeOrders: 0,
        cGradeOrders: 0,
        nightOrders: 0,
        earlyOrders: 0
    },
    achievements: {
        unlocked: [],
        currentBuffs: []
    },
    events: {
        activeEvents: [],
        eventLog: [],
        lastEventDay: 0
    },
    buffs: {
        trafficMultiplier: 1.0,
        conversionMultiplier: 1.0
    },
    // 会员系统
    members: {
        total: 0,
        list: [],
        points: 0,
        growth: 0,              // 店铺会员成长值（用于店主自己的会员等级展示）
        memberLevel: 1,         // 店铺会员等级（店主视角）
        pointsLogs: [],         // 积分变动记录
        growthLogs: [],         // 成长值变动记录
        redeemHistory: [],
        totalPointsRedeemed: 0,
        totalPointsEarned: 0,
        freeShipCredits: 0,
        activitiesJoined: [],   // 已参与活动
        // 权益系统（卖家可配置版）
        benefitsConfig: null,   // 权益配置（null时使用默认配置，首次初始化）
        benefitsStats: null,    // 权益统计数据
        redeemOrders: [],       // 兑换订单记录（完整的兑换流程记录）
        memberBenefits: [],     // 会员已获得的权益（如优惠券、服务时长等）
        recharge: null,         // 顾客储值：开关 + 充送规则（首次进入用默认）
        rechargeLogs: [],
        statistics: {
            activeMembers: 0,        // 活跃会员（近7天有订单）
            newMembersThisMonth: 0,  // 本月新增
            totalRecharge: 0,        // 总储值实付
            totalRechargeBonus: 0,   // 累计赠送金
            averageSpent: 0          // 人均消费
        }
    },
    // 优惠券系统
    coupons: {
        templates: [],           // 优惠券模板（商家创建）
        userCoupons: [],         // 用户已领取的优惠券
        statistics: {
            totalIssued: 0,      // 总发行量
            totalReceived: 0,    // 总领取量
            totalUsed: 0,        // 总使用量
            totalExpired: 0,     // 总过期量
            totalDiscount: 0     // 优惠总金额
        },
        lastCheckDay: 0         // 上次过期检查日
    },
    // 仓储系统
    warehouse: {
        level: 1,
        usedCapacity: 0,
        city: 'yiwu',
        startCapacityBonus: 0,
        lowStockThreshold: 20,
        lastCheckDay: 0,
        logs: [],
        // 包装材料库存（包材精简：6 种核心材料）
        packagingMaterials: {
            carton: 30,
            bubbleWrap: 40,
            tape: 5,
            thermal_label: 5,
            fragile_label: 2,
            ice_pack: 10
        },
        // 包装材料采购记录
        packagingLogs: [],
        // 储位使用（简化）
        zones: {
            receiving: { capacity: 20, used: 0 },
            storage: { capacity: 0, used: 0 },
            packing: { capacity: 30, used: 0 },
            shipping: { capacity: 20, used: 0 }
        }
    },
    // 市场行情系统（带缓存+EMA平滑+日更新）
    market: {
        lastUpdateDay: 0,                 // 最近一次行情更新的游戏日
        snapshots: {}                     // productId -> {competitors, priceHistory:[{day,avg,low,high}]}
    },
    // 银行系统
    bank: {
        savings: 0,
        fixedDeposits: [],
        loans: [],
        creditLimit: 10000,
        transactionHistory: [],
        lastInterestDay: 0
    },
    // 促销系统
    promotions: {
        campaigns: [],
        active: [],           // ⭐ 缺失补全：当前生效中的促销（flashSale/fullReduction/groupBuy），供simulateBusiness直接遍历
        activeIds: [],
        userCoupons: [],
        participationRecords: [],
        history: [],          // ⭐ 缺失补全：已结束的促销历史，供endPromotion归档
        statistics: {
            totalCampaigns: 0,
            totalParticipants: 0,
            totalDiscountAmount: 0,
            totalSalesFromPromo: 0,
            totalCouponsIssued: 0,
            totalCouponsUsed: 0
        },
        antiFraud: {
            orderTimestamps: [],
            couponClaimTimestamps: [],
            suspiciousUsers: {},
            blacklistedUsers: {}
        },
        lastCleanupDay: 0
    },
    // 供应商关系
    supplierRelations: {},
    // 直播系统
    livestream: {
        isLive: false,
        streamer: null,
        viewers: 0,
        peakViewers: 0,
        duration: 0,
        plannedDuration: 4,
        totalSales: 0,
        orderCount: 0,
        productIds: [],
        startTime: null,
        history: [],
        settings: {
            autoEnd: true,
            showDiscount: true,
            discountRate: 0.9
        },
        // ===== IP养成（P0）：与 liveData.INITIAL_LIVESTREAM_STATE 同步（liveState.init 会 merge 兜底）=====
        fans: { casual: 0, loyal: 0, true: 0, profile: {} },
        daily: { day: 0, used: 0 },
        heat: 30,
        topicId: 'mixed',
        topic: null,
        fansGained: 0,
        interactions: { taps: 0, correct: 0, wrong: 0 },
        currentQuestion: null,
        activeFans: { count: 0, expireDay: 0, expireHour: 0, dayOrdersUsed: 0, dayOrdersMax: 0, lastOrderDay: 0, lastCheckDay: 0, lastCheckHour: 0 },
        settlement: null,
        lastLiveDay: 0,
        startTimeReal: null
    },
    // 店铺装修
    storeDesign: {
        template: 'default',
        quality: 1
    },
    // 组合商品
    combos: [],
    // 包装材料库存（包材精简：6 种核心材料）
    packagingMaterials: {
        carton: 0,
        bubbleWrap: 0,
        tape: 0,
        thermal_label: 0,
        fragile_label: 0,
        ice_pack: 0
    },
    // 订单管理配置
    orderConfig: {
        // 已完成订单保留天数（超过则自动清理）
        completedRetentionDays: 7,
        // 是否启用自动清理
        autoCleanEnabled: true,
        // 清理方式：'hide'=前端隐藏, 'delete'=彻底删除
        cleanMode: 'hide',
        // 上次清理日期
        lastCleanupDay: 0,
        // 清理日志（最多保留100条）
        cleanupLogs: [],
        // 待付款订单超时时间（小时），超时自动取消
        pendingPaymentTimeout: 1
    },
    // ==================== 修改2a：全局设置（含货源断供免打扰开关）====================
    settings: {
        supplyOutageSilentMode: false,
        supplyOutageNotifyLevel: 'all',
        soundEnabled: true,
        bgmEnabled: false,
        bgmVolume: 0.35,
        lastAdSignInDay: 0,  // 广告激励签到上次领取的游戏日
        // 跳一天：看激励广告每次 +5
        skipDayQuota: 50,
        leaderboardRefreshQuota: 50
    },
    // 海外贸易
    overseas: {
        unlocked: false,
        shipments: [],
        inquiries: [],
        orders: [],
        pendingSettlements: [],
        regulations: [],
        stats: { exportRevenue: 0, shipmentCount: 0, dutyPaid: 0, freightPaid: 0 }
    },
    // 员工宿舍（可重复购买楼栋，床位累加）
    housing: {
        level: 0,
        beds: 0,
        buildings: [],
        assigned: {},
        monthlyRentPerBed: 180,
        satisfaction: 60
    },
    // 货物管制（禁售/禁购）
    productControls: {
        bans: []
    },
    // ==================== 修改2a：货源断供 digest 缓存（每日汇总用）====================
    _supplyOutageDigest: {
        day: 0,
        count: 0,
        lastNames: []
    },
    // 结局
    ending: null,
    gameOver: false
};

// 物流状态（var避免与express模块的新定义冲突，expressData会覆盖为更完善的对象格式）
var LOGISTICS_STATUS = [
    { code: 'pending', name: '待发货', color: '#ff9800' },
    { code: 'shipped', name: '已发货', color: '#2196f3' },
    { code: 'in_transit', name: '运输中', color: '#9c27b0' },
    { code: 'delivered', name: '已送达', color: '#4caf50' },
    { code: 'signed', name: '已签收', color: '#8bc34a' },
    { code: 'lost', name: '已丢失', color: '#f44336' },
    { code: 'returned', name: '已退货', color: '#f44336' }
];

// 快递选项配置
const EXPRESS_OPTIONS = {
    economy: {
        id: 'economy',
        name: '经济型快递',
        shortName: '经济型',
        basePrice: 5,
        pricePerKg: 2,
        estimatedDays: 3,
        deliveryHoursMin: 48,
        deliveryHoursMax: 72,
        lossRate: 0.003,
        description: '价格实惠，存在极小概率的包裹丢失风险',
        warning: '存在极小概率的包裹丢失风险，丢失后将按商品价值赔付50%',
        companies: ['中通快递', '圆通速递', '韵达快递', '申通快递'],
        color: '#4caf50'
    },
    standard: {
        id: 'standard',
        name: '标准型快递',
        shortName: '标准型',
        basePrice: 10,
        pricePerKg: 3,
        estimatedDays: 2,
        deliveryHoursMin: 24,
        deliveryHoursMax: 48,
        lossRate: 0,
        description: '安全可靠，时效稳定，全程保价',
        warning: '',
        companies: ['顺丰速运', '京东物流'],
        color: '#2196f3'
    }
};

// ============================================================
// 包装系统 v2 配置（按真实电商场景，根据「商品品类×重量×特殊属性」
//              自动匹配外包装+缓冲+封装+标签+冷链耗材
// ============================================================
const PACKAGING_CONFIG = {
    // ====== 手工打包劳务费（仅在有打包员工时 = 0）======
    packFee: {
        base: 1.5,        // 基础劳务费（拆包/打包/贴面单）
        perItem: 0.2       // 多件附加打包
    },

    // ====== 旧版 materialCost（保留兼容（仅库存完全没买材料时才用）======
    materialCost: {
        base: 1,
        perItem: 0.5,
        fragileMultiplier: 2
    },

    // ====== 易碎品类（判定是否需要气泡膜/气柱袋 + 易碎贴）
    fragileCategories: ['digital', 'beauty', 'food', '陶瓷', '玻璃', '家居摆件', 'home'],
    fragileNameKeywords: ['陶瓷', '玻璃', '碗', '杯', '瓶', '显示器', '屏幕', '镜头', '水晶', '红酒', '香槟'],

    // ====== 冷链 / 生鲜品类（需冰袋+干燥剂+泡沫箱）
    coldChainCategories: ['food'],
    coldChainNameKeywords: ['海鲜', '牛排', '肉', '冰淇淋', '冷', '鲜', '榴莲', '车厘子', '牛奶', '酸奶', '冷冻', '雪糕'],

    // ====== 高价值品类（需防伪扣 + 干燥剂 + 缓冲加强）
    highValueThreshold: 500,    // 单价 ≥ 此值视为高价值
    highValueCategories: [],
    highValueNameKeywords: ['珠宝', '手表', '球鞋', '真皮', '奢侈品', '黄金', '钻石', '手表', '相机', '镜头'],

    // ====== 长条/大件品类（需护角+缠绕膜+打包带+珍珠棉）
    heavyWeightThreshold: 7,       // 单订单总重 ≥ 7kg 视为大件（需要护角+打包带
    heavyNameKeywords: ['空调', '电视', '冰箱', '洗衣机', '油烟机', '燃气灶', '沙发', '床垫', '家具', '钢琴'],
    longNameKeywords: ['雨伞', '长柄', '拐杖', '鱼竿', '海报', '卷轴', '长筒', '笛子', '剑', '高尔夫'],

    // ====== 服饰/家纺品类（优先用快递袋，不用纸箱）
    softCategories: ['clothing'],
    flatNameKeywords: ['画册', '相册', '海报', '鼠标垫', '书', '杂志'],

    // ====== 外包装选择规则（按总重量选纸箱 ID ======
    // 优先级：形状 > 品类 > 重量。cartonSelector 会在 getPackagingFormula() 里按此规则选
    outerBoxByWeight: [
        { maxKg: 0.2,  boxId: 'carton_small',   name: '迷你邮政箱7号' },
        { maxKg: 1.5,  boxId: 'carton_small', name: '迷你邮政箱7号' },
        { maxKg: 5,    boxId: 'carton',       name: '标准纸箱3号' },
        { maxKg: 15,   boxId: 'carton_large',  name: '大号纸箱1号' },
        { maxKg: 999,  boxId: 'carton_large', name: '大号纸箱1号' }
    ],

    // ====== 品类专属包装覆盖（优先级高于重量规则；已精简为纸箱/快递袋）
    categoryOuterOverride: {
        // 服饰 → 快递袋（软包装）
        clothing: { soft: 'courier_bag', weight: [0, 5] },
        // 美妆小件 → 快递袋 / 标准纸箱
        beauty: { soft: 'courier_bag', weight: [0, 1], hard: 'carton', hardWeight: [1, 5] },
        // 数码小件 → 快递袋 / 标准纸箱
        digital: { soft: 'courier_bag', weight: [0, 0.8], hard: 'carton', hardWeight: [0.8, 5] },
        // 食品干货 → 标准纸箱 + 干燥剂
        food: { hard: 'carton', hardWeight: [0, 999] }
    },

    // ====== 缓冲材料：品类默认（精简后仅气泡膜 / 珍珠棉）======
    cushioningRules: {
        // 易碎/数码美妆：气泡膜，默认 0.4m 基础 + 0.2m/件
        fragile:  { type: 'bubbleWrap', base: 0.4, perItem: 0.2, fragileBoost: 1.8 },
        // 3C/家电大件：EPE珍珠棉板材
        digital_heavy: { type: 'epe_foam', base: 0.5, perItem: 0.2 },
        // 一般缓冲：气泡膜
        normal:   { type: 'bubbleWrap', base: 0.3, perItem: 0.15 },
        // 高端饮品：气泡膜加量
        drinks:  { type: 'bubbleWrap', base: 0.5, perItem: 0.3 }
    },

    // ====== 封装材料：每单必定消耗（1卷胶带=91米 ≈ 0.05卷/单）======
    sealingDefaults: {
        tapeBase: 0.05,      // 卷胶带 / 每单
        tapePerExtraKg: 0.01  // 每超 1kg 再加
    },

    // ====== 标签面单：每单必定 1 张 ======
    labelPerOrder: 1
};

/**
 * 包装材料消耗数量归一（库存单位一致）：
 * - 面单/易碎贴等「按张计价、按包/卷库存」：按张粒度向上取整，禁止 Math.ceil 成整包
 * - 卷/米/kg/包：保留 3 位小数向上
 * - 个/根：取整
 */
function normalizePackagingConsumeQty(mat, qty) {
    let v = Number(qty);
    if (!isFinite(v) || v <= 0) return 0;
    const packSheets = Number(mat && mat.spec && mat.spec.quantity) || 0;
    const unit = (mat && mat.unit) || '';
    const isSheetStock = packSheets > 1 && (unit === '包' || unit === '卷');
    if (isSheetStock) {
        const sheetUnit = 1 / packSheets;
        v = Math.ceil(v / sheetUnit - 1e-9) * sheetUnit;
        return Math.round(v * 10000) / 10000;
    }
    if (unit === '卷' || unit === '米' || unit === 'kg' || unit === '包') {
        return Math.ceil(v * 1000 - 1e-9) / 1000;
    }
    if (unit === '个' || unit === '根') {
        return Math.ceil(v - 1e-9);
    }
    // 未标注单位的小数消耗（如旧配方）保留 3 位；≥1 按件向上取整
    if (v < 1) return Math.ceil(v * 1000 - 1e-9) / 1000;
    return Math.ceil(v - 1e-9);
}
if (typeof window !== 'undefined') {
    window.normalizePackagingConsumeQty = normalizePackagingConsumeQty;
}

// ============================================================
// 全局工具：根据商品 + 订单数量 + 总重 + 包装等级
// 生成「真实要用到的所有包装材料清单 + 数量」
// 调用方：calculatePackagingMaterialFee() + consumePackagingMaterialsSmart()
// 保证两边 100% 一致，杜绝"库存够不扣费，实际扣别的"矛盾
// ============================================================
function getPackagingFormula(product, orderQty, totalWeightKg, packagingLevel = 'standard') {
    // ============================================================
    // 3.6 极简配方：只用 3 种核心材料
    //   每单固定：纸箱×1 + 胶带 0.05 卷
    //   缓冲：气泡膜 0.3 米 + 0.15 米/件（易碎 ×1.8、冷链 +1 米）
    //   面单/易碎贴/冰袋：不再作为耗材（快递公司提供面单，减少管理负担）
    //   包装等级：仅微调气泡膜用量（高级×1.3 / 环保×0.6）
    // ============================================================
    const cfg = PACKAGING_CONFIG;
    const formula = {};
    const flags = { fragile: false, cold: false, highValue: false, heavy: false, long: false, flat: false, soft: false };
    const pname = (product && product.name) || '';
    const pcat = (product && product.category) || '';
    orderQty = Math.max(1, orderQty | 0);
    if (totalWeightKg == null || isNaN(totalWeightKg)) totalWeightKg = 0.5;

    // ---- 两个关键标志：易碎 / 冷链 ----
    if ((cfg.fragileCategories || []).includes(pcat)
        || (cfg.fragileNameKeywords || []).some(k => pname.includes(k))) flags.fragile = true;
    if ((cfg.coldChainCategories || []).includes(pcat)
        || (cfg.coldChainNameKeywords || []).some(k => pname.includes(k))) flags.cold = true;

    // ---- 每单固定消耗（仅 3 种材料）----
    formula.carton = 1;                    // 1 个标准纸箱
    formula.tape = 0.05;                   // 0.05 卷胶带

    // ---- 缓冲：0.3米 + 0.15米/件（易碎加量、冷链加厚）----
    let bubble = 0.3 + 0.15 * orderQty;
    if (flags.fragile) bubble *= 1.8;
    if (flags.cold) bubble += 1;
    formula.bubbleWrap = bubble;

    // ---- 包装等级（仅微调缓冲量） ----
    if (packagingLevel === 'premium') formula.bubbleWrap = (formula.bubbleWrap || 0) * 1.3;
    else if (packagingLevel === 'eco') formula.bubbleWrap = Math.max(0.1, (formula.bubbleWrap || 0) * 0.6);

    // ---- 别名归一 + 数量按库存单位取整 ----
    if (typeof PACKAGING_MATERIAL_ALIASES !== 'undefined' && PACKAGING_MATERIAL_ALIASES) {
        Object.keys(formula).forEach(k => {
            const to = PACKAGING_MATERIAL_ALIASES[k];
            if (!to || to === k) return;
            formula[to] = (formula[to] || 0) + (formula[k] || 0);
            delete formula[k];
        });
    }
    Object.keys(formula).forEach(k => {
        const v = formula[k];
        if (!v || v <= 0) { delete formula[k]; return; }
        const mat = (typeof PACKAGING_MATERIALS !== 'undefined' && PACKAGING_MATERIALS)
            ? PACKAGING_MATERIALS[k] : null;
        formula[k] = (typeof normalizePackagingConsumeQty === 'function')
            ? normalizePackagingConsumeQty(mat, v)
            : (v < 1 ? Math.ceil(v * 1000 - 1e-9) / 1000 : Math.ceil(v - 1e-9));
    });

    return { formula, flags, outerBoxId: 'carton', useSoftBag: false, packagingLevel };
}

// 防刷机制配置
const ANTI_FRAUD_CONFIG = {
    minOrderInterval: 60,        // 最小下单间隔（秒）
    maxOrdersPerHour: 20,       // 每小时最大下单数
    maxCouponClaimPerHour: 5,   // 每小时最多领取优惠券数量
    ipCooldownMinutes: 5,       // IP冷却时间（分钟）
    suspiciousThreshold: 50     // 可疑行为阈值
};

// 促销活动默认配置
const PROMOTION_DEFAULTS = {
    // 满减默认阶梯
    fullReductionTiers: [
        { threshold: 99, discount: 10 },
        { threshold: 199, discount: 25 },
        { threshold: 399, discount: 60 }
    ],
    // 折扣默认范围
    discountRange: { min: 0.5, max: 0.95 },
    // 优惠券默认面额
    couponDenominations: [5, 10, 20, 50, 100],
    // 秒杀默认库存
    flashSaleDefaultStock: 100,
    // 包邮默认门槛
    freeShippingThreshold: 99
};

// 促销统计维度
const PROMOTION_STATS_DIMENSIONS = {
    OVERVIEW: 'overview',
    HOURLY: 'hourly',
    DAILY: 'daily',
    BY_PRODUCT: 'by_product',
    BY_USER: 'by_user'
};

// ==================== 竞争对手/市场行情 ====================
const COMPETITOR_NAMES = [
    '诚信小铺', '优品汇', '好物精选', '实惠到家', '品质生活',
    '便宜有好货', '天天特价', '品牌折扣店', '工厂直营店', '老字号',
    '网红推荐店', '明星同款', '海外代购', '保税仓直发', '官方旗舰店',
    '达人严选', '源头好货', '性价比之王', '亏本清仓', '新品特惠'
];

const COMPETITOR_PREFIXES = [
    '【旗舰店】', '【官方】', '【正品】', '【特惠】', '【爆款】',
    '【热销】', '【新品】', '【限时】', '【秒杀】', '【直供】', ''
];

function generateCompetitorPrice(product, quality = 'B') {
    // 优化方案①：价格乘数从 [1.2,2.5]（超大幅）收窄到 [0.9,1.6]（电商真实合理利润区间）
    const basePrice = product.basePrice;
    const gradeInfo = QUALITY_GRADES[quality] || QUALITY_GRADES.B;
    const cost = basePrice * gradeInfo.priceMultiplier;
    const multiplier = randomFloat(0.9, 1.6);
    return parseFloat((cost * multiplier).toFixed(2));
}

/**
 * 生成"稳定商家基础信息"：名称+品质固定，之后不再随机变化。
 * 只有价格会随每日行情通过EMA平滑更新。
 */
function generateStableCompetitorBase(product, count = 5) {
    const bases = [];
    const usedNames = new Set();
    const qualities = ['A', 'B', 'C'];
    const qualityWeights = [0.2, 0.55, 0.25]; // A品20%/B品55%/C品25% 真实分布
    for (let i = 0; i < count; i++) {
        let name;
        do {
            const baseName = randomChoice(COMPETITOR_NAMES);
            const prefix = randomChoice(COMPETITOR_PREFIXES);
            name = prefix + baseName;
        } while (usedNames.has(name));
        usedNames.add(name);
        const r = Math.random();
        let quality = 'B';
        if (r < qualityWeights[0]) quality = 'A';
        else if (r < qualityWeights[0] + qualityWeights[1]) quality = 'B';
        else quality = 'C';
        bases.push({
            id: 'comp_' + product.id + '_' + i,
            name: name,
            productId: product.id,
            quality: quality,
            baseSales: randomInt(20, 2500)
        });
    }
    return bases;
}

/**
 * EMA平滑+硬限制单日波动：
 *   70% 旧价格权重 + 30% 新目标价（随机扰动）
 *   单日硬上限：±3%
 *   月度区间约束：相对成本价的 ±15% 范围（避免偏离太远）
 */
function smoothPriceUpdate(oldPrice, costPrice) {
    const targetDeltaPct = randomFloat(-0.06, 0.06);      // 目标波动±6%
    const targetPrice = oldPrice * (1 + targetDeltaPct);
    // EMA 7:3 平滑
    let newPrice = oldPrice * 0.7 + targetPrice * 0.3;
    // 单日硬限制：±3%（防止跳变）
    const dailyMax = oldPrice * 1.03;
    const dailyMin = oldPrice * 0.97;
    newPrice = Math.max(dailyMin, Math.min(dailyMax, newPrice));
    // 月度区间约束：不低于成本价*0.85，不高于成本价*1.9
    const floor = costPrice * 0.85;
    const ceil = costPrice * 1.9;
    newPrice = Math.max(floor, Math.min(ceil, newPrice));
    return parseFloat(newPrice.toFixed(2));
}

/**
 * 兼容旧API：直接返回带价格、销量的完整竞争对手列表
 * 新版推荐使用 gameState.getOrCreateMarketSnapshot 代替（带缓存+EMA平滑）
 */
function generateCompetitors(product, count = 5) {
    const bases = generateStableCompetitorBase(product, count);
    return bases.map(b => {
        const gradeInfo = QUALITY_GRADES[b.quality] || QUALITY_GRADES.B;
        const cost = product.basePrice * gradeInfo.priceMultiplier;
        return {
            ...b,
            price: generateCompetitorPrice(product, b.quality),
            sales: b.baseSales,
            _cost: cost,
            isSelf: false
        };
    }).sort((a, b) => a.price - b.price);
}

// ==================== 快递运费阶梯折扣（单量 + 店铺等级 + 品牌） ====================
// 必须同时满足：累计运单、店铺等级、品牌标识，才进入该档。
// 4 折：累计 20 万单 + 店铺 Lv.6 皇冠 + 黑金标识。
const EXPRESS_BRAND_RANK = { normal: 0, flagship: 1, gold: 2, black_gold: 3 };
const EXPRESS_SUCCESS_ORDER_DISCOUNTS = [
    { minCompleted: 0,      minShopLevel: 1,  minBrand: 'normal',     discount: 1.00, label: '10折' },
    { minCompleted: 2000,   minShopLevel: 1,  minBrand: 'normal',     discount: 0.95, label: '9.5折' },
    { minCompleted: 5000,   minShopLevel: 2,  minBrand: 'normal',     discount: 0.90, label: '9折' },
    { minCompleted: 10000,  minShopLevel: 2,  minBrand: 'normal',     discount: 0.85, label: '8.5折' },
    { minCompleted: 20000,  minShopLevel: 3,  minBrand: 'flagship',   discount: 0.80, label: '8折' },
    { minCompleted: 35000,  minShopLevel: 3,  minBrand: 'flagship',   discount: 0.75, label: '7.5折' },
    { minCompleted: 50000,  minShopLevel: 4,  minBrand: 'flagship',   discount: 0.70, label: '7折' },
    { minCompleted: 70000,  minShopLevel: 4,  minBrand: 'gold',       discount: 0.65, label: '6.5折' },
    { minCompleted: 90000,  minShopLevel: 5,  minBrand: 'gold',       discount: 0.60, label: '6折' },
    { minCompleted: 110000, minShopLevel: 5,  minBrand: 'gold',       discount: 0.55, label: '5.5折' },
    { minCompleted: 140000, minShopLevel: 6,  minBrand: 'black_gold', discount: 0.50, label: '5折' },
    { minCompleted: 170000, minShopLevel: 6,  minBrand: 'black_gold', discount: 0.45, label: '4.5折' },
    { minCompleted: 200000, minShopLevel: 6,  minBrand: 'black_gold', discount: 0.40, label: '4折' }
];
const EXPRESS_GLOBAL_MIN_DISCOUNT = 0.40;

function getExpressBrandRank(badgeId) {
    const map = (typeof EXPRESS_BRAND_RANK !== 'undefined') ? EXPRESS_BRAND_RANK : {};
    const n = map[badgeId];
    return (typeof n === 'number') ? n : 0;
}

function getExpressBrandName(badgeId) {
    try {
        if (typeof getBrandBadgeById === 'function') {
            const b = getBrandBadgeById(badgeId);
            if (b && b.name) return (b.icon ? b.icon + ' ' : '') + b.name;
        }
    } catch (_) {}
    const names = { normal: '普通', flagship: '旗舰', gold: '金标', black_gold: '黑金' };
    return names[badgeId] || '普通';
}

function resolveExpressVolumeDiscount(completed, shopLevel, brandId) {
    const list = (typeof EXPRESS_SUCCESS_ORDER_DISCOUNTS !== 'undefined' && EXPRESS_SUCCESS_ORDER_DISCOUNTS.length)
        ? EXPRESS_SUCCESS_ORDER_DISCOUNTS
        : [{ minCompleted: 0, minShopLevel: 1, minBrand: 'normal', discount: 1, label: '10折' }];
    const minFloor = (typeof EXPRESS_GLOBAL_MIN_DISCOUNT === 'number') ? EXPRESS_GLOBAL_MIN_DISCOUNT : 0.40;
    const orders = Math.max(0, Number(completed) || 0);
    const lv = Math.max(1, parseInt(shopLevel, 10) || 1);
    const brand = brandId || 'normal';
    const brandRank = getExpressBrandRank(brand);

    function qualifies(tier) {
        if (!tier) return false;
        if (orders < (Number(tier.minCompleted) || 0)) return false;
        if (lv < (Number(tier.minShopLevel) || 1)) return false;
        if (getExpressBrandRank(tier.minBrand) > brandRank) return false;
        return true;
    }

    let current = list[0];
    let nextLocked = null;
    for (let i = 0; i < list.length; i++) {
        if (qualifies(list[i])) current = list[i];
        else if (!nextLocked && list[i].discount < (current.discount || 1)) nextLocked = list[i];
    }

    const need = [];
    if (nextLocked) {
        const missOrders = Math.max(0, (Number(nextLocked.minCompleted) || 0) - orders);
        if (missOrders > 0) need.push('再发 ' + missOrders.toLocaleString() + ' 单');
        if (lv < (nextLocked.minShopLevel || 1)) need.push('店铺升到 Lv.' + nextLocked.minShopLevel);
        if (getExpressBrandRank(nextLocked.minBrand) > brandRank) need.push('品牌升到' + getExpressBrandName(nextLocked.minBrand));
    }

    const four = list[list.length - 1];
    const fourNeed = [];
    if (four) {
        const miss4 = Math.max(0, (Number(four.minCompleted) || 0) - orders);
        if (miss4 > 0) fourNeed.push('累计运单 ' + Number(four.minCompleted).toLocaleString() + '（还差 ' + miss4.toLocaleString() + '）');
        else fourNeed.push('累计运单已满 ' + Number(four.minCompleted).toLocaleString());
        if (lv < (four.minShopLevel || 6)) {
            let shopName = '';
            try {
                if (typeof SHOP_LEVELS !== 'undefined' && SHOP_LEVELS[four.minShopLevel - 1]) {
                    shopName = SHOP_LEVELS[four.minShopLevel - 1].name || '';
                }
            } catch (_) {}
            fourNeed.push('店铺 Lv.' + four.minShopLevel + (shopName ? ' ' + shopName : ''));
        }
        if (getExpressBrandRank(four.minBrand) > brandRank) fourNeed.push('品牌「' + getExpressBrandName(four.minBrand) + '」');
    }

    const discount = Math.max(minFloor, Number(current.discount) || 1);
    return {
        discount: Math.round(discount * 10000) / 10000,
        completedCount: orders,
        shopLevel: lv,
        brandId: brand,
        brandName: getExpressBrandName(brand),
        label: current.label,
        currentTier: current,
        nextTier: nextLocked ? {
            ordersNeeded: Math.max(0, (Number(nextLocked.minCompleted) || 0) - orders),
            label: nextLocked.label,
            minCompleted: nextLocked.minCompleted,
            minShopLevel: nextLocked.minShopLevel,
            minBrand: nextLocked.minBrand,
            needText: need.join(' · ')
        } : null,
        fourFold: four ? {
            minCompleted: four.minCompleted,
            minShopLevel: four.minShopLevel,
            minBrand: four.minBrand,
            unlocked: qualifies(four),
            needText: fourNeed.join(' + ')
        } : null
    };
}

// 买家评价模板（短句 + 碎片拼接，避免每条都一个味）
const REVIEW_TEMPLATES = {
    positive: [
        '质量很好，非常满意！',
        '物流很快，包装也不错',
        '性价比很高，还会再来',
        '卖家服务态度好，推荐购买',
        '比想象中还要好，好评！',
        '拆开就很惊喜，手感在线',
        '第二次回购了，稳',
        '给朋友也安利了，靠谱',
        '包装严实，一点磕碰都没有',
        '颜色比图片还正，爱了',
        '客服回复挺快，问啥答啥',
        '这个价能买到这样真的可以',
        '家里人看了也说不错',
        '用了两天没毛病，先好评',
        '发货利索，隔天就到了'
    ],
    neutral: [
        '一般般吧，符合预期',
        '质量还可以，发货有点慢',
        '中规中矩，没什么特别的',
        '还行，价格不算贵',
        '能用，但谈不上惊艳',
        '跟描述差不多，不多也不少',
        '包装普通，东西本身还行',
        '有点小瑕疵，凑合着过',
        '物流一般，东西还算对得起价',
        '先用着看，暂时给三星',
        '说明书有点简陋，功能够用',
        '没有差到要退，也没有好到安利'
    ],
    negative: [
        '质量太差了，不满意',
        '货不对板，跟图片不一样',
        '发货太慢了，等了好久',
        '客服态度差，不会再来',
        '虚假宣传，差评！',
        '到货就有划痕，无语',
        '味道怪怪的，不敢用',
        '尺寸差一截，完全不对',
        '快递扔门口，盒子都瘪了',
        '问了三次才回一句，醉了',
        '用了一天就出问题',
        '感觉像翻新货，心塞'
    ]
};

const REVIEW_FRAGMENTS = {
    open: [
        '到货了。', '刚拆完。', '用了两天来说两句。', '随便评一下。',
        '对比了好几家才买的。', '抱着试试的心态。', '朋友推荐来的。',
        '深夜下单的，', '凑单顺手买的，', '看直播种草的，'
    ],
    productGood: [
        '东西本身挺扎实', '做工比预期好', '手感可以', '外观在线',
        '功能都正常', '细节还算用心', '和描述基本对得上'
    ],
    productMid: [
        '东西中规中矩', '能用但不精致', '有点廉价感', '跟图片有色差',
        '配件一般', '说明书看不懂', '重量比想象中轻'
    ],
    productBad: [
        '品控不行', '和主图差太多', '边角都毛躁', '一股异味',
        '按键松垮', '感觉是库存货'
    ],
    logisticsGood: ['物流很快', '包装很严实', '快递员态度不错', '时效可以'],
    logisticsMid: ['物流一般般', '在路上晃了挺久', '包装普通', '派件有点磨蹭'],
    logisticsBad: ['物流太慢了', '箱子都破了', '扔驿站也不通知', '中转了好几次'],
    serviceGood: ['客服好说话', '问题回复及时', '售后肯管'],
    serviceMid: ['客服爱用复制粘贴', '问了才回', '态度还行但没用'],
    serviceBad: ['客服爱理不理', '踢皮球', '想退都费劲'],
    closeGood: ['会再来。', '给好评。', '推荐入手。', '值这个价。', '先好评，坏了再来。'],
    closeMid: ['凑合。', '先观望。', '看后期耐不耐用。', '三星吧。', '不推荐也不踩。'],
    closeBad: ['不回购了。', '建议慎重。', '准备退。', '太失望。', '避雷。']
};

function composeBuyerReview(kind, ctx) {
    const k = kind === 'negative' ? 'negative' : (kind === 'neutral' ? 'neutral' : 'positive');
    const name = (ctx && ctx.productName) ? String(ctx.productName) : '';
    const F = (typeof REVIEW_FRAGMENTS !== 'undefined') ? REVIEW_FRAGMENTS : {};
    const pick = (arr) => (arr && arr.length) ? arr[Math.floor(Math.random() * arr.length)] : '';
    const mood = Math.random();

    if (mood < 0.42 && typeof REVIEW_TEMPLATES !== 'undefined' && REVIEW_TEMPLATES[k]) {
        let t = pick(REVIEW_TEMPLATES[k]);
        if (name && Math.random() < 0.35) t = name + '，' + t;
        if (Math.random() < 0.18) t += (Math.random() < 0.5 ? '～' : '…');
        return t;
    }

    const prod = k === 'negative' ? F.productBad : (k === 'neutral' ? F.productMid : F.productGood);
    const logi = k === 'negative' ? F.logisticsBad : (k === 'neutral' ? F.logisticsMid : F.logisticsGood);
    const svc = k === 'negative' ? F.serviceBad : (k === 'neutral' ? F.serviceMid : F.serviceGood);
    const close = k === 'negative' ? F.closeBad : (k === 'neutral' ? F.closeMid : F.closeGood);
    const parts = [];
    if (Math.random() < 0.55) parts.push(pick(F.open));
    if (name && Math.random() < 0.4) parts.push('买的' + name + '。');
    parts.push(pick(prod));
    if (Math.random() < 0.7) parts.push(pick(logi));
    if (Math.random() < 0.45) parts.push(pick(svc));
    if (Math.random() < 0.75) parts.push(pick(close));
    let text = parts.filter(Boolean).join(Math.random() < 0.35 ? '，' : '。');
    text = text.replace(/。+/g, '。').replace(/，+/g, '，').replace(/。，/g, '。').replace(/，$/, '。');
    if (text && !/[。！？…～]$/.test(text)) text += (Math.random() < 0.4 ? '。' : '');
    if (Math.random() < 0.12) text += (Math.random() < 0.5 ? ' 哈哈' : ' 嗯');
    return text || pick((typeof REVIEW_TEMPLATES !== 'undefined' && REVIEW_TEMPLATES[k]) || ['还行']);
}

// 随机买家名字
const BUYER_NAMES = [
    '小明同学', '快乐购物者', '资深买家', '精致生活家', '省钱小能手',
    '购物达人', '品质追求者', '理性消费者', '剁手党', '精明买家',
    '新手上路', '老顾客了', '回头客一号', '忠实粉丝', '挑剔的买家',
    '随缘购物', '颜控患者', '性价比党', '品牌拥护者', '尝鲜爱好者',
    '奶茶续命', '熬夜冠军', '打工人小王', '社恐青年', '月光族小李',
    '吃货小张', '宅家达人', '网瘾少年', '文艺青年', '佛系买家',
    '学生党阿明', '宝妈小雅', '上班族阿杰', '退休老王', '个体户阿强',
    '程序员小林', '设计师小美', '销售阿军', '会计小周', '护士小吴',
    '老师小陈', '快递小哥', '外卖骑手', '网约车司机', '健身房教练',
    '美妆博主', '美食博主', '穿搭博主', '数码评测师', '游戏主播',
    '败家娘们', '抠门大王', '优惠券达人', '凑单小能手', '退货专业户',
    '好评先生', '差评女王', '晒单狂魔', '收藏夹达人', '购物车清空者',
    '等等党', '首发党', '限量款猎手', '平替玩家', '大牌收割机',
    '拼多多女孩', '淘宝男孩', '京东PLUS', '唯品会粉丝', '小红书用户',
    '抖音买家', '快手老铁', 'B站小伙伴', '知乎精英', '微博吃瓜群众',
    '一线城市白领', '二线城市青年', '三四线小城', '县城贵妇', '乡镇企业家',
    '北方爷们', '南方姑娘', '川渝吃货', '广东靓仔', '江浙沪包邮区',
    '东北老铁', '西北汉子', '云贵川同胞', '福建老板', '山东大汉',
    '处女座买家', '狮子座土豪', '双子座精分', '双鱼座幻想家', '白羊座冲动型',
    '95后小鲜肉', '00后Z世代', '80后中坚力量', '70后实力派', '60后怀旧派',
    '猫奴铲屎官', '狗奴遛弯党', '养鱼达人', '养花爱好者', '手工DIYer',
    '健身狂魔', '减肥大军', '养生朋克', '熬夜修仙', '咖啡续命者',
    '书虫', '影迷', '音乐发烧友', '摄影爱好者', '旅行达人',
    '二次元死忠', '三次元现充', '游戏玩家', '动漫粉', '小说迷'
];

function generateBuyerName() {
    const baseName = randomChoice(BUYER_NAMES);
    if (Math.random() < 0.3) {
        const suffixes = ['一号', '二号', '三号', '呀', '酱', '君', '同学', '先生', '女士', '童鞋', '鸭', '仔', '哥', '姐', '叔', '姨'];
        return baseName + randomChoice(suffixes);
    }
    if (Math.random() < 0.2) {
        const prefixes = ['爱购物的', '买买买的', '可爱的', '帅气的', '美丽的', '勤劳的', '懒懒的', '开心的', '忧郁的', '神秘的'];
        return randomChoice(prefixes) + baseName;
    }
    return baseName;
}

// 工具函数：随机数
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min, max, decimals = 2) {
    return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function generateId(prefix) {
    return prefix + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// 格式化金额缓存（避免大数字频繁toLocaleString/toFixed卡顿）
const _formatMoneyCache = new Map();
function formatMoney(amount) {
    // NaN/Infinity 保护
    if (!isFinite(amount)) amount = 0;
    // 取整到分后作为缓存key，避免浮点抖动
    const key = Math.round(amount * 100);
    if (_formatMoneyCache.has(key)) return _formatMoneyCache.get(key);
    // 超过1万时自动缩写，避免超长字符串
    let text;
    const abs = Math.abs(amount);
    if (abs >= 100000000) { // 1亿+
        const sign = amount < 0 ? '-' : '';
        text = sign + '¥' + (abs / 100000000).toFixed(2) + '亿';
    } else if (abs >= 10000) { // 1万+
        const sign = amount < 0 ? '-' : '';
        text = sign + '¥' + (abs / 10000).toFixed(2) + '万';
    } else {
        text = '¥' + (Math.round(amount * 100) / 100).toFixed(2);
    }
    // 控制缓存大小，超过阈值时保留最近使用的50%
    if (_formatMoneyCache.size > 10000) {
        var entries = Array.from(_formatMoneyCache.keys());
        var removeCount = Math.floor(entries.length / 2);
        for (var ci = 0; ci < removeCount; ci++) {
            _formatMoneyCache.delete(entries[ci]);
        }
    }
    _formatMoneyCache.set(key, text);
    return text;
}

// 完整格式（用于财务详情，不缩写）
const _formatMoneyFullCache = new Map();
function formatMoneyFull(amount) {
    if (!isFinite(amount)) amount = 0;
    const key = Math.round(amount * 100);
    if (_formatMoneyFullCache.has(key)) return _formatMoneyFullCache.get(key);
    const fixed = (Math.round(amount * 100) / 100).toFixed(2);
    // 整数部分加千分位
    const parts = fixed.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const text = '¥' + parts.join('.');
    if (_formatMoneyFullCache.size > 10000) _formatMoneyFullCache.clear();
    _formatMoneyFullCache.set(key, text);
    return text;
}

function formatDate(day, hour) {
    return `第${day}天 ${hour.toString().padStart(2, '0')}:00`;
}

// ==================== 成就系统 ====================
const ACHIEVEMENTS = [
    // 订单成就
    { id: 'first_order', name: '第一桶金', description: '完成第一笔订单', icon: '🎉', category: 'order', condition: { type: 'totalOrders', value: 1 }, reward: { type: 'money', value: 100 } },
    { id: 'order_10', name: '小有名气', description: '累计完成10笔订单', icon: '📦', category: 'order', condition: { type: 'totalOrders', value: 10 }, reward: { type: 'money', value: 200 } },
    { id: 'order_100', name: '销量达人', description: '累计完成100笔订单', icon: '🚚', category: 'order', condition: { type: 'totalOrders', value: 100 }, reward: { type: 'money', value: 1000 } },
    { id: 'order_1000', name: '电商大佬', description: '累计完成1000笔订单', icon: '🏆', category: 'order', condition: { type: 'totalOrders', value: 1000 }, reward: { type: 'buff', buffType: 'traffic', value: 0.1 } },
    
    // 销售成就
    { id: 'sales_1000', name: '千元户', description: '累计销售额达到1000元', icon: '💰', category: 'sales', condition: { type: 'totalSales', value: 1000 }, reward: { type: 'money', value: 100 } },
    { id: 'sales_10000', name: '万元户', description: '累计销售额达到10000元', icon: '💎', category: 'sales', condition: { type: 'totalSales', value: 10000 }, reward: { type: 'money', value: 500 } },
    { id: 'sales_100000', name: '十万户', description: '累计销售额达到10万元', icon: '👑', category: 'sales', condition: { type: 'totalSales', value: 100000 }, reward: { type: 'buff', buffType: 'conversion', value: 0.05 } },
    { id: 'sales_1m', name: '百万富翁', description: '累计销售额达到100万元', icon: '🏯', category: 'sales', condition: { type: 'totalSales', value: 1000000 }, reward: { type: 'buff', buffType: 'traffic', value: 0.2 } },
    
    // 利润成就
    { id: 'profit_500', name: '小有盈余', description: '累计利润达到500元', icon: '📈', category: 'profit', condition: { type: 'totalProfit', value: 500 }, reward: { type: 'money', value: 200 } },
    { id: 'profit_10000', name: '盈利达人', description: '累计利润达到10000元', icon: '💵', category: 'profit', condition: { type: 'totalProfit', value: 10000 }, reward: { type: 'money', value: 1000 } },
    
    // 好评成就
    { id: 'good_review_10', name: '好评如潮', description: '累计获得10个好评', icon: '⭐', category: 'review', condition: { type: 'goodReviews', value: 10 }, reward: { type: 'money', value: 200 } },
    { id: 'good_review_100', name: '口碑商家', description: '累计获得100个好评', icon: '🌟', category: 'review', condition: { type: 'goodReviews', value: 100 }, reward: { type: 'buff', buffType: 'conversion', value: 0.03 } },
    { id: 'rep_4_5', name: '品质之选', description: '店铺信誉达到4.5星', icon: '✨', category: 'review', condition: { type: 'reputation', value: 4.5 }, reward: { type: 'money', value: 500 } },
    
    // 商品成就
    { id: 'product_10', name: '品类丰富', description: '同时上架10款商品', icon: '🛍️', category: 'product', condition: { type: 'activeListings', value: 10 }, reward: { type: 'money', value: 200 } },
    { id: 'product_30', name: '杂货铺', description: '同时上架30款商品', icon: '🏪', category: 'product', condition: { type: 'activeListings', value: 30 }, reward: { type: 'money', value: 500 } },
    
    // 员工成就
    { id: 'employee_1', name: '招人啦', description: '雇佣第一个员工', icon: '👤', category: 'employee', condition: { type: 'employees', value: 1 }, reward: { type: 'money', value: 100 } },
    { id: 'employee_5', name: '小团队', description: '同时雇佣5名员工', icon: '👥', category: 'employee', condition: { type: 'employees', value: 5 }, reward: { type: 'money', value: 500 } },
    
    // 店铺等级成就
    { id: 'level_2', name: '升级啦', description: '店铺升到2级', icon: '⬆️', category: 'level', condition: { type: 'shopLevel', value: 2 }, reward: { type: 'money', value: 200 } },
    { id: 'level_5', name: '资深店铺', description: '店铺升到5级', icon: '🏅', category: 'level', condition: { type: 'shopLevel', value: 5 }, reward: { type: 'buff', buffType: 'traffic', value: 0.15 } },
    
    // 趣味成就
    { id: 'first_negative', name: '第一次差评', description: '收到第一个差评', icon: '😢', category: 'fun', condition: { type: 'badReviews', value: 1 }, reward: { type: 'money', value: 50 } },
    { id: 'survive_7', name: '一周店长', description: '经营满7天', icon: '📅', category: 'fun', condition: { type: 'days', value: 7 }, reward: { type: 'money', value: 200 } },
    { id: 'survive_30', name: '月度店长', description: '经营满30天', icon: '🗓️', category: 'fun', condition: { type: 'days', value: 30 }, reward: { type: 'money', value: 1000 } },
    { id: 'night_owl', name: '夜猫子', description: '在凌晨2点后成交订单', icon: '🦉', category: 'fun', condition: { type: 'nightOrder', value: 1 }, reward: { type: 'money', value: 100 } },
    { id: 'early_bird', name: '早起的鸟儿', description: '在早上6点前成交订单', icon: '🐦', category: 'fun', condition: { type: 'earlyOrder', value: 1 }, reward: { type: 'money', value: 100 } },
    { id: 'a_grade_seller', name: '品质卖家', description: '只卖A品商品达成10单', icon: '🏅', category: 'fun', condition: { type: 'aGradeOrders', value: 10 }, reward: { type: 'buff', buffType: 'conversion', value: 0.05 } },
    { id: 'c_grade_king', name: '拼多多之王', description: 'C品商品卖出100单', icon: '💩', category: 'fun', condition: { type: 'cGradeOrders', value: 100 }, reward: { type: 'money', value: 500 } },
    { id: 'rating_gold', name: '金牌口碑', description: '店铺评分达到4.8星', icon: '🥇', category: 'review', condition: { type: 'reputation', value: 4.8 }, reward: { type: 'buff', buffType: 'traffic', value: 0.08 } },
    { id: 'rating_legend', name: '传说五星', description: '店铺评分达到4.9星', icon: '👑', category: 'review', condition: { type: 'reputation', value: 4.9 }, reward: { type: 'money', value: 8000 } },
    { id: 'luxury_first', name: '入门轻奢', description: '卖出第一件奢侈品', icon: '💎', category: 'product', condition: { type: 'luxurySold', value: 1 }, reward: { type: 'money', value: 2000 } },
    { id: 'luxury_20', name: '名品买手', description: '累计售出20件奢侈品', icon: '👜', category: 'product', condition: { type: 'luxurySold', value: 20 }, reward: { type: 'buff', buffType: 'conversion', value: 0.04 } },
    { id: 'collector_3', name: '收藏家之友', description: '完成3笔收藏家订单', icon: '🎩', category: 'fun', condition: { type: 'collectorFulfilled', value: 3 }, reward: { type: 'money', value: 15000 } }
];

// ==================== 随机事件系统 ====================
const RANDOM_EVENTS = [
    // 好事
    {
        id: 'viral_product',
        name: '网红爆款',
        description: '你的一款商品被网红推荐了！流量暴增！',
        icon: '🔥',
        type: 'good',
        probability: 0.02,
        minDay: 3,
        effect: { type: 'traffic_boost', value: 3, duration: 24, message: '某款商品突然火了！未来24小时流量×3！' }
    },
    {
        id: 'mystery_buyer',
        name: '神秘大客户',
        description: '一位神秘买家出现，一次性买了很多东西！',
        icon: '💰',
        type: 'good',
        probability: 0.015,
        minDay: 5,
        effect: { type: 'big_order', message: '神秘大客户下单了！' }
    },
    {
        id: 'good_weather',
        name: '好天气',
        description: '今天天气真好，大家都出来购物了！',
        icon: '☀️',
        type: 'good',
        probability: 0.05,
        minDay: 1,
        effect: { type: 'traffic_boost', value: 1.5, duration: 12, message: '好天气带来好心情，未来12小时流量提升50%！' }
    },
    {
        id: 'supplier_gift',
        name: '供应商福利',
        description: '供应商感谢你的长期合作，送了一批货！',
        icon: '🎁',
        type: 'good',
        probability: 0.01,
        minDay: 10,
        effect: { type: 'free_stock', message: '供应商送了你一批货！' }
    },
    {
        id: 'platform_promotion',
        name: '平台推荐',
        description: '你的店铺被平台推荐到首页了！',
        icon: '📢',
        type: 'good',
        probability: 0.01,
        minDay: 7,
        effect: { type: 'traffic_boost', value: 2, duration: 12, message: '平台推荐！未来12小时流量翻倍！' }
    },
    
    // 坏事
    {
        id: 'supply_shortage',
        name: '断供危机',
        description: '供应商那边出了点问题，部分商品暂时缺货了！',
        icon: '📉',
        type: 'bad',
        probability: 0.02,
        minDay: 5,
        effect: { type: 'supply_shortage', message: '部分商品暂时断供了！' },
        // ===== 危机应对（深化）：触发时弹出决策，玩家可花钱化解或硬扛 =====
        crisis: {
            mitigateCost: 5000,
            mitigateDesc: '高价从现货商调货，完全化解断供',
            acceptDesc: '接受断供，硬扛过去'
        }
    },
    {
        id: 'product_ban_sell',
        name: '平台禁售抽检',
        description: '监管抽检：部分在架商品被临时禁售！',
        icon: '🚫',
        type: 'bad',
        probability: 0.012,
        minDay: 8,
        effect: { type: 'product_ban', mode: 'sell', days: 2, message: '抽检不合格：部分商品临时禁售 2 天！' }
    },
    {
        id: 'product_ban_buy',
        name: '进货管制',
        description: '海关/市场监管对部分品类实施临时禁购。',
        icon: '⛔',
        type: 'bad',
        probability: 0.01,
        minDay: 10,
        effect: { type: 'product_ban', mode: 'buy', days: 3, message: '进货管制：部分商品临时禁购 3 天！' }
    },
    {
        id: 'bad_weather',
        name: '恶劣天气',
        description: '天气太差了，快递变慢，流量也少了！',
        icon: '🌧️',
        type: 'bad',
        probability: 0.04,
        minDay: 1,
        effect: { type: 'traffic_drop', value: 0.5, duration: 12, message: '坏天气！未来12小时流量减半，物流延迟。' }
    },
    {
        id: 'package_damaged',
        name: '包裹破损',
        description: '有一批包裹在运输途中破损了，引起了一些差评！',
        icon: '📦💔',
        type: 'bad',
        probability: 0.01,
        minDay: 3,
        effect: { type: 'bad_reviews', count: 3, message: '包裹破损，收到了几个差评！' }
    },
    {
        id: 'platform_penalty',
        name: '平台罚款',
        description: '平台检测到你的店铺有违规行为，罚款了！',
        icon: '⚠️',
        type: 'bad',
        probability: 0.005,
        minDay: 5,
        effect: { type: 'fine', percent: 0.02, message: '平台罚款！扣除当前资金的2%。' }
    },
    {
        id: 'troll_review',
        name: '职业差评师',
        description: '遇到职业差评师了！被恶意差评！',
        icon: '👿',
        type: 'bad',
        probability: 0.008,
        minDay: 10,
        effect: { type: 'bad_reviews', count: 1, message: '遇到职业差评师，信誉受损！' }
    },
    
    // 中性事件
    {
        id: 'new_competitor',
        name: '新竞争对手',
        description: '同行新开了一家店，竞争更激烈了！',
        icon: '⚔️',
        type: 'neutral',
        probability: 0.03,
        minDay: 5,
        effect: { type: 'traffic_drop', value: 0.9, duration: 48, message: '新竞争对手出现，未来48小时流量略降。' }
    },
    {
        id: 'market_research',
        name: '市场调研',
        description: '你做了一次市场调研，了解了什么好卖！',
        icon: '📊',
        type: 'neutral',
        probability: 0.02,
        minDay: 3,
        effect: { type: 'info', message: '你获得了市场情报，更了解消费者需求了。' }
    },
    {
        id: 'power_outage',
        name: '停电了',
        description: '仓库停电了几小时，订单处理暂停。',
        icon: '🔌',
        type: 'neutral',
        probability: 0.01,
        minDay: 2,
        effect: { type: 'pause_processing', duration: 6, message: '停电6小时，订单处理暂停。' }
    },
    
    // 节日/特殊事件
    {
        id: 'payday',
        name: '发薪日',
        description: '今天是发薪日，大家都有钱买买买！',
        icon: '💸',
        type: 'good',
        probability: 0.1,
        minDay: 10,
        triggerDayOfMonth: 15,
        effect: { type: 'traffic_boost', value: 2, duration: 24, message: '发薪日！未来24小时流量翻倍！' }
    },
    {
        id: 'monday_blues',
        name: '周一综合症',
        description: '周一大家都没心情购物。',
        icon: '😴',
        type: 'bad',
        probability: 0.3,
        minDay: 1,
        triggerDayOfWeek: 1,
        effect: { type: 'traffic_drop', value: 0.7, duration: 12, message: '周一综合症，上午流量减少30%。' }
    },
    {
        id: 'friday_shopping',
        name: '周五购物夜',
        description: '周五了，大家都在买买买迎接周末！',
        icon: '🎉',
        type: 'good',
        probability: 0.3,
        minDay: 1,
        triggerDayOfWeek: 5,
        effect: { type: 'traffic_boost', value: 1.5, duration: 12, message: '周五购物夜！晚上流量提升50%！' }
    }
];

// ==================== 会员体系 ====================
// 会员等级配置（成长值+消费双维度）
const MEMBER_LEVELS = [
    { 
        level: 1, name: '普通会员', icon: '🌱', bgColor: '#e0e0e0', textColor: '#616161',
        minGrowth: 0, minSpent: 0, discount: 1.0, freeShipping: false, pointsRate: 1, 
        monthlyCoupons: 0, exclusiveService: false, priorityShipping: false, birthdayGift: false,
        benefits: ['新客礼包', '基础售后'],
        desc: '注册即成为普通会员'
    },
    { 
        level: 2, name: '银卡会员', icon: '🥈', bgColor: '#b0bec5', textColor: '#37474f',
        minGrowth: 500, minSpent: 500, discount: 0.98, freeShipping: false, pointsRate: 1.2, 
        monthlyCoupons: 1, exclusiveService: false, priorityShipping: false, birthdayGift: true,
        benefits: ['98折优惠', '积分1.2倍', '生日礼包', '每月1张5元券'],
        desc: '成长值500或消费满500元升级'
    },
    { 
        level: 3, name: '金卡会员', icon: '🥇', bgColor: '#ffd54f', textColor: '#f57f17',
        minGrowth: 2000, minSpent: 2000, discount: 0.95, freeShipping: true, pointsRate: 1.5, 
        monthlyCoupons: 2, exclusiveService: false, priorityShipping: true, birthdayGift: true,
        benefits: ['95折优惠', '全场包邮', '积分1.5倍', '优先发货', '每月2张优惠券', '生日礼包'],
        desc: '成长值2000或消费满2000元升级'
    },
    { 
        level: 4, name: '铂金会员', icon: '💠', bgColor: '#90caf9', textColor: '#0d47a1',
        minGrowth: 8000, minSpent: 8000, discount: 0.92, freeShipping: true, pointsRate: 1.8, 
        monthlyCoupons: 3, exclusiveService: true, priorityShipping: true, birthdayGift: true,
        benefits: ['92折优惠', '全场包邮', '积分1.8倍', '专属客服', '优先发货', '每月3张券', '生日礼包'],
        desc: '成长值8000或消费满8000元升级'
    },
    { 
        level: 5, name: '钻石会员', icon: '💎', bgColor: 'linear-gradient(135deg,#e91e63,#9c27b0)', textColor: '#fff',
        minGrowth: 20000, minSpent: 20000, discount: 0.88, freeShipping: true, pointsRate: 2.5, 
        monthlyCoupons: 5, exclusiveService: true, priorityShipping: true, birthdayGift: true, vipEvents: true,
        benefits: ['88折优惠', '全场包邮', '积分2.5倍', '1对1专属客服', '极速发货', '每月5张券', '生日豪华礼包', '专属活动邀请'],
        desc: '成长值20000或消费满20000元升级'
    }
];

// 成长值获取规则
const MEMBER_GROWTH_RULES = {
    order: { base: 10, perYuan: 0.05, desc: '订单消费：每笔订单基础10点 + 每消费1元获得0.05点' },
    review: { text: 5, image: 15, video: 30, desc: '评价奖励：文字评价5点，带图15点，视频30点' },
    signIn: { daily: 2, continuous7: 20, continuous30: 100, desc: '每日签到：每日2点，连续7天额外20点，连续30天额外100点' },
    share: { perShare: 3, dailyLimit: 15, desc: '分享奖励：每次分享3点，每日上限15点' },
    perfectOrder: { bonus: 20, desc: '完美订单（无退货无差评）额外20点' }
};

// 头像预设
const AVATAR_PRESETS = [
    '👨‍💼', '👩‍💼', '🧑‍💻', '👨‍🎓', '👩‍🎓', '🧑‍🎨', '👨‍🍳', '👩‍🍳',
    '🦊', '🐱', '🐶', '🐼', '🐨', '🦁', '🐯', '🐻',
    '🌟', '🔥', '💫', '⭐', '🌈', '🎯', '💎', '👑'
];

// 会员专属活动
const MEMBER_ACTIVITIES = [
    {
        id: 'act_newbie',
        title: '新会员专享礼包',
        icon: '🎁',
        level: 1,
        type: 'gift',
        desc: '注册即送100积分+5元优惠券',
        reward: { points: 100, coupon: 'discount_5' },
        status: 'permanent'
    },
    {
        id: 'act_birthday',
        title: '会员生日月双倍积分',
        icon: '🎂',
        level: 2,
        type: 'points',
        desc: '生日当月所有消费积分翻倍',
        multiplier: 2,
        status: 'permanent'
    },
    {
        id: 'act_friday',
        title: '会员周五特惠日',
        icon: '🎉',
        level: 1,
        type: 'discount',
        desc: '每周五会员专享额外95折',
        extraDiscount: 0.95,
        weekday: 5,
        status: 'permanent'
    },
    {
        id: 'act_points_day',
        title: '每月18号会员日',
        icon: '⭐',
        level: 2,
        type: 'points_multiplier',
        desc: '每月18日积分3倍，兑换8折',
        pointsMultiplier: 3, redeemDiscount: 0.8,
        dayOfMonth: 18,
        status: 'permanent'
    },
    {
        id: 'act_platinum_exclusive',
        title: '铂金会员专属价',
        icon: '💠',
        level: 4,
        type: 'exclusive_price',
        desc: '铂金及以上会员专享精选商品特价',
        priceDiscount: 0.9,
        status: 'permanent'
    },
    {
        id: 'act_diamond_gift',
        title: '钻石会员年度礼盒',
        icon: '💎',
        level: 5,
        type: 'annual_gift',
        desc: '每年赠送价值299元专属神秘礼盒',
        giftValue: 299,
        status: 'permanent'
    }
];

// 会员积分记录类型
const POINTS_LOG_TYPES = {
    earn_order: { icon: '🛒', name: '消费获得', color: '#4caf50' },
    earn_signin: { icon: '📅', name: '签到奖励', color: '#2196f3' },
    earn_review: { icon: '⭐', name: '评价奖励', color: '#9c27b0' },
    earn_activity: { icon: '🎁', name: '活动奖励', color: '#ff9800' },
    earn_recharge: { icon: '💳', name: '充值赠送', color: '#00897b' },
    earn_birthday: { icon: '🎂', name: '生日奖励', color: '#e91e63' },
    spend_redeem: { icon: '🎫', name: '积分兑换', color: '#f44336' },
    spend_wallet: { icon: '👛', name: '储值消费', color: '#5d4037' },
    spend_refund: { icon: '↩️', name: '退款扣回', color: '#ff5722' },
    spend_expire: { icon: '⏰', name: '积分过期', color: '#9e9e9e' },
    adjust: { icon: '⚙️', name: '系统调整', color: '#607d8b' }
};

// 会员积分兑换商城
const MEMBER_REWARDS = [
    { id: 'rw_coupon_5',  name: '5元优惠券',     icon: '🎟️', pointsCost: 50,  minLevel: 1, stock: 9999, type: 'coupon',    couponTypeId: 'discount_5',  desc: '满30可用' },
    { id: 'rw_coupon_10', name: '10元优惠券',    icon: '🎟️', pointsCost: 100, minLevel: 1, stock: 9999, type: 'coupon',    couponTypeId: 'discount_10', desc: '满50可用' },
    { id: 'rw_coupon_20', name: '20元优惠券',    icon: '🎫', pointsCost: 180, minLevel: 2, stock: 9999, type: 'coupon',    couponTypeId: 'discount_20', desc: '满100可用，银卡+' },
    { id: 'rw_coupon_50', name: '50元优惠券',    icon: '🎫', pointsCost: 400, minLevel: 3, stock: 9999, type: 'coupon',    couponTypeId: 'discount_50', desc: '满200可用，金卡+' },
    { id: 'rw_freeship',  name: '包邮券 x3',     icon: '🚚', pointsCost: 150, minLevel: 2, stock: 9999, type: 'freeship',  amount: 3,               desc: '3次包邮资格' },
    { id: 'rw_cash_20',   name: '20元现金红包',  icon: '💰', pointsCost: 250, minLevel: 2, stock: 999,  type: 'cash',      amount: 20,             desc: '直接到账店铺资金' },
    { id: 'rw_cash_100',  name: '100元现金红包', icon: '💵', pointsCost: 1200,minLevel: 3, stock: 999,  type: 'cash',      amount: 100,            desc: '金卡+专享' },
    { id: 'rw_rep_5',     name: '店铺信誉+5',    icon: '⭐', pointsCost: 600, minLevel: 2, stock: 50,   type: 'reputation',amount: 5,              desc: '提升店铺信誉' },
    { id: 'rw_rep_20',    name: '店铺信誉+20',   icon: '🌟', pointsCost: 2200,minLevel: 4, stock: 30,   type: 'reputation',amount: 20,             desc: '钻石+专享' },
];

// 会员积分系统抵扣与获取规则（仅用于兑换商城）
const MEMBER_POINTS_RULES = {
    // 积分用途（唯一合法用途）
    usage: '仅可用于会员商城兑换商品券/优惠券/包邮券等虚拟权益',
    // 不可使用场景（用于前端提示）
    forbiddenUsage: [
        '不可直接抵扣订单现金（无积分抵现功能）',
        '不可转赠、提现或兑换为流通货币',
        '不可单独作为货币使用'
    ],
    // 积分获取规则（每消费N元=1分基础分，再乘会员等级倍率）
    earn: {
        baseYuanPerPoint: 10,  // 消费¥10 = 1积分
        levelMultiplier: {     // 会员等级倍率（同MEMBER_LEVELS pointsRate对应）
            1: 1.0,   // 普通会员
            2: 1.2,   // 银卡会员
            3: 1.5,   // 金卡会员
            4: 1.8,   // 铂金会员
            5: 2.5    // 钻石会员
        },
        extraRules: [
            '订单实付金额每满10元，获得1积分（不足10元不计）',
            '退款订单对应积分将被回收',
            '会员等级越高，积分倍率越大'
        ]
    },
    // 商城兑换范围分类
    categories: [
        { key: 'all',        name: '全部商品', icon: '🛍️' },
        { key: 'coupon',     name: '优惠券',   icon: '🎟️' },
        { key: 'freeship',   name: '包邮券',   icon: '🚚' },
        { key: 'cash',       name: '现金红包', icon: '💰' },
        { key: 'reputation', name: '信誉权益', icon: '⭐' }
    ]
};

const COUPON_PRESETS = [
    { id: 'discount_5',  name: '5元优惠券',  type: 'fixed', value: 5,  minAmount: 30, expireDays: 7,  icon: '🎟️' },
    { id: 'discount_10', name: '10元优惠券', type: 'fixed', value: 10, minAmount: 50, expireDays: 7,  icon: '🎟️' },
    { id: 'discount_20', name: '20元优惠券', type: 'fixed', value: 20, minAmount: 100, expireDays: 7,  icon: '🎟️' },
    { id: 'discount_50', name: '50元优惠券', type: 'fixed', value: 50, minAmount: 200, expireDays: 14, icon: '🎟️' },
    { id: 'percent_5', name: '95折优惠券', type: 'discount', value: 9.5, minAmount: 0, expireDays: 7, icon: '🏷️' },
    { id: 'percent_10', name: '9折优惠券', type: 'discount', value: 9, minAmount: 100, expireDays: 14, icon: '🏷️' },
    { id: 'free_shipping', name: '包邮券', type: 'freeship', value: 0, minAmount: 0, expireDays: 30, icon: '🚚' }
];

// ==================== 会员权益系统（卖家可配置版） ====================

// 权益类型定义
const BENEFIT_TYPES = {
    coupon: { id: 'coupon', name: '优惠券', icon: '🎟️', color: '#ff6b35', desc: '店铺优惠券，下单时抵扣' },
    freeship: { id: 'freeship', name: '包邮券', icon: '🚚', color: '#4caf50', desc: '免除快递费用' },
    cash: { id: 'cash', name: '现金红包', icon: '💰', color: '#f44336', desc: '直接返现到店铺余额' },
    reputation: { id: 'reputation', name: '信誉加分', icon: '⭐', color: '#9c27b0', desc: '提升店铺信誉值' },
    physical: { id: 'physical', name: '实物商品', icon: '📦', color: '#2196f3', desc: '可兑换店内实物商品' },
    service: { id: 'service', name: '增值服务', icon: '🛎️', color: '#ff9800', desc: '优先发货、专属客服等服务' },
    discount: { id: 'discount', name: '折扣权益', icon: '🏷️', color: '#e91e63', desc: '整单折扣权益' },
    credit: { id: 'credit', name: '赊购额度', icon: '💳', color: '#607d8b', desc: '先收货后付款额度' }
};

// 兑换状态
const REDEEM_STATUS = {
    pending: { id: 'pending', name: '待处理', icon: '⏳', color: '#ff9800' },
    processing: { id: 'processing', name: '处理中', icon: '🔄', color: '#2196f3' },
    shipped: { id: 'shipped', name: '已发货', icon: '📮', color: '#9c27b0' },
    completed: { id: 'completed', name: '已完成', icon: '✅', color: '#4caf50' },
    cancelled: { id: 'cancelled', name: '已取消', icon: '❌', color: '#9e9e9e' },
    refunded: { id: 'refunded', name: '已退款', icon: '↩️', color: '#f44336' }
};

// 默认权益配置（卖家首次进入时初始化）
const DEFAULT_BENEFITS_CONFIG = {
    // 积分获取规则（卖家可调整）
    pointsRule: {
        yuanPerPoint: 10,           // 每消费N元获得1积分
        signInDaily: 2,             // 每日签到积分
        reviewText: 5,              // 文字评价积分
        reviewImage: 15,            // 带图评价积分
        reviewVideo: 30,            // 视频评价积分
        perfectOrderBonus: 20,      // 完美订单额外积分
        pointsExpireDays: 365,      // 积分有效期（天），0=永久
        pointsExpireNoticeDays: 7   // 过期前N天提醒
    },
    // 兑换规则（卖家可调整）
    redeemRule: {
        enabled: true,              // 是否开启积分兑换
        minLevelForRedeem: 1,       // 最低兑换等级
        dailyRedeemLimit: 10,       // 每人每日兑换上限
        stockReserveHours: 24,      // 库存预留时间（小时）
        autoConfirmDays: 7,         // 自动确认收货天数
        allowCancelMinutes: 30      // 兑换后允许取消的分钟数
    },
    // 权益列表（卖家可增删改）
    benefits: [
        // 默认虚拟券类
        { id: 'bnf_coupon_5', name: '5元优惠券', icon: '🎟️', type: 'coupon', pointsCost: 50, minLevel: 1, stock: 9999, sold: 0, enabled: true, sort: 1, couponTypeId: 'discount_5', desc: '满30元可用', couponValue: 5, minOrderAmount: 30, validDays: 7 },
        { id: 'bnf_coupon_10', name: '10元优惠券', icon: '🎟️', type: 'coupon', pointsCost: 100, minLevel: 1, stock: 9999, sold: 0, enabled: true, sort: 2, couponTypeId: 'discount_10', desc: '满50元可用', couponValue: 10, minOrderAmount: 50, validDays: 7 },
        { id: 'bnf_coupon_20', name: '20元优惠券', icon: '🎫', type: 'coupon', pointsCost: 180, minLevel: 2, stock: 9999, sold: 0, enabled: true, sort: 3, couponTypeId: 'discount_20', desc: '满100元可用，银卡及以上', couponValue: 20, minOrderAmount: 100, validDays: 7 },
        { id: 'bnf_coupon_50', name: '50元优惠券', icon: '🎫', type: 'coupon', pointsCost: 400, minLevel: 3, stock: 9999, sold: 0, enabled: true, sort: 4, couponTypeId: 'discount_50', desc: '满200元可用，金卡及以上', couponValue: 50, minOrderAmount: 200, validDays: 14 },
        { id: 'bnf_freeship_3', name: '包邮券 x3', icon: '🚚', type: 'freeship', pointsCost: 150, minLevel: 2, stock: 9999, sold: 0, enabled: true, sort: 5, couponTypeId: 'free_shipping', amount: 3, desc: '获得3张包邮券', validDays: 30 },
        { id: 'bnf_cash_20', name: '20元现金红包', icon: '💰', type: 'cash', pointsCost: 250, minLevel: 2, stock: 999, sold: 0, enabled: true, sort: 6, amount: 20, desc: '直接到账店铺资金' },
        { id: 'bnf_cash_100', name: '100元现金红包', icon: '💵', type: 'cash', pointsCost: 1200, minLevel: 3, stock: 999, sold: 0, enabled: true, sort: 7, amount: 100, desc: '金卡及以上专享' },
        { id: 'bnf_rep_5', name: '店铺信誉+5', icon: '⭐', type: 'reputation', pointsCost: 600, minLevel: 2, stock: 50, sold: 0, enabled: true, sort: 8, amount: 5, desc: '提升店铺信誉值' },
        { id: 'bnf_rep_20', name: '店铺信誉+20', icon: '🌟', type: 'reputation', pointsCost: 2200, minLevel: 4, stock: 30, sold: 0, enabled: true, sort: 9, amount: 20, desc: '铂金及以上专享' },
        // 默认服务类
        { id: 'bnf_priority_ship', name: '优先发货卡', icon: '⚡', type: 'service', pointsCost: 80, minLevel: 1, stock: 9999, sold: 0, enabled: true, sort: 10, serviceType: 'priority_ship', desc: '订单优先打包发货1次', validDays: 30 },
        { id: 'bnf_vip_service', name: '专属客服7天', icon: '👩‍💼', type: 'service', pointsCost: 300, minLevel: 3, stock: 999, sold: 0, enabled: true, sort: 11, serviceType: 'vip_service', desc: '7天专属客服通道', validDays: 7 }
    ],
    // 兑换记录保留天数
    recordRetentionDays: 90
};

// 权益统计默认值
const DEFAULT_BENEFITS_STATS = {
    totalPointsEarned: 0,       // 累计发放积分
    totalPointsRedeemed: 0,     // 累计消耗积分
    totalPointsExpired: 0,      // 累计过期积分
    totalRedeemCount: 0,        // 累计兑换次数
    totalRedeemMembers: 0,      // 累计兑换人数
    totalRedeemValue: 0,        // 累计兑换价值（元）
    todayRedeemCount: 0,        // 今日兑换次数
    todayRedeemPoints: 0,       // 今日消耗积分
    popularBenefits: [],        // 热门权益排行
    dailyStats: []              // 每日统计数据
};

/** 顾客会员储值：充多少送多少（卖家在会员中心配置） */
const DEFAULT_MEMBER_RECHARGE = {
    enabled: false,
    rules: [
        { pay: 100, bonus: 5 },
        { pay: 500, bonus: 20 },
        { pay: 1000, bonus: 50 },
        { pay: 2000, bonus: 120 }
    ]
};

// ==================== 仓储系统 ====================
const WAREHOUSE_LEVELS = (function() {
    const names = [
        '小型仓库', '中型仓库', '大型仓库', '智能化仓库', '云仓旗舰',
        '区域分仓', '城市配送中心', '省级物流中心', '大区域枢纽仓', '全国中心仓',
        '智能云仓', '自动化立体仓', '跨境保税仓', '超级旗舰仓', '亚太物流枢纽',
        '全球供应链中心', '智能无人仓', '太空仓储港', '次元存储枢纽', '万界云仓'
    ];
    const descs = [
        '初始仓库，新手起步', '标准仓库，分区存储', '大型仓库，专业库位管理', '智能仓储，批次追踪', '旗舰云仓，全功能覆盖',
        '多区域分仓布局', '城市级配送覆盖', '省级物流网络', '大区物流枢纽', '全国仓储网络',
        'AI智能调度', '全自动化作业', '跨境贸易保税', '超级旗舰规模', '亚太区域枢纽',
        '全球供应链体系', '无人化作业', '太空级存储', '跨次元存储', '万界仓储至尊'
    ];
    const result = [];
    // Lv1 起步容量提到 10 万，避免「一次进/上架超1万件就卖不了」
    let capacity = 100000;
    for (let i = 0; i < 20; i++) {
        const level = i + 1;
        // 写在「当前级」上：从本级升到下一级的费用（Lv1 以前是 0，设置页会误显示「已满级」）
        let upgradeCost = 0;
        if (i === 0) upgradeCost = 20000;            // Lv1→2: 2万
        else if (i === 1) upgradeCost = 100000;      // Lv2→3: 10万
        else if (i === 2) upgradeCost = 500000;      // Lv3→4: 50万
        else if (i === 3) upgradeCost = 2000000;     // Lv4→5: 200万
        else if (i >= 4 && i < 19) {
            upgradeCost = Math.floor(2000000 * Math.pow(2, i - 3));
        }
        // 仓储费 = 每月固定月租 + 在仓商品每日占用费（取值见 WarehouseData.getLevelRentInfo / calcOccupancyFee）
        // 月租：20000 × 1.5^(lv-1) 取整到千位 —— Lv1=2万/月，Lv7=22.8万/月，Lv20=4433.7万/月
        // 占用费：0.2 元/件/日，只统计真实在仓件数，空仓不收
        const monthlyRent = Math.round(20000 * Math.pow(1.5, i) / 1000) * 1000;
        const unitStorageCost = 0.2;   // 在仓商品占用费：元/件/日
        const zones = Math.min(50, 3 + Math.floor(i * 1.2) + Math.floor(i / 2));
        result.push({
            level: level,
            name: names[i],
            capacity: capacity,
            zones: zones,
            upgradeCost: upgradeCost,
            monthlyRent: monthlyRent,
            unitStorageCost: unitStorageCost,
            description: descs[i]
        });
        if (i < 19) {
            capacity = capacity * (i % 2 === 1 ? 4 : 2);
        }
    }
    return result;
})();

// 包装材料配置（发货消耗，带价格阶梯、分类、规格参数 - ERP扩展版）
// 分类代码：carton_box纸箱类 / cushioning缓冲类 / sealing封装类 / label标签类 / inner内衬托类 / eco环保类 / gift礼品类 / protection保护类 / consumable耗材类 / outer外包类
const PACKAGING_MATERIALS = {
    // ========== 1. 纸箱类 carton_box ==========
    carton: {
        id: 'carton',
        category: 'carton_box',
        name: '标准纸箱（3号）',
        icon: '📦',
        description: '标准快递纸箱，用于保护商品外观（300*200*150mm）',
        unit: '个',
        cost: 1.2,
        suitableWeight: [0, 5],
        spec: { length: 300, width: 200, height: 150, thickness: 3, material: '瓦楞纸(K=K)', bear: 10 },
        lowStockThreshold: 20,
        consumption: { base: 1, perItem: 0 },
        priceTiers: [
            { minQty: 1, price: 1.5, name: '散买' },
            { minQty: 10, price: 1.2, name: '小批量', discount: '8折' },
            { minQty: 50, price: 0.9, name: '中批量', discount: '6折' },
            { minQty: 200, price: 0.6, name: '大批量', discount: '4折' },
            { minQty: 500, price: 0.4, name: '超大批量', discount: '27折' },
            { minQty: 1000, price: 0.32, name: '整托采购', discount: '21折' },
            { minQty: 5000, price: 0.24, name: '工厂直发', discount: '16折' },
            { minQty: 10000, price: 0.18, name: '产业带包仓', discount: '12折' },
            { minQty: 100000, price: 0.12, name: '十万件包仓', discount: '8折' }
        ]
    },
    carton_large: {
        id: 'carton_large', category: 'carton_box', name: '大号纸箱（1号）', icon: '📤',
        description: '大号快递箱 500*350*300mm，适合家电/服饰大件',
        unit: '个', cost: 3.2, suitableWeight: [3, 15],
        spec: { length: 500, width: 350, height: 300, thickness: 5, material: '加强瓦楞(A=A)', bear: 25 },
        lowStockThreshold: 10,
        consumption: { base: 0, perItem: 0 }, // 按重量自动匹配
        priceTiers: [
            { minQty: 1, price: 4.0, name: '散买' },
            { minQty: 20, price: 3.2, name: '小批量', discount: '8折' },
            { minQty: 100, price: 2.4, name: '中批量', discount: '6折' },
            { minQty: 300, price: 1.8, name: '大批量', discount: '45折' }
        ]
    },
    carton_small: {
        id: 'carton_small', category: 'carton_box', name: '迷你邮政箱（7号）', icon: '📥',
        description: '邮政7号箱 200*140*100mm，适合饰品/美妆小件',
        unit: '个', cost: 0.6, suitableWeight: [0, 1.5],
        spec: { length: 200, width: 140, height: 100, thickness: 2, material: '瓦楞纸(B=B)', bear: 3 },
        lowStockThreshold: 30,
        consumption: { base: 0, perItem: 0 },
        priceTiers: [
            { minQty: 1, price: 0.8, name: '散买' },
            { minQty: 50, price: 0.6, name: '小批量', discount: '75折' },
            { minQty: 200, price: 0.4, name: '中批量', discount: '5折' },
            { minQty: 1000, price: 0.25, name: '超大批量', discount: '31折' }
        ]
    },
    airplane_box: {
        id: 'airplane_box', category: 'carton_box', name: '飞机盒（T5）', icon: '✈️',
        description: 'T5飞机盒 300*220*70mm，翻盖式包装适合服饰/3C',
        unit: '个', cost: 1.8, suitableWeight: [0.5, 3],
        spec: { length: 300, width: 220, height: 70, thickness: 3, material: 'E瓦楞白卡', bear: 5 },
        lowStockThreshold: 20,
        consumption: { base: 0, perItem: 0 },
        priceTiers: [
            { minQty: 1, price: 2.2, name: '散买' },
            { minQty: 30, price: 1.8, name: '小批量', discount: '82折' },
            { minQty: 100, price: 1.3, name: '中批量', discount: '59折' },
            { minQty: 500, price: 0.9, name: '大批量', discount: '41折' }
        ]
    },
    long_box: {
        id: 'long_box', category: 'carton_box', name: '长条雨伞盒', icon: '📏',
        description: '长条箱 700*90*90mm，适合雨伞/渔具/长柄商品',
        unit: '个', cost: 1.5, suitableWeight: [0.3, 2],
        spec: { length: 700, width: 90, height: 90, thickness: 3, material: '瓦楞纸', bear: 5 },
        lowStockThreshold: 15,
        consumption: { base: 0, perItem: 0 },
        priceTiers: [
            { minQty: 1, price: 2.0, name: '散买' },
            { minQty: 30, price: 1.5, name: '小批量' },
            { minQty: 200, price: 1.0, name: '中批量', discount: '5折' }
        ]
    },
    flat_box: {
        id: 'flat_box', category: 'carton_box', name: '扁平画册盒', icon: '📐',
        description: '扁平盒 400*300*30mm，适合画册/相册/服装扁平件',
        unit: '个', cost: 1.1, suitableWeight: [0.2, 2],
        spec: { length: 400, width: 300, height: 30, thickness: 2, material: 'E瓦楞', bear: 3 },
        lowStockThreshold: 15,
        consumption: { base: 0, perItem: 0 },
        priceTiers: [
            { minQty: 1, price: 1.5, name: '散买' },
            { minQty: 50, price: 1.1, name: '小批量' },
            { minQty: 300, price: 0.7, name: '中批量', discount: '47折' }
        ]
    },
    gift_box: {
        id: 'gift_box', category: 'gift_class', name: '高端翻盖礼品盒', icon: '🎁',
        description: '礼品盒 280*200*90mm，磁吸翻盖适合珠宝/高端礼物',
        unit: '个', cost: 8.0, suitableWeight: [0.2, 3],
        spec: { length: 280, width: 200, height: 90, thickness: 4, material: '铜版纸+灰板', bear: 5 },
        lowStockThreshold: 10,
        consumption: { base: 0, perItem: 0 },
        priceTiers: [
            { minQty: 1, price: 10.0, name: '散买' },
            { minQty: 20, price: 8.0, name: '小批量' },
            { minQty: 100, price: 5.5, name: '中批量', discount: '55折' }
        ]
    },

    // ========== 2. 缓冲类 cushioning ==========
    bubbleWrap: {
        id: 'bubbleWrap', category: 'cushioning', name: '气泡膜',
        icon: '🫧', description: '防震气泡膜，易碎品必备（宽50cm 厚3丝）',
        unit: '米', cost: 0.45, suitableWeight: null,
        spec: { width: 500, thickness: 0.03, material: 'PE新料', bubble: '10mm' },
        lowStockThreshold: 30,
        consumption: { base: 0.5, perItem: 0.3 },
        priceTiers: [
            { minQty: 1, price: 0.8, name: '散买' },
            { minQty: 10, price: 0.6, name: '小批量', discount: '75折' },
            { minQty: 50, price: 0.45, name: '中批量', discount: '56折' },
            { minQty: 200, price: 0.3, name: '大批量', discount: '37折' },
            { minQty: 500, price: 0.2, name: '超大批量', discount: '25折' },
            { minQty: 1000, price: 0.16, name: '整托采购', discount: '20折' },
            { minQty: 5000, price: 0.12, name: '工厂直发', discount: '15折' },
            { minQty: 10000, price: 0.09, name: '产业带包仓', discount: '11折' },
            { minQty: 100000, price: 0.06, name: '十万件包仓', discount: '8折' }
        ]
    },
    air_column: {
        id: 'air_column', category: 'cushioning', name: '气柱袋卷材', icon: '💨',
        description: '充气气柱袋卷材 宽60cm，适合红酒/奶粉/化妆品',
        unit: '米', cost: 2.5, suitableWeight: null,
        spec: { width: 600, thickness: 0.07, material: 'PA+PE共挤膜', bear: '60kg/柱' },
        lowStockThreshold: 15,
        consumption: { base: 0, perItem: 0 },
        priceTiers: [
            { minQty: 1, price: 3.2, name: '散买' },
            { minQty: 30, price: 2.5, name: '小批量' },
            { minQty: 100, price: 1.8, name: '中批量', discount: '56折' },
            { minQty: 500, price: 1.2, name: '大批量', discount: '37折' }
        ]
    },
    epe_foam: {
        id: 'epe_foam', category: 'cushioning', name: 'EPE珍珠棉板材', icon: '🧱',
        description: '珍珠棉板材 1m*2m*10mm，可任意裁剪内衬',
        unit: '张', cost: 4.5, suitableWeight: null,
        spec: { length: 2000, width: 1000, thickness: 10, material: 'EPE聚乙烯', density: '28K' },
        lowStockThreshold: 8,
        consumption: { base: 0, perItem: 0 },
        priceTiers: [
            { minQty: 1, price: 6.0, name: '散买' },
            { minQty: 20, price: 4.5, name: '小批量' },
            { minQty: 100, price: 3.0, name: '中批量', discount: '5折' }
        ]
    },
    gourd_film: {
        id: 'gourd_film', category: 'cushioning', name: '葫芦膜缓冲气垫', icon: '🫛',
        description: '葫芦形充气缓冲膜，无需胶带可直接填充缝隙',
        unit: '米', cost: 0.8, suitableWeight: null,
        spec: { width: 400, thickness: 0.02, material: 'HDPE', style: '连体葫芦' },
        lowStockThreshold: 50,
        consumption: { base: 0, perItem: 0 },
        priceTiers: [
            { minQty: 1, price: 1.2, name: '散买' },
            { minQty: 100, price: 0.8, name: '小批量' },
            { minQty: 500, price: 0.5, name: '大批量', discount: '42折' }
        ]
    },
    kraft_cushion: {
        id: 'kraft_cushion', category: 'eco', name: '牛皮纸缓冲纸垫', icon: '🌿',
        description: '褶皱牛皮纸缓冲垫，环保可回收替代气泡膜',
        unit: '米', cost: 1.0, suitableWeight: null,
        spec: { width: 380, thickness: 0.08, material: '再生牛皮纸', standard: 'FSC环保认证' },
        lowStockThreshold: 20,
        consumption: { base: 0, perItem: 0 },
        priceTiers: [
            { minQty: 1, price: 1.3, name: '散买' },
            { minQty: 50, price: 1.0, name: '小批量' },
            { minQty: 200, price: 0.7, name: '大批量', discount: '54折' }
        ]
    },

    // ========== 3. 封装类 sealing ==========
    tape: {
        id: 'tape', category: 'sealing', name: '透明封箱胶带',
        icon: '🧻', description: '透明封箱胶带（48mm*100y 厚45μ）',
        unit: '卷', cost: 3.0, suitableWeight: null,
        spec: { width: 48, length: 91, thickness: 0.045, material: 'BOPP+压敏胶', color: '透明' },
        lowStockThreshold: 5,
        consumption: { base: 0.05, perItem: 0 },
        priceTiers: [
            { minQty: 1, price: 5.0, name: '散买' },
            { minQty: 10, price: 4.0, name: '小批量', discount: '8折' },
            { minQty: 50, price: 3.0, name: '中批量', discount: '6折' },
            { minQty: 200, price: 2.4, name: '大批量', discount: '48折' },
            { minQty: 1000, price: 1.8, name: '整托采购', discount: '36折' },
            { minQty: 5000, price: 1.4, name: '工厂直发', discount: '28折' },
            { minQty: 10000, price: 1.1, name: '产业带包仓', discount: '22折' },
            { minQty: 100000, price: 0.8, name: '十万件包仓', discount: '16折' }
        ]
    },
    warn_tape: {
        id: 'warn_tape', category: 'sealing', name: '警示语胶带', icon: '🚨',
        description: '黄底红字警示胶带 禁止撕毁/小心轻放/易碎',
        unit: '卷', cost: 3.5, suitableWeight: null,
        spec: { width: 48, length: 91, thickness: 0.045, material: 'BOPP印刷', color: '黄底红字' },
        lowStockThreshold: 3,
        consumption: { base: 0, perItem: 0 },
        priceTiers: [
            { minQty: 1, price: 5.5, name: '散买' },
            { minQty: 10, price: 4.2, name: '小批量' },
            { minQty: 50, price: 3.0, name: '中批量', discount: '55折' }
        ]
    },
    pp_strap: {
        id: 'pp_strap', category: 'sealing', name: 'PP打包带', icon: '🧵',
        description: 'PP机用打包带 15mm 一箱10kg，大件纸箱捆扎',
        unit: '卷', cost: 22, suitableWeight: null,
        spec: { width: 15, thickness: 1.1, length: 1500, material: '聚丙烯', color: '绿色' },
        lowStockThreshold: 2,
        consumption: { base: 0, perItem: 0 },
        priceTiers: [
            { minQty: 1, price: 28, name: '散买' },
            { minQty: 5, price: 22, name: '小批量' },
            { minQty: 20, price: 17, name: '中批量', discount: '61折' }
        ]
    },
    stretch_film: {
        id: 'stretch_film', category: 'sealing', name: 'PE缠绕膜', icon: '🌀',
        description: '手用缠绕膜 50cm*300m 托盘打包防尘防水',
        unit: '卷', cost: 18, suitableWeight: null,
        spec: { width: 500, length: 300, thickness: 0.02, material: 'LLDPE拉伸膜' },
        lowStockThreshold: 3,
        consumption: { base: 0, perItem: 0 },
        priceTiers: [
            { minQty: 1, price: 25, name: '散买' },
            { minQty: 5, price: 18, name: '小批量' },
            { minQty: 30, price: 13, name: '中批量', discount: '52折' }
        ]
    },
    courier_bag: {
        id: 'courier_bag', category: 'sealing', name: '快递防水打包袋', icon: '🛍️',
        description: '破坏性快递袋 28*42+4cm，防水耐撕，适合服饰/家纺',
        unit: '个', cost: 0.25, suitableWeight: [0.1, 3],
        spec: { width: 280, length: 460, thickness: 0.12, material: 'PE新料+破坏性胶', standard: '邮政通用' },
        lowStockThreshold: 100,
        consumption: { base: 0, perItem: 0 },
        priceTiers: [
            { minQty: 1, price: 0.4, name: '散买' },
            { minQty: 100, price: 0.25, name: '小批量' },
            { minQty: 1000, price: 0.15, name: '大批量', discount: '37折' },
            { minQty: 5000, price: 0.1, name: '超大批量', discount: '25折' }
        ]
    },

    // ========== 4. 标签类 label ==========
    thermal_label: {
        id: 'thermal_label', category: 'label', name: '热敏面单标签纸', icon: '🏷️',
        description: '三联电子面单热敏纸 100*180mm 500张/卷',
        unit: '卷', cost: 15, suitableWeight: null,
        spec: { width: 100, height: 180, quantity: 500, material: '三防热敏纸', brand: '菜鸟/京东通用' },
        lowStockThreshold: 5,
        // 配方层按「张→卷」折算（1张=1/500卷），勿再按整卷/单扣减
        consumption: { base: 0.002, perItem: 0 },
        priceTiers: [
            { minQty: 1, price: 20, name: '散买' },
            { minQty: 10, price: 15, name: '小批量' },
            { minQty: 50, price: 11, name: '大批量', discount: '55折' }
        ]
    },
    fragile_label: {
        id: 'fragile_label', category: 'label', name: '易碎品不干胶贴纸', icon: '💥',
        description: '小心易碎警示贴纸 100*100mm 500张/包',
        unit: '包', cost: 5, suitableWeight: null,
        spec: { width: 100, height: 100, quantity: 500, material: '铜版纸覆光膜', style: '中英文警示' },
        lowStockThreshold: 3,
        consumption: { base: 0.002, perItem: 0 },
        priceTiers: [
            { minQty: 1, price: 6.5, name: '散买' },
            { minQty: 10, price: 5.0, name: '小批量' },
            { minQty: 50, price: 3.5, name: '大批量', discount: '54折' }
        ]
    },

    // ========== 5. 内衬托类 inner ==========
    pulp_tray: {
        id: 'pulp_tray', category: 'inner', name: '环保纸浆模塑内托', icon: '🥚',
        description: '甘蔗浆纸托，定制电子产品/化妆品内衬，环保可降解',
        unit: '个', cost: 1.5, suitableWeight: [0.1, 2],
        spec: { style: '定制模塑', material: '甘蔗竹浆', standard: 'ROHS环保', color: '本色/白色' },
        lowStockThreshold: 30,
        consumption: { base: 0, perItem: 0 },
        priceTiers: [
            { minQty: 1, price: 2.2, name: '散买/打样' },
            { minQty: 100, price: 1.5, name: '小批量' },
            { minQty: 1000, price: 0.8, name: '大批量', discount: '36折' }
        ]
    },

    // ========== 6. 礼品类 gift_class ==========
    ribbon: {
        id: 'ribbon', category: 'gift_class', name: '缎带/罗纹丝带', icon: '🎀',
        description: '双面缎带 25mm宽 长91米，礼品包装点缀',
        unit: '卷', cost: 12, suitableWeight: null,
        spec: { width: 25, length: 91, material: '涤纶缎面', color: '酒红/墨绿/香槟' },
        lowStockThreshold: 2,
        consumption: { base: 0, perItem: 0 },
        priceTiers: [
            { minQty: 1, price: 16, name: '散买' },
            { minQty: 10, price: 12, name: '小批量' },
            { minQty: 50, price: 8, name: '大批量' }
        ]
    },
    greeting_card: {
        id: 'greeting_card', category: 'gift_class', name: '烫金贺卡', icon: '💌',
        description: '商务/节日烫金祝福卡，可定制LOGO手写心意',
        unit: '张', cost: 0.8, suitableWeight: null,
        spec: { width: 150, height: 100, material: '300g特种纸', process: '烫金+击凸' },
        lowStockThreshold: 30,
        consumption: { base: 0, perItem: 0 },
        priceTiers: [
            { minQty: 1, price: 1.5, name: '散买' },
            { minQty: 50, price: 0.8, name: '小批量' },
            { minQty: 500, price: 0.4, name: '大批量', discount: '27折' }
        ]
    },
    gift_bag: {
        id: 'gift_bag', category: 'outer', name: '白卡纸手提礼品袋', icon: '🛍️',
        description: '烫银礼品手提袋 中号28*20*10cm，高档服饰/礼盒外拎',
        unit: '个', cost: 2.2, suitableWeight: [0.3, 3],
        spec: { width: 280, height: 200, gusset: 100, material: '250g白卡', handle: '棉绳' },
        lowStockThreshold: 20,
        consumption: { base: 0, perItem: 0 },
        priceTiers: [
            { minQty: 1, price: 3.0, name: '散买' },
            { minQty: 50, price: 2.2, name: '小批量' },
            { minQty: 500, price: 1.3, name: '大批量', discount: '43折' }
        ]
    },

    // ========== 7. 保护类 protection ==========
    corner_guard: {
        id: 'corner_guard', category: 'protection', name: '纸护角/L型护边', icon: '🛡️',
        description: '50*50*5mm纸护角，家具/家电边角防撞保护',
        unit: '根', cost: 0.35, suitableWeight: null,
        spec: { width: 50, height: 50, length: 500, thickness: 5, material: '多层牛皮纸+胶' },
        lowStockThreshold: 50,
        consumption: { base: 0, perItem: 0 },
        priceTiers: [
            { minQty: 1, price: 0.6, name: '散买' },
            { minQty: 100, price: 0.35, name: '小批量' },
            { minQty: 1000, price: 0.2, name: '大批量', discount: '33折' }
        ]
    },
    bubble_envelope: {
        id: 'bubble_envelope', category: 'protection', name: '共挤膜气泡信封袋', icon: '✉️',
        description: '自粘气泡信封袋 20*28cm，首饰/美妆/3C小件防压',
        unit: '个', cost: 0.6, suitableWeight: [0.1, 1],
        spec: { width: 200, length: 280, thickness: 0.06, material: '共挤膜+10mm气泡', seal: '破坏性胶' },
        lowStockThreshold: 50,
        consumption: { base: 0, perItem: 0 },
        priceTiers: [
            { minQty: 1, price: 0.9, name: '散买' },
            { minQty: 100, price: 0.6, name: '小批量' },
            { minQty: 1000, price: 0.35, name: '大批量', discount: '39折' }
        ]
    },
    zip_bag: {
        id: 'zip_bag', category: 'protection', name: 'PE透明自封袋', icon: '🔐',
        description: '加厚自封袋 8丝 14*20cm，食品/配件分装防尘防潮',
        unit: '包', cost: 5, suitableWeight: null,
        spec: { width: 140, length: 200, thickness: 0.08, quantity: 100, material: 'LDPE食品级' },
        lowStockThreshold: 5,
        consumption: { base: 0, perItem: 0 },
        priceTiers: [
            { minQty: 1, price: 7, name: '散买' },
            { minQty: 10, price: 5, name: '小批量' },
            { minQty: 100, price: 3, name: '大批量', discount: '43折' }
        ]
    },

    // ========== 8. 耗材类 consumable ==========
    desiccant: {
        id: 'desiccant', category: 'consumable', name: '硅胶干燥剂小包', icon: '🌫️',
        description: '1g/5g食品级矿物干燥剂，防潮防霉',
        unit: '包', cost: 0.05, suitableWeight: null,
        spec: { spec: '5g/包', material: '硅胶颗粒', standard: '食品级/SGS', packaging: '爱华纸透气' },
        lowStockThreshold: 200,
        consumption: { base: 0, perItem: 0 },
        priceTiers: [
            { minQty: 1, price: 0.1, name: '散买' },
            { minQty: 100, price: 0.05, name: '小批量' },
            { minQty: 1000, price: 0.025, name: '大批量', discount: '25折' }
        ]
    },
    ice_pack: {
        id: 'ice_pack', category: 'consumable', name: '凝胶冰袋保鲜冷藏', icon: '🧊',
        description: '400ml自吸水冰袋，生鲜食品冷链运输',
        unit: '个', cost: 0.45, suitableWeight: null,
        spec: { volume: 400, material: '吸水树脂凝胶', temp: '-18℃', duration: '48h' },
        lowStockThreshold: 50,
        consumption: { base: 0, perItem: 0 },
        priceTiers: [
            { minQty: 1, price: 0.8, name: '散买' },
            { minQty: 100, price: 0.45, name: '小批量' },
            { minQty: 1000, price: 0.25, name: '大批量', discount: '31折' }
        ]
    },
    security_tag: {
        id: 'security_tag', category: 'consumable', name: '一次性防伪扣', icon: '🔒',
        description: '塑料防盗扣 球鞋/服饰/箱包防伪溯源，防掉包',
        unit: '个', cost: 0.12, suitableWeight: null,
        spec: { style: '子弹头', material: 'ABS+不锈钢丝', print: '定制LOGO', length: 250 },
        lowStockThreshold: 100,
        consumption: { base: 0, perItem: 0 },
        priceTiers: [
            { minQty: 1, price: 0.3, name: '散买' },
            { minQty: 100, price: 0.12, name: '小批量' },
            { minQty: 1000, price: 0.05, name: '大批量', discount: '17折' }
        ]
    }
};

// 包材精简：只保留 6 种核心材料（纸箱/气泡膜/胶带/面单/易碎贴/冰袋），
// 其余 SKU 全部合并到核心材料（旧库存按此合并，采购/展示均只保留核心6种）
const PACKAGING_MATERIAL_ALIASES = {
    // 纸箱类 → 标准纸箱
    airplane_box: 'carton',
    long_box: 'carton',
    flat_box: 'carton',
    carton_small: 'carton',
    carton_large: 'carton',
    gift_box: 'carton',
    corner_guard: 'carton',
    // 缓冲类 → 气泡膜
    air_column: 'bubbleWrap',
    gourd_film: 'bubbleWrap',
    kraft_cushion: 'bubbleWrap',
    epe_foam: 'bubbleWrap',
    pulp_tray: 'bubbleWrap',
    // 封装类 → 胶带
    warn_tape: 'tape',
    pp_strap: 'tape',
    stretch_film: 'tape',
    // 软包装 → 标准纸箱
    courier_bag: 'carton',
    bubble_envelope: 'carton',
    zip_bag: 'carton',
    poly_bag: 'carton',
    // 礼品辅料 → 标准纸箱
    ribbon: 'carton',
    greeting_card: 'carton',
    thank_you_card: 'carton',
    gift_bag: 'carton',
    // 防伪扣/易碎贴 → 胶带（3.6 极简：不再单独管理）
    security_tag: 'tape',
    fragile_sticker: 'tape',
    fragile_label: 'tape',
    // 面单 → 胶带（3.6 极简：快递公司提供面单，不计耗材；旧库存并入胶带）
    thermal_label: 'tape',
    // 干燥剂/冰袋 → 气泡膜（3.6 极简：冷链以加厚缓冲替代）
    desiccant: 'bubbleWrap',
    ice_pack: 'bubbleWrap'
};
Object.keys(PACKAGING_MATERIAL_ALIASES).forEach((from) => {
    if (PACKAGING_MATERIALS[from]) PACKAGING_MATERIALS[from].active = false;
});

// ==================== 包装材料模块扩展配置（ERP式管理）====================
// 10大包装材料分类（对应 PACKAGING_MATERIALS[x].category 字段）
const PACKAGING_CATEGORIES = [
    { id: 'carton_box', name: '纸箱纸盒', icon: '📦', color: '#8d6e63', desc: '纸箱/飞机盒/邮政箱/礼盒等外盒' },
    { id: 'cushioning', name: '缓冲防震', icon: '🫧', color: '#42a5f5', desc: '气泡膜/气柱袋/珍珠棉/葫芦膜' },
    { id: 'sealing',    name: '封装打包', icon: '🧻', color: '#ffca28', desc: '胶带/打包带/缠绕膜/快递袋' },
    { id: 'label',      name: '标签面单', icon: '🏷️', color: '#ef5350', desc: '热敏纸/不干胶/警示/易碎贴' },
    { id: 'inner',      name: '内衬托',   icon: '🥚', color: '#a1887f', desc: '纸浆模塑/EVA内衬/吸塑托盘' },
    { id: 'eco',        name: '环保包装', icon: '🌿', color: '#66bb6a', desc: '再生牛皮纸/可降解/蜂窝纸' },
    { id: 'gift_class', name: '礼品辅料', icon: '🎀', color: '#ec407a', desc: '缎带/贺卡/烫金/礼品袋' },
    { id: 'protection', name: '防护包装', icon: '🛡️', color: '#5c6bc0', desc: '护角/气泡信封/自封袋' },
    { id: 'consumable', name: '冷链耗材', icon: '🧊', color: '#26c6da', desc: '干燥剂/冰袋/防伪扣/扎带' },
    { id: 'outer',      name: '外拎外包', icon: '🛍️', color: '#ab47bc', desc: '手提纸袋/无纺布袋/覆膜袋' }
];

// 包装材料专属供应商（覆盖全国包装产业带）
const PACKAGING_SUPPLIERS = [
    { id: 'pkg_s1', name: '东莞纸箱厂（虎门产业带）', level: 2, categories: ['carton_box', 'outer'],
      qualityBase: 75, priceMultiplier: 0.9, minOrder: 50, deliveryDays: 3, city: '东莞', province: '广东',
      specialty: '大型瓦楞纸箱/飞机盒/礼品盒定制', grade: 'A', rating: 4.7,
      description: '珠三角最大纸箱厂，日产能50万只', availableGrades: ['B','A'] },
    { id: 'pkg_s2', name: '义乌小商品包装批发城',   level: 1, categories: ['carton_box','sealing','label','consumable'],
      qualityBase: 65, priceMultiplier: 0.75, minOrder: 10, deliveryDays: 4, city: '义乌', province: '浙江',
      specialty: '一站式低价采购，品种最全', grade: 'B', rating: 4.4,
      description: '义乌小商品市场官方配套包装供应商', availableGrades: ['C','B'] },
    { id: 'pkg_s3', name: '温州龙港软包装产业基地', level: 2, categories: ['sealing','label','gift_class','outer'],
      qualityBase: 80, priceMultiplier: 0.85, minOrder: 100, deliveryDays: 5, city: '温州', province: '浙江',
      specialty: '软包装印刷/不干胶/手提袋/缎带', grade: 'A', rating: 4.6,
      description: '中国印刷城·龙港，定制烫金UV工艺领先', availableGrades: ['B','A'] },
    { id: 'pkg_s4', name: '泉州晋江鞋服包装集团',   level: 3, categories: ['carton_box','gift_class','outer','protection'],
      qualityBase: 85, priceMultiplier: 1.0, minOrder: 200, deliveryDays: 6, city: '泉州', province: '福建',
      specialty: '鞋服高端包装/防伪扣/礼品袋定制', grade: 'A+', rating: 4.8,
      description: '安踏/特步/361°指定包装战略供应商', availableGrades: ['A','S'] },
    { id: 'pkg_s5', name: '苏州太仓缓冲材料产业园', level: 2, categories: ['cushioning','eco','inner'],
      qualityBase: 78, priceMultiplier: 0.92, minOrder: 30, deliveryDays: 4, city: '太仓', province: '江苏',
      specialty: '气泡膜/气柱袋/EPE珍珠棉/葫芦膜', grade: 'A', rating: 4.5,
      description: '长三角缓冲材料龙头，气垫机配套销售', availableGrades: ['B','A'] },
    { id: 'pkg_s6', name: '河北沧州包装机械材料城', level: 1, categories: ['sealing','label','consumable'],
      qualityBase: 62, priceMultiplier: 0.7, minOrder: 5, deliveryDays: 5, city: '沧州', province: '河北',
      specialty: '胶带/缠绕膜/打包带低价走量', grade: 'B-', rating: 4.2,
      description: '北方胶带产业带，整箱批发更划算', availableGrades: ['C','B'] },
    { id: 'pkg_s7', name: '佛山顺德家电包装配套厂', level: 3, categories: ['carton_box','cushioning','protection','inner'],
      qualityBase: 88, priceMultiplier: 1.05, minOrder: 100, deliveryDays: 7, city: '佛山', province: '广东',
      specialty: '家电/家具重型包装+护角全套方案', grade: 'A+', rating: 4.9,
      description: '美的/格力/海尔指定家电包装服务商', availableGrades: ['A','S'] },
    { id: 'pkg_s8', name: '上海进口环保包装贸易',   level: 4, categories: ['eco','inner','outer','gift_class'],
      qualityBase: 92, priceMultiplier: 1.35, minOrder: 50, deliveryDays: 10, city: '上海', province: '上海',
      specialty: 'FSC认证环保纸/可降解材料/奢侈品包装', grade: 'S', rating: 4.9,
      description: 'LV/Gucci/Apple指定环保包装供应商', availableGrades: ['A','S','SS'] },
    { id: 'pkg_s9', name: '山东平度冷链包装基地',   level: 2, categories: ['cushioning','consumable','protection'],
      qualityBase: 76, priceMultiplier: 0.88, minOrder: 80, deliveryDays: 6, city: '平度', province: '山东',
      specialty: '生鲜冷链冰袋/保温箱/气柱袋', grade: 'A', rating: 4.6,
      description: '北方生鲜电商包装战略合作伙伴', availableGrades: ['B','A'] },
    { id: 'pkg_s10',name: '深圳3C数码包装定制厂', level: 3, categories: ['inner','carton_box','label','outer'],
      qualityBase: 86, priceMultiplier: 1.02, minOrder: 300, deliveryDays: 8, city: '深圳', province: '广东',
      specialty: '3C电子吸塑/纸托/高端礼盒全套', grade: 'A+', rating: 4.8,
      description: '华为/小米/OPPO供应链包装核心厂', availableGrades: ['A','S'] },
    { id: 'pkg_s11',name: '四川成都食品包装产业园', level: 2, categories: ['consumable','sealing','label','eco'],
      qualityBase: 74, priceMultiplier: 0.87, minOrder: 60, deliveryDays: 6, city: '成都', province: '四川',
      specialty: '食品级干燥剂/真空袋/牛皮纸', grade: 'A', rating: 4.5,
      description: '西南食品包装QS认证齐全', availableGrades: ['B','A'] }
];

// 采购申请单状态（符合ERP审批流程：申请→审批→采购→入库/取消）
const PACKAGING_PURCHASE_STATUS = [
    { code: 'draft',       name: '草稿',     color: '#9e9e9e', icon: '📝', canEdit: true,  next: ['pending'] },
    { code: 'pending',     name: '待审批',   color: '#ff9800', icon: '⏳', canEdit: false, next: ['approved','rejected','canceled'] },
    { code: 'approved',    name: '已审批',   color: '#2196f3', icon: '✅', canEdit: false, next: ['purchasing','canceled'] },
    { code: 'rejected',    name: '已驳回',   color: '#f44336', icon: '❌', canEdit: true,  next: ['draft','canceled'] },
    { code: 'purchasing',  name: '采购中',   color: '#9c27b0', icon: '🚛', canEdit: false, next: ['received','canceled'] },
    { code: 'received',    name: '已入库',   color: '#4caf50', icon: '📥', canEdit: false, next: [] },
    { code: 'canceled',    name: '已取消',   color: '#607d8b', icon: '🚫', canEdit: false, next: [] }
];

// 包装材料报表配置（库存周转率/成本/损耗/采购金额的统计维度）
const PACKAGING_REPORT_CONFIG = {
    dimensions: ['day','week','month','quarter'],
    costItems: ['purchase_cost','auto_emergency_cost','storage_cost','material_waste'],
    kpis: [
        { id: 'turnover_rate',   name: '库存周转率',   unit: '次/月', color: '#4caf50', formula: '月度消耗成本÷月度平均库存成本' },
        { id: 'pkg_per_order',   name: '单均包装成本', unit: '元/单', color: '#ff9800', formula: '当日包装材料总成本÷当日发货订单数' },
        { id: 'pkg_ratio',       name: '包装成本占比', unit: '%',     color: '#2196f3', formula: '包装材料总成本÷订单销售额×100' },
        { id: 'urgent_rate',     name: '紧急采购率',   unit: '%',     color: '#f44336', formula: '紧急采购金额÷总采购金额×100' },
        { id: 'stock_adherence', name: '库存达标率',   unit: '%',     color: '#9c27b0', formula: '达标材料数÷材料总数×100' }
    ]
};

// 仓库分区配置（模拟储位）
const WAREHOUSE_ZONES = {
    receiving: { id: 'receiving', name: '收货区', icon: '📥', color: '#2196f3' },
    storage: { id: 'storage', name: '存储区', icon: '🗄️', color: '#4caf50' },
    packing: { id: 'packing', name: '打包区', icon: '📦', color: '#ff9800' },
    shipping: { id: 'shipping', name: '发货区', icon: '🚚', color: '#9c27b0' }
};

// 库存预警等级配置
const STOCK_ALERT_LEVELS = {
    outOfStock: { level: 'critical', color: '#f44336', icon: '🚨', name: '缺货' },
    lowStock: { level: 'warning', color: '#ff9800', icon: '⚠️', name: '低库存' },
    overStock: { level: 'notice', color: '#ffeb3b', name: '超储' },
    slowMoving: { level: 'notice', color: '#9e9e9e', icon: '🐢', name: '滞销' }
};

// ABC库存分类（基于周转率/销售额）
const ABC_CLASSIFICATION = {
    A: { name: 'A类(畅销)', color: '#4caf50', percent: 20, desc: '贡献80%销售额，重点管理' },
    B: { name: 'B类(一般)', color: '#2196f3', percent: 30, desc: '贡献15%销售额，常规管理' },
    C: { name: 'C类(滞销)', color: '#f44336', percent: 50, desc: '贡献5%销售额，减少库存' }
};

// ==================== 银行/金融系统 ====================
const BANK_CONFIG = {
    // 活期存款
    currentDeposit: {
        interestRate: 0.002,
        minAmount: 1,
        description: '随存随取，按日计息'
    },
    // 定期存款产品
    fixedDeposits: [
        {
            id: 'fixed_7',
            name: '7天定期',
            termDays: 7,
            interestRate: 0.004,
            minAmount: 1000,
            earlyWithdrawPenalty: 0.5,
            description: '7天期限，利率比活期高，提前支取按活期计息并扣50%利息'
        },
        {
            id: 'fixed_15',
            name: '15天定期',
            termDays: 15,
            interestRate: 0.006,
            minAmount: 5000,
            earlyWithdrawPenalty: 0.4,
            description: '15天期限，中等收益，提前支取按活期计息并扣40%利息'
        },
        {
            id: 'fixed_30',
            name: '30天定期',
            termDays: 30,
            interestRate: 0.01,
            minAmount: 10000,
            earlyWithdrawPenalty: 0.3,
            description: '30天期限，收益最高，提前支取按活期计息并扣30%利息'
        }
    ],
    // 贷款产品（与 BankData 同步；实际额度以信用额度+creditRatio 为准）
    // 期限：90 / 180 / 270 天，覆盖进货到货周期
    loanProducts: [
        {
            id: 'emergency',
            name: '应急贷款',
            minAmount: 500,
            maxAmount: 10000000000,
            creditRatio: 0.2,
            interestRate: 0.0012,
            minTerm: 90,
            maxTerm: 90,
            minLevel: 1,
            description: '90天期小额应急，覆盖一次进货到货回款周期'
        },
        {
            id: 'working_capital',
            name: '经营周转贷',
            minAmount: 1000,
            maxAmount: 10000000000,
            creditRatio: 0.6,
            interestRate: 0.0008,
            minTerm: 180,
            maxTerm: 180,
            minLevel: 2,
            description: '180天经营周转，适合多轮进货与回款；额度随等级与流水提升'
        },
        {
            id: 'expansion',
            name: '扩大经营贷',
            minAmount: 10000,
            maxAmount: 10000000000,
            creditRatio: 1.0,
            interestRate: 0.0006,
            minTerm: 270,
            maxTerm: 270,
            minLevel: 3,
            description: '270天大额长期贷款，利率更优；可用满额信用额度'
        }
    ],
    // 信用额度规则：随店铺等级 + 累计销售流水提升，最高一百亿
    creditLimit: {
        baseLimit: 20000,
        levelLimits: {
            1: 20000,
            2: 100000,
            3: 500000,
            4: 5000000,
            5: 50000000,
            6: 500000000,
            7: 5000000000
        },
        levelBonus: 5000,
        turnoverRatio: 0.25,
        reputationBonus: 200,
        reputationMultiplier: 0.01,
        maxLimit: 10000000000
    },
    // 逾期规则
    overdue: {
        penaltyRate: 0.002,
        maxOverdueDays: 30,
        reputationPenalty: 5
    }
};

// ==================== 促销系统 ====================
const PROMOTION_TYPES = {
    flashSale: {
        id: 'flashSale',
        name: '限时秒杀',
        icon: '⚡',
        description: '超低价限量秒杀，吸引流量'
    },
    fullReduction: {
        id: 'fullReduction',
        name: '满减活动',
        icon: '💰',
        description: '满多少减多少，提高客单价'
    },
    groupBuy: {
        id: 'groupBuy',
        name: '拼团活动',
        icon: '👥',
        description: '拉人拼团，社交裂变'
    },
    blindBox: {
        id: 'blindBox',
        name: '盲盒福袋',
        icon: '🎁',
        description: '神秘福袋，惊喜连连'
    }
};

/** 促销活动状态（列表徽章用，必须存在，否则会显示英文乱码/问号） */
const PROMOTION_STATUS = {
    draft:   { id: 'draft',   name: '草稿',   icon: '📝', color: '#9e9e9e' },
    pending: { id: 'pending', name: '未开始', icon: '⏳', color: '#ff9800' },
    active:  { id: 'active',  name: '进行中', icon: '🔥', color: '#4caf50' },
    paused:  { id: 'paused',  name: '已暂停', icon: '⏸', color: '#607d8b' },
    ended:   { id: 'ended',   name: '已结束', icon: '✅', color: '#795548' }
};

/** 促销类型 ID 归一化：兼容 camelCase / snake_case */
function normalizePromotionTypeId(type) {
    const t = String(type || '');
    const map = {
        flash_sale: 'flashSale',
        full_reduction: 'fullReduction',
        group_buy: 'groupBuy',
        blind_box: 'blindBox',
        free_shipping: 'freeShipping',
        flashSale: 'flashSale',
        fullReduction: 'fullReduction',
        groupBuy: 'groupBuy',
        blindBox: 'blindBox',
        discount: 'discount',
        coupon: 'coupon',
        gift: 'gift',
        freeShipping: 'freeShipping'
    };
    return map[t] || t;
}

// ==================== 大促日历 ====================
const FESTIVAL_EVENTS = [
    { id: 'double11', name: '双11大促', month: 11, day: 11, duration: 3, trafficMultiplier: 5, icon: '🛒' },
    { id: 'double618', name: '618大促', month: 6, day: 18, duration: 3, trafficMultiplier: 4, icon: '🎉' },
    { id: 'spring_festival', name: '年货节', month: 1, day: 25, duration: 7, trafficMultiplier: 3, icon: '🧧' },
    { id: 'valentines', name: '情人节', month: 2, day: 14, duration: 2, trafficMultiplier: 2.5, icon: '❤️' },
    { id: 'womens_day', name: '女神节', month: 3, day: 8, duration: 2, trafficMultiplier: 2, icon: '👩' },
    { id: 'mothers_day', name: '母亲节', month: 5, day: 12, duration: 2, trafficMultiplier: 2, icon: '👩‍👧' },
    { id: 'childrens_day', name: '儿童节', month: 6, day: 1, duration: 1, trafficMultiplier: 2, icon: '👶' },
    { id: 'national_day', name: '国庆黄金周', month: 10, day: 1, duration: 7, trafficMultiplier: 3, icon: '🇨🇳' },
    { id: 'christmas', name: '双旦礼遇', month: 12, day: 25, duration: 5, trafficMultiplier: 2.5, icon: '🎄' }
];

// ==================== 供应商系统 ====================
const SUPPLIER_RELATION_LEVELS = [
    { level: 1, name: '初次合作', minOrders: 0, priceDiscount: 1.0, priorityDelivery: false, unlockAGrade: false },
    { level: 2, name: '熟悉客户', minOrders: 10, priceDiscount: 0.97, priorityDelivery: false, unlockAGrade: false },
    { level: 3, name: '重要客户', minOrders: 30, priceDiscount: 0.93, priorityDelivery: true, unlockAGrade: false },
    { level: 4, name: 'VIP客户', minOrders: 80, priceDiscount: 0.88, priorityDelivery: true, unlockAGrade: true },
    { level: 5, name: '战略伙伴', minOrders: 200, priceDiscount: 0.82, priorityDelivery: true, unlockAGrade: true }
];

// ==================== 主播系统 ====================
const STREAMER_TYPES = [
    { id: 'newbie', name: '新人主播', icon: '📱', baseFans: 1000, costPerHour: 50, conversionBonus: 1.1, riskLevel: 0.02, description: '价格便宜，效果一般' },
    { id: 'mid', name: '腰部主播', icon: '🎤', baseFans: 10000, costPerHour: 300, conversionBonus: 1.3, riskLevel: 0.05, description: '性价比之选' },
    { id: 'top', name: '头部主播', icon: '⭐', baseFans: 100000, costPerHour: 2000, conversionBonus: 1.8, riskLevel: 0.1, description: '大主播，流量爆炸' },
    { id: 'ceo', name: '老板亲自播', icon: '👔', baseFans: 500, costPerHour: 0, conversionBonus: 1.5, riskLevel: 0, description: '自己上，免费但耗费精力' }
];

// ==================== 角色属性系统 ====================
const PLAYER_ATTRIBUTES = {
    operation: { name: '运营能力', icon: '📊', description: '影响流量获取和转化率' },
    selection: { name: '选品眼光', icon: '🔍', description: '影响爆款概率和进货价格' },
    negotiation: { name: '谈判能力', icon: '🤝', description: '影响供应商议价空间' },
    management: { name: '管理能力', icon: '📋', description: '影响员工效率和工资' },
    luck: { name: '运气值', icon: '🍀', description: '影响随机事件好坏概率' }
};

const TALENTS = [
    { id: 'rich_second_gen', name: '富二代', icon: '💎', description: '初始资金+50000', effect: { startMoney: 50000 } },
    { id: 'operation_guru', name: '运营大神', icon: '📈', description: '初始运营+3，流量+20%', effect: { operation: 3, trafficBonus: 0.2 } },
    { id: 'supply_expert', name: '供应链专家', icon: '🏭', description: '初始谈判+3，进货价-10%', effect: { negotiation: 3, supplyDiscount: 0.1 } },
    { id: 'lucky_dog', name: '天选之子', icon: '🍀', description: '初始运气+5，好事概率翻倍', effect: { luck: 5, goodEventBonus: 1.0 } },
    { id: 'normal', name: '普通人', icon: '🙂', description: '平平无奇的开局', effect: {} }
];

// ==================== 结局系统 ====================
// ⭐ 修复："小而美店主"等成就型结局（非破产）不应该强制结束游戏。
//    增加 forceGameOver 字段：只有破产 bankrupt 才强制 gameOver=true，其他成就型结局仅记录 ending 信息，游戏可无限继续玩。
//    同时 small_beauty 的天数阈值从 100 调至 999,999,999（用户要求跳过一天可以无限跳）
const ENDINGS = [
    { id: 'ecommerce_king', name: '电商首富', icon: '👑', forceGameOver: false, condition: { type: 'totalSales', value: 10000000 }, description: '你的电商帝国商业价值过亿！' },
    { id: 'brand_ceo', name: '品牌创始人', icon: '🏢', forceGameOver: false, condition: { type: 'ownBrand', value: true }, description: '成功打造了自己的品牌，成功上市！' },
    { id: 'small_beauty', name: '小而美店主', icon: '🏪', forceGameOver: false, condition: { type: 'days', value: 999999999 }, description: '店铺虽然不大，但经营得有声有色。' },
    { id: 'bankrupt', name: '破产跑路', icon: '💸', forceGameOver: true,  condition: { type: 'bankrupt', value: true }, description: '创业失败，欠下巨额债务...' },
    { id: 'trainer', name: '电商讲师', icon: '🎓', forceGameOver: false, condition: { type: 'achievements', value: 20 }, description: '经验丰富，转行做电商培训了。' }
];

// ==================== 平台等级系统 ====================
const PLATFORM_LEVELS = [
    { level: 'C', name: 'C级店铺', minReputation: 0, trafficWeight: 1.0, features: [] },
    { level: 'B', name: 'B级店铺', minReputation: 100, trafficWeight: 1.2, features: ['可报平台活动'] },
    { level: 'A', name: 'A级店铺', minReputation: 500, trafficWeight: 1.5, features: ['可报平台活动', '搜索加权'] },
    { level: 'S', name: 'S级店铺', minReputation: 2000, trafficWeight: 2.0, features: ['平台活动优先', '搜索加权', '专属小二'] }
];

// ==================== 组合商品 ====================
const COMBO_PRODUCTS = [
    { id: 'combo_skincare', name: '护肤三件套', products: [1, 2, 3], priceMultiplier: 0.85, icon: '✨' },
    { id: 'combo_digital', name: '数码套装', products: [5, 6], priceMultiplier: 0.9, icon: '📱' },
    { id: 'combo_home', name: '家居大礼包', products: [10, 11, 12], priceMultiplier: 0.8, icon: '🏠' },
    { id: 'combo_sports', name: '运动套装', products: [15, 16], priceMultiplier: 0.88, icon: '🏃' }
];

// ==================== 数据分析指标 ====================
const DATA_METRICS = [
    { id: 'conversion_rate', name: '转化率', formula: 'orders / views', unit: '%' },
    { id: 'avg_order_value', name: '客单价', formula: 'totalSales / orders', unit: '¥' },
    { id: 'return_rate', name: '退货率', formula: 'returns / orders', unit: '%' },
    { id: 'repeat_rate', name: '复购率', formula: 'repeatBuyers / totalBuyers', unit: '%' }
];

// ==================== 店铺名称验证配置 ====================
const SHOP_NAME_CONFIG = {
    minLength: 2,
    maxLength: 12,
    // 允许的字符：中文、英文、数字、常用符号
    allowedPattern: /^[\u4e00-\u9fa5a-zA-Z0-9\s·\-_&]+$/,
    // 敏感词列表
    sensitiveWords: [
        '赌博', '博彩', '色情', '淫秽', '毒品', '吸毒', '贩毒',
        '枪支', '弹药', '军火', '爆炸', '恐怖', '暴力',
        '诈骗', '传销', '走私', '洗钱',
        '政府', '国家', '党', '军队', '警察',
        '官方', '认证', '授权', '指定', '推荐',
        '最', '第一', '顶级', '极品', '绝对', '唯一',
        '违法', '犯罪', '黑社会',
        '腾讯', '阿里', '淘宝', '京东', '拼多多', '抖音', '快手',
        '微信', '支付宝', '银联', '银行',
        '医生', '医院', '药品', '医疗',
        '免费', '中奖', '抽奖', '红包',
        '兼职', '刷单', '刷信誉', '刷钻',
        '高仿', '精仿', '水货', '走私',
        '作弊', '外挂', '辅助', '脚本'
    ]
};

// 店铺名称验证函数
function validateShopName(name) {
    const config = SHOP_NAME_CONFIG;
    const result = { valid: false, message: '' };
    
    if (!name || !name.trim()) {
        result.message = '请输入店铺名称';
        return result;
    }
    
    const trimmed = name.trim();
    
    // 长度检查
    const charCount = getCharCount(trimmed);
    if (charCount < config.minLength) {
        result.message = `店铺名称至少需要${config.minLength}个字符`;
        return result;
    }
    if (charCount > config.maxLength) {
        result.message = `店铺名称不能超过${config.maxLength}个字符`;
        return result;
    }
    
    // 字符检查
    if (!config.allowedPattern.test(trimmed)) {
        result.message = '店铺名称包含不支持的特殊字符';
        return result;
    }
    
    // 敏感词检查
    for (const word of config.sensitiveWords) {
        if (trimmed.includes(word)) {
            result.message = '店铺名称包含敏感词，请修改后重试';
            return result;
        }
    }
    
    result.valid = true;
    result.message = '名称可用';
    return result;
}

// 计算字符数（中文算1个，英文数字也算1个）
function getCharCount(str) {
    let count = 0;
    for (let i = 0; i < str.length; i++) {
        count++;
    }
    return count;
}

// ==================== 仓库城市系统 ====================
const WAREHOUSE_CITIES = [
    {
        id: 'yiwu',
        name: '义乌',
        icon: '🏪',
        province: '浙江',
        description: '全球最大的小商品批发市场',
        tagline: '小商品之都',
        advantages: [
            '日用百货进货价 -10%',
            '家居建材进货价 -10%',
            '小商品类进货速度 +1天',
            '初始资金 +8000元'
        ],
        disadvantages: [
            '数码美妆进货略慢',
            '奢侈品无进货优惠'
        ],
        effects: {
            startMoney: 8000,
            startCapacity: 0,
            startReputation: 0,
            trafficBonus: 0,
            purchaseDiscount: {
                daily: 0.1,
                home: 0.1
            },
            purchaseSpeedBonus: {
                daily: 1,
                home: 1
            },
            purchaseSpeedPenalty: {
                digital: 1,
                beauty: 1
            },
            shippingDiscount: 0,
            rentCost: 0,
            salaryDiscount: -0.05,
            aGradeSalesBonus: 0
        },
        difficulty: '简单',
        difficultyColor: '#4caf50',
        unlocked: true
    },
    {
        id: 'shenzhen',
        name: '深圳',
        icon: '📱',
        province: '广东',
        description: '中国电子产品的核心产区',
        tagline: '电子之都',
        advantages: [
            '数码家电进货价 -15%',
            '奢侈品进货价 -5%（腕表数码）',
            '数码类进货速度 +1天',
            '初始仓库容量 +20000'
        ],
        disadvantages: [
            '房租成本较高'
        ],
        effects: {
            startMoney: 0,
            startCapacity: 20000,
            startReputation: 0,
            trafficBonus: 0,
            purchaseDiscount: {
                digital: 0.15,
                luxury: 0.05
            },
            purchaseSpeedBonus: {
                digital: 1
            },
            purchaseSpeedPenalty: {},
            shippingDiscount: 0,
            rentCost: 50,
            salaryDiscount: -0.2,
            aGradeSalesBonus: 0
        },
        difficulty: '中等',
        difficultyColor: '#ff9800',
        unlocked: true
    },
    {
        id: 'guangzhou',
        name: '广州',
        icon: '👗',
        province: '广东',
        description: '服装美妆产业带聚集地',
        tagline: '时尚之都',
        advantages: [
            '服饰箱包进货价 -10%',
            '美妆个护进货价 -10%',
            '奢侈品进货价 -12%（时尚高定）',
            '服装美妆进货速度 +1天',
            '初始资金 +5000元'
        ],
        disadvantages: [
            '食品生鲜进货略慢'
        ],
        effects: {
            startMoney: 5000,
            startCapacity: 0,
            startReputation: 0,
            trafficBonus: 0,
            purchaseDiscount: {
                clothing: 0.1,
                beauty: 0.1,
                luxury: 0.12
            },
            purchaseSpeedBonus: {
                clothing: 1,
                beauty: 1
            },
            purchaseSpeedPenalty: {
                food: 1
            },
            shippingDiscount: 0,
            rentCost: 0,
            salaryDiscount: -0.15,
            aGradeSalesBonus: 0
        },
        difficulty: '简单',
        difficultyColor: '#4caf50',
        unlocked: true
    },
    {
        id: 'hangzhou',
        name: '杭州',
        icon: '🌐',
        province: '浙江',
        description: '中国电子商务的发源地',
        tagline: '电商之都',
        advantages: [
            '全品类流量 +10%',
            '快递费用 -5%',
            '初始信誉 +50',
            '含奢侈品在内全品类进货价 +5%'
        ],
        disadvantages: [
            '进货成本 +5%（含奢侈品）'
        ],
        effects: {
            startMoney: 0,
            startCapacity: 0,
            startReputation: 50,
            trafficBonus: 0.1,
            purchaseDiscount: {
                all: -0.05
            },
            purchaseSpeedBonus: {},
            purchaseSpeedPenalty: {},
            shippingDiscount: 0.05,
            rentCost: 0,
            salaryDiscount: -0.15,
            aGradeSalesBonus: 0
        },
        difficulty: '中等',
        difficultyColor: '#ff9800',
        unlocked: true
    },
    {
        id: 'shanghai',
        name: '上海',
        icon: '🏙️',
        province: '上海',
        description: '国际化大都市，高端市场大',
        tagline: '国际金融中心',
        advantages: [
            '奢侈品进货价 -15%',
            'A品商品销量 +20%',
            '店铺升级速度 +10%',
            '初始资金 +25000元'
        ],
        disadvantages: [
            '运营成本 +10%（房租+工资）'
        ],
        effects: {
            startMoney: 25000,
            startCapacity: 0,
            startReputation: 0,
            trafficBonus: 0,
            purchaseDiscount: {
                luxury: 0.15
            },
            purchaseSpeedBonus: {},
            purchaseSpeedPenalty: {},
            shippingDiscount: 0,
            rentCost: 0,
            salaryDiscount: -0.25,
            aGradeSalesBonus: 0.2,
            levelUpSpeedBonus: 0.1
        },
        difficulty: '困难',
        difficultyColor: '#f44336',
        unlocked: true
    },
    {
        id: 'wuhan',
        name: '武汉',
        icon: '🚄',
        province: '湖北',
        description: '九省通衢，中部交通枢纽',
        tagline: '九省通衢',
        advantages: [
            '全品类进货速度 +0.5天',
            '发货物流速度 +0.5天',
            '初始仓库容量 +12000',
            '地理位置优越'
        ],
        disadvantages: [
            '没有特别突出的品类'
        ],
        effects: {
            startMoney: 0,
            startCapacity: 12000,
            startReputation: 0,
            trafficBonus: 0,
            purchaseDiscount: {},
            purchaseSpeedBonus: {
                all: 0.5
            },
            purchaseSpeedPenalty: {},
            shippingDiscount: 0,
            shippingSpeedBonus: 0.5,
            rentCost: 0,
            salaryDiscount: 0.05,
            aGradeSalesBonus: 0
        },
        difficulty: '中等',
        difficultyColor: '#ff9800',
        unlocked: true
    }
];

/** 原产地节点：地图展示，不可搬仓；对应商品从这里发往国内买家 */
const ORIGIN_CITIES = [
    {
        id: 'geneva', name: '日内瓦', icon: '🇨🇭', province: '瑞士', country: '瑞士',
        description: '瑞士钟表原产地，机械腕表从这里空运回国',
        tagline: '钟表之都', originOnly: true, distanceToChina: 8800,
        advantages: ['瑞士腕表原产地直发', '空运时效短于海运'],
        disadvantages: ['不可作为国内仓', '国际运费较高'],
        difficulty: '原产地', difficultyColor: '#5c6bc0', unlocked: true
    },
    {
        id: 'milan', name: '米兰', icon: '🇮🇹', province: '意大利', country: '意大利',
        description: '意大利皮具与时装原产地，手工皮鞋、意式家具从此发货',
        tagline: '时尚之都', originOnly: true, distanceToChina: 8500,
        advantages: ['意大利皮具原产地直发', '高定服饰产地'],
        disadvantages: ['不可作为国内仓', '国际运费较高'],
        difficulty: '原产地', difficultyColor: '#5c6bc0', unlocked: true
    },
    {
        id: 'paris', name: '巴黎', icon: '🇫🇷', province: '法国', country: '法国',
        description: '法国香水与高定原产地',
        tagline: '高定之都', originOnly: true, distanceToChina: 9000,
        advantages: ['香水高定原产地直发'],
        disadvantages: ['不可作为国内仓', '国际运费较高'],
        difficulty: '原产地', difficultyColor: '#5c6bc0', unlocked: true
    },
    {
        id: 'tokyo', name: '东京', icon: '🇯🇵', province: '日本', country: '日本',
        description: '日本清酒与精工货源原产地',
        tagline: '东洋货源', originOnly: true, distanceToChina: 1900,
        advantages: ['清酒等日本货原产地直发', '距中国较近'],
        disadvantages: ['不可作为国内仓'],
        difficulty: '原产地', difficultyColor: '#5c6bc0', unlocked: true
    }
];

// 根据城市ID获取城市信息
window.SUPPLY_OUTAGE_DNDPREF = {
    levels: [
        { value: 'all',    name: '全部通知', icon: '🔔', desc: '每次货源断供立即弹窗提醒' },
        { value: 'digest', name: '每日汇总', icon: '📋', desc: '每天0点汇总昨日断供为1条提醒' },
        { value: 'none',   name: '完全静默', icon: '🔕', desc: '不弹窗，仅在事件日志中可查' }
    ],
    defaultValue: 'all',
    settingKey: 'supplyOutageNotifyLevel',
    silentKey: 'supplyOutageSilentMode'
};

// 根据城市ID获取城市信息
function getCityById(cityId) {
    const wh = WAREHOUSE_CITIES.find(c => c.id === cityId);
    if (wh) return wh;
    if (typeof ORIGIN_CITIES !== 'undefined') {
        const origin = ORIGIN_CITIES.find(c => c.id === cityId);
        if (origin) return origin;
    }
    return WAREHOUSE_CITIES[0];
}

// 获取城市的采购折扣
function getCityPurchaseDiscount(cityId, category) {
    const city = getCityById(cityId);
    if (!city || !city.effects || !city.effects.purchaseDiscount) return 0;
    
    const discount = city.effects.purchaseDiscount;
    if (discount[category] !== undefined) return discount[category];
    if (discount.all !== undefined) return discount.all;
    return 0;
}

// 获取城市的采购速度加成（天数）
function getCityPurchaseSpeedBonus(cityId, category) {
    const city = getCityById(cityId);
    if (!city || !city.effects) return 0;
    
    let bonus = 0;
    if (city.effects.purchaseSpeedBonus) {
        const speedBonus = city.effects.purchaseSpeedBonus;
        if (speedBonus[category] !== undefined) bonus += speedBonus[category];
        if (speedBonus.all !== undefined) bonus += speedBonus.all;
    }
    if (city.effects.purchaseSpeedPenalty) {
        const speedPenalty = city.effects.purchaseSpeedPenalty;
        if (speedPenalty[category] !== undefined) bonus -= speedPenalty[category];
        if (speedPenalty.all !== undefined) bonus -= speedPenalty.all;
    }
    return bonus;
}

// 获取城市的工资折扣（正数为工资降低比例，负数为工资增加比例）
function getCitySalaryDiscount(cityId) {
    const city = getCityById(cityId);
    if (!city || !city.effects || city.effects.salaryDiscount === undefined) return 0;
    return city.effects.salaryDiscount;
}

// ==================== 买家地址系统 ====================
// 所有可选城市（包括仓库城市和更多买家城市）
const ALL_CITIES = [
    // 仓库城市（7个）
    { id: 'yiwu', name: '义乌', province: '浙江', region: 'east' },
    { id: 'shenzhen', name: '深圳', province: '广东', region: 'south' },
    { id: 'guangzhou', name: '广州', province: '广东', region: 'south' },
    { id: 'hangzhou', name: '杭州', province: '浙江', region: 'east' },
    { id: 'shanghai', name: '上海', province: '上海', region: 'east' },
    { id: 'wuhan', name: '武汉', province: '湖北', region: 'central' },
    // 更多买家城市（13个）
    { id: 'beijing', name: '北京', province: '北京', region: 'north' },
    { id: 'tianjin', name: '天津', province: '天津', region: 'north' },
    { id: 'nanjing', name: '南京', province: '江苏', region: 'east' },
    { id: 'suzhou', name: '苏州', province: '江苏', region: 'east' },
    { id: 'chongqing', name: '重庆', province: '重庆', region: 'west' },
    { id: 'xian', name: '西安', province: '陕西', region: 'northwest' },
    { id: 'qingdao', name: '青岛', province: '山东', region: 'north' },
    { id: 'jinan', name: '济南', province: '山东', region: 'north' },
    { id: 'changsha', name: '长沙', province: '湖南', region: 'central' },
    { id: 'zhengzhou', name: '郑州', province: '河南', region: 'central' },
    { id: 'hefei', name: '合肥', province: '安徽', region: 'east' },
    { id: 'fuzhou', name: '福州', province: '福建', region: 'south' },
    { id: 'nanning', name: '南宁', province: '广西', region: 'south' },
    { id: 'guiyang', name: '贵阳', province: '贵州', region: 'west' },
    { id: 'kunming', name: '昆明', province: '云南', region: 'west' },
    { id: 'shenyang', name: '沈阳', province: '辽宁', region: 'northeast' },
    { id: 'harbin', name: '哈尔滨', province: '黑龙江', region: 'northeast' },
    { id: 'lanzhou', name: '兰州', province: '甘肃', region: 'northwest' },
    { id: 'urumqi', name: '乌鲁木齐', province: '新疆', region: 'northwest' },
    { id: 'lhasa', name: '拉萨', province: '西藏', region: 'west' },
    { id: 'geneva', name: '日内瓦', province: '瑞士', region: 'europe' },
    { id: 'milan', name: '米兰', province: '意大利', region: 'europe' },
    { id: 'paris', name: '巴黎', province: '法国', region: 'europe' },
    { id: 'tokyo', name: '东京', province: '日本', region: 'asia_int' }
];

// 城市间距离矩阵（单位：公里）
// 基于实际地理距离的近似值
const CITY_DISTANCES = {
    yiwu: { yiwu: 0, shenzhen: 1100, guangzhou: 1050, hangzhou: 150, shanghai: 280, wuhan: 700,
            beijing: 1300, tianjin: 1250, nanjing: 400, suzhou: 250, chongqing: 1500, xian: 1350, qingdao: 750,
            jinan: 850, changsha: 800, zhengzhou: 850, hefei: 350, fuzhou: 500, nanning: 1400,
            guiyang: 1300, kunming: 1800, shenyang: 1900, harbin: 2400, lanzhou: 1900, urumqi: 3800, lhasa: 2800 },
    shenzhen: { yiwu: 1100, shenzhen: 0, guangzhou: 140, hangzhou: 1200, shanghai: 1400, wuhan: 1000,
                beijing: 2000, tianjin: 1950, nanjing: 1350, suzhou: 1300, chongqing: 1300, xian: 1650, qingdao: 1700,
                jinan: 1800, changsha: 700, zhengzhou: 1400, hefei: 1150, fuzhou: 600, nanning: 650,
                guiyang: 1000, kunming: 1450, shenyang: 2600, harbin: 3100, lanzhou: 2300, urumqi: 4200, lhasa: 2500 },
    guangzhou: { yiwu: 1050, shenzhen: 140, guangzhou: 0, hangzhou: 1150, shanghai: 1350, wuhan: 950,
                 beijing: 1900, tianjin: 1850, nanjing: 1300, suzhou: 1250, chongqing: 1200, xian: 1550, qingdao: 1600,
                 jinan: 1700, changsha: 650, zhengzhou: 1300, hefei: 1100, fuzhou: 700, nanning: 550,
                 guiyang: 900, kunming: 1350, shenyang: 2500, harbin: 3000, lanzhou: 2200, urumqi: 4100, lhasa: 2400 },
    hangzhou: { yiwu: 150, shenzhen: 1200, guangzhou: 1150, hangzhou: 0, shanghai: 180, wuhan: 600,
                beijing: 1100, tianjin: 1050, nanjing: 250, suzhou: 120, chongqing: 1450, xian: 1200, qingdao: 650,
                jinan: 750, changsha: 750, zhengzhou: 750, hefei: 300, fuzhou: 550, nanning: 1500,
                guiyang: 1400, kunming: 1900, shenyang: 1750, harbin: 2250, lanzhou: 1750, urumqi: 3650, lhasa: 2900 },
    shanghai: { yiwu: 280, shenzhen: 1400, guangzhou: 1350, hangzhou: 180, shanghai: 0, wuhan: 750,
                beijing: 1200, tianjin: 1100, nanjing: 300, suzhou: 100, chongqing: 1600, xian: 1300, qingdao: 700,
                jinan: 800, changsha: 900, zhengzhou: 900, hefei: 450, fuzhou: 700, nanning: 1700,
                guiyang: 1550, kunming: 2050, shenyang: 1800, harbin: 2300, lanzhou: 1850, urumqi: 3750, lhasa: 3000 },
    wuhan: { yiwu: 700, shenzhen: 1000, guangzhou: 950, hangzhou: 600, shanghai: 750, wuhan: 0,
             beijing: 1050, tianjin: 1000, nanjing: 500, suzhou: 600, chongqing: 800, xian: 700, qingdao: 800,
             jinan: 700, changsha: 300, zhengzhou: 500, hefei: 350, fuzhou: 750, nanning: 1100,
             guiyang: 800, kunming: 1300, shenyang: 1650, harbin: 2150, lanzhou: 1200, urumqi: 3100, lhasa: 2300 }
};

// 获取两个城市之间的距离
function getCityDistance(cityId1, cityId2) {
    if (cityId1 === cityId2) return 0;
    const originA = (typeof ORIGIN_CITIES !== 'undefined') ? ORIGIN_CITIES.find(c => c.id === cityId1) : null;
    const originB = (typeof ORIGIN_CITIES !== 'undefined') ? ORIGIN_CITIES.find(c => c.id === cityId2) : null;
    if (originA && originB) return 800;
    if (originA && originA.distanceToChina) return originA.distanceToChina;
    if (originB && originB.distanceToChina) return originB.distanceToChina;
    // 尝试从矩阵中获取
    if (CITY_DISTANCES[cityId1] && CITY_DISTANCES[cityId1][cityId2] !== undefined) {
        return CITY_DISTANCES[cityId1][cityId2];
    }
    if (CITY_DISTANCES[cityId2] && CITY_DISTANCES[cityId2][cityId1] !== undefined) {
        return CITY_DISTANCES[cityId2][cityId1];
    }
    
    // 如果不在矩阵中，根据区域估算距离
    const city1 = ALL_CITIES.find(c => c.id === cityId1);
    const city2 = ALL_CITIES.find(c => c.id === cityId2);
    if (!city1 || !city2) return 1000; // 默认距离
    
    // 同区域 = 500km，相邻区域 = 800km，跨区域 = 1200km，远距离 = 2000km
    const regionDistances = {
        'east-east': 300, 'east-south': 800, 'east-central': 500, 'east-north': 800,
        'east-west': 1500, 'east-northwest': 1500, 'east-northeast': 1500,
        'south-south': 400, 'south-central': 600, 'south-north': 1500,
        'south-west': 1000, 'south-northwest': 1800, 'south-northeast': 2200,
        'central-central': 300, 'central-north': 700, 'central-west': 1000,
        'central-northwest': 1000, 'central-northeast': 1500,
        'north-north': 400, 'north-west': 1200, 'north-northwest': 800, 'north-northeast': 800,
        'west-west': 500, 'west-northwest': 1000, 'west-northeast': 2500,
        'northwest-northwest': 500, 'northwest-northeast': 2000,
        'northeast-northeast': 400
    };
    
    const key1 = `${city1.region}-${city2.region}`;
    const key2 = `${city2.region}-${city1.region}`;
    const baseDist = regionDistances[key1] || regionDistances[key2] || 1000;
    
    // 加入一些随机波动
    return baseDist + randomInt(-100, 100);
}

// 随机获取买家城市（模拟买家分布，东部沿海城市权重更高）
function getRandomBuyerCity() {
    const cityWeights = [
        { id: 'shanghai', weight: 12 },
        { id: 'beijing', weight: 10 },
        { id: 'guangzhou', weight: 9 },
        { id: 'shenzhen', weight: 9 },
        { id: 'hangzhou', weight: 8 },
        { id: 'nanjing', weight: 7 },
        { id: 'suzhou', weight: 6 },
        { id: 'wuhan', weight: 6 },
        { id: 'chongqing', weight: 5 },
        { id: 'tianjin', weight: 5 },
        { id: 'qingdao', weight: 4 },
        { id: 'jinan', weight: 4 },
        { id: 'changsha', weight: 4 },
        { id: 'zhengzhou', weight: 4 },
        { id: 'xian', weight: 4 },
        { id: 'hefei', weight: 3 },
        { id: 'fuzhou', weight: 3 },
        { id: 'nanning', weight: 3 },
        { id: 'guiyang', weight: 2 },
        { id: 'kunming', weight: 2 },
        { id: 'shenyang', weight: 3 },
        { id: 'harbin', weight: 2 },
        { id: 'lanzhou', weight: 2 },
        { id: 'urumqi', weight: 1 },
        { id: 'lhasa', weight: 1 },
        { id: 'yiwu', weight: 2 }
    ];
    
    const totalWeight = cityWeights.reduce((sum, c) => sum + c.weight, 0);
    let random = Math.random() * totalWeight;
    
    for (const city of cityWeights) {
        random -= city.weight;
        if (random <= 0) {
            const cityInfo = ALL_CITIES.find(c => c.id === city.id);
            return cityInfo || ALL_CITIES[0];
        }
    }
    
    return ALL_CITIES.find(c => c.id === 'shanghai');
}

// ==================== 快递费用计算（基于距离和重量） ====================
const SHIPPING_PRICING = {
    economy: {
        name: '经济型快递',
        // 首重价格（1kg以内）
        firstWeightPrice: 3.5,
        // 续重价格（每kg）
        additionalWeightPrice: 1,
        // 基础距离（km），在此距离内不加价
        baseDistance: 500,
        // 超出基础距离后，每100km加价比例
        pricePer100km: 0.03,
        // 最高加价倍数
        maxDistanceMultiplier: 2.0,
        // 预计送达天数基数（发货→完成固定 1～3 天）
        baseDeliveryDays: 2,
        // 每500km增加的天数
        daysPer500km: 0.5,
        // 最大天数
        maxDeliveryDays: 3,
        lossRate: 0.003,
        companies: ['中通快递', '圆通速递', '韵达快递', '申通快递']
    },
    standard: {
        name: '标准型快递',
        firstWeightPrice: 7,
        additionalWeightPrice: 2,
        baseDistance: 500,
        pricePer100km: 0.025,
        maxDistanceMultiplier: 1.8,
        baseDeliveryDays: 1,
        daysPer500km: 0.5,
        maxDeliveryDays: 3,
        lossRate: 0,
        companies: ['顺丰速运', '京东物流']
    }
};

// 计算快递费用
function calculateShippingFee(expressType, weightKg, fromCityId, toCityId) {
    const pricing = SHIPPING_PRICING[expressType];
    if (!pricing) return 0;
    
    const distance = getCityDistance(fromCityId, toCityId);
    
    // 计算重量费用（首重+续重）
    let weightCost = pricing.firstWeightPrice;
    if (weightKg > 1) {
        const additionalWeight = Math.ceil(weightKg - 1);
        weightCost += additionalWeight * pricing.additionalWeightPrice;
    }
    
    // 计算距离系数
    let distanceMultiplier = 1.0;
    if (distance > pricing.baseDistance) {
        const extraDistance = distance - pricing.baseDistance;
        distanceMultiplier = 1.0 + (extraDistance / 100) * pricing.pricePer100km;
        distanceMultiplier = Math.min(distanceMultiplier, pricing.maxDistanceMultiplier);
    }
    
    // 总费用 = 重量费用 × 距离系数
    const totalFee = weightCost * distanceMultiplier;
    
    return parseFloat(totalFee.toFixed(2));
}

// 计算预计送达天数（钳制在 1～3 天）
function calculateDeliveryDays(expressType, fromCityId, toCityId) {
    const minDays = Math.ceil(((typeof MIN_SHIP_TO_COMPLETE_HOURS !== 'undefined') ? MIN_SHIP_TO_COMPLETE_HOURS : 24) / 24);
    const maxDays = Math.ceil(((typeof MAX_SHIP_TO_COMPLETE_HOURS !== 'undefined') ? MAX_SHIP_TO_COMPLETE_HOURS : 72) / 24);
    const pricing = SHIPPING_PRICING[expressType];
    if (!pricing) return Math.min(maxDays, Math.max(minDays, 3));
    
    const distance = getCityDistance(fromCityId, toCityId);
    
    let days = pricing.baseDeliveryDays;
    if (distance > pricing.baseDistance) {
        const extraDistance = distance - pricing.baseDistance;
        days += (extraDistance / 500) * pricing.daysPer500km;
    }
    
    days = Math.min(days, pricing.maxDeliveryDays);
    return Math.max(minDays, Math.min(maxDays, Math.ceil(days)));
}

// 获取城市信息
function getCityInfo(cityId) {
    return ALL_CITIES.find(c => c.id === cityId) || ALL_CITIES[0];
}

// 根据商品ID获取商品信息
function getProductById(productId) {
    return PRODUCTS.find(p => p.id === productId) || null;
}

// 浏览器环境：把关键常量/函数挂到全局 window，供 HTML 行内 onclick 和其他脚本使用
if (typeof window !== 'undefined') {
    Object.assign(window, {
        APP_VERSION,
        APP_VERSION_NAME,
        // 常用材料/数据配置
        PRICE_RULES,
        getMaxAbsolutePrice,
        getProductOriginCity,
        resolveShipFromCity,
        isOriginCity,
        ORIGIN_CITIES,
        OWN_BRAND_FACTORY,
        OWN_BRAND_SKUS,
        getFactoryDailyCapacity,
        factoryHasAdvancedLine,
        getFactoryCostTier,
        getLuxuryDisplayGrade,
        getPurchaseVariancePct,
        ROLE_COMMISSION,
        SHOP_CONFIG,
        OPS_RISK_CONFIG,
        CITY_MAP_LAYOUT,
        SHOP_ENTITY_TYPES,
        BRAND_BADGES,
        getBrandBadgeById,
        getShopEntityTypeById,
        AD_AGENCY,
        MARKETING_TYPES,
        MARKETING_EFFECT_CAP,
        TRAFFIC_GATING,
        REDEEM_CODES,
        WAREHOUSE_LEVELS,
        PACKAGING_MATERIALS,
        PACKAGING_MATERIAL_ALIASES,
        PROMOTION_TYPES,
        PROMOTION_STATUS,
        DEFAULT_MEMBER_RECHARGE,
        normalizePromotionTypeId,
        PRODUCTS,
        SHOP_LEVELS,
        CATEGORIES,
        SUPPLIERS,
        ALL_CITIES,
        WAREHOUSE_CITIES,
        SHIPPING_PRICING,
        COMBO_PRODUCTS,
        DATA_METRICS,
        SHOP_NAME_CONFIG,
        // 常用工具函数
        calculateDeliveryDays,
        getCityInfo,
        getCityById,
        getCityPurchaseDiscount,
        getCityPurchaseSpeedBonus,
        getProductById,
        getCityDistance: typeof getCityDistance !== 'undefined' ? getCityDistance : undefined,
        MIN_SHIP_TO_COMPLETE_HOURS,
        MAX_SHIP_TO_COMPLETE_HOURS,
        COMPLETED_ORDER_RETENTION_DAYS,
        EXPRESS_SUCCESS_ORDER_DISCOUNTS,
        EXPRESS_GLOBAL_MIN_DISCOUNT,
        EXPRESS_BRAND_RANK,
        getExpressBrandRank,
        getExpressBrandName,
        resolveExpressVolumeDiscount,
    });
}

// ==================== 经营九宫格扩展配置（2.3版本新增模块） ====================
window.MANAGEMENT_EXTRA_ITEMS = [
    {
        id: 'tax_center',
        name: '纳税中心',
        icon: '🧾',
        color: '#e65100',
        sortOrder: 35,
        enabled: true,
        badge: null,
        desc: '月度报税·成本抵扣·纳税报表',
        onClickCb: 'if(typeof taxUI !== "undefined"){window.taxUI.show();}'
    },
    {
        id: 'legal_center',
        name: '法务维权',
        icon: '⚖️',
        color: '#7b1fa2',
        sortOrder: 38,
        enabled: true,
        badge: null,
        desc: '恶意退款维权·案件仲裁·法律咨询',
        onClickCb: 'if(typeof ui !== "undefined"){ui.showLegalCenter();}'
    },
    {
        id: 'after_sales',
        name: '售后客服',
        icon: '📞',
        color: '#0277bd',
        sortOrder: 30,
        enabled: false,
        badge: null,
        desc: '退货退款·仅退款·质检流程',
        onClickCb: 'if(typeof serviceRenderer !== "undefined"){ui.navigateTo("service");}'
    }
];
