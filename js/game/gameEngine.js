// 游戏引擎 - 时间系统与事件循环

// 兼容旧expressType到新serviceId的映射
function expressTypeToService(expressType) {
    if (expressType === 'economy') return 'standard'; // 经济型公司用standard服务
    if (expressType === 'freight') return 'freight';
    if (expressType === 'express' || expressType === 'next_day' || expressType === 'same_day') return expressType;
    return 'standard';
}

class GameEngine {
    constructor() {
        this.running = false;
        this.intervalId = null;
        this.speed = 1;
        this.tickCallbacks = [];
        // 自动运行：每跳推进 1 个游戏小时（正常时间流速，逐小时结算订单/物流/采购）
        this.hoursPerTick = 1;

        // ============== 动态刷新率 rAF 循环（订单多时自动降频，减轻CPU压力） ==============
        this.rafId = null;                  // requestAnimationFrame句柄
        this.lastFrameTime = 0;             // 上一帧时间戳(ms)
        this.frameCount = 0;                // 帧计数器（性能统计用）
        this.fps = 0;                       // 当前FPS
        this._lastFpsCheck = 0;             // FPS计算窗口
        this.tickStartRealTime = 0;         // 当前逻辑tick开始的真实时间戳(ms)
        this.tickDurationMs = 2000;         // 当前逻辑tick的预计周期(ms)；随 hoursPerTick 缩放
        this.highRefreshEnabled = false;    // 默认关闭高刷：经营模拟不需要 120Hz，手机 WebView 开了必卡
        this._frameCallbacks = [];          // 每帧回调集合（UI用于轻量插值更新）
        this._rafFrameCounter = 0;          // rAF原生帧计数器（用于降频时跳帧）
        this._lastScaleEval = 0;            // 上次评估数据规模的时间戳（每2秒评估一次降频目标，避免反复切换）
        this._rafCallInterval = 2;          // 每隔几帧执行一次回调（2≈30Hz，4→15Hz，6→10Hz；禁止跟屏 120Hz）
        this._tickBusy = false;             // 多小时分片推进中
        this._bootGraceUntil = 0;           // 启动后短暂延迟首跳，避免卡住开屏黑屏
        this._tickEpoch = 0;                // 分片 tick 世代号，stop/skip 时作废进行中的 chunk
        this._bootedOnce = false;
        // ===== 主线程健康度信号：rAF 默认关闭导致 fps 恒为 0、全部掉帧保护失效。
        // 改用「逻辑 tick + UI 整页渲染」的同步阻塞时长 EMA 推导 fps（60=流畅，越低越卡），
        // 让 _getAdaptiveTickMs / processOrderUpdates / ExpressEngine.tick / UI 节流里的 fps 分支真正生效。
        this._blockEma = 0;
        this._fpsLastReportAt = 0;
        // ===== 正常模式：逐小时跑系统（生单/订单推进/员工/物流每小时结算），时间每小时跳动 =====
        this.dayBatchMode = false;
    }

    start(opts) {
        if (this.running) return;
        this.running = true;
        // 健康度信号从流畅起步，首个 tick 完成后按实际阻塞时长收紧
        if (!(this.fps > 0)) { this.fps = 60; this._blockEma = 0; }
        // ⭐ 夹逼：速度只允许 1x 或 4x（移除了 2x 档位），读档时若 speed=2/3 等会自动纠正
        const rawSpeed = gameState.state.gameTime.speed;
        this.speed = this._normalizeSpeed(rawSpeed);
        gameState.setState(s => { s.gameTime.speed = this.speed; });
        this.tickStartRealTime = performance.now();
        const cold = !this._bootedOnce;
        this._bootedOnce = true;
        const immediate = !!(opts && opts.immediate);
        // 仅冷启动延后首跳，让开屏淡出；跳天/切回前台不再卡 3 秒
        if (cold && !immediate) {
            this._bootGraceUntil = Date.now() + 3200;
            this._scheduleNextTick(3200);
        } else {
            this._scheduleNextTick(immediate ? 80 : 400);
        }

        // 仅显式开启时才跑 rAF（默认关闭，避免跟屏把主线程占满）
        if (this.highRefreshEnabled && typeof requestAnimationFrame === 'function') {
            this._startRafLoop();
        }
    }

    stop() {
        this._tickEpoch = (this._tickEpoch || 0) + 1;
        this.running = false;
        this._tickBusy = false;
        if (this.intervalId) {
            clearTimeout(this.intervalId);
            this.intervalId = null;
        }
        // 停止rAF高刷循环
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        // 跨日结算：先同步冲掉再清定时器，避免漏结一天（房租/利息），
        // 同时配合 onNewDay 日锁，不会因冲刷而重复结算
        if (this._onNewDayTimer) {
            clearTimeout(this._onNewDayTimer);
            this._onNewDayTimer = null;
            try { this.safeCall('onNewDay', () => this.onNewDay()); } catch (_) {}
        }
    }

    /**
     * 按订单量 / FPS / 恢复缓冲 动态拉长逻辑 tick 间隔。
     * 暂停不卡、继续卡爆的根因：固定 2s/0.5s 一刀切把主线程打满。
     * 每跳 hoursPerTick 小时（默认12）：墙钟按约 1.2s/游戏小时 缩放，半天一跳节奏。
     */
    _getAdaptiveTickMs() {
        const hours = Math.max(1, this.hoursPerTick || 1);
        const base = (1200 * hours) / Math.max(1, this.speed || 1);
        let n = 0;
        try { n = (gameState && gameState.state && gameState.state.orders) ? gameState.state.orders.length : 0; } catch (_) {}
        let mul = 1;
        if (n > 3000) mul = 3.2;
        else if (n > 2000) mul = 2.6;
        else if (n > 1200) mul = 2.1;
        else if (n > 600) mul = 1.6;
        else if (n > 300) mul = 1.25;
        if (this.fps > 0 && this.fps < 24) mul *= 1.35;
        if (this.fps > 0 && this.fps < 14) mul *= 1.5;
        if (this._resumeGraceUntil && Date.now() < this._resumeGraceUntil) mul *= 1.8;
        let ms = base * mul;
        // 大订单硬地板：避免 4x 时过密调度把界面打爆（按本次跳过小时跨度放大）
        const hScale = Math.max(1, Math.min(hours, 12));
        if (n > 400) ms = Math.max(ms, (this.speed >= 4 ? 900 : 1800) * hScale * 0.55);
        if (n > 1500) ms = Math.max(ms, (this.speed >= 4 ? 1200 : 2400) * hScale * 0.55);
        if (n > 3000) ms = Math.max(ms, (this.speed >= 4 ? 1600 : 3200) * hScale * 0.55);
        return Math.min(Math.round(ms), 22000);
    }

    _scheduleNextTick(delayMs) {
        if (!this.running) return;
        if (this.intervalId) {
            clearTimeout(this.intervalId);
            this.intervalId = null;
        }
        let wait = (delayMs != null && delayMs >= 0) ? delayMs : this._getAdaptiveTickMs();
        try {
            // 暂停时只低频轮询，不空转重活
            if (gameState && typeof gameState.isPaused === 'function' && gameState.isPaused()) {
                wait = Math.max(800, Math.min(wait, 2000));
            }
        } catch (_) {}
        this.tickDurationMs = Math.max(wait, 1);
        this.intervalId = setTimeout(() => {
            this.intervalId = null;
            if (!this.running) return;
            if (this._tickBusy) {
                // 上一跳分片尚未结束，稍后再试
                this._scheduleNextTick(80);
                return;
            }
            this.tickStartRealTime = performance.now();
            let finished = false;
            const scheduleNext = () => {
                if (finished) return;
                finished = true;
                if (this.running) this._scheduleNextTick();
            };
            try {
                const ret = this.tick();
                if (ret && typeof ret.then === 'function') {
                    ret.then(scheduleNext, (e) => {
                        console.error('[GameEngine] scheduled tick error:', e);
                        scheduleNext();
                    });
                } else {
                    scheduleNext();
                }
            } catch (e) {
                console.error('[GameEngine] scheduled tick error:', e);
                scheduleNext();
            }
        }, this.tickDurationMs);
    }

    /** 主线程健康度上报：逻辑 tick 或 UI 渲染的同步阻塞时长 → 推导 fps（60=流畅）
     *  40ms 阻塞 → fps≈25；80ms → fps≈12；>250ms 视为严重卡顿（夹到 4） */
    _reportBlockMs(ms) {
        if (!(ms > 0) || !isFinite(ms)) return;
        const capped = Math.min(ms, 500);
        this._blockEma = this._blockEma > 0 ? this._blockEma * 0.7 + capped * 0.3 : capped;
        this.fps = Math.max(1, Math.min(60, Math.round(1000 / Math.max(8, this._blockEma))));
        this._fpsLastReportAt = Date.now();
    }

    /** 恢复游戏后进入缓冲期：先轻量 tick，避免瞬间卡爆 */
    onResumedFromPause() {
        this._resumeGraceUntil = Date.now() + 3500;
        this._tickSerial = 0;
        // 回弹健康度信号：暂停期间没有阻塞，恢复后从流畅起步（保护分支按实际表现再收紧）
        this._blockEma = 0;
        this.fps = 60;
        if (this.running) this._scheduleNextTick(400);
    }

    /**
     * 只允许 1x 和 4x（移除 2x 档位），对非法值做夹逼：
     *  - 1 / 4 → 直接保留
     *  - 其它正数 → 取最近的合法档位；相等距离取小的（例如 2→1，3→4）
     *  - 非正数 / 非数字 → 取 1
     */
    _normalizeSpeed(speed) {
        if (speed === 1 || speed === 4) return speed;
        const n = Number(speed);
        if (!isFinite(n) || n <= 0) return 1;
        const d1 = Math.abs(n - 1);
        const d4 = Math.abs(n - 4);
        return d1 <= d4 ? 1 : 4;
    }

    setSpeed(speed) {
        const normalized = this._normalizeSpeed(speed);
        this.speed = normalized;
        gameState.setState(s => { s.gameTime.speed = normalized; });
        this.tickStartRealTime = performance.now();
        if (this.running) {
            this._scheduleNextTick(0);
        } else {
            this.tickDurationMs = this._getAdaptiveTickMs();
        }
    }

    /**
     * ⏩ 跳过 N 天（默认1天）：分片推进 24*N 小时，避免订单多时主线程卡死
     *  - 忽略暂停状态（即使isPaused，也会推进时间）
     *  - 跨天事件（onNewDay）同步执行
     *  - 执行期间禁用按钮，防止连点
     *  - 订单量大时按小时分片 setTimeout(0) 让出 UI
     */
    skipDay(days = 1) {
        if (!days || days < 1) days = 1;
        days = Math.floor(days);
        if (this._skipping) return { ok: false, msg: '正在跳过中' };
        const s = gameState.state;
        if (s && s.gameOver && s.ending && s.ending.id !== 'bankrupt') {
            s.gameOver = false;
        }
        if (s && s.gameOver) return { ok: false, msg: '游戏已结束（已破产）' };

        // ===== 跳一天次数闸门（新档 50 次；用尽看广告 +5 / 花1000万买1次）=====
        let quotaLeft = 1;
        try {
            quotaLeft = (typeof gameState.getSkipDayQuota === 'function')
                ? gameState.getSkipDayQuota() : 1;
        } catch (_) {}
        if (!(quotaLeft > 0)) {
            try {
                if (typeof ui !== 'undefined' && typeof ui.promptSkipDayQuotaAd === 'function') {
                    ui.promptSkipDayQuotaAd();
                } else if (typeof ui !== 'undefined' && ui.showToast) {
                    ui.showToast('跳一天次数已用尽，看广告可 +5 次');
                } else if (typeof eventBus !== 'undefined') {
                    eventBus.emit('toast:show', { message: '跳一天次数已用尽，看广告可 +5 次', type: 'warning' });
                }
            } catch (_) {}
            return { ok: false, msg: '跳一天次数不足', needAd: true };
        }

        // 缴费通过后再扣次数，避免欠费拦截白扣
        // ===== 强制缴费闸门：欠薪/欠仓租未结清禁止跳天 =====
        try {
            const gate = this.assertDailyDuesClear({ autoPay: true });
            if (gate && gate.bankrupt) {
                this._forceBankruptForUnpaidDues(gate.reason || '欠费破产');
                return { ok: false, msg: gate.reason || '欠费破产', bankrupt: true };
            }
            if (gate && !gate.ok) {
                try {
                    if (typeof ui !== 'undefined' && ui.showToast) {
                        ui.showToast(gate.reason || '请先结清工资与仓库租金后再跳天');
                    } else if (typeof eventBus !== 'undefined') {
                        eventBus.emit('toast:show', { message: gate.reason || '请先结清欠费', type: 'error' });
                    }
                } catch (_) {}
                if (gate.needSalaryConfirm) {
                    try { this._openSalaryConfirmUI(); } catch (_) {}
                }
                return { ok: false, msg: gate.reason || '存在未结清费用', blocked: true };
            }
        } catch (e) {
            console.warn('[skipDay] dues gate', e);
        }

        if (typeof gameState.consumeSkipDayQuota === 'function' && !gameState.consumeSkipDayQuota()) {
            try {
                if (typeof ui !== 'undefined' && typeof ui.promptSkipDayQuotaAd === 'function') {
                    ui.promptSkipDayQuotaAd();
                }
            } catch (_) {}
            return { ok: false, msg: '跳一天次数不足', needAd: true };
        }

        // 跳一天推进（欠费拦截已在上方通过）
        const startDay = s ? s.gameTime.day : 0;
        const startHour = s ? s.gameTime.hour : 0;
        const btn = document.getElementById('skipDayBtn');
        if (btn) {
            btn.setAttribute('disabled', 'true');
            btn.style.opacity = '0.5';
            btn.style.pointerEvents = 'none';
            btn._oldText = btn.textContent || btn.innerHTML;
            btn.textContent = '跳过中…';
        }
        const wasRunning = !!this.running;
        this._skipping = true;
        this._tickEpoch = (this._tickEpoch || 0) + 1;
        this._tickBusy = false;
        if (wasRunning) this.stop();
        try {
            if (typeof OrderPerf !== 'undefined' && OrderPerf.ensure && s && s.orders) {
                OrderPerf.ensure(s.orders);
            }
        } catch (_) {}

        const orderCount = (s && Array.isArray(s.orders)) ? s.orders.length : 0;
        // 订单越多，每帧推进越少小时，优先保 UI 流畅
        const hoursPerChunk = orderCount > 8000 ? 1
            : (orderCount > 3000 ? 2
                : (orderCount > 800 ? 3 : 6));
        const totalHours = 24 * days;
        let done = 0;

        const finish = () => {
            try {
                // 跳天轻量模式下延后的一次性结算
                this.safeCall('checkAchievements', () => this.checkAchievements());
                this.safeCall('checkGameEndings', () => this.checkGameEndings());
                this.safeCall('expressBillsAfterSkip', () => {
                    if (typeof ExpressEngine !== 'undefined' && ExpressEngine.generateBills) {
                        ExpressEngine.generateBills();
                    }
                });
                if (typeof OrderPerf !== 'undefined' && OrderPerf.maybeLightPrune) {
                    OrderPerf.maybeLightPrune(gameState);
                }
            } catch (e) {
                console.error('[skipDay] 收尾结算失败:', e);
            } finally {
                this._skipping = false;
                let pendingSalary = false;
                try { pendingSalary = !!(gameState.state && gameState.state._salaryConfirmPending); } catch (_) {}
                if (pendingSalary) {
                    try {
                        if (typeof gameState.setPaused === 'function') gameState.setPaused(true);
                        else if (gameState.state && gameState.state.gameTime) gameState.state.gameTime.isPaused = true;
                    } catch (_) {}
                }
                if (wasRunning) this.start({ immediate: !pendingSalary });
                try {
                    if (typeof gameState.endNotifyBatch === 'function' && gameState.isNotifyBatching && gameState.isNotifyBatching()) {
                        gameState.endNotifyBatch(true);
                    }
                } catch (_) {}
                try { gameState.notify(); } catch (_) {}
                try { gameState.saveDebounced(); } catch (_) {}
                setTimeout(() => {
                    try {
                        if (typeof ui !== 'undefined' && ui && typeof ui.refreshSkipDayBtn === 'function') {
                            ui.refreshSkipDayBtn();
                        } else {
                            const b = document.getElementById('skipDayBtn');
                            if (!b) return;
                            b.removeAttribute('disabled');
                            b.style.opacity = '';
                            b.style.pointerEvents = '';
                            b.innerHTML = '⏩ 跳1天';
                        }
                    } catch (_) {}
                    try {
                        if (typeof RewardedAdManager !== 'undefined' && RewardedAdManager.showInterstitial) {
                            RewardedAdManager.showInterstitial('skipDayDone');
                        }
                    } catch (_) {}
                }, 200);
                try {
                    if (gameState.state && gameState.state._salaryConfirmPending) {
                        this._openSalaryConfirmUI();
                    }
                } catch (_) {}
            }
            const endDay = s ? s.gameTime.day : 0;
            const endHour = s ? s.gameTime.hour : 0;
            return {
                ok: true,
                startDay, startHour, endDay, endHour,
                daysSkipped: Math.max(0, endDay - startDay),
                async: true
            };
        };

        // 整段跳天合并 notify，避免每小时刷 UI
        try {
            if (typeof gameState.beginNotifyBatch === 'function') gameState.beginNotifyBatch();
        } catch (_) {}

        // ===== 日结模式跳天：每天只需「22:00 结算 + 0:00 翻日」两拍，极快 =====
        if (this.dayBatchMode) {
            const stepDay = () => {
                try {
                    // 当天 22:00 结算（若还没结算）
                    this.safeCall('settleDayBatch', () => this._settleDayBatch());
                    // 0:00 翻日
                    s.gameTime.hour = 0;
                    s.gameTime.day++;
                    try { GAME_syncRealDateToGameTime(s.gameTime); } catch (_) {}
                    this.safeCall('onNewDay', () => this.onNewDay());
                    done++;
                    if (s && s._salaryConfirmPending) {
                        done = days;
                        return;
                    }
                    if (btn && totalHours > 0) {
                        btn.textContent = `跳过中…第${s.gameTime.day}天`;
                    }
                    if (s && s.gameOver && s.ending && s.ending.id === 'bankrupt') {
                        done = days;
                        return;
                    }
                } catch (e) {
                    console.error('[skipDay] 日结跳天失败:', e);
                    done = days;
                }
                if (done >= days) {
                    finish();
                    return;
                }
                // 每天之间让出一帧，画面不掉帧
                setTimeout(stepDay, 24);
            };
            setTimeout(stepDay, 0);
            return { ok: true, started: true, async: true, startDay, startHour, totalHours };
        }

        const step = () => {
            try {
                const chunkEnd = Math.min(done + hoursPerChunk, totalHours);
                for (; done < chunkEnd; done++) {
                    this._skipOneTick({ light: true });
                    if (s && s._salaryConfirmPending) {
                        done = totalHours;
                        break;
                    }
                    if (s && s.gameOver && s.ending && s.ending.id === 'bankrupt') {
                        done = totalHours;
                        break;
                    }
                }
                if (btn && totalHours > 0) {
                    const pct = Math.min(99, Math.floor((done / totalHours) * 100));
                    btn.textContent = `跳过中…${pct}%`;
                }
            } catch (e) {
                console.error('[skipDay] 跳过一天失败:', e);
                done = totalHours;
            }
            if (done >= totalHours) {
                finish();
                return;
            }
            // 让出主线程，避免「订单多时点跳一天卡死」；爆单时块间再让出一帧，画面不掉帧
            let chunkPause = 0;
            try {
                chunkPause = (s && Array.isArray(s.orders) && s.orders.length > 800) ? 24 : 0;
            } catch (_) {}
            setTimeout(step, chunkPause);
        };
        setTimeout(step, 0);
        return { ok: true, started: true, async: true, startDay, startHour, totalHours };
    }

    /**
     * skipDay 专用单次 hour tick。
     * light=true：跳过每小时成就/结局/账单/UI回调（收尾统一做），大幅降低爆单卡顿。
     */
    _skipOneTick(opts = {}) {
        const light = !!(opts && opts.light);
        try {
            const time = gameState.state.gameTime;
            time.hour++;
            if (time.hour >= 24) {
                time.hour = 0;
                time.day++;
                try { GAME_syncRealDateToGameTime(time); } catch (e) { /* 保底不让游戏崩 */ }
                this.safeCall('onNewDay', () => this.onNewDay());
            }
            if (time.hour >= 8 && time.hour <= 22) {
                this.safeCall('simulateBusiness', () => this.simulateBusiness());
            }
            this.safeCall('processOrderUpdates', () => this.processOrderUpdates());
            // 每小时清理：待付款超过配置时长（默认 15 分钟）自动取消
            this.safeCall('cleanupTimeoutPendingPayments', () => {
                if (typeof gameState.cleanupTimeoutPendingPayments === 'function') {
                    gameState.cleanupTimeoutPendingPayments();
                }
            });
            this.safeCall('processPurchaseOrders', () => this.processPurchaseOrders());
            // 轻量跳天：采购计划/自动推广降频，优先保证订单推进不卡死
            if (!light || (time.hour % 3) === 0) {
                this.safeCall('processPurchasePlansHourly', () => this.processPurchasePlansHourly());
            }
            this.safeCall('processEmployeeTasks', () => this.processEmployeeTasks());
            if (!light || (time.hour % 4) === 0) {
                this.safeCall('runShopAutoPromotion', () => this.runShopAutoPromotion());
            }
            if (!light || (time.hour % 2) === 0) {
                this.safeCall('processPendingEvents', () => this.processPendingEvents());
                this.safeCall('processActiveEvents', () => this.processActiveEvents());
            }
            this.safeCall('processPromotions', () => this.processPromotions());
            this.safeCall('processLivestream', () => this.processLivestream());
            this.safeCall('checkLivestreamEnd', () => this.checkLivestreamEnd());
            if (!light || (time.hour % 6) === 0) {
                this.safeCall('checkFestivalEvent', () => this.checkFestivalEvent());
            }
            // 轻量模式：随机事件降频到每 4 小时一次，避免 24 次全量扫描
            if (!light || (time.hour % 4) === 0) {
                this.safeCall('checkRandomEvents', () => this.checkRandomEvents());
            }
            // 快递运单推进每小时仍需要；账单生成挪到跳天收尾（generateBills 本身也是日切触发）
            this.safeCall('expressTick', () => {
                if (typeof ExpressEngine !== 'undefined') {
                    ExpressEngine.tick(time);
                    if (!light) ExpressEngine.generateBills();
                }
            });
            if (!light) {
                this.safeCall('checkAchievements', () => this.checkAchievements());
                this.safeCall('checkGameEndings', () => this.checkGameEndings());
                this.safeCall('tickCallbacks', () => {
                    (this.tickCallbacks || []).forEach((cb, idx) => {
                        this.safeCall('tickCallback#' + idx, () => cb(time));
                    });
                });
            }
        } catch (e) {
            console.error('[GameEngine._skipOneTick] 出错:', e);
            eventBus.emit('game:error', { error: e, method: '_skipOneTick' });
        }
    }

    // ============== 动态刷新率 rAF 主循环（按订单数量严格3档：0单→90Hz / 1~100单→30Hz / >100单→15Hz） ==============
    _startRafLoop() {
        // 严格按订单数量分3档（与用户指定档位对齐）
        // 目标：无订单时丝滑(interval=1→跟屏约90Hz等效) / 1-100单降3倍(interval=3→30Hz) / >100单再降一半(interval=6→15Hz)
        const evalScale = (now) => {
            try {
                // 300ms 评估一次，保证订单在 0↔1 切换时能快速响应（比如刚完成/刚产生订单）
                if (now - this._lastScaleEval < 300) return;
                this._lastScaleEval = now;
                const s = (gameState && gameState.state) ? gameState.state : null;
                const orders = s && s.orders ? s.orders.length : 0;
                const shopLv = (s && s.shop && s.shop.level) || 1;
                let paused = false;
                try { paused = !!(gameState && typeof gameState.isPaused === 'function' && gameState.isPaused()); } catch (_) {}
                let targetInterval;
                // 跟屏 60/120Hz 会把 WebView 主线程打满；默认最高约 30Hz
                if (paused) targetInterval = 12;
                else if (orders === 0 && shopLv < 3) targetInterval = 2;  // 早期无单 → ~30Hz
                else if (orders <= 80 && shopLv < 3) targetInterval = 4;  // 早期少量 → ~15Hz
                else if (orders <= 300) targetInterval = 6;               // 中期 → ~10Hz
                else targetInterval = 8;                                  // 爆单 → ~8Hz
                // FPS 保护：掉帧严重时再额外升一档（保证逻辑tick不卡）
                if (this.fps > 0 && this.fps < 20 && targetInterval < 8) targetInterval++;
                if (this.fps > 0 && this.fps < 10 && targetInterval < 10) targetInterval++;
                this._rafCallInterval = targetInterval;
            } catch (e) {}
        };

        const loop = (now) => {
            if (!this.running) { this.rafId = null; return; }
            this.rafId = requestAnimationFrame(loop);

            // 计算delta和tick进度（用于UI插值/时间平滑显示）
            const dt = now - this.lastFrameTime;
            this.lastFrameTime = now;
            // 进度：当前逻辑tick已走的百分比（0~1），超过1按1处理
            let progress = (now - this.tickStartRealTime) / this.tickDurationMs;
            if (progress < 0) progress = 0;
            if (progress > 1.1) progress = 1.1; // 允许轻微溢出（setInterval有±抖动）

            // FPS统计（每秒刷新一次）
            this.frameCount++;
            if (now - this._lastFpsCheck >= 1000) {
                this.fps = this.frameCount;
                this.frameCount = 0;
                this._lastFpsCheck = now;
            }

            // 降频评估
            evalScale(now);

            // 动态跳帧：每隔 _rafCallInterval 帧才执行一次回调
            this._rafFrameCounter++;
            if (this._rafFrameCounter < this._rafCallInterval) return;
            this._rafFrameCounter = 0;

            try {
                if (gameState && typeof gameState.isPaused === 'function' && gameState.isPaused()) return;
            } catch (_) {}

            // 执行所有每帧轻量回调（UI用这些回调做插值，不整页重建DOM）
            // 同时把当前 FPS 传进去，UI侧可据此进一步减负（例如停掉虚拟分钟DOM写）
            for (let i = 0; i < this._frameCallbacks.length; i++) {
                try {
                    this._frameCallbacks[i](now, dt, progress, this.fps, this._rafCallInterval);
                } catch (e) {
                    // 单个回调失败不影响其他
                }
            }
        };
        this.lastFrameTime = performance.now();
        this._lastFpsCheck = this.lastFrameTime;
        this._lastScaleEval = 0;
        this._rafFrameCounter = 0;
        this._rafCallInterval = 2;
        this.rafId = requestAnimationFrame(loop);
    }

    // 注册/注销每帧回调
    onFrame(cb) {
        if (typeof cb === 'function' && this._frameCallbacks.indexOf(cb) === -1) {
            this._frameCallbacks.push(cb);
        }
    }
    offFrame(cb) {
        this._frameCallbacks = this._frameCallbacks.filter(x => x !== cb);
    }

    // 高刷模式开关（设置中可调）
    setHighRefresh(enabled) {
        this.highRefreshEnabled = !!enabled;
        if (this.running) {
            if (this.highRefreshEnabled && !this.rafId && typeof requestAnimationFrame === 'function') {
                this._startRafLoop();
            } else if (!this.highRefreshEnabled && this.rafId) {
                cancelAnimationFrame(this.rafId);
                this.rafId = null;
            }
        }
    }

    tick() {
        const tickStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
        let _batched = false;
        let _tickRan = false;
        const hoursPerTick = Math.max(1, this.hoursPerTick || 1);
        try {
            // ============= 暂停保护：isPaused=true 时立即中止，不推进时间不执行任何子逻辑 =============
            if (gameState.isPaused()) return;
            try {
                if (gameState.state && gameState.state._salaryConfirmPending) return;
            } catch (_) {}
            if (this._tickBusy) return;
            _tickRan = true;
            this._tickBusy = true;
            this._tickEpoch = (this._tickEpoch || 0) + 1;
            const epoch = this._tickEpoch;

            // 爆单性能：整点逻辑期间合并 notify，避免每单刷新 UI
            if (typeof gameState.beginNotifyBatch === 'function') {
                gameState.beginNotifyBatch();
                _batched = true;
            }

            const time = gameState.state.gameTime;
            this._tickSerial = (this._tickSerial || 0) + 1;

            const _orderN = (gameState.state.orders && gameState.state.orders.length) || 0;
            const _shopLv = (gameState.state.shop && gameState.state.shop.level) || 1;
            const _inGrace = !!(this._resumeGraceUntil && Date.now() < this._resumeGraceUntil);
            const _heavy = _orderN > 500 || _shopLv >= 3;
            const _veryHeavy = _orderN > 1400;
            const _extreme = _orderN > 2800;
            // 恢复缓冲 / 大订单：本 tick 尽量只做「时间 + 订单推进」
            const _lightTick = _inGrace || _veryHeavy || (this.fps > 0 && this.fps < 16 && _heavy);

            // 12 小时一跳：按订单量分片，避免同步连算卡死开屏/UI
            let hoursPerChunk = hoursPerTick;
            if (this.dayBatchMode) {
                // 日结模式：小时推进本身很轻，不再分片；重活只在 22:00 日结时发生一次
                hoursPerChunk = hoursPerTick;
            } else if (hoursPerTick > 3) {
                if (_orderN > 2000) hoursPerChunk = 1;
                else if (_orderN > 600) hoursPerChunk = 2;
                else if (_orderN > 150) hoursPerChunk = 3;
                else hoursPerChunk = Math.min(4, hoursPerTick);
            }

            const ctx = {
                time,
                hoursPerTick,
                _inGrace, _heavy, _veryHeavy, _extreme, _lightTick,
                _crossedNewDay: false,
                _settledForDay: null,
                _hoursAdvanced: 0,
                step: 0,
                hoursPerChunk,
                tickStart,
                _batched
            };

            let resolveTick = null;
            // 真实计算耗时（不含分片间的让帧停顿），用于慢 tick 判定与保护
            let computeMs = 0;
            const abortTick = () => {
                try {
                    if (ctx._batched && typeof gameState.endNotifyBatch === 'function') {
                        gameState.endNotifyBatch(false);
                    }
                } catch (_) {}
                this._tickBusy = false;
                if (typeof resolveTick === 'function') {
                    try { resolveTick(); } catch (_) {}
                    resolveTick = null;
                }
            };
            const finishTick = () => {
                if (epoch !== this._tickEpoch) {
                    abortTick();
                    return;
                }
                try {
                    // 成就/结局/账单：整跳结束后宏任务一次；大订单时再降频
                    if (!_inGrace && (!_veryHeavy || (this._tickSerial % 3 === 0))) {
                        setTimeout(() => {
                            if (gameState.isPaused && gameState.isPaused()) return;
                            const batch = typeof gameState.beginNotifyBatch === 'function';
                            if (batch) gameState.beginNotifyBatch();
                            try {
                                this.safeCall('checkAchievements', () => this.checkAchievements());
                                this.safeCall('checkGameEndings', () => this.checkGameEndings());
                                this.safeCall('expressBills', () => {
                                    if (typeof ExpressEngine !== 'undefined' && !_veryHeavy) {
                                        ExpressEngine.generateBills();
                                    }
                                });
                            } finally {
                                if (batch) gameState.endNotifyBatch(true);
                            }
                        }, 0);
                    }
                    if (!_lightTick) {
                        this.safeCall('tickCallbacks', () => {
                            (this.tickCallbacks || []).forEach((cb, idx) => {
                                this.safeCall('tickCallback#' + idx, () => cb(time));
                            });
                        });
                        this.safeCall('taxTick', () => {
                            if (typeof TaxEngine !== 'undefined') {
                                if (typeof TaxEngine.settleCurrentMonthIfNeeded === 'function') {
                                    TaxEngine.settleCurrentMonthIfNeeded(gameState);
                                }
                                if (typeof TaxEngine.checkTaxWindowAndEnforce === 'function') {
                                    TaxEngine.checkTaxWindowAndEnforce(gameState);
                                }
                            }
                        });
                        this.safeCall('legalTick', () => {
                            if (typeof LegalEngine !== 'undefined' && typeof LegalEngine.processTick === 'function') {
                                LegalEngine.processTick(gameState, Math.max(1, ctx._hoursAdvanced || hoursPerTick));
                            }
                        });
                    }

                    // 大订单：降频存档，避免每 tick JSON.stringify
                    if (!_veryHeavy || (this._tickSerial % 2 === 0)) {
                        gameState.saveDebounced();
                    }
                } catch (e) {
                    console.error('[GameEngine] tick() 发生严重错误:', e);
                    eventBus.emit('game:error', { error: e, method: 'tick' });
                } finally {
                    ctx._computeMs = computeMs;
                    this._finishTickNotify(ctx);
                    this._tickBusy = false;
                    if (typeof resolveTick === 'function') {
                        try { resolveTick(); } catch (_) {}
                        resolveTick = null;
                    }
                }
            };

            const runChunk = () => {
                if (epoch !== this._tickEpoch) {
                    abortTick();
                    return;
                }
                if (!this.running || (gameState.isPaused && gameState.isPaused())) {
                    finishTick();
                    return;
                }
                const chunkEnd = Math.min(ctx.step + ctx.hoursPerChunk, hoursPerTick);
                const c0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                while (ctx.step < chunkEnd) {
                    this._advanceOneGameHour(ctx);
                    ctx.step++;
                }
                computeMs += ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - c0;
                if (ctx.step < hoursPerTick) {
                    // ===== 爆单：块间让出一帧（约24ms），避免连续小时计算吃满主线程导致画面掉帧 =====
                    let chunkPause = 0;
                    try {
                        chunkPause = ((gameState.state.orders && gameState.state.orders.length) > 800) ? 24 : 0;
                    } catch (_) {}
                    setTimeout(runChunk, chunkPause);
                } else {
                    finishTick();
                }
            };

            // 分片时返回 Promise，供调度器等本跳结束再排下一跳
            if (hoursPerChunk < hoursPerTick) {
                return new Promise((resolve) => {
                    resolveTick = resolve;
                    runChunk();
                });
            }
            runChunk();
            return;
        } catch (e) {
            console.error('[GameEngine] tick() 发生严重错误:', e);
            eventBus.emit('game:error', { error: e, method: 'tick' });
            this._tickBusy = false;
            if (_batched && typeof gameState.endNotifyBatch === 'function') {
                try { gameState.endNotifyBatch(true); } catch (_) {}
            }
        }
    }

    /** 推进 1 个游戏小时（自动跳/分片跳共用） */
    _advanceOneGameHour(ctx) {
        const time = ctx.time;
        const hoursPerTick = ctx.hoursPerTick;
        const step = ctx.step;
        const { _inGrace, _heavy, _veryHeavy, _extreme, _lightTick } = ctx;

        time.hour++;
        ctx._hoursAdvanced++;

        if (time.hour >= 24) {
            time.hour = 0;
            time.day++;
            try { GAME_syncRealDateToGameTime(time); } catch (e) { /* 保底不让游戏崩 */ }
            ctx._crossedNewDay = true;
            // 跨天立刻日结（房租/海外到账/发薪），不能等到 12 小时整跳结束
            this.safeCall('onNewDay', () => this.onNewDay());
        }

        // ===== 日结模式：不再逐小时跑全系统；每天只在 22:00 结算当天、0:00 翻日 =====
        if (this.dayBatchMode) {
            // 22:00 一到，结算当天全部数据（每天一次）
            if ((ctx._settledForDay !== time.day) && time.hour >= 22) {
                ctx._settledForDay = time.day;
                this.safeCall('settleDayBatch', () => this._settleDayBatch());
            }
            // 其余小时仅推进时钟（订单/员工/快递等全部由 22:00 日结批量处理）
            return;
        }

        // 生单：极端积压/缓冲期跳过；很重时隔一小时
        if (!_inGrace && !_extreme && time.hour >= 8 && time.hour <= 22) {
            if (!_veryHeavy || (time.hour % 2 === 0)) {
                this.safeCall('simulateBusiness', () => this.simulateBusiness());
            }
        }

        this.safeCall('processOrderUpdates', () => this.processOrderUpdates());

        // 物流/采购/员工每小时都要跑：缓冲期只减生单和随机事件，避免「扣了钱不入库 / 包裹停摆」
        this.safeCall('expressTick', () => {
            if (typeof ExpressEngine !== 'undefined') {
                ExpressEngine.tick(time);
            }
        });

        if (!_lightTick) {
            this.safeCall('cleanupTimeoutPendingPayments', () => {
                if (typeof gameState.cleanupTimeoutPendingPayments === 'function') {
                    gameState.cleanupTimeoutPendingPayments();
                }
            });
            this.safeCall('processPurchaseOrders', () => this.processPurchaseOrders());
            this.safeCall('processPurchasePlansHourly', () => this.processPurchasePlansHourly());
            this.safeCall('processEmployeeTasks', () => this.processEmployeeTasks());
        } else {
            if ((this._tickSerial + step) % 2 === 0 || step === hoursPerTick - 1 || _inGrace) {
                this.safeCall('processPurchasePlansHourly', () => this.processPurchasePlansHourly());
                this.safeCall('processPurchaseOrders', () => this.processPurchaseOrders());
                this.safeCall('processEmployeeTasks', () => this.processEmployeeTasks());
            }
            if ((this._tickSerial + step) % 4 === 0 || step === hoursPerTick - 1) {
                this.safeCall('cleanupTimeoutPendingPayments', () => {
                    if (typeof gameState.cleanupTimeoutPendingPayments === 'function') {
                        gameState.cleanupTimeoutPendingPayments();
                    }
                });
            }
        }

        const _skipLight = (_heavy && (time.hour % 2 === 1)) || _lightTick;
        if (!_skipLight) {
            this.safeCall('runShopAutoPromotion', () => this.runShopAutoPromotion());
            this.safeCall('processPendingEvents', () => this.processPendingEvents());
            this.safeCall('processActiveEvents', () => this.processActiveEvents());
            this.safeCall('processPromotions', () => this.processPromotions());
            this.safeCall('checkFestivalEvent', () => this.checkFestivalEvent());
            this.safeCall('checkRandomEvents', () => this.checkRandomEvents());
        }
        if (!_lightTick || (time.hour % 3 === 0) || step === hoursPerTick - 1) {
            this.safeCall('processLivestream', () => this.processLivestream());
            this.safeCall('checkLivestreamEnd', () => this.checkLivestreamEnd());
        }

        // ===== 15 分钟微步：整点外补 15/30/45 分三次「待付款判定 + 超时取消」，
        // 让「待付款 15 分钟未付自动取消」在 1 小时粒度时钟下真实生效，积压消化 ×4 =====
        this.safeCall('quarterHourPendingTick15', () => this._quarterHourPendingTick(15));
        this.safeCall('quarterHourPendingTick30', () => this._quarterHourPendingTick(30));
        this.safeCall('quarterHourPendingTick45', () => this._quarterHourPendingTick(45));
    }

    // ==================== 日结模式：22:00 结算当天全部数据 ====================
    /**
     * 每晚 22:00 一次性结算：
     * 生单（自然单+推广）→ 订单流水线批量推进（支付/打包/发货/签收随机）→ 员工轮班 → 快递/采购/活动/税务/法务 → 成就/结局 → 裁剪
     */
    _settleDayBatch() {
        const now = gameState.state.gameTime;
        const day = now.day;
        // 当天已结算过（如 skipDay 先补结算），跳过避免重复生单（会话级标记，不入存档）
        if (this._lastSettledDay === day) return;
        this._lastSettledDay = day;
        const batch = typeof gameState.beginNotifyBatch === 'function';
        if (batch) gameState.beginNotifyBatch();
        try {
            // 订单时间随机：当天生成的订单随机落在 8~22 点之间
            const savedHour = now.hour;
            now.hour = 8 + Math.floor(Math.random() * 15);

            // 1) 生单：自然单 + 店铺自动推广（当天一次）
            this.safeCall('simulateBusiness', () => this.simulateBusiness());
            this.safeCall('runShopAutoPromotion', () => this.runShopAutoPromotion());

            // 2) 订单流水线批量推进（分 4 轮，每轮覆盖 400~700 单；轮间虚拟 +6h 供员工任务完成）
            this.safeCall('processOrderUpdates', () => this.processOrderUpdates());
            this.safeCall('employeeShifts', () => this._runEmployeeDayShifts());
            this.safeCall('processOrderUpdates', () => this.processOrderUpdates());
            this.safeCall('processOrderUpdates', () => this.processOrderUpdates());

            now.hour = savedHour;

            // 3) 快递运单按天推进（以当天 23 点为基准）
            this.safeCall('expressTick', () => {
                if (typeof ExpressEngine !== 'undefined') {
                    ExpressEngine.tick({ day, hour: 23 });
                }
            });

            // 4) 采购：进货单到货 + 采购计划执行（日频，符合计划语义）
            this.safeCall('processPurchaseOrders', () => this.processPurchaseOrders());
            this.safeCall('processPurchasePlansHourly', () => this.processPurchasePlansHourly());
            this.safeCall('cleanupTimeoutPendingPayments', () => {
                if (typeof gameState.cleanupTimeoutPendingPayments === 'function') {
                    gameState.cleanupTimeoutPendingPayments();
                }
            });

            // 5) 促销/活动/直播/随机事件（当天一次）
            this.safeCall('processPendingEvents', () => this.processPendingEvents());
            this.safeCall('processActiveEvents', () => this.processActiveEvents());
            this.safeCall('processPromotions', () => this.processPromotions());
            this.safeCall('checkFestivalEvent', () => this.checkFestivalEvent());
            this.safeCall('checkRandomEvents', () => this.checkRandomEvents());
            this.safeCall('processLivestream', () => this.processLivestream());
            this.safeCall('checkLivestreamEnd', () => this.checkLivestreamEnd());

            // 6) 税务/法务/客服（按整天计）
            this.safeCall('taxTick', () => {
                if (typeof TaxEngine !== 'undefined') {
                    if (typeof TaxEngine.checkTaxWindowAndEnforce === 'function') {
                        TaxEngine.checkTaxWindowAndEnforce(gameState);
                    }
                }
            });
            this.safeCall('legalTick', () => {
                if (typeof LegalEngine !== 'undefined' && typeof LegalEngine.processTick === 'function') {
                    LegalEngine.processTick(gameState, 24);
                }
            });

            // 7) 成就/结局（每天一次，替代每小时）
            this.safeCall('checkAchievements', () => this.checkAchievements());
            this.safeCall('checkGameEndings', () => this.checkGameEndings());

            // 8) 裁剪（保留订单/运单/日志上限）
            try {
                if (typeof OrderPerf !== 'undefined' && OrderPerf.maybeLightPrune) {
                    OrderPerf.maybeLightPrune(gameState);
                }
            } catch (_) {}
        } catch (e) {
            console.error('[settleDayBatch]', e);
            try { if (typeof eventBus !== 'undefined') eventBus.emit('game:error', { error: e, method: 'settleDayBatch' }); } catch (_) {}
        } finally {
            if (batch) {
                try { gameState.endNotifyBatch(true); } catch (_) {}
            }
        }
    }

    /**
     * 员工当日轮班：虚拟推进时钟让打包/发货/客服任务完成并再分配（4 个班次），
     * 推广任务每天只跑 1 次（避免逐小时推广刷爆订单）。
     */
    _runEmployeeDayShifts() {
        const gt = gameState.state.gameTime;
        const saved = { day: gt.day, hour: gt.hour };
        const SHIFTS = 4;
        const marketerDoneKey = [];
        try {
            for (let s = 0; s < SHIFTS; s++) {
                this.safeCall('processEmployeeTasks', () => this.processEmployeeTasks());
                // 虚拟推进 6 小时（仅用于任务时长判定，结算结束后还原）
                gt.hour += 6;
                if (gt.hour >= 24) {
                    gt.hour -= 24;
                    gt.day += 1;
                    try { GAME_syncRealDateToGameTime(gt); } catch (_) {}
                }
                // 推广每天一次：第一次班次跑完后锁定当天
                (gameState.state.employees || []).forEach(emp => {
                    if (!emp || emp.status !== 'active') return;
                    if (s === 0 && emp.currentTask && emp.currentTask.type === 'marketing') {
                        marketerDoneKey.push(emp.id);
                    }
                    if (marketerDoneKey.indexOf(emp.id) >= 0 && s >= 1) {
                        emp._lastMarketingKey = 'D' + saved.day + 'H23';
                    }
                });
            }
        } catch (e) {
            console.warn('[employeeShifts]', e);
        } finally {
            gt.day = saved.day;
            gt.hour = saved.hour;
        }
    }

    _finishTickNotify(ctx) {
        const tickStart = (ctx && ctx.tickStart) || 0;
        const _batched = !!(ctx && ctx._batched);
        try {
            const n = (gameState.state.orders && gameState.state.orders.length) || 0;
            const uiRef = (typeof ui !== 'undefined') ? ui
                : (typeof window !== 'undefined' ? window.ui : null);
            if (uiRef) {
                const now = Date.now();
                let minFull = n > 2500 ? 3200 : (n > 1200 ? 2000 : (n > 400 ? 1600 : 1100));
                // fps 保护：已掉帧时进一步拉长整页重建间隔（DOM 重建比逻辑更伤帧，最多压到 6s 一次）
                if (this.fps > 0 && this.fps < 20) minFull = Math.min(6000, Math.round(minFull * 1.6));
                const last = uiRef._lastFullRenderAt || 0;
                // 运行中每跳都会改浏览量/资金：若整页重建，1x 约每秒一次、4x 约每 300ms 一次，WebView 必卡
                if (last && (now - last) < minFull) {
                    uiRef._preferHeaderOnlyUpdate = true;
                }
            }
        } catch (_) {}

        if (_batched && typeof gameState.endNotifyBatch === 'function') {
            try { gameState.endNotifyBatch(true); } catch (_) {}
        } else {
            try { gameState.notify(); } catch (_) {}
        }
        const tickEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();
        // ===== 慢判定只看真实计算耗时（不含分片间为让帧而主动停顿的 24ms×N）=====
        const wallDur = tickEnd - tickStart;
        const dur = (typeof ctx._computeMs === 'number' && ctx._computeMs >= 0) ? ctx._computeMs : wallDur;
        // ===== 主线程健康度信号：逻辑阻塞时长 → fps（修复 rAF 关闭时 fps 恒为 0、掉帧保护全部失效）=====
        try { this._reportBlockMs(dur); } catch (_) {}
        if (dur > 120) {
            console.warn('[TickSlow] 单次逻辑tick(' + (this.hoursPerTick || 1) + 'h)计算耗时 ' + Math.round(dur) + 'ms。订单数：' +
                ((gameState && gameState.state && gameState.state.orders) ? gameState.state.orders.length : 0));
        }
        if (dur > 200) {
            // 慢 tick：拉长下一次间隔，把时间让给 UI
            this._resumeGraceUntil = Math.max(this._resumeGraceUntil || 0, Date.now() + 1200);
        }
        if (dur > 500) {
            try {
                const uiRef = (typeof ui !== 'undefined') ? ui
                    : (typeof window !== 'undefined' ? window.ui : null);
                if (uiRef) uiRef._slowRenderCount = 3;
            } catch (e) {}
        }
        try {
            if (typeof OrderPerf !== 'undefined' && OrderPerf.maybeLightPrune) {
                OrderPerf.maybeLightPrune(gameState);
            }
        } catch (_) {}
    }

    /**
     * 大批量订单任务分片执行（打包/发货/自定义批处理可复用）
     * @param {Array} items
     * @param {function} worker (item, index) => void
     * @param {{chunkSize?:number, pauseMs?:number}} [options]
     */
    runOrderWorkChunked(items, worker, options) {
        if (typeof OrderPerf !== 'undefined' && typeof OrderPerf.runChunked === 'function') {
            return OrderPerf.runChunked(items, worker, options);
        }
        for (let i = 0; i < (items || []).length; i++) worker(items[i], i);
        return Promise.resolve({ processed: (items && items.length) || 0 });
    }

    safeCall(name, fn) {
        try {
            fn();
        } catch (e) {
            console.error(`[GameEngine] ${name}() 执行出错:`, e);
            eventBus.emit('game:error', { error: e, method: name });
        }
    }

    onNewDay() {
        const day = (gameState.state && gameState.state.gameTime) ? gameState.state.gameTime.day : 0;
        // 同一游戏日只跑一次日结，防止利息/福利/房租等被重复结算
        if (day && gameState.state._lastOnNewDayDay === day) return;
        if (day) gameState.state._lastOnNewDayDay = day;
        const batch = typeof gameState.beginNotifyBatch === 'function';
        if (batch) gameState.beginNotifyBatch();
        try {
        // 日切时强制自愈一次孤儿库存（平时按小时节流）
        try {
            if (gameState.warehouse && typeof gameState.warehouse.repairOrphanInventory === 'function') {
                gameState.warehouse.repairOrphanInventory(true);
            }
        } catch (_) {}
        this.safeCall('processEmployeeWelfareDaily', () => this.processEmployeeWelfareDaily());
        this.safeCall('processOverseasSettlements', () => {
            try {
                if (typeof overseasUI !== 'undefined' && overseasUI && typeof overseasUI.processDailySettlements === 'function') {
                    const r = overseasUI.processDailySettlements();
                    if (r && r.settled > 0) {
                        console.log(`[Overseas] 到账 ${r.settled} 笔，合计 ¥${(r.amount || 0).toFixed(2)}`);
                        try {
                            if (typeof eventBus !== 'undefined') {
                                eventBus.emit('toast:show', {
                                    message: `🌍 海外货款到账 ¥${Math.round(r.amount || 0)}（${r.settled}笔）`,
                                    type: 'success'
                                });
                            }
                        } catch (_) {}
                    }
                    if (r && r.cancelled > 0) {
                        try {
                            if (typeof eventBus !== 'undefined') {
                                eventBus.emit('toast:show', {
                                    message: `🌍 ${r.cancelled} 笔外贸单因逾期未履约已取消`,
                                    type: 'warning'
                                });
                            }
                        } catch (_) {}
                    }
                    if (r && r.inquiries > 0) {
                        try {
                            if (typeof eventBus !== 'undefined') {
                                eventBus.emit('toast:show', {
                                    message: `🌍 收到 ${r.inquiries} 条海外询盘，可去海外贸易接单`,
                                    type: 'info'
                                });
                            }
                        } catch (_) {}
                    }
                }
            } catch (e) { console.warn('[Overseas] 结算失败', e); }
        });
        this.safeCall('generateDailyStats', () => this.generateDailyStats());
        this.safeCall('checkCampaignExpiry', () => this.checkCampaignExpiry());
        this.safeCall('checkEndorsementExpiry', () => this.checkEndorsementExpiry());
        this.safeCall('checkAndSettleMonthlySalary', () => this.checkAndSettleMonthlySalary());
        this.safeCall('processBankDaily', () => this.processBankDaily());
        this.safeCall('updateSupplierRelations', () => this.updateSupplierRelations());
        this.safeCall('calculateUsedCapacity', () => this.calculateUsedCapacity());
        this.safeCall('processCouponExpiry', () => gameState.processCouponExpiry());
        this.safeCall('dailyPromotionUpdate', () => gameState.dailyPromotionUpdate());
        this.safeCall('dailyBenefitsReset', () => gameState.dailyBenefitsReset());
        // 直播IP养成：每日直播次数重置 + 活跃粉丝窗口跨日清理（P0）
        this.safeCall('livestreamDailyReset', () => {
            if (typeof liveState !== 'undefined' && liveState && typeof liveState.livestreamDailyReset === 'function') {
                try { liveState.livestreamDailyReset(); } catch (_) {}
            }
        });
        // 直播IP养成：长期不直播 → 路人粉衰减（P1，每 7 天 -2%）
        this.safeCall('livestreamFanDecay', () => {
            if (typeof liveState !== 'undefined' && liveState && typeof liveState.decayInactiveFans === 'function') {
                try {
                    const r = liveState.decayInactiveFans();
                    if (r && r.decayed > 0) {
                        console.log(`[Livestream] 长期未直播（${r.periods}个周期），路人粉 -${r.decayed}`);
                    }
                } catch (_) {}
            }
        });
        // 市场行情每日批量EMA平滑刷新（仅对已缓存的商品）
        this.safeCall('refreshMarketDaily', () => gameState.refreshMarketDaily());
        // 包装材料ERP模块：采购到货 + 存储成本 + 日度预警
        this.safeCall('processPackagingDaily', () => this.processPackagingDaily());
        this.safeCall('chargeWarehouseMonthlyRent', () => this.chargeWarehouseMonthlyRent());
        this.safeCall('chargeWarehouseDailyRent', () => this.chargeWarehouseDailyRent());
        this.safeCall('processPackagingPurchaseArrival', () => this.processPackagingPurchaseArrival());
        // 每日订单清理：超时未付款取消 + 已完成订单清理
        this.safeCall('dailyOrderCleanup', () => this.dailyOrderCleanup());
        // 仓储管理模块：自动执行到期采购计划（扣钱→入库→生成回扣记录）
        this.safeCall('processPurchasePlansDaily', () => this.processPurchasePlansDaily());
        // ===== 多店铺系统（阶段B）：调拨到达 + 渠道店独立日结 =====
        this.safeCall('processShopTransfers', () => {
            try {
                if (typeof ShopsState !== 'undefined' && gameState && gameState.shops && typeof gameState.shops.processTransfers === 'function') {
                    const r = gameState.shops.processTransfers();
                    if (r && r.arrived > 0) console.log('[Shops] 调拨到货', r.arrived, '笔');
                }
            } catch (e) { console.warn('[Shops] processTransfers 异常', e); }
        });
        this.safeCall('settleChannelShops', () => {
            try {
                if (typeof ShopsState !== 'undefined' && gameState && gameState.shops && typeof gameState.shops.settleChannelShops === 'function') {
                    const r = gameState.shops.settleChannelShops();
                    if (r && r.settled > 0) console.log(`[Shops] 渠道店日结：售出${r.settled}件，收入¥${(r.income || 0).toFixed(2)}`);
                }
            } catch (e) { console.warn('[Shops] settleChannelShops 异常', e); }
        });
        // 运营风险阈值：取消率/退货率超标触发封禁或降分
        this.safeCall('checkOpsRiskThresholds', () => {
            if (typeof gameState.checkOpsRiskThresholds === 'function') {
                gameState.checkOpsRiskThresholds();
            }
        });

        // ===== 修改2b：跨天 0 点，货源断供 digest 模式 -> 汇总 1 个 Toast =====
        try {
            const state = gameState.state;
            const digest = state?._supplyOutageDigest;
            const today = state?.gameTime?.day || 1;
            if (digest && typeof digest.count === 'number' && digest.count > 0) {
                const notify = state?.settings?.supplyOutageNotifyLevel;
                if (notify === 'digest') {
                    // 跨天提示（昨天的断供汇总）
                    const count = digest.count;
                    const names = Array.isArray(digest.lastNames) ? digest.lastNames.slice(0, 3).join('、') : '';
                    const more = Array.isArray(digest.lastNames) && digest.lastNames.length > 3 ? '等' : '';
                    const summaryMsg = `昨日货源断供提醒汇总：${count}次${names ? '（' + names + more + '）' : ''}，请留意库存`;
                    setTimeout(() => {
                        try {
                            const toastEvt = {
                                id: '_supply_digest',
                                name: '📢 货源断供每日汇总',
                                icon: '📉',
                                type: 'neutral',
                                effect: { message: summaryMsg }
                            };
                            this.showEventToast(toastEvt);
                        } catch (_) {}
                    }, 1200);
                }
            }
            // 无论什么模式，跨天都重置昨日累计（但保留 day=today，避免当天 9 点前触发的情况被清掉）
            if (digest) {
                digest.day = today;
                digest.count = 0;
                digest.lastNames = [];
            }
        } catch (_digestErr) {
            console.warn('[onNewDay] supplyOutageDigest summary err:', _digestErr);
        }

        this.safeCall('taxSettleMonth', () => {
            if (typeof TaxEngine !== 'undefined' && typeof TaxEngine.settleCurrentMonthIfNeeded === 'function') {
                TaxEngine.settleCurrentMonthIfNeeded(gameState);
            }
        });
        this.safeCall('leaderboardSubmit', () => {
            if (typeof LeaderboardClient !== 'undefined' && typeof LeaderboardClient.onGameDayMaybeSubmit === 'function') {
                LeaderboardClient.onGameDayMaybeSubmit(gameState);
            }
        });
        } finally {
            if (batch) {
                try { gameState.endNotifyBatch(true); } catch (_) {}
            }
        }
    }

    _getWarehouseState() {
        return (typeof window !== 'undefined' && window.warehouseState)
            || (typeof warehouseState !== 'undefined' ? warehouseState : null)
            || (gameState && gameState.warehouse)
            || (gameState && gameState._warehouseState)
            || null;
    }

    // 每日/整点：执行到期的采购计划（支持新版 scheduleType 自动补货）
    processPurchasePlansDaily() {
        this._runPurchasePlansTick('daily');
    }

    processPurchasePlansHourly() {
        this._runPurchasePlansTick('hourly');
    }

    _runPurchasePlansTick(mode) {
        try {
            const gt = gameState?.state?.gameTime || { day: 1, hour: 0 };
            const today = gt.day || 1;
            const hour = gt.hour || 0;
            const whState = this._getWarehouseState();
            if (!whState || typeof whState.runDuePurchasePlans !== 'function') return;
            try { whState.gameState = whState.gameState || gameState; } catch (_) {}
            const res = whState.runDuePurchasePlans(today, { hour });
            if (!res || (!(res.executed > 0) && !(res.skipped > 0))) return;
            const ok = (res.details || []).filter(r => r.ok && !r.skippedEmpty);
            const fail = (res.details || []).filter(r => !r.ok);
            if (ok.length > 0) {
                const totalQty = ok.reduce((s, r) => s + (r.totalQty || 0), 0);
                const totalAmt = ok.reduce((s, r) => s + (r.totalAmt || 0), 0);
                console.log(`[PurchasePlans][${mode}] 自动执行 ${ok.length} 个计划：${totalQty}件 / ¥${totalAmt.toFixed(2)}`);
                try {
                    if (typeof eventBus !== 'undefined') {
                        eventBus.emit('toast:show', {
                            message: `🛒 采购员已自动采购 ${totalQty} 件（¥${totalAmt.toFixed(0)}）`,
                            type: 'success'
                        });
                    }
                } catch (_) {}
            }
            if (fail.length > 0) {
                console.warn(`[PurchasePlans][${mode}] 跳过/失败 ${fail.length} 个计划：`, fail.slice(0, 3));
            }
        } catch (e) {
            console.error('[PurchasePlans] 自动采购执行异常：', e);
        }
    }

    // 每日订单清理
    dailyOrderCleanup() {
        try {
            // 1. 清理超时未付款订单
            const paymentResult = gameState.cleanupTimeoutPendingPayments();
            if (paymentResult && paymentResult.cancelledCount > 0) {
                console.log(`[OrderCleanup] 取消了${paymentResult.cancelledCount}个超时未付款订单`);
            }
            // 2. 爆单后裁剪终态订单/运单，降低 tick 与存档体积
            const n = (gameState.state.orders && gameState.state.orders.length) || 0;
            const shopLv = (gameState.state.shop && gameState.state.shop.level) || 1;
            // 二心起每天至少轻裁一次；订单>500 或店铺≥3 即触发
            if (typeof gameState._pruneOldData === 'function' && (n > 500 || shopLv >= 3)) {
                const aggressive = n > 1800 || shopLv >= 4;
                const before = n;
                gameState._pruneOldData(aggressive);
                const after = (gameState.state.orders && gameState.state.orders.length) || 0;
                if (before !== after) {
                    console.log(`[OrderCleanup] 裁剪订单 ${before} → ${after}${aggressive ? '（激进）' : ''}`);
                }
            }
        } catch (e) {
            console.error('[OrderCleanup] 订单清理出错:', e);
        }
    }

    // 包装材料每日处理：仅库存预警（不再按货值扣「仓储费」）
    // 包材买进时已 spendFunds，发货只扣库存；再按库存货值日扣会把财务「包装物料」刷成每天几万
    processPackagingDaily() {
        const today = gameState.state.gameTime.day;
        // 每日库存预警汇总（critical 和 high 级别），写入仓库日志（每3天只提醒一次防止刷屏）
        if (typeof gameState.getPackagingAlerts === 'function'
            && typeof gameState.addWarehouseLog === 'function') {
            const alerts = gameState.getPackagingAlerts();
            const severe = alerts.filter(a => a.level === 'critical' || a.level === 'high');
            const warehouse = gameState.state.warehouse || {};
            const lastAlertDay = warehouse._packagingLastAlertDay || -99;
            if (severe.length > 0 && today - lastAlertDay >= 2) {
                gameState.setState(s => {
                    if (!s.warehouse) s.warehouse = {};
                    s.warehouse._packagingLastAlertDay = today;
                });
                const names = severe.slice(0, 5).map(a => `${a.icon||''}${a.name}×${a.quantity}`).join('，');
                gameState.addWarehouseLog('low_stock', {
                    memo: `包装材料预警${severe.length}项（${names}${severe.length > 5 ? '...' : ''}），请及时补货`,
                    count: severe.length
                });
            }
        }
    }

    // 包装材料采购到货自动处理（采购中状态 today >= estimatedArrivalDay → 自动入库）
    processPackagingPurchaseArrival() {
        if (!gameState.getPackagingPurchaseReqs || !gameState.transitionPackagingPurchaseReq) return;
        const today = gameState.state.gameTime.day;
        const { list } = gameState.getPackagingPurchaseReqs({ status: 'purchasing' });
        const arrived = list.filter(r => r.estimatedArrivalDay && today >= r.estimatedArrivalDay);
        arrived.forEach(req => {
            // 20%概率延迟1天，体现供应商时效波动
            if (Math.random() < 0.2 && today === req.estimatedArrivalDay) return;
            const res = gameState.transitionPackagingPurchaseReq(req.id, 'receive', '系统自动到货入库');
            if (res && res.success && gameState.addWarehouseLog) {
                gameState.addWarehouseLog('package_in', {
                    memo: `【包装采购单${req.id.substr(-6)}】到货入库 ¥${(req.actualCost||req.totalAmount).toFixed(2)}（${req.supplierName||''}）`
                });
            }
        });
    }

    // 日处理：员工在职天数累加（用于福利档位晋升条件）
    processEmployeeWelfareDaily() {
        const day = (gameState.state && gameState.state.gameTime) ? gameState.state.gameTime.day : 0;
        if (day && gameState.state._lastWelfareDay === day) return;
        if (day) gameState.state._lastWelfareDay = day;
        const employees = gameState.state.employees || [];
        for (let i = 0; i < employees.length; i++) {
            const e = employees[i];
            if (!e || e.status !== 'active') continue;
            e.workDays = (e.workDays || 0) + 1;
        }
    }

    settleEmployeeSalaries() {
        // 统一走完整工资单（含五险一金），与员工管理→薪酬核算一致
        if (typeof gameState.settleEmployeeSalaries === 'function') {
            return gameState.settleEmployeeSalaries();
        }
        const employees = gameState.state.employees.filter(e => e.status === 'active');
        if (employees.length === 0) return { success: true, total: 0 };
        const totalSalary = gameState.calculateTotalMonthlySalary();
        if (totalSalary > 0) {
            if (!gameState.spendFunds(totalSalary, '员工月薪')) {
                return { success: false, total: totalSalary, message: '资金不足，月薪未能发放' };
            }
        }
        return { success: true, total: totalSalary };
    }

    /** 打开发薪确认弹窗（暂停时间，避免弹窗期间继续跨天；记住弹窗前玩家是否已暂停，关闭时原样恢复） */
    _openSalaryConfirmUI() {
        let wasPaused = false;
        try {
            wasPaused = !!(typeof gameState.isPaused === 'function' && gameState.isPaused());
            if (typeof gameState.setPaused === 'function') {
                gameState.setPaused(true);
            } else if (gameState.state && gameState.state.gameTime) {
                gameState.state.gameTime.isPaused = true;
            }
        } catch (_) {}
        // 记录弹窗打开前的暂停状态，确认/稍后发放后原样恢复，避免「跳天后时间停不下来/自动恢复」
        try {
            if (gameState.state && gameState.state._salaryConfirmPending) {
                gameState.state._salaryConfirmPending.wasPaused = !!wasPaused;
            }
        } catch (_) {}
        // 暂停后同步禁用跳一天按钮（与 1x/4x 一致）
        try {
            if (typeof ui !== 'undefined' && typeof ui.refreshSkipDayBtn === 'function') {
                ui.refreshSkipDayBtn();
            }
        } catch (_) {}
        setTimeout(() => {
            try {
                if (typeof ui !== 'undefined' && typeof ui.showMonthlySalaryConfirmModal === 'function') {
                    ui.showMonthlySalaryConfirmModal();
                } else {
                    eventBus.emit('toast:show', {
                        message: '📅 今日为发薪日，请到「员工管理→薪酬核算」确认发放',
                        type: 'warning'
                    });
                }
            } catch (e) {
                console.warn('[salary] 打开发薪确认失败:', e && e.message);
            }
        }, 80);
    }
    
    /**
     * 每月1号（30天制）触发发薪确认弹窗，确认后才扣款发放
     */
    checkAndSettleMonthlySalary() {
        const now = gameState.state.gameTime;
        const day = now.day || 1;
        const dayOfMonth = ((day - 1) % 30) + 1;
        if (dayOfMonth !== 1) return false;

        const state = gameState.state;
        // 当日已发放 / 已推迟 / 已在等待确认 → 不再重复弹
        if ((state.lastSalaryPayDay || 0) === day) return false;
        if ((state._salaryDeferredPayday || 0) === day) return false;
        if (state._salaryConfirmPending && state._salaryConfirmPending.day === day) {
            if (!this._skipping) this._openSalaryConfirmUI();
            return 'pending';
        }

        const activeCount = (state.employees || []).filter(e => e && e.status === 'active').length;
        const hasBuyers = !!(typeof warehouseState !== 'undefined' && warehouseState
            && Array.isArray(warehouseState.state?.buyers)
            && warehouseState.state.buyers.some(b => b && b.status === 'active'));
        if (activeCount <= 0 && !hasBuyers) {
            state.lastSalaryPayDay = day;
            return false;
        }

        if (!Array.isArray(state._salaryMissedPaydays)) state._salaryMissedPaydays = [];
        if (!state._salaryMissedPaydays.includes(day)) state._salaryMissedPaydays.push(day);

        state._salaryConfirmPending = {
            day: day,
            period: `第${Math.floor((day - 1) / 30) + 1}月`,
            employeeCount: activeCount
        };

        // 跳天中只记pending，结束后再弹
        if (this._skipping) return 'pending';

        this._openSalaryConfirmUI();
        return 'pending';
    }

    /**
     * 玩家确认发薪：发放所有未结发薪日（跳天可能累计多个）
     */
    confirmMonthlySalary() {
        const state = gameState.state;
        const hasMissed = !!(state._salaryMissedPaydays && state._salaryMissedPaydays.length);
        const hasPending = !!(state._salaryConfirmPending && state._salaryConfirmPending.day);
        if (!hasMissed && !hasPending) {
            return { success: false, message: '当前没有待发薪日' };
        }
        // 防连点：确认流程进行中直接拒绝
        if (this._salaryPaying) {
            return { success: false, message: '正在发放中，请稍候' };
        }
        this._salaryPaying = true;

        const missed = hasMissed
            ? state._salaryMissedPaydays.slice()
            : [state._salaryConfirmPending.day];

        let totalPaid = 0;
        let buyerPaid = 0;
        let lastRecord = null;
        let monthsPaid = 0;

        try {
        for (let i = 0; i < missed.length; i++) {
            const payday = missed[i];
            const hasEmp = (state.employees || []).some(e => e && e.status === 'active');
            let result = { success: true, total: 0 };
            if (hasEmp) {
                result = this.settleEmployeeSalaries();
                if (result && result.success === false) {
                    eventBus.emit('toast:show', {
                        message: result.message || '月薪发放失败，请筹措资金后重试',
                        type: 'error'
                    });
                    // 保留未发完的发薪日，便于筹款后再次确认
                    state._salaryMissedPaydays = missed.slice(i);
                    state._salaryConfirmPending = {
                        day: payday,
                        period: `第${Math.floor((payday - 1) / 30) + 1}月`,
                        employeeCount: (state.employees || []).filter(e => e.status === 'active').length
                    };
                    return { success: false, message: result.message, totalPaid, monthsPaid };
                }
            }
            monthsPaid++;
            if (result && result.record) {
                lastRecord = result.record;
                totalPaid += result.record.companyCost || 0;
            } else if (result && typeof result.total === 'number') {
                totalPaid += result.total;
            }

            try {
                const wh = (typeof warehouseState !== 'undefined') ? warehouseState
                    : (gameState.warehouse || null);
                if (wh && typeof wh.settleBuyerRebatesMonthly === 'function') {
                    // 传入发薪日：多月补发时底薪按 payday 去重，避免一次确认连扣 N 份底薪
                    const br = wh.settleBuyerRebatesMonthly(gameState, payday);
                    buyerPaid += (br && br.totalPaid) || 0;
                    if (br && br.success === false && !hasEmp) {
                        state._salaryMissedPaydays = missed.slice(i);
                        state._salaryConfirmPending = {
                            day: payday,
                            period: `第${Math.floor((payday - 1) / 30) + 1}月`,
                            employeeCount: 0
                        };
                        return { success: false, message: br.message || '采购员薪资发放失败', totalPaid, monthsPaid };
                    }
                }
            } catch (e) {
                console.warn('[salary] 采购员结算失败:', e && e.message);
            }
            state.lastSalaryPayDay = payday;
        }
        } finally {
            this._salaryPaying = false;
        }

        state._salaryMissedPaydays = [];
        state._salaryConfirmPending = null;
        state._salaryDeferredPayday = null;

        eventBus.emit('employee:salaryPaid', {
            day: state.gameTime.day,
            total: totalPaid + buyerPaid,
            buyerPaid: buyerPaid,
            monthsPaid: monthsPaid
        });
        return {
            success: true,
            totalPaid: totalPaid + buyerPaid,
            buyerPaid,
            monthsPaid,
            record: lastRecord
        };
    }

    /** 推迟发薪：仍保留 missed，跳天闸门会拦截直至付清 */
    deferMonthlySalary() {
        const state = gameState.state;
        const pending = state._salaryConfirmPending;
        const day = (pending && pending.day) || state.gameTime.day;
        state._salaryDeferredPayday = day;
        // 不清除 pending 标记到“已付”；仅关闭弹窗。跳天仍需付清 missed
        state._salaryConfirmPending = null;
        if (!Array.isArray(state._salaryMissedPaydays)) state._salaryMissedPaydays = [];
        if (!state._salaryMissedPaydays.includes(day)) state._salaryMissedPaydays.push(day);
        eventBus.emit('toast:show', {
            message: '已推迟发薪弹窗；跳「下一天」前仍须结清工资，否则无法继续',
            type: 'warning'
        });
        return true;
    }

    /** 未结清费用汇总：欠薪（含推迟）+ 仓库欠租 */
    getOutstandingDues() {
        const state = gameState.state || {};
        const dues = { salary: 0, rent: 0, months: 0, needSalary: false, items: [] };
        try {
            if (!state.warehouse) state.warehouse = {};
            dues.rent = Math.max(0, Number(state.warehouse.unpaidRent) || 0);
            if (dues.rent > 0) dues.items.push({ type: 'rent', amount: dues.rent, label: '仓库欠租' });
        } catch (_) {}
        try {
            const missed = Array.isArray(state._salaryMissedPaydays) ? state._salaryMissedPaydays.slice() : [];
            const pending = !!state._salaryConfirmPending;
            const deferredDay = state._salaryDeferredPayday || 0;
            const lastPaid = state.lastSalaryPayDay || 0;
            // 已付清的推迟日不再拦截
            const deferredUnpaid = deferredDay > 0 && deferredDay > lastPaid
                && !missed.includes(deferredDay);
            if (deferredUnpaid) missed.push(deferredDay);
            dues.needSalary = pending || missed.length > 0;
            if (dues.needSalary) {
                dues.months = Math.max(1, missed.length || 1);
                let monthCost = 0;
                try {
                    const payroll = gameState.calculateAllPayroll && gameState.calculateAllPayroll();
                    monthCost = (payroll && payroll.totals && payroll.totals.companyCost) || 0;
                } catch (_) {}
                dues.salary = Math.round(monthCost * dues.months * 100) / 100;
                dues.items.push({ type: 'salary', amount: dues.salary, label: `员工工资×${dues.months}月` });
            }
        } catch (_) {}
        dues.total = Math.round(((dues.salary || 0) + (dues.rent || 0)) * 100) / 100;
        return dues;
    }

    /**
     * 跳天前强制缴费。autoPay=true 时尝试自动发薪/扣欠租。
     * @returns {{ok:boolean, bankrupt?:boolean, reason?:string, needSalaryConfirm?:boolean}}
     */
    assertDailyDuesClear(options = {}) {
        const autoPay = options.autoPay !== false;
        const state = gameState.state;
        if (!state) return { ok: true };
        const dues = this.getOutstandingDues();
        if (!dues.needSalary && !(dues.rent > 0)) return { ok: true };

        const funds = Number(state.shop && state.shop.funds) || 0;

        // 1) 欠薪：尝试自动发放
        if (dues.needSalary) {
            if (!autoPay) {
                return { ok: false, needSalaryConfirm: true, reason: '请先确认发放员工工资后再跳天' };
            }
            // 预估不够 → 破产
            if (dues.salary > 0 && funds + 1e-6 < dues.salary && funds < (dues.salary + dues.rent)) {
                // 仍尝试发薪（可能实际更低）；失败再判破产
            }
            const pay = this.confirmMonthlySalary();
            if (!pay || pay.success === false) {
                const still = this.getOutstandingDues();
                if (still.needSalary) {
                    const need = still.salary || dues.salary;
                    const have = Number(state.shop.funds) || 0;
                    if (have + 1e-6 < need) {
                        return { ok: false, bankrupt: true, reason: '无力支付员工工资，店铺破产' };
                    }
                    return {
                        ok: false,
                        needSalaryConfirm: true,
                        reason: (pay && pay.message) || '工资发放失败，请筹款后重试'
                    };
                }
            }
        }

        // 2) 仓库欠租
        const rentDue = Math.max(0, Number((state.warehouse && state.warehouse.unpaidRent) || 0));
        if (rentDue > 0) {
            const paid = gameState.spendFunds(rentDue, '补缴仓库欠租');
            if (!paid) {
                const have = Number(state.shop.funds) || 0;
                if (have + 1e-6 < rentDue) {
                    return { ok: false, bankrupt: true, reason: '无力支付仓库租金，店铺破产' };
                }
                return { ok: false, reason: '仓库欠租扣款失败' };
            }
            state.warehouse.unpaidRent = 0;
        }

        const left = this.getOutstandingDues();
        if (left.needSalary || left.rent > 0) {
            return { ok: false, reason: '仍有未结清费用，无法跳天' };
        }
        return { ok: true };
    }

    /** 欠费破产：触发结局 + 看广告抵还款 / 重开弹窗 */
    _forceBankruptForUnpaidDues(reason) {
        try {
            const dues = (typeof this.getOutstandingDues === 'function') ? this.getOutstandingDues() : { total: 0 };
            gameState.state._adBailout = {
                reason: reason || '欠费破产',
                amount: Number(dues.total) || 0,
                category: 'mixed'
            };
        } catch (_) {}
        try {
            if (typeof gameState.triggerEnding === 'function') {
                gameState.triggerEnding('bankrupt');
            } else {
                gameState.state.gameOver = true;
                gameState.state.ending = {
                    id: 'bankrupt',
                    name: '破产倒闭',
                    icon: '💀',
                    description: reason || '欠费破产',
                    triggerDay: gameState.state.gameTime.day
                };
            }
            if (gameState.state.ending) {
                gameState.state.ending.description = reason || gameState.state.ending.description;
            }
            gameState.state.gameOver = true;
        } catch (e) {
            console.error('[bankrupt dues]', e);
        }
        try {
            if (typeof ui !== 'undefined' && typeof ui.showForcedBankruptRestart === 'function') {
                ui.showForcedBankruptRestart(reason);
            } else if (typeof ui !== 'undefined' && ui.showModal) {
                ui.showModal('💀 店铺破产', `
                    <div style="padding:16px;text-align:center;line-height:1.7;">
                        <div style="font-size:40px;margin-bottom:8px;">💀</div>
                        <div style="font-size:15px;font-weight:700;margin-bottom:8px;">无力支付刚性费用</div>
                        <div style="font-size:13px;color:#666;">${reason || '欠薪/欠租导致破产'}</div>
                        <div style="font-size:12px;color:#c62828;margin-top:10px;">必须重新开局，无法继续经营</div>
                    </div>`,
                    `<button class="btn btn-primary" onclick="ui.resetGame(true)">重新开局</button>`);
            }
        } catch (_) {}
        try { gameState.notify(); } catch (_) {}
    }

    /**
     * 计算仓储费明细：每月固定月租 + 在仓商品每日占用费。
     * 优先走 warehouseEngine / WarehouseData，最后兜底等级表。
     * 新手扶持：前 7 天免在仓占用费（warehouseEngine 路径已含，这里给兜底路径补同一规则）。
     * @returns {{level:number, monthlyRent:number, rate:number, used:number, occupied:number, cityRent:number, dailyTotal:number, dailyEquivalent:number}}
     */
    _getWarehouseCostDetail() {
        const d = this._getWarehouseCostDetailRaw();
        try {
            const day = (gameState && gameState.state && gameState.state.gameTime && gameState.state.gameTime.day) || 1;
            if (day <= 7 && d && Number(d.occupied) > 0) {
                return Object.assign({}, d, {
                    newbieWaived: true,
                    occupied: 0,
                    dailyTotal: Math.round((Number(d.cityRent) || 0) * 100) / 100,
                    dailyEquivalent: Math.round(((Number(d.monthlyRent) || 0) / 30 + (Number(d.cityRent) || 0)) * 100) / 100
                });
            }
        } catch (_) {}
        return d;
    }

    _getWarehouseCostDetailRaw() {
        const state = (gameState && gameState.state) || {};
        const wh = state.warehouse || {};
        const level = Math.max(1, parseInt(wh.level, 10) || 1);
        let used = 0;
        try {
            if (typeof warehouseState !== 'undefined' && warehouseState && typeof warehouseState.getBillableQuantity === 'function') {
                used = Number(warehouseState.getBillableQuantity()) || 0;
            } else if (typeof warehouseState !== 'undefined' && warehouseState && typeof warehouseState.getUsedCapacity === 'function') {
                used = Number(warehouseState.getUsedCapacity()) || 0;
            } else if (Array.isArray(wh.inventory)) {
                used = wh.inventory.reduce((s, it) => s + (parseInt(it && it.quantity, 10) || 0), 0);
            } else if (Number(wh.used) > 0) {
                used = Number(wh.used) || 0;
            }
        } catch (_) {}
        // 仓库城市每日房租（搬仓页「房租 ¥X/日」特性）
        let cityRent = 0;
        try {
            if (typeof warehouseState !== 'undefined' && warehouseState && typeof warehouseState.getCityRentPerDay === 'function') {
                cityRent = Number(warehouseState.getCityRentPerDay()) || 0;
            } else if (typeof getCityById === 'function') {
                const city = getCityById(wh.city || (state.shop && state.shop.city) || 'yiwu');
                const c = Number(city && city.effects && city.effects.rentCost);
                cityRent = isFinite(c) && c > 0 ? c : 0;
            }
        } catch (_) {}
        try {
            if (typeof warehouseEngine !== 'undefined' && warehouseEngine && typeof warehouseEngine.getCostDetail === 'function') {
                const d = warehouseEngine.getCostDetail();
                if (d && isFinite(Number(d.dailyTotal))) return d;
            }
        } catch (_) {}
        try {
            if (typeof WarehouseData !== 'undefined' && WarehouseData && typeof WarehouseData.calcOccupancyFee === 'function') {
                const occ = WarehouseData.calcOccupancyFee(level, used);
                const rent = (typeof WarehouseData.getLevelRentInfo === 'function')
                    ? WarehouseData.getLevelRentInfo(level) : { monthlyRent: 0 };
                const monthDays = Number(WarehouseData.MONTH_DAYS) > 0 ? Number(WarehouseData.MONTH_DAYS) : 30;
                return {
                    level: occ.level,
                    monthlyRent: Number(rent.monthlyRent) || 0,
                    rate: occ.rate,
                    used: occ.used,
                    occupied: occ.occupied,
                    cityRent: cityRent,
                    dailyTotal: Math.round((occ.occupied + cityRent) * 100) / 100,
                    dailyEquivalent: Math.round((((Number(rent.monthlyRent) || 0) / monthDays) + occ.occupied + cityRent) * 100) / 100
                };
            }
        } catch (_) {}
        let monthlyRent = 20000;
        let rate = 0.02;
        try {
            if (typeof WAREHOUSE_LEVELS !== 'undefined' && Array.isArray(WAREHOUSE_LEVELS)) {
                const info = WAREHOUSE_LEVELS.find(l => l.level === level) || WAREHOUSE_LEVELS[0];
                monthlyRent = Math.max(0, Number(info && info.monthlyRent) || monthlyRent);
                const r = Number(info && info.unitStorageCost);
                if (isFinite(r) && r >= 0) rate = r;
            }
        } catch (_) {}
        const occupied = Math.round(used * rate * 100) / 100;
        return {
            level: level,
            monthlyRent: monthlyRent,
            rate: rate,
            used: used,
            occupied: occupied,
            cityRent: cityRent,
            dailyTotal: Math.round((occupied + cityRent) * 100) / 100,
            dailyEquivalent: Math.round((monthlyRent / 30 + occupied + cityRent) * 100) / 100
        };
    }

    /**
     * 每月固定月租：每 30 个游戏日结算一次，与发薪同日（第31/61/91…天），跳天漏结自动补缴。
     * 用 floor((day-1)/30)：第30天=0期（不结），第31天=1期，第61天=2期，与 checkAndSettleMonthlySalary 的月首一致
     */
    chargeWarehouseMonthlyRent() {
        if (!gameState.state.warehouse) gameState.state.warehouse = {};
        const wh = gameState.state.warehouse;
        const day = Math.max(1, parseInt(gameState.state.gameTime && gameState.state.gameTime.day, 10) || 1);
        const monthDays = (typeof WarehouseData !== 'undefined' && WarehouseData && Number(WarehouseData.MONTH_DAYS) > 0)
            ? Number(WarehouseData.MONTH_DAYS) : 30;
        const duePeriods = Math.floor((day - 1) / monthDays);
        // 老存档 / 首次启用：从当前期开始计，不追溯补缴历史月份
        if (wh._rentMonthsPaid === undefined || wh._rentMonthsPaid === null) {
            wh._rentMonthsPaid = duePeriods;
            return { ok: true, cost: 0, initialized: true, period: duePeriods };
        }
        const paidPeriods = Math.max(0, parseInt(wh._rentMonthsPaid, 10) || 0);
        if (duePeriods <= paidPeriods) return { ok: true, cost: 0, already: true };

        const months = duePeriods - paidPeriods;
        const detail = this._getWarehouseCostDetail();
        const cost = Math.round((Number(detail.monthlyRent) || 0) * months * 100) / 100;
        // 本期只结算一次：无论成功失败都推进期数，失败转欠租，避免下一天重复计费
        wh._rentMonthsPaid = duePeriods;
        if (!(cost > 0)) return { ok: true, cost: 0, months, detail };

        const label = months > 1 ? `仓库月租（补缴${months}期）` : `仓库月租（第${duePeriods}期）`;
        const paid = gameState.spendFunds(cost, label);
        wh.lastMonthRentDay = day;
        wh.lastMonthRentMonths = months;
        if (paid) {
            wh.lastMonthRentPaid = cost;
            wh.lastMonthRentDue = 0;
            return { ok: true, cost, months, detail };
        }
        wh.lastMonthRentPaid = 0;
        wh.lastMonthRentDue = cost;
        wh.unpaidRent = Math.round(((Number(wh.unpaidRent) || 0) + cost) * 100) / 100;
        try {
            eventBus.emit('toast:show', {
                message: `仓库月租 ¥${cost} 扣款失败，已记欠租累计 ¥${wh.unpaidRent}`,
                type: 'warning'
            });
        } catch (_) {}
        return { ok: false, cost, months, unpaid: wh.unpaidRent, detail };
    }

    /** 在仓商品每日占用费（空仓为 0，月租另计）；失败记入 unpaidRent */
    chargeWarehouseDailyRent() {
        const detail = this._getWarehouseCostDetail();
        const cost = Math.round((Number(detail && detail.dailyTotal) || 0) * 100) / 100;
        if (!(cost > 0)) return { ok: true, cost: 0, detail };
        if (!gameState.state.warehouse) gameState.state.warehouse = {};
        const wh = gameState.state.warehouse;
        const day = gameState.state.gameTime.day;
        if (wh._rentChargedDay === day) return { ok: true, cost: 0, already: true, detail };

        const rentDetail = {
            rate: Number(detail.rate) || 0,
            used: Number(detail.used) || 0,
            occupied: Number(detail.occupied) || 0,
            cityRent: Number(detail.cityRent) || 0
        };
        const reason = rentDetail.cityRent > 0
            ? `仓储日费（在仓占用费¥${rentDetail.occupied} + 城市房租¥${rentDetail.cityRent}/日）`
            : `在仓商品占用费（${rentDetail.used}件×${rentDetail.rate}元/日）`;
        const paid = gameState.spendFunds(cost, reason);
        wh._rentChargedDay = day;
        wh.lastRentDetail = rentDetail;
        if (paid) {
            wh.lastRentPaid = cost;
            wh.lastRentDay = day;
            return { ok: true, cost, detail };
        }
        wh.unpaidRent = Math.round(((Number(wh.unpaidRent) || 0) + cost) * 100) / 100;
        wh.lastRentPaid = 0;
        wh.lastRentDay = day;
        try {
            eventBus.emit('toast:show', {
                message: `仓储日费 ¥${cost} 扣款失败，已记欠租累计 ¥${wh.unpaidRent}`,
                type: 'warning'
            });
        } catch (_) {}
        return { ok: false, cost, unpaid: wh.unpaidRent, detail };
    }

    generateDailyStats() {
        const day = gameState.state.gameTime.day - 1;
        if (day < 1) return;
        // 已有分类流水时不再全表扫订单（中后期几千单会明显卡日切）
        let daily = gameState.state.finance.dailyStats.find(d => d.day === day);
        if (daily && (daily.income_sales != null || daily.sales != null)) {
            if (daily.orderGrossSales == null) daily.orderGrossSales = daily.sales || 0;
            if (daily.orderGrossCost == null) daily.orderGrossCost = daily.cost || 0;
            return;
        }
        let orderCount = 0, orderGrossSales = 0, orderGrossCost = 0;
        try {
            if (typeof OrderPerf !== 'undefined' && OrderPerf.getStatusBucket) {
                OrderPerf.ensure(gameState.state.orders);
                const buckets = ['pending_payment', 'pending_packing', 'pending_shipment', 'shipped', 'completed'];
                for (let b = 0; b < buckets.length; b++) {
                    const arr = OrderPerf.getStatusBucket(buckets[b]) || [];
                    for (let i = 0; i < arr.length; i++) {
                        const o = arr[i];
                        if (!o || !o.createTime || o.createTime.day !== day || o.status === 'cancelled') continue;
                        orderCount++;
                        orderGrossSales += o.totalAmount || 0;
                        orderGrossCost += o.costAmount || 0;
                    }
                }
            } else {
                const orders = gameState.state.orders.filter(
                    o => o.createTime && o.createTime.day === day && o.status !== 'cancelled'
                );
                orderCount = orders.length;
                orderGrossSales = orders.reduce((sum, o) => sum + o.totalAmount, 0);
                orderGrossCost = orders.reduce((sum, o) => sum + (o.costAmount || 0), 0);
            }
        } catch (_) {
            const orders = (gameState.state.orders || []).filter(
                o => o && o.createTime && o.createTime.day === day && o.status !== 'cancelled'
            );
            orderCount = orders.length;
            orderGrossSales = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
            orderGrossCost = orders.reduce((sum, o) => sum + (o.costAmount || 0), 0);
        }
        
        // 查找当天是否已有 dailyStats（由 addFinanceRecord 实时写入的分类版本）
        if (!daily) {
            // 老存档（或当日完全无流水）才走新建路径
            daily = {
                day: day,
                orders: orderCount,
                sales: orderGrossSales,
                cost: orderGrossCost,
                profit: orderGrossSales - orderGrossCost,
                income_sales: 0,
                income_other: 0,
                expense_purchase: 0,
                expense_express: 0,
                expense_packaging: 0,
                expense_platform: 0,
                expense_salary: 0,
                expense_marketing: 0,
                expense_penalty: 0,
                expense_upgrade: 0,
                expense_other: 0,
            };
            gameState.state.finance.dailyStats.push(daily);
        } else {
            // 新流程：合并订单数（addOrder只累加实时的，对取消订单过滤后的更准），
            // 分类 profit/sales 以 addFinanceRecord 累计为准，保留原字段
            daily.orders = Math.max(daily.orders || 0, orderCount);
            daily.sales = daily.sales || 0;
            daily.cost = daily.cost || 0;
            daily.profit = daily.profit != null ? daily.profit : (daily.sales - daily.cost);
        }
        // 兼容字段：写回 order 维度原值备查
        daily.orderGrossSales = orderGrossSales;
        daily.orderGrossCost = orderGrossCost;
    }

    checkCampaignExpiry() {
        const today = gameState.state.gameTime.day;
        gameState.state.marketing.activeCampaigns.forEach(c => {
            if (c.status === 'active' && c.endDay && today > c.endDay) {
                c.status = 'ended';
            }
        });
    }

    checkEndorsementExpiry() {
        const today = gameState.state.gameTime.day;
        gameState.state.marketing.celebrityEndorsements.forEach(e => {
            if (e.status === 'active' && e.endDay && today > e.endDay) {
                e.status = 'ended';
            }
        });
    }

    simulateBusiness() {
        const listings = gameState.state.listings.filter(l => l.status === 'active');
        if (listings.length === 0) return;

        // 平台风控封禁期间：不产生新自然/推广订单
        if (typeof gameState.isShopPlatformBanned === 'function' && gameState.isShopPlatformBanned()) {
            return;
        }
        // 订单无限制：每日硬顶检查已移除（仅保留下方积压性能闸门）

        // ===== 订单不再限流：移除在途积压停生单/限流闸门 =====
        // （用户反馈爆订单后卡顿——已改为用性能优化解决，而非限制订单）
        let backlog = 0;
        try {
            const ordersArr = gameState.state.orders || [];
            if (typeof OrderPerf !== 'undefined' && OrderPerf.ensure) {
                OrderPerf.ensure(ordersArr);
                if (!OrderPerf.dirty && OrderPerf.counts) {
                    const c = OrderPerf.counts;
                    backlog = (c.pending_payment && c.pending_payment.all || 0)
                        + (c.pending_packing && c.pending_packing.all || 0)
                        + (c.pending_shipment && c.pending_shipment.all || 0)
                        + (c.shipped && c.shipped.all || 0);
                } else {
                    backlog = ordersArr.length;
                }
            } else {
                backlog = ordersArr.length;
            }
        } catch (_) {
            backlog = (gameState.state.orders && gameState.state.orders.length) || 0;
        }

        const now = gameState.state.gameTime;
        const marketingEffect = gameState.getTotalMarketingEffect();
        const levelBonus = gameState.getCurrentLevel().trafficBonus;
        const trafficMultiplier = gameState.getCurrentTrafficMultiplier();
        const conversionMultiplier = gameState.getCurrentConversionMultiplier();
        const festivalTrafficMultiplier = this.getFestivalTrafficMultiplier();
        const storeDesignBonus = this.getStoreDesignBonus();
        const baseTraffic = this.calculateBaseTraffic();
        
        // 判断当前小时是否有启用的营销活动（直通车/展位/明星代言等）
        const activeCampaigns = (gameState.state.marketing.activeCampaigns || []).filter(c => c.status === 'active');
        const activeEndorsements = (gameState.state.marketing.celebrityEndorsements || []).filter(e => e.status === 'active');
        let activeStorePromos = 0;
        try {
            activeStorePromos = (typeof gameState.getActivePromotions === 'function')
                ? (gameState.getActivePromotions() || []).length : 0;
        } catch (_) {}
        let hasActiveMarketing = marketingEffect > 1.001
            || activeCampaigns.length > 0
            || activeEndorsements.length > 0
            || activeStorePromos > 0;
        let adTrafficBoost = false;
        try {
            adTrafficBoost = !!(typeof gameState.isAdTrafficBoostActive === 'function' && gameState.isAdTrafficBoostActive());
        } catch (_) {}
        if (adTrafficBoost && !hasActiveMarketing) {
            hasActiveMarketing = true;
        }
        const orderGenSource = hasActiveMarketing ? 'promo' : 'organic';
        // 订单不再限流：hourOrderBudget 保持上限，移除积压硬限流
        let hourOrderBudget = 999999999;
        let luxuryHourBudget = 5;
        try {
            if (typeof gameState.getOrderGenerationQuota === 'function') {
                hourOrderBudget = gameState.getOrderGenerationQuota(orderGenSource);
            }
        } catch (_) {}
        try {
            if (typeof gameState.getLuxuryOrderQuota === 'function') {
                luxuryHourBudget = gameState.getLuxuryOrderQuota();
            }
        } catch (_) {}
        if (!(hourOrderBudget > 0) && !(luxuryHourBudget > 0)) return;

        // ===== 流量闸门：不再控制订单数量，给订单留出更多运行空间 =====
        // 付费推广/代言 → 完整流量；仅直播 → 中等；自然单放开（单商品每小时成交上限已解除）
        const gating = (typeof TRAFFIC_GATING !== 'undefined' && TRAFFIC_GATING) ? TRAFFIC_GATING : {
            organicViewScale: 0.3,
            organicMaxOrdersPerListingHour: 999999,
            organicFestivalCap: 1.15,
            livestreamViewScale: 0.4,
            livestreamMaxOrdersPerListingHour: 999999,
            paidViewScale: 1.0,
            paidMaxOrdersPerListingHour: 999999,
            suppressOrganicBoostsWithoutPromo: true
        };
        const isLiveNow = !!(gameState.state.livestream && gameState.state.livestream.isLive);
        let organicViewScale = Number(gating.organicViewScale);
        if (!(organicViewScale > 0)) organicViewScale = 0.06;
        let organicMaxOrdersPerListing = Number(gating.organicMaxOrdersPerListingHour);
        if (!(organicMaxOrdersPerListing >= 0)) organicMaxOrdersPerListing = 1;
        // ===== 店铺等级越高自然流量越大：每商品每小时自然单上限随等级放大
        // 等级流量系数 trafficBonus：Lv1=1.0 → Lv7=2.5（无推广 3 单→8 单/小时，直播同步放大）=====
        const levelTrafficFactor = (typeof levelBonus === 'number' && levelBonus > 0) ? levelBonus : 1;
        let festMul = festivalTrafficMultiplier;
        if (hasActiveMarketing) {
            organicViewScale = (gating.paidViewScale != null) ? Number(gating.paidViewScale) : 1;
            // 修复爆单根因：付费推广/代言同样设「单商品每小时成交上限」，
            // 原 Infinity 会让单 listing 每小时爆出上百单、当天冲数万单，生产线永远追不上
            organicMaxOrdersPerListing = (gating.paidMaxOrdersPerListingHour != null)
                ? Number(gating.paidMaxOrdersPerListingHour) : 20;
            if (!(organicMaxOrdersPerListing > 0)) organicMaxOrdersPerListing = 20;
        } else if (isLiveNow) {
            organicViewScale = (gating.livestreamViewScale != null) ? Number(gating.livestreamViewScale) : 0.4;
            organicMaxOrdersPerListing = Math.max(1, Math.round(
                ((gating.livestreamMaxOrdersPerListingHour != null) ? Number(gating.livestreamMaxOrdersPerListingHour) : 2)
                * Math.min(1.4, levelTrafficFactor)));
            const festCap = (gating.organicFestivalCap != null) ? Number(gating.organicFestivalCap) : 1.15;
            festMul = Math.min(festMul, Math.max(1, festCap));
        } else {
            // 无推广：每商品每小时最多 1 单，不随店铺等级放大
            organicMaxOrdersPerListing = Math.max(1, Number(gating.organicMaxOrdersPerListingHour) || 1);
            const festCap = (gating.organicFestivalCap != null) ? Number(gating.organicFestivalCap) : 1.15;
            festMul = Math.min(festMul, Math.max(1, festCap));
        }
        const suppressOrganicBoosts = !hasActiveMarketing && !!gating.suppressOrganicBoostsWithoutPromo;

        // P1：粉丝资产 → 免费自然流量（路人粉基础流量 + 铁粉每日口碑），封顶 +20%
        try {
            if (typeof liveState !== 'undefined' && liveState && typeof liveState.getFanTrafficBonus === 'function') {
                const ft = liveState.getFanTrafficBonus();
                if (ft && ft.total > 1) {
                    organicViewScale = Math.min(1.2, organicViewScale + (ft.total - 1));
                }
            }
        } catch (_) {}

        // 预先生成本小时推广日志的ID（供订单打标记使用，使ROI可正确关联）
        const campaignLogId = hasActiveMarketing
            ? ('cp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6))
            : null;

        // 本小时营销数据累计（用于写promotionLog）
        const hourMarketing = {
            cost: 0,
            exposureGiven: 0,
            clicks: 0,
            generatedOrders: 0,
            orderIds: [],
            targets: []
        };
        // 用于打标记：记录本次simulateBusiness开始前orders长度
        const ordersBeforeSim = gameState.state.orders.length;
        
        const livestream = gameState.state.livestream;
        let livestreamTrafficBonus = 1;
        let livestreamConversionBonus = 1;
        if (livestream.isLive) {
            const sid = livestream.streamer?.id || livestream.streamer;
            let streamer = STREAMER_TYPES.find(s => s.id === sid);
            if (!streamer && livestream.streamer && typeof livestream.streamer.conversionBonus === 'number') {
                streamer = livestream.streamer;
            }
            if (!streamer && typeof LIVE_STREAMER_TYPES !== 'undefined') {
                streamer = LIVE_STREAMER_TYPES.find(s => s.id === sid);
            }
            if (streamer) {
                livestreamTrafficBonus = 1 + ((streamer.baseFans || 0) / 10000) * 0.1;
                livestreamConversionBonus = streamer.conversionBonus || 1;
            }
        }
        
        const promotions = (gameState.state.promotions && Array.isArray(gameState.state.promotions.active))
            ? gameState.state.promotions.active
            : [];
        let promotionConversionBonus = 1;
        promotions.forEach(promo => {
            if (promo.status === 'active') {
                if (promo.type === 'flashSale') {
                    promotionConversionBonus *= 1.3;
                } else if (promo.type === 'fullReduction') {
                    promotionConversionBonus *= 1.2;
                } else if (promo.type === 'groupBuy') {
                    promotionConversionBonus *= 1.25;
                }
            }
        });
        
        listings.forEach(listing => {
            try {
            const product = PRODUCTS.find(p => p.id === listing.productId);
            if (!product) return;
            const isLuxListing = product.category === 'luxury'
                || (Number(product.basePrice) || 0) >= 5000
                || (Number(listing.price) || 0) >= 5000;
            // 货物管制：禁售商品本小时不产生订单
            try {
                if (typeof gameState.isProductControlled === 'function') {
                    const ban = gameState.isProductControlled(listing.productId, 'sell');
                    if (ban) return;
                }
            } catch (_) {}
            
            const weightFactor = listing.weight / 50;
            const promotionPrice = this.getPromotionPrice(listing);
            let priceFactor = this.calculatePriceFactor(promotionPrice, product.basePrice);
            let categoryDemand = this.getCategoryDemand(product.category);
            // P1：粉丝画像 → 品类自然转化加成（每 1 万画像粉 +5%，封顶 +20%）
            try {
                if (typeof liveState !== 'undefined' && liveState && typeof liveState.getProfileBonus === 'function') {
                    categoryDemand *= liveState.getProfileBonus(product.category);
                }
            } catch (_) {}

            // ========== 新手/高价加成：仅在有推广时完整生效，避免白嫖自然爆单 ==========
            let baseTrafficFinal = baseTraffic;
            try {
                const curDay = now.day || 1;
                let newbieTrafficBonus = 1;
                if (!suppressOrganicBoosts) {
                    if (curDay <= 7) newbieTrafficBonus = 1.25;
                    else if (curDay <= 15) newbieTrafficBonus = 1.1;
                } else {
                    // 无推广：仅保留极轻新手关照
                    if (curDay <= 7) newbieTrafficBonus = 1.05;
                }

                if (curDay <= 30 && product && product.basePrice > 0) {
                    const ratio = promotionPrice / product.basePrice;
                    if (ratio > 1.0) {
                        const lessSensitive = 1 + (ratio - 1) * (suppressOrganicBoosts ? 0.04 : 0.12);
                        priceFactor = Math.min(priceFactor * lessSensitive, suppressOrganicBoosts ? 1.05 : 1.15);
                    }
                }

                if (!suppressOrganicBoosts && curDay <= 15 && (product.category === 'daily' || product.category === 'food')) {
                    const extraDemand = 1.05 + Math.random() * 0.05;
                    categoryDemand *= extraDemand;
                    if (product.basePrice > 0) {
                        const ratio = promotionPrice / product.basePrice;
                        if (ratio > 1.0 && ratio < 1.3) {
                            priceFactor = Math.min(priceFactor * 1.06, 1.18);
                        }
                    }
                }

                const HV_CATS = ['digital', 'clothing', 'beauty', 'home'];
                const listPrice = Number(promotionPrice || listing.price) || 0;
                const isPremium5k = listPrice >= 5000 || (product.basePrice || 0) >= 5000;
                const isHV = isPremium5k
                    || (HV_CATS.includes(product.category) && product.basePrice >= 350)
                    || (!HV_CATS.includes(product.category) && product.basePrice >= 500);
                if (!suppressOrganicBoosts) {
                    if (isPremium5k) {
                        categoryDemand *= 1.55;
                        newbieTrafficBonus *= 1.08;
                        priceFactor = Math.max(priceFactor, 0.85);
                    } else if (isHV) {
                        categoryDemand *= 1.35;
                        newbieTrafficBonus *= 1.05;
                    }
                } else if (isPremium5k) {
                    // 无推广：奢侈品保留少量自然曝光，避免整天 0 单
                    priceFactor = Math.max(priceFactor, 0.62);
                    categoryDemand *= 1.12;
                }

                baseTrafficFinal = baseTraffic * newbieTrafficBonus;
            } catch (_hvErr) {
                console.warn('[simulateBusiness] HV/newbie bonus calc err:', _hvErr);
                baseTrafficFinal = baseTraffic;
            }
            const _btf = (baseTrafficFinal > 0) ? baseTrafficFinal : baseTraffic;

            // 无付费推广时不叠直播自然流量加成（直播出单走 processLivestream）
            const liveTrafficMul = (hasActiveMarketing && livestreamTrafficBonus) ? livestreamTrafficBonus : 1;

            let views = Math.floor(
                _btf * weightFactor * priceFactor * categoryDemand *
                marketingEffect * levelBonus * trafficMultiplier * festMul *
                liveTrafficMul * randomFloat(0.8, 1.2) / listings.length
            );
            // 闸门：缩放自然浏览量；奢侈品保底曝光，避免被日用品摊薄成 0
            let listingViewScale = organicViewScale;
            if (isLuxListing) listingViewScale = Math.max(listingViewScale, hasActiveMarketing ? 1 : 0.22);
            if (listingViewScale < 0.999) {
                views = Math.floor(views * listingViewScale);
            }
            if (isLuxListing && views < 4 && Math.random() < 0.5) views = 4;
            
            if (views > 0) {
                listing.views += views;
                try {
                    if (!gameState.state.statistics) gameState.state.statistics = {};
                    const dayNow = (now && now.day) || 1;
                    if (gameState.state.statistics._viewsDay !== dayNow) {
                        gameState.state.statistics.todayViews = 0;
                        gameState.state.statistics._viewsDay = dayNow;
                    }
                    gameState.state.statistics.todayViews = (gameState.state.statistics.todayViews || 0) + views;
                } catch (_) {}
                gameState.state.statistics.totalViews += views;
                if (hasActiveMarketing) hourMarketing.exposureGiven += views;
                
                const clickRate = 0.08 + (listing.weight / 100) * 0.06;
                const expectedClicks = views * clickRate * randomFloat(0.8, 1.2);
                let clicks = Math.floor(expectedClicks);
                if (Math.random() < (expectedClicks - clicks)) {
                    clicks++;
                }
                
                if (clicks > 0) {
                    gameState.state.statistics.totalClicks += clicks;
                    if (hasActiveMarketing) hourMarketing.clicks += clicks;
                    
                    // 扣费并累计到小时营销成本
                    const thisCost = this.handleMarketingCost(clicks, views);
                    if (thisCost > 0 && hasActiveMarketing) hourMarketing.cost += thisCost;
                    
                    // 转化率加成：无推广时不叠直播转化与高价爆发
                    let finalConversionMultiplier = conversionMultiplier * storeDesignBonus * promotionConversionBonus;
                    if (hasActiveMarketing) {
                        finalConversionMultiplier *= livestreamConversionBonus;
                    }
                    try {
                        const curDay = now.day || 1;
                        if (!suppressOrganicBoosts) {
                            if (curDay <= 7) finalConversionMultiplier *= 1.15;
                            else if (curDay <= 15) finalConversionMultiplier *= 1.05;
                        }

                        const HV_CATS = ['digital', 'clothing', 'beauty', 'home'];
                        const listPrice2 = Number(listing.price) || 0;
                        const isPremium5k2 = listPrice2 >= 5000 || (product.basePrice || 0) >= 5000;
                        const isHV = isPremium5k2
                            || (HV_CATS.includes(product.category) && product.basePrice >= 350)
                            || (!HV_CATS.includes(product.category) && product.basePrice >= 500);
                        if (!suppressOrganicBoosts) {
                            if (isPremium5k2) {
                                finalConversionMultiplier *= 1.25;
                                const isHVBuyer = this._randomHighValueBuyerCheck();
                                if (isHVBuyer) finalConversionMultiplier *= 1.2;
                            } else if (isHV) {
                                const isHVBuyer = this._randomHighValueBuyerCheck();
                                if (isHVBuyer) {
                                    finalConversionMultiplier *= 1.3;
                                }
                            }
                        } else if (isPremium5k2) {
                            finalConversionMultiplier *= 1.08;
                        }

                        const rating = typeof gameState.state.shop?.rating === 'number' ? gameState.state.shop.rating : 5;
                        if (rating <= 3.0) {
                            finalConversionMultiplier = Math.max(finalConversionMultiplier * 0.75, finalConversionMultiplier);
                        }
                        if (rating >= 4.8 && !suppressOrganicBoosts) {
                            finalConversionMultiplier *= 1.15;
                        }
                        // 售出率细化：高周转商品略增转化，滞销略降
                        if (typeof gameState.getSellThroughRate === 'function') {
                            const st = gameState.getSellThroughRate(listing.productId, listing.qualityGrade || null);
                            listing.sellThroughRate = st.rate;
                            if (st.rate >= 70) finalConversionMultiplier *= 1.08;
                            else if (st.rate > 0 && st.rate < 25 && st.stock > 20) finalConversionMultiplier *= 0.92;
                        }
                    } catch (_convErr) {
                        console.warn('[simulateBusiness] conv bonus err:', _convErr);
                    }

                    const conversionRate = this.calculateConversionRate(listing, product) * finalConversionMultiplier;
                    const expectedOrders = clicks * conversionRate * randomFloat(0.7, 1.3);
                    let orderCount = Math.floor(expectedOrders);
                    if (Math.random() < (expectedOrders - orderCount)) {
                        orderCount++;
                    }
                    // 奢侈品保底：无推广时也有机会出稀有单
                    if (isLuxListing && orderCount <= 0 && luxuryHourBudget > 0 && Math.random() < (hasActiveMarketing ? 0.22 : 0.08)) {
                        orderCount = 1;
                    }
                    // 闸门：无推广时每上架商品每小时最多 N 单；并受本小时日配额约束
                    if (Number.isFinite(organicMaxOrdersPerListing)) {
                        orderCount = Math.min(orderCount, Math.max(0, organicMaxOrdersPerListing));
                    }
                    const useLuxBudget = isLuxListing && orderGenSource !== 'promo';
                    const activeBudget = useLuxBudget ? luxuryHourBudget : hourOrderBudget;
                    if (activeBudget <= 0) {
                        orderCount = 0;
                    } else {
                        orderCount = Math.min(orderCount, activeBudget);
                    }

                    if (orderCount > 0) {
                        const ordersBeforeThis = gameState.state.orders.length;
                        // P3：直播后高价窗口（activeFans 窗口内自然单售价 ×1.08，粉丝刚需/稀缺感）
                        let premiumMult = 1;
                        try {
                            if (typeof liveState !== 'undefined' && liveState && typeof liveState.isActiveFanWindow === 'function' && liveState.isActiveFanWindow()) {
                                premiumMult = (typeof LIVE_CONFIG !== 'undefined' && LIVE_CONFIG.postStreamPremiumMult) || 1.08;
                            }
                        } catch (_) {}
                        const actualGenerated = this.generateOrders(listing, product, orderCount, premiumMult, { source: orderGenSource });
                        if (useLuxBudget) {
                            luxuryHourBudget = Math.max(0, luxuryHourBudget - (actualGenerated || 0));
                        } else {
                            hourOrderBudget = Math.max(0, hourOrderBudget - (actualGenerated || 0));
                        }
                        const ordersAfterThis = gameState.state.orders.length;
                        
                        if (hasActiveMarketing && actualGenerated > 0) {
                            hourMarketing.generatedOrders += actualGenerated;
                            hourMarketing.targets.push({
                                listingId: listing.id,
                                title: listing.title,
                                price: listing.price,
                                originalExposure: listing.views - views,
                                ordersThisRound: actualGenerated
                            });
                            for (let i = ordersBeforeThis; i < ordersAfterThis; i++) {
                                const o = gameState.state.orders[i];
                                if (o) {
                                    o.fromMarketing = true;
                                    o.marketingPromotionId = campaignLogId;
                                    o.marketingCampaignSource = 'activeCampaign';
                                    o.marketingHourKey = 'D' + now.day + 'H' + now.hour;
                                    if (activeCampaigns.length > 0) {
                                        o.marketingCampaignId = activeCampaigns[0].id;
                                        o.marketingCampaignName = MARKETING_TYPES[activeCampaigns[0].type]?.name || '营销推广';
                                    } else if (activeEndorsements.length > 0) {
                                        const celeb = CELEBRITIES.find(c => c.id === activeEndorsements[0].celebrityId);
                                        o.marketingCampaignId = activeEndorsements[0].id;
                                        o.marketingCampaignName = '明星代言-' + (celeb?.name || '');
                                    } else {
                                        o.marketingCampaignName = '综合营销流量';
                                    }
                                    hourMarketing.orderIds.push(o.id);
                                }
                            }
                        }
                    }
                }
            }
            } catch (_listingErr) {
                console.warn('[simulateBusiness] single listing err:', _listingErr);
            }
        });
        
        try { this._maybeSimulateMemberRecharge(); } catch (_) {}

        // 有启用的营销活动且产生了数据 -> 写入 promotionLogs
        if (hasActiveMarketing && (hourMarketing.cost > 0 || hourMarketing.generatedOrders > 0 || hourMarketing.exposureGiven > 0)) {
            if (!gameState.state.marketing.promotionLogs) gameState.state.marketing.promotionLogs = [];
            
            // 构造活动名称 + 员工名称（使用活动名称或代言名称）
            let logName = '综合营销推广', logLevel = 1, logEmployeeId = null;
            if (activeCampaigns.length > 0) {
                const first = activeCampaigns[0];
                const mt = MARKETING_TYPES[first.type];
                logName = (mt?.name || '营销活动') + ' ×' + activeCampaigns.length;
                logLevel = Math.min(5, 1 + activeCampaigns.length);
            } else if (activeEndorsements.length > 0) {
                const first = activeEndorsements[0];
                const celeb = CELEBRITIES.find(c => c.id === first.celebrityId);
                logName = '明星代言: ' + (celeb?.name || '');
                logLevel = celeb?.level || 3;
            }

            gameState.state.marketing.promotionLogs.push({
                id: campaignLogId,
                campaignSource: 'activeCampaign',
                employeeId: logEmployeeId,
                employeeName: logName,
                employeeLevel: logLevel,
                activeCampaignCount: activeCampaigns.length,
                activeEndorsementCount: activeEndorsements.length,
                day: now.day,
                hour: now.hour,
                timestamp: Date.now(),
                cost: +hourMarketing.cost.toFixed(2),
                strength: Math.round(hourMarketing.exposureGiven / 10),
                exposureGiven: hourMarketing.exposureGiven,
                clicks: hourMarketing.clicks,
                generatedOrders: hourMarketing.generatedOrders,
                orderIds: hourMarketing.orderIds.slice(-20),
                targets: hourMarketing.targets.slice(0, 10)
            });
            
            if (gameState.state.marketing.promotionLogs.length > 500) {
                gameState.state.marketing.promotionLogs = gameState.state.marketing.promotionLogs.slice(-500);
            }
        }
        
        // 客服系统Tick（生成咨询、退换货、纠纷，处理超时等）
        // 注意：processOrderUpdates 由 tick/_skipOneTick 统一调用，此处勿再重复扫单
        if (typeof csEngine !== 'undefined') {
            csEngine.tick();
        } else {
            this.generateConsultations();
        }
    }

    _maybeSimulateMemberRecharge() {
        if (typeof gameState.getMemberRechargeConfig !== 'function') return;
        const cfg = gameState.getMemberRechargeConfig();
        if (!cfg || !cfg.enabled || !(cfg.rules || []).length) return;
        if (Math.random() > 0.08) return;
        const list = (gameState.state.members && gameState.state.members.list) || [];
        if (!list.length) return;
        const member = list[Math.floor(Math.random() * list.length)];
        const rule = cfg.rules[Math.floor(Math.random() * cfg.rules.length)];
        if (!member || !rule || !(rule.pay > 0)) return;
        gameState.memberRecharge(member.id, rule.pay);
    }

    calculateBaseTraffic() {
        const hour = gameState.state.gameTime.hour;
        let base = 30;
        
        if (hour >= 9 && hour <= 11) base = 60;
        else if (hour >= 14 && hour <= 16) base = 45;
        else if (hour >= 19 && hour <= 22) base = 80;
        else if (hour >= 8 && hour < 9) base = 25;
        else if (hour >= 12 && hour < 14) base = 35;
        else if (hour >= 17 && hour < 19) base = 30;
        else base = 10;
        
        const dayOfWeek = gameState.state.gameTime.dayOfWeek;
        if (dayOfWeek >= 6) base *= 1.2;
        
        const levelMultiplier = 1 + (gameState.state.shop.level - 1) * 0.3;
        let traffic = Math.floor(base * levelMultiplier);
        try {
            if (typeof gameState.getPlayerAttrFactor === 'function') {
                traffic = Math.floor(traffic * gameState.getPlayerAttrFactor('operation', 0.04));
            }
        } catch (_) {}
        // 天赋「运营大神」流量加成 + 自有品牌流量加成
        try {
            if (typeof gameState.getTalentBonus === 'function') {
                const tb = gameState.getTalentBonus('trafficBonus');
                if (tb > 0) traffic = Math.floor(traffic * (1 + tb));
            }
            if (typeof gameState.getOwnBrandBuff === 'function') {
                const ob = gameState.getOwnBrandBuff();
                if (ob && ob.traffic > 0) traffic = Math.floor(traffic * (1 + ob.traffic));
            }
        } catch (_) {}
        return traffic;
    }

    calculatePriceFactor(price, basePrice) {
        const ratio = price / basePrice;
        if (ratio < 0.5) return 2.0;
        if (ratio < 0.8) return 1.5;
        if (ratio < 1.0) return 1.2;
        if (ratio < 1.2) return 1.0;
        if (ratio < 1.5) return 0.8;
        if (ratio < 2.0) return 0.5;
        return 0.3;
    }

    getCategoryDemand(category) {
        const demands = {
            daily: 1.0,
            digital: 0.8,
            clothing: 1.1,
            food: 0.9,
            beauty: 0.85,
            home: 0.6,
            outdoor: 0.5,
            luxury: 0.42
        };
        return demands[category] || 1.0;
    }

    calculateConversionRate(listing, product) {
        let rate = 0.03;
        
        rate += (listing.rating || 5) * 0.01;
        rate += Math.min(listing.sales / 100, 0.05);
        
        // ==================== 价格合理性对转化率的影响（核心修复：天价没人买）====================
        const priceRatio = product.basePrice > 0 ? (listing.price / product.basePrice) : 1;

        // 1) 绝对阻断：超过 buyBlockRatio（默认 30 倍）→ 买家 100% 不会购买（彻底拦截天价）
        if (priceRatio >= PRICE_RULES.buyBlockRatio) {
            return 0;
        }

        // 2) 低于成本（<0.8）、接近基础价（<1.0）→ 正向加成
        if (priceRatio < 0.8) rate += 0.025;
        else if (priceRatio < 1.0) rate += 0.015;
        // 3) 溢价 1.5x 开始轻度衰减
        else if (priceRatio > 1.5) rate -= 0.015;
        // 4) 溢价 2x+ 进一步衰减（加强对不合理高价的惩罚）
        if (priceRatio > 2.0) rate -= 0.02;
        if (priceRatio > 3.0) rate -= 0.03;

        // 5) 超过 warningRatio（默认 5x）：每超 1 倍，在 5x→30x 区间线性衰减到 0
        if (priceRatio >= PRICE_RULES.warningRatio) {
            const blockRatio = PRICE_RULES.buyBlockRatio;
            const warn = PRICE_RULES.warningRatio;
            const progress = Math.min(1, (priceRatio - warn) / Math.max(1, blockRatio - warn));
            rate *= (1 - progress); // 到 blockRatio 时 progress=1 → rate 彻底归零
        }

        // 6) 绝对定价上限：按商品底价放宽，避免顶奢按成本挂也卖不出去
        const absCap = (typeof getMaxAbsolutePrice === 'function')
            ? getMaxAbsolutePrice(product)
            : ((typeof PRICE_RULES !== 'undefined' && PRICE_RULES.maxAbsolutePrice) || 999999);
        if (listing.price > absCap) return 0;

        // 7) 高价降频但不归零：奢侈品应偶尔成交，而不是整天 0 单
        const absPrice = Number(listing.price) || 0;
        if (absPrice >= 200000) rate *= 0.18;
        else if (absPrice >= 50000) rate *= 0.32;
        else if (absPrice >= 20000) rate *= 0.48;
        else if (absPrice >= 5000) rate *= 0.7;
        if (absPrice >= 5000) rate = Math.max(rate, 0.004);
        
        const inventory = (typeof gameState.getSellableQuantity === 'function')
            ? gameState.getSellableQuantity(listing.productId, listing.qualityGrade || 'B')
            : gameState.getInventoryQuantity(listing.productId);
        if (inventory <= 0) rate = 0;
        else if (inventory < 10) rate *= 0.7;

        try {
            if (typeof gameState.getPlayerAttrFactor === 'function') {
                rate *= gameState.getPlayerAttrFactor('selection', 0.03);
            }
        } catch (_) {}

        // 自有品牌：转化率加成
        try {
            if (typeof gameState.getOwnBrandBuff === 'function') {
                const ob = gameState.getOwnBrandBuff();
                if (ob && ob.conversion > 0) rate *= (1 + ob.conversion);
            }
        } catch (_) {}
        if (product && product.ownBrandOnly) rate *= 1.12;
        
        return Math.min(0.3, Math.max(0, rate));
    }

    handleMarketingCost(clicks, views) {
        let totalCost = 0;
        const today = gameState.state.gameTime.day;
        gameState.state.marketing.activeCampaigns.forEach(c => {
            if (c.status !== 'active') return;
            
            const mType = MARKETING_TYPES[c.type];
            if (!mType) return;
            
            let cost = 0;
            if (mType.type === 'cpc') {
                // CPC：开户时不预扣全额，按点击从日预算扣；日预算耗尽则本计划本时不计费
                if (c._budgetDay !== today) {
                    c._budgetDay = today;
                    c.spentToday = 0;
                }
                const dailyBudget = Number(c.dailyBudget) || 0;
                const remaining = dailyBudget > 0 ? Math.max(0, dailyBudget - (c.spentToday || 0)) : Infinity;
                if (remaining <= 0) return;
                // 预留广告公司服务费（含最低服务费），保证媒体费+服务费合计不超过日预算
                let maxMedia = remaining;
                try {
                    const cfg = (typeof gameState.getAdAgencyConfig === 'function')
                        ? gameState.getAdAgencyConfig() : null;
                    const feeRate = (cfg && cfg.mediaCommissionRate != null) ? Number(cfg.mediaCommissionRate) : 0.02;
                    const minFee = (cfg && cfg.minFee != null) ? Number(cfg.minFee) : 0;
                    if (feeRate > 0 || minFee > 0) {
                        maxMedia = (remaining - (minFee || 0)) / (1 + feeRate);
                        if (!(maxMedia > 0)) return; // 剩余预算连最低服务费都不够，本时不再计费
                    }
                } catch (_) {}
                cost = clicks * (c.bidPrice || mType.basePrice);
                cost = Math.min(cost, maxMedia);
            } else if (mType.type === 'cpm') {
                // CPM 已在开启时预付曝光包，运行中不再按展示二次扣费
                return;
            }
            
            if (cost > 0) {
                cost = Math.round(cost * 100) / 100;
                // 媒体费 + 广告公司服务费
                const charged = (typeof gameState.chargeMarketingSpend === 'function')
                    ? gameState.chargeMarketingSpend(cost, `营销费用 - ${mType.name}`)
                    : { ok: gameState.spendFunds(cost, `营销费用 - ${mType.name}`), total: cost, mediaCost: cost };
                if (charged && charged.ok) {
                    totalCost += (charged.total != null ? charged.total : cost);
                    if (mType.type === 'cpc') {
                        // 日预算按媒体费+服务费合计累计，避免合计超预算
                        c.spentToday = (c.spentToday || 0) + (charged.total != null ? charged.total : cost);
                    }
                }
            }
        });
        return totalCost;
    }

    generateOrders(listing, product, count, priceMultiplier = 1, options = {}) {
        try {
        // ==================== 入口价格合理性拦截（防止绕过定价校验后仍产生订单）====================
        const priceRatio = product && product.basePrice > 0 ? (listing.price / product.basePrice) : 1;
        const absCap = (typeof getMaxAbsolutePrice === 'function')
            ? getMaxAbsolutePrice(product)
            : ((typeof PRICE_RULES !== 'undefined' && PRICE_RULES.maxAbsolutePrice) || 999999);
        if (
            !product ||
            listing.price <= 0 ||
            listing.price > absCap ||
            priceRatio >= PRICE_RULES.buyBlockRatio
        ) {
            return 0; // 直接拒绝生成订单
        }
        // 售价硬控已取消：不再用成本×2.5 拒单

        // 订单无限制：自然单/推广单均不再受每日软顶与硬顶约束
        const genSource = (options && (options.source === 'promo' || options.source === 'live'))
            ? 'promo' : 'organic';
        const isLux = !!(product && (product.category === 'luxury' || (product.basePrice || 0) >= 5000 || (listing.price || 0) >= 5000));
        let remainQuota = 999999;
        try {
            if (isLux && genSource !== 'promo' && typeof gameState.getLuxuryOrderQuota === 'function') {
                remainQuota = gameState.getLuxuryOrderQuota();
            } else if (typeof gameState.getOrderGenerationQuota === 'function') {
                remainQuota = gameState.getOrderGenerationQuota(genSource);
            } else if (typeof gameState.getRemainingDailyOrderQuota === 'function') {
                remainQuota = gameState.getRemainingDailyOrderQuota();
            }
        } catch (_) {}
        if (!(remainQuota > 0)) return 0;
        count = Math.min(Math.max(0, Number(count) || 0), remainQuota);
        if (!(count > 0)) return 0;

        const now = gameState.state.gameTime;
        const qualityGrade = listing.qualityGrade || 'B';
        let generatedCount = 0;

        // 修改1b：判断是否高价商品
        const HV_CATS = ['digital', 'clothing', 'beauty', 'home'];
        const isHV = (HV_CATS.includes(product.category) && product.basePrice >= 350)
            || (!HV_CATS.includes(product.category) && product.basePrice >= 500);
        // 修改3d：新店前14天退货率×0.7
        const isNewbieReturn = (now.day || 1) <= 14;

        // 可售量 = 实物库存 − 待付款占用；本批内本地递减，防止同批超卖刷单
        let available = (typeof gameState.getSellableQuantity === 'function')
            ? gameState.getSellableQuantity(listing.productId, qualityGrade)
            : gameState.getInventoryQuantity(listing.productId, qualityGrade);
        if (!(available > 0)) return 0;
        // ===== 爆单性能：批次内 product/grade 不变，成本与品质信息只算一次 =====
        const batchAvgCost = gameState.getAverageCost(listing.productId, qualityGrade);
        const batchQualityInfo = this.getQualityInfo(listing.productId, qualityGrade);
        
        for (let i = 0; i < count; i++) {
            try {
            try {
                if (isLux) {
                    if (typeof gameState.getLuxuryOrderQuota === 'function'
                        && gameState.getLuxuryOrderQuota() <= 0) break;
                } else if (typeof gameState.getOrderGenerationQuota === 'function'
                    && gameState.getOrderGenerationQuota(genSource) <= 0) break;
            } catch (_) {}
            if (available <= 0) break;
            
            const quantity = randomInt(1, Math.min(3, available));
            const avgCost = batchAvgCost;
            const qualityInfo = batchQualityInfo;
            
            const buyerName = generateBuyerName();
            const isMember = gameState.findMemberByName(buyerName);
            const memberDiscount = isMember ? gameState.getMemberDiscount(buyerName) : 1.0;
            const memberFreeShipping = isMember ? gameState.hasFreeShipping(buyerName) : false;

            // 高价品客单微幅上浮（原 1.0~1.35 过夸张，压到 1.0~1.08）
            let hvPriceBoost = 1;
            if (isHV) {
                hvPriceBoost = 1.0 + Math.random() * 0.08;
            }

            let basePrice = listing.price * quantity * priceMultiplier * hvPriceBoost;
            let couponDiscount = 0;
            let usedCoupon = null;
            let freeShipping = false;
            let promotionDiscount = 0;
            let appliedPromotions = [];
            
            const orderItems = [{ productId: listing.productId, price: listing.price * priceMultiplier * hvPriceBoost, quantity }];
            const promoResult = gameState.calculateOrderDiscount(orderItems);
            promotionDiscount = promoResult.discount;
            appliedPromotions = promoResult.appliedPromotions;
            if (promoResult.freeShipping) freeShipping = true;
            
            const availableTemplates = gameState.getAvailableCouponsForReceive();
            // 约 72% 订单尝试领券（0.85×0.85）；库存 quantity 仍为硬上限
            if (availableTemplates.length > 0 && Math.random() < 0.85) {
                const suitableTemplates = availableTemplates.filter(t => {
                    if (t.minAmount > 0 && basePrice < t.minAmount) return false;
                    if (t.scope === 'category' && t.scopeIds.length > 0 && !t.scopeIds.includes(product.category)) return false;
                    if (t.scope === 'product' && t.scopeIds.length > 0 && !t.scopeIds.includes(product.id)) return false;
                    return true;
                });
                
                if (suitableTemplates.length > 0 && Math.random() < 0.85) {
                    const template = suitableTemplates[Math.floor(Math.random() * suitableTemplates.length)];
                    // 按买家计每人限领，避免全服共用 perUserLimit
                    const receiveResult = gameState.receiveCoupon(template.id, buyerName);
                    if (receiveResult.success) {
                        const useResult = gameState.useCoupon(receiveResult.userCoupon.id, 'auto_' + Date.now(), basePrice);
                        if (useResult.success) {
                            couponDiscount = useResult.discount;
                            freeShipping = useResult.isFreeShip || memberFreeShipping || freeShipping;
                            usedCoupon = {
                                id: receiveResult.userCoupon.id,
                                templateId: template.id,
                                name: template.name,
                                type: template.type,
                                value: couponDiscount
                            };
                        }
                    }
                }
            }
            
            if (memberFreeShipping && !freeShipping) {
                freeShipping = true;
            }
            
            const totalDiscount = promotionDiscount + couponDiscount;
            const finalPrice = Math.max(0.01, (basePrice * memberDiscount) - totalDiscount);
            
            const buyerAddress = this.generateAddress();
            const warehouseCity = gameState.getWarehouseCity?.() || gameState.state.warehouse?.city || 'yiwu';
            const shipFrom = (typeof resolveShipFromCity === 'function')
                ? resolveShipFromCity(product, warehouseCity)
                : ((product && product.originCity) || warehouseCity);
            
            // 计算包裹重量（克转公斤）
            const productData = getProductById(listing.productId);
            const baseWeight = productData && productData.baseWeight ? productData.baseWeight : 50;
            const packageWeightKg = (baseWeight * quantity / 1000) + 0.1; // 加上包装材料重量
            
            const order = {
                listingId: listing.id,
                productId: listing.productId,
                productName: listing.title,
                quantity: quantity,
                unitPrice: listing.price * priceMultiplier * hvPriceBoost,
                totalAmount: parseFloat(finalPrice.toFixed(2)),
                originalAmount: basePrice,
                costAmount: avgCost * quantity,
                buyerName: buyerName,
                buyerAddress: buyerAddress,
                buyerCityId: buyerAddress.cityId,
                fromCity: shipFrom,
                packageWeightKg: parseFloat(packageWeightKg.toFixed(2)),
                isMember: !!isMember,
                memberDiscount: memberDiscount,
                memberFreeShipping: memberFreeShipping,
                freeShipping: freeShipping,
                usedCoupon: usedCoupon ? {
                    id: usedCoupon.id,
                    templateId: usedCoupon.templateId,
                    name: usedCoupon.name,
                    type: usedCoupon.type,
                    value: couponDiscount
                } : null,
                couponDiscount: parseFloat(couponDiscount.toFixed(2)),
                productQuality: qualityInfo.quality,
                qualityGrade: qualityGrade,
                createTime: { day: now.day, hour: now.hour },
                fromLivestream: priceMultiplier !== 1,
                trafficSource: genSource,
                packed: false,
                shipped: false,
                expressType: null,
                fees: null,
                logistics: {
                    status: 'pending',
                    trackingNumber: '',
                    company: ''
                },
                statusHistory: [{ status: 'pending_payment', time: { day: now.day, hour: now.hour } }]
            };

            // 修改3d：新店前14天，退货/仅退款率 ×0.7（写入订单标记，后续流程读取）
            if (isNewbieReturn) {
                order._newbieReturnMultiplier = 0.7;
            }
            // 修改1b：高价商品订单打标记（方便后续统计）
            if (isHV) {
                order._isHighValue = true;
                order._hvPriceBoost = hvPriceBoost;
            }
            
            gameState.addOrder(order);
            // 日上限触发时 addOrder 会拒单（无 id），不计入生成数
            if (!order.id) break;
            available -= quantity;

            if (appliedPromotions.length > 0) {
                gameState.applyPromotionToOrder(order, {
                    discount: promotionDiscount,
                    finalAmount: order.totalAmount,
                    appliedPromotions: appliedPromotions.map(ap => ({
                        ...ap,
                        discount: ap.type === 'coupon' ? 0 : ap.discount
                    }))
                });
            }
            
            generatedCount++;
            } catch (_orderInnerErr) {
                console.warn('[generateOrders] single order err:', _orderInnerErr);
            }
        }
        
        return generatedCount;
        } catch (_genOrderErr) {
            console.error('[generateOrders] outer err:', _genOrderErr);
            return 0;
        }
    }

    /**
     * 修改1a：高价值客群匹配判定（会员等级≥L3 或 累计消费≥3000 或 订单数≥10且客单价≥200）
     * 返回 true 则对高价商品转化率再 ×2.2
     */
    _randomHighValueBuyerCheck() {
        try {
            const members = gameState.state?.members?.list || [];
            const L3plusSpent = members.filter(m => m.level >= 3 || m.spent >= 3000 || (m.orderCount >= 10 && (m.spent / Math.max(1, m.orderCount)) >= 200));
            const hvRatio = 0.22 + Math.min(0.18, L3plusSpent.length * 0.01);
            return Math.random() < hvRatio;
        } catch (_e) {
            return Math.random() < 0.22;
        }
    }

    getQualityInfo(productId, qualityGrade = null) {
        const items = gameState.state.inventory.filter(i => i.productId === productId && (!qualityGrade || i.qualityGrade === qualityGrade));
        const totalQty = items.reduce((sum, i) => sum + i.quantity, 0);
        if (totalQty === 0) return { quality: 70, grade: qualityGrade || 'B' };
        
        const totalQuality = items.reduce((sum, i) => sum + i.quality * i.quantity, 0);
        const avgQuality = totalQuality / totalQty;
        
        const gradeCounts = {};
        items.forEach(i => {
            gradeCounts[i.qualityGrade || 'B'] = (gradeCounts[i.qualityGrade || 'B'] || 0) + i.quantity;
        });
        
        let maxGrade = qualityGrade || 'B';
        let maxQty = 0;
        Object.entries(gradeCounts).forEach(([grade, qty]) => {
            if (qty > maxQty) {
                maxQty = qty;
                maxGrade = grade;
            }
        });
        
        return { quality: avgQuality, grade: maxGrade };
    }

    calculateLogisticsFee(product) {
        // 经济平衡调整：移除"超100元全免"逻辑（高价商品会全部免邮导致失衡），改为按重量+订单金额分段免邮
        // 仅会员等级≥3或订单实付≥299元才免基础快递费（在订单生成时再判断会员等级）
        const weight = product?.baseWeight || 50;
        const baseFee = 5 + (weight / 100) * 4; // 基础5元 + 每100g加0.4元
        // 贵重商品加收保价费
        const price = product?.basePrice || 0;
        const insuranceFee = price >= 3000 ? Math.min(price * 0.005, 80) : 0;
        return parseFloat((baseFee + insuranceFee).toFixed(2));
    }

    // ========= 快递「累计成功订单」阶梯折扣 =========
    // 返回：{ discount, completedCount, label, nextTier }；整体下限 = EXPRESS_GLOBAL_MIN_DISCOUNT
    getExpressSuccessOrderDiscount(state) {
        const s = state || (typeof gameState !== 'undefined' ? gameState.state : null);
        const list = typeof EXPRESS_SUCCESS_ORDER_DISCOUNTS !== 'undefined'
            ? EXPRESS_SUCCESS_ORDER_DISCOUNTS
            : [{ minCompleted: 0, discount: 1.0, label: '10折' }];
        let completed = 0;
        try {
            if (typeof ExpressState !== 'undefined' && ExpressState) {
                completed = Number(ExpressState.totalWaybills) || 0;
                if (!completed && ExpressState.partners) {
                    const partners = ExpressState.partners;
                    Object.keys(partners).forEach(id => {
                        completed += Number(partners[id] && partners[id].totalShipments) || 0;
                    });
                }
            }
        } catch (_) {}
        if (!completed) {
            if (s && s.statistics && typeof s.statistics.totalCompletedOrders === 'number') {
                completed = s.statistics.totalCompletedOrders;
            } else if (typeof OrderPerf !== 'undefined' && OrderPerf.enabled && OrderPerf.counts
                && OrderPerf.counts.completed && typeof OrderPerf.counts.completed.all === 'number') {
                completed = OrderPerf.counts.completed.all || 0;
            } else if (s && Array.isArray(s.orders)) {
                const orders = s.orders;
                const n = orders.length;
                for (let i = 0; i < n; i++) {
                    if (orders[i] && orders[i].status === 'completed') completed++;
                }
            }
        }
        const shopLevel = (s && s.shop && s.shop.level) ? s.shop.level : 1;
        const brandId = (s && s.shop && s.shop.brandBadge) ? s.shop.brandBadge : 'normal';
        if (typeof resolveExpressVolumeDiscount === 'function') {
            return resolveExpressVolumeDiscount(completed, shopLevel, brandId);
        }
        const minDiscount = typeof EXPRESS_GLOBAL_MIN_DISCOUNT !== 'undefined'
            ? EXPRESS_GLOBAL_MIN_DISCOUNT : 0.40;
        let current = list[0];
        let next = null;
        for (let i = 0; i < list.length; i++) {
            const tier = list[i];
            if (completed >= (tier.minCompleted || 0)) {
                current = tier;
                next = list[i + 1] || null;
            } else {
                break;
            }
        }
        const discount = Math.max(minDiscount, current.discount);
        return {
            discount: Math.round(discount * 10000) / 10000,
            completedCount: completed,
            shopLevel,
            brandId,
            label: current.label,
            nextTier: next ? { ordersNeeded: Math.max(0, next.minCompleted - completed), label: next.label, minCompleted: next.minCompleted } : null
        };
    }

    calculatePackFee(order, product) {
        if (gameState.hasPackingEmployee()) {
            return 0;
        }
        const config = PACKAGING_CONFIG.packFee;
        let fee = config.base + config.perItem * order.quantity;
        return parseFloat(fee.toFixed(2));
    }

    // ============================================================
    // 计算包装材料费（v2版：复用 getPackagingFormula 做「所有材料」库存检查
    // 之前的旧版只检查 carton + bubbleWrap 2 种，导致"扣了 20 种材料但库存只看 2 种就 return 0"的bug
    // 新版逻辑：把 getPackagingFormula 返回的所有材料逐一检查 gameState.getPackagingMaterial(id)
    //         → 任何材料库存不足 → 按该材料的阶梯价累计"临时采购价"（比批量贵一点）
    // ============================================================
    calculatePackagingMaterialFee(order, product, packagingLevel = 'standard') {
        if (!product) return 0;
        // ---- 1. 计算本单要用的所有材料及数量 ----
        const orderQty = order.quantity || 1;
        const baseWeightG = product.baseWeight || 50;
        const totalWeightKg = ((baseWeightG * orderQty) / 1000) + 0.05; // 加包装自重50g
        const allMats = PACKAGING_MATERIALS || {};
        const formulaFn = (typeof getPackagingFormula !== 'undefined') ? getPackagingFormula : null;
        let formula;
        if (formulaFn) {
            formula = formulaFn(product, orderQty, totalWeightKg, packagingLevel).formula;
        } else {
            // 降级：旧版逻辑
            formula = {
                carton: 1,
                bubbleWrap: 0.5 + 0.3 * orderQty,
                tape: 0.05,
                thermal_label: 1
            };
        }

        // ---- 2. 逐一检查每个材料的库存 ----
        let needToBuy = 0;        // 需要"临时补采"的材料总金额（按散买价×加价系数
        let missingAny = false;
        Object.entries(formula).forEach(([mid, needQty]) => {
            if (needQty <= 0) return;
            const mat = allMats[mid];
            const have = gameState.getPackagingMaterial ? gameState.getPackagingMaterial(mid) : 0;
            if (have >= needQty) return;   // 库存充足 → 不扣钱
            // 库存不足 → 按散买价（加价 30% 模拟临时临采
            missingAny = true;
            let unitPrice = (mat && mat.cost) ? mat.cost * 1.3 : 1;
            if (mat && Array.isArray(mat.priceTiers) && mat.priceTiers.length) {
                unitPrice = mat.priceTiers[0].price * 1.3; // 第一档（散买）×1.3
            }
            needToBuy += (needQty - have) * unitPrice;
        });

        // ---- 3. 全都够 → 0；否则累计出来 ----
        if (!missingAny) return 0;
        needToBuy = Math.round(needToBuy * 100) / 100;

        // 最终兜底：还是用老版 materialCost（防止金额 0 或 极小数
        if (needToBuy <= 0) {
            const fallback = PACKAGING_CONFIG.materialCost;
            let f = fallback.base + fallback.perItem * orderQty;
            if (PACKAGING_CONFIG.fragileCategories && PACKAGING_CONFIG.fragileCategories.includes(product.category)) {
                f *= fallback.fragileMultiplier;
            }
            return parseFloat(f.toFixed(2));
        }
        return parseFloat(needToBuy.toFixed(2));
    }

    calculateExpressFee(order, product, expressType = 'standard') {
        if (order.memberFreeShipping || order.freeShipping) {
            return 0;
        }

        if (typeof ExpressEngine !== 'undefined') {
            const unlocked = ExpressState.getUnlockedPartners();
            if (unlocked.length > 0) {
                let companyId = order.expressCompanyId;
                let serviceId = order.expressServiceId;
                if (!companyId || !ExpressState.isPartnerUnlocked(companyId)) {
                    // 根据旧expressType选择合适的公司
                    if (expressType === 'economy') {
                        const eco = unlocked.find(p => ['yt','yd','st','jt'].includes(p.companyId));
                        companyId = eco ? eco.companyId : ExpressState.defaultCompany;
                    } else {
                        companyId = ExpressState.defaultCompany;
                    }
                }
                if (!serviceId) serviceId = 'standard';
                const warehouseCity = gameState.getWarehouseCity?.() || gameState.state.warehouse?.city || 'yiwu';
                const buyerCity = order.buyerCityId || order.buyerCity || 'shanghai';
                const weight = order.packageWeightKg || ((product.baseWeight * order.quantity) / 1000 + 0.1);
                const fee = ExpressEngine.calculateFee(companyId, serviceId, weight, warehouseCity, buyerCity, {});
                return fee.totalFee;
            }
        }

        // 降级：简单估算（未接入新快递系统时，仍应用累计成功订单全局折扣）
        const express = EXPRESS_OPTIONS?.[expressType];
        if (!express) {
            const info = this.getExpressSuccessOrderDiscount();
            const minGlobal = typeof EXPRESS_GLOBAL_MIN_DISCOUNT !== 'undefined' ? EXPRESS_GLOBAL_MIN_DISCOUNT : 0.40;
            const disc = Math.max(minGlobal, info.discount || 1.0);
            return parseFloat((8 * disc).toFixed(2));
        }
        const weight = (product.baseWeight * order.quantity) / 1000 + 0.1;
        let base = Math.max(express.basePrice, express.basePrice + Math.ceil(weight - 1) * express.pricePerKg);
        const info = this.getExpressSuccessOrderDiscount();
        const minGlobal = typeof EXPRESS_GLOBAL_MIN_DISCOUNT !== 'undefined' ? EXPRESS_GLOBAL_MIN_DISCOUNT : 0.40;
        const disc = Math.max(minGlobal, info.discount || 1.0);
        base *= disc;
        return parseFloat(base.toFixed(2));
    }

    calculateAllFees(order, product, expressType = 'standard') {
        // 如果订单已通过新系统发货，直接用运单中的费用
        if (typeof ExpressEngine !== 'undefined' && order.waybillId) {
            const wb = ExpressState.getWaybill(order.waybillId);
            if (wb) {
                return {
                    packFee: this.calculatePackFee(order, product),
                    packagingMaterialFee: this.calculatePackagingMaterialFee(order, product),
                    expressFee: wb.fee,
                    total: 0
                };
            }
        }
        return {
            packFee: this.calculatePackFee(order, product),
            packagingMaterialFee: this.calculatePackagingMaterialFee(order, product),
            expressFee: this.calculateExpressFee(order, product, expressType),
            total: 0
        };
    }

    getOrderFees(order) {
        // 列表/热路径：优先用订单已缓存费用，避免每卡 PRODUCTS.find + 全量重算
        if (order && order.fees && typeof order.fees === 'object') {
            const f = order.fees;
            if (typeof f.total === 'number' || typeof f.packFee === 'number' || typeof f.expressFee === 'number') {
                return {
                    packFee: f.packFee || 0,
                    packagingMaterialFee: f.packagingMaterialFee || 0,
                    expressFee: f.expressFee || 0,
                    packagingCost: f.packagingCost || 0,
                    total: typeof f.total === 'number'
                        ? f.total
                        : ((f.packFee || 0) + (f.packagingMaterialFee || 0) + (f.expressFee || 0))
                };
            }
        }
        const product = (typeof PRODUCTS !== 'undefined' ? PRODUCTS.find(p => p.id === order.productId) : null);
        if (!product) return null;
        const expressType = order.expressType || 'standard';
        const fees = this.calculateAllFees(order, product, expressType);
        fees.total = fees.packFee + fees.packagingMaterialFee + fees.expressFee;
        return fees;
    }

    getAverageQuality(productId) {
        const items = gameState.state.inventory.filter(i => i.productId === productId);
        const totalQty = items.reduce((sum, i) => sum + i.quantity, 0);
        const totalQuality = items.reduce((sum, i) => sum + i.quality * i.quantity, 0);
        return totalQty > 0 ? totalQuality / totalQty : 70;
    }

    generateAddress() {
        const buyerCity = getRandomBuyerCity();
        const detail = ['朝阳区xxx街道', '海淀区xxx路', '天河区xxx广场', '南山区xxx大厦', '西湖区xxx小区', '锦江区xxx巷', '洪山区xxx大道'];
        return {
            cityId: buyerCity.id,
            cityName: buyerCity.name,
            province: buyerCity.province,
            detail: `${buyerCity.name}市${randomChoice(detail)}${randomInt(1, 999)}号`,
            full: `${buyerCity.province}${buyerCity.name}市${randomChoice(detail)}${randomInt(1, 999)}号`
        };
    }

    generateConsultations() {
        if (Math.random() > 0.60) return;
        
        const listings = gameState.state.listings.filter(l => l.status === 'active');
        if (listings.length === 0) return;
        
        const listing = randomChoice(listings);
        const questions = [
            '这个商品有货吗？',
            '什么时候发货？',
            '可以优惠一点吗？',
            '质量怎么样？',
            '支持七天无理由吗？',
            '发什么快递？',
            '有赠品吗？'
        ];
        
        gameState.addConsultation({
            listingId: listing.id,
            productName: listing.title,
            buyerName: generateBuyerName(),
            question: randomChoice(questions)
        });
    }

    /** 待付款判定（85% 付款→扣库存转待打包，15% 立即取消）。返回是否发生状态变化。
     *  processOrderUpdates 整点判定与 15 分钟微步共用；listingsById 为可选预建 Map，避免逐单 .find */
    _judgePendingPayment(order, listingsById) {
        if (!order || order.status !== 'pending_payment' || order.paymentProcessed) return false;
        order.paymentProcessed = true;
        const willPay = Math.random() < 0.85;
        if (willPay) {
            // 新流程：支付成功 → 待打包（pending_packing）
            // ⭐ 无论 listing 是否还在，都必须扣库存；扣失败则取消订单，防止幽灵出库刷钱
            const removed = gameState.removeInventory(order.productId, order.quantity, order.qualityGrade, {
                orderId: order.id, note: '订单#' + (order.id || '').slice(-6) + '出库'
            });
            if (!removed) {
                gameState.updateOrderStatus(order.id, 'cancelled', order);
                order.cancelReason = '库存不足，支付后无法出库';
                return true;
            }
            try {
                if (typeof gameState.applyMemberWalletToOrder === 'function') {
                    gameState.applyMemberWalletToOrder(order);
                }
            } catch (_) {}
            gameState.updateOrderStatus(order.id, 'pending_packing', order);
            try {
                let listing = null;
                if (order.listingId) {
                    if (listingsById) {
                        listing = listingsById.get(order.listingId) || null;
                    } else {
                        const arr = gameState.state.listings || [];
                        for (let i = 0; i < arr.length; i++) {
                            if (arr[i] && arr[i].id === order.listingId) { listing = arr[i]; break; }
                        }
                    }
                }
                if (listing) listing.sales += order.quantity;
                gameState.state.shop.totalSales += order.quantity;
                if (gameState.state.statistics) gameState.state.statistics.totalConversions++;
                if (!this._productsByIdCache && typeof PRODUCTS !== 'undefined') {
                    this._productsByIdCache = new Map(PRODUCTS.map(p => [p.id, p]));
                }
                const product = this._productsByIdCache ? this._productsByIdCache.get(order.productId) : null;
                if (product && !order.fees) {
                    order.fees = this.calculateAllFees(order, product, 'standard');
                    order.fees.total = order.fees.packFee + order.fees.packagingMaterialFee + order.fees.expressFee;
                }
            } catch (_) { /* 统计/费用失败不阻断订单流转 */ }
            return true;
        }
        gameState.updateOrderStatus(order.id, 'cancelled', order);
        order.cancelReason = '超时未付款自动取消';
        const gt = gameState.state.gameTime;
        order.cancelTime = { day: gt.day, hour: gt.hour };
        return true;
    }

    /** 15 分钟微步（整点内的 15/30/45 分）：先给待付款订单付款机会（85% 付款），
     *  再按「15 分钟未付」虚拟时刻兜底取消。让 1 小时粒度时钟下「15 分钟取消」真实生效，
     *  同时待付款积压的消化吞吐 ×4。 */
    _quarterHourPendingTick(minute) {
        const now = gameState.state.gameTime;
        const synthetic = { day: now.day, hour: now.hour, minute: minute };
        let budget = 1400;
        try {
            const n = (gameState.state.orders && gameState.state.orders.length) || 0;
            const load = (typeof OrderPerf !== 'undefined' && OrderPerf.getLoadLevel) ? OrderPerf.getLoadLevel(n) : 0;
            budget = load >= 4 ? 500 : (load >= 3 ? 900 : 1400);
        } catch (_) {}
        if (this.fps > 0 && this.fps < 18) budget = Math.min(budget, 250);
        // 1) 待付款判定：先给付款机会（85% 付款→待打包）
        try {
            if (typeof OrderPerf !== 'undefined' && OrderPerf.getStatusBucket) {
                OrderPerf.ensure(gameState.state.orders);
                if (!OrderPerf.dirty) {
                    const bucket = OrderPerf.getStatusBucket('pending_payment') || [];
                    let listingsById = null;
                    let done = 0;
                    for (let i = 0; i < bucket.length && done < budget; i++) {
                        const o = bucket[i];
                        if (!o || o.status !== 'pending_payment' || o.paymentProcessed) continue;
                        if (!listingsById) {
                            const arr = gameState.state.listings || [];
                            listingsById = new Map(arr.map(l => [l.id, l]));
                        }
                        if (this._judgePendingPayment(o, listingsById)) done++;
                    }
                }
            }
        } catch (_) {}
        // 2) 15 分钟超时兜底取消（虚拟时刻判定，未获付款机会的订单到点即取消）
        try {
            if (typeof gameState.cleanupTimeoutPendingPayments === 'function') {
                gameState.cleanupTimeoutPendingPayments(synthetic);
            }
        } catch (_) {}
    }

    processOrderUpdates() {
        const now = gameState.state.gameTime;
        const orders = gameState.state.orders;
        try {
            if (typeof OrderPerf !== 'undefined' && OrderPerf.ensure) OrderPerf.ensure(orders);
        } catch (_) {}
        // ===== 爆单：有 OrderPerf 时只扫「需时间推进」的候选单，跳过待打包/待发货积压 =====
        let tickOrders = (typeof OrderPerf !== 'undefined' && typeof OrderPerf.getTickOrders === 'function')
            ? OrderPerf.getTickOrders(orders)
            : orders;

        // ===== 待付款单优先且单独高额度：支付判定轻量，快速消化「待付款太多」队列 =====
        const totalN = (orders && orders.length) || 0;
        const candN = (tickOrders && tickOrders.length) || 0;
        const pendingArr = [];
        const otherArr = [];
        for (let i = 0; i < candN; i++) {
            const o = tickOrders[i];
            if (!o) continue;
            if (o.status === 'pending_payment') pendingArr.push(o);
            else otherArr.push(o);
        }
        tickOrders = pendingArr.concat(otherArr);

        // ===== 分片推进：单次 tick 有上限，避免几千单堵死点击（已整体放宽，加快积压消化）=====
        let load = 0;
        try {
            if (typeof OrderPerf !== 'undefined' && OrderPerf.getLoadLevel) {
                load = OrderPerf.getLoadLevel(totalN);
            } else if (totalN >= 12000) load = 4;
            else if (totalN >= 5000) load = 3;
            else if (totalN >= 2000) load = 2;
            else if (totalN >= 500) load = 1;
        } catch (_) {}
        // 待付款预算：支付判定轻，额度大幅上调以快速消化「待付款太多」积压；掉帧时再砍
        let pendingBudget = Math.min(pendingArr.length, load >= 4 ? 5000 : (load >= 3 ? 10000 : 20000));
        if (this.fps > 0 && this.fps < 18) pendingBudget = Math.min(pendingBudget, 2000);
        // 其它状态预算：load0=不限, 1=5000, 2=3500, 3=2000, 4=1000
        const caps = [candN, 5000, 3500, 2000, 1000];
        let maxPer = caps[Math.min(4, Math.max(0, load))];
        try {
            const uiRef = (typeof ui !== 'undefined') ? ui
                : (typeof window !== 'undefined' ? window.ui : null);
            if (uiRef && typeof uiRef._isUserInteracting === 'function' && uiRef._isUserInteracting()) {
                maxPer = Math.min(maxPer, 500);
            }
        } catch (_) {}
        // 恢复缓冲期再砍一半
        try {
            if (this._resumeGraceUntil && Date.now() < this._resumeGraceUntil) {
                maxPer = Math.min(maxPer, 800);
            }
        } catch (_) {}
        if (this.fps > 0 && this.fps < 18) maxPer = Math.min(maxPer, 800);

        // 待付款直接切前 pendingBudget 条（支付后状态即变，下一 tick 自动轮空），
        // 其它状态按 maxPer 轮转切片，保证都能轮到
        const pendSlice = pendingArr.slice(0, pendingBudget);
        let otherSlice = otherArr;
        const otherN = otherArr.length;
        if (otherN > maxPer && maxPer > 0) {
            let start = this._orderTickOffset || 0;
            if (start >= otherN) start = 0;
            const end = Math.min(start + maxPer, otherN);
            if (end < otherN) {
                otherSlice = otherArr.slice(start, end);
                this._orderTickOffset = end;
            } else if (start > 0) {
                const need = maxPer - (otherN - start);
                otherSlice = otherArr.slice(start).concat(otherArr.slice(0, Math.max(0, need)));
                this._orderTickOffset = Math.max(0, need);
            } else {
                otherSlice = otherArr.slice(0, maxPer);
                this._orderTickOffset = maxPer >= otherN ? 0 : maxPer;
            }
            if (this._orderTickOffset >= otherN) this._orderTickOffset = 0;
        } else {
            this._orderTickOffset = 0;
        }
        tickOrders = pendSlice.concat(otherSlice);

        // ===== 性能优化预构建索引：listings 按 id 建 Map，避免 N 次 .find() =====
        const listingsArr = gameState.state.listings;
        let listingsById = null;
        function getListing(lid) {
            if (!listingsById) {
                listingsById = new Map(listingsArr.map(l => [l.id, l]));
            }
            return listingsById.get(lid);
        }
        // 预构建 productId->product Map
        let productsById = null;
        function getProduct(pid) {
            if (!productsById) {
                productsById = new Map(PRODUCTS.map(p => [p.id, p]));
            }
            return productsById.get(pid);
        }
        // 新快递系统状态常量：只在有 waybill 的订单里访问一次 ExpressState
        const hasExpress = typeof ExpressState !== 'undefined';
        const warehouseCity = gameState.getWarehouseCity();
        
        // ===== 核心性能优化：只遍历需要处理的状态 =====
        // completed/returned 已完成态无需时间推进（已在updateOrderStatus入口立即hidden）
        // pending_packing/pending_shipment 仅员工处理
        // cancelled 需要按小时推进：取消后超过1小时自动隐藏
        // 这样 2 万条订单里 90% 都会被直接跳过，大幅降低每小时卡顿
        for (let i = 0, len = tickOrders.length; i < len; i++) {
            const order = tickOrders[i];
            if (!order) continue;
            const s = order.status;
            
            // ===== cancelled 订单显示满 1 小时自动隐藏 =====
            if (s === 'cancelled' && !order.hidden) {
                const cancelTime = order.cancelTime || order.createTime || { day: 0, hour: 0 };
                const hoursSinceCancel = (now.day - cancelTime.day) * 24 + (now.hour - cancelTime.hour);
                if (hoursSinceCancel >= 1) {
                    const wasHidden = !!order.hidden;
                    order.hidden = true;
                    order.hiddenTime = { day: now.day, hour: now.hour };
                    try {
                        if (typeof OrderPerf !== 'undefined' && OrderPerf.onHiddenChanged) {
                            OrderPerf.onHiddenChanged(order, wasHidden, true);
                        }
                    } catch (_) {}
                }
                continue;
            }

            if (s === 'completed' || s === 'returned') {
                if (s === 'completed' && !order.review && !order.reviewGenerated) {
                    this._tryGenerateBuyerReview(order, now);
                } else if (!order.hidden) {
                    const wasHidden = false;
                    order.hidden = true;
                    if (!order.hiddenTime) order.hiddenTime = { day: now.day, hour: now.hour };
                    try {
                        if (typeof OrderPerf !== 'undefined' && OrderPerf.onHiddenChanged) {
                            OrderPerf.onHiddenChanged(order, wasHidden, true);
                        }
                    } catch (_) {}
                }
                continue;
            }

            if (s === 'pending_payment') {
                // 待付款当小时立即处理（支付/取消），不再等 1 小时付款窗口，
                // 避免待付款订单大量堆积；超时未处理的残留由 cleanupTimeoutPendingPayments 兜底取消
                this._judgePendingPayment(order, listingsById);
                continue;
            }
            
            if (s === 'shipped') {
                const shipTime = order.shipTime;
                if (!shipTime) continue;
                const hoursPassed = (now.day - shipTime.day) * 24 + (now.hour - shipTime.hour);
                const expressType = order.expressType || 'standard';
                const buyerCity = order.buyerCityId || 'shanghai';

                // ===== 新快递系统：同步运单状态到order.logistics =====
                const hasNewWaybill = hasExpress && order.waybillId;
                if (hasNewWaybill) {
                    const wb = ExpressState.getWaybill(order.waybillId);
                    if (wb) {
                        // 状态未变且非终态：跳过轨迹重建（爆单主因之一）
                        if (order._wbStatusCache === wb.status && wb.status !== 'signed' && wb.status !== 'lost') {
                            continue;
                        }
                        order._wbStatusCache = wb.status;
                        // 初始化旧物流结构（兼容老代码）
                        if (!order.logistics) order.logistics = { status: 'shipped', updates: [] };
                        // 映射新状态到旧状态
                        const statusMap = {
                            'pending': 'shipped',
                            'collected': 'shipped',
                            'transfer': 'in_transit',
                            'in_transit': 'in_transit',
                            'delivering': 'delivered',
                            'delivered': 'signed',
                            'signed': 'signed',
                            'lost': 'lost',
                            'problem': 'problem'
                        };
                        const oldStatus = statusMap[wb.status] || 'shipped';
                        if (order.logistics.status !== oldStatus) {
                            order.logistics.status = oldStatus;
                            const tracks = ExpressState.getTracksByWaybill(order.waybillId);
                            order.logistics.updates = tracks.map(t => ({
                                status: t.description,
                                time: `第${t.time ? t.time.day : t.day}天 ${t.time ? t.time.hour : t.hour}:00`,
                                location: t.location || ''
                            }));
                        }
                        // 丢失处理
                        if (wb.status === 'lost' && !order.lossChecked) {
                            order.lossChecked = true;
                            this.handlePackageLost(order);
                            continue;
                        }
                        // 签收 -> 完成订单（发货后 1～3 天；若ExpressEngine尚未处理）
                        if (wb.status === 'signed' && order.status === 'shipped') {
                            const minShipHours = (typeof MIN_SHIP_TO_COMPLETE_HOURS !== 'undefined') ? MIN_SHIP_TO_COMPLETE_HOURS : 24;
                            if (hoursPassed < minShipHours) continue;
                            order.logistics.status = 'signed';
                            gameState.updateOrderStatus(order.id, 'completed', order);
                            order.completeTime = { day: now.day, hour: now.hour };
                            gameState.settleOrderSale(order);
                            gameState.addReputation(randomInt(1, 3));
                            gameState.updateMemberSpending(order.buyerName, order.totalAmount);
                            // 预约买家评价（updateOrderStatus 也会兜底预约）
                            this._scheduleBuyerReview(order, now);
                            continue;
                        }
                        // 新系统已接管物流推进，跳过旧的按小时递推逻辑
                        continue;
                    }
                }

                // ===== 旧版物流逻辑（仅无新运单的订单走这里）=====
                // ===== 自愈：运单已签收但被裁剪删除（历史遗留卡死单）→ 按签收标记直接完成 =====
                if (order.deliveryStatus === 'delivered') {
                    const healMinHours = (typeof MIN_SHIP_TO_COMPLETE_HOURS !== 'undefined') ? MIN_SHIP_TO_COMPLETE_HOURS : 24;
                    if (hoursPassed >= healMinHours) {
                        if (!order.logistics) order.logistics = { status: 'signed', updates: [] };
                        order.logistics.status = 'signed';
                        gameState.updateOrderStatus(order.id, 'completed', order);
                        order.completeTime = { day: now.day, hour: now.hour };
                        gameState.settleOrderSale(order);
                        gameState.addReputation(randomInt(1, 3));
                        gameState.updateMemberSpending(order.buyerName, order.totalAmount);
                        this._scheduleBuyerReview(order, now);
                    }
                    continue;
                }

                const express = EXPRESS_OPTIONS[expressType] || EXPRESS_OPTIONS.standard;
                
                // 根据距离计算送达天数（发货→完成固定 1～3 天）
                const minShipHours = (typeof MIN_SHIP_TO_COMPLETE_HOURS !== 'undefined') ? MIN_SHIP_TO_COMPLETE_HOURS : 24;
                const maxShipHours = (typeof MAX_SHIP_TO_COMPLETE_HOURS !== 'undefined') ? MAX_SHIP_TO_COMPLETE_HOURS : 72;
                const deliveryDays = Math.max(1, Math.min(3, calculateDeliveryDays(expressType, warehouseCity, buyerCity)));
                let deliveryHoursMin = Math.max(minShipHours - 12, (deliveryDays - 1) * 18 + 12); // 最快送达（派送）
                let deliveryHoursMax = Math.max(minShipHours, deliveryDays * 24); // 签收/完成节点
                deliveryHoursMax = Math.min(maxShipHours, Math.max(minShipHours, deliveryHoursMax));
                deliveryHoursMin = Math.min(deliveryHoursMax - 6, Math.max(4, deliveryHoursMin));
                const checkHour = Math.floor((deliveryHoursMin + deliveryHoursMax) / 2);
                
                if (express && express.lossRate > 0 && !order.lossChecked) {
                    if (hoursPassed >= checkHour) {
                        order.lossChecked = true;
                        // 经济平衡：高价商品快递员会更谨慎，丢包率按价格指数降低
                        const product = getProduct(order.productId);
                        const price = product?.basePrice || 50;
                        let adjustedLossRate = express.lossRate;
                        if (price >= 3000) adjustedLossRate *= 0.15;       // 3000元+ 大幅降（保价件）
                        else if (price >= 1000) adjustedLossRate *= 0.35;  // 1000元+ 降
                        else if (price >= 500) adjustedLossRate *= 0.6;    // 500元+ 小幅降
                        if (Math.random() < adjustedLossRate) {
                            this.handlePackageLost(order);
                            continue;
                        }
                    }
                }
                
                if (hoursPassed >= 4 && order.logistics && order.logistics.status === 'shipped') {
                    order.logistics.status = 'in_transit';
                    order.logistics.updates = order.logistics.updates || [];
                    order.logistics.updates.push({
                        status: '运输中',
                        time: `第${now.day}天 ${now.hour}:00`,
                        location: '快件正在运输途中'
                    });
                }
                
                if (hoursPassed >= deliveryHoursMin && order.logistics && order.logistics.status === 'in_transit') {
                    order.logistics.status = 'delivered';
                    order.logistics.updates = order.logistics.updates || [];
                    order.logistics.updates.push({
                        status: '已送达',
                        time: `第${now.day}天 ${now.hour}:00`,
                        location: '快件已送达，正在派送'
                    });
                }
                
                if (hoursPassed >= deliveryHoursMax && order.logistics && order.logistics.status === 'delivered') {
                    order.logistics.status = 'signed';
                    order.logistics.updates = order.logistics.updates || [];
                    order.logistics.updates.push({
                        status: '已签收',
                        time: `第${now.day}天 ${now.hour}:00`,
                        location: '本人已签收'
                    });
                    
                    gameState.updateOrderStatus(order.id, 'completed', order);
                    // 记录完成时间，用于后续7天清理判断
                    order.completeTime = { day: now.day, hour: now.hour };
                    gameState.settleOrderSale(order);
                    gameState.addReputation(randomInt(1, 3));
                    
                    gameState.updateMemberSpending(order.buyerName, order.totalAmount);
                    this._scheduleBuyerReview(order, now);
                }
                continue;
            }
            // 其他所有状态：完全跳过
        }

    // ===== 满负荷回款保护：签收→完成批量扫尾，不再被 maxPer 分片挤占 =====
    // 背景：大订单量时 shipped 单被塞进 otherSlice 的 120~700/tick 轮转分片，
    // 7.5 万已签收运单要数周才能轮到一次 → completed 长期为 0、资金回款严重滞后。
    // 修复：分片循环后按「扫尾游标 + 独立预算」轮转扫描 shipped 桶，
    // 只做轻量就绪判断（deliveryStatus / 运单 signed / 旧物流 delivered），
    // 每 tick 完成 800~3000 单，任意积压约 1 个游戏日内清空。
    this._sweepSignedShipments(now);
    } // end processOrderUpdates

    /** 签收→完成批量扫尾（独立轮转游标，不参与 maxPer 分片） */
    _sweepSignedShipments(now) {
        const orders = gameState.state.orders;
        let bucket = null;
        try {
            if (typeof OrderPerf !== 'undefined' && OrderPerf.getStatusBucket) {
                bucket = OrderPerf.getStatusBucket('shipped', orders);
            }
        } catch (_) { bucket = null; }
        if (!bucket) {
            bucket = (orders || []).filter(o => o && o.status === 'shipped');
        }
        const n = bucket.length;
        if (n === 0) { this._shipSweepOffset = 0; return; }
        // 流畅时保持回款吞吐（测试：1.5 万单须在有限 tick 内清空）；掉帧/点击再砍
        let budget = Math.min(n, Math.max(800, Math.ceil(n / 25)));
        if (budget > 2000) budget = 2000;
        try {
            const uiRef = (typeof ui !== 'undefined') ? ui : (typeof window !== 'undefined' ? window.ui : null);
            if (uiRef && typeof uiRef._isUserInteracting === 'function' && uiRef._isUserInteracting()) {
                budget = Math.min(budget, 80);
            }
        } catch (_) {}
        if (this.fps > 0 && this.fps < 18) budget = Math.min(budget, 120);
        else if (this.fps > 0 && this.fps < 28) budget = Math.min(budget, 280);
        let start = this._shipSweepOffset || 0;
        if (start >= n) start = 0;
        const end = Math.min(start + budget, n);
        // 快照切片：完成订单会触发 shipped 桶 swap-remove，遍历快照避免漏单/重复
        let slice = bucket.slice(start, end);
        const need = budget - slice.length;
        if (need > 0) {
            slice = slice.concat(bucket.slice(0, Math.min(need, start)));
        }
        this._shipSweepOffset = (start + budget) % n;

        const minShipHours = (typeof MIN_SHIP_TO_COMPLETE_HOURS !== 'undefined') ? MIN_SHIP_TO_COMPLETE_HOURS : 24;
        const hasExpress = typeof ExpressState !== 'undefined';
        const sweepStart = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const dropFrames = this.fps > 0 && this.fps < 28;
        const maxSweepMs = (this.fps > 0 && this.fps < 18) ? 8 : 14;
        for (let i = 0; i < slice.length; i++) {
            if (dropFrames && (i & 15) === 15) {
                const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                if (nowMs - sweepStart > maxSweepMs) break;
            }
            const order = slice[i];
            if (!order || order.status !== 'shipped' || !order.shipTime) continue;
            const hoursPassed = (now.day - order.shipTime.day) * 24 + (now.hour - order.shipTime.hour);
            let ready = false;
            if (order.deliveryStatus === 'delivered') {
                // 新快递系统：运单签收时 ExpressEngine 已标记送达（运单被裁剪也能自愈完成）
                ready = true;
            } else if (order.waybillId && hasExpress) {
                // 兜底：运单已签收但订单漏标送达
                const wb = ExpressState.getWaybill(order.waybillId);
                if (wb && wb.status === 'signed') {
                    order._wbStatusCache = 'signed';
                    ready = true;
                }
            } else if (order.logistics && order.logistics.status === 'delivered') {
                // 旧物流路径：已送达
                ready = true;
            }
            if (!ready || hoursPassed < minShipHours) continue;
            if (!order.logistics) order.logistics = { status: 'signed', updates: [] };
            order.logistics.status = 'signed';
            gameState.updateOrderStatus(order.id, 'completed', order);
            order.completeTime = { day: now.day, hour: now.hour };
            gameState.settleOrderSale(order);
            try { gameState.addReputation(randomInt(1, 3)); } catch (_) {}
            gameState.updateMemberSpending(order.buyerName, order.totalAmount);
            this._scheduleBuyerReview(order, now);
        }
    }

    /** 签收完成后预约买家评价（2–8 小时内，避免次日才评却被终态订单裁掉） */
    _scheduleBuyerReview(order, now) {
        if (!order || order.review || order.reviewGenerated) return;
        if (order.reviewScheduled && order.reviewTime) return;
        const t = now || (gameState && gameState.state && gameState.state.gameTime) || { day: 1, hour: 0 };
        const base = order.completeTime || t;
        const delay = 2 + Math.floor(Math.random() * 7);
        let day = base.day || t.day || 1;
        let hour = (base.hour != null ? base.hour : t.hour) || 0;
        hour += delay;
        while (hour >= 24) { hour -= 24; day += 1; }
        order.reviewScheduled = true;
        order.reviewTime = { day: day, hour: hour };
    }

    /** 到点生成买家评价（completed 订单专用） */
    _tryGenerateBuyerReview(order, now) {
        if (!order || order.review || order.reviewGenerated) return false;
        this._scheduleBuyerReview(order, now);
        if (!order.reviewTime) return false;
        const t = now || gameState.state.gameTime;
        const hoursPassed = (t.day - order.reviewTime.day) * 24 + (t.hour - order.reviewTime.hour);
        if (hoursPassed < 0) {
            const ct = order.completeTime || t;
            const sinceComplete = (t.day - (ct.day || t.day)) * 24 + (t.hour - (ct.hour || 0));
            if (sinceComplete < 8) return false;
        }
        order.reviewGenerated = true;
        // 约 22% 懒得写字，星级仍按品质随机，不再默认全 5 星
        if (Math.random() >= 0.78) {
            order.reviewSkipped = true;
            const silent = this._rollBuyerReviewRating(order);
            try { gameState.addReview(order.id, silent.rating, ''); } catch (_) {}
            return true;
        }
        this.generateReview(order);
        return true;
    }

    handlePackageLost(order) {
        if (!order.logistics) order.logistics = { status: 'lost', updates: [] };
        order.logistics.status = 'lost';
        order.logistics.updates = order.logistics.updates || [];
        order.logistics.updates.push({
            status: '包裹丢失',
            time: `第${gameState.state.gameTime.day}天 ${gameState.state.gameTime.hour}:00`,
            location: '快件在运输途中丢失'
        });
        
        gameState.updateOrderStatus(order.id, 'returned', order);
        
        const expressType = order.expressType || 'standard';
        const express = EXPRESS_OPTIONS[expressType] || EXPRESS_OPTIONS.standard;
        const isNewExpress = order.waybillId && typeof ExpressState !== 'undefined';
        // 退款比例：新系统统一全额退款，旧系统按快递类型
        const compensationRate = isNewExpress ? 1 : (express && express.id === 'economy' ? 0.5 : 1);
        const perOrderCap = isNewExpress ? 8000 : (express && express.id === 'economy' ? 3000 : 8000);
        const compensation = Math.min(order.totalAmount * compensationRate, perOrderCap);
        
        // 防重复退款：同一订单只向买家退一次
        if (compensation > 0 && !order.alreadyRefunded) {
            gameState.spendFunds(compensation, `包裹丢失退款 - ${order.productName}`);
            order.alreadyRefunded = true;
            order.refundedAmount = compensation;
        }
        
        // 快递公司赔付：部分公司会拒赔或限额过低，由律师依法追偿
        if (isNewExpress && !order._courierIndemnityPaid && (order.refundedAmount || 0) > 0) {
            try {
                const refuseChance = (typeof LEGAL_PROCESS_CONFIG !== 'undefined'
                    && LEGAL_PROCESS_CONFIG.autoFile && LEGAL_PROCESS_CONFIG.autoFile.courierRefuseChance != null)
                    ? LEGAL_PROCESS_CONFIG.autoFile.courierRefuseChance : 0.34;
                const companyId = order.expressCompanyId;
                const cname = (typeof getCompanyById === 'function' && companyId)
                    ? (getCompanyById(companyId)?.name || '快递') : '快递';
                if (Math.random() < refuseChance) {
                    order._courierIndemnityRefused = true;
                    order.courierIndemnity = 0;
                    eventBus.emit('toast:show', {
                        message: `⚠️ ${cname}包裹丢失且拒赔，律师将依法起诉追偿`,
                        type: 'warning'
                    });
                } else {
                    const partner = (typeof ExpressState !== 'undefined' && companyId)
                        ? ExpressState.getPartner(companyId) : null;
                    const lvl = partner && typeof getCooperationLevel === 'function'
                        ? getCooperationLevel(partner) : { level: 0 };
                    const rate = 0.3 + (lvl.level || 0) * 0.1;
                    let indemnity = Math.round((order.totalAmount || 0) * rate);
                    indemnity = Math.min(indemnity, perOrderCap, order.refundedAmount || 0);
                    if (indemnity > 0) {
                        gameState.addFunds(indemnity, `${cname}丢件赔偿`);
                        order._courierIndemnityPaid = true;
                        order.courierIndemnity = indemnity;
                        if (indemnity + 1 < (order.refundedAmount || 0) * 0.7) {
                            order._courierIndemnityShort = true;
                        }
                        eventBus.emit('toast:show', {
                            message: `⚠️ ${cname}包裹丢失，获赔¥${indemnity}${order._courierIndemnityShort ? '（不足额，可起诉）' : ''}`,
                            type: 'warning'
                        });
                    } else {
                        order._courierIndemnityRefused = true;
                    }
                }
            } catch (e) { /* ignore */ }
        } else if (!isNewExpress) {
            order._courierIndemnityRefused = true;
            order.courierIndemnity = 0;
        }
        
        gameState.addDispute({
            orderId: order.id,
            reason: '包裹丢失',
            amount: order.totalAmount
        });
        
        const product = PRODUCTS?.find(p => p.id === order.productId);
        const price = product?.basePrice || 0;
        const repPenalty = price >= 3000 ? -3 : -5;
        gameState.addReputation(repPenalty);
        
        gameState.addReturn({
            orderId: order.id,
            productName: order.productName,
            buyerName: order.buyerName,
            reason: '包裹丢失',
            reasonText: '包裹丢失',
            amount: compensation,
            alreadyRefunded: true
        });
    }

    _buyerReviewNegativeRate(order) {
        const qualityGrade = order.qualityGrade || 'B';
        const product = PRODUCTS?.find(p => p.id === order.productId);
        let negativeRate = (typeof getAdjustedNegativeRate === 'function')
            ? getAdjustedNegativeRate(product, qualityGrade)
            : (QUALITY_GRADES[qualityGrade] || QUALITY_GRADES.B).negativeRate;
        if (order._packQuality && order._packQuality < 1) {
            negativeRate *= order._packQuality;
        }
        if (order.shippedBy) {
            const shipper = (gameState.state.employees || []).find(e => e && e.id === order.shippedBy);
            if (shipper && typeof EMPLOYEE_LEVEL_CONFIG !== 'undefined') {
                const shipperQF = EMPLOYEE_LEVEL_CONFIG.qualityFactor(shipper.level || 1);
                negativeRate *= (0.96 + 0.04 * shipperQF);
            }
        }
        return Math.max(0, Number(negativeRate) || 0);
    }

    _rollBuyerReviewRating(order) {
        const quality = order.productQuality || 70;
        const negativeRate = this._buyerReviewNegativeRate(order);
        const mood = Math.random();
        let rating;
        let kind = 'positive';

        if (mood < negativeRate) {
            rating = Math.random() < 0.62 ? 1 : 2;
            kind = 'negative';
        } else if (quality >= 85) {
            if (mood < negativeRate + 0.08) { rating = 3; kind = 'neutral'; }
            else if (Math.random() < 0.18) { rating = 4; kind = Math.random() < 0.25 ? 'neutral' : 'positive'; }
            else { rating = 5; kind = 'positive'; }
        } else if (quality >= 65) {
            const r = Math.random();
            if (r < 0.12) { rating = 3; kind = 'neutral'; }
            else if (r < 0.48) { rating = 4; kind = Math.random() < 0.35 ? 'neutral' : 'positive'; }
            else { rating = 5; kind = 'positive'; }
        } else {
            const r = Math.random();
            if (r < 0.08) { rating = 5; kind = 'positive'; }
            else if (r < 0.42) { rating = 4; kind = Math.random() < 0.5 ? 'neutral' : 'positive'; }
            else { rating = 3; kind = 'neutral'; }
        }

        // 心情抖动：偶尔星级和语气错开一档
        if (Math.random() < 0.08 && rating >= 4) {
            rating = Math.max(3, rating - 1);
            if (rating === 3) kind = 'neutral';
        } else if (Math.random() < 0.06 && rating === 3) {
            rating = 4;
            kind = Math.random() < 0.5 ? 'neutral' : 'positive';
        }
        return { rating, kind };
    }

    generateReview(order) {
        const rolled = this._rollBuyerReviewRating(order);
        const rating = rolled.rating;
        const kind = rolled.kind;
        const ctx = { productName: order.productName || '' };
        let content = '';
        if (typeof composeBuyerReview === 'function') {
            content = composeBuyerReview(kind, ctx);
        } else {
            const templates = (typeof REVIEW_TEMPLATES !== 'undefined' && REVIEW_TEMPLATES[kind])
                ? REVIEW_TEMPLATES[kind]
                : REVIEW_TEMPLATES.positive;
            content = randomChoice(templates);
        }
        gameState.addReview(order.id, rating, content);

        if (rating <= 2 && Math.random() < 0.3) {
            this.initiateReturn(order);
        }
    }

    // 处理采购订单
    processPurchaseOrders() {
        try {
            if (typeof gameState.tickOwnFactoryProduction === 'function') gameState.tickOwnFactoryProduction();
        } catch (_) {}
        const now = gameState.state.gameTime;
        
        gameState.state.purchaseOrders.forEach(order => {
            if (!order) return;
            // 旧档缺 createTime 时补齐，避免崩溃
            if (!order.createTime) order.createTime = { day: now.day, hour: now.hour };
            if (typeof order.expectedArrivalDay !== 'number') {
                order.expectedArrivalDay = (order.createTime.day || now.day) + (order.deliveryDays || 3);
            }
            if (order.status === 'pending') {
                const hoursPassed = (now.day - order.createTime.day) * 24 + (now.hour - order.createTime.hour);
                if (hoursPassed >= 4) {
                    order.status = 'shipping';
                    order.shipTime = { ...now };
                }
            }
            
            if (order.status === 'shipping') {
                if (now.day >= order.expectedArrivalDay) {
                    gameState.receivePurchaseOrder(order.id);
                }
            }
        });
    }

    /** 释放无员工任务承接的 beingPacked / beingShipped 幽灵锁 */
    _releaseOrphanOrderLocks() {
        const employees = gameState.state.employees || [];
        const activePack = new Set();
        const activeShip = new Set();
        for (let i = 0; i < employees.length; i++) {
            const emp = employees[i];
            if (!emp || emp.status !== 'active' || !emp.currentTask) continue;
            const t = emp.currentTask;
            const ids = t.orderIds || (t.orderId ? [t.orderId] : []);
            if (t.type === 'pack') ids.forEach(id => id && activePack.add(id));
            if (t.type === 'ship') ids.forEach(id => id && activeShip.add(id));
        }
        // 只扫待打包/待发货桶，避免全表扫终态单
        let candidates = null;
        try {
            if (typeof OrderPerf !== 'undefined' && OrderPerf.getStatusBucket) {
                OrderPerf.ensure(gameState.state.orders);
                candidates = []
                    .concat(OrderPerf.getStatusBucket('pending_packing') || [])
                    .concat(OrderPerf.getStatusBucket('pending_shipment') || []);
            }
        } catch (_) {}
        if (!candidates) candidates = gameState.state.orders || [];
        for (let i = 0; i < candidates.length; i++) {
            const o = candidates[i];
            if (!o) continue;
            if (o.beingPacked && !activePack.has(o.id)) {
                o.beingPacked = false;
                o.beingPackedBy = null;
            }
            if (o.beingShipped && !activeShip.has(o.id)) {
                o.beingShipped = false;
                o.beingShippedBy = null;
            }
        }
    }

    // 统计各环节积压量（用于智能调度）；可选带回打包/发货队列，避免二次全表扫描
    _getBacklogStats(withQueues = false) {
        const cs = gameState.state.customerService || {};
        let packBacklog = 0, shipBacklog = 0;
        const packQueue = withQueues ? [] : null;
        const shipQueue = withQueues ? [] : null;
        // 优先走 OrderPerf 状态桶，O(积压) 而非 O(全部订单)
        let packSrc = null, shipSrc = null;
        try {
            if (typeof OrderPerf !== 'undefined' && OrderPerf.getStatusBucket) {
                OrderPerf.ensure(gameState.state.orders);
                packSrc = OrderPerf.getStatusBucket('pending_packing');
                shipSrc = OrderPerf.getStatusBucket('pending_shipment');
            }
        } catch (_) {}
        if (!packSrc || !shipSrc) {
            const orders = gameState.state.orders || [];
            packSrc = [];
            shipSrc = [];
            for (let i = 0; i < orders.length; i++) {
                const o = orders[i];
                if (!o) continue;
                if (o.status === 'pending_packing') packSrc.push(o);
                else if (o.status === 'pending_shipment') shipSrc.push(o);
            }
        }
        for (let i = 0; i < packSrc.length; i++) {
            const o = packSrc[i];
            if (!o || o.packed || o.beingPacked) continue;
            packBacklog++;
            if (packQueue) packQueue.push(o);
        }
        for (let i = 0; i < shipSrc.length; i++) {
            const o = shipSrc[i];
            if (!o || !o.packed || o.shipped || o.beingShipped) continue;
            shipBacklog++;
            if (shipQueue) shipQueue.push(o);
        }
        let csBacklog = 0;
        const consultations = cs.consultations || [];
        for (let i = 0; i < consultations.length; i++) {
            if (consultations[i] && consultations[i].status === 'pending') csBacklog++;
        }
        // marketing: 有在售且有货的 listing 才算可推广（用积压量放大，保证店长/推广员优先做营销）
        let marketable = 0;
        const listings = gameState.state.listings || [];
        for (let i = 0; i < listings.length; i++) {
            const l = listings[i];
            if (!l || l.paused || l.status === 'inactive') continue;
            if (l.status && l.status !== 'active') continue;
            try {
                const grade = l.qualityGrade || 'B';
                const q = (typeof gameState.getSellableQuantity === 'function')
                    ? gameState.getSellableQuantity(l.productId, grade)
                    : (gameState.getInventoryQuantity
                        ? gameState.getInventoryQuantity(l.productId, grade)
                        : 1);
                if (q > 0) marketable++;
            } catch (_) { marketable++; }
        }
        const marketingBacklog = marketable > 0 ? Math.max(8, marketable) : 0;
        // 有库存但未上架的 SKU → 上架任务积压
        let listingBacklog = 0;
        try {
            const inv = gameState.state.inventory || [];
            const stockMap = {};
            for (let i = 0; i < inv.length; i++) {
                const it = inv[i];
                if (!it || !(it.quantity > 0) || !it.productId) continue;
                const g = it.qualityGrade || 'B';
                const k = it.productId + '|' + g;
                stockMap[k] = (stockMap[k] || 0) + it.quantity;
            }
            Object.keys(stockMap).forEach(k => {
                const parts = k.split('|');
                const pid = parts[0];
                const g = parts[1] || 'B';
                const listed = listings.some(l =>
                    l && l.status === 'active' && !l.paused
                    && l.productId === pid && (l.qualityGrade || 'B') === g
                );
                if (!listed) listingBacklog++;
            });
        } catch (_) {}
        const result = {
            pack: packBacklog,
            ship: shipBacklog,
            consultation: csBacklog,
            marketing: marketingBacklog,
            promotion: marketingBacklog,
            listing: listingBacklog,
            pricing: listings.filter(l => l && l.status === 'active').length
        };
        if (withQueues) {
            result.packQueue = packQueue;
            result.shipQueue = shipQueue;
        }
        return result;
    }

    // 处理员工任务（重构版：智能调度 + 批量处理 + 专业加成）
    processEmployeeTasks() {
        const now = gameState.state.gameTime;
        // 清理幽灵打包/发货锁：员工离职或任务丢失后订单仍卡 beingPacked，导致一键打包「没有订单」
        try { this._releaseOrphanOrderLocks(); } catch (_) {}
        // 一次性统计积压 + 打包/发货队列（单次全表扫描）
        const backlog = this._getBacklogStats(true);
        const packQueue = backlog.packQueue || [];
        const shipQueue = backlog.shipQueue || [];
        let packIdx = 0;
        let shipIdx = 0;
        
        let newAssigns = 0;
        const MAX_NEW_ASSIGN = 16;
        gameState.state.employees.forEach(emp => {
            if (emp.status !== 'active') return;
            if (emp.type === 'factoryDirector' || emp.position === 'factoryDirector') return;
            
            // 处理正在进行的任务
            if (emp.currentTask) {
                const task = emp.currentTask;
                if (!task.startTime || typeof task.startTime.day !== 'number') {
                    emp.currentTask = null; // 坏任务直接清掉，避免卡死
                } else {
                const hoursPassed = (now.day - task.startTime.day) * 24 + (now.hour - (task.startTime.hour || 0));
                const duration = task.duration || 1;
                
                if (hoursPassed >= duration) {
                    this.completeEmployeeTask(emp);
                } else {
                    return; // 还在干活，跳过
                }
                }
            }
            
            // 刚完成任务的员工（currentTask已清空）：重新分配
            if (newAssigns >= MAX_NEW_ASSIGN) return;
            // 智能优先级排序：员工专精 × 当前积压量 综合评分
            const prioritizedSkills = gameState.getPrioritizedSkills(emp, backlog);
            let assigned = false;
            
            for (let sIdx = 0; sIdx < prioritizedSkills.length && !assigned; sIdx++) {
                const skill = prioritizedSkills[sIdx];
                
                if (skill === 'pack' && backlog.pack > 0 && packIdx < packQueue.length) {
                    const level = emp.level || 1;
                    const capacity = (typeof EMPLOYEE_LEVEL_CONFIG.packCapacity === 'function')
                        ? EMPLOYEE_LEVEL_CONFIG.packCapacity(level)
                        : (2 + level);
                    const take = Math.max(1, capacity);
                    const batch = packQueue.slice(packIdx, packIdx + take);
                    if (batch.length > 0) {
                        packIdx += batch.length;
                        this.assignPackTask(emp, batch);
                        backlog.pack -= batch.length;
                        assigned = true;
                        break;
                    }
                }
                
                if (skill === 'ship' && backlog.ship > 0 && shipIdx < shipQueue.length) {
                    const level = emp.level || 1;
                    const isShipper = emp.type === 'shipper';
                    const capacity = EMPLOYEE_LEVEL_CONFIG.shipCapacity(level, isShipper);
                    const take = Math.max(1, capacity);
                    const batch = shipQueue.slice(shipIdx, shipIdx + take);
                    if (batch.length > 0) {
                        shipIdx += batch.length;
                        this.assignShipTask(emp, batch);
                        backlog.ship -= batch.length;
                        assigned = true;
                        break;
                    }
                }
                
                if (skill === 'consultation' && backlog.consultation > 0) {
                    const pendingConsultations = (gameState.state.customerService.consultations || []).filter(
                        c => c.status === 'pending'
                    );
                    if (pendingConsultations.length > 0) {
                        const level = emp.level || 1;
                        const isCS = emp.type === 'customerService';
                        const capacity = EMPLOYEE_LEVEL_CONFIG.csCapacity(level, isCS);
                        // 超过容量则分配任务，不足则直接秒处理完
                        if (pendingConsultations.length <= capacity) {
                            // 直接一次性处理完（沿用轻量逻辑）
                            this._handleConsultationBatch(emp, pendingConsultations, now);
                            backlog.consultation = 0;
                        } else {
                            const batch = pendingConsultations.slice(0, capacity);
                            this.assignConsultationTask(emp, batch);
                            backlog.consultation -= batch.length;
                            assigned = true;
                            break;
                        }
                    }
                }
                
                if ((skill === 'marketing' || skill === 'promotion') && backlog.marketing > 0) {
                    // ===== 爆单保护：订单越多推广越稀疏，主线程与在途积压都让给订单推进 =====
                    const _orderN = (gameState.state.orders || []).length;
                    let promoInterval = 1;
                    if (_orderN > 3500) promoInterval = 12;
                    else if (_orderN > 2000) promoInterval = 6;
                    else if (_orderN > 800) promoInterval = 2;
                    if (((now.hour || 0) % promoInterval) !== 0) {
                        // 本小时跳过推广任务分配，让员工歇一脚
                    } else {
                    const hKey = 'D' + now.day + 'H' + now.hour;
                    const lastRun = emp._lastMarketingKey || '';
                    if (lastRun !== hKey) {
                        emp._lastMarketingKey = hKey;
                        this.assignMarketingTask(emp);
                        assigned = true;
                        break;
                    }
                    }
                }

                if (skill === 'pricing' && (backlog.pricing || 0) > 0) {
                    const hKey = 'D' + now.day + 'H' + now.hour;
                    if (emp._lastPricingKey !== hKey) {
                        const ok = this.assignPricingTask(emp);
                        if (ok) {
                            emp._lastPricingKey = hKey;
                            assigned = true;
                            break;
                        }
                    }
                }

                if (skill === 'listing' && (backlog.listing || 0) > 0) {
                    const hKey = 'D' + now.day + 'H' + now.hour;
                    if (emp._lastListingKey !== hKey) {
                        const ok = this.assignListingTask(emp);
                        if (ok) {
                            emp._lastListingKey = hKey;
                            backlog.listing = Math.max(0, (backlog.listing || 1) - 1);
                            assigned = true;
                            break;
                        }
                    }
                }
            }
            if (assigned) newAssigns++;
        });
    }

    /** 客服/推广员/店长：有库存未上架时自动上架（必须有在职客服坐镇，没有客服不能上架） */
    assignListingTask(emp) {
        if (!emp) return false;
        // 没有客服时不允许自动上架（上架必须要有客服）
        if (typeof gameState.hasActiveCustomerService === 'function'
            ? !gameState.hasActiveCustomerService()
            : !(gameState.state.employees || []).some(e =>
                e && e.status === 'active' &&
                (e.type === 'customerService' || e.position === 'customerService'))) {
            return false;
        }
        const candidates = this._getUnlistedInventoryCandidates();
        if (!candidates.length) return false;
        const pick = candidates[0];
        const product = (typeof getProductById === 'function')
            ? getProductById(pick.productId)
            : ((typeof PRODUCTS !== 'undefined') ? PRODUCTS.find(p => p.id === pick.productId) : null);
        if (!product) return false;
        let price = 0;
        try {
            if (typeof gameState.calculateDynamicSellingPrice === 'function') {
                price = gameState.calculateDynamicSellingPrice(pick.productId, pick.qualityGrade);
            }
        } catch (_) {}
        if (!(price > 0)) {
            const cost = gameState.getAverageCost(pick.productId, pick.qualityGrade) || product.basePrice || 10;
            price = Math.round(cost * 1.5 * 100) / 100;
        }
        try {
            if (typeof gameState.getCostMarkupPrice === 'function') {
                const markup = gameState.getCostMarkupPrice(pick.productId, pick.qualityGrade, 1.5);
                if (markup > price) price = markup;
            }
        } catch (_) {}
        try {
            if (typeof gameState.getMaxAllowedPrice === 'function') {
                const cap = gameState.getMaxAllowedPrice(pick.productId, pick.qualityGrade);
                if (cap > 0) price = Math.min(price, cap);
            }
        } catch (_) {}
        const now = gameState.state.gameTime;
        emp.currentTask = {
            type: 'listing',
            productId: pick.productId,
            qualityGrade: pick.qualityGrade,
            price,
            title: product.name,
            startTime: { day: now.day, hour: now.hour },
            duration: 1
        };
        return true;
    }

    _getUnlistedInventoryCandidates() {
        const inv = gameState.state.inventory || [];
        const listings = gameState.state.listings || [];
        const stockMap = {};
        for (let i = 0; i < inv.length; i++) {
            const it = inv[i];
            if (!it || !(it.quantity > 0) || !it.productId) continue;
            const g = it.qualityGrade || 'B';
            const k = it.productId + '|' + g;
            stockMap[k] = (stockMap[k] || 0) + it.quantity;
        }
        const out = [];
        Object.keys(stockMap).forEach(k => {
            const parts = k.split('|');
            const productId = parts[0];
            const qualityGrade = parts[1] || 'B';
            const listed = listings.some(l =>
                l && l.status === 'active' && !l.paused
                && l.productId === productId && (l.qualityGrade || 'B') === qualityGrade
            );
            if (!listed) out.push({ productId, qualityGrade, qty: stockMap[k] });
        });
        out.sort((a, b) => b.qty - a.qty);
        return out;
    }

    // 客服咨询小批量直接处理（无duration任务，直接完成）
    _handleConsultationBatch(emp, consultations, now) {
        const level = emp.level || 1;
        const qf = EMPLOYEE_LEVEL_CONFIG.qualityFactor(level);
        consultations.forEach(c => {
            c.status = 'replied';
            c.replyTime = { ...now };
            c.repliedBy = emp.id;
            c.replyQuality = level; // 记录回复等级，用于后续转化率修正
            // 高等级客服咨询转订单概率提升（简化：通过降低流失间接实现）
            c._conversionBoost = Math.max(1, 1.15 - qf * 0.15); // 1.0~1.10
        });
        const cc = consultations.length;
        gameState.addEmployeeStat(emp.id, 'consultation', cc);
        gameState.addEmployeeExp(emp.id, 'consultation',
            cc * (EMPLOYEE_LEVEL_CONFIG.expPerTask.consultation || 1));
        try { if (typeof gameState.addReplyCommission === 'function') gameState.addReplyCommission(emp, cc); } catch (_) {}
    }
    
    assignPackTask(emp, ordersOrOrder) {
        const orders = Array.isArray(ordersOrOrder) ? ordersOrOrder : [ordersOrOrder];
        const n = Math.max(1, orders.length);
        // 批量打包（提速×10：耗时÷10）——首单基准0.05小时，后续每单加0.012小时（极速流水线效应，加速积压消化）
        const baseDuration = (0.5 + 0.12 * (n - 1)) / 10;
        // 使用专业匹配效率（打包员做pack额外+80%）
        const efficiency = gameState.getEmployeeTaskEfficiency(emp, 'pack');
        const duration = Math.max(0.05, baseDuration / efficiency);

        emp.currentTask = {
            type: 'pack',
            orderId: orders[0].id,
            orderIds: orders.map(o => o.id),
            orderRefs: orders,
            count: n,
            startTime: { ...gameState.state.gameTime },
            duration: duration
        };
        orders.forEach(order => {
            order.beingPacked = true;
            order.beingPackedBy = emp.id;
        });
    }
    
    // 批量发货任务（极速版，提速×10：耗时÷10）
    assignShipTask(emp, ordersOrOrder) {
        const orders = Array.isArray(ordersOrOrder) ? ordersOrOrder : [ordersOrOrder];
        const n = Math.max(1, orders.length);
        // 批量发货：首单0.04小时，后续每单0.01小时（贴单+装车流水线，提速×10 加速积压消化）
        const baseDuration = (0.4 + 0.1 * (n - 1)) / 10;
        const efficiency = gameState.getEmployeeTaskEfficiency(emp, 'ship');
        const duration = Math.max(0.05, baseDuration / efficiency);
        
        emp.currentTask = {
            type: 'ship',
            orderId: orders[0].id,
            orderIds: orders.map(o => o.id),
            orderRefs: orders,
            count: n,
            startTime: { ...gameState.state.gameTime },
            duration: duration
        };
        orders.forEach(order => {
            order.beingShipped = true;
            order.beingShippedBy = emp.id;
        });
    }

    // 批量客服咨询任务（极速版）
    assignConsultationTask(emp, consultations) {
        const n = Math.max(1, consultations.length);
        // 批量处理咨询：首条0.12h，每条后续0.04h（快捷键+模板话术）
        const baseDuration = 0.12 + 0.04 * (n - 1);
        const efficiency = gameState.getEmployeeTaskEfficiency(emp, 'consultation');
        const duration = Math.max(0.05, baseDuration / efficiency);

        emp.currentTask = {
            type: 'consultation',
            consultationIds: consultations.map(c => c.id),
            count: n,
            startTime: { ...gameState.state.gameTime },
            duration: duration
        };
    }
    
    // 分配营销推广任务（每小时一次）
    assignMarketingTask(emp) {
        // ===== 推广任务专用效率归一化（关键修复：费用与订单成比例）=====
        // 原逻辑直接用 getEmployeeTaskEfficiency：该函数含「效率每级翻倍」，Lv10=512x，
        // 再乘以 specialtyBonus 1.8 和 店长督促 2x → 强度几万，营销费每小时几千/几万，远高于订单收入
        // 修复：推广任务效率用"归一化"——基础倍数 × 等级温和增长（Lv10 最大约 10x），不再指数爆炸
        const level = emp.level || 1;
        const typeInfo = EMPLOYEE_TYPES[emp.type];
        // 员工岗位本身的推广加成：推广员1.15 / 店长1.1（之前 1.8→1.3→1.15，继续温和）
        const jobBonus = (typeInfo?.specialtyBonus && typeInfo.specialtyBonus.marketing) || 1.0;
        // 店长的基础1.5倍效率保留
        const baseEff = typeInfo?.efficiency || 1.0;
        // 等级温和增长：Lv1=1.0, Lv3=1.6, Lv5=2.2, Lv7=2.8, Lv10=3.7（线性+35%/级）
        const levelGain = 1.0 + (level - 1) * 0.35;
        // 店长督促光环：推广专用从 2x 降到 1.2x（再降 0.05，防止双倍叠加强度）
        let mgrAura = 1.0;
        if (emp.type !== 'manager' && typeof gameState._hasActiveManager === 'function' && gameState._hasActiveManager()) {
            mgrAura = 1.2;
        }
        // 最终推广强度因子（代替 getEmployeeTaskEfficiency，归一化后强度可控）
        const marketingEfficiency = jobBonus * baseEff * levelGain * mgrAura;

        // 推广强度：基础 100，按效率 × 等级温和系数
        // Lv1推广员 ≈ 100×1.15×1.0×0.88 ≈ 101；Lv10推广员 ≈ 100×1.15×3.7×1.15 ≈ 490；Lv10店长 ≈ 100×1.1×1.5×3.7×1 ≈ 610
        const strength = Math.round(100 * marketingEfficiency * (0.85 + level * 0.03));
        // 推广媒体费提高：强度 × 8%~12%（另加广告公司服务费约 2%）
        // Lv1 ≈ 100×10%≈10 元媒体费 + ~2 元服务费；Lv10 ≈ 490×10%≈49 + ~9
        const costRatio = 0.08 + Math.random() * 0.04; // 8% ~ 12%
        const costBase = strength * costRatio;
        const cost = Math.max(5, Math.round(costBase * 100) / 100); // 最低5元媒体费
        // 预估含广告公司服务费后的总支出，资金不够则本小时不投流
        let agencyRate = 0.02;
        try {
            const cfg = gameState.getAdAgencyConfig && gameState.getAdAgencyConfig();
            if (cfg && cfg.mediaCommissionRate != null) agencyRate = cfg.mediaCommissionRate;
        } catch (_) {}
        const estTotal = Math.round(cost * (1 + agencyRate) * 100) / 100;
        const canPay = gameState.state.shop.funds >= estTotal;
        // 资金不足：降强度做免费弱推广（仍有曝光/极少订单），不再静默假装强推
        const actualCost = canPay ? cost : 0;
        const actualStrength = canPay ? strength : Math.max(20, Math.round(strength * 0.25));
        
        emp.currentTask = {
            type: 'marketing',
            startTime: { ...gameState.state.gameTime },
            duration: 1,
            strength: actualStrength,
            cost: actualCost,
            weakPromo: !canPay
        };
    }
    
    completeEmployeeTask(emp) {
        const task = emp.currentTask;
        if (!task) return;
        
        const now = gameState.state.gameTime;
        
        if (task.type === 'pack') {
            const orderIds = task.orderIds || (task.orderId ? [task.orderId] : []);
            const level = emp.level || 1;
            const qf = EMPLOYEE_LEVEL_CONFIG.qualityFactor(level);
            let packedCnt = 0;
            const refs = Array.isArray(task.orderRefs) ? task.orderRefs : null;
            const resolveOrder = (oid, idx) => {
                if (refs && refs[idx] && refs[idx].id === oid) return refs[idx];
                if (refs) {
                    for (let r = 0; r < refs.length; r++) if (refs[r] && refs[r].id === oid) return refs[r];
                }
                return gameState.state.orders.find(o => o.id === oid);
            };
            orderIds.forEach((oid, idx) => {
                const order = resolveOrder(oid, idx);
                if (!order) return;
                order.packed = true;
                order.packTime = { ...now };
                order.packedBy = emp.id;
                order.beingPacked = false;
                order.beingPackedBy = null;
                // 高等级打包员降低打包失误率（体现在后续差评率降低）
                order._packQuality = qf;
                // 新流程：打包完成 → 待发货（pending_shipment）
                if (order.status === 'pending_packing') {
                    gameState.updateOrderStatus(order.id, 'pending_shipment', order);
                }
                packedCnt++;
            });
            if (packedCnt > 0) {
                gameState.addEmployeeStat(emp.id, 'pack', packedCnt);
                gameState.addEmployeeExp(emp.id, 'pack',
                    packedCnt * (EMPLOYEE_LEVEL_CONFIG.expPerTask.pack || 1));
            }
        } else if (task.type === 'ship') {
            const orderIds = task.orderIds || (task.orderId ? [task.orderId] : []);
            const defaultExpress = gameState.getDefaultExpress();
            // 发货员类型偏好
            const typePrefExpress = EMPLOYEE_TYPES[emp.type]?.defaultExpress;
            const expressToUse = typePrefExpress || defaultExpress;
            let shippedCnt = 0;
            const refs = Array.isArray(task.orderRefs) ? task.orderRefs : null;
            const resolveOrder = (oid, idx) => {
                if (refs && refs[idx] && refs[idx].id === oid) return refs[idx];
                if (refs) {
                    for (let r = 0; r < refs.length; r++) if (refs[r] && refs[r].id === oid) return refs[r];
                }
                return gameState.state.orders.find(o => o.id === oid);
            };
            orderIds.forEach((oid, idx) => {
                const order = resolveOrder(oid, idx);
                if (!order) return;
                // 员工自动发货：现结直接扣款，避免批量弹窗挤爆付款队列
                const ok = this.shipOrder(order, expressToUse, emp.id, { confirmedPayment: true });
                order.beingShipped = false;
                order.beingShippedBy = null;
                if (ok) shippedCnt++;
            });
            if (shippedCnt > 0) {
                gameState.addEmployeeStat(emp.id, 'ship', shippedCnt);
                gameState.addEmployeeExp(emp.id, 'ship',
                    shippedCnt * (EMPLOYEE_LEVEL_CONFIG.expPerTask.ship || 1));
            }
        } else if (task.type === 'consultation') {
            const csIds = task.consultationIds || [];
            const level = emp.level || 1;
            const qf = EMPLOYEE_LEVEL_CONFIG.qualityFactor(level);
            let handled = 0;
            csIds.forEach(cid => {
                const c = (gameState.state.customerService.consultations || []).find(x => x.id === cid);
                if (!c || c.status !== 'pending') return;
                c.status = 'replied';
                c.replyTime = { ...now };
                c.repliedBy = emp.id;
                c.replyQuality = level;
                c._conversionBoost = Math.max(1, 1.15 - qf * 0.15);
                handled++;
            });
            if (handled > 0) {
                gameState.addEmployeeStat(emp.id, 'consultation', handled);
                gameState.addEmployeeExp(emp.id, 'consultation',
                    handled * (EMPLOYEE_LEVEL_CONFIG.expPerTask.consultation || 1));
                try { if (typeof gameState.addReplyCommission === 'function') gameState.addReplyCommission(emp, handled); } catch (_) {}
            }
        } else if (task.type === 'pricing') {
            this.completePricingTask(emp, task);
        } else if (task.type === 'marketing') {
            this.completeMarketingTask(emp, task);
        } else if (task.type === 'listing') {
            try {
                const productId = task.productId;
                const qualityGrade = task.qualityGrade || 'B';
                const qty = gameState.getInventoryQuantity(productId, qualityGrade);
                if (qty > 0 && productId) {
                    const exists = (gameState.state.listings || []).some(l =>
                        l && l.status === 'active' && l.productId === productId
                        && (l.qualityGrade || 'B') === qualityGrade
                    );
                    if (!exists) {
                        gameState.addListing({
                            productId,
                            qualityGrade,
                            title: task.title || productId,
                            price: task.price || 1,
                            status: 'active',
                            guarantee: '7day',
                            listedBy: emp.id,
                            autoListed: true
                        });
                        try {
                            if (typeof eventBus !== 'undefined' && eventBus.emit) {
                                eventBus.emit('toast:show', {
                                    message: `🏷️ ${emp.name} 已自动上架「${task.title || productId}」`,
                                    type: 'success'
                                });
                            }
                        } catch (_) {}
                    }
                    gameState.addEmployeeStat(emp.id, 'listing', 1);
                    gameState.addEmployeeExp(emp.id, 'listing',
                        (EMPLOYEE_LEVEL_CONFIG.expPerTask && EMPLOYEE_LEVEL_CONFIG.expPerTask.listing) || 2);
                }
            } catch (e) {
                console.warn('[completeEmployeeTask] listing', e);
            }
        }
        
        emp.currentTask = null;
    }
    
    // 营销推广任务完成：扣推广费，记录日志，给上架商品加曝光/产生订单
    completeMarketingTask(emp, task) {
        const now = gameState.state.gameTime;
        const strength = task.strength || 100;
        const cost = task.cost || 0;
        const level = emp.level || 1;
        
        // 先创建日志（保证后面订单打标记时log.id已存在）
        const log = {
            id: ('pr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
            employeeId: emp.id,
            employeeName: emp.name,
            employeeLevel: level,
            day: now.day,
            hour: now.hour,
            timestamp: Date.now(),
            cost: cost,
            strength: strength,
            exposureGiven: 0,
            generatedOrders: 0,
            orderIds: [],
            targets: []
        };
        
        // 扣费：媒体费 + 广告公司服务费（弱推广 cost=0 跳过）
        if (cost > 0) {
            const charged = (typeof gameState.chargeMarketingSpend === 'function')
                ? gameState.chargeMarketingSpend(cost, `推广员[${emp.name}]营销推广费(曝光强度${strength})`)
                : { ok: gameState.spendFunds(cost, `推广员[${emp.name}]营销推广费(曝光强度${strength})`), mediaCost: cost, agencyFee: 0, total: cost };
            log.mediaCost = charged.mediaCost != null ? charged.mediaCost : cost;
            log.agencyFee = charged.agencyFee || 0;
            log.cost = charged.ok ? (charged.total != null ? charged.total : cost) : 0;
            if (!charged.ok) {
                // 扣费失败降级为弱推广
                task.weakPromo = true;
            }
        }
        log.weakPromo = !!task.weakPromo;
        log.source = 'employee';
        
        // 只选在售、有货、未超限价的 listing
        const promoTargets = this._pickMarketableListings(4);
        
        log.targets = promoTargets.map(l => ({
            listingId: l.id,
            title: l.title,
            price: l.price,
            originalExposure: l.exposure || 0
        }));
        
        const weak = !!task.weakPromo;
        const exposurePerTarget = Math.round(strength * (weak ? 0.06 : 0.18) * (0.7 + Math.random() * 0.6));
        promoTargets.forEach(l => {
            l.exposure = (l.exposure || 0) + exposurePerTarget;
        });
        log.exposureGiven = exposurePerTarget * promoTargets.length;
        
        const conversionRate = weak ? (0.04 + level * 0.005) : (0.10 + level * 0.012);
        let generatedOrders = 0;
        const generatedOrderIds = [];
        // 推广员日单软顶（当日随机大量区间）；受全店硬顶约束
        let remainQuota = 0;
        try {
            remainQuota = (typeof gameState.getMarketerOrderRemainQuota === 'function')
                ? gameState.getMarketerOrderRemainQuota()
                : 0;
        } catch (_) { remainQuota = 0; }
        log.marketerQuotaRemain = remainQuota;
        try {
            log.marketerDailyCap = (typeof gameState.ensureMarketerDailyCap === 'function')
                ? gameState.ensureMarketerDailyCap() : null;
        } catch (_) {}
        if (promoTargets.length > 0 && remainQuota > 0) {
            // 随机爆单：推广时可突然带来大量订单
            // 正常推广：~35% 大爆、~30% 中爆、其余小单；弱推广仅小幅随机
            const roll = Math.random();
            let targetOrders = 0;
            let burstMode = 'normal';
            if (weak) {
                targetOrders = Math.min(remainQuota, 1 + Math.floor(Math.random() * 4));
                burstMode = 'weak';
            } else if (roll < 0.35) {
                // 大爆：拉走剩余配额的 45%~100%，至少 30 单
                const ratio = 0.45 + Math.random() * 0.55;
                targetOrders = Math.min(remainQuota, Math.max(30, Math.floor(remainQuota * ratio)));
                burstMode = 'big';
            } else if (roll < 0.65) {
                // 中爆：15~60 单（受配额限制）
                targetOrders = Math.min(remainQuota, 15 + Math.floor(Math.random() * 46));
                burstMode = 'mid';
            } else {
                // 常规：按强度出 3~18 单
                const baseExpected = (strength / 12) * conversionRate;
                const expected = baseExpected * (1.2 + Math.random() * 0.9);
                targetOrders = Math.min(
                    remainQuota,
                    Math.max(3, Math.floor(expected) + (Math.random() < 0.5 ? randomInt(2, 8) : 0))
                );
                burstMode = 'normal';
            }
            // 高等级推广员略抬下限
            if (!weak && level >= 5) {
                targetOrders = Math.min(remainQuota, Math.max(targetOrders, Math.min(12, remainQuota)));
            }
            // ===== 爆单保护：订单积压越多，单次推广出单越少（市场饱和），让在途积压自然回落 =====
            const _orderN = (gameState.state.orders || []).length;
            let saturation = 1;
            if (_orderN > 3500) saturation = 0.15;
            else if (_orderN > 2000) saturation = 0.3;
            else if (_orderN > 1200) saturation = 0.5;
            else if (_orderN > 800) saturation = 0.7;
            if (saturation < 1) {
                targetOrders = Math.max(weak ? 1 : 2, Math.floor(targetOrders * saturation));
            }
            log.burstMode = burstMode;
            log.targetOrders = targetOrders;

            const ordersBefore = gameState.state.orders.length;
            let guard = 0;
            while (generatedOrders < targetOrders && guard < 80) {
                guard++;
                const left = Math.min(remainQuota - generatedOrders, targetOrders - generatedOrders);
                if (left <= 0) break;
                const pick = promoTargets[Math.floor(Math.random() * promoTargets.length)];
                const listing = gameState.state.listings.find(l => l.id === pick.listingId) || pick;
                const product = listing ? PRODUCTS.find(p => p.id === listing.productId) : null;
                if (!listing || !product) continue;
                // 爆单时每批更大：大爆 4~12，中爆 2~6，常规 1~4
                let batchMax = 4;
                if (burstMode === 'big') batchMax = 12;
                else if (burstMode === 'mid') batchMax = 6;
                else if (burstMode === 'weak') batchMax = 2;
                let batchCount = Math.min(left, randomInt(1, batchMax));
                if (batchCount <= 0) break;
                const pm = 1 + level * 0.004 + Math.random() * 0.012;
                const cnt = this.generateOrders(listing, product, batchCount, pm, { source: 'promo' });
                if (!(cnt > 0)) break;
                generatedOrders += cnt;
            }
            
            // 给这次推广产生的所有订单打标记 & 收集ID（一次遍历）
            const ordersAfter = gameState.state.orders.length;
            for (let i = ordersBefore; i < ordersAfter; i++) {
                const o = gameState.state.orders[i];
                if (!o) continue;
                o.fromMarketing = true;
                o.marketingPromotionId = log.id;
                o.marketingEmployeeId = emp.id;
                o.marketingEmployeeName = emp.name;
                o.marketingCampaignSource = 'employee';
                o.marketingBurstMode = burstMode;
                // 清除因priceMultiplier导致的错误fromLivestream标记
                if (o.fromLivestream && !o._forceLivestream) {
                    o.fromLivestream = false;
                }
                generatedOrderIds.push(o.id);
            }
        } else if (promoTargets.length > 0 && remainQuota <= 0) {
            log.quotaBlocked = true;
        }
        log.generatedOrders = generatedOrders;
        log.orderIds = generatedOrderIds.slice(-20);
        try {
            if (!gameState.state.marketing) gameState.state.marketing = {};
            gameState.state.marketing._empPromoHourKey = 'D' + now.day + 'H' + now.hour;
        } catch (_) {}
        if (!gameState.state.marketing.promotionLogs) gameState.state.marketing.promotionLogs = [];
        gameState.state.marketing.promotionLogs.push(log);
        // 日志只保留最近 500 条
        if (gameState.state.marketing.promotionLogs.length > 500) {
            gameState.state.marketing.promotionLogs = gameState.state.marketing.promotionLogs.slice(-500);
        }
        
        gameState.addEmployeeStat(emp.id, 'marketing', 1);
        if (generatedOrders > 0) gameState.addEmployeeStat(emp.id, 'marketingOrders', generatedOrders);
        gameState.addEmployeeExp(emp.id, 'marketing', (EMPLOYEE_LEVEL_CONFIG.expPerTask.marketing || 2) + generatedOrders);
        try {
            if (typeof gameState.addPromoMonthStats === 'function') {
                gameState.addPromoMonthStats(emp, log.exposureGiven || 0, generatedOrders);
            }
        } catch (_) {}
    }

    assignPricingTask(emp) {
        if (!emp) return false;
        const listings = (gameState.state.listings || []).filter(l => l && l.status === 'active');
        if (!listings.length) return false;
        const now = gameState.state.gameTime;
        emp.currentTask = {
            type: 'pricing',
            startTime: { day: now.day, hour: now.hour },
            duration: 1
        };
        return true;
    }

    completePricingTask(emp, task) {
        let n = 0;
        let pct = 150;
        try {
            pct = (typeof gameState.getCostMarkupPct === 'function') ? gameState.getCostMarkupPct() : 150;
            n = (typeof gameState.applyCostMarkupToListings === 'function')
                ? gameState.applyCostMarkupToListings(pct / 100)
                : 0;
        } catch (_) {}
        if (n > 0) {
            try {
                if (typeof eventBus !== 'undefined' && eventBus.emit) {
                    eventBus.emit('toast:show', {
                        message: `💲 ${emp.name} 已按成本${pct}%调整 ${n} 件在架商品`,
                        type: 'success'
                    });
                }
            } catch (_) {}
        }
        try { gameState.addEmployeeStat(emp.id, 'pricing', 1); } catch (_) {}
        try { gameState.addEmployeeExp(emp.id, 'pricing', 2); } catch (_) {}
        try { if (n > 0 && typeof gameState.addPricingCommission === 'function') gameState.addPricingCommission(emp, n); } catch (_) {}
    }

    /** 可推广 listing：在售、未暂停、有库存、未超限价 */
    _pickMarketableListings(limit = 4) {
        const out = [];
        const listings = gameState.state.listings || [];
        for (let i = 0; i < listings.length; i++) {
            const l = listings[i];
            if (!l || l.paused) continue;
            if (l.status && l.status !== 'active') continue;
            try {
                const grade = l.qualityGrade || 'B';
                const qty = (typeof gameState.getSellableQuantity === 'function')
                    ? gameState.getSellableQuantity(l.productId, grade)
                    : (gameState.getInventoryQuantity
                        ? gameState.getInventoryQuantity(l.productId, grade)
                        : 0);
                if (!(qty > 0)) continue;
                // 已取消售价硬控，不再因参考上限跳过可推广商品
            } catch (_) { continue; }
            out.push(l);
        }
        out.sort((a, b) => (a.exposure || 0) - (b.exposure || 0));
        return out.slice(0, Math.max(1, limit));
    }

    /**
     * 店铺自动推广：本小时无员工完成营销时触发
     * 弱流量保底，避免「完全无效推广」
     */
    runShopAutoPromotion() {
        const now = gameState.state.gameTime;
        if (!now) return;
        const hourKey = 'D' + now.day + 'H' + now.hour;
        if (!gameState.state.marketing) gameState.state.marketing = {};
        const m = gameState.state.marketing;
        if (m._shopAutoHourKey === hourKey) return;
        if (m._empPromoHourKey === hourKey) return; // 本小时已有员工推广
        // 无付费推广时不跑店铺自动推广：当天仅保留自然单 4~20
        const hasPaidNow = ((m.activeCampaigns || []).some(c => c && c.status === 'active'))
            || ((m.celebrityEndorsements || []).some(e => e && e.status === 'active'));
        if (!hasPaidNow) {
            m._shopAutoHourKey = hourKey;
            return;
        }
        // 若有推广员/店长正在做营销任务，本小时留给员工完成
        const emps = gameState.state.employees || [];
        for (let i = 0; i < emps.length; i++) {
            const e = emps[i];
            if (e && e.status === 'active' && e.currentTask && e.currentTask.type === 'marketing') {
                return;
            }
        }
        const targets = this._pickMarketableListings(3);
        if (!targets.length) {
            m._shopAutoHourKey = hourKey;
            return;
        }
        const mediaCost = 8;
        let paid = { ok: false, mediaCost: 0, agencyFee: 0, total: 0 };
        if ((gameState.state.shop.funds || 0) >= mediaCost * 1.2) {
            paid = (typeof gameState.chargeMarketingSpend === 'function')
                ? gameState.chargeMarketingSpend(mediaCost, '店铺自动推广·媒体费')
                : { ok: gameState.spendFunds(mediaCost, '店铺自动推广·媒体费'), mediaCost, agencyFee: 0, total: mediaCost };
        }
        const weak = !paid.ok;
        const log = {
            id: ('sa' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)),
            employeeId: null,
            employeeName: '店铺自动推广',
            employeeLevel: 0,
            day: now.day,
            hour: now.hour,
            timestamp: Date.now(),
            cost: paid.ok ? (paid.total || mediaCost) : 0,
            mediaCost: paid.mediaCost || 0,
            agencyFee: paid.agencyFee || 0,
            strength: weak ? 30 : 60,
            exposureGiven: 0,
            generatedOrders: 0,
            orderIds: [],
            targets: targets.map(l => ({ listingId: l.id, title: l.title, price: l.price, originalExposure: l.exposure || 0 })),
            source: 'shop_auto',
            weakPromo: weak
        };
        const expEach = weak ? randomInt(3, 8) : randomInt(8, 18);
        targets.forEach(l => { l.exposure = (l.exposure || 0) + expEach; });
        log.exposureGiven = expEach * targets.length;
        const rounds = weak ? (Math.random() < 0.45 ? 1 : 0) : randomInt(1, 2);
        const ordersBefore = gameState.state.orders.length;
        // 能进到这里说明已有付费推广，走推广日配额（≤1000）
        for (let i = 0; i < rounds; i++) {
            const listing = targets[Math.floor(Math.random() * targets.length)];
            const product = PRODUCTS.find(p => p.id === listing.productId);
            if (!listing || !product) continue;
            this.generateOrders(listing, product, 1, 1, { source: 'promo' });
        }
        const ordersAfter = gameState.state.orders.length;
        for (let i = ordersBefore; i < ordersAfter; i++) {
            const o = gameState.state.orders[i];
            if (!o) continue;
            o.fromMarketing = true;
            o.marketingPromotionId = log.id;
            o.marketingCampaignSource = 'shop_auto';
            o.marketingEmployeeName = '店铺自动推广';
            if (o.fromLivestream && !o._forceLivestream) o.fromLivestream = false;
            log.orderIds.push(o.id);
            log.generatedOrders++;
        }
        if (!m.promotionLogs) m.promotionLogs = [];
        m.promotionLogs.push(log);
        if (m.promotionLogs.length > 500) m.promotionLogs = m.promotionLogs.slice(-500);
        m._shopAutoHourKey = hourKey;
    }

    // 发货操作
    shipOrder(order, expressType = 'standard', operatorId = null, shipOptions = {}) {
        if (order.status !== 'pending_shipment') return false;
        
        const product = PRODUCTS.find(p => p.id === order.productId);
        if (!product) return false;

        // 准备订单的城市信息
        const warehouseCity = gameState.getWarehouseCity?.() || gameState.state.warehouse?.city || 'yiwu';
        order.fromCity = (typeof resolveShipFromCity === 'function')
            ? resolveShipFromCity(product, warehouseCity)
            : ((product && product.originCity) || warehouseCity);
        if (!order.buyerCity) order.buyerCity = order.buyerCityId || 'shanghai';
        if (!order.weightKg) order.weightKg = (product.baseWeight * order.quantity) / 1000 + 0.1;

        // ===== 先消耗包装材料（失败则不创建运单，避免孤儿运单/快递费白扣）=====
        const orderForPackaging = (order.items && order.items.length)
            ? order
            : {
                ...order,
                items: [{ productId: order.productId, productName: order.productName, quantity: order.quantity }]
            };
        let pkgLevel = 'standard';
        try {
            if (order.totalAmount >= 800) pkgLevel = 'premium';
            else if (order.totalAmount <= 30) pkgLevel = 'eco';
            if (product && /环保|再生|绿色|有机|竹|原木|棉麻/.test(product.name || '')) pkgLevel = 'eco';
        } catch (e) {}
        let smartResult = null;
        if (typeof gameState.consumePackagingMaterialsSmart === 'function') {
            try {
                smartResult = gameState.consumePackagingMaterialsSmart(orderForPackaging, pkgLevel);
            } catch (e) {
                console.warn('智能打包消耗失败，回退旧算法', e);
            }
        }
        // 包装紧急采购付不起 → 中止发货，避免无包装出库
        if (smartResult && smartResult.success === false) {
            console.warn('[shipOrder] 包装失败，取消发货:', smartResult.message);
            eventBus.emit('toast:show', { message: smartResult.message || '包装失败，无法发货', type: 'error' });
            return false;
        }

        // ===== 使用新快递系统创建运单 =====
        if (typeof ExpressEngine !== 'undefined') {
            const companyId = order.expressCompanyId || ExpressState.defaultCompany;
            const serviceId = order.expressServiceId || expressTypeToService(expressType);
            const shipResult = ExpressEngine.shipOrder(order, companyId, serviceId, gameState.state.gameTime, shipOptions || {});
            if (shipResult.success) {
                order.waybillId = shipResult.waybillId;
                order.trackingNo = shipResult.trackingNo;
                order.expressCompanyId = companyId;
                order.expressServiceId = serviceId;
                // 运单的运输方式以快递引擎实际结算为准（尊重公司 allowedModes / 合作页手动设置）
                order.shipping_method = shipResult.shippingMethod
                    || ((typeof ExpressState !== 'undefined' && ExpressState.resolveCompanyShippingMethod)
                        ? ExpressState.resolveCompanyShippingMethod(companyId, order)
                        : 'land');
                order.shippingMethod = order.shipping_method;
                order.deliveryStatus = 'shipped';
                order.expressFee = shipResult.fee;
                order.fees = this.calculateAllFees(order, product, expressType);
                // 仅「现结且已扣款」计入已付；周结/月结快递费走账单，发货时不计入已付总额
                const expressCash = (shipResult.immediatePay && shipResult.feePaid) ? shipResult.fee : 0;
                order.fees.expressFee = shipResult.fee;
                order.fees.expressPaid = expressCash;
                order.fees.expressPending = Math.max(0, (shipResult.fee || 0) - expressCash);
                order.fees.total = order.fees.packFee + order.fees.packagingMaterialFee + expressCash;
                order.expressType = serviceId;
                order._shipResult = shipResult;
            } else {
                console.warn('[shipOrder] ExpressEngine failed:', shipResult.message);
                eventBus.emit('toast:show', { message: shipResult.message, type: 'error' });
                return false;
            }
        } else {
            // ===== 旧版兼容 =====
            const express = EXPRESS_OPTIONS[expressType] || EXPRESS_OPTIONS.standard;
            order.expressType = expressType;
            const fees = this.calculateAllFees(order, product, expressType);
            fees.total = fees.packFee + fees.packagingMaterialFee + fees.expressFee;
            order.fees = fees;
            // 旧版兼容快递费：先记账，确认弹窗后再扣（见下方 payment:request）
            if (fees.expressFee > 0 && shipOptions && shipOptions.confirmedPayment) {
                if (!gameState.spendFunds(fees.expressFee, `快递费用 - ${express.name}`)) {
                    eventBus.emit('toast:show', { message: '资金不足，无法支付快递费', type: 'error' });
                    return false;
                }
            }
            order.logistics = {
                status: 'shipped',
                trackingNumber: this.generateTrackingNumber(),
                company: randomChoice(express.companies || ['快递']),
                updates: [{
                    status: '已揽收',
                    time: formatDate(gameState.state.gameTime.day, gameState.state.gameTime.hour),
                    location: '快件已被揽收'
                }]
            };
        }

        let usedCarton = 0, usedBubbleWrap = 0;
        // ===== 关键修复：已有库存的包装材料，绝对不能再次扣钱（玩家买包装材料入库已经花过钱了！）=====
        // - smartResult.packagingFee：只是【统计单均成本】用的"已入库材料成本价"，现金流 NOT 扣
        // - smartResult.autoBuyCost：已经在 consumePackagingMaterialsSmart 内部 spendFunds 扣过了，这里 NOT 再扣
        // - 只有【旧版兼容】(无 PACKAGING_CONFIG 新系统) 分支下，才用 calculatePackagingMaterialFee 临时采购扣费
        let _legacyPackagingFeePending = 0;
        if (smartResult && smartResult.success) {
            order.materialsUsed = { ...(smartResult.consumed || {}), _level: smartResult.packagingLevel, _cartonId: smartResult.cartonId };
            const autoBuy = Number(smartResult.autoBuyCost) || 0;
            // autoBuyCost 已经在 consumePackagingMaterialsSmart 内部 spendFunds 扣过了；这里仅加到 fees.total 用于订单成本展示（不重复扣现金流）
            if (order.fees) {
                order.fees.autoBuyCost = autoBuy;
                if (autoBuy > 0) order.fees.total = (order.fees.total || 0) + autoBuy;
            }
            // 【修复核心】：smartResult.packagingFee 是"已用材料成本"纯统计值（玩家已经花钱入库），绝对不能再作为临时采购费现金流扣
            // 所以不把它赋给 order.fees.packagingMaterialFee（后者会在 1975 行被 spendFunds）
            // 如果包装材料统计需要显示，存在 materialsUsed._statsPackagingFee / fees.packagingCost（仅展示不扣钱）
            if (typeof smartResult.packagingFee === 'number' && smartResult.packagingFee >= 0) {
                order.materialsUsed._statsPackagingFee = smartResult.packagingFee;
                // 费用总额仅用于订单成本结构展示（不扣现金流），packagingMaterialFee 字段保持 0（不触发 1975 行扣费）
                if (order.fees) {
                    order.fees.packagingCost = smartResult.packagingFee; // 耗用材料成本（经营核算）
                    order.fees.packagingMaterialFee = 0; // 已入库材料 = 零额外支出
                    // 已付快递费用 expressPaid，避免把账期待付快递费算进“已付总额”
                    const expressPaid = (typeof order.fees.expressPaid === 'number')
                        ? order.fees.expressPaid
                        : 0;
                    order.fees.total = order.fees.packFee + order.fees.packagingMaterialFee + expressPaid + autoBuy;
                }
            }
            usedCarton = (smartResult.consumed || {}).carton || 0;
            usedBubbleWrap = (smartResult.consumed || {}).bubbleWrap || 0;
        } else if (typeof PACKAGING_CONFIG !== 'undefined') {
            const cartonNeeded = PACKAGING_MATERIALS?.carton?.consumption?.base || 1;
            let bubbleWrapNeeded = 1 + order.quantity * 0.3;
            const isFragile = PACKAGING_CONFIG.fragileCategories?.includes(product.category);
            if (isFragile) bubbleWrapNeeded *= 2;
            order.materialsUsed = { carton: usedCarton, bubbleWrap: usedBubbleWrap, _level: 'legacy' };
            // 旧版兼容：仅在走 calculatePackagingMaterialFee 返回 >0（真的库存不足临时采购）时才标记待扣
            if (order.fees) _legacyPackagingFeePending = order.fees.packagingMaterialFee || 0;
        }
        
        gameState.updateOrderStatus(order.id, 'shipped', order);
        order.shipTime = { ...gameState.state.gameTime };
        order.shippedBy = operatorId;
        order.shipped = true;
        
        if (order.fees) {
            if (order.fees.packFee > 0) {
                gameState.spendFunds(order.fees.packFee, '打包人工费');
            }
            // 【修复核心】：只有【旧版兼容】(无新包装系统) 时才扣 packagingMaterialFee 作为临时采购
            // 新包装系统下：已有库存=玩家已花钱入库，不重复扣；紧急采购=autoBuyCost 已在 consumePackagingMaterialsSmart 内部 spendFunds 过
            if (_legacyPackagingFeePending > 0) {
                gameState.spendFunds(_legacyPackagingFeePending, '包装材料费（临时采购）');
            }
            // 快递费：新系统走账单/确认弹窗；旧系统未当场确认时发付款请求
            if (typeof ExpressEngine === 'undefined' && order.fees.expressFee > 0 && !(shipOptions && shipOptions.confirmedPayment)) {
                const feeAmt = order.fees.expressFee;
                if (typeof eventBus !== 'undefined') {
                    eventBus.emit('payment:request', {
                        id: 'legacy-express-' + order.id,
                        category: 'express',
                        noCancel: true,
                        title: '确认支付快递费',
                        amount: feeAmt,
                        detail: `快递费用 · 订单 ${(order.id || '').toString().slice(-6)}`,
                        execute: () => gameState.spendFunds(feeAmt, '快递费用')
                    });
                } else {
                    gameState.spendFunds(feeAmt, '快递费用');
                }
            }
        }

        // 合作积分增加
        if (typeof ExpressEngine !== 'undefined' && order.expressCompanyId) {
            ExpressState.addCooperationPoints(order.expressCompanyId, 1);
            ExpressEngine.checkUnlocks();
        }
        
        return true;
    }

    // 生成物流单号
    generateTrackingNumber() {
        const prefix = randomChoice(['SF', 'YT', 'ZT', 'YD', 'JD']);
        const nums = randomInt(1000000000, 9999999999).toString();
        return prefix + nums;
    }

    initiateReturn(order) {
        gameState.addReturn({
            orderId: order.id,
            productName: order.productName,
            buyerName: order.buyerName,
            reason: randomChoice(['质量问题', '货不对板', '不想要了', '尺寸不合适']),
            amount: order.totalAmount
        });
        gameState.updateOrderStatus(order.id, 'returning');
    }

    processPendingEvents() {
        gameState.state.customerService.consultations.forEach(c => {
            if (c.status === 'pending') {
                c.waitTime = (c.waitTime || 0) + 1;
                if (c.waitTime > 6) {
                    c.status = 'missed';
                    gameState.addReputation(-1);
                }
            }
        });
    }

    onTick(callback) {
        this.tickCallbacks.push(callback);
        return () => {
            this.tickCallbacks = this.tickCallbacks.filter(cb => cb !== callback);
        };
    }

    // 成就检测
    checkAchievements() {
        const state = gameState.state;
        const stats = state.statistics;
        
        const completedOrders = state.orders.filter(o => o.status === 'completed');
        const totalSalesAmount = completedOrders.reduce((sum, o) => sum + o.totalAmount, 0);
        
        const goodReviews = completedOrders.filter(o => o.review && o.review.rating >= 4).length;
        const badReviews = completedOrders.filter(o => o.review && o.review.rating <= 2).length;
        
        const activeListings = state.listings.filter(l => l.status === 'active').length;
        const employees = state.employees.filter(e => e.status === 'active').length;
        
        const aGradeOrders = completedOrders.filter(o => o.qualityGrade === 'A').length;
        const cGradeOrders = completedOrders.filter(o => o.qualityGrade === 'C').length;
        
        // ===== 累计统计（订单裁剪后成就进度不回退）：与扫描值取较大者 =====
        const cum = stats && stats._cum;
        const cumCompleted = cum ? (cum.completedOrders || 0) : 0;
        const cumSales = cum ? (cum.completedSales || 0) : 0;
        const cumGood = cum ? (cum.goodReviews || 0) : 0;
        const cumBad = cum ? (cum.badReviews || 0) : 0;
        const cumA = cum ? (cum.aGrade || 0) : 0;
        const cumC = cum ? (cum.cGrade || 0) : 0;
        
        stats.totalProfit = Math.max(totalSalesAmount, cumSales) - this.calculateTotalCost();
        stats.goodReviews = Math.max(goodReviews, cumGood);
        stats.badReviews = Math.max(badReviews, cumBad);
        stats.aGradeOrders = Math.max(aGradeOrders, cumA);
        stats.cGradeOrders = Math.max(cGradeOrders, cumC);
        
        const checks = {
            totalOrders: Math.max(completedOrders.length, cumCompleted),
            totalSales: Math.max(totalSalesAmount, cumSales),
            totalProfit: stats.totalProfit,
            goodReviews: Math.max(goodReviews, cumGood),
            badReviews: Math.max(badReviews, cumBad),
            reputation: state.shop.rating,
            activeListings: activeListings,
            employees: employees,
            shopLevel: state.shop.level,
            days: state.gameTime.day,
            aGradeOrders: Math.max(aGradeOrders, cumA),
            cGradeOrders: Math.max(cGradeOrders, cumC),
            nightOrder: stats.nightOrders || 0,
            earlyOrder: stats.earlyOrders || 0
        };
        
        ACHIEVEMENTS.forEach(achievement => {
            if (gameState.isAchievementUnlocked(achievement.id)) return;
            
            const condition = achievement.condition;
            const currentValue = checks[condition.type];
            
            if (currentValue !== undefined && currentValue >= condition.value) {
                gameState.unlockAchievement(achievement.id);
                this.showAchievementToast(achievement);
            }
        });
    }

    calculateTotalCost() {
        let total = 0;
        gameState.state.finance.records.forEach(r => {
            if (r.type === 'expense') {
                total += r.amount;
            }
        });
        return total;
    }

    showAchievementToast(achievement) {
        try {
            if (typeof document === 'undefined' || !document.body || !document.createElement) return;
            const toast = document.createElement('div');
            toast.className = 'achievement-toast';
            toast.innerHTML = `
                <div class="achievement-icon">${achievement.icon || '🏆'}</div>
                <div class="achievement-info">
                    <div class="achievement-title">成就解锁！</div>
                    <div class="achievement-name">${achievement.name || ''}</div>
                    <div class="achievement-desc">${achievement.description || ''}</div>
                </div>
            `;
            toast.style.cssText = `
                position: fixed;
                top: 80px;
                right: 20px;
                background: linear-gradient(135deg, #ff9800, #f57c00);
                color: white;
                padding: 15px 20px;
                border-radius: 12px;
                box-shadow: 0 4px 20px rgba(255, 152, 0, 0.4);
                z-index: 9999;
                display: flex;
                align-items: center;
                gap: 12px;
                animation: slideIn 0.3s ease;
                max-width: 300px;
            `;
            if (document.head) {
                const style = document.createElement('style');
                style.textContent = `
                    @keyframes slideIn {
                        from { transform: translateX(100%); opacity: 0; }
                        to { transform: translateX(0); opacity: 1; }
                    }
                    @keyframes slideOut {
                        from { transform: translateX(0); opacity: 1; }
                        to { transform: translateX(100%); opacity: 0; }
                    }
                    .achievement-icon { font-size: 36px; }
                    .achievement-title { font-size: 12px; opacity: 0.9; }
                    .achievement-name { font-size: 16px; font-weight: bold; margin: 2px 0; }
                    .achievement-desc { font-size: 12px; opacity: 0.85; }
                `;
                document.head.appendChild(style);
            }
            document.body.appendChild(toast);
            setTimeout(() => {
                try {
                    toast.style.animation = 'slideOut 0.3s ease forwards';
                    setTimeout(() => { try { toast.remove(); } catch (_) {} }, 300);
                } catch (_) {}
            }, 3000);
        } catch (e) {
            console.warn('[showAchievementToast] 跳过展示:', e && e.message);
        }
    }

    // 随机事件系统
    checkRandomEvents() {
        try {
        const state = gameState.state;
        const time = state.gameTime;
        
        if (time.hour !== 9) return;
        if (state.events.lastEventDay === time.day) return;
        
        // 每天最多触发 1 个随机事件（旧版 forEach 设了 lastEventDay 仍继续滚动，会同一天叠多个事件）
        for (const event of RANDOM_EVENTS) {
            if (time.day < (event.minDay || 1)) continue;
            
            if (event.triggerDay && time.day !== event.triggerDay) continue;
            // 每月几号触发（发薪日等），用真实同步的 monthDay
            if (event.triggerDayOfMonth && (time.monthDay || (((time.day - 1) % 30) + 1)) !== event.triggerDayOfMonth) continue;
            if (event.triggerDayOfWeek && time.dayOfWeek !== event.triggerDayOfWeek) continue;
            
            let chance = Number(event.probability) || 0;
            try {
                const luck = (typeof gameState.getPlayerAttrLevel === 'function')
                    ? gameState.getPlayerAttrLevel('luck') : 1;
                if (event.type === 'good') chance *= (1 + Math.max(0, luck - 1) * 0.06);
                else if (event.type === 'bad') chance *= Math.max(0.4, 1 - Math.max(0, luck - 1) * 0.05);
                // 天赋「天选之子」：好事概率翻倍
                const geb = (typeof gameState.getTalentBonus === 'function') ? (gameState.getTalentBonus('goodEventBonus') || 0) : 0;
                if (event.type === 'good' && geb > 0) chance *= (1 + geb);
            } catch (_) {}
            if (Math.random() < chance) {
                state.events.lastEventDay = time.day;
                // ===== 危机应对（深化）：带 crisis 配置的事件弹出决策，而非直接触发 =====
                if (event.crisis && typeof ui !== 'undefined' && ui && typeof ui.showCrisisModal === 'function') {
                    ui.showCrisisModal(event.id);
                    break;
                }
                gameState.triggerEvent(event);

                // ===== 修改2b：货源断供事件根据 settings.notifyLevel 分级处理 =====
                try {
                    const isSupply = event?.id === 'supply_shortage' || (event?.effect?.type === 'supply_shortage');
                    if (isSupply) {
                        const notify = state?.settings?.supplyOutageNotifyLevel || 'all';
                        if (notify === 'none') {
                            // 完全静默：只写日志，不弹窗
                            console.log('[SupplyOutage] 静默模式：货源断供事件已记录，不弹窗。event=', event.id);
                            break;
                        } else if (notify === 'digest') {
                            // 每日汇总：累计到 digest，不立即弹窗
                            const digest = state._supplyOutageDigest || (state._supplyOutageDigest = { day: 0, count: 0, lastNames: [] });
                            const curDay = time.day || 1;
                            if (digest.day !== curDay) {
                                digest.day = curDay;
                                digest.count = 0;
                                digest.lastNames = [];
                            }
                            digest.count++;
                            if (Array.isArray(digest.lastNames)) {
                                digest.lastNames.push(event.name || '断供');
                                if (digest.lastNames.length > 10) digest.lastNames = digest.lastNames.slice(-10);
                            }
                            console.log('[SupplyOutage] 每日汇总模式：累计到今日 digest。count=', digest.count);
                            break;
                        }
                    }
                } catch (_notifyErr) {
                    console.warn('[checkRandomEvents] supply notify level err:', _notifyErr);
                }
                // 非断供事件 或 断供(all模式)：保持原样立即弹窗
                this.showEventToast(event);
                break; // 每天最多 1 个事件
            }
        }
        } catch (_e) {
            console.error('[checkRandomEvents] 出错:', _e);
        }
    }

    showEventToast(event) {
        try {
            if (typeof document === 'undefined' || !document.body || !document.createElement) return;
            const colors = {
                good: 'linear-gradient(135deg, #4caf50, #388e3c)',
                bad: 'linear-gradient(135deg, #f44336, #d32f2f)',
                neutral: 'linear-gradient(135deg, #2196f3, #1976d2)'
            };
            const msg = (event && event.effect && event.effect.message) ? event.effect.message : '';
            const toast = document.createElement('div');
            toast.className = 'event-toast';
            toast.innerHTML = `
                <div class="event-icon">${(event && event.icon) || '📢'}</div>
                <div class="event-info">
                    <div class="event-name">${(event && event.name) || '事件'}</div>
                    <div class="event-desc">${msg}</div>
                </div>
            `;
            toast.style.cssText = `
                position: fixed;
                top: 80px;
                left: 50%;
                transform: translateX(-50%);
                background: ${colors[(event && event.type)] || colors.neutral};
                color: white;
                padding: 15px 25px;
                border-radius: 12px;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
                z-index: 9999;
                display: flex;
                align-items: center;
                gap: 12px;
                animation: eventDrop 0.4s ease;
                max-width: 400px;
            `;
            if (document.head) {
                const style = document.createElement('style');
                style.textContent = `
                    @keyframes eventDrop {
                        from { transform: translateX(-50%) translateY(-100px); opacity: 0; }
                        to { transform: translateX(-50%) translateY(0); opacity: 1; }
                    }
                    @keyframes eventFadeOut {
                        from { opacity: 1; }
                        to { opacity: 0; }
                    }
                    .event-icon { font-size: 32px; }
                    .event-name { font-size: 16px; font-weight: bold; margin-bottom: 4px; }
                    .event-desc { font-size: 13px; opacity: 0.9; }
                `;
                document.head.appendChild(style);
            }
            document.body.appendChild(toast);
            setTimeout(() => {
                try {
                    toast.style.animation = 'eventFadeOut 0.3s ease forwards';
                    setTimeout(() => { try { toast.remove(); } catch (_) {} }, 300);
                } catch (_) {}
            }, 4000);
        } catch (e) {
            console.warn('[showEventToast] 跳过展示:', e && e.message);
        }
    }

    // 处理持续事件的倒计时
    processActiveEvents() {
        const activeEvents = gameState.state.events.activeEvents;
        const time = gameState.state.gameTime;
        
        for (let i = activeEvents.length - 1; i >= 0; i--) {
            const event = activeEvents[i];
            if (event.remainingDuration > 0) {
                event.remainingDuration--;
                if (event.remainingDuration <= 0) {
                    activeEvents.splice(i, 1);
                }
            }
        }
    }

    // 会员成长值和积分已在gameState.updateMemberSpending中统一处理
    // 旧的processMemberOrder已废弃，所有会员更新通过updateMemberSpending统一入口

    // 仓储容量计算
    calculateUsedCapacity() {
        let total = 0;
        gameState.state.inventory.forEach(item => {
            const product = PRODUCTS.find(p => p.id === item.productId);
            if (product) {
                total += item.quantity;
            }
        });
        gameState.state.warehouse.usedCapacity = total;
        return total;
    }

    checkWarehouseCapacity() {
        // 与仓储模块/升级后容量对齐，禁止再用可能过期的 warehouse.level + 旧表
        try {
            if (typeof gameState.getUsedCapacity === 'function' && typeof gameState.getWarehouseCapacity === 'function') {
                return gameState.getUsedCapacity() >= gameState.getWarehouseCapacity();
            }
        } catch (_) {}
        const used = this.calculateUsedCapacity();
        const level = (typeof gameState.getWarehouseLevel === 'function')
            ? gameState.getWarehouseLevel()
            : (gameState.state.warehouse?.level || 1);
        const warehouseLevel = WAREHOUSE_LEVELS.find(w => w.level === level) || WAREHOUSE_LEVELS[0];
        return used >= warehouseLevel.capacity;
    }

    // 银行每日结算
    processBankDaily() {
        // 通过事件总线触发银行模块每日结算
        // 银行模块内部会处理：利息计算、定期到期、自动扣款、逾期罚息等
        eventBus.emit('game:dailyTick', {
            day: gameState.state.gameTime.day,
            hour: gameState.state.gameTime.hour
        });
    }

    // 促销活动处理
    processPromotions() {
        gameState._updateActivePromotions();
    }

    getPromotionPrice(listing) {
        const activePromotions = gameState.getActivePromotions() || [];
        let finalPrice = listing.price;
        const product = PRODUCTS.find(p => p.id === listing.productId);
        
        for (const promo of activePromotions) {
            if (promo.type === 'flash_sale') {
                const productIds = Array.isArray(promo.productIds) ? promo.productIds : [];
                const categoryIds = Array.isArray(promo.categoryIds) ? promo.categoryIds : [];
                const isEligible = promo.scope === 'all' ||
                    (promo.scope === 'product' && productIds.includes(listing.productId)) ||
                    (promo.scope === 'category' && product && categoryIds.includes(product.category));
                if (isEligible && promo.rules && typeof promo.rules.discountRate === 'number') {
                    finalPrice = listing.price * promo.rules.discountRate;
                }
            }
        }
        
        return parseFloat(finalPrice.toFixed(2));
    }

    // 直播系统逻辑（P0：热度驱动出单 + 活跃粉丝窗口自动带单 + 防幽灵直播）
    processLivestream() {
        const livestream = gameState.state.livestream;
        if (!livestream) return;

        // ===== 1. 防幽灵直播：现实超时强制结算（页面关闭/离开后不无限挂机）=====
        if (livestream.isLive && livestream.startTimeReal) {
            try {
                const elapsedMin = (Date.now() - livestream.startTimeReal) / 60000;
                const planned = livestream.plannedDuration || 6;
                if (elapsedMin > planned + 5) {
                    if (typeof liveEngine !== 'undefined' && liveEngine && typeof liveEngine.endLive === 'function') {
                        liveEngine.endLive();
                    } else {
                        gameState.endLivestream();
                    }
                    return;
                }
            } catch (_) {}
        }

        // ===== 2. 职责分离：直播中走热度出单；非直播走活跃粉丝自动带单 =====
        if (!livestream.isLive) {
            try { this.processActiveFans(); } catch (_e) {}
            return;
        }

        // ===== 3. 直播带货：先看讲解，少数人再下单（按现实秒，不跟店铺自然单同一套）=====
        this._processLiveWatchSales(livestream);
        gameState.notify();
    }

    _processLiveWatchSales(livestream) {
        const nowMs = Date.now();
        const gapSec = 14;
        if (livestream._lastWatchSaleAt && (nowMs - livestream._lastWatchSaleAt) < gapSec * 1000) return;
        livestream._lastWatchSaleAt = nowMs;

        let currentViewers = Math.max(0, livestream.viewers || 0);
        if (currentViewers <= 0) {
            const cfg0 = (typeof LIVE_CONFIG !== 'undefined') ? LIVE_CONFIG : {};
            currentViewers = cfg0.baseInitialViewers != null ? cfg0.baseInitialViewers : 100;
        }

        const allActive = (gameState.state.listings || []).filter(l => l.status === 'active');
        let shelfIds = (livestream.productIds && livestream.productIds.length)
            ? livestream.productIds.slice()
            : allActive.map(l => l.productId).slice(0, 10);
        if (!shelfIds.length) return;

        const featuredIdx = Math.max(0, livestream.currentProductIndex || 0) % shelfIds.length;
        const pickId = (Math.random() < 0.82)
            ? shelfIds[featuredIdx]
            : shelfIds[Math.floor(Math.random() * shelfIds.length)];
        const listing = allActive.find(l => l.productId === pickId);
        const product = listing && PRODUCTS ? PRODUCTS.find(p => p.id === listing.productId) : null;
        if (!listing || !product) return;

        const cfg = (typeof LIVE_CONFIG !== 'undefined') ? LIVE_CONFIG : {};
        const heat = (typeof livestream.heat === 'number') ? livestream.heat : 30;
        const heatFactor = 0.5 + heat / 100;
        let sceneFactor = 1;
        try {
            const scene = (typeof liveState !== 'undefined' && liveState.getCurrentScene)
                ? liveState.getCurrentScene() : null;
            if (scene && scene.conversionBonus) sceneFactor = scene.conversionBonus;
        } catch (_) {}
        let topicFactor = 1;
        if (livestream.topic && livestream.topic.profile && livestream.topic.profile[product.category]) {
            topicFactor = livestream.topic.profile[product.category];
        }
        const psSalesMult = (livestream.priceStrategy === 'margin') ? 0.55 : 1.15;
        const discountMultiplier = livestream.settings?.showDiscount ? (livestream.settings.discountRate || 0.9) : 1;

        let boomMultiplier = 1;
        if (livestream.boom && livestream.boom.productId === listing.productId) {
            const now = gameState.state.gameTime;
            const bExpired = livestream.boom.expiresDay && now && (
                now.day > livestream.boom.expiresDay ||
                (now.day === livestream.boom.expiresDay && now.hour >= livestream.boom.expiresHour)
            );
            if (bExpired) {
                livestream.boom = null;
            } else {
                const bMult = cfg.liveBoomMultiplier != null ? cfg.liveBoomMultiplier : 3;
                const bShrink = cfg.liveBoomShrink != null ? cfg.liveBoomShrink : 0.5;
                boomMultiplier = livestream.boom.restocked ? bMult : Math.max(1, bMult * bShrink);
            }
        }

        // 绝大多数人只看不买：每 14 秒约 0.12%~0.4% 观众对「正在讲解」的货产生订单
        const watchBuyRate = 0.0018 * heatFactor * sceneFactor * topicFactor * psSalesMult;
        const expected = currentViewers * watchBuyRate * boomMultiplier;
        let n = Math.floor(expected);
        if (Math.random() < (expected - n)) n++;
        n = Math.min(3, n);

        if (n <= 0) {
            if (Math.random() < 0.35 && typeof liveState !== 'undefined' && liveState.addDanmaku) {
                const names = (typeof MOCK_VIEWER_NAMES !== 'undefined') ? MOCK_VIEWER_NAMES : ['路过的宝宝'];
                const who = names[Math.floor(Math.random() * names.length)];
                liveState.addDanmaku({
                    type: 'normal',
                    userName: who,
                    content: Math.random() < 0.5 ? `先看看 ${product.name}` : `${product.name} 怎么样啊`,
                    color: '#90caf9'
                });
            }
            return;
        }

        const inventory = (typeof gameState.getSellableQuantity === 'function')
            ? gameState.getSellableQuantity(listing.productId, listing.qualityGrade || 'B')
            : gameState.getInventoryQuantity(listing.productId);
        if (!(inventory > 0)) return;

        const orderCount = this.generateOrders(listing, product, n, discountMultiplier, { source: 'live' });
        if (orderCount > 0) {
            const saleAmount = listing.price * orderCount * discountMultiplier;
            gameState.addLivestreamSale(saleAmount);
            if (typeof liveState !== 'undefined' && liveState.addDanmaku) {
                liveState.addDanmaku({
                    type: 'system',
                    userName: '系统',
                    content: `🛒 有人下单了 ${product.name} ×${orderCount}`,
                    color: '#ff6b35'
                });
            }
        }
    }

    // 活跃粉丝窗口：直播结束后 N 游戏小时内持续自动带单（非直播时段）
    processActiveFans() {
        const livestream = gameState.state.livestream;
        if (!livestream || !livestream.activeFans) return;
        const af = livestream.activeFans;
        if (!(af.count > 0)) return;
        const now = gameState.state.gameTime;
        if (!now) return;

        // 窗口过期：游戏时间超过 expireDay/expireHour → 清窗
        const expired = (now.day > af.expireDay) || (now.day === af.expireDay && now.hour >= af.expireHour);
        if (expired) {
            af.count = 0;
            af.dayOrdersUsed = 0;
            return;
        }

        // 每日自动单配额跨日重置
        if (af.lastOrderDay !== now.day) {
            af.dayOrdersUsed = 0;
            af.lastOrderDay = now.day;
        }
        if (!(af.dayOrdersMax > 0)) {
            const cfg0 = (typeof LIVE_CONFIG !== 'undefined') ? LIVE_CONFIG : {};
            af.dayOrdersMax = Math.min(Math.floor(af.count * (cfg0.activeFanDailyOrderMaxRatio != null ? cfg0.activeFanDailyOrderMaxRatio : 0.15)), cfg0.activeFanDailyOrderMaxCap != null ? cfg0.activeFanDailyOrderMaxCap : 300);
        }
        if (af.dayOrdersUsed >= af.dayOrdersMax) return;

        // 营业时段才产生自然单
        if (now.hour < 8 || now.hour > 22) return;

        // 距上次检查的游戏小时数（防跳天/日结把窗口一次性跳过），单次最多按 24 小时算；
        // 首小时（lastCheck 与当前相同）也按 1 小时计，窗口起始小时即开始带单
        let hoursElapsed = 1;
        if (af.lastCheckDay && af.lastCheckHour != null && af.lastCheckDay <= now.day) {
            const h = (now.day - af.lastCheckDay) * 24 + (now.hour - af.lastCheckHour);
            if (h > 0) hoursElapsed = h;
        }
        af.lastCheckDay = now.day;
        af.lastCheckHour = now.hour;
        hoursElapsed = Math.max(0, Math.min(hoursElapsed, 24));
        if (hoursElapsed <= 0) return;

        const cfg = (typeof LIVE_CONFIG !== 'undefined') ? LIVE_CONFIG : {};
        const rate = cfg.activeFanOrderRate != null ? cfg.activeFanOrderRate : 0.0008;
        const expected = af.count * rate * hoursElapsed;
        if (expected <= 0) return;

        const activeListings = (gameState.state.listings || []).filter(l => l.status === 'active');
        if (activeListings.length === 0) return;

        // 泊松近似出单数，单次调用上限 10 单（日上限另行约束）
        let rounds = Math.floor(expected);
        if (Math.random() < (expected - rounds)) rounds++;
        rounds = Math.min(rounds, 10);
        let generated = 0;
        for (let i = 0; i < rounds; i++) {
            if (af.dayOrdersUsed >= af.dayOrdersMax) break;
            const listing = activeListings[Math.floor(Math.random() * activeListings.length)];
            const product = PRODUCTS ? PRODUCTS.find(p => p.id === listing.productId) : null;
            if (!product) continue;
            const inventory = (typeof gameState.getSellableQuantity === 'function')
                ? gameState.getSellableQuantity(listing.productId, listing.qualityGrade || 'B')
                : gameState.getInventoryQuantity(listing.productId);
            if (!(inventory > 0)) continue;
            // P3：活跃粉丝窗口内自动单售价 ×1.08（高价窗口）
            const premiumMult = (typeof LIVE_CONFIG !== 'undefined' && LIVE_CONFIG.postStreamPremiumMult) || 1.08;
            const orderCount = this.generateOrders(listing, product, 1, premiumMult, { source: 'organic' });
            if (orderCount > 0) {
                generated++;
                af.dayOrdersUsed++;
            }
        }
    }

    checkLivestreamEnd() {
        const livestream = gameState.state.livestream;
        if (!livestream.isLive) return;
        
        if (livestream.settings?.autoEnd === false) return;
        
        if (livestream.duration >= (livestream.plannedDuration || 4)) {
            gameState.endLivestream();
        }
    }

    // 节日大促检测
    checkFestivalEvent() {
        const time = gameState.state.gameTime;
        const dayOfYear = time.day;
        
        for (const festival of FESTIVAL_EVENTS) {
            const festivalDay = (festival.month - 1) * 30 + festival.day;
            const startDay = festivalDay - Math.floor(festival.duration / 2);
            const endDay = festivalDay + Math.floor(festival.duration / 2);
            
            if (dayOfYear >= startDay && dayOfYear <= endDay) {
                return festival;
            }
        }
        return null;
    }

    getFestivalTrafficMultiplier() {
        const festival = this.checkFestivalEvent();
        return festival ? festival.trafficMultiplier : 1;
    }

    // 供应商关系升级
    updateSupplierRelations() {
        const relations = gameState.state.supplierRelations;
        const purchaseOrders = gameState.state.purchaseOrders.filter(o => o.status === 'received');
        
        SUPPLIERS.forEach(supplier => {
            const orderCount = purchaseOrders.filter(o => o.supplierId === supplier.id).length;
            let currentLevel = relations[supplier.id] || 1;
            
            for (let i = SUPPLIER_RELATION_LEVELS.length - 1; i >= 0; i--) {
                if (orderCount >= SUPPLIER_RELATION_LEVELS[i].minOrders) {
                    currentLevel = SUPPLIER_RELATION_LEVELS[i].level;
                    break;
                }
            }
            
            relations[supplier.id] = currentLevel;
        });
    }

    // 店铺装修加成
    getStoreDesignBonus() {
        const design = gameState.state.storeDesign;
        const qualityBonus = (design.quality || 1) * 0.05;
        return 1 + qualityBonus;
    }

    // 结局检测
    checkGameEndings() {
        if (gameState.state.gameOver) return;
        
        const state = gameState.state;
        const completedOrders = state.orders.filter(o => o.status === 'completed');
        const totalSales = completedOrders.reduce((sum, o) => sum + o.totalAmount, 0);
        const unlockedCount = (state.achievements && state.achievements.unlocked)
            ? state.achievements.unlocked.length : 0;
        
        let triggeredEnding = null;
        // 破产优先：不得被后续成就型结局覆盖
        if (state.shop.funds <= SHOP_CONFIG.bankruptLine) {
            triggeredEnding = ENDINGS.find(e => e.condition && e.condition.type === 'bankrupt') || null;
        }
        
        if (!triggeredEnding) {
            ENDINGS.forEach(ending => {
                const condition = ending.condition;
                if (!condition || condition.type === 'bankrupt') return;
                
                switch (condition.type) {
                    case 'totalSales':
                        if (totalSales >= condition.value) {
                            triggeredEnding = ending;
                        }
                        break;
                    case 'days':
                        if (state.gameTime.day >= condition.value && totalSales > 0) {
                            triggeredEnding = ending;
                        }
                        break;
                    case 'achievements':
                        if (unlockedCount >= condition.value) {
                            triggeredEnding = ending;
                        }
                        break;
                    case 'ownBrand':
                        if (condition.value && state.shop && state.shop.hasOwnBrand) {
                            triggeredEnding = ending;
                        }
                        break;
                }
            });
        }
        
        if (triggeredEnding) {
            state.ending = {
                id: triggeredEnding.id,
                name: triggeredEnding.name,
                icon: triggeredEnding.icon,
                description: triggeredEnding.description,
                triggerDay: state.gameTime.day
            };
            // ⭐ 修复：只有 forceGameOver 为 true 的结局（仅破产）才强制 gameOver；
            //    成就型结局（小而美/首富/品牌/讲师）仅记录 ending 信息，游戏可继续玩（支持无限跳天）
            if (triggeredEnding.forceGameOver === true) {
                state.gameOver = true;
            }
        }
    }
}

const gameEngine = new GameEngine();
