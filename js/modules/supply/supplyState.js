/**
 * supplyState.js — 供应商谈判与供应链·状态层
 * 管理 gameState.state.supply(随主存档序列化):
 *   relations: { [supplierId]: { points, tier, lastBuyDay, direct, exclusive,
 *                                credit: { days, liability, dueDay, overdueDays } | null } }
 * 默认全部关闭:乘数=1、无账期 → 既有存档/测试零影响。
 */
'use strict';

class SupplyState {
    constructor(gameState) {
        this.gs = gameState;
        this.initialized = false;
    }

    init(gameState) {
        this.gs = gameState || this.gs;
        if (this.initialized) return this;
        this._ensureState();
        this.initialized = true;
        return this;
    }

    _ensureState() {
        if (!this.gs.state) return;
        if (!this.gs.state.supply || typeof this.gs.state.supply !== 'object') {
            this.gs.state.supply = (typeof getSupplyDefaults === 'function')
                ? getSupplyDefaults() : { version: 1, relations: {} };
        }
        if (!this.gs.state.supply.relations || typeof this.gs.state.supply.relations !== 'object') {
            this.gs.state.supply.relations = {};
        }
        // 关系记录字段兜底(旧档/异常数据)
        Object.keys(this.gs.state.supply.relations).forEach(sid => {
            const r = this.gs.state.supply.relations[sid];
            if (!r || typeof r !== 'object') { this.gs.state.supply.relations[sid] = { points: 0 }; }
            const rec = this.gs.state.supply.relations[sid];
            if (typeof rec.points !== 'number' || !Number.isFinite(rec.points)) rec.points = 0;
            rec.tier = this._tierForPoints(rec.points);
            if (rec.credit && (typeof rec.credit.liability !== 'number' || !Number.isFinite(rec.credit.liability))) {
                rec.credit.liability = 0;
            }
        });
    }

    _cfg() { return (typeof SUPPLY_CONFIG !== 'undefined') ? SUPPLY_CONFIG : null; }

    _tierForPoints(points) {
        const tiers = (typeof SUPPLY_TIERS !== 'undefined') ? SUPPLY_TIERS : null;
        if (!tiers || !tiers.length) return 'regular';
        let tier = tiers[0].id;
        for (let i = 0; i < tiers.length; i++) {
            if (points >= tiers[i].points) tier = tiers[i].id;
        }
        return tier;
    }

    _tierIndex(tierId) {
        const tiers = (typeof SUPPLY_TIERS !== 'undefined') ? SUPPLY_TIERS : [];
        const idx = tiers.findIndex(t => t && t.id === tierId);
        return idx < 0 ? 0 : idx;
    }

    _tierInfo(tierId) {
        const tiers = (typeof SUPPLY_TIERS !== 'undefined') ? SUPPLY_TIERS : [];
        return tiers.find(t => t && t.id === tierId) || tiers[0] || { id: 'regular', name: '普通合作', points: 0, benefits: [] };
    }

    _hasBenefit(rec, benefit) {
        const info = this._tierInfo(rec && rec.tier);
        return Array.isArray(info.benefits) && info.benefits.indexOf(benefit) >= 0;
    }

    /** 获取(并惰性创建)某供应商的关系记录 */
    getRelation(supplierId) {
        this._ensureState();
        const rel = this.gs.state.supply.relations;
        if (!rel[supplierId]) {
            rel[supplierId] = { points: 0, tier: 'regular', lastBuyDay: 0, direct: false, exclusive: false, credit: null };
        }
        const rec = rel[supplierId];
        if (rec.tier !== this._tierForPoints(rec.points)) rec.tier = this._tierForPoints(rec.points);
        return rec;
    }

    getAllRelations() {
        this._ensureState();
        const out = [];
        const suppliers = (typeof SUPPLIERS !== 'undefined' && Array.isArray(SUPPLIERS)) ? SUPPLIERS : [];
        suppliers.forEach(s => {
            if (!s || !s.id) return;
            out.push({ supplier: s, relation: this.getRelation(s.id) });
        });
        return out;
    }

    /** 采购单落单后累计关系值(由 gameState.addPurchaseOrder 钩子调用) */
    onPurchaseOrder(order) {
        try {
            if (!order || !order.supplierId) return;
            this._ensureState();
            const cfg = this._cfg();
            const rec = this.getRelation(order.supplierId);
            const amount = Number(order.totalAmount);
            if (Number.isFinite(amount) && amount > 0 && cfg) {
                rec.points = Math.round(((rec.points || 0) + amount * cfg.pointsPerYuan) * 100) / 100;
            }
            rec.lastBuyDay = (this.gs.state.gameTime && this.gs.state.gameTime.day) || rec.lastBuyDay || 0;
            rec.tier = this._tierForPoints(rec.points);
            try { this.gs.notify(); } catch (_) {}
        } catch (e) {
            try { console.warn('[SupplyState] onPurchaseOrder:', e); } catch (_) {}
        }
    }

    /** 有效采购价乘数(直采/独家生效才 <1) */
    getEffectiveMultiplier(supplierId) {
        try {
            this._ensureState();
            const cfg = this._cfg();
            const rec = this.getRelation(supplierId);
            if (rec.exclusive && this._hasBenefit(rec, 'exclusive') && cfg) return cfg.exclusiveMultiplier;
            if (rec.direct && this._hasBenefit(rec, 'direct') && cfg) return cfg.directMultiplier;
        } catch (_) {}
        return 1;
    }

    /** 该供应商当前是否走账期(先货后款) */
    shouldUseCredit(supplierId) {
        try {
            this._ensureState();
            const rec = this.getRelation(supplierId);
            return !!(rec.credit && rec.credit.days > 0 && this._hasBenefit(rec, 'credit'));
        } catch (_) {}
        return false;
    }

    /** 谈判账期:熟客以上可选 7/15/30 天 */
    negotiateCredit(supplierId, days) {
        this._ensureState();
        const rec = this.getRelation(supplierId);
        if (!this._hasBenefit(rec, 'credit')) {
            return { success: false, message: `关系等级不足:需达到「熟客」(${(typeof SUPPLY_TIERS !== 'undefined' ? SUPPLY_TIERS[1].points : 500)} 关系值)才可谈账期` };
        }
        const cfg = this._cfg();
        const options = (cfg && cfg.creditOptions) || [7, 15, 30];
        const d = parseInt(days, 10);
        if (options.indexOf(d) < 0) {
            return { success: false, message: '账期仅支持 ' + options.join('/') + ' 天' };
        }
        if (!rec.credit) rec.credit = { days: 0, liability: 0, dueDay: 0, overdueDays: 0 };
        rec.credit.days = d;
        try { this.gs.notify(); } catch (_) {}
        return { success: true, message: `账期谈判成功:该供应商进货可 ${d} 天后付款` };
    }

    /** 赊购:不扣现金,记入应付账款,到期日 = 当前日 + 账期 */
    purchaseOnCredit(supplierId, totalCost) {
        this._ensureState();
        if (!this.shouldUseCredit(supplierId)) {
            return { success: false, message: '该供应商未开通账期' };
        }
        const amount = Number(totalCost);
        if (!Number.isFinite(amount) || amount <= 0) return { success: false, message: '无效金额' };
        const rec = this.getRelation(supplierId);
        const day = (this.gs.state.gameTime && this.gs.state.gameTime.day) || 1;
        rec.credit.liability = Math.round(((rec.credit.liability || 0) + amount) * 100) / 100;
        rec.credit.dueDay = day + rec.credit.days;
        rec.credit.overdueDays = 0;
        try { this.gs.notify(); } catch (_) {}
        return { success: true, message: `已赊购 ¥${amount.toLocaleString()}(${rec.credit.days} 天后付款)`, liability: rec.credit.liability, dueDay: rec.credit.dueDay };
    }

    /** 主动还款(结清应付) */
    repayCredit(supplierId) {
        this._ensureState();
        const rec = this.getRelation(supplierId);
        if (!rec.credit || !(rec.credit.liability > 0)) {
            return { success: false, message: '当前无应付款' };
        }
        const amount = rec.credit.liability;
        if (typeof this.gs.spendFunds === 'function') {
            if (!this.gs.spendFunds(amount, `供应商账款结清(${supplierId})`)) {
                return { success: false, message: '资金不足,无法结清账款' };
            }
        }
        rec.credit.liability = 0;
        rec.credit.dueDay = 0;
        rec.credit.overdueDays = 0;
        try { this.gs.notify(); } catch (_) {}
        return { success: true, message: `已结清应付 ¥${amount.toLocaleString()}` };
    }

    /**
     * 每日结算(挂在 game:dailyTick):
     * 到期自动扣款;资金不足 → 逾期,每日罚息 2% 入欠款 + 信誉 -1;宽限期内不罚。
     */
    settleDaily(payload) {
        this._ensureState();
        const day = (payload && payload.day) || (this.gs.state.gameTime && this.gs.state.gameTime.day) || 1;
        const cfg = this._cfg();
        const rel = this.gs.state.supply.relations;
        const result = { paid: 0, overdue: 0 };
        Object.keys(rel).forEach(sid => {
            const rec = rel[sid];
            if (!rec || !rec.credit || !(rec.credit.liability > 0)) return;
            const dueDay = rec.credit.dueDay || 0;
            if (day < dueDay) return;
            const grace = (cfg && cfg.creditGraceDays) || 3;
            const overdueDays = Math.max(0, day - dueDay);
            if (overdueDays > grace) {
                // 罚息按逾期天数累计(每天 2%,入欠款)
                const penalty = rec.credit.liability * ((cfg && cfg.creditPenaltyRate) || 0.02);
                rec.credit.liability = Math.round((rec.credit.liability + penalty) * 100) / 100;
                rec.credit.overdueDays = overdueDays;
                result.overdue++;
                // 信誉惩罚
                try {
                    if (this.gs.state.shop && typeof this.gs.state.shop.reputation === 'number') {
                        this.gs.state.shop.reputation = Math.max(0, this.gs.state.shop.reputation - ((cfg && cfg.creditReputationHit) || 1));
                    }
                } catch (_) {}
                try {
                    if (typeof eventBus !== 'undefined' && eventBus.emit) {
                        eventBus.emit('toast:show', { message: `⚠️ 供应商账款逾期 ${overdueDays} 天(欠 ¥${Math.round(rec.credit.liability).toLocaleString()}),信誉-1`, type: 'error' });
                    }
                } catch (_) {}
                return;
            }
            // 到期(含宽限内):资金充足自动结清
            if (typeof this.gs.spendFunds === 'function') {
                const amt = rec.credit.liability;
                if (this.gs.spendFunds(amt, `供应商账款自动结算(${sid})`)) {
                    rec.credit.liability = 0;
                    rec.credit.dueDay = 0;
                    rec.credit.overdueDays = 0;
                    result.paid++;
                } else {
                    // 到期但资金不足:进入逾期状态(次日继续罚息)
                    rec.credit.overdueDays = overdueDays;
                    result.overdue++;
                }
            }
        });
        try { this.gs.notify(); } catch (_) {}
        return result;
    }

    /** 开通源头直采(战略伙伴起,一次性费用) */
    activateDirectSource(supplierId) {
        this._ensureState();
        const rec = this.getRelation(supplierId);
        if (!this._hasBenefit(rec, 'direct')) {
            return { success: false, message: `关系等级不足:需「战略伙伴」(${(typeof SUPPLY_TIERS !== 'undefined' ? SUPPLY_TIERS[2].points : 2000)} 关系值)` };
        }
        if (rec.direct) return { success: false, message: '已开通源头直采' };
        const cfg = this._cfg();
        const fee = (cfg && cfg.directActivationFee) || 0;
        if (fee > 0 && typeof this.gs.spendFunds === 'function') {
            if (!this.gs.spendFunds(fee, `开通源头直采(${supplierId})`)) {
                return { success: false, message: `资金不足,开通需 ¥${fee.toLocaleString()}` };
            }
        }
        rec.direct = true;
        try { this.gs.notify(); } catch (_) {}
        return { success: true, message: `已开通源头直采:该供应商采购价 ×${((cfg && cfg.directMultiplier) || 0.92)}` };
    }

    /** 签独家代理(顶级关系 + 代理费) */
    signExclusive(supplierId) {
        this._ensureState();
        const rec = this.getRelation(supplierId);
        if (!this._hasBenefit(rec, 'exclusive')) {
            return { success: false, message: `关系等级不足:需「独家代理」(${(typeof SUPPLY_TIERS !== 'undefined' ? SUPPLY_TIERS[3].points : 5000)} 关系值)` };
        }
        if (rec.exclusive) return { success: false, message: '已是独家代理' };
        const cfg = this._cfg();
        const fee = (cfg && cfg.exclusiveAgencyFee) || 0;
        if (fee > 0 && typeof this.gs.spendFunds === 'function') {
            if (!this.gs.spendFunds(fee, `独家代理费(${supplierId})`)) {
                return { success: false, message: `资金不足,代理费需 ¥${fee.toLocaleString()}` };
            }
        }
        rec.exclusive = true;
        try { this.gs.notify(); } catch (_) {}
        return { success: true, message: `已签独家代理:该供应商采购价 ×${((cfg && cfg.exclusiveMultiplier) || 0.85)}` };
    }

    /** 汇总(UI + 调试) */
    report() {
        this._ensureState();
        const rows = this.getAllRelations();
        return {
            relationCount: rows.filter(r => (r.relation && r.relation.points) > 0).length,
            totalLiability: rows.reduce((s, r) => s + ((r.relation && r.relation.credit && r.relation.credit.liability) || 0), 0),
            rows
        };
    }
}

// 导出兼容(浏览器全局 + Node 测试)
if (typeof window !== 'undefined') window.SupplyState = SupplyState;
if (typeof module !== 'undefined' && module.exports) module.exports = { SupplyState };
