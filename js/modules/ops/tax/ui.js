/**
 * 纳税中心 — UI
 */
class TaxUI {
    constructor(gameState, ui) {
        this.gameState = gameState;
        this.ui = ui;
        this.currentTab = 'dashboard';
    }

    show() {
        const content = this.renderMain();
        this.ui.showModal('📋 纳税中心', content,
            `<button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>`,
            { noBodyPadding: true, width: '860px', modalId: 'taxCenterModal' });
    }

    switchTab(tab) {
        this.currentTab = tab;
        this.refresh();
    }

    refresh() {
        let modal = null;
        try {
            if (this.ui && typeof this.ui._findModalOverlay === 'function') {
                modal = this.ui._findModalOverlay('📋 纳税中心', 'taxCenterModal');
            }
        } catch (_) {}
        if (!modal) modal = document.getElementById('taxCenterModal')
            || document.querySelector('.modal-overlay:last-child');
        if (!modal) return;
        const body = modal.querySelector('.modal-body');
        if (body) body.innerHTML = this.renderMain();
    }

    _fmt(v) {
        return typeof formatMoney === 'function' ? formatMoney(v) : ('¥' + (Number(v) || 0).toFixed(2));
    }

    renderMain() {
        const tax = TaxState.getState() || {};
        const cp = tax.currentPeriod || {};
        const status = tax.status || {};
        const unpaid = (tax.monthlyReports || []).filter(r => !r.paid && r.totalPayable > 0);
        const tabs = [
            { id: 'dashboard', name: '概览' },
            { id: 'entity', name: '注册类型' },
            { id: 'monthly', name: '月度报税' },
            { id: 'deductions', name: '成本抵扣' }
        ];
        let banner = '';
        if (status.forcedClose) banner = '🚫 强制闭店整顿中';
        else if (status.restrictedFlow) banner = '⛔ 资金流水受限';
        else if (status.underInvestigation) banner = '⚠️ 税务稽查观察中';
        else if (status.overdue) banner = '📌 存在逾期未缴税款';

        let body = '';
        if (this.currentTab === 'entity') {
            const shop = (this.gameState && this.gameState.state && this.gameState.state.shop) || {};
            const cur = shop.entityType || 'individual';
            const types = (typeof SHOP_ENTITY_TYPES !== 'undefined') ? SHOP_ENTITY_TYPES : [];
            body = `
                <div style="font-size:12px;color:#666;margin-bottom:10px;line-height:1.6;">
                    选择店铺注册主体后，增值税与所得税税率将按类型计算。默认「个人」；确定为工商户/公司后不可随意降级。
                </div>
                ${types.map(t => {
                    const sel = cur === t.id;
                    return `<div style="padding:12px;border:2px solid ${sel?'#1976d2':'#eee'};border-radius:10px;margin-bottom:8px;background:${sel?'#e3f2fd':'#fff'};">
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                            <div>
                                <div style="font-weight:700;">${t.icon||''} ${t.name}${sel?' · 当前':''}</div>
                                <div style="font-size:12px;color:#666;margin-top:4px;">${t.desc||''}</div>
                            </div>
                            ${sel ? '<span style="color:#1976d2;font-size:12px;">已登记</span>'
                                : `<button class="btn btn-primary btn-xs" onclick="taxUI.setEntityType('${t.id}')">选择</button>`}
                        </div>
                    </div>`;
                }).join('')}`;
        } else if (this.currentTab === 'monthly') {
            body = unpaid.length
                ? unpaid.map(r => {
                    const profit = (r.taxableIncome != null)
                        ? r.taxableIncome
                        : Math.max(0, (r.revenue || 0) - (r.totalDeductible || 0));
                    return `
                    <div class="tax-stat-card" style="margin-bottom:8px;">
                        <div style="font-weight:700;">${r.year}年${r.month}月 · 应缴 ${this._fmt(r.totalPayable)}</div>
                        <div style="font-size:12px;color:#666;margin:4px 0;">
                            收入 ${this._fmt(r.revenue || 0)} · 支出 ${this._fmt(r.totalDeductible || 0)} · 利润 ${this._fmt(profit)}
                        </div>
                        <div style="font-size:12px;color:#666;margin:4px 0;">增值税 ${this._fmt(r.vatPayable)} · 附加 ${this._fmt(r.surchargePayable)} · 企税 ${this._fmt(r.corporateTaxPayable)}</div>
                        <button class="btn btn-success btn-xs" onclick="taxUI.doPay(${r.year},${r.month})">${r.declared ? '现场缴税' : '申报并缴费'}</button>
                        ${!r.taxPreferenceApplied ? `<button class="btn btn-primary btn-xs" onclick="taxUI.doTaxPreference()">🧾 税务筹划</button>` : ''}
                    </div>`;
                }).join('')
                : `<div class="empty-state"><div class="text">暂无待缴月报</div></div>`;
        } else if (this.currentTab === 'deductions') {
            const costs = cp.deductibleCosts || {};
            body = Object.keys(costs).map(k => `
                <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0f0f0;">
                    <span>${(TAX_DEDUCTION_NAMES && TAX_DEDUCTION_NAMES[k]) || k}</span>
                    <b>${this._fmt(costs[k])}</b>
                </div>`).join('') || '<div>暂无抵扣</div>';
        } else {
            let calHint = '';
            try {
                if (typeof TaxEngine !== 'undefined' && TaxEngine._getCalendar) {
                    const cal = TaxEngine._getCalendar(this.gameState);
                    calHint = `游戏日历 ${cal.year}年${cal.month}月${cal.monthDay}日 · 申报窗口每月1–${(typeof TAX_CONFIG !== 'undefined' && TAX_CONFIG.taxWindowDays) || 15}日`;
                }
            } catch (_) {}
            const monthExpense = (typeof TaxEngine !== 'undefined' && TaxEngine._calcTotalDeductible)
                ? TaxEngine._calcTotalDeductible(cp.deductibleCosts || {})
                : Object.values(cp.deductibleCosts || {}).reduce((s, v) => s + (Number(v) || 0), 0);
            const monthProfit = Math.max(0, (cp.revenue || 0) - monthExpense);
            let entityLabel = '个人';
            try {
                const et = (this.gameState && this.gameState.state && this.gameState.state.shop && this.gameState.state.shop.entityType) || 'individual';
                const info = (typeof getShopEntityTypeById === 'function') ? getShopEntityTypeById(et)
                    : ((typeof SHOP_ENTITY_TYPES !== 'undefined') ? SHOP_ENTITY_TYPES.find(x => x.id === et) : null);
                entityLabel = (info && info.name) || et;
            } catch (_) {}
            body = `
                <div class="tax-card-grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">
                    <div class="tax-stat-card"><div style="font-size:11px;color:#999;">本月收入</div><div style="font-size:18px;font-weight:700;">${this._fmt(cp.revenue || 0)}</div></div>
                    <div class="tax-stat-card"><div style="font-size:11px;color:#999;">本月支出</div><div style="font-size:18px;font-weight:700;">${this._fmt(monthExpense)}</div></div>
                    <div class="tax-stat-card"><div style="font-size:11px;color:#999;">本月利润</div><div style="font-size:18px;font-weight:700;color:#2e7d32;">${this._fmt(monthProfit)}</div></div>
                    <div class="tax-stat-card"><div style="font-size:11px;color:#999;">待缴月报</div><div style="font-size:18px;font-weight:700;color:#d32f2f;">${unpaid.length}</div></div>
                    <div class="tax-stat-card"><div style="font-size:11px;color:#999;">当前账期</div><div style="font-size:18px;font-weight:700;">${cp.year || '-'}年${cp.month || '-'}月</div></div>
                    <div class="tax-stat-card"><div style="font-size:11px;color:#999;">注册类型</div><div style="font-size:14px;font-weight:700;">${entityLabel}</div></div>
                </div>
                ${calHint ? `<div style="margin-top:10px;font-size:11px;color:#888;">📅 ${calHint}</div>` : ''}
                <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
                    <button class="btn btn-primary" onclick="taxUI.switchTab('monthly')">去报税/缴税</button>
                    <button class="btn btn-secondary" onclick="taxUI.switchTab('entity')">注册类型</button>
                </div>`;
        }

        return `
            <div class="tax-container" style="padding:12px;">
                ${banner ? `<div style="padding:10px;background:#fff3e0;margin-bottom:10px;border-radius:8px;">${banner}</div>` : ''}
                <div class="tax-tabs" style="display:flex;gap:8px;margin-bottom:12px;">
                    ${tabs.map(t => `<button class="btn ${this.currentTab === t.id ? 'btn-primary' : 'btn-secondary'} btn-small" onclick="taxUI.switchTab('${t.id}')">${t.name}</button>`).join('')}
                </div>
                <div class="tax-content">${body}</div>
            </div>`;
    }

    doDeclare(year, month) {
        // 申报必须与缴费一并现场支付
        this.doPay(year, month);
    }

    setEntityType(typeId) {
        if (!this.gameState || typeof this.gameState.setShopEntityType !== 'function') {
            if (this.ui && this.ui.showToast) this.ui.showToast('无法设置注册类型');
            return;
        }
        const r = this.gameState.setShopEntityType(typeId);
        if (this.ui && this.ui.showToast) this.ui.showToast((r && r.message) || (r && r.success ? '已更新' : '设置失败'));
        this.refresh();
    }

    // 税务筹划（纳税中心深化）
    doTaxPreference() {
        const res = TaxEngine.applyTaxPreference
            ? TaxEngine.applyTaxPreference(this.gameState || (typeof gameState !== 'undefined' ? gameState : null))
            : { success: false, message: '税务引擎不可用' };
        if (this.ui && this.ui.showToast) this.ui.showToast((res && res.message) || '操作失败');
        this.refresh();
        try { if (typeof gameState !== 'undefined') gameState.notify(); } catch (_) {}
    }

    doPay(year, month) {
        const report = TaxState.getMonthlyReport
            ? TaxState.getMonthlyReport(year, month)
            : (TaxState.getState()?.monthlyReports || []).find(r => r.year === year && r.month === month);
        if (!report) {
            if (this.ui && this.ui.showToast) this.ui.showToast('未找到该月税务报表');
            return;
        }
        if (report.paid) {
            if (this.ui && this.ui.showToast) this.ui.showToast('该月税款已缴清');
            return;
        }
        const taxAmount = Number(report.totalPayable) || 0;
        const lateFees = Number(report.lateFees) || 0;
        const fines = Number(report.fines) || 0;
        const totalAmount = Math.round((taxAmount + lateFees + fines) * 100) / 100;
        const run = () => {
            const res = TaxEngine.payTaxes(this.gameState || (typeof gameState !== 'undefined' ? gameState : null), year, month);
            if (this.ui && this.ui.showToast) this.ui.showToast(res.success ? `已缴税 ${this._fmt(res.paid)}` : (res.msg || '缴税失败'));
            this.refresh();
            try { if (typeof gameState !== 'undefined') gameState.notify(); } catch (_) {}
        };
        const revenue = Number(report.revenue) || 0;
        const expense = Number(report.totalDeductible) || 0;
        const profit = (report.taxableIncome != null) ? Number(report.taxableIncome) : Math.max(0, revenue - expense);
        const profitHtml = `
            <div style="margin:8px 0;padding:10px;background:#f7fafc;border-radius:8px;font-size:13px;line-height:1.7;">
                <div>本月收入：<b>${this._fmt(revenue)}</b></div>
                <div>本月支出：<b>${this._fmt(expense)}</b></div>
                <div>本月利润：<b style="color:#2e7d32;">${this._fmt(profit)}</b></div>
                <div>应纳税额：<b style="color:#d32f2f;">${this._fmt(taxAmount)}</b>${lateFees ? ` · 滞纳金 ${this._fmt(lateFees)}` : ''}${fines ? ` · 罚款 ${this._fmt(fines)}` : ''}</div>
            </div>`;
        if (this.ui && typeof this.ui.confirmPayment === 'function') {
            const needDeclare = !report.declared;
            this.ui.confirmPayment({
                title: needDeclare ? '纳税申报并缴费' : '纳税缴费 · 现场支付',
                category: 'tax',
                noCancel: true,
                year, month,
                amount: totalAmount,
                detailHtml: `${year}年${month}月${profitHtml}`,
                note: needDeclare
                    ? '须现场确认支付：确认后将一并申报并扣除税款，无法取消。'
                    : '须现场确认支付后才会扣款，无法取消。',
                confirmText: totalAmount > 0 ? `现场支付 ¥${totalAmount.toFixed(2)}` : '确认结清',
                onConfirm: run
            });
        } else {
            run();
        }
    }

    _quickPayFirst() {
        const unpaid = (TaxState.getState()?.monthlyReports || []).filter(r => !r.paid && r.totalPayable > 0);
        if (unpaid[0]) this.doPay(unpaid[0].year, unpaid[0].month);
    }

    showReportDetail(year, month) {
        const r = TaxState.getMonthlyReport(year, month);
        if (!r) return;
        const expense = Number(r.totalDeductible) || 0;
        const profit = (r.taxableIncome != null) ? Number(r.taxableIncome) : Math.max(0, (r.revenue || 0) - expense);
        this.ui.showModal(`完税凭证 · ${year}年${month}月`, `
            <div style="font-size:13px;line-height:1.8;">
                <div>本月收入：${this._fmt(r.revenue)}</div>
                <div>本月支出：${this._fmt(expense)}</div>
                <div>本月利润：<b style="color:#2e7d32;">${this._fmt(profit)}</b></div>
                <div>应纳税额：<b style="color:#d32f2f;">${this._fmt(r.totalPayable)}</b></div>
                <div>增值税 ${this._fmt(r.vatPayable)} · 附加 ${this._fmt(r.surchargePayable)} · 企税 ${this._fmt(r.corporateTaxPayable)}</div>
                <div>状态：${r.paid ? '已缴清' : '未缴'}</div>
            </div>`, `<button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>`, { width: '480px' });
    }
}

const taxUI = {
    _inst: null,
    _ensure() {
        if (!this._inst) {
            const gs = (typeof gameState !== 'undefined') ? gameState : null;
            const u = (typeof ui !== 'undefined') ? ui : null;
            this._inst = new TaxUI(gs, u);
        } else {
            this._inst.gameState = (typeof gameState !== 'undefined') ? gameState : this._inst.gameState;
            this._inst.ui = (typeof ui !== 'undefined') ? ui : this._inst.ui;
        }
        return this._inst;
    },
    show() { this._ensure().show(); },
    switchTab(t) { this._ensure().switchTab(t); },
    setEntityType(id) { this._ensure().setEntityType(id); },
    doDeclare(y, m) { this._ensure().doDeclare(y, m); },
    doPay(y, m) { this._ensure().doPay(y, m); },
    doTaxPreference() { this._ensure().doTaxPreference(); },
    _quickPayFirst() { this._ensure()._quickPayFirst(); },
    showReportDetail(y, m) { this._ensure().showReportDetail(y, m); }
};

if (typeof window !== 'undefined') {
    window.TaxUI = TaxUI;
    window.taxUI = taxUI;
}
