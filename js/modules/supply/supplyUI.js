/**
 * supplyUI.js — 供应商谈判与供应链·UI 层
 * 挂载在采购中心新 Tab「供应商关系」(PROC_TABS.relations,由 procurementUI 委托渲染)。
 * 只读渲染 + 动作按钮(谈判账期/开通直采/独家代理/结清账款)。
 */
'use strict';

(function () {
    let _supply = null;
    let _gameState = null;
    let _ui = null;

    function initSupplyUI(supplyState, gameState, uiManager) {
        _supply = supplyState || _supply;
        _gameState = gameState || _gameState;
        _ui = uiManager || _ui;
        return api;
    }

    function _s() { return _supply; }
    function _gs() { return _gameState; }
    function _u() { return _ui; }

    function _fmtMoney(n) {
        if (typeof n !== 'number' || !Number.isFinite(n)) return '¥0';
        if (Math.abs(n) >= 1e8) return '¥' + (n / 1e8).toFixed(2) + '亿';
        if (Math.abs(n) >= 1e4) return '¥' + (n / 1e4).toFixed(1) + '万';
        return '¥' + Math.round(n).toLocaleString();
    }

    function _nextTierInfo(rec) {
        const tiers = (typeof SUPPLY_TIERS !== 'undefined') ? SUPPLY_TIERS : [];
        const idx = tiers.findIndex(t => t && t.id === rec.tier);
        const next = tiers[idx + 1] || null;
        return next;
    }

    function renderRelationsHTML() {
        const supply = _s();
        const gs = _gs();
        if (!supply || !gs || !gs.state) {
            return '<div style="padding:32px;text-align:center;color:#999;">供应商关系模块未初始化</div>';
        }
        const suppliers = (typeof SUPPLIERS !== 'undefined' && Array.isArray(SUPPLIERS)) ? SUPPLIERS : [];
        const day = (gs.state.gameTime && gs.state.gameTime.day) || 1;
        let rows = '';
        suppliers.forEach(s => {
            if (!s || !s.id) return;
            const rec = supply.getRelation(s.id);
            const tierInfo = (typeof SUPPLY_TIERS !== 'undefined')
                ? (SUPPLY_TIERS.find(t => t && t.id === rec.tier) || SUPPLY_TIERS[0]) : null;
            const next = _nextTierInfo(rec);
            const pct = next ? Math.min(100, Math.round((rec.points / next.points) * 100)) : 100;
            const effMul = supply.getEffectiveMultiplier(s.id);
            const credit = rec.credit;
            const creditActive = !!(credit && credit.days > 0);
            const hasCreditBenefit = tierInfo && Array.isArray(tierInfo.benefits) && tierInfo.benefits.indexOf('credit') >= 0;
            const hasDirectBenefit = tierInfo && Array.isArray(tierInfo.benefits) && tierInfo.benefits.indexOf('direct') >= 0;
            const hasExclusiveBenefit = tierInfo && Array.isArray(tierInfo.benefits) && tierInfo.benefits.indexOf('exclusive') >= 0;
            const cfg = (typeof SUPPLY_CONFIG !== 'undefined') ? SUPPLY_CONFIG : null;

            let statusChips = '';
            if (rec.exclusive) statusChips += '<span style="background:#e8d5f5;color:#6a1b9a;">👑 独家×0.85</span>';
            else if (rec.direct) statusChips += '<span style="background:#e3f2fd;color:#1565c0;">🏭 直采×0.92</span>';
            if (creditActive) {
                const overdue = (credit.overdueDays || 0) > 0;
                statusChips += `<span style="background:${overdue ? '#ffebee' : '#e8f5e9'};color:${overdue ? '#c62828' : '#2e7d32'};">💳 ${credit.days}天账期${overdue ? '·逾期' + credit.overdueDays + '天' : ''}</span>`;
            }
            if (!statusChips) statusChips = '<span style="background:#f5f5f5;color:#888;">普通合作</span>';

            let creditLine = '';
            if (credit && credit.liability > 0) {
                creditLine = `
                    <div style="margin-top:8px;padding:8px 10px;background:${(credit.overdueDays || 0) > 0 ? '#ffebee' : '#fff8e1'};border-radius:8px;font-size:12px;color:${(credit.overdueDays || 0) > 0 ? '#c62828' : '#8d6e63'};">
                        应付账款 ${_fmtMoney(credit.liability)} · ${(credit.overdueDays || 0) > 0 ? '已逾期' + credit.overdueDays + '天(罚息+信誉惩罚)' : ('到期日 D' + (credit.dueDay || day))}
                        <button class="btn btn-sm" style="margin-left:8px;padding:3px 10px;" onclick="supplyUI.repay('${s.id}')">立即结清</button>
                    </div>`;
            }

            let actions = '';
            if (hasCreditBenefit && !creditActive) {
                actions += `<button class="btn btn-sm" style="padding:3px 10px;" onclick="supplyUI.openNegotiate('${s.id}')">🤝 谈账期</button>`;
            }
            if (hasDirectBenefit && !rec.direct && !rec.exclusive) {
                actions += `<button class="btn btn-sm" style="padding:3px 10px;" onclick="supplyUI.activateDirect('${s.id}')">🏭 开通直采(¥${((cfg && cfg.directActivationFee) || 20000).toLocaleString()})</button>`;
            }
            if (hasExclusiveBenefit && !rec.exclusive) {
                actions += `<button class="btn btn-sm" style="padding:3px 10px;" onclick="supplyUI.signExclusive('${s.id}')">👑 独家代理(¥${((cfg && cfg.exclusiveAgencyFee) || 50000).toLocaleString()})</button>`;
            }
            if (!actions) actions = '<span style="font-size:11px;color:#bbb;">' + (next ? ('距「' + next.name + '」还需 ' + Math.max(0, Math.round(next.points - rec.points)) + ' 关系值') : '已达顶级') + '</span>';

            rows += `
                <div style="background:#fff;border:1px solid #eee;border-radius:10px;padding:12px 14px;margin-bottom:10px;">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                        <div style="flex:1;min-width:120px;">
                            <div style="font-size:13px;font-weight:700;color:#333;">${s.name}</div>
                            <div style="font-size:11px;color:#888;margin-top:2px;">${s.description || ''}</div>
                        </div>
                        <div style="display:flex;gap:4px;flex-wrap:wrap;">${statusChips}</div>
                    </div>
                    <div style="display:flex;align-items:center;gap:10px;margin-top:8px;">
                        <div style="flex:0 0 64px;font-size:12px;color:#666;">${tierInfo ? tierInfo.name : ''}</div>
                        <div style="flex:1;height:10px;background:#f0f0f0;border-radius:5px;overflow:hidden;">
                            <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#66bb6a,#2e7d32);border-radius:5px;"></div>
                        </div>
                        <div style="flex:0 0 72px;font-size:11px;color:#888;text-align:right;">关系值 ${Math.round(rec.points)}${next ? '/' + next.points : ''}</div>
                    </div>
                    <div style="font-size:11px;color:#999;margin-top:6px;">当前采购价系数 ×${effMul.toFixed(2)}${effMul < 1 ? '(已享优惠)' : ''}</div>
                    ${creditLine}
                    <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">${actions}</div>
                </div>`;
        });
        if (!rows) rows = '<div style="padding:32px;text-align:center;color:#999;">暂无供应商数据</div>';
        return `<div style="padding:4px 2px;">${rows}</div>`;
    }

    function _refreshModal() {
        const ui = _u();
        try {
            if (typeof procUI !== 'undefined' && procUI._render) procUI._render();
        } catch (_) {
            if (ui && typeof ui.forceRender === 'function') ui.forceRender();
        }
    }

    const api = {
        renderRelationsHTML,

        openNegotiate(supplierId) {
            const supply = _s();
            const ui = _u();
            const rec = supply ? supply.getRelation(supplierId) : null;
            if (!rec) return;
            const cfg = (typeof SUPPLY_CONFIG !== 'undefined') ? SUPPLY_CONFIG : { creditOptions: [7, 15, 30] };
            const options = cfg.creditOptions || [7, 15, 30];
            const optsHtml = options.map(d => `<button class="btn btn-sm" onclick="supplyUI.negotiate('${supplierId}', ${d})">${d}天</button>`).join('');
            ui.showModal('🤝 账期谈判', `
                <div style="padding:10px 4px;">
                    <div style="font-size:13px;color:#555;margin-bottom:10px;">选择账期(到期自动扣款,逾期将产生每日罚息与信誉惩罚):</div>
                    <div style="display:flex;gap:10px;justify-content:center;">${optsHtml}</div>
                </div>`, '<button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>');
        },

        negotiate(supplierId, days) {
            const supply = _s();
            const ui = _u();
            const r = supply ? supply.negotiateCredit(supplierId, days) : { success: false, message: '模块未初始化' };
            ui.showToast(r.message);
            if (r.success) { ui.closeModal(); _refreshModal(); }
        },

        activateDirect(supplierId) {
            const supply = _s();
            const ui = _u();
            const r = supply ? supply.activateDirectSource(supplierId) : { success: false, message: '模块未初始化' };
            ui.showToast(r.message);
            if (r.success) _refreshModal();
        },

        signExclusive(supplierId) {
            const supply = _s();
            const ui = _u();
            const r = supply ? supply.signExclusive(supplierId) : { success: false, message: '模块未初始化' };
            ui.showToast(r.message);
            if (r.success) _refreshModal();
        },

        repay(supplierId) {
            const supply = _s();
            const ui = _u();
            const r = supply ? supply.repayCredit(supplierId) : { success: false, message: '模块未初始化' };
            ui.showToast(r.message);
            if (r.success) _refreshModal();
        }
    };

    if (typeof window !== 'undefined') {
        window.initSupplyUI = initSupplyUI;
        window.supplyUI = api;
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = { initSupplyUI };
})();
