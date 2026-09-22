/**
 * 仓储管理模块 - 状态管理与核心业务逻辑
 * 实现：入库、出库、盘点、库位、批次、预警、报表等完整功能
 */
class WarehouseState {
    constructor(gameState) {
        this.gameState = gameState;
        this.state = null;
        this.listeners = [];
    }

    // 初始化（兼容旧数据迁移）
    // 优先级：主存档数据(gameStateRef._pendingWarehouseData) > 旧独立localStorage > 默认+V1迁移
    init(gameStateRef) {
        // gameStateRef是GameState实例或state对象
        const savedState = gameStateRef && gameStateRef.state ? gameStateRef.state : gameStateRef;

        // 1. 优先使用主存档中的完整 warehouse 数据（来自 saveManager 加载）
        let whModuleData = null;
        let migratedFromOldKey = false;
        if (gameStateRef && gameStateRef._pendingWarehouseData) {
            try {
                // 深拷贝避免与存档对象共享引用
                whModuleData = JSON.parse(JSON.stringify(gameStateRef._pendingWarehouseData));
            } catch (e) { whModuleData = null; }
        }

        // 2. 若主存档无 warehouse 数据，回退到旧独立 localStorage（老档迁移）
        if (!whModuleData) {
            try {
                const raw = localStorage.getItem('ecommerce_sim_warehouse_v2');
                if (raw) {
                    whModuleData = JSON.parse(raw);
                    migratedFromOldKey = true; // 标记：来自旧独立存储，迁移后需清理
                }
            } catch (e) {}
        }

        if (whModuleData && whModuleData.version === 2) {
            // 使用保存的v2数据
            this.state = whModuleData;
        } else {
            // 3. 初始化新v2格式
            this.state = WarehouseData.getDefaultState();
            // 从旧gameState迁移数据
            if (savedState) {
                this.migrateFromV1(savedState);
            }
        }
        this.ensureDefaults();
        // ⭐ 初始化完成后：合并包装材料库存，并与 gameState 共享同一对象（杜绝显示为空/双写翻倍）
        this._syncPMFromGameState();
        this._syncPMToGameState();
        try {
            if (this.gameState && this.gameState.state && this.gameState.state.warehouse) {
                if (!this.gameState.state.warehouse.packagingMaterials) {
                    this.gameState.state.warehouse.packagingMaterials = this.state.packagingMaterials || {};
                }
                this.state.packagingMaterials = this.gameState.state.warehouse.packagingMaterials;
            }
        } catch (e) {}

        // 4. 老档迁移清理：若数据来自旧独立 localStorage，迁移成功后删除旧 key
        //    （后续由主存档统一持久化，不再独立存储）
        if (migratedFromOldKey) {
            try { localStorage.removeItem('ecommerce_sim_warehouse_v2'); } catch (e) {}
        }

        this.syncCapacityToGameState();
        this._saveToStorage();
        return this.state;
    }

    // 保存仓储数据：不再独立写 localStorage，委托主存档统一持久化
    _saveToStorage() {
        // 由 gameState.saveDebounced() 触发主存档保存（warehouse 数据已纳入主存档序列化）
        if (this.gameState && typeof this.gameState.saveDebounced === 'function') {
            this.gameState.saveDebounced();
        }
    }

    // 从v1旧格式迁移
    migrateFromV1(oldData) {
        if (oldData.warehouse) {
            this.state.level = oldData.warehouse.level || 1;
            this.state.packagingMaterials = oldData.warehouse.packagingMaterials || this.state.packagingMaterials;
            this.state.packagingLogs = oldData.warehouse.packagingLogs || [];
            this.state.thresholds.lowStockRatio = (oldData.warehouse.lowStockThreshold || 20) / 100;
        }
        // 迁移库存
        if (oldData.inventory && Array.isArray(oldData.inventory)) {
            const defaultLoc = this.state.locations.find(l => l.type === 'storage');
            oldData.inventory.forEach(item => {
                const batchId = WarehouseData.generateId('batch');
                this.state.batches.push({
                    id: batchId,
                    productId: item.productId,
                    quantity: item.quantity,
                    costPrice: item.costPrice,
                    qualityGrade: item.qualityGrade || 'B',
                    inboundDate: item.purchaseDay || 1,
                    expireDate: null,
                    status: 'normal',
                    supplier: item.supplier || null,
                    purchaseOrderId: item.purchaseOrderId || null
                });
                this.state.inventory.push({
                    id: WarehouseData.generateId('inv'),
                    productId: item.productId,
                    batchId: batchId,
                    locationId: defaultLoc ? defaultLoc.id : 'loc_store_1',
                    quantity: item.quantity,
                    qualityGrade: item.qualityGrade || 'B'
                });
            });
        }
        // 迁移日志
        if (oldData.warehouse && oldData.warehouse.logs) {
            this.state.logs = oldData.warehouse.logs.slice(-500);
        }
    }

    // 确保默认字段存在
    ensureDefaults() {
        const defaults = WarehouseData.getDefaultState();
        const ensureArrayField = (key) => {
            if (!Array.isArray(this.state[key])) this.state[key] = Array.isArray(defaults[key]) ? defaults[key].slice() : [];
        };
        Object.keys(defaults).forEach(key => {
            if (this.state[key] === undefined || this.state[key] === null) {
                this.state[key] = defaults[key];
            }
        });
        // 老存档升级：列表字段强制数组（兼容 null / 错类型）
        ensureArrayField('buyers');
        ensureArrayField('rebateRecords');
        ensureArrayField('purchasePlans');
        ensureArrayField('inboundOrders');
        ensureArrayField('outboundOrders');
        ensureArrayField('inventory');
        ensureArrayField('batches');
        ensureArrayField('locations');
        ensureArrayField('stocktakes');
        ensureArrayField('logs');
        // 员工管理招聘的「采购员」岗位 → 仓储采购员列表自动同步
        try { this.syncBuyersFromEmployees({ silent: true }); } catch (e) {}
        // 老计划无 scheduleType 且无 items：升级为每日在架补货，避免永远不执行
        try {
            (this.state.purchasePlans || []).forEach(p => {
                if (!p || p.scheduleType) return;
                if (Array.isArray(p.items) && p.items.length > 0) return;
                p.scheduleType = 'daily';
                p.scheduleHour = p.scheduleHour != null ? parseInt(p.scheduleHour, 10) : 8;
                p.scheduleDay = p.scheduleDay != null ? parseInt(p.scheduleDay, 10) : 1;
                p.planMode = p.planMode === 'direct' ? 'direct' : 'restock';
                p._targetScope = p._targetScope || 'all';
                p._maxFundRatio = p._maxFundRatio != null ? parseFloat(p._maxFundRatio) : 80;
                p.maxOrderValue = p.maxOrderValue != null ? parseFloat(p.maxOrderValue) : 0;
                if (p.maxOrderValue === 80000) p.maxOrderValue = 0;
                p.orderQuantityMultiplier = parseFloat(p.orderQuantityMultiplier) || 1.5;
                p.enabled = p.enabled !== false;
                if (!Array.isArray(p.targetProductIds)) p.targetProductIds = [];
                if (!Array.isArray(p.directItems)) p.directItems = [];
            });
        } catch (_) {}
        if (!this.state.locations || this.state.locations.length === 0) {
            this.state.locations = WarehouseData.getInitialLocations(this.state.level);
        }
        // 仓库等级不低于店铺等级，并刷新库位容量与等级仓容对齐
        try {
            const shopLv = (this.gameState && this.gameState.state && this.gameState.state.shop)
                ? (parseInt(this.gameState.state.shop.level, 10) || 1)
                : 1;
            this.ensureLevelAtLeast(shopLv, { silent: true });
        } catch (_) {
            this.syncLocationsToLevel();
        }
        // 确保包材字段完整（含打包用到的全部材料）
        try {
            if (typeof WarehouseData !== 'undefined' && WarehouseData.syncPackagingMaterialsFromGlobal) {
                WarehouseData.syncPackagingMaterialsFromGlobal();
            }
        } catch (e) {}
        const defaultMaterials = defaults.packagingMaterials || {};
        Object.keys(defaultMaterials).forEach(matId => {
            if (this.state.packagingMaterials[matId] === undefined) {
                this.state.packagingMaterials[matId] = defaultMaterials[matId];
            }
        });
        // 全局 PACKAGING_MATERIALS 新增键也补齐（默认 0，避免 UI 缺项）
        if (typeof PACKAGING_MATERIALS !== 'undefined' && PACKAGING_MATERIALS) {
            Object.keys(PACKAGING_MATERIALS).forEach(matId => {
                if (this.state.packagingMaterials[matId] === undefined) {
                    this.state.packagingMaterials[matId] = 0;
                }
            });
        }
        // 旧档 / 精简前冗余 SKU → 核心材料（合并库存）
        const aliasMap = (typeof PACKAGING_MATERIAL_ALIASES !== 'undefined' && PACKAGING_MATERIAL_ALIASES)
            ? PACKAGING_MATERIAL_ALIASES
            : {
                fragile_sticker: 'fragile_label',
                thank_you_card: 'gift_box',
                poly_bag: 'courier_bag'
            };
        Object.entries(aliasMap).forEach(([from, to]) => {
            if (!to || from === to) return;
            const fromQty = parseFloat(this.state.packagingMaterials[from] || 0);
            if (fromQty > 0) {
                this.state.packagingMaterials[to] = parseFloat(((this.state.packagingMaterials[to] || 0) + fromQty).toFixed(4));
                this.state.packagingMaterials[from] = 0;
            }
        });
    }

    // 通知更新
    notify() {
        this._saveToStorage();
        // ⭐ 每次状态变更通知时，自动同步包装材料库存回 gameState，避免两套存储不一致
        this._syncPMToGameState();
        this.listeners.forEach(cb => cb(this.state));
        if (this.gameState && this.gameState.notify) {
            this.gameState.notify();
        }
    }

    // 订阅更新
    subscribe(callback) {
        this.listeners.push(callback);
    }

    // 添加操作日志
    addLog(type, action, details = {}) {
        const log = {
            id: WarehouseData.generateId('log'),
            type,
            action,
            details,
            day: this.gameState?.state?.gameTime?.day || 1,
            hour: this.gameState?.state?.gameTime?.hour || 0,
            timestamp: Date.now()
        };
        this.state.logs.unshift(log);
        if (this.state.logs.length > 2000) {
            this.state.logs = this.state.logs.slice(0, 2000);
        }
    }

    // ==================== 仓库升级 ====================
    getLevelInfo() {
        return WarehouseData.levels.find(l => l.level === this.state.level) || WarehouseData.levels[0];
    }

    getCapacity() {
        let cap = this.getLevelInfo().capacity || 0;
        // 与 GameState.getWarehouseCapacity 对齐：计入城市初始仓容加成
        try {
            const bonus = this.gameState && this.gameState.state && this.gameState.state.warehouse
                ? (Number(this.gameState.state.warehouse.startCapacityBonus) || 0)
                : 0;
            if (bonus > 0) cap += bonus;
        } catch (_) {}
        return cap;
    }

    getUsedCapacity() {
        if (!this.state || !Array.isArray(this.state.inventory)) return 0;
        let sum = 0;
        for (let i = 0; i < this.state.inventory.length; i++) {
            const q = parseInt(this.state.inventory[i] && this.state.inventory[i].quantity, 10);
            if (q > 0) sum += q;
        }
        return sum;
    }

    /**
     * 计费口径的在仓件数 = 模块仓批件数 + 尚未纳入仓批的 _fallback 兜底库存。
     * 兜底库存是「已到货但仓容不足，暂存旧格式 gameState.inventory」的货（_unsellable），
     * 物理上同样占用仓库空间，不能既不算仓容也不收占用费（只用于计费，不改仓容判断）。
     */
    getBillableQuantity() {
        let qty = this.getUsedCapacity();
        try {
            const rows = (this.gameState && this.gameState.state && Array.isArray(this.gameState.state.inventory))
                ? this.gameState.state.inventory
                : null;
            if (rows) {
                for (let i = 0; i < rows.length; i++) {
                    const it = rows[i];
                    if (!it || it._fallback !== true) continue;
                    const q = parseInt(it.quantity, 10);
                    if (q > 0) qty += q;
                }
            }
        } catch (_) {}
        return qty;
    }

    /**
     * 仓库所在城市的每日房租附加（元/日）——对应搬仓页「房租 ¥X/日」那条城市特性。
     * 此前只显示不收费（startCapacity 接了、rentCost 没接），现按天计入仓储费。
     */
    getCityRentPerDay() {
        try {
            const cid = (this.gameState?.state?.warehouse?.city)
                || (this.gameState?.state?.shop?.city)
                || 'yiwu';
            const city = (typeof getCityById === 'function') ? getCityById(cid) : null;
            const cost = Number(city && city.effects && city.effects.rentCost);
            return isFinite(cost) && cost > 0 ? cost : 0;
        } catch (_) { return 0; }
    }

    /**
     * 把模块内等级/容量回写到 gameState.state.warehouse，避免个人中心/进货校验读到旧的 10000 仓容
     */
    syncCapacityToGameState() {
        try {
            if (!this.gameState || !this.gameState.state) return;
            if (!this.gameState.state.warehouse) this.gameState.state.warehouse = {};
            const wh = this.gameState.state.warehouse;
            const level = (this.state && this.state.level) || 1;
            const used = this.getUsedCapacity();
            const cap = this.getCapacity();
            wh.level = level;
            wh.capacity = cap;
            wh.used = used;
            wh.usedCapacity = used;
        } catch (_) {}
    }

    /**
     * 修复「有库存行但缺批次」的孤儿记录：补建 normal 批次，否则可售校验通过却 FIFO 出不了库。
     * 默认按游戏小时节流，避免爆单/跳天时每单全量扫描。
     * @param {boolean} [force=false]
     */
    repairOrphanInventory(force = false) {
        if (!this.state || !Array.isArray(this.state.inventory)) return 0;
        try {
            const gt = this.gameState?.state?.gameTime;
            const key = gt ? ((gt.day || 1) * 24 + (gt.hour || 0)) : 0;
            if (!force && this._lastOrphanRepairKey === key) return 0;
            this._lastOrphanRepairKey = key;
        } catch (_) {}
        let repaired = 0;
        const defaultLoc = (this.state.locations || []).find(l => l.type === 'storage') || (this.state.locations || [])[0];

        // 修复退货入库丢失的 productId（purchaseOrderId = return_<售后单id>）
        try {
            repaired += this.repairMissingProductIds() || 0;
        } catch (_) {}

        for (const inv of this.state.inventory) {
            if (!inv || !(inv.quantity > 0)) continue;
            const batch = (this.state.batches || []).find(b => b.id === inv.batchId);
            if (batch) {
                if (batch.status && batch.status !== 'normal') {
                    // 锁定/异常批次恢复为可售，避免旧货永久卡死
                    batch.status = 'normal';
                    repaired++;
                }
                continue;
            }
            const batchId = inv.batchId || WarehouseData.generateId('batch');
            inv.batchId = batchId;
            if (!inv.locationId && defaultLoc) inv.locationId = defaultLoc.id;
            let cost = parseFloat(inv.costPrice);
            if (!(cost > 0)) {
                cost = this._estimatePurchaseUnitCost(inv.productId, inv.qualityGrade || 'B');
            }
            this.state.batches.push({
                id: batchId,
                productId: inv.productId,
                quantity: inv.quantity,
                costPrice: cost > 0 ? cost : 1,
                qualityGrade: inv.qualityGrade || 'B',
                inboundDate: this.gameState?.state?.gameTime?.day || 1,
                expireDate: null,
                status: 'normal',
                supplier: inv.supplier || null,
                purchaseOrderId: inv.purchaseOrderId || null,
                _repairedOrphan: true
            });
            repaired++;
        }
        return repaired;
    }

    /**
     * 修复 productId 缺失/为字面量 "undefined" 的仓批与库存行。
     * 优先通过 purchaseOrderId「return_<售后单id>」回查售后单/原订单补全。
     */
    repairMissingProductIds() {
        const isBad = (pid) => {
            if (pid == null || pid === '') return true;
            const s = String(pid);
            return s === 'undefined' || s === 'null' || s === 'NaN';
        };
        const lookupProduct = (pid) => {
            if (isBad(pid)) return null;
            try {
                if (typeof getProductById === 'function') {
                    const p = getProductById(pid);
                    if (p) return p;
                }
            } catch (_) {}
            try {
                if (typeof PRODUCTS !== 'undefined' && Array.isArray(PRODUCTS)) {
                    return PRODUCTS.find(p => p && p.id === pid) || null;
                }
            } catch (_) {}
            return null;
        };
        const matchByName = (name) => {
            if (!name || typeof PRODUCTS === 'undefined' || !Array.isArray(PRODUCTS)) return null;
            const n = String(name).trim();
            if (!n || n === 'undefined') return null;
            const exact = PRODUCTS.find(p => p && p.name === n);
            if (exact) return exact;
            let best = null;
            for (const p of PRODUCTS) {
                if (!p || !p.name) continue;
                if (n.indexOf(p.name) >= 0) {
                    if (!best || p.name.length > best.name.length) best = p;
                }
            }
            return best;
        };
        const resolveFromReturnPo = (poId) => {
            if (!poId || typeof poId !== 'string' || poId.indexOf('return_') !== 0) return null;
            const retId = poId.slice('return_'.length);
            if (!retId) return null;
            const gs = this.gameState;
            const returns = gs && gs.state && gs.state.customerService && gs.state.customerService.returns;
            if (!Array.isArray(returns)) return null;
            const r = returns.find(x => x && x.id === retId);
            if (!r) return null;
            if (lookupProduct(r.productId)) return r.productId;
            try {
                if (r.orderId && Array.isArray(gs.state.orders)) {
                    const order = gs.state.orders.find(o => o && o.id === r.orderId);
                    if (order && lookupProduct(order.productId)) return order.productId;
                    if (order && order.listingId && Array.isArray(gs.state.listings)) {
                        const listing = gs.state.listings.find(l => l && l.id === order.listingId);
                        if (listing && lookupProduct(listing.productId)) return listing.productId;
                    }
                    const byOrderName = order && matchByName(order.productName);
                    if (byOrderName) return byOrderName.id;
                }
            } catch (_) {}
            const byName = matchByName(r.productName);
            return byName ? byName.id : null;
        };

        let fixed = 0;
        const batches = this.state.batches || [];
        for (const b of batches) {
            if (!b || !isBad(b.productId)) continue;
            const pid = resolveFromReturnPo(b.purchaseOrderId);
            if (!pid) continue;
            b.productId = pid;
            fixed++;
            // 同步同 batch 的库存行
            for (const inv of (this.state.inventory || [])) {
                if (inv && inv.batchId === b.id && isBad(inv.productId)) {
                    inv.productId = pid;
                }
            }
        }
        // 库存行自身带有 return_ PO 但批次已修好/缺失的情况
        for (const inv of (this.state.inventory || [])) {
            if (!inv || !isBad(inv.productId)) continue;
            const batch = batches.find(b => b && b.id === inv.batchId);
            if (batch && !isBad(batch.productId)) {
                inv.productId = batch.productId;
                fixed++;
                continue;
            }
            const pid = resolveFromReturnPo(inv.purchaseOrderId || (batch && batch.purchaseOrderId));
            if (!pid) continue;
            inv.productId = pid;
            if (batch) batch.productId = pid;
            fixed++;
        }
        // GameState 可售库存里的幽灵行（_fallback）
        try {
            const gsInv = this.gameState && this.gameState.state && this.gameState.state.inventory;
            if (Array.isArray(gsInv)) {
                for (const it of gsInv) {
                    if (!it || !isBad(it.productId)) continue;
                    const pid = resolveFromReturnPo(it.purchaseOrderId);
                    if (!pid) continue;
                    it.productId = pid;
                    fixed++;
                }
            }
        } catch (_) {}
        return fixed;
    }

    /**
     * 把 GameState 上的 _fallback 幽灵库存迁入真实仓批，使其可被 FIFO 销售消耗。
     */
    absorbFallbackInventory(fallbackItems) {
        if (!Array.isArray(fallbackItems) || !fallbackItems.length) return { absorbed: 0, remain: [] };
        this.repairOrphanInventory();
        const remain = [];
        let absorbed = 0;
        for (const fb of fallbackItems) {
            if (!fb || !(fb.quantity > 0) || !fb.productId) continue;
            const fbPid = String(fb.productId);
            if (fbPid === 'undefined' || fbPid === 'null' || fbPid === 'NaN') continue;
            const qty = parseInt(fb.quantity, 10) || 0;
            if (qty <= 0) continue;
            let cost = parseFloat(fb.costPrice);
            if (!(cost > 0)) cost = this._estimatePurchaseUnitCost(fb.productId, fb.qualityGrade || 'B');
            if (!(cost > 0)) cost = 1;
            // 仓容不足时尽量吸收部分数量
            const free = Math.max(0, this.getCapacity() - this.getUsedCapacity());
            const take = Math.min(qty, free);
            if (take <= 0) {
                remain.push({ ...fb });
                continue;
            }
            // 直接写入批次/库存行，避免走 createInboundOrder→sync 重入
            const batchId = WarehouseData.generateId('batch');
            const defaultLoc = (this.state.locations || []).find(l => l.type === 'storage') || (this.state.locations || [])[0];
            this.state.batches.push({
                id: batchId,
                productId: fb.productId,
                quantity: take,
                costPrice: cost,
                qualityGrade: fb.qualityGrade || 'B',
                inboundDate: this.gameState?.state?.gameTime?.day || 1,
                expireDate: null,
                status: 'normal',
                supplier: fb.supplierId || fb.supplier || null,
                purchaseOrderId: fb.purchaseOrderId || ('fallback_' + Date.now().toString(36)),
                _fromFallback: true
            });
            this.state.inventory.push({
                id: WarehouseData.generateId('inv'),
                productId: fb.productId,
                batchId,
                locationId: defaultLoc ? defaultLoc.id : null,
                quantity: take,
                qualityGrade: fb.qualityGrade || 'B'
            });
            absorbed += take;
            if (take < qty) remain.push({ ...fb, quantity: qty - take });
        }
        return { absorbed, remain };
    }

    getUsagePercent() {
        const cap = this.getCapacity();
        return cap > 0 ? Math.min(100, (this.getUsedCapacity() / cap * 100)) : 0;
    }

    canUpgrade() {
        const curLv = Math.max(1, parseInt(this.state && this.state.level, 10) || 1);
        const curLevel = WarehouseData.levels.find(l => l.level === curLv) || WarehouseData.levels[0];
        const nextLevel = WarehouseData.levels.find(l => l.level === curLv + 1);
        if (!nextLevel) return { can: false, reason: '已达最高等级' };
        const cost = Number(curLevel && curLevel.upgradeCost) || 0;
        if (cost <= 0) return { can: false, reason: '已达最高等级' };
        if (this.gameState.state.shop.funds < cost) {
            return { can: false, reason: '资金不足', cost };
        }
        return { can: true, nextLevel, cost };
    }

    /**
     * 按当前仓库等级刷新库位：补齐新解锁库位，并把已有库位容量同步到同等级仓容分配
     */
    syncLocationsToLevel() {
        if (!this.state) return;
        const level = Math.max(1, parseInt(this.state.level, 10) || 1);
        const template = WarehouseData.getInitialLocations(level);
        if (!Array.isArray(this.state.locations)) this.state.locations = [];
        const byId = new Map(this.state.locations.map(l => [l.id, l]));
        template.forEach(tpl => {
            const existing = byId.get(tpl.id);
            if (existing) {
                // 只升不降：避免旧档库存超过新公式时库位显示异常；升级后容量应跟上等级
                existing.capacity = Math.max(Number(existing.capacity) || 0, tpl.capacity);
                if (!existing.name) existing.name = tpl.name;
                if (!existing.code) existing.code = tpl.code;
                if (!existing.type) existing.type = tpl.type;
            } else {
                this.state.locations.push({ ...tpl });
            }
        });
    }

    /**
     * 保证仓库等级至少为 minLevel（店铺升级免费对齐同级仓容；不降级）
     * @param {number} minLevel
     * @param {{ silent?: boolean }} [opts]
     */
    ensureLevelAtLeast(minLevel, opts = {}) {
        if (!this.state) return { changed: false };
        const target = Math.max(1, parseInt(minLevel, 10) || 1);
        const maxLv = (WarehouseData.levels && WarehouseData.levels.length) || 20;
        const clamped = Math.min(target, maxLv);
        const oldLevel = Math.max(1, parseInt(this.state.level, 10) || 1);
        const wasAuto = !opts.silent;
        let changed = false;
        if (clamped > oldLevel) {
            this.state.level = clamped;
            changed = true;
            if (!opts.silent) {
                this.addLog('system', 'upgrade', {
                    fromLevel: oldLevel,
                    toLevel: clamped,
                    reason: 'align_shop_level'
                });
            }
        }
        this.syncLocationsToLevel();
        this.syncCapacityToGameState();
        // 免费对齐不再「静默涨价」：告知玩家月租已随等级上浮
        if (changed && wasAuto) {
            try {
                const info = this.getLevelInfo();
                const rent = (typeof WarehouseData !== 'undefined' && WarehouseData && typeof WarehouseData.getLevelRentInfo === 'function')
                    ? Number(WarehouseData.getLevelRentInfo(clamped).monthlyRent) || 0
                    : 0;
                const msg = `🏭 店铺升级带动仓库免费升至 Lv.${clamped} ${info.name}，月租 ${rent > 0 ? '¥' + rent.toLocaleString() + '/月' : '不变'}`;
                if (typeof eventBus !== 'undefined' && eventBus && eventBus.emit) {
                    eventBus.emit('toast:show', { message: msg, type: 'warning' });
                }
            } catch (_) {}
        }
        return { changed, level: this.state.level, fromLevel: oldLevel };
    }

    upgrade() {
        const check = this.canUpgrade();
        if (!check.can) return { success: false, message: check.reason };

        const nextLevel = check.nextLevel;
        if (!this.gameState.spendFunds(check.cost, `仓库升级到${nextLevel.name}`)) {
            return { success: false, message: '资金不足' };
        }

        const oldLevel = this.state.level;
        this.state.level = nextLevel.level;
        // 解锁新库位 + 刷新全部库位容量，使其与该等级总仓容一致
        this.syncLocationsToLevel();

        this.addLog('system', 'upgrade', { fromLevel: oldLevel, toLevel: nextLevel.level });
        this.syncCapacityToGameState();
        this.notify();
        // 通知主界面刷新九宫格容量（否则会继续显示升级前的 10000/10000）
        try {
            if (this.gameState && typeof this.gameState.notify === 'function') {
                this.gameState.notify();
            }
        } catch (_) {}
        return { success: true, message: `仓库升级到${nextLevel.name}！`, level: nextLevel.level };
    }

    // ==================== 库位管理 ====================
    getLocations() {
        return this.state.locations.map(loc => {
            const typeInfo = WarehouseData.locationTypes.find(t => t.id === loc.type);
            const used = this.state.inventory
                .filter(i => i.locationId === loc.id)
                .reduce((sum, i) => sum + i.quantity, 0);
            return {
                ...loc,
                typeInfo,
                used,
                usagePercent: loc.capacity > 0 ? Math.min(100, (used / loc.capacity * 100)) : 0,
                itemCount: this.state.inventory.filter(i => i.locationId === loc.id).length
            };
        });
    }

    addLocation(type, name, capacity) {
        const typeInfo = WarehouseData.locationTypes.find(t => t.id === type);
        if (!typeInfo) return { success: false, message: '无效的库位类型' };
        if (typeInfo.unlockLevel && this.state.level < typeInfo.unlockLevel) {
            return { success: false, message: `需要仓库Lv.${typeInfo.unlockLevel}才能解锁此类型库位` };
        }
        const locCode = `${type.substr(0, 3).toUpperCase()}-${String(this.state.locations.filter(l => l.type === type).length + 1).padStart(2, '0')}`;
        const newLoc = {
            id: WarehouseData.generateId('loc'),
            type,
            code: locCode,
            name: name || `${typeInfo.name}${this.state.locations.filter(l => l.type === type).length + 1}号位`,
            capacity: capacity || 50
        };
        this.state.locations.push(newLoc);
        this.addLog('location', 'add', { locationId: newLoc.id, name: newLoc.name });
        this.notify();
        return { success: true, location: newLoc };
    }

    // ==================== 批次管理 ====================
    getBatches(productId = null) {
        let batches = [...this.state.batches];
        if (productId) {
            batches = batches.filter(b => b.productId === productId);
        }
        return batches.map(batch => {
            const remaining = this.state.inventory
                .filter(i => i.batchId === batch.id)
                .reduce((sum, i) => sum + i.quantity, 0);
            return { ...batch, remaining, sold: batch.quantity - remaining };
        }).sort((a, b) => a.inboundDate - b.inboundDate);
    }

    getBatchById(batchId) {
        const batch = this.state.batches.find(b => b.id === batchId);
        if (!batch) return null;
        const remaining = this.state.inventory
            .filter(i => i.batchId === batchId)
            .reduce((sum, i) => sum + i.quantity, 0);
        return { ...batch, remaining };
    }

    lockBatch(batchId, reason = '') {
        const batch = this.state.batches.find(b => b.id === batchId);
        if (!batch) return { success: false, message: '批次不存在' };
        batch.status = 'locked';
        this.addLog('batch', 'lock', { batchId, reason });
        this.notify();
        return { success: true };
    }

    unlockBatch(batchId) {
        const batch = this.state.batches.find(b => b.id === batchId);
        if (!batch) return { success: false, message: '批次不存在' };
        batch.status = 'normal';
        this.addLog('batch', 'unlock', { batchId });
        this.notify();
        return { success: true };
    }

    // ==================== 库存查询 ====================
    getInventoryList(productId = null) {
        const productMap = new Map();
        this.state.inventory.forEach(inv => {
            if (productId && inv.productId !== productId) return;
            const key = inv.productId;
            if (!productMap.has(key)) {
                const batch = this.state.batches.find(b => b.id === inv.batchId);
                productMap.set(key, {
                    productId: inv.productId,
                    totalQuantity: 0,
                    totalValue: 0,
                    avgCost: 0,
                    batches: [],
                    locations: []
                });
            }
            const info = productMap.get(key);
            const batch = this.state.batches.find(b => b.id === inv.batchId);
            const loc = this.state.locations.find(l => l.id === inv.locationId);
            const cost = batch ? batch.costPrice : 0;
            info.totalQuantity += inv.quantity;
            info.totalValue += inv.quantity * cost;
            info.batches.push({ batchId: inv.batchId, quantity: inv.quantity, cost, quality: inv.qualityGrade });
            info.locations.push({ locationId: inv.locationId, locationName: loc ? loc.name : '未知', quantity: inv.quantity });
        });
        const result = [];
        productMap.forEach((info, pid) => {
            info.avgCost = info.totalQuantity > 0 ? info.totalValue / info.totalQuantity : 0;
            const product = typeof getProductById === 'function' ? getProductById(pid) : null;
            info.productName = product?.name || pid;
            info.category = product?.category || 'other';
            result.push(info);
        });
        return result.sort((a, b) => b.totalQuantity - a.totalQuantity);
    }

    getInventoryByProduct(productId) {
        return this.getInventoryList(productId)[0] || null;
    }

    getStockQuantity(productId, qualityGrade = null) {
        // 仅统计「有 normal 批次」的可售库存；缺批次的孤儿不计入（避免显示可卖却出不了库）
        // ===== 爆单性能：batchId→batch 一次性建 Map，避免每行 batches.find 的 O(库存×批次) =====
        const batchMap = new Map();
        const batches = this.state.batches || [];
        for (let b = 0, blen = batches.length; b < blen; b++) {
            const bt = batches[b];
            if (bt && bt.id != null) batchMap.set(bt.id, bt);
        }
        let sum = 0;
        const inv = this.state.inventory || [];
        for (let i = 0, len = inv.length; i < len; i++) {
            const it = inv[i];
            if (!it || it.productId !== productId) continue;
            if (qualityGrade && it.qualityGrade !== qualityGrade) continue;
            const batch = batchMap.get(it.batchId);
            if (!batch || batch.status !== 'normal') continue;
            sum += it.quantity;
        }
        return sum;
    }

    // ==================== 入库管理 ====================
    // options.extra.buyerId: 采购员ID（传入则按采购金额 × 0.001% 计算提成）
    createInboundOrder(type, items, remark = '', options = {}) {
        if (!items || items.length === 0) {
            return { success: false, message: '入库商品不能为空' };
        }
        const isValidPid = (pid) => {
            if (pid == null || pid === '') return false;
            const s = String(pid);
            return s !== 'undefined' && s !== 'null' && s !== 'NaN';
        };
        // 过滤无效 productId，并强制 quantity 为整数（避免仓容字符串拼接假爆仓）
        const sanitized = [];
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            if (!it || !isValidPid(it.productId)) continue;
            const qty = parseInt(it.quantity, 10);
            if (!(qty > 0)) continue;
            sanitized.push(Object.assign({}, it, { quantity: qty }));
        }
        if (sanitized.length === 0) {
            return { success: false, message: '入库商品缺少有效商品ID' };
        }
        if (sanitized.length < items.length) {
            try {
                console.warn('[createInboundOrder] 已丢弃无效行:', items.length - sanitized.length);
            } catch (_) {}
        }
        items = sanitized;
        const totalQty = items.reduce((sum, i) => sum + (parseInt(i.quantity, 10) || 0), 0);
        if (this.getUsedCapacity() + totalQty > this.getCapacity()) {
            return { success: false, message: '仓库容量不足' };
        }

        // 采购入库：单价必须 > 0（含已预付），禁止 0 元采购批次污染成本与自动采购价
        // 已预付仅认 options.prepaid / skipCharge（由进货单到货、采购计划等调用方显式标记）
        let totalValue = 0;
        items.forEach(item => {
            totalValue += (parseInt(item.quantity, 10) || 0) * (Number(item.costPrice) || 0);
        });
        totalValue = Math.round(totalValue * 100) / 100;
        const alreadyPaid = !!(options && (options.prepaid || options.skipCharge));
        let chargedHere = 0;
        if (type === 'purchase') {
            const hasInvalidUnit = (items || []).some(it => !(Number(it.costPrice) > 0));
            if (hasInvalidUnit || totalValue <= 0) {
                return { success: false, message: '采购单价必须大于0，无法免费入库' };
            }
            if (!alreadyPaid) {
                if (!this.gameState || typeof this.gameState.spendFunds !== 'function') {
                    return { success: false, message: '资金系统不可用，无法采购入库' };
                }
                if (!this.gameState.spendFunds(totalValue, remark || '仓储采购入库')) {
                    return { success: false, message: '资金不足，无法采购入库' };
                }
                chargedHere = totalValue;
            }
        }

        const orderId = WarehouseData.generateId('in');
        const inboundItems = [];
        const defaultLoc = (this.state.locations || []).find(l => l && l.type === 'storage')
            || (this.state.locations || [])[0]
            || { id: 'loc_store_1' };

        try {
        items.forEach(item => {
            const batchId = WarehouseData.generateId('batch');
            const locationId = item.locationId || defaultLoc.id || 'loc_store_1';
            let costPrice = parseFloat(item.costPrice);
            // 退货/盘点等非采购入库：若未带成本，回填估算成本，杜绝 0 元批次污染均价
            if (!(costPrice > 0) && type !== 'purchase') {
                costPrice = this._estimatePurchaseUnitCost(item.productId, item.qualityGrade || 'B');
            }
            if (!(costPrice > 0)) costPrice = 0;
            const qty = parseInt(item.quantity, 10) || 0;

            // 创建批次
            this.state.batches.push({
                id: batchId,
                productId: item.productId,
                quantity: qty,
                costPrice,
                qualityGrade: item.qualityGrade || 'B',
                inboundDate: this.gameState?.state?.gameTime?.day || 1,
                expireDate: item.expireDate || null,
                status: 'normal',
                supplier: item.supplier || null,
                purchaseOrderId: item.purchaseOrderId || null
            });

            // 创建库存记录
            this.state.inventory.push({
                id: WarehouseData.generateId('inv'),
                productId: item.productId,
                batchId,
                locationId,
                quantity: qty,
                qualityGrade: item.qualityGrade || 'B'
            });

            inboundItems.push({ ...item, quantity: qty, batchId, locationId });
        });

        // 创建入库单
        const order = {
            id: orderId,
            type,
            typeInfo: WarehouseData.inboundTypes.find(t => t.id === type),
            items: inboundItems,
            totalQty,
            totalValue: totalValue,
            remark,
            status: 'completed',
            day: this.gameState?.state?.gameTime?.day || 1,
            hour: this.gameState?.state?.gameTime?.hour || 0,
            timestamp: Date.now()
        };
        this.state.inboundOrders.unshift(order);
        if (this.state.inboundOrders.length > 500) {
            this.state.inboundOrders = this.state.inboundOrders.slice(0, 500);
        }

        // ========== 关联采购员提成：仅采购入库类型 + 指定了buyerId 才计算 ==========
        if (type === 'purchase' && options && options.buyerId) {
            const res = this._applyBuyerRebate(order, options.buyerId);
            if (res && !res.ok) {
                this.addLog('buyer', 'rebate_skip', { orderId, buyerId: options.buyerId, reason: res.reason });
            } else if (res) {
                this.addLog('buyer', 'rebate', { orderId, buyerId: options.buyerId, rebate: res.rebateTotal, amount: res.purchaseAmount });
            }
        }

        this.addLog('inbound', type, { orderId, totalQty, totalValue: order.totalValue });
        // 同步到 gameState.inventory，否则主引擎/上架读不到刚入库的货
        this._syncSellableInventory();
        try { this.syncCapacityToGameState(); } catch (_) {}
        this.notify();
        return { success: true, order, orderId, message: '入库成功' };
        } catch (e) {
            if (chargedHere > 0 && this.gameState && typeof this.gameState.addFunds === 'function') {
                try { this.gameState.addFunds(chargedHere, '[采购回退] 入库异常退款'); } catch (_) {}
            }
            console.error('[createInboundOrder] 写入失败:', e);
            return { success: false, message: '入库异常：' + (e && e.message ? e.message : String(e)) };
        }
    }

    /** 把仓储库存同步到 gameState.state.inventory（可售库存） */
    _syncSellableInventory() {
        try {
            if (!this.gameState) return;
            if (typeof this.gameState._syncInventoryFromWarehouse !== 'function') return;
            // 重入中：勿用旧 inventory 覆盖，标记脏等外层结束后再同步
            if (this.gameState._syncingInventory) {
                this.gameState._inventorySyncDirty = true;
                return;
            }
            const next = this.gameState._syncInventoryFromWarehouse();
            if (Array.isArray(next)) {
                this.gameState.state.inventory = next;
            }
        } catch (e) {
            console.warn('[warehouse] 同步可售库存失败:', e && e.message);
        }
    }

    // 采购入库（便捷方法）—— options 可传 buyerId / prepaid / skipCharge
    purchaseIn(productId, quantity, costPrice, purchaseOrderId = null, qualityGrade = 'B', options = {}) {
        try {
            const gs = this.gameState || (typeof gameState !== 'undefined' ? gameState : null);
            if (gs && typeof gs.isProductControlled === 'function') {
                const ban = gs.isProductControlled(productId, 'buy');
                if (ban) return { success: false, message: ban.reason || '该商品当前禁购' };
            }
        } catch (_) {}
        return this.createInboundOrder('purchase', [{
            productId, quantity, costPrice, qualityGrade, purchaseOrderId
        }], options.remark || '采购入库', {
            buyerId: options.buyerId || null,
            prepaid: !!options.prepaid,
            skipCharge: !!options.skipCharge
        });
    }

    // ==================== 出库管理 ====================
    createOutboundOrder(type, items, remark = '') {
        if (!items || items.length === 0) {
            return { success: false, message: '出库商品不能为空' };
        }

        // 出库前自愈：补建缺批次孤儿、恢复非 normal 旧货，避免「显示有货卖不动」
        try { this.repairOrphanInventory(); } catch (_) {}

        // 检查库存
        for (const item of items) {
            const available = this.getStockQuantity(item.productId, item.qualityGrade);
            if (available < item.quantity) {
                const product = typeof getProductById === 'function' ? getProductById(item.productId) : null;
                return {
                    success: false,
                    message: `商品「${product?.name || item.productId}」库存不足，需要${item.quantity}件，可用${available}件`
                };
            }
        }

        // 预演 FIFO：确保每项都能扣满，避免半扣半失败
        for (const item of items) {
            let remaining = item.quantity;
            const availableBatches = this.state.batches
                .filter(b => b.productId === item.productId && b.status === 'normal' && (!item.qualityGrade || b.qualityGrade === item.qualityGrade))
                .sort((a, b) => (a.inboundDate || 0) - (b.inboundDate || 0));
            for (const batch of availableBatches) {
                if (remaining <= 0) break;
                const invQty = this.state.inventory
                    .filter(i => i.batchId === batch.id)
                    .reduce((s, i) => s + (i.quantity || 0), 0);
                remaining -= Math.min(invQty, remaining);
            }
            if (remaining > 0) {
                const product = typeof getProductById === 'function' ? getProductById(item.productId) : null;
                return {
                    success: false,
                    message: `商品「${product?.name || item.productId}」可售批次不足，缺口 ${remaining} 件`
                };
            }
        }

        const orderId = WarehouseData.generateId('out');
        const outboundItems = [];
        let totalValue = 0;

        items.forEach(item => {
            let remaining = item.quantity;
            // FIFO: 按入库日期顺序出库
            const availableBatches = this.state.batches
                .filter(b => b.productId === item.productId && b.status === 'normal' && (!item.qualityGrade || b.qualityGrade === item.qualityGrade))
                .sort((a, b) => (a.inboundDate || 0) - (b.inboundDate || 0));

            for (const batch of availableBatches) {
                if (remaining <= 0) break;
                const invItems = this.state.inventory.filter(i => i.batchId === batch.id);
                for (const inv of invItems) {
                    if (remaining <= 0) break;
                    const takeQty = Math.min(inv.quantity, remaining);
                    inv.quantity -= takeQty;
                    // 同步扣减批次账面数量，避免批次 quantity 与库存行脱节
                    if (typeof batch.quantity === 'number') {
                        batch.quantity = Math.max(0, batch.quantity - takeQty);
                    }
                    remaining -= takeQty;
                    totalValue += takeQty * (parseFloat(batch.costPrice) || 0);
                    outboundItems.push({
                        productId: item.productId,
                        batchId: batch.id,
                        locationId: inv.locationId,
                        quantity: takeQty,
                        costPrice: batch.costPrice,
                        qualityGrade: batch.qualityGrade
                    });
                }
            }

            // 清理数量为0的库存记录
            this.state.inventory = this.state.inventory.filter(i => i.quantity > 0);
        });

        // 创建出库单
        const order = {
            id: orderId,
            type,
            typeInfo: WarehouseData.outboundTypes.find(t => t.id === type),
            items: outboundItems,
            totalQty: items.reduce((s, i) => s + i.quantity, 0),
            totalValue,
            remark,
            status: 'completed',
            day: this.gameState?.state?.gameTime?.day || 1,
            hour: this.gameState?.state?.gameTime?.hour || 0,
            timestamp: Date.now(),
            orderId: items[0]?.orderId || null
        };
        this.state.outboundOrders.unshift(order);
        if (this.state.outboundOrders.length > 500) {
            this.state.outboundOrders = this.state.outboundOrders.slice(0, 500);
        }

        this.addLog('outbound', type, { orderId, totalQty: order.totalQty, totalValue });
        try { this._syncSellableInventory(); } catch (_) {}
        this.notify();
        return { success: true, order, orderId };
    }

    // 销售出库（订单发货时调用）
    saleOut(productId, quantity, orderId = null, qualityGrade = 'B') {
        return this.createOutboundOrder('sale', [{
            productId, quantity, qualityGrade, orderId
        }], '订单销售出库');
    }

    // ==================== 库存盘点 ====================
    createStocktake(name = '', scope = 'all') {
        const id = WarehouseData.generateId('st');
        const items = [];

        let inventoryList = this.state.inventory;
        if (scope !== 'all') {
            const loc = this.state.locations.find(l => l.id === scope || l.type === scope);
            if (loc) {
                inventoryList = inventoryList.filter(i => i.locationId === loc.id);
            }
        }

        // 按商品+品质汇总账面数量
        const bookMap = new Map();
        inventoryList.forEach(inv => {
            const batch = this.state.batches.find(b => b.id === inv.batchId);
            const key = `${inv.productId}|${inv.qualityGrade}`;
            if (!bookMap.has(key)) {
                bookMap.set(key, {
                    productId: inv.productId,
                    qualityGrade: inv.qualityGrade,
                    bookQty: 0,
                    actualQty: null,
                    batchId: inv.batchId
                });
            }
            const entry = bookMap.get(key);
            entry.bookQty += inv.quantity;
        });

        bookMap.forEach(entry => items.push(entry));

        const stocktake = {
            id,
            name: name || `盘点单_${this.gameState?.state?.gameTime?.day || 1}`,
            scope,
            status: 'in_progress',
            items,
            createDay: this.gameState?.state?.gameTime?.day || 1,
            createHour: this.gameState?.state?.gameTime?.hour || 0,
            completeDay: null,
            profitQty: 0,
            lossQty: 0,
            profitValue: 0,
            lossValue: 0
        };
        this.state.stocktakes.unshift(stocktake);
        this.addLog('stocktake', 'create', { stocktakeId: id, scope });
        this.notify();
        return { success: true, stocktake };
    }

    completeStocktake(stocktakeId, actualQuantities) {
        const stocktake = this.state.stocktakes.find(s => s.id === stocktakeId);
        if (!stocktake || stocktake.status !== 'in_progress') {
            return { success: false, message: '盘点单不存在或已完成' };
        }

        let profitQty = 0, lossQty = 0, profitValue = 0, lossValue = 0;
        const diffItems = [];

        stocktake.items.forEach(item => {
            const actual = actualQuantities[`${item.productId}|${item.qualityGrade}`];
            if (actual === null || actual === undefined) return;
            item.actualQty = actual;
            item.diff = actual - item.bookQty;
            const batch = this.state.batches.find(b => b.id === item.batchId);
            const cost = batch ? (parseFloat(batch.costPrice) || 0) : 0;
            item._bookUnitCost = cost;
            item.diffValue = item.diff * cost;

            if (item.diff > 0) {
                profitQty += item.diff;
                profitValue += item.diffValue;
            } else if (item.diff < 0) {
                lossQty += Math.abs(item.diff);
                lossValue += Math.abs(item.diffValue);
            }

            if (item.diff !== 0) {
                diffItems.push(item);
            }
        });

        // 处理盘盈盘亏
        diffItems.forEach(item => {
            if (item.diff > 0) {
                // 盘盈：按账面批次成本入库（禁止 0 成本免费货污染均价）
                const bookCost = parseFloat(item._bookUnitCost) || 0;
                const profitCost = (bookCost > 0)
                    ? bookCost
                    : this._estimatePurchaseUnitCost(item.productId, item.qualityGrade || 'B');
                this.createInboundOrder('adjustment', [{
                    productId: item.productId,
                    quantity: item.diff,
                    costPrice: profitCost,
                    qualityGrade: item.qualityGrade
                }], `盘点盘盈:${stocktake.name}`);
            } else if (item.diff < 0) {
                // 盘亏：出库（直接扣减库存）
                const needQty = Math.abs(item.diff);
                let remaining = needQty;
                const availableBatches = this.state.batches
                    .filter(b => b.productId === item.productId && b.status === 'normal' && b.qualityGrade === item.qualityGrade)
                    .sort((a, b) => a.inboundDate - b.inboundDate);

                for (const batch of availableBatches) {
                    if (remaining <= 0) break;
                    const invItems = this.state.inventory.filter(i => i.batchId === batch.id);
                    for (const inv of invItems) {
                        if (remaining <= 0) break;
                        const takeQty = Math.min(inv.quantity, remaining);
                        inv.quantity -= takeQty;
                        remaining -= takeQty;
                    }
                }
                this.state.inventory = this.state.inventory.filter(i => i.quantity > 0);
            }
        });

        stocktake.status = 'completed';
        stocktake.completeDay = this.gameState?.state?.gameTime?.day || 1;
        stocktake.profitQty = profitQty;
        stocktake.lossQty = lossQty;
        stocktake.profitValue = profitValue;
        stocktake.lossValue = lossValue;

        // 记账
        if (lossValue > 0 && this.gameState?.spendFunds) {
            // 盘亏计为损失（不扣钱，只记录）
        }

        this.addLog('stocktake', 'complete', {
            stocktakeId, profitQty, lossQty, profitValue, lossValue
        });
        this.notify();
        return {
            success: true,
            profitQty, lossQty, profitValue, lossValue,
            message: `盘点完成：盘盈${profitQty}件(¥${profitValue.toFixed(2)})，盘亏${lossQty}件(¥${lossValue.toFixed(2)})`
        };
    }

    // 快速盘点（自动模拟误差）
    quickStocktake() {
        const lastStocktake = this.state.stocktakes.find(s => s.status === 'completed');
        const today = this.gameState?.state?.gameTime?.day || 1;
        if (lastStocktake && lastStocktake.completeDay === today) {
            return { success: false, message: '今日已盘点过了' };
        }

        const result = this.createStocktake('每日快速盘点', 'all');
        if (!result.success) return result;

        // 模拟盘点误差 (-1% ~ +0.5%)
        const actualQtys = {};
        result.stocktake.items.forEach(item => {
            const errorRate = (Math.random() * 0.015) - 0.01;
            const diff = Math.round(item.bookQty * errorRate);
            actualQtys[`${item.productId}|${item.qualityGrade}`] = item.bookQty + diff;
        });

        return this.completeStocktake(result.stocktake.id, actualQtys);
    }

    // ==================== 库存预警 ====================
    getAlerts() {
        const alerts = [];
        const inventoryList = this.getInventoryList();
        const threshold = this.state.thresholds;
        const cap = this.getCapacity();

        inventoryList.forEach(item => {
            const product = typeof getProductById === 'function' ? getProductById(item.productId) : null;
            // 缺货预警
            if (item.totalQuantity === 0) {
                alerts.push({
                    type: 'zero_stock',
                    typeInfo: WarehouseData.alertTypes.find(a => a.id === 'zero_stock'),
                    productId: item.productId,
                    productName: item.productName,
                    quantity: 0,
                    message: `「${item.productName}」已缺货`,
                    timestamp: Date.now()
                });
            }
            // 低库存预警（绝对值10件或容量0.5%取较大值）
            else if (cap > 0 && item.totalQuantity <= Math.max(10, Math.floor(cap * 0.005))) {
                alerts.push({
                    type: 'low_stock',
                    typeInfo: WarehouseData.alertTypes.find(a => a.id === 'low_stock'),
                    productId: item.productId,
                    productName: item.productName,
                    quantity: item.totalQuantity,
                    message: `「${item.productName}」库存偏低（${item.totalQuantity}件）`,
                    timestamp: Date.now()
                });
            }
            // 超储预警（单商品超过容量5%）
            else if (cap > 0 && item.totalQuantity > cap * 0.05) {
                alerts.push({
                    type: 'over_stock',
                    typeInfo: WarehouseData.alertTypes.find(a => a.id === 'over_stock'),
                    productId: item.productId,
                    productName: item.productName,
                    quantity: item.totalQuantity,
                    message: `「${item.productName}」库存较高（${item.totalQuantity}件）`,
                    timestamp: Date.now()
                });
            }
        });

        // 包装材料预警
        Object.entries(this.state.packagingMaterials).forEach(([id, qty]) => {
            const mat = WarehouseData.packagingMaterials[id];
            if (mat && qty <= mat.lowStockThreshold) {
                alerts.push({
                    type: 'low_stock',
                    typeInfo: WarehouseData.alertTypes.find(a => a.id === 'low_stock'),
                    materialId: id,
                    materialName: mat.name,
                    quantity: qty,
                    message: `包装材料「${mat.name}」库存不足（${qty}${mat.unit}）`,
                    timestamp: Date.now()
                });
            }
        });

        return alerts.sort((a, b) => {
            const order = { danger: 0, warning: 1, info: 2 };
            return (order[a.typeInfo?.level] || 3) - (order[b.typeInfo?.level] || 3);
        });
    }

    // ==================== 包装材料管理 ====================
    /**
     * ⭐ 包装材料双向同步：gameState.state.warehouse.packagingMaterials 为唯一真值源
     * 每次访问前从 gameState 合并到 whState，修改后再反向合并回去，
     * 确保两套独立存储（localStorage 独立 whModule + 主存档）100% 一致
     */
    _syncPMFromGameState() {
        try {
            if (!this.gameState || !this.gameState.state || !this.gameState.state.warehouse) return;
            const gsPM = this.gameState.state.warehouse.packagingMaterials || {};
            if (!this.state.packagingMaterials) this.state.packagingMaterials = {};
            // 从 gameState → whState：按 id 合并（gameState 优先覆盖，因为主引擎操作都写这里）
            Object.entries(gsPM).forEach(([id, qty]) => {
                const a = parseFloat(this.state.packagingMaterials[id] || 0);
                const b = parseFloat(qty || 0);
                // 取较大值作为兜底，避免主消耗 vs 独立采购互相覆盖导致库存消失
                this.state.packagingMaterials[id] = Math.max(a, b);
            });
            // 对 whState 里存在但 gameState 没有的材料，也写回 gameState
            const whPM = this.state.packagingMaterials;
            Object.entries(whPM).forEach(([id, qty]) => {
                if (gsPM[id] == null && qty > 0) {
                    gsPM[id] = qty;
                }
            });
        } catch (e) {}
    }

    _syncPMToGameState() {
        try {
            if (!this.gameState || !this.gameState.state) return;
            if (!this.gameState.state.warehouse) this.gameState.state.warehouse = {};
            if (!this.gameState.state.warehouse.packagingMaterials) this.gameState.state.warehouse.packagingMaterials = {};
            const gsPM = this.gameState.state.warehouse.packagingMaterials;
            const whPM = this.state.packagingMaterials || {};
            // 已共享同一对象则无需写回；分叉时取较大值合并，禁止用空/旧值覆盖主库存
            if (whPM !== gsPM) {
                Object.entries(whPM).forEach(([id, qty]) => {
                    const a = parseFloat(gsPM[id] || 0);
                    const b = parseFloat(qty || 0);
                    gsPM[id] = Math.max(a, b);
                });
                // 合并后共享引用，杜绝再次分叉
                this.state.packagingMaterials = gsPM;
            }
            // 同步包装日志（老代码可能从 gameState 读 packagingLogs）
            if (!this.gameState.state.warehouse.packagingLogs) this.gameState.state.warehouse.packagingLogs = [];
            if (this.state.packagingLogs && this.state.packagingLogs.length > 0) {
                this.gameState.state.warehouse.packagingLogs = this.state.packagingLogs.slice(0, 500);
            }
        } catch (e) {}
    }

    getPackagingMaterials() {
        // ⭐ 与 gameState 共享库存真值，仓储 Tab 才能看到已采购包材
        this._syncPMFromGameState();
        try {
            if (this.gameState && this.gameState.state && this.gameState.state.warehouse &&
                this.gameState.state.warehouse.packagingMaterials) {
                this.state.packagingMaterials = this.gameState.state.warehouse.packagingMaterials;
            }
        } catch (e) {}
        const result = {};
        // 优先用全局 PACKAGING_MATERIALS（更全，含 airplane_box 等），WarehouseData 作兜底
        const cfgSource = (typeof PACKAGING_MATERIALS !== 'undefined' && PACKAGING_MATERIALS)
            ? PACKAGING_MATERIALS
            : WarehouseData.packagingMaterials;
        Object.entries(cfgSource).forEach(([key, cfg]) => {
            if (!cfg || cfg.active === false) return; // 精简：废弃材料不展示
            const qty = parseFloat(this.state.packagingMaterials[key] || 0);
            // 卷/包库存常为小数，展示保留合理精度
            const displayQty = qty >= 10 ? Math.round(qty * 10) / 10
                : (qty >= 1 ? Math.round(qty * 100) / 100 : Math.round(qty * 1000) / 1000);
            result[key] = {
                ...cfg,
                id: cfg.id || key,
                quantity: displayQty,
                totalValue: qty * (cfg.cost || 0),
                isLow: qty <= (typeof cfg.lowStockThreshold === 'number' ? cfg.lowStockThreshold : 10)
            };
        });
        return result;
    }

    purchasePackagingMaterials(materialId, quantity, unitCost) {
        this._syncPMFromGameState();
        // 精简后的废弃材料采购自动转到核心材料
        try {
            const aliases = (typeof PACKAGING_MATERIAL_ALIASES !== 'undefined') ? PACKAGING_MATERIAL_ALIASES : null;
            if (aliases && aliases[materialId]) materialId = aliases[materialId];
        } catch (_) {}
        const cfgSource = (typeof PACKAGING_MATERIALS !== 'undefined' && PACKAGING_MATERIALS)
            ? PACKAGING_MATERIALS
            : WarehouseData.packagingMaterials;
        const cfg = cfgSource[materialId];
        if (!cfg || cfg.active === false) return { success: false, message: '未知的包装材料类型' };
        if (quantity <= 0) return { success: false, message: '采购数量必须大于0' };

        const cost = Math.round((unitCost || cfg.cost) * quantity * 100) / 100;
        if (!this.gameState.spendFunds(cost, `采购${cfg.name} x${quantity}`)) {
            return { success: false, message: '资金不足' };
        }

        this.state.packagingMaterials[materialId] = (this.state.packagingMaterials[materialId] || 0) + quantity;
        // ⭐ 立刻同步到主存档 gameState.state.warehouse.packagingMaterials，避免主引擎读不到
        this._syncPMToGameState();

        this.state.packagingLogs.unshift({
            id: WarehouseData.generateId('pm'),
            type: 'purchase',
            materialId,
            materialName: cfg.name,
            quantity,
            unitCost: unitCost || cfg.cost,
            totalCost: cost,
            day: this.gameState?.state?.gameTime?.day || 1,
            hour: this.gameState?.state?.gameTime?.hour || 0,
            timestamp: Date.now()
        });
        if (this.state.packagingLogs.length > 200) {
            this.state.packagingLogs = this.state.packagingLogs.slice(0, 200);
        }

        this.addLog('packaging', 'purchase', { materialId, quantity, cost });
        this.notify();
        this._syncPMToGameState();  // notify 后再同步一次，双重保险
        return { success: true, message: `成功采购${cfg.name} x${quantity}`, cost, quantity };
    }

    consumePackagingMaterials(order) {
        this._syncPMFromGameState();
        const pm = this.state.packagingMaterials;
        const items = order.items || [];
        const totalQty = items.reduce((s, it) => s + it.quantity, 0);

        const cfgSource = (typeof PACKAGING_MATERIALS !== 'undefined' && PACKAGING_MATERIALS)
            ? PACKAGING_MATERIALS
            : WarehouseData.packagingMaterials;

        const consumed = {};
        Object.entries(cfgSource).forEach(([key, cfg]) => {
            if (cfg.consumption && cfg.consumption.base + cfg.consumption.perItem > 0) {
                let need = cfg.consumption.base + cfg.consumption.perItem * totalQty;
                if (typeof normalizePackagingConsumeQty === 'function') {
                    need = normalizePackagingConsumeQty(cfg, need);
                } else {
                    const packSheets = Number(cfg.spec && cfg.spec.quantity) || 0;
                    if (packSheets > 1 && (cfg.unit === '包' || cfg.unit === '卷')) {
                        const sheetUnit = 1 / packSheets;
                        need = Math.ceil(need / sheetUnit - 1e-9) * sheetUnit;
                        need = Math.round(need * 10000) / 10000;
                    } else if (cfg.unit === '卷' || cfg.unit === '米' || cfg.unit === 'kg') {
                        need = Math.ceil(need * 1000 - 1e-9) / 1000;
                    } else {
                        need = Math.ceil(need);
                    }
                }
                if (need > 0) consumed[key] = need;
            }
        });

        let insufficient = [];
        Object.entries(consumed).forEach(([key, need]) => {
            if (need > 0 && (pm[key] || 0) < need) {
                insufficient.push({
                    materialId: key,
                    materialName: (cfgSource[key] || {}).name || key,
                    need, have: pm[key] || 0
                });
            }
        });

        let autoBuyCost = 0;
        if (insufficient.length > 0) {
            insufficient.forEach(item => {
                const cfg = cfgSource[item.materialId] || {};
                const buyQty = item.need - item.have;
                autoBuyCost += (cfg.cost || 1) * buyQty * 1.5;
            });
            autoBuyCost = Math.round(autoBuyCost);
            if (autoBuyCost > 0) {
                if (!this.gameState || typeof this.gameState.spendFunds !== 'function' ||
                    !this.gameState.spendFunds(autoBuyCost, '紧急采购包装材料')) {
                    return { success: false, message: '包装材料不足且资金不够紧急采购', consumed: {}, autoBuyCost: 0 };
                }
                // 补齐库存后再扣
                insufficient.forEach(item => {
                    pm[item.materialId] = Math.max(pm[item.materialId] || 0, item.need);
                });
            }
        }

        Object.entries(consumed).forEach(([key, qty]) => {
            if (qty > 0) {
                pm[key] = Math.max(0, (pm[key] || 0) - qty);
            }
        });

        // ⭐ 消耗完成后，反向同步回 gameState，确保主存档也扣减了
        this._syncPMToGameState();
        this.addLog('packaging', 'consume', { consumed, autoBuyCost });
        this.notify();
        return { success: true, consumed, autoBuyCost: autoBuyCost };
    }

    // ==================== 报表统计 ====================
    getStatistics(days = 30) {
        const currentDay = this.gameState?.state?.gameTime?.day || 1;
        const stats = {
            totalInbound: 0,
            totalOutbound: 0,
            totalInboundValue: 0,
            totalOutboundValue: 0,
            inventoryValue: 0,
            inventoryCount: 0,
            turnovers: 0,
            lowStockCount: 0,
            alertsCount: 0,
            inboundByDay: [],
            outboundByDay: [],
            topProducts: [],
            abcAnalysis: { A: [], B: [], C: [] }
        };

        // 当前库存
        const inventory = this.getInventoryList();
        stats.inventoryCount = this.getUsedCapacity();
        stats.inventoryValue = inventory.reduce((s, i) => s + i.totalValue, 0);

        // 入库统计
        const inOrders = this.state.inboundOrders.filter(o => o.day >= currentDay - days);
        stats.totalInbound = inOrders.reduce((s, o) => s + o.totalQty, 0);
        stats.totalInboundValue = inOrders.reduce((s, o) => s + o.totalValue, 0);

        // 出库统计
        const outOrders = this.state.outboundOrders.filter(o => o.day >= currentDay - days);
        stats.totalOutbound = outOrders.reduce((s, o) => s + o.totalQty, 0);
        stats.totalOutboundValue = outOrders.reduce((s, o) => s + o.totalValue, 0);

        // 库存周转率
        const avgInventory = stats.inventoryValue;
        stats.turnoverRate = avgInventory > 0 ? (stats.totalOutboundValue / avgInventory).toFixed(2) : 0;

        // 预警统计
        stats.alerts = this.getAlerts();
        stats.alertsCount = stats.alerts.length;
        stats.lowStockCount = stats.alerts.filter(a => a.type === 'low_stock' || a.type === 'zero_stock').length;

        // ABC分类
        const sortedByValue = [...inventory].sort((a, b) => b.totalValue - a.totalValue);
        const totalValue = sortedByValue.reduce((s, i) => s + i.totalValue, 0) || 1;
        let cumValue = 0;
        sortedByValue.forEach(item => {
            cumValue += item.totalValue;
            const ratio = cumValue / totalValue;
            if (ratio <= 0.7) {
                stats.abcAnalysis.A.push(item);
            } else if (ratio <= 0.9) {
                stats.abcAnalysis.B.push(item);
            } else {
                stats.abcAnalysis.C.push(item);
            }
        });

        return stats;
    }

    // 获取库存健康度
    getHealthScore() {
        const stats = this.getStatistics(30);
        const cap = this.getCapacity();
        const used = this.getUsedCapacity();
        const usageRatio = cap > 0 ? used / cap : 0;

        const breakdown = { capacity: 30, stock: 30, turnover: 20, alerts: 20 };

        // 容量评分（利用率合理度）
        if (usageRatio > 0.95) breakdown.capacity = 5;
        else if (usageRatio > 0.8) breakdown.capacity = 15;
        else if (usageRatio > 0.5) breakdown.capacity = 25;
        else if (usageRatio > 0.1) breakdown.capacity = 30;
        else breakdown.capacity = 20; // 太空也扣分

        // 库存结构评分（缺货商品比例 + 过期锁定批次比例）
        const inventory = this.getInventoryList();
        const totalProducts = inventory.length;
        const zeroStock = inventory.filter(i => i.totalQuantity === 0).length;
        const lockedBatches = this.state.batches.filter(b => b.status !== 'normal').length;
        const totalBatches = this.state.batches.length;
        let stockPenalty = 0;
        if (totalProducts > 0) {
            stockPenalty += (zeroStock / totalProducts) * 15; // 缺货扣15分
        }
        if (totalBatches > 0) {
            stockPenalty += (lockedBatches / totalBatches) * 15; // 异常批次扣15分
        }
        breakdown.stock = Math.max(0, Math.round(30 - stockPenalty));

        // 预警评分
        breakdown.alerts = Math.max(0, 20 - stats.lowStockCount * 2);

        // 周转评分
        const turnover = parseFloat(stats.turnoverRate) || 0;
        if (turnover > 3) breakdown.turnover = 20;
        else if (turnover > 1) breakdown.turnover = 15;
        else if (turnover > 0.3) breakdown.turnover = 10;
        else breakdown.turnover = 5;

        const total = breakdown.capacity + breakdown.stock + breakdown.turnover + breakdown.alerts;
        let grade = 'C', gradeColor = '#f44336';
        if (total >= 80) { grade = 'S'; gradeColor = '#4caf50'; }
        else if (total >= 60) { grade = 'A'; gradeColor = '#8bc34a'; }
        else if (total >= 40) { grade = 'B'; gradeColor = '#ff9800'; }

        return {
            score: total,
            grade,
            gradeColor,
            breakdown,
            healthGrade: grade,
            healthScore: total
        };
    }

    // ==================== 每日更新（由gameEngine调用） ====================
    // ==================== 仓库安全与损耗（深化） ====================
    /** 当前安防等级信息 */
    getSecurityInfo() {
        const lv = (this.state.security && this.state.security.level) || 0;
        const levels = (typeof WarehouseData !== 'undefined' && WarehouseData.securityLevels) ? WarehouseData.securityLevels : [];
        const cur = levels.find(s => s.level === lv) || levels[0] || { level: 0, name: '无安防', icon: '🚫', cost: 0, lossRate: 0.002, desc: '' };
        const next = levels.find(s => s.level === lv + 1) || null;
        return { current: cur, next, levels };
    }

    /** 升级仓库安防（降低日损耗率） */
    upgradeSecurity() {
        const info = this.getSecurityInfo();
        if (!info.next) return { success: false, message: '已达顶级安防' };
        const cost = Number(info.next.cost) || 0;
        if (cost > 0) {
            if (!this.gameState || typeof this.gameState.spendFunds !== 'function') return { success: false, message: '支付功能不可用' };
            if (!this.gameState.spendFunds(cost, `仓库安防升级 - ${info.next.name}`)) {
                return { success: false, message: `资金不足，升级需 ¥${cost.toLocaleString()}` };
            }
        }
        if (!this.state.security) this.state.security = { level: 0 };
        this.state.security.level = info.next.level;
        this.addLog('security', 'upgrade', { level: info.next.level, name: info.next.name });
        return { success: true, message: `${info.next.icon} 已升级为「${info.next.name}」${info.next.desc ? '（' + info.next.desc + '）' : ''}` };
    }

    dailyUpdate() {
        // 同日只跑一次：事件重复订阅 / 跳天重入时防止损耗被重复扣
        const today = this.gameState?.state?.gameTime?.day || 1;
        if (this.state._lastDailyUpdateDay === today) return;
        this.state._lastDailyUpdateDay = today;

        // 检查临期/过期批次
        this.state.batches.forEach(batch => {
            if (batch.expireDate && batch.status === 'normal') {
                if (today >= batch.expireDate) {
                    batch.status = 'expired';
                    this.addLog('batch', 'expired', { batchId: batch.id });
                }
            }
        });

        // 记录每日统计
        const stats = this.getStatistics(1);
        this.state.dailyStats.push({
            day: today,
            inboundQty: stats.totalInbound,
            outboundQty: stats.totalOutbound,
            inventoryValue: stats.inventoryValue,
            alertCount: stats.alertsCount
        });
        if (this.state.dailyStats.length > 90) {
            this.state.dailyStats = this.state.dailyStats.slice(-90);
        }

        // ===== 仓库损耗（深化）：库存货值 × 安防损耗率，每日计入损耗成本 =====
        try {
            const secInfo = this.getSecurityInfo();
            const lossRate = Number(secInfo.current.lossRate) || 0;
            const invValue = Number(stats.inventoryValue) || 0;
            if (lossRate > 0 && invValue > 0) {
                const loss = Math.round(invValue * lossRate * 100) / 100;
                if (loss >= 0.01) {
                    if (this.gameState && typeof this.gameState.spendFunds === 'function') {
                        this.gameState.spendFunds(loss, `仓储损耗（安防 ${secInfo.current.icon}${secInfo.current.name}）`);
                    }
                    this.addLog('security', 'loss', { amount: loss, rate: lossRate, level: secInfo.current.level });
                }
            }
        } catch (_) {}
    }

    // ==================== 向后兼容方法 ====================
    getWarehouseCity() { return 'yiwu'; }
    getWarehouseLevel() { return this.state.level; }
    getWarehouseCapacity() { return this.getCapacity(); }
    getUsedCapacityOld() { return this.getUsedCapacity(); }
    getLowStockItems() {
        const cap = this.getCapacity();
        const minStock = Math.max(10, Math.floor(cap * 0.005));
        return this.getInventoryList()
            .filter(i => i.totalQuantity <= minStock)
            .map(i => ({
                productId: i.productId,
                productName: i.productName,
                quantity: i.totalQuantity,
                qualityGrade: 'B'
            }));
    }
    setLowStockThreshold(n) {
        this.state.thresholds.lowStockRatio = Math.max(0, (parseInt(n) || 20) / 100);
        this.notify();
    }
    getInventoryTotalValue() {
        return this.getInventoryList().reduce((s, i) => s + i.totalValue, 0);
    }
    getAllPackagingMaterials() { return this.getPackagingMaterials(); }
    getPackagingAlerts() { return this.getAlerts().filter(a => a.materialId); }

    // 兼容旧的库存增减方法
    addToInventory(productId, quantity, costPrice, options = {}) {
        return this.purchaseIn(
            productId,
            quantity,
            costPrice,
            options.purchaseOrderId || null,
            options.qualityGrade || 'B',
            {
                buyerId: options.buyerId || null,
                prepaid: !!options.prepaid,
                skipCharge: !!options.skipCharge
            }
        );
    }

    removeFromInventory(productId, quantity, options = {}) {
        return this.saleOut(productId, quantity, options.orderId, options.qualityGrade || 'B');
    }

    addWarehouseLog() { /* 兼容旧接口 */ }

    // ==================== 采购员管理模块 CRUD ====================

    /**
     * 将员工管理中 type=buyer 的在职/休假员工同步到仓储 buyers 列表。
     * 玩家在「员工管理」招聘采购员后，「我的」九宫格 → 采购员 应直接可见并可用于指派采购计划。
     */
    syncBuyersFromEmployees(options = {}) {
        const silent = !!(options && options.silent);
        const gs = this.gameState;
        if (!this.state) return { synced: 0, changed: false };
        if (!Array.isArray(this.state.buyers)) this.state.buyers = [];
        if (!gs || !gs.state || !Array.isArray(gs.state.employees)) {
            return { synced: 0, changed: false };
        }

        const employees = gs.state.employees.filter(e => e && e.type === 'buyer');
        const defaultRebate = (WarehouseData.buyerRebateConfig && WarehouseData.buyerRebateConfig.defaultRebateRate) || 0.00001;
        const defaultBase = (typeof EMPLOYEE_TYPES !== 'undefined' && EMPLOYEE_TYPES.buyer && EMPLOYEE_TYPES.buyer.baseSalary)
            ? EMPLOYEE_TYPES.buyer.baseSalary : 3400;
        const mapStatus = (s) => {
            if (s === 'active') return 'active';
            if (s === 'onleave' || s === 'leave') return 'leave';
            return 'disabled';
        };
        const phoneOk = (p) => /^(1[3-9]\d{9}|0\d{2,3}-?\d{7,8}|\d{7,8})$/.test(String(p || '').trim());
        const syntheticPhone = (empId) => {
            // 生成稳定且合法的 11 位手机号占位（1 + 10 位数字），避免无手机号员工同步失败
            let h = 0;
            const s = String(empId || 'x');
            for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
            const n = Math.abs(h % 10000000000);
            return '1' + String(n).padStart(10, '0');
        };

        let changed = false;
        const empIds = new Set(employees.map(e => e.id));

        // 已关联但员工被解雇/删除 → 标记离职并自动暂停其补货计划
        this.state.buyers.forEach(b => {
            if (b && b.linkedEmployeeId && !empIds.has(b.linkedEmployeeId) && b.status !== 'disabled') {
                b.status = 'disabled';
                (this.state.purchasePlans || []).forEach(p => {
                    if (p && p.buyerId === b.id && p.enabled !== false) p.enabled = false;
                });
                changed = true;
            }
        });

        employees.forEach(emp => {
            let buyer = this.state.buyers.find(b => b && b.linkedEmployeeId === emp.id);
            const phone = phoneOk(emp.phone) ? String(emp.phone).trim() : syntheticPhone(emp.id);
            const status = mapStatus(emp.status || 'active');
            const baseSalary = (typeof emp.baseSalary === 'number' && emp.baseSalary > 0)
                ? emp.baseSalary : defaultBase;

            if (!buyer) {
                const now = gs.state.gameTime || { day: 1, hour: 0 };
                const shortId = String(emp.id || '').replace(/\W/g, '').slice(-6) || String(this.state.buyers.length + 1);
                buyer = {
                    id: WarehouseData.generateId('byr'),
                    linkedEmployeeId: emp.id,
                    fromEmployee: true,
                    salaryPaidByHR: true, // 底薪由员工发薪发放，仓储月结只发 0.001% 提成
                    employeeNo: emp.employeeNo || ('E' + shortId),
                    name: String(emp.name || '采购员').trim() || '采购员',
                    gender: '',
                    age: null,
                    idCard: emp.idCard ? String(emp.idCard).trim() : '',
                    education: '',
                    email: '',
                    nativePlace: '',
                    emergencyContact: emp.emergencyContact ? String(emp.emergencyContact).trim() : '',
                    emergencyPhone: emp.emergencyPhone ? String(emp.emergencyPhone).trim() : '',
                    phone,
                    departmentId: 'purchase_dept',
                    goodCategories: [],
                    rebateRate: defaultRebate,
                    baseSalary,
                    status,
                    joinDate: null,
                    remark: '由员工管理自动同步',
                    totalPurchaseAmount: 0,
                    totalRebate: 0,
                    purchaseOrderCount: 0,
                    purchaseQuota: 0,
                    purchaseQuotaPct: 0,
                    quotaSpentDay: 0,
                    quotaSpentAmount: 0,
                    createTime: { day: now.day || 1, hour: now.hour || 0, timestamp: Date.now() }
                };
                // 手机号与手工采购员冲突时换占位号，避免阻塞同步
                const phoneTaken = this.state.buyers.some(b => String(b.phone || '').trim() === buyer.phone);
                if (phoneTaken) buyer.phone = syntheticPhone(emp.id + '_alt');
                this.state.buyers.unshift(buyer);
                // ⭐ 简化操作：新招聘的采购员自动创建「每日在架自动补货」计划，零配置开箱即用
                if (!Array.isArray(this.state.purchasePlans)) this.state.purchasePlans = [];
                const hasAutoPlan = this.state.purchasePlans.some(p =>
                    p && p.buyerId === buyer.id && p.scheduleType === 'daily'
                    && (p.planMode !== 'direct') && (p._targetScope === 'all' || !p.targetProductIds || !p.targetProductIds.length));
                if (!hasAutoPlan) {
                    this.state.purchasePlans.unshift({
                        id: WarehouseData.generateId('plan'),
                        name: `${buyer.name}·每日自动补货`,
                        buyerId: buyer.id,
                        buyerName: buyer.name,
                        scheduleType: 'daily',
                        scheduleHour: 10,
                        scheduleDay: 1,
                        planMode: 'restock',
                        directItems: [],
                        targetProductIds: [],
                        _targetScope: 'all',
                        maxOrderValue: 0,
                        _maxFundRatio: 80,
                        orderQuantityMultiplier: 1.5,
                        enabled: true,
                        lastCheckDay: 0,
                        lastCheckHour: 0,
                        runCount: 0,
                        createDay: (now && now.day) || 1
                    });
                }
                changed = true;
            } else {
                if (buyer.name !== emp.name && emp.name) { buyer.name = String(emp.name).trim(); changed = true; }
                if (buyer.status !== status) { buyer.status = status; changed = true; }
                if (buyer.baseSalary !== baseSalary) { buyer.baseSalary = baseSalary; changed = true; }
                if (phoneOk(emp.phone) && buyer.phone !== String(emp.phone).trim()) {
                    buyer.phone = String(emp.phone).trim();
                    changed = true;
                }
                if (!buyer.salaryPaidByHR) { buyer.salaryPaidByHR = true; changed = true; }
                if (!buyer.fromEmployee) { buyer.fromEmployee = true; changed = true; }
                if (buyer.linkedEmployeeId !== emp.id) { buyer.linkedEmployeeId = emp.id; changed = true; }
                if (buyer.rebateRate !== defaultRebate) { buyer.rebateRate = defaultRebate; changed = true; }
                if (!buyer.departmentId) { buyer.departmentId = 'purchase_dept'; changed = true; }
            }
        });

        if (changed) {
            if (silent) this._saveToStorage();
            else this.notify();
        }
        return { synced: employees.length, changed };
    }

    // 1. 添加采购员（需求a/e/f：字段完整 + 数据校验 + 成功/失败反馈）
    addBuyer(form) {
        form = form || {};
        // 未传提成比例时默认 0.001%，避免表单漏填被校验拦下
        if (form.rebateRate === undefined || form.rebateRate === null || form.rebateRate === '') {
            form.rebateRate = WarehouseData.buyerRebateConfig.defaultRebateRate;
        }
        // 数据校验
        const check = WarehouseData.validateBuyer(form);
        if (!check.ok) {
            return { success: false, message: '校验失败：' + check.errors.join('；'), errors: check.errors };
        }
        // 联系方式去重
        if (!this.state.buyers) this.state.buyers = [];
        const exists = this.state.buyers.find(b =>
            String(b.phone).trim() === String(form.phone).trim()
        );
        if (exists) {
            return { success: false, message: '该联系方式已被其他采购员使用' };
        }
        const now = this.gameState?.state?.gameTime || { day: 1, hour: 0 };
        // 工号：如果没填就自动按"EMP + 序号"生成
        let employeeNo = (form.employeeNo || '').trim();
        if (!employeeNo) {
            const n = this.state.buyers.length + 1;
            employeeNo = 'EMP' + String(n).padStart(4, '0');
        }
        const buyer = {
            id: WarehouseData.generateId('byr'),
            employeeNo,
            name: String(form.name).trim(),
            gender: form.gender || '',
            age: form.age ? parseInt(form.age) : null,
            idCard: form.idCard ? String(form.idCard).trim() : '',
            education: form.education || '',
            email: form.email ? String(form.email).trim() : '',
            nativePlace: form.nativePlace ? String(form.nativePlace).trim() : '',
            emergencyContact: form.emergencyContact ? String(form.emergencyContact).trim() : '',
            emergencyPhone: form.emergencyPhone ? String(form.emergencyPhone).trim() : '',
            phone: String(form.phone).trim(),
            departmentId: form.departmentId,
            goodCategories: Array.isArray(form.goodCategories) ? form.goodCategories.slice() : [],
            // 同步记录提成比例设置，固定为 0.001%
            rebateRate: WarehouseData.buyerRebateConfig.defaultRebateRate,
            // 2.3：固定月度底薪（默认取 EMPLOYEE_TYPES.buyer.baseSalary）
            baseSalary: (typeof form.baseSalary === 'number' && form.baseSalary > 0)
                ? form.baseSalary
                : ((typeof EMPLOYEE_TYPES !== 'undefined' && EMPLOYEE_TYPES.buyer?.baseSalary) || 3400),
            status: form.status || 'active',
            joinDate: form.joinDate || null,
            remark: form.remark ? String(form.remark).trim() : '',
            totalPurchaseAmount: 0,        // 累计采购总额
            totalRebate: 0,                // 累计提成金额（采购金额 × 0.001% 累计）
            purchaseOrderCount: 0,         // 关联采购单数量
            negotiation: 0,                // 谈判等级 0~5（每级采购价 -1%）
            purchaseQuota: 0,
            purchaseQuotaPct: parseFloat(form.purchaseQuotaPct) > 0 ? parseFloat(form.purchaseQuotaPct) : 0,
            quotaSpentDay: 0,
            quotaSpentAmount: 0,
            createTime: { day: now.day, hour: now.hour, timestamp: Date.now() }
        };
        this.state.buyers.unshift(buyer);
        this.addLog('buyer', 'add', { buyerId: buyer.id, name: buyer.name, departmentId: buyer.departmentId });
        this.notify();
        return { success: true, message: `采购员「${buyer.name}」添加成功`, data: buyer };
    }

    // 2. 编辑采购员
    updateBuyer(buyerId, form) {
        const list = this.state.buyers || [];
        const b = list.find(x => x.id === buyerId);
        if (!b) return { success: false, message: '采购员不存在' };
        const check = WarehouseData.validateBuyer({ ...b, ...form });
        if (!check.ok) {
            return { success: false, message: '校验失败：' + check.errors.join('；'), errors: check.errors };
        }
        // 联系方式去重（排除自身）
        const dup = list.find(x => x.id !== buyerId && String(x.phone).trim() === String(form.phone || b.phone).trim());
        if (dup) return { success: false, message: '该联系方式已被其他采购员使用' };
        // 允许修改的字段（含完整基本信息）
        const allowKeys = ['employeeNo','name','gender','age','idCard','education','email','nativePlace','emergencyContact','emergencyPhone','phone','departmentId','goodCategories','status','joinDate','remark'];
        allowKeys.forEach(k => {
            if (form[k] === undefined || form[k] === null) return;
            if (k === 'goodCategories' && Array.isArray(form[k])) {
                b[k] = form[k].slice();
            } else if (k === 'age') {
                const v = parseInt(form[k]);
                b[k] = isNaN(v) ? null : v;
            } else if (typeof form[k] === 'string') {
                b[k] = form[k].trim();
            } else {
                b[k] = form[k];
            }
        });
        this.addLog('buyer', 'update', { buyerId });
        this.notify();
        return { success: true, message: '采购员信息已更新', data: b };
    }

    // 3. 删除采购员（只能删除无采购记录的）
    deleteBuyer(buyerId) {
        const list = this.state.buyers || [];
        const idx = list.findIndex(x => x.id === buyerId);
        if (idx < 0) return { success: false, message: '采购员不存在' };
        const b = list[idx];
        if (b.purchaseOrderCount > 0 || (b.totalPurchaseAmount && b.totalPurchaseAmount > 0)) {
            return { success: false, message: '该采购员已有采购记录，无法删除，建议改为离职状态' };
        }
        list.splice(idx, 1);
        this.addLog('buyer', 'delete', { buyerId, name: b.name });
        this.notify();
        return { success: true, message: `采购员「${b.name}」已删除` };
    }

    // 4. 查询采购员列表（带在职过滤）
    getBuyers(filter = {}) {
        try { this.syncBuyersFromEmployees({ silent: true }); } catch (e) {}
        let list = this.state.buyers || [];
        if (filter.status === 'disabled' || filter.status === 'resigned') return [];
        if (filter.status) list = list.filter(b => b.status === filter.status);
        else list = list.filter(b => b && b.status !== 'disabled');
        if (filter.departmentId) list = list.filter(b => b.departmentId === filter.departmentId);
        if (filter.keyword) {
            const kw = String(filter.keyword).trim();
            if (kw) list = list.filter(b => (b.name && b.name.indexOf(kw) >= 0) || (b.phone && b.phone.indexOf(kw) >= 0));
        }
        const now = this.gameState?.state?.gameTime || { day: 1, hour: 0 };
        const currentMonthStart = Math.floor(((now.day || 1) - 1) / 30) * 30 + 1;
        const records = this.state.rebateRecords || [];
        return list.map(b => {
            const dept = WarehouseData.buyerDepartments.find(d => d.id === b.departmentId) || {};
            const st = WarehouseData.buyerStatus.find(s => s.id === b.status) || {};
            const pendingRebate = Math.round(records
                .filter(r => r && r.buyerId === b.id && !r._settled && (r.day || 0) >= currentMonthStart)
                .reduce((s, r) => s + Number(r.rebate || 0), 0) * 100) / 100;
            return {
                ...b,
                departmentName: dept.name || '未知部门',
                departmentIcon: dept.icon || '👤',
                statusName: st.name || '未知状态',
                statusColor: st.color || '#999',
                statusIcon: st.icon || '❓',
                pendingRebate
            };
        });
    }

    // 5. 根据ID获取单个采购员
    getBuyerById(buyerId) {
        const list = this.state.buyers || [];
        const b = list.find(x => x.id === buyerId);
        if (!b) return null;
        const dept = WarehouseData.buyerDepartments.find(d => d.id === b.departmentId) || {};
        const st = WarehouseData.buyerStatus.find(s => s.id === b.status) || {};
        return {
            ...b,
            negotiation: (typeof b.negotiation === 'number') ? b.negotiation : 0,
            departmentName: dept.name || '未知部门',
            departmentIcon: dept.icon || '👤',
            statusName: st.name || '未知状态',
            statusColor: st.color || '#999',
            statusIcon: st.icon || '❓'
        };
    }

    // ==================== 采购员谈判能力（采购员模块深化） ====================
    /** 采购员谈判等级折扣：每级采购价 -1%，最高 -5% */
    getBuyerNegotiationDiscount(buyer) {
        if (!buyer) return 0;
        const lv = Math.max(0, Math.min(5, Number(buyer.negotiation) || 0));
        return lv * 0.01;
    }

    /** 升级采购员谈判能力（0~5 级，费用随等级递增） */
    upgradeBuyerNegotiation(buyerId) {
        const buyer = (this.state.buyers || []).find(b => b && b.id === buyerId);
        if (!buyer) return { success: false, message: '采购员不存在' };
        const lv = Math.max(0, Number(buyer.negotiation) || 0);
        if (lv >= 5) return { success: false, message: '谈判能力已达顶级' };
        const cost = (lv + 1) * 5000;
        if (!this.gameState || typeof this.gameState.spendFunds !== 'function') return { success: false, message: '资金系统不可用' };
        if (!this.gameState.spendFunds(cost, `采购员谈判培训 - ${buyer.name}（Lv.${lv + 1}）`)) {
            return { success: false, message: `资金不足，升级需 ¥${cost.toLocaleString()}` };
        }
        buyer.negotiation = lv + 1;
        this.addLog('buyer', 'negotiation', { buyerId, name: buyer.name, level: buyer.negotiation });
        return { success: true, message: `「${buyer.name}」谈判能力升至 Lv.${buyer.negotiation}（采购价 -${buyer.negotiation}%）`, level: buyer.negotiation };
    }

    // 6. 采购入库时计算提成并累计（采购金额 × 0.001%，精确2位）
    //    此方法被扩展 createInboundOrder 内部调用
    _applyBuyerRebate(inboundOrder, buyerId) {
        if (!inboundOrder || !buyerId) return null;
        const list = this.state.buyers || [];
        const buyer = list.find(b => b.id === buyerId);
        if (!buyer) return { ok: false, reason: '采购员不存在' };
        if (buyer.status !== 'active') return { ok: false, reason: '采购员非在职状态' };

        if (!this.state.rebateRecords) this.state.rebateRecords = [];
        const now = this.gameState?.state?.gameTime || { day: 1, hour: 0 };
        const rebateRate = buyer.rebateRate;  // 固定 0.001%（采购金额比例）
        let orderTotalRebate = 0;
        let orderPurchaseAmount = 0;

        (inboundOrder.items || []).forEach(item => {
            const amount = Number(item.quantity) * Number(item.costPrice || 0);
            // 提成：采购金额 × 0.001%，精确到小数点后两位
            const rebate = WarehouseData.calcRebate(amount, rebateRate);
            orderPurchaseAmount += amount;
            orderTotalRebate += rebate;
            this.state.rebateRecords.unshift({
                id: WarehouseData.generateId('rbt'),
                buyerId,
                buyerName: buyer.name,
                inboundOrderId: inboundOrder.id,
                productId: item.productId || null,
                quantity: item.quantity || 0,
                amount: Math.round(amount * 100) / 100,
                rebateRate,                                  // 记录固定提成比例（0.00001）
                rebate,                                      // 精确到2位
                day: now.day, hour: now.hour,
                timestamp: Date.now()
            });
        });
        // 保留2位
        orderTotalRebate = Math.round(orderTotalRebate * 100) / 100;
        orderPurchaseAmount = Math.round(orderPurchaseAmount * 100) / 100;
        // 累计到采购员
        buyer.totalPurchaseAmount = Math.round((Number(buyer.totalPurchaseAmount || 0) + orderPurchaseAmount) * 100) / 100;
        buyer.totalRebate = Math.round((Number(buyer.totalRebate || 0) + orderTotalRebate) * 100) / 100;
        buyer.purchaseOrderCount = Number(buyer.purchaseOrderCount || 0) + 1;
        // 回填到入库单
        inboundOrder.buyerId = buyerId;
        inboundOrder.buyerName = buyer.name;
        inboundOrder.rebateRate = rebateRate;
        inboundOrder.rebateTotal = orderTotalRebate;

        if (this.state.rebateRecords.length > 2000) {
            this.state.rebateRecords = this.state.rebateRecords.slice(0, 2000);
        }
        return { ok: true, rebateTotal: orderTotalRebate, purchaseAmount: orderPurchaseAmount };
    }

    // 7. 查询某采购员的回扣记录（分页可选）
    getRebateRecords(buyerId, limit = 100) {
        let list = this.state.rebateRecords || [];
        if (buyerId) list = list.filter(r => r.buyerId === buyerId);
        return list.slice(0, limit);
    }

    // 8. 采购员统计汇总
    getBuyerSummary() {
        const buyers = this.state.buyers || [];
        const records = this.state.rebateRecords || [];
        const plans = this.state.purchasePlans || [];
        const activeBuyers = buyers.filter(b => b.status === 'active').length;
        const totalRebate = buyers.reduce((s, b) => s + Number(b.totalRebate || 0), 0);
        const totalPurchase = buyers.reduce((s, b) => s + Number(b.totalPurchaseAmount || 0), 0);
        const enabledPlans = plans.filter(p => p.enabled).length;

        const buyerBaseSalary = (typeof EMPLOYEE_TYPES !== 'undefined' && EMPLOYEE_TYPES.buyer?.baseSalary) ? EMPLOYEE_TYPES.buyer.baseSalary : 3400;
        const rebateRate = 0.00001;

        const now = this.gameState?.state?.gameTime || { day: 1, hour: 0 };
        const currentMonthStart = Math.floor((now.day - 1) / 30) * 30 + 1;

        const employees = buyers.map(b => ({
            ...b,
            baseSalary: b.baseSalary || buyerBaseSalary,
            type: 'buyer',
            department: b.department || 'purchase',
            skills: b.skills && b.skills.length ? b.skills : ['procurement', 'sourcing', 'warehouse']
        }));

        let pendingRebate = 0;
        records.forEach(r => {
            if (r.day >= currentMonthStart) {
                pendingRebate += Number(r.rebate || 0);
            }
        });
        pendingRebate = Math.round(pendingRebate * 100) / 100;

        let totalSalary = 0;
        employees.forEach(emp => {
            const base = Number(emp.baseSalary || 0);
            const perf = Number(emp.totalRebate || 0);
            totalSalary += base + perf;
        });
        totalSalary = Math.round(totalSalary * 100) / 100;

        let lastRebateSettlementDay = null;
        if (this.state._lastRebateSettlementDay) {
            lastRebateSettlementDay = this.state._lastRebateSettlementDay;
        } else {
            const settledRecords = records.filter(r => r._settled);
            if (settledRecords.length > 0) {
                settledRecords.sort((a, b) => b.day - a.day);
                lastRebateSettlementDay = settledRecords[0].day;
            }
        }

        return {
            totalBuyers: buyers.length,
            activeBuyers,
            disabledBuyers: buyers.filter(b => b.status === 'disabled').length,
            totalPurchaseAmount: Math.round(totalPurchase * 100) / 100,
            totalRebateAmount: Math.round(totalRebate * 100) / 100,
            totalRebateRecords: records.length,
            rebateRate,
            defaultRebateRate: 0.00001,
            totalPlans: plans.length,
            enabledPlans,
            employees,
            lastRebateSettlementDay,
            pendingRebate,
            totalSalary
        };
    }

    /**
     * 月度采购员结算：固定底薪 + 当月未结 0.001% 提成
     * 在发薪日由 gameEngine.checkAndSettleMonthlySalary 调用
     */
    settleBuyerRebatesMonthly(gameStateRef, payday) {
        const gs = gameStateRef || this.gameState;
        if (!gs || typeof gs.spendFunds !== 'function') {
            return { success: false, message: 'gameState 不可用' };
        }
        const now = gs.state?.gameTime || { day: 1, hour: 0 };
        const payDay = Math.max(1, Math.floor(Number(payday) || Number(now.day) || 1));
        const defaultBase = (typeof EMPLOYEE_TYPES !== 'undefined' && EMPLOYEE_TYPES.buyer?.baseSalary)
            ? EMPLOYEE_TYPES.buyer.baseSalary : 3400;

        // 汇总本月未结提成
        const buyerMap = new Map();
        const records = this.state.rebateRecords || [];
        records.forEach(r => {
            if (r._settled) return;
            // 含往月未结提成，避免发薪失败后永远不再补发
            const rebate = Math.round(Number(r.rebate || 0) * 100) / 100;
            if (rebate <= 0) return;
            if (!buyerMap.has(r.buyerId)) {
                buyerMap.set(r.buyerId, {
                    buyerId: r.buyerId,
                    buyerName: r.buyerName || '',
                    totalRebate: 0,
                    settledRecords: []
                });
            }
            const entry = buyerMap.get(r.buyerId);
            entry.totalRebate = Math.round((entry.totalRebate + rebate) * 100) / 100;
            entry.settledRecords.push(r);
        });

        // 确保在职采购员即使无提成也发底薪
        const activeBuyers = (this.state.buyers || []).filter(b => b && b.status === 'active');
        activeBuyers.forEach(b => {
            if (!buyerMap.has(b.id)) {
                buyerMap.set(b.id, {
                    buyerId: b.id,
                    buyerName: b.name || '',
                    totalRebate: 0,
                    settledRecords: []
                });
            }
        });

        const results = [];
        let anyUnpaid = false;
        buyerMap.forEach(entry => {
            const buyer = (this.state.buyers || []).find(b => b.id === entry.buyerId);
            if (buyer && buyer.status && buyer.status !== 'active') return;

            // 已关联员工管理岗位的采购员：底薪走员工发薪，这里只发 0.001% 提成，避免双份底薪
            const salaryByHR = !!(buyer && (buyer.salaryPaidByHR || buyer.linkedEmployeeId));
            // 同一发薪日底薪只发一次（多月补发循环时按 payday 去重）
            const baseAlreadyPaid = !!(buyer && buyer._lastBasePayDay === payDay);
            const baseSalary = (salaryByHR || baseAlreadyPaid)
                ? 0
                : Math.round(Number((buyer && buyer.baseSalary) || defaultBase) || 0);
            const rebate = entry.totalRebate || 0;
            const totalPay = Math.round((baseSalary + rebate) * 100) / 100;
            if (totalPay <= 0) return;

            const displayName = entry.buyerName || (buyer && buyer.name) || entry.buyerId;
            const reason = salaryByHR
                ? `采购员[${displayName}]提成(0.001%)¥${rebate.toFixed(2)}`
                : (`采购员[${displayName}]月薪` +
                    (baseSalary > 0 ? `底薪¥${baseSalary}` : '') +
                    (rebate > 0 ? `${baseSalary > 0 ? '+' : ''}提成(0.001%)¥${rebate.toFixed(2)}` : ''));
            const paid = gs.spendFunds(totalPay, reason);
            if (paid) {
                entry.settledRecords.forEach(r => { r._settled = true; r._settledDay = payDay; });
                if (buyer && baseSalary > 0) buyer._lastBasePayDay = payDay;
                if (!gs.state.payroll) gs.state.payroll = {};
                if (!Array.isArray(gs.state.payroll.salarySlips)) gs.state.payroll.salarySlips = [];
                gs.state.payroll.salarySlips.unshift({
                    id: 'SSLIP_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 4),
                    employeeId: entry.buyerId,
                    employeeName: entry.buyerName || (buyer && buyer.name) || '',
                    department: 'purchase',
                    type: 'buyer_payroll',
                    baseSalary: baseSalary,
                    performanceBonus: rebate,
                    bonus: rebate,
                    deductions: 0,
                    netSalary: totalPay,
                    description: reason,
                    day: payDay,
                    hour: now.hour,
                    timestamp: Date.now()
                });
                this.state._lastRebateSettlementDay = payDay;
                results.push({
                    buyerId: entry.buyerId,
                    buyerName: entry.buyerName,
                    baseSalary,
                    rebate,
                    amount: totalPay,
                    paid: true
                });
            } else {
                anyUnpaid = true;
                results.push({
                    buyerId: entry.buyerId,
                    buyerName: entry.buyerName,
                    baseSalary,
                    rebate,
                    amount: totalPay,
                    paid: false,
                    reason: '资金不足'
                });
            }
        });

        this.notify();
        return {
            success: !anyUnpaid,
            totalPaid: results.filter(r => r.paid).reduce((s, r) => s + r.amount, 0),
            count: results.length,
            details: results,
            message: anyUnpaid ? '部分采购员薪资发放失败（资金不足）' : '采购员薪资结算完成'
        };
    }

    // ==================== 采购计划管理模块 CRUD ====================
    // b) 新增采购计划（支持 scheduleType 格式：日/周/月自动订货）
    addPurchasePlan(config) {
        if (config && typeof config === 'object' && (config.scheduleType || config.targetProductIds)) {
            // 新格式
            const buyer = (this.state.buyers || []).find(b => b.id === config.buyerId);
            if (!buyer) return { success: false, message: '采购员不存在' };
            if (!Array.isArray(this.state.purchasePlans)) this.state.purchasePlans = [];

            const now = this.gameState?.state?.gameTime || { day: 1, hour: 0 };
            const planMode = config.planMode === 'direct' ? 'direct' : 'restock';
            const plan = {
                id: config.id || WarehouseData.generateId('plan'),
                name: (config.name || '').trim() || `${buyer.name}-在架自动补货`,
                buyerId: config.buyerId,
                buyerName: buyer.name,
                scheduleType: config.scheduleType || 'daily',
                scheduleDay: config.scheduleDay ? parseInt(config.scheduleDay) : 1,
                scheduleHour: config.scheduleHour != null ? parseInt(config.scheduleHour) : 8,
                planMode,
                directItems: Array.isArray(config.directItems) ? config.directItems.map(di => ({
                    productId: di.productId,
                    quantity: parseInt(di.quantity, 10) || 0,
                    qualityGrade: di.qualityGrade || 'B'
                })).filter(di => di.productId && di.quantity > 0) : [],
                targetProductIds: Array.isArray(config.targetProductIds) ? config.targetProductIds.slice() : [],
                _targetScope: config._targetScope || (Array.isArray(config.targetProductIds) && config.targetProductIds.length ? 'custom' : 'all'),
                _maxFundRatio: config._maxFundRatio != null ? parseFloat(config._maxFundRatio) : 80,
                minOrderValue: parseFloat(config.minOrderValue) || 0,
                maxOrderValue: parseFloat(config.maxOrderValue) || 0,
                orderQuantityMultiplier: parseFloat(config.orderQuantityMultiplier) || 1,
                enabled: config.enabled !== false,
                lastRunDay: config.lastRunDay || null,
                runCount: config.runCount || 0,
                createdAt: config.createdAt || { day: now.day, hour: now.hour, timestamp: Date.now() }
            };
            this.state.purchasePlans.unshift(plan);
            this.addLog('purchase_plan', 'add', { planId: plan.id, buyerId: plan.buyerId, scheduleType: plan.scheduleType });
            this.notify();
            return { success: true, message: `采购计划创建成功（${plan.scheduleType}）`, data: plan };
        }

        // 旧格式兼容
        const check = WarehouseData.validatePurchasePlan(config);
        if (!check.ok) return { success: false, message: '校验失败：' + check.errors.join('；'), errors: check.errors };
        const buyer = (this.state.buyers || []).find(b => b.id === config.buyerId);
        if (!buyer) return { success: false, message: '采购员不存在' };
        if (!Array.isArray(this.state.purchasePlans)) this.state.purchasePlans = [];

        const freq = WarehouseData.purchasePlanFrequencies.find(f => f.id === config.frequency);
        const today = (this.gameState?.state?.gameTime?.day) || 1;
        const startDay = config.startDay ? parseInt(config.startDay) : today;
        const items = config.items.map(it => ({
            productId: it.productId,
            productName: it.productName || (typeof getProductById === 'function' ? (getProductById(it.productId)?.name || it.productId) : it.productId),
            quantity: parseInt(it.quantity),
            costPrice: it.costPrice !== undefined && it.costPrice !== null ? parseFloat(it.costPrice) : (typeof getProductById === 'function' ? (getProductById(it.productId)?.basePrice || 0) : 0)
        }));

        const plan = {
            id: WarehouseData.generateId('plan'),
            name: (config.name || '').trim() || `${buyer.name}-${freq.name}采购计划`,
            buyerId: config.buyerId,
            buyerName: buyer.name,
            items,
            frequency: config.frequency,
            startDay,
            lastRunDay: null,
            nextRunDay: startDay,
            runCount: 0,
            enabled: config.enabled !== false,
            remark: (config.remark || '').trim(),
            createDay: today
        };
        this.state.purchasePlans.unshift(plan);
        this.addLog('purchase_plan', 'add', { planId: plan.id, buyerId: plan.buyerId, name: plan.name });
        this.notify();
        return { success: true, message: `采购计划「${plan.name}」创建成功`, data: plan };
    }

    updatePurchasePlan(planId, form) {
        const plans = this.state.purchasePlans || [];
        const p = plans.find(x => x.id === planId);
        if (!p) return { success: false, message: '采购计划不存在' };

        // ===== 新格式（scheduleType / directItems）完整更新 =====
        if (p.scheduleType || (form && (form.scheduleType || form.directItems || form.planMode))) {
            const buyerId = form.buyerId !== undefined ? form.buyerId : p.buyerId;
            const buyer = (this.state.buyers || []).find(b => b.id === buyerId);
            if (!buyer) return { success: false, message: '采购员不存在' };
            if (form.name !== undefined) p.name = String(form.name || '').trim() || p.name;
            if (form.buyerId !== undefined) { p.buyerId = form.buyerId; p.buyerName = buyer.name; }
            if (form.scheduleType !== undefined) p.scheduleType = form.scheduleType || 'daily';
            if (form.scheduleDay !== undefined) p.scheduleDay = parseInt(form.scheduleDay, 10) || 1;
            if (form.scheduleHour !== undefined) p.scheduleHour = parseInt(form.scheduleHour, 10) || 0;
            if (form.planMode !== undefined) p.planMode = form.planMode === 'direct' ? 'direct' : 'restock';
            if (form.directItems !== undefined) {
                p.directItems = Array.isArray(form.directItems) ? form.directItems.map(di => ({
                    productId: di.productId,
                    quantity: Math.max(0, parseInt(di.quantity, 10) || 0),
                    qualityGrade: di.qualityGrade || 'B'
                })).filter(di => di.productId && di.quantity > 0) : [];
            }
            if (form.targetProductIds !== undefined) {
                p.targetProductIds = Array.isArray(form.targetProductIds) ? form.targetProductIds.slice() : [];
            }
            if (form._targetScope !== undefined) p._targetScope = form._targetScope;
            if (form._maxFundRatio !== undefined) p._maxFundRatio = parseFloat(form._maxFundRatio) || 80;
            if (form.maxOrderValue !== undefined) p.maxOrderValue = parseFloat(form.maxOrderValue) || 0;
            if (form.minOrderValue !== undefined) p.minOrderValue = parseFloat(form.minOrderValue) || 0;
            if (form.orderQuantityMultiplier !== undefined) {
                const mul = parseFloat(form.orderQuantityMultiplier);
                p.orderQuantityMultiplier = (mul > 0 && Number.isFinite(mul)) ? mul : 1;
            }
            if (form.enabled !== undefined) p.enabled = !!form.enabled;
            this.addLog('purchase_plan', 'update', { planId: p.id, mode: 'schedule' });
            this.notify();
            return { success: true, message: '采购计划已更新', data: p };
        }

        // ===== 旧格式兼容 =====
        const merged = {
            buyerId: form.buyerId !== undefined ? form.buyerId : p.buyerId,
            items: form.items !== undefined ? form.items : p.items,
            frequency: form.frequency !== undefined ? form.frequency : p.frequency,
            startDay: form.startDay !== undefined ? form.startDay : p.startDay
        };
        const check = WarehouseData.validatePurchasePlan(merged);
        if (!check.ok) return { success: false, message: '校验失败：' + check.errors.join('；'), errors: check.errors };
        const buyer = (this.state.buyers || []).find(b => b.id === merged.buyerId);
        if (!buyer) return { success: false, message: '采购员不存在' };

        const freq = WarehouseData.purchasePlanFrequencies.find(f => f.id === merged.frequency);
        if (form.name !== undefined) p.name = String(form.name || '').trim() || `${buyer.name}-${freq.name}采购计划`;
        if (form.buyerId !== undefined) { p.buyerId = form.buyerId; p.buyerName = buyer.name; }
        if (form.items !== undefined) {
            p.items = form.items.map(it => ({
                productId: it.productId,
                productName: it.productName || (typeof getProductById === 'function' ? (getProductById(it.productId)?.name || it.productId) : it.productId),
                quantity: parseInt(it.quantity),
                costPrice: it.costPrice !== undefined && it.costPrice !== null ? parseFloat(it.costPrice) : (typeof getProductById === 'function' ? (getProductById(it.productId)?.basePrice || 0) : (p.items.find(x => x.productId === it.productId)?.costPrice || 0))
            }));
        }
        const today = (this.gameState?.state?.gameTime?.day) || 1;
        if (form.frequency !== undefined) { p.frequency = form.frequency; }
        if (form.startDay !== undefined && form.startDay !== null && form.startDay !== '') {
            p.startDay = parseInt(form.startDay);
        }
        // 重算下次执行日（频率或 startDay 变更时）
        if (form.frequency !== undefined || form.startDay !== undefined) {
            const freqObj = WarehouseData.purchasePlanFrequencies.find(f => f.id === p.frequency);
            const intervalDays = freqObj ? freqObj.intervalDays : 1;
            if (p.lastRunDay) {
                p.nextRunDay = p.lastRunDay + intervalDays;
            } else {
                p.nextRunDay = p.startDay;
            }
            if (p.nextRunDay < today) {
                // 过去日期的，对齐到未来最近一个周期日
                const diff = today - p.nextRunDay;
                const steps = Math.ceil(diff / intervalDays);
                p.nextRunDay = p.nextRunDay + steps * intervalDays;
            }
        }
        if (form.enabled !== undefined) p.enabled = !!form.enabled;
        if (form.remark !== undefined) p.remark = String(form.remark || '').trim();
        this.addLog('purchase_plan', 'update', { planId: p.id });
        this.notify();
        return { success: true, message: '采购计划已更新', data: p };
    }

    deletePurchasePlan(planId) {
        const plans = this.state.purchasePlans || [];
        const idx = plans.findIndex(x => x.id === planId);
        if (idx < 0) return { success: false, message: '采购计划不存在' };
        const p = plans[idx];
        plans.splice(idx, 1);
        this.addLog('purchase_plan', 'delete', { planId, name: p.name });
        this.notify();
        return { success: true, message: `采购计划「${p.name}」已删除` };
    }

    togglePurchasePlan(planId, enabled) {
        const plans = this.state.purchasePlans || [];
        const p = plans.find(x => x.id === planId);
        if (!p) return { success: false, message: '采购计划不存在' };
        p.enabled = enabled === undefined ? !p.enabled : !!enabled;
        this.addLog('purchase_plan', 'toggle', { planId, enabled: p.enabled });
        this.notify();
        return { success: true, message: p.enabled ? '采购计划已启用' : '采购计划已停用', data: p };
    }

    // c) 获取所有采购计划（带 overdue 判断：支持新旧两种格式）
    getPurchasePlans(filter = {}) {
        let list = this.state.purchasePlans || [];
        if (filter.buyerId) list = list.filter(p => p.buyerId === filter.buyerId);
        if (filter.enabled !== undefined) list = list.filter(p => !!p.enabled === !!filter.enabled);
        const today = (this.gameState?.state?.gameTime?.day) || 1;
        const now = this.gameState?.state?.gameTime || { day: 1, hour: 0 };
        return list.map(p => {
            const buyer = (this.state.buyers || []).find(b => b.id === p.buyerId);
            let overdue = false;

            if (p.scheduleType) {
                // 新格式 overdue 判断
                if (p.enabled) {
                    const scheduleDay = parseInt(p.scheduleDay) || 1;
                    const scheduleHour = parseInt(p.scheduleHour) || 8;
                    const lastRunDay = p.lastRunDay ? parseInt(p.lastRunDay) : 0;
                    if (p.scheduleType === 'daily') {
                        const lastCheck = p.lastCheckDay ? parseInt(p.lastCheckDay) : 0;
                        // 到点后还没检查过（也没成功采购）才标「待执行」
                        overdue = lastRunDay < today && lastCheck < today && (now.hour || 0) >= scheduleHour;
                    } else if (p.scheduleType === 'weekly') {
                        const weekFromLast = lastRunDay === 0 ? true : (today - lastRunDay) >= 7;
                        overdue = weekFromLast && (now.hour >= scheduleHour || (today % 7) === scheduleDay % 7);
                        if (lastRunDay === 0 && today >= scheduleDay) overdue = true;
                    } else if (p.scheduleType === 'monthly') {
                        const dayInMonth = ((today - 1) % 30) + 1;
                        if (lastRunDay === 0) {
                            overdue = dayInMonth >= scheduleDay;
                        } else {
                            const diff = today - lastRunDay;
                            overdue = diff >= 28 && dayInMonth >= scheduleDay;
                        }
                    }
                }
            } else {
                // 旧格式 overdue 判断
                overdue = p.enabled && p.nextRunDay <= today;
            }

            const freq = p.scheduleType
                ? { name: { daily: '每日', weekly: '每周', monthly: '每月' }[p.scheduleType] || p.scheduleType,
                    icon: '📅', intervalDays: { daily: 1, weekly: 7, monthly: 30 }[p.scheduleType] || 1,
                    desc: p.scheduleType }
                : (WarehouseData.purchasePlanFrequencies.find(f => f.id === p.frequency) || {});
            const dept = buyer ? WarehouseData.buyerDepartments.find(d => d.id === buyer.departmentId) : null;
            return {
                ...p,
                buyer,
                buyerName: buyer ? buyer.name : (p.buyerName || '未知采购员'),
                buyerStatus: buyer ? buyer.status : '',
                buyerDepartmentName: dept ? dept.name : '',
                buyerDepartmentIcon: dept ? dept.icon : '👤',
                frequencyName: freq.name || p.frequency || p.scheduleType,
                frequencyIcon: freq.icon || '📅',
                frequencyInterval: freq.intervalDays || 1,
                frequencyDesc: freq.desc || '',
                overdue
            };
        });
    }

    getPurchasePlanById(planId) {
        return this.getPurchasePlans().find(p => p.id === planId) || null;
    }

    /** 读取当前可用资金（兼容 shop.funds / state.funds / 字符串数字） */
    _getShopFunds() {
        const gs = this.gameState;
        if (!gs || !gs.state) return 0;
        if (gs.state.shop != null) {
            const shopFunds = Number(gs.state.shop.funds);
            if (Number.isFinite(shopFunds)) return shopFunds;
        }
        const rootFunds = Number(gs.state.funds);
        if (Number.isFinite(rootFunds)) return rootFunds;
        return 0;
    }

    /** 解析计划对应的在职采购员；原 buyer 离职时自愈挂到任意在职采购员 */
    _resolvePlanBuyer(plan) {
        if (!plan) return null;
        const buyers = this.state.buyers || [];
        let buyer = buyers.find(b => b && b.id === plan.buyerId);
        if (buyer && buyer.status === 'active') return buyer;
        const active = buyers.find(b => b && b.status === 'active');
        if (active) {
            plan.buyerId = active.id;
            plan.buyerName = active.name;
            return active;
        }
        return null;
    }

    /** 新版 scheduleType 计划：是否到点该跑 */
    _isScheduleTypePlanDue(plan, today, hour) {
        if (!plan || !plan.enabled || !plan.scheduleType) return false;
        const scheduleDay = parseInt(plan.scheduleDay) || 1;
        const scheduleHour = parseInt(plan.scheduleHour) || 8;
        const lastRunDay = plan.lastRunDay != null ? parseInt(plan.lastRunDay) : 0;
        const h = hour != null ? hour : ((this.gameState && this.gameState.state && this.gameState.state.gameTime)
            ? (this.gameState.state.gameTime.hour || 0) : 0);

        if (plan.scheduleType === 'daily') {
            // 成功采购后当天不再重跑；空跑不锁死，卖掉后整点可再补
            if (lastRunDay >= today) return false;
            if (lastRunDay < today - 1) return true; // 漏跑多天：立刻补
            if (h < scheduleHour) return false;
            const lastCheck = plan.lastCheckDay != null ? parseInt(plan.lastCheckDay) : 0;
            const lastCheckHour = plan.lastCheckHour != null ? parseInt(plan.lastCheckHour) : -99;
            // 库存已达标的空跑：每 2 小时再巡检，避免整点刷日志
            if (lastCheck >= today && plan.lastSkipReason && /达标|无需补货/.test(String(plan.lastSkipReason))) {
                if ((h - lastCheckHour) < 2) return false;
            }
            return true;
        }
        if (plan.scheduleType === 'weekly') {
            if (lastRunDay >= today) return false;
            const weekday = ((today - 1) % 7) + 1; // 1..7
            const dueWeekday = ((scheduleDay - 1) % 7) + 1;
            if (lastRunDay === 0) return weekday === dueWeekday ? (h >= scheduleHour) : (today >= scheduleDay);
            if ((today - lastRunDay) < 7 && weekday !== dueWeekday) return false;
            if (weekday !== dueWeekday && (today - lastRunDay) < 7) return false;
            if (weekday === dueWeekday) return h >= scheduleHour || (today - lastRunDay) >= 7;
            return (today - lastRunDay) >= 7;
        }
        if (plan.scheduleType === 'monthly') {
            if (lastRunDay >= today) return false;
            const dayInMonth = ((today - 1) % 30) + 1;
            if (lastRunDay === 0) return dayInMonth >= scheduleDay && (dayInMonth > scheduleDay || h >= scheduleHour);
            if ((today - lastRunDay) < 28) return false;
            return dayInMonth >= scheduleDay && (dayInMonth > scheduleDay || h >= scheduleHour);
        }
        return false;
    }

    /** 是否视为在架可售 listing（兼容旧档缺 status） */
    _isSellableListing(l) {
        if (!l || !l.productId) return false;
        if (l.paused === true) return false;
        const st = l.status;
        // 缺 status 视为在架；仅明确 offline/deleted 等排除
        if (st && st !== 'active') return false;
        return true;
    }

    /** 当前真正在售的上架 SKU（与销售逻辑一致：在架且未暂停） */
    _getActiveListedProductIds() {
        const gs = this.gameState;
        const listings = (gs && gs.state && Array.isArray(gs.state.listings)) ? gs.state.listings : [];
        const listed = listings
            .filter(l => this._isSellableListing(l))
            .map(l => l.productId);
        return [...new Set(listed)];
    }

    /** 取在架 listing 的品质等级（一键补货需与上架品质一致） */
    _getActiveListingGrade(productId) {
        const gs = this.gameState;
        const listings = (gs && gs.state && Array.isArray(gs.state.listings)) ? gs.state.listings : [];
        const hit = listings.find(l =>
            this._isSellableListing(l) && l.productId === productId && l.qualityGrade
        );
        if (hit && hit.qualityGrade) return hit.qualityGrade;
        let bestGrade = '';
        let bestQty = 0;
        try {
            const inv = (gs && gs.state && gs.state.inventory) || [];
            for (let i = 0; i < inv.length; i++) {
                const it = inv[i];
                if (!it || it.productId !== productId) continue;
                const q = Number(it.quantity) || 0;
                if (q > bestQty && (it.qualityGrade === 'A' || it.qualityGrade === 'B' || it.qualityGrade === 'C')) {
                    bestQty = q;
                    bestGrade = it.qualityGrade;
                }
            }
        } catch (_) {}
        return bestGrade || 'B';
    }

    _getIncomingPurchaseQty(productId, grade) {
        const pos = (this.gameState && this.gameState.state && this.gameState.state.purchaseOrders) || [];
        let n = 0;
        const g = grade || 'B';
        for (let i = 0; i < pos.length; i++) {
            const po = pos[i];
            if (!po || po.status === 'received' || po.productId !== productId) continue;
            if ((po.qualityGrade || 'B') !== g) continue;
            n += parseInt(po.quantity, 10) || 0;
        }
        return n;
    }

    /** 采购员每日额度：按店铺资金百分比；未设置则不能自动采购；跨日按当日资金重算并清零已用 */
    getBuyerQuotaInfo(buyer) {
        const day = (this.gameState && this.gameState.state && this.gameState.state.gameTime)
            ? (this.gameState.state.gameTime.day || 1) : 1;
        const funds = this._getShopFunds();
        if (!buyer) return { configured: false, pct: 0, quota: 0, spent: 0, remain: 0, funds, day, minHoldQty: 0, minHoldConfigured: false };
        let pct = Math.max(0, parseFloat(buyer.purchaseQuotaPct) || 0);
        if (pct > 100) pct = 100;
        if (buyer.quotaSpentDay !== day) {
            buyer.quotaSpentDay = day;
            buyer.quotaSpentAmount = 0;
            buyer.quotaBaseFunds = funds;
        }
        if (!(buyer.quotaBaseFunds > 0)) buyer.quotaBaseFunds = funds;
        const spent = Math.max(0, parseFloat(buyer.quotaSpentAmount) || 0);
        const quota = Math.round((buyer.quotaBaseFunds * (pct / 100)) * 100) / 100;
        const remain = Math.max(0, Math.round((quota - spent) * 100) / 100);
        const minHoldQty = Math.max(0, parseInt(buyer.minHoldQty, 10) || 0);
        return {
            configured: pct > 0,
            ready: pct > 0 && minHoldQty > 0,
            pct, quota, spent, remain, funds, day,
            minHoldQty,
            minHoldConfigured: minHoldQty > 0
        };
    }

    setBuyerPurchaseQuota(buyerId, percent) {
        const buyer = (this.state.buyers || []).find(b => b && b.id === buyerId);
        if (!buyer) return { success: false, message: '采购员不存在' };
        const n = Math.round(parseFloat(percent) * 10) / 10;
        if (!(n > 0)) return { success: false, message: '请设置大于 0 的资金百分比' };
        if (n > 100) return { success: false, message: '百分比不能超过 100%' };
        buyer.purchaseQuotaPct = n;
        buyer.purchaseQuota = 0;
        buyer.quotaBaseFunds = this._getShopFunds();
        const info = this.getBuyerQuotaInfo(buyer);
        this.addLog('buyer', 'quota', { buyerId: buyer.id, name: buyer.name, pct: n });
        this.notify();
        return {
            success: true,
            message: `已设置「${buyer.name}」每日额度为本日资金的 ${n}%（约 ${this._fmtQuotaMoney(info.quota)}）`,
            data: buyer
        };
    }

    setBuyerMinHoldQty(buyerId, qty) {
        const buyer = (this.state.buyers || []).find(b => b && b.id === buyerId);
        if (!buyer) return { success: false, message: '采购员不存在' };
        const n = Math.floor(Number(qty));
        if (!(n > 0)) return { success: false, message: '请设置大于 0 的最低持仓件数' };
        if (n > 99999999) return { success: false, message: '最低持仓过大' };
        buyer.minHoldQty = n;
        this.addLog('buyer', 'minHold', { buyerId: buyer.id, name: buyer.name, minHoldQty: n });
        this.notify();
        return { success: true, message: `已设置「${buyer.name}」最低持仓 ${n} 件，库存低于此数将自动采购`, data: buyer };
    }

    setBuyerRestockRules(buyerId, percent, minHoldQty) {
        const q = this.setBuyerPurchaseQuota(buyerId, percent);
        if (!q.success) return q;
        const h = this.setBuyerMinHoldQty(buyerId, minHoldQty);
        if (!h.success) return h;
        const info = this.getBuyerQuotaInfo(q.data);
        return {
            success: true,
            message: `已保存：额度资金 ${info.pct}%（约 ${this._fmtQuotaMoney(info.quota)}），最低持仓 ${info.minHoldQty} 件。库存低于持仓即自动采购。`,
            data: q.data
        };
    }

    _fmtQuotaMoney(n) {
        const v = Number(n) || 0;
        try {
            if (typeof formatMoney === 'function') return formatMoney(v);
        } catch (_) {}
        return '¥' + v.toLocaleString('en-US');
    }

    _addBuyerQuotaSpent(buyer, amount) {
        if (!buyer) return;
        const info = this.getBuyerQuotaInfo(buyer);
        const add = Math.max(0, parseFloat(amount) || 0);
        buyer.quotaSpentAmount = Math.round((info.spent + add) * 100) / 100;
    }

    /**
     * 新版自动补货：默认覆盖全部在架商品，库存低于再订点时补到目标库存。
     * 返回 { items, listedCount, needSkuCount, budgetCap, emptyReason }
     */
    _buildSchedulePlanItems(plan) {
        const empty = (reason, extra = {}) => ({
            items: [],
            listedCount: extra.listedCount || 0,
            needSkuCount: extra.needSkuCount || 0,
            budgetCap: extra.budgetCap || 0,
            emptyReason: reason || '当前无需补货'
        });

        const multiplier = Math.max(0.5, parseFloat(plan.orderQuantityMultiplier) || 1);
        const maxAmt = parseFloat(plan.maxOrderValue) || 0;
        const funds = this._getShopFunds();
        const buyer = this._resolvePlanBuyer(plan);
        const quotaInfo = this.getBuyerQuotaInfo(buyer);
        if (!quotaInfo.configured) {
            return empty('请先为采购员设置每日采购额度，设置后才会自动采购', { budgetCap: 0 });
        }
        if (!quotaInfo.minHoldConfigured) {
            return empty('请先设置最低持仓件数，库存低于此数才会自动采购', { budgetCap: 0 });
        }
        if (!(quotaInfo.remain > 0)) {
            return empty(`今日采购额度已用完（额度 ${quotaInfo.quota}，已用 ${quotaInfo.spent}）`, { budgetCap: 0 });
        }
        // 预算只看「每日额度剩余」和现有资金，不再按总资金比例把钱花光
        let budgetCap = Math.max(0, Math.min(quotaInfo.remain, funds > 0 ? funds : 0));
        if (maxAmt > 0) budgetCap = Math.min(budgetCap, maxAmt);
        if (!(budgetCap > 0)) {
            return empty(funds <= 0 ? '资金不足，无法自动采购' : '今日采购额度不足', { budgetCap });
        }

        // 指定商品直采：按固定数量接入采购渠道（不依赖安全库存）
        if (plan.planMode === 'direct' && Array.isArray(plan.directItems) && plan.directItems.length) {
            const freeCap = Math.max(0, this.getCapacity() - this.getUsedCapacity());
            if (!(freeCap > 0)) {
                return empty('仓库已满，无法自动采购', { budgetCap, listedCount: plan.directItems.length, needSkuCount: plan.directItems.length });
            }
            const items = [];
            let spentBudget = 0;
            let usedSlots = 0;
            for (let i = 0; i < plan.directItems.length; i++) {
                const di = plan.directItems[i];
                if (!di || !di.productId) continue;
                const qtyWant = Math.max(1, parseInt(di.quantity, 10) || 0);
                if (!(qtyWant > 0)) continue;
                const grade = di.qualityGrade || 'B';
                const cost = this._estimatePurchaseUnitCost(di.productId, grade);
                if (!(cost > 0)) continue;
                const remainBudget = budgetCap - spentBudget;
                const remainSlots = freeCap - usedSlots;
                let qty = qtyWant;
                if (qty * cost > remainBudget) qty = Math.floor(remainBudget / cost);
                if (qty > remainSlots) qty = remainSlots;
                if (qty <= 0) continue;
                const product = (typeof getProductById === 'function') ? getProductById(di.productId) : null;
                items.push({
                    productId: di.productId,
                    productName: (product && product.name) || di.productId,
                    quantity: qty,
                    costPrice: cost,
                    qualityGrade: grade
                });
                spentBudget += qty * cost;
                usedSlots += qty;
                if (spentBudget >= budgetCap - 0.01 || usedSlots >= freeCap) break;
            }
            if (!items.length) {
                return empty('直采商品预算/仓容不足或单价无效', { budgetCap, listedCount: plan.directItems.length, needSkuCount: plan.directItems.length });
            }
            return {
                items,
                listedCount: plan.directItems.length,
                needSkuCount: items.length,
                budgetCap,
                emptyReason: null
            };
        }

        const scope = plan._targetScope || (Array.isArray(plan.targetProductIds) && plan.targetProductIds.length ? 'custom' : 'all');
        const cap = Math.max(1, this.getCapacity());
        const freeCap = Math.max(0, cap - this.getUsedCapacity());
        const lowLine = Math.max(15, Math.floor(cap * 0.008));

        let productIds = [];
        if (scope === 'custom' && Array.isArray(plan.targetProductIds) && plan.targetProductIds.length) {
            productIds = plan.targetProductIds.slice();
        } else {
            const uniq = this._getActiveListedProductIds();
            if (scope === 'low') {
                productIds = uniq.filter(pid => this.getStockQuantity(pid) <= lowLine);
                if (!productIds.length) {
                    const invList = (typeof this.getInventoryList === 'function') ? this.getInventoryList() : [];
                    productIds = invList.filter(it => (it.totalQuantity || 0) <= lowLine).map(it => it.productId);
                }
            } else {
                productIds = uniq;
                // 尚无在架：用仓库已有 SKU，避免「没上架就完全不干活」
                if (!productIds.length) {
                    const invList = (typeof this.getInventoryList === 'function') ? this.getInventoryList() : [];
                    productIds = invList.map(it => it.productId).filter(Boolean);
                }
            }
        }

        const listedCount = productIds.length;
        if (!listedCount) {
            return empty('没有可补货商品（请先上架商品）', { budgetCap, listedCount: 0 });
        }
        if (!(freeCap > 0)) {
            return empty('仓库已满，无法自动采购', { budgetCap, listedCount, needSkuCount: listedCount });
        }

        // 玩家设定的最低持仓：库存低于该件数才自动采购，并补回到最低持仓
        const minHold = Math.max(1, parseInt(quotaInfo.minHoldQty, 10) || 0);

        // 优先补库存最低的；按上架品质计库存
        const ranked = productIds.map(pid => {
            const grade = this._getActiveListingGrade(pid) || 'B';
            const incoming = this._getIncomingPurchaseQty(pid, grade);
            const stock = this.getStockQuantity(pid, grade) + incoming;
            const target = Math.max(1, Math.ceil(minHold * multiplier));
            let need = stock < minHold ? (target - stock) : 0;
            if (need < 0) need = 0;
            return { pid, stock, target, need, grade };
        }).filter(x => x.need > 0).sort((a, b) => a.stock - b.stock || b.need - a.need);

        const needSkuCount = ranked.length;
        if (!needSkuCount) {
            return empty(`在架 ${listedCount} 个SKU库存均不低于最低持仓 ${minHold} 件，暂不采购`, {
                budgetCap, listedCount, needSkuCount: 0
            });
        }

        const items = [];
        let spentBudget = 0;
        let usedSlots = 0;
        let skippedNoCost = 0;
        for (let i = 0; i < ranked.length; i++) {
            const { pid, need, grade } = ranked[i];
            const product = (typeof getProductById === 'function') ? getProductById(pid) : null;
            if (!product && scope === 'custom') continue;
            const qualityGrade = grade || this._getActiveListingGrade(pid) || 'B';
            let cost = this._estimatePurchaseUnitCost(pid, qualityGrade);
            // 估价失败时回退 basePrice，避免整单空跑显示「库存充足」
            if (!(cost > 0) && product && product.basePrice > 0) {
                cost = Number(product.basePrice);
            }
            if (!(cost > 0)) { skippedNoCost++; continue; }
            const remainBudget = budgetCap - spentBudget;
            const remainSlots = freeCap - usedSlots;
            let qty = need;
            if (qty * cost > remainBudget) {
                qty = Math.floor(remainBudget / cost);
            }
            if (qty > remainSlots) qty = remainSlots;
            if (qty <= 0) continue;
            items.push({
                productId: pid,
                productName: (product && product.name) || pid,
                quantity: qty,
                costPrice: cost,
                qualityGrade
            });
            spentBudget += qty * cost;
            usedSlots += qty;
            if (spentBudget >= budgetCap - 0.01 || usedSlots >= freeCap) break;
        }

        if (!items.length) {
            if (skippedNoCost > 0) {
                return empty(`有 ${needSkuCount} 个SKU需补货，但无法估价采购（请先手动采购建立成本）`, {
                    budgetCap, listedCount, needSkuCount
                });
            }
            return empty(`有 ${needSkuCount} 个SKU需补货，但预算/仓容不足以采购1件`, {
                budgetCap, listedCount, needSkuCount
            });
        }
        return { items, listedCount, needSkuCount, budgetCap, emptyReason: null };
    }

    /** 一键创建：每日自动补全部在架商品 */
    quickStartOnShelfRestock(buyerId) {
        try { this.syncBuyersFromEmployees({ silent: true }); } catch (_) {}
        const buyer = (this.state.buyers || []).find(b => b.id === buyerId);
        if (!buyer) return { success: false, message: '采购员不存在' };
        if (buyer.status !== 'active') return { success: false, message: '采购员不在职' };
        const quotaInfo = this.getBuyerQuotaInfo(buyer);
        if (!quotaInfo.configured) {
            return { success: false, message: '请先设置采购额度，采购员才能自动采购' };
        }
        if (!quotaInfo.minHoldConfigured) {
            return { success: false, message: '请先设置最低持仓，库存低于此数才会自动采购' };
        }

        const existing = (this.state.purchasePlans || []).find(p =>
            p && p.buyerId === buyerId && p.enabled !== false && p.scheduleType === 'daily'
            && (p.planMode !== 'direct') && (p._targetScope === 'all' || !p.targetProductIds || !p.targetProductIds.length)
        );
        if (existing) {
            return {
                success: true,
                already: true,
                message: `已有在架自动补货计划「${existing.name}」`,
                data: existing
            };
        }

        return this.addPurchasePlan({
            name: `${buyer.name}-在架自动补货`,
            buyerId,
            scheduleType: 'daily',
            scheduleHour: 8,
            planMode: 'restock',
            directItems: [],
            targetProductIds: [],
            _targetScope: 'all',
            _maxFundRatio: 80,
            maxOrderValue: 0,
            orderQuantityMultiplier: 1.5,
            enabled: true
        });
    }

    /**
     * 估算真实采购单价（供自动采购/盘盈/退货回填）
     * - 仅统计 costPrice>0 的在库批次，排除 return_/盘盈等非采购来源
     * - 数量加权；无有效批次时回退到 供应商均价 × 品质倍率
     */
    _estimatePurchaseUnitCost(productId, qualityGrade = 'B') {
        const pid = productId;
        const grade = (qualityGrade === 'A' || qualityGrade === 'B' || qualityGrade === 'C') ? qualityGrade : 'B';
        try {
            const paid = (this.state.batches || []).filter(b => {
                if (!b || b.productId !== pid) return false;
                if ((b.quantity || 0) <= 0) return false;
                if (b.status && b.status !== 'normal') return false;
                const unit = parseFloat(b.costPrice);
                if (!(unit > 0)) return false;
                const po = String(b.purchaseOrderId || '');
                // 退货/盘点调整批次不参与进货估价，避免均价被 0/异常成本拖垮
                if (po.startsWith('return_') || po.startsWith('adj_')) return false;
                return true;
            });
            // 优先同品质；没有则用全部正成本批次
            const sameGrade = paid.filter(b => (b.qualityGrade || 'B') === grade);
            const pool = sameGrade.length ? sameGrade : paid;
            if (pool.length) {
                let qtySum = 0;
                let valSum = 0;
                for (const b of pool) {
                    const q = b.quantity || 0;
                    qtySum += q;
                    valSum += q * (parseFloat(b.costPrice) || 0);
                }
                if (qtySum > 0 && valSum > 0) {
                    let avg = valSum / qtySum;
                    // 若历史被异常压价，按 basePrice 下沿托底，避免越买越便宜
                    try {
                        const p0 = (typeof getProductById === 'function') ? getProductById(pid) : null;
                        const bp0 = p0 ? (parseFloat(p0.basePrice) || 0) : 0;
                        if (bp0 > 0 && avg < bp0 * 0.45) avg = bp0 * 0.45;
                        if (bp0 > 0 && avg > bp0 * 1.6) avg = bp0 * 1.6;
                    } catch (_) {}
                    return Math.round(avg * 100) / 100;
                }
            }
        } catch (_) {}

        let product = null;
        try {
            product = (typeof getProductById === 'function') ? getProductById(pid) : null;
            if (!product && typeof PRODUCTS !== 'undefined') {
                product = PRODUCTS.find(p => p.id === pid) || null;
            }
        } catch (_) { product = null; }
        const bp = product ? (parseFloat(product.basePrice) || 0) : 0;
        const gradeMult = (typeof QUALITY_GRADES !== 'undefined' && QUALITY_GRADES[grade])
            ? (QUALITY_GRADES[grade].priceMultiplier || 1)
            : (grade === 'A' ? 1.3 : (grade === 'C' ? 0.7 : 1));
        let supplierMult = 0.8;
        try {
            if (typeof SUPPLIERS !== 'undefined' && Array.isArray(SUPPLIERS) && product) {
                const eligible = SUPPLIERS.filter(s =>
                    Array.isArray(s.categories) && product.category
                        ? s.categories.includes(product.category)
                        : true
                );
                const list = eligible.length ? eligible : SUPPLIERS;
                if (list.length) {
                    supplierMult = list.reduce((s, x) => s + (parseFloat(x.priceMultiplier) || 0.8), 0) / list.length;
                }
            }
        } catch (_) {}
        if (!(bp > 0)) return 10;
        // 夹在合理进货区间，防止极端值
        let cost = bp * supplierMult * gradeMult;
        try {
            if (typeof gameState !== 'undefined' && gameState && typeof gameState.applyPurchaseUnitPrice === 'function') {
                cost = gameState.applyPurchaseUnitPrice(cost, product && product.category);
            }
        } catch (_) {}
        const minCost = bp * 0.45;
        const maxCost = bp * 1.6;
        if (cost < minCost) cost = minCost;
        if (cost > maxCost) cost = maxCost;
        return Math.round(cost * 100) / 100;
    }

    /** 按剩余仓容裁剪采购明细（能买多少买多少，避免整单跳过） */
    _trimItemsToFreeCapacity(items) {
        const free = Math.max(0, this.getCapacity() - this.getUsedCapacity());
        if (!(free > 0) || !Array.isArray(items) || !items.length) return [];
        const out = [];
        let used = 0;
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            if (!it) continue;
            let qty = parseInt(it.quantity, 10) || 0;
            if (qty <= 0) continue;
            if (used >= free) break;
            if (used + qty > free) qty = free - used;
            if (qty <= 0) break;
            out.push(Object.assign({}, it, { quantity: qty }));
            used += qty;
        }
        return out;
    }

    /** 执行一笔采购明细（校验通过后先扣款，再生成采购单；到货由 gameEngine.processPurchaseOrders 在到货日入仓） */
    _executePlanItems(plan, buyer, items, runDay, label) {
        let workItems = Array.isArray(items) ? items.slice() : [];
        workItems = this._trimItemsToFreeCapacity(workItems);

        let totalQty = 0;
        let totalAmt = 0;
        for (const it of workItems) {
            const qty = parseInt(it.quantity, 10) || 0;
            const cost = parseFloat(it.costPrice) || 0;
            totalQty += qty;
            totalAmt += qty * cost;
        }
        totalAmt = Math.round(totalAmt * 100) / 100;
        // ===== 采购员谈判折扣（深化）：谈判等级每级采购价 -1%，最高 -5% =====
        const negotiationDiscount = this.getBuyerNegotiationDiscount(buyer);
        if (negotiationDiscount > 0) {
            totalAmt = Math.round(totalAmt * (1 - negotiationDiscount) * 100) / 100;
        }
        if (totalQty <= 0 || totalAmt <= 0) {
            const free = Math.max(0, this.getCapacity() - this.getUsedCapacity());
            const reason = free <= 0 ? '仓库已满，无法自动采购' : '当前无需补货';
            return { ok: true, skippedEmpty: true, totalQty: 0, totalAmt: 0, items: [], reason };
        }

        if (!this.gameState || typeof this.gameState.spendFunds !== 'function') {
            return { ok: false, totalQty, totalAmt, reason: '资金系统不可用' };
        }

        try {
            const planOrderId = 'plan_' + (plan.id || 'x') + '_' + runDay;
            const inboundItems = workItems.map(it => {
                const rawCost = parseFloat(it.costPrice) || 0;
                const safeCost = rawCost > 0
                    ? rawCost
                    : this._estimatePurchaseUnitCost(it.productId, it.qualityGrade || 'B');
                return {
                    productId: it.productId,
                    quantity: parseInt(it.quantity, 10) || 0,
                    costPrice: safeCost,
                    qualityGrade: it.qualityGrade || 'B',
                    purchaseOrderId: planOrderId
                };
            }).filter(it => it.quantity > 0 && it.costPrice > 0 && it.productId);

            if (!inboundItems.length) {
                return { ok: true, skippedEmpty: true, totalQty: 0, totalAmt: 0, items: [], reason: '无可执行采购明细' };
            }

            if (typeof this.gameState.addPurchaseOrder !== 'function') {
                return { ok: false, totalQty, totalAmt, reason: '采购订单系统不可用' };
            }
            const buyerTag = buyer && buyer.name ? buyer.name : '采购员';
            if (!this.gameState.spendFunds(totalAmt, `采购员采购 - ${buyerTag}：${plan.name || label}`)) {
                return { ok: false, totalQty, totalAmt, reason: '资金不足，无法自动采购' };
            }
            try { this._addBuyerQuotaSpent(buyer, totalAmt); } catch (_) {}
            const deliveryDays = Math.max(1, Math.min(5, 2 + (buyer && buyer.efficiency < 1 ? 1 : 0)));
            try {
                inboundItems.forEach(it => {
                    const product = (typeof getProductById === 'function') ? getProductById(it.productId) : null;
                    this.gameState.addPurchaseOrder({
                        productId: it.productId,
                        productName: (product && product.name) || it.productId,
                        quantity: it.quantity,
                        unitPrice: it.costPrice,
                        totalAmount: Math.round(it.quantity * it.costPrice * 100) / 100,
                        qualityGrade: it.qualityGrade || 'B',
                        deliveryDays,
                        source: 'auto_plan',
                        planId: plan.id,
                        planName: plan.name || label,
                        buyerId: plan.buyerId || (buyer && buyer.id) || null,
                        buyerName: buyer ? buyer.name : (plan.buyerName || '')
                    });
                });
            } catch (e) {
                try { this.gameState.addFunds(totalAmt, `[采购回退] ${plan.name || label}下单失败`); } catch (_) {}
                return { ok: false, totalQty, totalAmt, reason: '下单失败已退款' };
            }
            return {
                ok: true,
                totalQty,
                totalAmt,
                items: inboundItems,
                deliveryDays,
                buyerId: plan.buyerId,
                buyerName: buyer ? buyer.name : plan.buyerName
            };
        } catch (e) {
            return { ok: false, totalQty, totalAmt, reason: '执行异常：' + (e && e.message ? e.message : String(e)) };
        }
    }

    // 按当前游戏日执行所有到期的采购计划（返回执行明细）
    runDuePurchasePlans(currentDay = null, options = {}) {
        const today = currentDay != null ? parseInt(currentDay) : (this.gameState?.state?.gameTime?.day || 1);
        const hour = options.hour != null ? parseInt(options.hour)
            : ((this.gameState && this.gameState.state && this.gameState.state.gameTime)
                ? (this.gameState.state.gameTime.hour || 0) : 0);
        const forceAll = !!(options && options.forceAll);
        const results = [];
        const plans = this.state.purchasePlans || [];

        // 确保员工招聘的采购员已同步，避免 buyerId 对不上
        try { this.syncBuyersFromEmployees({ silent: true }); } catch (_) {}

        for (const plan of plans) {
            if (!plan.enabled) continue;
            const buyer = this._resolvePlanBuyer(plan);
            if (!buyer) continue;

            // ========== 新版：scheduleType 自动补货 ==========
            if (plan.scheduleType) {
                if (!forceAll && !this._isScheduleTypePlanDue(plan, today, hour)) continue;
                const built = this._buildSchedulePlanItems(plan);
                const items = Array.isArray(built) ? built : (built.items || []);
                const meta = Array.isArray(built) ? {} : built;
                const label = ({ daily: '每日', weekly: '每周', monthly: '每月' })[plan.scheduleType] || plan.scheduleType;
                const exec = this._executePlanItems(plan, buyer, items, today, label);
                if (exec.skippedEmpty) {
                    // 空跑：记录检查日但不锁死整天；库存卖空后整点仍可再补
                    const reason = meta.emptyReason || exec.reason || '当前无需补货';
                    plan.lastCheckDay = today;
                    plan.lastCheckHour = hour;
                    plan.lastSkipReason = reason;
                    this.addLog('purchase_plan', 'skip', {
                        planId: plan.id, runDay: today, reason,
                        listedCount: meta.listedCount, needSkuCount: meta.needSkuCount
                    });
                    results.push({
                        ok: true,
                        skippedEmpty: true,
                        planId: plan.id,
                        planName: plan.name,
                        buyerId: plan.buyerId,
                        buyerName: buyer.name,
                        runDay: today,
                        totalQty: 0,
                        totalAmt: 0,
                        reason,
                        listedCount: meta.listedCount || 0,
                        needSkuCount: meta.needSkuCount || 0
                    });
                } else if (exec.ok) {
                    plan.lastRunDay = today;
                    plan.lastCheckDay = today;
                    plan.lastCheckHour = hour;
                    plan.lastSkipReason = null;
                    plan.runCount = (plan.runCount || 0) + 1;
                    plan.lastResult = {
                        day: today, totalQty: exec.totalQty, totalAmt: exec.totalAmt,
                        listedCount: meta.listedCount, needSkuCount: meta.needSkuCount
                    };
                    this.addLog('purchase_plan', 'run', { planId: plan.id, runDay: today, totalQty: exec.totalQty, totalAmt: exec.totalAmt });
                    results.push({
                        ok: true,
                        planId: plan.id,
                        planName: plan.name,
                        buyerId: plan.buyerId,
                        buyerName: buyer.name,
                        runDay: today,
                        totalQty: exec.totalQty,
                        totalAmt: exec.totalAmt,
                        items: exec.items,
                        listedCount: meta.listedCount || 0,
                        needSkuCount: meta.needSkuCount || 0
                    });
                } else {
                    // 资金/容量失败也不标记已跑，整点可重试
                    this.addLog('purchase_plan', 'fail', { planId: plan.id, runDay: today, reason: exec.reason });
                    results.push({
                        ok: false,
                        planId: plan.id,
                        planName: plan.name,
                        runDay: today,
                        reason: exec.reason,
                        totalQty: exec.totalQty || 0,
                        totalAmt: exec.totalAmt || 0
                    });
                }
                continue;
            }

            // ========== 旧版：固定 items + frequency ==========
            if (!Array.isArray(plan.items) || plan.items.length === 0) continue;
            if (plan.nextRunDay === undefined || plan.nextRunDay === null) {
                plan.nextRunDay = today;
            }
            const freq = WarehouseData.purchasePlanFrequencies.find(f => f.id === plan.frequency);
            const intervalDays = freq ? freq.intervalDays : 1;
            let safety = 0;
            while (plan.nextRunDay <= today && safety < 1000) {
                safety++;
                const runDay = plan.nextRunDay;
                const label = freq ? freq.name : (plan.frequency || '计划');
                const exec = this._executePlanItems(plan, buyer, plan.items, runDay, label);
                if (exec.ok || exec.skippedEmpty) {
                    plan.lastRunDay = runDay;
                    plan.nextRunDay = runDay + intervalDays;
                    if (exec.ok && !exec.skippedEmpty) {
                        plan.runCount = (plan.runCount || 0) + 1;
                        this.addLog('purchase_plan', 'run', { planId: plan.id, runDay, totalQty: exec.totalQty, totalAmt: exec.totalAmt });
                        results.push({
                            ok: true,
                            planId: plan.id,
                            planName: plan.name,
                            buyerId: plan.buyerId,
                            buyerName: buyer.name,
                            runDay,
                            totalQty: exec.totalQty,
                            totalAmt: exec.totalAmt,
                            items: exec.items
                        });
                    } else {
                        this.addLog('purchase_plan', 'skip', { planId: plan.id, runDay, reason: exec.reason });
                        results.push({
                            ok: !!exec.ok,
                            skippedEmpty: !!exec.skippedEmpty,
                            planId: plan.id,
                            planName: plan.name,
                            runDay,
                            reason: exec.reason,
                            totalQty: exec.totalQty || 0,
                            totalAmt: exec.totalAmt || 0
                        });
                    }
                } else {
                    // 资金/仓容失败：不推进 nextRunDay，整点可重试
                    this.addLog('purchase_plan', 'fail', { planId: plan.id, runDay, reason: exec.reason });
                    results.push({
                        ok: false,
                        planId: plan.id,
                        planName: plan.name,
                        runDay,
                        reason: exec.reason,
                        totalQty: exec.totalQty || 0,
                        totalAmt: exec.totalAmt || 0
                    });
                    break;
                }
            }
        }
        if (results.length > 0) this.notify();
        return {
            executed: results.filter(r => r.ok && !r.skippedEmpty).length,
            skipped: results.filter(r => !r.ok || r.skippedEmpty).length,
            details: results
        };
    }

    // 立即执行某采购计划一次（手动触发，不考虑频率日期限制）
    runPurchasePlanNow(planId) {
        const plans = this.state.purchasePlans || [];
        const p = plans.find(x => x.id === planId);
        if (!p) return { success: false, message: '采购计划不存在' };
        const today = (this.gameState?.state?.gameTime?.day) || 1;
        const buyer = this._resolvePlanBuyer(p);
        if (!buyer) {
            return { success: false, message: '采购员不在职，无法执行' };
        }

        // 新版：直接强制跑一次
        if (p.scheduleType) {
            const built = this._buildSchedulePlanItems(p);
            const items = Array.isArray(built) ? built : (built.items || []);
            const meta = Array.isArray(built) ? {} : built;
            const label = ({ daily: '每日', weekly: '每周', monthly: '每月' })[p.scheduleType] || p.scheduleType;
            const exec = this._executePlanItems(p, buyer, items, today, label);
            this.notify();
            if (exec.skippedEmpty) {
                return {
                    success: true,
                    message: `ℹ️ ${meta.emptyReason || exec.reason || '当前库存充足，无需采购'}`
                };
            }
            if (exec.ok) {
                p.lastRunDay = today;
                p.runCount = (p.runCount || 0) + 1;
                p.lastResult = {
                    day: today, totalQty: exec.totalQty, totalAmt: exec.totalAmt,
                    listedCount: meta.listedCount, needSkuCount: meta.needSkuCount
                };
                const skuHint = meta.needSkuCount
                    ? `（补 ${meta.needSkuCount}/${meta.listedCount || meta.needSkuCount} 个在架SKU）`
                    : '';
                this.notify();
                return {
                    success: true,
                    message: `✅ 已下单 ${exec.totalQty} 件 / ¥${exec.totalAmt.toFixed(2)}${skuHint}，约${exec.deliveryDays || 2}天后到货`
                };
            }
            return { success: false, message: `❌ ${exec.reason || '执行失败'}` };
        }

        // 旧版：临时把 nextRunDay 调到 today
        const orig = { nextRunDay: p.nextRunDay, lastRunDay: p.lastRunDay, runCount: p.runCount };
        p.nextRunDay = today;
        const res = this.runDuePurchasePlans(today, { forceAll: false });
        const mine = (res.details || []).find(d => d.planId === planId);
        if (!mine) {
            p.nextRunDay = orig.nextRunDay; p.lastRunDay = orig.lastRunDay; p.runCount = orig.runCount;
            this.notify();
            return { success: false, message: '未能执行（请检查采购员在职/资金/容量）' };
        }
        if (mine.skippedEmpty) {
            return { success: true, message: `ℹ️ ${mine.reason || '当前无需补货'}` };
        }
        return { success: !!mine.ok, message: mine.ok ? `✅ 已执行采购：${mine.totalQty}件 / ¥${(mine.totalAmt || 0).toFixed(2)}` : `❌ ${mine.reason}` };
    }

}

// 导出模块
if (typeof window !== 'undefined') {
    window.WarehouseState = WarehouseState;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { WarehouseState, WarehouseData };
}
