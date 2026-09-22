/**
 * 每日任务：每天 3 个小目标，完成给轻量奖励（包材/流量/跳天次数/小额现金，不发大钱）。
 * 进度用「总量计数器 − 当日基线」计算，不侵入引擎钩子；跨天懒刷新（渲染/领取时检查）。
 * 状态挂在 gameState.state.dailyQuests，随主存档持久化。
 */
(function (g) {
    'use strict';

    const QUEST_POOL = [
        { id: 'ship5',   icon: '🚚', name: '发出 5 个订单',      target: 5,   reward: { type: 'pack' },                          rewardText: '包材补给' },
        { id: 'reply3',  icon: '💬', name: '回复 3 条咨询',      target: 3,   reward: { type: 'traffic', hours: 2 },             rewardText: '2小时流量' },
        { id: 'restock', icon: '🛒', name: '完成 1 次进货下单',  target: 1,   reward: { type: 'quota', amount: 1 },              rewardText: '跳一天+1' },
        { id: 'list1',   icon: '🛍️', name: '新上架 1 款商品',   target: 1,   reward: { type: 'money', amount: 800 },            rewardText: '¥800' },
        { id: 'promote', icon: '📣', name: '今日推广投入 ¥300',  target: 300, reward: { type: 'traffic', hours: 2 },             rewardText: '2小时流量' },
        { id: 'packmat', icon: '📦', name: '补充 1 次包材',      target: 1,   reward: { type: 'money', amount: 500 },            rewardText: '¥500' }
    ];

    function _gs() { return (typeof gameState !== 'undefined') ? gameState : null; }
    function _state() { const gs = _gs(); return gs && gs.state ? gs.state : null; }
    function _today() { const s = _state(); return (s && s.gameTime && s.gameTime.day) || 1; }

    // 总量计数器：进度 = 当前总量 − 任务生成时的基线
    const COUNTERS = {
        ship5: s => (s.orders || []).filter(o => o && (o.shipTime || ['shipped', 'completed', 'returned', 'refunded'].indexOf(o.status) >= 0)).length,
        reply3: s => ((s.customerService && s.customerService.consultations) || []).filter(c => c && c.status && c.status !== 'pending').length,
        restock: s => (s.purchaseOrders || []).length,
        list1: s => (s.listings || []).length,
        packmat: s => ((s.warehouse && s.warehouse.packagingLogs) || []).length,
        promote: null // 特殊：直接统计今日推广花费
    };

    function _promoteSpendToday(s) {
        const day = _today();
        let sum = 0;
        ((s.finance && s.finance.records) || []).forEach(r => {
            if (!r || r.type !== 'expense') return;
            const rd = (typeof r.day === 'number') ? r.day : (r.date && r.date.day);
            if (rd !== day) return;
            const reason = String(r.reason || '');
            if (/推广|营销|广告|代言|直通车|展位|投流/.test(reason)) sum += Math.abs(Number(r.amount) || 0);
        });
        return Math.round(sum);
    }

    function _progress(def, q, s) {
        if (def.id === 'promote') return Math.min(def.target, _promoteSpendToday(s));
        const fn = COUNTERS[def.id];
        if (!fn) return 0;
        return Math.max(0, Math.min(def.target, fn(s) - (q.baseline || 0)));
    }

    // 按天确定性轮换 3 个任务，同一天重进游戏任务不变
    function _pickQuests(day) {
        const start = ((day % QUEST_POOL.length) + QUEST_POOL.length) % QUEST_POOL.length;
        const out = [];
        for (let i = 0; i < QUEST_POOL.length && out.length < 3; i++) {
            out.push(QUEST_POOL[(start + i) % QUEST_POOL.length]);
        }
        return out;
    }

    function ensure() {
        const s = _state();
        if (!s) return null;
        const day = _today();
        if (s.dailyQuests && s.dailyQuests.day === day && Array.isArray(s.dailyQuests.quests) && s.dailyQuests.quests.length) {
            return s.dailyQuests;
        }
        const quests = _pickQuests(day).map(def => ({
            id: def.id,
            baseline: (def.id === 'promote' || !COUNTERS[def.id]) ? 0 : COUNTERS[def.id](s),
            claimed: false
        }));
        s.dailyQuests = { day: day, quests: quests };
        return s.dailyQuests;
    }

    function getView() {
        const s = _state();
        const dq = ensure();
        if (!s || !dq) return [];
        return dq.quests.map(q => {
            const def = QUEST_POOL.find(d => d.id === q.id);
            if (!def) return null;
            const progress = _progress(def, q, s);
            return {
                id: def.id, icon: def.icon, name: def.name, target: def.target,
                rewardText: def.rewardText, progress: progress,
                done: progress >= def.target, claimed: !!q.claimed
            };
        }).filter(Boolean);
    }

    function claim(id) {
        const s = _state();
        const dq = ensure();
        const gs = _gs();
        if (!s || !dq || !gs) return { ok: false, message: '状态不可用' };
        const q = dq.quests.find(x => x.id === id);
        const def = QUEST_POOL.find(d => d.id === id);
        if (!q || !def) return { ok: false, message: '任务不存在' };
        if (q.claimed) return { ok: false, message: '已领取过' };
        if (_progress(def, q, s) < def.target) return { ok: false, message: '任务还未完成' };
        q.claimed = true;
        const r = def.reward;
        try {
            if (r.type === 'money') {
                gs.addFunds(r.amount, '每日任务奖励');
            } else if (r.type === 'quota') {
                if (typeof gs.addActionQuota === 'function') gs.addActionQuota(r.amount || 1);
            } else if (r.type === 'traffic') {
                if (typeof gs.grantAdTrafficBoost === 'function') gs.grantAdTrafficBoost(r.hours || 2);
            } else if (r.type === 'pack') {
                gs.setState(st => {
                    const pm = st.warehouse && st.warehouse.packagingMaterials;
                    if (pm) {
                        pm.carton = (pm.carton || 0) + 20;
                        pm.bubbleWrap = (pm.bubbleWrap || 0) + 20;
                        pm.tape = (pm.tape || 0) + 3;
                    }
                });
            }
        } catch (e) {
            q.claimed = false;
            return { ok: false, message: '发奖失败：' + (e && e.message || e) };
        }
        try { gs.notify(); } catch (_) {}
        try { if (gs.saveDebounced) gs.saveDebounced(); } catch (_) {}
        return { ok: true, message: '已领取：' + def.rewardText };
    }

    function renderCard() {
        let view;
        try { view = getView(); } catch (_) { return ''; }
        if (!view || !view.length) return '';
        const rows = view.map(v => {
            const pct = Math.min(100, Math.round(v.progress / Math.max(1, v.target) * 100));
            const right = v.claimed
                ? '<span style="font-size:11px;color:#999;flex-shrink:0;">✓ 已领</span>'
                : (v.done
                    ? `<button class="btn btn-primary btn-small" style="padding:4px 10px;font-size:11px;flex-shrink:0;" onclick="event.stopPropagation();ui.claimDailyQuest('${v.id}')">领取</button>`
                    : `<span style="font-size:11px;color:#1565c0;font-weight:700;flex-shrink:0;">${v.progress}/${v.target}</span>`);
            return `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px dashed #f0f0f0;">
                <span style="font-size:18px;flex-shrink:0;">${v.icon}</span>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:12px;color:#333;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${v.name}</div>
                    <div style="height:4px;background:#f0f0f0;border-radius:2px;margin-top:4px;">
                        <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#42a5f5,#1565c0);border-radius:2px;"></div>
                    </div>
                </div>
                <span style="font-size:10px;color:#999;flex-shrink:0;">🎁${v.rewardText}</span>
                ${right}
            </div>`;
        }).join('');
        return `<div class="card" style="margin-bottom:10px;" data-guide="daily-quests">
            <div class="card-header" style="padding-bottom:2px;">
                <div class="card-title" style="font-size:14px;">🎯 每日任务</div>
                <span style="font-size:10px;color:#999;">跨天自动刷新</span>
            </div>
            <div style="padding:0 12px 6px;">${rows}</div>
        </div>`;
    }

    g.DailyQuests = { ensure: ensure, getView: getView, claim: claim, renderCard: renderCard };
})(window);
