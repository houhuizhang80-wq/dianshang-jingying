/**
 * dashboardData.js — 数据分析看板·聚合层(纯函数,只读,不改任何玩法状态)
 * 数据来源全部现成:orders(marketingCampaignSource 标签)、OrderPerf 桶计数、
 * 员工 stats.hourlyCounts、finance.dailyStats、shop.traffic。
 * 性能红线:所有订单扫描有硬上限(scanCap),与 OrderPerf 索引互补,爆单下不退化。
 */
'use strict';

const DASHBOARD_CONFIG = {
    orderScanCap: 300,        // 流量来源/商品排行最多扫描最近 N 笔订单
    topN: 8,                  // 商品热销榜条数
    trendDays: 30,            // 财务趋势窗口
    heatmapHours: 24          // 时段热力图小时数
};

const DASH_SOURCE_LABELS = {
    activeCampaign: { name: '活动推广', color: '#673ab7', icon: '📣' },
    employee: { name: '员工推广', color: '#9c27b0', icon: '👔' },
    shop_auto: { name: '店铺自动', color: '#2196f3', icon: '🏪' },
    promo: { name: '直播带货', color: '#e91e63', icon: '🎥' },
    live: { name: '直播带货', color: '#e91e63', icon: '🎥' },
    natural: { name: '自然流量', color: '#4caf50', icon: '🌿' }
};

function _fmtMoney(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '¥0';
    if (Math.abs(n) >= 1e8) return '¥' + (n / 1e8).toFixed(2) + '亿';
    if (Math.abs(n) >= 1e4) return '¥' + (n / 1e4).toFixed(1) + '万';
    return '¥' + Math.round(n).toLocaleString();
}

/** 归一订单来源:order.marketingCampaignSource || order.source → 标签键 */
function normalizeSource(order) {
    if (!order) return 'natural';
    const s = order.marketingCampaignSource || order.source || '';
    if (s === 'activeCampaign' || s === 'employee' || s === 'shop_auto') return s;
    if (s === 'promo' || s === 'live' || s === 'livestream') return 'promo';
    return 'natural';
}

/** 流量来源分布:[{ key, name, icon, color, orders, gmv }] 按订单数降序 */
function aggregateTrafficSources(orders, cap) {
    const limit = Math.max(1, Math.min(cap || DASHBOARD_CONFIG.orderScanCap, 2000));
    const list = (orders && orders.length) ? orders : [];
    const scan = list.slice(-limit);
    const agg = {};
    scan.forEach(o => {
        if (!o) return;
        const key = normalizeSource(o);
        const a = agg[key] || (agg[key] = { key, name: (DASH_SOURCE_LABELS[key] || {}).name || key, icon: (DASH_SOURCE_LABELS[key] || {}).icon || '', color: (DASH_SOURCE_LABELS[key] || {}).color || '#999', orders: 0, gmv: 0 });
        a.orders++;
        const amt = Number(o.totalAmount);
        if (Number.isFinite(amt)) a.gmv += amt;
    });
    return Object.keys(agg).map(k => agg[k]).sort((x, y) => y.orders - x.orders);
}

/** 商品热销榜:[{ productId, productName, qty, gmv }] 按 GMV 降序取 topN */
function aggregateTopProducts(orders, cap) {
    const limit = Math.max(1, Math.min(cap || DASHBOARD_CONFIG.orderScanCap, 2000));
    const list = (orders && orders.length) ? orders : [];
    const scan = list.slice(-limit);
    const agg = {};
    scan.forEach(o => {
        if (!o || o.productId == null) return;
        const a = agg[o.productId] || (agg[o.productId] = { productId: o.productId, productName: o.productName || ('商品' + o.productId), qty: 0, gmv: 0 });
        const q = Number(o.quantity);
        const amt = Number(o.totalAmount);
        a.qty += Number.isFinite(q) ? q : 1;
        if (Number.isFinite(amt)) a.gmv += amt;
    });
    return Object.keys(agg).map(k => agg[k]).sort((x, y) => y.gmv - x.gmv).slice(0, DASHBOARD_CONFIG.topN);
}

/**
 * 时段热力图:24h × 4 活动(打包/发货/客服/推广)
 * 员工 stats.hourlyCounts key 形如 'D{day}H{hour}';跨天按小时位聚合,长期稳定视图。
 * @returns {Array<{hour, packed, shipped, consultation, marketing, total}>} 长度 24
 */
function aggregateHourlyHeatmap(employees) {
    const rows = [];
    for (let h = 0; h < DASHBOARD_CONFIG.heatmapHours; h++) {
        rows.push({ hour: h, packed: 0, shipped: 0, consultation: 0, marketing: 0, total: 0 });
    }
    const emps = (employees && employees.length) ? employees : [];
    const dayFilter = arguments.length > 1 ? arguments[1] : null;
    emps.forEach(e => {
        const hc = e && e.stats && e.stats.hourlyCounts;
        if (!hc) return;
        Object.keys(hc).forEach(k => {
            if (dayFilter != null) {
                const dm = /^D(\d+)H/.exec(k);
                if (!dm || Number(dm[1]) !== Number(dayFilter)) return;
            }
            const m = /H(\d+)$/.exec(k);
            if (!m) return;
            const h = parseInt(m[1], 10);
            if (!(h >= 0 && h < 24)) return;
            const v = hc[k] || {};
            const row = rows[h];
            row.packed += Number(v.packed) || 0;
            row.shipped += Number(v.shipped) || 0;
            row.consultation += Number(v.consultation) || 0;
            row.marketing += Number(v.marketing) || 0;
        });
    });
    rows.forEach(r => { r.total = r.packed + r.shipped + r.consultation + r.marketing; });
    return rows;
}

/**
 * 转化漏斗(基于 OrderPerf 桶计数 O(1) + 店铺流量):
 * 曝光(traffic) → 下单(todayOrders) → 支付(pending_packing+pending_shipment+shipped+completed)
 * → 发货(shipped+completed) → 签收(completed)
 */
function buildFunnel(counts, traffic) {
    const c = counts || {};
    const g = s => (c[s] || 0);
    const placed = g('todayOrders');
    // 曝光至少盖住下单：shop.traffic 只是流量系数，晚盘今日订单会远超它
    const exposure = Math.max(0, Number(traffic) || 0, placed);
    const paid = g('pendingPacking') + g('pendingShip') + g('shipped') + g('completed');
    const shipped = g('shipped') + g('completed');
    const signed = g('completed');
    const steps = [
        { name: '曝光', icon: '👀', value: exposure },
        { name: '下单', icon: '🛒', value: placed },
        { name: '支付', icon: '💳', value: paid },
        { name: '发货', icon: '📦', value: shipped },
        { name: '签收', icon: '✅', value: signed }
    ];
    for (let i = 1; i < steps.length; i++) {
        const prev = steps[i - 1].value;
        steps[i].rate = prev > 0 ? Math.min(100, Math.round((steps[i].value / prev) * 100)) : 0;
    }
    steps[0].rate = 100;
    return steps;
}

/** 财务趋势(近 N 天):[{ day, sales, cost, profit }] 升序,最多 trendDays 条 */
function buildFinanceTrend(dailyStats, days) {
    const list = (dailyStats && dailyStats.length) ? dailyStats : [];
    const n = Math.max(1, Math.min(days || DASHBOARD_CONFIG.trendDays, 60));
    return list.slice(-n).map(d => ({
        day: d && d.day != null ? d.day : 0,
        sales: Number(d && d.sales) || 0,
        cost: Number(d && d.cost) || 0,
        profit: Number(d && d.profit) || 0
    }));
}

function _orderDay(o) {
    if (!o) return null;
    const t = o.createTime || o.orderTime || o.payTime || o.completeTime;
    if (t && typeof t === 'object' && t.day != null) return Number(t.day);
    if (typeof o.day === 'number') return o.day;
    return null;
}

/** range: today | all */
function filterOrdersByRange(orders, day, range) {
    const list = (orders && orders.length) ? orders : [];
    if (range !== 'today') return list;
    return list.filter(o => _orderDay(o) === day);
}

function countOrdersByStatus(orders) {
    const c = {
        pendingPayment: 0, pendingPacking: 0, pendingShip: 0,
        shipped: 0, completed: 0, cancelled: 0, todayOrders: 0
    };
    const list = orders || [];
    c.todayOrders = list.length;
    for (let i = 0; i < list.length; i++) {
        const st = list[i] && list[i].status;
        if (st === 'pending_payment') c.pendingPayment++;
        else if (st === 'pending_packing') c.pendingPacking++;
        else if (st === 'pending_shipment') c.pendingShip++;
        else if (st === 'shipped') c.shipped++;
        else if (st === 'completed') c.completed++;
        else if (st === 'cancelled' || st === 'returned' || st === 'refunded') c.cancelled++;
    }
    return c;
}

function sumDailyStats(dailyStats) {
    const list = (dailyStats && dailyStats.length) ? dailyStats : [];
    const out = { sales: 0, cost: 0, profit: 0, orders: 0, days: list.length };
    for (let i = 0; i < list.length; i++) {
        const d = list[i];
        if (!d) continue;
        out.sales += Number(d.sales) || 0;
        out.cost += Number(d.cost) || 0;
        out.profit += Number(d.profit) || 0;
        out.orders += Number(d.orders) || 0;
    }
    return out;
}

/** 今日核心指标(首页卡):销售/订单/净利/客单价 */
function buildCoreMetrics(dailyStats, counts, day) {
    const list = (dailyStats && dailyStats.length) ? dailyStats : [];
    const today = list.find(d => d && d.day === day) || list[list.length - 1] || null;
    const c = counts || {};
    const orders = (c.todayOrders != null) ? c.todayOrders : (today && today.orders) || 0;
    const sales = today ? (Number(today.sales) || 0) : 0;
    const profit = today ? (Number(today.profit) || 0) : 0;
    return {
        sales, orders, profit,
        avgOrder: orders > 0 ? Math.round(sales / orders) : 0
    };
}

/** 全部经营汇总：财务日表 + 店铺累计 */
function buildLifetimeMetrics(dailyStats, shop, orderList) {
    const sum = sumDailyStats(dailyStats);
    const shopOrders = shop ? (Number(shop.totalOrders) || 0) : 0;
    const listed = (orderList && orderList.length) || 0;
    const orders = Math.max(sum.orders, shopOrders, listed);
    const sales = sum.sales > 0 ? sum.sales : 0;
    const profit = sum.profit;
    return {
        sales,
        orders,
        profit,
        cost: sum.cost,
        days: sum.days,
        avgOrder: orders > 0 && sales > 0 ? Math.round(sales / orders) : 0,
        funds: shop ? (Number(shop.funds) || 0) : 0,
        reputation: shop ? (Number(shop.reputation) || 0) : 0,
        rating: shop && typeof shop.rating === 'number' ? shop.rating : 5,
        totalSoldQty: shop ? (Number(shop.totalSales) || 0) : 0
    };
}

// ==================== 经营健康度评分 ====================
function _clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

/**
 * 经营健康度评分(0~100)：综合现金流/履约/服务/增长/风控五维，给出评级与建议。
 * 纯函数，只读，不改玩法状态。
 * @param {object} i { funds, reputation, todayProfit, todayOrders, backlog, debt, returnRate }
 */
function buildHealthScore(i) {
    const x = i || {};
    const funds = Math.max(0, Number(x.funds) || 0);
    const reputation = _clamp(Number(x.reputation) || 0, 0, 100);
    const profit = Number(x.todayProfit) || 0;
    const orders = Math.max(0, Number(x.todayOrders) || 0);
    const backlog = Math.max(0, Number(x.backlog) || 0);
    const debt = Math.max(0, Number(x.debt) || 0);
    const returnRate = _clamp(Number(x.returnRate) || 0, 0, 1);

    // 现金流：正利润 + 资金 vs 债务
    let cashflow = 50;
    cashflow += _clamp(profit / 10000 * 30, -30, 30);
    cashflow += funds > debt ? 20 : -20;
    cashflow = _clamp(cashflow, 0, 100);

    // 履约：积压越少越好（每件待打包/待发货 -4 分）
    let fulfillment = _clamp(100 - backlog * 4, 0, 100);

    // 服务：信誉 + 低退货率
    let service = reputation * 0.6;
    service += returnRate < 0.05 ? 40 : returnRate < 0.15 ? 20 : returnRate < 0.25 ? 0 : -20;
    service = _clamp(service, 0, 100);

    // 增长：今日订单（20 单满分）
    let growth = _clamp(orders * 5, 0, 100);

    // 风控：债务占资金比越低越好
    let risk = debt <= 0 ? 100 : _clamp(100 - (debt / Math.max(1, funds)) * 60, 0, 100);

    const dimensions = [
        { key: 'cashflow', name: '现金流', icon: '💰', score: Math.round(cashflow) },
        { key: 'fulfillment', name: '履约', icon: '📦', score: Math.round(fulfillment) },
        { key: 'service', name: '服务', icon: '⭐', score: Math.round(service) },
        { key: 'growth', name: '增长', icon: '📈', score: Math.round(growth) },
        { key: 'risk', name: '风控', icon: '🛡️', score: Math.round(risk) }
    ];

    const score = Math.round(dimensions.reduce((s, d) => s + d.score, 0) / dimensions.length);
    const grade = score >= 85 ? 'S' : score >= 70 ? 'A' : score >= 55 ? 'B' : score >= 40 ? 'C' : 'D';
    const gradeColor = { S: '#ffd700', A: '#4caf50', B: '#2196f3', C: '#ff9800', D: '#f44336' }[grade] || '#999';

    // 建议（针对最低维度）
    const weakest = dimensions.slice().sort((a, b) => a.score - b.score)[0];
    const suggestions = {
        cashflow: '利润或资金偏弱：压缩成本、提高客单价或申请贷款周转',
        fulfillment: '履约积压偏多：招聘打包/发货员工，或及时发货',
        service: '服务评分偏低：提升信誉、降低退货率（控制品质/如实描述）',
        growth: '增长乏力：加大营销推广、直播带货或多渠道开店',
        risk: '风控风险偏高：控制负债、及时偿还贷款避免逾期'
    };

    return { score, grade, gradeColor, dimensions, weakest: weakest ? weakest.key : null, suggestion: suggestions[weakest ? weakest.key : 'cashflow'] };
}

// 导出兼容(浏览器全局 + Node 测试)
if (typeof window !== 'undefined') window.DashboardData = {
    DASHBOARD_CONFIG, DASH_SOURCE_LABELS, normalizeSource,
    aggregateTrafficSources, aggregateTopProducts, aggregateHourlyHeatmap,
    buildFunnel, buildFinanceTrend, buildCoreMetrics, buildLifetimeMetrics,
    filterOrdersByRange, countOrdersByStatus, sumDailyStats, buildHealthScore, formatMoney: _fmtMoney
};
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        DASHBOARD_CONFIG, DASH_SOURCE_LABELS, normalizeSource,
        aggregateTrafficSources, aggregateTopProducts, aggregateHourlyHeatmap,
        buildFunnel, buildFinanceTrend, buildCoreMetrics, buildLifetimeMetrics,
        filterOrdersByRange, countOrdersByStatus, sumDailyStats, buildHealthScore, formatMoney: _fmtMoney
    };
}
