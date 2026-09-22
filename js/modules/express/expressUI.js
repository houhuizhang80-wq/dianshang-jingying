/**
 * expressUI.js - 快递合作系统UI层（极简版）
 * =================================
 * 简化策略：
 *  - 4Tab → 2Tab：合作快递 / 物流记录
 *  - 移除社交好感度Tab（自动涨好感，发货就涨）
 *  - 移除对账结算Tab（自动月结，在合作快递卡片右上角显示"待付"徽标）
 *  - 合作详情隐藏：只显示核心信息（折扣/丢件率/合作等级）
 *  - 发货选择弹窗：仅显示「经济型」「标准型」两档（自动选对应档里最便宜的合作快递），一键确认
 */

class ExpressUI {
    constructor() {
        this._currentTab = 'partners';       // partners(合作快递) | track(物流记录)
        this._modalVisible = false;
        this._modalEl = null;
        this._initialized = false;
        this._pendingOrder = null;           // 当前待发货订单
        this._selectedTier = 'standard';     // 发货选择时的档位：economy | standard
        this._currentQuotes = null;
    }

    init() {
        if (this._initialized) return;
        this._bindEvents();
        this._initialized = true;
        console.log('[ExpressUI] 快递合作UI模块初始化完成（极简版）');
    }

    _cityLabel(id) {
        if (!id) return '';
        try {
            if (typeof getCityById === 'function') {
                const c = getCityById(id);
                if (c && c.name && c.id === id) return c.name;
            }
            if (typeof getCityInfo === 'function') {
                const c2 = getCityInfo(id);
                if (c2 && c2.name) return c2.name;
            }
        } catch (_) {}
        return id;
    }

    // 辅助：格式化 BASE_PRICING[companyId] 里的"首重/续重/首重kg"，返回HTML展示片段
    _formatCompanyPricingInfo(companyId, opts = {}) {
        const pricing = BASE_PRICING && BASE_PRICING[companyId];
        if (!pricing) return '';
        const preferred = ['standard', 'express', 'next_day', 'same_day', 'freight'];
        const labelMap = { standard: '标准', express: '特快', next_day: '次日达', same_day: '当日达', freight: '大件' };
        const colorMap = { standard: '#1e88e5', express: '#e53935', next_day: '#7b1fa2', same_day: '#f57c00', freight: '#6a1b9a' };
        const services = [];
        preferred.forEach(sid => {
            const p = pricing[sid];
            if (!p) return;
            const firstKg = p.firstWeightKg || 1;
            services.push({
                sid,
                label: labelMap[sid] || sid,
                color: colorMap[sid] || '#666',
                firstWeight: p.firstWeight,
                addWeight: p.addWeight,
                firstKg
            });
        });
        if (!services.length) return '';
        const standard = services.find(s => s.sid === 'standard') || services[0];
        const others = services.filter(s => s.sid !== standard.sid);
        const landM = (typeof SHIPPING_METHODS !== 'undefined' && SHIPPING_METHODS.land)
            ? SHIPPING_METHODS.land.feeMultiplier : 0.88;
        const airM = (typeof SHIPPING_METHODS !== 'undefined' && SHIPPING_METHODS.air)
            ? SHIPPING_METHODS.air.feeMultiplier : 2.15;
        const allowsAir = typeof companyAllowsAir === 'function' && companyAllowsAir(companyId);
        const landFirst = (standard.firstWeight * landM).toFixed(1);
        const airFirst = (standard.firstWeight * airM).toFixed(1);
        const modeLine = allowsAir
            ? `<div style="font-size:10px;margin-top:2px;line-height:1.4;"><span style="color:#6d4c41;">🚚 陆运首重约¥${landFirst}</span> · <span style="color:#1565c0;">✈️ 空运首重约¥${airFirst}</span><span style="color:#999;">（顺丰/京东/EMS 可选空运）</span></div>`
            : `<div style="font-size:10px;color:#6d4c41;margin-top:2px;">🚚 普通快递仅陆运 · 首重约¥${landFirst}</div>`;
        const mainLine = `<span style="color:${standard.color};font-weight:600;">📏 ${standard.label}：首${standard.firstKg}kg ¥${standard.firstWeight} + 续重 ¥${standard.addWeight}/kg</span>`;
        let otherLine = '';
        if (others.length) {
            const str = others.map(o =>
                `<span style="color:${o.color};font-weight:500;">${o.label}:首${o.firstKg}kg¥${o.firstWeight}+¥${o.addWeight}/kg</span>`
            ).join(' <span style="color:#ddd;">·</span> ');
            otherLine = `<div style="font-size:10px;color:#888;margin-top:2px;line-height:1.4;">${str}</div>`;
        }
        return mainLine + modeLine + otherLine;
    }

    _bindEvents() {
        eventBus.on('express:stateChanged', () => {
            if (this._modalVisible) this._updateModalContent();
        });
    }

    _showToast(msg, type = 'info') {
        if (typeof ui !== 'undefined' && ui.showToast) {
            ui.showToast(msg, type);
            return;
        }
        if (typeof eventBus !== 'undefined') eventBus.emit('toast:show', { message: msg, type });
        else (typeof alert !== 'undefined') && alert(msg);
    }

    // ========== 弹窗控制 ==========
    openCenter(tab = 'partners') {
        this.init();
        // 兼容旧Tab名
        const m = { logistics:'track', partner:'partners', bill:'partners', tracking:'track', partner_list:'partners' };
        this.showModal(m[tab] || tab);
    }
    showCenter(tab) { this.openCenter(tab); }

    showModal(tab = 'partners') {
        this.init();
        this._currentTab = (tab === 'track' || tab === 'bills' || tab === 'friends') ? tab : 'partners';
        // 账单和社交都合并到合作快递Tab了
        if (this._currentTab === 'bills' || this._currentTab === 'friends') this._currentTab = 'partners';
        this._modalVisible = true;
        this._renderFullModal();
    }

    hideModal() {
        this._modalVisible = false;
        if (this._modalEl) { this._modalEl.remove(); this._modalEl = null; }
    }

    _renderFullModal() {
        if (this._modalEl) this._modalEl.remove();
        const state = gameState.state;
        const activeCount = ExpressState.getUnlockedPartners().length;
        const unpaidBills = ExpressState.getUnpaidBills();
        const pendingAmount = unpaidBills.reduce((s, b) => s + (Number(b.payableAmount) || 0), 0)
            || (ExpressState.pendingSettlement || 0);

        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = 'expressModal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:480px;max-height:85vh;display:flex;flex-direction:column;">
                <div class="modal-header" style="background:linear-gradient(135deg,#1e88e5,#0d47a1);color:white;display:flex;justify-content:space-between;align-items:center;">
                    <h3 style="margin:0;font-size:16px;display:flex;align-items:center;gap:6px;">🚚 快递合作</h3>
                    <div style="display:flex;gap:8px;align-items:center;font-size:12px;">
                        <span>合作 ${activeCount} 家</span>
                        ${unpaidBills.length ? `<span style="background:#f44336;padding:2px 8px;border-radius:10px;cursor:pointer;" onclick="expressUI.payAllBills()">待付 ¥${pendingAmount.toFixed(0)}</span>` : ''}
                        <button onclick="expressUI.hideModal()" style="background:none;border:none;color:white;font-size:20px;cursor:pointer;padding:0;width:24px;height:24px;display:flex;align-items:center;justify-content:center;">×</button>
                    </div>
                </div>
                <div class="modal-tabs" style="display:flex;border-bottom:1px solid #eee;flex-shrink:0;overflow-x:auto;">
                    ${this._renderTabs()}
                </div>
                <div id="expressModalBody" class="modal-body" style="flex:1;overflow-y:auto;padding:0;">
                    ${this._renderTabContent()}
                </div>
            </div>`;
        document.body.appendChild(modal);
        this._modalEl = modal;
        modal.addEventListener('click', (e) => { if (e.target === modal) this.hideModal(); });
    }

    _renderTabs() {
        const tabs = [
            { id: 'partners', name: '合作快递', icon: '🤝' },
            { id: 'track',    name: '物流记录', icon: '📍' }
        ];
        return tabs.map(t => `
            <button class="modal-tab" onclick="expressUI.switchTab('${t.id}')"
                style="flex:1;min-width:70px;padding:10px 4px;border:none;background:none;cursor:pointer;font-size:13px;color:${this._currentTab===t.id?'#1e88e5':'#666'};border-bottom:2px solid ${this._currentTab===t.id?'#1e88e5':'transparent'};white-space:nowrap;">
                ${t.icon} ${t.name}
            </button>`).join('');
    }

    switchTab(tab) {
        this._currentTab = tab;
        this._updateModalContent();
    }

    _updateModalContent() {
        const tabs = this._modalEl?.querySelector('.modal-tabs');
        const body = this._modalEl?.querySelector('#expressModalBody');
        if (tabs) tabs.innerHTML = this._renderTabs();
        if (body) body.innerHTML = this._renderTabContent();
    }

    _renderTabContent() {
        return this._currentTab === 'track' ? this._renderTrackTab() : this._renderPartnersTab();
    }

    // ========== Tab1：合作快递（超极简：已合作大字展示，未合作折叠隐藏） ==========
    _renderPartnersTab() {
        const reputation = gameState.state.shop.reputation || 0;
        const totalVol = Object.values(ExpressState.partners).reduce((s,p) => s + (p.totalShipments||0), 0);
        const unpaidBills = ExpressState.getUnpaidBills();
        const pendingAmount = unpaidBills.reduce((s, b) => s + (Number(b.payableAmount) || 0), 0)
            || (ExpressState.pendingSettlement || 0);

        // 拆分：已合作 / 可解锁 / 未达条件
        const unlockedList = [], canUnlockList = [], lockedList = [];
        EXPRESS_COMPANIES.forEach(c => {
            const p = ExpressState.getPartner(c.id);
            if (p?.unlocked) unlockedList.push(c);
            else if (reputation >= c.reputationReq && totalVol >= c.minMonthlyVolume) canUnlockList.push(c);
            else lockedList.push(c);
        });
        const showMore = (typeof this._showMoreLocked !== 'undefined') ? this._showMoreLocked : false;

        // 顶部汇总：累计成功订单全局折扣信息
        const successInfo = (typeof gameEngine !== 'undefined' && typeof gameEngine.getExpressSuccessOrderDiscount === 'function')
            ? gameEngine.getExpressSuccessOrderDiscount()
            : null;
        const successBadge = successInfo
            ? `<div style="margin-top:6px;padding:6px 10px;background:linear-gradient(135deg,#e3f2fd,#bbdefb);border-radius:8px;border:1px solid #90caf9;font-size:11px;color:#1565c0;font-weight:600;line-height:1.55;">
                 🎯 全局快递折扣：累计运单 <b>${(successInfo.completedCount || 0).toLocaleString()}</b>
                 · 店铺 Lv.${successInfo.shopLevel || 1}
                 · ${successInfo.brandName || '普通'}
                 → 当前 <b style="color:#d32f2f;">${successInfo.label}</b>
                 ${successInfo.nextTier
                     ? `<div style="color:#666;font-weight:400;margin-top:2px;">下一档 <b style="color:#388e3c;">${successInfo.nextTier.label}</b>：${successInfo.nextTier.needText || ('再发 ' + successInfo.nextTier.ordersNeeded + ' 单')}</div>`
                     : `<div style="color:#388e3c;font-weight:400;margin-top:2px;">已达最低 4 折封顶</div>`}
                 ${successInfo.fourFold && !successInfo.fourFold.unlocked
                     ? `<div style="color:#666;font-weight:400;">到 4 折需：${successInfo.fourFold.needText}</div>`
                     : ''}
               </div>`
            : '';

        let html = `
            <div style="padding:10px 15px;background:#f8f9fa;border-bottom:1px solid #eee;font-size:12px;color:#666;display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;align-items:center;">
                <div style="min-width:0;">
                    <div>合作 <b style="color:#1e88e5;">${unlockedList.length}</b> 家 · 累计 <b style="color:#1e88e5;">${totalVol}</b> 单</div>
                    ${successBadge}
                </div>
                ${unpaidBills.length
                    ? `<span onclick="expressUI.payAllBills()" style="color:#fff;background:#f44336;padding:3px 10px;border-radius:10px;cursor:pointer;font-weight:600;flex-shrink:0;">待付 ¥${pendingAmount.toFixed(0)} · 一键结算</span>`
                    : `<span style="color:#4caf50;font-weight:600;flex-shrink:0;">✓ 账单已清</span>`}
            </div>`;

        // ===== 运费险（深化）：开关提升转化率 =====
        const freightIns = (typeof gameState !== 'undefined' && gameState.getFreightInsurance) ? gameState.getFreightInsurance() : false;
        html += `
            <div style="padding:10px 15px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;gap:8px;">
                <div style="min-width:0;">
                    <div style="font-size:13px;font-weight:700;color:#333;">🛡️ 运费险</div>
                    <div style="font-size:11px;color:#888;margin-top:2px;">${freightIns ? '已开启：转化率 +5%，买家更放心下单' : '未开启：开启后转化率 +5%'}</div>
                </div>
                <button class="btn ${freightIns ? 'btn-secondary' : 'btn-primary'} btn-sm" onclick="expressUI.toggleFreightInsurance()" style="flex-shrink:0;">
                    ${freightIns ? '关闭' : '开启'}
                </button>
            </div>`;

        // ===== ① 已合作快递（大卡片：只显示 折扣+默认标记+结算按钮）=====
        if (unlockedList.length) {
            html += `<div style="padding:8px 15px 4px;font-size:11px;color:#888;font-weight:600;">✅ 已合作快递</div>`;
            unlockedList.forEach(company => {
                const partner = ExpressState.getPartner(company.id);
                const isDefault = ExpressState.defaultCompany === company.id;
                const lvl = getCooperationLevel(partner);
                const discount = Math.round(lvl.priceDiscount * 100);
                const companyBills = unpaidBills.filter(b => b.companyId === company.id);
                const billAmount = companyBills.reduce((s,b) => s + b.payableAmount, 0);
                const defaultCycle = (typeof DEFAULT_SETTLEMENT_CYCLE !== 'undefined') ? DEFAULT_SETTLEMENT_CYCLE : 'weekly';
                // 日结已移除：旧存档 daily 视为周结
                let cycleId = partner.settlementCycle || defaultCycle;
                if (cycleId === 'daily') cycleId = 'weekly';
                const cycleMeta = (typeof SETTLEMENT_CYCLES !== 'undefined' ? SETTLEMENT_CYCLES : [])
                    .find(c => c.id === cycleId);
                const cycleName = cycleMeta ? cycleMeta.name : '周结';
                // 可选结算：周结 / 现结 / 月结（已去掉日结；按合作等级解锁）
                const cycleOptions = (typeof SETTLEMENT_CYCLES !== 'undefined' ? SETTLEMENT_CYCLES : [])
                    .filter(c => c.id === 'monthly' || c.id === 'per_order')
                    .map(c => {
                        const locked = lvl.level < c.minLevel;
                        return `<option value="${c.id}" ${c.id === cycleId ? 'selected' : ''} ${locked ? 'disabled' : ''}>${c.name}${locked ? '（需合作Lv' + c.minLevel + '）' : ''}</option>`;
                    }).join('');

                html += `
                <div style="padding:10px 16px;border-bottom:1px solid #f0f0f0;${isDefault?'background:linear-gradient(90deg,rgba(76,175,80,0.1),transparent);':''};">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <div style="width:40px;height:40px;border-radius:10px;background:${company.bgColor};display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">
                            ${company.icon}
                        </div>
                        <div style="flex:1;min-width:0;">
                            <div style="display:flex;align-items:center;gap:6px;">
                                <span style="font-size:14px;font-weight:700;color:#333;">${company.name}</span>
                                ${isDefault ? `<span style="font-size:9px;background:#4caf50;color:#fff;padding:1px 5px;border-radius:6px;font-weight:600;">默认</span>` : ''}
                                <span style="font-size:9px;background:#e3f2fd;color:#1565c0;padding:1px 5px;border-radius:6px;">${cycleName}</span>
                            </div>
                            <div style="font-size:11px;color:#666;margin-top:2px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                                <span style="color:#1e88e5;font-weight:600;">💰 ${discount}折</span>
                                <span>📦 ${partner.totalShipments||0}单</span>
                            </div>
                            <div style="margin-top:4px;min-width:0;">${this._formatCompanyPricingInfo(company.id)}</div>
                            <div style="margin-top:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                                <span style="font-size:10px;color:#888;">结算方式</span>
                                <select onchange="expressUI.changeSettlementCycle('${company.id}', this.value)"
                                    style="flex:1;min-width:140px;max-width:220px;padding:4px 6px;border:1px solid #ddd;border-radius:6px;font-size:11px;background:#fff;">
                                    ${cycleOptions}
                                </select>
                            </div>
                            <div style="margin-top:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                                <span style="font-size:10px;color:#888;">运输方式</span>
                                ${(() => {
                                    const allowed = (typeof getCompanyAllowedModes === 'function') ? getCompanyAllowedModes(company.id) : ['land'];
                                    const curMode = ExpressState.getPartnerTransportMode(company.id);
                                    if (allowed.indexOf('air') < 0) {
                                        return `<span style="font-size:11px;color:#6d4c41;padding:4px 8px;background:#efebe9;border-radius:6px;">🚚 仅陆运</span>`;
                                    }
                                    return `<select onchange="expressUI.changeTransportMode('${company.id}', this.value)"
                                        style="flex:1;min-width:140px;max-width:220px;padding:4px 6px;border:1px solid #ddd;border-radius:6px;font-size:11px;background:#fff;">
                                        <option value="auto" ${curMode==='auto'?'selected':''}>🤖 智能（按金额）</option>
                                        <option value="land" ${curMode==='land'?'selected':''}>🚚 陆运</option>
                                        <option value="air" ${curMode==='air'?'selected':''}>✈️ 空运</option>
                                    </select>`;
                                })()}
                            </div>
                        </div>
                        <div style="display:flex;gap:6px;flex-shrink:0;flex-direction:column;">
                            ${companyBills.length
                                ? `<button onclick="expressUI.payCompanyBills('${company.id}')" style="padding:5px 10px;border:none;background:#ff9800;color:#fff;border-radius:6px;font-size:11px;cursor:pointer;font-weight:600;">结算 ¥${billAmount.toFixed(0)}</button>`
                                : ''}
                            ${!isDefault
                                ? `<button onclick="expressUI.setDefault('${company.id}')" style="padding:5px 10px;border:1px solid #1e88e5;background:#fff;color:#1e88e5;border-radius:6px;font-size:11px;cursor:pointer;">设默认</button>`
                                : ''}
                        </div>
                    </div>
                </div>`;
            });
        }

        // ===== ② 可解锁（只显示一行 + 合作按钮）=====
        if (canUnlockList.length) {
            html += `<div style="padding:12px 15px 4px;font-size:11px;color:#888;font-weight:600;">🆕 可立即合作</div>`;
            canUnlockList.forEach(company => {
                const pricingInfo = this._formatCompanyPricingInfo(company.id);
                html += `
                <div style="padding:10px 16px;border-bottom:1px solid #f0f0f0;">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <div style="width:36px;height:36px;border-radius:9px;background:${company.bgColor};display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">${company.icon}</div>
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:13px;font-weight:600;color:#333;">${company.name}</div>
                            <div style="font-size:10px;color:#888;margin-top:1px;">
                                丢件率${(company.lossRateBase*100).toFixed(2)}%
                                ${company.maxWeight?` · 单票限重≤${company.maxWeight}kg`:''}
                            </div>
                            <!-- ===== 可解锁也显示真实首重/续重（BASE_PRICING），替换旧的 company.baseFirstKg（不存在） ===== -->
                            ${pricingInfo ? `<div style="margin-top:3px;min-width:0;">${pricingInfo}</div>` : ''}
                        </div>
                        <button onclick="expressUI.unlockPartner('${company.id}')" style="padding:5px 12px;border:none;background:linear-gradient(135deg,#4caf50,#2e7d32);color:#fff;border-radius:6px;font-size:11px;cursor:pointer;font-weight:600;">+ 合作</button>
                    </div>
                </div>`;
            });
        }

        // ===== ③ 未达条件（折叠，点"展开更多"才看）=====
        if (lockedList.length) {
            html += `<div style="padding:12px 15px 4px;font-size:11px;color:#888;font-weight:600;display:flex;justify-content:space-between;align-items:center;">
                <span>🔒 更多快递 (${lockedList.length}家，达成条件自动解锁)</span>
                <button onclick="expressUI._toggleMoreLocked()" style="padding:2px 8px;border:1px solid #ddd;background:#fff;border-radius:4px;font-size:10px;cursor:pointer;color:#666;">
                    ${showMore ? '收起 ▲' : '展开 ▼'}
                </button>
            </div>`;
            if (showMore) {
                lockedList.forEach(company => {
                    html += `
                    <div style="padding:8px 16px;border-bottom:1px solid #f0f0f0;opacity:0.65;">
                        <div style="display:flex;align-items:center;gap:10px;">
                            <div style="width:32px;height:32px;border-radius:8px;background:${company.bgColor};display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;filter:grayscale(0.8);">${company.icon}</div>
                            <div style="flex:1;min-width:0;">
                                <div style="font-size:12px;color:#666;">${company.name}</div>
                                <div style="font-size:10px;color:#999;">
                                    需 信誉≥${company.reputationReq}${company.minMonthlyVolume>0?` · 月发件≥${company.minMonthlyVolume}`:''}
                                </div>
                            </div>
                        </div>
                    </div>`;
                });
            }
        }
        return html;
    }

    // 展开/收起 未达条件快递列表
    _toggleMoreLocked() {
        this._showMoreLocked = !this._showMoreLocked;
        this._updateModalContent();
    }

    unlockPartner(companyId) {
        const r = ExpressState.unlockPartner(companyId, gameState.state.gameTime);
        this._showToast(r.message, r.success?'success':'error');
        if (r.success) this._updateModalContent();
    }

    setDefault(companyId) {
        ExpressState.setDefault(companyId);
        this._showToast(`已设为默认快递：${getCompanyById(companyId)?.name||companyId}`, 'success');
        this._updateModalContent();
    }

    // ==================== 运费险（深化） ====================
    toggleFreightInsurance() {
        if (typeof gameState === 'undefined' || typeof gameState.toggleFreightInsurance !== 'function') return;
        const r = gameState.toggleFreightInsurance();
        this._showToast((r && r.message) || '已切换', (r && r.enabled) ? 'success' : 'info');
        this._updateModalContent();
        try { gameState.notify(); } catch (_) {}
    }

    payAllBills() {
        const unpaid = ExpressState.getUnpaidBills();
        if (!unpaid.length) { this._showToast('暂无待结账单'); return; }
        const total = unpaid.reduce((s, b) => s + (Number(b.payableAmount) || 0), 0);
        const detail = unpaid.map(b => {
            const name = (typeof getCompanyById === 'function' && getCompanyById(b.companyId)?.name) || b.companyId;
            return `${name} · ${b.period || b.id} ¥${(Number(b.payableAmount) || 0).toFixed(2)}`;
        }).join('<br>');
        const doPay = () => {
            let successCnt = 0, failCnt = 0;
            unpaid.forEach(b => { ExpressEngine.payBill(b.id).success ? successCnt++ : failCnt++; });
            this._showToast(`已结算 ${successCnt} 张账单${failCnt?`（${failCnt} 张失败，资金不足）`:''}`, failCnt?'error':'success');
            this._updateModalContent();
            if (successCnt && typeof gameState !== 'undefined') gameState.notify();
        };
        if (typeof ui !== 'undefined' && typeof ui.confirmPayment === 'function') {
            ui.confirmPayment({
                title: '确认结算快递账单',
                category: 'express',
                noCancel: true,
                amount: total,
                detailHtml: detail,
                note: `共 ${unpaid.length} 张待付账单。必须先付清，余额不足请贷款或破产。`,
                onConfirm: doPay
            });
        } else {
            doPay();
        }
    }

    payCompanyBills(companyId) {
        const unpaid = ExpressState.getUnpaidBills().filter(b => b.companyId === companyId);
        if (!unpaid.length) return;
        const name = (typeof getCompanyById === 'function' && getCompanyById(companyId)?.name) || companyId;
        const total = unpaid.reduce((s, b) => s + (Number(b.payableAmount) || 0), 0);
        const doPay = () => {
            let successCnt = 0;
            unpaid.forEach(b => { ExpressEngine.payBill(b.id).success && successCnt++; });
            this._showToast(`已结算 ${successCnt} 张账单`, 'success');
            this._updateModalContent();
            if (successCnt && typeof gameState !== 'undefined') gameState.notify();
        };
        if (typeof ui !== 'undefined' && typeof ui.confirmPayment === 'function') {
            ui.confirmPayment({
                title: `确认结算 · ${name}`,
                category: 'express',
                noCancel: true,
                amount: total,
                detailHtml: unpaid.map(b => `${b.period || b.id} · ¥${(Number(b.payableAmount) || 0).toFixed(2)}`).join('<br>'),
                note: '必须先付清快递费，余额不足请贷款或破产。',
                onConfirm: doPay
            });
        } else {
            doPay();
        }
    }

    // ========== Tab2：物流记录（运输中+最近签收） ==========
    _renderTrackTab() {
        const actives = ExpressState.getActiveWaybills();
        const signed = Object.values(ExpressState.waybills)
            .filter(w => w.status === 'signed')
            .sort((a,b) => (b.signedAt?.day||0) - (a.signedAt?.day||0))
            .slice(0, 15);

        if (!actives.length && !signed.length) {
            return '<div style="padding:50px 20px;text-align:center;color:#999;font-size:13px;">暂无物流记录<br><span style="font-size:11px;">发货后可在此查看物流动态</span></div>';
        }
        let html = '';
        if (actives.length) {
            html += `<div style="padding:10px 15px;background:#fff3e0;font-size:12px;color:#e65100;font-weight:bold;">🚚 运输中 (${actives.length})</div>`;
            actives.forEach(w => html += this._renderWaybillCard(w, true));
        }
        if (signed.length) {
            html += `<div style="padding:10px 15px;background:#e8f5e9;font-size:12px;color:#2e7d32;font-weight:bold;">✅ 最近签收 (${signed.length})</div>`;
            signed.forEach(w => html += this._renderWaybillCard(w, false));
        }
        return html;
    }

    _renderWaybillCard(w, active) {
        const company = getCompanyById(w.companyId);
        const status = getLogisticsStatus(w.status);
        const track = ExpressState.getTrack(w.id);
        const latest = track[track.length-1];
        const progress = active ? Math.min(100, Math.round(
            ((gameState.state.gameTime.day - w.createdAt.day)*24 + (gameState.state.gameTime.hour - w.createdAt.hour)) / (w.estimatedDeliveryHours||72) * 100
        )) : 100;
        return `<div style="padding:12px 15px;border-bottom:1px solid #f0f0f0;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                <span style="font-size:20px;">${company?.icon||'📦'}</span>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${w.productName}</div>
                    <div style="font-size:10px;color:#888;">${company?.name||''} · ${w.trackingNo||''}</div>
                </div>
                <span style="font-size:11px;color:${status.color};font-weight:bold;">${status.name}</span>
            </div>
            ${active ? `<div style="background:#f5f5f5;border-radius:4px;height:5px;overflow:hidden;margin:4px 0 6px;">
                <div style="width:${progress}%;height:100%;background:${status.color};transition:width 0.3s;"></div>
            </div>` : ''}
            <div style="font-size:11px;color:#666;">${latest?.description||''} · 💰¥${(w.fee||0).toFixed(2)}</div>
        </div>`;
    }

    // ========== 发货选快递（极简两档） ==========
    showShipDialog(order) {
        this._pendingOrder = order;
        const product = (typeof getProductById === 'function')
            ? getProductById(order.productId)
            : ((typeof PRODUCTS !== 'undefined') ? PRODUCTS.find(p => p.id === order.productId) : null);
        const warehouseCity = (typeof gameState.getWarehouseCity === 'function')
            ? gameState.getWarehouseCity()
            : (gameState.state.warehouse?.city || 'yiwu');
        const originCity = (typeof resolveShipFromCity === 'function')
            ? resolveShipFromCity(product, warehouseCity)
            : ((product && product.originCity) || warehouseCity);
        order.fromCity = originCity;
        const weightKg = order.weightKg || (order.quantity * 0.3) || 0.5;
        const fromCity = originCity;
        const toCity = order.buyerCity || 'shanghai';
        // 原产地跨境默认空运；其余默认智能
        order.shipping_method = null;
        order.shippingMethod = null;
        this._pendingShipMethod = (product && product.originCity) ? 'air' : 'auto';

        // 获取所有报价，按档位分组：找到经济型最优和标准型最优
        const allQuotes = ExpressEngine.getQuoteComparison(weightKg, fromCity, toCity, {
            ...(order.packOptions || {}),
            shippingMethod: this._pendingShipMethod || 'auto',
            order
        });
        this._currentQuotes = allQuotes;

        let economyBest = null, standardBest = null;
        allQuotes.forEach(q => {
            // economy 类：快递服务是 economy，或者是最便宜的
            if (q.serviceId === 'economy' || q.service.tier === 'economy') {
                if (!economyBest || q.totalFee < economyBest.totalFee) economyBest = q;
            } else {
                // standard 及以上
                if (!standardBest || q.totalFee < standardBest.totalFee) standardBest = q;
            }
        });
        // 如果没找到经济或标准档，用整体最优兜底
        if (!economyBest && allQuotes.length) economyBest = allQuotes.reduce((a,b) => a.totalFee < b.totalFee ? a : b);
        if (!standardBest && allQuotes.length) standardBest = allQuotes.reduce((a,b) => a.totalFee < b.totalFee ? a : b);

        // 默认选中：标准档（如果标准档存在）
        this._selectedTier = standardBest ? 'standard' : 'economy';

        this._showSimpleShipModal(weightKg, fromCity, toCity, economyBest, standardBest);
    }

    _showSimpleShipModal(weightKg, fromCity, toCity, economyBest, standardBest) {
        document.getElementById('shipExpressModal')?.remove();
        const order = this._pendingOrder;

        const buildQuoteBlock = (q, key, label, color) => {
            if (!q) return '';
            const sel = this._selectedTier === key;
            const company = getCompanyById(q.companyId);
            const lossText = q.lossRate >= 0.003
                ? `<span style="font-size:10px;background:#ff9800;color:#fff;padding:0 5px;border-radius:3px;margin-left:4px;">存在极小概率丢件</span>`
                : `<span style="font-size:10px;background:#4caf50;color:#fff;padding:0 5px;border-radius:3px;margin-left:4px;">丢件率${(q.lossRate*100).toFixed(2)}%</span>`;
            const tag = ExpressState.defaultCompany === q.companyId && q.serviceId === 'standard'
                ? `<span style="font-size:9px;background:#4caf50;color:#fff;padding:0 4px;border-radius:3px;margin-left:4px;">默认</span>` : '';

            // ===== 当前这个服务类型的「首重/续重」定价展示 =====
            const currentServicePricing = (BASE_PRICING && BASE_PRICING[q.companyId] && BASE_PRICING[q.companyId][q.serviceId])
                || (BASE_PRICING && BASE_PRICING[q.companyId] && BASE_PRICING[q.companyId].standard);
            let pricingText = '';
            if (currentServicePricing) {
                const firstKg = currentServicePricing.firstWeightKg || 1;
                const landM = (typeof SHIPPING_METHODS !== 'undefined' && SHIPPING_METHODS.land)
                    ? SHIPPING_METHODS.land.feeMultiplier : 0.88;
                const airM = (typeof SHIPPING_METHODS !== 'undefined' && SHIPPING_METHODS.air)
                    ? SHIPPING_METHODS.air.feeMultiplier : 2.15;
                const isAir = q.shippingMethod === 'air';
                const modeMul = isAir ? airM : landM;
                const modePrice = (currentServicePricing.firstWeight * modeMul).toFixed(1);
                const modeHint = isAir
                    ? `✈️ 空运计价 ×${airM} · 首重约¥${modePrice}`
                    : `🚚 陆运计价 ×${landM} · 首重约¥${modePrice}`;
                pricingText = `<div style="font-size:10px;color:#555;margin-top:2px;line-height:1.4;">
                    📏 定价：首${firstKg}kg <b>¥${currentServicePricing.firstWeight}</b> + 续重 <b>¥${currentServicePricing.addWeight}/kg</b>
                </div>
                <div style="font-size:10px;color:${isAir ? '#1565c0' : '#6d4c41'};margin-top:2px;">${modeHint}</div>`;
            }

            // ===== 选中时显示「运费构成明细」=====
            let detailsHtml = '';
            if (sel) {
                const items = [];
                if (typeof q.weightFee === 'number' && q.weightFee > 0) {
                    items.push(`<span>首重+续重 <b>¥${q.weightFee.toFixed(2)}</b></span>`);
                }
                if (typeof q.distanceFee === 'number' && Math.abs(q.distanceFee) > 0.01) {
                    if (q.distanceFee > 0) items.push(`<span style="color:#e65100;">距离+¥${q.distanceFee.toFixed(2)}</span>`);
                    else items.push(`<span style="color:#2e7d32;">同城-¥${Math.abs(q.distanceFee).toFixed(2)}</span>`);
                }
                if (typeof q.insuranceFee === 'number' && q.insuranceFee > 0) {
                    items.push(`<span>保价 ¥${q.insuranceFee.toFixed(2)}</span>`);
                }
                if (typeof q.packagingFee === 'number' && q.packagingFee > 0) {
                    items.push(`<span>包装 ¥${q.packagingFee.toFixed(2)}</span>`);
                }
                if (q.shippingMethod === 'air') {
                    items.push(`<span style="color:#1565c0;font-weight:600;">✈️ 空运 ×${q.shippingFeeMultiplier || 2.15}</span>`);
                } else {
                    items.push(`<span style="color:#6d4c41;font-weight:600;">🚚 陆运 ×${q.shippingFeeMultiplier || 0.88}</span>`);
                }
                // 折扣 = 原价 × (1 - discount)，展示"节省了多少"
                if (typeof q.discount === 'number' && q.discount < 0.999) {
                    const beforeDiscount = (q.baseFee || 0) + (q.insuranceFee || 0) + (q.packagingFee || 0);
                    const saved = Math.max(0, beforeDiscount - q.totalFee);
                    if (saved > 0.01) {
                        items.push(`<span style="color:#388e3c;font-weight:600;">💰 合作折扣省¥${saved.toFixed(2)}</span>`);
                    }
                }
                detailsHtml = items.length
                    ? `<div style="margin-top:8px;padding:7px 10px;background:#fff;border:1px dashed ${color}44;border-radius:7px;font-size:10px;color:#555;line-height:1.8;">
                        📋 费用构成：${items.join(' · ')}
                    </div>`
                    : '';
            }

            return `<div onclick="expressUI.selectShipTier('${key}')" style="padding:12px 14px;border:2px solid ${sel?color:'#eee'};border-radius:10px;margin-bottom:10px;cursor:pointer;background:${sel?color+'12':'#fff'};transition:all 0.15s;">
                <div style="display:flex;align-items:center;gap:10px;">
                    <div style="width:34px;height:34px;border-radius:8px;background:${company.bgColor||color};display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">${company.icon||'📦'}</div>
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:14px;font-weight:600;color:#333;display:flex;align-items:center;flex-wrap:wrap;">
                            ${label}${tag}${lossText}
                        </div>
                        <div style="font-size:11px;color:#888;margin-top:2px;">${company.name} · ${q.service.name}${q.shippingMethodName ? ' · ' + q.shippingMethodName : ''} · 预计${q.estimatedDays}天送达</div>
                        ${pricingText}
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:17px;font-weight:700;color:${color};">¥${q.totalFee.toFixed(2)}</div>
                        <div style="font-size:10px;color:#888;">${weightKg.toFixed(1)}kg</div>
                    </div>
                </div>
                ${detailsHtml}
                ${sel && !detailsHtml ? `<div style="margin-top:8px;padding:6px 8px;background:${color}0F;border-radius:6px;font-size:11px;color:${color};">
                    ✅ 已选择 — ${key==='economy'?'省钱之选，注意丢件风险':'稳定之选，时效与服务更优'}
                </div>` : ''}
            </div>`;
        };

        const selQuote = this._selectedTier === 'economy' ? economyBest : standardBest;

        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = 'shipExpressModal';
        modal.style.zIndex = '250';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:420px;max-height:85vh;display:flex;flex-direction:column;">
                <div class="modal-header" style="background:linear-gradient(135deg,#ff5722,#e64a19);color:white;display:flex;justify-content:space-between;align-items:center;padding:12px 15px;">
                    <h3 style="margin:0;font-size:15px;">📦 选择快递发货</h3>
                    <button onclick="document.getElementById('shipExpressModal')?.remove()" style="background:none;border:none;color:white;font-size:20px;cursor:pointer;">×</button>
                </div>
                <div class="modal-body" style="flex:1;overflow-y:auto;padding:12px;">
                    <div style="background:#f8f9fa;padding:8px 12px;border-radius:8px;margin-bottom:12px;font-size:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;">
                        <span>${order?.productName||'商品'} ×${order?.quantity||1}</span>
                        <span>${weightKg.toFixed(1)}kg · ${this._cityLabel(fromCity)}→${this._cityLabel(toCity)}</span>
                    </div>
                    ${(typeof isOriginCity === 'function' && isOriginCity(fromCity))
                        ? '<div style="background:#e8eaf6;padding:6px 10px;border-radius:8px;margin-bottom:10px;font-size:11px;color:#303f9f;">🌍 原产地直发：必须从国外发往国内买家</div>'
                        : ''}
                    ${(() => {
                        const mid = this._pendingShipMethod || 'auto';
                        const names = { auto: '🤖 智能（按金额自动）', land: '🚚 陆运', air: '✈️ 空运' };
                        const tip = mid === 'auto'
                            ? '智能：贵重单走空运（顺丰/京东/EMS 支持空运，含标准件）。圆通/中通/韵达/申通/极兔/德邦只有陆运。'
                            : (mid === 'air' ? '空运约 2.4 倍运费、时效更快。仅顺丰/京东/EMS 可空运；三通一达等不参与报价。' : '陆运：运费更低。普通快递只有陆运。');
                        return `<div style="background:${mid==='air'?'#e3f2fd':mid==='land'?'#fff8e1':'#f3e5f5'};padding:8px 12px;border-radius:8px;margin-bottom:10px;font-size:12px;color:#333;">
                            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
                                <b>运输方式：${names[mid] || mid}</b>
                                <span style="display:flex;gap:4px;">
                                    ${['auto', 'land', 'air'].map(m => `<button onclick="expressUI.setShipMethod('${m}')" style="padding:3px 8px;border:1px solid ${mid===m?'#ff5722':'#ddd'};background:${mid===m?'#ff5722':'#fff'};color:${mid===m?'#fff':'#555'};border-radius:6px;font-size:11px;cursor:pointer;font-weight:${mid===m?'700':'400'};">${m==='auto'?'智能':m==='land'?'陆运':'空运'}</button>`).join('')}
                                </span>
                            </div>
                            <div style="font-size:10px;color:#888;margin-top:3px;">${tip}</div>
                        </div>`;
                    })()}
                    ${buildQuoteBlock(economyBest, 'economy', '🟢 经济型', '#4caf50')}
                    ${buildQuoteBlock(standardBest, 'standard', '🔵 标准型', '#2196f3')}
                    <div style="font-size:11px;color:#999;margin-top:6px;">
                        💡 小提示：经济型价格更低但存在极小概率丢件风险，标准型更稳定时效更佳
                    </div>
                </div>
                <div style="padding:12px;border-top:1px solid #eee;flex-shrink:0;display:flex;gap:8px;">
                    <button onclick="document.getElementById('shipExpressModal')?.remove()" style="flex:1;padding:10px;border:1px solid #ddd;background:#fff;border-radius:6px;cursor:pointer;font-size:13px;">取消</button>
                    <button onclick="expressUI.confirmShip()" style="flex:2;padding:10px;border:none;background:linear-gradient(135deg,#ff5722,#e64a19);color:#fff;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">
                        确认发货 (¥${selQuote?.totalFee.toFixed(2)||'--'})
                    </button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    }

    selectShipTier(tier) {
        this._selectedTier = tier;
        const order = this._pendingOrder;
        if (!order) return;
        const weightKg = order.weightKg || (order.quantity * 0.3) || 0.5;
        const fromCity = order.fromCity || gameState.state.warehouse?.city || 'yiwu';
        const toCity = order.buyerCity || 'shanghai';
        // 重组数据
        const allQuotes = this._currentQuotes;
        let economyBest = null, standardBest = null;
        allQuotes.forEach(q => {
            if (q.serviceId === 'economy' || q.service.tier === 'economy') {
                if (!economyBest || q.totalFee < economyBest.totalFee) economyBest = q;
            } else {
                if (!standardBest || q.totalFee < standardBest.totalFee) standardBest = q;
            }
        });
        if (!economyBest && allQuotes.length) economyBest = allQuotes.reduce((a,b) => a.totalFee < b.totalFee ? a : b);
        if (!standardBest && allQuotes.length) standardBest = allQuotes.reduce((a,b) => a.totalFee < b.totalFee ? a : b);
        this._showSimpleShipModal(weightKg, fromCity, toCity, economyBest, standardBest);
    }

    /** 发货弹窗切换运输方式（智能/陆运/空运；陆运公司自动回退） */
    setShipMethod(method) {
        if (!['auto', 'land', 'air'].includes(method)) return;
        this._pendingShipMethod = method;
        const order = this._pendingOrder;
        if (!order) return;
        const weightKg = order.weightKg || (order.quantity * 0.3) || 0.5;
        const fromCity = order.fromCity || gameState.state.warehouse?.city || 'yiwu';
        const toCity = order.buyerCity || 'shanghai';
        const allQuotes = ExpressEngine.getQuoteComparison(weightKg, fromCity, toCity, {
            ...(order.packOptions || {}),
            shippingMethod: method,
            order
        });
        this._currentQuotes = allQuotes;
        let economyBest = null, standardBest = null;
        allQuotes.forEach(q => {
            if (q.serviceId === 'economy' || q.service.tier === 'economy') {
                if (!economyBest || q.totalFee < economyBest.totalFee) economyBest = q;
            } else {
                if (!standardBest || q.totalFee < standardBest.totalFee) standardBest = q;
            }
        });
        if (!economyBest && allQuotes.length) economyBest = allQuotes.reduce((a,b) => a.totalFee < b.totalFee ? a : b);
        if (!standardBest && allQuotes.length) standardBest = allQuotes.reduce((a,b) => a.totalFee < b.totalFee ? a : b);
        this._showSimpleShipModal(weightKg, fromCity, toCity, economyBest, standardBest);
    }

    /** 切换合作快递运输方式（智能/陆运/空运，受公司 allowedModes 限制） */
    changeTransportMode(companyId, mode) {
        if (!companyId || !mode || typeof ExpressState === 'undefined') return;
        const ok = ExpressState.setPartnerTransportMode(companyId, mode);
        if (ok) {
            const names = { auto: '智能（按金额）', land: '陆运', air: '空运' };
            this._showToast(`已切换为${names[mode] || mode}`, 'success');
            if (typeof gameState !== 'undefined' && gameState.saveDebounced) gameState.saveDebounced();
        } else {
            this._showToast('切换失败：该公司不支持该运输方式', 'error');
        }
        if (typeof this._updateModalContent === 'function') this._updateModalContent();
    }

    /** 切换合作快递结算周期（现结 / 周结 / 月结） */
    changeSettlementCycle(companyId, cycleId) {
        if (!companyId || !cycleId || typeof ExpressState === 'undefined') return;
        const ok = ExpressState.setSettlementCycle(companyId, cycleId);
        if (ok) {
            const cycle = (typeof SETTLEMENT_CYCLES !== 'undefined' ? SETTLEMENT_CYCLES : [])
                .find(c => c.id === cycleId);
            this._showToast(`已切换为${cycle ? cycle.name : cycleId}`, 'success');
            if (typeof gameState !== 'undefined' && gameState.saveDebounced) gameState.saveDebounced();
        } else {
            const partner = ExpressState.getPartner(companyId);
            const lvl = partner ? getCooperationLevel(partner) : { level: 0 };
            const cycle = (typeof SETTLEMENT_CYCLES !== 'undefined' ? SETTLEMENT_CYCLES : [])
                .find(c => c.id === cycleId);
            const need = cycle ? cycle.minLevel : '?';
            this._showToast(`切换失败：需要合作等级 Lv${need}（当前 Lv${lvl.level || 0}）`, 'error');
        }
        if (typeof this._updateModalContent === 'function') this._updateModalContent();
    }

    confirmShip() {
        if (!this._currentQuotes || !this._currentQuotes.length) return;
        // 按选中的档位取出最优报价
        let pickQuote = null;
        if (this._selectedTier === 'economy') {
            pickQuote = this._currentQuotes.find(q => q.serviceId === 'economy' || q.service.tier === 'economy')
                || this._currentQuotes.reduce((a,b) => a.totalFee < b.totalFee ? a : b, null);
        } else {
            pickQuote = this._currentQuotes.find(q => !(q.serviceId === 'economy' || q.service.tier === 'economy'))
                || this._currentQuotes.reduce((a,b) => a.totalFee < b.totalFee ? a : b, null);
        }
        if (!pickQuote) return;

        const order = this._pendingOrder;
        order.expressCompanyId = pickQuote.companyId;
        order.expressServiceId = pickQuote.serviceId;

        // 二次确认：经济型丢件风险提示
        if (pickQuote.service.tier === 'economy' || pickQuote.serviceId === 'economy') {
            const ok = confirm(`您选择了【经济型】快递，存在极小概率的包裹丢失风险，是否仍确认发货？\n\n${getCompanyById(pickQuote.companyId)?.name} - ${pickQuote.service.name}\n费用：¥${pickQuote.totalFee.toFixed(2)}`);
            if (!ok) return;
        }

        const partner = typeof ExpressState !== 'undefined' ? ExpressState.getPartner(pickQuote.companyId) : null;
        const defaultCycle = (typeof DEFAULT_SETTLEMENT_CYCLE !== 'undefined') ? DEFAULT_SETTLEMENT_CYCLE : 'weekly';
        let cycleId = (partner && partner.settlementCycle) || defaultCycle;
        if (cycleId === 'daily' || !(typeof SETTLEMENT_CYCLES !== 'undefined' && SETTLEMENT_CYCLES.find(c => c.id === cycleId))) {
            cycleId = defaultCycle;
        }
        if (partner && partner.settlementCycle !== cycleId) partner.settlementCycle = cycleId;
        const cycle = (typeof SETTLEMENT_CYCLES !== 'undefined')
            ? SETTLEMENT_CYCLES.find(c => c.id === cycleId)
            : null;
        // 仅现结才在发货时扣款；周结/月结发货不弹快递费、不扣款
        const immediatePay = !!(cycle && cycle.id === 'per_order');
        const companyName = getCompanyById(pickQuote.companyId)?.name || '';
        const fee = Number(pickQuote.totalFee) || 0;

        const doShip = (confirmedPayment) => {
            const shipOpts = Object.assign({}, order.packOptions || {}, {
                confirmedPayment: !!confirmedPayment,
                shippingMethod: pickQuote.shippingMethod || this._pendingShipMethod || 'auto'
            });
            if (typeof gameEngine !== 'undefined') {
                const r = gameEngine.shipOrder(order, pickQuote.serviceId, null, shipOpts);
                if (r) {
                    this._showToast('发货成功！运单号：' + (order.trackingNo || ''), 'success');
                    document.getElementById('shipExpressModal')?.remove();
                    if (typeof gameState !== 'undefined') gameState.notify();
                } else {
                    this._showToast('发货失败，请检查资金或库存', 'error');
                }
            } else {
                const r = ExpressEngine.shipOrder(order, pickQuote.companyId, pickQuote.serviceId, gameState.state.gameTime, shipOpts);
                if (r.success) {
                    this._showToast(r.message, 'success');
                    document.getElementById('shipExpressModal')?.remove();
                    if (typeof gameState !== 'undefined') gameState.notify();
                } else {
                    this._showToast(r.message, 'error');
                }
            }
        };

        // 单结且有费用：先弹窗确认再发货并扣款
        if (immediatePay && fee > 0 && typeof ui !== 'undefined' && typeof ui.confirmPayment === 'function') {
            ui.confirmPayment({
                title: '确认支付快递费',
                category: 'express',
                noCancel: true,
                amount: fee,
                detailHtml: `${companyName} · ${pickQuote.service?.name || pickQuote.serviceId}<br>预计送达约 ${pickQuote.estimatedDays || '-'} 天`,
                note: '必须先付清快递费才会发货。余额不足请申请贷款，否则宣告破产。',
                onConfirm: () => doShip(true)
            });
            return;
        }
        doShip(false);
    }
}

const expressUI = new ExpressUI();
if (typeof window !== 'undefined') {
    window.ExpressUI = ExpressUI;
    window.expressUI = expressUI;
}
