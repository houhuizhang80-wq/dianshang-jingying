/**
 * 全游戏信息架构：底栏 + 首页经营模块目录。
 * 新增玩法入口只改这里，首页/我的/兜底「更多」共用同一份。
 */
(function (g) {
    'use strict';

    function _n(v) {
        const n = Number(v);
        return isFinite(n) ? n : 0;
    }

    function _pendingCS(state) {
        try {
            return ((state.customerService && state.customerService.consultations) || [])
                .filter(c => c && c.status === 'pending').length;
        } catch (_) { return 0; }
    }

    function _activeLoans(state) {
        try {
            return (state.bank && state.bank.loans || []).filter(l => l && l.status === 'active').length;
        } catch (_) { return 0; }
    }

    function _whPct(state) {
        try {
            let used = 0, cap = 1;
            if (typeof gameState !== 'undefined' && gameState) {
                if (typeof gameState.getUsedCapacity === 'function') used = gameState.getUsedCapacity();
                if (typeof gameState.getWarehouseCapacity === 'function') cap = gameState.getWarehouseCapacity();
            }
            const wh = (typeof window !== 'undefined' && window.warehouseState) || null;
            if (wh) {
                if (typeof wh.getUsedCapacity === 'function') used = wh.getUsedCapacity();
                if (typeof wh.getCapacity === 'function') cap = wh.getCapacity();
            }
            return Math.min(100, Math.round((_n(used) / Math.max(1, _n(cap))) * 100));
        } catch (_) {
            return 0;
        }
    }

    function _smartBuyCount() {
        try {
            const st = window.procurementState && window.procurementState.state;
            const snap = st && st.smartSnapshot;
            return (snap && Array.isArray(snap.items)) ? snap.items.length : 0;
        } catch (_) { return 0; }
    }

    function _shopCount() {
        try {
            const sh = gameState && gameState.shops;
            return sh && typeof sh.getChannelShops === 'function' ? sh.getChannelShops().length : 0;
        } catch (_) { return 0; }
    }

    function _expressCount() {
        try {
            return (typeof ExpressState !== 'undefined' && ExpressState.getActivePartners)
                ? ExpressState.getActivePartners().length : 0;
        } catch (_) { return 0; }
    }

    function buildCatalog(state, opts) {
        state = state || {};
        const surface = opts && opts.surface;
        const empCount = (state.employees || []).filter(e => e && e.status !== 'resigned').length;
        const isLive = !!(state.livestream && state.livestream.isLive);
        const cs = _pendingCS(state);
        const loans = _activeLoans(state);
        const whPct = _whPct(state);
        const smartN = _smartBuyCount();
        const shops = _shopCount();
        const expressN = _expressCount();
        const overseasOn = !!(state.shop && state.shop.overseasUnlocked) || !!(state.overseas && state.overseas.unlocked);
        const ownBrandOn = !!(state.shop && state.shop.hasOwnBrand);
        const ownBrandName = (state.shop && state.shop.ownBrandName) || '';
        const shopLv = (state.shop && state.shop.level) || 1;
        const signedIn = (typeof RewardedAdManager !== 'undefined' && RewardedAdManager.hasClaimedToday)
            ? RewardedAdManager.hasClaimedToday() : false;
        const trafficDone = (typeof RewardedAdManager !== 'undefined' && RewardedAdManager.hasClaimedTrafficToday)
            ? RewardedAdManager.hasClaimedTrafficToday() : false;
        const attrPts = _n(state.player && state.player.attributePoints);

        const groups = [
            {
                id: 'daily',
                title: '常用入口',
                items: [
                    {
                        id: 'signin', icon: '📅', name: '签到广告', surface: 'home',
                        color: 'linear-gradient(135deg,#ff8a65,#ff6b35)',
                        badge: signedIn ? '✓' : '领',
                        action: 'ui.doAdSignIn()',
                        desc: signedIn ? '今日已领' : '看广告领 ¥1,000,000'
                    },
                    {
                        id: 'traffic', icon: '🚀', name: '流量包', surface: 'home',
                        color: 'linear-gradient(135deg,#42a5f5,#1565c0)',
                        badge: trafficDone ? '✓' : '',
                        action: 'ui.claimTrafficBoost()',
                        desc: trafficDone ? '今日已领' : '看广告加曝光'
                    },
                    {
                        id: 'marketing', icon: '📣', name: '推广投放', surface: 'home',
                        color: 'linear-gradient(135deg,#ec407a,#c2185b)',
                        badge: '',
                        action: "ui.navigateTo('marketing')",
                        desc: '投放后才放量接单'
                    },
                    {
                        id: 'finance', icon: '💰', name: '财务中心', surface: 'home',
                        color: 'linear-gradient(135deg,#26a69a,#00695c)',
                        badge: '',
                        action: "ui.navigateTo('finance')",
                        desc: '流水·收支'
                    },
                    {
                        id: 'employees', icon: '👥', name: '员工管理', surface: 'home',
                        color: 'linear-gradient(135deg,#667eea,#764ba2)',
                        badge: empCount > 0 ? empCount : '',
                        action: 'ui.showEmployeeManagerModal()',
                        desc: empCount ? (empCount + '人在职') : '招聘履约'
                    },
                    {
                        id: 'attrs', icon: '📊', name: '角色属性', surface: 'profile',
                        color: 'linear-gradient(135deg,#5c6bc0,#3949ab)',
                        badge: attrPts > 0 ? attrPts : '',
                        action: 'ui.showAttributeModal()',
                        desc: attrPts ? ('可加点 ' + attrPts) : '运营/选品'
                    },
                    {
                        id: 'commission', icon: '💰', name: '员工提成', surface: 'profile',
                        color: 'linear-gradient(135deg,#ffb74d,#ef6c00)',
                        badge: '',
                        action: 'ui.showCommissionCenter()',
                        desc: '履约/客服/改价/律师'
                    },
                    {
                        id: 'housing', icon: '🏠', name: '员工宿舍', surface: 'profile',
                        color: 'linear-gradient(135deg,#8d6e63,#6d4c41)',
                        badge: '',
                        action: 'ui.showHousingCenter()',
                        desc: '买楼自动入住'
                    },
                    {
                        id: 'bank', icon: '🏦', name: '银行系统', surface: 'profile',
                        color: 'linear-gradient(135deg,#30cfd0,#330867)',
                        badge: loans > 0 ? loans : '',
                        action: 'ui.showBankModal()',
                        desc: '存贷理财'
                    },
                    {
                        id: 'tax', icon: '🧾', name: '纳税', surface: 'profile',
                        color: 'linear-gradient(135deg,#66bb6a,#2e7d32)',
                        badge: '',
                        action: 'ui.showTaxCenter()',
                        desc: '报税合规'
                    },
                    {
                        id: 'legal', icon: '⚖️', name: '法务', surface: 'profile',
                        color: 'linear-gradient(135deg,#7e57c2,#4527a0)',
                        badge: '',
                        action: 'ui.showLegalCenter()',
                        desc: '律师自动起诉'
                    }
                ]
            },
            {
                id: 'chain',
                title: '供应链',
                items: [
                    {
                        id: 'smartbuy', icon: '🛒', name: '采购进货', surface: 'home',
                        color: 'linear-gradient(135deg,#ffd54f,#ff8a65)',
                        badge: smartN > 0 ? smartN : '',
                        action: "ui.showProcurementCenter('supply')",
                        desc: '进货·补货'
                    },
                    {
                        id: 'warehouse', icon: '🏭', name: '仓储管理', surface: 'home',
                        color: 'linear-gradient(135deg,#f093fb,#f5576c)',
                        badge: whPct >= 90 ? '!' : '',
                        action: 'ui.showWarehouseModal()',
                        desc: '入库·扩容'
                    },
                    {
                        id: 'packaging', icon: '📦', name: '包装材料', surface: 'home',
                        color: 'linear-gradient(135deg,#8d6e63,#5d4037)',
                        badge: '',
                        action: 'ui.showPackagingMaterialModal()',
                        desc: '发货耗材'
                    },
                    {
                        id: 'express', icon: '🚚', name: '快递合作', surface: 'home',
                        color: 'linear-gradient(135deg,#43e97b,#38f9d7)',
                        badge: expressN > 0 ? expressN : '',
                        action: 'ui.openExpressCenter()',
                        desc: expressN ? (expressN + '家合作') : '开通快递'
                    },
                    {
                        id: 'buyer', icon: '🛍️', name: '采购员', surface: 'profile',
                        color: 'linear-gradient(135deg,#fb8c00,#ef6c00)',
                        badge: '',
                        action: "ui.showWarehouseModal('buyer')",
                        desc: '代采跟单'
                    },
                    {
                        id: 'citymap', icon: '🗺️', name: '城市地图', surface: 'profile',
                        color: 'linear-gradient(135deg,#42a5f5,#1565c0)',
                        badge: '',
                        action: 'ui.showCityMapModal()',
                        desc: '选址搬仓·原产地'
                    }
                ]
            },
            {
                id: 'growth',
                title: '销售增长',
                items: [
                    {
                        id: 'livestream', icon: '🎥', name: '直播中心', surface: 'home',
                        color: 'linear-gradient(135deg,#a18cd1,#fbc2eb)',
                        badge: isLive ? 'LIVE' : '',
                        action: 'ui.showLivestreamModal()',
                        desc: isLive ? '直播中' : '开播带货'
                    },
                    {
                        id: 'members', icon: '👑', name: '会员中心', surface: 'profile',
                        color: 'linear-gradient(135deg,#f9a825,#f57f17)',
                        badge: '',
                        action: 'ui.showMemberCenterModal()',
                        desc: '顾客积分·充值兑换'
                    },
                    {
                        id: 'coupons', icon: '🎫', name: '优惠券', surface: 'profile',
                        color: 'linear-gradient(135deg,#ec407a,#c2185b)',
                        badge: '',
                        action: 'ui.showCouponModal()',
                        desc: '发券促销'
                    },
                    {
                        id: 'shops', icon: '🏪', name: '线下门店', surface: 'profile',
                        color: 'linear-gradient(135deg,#11998e,#38ef7d)',
                        badge: shops > 0 ? shops : '',
                        action: 'ui.showOfflineShops()',
                        desc: shops ? (shops + '家门店') : '零售/外卖'
                    },
                    {
                        id: 'overseas', icon: '🌍', name: '海外贸易', surface: 'profile',
                        color: 'linear-gradient(135deg,#26c6da,#00695c)',
                        badge: overseasOn ? '' : '锁',
                        action: 'ui.showOverseasCenter()',
                        desc: overseasOn ? '接单备货发运收款' : 'Lv.7解锁'
                    },
                    {
                        id: 'ownbrand', icon: '🏷️', name: '自有品牌', surface: 'profile',
                        color: 'linear-gradient(135deg,#f7971e,#ffd200)',
                        badge: ownBrandOn ? '' : (shopLv >= 6 ? '新' : '锁'),
                        action: 'ui.showOwnBrandModal()',
                        desc: ownBrandName ? ('品牌「' + ownBrandName + '」') : (shopLv >= 6 ? '创立品牌·转化+8%' : 'Lv.6解锁')
                    },
                    {
                        id: 'factory', icon: '🏭', name: '自有工厂', surface: 'profile',
                        color: 'linear-gradient(135deg,#66bb6a,#2e7d32)',
                        badge: (state.shop && state.shop.hasOwnFactory) ? '' : (ownBrandOn ? '新' : '锁'),
                        action: 'ui.showFactoryCenter()',
                        desc: (state.shop && state.shop.hasOwnFactory) ? '产线·下单·厂长' : (ownBrandOn ? '购置工厂生产' : '先创立品牌')
                    }
                ]
            },
            {
                id: 'service',
                title: '客户与口碑',
                items: [
                    {
                        id: 'after_sales', icon: '📞', name: '客服中心', surface: 'home',
                        color: 'linear-gradient(135deg,#0288d1,#0277bd)',
                        badge: cs > 0 ? cs : '',
                        action: 'ui.showAfterSalesCenter()',
                        desc: cs ? (cs + '条待回复') : '咨询·售后'
                    },
                    {
                        id: 'rating', icon: '⭐', name: '店铺评分', surface: 'profile',
                        color: 'linear-gradient(135deg,#29b6f6,#0277bd)',
                        badge: '',
                        action: 'ui.showRatingDetail()',
                        desc: '评价详情'
                    }
                ]
            },
            {
                id: 'community',
                title: '数据与社区',
                items: [
                    {
                        id: 'leaderboard', icon: '🏅', name: '全服排行榜', surface: 'both',
                        color: 'linear-gradient(135deg,#ff7043,#d32f2f)',
                        badge: '',
                        action: 'ui.showLeaderboardModal()',
                        desc: '净资产·流水·信誉'
                    },
                    {
                        id: 'achievements', icon: '🏆', name: '成就', surface: 'profile',
                        color: 'linear-gradient(135deg,#ffca28,#f57c00)',
                        badge: '',
                        action: 'ui.showAchievementsModal()',
                        desc: '目标奖励'
                    },
                    {
                        id: 'eventlog', icon: '📋', name: '事件记录', surface: 'profile',
                        color: 'linear-gradient(135deg,#78909c,#455a64)',
                        badge: '',
                        action: 'ui.showEventLogModal()',
                        desc: '经营日志'
                    }
                ]
            }
        ];

        const titles = {
            home: { daily: '日常经营', chain: '供应链', growth: '销售增长', service: '客户服务', community: '数据与社区' },
            profile: { daily: '店务与合规', chain: '仓储扩展', growth: '渠道玩法', service: '口碑', community: '数据与记录' }
        };
        const lbOnline = (typeof LeaderboardClient !== 'undefined' && LeaderboardClient.isOnline)
            ? LeaderboardClient.isOnline() : false;
        const filtered = groups.map(g => {
            const items = (g.items || []).map(normalizeItem).filter(it => {
                if (!it || !it.action) return false;
                if (it.id === 'leaderboard' && !lbOnline) return false;
                const s = it.surface || 'home';
                if (!surface) return true;
                return s === surface || s === 'both';
            });
            const titleMap = titles[surface] || {};
            return { id: g.id, title: titleMap[g.id] || g.title, items: items };
        }).filter(g => g.items.length);
        return filtered;
    }

    const ITEM_KEYS = ['id', 'icon', 'name', 'color', 'action', 'desc', 'surface'];

    function normalizeItem(it) {
        if (!it || !it.id) return null;
        return {
            id: String(it.id),
            icon: it.icon || '▫️',
            name: it.name || it.id,
            color: it.color || 'linear-gradient(135deg,#90a4ae,#546e7a)',
            badge: (it.badge === 0 || it.badge) ? it.badge : '',
            action: it.action || '',
            desc: it.desc || '',
            surface: it.surface || 'home'
        };
    }

    function actionMethodName(action) {
        const m = String(action || '').match(/^ui\.([A-Za-z0-9_]+)\s*\(/);
        return m ? m[1] : '';
    }

    function validateCatalog(uiHost) {
        const items = flattenItems({});
        const missing = [];
        items.forEach(it => {
            ITEM_KEYS.forEach(k => {
                if (it[k] == null || it[k] === '') {
                    if (k === 'desc' || k === 'badge') return;
                    missing.push({ id: it.id, field: k });
                }
            });
            const fn = actionMethodName(it.action);
            if (!fn) missing.push({ id: it.id, field: 'action' });
            else if (uiHost && typeof uiHost[fn] !== 'function') {
                missing.push({ id: it.id, field: 'ui.' + fn });
            }
        });
        return { ok: missing.length === 0, missing, count: items.length };
    }

    function flattenItems(state) {
        const groups = buildCatalog(state);
        const out = [];
        groups.forEach(g => {
            (g.items || []).forEach(it => out.push(it));
        });
        return out;
    }

    function findItem(state, id) {
        return flattenItems(state).find(it => it.id === id) || null;
    }

    g.AppNav = {
        BOTTOM: [
            { id: 'dashboard', icon: '🏠', label: '首页' },
            { id: 'supply', icon: '📦', label: '货源' },
            { id: 'products', icon: '🛍️', label: '商品' },
            { id: 'orders', icon: '📋', label: '订单' },
            { id: 'analytics', icon: '📊', label: '数据' },
            { id: 'profile', icon: '👤', label: '我的' }
        ],
        PROFILE_QUICK_IDS: ['commission', 'housing', 'attrs', 'bank', 'tax', 'legal', 'leaderboard', 'achievements'],
        buildCatalog: buildCatalog,
        flattenItems: flattenItems,
        findItem: findItem,
        validateCatalog: validateCatalog,
        ITEM_KEYS: ITEM_KEYS
    };
})(window);
