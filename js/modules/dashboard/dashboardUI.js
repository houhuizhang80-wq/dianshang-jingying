/**
 * dashboardUI.js — 数据分析看板 UI(纯展示,零状态写入)
 * 入口:九宫格「数据看板」→ dashboardUI.open()
 * 渲染:核心指标 / 流量来源 / 商品热销榜 / 转化漏斗 / 时段热力图 / 财务趋势(30天)
 */
'use strict';

(function () {
    let _gameState = null;
    let _ui = null;

    function init(gameState, uiManager) {
        _gameState = gameState || _gameState;
        _ui = uiManager || _ui;
    }

    function _gs() { return _gameState; }
    function _uiRef() { return _ui; }

    const D = () => (typeof DashboardData !== 'undefined') ? DashboardData : null;

    function _bar(items, opts) {
        // items: [{label, value, color}] → 横向占比条列表
        opts = opts || {};
        const max = Math.max(1, ...items.map(i => i.value));
        const showText = opts.showText != null ? opts.showText : true;
        return items.map(it => `
            <div style="display:flex;align-items:center;gap:8px;margin:7px 0;">
                <div style="flex:0 0 76px;font-size:12px;color:#555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${it.label}</div>
                <div style="flex:1;height:14px;background:#f0f0f0;border-radius:7px;overflow:hidden;">
                    <div style="height:100%;width:${Math.max(1, Math.round((it.value / max) * 100))}%;background:${it.color || '#4caf50'};border-radius:7px;"></div>
                </div>
                ${showText ? `<div style="flex:0 0 64px;font-size:12px;color:#333;text-align:right;">${it.text != null ? it.text : it.value}</div>` : ''}
            </div>
        `).join('');
    }

    function _heatmap(rows) {
        const acts = [
            { key: 'packed', name: '打包', color: '#ff9800' },
            { key: 'shipped', name: '发货', color: '#2196f3' },
            { key: 'consultation', name: '客服', color: '#4caf50' },
            { key: 'marketing', name: '推广', color: '#9c27b0' }
        ];
        const max = Math.max(1, ...rows.map(r => r.total));
        const alpha = v => Math.round(0.1 + 0.9 * (v / max) * 100) / 100;
        let html = '<div style="font-size:11px;color:#999;margin-bottom:6px;display:flex;justify-content:space-between;"><span>0时</span><span>6时</span><span>12时</span><span>18时</span><span>23时</span></div>';
        html += '<div style="display:grid;grid-template-columns:repeat(24,1fr);gap:2px;">';
        rows.forEach(r => {
            const parts = acts.map(a => {
                const v = r[a.key];
                const pct = v > 0 ? Math.round((v / Math.max(1, r.total)) * 100) : 0;
                return v > 0 ? `<div style="height:${Math.max(6, Math.min(100, pct))}%;background:${a.color};opacity:${alpha(r.total)};border-radius:1px;" title="H${r.hour} ${a.name} ${v}"></div>` : '';
            }).join('');
            html += `<div style="height:64px;display:flex;flex-direction:column;justify-content:flex-end;background:#fafafa;border-radius:3px;padding:2px;" title="H${r.hour} 共${r.total}次">${parts}</div>`;
        });
        html += '</div>';
        html += '<div style="display:flex;gap:12px;margin-top:8px;font-size:11px;color:#666;flex-wrap:wrap;">' +
            acts.map(a => `<span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${a.color};margin-right:4px;vertical-align:-1px;"></span>${a.name}</span>`).join('') +
            '</div>';
        return html;
    }

    function _funnel(steps) {
        const max = Math.max(1, ...steps.map(s => s.value));
        return `
            <div style="display:flex;flex-direction:column;gap:5px;">
                ${steps.map((s, i) => `
                    <div style="display:flex;align-items:center;gap:8px;">
                        <div style="flex:0 0 52px;font-size:12px;color:#555;">${s.icon} ${s.name}</div>
                        <div style="flex:1;height:22px;background:#f0f0f0;border-radius:5px;overflow:hidden;">
                            <div style="height:100%;width:${Math.max(2, Math.round((s.value / max) * 100))}%;background:linear-gradient(90deg,#66bb6a,#2e7d32);display:flex;align-items:center;justify-content:flex-end;padding-right:6px;font-size:11px;color:#fff;min-width:${s.value > 0 ? '46px' : '0'};">
                                ${s.value > 0 ? s.value.toLocaleString() : ''}
                            </div>
                        </div>
                        <div style="flex:0 0 58px;font-size:11px;color:${i === 0 ? '#999' : (s.rate >= 60 ? '#4caf50' : s.rate >= 30 ? '#ff9800' : '#e53935')};text-align:right;">
                            ${i === 0 ? '100%' : '↓' + s.rate + '%'}
                        </div>
                    </div>
                `).join('')}
            </div>`;
    }

    function _trendChart(rows) {
        const maxVal = Math.max(1, ...rows.map(r => Math.max(r.sales, r.cost)));
        return `
            <div style="display:flex;align-items:flex-end;gap:3px;height:120px;overflow-x:auto;">
                ${rows.map(r => `
                    <div style="flex:1;min-width:14px;display:flex;flex-direction:column;align-items:center;gap:2px;" title="D${r.day} 销售${D().formatMoney(r.sales)} 成本${D().formatMoney(r.cost)} 净利${D().formatMoney(r.profit)}">
                        <div style="position:relative;width:100%;height:90px;display:flex;gap:1px;align-items:flex-end;">
                            <div style="flex:1;height:${Math.max(2, Math.round((r.cost / maxVal) * 100))}%;background:linear-gradient(180deg,#ff9800,#ff5722);opacity:.75;border-radius:2px 2px 0 0;"></div>
                            <div style="flex:1;height:${Math.max(2, Math.round((r.sales / maxVal) * 100))}%;background:linear-gradient(180deg,#66bb6a,#2e7d32);border-radius:2px 2px 0 0;"></div>
                        </div>
                        <div style="font-size:9px;color:#999;">${rows.length > 15 ? (r.day % 5 === 0 ? 'D' + r.day : '') : 'D' + r.day}</div>
                    </div>
                `).join('')}
            </div>
            <div style="display:flex;gap:14px;margin-top:6px;font-size:11px;color:#666;">
                <span><span style="display:inline-block;width:10px;height:10px;background:#66bb6a;border-radius:2px;margin-right:4px;vertical-align:-1px;"></span>销售额</span>
                <span><span style="display:inline-block;width:10px;height:10px;background:#ff9800;border-radius:2px;margin-right:4px;vertical-align:-1px;"></span>成本</span>
            </div>`;
    }

    function _bind() {
        try {
            if (!_gameState && typeof gameState !== 'undefined') _gameState = gameState;
            if (!_ui && typeof ui !== 'undefined') _ui = ui;
        } catch (_) {}
    }

    function renderBody(range) {
        _bind();
        const gs = _gs();
        const d = D();
        if (!gs || !gs.state || !d) {
            return '<div class="page"><div class="empty-state"><div class="text">看板初始化中，请稍后再试</div></div></div>';
        }
        const isAll = range === 'all';
        const s = gs.state;
        const day = (s.gameTime && s.gameTime.day) || 1;
        const allOrders = Array.isArray(s.orders) ? s.orders : [];
        const orders = d.filterOrdersByRange ? d.filterOrdersByRange(allOrders, day, isAll ? 'all' : 'today') : allOrders;
        let counts = {};
        try {
            if (isAll && d.countOrdersByStatus) {
                counts = d.countOrdersByStatus(allOrders);
            } else if (typeof OrderPerf !== 'undefined' && OrderPerf.getTabCounts) {
                counts = OrderPerf.getTabCounts(allOrders, day);
            }
        } catch (_) { counts = {}; }

        const dailyStats = (s.finance && Array.isArray(s.finance.dailyStats)) ? s.finance.dailyStats : [];
        const core = isAll && d.buildLifetimeMetrics
            ? d.buildLifetimeMetrics(dailyStats, s.shop, allOrders)
            : d.buildCoreMetrics(dailyStats, counts, day);
        const sources = d.aggregateTrafficSources(orders, isAll ? 2000 : undefined);
        const topP = d.aggregateTopProducts(orders, isAll ? 2000 : undefined);
        const heat = d.aggregateHourlyHeatmap(s.employees, isAll ? null : day);
        const todayViews = Number(s.statistics && s.statistics.todayViews) || 0;
        const allViews = Number(s.statistics && s.statistics.totalViews) || todayViews;
        const funnel = d.buildFunnel(counts, isAll
            ? Math.max(allViews, Number(s.shop && s.shop.traffic) || 0, counts.todayOrders || 0)
            : Math.max(Number(s.shop && s.shop.traffic) || 0, todayViews));
        const trend = d.buildFinanceTrend(dailyStats, isAll ? 30 : 7);
        const totalSrcOrders = sources.reduce((a, b) => a + b.orders, 0);
        const maxTop = Math.max(1, ...topP.map(p => p.gmv));
        const salesLabel = isAll ? '累计销售额' : '今日销售额';
        const orderLabel = isAll ? '累计订单' : '今日订单';
        const profitLabel = isAll ? '累计净利' : '今日净利';
        let html = '';
        try {

            // ===== 经营健康度评分（深化） =====
            let health = null;
            try {
                let debt = 0;
                if (Array.isArray(s.bank && s.bank.loans)) {
                    debt = s.bank.loans.filter(l => l && l.status === 'active')
                        .reduce((a, l) => a + (Number(l.remainingAmount) || 0), 0);
                }
                let returnRate = 0;
                try {
                    if (typeof gameState.getOpsRiskMetrics === 'function') {
                        returnRate = Number(gameState.getOpsRiskMetrics().returnRate) || 0;
                    }
                } catch (_) {}
                health = d.buildHealthScore({
                    funds: Number(s.shop && s.shop.funds) || 0,
                    reputation: Number(s.shop && s.shop.reputation) || 0,
                    todayProfit: core.profit,
                    todayOrders: core.orders,
                    backlog: (counts.pendingPacking || 0) + (counts.pendingShip || 0),
                    debt,
                    returnRate
                });
            } catch (_) { health = null; }

            html = `
            <div class="analytics-body">
                <!-- ① 核心指标 -->
                <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px;">
                    <div style="background:#f8f9fa;border-radius:10px;padding:10px;text-align:center;">
                        <div style="font-size:15px;font-weight:700;color:#2e7d32;">${d.formatMoney(core.sales)}</div>
                        <div style="font-size:11px;color:#888;margin-top:2px;">${salesLabel}</div>
                    </div>
                    <div style="background:#f8f9fa;border-radius:10px;padding:10px;text-align:center;">
                        <div style="font-size:15px;font-weight:700;color:#1565c0;">${Number(core.orders || 0).toLocaleString()}</div>
                        <div style="font-size:11px;color:#888;margin-top:2px;">${orderLabel}</div>
                    </div>
                    <div style="background:#f8f9fa;border-radius:10px;padding:10px;text-align:center;">
                        <div style="font-size:15px;font-weight:700;color:${core.profit >= 0 ? '#ef6c00' : '#c62828'};">${d.formatMoney(core.profit)}</div>
                        <div style="font-size:11px;color:#888;margin-top:2px;">${profitLabel}</div>
                    </div>
                    <div style="background:#f8f9fa;border-radius:10px;padding:10px;text-align:center;">
                        <div style="font-size:15px;font-weight:700;color:#6a1b9a;">${d.formatMoney(core.avgOrder)}</div>
                        <div style="font-size:11px;color:#888;margin-top:2px;">客单价</div>
                    </div>
                </div>
                ${isAll ? `
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;">
                    <div style="background:#fff8e1;border-radius:10px;padding:10px;text-align:center;">
                        <div style="font-size:14px;font-weight:700;color:#f57c00;">${d.formatMoney(core.funds)}</div>
                        <div style="font-size:11px;color:#888;margin-top:2px;">当前资金</div>
                    </div>
                    <div style="background:#fff8e1;border-radius:10px;padding:10px;text-align:center;">
                        <div style="font-size:14px;font-weight:700;color:#1565c0;">⭐ ${(core.rating || 5).toFixed(1)}</div>
                        <div style="font-size:11px;color:#888;margin-top:2px;">店铺评分</div>
                    </div>
                    <div style="background:#fff8e1;border-radius:10px;padding:10px;text-align:center;">
                        <div style="font-size:14px;font-weight:700;color:#6a1b9a;">${Number(core.totalSoldQty || 0).toLocaleString()}</div>
                        <div style="font-size:11px;color:#888;margin-top:2px;">累计销量(件)</div>
                    </div>
                </div>` : ''}

                <!-- ② 经营健康度 -->
                ${health ? `
                <div style="background:linear-gradient(135deg,${health.gradeColor}22,transparent);border:1px solid ${health.gradeColor}55;border-radius:12px;padding:12px 14px;margin-bottom:12px;">
                    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
                        <div style="width:52px;height:52px;border-radius:50%;background:${health.gradeColor};display:flex;align-items:center;justify-content:center;color:#fff;font-size:24px;font-weight:900;flex-shrink:0;">${health.grade}</div>
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:13px;font-weight:800;color:#333;">🧭 经营健康度 ${health.score} 分</div>
                            <div style="font-size:11px;color:#888;margin-top:2px;">${health.suggestion}</div>
                        </div>
                    </div>
                    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;">
                        ${health.dimensions.map(dim => `
                            <div style="text-align:center;">
                                <div style="font-size:15px;">${dim.icon}</div>
                                <div style="font-size:10px;color:#888;margin-top:2px;">${dim.name}</div>
                                <div style="font-size:12px;font-weight:800;color:${dim.score >= 70 ? '#2e7d32' : dim.score >= 50 ? '#ff9800' : '#f44336'};">${dim.score}</div>
                            </div>`).join('')}
                    </div>
                </div>` : ''}

                <!-- ③ 转化漏斗 -->
                <div style="background:#fff;border:1px solid #eee;border-radius:10px;padding:12px 14px;margin-bottom:12px;">
                    <div style="font-size:13px;font-weight:700;margin-bottom:8px;">🛤️ 转化漏斗</div>
                    ${_funnel(funnel)}
                </div>
                <!-- ④ 流量来源 -->
                <div style="background:#fff;border:1px solid #eee;border-radius:10px;padding:12px 14px;margin-bottom:12px;">
                    <div style="font-size:13px;font-weight:700;margin-bottom:4px;">🚦 流量来源(${isAll ? '全部扫描' : '当天'} · ${Math.min(orders.length, isAll ? 2000 : d.DASHBOARD_CONFIG.orderScanCap)}单)</div>
                    ${totalSrcOrders === 0 ? '<div style="padding:16px;text-align:center;color:#999;font-size:12px;">暂无订单数据,先经营出第一单吧</div>' :
                    _bar(sources.map(x => ({ label: x.icon + ' ' + x.name, value: x.orders, color: x.color, text: x.orders + '单 · ' + d.formatMoney(x.gmv) })))}
                </div>

                <!-- ④ 商品热销榜 -->
                <div style="background:#fff;border:1px solid #eee;border-radius:10px;padding:12px 14px;margin-bottom:12px;">
                    <div style="font-size:13px;font-weight:700;margin-bottom:4px;">🔥 商品热销榜 TOP${topP.length}</div>
                    ${topP.length === 0 ? '<div style="padding:16px;text-align:center;color:#999;font-size:12px;">暂无销售记录</div>' :
                    topP.map((p, i) => `
                        <div style="display:flex;align-items:center;gap:8px;margin:7px 0;">
                            <div style="flex:0 0 20px;font-size:12px;font-weight:700;color:${i < 3 ? '#e53935' : '#999'};">${i + 1}</div>
                            <div style="flex:1;font-size:12px;color:#333;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${String(p.productName).slice(0, 16)}</div>
                            <div style="flex:0 0 44px;font-size:11px;color:#888;text-align:right;">${Math.round(p.qty)}件</div>
                            <div style="flex:0 0 90px;height:12px;background:#f0f0f0;border-radius:6px;overflow:hidden;">
                                <div style="height:100%;width:${Math.max(2, Math.round((p.gmv / maxTop) * 100))}%;background:linear-gradient(90deg,#ff7043,#e53935);border-radius:6px;"></div>
                            </div>
                            <div style="flex:0 0 64px;font-size:11px;color:#333;text-align:right;">${d.formatMoney(p.gmv)}</div>
                        </div>
                    `).join('')}
                </div>

                <!-- ⑤ 时段热力图 -->
                <div style="background:#fff;border:1px solid #eee;border-radius:10px;padding:12px 14px;margin-bottom:12px;">
                    <div style="font-size:13px;font-weight:700;margin-bottom:8px;">🕐 24小时经营热力图(${isAll ? '累计' : '当天'})</div>
                    ${_heatmap(heat)}
                </div>

                <!-- ⑥ 财务趋势 -->
                <div style="background:#fff;border:1px solid #eee;border-radius:10px;padding:12px 14px;">
                    <div style="font-size:13px;font-weight:700;margin-bottom:8px;">📅 财务趋势(近${trend.length}天)</div>
                    ${trend.length === 0 ? '<div style="padding:16px;text-align:center;color:#999;font-size:12px;">暂无财务数据</div>' : _trendChart(trend)}
                </div>
            </div>`;
        } catch (e) {
            try { console.warn('[dashboardUI] 渲染失败:', e); } catch (_) {}
            html = '<div class="empty-state"><div class="text">看板渲染失败</div></div>';
        }
        return html;
    }

    function renderPage(range) {
        _bind();
        const cur = range === 'all' ? 'all' : 'today';
        return `
            <div class="page analytics-page">
                <div class="wb-subbar" style="margin-bottom:10px;">
                    <div class="wb-subbar-title">📊 经营分析</div>
                </div>
                <div class="analytics-range" style="display:flex;gap:8px;margin-bottom:12px;">
                    <button type="button" class="btn ${cur === 'today' ? 'btn-primary' : 'btn-secondary'} btn-small"
                        onclick="ui.setAnalyticsRange('today')">当天数据</button>
                    <button type="button" class="btn ${cur === 'all' ? 'btn-primary' : 'btn-secondary'} btn-small"
                        onclick="ui.setAnalyticsRange('all')">全部汇总</button>
                </div>
                ${renderBody(cur)}
            </div>`;
    }

    function open() {
        _bind();
        const uiMgr = _uiRef();
        if (uiMgr && typeof uiMgr.navigateTo === 'function') {
            uiMgr.navigateTo('analytics');
            return;
        }
        if (!uiMgr || typeof uiMgr.showModal !== 'function') return;
        uiMgr.showModal('📊 经营分析', renderBody('today'), '', { modalId: 'dashboardModal', width: '560px' });
    }

    const dashboardUI = { init, open, renderPage, renderBody };
    if (typeof window !== 'undefined') window.dashboardUI = dashboardUI;
    if (typeof module !== 'undefined' && module.exports) module.exports = { dashboardUI };
})();
