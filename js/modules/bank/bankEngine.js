/**
 * 银行模块 - 业务逻辑引擎
 * 负责验证业务规则、协调状态变更、与外部模块通信
 */
class BankEngine {
    constructor() {
        this._initialized = false;
    }

    /**
     * 初始化银行引擎
     */
    init() {
        if (this._initialized) return;
        this._bindEvents();
        this._initialized = true;
        console.log('[BankEngine] 银行系统初始化完成');
    }

    /**
     * 绑定事件监听
     */
    _bindEvents() {
        // 游戏每日结算
        eventBus.on('game:dailyTick', (data) => this._handleDailyTick(data));

        // 接收外部操作请求
        eventBus.on('bank:request:deposit', (data) => this.deposit(data.amount));
        eventBus.on('bank:request:withdraw', (data) => this.withdraw(data.amount));
        eventBus.on('bank:request:depositFixed', (data) => this.depositFixed(data.amount, data.productId));
        eventBus.on('bank:request:withdrawFixed', (data) => this.withdrawFixed(data.depositId, data.early));
        eventBus.on('bank:request:wealth', (data) => this.depositWealth(data.amount, data.productId));
        eventBus.on('bank:request:withdrawWealth', (data) => this.withdrawWealth(data.invId, data.early));
        eventBus.on('bank:request:applyLoan', (data) => this.applyLoan(data.productId, data.amount, data.term));
        eventBus.on('bank:request:repayLoan', (data) => this.repayLoan(data.loanId, data.amount));
    }

    /**
     * 获取游戏上下文（等级、信誉、资金、当前日等）
     * 优先从缓存获取，性能最优
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

    /**
     * 请求扣除/增加资金（通过事件总线）
     */
    _requestSpendFunds(amount, reason) {
        const ctx = this._getGameContext();
        if (ctx.funds < amount) return false;
        eventBus.emit('bank:funds:spend', { amount, reason });
        return true;
    }

    _requestAddFunds(amount, reason) {
        eventBus.emit('bank:funds:add', { amount, reason });
        return true;
    }

    // ========== 活期存款 ==========

    /**
     * 活期存款
     */
    deposit(amount) {
        const ctx = this._getGameContext();
        
        if (amount <= 0) {
            return { success: false, message: '金额必须大于0' };
        }
        if (ctx.funds < amount) {
            return { success: false, message: '资金不足' };
        }

        // 扣除资金
        if (!this._requestSpendFunds(amount, '银行存款')) {
            return { success: false, message: '资金扣除失败' };
        }

        // 更新银行状态
        bankState._deposit(amount, ctx.day, ctx.hour);
        bankState.notify();

        eventBus.emit('bank:deposit:success', { amount, savings: bankState.state.savings });
        return { success: true, amount, savings: bankState.state.savings };
    }

    /**
     * 活期取款
     */
    withdraw(amount) {
        const ctx = this._getGameContext();
        
        if (amount <= 0) {
            return { success: false, message: '金额必须大于0' };
        }
        if (bankState.state.savings < amount) {
            return { success: false, message: '存款余额不足' };
        }

        // 更新银行状态
        bankState._withdraw(amount, ctx.day, ctx.hour);

        // 增加资金
        this._requestAddFunds(amount, '银行取款');
        bankState.notify();

        eventBus.emit('bank:withdraw:success', { amount, savings: bankState.state.savings });
        return { success: true, amount, savings: bankState.state.savings };
    }

    // ========== 定期存款 ==========

    /**
     * 定期存款
     */
    depositFixed(amount, productId) {
        const ctx = this._getGameContext();
        const product = BankData.fixedDeposits.find(p => p.id === productId);
        
        if (!product) {
            return { success: false, message: '无效的存款产品' };
        }
        if (amount < product.minAmount) {
            return { success: false, message: `最低存款${product.minAmount}元` };
        }
        if (ctx.funds < amount) {
            return { success: false, message: '资金不足' };
        }

        // 扣除资金
        if (!this._requestSpendFunds(amount, `定期存款 - ${product.name}`)) {
            return { success: false, message: '资金扣除失败' };
        }

        // 创建定期存款
        const deposit = bankState._depositFixed(product, amount, ctx.day, ctx.hour);
        bankState.notify();

        eventBus.emit('bank:fixedDeposit:success', { deposit });
        return { success: true, deposit };
    }

    /**
     * 定期支取
     */
    withdrawFixed(depositId, early = false) {
        const ctx = this._getGameContext();
        const deposit = bankState.state.fixedDeposits.find(d => d.id === depositId);
        
        if (!deposit || deposit.status !== 'active') {
            return { success: false, message: '存款不存在' };
        }

        // 执行支取
        const result = bankState._withdrawFixed(depositId, early, ctx.day, ctx.hour);
        if (!result) {
            return { success: false, message: '支取失败' };
        }

        // 本金+利息返回账户
        this._requestAddFunds(result.totalAmount, 
            early ? `定期提前支取 - ${deposit.productName}` : `定期到期 - ${deposit.productName}`);
        bankState.notify();

        eventBus.emit('bank:fixedWithdraw:success', { deposit, result });
        return { success: true, ...result };
    }

    // ========== 理财产品（浮动收益，有风险） ==========

    /**
     * 理财申购
     */
    depositWealth(amount, productId) {
        const ctx = this._getGameContext();
        const product = (BankData.wealthProducts || []).find(p => p.id === productId);

        if (!product) {
            return { success: false, message: '无效的理财产品' };
        }
        if (amount < product.minAmount) {
            return { success: false, message: `最低申购${product.minAmount}元` };
        }
        if (ctx.funds < amount) {
            return { success: false, message: '资金不足' };
        }

        if (!this._requestSpendFunds(amount, `理财申购 - ${product.name}`)) {
            return { success: false, message: '资金扣除失败' };
        }

        const inv = bankState._depositWealth(product, amount, ctx.day, ctx.hour);
        bankState.notify();

        eventBus.emit('bank:wealth:success', { inv });
        return { success: true, inv };
    }

    /**
     * 理财赎回（early=true 提前赎回，收0.5%手续费，可能亏损）
     */
    withdrawWealth(invId, early = false) {
        const ctx = this._getGameContext();
        const inv = bankState.state.wealthInvestments.find(x => x.id === invId);

        if (!inv || inv.status !== 'active') {
            return { success: false, message: '理财持仓不存在' };
        }

        const result = bankState._withdrawWealth(invId, early, ctx.day, ctx.hour);
        if (!result) {
            return { success: false, message: '赎回失败' };
        }

        this._requestAddFunds(result.totalAmount,
            early ? `理财提前赎回 - ${inv.productName}` : `理财到期 - ${inv.productName}`);
        bankState.notify();

        eventBus.emit('bank:wealthWithdraw:success', { inv, result });
        return { success: true, ...result };
    }

    // ========== 贷款 ==========

    /**
     * 申请贷款
     */
    applyLoan(productId, amount, term) {
        const ctx = this._getGameContext();
        const product = BankData.loanProducts.find(p => p.id === productId);
        
        if (!product) {
            return { success: false, message: '无效的贷款产品' };
        }
        if (ctx.shopLevel < product.minLevel) {
            return { success: false, message: `需要店铺等级 Lv.${product.minLevel}` };
        }
        if (amount < product.minAmount) {
            return { success: false, message: `最低贷款${product.minAmount}元` };
        }
        if (term < product.minTerm || term > product.maxTerm) {
            const termHint = product.minTerm === product.maxTerm
                ? `${product.minTerm}天`
                : `${product.minTerm}-${product.maxTerm}天`;
            return { success: false, message: `贷款期限需为${termHint}` };
        }

        // 检查可用额度（随等级+流水动态提升，最高一百亿）
        const turnover = Number(ctx.totalTurnover) || 0;
        const productMax = (typeof bankState.getProductMaxLoan === 'function')
            ? bankState.getProductMaxLoan(product, ctx.shopLevel, ctx.shopReputation, turnover)
            : bankState.getAvailableCredit(ctx.shopLevel, ctx.shopReputation, turnover);
        if (amount > productMax) {
            return { success: false, message: `超出可借上限，当前最多可借: ¥${Math.floor(productMax).toLocaleString()}` };
        }
        const availableCredit = bankState.getAvailableCredit(ctx.shopLevel, ctx.shopReputation, turnover);
        if (amount > availableCredit) {
            return { success: false, message: `可用额度不足，当前可用额度: ¥${Math.floor(availableCredit).toLocaleString()}` };
        }

        // 创建贷款（传入业务上下文，让状态层也能做额度二次校验）
        const loan = bankState._applyLoan(product, amount, term, ctx.day, ctx.hour, {
            shopLevel: ctx.shopLevel,
            shopReputation: ctx.shopReputation,
            totalTurnover: turnover
        });
        
        // 放款到账户
        this._requestAddFunds(amount, `贷款到账 - ${product.name}`);
        bankState.notify();

        eventBus.emit('bank:loan:success', { loan });
        return { success: true, loan };
    }

    /**
     * 还款
     */
    repayLoan(loanId, amount) {
        const ctx = this._getGameContext();
        const loan = bankState.state.loans.find(l => l.id === loanId);
        
        if (!loan || loan.status !== 'active') {
            return { success: false, message: '贷款不存在' };
        }
        if (ctx.funds < amount) {
            return { success: false, message: '资金不足' };
        }

        const repay = Math.min(amount, loan.remainingAmount);
        
        // 扣除资金
        if (!this._requestSpendFunds(repay, `归还贷款 - ${loan.productName}`)) {
            return { success: false, message: '资金扣除失败' };
        }

        // 执行还款
        const result = bankState._repayLoan(loanId, repay, ctx.day, ctx.hour);
        bankState.notify();

        eventBus.emit('bank:repay:success', { loan, result });
        return { success: true, ...result };
    }

    // ========== 每日结算 ==========

    /**
     * 处理每日结算
     */
    _handleDailyTick(data) {
        const { day, hour } = data;
        // 同一游戏日只结算一次，防止 onNewDay 重复触发时刷利息
        const settleDay = Math.max(0, Math.floor(Number(day) || 0));
        if (bankState && bankState.state && bankState.state.lastInterestDay === settleDay) {
            return { skipped: true, reason: 'already_settled', day: settleDay };
        }
        if (bankState && bankState.state) {
            bankState.state.lastInterestDay = settleDay;
        }

        let dailyResult = {
            savingsInterest: 0,
            fixedInterest: 0,
            loanInterest: 0,
            maturedDeposits: [],
            maturedWealth: [],
            autoRepaidLoans: [],
            overdueLoans: []
        };

        // 1. 活期存款利息
        const savingsRate = BankData.currentDeposit.interestRate;
        const savingsInterest = bankState.state.savings * savingsRate;
        if (savingsInterest > 0) {
            bankState.state.savings += savingsInterest;
            dailyResult.savingsInterest = savingsInterest;
            bankState.addTransaction(BankData.transactionTypes.INTEREST, savingsInterest, 
                '活期存款利息', day, hour);
            eventBus.emit('bank:funds:add', { amount: 0, reason: '活期利息计入存款' }); // 仅通知，不额外加钱
        }

        // 2. 定期存款每日计息 + 到期处理
        bankState.state.fixedDeposits.forEach(deposit => {
            if (deposit.status === 'active') {
                const dailyInterest = deposit.amount * deposit.interestRate;
                deposit.earnedInterest += dailyInterest;
                dailyResult.fixedInterest += dailyInterest;

                // 到期自动转活期
                if (day >= deposit.matureDay) {
                    const result = bankState._withdrawFixed(deposit.id, false, day, hour);
                    if (result) {
                        bankState.state.savings += result.totalAmount;
                        dailyResult.maturedDeposits.push({ deposit, result });
                    }
                }
            }
        });

        // 2.5 理财到期自动结算（浮动收益，可能亏损；本金+收益转活期）
        if (Array.isArray(bankState.state.wealthInvestments)) {
            bankState.state.wealthInvestments.forEach(inv => {
                if (inv.status === 'active' && day >= inv.matureDay) {
                    const result = bankState._withdrawWealth(inv.id, false, day, hour);
                    if (result) {
                        bankState.state.savings += result.totalAmount;
                        dailyResult.maturedWealth.push({ inv, result });
                    }
                }
            });
        }

        // 3. 贷款每日计息 + 自动扣款
        const ctx = this._getGameContext();
        let currentFunds = ctx.funds;

        bankState.state.loans.forEach(loan => {
            if (loan.status === 'active') {
                // 计息
                const dailyInterest = loan.remainingAmount * loan.interestRate;
                loan.remainingAmount += dailyInterest;
                loan.totalInterest += dailyInterest;
                dailyResult.loanInterest += dailyInterest;

                // 计算今日应还（本金分摊 + 利息）
                const dailyTotal = loan.dailyRepayment + dailyInterest;
                
                // 自动扣款（优先从活期扣，不够从资金扣）
                let deducted = 0;
                
                // 先从活期存款扣
                if (bankState.state.savings > 0) {
                    const fromSavings = Math.min(bankState.state.savings, dailyTotal - deducted);
                    if (fromSavings > 0) {
                        bankState.state.savings -= fromSavings;
                        deducted += fromSavings;
                    }
                }
                
                // 再从可用资金扣
                if (deducted < dailyTotal && currentFunds > 0) {
                    const fromFunds = Math.min(currentFunds, dailyTotal - deducted);
                    if (fromFunds > 0) {
                        eventBus.emit('bank:funds:spend', { amount: fromFunds, reason: `自动还款 - ${loan.productName}` });
                        currentFunds -= fromFunds;
                        deducted += fromFunds;
                    }
                }

                if (deducted >= dailyTotal - 0.01) {
                    // 足额扣款（注意：计息已加到 remainingAmount，这里扣回「今日本金分摊 + 今日利息」）
                    loan.remainingAmount -= (loan.dailyRepayment + dailyInterest);
                    loan.remainingTerm--;
                    loan.paidDays++;
                    
                    if (loan.remainingAmount <= 0.01) {
                        loan.status = 'paid';
                        loan.paidDay = day;
                        loan.remainingAmount = 0;
                    }
                    
                    bankState.addTransaction(BankData.transactionTypes.LOAN_REPAY, -deducted,
                        `自动还款 - ${loan.productName}`, day, hour);
                    dailyResult.autoRepaidLoans.push({ loan, amount: deducted });
                } else {
                    // 不足额，计入逾期
                    if (deducted > 0) {
                        loan.remainingAmount -= deducted;
                        bankState.addTransaction(BankData.transactionTypes.LOAN_REPAY, -deducted,
                            `部分还款 - ${loan.productName}`, day, hour);
                    }
                    
                    loan.overdueDays++;
                    
                    // 逾期罚息
                    const penalty = loan.remainingAmount * BankData.overdue.penaltyRate;
                    loan.remainingAmount += penalty;
                    loan.totalInterest += penalty;
                    
                    bankState.addTransaction(BankData.transactionTypes.LOAN_OVERDUE, penalty,
                        `逾期罚息 - ${loan.productName}`, day, hour);
                    
                    // 每隔几天扣信誉
                    if (loan.overdueDays % BankData.overdue.reputationPenaltyInterval === 0) {
                        eventBus.emit('bank:reputation:penalty', { 
                            amount: BankData.overdue.reputationPenalty,
                            reason: `贷款逾期 - ${loan.productName}`
                        });
                    }
                    
                    dailyResult.overdueLoans.push({ loan, penalty });
                }
            }
        });

        bankState.notify();
        eventBus.emit('bank:dailyTick:complete', dailyResult);
        
        return dailyResult;
    }
}

const bankEngine = new BankEngine();
