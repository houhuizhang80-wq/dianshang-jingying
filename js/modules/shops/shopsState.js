/**
 * shopsState.js — 多店铺系统状态层（阶段A：地基）
 * 管理 state.shops[]：开店/关店/改价/库存概览/店铺查询。
 * 阶段B会扩展：调拨在途、独立日结、销量公式。
 * 数据存于 gameState.state.shops（随存档序列化）。
 */

class ShopsState {
    constructor(gameState) {
        this.gs = gameState;
        this.initialized = false;
    }

    init(gameState) {
        this.gs = gameState || this.gs;
        if (this.initialized) return this;
        // 存档兜底：保证 state.shops 存在且为主店预留
        this._ensureState();
        this.initialized = true;
        return this;
    }

    _ensureState() {
        if (!this.gs.state.shops || !Array.isArray(this.gs.state.shops)) {
            this.gs.state.shops = [];
        }
        // 主店（现有线上店）始终在列表首项：id='main'
        const hasMain = this.gs.state.shops.some(s => s && s.id === 'main');
        if (!hasMain) {
            const whCity = this._getWarehouseCityName();
            this.gs.state.shops.unshift({
                id: 'main',
                type: 'online',
                name: this.gs.state.shop && this.gs.state.shop.name || '线上主店',
                location: whCity,
                region: this._getRegion(whCity),
                rent: 0,               // 主店不另收租金（平台抽成已在结算）
                traffic: 400,
                reputation: 50,
                level: 1,
                capacity: 2000,
                locked: true,          // 主店不可关闭
                isMain: true,
                decoration: 'none',    // 店铺装修档位（SHOP_DECOR_STYLES id）
                inventory: {},         // productId → qty（阶段A仅记录，结算沿用现有线上逻辑）
                priceOverrides: {},    // productId → 倍率
                openedDay: 1,
                createdAt: Date.now()
            });
        }
    }

    _getWarehouseCityName() {
        try {
            const c = this.gs.getWarehouseCity && this.gs.getWarehouseCity();
            return (c && c.name) || c || '杭州';
        } catch (_) { return '杭州'; }
    }

    _getRegion(cityName) {
        if (typeof SHOP_CITY_REGIONS !== 'undefined' && SHOP_CITY_REGIONS[cityName]) {
            return SHOP_CITY_REGIONS[cityName];
        }
        return '华东';
    }

    /** 全部店铺（含主店） */
    getShops() {
        this._ensureState();
        return this.gs.state.shops;
    }

    /** 非主店的可经营店铺 */
    getChannelShops() {
        this._ensureState();
        return this.gs.state.shops.filter(s => s && !s.isMain);
    }

    getShopById(id) {
        this._ensureState();
        return this.gs.state.shops.find(s => s && s.id === id) || null;
    }

    getShopCount() {
        this._ensureState();
        return this.gs.state.shops.length;
    }

    /** 生成店铺 id */
    _genId() {
        return 'shop_' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
    }

    /**
     * 开店
     * @param {string} type  online/retail/delivery
     * @param {string} location 城市名
     * @param {string} name 店名（可选，默认按类型）
     */
    openShop(type, location, name) {
        this._ensureState();
        const cfg = (typeof SHOP_TYPES !== 'undefined') ? SHOP_TYPES[type] : null;
        if (!cfg) return { success: false, message: '无效的店铺类型' };
        const shopLv = (this.gs.state.shop && this.gs.state.shop.level) || 1;
        if (cfg.unlockLevel > shopLv) {
            return { success: false, message: `店铺等级不足：需 Lv.${cfg.unlockLevel}（当前 Lv.${shopLv}）` };
        }
        const cityName = (location && String(location).trim()) || this._getWarehouseCityName();
        const openCost = cfg.openCost;
        if (openCost > 0) {
            const paid = this.gs.spendFunds(openCost, `开设${cfg.name}`);
            if (!paid) return { success: false, message: `资金不足，开店需 ¥${openCost.toLocaleString()}` };
        }
        const shop = {
            id: this._genId(),
            type,
            name: (name && String(name).trim()) || `${cfg.name}·${cityName}`,
            location: cityName,
            region: this._getRegion(cityName),
            rent: cfg.rentBase,
            traffic: cfg.baseTraffic,
            reputation: 60,
            level: 1,
            capacity: cfg.capacity,
            locked: false,
            isMain: false,
            decoration: 'none',
            inventory: {},
            priceOverrides: {},
            openedDay: (this.gs.state.gameTime && this.gs.state.gameTime.day) || 1,
            createdAt: Date.now()
        };
        this._initOfflineFields(shop);
        this.gs.state.shops.push(shop);
        try { this.gs.notify(); } catch (_) {}
        return { success: true, shop, message: `${cfg.name}「${shop.name}」开设成功！` };
    }

    /** 关闭店铺（主店不可关；关闭返还部分投入，库存作废） */
    closeShop(shopId) {
        this._ensureState();
        const shop = this.getShopById(shopId);
        if (!shop) return { success: false, message: '店铺不存在' };
        if (shop.isMain) return { success: false, message: '主店不可关闭' };
        const refund = Math.floor((typeof SHOP_TYPES !== 'undefined' && SHOP_TYPES[shop.type] ? SHOP_TYPES[shop.type].openCost : 0) * 0.3);
        if (refund > 0) {
            this.gs.addFunds(refund, `关店清算（${shop.name}）`);
        }
        this.gs.state.shops = this.gs.state.shops.filter(s => s && s.id !== shopId);
        try { this.gs.notify(); } catch (_) {}
        return { success: true, message: `已关闭「${shop.name}」，返还 ¥${refund.toLocaleString()}` };
    }

    _initOfflineFields(shop) {
        if (!shop || shop.isMain) return shop;
        if (shop.type === 'retail') {
            if (!shop.retail) {
                shop.retail = {
                    venue: 'street',
                    openHour: 9,
                    closeHour: 21,
                    members: 0,
                    tryOnBoost: 1
                };
            }
            this._applyRetailVenueStats(shop);
        }
        if (shop.type === 'delivery') {
            if (!shop.delivery) {
                shop.delivery = {
                    platform: 'meituan',
                    rating: 4.6,
                    radiusKm: 3,
                    kitchenOpen: true,
                    packagingFee: 1.5
                };
            }
        }
        return shop;
    }

    _applyRetailVenueStats(shop) {
        if (!shop || shop.type !== 'retail') return;
        const venue = (typeof RETAIL_VENUE_BY_ID !== 'undefined' && RETAIL_VENUE_BY_ID[(shop.retail && shop.retail.venue) || 'street'])
            || { rentMul: 1, trafficMul: 1 };
        const cfg = (typeof SHOP_TYPES !== 'undefined') ? SHOP_TYPES.retail : null;
        const lv = shop.level || 1;
        shop.rent = Math.round((cfg ? cfg.rentBase : 5000) * (venue.rentMul || 1) * (1 + (lv - 1) * 0.08));
        shop.traffic = Math.round((cfg ? cfg.baseTraffic : 800) * (venue.trafficMul || 1) * Math.pow(1.15, lv - 1));
    }

    setRetailVenue(shopId, venueId) {
        this._ensureState();
        const shop = this.getShopById(shopId);
        if (!shop || shop.type !== 'retail') return { success: false, message: '仅零售店可选址' };
        const venue = (typeof RETAIL_VENUE_BY_ID !== 'undefined') ? RETAIL_VENUE_BY_ID[venueId] : null;
        if (!venue) return { success: false, message: '无效选址' };
        this._initOfflineFields(shop);
        shop.retail.venue = venueId;
        this._applyRetailVenueStats(shop);
        try { this.gs.notify(); } catch (_) {}
        return { success: true, message: `「${shop.name}」已改为${venue.icon} ${venue.name}` };
    }

    setDeliveryPlatform(shopId, platformId) {
        this._ensureState();
        const shop = this.getShopById(shopId);
        if (!shop || shop.type !== 'delivery') return { success: false, message: '仅外卖店可切换平台' };
        const plat = (typeof DELIVERY_PLATFORM_BY_ID !== 'undefined') ? DELIVERY_PLATFORM_BY_ID[platformId] : null;
        if (!plat) return { success: false, message: '无效平台' };
        this._initOfflineFields(shop);
        shop.delivery.platform = platformId;
        try { this.gs.notify(); } catch (_) {}
        return { success: true, message: `已入驻 ${plat.icon} ${plat.name}` };
    }

    setDeliveryRadius(shopId, km) {
        this._ensureState();
        const shop = this.getShopById(shopId);
        if (!shop || shop.type !== 'delivery') return { success: false, message: '仅外卖店可调配送半径' };
        this._initOfflineFields(shop);
        shop.delivery.radiusKm = Math.max(1, Math.min(8, Math.round(Number(km) || 3)));
        try { this.gs.notify(); } catch (_) {}
        return { success: true, message: `配送半径已设为 ${shop.delivery.radiusKm} 公里` };
    }

    toggleKitchen(shopId) {
        this._ensureState();
        const shop = this.getShopById(shopId);
        if (!shop || shop.type !== 'delivery') return { success: false, message: '仅外卖店可开关档口' };
        this._initOfflineFields(shop);
        shop.delivery.kitchenOpen = !shop.delivery.kitchenOpen;
        try { this.gs.notify(); } catch (_) {}
        return { success: true, message: shop.delivery.kitchenOpen ? '档口已出餐' : '档口已打烊（当日无外卖单）' };
    }

    getOfflineSummary() {
        this._ensureState();
        const list = this.getChannelShops();
        const retail = list.filter(s => s && s.type === 'retail');
        const delivery = list.filter(s => s && s.type === 'delivery');
        const sum = (arr, key) => arr.reduce((n, s) => n + Number((s.stats && s.stats[key]) || 0), 0);
        return {
            retailCount: retail.length,
            deliveryCount: delivery.length,
            retailToday: sum(retail, 'todayIncome'),
            deliveryToday: sum(delivery, 'todayIncome'),
            retailNet: sum(retail, 'todayNet'),
            deliveryNet: sum(delivery, 'todayNet'),
            pendingTransfers: this.getPendingTransfers().length
        };
    }

    // ==================== P0-1：门店员工 ====================

    _ensureShopStaff(shop) {
        if (!shop.staff) shop.staff = []; // employeeId 数组
        return shop.staff;
    }

    /** 派员工到店（员工需在职，一名员工同一时间只服务一家店） */
    assignStaff(shopId, employeeId) {
        this._ensureState();
        const shop = this.getShopById(shopId);
        if (!shop) return { success: false, message: '店铺不存在' };
        if (shop.isMain) return { success: false, message: '主店使用现有员工体系' };
        const emp = (this.gs.state.employees || []).find(e => e && e.id === employeeId);
        if (!emp || emp.status !== 'active') return { success: false, message: '员工不存在或已离职' };
        // 当前店已在该员工 → 拦截重复派遣
        if (shop.staff && shop.staff.indexOf(employeeId) >= 0) {
            return { success: false, message: '该员工已在「' + shop.name + '」任职' };
        }
        // 检查该员工是否已在别店
        const shops = this.getChannelShops();
        for (let i = 0; i < shops.length; i++) {
            const s = shops[i];
            if (s === shop) continue;
            if (s.staff && s.staff.indexOf(employeeId) >= 0) {
                return { success: false, message: '该员工已在其他店铺任职' };
            }
        }
        this._ensureShopStaff(shop).push(employeeId);
        try { this.gs.notify(); } catch (_) {}
        return { success: true, message: `${emp.name} 已派往「${shop.name}」` };
    }

    /** 调回员工 */
    unassignStaff(shopId, employeeId) {
        this._ensureState();
        const shop = this.getShopById(shopId);
        if (!shop) return { success: false, message: '店铺不存在' };
        this._ensureShopStaff(shop);
        const idx = shop.staff.indexOf(employeeId);
        if (idx < 0) return { success: false, message: '该员工不在本店' };
        shop.staff.splice(idx, 1);
        try { this.gs.notify(); } catch (_) {}
        return { success: true, message: '员工已调回' };
    }

    /** 门店员工加成：每人 +12%（员工等级越高加成越高），返回倍数 */
    _staffBonus(shop) {
        const staffIds = (shop && shop.staff) || [];
        if (!staffIds.length) return 1;
        let bonus = 1;
        const emps = this.gs.state.employees || [];
        for (let i = 0; i < staffIds.length; i++) {
            const emp = emps.find(e => e && e.id === staffIds[i]);
            if (emp && emp.status === 'active') {
                bonus += 0.08 + ((emp.level || 1) - 1) * 0.02; // 每人8%起，每级+2%
            }
        }
        return Math.min(bonus, 2.5);
    }

    // ==================== P0-2：门店促销/清仓 ====================

    /** 设置门店清仓促销：discountRate 0~0.5（折扣比例），durationDays */
    setShopPromotion(shopId, discountRate, durationDays) {
        this._ensureState();
        const shop = this.getShopById(shopId);
        if (!shop) return { success: false, message: '店铺不存在' };
        if (shop.isMain) return { success: false, message: '主店请用现有促销系统' };
        const rate = Number(discountRate);
        if (!(rate >= 0 && rate <= 0.5)) return { success: false, message: '折扣需在 0%~50% 之间' };
        const days = Math.max(1, Math.min(14, Math.floor(Number(durationDays) || 3)));
        shop.promotion = {
            discountRate: Math.round(rate * 100) / 100,
            startDay: (this.gs.state.gameTime && this.gs.state.gameTime.day) || 1,
            endDay: ((this.gs.state.gameTime && this.gs.state.gameTime.day) || 1) + days
        };
        try { this.gs.notify(); } catch (_) {}
        return { success: true, message: `${shop.name} 已开启 ${rate * 100}% 清仓促销（${days}天）` };
    }

    clearShopPromotion(shopId) {
        this._ensureState();
        const shop = this.getShopById(shopId);
        if (!shop) return { success: false, message: '店铺不存在' };
        shop.promotion = null;
        try { this.gs.notify(); } catch (_) {}
        return { success: true, message: '已关闭清仓促销' };
    }

    /** 促销有效且未过期？ */
    _promotionActive(shop, nowDay) {
        return !!(shop.promotion && shop.promotion.endDay >= (nowDay || 1));
    }

    // ==================== P1-2：门店等级/升级 ====================

    /** 门店升级：费用+容量/流量提升 */
    upgradeShop(shopId) {
        this._ensureState();
        const shop = this.getShopById(shopId);
        if (!shop) return { success: false, message: '店铺不存在' };
        if (shop.isMain) return { success: false, message: '主店使用现有店铺升级系统' };
        const lv = shop.level || 1;
        if (lv >= 10) return { success: false, message: '已达最高等级' };
        const baseCost = (typeof SHOP_TYPES !== 'undefined' && SHOP_TYPES[shop.type]) ? SHOP_TYPES[shop.type].openCost : 50000;
        const cost = Math.round(baseCost * 0.8 * lv); // 升级费 = 开店费×0.8×当前级
        if (cost > 0 && typeof this.gs.spendFunds === 'function') {
            if (!this.gs.spendFunds(cost, `${shop.name} 升级至 Lv.${lv + 1}`)) {
                return { success: false, message: `资金不足，升级需 ¥${cost.toLocaleString()}` };
            }
        }
        shop.level = lv + 1;
        shop.capacity = Math.round((shop.capacity || 1000) * 1.4);
        shop.traffic = Math.round((shop.traffic || 400) * 1.2);
        try { this.gs.notify(); } catch (_) {}
        return { success: true, message: `${shop.name} 升至 Lv.${lv + 1}（容量×1.4、流量×1.2）` };
    }

    // ==================== 阶段E：店铺装修 ====================

    /** 当前装修档位信息 */
    getDecoration(shop) {
        if (!shop) return null;
        const style = (typeof SHOP_DECOR_BY_ID !== 'undefined' && SHOP_DECOR_BY_ID[shop.decoration])
            || (typeof SHOP_DECOR_STYLES !== 'undefined' && SHOP_DECOR_STYLES[0])
            || { id: 'none', name: '简陋装修', icon: '🧱', trafficBonus: 1, reputationBonus: 0, desc: '基础店面' };
        return style;
    }

    /**
     * 店铺装修：投入一次性装修费，提升客流（trafficBonus 倍率）+ 一次性信誉提升。
     * 装修档位可逐步升级（只允许升档，不可降档）。
     */
    decorateShop(shopId, styleId) {
        this._ensureState();
        const shop = this.getShopById(shopId);
        if (!shop) return { success: false, message: '店铺不存在' };
        const style = (typeof SHOP_DECOR_BY_ID !== 'undefined') ? SHOP_DECOR_BY_ID[styleId] : null;
        if (!style) return { success: false, message: '无效的装修档位' };
        const cur = this.getDecoration(shop);
        const curIdx = (typeof SHOP_DECOR_STYLES !== 'undefined')
            ? SHOP_DECOR_STYLES.findIndex(s => s.id === (cur && cur.id)) : -1;
        const newIdx = (typeof SHOP_DECOR_STYLES !== 'undefined')
            ? SHOP_DECOR_STYLES.findIndex(s => s.id === styleId) : -1;
        if (newIdx <= curIdx) return { success: false, message: '只能升级到更高档次的装修' };
        if (style.cost > 0 && typeof this.gs.spendFunds === 'function') {
            if (!this.gs.spendFunds(style.cost, `${shop.name} 装修升级为「${style.name}」`)) {
                return { success: false, message: `资金不足，装修需 ¥${style.cost.toLocaleString()}` };
            }
        }
        shop.decoration = styleId;
        // 一次性信誉提升（封顶 100）
        shop.reputation = Math.min(100, (Number(shop.reputation) || 50) + (style.reputationBonus || 0));
        try { this.gs.notify(); } catch (_) {}
        return { success: true, message: `${shop.name} 已升级为「${style.name}」${style.desc ? '（' + style.desc + '）' : ''}` };
    }

    /** 装修客流倍率（结算时叠加到需求） */
    _decorationBonus(shop) {
        const style = this.getDecoration(shop);
        return style && typeof style.trafficBonus === 'number' ? style.trafficBonus : 1;
    }

    // ==================== 阶段C：共享库存 / 自提连带 / 前置仓 ====================

    /** 共享库存开关：开启后该店日结缺货时自动从总仓即时补足（前置仓/共享库存） */
    setShareInventory(shopId, enabled) {
        this._ensureState();
        const shop = this.getShopById(shopId);
        if (!shop) return { success: false, message: '店铺不存在' };
        if (shop.isMain) return { success: false, message: '主店即总仓' };
        shop.shareInventory = !!enabled;
        try { this.gs.notify(); } catch (_) {}
        return { success: true, message: enabled ? `${shop.name} 已开启共享库存（总仓自动补货）` : `${shop.name} 已关闭共享库存` };
    }

    /**
     * 阶段C-1/3：从总仓即时补货（共享库存/前置仓）
     * 日结时若店库存不足目标，自动从主店扣库存补足（即时到店，无运费）。
     * @returns {number} 补货件数
     */
    _autoRefillFromMain(shop, product, wantQty) {
        const main = this.getShops().find(s => s && s.isMain);
        const have = Number((shop.inventory || {})[product.id]) || 0;
        const need = Math.max(0, wantQty - have);
        if (need <= 0) return 0;
        const mainAvail = (typeof this.gs.getInventoryQuantity === 'function')
            ? this.gs.getInventoryQuantity(product.id) : 0;
        if (mainAvail <= 0) return 0;
        const take = Math.min(need, mainAvail);
        if (!this._deductMainStock(product.id, take)) return 0;
        if (!shop.inventory) shop.inventory = {};
        shop.inventory[product.id] = have + take;
        return take;
    }

    /**
     * 阶段C-2：零售店自提连带购买
     * 零售店按当日销量的一定比例（~8%）产生「到店自提/试穿」连带购买（额外收入+客流）。
     */
    _pickupSpillover(shop, soldUnits) {
        if (shop.type !== 'retail' || soldUnits <= 0) return 0;
        const rate = 0.08 + Math.random() * 0.05; // 8%~13%
        return Math.max(0, Math.floor(soldUnits * rate));
    }

    /** 独立定价：设置某店某商品售价倍率 */
    setShopPriceOverride(shopId, productId, multiplier) {
        this._ensureState();
        const shop = this.getShopById(shopId);
        if (!shop) return { success: false, message: '店铺不存在' };
        const m = Number(multiplier);
        if (!(m > 0.1) || !(m < 50)) return { success: false, message: '倍率需在 0.1~50 之间' };
        if (!shop.priceOverrides) shop.priceOverrides = {};
        if (m >= 0.99 && m <= 1.01) {
            delete shop.priceOverrides[productId]; // 接近1视为默认价
        } else {
            shop.priceOverrides[productId] = Math.round(m * 100) / 100;
        }
        try { this.gs.notify(); } catch (_) {}
        return { success: true, message: '定价已更新' };
    }

    /** 该店某商品的最终售价（基础价 × 倍率） */
    getShopPrice(shop, product) {
        if (!shop || !product) return product && product.basePrice || 0;
        const m = shop.priceOverrides && shop.priceOverrides[product.id];
        const base = (typeof product.basePrice === 'number') ? product.basePrice : 0;
        return base * (m || 1);
    }

    // ==================== 阶段D：批量调价 / 渠道标签 ====================

    /** 批量调价：scope=all|category，multiplier 为倍率；对店内有库存(或全部)商品批量设置/清除 */
    bulkAdjustPrice(shopId, multiplier, scope = 'all', category = null) {
        this._ensureState();
        const shop = this.getShopById(shopId);
        if (!shop) return { success: false, message: '店铺不存在' };
        const m = Number(multiplier);
        if (!(m > 0.1) || !(m < 50)) return { success: false, message: '倍率需在 0.1~50 之间' };
        if (!shop.priceOverrides) shop.priceOverrides = {};
        const PRODS = (typeof PRODUCTS !== 'undefined') ? PRODUCTS : [];
        const targets = [];
        if (scope === 'category' && category) {
            PRODS.forEach(p => {
                if (p && p.category === category) targets.push(p.id);
            });
        } else if (scope === 'stock') {
            // 仅店内有库存的商品
            Object.keys(shop.inventory || {}).forEach(pid => targets.push(pid));
        } else {
            PRODS.forEach(p => { if (p) targets.push(p.id); });
        }
        let set = 0;
        targets.forEach(pid => {
            if (m >= 0.99 && m <= 1.01) {
                if (shop.priceOverrides[pid] != null) { delete shop.priceOverrides[pid]; set++; }
            } else {
                shop.priceOverrides[pid] = Math.round(m * 100) / 100;
                set++;
            }
        });
        try { this.gs.notify(); } catch (_) {}
        return { success: true, count: set, message: `已${m >= 0.99 && m <= 1.01 ? '恢复默认' : '调整'} ${set} 款商品定价` };
    }

    /** 商品渠道标签（UI 展示 + 即时需求加成判断） */
    getChannelTag(product) {
        if (!product || !product.category) return null;
        const T = (typeof SHOP_CHANNEL_TAGS !== 'undefined') ? SHOP_CHANNEL_TAGS : null;
        if (!T) return null;
        const row = T[String(product.category).toLowerCase()];
        return row || null;
    }

    /** 即时需求加成：标签驱动（阶段D + 多平台扩展） */
    _instantDemandBonus(shopType, product) {
        try {
            const tag = this.getChannelTag(product);
            if (!tag) return 1;
            if (tag.tag === '即时需求' && shopType === 'delivery') return 1.15;
            if (tag.tag === '线下体验' && shopType === 'retail') return 1.1;
            if (tag.tag === '线上热销' && shopType === 'online') return 1.1;
            if (tag.tag === '线上热销' && shopType === 'douyin') return 1.15;   // 抖音种草转化
            if (tag.tag === '高频复购' && shopType === 'pinduoduo') return 1.15; // 拼多多走量
        } catch (_) {}
        return 1;
    }

    /** 渠道店当日成本（平台抽成/达人佣金/租金日摊/外卖配送费） */
    _calcChannelCosts(shop, income, units, now) {
        const P = (typeof SHOP_COST_PARAMS !== 'undefined') ? SHOP_COST_PARAMS : null;
        const lv = shop.level || 1;
        let platform = 0, delivery = 0, rent = 0;
        if (shop.type === 'online') {
            const rate = (P && P.onlinePlatformRate) ? P.onlinePlatformRate(lv) : 0.1;
            platform = Math.round(income * rate * 100) / 100;
        } else if (shop.type === 'delivery') {
            const fee = (P && P.deliveryFeePerOrder) ? P.deliveryFeePerOrder(lv) : 2.5;
            const plat = (typeof DELIVERY_PLATFORM_BY_ID !== 'undefined' && shop.delivery)
                ? DELIVERY_PLATFORM_BY_ID[shop.delivery.platform] : null;
            const pack = (shop.delivery && Number(shop.delivery.packagingFee)) || 0;
            delivery = Math.round(units * (fee + pack) * 100) / 100;
            if (plat && plat.commission > 0) {
                platform = Math.round(income * plat.commission * 100) / 100;
            }
        } else if (shop.type === 'douyin') {
            // 抖音小店:达人佣金按收入抽(20%→16%),无额外配送费
            const rate = (P && P.douyinCommission) ? P.douyinCommission(lv) : 0.2;
            platform = Math.round(income * rate * 100) / 100;
        } else if (shop.type === 'pinduoduo') {
            // 拼多多:平台抽成极低(0.6%→0.4%)
            const rate = (P && P.pddPlatformRate) ? P.pddPlatformRate(lv) : 0.006;
            platform = Math.round(income * rate * 100) / 100;
        }
        // 所有渠道店月租日摊（主店无租金）
        if (!shop.isMain && Number(shop.rent) > 0) {
            const days = (P && P.rentDailyShare) ? P.rentDailyShare : 30;
            rent = Math.round((Number(shop.rent) / days) * 100) / 100;
        }
        const total = Math.round((platform + delivery + rent) * 100) / 100;
        return { platform, delivery, rent, total };
    }

    /** 店铺库存总览：{ productId: qty }（阶段A记录用，调拨在阶段B） */
    getShopInventory(shopId) {
        const shop = this.getShopById(shopId);
        if (!shop) return {};
        return shop.inventory || {};
    }

    /** 校验开店合法性（UI 用） */
    validateOpen(type, location) {
        this._ensureState();
        const cfg = (typeof SHOP_TYPES !== 'undefined') ? SHOP_TYPES[type] : null;
        if (!cfg) return { ok: false, reason: '无效类型' };
        const shopLv = (this.gs.state.shop && this.gs.state.shop.level) || 1;
        if (cfg.unlockLevel > shopLv) return { ok: false, reason: `需店铺 Lv.${cfg.unlockLevel}` };
        if (!location || !String(location).trim()) return { ok: false, reason: '请选择城市' };
        return { ok: true };
    }

    /** 状态快照（存档体积预警/调试用） */
    describe() {
        this._ensureState();
        return this.gs.state.shops.map(s => `${s.name}(${s.type}·${s.location})`).join('、');
    }

    // ==================== 阶段B：库存调拨 ====================

    _ensureTransfers() {
        if (!this.gs.state.transfers || !Array.isArray(this.gs.state.transfers)) {
            this.gs.state.transfers = [];
        }
        return this.gs.state.transfers;
    }

    /**
     * 创建调拨单：从主店(总仓) → 目标渠道店
     * @param {string} toShopId 目标店铺
     * @param {string} productId
     * @param {number} qty
     */
    createTransfer(toShopId, productId, qty) {
        this._ensureState();
        const shop = this.getShopById(toShopId);
        if (!shop) return { success: false, message: '目标店铺不存在' };
        if (shop.isMain) return { success: false, message: '主店无需调拨' };
        const n = parseInt(qty, 10);
        if (!(n > 0)) return { success: false, message: '数量需大于0' };
        const available = (typeof this.gs.getInventoryQuantity === 'function')
            ? this.gs.getInventoryQuantity(productId)
            : 0;
        if (available < n) return { success: false, message: `总仓库存不足（现有 ${available}）` };
        const product = (typeof PRODUCTS !== 'undefined') ? PRODUCTS.find(p => p && p.id === productId) : null;
        const weight = product && product.weight || 0.3;
        const cost = Math.round(weight * n * ((typeof SHOP_TRANSFER_RULES !== 'undefined') ? SHOP_TRANSFER_RULES.costPerKg : 2) * 100) / 100;

        // 运输时间：同城 2-4h，跨区 8-24h
        const mainShop = this.getShops().find(s => s && s.isMain);
        const fromCity = mainShop ? mainShop.location : this._getWarehouseCityName();
        const sameRegion = this._getRegion(fromCity) === shop.region;
        const [minH, maxH] = (typeof SHOP_TRANSFER_RULES !== 'undefined')
            ? (sameRegion ? SHOP_TRANSFER_RULES.sameCityHours : SHOP_TRANSFER_RULES.crossRegionHours)
            : (sameRegion ? [2, 4] : [8, 24]);
        const arriveHours = minH + Math.floor(Math.random() * (maxH - minH + 1));
        const now = this.gs.state.gameTime || { day: 1, hour: 0 };
        const arriveDay = now.day + Math.floor((now.hour + arriveHours) / 24);
        const arriveHour = (now.hour + arriveHours) % 24;

        // 支付运费（不足则拦截）
        if (cost > 0 && typeof this.gs.spendFunds === 'function') {
            if (!this.gs.spendFunds(cost, `调拨运费(${product ? product.name : productId}×${n})`)) {
                return { success: false, message: `资金不足支付运费 ¥${cost.toFixed(2)}` };
            }
        }

        const transfer = {
            id: 'tr_' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
            from: 'main',
            to: toShopId,
            productId,
            quantity: n,
            cost,
            sameRegion,
            arriveDay,
            arriveHour,
            status: 'in_transit',
            createdDay: now.day,
            createdHour: now.hour
        };
        this._ensureTransfers().push(transfer);
        try { this.gs.notify(); } catch (_) {}
        return {
            success: true,
            transfer,
            message: `调拨中：${product ? product.name : productId}×${n}，${arriveHours}小时后到「${shop.name}」`
        };
    }

    getTransfers() {
        return this._ensureTransfers();
    }

    getPendingTransfers() {
        return this._ensureTransfers().filter(t => t && t.status === 'in_transit');
    }

    /**
     * 每日检查调拨到达：到时扣主店库存 + 入店铺库存
     * @param {object} now gameTime
     */
    processTransfers(now) {
        this._ensureState();
        const ts = this._ensureTransfers();
        if (!ts.length) return { arrived: 0 };
        const t = now || this.gs.state.gameTime || { day: 1, hour: 0 };
        let arrived = 0;
        const remaining = [];
        for (let i = 0; i < ts.length; i++) {
            const tr = ts[i];
            if (!tr || tr.status !== 'in_transit') { remaining.push(tr); continue; }
            const reached = (t.day > tr.arriveDay) || (t.day === tr.arriveDay && t.hour >= tr.arriveHour);
            if (!reached) { remaining.push(tr); continue; }
            // 到达：扣主店库存（走仓库 outbound）→ 入店铺
            const deducted = this._deductMainStock(tr.productId, tr.quantity);
            if (deducted) {
                const shop = this.getShopById(tr.to);
                if (shop) {
                    if (!shop.inventory) shop.inventory = {};
                    shop.inventory[tr.productId] = (Number(shop.inventory[tr.productId]) || 0) + tr.quantity;
                }
                tr.status = 'arrived';
                tr.arrivedDay = t.day;
                arrived++;
            } else {
                // 扣减失败（理论上不会：创建时已校验）：标记异常，退款运费
                tr.status = 'failed';
                tr.failReason = '总仓库存不足，已退款';
                if (tr.cost > 0 && typeof this.gs.addFunds === 'function') {
                    this.gs.addFunds(tr.cost, `调拨失败退款(${tr.productId})`);
                }
                arrived--;
            }
        }
        this.gs.state.transfers = remaining.concat(ts.filter(x => x && x.status !== 'in_transit'));
        try { this.gs.notify(); } catch (_) {}
        return { arrived: Math.max(0, arrived) };
    }

    _deductMainStock(productId, qty) {
        // 主店=现有线上库存（warehouse FIFO）。优先走 createOutboundOrder 保持单据一致
        try {
            if (this.gs.warehouse && typeof this.gs.warehouse.createOutboundOrder === 'function') {
                const r = this.gs.warehouse.createOutboundOrder('transfer', [
                    { productId, quantity: qty, qualityGrade: 'B' }
                ], '店铺调拨出库');
                if (r && (r.success || r.order)) return true;
            }
        } catch (_) {}
        // 兜底：直接从 state.inventory 扣
        try {
            const inv = this.gs.state.inventory || [];
            let left = qty;
            for (let i = 0; i < inv.length && left > 0; i++) {
                const it = inv[i];
                if (!it || it.productId !== productId || it.quantity <= 0) continue;
                const take = Math.min(it.quantity, left);
                it.quantity -= take;
                left -= take;
            }
            return left === 0;
        } catch (_) { return false; }
    }

    // ==================== 阶段B：渠道店独立日结 ====================

    /** 渠道店日结：逐店逐品按销量公式出单 → 扣店铺库存 → 收入入账 → 统计 */
    settleChannelShops(now) {
        this._ensureState();
        const t = now || this.gs.state.gameTime || { day: 1, hour: 0 };
            const shops = this.getChannelShops();
        if (!shops.length) return { settled: 0, income: 0 };
        let settled = 0, income = 0;
        const PRODS = (typeof PRODUCTS !== 'undefined') ? PRODUCTS : [];
        for (let s = 0; s < shops.length; s++) {
            const shop = shops[s];
            this._initOfflineFields(shop);
            if (!shop || !shop.inventory) continue;
            const inv = shop.inventory;
            const shopStats = this._ensureShopStats(shop);
            // 该店今日统计已结算过（防 onNewDay 重复）
            if (shopStats.lastSettleDay === t.day) continue;
            // 员工加成（P0-1）
            const staffBonus = this._staffBonus(shop);
            // 促销折扣（P0-2）：折价换量
            const promoActive = this._promotionActive(shop, t.day);
            const promoRate = promoActive ? (shop.promotion.discountRate || 0) : 0;
            const promoDemandMul = promoActive ? (1 + promoRate * 2.2) : 1; // 折扣放大需求
            // 外卖配送时效（P1-3）：距离越远销量越低/声誉影响
            const deliveryFactor = (shop.type === 'delivery') ? this._deliveryOpsFactor(shop) : 1;
            const retailFactor = (shop.type === 'retail') ? this._retailOpsFactor(shop) : 1;
            // 多平台特性:抖音开播日客流暴涨
            const platformMul = this._platformTrafficBonus(shop, t);
            // 阶段D：即时需求加成（食品外卖+15%/体验零售+10%/热销线上+10%）
            const pids = Object.keys(inv);
            let shopIncome = 0, shopUnits = 0;
            let refilled = 0;   // 共享库存自动补货件数（阶段C）
            // 阶段E：店铺装修客流加成
            const decorationBonus = this._decorationBonus(shop);
            for (let k = 0; k < pids.length; k++) {
                const pid = pids[k];
                const product = PRODS.find(p => p && p.id === pid);
                if (!product) continue;
                const instantBonus = this._instantDemandBonus(shop.type, product);
                const demandMul = staffBonus * promoDemandMul * deliveryFactor * retailFactor * instantBonus * platformMul * decorationBonus;
                // 阶段C-1/3：共享库存/前置仓 → 缺货自动从总仓即时补足（至少够当天需求）
                let qty = Number(inv[pid]) || 0;
                if (shop.shareInventory && qty < 5) {
                    const want = Math.max(20, Math.ceil(this._calcChannelDemand(shop, product, 999999, demandMul)));
                    refilled += this._autoRefillFromMain(shop, product, want);
                    qty = Number(inv[pid]) || 0;
                }
                if (qty <= 0) { delete inv[pid]; continue; }
                const sold = this._calcChannelDemand(shop, product, qty, demandMul);
                if (sold <= 0) continue;
                inv[pid] = qty - sold;
                if (inv[pid] <= 0) delete inv[pid];
                // 促销折价后的实收单价
                let price = this.getShopPrice(shop, product);
                if (promoActive) price = Math.round(price * (1 - promoRate) * 100) / 100;
                const rev = Math.round(price * sold * 100) / 100;
                shopIncome += rev;
                shopUnits += sold;
                settled += sold;
            }
            // 阶段C-2：零售店自提连带购买（额外客流收入）
            let pickupUnits = 0, pickupIncome = 0;
            if (shop.type === 'retail' && shopUnits > 0) {
                pickupUnits = this._pickupSpillover(shop, shopUnits);
                if (pickupUnits > 0) {
                    // 连带购买按当日平均单价计
                    const avgPrice = shopIncome / Math.max(1, shopUnits);
                    pickupIncome = Math.round(avgPrice * pickupUnits * 0.6 * 100) / 100; // 连带客单价较低
                    shopIncome += pickupIncome;
                    shopUnits += pickupUnits;
                    settled += pickupUnits;
                    if (!shopStats.pickupOrders) shopStats.pickupOrders = 0;
                    shopStats.pickupOrders += pickupUnits;
                }
            }
            // 阶段D：成本扣除（平台抽成/租金日摊/外卖配送费）
            const costs = this._calcChannelCosts(shop, shopIncome, shopUnits, t);
            const netIncome = Math.round((shopIncome - costs.total) * 100) / 100;
            if (netIncome > 0) {
                if (typeof this.gs.addFunds === 'function') {
                    this.gs.addFunds(netIncome, `门店收入（${shop.name}）`);
                }
                income += netIncome;
            } else if (costs.total > 0) {
                // 收入不足以覆盖成本：净成本从资金扣（亏本经营）
                const deficit = Math.min(Math.abs(netIncome), 0) * -1;
                if (deficit > 0 && typeof this.gs.spendFunds === 'function') {
                    this.gs.spendFunds(deficit, `门店运营成本（${shop.name}）`);
                }
            }
            shopStats.lastSettleDay = t.day;
            shopStats.todaySales = shopUnits;
            shopStats.todayIncome = shopIncome;
            shopStats.todayCost = costs.total; // 平台抽成+租金日摊+配送费
            shopStats.todayNet = netIncome;
            shopStats.todayPlatform = costs.platform;
            shopStats.todayDelivery = costs.delivery;
            shopStats.todayRent = costs.rent;
            if (shopStats.totalSales == null) shopStats.totalSales = 0;
            if (shopStats.totalIncome == null) shopStats.totalIncome = 0;
            shopStats.totalSales += shopUnits;
            shopStats.totalIncome += Math.max(0, netIncome);
            if (refilled > 0) shopStats.todayRefilled = refilled;
            // P1-1：日史（财报图表用）
            if (!shopStats.dailyHistory) shopStats.dailyHistory = [];
            shopStats.dailyHistory.push({ day: t.day, sales: shopUnits, income: netIncome });
            if (shopStats.dailyHistory.length > 30) shopStats.dailyHistory = shopStats.dailyHistory.slice(-30);
            // 促销过期清理
            if (shop.promotion && !promoActive) shop.promotion = null;
            // 信誉随销售微涨（0~100，封顶2/日）
            shop.reputation = Math.min(100, shop.reputation + Math.min(2, shopUnits));
            if (shop.type === 'retail' && shop.retail) {
                shop.retail.members = Math.min(9999, (shop.retail.members || 0) + Math.min(8, Math.floor(shopUnits / 12)));
            }
            if (shop.type === 'delivery' && shop.delivery) {
                const staffN = (shop.staff && shop.staff.length) || 0;
                const drift = staffN > 0 ? (0.02 + Math.random() * 0.03) : -(0.04 + Math.random() * 0.04);
                shop.delivery.rating = Math.max(3.2, Math.min(5, Math.round(((shop.delivery.rating || 4.5) + drift) * 100) / 100));
            }
        }
        try { this.gs.notify(); } catch (_) {}
        return { settled, income };
    }

    _ensureShopStats(shop) {
        if (!shop.stats) shop.stats = {
            todaySales: 0, todayIncome: 0, todayCost: 0,
            totalSales: 0, totalIncome: 0, lastSettleDay: 0, dailyHistory: []
        };
        return shop.stats;
    }

    _retailOpsFactor(shop) {
        this._initOfflineFields(shop);
        const venue = (typeof RETAIL_VENUE_BY_ID !== 'undefined' && shop.retail)
            ? RETAIL_VENUE_BY_ID[shop.retail.venue] : null;
        let mul = venue && venue.ticketMul ? venue.ticketMul : 1;
        const staffN = (shop.staff && shop.staff.length) || 0;
        if (staffN <= 0) mul *= 0.55;
        const members = (shop.retail && shop.retail.members) || 0;
        mul *= 1 + Math.min(0.25, members / 800);
        return mul;
    }

    _deliveryOpsFactor(shop) {
        this._initOfflineFields(shop);
        if (shop.delivery && shop.delivery.kitchenOpen === false) return 0;
        let mul = this._deliveryFactor(shop);
        const plat = (typeof DELIVERY_PLATFORM_BY_ID !== 'undefined' && shop.delivery)
            ? DELIVERY_PLATFORM_BY_ID[shop.delivery.platform] : null;
        if (plat) mul *= plat.trafficMul || 1;
        const rating = (shop.delivery && Number(shop.delivery.rating)) || 4.5;
        mul *= 0.7 + Math.min(0.45, (rating - 3.5) * 0.3);
        const km = (shop.delivery && Number(shop.delivery.radiusKm)) || 3;
        mul *= 0.75 + Math.min(0.4, km / 10);
        const staffN = (shop.staff && shop.staff.length) || 0;
        if (staffN <= 0) mul *= 0.4;
        return mul;
    }

    /** P1-3：外卖配送时效系数：距总仓越远，配送慢→销量降（0.7~1.0） */
    _deliveryFactor(shop) {
        try {
            const mainShop = this.getShops().find(s => s && s.isMain);
            const fromCity = mainShop ? mainShop.location : this._getWarehouseCityName();
            const toCity = shop.location || fromCity;
            if (typeof getCityDistance === 'function') {
                const dist = getCityDistance(fromCity, toCity);
                if (typeof dist === 'number' && dist > 0) {
                    // 距离0-5000km → 系数1.0→0.7
                    return Math.max(0.7, 1 - dist / 20000);
                }
            }
            // 跨区域距离未知：按区域判断
            return this._getRegion(fromCity) === shop.region ? 1 : 0.85;
        } catch (_) { return 1; }
    }

    /** 多平台特性流量加成:抖音开播日客流 ×1.5(与直播模块联动) */
    _platformTrafficBonus(shop, now) {
        try {
            if (shop.type !== 'douyin') return 1;
            const live = this.gs.state.livestream;
            // 直播状态:直播中 or 当日已开播(活跃窗口)都给内容流量
            if (live && (live.isLive || (live.lastLiveDay && live.lastLiveDay === (now && now.day)))) return 1.5;
        } catch (_) {}
        return 1;
    }

    /**
     * 渠道店单日需求量（阶段B公式，可参数化调平衡）
     * 基础需求 = 店流量/100 件/日 × 渠道适配系数 × 价格弹性 × 声誉系数 × 库存充足 × 随机 × 附加系数(员工/促销/配送/平台)
     * 多平台:拼多多弹性 1.8(低价走量),抖音 1.2(内容种草价格不敏感)
     */
    _calcChannelDemand(shop, product, stock, extraMul) {
        const traffic = Number(shop.traffic) || 400;
        const baseDemand = traffic / 100;                 // 基础日需求（流量400 → 4件/日）
        const fit = this._channelFit(shop.type, product);
        const priceRatio = this.getShopPrice(shop, product) / (product.basePrice || 1);
        const E = (typeof SHOP_ELASTICITY !== 'undefined') ? SHOP_ELASTICITY : {};
        const elasticity = (typeof E[shop.type] === 'number' && E[shop.type] > 0) ? E[shop.type] : 1.5;
        const priceFactor = Math.pow(1 / priceRatio, elasticity); // (标准价/售价)^弹性
        const reputationFactor = 0.5 + (Number(shop.reputation) || 50) / 200;
        const stockFactor = Math.min(1, stock / Math.max(1, baseDemand * fit));
        const randomFactor = 0.8 + Math.random() * 0.4;
        const extra = (typeof extraMul === 'number' && extraMul > 0) ? extraMul : 1;
        const demand = Math.floor(baseDemand * fit * priceFactor * reputationFactor * stockFactor * randomFactor * extra);
        return Math.max(0, Math.min(demand, stock));
    }

    _channelFit(shopType, product) {
        const CF = (typeof SHOP_CHANNEL_FIT !== 'undefined') ? SHOP_CHANNEL_FIT : null;
        if (!CF || !product || !product.category) return 1;
        const cat = String(product.category).toLowerCase();
        const row = CF[cat] || CF.default || null;
        if (!row) return 1;
        const v = row[shopType];
        return (typeof v === 'number' && v > 0) ? v : 1;
    }

    /** 调拨/日结状态汇总（UI + 调试） */
    channelReport() {
        this._ensureState();
        const shops = this.getChannelShops();
        const pending = this.getPendingTransfers().length;
        return {
            shopCount: shops.length,
            pendingTransfers: pending,
            totalIncome: shops.reduce((s, sh) => s + ((sh.stats && sh.stats.totalIncome) || 0), 0),
            totalSales: shops.reduce((s, sh) => s + ((sh.stats && sh.stats.totalSales) || 0), 0)
        };
    }

    /** P0-3：一键调拨推荐量（按店铺近7天平均日销 × 7 天安全库存，扣当前库存） */
    getRecommendTransferQty(shopId, productId) {
        this._ensureState();
        const shop = this.getShopById(shopId);
        if (!shop) return { success: false, message: '店铺不存在' };
        const cur = Number((shop.inventory || {})[productId]) || 0;
        const hist = (shop.stats && shop.stats.dailyHistory) || [];
        // 该商品最近 7 天的销量近似：用店铺日总销按商品占比估算（简化：用店日均销×适配系数）
        let dailyAvg = 0;
        const recent = hist.slice(-7);
        if (recent.length) {
            dailyAvg = recent.reduce((a, d) => a + (d.sales || 0), 0) / recent.length;
        } else {
            dailyAvg = (Number(shop.traffic) || 400) / 100; // 无历史时用基础需求
        }
        const product = (typeof PRODUCTS !== 'undefined') ? PRODUCTS.find(p => p && p.id === productId) : null;
        const fit = this._channelFit(shop.type, product) || 1;
        const target = Math.max(10, Math.ceil(dailyAvg * fit * 7));
        const need = Math.max(0, target - cur);
        return { success: true, recommend: need, current: cur, target };
    }
}

// ==================== 导出兼容（浏览器全局 + Node 测试） ====================
if (typeof window !== 'undefined') {
    window.ShopsState = ShopsState;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ShopsState };
}
