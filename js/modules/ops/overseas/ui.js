/**
 * 海外贸易中心 — 外贸订单：接单 → 进货 → 发货 → 收款（整单 25～45 天）
 */
(function () {
    'use strict';

    const REGIONS = [
        { id: 'sea', name: '东南亚', icon: '🌴', feeRate: 0.08, demand: 1.08, unlockDay: 1, freightRate: 0.04 },
        { id: 'eu', name: '欧洲', icon: '🇪🇺', feeRate: 0.12, demand: 1.12, unlockDay: 15, freightRate: 0.06 },
        { id: 'na', name: '北美', icon: '🗽', feeRate: 0.14, demand: 1.15, unlockDay: 25, freightRate: 0.07 },
        { id: 'me', name: '中东', icon: '🏜️', feeRate: 0.1, demand: 1.1, unlockDay: 10, freightRate: 0.05 }
    ];

    const DAILY_EXPORT_CAP = 2000000;
    const MAX_MARKUP = 3.5;
    const MAX_INQUIRIES = 3;
    const MAX_ACTIVE_ORDERS = 6;
    const BUYER_NAMES = ['Pacific Trade Co.', 'Nordic Import GmbH', 'Sahara Goods LLC', 'Lotus Mart Sdn Bhd', 'Maple Retail Inc.', 'Desert Star Trading'];

    const STATUS_LABEL = {
        inquiry: { name: '待接单', color: '#1565c0' },
        sourcing: { name: '备货中', color: '#ef6c00' },
        ready: { name: '待发货', color: '#6a1b9a' },
        in_transit: { name: '运输中', color: '#0277bd' },
        awaiting_payment: { name: '待收款', color: '#2e7d32' },
        settled: { name: '已收款', color: '#2e7d32' },
        cancelled: { name: '已取消', color: '#9e9e9e' }
    };

    let _lock = false;

    function _gs() { return (typeof gameState !== 'undefined') ? gameState : null; }
    function _ui() { return (typeof ui !== 'undefined') ? ui : null; }
    function _fmt(n) {
        return typeof formatMoney === 'function' ? formatMoney(n) : ('¥' + (Number(n) || 0).toFixed(2));
    }
    function _day() {
        const gs = _gs();
        return (gs && gs.state && gs.state.gameTime && gs.state.gameTime.day) || 1;
    }
    function _id(prefix) {
        return prefix + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    }

    function getDailyExportCap() {
        const gs = _gs();
        const lv = (gs && gs.state && gs.state.shop && gs.state.shop.level) || 1;
        if (lv >= 10) return 20000000;
        if (lv >= 8) return 8000000;
        if (lv >= 7) return 2000000;
        return DAILY_EXPORT_CAP;
    }

    function getMaxActiveOrders() {
        const gs = _gs();
        const lv = (gs && gs.state && gs.state.shop && gs.state.shop.level) || 1;
        if (lv >= 10) return 16;
        if (lv >= 8) return 10;
        return 6;
    }

    function _ensureState() {
        const gs = _gs();
        if (!gs || !gs.state) return null;
        if (!gs.state.overseas || typeof gs.state.overseas !== 'object') {
            gs.state.overseas = {
                unlocked: !!(gs.state.shop && gs.state.shop.overseasUnlocked),
                shipments: [],
                inquiries: [],
                orders: [],
                pendingSettlements: [],
                regulations: [],
                stats: { exportRevenue: 0, shipmentCount: 0, dutyPaid: 0, freightPaid: 0 },
                dailyExport: { day: 0, amount: 0 }
            };
        }
        const o = gs.state.overseas;
        if (!Array.isArray(o.shipments)) o.shipments = [];
        if (!Array.isArray(o.inquiries)) o.inquiries = [];
        if (!Array.isArray(o.orders)) o.orders = [];
        if (!Array.isArray(o.pendingSettlements)) o.pendingSettlements = [];
        if (!Array.isArray(o.regulations)) o.regulations = [];
        if (!o.stats) o.stats = { exportRevenue: 0, shipmentCount: 0, dutyPaid: 0, freightPaid: 0 };
        if (!o.dailyExport) o.dailyExport = { day: 0, amount: 0 };
        if (!o.exchangeRates || typeof o.exchangeRates !== 'object') o.exchangeRates = {};
        if (!o.exchangePrev || typeof o.exchangePrev !== 'object') o.exchangePrev = {};
        REGIONS.forEach(r => {
            if (!(o.exchangeRates[r.id] > 0)) o.exchangeRates[r.id] = 1.0;
            if (!(o.exchangePrev[r.id] > 0)) o.exchangePrev[r.id] = o.exchangeRates[r.id];
        });
        o.unlocked = !!(o.unlocked || (gs.state.shop && gs.state.shop.overseasUnlocked));
        return o;
    }

    function _estimateUnitCost(productId, grade) {
        const gs = _gs();
        try {
            const wh = (typeof warehouseState !== 'undefined' && warehouseState)
                ? warehouseState : (gs && gs.warehouse);
            if (wh && typeof wh._estimatePurchaseUnitCost === 'function') {
                const c = wh._estimatePurchaseUnitCost(productId, grade);
                if (c > 0) return c;
            }
        } catch (_) {}
        try {
            const listings = (gs && gs.state && gs.state.listings) || [];
            const listing = listings.find(l => l && l.productId === productId);
            if (listing) {
                const c = Number(listing.costPrice || listing.cost || listing.avgCost || 0);
                if (c > 0) return c;
            }
        } catch (_) {}
        try {
            if (typeof getProductById === 'function') {
                const p = getProductById(productId);
                if (p && p.basePrice > 0) return Number(p.basePrice);
            }
        } catch (_) {}
        return 0;
    }

    function _stock(productId, grade) {
        const gs = _gs();
        if (!gs || typeof gs.getInventoryQuantity !== 'function') return 0;
        return gs.getInventoryQuantity(productId, grade) || 0;
    }

    function _splitTradeDays() {
        const total = 25 + Math.floor(Math.random() * 21);
        let source = Math.max(8, Math.min(15, Math.round(total * 0.32)));
        let transit = Math.max(10, Math.min(18, Math.round(total * 0.42)));
        let payment = total - source - transit;
        if (payment < 5) {
            transit = Math.max(10, transit - (5 - payment));
            payment = 5;
        }
        if (payment > 12) {
            transit = Math.min(18, transit + (payment - 12));
            payment = 12;
        }
        const sum = source + transit + payment;
        if (sum < 25) payment += (25 - sum);
        if (sum > 45) {
            const cut = sum - 45;
            if (transit - cut >= 10) transit -= cut;
            else payment = Math.max(5, payment - cut);
        }
        return { total: source + transit + payment, source, transit, payment };
    }

    function _pickSku(gs) {
        const listings = (gs.state.listings || []).filter(l => l && l.status === 'active');
        if (listings.length) {
            const l = listings[Math.floor(Math.random() * listings.length)];
            const p = (typeof getProductById === 'function') ? getProductById(l.productId) : null;
            return {
                productId: l.productId,
                productName: (p && p.name) || l.title || l.productId,
                grade: l.qualityGrade || 'B',
                listPrice: Number(l.price || 0)
            };
        }
        const inv = (gs.state.inventory || []).filter(i => i && i.quantity > 0 && i.productId);
        if (inv.length) {
            const i = inv[Math.floor(Math.random() * inv.length)];
            const p = (typeof getProductById === 'function') ? getProductById(i.productId) : null;
            return {
                productId: i.productId,
                productName: (p && p.name) || i.productId,
                grade: i.qualityGrade || 'B',
                listPrice: Number(i.costPrice || 0) * 1.4
            };
        }
        if (typeof PRODUCTS !== 'undefined' && Array.isArray(PRODUCTS) && PRODUCTS.length) {
            const p = PRODUCTS[Math.floor(Math.random() * Math.min(PRODUCTS.length, 40))];
            return {
                productId: p.id,
                productName: p.name,
                grade: 'B',
                listPrice: Number(p.basePrice || 0) * 1.3
            };
        }
        return null;
    }

    function _openRegions(day) {
        return REGIONS.filter(r => day >= r.unlockDay);
    }

    function generateInquiry(force) {
        const gs = _gs();
        const o = _ensureState();
        if (!gs || !o || !o.unlocked) return null;
        const day = _day();
        const pendingIq = (o.inquiries || []).filter(x => x && x.status === 'inquiry');
        const activeOd = (o.orders || []).filter(x => x && ['sourcing', 'ready', 'in_transit', 'awaiting_payment'].indexOf(x.status) >= 0);
        if (pendingIq.length >= MAX_INQUIRIES || activeOd.length >= getMaxActiveOrders()) return null;
        if (!force && Math.random() > 0.45) return null;

        const regions = _openRegions(day);
        if (!regions.length) return null;
        const region = regions[Math.floor(Math.random() * regions.length)];
        const sku = _pickSku(gs);
        if (!sku) return null;

        const unitCost = _estimateUnitCost(sku.productId, sku.grade);
        const qty = 20 + Math.floor(Math.random() * 81);
        let unitPrice = (sku.listPrice > 0 ? sku.listPrice : unitCost * 1.4) * region.demand;
        if (unitCost > 0 && unitPrice > unitCost * MAX_MARKUP) unitPrice = unitCost * MAX_MARKUP;
        if (!(unitPrice > 0)) unitPrice = Math.max(1, unitCost * 1.2);
        const timing = _splitTradeDays();
        const gross = Math.round(unitPrice * qty * 100) / 100;
        const duty = Math.round(gross * region.feeRate * 100) / 100;
        const freight = Math.round(gross * region.freightRate * 100) / 100;
        const rec = {
            id: _id('ovi_'),
            status: 'inquiry',
            regionId: region.id,
            regionIcon: region.icon,
            regionName: region.name,
            buyerName: BUYER_NAMES[Math.floor(Math.random() * BUYER_NAMES.length)],
            productId: sku.productId,
            productName: sku.productName,
            grade: sku.grade,
            qty,
            unitCost,
            unitPrice: Math.round(unitPrice * 100) / 100,
            gross, duty, freight,
            sourceDays: timing.source,
            transitDays: timing.transit,
            paymentDays: timing.payment,
            totalDays: timing.total,
            day,
            expireDay: day + 5
        };
        o.inquiries.unshift(rec);
        if (o.inquiries.length > 40) o.inquiries = o.inquiries.slice(0, 40);
        return rec;
    }

    function acceptInquiry(inquiryId) {
        const u = _ui();
        const o = _ensureState();
        if (!o) return;
        const iq = (o.inquiries || []).find(x => x && x.id === inquiryId && x.status === 'inquiry');
        if (!iq) { if (u) u.showToast('询盘已失效'); return; }
        const activeOd = (o.orders || []).filter(x => x && ['sourcing', 'ready', 'in_transit', 'awaiting_payment'].indexOf(x.status) >= 0);
        if (activeOd.length >= getMaxActiveOrders()) {
            if (u) u.showToast('在手外贸单已满（当前上限 ' + getMaxActiveOrders() + ' 单），可升店铺等级或先完成现有订单');
            return;
        }
        const day = _day();
        const order = Object.assign({}, iq, {
            id: _id('ovo_'),
            inquiryId: iq.id,
            status: 'sourcing',
            acceptDay: day,
            sourceDueDay: day + (iq.sourceDays || 10),
            settleDay: day + (iq.totalDays || 30),
            sourced: false,
            shipped: false
        });
        iq.status = 'accepted';
        o.orders.unshift(order);
        if (o.orders.length > 80) o.orders = o.orders.slice(0, 80);
        if (typeof _gs().notify === 'function') _gs().notify();
        if (u) u.showToast(`已接单 ${order.buyerName}，请在第${order.sourceDueDay}天前备货并发货`);
        show();
    }

    function declineInquiry(inquiryId) {
        const o = _ensureState();
        const u = _ui();
        if (!o) return;
        const iq = (o.inquiries || []).find(x => x && x.id === inquiryId);
        if (!iq) return;
        iq.status = 'declined';
        if (u) u.showToast('已拒绝该询盘');
        show();
    }

    function _returnStock(order) {
        const gs = _gs();
        if (!gs || !order || !order.sourced || order.stockReturned) return;
        try {
            if (typeof gs.addInventory === 'function') {
                gs.addInventory({
                    productId: order.productId,
                    quantity: order.qty,
                    qualityGrade: order.grade || 'B',
                    costPrice: Math.max(0.01, Number(order.unitCost) || 1),
                    purchaseOrderId: 'ov_return_' + order.id
                }, { prepaid: true, skipCharge: true, allowZeroCost: false });
            }
            order.stockReturned = true;
        } catch (_) {}
    }

    function sourceOrder(orderId) {
        const gs = _gs();
        const u = _ui();
        const o = _ensureState();
        if (!gs || !o) return;
        if (_lock) { if (u) u.showToast('处理中'); return; }
        _lock = true;
        try {
            const order = (o.orders || []).find(x => x && x.id === orderId);
            if (!order || order.status !== 'sourcing') {
                if (u) u.showToast('订单状态不可备货');
                return;
            }
            const day = _day();
            if (day > (order.sourceDueDay || 0)) {
                if (u) u.showToast('已过备货期限');
                return;
            }
            const inv = _stock(order.productId, order.grade);
            if (inv < order.qty) {
                if (u) u.showToast(`库存不足（需要 ${order.qty}，现有 ${inv}），请先采购进货`);
                return;
            }
            if (typeof gs.removeInventory === 'function') {
                const ok = gs.removeInventory(order.productId, order.qty, order.grade, { orderId: order.id });
                if (!ok) {
                    if (u) u.showToast('扣减库存失败');
                    return;
                }
            }
            order.sourced = true;
            order.sourcedDay = day;
            order.status = 'ready';
            if (typeof gs.notify === 'function') gs.notify();
            if (u) u.showToast('已从库存备货，请尽快发运');
            show();
        } finally {
            setTimeout(() => { _lock = false; }, 400);
        }
    }

    function applyCustoms(orderId) {
        const gs = _gs();
        const u = _ui();
        const o = _ensureState();
        if (!gs || !o) return;
        const order = (o.orders || []).find(x => x && x.id === orderId);
        if (!order) { if (u) u.showToast('订单不存在'); return; }
        if (order.customsCleared) { if (u) u.showToast('已申请过海关临额'); return; }
        const fee = Math.max(50, Math.round((Number(order.gross) || 0) * 0.004));
        if (typeof gs.spendFunds === 'function' && !gs.spendFunds(fee, `海关临时额度-${order.regionName || ''}`)) {
            if (u) u.showToast('资金不足，无法缴纳海关申请费 ' + _fmt(fee));
            return;
        }
        const day = _day();
        order.customsCleared = true;
        order.customsReadyDay = day + 1;
        if (typeof gs.notify === 'function') gs.notify();
        if (u) u.showToast('海关已受理，明天起本单不占当日出口限额');
        show();
    }

    function shipOrder(orderId, silent) {
        const gs = _gs();
        const u = _ui();
        const o = _ensureState();
        if (!gs || !o) return { success: false };
        const order = (o.orders || []).find(x => x && x.id === orderId);
        if (!order || (order.status !== 'ready' && !(order.status === 'sourcing' && order.sourced))) {
            if (!silent && u) u.showToast('请先备货再发运');
            return { success: false };
        }
        const day = _day();
        const freight = Math.round((Number(order.freight) || 0) * 100) / 100;
        if (freight > 0) {
            if (typeof gs.spendFunds === 'function') {
                if (!gs.spendFunds(freight, `海外运费-${order.regionName}`)) {
                    if (!silent && u) u.showToast('资金不足，无法支付国际运费');
                    return { success: false };
                }
            }
        }
        const exRate = getExchangeRate(order.regionId);
        let net = Math.round((Number(order.gross) - Number(order.duty) - Number(order.freight)) * exRate * 100) / 100;
        const maxNet = Math.round((Number(order.unitCost) || 0) * order.qty * 1.8 * 100) / 100;
        if (maxNet > 0 && net > maxNet) net = maxNet;
        if (o.dailyExport.day !== day) o.dailyExport = { day, amount: 0 };
        const customsOk = !!(order.customsCleared && day >= (order.customsReadyDay || 0));
        if (!customsOk && (o.dailyExport.amount || 0) + net > getDailyExportCap()) {
            if (freight > 0 && typeof gs.addFunds === 'function') gs.addFunds(freight, `海外运费退回-${order.regionName}`);
            if (!silent && u) u.showToast('已达单日出口上限');
            return { success: false };
        }
        order.status = 'in_transit';
        order.shipped = true;
        order.shipDay = day;
        order.arriveDay = day + (order.transitDays || 12);
        order.exRate = exRate;
        order.netIncome = net;
        o.dailyExport.amount = Math.round(((o.dailyExport.amount || 0) + net) * 100) / 100;
        o.stats.shipmentCount = (o.stats.shipmentCount || 0) + 1;
        o.stats.dutyPaid = Math.round(((o.stats.dutyPaid || 0) + (order.duty || 0)) * 100) / 100;
        o.stats.freightPaid = Math.round(((o.stats.freightPaid || 0) + freight) * 100) / 100;
        o.shipments.unshift({
            id: order.id, regionIcon: order.regionIcon, regionName: order.regionName,
            productName: order.productName, qty: order.qty, netIncome: net, day, settleDay: order.settleDay,
            status: 'in_transit'
        });
        if (o.shipments.length > 50) o.shipments = o.shipments.slice(0, 50);
        if (typeof gs.notify === 'function') gs.notify();
        if (!silent && u) {
            u.showToast(`已发往${order.regionName}，货款 ${_fmt(net)} 将于第${order.settleDay}天到账`);
            show();
        }
        return { success: true };
    }

    function goProcure(orderId) {
        const u = _ui();
        if (!u) return;
        const o = _ensureState();
        const order = (o && o.orders || []).find(x => x && x.id === orderId);
        try { u.closeModal(); } catch (_) {}
        setTimeout(() => {
            try {
                if (order && order.productId && typeof u.quickPurchaseFromMarket === 'function') {
                    const inv = _stock(order.productId, order.grade);
                    const need = Math.max(1, (Number(order.qty) || 1) - (Number(inv) || 0));
                    u.quickPurchaseFromMarket(order.productId, { qty: need, grade: order.grade || 'B' });
                    return;
                }
                if (typeof u.showProcurementCenter === 'function') u.showProcurementCenter('supply');
                else if (typeof u.showWarehouseModal === 'function') u.showWarehouseModal();
            } catch (_) {}
        }, 80);
    }

    function updateExchangeRates() {
        const o = _ensureState();
        if (!o) return;
        REGIONS.forEach(r => {
            o.exchangePrev[r.id] = o.exchangeRates[r.id];
            const drift = (Math.random() * 0.04) - 0.02;
            let rate = (o.exchangeRates[r.id] || 1.0) + drift;
            rate = Math.max(0.90, Math.min(1.10, Math.round(rate * 10000) / 10000));
            o.exchangeRates[r.id] = rate;
        });
    }

    function getExchangeRate(regionId) {
        const o = _ensureState();
        const r = o && o.exchangeRates && o.exchangeRates[regionId];
        return (r > 0) ? r : 1.0;
    }

    function getExchangeTrend(regionId) {
        const o = _ensureState();
        if (!o) return 'flat';
        const cur = o.exchangeRates[regionId] || 1.0;
        const prev = o.exchangePrev[regionId] || cur;
        if (cur > prev + 0.0005) return 'up';
        if (cur < prev - 0.0005) return 'down';
        return 'flat';
    }

    function _settleOrder(order, gs, o) {
        const net = Math.round((Number(order.netIncome) || 0) * 100) / 100;
        if (net > 0) {
            if (typeof gs.addFunds === 'function') {
                gs.addFunds(net, `海外出口到账-${order.productName || ''}`);
            } else if (gs.state.shop) {
                gs.state.shop.funds = (gs.state.shop.funds || 0) + net;
            }
            try {
                if (gs.state.shop) {
                    gs.state.shop.totalSalesAmount = Math.round(((gs.state.shop.totalSalesAmount || 0) + net) * 100) / 100;
                }
            } catch (_) {}
            o.stats.exportRevenue = Math.round(((o.stats.exportRevenue || 0) + net) * 100) / 100;
        }
        order.status = 'settled';
        const ship = (o.shipments || []).find(x => x.id === order.id);
        if (ship) ship.status = 'settled';
        return net;
    }

    function processDailySettlements() {
        const gs = _gs();
        const o = _ensureState();
        if (!gs || !o) return { settled: 0, amount: 0, inquiries: 0, cancelled: 0 };
        updateExchangeRates();
        const day = _day();
        let settled = 0;
        let amount = 0;
        let cancelled = 0;
        let inquiries = 0;
        let autoShipped = 0;

        if (o.unlocked) {
            const n = generateInquiry(false);
            if (n) inquiries++;
            if (!(o.inquiries || []).some(x => x && x.status === 'inquiry')
                && !(o.orders || []).some(x => x && ['sourcing', 'ready', 'in_transit', 'awaiting_payment'].indexOf(x.status) >= 0)) {
                const extra = generateInquiry(true);
                if (extra) inquiries++;
            }
        }

        (o.inquiries || []).forEach(iq => {
            if (iq && iq.status === 'inquiry' && (iq.expireDay || 0) < day) iq.status = 'expired';
        });

        (o.orders || []).forEach(order => {
            if (!order) return;
            if (order.status === 'sourcing' && day > (order.sourceDueDay || 0) && !order.sourced) {
                order.status = 'cancelled';
                order.cancelReason = '逾期未备货';
                cancelled++;
                return;
            }
            if (order.status === 'ready' && day > (order.sourceDueDay || 0) + 2) {
                const r = shipOrder(order.id, true);
                if (r && r.success) autoShipped++;
                else {
                    _returnStock(order);
                    order.status = 'cancelled';
                    order.cancelReason = '逾期未发运';
                    cancelled++;
                }
                return;
            }
            if (order.status === 'in_transit' && day >= (order.arriveDay || 0)) {
                order.status = 'awaiting_payment';
            }
            if ((order.status === 'awaiting_payment' || order.status === 'in_transit') && day >= (order.settleDay || 0) && order.shipped) {
                if (order.status === 'in_transit') order.status = 'awaiting_payment';
                amount += _settleOrder(order, gs, o);
                settled++;
            }
        });

        const pending = o.pendingSettlements || [];
        for (let i = pending.length - 1; i >= 0; i--) {
            const s = pending[i];
            if (!s || s.status !== 'pending') continue;
            if ((s.settleDay || 0) > day) continue;
            const net = Math.round((Number(s.netIncome) || 0) * 100) / 100;
            if (net > 0) {
                if (typeof gs.addFunds === 'function') gs.addFunds(net, `海外出口到账-${s.productName || ''}`);
                else if (gs.state.shop) gs.state.shop.funds = (gs.state.shop.funds || 0) + net;
                try {
                    if (gs.state.shop) {
                        gs.state.shop.totalSalesAmount = Math.round(((gs.state.shop.totalSalesAmount || 0) + net) * 100) / 100;
                    }
                } catch (_) {}
                amount += net;
                o.stats.exportRevenue = Math.round(((o.stats.exportRevenue || 0) + net) * 100) / 100;
            }
            s.status = 'settled';
            settled++;
            const ship = (o.shipments || []).find(x => x.id === s.id);
            if (ship) ship.status = 'settled';
            pending.splice(i, 1);
        }

        if ((settled > 0 || cancelled > 0) && typeof gs.notify === 'function') gs.notify();
        return { settled, amount, inquiries, cancelled, autoShipped };
    }

    function addRegulation(reg) {
        const o = _ensureState();
        if (!o || !reg) return;
        o.regulations.unshift(reg);
        if (o.regulations.length > 20) o.regulations = o.regulations.slice(0, 20);
    }

    function isUnlocked() {
        const o = _ensureState();
        return !!(o && o.unlocked);
    }

    function _orderCard(order, day) {
        const st = STATUS_LABEL[order.status] || { name: order.status, color: '#666' };
        const leftSettle = Math.max(0, (order.settleDay || 0) - day);
        const inv = _stock(order.productId, order.grade);
        let actions = '';
        if (order.status === 'sourcing') {
            actions = `
                <button class="btn btn-primary btn-xs" onclick="overseasUI.sourceOrder('${order.id}')">从库存备货（现有${inv}）</button>
                <button class="btn btn-secondary btn-xs" onclick="overseasUI.goProcure('${order.id}')">去采购</button>`;
        } else if (order.status === 'ready') {
            actions = `<button class="btn btn-primary btn-xs" onclick="overseasUI.shipOrder('${order.id}')">发货运出</button>`;
        }
        if ((order.status === 'sourcing' || order.status === 'ready') && !order.customsCleared) {
            const fee = Math.max(50, Math.round((Number(order.gross) || 0) * 0.004));
            actions += `<button class="btn btn-secondary btn-xs" onclick="overseasUI.applyCustoms('${order.id}')">海关临额（${_fmt(fee)}）</button>`;
        } else if (order.customsCleared) {
            actions += `<span style="font-size:11px;color:#2e7d32;">海关已批，本单不占日限额</span>`;
        }
        return `
            <div style="padding:10px 12px;border:1px solid #eee;border-radius:10px;margin-bottom:8px;background:#fff;">
                <div style="display:flex;justify-content:space-between;gap:8px;">
                    <div>
                        <b>${order.regionIcon || '🌍'} ${order.buyerName || order.regionName}</b>
                        <div style="font-size:12px;color:#555;margin-top:2px;">${order.productName || ''} ×${order.qty} · ${order.grade || 'B'}级</div>
                    </div>
                    <span style="font-size:11px;color:${st.color};font-weight:700;white-space:nowrap;">${st.name}</span>
                </div>
                <div style="font-size:11px;color:#888;margin-top:6px;line-height:1.6;">
                    货款约 ${_fmt(order.gross)} · 关税 ${_fmt(order.duty)} · 运费 ${_fmt(order.freight)}
                    <br>周期 ${order.totalDays}天（备货${order.sourceDays}/在途${order.transitDays}/账期${order.paymentDays}）
                    · 收款日 D${order.settleDay}${order.status !== 'settled' && order.status !== 'cancelled' ? '（还剩' + leftSettle + '天）' : ''}
                    ${order.status === 'sourcing' ? '<br>备货截止 D' + order.sourceDueDay + ' · 库存 ' + inv : ''}
                </div>
                ${actions ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">${actions}</div>` : ''}
            </div>`;
    }

    function show() {
        const u = _ui();
        if (!u) return;
        const gs = _gs();
        const o = _ensureState();
        if (!o) {
            u.showToast('游戏状态不可用');
            return;
        }
        if (!o.unlocked) {
            const lv = (gs && gs.state && gs.state.shop && gs.state.shop.level) || 1;
            const need = 7;
            const gap = Math.max(0, need - lv);
            u.showModal('🌍 海外贸易', `
                <div style="padding:16px;line-height:1.7;font-size:14px;color:#444;">
                    <div style="font-size:40px;text-align:center;margin-bottom:8px;">🔒</div>
                    <div style="text-align:center;font-weight:700;margin-bottom:8px;">海外市场尚未解锁</div>
                    <div>当前店铺 <b>Lv.${lv}</b>，需升至 <b>Lv.${need} 金冠</b> 后开放外贸订单。</div>
                    <div style="margin-top:8px;color:#666;">${gap > 0 ? ('还差 ' + gap + ' 级。解锁后可接海外询盘：备货、发运、账期收款，单程 25～45 天。') : '已达等级，请升级店铺以开启海外。'}</div>
                </div>`,
                `<button class="btn btn-secondary" onclick="ui.closeModal()">知道了</button>
                 <button class="btn btn-primary" onclick="ui.closeModal();ui.showShopUpgradeModal();">去店铺升级</button>`,
                { width: '480px', modalId: 'overseasLockedModal' });
            return;
        }
        const _showDay = _day();
        if (!(o.inquiries || []).some(x => x && x.status === 'inquiry') && o._lastShowInquiryDay !== _showDay) {
            generateInquiry(true);
            o._lastShowInquiryDay = _showDay;
        }
        const day = _showDay;
        const regs = (o.regulations || []).filter(r => !r.untilDay || r.untilDay >= day);
        const inquiries = (o.inquiries || []).filter(x => x && x.status === 'inquiry');
        const active = (o.orders || []).filter(x => x && ['sourcing', 'ready', 'in_transit', 'awaiting_payment'].indexOf(x.status) >= 0);
        const done = (o.orders || []).filter(x => x && (x.status === 'settled' || x.status === 'cancelled')).slice(0, 8);
        const pendingOld = (o.pendingSettlements || []).filter(s => s.status === 'pending');

        const content = `
            <div style="padding:10px;font-size:13px;">
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;">
                    <div style="background:#e3f2fd;border-radius:10px;padding:10px;text-align:center;">
                        <div style="font-size:11px;color:#666;">出口营收</div>
                        <div style="font-weight:800;color:#1565c0;">${_fmt(o.stats.exportRevenue || 0)}</div>
                    </div>
                    <div style="background:#e8f5e9;border-radius:10px;padding:10px;text-align:center;">
                        <div style="font-size:11px;color:#666;">发货批次</div>
                        <div style="font-weight:800;color:#2e7d32;">${o.stats.shipmentCount || 0}</div>
                    </div>
                    <div style="background:#fff3e0;border-radius:10px;padding:10px;text-align:center;">
                        <div style="font-size:11px;color:#666;">关税已缴</div>
                        <div style="font-weight:800;color:#e65100;">${_fmt(o.stats.dutyPaid || 0)}</div>
                    </div>
                </div>
                <div style="background:#e3f2fd;border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:11px;color:#0d47a2;line-height:1.5;">
                    外贸订单：接单 → 进货备货 → 发运 → 账期收款。整单 <b>25～45 天</b> 到账。在手单上限 <b>${getMaxActiveOrders()}</b>。默认日限额 ${_fmt(getDailyExportCap())}，可向海关申请按订单额临时放行。
                </div>
                <div style="font-weight:700;margin:8px 0;">📨 待接询盘</div>
                ${inquiries.length ? inquiries.map(iq => `
                    <div style="padding:10px 12px;border:1px solid #bbdefb;border-radius:10px;margin-bottom:8px;background:#fafcff;">
                        <div><b>${iq.regionIcon} ${iq.buyerName}</b> · ${iq.regionName}</div>
                        <div style="font-size:12px;color:#555;margin:4px 0;">${iq.productName} ×${iq.qty} · 报价 ${_fmt(iq.unitPrice)}/件</div>
                        <div style="font-size:11px;color:#888;">周期 ${iq.totalDays}天 · 询盘至 D${iq.expireDay} · 货值 ${_fmt(iq.gross)}</div>
                        <div style="display:flex;gap:6px;margin-top:8px;">
                            <button class="btn btn-primary btn-xs" onclick="overseasUI.acceptInquiry('${iq.id}')">接单</button>
                            <button class="btn btn-secondary btn-xs" onclick="overseasUI.declineInquiry('${iq.id}')">拒绝</button>
                        </div>
                    </div>`).join('') : `<div style="color:#999;font-size:12px;margin-bottom:8px;">暂无询盘，过几天会有新买家找上门。</div>`}
                <div style="font-weight:700;margin:12px 0 6px;">📦 在手订单</div>
                ${active.length ? active.map(od => _orderCard(od, day)).join('') : '<div style="color:#999;font-size:12px;">暂无在手外贸单</div>'}
                ${pendingOld.length ? `
                <div style="font-weight:700;margin:12px 0 6px;">⏳ 旧版在途货款</div>
                ${pendingOld.slice(0, 4).map(s => `
                    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f5f5f5;font-size:12px;">
                        <span>${s.regionIcon || '🌍'} ${s.productName || ''} ×${s.qty}</span>
                        <span style="color:#ef6c00;">${_fmt(s.netIncome)} · D${s.settleDay}到账</span>
                    </div>`).join('')}` : ''}
                <div style="font-weight:700;margin:14px 0 6px;">🗺️ 市场汇率</div>
                ${REGIONS.map(r => {
                    const locked = day < r.unlockDay;
                    const exRate = getExchangeRate(r.id);
                    const trend = getExchangeTrend(r.id);
                    const trendIcon = trend === 'up' ? '📈' : trend === 'down' ? '📉' : '➖';
                    return `<div style="font-size:12px;padding:4px 0;color:${locked ? '#bbb' : '#444'};">
                        ${r.icon} ${r.name} ${locked ? '（第' + r.unlockDay + '天解锁）' : trendIcon + ' ×' + exRate.toFixed(3) + ' · 关税' + Math.round(r.feeRate * 100) + '%'}
                    </div>`;
                }).join('')}
                <div style="font-weight:700;margin:14px 0 6px;">📜 当前法规</div>
                ${regs.length ? regs.map(r => `
                    <div style="padding:8px;background:#fff8e1;border-radius:8px;margin-bottom:6px;font-size:12px;">
                        ⚠️ ${r.title || '管制'}：${r.detail || ''}（至第${r.untilDay || '?'}天）
                    </div>`).join('') : `<div style="color:#999;font-size:12px;">暂无特殊管制。</div>`}
                <div style="font-weight:700;margin:14px 0 6px;">📁 近期结案</div>
                ${done.length ? done.map(s => `
                    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f5f5f5;font-size:12px;">
                        <span>${s.regionIcon || '🌍'} ${s.productName || ''} ×${s.qty}</span>
                        <span style="color:${s.status === 'settled' ? '#2e7d32' : '#9e9e9e'};">${s.status === 'settled' ? '+' + _fmt(s.netIncome || 0) : (s.cancelReason || '取消')}</span>
                    </div>`).join('') : '<div style="color:#999;font-size:12px;">暂无记录</div>'}
            </div>`;
        u.showModal('🌍 海外贸易中心', content,
            `<button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>`,
            { width: '640px', modalId: 'overseasCenterModal' });
    }

    const overseasUI = {
        show, isUnlocked, addRegulation,
        processDailySettlements, updateExchangeRates, getExchangeRate, getExchangeTrend,
        generateInquiry, acceptInquiry, declineInquiry, sourceOrder, shipOrder, applyCustoms, goProcure,
        REGIONS, DAILY_EXPORT_CAP, getDailyExportCap, getMaxActiveOrders
    };
    if (typeof window !== 'undefined') {
        window.overseasUI = overseasUI;
        window.OverseasUI = overseasUI;
    }
})();
