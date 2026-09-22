/**
 * 激励视频 + 插屏广告（5+ App / uni-ad）
 * 官方用法：https://ask.dcloud.net.cn/article/36718
 *
 * uni-ad 后台（H529D8F66）广告位：
 *   签到广告       1087662927
 *   流量包         1178141828
 *   跳一天次数用完 1567482336
 *   破产救援       1192653683
 *   直播次数用完   1577646805
 *   角色属性       1869972550
 * HBuilderX 标准基座测试位：1507000689
 */
const RewardedAdManager = {
    ADPID: '1087662927',
    TEST_ADPID: '1507000689',
    ADPID_MAP: {
        signIn: '1087662927',
        trafficBoost: '1178141828',
        skipDay: '1567482336',
        bailout: '1192653683',
        liveQuota: '1577646805',
        attrUpgrade: '1869972550'
    },
    TRAFFIC_BOOST_HOURS: 6,
    LIVE_QUOTA_PER_AD: 1,
    INTERSTITIAL_ADPID: '1700827121',
    // 签到奖励：每个游戏日看完激励视频领取一次
    REWARD_FUNDS: 900000000000,
    /** 每次激励广告发放的行动次数（跳一天） */
    QUOTA_PER_AD: 5,
    /** 任意激励广告之间的冷却（毫秒） */
    COOLDOWN_MS: 0,
    /** 插屏（开屏）广告冷却（毫秒）：30 分钟一次 */
    INTERSTITIAL_COOLDOWN_MS: 1800000,

    _adReward: null,
    _adInterstitial: null,
    _busy: false,
    _lastAdAt: 0,
    _lastInterstitialAt: 0,
    /** @type {'signIn'|'skipDay'|null} */
    _pendingPurpose: null,
    /** @type {null|function(boolean):void} */
    _pendingCallback: null,
    _pendingTicket: null,
    _pendingAttrKey: null,

    getCooldownRemainingSec() {
        return 0; // 冷却已移除
    },

    _markCooldown() {
        this._lastAdAt = Date.now();
    },

    _isStandardBase() {
        try {
            if (typeof plus !== 'undefined' && plus.runtime) {
                const ch = String(plus.runtime.channel || '');
                const appid = String(plus.runtime.appid || '');
                const launcher = String(plus.runtime.launcher || '');
                if (/standard|debug|hbuilder/i.test(ch) || appid === 'HBuilder') return true;
                if (/debugger|stream/i.test(launcher) && appid === 'HBuilder') return true;
            }
        } catch (_) {}
        return false;
    },

    /**
     * 按用途取广告位。标准基座一律用测试位。
     * @param {'signIn'|'skipDay'|'bailout'|'liveQuota'|'trafficBoost'|'attrUpgrade'} [purpose]
     */
    getAdpid(purpose) {
        if (this._isStandardBase()) return this.TEST_ADPID;
        const key = purpose || this._pendingPurpose || 'signIn';
        const mapped = (this.ADPID_MAP && this.ADPID_MAP[key]) || this.ADPID;
        return String(mapped || this.TEST_ADPID);
    },

    getInterstitialAdpid() {
        if (this._isStandardBase()) return this.TEST_ADPID;
        return String(this.INTERSTITIAL_ADPID || '');
    },

    _playerId() {
        try {
            if (typeof LeaderboardClient !== 'undefined' && LeaderboardClient.getIdentity) {
                return String(LeaderboardClient.getIdentity().playerId || '');
            }
        } catch (_) {}
        return '';
    },

    /** H5 / 标准基座不走服务端验签，正式包必须等 uni-ad 回调 */
    _skipS2S() {
        if (typeof plus === 'undefined') return true;
        return this._isStandardBase();
    },

    _sleep(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    },

    async _confirmServerTicket(purpose) {
        if (this._skipS2S()) return { ok: true, skip: true };
        if (typeof LeaderboardClient === 'undefined' || typeof LeaderboardClient.fetchAdTicket !== 'function') {
            return { ok: true, skip: true };
        }
        if (!this._playerId()) return { ok: true, skip: true };
        let lastErr = null;
        for (let i = 0; i < 8; i++) {
            try {
                const data = await LeaderboardClient.fetchAdTicket(purpose);
                if (data && (data.skip || data.disabled)) {
                    return { ok: true, skip: true };
                }
                if (data && data.ticket && data.ticket.trans_id) {
                    return { ok: true, ticket: data.ticket };
                }
                if (data && data.ok === false && data.error) lastErr = data.error;
            } catch (e) {
                lastErr = e;
                console.warn('[RewardedAd] ticket poll', e);
            }
            await this._sleep(400);
        }
        // 验签服不可达时仍按完整观看发奖，避免看完广告没奖励
        console.warn('[RewardedAd] s2s timeout, grant by client isEnded', lastErr || '');
        return { ok: true, skip: true, fallback: true };
    },

    _consumeTicket(ticket) {
        try {
            if (!ticket || !ticket.trans_id) return;
            if (typeof LeaderboardClient !== 'undefined' && typeof LeaderboardClient.consumeAdTicket === 'function') {
                LeaderboardClient.consumeAdTicket(ticket.trans_id).catch(function () {});
            }
        } catch (_) {}
    },

    isAppRuntime() {
        try {
            return typeof plus !== 'undefined' && plus.ad && typeof plus.ad.createRewardedVideoAd === 'function';
        } catch (_) {
            return false;
        }
    },

    _toast(msg) {
        try {
            if (typeof ui !== 'undefined' && ui && typeof ui.showToast === 'function') {
                ui.showToast(msg);
                return;
            }
        } catch (_) {}
        try {
            if (typeof plus !== 'undefined' && plus.nativeUI) plus.nativeUI.toast(msg);
        } catch (_) {}
        console.log('[RewardedAd]', msg);
    },

    _privacyOk() {
        try {
            if (typeof PrivacyFlow !== 'undefined' && PrivacyFlow.isAgreed) return !!PrivacyFlow.isAgreed();
            if (typeof window.isPrivacyAgreed === 'function' && window.isPrivacyAgreed()) return true;
        } catch (_) {}
        return false;
    },

    hasClaimedToday() {
        try {
            const day = (typeof gameState !== 'undefined' && gameState.state && gameState.state.gameTime)
                ? (gameState.state.gameTime.day || 1) : 1;
            const last = gameState.state.settings && gameState.state.settings.lastAdSignInDay;
            return false;
        } catch (_) {
            return false;
        }
    },

    _markClaimed() {
        try {
            if (!gameState.state.settings) gameState.state.settings = {};
            gameState.state.settings.lastAdSignInDay = gameState.state.gameTime?.day || 1;
            if (typeof gameState.notify === 'function') gameState.notify();
        } catch (_) {}
    },

    /** 标记本存档注入过广告/救援资金：排行榜据此跳过上报，避免注水成绩 */
    _markMoneyInjected() {
        try {
            if (typeof gameState === 'undefined' || !gameState || !gameState.state) return;
            if (!gameState.state.settings) gameState.state.settings = {};
            gameState.state.settings.moneyInjected = true;
        } catch (_) {}
    },

    grantReward(source) {
        try {
            if (typeof gameState === 'undefined' || !gameState || typeof gameState.addFunds !== 'function') {
                this._toast('游戏状态不可用，无法发放奖励');
                return false;
            }
            if (this.hasClaimedToday()) {
                this._toast('今日已领取过广告签到奖励');
                return false;
            }
            gameState.addFunds(this.REWARD_FUNDS, '广告签到奖励（激励视频）');
            this._markClaimed();
            this._markMoneyInjected();
            try {
                if (typeof gameState.dailySignIn === 'function') gameState.dailySignIn();
            } catch (_) {}
            this._toast('🎉 观看完成！获得资金 ¥' + this.REWARD_FUNDS.toLocaleString());
            try {
                if (typeof ui !== 'undefined' && ui && typeof ui.forceRender === 'function') ui.forceRender();
            } catch (_) {}
            console.log('[RewardedAd] reward via', source || 'ad');
            return true;
        } catch (e) {
            console.warn('[RewardedAd] grantReward error', e);
            this._toast('发放奖励异常');
            return false;
        }
    },

    /**
     * 发放行动次数（跳一天）
     * @param {string} [source]
     */
    grantBailout(source) {
        try {
            if (typeof ui !== 'undefined' && ui && typeof ui.applyAdBailoutRescue === 'function') {
                const ok = ui.applyAdBailoutRescue();
                if (ok) {
                    this._markMoneyInjected();
                    this._toast('🎉 已看完广告，本次欠款已抵扣，继续经营');
                }
                return !!ok;
            }
            this._toast('救援流程不可用');
            return false;
        } catch (e) {
            console.warn('[RewardedAd] grantBailout', e);
            this._toast('广告抵还款异常');
            return false;
        }
    },

    grantLiveQuota(source) {
        try {
            if (typeof liveState === 'undefined' || !liveState || typeof liveState.addBonusDailyQuota !== 'function') {
                this._toast('直播模块不可用');
                return false;
            }
            const q = liveState.addBonusDailyQuota(1);
            const left = (q && q.remaining != null) ? q.remaining : 1;
            this._toast('🎉 观看完成！今日直播次数 +1（剩余 ' + left + '）');
            try {
                if (typeof ui !== 'undefined' && ui && typeof ui.forceRender === 'function') ui.forceRender();
            } catch (_) {}
            console.log('[RewardedAd] liveQuota via', source || 'ad');
            return true;
        } catch (e) {
            console.warn('[RewardedAd] grantLiveQuota', e);
            this._toast('发放直播次数异常');
            return false;
        }
    },

    hasClaimedTrafficToday() {
        try {
            const day = (typeof gameState !== 'undefined' && gameState.state && gameState.state.gameTime)
                ? (gameState.state.gameTime.day || 1) : 1;
            const last = gameState.state.settings && gameState.state.settings.lastAdTrafficDay;
            return last === day;
        } catch (_) {
            return false;
        }
    },

    grantTrafficBoost(source) {
        try {
            if (typeof gameState === 'undefined' || !gameState || typeof gameState.grantAdTrafficBoost !== 'function') {
                this._toast('游戏状态不可用');
                return false;
            }
            if (this.hasClaimedTrafficToday()) {
                this._toast('今日已领取过流量补给');
                return false;
            }
            const hours = this.TRAFFIC_BOOST_HOURS || 6;
            const ok = gameState.grantAdTrafficBoost(hours);
            if (!ok) {
                this._toast('发放流量补给失败');
                return false;
            }
            this._toast('🎉 观看完成！自然流量加强 ' + hours + ' 小时');
            try {
                if (typeof ui !== 'undefined' && ui && typeof ui.forceRender === 'function') ui.forceRender();
            } catch (_) {}
            console.log('[RewardedAd] trafficBoost', hours, 'h via', source || 'ad');
            return true;
        } catch (e) {
            console.warn('[RewardedAd] grantTrafficBoost', e);
            this._toast('发放流量补给异常');
            return false;
        }
    },

    grantQuota(source) {
        try {
            if (typeof gameState === 'undefined' || !gameState || typeof gameState.addActionQuota !== 'function') {
                this._toast('游戏状态不可用，无法增加次数');
                return false;
            }
            const add = this.QUOTA_PER_AD || 5;
            const left = gameState.addActionQuota(add);
            this._toast(`🎉 观看完成！跳一天次数 +${add}（剩余 ${left}）`);
            try {
                if (typeof ui !== 'undefined' && ui) {
                    if (typeof ui.refreshSkipDayBtn === 'function') ui.refreshSkipDayBtn();
                    if (typeof ui.forceRender === 'function') ui.forceRender();
                }
            } catch (_) {}
            console.log('[RewardedAd] quota skipDay', '+', add, 'via', source || 'ad');
            return true;
        } catch (e) {
            console.warn('[RewardedAd] grantQuota error', e);
            this._toast('发放次数异常');
            return false;
        }
    },

    grantAttrUpgrade(source) {
        try {
            const key = this._pendingAttrKey;
            this._pendingAttrKey = null;
            if (!key) {
                this._toast('未选择要升级的属性');
                return false;
            }
            if (typeof gameState === 'undefined' || !gameState || typeof gameState.upgradeAttributeByAd !== 'function') {
                this._toast('属性系统不可用');
                return false;
            }
            const r = gameState.upgradeAttributeByAd(key, 20);
            this._toast((r && r.message) || (r && r.success ? ('属性已升级至 Lv.' + r.level) : '升级失败'));
            try {
                if (r && r.success && typeof ui !== 'undefined' && ui && typeof ui.showAttributeModal === 'function') {
                    ui.showAttributeModal();
                }
            } catch (_) {}
            console.log('[RewardedAd] attrUpgrade', key, source || 'ad');
            return !!(r && r.success);
        } catch (e) {
            console.warn('[RewardedAd] grantAttrUpgrade', e);
            this._toast('属性升级异常');
            return false;
        }
    },

    _applyPendingReward(source) {
        this._markCooldown();
        const purpose = this._pendingPurpose;
        this._pendingPurpose = null;
        if (purpose === 'skipDay') {
            return this.grantQuota(source);
        }
        if (purpose === 'bailout') {
            return this.grantBailout(source);
        }
        if (purpose === 'liveQuota') {
            return this.grantLiveQuota(source);
        }
        if (purpose === 'trafficBoost') {
            return this.grantTrafficBoost(source);
        }
        if (purpose === 'attrUpgrade') {
            return this.grantAttrUpgrade(source);
        }
        return this.grantReward(source);
    },

    _destroy() {
        try {
            if (this._adReward && typeof this._adReward.destroy === 'function') {
                this._adReward.destroy();
            }
        } catch (_) {}
        this._adReward = null;
        this._busy = false;
        this._pendingPurpose = null;
        this._pendingCallback = null;
        this._pendingAttrKey = null;
    },

    _createRewardedAd(adpid) {
        if (!this._privacyOk()) throw new Error('privacy_required');
        const id = String(adpid || '').trim();
        if (!id) throw new Error('adpid empty');
        const extra = String(this._pendingPurpose || 'signIn');
        const userId = this._playerId();
        try {
            return plus.ad.createRewardedVideoAd({
                adpid: id,
                urlCallback: { userId: userId, extra: extra }
            });
        } catch (_) {
            return plus.ad.createRewardedVideoAd({ adpid: id });
        }
    },

    /**
     * 官方流程：createRewardedVideoAd → onLoad/onError/onClose → load
     */
    _playRewardedVideo() {
        const self = this;
        if (this._adReward) {
            this._toast('正在加载激励视频广告');
            return;
        }

        const preferred = this.getAdpid(this._pendingPurpose);
        const fallback = this.TEST_ADPID;
        const tryIds = preferred === fallback ? [preferred] : [preferred, fallback];
        console.log('[RewardedAd] #视频激励广告# adpid=', preferred, 'purpose=', this._pendingPurpose);
        try {
            if (typeof LeaderboardClient !== 'undefined' && typeof LeaderboardClient.prepareAdWatch === 'function') {
                LeaderboardClient.prepareAdWatch(this._pendingPurpose || 'signIn');
            }
        } catch (_) {}

        let adReward = null;
        let lastErr = null;
        for (let i = 0; i < tryIds.length; i++) {
            try {
                adReward = this._createRewardedAd(tryIds[i]);
                if (adReward) {
                    console.log('[RewardedAd] created with adpid=', tryIds[i]);
                    break;
                }
            } catch (e) {
                lastErr = e;
                console.warn('[RewardedAd] create failed', tryIds[i], e);
            }
        }
        if (!adReward) {
            console.warn('[RewardedAd] create all failed', lastErr);
            this._busy = false;
            this._toast('当前基座无法拉起广告，先用调试播放完成升级');
            this._showDevFallback();
            return;
        }

        this._adReward = adReward;
        this._busy = true;
        this._toast('正在加载广告…');

        adReward.onLoad(function () {
            console.log('[RewardedAd] 加载成功');
            try {
                adReward.show();
            } catch (e) {
                console.warn('[RewardedAd] show failed', e);
                self._toast('广告播放失败，请重试');
                self._destroy();
            }
        });

        adReward.onError(function (e) {
            console.log('[RewardedAd] 加载失败: ' + JSON.stringify(e));
            const code = e && (e.code != null ? e.code : e.errCode);
            let msg = (e && (e.errMsg || e.message)) || '广告加载失败';
            if (code === -5004) msg = '无广告模块，请云打包时勾选广告渠道SDK';
            else if (code === -5003) msg = '未开通广告或审核未通过';
            else if (code === -5005) msg = '暂无广告填充，请稍后重试';
            else if (code === -5002) msg = '广告位无效，请检查 adpid（正式包勿用测试位）';
            self._toast(msg);
            try { adReward.destroy(); } catch (_) {}
            self._adReward = null;
            self._busy = false;
            self._pendingPurpose = null;
            self._pendingCallback = null;
            self._pendingAttrKey = null;
        });

        adReward.onClose(function (e) {
            self._markCooldown();
            const finish = function () {
                try { adReward.destroy(); } catch (_) {}
                self._adReward = null;
                self._busy = false;
            };
            if (e && e.isEnded) {
                console.log('[RewardedAd] 激励视频播放完成，等待服务端回调');
                self._toast('正在校验广告…');
                const purpose = self._pendingPurpose;
                self._confirmServerTicket(purpose).then(function (conf) {
                    if (!conf || !conf.ok) {
                        self._pendingPurpose = null;
                        self._pendingCallback = null;
                        self._pendingAttrKey = null;
                        self._toast((conf && conf.error) || '广告校验失败');
                        finish();
                        return;
                    }
                    self._pendingTicket = conf.ticket || null;
                    self._applyPendingReward('plus.ad');
                    self._consumeTicket(self._pendingTicket);
                    self._pendingTicket = null;
                    finish();
                }).catch(function (err) {
                    console.warn('[RewardedAd] s2s', err);
                    self._pendingPurpose = null;
                    self._pendingCallback = null;
                    self._pendingAttrKey = null;
                    self._toast('广告校验异常');
                    finish();
                });
                return;
            }
            console.log('[RewardedAd] 激励视频未播放完成关闭');
            const failCb = self._pendingCallback;
            self._pendingPurpose = null;
            self._pendingCallback = null;
            self._pendingAttrKey = null;
            self._toast('需完整观看广告才能领取奖励');
            if (typeof failCb === 'function') {
                try { failCb(false); } catch (_) {}
            }
            finish();
        });

        try {
            adReward.load();
        } catch (e) {
            console.warn('[RewardedAd] load failed', e);
            this._toast('广告加载异常');
            this._destroy();
        }
    },

    _showDevFallback() {
        const purpose = this._pendingPurpose || 'signIn';
        const meta = {
            skipDay: {
                title: '📺 激励视频 · 次数补给（调试）',
                label: '跳一天',
                hint: `调试可点「模拟看完」为「跳一天」+${this.QUOTA_PER_AD} 次。`
            },
            bailout: {
                title: '📺 激励视频 · 破产救援（调试）',
                label: '破产抵还款',
                hint: '调试可点「模拟看完」抵扣本次欠款并继续游戏。'
            },
            liveQuota: {
                title: '📺 激励视频 · 直播次数（调试）',
                label: '直播次数',
                hint: `调试可点「模拟看完」为今日直播 +${this.LIVE_QUOTA_PER_AD || 1} 次。`
            },
            trafficBoost: {
                title: '📺 激励视频 · 流量包（调试）',
                label: '流量包',
                hint: `调试可点「模拟看完」领取 ${this.TRAFFIC_BOOST_HOURS || 6} 游戏小时免费流量。`
            },
            attrUpgrade: {
                title: '📺 激励视频 · 属性升级（调试）',
                label: '角色属性',
                hint: '调试可点「模拟看完」为所选属性 +1 级。'
            },
            signIn: {
                title: '📺 激励视频（调试）',
                label: '签到',
                hint: `调试可点「模拟看完」领取 ¥${this.REWARD_FUNDS.toLocaleString()}。`
            }
        };
        const info = meta[purpose] || meta.signIn;
        const title = info.title;
        const label = info.label;
        const rewardHint = info.hint;
        const isQuota = purpose === 'skipDay';
        try {
            if (typeof ui !== 'undefined' && ui && typeof ui.showModal === 'function') {
                ui.showModal(title, `
                    <div style="font-size:13px;line-height:1.7;color:#444;">
                        <div style="text-align:center;font-size:40px;margin-bottom:8px;">🎬</div>
                        <div>当前非 App 环境，无法调用 <code>plus.ad.createRewardedVideoAd</code>。</div>
                        <div style="margin-top:8px;">真机标准基座测试位 <code>${this.TEST_ADPID}</code>；本次用途 <b>${label}</b> 正式广告位 <code>${this.getAdpid(purpose)}</code>。</div>
                        <div style="margin-top:8px;color:#e65100;">${rewardHint}</div>
                    </div>`,
                    `<button class="btn btn-secondary" onclick="RewardedAdManager._failPending();ui.closeModal()">取消</button>
                     <button class="btn btn-primary" onclick="ui.closeModal();RewardedAdManager._applyPendingReward('dev-sim')">模拟看完并领奖</button>`,
                    { width: '480px' });
                return;
            }
        } catch (_) {}
        if (window.confirm(isQuota ? `模拟完整观看并为「${label}」+${this.QUOTA_PER_AD} 次？` : '模拟完整观看并领取 100 万？')) {
            this._applyPendingReward('dev-sim');
        } else {
            this._failPending();
        }
    },

    /**
     * 通用拉起激励视频
     * @param {'signIn'|'skipDay'|'bailout'|'liveQuota'|'trafficBoost'|'attrUpgrade'} purpose
     */
    _show(purpose) {
        const abortAttr = () => {
            if (purpose === 'attrUpgrade') this._pendingAttrKey = null;
        };
        if (!this._privacyOk()) {
            abortAttr();
            this._toast('请先同意隐私政策后再观看广告');
            return;
        }
        const cooldownSec = this.getCooldownRemainingSec();
        if (purpose !== 'bailout' && cooldownSec > 0) {
            abortAttr();
            this._toast(`广告冷却中，请 ${cooldownSec} 秒后再试`);
            return;
        }
        if (purpose === 'signIn' && this.hasClaimedToday()) {
            this._toast('今日已签到领奖，明天再来');
            return;
        }
        if (purpose === 'trafficBoost' && this.hasClaimedTrafficToday()) {
            this._toast('今日已领取过流量补给');
            return;
        }
        if (this._busy || this._adReward) {
            abortAttr();
            this._toast('正在加载激励视频广告');
            return;
        }

        this._pendingPurpose = purpose || 'signIn';

        let started = false;
        const run = (allowFallback) => {
            if (started) return;
            if (this.isAppRuntime()) {
                started = true;
                this._playRewardedVideo();
                return;
            }
            if (!allowFallback) return;
            started = true;
            this._showDevFallback();
        };

        if (typeof plus !== 'undefined' && plus.ad && typeof plus.ad.createRewardedVideoAd === 'function') {
            run(true);
            return;
        }
        document.addEventListener('plusready', function once() {
            document.removeEventListener('plusready', once);
            run(true);
        });
        setTimeout(function () { run(true); }, 2000);
    },

    /**
     * 签到入口
     */
    showForSignIn() {
        this._show('signIn');
    },

    /**
     * 次数补给入口（跳一天）
     */
    showForQuota(kind) {
        if (kind !== 'skipDay') {
            this._toast('未知次数类型');
            return;
        }
        this._show(kind);
    },

    /** 破产看广告抵还款 */
    showForBailout() {
        this._show('bailout');
    },

    /** 直播次数用尽：看广告 +1 */
    showForLiveQuota() {
        this._show('liveQuota');
    },

    /** 首页流量包：看广告获得数小时免费流量 */
    showForTrafficBoost() {
        this._show('trafficBoost');
    },

    /** 角色属性：看广告升一级 */
    showForAttrUpgrade(attrKey) {
        const key = String(attrKey || '');
        if (!key) {
            this._toast('未选择属性');
            return;
        }
        this._pendingAttrKey = key;
        this._show('attrUpgrade');
    },

    _failPending() {
        const cb = this._pendingCallback;
        this._pendingCallback = null;
        this._pendingPurpose = null;
        this._pendingAttrKey = null;
        if (typeof cb === 'function') {
            try { cb(false); } catch (_) {}
        }
    },

    /**
     * 半屏插屏（默认插屏广告 1700827121）
     * 不挡开屏/隐私；激励视频冷却期内不弹。
     */
    showInterstitial(reason) {
        try {
            if (!this._privacyOk()) return;
            if (this._busy || this._adReward) return;
            if (this.getCooldownRemainingSec() > 0) return;
            const gap = this.INTERSTITIAL_COOLDOWN_MS || 90000;
            if (this._lastInterstitialAt && Date.now() - this._lastInterstitialAt < gap) return;
            if (!this.isAppRuntime() || !plus.ad.createInterstitialAd) return;
            if (!this._privacyOk()) return;
            const adpid = this.getInterstitialAdpid();
            if (!adpid) return;

            if (this._adInterstitial) {
                try { this._adInterstitial.destroy(); } catch (_) {}
                this._adInterstitial = null;
            }
            const ad = plus.ad.createInterstitialAd({ adpid: adpid });
            this._adInterstitial = ad;
            const self = this;
            ad.onLoad(function () {
                try { ad.show(); } catch (e) { console.warn('[Interstitial] show', e); }
            });
            ad.onError(function (e) {
                console.log('[Interstitial] error', e);
                try { ad.destroy(); } catch (_) {}
                if (self._adInterstitial === ad) self._adInterstitial = null;
            });
            ad.onClose(function () {
                self._lastInterstitialAt = Date.now();
                try { ad.destroy(); } catch (_) {}
                if (self._adInterstitial === ad) self._adInterstitial = null;
            });
            console.log('[Interstitial] load', adpid, reason || '');
            ad.load();
        } catch (e) {
            console.warn('[Interstitial]', e);
        }
    },

    /** 兼容旧调用名：预加载（官方示例每次现场 create+load，此处空操作） */
    preload() {}
};

if (typeof window !== 'undefined') {
    window.RewardedAdManager = RewardedAdManager;
}
