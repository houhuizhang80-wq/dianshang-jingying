/**
 * 仓储管理模块 - 数据配置
 * 全新仓储系统：入库管理、出库管理、库存盘点、库位管理、批次管理、库存预警、报表统计
 */
const WarehouseData = {
    // 仓库等级配置（一级10万，后续按×2、×4交替递增，最高20级；与 gameData.WAREHOUSE_LEVELS 对齐）
    levels: (function() {
        // 优先复用全局 WAREHOUSE_LEVELS，避免两套表容量不一致导致「升级了仍显示仓满」
        try {
            if (typeof WAREHOUSE_LEVELS !== 'undefined' && Array.isArray(WAREHOUSE_LEVELS) && WAREHOUSE_LEVELS.length) {
                return WAREHOUSE_LEVELS.map(l => ({ ...l }));
            }
        } catch (_) {}
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
        let capacity = 100000;
        for (let i = 0; i < 20; i++) {
            const level = i + 1;
            // 升级费用随等级递增
            let upgradeCost = 0;
            if (i === 0) upgradeCost = 20000;            // Lv1→2: 2万
            else if (i === 1) upgradeCost = 100000;      // Lv2→3: 10万
            else if (i === 2) upgradeCost = 500000;      // Lv3→4: 50万
            else if (i === 3) upgradeCost = 2000000;     // Lv4→5: 200万
            else if (i >= 4 && i < 19) {
                upgradeCost = Math.floor(2000000 * Math.pow(2, i - 3));
            }
            // 仓储费 = 每月固定月租 + 在仓商品每日占用费（与 WAREHOUSE_LEVELS 保持一致）
            const monthlyRent = Math.round(20000 * Math.pow(1.5, i) / 1000) * 1000;
            const unitStorageCost = 0.2;   // 元/件/日
            // 区域数量
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
            
            // 下一级容量：×2、×4交替
            if (i < 19) {
                capacity = capacity * (i % 2 === 1 ? 4 : 2);
            }
        }
        return result;
    })(),

    // 库位类型配置
    locationTypes: [
        { id: 'receiving', name: '收货区', icon: '📥', color: '#4caf50', description: '商品入库暂存区' },
        { id: 'storage', name: '存储区', icon: '📦', color: '#2196f3', description: '常规商品存储' },
        { id: 'picking', name: '拣货区', icon: '🛒', color: '#ff9800', description: '订单拣货备货' },
        { id: 'packing', name: '打包区', icon: '📮', color: '#9c27b0', description: '商品打包发货' },
        { id: 'shipping', name: '发货区', icon: '🚚', color: '#f44336', description: '待发货暂存' },
        { id: 'returns', name: '退货区', icon: '↩️', color: '#795548', description: '退货商品处理' },
        { id: 'defective', name: '次品区', icon: '⚠️', color: '#ff5722', description: '残次品隔离' },
        { id: 'cold', name: '冷藏区', icon: '❄️', color: '#00bcd4', description: '生鲜冷链存储', unlockLevel: 3 },
        { id: 'valuables', name: '贵重品区', icon: '💎', color: '#ffd700', description: '高价值商品专储', unlockLevel: 4 },
        { id: 'bonded', name: '保税区', icon: '🏛️', color: '#607d8b', description: '跨境保税商品存储', unlockLevel: 6 },
        { id: 'hazardous', name: '危险品区', icon: '☢️', color: '#795548', description: '特殊危险品存储', unlockLevel: 7 },
        { id: 'automated', name: '自动化立库区', icon: '🤖', color: '#3f51b5', description: '自动化立体仓库', unlockLevel: 9 },
        { id: 'sorting', name: '分拣区', icon: '🔀', color: '#ff5722', description: '自动分拣作业区', unlockLevel: 8 },
        { id: 'quality', name: '质检区', icon: '🔬', color: '#009688', description: '商品质量检验区', unlockLevel: 5 },
        { id: 'crossdock', name: '越库区', icon: '⚡', color: '#ffc107', description: '快速越库转运', unlockLevel: 10 }
    ],

    // 入库类型
    inboundTypes: [
        { id: 'purchase', name: '采购入库', icon: '🛍️', color: '#4caf50' },
        { id: 'return', name: '退货入库', icon: '↩️', color: '#ff9800' },
        { id: 'transfer', name: '调拨入库', icon: '🔄', color: '#2196f3' },
        { id: 'adjustment', name: '盘盈入库', icon: '📈', color: '#9c27b0' },
        { id: 'other', name: '其他入库', icon: '📥', color: '#607d8b' }
    ],

    // 出库类型
    outboundTypes: [
        { id: 'sale', name: '销售出库', icon: '💰', color: '#f44336' },
        { id: 'transfer', name: '调拨出库', icon: '🔄', color: '#2196f3' },
        { id: 'scrap', name: '报废出库', icon: '🗑️', color: '#795548' },
        { id: 'adjustment', name: '盘亏出库', icon: '📉', color: '#ff5722' },
        { id: 'gift', name: '赠品出库', icon: '🎁', color: '#e91e63' },
        { id: 'other', name: '其他出库', icon: '📤', color: '#607d8b' }
    ],

    // 批次状态
    batchStatus: [
        { id: 'normal', name: '正常', color: '#4caf50' },
        { id: 'locked', name: '锁定', color: '#ff9800' },
        { id: 'expired', name: '过期', color: '#f44336' },
        { id: 'quarantine', name: '待检', color: '#9c27b0' }
    ],

    // 库存预警类型
    alertTypes: [
        { id: 'low_stock', name: '低库存', icon: '⚠️', color: '#ff9800', level: 'warning' },
        { id: 'over_stock', name: '超储', icon: '📊', color: '#2196f3', level: 'info' },
        { id: 'expiring', name: '临期', icon: '⏰', color: '#ff5722', level: 'warning' },
        { id: 'expired', name: '过期', icon: '🚫', color: '#f44336', level: 'danger' },
        { id: 'zero_stock', name: '缺货', icon: '❌', color: '#f44336', level: 'danger' },
        { id: 'slow_moving', name: '滞销', icon: '🐢', color: '#9c27b0', level: 'info' }
    ],

    // 盘点状态
    stocktakeStatus: [
        { id: 'draft', name: '草稿', color: '#9e9e9e' },
        { id: 'in_progress', name: '盘点中', color: '#ff9800' },
        { id: 'completed', name: '已完成', color: '#4caf50' },
        { id: 'cancelled', name: '已取消', color: '#f44336' }
    ],

    // 默认预警阈值配置
    defaultThresholds: {
        lowStockRatio: 0.2,      // 低库存比例（低于安全库存）
        overStockRatio: 2.0,     // 超储比例（高于最高库存）
        expiringDays: 7,         // 临期预警天数
        slowMovingDays: 30       // 滞销判定天数
    },

    // ABC分类配置
    abcClassification: {
        A: { name: 'A类(重要)', color: '#f44336', valuePercent: 0.7, desc: '贡献70%货值，重点管理' },
        B: { name: 'B类(一般)', color: '#ff9800', valuePercent: 0.2, desc: '贡献20%货值，常规管理' },
        C: { name: 'C类(滞销)', color: '#4caf50', valuePercent: 0.1, desc: '贡献10%货值，简单管理' }
    },

    // ==================== 仓库安全与损耗（深化） ====================
    // 每日按「库存货值 × 损耗率」计入损耗成本，升级安防可降低损耗率直至零损耗
    securityLevels: [
        { level: 0, name: '无安防',   icon: '🚫', cost: 0,       lossRate: 0.002, desc: '每日货值损耗 0.2%' },
        { level: 1, name: '基础安防', icon: '🔒', cost: 10000,  lossRate: 0.001, desc: '每日货值损耗 0.1%' },
        { level: 2, name: '标准安防', icon: '📹', cost: 50000,  lossRate: 0.0005, desc: '每日货值损耗 0.05%' },
        { level: 3, name: '智能安防', icon: '🤖', cost: 200000, lossRate: 0.0002, desc: '每日货值损耗 0.02%' },
        { level: 4, name: '顶级安防', icon: '🛡️', cost: 1000000, lossRate: 0,     desc: '零损耗' }
    ],

    // 包装材料配置（保留并增强）
    // 注：实际运行时 warehouseState.getPackagingMaterials() 会优先使用全局 PACKAGING_MATERIALS（30+种，含价格阶梯），
    //     这里 WarehouseData.packagingMaterials 只作为 Node 测试环境的兜底，覆盖 20 种常用材料
    packagingMaterials: {
        carton: {
            id: 'carton', category: 'carton_box', name: '标准纸箱', icon: '📦',
            unit: '个', cost: 0.8, lowStockThreshold: 30,
            consumption: { base: 1, perItem: 0 }
        },
        carton_small: {
            id: 'carton_small', category: 'carton_box', name: '小号纸箱', icon: '📥',
            unit: '个', cost: 0.4, lowStockThreshold: 50,
            consumption: { base: 0, perItem: 0 }
        },
        carton_large: {
            id: 'carton_large', category: 'carton_box', name: '大号纸箱', icon: '📤',
            unit: '个', cost: 2.2, lowStockThreshold: 15,
            consumption: { base: 0, perItem: 0 }
        },
        airplane_box: {
            id: 'airplane_box', category: 'carton_box', name: '飞机盒', icon: '✈️',
            unit: '个', cost: 1.3, lowStockThreshold: 20,
            consumption: { base: 0, perItem: 0 }
        },
        long_box: {
            id: 'long_box', category: 'carton_box', name: '长条雨伞盒', icon: '📏',
            unit: '个', cost: 1.1, lowStockThreshold: 15,
            consumption: { base: 0, perItem: 0 }
        },
        flat_box: {
            id: 'flat_box', category: 'carton_box', name: '扁平画册盒', icon: '📐',
            unit: '个', cost: 0.8, lowStockThreshold: 15,
            consumption: { base: 0, perItem: 0 }
        },
        gift_box: {
            id: 'gift_box', category: 'gift_class', name: '高端翻盖礼品盒', icon: '🎁',
            unit: '个', cost: 5.5, lowStockThreshold: 10,
            consumption: { base: 0, perItem: 0 }
        },
        bubbleWrap: {
            id: 'bubbleWrap', category: 'cushioning', name: '气泡膜', icon: '🫧',
            unit: '米', cost: 0.45, lowStockThreshold: 50,
            consumption: { base: 0.5, perItem: 0.3 }
        },
        gourd_film: {
            id: 'gourd_film', category: 'cushioning', name: '葫芦膜缓冲气垫', icon: '🫛',
            unit: '米', cost: 0.55, lowStockThreshold: 50,
            consumption: { base: 0, perItem: 0 }
        },
        air_column: {
            id: 'air_column', category: 'cushioning', name: '气柱袋卷材', icon: '💨',
            unit: '米', cost: 1.7, lowStockThreshold: 15,
            consumption: { base: 0, perItem: 0 }
        },
        epe_foam: {
            id: 'epe_foam', category: 'cushioning', name: 'EPE珍珠棉板材', icon: '🧱',
            unit: '张', cost: 3.2, lowStockThreshold: 8,
            consumption: { base: 0, perItem: 0 }
        },
        kraft_cushion: {
            id: 'kraft_cushion', category: 'eco', name: '牛皮纸缓冲纸垫', icon: '🌿',
            unit: '米', cost: 0.7, lowStockThreshold: 20,
            consumption: { base: 0, perItem: 0 }
        },
        tape: {
            id: 'tape', category: 'sealing', name: '封箱胶带', icon: '🧻',
            unit: '卷', cost: 2.1, lowStockThreshold: 10,
            consumption: { base: 0.05, perItem: 0 }
        },
        warn_tape: {
            id: 'warn_tape', category: 'sealing', name: '警示语胶带', icon: '🚨',
            unit: '卷', cost: 2.4, lowStockThreshold: 3,
            consumption: { base: 0, perItem: 0 }
        },
        thermal_label: {
            id: 'thermal_label', category: 'label', name: '热敏纸面单', icon: '🏷️',
            unit: '张', cost: 0.1, lowStockThreshold: 200,
            consumption: { base: 1, perItem: 0 }
        },
        ice_pack: {
            id: 'ice_pack', category: 'protection', name: '生物冰袋', icon: '🧊',
            unit: '个', cost: 0.6, lowStockThreshold: 50,
            consumption: { base: 0, perItem: 0 }
        },
        fragile_sticker: {
            id: 'fragile_sticker', category: 'label', name: '易碎品贴纸', icon: '💔',
            unit: '张', cost: 0.05, lowStockThreshold: 200,
            consumption: { base: 0, perItem: 0 }
        },
        thank_you_card: {
            id: 'thank_you_card', category: 'gift', name: '感谢卡售后卡', icon: '💌',
            unit: '张', cost: 0.35, lowStockThreshold: 100,
            consumption: { base: 0, perItem: 0 }
        },
        desiccant: {
            id: 'desiccant', category: 'protection', name: '食品干燥剂', icon: '🏺',
            unit: '包', cost: 0.08, lowStockThreshold: 300,
            consumption: { base: 0, perItem: 0 }
        },
        poly_bag: {
            id: 'poly_bag', category: 'outer', name: '快递防水袋', icon: '🛍️',
            unit: '个', cost: 0.18, lowStockThreshold: 200,
            consumption: { base: 0, perItem: 0 }
        }
    },

    // 报表统计维度
    reportDimensions: [
        { id: 'daily', name: '日报', days: 1 },
        { id: 'weekly', name: '周报', days: 7 },
        { id: 'monthly', name: '月报', days: 30 }
    ],

    // 当前等级对应的总仓容（与 WAREHOUSE_LEVELS / levels 一致）
    getLevelCapacity(level) {
        const lv = Math.max(1, parseInt(level, 10) || 1);
        const info = (this.levels || []).find(l => l.level === lv) || (this.levels || [])[0];
        return (info && info.capacity) || 100000;
    },

    // ==================== 仓储费（月租 + 在仓占用费） ====================
    // 兜底单件占用费（元/件/日）：等级表未带 unitStorageCost 时使用
    storageUnitCost: 0.2,
    // 一个月 = 30 个游戏日（与发薪/宿舍月租同一套月历）
    MONTH_DAYS: 30,

    /**
     * 取某等级的租金配置
     * @returns {{level:number, monthlyRent:number, unitStorageCost:number}}
     */
    getLevelRentInfo(level) {
        const lv = Math.max(1, parseInt(level, 10) || 1);
        const info = (this.levels || []).find(l => l.level === lv) || (this.levels || [])[0] || {};
        const monthlyRent = Math.max(0, Number(info.monthlyRent) || 0);
        const rawRate = Number(info.unitStorageCost);
        const rate = isFinite(rawRate) && rawRate >= 0 ? rawRate : this.storageUnitCost;
        return { level: Number(info.level) || lv, monthlyRent: monthlyRent, unitStorageCost: rate };
    },

    /**
     * 当日「在仓商品占用费」：只在仓件数 × 单件日费，空仓为 0（月租另计）
     * @param {number} level 仓库等级
     * @param {number} usedQty 实际在仓件数（getUsedCapacity）
     * @returns {{level:number, rate:number, used:number, occupied:number, total:number}}
     */
    calcOccupancyFee(level, usedQty) {
        const info = this.getLevelRentInfo(level);
        const used = Math.max(0, Number(usedQty) || 0);
        const occupied = Math.round(used * info.unitStorageCost * 100) / 100;
        return {
            level: info.level,
            rate: info.unitStorageCost,
            used: used,
            occupied: occupied,
            total: occupied
        };
    },

    /** 距今第几个「租期」（30天制）：第31天=1期（与发薪同日结算），第61天=2期 */
    getRentPeriod(day) {
        const d = Math.max(1, parseInt(day, 10) || 1);
        return Math.floor((d - 1) / this.MONTH_DAYS);
    },

    /**
     * 初始库位模板（按等级）
     * 库位容量按权重瓜分该等级总仓容，保证「等级多少就有对应仓库空间」
     */
    getInitialLocations(level) {
        const lv = Math.max(1, parseInt(level, 10) || 1);
        // 相对权重（最终按总仓容缩放，不再用 50+level*20 这种与总仓容脱节的公式）
        const specs = [
            { id: 'loc_recv_1', type: 'receiving', code: 'RCV-01', name: '收货区1号位', weight: 1, minLevel: 1 },
            { id: 'loc_store_1', type: 'storage', code: 'STO-A01', name: '存储区A1', weight: 2, minLevel: 1 },
            { id: 'loc_store_2', type: 'storage', code: 'STO-A02', name: '存储区A2', weight: 2, minLevel: 1 },
            { id: 'loc_pack_1', type: 'packing', code: 'PCK-01', name: '打包区1号位', weight: 1, minLevel: 1 },
            { id: 'loc_ship_1', type: 'shipping', code: 'SHP-01', name: '发货区1号位', weight: 1, minLevel: 1 },
            { id: 'loc_store_3', type: 'storage', code: 'STO-B01', name: '存储区B1', weight: 3, minLevel: 2 },
            { id: 'loc_store_4', type: 'storage', code: 'STO-B02', name: '存储区B2', weight: 3, minLevel: 2 },
            { id: 'loc_pick_1', type: 'picking', code: 'PCK-01', name: '拣货区1号位', weight: 1, minLevel: 2 },
            { id: 'loc_cold_1', type: 'cold', code: 'CLD-01', name: '冷藏区1号位', weight: 1, minLevel: 3 },
            { id: 'loc_ret_1', type: 'returns', code: 'RET-01', name: '退货区1号位', weight: 1, minLevel: 3 },
            { id: 'loc_def_1', type: 'defective', code: 'DEF-01', name: '次品区1号位', weight: 0.6, minLevel: 3 },
            { id: 'loc_val_1', type: 'valuables', code: 'VAL-01', name: '贵重品区1号位', weight: 0.5, minLevel: 4 },
            { id: 'loc_qual_1', type: 'quality', code: 'QLT-01', name: '质检区1号位', weight: 1, minLevel: 5 },
            { id: 'loc_bond_1', type: 'bonded', code: 'BND-01', name: '保税区1号位', weight: 2, minLevel: 6 },
            { id: 'loc_haz_1', type: 'hazardous', code: 'HAZ-01', name: '危险品区1号位', weight: 0.8, minLevel: 7 },
            { id: 'loc_sort_1', type: 'sorting', code: 'SRT-01', name: '分拣区1号位', weight: 2, minLevel: 8 },
            { id: 'loc_auto_1', type: 'automated', code: 'AUT-01', name: '自动化立库1号位', weight: 5, minLevel: 9 },
            { id: 'loc_cross_1', type: 'crossdock', code: 'XDK-01', name: '越库区1号位', weight: 3, minLevel: 10 }
        ];
        // 高等级追加更多存储区
        if (lv >= 5) {
            const zones = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
            for (let z = 0; z < Math.min(zones.length, Math.floor((lv - 3) / 2)); z++) {
                for (let n = 1; n <= Math.min(3, Math.ceil((lv - 3) / 3)); n++) {
                    const id = `loc_store_${z + 5}_${n}`;
                    if (!specs.find(l => l.id === id)) {
                        specs.push({
                            id,
                            type: 'storage',
                            code: `STO-${zones[z]}${String(n).padStart(2, '0')}`,
                            name: `存储区${zones[z]}${n}`,
                            weight: 2 + z,
                            minLevel: 5
                        });
                    }
                }
            }
        }

        const active = specs.filter(s => lv >= (s.minLevel || 1));
        const totalWeight = active.reduce((sum, s) => sum + (Number(s.weight) || 0), 0) || 1;
        const totalCap = this.getLevelCapacity(lv);
        let assigned = 0;
        const locations = active.map((s, idx) => {
            let capacity;
            if (idx === active.length - 1) {
                // 最后一个库位吃掉余数，保证库位合计 = 该等级总仓容
                capacity = Math.max(1, totalCap - assigned);
            } else {
                capacity = Math.max(1, Math.floor(totalCap * (Number(s.weight) || 0) / totalWeight));
                assigned += capacity;
            }
            return {
                id: s.id,
                type: s.type,
                code: s.code,
                name: s.name,
                capacity
            };
        });
        return locations;
    },

    // ==================== 采购员模块配置 ====================
    // 采购员所属部门枚举
    buyerDepartments: [
        { id: 'purchase_dept',   name: '采购部',     icon: '🛒' },
        { id: 'ops_dept',        name: '运营部',     icon: '📊' },
        { id: 'finance_dept',    name: '财务部',     icon: '💰' },
        { id: 'logistics_dept',  name: '物流仓储部', icon: '🚚' },
        { id: 'sales_dept',      name: '销售部',     icon: '🎯' },
        { id: 'other_dept',      name: '其他部门',   icon: '👥' }
    ],

    // 采购员状态
    buyerStatus: [
        { id: 'active',   name: '在职', color: '#4caf50', icon: '✅' },
        { id: 'leave',    name: '休假', color: '#ff9800', icon: '🏖️' },
        { id: 'disabled', name: '离职', color: '#9e9e9e', icon: '🚫' }
    ],

    // 采购员性别
    buyerGenders: [
        { id: 'male',    name: '男',    icon: '👨' },
        { id: 'female',  name: '女',    icon: '👩' },
        { id: 'other',   name: '其他',  icon: '🧑' }
    ],

    // 采购员学历
    buyerEducation: [
        { id: 'high',     name: '高中/中专' },
        { id: 'college',  name: '大专' },
        { id: 'bachelor', name: '本科' },
        { id: 'master',   name: '硕士' },
        { id: 'phd',      name: '博士' },
        { id: 'other',    name: '其他' }
    ],

    // 采购计划频率
    purchasePlanFrequencies: [
        { id: 'daily',   name: '每日',   icon: '📅', intervalDays: 1,  desc: '每天按计划执行一次采购任务' },
        { id: 'weekly',  name: '每周',   icon: '🗓️', intervalDays: 7,  desc: '每隔 7 天执行一次采购任务' },
        { id: 'monthly', name: '每月',   icon: '📆', intervalDays: 30, desc: '每隔 30 天执行一次采购任务' }
    ],

    // 回扣/提成配置（按采购金额比例：0.001%，不再按件固定）
    buyerRebateConfig: {
        rebateMode: 'rate',                 // 提成方式：rate = 按采购金额比例
        defaultRebateRate: 0.00001,         // 固定提成比例 = 0.001%（采购金额 × 0.001%）
        decimals: 2,                        // 结果精度：小数点后 2 位
        minRebateAmount: 0.00,              // 最低回扣金额
        maxRebateRate: 0.05                 // 最大允许回扣比例上限（校验用）
    },

    // 校验采购员表单数据（需求e：防止无效录入）
    validateBuyer(form) {
        const errors = [];
        if (!form) { errors.push('表单数据为空'); return { ok: false, errors }; }
        // 姓名：必填，长度 2-20
        const name = String(form.name || '').trim();
        if (!name)            errors.push('姓名不能为空');
        else if (name.length < 2 || name.length > 20) errors.push('姓名长度应为 2-20 个字符');
        else if (!/^[\u4e00-\u9fa5A-Za-z·•\.\-\s]+$/.test(name)) errors.push('姓名只能包含中英文、点和横线');
        // 联系方式：支持手机号/固话
        const phone = String(form.phone || '').trim();
        if (!phone)           errors.push('联系方式不能为空');
        else if (!/^(1[3-9]\d{9}|0\d{2,3}-?\d{7,8}|\d{7,8})$/.test(phone)) errors.push('联系方式格式无效（支持11位手机号或7-11位固话）');
        // 所属部门：必须是合法ID
        const deptIds = this.buyerDepartments.map(d => d.id);
        if (!form.departmentId) errors.push('请选择所属部门');
        else if (!deptIds.includes(form.departmentId)) errors.push('所属部门无效');
        // 提成比例：必须等于固定 0.001%
        const rrate = parseFloat(form.rebateRate);
        if (isNaN(rrate))  errors.push('提成比例无效');
        else if (Math.abs(rrate - this.buyerRebateConfig.defaultRebateRate) > 1e-12) errors.push('提成比例固定为 0.001%');
        else if (rrate < 0 || rrate > this.buyerRebateConfig.maxRebateRate) errors.push('提成比例超出允许范围');
        // 入职日期（可选），若提供需合法
        if (form.joinDate && isNaN(new Date(form.joinDate).getTime())) errors.push('入职日期格式无效');
        // 状态：合法值
        const statusIds = this.buyerStatus.map(s => s.id);
        if (form.status && !statusIds.includes(form.status)) errors.push('状态值无效');
        // 年龄（可选）：16~70
        if (form.age !== undefined && form.age !== null && form.age !== '') {
            const age = parseInt(form.age);
            if (isNaN(age) || age < 16 || age > 70) errors.push('年龄应在 16-70 之间');
        }
        // 性别（可选）
        if (form.gender) {
            const gIds = this.buyerGenders.map(g => g.id);
            if (!gIds.includes(form.gender)) errors.push('性别值无效');
        }
        // 身份证（可选）：18位校验（简化，允许 X 尾）
        if (form.idCard !== undefined && form.idCard !== null && String(form.idCard).trim() !== '') {
            const idc = String(form.idCard).trim();
            if (!/^[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]$/.test(idc)) {
                errors.push('身份证号格式无效（应为18位）');
            }
        }
        // 学历（可选）
        if (form.education) {
            const eIds = this.buyerEducation.map(e => e.id);
            if (!eIds.includes(form.education)) errors.push('学历值无效');
        }
        // 邮箱（可选）
        if (form.email !== undefined && form.email !== null && String(form.email).trim() !== '') {
            const em = String(form.email).trim();
            if (!/^[\w\-.]+@[\w\-]+(\.[\w\-]+)+$/.test(em)) errors.push('邮箱格式无效');
        }
        return { ok: errors.length === 0, errors };
    },

    // 校验采购计划表单
    validatePurchasePlan(form) {
        const errors = [];
        if (!form) { errors.push('表单数据为空'); return { ok: false, errors }; }
        if (!form.buyerId) errors.push('请选择负责采购员');
        if (!Array.isArray(form.items) || form.items.length === 0) errors.push('请至少添加一种采购商品');
        if (Array.isArray(form.items)) {
            form.items.forEach((it, idx) => {
                if (!it || !it.productId) errors.push(`第 ${idx+1} 种商品未选择`);
                const qty = parseInt(it.quantity);
                if (!qty || qty <= 0) errors.push(`第 ${idx+1} 种商品数量应大于 0`);
            });
        }
        const freq = this.purchasePlanFrequencies.find(f => f.id === form.frequency);
        if (!freq) errors.push('请选择采购频率（每日/每周/每月）');
        if (form.startDay !== undefined && form.startDay !== null && form.startDay !== '') {
            const sd = parseInt(form.startDay);
            if (isNaN(sd) || sd < 1) errors.push('起始日期无效');
        }
        return { ok: errors.length === 0, errors };
    },

    // 提成计算：采购金额 × 0.001% → 2位小数
    //   amount: 该件商品金额（单价 × 数量）；rebateRate: 默认 0.001%
    calcRebate(amount, rebateRate = this.buyerRebateConfig.defaultRebateRate) {
        const amt = parseFloat(amount);
        const rate = parseFloat(rebateRate);
        if (isNaN(amt) || amt < 0 || isNaN(rate) || rate < 0) return 0.00;
        const raw = amt * rate;
        // 四舍五入到 2 位小数
        const dec = this.buyerRebateConfig.decimals;
        const factor = Math.pow(10, dec);
        return Math.round(raw * factor) / factor;
    },

    // 生成唯一ID
    generateId(prefix = 'wh') {
        return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 6)}`;
    },

    // 获取默认初始状态
    getDefaultState() {
        return {
            version: 2,
            level: 1,
            locations: this.getInitialLocations(1),
            inventory: [],          // 库存明细（含库位、批次）
            batches: [],            // 批次记录
            inboundOrders: [],      // 入库单
            outboundOrders: [],     // 出库单
            stocktakes: [],         // 盘点单
            alerts: [],             // 预警记录
            logs: [],               // 操作日志
            // ==================== 采购员模块新增字段 ====================
            buyers: [],             // 采购员列表 [{id,employeeNo,name,gender,age,idCard,education,email,nativePlace,emergencyContact,emergencyPhone,phone,departmentId,goodCategories,rebateRate,status,joinDate,remark,totalPurchaseAmount,totalRebate,purchaseOrderCount,createTime}]
            rebateRecords: [],      // 回扣记录 [{id,buyerId,inboundOrderId,productId,amount,rebateRate,rebate,day,hour,timestamp}]
            purchasePlans: [],      // 采购计划 [{id,name,buyerId,items:[{productId,productName,quantity,costPrice}],frequency:'daily|weekly|monthly',startDay,lastRunDay,nextRunDay,runCount,enabled,remark,createDay}]
            packagingMaterials: this._defaultPackagingStock(),
            packagingLogs: [],
            thresholds: { ...this.defaultThresholds },
            dailyStats: [],         // 每日统计
            settings: {
                autoAlert: true,
                batchManagement: false,
                locationManagement: false,
                strictFifo: true
            },
            security: { level: 0 }   // 仓库安防等级（securityLevels 下标）
        };
    },

    /** 默认包材库存：覆盖打包会用到的全部材料 ID */
    _defaultPackagingStock() {
        const stock = {};
        const src = (typeof PACKAGING_MATERIALS !== 'undefined' && PACKAGING_MATERIALS)
            ? PACKAGING_MATERIALS
            : this.packagingMaterials;
        Object.keys(src || {}).forEach(k => { stock[k] = 0; });
        // 开局常用库存：3.6 极简只保留 3 种核心材料（纸箱/气泡膜/胶带）
        const starter = {
            carton: 30, bubbleWrap: 40, tape: 5,
            // 旧档别名键（兼容测试/旧存档读取，运行时会迁移合并到核心材料）
            fragile_sticker: 0, thank_you_card: 0, poly_bag: 0, thermal_label: 0, fragile_label: 0, ice_pack: 0
        };
        Object.keys(starter).forEach(k => { stock[k] = starter[k]; });
        return stock;
    },

    /** 把全局 PACKAGING_MATERIALS 全量同步进仓储配置（补齐缺失打包材料） */
    syncPackagingMaterialsFromGlobal() {
        if (typeof PACKAGING_MATERIALS === 'undefined' || !PACKAGING_MATERIALS) return;
        Object.keys(PACKAGING_MATERIALS).forEach(k => {
            const src = PACKAGING_MATERIALS[k];
            if (!this.packagingMaterials[k]) {
                this.packagingMaterials[k] = {
                    id: src.id || k,
                    category: src.category,
                    name: src.name,
                    icon: src.icon,
                    unit: src.unit,
                    cost: src.cost,
                    lowStockThreshold: src.lowStockThreshold || 10,
                    consumption: src.consumption || { base: 0, perItem: 0 },
                    priceTiers: src.priceTiers || null,
                    description: src.description || ''
                };
            } else {
                const dst = this.packagingMaterials[k];
                if (!dst.priceTiers && src.priceTiers) dst.priceTiers = src.priceTiers;
                if (!dst.description && src.description) dst.description = src.description;
                if (src.cost != null) dst.cost = src.cost;
                if (src.name) dst.name = src.name;
                if (src.icon) dst.icon = src.icon;
                if (src.unit) dst.unit = src.unit;
            }
        });
    }
};

// 启动时同步：确保仓储配置含打包用到的全部材料
try {
    if (typeof WarehouseData !== 'undefined' && typeof WarehouseData.syncPackagingMaterialsFromGlobal === 'function') {
        WarehouseData.syncPackagingMaterialsFromGlobal();
    }
} catch (e) {}

// 注意：WAREHOUSE_LEVELS和PACKAGING_MATERIALS已在data/gameData.js中声明为全局常量
// 此处不再重复声明以避免冲突
