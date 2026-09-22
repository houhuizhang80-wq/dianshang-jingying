/**
 * 法务维权 — State（存档键 state.legal）
 */
const LegalState = (function () {
    'use strict';

    let _gs = null;

    function _legal() {
        if (!_gs || !_gs.state) return null;
        if (!_gs.state.legal) {
            _gs.state.legal = {
                cases: [],
                statistics: { totalCases: 0, winCount: 0, loseCount: 0, totalCompensation: 0 },
                lawyers: [],
                trademark: { tier: null, registerDay: 0 }
            };
        }
        return _gs.state.legal;
    }

    function _id(prefix) {
        return (prefix || 'legal') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }
    function _now() {
        if (_gs && _gs.state && _gs.state.gameTime) return { ..._gs.state.gameTime };
        return { day: 1, hour: 0 };
    }
    function _rand(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    function _save() {
        if (_gs && typeof _gs.saveDebounced === 'function') _gs.saveDebounced();
    }

    function init(gameState) {
        _gs = gameState;
        const legal = _legal();
        if (!Array.isArray(legal.cases)) legal.cases = [];
        if (!Array.isArray(legal.lawyers)) legal.lawyers = [];
        if (!legal.statistics) legal.statistics = {};
        const s = legal.statistics;
        if (typeof s.totalCases !== 'number') s.totalCases = 0;
        if (typeof s.winCount !== 'number') s.winCount = 0;
        if (typeof s.loseCount !== 'number') s.loseCount = 0;
        if (typeof s.totalCompensation !== 'number') s.totalCompensation = 0;
        // 商标状态兜底
        if (!legal.trademark || typeof legal.trademark !== 'object') {
            legal.trademark = { tier: null, registerDay: 0 };
        }
    }

    function reset(gameState) {
        const gs = gameState || _gs;
        if (!gs || !gs.state) return;
        gs.state.legal = {
            cases: [],
            statistics: { totalCases: 0, winCount: 0, loseCount: 0, totalCompensation: 0 },
            lawyers: []
        };
        _gs = gs;
    }

    function createCase(data) {
        const now = _now();
        const transitions = LEGAL_PROCESS_CONFIG.statusTransitionHours;
        const legalCase = {
            id: _id('case'),
            csReturnId: data.csReturnId || null,
            orderId: data.orderId || null,
            reasonId: data.reasonId,
            reasonInfo: data.reasonInfo || null,
            statement: data.statement || '',
            evidence: Array.isArray(data.evidence) ? data.evidence.slice() : [],
            claims: Array.isArray(data.claims) ? data.claims.slice() : [],
            claimAmount: parseFloat(data.claimAmount) || 0,
            otherClaims: data.otherClaims || '',
            assignedLawyerId: data.assignedLawyerId || null,
            autoFiled: !!data.autoFiled,
            caseKind: data.caseKind || 'general',
            defendant: data.defendant || 'buyer',
            defendantName: data.defendantName || '',
            statuteCite: data.statuteCite || '',
            sourceType: data.sourceType || (data.csReturnId ? 'after_sales' : 'other'),
            strategy: data.strategy || 'litigate',
            outcomeTier: null,
            recoveryRatio: null,
            mediationOffer: null,
            settlementOffer: null,
            status: LITIGATION_STATUS.submitted,
            statusHistory: [{ status: LITIGATION_STATUS.submitted, time: { ...now }, extra: null }],
            nextTransitionHours: _rand(transitions.submitted_to_accepted[0], transitions.submitted_to_accepted[1]),
            hoursInCurrentStatus: 0,
            filingFee: LEGAL_PROCESS_CONFIG.filingFee,
            finalResult: null,
            compensationPaid: 0,
            compensationReceived: 0,
            createTime: { ...now },
            closeTime: null
        };
        _legal().cases.unshift(legalCase);
        _legal().statistics.totalCases++;
        _save();
        return legalCase;
    }

    function getCase(caseId) {
        const legal = _legal();
        if (!legal) return null;
        return legal.cases.find(c => c.id === caseId) || null;
    }

    function getCases(status) {
        const legal = _legal();
        if (!legal || !Array.isArray(legal.cases)) return [];
        if (!status) return legal.cases.slice();
        return legal.cases.filter(c => c.status === status);
    }

    function updateCaseStatus(caseId, status, extraData) {
        const legalCase = getCase(caseId);
        if (!legalCase) return null;
        legalCase.status = status;
        legalCase.hoursInCurrentStatus = 0;
        legalCase.statusHistory.push({ status, time: { ..._now() }, extra: extraData || null });
        const transitions = LEGAL_PROCESS_CONFIG.statusTransitionHours;
        if (status === LITIGATION_STATUS.accepted) {
            legalCase.nextTransitionHours = _rand(transitions.accepted_to_review[0], transitions.accepted_to_review[1]);
        } else if (status === LITIGATION_STATUS.review) {
            const key = (legalCase.strategy === 'mediate' && transitions.review_to_mediation)
                ? 'review_to_mediation' : 'review_to_scheduled';
            const range = transitions[key] || transitions.review_to_scheduled || [3, 12];
            legalCase.nextTransitionHours = _rand(range[0], range[1]);
        } else if (status === LITIGATION_STATUS.scheduled) {
            const range = transitions.scheduled_to_judgment || [72, 168];
            legalCase.nextTransitionHours = _rand(range[0], range[1]);
        } else {
            legalCase.nextTransitionHours = null;
        }
        if (status === LITIGATION_STATUS.merchant_win || status === LITIGATION_STATUS.partial_win) {
            _legal().statistics.winCount++;
        } else if (status === LITIGATION_STATUS.buyer_win) {
            _legal().statistics.loseCount++;
        }
        _save();
        return legalCase;
    }

    function addLawyer(empId, info) {
        const existing = _legal().lawyers.find(l => l.empId === empId);
        if (existing) return existing;
        const lawyer = {
            empId, name: info?.name || '', level: info?.level || 1,
            skills: info?.skills || {}, assignedCases: [], joinTime: _now()
        };
        _legal().lawyers.push(lawyer);
        _save();
        return lawyer;
    }

    function getLawyer(empId) {
        return _legal().lawyers.find(l => l.empId === empId) || null;
    }

    function assignLawyerToCase(caseId, empId) {
        const legalCase = getCase(caseId);
        const lawyer = getLawyer(empId);
        if (!legalCase || !lawyer) return false;
        legalCase.assignedLawyerId = empId;
        if (!lawyer.assignedCases.includes(caseId)) lawyer.assignedCases.push(caseId);
        return true;
    }

    function closeCase(caseId, resultData) {
        const legalCase = getCase(caseId);
        if (!legalCase) return null;
        if (resultData) {
            if (typeof resultData.compensationPaid === 'number') legalCase.compensationPaid = resultData.compensationPaid;
            if (typeof resultData.compensationReceived === 'number') legalCase.compensationReceived = resultData.compensationReceived;
            if (resultData.finalResult) legalCase.finalResult = resultData.finalResult;
        }
        const net = legalCase.compensationReceived - legalCase.compensationPaid;
        _legal().statistics.totalCompensation += net;
        legalCase.status = LITIGATION_STATUS.closed;
        legalCase.closeTime = { ..._now() };
        legalCase.statusHistory.push({
            status: LITIGATION_STATUS.closed,
            time: { ...legalCase.closeTime },
            extra: { compensationPaid: legalCase.compensationPaid, compensationReceived: legalCase.compensationReceived, netCompensation: net }
        });
        _save();
        return legalCase;
    }

    function getStatistics() {
        const legal = _legal();
        if (!legal) return { totalCases: 0, winCount: 0, loseCount: 0, totalCompensation: 0, winRate: '0.0%', pendingCases: 0 };
        const stats = legal.statistics || {};
        const total = Math.max(1, (stats.winCount || 0) + (stats.loseCount || 0));
        return {
            ...stats,
            winRate: (((stats.winCount || 0) / total) * 100).toFixed(1) + '%',
            pendingCases: (legal.cases || []).filter(c => c.status !== LITIGATION_STATUS.closed).length
        };
    }

    // ==================== 商标注册与品牌保护 ====================
    /** 当前商标状态 + 可升级档位 */
    function getIPStatus() {
        const legal = _legal();
        const tm = (legal && legal.trademark) || { tier: null, registerDay: 0 };
        const tiers = (typeof LEGAL_TRADEMARK_TIERS !== 'undefined') ? LEGAL_TRADEMARK_TIERS : [];
        const curIdx = tiers.findIndex(t => t.id === tm.tier);
        const cur = curIdx >= 0 ? tiers[curIdx] : null;
        const next = curIdx < tiers.length - 1 ? tiers[curIdx + 1] : null;
        return { current: cur, next, tier: tm.tier, registerDay: tm.registerDay, tiers };
    }

    /** 商标注册/升级：扣款 + 信誉加成 + 记录 */
    function registerTrademark(tierId) {
        const legal = _legal();
        if (!legal) return { success: false, message: '法务状态不可用' };
        const tiers = (typeof LEGAL_TRADEMARK_TIERS !== 'undefined') ? LEGAL_TRADEMARK_TIERS : [];
        const target = tiers.find(t => t.id === tierId);
        if (!target) return { success: false, message: '无效的商标档位' };
        if (!legal.trademark) legal.trademark = { tier: null, registerDay: 0 };
        const curIdx = tiers.findIndex(t => t.id === legal.trademark.tier);
        const newIdx = tiers.findIndex(t => t.id === tierId);
        if (newIdx <= curIdx) return { success: false, message: '只能注册更高档位的商标' };
        if (target.cost > 0) {
            if (typeof _gs.spendFunds !== 'function') return { success: false, message: '支付功能不可用' };
            if (!_gs.spendFunds(target.cost, `商标注册 - ${target.name}`)) {
                return { success: false, message: `资金不足，注册需 ¥${target.cost.toLocaleString()}` };
            }
        }
        const prev = legal.trademark.tier;
        legal.trademark.tier = tierId;
        legal.trademark.registerDay = (_gs && _gs.state && _gs.state.gameTime && _gs.state.gameTime.day) || 1;
        // 信誉加成（封顶 100）
        try {
            if (_gs && _gs.state && _gs.state.shop && typeof _gs.state.shop.reputation === 'number') {
                _gs.state.shop.reputation = Math.min(100, _gs.state.shop.reputation + (target.reputationBonus || 0));
            }
        } catch (_) {}
        _save();
        return {
            success: true,
            message: `${target.icon} 已注册「${target.name}」${prev ? '（升级）' : ''}，信誉 +${target.reputationBonus}`,
            trademark: legal.trademark
        };
    }

    return {
        init, reset, createCase, updateCaseStatus, getCase, getCases,
        addLawyer, getLawyer, assignLawyerToCase, closeCase, getStatistics,
        getIPStatus, registerTrademark
    };
})();

if (typeof window !== 'undefined') window.LegalState = LegalState;
