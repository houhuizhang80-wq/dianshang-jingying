/**
 * 售后客服 — Engine（tick / 事件生成 / 流程推进）
 */
const AfterSalesEngine = (function () {
    'use strict';

    let _gs = null;
    let _lastHour = -1;

    function init(gameState) {
        _gs = gameState;
    }

    function _hourKey(t) {
        return ((t.day || 1) - 1) * 24 + (t.hour || 0);
    }

    function _hasCs() {
        if (typeof csState !== 'undefined' && typeof csState.hasActiveCsStaff === 'function') {
            return csState.hasActiveCsStaff();
        }
        return (_gs.state.employees || []).some(e =>
            e && e.status === 'active' &&
            (e.type === 'customerService' || e.position === 'customerService')
        );
    }

    function tick() {
        if (!_gs || !_gs.state) return;
        const now = _gs.state.gameTime;
        const hourKey = _hourKey(now);
        if (hourKey === _lastHour) return;
        _lastHour = hourKey;
        try {
            _genConsultations();
            _genReturns();
            _handleMissed(now);
            _handleReactions(hourKey);
            _advanceReturns(hourKey, now);
            _advanceDisputes(hourKey);
            _advanceAppeals(hourKey, now);
            if (_hasCs()) _staffAuto();
        } catch (e) {
            console.error('[AfterSalesEngine] tick error:', e);
        }
    }

    function _pendingConsultCount() {
        const list = (_gs.state.customerService && _gs.state.customerService.consultations) || [];
        let n = 0;
        for (let i = 0; i < list.length; i++) {
            if (list[i] && list[i].status === 'pending') n++;
        }
        return n;
    }

    function _genConsultations() {
        const state = _gs.state;
        const listings = (state.listings || []).filter(l => l.status === 'active');
        if (!listings.length) return;
        const questions = [
            '这个商品有货吗？', '什么时候发货？', '可以优惠一点吗？',
            '质量怎么样？是正品吗？', '支持七天无理由吗？', '发什么快递？', '有赠品吗？'
        ];
        const pendingCap = 80;
        if (_pendingConsultCount() >= pendingCap) return;

        const now = state.gameTime || { day: 1, hour: 0 };
        const rate = 0.50 + Math.random() * 0.20; // 新单咨询率 50%~70%
        const orders = state.orders || [];
        let created = 0;
        const maxPerTick = 30;

        for (let i = orders.length - 1; i >= 0 && created < maxPerTick; i--) {
            const o = orders[i];
            if (!o || o._consultGenerated) continue;
            const ct = o.createTime;
            if (!ct || ct.day !== now.day || ct.hour !== now.hour) continue;
            o._consultGenerated = true;
            if (Math.random() > rate) continue;
            if (_pendingConsultCount() >= pendingCap) break;
            csState.createConsultation({
                listingId: o.listingId,
                productId: o.productId,
                productName: o.productName,
                buyerName: o.buyerName,
                orderId: o.id,
                orderNo: o.orderNo || String(o.id).slice(-10),
                question: questions[Math.floor(Math.random() * questions.length)]
            });
            created++;
        }

        // 无新单时也保持售前咨询可见（约 50%~70%）
        if (created === 0) {
            const preRate = 0.50 + Math.random() * 0.20;
            const tries = Math.min(6, Math.max(2, listings.length));
            for (let i = 0; i < tries && created < maxPerTick; i++) {
                if (_pendingConsultCount() >= pendingCap) break;
                if (Math.random() > preRate) continue;
                const listing = listings[Math.floor(Math.random() * listings.length)];
                csState.createConsultation({
                    listingId: listing.id,
                    productId: listing.productId,
                    productName: listing.title,
                    question: questions[Math.floor(Math.random() * questions.length)]
                });
                created++;
            }
        }
    }

    function _getMaxReturnRate() {
        const cfg = (typeof SHOP_CONFIG !== 'undefined' && SHOP_CONFIG) ? SHOP_CONFIG : null;
        const n = cfg && cfg.maxReturnRate != null ? Number(cfg.maxReturnRate) : 0.10;
        if (!(n > 0) || !isFinite(n)) return 0.10;
        return Math.min(1, Math.max(0.01, n));
    }

    /** 当前退货率：returns / completed（全店或指定商品） */
    function _calcReturnRate(productId) {
        const state = _gs.state;
        const orders = state.orders || [];
        let completed = 0;
        for (let i = 0; i < orders.length; i++) {
            const o = orders[i];
            if (!o || (o.status !== 'completed' && o.status !== 'delivered')) continue;
            if (productId && o.productId !== productId) continue;
            completed++;
        }
        if (completed <= 0) return { completed: 0, returns: 0, rate: 0 };
        const rets = (state.customerService && state.customerService.returns) || [];
        let returns = 0;
        for (let i = 0; i < rets.length; i++) {
            const r = rets[i];
            if (!r) continue;
            if (productId && r.productId !== productId) continue;
            returns++;
        }
        return { completed, returns, rate: returns / completed };
    }

    function _canCreateReturn(productId) {
        const cap = _getMaxReturnRate();
        const global = _calcReturnRate(null);
        if (global.completed > 0 && (global.returns + 1) / global.completed > cap + 1e-9) {
            return false;
        }
        if (productId) {
            const per = _calcReturnRate(productId);
            if (per.completed > 0 && (per.returns + 1) / per.completed > cap + 1e-9) {
                return false;
            }
        }
        return true;
    }

    function _genReturns() {
        const state = _gs.state;
        const completed = (state.orders || []).filter(o => o.status === 'completed' && !o._returnProcessed);
        if (!completed.length) return;
        const maxRate = _getMaxReturnRate();
        // 全店已达硬顶则不再生成退货
        const globalNow = _calcReturnRate(null);
        if (globalNow.completed > 0 && globalNow.rate >= maxRate - 1e-9) {
            completed.forEach(o => { o._returnProcessed = true; });
            return;
        }
        // 收货/退货单保底 5%（需要买家寄回、商家收货），信誉只在 5%~10% 之间微调
        let returnRate = Math.max(0.05, 0.08 - Math.min((state.shop.reputation || 0) / 10000, 0.03));
        const shopLevel = state.shop && state.shop.level ? state.shop.level : 1;
        returnRate = Math.min(returnRate, maxRate);
        for (const order of completed) {
            const orderDay = (order.createTime && order.createTime.day) || 1;
            const daysAgo = state.gameTime.day - orderDay;
            if (daysAgo < 1 || daysAgo > 8) continue;
            if (!_canCreateReturn(order.productId)) {
                order._returnProcessed = true;
                continue;
            }
            const newbieMul = (typeof order._newbieReturnMultiplier === 'number' && order._newbieReturnMultiplier > 0)
                ? order._newbieReturnMultiplier : 1;
            if (Math.random() > returnRate * newbieMul * (daysAgo <= 7 ? 1 : 0.3)) continue;
            if (!_canCreateReturn(order.productId)) {
                order._returnProcessed = true;
                continue;
            }
            order._returnProcessed = true;
            // 退货退款/换货都要商家收货，合计压到绝大多数，保证收货订单可见
            const refundOnlyWeight = Math.max(0.10, 0.18 - (Math.max(1, Math.min(7, shopLevel)) - 1) * 0.01);
            const types = [
                { type: RETURN_TYPES.RETURN_REFUND, w: 0.70 },
                { type: RETURN_TYPES.REFUND_ONLY, w: refundOnlyWeight },
                { type: RETURN_TYPES.EXCHANGE, w: 0.20 }
            ];
            let roll = Math.random() * types.reduce((s, t) => s + t.w, 0);
            let chosen = types[0];
            for (const t of types) { if (roll < t.w) { chosen = t; break; } roll -= t.w; }
            const reasons = (typeof RETURN_REASONS !== 'undefined') ? RETURN_REASONS : [{ id: 'not_want', name: '不想要了' }];
            const reason = reasons[Math.floor(Math.random() * reasons.length)];
            csState.createReturn({
                orderId: order.id, orderNo: order.orderNo || String(order.id).slice(-10),
                productId: order.productId, productName: order.productName, quantity: order.quantity,
                buyerName: order.buyerName, type: chosen.type, reasonId: reason.id, reasonText: reason.name,
                amount: chosen.type === RETURN_TYPES.REFUND_ONLY ? order.totalAmount * (0.3 + Math.random() * 0.5) : order.totalAmount,
                // 带回原单成本/品质，供退货入库按真实成本入账（禁止 0 元 A 品）
                qualityGrade: order.qualityGrade || 'B',
                unitCost: (order.unitCost > 0 ? order.unitCost
                    : (order.costPrice > 0 ? order.costPrice
                        : (order.totalCost > 0 && order.quantity > 0 ? order.totalCost / order.quantity : 0))),
                costPrice: (order.costPrice > 0 ? order.costPrice
                    : (order.unitCost > 0 ? order.unitCost : 0)),
                // 便于 createReturn 在 productId 缺失时从 listing 回查
                listingId: order.listingId || null
            });
        }
    }

    function _handleMissed(now) {
        for (const c of _gs.state.customerService.consultations) {
            if (c.status !== CONSULTATION_STATUS.PENDING) continue;
            const passed = _hourKey(now) - _hourKey(c.createTime);
            if (passed >= 12) csState.markConsultationMissed(c.id);
        }
    }

    function _handleReactions(hourKey) {
        for (const c of _gs.state.customerService.consultations) {
            if (c.status !== CONSULTATION_STATUS.REPLIED || !c.replyTime) continue;
            const passed = hourKey - _hourKey(c.replyTime);
            if (passed < 6) continue;
            if (passed > 36) { csState.resolveConsultation(c.id); continue; }
            if (Math.random() < 0.35) csState.simulateBuyerReaction(c.id);
        }
    }

    function _advanceReturns(hourKey, now) {
        const inspCfg = (typeof CS_INSPECTION_CONFIG !== 'undefined') ? CS_INSPECTION_CONFIG : null;
        const hasCs = _hasCs();
        for (const r of _gs.state.customerService.returns) {
            // 买家寄回：买家侧行为，无需客服也可推进
            if (r.status === RETURN_STATUS.APPROVED && r.auditTime) {
                if (r._buyerWontReturn == null && r.type === RETURN_TYPES.RETURN_REFUND) {
                    r._buyerWontReturn = Math.random() < 0.16;
                }
                if (r._buyerWontReturn) {
                    r.goodsReturned = false;
                    r.goodsKeptByBuyer = true;
                    if (!r.alreadyRefunded && hourKey - _hourKey(r.auditTime) >= 36) {
                        if (r._platformForceRefund == null) r._platformForceRefund = Math.random() < 0.42;
                        if (r._platformForceRefund && typeof csState.forceRefundKeepGoods === 'function') {
                            csState.forceRefundKeepGoods(r.id, '平台先行退款，买家未寄回商品');
                        }
                    }
                } else if (hourKey - _hourKey(r.auditTime) > 6 + Math.random() * 18) {
                    const carriers = ['中通快递', '圆通速递', '申通快递', '韵达快递', '顺丰速运'];
                    const carrier = carriers[Math.floor(Math.random() * carriers.length)];
                    csState.buyerShipReturn(r.id, carrier, carrier[0] + Date.now().toString(36).toUpperCase().slice(-10));
                }
            }
            // 包裹到仓=收货，不依赖是否雇了客服；质检/退款仍要客服
            if (r.status === RETURN_STATUS.BUYER_SHIPPED && r.buyerShipTime) {
                if (hourKey - _hourKey(r.buyerShipTime) > 6 + Math.random() * 18) csState.sellerReceiveReturn(r.id);
            }
            if (!hasCs) continue;
            if (r.status === RETURN_STATUS.CS_INSPECTION && r.inspection && r.inspection.startTime) {
                const [lo, hi] = (inspCfg && inspCfg.inspectionDurationHours) || [2, 8];
                const dur = lo + Math.random() * Math.max(0, hi - lo);
                if (hourKey - _hourKey(r.inspection.startTime) >= Math.max(1, Math.floor(dur))) {
                    csState.completeCsInspection(r.id);
                }
            }
            if (r.status === RETURN_STATUS.INSPECTION_PASS && r.inspection && r.inspection.endTime) {
                if (hourKey - _hourKey(r.inspection.endTime) >= 2) csState.executeRefundAfterInspection(r.id);
            }
            if ((r.status === RETURN_STATUS.INSPECTION_FAIL ||
                (r.status === RETURN_STATUS.REJECTED && r.type === RETURN_TYPES.REFUND_ONLY)) && !r._appealAttempted) {
                r._appealAttempted = true;
                if (Math.random() < 0.22) {
                    try {
                        const res = csState.createAppeal({
                            returnId: r.id, groundId: 'consumer',
                            reason: r.inspectionFailReason || r.auditReply || '商家拒绝退款，要求法律介入',
                            evidences: [{ type: 'text', content: '沟通记录与实拍图' }],
                            claimIds: ['refund'], claimAmount: r.amount, demandStatement: '要求依法退款'
                        });
                        if (res && res.ok) {
                            csState.acceptAppeal(res.data.id);
                            setTimeout(() => csState.reviewAppeal(res.data.id), 200);
                            setTimeout(() => csState.scheduleAppealHearing(res.data.id), 400);
                            setTimeout(() => csState.ruleAppeal(res.data.id), 600);
                        }
                    } catch (_) { /* ignore */ }
                }
            }
        }
    }

    function _advanceDisputes(hourKey) {
        for (const d of _gs.state.customerService.disputes) {
            if (d.status === DISPUTE_STATUS.EVIDENCE && hourKey - _hourKey(d.createTime) > 24) {
                if (Math.random() < 0.7) csState.addBuyerEvidence(d.id, '商品实拍与聊天记录');
                csState.startMediation(d.id, '举证期结束，平台介入调解');
            }
            if (d.status === DISPUTE_STATUS.MEDIATION && hourKey - _hourKey(d.createTime) > 36) {
                csState.addMediationRecord(d.id, 'system', '双方无法达成一致，移交仲裁');
                csState.startArbitration(d.id);
                setTimeout(() => csState.executeArbitration(d.id), 300);
            }
        }
    }

    function _advanceAppeals(hourKey, now) {
        const cfg = (typeof APPEAL_CONFIG !== 'undefined') ? APPEAL_CONFIG : null;
        const sched = (cfg && cfg.scheduleHours) || [24, 96];
        const review = (cfg && cfg.reviewHours) || [48, 168];
        for (const a of (_gs.state.customerService.appeals || [])) {
            const from = t => t ? hourKey - _hourKey(t) : 0;
            const ageDays = now && a.createTime ? (now.day - (a.createTime.day || now.day)) : 0;
            if (a.status === APPEAL_STATUS.SUBMITTED && (from(a.createTime) >= 1 || ageDays >= 1)) csState.acceptAppeal(a.id);
            if (a.status === APPEAL_STATUS.ACCEPTED && a.acceptedTime && from(a.acceptedTime) >= 3) {
                csState.reviewAppeal(a.id, '双方材料已提交，开始审核');
            }
            if (a.status === APPEAL_STATUS.REVIEWING && a.reviewTime) {
                const lo = sched[0] || 24, hi = sched[1] || 96;
                if (from(a.reviewTime) >= lo + Math.random() * Math.max(1, hi - lo)) {
                    csState.scheduleAppealHearing(a.id, `排期至 D${now.day} 线上庭审`);
                }
            }
            if (a.status === APPEAL_STATUS.HEARING_SCHEDULED && a.scheduledTime) {
                const lo = review[0] || 48, hi = review[1] || 168;
                if (from(a.scheduledTime) >= lo / 3 + Math.random() * (hi / 3)) csState.ruleAppeal(a.id);
            }
            if (a.status === APPEAL_STATUS.RULED_BUYER && a.ruledTime && from(a.ruledTime) >= 2) {
                csState.executeAppealCompensation(a.id);
            }
        }
    }

    function _staffAuto() {
        const staff = (_gs.state.employees || []).filter(e =>
            e && e.status === 'active' &&
            (e.type === 'customerService' || e.position === 'customerService')
        );
        if (!staff.length || typeof QUICK_REPLIES === 'undefined') return;
        const pending = _gs.state.customerService.consultations.filter(c => c.status === 'pending');
        for (const emp of staff) {
            if (Math.random() > 0.4 + (emp.level || 1) * 0.08) continue;
            const c = pending.shift();
            if (!c) break;
            const cat = QUICK_REPLIES[Math.floor(Math.random() * QUICK_REPLIES.length)];
            const reply = cat.items[Math.floor(Math.random() * cat.items.length)].text;
            csState.replyConsultation(c.id, reply, `${emp.name}(自动)`);
        }
    }

    function triggerTestEvent(type) {
        const state = _gs.state;
        if (type === 'consultation') { _genConsultations(); return '已触发买家咨询'; }
        if (type === 'return') {
            const order = (state.orders || []).find(o => o.status === 'completed' && !o._returnProcessed);
            if (!order) return '没有可用的已完成订单';
            order._returnProcessed = true;
            csState.createReturn({
                orderId: order.id, orderNo: order.orderNo || String(order.id).slice(-10),
                productId: order.productId, productName: order.productName, quantity: order.quantity,
                buyerName: order.buyerName, type: RETURN_TYPES.RETURN_REFUND,
                reasonId: 'quality', reasonText: '商品质量问题', amount: order.totalAmount,
                qualityGrade: order.qualityGrade || 'B',
                unitCost: (order.unitCost > 0 ? order.unitCost
                    : (order.costPrice > 0 ? order.costPrice
                        : (order.totalCost > 0 && order.quantity > 0 ? order.totalCost / order.quantity : 0))),
                costPrice: (order.costPrice > 0 ? order.costPrice
                    : (order.unitCost > 0 ? order.unitCost : 0)),
                listingId: order.listingId || null
            });
            return '已触发退换货申请';
        }
        if (type === 'dispute') {
            const o = (state.orders || [])[0];
            if (!o) return '没有可用订单';
            csState.createDispute({
                orderId: o.id, orderNo: o.orderNo, productName: o.productName, buyerName: o.buyerName,
                typeId: 'quality', reason: '测试纠纷', amount: o.totalAmount
            });
            return '已触发纠纷';
        }
        return '未知事件类型';
    }

    return { init, tick, triggerTestEvent };
})();

const csEngine = AfterSalesEngine;
if (typeof window !== 'undefined') {
    window.AfterSalesEngine = AfterSalesEngine;
    window.csEngine = AfterSalesEngine;
}
