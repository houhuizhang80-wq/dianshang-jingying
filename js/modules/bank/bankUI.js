/**
 * 银行模块 - UI渲染
 * 独立的银行UI组件，通过事件总线与业务层通信
 * 优化：使用增量更新，避免全量重渲染
 */
class BankUI {
    constructor() {
        this._currentTab = 'deposit';
        this._modalVisible = false;
        this._modalEl = null;
        this._initialized = false;
    }

    /**
     * 初始化银行UI
     */
    init() {
        if (this._initialized) return;
        this._bindEvents();
        this._initialized = true;
        console.log('[BankUI] 银行UI模块初始化完成');
    }

    /**
     * 绑定事件
     */
    _bindEvents() {
        // 监听银行状态变化，局部更新UI
        eventBus.on('bank:stateChanged', () => {
            if (this._modalVisible) {
                this._updateModalContent();
            }
        });

        // 监听操作结果
        eventBus.on('bank:deposit:success', (data) => {
            this._showToast(`成功存入 ${formatMoney(data.amount)}`);
        });
        eventBus.on('bank:withdraw:success', (data) => {
            this._showToast(`成功取出 ${formatMoney(data.amount)}`);
        });
        eventBus.on('bank:fixedDeposit:success', () => {
            this._showToast('定期存款成功！');
            this.switchTab('fixed');
        });
        eventBus.on('bank:fixedWithdraw:success', (data) => {
            this._showToast(`支取成功，到账 ${formatMoney(data.totalAmount)}`);
        });
        eventBus.on('bank:wealth:success', () => {
            this._showToast('理财申购成功！');
            this.switchTab('wealth');
        });
        eventBus.on('bank:wealthWithdraw:success', (data) => {
            const r = data && data.result;
            if (r) {
                const interest = Number(r.interest) || 0;
                this._showToast(interest >= 0
                    ? `赎回成功，到账 ${formatMoney(r.totalAmount)}（收益 +${formatMoney(interest)}）`
                    : `赎回成功，到账 ${formatMoney(r.totalAmount)}（亏损 -${formatMoney(Math.abs(interest))}）`);
            }
        });
        eventBus.on('bank:loan:success', () => {
            this._showToast('借款成功，资金已到账');
            this.switchTab('loan');
        });
        eventBus.on('bank:repay:success', (data) => {
            this._showToast(`成功还款 ${formatMoney(data.repaid)}`);
        });
    }

    /**
     * 获取游戏上下文（通过事件总线缓存获取）
     */
    _getGameContext() {
        return eventBus._gameContextCache || eventBus._gameContext || {
            shopLevel: 1,
            shopReputation: 50,
            funds: 0,
            day: 1,
            hour: 8,
            totalTurnover: 0
        };
    }

    // ========== 弹窗控制 ==========

    /**
     * 显示银行弹窗
     */
    showModal() {
        this._currentTab = 'deposit';
        this._modalVisible = true;
        this._renderFullModal();
    }

    /**
     * 关闭银行弹窗
     */
    closeModal() {
        this._modalVisible = false;
        const overlay = document.getElementById('bankModalOverlay');
        if (overlay) {
            overlay.remove();
        }
        this._modalEl = null;
    }

    /**
     * 切换Tab
     */
    switchTab(tab) {
        this._currentTab = tab;
        if (this._modalVisible) {
            this._updateTabContent();
            this._updateTabButtons();
        }
    }

    // ========== 完整渲染 ==========

    /**
     * 完整渲染银行弹窗
     */
    _renderFullModal() {
        const ctx = this._getGameContext();
        const state = bankState.state;
        const tabs = [
            { id: 'deposit', name: '存款' },
            { id: 'fixed', name: '定期' },
            { id: 'wealth', name: '理财' },
            { id: 'loan', name: '贷款' },
            { id: 'records', name: '记录' }
        ];

        const html = `
            <div id="bankModalOverlay" class="modal-overlay" onclick="bankUI._handleOverlayClick(event)">
                <div class="modal-content bank-modal" onclick="event.stopPropagation()">
                    <div class="modal-body" id="bankModalBody">
                        ${this._renderHeader(ctx, state)}
                        <div class="bank-tabs" id="bankTabButtons">
                            ${tabs.map(t => `
                                <button class="bank-tab-btn ${this._currentTab === t.id ? 'active' : ''}" 
                                        data-tab="${t.id}"
                                        onclick="bankUI.switchTab('${t.id}')">
                                    ${t.name}
                                </button>
                            `).join('')}
                        </div>
                        <div class="bank-tab-content" id="bankTabContent">
                            ${this._renderTabContent(ctx, state)}
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" onclick="bankUI.closeModal()">关闭</button>
                    </div>
                </div>
            </div>
        `;

        // 移除旧的
        const old = document.getElementById('bankModalOverlay');
        if (old) old.remove();

        // 插入新的
        const wrapper = document.createElement('div');
        wrapper.innerHTML = html;
        document.body.appendChild(wrapper.firstElementChild);
        
        this._modalEl = document.getElementById('bankModalOverlay');
    }

    /**
     * 渲染头部
     */
    _renderHeader(ctx, state) {
        const totalFixed = state.fixedDeposits
            .filter(d => d.status === 'active')
            .reduce((s, d) => s + d.amount + d.earnedInterest, 0);
        const totalWealth = (state.wealthInvestments || [])
            .filter(x => x.status === 'active')
            .reduce((s, x) => s + x.amount, 0);
        const totalAssets = state.savings + totalFixed + totalWealth;
        const totalLiabilities = bankState.getUsedCredit();
        const netAssets = totalAssets - totalLiabilities;

        return `
            <div class="bank-header">
                <div class="bank-header-icon">🏦</div>
                <div class="bank-header-title">银行系统</div>
                <div class="bank-header-subtitle">
                    净资产: <span class="${netAssets >= 0 ? 'text-success' : 'text-danger'}">${formatMoney(netAssets)}</span>
                </div>
            </div>
        `;
    }

    // ========== Tab 内容渲染 ==========

    /**
     * 渲染当前Tab内容
     */
    _renderTabContent(ctx, state) {
        switch (this._currentTab) {
            case 'deposit': return this._renderDepositTab(ctx, state);
            case 'fixed': return this._renderFixedTab(ctx, state);
            case 'wealth': return this._renderWealthTab(ctx, state);
            case 'loan': return this._renderLoanTab(ctx, state);
            case 'records': return this._renderRecordsTab(state);
            default: return '';
        }
    }

    /**
     * 存款Tab
     */
    _renderDepositTab(ctx, state) {
        const currentRate = BankData.currentDeposit;
        const annualPct = ((currentRate.annualRate || 0) * 100).toFixed(2);
        return `
            <div class="bank-tab-body">
                <div class="bank-summary-card savings-card">
                    <div class="bank-summary-label">💰 活期存款余额</div>
                    <div class="bank-summary-amount" id="bankSavingsAmount">${formatMoney(state.savings)}</div>
                    <div class="bank-summary-desc">年化 ${annualPct}%（参考国内活期利率）· 按日计息</div>
                </div>
                <div class="bank-form-row">
                    <div class="bank-form-item">
                        <label class="bank-form-label">存款金额</label>
                        <input type="number" id="depositAmount" placeholder="请输入金额" min="1" step="1">
                    </div>
                    <div class="bank-form-actions">
                        <button class="btn btn-success" onclick="bankUI.doDeposit()">存入</button>
                        <button class="btn btn-secondary btn-small" onclick="bankUI._fillDepositAll()">全部</button>
                    </div>
                </div>
                <div class="bank-form-row">
                    <div class="bank-form-item">
                        <label class="bank-form-label">取款金额</label>
                        <input type="number" id="withdrawAmount" placeholder="请输入金额" min="1" step="1">
                    </div>
                    <div class="bank-form-actions">
                        <button class="btn btn-warning" onclick="bankUI.doWithdraw()">取出</button>
                        <button class="btn btn-secondary btn-small" onclick="bankUI._fillWithdrawAll()">全部</button>
                    </div>
                </div>
                <div class="bank-tip-box">
                    <div class="bank-tip-title">💡 温馨提示</div>
                    <div class="bank-tip-content">
                        <div>• 活期存款随存随取，每日0点结算利息</div>
                        <div>• 当前可用资金: <span id="bankFundsAmount">${formatMoney(ctx.funds)}</span></div>
                        <div>• 存入银行的资金不影响经营，随时可取</div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 定期Tab
     */
    _renderFixedTab(ctx, state) {
        const activeFixed = state.fixedDeposits.filter(d => d.status === 'active');
        
        return `
            <div class="bank-tab-body">
                <div class="bank-section-title">📋 定期存款产品（利率参考国内挂牌利率）</div>
                <div class="bank-product-list">
                    ${BankData.fixedDeposits.map(product => {
                        const canBuy = ctx.funds >= product.minAmount;
                        const annualPct = ((product.annualRate || 0) * 100).toFixed(2);
                        const sample = 10000 * (product.annualRate || 0) * product.termDays / 365;
                        return `
                            <div class="bank-product-card">
                                <div class="bank-product-header">
                                    <div>
                                        <div class="bank-product-name">${product.name}</div>
                                        <div class="bank-product-desc">${product.description}</div>
                                    </div>
                                    <div class="bank-product-rate">
                                        <div class="bank-product-rate-value">${annualPct}%</div>
                                        <div class="bank-product-rate-label">年化利率</div>
                                    </div>
                                </div>
                                <div class="bank-product-meta">
                                    期限 ${product.termDays}天 · 起存 ¥${product.minAmount.toLocaleString()} · 存1万到期利息约 ¥${sample.toFixed(2)}
                                </div>
                                <div class="bank-product-footer">
                                    <button class="btn btn-primary btn-small ${!canBuy ? 'disabled' : ''}"
                                            ${!canBuy ? 'disabled' : ''}
                                            onclick="bankUI.showFixedDepositModal('${product.id}')">
                                        存入
                                    </button>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
                <div class="bank-section-title">
                    📊 我的定期 (${activeFixed.length}笔)
                </div>
                <div class="bank-list" id="bankFixedList">
                    ${activeFixed.length === 0 ? `
                        <div class="bank-empty">暂无定期存款</div>
                    ` : activeFixed.map(deposit => this._renderFixedItem(deposit, ctx.day)).join('')}
                </div>
            </div>
        `;
    }

    _renderFixedItem(deposit, currentDay) {
        const daysPassed = currentDay - deposit.startDay;
        const daysLeft = Math.max(0, deposit.matureDay - currentDay);
        const progress = Math.min(100, (daysPassed / deposit.termDays) * 100);
        
        return `
            <div class="bank-item-card">
                <div class="bank-item-header">
                    <div>
                        <div class="bank-item-name">${deposit.productName}</div>
                        <div class="bank-item-sub">本金: ${formatMoney(deposit.amount)}</div>
                    </div>
                    <div class="bank-item-right">
                        <div class="bank-item-amount text-success">+${formatMoney(deposit.earnedInterest)}</div>
                        <div class="bank-item-label">已获利息</div>
                    </div>
                </div>
                <div class="bank-progress-wrap">
                    <div class="bank-progress-info">
                        <span>第${deposit.startDay}天存入</span>
                        <span>第${deposit.matureDay}天到期</span>
                    </div>
                    <div class="bank-progress-bar">
                        <div class="bank-progress-fill" style="width:${progress}%"></div>
                    </div>
                </div>
                ${daysLeft > 0 ? `
                    <button class="btn btn-warning btn-small btn-block bank-item-btn"
                            onclick="bankUI.confirmEarlyWithdraw('${deposit.id}')">
                        提前支取 (还剩${daysLeft}天)
                    </button>
                ` : `
                    <div class="bank-mature-tip">✅ 已到期，自动转活期</div>
                `}
            </div>
        `;
    }

    /**
     * 理财Tab（浮动收益，有风险）
     */
    _renderWealthTab(ctx, state) {
        const activeWealth = (state.wealthInvestments || []).filter(x => x.status === 'active');
        return `
            <div class="bank-tab-body">
                <div class="bank-tip-box">
                    <div class="bank-tip-title">⚠️ 风险提示</div>
                    <div class="bank-tip-content">
                        <div>• 理财产品收益浮动，不保本：实际年化在预期收益 ± 波动区间内随机</div>
                        <div>• 到期自动结算；提前赎回收 0.5% 手续费，且可能亏损本金</div>
                        <div>• 理财有风险，投资需谨慎</div>
                    </div>
                </div>
                <div class="bank-section-title">📋 理财产品</div>
                <div class="bank-product-list">
                    ${(BankData.wealthProducts || []).map(product => {
                        const canBuy = ctx.funds >= product.minAmount;
                        const annualPct = ((product.annualRate || 0) * 100).toFixed(1);
                        const volPct = ((product.volatility || 0) * 100).toFixed(1);
                        const lowPct = (((product.annualRate || 0) - (product.volatility || 0)) * 100).toFixed(1);
                        const highPct = (((product.annualRate || 0) + (product.volatility || 0)) * 100).toFixed(1);
                        const sampleMin = 10000 * (product.annualRate - product.volatility) * product.termDays / 365;
                        const sampleMax = 10000 * (product.annualRate + product.volatility) * product.termDays / 365;
                        return `
                            <div class="bank-product-card">
                                <div class="bank-product-header">
                                    <div>
                                        <div class="bank-product-name">${product.riskIcon || ''} ${product.name}</div>
                                        <div class="bank-product-desc">${product.description}</div>
                                    </div>
                                    <div class="bank-product-rate">
                                        <div class="bank-product-rate-value">${annualPct}%</div>
                                        <div class="bank-product-rate-label">预期年化 ±${volPct}%</div>
                                    </div>
                                </div>
                                <div class="bank-product-meta">
                                    ${product.riskLevel} · 期限 ${product.termDays}天 · 起购 ¥${product.minAmount.toLocaleString()}
                                    · 年化区间 ${lowPct}%~${highPct}%
                                </div>
                                <div class="bank-product-meta" style="color:#888;">
                                    申购1万到期参考：¥${sampleMin.toFixed(0)} ~ ¥${sampleMax.toFixed(0)} 收益（可能为负）
                                </div>
                                <div class="bank-product-footer">
                                    <button class="btn btn-primary btn-small ${!canBuy ? 'disabled' : ''}"
                                            ${!canBuy ? 'disabled' : ''}
                                            onclick="bankUI.showWealthModal('${product.id}')">
                                        申购
                                    </button>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
                <div class="bank-section-title">
                    📊 我的理财 (${activeWealth.length}笔)
                </div>
                <div class="bank-list" id="bankWealthList">
                    ${activeWealth.length === 0 ? `
                        <div class="bank-empty">暂无理财持仓</div>
                    ` : activeWealth.map(inv => this._renderWealthItem(inv, ctx.day)).join('')}
                </div>
            </div>
        `;
    }

    _renderWealthItem(inv, currentDay) {
        const daysPassed = currentDay - inv.startDay;
        const daysLeft = Math.max(0, inv.matureDay - currentDay);
        const progress = Math.min(100, (daysPassed / inv.termDays) * 100);
        const annualPct = ((inv.annualRate || 0) * 100).toFixed(1);
        return `
            <div class="bank-item-card">
                <div class="bank-item-header">
                    <div>
                        <div class="bank-item-name">${inv.productName}</div>
                        <div class="bank-item-sub">本金: ${formatMoney(inv.amount)} · ${inv.riskLevel || ''}</div>
                    </div>
                    <div class="bank-item-right">
                        <div class="bank-item-amount text-success">预期年化 ${annualPct}%</div>
                        <div class="bank-item-label">浮动收益，不保本</div>
                    </div>
                </div>
                <div class="bank-progress-wrap">
                    <div class="bank-progress-info">
                        <span>第${inv.startDay}天申购</span>
                        <span>第${inv.matureDay}天到期</span>
                    </div>
                    <div class="bank-progress-bar">
                        <div class="bank-progress-fill" style="width:${progress}%"></div>
                    </div>
                </div>
                ${daysLeft > 0 ? `
                    <button class="btn btn-warning btn-small btn-block bank-item-btn"
                            onclick="bankUI.confirmWealthRedeem('${inv.id}')">
                        提前赎回 (收0.5%手续费，可能亏损)
                    </button>
                ` : `
                    <div class="bank-mature-tip">✅ 已到期，自动结算</div>
                `}
            </div>
        `;
    }

    /**
     * 贷款Tab
     */
    _renderLoanTab(ctx, state) {
        const turnover = Number(ctx.totalTurnover) || 0;
        const creditLimit = bankState.calculateCreditLimit(ctx.shopLevel, ctx.shopReputation, turnover);
        const usedCredit = bankState.getUsedCredit();
        const availableCredit = Math.max(0, creditLimit - usedCredit);
        const activeLoans = state.loans.filter(l => l.status === 'active');
        const rating = (typeof bankState.getCreditRating === 'function')
            ? bankState.getCreditRating(ctx.shopLevel, ctx.shopReputation, turnover) : null;

        return `
            <div class="bank-tab-body">
                <div class="bank-summary-card loan-card">
                    ${rating ? `
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;padding:8px 10px;background:rgba(255,255,255,0.5);border-radius:8px;">
                        <span style="font-size:12px;color:#555;">${rating.icon} 信用评级</span>
                        <span style="font-size:14px;font-weight:800;color:#333;">${rating.name} <span style="font-size:11px;color:#999;">(${rating.score}分)</span></span>
                        <span style="font-size:11px;color:${rating.rateDiscount >= 0 ? '#4caf50' : '#f44336'};">${rating.desc}</span>
                    </div>` : ''}
                    <div class="bank-loan-grid">
                        <div>
                            <div class="bank-summary-label">💳 信用额度</div>
                            <div class="bank-summary-amount">${formatMoney(creditLimit)}</div>
                        </div>
                        <div>
                            <div class="bank-summary-label">可用额度</div>
                            <div class="bank-summary-amount text-success">${formatMoney(availableCredit)}</div>
                        </div>
                    </div>
                    <div class="bank-summary-desc">
                        已用: ${formatMoney(usedCredit)} · 随店铺等级与累计流水提升，最高一百亿
                    </div>
                </div>
                <div class="bank-section-title">📋 贷款产品（年利率参考1年期LPR及经营贷加点）</div>
                <div class="bank-product-list">
                    ${BankData.loanProducts.map(product => {
                        const unlocked = ctx.shopLevel >= product.minLevel;
                        const annualPct = ((product.annualRate || 0) * 100).toFixed(2);
                        const effPct = rating ? (annualPct * (1 - rating.rateDiscount)).toFixed(2) : annualPct;
                        const productMax = unlocked
                            ? bankState.getProductMaxLoan(product, ctx.shopLevel, ctx.shopReputation, turnover)
                            : 0;
                        return `
                            <div class="bank-product-card ${!unlocked ? 'locked' : ''}">
                                <div class="bank-product-header">
                                    <div>
                                        <div class="bank-product-name">
                                            ${product.name}
                                            ${!unlocked ? `<span class="bank-lock-tip">🔒Lv.${product.minLevel}</span>` : ''}
                                        </div>
                                        <div class="bank-product-desc">${product.description}</div>
                                    </div>
                                    <div class="bank-product-rate">
                                        <div class="bank-product-rate-value text-danger">${annualPct}%</div>
                                        <div class="bank-product-rate-label">年化利率${rating && rating.rateDiscount !== 0 ? `（评级后 ${effPct}%）` : ''}</div>
                                    </div>
                                </div>
                                <div class="bank-product-meta">
                                    额度: ${formatMoney(product.minAmount)}-${unlocked ? formatMoney(productMax) : '解锁后可见'} · 期限: ${product.minTerm === product.maxTerm ? product.minTerm + '天' : (product.minTerm + '-' + product.maxTerm + '天')}
                                </div>
                                ${unlocked ? `
                                    <button class="btn btn-danger btn-small btn-block"
                                            onclick="bankUI.showLoanModal('${product.id}')">
                                        立即借款
                                    </button>
                                ` : ''}
                            </div>
                        `;
                    }).join('')}
                </div>
                <div class="bank-section-title">
                    📊 我的贷款 (${activeLoans.length}笔)
                </div>
                <div class="bank-list" id="bankLoanList">
                    ${activeLoans.length === 0 ? `
                        <div class="bank-empty">暂无未结清贷款</div>
                    ` : activeLoans.map(loan => this._renderLoanItem(loan)).join('')}
                </div>
            </div>
        `;
    }

    _renderLoanItem(loan) {
        const progress = Math.min(100, ((loan.amount - loan.remainingAmount) / loan.amount) * 100);
        return `
            <div class="bank-item-card">
                <div class="bank-item-header">
                    <div>
                        <div class="bank-item-name">${loan.productName}</div>
                        <div class="bank-item-sub">本金: ${formatMoney(loan.amount)} · ${loan.term}天期</div>
                    </div>
                    <div class="bank-item-right">
                        <div class="bank-item-amount text-danger">${formatMoney(loan.remainingAmount)}</div>
                        <div class="bank-item-label">待还金额</div>
                    </div>
                </div>
                ${loan.overdueDays > 0 ? `
                    <div class="bank-overdue-tip">⚠️ 已逾期${loan.overdueDays}天，产生罚息</div>
                ` : ''}
                <div class="bank-progress-bar">
                    <div class="bank-progress-fill" style="width:${progress}%;background:#ff9800;"></div>
                </div>
                <button class="btn btn-primary btn-small btn-block bank-item-btn"
                        onclick="bankUI.repayLoan('${loan.id}')">
                    立即还款
                </button>
            </div>
        `;
    }

    /**
     * 记录Tab
     */
    _renderRecordsTab(state) {
        const records = state.transactionHistory || [];
        return `
            <div class="bank-tab-body">
                <div class="bank-records-list" id="bankRecordsList">
                    ${records.length === 0 ? `
                        <div class="bank-empty">暂无交易记录</div>
                    ` : records.slice(0, 30).map(record => {
                        const isIncome = record.amount > 0;
                        const icon = BankData.transactionTypeIcons[record.type] || '💰';
                        return `
                            <div class="bank-record-item">
                                <div class="bank-record-icon">${icon}</div>
                                <div class="bank-record-content">
                                    <div class="bank-record-desc">${record.description}</div>
                                    <div class="bank-record-time">第${record.day}天 ${record.hour}:00</div>
                                </div>
                                <div class="bank-record-amount ${isIncome ? 'text-success' : 'text-danger'}">
                                    ${isIncome ? '+' : ''}${formatMoney(Math.abs(record.amount))}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    // ========== 增量更新 ==========

    /**
     * 局部更新模态框内容（状态变化时调用）
     */
    _updateModalContent() {
        const ctx = this._getGameContext();
        const state = bankState.state;

        // 更新存款金额
        const savingsEl = document.getElementById('bankSavingsAmount');
        if (savingsEl) savingsEl.textContent = formatMoney(state.savings);

        // 更新可用资金
        const fundsEl = document.getElementById('bankFundsAmount');
        if (fundsEl) fundsEl.textContent = formatMoney(ctx.funds);

        // 根据当前Tab更新列表
        if (this._currentTab === 'fixed') {
            const listEl = document.getElementById('bankFixedList');
            if (listEl) {
                const activeFixed = state.fixedDeposits.filter(d => d.status === 'active');
                listEl.innerHTML = activeFixed.length === 0 
                    ? '<div class="bank-empty">暂无定期存款</div>'
                    : activeFixed.map(d => this._renderFixedItem(d, ctx.day)).join('');
            }
        } else if (this._currentTab === 'wealth') {
            const listEl = document.getElementById('bankWealthList');
            if (listEl) {
                const activeWealth = (state.wealthInvestments || []).filter(x => x.status === 'active');
                listEl.innerHTML = activeWealth.length === 0
                    ? '<div class="bank-empty">暂无理财持仓</div>'
                    : activeWealth.map(x => this._renderWealthItem(x, ctx.day)).join('');
            }
        } else if (this._currentTab === 'loan') {
            const listEl = document.getElementById('bankLoanList');
            if (listEl) {
                const activeLoans = state.loans.filter(l => l.status === 'active');
                listEl.innerHTML = activeLoans.length === 0
                    ? '<div class="bank-empty">暂无未结清贷款</div>'
                    : activeLoans.map(l => this._renderLoanItem(l)).join('');
            }
        } else if (this._currentTab === 'records') {
            const listEl = document.getElementById('bankRecordsList');
            if (listEl) {
                const records = state.transactionHistory || [];
                listEl.innerHTML = records.length === 0
                    ? '<div class="bank-empty">暂无交易记录</div>'
                    : records.slice(0, 30).map(r => {
                        const isIncome = r.amount > 0;
                        const icon = BankData.transactionTypeIcons[r.type] || '💰';
                        return `
                            <div class="bank-record-item">
                                <div class="bank-record-icon">${icon}</div>
                                <div class="bank-record-content">
                                    <div class="bank-record-desc">${r.description}</div>
                                    <div class="bank-record-time">第${r.day}天 ${r.hour}:00</div>
                                </div>
                                <div class="bank-record-amount ${isIncome ? 'text-success' : 'text-danger'}">
                                    ${isIncome ? '+' : ''}${formatMoney(Math.abs(r.amount))}
                                </div>
                            </div>
                        `;
                    }).join('');
            }
        }
    }

    /**
     * 更新Tab内容（切换Tab时全量渲染内容区）
     */
    _updateTabContent() {
        const ctx = this._getGameContext();
        const state = bankState.state;
        const contentEl = document.getElementById('bankTabContent');
        if (contentEl) {
            contentEl.innerHTML = this._renderTabContent(ctx, state);
        }
    }

    /**
     * 更新Tab按钮状态
     */
    _updateTabButtons() {
        const btns = document.querySelectorAll('.bank-tab-btn');
        btns.forEach(btn => {
            if (btn.dataset.tab === this._currentTab) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    // ========== 操作方法 ==========

    doDeposit() {
        const input = document.getElementById('depositAmount');
        const amount = parseFloat(input?.value);
        if (!amount || amount <= 0) {
            this._showToast('请输入有效的存款金额');
            return;
        }
        const result = bankEngine.deposit(amount);
        if (!result.success) {
            this._showToast(result.message);
        }
    }

    doWithdraw() {
        const input = document.getElementById('withdrawAmount');
        const amount = parseFloat(input?.value);
        if (!amount || amount <= 0) {
            this._showToast('请输入有效的取款金额');
            return;
        }
        const result = bankEngine.withdraw(amount);
        if (!result.success) {
            this._showToast(result.message);
        }
    }

    _fillDepositAll() {
        const ctx = this._getGameContext();
        const input = document.getElementById('depositAmount');
        if (input) input.value = Math.floor(ctx.funds);
    }

    _fillWithdrawAll() {
        const input = document.getElementById('withdrawAmount');
        if (input) input.value = Math.floor(bankState.state.savings);
    }

    _handleOverlayClick(e) {
        if (e.target.id === 'bankModalOverlay') {
            this.closeModal();
        }
    }

    // ========== 定期存款弹窗 ==========

    showFixedDepositModal(productId) {
        const product = BankData.fixedDeposits.find(p => p.id === productId);
        if (!product) return;
        const ctx = this._getGameContext();

        const content = `
            <div class="bank-modal-header-center">
                <div class="bank-modal-icon">📅</div>
                <div class="bank-modal-title">${product.name}</div>
                <div class="bank-modal-rate">${((product.annualRate || 0) * 100).toFixed(2)}% <span>年化利率</span></div>
            </div>
            <div class="bank-info-box">
                <div>• 存款期限: <b>${product.termDays}天</b></div>
                <div>• 起存金额: <b>¥${product.minAmount}</b></div>
                <div>• 到期收益: 本金 × 年化利率 × 期限 ÷ 365</div>
                <div>• 提前支取: 按活期计息，扣${(product.earlyWithdrawPenalty * 100).toFixed(0)}%利息</div>
            </div>
            <div class="bank-form-group">
                <label class="bank-form-label">存入金额</label>
                <input type="number" id="fixedDepositAmount" value="${product.minAmount}"
                       min="${product.minAmount}" step="100">
                <div class="bank-form-hint">
                    可用资金: ${formatMoney(ctx.funds)} · 
                    <span class="link-btn" onclick="bankUI._fillFixedAll(${Math.floor(ctx.funds)})">全部存入</span>
                </div>
            </div>
            <div class="bank-preview-box success" id="fixedDepositPreview">
                <div>到期预计收益: <b>+${formatMoney(product.minAmount * product.interestRate * product.termDays)}</b></div>
                <div class="hint">到期总金额: ${formatMoney(product.minAmount + product.minAmount * product.interestRate * product.termDays)}</div>
            </div>
        `;

        const footer = `
            <button class="btn btn-secondary" onclick="bankUI._backToBankModal()">返回</button>
            <button class="btn btn-success" onclick="bankUI.confirmFixedDeposit('${productId}')">确认存入</button>
        `;

        this._showSubModal('定期存款', content, footer);
        this._bindFixedDepositPreview(product);
    }

    _fillFixedAll(amount) {
        const input = document.getElementById('fixedDepositAmount');
        if (input) input.value = amount;
        input?.dispatchEvent(new Event('input'));
    }

    _bindFixedDepositPreview(product) {
        setTimeout(() => {
            const input = document.getElementById('fixedDepositAmount');
            const preview = document.getElementById('fixedDepositPreview');
            if (input && preview) {
                input.addEventListener('input', () => {
                    const amt = parseFloat(input.value) || 0;
                    const interest = amt * product.interestRate * product.termDays;
                    preview.innerHTML = `
                        <div>到期预计收益: <b>+${formatMoney(interest)}</b></div>
                        <div class="hint">到期总金额: ${formatMoney(amt + interest)}</div>
                    `;
                });
            }
        }, 30);
    }

    confirmFixedDeposit(productId) {
        const input = document.getElementById('fixedDepositAmount');
        const amount = parseFloat(input?.value);
        if (!amount || amount <= 0) {
            this._showToast('请输入有效的存款金额');
            return;
        }
        const result = bankEngine.depositFixed(amount, productId);
        if (result.success) {
            this._closeSubModal();
        } else {
            this._showToast(result.message);
        }
    }

    confirmEarlyWithdraw(depositId) {
        if (!confirm('提前支取将按活期利率计息并扣除罚息，确定要提前支取吗？')) {
            return;
        }
        const result = bankEngine.withdrawFixed(depositId, true);
        if (!result.success) {
            this._showToast(result.message);
        }
    }

    // ========== 理财弹窗 ==========

    showWealthModal(productId) {
        const product = (BankData.wealthProducts || []).find(p => p.id === productId);
        if (!product) return;
        const ctx = this._getGameContext();
        const annualPct = ((product.annualRate || 0) * 100).toFixed(1);
        const volPct = ((product.volatility || 0) * 100).toFixed(1);
        const lowPct = (((product.annualRate || 0) - (product.volatility || 0)) * 100).toFixed(1);
        const highPct = (((product.annualRate || 0) + (product.volatility || 0)) * 100).toFixed(1);

        const content = `
            <div class="bank-modal-header-center">
                <div class="bank-modal-icon">${product.riskIcon || '🧧'}</div>
                <div class="bank-modal-title">${product.name}</div>
                <div class="bank-modal-rate">预期年化 ${annualPct}% ±${volPct}%</div>
            </div>
            <div class="bank-info-box">
                <div>• 风险等级: <b>${product.riskLevel || '中风险'}</b>（收益浮动，不保本）</div>
                <div>• 持有期限: <b>${product.termDays}天</b>（到期自动结算）</div>
                <div>• 起购金额: <b>¥${product.minAmount}</b></div>
                <div>• 实际年化区间: <b>${lowPct}% ~ ${highPct}%</b>（可能为负，亏损本金）</div>
                <div>• 提前赎回: 收 0.5% 手续费，按持有天数估算收益</div>
            </div>
            <div class="bank-form-group">
                <label class="bank-form-label">申购金额</label>
                <input type="number" id="wealthAmount" value="${product.minAmount}"
                       min="${product.minAmount}" step="100">
                <div class="bank-form-hint">
                    可用资金: ${formatMoney(ctx.funds)} · 
                    <span class="link-btn" onclick="bankUI._fillWealthAll(${Math.floor(ctx.funds)})">全部申购</span>
                </div>
            </div>
            <div class="bank-preview-box success" id="wealthPreview">
                <div>到期参考收益区间: <b>+${formatMoney(product.minAmount * (product.annualRate - product.volatility) * product.termDays / 365)} ~ +${formatMoney(product.minAmount * (product.annualRate + product.volatility) * product.termDays / 365)}</b></div>
                <div class="hint">极端情况下可能亏损，最差到期约 ${formatMoney(product.minAmount * (1 + (product.annualRate - product.volatility) * product.termDays / 365))}</div>
            </div>
        `;

        const footer = `
            <button class="btn btn-secondary" onclick="bankUI._backToBankModal()">返回</button>
            <button class="btn btn-success" onclick="bankUI.confirmWealth('${productId}')">确认申购</button>
        `;

        this._showSubModal('理财申购', content, footer);
        this._bindWealthPreview(product);
    }

    _fillWealthAll(amount) {
        const input = document.getElementById('wealthAmount');
        if (input) input.value = amount;
        input?.dispatchEvent(new Event('input'));
    }

    _bindWealthPreview(product) {
        setTimeout(() => {
            const input = document.getElementById('wealthAmount');
            const preview = document.getElementById('wealthPreview');
            if (input && preview) {
                input.addEventListener('input', () => {
                    const amt = parseFloat(input.value) || 0;
                    const low = amt * (product.annualRate - product.volatility) * product.termDays / 365;
                    const high = amt * (product.annualRate + product.volatility) * product.termDays / 365;
                    preview.innerHTML = `
                        <div>到期参考收益区间: <b>+${formatMoney(low)} ~ +${formatMoney(high)}</b></div>
                        <div class="hint">极端情况下可能亏损，最差到期约 ${formatMoney(amt * (1 + (product.annualRate - product.volatility) * product.termDays / 365))}</div>
                    `;
                });
            }
        }, 30);
    }

    confirmWealth(productId) {
        const input = document.getElementById('wealthAmount');
        const amount = parseFloat(input?.value);
        if (!amount || amount <= 0) {
            this._showToast('请输入有效的申购金额');
            return;
        }
        const result = bankEngine.depositWealth(amount, productId);
        if (result.success) {
            this._closeSubModal();
        } else {
            this._showToast(result.message);
        }
    }

    confirmWealthRedeem(invId) {
        if (!confirm('提前赎回将收 0.5% 手续费，收益浮动甚至可能亏损本金，确定赎回吗？')) {
            return;
        }
        const result = bankEngine.withdrawWealth(invId, true);
        if (!result.success) {
            this._showToast(result.message);
        }
    }

    // ========== 贷款弹窗 ==========

    showLoanModal(productId) {
        const product = BankData.loanProducts.find(p => p.id === productId);
        if (!product) return;
        const ctx = this._getGameContext();
        const turnover = Number(ctx.totalTurnover) || 0;
        const availableCredit = bankState.getAvailableCredit(ctx.shopLevel, ctx.shopReputation, turnover);
        const maxAmount = bankState.getProductMaxLoan(product, ctx.shopLevel, ctx.shopReputation, turnover);
        const defaultAmount = Math.min(Math.max(product.minAmount, product.minAmount), Math.max(product.minAmount, maxAmount));
        const step = maxAmount >= 100000000 ? 1000000 : (maxAmount >= 1000000 ? 10000 : 100);

        const content = `
            <div class="bank-modal-header-center">
                <div class="bank-modal-icon">💳</div>
                <div class="bank-modal-title">${product.name}</div>
                <div class="bank-modal-rate text-danger">${((product.annualRate || 0) * 100).toFixed(2)}% <span>年化利率</span></div>
            </div>
            <div class="bank-info-box">
                <div>• 贷款期限: <b>${product.minTerm === product.maxTerm ? product.minTerm + '天' : (product.minTerm + '-' + product.maxTerm + '天')}</b></div>
                <div>• 本产品可借: <b>${formatMoney(product.minAmount)} - ${formatMoney(maxAmount)}</b></div>
                <div>• 还款方式: 按日分期自动扣款（本金平摊 + 日息）</div>
                <div>• 逾期罚息: 每日${(BankData.overdue.penaltyRate * 100).toFixed(2)}%，影响信誉</div>
                <div>• 授信说明: 额度随店铺等级与累计流水提升，总授信最高一百亿</div>
            </div>
            <div class="bank-form-group">
                <label class="bank-form-label">借款金额</label>
                <input type="number" id="loanAmount" value="${defaultAmount}"
                       min="${product.minAmount}" max="${Math.max(product.minAmount, maxAmount)}" step="${step}">
                <div class="bank-form-hint">
                    可用额度: ${formatMoney(availableCredit)} · 
                    <span class="link-btn" onclick="bankUI._fillLoanMax(${Math.floor(maxAmount)})">最大额度</span>
                </div>
            </div>
            <div class="bank-form-group">
                <label class="bank-form-label">借款期限</label>
                ${product.minTerm === product.maxTerm ? `
                    <input type="hidden" id="loanTerm" value="${product.minTerm}">
                    <div class="bank-range-labels" style="justify-content:center;padding:10px 0;">
                        <span id="loanTermDisplay" class="bank-range-value" style="font-size:18px;font-weight:800;">${product.minTerm}天固定期</span>
                    </div>
                    <div class="bank-form-hint">覆盖进货到货周期，每日仅还本金的 1/${product.minTerm} + 当天利息</div>
                ` : `
                    <input type="range" id="loanTerm" min="${product.minTerm}" max="${product.maxTerm}" value="${product.minTerm}" step="90">
                    <div class="bank-range-labels">
                        <span>${product.minTerm}天</span>
                        <span id="loanTermDisplay" class="bank-range-value">${product.minTerm}天</span>
                        <span>${product.maxTerm}天</span>
                    </div>
                `}
            </div>
            <div class="bank-preview-box danger" id="loanPreview">
                <div>总利息约: <b>${formatMoney(product.minAmount * product.interestRate * product.minTerm)}</b></div>
                <div class="hint">每日还款约: ${formatMoney(product.minAmount / product.minTerm + product.minAmount * product.interestRate)}</div>
            </div>
        `;

        const footer = `
            <button class="btn btn-secondary" onclick="bankUI._backToBankModal()">返回</button>
            <button class="btn btn-danger" onclick="bankUI.confirmLoan('${productId}')">确认借款</button>
        `;

        this._showSubModal('申请贷款', content, footer);
        this._bindLoanPreview(product);
    }

    _fillLoanMax(amount) {
        const input = document.getElementById('loanAmount');
        if (input) input.value = amount;
        input?.dispatchEvent(new Event('input'));
    }

    _bindLoanPreview(product) {
        setTimeout(() => {
            const amountInput = document.getElementById('loanAmount');
            const termInput = document.getElementById('loanTerm');
            const termDisplay = document.getElementById('loanTermDisplay');
            const preview = document.getElementById('loanPreview');

            const update = () => {
                const amt = parseFloat(amountInput?.value) || 0;
                const term = parseInt(termInput?.value) || product.minTerm;
                if (termDisplay) termDisplay.textContent = term + '天';
                const totalInterest = amt * product.interestRate * term;
                const dailyPayment = amt / term + amt * product.interestRate;
                if (preview) {
                    preview.innerHTML = `
                        <div>总利息约: <b>${formatMoney(totalInterest)}</b></div>
                        <div class="hint">每日还款约: ${formatMoney(dailyPayment)}</div>
                    `;
                }
            };

            amountInput?.addEventListener('input', update);
            termInput?.addEventListener('input', update);
        }, 30);
    }

    confirmLoan(productId) {
        const amountInput = document.getElementById('loanAmount');
        const termInput = document.getElementById('loanTerm');
        const amount = parseFloat(amountInput?.value);
        const term = parseInt(termInput?.value);

        if (!amount || amount <= 0) {
            this._showToast('请输入有效的借款金额');
            return;
        }
        if (!term || term <= 0) {
            this._showToast('请选择借款期限');
            return;
        }

        const result = bankEngine.applyLoan(productId, amount, term);
        if (result.success) {
            this._closeSubModal();
        } else {
            this._showToast(result.message);
        }
    }

    repayLoan(loanId) {
        const ctx = this._getGameContext();
        const loan = bankState.state.loans.find(l => l.id === loanId);
        if (!loan) return;

        const repayAmount = Math.min(loan.remainingAmount, ctx.funds);
        if (repayAmount <= 0) {
            this._showToast('资金不足，无法还款');
            return;
        }

        const result = bankEngine.repayLoan(loanId, repayAmount);
        if (!result.success) {
            this._showToast(result.message);
        }
    }

    // ========== 子弹窗辅助方法 ==========

    _showSubModal(title, content, footer) {
        const body = document.getElementById('bankModalBody');
        if (!body) return;
        
        // 隐藏主内容，显示子弹窗
        body.innerHTML = `
            <div class="bank-submodal">
                <div class="bank-submodal-title">${title}</div>
                ${content}
                <div class="bank-submodal-footer">${footer}</div>
            </div>
        `;
    }

    _closeSubModal() {
        // 子弹窗关闭后返回银行主界面
        if (this._modalVisible) {
            this._renderFullModal();
        }
    }

    _backToBankModal() {
        this._renderFullModal();
    }

    // ========== Toast ==========

    _showToast(msg) {
        // 优先使用全局ui的toast，如果没有则自己创建
        if (typeof ui !== 'undefined' && ui.showToast) {
            ui.showToast(msg);
        } else {
            this._createToast(msg);
        }
    }

    _createToast(msg) {
        const toast = document.createElement('div');
        toast.className = 'bank-toast';
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 2000);
    }
}

const bankUI = new BankUI();
