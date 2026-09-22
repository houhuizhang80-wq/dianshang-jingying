/**
 * 法务维权 — UI（完整法务中心）
 * Tab：概览 / 诉讼 / 发起上诉 / 律师 / 指南
 */
const legalUI = (function () {
    'use strict';

    let _tab = 'overview';
    let _selectedCaseId = null;
    let _appealDraftReturnId = null;

    function _money(n) {
        const v = Number(n) || 0;
        return typeof formatMoney === 'function' ? formatMoney(v) : ('¥' + v.toFixed(2));
    }
    function _time(t) {
        if (!t) return '-';
        if (typeof t === 'object' && t.day != null) return `第${t.day}天 ${t.hour ?? 0}:00`;
        return String(t);
    }
    function _esc(s) {
        return typeof escapeHtml === 'function' ? escapeHtml(String(s ?? '')) : String(s ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function _toast(msg, type) {
        try {
            if (typeof ui !== 'undefined' && ui.showToast) ui.showToast(msg);
            else if (typeof eventBus !== 'undefined') eventBus.emit('toast:show', { message: msg, type: type || 'info' });
        } catch (_) {}
    }
    function _refreshHost() {
        try {
            const host = document.getElementById('legalCenterRoot');
            if (host) host.innerHTML = _buildInner();
        } catch (e) {
            console.warn('[legalUI] refresh failed', e);
            show();
        }
    }

    function _statusMeta(s) {
        let meta = null;
        if (typeof LITIGATION_STATUS_LABEL !== 'undefined' && LITIGATION_STATUS_LABEL[s]) {
            meta = { ...LITIGATION_STATUS_LABEL[s] };
        } else {
            const fallback = {
                submitted: { name: '已提交', color: '#1976d2', icon: '📮' },
                accepted: { name: '已受理', color: '#0288d1', icon: '📋' },
                review: { name: '审核中', color: '#7b1fa2', icon: '🔎' },
                scheduled: { name: '排期中', color: '#f57c00', icon: '📅' },
                buyer_win: { name: '买家胜诉', color: '#c62828', icon: '😞' },
                merchant_win: { name: '商家胜诉', color: '#2e7d32', icon: '🛡️' },
                compensation: { name: '赔偿执行中', color: '#388e3c', icon: '💵' },
                closed: { name: '已结案', color: '#607d8b', icon: '✅' }
            };
            meta = fallback[s] || { name: s || '未知', color: '#666', icon: '📄' };
        }
        // 商家视角：胜诉绿、败诉红（覆盖数据层颜色偏差）
        if (s === 'merchant_win' || s === 'win' || s === 'partial_win') meta = { ...meta, color: '#2e7d32', icon: meta.icon || '🛡️' };
        if (s === 'buyer_win' || s === 'lose') meta = { ...meta, color: '#c62828', icon: meta.icon || '😞' };
        if (s === 'mediation') meta = { ...meta, color: '#00897b', icon: meta.icon || '🤝' };
        if (s === 'settlement_pending') meta = { ...meta, color: '#00838f', icon: meta.icon || '✍️' };
        return meta;
    }

    function _getCases() {
        try {
            return (typeof LegalState !== 'undefined' && LegalState.getCases) ? LegalState.getCases() : [];
        } catch (_) { return []; }
    }

    function _hasOpenCaseForReturn(returnId) {
        if (!returnId) return false;
        try {
            return _getCases().some(c => c && c.csReturnId === returnId && c.status !== 'closed');
        } catch (_) { return false; }
    }

    function _autoTargets() {
        try {
            if (typeof LegalEngine !== 'undefined' && LegalEngine.listAutoTargets) {
                return LegalEngine.listAutoTargets(gameState) || [];
            }
        } catch (_) {}
        return [];
    }

    function _appealable() {
        try {
            const state = (typeof gameState !== 'undefined' && gameState.state) ? gameState.state : null;
            const returns = (state && state.customerService && state.customerService.returns) || [];
            return returns.filter(r => {
                try {
                    if (_hasOpenCaseForReturn(r.id)) return false;
                    if (typeof LegalEngine !== 'undefined' && LegalEngine.canAppeal) {
                        const res = LegalEngine.canAppeal(r);
                        return !!(res && res.ok);
                    }
                    return false;
                } catch (_) { return false; }
            }).map(r => {
                const chk = LegalEngine.canAppeal(r);
                return { return: r, check: chk };
            });
        } catch (_) { return []; }
    }

    /** 根据售后情形自动生成一键上诉材料 */
    function _buildQuickAppealPayload(r, check) {
        const reasons = (typeof APPEAL_REASONS !== 'undefined' ? APPEAL_REASONS : []);
        const trigger = (check && check.triggerType) || '';
        let reasonId = (reasons[0] && reasons[0].id) || 'malicious_refund';
        if (trigger === 'inspection_dc') reasonId = 'return_fraud';
        else if (trigger === 'goods_not_returned') reasonId = 'goods_not_returned';
        else if (trigger === 'refund_only_rejected') reasonId = 'malicious_refund';
        else if (trigger === 'arbitration_ruled_seller') reasonId = 'platform_arbitration_unfair';
        const reasonInfo = reasons.find(x => x.id === reasonId) || reasons[0] || { id: reasonId, name: '争议维权', suggestedClaims: ['refund_recovery', 'compensation'] };
        const claims = Array.isArray(reasonInfo.suggestedClaims) && reasonInfo.suggestedClaims.length
            ? reasonInfo.suggestedClaims.slice()
            : ['refund_recovery', 'compensation'];
        const amount = Math.max(0, Math.round(Number(r.amount || r.refundAmount || 0) || 0));
        const product = r.productName || '涉案商品';
        const buyer = r.buyerName || '买家';
        const why = (check && check.reason) || '售后争议';
        const statement = `【一键上诉】针对售后单${(r.id || '').slice(-8)}（${product} / ${buyer}），因「${why}」依法申请维权。诉求金额¥${amount}，恳请公正裁判并支持商家合法主张。`;
        return {
            reasonId: reasonInfo.id || reasonId,
            reasonName: reasonInfo.name || reasonId,
            claims,
            claimAmount: amount,
            statement,
            strategy: 'litigate',
            evidence: [{ type: 'text', content: '一键上诉自动提交：售后记录、沟通与质检/仲裁材料摘要' }]
        };
    }

    function _runSubmitAppeal(returnId, payload, onDone, opts) {
        const silent = !!(opts && opts.silent);
        const res = LegalEngine.submitAppeal(
            gameState, returnId, payload.reasonId, payload.statement,
            payload.evidence, payload.claims, payload.claimAmount, '一键上诉',
            { strategy: payload.strategy || 'litigate', lawyerId: null }
        );
        if (res && res.success) {
            if (!silent) _toast(res.message || '一键上诉已提交');
            if (typeof onDone === 'function') onDone(res);
            else {
                _appealDraftReturnId = null;
                _tab = 'cases';
                _selectedCaseId = res.caseId || (res.caseData && res.caseData.id) || null;
                _refreshHost();
                try { if (typeof gameState !== 'undefined') gameState.notify(); } catch (_) {}
            }
        } else if (!silent) {
            _toast((res && res.message) || '一键上诉失败');
        }
        return res;
    }

    /**
     * 一键上诉：自动案由/诉求/陈述，确认受理费后立即立案
     */
    function oneClickAppeal(returnId) {
        try {
            if (!returnId) { _toast('缺少售后单'); return; }
            if (_hasOpenCaseForReturn(returnId)) { _toast('该售后单已有进行中的诉讼'); return; }
            const hit = _appealable().find(x => x.return && x.return.id === returnId);
            if (!hit) {
                // 再查一次原始记录（可能刚变为可上诉）
                const state = gameState && gameState.state;
                const r = ((state && state.customerService && state.customerService.returns) || []).find(x => x.id === returnId);
                const chk = r && LegalEngine.canAppeal(r);
                if (!r || !chk || !chk.ok) { _toast('该售后单当前不可上诉'); return; }
                return oneClickAppealWith(r, chk);
            }
            return oneClickAppealWith(hit.return, hit.check);
        } catch (e) {
            console.error(e);
            _toast('一键上诉异常：' + (e.message || e));
        }
    }

    function oneClickAppealWith(r, check) {
        const payload = _buildQuickAppealPayload(r, check);
        const fee = (typeof LEGAL_PROCESS_CONFIG !== 'undefined' && LEGAL_PROCESS_CONFIG.filingFee) || 50;
        const run = () => _runSubmitAppeal(r.id, payload);
        if (typeof ui !== 'undefined' && typeof ui.confirmPayment === 'function' && fee > 0) {
            ui.confirmPayment({
                title: '一键上诉 · 确认受理费',
                amount: fee,
                detailHtml: `自动案由：${_esc(payload.reasonName)}<br>商品：${_esc(r.productName || '-')}<br>诉求金额 ${_money(payload.claimAmount)}`,
                note: '将使用默认「坚持诉讼」策略，并自动指派高等级律师（如有）。',
                onConfirm: run
            });
        } else {
            run();
        }
    }

    /**
     * 一键上诉全部可上诉售后单（批量确认总受理费）
     */
    function oneClickAppealAll() {
        try {
            const list = _appealable();
            if (!list.length) { _toast('当前没有可一键上诉的售后单'); return; }
            const feeUnit = (typeof LEGAL_PROCESS_CONFIG !== 'undefined' && LEGAL_PROCESS_CONFIG.filingFee) || 50;
            const totalFee = feeUnit * list.length;
            const run = () => {
                let ok = 0, fail = 0;
                const lastOk = { caseId: null };
                list.forEach(({ return: r, check }) => {
                    if (_hasOpenCaseForReturn(r.id)) { fail++; return; }
                    const payload = _buildQuickAppealPayload(r, check);
                    const res = _runSubmitAppeal(r.id, payload, (ret) => {
                        ok++;
                        lastOk.caseId = ret.caseId || (ret.caseData && ret.caseData.id) || lastOk.caseId;
                    }, { silent: true });
                    if (!(res && res.success)) fail++;
                });
                _appealDraftReturnId = null;
                _tab = 'cases';
                _selectedCaseId = lastOk.caseId;
                _toast(`一键上诉完成：成功 ${ok} 单${fail ? '，失败 ' + fail + ' 单' : ''}`);
                _refreshHost();
                try { if (typeof gameState !== 'undefined') gameState.notify(); } catch (_) {}
            };
            if (typeof ui !== 'undefined' && typeof ui.confirmPayment === 'function' && totalFee > 0) {
                ui.confirmPayment({
                    title: '一键上诉全部',
                    amount: totalFee,
                    detailHtml: `将对 <b>${list.length}</b> 单可上诉售后自动立案<br>单件受理费 ${_money(feeUnit)}`,
                    note: '每单自动匹配案由与诉求，策略为坚持诉讼。',
                    onConfirm: run
                });
            } else {
                run();
            }
        } catch (e) {
            console.error(e);
            _toast('批量上诉异常：' + (e.message || e));
        }
    }

    function _lawyers() {
        const state = (typeof gameState !== 'undefined' && gameState.state) ? gameState.state : null;
        const employees = (state && state.employees) || [];
        return employees.filter(e => e && (e.type === 'lawyer' || e.type === 'legal') && e.status !== 'fired');
    }

    function _stats(cases) {
        let win = 0, lose = 0, paid = 0, received = 0, fees = 0;
        cases.forEach(c => {
            if (c.status === 'merchant_win' || c.status === 'win') win++;
            if (c.status === 'buyer_win' || c.status === 'lose') lose++;
            // 结案后的胜负也计入（closed 前可能已记过 win/lose）
            if (c.status === 'closed') {
                const hist = c.statusHistory || [];
                if (hist.some(h => h.status === 'merchant_win')) win++;
                else if (hist.some(h => h.status === 'buyer_win')) lose++;
            }
            received += Number(c.compensationReceived || c.award || 0) || 0;
            paid += Number(c.compensationPaid || c.loss || 0) || 0;
            fees += Number(c.filingFee || 0) || 0;
        });
        // 去重：closed 前若已是 merchant_win 会双计，按案件终态再归一
        win = cases.filter(c =>
            c.status === 'merchant_win' || c.status === 'win' ||
            (c.status === 'closed' && (c.statusHistory || []).some(h => h.status === 'merchant_win'))
        ).length;
        lose = cases.filter(c =>
            c.status === 'buyer_win' || c.status === 'lose' ||
            (c.status === 'closed' && (c.statusHistory || []).some(h => h.status === 'buyer_win'))
        ).length;
        const inFlight = cases.filter(c => c.status !== 'closed').length;
        const judged = win + lose;
        return {
            total: cases.length,
            win, lose,
            active: inFlight,
            received, paid, fees,
            winRate: judged > 0 ? Math.round(win / judged * 100) : 0,
            loseRate: judged > 0 ? Math.round(lose / judged * 100) : 0,
            net: received - paid - fees
        };
    }

    function show() {
        const u = (typeof ui !== 'undefined') ? ui : null;
        if (!u || typeof u.showModal !== 'function') return;
        try {
            if (typeof LegalEngine !== 'undefined' && LegalEngine.init && typeof gameState !== 'undefined') {
                LegalEngine.init(gameState);
            }
        } catch (_) {}
        _tab = 'overview';
        _selectedCaseId = null;
        _appealDraftReturnId = null;
        u.showModal('⚖️ 法务维权中心', `<div id="legalCenterRoot">${_buildInner()}</div>`,
            `<button class="btn btn-secondary" style="flex:1;" onclick="ui.closeModal();">关闭</button>`,
            { width: '900px', noBodyPadding: true, modalId: 'legalCenterModal' });
        // 兼容旧刷新钩子
        if (u) {
            u._refreshLegalTab = (tab) => switchTab(tab);
        }
    }

    function switchTab(tab) {
        _tab = tab || 'overview';
        _selectedCaseId = null;
        _refreshHost();
    }

    function openCaseDetail(caseId) {
        _selectedCaseId = caseId;
        _tab = 'cases';
        _refreshHost();
    }

    function backToCaseList() {
        _selectedCaseId = null;
        _refreshHost();
    }

    function startAppealDraft(returnId) {
        _appealDraftReturnId = returnId;
        _tab = 'appeal';
        _refreshHost();
    }

    function cancelAppealDraft() {
        _appealDraftReturnId = null;
        _refreshHost();
    }

    function submitAppealFromUI() {
        try {
            const returnId = _appealDraftReturnId || (document.getElementById('legalAppealReturnId') || {}).value;
            const reasonId = (document.getElementById('legalAppealReason') || {}).value;
            const statement = ((document.getElementById('legalAppealStatement') || {}).value || '').trim();
            const claimAmountRaw = parseFloat((document.getElementById('legalAppealAmount') || {}).value || '0') || 0;
            // 前端二次钳制（与引擎一致）
            let sourceAmt = 0;
            try {
                const ret = (gameState.state.customerService.returns || []).find(x => x.id === returnId);
                sourceAmt = parseFloat(ret && (ret.refundAmount != null ? ret.refundAmount : ret.amount)) || 0;
            } catch (_) {}
            const softCap = Math.max(sourceAmt * 3, 100);
            const claimAmount = Math.min(Math.max(0, claimAmountRaw), softCap, 1000000);
            const claimChecks = Array.from(document.querySelectorAll('input[name="legalClaim"]:checked')).map(el => el.value);
            if (!returnId) { _toast('请选择可上诉售后单'); return; }
            if (!reasonId) { _toast('请选择案由'); return; }
            if (statement.length < 10) { _toast('请填写至少10字的上诉陈述'); return; }
            if (!claimChecks.length) { _toast('请至少勾选一项诉讼请求'); return; }

            const fee = (typeof LEGAL_PROCESS_CONFIG !== 'undefined' && LEGAL_PROCESS_CONFIG.filingFee) || 50;
            const strategy = ((document.getElementById('legalAppealStrategy') || {}).value) || 'litigate';
            const lawyerId = ((document.getElementById('legalAppealLawyer') || {}).value) || '';
            const run = () => {
                const res = LegalEngine.submitAppeal(
                    gameState, returnId, reasonId, statement,
                    [{ type: 'text', content: '法务中心提交的证据说明' }],
                    claimChecks, claimAmount, '',
                    { strategy, lawyerId: lawyerId || null }
                );
                if (res && res.success) {
                    _toast(res.message || '上诉已提交');
                    _appealDraftReturnId = null;
                    _tab = 'cases';
                    _selectedCaseId = res.caseId || (res.caseData && res.caseData.id) || null;
                    _refreshHost();
                    try { if (typeof gameState !== 'undefined') gameState.notify(); } catch (_) {}
                } else {
                    _toast((res && res.message) || '提交失败');
                }
            };
            if (typeof ui !== 'undefined' && typeof ui.confirmPayment === 'function' && fee > 0) {
                ui.confirmPayment({
                    title: '确认支付案件受理费',
                    amount: fee,
                    detailHtml: `法务上诉受理费<br>诉求金额 ${_money(claimAmount)}`,
                    note: '确认后将扣除受理费并正式立案。',
                    onConfirm: run
                });
            } else {
                run();
            }
        } catch (e) {
            console.error(e);
            _toast('提交异常：' + (e.message || e));
        }
    }

    function goHireLawyer() {
        try {
            if (typeof ui !== 'undefined') {
                ui.closeModal();
                if (ui.showEmployeeManagerModal) {
                    ui.showEmployeeManagerModal();
                    ui.showToast('请在员工管理中招聘「律师」');
                } else if (ui.navigateToEmployee) {
                    ui.navigateToEmployee();
                }
            }
        } catch (_) {}
    }

    function openAfterSales() {
        try {
            if (typeof ui !== 'undefined') {
                ui.closeModal();
                if (ui.showAfterSalesCenter) ui.showAfterSalesCenter();
                else ui.navigateTo('service');
            }
        } catch (_) {}
    }

    // ---------- renders ----------

    function _renderOverview(stats, cases, appealable, lawyers) {
        const fee = (typeof LEGAL_PROCESS_CONFIG !== 'undefined' && LEGAL_PROCESS_CONFIG.filingFee) || 50;
        const windowH = (typeof LEGAL_PROCESS_CONFIG !== 'undefined' && LEGAL_PROCESS_CONFIG.appealWindowHours) || 72;
        const recent = cases.slice(0, 3);
        let monthComp = 0, totalComp = 0;
        try {
            const shop = (typeof gameState !== 'undefined' && gameState.state && gameState.state.shop) ? gameState.state.shop : null;
            monthComp = Number(shop && shop.legalCompensationMonth) || 0;
            totalComp = Number(shop && shop.legalCompensationTotal) || 0;
        } catch (_) {}
        return `
            <div style="background:linear-gradient(135deg,#7b1fa2,#5e35b1);border-radius:14px;padding:16px;color:#fff;margin-bottom:14px;">
                <div style="font-size:16px;font-weight:700;">⚖️ 店铺法务中枢</div>
                <div style="font-size:12px;opacity:.9;margin-top:4px;line-height:1.5;">
                    招聘律师后，系统会自动起诉两类纠纷：①买家已退款却不退货（不当得利）；②快递丢件拒赔或赔不足额。受理费 ${_money(fee)} / 件。判决按民法典、消保法、快递暂行条例认定，胜诉回款律师提成 5%。
                </div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px;">
                ${_miniStat('总案件', stats.total, '#5e35b1')}
                ${_miniStat('进行中', stats.active, '#0288d1')}
                ${_miniStat('胜诉率', stats.winRate + '%', '#2e7d32')}
                ${_miniStat('净损益', _money(stats.net), stats.net >= 0 ? '#e65100' : '#c62828')}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;">
                ${_miniStat('月度赔偿', _money(monthComp), '#2e7d32')}
                ${_miniStat('总赔偿', _money(totalComp), '#1565c0')}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
                <div class="legal-case-card" style="border-left-color:#0277bd;margin:0;">
                    <div style="font-size:12px;color:#666;">待律师立案 / 可上诉</div>
                    <div style="font-size:22px;font-weight:800;color:#0277bd;margin:4px 0;">${appealable.length + _autoTargets().length}</div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;">
                        ${appealable.length ? `<button class="btn btn-primary btn-small" onclick="legalUI.oneClickAppealAll()">⚡ 一键上诉全部</button>` : ''}
                        <button class="btn btn-secondary btn-small" onclick="legalUI.switchTab('appeal')">查看列表</button>
                    </div>
                </div>
                <div class="legal-case-card" style="border-left-color:#7b1fa2;margin:0;">
                    <div style="font-size:12px;color:#666;">在职律师</div>
                    <div style="font-size:22px;font-weight:800;color:#7b1fa2;margin:4px 0;">${lawyers.length}</div>
                    <button class="btn btn-secondary btn-small" onclick="legalUI.switchTab('lawyers')">查看团队</button>
                </div>
            </div>
            ${legalUI._renderTrademarkSection()}
            <div style="font-weight:700;font-size:13px;margin-bottom:8px;">⏱ 最近案件</div>
            ${recent.length ? recent.map(c => _caseCard(c, true)).join('') : `
                <div class="empty-state" style="padding:20px 0;">
                    <div class="icon">📋</div>
                    <div class="text">暂无诉讼<br><span style="font-size:11px;">有争议时可在「发起上诉」提交</span></div>
                </div>`}
            <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
                ${appealable.length ? `<button class="btn btn-primary btn-small" style="background:linear-gradient(135deg,#7b1fa2,#5e35b1);" onclick="legalUI.oneClickAppealAll()">⚡ 一键上诉（${appealable.length}）</button>` : ''}
                <button class="btn btn-secondary btn-small" onclick="legalUI.switchTab('guide')">📖 流程指南</button>
                <button class="btn btn-secondary btn-small" onclick="legalUI.openAfterSales()">📞 打开售后</button>
            </div>
        `;
    }

    function _miniStat(label, value, color) {
        return `<div class="tax-stat-card" style="border-left-color:${color};padding:10px;">
            <div style="font-size:11px;color:#999;">${label}</div>
            <div style="font-size:18px;font-weight:800;color:${color};margin-top:2px;">${value}</div>
        </div>`;
    }

    function _caseCard(c, compact) {
        const st = _statusMeta(c.status);
        const reason = (c.reasonInfo && c.reasonInfo.name) || c.reasonId || '案由未填';
        const shortId = (c.id || '').slice(-8);
        return `
            <div class="legal-case-card" style="border-left-color:${st.color};cursor:pointer;" onclick="legalUI.openCaseDetail('${_esc(c.id)}')">
                <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">
                    <div style="min-width:0;">
                        <div style="font-weight:700;font-size:13px;">${st.icon || ''} ${_esc(reason)}${c.autoFiled ? ' · 自动' : ''}</div>
                        <div style="font-size:11px;color:#999;margin-top:3px;">案号 …${_esc(shortId)} · 创建 ${_time(c.createTime)}${c.defendantName ? ' · 告 ' + _esc(c.defendantName) : ''}</div>
                    </div>
                    <span style="flex-shrink:0;font-size:11px;font-weight:700;color:${st.color};background:${st.color}18;padding:3px 8px;border-radius:999px;">${_esc(st.name)}</span>
                </div>
                ${compact ? '' : `
                <div style="font-size:12px;color:#555;margin-top:8px;line-height:1.45;">
                    ${(c.statement || '（无陈述）').slice(0, 80)}${(c.statement || '').length > 80 ? '…' : ''}
                </div>
                <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:8px;font-size:11px;color:#777;">
                    <span>诉求额 ${_money(c.claimAmount)}</span>
                    <span>受理费 ${_money(c.filingFee)}</span>
                    ${c.compensationReceived ? `<span style="color:#2e7d32;">获赔 ${_money(c.compensationReceived)}</span>` : ''}
                    ${c.compensationPaid ? `<span style="color:#c62828;">赔付 ${_money(c.compensationPaid)}</span>` : ''}
                </div>`}
            </div>`;
    }

    function _renderCaseDetail(c) {
        if (!c) {
            return `<div class="empty-state"><div class="text">案件不存在</div>
                <button class="btn btn-secondary btn-small" onclick="legalUI.backToCaseList()">返回列表</button></div>`;
        }
        const st = _statusMeta(c.status);
        const reason = (c.reasonInfo && c.reasonInfo.name) || c.reasonId || '-';
        const history = Array.isArray(c.statusHistory) ? c.statusHistory : [];
        const claims = Array.isArray(c.claims) ? c.claims : [];
        const claimNames = (typeof LITIGATION_CLAIM_TYPES !== 'undefined' ? LITIGATION_CLAIM_TYPES : [])
            .filter(x => claims.includes(x.id)).map(x => x.icon + x.name);
        const lawyer = _lawyers().find(l => l.id === c.assignedLawyerId);
        const steps = ['submitted', 'accepted', 'review', 'scheduled', 'merchant_win', 'compensation', 'closed'];
        // progress: map buyer_win onto same stage as merchant_win for bar
        const stageKey = (c.status === 'buyer_win') ? 'merchant_win' : c.status;
        const stageIdx = Math.max(0, steps.indexOf(stageKey));

        return `
            <button class="btn btn-secondary btn-small" style="margin-bottom:10px;" onclick="legalUI.backToCaseList()">← 返回列表</button>
            <div class="legal-case-card" style="border-left-color:${st.color};">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                    <div style="font-weight:800;font-size:15px;">${st.icon} ${_esc(reason)}</div>
                    <span style="font-size:12px;font-weight:700;color:${st.color};">${_esc(st.name)}</span>
                </div>
                <div style="font-size:11px;color:#999;margin-top:4px;">案号 ${_esc(c.id)}</div>
                <div style="margin:12px 0 8px;display:flex;gap:4px;">
                    ${steps.map((s, i) => {
                        const meta = _statusMeta(s);
                        const on = i <= stageIdx;
                        return `<div title="${meta.name}" style="flex:1;height:6px;border-radius:4px;background:${on ? meta.color : '#eee'};"></div>`;
                    }).join('')}
                </div>
                <div style="font-size:11px;color:#888;margin-bottom:10px;">流程：提交 → 受理 → 审核 → 排期开庭 → 判决 → 执行 → 结案</div>

                <div style="background:#faf7ff;border-radius:10px;padding:12px;font-size:12px;line-height:1.7;color:#444;">
                    <div><b>关联订单</b>：${_esc(c.orderId || '-')}</div>
                    <div><b>售后单</b>：${_esc(c.csReturnId || '-')}</div>
                    <div><b>被告</b>：${_esc(c.defendantName || (c.defendant === 'courier' ? '快递公司' : '买家'))}${c.autoFiled ? ' · 律师自动立案' : ''}</div>
                    <div><b>创建时间</b>：${_time(c.createTime)}</div>
                    <div><b>代理律师</b>：${lawyer ? _esc(lawyer.name) + '（Lv.' + (lawyer.level || 1) + '）' : '未指派（将按基础胜率计算）'}</div>
                    ${c.statuteCite ? `<div><b>法律依据</b>：${_esc(c.statuteCite.split('\n')[0])}</div>` : ''}
                    <div><b>维权策略</b>：${_esc((typeof LEGAL_STRATEGY !== 'undefined' && LEGAL_STRATEGY[c.strategy]) ? LEGAL_STRATEGY[c.strategy].name : (c.strategy || '诉讼'))}</div>
                    <div><b>诉求金额</b>：${_money(c.claimAmount)}</div>
                    <div><b>受理费</b>：${_money(c.filingFee)}</div>
                    <div><b>诉讼请求</b>：${claimNames.length ? claimNames.join('、') : '（未勾选）'}</div>
                    ${c.outcomeTier ? `<div><b>判决档位</b>：${_esc((typeof LEGAL_OUTCOME_TIERS !== 'undefined' && LEGAL_OUTCOME_TIERS[c.outcomeTier]) ? LEGAL_OUTCOME_TIERS[c.outcomeTier].name : c.outcomeTier)}${c.recoveryRatio != null ? ' · 回款比例 ' + Math.round(c.recoveryRatio * 100) + '%' : ''}</div>` : ''}
                    ${c.compensationReceived ? `<div style="color:#2e7d32;"><b>获赔回款</b>：${_money(c.compensationReceived)}</div>` : ''}
                    ${c.compensationPaid ? `<div style="color:#c62828;"><b>败诉赔付</b>：${_money(c.compensationPaid)}</div>` : ''}
                    ${c.finalResult || (c.statusHistory && c.statusHistory.slice(-1)[0] && c.statusHistory.slice(-1)[0].extra && c.statusHistory.slice(-1)[0].extra.judgmentReason)
                        ? `<div><b>判决说明</b>：${_esc((c.statusHistory.slice(-1)[0].extra && c.statusHistory.slice(-1)[0].extra.judgmentReason) || c.finalResult || '')}</div>` : ''}
                </div>

                ${c.status === 'mediation' && c.mediationOffer ? `
                <div style="margin-top:12px;padding:12px;background:#e0f2f1;border-radius:10px;">
                    <div style="font-weight:700;font-size:13px;color:#00695c;margin-bottom:6px;">🤝 调解方案</div>
                    <div style="font-size:12px;color:#333;margin-bottom:10px;">
                        对方/法院建议按诉求的 <b>${Math.round((c.mediationOffer.ratio || 0) * 100)}%</b> 回款
                        （约 ${_money(c.mediationOffer.amount)}）
                    </div>
                    <div style="display:flex;flex-wrap:wrap;gap:8px;">
                        <button class="btn btn-primary btn-small" onclick="legalUI.respondMediation('${_esc(c.id)}','accept')">接受调解</button>
                        <button class="btn btn-secondary btn-small" onclick="legalUI.respondMediation('${_esc(c.id)}','counter')">还价至65%</button>
                        <button class="btn btn-secondary btn-small" onclick="legalUI.respondMediation('${_esc(c.id)}','reject')">拒绝并开庭</button>
                    </div>
                </div>` : ''}

                ${c.status === 'settlement_pending' && c.settlementOffer ? `
                <div style="margin-top:12px;padding:12px;background:#e0f7fa;border-radius:10px;">
                    <div style="font-weight:700;font-size:13px;color:#006064;margin-bottom:6px;">✍️ 和解方案</div>
                    <div style="font-size:12px;color:#333;margin-bottom:10px;">
                        对方提出按诉求 <b>${Math.round((c.settlementOffer.ratio || 0) * 100)}%</b> 和解
                        （约 ${_money(c.settlementOffer.amount)}）
                    </div>
                    <div style="display:flex;flex-wrap:wrap;gap:8px;">
                        <button class="btn btn-primary btn-small" onclick="legalUI.respondSettlement('${_esc(c.id)}','accept')">接受和解</button>
                        <button class="btn btn-secondary btn-small" onclick="legalUI.respondSettlement('${_esc(c.id)}','reject')">拒绝并开庭</button>
                    </div>
                </div>` : ''}

                <div style="margin-top:12px;font-weight:700;font-size:13px;">📝 上诉陈述</div>
                <div style="margin-top:6px;padding:10px;background:#fafafa;border-radius:8px;font-size:12px;line-height:1.6;color:#333;white-space:pre-wrap;">${_esc(c.statement || '（无）')}</div>

                <div style="margin-top:14px;font-weight:700;font-size:13px;">📍 案件时间线</div>
                <div style="margin-top:8px;border-left:2px solid #e1bee7;padding-left:12px;">
                    ${history.length ? history.map(h => {
                        const hm = _statusMeta(h.status);
                        return `<div style="margin-bottom:10px;">
                            <div style="font-size:12px;font-weight:700;color:${hm.color};">${hm.icon} ${_esc(hm.name)}</div>
                            <div style="font-size:11px;color:#999;">${_time(h.time)}</div>
                            ${h.extra && h.extra.judgmentReason ? `<div style="font-size:11px;color:#666;">${_esc(h.extra.judgmentReason)}</div>` : ''}
                        </div>`;
                    }).join('') : '<div style="font-size:12px;color:#999;">暂无记录</div>'}
                </div>
            </div>
        `;
    }

    function _renderCases(cases) {
        if (_selectedCaseId) {
            const c = cases.find(x => x.id === _selectedCaseId) ||
                (typeof LegalState !== 'undefined' && LegalState.getCase ? LegalState.getCase(_selectedCaseId) : null);
            return _renderCaseDetail(c);
        }
        if (!cases.length) {
            return `<div class="empty-state"><div class="icon">📋</div>
                <div class="text">暂无诉讼记录<br><span style="font-size:11px;">可在「发起上诉」从售后争议单创建案件</span></div>
                <button class="btn btn-primary btn-small" style="margin-top:10px;" onclick="legalUI.switchTab('appeal')">发起上诉</button>
            </div>`;
        }
        const active = cases.filter(c => c.status !== 'closed');
        const closed = cases.filter(c => c.status === 'closed');
        return `
            <div style="font-size:12px;color:#666;margin-bottom:10px;">共 ${cases.length} 件 · 进行中 ${active.length} · 已结案 ${closed.length}</div>
            ${cases.map(c => _caseCard(c, false)).join('')}
        `;
    }

    function _renderAppeal(appealable) {
        if (_appealDraftReturnId) {
            return _renderAppealForm(_appealDraftReturnId, appealable);
        }
        const fee = (typeof LEGAL_PROCESS_CONFIG !== 'undefined' && LEGAL_PROCESS_CONFIG.filingFee) || 50;
        const autos = _autoTargets();
        if (!appealable.length && !autos.length) {
            return `
                <div class="empty-state">
                    <div class="icon">🆕</div>
                    <div class="text">当前没有可上诉的售后单</div>
                    <div style="font-size:12px;color:#888;line-height:1.7;margin-top:8px;text-align:left;max-width:320px;margin-left:auto;margin-right:auto;">
                        律师在职时会自动立案：<br>
                        1）买家已拿退款却不退货<br>
                        2）快递丢件拒赔或赔不足额<br>
                        也可手动上诉：仅退款被拒 / 质检 C·D / 仲裁不公（72 小时内）
                    </div>
                    <button class="btn btn-secondary btn-small" style="margin-top:12px;" onclick="legalUI.openAfterSales()">去售后查看</button>
                </div>`;
        }
        return `
            <div style="background:#e3f2fd;border-radius:10px;padding:10px 12px;font-size:12px;color:#1565c0;margin-bottom:12px;line-height:1.5;">
                发现 <b>${appealable.length}</b> 单可上诉。单件受理费 <b>${_money(fee)}</b>。
                可用「一键上诉」自动匹配案由/诉求并立案，也可手动填写。
            </div>
            <div style="margin-bottom:12px;">
                <button class="btn btn-primary btn-block" style="background:linear-gradient(135deg,#7b1fa2,#5e35b1);font-weight:800;"
                    onclick="legalUI.oneClickAppealAll()">⚡ 一键上诉全部（${appealable.length} 单 · 合计 ${_money(fee * appealable.length)}）</button>
            </div>
            ${_autoTargets().filter(t => t.kind === 'courier_loss_unpaid').map(t => `
                <div class="legal-case-card" style="border-left-color:#e65100;">
                    <div style="font-weight:700;font-size:13px;">🚚 ${_esc(t.title)} · 快递拒赔 ${_money(t.amount)}</div>
                    <div style="font-size:11px;color:#666;margin-top:4px;">被告 ${_esc(t.defendantName)} · 律师在职后将自动起诉追偿实际损失</div>
                </div>`).join('')}
            ${appealable.map(({ return: r, check }) => {
                const typeName = (typeof RETURN_TYPE_LABEL !== 'undefined' && RETURN_TYPE_LABEL[r.type])
                    ? RETURN_TYPE_LABEL[r.type].name : (r.type || '售后');
                const remain = (check && typeof check.remainingHours === 'number')
                    ? Math.max(0, Math.round(check.remainingHours)) : '-';
                return `
                <div class="legal-case-card" style="border-left-color:#0277bd;">
                    <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">
                        <div style="min-width:0;flex:1;">
                            <div style="font-weight:700;font-size:13px;">${_esc(r.productName || '商品')} · ${_money(r.amount || r.refundAmount || 0)}</div>
                            <div style="font-size:11px;color:#666;margin-top:3px;">
                                ${typeName} · 买家 ${_esc(r.buyerName || '-')} · 售后 ${_esc((r.id || '').slice(-8))}
                            </div>
                            <div style="font-size:11px;color:#0277bd;margin-top:4px;">
                                ${_esc(check.reason || '可上诉')} · 剩余约 ${remain} 小时
                            </div>
                        </div>
                        <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">
                            <button class="btn btn-primary btn-small" style="background:linear-gradient(135deg,#7b1fa2,#5e35b1);"
                                onclick="event.stopPropagation();legalUI.oneClickAppeal('${_esc(r.id)}')">⚡ 一键上诉</button>
                            <button class="btn btn-secondary btn-small" onclick="event.stopPropagation();legalUI.startAppealDraft('${_esc(r.id)}')">填写上诉</button>
                        </div>
                    </div>
                </div>`;
            }).join('')}`;
    }

    function _renderAppealForm(returnId, appealable) {
        const hit = appealable.find(x => x.return && x.return.id === returnId);
        const r = hit ? hit.return : null;
        const reasons = (typeof APPEAL_REASONS !== 'undefined' ? APPEAL_REASONS : []);
        const claims = (typeof LITIGATION_CLAIM_TYPES !== 'undefined' ? LITIGATION_CLAIM_TYPES : []);
        const fee = (typeof LEGAL_PROCESS_CONFIG !== 'undefined' && LEGAL_PROCESS_CONFIG.filingFee) || 50;
        const trig = hit && hit.check && hit.check.triggerType;
        const defaultReason = trig === 'inspection_dc' ? 'return_fraud'
            : (trig === 'goods_not_returned' ? 'goods_not_returned'
                : (trig === 'refund_only_rejected' ? 'malicious_refund'
                    : ((reasons[0] && reasons[0].id) || '')));
        const suggested = (reasons.find(x => x.id === defaultReason) || {}).suggestedClaims || ['refund_recovery', 'compensation'];

        if (!r) {
            return `<div class="empty-state"><div class="text">售后单不存在或已失效</div>
                <button class="btn btn-secondary btn-small" onclick="legalUI.cancelAppealDraft()">返回</button></div>`;
        }

        return `
            <button class="btn btn-secondary btn-small" style="margin-bottom:10px;" onclick="legalUI.cancelAppealDraft()">← 返回可选列表</button>
            <div class="legal-case-card" style="border-left-color:#5e35b1;">
                <div style="font-weight:800;font-size:14px;margin-bottom:6px;">📝 提交上诉材料</div>
                <div style="font-size:12px;color:#666;margin-bottom:12px;line-height:1.5;">
                    针对：${_esc(r.productName || '商品')} / ${_esc(r.buyerName || '买家')} / ${_money(r.amount || 0)}<br>
                    受理费 <b style="color:#e65100;">${_money(fee)}</b> 将在提交时从店铺资金扣除
                </div>
                <input type="hidden" id="legalAppealReturnId" value="${_esc(r.id)}"/>

                <label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px;">案由</label>
                <select id="legalAppealReason" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;margin-bottom:12px;font-size:13px;">
                    ${reasons.map(x => `<option value="${_esc(x.id)}" ${x.id === defaultReason ? 'selected' : ''}>${x.icon || ''} ${_esc(x.name)}（基准胜率 ${Math.round((x.baseWinRate || 0) * 100)}%）</option>`).join('')}
                </select>

                <label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px;">维权策略</label>
                <select id="legalAppealStrategy" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;margin-bottom:12px;font-size:13px;">
                    ${Object.values(typeof LEGAL_STRATEGY !== 'undefined' ? LEGAL_STRATEGY : {
                        litigate: { id: 'litigate', name: '坚持诉讼', icon: '⚔️', desc: '' },
                        mediate: { id: 'mediate', name: '申请调解', icon: '🤝', desc: '' },
                        settle: { id: 'settle', name: '主动和解', icon: '🕊️', desc: '' }
                    }).map(s => `<option value="${_esc(s.id)}">${s.icon || ''} ${_esc(s.name)} — ${_esc(s.desc || '')}</option>`).join('')}
                </select>

                <label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px;">代理律师</label>
                <select id="legalAppealLawyer" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;margin-bottom:12px;font-size:13px;">
                    <option value="">自动指派（优先高等级）</option>
                    ${_lawyers().map(l => {
                        const lv = l.level || 1;
                        return `<option value="${_esc(l.id)}">${_esc(l.name)} · Lv.${lv}</option>`;
                    }).join('')}
                </select>

                <label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px;">上诉陈述（≥10字）</label>
                <textarea id="legalAppealStatement" rows="4" placeholder="请说明争议经过、证据要点与诉求依据…"
                    style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:13px;box-sizing:border-box;margin-bottom:12px;">买家售后处理存在争议，商家依法申请维权，恳请公正裁判。</textarea>

                <label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px;">诉求金额（元）</label>
                <div style="font-size:11px;color:#888;margin-bottom:4px;">上限：售后金额×3（最高100万），防止虚高索赔</div>
                <input id="legalAppealAmount" type="number" min="0" max="${Math.min(1000000, Math.max((Number(r.amount)||0)*3, 100))}" step="1" value="${Math.round(Number(r.amount) || 0)}"
                    style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:13px;box-sizing:border-box;margin-bottom:12px;"/>

                <label style="font-size:12px;font-weight:700;display:block;margin-bottom:6px;">诉讼请求（可多选）</label>
                <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px;">
                    ${claims.map(x => `
                        <label style="display:flex;align-items:center;gap:8px;font-size:12px;padding:8px 10px;background:#fafafa;border-radius:8px;cursor:pointer;">
                            <input type="checkbox" name="legalClaim" value="${_esc(x.id)}" ${suggested.includes(x.id) ? 'checked' : ''}/>
                            <span>${x.icon || ''} ${_esc(x.name)}</span>
                        </label>`).join('')}
                </div>

                <button class="btn btn-primary btn-block" style="background:linear-gradient(135deg,#7b1fa2,#5e35b1);margin-bottom:8px;"
                    onclick="legalUI.submitAppealFromUI()">提交上诉并支付受理费</button>
                <button class="btn btn-secondary btn-block"
                    onclick="legalUI.oneClickAppeal('${_esc(r.id)}')">⚡ 改用一键上诉（自动材料）</button>
            </div>
        `;
    }

    function _renderLawyers(lawyers, cases) {
        if (!lawyers.length) {
            return `
                <div class="empty-state">
                    <div class="icon">⚖️</div>
                    <div class="text">暂无法务律师</div>
                    <div style="font-size:12px;color:#888;margin-top:6px;line-height:1.6;">
                        律师会自己起诉、出庭、申请执行。重点追偿：已退款未退货、快递丢件拒赔。等级越高胜率与回款越高。
                    </div>
                    <button class="btn btn-primary btn-small" style="margin-top:12px;" onclick="legalUI.goHireLawyer()">去招聘律师</button>
                </div>`;
        }
        const cfg = (typeof LEGAL_STAFF_CONFIG !== 'undefined' && LEGAL_STAFF_CONFIG.lawyer) ? LEGAL_STAFF_CONFIG.lawyer : {};
        return `
            <div style="background:#f3e5f5;border-radius:10px;padding:10px 12px;font-size:12px;color:#6a1b9a;margin-bottom:12px;line-height:1.5;">
                律师诉讼加成：等级每 +1，胜率约 +${Math.round(3 * ((cfg.specialtyBonus && cfg.specialtyBonus.litigation) || 1.6))}%（上限 +25%）。当前团队 ${lawyers.length} 人。
            </div>
            ${lawyers.map(l => {
                const assigned = cases.filter(c => c.assignedLawyerId === l.id && c.status !== 'closed').length;
                const salary = l.salary || cfg.baseSalary || 6800;
                const level = l.level || 1;
                const boost = Math.min(25, Math.round((level - 1) * 3 * ((cfg.specialtyBonus && cfg.specialtyBonus.litigation) || 1.6)));
                return `
                <div class="legal-case-card">
                    <div style="display:flex;align-items:center;gap:12px;">
                        <div style="width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#9575cd,#7b1fa2);color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">⚖️</div>
                        <div style="flex:1;min-width:0;">
                            <div style="font-weight:800;font-size:14px;">${_esc(l.name || '律师')} <span class="badge badge-blue">Lv.${level}</span></div>
                            <div style="font-size:11px;color:#666;margin-top:3px;">
                                ${l.status === 'active' || !l.status ? '在职' : _esc(l.status)} · 月薪约 ${_money(salary)} · 胜率加成约 +${boost}%
                            </div>
                            <div style="font-size:11px;color:#888;margin-top:2px;">承办进行中 ${assigned} 件 · 自动起诉 / 出庭 / 申请执行</div>
                        </div>
                    </div>
                </div>`;
            }).join('')}
            <button class="btn btn-secondary btn-small" onclick="legalUI.goHireLawyer()">+ 继续招聘</button>
        `;
    }

    function _renderGuide(stats) {
        const fee = (typeof LEGAL_PROCESS_CONFIG !== 'undefined' && LEGAL_PROCESS_CONFIG.filingFee) || 50;
        const reasons = (typeof APPEAL_REASONS !== 'undefined' ? APPEAL_REASONS : []).slice(0, 6);
        return `
            <div class="legal-case-card" style="border-left-color:#5e35b1;">
                <div style="font-weight:800;margin-bottom:8px;">📖 法务维权怎么玩</div>
                <ol style="margin:0;padding-left:18px;font-size:12px;color:#444;line-height:1.8;">
                    <li>先招聘律师。律师会主动立案，不用你每单点上诉</li>
                    <li><b>已退款未退货</b>：买家收款却不寄回货物。法院按《民法典》第985条不当得利、《消保法》第25条认定，判令返还货款或货物</li>
                    <li><b>快递丢件拒赔</b>：承运人丢失快件后拒赔或限额过低。按《民法典》第832条、《快递暂行条例》第27条、《消保法》第26条，按实际损失赔，格式条款不能免责</li>
                    <li>受理费 ${_money(fee)} / 件从店铺资金扣。律师自动走诉讼；调解/和解方案也由律师决定是否接受</li>
                    <li>胜诉按档位回款，律师抽成 5% 随工资发；败诉在上述两类案件中不再重复赔货款，只承担诉讼费</li>
                </ol>
            </div>
            <div class="legal-case-card">
                <div style="font-weight:800;margin-bottom:8px;">📂 常见案由</div>
                ${reasons.map(r => `
                    <div style="display:flex;gap:8px;padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:12px;">
                        <span style="font-size:18px;">${r.icon || '📄'}</span>
                    <div>
                            <div style="font-weight:700;">${_esc(r.name)}</div>
                            <div style="color:#777;margin-top:2px;">${_esc(r.description || '')}</div>
                            <div style="color:#5e35b1;margin-top:2px;">基准胜率 ${Math.round((r.baseWinRate || 0) * 100)}%</div>
                        </div>
                    </div>`).join('')}
                    </div>
            <div class="legal-case-card" style="border-left-color:#e65100;">
                <div style="font-weight:800;margin-bottom:6px;">📊 当前经营法务摘要</div>
                <div style="font-size:12px;line-height:1.8;color:#555;">
                    案件 ${_esc(stats.total)} · 胜诉率 ${stats.winRate}% · 获赔 ${_money(stats.received)} · 赔付 ${_money(stats.paid)} · 受理费累计 ${_money(stats.fees)} · 净 ${_money(stats.net)}
                </div>
            </div>
        `;
    }

    function _buildInner() {
        const cases = _getCases();
        const stats = _stats(cases);
        const appealable = _appealable();
        const autoN = _autoTargets().length;
        const lawyers = _lawyers();
        const tabs = [
            { id: 'overview', name: '🏠 概览' },
            { id: 'cases', name: `📋 诉讼${cases.length ? '(' + cases.length + ')' : ''}` },
            { id: 'appeal', name: `🆕 上诉${(appealable.length + autoN) ? '(' + (appealable.length + autoN) + ')' : ''}` },
            { id: 'lawyers', name: `⚖️ 律师${lawyers.length ? '(' + lawyers.length + ')' : ''}` },
            { id: 'guide', name: '📖 指南' }
        ];
        let body = '';
        if (_tab === 'overview') body = _renderOverview(stats, cases, appealable, lawyers);
        else if (_tab === 'cases') body = _renderCases(cases);
        else if (_tab === 'appeal') body = _renderAppeal(appealable);
        else if (_tab === 'lawyers') body = _renderLawyers(lawyers, cases);
        else body = _renderGuide(stats);

        return `
            <div style="padding:12px 12px 4px;">
                <div class="tabs" style="margin-bottom:12px;flex-wrap:wrap;">
                    ${tabs.map(t => `
                        <div class="tab-item ${_tab === t.id ? 'active' : ''}" data-legal-tab="${t.id}"
                             onclick="legalUI.switchTab('${t.id}')">${t.name}</div>`).join('')}
                </div>
                <div id="legalTabContent" style="max-height:62vh;overflow-y:auto;-webkit-overflow-scrolling:touch;padding-bottom:8px;">
                    ${body}
                </div>
            </div>`;
    }

    function respondMediation(caseId, action) {
        try {
            const counterRatio = action === 'counter' ? 0.65 : undefined;
            const res = LegalEngine.respondMediation(caseId, action, counterRatio, gameState);
            _toast((res && res.message) || (res && res.success ? '已处理' : '操作失败'));
            _refreshHost();
            try { if (typeof gameState !== 'undefined') gameState.notify(); } catch (_) {}
        } catch (e) {
            _toast('调解操作失败');
            console.warn('[legalUI] respondMediation', e);
        }
    }

    function respondSettlement(caseId, action) {
        try {
            const res = LegalEngine.respondSettlement(caseId, action, gameState);
            _toast((res && res.message) || (res && res.success ? '已处理' : '操作失败'));
            _refreshHost();
            try { if (typeof gameState !== 'undefined') gameState.notify(); } catch (_) {}
        } catch (e) {
            _toast('和解操作失败');
            console.warn('[legalUI] respondSettlement', e);
        }
    }

    // ==================== 商标注册与品牌保护 ====================
    function _renderTrademarkSection() {
        try {
            const ip = (typeof LegalState !== 'undefined' && LegalState.getIPStatus) ? LegalState.getIPStatus() : null;
            if (!ip) return '';
            const cur = ip.current;
            const next = ip.next;
            const funds = (typeof gameState !== 'undefined' && gameState.state && gameState.state.shop) ? (gameState.state.shop.funds || 0) : 0;
            return `
                <div style="border:1px solid #eee;border-radius:12px;padding:12px;margin-bottom:14px;background:#fafafa;">
                    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                        <div>
                            <div style="font-weight:800;font-size:13px;color:#333;">🏷️ 商标品牌保护</div>
                            <div style="font-size:11px;color:#888;margin-top:2px;">
                                ${cur ? `当前：${cur.icon} ${cur.name}（信誉 +${cur.reputationBonus}）` : '尚未注册商标，品牌缺乏保护'}
                            </div>
                        </div>
                        ${next
                            ? `<button class="btn btn-primary btn-small" ${funds >= next.cost ? '' : 'disabled'} onclick="legalUI.registerTrademark('${next.id}')">注册「${next.name}」¥${next.cost.toLocaleString()}</button>`
                            : '<span style="font-size:11px;color:#2e7d32;">已是最顶级品牌</span>'}
                    </div>
                    ${next ? `<div style="font-size:11px;color:#999;margin-top:6px;">下一档：${next.icon} ${next.name} · ${next.desc}</div>` : ''}
                </div>`;
        } catch (e) { return ''; }
    }

    function registerTrademark(tierId) {
        try {
            const res = LegalState.registerTrademark(tierId);
            _toast((res && res.message) || (res && res.success ? '注册成功' : '操作失败'));
            _refreshHost();
            try { if (typeof gameState !== 'undefined') gameState.notify(); } catch (_) {}
        } catch (e) {
            _toast('商标注册失败');
            console.warn('[legalUI] registerTrademark', e);
        }
    }

    return {
        show,
        init() {},
        switchTab,
        openCaseDetail,
        backToCaseList,
        startAppealDraft,
        cancelAppealDraft,
        submitAppealFromUI,
        oneClickAppeal,
        oneClickAppealAll,
        respondMediation,
        respondSettlement,
        goHireLawyer,
        openAfterSales,
        _renderTrademarkSection,
        registerTrademark
    };
})();

if (typeof window !== 'undefined') {
    window.legalUI = legalUI;
    window.LegalUI = legalUI;
}
