// ============================================================================
// 直播中心系统 - 引擎层
// 负责：直播生命周期管理、观众模拟、弹幕生成、礼物系统、销售逻辑
// ============================================================================

const liveEngine = (function() {
    'use strict';

    let _gameState = null;
    let _ui = null;
    let _updateInterval = null;
    let _danmakuInterval = null;
    let _giftInterval = null;
    let _viewerInterval = null;
    let _salesInterval = null;

    // 直播阶段数据
    let _currentPhase = 'warmup'; // warmup, rising, peak, declining
    let _phaseProgress = 0;
    let _lastDanmakuTime = 0;
    let _lastGiftTime = 0;
    let _lastSalesTime = 0;

    // IP养成（P0）：热度衰减累计器 / 点热度冷却
    let _heatTickAccum = 0;       // 秒
    let _lastTapHeatTime = 0;
    // P2：事件判定累计器（秒）
    let _eventCheckAccum = 0;

    // 初始化引擎
    function init(gameStateInstance, uiManager) {
        _gameState = gameStateInstance;
        _ui = uiManager;
        try {
            if (typeof liveState !== 'undefined' && typeof liveState.init === 'function') {
                liveState.init(gameStateInstance);
            }
        } catch (_) {}
        console.log('[LiveEngine] 直播引擎初始化完成');
    }

    // 开始直播（P0：每日限次 + 店主亲自直播 + 话题选择 + 现实分钟时长 + 热度开局）
    function startLive(options) {
        let state = liveState.getState();
        if (!state && _gameState && typeof liveState.init === 'function') {
            try { liveState.init(_gameState); } catch (_) {}
            state = liveState.getState();
        }
        if (!state) {
            return { success: false, message: '直播未初始化，请关闭后重开' };
        }
        
        if (state.isLive) {
            return { success: false, message: '已有直播正在进行中' };
        }

        // ===== P0：每日直播配额校验（防肝：每天手动 1 次）=====
        const quota = liveState.getDailyQuota();
        if (quota.remaining <= 0) {
            return { success: false, message: `今日直播次数已用完（每日 ${quota.limit} 次），明日 0 点刷新` };
        }

        // ===== P3：主播选择（亲自直播免费 / 助播花钱起量，不自动出单，粉丝仍归店主）=====
        const streamerType = options.streamerType || 'self';
        const streamer = LIVE_STREAMER_TYPES.find(s => s.id === streamerType);
        if (!streamer) {
            return { success: false, message: '无效的主播类型' };
        }
        if (streamer.cost > 0) {
            if (typeof _gameState.spendFunds === 'function') {
                const spendResult = _gameState.spendFunds(streamer.cost, '邀请助播：' + streamer.name);
                if (!spendResult) {
                    return { success: false, message: '资金不足，无法邀请该助播（欠款已达上限）' };
                }
            }
        }

        const sceneType = options.sceneType || 'product_show';
        const scene = LIVE_SCENES.find(s => s.id === sceneType);

        // ===== P0：话题选择（粉丝画像）=====
        const topicId = options.topicId || 'mixed';
        const topic = (typeof LIVE_TOPICS !== 'undefined')
            ? (LIVE_TOPICS.find(t => t.id === topicId) || LIVE_TOPICS[LIVE_TOPICS.length - 1])
            : null;

        // ===== P0：时长 = 现实分钟（3/6/10 三档）=====
        const cfg = (typeof LIVE_CONFIG !== 'undefined') ? LIVE_CONFIG : {};
        const durations = cfg.durations || [3, 6, 10];
        const defaultDuration = cfg.defaultDuration != null ? cfg.defaultDuration : 6;
        const rawDuration = Number(options.duration);
        const plannedDuration = durations.includes(rawDuration) ? rawDuration : defaultDuration;

        // 重置直播状态
        liveState.resetCurrentLive();
        
        // 设置直播信息
        state.isLive = true;
        state.status = LIVE_STATUS.live;
        state.streamer = streamer;
        state.scene = scene;
        state.roomId = 'room_' + Date.now();
        state.title = options.title || _gameState.state.shop.name + '的直播间';
        state.plannedDuration = plannedDuration;   // 现实分钟
        state.duration = 0;
        state.productIds = _pickLiveShelf(options.productIds, topic);
        state.currentProductIndex = 0;
        state._productRotateAccum = 0;
        state.startTime = Date.now();
        state.startTimeReal = Date.now();          // 防幽灵直播兜底（gameEngine 校验）
        state.notice = options.notice || '欢迎来到直播间！关注主播不迷路~';
        
        // ===== IP养成：本场状态 =====
        state.topicId = topic ? topic.id : 'mixed';
        state.topic = topic;
        state.heat = cfg.initialHeat != null ? cfg.initialHeat : 30;
        state.fansGained = 0;
        state.interactions = { taps: 0, correct: 0, wrong: 0 };
        state.currentQuestion = null;
        state.settlement = null;
        state.heatAvg = 0;
        state._heatTotal = 0;
        state._heatTicks = 0;
        state.lastLiveDay = (_gameState.state.gameTime && _gameState.state.gameTime.day) || 1;
        _heatTickAccum = 0;
        _eventCheckAccum = 0;

        // ===== P2：本场事件状态重置 =====
        state.events = [];
        state.activeEvent = null;
        state.eventCooldown = 0;
        state.eventCount = 0;
        state.boom = null;

        // 应用设置
        if (options.settings) {
            state.settings = { ...state.settings, ...options.settings };
        }

        // ===== P3：价格策略 → 直播中定价（低价冲量 ×0.8 / 高价厚利 ×1.1）=====
        const psId = options.priceStrategy || 'volume';
        const ps = (typeof PRICE_STRATEGIES !== 'undefined') ? PRICE_STRATEGIES.find(p => p.id === psId) : null;
        state.priceStrategy = ps ? ps.id : 'volume';
        const userDiscount = (options.settings && options.settings.discountRate) || 0.9;
        if (state.priceStrategy === 'volume') {
            const volDisc = cfg.priceStrategyVolumeDiscount != null ? cfg.priceStrategyVolumeDiscount : 0.8;
            state.settings.discountRate = Math.min(userDiscount, volDisc); // 低价冲量：取玩家折扣与 0.8 的更低价
            state.settings.showDiscount = true;
        } else {
            state.settings.discountRate = cfg.priceStrategyMarginMult != null ? cfg.priceStrategyMarginMult : 1.1; // 高价厚利：加价卖
            state.settings.showDiscount = true;
        }

        // 初始观众（P1：基础 100 + 真爱粉×2 保底；P3：助播 baseFans×10% 起量）
        const baseInitial = cfg.baseInitialViewers != null ? cfg.baseInitialViewers : 100;
        let baseline = { viewers: 0, heat: 0 };
        try {
            baseline = liveState.getTrueFanBaseline() || baseline;
        } catch (_) {}
        let assistantViewers = 0;
        let assistantHeat = 0;
        if (streamer.id !== 'self') {
            assistantViewers = Math.floor((streamer.baseFans || 0) * (cfg.assistantViewerRatio != null ? cfg.assistantViewerRatio : 0.1));
            assistantHeat = Math.min(20, (cfg.assistantHeatBase != null ? cfg.assistantHeatBase : 5) + Math.floor((streamer.baseFans || 0) / 10000));
            if (assistantViewers > 0 || assistantHeat > 0) {
                liveState.addSystemMessage(`🎤 助播「${streamer.name}」正在暖场：初始观众 +${assistantViewers}、热度 +${assistantHeat}`);
            }
        }
        const initialViewers = Math.max(5, Math.floor((baseInitial + (baseline.viewers || 0) + assistantViewers) * (0.8 + Math.random() * 0.4)));
        state.viewers = initialViewers;
        state._initialViewers = initialViewers;
        state.peakViewers = initialViewers;
        state.totalViews = initialViewers;

        // P1：真爱粉开播保底热度；P3：助播热度加成
        state.heat = Math.min(cfg.maxHeat != null ? cfg.maxHeat : 100, state.heat + (baseline.heat || 0) + assistantHeat);
        if (baseline.heat > 0) {
            liveState.addSystemMessage(`💜 ${liveState.getFans().true || 0} 位真爱粉已涌入直播间，开局保底热度 +${baseline.heat}！`);
        }
        if (ps && ps.id === 'margin') {
            liveState.addSystemMessage(`📈 本场策略：高价厚利（售价 ×${ps.priceMult}，慢卖高毛利）`);
        } else if (ps) {
            liveState.addSystemMessage(`📉 本场策略：低价冲量（售价 ×${ps.priceMult}，走量冲销量）`);
        }

        // 重置阶段
        _currentPhase = 'warmup';
        _phaseProgress = 0;

        // 消耗每日直播次数
        liveState.consumeDailyQuota();

        // 添加系统欢迎消息
        liveState.addSystemMessage('🎉 直播开始啦！欢迎各位宝宝来到直播间~');
        liveState.addSystemMessage('📢 ' + state.notice);
        if (topic) liveState.addSystemMessage(`🎯 本场话题：${topic.icon} ${topic.name} —— ${topic.desc}`);

        // 启动定时器
        _startUpdateLoops();

        // 通知UI更新
        _notifyUpdate();

        return { 
            success: true, 
            message: '直播已开始（亲自上阵，粉丝归你！）',
            roomId: state.roomId,
            viewers: state.viewers
        };
    }

    // 结束直播（P0：IP养成结算——涨粉落账 + 活跃粉丝窗口开启）
    function endLive() {
        const state = liveState.getState();
        
        if (!state.isLive) {
            return { success: false, message: '当前没有进行中的直播' };
        }

        // 停止定时器
        _stopUpdateLoops();

        // 设置结束状态
        state.isLive = false;
        state.status = LIVE_STATUS.ended;
        state.endTime = Date.now();

        // ===== P0：IP养成结算 =====
        const cfg = (typeof LIVE_CONFIG !== 'undefined') ? LIVE_CONFIG : {};
        const fansGained = Math.max(0, Math.floor(state.fansGained || 0));
        const topicCategory = state.topic && state.topic.category;
        const topicName = state.topic ? `${state.topic.icon} ${state.topic.name}` : '🌟 综合';
        // P2：直播结束清理爆单/待处理事件（未处理的翻车按无视处理）
        if (state.boom) {
            liveState.addEventLog({ type: 'boom_end', eventId: 'boom_end', day: (_gameState.state.gameTime && _gameState.state.gameTime.day) || 1, hour: (_gameState.state.gameTime && _gameState.state.gameTime.hour) || 0, detail: state.boom.restocked ? '爆单兑现' : '爆单未补货，缩水结算' });
            state.boom = null;
        }
        if (state.activeEvent) {
            liveState.addEventLog({ type: 'pr', eventId: 'crisis_pr', option: 2, outcome: 'ignore', detail: '直播结束，未处理公关事件（按无视）' });
            state.activeEvent = null;
        }
        // 热度均值
        const heatAvg = Math.round(((state._heatTicks > 0 ? state._heatTotal / state._heatTicks : state.heat) || 0) * 10) / 10;
        state.heatAvg = heatAvg;

        // 涨粉落账（路人粉 + 画像累积）
        liveState.addFansToBase(fansGained, topicCategory);
        // P1：粉丝分层升级结算（casual→loyal→true）
        const upgrade = liveState.upgradeFansAtSettlement(fansGained, state.interactions, heatAvg);
        // 活跃粉丝窗口（直播后 N 游戏小时自动带单）
        const af = liveState.startActiveWindow(fansGained);

        // 添加结束消息
        liveState.addSystemMessage('👋 本次直播已结束，感谢大家的观看！我们下次再见~');
        liveState.addSystemMessage(`📊 本场数据：观众${state.peakViewers}人 · 销售额¥${state.totalSales.toFixed(2)} · 涨粉 +${fansGained}`);
        liveState.addSystemMessage(`⭐ 新增活跃粉丝 ${af.count} 人，将在接下来 ${cfg.activeFanWindowHours != null ? cfg.activeFanWindowHours : 8} 小时内持续为店铺带来自动订单`);
        if (upgrade.loyalUp > 0) {
            liveState.addSystemMessage(`💛 ${upgrade.loyalUp} 位路人粉升级为铁粉！铁粉每天带来免费自然搜索`);
        }
        if (upgrade.trueUp > 0) {
            liveState.addSystemMessage(`💜 ${upgrade.trueUp} 位铁粉升级为真爱粉！已解锁粉丝群，开播自动涌入`);
        }

        // 保存到历史
        const record = liveState.saveToHistory();

        // 检查成就
        const newAchievements = liveState.checkAchievements();
        newAchievements.forEach(a => {
            liveState.addSystemMessage(`🏆 恭喜解锁成就：${a.name}！奖励¥${a.reward.funds}`);
        });

        // 结算快照（供 UI 展示）
        state.settlement = {
            fansGained,
            topicName,
            heatAvg,
            loyalUp: upgrade.loyalUp,
            trueUp: upgrade.trueUp,
            activeFans: af.count,
            activeFanWindowHours: cfg.activeFanWindowHours != null ? cfg.activeFanWindowHours : 8,
            totalSales: state.totalSales,
            orderCount: state.orderCount,
            peakViewers: state.peakViewers,
            giftIncome: state.giftIncome
        };

        // 通知UI更新
        _notifyUpdate();

        return {
            success: true,
            message: '直播已结束',
            record: record,
            newAchievements: newAchievements,
            settlement: state.settlement
        };
    }

    // 暂停直播
    function pauseLive() {
        const state = liveState.getState();
        if (!state.isLive) return { success: false, message: '没有进行中的直播' };
        
        state.status = LIVE_STATUS.paused;
        _stopUpdateLoops();
        liveState.addSystemMessage('⏸️ 直播已暂停，主播马上回来~');
        _notifyUpdate();
        
        return { success: true };
    }

    // 恢复直播
    function resumeLive() {
        const state = liveState.getState();
        if (state.status !== LIVE_STATUS.paused) {
            return { success: false, message: '直播未暂停' };
        }
        
        state.status = LIVE_STATUS.live;
        _startUpdateLoops();
        liveState.addSystemMessage('▶️ 直播恢复啦！继续带大家看好物~');
        _notifyUpdate();
        
        return { success: true };
    }

    // 发送弹幕（主播/店主发送）
    function sendDanmaku(content, type = 'normal') {
        const state = liveState.getState();
        
        if (!content || content.trim().length === 0) {
            return { success: false, message: '弹幕内容不能为空' };
        }
        
        if (content.length > 50) {
            return { success: false, message: '弹幕内容不能超过50字' };
        }

        const state_data = liveState.getState();
        const isOwner = true;
        
        liveState.addDanmaku({
            type: isOwner ? 'vip' : type,
            userName: _gameState.state.player.name || '店主',
            content: content.trim(),
            color: isOwner ? '#ffd700' : DANMAKU_TYPES[type]?.color || '#ffffff',
            isOwner: true,
            avatar: _gameState.state.player.avatar || '👨‍💼'
        });

        _notifyUpdate();
        return { success: true };
    }

    // 发送礼物（模拟观众送礼）
    function sendGift(giftId, userName = null) {
        const state = liveState.getState();
        
        if (!state.isLive || state.status !== LIVE_STATUS.live) {
            return { success: false, message: '直播未进行中' };
        }

        const gift = LIVE_GIFTS.find(g => g.id === giftId);
        if (!gift) {
            return { success: false, message: '无效的礼物' };
        }

        const viewerName = userName || MOCK_VIEWER_NAMES[Math.floor(Math.random() * MOCK_VIEWER_NAMES.length)];
        
        // 记录礼物收入
        state.giftIncome += gift.price;
        state.giftCount++;
        
        // 礼物平台抽成50%，实际获得50%
        if (typeof _gameState.addFunds === 'function') {
            const actualIncome = gift.price * 0.5;
            _gameState.addFunds(actualIncome, `直播礼物：${viewerName}赠送${gift.name}`);
        }

        // 添加礼物弹幕
        liveState.addDanmaku({
            type: 'gift',
            userName: viewerName,
            content: `送出了 ${gift.icon}${gift.name}`,
            color: DANMAKU_TYPES.gift.color,
            giftId: giftId,
            giftPrice: gift.price
        });

        // 送礼后观众增加
        const viewerBoost = Math.floor(gift.price / 10) + Math.floor(Math.random() * 5);
        _addViewers(viewerBoost);

        // 增加点赞
        state.likes += Math.floor(gift.price / 5) + Math.floor(Math.random() * 10);

        _notifyUpdate();
        return { success: true, gift: gift, viewerName: viewerName };
    }

    // 点赞
    function addLike(count = 1) {
        const state = liveState.getState();
        state.likes += count;
        _notifyUpdate();
    }

    // 分享直播
    function shareLive() {
        const state = liveState.getState();
        state.shares++;
        
        // 分享后观众增加
        const viewerBoost = 5 + Math.floor(Math.random() * 15);
        _addViewers(viewerBoost);
        
        liveState.addSystemMessage(`🔗 直播间被分享了！吸引了${viewerBoost}位新观众~`);
        _notifyUpdate();
        
        return { success: true, newViewers: viewerBoost };
    }

    // 切换商品
    function switchProduct(index) {
        const state = liveState.getState();
        if (state.productIds && state.productIds.length > 0) {
            state.currentProductIndex = index % state.productIds.length;
        }
        _notifyUpdate();
    }

    // 更新设置
    function updateSettings(key, value) {
        const state = liveState.getState();
        if (!state.settings) state.settings = {};
        state.settings[key] = value;
        _notifyUpdate();
    }

    // ========== 内部更新循环 ==========

    function _startUpdateLoops() {
        // P0：直播是现实时间玩法——主循环每 5 秒 = 1/12 现实分钟；
        // 观众/涨粉/热度并入主循环；移除自动礼物刷单（挂机收益），礼物由玩家主动触发
        _updateInterval = setInterval(() => _mainUpdate(), 5000);
        _danmakuInterval = setInterval(() => _generateDanmaku(), 4000);
        _viewerInterval = null;
        _giftInterval = null;
        _salesInterval = null;
    }

    function _stopUpdateLoops() {
        if (_updateInterval) clearInterval(_updateInterval);
        if (_danmakuInterval) clearInterval(_danmakuInterval);
        if (_viewerInterval) clearInterval(_viewerInterval);
        if (_giftInterval) clearInterval(_giftInterval);
        if (_salesInterval) clearInterval(_salesInterval);
        
        _updateInterval = null;
        _danmakuInterval = null;
        _viewerInterval = null;
        _giftInterval = null;
        _salesInterval = null;
    }

    // 主更新（每 5 秒 = 1/12 现实分钟）
    function _mainUpdate() {
        // 直播按现实时间走，不因经营时间暂停而停（否则挂机/暂停后观众数卡住）
        const state = liveState.getState();
        if (!state.isLive || state.status !== LIVE_STATUS.live) return;

        // 时长（现实分钟）
        state.duration += 5 / 60;

        // 热度统计累计（用于 endLive 平均热度）
        state._heatTotal = (state._heatTotal || 0) + state.heat;
        state._heatTicks = (state._heatTicks || 0) + 1;
        state.heatAvg = state._heatTicks > 0 ? state._heatTotal / state._heatTicks : state.heat;

        // 热度衰减：每 15 秒 -2（挂机即降温，防挂机刷粉）
        _heatTickAccum += 5;
        if (_heatTickAccum >= 15) {
            _heatTickAccum -= 15;
            const decay = (typeof LIVE_CONFIG !== 'undefined' && LIVE_CONFIG.heatDecayPer15s != null) ? LIVE_CONFIG.heatDecayPer15s : 2;
            state.heat = Math.max(0, state.heat - decay);
        }

        // 更新阶段
        _updatePhase();
        
        // 随机点赞（氛围）
        if (Math.random() < 0.3) {
            state.likes += Math.floor(Math.random() * Math.max(1, state.viewers) / 10) + 1;
        }

        // 观众平滑（热度驱动）
        _updateViewers();

        // 涨粉累加（每分钟 观众×2%×热度系数 → 每 5 秒 /12）
        _accrueFans();

        // 讲解轮播：每隔约 25 秒换下一件，观众跟着看讲解，不是货架全员同时下单
        _rotateFeaturedProduct();
        try {
            if (typeof gameEngine !== 'undefined' && gameEngine && typeof gameEngine._processLiveWatchSales === 'function') {
                gameEngine._processLiveWatchSales(state);
            }
        } catch (_) {}

        // 弹幕互动题轮换
        _tickQuestion();

        // P2：随机事件判定（爆单/翻车）
        try { _tickEvents(); } catch (_) {}

        // 检查是否到达预定时间自动结束（现实分钟）
        if (state.settings.autoEnd && state.duration >= state.plannedDuration) {
            endLive();
            return;
        }

        _notifyUpdate();
    }

    // 更新直播阶段
    function _pickLiveShelf(requested, topic) {
        const listings = ((_gameState && _gameState.state && _gameState.state.listings) || [])
            .filter(l => l && l.status === 'active');
        const want = 10;
        const picked = [];
        const seen = {};
        (requested || []).forEach(id => {
            if (!id || seen[id] || picked.length >= 16) return;
            if (!listings.some(l => l.productId === id)) return;
            seen[id] = true;
            picked.push(id);
        });
        if (picked.length >= want) return picked.slice(0, 16);
        const topicCat = topic && topic.category && topic.category !== 'mixed' ? topic.category : null;
        const scored = listings.map(l => {
            const p = (typeof PRODUCTS !== 'undefined' && PRODUCTS) ? PRODUCTS.find(x => x.id === l.productId) : null;
            if (!p || seen[l.productId]) return null;
            let stock = 1;
            try {
                stock = (_gameState && typeof _gameState.getSellableQuantity === 'function')
                    ? _gameState.getSellableQuantity(l.productId, l.qualityGrade || 'B')
                    : 1;
            } catch (_) {}
            let score = Math.random() * 2;
            if (topicCat && p.category === topicCat) score += 8;
            if (topic && topic.profile && topic.profile[p.category]) score += Number(topic.profile[p.category]) * 2;
            if (stock > 0) score += Math.min(4, stock / 20);
            else score -= 6;
            return { id: l.productId, score };
        }).filter(Boolean).sort((a, b) => b.score - a.score);
        scored.forEach(s => {
            if (picked.length >= want) return;
            seen[s.id] = true;
            picked.push(s.id);
        });
        return picked;
    }

    function _rotateFeaturedProduct() {
        const state = liveState.getState();
        const ids = state.productIds || [];
        if (ids.length < 2) return;
        state._productRotateAccum = (state._productRotateAccum || 0) + 5;
        if (state._productRotateAccum < 25) return;
        state._productRotateAccum = 0;
        state.currentProductIndex = ((state.currentProductIndex || 0) + 1) % ids.length;
        const pid = ids[state.currentProductIndex];
        const product = (typeof PRODUCTS !== 'undefined' && PRODUCTS) ? PRODUCTS.find(p => p.id === pid) : null;
        if (product) {
            liveState.addSystemMessage(`🛍️ 开始讲解：${product.name}（看的人多，当场下单的少）`);
        }
    }

    function _updatePhase() {
        const state = liveState.getState();
        const progress = state.duration / state.plannedDuration;
        
        if (progress < 0.2) {
            _currentPhase = 'warmup';
        } else if (progress < 0.5) {
            _currentPhase = 'rising';
        } else if (progress < 0.8) {
            _currentPhase = 'peak';
        } else {
            _currentPhase = 'declining';
        }
        _phaseProgress = progress;
    }

    function _isGamePaused() {
        try {
            return !!(typeof gameState !== 'undefined' && gameState && typeof gameState.isPaused === 'function' && gameState.isPaused());
        } catch (_) { return false; }
    }

    // 更新观众数量（P0：初始观众为基准 × 热度系数，热度越高涨得越快）
    function _updateViewers() {
        const state = liveState.getState();
        if (!state.isLive || state.status !== LIVE_STATUS.live) return;

        const scene = liveState.getCurrentScene();
        const shopLevel = (_gameState && _gameState.state && _gameState.state.shop && _gameState.state.shop.level) || 1;
        const cfg = (typeof LIVE_CONFIG !== 'undefined') ? LIVE_CONFIG : {};
        
        const baseViewers = Math.max(20, state._initialViewers || state.viewers || cfg.baseInitialViewers || 100);
        
        // 热度系数：0.5 + heat/100（heat=30→0.8, 80→1.3, 100→1.5）
        const heatFactor = 0.5 + (state.heat || 30) / 100;
        
        const phaseMultiplier = {
            warmup: 0.75 + Math.random() * 0.15,
            rising: 1.05 + Math.random() * 0.25,
            peak: 1.35 + Math.random() * 0.35,
            declining: 0.85 + Math.random() * 0.15
        }[_currentPhase] || 1;
        
        let sceneMultiplier = 1;
        if (scene && scene.trafficBonus) sceneMultiplier = scene.trafficBonus;
        
        const levelMultiplier = 1 + (shopLevel - 1) * 0.1;
        
        let discountMultiplier = 1;
        if (state.settings && state.settings.showDiscount) {
            discountMultiplier = 1 + (1 - (state.settings.discountRate || 0.9)) * 2;
        }
        
        const targetViewers = Math.max(8, Math.floor(
            baseViewers * phaseMultiplier * sceneMultiplier * levelMultiplier * discountMultiplier * heatFactor
            * (0.92 + Math.random() * 0.16)
        ));
        
        const diff = targetViewers - state.viewers;
        const toward = Math.sign(diff) * Math.max(2, Math.round(Math.abs(diff) * 0.22));
        const jitter = Math.round((Math.random() - 0.4) * Math.max(4, baseViewers * 0.03));
        const change = toward + jitter;
        
        state.viewers = Math.max(1, state.viewers + change);
        state.totalViews += Math.max(0, change);
        
        if (state.viewers > state.peakViewers) {
            state.peakViewers = state.viewers;
        }
    }

    function _addViewers(count) {
        const state = liveState.getState();
        state.viewers += count;
        state.totalViews += count;
        if (state.viewers > state.peakViewers) {
            state.peakViewers = state.viewers;
        }
    }

    // ===== IP养成（P0）：涨粉 / 互动题 / 热度操作 =====

    // 涨粉累加：每分钟 观众×2%×热度系数；每 5 秒 tick 取 1/12；单场上限 = 峰值观众×10%
    // P3：价格策略影响涨粉（低价冲量 ×1.2 / 高价厚利 ×0.9）
    function _accrueFans() {
        const state = liveState.getState();
        if (!state.isLive || state.status !== LIVE_STATUS.live) return;
        const cfg = (typeof LIVE_CONFIG !== 'undefined') ? LIVE_CONFIG : {};
        const rate = cfg.fanGainRate != null ? cfg.fanGainRate : 0.02;
        const capRatio = cfg.fanGainCapRatio != null ? cfg.fanGainCapRatio : 0.10;
        // 涨粉热度系数：0.5 + heat/50（heat=30→1.1, 80→2.1, 100→2.5）
        const heatFactor = 0.5 + (state.heat || 30) / 50;
        let fanMult = 1;
        if (state.priceStrategy === 'volume') fanMult = cfg.priceStrategyVolumeFan != null ? cfg.priceStrategyVolumeFan : 1.2;
        else if (state.priceStrategy === 'margin') fanMult = cfg.priceStrategyMarginFan != null ? cfg.priceStrategyMarginFan : 0.9;
        const gain = Math.max(0, state.viewers * rate * heatFactor * fanMult / 12);
        const cap = Math.floor((state.peakViewers || state.viewers) * capRatio);
        state.fansGained = Math.min(cap, (state.fansGained || 0) + gain);
    }

    // 互动题轮换：无待答问题时按概率出题（约每 15~20 秒一题）
    function _tickQuestion() {
        const state = liveState.getState();
        if (!state.isLive || state.status !== LIVE_STATUS.live) return;
        if (!state.settings.enableDanmaku) return;
        if (state.currentQuestion) return;
        if (Math.random() > 0.3) return;
        const pool = (typeof LIVE_QUESTIONS !== 'undefined' && LIVE_QUESTIONS.length > 0) ? LIVE_QUESTIONS : null;
        if (!pool) return;
        const q = pool[Math.floor(Math.random() * pool.length)];
        state.currentQuestion = { q: q.q, options: q.options, correctIndex: q.correctIndex, id: 'q_' + Date.now() };
    }

    // 点热度（互动小游戏 1：维持热度）
    function tapHeat() {
        const state = liveState.getState();
        if (!state.isLive || state.status !== LIVE_STATUS.live) {
            return { success: false, message: '直播未进行中' };
        }
        const cfg = (typeof LIVE_CONFIG !== 'undefined') ? LIVE_CONFIG : {};
        const cooldown = cfg.tapHeatCooldownMs != null ? cfg.tapHeatCooldownMs : 500;
        const now = Date.now();
        if (now - _lastTapHeatTime < cooldown) {
            return { success: false, message: '手速太快啦，歇一下~' };
        }
        _lastTapHeatTime = now;
        const gainArr = cfg.tapHeatGain || [1, 3];
        const gain = gainArr[0] + Math.floor(Math.random() * (gainArr[1] - gainArr[0] + 1));
        const maxHeat = cfg.maxHeat != null ? cfg.maxHeat : 100;
        state.heat = Math.min(maxHeat, state.heat + gain);
        state.interactions.taps = (state.interactions.taps || 0) + 1;
        state.likes += 3;
        _notifyUpdate();
        return { success: true, heat: state.heat, gain };
    }

    // 答题（互动小游戏 2：弹幕 2 选 1）
    function answerQuestion(optionIndex) {
        const state = liveState.getState();
        if (!state.isLive || state.status !== LIVE_STATUS.live) {
            return { success: false, message: '直播未进行中' };
        }
        const q = state.currentQuestion;
        if (!q) return { success: false, message: '当前没有待回答的问题' };
        const cfg = (typeof LIVE_CONFIG !== 'undefined') ? LIVE_CONFIG : {};
        const maxHeat = cfg.maxHeat != null ? cfg.maxHeat : 100;
        const correct = optionIndex === q.correctIndex;
        if (correct) {
            const gainArr = cfg.answerCorrectGain || [8, 12];
            const gain = gainArr[0] + Math.floor(Math.random() * (gainArr[1] - gainArr[0] + 1));
            state.heat = Math.min(maxHeat, state.heat + gain);
            state.interactions.correct = (state.interactions.correct || 0) + 1;
            liveState.addSystemMessage(`✅ 答对啦！热度 +${gain}（当前 ${Math.round(state.heat)}）`);
        } else {
            const penalty = cfg.answerWrongPenalty != null ? cfg.answerWrongPenalty : 5;
            state.heat = Math.max(0, state.heat - penalty);
            state.interactions.wrong = (state.interactions.wrong || 0) + 1;
            liveState.addSystemMessage(`❌ 答错了…热度 -${penalty}（当前 ${Math.round(state.heat)}）`);
        }
        state.currentQuestion = null;
        _notifyUpdate();
        return { success: true, correct, heat: state.heat };
    }

    // ===== P2：随机事件 =====

    // 事件判定（主循环内调用；forceType 供测试/调试直接触发）
    function _tickEvents(forceType) {
        const state = liveState.getState();
        if (!state.isLive || state.status !== LIVE_STATUS.live) return { triggered: false };
        const cfg = (typeof LIVE_CONFIG !== 'undefined') ? LIVE_CONFIG : {};

        // 单场上限
        if (state.eventCount >= (cfg.liveMaxEventsPerStream != null ? cfg.liveMaxEventsPerStream : 2)) {
            return { triggered: false, reason: 'max' };
        }

        if (!forceType) {
            // 事件判定间隔（默认每 60 秒判定一次）
            const interval = cfg.eventCheckIntervalSec != null ? cfg.eventCheckIntervalSec : 60;
            _eventCheckAccum += 5;
            if (_eventCheckAccum < interval) return { triggered: false, reason: 'interval' };
            _eventCheckAccum = 0;

            // 冷却期不触发
            if (state.eventCooldown > 0) {
                state.eventCooldown--;
                return { triggered: false, reason: 'cooldown' };
            }

            // 概率：正面（热度≥70 ×2）/ 负面（热度≤25 ×2）
            const heat = state.heat || 30;
            let boomChance = cfg.liveBoomBaseChance != null ? cfg.liveBoomBaseChance : 0.12;
            let flipChance = cfg.liveFlipBaseChance != null ? cfg.liveFlipBaseChance : 0.10;
            if (heat >= (cfg.liveBoomHeatThreshold != null ? cfg.liveBoomHeatThreshold : 70)) boomChance *= 2;
            if (heat <= (cfg.liveFlipHeatThreshold != null ? cfg.liveFlipHeatThreshold : 25)) flipChance *= 2;
            const roll = Math.random();
            if (roll < boomChance) return _triggerBoom();
            if (roll < boomChance + flipChance) return _triggerFlip();
            return { triggered: false, reason: 'no-roll' };
        }

        // 强制触发（测试/调试）
        if (forceType === 'boom') return _triggerBoom();
        if (forceType === 'flip') return _triggerFlip();
        return { triggered: false, reason: 'bad-force' };
    }

    // 正面事件：口才爆发 → 爆单（订单×3，未补货缩水 50%）
    function _triggerBoom() {
        const state = liveState.getState();
        const cfg = (typeof LIVE_CONFIG !== 'undefined') ? LIVE_CONFIG : {};
        if (!state.isLive || state.status !== LIVE_STATUS.live) return { triggered: false };

        // 随机选一个在播商品作为爆单品
        const listings = (_gameState.state.listings || []).filter(l => l.status === 'active');
        let pool = listings;
        if (state.productIds && state.productIds.length > 0) {
            const picked = listings.filter(l => state.productIds.includes(l.productId));
            if (picked.length > 0) pool = picked;
        }
        if (pool.length === 0) return { triggered: false, reason: 'no-listing' };
        const listing = pool[Math.floor(Math.random() * pool.length)];
        const product = (typeof PRODUCTS !== 'undefined') ? PRODUCTS.find(p => p.id === listing.productId) : null;
        const productName = product ? product.name : listing.title || '在售商品';

        // 爆单有效期：当前游戏时间 + 1 游戏小时
        const gt = _gameState.state.gameTime;
        let expiresDay = gt ? (gt.day || 1) : 1;
        let expiresHour = gt ? (gt.hour || 0) : 0;
        expiresHour += 1;
        if (expiresHour >= 24) { expiresHour -= 24; expiresDay++; }

        state.boom = { productId: listing.productId, productName, restocked: false, expiresDay, expiresHour };
        state.eventCount = (state.eventCount || 0) + 1;
        state.eventCooldown = cfg.liveBoomCooldownTicks != null ? cfg.liveBoomCooldownTicks : 20;

        const mult = cfg.liveBoomMultiplier != null ? cfg.liveBoomMultiplier : 3;
        liveState.addEventLog({ type: 'positive', eventId: 'eloquence_boom', name: '口才爆发', icon: '💥', day: gt ? gt.day : 1, hour: gt ? gt.hour : 0, detail: `「${productName}」订单×${mult}`, productId: listing.productId });
        liveState.addSystemMessage(`💥 口才爆发！「${productName}」订单 ×${mult}（快去看看库存！）`);
        _notifyUpdate();
        return { triggered: true, type: 'boom', productId: listing.productId };
    }

    // 负面事件：直播翻车 → 掉粉 + 热度惩罚，进入危机公关
    function _triggerFlip() {
        const state = liveState.getState();
        const cfg = (typeof LIVE_CONFIG !== 'undefined') ? LIVE_CONFIG : {};
        if (!state.isLive || state.status !== LIVE_STATUS.live) return { triggered: false };

        const lossArr = cfg.liveFlipFanLoss || [0.03, 0.08];
        const ratio = lossArr[0] + Math.random() * (lossArr[1] - lossArr[0]);
        const lost = liveState.applyFanLossRatio(ratio);
        const penalty = cfg.liveFlipHeatPenalty != null ? cfg.liveFlipHeatPenalty : 20;
        state.heat = Math.max(0, state.heat - penalty);
        state.activeEvent = { id: 'live_flip', type: 'flip', lostFans: lost, haterBase: lost };
        state.eventCount = (state.eventCount || 0) + 1;

        const gt = _gameState.state.gameTime;
        liveState.addEventLog({ type: 'negative', eventId: 'live_flip', name: '直播翻车', icon: '😱', day: gt ? gt.day : 1, hour: gt ? gt.hour : 0, detail: `掉粉 ${lost}，热度 -${penalty}` });
        liveState.addSystemMessage(`😱 直播翻车！说错价格被观众刷屏，掉粉 ${lost}、热度 -${penalty}！`);
        liveState.addSystemMessage('🆘 请立即选择危机公关：道歉 / 发券 / 无视');
        _notifyUpdate();
        return { triggered: true, type: 'flip', lostFans: lost };
    }

    // 危机公关（0=道歉+解释, 1=发放优惠券, 2=无视）
    function crisisPR(option) {
        const state = liveState.getState();
        if (!state.isLive || state.status !== LIVE_STATUS.live) {
            return { success: false, message: '直播未进行中' };
        }
        const ev = state.activeEvent;
        if (!ev || ev.id !== 'live_flip') {
            return { success: false, message: '当前没有待处理的公关事件' };
        }
        const cfg = (typeof LIVE_CONFIG !== 'undefined') ? LIVE_CONFIG : {};
        const haterBase = ev.haterBase || 0;
        const gt = _gameState.state.gameTime;
        let result;

        if (option === 0) {
            // 道歉+解释：50% 黑粉转铁粉，失败再小掉粉
            if (Math.random() < (cfg.prApologySuccess != null ? cfg.prApologySuccess : 0.5)) {
                const converted = liveState.convertHatersToLoyal(1, haterBase);
                result = { outcome: 'apology_success', converted, message: `💛 真诚道歉打动了大家，${converted} 位黑粉转铁粉！` };
                liveState.addSystemMessage(result.message);
            } else {
                const lost = liveState.applyFanLossRatio(cfg.prApologyFailLoss != null ? cfg.prApologyFailLoss : 0.01);
                result = { outcome: 'apology_fail', lost, message: `😢 道歉没被接受，又掉了 ${lost} 粉` };
                liveState.addSystemMessage(result.message);
            }
        } else if (option === 1) {
            // 发放优惠券：花 ¥500，热度+15，黑粉 30% 转铁粉
            const cost = cfg.prCouponCost != null ? cfg.prCouponCost : 500;
            if (typeof _gameState.spendFunds === 'function' && !_gameState.spendFunds(cost, '直播危机公关：发放优惠券')) {
                return { success: false, message: '资金不足，发券失败（欠款已达上限）' };
            }
            const heatGain = cfg.prCouponHeatGain != null ? cfg.prCouponHeatGain : 15;
            const maxHeat = cfg.maxHeat != null ? cfg.maxHeat : 100;
            state.heat = Math.min(maxHeat, state.heat + heatGain);
            const converted = liveState.convertHatersToLoyal(cfg.prCouponHaterToLoyal != null ? cfg.prCouponHaterToLoyal : 0.30, haterBase);
            result = { outcome: 'coupon', converted, message: `🎟️ 发出优惠券，热度 +${heatGain}，${converted} 位黑粉转铁粉！` };
            liveState.addSystemMessage(result.message);
        } else {
            // 无视：热度再 -10
            const penalty = cfg.prIgnoreHeatPenalty != null ? cfg.prIgnoreHeatPenalty : 10;
            state.heat = Math.max(0, state.heat - penalty);
            result = { outcome: 'ignore', message: `😐 无视了节奏，热度 -${penalty}` };
            liveState.addSystemMessage(result.message);
        }

        liveState.addEventLog({ type: 'pr', eventId: 'crisis_pr', option, day: gt ? gt.day : 1, hour: gt ? gt.hour : 0, detail: result.message, outcome: result.outcome });
        state.activeEvent = null;
        _notifyUpdate();
        return { success: true, ...result };
    }

    // 紧急补货：爆单品一键加急采购（联动供应链），补上则爆单全额兑现
    function urgentRestock() {
        const state = liveState.getState();
        if (!state.isLive || state.status !== LIVE_STATUS.live) {
            return { success: false, message: '直播未进行中' };
        }
        if (!state.boom) {
            return { success: false, message: '当前没有需要补货的爆单' };
        }
        if (state.boom.restocked) {
            return { success: false, message: '已补货，爆单全额兑现中' };
        }
        const cfg = (typeof LIVE_CONFIG !== 'undefined') ? LIVE_CONFIG : {};
        const product = (typeof PRODUCTS !== 'undefined') ? PRODUCTS.find(p => p.id === state.boom.productId) : null;
        if (!product) return { success: false, message: '商品数据缺失' };

        // 找该品类最优供应商（解锁 + 价格最低）
        const shopLevel = (_gameState.state.shop && _gameState.state.shop.level) || 1;
        let suppliers = (typeof SUPPLIERS !== 'undefined') ? SUPPLIERS.filter(s =>
            s && s.unlockLevel <= shopLevel && Array.isArray(s.categories) && s.categories.includes(product.category)
        ) : [];
        if (suppliers.length === 0) return { success: false, message: '暂无该品类的可用供应商' };
        suppliers.sort((a, b) => (a.priceMultiplier || 1) - (b.priceMultiplier || 1));
        const supplier = suppliers[0];

        const qty = cfg.liveBoomRestockQty != null ? cfg.liveBoomRestockQty : 50;
        const unitPrice = Math.round(product.basePrice * (supplier.priceMultiplier || 1) * 100) / 100;
        const totalCost = Math.round(unitPrice * qty * 100) / 100;
        if (typeof _gameState.spendFunds === 'function' && !_gameState.spendFunds(totalCost, `直播爆单紧急补货：${product.name} x${qty}`)) {
            return { success: false, message: '资金不足，无法紧急补货（欠款已达上限）' };
        }

        try {
            if (typeof _gameState.addPurchaseOrder === 'function') {
                _gameState.addPurchaseOrder({
                    productId: product.id,
                    supplierId: supplier.id,
                    productName: product.name,
                    quantity: qty,
                    unitPrice: unitPrice,
                    listUnitPrice: unitPrice,
                    qtyDiscount: 1,
                    totalAmount: totalCost,
                    quality: supplier.qualityBase || 70,
                    qualityGrade: 'B',
                    deliveryDays: supplier.deliveryDays || 3
                });
            }
        } catch (e) {
            console.warn('[LiveEngine.urgentRestock] 下单异常', e);
            return { success: false, message: '下单异常：' + (e && e.message) };
        }

        state.boom.restocked = true;
        const gt = _gameState.state.gameTime;
        liveState.addEventLog({ type: 'restock', eventId: 'urgent_restock', day: gt ? gt.day : 1, hour: gt ? gt.hour : 0, detail: `${product.name} x${qty}，¥${totalCost.toFixed(0)}` });
        liveState.addSystemMessage(`📦 已紧急补货「${product.name}」x${qty}（¥${totalCost.toFixed(0)}），爆单全额兑现！预计 ${supplier.deliveryDays || 3} 天到货`);
        _notifyUpdate();
        return { success: true, message: `紧急补货成功：${product.name} x${qty}`, qty, totalCost, deliveryDays: supplier.deliveryDays || 3 };
    }

    // 生成模拟弹幕
    function _generateDanmaku() {
        if (_isGamePaused()) return;
        const state = liveState.getState();
        if (!state.isLive || state.status !== LIVE_STATUS.live) return;
        if (!state.settings.enableDanmaku) return;

        // 根据观众数决定弹幕频率
        const viewerFactor = Math.min(1, state.viewers / 200);
        const phaseFactor = { warmup: 0.5, rising: 0.8, peak: 1.2, declining: 0.7 }[_currentPhase] || 1;
        // P1：铁粉更活跃——每 5000 铁粉 +30% 弹幕概率（封顶）
        let fanBoost = 0;
        try {
            const fans = liveState.getFans();
            fanBoost = Math.min(0.3, (fans.loyal || 0) / 5000);
        } catch (_) {}
        
        if (Math.random() > Math.min(1, viewerFactor * phaseFactor + fanBoost)) return;

        const content = MOCK_DANMAKU_CONTENT[Math.floor(Math.random() * MOCK_DANMAKU_CONTENT.length)];
        const viewerName = MOCK_VIEWER_NAMES[Math.floor(Math.random() * MOCK_VIEWER_NAMES.length)];
        
        // 随机弹幕类型
        let type = 'normal';
        let color = DANMAKU_TYPES.normal.color;
        
        const rand = Math.random();
        if (rand < 0.05) {
            type = 'fan';
            color = DANMAKU_TYPES.fan.color;
        } else if (rand < 0.1) {
            type = 'vip';
            color = DANMAKU_TYPES.vip.color;
        }

        liveState.addDanmaku({
            type: type,
            userName: viewerName,
            content: content,
            color: color,
            avatar: '👤'
        });
    }

    // 生成模拟礼物
    function _generateGifts() {
        if (_isGamePaused()) return;
        const state = liveState.getState();
        if (!state.isLive || state.status !== LIVE_STATUS.live) return;
        if (!state.settings.enableGifts) return;

        const streamer = liveState.getCurrentStreamer();
        const giftProbability = streamer.giftRate * state.viewers / 100 * ({
            warmup: 0.5, rising: 0.8, peak: 1.5, declining: 0.6
        }[_currentPhase] || 1);
        
        if (Math.random() > giftProbability) return;

        // 根据观众数决定礼物档次
        let giftIndex = 0;
        const rand = Math.random();
        if (rand < 0.01 && state.viewers > 500) {
            giftIndex = 5; // 龙腾四海
        } else if (rand < 0.03 && state.viewers > 200) {
            giftIndex = 4; // 豪华城堡
        } else if (rand < 0.08 && state.viewers > 100) {
            giftIndex = 3; // 皇冠
        } else if (rand < 0.15) {
            giftIndex = 2; // 小火箭
        } else if (rand < 0.4) {
            giftIndex = 1; // 鲜花
        } else {
            giftIndex = 0; // 小心心
        }

        const gift = LIVE_GIFTS[giftIndex];
        sendGift(gift.id);
    }

    // 生成模拟销售
    function _generateSales() {
        if (_isGamePaused()) return;
        const state = liveState.getState();
        if (!state.isLive || state.status !== LIVE_STATUS.live) return;

        const streamer = liveState.getCurrentStreamer();
        const scene = liveState.getCurrentScene();
        const listings = _gameState.state.listings || [];
        
        if (listings.length === 0) return;

        // 获取可售商品（直播选品或全部上架商品）
        let availableProducts = listings.filter(l => l.status === 'active');
        if (state.productIds && state.productIds.length > 0) {
            availableProducts = availableProducts.filter(l => state.productIds.includes(l.productId));
        }
        
        if (availableProducts.length === 0) return;

        // 转化率计算
        const baseConversion = 0.02; // 基础转化率2%
        const streamerConversion = streamer.conversionBonus;
        const sceneConversion = scene?.conversionBonus || 1;
        const discountConversion = state.settings.showDiscount ? (1 + (1 - state.settings.discountRate) * 3) : 1;
        const phaseConversion = { warmup: 0.6, rising: 1.0, peak: 1.5, declining: 0.8 }[_currentPhase] || 1;
        
        const conversionRate = baseConversion * streamerConversion * sceneConversion * discountConversion * phaseConversion;
        
        // 基于观众数计算订单量
        const orderProbability = Math.min(0.8, state.viewers * conversionRate / 100);
        
        if (Math.random() > orderProbability) return;

        // 随机选择一个商品
        const listing = availableProducts[Math.floor(Math.random() * availableProducts.length)];
        const product = PRODUCTS ? PRODUCTS.find(p => p.id === listing.productId) : null;
        if (!product) return;

        // 计算价格（考虑直播折扣）
        let price = listing.price || product.basePrice;
        if (state.settings.showDiscount) {
            price = price * state.settings.discountRate;
        }
        if (scene?.pricePenalty) {
            price = price * scene.pricePenalty;
        }

        // 随机购买数量
        const quantity = Math.random() < 0.8 ? 1 : (Math.random() < 0.8 ? 2 : 3);
        const amount = price * quantity;

        // ⚠️ 不再在此直接 addFunds：真实订单/扣库存/入账由 gameEngine.processLivestream 统一处理。
        // 这里只发弹幕氛围，避免「无库存刷钱 + 与引擎订单双重入账」。
        const viewerName = MOCK_VIEWER_NAMES[Math.floor(Math.random() * MOCK_VIEWER_NAMES.length)];
        liveState.addDanmaku({
            type: 'system',
            userName: '系统',
            content: `👀 ${viewerName} 正在浏览 ${product.name}`,
            color: '#ff6b35'
        });

        // 如果是限时秒杀场景，库存减少
        if (scene?.id === 'flash_sale') {
            // 秒杀商品库存快速消耗
        }
    }

    // 通知UI更新
    function _notifyUpdate() {
        if (_ui && typeof _ui.refreshPage === 'function') {
            // 只有在直播页面时才刷新
            if (_ui.currentTab === 'livestream') {
                _ui.refreshPage();
            }
        }
        try {
            if (typeof liveUI !== 'undefined' && liveUI && typeof liveUI.onLiveTick === 'function') {
                liveUI.onLiveTick();
            }
        } catch (_) {}
        
        // 触发事件总线
        if (typeof eventBus !== 'undefined') {
            eventBus.emit('liveStateUpdated', liveState.getState());
        }
    }

    // 获取直播流量加成（供游戏引擎调用）
    function getTrafficBonus() {
        const state = liveState.getState();
        if (!state.isLive) return 1;
        
        const streamer = liveState.getCurrentStreamer();
        const scene = liveState.getCurrentScene();
        
        let bonus = streamer ? streamer.trafficBonus : 1;
        if (scene && scene.trafficBonus) bonus *= scene.trafficBonus;
        
        return bonus;
    }

    // 获取直播转化加成（供游戏引擎调用）
    function getConversionBonus() {
        const state = liveState.getState();
        if (!state.isLive) return 1;
        
        const streamer = liveState.getCurrentStreamer();
        const scene = liveState.getCurrentScene();
        
        let bonus = streamer ? streamer.conversionBonus : 1;
        if (scene && scene.conversionBonus) bonus *= scene.conversionBonus;
        if (state.settings.showDiscount) bonus *= 1.2;
        
        return bonus;
    }

    // 获取直播折扣（供游戏引擎调用）
    function getDiscountMultiplier() {
        const state = liveState.getState();
        if (!state.isLive || !state.settings.showDiscount) return 1;
        return state.settings.discountRate;
    }

    // 导出API
    return {
        init,
        startLive,
        endLive,
        pauseLive,
        resumeLive,
        sendDanmaku,
        sendGift,
        addLike,
        shareLive,
        switchProduct,
        updateSettings,
        getTrafficBonus,
        getConversionBonus,
        getDiscountMultiplier,
        // IP养成（P0）：互动
        tapHeat,
        answerQuestion,
        // P2：随机事件
        tryTriggerEvent: _tickEvents,
        crisisPR,
        urgentRestock
    };
})();

// 导出到全局
if (typeof window !== 'undefined') {
    window.liveEngine = liveEngine;
}
