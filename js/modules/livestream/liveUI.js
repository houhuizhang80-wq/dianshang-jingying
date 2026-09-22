// ============================================================================
// 直播中心系统 - UI层
// 负责：直播页面渲染、弹窗、弹幕动画、交互处理
// ============================================================================

const liveUI = (function() {
    'use strict';

    let _gameState = null;
    let _ui = null;
    let _danmakuContainer = null;
    let _autoScrollDanmaku = true;

    // 初始化UI
    function init(gameStateInstance, uiManager) {
        _gameState = gameStateInstance;
        _ui = uiManager;
        try {
            if (typeof liveState !== 'undefined' && typeof liveState.init === 'function') {
                liveState.init(gameStateInstance);
            }
        } catch (_) {}
        console.log('[LiveUI] 直播UI模块初始化完成');
    }

    // 渲染直播中心主页面（覆盖旧的renderLivestreamModal）
    function renderLivePage(state) {
        const ls = (state && state.livestream) || (typeof liveState !== 'undefined' && liveState.getState && liveState.getState());
        if (!ls) {
            return '<div style="padding:24px;text-align:center;color:#c62828;">直播状态未初始化，请关闭后重开</div>';
        }
        const currentTab = ls.ui?.activeTab || 'overview';
        
        const tabs = [
            { id: 'overview', name: '📺 直播间', badge: ls.isLive ? 'LIVE' : 0 },
            { id: 'create', name: '🎬 创建直播', badge: 0 },
            { id: 'history', name: '📋 历史记录', badge: ls.history?.length || 0 },
            { id: 'review', name: '🧠 直播复盘', badge: 0 },
            { id: 'stats', name: '📊 数据统计', badge: 0 },
            { id: 'achievements', name: '🏆 成就', badge: ls.achievements?.length || 0 }
        ];

        return `
            <div class="page" id="liveCenterPage">
                ${_renderLiveHeader(ls)}
                
                <div class="tabs" style="position:sticky;top:0;z-index:10;background:white;padding:8px 0;">
                    ${tabs.map(tab => `
                        <div class="tab-item ${currentTab === tab.id ? 'active' : ''}" 
                             onclick="liveUI.switchTab('${tab.id}')"
                             style="position:relative;">
                            ${tab.name}
                            ${tab.badge ? `<span class="badge badge-red" style="position:absolute;top:-2px;right:-8px;font-size:9px;padding:1px 4px;${tab.badge === 'LIVE' ? 'background:#f44336;animation:pulse 1s infinite;' : ''}">${tab.badge}</span>` : ''}
                        </div>
                    `).join('')}
                </div>

                <div id="liveTabContent">
                    ${currentTab === 'overview' ? _renderLiveRoom(ls) : ''}
                    ${currentTab === 'create' ? _renderCreateLive(ls) : ''}
                    ${currentTab === 'history' ? _renderHistory(ls) : ''}
                    ${currentTab === 'review' ? _renderReview(ls) : ''}
                    ${currentTab === 'stats' ? _renderStats(ls) : ''}
                    ${currentTab === 'achievements' ? _renderAchievements(ls) : ''}
                </div>
            </div>
        `;
    }

    // 渲染直播页面头部
    function _renderLiveHeader(ls) {
        const viewerLevel = liveState.getViewerLevel();
        const stats = liveState.getStatistics();
        
        return `
            <div class="card" style="margin-bottom:12px;padding:15px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                    <div>
                        <div style="font-size:18px;font-weight:bold;display:flex;align-items:center;gap:8px;">
                            🎥 直播中心
                            ${ls.isLive ? `<span style="background:#f44336;padding:2px 8px;border-radius:10px;font-size:11px;animation:pulse 1s infinite;">🔴 LIVE</span>` : ''}
                        </div>
                        <div style="font-size:12px;opacity:0.9;margin-top:4px;">
                            ${ls.isLive ? `${ls.title || '直播中'} · ${liveState.getFormattedDuration()}` : `累计直播 ${stats.totalStreams} 场`}
                        </div>
                    </div>
                    <div style="text-align:right;">
                        <div data-live-viewers style="font-size:24px;font-weight:bold;">${ls.isLive ? ls.viewers : stats.totalViewers}</div>
                        <div style="font-size:11px;opacity:0.8;">${ls.isLive ? '当前观众' : '累计观看'}</div>
                    </div>
                </div>
                
                ${ls.isLive ? `
                    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:15px;padding-top:15px;border-top:1px solid rgba(255,255,255,0.2);">
                        <div style="text-align:center;">
                            <div style="font-size:16px;font-weight:bold;">${ls.peakViewers}</div>
                            <div style="font-size:10px;opacity:0.8;">峰值人气</div>
                        </div>
                        <div style="text-align:center;">
                            <div style="font-size:16px;font-weight:bold;">¥${formatMoney(ls.totalSales)}</div>
                            <div style="font-size:10px;opacity:0.8;">直播销售额</div>
                        </div>
                        <div style="text-align:center;">
                            <div style="font-size:16px;font-weight:bold;">¥${formatMoney(ls.giftIncome)}</div>
                            <div style="font-size:10px;opacity:0.8;">礼物收入</div>
                        </div>
                        <div style="text-align:center;">
                            <div style="font-size:16px;font-weight:bold;">${ls.likes}</div>
                            <div style="font-size:10px;opacity:0.8;">点赞数</div>
                        </div>
                    </div>
                ` : `
                    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:15px;padding-top:15px;border-top:1px solid rgba(255,255,255,0.2);">
                        <div style="text-align:center;">
                            <div style="font-size:16px;font-weight:bold;">${stats.totalStreams}</div>
                            <div style="font-size:10px;opacity:0.8;">直播场次</div>
                        </div>
                        <div style="text-align:center;">
                            <div style="font-size:16px;font-weight:bold;">¥${formatMoney(stats.totalSales)}</div>
                            <div style="font-size:10px;opacity:0.8;">累计销售额</div>
                        </div>
                        <div style="text-align:center;">
                            <div style="font-size:16px;font-weight:bold;">¥${formatMoney(stats.totalGifts)}</div>
                            <div style="font-size:10px;opacity:0.8;">礼物总收入</div>
                        </div>
                    </div>
                `}
            </div>
        `;
    }

    // 渲染直播间（直播中/准备开播）
    function _renderLiveRoom(ls) {
        if (ls.isLive && ls.status === LIVE_STATUS.live) {
            return _renderLiveStreaming(ls);
        } else if (ls.status === LIVE_STATUS.paused) {
            return _renderLivePaused(ls);
        } else {
            return _renderLiveIdle(ls);
        }
    }

    // 渲染空闲状态（未开播；P0：粉丝资产 + 今日状态）
    function _renderLiveIdle(ls) {
        const latestHistory = ls.history?.[0];
        const fans = liveState.getFans();
        const quota = liveState.getDailyQuota();
        const remaining = quota.remaining;
        const settlement = ls.settlement;
        
        return `
            <div style="display:flex;flex-direction:column;gap:12px;">
                <!-- 直播预览区 -->
                <div class="card" style="padding:0;overflow:hidden;">
                    <div style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);aspect-ratio:16/9;display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;position:relative;">
                        <div style="font-size:64px;margin-bottom:16px;">🎥</div>
                        <div style="font-size:18px;font-weight:bold;margin-bottom:8px;">准备开始直播</div>
                        <div style="font-size:12px;opacity:0.7;">亲手开播养 IP，粉丝沉淀成店铺资产</div>
                        
                        <!-- 装饰元素 -->
                        <div style="position:absolute;top:20px;left:20px;display:flex;gap:8px;">
                            <div style="width:10px;height:10px;background:#ff4757;border-radius:50%;"></div>
                            <div style="width:10px;height:10px;background:#ffa502;border-radius:50%;"></div>
                            <div style="width:10px;height:10px;background:#2ed573;border-radius:50%;"></div>
                        </div>
                    </div>
                </div>

                <!-- 今日直播 -->
                <button class="btn btn-primary" style="width:100%;padding:15px;font-size:16px;" onclick="liveUI.switchTab('create')">
                    ${remaining > 0 ? `🎬 立即开播（今日剩余 ${remaining} 次）` : '📅 今日直播次数已用完'}
                </button>
                ${remaining <= 0 ? `<button class="btn btn-secondary" style="width:100%;padding:12px;font-size:14px;" onclick="liveUI.watchAdForLiveQuota()">📺 看广告再开播 +1 次</button>` : ''}

                <!-- 粉丝资产 -->
                <div class="card" style="padding:15px;">
                    <div style="font-size:14px;font-weight:bold;margin-bottom:12px;">👥 我的粉丝</div>
                    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;text-align:center;">
                        <div style="padding:12px;background:#e3f2fd;border-radius:10px;">
                            <div style="font-size:22px;font-weight:bold;color:#2196f3;">${fans.casual || 0}</div>
                            <div style="font-size:11px;color:#666;margin-top:2px;">路人粉</div>
                        </div>
                        <div style="padding:12px;background:#fff3e0;border-radius:10px;">
                            <div style="font-size:22px;font-weight:bold;color:#ff9800;">${fans.loyal || 0}</div>
                            <div style="font-size:11px;color:#666;margin-top:2px;">铁粉</div>
                        </div>
                        <div style="padding:12px;background:#f3e5f5;border-radius:10px;">
                            <div style="font-size:22px;font-weight:bold;color:#9c27b0;">${fans.true || 0}</div>
                            <div style="font-size:11px;color:#666;margin-top:2px;">真爱粉</div>
                        </div>
                    </div>
                    <div style="font-size:11px;color:#999;margin-top:10px;line-height:1.8;">
                        <div>👤 路人粉：基础流量，每 100 人带来微量免费曝光</div>
                        <div>💛 铁粉：每天口口相传，每 100 人带来自然搜索流量</div>
                        <div>💜 真爱粉：解锁粉丝群，开播自动涌入（保底观众+热度）</div>
                    </div>
                </div>

                <!-- 粉丝群（真爱粉解锁）-->
                ${(fans.true || 0) > 0 ? `
                    <div class="card" style="padding:15px;background:linear-gradient(135deg,#f3e5f5,#fce4ec);">
                        <div style="display:flex;align-items:center;gap:10px;">
                            <div style="font-size:32px;">💜</div>
                            <div style="flex:1;">
                                <div style="font-size:14px;font-weight:bold;color:#4a148c;">粉丝群（${fans.true} 位真爱粉）</div>
                                <div style="font-size:11px;color:#6a1b9a;margin-top:2px;">开播时自动涌入 · 每人 +${typeof LIVE_CONFIG !== 'undefined' ? LIVE_CONFIG.trueFanBaselineViewers : 2} 初始观众 · 保底热度 +${typeof LIVE_CONFIG !== 'undefined' ? LIVE_CONFIG.trueFanBaselineHeat : 10}</div>
                            </div>
                            <span style="font-size:10px;color:#9c27b0;background:#fff;padding:3px 8px;border-radius:10px;">已解锁</span>
                        </div>
                    </div>
                ` : `
                    <div class="card" style="padding:12px;text-align:center;background:#fafafa;">
                        <div style="font-size:11px;color:#999;">🔒 粉丝群未解锁 · 累计直播 ${(ls.totalStats && ls.totalStats.totalStreams) || 0}/${typeof LIVE_CONFIG !== 'undefined' ? LIVE_CONFIG.trueUpgradeMinStreams : 10} 场 或 累计销售额 ¥${Math.floor((ls.totalStats && ls.totalStats.totalSales) || 0)}/${typeof LIVE_CONFIG !== 'undefined' ? LIVE_CONFIG.trueUpgradeMinSales : 500} 后解锁</div>
                    </div>
                `}

                <!-- 最近一场结算 -->
                ${settlement ? `
                    <div class="card" style="padding:15px;background:linear-gradient(135deg,#43e97b20,#38f9d720);">
                        <div style="font-size:14px;font-weight:bold;margin-bottom:10px;">📊 最近一场直播</div>
                        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;font-size:12px;color:#333;">
                            <div>🎯 话题：${settlement.topicName}</div>
                            <div>🔥 平均热度：${settlement.heatAvg}</div>
                            <div>⭐ 涨粉：<b style="color:#e91e63;">+${settlement.fansGained}</b></div>
                            ${settlement.loyalUp ? `<div>💛 升级铁粉：<b style="color:#ff9800;">+${settlement.loyalUp}</b></div>` : ''}
                            ${settlement.trueUp ? `<div>💜 升级真爱：<b style="color:#9c27b0;">+${settlement.trueUp}</b></div>` : ''}
                            <div>🎁 活跃粉丝：<b style="color:#ff9800;">${settlement.activeFans} 人</b>（${settlement.activeFanWindowHours}h 自动带单）</div>
                            <div>💵 销售额：¥${formatMoney(settlement.totalSales)}</div>
                            <div>📦 订单：${settlement.orderCount} 单</div>
                        </div>
                    </div>
                ` : ''}

                <!-- 最近直播 -->
                ${latestHistory ? `
                    <div class="card" style="padding:15px;">
                        <div style="font-size:14px;font-weight:bold;margin-bottom:12px;">📺 最近一场直播</div>
                        <div style="display:flex;gap:12px;align-items:center;">
                            <div style="width:80px;height:60px;background:linear-gradient(135deg,#667eea,#764ba2);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:28px;">
                                🎬
                            </div>
                            <div style="flex:1;">
                                <div style="font-size:13px;font-weight:bold;color:#333;">${latestHistory.title}</div>
                                <div style="font-size:11px;color:#999;margin-top:2px;">
                                    ${Math.floor(latestHistory.duration)}分钟 · ${latestHistory.peakViewers}人观看
                                </div>
                                <div style="font-size:12px;color:#4caf50;margin-top:4px;">
                                    销售额 ¥${formatMoney(latestHistory.totalSales)} · 涨粉 +${latestHistory.fansGained || 0}
                                </div>
                            </div>
                        </div>
                    </div>
                ` : ''}

                <!-- 直播攻略 -->
                <div class="card" style="padding:15px;">
                    <div style="font-size:14px;font-weight:bold;margin-bottom:12px;">💡 直播小技巧</div>
                    <div style="font-size:12px;color:#666;line-height:1.8;">
                        <div>• 选对话题：人货匹配（话题×商品品类一致）转化更高</div>
                        <div>• 保持热度：多点热度、多答弹幕题，热度越高涨粉越快</div>
                        <div>• 别挂机：热度会随时间衰减，挂机收益趋零</div>
                        <div>• 每天 1 次：直播后活跃粉丝持续数小时自动带单</div>
                        <div>• 开启折扣能提升转化率</div>
                    </div>
                </div>
            </div>
        `;
    }

    // 渲染直播中界面
    function _renderLiveStreaming(ls) {
        const streamer = liveState.getCurrentStreamer();
        const scene = liveState.getCurrentScene();
        const viewerLevel = liveState.getViewerLevel();
        const danmakus = liveState.getDanmakus(50);
        const progress = Math.min(100, (ls.duration / ls.plannedDuration) * 100);
        
        // 获取当前商品
        const listings = _gameState.state.listings || [];
        let currentProducts = listings.filter(l => l.status === 'active');
        if (ls.productIds && ls.productIds.length > 0) {
            currentProducts = currentProducts.filter(l => ls.productIds.includes(l.productId));
        }
        
        return `
            <div style="display:flex;flex-direction:column;gap:10px;">
                <!-- 直播画面区 -->
                <div class="card" style="padding:0;overflow:hidden;position:relative;">
                    <div id="liveVideoArea" style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);aspect-ratio:16/10;position:relative;overflow:hidden;">
                        <!-- 模拟主播画面 -->
                        <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;">
                            <div style="font-size:80px;animation:bounce 2s infinite;">${streamer?.icon || '🎥'}</div>
                            <div style="color:white;font-size:14px;margin-top:10px;font-weight:bold;">${streamer?.name || '主播'}</div>
                            <div style="color:rgba(255,255,255,0.7);font-size:11px;margin-top:4px;">${scene?.name || '直播中'}</div>
                        </div>
                        
                        <!-- 直播状态信息 -->
                        <div style="position:absolute;top:10px;left:10px;display:flex;gap:8px;align-items:center;">
                            <span style="background:#f44336;color:white;padding:4px 10px;border-radius:12px;font-size:11px;font-weight:bold;display:flex;align-items:center;gap:4px;">
                                <span style="width:6px;height:6px;background:white;border-radius:50%;animation:pulse 1s infinite;"></span>
                                LIVE
                            </span>
                            <span data-live-viewers-badge style="background:rgba(0,0,0,0.6);color:white;padding:4px 10px;border-radius:12px;font-size:11px;">
                                👥 ${ls.viewers}
                            </span>
                        </div>
                        
                        <div style="position:absolute;top:10px;right:10px;">
                            <span data-live-duration-badge style="background:rgba(0,0,0,0.6);color:white;padding:4px 10px;border-radius:12px;font-size:11px;">
                                ⏱️ ${Math.floor(ls.duration)}分
                            </span>
                        </div>
                        
                        <!-- 弹幕区域 -->
                        <div id="danmakuContainer" style="position:absolute;bottom:80px;left:0;right:120px;height:200px;overflow:hidden;pointer-events:none;">
                            ${_renderDanmakus(danmakus)}
                        </div>
                        
                        <!-- 点赞动画区域 -->
                        <div id="likeAnimationArea" style="position:absolute;bottom:80px;right:10px;width:60px;height:200px;pointer-events:none;"></div>
                        
                        <!-- 底部商品栏 -->
                        <div style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(0,0,0,0.8));padding:10px;">
                            <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;">
                                ${currentProducts.slice(0, 10).map((p, i) => {
                                    const product = PRODUCTS ? PRODUCTS.find(pr => pr.id === p.productId) : null;
                                    if (!product) return '';
                                    const isCurrent = i === (ls.currentProductIndex || 0);
                                    const price = ls.settings.showDiscount ? (p.price * ls.settings.discountRate) : p.price;
                                    let icon = product.icon || '📦';
                                    if (typeof getProductIconInfo === 'function') {
                                        const info = getProductIconInfo(product.id, product.name, product.category);
                                        if (info && info.emoji) icon = info.emoji;
                                    }
                                    return `
                                        <div style="min-width:86px;background:${isCurrent ? 'rgba(255,107,53,0.95)' : 'rgba(255,255,255,0.2)'};border-radius:8px;padding:8px;text-align:center;cursor:pointer;border:${isCurrent ? '2px solid #ffd54f' : '2px solid transparent'};"
                                             onclick="liveEngine.switchProduct(${i})">
                                            <div style="font-size:22px;">${icon}</div>
                                            <div style="color:white;font-size:10px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${product.name}</div>
                                            <div style="color:#ffd700;font-size:11px;font-weight:bold;">¥${price.toFixed(0)}</div>
                                            ${isCurrent ? '<div style="color:#fff;font-size:9px;margin-top:2px;">讲解中</div>' : ''}
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    </div>
                    
                    <!-- 操作按钮栏（礼物/结束；点赞/分享在互动区）-->
                    <div style="display:flex;gap:8px;padding:10px;background:#f5f5f5;">
                        <button class="btn btn-small" style="flex:1;padding:10px;" onclick="liveUI.leaveLiveRoom()">
                            📱 挂机返回
                        </button>
                        <button class="btn btn-small" style="flex:1;padding:10px;" onclick="liveUI.toggleGiftPanel()">
                            🎁 礼物
                        </button>
                        <button class="btn btn-small btn-danger" style="flex:1;padding:10px;" onclick="liveUI.confirmEndLive()">
                            ⏹️ 结束
                        </button>
                    </div>
                </div>
                
                <!-- 热度条 + 互动操作区（P0）-->
                <div class="card" style="padding:12px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <span style="font-size:13px;font-weight:bold;color:#333;">🔥 直播间热度</span>
                        <span style="font-size:13px;font-weight:bold;color:${ls.heat >= 80 ? '#f44336' : ls.heat >= 50 ? '#ff9800' : '#2196f3'};" id="liveHeatValue">${Math.round(ls.heat)}</span>
                    </div>
                    <div style="height:10px;background:#e0e0e0;border-radius:5px;overflow:hidden;">
                        <div style="height:100%;background:linear-gradient(90deg,#ff9800,#f44336);width:${Math.min(100, ls.heat || 0)}%;transition:width 0.3s;border-radius:5px;"></div>
                    </div>
                    <div style="font-size:10px;color:#999;margin-top:4px;">热度越高涨粉越快 · 挂机热度持续下降</div>
                    
                    <!-- 互动操作区 -->
                    <div style="display:flex;gap:8px;margin-top:10px;">
                        <button class="btn btn-small" style="flex:1;padding:10px;font-size:13px;background:linear-gradient(135deg,#ff9800,#f57c00);color:white;border:none;" onclick="liveUI.tapHeatUI()">
                            🔥 点热度
                        </button>
                        <button class="btn btn-small" style="flex:1;padding:10px;font-size:13px;background:#f5f5f5;" onclick="liveEngine.addLike(10);liveUI.showLikeAnimation();">
                            ❤️ 点赞
                        </button>
                        <button class="btn btn-small" style="flex:1;padding:10px;font-size:13px;background:#f5f5f5;" onclick="liveEngine.shareLive()">
                            📤 分享
                        </button>
                    </div>
                    
                    <!-- 弹幕互动题（2 选 1）-->
                    ${ls.currentQuestion ? `
                        <div style="margin-top:10px;padding:12px;background:linear-gradient(135deg,#667eea20,#764ba220);border-radius:10px;border:1px solid #667eea55;">
                            <div style="font-size:13px;font-weight:bold;color:#333;">💬 弹幕提问：${ls.currentQuestion.q}</div>
                            <div style="display:flex;gap:8px;margin-top:8px;">
                                ${ls.currentQuestion.options.map((opt, oi) => `
                                    <button class="btn btn-small" style="flex:1;padding:8px;font-size:12px;" onclick="liveUI.answerQuestionUI(${oi})">
                                        ${opt}
                                    </button>
                                `).join('')}
                            </div>
                            <div style="font-size:10px;color:#999;margin-top:6px;">答对 +热度 · 答错 -热度</div>
                        </div>
                    ` : ''}
                </div>
                
                <!-- P2：随机事件横幅 -->
                ${ls.activeEvent && ls.activeEvent.id === 'live_flip' ? `
                    <div class="card" style="padding:12px;background:#fff3f3;border:1px solid #f4433655;">
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span style="font-size:24px;">😱</span>
                            <div style="flex:1;">
                                <div style="font-size:13px;font-weight:bold;color:#c62828;">直播翻车！危机公关</div>
                                <div style="font-size:11px;color:#e57373;margin-top:2px;">已掉粉 ${ls.activeEvent.lostFans}，处理好了黑粉变铁粉</div>
                            </div>
                        </div>
                        <div style="display:flex;gap:8px;margin-top:10px;">
                            <button class="btn btn-small" style="flex:1;padding:8px;font-size:12px;background:#e3f2fd;" onclick="liveUI.crisisPRUI(0)">🙏 道歉+解释</button>
                            <button class="btn btn-small" style="flex:1;padding:8px;font-size:12px;background:#fff8e1;" onclick="liveUI.crisisPRUI(1)">🎟️ 发券挽回</button>
                            <button class="btn btn-small" style="flex:1;padding:8px;font-size:12px;" onclick="liveUI.crisisPRUI(2)">😐 无视</button>
                        </div>
                    </div>
                ` : ''}
                ${ls.boom && ls.boom.productId ? `
                    <div class="card" style="padding:12px;${ls.boom.restocked ? 'background:#e8f5e9;border:1px solid #4caf5055;' : 'background:#fff3e0;border:1px solid #ff980055;'}">
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span style="font-size:24px;">💥</span>
                            <div style="flex:1;">
                                <div style="font-size:13px;font-weight:bold;color:#e65100;">口才爆发！「${ls.boom.productName || '在售商品'}」爆单中</div>
                                <div style="font-size:11px;color:#999;margin-top:2px;">
                                    ${ls.boom.restocked ? '✅ 已补货，爆单 ×3 全额兑现' : '⚠️ 库存不足！未补货爆单将缩水（×1.5）'}
                                </div>
                            </div>
                            ${!ls.boom.restocked ? `
                                <button class="btn btn-small btn-primary" style="padding:8px 14px;font-size:12px;white-space:nowrap;" onclick="liveUI.urgentRestockUI()">
                                    📦 紧急补货
                                </button>
                            ` : ''}
                        </div>
                    </div>
                ` : ''}
                
                <!-- 进度条 -->
                <div class="card" style="padding:12px;">
                    <div style="display:flex;justify-content:space-between;font-size:12px;color:#666;margin-bottom:6px;">
                        <span>直播进度</span>
                        <span data-live-progress-text>${Math.floor(ls.duration)}分 / ${ls.plannedDuration}分</span>
                    </div>
                    <div style="height:8px;background:#e0e0e0;border-radius:4px;overflow:hidden;">
                        <div style="height:100%;background:linear-gradient(90deg,#667eea,#764ba2);width:${progress}%;transition:width 0.5s;border-radius:4px;"></div>
                    </div>
                </div>
                
                <!-- 实时数据 -->
                <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">
                    <div class="card" style="padding:12px;text-align:center;">
                        <div data-live-viewers-card style="font-size:20px;font-weight:bold;color:#2196f3;">${ls.viewers}</div>
                        <div style="font-size:11px;color:#999;">当前观众</div>
                    </div>
                    <div class="card" style="padding:12px;text-align:center;">
                        <div data-live-peak style="font-size:20px;font-weight:bold;color:#ff9800;">${ls.peakViewers}</div>
                        <div style="font-size:11px;color:#999;">峰值观众</div>
                    </div>
                    <div class="card" style="padding:12px;text-align:center;">
                        <div data-live-fans style="font-size:20px;font-weight:bold;color:#e91e63;">+${Math.floor(ls.fansGained || 0)}</div>
                        <div style="font-size:11px;color:#999;">本场涨粉</div>
                    </div>
                    <div class="card" style="padding:12px;text-align:center;">
                        <div style="font-size:20px;font-weight:bold;color:#4caf50;">¥${formatMoney(ls.totalSales)}</div>
                        <div style="font-size:11px;color:#999;">直播销售额</div>
                    </div>
                </div>
                
                <!-- 弹幕输入 -->
                <div class="card" style="padding:10px;">
                    <div style="display:flex;gap:8px;">
                        <input type="text" id="danmakuInput" class="input" placeholder="发送弹幕..." 
                               style="flex:1;padding:10px;border:1px solid #e0e0e0;border-radius:20px;font-size:13px;"
                               maxlength="50"
                               onkeypress="if(event.key==='Enter')liveUI.sendDanmaku()">
                        <button class="btn btn-primary" style="border-radius:20px;padding:0 20px;" onclick="liveUI.sendDanmaku()">
                            发送
                        </button>
                    </div>
                </div>
                
                <!-- 礼物面板（弹出） -->
                <div id="giftPanel" class="hidden" style="display:none;position:absolute;bottom:0;left:0;right:0;background:white;border-radius:16px 16px 0 0;padding:16px;z-index:5;box-shadow:0 -4px 20px rgba(0,0,0,0.2);">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">
                        <div style="font-size:16px;font-weight:bold;">🎁 送礼物</div>
                        <span style="font-size:20px;cursor:pointer;" onclick="liveUI.toggleGiftPanel()">✕</span>
                    </div>
                    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">
                        ${LIVE_GIFTS.map(g => `
                            <div style="padding:15px;border:2px solid #f0f0f0;border-radius:12px;text-align:center;cursor:pointer;transition:all 0.2s;"
                                 onclick="liveUI.sendGift('${g.id}')"
                                 onmouseover="this.style.borderColor='#667eea';this.style.transform='scale(1.02)'"
                                 onmouseout="this.style.borderColor='#f0f0f0';this.style.transform='scale(1)'">
                                <div style="font-size:36px;margin-bottom:6px;">${g.icon}</div>
                                <div style="font-size:12px;font-weight:bold;color:#333;">${g.name}</div>
                                <div style="font-size:11px;color:#ff6b35;margin-top:2px;">¥${g.price}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    // 渲染暂停状态
    function _renderLivePaused(ls) {
        return `
            <div style="display:flex;flex-direction:column;gap:12px;">
                <div class="card" style="padding:40px;text-align:center;">
                    <div style="font-size:64px;margin-bottom:16px;">⏸️</div>
                    <div style="font-size:18px;font-weight:bold;color:#333;margin-bottom:8px;">直播已暂停</div>
                    <div style="font-size:12px;color:#999;margin-bottom:20px;">主播正在休息，马上回来~</div>
                    <div style="display:flex;gap:10px;justify-content:center;">
                        <button class="btn btn-primary" onclick="liveEngine.resumeLive()">▶️ 恢复直播</button>
                        <button class="btn btn-danger" onclick="liveUI.confirmEndLive()">⏹️ 结束直播</button>
                    </div>
                </div>
                
                <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;">
                    <div class="card" style="padding:12px;text-align:center;">
                        <div style="font-size:18px;font-weight:bold;color:#2196f3;">${ls.viewers}</div>
                        <div style="font-size:10px;color:#999;">当前观众</div>
                    </div>
                    <div class="card" style="padding:12px;text-align:center;">
                        <div style="font-size:18px;font-weight:bold;color:#ff9800;">¥${formatMoney(ls.totalSales)}</div>
                        <div style="font-size:10px;color:#999;">销售额</div>
                    </div>
                    <div class="card" style="padding:12px;text-align:center;">
                        <div style="font-size:18px;font-weight:bold;color:#9c27b0;">¥${formatMoney(ls.giftIncome)}</div>
                        <div style="font-size:10px;color:#999;">礼物收入</div>
                    </div>
                    <div class="card" style="padding:12px;text-align:center;">
                        <div style="font-size:18px;font-weight:bold;">${Math.floor(ls.duration)}分</div>
                        <div style="font-size:10px;color:#999;">已直播</div>
                    </div>
                </div>
            </div>
        `;
    }

    // 渲染创建直播页面（P0：今日配额 + 亲自直播 + 话题选择 + 现实分钟时长）
    function _renderCreateLive(ls) {
        const streamers = liveState.getAvailableStreamers();
        const scenes = LIVE_SCENES;
        const listings = _gameState.state.listings || [];
        const activeListings = listings.filter(l => l.status === 'active');
        const cfg = (typeof LIVE_CONFIG !== 'undefined') ? LIVE_CONFIG : {};
        const durations = cfg.durations || [3, 6, 10];
        const topics = (typeof LIVE_TOPICS !== 'undefined') ? LIVE_TOPICS : [];
        const quota = liveState.getDailyQuota();
        const fans = liveState.getFans();
        const usedToday = quota.used || 0;
        const remaining = quota.remaining;
        const disabled = remaining <= 0;
        
        return `
            <div style="display:flex;flex-direction:column;gap:12px;">
                <!-- 今日直播配额 -->
                <div class="card" style="padding:15px;${disabled ? 'background:#fff3f3;' : 'background:linear-gradient(135deg,#667eea15,#764ba215);'}">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <div>
                            <div style="font-size:14px;font-weight:bold;color:#333;">📅 今日直播 <span style="color:#ff6b35;">${usedToday}/${quota.limit}</span></div>
                            <div style="font-size:11px;color:#999;margin-top:2px;">
                                ${disabled ? '今日次数已用完，可看广告 +1 次或等明日刷新' : '每天 1 次亲手直播，粉丝归你所有'}
                            </div>
                            ${disabled ? `<button class="btn btn-primary" style="margin-top:8px;" onclick="liveUI.watchAdForLiveQuota()">📺 看广告再开播</button>` : ''}
                        </div>
                        <div style="font-size:11px;color:#666;text-align:right;">
                            <div>👥 路人粉 <b style="color:#2196f3;">${fans.casual || 0}</b></div>
                            <div style="margin-top:2px;">🔥 铁粉 <b style="color:#ff9800;">${fans.loyal || 0}</b> · 💜 真爱 <b style="color:#9c27b0;">${fans.true || 0}</b></div>
                        </div>
                    </div>
                </div>
                
                <!-- 直播标题 -->
                <div class="card" style="padding:15px;">
                    <div style="font-size:14px;font-weight:bold;margin-bottom:10px;">📝 直播标题</div>
                    <input type="text" id="liveTitleInput" class="input" 
                           placeholder="给你的直播起个吸引人的标题吧"
                           value="${_gameState.state.shop.name}的直播间"
                           maxlength="30"
                           style="width:100%;padding:12px;border:1px solid #e0e0e0;border-radius:8px;font-size:14px;">
                </div>
                
                <!-- 选择主播（P3：亲自直播免费 / 助播花钱起量，不出单，粉丝仍归店主）-->
                <div class="card" style="padding:15px;">
                    <div style="font-size:14px;font-weight:bold;margin-bottom:4px;">👤 主播阵容</div>
                    <div style="font-size:11px;color:#999;margin-bottom:10px;">亲自直播免费养 IP；助播花钱起量（初始观众/热度加成），不出单，粉丝仍归你</div>
                    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">
                        ${streamers.map(s => {
                            const unlocked = s.unlocked && (s.id === 'self' || s.cost <= 0 || true); // 助播按店铺等级解锁
                            const extra = s.id === 'self'
                                ? '免费 · 亲自上阵'
                                : `¥${s.cost.toLocaleString()} · 观众+${Math.floor((s.baseFans || 0) * (cfg.assistantViewerRatio != null ? cfg.assistantViewerRatio : 0.1))} 热度+${Math.min(20, (cfg.assistantHeatBase != null ? cfg.assistantHeatBase : 5) + Math.floor((s.baseFans || 0) / 10000))}`;
                            return `
                                <div class="streamer-option"
                                     data-streamer="${s.id}"
                                     style="padding:12px;border:2px solid ${s.id === 'self' ? '#667eea' : '#e0e0e0'};border-radius:10px;cursor:${s.unlocked ? 'pointer' : 'not-allowed'};opacity:${s.unlocked ? 1 : 0.5};text-align:center;transition:all 0.2s;"
                                     onclick="${s.unlocked ? `liveUI.selectStreamer('${s.id}')` : ''}">
                                    <div style="font-size:30px;margin-bottom:4px;">${s.icon}</div>
                                    <div style="font-size:12px;font-weight:bold;color:#333;">${s.name}</div>
                                    <div style="font-size:10px;color:${s.id === 'self' ? '#4caf50' : '#ff6b35'};margin-top:2px;">${s.unlocked ? extra : `Lv.${s.unlockLevel}解锁`}</div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                    <input type="hidden" id="selectedStreamer" value="self">
                    ${(fans.true || 0) > 0 ? `
                        <div style="font-size:11px;color:#9c27b0;margin-top:8px;padding:8px 10px;background:#f3e5f5;border-radius:8px;">
                            💜 ${fans.true} 位真爱粉将自动涌入：开局观众 +${(fans.true || 0) * (typeof LIVE_CONFIG !== 'undefined' ? LIVE_CONFIG.trueFanBaselineViewers : 2)}、保底热度 +${typeof LIVE_CONFIG !== 'undefined' ? LIVE_CONFIG.trueFanBaselineHeat : 10}
                        </div>
                    ` : ''}
                </div>
                
                <!-- 价格策略（P3：低价冲量 / 高价厚利）-->
                <div class="card" style="padding:15px;">
                    <div style="font-size:14px;font-weight:bold;margin-bottom:4px;">💰 价格策略</div>
                    <div style="font-size:11px;color:#999;margin-bottom:10px;">开播前二选一，直播中不可切换 · 低价走量清库存，高价慢卖高毛利</div>
                    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">
                        ${(typeof PRICE_STRATEGIES !== 'undefined' ? PRICE_STRATEGIES : []).map((p, i) => `
                            <div class="strategy-option"
                                 data-strategy="${p.id}"
                                 style="padding:12px;border:2px solid ${i === 0 ? '#667eea' : '#e0e0e0'};border-radius:10px;cursor:pointer;text-align:center;transition:all 0.2s;"
                                 onclick="liveUI.selectPriceStrategy('${p.id}')">
                                <div style="font-size:22px;">${p.icon}</div>
                                <div style="font-size:13px;font-weight:bold;color:#333;margin-top:2px;">${p.name}</div>
                                <div style="font-size:10px;color:#ff6b35;margin-top:2px;">售价 ×${p.priceMult} · 销量 ×${p.salesMult}</div>
                                <div style="font-size:10px;color:#999;margin-top:2px;">${p.desc}</div>
                            </div>
                        `).join('')}
                    </div>
                    <input type="hidden" id="selectedStrategy" value="volume">
                    <div style="font-size:10px;color:#999;margin-top:6px;">直播后高价窗口：活跃粉丝 8 小时内自然单售价 ×${typeof LIVE_CONFIG !== 'undefined' ? LIVE_CONFIG.postStreamPremiumMult : 1.08}</div>
                </div>
                
                <!-- 选择话题（粉丝画像）-->
                <div class="card" style="padding:15px;">
                    <div style="font-size:14px;font-weight:bold;margin-bottom:4px;">🎯 直播话题</div>
                    <div style="font-size:11px;color:#999;margin-bottom:10px;">不同话题吸引不同画像的粉丝，直接影响对应品类转化</div>
                    <div style="display:flex;flex-wrap:wrap;gap:8px;">
                        ${topics.map((t, i) => `
                            <div class="topic-option"
                                 data-topic="${t.id}"
                                 style="padding:10px 14px;border:2px solid ${i === topics.length - 1 ? '#667eea' : '#e0e0e0'};border-radius:10px;cursor:pointer;display:flex;align-items:center;gap:8px;transition:all 0.2s;"
                                 onclick="liveUI.selectTopic('${t.id}')">
                                <span style="font-size:20px;">${t.icon}</span>
                                <div>
                                    <div style="font-size:13px;font-weight:bold;color:#333;">${t.name}</div>
                                    <div style="font-size:10px;color:#999;">${t.desc}</div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    <input type="hidden" id="selectedTopic" value="mixed">
                </div>
                
                <!-- 选择场景 -->
                <div class="card" style="padding:15px;">
                    <div style="font-size:14px;font-weight:bold;margin-bottom:12px;">🎭 直播场景</div>
                    <div style="display:flex;flex-direction:column;gap:8px;">
                        ${scenes.map((s, i) => `
                            <div class="scene-option"
                                 data-scene="${s.id}"
                                 style="padding:12px;border:2px solid ${i === 0 ? '#667eea' : '#e0e0e0'};border-radius:10px;cursor:pointer;display:flex;align-items:center;gap:12px;transition:all 0.2s;"
                                 onclick="liveUI.selectScene('${s.id}')">
                                <div style="font-size:28px;">${s.icon}</div>
                                <div style="flex:1;">
                                    <div style="font-size:13px;font-weight:bold;color:#333;">${s.name}</div>
                                    <div style="font-size:11px;color:#999;">${s.desc}</div>
                                </div>
                                ${s.conversionBonus ? `<span style="font-size:10px;color:#4caf50;background:#e8f5e9;padding:2px 6px;border-radius:4px;">转化+${Math.round((s.conversionBonus-1)*100)}%</span>` : ''}
                                ${s.trafficBonus ? `<span style="font-size:10px;color:#2196f3;background:#e3f2fd;padding:2px 6px;border-radius:4px;">流量+${Math.round((s.trafficBonus-1)*100)}%</span>` : ''}
                            </div>
                        `).join('')}
                    </div>
                    <input type="hidden" id="selectedScene" value="product_show">
                </div>
                
                <!-- 直播时长（现实分钟）-->
                <div class="card" style="padding:15px;">
                    <div style="font-size:14px;font-weight:bold;margin-bottom:10px;">⏰ 直播时长</div>
                    <div style="display:flex;gap:8px;">
                        ${durations.map((m, i) => `
                            <button class="btn btn-small ${m === (cfg.defaultDuration || 6) ? 'btn-primary' : ''}" 
                                    style="flex:1;padding:10px;"
                                    data-minutes="${m}"
                                    onclick="liveUI.selectDuration(${m}, this)">
                                ${m}分钟
                            </button>
                        `).join('')}
                    </div>
                    <input type="hidden" id="selectedDuration" value="${cfg.defaultDuration || 6}">
                    <div style="font-size:10px;color:#999;margin-top:6px;">每日 1 次 · 直播越久涨粉越多，热度随时间衰减</div>
                </div>
                
                <!-- 直播设置 -->
                <div class="card" style="padding:15px;">
                    <div style="font-size:14px;font-weight:bold;margin-bottom:12px;">⚙️ 直播设置</div>
                    
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f0f0f0;">
                        <div>
                            <div style="font-size:13px;color:#333;">开启专属折扣</div>
                            <div style="font-size:11px;color:#999;">直播间商品享折扣，提升转化率</div>
                        </div>
                        <label class="switch" style="position:relative;display:inline-block;width:48px;height:26px;">
                            <input type="checkbox" id="liveDiscountToggle" checked onchange="liveUI.toggleDiscount(this.checked)">
                            <span style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:#ccc;border-radius:26px;transition:.3s;">
                                <span style="position:absolute;content:'';height:20px;width:20px;left:3px;bottom:3px;background-color:white;border-radius:50%;transition:.3s;transform:translateX(22px);background:#667eea;"></span>
                            </span>
                        </label>
                    </div>
                    
                    <div id="discountSliderWrap" style="padding:10px 0;border-bottom:1px solid #f0f0f0;">
                        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                            <span style="font-size:13px;color:#333;">折扣力度</span>
                            <span style="font-size:13px;color:#ff6b35;font-weight:bold;" id="discountValue">9折</span>
                        </div>
                        <input type="range" id="liveDiscountSlider" min="5" max="9.5" step="0.5" value="9" 
                               style="width:100%;"
                               oninput="document.getElementById('discountValue').textContent = this.value + '折'">
                    </div>
                    
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;">
                        <div>
                            <div style="font-size:13px;color:#333;">自动结束直播</div>
                            <div style="font-size:11px;color:#999;">达到设定时长后自动结束</div>
                        </div>
                        <label class="switch" style="position:relative;display:inline-block;width:48px;height:26px;">
                            <input type="checkbox" id="liveAutoEndToggle" checked>
                            <span style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:#667eea;border-radius:26px;transition:.3s;">
                                <span style="position:absolute;content:'';height:20px;width:20px;left:3px;bottom:3px;background-color:white;border-radius:50%;transition:.3s;transform:translateX(22px);"></span>
                            </span>
                        </label>
                    </div>
                </div>
                
                <!-- 选品（可选） -->
                <div class="card" style="padding:15px;">
                    <div style="font-size:14px;font-weight:bold;margin-bottom:8px;">🛍️ 直播选品</div>
                    <div style="font-size:11px;color:#999;margin-bottom:12px;">可不选：开播后按话题自动挂约 10 件，讲解轮播；勾选则优先用你选的货</div>
                    <div style="max-height:220px;overflow-y:auto;">
                        <div style="display:flex;flex-wrap:wrap;gap:8px;">
                            ${activeListings.slice(0, 40).map(l => {
                                const product = PRODUCTS ? PRODUCTS.find(p => p.id === l.productId) : null;
                                if (!product) return '';
                                let icon = product.icon || '📦';
                                if (typeof getProductIconInfo === 'function') {
                                    const info = getProductIconInfo(product.id, product.name, product.category);
                                    if (info && info.emoji) icon = info.emoji;
                                }
                                return `
                                    <label style="display:flex;align-items:center;gap:6px;padding:6px 10px;background:#f5f5f5;border-radius:16px;cursor:pointer;font-size:12px;">
                                        <input type="checkbox" class="live-product-check" value="${l.productId}">
                                        <span>${icon} ${product.name.substring(0, 8)}</span>
                                    </label>
                                `;
                            }).join('')}
                        </div>
                    </div>
                </div>
                
                <!-- 开始按钮（配额用尽时禁用）-->
                ${disabled ? `
                    <div style="width:100%;padding:16px;font-size:16px;font-weight:bold;margin-top:10px;text-align:center;background:#f5f5f5;color:#999;border-radius:8px;">
                        📅 今日直播次数已用完，明日 0 点刷新
                    </div>
                ` : `
                    <button class="btn btn-primary" style="width:100%;padding:16px;font-size:16px;font-weight:bold;margin-top:10px;" onclick="liveUI.startLive()">
                        🎬 开始直播
                    </button>
                `}
                
                <div style="height:20px;"></div>
            </div>
        `;
    }

    // 渲染历史记录
    function _renderHistory(ls) {
        const history = liveState.getHistory(30);
        
        if (history.length === 0) {
            return `
                <div class="empty-state" style="padding:40px;">
                    <div class="icon" style="font-size:64px;">📺</div>
                    <div class="text" style="margin-top:16px;">暂无直播记录</div>
                    <div style="margin-top:20px;">
                        <button class="btn btn-primary" onclick="liveUI.switchTab('create')">🎬 开始第一场直播</button>
                    </div>
                </div>
            `;
        }
        
        return `
            <div style="display:flex;flex-direction:column;gap:10px;">
                ${history.map(h => {
                    const streamer = typeof h.streamer === 'string' 
                        ? LIVE_STREAMER_TYPES.find(s => s.id === h.streamer) 
                        : h.streamer;
                    return `
                        <div class="card" style="padding:12px;">
                            <div style="display:flex;gap:12px;">
                                <div style="width:100px;height:75px;background:linear-gradient(135deg,#667eea,#764ba2);border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;flex-shrink:0;">
                                    <div style="font-size:28px;">${streamer?.icon || '🎬'}</div>
                                    <div style="font-size:9px;margin-top:2px;">${Math.floor(h.duration)}分钟</div>
                                </div>
                                <div style="flex:1;min-width:0;">
                                    <div style="font-size:13px;font-weight:bold;color:#333;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${h.title}</div>
                                    <div style="font-size:11px;color:#999;margin-top:4px;">
                                        👥 ${h.peakViewers}人观看 · ${h.orderCount}单 · 💬${h.danmakuCount}条弹幕
                                    </div>
                                    <div style="display:flex;gap:10px;margin-top:6px;">
                                        <span style="font-size:12px;color:#4caf50;font-weight:bold;">¥${formatMoney(h.totalSales)}</span>
                                        <span style="font-size:11px;color:#9c27b0;">礼物 ¥${formatMoney(h.giftIncome)}</span>
                                    </div>
                                </div>
                            </div>
                            <div style="display:flex;gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid #f0f0f0;">
                                <button class="btn btn-small" style="flex:1;font-size:11px;padding:6px;" onclick="liveUI.showLiveDetail('${h.id}')">📊 详情</button>
                                <button class="btn btn-small" style="flex:1;font-size:11px;padding:6px;" onclick="liveUI.showReplay('${h.id}')">📼 回放</button>
                            </div>
                        </div>
                    `;
                }).join('')}
                <div style="height:20px;"></div>
            </div>
        `;
    }

    // 渲染直播复盘（数据驱动洞察：最佳主播/场景/话题组合）
    function _renderReview(ls) {
        const perf = liveState.analyzePerformance();
        if (!perf.totalStreams) {
            return `
                <div class="empty-state" style="padding:40px;">
                    <div class="icon" style="font-size:64px;">🧠</div>
                    <div class="text" style="margin-top:16px;">还没有足够的数据进行复盘</div>
                    <div style="margin-top:20px;">
                        <button class="btn btn-primary" onclick="liveUI.switchTab('create')">🎬 先开播一场</button>
                    </div>
                </div>`;
        }

        const insightCard = (title, icon, best, list) => `
            <div class="card" style="padding:15px;">
                <div style="font-size:14px;font-weight:bold;margin-bottom:12px;">${icon} ${title}</div>
                ${best ? `
                <div style="padding:12px;background:linear-gradient(135deg,#fff7e6,#ffe7ba);border-radius:10px;margin-bottom:12px;">
                    <div style="font-size:12px;color:#d46b08;">🏆 最佳：<b>${escapeHtml(best.name)}</b>（场均 ¥${formatMoney(best.avgSales)} · 场均 ${best.avgViewers} 人）</div>
                </div>` : ''}
                <div style="display:flex;flex-direction:column;gap:8px;">
                    ${list.slice(0, 5).map((r, i) => `
                        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#f8f9fa;border-radius:8px;">
                            <span style="font-size:13px;color:#333;">
                                <span style="color:#bbb;margin-right:6px;">#${i + 1}</span>${escapeHtml(r.name)}
                                <span style="color:#999;font-size:11px;margin-left:6px;">(${r.streams}场)</span>
                            </span>
                            <span style="font-size:13px;font-weight:bold;color:#4caf50;">¥${formatMoney(r.avgSales)}/场</span>
                        </div>`).join('')}
                </div>
            </div>`;

        return `
            <div style="display:flex;flex-direction:column;gap:12px;">
                <div class="card" style="padding:15px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;">
                    <div style="font-size:14px;font-weight:bold;">🧠 复盘洞察</div>
                    <div style="font-size:12px;opacity:0.92;margin-top:6px;line-height:1.8;">
                        已复盘 ${perf.totalStreams} 场直播。
                        ${perf.bestStreamer ? `最优主播「${escapeHtml(perf.bestStreamer.name)}」` : ''}
                        ${perf.bestScene ? ` · 最优场景「${escapeHtml(perf.bestScene.name)}」` : ''}
                        ${perf.bestTopic ? ` · 最优话题「${escapeHtml(perf.bestTopic.name)}」` : ''}
                    </div>
                </div>
                ${insightCard('主播表现', '👤', perf.bestStreamer, perf.streamers)}
                ${insightCard('场景效果', '🎬', perf.bestScene, perf.scenes)}
                ${insightCard('话题选品', '🏷️', perf.bestTopic, perf.topics)}
                <div style="height:20px;"></div>
            </div>`;
    }

    // 渲染数据统计
    function _renderStats(ls) {
        const stats = liveState.getStatistics();
        
        return `
            <div style="display:flex;flex-direction:column;gap:12px;">
                <!-- 核心指标 -->
                <div class="card" style="padding:15px;">
                    <div style="font-size:14px;font-weight:bold;margin-bottom:15px;">📊 核心数据</div>
                    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;">
                        <div style="padding:12px;background:linear-gradient(135deg,#667eea20,#764ba220);border-radius:10px;text-align:center;">
                            <div style="font-size:24px;font-weight:bold;color:#667eea;">${stats.totalStreams}</div>
                            <div style="font-size:11px;color:#666;margin-top:4px;">直播场次</div>
                        </div>
                        <div style="padding:12px;background:linear-gradient(135deg,#f093fb20,#f5576c20);border-radius:10px;text-align:center;">
                            <div style="font-size:24px;font-weight:bold;color:#f5576c;">${Math.floor(stats.totalDuration)}分钟</div>
                            <div style="font-size:11px;color:#666;margin-top:4px;">总直播时长</div>
                        </div>
                        <div style="padding:12px;background:linear-gradient(135deg,#4facfe20,#00f2fe20);border-radius:10px;text-align:center;">
                            <div style="font-size:24px;font-weight:bold;color:#2196f3;">${stats.avgViewers}</div>
                            <div style="font-size:11px;color:#666;margin-top:4px;">场均观众</div>
                        </div>
                        <div style="padding:12px;background:linear-gradient(135deg,#43e97b20,#38f9d720);border-radius:10px;text-align:center;">
                            <div style="font-size:24px;font-weight:bold;color:#4caf50;">¥${formatMoney(stats.avgSales)}</div>
                            <div style="font-size:11px;color:#666;margin-top:4px;">场均销售额</div>
                        </div>
                    </div>
                </div>
                
                <!-- 收入统计 -->
                <div class="card" style="padding:15px;">
                    <div style="font-size:14px;font-weight:bold;margin-bottom:15px;">💰 收入统计</div>
                    <div style="display:flex;flex-direction:column;gap:12px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:#f8f9fa;border-radius:8px;">
                            <span style="font-size:13px;color:#666;">商品销售收入</span>
                            <span style="font-size:15px;font-weight:bold;color:#4caf50;">¥${formatMoney(stats.totalSales)}</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:#f8f9fa;border-radius:8px;">
                            <span style="font-size:13px;color:#666;">礼物打赏收入</span>
                            <span style="font-size:15px;font-weight:bold;color:#9c27b0;">¥${formatMoney(stats.totalGifts)}</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:linear-gradient(135deg,#ffecd2,#fcb69f);border-radius:8px;">
                            <span style="font-size:14px;font-weight:bold;color:#333;">总收入</span>
                            <span style="font-size:18px;font-weight:bold;color:#ff6b35;">¥${formatMoney(stats.totalSales + stats.totalGifts)}</span>
                        </div>
                    </div>
                </div>
                
                <!-- 直播小贴士 -->
                <div class="card" style="padding:15px;">
                    <div style="font-size:14px;font-weight:bold;margin-bottom:12px;">💡 提升建议</div>
                    <div style="font-size:12px;color:#666;line-height:2;">
                        <div>📌 ${stats.totalStreams < 5 ? '多开播积累经验，熟能生巧！' : '直播经验丰富，继续保持！'}</div>
                        <div>📌 ${stats.avgViewers < 50 ? '尝试邀请更高级的主播来增加人气' : '人气不错，考虑增加互动提高转化'}</div>
                        <div>📌 ${stats.avgSales < 1000 ? '开启专属折扣能有效提升销售额' : '销售额可观，尝试秒杀场景爆单！'}</div>
                    </div>
                </div>
                
                <div style="height:20px;"></div>
            </div>
        `;
    }

    // 渲染成就
    function _renderAchievements(ls) {
        const achieved = ls.achievements || [];
        
        return `
            <div style="display:flex;flex-direction:column;gap:10px;">
                ${LIVE_ACHIEVEMENTS.map(a => {
                    const isUnlocked = achieved.includes(a.id);
                    return `
                        <div class="card" style="padding:15px;opacity:${isUnlocked ? 1 : 0.6};">
                            <div style="display:flex;align-items:center;gap:12px;">
                                <div style="width:50px;height:50px;border-radius:50%;background:${isUnlocked ? 'linear-gradient(135deg,#ffd700,#ffb800)' : '#e0e0e0'};display:flex;align-items:center;justify-content:center;font-size:24px;">
                                    ${isUnlocked ? a.icon : '🔒'}
                                </div>
                                <div style="flex:1;">
                                    <div style="font-size:14px;font-weight:bold;color:#333;">${a.name}</div>
                                    <div style="font-size:11px;color:#999;margin-top:2px;">${a.desc}</div>
                                </div>
                                <div style="text-align:right;">
                                    <div style="font-size:12px;color:#ff6b35;font-weight:bold;">+¥${a.reward.funds}</div>
                                    ${isUnlocked ? '<div style="font-size:10px;color:#4caf50;margin-top:2px;">✓ 已完成</div>' : ''}
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
                <div style="height:20px;"></div>
            </div>
        `;
    }

    // 渲染弹幕
    function _renderDanmakus(danmakus) {
        const recentDanmakus = danmakus.slice(-10);
        return recentDanmakus.map((dm, i) => {
            const isSpecial = dm.type === 'gift' || dm.type === 'system' || dm.isOwner;
            const bgStyle = isSpecial ? `background:${dm.type === 'gift' ? 'rgba(255,215,0,0.4)' : dm.type === 'system' ? 'rgba(255,107,53,0.6)' : 'rgba(102,126,234,0.6)'};border-radius:12px;padding:3px 10px;` : '';
            return `
                <div style="position:relative;color:${dm.color || '#fff'};font-size:13px;text-shadow:1px 1px 2px rgba(0,0,0,0.9);
                            margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
                            ${bgStyle}
                            animation:danmakuFade 0.5s ease-out forwards;">
                    ${dm.type === 'gift' ? '' : `<span style="opacity:0.8;font-weight:bold;">${dm.userName}：</span>`}${dm.content}
                </div>
            `;
        }).join('');
    }

    // ========== 交互方法 ==========
    
    // 切换标签页
    function switchTab(tabId) {
        const ls = liveState.getState();
        ls.ui.activeTab = tabId;
        // 重新渲染模态框
        _renderModal();
    }

    // 快速开播
    function startQuickLive(streamerId) {
        const streamer = LIVE_STREAMER_TYPES.find(s => s.id === streamerId);
        if (!streamer) return;
        
        const result = liveEngine.startLive({
            streamerType: streamerId,
            sceneType: 'product_show',
            duration: 4,
            title: _gameState.state.shop.name + '的直播间',
            settings: {
                autoEnd: true,
                showDiscount: true,
                discountRate: 0.9
            }
        });
        
        if (result.success) {
            _ui.showToast('直播开始啦！');
            switchTab('overview');
        } else {
            _ui.showToast(result.message);
        }
    }

    // 选择主播
    function selectStreamer(streamerId) {
        document.getElementById('selectedStreamer').value = streamerId;
        document.querySelectorAll('.streamer-option').forEach(el => {
            el.style.borderColor = el.dataset.streamer === streamerId ? '#667eea' : '#e0e0e0';
        });
    }

    // 选择场景
    function selectScene(sceneId) {
        document.getElementById('selectedScene').value = sceneId;
        document.querySelectorAll('.scene-option').forEach(el => {
            el.style.borderColor = el.dataset.scene === sceneId ? '#667eea' : '#e0e0e0';
        });
    }

    // 选择话题
    function selectTopic(topicId) {
        document.getElementById('selectedTopic').value = topicId;
        document.querySelectorAll('.topic-option').forEach(el => {
            el.style.borderColor = el.dataset.topic === topicId ? '#667eea' : '#e0e0e0';
        });
    }

    // 选择时长（现实分钟）
    function selectDuration(minutes, btn) {
        document.getElementById('selectedDuration').value = minutes;
        document.querySelectorAll('[data-minutes]').forEach(b => {
            b.className = 'btn btn-small';
            b.style.flex = '1';
            b.style.padding = '10px';
        });
        btn.className = 'btn btn-small btn-primary';
        btn.style.flex = '1';
        btn.style.padding = '10px';
    }

    // 切换折扣开关
    function toggleDiscount(checked) {
        document.getElementById('discountSliderWrap').style.display = checked ? 'block' : 'none';
    }

    // 选择价格策略
    function selectPriceStrategy(strategyId) {
        document.getElementById('selectedStrategy').value = strategyId;
        document.querySelectorAll('.strategy-option').forEach(el => {
            el.style.borderColor = el.dataset.strategy === strategyId ? '#667eea' : '#e0e0e0';
        });
    }

    // 开始直播（P0：话题 + 现实分钟时长；P3：价格策略 + 助播）
    function startLive() {
        const title = document.getElementById('liveTitleInput')?.value || _gameState.state.shop.name + '的直播间';
        const streamerType = document.getElementById('selectedStreamer')?.value || 'self';
        const sceneType = document.getElementById('selectedScene')?.value || 'product_show';
        const topicId = document.getElementById('selectedTopic')?.value || 'mixed';
        const priceStrategy = document.getElementById('selectedStrategy')?.value || 'volume';
        const duration = parseInt(document.getElementById('selectedDuration')?.value || '6');
        const showDiscount = document.getElementById('liveDiscountToggle')?.checked ?? true;
        const discountRate = showDiscount 
            ? parseFloat(document.getElementById('liveDiscountSlider')?.value || '9') / 10 
            : 1;
        const autoEnd = document.getElementById('liveAutoEndToggle')?.checked ?? true;
        
        // 获取选中的商品
        const productChecks = document.querySelectorAll('.live-product-check:checked');
        const productIds = Array.from(productChecks).map(c => c.value);
        
        const result = liveEngine.startLive({
            streamerType,
            sceneType,
            topicId,
            priceStrategy,
            duration,
            title,
            productIds: productIds.length > 0 ? productIds : [],
            settings: {
                autoEnd,
                showDiscount,
                discountRate,
                enableDanmaku: true,
                enableGifts: true
            }
        });
        
        if (result.success) {
            _ui.showToast('🎉 ' + result.message);
            switchTab('overview');
        } else {
            _ui.showToast(result.message);
            if (result.message && String(result.message).indexOf('今日直播次数已用完') >= 0) {
                watchAdForLiveQuota();
            }
        }
    }

    function watchAdForLiveQuota() {
        try {
            if (typeof RewardedAdManager !== 'undefined' && RewardedAdManager.showForLiveQuota) {
                RewardedAdManager.showForLiveQuota();
                return;
            }
        } catch (e) {
            console.warn('[watchAdForLiveQuota]', e);
        }
        if (_ui && _ui.showToast) _ui.showToast('广告模块未加载');
    }

    // 确认结束直播（P0：显示结算——涨粉/活跃粉丝窗口）
    function confirmEndLive() {
        if (confirm('确定要结束直播吗？结束后将结算粉丝与活跃粉丝窗口。')) {
            const result = liveEngine.endLive();
            if (result.success) {
                hideHangBar();
                const st = result.settlement;
                _ui.showToast('直播已结束，数据已保存');
                switchTab('overview');
                // 结算提示
                if (st) {
                    setTimeout(() => {
                        _ui.showToast(`⭐ 涨粉 +${st.fansGained}，活跃粉丝 ${st.activeFans} 人，${st.activeFanWindowHours}小时内持续自动带单`);
                    }, 400);
                }
                // 显示新成就
                if (result.newAchievements && result.newAchievements.length > 0) {
                    setTimeout(() => {
                        result.newAchievements.forEach(a => {
                            _ui.showToast(`🏆 解锁成就：${a.name}！+¥${a.reward.funds}`);
                        });
                    }, 800);
                }
            }
        }
    }

    // 点热度（互动 1）
    function tapHeatUI() {
        const result = liveEngine.tapHeat();
        if (!result.success) {
            _ui.showToast(result.message);
            return;
        }
        // 本地热力反馈
        const el = document.getElementById('liveHeatValue');
        if (el) {
            el.textContent = Math.round(result.heat);
            el.style.transform = 'scale(1.3)';
            setTimeout(() => { if (el) el.style.transform = 'scale(1)'; }, 150);
        }
        _refreshPage();
    }

    // 答题（互动 2）
    function answerQuestionUI(optionIndex) {
        const result = liveEngine.answerQuestion(optionIndex);
        if (!result.success) {
            _ui.showToast(result.message);
            return;
        }
        _ui.showToast(result.correct ? '✅ 答对啦！' : '❌ 答错了…');
        _refreshPage();
    }

    // P2：危机公关
    function crisisPRUI(option) {
        const labels = ['🙏 道歉+解释', '🎟️ 发放优惠券', '😐 无视'];
        const result = liveEngine.crisisPR(option);
        if (!result.success) {
            _ui.showToast(result.message);
            return;
        }
        _ui.showToast(result.message || labels[option]);
        _refreshPage();
    }

    // P2：紧急补货
    function urgentRestockUI() {
        const result = liveEngine.urgentRestock();
        if (!result.success) {
            _ui.showToast(result.message);
            return;
        }
        _ui.showToast(result.message);
        _refreshPage();
    }

    // 发送弹幕
    function sendDanmaku() {
        const input = document.getElementById('danmakuInput');
        if (!input) return;
        
        const content = input.value.trim();
        if (!content) return;
        
        const result = liveEngine.sendDanmaku(content);
        if (result.success) {
            input.value = '';
            _refreshPage();
        } else {
            _ui.showToast(result.message);
        }
    }

    // 切换礼物面板（默认隐藏，避免挡住关闭/挂机）
    function toggleGiftPanel() {
        const panel = document.getElementById('giftPanel');
        if (!panel) return;
        const opening = panel.classList.contains('hidden') || panel.style.display === 'none';
        if (opening) {
            panel.classList.remove('hidden');
            panel.style.display = 'block';
        } else {
            panel.classList.add('hidden');
            panel.style.display = 'none';
        }
    }

    // 只关界面，直播继续在后台挂着
    function leaveLiveRoom() {
        if (_ui && typeof _ui.closeModal === 'function') {
            _ui.closeModal();
        }
        showHangBar();
        if (_ui && typeof _ui.showToast === 'function') {
            _ui.showToast('直播间挂机中，可继续逛店');
        }
    }

    function reopenLiveRoom() {
        hideHangBar();
        // 等本次点击结束再开弹窗，避免点击穿透到遮罩立刻把直播间关掉
        setTimeout(() => {
            if (typeof ui !== 'undefined' && ui && typeof ui.showLivestreamModal === 'function') {
                ui.showLivestreamModal();
            } else {
                showLiveCenter();
            }
        }, 40);
    }

    function showHangBar() {
        hideHangBar();
        const ls = (typeof liveState !== 'undefined' && liveState.getState) ? liveState.getState() : null;
        if (!ls || !ls.isLive) return;
        const bar = document.createElement('div');
        bar.id = 'liveHangBar';
        bar.innerHTML = `<span class="live-hang-dot"></span><span id="liveHangBarText">🔴 直播挂机中 · ${ls.viewers || 0} 观众</span><button type="button" class="live-hang-back">回直播间</button>`;
        const back = () => {
            reopenLiveRoom();
        };
        bar.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            back();
        });
        document.body.appendChild(bar);
    }

    function hideHangBar() {
        const el = document.getElementById('liveHangBar');
        if (el) el.remove();
    }

    function onLiveTick() {
        const ls = (typeof liveState !== 'undefined' && liveState.getState) ? liveState.getState() : null;
        const bar = document.getElementById('liveHangBar');
        if (!ls || !ls.isLive) {
            hideHangBar();
            return;
        }
        if (bar) {
            const text = document.getElementById('liveHangBarText');
            if (text) text.textContent = `🔴 直播挂机中 · ${ls.viewers || 0} 观众 · ${liveState.getFormattedDuration ? liveState.getFormattedDuration() : ''}`;
        }
        const setTxt = (sel, val) => {
            document.querySelectorAll(sel).forEach(el => { el.textContent = val; });
        };
        setTxt('[data-live-viewers]', String(ls.viewers || 0));
        setTxt('[data-live-viewers-badge]', `👥 ${ls.viewers || 0}`);
        setTxt('[data-live-viewers-card]', String(ls.viewers || 0));
        setTxt('[data-live-peak]', String(ls.peakViewers || 0));
        setTxt('[data-live-fans]', `+${Math.floor(ls.fansGained || 0)}`);
        setTxt('[data-live-duration-badge]', `⏱️ ${Math.floor(ls.duration || 0)}分`);
        if (ls.plannedDuration) {
            setTxt('[data-live-progress-text]', `${Math.floor(ls.duration || 0)}分 / ${ls.plannedDuration}分`);
        }
    }

    // 发送礼物
    function sendGift(giftId) {
        const gift = LIVE_GIFTS.find(g => g.id === giftId);
        if (!gift) return;
        
        // 直接扣除玩家资金（模拟送礼）
        if (typeof _gameState.spendFunds === 'function') {
            const spendResult = _gameState.spendFunds(gift.price, '直播送礼：' + gift.name);
            if (!spendResult) {
                _ui.showToast('余额不足，无法送礼（欠款已达上限）');
                return;
            }
        }
        
        const result = liveEngine.sendGift(giftId, _gameState.state.player.name || '店主');
        if (result.success) {
            _ui.showToast(`送出了 ${gift.icon}${gift.name}！`);
            toggleGiftPanel();
            _showGiftEffect(gift);
        }
    }

    // 显示礼物特效
    function _showGiftEffect(gift) {
        const area = document.getElementById('liveVideoArea');
        if (!area) return;
        
        const effect = document.createElement('div');
        effect.style.cssText = `
            position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
            font-size:80px;pointer-events:none;z-index:50;
            animation:giftPop 1s ease-out forwards;
        `;
        effect.textContent = gift.icon;
        area.appendChild(effect);
        
        setTimeout(() => effect.remove(), 1000);
    }

    // 显示点赞动画
    function showLikeAnimation() {
        const area = document.getElementById('likeAnimationArea');
        if (!area) return;
        
        for (let i = 0; i < 5; i++) {
            setTimeout(() => {
                const heart = document.createElement('div');
                heart.style.cssText = `
                    position:absolute;bottom:0;left:${Math.random() * 40 + 10}px;
                    font-size:${16 + Math.random() * 12}px;
                    animation:likeFloat 1.5s ease-out forwards;
                    pointer-events:none;
                `;
                heart.textContent = ['❤️', '🧡', '💛', '💚', '💙'][Math.floor(Math.random() * 5)];
                area.appendChild(heart);
                setTimeout(() => heart.remove(), 1500);
            }, i * 100);
        }
    }

    // 查看直播详情
    function showLiveDetail(recordId) {
        const history = liveState.getHistory();
        const record = history.find(h => h.id === recordId);
        if (!record) return;
        
        const streamer = typeof record.streamer === 'string' 
            ? LIVE_STREAMER_TYPES.find(s => s.id === record.streamer) 
            : record.streamer;
        
        const content = `
            <div style="padding:15px;">
                <div style="text-align:center;margin-bottom:20px;">
                    <div style="font-size:48px;">${streamer?.icon || '🎬'}</div>
                    <div style="font-size:16px;font-weight:bold;margin-top:8px;">${record.title}</div>
                    <div style="font-size:12px;color:#999;margin-top:4px;">直播时长 ${Math.floor(record.duration)}分钟</div>
                </div>
                <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;">
                    <div style="text-align:center;padding:12px;background:#f5f5f5;border-radius:8px;">
                        <div style="font-size:20px;font-weight:bold;color:#2196f3;">${record.peakViewers}</div>
                        <div style="font-size:11px;color:#999;">峰值观众</div>
                    </div>
                    <div style="text-align:center;padding:12px;background:#f5f5f5;border-radius:8px;">
                        <div style="font-size:20px;font-weight:bold;color:#4caf50;">¥${formatMoney(record.totalSales)}</div>
                        <div style="font-size:11px;color:#999;">销售额</div>
                    </div>
                    <div style="text-align:center;padding:12px;background:#f5f5f5;border-radius:8px;">
                        <div style="font-size:20px;font-weight:bold;color:#9c27b0;">${record.orderCount}</div>
                        <div style="font-size:11px;color:#999;">订单数</div>
                    </div>
                    <div style="text-align:center;padding:12px;background:#f5f5f5;border-radius:8px;">
                        <div style="font-size:20px;font-weight:bold;color:#ff9800;">¥${formatMoney(record.giftIncome)}</div>
                        <div style="font-size:11px;color:#999;">礼物收入</div>
                    </div>
                    <div style="text-align:center;padding:12px;background:#f5f5f5;border-radius:8px;">
                        <div style="font-size:20px;font-weight:bold;color:#e91e63;">${record.likes}</div>
                        <div style="font-size:11px;color:#999;">点赞数</div>
                    </div>
                    <div style="text-align:center;padding:12px;background:#f5f5f5;border-radius:8px;">
                        <div style="font-size:20px;font-weight:bold;color:#00bcd4;">${record.danmakuCount}</div>
                        <div style="font-size:11px;color:#999;">弹幕数</div>
                    </div>
                </div>
            </div>
        `;
        
        _ui.showModal('直播详情', content, '<button class="btn btn-primary" onclick="ui.closeModal()">关闭</button>');
    }

    // 显示回放（模拟）
    function showReplay(recordId) {
        if (typeof showLiveDetail === 'function') {
            showLiveDetail(recordId);
            return;
        }
        _ui.showToast('没有这场直播的回放数据');
    }

    // 刷新页面
    function _refreshPage() {
        if (_ui && typeof _ui.refreshPage === 'function') {
            _ui.refreshPage();
        }
    }

    // 更新弹幕显示（供引擎调用）
    function updateDanmakus() {
        const container = document.getElementById('danmakuContainer');
        if (!container) return;
        
        const danmakus = liveState.getDanmakus(15);
        container.innerHTML = _renderDanmakus(danmakus);
        
        // 自动滚动到底部由CSS动画处理
    }

    // 返回直播中心页面（供外部调用）
    function showLiveCenter() {
        hideHangBar();
        const ls = (typeof liveState !== 'undefined' && liveState.getState) ? liveState.getState() : null;
        if (ls && ls.ui) ls.ui.activeTab = 'overview';
        _renderModal();
        if (_ui && typeof _ui._startLiveDanmakuUpdate === 'function') {
            try { _ui._startLiveDanmakuUpdate(); } catch (_) {}
        }
    }
    
    // 渲染直播中心到模态框
    function _renderModal() {
        const state = liveState.getState();
        if (!state) return;
        
        const content = renderLivePage(_gameState.state);
        const footer = state.isLive
            ? `<button class="btn btn-primary" onclick="liveUI.leaveLiveRoom()">📱 挂机返回店铺</button>
               <button class="btn btn-danger" onclick="liveUI.confirmEndLive()">结束直播</button>`
            : `<button class="btn btn-default" onclick="ui.closeModal()">关闭</button>`;
        
        // 查找已有的直播中心模态框或创建新的
        const allOverlays = document.querySelectorAll('.modal-overlay');
        let existingModal = null;
        for (let i = allOverlays.length - 1; i >= 0; i--) {
            const titleEl = allOverlays[i].querySelector('.modal-title');
            if (titleEl && (titleEl.textContent === '🎥 直播中心' || titleEl.textContent === '直播中心')) {
                existingModal = allOverlays[i];
                break;
            }
        }
        
        if (existingModal) {
            const modalBody = existingModal.querySelector('.modal-body');
            const modalFooter = existingModal.querySelector('.modal-footer');
            const modalTitle = existingModal.querySelector('.modal-title');
            if (modalBody) modalBody.innerHTML = content;
            if (modalFooter) modalFooter.innerHTML = footer;
            if (modalTitle) modalTitle.textContent = '🎥 直播中心';
        } else {
            _ui.showModal('🎥 直播中心', content, footer, { modalId: 'liveCenterModal' });
        }
    }

    // 导出API
    return {
        init,
        renderLivePage,
        switchTab,
        startQuickLive,
        selectStreamer,
        selectTopic,
        selectScene,
        selectDuration,
        selectPriceStrategy,
        toggleDiscount,
        startLive,
        watchAdForLiveQuota,
        confirmEndLive,
        leaveLiveRoom,
        showHangBar,
        hideHangBar,
        onLiveTick,
        sendDanmaku,
        toggleGiftPanel,
        sendGift,
        showLikeAnimation,
        showLiveDetail,
        showReplay,
        updateDanmakus,
        showLiveCenter,
        reopenLiveRoom,
        // IP养成（P0）：互动
        tapHeatUI,
        answerQuestionUI,
        // P2：随机事件
        crisisPRUI,
        urgentRestockUI
    };
})();

// 添加必要的CSS动画
const liveStyles = document.createElement('style');
liveStyles.textContent = `
    @keyframes danmakuFade {
        0% { opacity: 0; transform: translateY(10px); }
        100% { opacity: 1; transform: translateY(0); }
    }
    @keyframes likeFloat {
        0% { transform: translateY(0) scale(1); opacity: 1; }
        100% { transform: translateY(-200px) scale(1.2); opacity: 0; }
    }
    @keyframes giftPop {
        0% { transform:translate(-50%,-50%) scale(0); opacity: 0; }
        50% { transform:translate(-50%,-50%) scale(1.5); opacity: 1; }
        100% { transform:translate(-50%,-50%) scale(1); opacity: 0; }
    }
    @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
    }
    @keyframes bounce {
        0%, 100% { transform: translate(-50%, -50%) translateY(0); }
        50% { transform: translate(-50%, -50%) translateY(-10px); }
    }
    .switch input {
        opacity: 0;
        width: 0;
        height: 0;
    }
    .switch input:checked + span {
        background-color: #667eea;
    }
    .switch input:checked + span span {
        transform: translateX(22px);
    }
    .switch input:not(:checked) + span span {
        transform: translateX(3px);
    }
    #danmakuContainer {
        display: flex !important;
        flex-direction: column;
        justify-content: flex-end;
    }
    #liveHangBar {
        position: fixed;
        left: 12px;
        right: 12px;
        bottom: 68px;
        z-index: 350;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        border-radius: 999px;
        background: linear-gradient(90deg, #1a1a2e, #c62828);
        color: #fff;
        font-size: 12px;
        font-weight: 700;
        box-shadow: 0 6px 18px rgba(198, 40, 40, 0.45);
        cursor: pointer;
    }
    #liveHangBar .live-hang-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #ff5252;
        animation: pulse 1s infinite;
        flex-shrink: 0;
    }
    #liveHangBar .live-hang-back {
        margin-left: auto;
        background: rgba(255,255,255,.18);
        padding: 3px 10px;
        border-radius: 999px;
        font-size: 11px;
        white-space: nowrap;
        border: none;
        color: inherit;
        font-weight: 700;
        cursor: pointer;
        font-family: inherit;
    }
    #liveHangBarText { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;
document.head.appendChild(liveStyles);

// 导出到全局
if (typeof window !== 'undefined') {
    window.liveUI = liveUI;
}
