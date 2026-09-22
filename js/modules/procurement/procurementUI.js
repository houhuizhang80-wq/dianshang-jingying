/**
 * 采购中心模块（V2 重制）- 统一采购界面
 * 主入口 procUI.showCenter([tab])；弹窗复用 ui.showModal（同 modalId 自动刷新不叠层）。
 * 六个 Tab：智能推荐 / 商品进货 / 采购订单 / 采购员 / 采购计划 / 包装材料。
 * 采购员/采购计划/包装材料的深度操作复用仓储模块（whUI）既有弹窗，避免重复实现与数据双写。
 */
function initProcurementUI(procurementState, gameState, ui) {
    const procUI = {
        procurementState,
        gameState,
        ui,
        _tab: 'smart',

        showCenter(tab = null) {
            if (tab) this._tab = tab;
            try {
                this._render();
            } catch (e) {
                console.error('[procUI.showCenter]', e);
                try { this.ui.showToast('采购中心渲染异常，请重试'); } catch (_) {}
            }
        },

        switchTab(tab) {
            this._tab = tab;
            this._render();
        },

        _render() {
            const state = this.gameState.state;
            const orderStats = this.procurementState.getOrderStats();
            const content = `
                <div class="proc-container">
                    <div class="proc-summary">
                        <div class="proc-sum-card" style="background:linear-gradient(135deg,#667eea,#764ba2);">
                            <div class="proc-sum-value">${orderStats.inTransit}</div>
                            <div class="proc-sum-label">在途采购单</div>
                        </div>
                        <div class="proc-sum-card" style="background:linear-gradient(135deg,#f093fb,#f5576c);">
                            <div class="proc-sum-value">${orderStats.inTransitQty.toLocaleString('en-US')}</div>
                            <div class="proc-sum-label">在途件数</div>
                        </div>
                        <div class="proc-sum-card" style="background:linear-gradient(135deg,#4facfe,#00f2fe);">
                            <div class="proc-sum-value">${formatMoney(orderStats.inTransitCost)}</div>
                            <div class="proc-sum-label">在途金额</div>
                        </div>
                    </div>
                    <div class="proc-tabs">
                        ${PROC_TABS.map(t => `
                            <div class="proc-tab ${this._tab === t.id ? 'active' : ''}" onclick="procUI.switchTab('${t.id}')">
                                <span class="proc-tab-icon">${t.icon}</span><span>${t.name}</span>
                            </div>`).join('')}
                    </div>
                    <div class="proc-body">
                        ${this._renderTabBody()}
                    </div>
                </div>`;

            const footer = `
                <button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>
                <button class="btn btn-primary" onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                    onclick="procUI.goSupply()">去进货</button>`;

            return this.ui.showModal('🛒 采购中心', content, footer, {
                modalId: 'procurementCenterModal',
                modalClass: 'proc-overlay'
            });
        },

        goSupply() {
            this._tab = 'supply';
            this._render();
        },

        _renderTabBody() {
            switch (this._tab) {
                case 'smart': return this._renderSmartTab();
                case 'supply': return this._renderSupplyTab();
                case 'orders': return this._renderOrdersTab();
                case 'buyers': return this._renderBuyersTab();
                case 'plans': return this._renderPlansTab();
                case 'packaging': return this._renderPackagingTab();
                case 'relations': return this._renderRelationsTab();
                default: return this._renderSmartTab();
            }
        },

        // ==================== Tab：供应商关系(供应链模块) ====================
        _renderRelationsTab() {
            try {
                if (typeof window !== 'undefined' && window.supplyUI && typeof window.supplyUI.renderRelationsHTML === 'function') {
                    return window.supplyUI.renderRelationsHTML();
                }
            } catch (_) {}
            return '<div class="proc-empty"><div class="proc-empty-icon">🤝</div><div>供应商关系模块未加载</div></div>';
        },

        // ==================== Tab：智能推荐 ====================
        refreshRec() {
            try {
                const eng = (typeof window !== 'undefined' && window.procurementEngine) || null;
                if (eng && typeof eng.refresh === 'function') eng.refresh();
                else this.procurementState.buildRecommendations(true);
            } catch (_) {
                this.procurementState.buildRecommendations(true);
            }
            this._render();
            this.ui.showToast('✨ 推荐已刷新');
        },

        _renderSmartTab() {
            // 每次打开都强制重算，保证数量/预算与当前资金实时一致（不会看到旧的小单）
            const { snapshot, fresh } = this.procurementState.getRecommendations(true);
            const items = (snapshot && snapshot.items) || [];
            const quickLog = (this.procurementState.state.quickBuyLog || []).slice(0, 6);

            let body;
            if (!items.length) {
                const wh = snapshot && snapshot.warehouse;
                const full = snapshot && snapshot.warehouseFull;
                body = `
                    <div class="proc-empty">
                        <div class="proc-empty-icon">${full ? '📦' : '✨'}</div>
                        <div>${full ? '仓库已满，暂不推荐进货' : '暂无推荐'}</div>
                        <div style="font-size:12px;color:#aaa;margin-top:6px;line-height:1.7;">
                            ${full
                                ? `仓容 ${wh ? (wh.capacity || 0).toLocaleString('en-US') : 0} · 已用 ${wh ? (wh.used || 0).toLocaleString('en-US') : 0} · 在途 ${wh ? (wh.inbound || 0).toLocaleString('en-US') : 0}。<br>请先发货出库或升级仓库，空出仓位后再来采购。`
                                : `智能推荐会优先按仓库空位分配数量，再结合销量、未完成订单和低库存生成清单。<br>你可以先<a href="javascript:void(0)" onclick="procUI.goSupply()" style="color:#667eea;">去进货</a>、上架商品。`}
                        </div>
                        <button class="btn btn-primary" style="margin-top:12px;" onclick="${full ? "ui.showWarehouseModal('overview')" : 'procUI.goSupply()'}">${full ? '去看仓库' : '去进货'}</button>
                        <button class="btn btn-secondary" style="margin-top:8px;" onclick="procUI.refreshRec()">🔄 立即刷新</button>
                    </div>`;
            } else {
                const wh = snapshot.warehouse || {};
                const fundsInfo = `
                    <div class="proc-hint" style="background:#e3f2fd;border:1px solid #90caf9;color:#0d47a1;">
                        📦 仓库空位 <b>${(wh.free || 0).toLocaleString('en-US')}</b> 件
                        （总额度 ${(wh.capacity || 0).toLocaleString('en-US')} · 已用 ${(wh.used || 0).toLocaleString('en-US')} · 在途 ${(wh.inbound || 0).toLocaleString('en-US')}）
                        · 推荐数量优先按空位分配
                    </div>
                    ${(typeof snapshot.funds === 'number')
                        ? `<div class="proc-hint" style="background:#e8f5e9;border:1px solid #c8e6c9;color:#1b5e20;">
                            💰 现有资金 ${formatMoney(snapshot.funds)} · 今日推荐预算 ${formatMoney(snapshot.budgetCap)}（${Math.round((SMART_REC_CONFIG.fundsRatio || 0.7) * 100)}%）
                           </div>`
                        : ''}`;
                const bm = snapshot.bundleMeta || null;
                const bundleBanner = bm
                    ? `<div style="margin:8px 0;padding:12px 14px;border-radius:12px;background:linear-gradient(135deg,#fff7e6,#ffe7ba);border:1px solid #ffd591;">
                        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                            <div>
                                <div style="font-weight:800;font-size:14px;color:#d46b08;">📦 今日推荐组合（${bm.itemCount} 种商品 · 整单 9.6 折）</div>
                                <div style="font-size:12px;color:#8c6d1f;margin-top:2px;">
                                    原价 <span style="text-decoration:line-through;">${formatMoney(bm.originalTotal)}</span>
                                    → <b style="color:#d46b08;">${formatMoney(bm.bundlePrice)}</b>
                                    · 省 <b style="color:#cf1322;">${formatMoney(bm.savings)}</b>
                                </div>
                            </div>
                            <button class="btn btn-primary" style="font-weight:800;padding:10px 16px;"
                                    onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                                    onclick="procUI.quickBuyBundle()">⚡ 一键采购组合（9.6折）</button>
                        </div>
                    </div>`
                    : '';
                body = `
                    <div class="proc-hint">✨ 每天从全部商品随机组合 ${SMART_REC_CONFIG.bundleMinItems}~${SMART_REC_CONFIG.bundleMaxItems} 种商品，整单 9.6 折；<b>数量优先按仓库空位</b>，资金只做二次限制${fresh ? '' : '（数据可能滞后，点击右上角刷新）'}
                        <button class="btn btn-secondary btn-small" style="margin-left:8px;" onclick="procUI.refreshRec()">🔄 刷新</button>
                    </div>
                    ${fundsInfo}
                    ${bundleBanner}
                    <div class="proc-rec-list">
                        ${items.map((it, idx) => `
                            <div class="proc-rec-card">
                                <div class="proc-rec-head">
                                    <div class="proc-rec-icon">${it.icon}</div>
                                    <div class="proc-rec-main">
                                        <div class="proc-rec-name">${escapeHtml(it.productName)}
                                            ${it.lowStockWarn ? '<span class="proc-tag info" style="background:#ffebee;color:#c62828;">⚠️ 缺货预警</span>' : ''}
                                            ${it.routineTopUp ? '<span class="proc-tag" style="background:#e8f5e9;color:#2e7d32;">📦 常规备货</span>' : ''}
                                            ${it.warehouseTrimmed ? '<span class="proc-tag" style="background:#e3f2fd;color:#1565c0;">已按仓容缩减</span>' : ''}
                                            ${it.budgetTrimmed ? '<span class="proc-tag" style="background:#fff8e1;color:#e65100;">已按预算缩减</span>' : ''}
                                            ${it.budgetExceeded ? '<span class="proc-tag" style="background:#eee;color:#999;">💰 资金不足</span>' : ''}
                                        </div>
                                        <div class="proc-rec-sub">${escapeHtml(it.supplierName)} · ${it.grade}级 · 到货约${it.deliveryDays}天</div>
                                    </div>
                                    ${it.listingPrice > 0
                                        ? `<div class="proc-rec-margin ${it.margin >= 30 ? 'good' : it.margin >= 10 ? 'mid' : 'low'}">毛利 ${it.margin}%</div>`
                                        : '<div class="proc-rec-margin low">未上架</div>'}
                                </div>
                                <div class="proc-rec-stats">
                                    <div class="proc-rec-stat"><b>${it.sold}</b><span>近${SMART_REC_CONFIG.salesWindowDays}天售出</span></div>
                                    <div class="proc-rec-stat"><b>${it.stock}</b><span>现有库存</span></div>
                                    <div class="proc-rec-stat"><b>${it.pend}</b><span>未完成订单</span></div>
                                    <div class="proc-rec-stat"><b>¥${it.unitPrice.toFixed(2)}</b><span>批发单价</span></div>
                                </div>
                                <div class="proc-rec-foot">
                                    <div class="proc-rec-qty">
                                        采购 <b>${it.suggestQty.toLocaleString('en-US')}</b> 件 · 小计 ${formatMoney(it.estCost)}
                                        ${it.discountedSubtotal != null ? `<span style="color:#d46b08;margin-left:6px;">折后 ${formatMoney(it.discountedSubtotal)}</span>` : ''}
                                    </div>
                                    <div style="display:flex;gap:6px;">
                                        <button class="btn btn-secondary btn-small" onclick="procUI.showCompare('${it.productId}')">🔍 比价</button>
                                        <button class="btn btn-secondary btn-small" onclick="ui.showPurchaseModal('${it.supplierId}', '${it.productId}')">手动进货</button>
                                    </div>
                                </div>
                            </div>`).join('')}
                    </div>
                    ${bundleBanner ? `
                    <div style="margin-top:10px;text-align:center;">
                        <button class="btn btn-primary" style="font-weight:800;padding:12px 22px;font-size:15px;"
                                onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                                onclick="procUI.quickBuyBundle()">⚡ 一键采购组合（9.6折 · ${formatMoney(bm.bundlePrice)}）</button>
                    </div>` : ''}`;
            }

            return `
                ${body}
                ${quickLog.length ? `
                <div class="proc-section-title">📜 一键采购记录</div>
                <div class="proc-log-list">
                    ${quickLog.map(l => `
                        <div class="proc-log-item">
                            <span>${escapeHtml(l.productName)}</span>
                            <span style="color:#666;">${escapeHtml(l.supplierName)} · ${l.quantity.toLocaleString('en-US')}件 · ${formatMoney(l.cost)}</span>
                            <span class="proc-tag ok">第${l.day}天</span>
                        </div>`).join('')}
                </div>` : ''}`;
        },

        quickBuy(idx) {
            const r = this.procurementState.quickBuy(idx);
            if (r && r.success) {
                this.ui.showToast(r.message);
                this._render();
            } else {
                this.ui.showToast((r && r.message) || '一键采购失败');
            }
        },

        quickBuyBundle() {
            const r = this.procurementState.quickBuyBundle();
            if (r && r.success) {
                this.ui.showToast(r.message);
                this._render();
            } else {
                this.ui.showToast((r && r.message) || '组合采购失败');
            }
        },

        // ==================== 供应商比价 ====================
        showCompare(productId) {
            const r = this.procurementState.compareSuppliers(productId);
            if (!r || !r.success) {
                this.ui.showToast((r && r.message) || '比价失败');
                return;
            }
            const bestId = r.best;
            const content = `
                <div style="padding:4px 2px;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                        <span style="font-size:26px;">${r.icon}</span>
                        <div>
                            <div style="font-weight:800;font-size:15px;">${escapeHtml(r.productName)}</div>
                            <div style="font-size:12px;color:#888;">
                                共 ${r.rows.length} 家批发商可选 · 最贵与最便宜价差 <b style="color:#c62828;">¥${r.maxSavings.toFixed(2)}</b>/件
                            </div>
                        </div>
                    </div>
                    ${r.rows.map((s, i) => {
                        const isBest = s.supplierId === bestId;
                        const tags = [];
                        if (isBest) tags.push('<span class="proc-tag ok">💎 最低价</span>');
                        if (s.supplyMul < 1) tags.push(`<span class="proc-tag info">直采/独家 ×${s.supplyMul.toFixed(2)}</span>`);
                        if (s.relation && s.relation.creditDays > 0) tags.push(`<span class="proc-tag" style="background:#e8f5e9;color:#2e7d32;">账期${s.relation.creditDays}天</span>`);
                        if (s.relation && s.relation.tier) tags.push(`<span class="proc-tag" style="background:#f3e5f5;color:#6a1b9a;">🤝${s.relation.tier}</span>`);
                        return `
                        <div class="proc-rec-card" style="${isBest ? 'border:2px solid #4caf50;' : ''}margin-bottom:8px;">
                            <div class="proc-rec-head">
                                <div class="proc-rec-icon" style="font-size:20px;">${isBest ? '💎' : '🏭'}</div>
                                <div class="proc-rec-main">
                                    <div class="proc-rec-name">${escapeHtml(s.name)} ${tags.join('')}</div>
                                    <div class="proc-rec-sub">${s.grade}品 · 品质${s.quality} · 到货${s.deliveryDays}天 · 起订${s.minOrder}件</div>
                                </div>
                                <div class="proc-rec-margin" style="${isBest ? 'color:#2e7d32;font-weight:800;' : ''}">¥${s.effUnit.toFixed(2)}/件</div>
                            </div>
                            <div class="proc-rec-foot">
                                <div class="proc-rec-qty" style="font-size:12px;">
                                    ${s.supplyMul < 1 ? `原价 <span style="text-decoration:line-through;">¥${s.baseUnit.toFixed(2)}</span> → ` : ''}有效价 <b>¥${s.effUnit.toFixed(2)}</b>
                                </div>
                                <div style="display:flex;gap:6px;">
                                    <button class="btn btn-primary btn-small" onclick="ui.showPurchaseModal('${s.supplierId}', '${r.productId}')">在此进货</button>
                                </div>
                            </div>
                        </div>`;
                    }).join('')}
                </div>`;
            this.ui.showModal(`🔍 比价 · ${escapeHtml(r.productName)}`, content, `
                <button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>`, {
                modalId: 'procCompareModal', modalClass: 'proc-overlay'
            });
        },

        // ==================== Tab：商品进货 ====================
        _renderSupplyTab() {
            const state = this.gameState.state;
            let suppliers = [];
            let lockedSuppliers = [];
            try {
                const all = (typeof SUPPLIERS !== 'undefined') ? SUPPLIERS : [];
                const level = (state.shop && state.shop.level) || 1;
                suppliers = all.filter(s => s && s.unlockLevel <= level);
                lockedSuppliers = all.filter(s => s && s.unlockLevel > level);
            } catch (_) {}

            return `
                <div class="proc-hint">🏭 批发货源：品质与价格各有差异，进货后按「配送天数 + 商品采购周期」到货入仓
                    <div style="margin-top:6px;display:flex;gap:6px;">
                        <button class="btn btn-primary btn-small" onclick="procUI.switchTab('smart')">✨ 智能推荐采购清单</button>
                        <button class="btn btn-secondary btn-small" onclick="procUI.switchTab('orders')">📋 查看采购订单</button>
                    </div>
                </div>
                <div class="proc-supplier-list">
                    ${suppliers.map(s => `
                        <div class="proc-supplier-card">
                            <div class="proc-supplier-head">
                                <div class="proc-supplier-icon">🏭</div>
                                <div class="proc-supplier-main">
                                    <div class="proc-supplier-name">${escapeHtml(s.name)} <span class="proc-tag ok">Lv.${s.level}</span></div>
                                    <div class="proc-supplier-sub">品质 ${s.qualityBase}分 · 起订 ${s.minOrder}件 · 配送 ${s.deliveryDays}天 · 价格 ×${s.priceMultiplier}</div>
                                </div>
                            </div>
                            <button class="btn btn-primary btn-small btn-block" onclick="ui.showSupplierProducts('${s.id}')">查看全部商品 →</button>
                        </div>`).join('')}
                </div>
                ${lockedSuppliers.length ? `
                <div class="proc-section-title">🔒 待解锁批发商</div>
                <div class="proc-log-list">
                    ${lockedSuppliers.map(s => `
                        <div class="proc-log-item">
                            <span>🏭 ${escapeHtml(s.name)}</span>
                            <span style="color:#666;">需要店铺 Lv.${s.unlockLevel} 解锁</span>
                            <span class="proc-tag">🔒</span>
                        </div>`).join('')}
                </div>` : ''}`;
        },

        // ==================== Tab：采购订单 ====================
        _renderOrdersTab() {
            const state = this.gameState.state;
            const purchaseOrders = [...(state.purchaseOrders || [])].sort((a, b) => {
                const aTime = ((a.createTime && a.createTime.day - 1) * 24) + ((a.createTime && a.createTime.hour) || 0);
                const bTime = ((b.createTime && b.createTime.day - 1) * 24) + ((b.createTime && b.createTime.hour) || 0);
                return bTime - aTime;
            });

            if (!purchaseOrders.length) {
                return `
                    <div class="proc-empty">
                        <div class="proc-empty-icon">📋</div>
                        <div>暂无采购订单</div>
                        <button class="btn btn-primary" style="margin-top:12px;" onclick="procUI.goSupply()">去进货</button>
                    </div>`;
            }

            const statusMap = {
                pending: { name: '待发货', color: '#ff9800' },
                shipping: { name: '运输中', color: '#2196f3' },
                received: { name: '已入库', color: '#4caf50' }
            };
            const today = (state.gameTime && state.gameTime.day) || 1;
            // 列表小图走轻量版 SVG（无高斯模糊滤镜），真机重绘更快；无则回退完整版
            const imgFn = (this.ui && typeof this.ui.getProductImageLite === 'function')
                ? this.ui.getProductImageLite.bind(this.ui)
                : ((this.ui && typeof this.ui.getProductImage === 'function')
                    ? this.ui.getProductImage.bind(this.ui) : null);

            return `
                <div class="proc-list">
                    ${purchaseOrders.slice(0, 40).map(order => {
                        const status = statusMap[order.status] || { name: order.status, color: '#999' };
                        const remainDays = Math.max(0, (order.expectedArrivalDay || today) - today);
                        let etaText = '已入库';
                        if (order.status !== 'received') {
                            etaText = remainDays <= 0 ? '今日到货' : `还有${remainDays}天到货（第${order.expectedArrivalDay}天）`;
                        }
                        const srcTag = order.source === 'auto_plan' ? ' · 自动补货' : '';
                        const buyerTag = order.buyerName ? ` · 🛒 ${escapeHtml(order.buyerName)}采购` : '';
                        const img = imgFn ? imgFn(order.productId, order.qualityGrade) : '';
                        return `
                            <div class="proc-order-card">
                                <div class="proc-order-icon">${img ? `<img src="${img}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:10px;"
                                    onerror="this.style.display='none';this.parentElement.innerHTML='📦'">` : '📦'}</div>
                                <div class="proc-rec-main">
                                    <div class="proc-rec-name">${escapeHtml(order.productName || order.productId)}${srcTag}${buyerTag}</div>
                                    <div class="proc-rec-sub" style="color:${status.color};font-weight:700;">${status.name} · ${etaText}</div>
                                    <div class="proc-rec-sub">${escapeHtml((QUALITY_GRADES[order.qualityGrade] || {}).name || order.qualityGrade || '')} · ${Number(order.quantity || 0).toLocaleString('en-US')}件 · 第${order.expectedArrivalDay || '?'}天到</div>
                                </div>
                                <div style="text-align:right;flex-shrink:0;">
                                    <div style="font-size:14px;font-weight:800;color:#e65100;">${formatMoney(order.totalAmount || 0)}</div>
                                </div>
                            </div>`;
                    }).join('')}
                    ${purchaseOrders.length > 40 ? `<div class="proc-mat-more">……共 ${purchaseOrders.length} 单，仅显示最近 40 单</div>` : ''}
                </div>`;
        },

        // ==================== Tab：采购员 ====================
        _renderBuyersTab() {
            const s = this.procurementState.getBuyersSummary();
            const buyers = (s.buyers || []).slice(0, 30);
            return `
                <div class="proc-summary" style="padding:0 0 10px;">
                    <div class="proc-sum-card" style="background:linear-gradient(135deg,#667eea,#764ba2);">
                        <div class="proc-sum-value">${s.active}</div>
                        <div class="proc-sum-label">在职采购员</div>
                    </div>
                    <div class="proc-sum-card" style="background:linear-gradient(135deg,#4facfe,#00f2fe);">
                        <div class="proc-sum-value">${formatMoney(s.totalPurchased)}</div>
                        <div class="proc-sum-label">累计采购额</div>
                    </div>
                    <div class="proc-sum-card" style="background:linear-gradient(135deg,#43e97b,#38f9d7);">
                        <div class="proc-sum-value">${formatMoney(s.totalRebate)}</div>
                        <div class="proc-sum-label">累计提成(0.001%)</div>
                    </div>
                </div>
                <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
                    <button class="btn btn-primary btn-small" onclick="ui.closeModal();ui.showWarehouseModal('buyer')">打开采购员中心</button>
                    <button class="btn btn-secondary btn-small" onclick="procUI.openHireBuyer()">从员工招聘</button>
                </div>
                ${buyers.length === 0
                    ? `<div class="proc-empty"><div class="proc-empty-icon">🛒</div><div>暂无采购员。招聘后须先设置采购额度，才会自动补货</div></div>`
                    : `<div class="proc-list">
                        ${buyers.map(b => `
                            <div class="proc-buyer-card">
                                <div class="proc-rec-head">
                                    <div class="proc-rec-icon">🛒</div>
                                    <div class="proc-rec-main">
                                        <div class="proc-rec-name">${escapeHtml(b.name || '采购员')}
                                            ${b.status === 'active' ? '<span class="proc-tag ok">在职</span>' : '<span class="proc-tag muted">离岗</span>'}
                                        </div>
                                        <div class="proc-rec-sub">${escapeHtml(b.phone || '无联系方式')} · ${(parseFloat(b.purchaseQuotaPct)||0) > 0 ? ('资金 ' + (parseFloat(b.purchaseQuotaPct)) + '% 额度') : '未设置采购额度'}</div>
                                    </div>
                                    <div class="proc-rec-margin good">¥${formatMoney(b.totalPurchaseAmount || 0)}</div>
                                </div>
                                <div class="proc-rec-stats" style="margin-top:8px;">
                                    <div class="proc-rec-stat"><b>${b.purchaseOrderCount || 0}</b><span>关联采购单</span></div>
                                    <div class="proc-rec-stat"><b>¥${formatMoney(b.totalRebate || 0)}</b><span>累计提成</span></div>
                                </div>
                            </div>`).join('')}
                    </div>`}`;
        },

        openBuyerForm() {
            try {
                if (typeof whUI !== 'undefined' && whUI && typeof whUI.openBuyerForm === 'function') {
                    whUI.openBuyerForm();
                    return;
                }
            } catch (_) {}
            try { this.ui.showWarehouseModal('buyer'); } catch (_) {}
        },

        openBuyerManager() {
            try { this.ui.showWarehouseModal('buyer'); } catch (_) {}
        },

        openHireBuyer() {
            try {
                if (typeof empUI !== 'undefined' && empUI && typeof empUI.showMain === 'function') {
                    empUI.showMain('hire');
                    return;
                }
            } catch (_) {}
            try { this.ui.showHireEmployeeModal(); } catch (_) {}
        },

        // ==================== Tab：采购计划 ====================
        _renderPlansTab() {
            const s = this.procurementState.getPlansSummary();
            const plans = (s.plans || []).slice(0, 30);
            const freqLabel = { daily: '每日', weekly: '每周', monthly: '每月' };
            return `
                <div class="proc-summary" style="padding:0 0 10px;">
                    <div class="proc-sum-card" style="background:linear-gradient(135deg,#667eea,#764ba2);">
                        <div class="proc-sum-value">${s.total}</div>
                        <div class="proc-sum-label">计划总数</div>
                    </div>
                    <div class="proc-sum-card" style="background:linear-gradient(135deg,#4facfe,#00f2fe);">
                        <div class="proc-sum-value">${s.enabled}</div>
                        <div class="proc-sum-label">已启用</div>
                    </div>
                    <div class="proc-sum-card" style="background:linear-gradient(135deg,#43e97b,#38f9d7);">
                        <div class="proc-sum-value">${s.running}</div>
                        <div class="proc-sum-label">执行中</div>
                    </div>
                </div>
                <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
                    <button class="btn btn-primary btn-small" onclick="procUI.openPlanForm()">+ 新建采购计划</button>
                    <button class="btn btn-secondary btn-small" onclick="procUI.runDuePlans()">▶ 执行到期计划</button>
                    <button class="btn btn-secondary btn-small" onclick="procUI.openBuyerManager()">管理采购员</button>
                </div>
                ${plans.length === 0
                    ? `<div class="proc-empty"><div class="proc-empty-icon">🗓️</div><div>暂无采购计划。为采购员创建自动补货计划，防止断货</div></div>`
                    : `<div class="proc-list">
                        ${plans.map(p => `
                            <div class="proc-plan-card">
                                <div class="proc-rec-head">
                                    <div class="proc-rec-icon">🗓️</div>
                                    <div class="proc-rec-main">
                                        <div class="proc-rec-name">${escapeHtml(p.name || '未命名计划')}
                                            ${p.enabled !== false ? '<span class="proc-tag ok">启用</span>' : '<span class="proc-tag muted">停用</span>'}
                                        </div>
                                        <div class="proc-rec-sub">
                                            ${escapeHtml(p.buyerName || '未指派采购员')} · ${freqLabel[p.scheduleType] || p.scheduleType || '每日'}
                                            ${p.planMode === 'direct' ? '· 指定商品直采' : '· 在架自动补货'}
                                            ${p._running ? '<span class="proc-tag info">执行中</span>' : ''}
                                        </div>
                                    </div>
                                    <div style="display:flex;gap:6px;flex-direction:column;">
                                        <button class="btn btn-secondary btn-small" onclick="procUI.togglePlan('${p.id}')">${p.enabled !== false ? '停用' : '启用'}</button>
                                        <button class="btn btn-primary btn-small" onclick="procUI.runPlan('${p.id}')">立即执行</button>
                                    </div>
                                </div>
                            </div>`).join('')}
                    </div>`}`;
        },

        openPlanForm() {
            try {
                if (typeof whUI !== 'undefined' && whUI && typeof whUI.openPurchasePlanForm === 'function') {
                    whUI.openPurchasePlanForm();
                    return;
                }
            } catch (_) {}
            try { this.ui.showWarehouseModal('buyer'); } catch (_) {}
        },

        runDuePlans() {
            try {
                if (typeof whUI !== 'undefined' && whUI && typeof whUI.runDuePurchasePlansNow === 'function') {
                    whUI.runDuePurchasePlansNow();
                    return;
                }
            } catch (_) {}
            this.ui.showToast('暂无可用执行入口');
        },

        togglePlan(planId) {
            try {
                if (typeof whUI !== 'undefined' && whUI && typeof whUI.togglePlan === 'function') {
                    whUI.togglePlan(planId);
                    return;
                }
            } catch (_) {}
            this.ui.showToast('操作失败：仓储模块不可用');
        },

        runPlan(planId) {
            try {
                if (typeof whUI !== 'undefined' && whUI && typeof whUI.runPlanNow === 'function') {
                    whUI.runPlanNow(planId);
                    return;
                }
            } catch (_) {}
            this.ui.showToast('操作失败：仓储模块不可用');
        },

        // ==================== Tab：包装材料（3.6 极简：3 种核心材料） ====================
        _renderPackagingTab() {
            const s = this.procurementState.getPackagingSummary();
            const fmtQty = (v) => {
                const n = Number(v) || 0;
                return n >= 100 ? String(Math.round(n)) : (n >= 10 ? String(Math.round(n * 10) / 10) : String(Math.round(n * 100) / 100));
            };
            return `
                <div class="proc-hint">📦 3 种核心材料（纸箱/气泡膜/胶带）发货打包时自动消耗；库存不足会自动紧急采购（加价50%），建议提前备货</div>
                <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
                    <button class="btn btn-primary btn-small" onclick="procUI.openPackaging()">🛍️ 采购/管理包装材料</button>
                </div>
                ${s.lowCount > 0
                    ? `<div class="proc-warn">⚠️ 有 ${s.lowCount} 种材料低于预警线，建议尽快补货</div>` : ''}
                <div class="proc-section-title">📊 核心材料库存</div>
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
                    ${s.mats.map(m => {
                        const low = m.qty <= (m.threshold || 0);
                        return `
                        <div style="background:${low ? '#fff8f0' : '#fafafa'};border:1px solid ${low ? '#ffcc80' : '#ececec'};border-radius:10px;padding:10px 8px;text-align:center;">
                            <div style="font-size:22px;">${m.icon || '📦'}</div>
                            <div style="font-size:11px;font-weight:700;margin-top:4px;color:#555;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(m.name)}</div>
                            <div style="font-size:14px;font-weight:900;margin-top:2px;color:${low ? '#c62828' : '#2e7d32'};">${fmtQty(m.qty)}</div>
                            <div style="font-size:9px;color:#999;">${escapeHtml(m.unit || '')}${low ? ' · ⚠️不足' : ''}</div>
                        </div>`;
                    }).join('')}
                </div>
                <div style="margin-top:10px;font-size:11px;color:#999;text-align:center;">点击上方按钮进入完整管理（阶梯价采购 / 一键补货 / 出入库记录）</div>`;
        },

        openPackaging() {
            try { this.ui.showPackagingMaterialModal(); } catch (_) {}
        }
    };

    return procUI;
}

// 导出兼容（浏览器全局 + Node 测试）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { initProcurementUI };
}
