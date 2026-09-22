/**
 * 法务维权 — Engine（canAppeal 72h / tick / 判决）
 */
const LegalEngine = {
    _gameState: null,
    _lastTickHour: -1,

    init(gameState) {
        this._gameState = gameState;
        LegalState.init(gameState);
    },

    _getNow(gs) {
        const state = gs || this._gameState;
        if (state && state.state && state.state.gameTime) return { ...state.state.gameTime };
        return { day: 1, hour: 0 };
    },

    _hoursSince(fromTime, toTime) {
        if (!fromTime || !toTime) return Infinity;
        const t1 = ((fromTime.day || 1) - 1) * 24 + (fromTime.hour || 0);
        const t2 = ((toTime.day || 1) - 1) * 24 + (toTime.hour || 0);
        return Math.max(0, t2 - t1);
    },

    _activeLawyers(gs) {
        const state = (gs || this._gameState);
        try {
            return ((state && state.state && state.state.employees) || []).filter(e =>
                e && (e.type === 'lawyer' || e.type === 'legal') &&
                e.status !== 'fired' && e.status !== 'resigned' && e.status !== 'inactive'
            );
        } catch (_) { return []; }
    },

    _statuteText(ids) {
        const book = (typeof LEGAL_STATUTES !== 'undefined') ? LEGAL_STATUTES : {};
        return (ids || []).map(id => book[id]).filter(Boolean)
            .map(s => s.cite + '：' + s.text).join('\n');
    },

    _hasOpenCase(pred) {
        try {
            return LegalState.getCases().some(c => c && c.status !== LITIGATION_STATUS.closed && pred(c));
        } catch (_) { return false; }
    },

    /** 已退款未退货 / 快递拒赔 等可立案线索 */
    listAutoTargets(gameStateRef) {
        const gs = gameStateRef || this._gameState;
        if (!gs || !gs.state) return [];
        const now = this._getNow(gs);
        const cfg = (typeof LEGAL_PROCESS_CONFIG !== 'undefined' && LEGAL_PROCESS_CONFIG.autoFile)
            ? LEGAL_PROCESS_CONFIG.autoFile : { goodsNotReturnedHours: 18, courierWaitHours: 12 };
        const out = [];

        const returns = (gs.state.customerService && gs.state.customerService.returns) || [];
        for (let i = 0; i < returns.length; i++) {
            const r = returns[i];
            if (!r || r._legalAutoFiled) continue;
            if (this._hasOpenCase(c => c.csReturnId === r.id || (r.orderId && c.orderId === r.orderId && c.reasonId === 'goods_not_returned'))) continue;
            const refunded = !!(r.alreadyRefunded || r.refundAmount > 0);
            const kept = r.goodsKeptByBuyer || r.goodsReturned === false ||
                (r.type === 'refund_only' && refunded && !r.sellerReceiveTime && !r._restockedToWarehouse);
            const wont = !!(r._buyerWontReturn && refunded);
            if (!(refunded && (kept || wont))) continue;
            const from = r.refundTime || r.auditTime || r.createTime;
            if (this._hoursSince(from, now) < (cfg.goodsNotReturnedHours || 18)) continue;
            const amt = parseFloat(r.refundAmount != null ? r.refundAmount : r.amount) || 0;
            if (amt <= 0) continue;
            out.push({
                kind: 'goods_not_returned',
                csReturnId: r.id,
                orderId: r.orderId || null,
                amount: amt,
                title: r.productName || '商品',
                defendant: 'buyer',
                defendantName: r.buyerName || '买家',
                source: r
            });
        }

        const orders = gs.state.orders || [];
        for (let i = 0; i < orders.length; i++) {
            const o = orders[i];
            if (!o || o._legalAutoFiledExpress) continue;
            const lost = !!(o.lossChecked && (
                (o.logistics && o.logistics.status === 'lost') || o.exceptionReason === '包裹丢失'
            ));
            if (!lost) continue;
            const refused = !!(o._courierIndemnityRefused);
            const short = !!(o._courierIndemnityShort);
            const unpaid = !o._courierIndemnityPaid && (o.courierIndemnity || 0) <= 0;
            if (!(refused || short || unpaid)) continue;
            if (this._hasOpenCase(c => c.orderId === o.id && c.reasonId === 'courier_loss_unpaid')) continue;
            const lossTime = (o.logistics && o.logistics.updates && o.logistics.updates.length)
                ? now : (o.shipTime || o.createTime || now);
            if (this._hoursSince(o.shipTime || o.createTime || now, now) < (cfg.courierWaitHours || 12)) continue;
            const paid = parseFloat(o.courierIndemnity) || 0;
            const gap = Math.max(0, (parseFloat(o.refundedAmount != null ? o.refundedAmount : o.totalAmount) || 0) - paid);
            if (gap <= 0) continue;
            let cname = '快递公司';
            try {
                if (typeof getCompanyById === 'function' && o.expressCompanyId) {
                    cname = (getCompanyById(o.expressCompanyId) || {}).name || cname;
                }
            } catch (_) {}
            out.push({
                kind: 'courier_loss_unpaid',
                csReturnId: null,
                orderId: o.id,
                amount: gap,
                title: o.productName || '快件',
                defendant: 'courier',
                defendantName: cname,
                source: o
            });
        }
        return out;
    },

    submitDirectCase(gameStateRef, payload) {
        const gs = gameStateRef || this._gameState;
        if (!gs) return { success: false, message: '游戏状态不可用' };
        const p = payload || {};
        const reasonId = p.reasonId;
        const reasonInfo = (typeof APPEAL_REASONS !== 'undefined' ? APPEAL_REASONS : []).find(r => r.id === reasonId);
        if (!reasonInfo) return { success: false, message: '无效案由' };

        const sourceAmt = parseFloat(p.claimAmount) || 0;
        const filingFee = (typeof LEGAL_PROCESS_CONFIG !== 'undefined' && LEGAL_PROCESS_CONFIG.filingFee) || 50;
        const HARD_CAP = 1000000;
        let claim = Math.min(Math.max(0, sourceAmt), sourceAmt * 3 || sourceAmt, HARD_CAP);
        claim = Math.round(claim * 100) / 100;
        if (claim <= 0) return { success: false, message: '诉求金额无效' };

        if (typeof gs.spendFunds === 'function' && !gs.spendFunds(filingFee, p.autoFiled ? '律师自动立案受理费' : '法律诉讼受理费')) {
            return { success: false, message: '资金不足，无法支付案件受理费¥' + filingFee };
        }

        let assignedLawyerId = p.lawyerId || null;
        try {
            const lawyers = this._activeLawyers(gs);
            let lawyer = assignedLawyerId ? lawyers.find(e => e.id === assignedLawyerId) : null;
            if (!lawyer && lawyers.length) {
                lawyer = lawyers.slice().sort((a, b) => (b.level || 1) - (a.level || 1))[0];
            }
            if (lawyer) {
                assignedLawyerId = lawyer.id;
                LegalState.addLawyer(lawyer.id, { name: lawyer.name, level: lawyer.level || 1, skills: lawyer.skills || {} });
            }
        } catch (_) {}

        const statuteCite = this._statuteText(reasonInfo.statuteIds || []);
        const legalCase = LegalState.createCase({
            csReturnId: p.csReturnId || null,
            orderId: p.orderId || null,
            reasonId,
            reasonInfo,
            statement: p.statement || '',
            evidence: p.evidence || [],
            claims: p.claims || reasonInfo.suggestedClaims || ['compensation'],
            claimAmount: claim,
            otherClaims: p.otherClaims || '',
            assignedLawyerId,
            strategy: p.strategy || 'litigate',
            autoFiled: !!p.autoFiled,
            caseKind: p.kind || reasonId,
            defendant: p.defendant || 'buyer',
            defendantName: p.defendantName || '',
            statuteCite,
            sourceType: p.sourceType || 'auto'
        });
        try {
            if (assignedLawyerId && typeof gs.addEmployeeExp === 'function') {
                const per = (typeof EMPLOYEE_LEVEL_CONFIG !== 'undefined' && EMPLOYEE_LEVEL_CONFIG.expPerTask)
                    ? (EMPLOYEE_LEVEL_CONFIG.expPerTask.litigation || 3) : 3;
                gs.addEmployeeExp(assignedLawyerId, 'litigation', per);
            }
        } catch (_) {}
        return { success: true, message: (p.autoFiled ? '律师已自动立案' : '上诉已提交') + '，受理费¥' + filingFee, caseData: legalCase, caseId: legalCase.id, filingFee, claimAmount: claim };
    },

    _autoFileByLawyers(gs) {
        const cfg = (typeof LEGAL_PROCESS_CONFIG !== 'undefined' && LEGAL_PROCESS_CONFIG.autoFile)
            ? LEGAL_PROCESS_CONFIG.autoFile : {};
        if (cfg.requireLawyer !== false && !this._activeLawyers(gs).length) return;
        const targets = this.listAutoTargets(gs);
        const cap = cfg.maxAutoPerTick || 3;
        let n = 0;
        for (let i = 0; i < targets.length && n < cap; i++) {
            const t = targets[i];
            const reasonId = t.kind;
            const reasonInfo = (typeof APPEAL_REASONS !== 'undefined' ? APPEAL_REASONS : []).find(r => r.id === reasonId) || {};
            const statement = t.kind === 'goods_not_returned'
                ? `【律师自动起诉】买家${t.defendantName}就「${t.title}」已收取退款¥${t.amount.toFixed(2)}却未退回商品。依据民法典第985条不当得利、消保法第25条，请求返还货款或交付货物，并赔偿因此产生的损失。`
                : `【律师自动起诉】${t.defendantName}承运「${t.title}」途中丢失，拒赔或赔偿不足，尚欠¥${t.amount.toFixed(2)}。依据民法典第832条、快递暂行条例第27条及消保法第26条，请求按实际损失赔偿，不得以未保价格式条款免除法定责任。`;
            const res = this.submitDirectCase(gs, {
                reasonId,
                csReturnId: t.csReturnId,
                orderId: t.orderId,
                claimAmount: t.amount,
                claims: reasonInfo.suggestedClaims,
                statement,
                evidence: [{ type: 'text', content: '律师依职权调取售后记录、物流轨迹、赔付凭证后自动提交' }],
                autoFiled: true,
                kind: t.kind,
                defendant: t.defendant,
                defendantName: t.defendantName,
                sourceType: t.kind,
                strategy: 'litigate'
            });
            if (res && res.success) {
                n++;
                try {
                    if (t.source && t.kind === 'goods_not_returned') t.source._legalAutoFiled = true;
                    if (t.source && t.kind === 'courier_loss_unpaid') t.source._legalAutoFiledExpress = true;
                } catch (_) {}
                try {
                    if (typeof eventBus !== 'undefined' && eventBus.emit) {
                        eventBus.emit('toast:show', {
                            message: `⚖️ 律师已对「${t.title}」提起诉讼（${reasonInfo.name || t.kind}）`,
                            type: 'info'
                        });
                    }
                } catch (_) {}
            }
        }
    },

    canAppeal(csReturn) {
        if (!csReturn) return { ok: false, reason: '退换货记录不存在' };
        const now = this._getNow();
        const cfg = LEGAL_PROCESS_CONFIG;

        const refunded = !!(csReturn.alreadyRefunded || (csReturn.refundAmount > 0));
        const keptGoods = !!(csReturn.goodsKeptByBuyer || csReturn._buyerWontReturn ||
            (csReturn.type === 'refund_only' && refunded && !csReturn.sellerReceiveTime));
        if (refunded && keptGoods) {
            return {
                ok: true,
                reason: '买家已收款未退货，可依不当得利起诉',
                remainingHours: 999,
                triggerType: 'goods_not_returned'
            };
        }

        if (csReturn.type === 'refund_only' && csReturn.auditResult === false && csReturn.auditTime) {
            const hours = this._hoursSince(csReturn.auditTime, now);
            if (hours <= cfg.appealWindowHours) {
                return { ok: true, reason: '仅退款被拒上诉窗口内', remainingHours: cfg.appealWindowHours - hours, triggerType: 'refund_only_rejected' };
            }
        }

        if (csReturn.type === 'return_refund' && csReturn.inspectionResult === 'fail' && csReturn.inspection) {
            const grade = csReturn.inspection.gradeId || csReturn.inspection.grade;
            if (grade === 'C' || grade === 'D') {
                const endTime = csReturn.inspection.endTime;
                if (endTime) {
                    const hours = this._hoursSince(endTime, now);
                    if (hours <= cfg.appealWindowHours) {
                        return { ok: true, reason: `质检${grade}级上诉窗口内`, remainingHours: cfg.appealWindowHours - hours, triggerType: 'inspection_dc' };
                    }
                }
            }
        }

        try {
            const disputes = this._gameState && this._gameState.state && this._gameState.state.customerService
                && this._gameState.state.customerService.disputes;
            if (Array.isArray(disputes)) {
                const dispute = disputes.find(d =>
                    d.orderId === csReturn.orderId && d.status === 'ruled_seller' && d.arbitration && d.arbitration.time
                );
                if (dispute) {
                    const hours = this._hoursSince(dispute.arbitration.time, now);
                    if (hours <= cfg.appealWindowHours) {
                        return {
                            ok: true, reason: '平台仲裁商家胜诉上诉窗口内',
                            remainingHours: cfg.appealWindowHours - hours,
                            triggerType: 'arbitration_ruled_seller', disputeId: dispute.id
                        };
                    }
                }
            }
        } catch (_) {}

        return { ok: false, reason: '不满足上诉条件：超出72小时窗口或无适用情形' };
    },

    submitAppeal(gameStateRef, csReturnId, reasonId, statement, evidence, claims, claimAmount, otherClaims, options) {
        const gs = gameStateRef || this._gameState;
        if (!gs) return { success: false, message: '游戏状态不可用' };
        const opts = options || {};
        let csReturn = null;
        try {
            csReturn = gs.state.customerService && gs.state.customerService.returns
                && gs.state.customerService.returns.find(r => r.id === csReturnId);
        } catch (_) {}
        if (!csReturn) return { success: false, message: '关联的退换货记录不存在' };
        const appealCheck = this.canAppeal(csReturn);
        if (!appealCheck.ok) return { success: false, message: appealCheck.reason };
        const reasonInfo = APPEAL_REASONS.find(r => r.id === reasonId);
        if (!reasonInfo) return { success: false, message: '无效的上诉案由' };

        // ===== 紧急：诉求金额强制钳制，防止任意填写刷钱 =====
        const sourceAmt = parseFloat(csReturn.refundAmount != null ? csReturn.refundAmount : csReturn.amount) || 0;
        const filingFee = (typeof LEGAL_PROCESS_CONFIG !== 'undefined' && LEGAL_PROCESS_CONFIG.filingFee) || 50;
        const HARD_CAP = 1000000; // 单案硬顶 100 万
        const softCap = Math.max(sourceAmt * 3, filingFee * 10, 100);
        let claim = parseFloat(claimAmount) || 0;
        if (!(claim >= 0) || !Number.isFinite(claim)) claim = 0;
        claim = Math.min(claim, softCap, HARD_CAP);
        claim = Math.round(claim * 100) / 100;

        const fee = LEGAL_PROCESS_CONFIG.filingFee;
        if (typeof gs.spendFunds === 'function' && !gs.spendFunds(fee, '法律诉讼受理费-案号待生成')) {
            return { success: false, message: '资金不足，无法支付案件受理费¥' + fee };
        }
        let assignedLawyerId = opts.lawyerId || null;
        let assignedLawyer = null;
        try {
            const lawyers = (gs.state.employees || []).filter(e => e.type === 'lawyer' && e.status === 'active');
            let lawyer = assignedLawyerId ? lawyers.find(e => e.id === assignedLawyerId) : null;
            if (!lawyer && lawyers.length) {
                // 默认指派等级最高者
                lawyer = lawyers.slice().sort((a, b) => (b.level || 1) - (a.level || 1))[0];
            }
            if (lawyer) {
                assignedLawyerId = lawyer.id;
                assignedLawyer = lawyer;
                LegalState.addLawyer(lawyer.id, { name: lawyer.name, level: lawyer.level || 1, skills: lawyer.skills || {} });
            }
        } catch (_) {}
        const strategy = (opts.strategy === 'mediate' || opts.strategy === 'settle' || opts.strategy === 'litigate')
            ? opts.strategy : 'litigate';
        const legalCase = LegalState.createCase({
            csReturnId, orderId: csReturn.orderId, reasonId, reasonInfo,
            statement: statement || '', evidence: evidence || [], claims: claims || [],
            claimAmount: claim, otherClaims: otherClaims || '', assignedLawyerId,
            strategy
        });
        // 立案给律师经验
        try {
            if (assignedLawyerId && typeof gs.addEmployeeExp === 'function') {
                const per = (typeof EMPLOYEE_LEVEL_CONFIG !== 'undefined' && EMPLOYEE_LEVEL_CONFIG.expPerTask)
                    ? (EMPLOYEE_LEVEL_CONFIG.expPerTask.litigation || 3) : 3;
                gs.addEmployeeExp(assignedLawyerId, 'litigation', per);
            }
        } catch (_) {}
        return { success: true, message: '上诉已提交，案件受理费¥' + fee + '已缴纳', caseData: legalCase, caseId: legalCase.id, filingFee: fee, claimAmount: claim };
    },

    _getLawyerQuality(gs, lawyerId) {
        let level = 1;
        let skills = {};
        try {
            const emp = (gs.state.employees || []).find(e => e.id === lawyerId);
            if (emp) {
                level = emp.level || 1;
                skills = emp.skills || {};
            } else {
                const lw = LegalState.getLawyer(lawyerId);
                if (lw) { level = lw.level || 1; skills = lw.skills || {}; }
            }
        } catch (_) {}
        const lit = Number(skills.litigation) || 0;
        const contract = Number(skills.contract) || 0;
        const risk = Number(skills.risk_control) || 0;
        const specialty = (LEGAL_STAFF_CONFIG.lawyer && LEGAL_STAFF_CONFIG.lawyer.specialtyBonus
            && LEGAL_STAFF_CONFIG.lawyer.specialtyBonus.litigation) || 1.6;
        return {
            level,
            skills,
            winBonus: Math.min(0.28, ((level - 1) * 0.03 * specialty) + lit * 0.01),
            recoveryBonus: Math.min(0.25, (level - 1) * 0.04 + contract * 0.008),
            mediateBonus: Math.min(0.25, (level - 1) * 0.03 + risk * 0.01)
        };
    },

    _rollRecoveryRatio(tierId, lawyerQuality) {
        const tier = (typeof LEGAL_OUTCOME_TIERS !== 'undefined' && LEGAL_OUTCOME_TIERS[tierId])
            || { recoveryMin: 0.5, recoveryMax: 0.5 };
        const base = tier.recoveryMin + Math.random() * Math.max(0, (tier.recoveryMax - tier.recoveryMin));
        const boosted = Math.min(1, base + (lawyerQuality ? (lawyerQuality.recoveryBonus || 0) * 0.5 : 0));
        return Math.round(boosted * 1000) / 1000;
    },

    processTick(gameStateRef, hours) {
        const gs = gameStateRef || this._gameState;
        if (!gs || !gs.state) return;
        if (!this._gameState || !gs.state.legal) {
            try { this.init(gs); } catch (_) { return; }
        }
        const now = this._getNow(gs);
        const hourKey = (now.day - 1) * 24 + now.hour;
        if (hourKey === this._lastTickHour && hours <= 1) return;
        this._lastTickHour = hourKey;

        try { this._autoFileByLawyers(gs); } catch (_) {}

        let activeCases = [];
        try {
            activeCases = LegalState.getCases().filter(c => c.status !== LITIGATION_STATUS.closed);
        } catch (_) { return; }

        for (const c of activeCases) {
            c.hoursInCurrentStatus = (c.hoursInCurrentStatus || 0) + hours;
            const created = c.createTime || {};
            const ageHours = ((now.day - (created.day || now.day)) * 24) + ((now.hour || 0) - (created.hour || 0));
            if (c.status === LITIGATION_STATUS.submitted && (c.hoursInCurrentStatus >= (c.nextTransitionHours || 4) || ageHours >= 12)) {
                LegalState.updateCaseStatus(c.id, LITIGATION_STATUS.accepted);
            } else if (c.status === LITIGATION_STATUS.accepted && c.hoursInCurrentStatus >= (c.nextTransitionHours || 2)) {
                LegalState.updateCaseStatus(c.id, LITIGATION_STATUS.review);
            } else if (c.status === LITIGATION_STATUS.review && c.hoursInCurrentStatus >= (c.nextTransitionHours || 3)) {
                // 策略分流：调解 / 和解 / 诉讼
                if (c.strategy === 'mediate') {
                    this._enterMediation(c.id, gs);
                } else if (c.strategy === 'settle') {
                    this._enterSettlement(c.id, gs);
                } else {
                    LegalState.updateCaseStatus(c.id, LITIGATION_STATUS.scheduled);
                }
            } else if (c.status === LITIGATION_STATUS.mediation) {
                if (c.autoFiled && c.hoursInCurrentStatus >= 8) {
                    const ratio = (c.mediationOffer && c.mediationOffer.ratio) || 0;
                    this.respondMediation(c.id, ratio >= 0.55 ? 'accept' : 'reject', undefined, gs);
                } else if (c.hoursInCurrentStatus >= 24) {
                    LegalState.updateCaseStatus(c.id, LITIGATION_STATUS.scheduled, { note: '调解超时，转入开庭' });
                }
            } else if (c.status === LITIGATION_STATUS.settlement_pending) {
                if (c.autoFiled && c.hoursInCurrentStatus >= 6) {
                    const ratio = (c.settlementOffer && c.settlementOffer.ratio) || 0;
                    this.respondSettlement(c.id, ratio >= 0.5 ? 'accept' : 'reject', gs);
                } else if (c.hoursInCurrentStatus >= 18) {
                    this.respondSettlement(c.id, 'accept', gs);
                }
            } else if (c.status === LITIGATION_STATUS.scheduled) {
                const need = c.nextTransitionHours || 72;
                if (c.hoursInCurrentStatus >= need || ageHours >= 200) {
                    this._executeJudgment(c.id, gs);
                }
            } else if (c.status === LITIGATION_STATUS.merchant_win || c.status === LITIGATION_STATUS.partial_win) {
                this._executeMerchantWin(c.id, gs);
            } else if (c.status === LITIGATION_STATUS.buyer_win) {
                this._executeBuyerWin(c.id, gs);
            } else if (c.status === LITIGATION_STATUS.compensation) {
                LegalState.closeCase(c.id);
            }
        }
    },

    _enterMediation(caseId, gs) {
        const c = LegalState.getCase(caseId);
        if (!c) return;
        const q = this._getLawyerQuality(gs, c.assignedLawyerId);
        const offerRatio = Math.min(0.85, Math.max(0.3,
            (LEGAL_PROCESS_CONFIG.mediationAcceptBase || 0.55) - 0.05 + (q.mediateBonus || 0) * 0.4
            + Math.random() * 0.15));
        const offerAmount = Math.round((parseFloat(c.claimAmount) || 0) * offerRatio * 100) / 100;
        c.mediationOffer = { ratio: Math.round(offerRatio * 1000) / 1000, amount: offerAmount, rounds: 0 };
        LegalState.updateCaseStatus(caseId, LITIGATION_STATUS.mediation, {
            note: '进入法院调解', mediationOffer: c.mediationOffer
        });
    },

    _enterSettlement(caseId, gs) {
        const c = LegalState.getCase(caseId);
        if (!c) return;
        const q = this._getLawyerQuality(gs, c.assignedLawyerId);
        const range = LEGAL_PROCESS_CONFIG.settlementRatioRange || [0.35, 0.65];
        let ratio = range[0] + Math.random() * (range[1] - range[0]);
        ratio = Math.min(0.9, ratio + (q.recoveryBonus || 0) * 0.35);
        const amount = Math.round((parseFloat(c.claimAmount) || 0) * ratio * 100) / 100;
        c.settlementOffer = { ratio: Math.round(ratio * 1000) / 1000, amount };
        LegalState.updateCaseStatus(caseId, LITIGATION_STATUS.settlement_pending, {
            note: '对方提出和解方案', settlementOffer: c.settlementOffer
        });
    },

    /** 玩家回应调解：accept / reject / counter */
    respondMediation(caseId, action, counterRatio, gameStateRef) {
        const gs = gameStateRef || this._gameState;
        const c = LegalState.getCase(caseId);
        if (!c || c.status !== LITIGATION_STATUS.mediation) {
            return { success: false, message: '案件不在调解中' };
        }
        const q = this._getLawyerQuality(gs, c.assignedLawyerId);
        if (action === 'reject') {
            LegalState.updateCaseStatus(caseId, LITIGATION_STATUS.scheduled, { note: '调解破裂，转入开庭' });
            return { success: true, message: '已拒绝调解，案件转入开庭排期' };
        }
        if (action === 'accept') {
            const offer = c.mediationOffer || { ratio: 0.5, amount: (c.claimAmount || 0) * 0.5 };
            c.outcomeTier = 'majority';
            c.recoveryRatio = offer.ratio;
            c._settledVia = 'mediation';
            return this._payoutWin(c, gs, offer.amount, '调解成功回款');
        }
        // counter
        const counter = Math.max(0.2, Math.min(0.95, parseFloat(counterRatio) || 0.6));
        const acceptChance = Math.min(0.9, (LEGAL_PROCESS_CONFIG.mediationAcceptBase || 0.55)
            + (q.mediateBonus || 0) - Math.max(0, counter - 0.55) * 0.8);
        c.mediationOffer = c.mediationOffer || {};
        c.mediationOffer.rounds = (c.mediationOffer.rounds || 0) + 1;
        if (Math.random() < acceptChance) {
            const amount = Math.round((parseFloat(c.claimAmount) || 0) * counter * 100) / 100;
            c.outcomeTier = 'majority';
            c.recoveryRatio = counter;
            c._settledVia = 'mediation_counter';
            return this._payoutWin(c, gs, amount, '调解还价成功回款');
        }
        if ((c.mediationOffer.rounds || 0) >= 2) {
            LegalState.updateCaseStatus(caseId, LITIGATION_STATUS.scheduled, { note: '多次还价未果，转入开庭' });
            return { success: true, message: '对方拒绝还价，案件转入开庭' };
        }
        // 对方还一个折中价
        const mid = ((c.mediationOffer.ratio || 0.5) + counter) / 2;
        c.mediationOffer.ratio = Math.round(mid * 1000) / 1000;
        c.mediationOffer.amount = Math.round((parseFloat(c.claimAmount) || 0) * mid * 100) / 100;
        return {
            success: true,
            message: `对方还价至 ${_formatPct(mid)}（¥${c.mediationOffer.amount.toFixed(0)}），可继续决策`,
            offer: c.mediationOffer
        };

        function _formatPct(r) { return Math.round(r * 100) + '%'; }
    },

    /** 玩家回应和解：accept / reject */
    respondSettlement(caseId, action, gameStateRef) {
        const gs = gameStateRef || this._gameState;
        const c = LegalState.getCase(caseId);
        if (!c || c.status !== LITIGATION_STATUS.settlement_pending) {
            return { success: false, message: '案件不在和解确认中' };
        }
        if (action === 'reject') {
            LegalState.updateCaseStatus(caseId, LITIGATION_STATUS.scheduled, { note: '拒绝和解，转入开庭' });
            return { success: true, message: '已拒绝和解，案件转入开庭排期' };
        }
        const offer = c.settlementOffer || { ratio: 0.5, amount: (c.claimAmount || 0) * 0.5 };
        c.outcomeTier = 'half';
        c.recoveryRatio = offer.ratio;
        c._settledVia = 'settlement';
        return this._payoutWin(c, gs, offer.amount, '和解回款');
    },

    _awardLawyerCaseExp(gs, lawyerId, multiplier) {
        try {
            if (!lawyerId || !gs || typeof gs.addEmployeeExp !== 'function') return;
            const per = (typeof EMPLOYEE_LEVEL_CONFIG !== 'undefined' && EMPLOYEE_LEVEL_CONFIG.expPerTask)
                ? (EMPLOYEE_LEVEL_CONFIG.expPerTask.litigation || 3) : 3;
            const mul = Math.max(1, Number(multiplier) || 1);
            gs.addEmployeeExp(lawyerId, 'litigation', per * mul);
        } catch (_) {}
    },

    _payoutWin(c, gs, amount, reasonLabel) {
        if (!c || c._settled) return { success: false, message: '案件已结算' };
        c._settled = true;
        if (gs.state.shop && typeof gs.state.shop.reputation === 'number') {
            gs.state.shop.reputation += LEGAL_PROCESS_CONFIG.reputationDeltaWin;
        }
        c.compensationReceived = Math.round((amount || 0) * 100) / 100;
        if (c.compensationReceived > 0 && typeof gs.addFunds === 'function') {
            gs.addFunds(c.compensationReceived, `${reasonLabel}-案${c.id.slice(-6)}`);
        }
        // 律师提成：上诉赔偿额的 5%（随工资发放）
        let lawyerCommission = 0;
        try {
            let rate = (LEGAL_PROCESS_CONFIG && LEGAL_PROCESS_CONFIG.lawyerAppealCommissionRate != null)
                ? LEGAL_PROCESS_CONFIG.lawyerAppealCommissionRate : 0.05;
            try {
                if (gs.getLawyerCommissionRate) rate = gs.getLawyerCommissionRate();
            } catch (_) {}
            lawyerCommission = Math.round(c.compensationReceived * rate * 100) / 100;
            const cap = (typeof ROLE_COMMISSION !== 'undefined' && ROLE_COMMISSION.lawyerMonthCap) || 5000;
            if (lawyerCommission > 0 && c.assignedLawyerId && gs.state && Array.isArray(gs.state.employees)) {
                const lawyer = gs.state.employees.find(e => e && e.id === c.assignedLawyerId);
                if (lawyer) {
                    const used = Number(lawyer.monthLegalCommission || 0);
                    lawyerCommission = Math.round(Math.min(lawyerCommission, Math.max(0, cap - used)) * 100) / 100;
                    lawyer.pendingLegalCommission = Math.round(((lawyer.pendingLegalCommission || 0) + lawyerCommission) * 100) / 100;
                    lawyer.monthLegalCommission = Math.round((used + lawyerCommission) * 100) / 100;
                    c.lawyerCommission = lawyerCommission;
                }
            }
            if (gs.state && gs.state.shop) {
                gs.state.shop.legalCompensationMonth = Math.round(((gs.state.shop.legalCompensationMonth || 0) + c.compensationReceived) * 100) / 100;
                gs.state.shop.legalCompensationTotal = Math.round(((gs.state.shop.legalCompensationTotal || 0) + c.compensationReceived) * 100) / 100;
            }
        } catch (_) {}
        // 胜诉/和解：律师结案经验（×2）
        this._awardLawyerCaseExp(gs, c.assignedLawyerId, 2);
        LegalState.updateCaseStatus(c.id, LITIGATION_STATUS.compensation, {
            compensationReceived: c.compensationReceived,
            outcomeTier: c.outcomeTier,
            recoveryRatio: c.recoveryRatio,
            reputation: LEGAL_PROCESS_CONFIG.reputationDeltaWin,
            lawyerCommission
        });
        setTimeout(() => LegalState.closeCase(c.id), 0);
        const commissionNote = lawyerCommission > 0 ? `（律师提成 ¥${lawyerCommission.toFixed(2)}）` : '';
        return {
            success: true,
            message: `${reasonLabel} ¥${c.compensationReceived.toFixed(2)}${commissionNote}`,
            amount: c.compensationReceived,
            lawyerCommission
        };
    },

    _executeJudgment(caseId, gs) {
        const c = LegalState.getCase(caseId);
        if (!c) return;
        const reasonInfo = APPEAL_REASONS.find(r => r.id === c.reasonId);
        let winRate = reasonInfo ? reasonInfo.baseWinRate : LEGAL_PROCESS_CONFIG.baseMerchantWinRate;
        const q = c.assignedLawyerId ? this._getLawyerQuality(gs, c.assignedLawyerId) : { winBonus: 0, recoveryBonus: 0 };
        winRate += q.winBonus || 0;
        if (c.statement && c.statement.length >= 20) winRate += 0.05;
        if (c.evidence && c.evidence.length >= 2) winRate += 0.05;
        if (c.claims && c.claims.length >= 2) winRate += 0.03;
        if (c.claimAmount > 0) winRate += 0.02;
        if (c.reasonId === 'goods_not_returned') winRate += 0.06;
        if (c.reasonId === 'courier_loss_unpaid') {
            try {
                const o = (gs.state.orders || []).find(x => x && x.id === c.orderId);
                if (o && o._courierIndemnityRefused) winRate += 0.05;
            } catch (_) {}
        }
        if (c.assignedLawyerId) winRate += 0.03;
        winRate = Math.max(0.05, Math.min(0.95, winRate));

        const statuteLine = c.statuteCite
            ? c.statuteCite.split('\n')[0]
            : ((reasonInfo && reasonInfo.statuteIds && reasonInfo.statuteIds[0] && typeof LEGAL_STATUTES !== 'undefined' && LEGAL_STATUTES[reasonInfo.statuteIds[0]])
                ? LEGAL_STATUTES[reasonInfo.statuteIds[0]].cite : '');

        const roll = Math.random();
        let tier = 'lose';
        if (roll < winRate * 0.35) tier = 'full';
        else if (roll < winRate * 0.65) tier = 'majority';
        else if (roll < winRate * 0.85) tier = 'half';
        else if (roll < winRate) tier = 'token';
        else tier = 'lose';

        c.outcomeTier = tier;
        c.recoveryRatio = this._rollRecoveryRatio(tier, q);
        c.winRate = winRate;

        const loseWhy = c.reasonId === 'courier_loss_unpaid'
            ? '承运人举证属不可抗力或托运人过错，依据民法典第832条但书，本次不支持全额赔偿'
            : (c.reasonId === 'goods_not_returned'
                ? '现有证据尚不能证明买家无法律根据取得利益（如七日内未签收或质量三包争议未排除）'
                : '证据不足或法律依据不充分');
        const winWhy = (statuteLine ? (statuteLine + '。') : '') +
            (reasonInfo?.name || '诉讼请求') + ' · ' + (LEGAL_OUTCOME_TIERS[tier]?.name || tier);

        if (tier === 'lose') {
            LegalState.updateCaseStatus(c.id, LITIGATION_STATUS.buyer_win, {
                winRate, outcomeTier: tier, judgmentReason: loseWhy
            });
        } else if (tier === 'full' || tier === 'majority') {
            LegalState.updateCaseStatus(c.id, LITIGATION_STATUS.merchant_win, {
                winRate, outcomeTier: tier, recoveryRatio: c.recoveryRatio,
                judgmentReason: winWhy
            });
        } else {
            LegalState.updateCaseStatus(c.id, LITIGATION_STATUS.partial_win, {
                winRate, outcomeTier: tier, recoveryRatio: c.recoveryRatio,
                judgmentReason: '法院部分支持诉请。' + winWhy
            });
        }
    },

    _tryRestockFromJudgment(c, gs) {
        if (!c || !c.csReturnId || !gs) return;
        const ret = gs.state.customerService && gs.state.customerService.returns
            && gs.state.customerService.returns.find(r => r.id === c.csReturnId);
        if (!ret || ret._restockedToWarehouse) return;
        ret.goodsReturned = true;
        ret.goodsKeptByBuyer = false;
        try {
            const qty = ret.quantity || 1;
            const productId = ret.productId;
            const costPrice = ret.unitCost || ret.costPrice || 0;
            const qualityGrade = ret.qualityGrade || 'B';
            const wh = gs.warehouse || (typeof warehouseState !== 'undefined' ? warehouseState : null);
            if (productId && wh && typeof wh.createInboundOrder === 'function') {
                wh.createInboundOrder('return', [{
                    productId, quantity: qty, costPrice, qualityGrade, purchaseOrderId: 'legal_' + c.id
                }], `诉讼返还入库:${c.id}`);
                ret._restockedToWarehouse = true;
            } else if (productId && typeof gs.addInventory === 'function') {
                gs.addInventory({
                    productId, quantity: qty, costPrice, qualityGrade, purchaseOrderId: 'legal_' + c.id
                }, { silent: true, prepaid: true });
                ret._restockedToWarehouse = true;
            }
        } catch (_) {}
    },

    _executeMerchantWin(caseId, gs) {
        const c = LegalState.getCase(caseId);
        if (!c || c._settled) return;
        const q = c.assignedLawyerId ? this._getLawyerQuality(gs, c.assignedLawyerId) : { recoveryBonus: 0 };
        let recovered = 0;
        try {
            if (c.csReturnId && gs.state.customerService && Array.isArray(gs.state.customerService.returns)) {
                const ret = gs.state.customerService.returns.find(r => r.id === c.csReturnId);
                if (ret) {
                    recovered = parseFloat(ret.refundAmount != null ? ret.refundAmount : ret.amount) || 0;
                    ret.alreadyRefunded = true;
                    ret._legalRecovered = true;
                }
            }
        } catch (_) {}

        // 阶梯回款比例：律师能力影响经济索赔回收
        let ratio = (typeof c.recoveryRatio === 'number' && c.recoveryRatio >= 0)
            ? c.recoveryRatio
            : (LEGAL_PROCESS_CONFIG.compensationBaseRatio || 0.55);
        ratio = Math.min(1, ratio + (q.recoveryBonus || 0) * 0.3);

        let claimCompensation = 0;
        if (c.reasonId === 'goods_not_returned') {
            const base = recovered > 0 ? recovered : (parseFloat(c.claimAmount) || 0);
            claimCompensation = base * Math.min(1, Math.max(ratio, 0.75));
            if (c.claims && c.claims.includes('return_goods') && (tierIsFull(c))) {
                try { this._tryRestockFromJudgment(c, gs); } catch (_) {}
            }
        } else if (c.reasonId === 'courier_loss_unpaid') {
            claimCompensation = (parseFloat(c.claimAmount) || 0) * Math.min(1, Math.max(ratio, 0.7));
        } else {
            if (c.claims && c.claims.includes('refund_recovery')) claimCompensation += recovered * Math.max(ratio, 0.8);
            if (c.claims && c.claims.includes('triple_damages')) claimCompensation += recovered * 2 * ratio;
            if (c.claims && c.claims.includes('compensation') && c.claimAmount) {
                claimCompensation += parseFloat(c.claimAmount) * ratio;
            }
            if (claimCompensation <= 0 && recovered > 0) claimCompensation = recovered * ratio;
        }
        c.recoveryRatio = ratio;
        const payLabel = c.reasonId === 'courier_loss_unpaid'
            ? '快递诉讼赔偿'
            : (c.reasonId === 'goods_not_returned' ? '不当得利返还' : (c.status === LITIGATION_STATUS.partial_win ? '部分胜诉回款' : '诉讼胜诉回款'));
        this._payoutWin(c, gs, claimCompensation, payLabel);

        function tierIsFull(x) { return x.outcomeTier === 'full' || x.outcomeTier === 'majority'; }
    },

    _executeBuyerWin(caseId, gs) {
        const c = LegalState.getCase(caseId);
        if (!c || c._settled) return;
        c._settled = true;
        if (gs.state.shop && typeof gs.state.shop.reputation === 'number') {
            gs.state.shop.reputation += LEGAL_PROCESS_CONFIG.reputationDeltaLose;
        }
        let compensation = parseFloat(c.claimAmount) || 0;
        // 已退款未退货 / 快递拒赔：商家本就是权利人，败诉只承担诉讼费，不再重复赔一笔货款
        if (c.reasonId === 'goods_not_returned' || c.reasonId === 'courier_loss_unpaid') {
            compensation = 0;
        }
        const HARD_CAP = 1000000;
        if (!(compensation >= 0) || !Number.isFinite(compensation)) compensation = 0;
        compensation = Math.min(compensation, HARD_CAP);
        if (compensation <= 0 && c.csReturnId && c.reasonId !== 'goods_not_returned') {
            try {
                const ret = gs.state.customerService.returns.find(r => r.id === c.csReturnId);
                if (ret) compensation = Math.min(parseFloat(ret.amount) || 0, HARD_CAP);
            } catch (_) {}
        }
        compensation = Math.round(compensation * 100) / 100;
        const doubleFee = LEGAL_PROCESS_CONFIG.filingFee * 2;
        const totalPay = compensation + doubleFee;
        if (totalPay > 0 && typeof gs.spendFunds === 'function') {
            gs.spendFunds(totalPay, `诉讼败诉赔偿-案${c.id.slice(-6)}`);
        }
        c.compensationPaid = totalPay;
        // 败诉也给律师少量经验（参与办案）
        this._awardLawyerCaseExp(gs, c.assignedLawyerId, 1);
        LegalState.updateCaseStatus(c.id, LITIGATION_STATUS.compensation, {
            compensationPaid: totalPay,
            compensationBreakdown: { claimAmount: compensation, doubleFilingFee: doubleFee },
            reputation: LEGAL_PROCESS_CONFIG.reputationDeltaLose
        });
        setTimeout(() => LegalState.closeCase(c.id), 0);
    },

    closeCase(caseId) {
        return LegalState.closeCase(caseId);
    }
};

if (typeof window !== 'undefined') window.LegalEngine = LegalEngine;
