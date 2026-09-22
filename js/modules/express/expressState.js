/**
 * expressState.js - 快递合作系统状态层
 * ======================================
 * 管理：合作关系、运单、物流轨迹、结算账单、好感度、月度量
 */

const ExpressState = {
    // 快递公司合作状态 { companyId: { unlocked, cooperationPoints, friendship, totalShipments, totalSpend, settlementCycle, unlockedAt, lastActionTime: {actionId: dayHour} } }
    partners: {},

    // 运单列表 { waybillId: waybill }
    waybills: {},

    // 物流轨迹 { waybillId: [{time, status, location, description}] }
    tracks: {},

    // 对账账单 { billId: bill }
    bills: {},

    // 账单 ID 单调序号（同毫秒批量出账时避免互相覆盖）
    _billSeq: 0,

    // 月度发件统计 { yearMonth: { companyId: count, totalFee } }
    monthlyStats: {},

    // 总支出
    totalExpressSpend: 0,
    totalWaybills: 0,

    // 当前默认使用的快递公司和服务
    defaultCompany: 'zt',
    defaultService: 'standard',

    // 待结算费用（用于对账）
    pendingSettlement: 0,

    // 初始化默认合作关系
    init() {
        this.partners = {};
        EXPRESS_COMPANIES.forEach(company => {
            if (company.defaultUnlocked) {
                this.partners[company.id] = {
                    companyId: company.id,
                    unlocked: true,
                    unlockedAt: { day: 1, hour: 8 },
                    cooperationPoints: 0,
                    friendship: {
                        // 每个快递员好感度独立管理（每个公司2个快递员）
                        couriers: this._initCouriers(company.id)
                    },
                    totalShipments: 0,
                    totalSpend: 0,
                    currentMonthShipments: 0,
                    currentMonthSpend: 0,
                    weeklySpend: 0,
                    biweeklySpend: 0,
                    monthlySpend: 0,
                    settlementCycle: (typeof DEFAULT_SETTLEMENT_CYCLE !== 'undefined' ? DEFAULT_SETTLEMENT_CYCLE : 'monthly'),
                    transportMode: 'auto',       // 运输方式：auto/air/land（受公司 allowedModes 限制）
                    creditUsed: 0,
                    lastPickupHour: -1,
                    active: true
                };
            }
        });
        this.waybills = {};
        this.tracks = {};
        this.bills = {};
        this.monthlyStats = {};
        this.totalExpressSpend = 0;
        this.totalWaybills = 0;
        this.pendingSettlement = 0;
        this.unbilledFees = {};
        this.lastSettlement = { weekly: null, biweekly: null, monthly: null, quarterly: null };

        // 默认选择首个已解锁的公司
        const firstUnlocked = EXPRESS_COMPANIES.find(c => c.defaultUnlocked);
        if (firstUnlocked) {
            this.defaultCompany = firstUnlocked.id;
        }
    },

    _initCouriers(companyId) {
        const courierNames = {
            sf:  [{ id: 'sf_1', name: '王师傅' }, { id: 'sf_2', name: '李师傅' }],
            jd:  [{ id: 'jd_1', name: '张师傅' }, { id: 'jd_2', name: '刘师傅' }],
            zt:  [{ id: 'zt_1', name: '赵师傅' }, { id: 'zt_2', name: '孙师傅' }],
            yt:  [{ id: 'yt_1', name: '周师傅' }, { id: 'yt_2', name: '吴师傅' }],
            yd:  [{ id: 'yd_1', name: '郑师傅' }, { id: 'yd_2', name: '钱师傅' }],
            st:  [{ id: 'st_1', name: '陈师傅' }, { id: 'st_2', name: '林师傅' }],
            ems: [{ id: 'ems_1', name: '黄师傅' }, { id: 'ems_2', name: '何师傅' }],
            db:  [{ id: 'db_1', name: '高师傅' }, { id: 'db_2', name: '马师傅' }],
            jt:  [{ id: 'jt_1', name: '罗师傅' }, { id: 'jt_2', name: '梁师傅' }]
        };
        const names = courierNames[companyId] || [{ id: companyId + '_1', name: '快递员' }, { id: companyId + '_2', name: '快递员' }];
        return names.map(c => ({
            ...c,
            friendship: 0,
            lastActionTime: {},  // { actionId: {day, hour} }
            totalPickups: 0
        }));
    },

    // ========== 合作管理 ==========
    unlockPartner(companyId, gameTime) {
        const company = getCompanyById(companyId);
        if (!company) return { success: false, message: '快递公司不存在' };
        if (this.partners[companyId]?.unlocked) return { success: false, message: '已经合作了' };
        this.partners[companyId] = {
            companyId,
            unlocked: true,
            unlockedAt: { ...gameTime },
            cooperationPoints: 0,
            friendship: { couriers: this._initCouriers(companyId) },
            totalShipments: 0,
            totalSpend: 0,
            currentMonthShipments: 0,
            currentMonthSpend: 0,
            weeklySpend: 0,
            biweeklySpend: 0,
            monthlySpend: 0,
            settlementCycle: (typeof DEFAULT_SETTLEMENT_CYCLE !== 'undefined' ? DEFAULT_SETTLEMENT_CYCLE : 'weekly'),
            transportMode: 'auto',       // 运输方式：auto/air/land（受公司 allowedModes 限制）
            creditUsed: 0,
            lastPickupHour: -1,
            active: true
        };
        return { success: true, message: `已与${company.name}建立合作关系！` };
    },

    isPartnerUnlocked(companyId) {
        return !!(this.partners[companyId]?.unlocked);
    },

    getUnlockedPartners() {
        return Object.values(this.partners).filter(p => p.unlocked);
    },

    getPartner(companyId) {
        return this.partners[companyId] || null;
    },

    // ========== 运输方式（陆运/空运） ==========
    /** 设置合作快递默认运输方式：'auto'(按金额智能) / 'air' / 'land'（受公司 allowedModes 限制） */
    setPartnerTransportMode(companyId, mode) {
        const partner = this.getPartner(companyId);
        if (!partner) return false;
        const allowed = (typeof getCompanyAllowedModes === 'function') ? getCompanyAllowedModes(companyId) : ['land'];
        if (mode !== 'auto' && allowed.indexOf(mode) < 0) return false;
        partner.transportMode = mode;
        return true;
    },

    getPartnerTransportMode(companyId) {
        const p = this.getPartner(companyId);
        if (!p || (p.transportMode !== 'air' && p.transportMode !== 'land' && p.transportMode !== 'auto')) return 'auto';
        return p.transportMode;
    },

    /** 该公司当前生效的运输方式：手动 air/land 优先；auto 按金额智能判定（受 allowedModes 限制） */
    resolveCompanyShippingMethod(companyId, order) {
        const allowed = (typeof getCompanyAllowedModes === 'function') ? getCompanyAllowedModes(companyId) : ['land'];
        let m = this.getPartnerTransportMode(companyId);
        if (m === 'auto') {
            m = (typeof resolveShippingMethodForOrder === 'function')
                ? resolveShippingMethodForOrder(order || null, false, companyId)
                : 'land';
        }
        if (allowed.indexOf(m) < 0) m = allowed[0] || 'land';
        return m;
    },

    addCooperationPoints(companyId, points) {
        const partner = this.partners[companyId];
        if (!partner) return 0;
        partner.cooperationPoints = (partner.cooperationPoints || 0) + points;
        return partner.cooperationPoints;
    },

    setSettlementCycle(companyId, cycleId) {
        const partner = this.partners[companyId];
        if (!partner) return false;
        // 日结已下线
        if (cycleId === 'daily') cycleId = (typeof DEFAULT_SETTLEMENT_CYCLE !== 'undefined' ? DEFAULT_SETTLEMENT_CYCLE : 'weekly');
        const cycle = SETTLEMENT_CYCLES.find(c => c.id === cycleId);
        const lvl = getCooperationLevel(partner);
        if (!cycle || lvl.level < cycle.minLevel) return false;
        partner.settlementCycle = cycleId;
        return true;
    },

    setDefault(companyId, serviceId) {
        if (!this.isPartnerUnlocked(companyId)) return false;
        this.defaultCompany = companyId;
        if (serviceId) this.defaultService = serviceId;
        return true;
    },

    // ========== 好感度管理 ==========
    getCourier(companyId, courierId) {
        const partner = this.partners[companyId];
        if (!partner) return null;
        return partner.friendship.couriers.find(c => c.id === courierId) || null;
    },

    getBestCourier(companyId) {
        const partner = this.partners[companyId];
        if (!partner) return null;
        const couriers = partner.friendship.couriers;
        return couriers.reduce((best, c) => (!best || c.friendship > best.friendship) ? c : best, null);
    },

    getAvgFriendship(companyId) {
        const partner = this.partners[companyId];
        if (!partner) return 0;
        const couriers = partner.friendship.couriers;
        if (!couriers.length) return 0;
        return Math.round(couriers.reduce((s, c) => s + c.friendship, 0) / couriers.length);
    },

    doFriendshipAction(companyId, courierId, actionId, gameTime) {
        const partner = this.partners[companyId];
        if (!partner) return { success: false, message: '未合作' };
        const action = FRIENDSHIP_ACTIONS.find(a => a.id === actionId);
        if (!action) return { success: false, message: '无效操作' };
        const courier = partner.friendship.couriers.find(c => c.id === courierId);
        if (!courier) return { success: false, message: '快递员不存在' };

        // 检查冷却
        const key = actionId;
        const lastTime = courier.lastActionTime[key];
        if (lastTime) {
            const hoursPassed = (gameTime.day - lastTime.day) * 24 + (gameTime.hour - lastTime.hour);
            if (hoursPassed < action.cooldownHours) {
                const waitHours = action.cooldownHours - hoursPassed;
                return { success: false, message: `还需等待${waitHours}小时才能再次${action.name}` };
            }
        }

        // 执行
        const oldFriendship = courier.friendship;
        courier.friendship = Math.min(100, courier.friendship + action.friendshipGain);
        courier.lastActionTime[key] = { ...gameTime };

        const oldLevel = getFriendshipLevel(oldFriendship);
        const newLevel = getFriendshipLevel(courier.friendship);
        const levelUp = newLevel.level > oldLevel.level;

        return {
            success: true,
            friendshipGain: action.friendshipGain,
            cost: action.cost,
            newFriendship: courier.friendship,
            courierName: courier.name,
            levelUp,
            newLevel: newLevel.name
        };
    },

    // ========== 运单管理 ==========
    createWaybill(order, companyId, serviceId, fee, gameTime) {
        const waybillId = 'WB' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substr(2, 4).toUpperCase();
        const company = getCompanyById(companyId);
        const partner = this.partners[companyId];

        const waybill = {
            id: waybillId,
            orderId: order.id,
            companyId,
            serviceId,
            productId: order.productId,
            productName: order.productName,
            quantity: order.quantity,
            weightKg: order.weightKg || 0.5,
            buyerCity: order.buyerCity || 'shanghai',
            buyerName: order.buyerName || '买家',
            buyerPhone: order.buyerPhone || '',
            buyerAddress: order.buyerAddress || '',
            fromCity: order.fromCity || 'yiwu',
            fee,
            status: 'pending',
            statusStage: 0,
            createdAt: { ...gameTime },
            collectedAt: null,
            signedAt: null,
            estimatedDeliveryHours: (function () {
                const minH = (typeof MIN_SHIP_TO_COMPLETE_HOURS !== 'undefined') ? MIN_SHIP_TO_COMPLETE_HOURS : 24;
                const maxH = (typeof MAX_SHIP_TO_COMPLETE_HOURS !== 'undefined') ? MAX_SHIP_TO_COMPLETE_HOURS : 72;
                const h = Number(order.deliveryHours) || minH;
                return Math.min(maxH, Math.max(minH, h));
            })(),
            currentCity: order.fromCity || 'yiwu',
            courierMan: this._getRandomCourierMan(companyId),
            trackingNo: this._generateTrackingNo(companyId),
            packageId: order.packageId || null,
            packagingType: order.packagingType || 'bag',
            insurance: order.insurance || false,
            shipping_method: order.shipping_method || order.shippingMethod || 'land',
            shippingMethod: order.shippingMethod || order.shipping_method || 'land',
            exception: null,
            feePaid: false,
            billId: null
        };

        this.waybills[waybillId] = waybill;
        this.tracks[waybillId] = [{
            time: { ...gameTime },
            status: 'pending',
            location: this._getCityName(waybill.fromCity),
            description: `商家已下单，等待${company.name}揽件`
        }];

        // 更新统计
        this.totalWaybills++;
        partner.totalShipments++;
        partner.currentMonthShipments++;
        partner.totalSpend += fee;
        partner.currentMonthSpend += fee;
        partner.weeklySpend = (partner.weeklySpend || 0) + fee;
        partner.biweeklySpend = (partner.biweeklySpend || 0) + fee;
        partner.monthlySpend = (partner.monthlySpend || 0) + fee;
        this.totalExpressSpend += fee;

        // 结算周期兜底：空/非法一律按默认周结，避免被误判成「现结」当场扣款后又进账期账单
        const defaultCycle = (typeof DEFAULT_SETTLEMENT_CYCLE !== 'undefined') ? DEFAULT_SETTLEMENT_CYCLE : 'weekly';
        let cycleId = partner.settlementCycle || defaultCycle;
        if (cycleId === 'daily' || !SETTLEMENT_CYCLES.find(c => c.id === cycleId)) cycleId = defaultCycle;
        if (partner.settlementCycle !== cycleId) partner.settlementCycle = cycleId;

        // 非单结的加入待结算
        const cycle = SETTLEMENT_CYCLES.find(c => c.id === cycleId);
        if (cycle && cycle.id !== 'per_order') {
            this.pendingSettlement += fee;
            partner.creditUsed += fee;
        }

        return waybill;
    },

    _getRandomCourierMan(companyId) {
        const partner = this.partners[companyId];
        if (!partner) return '快递员';
        const couriers = partner.friendship.couriers;
        const courier = couriers[Math.floor(Math.random() * couriers.length)];
        return courier ? courier.name : '快递员';
    },

    _generateTrackingNo(companyId) {
        const prefix = { sf: 'SF', jd: 'JD', zt: 'ZT', yt: 'YT', yd: 'YD', st: 'ST', ems: 'EM', db: 'DB', jt: 'JT' }[companyId] || 'EX';
        const num = Date.now().toString().slice(-8) + Math.floor(Math.random() * 100).toString().padStart(2, '0');
        return prefix + num;
    },

    _getCityName(cityId) {
        if (typeof ALL_CITIES !== 'undefined') {
            const c = ALL_CITIES.find(c => c.id === cityId);
            if (c) return c.name;
        }
        return { yiwu: '义乌', shanghai: '上海', guangzhou: '广州', shenzhen: '深圳', beijing: '北京', hangzhou: '杭州' }[cityId] || cityId;
    },

    getWaybill(waybillId) {
        return this.waybills[waybillId] || null;
    },

    getWaybillByOrder(orderId) {
        return Object.values(this.waybills).find(w => w.orderId === orderId) || null;
    },

    updateWaybillStatus(waybillId, status, details = {}) {
        const waybill = this.waybills[waybillId];
        if (!waybill) return null;
        const oldStatus = waybill.status;
        waybill.status = status;
        const statusObj = getLogisticsStatus(status);
        waybill.statusStage = statusObj.stage;

        // 添加轨迹
        if (this.tracks[waybillId]) {
            this.tracks[waybillId].push({
                time: details.time || { day: 1, hour: 0 },
                status,
                location: details.location || waybill.currentCity,
                description: details.description || '',
                extra: details.extra || null
            });
        }

        if (status === 'collected') {
            waybill.collectedAt = details.time;
        } else if (status === 'signed' || status === 'delivered') {
            waybill.signedAt = details.time;
            waybill.status = 'signed';
        } else if (status === 'exception') {
            waybill.exception = details.reason || '未知异常';
        } else if (status === 'lost') {
            waybill.exception = '包裹丢失';
        }

        return waybill;
    },

    getTrack(waybillId) {
        return this.tracks[waybillId] || [];
    },

    getTracksByWaybill(waybillId) {
        return this.getTrack(waybillId);
    },

    getActivePartners() {
        return Object.values(this.partners).filter(p => p.unlocked && p.active);
    },

    getWaybillsByStatus(statusCode) {
        return Object.values(this.waybills).filter(w => w.status === statusCode);
    },

    getActiveWaybills() {
        // 避免每小时 Object.values 全量物化：直接扫字典键
        const out = [];
        const wbs = this.waybills || {};
        for (const id in wbs) {
            if (!Object.prototype.hasOwnProperty.call(wbs, id)) continue;
            const w = wbs[id];
            if (w && w.statusStage >= 0 && w.statusStage < 5) out.push(w);
        }
        return out;
    },

    // ========== 账单管理 ==========
    /** 单结模式：为一张运单立即生成待付账单（确认后才扣款） */
    _nextBillId() {
        this._billSeq = (this._billSeq || 0) + 1;
        const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
        return 'BL' + Date.now().toString(36).toUpperCase() + rand + this._billSeq.toString(36).toUpperCase();
    },

    createPerOrderBill(companyId, waybillId, gameTime) {
        const partner = this.partners[companyId];
        const waybill = this.waybills[waybillId];
        if (!partner || !waybill) return null;
        if (waybill.billId && this.bills[waybill.billId]) return this.bills[waybill.billId];
        const billId = this._nextBillId();
        const fee = Number(waybill.fee) || 0;
        const bill = {
            id: billId,
            companyId,
            period: `运单${waybill.trackingNo || waybillId}`,
            items: [{
                waybillId: waybill.id,
                orderId: waybill.orderId,
                fee,
                createdAt: waybill.createdAt
            }],
            totalAmount: fee,
            discountAmount: 0,
            payableAmount: Math.round(fee * 100) / 100,
            status: 'pending',
            createdAt: { ...(gameTime || {}) },
            confirmedAt: null,
            paidAt: null,
            dueAt: this._addDays(gameTime || { day: 1, hour: 0 }, 0),
            perOrder: true
        };
        waybill.billId = billId;
        this.bills[billId] = bill;
        // 单结账单直接进 bills，待付金额以 getUnpaidBills 为准（不计入账期 pendingSettlement）
        return bill;
    },

    createBill(companyId, period, gameTime) {
        const partner = this.partners[companyId];
        if (!partner) return null;
        const billId = this._nextBillId();
        const cycle = SETTLEMENT_CYCLES.find(c => c.id === partner.settlementCycle);
        const items = [];
        // 找到该公司所有未结算的运单（已现结付清 / 已挂账单的绝不重复入账）
        Object.values(this.waybills).forEach(w => {
            if (w.companyId !== companyId) return;
            if (w.billId || w.feePaid) return;
            if (w.status === 'pending') return;
            items.push({
                waybillId: w.id,
                orderId: w.orderId,
                fee: w.fee,
                createdAt: w.createdAt
            });
        });
        const totalAmount = items.reduce((s, i) => s + (Number(i.fee) || 0), 0);
        if (!(totalAmount > 0) || !items.length) return null;
        // 月结95折仅在出账时应用一次；发货计价（calculateFee）不再包含账期折扣，避免双重打折
        const discountFactor = cycle?.discountFactor ?? 1;
        const bill = {
            id: billId,
            companyId,
            period,
            items,
            totalAmount,
            discountAmount: totalAmount * (1 - discountFactor),
            payableAmount: Math.round(totalAmount * discountFactor * 100) / 100,
            status: 'pending',
            createdAt: { ...gameTime },
            confirmedAt: null,
            paidAt: null,
            dueAt: this._addDays(gameTime, cycle?.creditDays || 0)
        };
        items.forEach(i => {
            const w = this.waybills[i.waybillId];
            if (w) w.billId = billId;
        });
        this.bills[billId] = bill;
        this.pendingSettlement = Math.max(0, (this.pendingSettlement || 0) - totalAmount);
        partner.creditUsed = Math.max(0, (partner.creditUsed || 0) - totalAmount);
        return bill;
    },

    _addDays(time, days) {
        // creditDays 本身就是「天」，不要再 /24
        const d = Number(days) || 0;
        return { day: (time.day || 1) + Math.max(0, Math.ceil(d)), hour: time.hour || 0 };
    },

    confirmBill(billId) {
        const bill = this.bills[billId];
        if (!bill) return false;
        bill.status = 'confirmed';
        return true;
    },

    payBill(billId, gameTime) {
        const bill = this.bills[billId];
        if (!bill) return { success: false, message: '账单不存在' };
        if (bill.status === 'paid') return { success: false, message: '已付款' };
        bill.status = 'paid';
        bill.paidAt = { ...gameTime };
        // 付款后增加合作积分
        this.addCooperationPoints(bill.companyId, Math.floor(bill.payableAmount / 10));
        return { success: true, amount: bill.payableAmount };
    },

    getUnpaidBills() {
        return Object.values(this.bills).filter(b => b.status !== 'paid');
    },

    getBillsByCompany(companyId) {
        return Object.values(this.bills).filter(b => b.companyId === companyId);
    },

    // ========== 月度统计重置 ==========
    checkMonthReset(gameTime) {
        // 简化：每30天为一个月，第1天重置
        if (gameTime.day % 30 === 1 && gameTime.hour === 0) {
            Object.values(this.partners).forEach(p => {
                p.currentMonthShipments = 0;
                p.currentMonthSpend = 0;
            });
        }
    },

    // ========== 序列化/反序列化 ==========
    serialize() {
        return {
            partners: this.partners,
            waybills: this.waybills,
            tracks: this.tracks,
            bills: this.bills,
            monthlyStats: this.monthlyStats,
            totalExpressSpend: this.totalExpressSpend,
            totalWaybills: this.totalWaybills,
            defaultCompany: this.defaultCompany,
            defaultService: this.defaultService,
            pendingSettlement: this.pendingSettlement,
            unbilledFees: this.unbilledFees,
            lastSettlement: this.lastSettlement
        };
    },

    deserialize(data) {
        if (!data) return;
        try {
            // 先初始化默认合作方（保证新添加的默认合作公司不会丢失）
            EXPRESS_COMPANIES.forEach(company => {
                if (company.defaultUnlocked && !this.partners[company.id]) {
                    this.partners[company.id] = {
                        companyId: company.id,
                        unlocked: true,
                        unlockedAt: { day: 1, hour: 8 },
                        cooperationPoints: 0,
                        friendship: { couriers: this._initCouriers(company.id) },
                        totalShipments: 0,
                        totalSpend: 0,
                        currentMonthShipments: 0,
                        currentMonthSpend: 0,
                        weeklySpend: 0,
                        biweeklySpend: 0,
                        monthlySpend: 0,
                        settlementCycle: (typeof DEFAULT_SETTLEMENT_CYCLE !== 'undefined' ? DEFAULT_SETTLEMENT_CYCLE : 'monthly'),
                        creditUsed: 0,
                        lastPickupHour: -1,
                        active: true
                    };
                }
            });
            // 合并保存的数据
            Object.assign(this.partners, data.partners || {});
            // 反序列化后强制确保默认合作方已解锁且有快递员数据（防止坏档/旧档覆盖）
            EXPRESS_COMPANIES.forEach(company => {
                if (company.defaultUnlocked && this.partners[company.id]) {
                    this.partners[company.id].unlocked = true;
                    this.partners[company.id].active = true;
                    if (!this.partners[company.id].friendship?.couriers?.length) {
                        this.partners[company.id].friendship = { couriers: this._initCouriers(company.id) };
                    }
                    // 老档升级：补齐累计槽
                    const p = this.partners[company.id];
                    if (p.weeklySpend === undefined || p.weeklySpend === null) p.weeklySpend = 0;
                    if (p.biweeklySpend === undefined || p.biweeklySpend === null) p.biweeklySpend = 0;
                    if (p.monthlySpend === undefined || p.monthlySpend === null) p.monthlySpend = 0;
                }
            });
            // 所有快递默认周结：旧存档 daily / 空值 → 周结（每周一结账）
            const defaultCycle = (typeof DEFAULT_SETTLEMENT_CYCLE !== 'undefined') ? DEFAULT_SETTLEMENT_CYCLE : 'weekly';
            Object.keys(this.partners).forEach(pid => {
                const p = this.partners[pid];
                if (!p) return;
                if (p.settlementCycle === 'daily' || !p.settlementCycle) {
                    p.settlementCycle = defaultCycle;
                }
                // 老档升级：运输方式缺省/非法 → auto（智能按金额）
                if (p.transportMode !== 'air' && p.transportMode !== 'land' && p.transportMode !== 'auto') {
                    p.transportMode = 'auto';
                }
            });
            // 新开档/兼容：确保每个已解锁合作方至少有 settlementCycle=weekly
            Object.keys(this.partners).forEach(pid => {
                const p = this.partners[pid];
                if (!p || !p.unlocked) return;
                if (!p.settlementCycle || p.settlementCycle === 'weekly' || p.settlementCycle === 'biweekly'
                    || p.settlementCycle === 'quarterly' || p.settlementCycle === 'daily') {
                    p.settlementCycle = (typeof DEFAULT_SETTLEMENT_CYCLE !== 'undefined') ? DEFAULT_SETTLEMENT_CYCLE : 'monthly';
                }
            });
            this.waybills = data.waybills || {};
            this.tracks = data.tracks || {};
            this.bills = data.bills || {};
            this.monthlyStats = data.monthlyStats || {};
            this.totalExpressSpend = data.totalExpressSpend || 0;
            this.totalWaybills = data.totalWaybills || 0;
            this.defaultCompany = data.defaultCompany || 'zt';
            this.defaultService = data.defaultService || 'standard';
            this.pendingSettlement = data.pendingSettlement || 0;
            this.unbilledFees = data.unbilledFees || {};
            this.lastSettlement = data.lastSettlement || { weekly: null, biweekly: null, monthly: null, quarterly: null };

            // 确保默认公司已解锁
            if (!this.partners[this.defaultCompany]?.unlocked) {
                const firstUnlocked = Object.keys(this.partners).find(pid => this.partners[pid].unlocked);
                this.defaultCompany = firstUnlocked || 'zt';
            }
        } catch (e) {
            console.error('[ExpressState] deserialize error:', e);
        }
    }
};

if (typeof window !== 'undefined') {
    window.ExpressState = ExpressState;
}
