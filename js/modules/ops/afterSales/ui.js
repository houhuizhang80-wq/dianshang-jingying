/**
 * 售后客服 — UI（中心弹窗 + 服务页）
 */
const AfterSalesUI = (function () {
    'use strict';

    let _gs = null;
    let _ui = null;
    let _openReturnId = null;
    let _openAppealId = null;
    let _appealFormCtx = null;
    let _centerTab = 'consultations';
    let _modalMode = false;

    function init(gameStateRef, uiManager) {
        _gs = gameStateRef
            || (typeof gameState !== 'undefined' ? gameState : null)
            || (typeof globalThis !== 'undefined' ? globalThis.gameState : null);
        _ui = uiManager
            || (typeof ui !== 'undefined' ? ui : null)
            || (typeof globalThis !== 'undefined' ? globalThis.ui : null);
        try {
            if (_gs && typeof csState !== 'undefined' && csState && typeof csState.init === 'function') {
                csState.init(_gs);
            }
        } catch (_) {}
    }

    function _ensureReady() {
        if (!_gs && typeof gameState !== 'undefined') _gs = gameState;
        if (!_ui && typeof ui !== 'undefined') _ui = ui;
        if (_gs && typeof csState !== 'undefined' && csState && typeof csState.init === 'function') {
            try { csState.init(_gs); } catch (_) {}
        }
    }

    function _money(n) {
        return typeof formatMoney === 'function' ? formatMoney(n) : ('¥' + (Number(n) || 0).toFixed(2));
    }
    function _time(t) {
        if (!t) return '-';
        return typeof formatDate === 'function' ? formatDate(t.day, t.hour) : `D${t.day} ${t.hour || 0}:00`;
    }

    function _safeStats(cs) {
        try {
            if (typeof csState !== 'undefined' && csState && typeof csState.getStatistics === 'function') {
                return csState.getStatistics();
            }
        } catch (e) {
            console.warn('[AfterSalesUI] getStatistics failed', e);
        }
        return {
            pendingConsultations: (cs.consultations || []).filter(c => c.status === 'pending').length,
            pendingReturns: (cs.returns || []).filter(r => r.status === 'pending').length,
            pendingDisputes: (cs.disputes || []).filter(d => d.status !== 'closed').length,
            pendingAppeals: (cs.appeals || []).filter(a => a.status === 'submitted').length,
            inspectionPassRate: 0,
            returnApproveRate: 0,
            totalConsultations: (cs.consultations || []).length,
            totalReturns: (cs.returns || []).length,
            totalDisputes: (cs.disputes || []).length,
            totalAppeals: (cs.appeals || []).length
        };
    }

    /** 九宫格入口：弹窗打开（与纳税/法务一致） */
    function show() {
        _ensureReady();
        if (!_ui || typeof _ui.showModal !== 'function') {
            // 兜底：走页面导航
            if (_ui && typeof _ui.navigateTo === 'function') _ui.navigateTo('service');
            return;
        }
        _modalMode = true;
        if (!_centerTab) _centerTab = 'consultations';
        const content = _renderCenterBody();
        const footer = `<button class="btn btn-secondary btn-block" onclick="ui.closeModal();">关闭</button>`;
        _ui.showModal('📞 售后客服中心', content, footer, {
            noBodyPadding: true,
            width: '860px',
            modalId: 'afterSalesCenterModal'
        });
    }

    function switchCenterTab(tab) {
        _centerTab = tab || 'consultations';
        let modal = null;
        try {
            if (_ui && typeof _ui._findModalOverlay === 'function') {
                modal = _ui._findModalOverlay('📞 售后客服中心', 'afterSalesCenterModal');
            }
        } catch (_) {}
        if (!modal) {
            modal = document.getElementById('afterSalesCenterModal')
                || document.querySelector('.modal-overlay:last-child');
        }
        const body = modal && modal.querySelector('.modal-body');
        if (body) {
            body.innerHTML = _renderCenterBody();
        } else {
            show();
        }
    }

    function _renderCenterBody() {
        _ensureReady();
        const state = (_gs && _gs.state) || (typeof gameState !== 'undefined' && gameState.state) || {};
        return renderServicePage(state, { modal: true, tab: _centerTab });
    }

    function renderServicePage(state, opts) {
        _ensureReady();
        const modal = !!(opts && opts.modal) || _modalMode;
        const tab = (opts && opts.tab)
            || (_ui && _ui.currentTab && _ui.currentTab.service)
            || _centerTab
            || 'consultations';
        const cs = (state && state.customerService) || {};
        const appeals = cs.appeals || [];
        const tabs = [
            { id: 'consultations', name: '💬 买家咨询', badge: (cs.consultations || []).filter(c => c.status === 'pending').length },
            { id: 'returns', name: '↩️ 退换货', badge: (cs.returns || []).filter(r => ['pending', 'approved', 'buyer_shipped', 'seller_received', 'cs_inspection', 'inspection_pass', 'refunding', 'exchanging'].includes(r.status)).length },
            { id: 'disputes', name: '⚖️ 纠纷处理', badge: (cs.disputes || []).filter(d => ['accepted', 'evidence', 'mediation', 'arbitration'].includes(d.status)).length },
            { id: 'appeals', name: '⚖️ 法律上诉', badge: appeals.filter(a => ['submitted', 'accepted', 'reviewing', 'hearing_scheduled'].includes(a.status)).length },
            { id: 'dashboard', name: '📊 服务看板', badge: 0 }
        ];
        const stats = _safeStats(cs);
        const tabClick = modal
            ? (id) => `csUI.switchCenterTab('${id}')`
            : (id) => `ui.switchTab('service','${id}')`;
        const inner = `
                <div class="card" style="margin-bottom:12px;padding:12px;">
                    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;text-align:center;">
                        <div><div style="font-size:20px;font-weight:bold;color:#ff6b35;">${stats.pendingConsultations || 0}</div><div style="font-size:11px;color:#999;">待回复</div></div>
                        <div><div style="font-size:20px;font-weight:bold;color:#2196f3;">${stats.pendingReturns || 0}</div><div style="font-size:11px;color:#999;">待处理退换货</div></div>
                        <div><div style="font-size:20px;font-weight:bold;color:#f44336;">${stats.pendingDisputes || 0}</div><div style="font-size:11px;color:#999;">纠纷中</div></div>
                        <div><div style="font-size:20px;font-weight:bold;color:#7b1fa2;">${stats.pendingAppeals || 0}</div><div style="font-size:11px;color:#999;">上诉中</div></div>
                        <div><div style="font-size:20px;font-weight:bold;color:#2e7d32;">${stats.inspectionPassRate || 0}%</div><div style="font-size:11px;color:#999;">质检通过率</div></div>
                    </div>
                </div>
                <div class="tabs" style="flex-wrap:wrap;">
                    ${tabs.map(t => `
                        <div class="tab-item ${tab === t.id ? 'active' : ''}" onclick="${tabClick(t.id)}">
                            ${t.name}${t.badge > 0 ? `<span class="badge badge-red" style="margin-left:4px;font-size:10px;">${t.badge}</span>` : ''}
                        </div>`).join('')}
                </div>
                <div style="padding:${modal ? '0 4px 8px' : '0'};max-height:${modal ? '55vh' : 'none'};overflow:auto;">
                    ${tab === 'consultations' ? _listConsultations(cs) : ''}
                    ${tab === 'returns' ? _listReturns(cs) : ''}
                    ${tab === 'disputes' ? _listDisputes(cs) : ''}
                    ${tab === 'appeals' ? _listAppeals(cs) : ''}
                    ${tab === 'dashboard' ? _dashboard(stats) : ''}
                </div>`;
        // 页面模式包一层 page；弹窗模式直接返回内容，避免 page-enter 剥离破坏 DOM
        if (modal) {
            return `<div style="padding:12px 10px 4px;">${inner}</div>`;
        }
        return `<div class="page">${inner}</div>`;
    }

    function _findConsultOrder(c) {
        if (!c || !_gs || !_gs.state) return null;
        const orders = _gs.state.orders || [];
        if (c.orderId) {
            const hit = orders.find(o => o && o.id === c.orderId);
            if (hit) return hit;
        }
        if (c.buyerName && c.productId) {
            for (let i = orders.length - 1; i >= 0; i--) {
                const o = orders[i];
                if (o && o.buyerName === c.buyerName && o.productId === c.productId) return o;
            }
        }
        return null;
    }

    function _staffReplyText(c) {
        const msgs = (c && c.messages) || [];
        for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i] && msgs[i].role === 'staff' && msgs[i].content) return String(msgs[i].content);
        }
        if (c && typeof c.reply === 'string' && c.reply) return c.reply;
        if (c && typeof c.reply === 'number' && QUICK_REPLIES[c.reply]) return QUICK_REPLIES[c.reply];
        return '';
    }

    function _orderStatusLabel(order) {
        if (!order) return '';
        try {
            if (typeof ORDER_STATUS !== 'undefined') {
                const s = ORDER_STATUS.find(x => x.code === order.status);
                if (s) return s.name;
            }
        } catch (_) {}
        return order.status || '';
    }

    function _consultOrderCard(c, opts) {
        const order = _findConsultOrder(c);
        const compact = !!(opts && opts.compact);
        if (!order && !c.orderId && !c.productName) return '';
        const productName = (order && order.productName) || c.productName || '商品';
        const buyer = (order && order.buyerName) || c.buyerName || '买家';
        const oid = (order && order.id) || c.orderId || '';
        const orderNo = (order && (order.orderNo || String(order.id).slice(-10))) || c.orderNo || (oid ? String(oid).slice(-10) : '售前咨询');
        const qty = order ? (order.quantity || 1) : 1;
        const amount = order
            ? (Number(order.actualAmount != null ? order.actualAmount : (order.totalAmount != null ? order.totalAmount : (order.price || 0) * qty)) || 0)
            : 0;
        const stName = order ? _orderStatusLabel(order) : '售前咨询';
        const openBtn = oid
            ? `<button class="btn btn-secondary btn-small" style="font-size:10px;padding:2px 8px;"
                    onclick="event.stopPropagation();ui.showOrderDetail('${oid}')">看订单</button>`
            : '';
        return `
            <div style="margin-top:${compact ? '6' : '8'}px;padding:8px 10px;background:#fff8f3;border:1px solid #ffd8bf;border-radius:8px;">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                    <div style="font-size:11px;font-weight:800;color:#d84315;">📦 关联订单 · ${escapeHtml(orderNo)}</div>
                    <div style="display:flex;align-items:center;gap:6px;">
                        <span style="font-size:10px;color:#ef6c00;font-weight:700;">${escapeHtml(stName)}</span>
                        ${openBtn}
                    </div>
                </div>
                <div style="font-size:12px;color:#333;margin-top:4px;font-weight:600;">${escapeHtml(productName)}${order ? ` ×${qty}` : ''}</div>
                <div style="font-size:11px;color:#888;margin-top:2px;">${escapeHtml(buyer)}${amount > 0 ? ' · ¥' + (typeof formatMoney === 'function' ? formatMoney(amount) : amount.toFixed(2)) : ''}</div>
            </div>`;
    }

    function _consultReplyBlock(c) {
        const reply = _staffReplyText(c);
        if (!reply) return '';
        const who = escapeHtml(c.staffName || '客服');
        return `
            <div style="margin-top:6px;padding:8px 10px;background:#e8f4ff;border:1px solid #91caff;border-radius:8px;">
                <div style="font-size:10px;color:#1677ff;font-weight:800;margin-bottom:3px;">↩️ 我们的回复 · ${who}</div>
                <div style="font-size:12px;color:#1a365d;line-height:1.5;">${escapeHtml(reply)}</div>
            </div>`;
    }

    function _listConsultations(cs) {
        const statusUI = {
            pending: { name: '待回复', color: '#e65100', bg: '#fff3e0' },
            replied: { name: '已回复', color: '#1565c0', bg: '#e3f2fd' },
            resolved: { name: '已解决', color: '#2e7d32', bg: '#e8f5e9' },
            missed: { name: '已错过', color: '#9e9e9e', bg: '#f5f5f5' },
            closed: { name: '已关闭', color: '#9e9e9e', bg: '#f5f5f5' }
        };
        const all = (cs.consultations || []).slice().sort((a, b) => {
            return ((b.createTime && b.createTime.day) || 0) - ((a.createTime && a.createTime.day) || 0)
                || ((b.createTime && b.createTime.hour) || 0) - ((a.createTime && a.createTime.hour) || 0);
        });
        const pending = all.filter(c => c.status === 'pending');
        const done = all.filter(c => c.status !== 'pending').slice(0, 30);
        if (!all.length) return `<div class="empty-state"><div class="icon">💬</div><div class="text">暂无咨询</div></div>`;

        const renderRow = (c, showDoneExtra) => {
            const st = statusUI[c.status] || { name: c.status, color: '#666', bg: '#f5f5f5' };
            const lastMsg = (c.messages && c.messages.length) ? c.messages[c.messages.length - 1] : null;
            const preview = lastMsg ? lastMsg.content : (c.question || '');
            return `
            <div class="list-item" onclick="csUI.openConsultation('${c.id}')" style="align-items:flex-start;flex-direction:column;gap:0;">
                <div style="display:flex;width:100%;align-items:flex-start;gap:8px;">
                    <div class="item-icon" style="font-size:22px;">👤</div>
                    <div class="item-content" style="flex:1;min-width:0;">
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                            <span style="font-weight:600;">${escapeHtml(c.buyerName || '买家')}${c.productName ? ' · ' + escapeHtml(c.productName) : ''}</span>
                            <span style="padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;color:${st.color};background:${st.bg};flex-shrink:0;">${st.name}</span>
                        </div>
                        <div style="font-size:12px;color:#666;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                            ${lastMsg && lastMsg.role === 'staff' ? '↩️ ' : ''}${escapeHtml(String(preview || '').slice(0, 48))}
                        </div>
                        <div style="font-size:11px;color:#999;margin-top:3px;">${_time(c.createTime)}${c.staffName ? ' · 客服 ' + escapeHtml(c.staffName) : ''}</div>
                        ${showDoneExtra ? _consultOrderCard(c, { compact: true }) : ''}
                        ${showDoneExtra ? _consultReplyBlock(c) : ''}
                    </div>
                    ${c.status === 'pending' ? '<span style="width:8px;height:8px;border-radius:50%;background:#f44336;flex-shrink:0;margin-top:10px;"></span>' : ''}
                </div>
            </div>`;
        };

        return `
            ${pending.length ? pending.map(c => renderRow(c, false)).join('') : '<div style="padding:10px 12px;font-size:12px;color:#999;">暂无待回复</div>'}
            <div style="padding:10px 4px 6px;margin-top:4px;font-size:12px;font-weight:800;color:#5d4037;border-top:1px dashed #e0e0e0;">
                📋 已咨询订单 · 我们的回复
            </div>
            ${done.length
                ? done.map(c => renderRow(c, true)).join('')
                : '<div style="padding:10px 12px;font-size:12px;color:#999;">回复后，关联订单和客服回复会出现在这里</div>'}`;
    }

    function _listReturns(cs) {
        const list = (cs.returns || []).slice().reverse().slice(0, 40);
        if (!list.length) return `<div class="empty-state"><div class="icon">↩️</div><div class="text">暂无退换货</div></div>`;
        return list.map(r => {
            const label = (RETURN_STATUS_LABEL && RETURN_STATUS_LABEL[r.status]) || { name: r.status, color: '#666' };
            return `
            <div class="list-item" onclick="csUI.openReturn('${r.id}')">
                <div style="display:flex;justify-content:space-between;">
                    <div style="font-weight:600;">${r.productName || '商品'} · ${_money(r.amount)}</div>
                    <span style="color:${label.color};font-size:12px;">${label.name}</span>
                </div>
                <div style="font-size:12px;color:#666;margin-top:4px;">${r.buyerName || ''} · ${(RETURN_TYPE_LABEL && RETURN_TYPE_LABEL[r.type] && RETURN_TYPE_LABEL[r.type].name) || r.type}</div>
            </div>`;
        }).join('');
    }

    function _listDisputes(cs) {
        const list = (cs.disputes || []).slice().reverse().slice(0, 40);
        if (!list.length) return `<div class="empty-state"><div class="icon">⚖️</div><div class="text">暂无纠纷</div></div>`;
        return list.map(d => `
            <div class="list-item" onclick="csUI.openDispute('${d.id}')">
                <div style="font-weight:600;">${d.typeIcon || '⚖️'} ${d.productName || ''} · ${_money(d.amount)}</div>
                <div style="font-size:12px;color:#666;margin-top:4px;">${d.reason || ''} · ${d.status}</div>
            </div>`).join('');
    }

    function _listAppeals(cs) {
        const list = (cs.appeals || []).slice().reverse().slice(0, 40);
        if (!list.length) return `<div class="empty-state"><div class="icon">⚖️</div><div class="text">暂无法律上诉</div></div>`;
        return list.map(a => `
            <div class="list-item" onclick="csUI.openAppeal('${a.id}')">
                <div style="font-weight:600;">${a.caseNo || a.id} · ${a.productName || ''}</div>
                <div style="font-size:12px;color:#666;margin-top:4px;">${a.groundName || ''} · ${_money(a.claimAmount)} · ${a.status}</div>
            </div>`).join('');
    }

    function _dashboard(stats) {
        return `<div class="card" style="padding:14px;font-size:13px;line-height:1.9;">
            <div>总咨询：${stats.totalConsultations || 0}</div>
            <div>总退换货：${stats.totalReturns || 0}</div>
            <div>总纠纷：${stats.totalDisputes || 0}</div>
            <div>总上诉：${stats.totalAppeals || 0}</div>
            <div>质检通过率：${stats.inspectionPassRate}%</div>
            <div>退换通过率：${stats.returnApproveRate}%</div>
        </div>`;
    }

    // ===== 真实客服式聊天：气泡对话 + 快捷回复 + 买家模拟回应 + 满意度 =====
    const QUICK_REPLIES = [
        '您好，在的，请问有什么可以帮您？',
        '下单后48小时内发货哦，请耐心等待～',
        '全场满99包邮，不满的话运费8元',
        '支持7天无理由退换货，请放心购买',
        '您的包裹正在运输中，我再帮您催一下快递',
        '可以领店铺优惠券后再下单，更划算哦'
    ];
    const CONSULTATION_STATUS_UI = {
        pending: { name: '待回复', color: '#e65100', bg: '#fff3e0' },
        replied: { name: '已回复', color: '#1565c0', bg: '#e3f2fd' },
        resolved: { name: '已解决', color: '#2e7d32', bg: '#e8f5e9' },
        missed: { name: '已错过', color: '#9e9e9e', bg: '#f5f5f5' },
        closed: { name: '已关闭', color: '#9e9e9e', bg: '#f5f5f5' }
    };

    function _chatModalOpen() {
        try {
            if (_ui && typeof _ui._findModalOverlay === 'function') {
                return !!_ui._findModalOverlay('💬 买家咨询', 'csChatModal');
            }
        } catch (_) {}
        return !!document.getElementById('csChatModal');
    }

    function openConsultation(id) {
        const c = (_gs.state.customerService.consultations || []).find(x => x.id === id);
        if (!c || !_ui) return;
        _openReturnId = id;
        const st = CONSULTATION_STATUS_UI[c.status] || { name: c.status, color: '#666', bg: '#f5f5f5' };
        let avgResp = '-';
        try {
            const s2 = csState.getStatistics();
            if (s2 && typeof s2.avgResponseTime === 'number') avgResp = s2.avgResponseTime.toFixed(1) + '小时';
        } catch (_) {}
        const msgs = (c.messages || []).map(m => {
            const isBuyer = m.role === 'buyer';
            const bubble = `
                <div style="display:flex;justify-content:${isBuyer ? 'flex-start' : 'flex-end'};margin:8px 0;">
                    <div style="max-width:78%;padding:8px 12px;border-radius:${isBuyer ? '2px 12px 12px 12px' : '12px 2px 12px 12px'};
                                background:${isBuyer ? '#f1f3f5' : '#1677ff'};color:${isBuyer ? '#333' : '#fff'};
                                font-size:13px;line-height:1.55;word-break:break-word;">
                        <div style="font-size:10px;opacity:0.65;margin-bottom:2px;">${escapeHtml(m.name || (isBuyer ? '买家' : '客服'))}${m.isAuto ? ' · 自动回复' : ''}</div>
                        ${escapeHtml(m.content || '')}
                        <div style="font-size:10px;opacity:0.55;margin-top:3px;">${_time(m.time)}</div>
                    </div>
                </div>`;
            return bubble;
        }).join('');
        const body = `
            <div style="font-size:13px;">
                <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:#fff7e6;border:1px solid #ffd591;border-radius:10px;margin-bottom:10px;">
                    <div style="min-width:0;">
                        <b>${escapeHtml(c.buyerName || '买家')}</b>${c.productName ? ' · ' + escapeHtml(c.productName) : ''}
                        <div style="font-size:11px;color:#999;margin-top:2px;">${_time(c.createTime)} · <span style="color:${st.color};font-weight:700;">${st.name}</span></div>
                    </div>
                    <div style="text-align:right;font-size:11px;color:#999;flex-shrink:0;margin-left:8px;">
                        <div>平均响应</div><div style="font-weight:700;color:#1565c0;">${avgResp}</div>
                    </div>
                </div>
                <div style="background:#fafafa;border-radius:12px;padding:8px 12px;max-height:280px;overflow-y:auto;margin-bottom:10px;">
                    ${msgs || '<div style="color:#999;padding:20px;text-align:center;">暂无消息</div>'}
                </div>
                ${_consultOrderCard(c)}
                ${_consultReplyBlock(c)}
                <div style="font-size:11px;color:#888;margin:10px 0 6px;">⚡ 快捷回复（点击直接发送）：</div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">
                    ${QUICK_REPLIES.map(r => `<button class="btn btn-secondary btn-small" style="font-size:11px;padding:4px 8px;" onclick="csUI.quickReply('${r}')">${escapeHtml(r)}</button>`).join('')}
                </div>
                <div style="display:flex;gap:8px;">
                    <input id="csReplyInput" style="flex:1;padding:8px 10px;border:1px solid #ddd;border-radius:8px;font-size:13px;"
                           placeholder="输入回复内容，按回车发送" onkeydown="if(event.key==='Enter')csUI.sendReply()"/>
                    <button class="btn btn-primary" onclick="csUI.sendReply()">发送</button>
                    ${c.status !== 'resolved' && c.status !== 'closed' ? `<button class="btn btn-success" onclick="csUI.markResolved()">已解决</button>` : ''}
                </div>
            </div>`;
        _ui.showModal('💬 买家咨询', body, `<button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>`, { width: '600px', modalId: 'csChatModal' });
    }

    function quickReply(text) {
        if (!_openReturnId) return;
        csState.replyConsultation(_openReturnId, text);
        openConsultation(_openReturnId);
        _scheduleBuyerFollowUp();
    }

    function sendReply() {
        const input = document.getElementById('csReplyInput');
        if (!input || !_openReturnId) return;
        const content = (input.value || '').trim() || '您好，已收到您的问题，我们尽快处理。';
        csState.replyConsultation(_openReturnId, content);
        openConsultation(_openReturnId);
        _scheduleBuyerFollowUp();
    }

    // 像真实客服对话：买家过一会儿回应（满意/追问），重新渲染聊天
    function _scheduleBuyerFollowUp() {
        const cid = _openReturnId;
        setTimeout(() => {
            if (!_chatModalOpen() || !cid) return;
            try { csState.buyerSimulateFollowUp(cid); } catch (_) {}
            try { openConsultation(cid); } catch (_) {}
            try { if (_ui && typeof _ui.forceRender === 'function') _ui.forceRender(); } catch (_) {}
        }, 900);
    }

    function markResolved() {
        if (!_openReturnId) return;
        csState.resolveConsultation(_openReturnId);
        _ui.showModal('💬 买家满意度', `
            <div style="text-align:center;padding:12px 4px;">
                <div style="font-size:42px;margin-bottom:8px;">😊</div>
                <div style="font-size:13px;color:#666;margin-bottom:16px;line-height:1.6;">买家已确认问题解决，<br>请选择本次服务满意度</div>
                <div style="display:flex;gap:10px;justify-content:center;">
                    <button class="btn btn-success" onclick="csUI.rateSatisfaction('good')">👍 满意</button>
                    <button class="btn btn-secondary" onclick="csUI.rateSatisfaction('neutral')">😐 一般</button>
                    <button class="btn btn-danger" onclick="csUI.rateSatisfaction('bad')">👎 不满意</button>
                </div>
            </div>`, `<button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>`, { width: '420px', modalId: 'csSatisfactionModal' });
    }

    function rateSatisfaction(rating) {
        const cid = _openReturnId;
        if (!cid) return;
        csState.addConsultationSatisfaction(cid, rating);
        try { _ui.closeModal(); } catch (_) {}   // 满意度弹窗
        try { _ui.closeModal(); } catch (_) {}   // 聊天弹窗
        if (_ui && typeof _ui.showToast === 'function') {
            _ui.showToast(rating === 'good' ? '👍 买家满意，服务评分提升' : (rating === 'bad' ? '👎 买家不满意，信誉 -1' : '服务已记录'));
        }
        try { if (_ui && typeof _ui.forceRender === 'function') _ui.forceRender(); } catch (_) {}
        switchCenterTab('consultations');
    }

    function openReturn(id) {
        const r = (_gs.state.customerService.returns || []).find(x => x.id === id);
        if (!r || !_ui) return;
        _openReturnId = id;
        const label = (RETURN_STATUS_LABEL && RETURN_STATUS_LABEL[r.status]) || { name: r.status };
        let actions = '';
        if (r.status === 'pending') {
            actions = `<button class="btn btn-success" onclick="csUI.auditReturn(true)">同意</button>
                       <button class="btn btn-danger" onclick="csUI.auditReturn(false)">拒绝</button>`;
        } else if (r.status === 'buyer_shipped') {
            actions = `<button class="btn btn-primary" onclick="csUI.confirmReceiveReturn()">确认收货</button>`;
        } else if (r.status === 'cs_inspection') {
            actions = `<button class="btn btn-primary" onclick="csUI.forceCompleteInspection()">完成质检</button>`;
        } else if (r.status === 'inspection_pass') {
            actions = `<button class="btn btn-success" onclick="csUI.executeRefundNow()">执行退款</button>`;
        } else if (r.status === 'inspection_fail' || (r.status === 'rejected' && r.type === 'refund_only')) {
            actions = `<button class="btn btn-warning" onclick="csUI.openAppealForm('return','${r.id}')">模拟上诉</button>`;
        }
        const timeline = (r.timeline || []).map(t =>
            `<div style="margin:6px 0;"><b>${t.label}</b> <span style="color:#999;font-size:11px;">${_time(t.time)}</span><div style="font-size:12px;color:#666;">${t.note || ''}</div></div>`
        ).join('');
        _ui.showModal('↩️ 退换货详情', `
            <div style="font-size:13px;">
                <div style="font-weight:700;margin-bottom:6px;">${r.productName} · ${_money(r.amount)}</div>
                <div style="color:#666;margin-bottom:8px;">状态：${label.name} · ${r.buyerName || ''}</div>
                <div style="background:#fafafa;padding:10px;border-radius:8px;margin-bottom:10px;">退回地址：${r.returnAddress || '-'}</div>
                ${r.inspection ? `<div style="margin-bottom:8px;">质检：${r.inspection.gradeName || '-'} / 比例 ${((r.refundRatio || 0) * 100).toFixed(0)}%</div>` : ''}
                <div style="margin-bottom:10px;">${timeline}</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">${actions}</div>
            </div>`, `<button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>`, { width: '620px' });
    }

    function auditReturn(approved) {
        if (!_openReturnId) return;
        csState.auditReturn(_openReturnId, !!approved, approved ? '同意申请' : '不符合条件');
        if (_ui && _ui.forceRender) _ui.forceRender();
        if (_ui) _ui.closeModal();
    }
    function confirmReceiveReturn() {
        if (!_openReturnId) return;
        csState.sellerReceiveReturn(_openReturnId);
        if (_ui && _ui.forceRender) _ui.forceRender();
        if (_ui) _ui.closeModal();
    }
    function forceCompleteInspection() {
        if (!_openReturnId) return;
        csState.completeCsInspection(_openReturnId);
        if (_ui && _ui.forceRender) _ui.forceRender();
        if (_ui) _ui.closeModal();
    }
    function executeRefundNow() {
        if (!_openReturnId) return;
        csState.executeRefundAfterInspection(_openReturnId);
        if (_ui && _ui.forceRender) _ui.forceRender();
        if (_ui) _ui.closeModal();
    }

    function openDispute(id) {
        const d = (_gs.state.customerService.disputes || []).find(x => x.id === id);
        if (!d || !_ui) return;
        _ui.showModal('⚖️ 纠纷详情', `
            <div style="font-size:13px;">
                <div style="font-weight:700;">${d.productName} · ${_money(d.amount)}</div>
                <div style="color:#666;margin:6px 0;">${d.reason || ''} · ${d.status}</div>
                <div style="display:flex;gap:8px;">
                    <button class="btn btn-primary" onclick="csState.addSellerEvidence('${d.id}','商家举证材料');ui.closeModal();ui.forceRender&&ui.forceRender();">提交证据</button>
                    <button class="btn btn-warning" onclick="csState.startArbitration('${d.id}');setTimeout(()=>csState.executeArbitration('${d.id}'),200);ui.closeModal();">进入仲裁</button>
                </div>
            </div>`, `<button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>`, { width: '560px' });
    }

    function openAppeal(id) {
        const a = (_gs.state.customerService.appeals || []).find(x => x.id === id);
        if (!a || !_ui) return;
        _openAppealId = id;
        let actions = '';
        if (a.status === 'submitted') actions = `<button class="btn btn-primary" onclick="csUI.acceptAppeal()">受理</button>`;
        else if (a.status === 'accepted') actions = `<button class="btn btn-warning" onclick="csUI.reviewAppeal()">审核</button>`;
        else if (a.status === 'reviewing') actions = `<button class="btn btn-warning" onclick="csUI.scheduleAppeal()">排期</button>`;
        else if (a.status === 'hearing_scheduled') actions = `<button class="btn btn-danger" onclick="csUI.ruleAppeal()">宣判</button>`;
        else if (a.status === 'ruled_buyer') actions = `<button class="btn btn-success" onclick="csUI.executeCompensation()">执行赔偿</button>`;
        _ui.showModal('⚖️ 上诉详情', `
            <div style="font-size:13px;">
                <div style="font-weight:700;">${a.caseNo} · ${a.productName}</div>
                <div style="color:#666;margin:6px 0;">${a.groundName || ''} · ${_money(a.claimAmount)} · ${a.status}</div>
                <div style="margin:8px 0;">${a.ruleNote || a.reason || ''}</div>
                <div style="display:flex;gap:8px;">${actions}</div>
            </div>`, `<button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>`, { width: '620px' });
    }

    function acceptAppeal() { if (_openAppealId) { csState.acceptAppeal(_openAppealId); openAppeal(_openAppealId); } }
    function reviewAppeal() { if (_openAppealId) { csState.reviewAppeal(_openAppealId); openAppeal(_openAppealId); } }
    function scheduleAppeal() { if (_openAppealId) { csState.scheduleAppealHearing(_openAppealId); openAppeal(_openAppealId); } }
    function ruleAppeal() { if (_openAppealId) { csState.ruleAppeal(_openAppealId); openAppeal(_openAppealId); } }
    function executeCompensation() { if (_openAppealId) { csState.executeAppealCompensation(_openAppealId); openAppeal(_openAppealId); } }

    function openAppealForm(kind, id) {
        _appealFormCtx = { kind, id };
        if (!_ui) return;
        let sourceAmt = 100;
        try {
            const cs = (_gs && _gs.state && _gs.state.customerService) || {};
            const src = kind === 'return'
                ? ((cs.returns || []).find(x => x.id === id))
                : ((cs.disputes || []).find(x => x.id === id));
            if (src) sourceAmt = parseFloat(src.amount) || 100;
        } catch (_) {}
        const softCap = Math.min(1000000, Math.max(sourceAmt * 3, 100));
        _ui.showModal('📝 提交法律上诉', `
            <div style="font-size:13px;display:flex;flex-direction:column;gap:8px;">
                <textarea id="appealReason" rows="3" style="width:100%;padding:8px;" placeholder="上诉理由">商家处理不公，要求依法维权</textarea>
                <input id="appealAmount" type="number" min="0" max="${softCap}" style="padding:8px;" placeholder="诉求金额" value="${Math.round(sourceAmt)}"/>
                <div style="font-size:11px;color:#888;">上限：关联单金额×3（本单最高 ¥${softCap.toFixed(0)}），防止虚高索赔</div>
                <button class="btn btn-primary" onclick="csUI.submitAppeal()">提交上诉</button>
            </div>`, `<button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>`, { width: '520px' });
    }
    function addAppealEvidenceRow() { /* slim UI: no-op */ }
    function submitAppeal() {
        if (!_appealFormCtx) return;
        const reason = (document.getElementById('appealReason') || {}).value || '要求依法退款';
        const amount = parseFloat((document.getElementById('appealAmount') || {}).value || '0') || 0;
        const form = {
            groundId: 'consumer', reason,
            evidences: [{ type: 'text', content: '相关证据材料' }],
            claimIds: ['refund'], claimAmount: amount, demandStatement: '要求退款并赔偿'
        };
        if (_appealFormCtx.kind === 'return') form.returnId = _appealFormCtx.id;
        else form.disputeId = _appealFormCtx.id;
        const res = csState.createAppeal(form);
        if (_ui) {
            _ui.showToast(res.ok ? '上诉已提交' : (res.reason || '提交失败'));
            _ui.closeModal();
            if (_ui.forceRender) _ui.forceRender();
        }
    }

    function closeModal() {
        const overlay = document.getElementById('modalOverlay');
        if (overlay) overlay.remove();
        _openReturnId = null;
        _openAppealId = null;
        _appealFormCtx = null;
    }
    function testTrigger(type) {
        const msg = csEngine.triggerTestEvent(type);
        if (_ui && _ui.showToast) _ui.showToast(msg);
        else alert(msg);
        if (_ui && _ui.forceRender) _ui.forceRender();
    }
    function submitEvidence() {}
    function goArbitration() {}
    function switchQuickCategory() {}
    function useQuickReply() {}

    return {
        init, show, switchCenterTab, renderServicePage,
        openConsultation, sendReply, quickReply, markResolved, rateSatisfaction, switchQuickCategory, useQuickReply,
        openReturn, auditReturn, confirmReceiveReturn, forceCompleteInspection, executeRefundNow,
        openDispute, submitEvidence, goArbitration,
        openAppeal, acceptAppeal, reviewAppeal, scheduleAppeal, ruleAppeal, executeCompensation,
        openAppealForm, addAppealEvidenceRow, submitAppeal,
        closeModal, testTrigger
    };
})();

const csUI = AfterSalesUI;
if (typeof window !== 'undefined') {
    window.AfterSalesUI = AfterSalesUI;
    window.csUI = AfterSalesUI;
}
