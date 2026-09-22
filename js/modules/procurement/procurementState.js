/**
 * 采购中心模块（V2 重制）- 状态与核心业务
 * 数据归属：商品进货/采购订单沿用 gameState.state（purchaseOrders 等，存档兼容）；
 *           采购员/采购计划/包装材料继续由仓储模块（warehouseState）托管；
 *           采购中心附加状态（智能推荐快照/一键采购记录）挂在 gameState.state.procurementModule。
 */
class ProcurementState {
    constructor(gameState) {
        this.gameState = gameState;
        this.state = null;
    }

    init(gameState) {
        if (gameState) this.gameState = gameState;
        const gs = this.gameState.state;
        if (!gs.procurementModule || typeof gs.procurementModule !== 'object') {
            gs.procurementModule = getProcurementModuleDefaults();
        }
        this.state = gs.procurementModule;
        this.ensureDefaults();
        return this.state;
    }

    ensureDefaults() {
        const d = getProcurementModuleDefaults();
        const s = this.state;
        if (s.version == null) s.version = d.version;
        if (!s.settings || typeof s.settings !== 'object') s.settings = JSON.parse(JSON.stringify(d.settings));
        else if (s.settings.autoRefresh == null) s.settings.autoRefresh = true;
        if (!Array.isArray(s.quickBuyLog)) s.quickBuyLog = [];
        if (s.smartSnapshot && typeof s.smartSnapshot !== 'object') s.smartSnapshot = null;
        if (s.lastRefreshDay == null) s.lastRefreshDay = 0;
    }

    _save() {
        try {
            if (this.gameState && typeof this.gameState.saveDebounced === 'function') {
                this.gameState.saveDebounced();
            }
        } catch (_) {}
    }

    /** 仓储模块实例（采购员/计划/包材数据源） */
    getWarehouse() {
        try {
            if (this.gameState && this.gameState.warehouse) return this.gameState.warehouse;
            if (typeof window !== 'undefined' && window.warehouseState) return window.warehouseState;
        } catch (_) {}
        return null;
    }

    // ==================== 智能采购推荐 ====================
    /** 各商品库存总量（仓储批次为库存真值） */
    getStockMap() {
        const map = {};
        const wh = this.getWarehouse();
        const src = (wh && Array.isArray(wh.state && wh.state.batches)) ? wh.state.batches : [];
        src.forEach(b => {
            if (!b || !b.productId) return;
            if (!map[b.productId]) map[b.productId] = { qty: 0, totalCost: 0 };
            const q = Math.max(0, Number(b.quantity) || 0);
            map[b.productId].qty += q;
            map[b.productId].totalCost += q * (Number(b.costPrice) || 0);
        });
        Object.keys(map).forEach(k => {
            map[k].avgCost = map[k].qty > 0 ? map[k].totalCost / map[k].qty : 0;
        });
        return map;
    }

    /** 近 N 天销量 + 当前未完成订单（按商品汇总） */
    getSalesVelocity(days = SMART_REC_CONFIG.salesWindowDays) {
        const day = (this.gameState.state.gameTime && this.gameState.state.gameTime.day) || 1;
        const fromDay = Math.max(1, day - days + 1);
        const vel = {};
        const pending = {};
        (this.gameState.state.orders || []).forEach(o => {
            if (!o || !o.productId) return;
            const d = (o.createTime && o.createTime.day) || 0;
            if (d >= fromDay && o.status !== 'cancelled') {
                const q = Math.max(0, Number(o.quantity) || 1);
                vel[o.productId] = (vel[o.productId] || 0) + q;
            }
            if (o.status && o.status !== 'cancelled' && o.status !== 'completed' && o.status !== 'delivered') {
                const q = Math.max(0, Number(o.quantity) || 1);
                pending[o.productId] = (pending[o.productId] || 0) + q;
            }
        });
        return { vel, pending, windowDays: days, fromDay };
    }

    /** 各商品最低在售价 */
    getListingPriceMap() {
        const map = {};
        (this.gameState.state.listings || []).forEach(l => {
            if (!l || l.status !== 'active' || !l.productId) return;
            const p = Number(l.price);
            if (!(p > 0)) return;
            if (!(map[l.productId] > 0) || p < map[l.productId]) map[l.productId] = p;
        });
        return map;
    }

    /** 仓库空位：总额度 − 已占用 − 在途采购（到货会占仓） */
    getWarehouseSlotInfo() {
        let capacity = 0;
        let used = 0;
        try {
            const wh = this.getWarehouse();
            if (wh && typeof wh.getCapacity === 'function') capacity = Number(wh.getCapacity()) || 0;
            if (wh && typeof wh.getUsedCapacity === 'function') used = Number(wh.getUsedCapacity()) || 0;
        } catch (_) {}
        if (!(capacity > 0)) {
            try {
                if (this.gameState && typeof this.gameState.getWarehouseCapacity === 'function') {
                    capacity = Number(this.gameState.getWarehouseCapacity()) || 0;
                } else if (this.gameState && this.gameState.state && this.gameState.state.warehouse) {
                    capacity = Number(this.gameState.state.warehouse.capacity) || 0;
                }
            } catch (_) {}
        }
        if (!(used >= 0) || used === 0) {
            try {
                if (this.gameState && typeof this.gameState.getUsedCapacity === 'function') {
                    const u = Number(this.gameState.getUsedCapacity());
                    if (u > 0) used = u;
                }
            } catch (_) {}
        }
        let inbound = 0;
        try {
            (this.gameState.state.purchaseOrders || []).forEach(o => {
                if (!o || o.status === 'received' || o.status === 'cancelled') return;
                inbound += Math.max(0, Number(o.quantity) || 0);
            });
        } catch (_) {}
        used = Math.max(0, used);
        inbound = Math.max(0, inbound);
        capacity = Math.max(0, capacity);
        const reserved = used + inbound;
        const free = Math.max(0, Math.floor(capacity - reserved));
        return { capacity, used, inbound, reserved, free };
    }

    /** 为品类挑选最优批发商（价格优先，其次品质） */
    pickBestSupplier(categoryId) {
        let suppliers = [];
        try {
            suppliers = (typeof SUPPLIERS !== 'undefined' && Array.isArray(SUPPLIERS)) ? SUPPLIERS : [];
            const shopLevel = (this.gameState.state.shop && this.gameState.state.shop.level) || 1;
            suppliers = suppliers.filter(s => s && s.unlockLevel <= shopLevel);
        } catch (_) { suppliers = []; }
        const matched = suppliers.filter(s => s && Array.isArray(s.categories) && s.categories.includes(categoryId));
        if (!matched.length) return null;
        matched.sort((a, b) => {
            if (a.priceMultiplier !== b.priceMultiplier) return a.priceMultiplier - b.priceMultiplier;
            return (b.qualityBase || 0) - (a.qualityBase || 0);
        });
        return matched[0];
    }

    /** 构建推荐快照（每日刷新一次；force 强制重算；当日快照为空时自动重算，避免空结果缓存一整天） */
    buildRecommendations(force = false) {
        const cfg = SMART_REC_CONFIG;
        const day = (this.gameState.state.gameTime && this.gameState.state.gameTime.day) || 1;
        const snap = this.state.smartSnapshot;
        const cachedEmpty = !snap || !Array.isArray(snap.items) || snap.items.length === 0;
        // 逻辑版本不匹配（旧算法生成的快照）→ 强制重算，避免用户看到几百块的小单
        const staleVersion = !snap || snap.logicVersion !== (cfg.logicVersion || 0);
        if (!force && snap && snap.day === day && this.state.lastRefreshDay === day && !cachedEmpty && !staleVersion) {
            return snap;
        }
        const stockMap = this.getStockMap();
        const priceMap = this.getListingPriceMap();
        const { vel, pending, windowDays } = this.getSalesVelocity(cfg.salesWindowDays);
        const lowStockSuggest = cfg.lowStockSuggest || 20;
        const slotInfo = this.getWarehouseSlotInfo();
        const freeSlots = slotInfo.free;
        // ===== 按用户现有资金限额：总预算 = 资金 × fundsRatio（仓容分配后再裁剪） =====
        const funds = Math.max(0, Number(this.gameState.state.shop && this.gameState.state.shop.funds) || 0);
        const budgetCap = Math.round(funds * (cfg.fundsRatio || 0.5) * 100) / 100;

        if (freeSlots <= 0) {
            const snapshot = {
                day,
                generatedAt: Date.now(),
                logicVersion: cfg.logicVersion || 0,
                funds,
                budgetCap,
                totalEstCost: 0,
                warehouse: slotInfo,
                warehouseFull: true,
                bundleMeta: null,
                items: []
            };
            this.state.smartSnapshot = snapshot;
            this.state.lastRefreshDay = day;
            this._save();
            return snapshot;
        }

        // ===== 候选池：全部商品（多商品随机选品，不只局限在架/有销量） =====
        const signalItems = [];  // 有信号的商品（有销量/未完成订单/在架低库存）
        const otherItems = [];   // 其余全部商品（每天随机补位，保证商品不单一）
        const shopLvForCatalog = (this.gameState.state.shop && this.gameState.state.shop.level) || 1;
        const allProductsRaw = (typeof PRODUCTS !== 'undefined' && Array.isArray(PRODUCTS)) ? PRODUCTS : [];
        const allProducts = allProductsRaw.filter(p => {
            if (typeof isProductUnlockedForShop === 'function') return isProductUnlockedForShop(p, shopLvForCatalog);
            return true;
        });
        for (let pi = 0; pi < allProducts.length; pi++) {
            const product = allProducts[pi];
            if (!product || !product.id) continue;
            const productId = product.id;
            const sold = vel[productId] || 0;
            const pend = pending[productId] || 0;
            const dailyVel = sold / Math.max(1, windowDays);
            const stock = (stockMap[productId] && stockMap[productId].qty) || 0;
            const listingPrice = priceMap[productId] || 0;
            const listed = listingPrice > 0;
            // 缺货预警：在架商品库存很低时，即使暂无销量也建议补货
            const lowStockWarn = listed && stock < lowStockSuggest;

            const supplier = this.pickBestSupplier(product.category);
            if (!supplier) continue;

            const grade = (Array.isArray(supplier.availableGrades) && supplier.availableGrades.length)
                ? supplier.availableGrades[0] : 'B';
            const gradeInfo = (typeof QUALITY_GRADES !== 'undefined' && QUALITY_GRADES[grade]) ? QUALITY_GRADES[grade] : { priceMultiplier: 1 };
            let unitPrice = product.basePrice * supplier.priceMultiplier * (gradeInfo.priceMultiplier || 1);
            try {
                if (this.gameState && typeof this.gameState.applyPurchaseUnitPrice === 'function') {
                    unitPrice = this.gameState.applyPurchaseUnitPrice(unitPrice, product.category);
                }
            } catch (_) {}

            // 建议量 = 日销量×安全天数 + 未完成订单×比例 − 现有库存（下限 0，预算放大时再补）
            const need = Math.max(dailyVel, listed ? cfg.minDailySales : 0) * cfg.safetyDays + pend * cfg.pendingWeight;
            let suggestQty = Math.max(0, Math.ceil(need - stock));
            if (lowStockWarn && suggestQty <= 0) {
                suggestQty = Math.max(supplier.minOrder || 1, lowStockSuggest * 3); // 缺货预警：至少补到预警线 3 倍
            }
            if (suggestQty > 0 && suggestQty < supplier.minOrder) suggestQty = supplier.minOrder;

            const margin = listingPrice > 0 ? (listingPrice - unitPrice) / listingPrice : 0;
            const stockCost = (stockMap[productId] && stockMap[productId].avgCost) || 0;
            const item = {
                productId,
                productName: product.name,
                icon: (product.icon || (typeof CATEGORIES !== 'undefined' && product.category && CATEGORIES.find(c => c.id === product.category) ? CATEGORIES.find(c => c.id === product.category).icon : '📦')),
                category: product.category,
                sold, pend, dailyVel: Math.round(dailyVel * 100) / 100,
                stock, stockCost,
                suggestQty,
                minOrder: supplier.minOrder || 1,
                supplierId: supplier.id,
                supplierName: supplier.name,
                grade,
                unitPrice: Math.round(unitPrice * 100) / 100,
                estCost: Math.round(Math.max(1, suggestQty) * unitPrice * 100) / 100,
                listingPrice,
                listed,
                margin: Math.round(margin * 1000) / 10,
                lowStockWarn,
                deliveryDays: (supplier.deliveryDays || 0) + (product.procurementDays || 0)
            };
            if (dailyVel > 0 || pend > 0 || lowStockWarn) signalItems.push(item);
            else otherItems.push(item);
        }

        // ===== 商品随机：信号商品按重要度优先入列（缺货预警>未完成订单>销量），其余名额从全商品池随机补位 =====
        const shuffleArr = (arr) => {
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
            }
            return arr;
        };
        signalItems.sort((a, b) => {
            if (!!a.lowStockWarn !== !!b.lowStockWarn) return a.lowStockWarn ? -1 : 1;
            if ((a.pend || 0) !== (b.pend || 0)) return (b.pend || 0) - (a.pend || 0);
            return (b.dailyVel || 0) - (a.dailyVel || 0);
        });
        shuffleArr(otherItems);
        const items = [];
        const signalTake = Math.min(signalItems.length, Math.max(2, Math.ceil(cfg.maxItems / 2)));
        items.push(...signalItems.slice(0, signalTake));
        items.push(...otherItems.slice(0, Math.max(0, cfg.maxItems - items.length)));
        if (items.length === 0) {
            // 极端兜底：全商品池无可用批发商时返回空
            items.push(...signalItems.slice(0, cfg.maxItems), ...otherItems.slice(0, cfg.maxItems - signalItems.length));
        }

        // ===== 推荐组合：整单 3~8 种商品（随机数量），打包购买享 9.6 折 =====
        const bundleMax = Math.max(cfg.bundleMinItems || 3, cfg.bundleMaxItems || 8);
        const bundleMin = Math.min(cfg.bundleMinItems || 3, bundleMax);
        let bundleCount = bundleMin + Math.floor(Math.random() * (bundleMax - bundleMin + 1));
        bundleCount = Math.max(1, Math.min(items.length, bundleCount));
        items.length = bundleCount;

        // 空位不够起订量时，从组合尾部减 SKU，直到总起订量能放进仓库
        while (items.length > 1) {
            const minNeed = items.reduce((s, it) => s + Math.max(1, it.minOrder || 1), 0);
            if (minNeed <= freeSlots) break;
            items.pop();
        }

        // ===== 数量优先按仓库空位分配（再按资金裁剪） =====
        const itemCount = items.length;
        const weights = items.map(it => {
            let w = 1;
            if (it.lowStockWarn) w += 8;
            w += Math.max(0, Number(it.pend) || 0);
            w += Math.max(0, Number(it.dailyVel) || 0) * 4;
            return w;
        });
        const weightSum = weights.reduce((a, b) => a + b, 0) || itemCount || 1;
        let remainSlots = freeSlots;
        items.forEach((it, i) => {
            const last = i === itemCount - 1;
            const minQty = Math.max(1, it.minOrder || 1);
            let share = last
                ? remainSlots
                : Math.floor(freeSlots * (weights[i] / weightSum));
            share = Math.max(minQty, share);
            share = Math.min(share, remainSlots);
            if (share < minQty) share = 0;
            // 有销量/缺货信号时保留需求量，但绝不超出分到的空位
            const needQty = Math.max(minQty, Math.floor(it.suggestQty || 0));
            it.suggestQty = share > 0 ? Math.min(Math.max(needQty, minQty), share) : 0;
            // 空位多且无强需求时，用空位把仓填起来（优先用掉空位）
            if (share > it.suggestQty && (it.lowStockWarn || it.dailyVel > 0 || it.pend > 0 || !it.listed)) {
                it.suggestQty = share;
            } else if (share > it.suggestQty) {
                it.suggestQty = share;
            }
            it.slotShare = share;
            it.warehouseTrimmed = (needQty > share && share > 0);
            remainSlots = Math.max(0, remainSlots - (it.suggestQty || 0));
            const unit = it.unitPrice;
            it.estCost = Math.round(Math.max(0, it.suggestQty) * unit * 100) / 100;
        });
        // 去掉分不到空位的项
        for (let i = items.length - 1; i >= 0; i--) {
            if (!(items[i].suggestQty > 0)) items.splice(i, 1);
        }

        // ===== 按现有资金分配预算：超预算的商品缩减数量或标记资金不足 =====
        let remainBudget = budgetCap;
        let totalEstCost = 0;
        items.forEach(it => {
            const unit = it.unitPrice;
            const minQty = Math.max(1, it.minOrder);
            const maxAffordable = unit > 0 ? Math.floor(remainBudget / unit) : 0;
            if (maxAffordable >= it.suggestQty) {
                it.estCost = Math.round(it.suggestQty * unit * 100) / 100;
            } else if (maxAffordable >= minQty) {
                it.suggestQty = maxAffordable;
                it.estCost = Math.round(maxAffordable * unit * 100) / 100;
                it.budgetTrimmed = true;
            } else {
                it.estCost = Math.round(it.suggestQty * unit * 100) / 100;
                it.budgetExceeded = true; // 连最低起订量都买不起
            }
            if (!it.budgetExceeded) remainBudget = Math.max(0, remainBudget - it.estCost);
            totalEstCost += it.estCost;
        });
        totalEstCost = Math.round(totalEstCost * 100) / 100;

        // ===== 兜底：在架商品都库存充足时，仍随机给出常规备货建议（保证每天都有推荐） =====
        if (items.length === 0) {
            const seen = new Set();
            const candidates = [];
            (this.gameState.state.listings || []).forEach(l => {
                if (!l || l.status !== 'active' || !l.productId || seen.has(l.productId)) return;
                seen.add(l.productId);
                const product = (typeof PRODUCTS !== 'undefined') ? (PRODUCTS.find(p => p && p.id === l.productId) || null) : null;
                if (!product) return;
                const supplier = this.pickBestSupplier(product.category);
                if (!supplier) return;
                const grade = (Array.isArray(supplier.availableGrades) && supplier.availableGrades.length)
                    ? supplier.availableGrades[0] : 'B';
                const gradeInfo = (typeof QUALITY_GRADES !== 'undefined' && QUALITY_GRADES[grade]) ? QUALITY_GRADES[grade] : { priceMultiplier: 1 };
                let unitPrice = product.basePrice * supplier.priceMultiplier * (gradeInfo.priceMultiplier || 1);
                try {
                    if (this.gameState && typeof this.gameState.applyPurchaseUnitPrice === 'function') {
                        unitPrice = this.gameState.applyPurchaseUnitPrice(unitPrice, product.category);
                    }
                } catch (_) {}
                const listingPrice = priceMap[l.productId] || 0;
                const margin = listingPrice > 0 ? (listingPrice - unitPrice) / listingPrice : 0;
                candidates.push({
                    productId: l.productId,
                    productName: product.name,
                    icon: (product.icon || '📦'),
                    category: product.category,
                    sold: 0, pend: 0, dailyVel: 0,
                    stock: (stockMap[l.productId] && stockMap[l.productId].qty) || 0,
                    stockCost: 0,
                    minOrder: supplier.minOrder || 1,
                    supplierId: supplier.id,
                    supplierName: supplier.name,
                    grade,
                    unitPrice: Math.round(unitPrice * 100) / 100,
                    listingPrice,
                    margin: Math.round(margin * 1000) / 10,
                    score: margin,
                    lowStockWarn: false,
                    routineTopUp: true,
                    deliveryDays: (supplier.deliveryDays || 0) + (product.procurementDays || 0)
                });
            });
            // 商品随机：兜底常规备货也随机选品
            for (let i = candidates.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                const tmp = candidates[i]; candidates[i] = candidates[j]; candidates[j] = tmp;
            }
            const pickCount = Math.min(3, cfg.maxItems, candidates.length);
            let remainSlots = freeSlots;
            const slotPerTopUp = pickCount > 0 ? Math.floor(freeSlots / pickCount) : 0;
            candidates.slice(0, pickCount).forEach(c => {
                const unit = c.unitPrice;
                const minQty = Math.max(1, c.minOrder);
                let qty = Math.max(minQty, slotPerTopUp);
                qty = Math.min(qty, remainSlots);
                if (qty < minQty) return;
                const maxAffordable = unit > 0 ? Math.floor(remainBudget / unit) : 0;
                if (maxAffordable < qty) {
                    if (maxAffordable >= minQty) { qty = maxAffordable; c.budgetTrimmed = true; }
                    else { qty = minQty; c.budgetExceeded = true; }
                }
                c.suggestQty = qty;
                c.warehouseTrimmed = qty < slotPerTopUp;
                c.estCost = Math.round(qty * unit * 100) / 100;
                if (!c.budgetExceeded) remainBudget = Math.max(0, remainBudget - c.estCost);
                remainSlots = Math.max(0, remainSlots - qty);
                totalEstCost = Math.round((totalEstCost + c.estCost) * 100) / 100;
                items.push(c);
            });
        }

        // ===== 组合打包价：整单 9.6 折（按可购买项计算） =====
        const discountRate = (cfg.bundleDiscount != null && cfg.bundleDiscount > 0 && cfg.bundleDiscount <= 1)
            ? cfg.bundleDiscount : 0.96;
        const buyable = items.filter(it => !it.budgetExceeded);
        const originalTotal = Math.round(buyable.reduce((s, it) => s + (it.estCost || 0), 0) * 100) / 100;
        buyable.forEach(it => {
            it.discountedSubtotal = Math.round((it.estCost || 0) * discountRate * 100) / 100;
        });
        const bundlePrice = Math.round(buyable.reduce((s, it) => s + it.discountedSubtotal, 0) * 100) / 100;
        const bundleMeta = {
            itemCount: buyable.length,
            discountRate,
            originalTotal,
            bundlePrice,
            savings: Math.round((originalTotal - bundlePrice) * 100) / 100
        };

        const snapshot = {
            day,
            generatedAt: Date.now(),
            logicVersion: cfg.logicVersion || 0,
            funds,
            budgetCap,
            totalEstCost,
            warehouse: slotInfo,
            warehouseFull: false,
            bundleMeta,
            items: items.slice(0, cfg.maxItems)
        };
        this.state.smartSnapshot = snapshot;
        this.state.lastRefreshDay = day;
        this._save();
        return snapshot;
    }

    /** 获取推荐（含新鲜度） */
    getRecommendations(force = false) {
        const snap = this.buildRecommendations(force);
        const day = (this.gameState.state.gameTime && this.gameState.state.gameTime.day) || 1;
        return { snapshot: snap, fresh: snap && snap.day === day };
    }

    // ==================== 供应商比价 ====================
    /**
     * 供应商比价：某商品在全部已解锁批发商处的有效采购价对比。
     * 有效价 = 基础批发价 × 品质系数 × 供应链关系价乘数（直采/独家）。
     */
    compareSuppliers(productId) {
        const product = (typeof PRODUCTS !== 'undefined' && Array.isArray(PRODUCTS))
            ? PRODUCTS.find(p => p && p.id === productId) : null;
        if (!product) return { success: false, message: '商品不存在' };
        const shopLevel = (this.gameState.state.shop && this.gameState.state.shop.level) || 1;
        const suppliers = (typeof SUPPLIERS !== 'undefined' && Array.isArray(SUPPLIERS))
            ? SUPPLIERS.filter(s => s && s.unlockLevel <= shopLevel && Array.isArray(s.categories) && s.categories.includes(product.category))
            : [];
        if (!suppliers.length) return { success: false, message: '当前无可用的批发商' };

        const rows = suppliers.map(s => {
            const grade = (Array.isArray(s.availableGrades) && s.availableGrades.length) ? s.availableGrades[0] : 'B';
            const gradeInfo = (typeof QUALITY_GRADES !== 'undefined' && QUALITY_GRADES[grade])
                ? QUALITY_GRADES[grade] : { priceMultiplier: 1, qualityBase: 70 };
            let baseUnit = product.basePrice * s.priceMultiplier * (gradeInfo.priceMultiplier || 1);
            try {
                if (this.gameState && typeof this.gameState.applyPurchaseUnitPrice === 'function') {
                    baseUnit = this.gameState.applyPurchaseUnitPrice(baseUnit, product.category);
                }
            } catch (_) {}
            const supplyMul = this._supplyMul(s.id);
            const effUnit = baseUnit * supplyMul;
            // 关系信息（供应链模块）
            let relation = null;
            try {
                const rel = this.gameState.state.supply && this.gameState.state.supply.relations
                    ? this.gameState.state.supply.relations[s.id] : null;
                if (rel) {
                    const tierInfo = (typeof SUPPLY_TIERS !== 'undefined' && Array.isArray(SUPPLY_TIERS))
                        ? (SUPPLY_TIERS.find(t => t.id === rel.tier) || SUPPLY_TIERS[0]) : null;
                    relation = {
                        points: rel.points || 0,
                        tier: tierInfo ? tierInfo.name : (rel.tier || '普通'),
                        direct: !!rel.direct,
                        exclusive: !!rel.exclusive,
                        creditDays: (rel.credit && rel.credit.days) || 0
                    };
                }
            } catch (_) {}
            return {
                supplierId: s.id,
                name: s.name,
                grade,
                qualityBase: s.qualityBase || 0,
                quality: Math.round((gradeInfo.qualityBase || 70) + (s.qualityBase || 0) * 0.3),
                baseUnit: Math.round(baseUnit * 100) / 100,
                effUnit: Math.round(effUnit * 100) / 100,
                supplyMul: Math.round(supplyMul * 100) / 100,
                deliveryDays: (s.deliveryDays || 0) + (product.procurementDays || 0),
                minOrder: s.minOrder || 1,
                unlockLevel: s.unlockLevel || 1,
                relation
            };
        });
        rows.sort((a, b) => a.effUnit - b.effUnit);
        const best = rows[0];
        const worst = rows[rows.length - 1];
        const maxSavings = best && worst ? Math.round((worst.effUnit - best.effUnit) * 100) / 100 : 0;
        return {
            success: true,
            productId: product.id,
            productName: product.name,
            icon: product.icon || '📦',
            category: product.category,
            rows,
            best: best ? best.supplierId : null,
            maxSavings
        };
    }

    // ==================== 供应链模块对接(默认关闭,无模块时全部返回原值) ====================

    /** 某供应商当前采购价乘数(直采/独家生效才 <1) */
    _supplyMul(supplierId) {
        try {
            if (typeof supplyState !== 'undefined' && supplyState && typeof supplyState.getEffectiveMultiplier === 'function') {
                return supplyState.getEffectiveMultiplier(supplierId);
            }
        } catch (_) {}
        return 1;
    }

    /** 某供应商当前是否走账期 */
    _useCredit(supplierId) {
        try {
            if (typeof supplyState !== 'undefined' && supplyState && typeof supplyState.shouldUseCredit === 'function') {
                return supplyState.shouldUseCredit(supplierId);
            }
        } catch (_) {}
        return false;
    }

    // ==================== 一键采购 ====================
    /** 数量阶梯折扣（与 uiManager._getPurchaseQtyDiscount 保持一致） */
    _qtyDiscount(qty) {
        const n = Math.max(0, parseInt(qty, 10) || 0);
        if (n >= 100000) return { rate: 0.85, label: '八五折' };
        if (n >= 50000) return { rate: 0.90, label: '九折' };
        if (n >= 10000) return { rate: 0.95, label: '九五折' };
        return { rate: 1, label: '' };
    }

    /**
     * 按推荐条目直接下单进货（扣款 + 生成采购订单，到货由 gameEngine 自动入库）
     * recId：推荐条目 productId 或快照下标；overrideQty 可选覆盖数量
     */
    quickBuy(recId, overrideQty = null) {
        const snap = this.state.smartSnapshot;
        if (!snap || !Array.isArray(snap.items)) {
            return { success: false, message: '推荐数据不存在，请先刷新推荐' };
        }
        let item = null;
        if (typeof recId === 'number' && snap.items[recId]) {
            item = snap.items[recId];
        } else {
            item = snap.items.find(it => it && it.productId === recId);
        }
        if (!item) return { success: false, message: '推荐条目不存在' };

        const supplier = (typeof SUPPLIERS !== 'undefined') ? SUPPLIERS.find(s => s && s.id === item.supplierId) : null;
        if (!supplier) return { success: false, message: '批发商已不可用' };

        let qty = Math.floor(Number(overrideQty) || item.suggestQty || 0);
        qty = Math.max(supplier.minOrder || 1, Math.min(20000000, qty));
        // ===== 仓容保护：不超过仓库剩余容量 =====
        try {
            const wh = this.getWarehouse();
            if (wh && typeof wh.getCapacity === 'function' && typeof wh.getUsedCapacity === 'function') {
                const free = Math.max(0, wh.getCapacity() - wh.getUsedCapacity());
                if (free < (supplier.minOrder || 1)) {
                    return { success: false, message: `仓库容量已满（剩余 ${free} 件），无法采购` };
                }
                if (qty > free) qty = free;
            }
        } catch (_) {}
        const disc = this._qtyDiscount(qty);
        const supplyMul = this._supplyMul(item.supplierId);
        let unitPrice = item.unitPrice * supplyMul;
        try {
            const prod = (typeof getProductById === 'function') ? getProductById(item.productId) : null;
            if (this.gameState && typeof this.gameState.applyPurchaseSpotVariance === 'function') {
                unitPrice = this.gameState.applyPurchaseSpotVariance(unitPrice, prod);
            }
        } catch (_) {}
        const paidUnit = Math.round(unitPrice * disc.rate * 100) / 100;
        const onCredit = this._useCredit(item.supplierId);
        // ===== 按现有资金限额：买不起起订量直接拒绝，否则数量降到资金可承受范围(账期赊购不限额) =====
        if (!onCredit) {
            const fundsNow = Math.max(0, Number(this.gameState.state.shop && this.gameState.state.shop.funds) || 0);
            const maxAfford = paidUnit > 0 ? Math.floor(fundsNow / paidUnit) : 0;
            if (maxAfford < (supplier.minOrder || 1)) {
                return { success: false, message: `资金不足：起订 ${supplier.minOrder} 件需 ¥${(paidUnit * (supplier.minOrder || 1)).toFixed(2)}，现有 ${formatMoney(fundsNow)}` };
            }
            if (qty > maxAfford) qty = maxAfford;
        }
        const totalCost = Math.round(unitPrice * qty * disc.rate * 100) / 100;
        const discNote = disc.rate < 1 ? ` · ${disc.label}` : '';
        const supplyNote = supplyMul < 1 ? ` · 供应链价×${supplyMul.toFixed(2)}` : '';

        if (onCredit) {
            try {
                if (typeof supplyState !== 'undefined' && supplyState && typeof supplyState.purchaseOnCredit === 'function') {
                    supplyState.purchaseOnCredit(item.supplierId, totalCost);
                }
            } catch (_) {}
        } else if (!this.gameState.spendFunds(totalCost, `一键采购 - ${item.productName} x${qty.toLocaleString('en-US')} (${item.grade}${discNote}${supplyNote})`)) {
            return { success: false, message: '资金不足，无法一键采购' };
        }

        try {
            this.gameState.addPurchaseOrder({
                productId: item.productId,
                supplierId: item.supplierId,
                productName: item.productName,
                quantity: qty,
                unitPrice: paidUnit,
                listUnitPrice: unitPrice,
                qtyDiscount: disc.rate,
                totalAmount: totalCost,
                quality: Math.min(100, Math.max(0, (typeof QUALITY_GRADES !== 'undefined' && QUALITY_GRADES[item.grade] ? QUALITY_GRADES[item.grade].qualityBase : 70) + (supplier.qualityBase || 0) * 0.3)),
                qualityGrade: item.grade,
                deliveryDays: item.deliveryDays
            });
        } catch (e) {
            console.error('[ProcurementState.quickBuy]', e);
            return { success: false, message: '下单异常：' + (e && e.message) };
        }

        const day = (this.gameState.state.gameTime && this.gameState.state.gameTime.day) || 1;
        this.state.quickBuyLog.unshift({
            id: 'qb_' + Date.now() + '_' + Math.floor(Math.random() * 1e4),
            productId: item.productId, productName: item.productName,
            quantity: qty, cost: totalCost, supplierName: item.supplierName, day
        });
        if (this.state.quickBuyLog.length > 100) this.state.quickBuyLog.length = 100;
        this._save();

        return {
            success: true,
            message: `✅ 一键采购成功：${item.productName} ×${qty.toLocaleString('en-US')}，花费 ${formatMoney(totalCost)}，预计第${day + item.deliveryDays}天到货`,
            totalCost, qty, deliveryDays: item.deliveryDays
        };
    }

    /**
     * 一键采购「推荐组合」：整单 3~8 种商品打包购买，享 9.6 折
     */
    quickBuyBundle() {
        const snap = this.state.smartSnapshot;
        if (!snap || !Array.isArray(snap.items) || !snap.items.length) {
            return { success: false, message: '暂无推荐组合，请先刷新推荐' };
        }
        const meta = snap.bundleMeta;
        const buyable = snap.items.filter(it => it && !it.budgetExceeded);
        if (!buyable.length) {
            return { success: false, message: '资金不足，连最低起订量都买不起' };
        }
        const fundsNow = Math.max(0, Number(this.gameState.state.shop && this.gameState.state.shop.funds) || 0);
        const discountRate = (meta && meta.discountRate) || 0.96;
        // 组合价 = 各项折后小计之和(供应链直采/独家价乘数一并生效,账目一致)
        let bundlePrice = 0;
        buyable.forEach(it => {
            const m = this._supplyMul(it.supplierId);
            it._supplyMul = m;
            it.discountedSubtotal = Math.round((it.estCost || 0) * m * discountRate * 100) / 100;
            bundlePrice += it.discountedSubtotal;
        });
        bundlePrice = Math.round(bundlePrice * 100) / 100;
        if (fundsNow < bundlePrice) {
            return { success: false, message: `资金不足：组合价 ${formatMoney(bundlePrice)}（9.6折），现有 ${formatMoney(fundsNow)}` };
        }
        // ===== 仓容保护：组合总件数不超过仓库剩余容量 =====
        let freeCap = Infinity;
        try {
            const wh = this.getWarehouse();
            if (wh && typeof wh.getCapacity === 'function' && typeof wh.getUsedCapacity === 'function') {
                freeCap = Math.max(0, wh.getCapacity() - wh.getUsedCapacity());
            }
        } catch (_) {}
        const totalQty = buyable.reduce((s, it) => s + (it.suggestQty || 0), 0);
        if (totalQty > freeCap) {
            return { success: false, message: `仓库剩余容量不足：组合共 ${totalQty.toLocaleString('en-US')} 件，剩余 ${freeCap.toLocaleString('en-US')} 件` };
        }

        if (!this.gameState.spendFunds(bundlePrice, `一键采购推荐组合（${buyable.length}种商品 · 9.6折）`)) {
            return { success: false, message: '资金不足，无法采购组合' };
        }

        const day = (this.gameState.state.gameTime && this.gameState.state.gameTime.day) || 1;
        let okCount = 0;
        buyable.forEach(it => {
            const supplier = (typeof SUPPLIERS !== 'undefined') ? SUPPLIERS.find(s => s && s.id === it.supplierId) : null;
            if (!supplier) return;
            try {
                const m = it._supplyMul || 1;
                this.gameState.addPurchaseOrder({
                    productId: it.productId,
                    supplierId: it.supplierId,
                    productName: it.productName,
                    quantity: it.suggestQty,
                    unitPrice: Math.round((it.unitPrice * m * discountRate) * 100) / 100,
                    listUnitPrice: Math.round((it.unitPrice * m) * 100) / 100,
                    qtyDiscount: discountRate,
                    totalAmount: it.discountedSubtotal,
                    quality: Math.min(100, Math.max(0, (typeof QUALITY_GRADES !== 'undefined' && QUALITY_GRADES[it.grade] ? QUALITY_GRADES[it.grade].qualityBase : 70) + (supplier.qualityBase || 0) * 0.3)),
                    qualityGrade: it.grade,
                    deliveryDays: it.deliveryDays,
                    source: 'smart_bundle'
                });
                okCount++;
                this.state.quickBuyLog.unshift({
                    id: 'qb_' + Date.now() + '_' + Math.floor(Math.random() * 1e4),
                    productId: it.productId, productName: it.productName,
                    quantity: it.suggestQty, cost: it.discountedSubtotal,
                    supplierName: it.supplierName, day, bundle: true
                });
            } catch (e) {
                console.error('[ProcurementState.quickBuyBundle]', e);
            }
        });
        if (this.state.quickBuyLog.length > 100) this.state.quickBuyLog.length = 100;
        this._save();

        const savings = Math.round((buyable.reduce((s, it) => s + (it.estCost || 0), 0) - bundlePrice) * 100) / 100;
        return {
            success: true,
            message: `✅ 推荐组合已下单：${okCount} 种商品共 ${buyable.reduce((s, it) => s + it.suggestQty, 0).toLocaleString('en-US')} 件，9.6折后 ${formatMoney(bundlePrice)}，省 ${formatMoney(savings)}`,
            bundlePrice, okCount, savings
        };
    }

    // ==================== 采购中心汇总（委托仓储模块） ====================
    getBuyersSummary() {
        const wh = this.getWarehouse();
        let buyers = [];
        try {
            buyers = (wh && typeof wh.getBuyers === 'function') ? wh.getBuyers() : [];
        } catch (_) {
            buyers = (wh && Array.isArray(wh.state && wh.state.buyers)) ? wh.state.buyers : [];
        }
        const active = buyers.filter(b => b && b.status === 'active');
        const totalPurchased = buyers.reduce((s, b) => s + (Number(b && b.totalPurchaseAmount) || 0), 0);
        const totalRebate = buyers.reduce((s, b) => s + (Number(b && b.totalRebate) || 0), 0);
        return { total: buyers.length, active: active.length, totalPurchased, totalRebate, buyers };
    }

    getPlansSummary() {
        const wh = this.getWarehouse();
        let plans = [];
        try {
            plans = (wh && typeof wh.getPlans === 'function') ? wh.getPlans()
                : (wh && typeof wh.getPurchasePlans === 'function') ? wh.getPurchasePlans()
                : [];
        } catch (_) {
            plans = (wh && Array.isArray(wh.state && wh.state.purchasePlans)) ? wh.state.purchasePlans : [];
        }
        const enabled = plans.filter(p => p && p.enabled !== false);
        const running = plans.filter(p => p && p._running);
        return { total: plans.length, enabled: enabled.length, running: running.length, plans };
    }

    getPackagingSummary() {
        const wh = this.getWarehouse();
        const mats = [];
        try {
            const cfg = (typeof PACKAGING_MATERIALS !== 'undefined') ? PACKAGING_MATERIALS : {};
            const stock = (wh && typeof wh.getPackagingMaterials === 'function')
                ? wh.getPackagingMaterials()
                : ((wh && wh.state && wh.state.packagingMaterials) || {});
            // 3.6 极简：只统计在用的核心材料（废弃材料 active=false 不再展示）
            const isActive = (id) => !cfg[id] || cfg[id].active !== false;
            Object.keys(stock).forEach(id => {
                if (!isActive(id)) return;
                const q = Number(stock[id]) || 0;
                const info = cfg[id] || {};
                mats.push({ id, name: info.name || id, unit: info.unit || '', icon: info.icon || '📦', threshold: info.lowStockThreshold || 0, qty: q });
            });
            Object.keys(cfg).forEach(id => {
                if (!isActive(id) || (id in (stock || {}))) return;
                const info = cfg[id] || {};
                mats.push({ id, name: info.name || id, unit: info.unit || '', icon: info.icon || '📦', threshold: info.lowStockThreshold || 0, qty: 0 });
            });
        } catch (_) {}
        mats.sort((a, b) => a.qty - b.qty);
        const lowCount = mats.filter(m => m.qty <= (m.threshold || 0)).length;
        return { mats: mats.slice(0, 12), lowCount, total: mats.length };
    }

    /** 在途采购订单统计 */
    getOrderStats() {
        const orders = (this.gameState.state.purchaseOrders || []).filter(Boolean);
        const inTransit = orders.filter(o => o.status === 'pending' || o.status === 'shipping');
        const inTransitQty = inTransit.reduce((s, o) => s + (Number(o.quantity) || 0), 0);
        const inTransitCost = inTransit.reduce((s, o) => s + (Number(o.totalAmount) || 0), 0);
        return { total: orders.length, inTransit: inTransit.length, inTransitQty, inTransitCost };
    }
}

// 导出兼容（浏览器全局 + Node 测试）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ProcurementState };
}
