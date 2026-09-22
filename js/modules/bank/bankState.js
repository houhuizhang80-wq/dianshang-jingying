/**
 * 银行模块 - 状态管理
 * 只负责银行自身状态的维护，与游戏主状态通过事件总线通信
 */
class BankState {
    constructor() {
        this.state = null;
        this._listeners = new Set();
        this._idSeq = 0;
    }

    /**
     * 初始化银行状态
     * @param {object} parentState - 游戏主状态引用（只读访问）
     */
    init(parentState) {
        if (parentState.bank) {
            this.state = parentState.bank;
        } else {
            this.state = this._getInitialState();
            parentState.bank = this.state;
        }
        if (!Array.isArray(this.state.wealthInvestments)) this.state.wealthInvestments = [];
        this._migrateRates();
        this._bindEvents();
    }

    /**
     * 利率调整迁移：旧档里的高日利率（旧版动辄 0.4%~1%/天）重置为国内真实年利率
     * 定期按产品重新对齐；找不到对应产品的旧定期按活期计息并在 7 天内到期
     */
    _migrateRates() {
        try {
            const day = (this.state && this.state.lastInterestDay) || 1;
            (this.state.fixedDeposits || []).forEach(d => {
                if (d.status !== 'active') return;
                if (!(Number(d.interestRate) > 0.0005)) return; // 已是新利率，跳过
                const product = BankData.fixedDeposits.find(p => p.id === d.productId);
                if (product) {
                    d.interestRate = product.interestRate;
                    d.termDays = product.termDays;
                    d.matureDay = d.startDay + product.termDays;
                    d.productName = product.name;
                } else {
                    d.interestRate = BankData.currentDeposit.interestRate;
                    d.matureDay = Math.min(d.matureDay, day + 7);
                }
            });
            (this.state.loans || []).forEach(l => {
                if (l.status !== 'active') return;
                if (!(Number(l.interestRate) > 0.0005)) return;
                const product = BankData.loanProducts.find(p => p.id === l.productId);
                if (product) {
                    l.interestRate = product.interestRate;
                    l.dailyInterest = l.remainingAmount * product.interestRate;
                    l.dailyRepayment = l.remainingAmount / Math.max(1, l.remainingTerm);
                }
            });
        } catch (e) { /* 迁移失败不影响主流程 */ }
    }

    /**
     * 重置银行状态（重新开始游戏时调用）
     */
    reset(parentState) {
        this.state = this._getInitialState();
        if (parentState) parentState.bank = this.state;
        this.notify();
    }

    /**
     * 获取初始银行状态
     */
    _getInitialState() {
        return {
            savings: 0,
            fixedDeposits: [],
            wealthInvestments: [],
            loans: [],
            transactionHistory: [],
            lastInterestDay: 0
        };
    }

    /**
     * 绑定事件监听
     */
    _bindEvents() {
        if (this._eventsBound) return;
        this._eventsBound = true;
        // 每日结算
        eventBus.on('game:dailyTick', (dayInfo) => {
            this._onDailyTick(dayInfo);
        });
    }

    /**
     * 每日结算处理
     */
    _onDailyTick(dayInfo) {
        // 由 bankEngine 处理，这里只做状态同步
        this.notify();
    }

    /**
     * 更新状态并通知
     * @param {Function} updater - 更新函数
     */
    setState(updater) {
        updater(this.state);
        this.notify();
    }

    /**
     * 通知状态变更
     */
    notify() {
        eventBus.emit('bank:stateChanged', this.state);
        this._listeners.forEach(fn => {
            try { fn(this.state); } catch (e) { console.error(e); }
        });
    }

    /**
     * 订阅状态变化
     * @param {Function} callback 
     */
    subscribe(callback) {
        this._listeners.add(callback);
        return () => this._listeners.delete(callback);
    }

    // ========== 状态查询方法 ==========

    /**
     * 计算信用额度
     * 随店铺等级阶梯 + 累计销售流水提升，最高一百亿
     * @param {number} shopLevel
     * @param {number} shopReputation
     * @param {number} [totalTurnover=0] 累计销售流水（金额）
     */
    calculateCreditLimit(shopLevel, shopReputation, totalTurnover = 0) {
        const config = BankData.creditLimit || {};
        const maxLimit = Number(config.maxLimit) > 0 ? Number(config.maxLimit) : 10000000000;
        const level = Math.max(1, Math.floor(Number(shopLevel) || 1));
        const reputation = Math.max(0, Number(shopReputation) || 0);
        const turnover = Math.max(0, Number(totalTurnover) || 0);

        let levelCap = 0;
        const levelMap = config.levelLimits;
        if (levelMap && typeof levelMap === 'object') {
            if (levelMap[level] != null) {
                levelCap = Number(levelMap[level]) || 0;
            } else {
                const keys = Object.keys(levelMap).map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b);
                if (keys.length) {
                    const maxKey = keys[keys.length - 1];
                    const minKey = keys[0];
                    if (level > maxKey) {
                        // 超过配置最高级：每多一级 ×2
                        levelCap = (Number(levelMap[maxKey]) || 0) * Math.pow(2, level - maxKey);
                    } else if (level < minKey) {
                        levelCap = Number(levelMap[minKey]) || 0;
                    } else {
                        // 落在空隙：取不超过当前等级的最近档
                        let nearest = minKey;
                        for (const k of keys) { if (k <= level) nearest = k; }
                        levelCap = Number(levelMap[nearest]) || 0;
                    }
                }
            }
        }
        if (!(levelCap > 0)) {
            // 兼容旧线性公式
            const base = Number(config.baseLimit) || 20000;
            const bonus = Number(config.levelBonus) || 5000;
            levelCap = base + (level - 1) * bonus;
        }

        const turnoverRatio = (config.turnoverRatio != null) ? Number(config.turnoverRatio) : 0.25;
        const turnoverBonus = turnover * Math.max(0, turnoverRatio);
        const repBonusPer = (config.reputationBonus != null)
            ? Number(config.reputationBonus)
            : (Number(config.reputationMultiplier) || 0);
        // reputationBonus 按「每点金额」；旧 reputationMultiplier 过小时按点数金额理解
        const repBonus = reputation * (repBonusPer >= 1 ? repBonusPer : repBonusPer * 10000);

        const limit = levelCap + turnoverBonus + repBonus;
        return Math.min(maxLimit, Math.floor(limit));
    }

    /**
     * 获取已用贷款额度
     */
    getUsedCredit() {
        return this.state.loans
            .filter(l => l.status === 'active')
            .reduce((sum, l) => sum + l.remainingAmount, 0);
    }

    /**
     * 获取可用贷款额度
     */
    getAvailableCredit(shopLevel, shopReputation, totalTurnover = 0) {
        const total = this.calculateCreditLimit(shopLevel, shopReputation, totalTurnover);
        const used = this.getUsedCredit();
        return Math.max(0, total - used);
    }

    /**
     * 某贷款产品当前可借上限（信用额度 × 产品比例，且不超过可用额度）
     */
    getProductMaxLoan(product, shopLevel, shopReputation, totalTurnover = 0) {
        if (!product) return 0;
        const credit = this.calculateCreditLimit(shopLevel, shopReputation, totalTurnover);
        const available = Math.max(0, credit - this.getUsedCredit());
        const ratio = (product.creditRatio != null) ? Number(product.creditRatio) : 1;
        const byRatio = Math.floor(credit * Math.max(0, Math.min(1, ratio)));
        const hardCap = (product.maxAmount != null) ? Number(product.maxAmount) : credit;
        return Math.max(0, Math.min(available, byRatio, hardCap));
    }

    /**
     * 信用评级：由店铺等级 + 信誉 + 销售流水合成信用分，映射到评级档位。
     * 评级影响贷款利率（见 BankData.creditRatings 的 rateDiscount）。
     * @returns {{id,name,icon,score,rateDiscount,desc}}
     */
    getCreditRating(shopLevel, shopReputation, totalTurnover = 0) {
        const level = Math.max(1, Math.floor(Number(shopLevel) || 1));
        const reputation = Math.max(0, Number(shopReputation) || 0);
        const turnover = Math.max(0, Number(totalTurnover) || 0);
        // 信用分：等级每级 +100；信誉每点 +2（封顶 +300）；流水每 10 万 +1（封顶 +300）
        const levelScore = level * 100;
        const repScore = Math.min(300, reputation * 2);
        const turnoverScore = Math.min(300, Math.floor(turnover / 100000));
        const score = Math.round(levelScore + repScore + turnoverScore);
        const ratings = (typeof BankData !== 'undefined' && Array.isArray(BankData.creditRatings))
            ? BankData.creditRatings : [];
        const rating = ratings.find(r => score >= r.minScore) || ratings[ratings.length - 1]
            || { id: 'B', name: 'B 一般', icon: '🥉', rateDiscount: 0, desc: '一般信用，标准利率' };
        return { ...rating, score };
    }

    /**
     * 获取活跃的定期存款
     */
    getActiveFixedDeposits() {
        return this.state.fixedDeposits.filter(d => d.status === 'active');
    }

    /**
     * 获取活跃的贷款
     */
    getActiveLoans() {
        return this.state.loans.filter(l => l.status === 'active');
    }

    /**
     * 添加交易记录
     */
    addTransaction(type, amount, description, day, hour) {
        const record = {
            id: 'bank_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
            type: type,
            amount: amount,
            description: description,
            day: day,
            hour: hour,
            timestamp: Date.now()
        };
        this.state.transactionHistory.unshift(record);
        if (this.state.transactionHistory.length > 100) {
            this.state.transactionHistory.pop();
        }
        return record;
    }

    // ========== 业务操作方法（由 bankEngine 调用） ==========

    /**
     * 活期存款（内部方法，由 engine 调用验证后执行）
     */
    _deposit(amount, day, hour) {
        this.state.savings += amount;
        this.addTransaction(BankData.transactionTypes.DEPOSIT, amount, '活期存款', day, hour);
        eventBus.emit('bank:deposit', { amount, savings: this.state.savings });
    }

    /**
     * 活期取款（内部方法）
     */
    _withdraw(amount, day, hour) {
        this.state.savings -= amount;
        this.addTransaction(BankData.transactionTypes.WITHDRAW, -amount, '活期取款', day, hour);
        eventBus.emit('bank:withdraw', { amount, savings: this.state.savings });
    }

    /**
     * 定期存款（内部方法）
     */
    _depositFixed(product, amount, day, hour) {
        const deposit = {
            id: 'fd_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
            productId: product.id,
            productName: product.name,
            amount: amount,
            interestRate: product.interestRate,
            termDays: product.termDays,
            startDay: day,
            matureDay: day + product.termDays,
            earnedInterest: 0,
            status: 'active',
            earlyWithdrawPenalty: product.earlyWithdrawPenalty
        };
        this.state.fixedDeposits.push(deposit);
        this.addTransaction(BankData.transactionTypes.FIXED_DEPOSIT, amount, 
            `定期存款 - ${product.name}`, day, hour);
        eventBus.emit('bank:fixedDepositCreated', deposit);
        return deposit;
    }

    /**
     * 定期支取（内部方法）
     */
    _withdrawFixed(depositId, early, day, hour) {
        const deposit = this.state.fixedDeposits.find(d => d.id === depositId);
        if (!deposit || deposit.status !== 'active') return null;

        const daysPassed = day - deposit.startDay;
        let interest = 0;

        if (early) {
            const currentRate = BankData.currentDeposit.interestRate;
            interest = deposit.amount * currentRate * daysPassed;
            const penalty = interest * deposit.earlyWithdrawPenalty;
            interest = Math.max(0, interest - penalty);
        } else {
            interest = deposit.amount * deposit.interestRate * deposit.termDays;
        }

        const totalAmount = deposit.amount + interest;
        deposit.status = early ? 'withdrawn_early' : 'matured';
        deposit.endDay = day;
        deposit.finalInterest = interest;

        this.addTransaction(BankData.transactionTypes.FIXED_WITHDRAW, -totalAmount,
            `${early ? '提前支取' : '到期支取'} - ${deposit.productName}，利息: ¥${interest.toFixed(2)}`, day, hour);
        eventBus.emit('bank:fixedDepositWithdrawn', { deposit, totalAmount, interest, early });
        return { totalAmount, interest, early };
    }

    /**
     * 理财申购（内部方法）：浮动收益，到期一次结算
     */
    _depositWealth(product, amount, day, hour) {
        const inv = {
            id: 'wl_' + Date.now() + '_' + (++this._idSeq) + '_' + Math.floor(Math.random() * 1000),
            productId: product.id,
            productName: product.name,
            riskLevel: product.riskLevel || '中风险',
            amount: amount,
            annualRate: product.annualRate,
            volatility: product.volatility || 0,
            termDays: product.termDays,
            startDay: day,
            matureDay: day + product.termDays,
            status: 'active'
        };
        this.state.wealthInvestments.push(inv);
        this.addTransaction(BankData.transactionTypes.WEALTH_DEPOSIT, amount,
            `理财申购 - ${product.name}`, day, hour);
        eventBus.emit('bank:wealthCreated', inv);
        return inv;
    }

    /**
     * 理财赎回/到期（内部方法）
     * 实际年化 = 预期年化 ± 波动（均匀分布），到期按满期结算；
     * 提前赎回收 0.5% 手续费（按已持有天数估算收益），可能亏损本金
     */
    _withdrawWealth(invId, early, day, hour) {
        const inv = this.state.wealthInvestments.find(x => x.id === invId);
        if (!inv || inv.status !== 'active') return null;

        const days = Math.max(1, (early ? (day - inv.startDay) : inv.termDays));
        const actualRate = inv.annualRate + (Math.random() * 2 - 1) * (inv.volatility || 0);
        let interest = inv.amount * actualRate * days / 365;
        if (early) {
            interest -= inv.amount * 0.005; // 提前赎回手续费 0.5%
        }

        const totalAmount = Math.max(0, inv.amount + interest);
        inv.status = early ? 'redeemed_early' : 'matured';
        inv.endDay = day;
        inv.actualRate = actualRate;
        inv.finalInterest = interest;

        this.addTransaction(BankData.transactionTypes.WEALTH_WITHDRAW, -totalAmount,
            `${early ? '提前赎回' : '到期结算'} - ${inv.productName}，${interest >= 0 ? '收益' : '亏损'}: ¥${Math.abs(interest).toFixed(2)}`, day, hour);
        eventBus.emit('bank:wealthWithdrawn', { inv, totalAmount, interest, early });
        return { totalAmount, interest, early, actualRate };
    }

    /**
     * 申请贷款（内部方法）
     * 防御性护栏：即使被绕过 bankEngine.applyLoan 直接调用，也拒绝非法/超额贷款
     * @param {object} product 贷款产品
     * @param {number} amount 金额
     * @param {number} term 期限
     * @param {number} day 游戏日
     * @param {number} hour 游戏小时
     * @param {object} [ctx] 可选业务上下文 {shopLevel, shopReputation, totalTurnover}，用于额度二次校验
     */
    _applyLoan(product, amount, term, day, hour, ctx) {
        // 1. 产品与数值合法性
        if (!product || !product.id) return null;
        amount = Number(amount);
        term = Number(term);
        if (!Number.isFinite(amount) || amount <= 0) return null;
        if (!Number.isFinite(term) || term <= 0 || Math.floor(term) !== term) return null;

        // 2. 绝对上限（默认 100 亿），拦截 Infinity/NaN/超天文数字
        const cfg = (typeof BankData !== 'undefined' && BankData.creditLimit) || {};
        const absMax = Number(cfg.maxLimit) > 0 ? Number(cfg.maxLimit) : 10000000000;
        if (amount > absMax) return null;

        // 3. 若提供业务上下文，则按可用额度二次拦截（与 bankEngine.applyLoan 同规则，防直连绕过）
        if (ctx) {
            const level = Math.max(1, Math.floor(Number(ctx.shopLevel) || 1));
            const rep = Math.max(0, Number(ctx.shopReputation) || 0);
            const turnover = Math.max(0, Number(ctx.totalTurnover) || 0);
            if (typeof this.getAvailableCredit === 'function') {
                let cap;
                try { cap = this.getAvailableCredit(level, rep, turnover); } catch (e) { cap = absMax; }
                if (Number.isFinite(cap) && amount > cap) return null;
            }
        }

        // 信用评级利率折扣（有业务上下文时生效，评级越高利率越低）
        let rateDiscount = 0;
        let creditRatingId = null;
        if (ctx) {
            try {
                const rating = this.getCreditRating(ctx.shopLevel, ctx.shopReputation, ctx.totalTurnover);
                rateDiscount = Number(rating.rateDiscount) || 0;
                creditRatingId = rating.id || null;
            } catch (_) {}
        }
        const effectiveRate = product.interestRate * (1 - rateDiscount);

        const loan = {
            id: 'loan_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
            productId: product.id,
            productName: product.name,
            amount: amount,
            term: term,
            remainingTerm: term,
            interestRate: effectiveRate,
            baseInterestRate: product.interestRate,
            rateDiscount,
            creditRating: creditRatingId,
            dailyRepayment: amount / term,
            dailyInterest: amount * effectiveRate,
            remainingAmount: amount,
            totalInterest: 0,
            startDay: day,
            status: 'active',
            overdueDays: 0,
            paidDays: 0
        };
        this.state.loans.push(loan);
        this.addTransaction(BankData.transactionTypes.LOAN_DISBURSE, amount,
            `贷款 - ${product.name}，期限${term}天`, day, hour);
        eventBus.emit('bank:loanCreated', loan);
        return loan;
    }

    /**
     * 还款（内部方法）
     */
    _repayLoan(loanId, amount, day, hour) {
        const loan = this.state.loans.find(l => l.id === loanId);
        if (!loan) return null;

        const repay = Math.min(amount, loan.remainingAmount);
        loan.remainingAmount -= repay;

        if (loan.remainingAmount <= 0.01) {
            loan.status = 'paid';
            loan.paidDay = day;
            loan.remainingAmount = 0;
        }

        this.addTransaction(BankData.transactionTypes.LOAN_REPAY, -repay,
            `还款 - ${loan.productName}`, day, hour);
        eventBus.emit('bank:loanRepaid', { loan, repaid: repay, remaining: loan.remainingAmount });
        return { repaid: repay, remaining: loan.remainingAmount, loan };
    }
}

const bankState = new BankState();
