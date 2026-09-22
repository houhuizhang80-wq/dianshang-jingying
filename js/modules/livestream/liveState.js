// ============================================================================
// 直播中心系统 - 状态管理层
// 负责：直播状态初始化、数据访问、状态更新、持久化
// ============================================================================

const liveState = (function() {
    'use strict';

    let _gameState = null;
    let _state = null;

    // 初始化直播状态
    function init(gameStateInstance) {
        _gameState = gameStateInstance;
        
        if (!_gameState.state.livestream) {
            _gameState.state.livestream = JSON.parse(JSON.stringify(INITIAL_LIVESTREAM_STATE));
        } else {
            // 迁移旧数据，补充缺失字段
            const saved = _gameState.state.livestream;
            const initial = JSON.parse(JSON.stringify(INITIAL_LIVESTREAM_STATE));
            
            // 保留已有数据，补充缺失字段（嵌套对象深度补齐，兼容旧档）
            _state = _gameState.state.livestream = {
                ...initial,
                ...saved,
                settings: { ...initial.settings, ...(saved.settings || {}) },
                totalStats: { ...initial.totalStats, ...(saved.totalStats || {}) },
                ui: { ...initial.ui, ...(saved.ui || {}) },
                fans: { ...initial.fans, ...(saved.fans || {}), profile: { ...initial.fans.profile, ...((saved.fans && saved.fans.profile) || {}) } },
                daily: { ...initial.daily, ...(saved.daily || {}) },
                interactions: { ...initial.interactions, ...(saved.interactions || {}) },
                activeFans: { ...initial.activeFans, ...(saved.activeFans || {}) },
                events: Array.isArray(saved.events) ? saved.events : (initial.events || [])
            };
        }
        
        _state = _gameState.state.livestream;
        console.log('[LiveState] 直播状态初始化完成');
    }

    // 获取当前直播状态
    function getState() {
        return _state;
    }

    // 获取当前主播信息
    function getCurrentStreamer() {
        if (!_state.streamer) return null;
        if (typeof _state.streamer === 'string') {
            return LIVE_STREAMER_TYPES.find(s => s.id === _state.streamer) || null;
        }
        return _state.streamer;
    }

    // 获取当前场景信息
    function getCurrentScene() {
        if (!_state.scene) return null;
        if (typeof _state.scene === 'string') {
            return LIVE_SCENES.find(s => s.id === _state.scene) || null;
        }
        return _state.scene;
    }

    // 检查是否正在直播
    function isLive() {
        return _state.isLive && _state.status === LIVE_STATUS.live;
    }

    // 获取直播时长（格式化，P0 语义=现实分钟）
    function getFormattedDuration() {
        const mins = _state.duration || 0;
        const m = Math.floor(mins);
        const s = Math.round((mins - m) * 60);
        return s > 0 ? `${m}分${s}秒` : `${m}分钟`;
    }

    // 获取在线人数等级
    function getViewerLevel() {
        const viewers = _state.viewers;
        if (viewers >= 10000) return { level: 'hot', name: '超级火爆', color: '#ff4444' };
        if (viewers >= 1000) return { level: 'popular', name: '热门直播', color: '#ff8800' };
        if (viewers >= 100) return { level: 'normal', name: '正常直播', color: '#4caf50' };
        return { level: 'new', name: '新人直播', color: '#2196f3' };
    }

    // 获取可解锁的主播
    function getAvailableStreamers() {
        const shopLevel = _gameState.state.shop?.level || 1;
        return LIVE_STREAMER_TYPES.map(s => ({
            ...s,
            unlocked: shopLevel >= s.unlockLevel
        }));
    }

    // 获取直播统计数据
    function getStatistics() {
        return {
            totalStreams: _state.totalStats.totalStreams,
            totalDuration: _state.totalStats.totalDuration,
            totalViewers: _state.totalStats.totalViewers,
            totalSales: _state.totalStats.totalSales,
            totalGifts: _state.totalStats.totalGifts,
            totalOrders: _state.totalStats.totalOrders,
            avgViewers: _state.totalStats.totalStreams > 0 
                ? Math.round(_state.totalStats.totalViewers / _state.totalStats.totalStreams) 
                : 0,
            avgSales: _state.totalStats.totalStreams > 0
                ? Math.round(_state.totalStats.totalSales / _state.totalStats.totalStreams)
                : 0,
            avgDuration: _state.totalStats.totalStreams > 0
                ? (_state.totalStats.totalDuration / _state.totalStats.totalStreams).toFixed(1)
                : 0
        };
    }

    // 获取历史记录
    function getHistory(limit = 20) {
        return [...(_state.history || [])]
            .sort((a, b) => (b.startTime || 0) - (a.startTime || 0))
            .slice(0, limit);
    }

    // 获取回放列表
    function getReplays(limit = 10) {
        return [...(_state.replays || [])]
            .filter(r => r.endTime)
            .sort((a, b) => b.endTime - a.endTime)
            .slice(0, limit);
    }

    // 获取弹幕列表（限制数量）
    function getDanmakus(limit = 100) {
        return [...(_state.danmakus || [])].slice(-limit);
    }

    // 添加弹幕
    function addDanmaku(danmaku) {
        if (!_state.danmakus) _state.danmakus = [];
        
        const newDanmaku = {
            id: 'dm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            timestamp: Date.now(),
            gameTime: _gameState.state.gameTime ? { ..._gameState.state.gameTime } : null,
            type: 'normal',
            ...danmaku
        };
        
        _state.danmakus.push(newDanmaku);
        _state.danmakuCount++;
        
        // 限制弹幕数量，最多保留500条
        if (_state.danmakus.length > 500) {
            _state.danmakus = _state.danmakus.slice(-500);
        }
        
        return newDanmaku;
    }

    // 发送系统消息
    function addSystemMessage(content) {
        return addDanmaku({
            type: 'system',
            userName: '系统',
            content: content,
            color: DANMAKU_TYPES.system.color
        });
    }

    // 检查成就
    function checkAchievements() {
        const unlocked = [];
        const achieved = _state.achievements || [];
        
        LIVE_ACHIEVEMENTS.forEach(achievement => {
            if (achieved.includes(achievement.id)) return;
            
            let unlocked_flag = false;
            
            switch (achievement.id) {
                case 'first_live':
                    unlocked_flag = _state.totalStats.totalStreams >= 1;
                    break;
                case 'hundred_viewers':
                    unlocked_flag = _state.peakViewers >= 100;
                    break;
                case 'thousand_viewers':
                    unlocked_flag = _state.peakViewers >= 1000;
                    break;
                case 'first_gift':
                    unlocked_flag = _state.giftCount >= 1;
                    break;
                case 'gift_king':
                    unlocked_flag = _state.giftIncome >= 1000;
                    break;
                case 'sales_master':
                    unlocked_flag = _state.totalSales >= 10000;
                    break;
                case 'long_stream':
                    unlocked_flag = _state.duration >= 8;
                    break;
                case 'ten_streams':
                    unlocked_flag = _state.totalStats.totalStreams >= 10;
                    break;
                case 'hundred_fans': {
                    const _f = getFans();
                    unlocked_flag = ((_f.casual || 0) + (_f.loyal || 0) + (_f.true || 0)) >= 100;
                    break;
                }
                case 'thousand_fans': {
                    const _f = getFans();
                    unlocked_flag = ((_f.casual || 0) + (_f.loyal || 0) + (_f.true || 0)) >= 1000;
                    break;
                }
                case 'first_loyal':
                    unlocked_flag = (getFans().loyal || 0) >= 1;
                    break;
                case 'first_true':
                    unlocked_flag = (getFans().true || 0) >= 1;
                    break;
            }
            
            if (unlocked_flag) {
                achieved.push(achievement.id);
                unlocked.push(achievement);
                
                // 发放奖励
                if (achievement.reward && achievement.reward.funds) {
                    if (typeof _gameState.addFunds === 'function') {
                        _gameState.addFunds(achievement.reward.funds, '直播成就：' + achievement.name);
                    }
                }
            }
        });
        
        _state.achievements = achieved;
        return unlocked;
    }

    // 更新UI状态
    function updateUI(key, value) {
        if (!_state.ui) _state.ui = {};
        _state.ui[key] = value;
    }

    // 重置当前直播数据（开始新直播前调用）
    function resetCurrentLive() {
        _state.isLive = false;
        _state.status = LIVE_STATUS.idle;
        _state.streamer = null;
        _state.scene = null;
        _state.roomId = null;
        _state.title = '';
        _state.viewers = 0;
        _state.peakViewers = 0;
        _state.totalViews = 0;
        _state.likes = 0;
        _state.shares = 0;
        _state.newFollowers = 0;
        _state.duration = 0;
        _state.startTime = null;
        _state.endTime = null;
        _state.totalSales = 0;
        _state.orderCount = 0;
        _state.productIds = [];
        _state.currentProductIndex = 0;
        _state.giftIncome = 0;
        _state.giftCount = 0;
        _state.danmakus = [];
        _state.danmakuCount = 0;
    }

    // 保存直播记录到历史
    function saveToHistory() {
        if (!_state.history) _state.history = [];
        
        const record = {
            id: 'live_' + Date.now(),
            title: _state.title || '未命名直播',
            streamer: _state.streamer,
            scene: _state.scene,
            topicId: _state.topicId || 'mixed',
            topic: _state.topic,
            startTime: _state.startTime,
            endTime: _state.endTime || Date.now(),
            duration: _state.duration,
            peakViewers: _state.peakViewers,
            totalViews: _state.totalViews,
            totalSales: _state.totalSales,
            orderCount: _state.orderCount,
            giftIncome: _state.giftIncome,
            giftCount: _state.giftCount,
            likes: _state.likes,
            shares: _state.shares,
            newFollowers: _state.newFollowers,
            fansGained: _state.fansGained || 0,
            heatAvg: _state.heatAvg || 0,
            interactions: { ...(_state.interactions || {}) },
            danmakuCount: _state.danmakuCount,
            productIds: [...(_state.productIds || [])]
        };
        
        _state.history.unshift(record);
        
        // 最多保留50条历史记录
        if (_state.history.length > 50) {
            _state.history = _state.history.slice(0, 50);
        }
        
        // 更新累计统计
        _state.totalStats.totalStreams++;
        _state.totalStats.totalDuration += _state.duration;
        _state.totalStats.totalViewers += _state.peakViewers;
        _state.totalStats.totalSales += _state.totalSales;
        _state.totalStats.totalGifts += _state.giftIncome;
        _state.totalStats.totalOrders += _state.orderCount;
        
        return record;
    }

    // ==================== IP养成（P0）：粉丝 / 每日配额 / 活跃粉丝窗口 ====================

    // 每日直播配额
    function getDailyQuota() {
        const day = (_gameState.state.gameTime && _gameState.state.gameTime.day) || 1;
        if (!_state.daily) _state.daily = { day: 0, used: 0, bonus: 0 };
        if (_state.daily.day !== day) {
            _state.daily.day = day;
            _state.daily.used = 0;
            _state.daily.bonus = 0;
        }
        const base = (typeof LIVE_CONFIG !== 'undefined' && LIVE_CONFIG.dailyLimit) || 1;
        const bonus = _state.daily.bonus || 0;
        const limit = base + bonus;
        return { day: _state.daily.day, used: _state.daily.used || 0, limit, remaining: Math.max(0, limit - (_state.daily.used || 0)) };
    }

    function addBonusDailyQuota(amount) {
        const n = Math.max(1, Math.floor(Number(amount) || 1));
        getDailyQuota();
        if (!_state.daily) _state.daily = { day: 0, used: 0, bonus: 0 };
        _state.daily.bonus = (_state.daily.bonus || 0) + n;
        try { if (_gameState && typeof _gameState.saveDebounced === 'function') _gameState.saveDebounced(); } catch (_) {}
        return getDailyQuota();
    }

    // 消耗一次每日直播次数（返回是否成功）
    function consumeDailyQuota() {
        const q = getDailyQuota();
        if (q.remaining <= 0) return false;
        _state.daily.used = q.used + 1;
        return true;
    }

    // 每日重置（由 gameEngine.onNewDay 调用）
    function livestreamDailyReset() {
        const day = (_gameState.state.gameTime && _gameState.state.gameTime.day) || 1;
        if (!_state.daily) _state.daily = { day: 0, used: 0, bonus: 0 };
        if (_state.daily.day !== day) {
            _state.daily.day = day;
            _state.daily.used = 0;
            _state.daily.bonus = 0;
        }
        // 活跃粉丝窗口按游戏小时过期（processActiveFans 内判断）；这里兜底清理跨日残留
        try {
            const gt = _gameState.state.gameTime;
            if (_state.activeFans && _state.activeFans.count > 0 && gt) {
                const expired = (gt.day > _state.activeFans.expireDay) ||
                    (gt.day === _state.activeFans.expireDay && gt.hour >= _state.activeFans.expireHour);
                if (expired) {
                    _state.activeFans.count = 0;
                    _state.activeFans.dayOrdersUsed = 0;
                }
            }
            // 活跃粉丝自动单的每日配额跨日重置
            if (_state.activeFans) {
                if (_state.activeFans.lastOrderDay !== day) {
                    _state.activeFans.dayOrdersUsed = 0;
                    _state.activeFans.lastOrderDay = day;
                }
            }
        } catch (_) {}
    }

    // 粉丝资产
    function getFans() {
        if (!_state.fans) _state.fans = { casual: 0, loyal: 0, true: 0, profile: {} };
        if (!_state.fans.profile) _state.fans.profile = {};
        return _state.fans;
    }

    // 本场新增粉丝落账（endLive 调用）：计入路人粉 + 画像累积
    function addFansToBase(casualCount, topicCategory) {
        const fans = getFans();
        const n = Math.max(0, Math.floor(casualCount || 0));
        if (n <= 0) return 0;
        fans.casual = (fans.casual || 0) + n;
        if (topicCategory) {
            fans.profile[topicCategory] = (fans.profile[topicCategory] || 0) + n;
        }
        return n;
    }

    // 开启活跃粉丝窗口（直播结束后）
    function startActiveWindow(fansGained) {
        if (!_state.activeFans) _state.activeFans = { count: 0, expireDay: 0, expireHour: 0, dayOrdersUsed: 0, dayOrdersMax: 0, lastOrderDay: 0, lastCheckDay: 0, lastCheckHour: 0 };
        const cfg = (typeof LIVE_CONFIG !== 'undefined') ? LIVE_CONFIG : {};
        const retention = cfg.activeFanRetention != null ? cfg.activeFanRetention : 0.4;
        const windowHours = cfg.activeFanWindowHours != null ? cfg.activeFanWindowHours : 8;
        const count = Math.max(0, Math.floor((fansGained || 0) * retention));
        const gt = _gameState.state.gameTime;
        const day = gt ? (gt.day || 1) : 1;
        const hour = gt ? (gt.hour || 0) : 0;
        // 计算过期时间（当前游戏时间 + windowHours）
        let expireDay = day;
        let expireHour = hour + windowHours;
        while (expireHour >= 24) { expireHour -= 24; expireDay++; }
        const ratio = cfg.activeFanDailyOrderMaxRatio != null ? cfg.activeFanDailyOrderMaxRatio : 0.15;
        const cap = cfg.activeFanDailyOrderMaxCap != null ? cfg.activeFanDailyOrderMaxCap : 300;
        _state.activeFans = {
            count,
            expireDay,
            expireHour,
            dayOrdersUsed: 0,
            dayOrdersMax: Math.min(Math.floor(count * ratio), cap),
            lastOrderDay: day,
            lastCheckDay: day,
            lastCheckHour: hour
        };
        return _state.activeFans;
    }

    function getActiveFans() {
        return _state.activeFans || { count: 0 };
    }

    // P3：是否处于活跃粉丝高价窗口（activeFans 窗口内且未过期）
    function isActiveFanWindow() {
        const af = _state.activeFans;
        if (!af || !(af.count > 0)) return false;
        const gt = _gameState.state.gameTime;
        if (!gt) return false;
        const expired = (gt.day > af.expireDay) || (gt.day === af.expireDay && gt.hour >= af.expireHour);
        return !expired;
    }

    // ==================== P1 粉丝分层 ====================

    // 粉丝分层升级结算（endLive 调用）
    // casual→loyal：单场互动≥10 且热度均值≥50 → 本场新粉 ×8%×热度系数 升级
    // loyal→true：累计场次≥10 或 累计直播销售额≥¥500 → 每场 loyal ×1.5% 升级
    // 返回 { loyalUp, trueUp }
    function upgradeFansAtSettlement(fansGained, interactions, heatAvg) {
        const fans = getFans();
        const cfg = (typeof LIVE_CONFIG !== 'undefined') ? LIVE_CONFIG : {};
        const result = { loyalUp: 0, trueUp: 0 };

        // casual → loyal
        const minInter = cfg.loyalUpgradeMinInteractions != null ? cfg.loyalUpgradeMinInteractions : 10;
        const minHeat = cfg.loyalUpgradeHeatAvg != null ? cfg.loyalUpgradeHeatAvg : 50;
        const loyalRate = cfg.loyalUpgradeRate != null ? cfg.loyalUpgradeRate : 0.08;
        const taps = (interactions && interactions.taps) || 0;
        const correct = (interactions && interactions.correct) || 0;
        const eligible = (taps + correct) >= minInter && heatAvg >= minHeat;
        if (eligible && fansGained > 0) {
            const heatFactor = 0.5 + heatAvg / 50; // 同涨粉热度系数（heat=50→1.5）
            result.loyalUp = Math.min(fansGained, Math.floor(fansGained * loyalRate * heatFactor));
        }

        // loyal → true
        const minStreams = cfg.trueUpgradeMinStreams != null ? cfg.trueUpgradeMinStreams : 10;
        const minSales = cfg.trueUpgradeMinSales != null ? cfg.trueUpgradeMinSales : 500;
        const trueRate = cfg.trueUpgradeRate != null ? cfg.trueUpgradeRate : 0.015;
        const streams = (_state.totalStats && _state.totalStats.totalStreams) || 0;
        const sales = (_state.totalStats && _state.totalStats.totalSales) || 0;
        const loyalNow = fans.loyal || 0;
        if ((streams >= minStreams || sales >= minSales) && loyalNow > 0) {
            result.trueUp = Math.min(loyalNow, Math.floor(loyalNow * trueRate));
        }

        // 落账
        if (result.loyalUp > 0) {
            fans.casual = Math.max(0, (fans.casual || 0) - result.loyalUp);
            fans.loyal = loyalNow + result.loyalUp;
        }
        if (result.trueUp > 0) {
            fans.loyal = Math.max(0, (fans.loyal || 0) - result.trueUp);
            fans.true = (fans.true || 0) + result.trueUp;
        }
        return result;
    }

    // 真爱粉保底（开播用）：返回 { viewers, heat }
    function getTrueFanBaseline() {
        const fans = getFans();
        const cfg = (typeof LIVE_CONFIG !== 'undefined') ? LIVE_CONFIG : {};
        const trueCount = fans.true || 0;
        const viewers = trueCount * (cfg.trueFanBaselineViewers != null ? cfg.trueFanBaselineViewers : 2);
        const heat = trueCount > 0 ? (cfg.trueFanBaselineHeat != null ? cfg.trueFanBaselineHeat : 10) : 0;
        return { viewers, heat };
    }

    // 粉丝资产 → 免费流量加成（simulateBusiness 用）
    // 路人粉基础流量 + 铁粉口碑自然搜索；返回 { base, loyal, total }（total 为乘法系数）
    function getFanTrafficBonus() {
        const fans = getFans();
        const cfg = (typeof LIVE_CONFIG !== 'undefined') ? LIVE_CONFIG : {};
        const per = cfg.fanBaseTrafficPer != null ? cfg.fanBaseTrafficPer : 100;
        const gain = cfg.fanBaseTrafficGain != null ? cfg.fanBaseTrafficGain : 0.02;
        const cap = cfg.fanBaseTrafficCap != null ? cfg.fanBaseTrafficCap : 0.20;
        const base = Math.min(cap, Math.floor((fans.casual || 0) / per) * gain);

        const lPer = cfg.loyalWordOfMouthPer != null ? cfg.loyalWordOfMouthPer : 100;
        const lGain = cfg.loyalWordOfMouthGain != null ? cfg.loyalWordOfMouthGain : 0.02;
        const lCap = cfg.loyalWordOfMouthCap != null ? cfg.loyalWordOfMouthCap : 0.15;
        const loyal = Math.min(lCap, Math.floor((fans.loyal || 0) / lPer) * lGain);

        return { base, loyal, total: 1 + base + loyal };
    }

    // 粉丝画像系数（simulateBusiness 自然单用）：某品类画像粉 → 品类转化加成
    function getProfileBonus(category) {
        const fans = getFans();
        if (!category || !fans.profile || !fans.profile[category]) return 1;
        const cfg = (typeof LIVE_CONFIG !== 'undefined') ? LIVE_CONFIG : {};
        const n = fans.profile[category] || 0;
        const base = cfg.profileBonusBase != null ? cfg.profileBonusBase : 10000;
        const step = cfg.profileBonusStep != null ? cfg.profileBonusStep : 0.05;
        const cap = cfg.profileBonusCap != null ? cfg.profileBonusCap : 0.20;
        const bonus = Math.min(cap, Math.floor(n / base) * step);
        return 1 + bonus;
    }

    // 长期不直播掉粉（onNewDay 调）：每 7 天 -2% 路人粉，保底不归零
    function decayInactiveFans() {
        const day = (_gameState.state.gameTime && _gameState.state.gameTime.day) || 1;
        if (!_state.lastLiveDay || _state.lastLiveDay <= 0) return { decayed: 0, periods: 0 };
        const cfg = (typeof LIVE_CONFIG !== 'undefined') ? LIVE_CONFIG : {};
        const interval = cfg.decayNoLiveDays != null ? cfg.decayNoLiveDays : 7;
        const rate = cfg.decayRate != null ? cfg.decayRate : 0.02;
        const daysGap = day - _state.lastLiveDay;
        if (daysGap < interval) return { decayed: 0, periods: 0 };
        const periods = Math.floor(daysGap / interval);
        const fans = getFans();
        const before = fans.casual || 0;
        const decayed = Math.floor(before * (1 - Math.pow(1 - rate, periods)));
        fans.casual = Math.max(0, before - decayed);
        _state.lastLiveDay = day; // 刷新基准日，避免每日重复扣
        return { decayed, periods };
    }

    // ==================== P2 随机事件 ====================

    // 事件日志（本场，持久化）
    function addEventLog(event) {
        if (!_state.events) _state.events = [];
        const ev = {
            id: 'ev_' + Date.now() + '_' + Math.floor(Math.random() * 1e4),
            timestamp: Date.now(),
            ...event
        };
        _state.events.push(ev);
        if (_state.events.length > 30) _state.events = _state.events.slice(-30);
        return ev;
    }

    function getEvents(limit = 30) {
        return Array.isArray(_state.events) ? _state.events.slice(-limit) : [];
    }

    // 翻车掉粉：路人粉按比例减少，返回损失数
    function applyFanLossRatio(ratio) {
        const fans = getFans();
        const before = fans.casual || 0;
        if (before <= 0 || !(ratio > 0)) return 0;
        const lost = Math.min(before, Math.max(1, Math.floor(before * ratio)));
        fans.casual = before - lost;
        return lost;
    }

    // 黑粉转铁粉：以 haterBase（流失粉丝数）为基数，ratio 比例转成铁粉
    function convertHatersToLoyal(ratio, haterBase) {
        const fans = getFans();
        const base = Math.max(0, Math.floor(haterBase || 0));
        if (base <= 0 || !(ratio > 0)) return 0;
        const converted = Math.min(fans.casual || 0, Math.max(1, Math.floor(base * ratio)));
        fans.casual = Math.max(0, (fans.casual || 0) - converted);
        fans.loyal = (fans.loyal || 0) + converted;
        return converted;
    }

    // ==================== 直播复盘分析 ====================

    // 解析主播/场景/话题名称（兼容字符串 id 与对象）
    function _resolveName(ref, list) {
        if (!ref) return null;
        if (typeof ref === 'string') {
            const found = (list || []).find(x => x && x.id === ref);
            return found ? found.name : ref;
        }
        return ref.name || ref.id || null;
    }

    // 聚合某维度（主播/场景/话题）的直播表现，按场均销售额排序
    function _aggregate(keyFn, nameFn) {
        const history = _state.history || [];
        const map = {};
        history.forEach(h => {
            const key = keyFn(h);
            const name = nameFn(h);
            if (!name) return;
            if (!map[key]) map[key] = { name, streams: 0, sales: 0, gifts: 0, orders: 0, viewers: 0, duration: 0 };
            const b = map[key];
            b.streams++;
            b.sales += Number(h.totalSales) || 0;
            b.gifts += Number(h.giftIncome) || 0;
            b.orders += Number(h.orderCount) || 0;
            b.viewers += Number(h.peakViewers) || 0;
            b.duration += Number(h.duration) || 0;
        });
        return Object.keys(map).map(k => {
            const b = map[k];
            return {
                key: k,
                name: b.name,
                streams: b.streams,
                totalSales: b.sales,
                avgSales: b.streams ? Math.round(b.sales / b.streams) : 0,
                avgViewers: b.streams ? Math.round(b.viewers / b.streams) : 0,
                totalGifts: b.gifts,
                totalOrders: b.orders
            };
        }).sort((a, b) => b.avgSales - a.avgSales);
    }

    // 直播复盘：按主播/场景/话题聚合历史表现，给出最佳组合洞察
    function analyzePerformance() {
        const streamers = _aggregate(
            h => (typeof h.streamer === 'string' ? h.streamer : (h.streamer && h.streamer.id)) || 'unknown',
            h => _resolveName(h.streamer, LIVE_STREAMER_TYPES)
        );
        const scenes = _aggregate(
            h => (typeof h.scene === 'string' ? h.scene : (h.scene && h.scene.id)) || 'unknown',
            h => _resolveName(h.scene, LIVE_SCENES)
        );
        const topics = _aggregate(
            h => h.topicId || (h.topic && h.topic.id) || (typeof h.topic === 'string' ? h.topic : 'mixed'),
            h => _resolveName(h.topic, LIVE_TOPICS)
                || (h.topicId ? ((LIVE_TOPICS.find(t => t.id === h.topicId) || {}).name || h.topicId) : '综合')
        );
        return {
            totalStreams: (_state.history || []).length,
            streamers, scenes, topics,
            bestStreamer: streamers[0] || null,
            bestScene: scenes[0] || null,
            bestTopic: topics[0] || null
        };
    }

    // 导出API
    return {
        init,
        getState,
        getCurrentStreamer,
        getCurrentScene,
        isLive,
        getFormattedDuration,
        getViewerLevel,
        getAvailableStreamers,
        getStatistics,
        getHistory,
        getReplays,
        getDanmakus,
        addDanmaku,
        addSystemMessage,
        checkAchievements,
        updateUI,
        resetCurrentLive,
        saveToHistory,
        // IP养成（P0）
        getDailyQuota,
        addBonusDailyQuota,
        consumeDailyQuota,
        livestreamDailyReset,
        getFans,
        addFansToBase,
        startActiveWindow,
        getActiveFans,
        // P1 粉丝分层
        upgradeFansAtSettlement,
        getTrueFanBaseline,
        getFanTrafficBonus,
        getProfileBonus,
        decayInactiveFans,
        // P2 随机事件
        addEventLog,
        getEvents,
        applyFanLossRatio,
        convertHatersToLoyal,
        // P3
        isActiveFanWindow,
        // 复盘分析
        analyzePerformance
    };
})();

// 导出到全局
if (typeof window !== 'undefined') {
    window.liveState = liveState;
}
