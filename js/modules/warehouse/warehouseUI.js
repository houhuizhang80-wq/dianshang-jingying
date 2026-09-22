/**
 * 仓储管理模块 - UI界面（简约版）
 * 核心功能：概览、库存（含预警）、出入库
 * 采购员 / 包装材料：由「我的」九宫格独立入口打开，不再作为仓储内 Tab
 */
class WarehouseUI {
    constructor(warehouseState, gameState, uiManager) {
        this.whState = warehouseState;
        this.gameState = gameState;
        this.ui = uiManager;
        this.currentTab = 'overview';
        this.currentSubTab = 'inbound'; // 出入库页面的子Tab
    }

    _isBuyerMode() {
        return this.currentTab === 'buyer' || this.currentTab === 'buyers';
    }

    _modalTitle() {
        return this._isBuyerMode() ? '🛒 采购员' : '🏭 仓储管理中心';
    }

    // 显示仓储管理主界面（采购员入口在「我的」九宫格，不再作为仓储 Tab）
    show() {
        let content;
        try {
            content = this.renderMain();
        } catch (e) {
            console.error('[WarehouseUI.show] render failed, fallback overview', e);
            if (!this._isBuyerMode()) {
                this.currentTab = 'overview';
                this.buyerCurrentSubTab = 'info';
            } else if (!this.buyerCurrentSubTab) {
                this.buyerCurrentSubTab = 'info';
            }
            try {
                content = this.renderMain();
            } catch (e2) {
                console.error('[WarehouseUI.show] overview also failed', e2);
                content = `<div style="padding:24px;color:#c62828;">仓储界面渲染失败，请刷新页面后重试。<br><small>${String(e2 && e2.message || e2)}</small></div>`;
            }
        }
        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>
        `;
        const isBuyer = this._isBuyerMode();
        this.ui.showModal(this._modalTitle(), content, footer, {
            noBodyPadding: true, width: isBuyer ? '880px' : '820px',
            modalId: isBuyer ? 'buyerCenterModal' : 'warehouseCenterModal'
        });
    }

    /** 当前在架 SKU 数量（兼容旧档缺 status） */
    _countActiveListedSkus() {
        try {
            if (this.whState && typeof this.whState._getActiveListedProductIds === 'function') {
                return this.whState._getActiveListedProductIds().length;
            }
            const listings = (this.gameState?.state?.listings) || [];
            return new Set(listings.filter(l => {
                if (!l || !l.productId) return false;
                if (l.paused === true) return false;
                if (l.status && l.status !== 'active') return false;
                return true;
            }).map(l => l.productId)).size;
        } catch (_) { return 0; }
    }

    /** 计划目标商品数量文案（兼容新旧计划格式：新格式无 items） */
    _planSkuCount(p) {
        if (!p) return 0;
        if (p.planMode === 'direct' && Array.isArray(p.directItems) && p.directItems.length) return p.directItems.length;
        if (Array.isArray(p.targetProductIds) && p.targetProductIds.length) return p.targetProductIds.length;
        if (Array.isArray(p.items) && p.items.length) return p.items.length;
        if (p._targetScope === 'all' || (p.scheduleType && (!p.targetProductIds || !p.targetProductIds.length))) {
            return this._countActiveListedSkus();
        }
        return 0;
    }

    _planSkuHint(p) {
        if (!p) return '0种';
        if (p.planMode === 'direct') {
            const n = Array.isArray(p.directItems) ? p.directItems.length : 0;
            return n > 0 ? `直采${n}种` : '直采';
        }
        if (Array.isArray(p.targetProductIds) && p.targetProductIds.length) {
            return `${p.targetProductIds.length}种`;
        }
        if (Array.isArray(p.items) && p.items.length) return `${p.items.length}种`;
        if (p._targetScope === 'all' || (p.scheduleType && (!p.targetProductIds || !p.targetProductIds.length))) {
            const n = this._countActiveListedSkus();
            return n > 0 ? `全部在架(${n})` : '全部在架';
        }
        return '0种';
    }

    /** 预览某计划当前会补多少（用于卡片展示） */
    _previewPlanRestock(p) {
        try {
            if (!p || !this.whState || typeof this.whState._buildSchedulePlanItems !== 'function') return null;
            const built = this.whState._buildSchedulePlanItems(p);
            if (Array.isArray(built)) {
                return { items: built, needSkuCount: built.length, listedCount: this._countActiveListedSkus() };
            }
            return built;
        } catch (_) { return null; }
    }

    /** 补货计划挂到真实在职采购员，避免名单与下方计划对不上 */
    _healPlanBuyerLinks() {
        const buyers = (this.whState && this.whState.getBuyers) ? (this.whState.getBuyers() || []) : [];
        const active = buyers.filter(b => b && b.status === 'active');
        const raw = (this.whState && this.whState.state && this.whState.state.purchasePlans) || [];
        raw.forEach(p => {
            if (!p) return;
            const b = buyers.find(x => x && x.id === p.buyerId);
            const use = (b && b.status === 'active') ? b : (active[0] || b || null);
            if (!use) return;
            if (p.buyerId !== use.id) p.buyerId = use.id;
            if (p.buyerName !== use.name) p.buyerName = use.name;
        });
    }

    // 切换Tab
    switchTab(tab) {
        this.currentTab = tab;
        this.refresh();
    }

    // 切换子Tab（出入库页面使用）
    switchSubTab(subTab) {
        this.currentSubTab = subTab;
        this.refresh();
    }

    // 刷新界面（定位仓储/采购员主弹窗，避免误刷上层嵌套弹窗）
    refresh() {
        const title = this._modalTitle();
        const titles = [title, '🏭 仓储管理中心', '🛒 采购员'];
        let modal = null;
        try {
            if (this.ui && typeof this.ui._findModalOverlay === 'function') {
                for (const t of titles) {
                    modal = this.ui._findModalOverlay(t);
                    if (modal) break;
                }
            }
        } catch (_) {}
        if (!modal) {
            const overlays = document.querySelectorAll('.modal-overlay');
            for (let i = overlays.length - 1; i >= 0; i--) {
                const mt = overlays[i].dataset && overlays[i].dataset.modalTitle;
                if (mt && titles.indexOf(mt) >= 0) {
                    modal = overlays[i];
                    break;
                }
            }
        }
        // 兼容：只有一层时仍可刷新
        if (!modal) modal = document.querySelector('.modal-overlay:last-child');
        if (!modal) return;
        const body = modal.querySelector('.modal-body');
        if (!body) return;
        try {
            body.innerHTML = this.renderMain();
        } catch (e) {
            console.error('[WarehouseUI.refresh] render failed', e);
            // 采购员页出错时保留 buyers，勿强行打回 overview
            const keepBuyers = this.currentTab === 'buyer' || this.currentTab === 'buyers';
            if (!keepBuyers) {
                this.currentTab = 'overview';
                this.buyerCurrentSubTab = 'info';
            } else if (!this.buyerCurrentSubTab) {
                this.buyerCurrentSubTab = 'info';
            }
            try {
                if (keepBuyers) {
                    body.innerHTML = `
                        <div style="padding:16px;margin:8px;background:#ffebee;border-radius:10px;color:#c62828;font-size:13px;">
                            采购员页面渲染异常：${String(e && e.message || e)}
                            <div style="margin-top:10px;">
                                <button class="btn btn-secondary btn-sm" onclick="whUI.buyerCurrentSubTab='info';whUI.refresh();">回到人员列表</button>
                            </div>
                        </div>
                        ${(() => { try { return this.renderBuyers(); } catch (_) { return ''; } })()}
                    `;
                } else {
                    body.innerHTML = this.renderMain();
                }
            } catch (e2) {
                body.innerHTML = `<div style="padding:24px;color:#c62828;">界面刷新失败：${String(e2 && e2.message || e2)}</div>`;
            }
        }
    }

    // 渲染主界面
    renderMain() {
        // 九宫格「采购员」独立入口：不展示仓储 Tab
        if (this._isBuyerMode()) {
            return `
                <div class="wh-container">
                    <div class="wh-content">
                        ${this.renderBuyers()}
                    </div>
                </div>
            `;
        }
        return `
            <div class="wh-container">
                <!-- 顶部状态栏 -->
                <div class="wh-header-simple">
                    <div class="wh-header-left">
                        <div class="wh-level-simple">
                            <span class="wh-level-icon">🏭</span>
                            <div>
                                <div class="wh-level-name">${this.whState.getLevelInfo().name} (Lv.${this.whState.state.level})</div>
                                <div class="wh-level-sub">${this.whState.getUsedCapacity()} / ${this.whState.getCapacity()} 件 · ${this.whState.getUsagePercent().toFixed(1)}%</div>
                            </div>
                        </div>
                    </div>
                    <div class="wh-header-right">
                        <div class="wh-header-stat">
                            <div class="wh-header-val">${this.formatMoney(this.whState.getStatistics(30).inventoryValue)}</div>
                            <div class="wh-header-lab">库存货值</div>
                        </div>
                        <button class="btn btn-secondary btn-sm" onclick="whUI.upgradeSecurity()">
                            ${this._securityIcon()} 安防 Lv.${this.whState.getSecurityInfo().current.level}
                        </button>
                        <button class="btn btn-primary btn-sm" onclick="whUI.upgradeWarehouse()">
                            ⬆️ 升级仓库
                        </button>
                    </div>
                </div>

                <!-- 容量进度条 -->
                <div class="wh-capacity-wrap">
                    <div class="wh-capacity-bar">
                        <div class="wh-capacity-fill" style="width:${this.whState.getUsagePercent()}%;background:${this.whState.getUsagePercent() > 90 ? '#f44336' : this.whState.getUsagePercent() > 70 ? '#ff9800' : '#4caf50'}"></div>
                    </div>
                </div>

                <!-- Tab导航 -->
                <div class="wh-tabs-simple">
                    ${this.renderTabs()}
                </div>

                <!-- Tab内容区 -->
                <div class="wh-content">
                    ${this.renderTabContent()}
                </div>
            </div>
        `;
    }

    // 渲染Tab按钮（仓储 3 个核心 Tab；采购员/包材已移至「我的」九宫格）
    renderTabs() {
        const tabs = [
            { id: 'overview',  name: '概览',   icon: '📊' },
            { id: 'inventory', name: '库存',   icon: '📦' },
            { id: 'flow',      name: '出入库', icon: '🔄' }
        ];

        return tabs.map(tab => `
            <button class="wh-tab-btn ${this.currentTab === tab.id ? 'active' : ''}"
                    onclick="whUI.switchTab('${tab.id}')">
                <span class="wh-tab-icon">${tab.icon}</span>
                <span class="wh-tab-name">${tab.name}</span>
            </button>
        `).join('');
    }

    // 渲染Tab内容
    renderTabContent() {
        switch (this.currentTab) {
            case 'overview':  return this.renderOverview();
            case 'inventory': return this.renderInventory();
            case 'flow':      return this.renderFlow();
            case 'buyer':     return this.renderBuyers();
            default: return this.renderOverview();
        }
    }

    // ==================== 概览页（简约版）====================
    renderOverview() {
        const stats = this.whState.getStatistics(30);
        const levelInfo = this.whState.getLevelInfo();
        // 仓储费 = 每月固定月租 + 在仓商品每日占用费
        const usedQty = this.whState.getUsedCapacity();
        // 计费件数（含 _fallback 兜底库存）：与扣费用的是同一个口径
        const billableQty = (typeof this.whState.getBillableQuantity === 'function')
            ? (Number(this.whState.getBillableQuantity()) || 0)
            : usedQty;
        const WD = (typeof WarehouseData !== 'undefined') ? WarehouseData : null;
        // 仓库城市每日房租（搬仓页「房租 ¥X/日」那条城市特性，现已真实计费）
        const cityRent = (typeof this.whState.getCityRentPerDay === 'function')
            ? (Number(this.whState.getCityRentPerDay()) || 0)
            : 0;
        const rentDetail = (WD && typeof WD.calcOccupancyFee === 'function' && typeof WD.getLevelRentInfo === 'function')
            ? (() => {
                const level = this.whState.state.level;
                const occ = WD.calcOccupancyFee(level, billableQty);
                const rent = WD.getLevelRentInfo(level);
                // 新手扶持：前 7 天免在仓占用费（与 warehouseEngine/gameEngine 扣费口径一致）
                const dayNow = Number(this.gameState?.state?.gameTime?.day) || 1;
                const waived = dayNow <= 7 && occ.occupied > 0;
                const occupied = waived ? 0 : occ.occupied;
                return {
                    monthlyRent: rent.monthlyRent,
                    rate: occ.rate,
                    used: occ.used,
                    occupied: occupied,
                    newbieWaived: waived,
                    cityRent: cityRent,
                    total: Math.round((occupied + cityRent) * 100) / 100
                };
            })()
            : {
                monthlyRent: Number(levelInfo.monthlyRent) || 0,
                rate: Number(levelInfo.unitStorageCost) || 0.2,
                used: billableQty,
                occupied: 0,
                cityRent: cityRent,
                total: cityRent
            };
        // 月租结算节奏：每 30 个游戏日一期，与发薪同日（第31/61/91…天）
        const curDay = Number(this.gameState?.state?.gameTime?.day) || 1;
        const monthDays = (WD && Number(WD.MONTH_DAYS) > 0) ? Number(WD.MONTH_DAYS) : 30;
        const nextRentDay = (Math.floor((curDay - 1) / monthDays) + 1) * monthDays + 1;
        // 金额显示：千分位，最多 2 位小数（租金要精确到玩家能对上账）
        const fmtMoney = (n) => Number(Number(n || 0).toFixed(2)).toLocaleString();

        return `
            <div class="wh-overview-simple">
                <!-- 核心数据卡片 -->
                <div class="wh-stats-grid-simple">
                    <div class="wh-stat-card-simple" style="border-left:4px solid #2196f3">
                        <div class="wh-stat-num">${this.whState.getUsedCapacity()}</div>
                        <div class="wh-stat-desc">📦 库存件数</div>
                    </div>
                    <div class="wh-stat-card-simple" style="border-left:4px solid #4caf50">
                        <div class="wh-stat-num">${this.formatMoney(stats.inventoryValue)}</div>
                        <div class="wh-stat-desc">💰 库存货值</div>
                    </div>
                    <div class="wh-stat-card-simple" style="border-left:4px solid #ff9800">
                        <div class="wh-stat-num">${stats.turnoverRate}</div>
                        <div class="wh-stat-desc">🔄 周转率</div>
                    </div>
                </div>

                <!-- 快捷操作 -->
                <div class="wh-card-simple">
                    <div class="wh-card-title">⚡ 快捷操作</div>
                    <div class="wh-quick-actions-simple">
                        <button class="wh-action-btn-simple" onclick="whUI.showPurchaseForm()">
                            <span>📥</span>
                            <div>
                                <div class="wh-action-name">采购入库</div>
                                <div class="wh-action-desc">从市场采购商品入库</div>
                            </div>
                        </button>
                        <button class="wh-action-btn-simple" onclick="whUI.switchTab('inventory')">
                            <span>📦</span>
                            <div>
                                <div class="wh-action-name">查看库存</div>
                                <div class="wh-action-desc">浏览当前库存商品</div>
                            </div>
                        </button>
                        <button class="wh-action-btn-simple" onclick="whUI.switchTab('flow')">
                            <span>🔄</span>
                            <div>
                                <div class="wh-action-name">出入库记录</div>
                                <div class="wh-action-desc">查看历史出入库明细</div>
                            </div>
                        </button>
                    </div>
                </div>

                <!-- 仓库信息 -->
                <div class="wh-card-simple">
                    <div class="wh-card-title">🏭 仓库信息</div>
                    <div class="wh-info-grid">
                        <div class="wh-info-item">
                            <span class="wh-info-lab">仓库等级</span>
                            <span class="wh-info-val">Lv.${this.whState.state.level} · ${levelInfo.name}</span>
                        </div>
                        <div class="wh-info-item">
                            <span class="wh-info-lab">容量上限</span>
                            <span class="wh-info-val">${this.whState.getCapacity()} 件</span>
                        </div>
                        <div class="wh-info-item">
                            <span class="wh-info-lab">月租（固定）</span>
                            <span class="wh-info-val">¥${fmtMoney(rentDetail.monthlyRent)}/月</span>
                        </div>
                        <div class="wh-info-item">
                            <span class="wh-info-lab">在仓占用费</span>
                            <span class="wh-info-val">¥${rentDetail.rate}/件/日</span>
                        </div>
                        ${rentDetail.cityRent > 0 ? `<div class="wh-info-item">
                            <span class="wh-info-lab">城市房租</span>
                            <span class="wh-info-val">¥${fmtMoney(rentDetail.cityRent)}/日</span>
                        </div>` : ''}
                        <div class="wh-info-item">
                            <span class="wh-info-lab">今日仓储费</span>
                            <span class="wh-info-val">¥${fmtMoney(rentDetail.total)}<span style="font-size:11px;color:#888;">（${rentDetail.cityRent > 0 ? `占用${fmtMoney(rentDetail.occupied)} + 城市${fmtMoney(rentDetail.cityRent)}` : `${fmtMoney(rentDetail.used)}件×${rentDetail.rate}`}）</span>${rentDetail.newbieWaived ? `<br><span style="font-size:11px;color:#2e7d32;">🎁 新手扶持：前 7 天免占用费</span>` : ''}${billableQty !== usedQty ? `<br><span style="font-size:11px;color:#e65100;">含仓容外兜底 ${fmtMoney(Math.max(0, billableQty - usedQty))} 件</span>` : ''}</span>
                        </div>
                        <div class="wh-info-item">
                            <span class="wh-info-lab">下次月租结算</span>
                            <span class="wh-info-val">第${nextRentDay}天<span style="font-size:11px;color:#888;">（${Math.max(0, nextRentDay - curDay)}天后）</span></span>
                        </div>
                        <div class="wh-info-item">
                            <span class="wh-info-lab">缴费状态</span>
                            <span class="wh-info-val">${(() => {
                                const wh = (this.gameState && this.gameState.state && this.gameState.state.warehouse) || {};
                                const unpaid = Number(wh.unpaidRent) || 0;
                                const last = Number(wh.lastRentPaid) || 0;
                                const day = this.gameState?.state?.gameTime?.day;
                                const monthPaid = Number(wh.lastMonthRentPaid) || 0;
                                const monthDay = Number(wh.lastMonthRentDay) || 0;
                                if (unpaid > 0) return '<span style="color:#c62828;">欠租 ¥' + fmtMoney(unpaid) + '</span>';
                                const parts = [];
                                if (wh.lastRentDay === day && last > 0) parts.push('今日占用费 ¥' + fmtMoney(last));
                                if (monthPaid > 0) parts.push('月租已缴 ¥' + fmtMoney(monthPaid) + (monthDay > 0 ? '（第' + monthDay + '天）' : ''));
                                if (parts.length) return '<span style="color:#2e7d32;">' + parts.join(' · ') + '</span>';
                                return '待跨日结算';
                            })()}</span>
                        </div>
                        <div class="wh-info-item">
                            <span class="wh-info-lab">库存商品种类</span>
                            <span class="wh-info-val">${stats.inventoryCount} 种</span>
                        </div>
                        <div class="wh-info-item">
                            <span class="wh-info-lab">仓库城市</span>
                            <span class="wh-info-val">${(() => {
                                try {
                                    const cid = this.gameState?.state?.warehouse?.city
                                        || this.gameState?.state?.shop?.city || 'yiwu';
                                    const c = (typeof getCityById === 'function') ? getCityById(cid) : null;
                                    return (c && c.name) || cid;
                                } catch (_) { return '-'; }
                            })()}</span>
                        </div>
                    </div>
                    <div style="margin-top:8px;font-size:11px;color:#888;">搬仓请到「我的 → 城市地图」</div>
                </div>

                <!-- 30天出入库摘要 -->
                <div class="wh-card-simple">
                    <div class="wh-card-title">📊 30天摘要</div>
                    <div class="wh-summary-row">
                        <div class="wh-summary-item">
                            <div class="wh-summary-label">入库</div>
                            <div class="wh-summary-value in">📥 ${stats.totalInbound} 件 / ${this.formatMoney(stats.totalInboundValue)}</div>
                        </div>
                        <div class="wh-summary-divider"></div>
                        <div class="wh-summary-item">
                            <div class="wh-summary-label">出库</div>
                            <div class="wh-summary-value out">📤 ${stats.totalOutbound} 件 / ${this.formatMoney(stats.totalOutboundValue)}</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // ==================== 库存页（合并预警）====================
    renderInventory() {
        const inventory = this.whState.getInventoryList();
        const abcAnalysis = this.whState.getStatistics(30).abcAnalysis || { A: [], B: [], C: [] };
        const aIds = new Set((abcAnalysis.A || []).map(i => i && i.productId).filter(Boolean));
        const bIds = new Set((abcAnalysis.B || []).map(i => i && i.productId).filter(Boolean));
        this._invAbcFilter = this._invAbcFilter || 'all';

        return `
            <div class="wh-inventory-page-simple">
                <!-- 库存列表 -->
                <div class="wh-card-simple">
                    <div class="wh-card-header-simple">
                        <div class="wh-card-title">📦 库存列表 (<span id="wh_inv_count">${inventory.length}</span>种商品)</div>
                        <div class="wh-filter-group-simple">
                            <button class="wh-filter-btn-simple active" data-abc="all" onclick="whUI.filterInventory('all', event)">全部</button>
                            <button class="wh-filter-btn-simple" data-abc="A" onclick="whUI.filterInventory('A', event)">A类</button>
                            <button class="wh-filter-btn-simple" data-abc="B" onclick="whUI.filterInventory('B', event)">B类</button>
                            <button class="wh-filter-btn-simple" data-abc="C" onclick="whUI.filterInventory('C', event)">C类</button>
                        </div>
                    </div>
                    <div class="wh-table-container">
                        <table class="wh-table-simple">
                            <thead>
                                <tr>
                                    <th>商品</th>
                                    <th>数量</th>
                                    <th>均成本</th>
                                    <th>货值</th>
                                </tr>
                            </thead>
                            <tbody id="wh_inv_tbody">
                                ${inventory.map(item => {
                                    const pid = item.productId;
                                    const abcClass = aIds.has(pid) ? 'A' : bIds.has(pid) ? 'B' : 'C';
                                    const abcColor = abcClass === 'A' ? '#f44336' : abcClass === 'B' ? '#ff9800' : '#4caf50';
                                    const cap = this.whState.getCapacity();
                                    const minStock = Math.max(10, Math.floor(cap * 0.005));
                                    const isLow = item.totalQuantity <= minStock;
                                    return `
                                        <tr class="${isLow ? 'wh-row-warning' : ''}" data-abc="${abcClass}">
                                            <td>
                                                <span class="wh-abc-badge-simple" style="background:${abcColor}">${abcClass}</span>
                                                <span>${item.productName}</span>
                                            </td>
                                            <td class="${isLow ? 'wh-text-warning' : ''}">${item.totalQuantity}${isLow ? ' ⚠️' : ''}</td>
                                            <td>¥${item.avgCost.toFixed(2)}</td>
                                            <td>${this.formatMoney(item.totalValue)}</td>
                                        </tr>
                                    `;
                                }).join('') || '<tr><td colspan="4" class="wh-empty-simple">暂无库存商品</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }

    // ==================== 出入库页（合并入库+出库）====================
    renderFlow() {
        const inboundOrders = (Array.isArray(this.whState.state.inboundOrders) ? this.whState.state.inboundOrders : []).slice(0, 30);
        const outboundOrders = (Array.isArray(this.whState.state.outboundOrders) ? this.whState.state.outboundOrders : []).slice(0, 30);
        const isInbound = this.currentSubTab === 'inbound';
        const list = isInbound ? inboundOrders : outboundOrders;
        const count = isInbound ? inboundOrders.length : outboundOrders.length;

        return `
            <div class="wh-flow-page">
                <!-- 子Tab切换 -->
                <div class="wh-sub-tabs">
                    <button class="wh-sub-tab-btn ${this.currentSubTab === 'inbound' ? 'active' : ''}"
                            onclick="whUI.switchSubTab('inbound')">
                        📥 入库记录 (${inboundOrders.length})
                    </button>
                    <button class="wh-sub-tab-btn ${this.currentSubTab === 'outbound' ? 'active' : ''}"
                            onclick="whUI.switchSubTab('outbound')">
                        📤 出库记录 (${outboundOrders.length})
                    </button>
                    <div style="margin-left:auto">
                        ${isInbound ? `<button class="btn btn-primary btn-sm" onclick="whUI.showPurchaseForm()">+ 新增入库</button>` : ''}
                    </div>
                </div>

                <!-- 列表 -->
                <div class="wh-card-simple" style="margin-top:0;border-radius:0 0 8px 8px">
                    <div class="wh-table-container">
                        <table class="wh-table-simple">
                            <thead>
                                <tr>
                                    <th>类型</th>
                                    <th>${isInbound ? '商品数' : '订单号'}</th>
                                    <th>数量</th>
                                    <th>金额</th>
                                    <th>日期</th>
                                    ${isInbound ? '<th>备注</th>' : ''}
                                </tr>
                            </thead>
                            <tbody>
                                ${list.map(order => `
                                    <tr>
                                        <td><span class="wh-type-badge-simple" style="background:${order.typeInfo?.color || (isInbound ? '#4caf50' : '#2196f3')}15;color:${order.typeInfo?.color || (isInbound ? '#4caf50' : '#2196f3')}">
                                            ${order.typeInfo?.icon || (isInbound ? '📥' : '📤')} ${order.typeInfo?.name || (isInbound ? '入库' : '出库')}
                                        </span></td>
                                        <td>${isInbound ? ((order.items && order.items.length) || 0) : (order.id ? String(order.id).substr(-8) : '-')}</td>
                                        <td>${order.totalQty}</td>
                                        <td class="${isInbound ? 'wh-text-red' : 'wh-text-green'}">${this.formatMoney(order.totalValue)}</td>
                                        <td>第${order.day}天</td>
                                        ${isInbound ? `<td>${order.remark || '-'}</td>` : ''}
                                    </tr>
                                `).join('') || `<tr><td colspan="${isInbound ? 6 : 5}" class="wh-empty-simple">暂无${isInbound ? '入库' : '出库'}记录</td></tr>`}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }

    // ==================== 操作方法 ====================
    // 仓库安防升级（深化）
    _securityIcon() {
        try { return this.whState.getSecurityInfo().current.icon || '🔒'; } catch (_) { return '🔒'; }
    }

    upgradeSecurity() {
        const info = this.whState.getSecurityInfo();
        if (!info.next) {
            this.ui.showToast('已达顶级安防（零损耗）', 'success');
            return;
        }
        const cost = Number(info.next.cost) || 0;
        const content = `
            <div style="padding:8px 2px;font-size:13px;">
                <div style="font-size:12px;color:#666;line-height:1.7;margin-bottom:12px;">
                    当前：${info.current.icon} ${info.current.name}（${info.current.desc}）<br>
                    升级到：${info.next.icon} <b>${info.next.name}</b>（${info.next.desc}）<br>
                    费用：<b>¥${cost.toLocaleString()}</b>
                </div>
                <div style="font-size:11px;color:#999;">库存货值越高，降低损耗率省下的钱越多。</div>
            </div>`;
        this.ui.showModal('🔒 升级仓库安防', content, `
            <button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>
            <button class="btn btn-primary" onclick="whUI.confirmUpgradeSecurity()">确认升级</button>`, { modalId: 'whSecurityModal' });
    }

    confirmUpgradeSecurity() {
        this.ui.closeModal();
        const result = this.whState.upgradeSecurity();
        this.ui.showToast(result.message, result.success ? 'success' : 'error');
        if (result.success) this.refresh();
    }

    upgradeWarehouse() {
        const check = this.whState.canUpgrade();
        if (!check.can) {
            this.ui.showToast(check.reason + (check.cost ? '（需 ¥' + Number(check.cost).toLocaleString() + '）' : ''), 'warning');
            return;
        }

        const result = this.whState.upgrade();
        this.ui.showToast(result.message, result.success ? 'success' : 'error');
        if (result.success) {
            this.refresh();
            // 升级成功"跟着跳动"：给等级、容量、头部加弹跳动画，让用户感知到升级生效
            const modal = document.querySelector('.modal-overlay:last-child');
            if (modal) {
                const header = modal.querySelector('.wh-header-simple');
                const capacity = modal.querySelector('.wh-capacity-wrap');
                const levelInfo = modal.querySelector('.wh-level-simple');
                [header, capacity, levelInfo].forEach(el => {
                    if (!el) return;
                    el.style.transition = 'transform 0.3s cubic-bezier(.34,1.56,.64,1)';
                    el.style.transform = 'scale(1.04)';
                    setTimeout(() => { if (el) el.style.transform = 'scale(1)'; }, 300);
                });
                // 容量条额外加脉冲闪烁效果
                setTimeout(() => {
                    const fill = modal.querySelector('.wh-capacity-fill');
                    if (fill) fill.classList.add('wh-pulse-fill');
                    setTimeout(() => fill && fill.classList.remove('wh-pulse-fill'), 700);
                }, 50);
            }
        }
    }

    showPurchaseForm() {
        const products = typeof getAllProducts === 'function' ? getAllProducts().slice(0, 15) : [];
        const productOptions = products.map(p => `<option value="${p.id}" data-cost="${p.basePrice}">${p.name} (成本¥${p.basePrice})</option>`).join('');
        // 采购员下拉（仅在职状态）
        const activeBuyers = this.whState.getBuyers({ status: 'active' });
        const buyerOptions = `
            <option value="">—— 请选择采购员（可选）——</option>
            ${activeBuyers.map(b => `<option value="${b.id}">${b.statusIcon} ${b.departmentIcon} ${b.name} · ${b.departmentName}（提成0.001%）</option>`).join('')}
        `;

        const content = `
            <div class="wh-form">
                <div class="wh-form-group">
                    <label>选择商品</label>
                    <select id="wh_in_product" class="wh-input" onchange="whUI._syncPurchaseCost()">
                        ${productOptions || '<option value="">请先在批发市场采购</option>'}
                    </select>
                </div>
                <div class="wh-form-group">
                    <label>入库数量</label>
                    <input type="number" id="wh_in_qty" class="wh-input" value="10" min="1" oninput="whUI._updatePurchasePreview()">
                </div>
                <div class="wh-form-group">
                    <label>成本单价</label>
                    <input type="number" id="wh_in_cost" class="wh-input" value="10" min="0" step="0.01" oninput="whUI._updatePurchasePreview()">
                </div>
                <div class="wh-form-group">
                    <label>🎯 负责采购员（触发提成计算）</label>
                    <select id="wh_in_buyer" class="wh-input" onchange="whUI._updatePurchasePreview()">
                        ${activeBuyers.length === 0 ? '<option value="">—— 暂无在职采购员，请先在「我的」九宫格「采购员」添加 ——</option>' : buyerOptions}
                    </select>
                </div>
                <!-- 采购金额 + 回扣预览卡片（需求b/c 自动展示） -->
                <div id="wh_in_preview" style="padding:12px 14px;border-radius:10px;background:linear-gradient(135deg,#fff9e6,#fff3cd);border:1px solid #ffe082;margin-top:6px;display:none;">
                    <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                        <span style="color:#666;font-size:12px;">📦 采购总金额</span>
                        <span id="wh_in_total" style="font-weight:800;">¥0.00</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;">
                        <span style="color:#666;font-size:12px;">💰 预计提成（采购金额 × 0.001%，2位小数）</span>
                        <span id="wh_in_rebate" style="font-weight:800;color:#d84315;">¥0.00</span>
                    </div>
                </div>
            </div>
            <script>
                setTimeout(function(){ whUI._syncPurchaseCost(); }, 30);
            </script>
        `;
        this.ui.showModal('📥 采购入库', content, `
            <button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>
            <button class="btn btn-primary" onclick="whUI.doInbound()">确认入库</button>
        `);
    }

    // 辅助：商品选择变更时自动填充成本价
    _syncPurchaseCost() {
        try {
            const sel = document.getElementById('wh_in_product');
            const costEl = document.getElementById('wh_in_cost');
            if (sel && costEl && sel.selectedOptions && sel.selectedOptions[0]) {
                const ds = sel.selectedOptions[0].getAttribute('data-cost');
                if (ds) costEl.value = ds;
            }
        } catch(e) {}
        this._updatePurchasePreview();
    }

    // 辅助：实时更新采购金额 + 回扣预览
    _updatePurchasePreview() {
        try {
            const qty = parseInt(document.getElementById('wh_in_qty')?.value) || 0;
            const cost = parseFloat(document.getElementById('wh_in_cost')?.value) || 0;
            const buyerSel = document.getElementById('wh_in_buyer');
            const preview = document.getElementById('wh_in_preview');
            const totalEl = document.getElementById('wh_in_total');
            const rebateEl = document.getElementById('wh_in_rebate');
            if (!preview || !totalEl || !rebateEl) return;

            const totalAmt = Math.max(0, qty * cost);
            let rebateAmt = 0;
            const hasBuyer = buyerSel && buyerSel.value;
            if (hasBuyer) {
                // 提成 = 采购金额 × 0.001%
                rebateAmt = (typeof WarehouseData !== 'undefined' ? WarehouseData.calcRebate(totalAmt, WarehouseData.buyerRebateConfig.defaultRebateRate) : 0);
            }
            preview.style.display = (qty > 0 && cost > 0) ? 'block' : 'none';
            totalEl.textContent = '¥' + totalAmt.toFixed(2);
            rebateEl.textContent = '¥' + rebateAmt.toFixed(2) + (hasBuyer ? '' : '（选择采购员后计算）');
        } catch(e) {}
    }

    doInbound() {
        const productId = document.getElementById('wh_in_product')?.value;
        const qty = parseInt(document.getElementById('wh_in_qty')?.value) || 0;
        const cost = parseFloat(document.getElementById('wh_in_cost')?.value) || 0;
        const buyerId = document.getElementById('wh_in_buyer')?.value || null;

        if (!productId) { this.ui.showToast('请选择商品', 'error'); return; }
        if (qty <= 0)    { this.ui.showToast('数量必须大于0', 'error'); return; }
        if (!(cost > 0)) { this.ui.showToast('采购单价必须大于0，不能免费入库', 'error'); return; }

        const funds = this.whState.gameState?.state?.shop?.funds;
        const totalAmt = Math.round(qty * cost * 100) / 100;
        if (typeof funds === 'number' && typeof this.whState.gameState.spendFunds === 'function') {
            // 仅作前置提示；真正扣款在 purchaseIn / createInboundOrder
            const maxDebt = (typeof SHOP_CONFIG !== 'undefined' && SHOP_CONFIG.maxDebt != null)
                ? SHOP_CONFIG.maxDebt : -100000;
            if (funds - totalAmt < maxDebt) {
                this.ui.showToast('资金不足，无法采购入库', 'error');
                return;
            }
        }

        const result = this.whState.purchaseIn(productId, qty, cost, null, 'B', { buyerId });
        // 需求f：成功/失败反馈
        let extraMsg = '';
        if (result.success && buyerId && result.order && result.order.rebateTotal) {
            extraMsg = ` · 提成 ¥${result.order.rebateTotal.toFixed(2)}（0.001%）已累计`;
        }
        this.ui.showToast(result.message + extraMsg, result.success ? 'success' : 'error');
        if (result.success) {
            this.ui.closeModal();
            this.refresh();
        }
    }

    filterInventory(abcClass, ev) {
        const cls = abcClass || 'all';
        this._invAbcFilter = cls;
        try {
            document.querySelectorAll('.wh-filter-btn-simple').forEach(b => {
                const active = (b.getAttribute('data-abc') || '') === cls;
                if (active) b.classList.add('active');
                else b.classList.remove('active');
            });
            const btn = (ev && ev.currentTarget) || (ev && ev.target) || null;
            if (btn && btn.classList) btn.classList.add('active');
        } catch (_) {}
        try {
            const rows = document.querySelectorAll('#wh_inv_tbody tr[data-abc]');
            let shown = 0;
            rows.forEach(tr => {
                const ok = cls === 'all' || tr.getAttribute('data-abc') === cls;
                tr.style.display = ok ? '' : 'none';
                if (ok) shown++;
            });
            const countEl = document.getElementById('wh_inv_count');
            if (countEl) countEl.textContent = String(shown);
        } catch (_) {}
    }

    // ==================== 包装材料采购：单材料独立购买 ====================
    /**
     * 打开单材料单独采购弹窗（支持自定义数量 + 价格阶梯显示）
     */
    purchasePackaging(materialId) {
        const materials = this.whState.getPackagingMaterials();
        const mat = materials[materialId];
        if (!mat) {
            this.ui.showToast('未知的包装材料: ' + materialId, 'error');
            return;
        }
        const cfgSource = (typeof PACKAGING_MATERIALS !== 'undefined' && PACKAGING_MATERIALS)
            ? PACKAGING_MATERIALS
            : (typeof WarehouseData !== 'undefined' ? WarehouseData.packagingMaterials : {});
        const fullCfg = cfgSource[materialId] || mat;
        const tiers = (fullCfg.priceTiers && fullCfg.priceTiers.length) ? fullCfg.priceTiers : null;
        const baseCost = fullCfg.cost || mat.cost || 1;
        // 默认数量按低库存阈值的 2 倍，或 10 兜底
        const defaultQty = Math.max(10, (fullCfg.lowStockThreshold || mat.lowStockThreshold || 10) * 2);

        let tiersHtml = '';
        if (tiers && tiers.length > 0) {
            tiersHtml = `
                <div class="wh-form-hint" style="background:linear-gradient(135deg,#e3f2fd,#f3e5f5);padding:8px 10px;border-radius:8px;margin-bottom:8px;">
                    <div style="font-weight:700;margin-bottom:4px;font-size:12px;">💰 批量采购价阶梯（买越多越便宜）</div>
                    <div style="display:flex;flex-direction:column;gap:3px;">
                        ${tiers.map(t => `
                            <div style="font-size:11px;display:flex;justify-content:space-between;">
                                <span>≥ ${t.minQty}${t.name ? '（' + t.name + '）' : ''}</span>
                                <span style="font-weight:700;">¥${Number(t.price).toFixed(2)}/${mat.unit || '个'}${t.discount ? ' <span style="color:#4caf50;">' + t.discount + '</span>' : ''}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        const content = `
            <div class="wh-form">
                <div style="display:flex;align-items:center;gap:10px;padding:10px;background:linear-gradient(135deg,#f5f5f5,#fff);border-radius:10px;margin-bottom:12px;">
                    <div style="font-size:36px;">${mat.icon}</div>
                    <div style="flex:1;min-width:0;">
                        <div style="font-weight:800;font-size:14px;">${mat.name}</div>
                        <div style="font-size:11px;color:#888;">单${mat.unit || '个'}成本约 ¥${Number(baseCost).toFixed(2)} · 当前库存 <b style="color:${mat.isLow ? '#f44336' : '#333'};">${Number(mat.quantity).toLocaleString()}${mat.unit || ''}</b>${mat.isLow ? ' ⚠️低库存' : ''}</div>
                    </div>
                </div>
                ${tiersHtml}
                <div class="wh-form-group">
                    <label>采购数量（${mat.unit || '个'}）</label>
                    <div style="display:flex;align-items:center;gap:6px;">
                        <button type="button" class="btn btn-secondary btn-sm" onclick="whUI._adjustPkgQty(-10)">-10</button>
                        <button type="button" class="btn btn-secondary btn-sm" onclick="whUI._adjustPkgQty(-1)">-1</button>
                        <input type="number" id="wh_pkg_qty" value="${defaultQty}" min="1" class="wh-input" style="flex:1;text-align:center;font-weight:700;font-size:14px;">
                        <button type="button" class="btn btn-secondary btn-sm" onclick="whUI._adjustPkgQty(1)">+1</button>
                        <button type="button" class="btn btn-secondary btn-sm" onclick="whUI._adjustPkgQty(10)">+10</button>
                    </div>
                    <div class="wh-form-hint" id="wh_pkg_pricehint" style="margin-top:6px;padding:6px 8px;background:#fff9e6;border-radius:6px;text-align:center;font-weight:700;">
                        预计花费 ¥0
                    </div>
                </div>
                <div style="font-size:11px;color:#999;line-height:1.5;">
                    💡 库存充足时发货打包直接消耗，不再收取紧急采购加价（+50%）。库存不足会自动临时采购，但价格贵很多。
                </div>
            </div>
            <script>
                (function(){
                    var qtyEl = document.getElementById('wh_pkg_qty');
                    var hint = document.getElementById('wh_pkg_pricehint');
                    var tiers = ${tiers ? JSON.stringify(tiers) : 'null'};
                    var base = ${baseCost};
                    function calc(){
                        var q = Math.max(1, parseInt(qtyEl.value) || 0);
                        var price = base;
                        if (tiers && tiers.length) {
                            for (var i = 0; i < tiers.length; i++) {
                                if (q >= tiers[i].minQty) price = tiers[i].price;
                            }
                        }
                        var total = Math.round(q * price * 100) / 100;
                        hint.innerHTML = '单价 ¥' + price.toFixed(2) + ' × ' + q + ' = 预计花费 <span style="font-size:14px;color:#d84315;">¥' + total.toFixed(2) + '</span>';
                    }
                    qtyEl.addEventListener('input', calc);
                    calc();
                })();
            </script>
        `;
        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>
            <button class="btn btn-primary" onclick="whUI.confirmPurchase('${materialId}')">确认采购</button>
        `;
        this.ui.showModal(`📮 单独采购 · ${mat.name}`, content, footer, { width: '440px' });
    }

    /** 调整数量按钮（+/-） */
    _adjustPkgQty(delta) {
        const el = document.getElementById('wh_pkg_qty');
        if (!el) return;
        const cur = parseInt(el.value) || 0;
        el.value = Math.max(1, cur + delta);
        // 触发 input 事件，刷新价格显示
        try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
    }

    /**
     * 确认按当前输入的数量采购该包装材料
     */
    confirmPurchase(materialId) {
        const qty = parseInt(document.getElementById('wh_pkg_qty')?.value) || 0;
        if (qty <= 0) {
            this.ui.showToast('采购数量必须大于 0', 'error');
            return;
        }
        const materials = this.whState.getPackagingMaterials();
        const mat = materials[materialId];
        const cfgSource = (typeof PACKAGING_MATERIALS !== 'undefined' && PACKAGING_MATERIALS)
            ? PACKAGING_MATERIALS
            : {};
        const fullCfg = cfgSource[materialId] || mat || {};
        // 计算阶梯价：和 purchasePackaging 弹窗中显示的阶梯逻辑保持一致
        let unitCost = fullCfg.cost || (mat ? mat.cost : 1);
        if (fullCfg.priceTiers && fullCfg.priceTiers.length > 0) {
            for (const tier of fullCfg.priceTiers) {
                if (qty >= tier.minQty) unitCost = tier.price;
            }
        }
        const res = this.whState.purchasePackagingMaterials(materialId, qty, unitCost);
        if (res.success) {
            this.ui.showToast(res.message + `（花费 ¥${Number(res.cost).toFixed(2)}）`, 'success');
            this.ui.closeModal();
            this.refresh();
        } else {
            this.ui.showToast(res.message || '采购失败', 'error');
        }
    }

    /**
     * 一键低库存补货：遍历所有包材，对低于阈值的逐一独立采购（lowStockThreshold × 3）
     */
    quickReplenishLowStock() {
        const materials = this.whState.getPackagingMaterials();
        const cfgSource = (typeof PACKAGING_MATERIALS !== 'undefined' && PACKAGING_MATERIALS)
            ? PACKAGING_MATERIALS
            : (typeof WarehouseData !== 'undefined' ? WarehouseData.packagingMaterials : {});
        let successCount = 0;
        let failCount = 0;
        let totalCost = 0;
        let lowCount = 0;
        const failedItems = [];
        Object.values(materials).forEach(mat => {
            const fullCfg = cfgSource[mat.id] || mat;
            const threshold = fullCfg.lowStockThreshold || mat.lowStockThreshold || 20;
            const isLow = mat.isLow || mat.quantity < threshold;
            if (!isLow) return;
            lowCount++;
            const qty = threshold * 3;
            let unitCost = fullCfg.cost || mat.cost || 1;
            if (fullCfg.priceTiers && fullCfg.priceTiers.length > 0) {
                for (const tier of fullCfg.priceTiers) {
                    if (qty >= tier.minQty) unitCost = tier.price;
                }
            }
            const res = this.whState.purchasePackagingMaterials(mat.id, qty, unitCost);
            if (res.success) {
                successCount++;
                totalCost += Number(res.cost) || 0;
            } else {
                failCount++;
                failedItems.push(mat.name);
            }
        });
        if (lowCount === 0) {
            this.ui.showToast('✅ 当前所有包材库存充足，无需补货', 'success');
            return;
        }
        let msg = `📦 低库存补货完成：成功 ${successCount} 种`;
        if (failCount > 0) msg += `，失败 ${failCount} 种（${failedItems.join('、')}）`;
        if (totalCost > 0) msg += `，共花费 ¥${totalCost.toFixed(2)}`;
        this.ui.showToast(msg, failCount > 0 ? (successCount > 0 ? 'warning' : 'error') : 'success');
        this.refresh();
    }

    /**
     * 包材采购说明弹窗
     */
    showPackagingGuide() {
        const content = `
            <div style="padding:10px;line-height:1.7;font-size:13px;">
                <div style="margin-bottom:12px;padding:12px;background:linear-gradient(135deg,#e8f5e9,#f1f8e9);border-radius:10px;">
                    <div style="font-weight:800;font-size:14px;margin-bottom:6px;">💡 包材采购说明</div>
                    <div style="color:#555;">
                        现在可以<b style="color:#2e7d32;">单独采购任意包材</b>，不再强制整套购买！
                    </div>
                </div>
                <div style="display:flex;flex-direction:column;gap:8px;color:#444;">
                    <div>✅ <b>单独采购</b>：点击每种包材下方的「采购」按钮，可自定义数量单独采购</div>
                    <div>✅ <b>一键补货</b>：点击「一键低库存补货」自动补满所有低库存包材（按阈值×3数量）</div>
                    <div>✅ <b>批量阶梯价</b>：采购量越大单价越便宜，注意看弹窗中的价格阶梯</div>
                    <div>✅ <b>提前备货</b>：库存不足时发货会自动紧急采购，但加价50%，建议提前备货</div>
                </div>
            </div>
        `;
        const footer = `<button class="btn btn-primary" onclick="ui.closeModal()">我知道了</button>`;
        this.ui.showModal('💡 包材采购说明', content, footer, { width: '480px' });
    }

    // 工具方法
    formatMoney(value) {
        if (typeof formatMoney === 'function') return formatMoney(value);
        return '¥' + (value || 0).toFixed(2);
    }

    // ==================== 采购员模块 UI（信息架构重做）====================
    // 主路径：招聘 → 一键补货 → 看计划/绩效；人事细节下沉到编辑/更多
    renderBuyers() {
        try { this.whState.syncBuyersFromEmployees({ silent: true }); } catch (e) {}
        const summary = this.whState.getBuyerSummary();
        const plans = this.whState.getPurchasePlans();
        const planEnabled = plans.filter(p => p.enabled).length;
        const buyers = this.whState.getBuyers();
        const activeBuyers = buyers.filter(b => b.status === 'active');
        const firstBuyer = activeBuyers[0];
        try { this._healPlanBuyerLinks(); } catch (_) {}
        const listedSku = this._countActiveListedSkus();

        const hero = `
            <div class="buyer-hero">
                <div class="buyer-hero-copy">
                    <div class="buyer-hero-title">先设额度和最低持仓，库存低于持仓才自动采购</div>
                    <div class="buyer-hero-desc">
                        按店铺资金百分比设每日额度；再设每个商品的最低持仓件数。库存低于最低持仓时，采购员自动补回到该件数。
                        ${firstBuyer ? (() => {
                            const q = this.whState.getBuyerQuotaInfo(firstBuyer);
                            if (!q.configured) return `${firstBuyer.name}：还没设额度，不能自动采购。`;
                            if (!q.minHoldConfigured) return `${firstBuyer.name}：额度已设，还没设最低持仓。`;
                            return `${firstBuyer.name}：额度资金 ${q.pct}% · 最低持仓 ${q.minHoldQty} 件。`;
                        })() : '到「员工管理」招聘采购员后，再设置额度与最低持仓。'}
                    </div>
                </div>
                <div class="buyer-hero-actions">
                    ${firstBuyer
                        ? `<button class="btn btn-primary btn-sm" style="font-weight:800;padding:10px 14px;"
                                   onclick="whUI.quickEnableOnShelfRestock('${firstBuyer.id}')">⚡ 一键在架补货</button>`
                        : `<button class="btn btn-primary btn-sm" style="font-weight:800;padding:10px 14px;"
                                   onclick="whUI._goHireBuyer()">👥 去招聘采购员</button>`}
                </div>
            </div>
            <div class="buyer-kpi-row">
                <div class="buyer-kpi">
                    <div class="buyer-kpi-label">在职采购员</div>
                    <div class="buyer-kpi-value">${summary.activeBuyers}</div>
                </div>
                <div class="buyer-kpi">
                    <div class="buyer-kpi-label">运行中计划</div>
                    <div class="buyer-kpi-value">${planEnabled}</div>
                </div>
                <div class="buyer-kpi">
                    <div class="buyer-kpi-label">累计采购</div>
                    <div class="buyer-kpi-value">${this.formatMoney(summary.totalPurchaseAmount)}</div>
                </div>
            </div>
        `;

        const buyerSection = `
            <div class="buyer-section-title">👥 采购员（${activeBuyers.length}人）</div>
            <div class="buyer-card-list">
                ${activeBuyers.length === 0
                    ? `<div class="buyer-empty">
                            <div class="buyer-empty-icon">👤</div>
                            <div class="buyer-empty-title">还没有采购员</div>
                            <div class="buyer-empty-desc">到「员工管理」招聘采购员，招聘后自动开启每日补货。</div>
                            <button class="btn btn-primary btn-sm" onclick="whUI._goHireBuyer()">👥 去招聘采购员</button>
                       </div>`
                    : activeBuyers.map(b => this._renderBuyerCard(b)).join('')}
            </div>
        `;

        const planSection = `
            <div class="buyer-section-title">📋 补货计划（${plans.length}个 · 运行中 ${planEnabled}）</div>
            <div style="display:flex;flex-direction:column;gap:12px;">
                <div class="buyer-toolbar">
                    ${firstBuyer
                        ? `<button class="btn btn-primary btn-sm" style="font-weight:800;"
                                   onclick="whUI.quickEnableOnShelfRestock('${firstBuyer.id}')">⚡ 一键在架补货</button>`
                        : `<button class="btn btn-primary btn-sm" onclick="whUI._goHireBuyer()">先去招聘</button>`}
                    <button class="btn btn-secondary btn-sm" onclick="whUI.showPlanCreateModal()">📋 新建计划</button>
                    <input type="text" id="wh_plan_kw" class="buyer-search" placeholder="搜索计划 / 采购员"
                           oninput="whUI._refreshPlanCardList()">
                    <span style="font-size:12px;color:#888;">在架 ${listedSku} 个商品</span>
                </div>
                <div id="wh_plan_cardlist" class="buyer-card-list">
                    ${plans.length === 0
                        ? `<div class="buyer-empty">
                                <div class="buyer-empty-icon">📋</div>
                                <div class="buyer-empty-title">还没有补货计划</div>
                                <div class="buyer-empty-desc">点「⚡一键在架补货」即可监控全部在架商品，库存偏低时自动采购。</div>
                                ${firstBuyer
                                    ? `<button class="btn btn-primary btn-sm" onclick="whUI.quickEnableOnShelfRestock('${firstBuyer.id}')">⚡ 立即开启</button>`
                                    : `<button class="btn btn-secondary btn-sm" onclick="whUI._goHireBuyer()">去招聘采购员</button>`}
                           </div>`
                        : plans.map(p => this._renderPlanCard(p)).join('')}
                </div>
            </div>
        `;

        return `
            <div class="buyer-center">
                ${hero}
                ${buyerSection}
                <div style="height:1px;background:#eee;margin:4px 0 10px;"></div>
                ${planSection}
            </div>
        `;
    }

    _goHireBuyer() {
        try {
            if (this.ui && typeof this.ui.closeModal === 'function') this.ui.closeModal();
        } catch (_) {}
        setTimeout(() => {
            try {
                if (this.ui && typeof this.ui.showHireEmployeeModal === 'function') {
                    this.ui.showHireEmployeeModal();
                } else if (this.ui && typeof this.ui.showEmployeeManagerModal === 'function') {
                    this.ui.showEmployeeManagerModal();
                }
            } catch (e) {
                this.ui.showToast('请到「我的 → 员工管理」招聘采购员', 'info');
            }
        }, 40);
    }

    _getFilteredBuyers() {
        const rawList = this.whState.getBuyers({ status: this._buyerFilterStatus || undefined });
        const kw = String(this._buyerKw || document.getElementById('wh_buyer_kw')?.value || '').trim();
        if (!kw) return rawList;
        return rawList.filter(b =>
            (b.name && b.name.indexOf(kw) >= 0)
            || (b.phone && b.phone.indexOf(kw) >= 0)
            || (b.employeeNo && String(b.employeeNo).indexOf(kw) >= 0)
        );
    }

    _renderBuyerEmptyState(filtered) {
        if (filtered) {
            return `<div class="buyer-empty">
                <div class="buyer-empty-icon">🔍</div>
                <div class="buyer-empty-title">没有匹配的采购员</div>
                <div class="buyer-empty-desc">换个关键词，或切换状态筛选再试。</div>
            </div>`;
        }
        return `<div class="buyer-empty">
            <div class="buyer-empty-icon">🛒</div>
            <div class="buyer-empty-title">还没有采购员</div>
            <div class="buyer-empty-desc">在「员工管理」招聘采购员岗位后会自动出现在这里，也可手工录入。</div>
            <button class="btn btn-primary btn-sm" onclick="whUI._goHireBuyer()">👥 去招聘</button>
            <button class="btn btn-secondary btn-sm" style="margin-left:6px;" onclick="whUI.openBuyerForm()">手工录入</button>
        </div>`;
    }

    _renderBuyerCard(b) {
        if (!b) return '';
        const buyerPlans = this.whState.getPurchasePlans({ buyerId: b.id });
        const enabledPlans = buyerPlans.filter(p => p.enabled).length;
        const pending = Number(b.pendingRebate || 0);
        const q = (this.whState.getBuyerQuotaInfo && this.whState.getBuyerQuotaInfo(b))
            || { configured: false, quota: 0, spent: 0, remain: 0 };
            const quotaLabel = q.configured
            ? `资金 ${q.pct}%（${this.formatMoney(q.quota)}）· 今日已用 ${this.formatMoney(q.spent)} · 剩余 ${this.formatMoney(q.remain)}`
            : '未设置资金百分比额度，不能自动采购';
        const holdLabel = q.minHoldConfigured
            ? `最低持仓 ${q.minHoldQty} 件 · 库存低于此数自动采购`
            : '未设置最低持仓，不会自动采购';
        return `
            <div class="buyer-card">
                <div class="buyer-card-top">
                    <div style="min-width:0;flex:1;">
                        <div class="buyer-card-name">${b.statusIcon || '👤'} ${b.name}</div>
                        <div class="buyer-card-meta">
                            ${buyerPlans.length
                                ? `自动补货 ${enabledPlans}/${buyerPlans.length} 个计划运行中`
                                : '暂无补货计划'}
                            · 累计采购 ${this.formatMoney(b.totalPurchaseAmount)}
                            · 本月提成 <span style="color:#f57c00;">¥${pending.toLocaleString()}</span>
                        </div>
                        <div class="buyer-card-meta" style="margin-top:3px;${q.configured ? 'color:#1565c0;' : 'color:#c62828;font-weight:700;'}">
                            💰 ${quotaLabel}
                        </div>
                        <div class="buyer-card-meta" style="margin-top:3px;${q.minHoldConfigured ? 'color:#2e7d32;' : 'color:#c62828;font-weight:700;'}">
                            📦 ${holdLabel}
                        </div>
                        <div class="buyer-card-meta" style="margin-top:3px;">
                            🤝 谈判 Lv.${b.negotiation || 0} · 采购价 -${b.negotiation || 0}%
                        </div>
                    </div>
                    <span class="buyer-badge" style="background:${b.statusColor || '#9e9e9e'};">${b.statusName || b.status || ''}</span>
                </div>
                <div class="buyer-card-actions">
                    <div class="buyer-card-actions-main">
                        <button class="btn btn-primary btn-sm" onclick="whUI.openBuyerQuotaForm('${b.id}')">💰 设置额度/持仓</button>
                        ${b.status === 'active'
                            ? `<button class="btn ${q.ready ? 'btn-primary' : 'btn-secondary'} btn-sm" onclick="whUI.quickEnableOnShelfRestock('${b.id}')"${q.ready ? '' : ' title="请先设置额度和最低持仓"'}>⚡ 一键补货</button>`
                            : `<button class="btn btn-secondary btn-sm" disabled title="非在职不可派单">不可派单</button>`}
                        <button class="btn btn-secondary btn-sm" onclick="whUI.showBuyerPlans('${b.id}')">计划</button>
                        <button class="btn btn-secondary btn-sm" onclick="whUI.showBuyerPurchaseOrders('${b.id}')">采购单</button>
                        ${(b.negotiation || 0) < 5 ? `<button class="btn btn-secondary btn-sm" onclick="whUI.upgradeBuyerNegotiation('${b.id}')">🤝 谈判培训 ¥${((b.negotiation || 0) + 1) * 5000}</button>` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    // 渲染单条采购计划卡片（新UI：彩色卡片）
    _renderPlanCard(p) {
        const today = (this.gameState?.state?.gameTime?.day) || 1;
        const now = this.gameState?.state?.gameTime || { day: 1, hour: 0 };

        let statusBadge, statusColor, cardBorder, cardBg;
        if (!p.enabled && p.lastRunDay && p.scheduleType && p.scheduleType !== 'daily') {
            const interval = p.scheduleType === 'weekly' ? 7 : 30;
            if (p.lastRunDay && (today - p.lastRunDay) > interval * 3) {
                statusBadge = '⚪ 已过期';
                statusColor = '#9e9e9e';
                cardBorder = '#e0e0e0';
                cardBg = 'linear-gradient(135deg,#fafafa,#f5f5f5)';
            }
        }
        if (!statusBadge) {
            if (p.enabled && p.overdue) {
                statusBadge = '🟡 待执行';
                statusColor = '#ef6c00';
                cardBorder = '#ffe0b2';
                cardBg = 'linear-gradient(135deg,#fff8e1,#fffdf5)';
            } else if (p.enabled) {
                statusBadge = '🟢 运行';
                statusColor = '#2e7d32';
                cardBorder = '#c8e6c9';
                cardBg = 'linear-gradient(135deg,#e8f5e9,#f5fff7)';
            } else {
                statusBadge = '🔴 暂停';
                statusColor = '#c62828';
                cardBorder = '#ef9a9a';
                cardBg = 'linear-gradient(135deg,#ffebee,#fff5f5)';
            }
        }

        let scheduleDesc = '';
        if (p.scheduleType) {
            const h = parseInt(p.scheduleHour) || 8;
            const hourStr = (h < 10 ? '0' : '') + h + ':00';
            if (p.scheduleType === 'daily') {
                scheduleDesc = `📅 每日 ${hourStr} 执行`;
            } else if (p.scheduleType === 'weekly') {
                const dayNames = ['周一','周二','周三','周四','周五','周六','周日'];
                const d = ((parseInt(p.scheduleDay) || 1) - 1 + 7) % 7;
                scheduleDesc = `📅 每周${dayNames[d]} ${hourStr} 执行`;
            } else if (p.scheduleType === 'monthly') {
                const d = parseInt(p.scheduleDay) || 1;
                scheduleDesc = `📅 每月${d}号 ${hourStr} 执行`;
            }
        } else {
            scheduleDesc = `${p.frequencyIcon||'🔁'} ${p.frequencyName||''}（每${p.frequencyInterval||1}天）· 起始第${p.startDay||1}天`;
        }

        const buyer = p.buyer || ((this.whState && this.whState.getBuyerById) ? this.whState.getBuyerById(p.buyerId) : null);
        const quota = (this.whState && this.whState.getBuyerQuotaInfo)
            ? this.whState.getBuyerQuotaInfo(buyer)
            : null;

        const lastRunText = p.lastRunDay ? `第${p.lastRunDay}天` : '尚未成功采购';
        const planName = p.name || `采购计划 ${p.id ? p.id.substr(-4) : ''}`;
        const preview = p.scheduleType ? this._previewPlanRestock(p) : null;
        const previewItems = (preview && Array.isArray(preview.items)) ? preview.items : [];
        const previewQty = previewItems.reduce((s, it) => s + (parseInt(it.quantity) || 0), 0);
        const previewAmt = previewItems.reduce((s, it) => s + (parseInt(it.quantity) || 0) * (parseFloat(it.costPrice) || 0), 0);
        const listedN = (preview && preview.listedCount != null) ? preview.listedCount : this._countActiveListedSkus();
        const budgetCap = (preview && preview.budgetCap > 0)
            ? preview.budgetCap
            : (quota && quota.remain > 0 ? quota.remain : 0);
        let effectLine = '';
        if (p.planMode === 'direct') {
            effectLine = `指定商品直采 · ${this._planSkuHint(p)}`;
        } else if (preview) {
            if (previewQty > 0) {
                effectLine = `现在执行可补 <b style="color:#1565c0;">${preview.needSkuCount || previewItems.length}</b> 个SKU · <b>${previewQty}</b> 件 · 约 ${this.formatMoney(previewAmt)}`;
            } else {
                effectLine = preview.emptyReason || `在架 ${listedN} 个SKU库存已达标`;
            }
        } else {
            effectLine = `目标：${this._planSkuHint(p)}`;
        }
        if (p.lastResult && p.lastResult.totalQty) {
            effectLine += `<div style="margin-top:4px;font-size:11px;color:#666;">上次实采：${p.lastResult.totalQty}件 / ¥${Number(p.lastResult.totalAmt||0).toFixed(0)}（第${p.lastResult.day}天）</div>`;
        } else if (p.lastSkipReason) {
            effectLine += `<div style="margin-top:4px;font-size:11px;color:#888;">最近检查：${p.lastSkipReason}</div>`;
        }

        return `
            <div style="border:1px solid ${cardBorder};border-left:5px solid ${statusColor};border-radius:12px;background:${cardBg};padding:14px 16px;box-shadow:0 2px 8px rgba(0,0,0,0.04);">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px;">
                    <div style="flex:1;min-width:0;">
                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                            <span style="font-size:15px;font-weight:800;color:#333;">📋 ${planName}</span>
                            <span style="display:inline-block;padding:3px 10px;border-radius:20px;background:${statusColor}15;color:${statusColor};font-size:11px;font-weight:800;border:1px solid ${statusColor}30;">
                                ${statusBadge}
                            </span>
                        </div>
                        <div style="margin-top:6px;font-size:12px;color:#555;">
                            <span style="display:inline-block;padding:2px 8px;border-radius:6px;background:#fff;color:#455a64;border:1px solid #cfd8dc;font-weight:600;">
                                ⏰ ${scheduleDesc}
                            </span>
                            <span style="display:inline-block;padding:2px 8px;border-radius:6px;background:#fff;color:#455a64;border:1px solid #cfd8dc;font-weight:600;margin-left:6px;">
                                🎯 ${p.planMode === 'direct' ? this._planSkuHint(p) : `全部在架(${listedN})`}
                            </span>
                        </div>
                    </div>
                </div>
                <div style="padding:10px 12px;border-radius:10px;background:rgba(255,255,255,0.75);border:1px dashed ${cardBorder};margin-bottom:10px;font-size:12px;color:#37474f;line-height:1.5;">
                    ${effectLine}
                </div>
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding:0 0 10px;margin-bottom:10px;border-bottom:1px dashed ${cardBorder};">
                    <div>
                        <div style="font-size:10px;color:#78909c;margin-bottom:3px;">👤 采购员</div>
                        <div style="font-size:13px;font-weight:700;color:#37474f;">
                            ${p.buyerDepartmentIcon||'👤'} ${(buyer && buyer.name) || p.buyerName || '--'}
                        </div>
                    </div>
                    <div>
                        <div style="font-size:10px;color:#78909c;margin-bottom:3px;">💰 今日可采额度</div>
                        <div style="font-size:13px;font-weight:700;color:${quota && quota.configured ? '#d84315' : '#c62828'};">
                            ${quota && quota.configured
                                ? `${this.formatMoney(budgetCap)} · 资金${quota.pct}%（剩 ${this.formatMoney(quota.remain)}）`
                                : '未设额度，不能自动采购'}
                        </div>
                    </div>
                    <div>
                        <div style="font-size:10px;color:#78909c;margin-bottom:3px;">🕐 上次成功采购</div>
                        <div style="font-size:13px;font-weight:700;color:${p.lastRunDay ? '#37474f' : '#9e9e9e'};">
                            ${lastRunText}
                            ${p.runCount ? `<span style="font-size:10px;color:#78909c;font-weight:400;">（共${p.runCount}次）</span>` : ''}
                        </div>
                    </div>
                </div>
                <div style="display:flex;justify-content:flex-end;gap:6px;flex-wrap:wrap;">
                    <button class="btn btn-primary btn-sm" style="padding:5px 12px;font-size:12px;border-radius:8px;font-weight:700;"
                            onclick="whUI.runPlanNow('${p.id}')" title="立即执行一次，马上看到补货结果">
                        ▶️ 立即执行看效果
                    </button>
                    <button class="btn btn-secondary btn-sm" style="padding:5px 10px;font-size:12px;border-radius:8px;"
                            onclick="whUI.togglePlan('${p.id}')" title="${p.enabled ? '暂停' : '启用'}">
                        ${p.enabled ? '⏸ 暂停' : '▶️ 启用'}
                    </button>
                    <button class="btn btn-secondary btn-sm" style="padding:5px 10px;font-size:12px;border-radius:8px;"
                            onclick="whUI.showPlanCreateModal('${p.id}')">
                        ✏️ 编辑
                    </button>
                    <button class="btn btn-secondary btn-sm" style="padding:5px 10px;font-size:12px;border-radius:8px;color:#f44336;"
                            onclick="whUI.confirmDeletePlan('${p.id}','${(planName||'').replace(/'/g,'')}')">
                        🗑️ 删除
                    </button>
                </div>
            </div>
        `;
    }

    /** 一键开启：每日自动补全部在架商品 */
    // 采购员谈判培训（采购员模块深化）
    upgradeBuyerNegotiation(buyerId) {
        const res = this.whState.upgradeBuyerNegotiation(buyerId);
        this.ui.showToast((res && res.message) || '操作失败', res && res.success ? 'success' : 'error');
        if (res && res.success) this.refresh();
    }

    openBuyerQuotaForm(buyerId) {
        const b = this.whState.getBuyerById(buyerId);
        if (!b) { this.ui.showToast('采购员不存在', 'error'); return; }
        const q = this.whState.getBuyerQuotaInfo(b);
        const presets = [5, 10, 15, 20, 30, 50];
        const holdPresets = [1000, 10000, 50000, 100000, 500000, 1000000];
        const holdLabel = (n) => n >= 10000 ? `${n / 10000}万件` : `${n / 1000}千件`;
        const fundsNow = q.funds || 0;
        const previewPct = q.pct > 0 ? q.pct : 10;
        const previewHold = q.minHoldQty > 0 ? q.minHoldQty : 1000;
        const content = `
            <div style="padding:4px 2px;">
                <div style="font-size:14px;font-weight:800;margin-bottom:6px;">💰 ${b.name} · 额度与最低持仓</div>
                <div style="font-size:12px;color:#666;line-height:1.6;margin-bottom:10px;">
                    必须先设两项：<b>每日额度</b>（占当日资金%）和<b>最低持仓</b>（每个商品最少备多少件）。
                    库存<b>低于最低持仓</b>时，采购员自动采购补回该件数。当前资金 ${this.formatMoney(fundsNow)}。
                    ${q.configured ? `<br>额度 ${q.pct}% ≈ ${this.formatMoney(q.quota)}，今日已用 ${this.formatMoney(q.spent)}，剩余 ${this.formatMoney(q.remain)}。` : '<br><span style="color:#c62828;">尚未设额度。</span>'}
                    ${q.minHoldConfigured ? `最低持仓 ${q.minHoldQty} 件。` : '<span style="color:#c62828;">尚未设最低持仓。</span>'}
                </div>
                <div class="form-group">
                    <label class="form-label">每日额度（占资金 %）</label>
                    <div style="display:flex;flex-wrap:wrap;gap:6px;margin:6px 0;">
                        ${presets.map(n => `<button class="btn btn-secondary btn-small" onclick="document.getElementById('wh_buyer_quota').value='${n}'">${n}%</button>`).join('')}
                    </div>
                    <input type="number" class="form-input" id="wh_buyer_quota" min="1" max="100" step="1" value="${previewPct}">
                </div>
                <div class="form-group">
                    <label class="form-label">最低持仓（件 / 每个商品）</label>
                    <div style="display:flex;flex-wrap:wrap;gap:6px;margin:6px 0;">
                        ${holdPresets.map(n => `<button class="btn btn-secondary btn-small" onclick="document.getElementById('wh_buyer_minhold').value='${n}'">${holdLabel(n)}</button>`).join('')}
                    </div>
                    <input type="number" class="form-input" id="wh_buyer_minhold" min="1" max="99999999" step="1000" value="${previewHold}">
                    <div style="font-size:11px;color:#888;margin-top:4px;">库存低于此数才自动采购，并补回到这个件数。</div>
                </div>
            </div>`;
        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>
            <button class="btn btn-primary" onclick="whUI.submitBuyerQuota('${buyerId}')">保存设置</button>`;
        this.ui.showModal('设置额度与最低持仓', content, footer, { modalId: 'buyerQuotaModal' });
    }

    submitBuyerQuota(buyerId) {
        const el = document.getElementById('wh_buyer_quota');
        const holdEl = document.getElementById('wh_buyer_minhold');
        const v = el ? el.value : '';
        const hold = holdEl ? holdEl.value : '';
        const res = this.whState.setBuyerRestockRules(buyerId, v, hold);
        if (res && res.success) {
            this.ui.closeModal();
            this.ui.showToast(res.message);
            this.refresh();
        } else {
            this.ui.showToast((res && res.message) || '设置失败');
        }
    }

    quickEnableOnShelfRestock(buyerId) {
        if (!buyerId) {
            const active = this.whState.getBuyers({ status: 'active' });
            buyerId = active[0] && active[0].id;
        }
        if (!buyerId) {
            this.ui.showToast('⚠️ 请先招聘在职采购员', 'warning');
            return;
        }
        const buyer = this.whState.getBuyerById(buyerId);
        const q = buyer && this.whState.getBuyerQuotaInfo(buyer);
        if (!q || !q.ready) {
            this.ui.showToast(!q || !q.configured ? '请先设置采购额度' : '请先设置最低持仓');
            this.openBuyerQuotaForm(buyerId);
            return;
        }
        const res = this.whState.quickStartOnShelfRestock(buyerId);
        if (!res.success) {
            this.ui.showToast('❌ ' + res.message, 'error');
            return;
        }
        const planId = res.data && res.data.id;
        this.ui.showToast('✅ ' + (res.already ? res.message + '，正在立即执行…' : (res.message || '已开启在架自动补货，正在执行…')), 'success');
        this.buyerCurrentSubTab = 'plan';
        if (planId) {
            const run = this.whState.runPurchasePlanNow(planId);
            this.ui.showToast(run.message, run.success ? 'success' : 'error');
        }
        this.refresh();
    }

    // 刷新计划卡片列表（替代旧的 _refreshPlanList）
    _refreshPlanCardList() {
        const container = document.getElementById('wh_plan_cardlist');
        if (!container) return;
        let plans = this.whState.getPurchasePlans();
        const kw = document.getElementById('wh_plan_kw')?.value || '';
        if (kw) {
            const k = String(kw).trim();
            plans = plans.filter(p =>
                (p.name && String(p.name).indexOf(k)>=0)
                || (p.buyerName && String(p.buyerName).indexOf(k)>=0)
            );
        }
        if (plans.length === 0) {
            container.innerHTML = `
                <div class="wh-card-simple" style="text-align:center;padding:40px 20px;color:#999;background:linear-gradient(135deg,#fafafa,#f5f5f5);">
                    <div style="font-size:48px;margin-bottom:10px;">🔍</div>
                    <div style="font-size:14px;font-weight:600;margin-bottom:6px;">暂无匹配的计划</div>
                    <div style="font-size:12px;">换个关键词试试，或点击「📋 新建采购计划」创建新计划</div>
                </div>
            `;
            return;
        }
        container.innerHTML = plans.map(p => this._renderPlanCard(p)).join('');
    }

    // 切换 双子Tab
    switchBuyerSubTab(sub) {
        this.buyerCurrentSubTab = sub || 'info';
        this._buyerFilterStatus = '';
        this._planFilterStatus = '';
        this.refresh();
    }

    // 采购员状态筛选（按钮点击触发）
    _filterBuyerStatus(id, btnEl) {
        this._buyerFilterStatus = id || '';
        const container = btnEl && btnEl.parentElement;
        if (container) container.querySelectorAll('.wh-filter-btn-simple').forEach(b => b.classList.remove('active'));
        if (btnEl) btnEl.classList.add('active');
        this._refreshBuyerList();
    }

    // 采购员行内刷新（卡片列表）
    _refreshBuyerList() {
        if (this.buyerCurrentSubTab === 'plan') return;
        const box = document.getElementById('wh_buyer_cardlist');
        if (!box) return;
        const kwEl = document.getElementById('wh_buyer_kw');
        if (kwEl) this._buyerKw = kwEl.value || '';
        const list = this._getFilteredBuyers();
        if (list.length === 0) {
            box.innerHTML = this._renderBuyerEmptyState(!!(this._buyerFilterStatus || this._buyerKw));
            return;
        }
        box.innerHTML = list.map(b => this._renderBuyerCard(b)).join('');
    }

    _filterPlanStatus(id, btnEl) {
        this._planFilterStatus = id || '';
        const box = document.getElementById('wh_plan_filters');
        if (box) box.querySelectorAll('.wh-filter-btn-simple').forEach(b => b.classList.remove('active'));
        if (btnEl) btnEl.classList.add('active');
        this._refreshPlanList();
    }

    _refreshPlanList() {
        const tbody = document.getElementById('wh_plan_tbody');
        if (!tbody) return;
        let plans = this.whState.getPurchasePlans();
        const f = this._planFilterStatus || '';
        if (f === 'on') plans = plans.filter(p => p.enabled);
        else if (f === 'off') plans = plans.filter(p => !p.enabled);
        else if (f === 'due') plans = plans.filter(p => p.overdue);
        const kw = document.getElementById('wh_plan_kw')?.value || '';
        if (kw) {
            const k = String(kw).trim();
            plans = plans.filter(p =>
                (p.name && p.name.indexOf(k)>=0)
                || (p.buyerName && p.buyerName.indexOf(k)>=0)
            );
        }
        if (plans.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="wh-empty-simple" style="padding:30px;text-align:center;color:#999;">暂无匹配的采购计划</td></tr>`;
            return;
        }
        tbody.innerHTML = plans.map(p => this._renderPlanRow(p)).join('');
    }

    // 查看某采购员的任务详情（弹窗）
    showBuyerPlans(buyerId) {
        const b = this.whState.getBuyerById(buyerId);
        if (!b) { this.ui.showToast('采购员不存在', 'error'); return; }
        const plans = this.whState.getPurchasePlans({ buyerId });
        const content = `
            <div style="display:flex;flex-direction:column;gap:12px;">
                <div style="display:flex;align-items:center;gap:12px;padding:12px;border-radius:10px;background:linear-gradient(135deg,#e8f5e9,#c8e6c9);">
                    <div style="font-size:36px;">${b.departmentIcon||'👥'}</div>
                    <div style="flex:1;">
                        <div style="font-size:16px;font-weight:800;">${b.statusIcon} ${b.name} <span style="font-weight:400;font-size:12px;color:#666;">· 采购任务详情</span></div>
                        <div style="font-size:12px;color:#666;margin-top:2px;">
                            📱 ${b.phone} · ${b.departmentName} · ${b.employeeNo ? '工号 '+b.employeeNo : ''}
                        </div>
                    </div>
                    <button class="btn btn-primary btn-sm" onclick="ui.closeModal();setTimeout(function(){ whUI.quickEnableOnShelfRestock('${buyerId}'); }, 30);">
                        ⚡ 一键补货
                    </button>
                </div>
                ${plans.length === 0 ? `
                    <div class="buyer-empty" style="margin:0;">
                        <div class="buyer-empty-title">暂无采购任务</div>
                        <div class="buyer-empty-desc">点「一键补货」即可为该采购员开启在架自动补货。</div>
                    </div>
                ` : `
                    <div style="max-height:420px;overflow:auto;">
                        ${plans.map(p => `
                            <div class="wh-card-simple" style="margin-bottom:10px;">
                                <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
                                    <div style="font-weight:700;">
                                        <span style="display:inline-block;padding:1px 6px;border-radius:6px;background:${p.enabled ? '#e8f5e9' : '#f5f5f5'};color:${p.enabled ? '#2e7d32' : '#757575'};font-size:10px;font-weight:700;margin-right:6px;">
                                            ${p.enabled ? '启用' : '停用'}
                                        </span>
                                        ${p.name}
                                        <span style="margin-left:6px;font-size:11px;color:#666;font-weight:400;">${p.frequencyIcon}${p.frequencyName}（每${p.frequencyInterval}天）</span>
                                    </div>
                                    <div>
                                        <button class="btn btn-secondary btn-sm" style="padding:2px 8px;font-size:11px;" onclick="whUI.togglePlan('${p.id}');setTimeout(()=>whUI.showBuyerPlans('${buyerId}'),50);">${p.enabled ? '⏸停用' : '▶️启用'}</button>
                                        <button class="btn btn-secondary btn-sm" style="padding:2px 8px;font-size:11px;" onclick="whUI.runPlanNow('${p.id}')">⚡立即执行</button>
                                        <button class="btn btn-secondary btn-sm" style="padding:2px 8px;font-size:11px;" onclick="ui.closeModal();setTimeout(()=>whUI.showPlanCreateModal('${p.id}'),40)">✏️编辑</button>
                                    </div>
                                </div>
                                ${Array.isArray(p.items) && p.items.length ? `
                                <table class="wh-table-simple" style="width:100%;margin-top:8px;border-collapse:collapse;">
                                    <thead>
                                        <tr style="background:#f5f5f5;">
                                            <th style="padding:5px 8px;text-align:left;font-size:11px;">商品</th>
                                            <th style="padding:5px 8px;text-align:right;font-size:11px;">数量</th>
                                            <th style="padding:5px 8px;text-align:right;font-size:11px;">成本单价</th>
                                            <th style="padding:5px 8px;text-align:right;font-size:11px;">小计</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${p.items.map(it => {
                                            const amt = (parseInt(it.quantity)||0) * (parseFloat(it.costPrice)||0);
                                            return `
                                                <tr style="border-top:1px solid #f0f0f0;">
                                                    <td style="padding:5px 8px;font-size:12px;">🛒 ${it.productName || it.productId}</td>
                                                    <td style="padding:5px 8px;text-align:right;font-size:12px;">× ${it.quantity}</td>
                                                    <td style="padding:5px 8px;text-align:right;font-size:12px;">¥${(parseFloat(it.costPrice)||0).toFixed(2)}</td>
                                                    <td style="padding:5px 8px;text-align:right;font-size:12px;"><b>¥${amt.toFixed(2)}</b></td>
                                                </tr>
                                            `;
                                        }).join('')}
                                    </tbody>
                                </table>
                                ` : (Array.isArray(p.directItems) && p.directItems.length) ? `
                                <table class="wh-table-simple" style="width:100%;margin-top:8px;border-collapse:collapse;">
                                    <thead>
                                        <tr style="background:#f5f5f5;">
                                            <th style="padding:5px 8px;text-align:left;font-size:11px;">指定商品</th>
                                            <th style="padding:5px 8px;text-align:center;font-size:11px;">品质</th>
                                            <th style="padding:5px 8px;text-align:right;font-size:11px;">数量</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${p.directItems.map(it => {
                                            const prod = (typeof getProductById === 'function') ? getProductById(it.productId) : null;
                                            return `
                                                <tr style="border-top:1px solid #f0f0f0;">
                                                    <td style="padding:5px 8px;font-size:12px;">🛒 ${(prod && prod.name) || it.productId}</td>
                                                    <td style="padding:5px 8px;text-align:center;font-size:12px;">${it.qualityGrade || 'B'}</td>
                                                    <td style="padding:5px 8px;text-align:right;font-size:12px;"><b>× ${it.quantity}</b></td>
                                                </tr>
                                            `;
                                        }).join('')}
                                    </tbody>
                                </table>
                                <div style="margin-top:6px;font-size:11px;color:#666;">数量倍率：×${Number(p.orderQuantityMultiplier || 1)}</div>
                                ` : `
                                <div style="margin-top:8px;font-size:12px;color:#555;padding:8px;background:#f7fbff;border-radius:8px;">
                                    🎯 目标：${this._planSkuHint(p)}
                                    ${Array.isArray(p.targetProductIds) && p.targetProductIds.length
                                        ? `（${p.targetProductIds.slice(0, 6).join('、')}${p.targetProductIds.length > 6 ? '…' : ''}）`
                                        : '（按库存自动补货）'}
                                    ${p.orderQuantityMultiplier ? ` · 数量倍率 ×${p.orderQuantityMultiplier}` : ''}
                                </div>
                                `}
                                <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:11px;color:#666;">
                                    <span>${p.scheduleType ? (p.frequencyIcon || '📅') + ' ' + (p.frequencyName || p.scheduleType) : `起始：第${p.startDay || 1}天`} · 已执行 ${p.runCount||0} 次${p.lastRunDay ? ' · 上次：第'+p.lastRunDay+'天' : ''}</span>
                                    <span>下次执行：<b>${p.nextRunDay ? '第'+p.nextRunDay+'天' : (p.scheduleType ? '按调度' : '--')}</b>${p.overdue ? ' <span style="color:#c62828;">(待执行)</span>' : ''}</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `}
            </div>
        `;
        this.ui.showModal(`📋 ${b.name} · 采购任务详情（${plans.length}个）`, content, `<button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>`, { width: '720px' });
    }

    // 手动触发：立即执行所有到期采购计划
    runDuePurchasePlansNow() {
        const today = (this.gameState?.state?.gameTime?.day) || 1;
        const res = this.whState.runDuePurchasePlans(today);
        if (res.executed === 0 && res.skipped === 0) {
            this.ui.showToast('ℹ️ 暂无可执行的到期计划', 'info');
        } else {
            const ok = res.details.filter(r => r.ok);
            const fail = res.details.filter(r => !r.ok);
            this.ui.showToast(
                `✅ 执行 ${res.executed} 个计划 · ⚠️跳过/失败 ${res.skipped} 个${ok.length? ' · 共'+ok.reduce((s,r)=>s+r.totalQty,0)+'件 ¥'+ok.reduce((s,r)=>s+r.totalAmt,0).toFixed(2):''}${fail.length? '（详情见日志）':''}`,
                res.skipped === 0 ? 'success' : 'warning'
            );
        }
        this.refresh();
    }

    togglePlan(planId) {
        const res = this.whState.togglePurchasePlan(planId);
        this.ui.showToast((res.success ? '✅ ' : '❌ ') + res.message, res.success ? 'success' : 'error');
        if (res.success) this.refresh();
    }

    runPlanNow(planId) {
        const res = this.whState.runPurchasePlanNow(planId);
        this.ui.showToast(res.message, res.success ? 'success' : 'error');
        this.refresh();
    }

    confirmDeletePlan(planId, planName) {
        if (!confirm(`确定删除采购计划「${planName || planId}」？删除后自动任务将停止，但已入库记录不回退。`)) return;
        const res = this.whState.deletePurchasePlan(planId);
        this.ui.showToast((res.success ? '✅ ' : '❌ ') + res.message, res.success ? 'success' : 'error');
        if (res.success) this.refresh();
    }

    // ====== 添加/编辑 采购员表单（主字段精简，人事细节折叠）======
    openBuyerForm(buyerId = null) {
        const isEdit = !!buyerId;
        const b = isEdit ? this.whState.getBuyerById(buyerId) : null;
        if (isEdit && !b) { this.ui.showToast('采购员不存在', 'error'); return; }

        const depts = WarehouseData ? WarehouseData.buyerDepartments : [];
        const statuses = (WarehouseData ? WarehouseData.buyerStatus : []).filter(s => s && s.id !== 'disabled');
        const genders = WarehouseData ? (WarehouseData.buyerGenders || []) : [];
        const educations = WarehouseData ? (WarehouseData.buyerEducation || []) : [];
        const rebatePctLabel = ((WarehouseData && WarehouseData.buyerRebateConfig) ? WarehouseData.buyerRebateConfig.defaultRebateRate : 0.00001) * 100;

        const content = `
            <div class="wh-form" style="display:flex;flex-direction:column;gap:12px;">
                <div style="padding:10px 12px;border-radius:10px;background:#f5f9ff;border:1px solid #d6e4ff;font-size:12px;color:#1565c0;line-height:1.5;">
                    推荐优先在「员工管理」招聘采购员；手工录入适合临时补录。提成固定 ${rebatePctLabel}%（采购金额 × 0.001%）。
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                    <div class="wh-form-group">
                        <label>姓名 <span style="color:#f44336;">*</span></label>
                        <input type="text" id="wh_b_name" class="wh-input" value="${isEdit ? (b.name || '') : ''}" placeholder="2-20 个中英文姓名">
                    </div>
                    <div class="wh-form-group">
                        <label>联系方式 <span style="color:#f44336;">*</span></label>
                        <input type="text" id="wh_b_phone" class="wh-input" value="${isEdit ? (b.phone || '') : ''}" placeholder="手机号或固话">
                    </div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
                    <div class="wh-form-group">
                        <label>所属部门 <span style="color:#f44336;">*</span></label>
                        <select id="wh_b_dept" class="wh-input">
                            ${depts.map(d => `<option value="${d.id}" ${isEdit && b.departmentId === d.id ? 'selected' : (!isEdit && d.id === 'purchase_dept' ? 'selected' : '')}>${d.icon} ${d.name}</option>`).join('')}
                        </select>
                    </div>
                    <div class="wh-form-group">
                        <label>状态</label>
                        <select id="wh_b_status" class="wh-input">
                            ${statuses.map(s => `<option value="${s.id}" ${isEdit && b.status === s.id ? 'selected' : ''}>${s.icon} ${s.name}</option>`).join('')}
                        </select>
                    </div>
                    <div class="wh-form-group">
                        <label>工号（可空）</label>
                        <input type="text" id="wh_b_empno" class="wh-input" value="${isEdit ? (b.employeeNo || '') : ''}" placeholder="自动生成">
                    </div>
                </div>
                <div class="wh-form-group">
                    <label>擅长品类（可选）</label>
                    <input type="text" id="wh_b_cats" class="wh-input" value="${isEdit && Array.isArray(b.goodCategories) ? b.goodCategories.join('，') : ''}" placeholder="如：食品、美妆、3C">
                </div>
                <div class="wh-form-group">
                    <label>备注</label>
                    <textarea id="wh_b_remark" class="wh-input" rows="2" placeholder="可选">${isEdit ? (b.remark || '') : ''}</textarea>
                </div>

                <details class="buyer-more-fields">
                    <summary style="cursor:pointer;font-size:12px;color:#666;user-select:none;">更多资料（可选）</summary>
                    <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px;">
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                            <div class="wh-form-group">
                                <label>性别</label>
                                <select id="wh_b_gender" class="wh-input">
                                    <option value="">--</option>
                                    ${genders.map(g => `<option value="${g.id}" ${isEdit && b.gender === g.id ? 'selected' : ''}>${g.icon} ${g.name}</option>`).join('')}
                                </select>
                            </div>
                            <div class="wh-form-group">
                                <label>年龄</label>
                                <input type="number" id="wh_b_age" class="wh-input" value="${isEdit && b.age ? b.age : ''}" min="16" max="70" step="1">
                            </div>
                        </div>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                            <div class="wh-form-group">
                                <label>学历</label>
                                <select id="wh_b_edu" class="wh-input">
                                    <option value="">--</option>
                                    ${educations.map(e => `<option value="${e.id}" ${isEdit && b.education === e.id ? 'selected' : ''}>${e.name}</option>`).join('')}
                                </select>
                            </div>
                            <div class="wh-form-group">
                                <label>邮箱</label>
                                <input type="text" id="wh_b_email" class="wh-input" value="${isEdit ? (b.email || '') : ''}">
                            </div>
                        </div>
                        <div class="wh-form-group">
                            <label>身份证号</label>
                            <input type="text" id="wh_b_idcard" class="wh-input" value="${isEdit ? (b.idCard || '') : ''}">
                        </div>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                            <div class="wh-form-group">
                                <label>籍贯</label>
                                <input type="text" id="wh_b_native" class="wh-input" value="${isEdit ? (b.nativePlace || '') : ''}">
                            </div>
                            <div class="wh-form-group">
                                <label>入职日期</label>
                                <input type="date" id="wh_b_join" class="wh-input" value="${isEdit && b.joinDate ? b.joinDate : ''}">
                            </div>
                        </div>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                            <div class="wh-form-group">
                                <label>紧急联系人</label>
                                <input type="text" id="wh_b_emerg" class="wh-input" value="${isEdit ? (b.emergencyContact || '') : ''}">
                            </div>
                            <div class="wh-form-group">
                                <label>紧急电话</label>
                                <input type="text" id="wh_b_emergphone" class="wh-input" value="${isEdit ? (b.emergencyPhone || '') : ''}">
                            </div>
                        </div>
                    </div>
                </details>

                <input type="hidden" id="wh_b_rebate" value="${((WarehouseData && WarehouseData.buyerRebateConfig) ? WarehouseData.buyerRebateConfig.defaultRebateRate : 0.00001) * 100}">
            </div>
        `;
        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>
            <button class="btn btn-primary" onclick="whUI.submitBuyerForm('${buyerId || ''}')">${isEdit ? '保存' : '确认添加'}</button>
        `;
        this.ui.showModal(isEdit ? `编辑采购员：${b.name}` : '添加采购员', content, footer, { width: '560px' });
    }

    // 提交采购员表单（完整基本信息）
    submitBuyerForm(buyerId) {
        const name = document.getElementById('wh_b_name')?.value || '';
        const employeeNo = document.getElementById('wh_b_empno')?.value || '';
        const gender = document.getElementById('wh_b_gender')?.value || '';
        const ageRaw = document.getElementById('wh_b_age')?.value;
        const idCard = document.getElementById('wh_b_idcard')?.value || '';
        const education = document.getElementById('wh_b_edu')?.value || '';
        const email = document.getElementById('wh_b_email')?.value || '';
        const phone = document.getElementById('wh_b_phone')?.value || '';
        const nativePlace = document.getElementById('wh_b_native')?.value || '';
        const emergencyContact = document.getElementById('wh_b_emerg')?.value || '';
        const emergencyPhone = document.getElementById('wh_b_emergphone')?.value || '';
        const departmentId = document.getElementById('wh_b_dept')?.value || '';
        const goodCategoriesRaw = document.getElementById('wh_b_cats')?.value || '';
        const rebateRatePct = parseFloat(document.getElementById('wh_b_rebate')?.value || '0');
        const joinDate = document.getElementById('wh_b_join')?.value || '';
        const status = document.getElementById('wh_b_status')?.value || 'active';
        const remark = document.getElementById('wh_b_remark')?.value || '';

        let age = null;
        if (ageRaw !== undefined && ageRaw !== null && ageRaw !== '') {
            age = parseInt(ageRaw);
            if (isNaN(age)) age = null;
        }
        const goodCategories = (goodCategoriesRaw || '')
            .split(/[,，、\s]+/g)
            .map(s => s.trim())
            .filter(s => s.length > 0);

        const form = {
            employeeNo, name, gender, age, idCard, education, email,
            phone, nativePlace, emergencyContact, emergencyPhone,
            departmentId, goodCategories,
            rebateRate: (rebateRatePct || 0) / 100,
            joinDate: joinDate || null,
            status, remark
        };

        const res = buyerId
            ? this.whState.updateBuyer(buyerId, form)
            : this.whState.addBuyer(form);
        if (!res.success) {
            this.ui.showToast('❌ ' + res.message, 'error');
            if (res.errors && res.errors.length > 0) console.warn('[采购员校验失败]', res.errors);
            return;
        }
        this.ui.showToast('✅ ' + res.message, 'success');
        this.ui.closeModal();
        this.refresh();
    }

    // 删除确认
    confirmDeleteBuyer(buyerId, name) {
        const plans = this.whState.getPurchasePlans({ buyerId });
        if (plans.length > 0) {
            if (!confirm(`采购员「${name}」当前关联 ${plans.length} 个采购计划，删除后计划仍保留但可能失效。\n确定继续删除？`)) return;
        } else {
            if (!confirm(`确定要删除采购员「${name}」吗？（有采购记录的无法删除，建议改为离职）`)) return;
        }
        const res = this.whState.deleteBuyer(buyerId);
        this.ui.showToast((res.success ? '✅ ' : '❌ ') + res.message, res.success ? 'success' : 'error');
        if (res.success) this.refresh();
    }

    // ====== 采购计划：新增/编辑 表单 ======
    openPurchasePlanForm(planId = null) {
        const isEdit = !!planId;
        const p = isEdit ? this.whState.getPurchasePlanById(planId) : null;
        if (isEdit && !p) { this.ui.showToast('采购计划不存在', 'error'); return; }

        const products = typeof getAllProducts === 'function' ? getAllProducts() : [];
        try { this.whState.syncBuyersFromEmployees({ silent: true }); } catch (e) {}
        const buyers = this.whState.getBuyers({ status: 'active' });
        if (buyers.length === 0) {
            this.ui.showToast('⚠️ 暂无在职采购员，请先在「员工管理」招聘采购员', 'warning');
            return;
        }
        const freqs = WarehouseData ? WarehouseData.purchasePlanFrequencies : [];
        const today = (this.gameState?.state?.gameTime?.day) || 1;
        const defaultStartDay = (isEdit && p.startDay) ? p.startDay : today;

        // 预置的 items HTML 行（编辑时渲染已有，否则空 1 行）
        const initialRows = isEdit && Array.isArray(p.items) && p.items.length > 0
            ? p.items.map(it => this._renderPlanItemRow(it, products)).join('')
            : this._renderPlanItemRow(null, products);

        const content = `
            <div class="wh-form" style="display:flex;flex-direction:column;gap:12px;">
                <div style="display:grid;grid-template-columns:2fr 1fr;gap:10px;">
                    <div class="wh-form-group">
                        <label>📝 计划名称（不填自动生成）</label>
                        <input type="text" id="wh_p_name" class="wh-input" value="${isEdit ? (p.name || '') : ''}" placeholder="例如：李明-每日百货补货">
                    </div>
                    <div class="wh-form-group">
                        <label>👤 负责采购员 <span style="color:#f44336;">*</span></label>
                        <select id="wh_p_buyer" class="wh-input">
                            ${buyers.map(b => `<option value="${b.id}" ${isEdit && p.buyerId === b.id ? 'selected' : ''}>${b.statusIcon||'✅'} ${b.departmentIcon||''} ${b.name} · ${b.departmentName}${b.phone?'（'+b.phone+'）':''}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
                    <div class="wh-form-group">
                        <label>🔁 采购频率 <span style="color:#f44336;">*</span></label>
                        <select id="wh_p_freq" class="wh-input">
                            ${freqs.map(f => `<option value="${f.id}" ${isEdit && p.frequency === f.id ? 'selected' : ''}>${f.icon} ${f.name}（每${f.intervalDays}天）· ${f.desc}</option>`).join('')}
                        </select>
                    </div>
                    <div class="wh-form-group">
                        <label>🚀 起始执行日（游戏天数）<span style="color:#f44336;">*</span></label>
                        <input type="number" id="wh_p_start" class="wh-input" value="${defaultStartDay}" min="1" step="1">
                        <div style="font-size:11px;color:#888;margin-top:4px;">今天：第 ${today} 天</div>
                    </div>
                    <div class="wh-form-group">
                        <label>⚙️ 启用状态</label>
                        <select id="wh_p_enabled" class="wh-input">
                            <option value="1" ${!isEdit || p.enabled ? 'selected' : ''}>✅ 启用（到点自动执行）</option>
                            <option value="0" ${isEdit && !p.enabled ? 'selected' : ''}>⏸ 停用（仅保存不执行）</option>
                        </select>
                    </div>
                </div>
                <div class="wh-form-group">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <label style="margin:0;">🛒 采购商品清单（种类 × 数量，至少 1 种）<span style="color:#f44336;">*</span></label>
                        <button class="btn btn-secondary btn-sm" type="button" onclick="whUI._addPlanItemRow()">➕ 增加商品</button>
                    </div>
                    <div id="wh_p_items" style="display:flex;flex-direction:column;gap:6px;">
                        ${initialRows}
                    </div>
                </div>
                <div class="wh-form-group">
                    <label>📝 计划备注（可选）</label>
                    <textarea id="wh_p_remark" class="wh-input" rows="2" placeholder="例如：库存低于阈值时自动补货、特殊供应商优先等">${isEdit ? (p.remark || '') : ''}</textarea>
                </div>
                <!-- 单次执行预估 -->
                <div id="wh_p_preview" style="padding:10px 12px;border-radius:10px;background:linear-gradient(135deg,#e8f5e9,#c8e6c9);font-size:12px;">
                    <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                        <span style="color:#33691e;">📦 单次执行：<b id="wh_p_sum_qty">0</b> 件商品</span>
                        <span style="color:#33691e;">💰 单次预算：<b id="wh_p_sum_amt">¥0.00</b></span>
                    </div>
                    <div style="color:#558b2f;font-size:11px;">💡 周期按计划频率重复执行；资金或容量不足时系统会跳过并写日志。</div>
                </div>
            </div>
            <script>
                setTimeout(function(){ whUI._bindPlanItemEvents(); }, 30);
            </script>
        `;
        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>
            <button class="btn btn-primary" onclick="whUI.submitPurchasePlanForm('${planId || ''}')">${isEdit ? '保存修改' : '创建采购计划'}</button>
        `;
        this.ui.showModal(isEdit ? `✏️ 编辑采购计划：${p.name || ''}` : '📋 新建采购计划（为采购员分配定期任务）', content, footer, { width: '820px' });
    }

    _renderPlanItemRow(it, products) {
        const sel = products.map(pr => {
            const sel = it && it.productId === pr.id ? 'selected' : '';
            return `<option value="${pr.id}" data-cost="${pr.basePrice||0}" data-name="${pr.name||pr.id}" ${sel}>${pr.name||pr.id}（成本¥${pr.basePrice||0}）</option>`;
        }).join('');
        const qty = it ? (it.quantity || '') : '';
        const cost = it ? (it.costPrice || '') : '';
        return `
            <div class="wh_plan_itemrow" style="display:grid;grid-template-columns:2fr 1fr 1fr 40px;gap:6px;align-items:center;">
                <select class="wh-input wh_p_item_prod" style="min-height:30px;" onchange="whUI._updatePlanItemCost(this)">
                    <option value="">-- 选择商品 --</option>
                    ${sel}
                </select>
                <input type="number" class="wh-input wh_p_item_qty" style="min-height:30px;" value="${qty}" placeholder="数量" min="1" step="1" oninput="whUI._updatePlanPreview()">
                <input type="number" class="wh-input wh_p_item_cost" style="min-height:30px;" value="${cost}" placeholder="成本单价" min="0" step="0.01" oninput="whUI._updatePlanPreview()">
                <button type="button" class="btn btn-secondary btn-sm" style="height:30px;padding:0 6px;" onclick="whUI._removePlanItemRow(this)">❌</button>
            </div>
        `;
    }

    _bindPlanItemEvents() {
        const rows = document.querySelectorAll('#wh_p_items .wh_plan_itemrow');
        rows.forEach(row => {
            const sel = row.querySelector('.wh_p_item_prod');
            if (sel) sel.addEventListener && sel.addEventListener('change', () => this._updatePlanItemCost(sel));
            const qty = row.querySelector('.wh_p_item_qty');
            if (qty) qty.addEventListener && qty.addEventListener('input', () => this._updatePlanPreview());
            const cost = row.querySelector('.wh_p_item_cost');
            if (cost) cost.addEventListener && cost.addEventListener('input', () => this._updatePlanPreview());
        });
        this._updatePlanPreview();
    }

    _updatePlanItemCost(selEl) {
        if (!selEl) return;
        const row = selEl.closest ? selEl.closest('.wh_plan_itemrow') : null;
        if (!row) return;
        const opt = selEl.selectedOptions && selEl.selectedOptions[0];
        const costEl = row.querySelector('.wh_p_item_cost');
        if (opt) {
            const c = parseFloat(opt.getAttribute('data-cost') || '0');
            if (costEl && (!costEl.value || parseFloat(costEl.value) === 0)) {
                costEl.value = c;
            }
        }
        this._updatePlanPreview();
    }

    _addPlanItemRow() {
        const box = document.getElementById('wh_p_items');
        if (!box) return;
        const products = typeof getAllProducts === 'function' ? getAllProducts() : [];
        const wrap = document.createElement('div');
        wrap.innerHTML = this._renderPlanItemRow(null, products);
        box.appendChild(wrap.firstElementChild);
        this._bindPlanItemEvents();
    }

    _removePlanItemRow(btnEl) {
        const row = btnEl && btnEl.closest ? btnEl.closest('.wh_plan_itemrow') : null;
        if (!row) return;
        const count = document.querySelectorAll('#wh_p_items .wh_plan_itemrow').length;
        if (count <= 1) { this.ui.showToast('至少保留一种商品', 'warning'); return; }
        row.remove();
        this._updatePlanPreview();
    }

    _updatePlanPreview() {
        const rows = document.querySelectorAll('#wh_p_items .wh_plan_itemrow');
        let qty = 0, amt = 0;
        rows.forEach(row => {
            const sel = row.querySelector('.wh_p_item_prod');
            const q = parseInt(row.querySelector('.wh_p_item_qty')?.value || '0') || 0;
            const c = parseFloat(row.querySelector('.wh_p_item_cost')?.value || '0') || 0;
            if (sel && sel.value) {
                qty += q;
                amt += q * c;
            }
        });
        const qEl = document.getElementById('wh_p_sum_qty');
        const aEl = document.getElementById('wh_p_sum_amt');
        if (qEl) qEl.textContent = qty;
        if (aEl) aEl.textContent = '¥' + amt.toFixed(2);
    }

    submitPurchasePlanForm(planId) {
        const name = document.getElementById('wh_p_name')?.value || '';
        const buyerId = document.getElementById('wh_p_buyer')?.value || '';
        const frequency = document.getElementById('wh_p_freq')?.value || '';
        const startDay = document.getElementById('wh_p_start')?.value || '';
        const enabledStr = document.getElementById('wh_p_enabled')?.value || '1';
        const remark = document.getElementById('wh_p_remark')?.value || '';

        const rows = document.querySelectorAll('#wh_p_items .wh_plan_itemrow');
        const items = [];
        rows.forEach(row => {
            const sel = row.querySelector('.wh_p_item_prod');
            const qEl = row.querySelector('.wh_p_item_qty');
            const cEl = row.querySelector('.wh_p_item_cost');
            if (!sel || !sel.value) return;
            const productId = sel.value;
            const opt = sel.selectedOptions && sel.selectedOptions[0];
            const productName = opt ? (opt.getAttribute('data-name') || productId) : productId;
            const quantity = parseInt(qEl?.value || '0') || 0;
            const costPrice = parseFloat(cEl?.value || '0') || 0;
            if (quantity > 0) items.push({ productId, productName, quantity, costPrice });
        });

        const form = {
            name, buyerId, frequency,
            startDay: startDay === '' ? null : parseInt(startDay),
            enabled: String(enabledStr) === '1',
            remark, items
        };
        const res = planId
            ? this.whState.updatePurchasePlan(planId, form)
            : this.whState.addPurchasePlan(form);
        if (!res.success) {
            this.ui.showToast('❌ ' + res.message, 'error');
            return;
        }
        this.ui.showToast('✅ ' + res.message, 'success');
        this.ui.closeModal();
        this.refresh();
    }

    // 查看某采购员回扣历史明细
    showBuyerRebateHistory(buyerId) {
        const b = this.whState.getBuyerById(buyerId);
        if (!b) { this.ui.showToast('采购员不存在', 'error'); return; }
        const records = this.whState.getRebateRecords(buyerId, 50);

        const content = `
            <div style="display:flex;flex-direction:column;gap:12px;">
                <div style="display:flex;align-items:center;gap:12px;padding:12px;border-radius:10px;background:linear-gradient(135deg,#fff8e1,#ffe0b2);">
                    <div style="font-size:40px;">👥</div>
                    <div style="flex:1;">
                        <div style="font-size:16px;font-weight:800;">${b.statusIcon} ${b.name} <span style="font-weight:400;font-size:12px;color:#666;">· ${b.departmentIcon}${b.departmentName}</span></div>
                        <div style="font-size:12px;color:#666;margin-top:2px;">
                            📱 ${b.phone} · 提成比例 <b style="color:#d84315;">${((b.rebateRate || 0) * 100).toFixed(3)}%</b> · 采购单数 ${b.purchaseOrderCount || 0}
                        </div>
                        <div style="margin-top:4px;display:flex;gap:20px;">
                            <div><span style="color:#666;font-size:11px;">累计采购：</span><b>${this.formatMoney(b.totalPurchaseAmount)}</b></div>
                            <div><span style="color:#666;font-size:11px;">累计提成：</span><b style="color:#d84315;">${this.formatMoney(b.totalRebate)}</b></div>
                        </div>
                    </div>
                </div>
                <div style="max-height:360px;overflow:auto;">
                    <table class="wh-table-simple" style="width:100%;border-collapse:collapse;">
                        <thead style="position:sticky;top:0;z-index:1;">
                            <tr style="background:#f5f5f5;">
                                <th style="padding:6px 8px;text-align:left;font-size:11px;">时间</th>
                                <th style="padding:6px 8px;text-align:left;font-size:11px;">入库单号</th>
                                <th style="padding:6px 8px;text-align:right;font-size:11px;">商品数</th>
                                <th style="padding:6px 8px;text-align:right;font-size:11px;">采购金额</th>
                                <th style="padding:6px 8px;text-align:right;font-size:11px;">提成(¥)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${records.length === 0 ? `
                                <tr><td colspan="5" style="padding:24px;text-align:center;color:#999;">暂无回扣记录 · 为该采购员分配采购入库单后自动生成</td></tr>
                            ` : records.map(r => `
                                <tr style="border-top:1px solid #f0f0f0;">
                                    <td style="padding:6px 8px;font-size:11px;color:#666;">第${r.day}天 · ${r.hour}时</td>
                                    <td style="padding:6px 8px;font-size:11px;font-family:monospace;">${String(r.inboundOrderId || '').substr(-6)}</td>
                                    <td style="padding:6px 8px;text-align:right;font-size:11px;">${r.quantity}</td>
                                    <td style="padding:6px 8px;text-align:right;font-size:11px;">${this.formatMoney(r.amount)}</td>
                                    <td style="padding:6px 8px;text-align:right;font-size:12px;font-weight:800;color:#d84315;">${this.formatMoney(r.rebate)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        this.ui.showModal(`${b.name} · 提成明细（最近50笔）`, content, `<button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>`, { width: '620px' });
    }

    // ===== 修改3：新建/编辑采购计划（新版调度UI）=====
    showPlanCreateModal(planIdOrBuyerId, presetBuyerId) {
        let planId = null;
        let buyerIdFromParam = presetBuyerId || null;

        if (planIdOrBuyerId && !presetBuyerId) {
            const checkPlan = this.whState.getPurchasePlanById(planIdOrBuyerId);
            if (checkPlan) {
                planId = planIdOrBuyerId;
            } else {
                buyerIdFromParam = planIdOrBuyerId;
            }
        }

        const isEdit = !!planId;
        const p = isEdit ? this.whState.getPurchasePlanById(planId) : null;

        try { this.whState.syncBuyersFromEmployees({ silent: true }); } catch (e) {}
        const buyers = this.whState.getBuyers({ status: 'active' });
        if (buyers.length === 0) {
            this.ui.showToast('⚠️ 暂无在职采购员，请先在「员工管理」招聘采购员', 'warning');
            return;
        }

        const allPlans = this.whState.getPurchasePlans();
        const seqNo = allPlans.length + 1;
        const defaultName = `在架自动补货 #${seqNo}`;

        const selBuyerId = (p && p.buyerId) || buyerIdFromParam || (buyers[0]?.id || '');
        const scheduleType = (p && p.scheduleType) || 'daily';
        const scheduleDay = (p && p.scheduleDay) ? parseInt(p.scheduleDay) : 1;
        const scheduleHour = (p && p.scheduleHour) ? parseInt(p.scheduleHour) : 10;
        const planMode = (p && p.planMode === 'direct') ? 'direct' : 'restock';
        const directItems = (p && Array.isArray(p.directItems)) ? p.directItems : [];
        const directPid = directItems[0] ? directItems[0].productId : '';
        const directQty = directItems[0] ? (directItems[0].quantity || 100) : 100;
        const directGrade = directItems[0] ? (directItems[0].qualityGrade || 'B') : 'B';
        const maxOrderValue = (p && p.maxOrderValue) ? parseInt(p.maxOrderValue) : 0;
        const maxFundRatio = (p && p._maxFundRatio) ? parseInt(p._maxFundRatio) : 80;
        const qtyMultiplier = (p && p.orderQuantityMultiplier) ? parseFloat(p.orderQuantityMultiplier) : 1.5;
        const enabled = p ? (p.enabled !== false) : true;
        const planName = (p && p.name) ? p.name : defaultName;
        const listedSkuCount = this._countActiveListedSkus();
        // 商品下拉：全部商品，格式「[商品ID] 名称」，供「指定商品直采」使用
        let productOptions = '';
        try {
            const listed = (this.gameState?.state?.listings || []).filter(l => l && l.status === 'active');
            const listedIds = new Set(listed.map(l => l.productId).filter(Boolean));
            const seen = new Set();
            const opts = [];
            listed.forEach(l => {
                if (!l.productId || seen.has(l.productId)) return;
                seen.add(l.productId);
                const prod = (typeof getProductById === 'function') ? getProductById(l.productId) : null;
                opts.push({
                    id: l.productId,
                    name: (prod && prod.name) || l.title || l.productId,
                    listed: true
                });
            });
            if (typeof PRODUCTS !== 'undefined') {
                PRODUCTS.forEach(prod => {
                    if (!prod || !prod.id || seen.has(prod.id)) return;
                    seen.add(prod.id);
                    opts.push({
                        id: prod.id,
                        name: prod.name,
                        listed: listedIds.has(prod.id)
                    });
                });
            }
            productOptions = opts.map(o =>
                `<option value="${o.id}" ${o.id === directPid ? 'selected' : ''}>[${o.id}] ${o.name}${o.listed ? ' ·在架' : ''}</option>`
            ).join('');
        } catch (_) { productOptions = ''; }

        const hourOptions = [];
        for (let h = 8; h <= 22; h++) {
            const sel = scheduleHour === h ? 'selected' : '';
            const display = (h < 10 ? '0' : '') + h + ':00';
            hourOptions.push(`<option value="${h}" ${sel}>${display}</option>`);
        }

        const weekDayOptions = ['周一','周二','周三','周四','周五','周六','周日'].map((name,idx) => {
            const d = idx + 1;
            const sel = scheduleDay === d ? 'selected' : '';
            return `<option value="${d}" ${sel}>${name}</option>`;
        }).join('');

        const monthDayOptions = [];
        for (let d = 1; d <= 28; d++) {
            const sel = scheduleDay === d ? 'selected' : '';
            monthDayOptions.push(`<option value="${d}" ${sel}>${d}号</option>`);
        }

        const multiplierOptions = [1, 1.5, 2, 3].map(v => {
            const sel = Math.abs(qtyMultiplier - v) < 0.001 ? 'selected' : '';
            return `<option value="${v}" ${sel}>${v}倍</option>`;
        }).join('');

        const content = `
            <div class="wh-form" style="display:flex;flex-direction:column;gap:12px;padding:4px 2px;">
                <div style="padding:10px 12px;border-radius:10px;background:linear-gradient(135deg,#e8f5e9,#f1f8e9);border:1px solid #c8e6c9;font-size:12px;color:#1b5e20;line-height:1.55;">
                    <b>默认推荐：自动补全部在架商品</b>（当前 ${listedSkuCount} 个）<br>
                    库存偏低时自动采购，无需逐个勾选。只有想「固定买某一种货」时才选直采。
                </div>

                <div class="wh-form-group">
                    <label>📝 计划名称</label>
                    <input type="text" id="wh_plan_name" class="wh-input" value="${planName}" placeholder="在架自动补货">
                </div>

                <div class="wh-form-group">
                    <label>👤 指派采购员 <span style="color:#f44336;">*</span></label>
                    <select id="wh_plan_buyer" class="wh-input">
                        ${buyers.map(b => `
                            <option value="${b.id}" ${selBuyerId === b.id ? 'selected' : ''}>
                                ${b.statusIcon||'✅'} ${b.name}
                            </option>
                        `).join('')}
                    </select>
                </div>

                <div style="padding:10px 12px;border-radius:10px;background:linear-gradient(135deg,#e3f2fd,#f5faff);border:1px solid #bbdefb;">
                    <div style="font-weight:700;font-size:13px;color:#0d47a1;margin-bottom:8px;">📅 多久检查一次</div>
                    <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
                        <label style="display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;background:#fff;border:1px solid #cfd8dc;cursor:pointer;font-size:13px;">
                            <input type="radio" name="wh_plan_schedtype" value="daily" ${scheduleType==='daily'?'checked':''} onchange="whUI._toggleScheduleFields()">
                            每日（推荐）
                        </label>
                        <label style="display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;background:#fff;border:1px solid #cfd8dc;cursor:pointer;font-size:13px;">
                            <input type="radio" name="wh_plan_schedtype" value="weekly" ${scheduleType==='weekly'?'checked':''} onchange="whUI._toggleScheduleFields()">
                            每周
                        </label>
                        <label style="display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;background:#fff;border:1px solid #cfd8dc;cursor:pointer;font-size:13px;">
                            <input type="radio" name="wh_plan_schedtype" value="monthly" ${scheduleType==='monthly'?'checked':''} onchange="whUI._toggleScheduleFields()">
                            每月
                        </label>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                        <div id="wh_plan_sday_wrap" style="${scheduleType==='daily'?'display:none;':''}">
                            <label style="font-size:11px;color:#555;">选择${scheduleType==='weekly'?'星期':'日期'}</label>
                            <select id="wh_plan_sday" class="wh-input" style="min-height:32px;">
                                ${scheduleType==='monthly' ? monthDayOptions : weekDayOptions}
                            </select>
                        </div>
                        <div>
                            <label style="font-size:11px;color:#555;">开始检查时间</label>
                            <select id="wh_plan_shour" class="wh-input" style="min-height:32px;">
                                ${hourOptions.join('')}
                            </select>
                        </div>
                    </div>
                </div>

                <div style="padding:10px 12px;border-radius:10px;background:linear-gradient(135deg,#fff8e1,#fffdf5);border:1px solid #ffe082;">
                    <div style="font-weight:700;font-size:13px;color:#e65100;margin-bottom:8px;">🛒 补货方式</div>
                    <label style="display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border-radius:8px;background:#fff;border:1px solid #cfd8dc;cursor:pointer;font-size:12px;margin-bottom:6px;">
                        <input type="radio" name="wh_plan_mode" value="restock" ${planMode==='restock'?'checked':''} onchange="whUI._togglePlanModeFields()" style="margin-top:2px;">
                        <span>
                            <b>自动补全部在架商品</b>
                            <div style="font-size:11px;color:#666;margin-top:2px;">覆盖当前 ${listedSkuCount} 个在架 SKU，库存低了就补，不用手动选品</div>
                        </span>
                    </label>
                    <label style="display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border-radius:8px;background:#fff;border:1px solid #cfd8dc;cursor:pointer;font-size:12px;">
                        <input type="radio" name="wh_plan_mode" value="direct" ${planMode==='direct'?'checked':''} onchange="whUI._togglePlanModeFields()" style="margin-top:2px;">
                        <span>
                            <b>指定商品直采</b>
                            <div style="font-size:11px;color:#666;margin-top:2px;">只固定采购某一种商品（进货用）</div>
                        </span>
                    </label>
                    <div id="wh_plan_direct_wrap" style="margin-top:8px;${planMode!=='direct'?'display:none;':''}">
                        <label style="font-size:11px;color:#555;">选择商品</label>
                        <input type="text" id="wh_plan_direct_search" class="wh-input" placeholder="输入商品ID或名称筛选"
                               style="min-height:32px;margin-bottom:6px;" oninput="whUI._filterPlanProductSelect()">
                        <select id="wh_plan_direct_pid" class="wh-input" style="min-height:34px;margin-bottom:6px;" size="5">
                            ${productOptions || '<option value="">暂无商品</option>'}
                        </select>
                        <label style="font-size:11px;color:#555;">每次采购数量</label>
                        <input type="number" id="wh_plan_direct_qty" class="wh-input" value="${directQty}" min="1" step="1" style="min-height:34px;margin-bottom:6px;">
                        <label style="font-size:11px;color:#555;">采购品质（影响成本/质量/售价）</label>
                        <select id="wh_plan_direct_grade" class="wh-input" style="min-height:34px;">
                            <option value="A" ${directGrade==='A'?'selected':''}>A货 · 优质（成本高、差评少）</option>
                            <option value="B" ${directGrade==='B'?'selected':''}>B货 · 常规（性价比）</option>
                            <option value="C" ${directGrade==='C'?'selected':''}>C货 · 低价（成本低、风险高）</option>
                        </select>
                    </div>
                </div>

                <details style="padding:10px 12px;border-radius:10px;background:#fafafa;border:1px solid #eee;">
                    <summary style="cursor:pointer;font-weight:700;font-size:13px;color:#555;">⚙️ 高级参数（一般不用改）</summary>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;">
                        <div>
                            <label style="font-size:11px;color:#555;">单次最大金额（元，0=不限制）</label>
                            <input type="number" id="wh_plan_maxamt" class="wh-input" value="${maxOrderValue}" min="0" step="1000" style="min-height:32px;">
                        </div>
                        <div>
                            <label style="font-size:11px;color:#555;">最多占资金（%）</label>
                            <input type="number" id="wh_plan_maxratio" class="wh-input" value="${maxFundRatio}" min="1" max="100" step="1" style="min-height:32px;">
                        </div>
                    </div>
                    <div style="margin-top:8px;">
                        <label style="font-size:11px;color:#555;">补货量倍率（越高补得越多）</label>
                        <select id="wh_plan_qtymul" class="wh-input" style="min-height:32px;">
                            ${multiplierOptions}
                        </select>
                    </div>
                </details>

                <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:10px;background:#f5f5f5;">
                    <input type="checkbox" id="wh_plan_enabled" ${enabled?'checked':''} style="width:16px;height:16px;">
                    <label for="wh_plan_enabled" style="font-size:13px;font-weight:600;margin:0;">启用计划（保存后可立刻执行一次）</label>
                </div>
            </div>
            <script>
                setTimeout(function(){ whUI._toggleScheduleFields(); whUI._togglePlanModeFields(); }, 30);
            </script>
        `;

        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>
            <button class="btn btn-primary" style="padding:8px 18px;font-weight:700;border-radius:8px;"
                    onclick="whUI.submitPlanCreateModal('${planId || ''}')">
                📋 ${isEdit ? '保存修改' : '保存并立即执行'}
            </button>
        `;

        this.ui.showModal(
            isEdit ? `✏️ 编辑采购计划` : '📋 新建在架自动补货',
            content,
            footer,
            { width: '460px' }
        );
    }

    // 调度类型切换时显示/隐藏 scheduleDay
    _toggleScheduleFields() {
        const radios = document.getElementsByName('wh_plan_schedtype');
        let selected = 'daily';
        radios.forEach(r => { if (r.checked) selected = r.value; });
        const dayWrap = document.getElementById('wh_plan_sday_wrap');
        const daySel = document.getElementById('wh_plan_sday');
        if (!dayWrap) return;
        if (selected === 'daily') {
            dayWrap.style.display = 'none';
        } else {
            dayWrap.style.display = '';
            if (daySel) {
                if (selected === 'weekly') {
                    const curVal = parseInt(daySel.value) || 1;
                    daySel.innerHTML = ['周一','周二','周三','周四','周五','周六','周日']
                        .map((n,i)=>`<option value="${i+1}" ${curVal===i+1?'selected':''}>${n}</option>`).join('');
                } else {
                    const curVal = parseInt(daySel.value) || 1;
                    let opts = '';
                    for (let d = 1; d <= 28; d++) {
                        opts += `<option value="${d}" ${curVal===d?'selected':''}>${d}号</option>`;
                    }
                    daySel.innerHTML = opts;
                }
            }
        }
    }

    _togglePlanModeFields() {
        const radios = document.getElementsByName('wh_plan_mode');
        let mode = 'restock';
        radios.forEach(r => { if (r.checked) mode = r.value; });
        const direct = document.getElementById('wh_plan_direct_wrap');
        if (direct) direct.style.display = mode === 'direct' ? '' : 'none';
    }

    /** 直采下拉：按商品ID/名称筛选 */
    _filterPlanProductSelect() {
        const q = (document.getElementById('wh_plan_direct_search')?.value || '').trim().toLowerCase();
        const sel = document.getElementById('wh_plan_direct_pid');
        if (!sel) return;
        Array.from(sel.options).forEach(opt => {
            if (!opt.value) { opt.hidden = false; return; }
            const text = (opt.textContent || '').toLowerCase();
            opt.hidden = !!(q && !text.includes(q) && !(opt.value || '').toLowerCase().includes(q));
        });
    }

    // 提交新计划表单
    submitPlanCreateModal(planId) {
        const name = (document.getElementById('wh_plan_name')?.value || '').trim();
        const buyerId = document.getElementById('wh_plan_buyer')?.value || '';
        if (!buyerId) { this.ui.showToast('请选择采购员', 'error'); return; }

        const radios = document.getElementsByName('wh_plan_schedtype');
        let scheduleType = 'daily';
        radios.forEach(r => { if (r.checked) scheduleType = r.value; });

        const scheduleDay = parseInt(document.getElementById('wh_plan_sday')?.value || '1') || 1;
        const scheduleHour = parseInt(document.getElementById('wh_plan_shour')?.value || '8') || 8;

        const modeRadios = document.getElementsByName('wh_plan_mode');
        let planMode = 'restock';
        modeRadios.forEach(r => { if (r.checked) planMode = r.value; });

        // 自动补货默认覆盖全部在架商品；直采才限定单个商品
        let scope = 'all';
        let targetProductIds = [];
        let directItems = [];
        if (planMode === 'direct') {
            const pid = document.getElementById('wh_plan_direct_pid')?.value || '';
            const qty = parseInt(document.getElementById('wh_plan_direct_qty')?.value || '0', 10) || 0;
            const gradeRaw = (document.getElementById('wh_plan_direct_grade')?.value || 'B').toUpperCase();
            const qualityGrade = (gradeRaw === 'A' || gradeRaw === 'C') ? gradeRaw : 'B';
            if (!pid) { this.ui.showToast('请选择要直采的商品', 'error'); return; }
            if (qty <= 0) { this.ui.showToast('请填写采购数量', 'error'); return; }
            // 禁购管制
            try {
                if (this.gameState && typeof this.gameState.isProductControlled === 'function') {
                    const ban = this.gameState.isProductControlled(pid, 'buy');
                    if (ban) { this.ui.showToast(ban.reason || '该商品当前禁购', 'error'); return; }
                }
            } catch (_) {}
            directItems = [{ productId: pid, quantity: qty, qualityGrade }];
            targetProductIds = [pid];
            scope = 'custom';
        }

        const maxOrderValue = parseFloat(document.getElementById('wh_plan_maxamt')?.value || '0') || 0;
        const maxFundRatio = parseFloat(document.getElementById('wh_plan_maxratio')?.value || '0') || 0;
        const orderQuantityMultiplier = parseFloat(document.getElementById('wh_plan_qtymul')?.value || '1') || 1;
        const enabled = !!document.getElementById('wh_plan_enabled')?.checked;

        const allPlans = this.whState.getPurchasePlans();
        const finalName = name || (planMode === 'direct'
            ? `指定商品直采 #${allPlans.length + 1}`
            : `采购员自动补货计划 #${allPlans.length + 1}`);

        const form = {
            name: finalName,
            buyerId,
            scheduleType,
            scheduleDay,
            scheduleHour,
            planMode,
            directItems,
            targetProductIds,
            _targetScope: scope,
            _maxFundRatio: maxFundRatio,
            minOrderValue: 0,
            maxOrderValue,
            orderQuantityMultiplier,
            enabled
        };

        let res;
        if (planId) {
            const oldPlan = this.whState.getPurchasePlanById(planId);
            if (oldPlan && (oldPlan.scheduleType || form.scheduleType || form.directItems)) {
                res = this.whState.updatePurchasePlan(planId, form);
            } else if (oldPlan) {
                // 旧计划：尽量用 update；失败则新建并删旧
                res = this.whState.updatePurchasePlan(planId, form);
                if (!res.success) {
                    res = this.whState.addPurchasePlan(form);
                    if (res.success) this.whState.deletePurchasePlan(planId);
                }
            } else {
                res = this.whState.addPurchasePlan(form);
            }
        } else {
            res = this.whState.addPurchasePlan(form);
        }

        if (!res.success) {
            this.ui.showToast('❌ ' + res.message, 'error');
            return;
        }
        this.ui.showToast('✅ ' + (res.message || '保存成功'), 'success');
        this.ui.closeModal();
        this.buyerCurrentSubTab = 'plan';
        // 新建/启用后立刻跑一次，让效果可见
        const savedId = (res.data && res.data.id) || planId || (this.whState.state.purchasePlans && this.whState.state.purchasePlans[0] && this.whState.state.purchasePlans[0].id);
        if (enabled && savedId) {
            const run = this.whState.runPurchasePlanNow(savedId);
            this.ui.showToast(run.message, run.success ? 'success' : 'error');
        }
        this.refresh();
    }

    // ===== 修改4：采购员绩效弹窗 =====
    showBuyerPerformance(buyerId) {
        const b = this.whState.getBuyerById(buyerId);
        if (!b) { this.ui.showToast('采购员不存在', 'error'); return; }

        const summary = this.whState.getBuyerSummary();
        const allRecords = this.whState.getRebateRecords(buyerId, 9999) || [];
        const buyerRecords = allRecords.filter(r => r.buyerId === buyerId);
        const totalSkuCount = b.totalPurchaseSkuCount || (b.totalPurchaseAmount ? Math.floor(b.totalPurchaseAmount / 100) + 5 : 0);
        const totalPurchaseAmount = Number(b.totalPurchaseAmount || 0);
        const totalRebate = Number(b.totalRebate || 0);
        const purchaseOrderCount = Number(b.purchaseOrderCount || 0) || buyerRecords.length;
        const avgUnitPrice = purchaseOrderCount > 0 ? (totalPurchaseAmount / purchaseOrderCount) : 0;

        const supplierSet = new Set();
        buyerRecords.forEach(r => {
            if (r.supplierId) supplierSet.add(r.supplierId);
            if (r.supplierName) supplierSet.add(r.supplierName);
        });
        const supplierCount = supplierSet.size > 0 ? supplierSet.size : Math.min(Math.floor(purchaseOrderCount / 3) + 2, 15);

        const levelInfo = b.education
            ? (WarehouseData?.buyerEducation?.find(e => e.id === b.education)?.name || '普通')
            : (b.level ? b.level : '普通');

        const joinDateStr = b.joinDate ? new Date(b.joinDate).toLocaleDateString() : (b.joinDay ? `第${b.joinDay}天` : '未知');

        const content = `
            <div style="display:flex;flex-direction:column;gap:12px;padding:4px 2px;">
                <div style="display:flex;align-items:center;gap:12px;padding:14px;border-radius:12px;background:linear-gradient(135deg,#1976d2,#42a5f5);color:#fff;">
                    <div style="font-size:42px;">${b.departmentIcon||'👤'}</div>
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:16px;font-weight:800;">${b.statusIcon||''} ${b.name}</div>
                        <div style="font-size:12px;opacity:0.9;margin-top:3px;">
                            ${b.departmentIcon||'🏢'} ${b.departmentName||'采购部'} · 入职：${joinDateStr}
                        </div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:11px;opacity:0.8;">等级</div>
                        <div style="font-size:15px;font-weight:800;">⭐ ${levelInfo}</div>
                    </div>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                    <div style="padding:12px;border-radius:10px;background:linear-gradient(135deg,#e3f2fd,#f5faff);border:1px solid #bbdefb;">
                        <div style="font-size:10px;color:#1565c0;font-weight:600;margin-bottom:4px;">🛒 采购SKU数</div>
                        <div style="font-size:20px;font-weight:800;color:#0d47a1;">${totalSkuCount.toLocaleString()}</div>
                    </div>
                    <div style="padding:12px;border-radius:10px;background:linear-gradient(135deg,#e8f5e9,#f5fff7);border:1px solid #c8e6c9;">
                        <div style="font-size:10px;color:#2e7d32;font-weight:600;margin-bottom:4px;">📋 采购单数量</div>
                        <div style="font-size:20px;font-weight:800;color:#1b5e20;">${purchaseOrderCount.toLocaleString()}</div>
                    </div>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                    <div style="padding:12px;border-radius:10px;background:linear-gradient(135deg,#fff8e1,#fffdf5);border:1px solid #ffe082;">
                        <div style="font-size:10px;color:#ef6c00;font-weight:600;margin-bottom:4px;">💰 累计采购金额</div>
                        <div style="font-size:18px;font-weight:800;color:#e65100;">¥${totalPurchaseAmount.toLocaleString()}</div>
                    </div>
                    <div style="padding:12px;border-radius:10px;background:linear-gradient(135deg,#fce4ec,#fff5f8);border:1px solid #f8bbd0;">
                        <div style="font-size:10px;color:#c2185b;font-weight:600;margin-bottom:4px;">🎁 累计提成金额（0.001%）</div>
                        <div style="font-size:18px;font-weight:800;color:#880e4f;">¥${totalRebate.toLocaleString()}</div>
                    </div>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                    <div style="padding:12px;border-radius:10px;background:linear-gradient(135deg,#f3e5f5,#faf5ff);border:1px solid #e1bee7;">
                        <div style="font-size:10px;color:#6a1b9a;font-weight:600;margin-bottom:4px;">📊 平均成交单价</div>
                        <div style="font-size:18px;font-weight:800;color:#4a148c;">¥${avgUnitPrice.toFixed(2)}</div>
                    </div>
                    <div style="padding:12px;border-radius:10px;background:linear-gradient(135deg,#e0f7fa,#f5fffe);border:1px solid #b2ebf2;">
                        <div style="font-size:10px;color:#00838f;font-weight:600;margin-bottom:4px;">🤝 供应商合作数</div>
                        <div style="font-size:18px;font-weight:800;color:#006064;">${supplierCount} 家</div>
                    </div>
                </div>

                <div style="padding:10px 12px;border-radius:10px;background:#fafafa;border:1px solid #eee;font-size:11px;color:#666;line-height:1.6;">
                    💡 提成说明：按采购金额 × <b style="color:#d84315;">0.001%（固定比例）</b> 计算，
                    月度结算日自动发放。本月待发提成 ¥${(b.pendingRebate||0).toLocaleString()}。
                </div>
            </div>
        `;

        const footer = `
            <button class="btn btn-secondary" onclick="whUI.showBuyerPurchaseOrders('${b.id}')">📋 查看采购单</button>
            <button class="btn btn-primary" onclick="ui.closeModal()">关闭</button>
        `;

        this.ui.showModal(`📊 ${b.name} · 采购绩效看板`, content, footer, { width: '420px' });
    }

    /** 查看某采购员的关联采购单列表（含在途与已入库） */
    showBuyerPurchaseOrders(buyerId) {
        const b = this.whState.getBuyerById(buyerId);
        if (!b) { this.ui.showToast('采购员不存在', 'error'); return; }
        const all = (this.whState.gameState && this.whState.gameState.state
            && Array.isArray(this.whState.gameState.state.purchaseOrders))
            ? this.whState.gameState.state.purchaseOrders : [];
        const orders = all.filter(o => o && (o.buyerId === buyerId || o.buyerId === String(buyerId)));
        const statusMap = {
            pending: { name: '待发货', color: '#ff9800' },
            shipping: { name: '运输中', color: '#2196f3' },
            received: { name: '已入库', color: '#4caf50' }
        };
        const today = (this.whState.gameState && this.whState.gameState.state
            && this.whState.gameState.state.gameTime && this.whState.gameState.state.gameTime.day) || 1;
        const content = `
            <div style="padding:2px 0;">
                <div style="font-size:12px;color:#666;margin-bottom:10px;">
                    ${b.name} 的关联采购单（${orders.length} 笔）。采购计划自动下单或手工入库都会记录在这里。
                </div>
                ${orders.length === 0
                    ? `<div style="text-align:center;color:#999;padding:32px 0;font-size:13px;">暂无关联采购单<br><span style="font-size:11px;">采购计划执行下单后，这里会显示在途/已入库的采购单</span></div>`
                    : `<div style="max-height:46vh;overflow-y:auto;display:flex;flex-direction:column;gap:8px;">
                        ${orders.slice(-60).reverse().map(o => {
                            const st = statusMap[o.status] || { name: o.status || '未知', color: '#999' };
                            const remainDays = Math.max(0, (o.expectedArrivalDay || today) - today);
                            let etaText = '已入库';
                            if (o.status !== 'received') etaText = o.status === 'pending' ? `约第${o.expectedArrivalDay || '?'}天到` : (remainDays <= 0 ? '今日到货' : `还有${remainDays}天`);
                            return `
                            <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#fff;border:1px solid #f0f0f0;border-radius:10px;">
                                <div style="font-size:20px;">📦</div>
                                <div style="flex:1;min-width:0;">
                                    <div style="font-size:13px;font-weight:700;">${(o.productName || o.productId || '商品')}${o.source === 'auto_plan' ? ' <span style="font-size:10px;color:#888;">(自动补货)</span>' : ''}</div>
                                    <div style="font-size:11px;color:#666;margin-top:2px;">第${(o.createTime && o.createTime.day) || '?'}天下单 · ${Number(o.quantity || 0).toLocaleString('en-US')}件 · ¥${Number(o.totalAmount || 0).toLocaleString()}</div>
                                    <div style="font-size:11px;font-weight:700;margin-top:2px;color:${st.color};">${st.name} · ${etaText}</div>
                                </div>
                            </div>`;
                        }).join('')}
                    </div>`}
            </div>`;
        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal();whUI.showBuyerPerformance('${buyerId}')">返回绩效</button>
            <button class="btn btn-primary" onclick="ui.closeModal()">关闭</button>`;
        this.ui.showModal(`📋 ${b.name} · 关联采购单`, content, footer, { width: '440px' });
    }

}

// 全局实例
let whUI = null;

/** 未就绪时的空安全代理，避免 onclick="whUI.xxx" 直接 ReferenceError */
function _installWhUIProxy() {
    if (typeof window === 'undefined') return;
    window.WarehouseUI = WarehouseUI;
    if (whUI) {
        window.whUI = whUI;
        return;
    }
    if (window.whUI && window.whUI.__isWhUIProxy) return;
    window.whUI = new Proxy({}, {
        get(_t, prop) {
            if (prop === '__isWhUIProxy') return true;
            if (whUI && typeof whUI[prop] !== 'undefined') {
                const v = whUI[prop];
                return typeof v === 'function' ? v.bind(whUI) : v;
            }
            return function () {
                try {
                    if (typeof ui !== 'undefined' && ui.showToast) {
                        ui.showToast('仓储模块未就绪，请稍后再试', 1800);
                    }
                } catch (_) {}
                console.warn('[whUI] 模块未就绪，忽略调用:', String(prop));
                return undefined;
            };
        }
    });
}

function initWarehouseUI(warehouseState, gameState, uiManager) {
    if (!whUI) {
        whUI = new WarehouseUI(warehouseState, gameState, uiManager);
    }
    _installWhUIProxy();
    window.whUI = whUI;
    return whUI;
}

// 模块外兜底：尽早挂代理，脚本加载后即可安全引用 whUI
_installWhUIProxy();
setTimeout(() => {
    if (typeof window !== 'undefined' && whUI) window.whUI = whUI;
}, 0);

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { WarehouseUI, initWarehouseUI };
}
