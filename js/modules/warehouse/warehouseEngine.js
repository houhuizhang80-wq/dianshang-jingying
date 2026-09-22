/**
 * 仓储管理模块 - 游戏引擎集成
 * 负责仓储系统与游戏主循环的集成、事件处理、自动化逻辑
 */
class WarehouseEngine {
    constructor(warehouseState, gameState, gameEngine) {
        this.whState = warehouseState;
        this.gameState = gameState;
        this.gameEngine = gameEngine;
        this.initialized = false;
    }

    // 初始化
    init() {
        if (this.initialized) return;

        // ⚠️ 修复：原先只判断 this.gameEngine.eventBus —— GameEngine 没有该属性（全项目用全局 eventBus），
        //    导致下面所有订阅都没注册，仓储日更（安防损耗/预警/过期批次/日统计）从未执行过。
        //    与 employeeEngine / procurementEngine 保持一致，回退全局 eventBus。
        const bus = (this.gameEngine && this.gameEngine.eventBus)
            || (typeof eventBus !== 'undefined' ? eventBus : null);
        if (bus) {
            // 跨日钩子：真正会被触发的是 game:dailyTick（由 processBankDaily 发出，员工/采购/银行/税务同挂）
            // day:update 全项目无人 emit，保留订阅仅作兼容
            bus.on('game:dailyTick', this.handleDailyUpdate.bind(this));
            bus.on('day:update', this.handleDailyUpdate.bind(this));
            // 注：order:packed / order:shipped 全项目无人 emit；purchase:received 的载荷不带 items，
            //     且入库已由 gameState.addInventory 直连 warehouse.purchaseIn，订阅它会在载荷变化时重复入库，
            //     故这三个 handler 保持不订阅（方法保留，供后续显式调用）。
        }

        this.initialized = true;
    }

    // 处理采购到货
    handlePurchaseReceived(data) {
        const { items } = data;
        if (!items || !Array.isArray(items)) return;

        items.forEach(item => {
            // 必须显式 prepaid：禁止仅靠伪造 purchaseOrderId 跳过扣款
            this.whState.purchaseIn(
                item.productId,
                item.quantity,
                item.costPrice,
                item.purchaseOrderId || null,
                item.qualityGrade || 'B',
                { prepaid: true, skipCharge: true, buyerId: item.buyerId || null }
            );
        });
    }

    // 处理订单打包完成（实际出库在发货时）
    handleOrderPacked(order) {
        // 打包时消耗包装材料
        this.whState.consumePackagingMaterials(order);
    }

    // 处理订单发货（销售出库）
    handleOrderShipped(order) {
        if (!order || !order.items) return;

        const outItems = order.items.map(item => ({
            productId: item.productId,
            quantity: item.quantity,
            qualityGrade: item.qualityGrade || 'B',
            orderId: order.id
        }));

        this.whState.createOutboundOrder('sale', outItems, `订单发货: ${order.id}`);
    }

    // 处理退货入库
    handleReturnReceived(data) {
        const { orderId, items } = data;
        if (!items) return;

        const isValidPid = (pid) => {
            if (pid == null || pid === '') return false;
            const s = String(pid);
            return s !== 'undefined' && s !== 'null' && s !== 'NaN';
        };

        const inItems = items.map(item => {
            const grade = item.qualityGrade || 'B';
            let cost = parseFloat(item.costPrice);
            if (!(cost > 0) && this.whState && typeof this.whState._estimatePurchaseUnitCost === 'function') {
                cost = this.whState._estimatePurchaseUnitCost(item.productId, grade);
            }
            if (!(cost > 0)) cost = 1;
            return {
                productId: item.productId,
                quantity: item.quantity,
                costPrice: cost,
                qualityGrade: grade,
                purchaseOrderId: item.purchaseOrderId || ('return_' + (orderId || 'x'))
            };
        }).filter(it => isValidPid(it.productId) && (Number(it.quantity) > 0));

        if (!inItems.length) {
            try { console.warn('[warehouseEngine] 退货入库跳过：无有效 productId', orderId); } catch (_) {}
            return;
        }

        this.whState.createInboundOrder('return', inItems, `退货入库: ${orderId}`);
    }

    // 每日更新
    handleDailyUpdate(day) {
        // 执行仓储每日更新
        this.whState.dailyUpdate();

        // 检查并触发预警
        this.checkAndTriggerAlerts();

        // 自动处理过期批次
        this.handleExpiredBatches();
    }

    // 检查预警并通知
    checkAndTriggerAlerts() {
        const alerts = this.whState.getAlerts();
        const dangerAlerts = alerts.filter(a => a.typeInfo?.level === 'danger');

        if (dangerAlerts.length > 0) {
            // 严重预警记录
            this.whState.addLog('alert', 'danger', {
                count: dangerAlerts.length,
                items: dangerAlerts.map(a => a.message)
            });
        }
    }

    // 处理过期批次
    handleExpiredBatches() {
        const batches = this.whState.getBatches();
        const today = this.gameState.state.gameTime.day;

        batches.forEach(batch => {
            if (batch.expireDate && batch.status === 'normal' && today >= batch.expireDate) {
                this.whState.lockBatch(batch.id, '批次已过期');
            }
        });
    }

    // 员工自动处理（打包员/仓储员工）
    processEmployeeWork(employee) {
        if (!employee || employee.skills?.pack !== true) return;

        const efficiency = employee.efficiencyMultiplier || 1;
        const workCapacity = Math.floor(5 * efficiency);

        // 自动整理库位、处理预警等（简化版）
        return {
            tasksCompleted: Math.floor(Math.random() * workCapacity),
            type: 'warehouse'
        };
    }

    // 当日「在仓商品占用费」（不含月租）
    getDailyCost() {
        return this.getCostDetail().occupied;
    }

    // 每月固定月租（元）
    getMonthlyRent() {
        return this.getCostDetail().monthlyRent;
    }

    // 新手扶持：开店前 7 天免「在仓商品占用费」（城市房租照付），避免新手满仓秒破产
    _applyNewbieWaiver(d) {
        try {
            const day = (this.gameState && this.gameState.state && this.gameState.state.gameTime
                && this.gameState.state.gameTime.day) || 1;
            if (day <= 7 && d && Number(d.occupied) > 0) {
                d.newbieWaived = true;
                d.occupied = 0;
                d.dailyTotal = Math.round((Number(d.cityRent) || 0) * 100) / 100;
                const monthDays = (typeof WarehouseData !== 'undefined' && WarehouseData && Number(WarehouseData.MONTH_DAYS) > 0)
                    ? Number(WarehouseData.MONTH_DAYS) : 30;
                d.dailyEquivalent = Math.round(((Number(d.monthlyRent) || 0) / monthDays + (Number(d.cityRent) || 0)) * 100) / 100;
            }
        } catch (_) {}
        return d;
    }

    /**
     * 仓储费明细
     * { level, monthlyRent 每月固定月租, rate 元/件/日, used 在仓件数,
     *   occupied 当日占用费, cityRent 城市每日房租, dailyTotal 当日实际扣款(=occupied+cityRent),
     *   dailyEquivalent 日均口径(月租/30+占用费+城市房租) }
     */
    getCostDetail() {
        const info = (this.whState && typeof this.whState.getLevelInfo === 'function')
            ? this.whState.getLevelInfo()
            : null;
        const level = (info && info.level)
            || (this.whState && this.whState.state && this.whState.state.level)
            || 1;
        // 计费件数含 _fallback 兜底库存（优先），否则退回模块仓批件数
        const used = (this.whState && typeof this.whState.getBillableQuantity === 'function')
            ? (Number(this.whState.getBillableQuantity()) || 0)
            : ((this.whState && typeof this.whState.getUsedCapacity === 'function')
                ? (Number(this.whState.getUsedCapacity()) || 0)
                : 0);
        // 仓库城市每日房租（搬仓页那条「房租 ¥X/日」特性）
        const cityRent = (this.whState && typeof this.whState.getCityRentPerDay === 'function')
            ? (Number(this.whState.getCityRentPerDay()) || 0)
            : 0;
        const WD = (typeof WarehouseData !== 'undefined') ? WarehouseData : null;
        if (WD && typeof WD.calcOccupancyFee === 'function' && typeof WD.getLevelRentInfo === 'function') {
            const occ = WD.calcOccupancyFee(level, used);
            const rent = WD.getLevelRentInfo(level);
            const monthDays = Number(WD.MONTH_DAYS) > 0 ? Number(WD.MONTH_DAYS) : 30;
            return this._applyNewbieWaiver({
                level: occ.level,
                monthlyRent: rent.monthlyRent,
                rate: occ.rate,
                used: occ.used,
                occupied: occ.occupied,
                cityRent: cityRent,
                dailyTotal: Math.round((occ.occupied + cityRent) * 100) / 100,
                dailyEquivalent: Math.round((rent.monthlyRent / monthDays + occ.occupied + cityRent) * 100) / 100
            });
        }
        // 兜底：直接读等级表
        const monthlyRent = Math.max(0, Number(info && info.monthlyRent) || 0);
        const rate = (WD && Number(WD.storageUnitCost) >= 0) ? Number(WD.storageUnitCost) : 0.02;
        const occupied = Math.round(used * rate * 100) / 100;
        return this._applyNewbieWaiver({
            level: Number(level) || 1,
            monthlyRent: monthlyRent,
            rate: rate,
            used: used,
            occupied: occupied,
            cityRent: cityRent,
            dailyTotal: Math.round((occupied + cityRent) * 100) / 100,
            dailyEquivalent: Math.round((monthlyRent / 30 + occupied + cityRent) * 100) / 100
        });
    }
}

// 单例实例
let warehouseEngineInstance = null;

function initWarehouseEngine(warehouseState, gameState, gameEngine) {
    if (!warehouseEngineInstance) {
        warehouseEngineInstance = new WarehouseEngine(warehouseState, gameState, gameEngine);
        warehouseEngineInstance.init();
    }
    return warehouseEngineInstance;
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { WarehouseEngine, initWarehouseEngine };
}
