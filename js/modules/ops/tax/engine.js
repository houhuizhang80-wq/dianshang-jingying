/**
 * 纳税中心 — Engine
 * 纳税周期与游戏真实日历（year/month/monthDay）对齐，不再使用「每30天一个月」的假周期。
 */
const TaxEngine = {
    _initialized: false,
    _lastCalendarKey: null,
    _promptedPayIds: null, // Set：同一账期同一天只弹一次缴费确认

    init() {
        if (this._initialized) return { success: true };
        try {
            if (typeof eventBus !== 'undefined') {
                eventBus.on('game:dailyTick', (data) => this._handleDailyTick(data));
                eventBus.on('tax:request:pay', (data) => this.payTaxes(data.gameStateRef, data.year, data.month));
            }
            this._initialized = true;
            // 初始化后立刻与当前游戏日历对齐
            try {
                const gs = (typeof gameState !== 'undefined') ? gameState : null;
                if (gs) this.syncWithGameCalendar(gs);
            } catch (_) {}
            return { success: true };
        } catch (e) {
            return { success: false, msg: e.message };
        }
    },

    _getGameContext(gameStateRef) {
        try {
            return gameStateRef || (typeof eventBus !== 'undefined' ? (eventBus._gameContextCache || eventBus._gameContext) : null)
                || { shopLevel: 1, shopReputation: 50, funds: 0, day: 1, hour: 8 };
        } catch (_) {
            return { shopLevel: 1, shopReputation: 50, funds: 0, day: 1, hour: 8 };
        }
    },

    /** 读取并同步游戏真实日历 */
    _getCalendar(gameStateRef) {
        let gt = null;
        try {
            if (gameStateRef && gameStateRef.state && gameStateRef.state.gameTime) gt = gameStateRef.state.gameTime;
            else if (typeof gameState !== 'undefined' && gameState && gameState.state) gt = gameState.state.gameTime;
        } catch (_) {}
        if (!gt) gt = { day: 1 };
        try {
            if (typeof GAME_syncRealDateToGameTime === 'function') GAME_syncRealDateToGameTime(gt);
        } catch (_) {}
        if (gt.year && gt.month && gt.monthDay) {
            return {
                year: gt.year,
                month: gt.month,
                monthDay: gt.monthDay,
                day: gt.day || 1,
                weekday: gt.weekday || gt.dayOfWeek || 1
            };
        }
        if (typeof GAME_fromTotalDays === 'function') {
            const real = GAME_fromTotalDays(gt.day || 1);
            return {
                year: real.year,
                month: real.month,
                monthDay: real.monthDay,
                day: gt.day || 1,
                weekday: real.weekday
            };
        }
        // 极端兜底（不应走到）
        const day = gt.day || 1;
        return {
            year: 2026,
            month: Math.floor((day - 1) / 30) + 8,
            monthDay: ((day - 1) % 30) + 1,
            day,
            weekday: 1
        };
    },

    _prevMonth(year, month) {
        let y = year, m = month - 1;
        if (m < 1) { m = 12; y -= 1; }
        return { year: y, month: m };
    },

    _nextMonth(year, month) {
        let y = year, m = month + 1;
        if (m > 12) { m = 1; y += 1; }
        return { year: y, month: m };
    },

    _monthIndex(year, month) {
        return (Number(year) || 0) * 12 + (Number(month) || 0);
    },

    _emptyDeductible() {
        return { purchase: 0, express: 0, salary: 0, packaging: 0, warehouse_rent: 0, legal_fee: 0, platform: 0 };
    },

    /**
     * 把 currentPeriod 校准到游戏真实年月。
     * - 旧档 2024/1 等假周期 → 直接对齐当前月
     * - 跨月未结 → 由 settleCurrentMonthIfNeeded 结算
     */
    syncWithGameCalendar(gameStateRef) {
        try {
            const taxState = this._resolveTaxState(gameStateRef) || (typeof TaxState !== 'undefined' ? TaxState.getState() : null);
            if (!taxState || !taxState.currentPeriod) return { success: false, msg: '纳税状态未初始化' };
            const cal = this._getCalendar(gameStateRef);
            const cp = taxState.currentPeriod;
            const cpIdx = this._monthIndex(cp.year, cp.month);
            const calIdx = this._monthIndex(cal.year, cal.month);

            // 明显错位（旧 2024 假周期 / 超前 / 落后超过一年）：对齐到当前自然月，保留已累计金额
            const clearlyWrong = !cp.year || cp.year < 2026 || cpIdx > calIdx + 1 || cpIdx < calIdx - 12;
            if (clearlyWrong) {
                cp.year = cal.year;
                cp.month = cal.month;
            }

            // 确保抵扣字典含 platform
            if (!cp.deductibleCosts || typeof cp.deductibleCosts !== 'object') {
                cp.deductibleCosts = this._emptyDeductible();
            } else if (cp.deductibleCosts.platform == null) {
                cp.deductibleCosts.platform = 0;
            }

            this._lastCalendarKey = `${cal.year}-${cal.month}`;
            return { success: true, calendar: cal, period: { year: cp.year, month: cp.month } };
        } catch (e) {
            return { success: false, msg: e.message };
        }
    },

    calcVat(revenue) {
        const r = Number(revenue) || 0;
        const rates = this._getEntityRates();
        const thr = (rates && rates.vatThreshold != null) ? rates.vatThreshold : TAX_CONFIG.vatThreshold;
        const rate = (rates && rates.vatRate != null) ? rates.vatRate : TAX_CONFIG.vatRate;
        if (rate <= 0) return 0;
        if (r <= thr) return 0;
        return Math.round(r * rate * 100) / 100;
    },

    calcSurcharge(vat) {
        return Math.round((Number(vat) || 0) * TAX_CONFIG.surchargeRate * 100) / 100;
    },

    calcCorporateTax(annualProfit) {
        const p = Number(annualProfit) || 0;
        if (p <= 0) return 0;
        const rates = this._getEntityRates();
        // 个人：简易所得税
        if (rates && rates.incomeTaxRate > 0) {
            return Math.round(p * rates.incomeTaxRate * 100) / 100;
        }
        const th = (rates && rates.corporateTaxThreshold != null)
            ? rates.corporateTaxThreshold
            : TAX_CONFIG.corporateTaxThreshold;
        const lowRate = (rates && rates.corporateTaxRate != null)
            ? rates.corporateTaxRate
            : TAX_CONFIG.corporateTaxRate;
        const highRate = (rates && rates.corporateTaxHighRate != null)
            ? rates.corporateTaxHighRate
            : TAX_CONFIG.corporateTaxHighRate;
        if (p <= th) return Math.round(p * lowRate * 100) / 100;
        const low = th * lowRate;
        const high = (p - th) * highRate;
        return Math.round((low + high) * 100) / 100;
    },

    _getEntityRates() {
        let entityType = 'individual';
        try {
            if (typeof gameState !== 'undefined' && gameState.state && gameState.state.shop) {
                entityType = gameState.state.shop.entityType || 'individual';
            }
        } catch (_) {}
        if (typeof getShopEntityTaxRates === 'function') return getShopEntityTaxRates(entityType);
        if (typeof SHOP_ENTITY_TAX !== 'undefined') return SHOP_ENTITY_TAX[entityType] || SHOP_ENTITY_TAX.individual;
        return null;
    },

    _resolveTaxState(state) {
        if (state && state.currentPeriod) return state;
        if (state && state.state && state.state.tax && state.state.tax.currentPeriod) return state.state.tax;
        try { return TaxState.getState(); } catch (_) { return null; }
    },

    accumulateMonthlyRevenue(state, amount) {
        try {
            const taxState = this._resolveTaxState(state);
            if (!taxState || !taxState.currentPeriod) return { success: false, msg: '纳税状态未初始化' };
            taxState.currentPeriod.revenue += Number(amount) || 0;
            TaxState.addRecord('revenue', { amount: Number(amount) || 0 });
            try { if (typeof eventBus !== 'undefined') eventBus.emit('tax:revenueUpdated', taxState.currentPeriod); } catch (_) {}
            return { success: true, revenue: taxState.currentPeriod.revenue };
        } catch (e) {
            return { success: false, msg: e.message };
        }
    },

    accumulateDeductibleCost(state, category, amount) {
        try {
            const taxState = this._resolveTaxState(state);
            if (!taxState || !taxState.currentPeriod) return { success: false, msg: '纳税状态未初始化' };
            if (!TAX_DEDUCTION_CATEGORIES.includes(category)) return { success: false, msg: '无效的成本抵扣类别: ' + category };
            const amt = Number(amount) || 0;
            if (!taxState.currentPeriod.deductibleCosts) taxState.currentPeriod.deductibleCosts = this._emptyDeductible();
            if (taxState.currentPeriod.deductibleCosts[category] == null) taxState.currentPeriod.deductibleCosts[category] = 0;
            taxState.currentPeriod.deductibleCosts[category] += amt;
            TaxState.addRecord('deduction', { category, amount: amt });
            return { success: true, category, current: taxState.currentPeriod.deductibleCosts[category] };
        } catch (e) {
            return { success: false, msg: e.message };
        }
    },

    _calcTotalDeductible(costs) {
        let total = 0;
        for (const k of TAX_DEDUCTION_CATEGORIES) total += Number(costs && costs[k]) || 0;
        return total;
    },

    // 兼容旧调用名（已弃用假 30 天月），改为真实月内日 / 真实月份
    _getDayOfMonth(dayOrRef) {
        if (typeof dayOrRef === 'object') return this._getCalendar(dayOrRef).monthDay;
        if (typeof GAME_fromTotalDays === 'function') return GAME_fromTotalDays(dayOrRef || 1).monthDay;
        return (((Number(dayOrRef) || 1) - 1) % 30) + 1;
    },
    _getMonthFromDay(dayOrRef) {
        if (typeof dayOrRef === 'object') return this._getCalendar(dayOrRef).month;
        if (typeof GAME_fromTotalDays === 'function') return GAME_fromTotalDays(dayOrRef || 1).month;
        return Math.floor(((Number(dayOrRef) || 1) - 1) / 30) + 1;
    },

    /**
     * 真实日历跨月时结算上一账期。
     * 例：游戏日从 8/31 → 9/1，结算 2026年8月，开启 9 月账期。
     */
    settleCurrentMonthIfNeeded(gameStateRef) {
        try {
            const cal = this._getCalendar(gameStateRef);
            const taxState = (typeof TaxState !== 'undefined') ? TaxState.getState() : this._resolveTaxState(gameStateRef);
            if (!taxState || !taxState.currentPeriod) return { success: false, msg: '纳税状态未初始化' };

            this.syncWithGameCalendar(gameStateRef);

            const key = `${cal.year}-${cal.month}`;
            const cp = taxState.currentPeriod;
            let cpKey = `${cp.year}-${cp.month}`;

            // 同月：无需结算
            if (cpKey === key) {
                this._lastCalendarKey = key;
                return { success: true, skipped: true, reason: 'same_month', calendar: cal };
            }

            // 账期超前（不应发生）：拉回当前月
            if (this._monthIndex(cp.year, cp.month) > this._monthIndex(cal.year, cal.month)) {
                cp.year = cal.year;
                cp.month = cal.month;
                this._lastCalendarKey = key;
                return { success: true, skipped: true, reason: 'period_ahead_snapped', calendar: cal };
            }

            // 跨月：逐月结算直到追上当前自然月（跳天时可能跨多月）
            const settled = [];
            let guard = 0;
            while (`${taxState.currentPeriod.year}-${taxState.currentPeriod.month}` !== key && guard++ < 36) {
                const result = this.settleCurrentMonth(gameStateRef);
                if (!result || !result.success) break;
                settled.push({ year: result.report.year, month: result.report.month });
            }
            this._lastCalendarKey = key;
            return { success: true, settled, calendar: cal };
        } catch (e) {
            return { success: false, msg: e.message };
        }
    },

    settleCurrentMonth(gameStateRef) {
        try {
            const taxState = TaxState.getState();
            if (!taxState) return { success: false, msg: '纳税状态未初始化' };
            const cp = taxState.currentPeriod;
            const totalDeductible = this._calcTotalDeductible(cp.deductibleCosts);
            const taxableIncome = Math.max(0, cp.revenue - totalDeductible);
            const vat = this.calcVat(cp.revenue);
            const surcharge = this.calcSurcharge(vat);
            const corporateTax = this.calcCorporateTax(taxableIncome);
            const totalPayable = Math.round((vat + surcharge + corporateTax) * 100) / 100;
            const settledReport = {
                year: cp.year, month: cp.month, revenue: cp.revenue,
                deductibleCosts: { ...(cp.deductibleCosts || this._emptyDeductible()) },
                totalDeductible, taxableIncome,
                vatPayable: vat, surchargePayable: surcharge, corporateTaxPayable: corporateTax,
                totalPayable, declared: false, paid: false, declareDate: null, payDate: null,
                overdueDays: 0, lateFees: 0, fines: 0
            };
            TaxState.createMonthlyReport(cp.year, cp.month, settledReport);
            const next = this._nextMonth(cp.year, cp.month);
            taxState.currentPeriod = {
                year: next.year, month: next.month, revenue: 0,
                deductibleCosts: this._emptyDeductible(),
                taxableIncome: 0, vatPayable: 0, surchargePayable: 0, corporateTaxPayable: 0, totalPayable: 0,
                declared: false, paid: false, declareDate: null, payDate: null, overdueDays: 0, lateFees: 0, fines: 0
            };
            TaxState.addRecord('settle', { year: settledReport.year, month: settledReport.month, totalPayable });
            try { if (typeof eventBus !== 'undefined') eventBus.emit('tax:monthSettled', settledReport); } catch (_) {}
            // 月结出账后：若有应缴税额，立刻弹缴费确认
            try {
                if (settledReport.totalPayable > 0) {
                    const cal = this._getCalendar(gameStateRef);
                    this._promptDueTaxPayments(gameStateRef, [{
                        year: settledReport.year,
                        month: settledReport.month,
                        type: 'declare',
                        totalPayable: settledReport.totalPayable
                    }], cal);
                }
            } catch (_) {}
            return { success: true, report: settledReport };
        } catch (e) {
            return { success: false, msg: e.message };
        }
    },

    // ==================== 税务筹划（纳税中心深化） ====================
    /**
     * 税务筹划：合法申请税收优惠，减免最新未结清月报应缴税额的 5%（每期一次）。
     * 信誉越高，减免成功率越高（信誉 ≥80 必成功，否则按信誉比例成功）。
     */
    applyTaxPreference(gameStateRef) {
        try {
            const taxState = TaxState.getState();
            if (!taxState) return { success: false, message: '纳税状态未初始化' };
            const reports = TaxState.getUnpaidReports();
            const candidates = (reports || [])
                .filter(r => r && Number(r.totalPayable) > 0 && !r.taxPreferenceApplied)
                .sort((a, b) => (b.year * 12 + b.month) - (a.year * 12 + a.month));
            if (!candidates.length) return { success: false, message: '当前没有可筹划减免的应缴税款' };
            const report = candidates[0];

            // 信誉影响成功率（信誉 0~100 → 成功率 0~100%）
            let reputation = 60;
            try {
                const gs = gameStateRef || (typeof gameState !== 'undefined' ? gameState : null);
                if (gs && gs.state && gs.state.shop && typeof gs.state.shop.reputation === 'number') {
                    reputation = gs.state.shop.reputation;
                }
            } catch (_) {}
            const successRate = Math.max(0, Math.min(1, reputation / 100));
            if (Math.random() > successRate) {
                report.taxPreferenceApplied = true; // 本次筹划失败，本期不可再申请
                TaxState.addRecord('tax_preference', { year: report.year, month: report.month, success: false });
                return { success: false, message: '筹划申请未通过（信誉不足），本期不可再次申请' };
            }

            const reduction = Math.round(Number(report.totalPayable) * 0.05 * 100) / 100;
            report.totalPayable = Math.round((Number(report.totalPayable) - reduction) * 100) / 100;
            report.taxPreferenceApplied = true;
            report.taxPreferenceReduction = reduction;
            TaxState.addRecord('tax_preference', { year: report.year, month: report.month, reduction, success: true });
            try { if (typeof eventBus !== 'undefined') eventBus.emit('tax:stateChanged', taxState); } catch (_) {}
            return { success: true, message: `✅ 税收筹划成功：减免 ${report.year}年${report.month}月 应缴税 ¥${reduction.toFixed(2)}`, reduction };
        } catch (e) {
            return { success: false, message: e && e.message };
        }
    },

    /** 报税截止日之后的逾期天数（真实日历） */
    _calcOverdueDays(report, cal) {
        const windowDays = (TAX_CONFIG && TAX_CONFIG.taxWindowDays) || 15;
        // 截止：所属月的次月 taxWindowDays 日
        const due = this._nextMonth(report.year, report.month);
        let dueTotal;
        let nowTotal;
        if (typeof GAME_toTotalDays === 'function') {
            dueTotal = GAME_toTotalDays(due.year, due.month, windowDays);
            nowTotal = GAME_toTotalDays(cal.year, cal.month, cal.monthDay);
        } else {
            dueTotal = due.year * 372 + due.month * 31 + windowDays;
            nowTotal = cal.year * 372 + cal.month * 31 + cal.monthDay;
        }
        return Math.max(0, nowTotal - dueTotal);
    },

    checkTaxWindowAndEnforce(gameStateRef) {
        try {
            const cal = this._getCalendar(gameStateRef);
            const dayOfMonth = cal.monthDay;
            const taxState = TaxState.getState();
            if (!taxState) return { success: false, msg: '纳税状态未初始化' };
            const result = { reminders: [], overdueUpdated: [], penalties: [], statusChanged: null };
            const windowDays = (TAX_CONFIG && TAX_CONFIG.taxWindowDays) || 15;

            // 每月 1–15 日：提醒上月及所有未结清月报
            if (dayOfMonth >= 1 && dayOfMonth <= windowDays) {
                const prev = this._prevMonth(cal.year, cal.month);
                const toRemind = [{ year: prev.year, month: prev.month }];
                for (const mm of taxState.monthlyReports || []) {
                    if ((!mm.declared || !mm.paid) && !toRemind.some(x => x.year === mm.year && x.month === mm.month)) {
                        toRemind.push({ year: mm.year, month: mm.month });
                    }
                }
                for (const t of toRemind) {
                    const rep = (taxState.monthlyReports || []).find(r => r.year === t.year && r.month === t.month);
                    if (rep && (!rep.declared || !rep.paid) && rep.totalPayable > 0) {
                        result.reminders.push({
                            year: rep.year, month: rep.month,
                            type: rep.declared ? 'pay' : 'declare',
                            totalPayable: rep.totalPayable
                        });
                    }
                }
            }

            // 逾期：超过次月申报窗口
            for (const rep of taxState.monthlyReports || []) {
                if (!(rep.totalPayable > 0) || (rep.declared && rep.paid)) continue;
                const extraDays = this._calcOverdueDays(rep, cal);
                if (extraDays > 0 && extraDays > (rep.overdueDays || 0)) {
                    rep.overdueDays = extraDays;
                    if (!rep.paid) {
                        rep.lateFees = Math.round(rep.totalPayable * TAX_CONFIG.lateFeeRate * extraDays * 100) / 100;
                    }
                    if (!rep.declared && extraDays > TAX_CONFIG.declarationGraceDays) {
                        rep.fines = Math.round(rep.totalPayable * TAX_CONFIG.fineRate * 100) / 100;
                    }
                    result.overdueUpdated.push({
                        year: rep.year, month: rep.month,
                        overdueDays: extraDays, lateFees: rep.lateFees, fines: rep.fines
                    });
                    this._enforcePenalties(rep, extraDays, taxState, result);
                }
            }

            taxState.status.overdue = (taxState.monthlyReports || []).some(r => r.overdueDays > 0 && (!r.declared || !r.paid));
            if (result.overdueUpdated.length) {
                TaxState.addRecord('overdue_check', { day: cal.day, calendar: cal, updates: result.overdueUpdated });
            }
            // 报税窗口内：有待缴/待申报税款时弹出付款确认
            try { this._promptDueTaxPayments(gameStateRef, result.reminders, cal); } catch (_) {}
            return { success: true, calendar: cal, ...result };
        } catch (e) {
            return { success: false, msg: e.message };
        }
    },

    /**
     * 纳税缴费弹窗：每月报税窗口（1–15日）及未结清月报，弹出确认后扣款
     * 同一 year-month 同一游戏日只弹一次，避免每小时刷屏
     */
    _promptDueTaxPayments(gameStateRef, reminders, cal) {
        if (typeof eventBus === 'undefined' || !eventBus.emit) return;
        const list = Array.isArray(reminders) ? reminders : [];
        if (!list.length) return;
        if (!this._promptedPayIds) this._promptedPayIds = new Set();
        const dayKey = (cal && cal.day) || 0;
        const taxState = TaxState.getState();
        if (!taxState) return;

        list.forEach((rem) => {
            if (!rem || !(rem.totalPayable > 0)) return;
            const report = (taxState.monthlyReports || []).find(r => r.year === rem.year && r.month === rem.month);
            if (!report || report.paid) return;
            const promptId = `tax-pay-${rem.year}-${rem.month}-d${dayKey}`;
            if (this._promptedPayIds.has(promptId)) return;
            this._promptedPayIds.add(promptId);
            // 控制集合体积
            if (this._promptedPayIds.size > 80) {
                this._promptedPayIds = new Set(Array.from(this._promptedPayIds).slice(-40));
            }

            const taxAmount = Number(report.totalPayable) || 0;
            const lateFees = Number(report.lateFees) || 0;
            const fines = Number(report.fines) || 0;
            const totalAmount = Math.round((taxAmount + lateFees + fines) * 100) / 100;
            if (!(totalAmount > 0)) return;

            const needDeclare = !report.declared;
            const title = needDeclare ? '纳税申报并缴费' : '纳税缴费确认';
            const revenue = Number(report.revenue) || 0;
            const expense = Number(report.totalDeductible) || 0;
            const profit = (report.taxableIncome != null)
                ? Number(report.taxableIncome)
                : Math.max(0, revenue - expense);
            const detailParts = [
                `${rem.year}年${rem.month}月`,
                `收入 ¥${revenue.toFixed(2)}`,
                `支出 ¥${expense.toFixed(2)}`,
                `利润 ¥${profit.toFixed(2)}`,
                `应纳税额 ¥${taxAmount.toFixed(2)}`
            ];
            if (lateFees > 0) detailParts.push(`滞纳金 ¥${lateFees.toFixed(2)}`);
            if (fines > 0) detailParts.push(`罚款 ¥${fines.toFixed(2)}`);
            if (needDeclare) detailParts.push('（尚未申报，确认后将一并申报并扣款）');

            const gsRef = gameStateRef;
            eventBus.emit('payment:request', {
                id: promptId,
                category: 'tax',
                noCancel: true,
                year: rem.year,
                month: rem.month,
                title,
                amount: totalAmount,
                detail: detailParts.join(' · '),
                note: '报税窗口期（每月1–15日）须现场确认支付，确认后申报并扣款，无法取消。',
                execute: () => {
                    const res = this.payTaxes(gsRef || (typeof gameState !== 'undefined' ? gameState : null), rem.year, rem.month);
                    if (res && res.success === false) {
                        try {
                            if (typeof ui !== 'undefined' && ui.showToast) ui.showToast(res.msg || '缴税失败');
                        } catch (_) {}
                        return res;
                    }
                    try {
                        if (typeof taxUI !== 'undefined' && taxUI.refresh) taxUI.refresh();
                    } catch (_) {}
                    return res;
                }
            });
        });
    },

    _enforcePenalties(report, overdueDays, taxState, result) {
        if (overdueDays > TAX_CONFIG.declarationGraceDays && overdueDays <= TAX_CONFIG.declarationGraceDays + 20) {
            if (!taxState.status.underInvestigation) {
                taxState.status.underInvestigation = true;
                TaxState.addWarning(`${report.year}年${report.month}月税务逾期${overdueDays}天，已进入税务稽查观察名单`, 'warning');
                result.statusChanged = 'underInvestigation';
            }
        }
        if (overdueDays > TAX_CONFIG.declarationGraceDays + 20 && overdueDays <= TAX_CONFIG.declarationGraceDays + 45) {
            if (!taxState.status.restrictedFlow) {
                taxState.status.restrictedFlow = true;
                TaxState.addWarning('长期欠税，店铺资金流水已被限制，请立即补缴', 'error');
                result.statusChanged = 'restrictedFlow';
                result.penalties.push({ type: 'restrictedFlow', report: `${report.year}-${report.month}` });
            }
        }
        if (overdueDays > TAX_CONFIG.declarationGraceDays + 45) {
            if (!taxState.status.forcedClose) {
                taxState.status.forcedClose = true;
                TaxState.addWarning('严重欠税！店铺已被强制闭店整顿！', 'error');
                result.statusChanged = 'forcedClose';
                result.penalties.push({ type: 'forcedClose', report: `${report.year}-${report.month}` });
            }
        }
    },

    payTaxes(gameStateRef, year, month) {
        try {
            const taxState = TaxState.getState();
            if (!taxState) return { success: false, msg: '纳税状态未初始化' };
            const report = taxState.monthlyReports.find(r => r.year === year && r.month === month);
            if (!report) return { success: false, msg: `未找到${year}年${month}月的税务报表` };
            // 批量付款确认时可能重复入队：已缴清视为成功（幂等）
            if (report.paid) return { success: true, paid: 0, skipped: true, msg: '该月税款已缴清' };
            const taxAmount = Number(report.totalPayable) || 0;
            const lateFees = Number(report.lateFees) || 0;
            const fines = Number(report.fines) || 0;
            const totalAmount = Math.round((taxAmount + lateFees + fines) * 100) / 100;
            if (totalAmount <= 0) {
                TaxState.markPaid(year, month, 0);
                return { success: true, paid: 0, msg: '本月应缴税额为0，已标记结清' };
            }
            const gs = (gameStateRef && typeof gameStateRef.spendFunds === 'function')
                ? gameStateRef
                : ((typeof gameState !== 'undefined' && gameState && typeof gameState.spendFunds === 'function')
                    ? gameState
                    : (gameStateRef || this._getGameContext(gameStateRef)));
            let spendOk = false;
            if (gs && typeof gs.spendFunds === 'function') spendOk = gs.spendFunds(totalAmount, `纳税：${year}年${month}月`);
            else {
                // 无 spendFunds 时仅在真实店铺资金上扣款，避免误用兜底 { funds:0 }
                const shop = (typeof gameState !== 'undefined' && gameState && gameState.state && gameState.state.shop)
                    ? gameState.state.shop
                    : null;
                if (shop && (shop.funds - totalAmount) >= ((typeof SHOP_CONFIG !== 'undefined' && SHOP_CONFIG.maxDebt != null) ? SHOP_CONFIG.maxDebt : -100000)) {
                    shop.funds -= totalAmount;
                    spendOk = true;
                }
            }
            if (!spendOk) return { success: false, msg: `资金不足，需 ¥${totalAmount.toFixed(2)}` };
            if (!report.declared) TaxState.markDeclared(year, month);
            TaxState.markPaid(year, month, totalAmount);
            TaxState.addRecord('tax_pay', { year, month, taxAmount, lateFees, fines, totalAmount });
            const hasOverdue = taxState.monthlyReports.some(r => r.overdueDays > 0 && (!r.declared || !r.paid));
            if (!hasOverdue) {
                taxState.status.overdue = false;
                taxState.status.underInvestigation = false;
                taxState.status.restrictedFlow = false;
                taxState.status.forcedClose = false;
            }
            return { success: true, paid: totalAmount, taxAmount, lateFees, fines };
        } catch (e) {
            return { success: false, msg: e.message };
        }
    },

    _handleDailyTick(dayInfo) {
        try {
            const day = (dayInfo && dayInfo.day) || 1;
            const ref = (typeof gameState !== 'undefined' && gameState)
                ? gameState
                : { state: { gameTime: { day } } };
            this.settleCurrentMonthIfNeeded(ref);
            this.checkTaxWindowAndEnforce(ref);
        } catch (_) {}
    }
};

if (typeof window !== 'undefined') window.TaxEngine = TaxEngine;
