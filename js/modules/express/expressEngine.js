/**
 * expressEngine.js - 快递合作系统业务引擎
 * ========================================
 * 负责：费用计算、运单创建、物流推进、议价解锁、账单结算、异常处理
 */

const ExpressEngine = {
    state: ExpressState,

    init() {
        this.state.init();
    },

    /** 计价用运输方式：大件与仅陆运公司强制陆运；玩家显式选空运时，顺丰/京东/EMS 的标准件也按空运 */
    _resolveFeeShippingMethod(companyId, options, serviceId) {
        const allowed = (typeof getCompanyAllowedModes === 'function')
            ? getCompanyAllowedModes(companyId)
            : ['land'];
        if (serviceId === 'freight' || allowed.indexOf('air') < 0) return 'land';
        let id = options && options.shippingMethod;
        if (!id || id === 'auto') {
            if (this.state && typeof this.state.resolveCompanyShippingMethod === 'function') {
                id = this.state.resolveCompanyShippingMethod(companyId, options.order || options);
            } else if (typeof resolveShippingMethodForOrder === 'function') {
                id = resolveShippingMethodForOrder(options.order || options, false, companyId);
            } else {
                id = 'land';
            }
        }
        if (allowed.indexOf(id) < 0) id = allowed[0] || 'land';
        return id;
    },

    // ========== 费用计算 ==========
    /**
     * 计算快递费用
     * @param {string} companyId 快递公司ID
     * @param {string} serviceId 服务类型ID
     * @param {number} weightKg 包裹重量(kg)
     * @param {string} fromCity 发货城市
     * @param {string} toCity 收货城市
     * @param {Object} options { insurance, packagingType, fragile }
     * @returns {Object} { baseFee, weightFee, distanceFee, insuranceFee, packagingFee, discount, totalFee, deliveryHours }
     */
    calculateFee(companyId, serviceId, weightKg, fromCity, toCity, options = {}) {
        const company = getCompanyById(companyId);
        if (!company) return { totalFee: 0, error: '快递公司不存在' };

        const service = getServiceType(serviceId);
        const companyPricing = BASE_PRICING[companyId];
        if (!companyPricing || !companyPricing[serviceId]) {
            // 该公司不支持此服务，降级到standard
            const fallback = companyPricing?.standard;
            if (!fallback) return { totalFee: 0, error: '该公司不支持此服务类型' };
            serviceId = 'standard';
        }

        const pricing = companyPricing[serviceId];
        weightKg = Math.max(0.1, weightKg);

        // 1. 重量费用（首重+续重）
        const firstKg = pricing.firstWeightKg || 1;
        let weightFee = pricing.firstWeight;
        if (weightKg > firstKg) {
            const additionalKg = Math.ceil(weightKg - firstKg);
            weightFee += additionalKg * pricing.addWeight;
        }

        // 2. 距离加价
        const distance = getCityDistance(fromCity, toCity);
        let distanceMultiplier = 1.0;
        for (const dm of DISTANCE_MULTIPLIERS) {
            if (distance <= dm.maxKm) {
                distanceMultiplier = dm.multiplier;
                break;
            }
        }
        const distanceFee = weightFee * (distanceMultiplier - 1);

        let baseFee = weightFee * distanceMultiplier;

        // 3. 服务类型溢价
        if (service.priceMultiplier) {
            baseFee *= service.priceMultiplier;
        }

        // 3.5 运输方式：空运/陆运价不同；普通快递公司（仅 land）强制陆运
        const shippingMethodId = this._resolveFeeShippingMethod(companyId, options, serviceId);
        const shippingMethod = (typeof getShippingMethod === 'function')
            ? getShippingMethod(shippingMethodId)
            : null;
        if (shippingMethod && shippingMethod.feeMultiplier) {
            baseFee *= shippingMethod.feeMultiplier;
        }

        // 4. 保价费
        let insuranceFee = 0;
        if (options.insurance && options.insuranceValue) {
            insuranceFee = Math.max(1, options.insuranceValue * 0.005); // 千分之五
        }

        // 5. 包装费
        let packagingFee = 0;
        if (options.packagingType) {
            const pkg = PACKAGING_OPTIONS.find(p => p.id === options.packagingType);
            if (pkg) packagingFee = pkg.cost;
        }

        // 6. 易碎品加价
        if (options.fragile) {
            baseFee *= 1.3;
        }

        // 7. 合作折扣
        const partner = this.state.getPartner(companyId);
        let discount = 1.0;
        if (partner) {
            const coopLevel = getCooperationLevel(partner);
            discount = coopLevel.priceDiscount;

            // 好感度额外折扣：封顶95折（最高5%优惠），好感度主要影响揽件速度/丢件率
            const avgFriendship = this.state.getAvgFriendship(companyId);
            const friendshipDiscount = Math.max(0.95, 1 - avgFriendship / 500);
            discount *= friendshipDiscount;

            // 结算周期折扣（月结95折）不在此处乘：由月结出账 createBill 统一应用一次，
            // 避免发货计价与出账结算双重打折（曾导致月结实际约9折）
        }

        // 8. 累计成功订单阶梯折扣（全局，所有快递公司共享）
        let successOrderDiscountInfo = null;
        let successOrderDiscount = 1.0;
        const minGlobal = typeof EXPRESS_GLOBAL_MIN_DISCOUNT !== 'undefined' ? EXPRESS_GLOBAL_MIN_DISCOUNT : 0.40;
        if (typeof gameEngine !== 'undefined' && typeof gameEngine.getExpressSuccessOrderDiscount === 'function') {
            successOrderDiscountInfo = gameEngine.getExpressSuccessOrderDiscount();
            successOrderDiscount = successOrderDiscountInfo.discount || 1.0;
            discount *= successOrderDiscount;
        } else if (typeof window !== 'undefined' && window.gameEngine && typeof window.gameEngine.getExpressSuccessOrderDiscount === 'function') {
            successOrderDiscountInfo = window.gameEngine.getExpressSuccessOrderDiscount();
            successOrderDiscount = successOrderDiscountInfo.discount || 1.0;
            discount *= successOrderDiscount;
        }
        // 综合折扣保底（不低于 4 折）
        discount = Math.max(minGlobal, discount);

        const beforeDiscount = baseFee + insuranceFee + packagingFee;
        const afterDiscount = Math.round(baseFee * discount * 100) / 100 + insuranceFee + packagingFee;
        const totalFee = Math.round(afterDiscount * 100) / 100;

        // 9. 预计送达时长(小时)：发货→完成固定 1～3 天
        const distanceTier = distance <= 200 ? 1 : distance <= 500 ? 2 : distance <= 1000 ? 3 : distance <= 2000 ? 4 : 5;
        const baseHours = [24, 36, 48, 60, 72, 72][distanceTier] || 48;
        const speedBonus = partner ? getFriendshipLevel(this.state.getAvgFriendship(companyId)).speedBonus : 0;
        let serviceSpeed = service.defaultSpeedTier || 1;
        if (shippingMethod && shippingMethod.speedMultiplier) {
            serviceSpeed *= shippingMethod.speedMultiplier;
        }
        const isAir = shippingMethodId === 'air';
        const intl = distance >= 3000;
        const minHours = isAir ? (intl ? 24 : 12)
            : ((typeof MIN_SHIP_TO_COMPLETE_HOURS !== 'undefined') ? MIN_SHIP_TO_COMPLETE_HOURS : 24);
        const maxHours = intl ? (isAir ? 96 : 240)
            : ((typeof MAX_SHIP_TO_COMPLETE_HOURS !== 'undefined') ? MAX_SHIP_TO_COMPLETE_HOURS : 72);
        const deliveryHours = Math.min(maxHours, Math.max(minHours, Math.round(baseHours / serviceSpeed * (1 - speedBonus))));

        return {
            companyId,
            serviceId,
            shippingMethod: shippingMethodId,
            shippingMethodName: (shippingMethod && shippingMethod.name) || '陆运',
            shippingFeeMultiplier: (shippingMethod && shippingMethod.feeMultiplier) || 1,
            weightKg: Math.round(weightKg * 100) / 100,
            distance,
            weightFee: Math.round(weightFee * 100) / 100,
            distanceMultiplier,
            distanceFee: Math.round(distanceFee * 100) / 100,
            baseFee: Math.round(baseFee * 100) / 100,
            insuranceFee: Math.round(insuranceFee * 100) / 100,
            packagingFee: Math.round(packagingFee * 100) / 100,
            discount: Math.round(discount * 10000) / 10000,
            successOrderDiscount: successOrderDiscountInfo ? successOrderDiscountInfo.discount : 1.0,
            successOrderLabel: successOrderDiscountInfo ? successOrderDiscountInfo.label : '10折',
            successOrderCompleted: successOrderDiscountInfo ? successOrderDiscountInfo.completedCount : 0,
            successOrderNext: successOrderDiscountInfo ? successOrderDiscountInfo.nextTier : null,
            discountAmount: Math.round((beforeDiscount - afterDiscount) * 100) / 100,
            totalFee,
            deliveryHours,
            estimatedDays: Math.ceil(deliveryHours / 24)
        };
    },

    /**
     * 获取推荐快递公司和费用对比
     */
    getQuoteComparison(weightKg, fromCity, toCity, options = {}) {
        const results = [];
        this.state.getUnlockedPartners().forEach(partner => {
            const company = getCompanyById(partner.companyId);
            if (!company) return;
            // 检查是否支持该服务
            const services = this.getAvailableServices(partner.companyId, weightKg);
            // 每家公司独立解析运输方式：显式指定优先（air/land）；auto 按公司设置/金额智能判定，并受 allowedModes 限制
            let shipMethod = options.shippingMethod || 'auto';
            if (shipMethod !== 'auto' && typeof getCompanyAllowedModes === 'function' && getCompanyAllowedModes(partner.companyId).indexOf(shipMethod) < 0) {
                // 该公司不支持所选运输方式：跳过（如选「空运」时三通一达/极兔/德邦不参与报价）
                return;
            }
            if (shipMethod === 'auto') {
                shipMethod = (this.state && typeof this.state.resolveCompanyShippingMethod === 'function')
                    ? this.state.resolveCompanyShippingMethod(partner.companyId, options.order || options)
                    : ((typeof resolveShippingMethodForOrder === 'function')
                        ? resolveShippingMethodForOrder(options.order || options)
                        : 'land');
            }
            services.forEach(sid => {
                const fee = this.calculateFee(partner.companyId, sid, weightKg, fromCity, toCity, {
                    ...options,
                    shippingMethod: shipMethod
                });
                if (!fee.error) {
                    results.push({
                        companyId: partner.companyId,
                        company,
                        serviceId: sid,
                        service: getServiceType(sid),
                        ...fee,
                        coopLevel: getCooperationLevel(partner),
                        avgFriendship: this.state.getAvgFriendship(partner.companyId),
                        lossRate: this.getActualLossRate(partner.companyId, partner, fee.shippingMethod || shipMethod)
                    });
                }
            });
        });
        // 按价格升序
        results.sort((a, b) => a.totalFee - b.totalFee);
        return results;
    },

    getAvailableServices(companyId, weightKg) {
        const company = getCompanyById(companyId);
        const pricing = BASE_PRICING[companyId];
        if (!pricing) return ['standard'];
        const services = [];
        Object.entries(pricing).forEach(([sid, p]) => {
            const service = getServiceType(sid);
            if (!service) return;
            // 重量限制
            if (sid === 'freight') {
                // 大件快运：仅3kg以上包裹可选
                if (weightKg < 3) return;
            } else {
                // 其他服务：不得超过最大承重
                if (company.maxWeight && weightKg > company.maxWeight) return;
            }
            // 当日达/次晨达通常仅限同城/近距离（简化：重量<5kg）
            if (sid === 'same_day' && weightKg > 5) return;
            if (sid === 'next_day' && weightKg > 20) return;
            services.push(sid);
        });
        return services.length ? services : ['standard'];
    },

    getActualLossRate(companyId, partner, shippingMethod) {
        const company = getCompanyById(companyId);
        if (!company) return 0.01;
        let rate = company.lossRateBase;
        // 好感度降低丢件率
        const friendship = partner ? this.state.getAvgFriendship(companyId) : 0;
        rate *= (1 - friendship / 200);
        // 合作等级降低丢件率
        if (partner) {
            const lvl = getCooperationLevel(partner);
            rate *= (1 - lvl.level * 0.05);
        }
        // 空运丢件率更低，陆运略高
        const method = (typeof getShippingMethod === 'function')
            ? getShippingMethod(shippingMethod || 'land')
            : null;
        if (method && method.lossMultiplier) rate *= method.lossMultiplier;
        return Math.max(0.0001, rate);
    },

    // ========== 发货 ==========
    /**
     * 创建运单并发货
     */
    shipOrder(order, companyId, serviceId, gameTime, options = {}) {
        const company = getCompanyById(companyId);
        if (!company) return { success: false, message: '快递公司不存在' };
        if (!this.state.isPartnerUnlocked(companyId)) return { success: false, message: '未与该公司建立合作' };

        // 每家公司独立解析运输方式：显式指定优先；auto 按公司设置/金额智能判定（受 allowedModes 限制）
        let shippingMethod = options.shippingMethod || 'auto';
        if (shippingMethod === 'auto') {
            shippingMethod = (this.state && typeof this.state.resolveCompanyShippingMethod === 'function')
                ? this.state.resolveCompanyShippingMethod(companyId, order)
                : ((typeof resolveShippingMethodForOrder === 'function') ? resolveShippingMethodForOrder(order, true) : 'land');
        } else if (typeof getCompanyAllowedModes === 'function' && getCompanyAllowedModes(companyId).indexOf(shippingMethod) < 0) {
            shippingMethod = getCompanyAllowedModes(companyId)[0] || 'land';
        }
        order.shipping_method = shippingMethod;
        order.shippingMethod = shippingMethod;
        const shipOpts = { ...options, shippingMethod, order };

        const weightKg = order.weightKg || (order.quantity * 0.3) || 0.5;
        const fee = this.calculateFee(companyId, serviceId, weightKg, order.fromCity, order.buyerCity, shipOpts);

        if (fee.error) return { success: false, message: fee.error };

        // 结算周期：仅「现结」当场扣款；周结/月结只记账期，禁止发货时再扣一遍
        const partner = this.state.getPartner(companyId);
        if (!partner) return { success: false, message: '未与该公司建立合作' };
        const defaultCycle = (typeof DEFAULT_SETTLEMENT_CYCLE !== 'undefined') ? DEFAULT_SETTLEMENT_CYCLE : 'weekly';
        let cycleId = partner.settlementCycle || defaultCycle;
        if (cycleId === 'daily' || !(SETTLEMENT_CYCLES || []).find(c => c.id === cycleId)) cycleId = defaultCycle;
        partner.settlementCycle = cycleId;
        const cycle = SETTLEMENT_CYCLES.find(c => c.id === cycleId);
        const immediatePay = !!(cycle && cycle.id === 'per_order');
        const service = getServiceType(serviceId);
        const payReason = `快递费 - ${company.name}${service ? service.name : ''}`;

        if (immediatePay && typeof gameState !== 'undefined') {
            const maxDebt = (typeof SHOP_CONFIG !== 'undefined' && SHOP_CONFIG.maxDebt != null) ? SHOP_CONFIG.maxDebt : -100000;
            const funds = (gameState.state.shop && gameState.state.shop.funds) || 0;
            if ((funds - fee.totalFee) < maxDebt) {
                return { success: false, message: '资金不足，无法支付快递费' };
            }
            if (options.confirmedPayment) {
                if (typeof gameState.spendFunds === 'function') {
                    if (!gameState.spendFunds(fee.totalFee, payReason)) {
                        return { success: false, message: '资金不足，无法支付快递费' };
                    }
                } else {
                    gameState.state.shop.funds -= fee.totalFee;
                }
            }
        }

        // 创建运单
        const waybill = this.state.createWaybill({
            ...order,
            weightKg,
            fromCity: order.fromCity || 'yiwu',
            deliveryHours: fee.deliveryHours,
            packagingType: options.packagingType || 'bag',
            insurance: !!options.insurance,
            shipping_method: shippingMethod,
            shippingMethod
        }, companyId, serviceId, fee.totalFee, gameTime);
        waybill.shipping_method = shippingMethod;
        waybill.shippingMethod = shippingMethod;

        if (immediatePay) {
            if (options.confirmedPayment) {
                waybill.feePaid = true;
                // 标记已现结，防止后续周结/月结账单重复计入
                waybill.billId = waybill.billId || ('PAID_SHIP_' + waybill.id);
            } else {
                // 先出账，弹窗确认后再扣款
                const bill = this.state.createPerOrderBill(companyId, waybill.id, gameTime);
                if (bill && typeof eventBus !== 'undefined') {
                    eventBus.emit('payment:request', {
                        id: 'express-bill-' + bill.id,
                        category: 'express',
                        noCancel: true,
                        billId: bill.id,
                        title: '确认支付快递费',
                        amount: bill.payableAmount,
                        detail: `${company.name}${service ? ' · ' + service.name : ''} · 运单 ${waybill.trackingNo}`,
                        note: '必须先付清快递费。余额不足请贷款或破产。',
                        execute: () => this.payBill(bill.id)
                    });
                }
            }
        } else {
            waybill.feePaid = false; // 账期结算：发货不扣款，等周结/月结账单
        }

        return {
            success: true,
            waybillId: waybill.id,
            trackingNo: waybill.trackingNo,
            shippingMethod,
            fee: fee.totalFee,
            deliveryHours: fee.deliveryHours,
            estimatedDays: fee.estimatedDays,
            immediatePay,
            feePaid: !!(immediatePay && options.confirmedPayment),
            message: `已通过${company.name}${service ? service.name : ''}发货，运单号：${waybill.trackingNo}`
        };
    },

    // ========== 物流推进（每小时tick调用） ==========
    tick(gameTime) {
        try {
            // 月度重置检查
            this.state.checkMonthReset(gameTime);

            const activeWaybills = this.state.getActiveWaybills();
            // 用 OrderPerf.byId，禁止每小时扫一遍全部订单建 Map
            this._orderByIdCache = null;
            try {
                if (typeof OrderPerf !== 'undefined' && OrderPerf.getById && typeof gameState !== 'undefined') {
                    OrderPerf.ensure(gameState.state && gameState.state.orders);
                    if (OrderPerf.byId) this._orderByIdCache = OrderPerf.byId;
                }
            } catch (_) {}
            const n = activeWaybills.length;
            let budget = n;
            if (n > 220) budget = 220;
            try {
                if (typeof gameEngine !== 'undefined' && gameEngine.fps > 0 && gameEngine.fps < 20) {
                    budget = Math.min(budget, 80);
                }
            } catch (_) {}
            let start = this._wbTickOffset || 0;
            if (start >= n) start = 0;
            const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            let processed = 0;
            for (let i = 0; i < n && processed < budget; i++) {
                const idx = (start + i) % n;
                this._advanceWaybill(activeWaybills[idx], gameTime);
                processed++;
                if ((processed & 31) === 0) {
                    const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                    if (nowMs - t0 > 12) break;
                }
            }
            this._wbTickOffset = n ? ((start + processed) % n) : 0;
            this._orderByIdCache = null;

            // 检查逾期账单
            this._checkOverdueBills(gameTime);
        } catch (e) {
            this._orderByIdCache = null;
            console.error('[ExpressEngine] tick error:', e);
        }
    },

    _findOrderById(orderId) {
        if (!orderId || typeof gameState === 'undefined') return null;
        if (this._orderByIdCache) return this._orderByIdCache.get(orderId) || null;
        try {
            if (typeof OrderPerf !== 'undefined' && OrderPerf.getById) {
                const found = OrderPerf.getById(orderId, gameState.state && gameState.state.orders);
                if (found) return found;
            }
        } catch (_) {}
        const orders = gameState.state && gameState.state.orders;
        if (!orders) return null;
        for (let i = 0; i < orders.length; i++) {
            if (orders[i] && orders[i].id === orderId) return orders[i];
        }
        return null;
    },

    _advanceWaybill(waybill, gameTime) {
        const hoursSinceCreate = (gameTime.day - waybill.createdAt.day) * 24 + (gameTime.hour - waybill.createdAt.hour);
        if (hoursSinceCreate < 0) return;

        // 兼容旧运单：预计时长钳制在 1～3 天
        const minHours = (typeof MIN_SHIP_TO_COMPLETE_HOURS !== 'undefined') ? MIN_SHIP_TO_COMPLETE_HOURS : 24;
        const maxHours = (typeof MAX_SHIP_TO_COMPLETE_HOURS !== 'undefined') ? MAX_SHIP_TO_COMPLETE_HOURS : 72;
        if (!waybill.estimatedDeliveryHours || waybill.estimatedDeliveryHours < minHours) {
            waybill.estimatedDeliveryHours = minHours;
        } else if (waybill.estimatedDeliveryHours > maxHours) {
            waybill.estimatedDeliveryHours = maxHours;
        }

        const progress = Math.min(1, hoursSinceCreate / Math.max(1, waybill.estimatedDeliveryHours));
        const company = getCompanyById(waybill.companyId);
        const partner = this.state.getPartner(waybill.companyId);

        // 好感度揽件加成
        const friendship = partner ? this.state.getAvgFriendship(waybill.companyId) : 0;
        const fl = getFriendshipLevel(friendship);
        const pickupBonus = fl.pickupBonus || 0;

        // 单次访问推进到「当前进度允许的最远阶段」：原实现每阶段即 return，
        // 一份运单须 5 次访问才签收；220/tick 预算下完成吞吐≈44/小时，远低于
        // 生单速度（订单限制移除后），导致大量运单超预计时效。循环推进保持
        // 各阶段判定条件不变，仅把多次访问合并为一次连续过站。
        let guard = 0;
        while (guard++ < 7) {
            // 阶段0：待揽收 -> 已揽件（1-4小时）
            if (waybill.status === 'pending') {
                const basePickupHours = 2 + Math.random() * 3;
                const pickupHours = Math.max(0.5, basePickupHours * (1 - pickupBonus));
                if (hoursSinceCreate < pickupHours) break;
                this.state.updateWaybillStatus(waybill.id, 'collected', {
                    time: gameTime,
                    location: this._getCityNameSafe(waybill.fromCity),
                    description: `快件已被${company.name}揽收，揽收人：${waybill.courierMan}`
                });
                continue;
            }
            // 阶段1：已揽件 -> 转运中（进度10%）
            if (waybill.status === 'collected' && progress >= 0.1) {
                this._addTrackEvent(waybill, 'transfer', gameTime, {
                    fromCity: this._getCityNameSafe(waybill.fromCity),
                    toCity: this._getIntermediateCity(waybill.fromCity, waybill.buyerCity)
                });
                continue;
            }
            // 阶段2：转运中 -> 运输中（进度30%）
            if (waybill.status === 'transfer' && progress >= 0.3) {
                this._addTrackEvent(waybill, 'in_transit', gameTime, {
                    city: this._getIntermediateCity(waybill.fromCity, waybill.buyerCity)
                });
                continue;
            }
            // 阶段3：运输中 -> 派送中（进度70%）
            if (waybill.status === 'in_transit' && progress >= 0.7) {
                waybill.currentCity = waybill.buyerCity;
                this.state.updateWaybillStatus(waybill.id, 'delivering', {
                    time: gameTime,
                    location: this._getCityNameSafe(waybill.buyerCity),
                    description: `快件已到达${this._getCityNameSafe(waybill.buyerCity)}网点，${waybill.courierMan}正在派送`
                });
                continue;
            }
            // 阶段4：派送中 -> 签收（进度>=100%）
            if (waybill.status === 'delivering' && progress >= 1) {
                // 检查是否丢件
                const lossRate = this.getActualLossRate(
                    waybill.companyId,
                    partner,
                    waybill.shipping_method || waybill.shippingMethod || 'land'
                );
                if (Math.random() < lossRate) {
                    this.state.updateWaybillStatus(waybill.id, 'lost', {
                        time: gameTime,
                        location: this._getCityNameSafe(waybill.buyerCity),
                        description: '抱歉，快件在派送途中丢失',
                        reason: '派送途中丢失'
                    });
                    this._handleLostPackage(waybill);
                    return;
                }
                const signers = ['本人签收', '门卫代收', '快递柜', '驿站代收'];
                const signer = signers[Math.floor(Math.random() * signers.length)];
                this.state.updateWaybillStatus(waybill.id, 'signed', {
                    time: gameTime,
                    location: this._getCityNameSafe(waybill.buyerCity),
                    description: `快件已被${signer === '本人签收' ? waybill.buyerName : signer}签收`
                });
                // 签收后更新对应订单状态
                this._onDelivered(waybill);
                return;
            }
            break; // 无阶段可推进，等待下次访问
        }

        // 随机添加中转轨迹（限制条数，避免爆单时 tracks 暴涨拖垮存档/主线程）
        const trackLen = (this.state.tracks && this.state.tracks[waybill.id]) ? this.state.tracks[waybill.id].length : 0;
        if (trackLen < 12 && ['collected','transfer','in_transit'].includes(waybill.status) && Math.random() < 0.08) {
            const cities = this._getIntermediateCities(waybill.fromCity, waybill.buyerCity);
            if (cities.length) {
                const city = cities[Math.floor(Math.random() * cities.length)];
                const events = LOGISTICS_EVENTS[waybill.status] || LOGISTICS_EVENTS.transfer;
                const tpl = events[Math.floor(Math.random() * events.length)];
                const desc = tpl
                    .replace('{courier}', company.name)
                    .replace('{courierMan}', waybill.courierMan)
                    .replace('{city}', city)
                    .replace('{fromCity}', this._getCityNameSafe(waybill.currentCity))
                    .replace('{toCity}', city)
                    .replace('{phone}', '1' + Math.floor(Math.random() * 9000000000 + 1000000000));
                this.state.updateWaybillStatus(waybill.id, waybill.status, {
                    time: gameTime,
                    location: city,
                    description: desc
                });
                waybill.currentCity = city;
            }
        }
    },

    _addTrackEvent(waybill, status, gameTime, params) {
        const company = getCompanyById(waybill.companyId);
        const events = LOGISTICS_EVENTS[status] || [];
        let desc = events[0] || '快件状态更新';
        if (params.toCity) {
            desc = `快件已从${params.fromCity}发出，下一站：${params.toCity}`;
        } else if (params.city) {
            desc = events.length > 1 ? events[Math.floor(Math.random() * events.length)] : desc;
            desc = desc.replace('{city}', params.city);
        }
        this.state.updateWaybillStatus(waybill.id, status, {
            time: gameTime,
            location: params.city || params.toCity || this._getCityNameSafe(waybill.currentCity),
            description: desc
        });
    },

    _onDelivered(waybill) {
        // 查找关联订单，更新其状态
        const order = this._findOrderById(waybill.orderId);
        if (order) {
            order.deliveryStatus = 'delivered';
            order.expDelivered = { ...waybill.signedAt };
            // 增加合作积分
            this.state.addCooperationPoints(waybill.companyId, 1);
        }
    },

    _handleLostPackage(waybill) {
        // 仅标记丢失；向买家退款 + 快递赔付统一由 gameEngine.handlePackageLost 处理，避免双通道刷钱
        const order = this._findOrderById(waybill.orderId);
        if (order) {
            order.deliveryStatus = 'lost';
            order.exceptionReason = '包裹丢失';
            order.waybillId = order.waybillId || waybill.id;
            order.expressCompanyId = order.expressCompanyId || waybill.companyId;
        }
    },

    _handleException(waybill, reason) {
        this.state.updateWaybillStatus(waybill.id, 'exception', {
            time: { day: 1, hour: 0 },
            reason
        });
    },

    _checkOverdueBills(gameTime) {
        const unpaid = this.state.getUnpaidBills();
        unpaid.forEach(bill => {
            if (bill.status === 'confirmed' && bill.dueAt) {
                const hoursDue = (gameTime.day - bill.dueAt.day) * 24 + (gameTime.hour - bill.dueAt.hour);
                if (hoursDue > 0) {
                    bill.status = 'overdue';
                    eventBus.emit('toast:show', {
                        message: `⚠️ ${getCompanyById(bill.companyId).name}账单已逾期，请尽快结算`,
                        type: 'warning'
                    });
                }
            }
        });
    },

    _getCityNameSafe(cityId) {
        if (typeof ALL_CITIES !== 'undefined') {
            const c = ALL_CITIES.find(c => c.id === cityId);
            if (c) return c.name;
        }
        return { yiwu: '义乌', shanghai: '上海', guangzhou: '广州', shenzhen: '深圳', beijing: '北京', hangzhou: '杭州', chengdu: '成都', wuhan: '武汉' }[cityId] || '中转站';
    },

    _getIntermediateCity(fromId, toId) {
        const hubs = ['上海', '杭州', '武汉', '郑州', '南京', '长沙'];
        return hubs[Math.floor(simpleHash(fromId + toId) % hubs.length)];
    },

    _getIntermediateCities(fromId, toId) {
        const allHubs = ['上海分拨中心', '杭州转运中心', '武汉转运中心', '郑州分拨中心', '南京中转部', '长沙分拨中心', '南昌中转站', '合肥转运中心'];
        const seed = simpleHash(fromId + '|' + toId);
        const result = [];
        for (let i = 0; i < 2; i++) {
            result.push(allHubs[(seed + i * 7) % allHubs.length]);
        }
        return result;
    },

    // ========== 合作解锁 ==========
    /**
     * 检查并解锁可解锁的快递公司
     */
    checkUnlocks() {
        if (typeof gameState === 'undefined') return [];
        const reputation = gameState.state.shop.reputation || 0;
        const unlocked = [];
        EXPRESS_COMPANIES.forEach(company => {
            if (this.state.isPartnerUnlocked(company.id)) return;
            const partner = this.state.getPartner(company.id);
            if (partner && !partner.unlocked) return;

            // 检查解锁条件
            if (reputation >= company.reputationReq) {
                const totalVol = Object.values(this.state.partners).reduce((s, p) => s + (p.totalShipments || 0), 0);
                if (totalVol >= company.minMonthlyVolume) {
                    const result = this.state.unlockPartner(company.id, gameState.state.gameTime);
                    if (result.success) {
                        unlocked.push(company);
                        eventBus.emit('toast:show', {
                            message: `🎉 新快递公司解锁：${company.name}`,
                            type: 'success'
                        });
                    }
                }
            }
        });
        return unlocked;
    },

    // ========== 社交互动 ==========
    doFriendshipAction(companyId, courierId, actionId) {
        if (typeof gameState === 'undefined') return { success: false, message: '游戏未初始化' };
        const action = FRIENDSHIP_ACTIONS.find(a => a.id === actionId);
        if (!action) return { success: false, message: '无效操作' };
        // 预检资金（含欠款额度），避免操作成功却扣款失败
        if (action.cost > 0) {
            const maxDebt = (typeof SHOP_CONFIG !== 'undefined' && SHOP_CONFIG.maxDebt != null) ? SHOP_CONFIG.maxDebt : -100000;
            if ((gameState.state.shop.funds || 0) - action.cost < maxDebt) {
                return { success: false, message: '资金不足' };
            }
        }
        const result = this.state.doFriendshipAction(companyId, courierId, actionId, gameState.state.gameTime);
        if (result.success && action.cost > 0) {
            const company = getCompanyById(companyId);
            const reason = `快递公关 - ${company ? company.name : ''} ${action.name}`;
            if (typeof gameState.spendFunds === 'function') {
                if (!gameState.spendFunds(action.cost, reason)) {
                    return { success: false, message: '资金不足' };
                }
            } else {
                gameState.state.shop.funds -= action.cost;
            }
        }
        return result;
    },

    /** 是否周一 0 点（周结出账日）。weekday：1=周一 … 7=周日 */
    _isMondaySettlementTime(gt) {
        if (!gt || (gt.hour || 0) !== 0) return false;
        try {
            if (typeof GAME_syncRealDateToGameTime === 'function') {
                GAME_syncRealDateToGameTime(gt);
            }
        } catch (_) {}
        const wd = Number(gt.weekday || gt.dayOfWeek) || 0;
        return wd === 1;
    },

    // ========== 结算对账 ==========
    generateBills() {
        if (typeof gameState === 'undefined') return [];
        const bills = [];
        const defaultCycle = (typeof DEFAULT_SETTLEMENT_CYCLE !== 'undefined') ? DEFAULT_SETTLEMENT_CYCLE : 'weekly';
        this.state.getUnlockedPartners().forEach(partner => {
            // 统一月结（每月1号）；现结除外；旧周/半月/季结一律按月结
            let cycleId = partner.settlementCycle || defaultCycle;
            if (cycleId !== 'per_order') cycleId = 'monthly';
            if (partner.settlementCycle !== cycleId) partner.settlementCycle = cycleId;

            const cycle = SETTLEMENT_CYCLES.find(c => c.id === cycleId) || SETTLEMENT_CYCLES.find(c => c.id === 'monthly');
            if (!cycle || cycle.id === 'per_order') return;
            const gt = gameState.state.gameTime;
            // 优先用真实日历月内日；缺省时用 day%30
            const monthDay = (typeof gt.monthDay === 'number') ? gt.monthDay : (((gt.day - 1) % 30) + 1);
            const shouldGen = (monthDay === 1 && (gt.hour === 0 || gt.hour === 8));
            if (shouldGen && partner.creditUsed > 0) {
                // 防止同日重复出账
                if (partner._lastBillDay === gt.day) return;
                const periodLabel = `${gt.year || ''}年${gt.month || ''}月1日月结`;
                const bill = this.state.createBill(partner.companyId, periodLabel, gt);
                if (bill) {
                    partner._lastBillDay = gt.day;
                    bills.push(bill);
                    const company = getCompanyById(partner.companyId);
                    const companyName = company ? company.name : partner.companyId;
                    try {
                        eventBus.emit('toast:show', {
                            message: `📋 ${companyName}月结账单已生成，待付¥${bill.payableAmount}`,
                            type: 'info'
                        });
                    } catch (_) {}
                    // 每月1号：弹出付款确认（确认后才扣款）
                    try {
                        if (typeof eventBus !== 'undefined' && eventBus.emit) {
                            eventBus.emit('payment:request', {
                                id: 'express-monthly-' + bill.id + '-d' + gt.day,
                                category: 'express',
                                noCancel: true,
                                billId: bill.id,
                                title: '快递月结付款（每月1号）',
                                amount: bill.payableAmount,
                                detail: `${companyName} · ${periodLabel} · 账单 ${bill.billNo || bill.id}`,
                                note: '每月1号必须先付清上月运费。余额不足请贷款，否则破产。',
                                execute: () => this.payBill(bill.id)
                            });
                        }
                    } catch (_) {}
                }
            }
        });
        return bills;
    },

    payBill(billId) {
        if (typeof gameState === 'undefined') return { success: false, message: '游戏未初始化' };
        const bill = this.state.bills[billId];
        if (!bill) return { success: false, message: '账单不存在' };
        // 批量确认时同一账单可能入队多次：已付视为成功（幂等）
        if (bill.status === 'paid') return { success: true, amount: 0, skipped: true, message: '已付款' };
        const amount = Math.round((Number(bill.payableAmount) || 0) * 100) / 100;
        if (!(amount > 0)) {
            const result = this.state.payBill(billId, gameState.state.gameTime);
            if (result && result.success) {
                (bill.items || []).forEach(it => {
                    const w = this.state.waybills[it.waybillId];
                    if (w) w.feePaid = true;
                });
            }
            return result || { success: true, amount: 0 };
        }
        const company = getCompanyById(bill.companyId);
        const reason = `快递结算 - ${company ? company.name : ''} ${bill.billNo || ''}`;
        if (typeof gameState.spendFunds === 'function') {
            if (!gameState.spendFunds(amount, reason)) {
                return { success: false, message: '资金不足' };
            }
        } else if (gameState.state.shop.funds < amount) {
            return { success: false, message: '资金不足' };
        } else {
            gameState.state.shop.funds -= amount;
        }
        const result = this.state.payBill(billId, gameState.state.gameTime);
        if (result && result.success) {
            (bill.items || []).forEach(it => {
                const w = this.state.waybills[it.waybillId];
                if (w) w.feePaid = true;
            });
        }
        return result;
    },

    // ========== 序列化 ==========
    serialize() {
        return this.state.serialize();
    },

    deserialize(data) {
        this.state.deserialize(data);
    }
};

if (typeof window !== 'undefined') {
    window.ExpressEngine = ExpressEngine;
}
