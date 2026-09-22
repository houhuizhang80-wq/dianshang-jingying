// UI管理器
class UIManager {
    constructor() {
        this.currentPage = 'dashboard';
        this.currentTab = {};
        this._financeRecordFilter = 'all'; // 财务「全部明细」筛选：all|today|income|expense
        // 财务概览折叠：true=展开（默认明细折叠、今日支出折叠，减少刷屏）
        this._financeCollapse = { todayDetail: false, todayIncome: true, todayExpense: false };
        this.lastState = null;
        this.lastPage = null;
        this.scrollPositions = {};
        this.updateThrottleTimer = null;
        this.pendingUpdate = false;
        this.renderThrottleTimer = null;
        this.pendingRender = false;
        this.longPressTimer = null;
        this.longPressInterval = null;
        this.longPressDelay = 500;
        this.longPressSpeed = 100;
        // ====== 输入框焦点保护（解决：唤起输入法/打字时被整页重绘销毁DOM→闪退/清空） ======
        //   - _isEditableFocused() 判定用户是否正在输入
        //   - render()/throttledRender() 判定到焦点在可编辑元素时，将 DOM 重建挂起，只做文本级小更新
        //   - 用户失焦(blur/focusout) 后用 _flushPendingRenderTimer 延迟（默认160ms）执行：
        //     避免 Tab/鼠标点下一个输入框的瞬间 (A blur→B focus 中间会触发一次 A 的 blur)
        //     导致 render 把 B 输入框刚获得的焦点销毁
        this._editableFocusListenerBound = false;
        this._flushPendingRenderTimer = null;
        // 仓库日志筛选：type=all/inbound/outbound/move/check，days=0/7/30（0=全部）
        this._whLogFilter = { type: 'all', days: 0 };
        // 仓储管理系统状态
        this._warehouseTab = 'overview';
        this._invFilter = { keyword: '', category: 'all', sortBy: 'quantity', sortDir: 'desc' };
        this._selectedProductId = null;
        // 员工管理系统状态
        this._employeeMgrTab = 'list'; // 主界面仅 list；payroll/history/config/housing 逻辑保留但不进主 Tab
        this._employeeFilter = { keyword: '', department: 'all', status: 'active' };
        this._selectedEmployeeId = null;
        this._empEditMode = false;

        // ====== 性能优化：静态数据缓存 Map（避免 N 次 PRODUCTS.find / CATEGORIES.find） ======
        // PRODUCTS 和 CATEGORIES 是游戏常量，全局只需构建一次
        this._cache = {
            productsById: new Map(),
            categoriesById: new Map(),
            qualityGrades: null,
            orderStatuses: null,
            expressOptions: null
        };
        try { if (typeof PRODUCTS !== 'undefined') this._cache.productsById = new Map(PRODUCTS.map(p => [p.id, p])); } catch (e) {}
        try { if (typeof CATEGORIES !== 'undefined') this._cache.categoriesById = new Map(CATEGORIES.map(c => [c.id, c])); } catch (e) {}
        try { if (typeof QUALITY_GRADES !== 'undefined') this._cache.qualityGrades = QUALITY_GRADES; } catch (e) {}
        try { if (typeof ORDER_STATUS !== 'undefined') this._cache.orderStatuses = ORDER_STATUS; } catch (e) {}
        try { if (typeof EXPRESS_OPTIONS !== 'undefined') this._cache.expressOptions = EXPRESS_OPTIONS; } catch (e) {}

        // ====== 订单列表分页状态（每个 tab 独立维护页码） ======
        // 每页 100 条，既保证信息量又避免一次性渲染几千个 DOM 节点
        this._ordersPageSize = 100;
        this._ordersPage = {}; // { [tabId]: pageNumber (1-based) }
        // ====== 店铺在架分页（爆单时避免一次画几百张卡片） ======
        this._listingsPage = 1;
        this._listingsPageSize = 24;
        this._analyticsRange = 'today';
        // 交互保护窗：点按钮期间推迟整页重建，避免「点什么都卡」
        this._interactionUntil = 0;
        this._postClickRenderTimer = null;
        this._tapGuardBound = false;

        // ============== 动态刷新率 轻量插值状态（rAF自动降频） ==============
        this._rafBound = false;       // 是否已绑定到gameEngine帧回调
        this._headerTimeEl = null;    // 缓存时间元素引用（避免每帧querySelector）
        this._headerFundsEl = null;   // 缓存资金元素引用
        this._lastHour = -1;          // 上次逻辑小时值（区分是否跨整点）
        this._interpFunds = null;     // 资金插值器（丝滑过渡数值）
        this._targetFunds = null;     // 资金目标值
        this._lastFundsUpdateAt = 0;  // 上次资金目标更新时间
        this._lastScrollSave = 0;     // 上次保存滚动位置的时间戳（高刷下16ms节流→动态节流）
        this._lastNavRenderedPage = null;    // 底栏已渲染的页面，相同则跳过 innerHTML
        this._lastHeaderShopName = null;     // 顶栏店名，未变则增量更新
        this._lastHeaderShopLevel = null;    // 顶栏等级，未变则增量更新
        // ============== 资金显示：统一渲染幂等缓存（防止浮点噪声重复写DOM） ==============
        this._lastFundsRenderedInt = null;   // 上次已写入DOM的整数金额（Math.round），相同就跳过
        this._lastFundsRenderedDebt = null;  // 上次是否欠款，相同就不切换badge显示
        this._lastFundsRenderedRatio = null; // 上次欠款比例，相同就不改badge文本
        // ============== 弹层栈管理（防叠层 / 防连点） ==============
        this.MAX_MODAL_DEPTH = 3;            // 同时可见的弹层上限（超过则从最底层开始收起）
        this._modalCloseLockMs = 90;         // 关闭连点锁：防一次关掉两层，又不能太长导致「点了没反应」
        this._lastModalCloseAt = 0;
        this._modalLocks = Object.create(null);
    }

    /** 当前弹层列表（DOM 顺序 = 层叠顺序，最后一个在最上面） */
    _modalLayers() {
        try { return Array.from(document.querySelectorAll('.modal-overlay')); } catch (_) { return []; }
    }

    /**
     * 弹层栈归一化（防「弹层叠在一起」）：
     *  1) 同一弹窗（同 modalId / 同标题）只保留最上面那一层，其余重复层直接移除
     *  2) 可见层数超过 MAX_MODAL_DEPTH 时，从最底层开始收起非锁定层
     * 幂等，可在每次开关弹窗后安全调用。
     */
    _normalizeModalStack() {
        const layers = this._modalLayers();
        if (layers.length > 1) {
            const seenId = Object.create(null);
            const seenTitle = Object.create(null);
            for (let i = layers.length - 1; i >= 0; i--) {
                const el = layers[i];
                const id = (el.dataset && el.dataset.modalId) || el.id || '';
                const title = (el.dataset && el.dataset.modalTitle) || '';
                const dup = (id && seenId[id]) || (title && seenTitle[title]);
                if (dup) {
                    try { el.remove(); } catch (_) {}
                    layers.splice(i, 1);
                    continue;
                }
                if (id) seenId[id] = true;
                if (title) seenTitle[title] = true;
            }
            while (layers.length > this.MAX_MODAL_DEPTH) {
                let idx = -1;
                for (let i = 0; i < layers.length; i++) {
                    const el = layers[i];
                    if (el.dataset && el.dataset.lockClose === '1') continue;
                    idx = i;
                    break;
                }
                if (idx < 0) break;   // 全是锁定层（支付/发薪确认）：不强行关闭
                try { layers[idx].remove(); } catch (_) {}
                layers.splice(idx, 1);
            }
        }
        this._syncModalStackZIndex();
    }

    /**
     * ⭐ 资金显示统一渲染函数（唯一DOM写入出口）
     *  - 保证 DOM 结构一致性：永远是 [图标span] + [金额span] + [可选欠款badge span]
     *  - 只增量更新文本节点，不反复整体innerHTML/textContent覆盖导致嵌套↔纯文本结构切换
     *  - 幂等：Math.round(rawValue) 与上次相同 + 欠款状态相同 → 直接 return，不碰DOM
     *  - 超调硬截断：rawValue 超过 maxDebt 下限 或 极端值 先 clamp（方向保护）
     */
    _renderFundsDisplay(el, rawValue, debtInfo) {
        if (!el) return;
        // ===== 0) 数值合法性 + 方向保护（超调硬截断） =====
        if (!isFinite(rawValue)) rawValue = 0;
        // clamp 到合理区间：maxDebt = -99999；正数理论不封顶但为避免天文数字UI炸，也给个软上限9万亿（¥90000亿）
        const MAX_DEBT = -99999;
        const SOFT_CEIL = 9e12;
        if (rawValue < MAX_DEBT) rawValue = MAX_DEBT;
        else if (rawValue > SOFT_CEIL) rawValue = SOFT_CEIL;

        // ===== 1) 准备欠款信息 =====
        const inDebt = rawValue < 0;
        let ratio = 0;
        if (inDebt && debtInfo && typeof debtInfo.ratio === 'number') {
            ratio = debtInfo.ratio;
        } else if (inDebt) {
            // 没有传debtInfo时兜底：按 gameState 的 maxDebt 估算（gameConfig没暴露时给固定值0.5用于显示）
            try {
                const maxDebtAbs = (typeof gameState !== 'undefined' && gameState && gameState.config && typeof gameState.config.maxDebt === 'number')
                    ? Math.abs(gameState.config.maxDebt) : 100000;
                ratio = Math.min(1, Math.max(0, -rawValue) / maxDebtAbs);
            } catch (_) { ratio = 0.5; }
        }

        // ===== 2) 幂等检查：整数位 + 欠款状态 + 比例都相同 → 直接跳过 =====
        const intValue = Math.round(rawValue);
        const ratioKey = Math.round(ratio * 1000); // 比例精确到0.1%，避免浮点噪声反复重画
        if (this._lastFundsRenderedInt === intValue &&
            this._lastFundsRenderedDebt === inDebt &&
            this._lastFundsRenderedRatio === ratioKey) {
            return;
        }
        this._lastFundsRenderedInt = intValue;
        this._lastFundsRenderedDebt = inDebt;
        this._lastFundsRenderedRatio = ratioKey;

        // ===== 3) 构建/校验 DOM 结构：永远是 图标span + 金额span + 可选欠款badge span =====
        // 规范 DOM 类名（不带点，纯类名），供querySelector查找
        const SIGN_CLS  = '__funds_sign';
        const VAL_CLS   = '__funds_val';
        const BADGE_CLS = '__funds_badge';

        let signEl  = el.querySelector('.' + SIGN_CLS);
        let valEl   = el.querySelector('.' + VAL_CLS);
        let badgeEl = el.querySelector('.' + BADGE_CLS);

        // 结构不正确 → 整体重建（只发生一次：首次渲染 / 被老版本错误覆盖后自愈）
        const structureBroken = !signEl || !valEl;
        if (structureBroken) {
            el.innerHTML = '';
            signEl = document.createElement('span');
            signEl.className = SIGN_CLS;
            signEl.style.whiteSpace = 'nowrap';
            signEl.style.flexShrink = '0';
            valEl = document.createElement('span');
            valEl.className = VAL_CLS;
            valEl.style.whiteSpace = 'nowrap';
            valEl.style.overflow = 'hidden';
            valEl.style.textOverflow = 'ellipsis';
            badgeEl = document.createElement('span');
            badgeEl.className = BADGE_CLS;
            // badge 样式与 renderHeader 原定义保持一致
            badgeEl.className += ' badge';
            badgeEl.style.cssText = 'background:linear-gradient(135deg,#ff4444,#c0392b);color:#fff;padding:1px 5px;font-size:9px;border-radius:8px;white-space:nowrap;flex-shrink:0;display:none;';
            el.appendChild(signEl);
            el.appendChild(valEl);
            el.appendChild(badgeEl);
        } else if (!badgeEl) {
            // 兼容老结构里没badge的情况（自愈）
            badgeEl = document.createElement('span');
            badgeEl.className = BADGE_CLS + ' badge';
            badgeEl.style.cssText = 'background:linear-gradient(135deg,#ff4444,#c0392b);color:#fff;padding:1px 5px;font-size:9px;border-radius:8px;white-space:nowrap;flex-shrink:0;display:none;';
            el.appendChild(badgeEl);
        }

        // ===== 4) 格式化金额文本：正数用💰，负数用💸，永远不带负号前缀（💸语义+红色样式表达欠债） =====
        let amountText;
        if (inDebt) {
            // 欠债：formatMoney 会返回 "-¥xxx"，我们去掉负号，💸+红色 已经表达"欠"的含义
            const formatted = formatMoney(-rawValue); // 传正数给formatMoney → 得到 "¥xxx" / "¥xx亿"
            amountText = formatted.replace(/^¥/, ''); // 去掉 ¥，统一由 💸 带"欠"含义
            // 但如果格式化结果里有 "亿"/"万" 单位要保留："¥100.00亿" → "100.00亿"
            signEl.textContent = '💸';
            signEl.style.color = '#ff4444';
            signEl.style.fontWeight = '800';
            valEl.textContent = amountText;
            valEl.style.color = '#ff4444';
            valEl.style.fontWeight = '800';
            // 欠款 badge：显示 + 改文本
            badgeEl.style.display = '';
            const pct = Math.round(Math.min(100, Math.max(0, ratio * 100)));
            badgeEl.textContent = '欠款 ' + pct + '%';
        } else {
            amountText = formatMoney(rawValue); // "¥100.00" / "¥100.00亿" / "¥5.20万"
            signEl.textContent = '💰';
            signEl.style.color = '';
            signEl.style.fontWeight = '';
            valEl.textContent = amountText;
            valEl.style.color = '';
            valEl.style.fontWeight = '';
            // 无欠款：隐藏badge
            badgeEl.style.display = 'none';
            badgeEl.textContent = '';
        }
    }

    init() {
        this._lastRenderedPage = null;
        this.lastPage = null;
        this.lastState = null;
        this.renderBottomNav();
        this.render();
        this.bindEvents();
        this._bindTapGuard();
        this.saveScrollPosition();
        this._bindHeaderLayoutSync();
        this._syncMainContainerOffset(true);

        // 绑定到GameEngine的动态刷新率 rAF 循环，做轻量每帧更新（时间丝滑 + 数字插值）
        if (!this._rafBound && typeof gameEngine !== 'undefined' && typeof gameEngine.onFrame === 'function') {
            // 新增2个参数：fps + rafInterval（回调被跳帧后的实际调用间隔，单位帧）
            gameEngine.onFrame((now, dt, progress, fps, rafInterval) => this._onHighRefreshFrame(now, dt, progress, fps, rafInterval));
            this._rafBound = true;
        }

        // ===== 输入框焦点保护：全局捕获 focus/blur =====
        // 用户在 input/textarea/contenteditable 里打字时，绝不能做 innerHTML 重建整页，否则输入法闪退/内容清空
        this._bindEditableFocusProtection();

        // 新开局引导（仅一次）
        try {
            setTimeout(() => this.maybeShowNewbieGuide(), 800);
        } catch (_) {}
    }

    forceRender() {
        try {
            if (document.getElementById('employeeManagerModal') || document.querySelector('[data-modal-id="employeeManagerModal"]')) {
                this._renderEmployeeManager();
            }
        } catch (_) {}
        try { this.render(); } catch (_) {}
    }

    maybeShowNewbieGuide(force = false) {
        try {
            if (!force) {
                const seen = !!(gameState && gameState.state && gameState.state.settings && gameState.state.settings.hasSeenTutorialV3);
                let ls = false;
                try { ls = localStorage.getItem('ecommerce_sim_seen_tutorial_v3') === '1'; } catch (_) {}
                if (seen || ls) return;
            }
            this.showNewbieGuide();
        } catch (_) {}
    }

    /** 对着真实界面高亮的分步新手教程 */
    _getNewbieGuideSteps() {
        return [
            {
                icon: '🏪',
                title: '欢迎开店',
                page: 'dashboard',
                target: null,
                body: `<p>核心循环就五步：<b>招人 → 进货 → 上架 → 推广 → 履约</b>。</p>
                    <p>接下来会带你点亮真实界面，随时可「跳过」。</p>`
            },
            {
                icon: '⏱️',
                title: '顶部：时间与资金',
                page: 'dashboard',
                target: '#topHeader',
                body: `<p>这里看<b>游戏日期、资金</b>。时间会自己走，点<b>暂停</b>就能慢慢操作。</p>
                    <p>开局资金有限，进货和推广都要算账。</p>`
            },
            {
                icon: '📱',
                title: '底部六个入口',
                page: 'dashboard',
                target: '[data-guide="bottom-nav"]',
                body: `<p><b>首页</b>经营工作台 · <b>货源</b>进货 · <b>商品</b>上架 · <b>订单</b>履约 · <b>数据</b>经营分析 · <b>我的</b>店档设置。</p>`
            },
            {
                icon: '📊',
                title: '首页待办',
                page: 'dashboard',
                target: '[data-guide="dash-stats"]',
                body: `<p>待付款 / 待打包 / 待发货积压了要点进去处理，别让买家等太久。</p>
                    <p>下方按<b>供应链 / 销售 / 人力 / 社区</b>分组，员工、包材、快递都在首页格子里。</p>`
            },
            {
                icon: '📦',
                title: '货源：先进货',
                page: 'supply',
                target: '[data-guide="nav-supply"]',
                body: `<p>选批发商下单，到货会入库。等级越高解锁越多货源。</p>
                    <p>仓快满了先回<b>首页 → 仓储管理</b>扩容，否则装不进去。</p>`
            },
            {
                icon: '🛍️',
                title: '商品：上架定价',
                page: 'products',
                target: '[data-guide="products-tabs"]',
                fallback: '#mainContainer',
                body: `<p>有货后到<b>上架商品</b>定价。售价要盖过成本 + 包装 + 快递。</p>
                    <p>出第一单前店主可<b>手动上架/改价</b>；出单后上架要<b>客服</b>、批量改价要<b>改价员</b>。</p>`
            },
            {
                icon: '📣',
                title: '推广才会出单',
                page: 'dashboard',
                target: '[data-guide="wb-group-daily"]',
                body: `<p>不推广每天只有很少自然单。点<b>推广</b>开搜索/直通车，或招<b>推广员</b>自动投。</p>
                    <p>烧钱没回报就停，别硬投。</p>`
            },
            {
                icon: '📋',
                title: '订单履约',
                page: 'orders',
                target: '[data-guide="orders-tabs"]',
                fallback: '#mainContainer',
                body: `<p>付款 → 打包（要包材）→ 发货（要快递）→ 签收评价。</p>
                    <p>没员工也能手动点，单量大了必须招<b>打包员 / 发货员</b>。</p>`
            },
            {
                icon: '👤',
                title: '首页：开局三件套',
                page: 'dashboard',
                target: '[data-guide="wb-group-chain"]',
                fallback: '.wb-mod-grid',
                body: `<p>先点首页这三格：<b>员工管理</b>（在「常用入口」）、<b>包装材料</b>、<b>快递合作</b>。</p>
                    <p>银行、纳税、宿舍、会员这些不常用的，去<b>我的</b>里点。</p>`
            },
            {
                icon: '✅',
                title: '按这个开局',
                page: 'dashboard',
                target: null,
                body: `<ol>
                    <li>买包材 + 开通一家快递（首页「包装材料」「快递合作」）</li>
                    <li>货源进货 → 入库 → 上架（留利润）</li>
                    <li>开一点推广（首页「推广投放」），不投流每天只有零星自然单</li>
                    <li>盯待打包/待发货，出单后再招打包、发货、客服</li>
                </ol>
                <p>⚠️ 「跳一天」有次数限制；<b>欠薪/欠仓租时跳天会直接破产</b>。前 7 天免在仓占用费，放心备货。</p>
                <p>可在「我的 → 账号与设置」里再看一遍教程。</p>`
            }
        ];
    }

    showNewbieGuide(startStep = 0) {
        const steps = this._getNewbieGuideSteps();
        this._newbieGuideStep = Math.max(0, Math.min(startStep, steps.length - 1));
        this._newbieGuideActive = true;
        try {
            this._lastNavRenderedPage = null;
            this.renderBottomNav();
        } catch (_) {}
        try {
            if (typeof gameState !== 'undefined' && gameState && typeof gameState.isPaused === 'function' && !gameState.isPaused()) {
                this._newbiePausedByGuide = true;
                if (typeof this.togglePause === 'function') this.togglePause();
            }
        } catch (_) {}
        this._ensureNewbieCoachDom();
        this._bindNewbieCoachEvents();
        this._renderNewbieGuideModal();
    }

    _ensureNewbieCoachDom() {
        let root = document.getElementById('newbieCoachRoot');
        if (root) return root;
        root = document.createElement('div');
        root.id = 'newbieCoachRoot';
        root.className = 'newbie-coach';
        root.innerHTML = `
            <div class="newbie-coach-mask"></div>
            <div class="newbie-coach-hole" hidden></div>
            <div class="newbie-coach-card" role="dialog" aria-modal="true">
                <div class="newbie-coach-top">
                    <span class="newbie-coach-step"></span>
                    <button type="button" class="newbie-coach-skip" onclick="ui.skipNewbieGuide()">跳过</button>
                </div>
                <div class="newbie-coach-title"></div>
                <div class="newbie-coach-dots"></div>
                <div class="newbie-coach-body"></div>
                <div class="newbie-coach-actions"></div>
            </div>`;
        document.body.appendChild(root);
        return root;
    }

    _bindNewbieCoachEvents() {
        if (this._newbieCoachBound) return;
        this._newbieCoachBound = true;
        this._onNewbieCoachRelayout = () => {
            if (this._newbieGuideActive) this._layoutNewbieCoach();
        };
        window.addEventListener('resize', this._onNewbieCoachRelayout);
        const mc = document.getElementById('mainContainer');
        if (mc) mc.addEventListener('scroll', this._onNewbieCoachRelayout, { passive: true });
    }

    _unbindNewbieCoachEvents() {
        if (!this._newbieCoachBound) return;
        this._newbieCoachBound = false;
        if (this._onNewbieCoachRelayout) {
            window.removeEventListener('resize', this._onNewbieCoachRelayout);
            const mc = document.getElementById('mainContainer');
            if (mc) mc.removeEventListener('scroll', this._onNewbieCoachRelayout);
        }
    }

    _renderNewbieGuideModal() {
        const steps = this._getNewbieGuideSteps();
        const total = steps.length;
        const idx = Math.max(0, Math.min(this._newbieGuideStep || 0, total - 1));
        this._newbieGuideStep = idx;
        const step = steps[idx];
        const isFirst = idx === 0;
        const isLast = idx === total - 1;

        if (step.page && this.currentPage !== step.page) {
            this.navigateTo(step.page);
            setTimeout(() => this._paintNewbieCoachStep(step, idx, total, isFirst, isLast), 160);
            return;
        }
        this._paintNewbieCoachStep(step, idx, total, isFirst, isLast);
    }

    _paintNewbieCoachStep(step, idx, total, isFirst, isLast) {
        const root = this._ensureNewbieCoachDom();
        root.classList.add('is-on');
        const titleEl = root.querySelector('.newbie-coach-title');
        const bodyEl = root.querySelector('.newbie-coach-body');
        const stepEl = root.querySelector('.newbie-coach-step');
        const dotsEl = root.querySelector('.newbie-coach-dots');
        const actionsEl = root.querySelector('.newbie-coach-actions');
        if (titleEl) titleEl.textContent = (step.icon || '') + ' ' + (step.title || '');
        if (bodyEl) bodyEl.innerHTML = step.body || '';
        if (stepEl) stepEl.textContent = (idx + 1) + ' / ' + total;
        if (dotsEl) {
            dotsEl.innerHTML = Array.from({ length: total }, (_, i) =>
                `<i class="${i === idx ? 'on' : (i < idx ? 'done' : '')}"></i>`).join('');
        }
        if (actionsEl) {
            actionsEl.innerHTML =
                (isFirst ? '' : `<button type="button" class="btn btn-secondary" onclick="ui.newbieGuidePrev()">上一步</button>`) +
                (isLast
                    ? `<button type="button" class="btn btn-primary" onclick="ui.dismissNewbieGuide(true)">开始经营</button>`
                    : `<button type="button" class="btn btn-primary" onclick="ui.newbieGuideNext()">下一步</button>`);
        }
        this._newbieCoachTarget = step.target || null;
        this._newbieCoachFallback = step.fallback || null;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => this._layoutNewbieCoach());
        });
    }

    _layoutNewbieCoach() {
        const root = document.getElementById('newbieCoachRoot');
        if (!root || !this._newbieGuideActive) return;
        const hole = root.querySelector('.newbie-coach-hole');
        const card = root.querySelector('.newbie-coach-card');
        if (!hole || !card) return;

        let el = null;
        try {
            if (this._newbieCoachTarget) el = document.querySelector(this._newbieCoachTarget);
            if ((!el || el.offsetWidth < 4) && this._newbieCoachFallback) {
                el = document.querySelector(this._newbieCoachFallback);
            }
        } catch (_) { el = null; }

        if (el && typeof el.scrollIntoView === 'function') {
            try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
        }

        if (!el) {
            hole.hidden = true;
            root.classList.remove('is-spot');
            card.classList.add('newbie-coach-card--center');
            card.style.top = '';
            card.style.left = '';
            card.style.right = '';
            card.style.bottom = '';
            return;
        }

        const pad = 6;
        const r = el.getBoundingClientRect();
        hole.hidden = false;
        root.classList.add('is-spot');
        hole.style.top = Math.max(4, r.top - pad) + 'px';
        hole.style.left = Math.max(4, r.left - pad) + 'px';
        hole.style.width = Math.max(8, r.width + pad * 2) + 'px';
        hole.style.height = Math.max(8, r.height + pad * 2) + 'px';

        card.classList.remove('newbie-coach-card--center');
        card.style.left = '12px';
        card.style.right = '12px';
        card.style.bottom = '';
        const cardH = card.offsetHeight || 180;
        const spaceBelow = window.innerHeight - r.bottom;
        const spaceAbove = r.top;
        if (spaceBelow >= Math.min(cardH + 16, 160) || spaceBelow >= spaceAbove) {
            const top = Math.min(window.innerHeight - cardH - 10, r.bottom + 10);
            card.style.top = Math.max(8, top) + 'px';
        } else {
            card.style.top = Math.max(8, r.top - cardH - 10) + 'px';
        }
    }

    newbieGuideNext() {
        const steps = this._getNewbieGuideSteps();
        if ((this._newbieGuideStep || 0) >= steps.length - 1) {
            this.dismissNewbieGuide(true);
            return;
        }
        this._newbieGuideStep = (this._newbieGuideStep || 0) + 1;
        this._renderNewbieGuideModal();
    }

    newbieGuidePrev() {
        if ((this._newbieGuideStep || 0) <= 0) return;
        this._newbieGuideStep -= 1;
        this._renderNewbieGuideModal();
    }

    skipNewbieGuide() {
        this.dismissNewbieGuide(true);
    }

    dismissNewbieGuide(markDone) {
        if (markDone) {
            try {
                if (gameState && gameState.state) {
                    if (!gameState.state.settings) gameState.state.settings = {};
                    gameState.state.settings.hasSeenTutorialV3 = true;
                    gameState.state.settings.hasSeenTutorialV2 = true;
                    gameState.state.settings.hasSeenTutorial = true;
                }
                localStorage.setItem('ecommerce_sim_seen_tutorial_v3', '1');
            } catch (_) {}
        }
        this._newbieGuideActive = false;
        this._unbindNewbieCoachEvents();
        const root = document.getElementById('newbieCoachRoot');
        if (root && root.parentNode) root.parentNode.removeChild(root);
        try {
            if (this._newbiePausedByGuide && typeof gameState !== 'undefined' && gameState && typeof gameState.isPaused === 'function' && gameState.isPaused()) {
                if (typeof this.togglePause === 'function') this.togglePause();
            }
        } catch (_) {}
        this._newbiePausedByGuide = false;
        try {
            if (this.currentPage !== 'dashboard') this.navigateTo('dashboard');
        } catch (_) {}
    }

    /** 行情页/海外备货一键采购：自动选最便宜可用批发商 */
    quickPurchaseFromMarket(productId, opts) {
        const product = (typeof getProductById === 'function')
            ? getProductById(productId)
            : ((typeof PRODUCTS !== 'undefined') ? PRODUCTS.find(p => p.id === productId) : null);
        if (!product) {
            this.showToast('商品不存在');
            return;
        }
        let suppliers = [];
        try {
            suppliers = (typeof gameState.getAvailableSuppliers === 'function')
                ? gameState.getAvailableSuppliers()
                : (typeof SUPPLIERS !== 'undefined' ? SUPPLIERS.slice() : []);
        } catch (_) {
            suppliers = (typeof SUPPLIERS !== 'undefined') ? SUPPLIERS.slice() : [];
        }
        const matched = suppliers.filter(s =>
            s && Array.isArray(s.categories)
            && (s.categories.includes(product.category) || s.categories.includes('all'))
        );
        if (!matched.length) {
            this.showToast('暂无可用批发商，请先升级店铺解锁');
            return;
        }
        matched.sort((a, b) => (a.priceMultiplier || 1) - (b.priceMultiplier || 1));
        const best = matched[0];
        this.closeModal();
        this.showPurchaseModal(best.id, productId, opts || {});
        this.showToast(`已选最优批发商：${best.name}`);
    }

    /**
     * 监听顶栏高度变化（换行/暂停态/旋转屏幕），始终把主内容顶开，避免挡住仪表盘数字
     */
    _bindHeaderLayoutSync() {
        if (this._headerLayoutBound) return;
        this._headerLayoutBound = true;
        const sync = () => this._syncMainContainerOffset(false);
        try {
            window.addEventListener('resize', sync, { passive: true });
            window.addEventListener('orientationchange', sync, { passive: true });
        } catch (_) {}
        try {
            if (typeof ResizeObserver !== 'undefined') {
                this._headerResizeObs = new ResizeObserver(() => {
                    if (this._headerResizeDebounce) return;
                    this._headerResizeDebounce = setTimeout(() => {
                        this._headerResizeDebounce = null;
                        sync();
                    }, 80);
                });
                const header = document.getElementById('topHeader');
                if (header) this._headerResizeObs.observe(header);
            }
        } catch (_) {}
    }

    /** 按 #topHeader 真实高度设置主内容区 margin/height（含双 rAF 等布局稳定） */
    _syncMainContainerOffset(force) {
        const apply = () => {
            try {
                const header = document.getElementById('topHeader');
                const mc = document.getElementById('mainContainer');
                if (!header || !mc) return;
                const h = Math.ceil(header.getBoundingClientRect().height || header.offsetHeight || 0);
                // 两行顶栏保底，防止测到 0/半渲染高度
                const safeH = Math.max(h > 0 ? h : 0, 96) + 6;
                if (!force && this._lastHeaderOffsetH === safeH) return;
                this._lastHeaderOffsetH = safeH;
                document.documentElement.style.setProperty('--app-header-h', safeH + 'px');
                mc.style.marginTop = safeH + 'px';
                const bottomH = 60;
                mc.style.height = 'calc(100vh - ' + safeH + 'px - ' + bottomH + 'px)';
                try {
                    mc.style.height = 'calc(100dvh - ' + safeH + 'px - ' + bottomH + 'px)';
                } catch (_) {}
            } catch (_) {}
        };
        const before = this._lastHeaderOffsetH;
        apply();
        const changed = force || before !== this._lastHeaderOffsetH;
        if (!changed) return;
        try {
            requestAnimationFrame(() => {
                apply();
                if (force) requestAnimationFrame(apply);
            });
        } catch (_) {
            setTimeout(apply, 0);
        }
    }

    /**
     * 输入框焦点保护：全局绑定 focusin/focusout（冒泡版本），监听可编辑元素得失焦
     *  - 得焦：把下次渲染挂起（pendingRender=true），不重建 DOM
     *  - 失焦：立即 flush 掉挂起的 pendingRender，刷新一次界面
     */
    _bindEditableFocusProtection() {
        if (this._editableFocusListenerBound) return;
        try {
            /**
             * flushPendingRender：失焦后真正执行 pendingRender（160ms 延迟版本）
             *  - 用户 Tab 从输入框 A → 输入框 B：A 的 focusout 触发，160ms 内 B 的 focusin 会到，
             *    此时 _isEditableFocused() 仍为 true → 取消 render，并保持 pendingRender=true，
             *    等用户把所有表单都输完、焦点回到 body/按钮 时，160ms 后真正渲染。
             */
            const flushPendingRender = () => {
                // 1. 如果这时又有新的可编辑元素获焦，继续挂起，等下一次失焦
                if (this._isEditableFocused()) {
                    this.pendingRender = true;
                    return;
                }
                if (!this.pendingRender) return;
                this.pendingRender = false;
                try { this.render(); } catch (e) { console.warn('[editable-focusout-render]', e); }
            };

            const blurHandler = () => {
                // 清掉旧的定时器：保证连续快速 blur/focus 切换只在最后一次 flush
                if (this._flushPendingRenderTimer) {
                    clearTimeout(this._flushPendingRenderTimer);
                    this._flushPendingRenderTimer = null;
                }
                // 只有有脏数据需要渲染时才延迟
                if (this.pendingRender) {
                    this._flushPendingRenderTimer = setTimeout(() => {
                        this._flushPendingRenderTimer = null;
                        flushPendingRender();
                    }, 160);  // 160ms 足够 Tab/点击切换到下一个输入框完成 focus
                }
            };

            // 得焦时：直接把等待中的 render 取消（因为又进入输入状态了，不应再 flush）
            const focusHandler = () => {
                if (this._flushPendingRenderTimer) {
                    clearTimeout(this._flushPendingRenderTimer);
                    this._flushPendingRenderTimer = null;
                }
            };

            // focusin/focusout 是冒泡版的 focus/blur，能捕获所有后代元素
            window.addEventListener('focusout', blurHandler);
            window.addEventListener('focusin', focusHandler);
            // capture 级 blur/focus 兜底一次（防止 ShadowRoot / 特殊组件中断冒泡）
            window.addEventListener('blur', blurHandler, true);
            window.addEventListener('focus', focusHandler, true);
            this._editableFocusListenerBound = true;
        } catch (e) { console.warn('[EditableFocus] 绑定失败（不影响游戏）:', e); }
    }

    /**
     * 判断：当前 document.activeElement 是否是「用户正在交互的可编辑元素」
     *   - 若是：不能做任何 innerHTML 级别的 DOM 重建，否则输入法闪退 / 正在打的字消失 / 页面弹出被收起
     *   - 规则：
     *       (1) INPUT (除了 button/reset/submit/file/checkbox/radio 等不可打字类型)
     *       (2) TEXTAREA
     *       (3) 任何元素带 contenteditable="true" / contenteditable=""
     *       (4) 元素必须在 DOM 中（document.contains）且可见（offsetParent!==null，避免离屏隐藏的 input 被误判
     */
    _isEditableFocused() {
        try {
            const ae = (typeof document !== 'undefined') ? document.activeElement : null;
            if (!ae || ae === document.body) return false;
            if (!document.contains(ae)) return false; // 已被移除的节点不再算
            // 隐藏元素（display:none / 被父元素隐藏）不需要保护，可能恰好是弹窗关闭了
            const hidden = (ae.offsetParent === null) && (ae.style && getComputedStyle(ae).display === 'none');
            if (hidden) return false;

            const tag = (ae.tagName || '').toUpperCase();
            if (tag === 'TEXTAREA') return true;
            if (tag === 'INPUT') {
                const t = (ae.getAttribute('type') || 'text').toLowerCase();
                // 排除「按钮/复选/文件/隐藏」等不需要打字的类型
                if (['button','submit','reset','checkbox','radio','file','hidden','image','range','color'].indexOf(t) >= 0) return false;
                return true; // text/number/tel/email/url/search/password/date/time/datetime-local/month/week 等全算
            }
            const ce = ae.getAttribute && ae.getAttribute('contenteditable');
            if (ce === 'true' || ce === '') return true;
            return false;
        } catch (e) { return false; }
    }

    /**
     * 获取指定品质等级的商品图片（使用商品分类系统确保图片唯一性）
     * @param {string} productId - 商品ID
     * @param {string} grade - 品质等级 'A'|'B'|'C'，默认'B'
     * @returns {string} 图片dataURI
     */
    getProductImage(productId, grade = 'B') {
        try {
            if (typeof ProductClassifier !== 'undefined') {
                const img = ProductClassifier.getProductImage(productId, grade);
                if (img) return img;
            }
        } catch (e) {
            try { console.warn('[getProductImage]', productId, e && e.message); } catch (_) {}
        }
        // 降级：使用商品默认图片
        try {
            const product = (typeof PRODUCTS !== 'undefined') ? PRODUCTS.find(p => p.id === productId) : null;
            return product ? (product.image || '') : '';
        } catch (_) {
            return '';
        }
    }

    /**
     * 列表缩略图专用轻量图：无高斯模糊滤镜的 SVG，真机重绘开销大幅下降。
     * 仅用于列表/卡片小图（50px 级）；弹窗大图仍走 getProductImage 完整版。
     * 任何异常自动回退完整版，保证列表永远有图。
     */
    getProductImageLite(productId, grade = 'B') {
        try {
            if (typeof ProductClassifier !== 'undefined' && typeof ProductClassifier.getProductImageLite === 'function') {
                const img = ProductClassifier.getProductImageLite(productId, grade);
                if (img) return img;
            }
        } catch (e) {
            try { console.warn('[getProductImageLite]', productId, e && e.message); } catch (_) {}
        }
        return this.getProductImage(productId, grade);
    }

    render() {
        // ===== 输入框焦点保护 BUG FIX：render() 自身兜底 =====
        // 任何地方（包括 blur handler 延迟 flush / 手动调用 ui.render）在执行重建前，
        // 如果此时用户又把焦点放到了可编辑元素，就直接把本次渲染挂起为 pendingRender，不做 DOM 重建
        // 作用：防止用户点取消/提交按钮、或 Tab 切框时，render 被直接调用导致下一个输入框刚得到的焦点被销毁。
        if (this._isEditableFocused()) {
            this.pendingRender = true;
            // 但顶栏时间/资金仍要实时更新（不能全挂起不做任何事，否则外面看着时间/钱不动以为卡死了）
            try {
                const state = gameState.state;
                this.updateHeaderTime(state);
                const fundsEl = this._headerFundsEl || document.getElementById('headerFunds');
                if (fundsEl) {
                    this._headerFundsEl = fundsEl;
                    const target = state.shop.funds;
                    // 输入框挂起期间：直接跳到目标值（跳过插值动画，保证值可见）
                    this._interpFunds = target;
                    this._targetFunds = target;
                    const debtInfo = (typeof gameState !== 'undefined' && gameState && typeof gameState.getDebtInfo === 'function')
                        ? gameState.getDebtInfo()
                        : null;
                    this._renderFundsDisplay(fundsEl, target, debtInfo);
                    fundsEl.dataset.target = String(target);
                }
            } catch (e) { /* 忽略 */ }
            return;
        }

        const state = gameState.state;
        this.saveScrollPosition();
        
        // 始终确保底部导航被渲染（防止初始化时序问题导致导航丢失）
        this.renderBottomNav();
        this.lastPage = this.currentPage;
        
        this.renderHeader(state);
        
        const container = document.getElementById('mainContainer');
        const isPageChange = this._lastRenderedPage !== this.currentPage;
        const savedScrollTop = this.scrollPositions[this.currentPage];
        
        if (!isPageChange && container) {
            // 非页面切换时：锁定当前高度 + 同步替换内容 + 双帧校正，防止DOM重建导致塌陷跳动
            const currentHeight = container.offsetHeight;
            container.style.minHeight = currentHeight + 'px';
            
            this.renderPage(state);
            
            // 【关键修复：下滑回弹】用户最近300ms内有滚动行为时，不强制恢复到旧位置
            // 避免节流渲染保存了中间旧值，再把用户强行拉回上面
            const USER_SCROLLING_WINDOW = 300; // ms
            const userIsScrolling = this._lastScrollTime
                && (Date.now() - this._lastScrollTime) < USER_SCROLLING_WINDOW;
            // 立即恢复滚动（点击后短时间内不恢复，避免刚点完就跳）
            const shouldRestoreScroll = (!this._suppressScrollUntil || Date.now() >= this._suppressScrollUntil)
                && !userIsScrolling;
            if (shouldRestoreScroll && savedScrollTop !== undefined) {
                container.scrollTop = savedScrollTop;
            }
            
            // 双帧解锁高度：确保浏览器完成布局后释放锁定
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    container.style.minHeight = '';
                    // 解锁后再校正一次滚动位置（同样尊重用户正在滚动的状态）
                    const stillScrolling = this._lastScrollTime
                        && (Date.now() - this._lastScrollTime) < USER_SCROLLING_WINDOW;
                    if (!stillScrolling && shouldRestoreScroll && savedScrollTop !== undefined && container) {
                        container.scrollTop = savedScrollTop;
                    }
                });
            });
        } else {
            // 页面切换时正常渲染
            this.renderPage(state);
            this.restoreScrollPosition();
        }
        
        this.lastState = this.getStateHash(state);
        this._lastFullRenderAt = Date.now();
        this._preferHeaderOnlyUpdate = false;

        // ========== 整页重建后：仅在顶栏 DOM 被替换时清空缓存节点引用 ==========
        if (this._headerRebuiltThisRender) {
            this._headerTimeEl = null;
            this._headerFundsEl = null;
        }
        if (this._newbieGuideActive) {
            requestAnimationFrame(() => this._layoutNewbieCoach());
        }
    }

    saveScrollPosition() {
        const container = document.getElementById('mainContainer');
        if (container) {
            this.scrollPositions[this.currentPage] = container.scrollTop;
        }
    }

    restoreScrollPosition() {
        // 点击后150ms内不恢复滚动，避免刚点完就跳
        if (this._suppressScrollUntil && Date.now() < this._suppressScrollUntil) return;
        // 下滑回弹修复：用户最近300ms内正在滑动时，不强制恢复，避免被拉回
        if (this._lastScrollTime && (Date.now() - this._lastScrollTime) < 300) return;
        
        const container = document.getElementById('mainContainer');
        const target = this.scrollPositions[this.currentPage];
        if (!container || target === undefined) return;
        
        container.scrollTop = target;
        // 双帧恢复：第一帧浏览器完成布局后再校正一次，彻底消除跳动
        requestAnimationFrame(() => {
            if (container) container.scrollTop = target;
            requestAnimationFrame(() => {
                if (container) container.scrollTop = target;
            });
        });
    }
    
    /** 当前是否处于用户交互保护期（点击/弹窗操作） */
    _isUserInteracting() {
        return !!(this._interactionUntil && Date.now() < this._interactionUntil);
    }

    /** 订单负载是否足以触发「点击不强制整页刷新」 */
    _isHeavyOrderLoad() {
        try {
            const n = (gameState && gameState.state && gameState.state.orders)
                ? gameState.state.orders.length : 0;
            return n >= 400;
        } catch (_) {
            return false;
        }
    }

    /** 不重建整页时，原地改首页数字 / 订单 Tab 角标 */
    _patchLiveStats(state) {
        if (!state) return;
        const c = this._countOrders(state);
        const setTxt = (id, val) => {
            const el = document.getElementById(id);
            if (!el) return;
            const t = String(val == null ? '' : val);
            if (el.textContent !== t) el.textContent = t;
        };
        setTxt('dashStatPendingPay', c.pendingPayment);
        setTxt('dashStatPendingPack', c.pendingPacking);
        setTxt('dashStatPendingShip', c.pendingShip);
        setTxt('dashStatTodayOrders', c.todayOrders);
        let po = 0;
        const pos = state.purchaseOrders || [];
        for (let i = 0; i < pos.length; i++) {
            if (pos[i] && pos[i].status !== 'received') po++;
        }
        setTxt('dashStatPurchase', po);
        if (state.statistics) setTxt('dashStatViews', state.statistics.totalViews);
        if (state.shop) {
            setTxt('dashStatTotalOrders', state.shop.totalOrders);
            setTxt('dashStatTotalSales', state.shop.totalSales);
            const r = (typeof state.shop.rating === 'number' ? state.shop.rating : 5).toFixed(1);
            setTxt('dashStatShopRating', '⭐ ' + r);
        }
        const countMap = {
            pending_payment: c.pendingPayment,
            pending_packing: c.pendingPacking,
            pending_shipment: c.pendingShip,
            shipped: c.shipped,
            completed: c.completed,
            cancelled: c.cancelled,
            all: c.all
        };
        const badges = document.querySelectorAll('#mainContainer [data-order-count]');
        for (let i = 0; i < badges.length; i++) {
            const key = badges[i].getAttribute('data-order-count');
            if (key && countMap[key] != null) {
                const t = String(countMap[key]);
                if (badges[i].textContent !== t) badges[i].textContent = t;
            }
        }
    }

    // 手指按下即进入保护：在 click 到达前绝不能整页重建，否则按钮被拆掉会「点了没反应」
    _markJustClicked() {
        const now = Date.now();
        this._suppressScrollUntil = now + 220;
        this._clickBurstUntil = now + 520;
        this._interactionUntil = now + 900;
        if (this.renderThrottleTimer) {
            clearTimeout(this.renderThrottleTimer);
            this.renderThrottleTimer = null;
        }
        this.pendingRender = true;
        this._schedulePostClickRender(380);
    }

    /** 全局捕获按下：任意按钮/格子都能挡住 tick 刷页 */
    _bindTapGuard() {
        if (this._tapGuardBound) return;
        this._tapGuardBound = true;
        const self = this;
        const onDown = function (e) {
            try {
                const t = e && e.target;
                if (!t || !t.closest) return;
                if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
                if (t.closest('button, a, .btn, .nav-item, .tab-item, .speed-btn, .grid-item, .stat-item, [onclick], [role="button"]')) {
                    self._markJustClicked();
                }
            } catch (_) {}
        };
        document.addEventListener('pointerdown', onDown, { capture: true, passive: true });
        document.addEventListener('touchstart', onDown, { capture: true, passive: true });
        document.addEventListener('mousedown', onDown, { capture: true, passive: true });
    }

    _schedulePostClickRender(delayMs) {
        if (this._postClickRenderTimer) {
            clearTimeout(this._postClickRenderTimer);
            this._postClickRenderTimer = null;
        }
        const wait = Math.max(80, delayMs || 300);
        this._postClickRenderTimer = setTimeout(() => {
            this._postClickRenderTimer = null;
            if (this._isUserInteracting()) {
                this._schedulePostClickRender(120);
                return;
            }
            if (!this.pendingRender) return;
            this.pendingRender = false;
            try { this.throttledRender(); } catch (e) { console.warn('[post-click-render]', e); }
        }, wait);
    }

    /** 控件点击：扩大防抖窗口 + 轻触反馈；不 preventDefault，避免 WebView 把这次点击吞掉 */
    _onControlClick(e) {
        try {
            if (e && e.stopPropagation) e.stopPropagation();
        } catch (_) {}
        this._markJustClicked();
        try {
            const t = e && (e.currentTarget || e.target);
            if (t && t.classList) {
                t.classList.remove('tap-flash');
                t.classList.add('tap-flash');
                setTimeout(() => { try { t.classList.remove('tap-flash'); } catch (_) {} }, 180);
            }
        } catch (_) {}
    }

    _togglePauseEasy() {
        try {
            const wasPaused = gameState.isPaused();
            gameState.togglePause();
            const nowPaused = gameState.isPaused();
            // 从暂停→继续：先缓冲，避免瞬间 tick+整页刷新卡爆
            if (wasPaused && !nowPaused) {
                try {
                    if (typeof gameEngine !== 'undefined' && gameEngine && typeof gameEngine.onResumedFromPause === 'function') {
                        gameEngine.onResumedFromPause();
                    }
                } catch (_) {}
                this._preferHeaderOnlyUpdate = true;
                this._interactionUntil = Date.now() + 900;
            }
            gameState.notify();
            this._updatePauseVisualFeedback(true);
            this._syncMainContainerOffset(true);
            this.showToast(nowPaused ? '已暂停' : '已恢复', 700);
        } catch (err) {
            console.warn('[pause]', err);
        }
    }

    togglePause() {
        const wasPaused = gameState.isPaused();
        const result = gameState.togglePause();
        if (wasPaused && !result) {
            try {
                if (typeof gameEngine !== 'undefined' && gameEngine && typeof gameEngine.onResumedFromPause === 'function') {
                    gameEngine.onResumedFromPause();
                }
            } catch (_) {}
            this._preferHeaderOnlyUpdate = true;
            this._interactionUntil = Date.now() + 900;
        }
        try { gameState.notify(); } catch (e) {}
        this._updatePauseVisualFeedback(true);
        return result;
    }

    _updatePauseVisualFeedback(force) {
        try {
            const isPaused = gameState.isPaused();
            const lastKey = `_pauseVisual_${isPaused ? 'paused' : 'running'}`;
            if (!force && this._lastPauseVisualKey === lastKey) return;
            this._lastPauseVisualKey = lastKey;
            const pauseBtn = document.getElementById('pauseBtn')
                || (document.getElementById('topHeader') || document.getElementById('header') || document)
                    .querySelector('.pause-btn');
            if (pauseBtn) {
                if (isPaused) {
                    pauseBtn.classList.add('paused-active');
                    pauseBtn.innerHTML = '▶';
                    pauseBtn.setAttribute('title', '点击恢复');
                } else {
                    pauseBtn.classList.remove('paused-active');
                    pauseBtn.innerHTML = '⏸';
                    pauseBtn.setAttribute('title', '点击暂停');
                }
            }
            const headerTime = document.getElementById('headerTime');
            if (headerTime) {
                if (isPaused) {
                    headerTime.style.color = '#ff6b6b';
                    headerTime.style.fontWeight = '700';
                } else {
                    headerTime.style.color = '';
                    headerTime.style.fontWeight = '';
                }
            }
            // 暂停/恢复时同步跳一天按钮的禁用态（暂停不可跳天）
            try { this.refreshSkipDayBtn(); } catch (_) {}
        } catch (e) {
            console.warn('[ui] _updatePauseVisualFeedback error:', e);
        }
    }

    // 单次遍历全量orders统计各状态计数（共享给getStateHash/renderDashboard/renderOrdersPage，避免各自统计造成数据不一致）
    // statusHash: 所有可见订单的id+status拼接签名，确保状态流转时缓存能正确失效（修复同一小时内数量不变但状态变导致的一高一低）
    _countOrders(state) {
        const orders = state.orders || [];
        const n = orders.length;
        const today = state.gameTime.day;
        // ===== 性能：脏标记 / 引用未变时直接返回缓存，避免每帧 O(n) 全表扫描 =====
        if (this._cachedCounts
            && this._countOrdersRef === orders
            && this._countOrdersLen === n
            && this._countOrdersDay === today
            && this._countOrdersDirty !== true) {
            return this._cachedCounts;
        }
        // OrderPerf 增量计数：O(1)；byStatus 是 Map，禁止用 by[st]
        try {
            if (typeof OrderPerf !== 'undefined' && OrderPerf.enabled && OrderPerf.getTabCounts) {
                OrderPerf.ensure(orders);
                if (!OrderPerf.dirty && OrderPerf.ordersRef === orders) {
                    const result = OrderPerf.getTabCounts(orders, today);
                    this._cachedCounts = result;
                    this._countOrdersRef = orders;
                    this._countOrdersLen = n;
                    this._countOrdersDay = today;
                    this._countOrdersDirty = false;
                    return result;
                }
            }
        } catch (_) {}

        let statusParts = '';
        let pendingPayment = 0, pendingPacking = 0, pendingShip = 0, shipped = 0, completed = 0, cancelled = 0;
        let totalVisible = 0, todayOrders = 0;
        // ===== _countOrders性能优化：当订单量很大时，签名不再逐字拼接每一个订单，用近似哈希 + 两端抽样 =====
        const LARGE_ORDER_THRESHOLD = 1500;
        let fastHash = 0;
        let sampleChunk = '';
        let visibleIdx = 0;
        for (let i = 0; i < n; i++) {
            const o = orders[i];
            if (!o) continue;
            const st = o.status;
            // 已完成/已取消即使 hidden（不进「全部」），角标仍要计数，否则 Tab 一直显示 0
            if (o.hidden) {
                if (st === 'completed') completed++;
                else if (st === 'cancelled') cancelled++;
                continue;
            }
            totalVisible++;
            visibleIdx++;
            if (n < LARGE_ORDER_THRESHOLD) {
                statusParts += (o.id || '') + '|' + st + ';';
            } else {
                const id = o.id || '';
                const idTail = id.length > 6 ? id.slice(-6) : id;
                for (let k = 0; k < idTail.length; k++) {
                    fastHash = ((fastHash << 5) + fastHash) ^ idTail.charCodeAt(k);
                }
                fastHash = ((fastHash << 5) + fastHash) ^ (st ? st.charCodeAt(0) : 0);
                if (visibleIdx <= 24) sampleChunk += idTail + st;
            }
            if (o.createTime && o.createTime.day === today) todayOrders++;
            switch (st) {
                case 'pending_payment': pendingPayment++; break;
                case 'pending_packing': pendingPacking++; break;
                case 'pending_shipment': pendingShip++; break;
                case 'shipped': shipped++; break;
                case 'completed': completed++; break;
                case 'cancelled': cancelled++; break;
            }
        }
        if (n >= LARGE_ORDER_THRESHOLD) {
            statusParts = 'h' + (fastHash >>> 0).toString(16) + 's' + sampleChunk.length + '_' + sampleChunk;
        }
        const result = {
            pendingPayment: pendingPayment,
            pendingPacking: pendingPacking,
            pendingShip: pendingShip,
            shipped: shipped,
            completed: completed,
            cancelled: cancelled,
            all: totalVisible,
            totalVisible: totalVisible,
            todayOrders: todayOrders
        };
        this._cachedCounts = result;
        this._countOrdersRef = orders;
        this._countOrdersLen = n;
        this._countOrdersDay = today;
        this._countOrdersDirty = false;
        this._lastCountsStatusParts = statusParts;
        return result;
    }

    /** 订单增删改后重算 UI 计数缓存；不打脏 OrderPerf（索引由 onAdded/onStatusChanged 增量维护） */
    invalidateOrderCounts() {
        this._countOrdersDirty = true;
        this._cachedCounts = null;
    }

    getStateHash(state) {
        const c = this._countOrders(state);
        const consultations = (state.customerService && state.customerService.consultations) || [];
        // 大订单：客服待处理用长度抽样，避免每帧 filter 全表
        let pendingCS = 0;
        if (consultations.length <= 80) {
            pendingCS = consultations.filter(x => x.status === 'pending').length;
        } else {
            let sample = 0;
            for (let i = 0; i < consultations.length; i++) {
                if (consultations[i] && consultations[i].status === 'pending') sample++;
            }
            pendingCS = sample;
        }
        const purchaseOrders = (state.purchaseOrders || []).filter(o => o.status !== 'received').length;

        // 仓储字段：大订单下缓存 1.5s，避免每帧算容量
        let whLevel = 1, whUsed = 0, whCapacity = 100000;
        const nowMs = Date.now();
        const heavy = ((state.orders && state.orders.length) || 0) >= 400;
        if (heavy && this._whHashCache && (nowMs - (this._whHashCacheAt || 0)) < 1500) {
            whLevel = this._whHashCache.whLevel;
            whUsed = this._whHashCache.whUsed;
            whCapacity = this._whHashCache.whCapacity;
        } else {
            try {
                const whMod = (typeof window !== 'undefined' && window.warehouseState)
                    || (typeof warehouseState !== 'undefined' ? warehouseState : null)
                    || (typeof gameState !== 'undefined' && gameState && gameState.warehouse)
                    || null;
                if (whMod && whMod.state) {
                    whLevel = whMod.state.level || 1;
                    if (typeof whMod.getUsedCapacity === 'function') whUsed = whMod.getUsedCapacity();
                    if (typeof whMod.getCapacity === 'function') whCapacity = whMod.getCapacity();
                } else if (typeof gameState !== 'undefined' && gameState) {
                    whLevel = gameState.getWarehouseLevel?.() || state.warehouse?.level || 1;
                    whUsed = gameState.getUsedCapacity?.() || 0;
                    whCapacity = gameState.getWarehouseCapacity?.() || 100000;
                } else if (state.warehouse) {
                    whLevel = state.warehouse.level || 1;
                    whCapacity = state.warehouse.capacity || 100000;
                    whUsed = state.warehouse.usedCapacity || state.warehouse.used || 0;
                }
            } catch (e) { /* ignore */ }
            this._whHashCache = { whLevel, whUsed, whCapacity };
            this._whHashCacheAt = nowMs;
        }

        return {
            time: `${state.gameTime.day}-${state.gameTime.hour}`,
            isPaused: !!(state.gameTime && state.gameTime.isPaused),
            speed: state.gameTime.speed || 1,
            funds: state.shop.funds,
            orders: c.totalVisible,
            inventory: state.inventory.length,
            listings: state.listings.length,
            reputation: state.shop.reputation,
            level: state.shop.level,
            pendingPayment: c.pendingPayment,
            pendingPacking: c.pendingPacking,
            pendingShip: c.pendingShip,
            pendingCS: pendingCS,
            purchaseOrders: purchaseOrders,
            totalViews: state.statistics.totalViews,
            totalSales: state.shop.totalSales,
            rating: (typeof state.shop.rating === 'number' ? state.shop.rating : 5).toFixed(1),
            employees: state.employees.length,
            // ===== 120Hz/仓库升级：新增仓储字段捕获变化 =====
            whLevel,
            whUsed,
            whCapacity
        };
    }

    isOnlyTimeChanged(state) {
        if (!this.lastState) return false;
        const hash = this.getStateHash(state);
        return hash.time !== this.lastState.time &&
               hash.isPaused === this.lastState.isPaused &&
               hash.speed === this.lastState.speed &&
               hash.funds === this.lastState.funds &&
               hash.orders === this.lastState.orders &&
               hash.inventory === this.lastState.inventory &&
               hash.listings === this.lastState.listings &&
               hash.reputation === this.lastState.reputation &&
               hash.level === this.lastState.level &&
               hash.pendingPayment === this.lastState.pendingPayment &&
               hash.pendingPacking === this.lastState.pendingPacking &&
               hash.pendingShip === this.lastState.pendingShip &&
               hash.pendingCS === this.lastState.pendingCS &&
               hash.purchaseOrders === this.lastState.purchaseOrders &&
               hash.totalViews === this.lastState.totalViews &&
               hash.totalSales === this.lastState.totalSales &&
               hash.rating === this.lastState.rating &&
               hash.employees === this.lastState.employees &&
               // ===== 120Hz/仓库升级：仓储字段也必须一致，否则触发整页刷新（九宫格跳动） =====
               hash.whLevel === this.lastState.whLevel &&
               hash.whCapacity === this.lastState.whCapacity &&
               hash.whUsed === this.lastState.whUsed;
    }

    smartUpdate(state) {
        const hasPrivacy = !!document.getElementById('privacyOverlay') &&
                           !document.getElementById('privacyOverlay').classList.contains('hidden');

        // 隐私协议弹窗是全屏覆盖层，刷新可能会重绘其下方的页面，保守跳过
        if (hasPrivacy) {
            this.updateHeaderTime(state);
            this.lastState = this.getStateHash(state);
            return;
        }

        // ===== 输入框焦点保护 BUG FIX：活动命名/自定义文本输入唤起输入法闪退 =====
        // 只要用户焦点在 INPUT/TEXTAREA/contenteditable 上（包括移动端刚唤起输入法），就不做任何 innerHTML 重建整页，
        // 否则会把正在打字的 input 节点从 DOM 中移除 → 输入法被强制收起（闪退）/ 还没提交的字被清空 → 最终无法创建活动。
        // 策略：将本次渲染挂起为 pendingRender，只更新顶部时间/资金两个文本节点，等用户失焦(blur)后立即补跑完整渲染
        if (this._isEditableFocused()) {
            this.pendingRender = true;
            try { this.updateHeaderTime(state); } catch (e) {}
            // 尝试只更新资金节点（若存在），保证外面看钱的变化是实时的
            try {
                const fundsEl = this._headerFundsEl || document.getElementById('headerFunds');
                if (fundsEl) {
                    this._headerFundsEl = fundsEl;
                    const target = state.shop.funds;
                    if (this._interpFunds === null || this._targetFunds === null || !isFinite(this._interpFunds)) this._interpFunds = target;
                    this._targetFunds = target;
                    const debtInfo = (typeof gameState !== 'undefined' && gameState && typeof gameState.getDebtInfo === 'function')
                        ? gameState.getDebtInfo()
                        : null;
                    this._renderFundsDisplay(fundsEl, target, debtInfo);
                    fundsEl.dataset.target = String(target);
                }
            } catch (e) {}
            this.lastState = this.getStateHash(state);
            return;
        }

        // 普通Modal（如仓储管理中心、员工管理）是独立DOM挂在body上，
        // render()只重绘mainContainer，不影响Modal，因此正常走刷新逻辑。
        // 这样用户在Modal里执行升级/入库/采购包材后，外面九宫格能同步跳动。
        if (this.isOnlyTimeChanged(state)) {
            this.updateHeaderTime(state);
            this.lastState = this.getStateHash(state);
        } else {
            this.lastState = this.getStateHash(state);
            const now = Date.now();
            const inBurst = this._clickBurstUntil && now < this._clickBurstUntil;
            const interacting = this._isUserInteracting();

            // ===== 运行中大订单：tick 触发时优先只刷顶栏（暂停就不卡的根因对侧）=====
            if (this._preferHeaderOnlyUpdate) {
                this._preferHeaderOnlyUpdate = false;
                if (!interacting) {
                    try { this.updateHeaderTime(state); } catch (_) {}
                    try {
                        const fundsEl = this._headerFundsEl || document.getElementById('headerFunds');
                        if (fundsEl) {
                            this._headerFundsEl = fundsEl;
                            const target = state.shop.funds;
                            this._interpFunds = target;
                            this._targetFunds = target;
                            const debtInfo = (typeof gameState !== 'undefined' && gameState && typeof gameState.getDebtInfo === 'function')
                                ? gameState.getDebtInfo() : null;
                            this._renderFundsDisplay(fundsEl, target, debtInfo);
                            fundsEl.dataset.target = String(target);
                        }
                    } catch (_) {}
                    this.pendingRender = true;
                    try { this._patchLiveStats(state); } catch (_) {}
                    return;
                }
            }

            // 点击/按下保护期：任何规模都只刷顶栏数字，等松手后再整页重建
            if (inBurst || interacting) {
                try { this.updateHeaderTime(state); } catch (_) {}
                try { this._patchLiveStats(state); } catch (_) {}
                this.pendingRender = true;
                this._schedulePostClickRender(Math.max(120, (this._interactionUntil || now) - now + 40));
                return;
            }
            this.throttledRender();
        }
    }

    // 根据当前游戏数据规模 + 当前FPS + 慢渲染熔断 动态计算节流时间，越玩到后期自动越少重建整页DOM
    _getDynamicThrottleMs(state) {
        const orders = state && state.orders ? state.orders.length : 0;
        const employees = state && state.employees ? state.employees.length : 0;
        const listings = state && state.listings ? state.listings.length : 0;
        const shopLv = (state && state.shop && state.shop.level) || 1;
        const members = (state && state.members && state.members.list) ? state.members.list.length : 0;
        const scale = orders + employees * 3 + listings + Math.floor(members / 10) + shopLv * 80;
        const fps = (typeof gameEngine !== 'undefined' && gameEngine.fps) ? gameEngine.fps : 60;

        let base;
        if (scale < 200)   base = 320;        // 游戏初期：流畅但不每跳整页重建
        else if (scale < 1000) base = 480;    // 中期：平衡
        else if (scale < 2500) base = 720;    // 后期：减少重建
        else if (scale < 5000) base = 1000;   // 二心/爆单前期
        else if (scale < 12000) base = 1400;  // 爆单阶段
        else                      base = 1800;// 极爆：优先保逻辑
        try {
            if (typeof gameState !== 'undefined' && gameState && typeof gameState.isPaused === 'function' && !gameState.isPaused()) {
                base += 80;
            }
        } catch (_) {}

        // 弹窗打开时进一步加大节流，避免点包装/采购时整页狂刷导致「点啥卡成别的」
        try {
            const modalOpen = !!(document.querySelector('.modal-overlay:not(.hidden)')
                || document.querySelector('.modal.show'));
            if (modalOpen) base = Math.max(base, Math.round(base * 1.6));
        } catch (_) {}

        // FPS 保护：掉帧时再提一档（翻倍节流时间，保证CPU分给逻辑）
        if (fps < 30 && base < 1500) base = Math.round(base * 1.8);
        else if (fps < 20 && base < 2000) base = Math.round(base * 2.2);
        else if (fps < 12) base = Math.max(1500, base);

        // ========== 慢渲染熔断：连续 2 次 render 超过 40ms，额外 ×2 节流 ==========
        if ((this._slowRenderCount || 0) >= 2) base = Math.min(2800, Math.round(base * 2));

        return base;
    }

    throttledRender() {
        // ===== 输入框焦点保护 BUG FIX：正在打字时不重建DOM，把渲染挂起 =====
        if (this._isEditableFocused()) {
            this.pendingRender = true;
            return;
        }

        // ===== 点击突发期：一律挂起整页，等交互窗结束 =====
        const now = Date.now();
        if ((this._clickBurstUntil && now < this._clickBurstUntil) || this._isUserInteracting()) {
            this.pendingRender = true;
            this._schedulePostClickRender(Math.max(120, (this._interactionUntil || now) - now + 40));
            return;
        }
        if (this.renderThrottleTimer) {
            this.pendingRender = true;
            return;
        }

        // ===== 掉帧+爆单 紧急保护：距离上次整页渲染时间不足动态节流时间的一半 → 直接挂起不刷 =====
        const state = gameState && gameState.state;
        const scale = state ? ((state.orders ? state.orders.length : 0) + (state.employees ? state.employees.length : 0) * 3 + (state.listings ? state.listings.length : 0)) : 0;
        const fps = (typeof gameEngine !== 'undefined' && gameEngine.fps) ? gameEngine.fps : 60;
        const throttleMs = this._getDynamicThrottleMs(state);
        if (this._lastRenderFinishedAt && scale >= 4000) {
            const sinceLast = now - this._lastRenderFinishedAt;
            const emergencyThreshold = Math.round(throttleMs * (fps < 20 ? 0.9 : fps < 30 ? 0.75 : 0.5));
            if (sinceLast < emergencyThreshold) {
                this.pendingRender = true;
                this.renderThrottleTimer = setTimeout(() => {
                    this.renderThrottleTimer = null;
                    if (this.pendingRender) {
                        this.pendingRender = false;
                        setTimeout(() => {
                            if (typeof window !== 'undefined') window._lastRenderStart = Date.now();
                            const t1 = performance.now();
                            try { this.render(); } catch (e) { console.warn('[throttled-emergency]', e); }
                            const t2 = performance.now();
                            this._recordRenderDuration(t2 - t1);
                            this._lastRenderFinishedAt = Date.now();
                        }, 0);
                    }
                }, emergencyThreshold);
                return;
            }
        }

        // ===== 正常路径：真正按动态节流等待，禁止 0ms 立刻整页重建 =====
        if (typeof window !== 'undefined') window._lastRenderStart = now;
        this.renderThrottleTimer = setTimeout(() => {
            this.renderThrottleTimer = null;
            const t1 = performance.now();
            try { this.render(); } catch (e) { console.warn('[throttled-render]', e); }
            const t2 = performance.now();
            this._recordRenderDuration(t2 - t1);
            this._lastRenderFinishedAt = Date.now();

            if (this.pendingRender) {
                this.pendingRender = false;
                const throttleNext = this._getDynamicThrottleMs(gameState && gameState.state);
                this.renderThrottleTimer = setTimeout(() => {
                    this.renderThrottleTimer = null;
                    const t3 = performance.now();
                    try { this.render(); } catch (e) { console.warn('[throttled-render-delay]', e); }
                    const t4 = performance.now();
                    this._recordRenderDuration(t4 - t3);
                    this._lastRenderFinishedAt = Date.now();
                }, throttleNext);
            }
        }, Math.max(80, throttleMs));
    }

    /**
     * 记录每次整页 DOM 重建耗时，做「熔断保护」
     * 连续 2 次超过阈值，下一次节流时间翻倍（防止重建把 CPU 100% 占满）
     */
    _recordRenderDuration(ms) {
        const SLOW_RENDER_THRESHOLD = 40; // 单次 render 超过 40ms 判定为慢
        if (ms > SLOW_RENDER_THRESHOLD) {
            this._slowRenderCount = (this._slowRenderCount || 0) + 1;
            // 超过 80ms 才打告警（40ms 只是统计）
            if (ms > 80) console.warn('[RenderSlow] 整页重建耗时 ' + Math.round(ms) + 'ms，数据多后正常，将自动降频');
        } else {
            this._slowRenderCount = Math.max(0, (this._slowRenderCount || 0) - 1);
        }
        // ===== 主线程健康度上报：渲染阻塞时长同样计入 fps 信号（rAF 关闭时 fps 恒为 0 的修复）=====
        try {
            if (typeof gameEngine !== 'undefined' && gameEngine && typeof gameEngine._reportBlockMs === 'function') {
                gameEngine._reportBlockMs(ms);
            }
        } catch (_) {}
    }

    updateHeaderTime(state) {
        const timeEl = this._headerTimeEl || document.getElementById('headerTime');
        const fundsEl = this._headerFundsEl || document.getElementById('headerFunds');
        if (timeEl) this._headerTimeEl = timeEl;
        if (fundsEl) this._headerFundsEl = fundsEl;

        // 显示真实小时（08:00 整点跳），每帧平滑的分钟由_onHighRefreshFrame设置
        const isPaused = !!(state.gameTime && state.gameTime.isPaused);
        if (timeEl) {
            // ⭐ 时间系统 v2：显示"2026年8月1日 周六 第1天 08:00 ⏸"
            const baseFmt = (typeof GAME_formatGameTime === 'function')
                ? GAME_formatGameTime(state.gameTime, { showPaused: false, showSeason: true })
                : `第${state.gameTime.day}天 ${state.gameTime.hour.toString().padStart(2, '0')}:00`;
            // 暂停状态改由右侧暂停键表达，时间文本不再追加 ⏸，避免右上角误看成“小暂停键”
            timeEl.textContent = baseFmt;
            timeEl.dataset.baseHour = String(state.gameTime.hour);
            timeEl.dataset.baseDay = String(state.gameTime.day);
            timeEl.dataset.paused = isPaused ? '1' : '0';
            // 同步时间文字的暂停样式
            if (isPaused) {
                timeEl.style.color = '#ff6b6b';
                timeEl.style.fontWeight = '700';
            } else {
                timeEl.style.color = '';
                timeEl.style.fontWeight = '';
            }
        }

        // ========= 双保险：同步 speed-control 按钮组的 暂停/恢复 + 速度高亮 + 禁用态 =========
        // 即使只走 updateHeaderTime 分支（例如其他字段确实没变），按钮样式也是最新的
        try {
            const header = document.getElementById('topHeader');
            if (header) {
                const pauseBtn = header.querySelector('#pauseBtn, .pause-btn');
                if (pauseBtn) {
                    if (isPaused) {
                        pauseBtn.classList.add('paused-active');
                        pauseBtn.classList.remove('active');
                        pauseBtn.innerHTML = '▶';
                        pauseBtn.title = '点击恢复';
                    } else {
                        pauseBtn.classList.remove('paused-active');
                        pauseBtn.innerHTML = '⏸';
                        pauseBtn.title = '点击暂停';
                    }
                }
                // 1x / 4x 倍速按钮（不含暂停/跳天/存档）
                const speedBtns = header.querySelectorAll('.speed-control > .speed-btn:not(.pause-btn):not(.skip-day-btn):not(.save-status-light)');
                const curSpeed = state.gameTime.speed || 1;
                const speeds = [1, 4];
                for (let i = 0; i < speeds.length; i++) {
                    const btn = speedBtns[i];
                    if (!btn) continue;
                    if (curSpeed === speeds[i] && !isPaused) {
                        btn.classList.add('active');
                    } else {
                        btn.classList.remove('active');
                    }
                    if (isPaused) {
                        btn.setAttribute('disabled', 'true');
                        btn.style.opacity = '0.4';
                        btn.style.pointerEvents = 'none';
                    } else {
                        btn.removeAttribute('disabled');
                        btn.style.opacity = '';
                        btn.style.pointerEvents = '';
                    }
                }
            }
        } catch (e) {}

        // 资金：更新目标值，每帧做丝滑插值动画（真正写入DOM由统一函数 + rAF插值负责）
        const target = state.shop.funds;
        const now = performance.now();
        if (this._interpFunds === null || this._targetFunds === null || !isFinite(this._interpFunds)) {
            this._interpFunds = target;
        }
        this._targetFunds = target;
        this._lastFundsUpdateAt = now;
        if (fundsEl) {
            this._headerFundsEl = fundsEl;
            // ⭐ 统一渲染：只写目标值一次（幂等），保证欠款状态/结构正确性
            //    丝滑插值动画由 _onHighRefreshFrame 每帧调统一函数应用插值后的数值
            const debtInfo = (typeof gameState !== 'undefined' && gameState && typeof gameState.getDebtInfo === 'function')
                ? gameState.getDebtInfo()
                : null;
            this._renderFundsDisplay(fundsEl, target, debtInfo);
            fundsEl.dataset.target = String(target);
        }
    }

    // ============== 动态刷新率 每帧轻量更新（严格按订单3档：0单丝滑 / 1~100单适中 / >100单保守） ==============
    _onHighRefreshFrame(now, dt, progress, fps, rafInterval) {
        // ===== 档位判断（只看订单数，严格对齐引擎 evalScale 的3档规则） =====
        const orders = (gameState && gameState.state && gameState.state.orders) ? gameState.state.orders.length : 0;
        const tier0 = orders === 0;         // 0单 → 全开（90Hz档）
        const tier1 = orders > 0 && orders <= 100; // 1~100单 → 适中（30Hz档）
        const tier2 = orders > 100;         // >100单 → 保守（15Hz档）

        const fpsLow = fps && fps < 30;
        const fpsVeryLow = fps && fps < 20;
        const fpsCritical = fps && fps < 12;

        // 15Hz档且掉帧 → 再砍半跳过一半回调
        const extraSkipEnabled = tier2 && (rafInterval >= 4 || fpsCritical);
        if (extraSkipEnabled) {
            this._extraSkip = (this._extraSkip || 0) + 1;
            if ((this._extraSkip & 1) === 0) return;
        }

        // ========== 1) 虚拟分钟 DOM 写（90Hz档才丝滑，其余降级） ==========
        // 暂停时冻结虚拟分钟，避免「已暂停但时间还在跑」的错觉
        try {
            if (typeof gameState !== 'undefined' && gameState && typeof gameState.isPaused === 'function' && gameState.isPaused()) {
                progress = 0;
            }
        } catch (_) {}
        const vMinuteEnabled = tier0 && !fpsLow; // 有订单或掉帧时不写虚拟分钟，避免顶栏每秒刷几十次
        if (vMinuteEnabled) {
            const tEl = this._headerTimeEl || document.getElementById('headerTime');
            if (tEl) {
                this._headerTimeEl = tEl;
                let hour = parseInt(tEl.dataset.baseHour || '-1', 10);
                let day = parseInt(tEl.dataset.baseDay || '-1', 10);
                const paused = tEl.dataset.paused === '1';
                if (hour < 0 || day < 0) {
                    try {
                        const gt = (typeof gameState !== 'undefined' && gameState && gameState.state) ? gameState.state.gameTime : null;
                        if (gt) { hour = gt.hour; day = gt.day; }
                        else { hour = 0; day = 1; }
                    } catch (e) { hour = 0; day = 1; }
                }
                // 自动运行每跳 N 小时：仅在本跳分片推进中插值；空闲时显示真实整点，避免再往前虚加 12 小时
                let hoursPerTick = 1;
                let interpolating = false;
                try {
                    if (typeof gameEngine !== 'undefined' && gameEngine && gameEngine.hoursPerTick) {
                        hoursPerTick = Math.max(1, gameEngine.hoursPerTick | 0);
                    }
                    interpolating = !!(gameEngine && gameEngine._tickBusy) && progress > 0 && progress < 1;
                } catch (_) {}
                const span = interpolating ? (Math.min(0.999, Math.max(0, progress)) * hoursPerTick) : 0;
                const addH = Math.floor(span);
                let virtualMinute = Math.floor((span - addH) * 60);
                if (virtualMinute < 0) virtualMinute = 0;
                if (virtualMinute > 59) virtualMinute = 59;
                let displayHour = hour + addH;
                let displayDay = day;
                while (displayHour >= 24) {
                    displayHour -= 24;
                    displayDay++;
                }
                // 虚拟分钟按 5 分钟步长，避免 1 小时插值写出 60 次 DOM
                virtualMinute = Math.floor(virtualMinute / 5) * 5;
                if (tier0 && fpsVeryLow) virtualMinute = Math.floor(virtualMinute / 10) * 10;
                if (this._lastVMin !== virtualMinute || this._lastVHour !== displayHour || this._lastVDay !== displayDay || this._lastVPaused !== paused) {
                    this._lastVMin = virtualMinute;
                    this._lastVHour = displayHour;
                    this._lastVDay = displayDay;
                    this._lastVPaused = paused;
                    const minStr = virtualMinute.toString().padStart(2, '0');
                    const hourStr = displayHour.toString().padStart(2, '0');
                    // ⭐ 时间系统 v2：从当前 gameState 拿完整 gameTime 走统一格式化函数，带年月日+星期+季节+分钟
                    let display = '';
                    try {
                        const gt = (typeof gameState !== 'undefined' && gameState && gameState.state) ? gameState.state.gameTime : null;
                        if (gt && typeof GAME_formatGameTime === 'function') {
                            // 复用当前 gameTime 的真实年月日，仅替换 hour/minute/paused 显示
                            const fakeGt = Object.assign({}, gt, {
                                hour: parseInt(hourStr, 10),
                                day: displayDay,
                                isPaused: !!paused
                            });
                            display = GAME_formatGameTime(fakeGt, { minute: parseInt(minStr, 10), showPaused: false, showSeason: true });
                        } else {
                            display = `第${displayDay}天 ${hourStr}:${minStr}`;
                        }
                    } catch (e) {
                        display = `第${displayDay}天 ${hourStr}:${minStr}`;
                    }
                    if (tEl.firstChild && tEl.firstChild.nodeType === 3) {
                        tEl.firstChild.nodeValue = display;
                    } else {
                        tEl.textContent = display;
                    }
                }
            }
        }

        // ========== 2) 头部资金丝滑插值（>100单且掉帧→直接到目标值） ==========
        //      插值算法：按每秒固定比例接近目标  1 - 0.58^(dt/1000)
        //              + 方向保护（插值不能越过目标值）+ 超调硬截断（越界立即拉回）
        //      DOM 写入：通过 _renderFundsDisplay 统一入口，保证结构一致
        const fundsInterpEnabled = !(tier2 && fpsCritical);
        const fEl = this._headerFundsEl || document.getElementById('headerFunds');
        if (fEl) {
            this._headerFundsEl = fEl;
            if (this._targetFunds !== null && this._interpFunds !== null && isFinite(this._targetFunds) && isFinite(this._interpFunds)) {
                if (fundsInterpEnabled) {
                    const diff = this._targetFunds - this._interpFunds;
                    if (Math.abs(diff) > 0.001) {
                        // rafInterval 越大（回调被跳帧越多）→ 步长越大，保证整体过渡用时基本稳定
                        const stepFactor = Math.max(1, rafInterval || 1);
                        const effDt = Math.max(1, (dt || 16.6)) * stepFactor;
                        // 每秒比例：0.58^(effDt/1000)，clamp 到合理范围避免极端
                        let alpha = 1 - Math.pow(0.58, effDt / 1000);
                        if (!isFinite(alpha) || alpha < 0.02) alpha = 0.02;
                        else if (alpha > 0.85) alpha = 0.85;
                        const before = this._interpFunds;
                        this._interpFunds += diff * alpha;
                        // ===== 方向保护 + 超调硬截断 =====
                        // 方向：diff>0 说明要上涨，interp 不能超过 target；diff<0 说明要下跌，interp 不能低于 target
                        if (diff > 0 && this._interpFunds > this._targetFunds) this._interpFunds = this._targetFunds;
                        else if (diff < 0 && this._interpFunds < this._targetFunds) this._interpFunds = this._targetFunds;
                        // 数值超调硬截断：防止浮点累积产生极值
                        if (!isFinite(this._interpFunds)) this._interpFunds = this._targetFunds;
                        else if (this._interpFunds < -99999) this._interpFunds = -99999;
                        else if (this._interpFunds > 9e12) this._interpFunds = 9e12;
                        // 接近到 0.01 以内 → 直接到目标值，避免尾部浮点振荡
                        if (Math.abs(this._targetFunds - this._interpFunds) < 0.01) {
                            this._interpFunds = this._targetFunds;
                        }
                    }
                } else {
                    // 爆单+极掉帧：直接拉到目标值，省去每帧浮点运算
                    this._interpFunds = this._targetFunds;
                }
                // ⭐ DOM 写入：整数位（Math.round）变化才调用统一渲染函数（避免浮点噪声反复写DOM）
                //    统一渲染函数内部也有幂等缓存，这里是双重保险（减少 querySelector 等开销）
                const curInt = Math.round(this._interpFunds);
                if (curInt !== this._lastFundsDisplay) {
                    this._lastFundsDisplay = curInt;
                    const debtInfo = (typeof gameState !== 'undefined' && gameState && typeof gameState.getDebtInfo === 'function')
                        ? gameState.getDebtInfo()
                        : null;
                    this._renderFundsDisplay(fEl, this._interpFunds, debtInfo);
                }
            }
        }

        // 滚动位置由 scroll 监听保存，rAF 里不再每帧读 layout
    }

    renderHeader(state) {
        const header = document.getElementById('topHeader');
        if (!header) return;
        const level = SHOP_LEVELS.find(l => l.level === state.shop.level) || SHOP_LEVELS[0];
        const isPaused = !!(state.gameTime && state.gameTime.isPaused);
        const debtInfo = (typeof gameState !== 'undefined' && gameState && typeof gameState.getDebtInfo === 'function')
            ? gameState.getDebtInfo()
            : { inDebt: state.shop.funds < 0, debtAmount: Math.max(0, -state.shop.funds), funds: state.shop.funds, ratio: Math.min(1, Math.max(0, Math.abs(state.shop.funds < 0 ? state.shop.funds : 0) / 100000)) };

        const shopRatingStr = (typeof state.shop.rating === 'number' ? state.shop.rating : 5).toFixed(1);
        const canReuse = !!(header.querySelector('#headerTime') && header.querySelector('#headerFunds')
            && this._lastHeaderShopName === state.shop.name
            && this._lastHeaderShopLevel === state.shop.level
            && this._lastHeaderShopRating === shopRatingStr);
        if (canReuse) {
            this._headerRebuiltThisRender = false;
            this.updateHeaderTime(state);
            try { this.refreshSkipDayBtn(); } catch (_) {}
            return;
        }
        this._headerRebuiltThisRender = true;
        this._lastHeaderShopName = state.shop.name;
        this._lastHeaderShopLevel = state.shop.level;
        this._lastHeaderShopRating = shopRatingStr;

        // ⭐ 不再把资金内容作为 innerHTML 模板写入（避免与 updateHeaderTime/rAF 的 textContent 覆盖产生结构切换）
        //    改为：header.innerHTML 只创建空的 #headerFunds 容器，插入DOM后立即调用 _renderFundsDisplay 统一填充
        header.innerHTML = `
            <div class="header-row">
                <div class="shop-name">
                    ${state.shop.name}
                    <span class="badge" style="margin-left:6px;background:rgba(255,255,255,0.3);">${level.name}</span>
                    <span class="badge" style="margin-left:4px;background:rgba(255,193,7,0.35);" title="店铺评分">⭐ ${(typeof state.shop.rating === 'number' ? state.shop.rating : 5).toFixed(1)}</span>
                </div>
                <div class="time-display">
                    <span id="headerTime" style="${isPaused ? 'color:#ff6b6b;font-weight:700;' : ''}">${(typeof GAME_formatGameTime === 'function') ? GAME_formatGameTime(state.gameTime, { showPaused: false, showSeason: true }) : `第${state.gameTime.day}天 ${state.gameTime.hour.toString().padStart(2, '0')}:00`}</span>
                </div>
            </div>
            <div class="header-row buttons-row">
                <div class="speed-control header-controls-bar">
                    <!-- 暂停：最左侧大热区，优先可点 -->
                    <button id="pauseBtn" type="button" class="speed-btn pause-btn tap-feedback ${isPaused ? 'paused-active' : ''}" 
                            title="${isPaused ? '点击恢复' : '点击暂停'}"
                            onpointerdown="event.stopPropagation();ui._markJustClicked()"
                            onclick="event.preventDefault();event.stopPropagation();ui._onControlClick(event);ui._togglePauseEasy();">
                        ${isPaused ? '▶' : '⏸'}
                    </button>
                    <button type="button" class="speed-btn tap-feedback ${state.gameTime.speed === 1 && !isPaused ? 'active' : ''}" 
                            ${isPaused ? 'disabled style="opacity:0.4;"' : ''}
                            onclick="ui._onControlClick(event);if(!gameState.isPaused())gameEngine.setSpeed(1)">1x</button>
                    <button type="button" class="speed-btn tap-feedback ${state.gameTime.speed === 4 && !isPaused ? 'active' : ''}" 
                            ${isPaused ? 'disabled style="opacity:0.4;"' : ''}
                            onclick="ui._onControlClick(event);if(!gameState.isPaused())gameEngine.setSpeed(4)">4x</button>
                    <div class="funds header-funds-inline" id="headerFunds"></div>
                    <button id="skipDayBtn" type="button" class="speed-btn skip-day-btn tap-feedback" 
                            ${isPaused ? 'disabled style="opacity:0.4;"' : ''}
                            title="${isPaused ? '时间已暂停，点击 ▶ 恢复后才能跳天' : `直接跳过一整天（会完整生成所有订单、执行每日结算）· 剩余 ${(typeof gameState.getSkipDayQuota === 'function' ? gameState.getSkipDayQuota() : 0)} 次，用尽可看广告+5 或花1000万买1次`}"
                            onclick="ui._onControlClick(event);if(this.disabled)return;ui.requestSkipDay();">${this.getSkipDayBtnLabel()}</button>
                    <button id="saveStatusLight" type="button" class="speed-btn save-status-light tap-feedback" title="存档状态：等待首次保存"
                            onclick="ui._onControlClick(event);ui.showArchiveManagerModal()">
                        <span class="save-status-dot"></span>
                    </button>
                </div>
            </div>
        `;

        // ⭐ 空容器插入DOM后，立即调用统一渲染函数填入资金（保证欠款/正款状态 + DOM 结构完全正确）
        //    同时重置幂等缓存：因为header是新创建的，内部子span不存在，需要强制写一次（旧缓存已失效）
        try {
            const fundsEl = document.getElementById('headerFunds');
            if (fundsEl) {
                this._headerFundsEl = fundsEl;
                // 重置幂等缓存，确保新header内容一定被写入（即使数值与旧header一致）
                this._lastFundsRenderedInt = null;
                this._lastFundsRenderedDebt = null;
                this._lastFundsRenderedRatio = null;
                this._renderFundsDisplay(fundsEl, state.shop.funds, debtInfo);
                // 同步插值器目标，防止 rAF 下一帧又"拉回"旧值
                if (this._interpFunds === null || this._targetFunds === null || !isFinite(this._interpFunds)) {
                    this._interpFunds = state.shop.funds;
                }
                this._targetFunds = state.shop.funds;
            }
        } catch (_) {}

        // ⭐ 顶栏高度变化后同步主内容顶距（含 ResizeObserver / 双 rAF）
        try {
            if (this._headerResizeObs && header) {
                try { this._headerResizeObs.observe(header); } catch (_) {}
            }
            this._syncMainContainerOffset(true);
        } catch (_) {}

        // ⭐ 同步存档状态灯（header 重建后需重新刷新状态显示）
        try {
            if (typeof saveManager !== 'undefined') {
                this._updateSaveStatusLight(saveManager._status);
            }
        } catch (_) {}
    }

    // ==================== 存档状态灯 ====================

    /** 初始化存档状态灯：绑定 saveManager 状态变化监听 */
    _initSaveStatusLight() {
        if (typeof saveManager === 'undefined') return;
        // 初始状态刷新
        this._updateSaveStatusLight(saveManager._status || 'pending');
        // 绑定状态变化监听
        if (this._saveStatusUnsub) { try { this._saveStatusUnsub(); } catch (e) {} }
        this._saveStatusUnsub = saveManager.onStatusChange((status) => {
            this._updateSaveStatusLight(status);
        });
    }

    /** 更新存档状态灯显示：绿=已保存 黄=保存中 红=失败 灰=等待 */
    _updateSaveStatusLight(status) {
        const light = document.getElementById('saveStatusLight');
        if (!light) return;
        const dot = light.querySelector('.save-status-dot');
        if (!dot) return;
        const colors = {
            saved: '#4caf50',    // 绿
            saving: '#ffc107',   // 黄
            error: '#f44336',    // 红
            pending: '#9e9e9e',  // 灰
            idle: '#9e9e9e'
        };
        const titles = {
            saved: '存档状态：已保存 ✓（点击管理存档）',
            saving: '存档状态：保存中…',
            error: '存档状态：保存失败！（点击查看）',
            pending: '存档状态：等待首次保存',
            idle: '存档状态：未开始'
        };
        const color = colors[status] || colors.idle;
        dot.style.background = color;
        dot.style.boxShadow = (status === 'saving') ? ('0 0 8px ' + colors.saving) : 'none';
        light.title = titles[status] || '';
    }

    // 暂停时不再弹全屏遮罩（用户要求：只停数据时间，不挡界面）
    // 轻量视觉提示保留：顶部时间 ⏸ 标识 + 暂停按钮红色脉动 + 时间文字变红
    renderPauseOverlay(state) {
        // 若之前有创建过 #pauseOverlay，销毁它以避免遮挡
        try {
            const old = document.getElementById('pauseOverlay');
            if (old && old.parentNode) old.parentNode.removeChild(old);
        } catch (e) {}
    }

    _orderNavBadge(state) {
        try {
            const c = this._countOrders(state || (gameState && gameState.state) || {});
            const n = (c.pendingPacking || 0) + (c.pendingShip || 0);
            return n > 0 ? (n > 99 ? '99+' : String(n)) : '';
        } catch (_) { return ''; }
    }

    renderBottomNav() {
        const nav = document.getElementById('bottomNav');
        if (!nav) return;
        nav.setAttribute('data-guide', 'bottom-nav');
        const state = (typeof gameState !== 'undefined' && gameState && gameState.state) ? gameState.state : this.lastState;
        const orderBadge = this._orderNavBadge(state);
        const activePage = (this.currentPage === 'marketing' || this.currentPage === 'finance' || this.currentPage === 'service')
            ? 'dashboard'
            : this.currentPage;
        const stamp = activePage + '|' + orderBadge;
        if (this._lastNavStamp === stamp && nav.querySelector('.nav-item')) return;
        this._lastNavStamp = stamp;
        this._lastNavRenderedPage = this.currentPage;

        const navItems = (typeof AppNav !== 'undefined' && AppNav.BOTTOM) ? AppNav.BOTTOM : [
            { id: 'dashboard', icon: '🏠', label: '首页' },
            { id: 'supply', icon: '📦', label: '货源' },
            { id: 'products', icon: '🛍️', label: '商品' },
            { id: 'orders', icon: '📋', label: '订单' },
            { id: 'analytics', icon: '📊', label: '数据' },
            { id: 'profile', icon: '👤', label: '我的' }
        ];

        nav.innerHTML = navItems.map(item => {
            const badge = item.id === 'orders' && orderBadge
                ? `<span class="nav-badge">${orderBadge}</span>`
                : '';
            const on = activePage === item.id;
            return `
            <div class="nav-item ${on ? 'active' : ''}" data-guide="nav-${item.id}" onclick="ui.navigateTo('${item.id}')">
                <div class="icon">${item.icon}${badge}</div>
                <div class="label">${item.label}</div>
            </div>`;
        }).join('');
    }

    renderPage(state) {
        const container = document.getElementById('mainContainer');
        if (!container) return;
        const isPageChange = this._lastRenderedPage !== this.currentPage;
        
        let pageHtml = '';
        try {
        switch(this.currentPage) {
            case 'dashboard':
                pageHtml = this.renderDashboard(state);
                break;
            case 'supply':
                pageHtml = this.renderSupplyPage(state);
                break;
            case 'products':
                pageHtml = this.renderProductsPage(state);
                break;
            case 'orders':
                pageHtml = this.renderOrdersPage(state);
                break;
            case 'analytics':
                pageHtml = this.renderAnalyticsPage(state);
                break;
            case 'marketing':
                pageHtml = this.renderMarketingPage(state);
                break;
            case 'service':
                try {
                    pageHtml = this.renderServicePage(state);
                } catch (e) {
                    console.error('[renderPage] service failed', e);
                    pageHtml = `<div class="page"><div class="empty-state"><div class="icon">📞</div><div class="text">售后页面加载失败<br><button class="btn btn-primary" style="margin-top:12px;" onclick="ui.showAfterSalesCenter()">打开售后中心</button></div></div></div>`;
                }
                break;
            case 'finance':
                pageHtml = this.renderFinancePage(state);
                break;
            case 'profile':
                pageHtml = this.renderProfilePage(state);
                break;
            default:
                pageHtml = this.renderDashboard(state);
        }
        } catch (e) {
            console.error('[renderPage] failed', this.currentPage, e);
            pageHtml = `<div class="page"><div class="empty-state" style="padding:40px 16px;text-align:center;">
                <div class="icon" style="font-size:36px;">⚠️</div>
                <div class="text" style="margin-top:8px;">页面加载失败，请切换底部导航重试</div>
                <button class="btn btn-primary" style="margin-top:12px;" onclick="ui.navigateTo('dashboard')">回到首页</button>
            </div></div>`;
        }
        
        if (isPageChange) {
            // 安全剥离外层 page 壳，避免空白/换行导致正则失败、DOM 残缺
            const trimmed = String(pageHtml || '').trim();
            const unwrapped = (() => {
                const m = trimmed.match(/^<div\s+class="page"[^>]*>([\s\S]*)<\/div\s*>$/i);
                return m ? m[1] : trimmed;
            })();
            container.innerHTML = `<div class="page page-enter">${unwrapped}</div>`;
            this._lastRenderedPage = this.currentPage;
        } else {
            container.innerHTML = pageHtml;
        }

        this._markEntryGridsLoaded(container, isPageChange);

    }

    navigateTo(page) {
        if (this.currentPage !== page) {
            this._markJustClicked();
            this.currentPage = page;
            this.scrollPositions[page] = 0;
            this._lastNavStamp = null;
            setTimeout(() => {
                try { this.render(); } catch (e) { console.warn('[navigateTo-render]', e); }
            }, 0);
        }
    }

    _markEntryGridsLoaded(container, isPageChange) {
        const grids = container ? container.querySelectorAll('.profile-grid, .wb-mod-grid') : [];
        if (!grids.length) return;
        const add = () => {
            const root = document.getElementById('mainContainer');
            if (!root) return;
            root.querySelectorAll('.profile-grid, .wb-mod-grid').forEach(g => g.classList.add('profile-grid-loaded'));
        };
        if (!isPageChange) add();
        else setTimeout(add, 900);
    }

    _renderModuleTiles(items, extraClass) {
        return (items || []).map((item, idx) => {
            if (!item || !item.id || !item.action) return '';
            const delay = (idx * 30) + 'ms';
            const badgeHtml = item.badge
                ? `<span class="grid-badge ${item.badge === 'LIVE' ? 'live' : (item.badge === '!' || item.badge === '锁') ? 'warn' : ''}">${item.badge}</span>`
                : '';
            const action = String(item.action).replace(/"/g, '&quot;');
            return `
                <div class="grid-item ${extraClass || ''}" data-guide="grid-${item.id}" style="--delay:${delay};"
                     onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                     onclick="${action}">
                    <div class="grid-icon" style="background:${item.color || '#90a4ae'};">
                        <span>${item.icon || '▫️'}</span>
                        ${badgeHtml}
                    </div>
                    <div class="grid-name">${item.name || item.id}</div>
                    <div class="grid-desc">${item.desc || ''}</div>
                </div>`;
        }).join('');
    }

    navigateToEmployee() {
        // ===== 员工管理V2：优先打开新员工管理界面 =====
        try {
            if (typeof window !== 'undefined' && window.empUI && typeof empUI.showMain === 'function') {
                empUI.showMain('list');
                return;
            }
        } catch (_) {}
        if (this.currentPage !== 'profile') {
            this.currentPage = 'profile';
            this.scrollPositions.profile = 0;
            this.render();
        }
        setTimeout(() => {
            const el = document.getElementById('employeeSection');
            const container = document.getElementById('mainContainer');
            if (el && container) {
                const elTop = el.offsetTop - 70;
                container.scrollTo({ top: elTop, behavior: 'smooth' });
            }
        }, 50);
    }

    /**
     * 采购中心入口（V2）：统一采购界面
     * tab: smart | supply | orders | buyers | plans | packaging
     */
    showProcurementCenter(tab = 'smart') {
        try {
            if (typeof window !== 'undefined' && window.procUI && typeof procUI.showCenter === 'function') {
                procUI.showCenter(tab);
                return;
            }
        } catch (_) {}
        // 兜底：按旧入口跳转
        if (tab === 'buyers') this.showWarehouseModal('buyer');
        else if (tab === 'packaging') this.showPackagingMaterialModal();
        else this.navigateTo('supply');
    }

    renderDashboard(state) {
        const c = this._countOrders(state);
        const pendingCS = ((state.customerService && state.customerService.consultations) || [])
            .filter(c => c.status === 'pending').length;
        const purchaseOrders = (state.purchaseOrders || []).filter(o => o.status !== 'received').length;
        const shopRating = (typeof state.shop?.rating === 'number' ? state.shop.rating : 5).toFixed(1);
        const level = (typeof gameState.getCurrentLevel === 'function' && gameState.getCurrentLevel()) || { name: '新手店铺', level: 1 };
        const nextLevel = (typeof SHOP_LEVELS !== 'undefined' && Array.isArray(SHOP_LEVELS))
            ? SHOP_LEVELS.find(l => l && l.level === (state.shop?.level || 1) + 1)
            : null;
        const soldForLevel = (typeof gameState.getTotalSoldQuantity === 'function') ? gameState.getTotalSoldQuantity() : 0;
        const needForLevel = nextLevel ? (Number(nextLevel.minSalesQty) || 0) : 0;
        const levelPct = nextLevel
            ? Math.min(100, needForLevel > 0 ? (soldForLevel / needForLevel * 100) : 100)
            : 100;
        const groups = (typeof AppNav !== 'undefined' && AppNav.buildCatalog)
            ? AppNav.buildCatalog(state, { surface: 'home' })
            : [];
        const groupsHtml = groups.map(g => `
            <div class="wb-group" data-guide="wb-group-${g.id}">
                <div class="profile-section-title">
                    <span class="profile-section-dot"></span>
                    ${g.title}
                </div>
                <div class="wb-mod-grid profile-grid">${this._renderModuleTiles(g.items)}</div>
            </div>
        `).join('');

        return `
            <div class="page">
            <div class="wb-page">
                <div class="wb-todo stats-grid" data-guide="dash-stats">
                    <div class="stat-item" onclick="ui.navigateTo('orders');ui.switchTab('orders','pending_payment');" style="cursor:pointer;">
                        <div class="stat-value red" id="dashStatPendingPay">${c.pendingPayment}</div>
                        <div class="stat-label">待付款</div>
                    </div>
                    <div class="stat-item" onclick="ui.navigateTo('orders');ui.switchTab('orders','pending_packing');" style="cursor:pointer;">
                        <div class="stat-value" id="dashStatPendingPack">${c.pendingPacking}</div>
                        <div class="stat-label">待打包</div>
                    </div>
                    <div class="stat-item" onclick="ui.navigateTo('orders');ui.switchTab('orders','pending_shipment');" style="cursor:pointer;">
                        <div class="stat-value orange" id="dashStatPendingShip">${c.pendingShip}</div>
                        <div class="stat-label">待发货</div>
                    </div>
                    <div class="stat-item" onclick="ui.navigateTo('orders');" style="cursor:pointer;">
                        <div class="stat-value green" id="dashStatTodayOrders">${c.todayOrders}</div>
                        <div class="stat-label">今日订单</div>
                    </div>
                    <div class="stat-item" onclick="ui.showProcurementCenter('orders')" style="cursor:pointer;">
                        <div class="stat-value blue" id="dashStatPurchase">${purchaseOrders}</div>
                        <div class="stat-label">采购中</div>
                    </div>
                    <div class="stat-item" onclick="ui.showAfterSalesCenter()" style="cursor:pointer;">
                        <div class="stat-value purple" id="dashStatCS">${pendingCS}</div>
                        <div class="stat-label">待回复客服</div>
                    </div>
                </div>
                ${(typeof DailyQuests !== 'undefined' && DailyQuests.renderCard) ? DailyQuests.renderCard() : ''}
                ${(() => {
                    const mk = state.marketing || {};
                    const hasCamp = (mk.activeCampaigns || []).some(x => x && x.status === 'active');
                    const hasEnd = (mk.celebrityEndorsements || []).some(x => x && x.status === 'active');
                    let hasPromo = false;
                    try { hasPromo = (typeof gameState.getActivePromotions === 'function') && (gameState.getActivePromotions() || []).length > 0; } catch (_) {}
                    let hasAdBoost = false;
                    try { hasAdBoost = typeof gameState.isAdTrafficBoostActive === 'function' && gameState.isAdTrafficBoostActive(); } catch (_) {}
                    if (hasCamp || hasEnd || hasPromo || hasAdBoost) return '';
                    return `<div class="card" style="background:linear-gradient(135deg,#fff3e0,#ffe0b2);border:1px solid #ffcc80;margin-bottom:10px;">
                        <div style="padding:12px 14px;font-size:13px;color:#e65100;line-height:1.6;">
                            <b>📣 自然流量很少</b>：不开推广、促销或代言，每天只有零星订单。
                            <span style="color:#1565c0;cursor:pointer;font-weight:700;" onclick="ui.navigateTo('marketing')">去营销推广 ›</span>
                        </div>
                    </div>`;
                })()}

                <div class="card shop-level-card" data-guide="dash-level">
                    <div class="card-header">
                        <div class="card-title">店铺等级</div>
                        <span class="badge">Lv.${state.shop.level}</span>
                    </div>
                    <div class="level-info">
                        <div class="level-badge">${state.shop.level}</div>
                        <div class="level-details">
                            <div class="level-name">${level.name} · ${state.shop.level}/10</div>
                            <div class="level-progress-text">
                                ${nextLevel ? `下一档 ${nextLevel.name} · 已售 ${soldForLevel}/${needForLevel} 件` : '已达最高十级'}
                            </div>
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: ${levelPct}%"></div>
                            </div>
                        </div>
                        ${nextLevel ? `
                        <button class="btn btn-primary btn-small tap-feedback"
                                style="flex-shrink:0;align-self:center;font-weight:700;padding:8px 10px;line-height:1.2;"
                                onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                                onclick="ui._onControlClick(event);ui.showShopUpgradeModal()">
                            ⬆️<br>店铺升级
                        </button>` : `
                        <span style="flex-shrink:0;align-self:center;font-size:11px;color:#4caf50;font-weight:600;">已满级</span>`}
                    </div>
                </div>

                <div class="card wb-kpi-card">
                    <div class="card-header">
                        <div class="card-title">经营快览</div>
                        <span style="font-size:11px;color:#888;">当天汇总在底栏「数据」</span>
                    </div>
                    <div class="wb-kpi-grid">
                        <div>
                            <div class="wb-kpi-label">总浏览量</div>
                            <div id="dashStatViews" class="wb-kpi-val">${state.statistics.totalViews}</div>
                        </div>
                        <div>
                            <div class="wb-kpi-label">总订单数</div>
                            <div id="dashStatTotalOrders" class="wb-kpi-val">${state.shop.totalOrders}</div>
                        </div>
                        <div onclick="ui.showRatingDetail()" style="cursor:pointer;">
                            <div class="wb-kpi-label">店铺评分</div>
                            <div id="dashStatShopRating" class="wb-kpi-val" style="color:#ff9800;">⭐ ${shopRating}</div>
                        </div>
                        <div>
                            <div class="wb-kpi-label">总销量</div>
                            <div id="dashStatTotalSales" class="wb-kpi-val">${state.shop.totalSales}</div>
                        </div>
                    </div>
                </div>

                ${groupsHtml}
            </div>
            </div>
        `;
    }

    renderSupplyPage(state) {
        // ===== 采购中心V2：优先使用新货源页 =====
        try {
            if (typeof window !== 'undefined' && window.procUI && typeof procUI._renderSupplyTab === 'function') {
                return procUI._renderSupplyTab();
            }
        } catch (e) {
            console.warn('[renderSupplyPage] 采购中心货源渲染失败，回退旧版：', e);
        }
        return this._renderSupplyPageLegacy(state);
    }

    _renderSupplyPageLegacy(state) {
        const suppliers = gameState.getAvailableSuppliers();
        const lockedSuppliers = SUPPLIERS.filter(s => s.unlockLevel > state.shop.level);
        const currentTab = this.currentTab.supply || 'all';

        return `
            <div class="page">
                <div class="card">
                    <div class="card-header">
                        <div class="card-title">批发货源</div>
                        <span class="badge badge-green">${suppliers.length}个可用</span>
                    </div>
                    <p style="font-size:12px;color:#999;">从不同批发商进货，品质和价格各有差异</p>
                </div>

                ${suppliers.map(supplier => this.renderSupplierCard(supplier, state)).join('')}

                ${lockedSuppliers.length > 0 ? `
                    <div class="card" style="opacity:0.6;">
                        <div class="card-header">
                            <div class="card-title">🔒 待解锁批发商</div>
                        </div>
                        ${lockedSuppliers.map(s => `
                            <div class="list-item">
                                <div class="item-left">
                                    <div class="item-icon">🏭</div>
                                    <div class="item-content">
                                        <div class="item-title">${s.name}</div>
                                        <div class="item-desc">需要Lv.${s.unlockLevel}解锁</div>
                                    </div>
                                </div>
                                <div class="item-arrow">🔒</div>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }

    renderSupplierCard(supplier, state) {
        const shopLv = (state.shop && state.shop.level) || 1;
        const products = PRODUCTS.filter(p => supplier.categories.includes(p.category)
            && (typeof isProductUnlockedForShop !== 'function' || isProductUnlockedForShop(p, shopLv)));
        
        return `
            <div class="supplier-card">
                <div class="supplier-header">
                    <div class="supplier-name">🏭 ${supplier.name}</div>
                    <div class="supplier-level">Lv.${supplier.level}</div>
                </div>
                <div class="supplier-info">
                    <span>品质: ${supplier.qualityBase}分</span>
                    <span>起订: ${supplier.minOrder}件</span>
                    <span>配送: ${supplier.deliveryDays}天</span>
                </div>
                <div class="supplier-products">
                    <div style="padding:15px 0;">
                        <div style="font-size:13px;color:#999;text-align:center;margin-bottom:8px;">共 ${products.length} 款商品</div>
                    </div>
                    <button class="btn btn-primary btn-small btn-block" 
                            onclick="ui.showSupplierProducts('${supplier.id}')">
                        查看全部商品 →
                    </button>
                </div>
            </div>
        `;
    }

    renderProductsPage(state) {
        const currentTab = this.currentTab.products || 'listings';
        const tabs = [
            { id: 'listings', name: '在售商品' },
            { id: 'market', name: '市场行情' },
            { id: 'inventory', name: '库存管理' },
            { id: 'purchase', name: '采购订单' },
            { id: 'publish', name: '上架商品' }
        ];

        return `
            <div class="page">
                <div class="tabs" data-guide="products-tabs">
                    ${tabs.map(tab => `
                        <div class="tab-item ${currentTab === tab.id ? 'active' : ''}" 
                             onclick="ui.switchTab('products', '${tab.id}')">${tab.name}</div>
                    `).join('')}
                </div>

                ${(() => {
                    try {
                        if (currentTab === 'listings') return this.renderListings(state);
                        if (currentTab === 'market') return this.renderMarketPage(state);
                        if (currentTab === 'inventory') return this.renderInventory(state);
                        if (currentTab === 'purchase') return this.renderPurchaseOrders(state);
                        if (currentTab === 'publish') return this.renderPublishForm(state);
                        return '';
                    } catch (e) {
                        console.error('[renderProductsPage]', currentTab, e);
                        return `<div class="empty-state"><div class="icon">⚠️</div><div class="text">商品页加载失败，请重试</div>
                            <button class="btn btn-primary" style="margin-top:12px;" onclick="ui.navigateTo('products')">刷新</button></div>`;
                    }
                })()}
            </div>
        `;
    }

    renderListings(state) {
        const listings = Array.isArray(state?.listings) ? state.listings.filter(Boolean) : [];
        const activeListings = listings.filter(l => l.status === 'active');
        const offlineListings = listings.filter(l => l.status === 'offline');
        
        if (activeListings.length === 0) {
            return `
                <div class="empty-state">
                    <div class="icon">🛍️</div>
                    <div class="text">暂无在售商品</div>
                    <button class="btn btn-primary" style="margin-top:15px;" 
                            onclick="ui.switchTab('products', 'publish')">立即上架</button>
                    <button class="btn btn-secondary" style="margin-top:10px;" 
                            onclick="ui.showRecycleModal()">♻️ 商品回收</button>
                </div>
                ${offlineListings.length ? `<div style="padding:10px 15px;font-size:12px;color:#888;">已下架 ${offlineListings.length} 件，可在编辑里重新上架</div>` : ''}
            `;
        }

        const gradeColors = { A: '#4caf50', B: '#ff9800', C: '#999' };
        const catFilter = this._listingsCategory || 'all';
        const categories = (typeof CATEGORIES !== 'undefined' && Array.isArray(CATEGORIES)) ? CATEGORIES : [];
        const filteredListings = catFilter === 'all' ? activeListings : activeListings.filter(l => {
            try {
                const product = (this._cache && this._cache.productsById && this._cache.productsById.get(l.productId))
                    || ((typeof PRODUCTS !== 'undefined') ? PRODUCTS.find(p => p && p.id === l.productId) : null);
                return product && product.category === catFilter;
            } catch (_) { return false; }
        });
        let nextLv = null;
        let soldQty = Number(state?.shop?.totalSales) || 0;
        try {
            if (typeof gameState.getNextShopLevel === 'function') nextLv = gameState.getNextShopLevel();
            if (typeof gameState.getTotalSoldQuantity === 'function') soldQty = gameState.getTotalSoldQuantity();
        } catch (_) {}

        // ===== 性能：在架分页 + 静态缓存，避免一次画几百张卡 =====
        const orderN = (state.orders && state.orders.length) || 0;
        let pageSize = this._listingsPageSize || 24;
        if (orderN > 5000 || filteredListings.length > 80) pageSize = 16;
        else if (orderN > 2000 || filteredListings.length > 40) pageSize = 20;
        const totalPages = Math.max(1, Math.ceil(filteredListings.length / pageSize));
        let page = Math.max(1, parseInt(this._listingsPage, 10) || 1);
        if (page > totalPages) page = totalPages;
        this._listingsPage = page;
        const startIdx = (page - 1) * pageSize;
        const pageList = filteredListings.slice(startIdx, startIdx + pageSize);
        const cache = this._cache || {};
        const productsById = cache.productsById;
        const categoriesById = cache.categoriesById;
        const grades = cache.qualityGrades || ((typeof QUALITY_GRADES !== 'undefined') ? QUALITY_GRADES : {});

        const pagerHtml = totalPages > 1 ? `
            <div style="padding:8px 15px;display:flex;align-items:center;justify-content:space-between;gap:8px;background:#fafafa;border-bottom:1px solid #eee;">
                <button class="btn btn-secondary btn-small tap-feedback" ${page <= 1 ? 'disabled' : ''}
                    onclick="ui._onControlClick(event);ui.setListingsPage(${page - 1})">上一页</button>
                <span style="font-size:12px;color:#666;">在架 ${filteredListings.length}${catFilter !== 'all' ? '/' + activeListings.length : ''} · ${page}/${totalPages}</span>
                <button class="btn btn-secondary btn-small tap-feedback" ${page >= totalPages ? 'disabled' : ''}
                    onclick="ui._onControlClick(event);ui.setListingsPage(${page + 1})">下一页</button>
            </div>` : `
            <div style="padding:6px 15px;font-size:12px;color:#888;background:#fafafa;border-bottom:1px solid #eee;">
                在架 ${filteredListings.length}${catFilter !== 'all' ? '/' + activeListings.length : ''} 件
            </div>`;

        return `
            <div style="padding:10px 15px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;background:#fff8e1;border-bottom:1px solid #ffe082;">
                <button class="btn btn-secondary btn-small tap-feedback" onclick="ui._onControlClick(event);ui.showRecycleModal()">♻️ 商品回收</button>
                <button class="btn btn-secondary btn-small tap-feedback" onclick="ui._onControlClick(event);ui.showCostMarkupModal()">💲 批量改价·${(typeof gameState.getCostMarkupPct === 'function' ? gameState.getCostMarkupPct() : 150)}%</button>
                ${nextLv ? `<button class="btn btn-primary btn-small tap-feedback" onclick="ui._onControlClick(event);ui.showShopUpgradeModal()">⬆️ 升级店铺（已售${soldQty}/${nextLv.minSalesQty || 0}）</button>` : `<span style="font-size:12px;color:#4caf50;">已达最高店铺等级</span>`}
            </div>
            <div style="padding:8px 12px;display:flex;gap:6px;flex-wrap:wrap;background:#fff;border-bottom:1px solid #f0f0f0;">
                <button class="btn btn-xs ${catFilter === 'all' ? 'btn-primary' : 'btn-secondary'}" onclick="ui._onControlClick(event);ui.setListingsCategory('all')">全部</button>
                ${categories.map(c => `
                    <button class="btn btn-xs ${catFilter === c.id ? 'btn-primary' : 'btn-secondary'}"
                        onclick="ui._onControlClick(event);ui.setListingsCategory('${c.id}')">${c.icon || ''} ${c.name}</button>
                `).join('')}
            </div>
            ${pagerHtml}
            <div class="card" style="padding:0;">
                ${pageList.map(listing => {
                    try {
                        const product = (productsById && productsById.get(listing.productId))
                            || ((typeof PRODUCTS !== 'undefined' && Array.isArray(PRODUCTS))
                                ? PRODUCTS.find(p => p && p.id === listing.productId) : null);
                        const category = (categoriesById && product && categoriesById.get(product.category))
                            || ((typeof CATEGORIES !== 'undefined' && Array.isArray(CATEGORIES) && product)
                                ? CATEGORIES.find(c => c && c.id === product.category) : null);
                        const qualityGrade = listing.qualityGrade || 'B';
                        const gradeInfo = grades[qualityGrade] || grades.B || { name: qualityGrade || 'B' };
                        const inventory = (typeof gameState.getInventoryQuantity === 'function')
                            ? gameState.getInventoryQuantity(listing.productId, qualityGrade)
                            : 0;
                        const soldOut = inventory <= 0;
                        const priceNum = Number(listing.price);
                        const priceText = Number.isFinite(priceNum) ? priceNum.toFixed(2) : '0.00';
                        const title = String(listing.title || product?.name || '未命名商品');
                        const lid = String(listing.id || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");

                        return `
                        <div class="product-item" style="padding:12px 15px;">
                            <div class="product-image" style="width:50px;height:50px;border-radius:8px;overflow:hidden;background:#f5f5f5;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                                <img src="${this.getProductImageLite(listing.productId, qualityGrade)}" alt="" style="width:100%;height:100%;object-fit:cover;"
                                     onerror="this.style.display='none';if(this.parentElement)this.parentElement.innerHTML='<div style=\\'font-size:22px;\\'>${category?.icon || '📦'}</div>'">
                            </div>
                            <div class="product-info">
                                <div class="product-name">
                                    ${title}
                                    <span class="badge" style="margin-left:6px;background:${gradeColors[qualityGrade] || '#999'};color:white;font-size:10px;">${gradeInfo.name || qualityGrade}</span>
                                    ${soldOut ? '<span class="badge" style="margin-left:4px;background:#f44336;color:#fff;font-size:10px;">售罄</span>' : ''}
                                </div>
                                <div class="product-price">¥${priceText}</div>
                                <div class="product-meta">
                                    库存: ${inventory} | 销量: ${Number(listing.sales) || 0} | 权重: ${(Number(listing.weight) || 0).toFixed(0)}
                                    | 评分: ⭐ ${((typeof listing.rating === 'number' && !isNaN(listing.rating)) ? listing.rating : 5).toFixed(1)}
                                    ${(listing.reviews && listing.reviews.length) ? `(${listing.reviews.length})` : ''}
                                </div>
                            </div>
                            <div style="display:flex;flex-direction:column;gap:6px;">
                                <button class="btn btn-secondary btn-small tap-feedback" 
                                        onclick="ui._onControlClick(event);ui.showListingReviews('${lid}')">评价详情</button>
                                <button class="btn btn-secondary btn-small tap-feedback" 
                                        onclick="ui._onControlClick(event);ui.editListing('${lid}')">编辑</button>
                                <button class="btn btn-danger btn-small tap-feedback" 
                                        onclick="ui._onControlClick(event);ui.delistListingQuick('${lid}')">${soldOut ? '售罄下架' : '下架'}</button>
                            </div>
                        </div>
                    `;
                    } catch (e) {
                        console.warn('[renderListings] skip listing', listing && listing.id, e);
                        return '';
                    }
                }).join('')}
            </div>
        `;
    }

    setListingsPage(page) {
        const p = Math.max(1, parseInt(page, 10) || 1);
        this._listingsPage = p;
        this._markJustClicked();
        try { this.render(); } catch (_) {}
    }

    setListingsCategory(catId) {
        this._listingsCategory = catId || 'all';
        this._listingsPage = 1;
        this._markJustClicked();
        try { this.render(); } catch (_) {}
    }

    /**
     * 店主手动期：店铺还没有任何订单时（未出第一单），店主可以手动上架/批量改价，
     * 不强制先招客服/改价员。出单后再要求对应岗位，避免新手未出单先背一个月工资。
     */
    _isOwnerManualPhase() {
        try {
            const shop = gameState && gameState.state && gameState.state.shop;
            return !!shop && !(Number(shop.totalOrders) > 0);
        } catch (_) { return false; }
    }

    /**
     * 批量改价弹窗：按成本价百分比批量设置全部在架商品售价（可调 100%~400%）
     * 前置条件：必须有在职「改价员」才能操作（店主手动期除外）
     */
    showCostMarkupModal() {
        this._markJustClicked();
        if (!this._isOwnerManualPhase()
            && !(typeof gameState.hasActivePricer === 'function' && gameState.hasActivePricer())) {
            this.showStaffRequiredModal('pricer');
            return;
        }
        const current = (typeof gameState.getCostMarkupPct === 'function') ? gameState.getCostMarkupPct() : 150;
        const presets = [100, 150, 200, 250, 300, 350, 400];
        const activeCount = (gameState.state.listings || []).filter(l => l && l.status === 'active').length;
        const content = `
            <div style="font-size:12px;color:#666;line-height:1.7;margin-bottom:12px;">
                将 <b>全部 ${activeCount} 件在架商品</b> 的售价统一调整为进货成本的百分比。
                <div style="margin-top:6px;color:#e65100;">💰 可调范围：100% ~ 400%（超过成本 4 倍会按 400% 封顶）</div>
            </div>
            <div class="emv2-section-title" style="margin-top:0;">快捷选择</div>
            <div class="emv2-focus-row" style="margin-bottom:12px;">
                ${presets.map(p => `
                    <button class="emv2-chip2 ${p === current ? 'on' : ''}" style="font-size:14px;padding:8px 14px;"
                        onclick="ui.pickCostMarkupPreset(${p})">${p}%</button>`).join('')}
            </div>
            <div class="form-group">
                <label class="form-label">自定义百分比（100~400）</label>
                <div style="display:flex;gap:8px;align-items:center;">
                    <input type="number" class="form-input" id="costMarkupPctInput" min="100" max="400" step="5"
                        value="${current}" placeholder="如 300" style="flex:1;">
                    <span style="font-size:14px;color:#666;font-weight:700;">%</span>
                </div>
            </div>
            <div class="emv2-hint" style="margin-bottom:0;">
                💡 改价后「改价员」员工也会按此比例自动维护在架商品售价。
            </div>`;
        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>
            <button class="btn btn-primary" onclick="ui.confirmCostMarkup()">💲 按此比例批量改价</button>`;
        this.showModal('💲 按成本批量改价', content, footer, { modalId: 'costMarkupModal' });
    }

    pickCostMarkupPreset(pct) {
        const input = document.getElementById('costMarkupPctInput');
        if (input) input.value = String(pct);
        // 预设选中态即时反馈
        try {
            const btns = document.querySelectorAll('#costMarkupModal .emv2-chip2');
            btns.forEach(b => b.classList.remove('on'));
        } catch (_) {}
    }

    confirmCostMarkup() {
        if (!this._isOwnerManualPhase()
            && !(typeof gameState.hasActivePricer === 'function' && gameState.hasActivePricer())) {
            this.closeModal();
            this.showStaffRequiredModal('pricer');
            return;
        }
        let pct = parseInt((document.getElementById('costMarkupPctInput') || {}).value, 10);
        if (!isFinite(pct) || pct < 100) pct = 150;
        if (pct > 400) pct = 400;
        const saved = (typeof gameState.setCostMarkupPct === 'function') ? gameState.setCostMarkupPct(pct) : pct;
        let n = 0;
        try {
            n = gameState.applyCostMarkupToListings(saved / 100);
        } catch (e) {
            this.showToast('改价失败');
            return;
        }
        this.closeModal();
        this.showToast(n > 0 ? `✅ 已将 ${n} 件在架商品改为成本×${saved}%` : '没有需要改价的商品');
        if (n > 0) this.render();
    }

    applyAllListingsCostMarkup() {
        // 兼容旧入口：按玩家设定的比例执行（默认 150%）；批量改价必须有在职改价员（店主手动期除外）
        if (!this._isOwnerManualPhase()
            && !(typeof gameState.hasActivePricer === 'function' && gameState.hasActivePricer())) {
            this.showStaffRequiredModal('pricer');
            return;
        }
        const pct = (typeof gameState.getCostMarkupPct === 'function') ? gameState.getCostMarkupPct() : 150;
        this._markJustClicked();
        try {
            const n = gameState.applyCostMarkupToListings(pct / 100);
            this.showToast(n > 0 ? `已将 ${n} 件在架商品改为成本×${pct}%` : '没有需要改价的商品');
            if (n > 0) this.render();
        } catch (e) {
            this.showToast('改价失败');
        }
    }

    delistListingQuick(listingId) {
        this._markJustClicked();
        const r = gameState.delistListing(listingId);
        this.showToast(r.message || (r.success ? '已下架' : '下架失败'), r.success ? 1200 : 2000);
        if (r.success) {
            if (this._isHeavyOrderLoad()) {
                this.pendingRender = true;
                this._schedulePostClickRender(180);
            } else {
                setTimeout(() => { try { this.render(); } catch (_) {} }, 0);
            }
        }
    }

    showShopUpgradeModal() {
        const cur = (typeof gameState.getCurrentLevel === 'function' && gameState.getCurrentLevel()) || { name: '未知', level: 1 };
        const next = (typeof gameState.getNextShopLevel === 'function') ? gameState.getNextShopLevel() : null;
        if (!next) {
            this.showToast('已是最高等级');
            return;
        }
        const sold = (typeof gameState.getTotalSoldQuantity === 'function') ? gameState.getTotalSoldQuantity() : 0;
        const content = `
            <div style="line-height:1.7;font-size:14px;color:#444;">
                <div>当前：<b>${cur.name || '未知'}</b>（Lv${cur.level || 1}）</div>
                <div>下一档：<b style="color:#ff6b35;">${next.name || '下一级'}</b>（Lv${next.level || '?'}）</div>
                <div style="margin-top:10px;padding:10px;background:#f5f5f5;border-radius:8px;">
                    <div>升级费用：<b>¥${(next.upgradeFee || 0).toLocaleString()}</b></div>
                    <div>销量要求：累计售出 <b>${next.minSalesQty || 0}</b> 件（当前 ${sold}）</div>
                    <div>流量加成：×${next.trafficBonus} · 权重+${next.weightBonus || 0}</div>
                    ${next.overseas ? '<div style="color:#1565c0;margin-top:4px;">🌍 解锁：亚马逊式海外挂链销售</div>' : ''}
                    ${next.luxuryTier ? '<div style="color:#8e24aa;margin-top:4px;">💎 解锁：更高货值奢侈品货源</div>' : ''}
                </div>
            </div>`;
        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>
            <button class="btn btn-primary" onclick="ui.confirmShopUpgrade()">确认升级并付款</button>`;
        this.showModal('店铺升级', content, footer);
    }

    confirmShopUpgrade() {
        const prev = (typeof gameState.getCurrentLevel === 'function' && gameState.getCurrentLevel()) || { level: 1, name: '' };
        const r = gameState.upgradeShopLevel();
        this.closeModal();
        if (r && r.success) {
            this.playShopUpgradeFx({
                from: prev.level || 1,
                to: r.level,
                name: r.name || r.message || '店铺升级'
            });
            this.render();
            this._flashShopLevelCard();
        } else {
            this.showToast((r && r.message) || '升级失败', 2000);
        }
    }

    /** 店铺升级全屏特效：金光爆开 + 等级弹出 + 彩带 */
    playShopUpgradeFx(info) {
        try {
            const old = document.getElementById('shopUpgradeFx');
            if (old) old.remove();
        } catch (_) {}
        const from = (info && info.from) || 1;
        const to = (info && info.to) || from + 1;
        const name = (info && info.name) || '店铺升级';
        const colors = ['#ffd54f', '#ffb300', '#ff6f00', '#fff59d', '#ff8a65', '#ffecb3', '#ffcc80'];
        const pieces = [];
        for (let i = 0; i < 28; i++) {
            const ang = (Math.PI * 2 * i) / 28 + Math.random() * 0.3;
            const dist = 120 + Math.random() * 160;
            const dx = Math.round(Math.cos(ang) * dist);
            const dy = Math.round(Math.sin(ang) * dist - 40);
            const rot = Math.round((Math.random() * 360) - 180);
            const delay = (Math.random() * 0.18).toFixed(2);
            const c = colors[i % colors.length];
            pieces.push(`<i class="shop-up-fx-piece" style="background:${c};--dx:${dx}px;--dy:${dy}px;--rot:${rot}deg;animation-delay:${delay}s;"></i>`);
        }
        const el = document.createElement('div');
        el.id = 'shopUpgradeFx';
        el.className = 'shop-up-fx';
        el.innerHTML = `
            <div class="shop-up-fx-burst"></div>
            <div class="shop-up-fx-ring"></div>
            ${pieces.join('')}
            <div class="shop-up-fx-core">
                <div class="shop-up-fx-lv">Lv.${from} → Lv.${to}</div>
                <div class="shop-up-fx-name">🎉 ${name}</div>
                <div class="shop-up-fx-sub">店铺升级成功</div>
            </div>`;
        document.body.appendChild(el);
        try {
            if (typeof SoundManager !== 'undefined') SoundManager.play('success', { volume: 0.4 });
        } catch (_) {}
        setTimeout(() => { try { el.remove(); } catch (_) {} }, 2400);
    }

    _flashShopLevelCard() {
        try {
            const cards = document.querySelectorAll('.card, .profile-shop-card, .level-info');
            cards.forEach(c => {
                const title = c.querySelector('.card-title, .level-name, .profile-shop-level');
                const text = (title && title.textContent) || c.textContent || '';
                if (!/店铺等级|Lv\./.test(text)) return;
                c.classList.remove('shop-level-card-flash');
                void c.offsetWidth;
                c.classList.add('shop-level-card-flash');
            });
        } catch (_) {}
    }

    showRecycleModal() {
        const inv = gameState.state.inventory || [];
        const map = {};
        inv.forEach(it => {
            if (!it || !(it.quantity > 0)) return;
            const key = it.productId + '_' + (it.qualityGrade || 'B');
            if (!map[key]) map[key] = { productId: it.productId, qualityGrade: it.qualityGrade || 'B', quantity: 0, cost: 0 };
            map[key].quantity += it.quantity;
            map[key].cost += it.quantity * (it.costPrice || 0);
        });
        const rows = Object.values(map);
        if (!rows.length) {
            this.showToast('暂无可回收库存');
            return;
        }
        const options = rows.map(r => {
            const p = PRODUCTS.find(x => x.id === r.productId);
            const avg = r.quantity > 0 ? (r.cost / r.quantity) : 0;
            return `<option value="${r.productId}|${r.qualityGrade}">${p?.name || r.productId} [${r.qualityGrade}] 库存${r.quantity} · 成本约¥${avg.toFixed(2)}</option>`;
        }).join('');
        const content = `
            <div class="form-group">
                <label class="form-label">选择回收商品</label>
                <select class="form-input" id="recycleProductSel">${options}</select>
            </div>
            <div class="form-group">
                <label class="form-label">回收数量</label>
                <input type="number" class="form-input" id="recycleQty" value="1" min="1">
            </div>
            <div style="font-size:12px;color:#666;background:#f5f5f5;padding:10px;border-radius:8px;">
                回收价按进货成本的 <b>5~7折</b> 随机结算，回收后库存减少并到账资金。售罄商品可同时下架。
            </div>`;
        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>
            <button class="btn btn-primary" onclick="ui.confirmRecycle()">确认回收</button>`;
        this.showModal('♻️ 商品回收', content, footer);
    }

    confirmRecycle() {
        const sel = (document.getElementById('recycleProductSel')?.value || '').split('|');
        const productId = sel[0];
        const grade = sel[1] || 'B';
        const qty = parseInt(document.getElementById('recycleQty')?.value, 10) || 1;
        const r = gameState.recycleInventory(productId, grade, qty);
        this.closeModal();
        this.showToast(r.message || (r.success ? '回收成功' : '回收失败'), 2200);
        if (r.success && r.remaining === 0) {
            const listing = (gameState.state.listings || []).find(l =>
                l.productId === productId && (l.qualityGrade || 'B') === grade && l.status === 'active');
            if (listing && confirm('该商品已无库存，是否立即下架？')) {
                gameState.delistListing(listing.id);
            }
        }
        if (r.success) this.render();
    }

    renderInventory(state) {
        if (state.inventory.length === 0) {
            return `
                <div class="empty-state">
                    <div class="icon">📦</div>
                    <div class="text">暂无库存</div>
                    <button class="btn btn-primary" style="margin-top:15px;" 
                            onclick="ui.navigateTo('supply')">去进货</button>
                </div>
            `;
        }

        const inventoryMap = {};
        state.inventory.forEach(item => {
            const key = item.productId + '_' + (item.qualityGrade || 'B');
            if (!inventoryMap[key]) {
                inventoryMap[key] = {
                    productId: item.productId,
                    qualityGrade: item.qualityGrade || 'B',
                    quantity: 0,
                    totalCost: 0,
                    avgQuality: 0
                };
            }
            inventoryMap[key].quantity += item.quantity;
            inventoryMap[key].totalCost += item.costPrice * item.quantity;
            inventoryMap[key].avgQuality += (item.quality || 70) * item.quantity;
        });

        Object.values(inventoryMap).forEach(item => {
            item.avgQuality = item.avgQuality / item.quantity;
        });

        return `
            <div class="card" style="padding:0;">
                ${Object.values(inventoryMap).map(item => {
                    const product = PRODUCTS.find(p => p.id === item.productId);
                    const category = CATEGORIES.find(c => c.id === product?.category);
                    const avgCost = item.totalCost / item.quantity;
                    const gradeInfo = QUALITY_GRADES[item.qualityGrade] || QUALITY_GRADES.B;
                    const gradeColors = { A: '#4caf50', B: '#ff9800', C: '#999' };
                    const pidOk = item.productId != null && item.productId !== ''
                        && String(item.productId) !== 'undefined'
                        && String(item.productId) !== 'null';
                    // 无效 productId 时避免显示字面量 "undefined"
                    const productName = (product && product.name)
                        ? product.name
                        : (pidOk ? `未知商品(${item.productId})` : '未知商品（退货数据异常）');
                    const canPublish = !!(product && product.name);
                    
                    return `
                        <div class="product-item" style="padding:12px 15px;">
                            <div class="product-image" style="width:50px;height:50px;border-radius:8px;overflow:hidden;background:#f5f5f5;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                                <img src="${this.getProductImageLite(item.productId, item.qualityGrade)}" alt="${productName}" style="width:100%;height:100%;object-fit:cover;"
                                     onerror="this.style.display='none';this.parentElement.innerHTML='<div style=\\'font-size:22px;\\'>${category?.icon || '📦'}</div>'">
                            </div>
                            <div class="product-info">
                                <div class="product-name">
                                    ${productName}
                                    <span class="badge" style="margin-left:6px;background:${gradeColors[gradeInfo.grade]};color:white;font-size:10px;">${gradeInfo.name}</span>
                                </div>
                                <div class="product-price" style="color:#4caf50;">库存: ${item.quantity}件</div>
                                <div class="product-meta">
                                    平均成本: ¥${avgCost.toFixed(2)} | 品质: ${Math.round(item.avgQuality)}分
                                </div>
                                ${!canPublish ? `<div class="product-meta" style="color:#f44336;">无法上架：商品档案缺失</div>` : ''}
                            </div>
                            ${canPublish
                                ? `<button class="btn btn-primary btn-small" 
                                    onclick="ui.publishFromInventory('${item.productId}', '${item.qualityGrade}')">
                                上架
                            </button>`
                                : `<button class="btn btn-secondary btn-small" disabled title="商品数据异常，无法上架">上架</button>`
                            }
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    renderPurchaseOrders(state) {
        // ===== 采购中心V2：优先使用新采购订单页 =====
        try {
            if (typeof window !== 'undefined' && window.procUI && typeof procUI._renderOrdersTab === 'function') {
                return procUI._renderOrdersTab();
            }
        } catch (e) {
            console.warn('[renderPurchaseOrders] 采购中心渲染失败，回退旧版：', e);
        }
        return this._renderPurchaseOrdersLegacy(state);
    }

    _renderPurchaseOrdersLegacy(state) {
        const purchaseOrders = [...state.purchaseOrders].sort((a, b) => {
            const aTime = (a.createTime.day - 1) * 24 + a.createTime.hour;
            const bTime = (b.createTime.day - 1) * 24 + b.createTime.hour;
            return bTime - aTime;
        });
        
        if (purchaseOrders.length === 0) {
            return `
                <div class="empty-state">
                    <div class="icon">📋</div>
                    <div class="text">暂无采购订单</div>
                    <button class="btn btn-primary" style="margin-top:15px;" 
                            onclick="ui.navigateTo('supply')">去采购</button>
                </div>
            `;
        }

        const statusMap = {
            pending: { name: '待发货', color: '#ff9800' },
            shipping: { name: '运输中', color: '#2196f3' },
            received: { name: '已入库', color: '#4caf50' }
        };

        return `
            <div class="card" style="padding:0;">
                ${purchaseOrders.map(order => {
                    const product = PRODUCTS.find(p => p.id === order.productId);
                    const category = CATEGORIES.find(c => c.id === product?.category);
                    const status = statusMap[order.status] || { name: order.status, color: '#999' };
                    const gradeInfo = QUALITY_GRADES[order.qualityGrade] || QUALITY_GRADES.B;
                    const today = (state.gameTime && state.gameTime.day) || 1;
                    const remainDays = Math.max(0, (order.expectedArrivalDay || today) - today);
                    let etaText = '已入库';
                    if (order.status !== 'received') {
                        if (remainDays <= 0) etaText = '今日到货';
                        else etaText = `还有${remainDays}天到货（第${order.expectedArrivalDay}天）`;
                    }
                    const srcTag = order.source === 'auto_plan' ? ' · 自动补货' : '';
                    const buyerTag = order.buyerName ? ` · 🛒 ${order.buyerName}采购` : '';
                    
                    return `
                        <div class="product-item" style="padding:12px 15px;">
                            <div class="product-image" style="width:50px;height:50px;border-radius:8px;overflow:hidden;background:#f5f5f5;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                                <img src="${this.getProductImageLite(order.productId, order.qualityGrade)}" alt="${order.productName}" style="width:100%;height:100%;object-fit:cover;"
                                     onerror="this.style.display='none';this.parentElement.innerHTML='<div style=\\'font-size:22px;\\'>${category?.icon || '📦'}</div>'">
                            </div>
                            <div class="product-info">
                                <div class="product-name">${order.productName}${srcTag}${buyerTag}</div>
                                <div class="product-price" style="color:${status.color};">${status.name} · ${etaText}</div>
                                <div class="product-meta">
                                    ${gradeInfo.name} | 数量: ${order.quantity}件 | 预计: 第${order.expectedArrivalDay}天
                                </div>
                            </div>
                            <div style="text-align:right;">
                                <div style="font-size:14px;font-weight:bold;color:#ff6b35;">¥${order.totalAmount.toFixed(2)}</div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    renderPublishForm(state) {
        // ===== 修复：不再因 listings 有 active 就完全过滤掉库存商品，改为保留并标记"已上架" =====
        // 只过滤掉数量<=0的，避免用户进了货却在货架页看不到
        const inventoryItems = (state.inventory || []).filter(item => {
            const qty = typeof item.quantity === 'number' ? item.quantity : 0;
            return qty > 0;
        });

        const productMap = {};
        inventoryItems.forEach(item => {
            const key = item.productId + '_' + (item.qualityGrade || 'B');
            if (!productMap[key]) {
                productMap[key] = {
                    productId: item.productId,
                    qualityGrade: item.qualityGrade || 'B',
                    quantity: 0,
                    avgCost: 0,
                    totalCost: 0,
                    hasActiveListing: false,
                    activeListingQty: 0,
                    activeListingPrice: 0
                };
            }
            productMap[key].quantity += item.quantity;
            productMap[key].totalCost += (typeof item.costPrice === 'number' ? item.costPrice : 0) * item.quantity;
        });
        
        Object.values(productMap).forEach(p => {
            p.avgCost = p.quantity > 0 ? p.totalCost / p.quantity : 0;
            // ===== 记录该组合是否已有 active listing =====
            const activeListing = (state.listings || []).find(l =>
                l && l.productId === p.productId &&
                l.qualityGrade === p.qualityGrade &&
                l.status === 'active'
            );
            if (activeListing) {
                p.hasActiveListing = true;
                p.activeListingQty = typeof activeListing.quantity === 'number' ? activeListing.quantity : 0;
                p.activeListingPrice = typeof activeListing.price === 'number' ? activeListing.price : 0;
            }
        });

        const products = Object.values(productMap);

        if (products.length === 0) {
            return `
                <div class="empty-state">
                    <div class="icon">📦</div>
                    <div class="text">没有可上架的商品</div>
                    <div style="font-size:12px;color:#999;margin-top:5px;">先去进货吧！</div>
                    <button class="btn btn-primary" style="margin-top:15px;" 
                            onclick="ui.navigateTo('supply')">去进货</button>
                </div>
            `;
        }

        const gradeColors = { A: '#4caf50', B: '#ff9800', C: '#999' };

        // ===== 上架需要客服：没有在职客服时锁定上架（店主手动期：未出第一单前可手动上架）=====
        const ownerManual = this._isOwnerManualPhase();
        const hasCS = ownerManual || !!(typeof gameState !== 'undefined' && gameState
            && typeof gameState.hasActiveCustomerService === 'function'
            && gameState.hasActiveCustomerService());
        const csGateBanner = hasCS ? '' : `
            <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;margin:0 12px 10px;background:#fff3e0;border:1px solid #ffe0b2;border-radius:10px;">
                <div style="font-size:26px;">💬</div>
                <div style="flex:1;font-size:12px;color:#8d6e00;line-height:1.6;">
                    <b>上架商品需要客服坐镇</b>，请先在「员工管理」招聘一名客服后再上架。
                </div>
                <button class="btn btn-primary btn-small" style="flex-shrink:0;"
                    onclick="ui.showHireEmployeeModal()">去招聘</button>
            </div>`;
        const ownerManualBanner = !ownerManual ? '' : `
            <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;margin:0 12px 10px;background:#e8f5e9;border:1px solid #c8e6c9;border-radius:10px;">
                <div style="font-size:26px;">🧑‍💼</div>
                <div style="flex:1;font-size:12px;color:#2e7d32;line-height:1.6;">
                    <b>新手期</b>：还没出第一单，店主可以手动上架/改价；出单后记得招<b>客服</b>接手。
                </div>
            </div>`;

        return `
            <div class="card">
            ${csGateBanner}
            ${ownerManualBanner}
                <div class="card-title" style="margin-bottom:15px;">
                    选择要上架的商品
                    <span style="font-size:11px;font-weight:normal;color:#999;margin-left:8px;">
                        共 ${products.length} 种库存商品（含已上架中）
                    </span>
                </div>
                ${products.map(p => {
                    const product = PRODUCTS.find(prod => prod.id === p.productId);
                    const category = CATEGORIES.find(c => c.id === product?.category);
                    // 已上架用当前售价；未上架用行情建议价
                    let suggestedPrice = 0;
                    try {
                        if (typeof gameState.getSuggestedSellPrice === 'function') {
                            suggestedPrice = gameState.getSuggestedSellPrice(p.productId, p.qualityGrade);
                        }
                    } catch (_) {}
                    if (!(suggestedPrice > 0)) {
                        const cost = Number(p.avgCost) || 0;
                        suggestedPrice = Math.round(Math.max(cost * 1.25, 0.01) * 100) / 100;
                    }
                    const defaultPrice = p.hasActiveListing ? p.activeListingPrice : suggestedPrice;
                    const gradeInfo = QUALITY_GRADES[p.qualityGrade] || QUALITY_GRADES.B;
                    const remainUnlisted = Math.max(0, p.quantity - p.activeListingQty);
                    // 商品专属图标：优先img，降级为emoji，最后降级为分类图标
                    const productImg = this.getProductImageLite(p.productId, p.qualityGrade);
                    const productEmoji = product?.icon || category?.icon || '📦';
                    // 无效 productId 时避免显示字面量 "undefined"
                    const pidOk = p.productId != null && p.productId !== ''
                        && String(p.productId) !== 'undefined'
                        && String(p.productId) !== 'null';
                    const productName = (product && product.name)
                        ? product.name
                        : (pidOk ? `未知商品(${p.productId})` : '未知商品（退货数据异常）');
                    const canPublish = !!(product && product.name);                    
                    const statusBadge = p.hasActiveListing
                        ? `<span class="badge" style="margin-left:6px;background:#4caf50;color:white;font-size:10px;">● 已上架中</span>`
                        : `<span class="badge" style="margin-left:6px;background:#9e9e9e;color:white;font-size:10px;">待上架</span>`;
                    const btnText = p.hasActiveListing
                        ? (remainUnlisted > 0 ? `追加 (剩${remainUnlisted}件)` : `调整价格`)
                        : `上架`;
                    const metaExtra = p.hasActiveListing
                        ? `<div class="product-meta">已登数量: ${p.activeListingQty}件 | 当前售价: ¥${p.activeListingPrice.toFixed(2)}</div>`
                        : '';
                    
                    return `
                        <div class="product-item" style="${p.hasActiveListing ? 'opacity:0.98;background:#f7fff7;' : ''}">
                            <div class="product-image" style="width:50px;height:50px;border-radius:8px;overflow:hidden;background:#f5f5f5;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                                <img src="${productImg}" alt="${productName}" style="width:100%;height:100%;object-fit:cover;"
                                     onerror="this.style.display='none';this.parentElement.innerHTML='<div style=\\'font-size:22px;\\'>${productEmoji}</div>'">
                            </div>
                            <div class="product-info">
                                <div class="product-name">
                                    ${productName}
                                    <span class="badge" style="margin-left:6px;background:${gradeColors[p.qualityGrade]};color:white;font-size:10px;">${gradeInfo.name}</span>
                                    ${statusBadge}
                                </div>
                                <div class="product-meta">总库存: ${p.quantity}件 | 平均成本: ¥${p.avgCost.toFixed(2)}</div>
                                ${metaExtra}
                                <div class="product-meta" style="color:#ff6b35;">${p.hasActiveListing ? '当前售价' : '建议售价'}: ¥${defaultPrice.toFixed(2)}</div>
                                ${!canPublish ? `<div class="product-meta" style="color:#f44336;">无法上架：商品档案缺失</div>` : ''}
                            </div>
                            ${canPublish
                                ? (hasCS
                                    ? `<button class="btn ${p.hasActiveListing ? 'btn-secondary' : 'btn-primary'} btn-small" 
                                        onclick="ui.showPublishModal('${p.productId}', ${defaultPrice.toFixed(2)}, '${p.qualityGrade}', ${p.hasActiveListing ? 'true' : 'false'})">
                                    ${btnText}
                                </button>`
                                    : `<button class="btn btn-secondary btn-small" disabled title="上架商品需要客服坐镇，请先招聘客服">🔒 需客服</button>`)
                                : `<button class="btn btn-secondary btn-small" disabled title="商品数据异常，无法上架">上架</button>`
                            }
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    renderMarketPage(state) {
        const marketCategory = this._marketCategory || 'all';
        const categories = [{ id: 'all', name: '全部', icon: '🏪' }, ...CATEGORIES.slice(0, 8)];

        const shopLvM = (state.shop && state.shop.level) || 1;
        const unlockedCatalog = (typeof getUnlockedProducts === 'function')
            ? getUnlockedProducts(shopLvM)
            : PRODUCTS;
        const products = marketCategory === 'all'
            ? unlockedCatalog.slice(0, 30)
            : unlockedCatalog.filter(p => p.category === marketCategory);

        // 行情稳定度说明（顶部提示）
        const stabilityTip = `
            <div style="background:#e8f5e9;color:#2e7d32;border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:11px;line-height:1.5;border:1px solid #c8e6c9;">
                ℹ️ 行情每日 <b>00:00</b> 自动更新 1 次（EMA平滑+单日±3%硬限制）。商家名称/品质稳定不变，价格沿趋势缓动。
            </div>
        `;

        return `
            <div style="padding:10px;">
                <div class="card" style="margin-bottom:10px;">
                    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;">
                        ${categories.map(cat => `
                            <div style="text-align:center;padding:8px;border-radius:8px;cursor:pointer;${marketCategory === cat.id ? 'background:#fff3e0;' : 'background:#f9f9f9;'}"
                                 onclick="ui.switchMarketCategory('${cat.id}')">
                                <div style="font-size:20px;">${cat.icon}</div>
                                <div style="font-size:11px;margin-top:2px;color:${marketCategory === cat.id ? '#ff6b35' : '#666'};">${cat.name}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
                ${stabilityTip}
                <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">
                    ${products.map(product => {
                        const category = CATEGORIES.find(c => c.id === product.category);
                        const myListing = state.listings.find(l => l.productId === product.id && l.status === 'active');
                        // 使用缓存+EMA平滑的快照机制（取代原先每次随机生成）
                        const snap = gameState.getOrCreateMarketSnapshot(product.id, 4);
                        const competitors = snap.competitors;
                        const s = snap.summary || { avg: 0, low: 0, high: 0, changePct: 0, trend: '→' };

                        let myPriceRank = '未上架';
                        const lowestPrice = competitors.length > 0 ? competitors[0].price : 0;
                        const avgPrice = s.avg || (competitors.length > 0
                            ? (competitors.reduce((sum, c) => sum + c.price, 0) / competitors.length).toFixed(2)
                            : 0);

                        if (myListing) {
                            const allPrices = [...competitors.map(c => c.price), myListing.price].sort((a, b) => a - b);
                            myPriceRank = '第' + (allPrices.indexOf(myListing.price) + 1) + '名';
                        }

                        // 涨跌标签
                        const changeAbs = Math.abs(s.changePct || 0);
                        let trendBadge = '';
                        if (s.trend === '↑') {
                            trendBadge = `<span style="background:#ffebee;color:#c62828;padding:1px 5px;border-radius:3px;font-size:10px;font-weight:700;">↑ +${changeAbs}%</span>`;
                        } else if (s.trend === '↓') {
                            trendBadge = `<span style="background:#e8f5e9;color:#2e7d32;padding:1px 5px;border-radius:3px;font-size:10px;font-weight:700;">↓ -${changeAbs}%</span>`;
                        } else {
                            trendBadge = `<span style="background:#f5f5f5;color:#777;padding:1px 5px;border-radius:3px;font-size:10px;font-weight:700;">→ 0%</span>`;
                        }

                        return `
                            <div class="card" style="padding:10px;cursor:pointer;"
                                 onclick="ui.showMarketDetail('${product.id}')">
                                <div style="width:100%;aspect-ratio:1;border-radius:8px;overflow:hidden;background:#f5f5f5;display:flex;align-items:center;justify-content:center;">
                                    <img src="${product.image}" alt="${product.name}" style="width:100%;height:100%;object-fit:cover;"
                                         onerror="this.style.display='none';this.parentElement.innerHTML='<div style=\\'font-size:36px;\\'>${category?.icon || '📦'}</div>'">
                                </div>
                                <div style="font-size:13px;color:#333;margin-top:6px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;height:34px;">
                                    ${product.name}
                                </div>
                                <div style="font-size:10px;color:#1565c0;margin-top:2px;font-weight:700;">ID ${product.id}</div>
                                <div style="display:flex;align-items:baseline;gap:2px;margin-top:4px;">
                                    <span style="font-size:11px;color:#999;">¥</span>
                                    <span style="font-size:16px;font-weight:bold;color:#ff6b35;">${Number(lowestPrice).toFixed(2)}</span>
                                    <span style="margin-left:4px;">${trendBadge}</span>
                                    <span style="font-size:10px;color:#999;margin-left:auto;">均¥${Number(avgPrice).toFixed(2)}</span>
                                </div>
                                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;">
                                    <span style="font-size:10px;color:#999;">${competitors.length}+个卖家</span>
                                    <span style="font-size:10px;color:${myListing ? '#4caf50' : '#999'};">
                                        ${myListing ? '✓ 已上架' : '未上架'}
                                    </span>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    switchMarketCategory(catId) {
        this._marketCategory = catId;
        this.render();
    }

    showMarketDetail(productId) {
        const product = PRODUCTS.find(p => p.id === productId);
        const category = CATEGORIES.find(c => c.id === product?.category);
        const state = gameState.state;
        const myListing = state.listings.find(l => l.productId === productId && l.status === 'active');

        // 使用缓存+EMA平滑的快照
        const snap = gameState.getOrCreateMarketSnapshot(productId, 7);
        const competitors = snap.competitors.slice();
        const summary = snap.summary || {};
        const history = (snap.priceHistory || []).slice(-7);

        const allSellers = [...competitors];
        if (myListing) {
            allSellers.push({
                id: 'self',
                name: '👑 我的店铺',
                productId: productId,
                quality: myListing.qualityGrade || 'B',
                price: myListing.price,
                sales: myListing.sales || 0,
                isSelf: true
            });
        }
        allSellers.sort((a, b) => a.price - b.price);

        const gradeColors = { A: '#4caf50', B: '#ff9800', C: '#999' };
        const gradeNames = { A: '优质', B: '良好', C: '一般' };

        // --- 7日迷你趋势图（用 div 高度表示相对均价） ---
        let priceChartHtml = '';
        if (history.length >= 1) {
            const prices = history.map(h => h.avg);
            const max = Math.max(...prices);
            const min = Math.min(...prices);
            const span = Math.max(0.01, max - min);
            const chartMax = max + span * 0.15;
            const chartMin = min - span * 0.15;
            const chartSpan = chartMax - chartMin;
            priceChartHtml = `
                <div style="background:#fafafa;border-radius:10px;padding:10px;border:1px solid #eee;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <div style="font-size:12px;font-weight:700;color:#333;">📈 近${history.length}日均价走势</div>
                        <div style="font-size:10px;color:#666;">
                            区间 <b style="color:#2e7d32;">¥${Number(min).toFixed(2)}</b> ~
                            <b style="color:#c62828;">¥${Number(max).toFixed(2)}</b>
                        </div>
                    </div>
                    <div style="display:flex;align-items:flex-end;gap:4px;height:68px;padding:4px 0;">
                        ${history.map((h, i) => {
                            const pct = Math.max(0.05, (h.avg - chartMin) / chartSpan);
                            const height = pct * 100;
                            const isLast = i === history.length - 1;
                            // 相对前一日涨跌颜色
                            const prevAvg = i > 0 ? history[i - 1].avg : h.avg;
                            const color = h.avg > prevAvg ? '#ef5350' : h.avg < prevAvg ? '#66bb6a' : '#90a4ae';
                            return `
                                <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;">
                                    <div style="font-size:9px;color:#333;font-weight:700;">
                                        ${Number(h.avg).toFixed(0)}
                                    </div>
                                    <div style="width:100%;height:${height}%;
                                                background:${isLast ? '#1976d2' : color};
                                                border-radius:3px 3px 0 0;min-height:4px;opacity:${isLast?1:.75};"></div>
                                    <div style="font-size:8px;color:#888;">D${h.day}</div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }

        // --- 涨跌概览卡 ---
        const changeAbs = Math.abs(summary.changePct || 0);
        let trendCard = '';
        if (summary.trend === '↑') {
            trendCard = `<div style="flex:1;background:#ffebee;color:#c62828;padding:7px 6px;border-radius:8px;text-align:center;">
                <div style="font-weight:900;font-size:15px;">↑ +${changeAbs}%</div>
                <div style="font-size:9px;opacity:.85;">较昨日上涨</div>
            </div>`;
        } else if (summary.trend === '↓') {
            trendCard = `<div style="flex:1;background:#e8f5e9;color:#2e7d32;padding:7px 6px;border-radius:8px;text-align:center;">
                <div style="font-weight:900;font-size:15px;">↓ -${changeAbs}%</div>
                <div style="font-size:9px;opacity:.85;">较昨日下跌</div>
            </div>`;
        } else {
            trendCard = `<div style="flex:1;background:#f5f5f5;color:#555;padding:7px 6px;border-radius:8px;text-align:center;">
                <div style="font-weight:900;font-size:15px;">→ ${changeAbs}%</div>
                <div style="font-size:9px;opacity:.85;">横盘整理</div>
            </div>`;
        }
        // 稳定度：基于历史日波动率（标准差估计简化版用history的max-min差占均价比例）
        const avgPrice = summary.avg || (allSellers.reduce((s, c) => s + c.price, 0) / allSellers.length);
        let stabilityStars = 3;
        if (history.length >= 3) {
            const volaRatio = (Math.max(...history.map(h => h.high)) - Math.min(...history.map(h => h.low))) / Math.max(0.01, history[history.length - 1].avg);
            if (volaRatio < 0.04) stabilityStars = 5;          // <4% 极稳定
            else if (volaRatio < 0.08) stabilityStars = 4;     // 4-8% 较稳定
            else if (volaRatio < 0.15) stabilityStars = 3;     // 8-15% 一般
            else if (volaRatio < 0.25) stabilityStars = 2;     // 15-25% 波动大
            else stabilityStars = 1;                           // >25% 剧烈波动
        }
        const starStr = '★'.repeat(stabilityStars) + '☆'.repeat(5 - stabilityStars);
        const stabilityColor = ['#f44336', '#ff9800', '#ffc107', '#9ccc65', '#4caf50'][stabilityStars - 1] || '#4caf50';

        const lowestPrice = allSellers[0]?.price || 0;

        const content = `
            <div>
                <div style="display:flex;gap:10px;margin-bottom:12px;">
                    <div style="width:80px;height:80px;border-radius:8px;overflow:hidden;background:#f5f5f5;flex-shrink:0;display:flex;align-items:center;justify-content:center;">
                        <img src="${product.image}" alt="${product.name}" style="width:100%;height:100%;object-fit:cover;"
                             onerror="this.style.display='none';this.parentElement.innerHTML='<div style=\\'font-size:32px;\\'>${category?.icon || '📦'}</div>'">
                    </div>
                    <div style="flex:1;">
                        <div style="font-size:15px;font-weight:bold;">${product.name}</div>
                        <div style="font-size:12px;color:#999;margin-top:4px;">${category?.name || ''} · ${allSellers.length}个卖家在售</div>
                        <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">
                            <div style="background:#fff3e0;color:#e65100;padding:3px 7px;border-radius:5px;font-size:11px;">
                                最低 <b>¥${Number(lowestPrice).toFixed(2)}</b>
                            </div>
                            <div style="background:#e3f2fd;color:#0d47a1;padding:3px 7px;border-radius:5px;font-size:11px;">
                                均价 <b>¥${Number(avgPrice).toFixed(2)}</b>
                            </div>
                            <div style="background:#f3e5f5;color:#6a1b9a;padding:3px 7px;border-radius:5px;font-size:11px;">
                                稳定度 <b style="color:${stabilityColor};">${starStr}</b>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 涨跌 + 指标概览 3+1 卡片 -->
                <div style="display:flex;gap:6px;margin-bottom:10px;">
                    ${trendCard}
                    <div style="flex:1;background:#e3f2fd;color:#0d47a1;padding:7px 6px;border-radius:8px;text-align:center;">
                        <div style="font-weight:900;font-size:14px;">¥${Number(summary.low || lowestPrice).toFixed(0)}</div>
                        <div style="font-size:9px;opacity:.85;">今日最低</div>
                    </div>
                    <div style="flex:1;background:#fff3e0;color:#e65100;padding:7px 6px;border-radius:8px;text-align:center;">
                        <div style="font-weight:900;font-size:14px;">¥${Number(summary.high || lowestPrice * 1.1).toFixed(0)}</div>
                        <div style="font-size:9px;opacity:.85;">今日最高</div>
                    </div>
                    <div style="flex:1;background:#f3e5f5;color:#4a148c;padding:7px 6px;border-radius:8px;text-align:center;">
                        <div style="font-weight:900;font-size:14px;">¥${Number(summary.prevAvg || summary.avg || avgPrice).toFixed(0)}</div>
                        <div style="font-size:9px;opacity:.85;">昨日均价</div>
                    </div>
                </div>

                ${priceChartHtml || ''}

                <div style="background:#fff8e1;padding:8px 10px;border-radius:8px;margin:10px 0;">
                    <div style="font-size:11px;color:#f57c00;line-height:1.5;">
                        💡 行情更新：<b>每日00:00（游戏时间）</b> EMA平滑刷新，单日波动硬限制 <b>±3%</b>。<br/>
                        价格越低，获得的流量越多，但利润也越少。找到性价比平衡点才能赚更多！
                    </div>
                </div>

                <div style="font-size:13px;font-weight:bold;margin-bottom:8px;">同行报价</div>

                <div style="max-height:300px;overflow-y:auto;">
                    ${allSellers.map((seller, idx) => `
                        <div style="display:flex;align-items:center;padding:8px 0;border-bottom:1px solid #f0f0f0;${seller.isSelf ? 'background:#e8f5e9;margin:0 -10px;padding:8px 10px;border-radius:8px;' : ''}">
                            <div style="width:24px;text-align:center;font-size:14px;font-weight:bold;color:${idx === 0 ? '#ff6b35' : idx === 1 ? '#ff9800' : idx === 2 ? '#ffc107' : '#999'};">
                                ${idx + 1}
                            </div>
                            <div style="flex:1;margin-left:8px;">
                                <div style="font-size:13px;font-weight:${seller.isSelf ? 'bold' : 'normal'};color:${seller.isSelf ? '#2e7d32' : '#333'};">
                                    ${seller.name}
                                </div>
                                <div style="font-size:11px;color:#999;margin-top:2px;">
                                    <span style="display:inline-block;padding:1px 5px;background:${gradeColors[seller.quality]};color:white;border-radius:3px;font-size:10px;">${gradeNames[seller.quality]}</span>
                                    <span style="margin-left:6px;">已售${seller.sales}件</span>
                                </div>
                            </div>
                            <div style="text-align:right;">
                                <div style="font-size:16px;font-weight:bold;color:#ff6b35;">¥${Number(seller.price).toFixed(2)}</div>
                                ${seller.isSelf ? '<div style="font-size:10px;color:#4caf50;">这是我</div>' : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        let footer = '';
        if (myListing) {
            footer = `
                <button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>
                <button class="btn btn-primary" onclick="ui.quickPurchaseFromMarket('${productId}')">快速采购</button>
                <button class="btn btn-primary" onclick="ui.showEditPriceModal('${myListing.id}')">修改价格</button>
            `;
        } else {
            footer = `
                <button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>
                <button class="btn btn-primary" onclick="ui.quickPurchaseFromMarket('${productId}')">快速采购</button>
                <button class="btn btn-secondary" onclick="ui.closeModal();ui.switchTab('products', 'publish');">去上架</button>
            `;
        }

        this.showModal('市场行情 - ' + product.name, content, footer);
    }

    renderOrdersPage(state) {
        const currentTab = this.currentTab.orders || 'pending_payment';
        const tabs = [
            { id: 'pending_payment', name: '待付款' },
            { id: 'pending_packing', name: '待打包' },
            { id: 'pending_shipment', name: '待发货' },
            { id: 'shipped', name: '已发货' },
            { id: 'completed', name: '已完成' },
            { id: 'cancelled', name: '已取消' },
            { id: 'all', name: '全部' }
        ];

        // 统一计数源：复用 _countOrders，确保与仪表盘/状态哈希完全一致
        const c = this._countOrders(state);
        const counter = {
            pending_payment: c.pendingPayment,
            pending_packing: c.pendingPacking,
            pending_shipment: c.pendingShip,
            shipped: c.shipped,
            completed: c.completed,
            cancelled: c.cancelled,
            all: c.all
        };

        // ===== 性能：用 OrderPerf Map 桶取池（禁止 byStatus[tab]）；只保留最近窗口分页 =====
        const ALL_ORDERS = state.orders || [];
        let orderPool = [];
        const showHiddenInTab = (currentTab === 'completed' || currentTab === 'cancelled' || currentTab === 'returned');
        let usedIndex = false;
        let realTotal = 0;
        try {
            if (typeof OrderPerf !== 'undefined' && OrderPerf.enabled && OrderPerf.getStatusBucket) {
                OrderPerf.ensure(ALL_ORDERS);
                if (!OrderPerf.dirty && OrderPerf.ordersRef === ALL_ORDERS) {
                    const takeBucket = (st, keepHidden) => {
                        const src = OrderPerf.getStatusBucket(st);
                        for (let i = 0, len = src.length; i < len; i++) {
                            const o = src[i];
                            if (!o) continue;
                            if (!keepHidden && o.hidden) continue;
                            orderPool.push(o);
                        }
                    };
                    if (currentTab === 'all') {
                        ['pending_payment', 'pending_packing', 'pending_shipment', 'shipped'].forEach(st => takeBucket(st, false));
                    } else {
                        takeBucket(currentTab, showHiddenInTab);
                    }
                    usedIndex = true;
                    if (currentTab === 'all') realTotal = c.all;
                    else if (currentTab === 'pending_payment') realTotal = c.pendingPayment;
                    else if (currentTab === 'pending_packing') realTotal = c.pendingPacking;
                    else if (currentTab === 'pending_shipment') realTotal = c.pendingShip;
                    else if (currentTab === 'shipped') realTotal = c.shipped;
                    else if (currentTab === 'completed') realTotal = c.completed;
                    else if (currentTab === 'cancelled') realTotal = c.cancelled;
                    else realTotal = orderPool.length;
                }
            }
        } catch (_) { usedIndex = false; orderPool = []; }
        if (!usedIndex) {
            if (currentTab === 'all') {
                for (let i = 0, len = ALL_ORDERS.length; i < len; i++) {
                    const o = ALL_ORDERS[i];
                    if (!o || o.hidden) continue;
                    orderPool.push(o);
                }
            } else if (showHiddenInTab) {
                for (let i = 0, len = ALL_ORDERS.length; i < len; i++) {
                    const o = ALL_ORDERS[i];
                    if (o && o.status === currentTab) orderPool.push(o);
                }
            } else {
                for (let i = 0, len = ALL_ORDERS.length; i < len; i++) {
                    const o = ALL_ORDERS[i];
                    if (o && !o.hidden && o.status === currentTab) orderPool.push(o);
                }
            }
            realTotal = orderPool.length;
        }

        const SORT_WINDOW = 400;
        if (orderPool.length > SORT_WINDOW) {
            orderPool = orderPool.slice(-SORT_WINDOW);
        }
        orderPool.sort((a, b) => {
            const at = ((a.createTime && a.createTime.day) - 1) * 24 + ((a.createTime && a.createTime.hour) || 0);
            const bt = ((b.createTime && b.createTime.day) - 1) * 24 + ((b.createTime && b.createTime.hour) || 0);
            return bt - at;
        });

        const totalOrders = orderPool.length;
        const truncatedHint = (realTotal > totalOrders)
            ? ('（共 ' + realTotal + ' 条，列表仅展示最近 ' + totalOrders + ' 条）')
            : '';

        // ===== 性能优化3：分页渲染；爆单时按 OrderPerf 建议缩小每页条数 =====
        this._ordersPage = this._ordersPage || {};
        let page = parseInt(this._ordersPage[currentTab]) || 1;
        let pageSize = this._ordersPageSize || 50;
        if (!this._ordersPageSizeLocked) {
            try {
                if (typeof OrderPerf !== 'undefined' && OrderPerf.recommendPageSize) {
                    pageSize = Math.min(60, OrderPerf.recommendPageSize(ALL_ORDERS.length));
                }
            } catch (_) {}
            // fps 保护：已掉帧时每页再缩到 25 条（少 15 张 SVG 解码光栅化 ≈ 少 70KB DOM）
            try {
                if (typeof gameEngine !== 'undefined' && gameEngine && gameEngine.fps > 0 && gameEngine.fps < 20) {
                    pageSize = Math.min(pageSize, 25);
                }
            } catch (_) {}
        }
        const totalPages = Math.max(1, Math.ceil(totalOrders / pageSize));
        if (page > totalPages) page = totalPages;
        if (page < 1) page = 1;
        this._ordersPage[currentTab] = page;
        const startIdx = (page - 1) * pageSize;
        const endIdx = Math.min(totalOrders, startIdx + pageSize);
        const pageOrders = orderPool.slice(startIdx, endIdx);
        const showingFrom = totalOrders === 0 ? 0 : startIdx + 1;
        const showingTo = endIdx;

        // 分页控件
        let paginationHtml = '';
        if (totalOrders > pageSize) {
            const prevDisabled = page <= 1 ? 'opacity:0.4;pointer-events:none;' : '';
            const nextDisabled = page >= totalPages ? 'opacity:0.4;pointer-events:none;' : '';
            paginationHtml = `
                <div style="padding:14px 15px;background:#fafafa;border-top:1px solid #eee;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
                    <div style="font-size:12px;color:#666;">
                        第 ${showingFrom}-${showingTo} 条 / 共 ${totalOrders} 条 (第 ${page}/${totalPages} 页)${typeof truncatedHint !== 'undefined' ? truncatedHint : ''}
                    </div>
                    <div style="display:flex;gap:6px;align-items:center;">
                        <button class="btn btn-secondary btn-small" style="${prevDisabled}" 
                                onclick="ui.setOrdersPage('${currentTab}', ${page - 1})">
                            ‹ 上一页
                        </button>
                        ${page > 2 ? `<button class="btn btn-secondary btn-small" onclick="ui.setOrdersPage('${currentTab}', 1)">1</button>
                                      ${page > 3 ? `<span style="color:#999;padding:0 2px;">…</span>` : ''}` : ''}
                        ${page > 1 ? `<button class="btn btn-secondary btn-small" onclick="ui.setOrdersPage('${currentTab}', ${page - 1})">${page - 1}</button>` : ''}
                        <button class="btn btn-primary btn-small" style="min-width:36px;">${page}</button>
                        ${page < totalPages ? `<button class="btn btn-secondary btn-small" onclick="ui.setOrdersPage('${currentTab}', ${page + 1})">${page + 1}</button>` : ''}
                        ${page < totalPages - 1 ? `${page < totalPages - 2 ? `<span style="color:#999;padding:0 2px;">…</span>` : ''}
                                      <button class="btn btn-secondary btn-small" onclick="ui.setOrdersPage('${currentTab}', ${totalPages})">${totalPages}</button>` : ''}
                        <button class="btn btn-secondary btn-small" style="${nextDisabled}"
                                onclick="ui.setOrdersPage('${currentTab}', ${page + 1})">
                            下一页 ›
                        </button>
                    </div>
                </div>
            `;
        }

        const orderCardsHtml = pageOrders.length === 0
            ? (totalOrders === 0
                ? `<div class="empty-state"><div class="icon">📋</div><div class="text">暂无订单</div></div>`
                : `<div class="empty-state"><div class="icon">📋</div><div class="text">本页无更多订单</div><button class="btn btn-primary" style="margin-top:15px;" onclick="ui.setOrdersPage('${currentTab}', 1)">回到第1页</button></div>`)
            : pageOrders.map(order => this.renderOrderItem(order)).join('');

        return `
            <div class="page">
                <div class="tabs" data-guide="orders-tabs">
                    ${tabs.map(tab => `
                        <div class="tab-item ${currentTab === tab.id ? 'active' : ''}"
                             data-tab="${tab.id}"
                             onclick="ui.switchTab('orders', '${tab.id}')">
                            ${tab.name}
                            <span class="badge" data-order-count="${tab.id}" style="margin-left:4px;font-size:10px;">
                                ${counter[tab.id] ?? counter.all}
                            </span>
                        </div>
                    `).join('')}
                </div>

                ${currentTab === 'pending_packing' && totalOrders > 0 ? `
                    <div style="padding:10px 15px;background:#e3f2fd;border-bottom:1px solid #eee;display:flex;align-items:center;justify-content:space-between;">
                        <div style="font-size:13px;color:#1976d2;">
                            共 ${counter.pending_packing} 个订单待打包
                        </div>
                        <button class="btn btn-primary btn-small" onclick="ui.showBatchPackModal()">
                            📦 一键打包
                        </button>
                    </div>
                ` : ''}

                ${currentTab === 'pending_shipment' && totalOrders > 0 ? `
                    <div style="padding:10px 15px;background:#fff8e1;border-bottom:1px solid #eee;display:flex;align-items:center;justify-content:space-between;">
                        <div style="font-size:13px;color:#f57c00;">
                            共 ${counter.pending_shipment} 个订单待发货
                        </div>
                        <button class="btn btn-primary btn-small" onclick="ui.showBatchShipModal()">
                            🚚 一键发货
                        </button>
                    </div>
                ` : ''}

                ${orderCardsHtml}
                ${paginationHtml}
            </div>
        `;
    }

    /**
     * 订单列表分页跳转（配合分页按钮调用）
     */
    setOrdersPage(tabId, page) {
        this._ordersPage = this._ordersPage || {};
        this._ordersPage[tabId] = Math.max(1, parseInt(page) || 1);
        this.currentTab.orders = tabId;
        this.render();
    }

    renderOrderItem(order) {
        // ===== 性能优化：使用缓存的 productsById / categoriesById 避免每次 find =====
        const cache = this._cache || {};
        const product = (cache.productsById && cache.productsById.get(order.productId)) ||
                        (typeof PRODUCTS !== 'undefined' ? PRODUCTS.find(p => p.id === order.productId) : null);
        const category = product
            ? ((cache.categoriesById && cache.categoriesById.get(product.category)) ||
               (typeof CATEGORIES !== 'undefined' ? CATEGORIES.find(c => c.id === product.category) : null))
            : null;
        const statusInfo = cache.orderStatuses
            ? cache.orderStatuses.find(s => s.code === order.status)
            : (typeof ORDER_STATUS !== 'undefined' ? ORDER_STATUS.find(s => s.code === order.status) : null);
        const express = (cache.expressOptions && order.expressType) ? cache.expressOptions[order.expressType] : null;
        const gradeInfo = cache.qualityGrades ? cache.qualityGrades[order.qualityGrade] : null;
        
        let feeDisplay = '';
        // 待打包和待发货状态显示费用
        if ((order.status === 'pending_packing' || order.status === 'pending_shipment') && product) {
            try {
                const fees = typeof gameEngine !== 'undefined' ? gameEngine.getOrderFees(order) : null;
                if (fees) {
                    const discInfo = (typeof gameEngine !== 'undefined' && typeof gameEngine.getExpressSuccessOrderDiscount === 'function')
                        ? gameEngine.getExpressSuccessOrderDiscount()
                        : null;
                    const expressTag = discInfo && discInfo.discount < 1.0
                        ? `（已享${discInfo.label}）`
                        : '';
                    feeDisplay = `
                        <div style="font-size:12px;color:#666;margin-top:4px;">
                            打包费: ¥${(fees.packFee || 0).toFixed(2)} | 包装费: ¥${(fees.packagingMaterialFee || 0).toFixed(2)} | 快递费: ¥${(fees.expressFee || 0).toFixed(2)}${expressTag}
                        </div>
                    `;
                }
            } catch (e) { /* 费用计算异常静默跳过，避免影响列表渲染 */ }
        }

        let profitDisplay = '';
        if (order.status === 'shipped' || order.status === 'completed') {
            try {
                // 列表性能：优先用订单上缓存的利润，避免每卡完整成本拆解
                let profitSafe = null;
                if (typeof order._listProfit === 'number' && Number.isFinite(order._listProfit)) {
                    profitSafe = order._listProfit;
                } else {
                    const bd = this._getOrderCostBreakdown(order);
                    profitSafe = Number(bd && bd.profit);
                    if (Number.isFinite(profitSafe)) order._listProfit = profitSafe;
                }
                if (!Number.isFinite(profitSafe)) profitSafe = 0;
                const profitColor = profitSafe >= 0 ? '#4caf50' : '#f44336';
                profitDisplay = `
                    <div style="font-size:12px;color:${profitColor};margin-top:4px;font-weight:bold;">
                        利润: ¥${profitSafe.toFixed(2)}
                        <span style="font-weight:400;color:#999;margin-left:6px;">点击查看明细 ›</span>
                    </div>
                `;
            } catch (_) {
                profitDisplay = '';
            }
        }
        
        let expressTag = '';
        if (express && (order.status === 'shipped' || order.status === 'completed')) {
            expressTag = `<span class="badge" style="margin-left:6px;background:${express.color};color:white;font-size:10px;">${express.shortName}</span>`;
        }
        
        let packStatus = '';
        if (order.status === 'pending_payment') {
            packStatus = `<span class="badge" style="margin-left:6px;background:#ff9800;color:white;font-size:10px;">⏳待付款</span>`;
        } else if (order.status === 'pending_packing') {
            packStatus = `<span class="badge" style="margin-left:6px;background:#ff5722;color:white;font-size:10px;">📦待打包</span>`;
        } else if (order.status === 'pending_shipment') {
            packStatus = `<span class="badge" style="margin-left:6px;background:#f44336;color:white;font-size:10px;">🚚待发货</span>`;
        }

        let gradeTag = '';
        if (gradeInfo) {
            const gradeColors = { A: '#4caf50', B: '#ff9800', C: '#999' };
            gradeTag = `<span class="badge" style="margin-left:6px;background:${gradeColors[gradeInfo.grade]};color:white;font-size:10px;">${gradeInfo.name}</span>`;
        }
        
        let memberTag = '';
        if (order.isMember) {
            memberTag = `<span class="badge" style="margin-left:6px;background:#ff9800;color:white;font-size:10px;">👑会员</span>`;
        }
        
        let couponTag = '';
        if (order.usedCoupon && order.couponDiscount > 0) {
            couponTag = `<span class="badge" style="margin-left:6px;background:#e91e63;color:white;font-size:10px;">🎫-¥${order.couponDiscount.toFixed(2)}</span>`;
        }
        
        let marketingTag = '';
        if (order.fromMarketing) {
            const sourceName = order.marketingCampaignName || order.marketingEmployeeName || '营销推广';
            const badgeColor = order.marketingCampaignSource === 'activeCampaign' ? '#673ab7' : '#9c27b0';
            marketingTag = `<span class="badge" style="margin-left:6px;background:${badgeColor};color:white;font-size:10px;"
                                  title="来自${sourceName}的营销推广">
                                📣${order.marketingCampaignSource === 'activeCampaign' ? '活动' : '推广'}
                            </span>`;
        }

        // 轻量容错：核心数值字段
        const unitPrice = typeof order.unitPrice === 'number' ? order.unitPrice : 0;
        const quantity = typeof order.quantity === 'number' ? order.quantity : 1;
        const totalAmount = typeof order.totalAmount === 'number' ? order.totalAmount : unitPrice * quantity;
        const orderIdShort = (order.id || '').slice(-10) || '—';
        const buyerName = order.buyerName || '未知买家';
        const cityName = (order.buyerAddress && order.buyerAddress.cityName) || '未知';
        const createTime = order.createTime || { day: 1, hour: 0 };
        const canViewDetail = order.status === 'shipped' || order.status === 'completed';
        const clickAttr = canViewDetail
            ? `onclick="ui.showOrderDetail('${order.id}')" class="order-item order-item-clickable"`
            : `class="order-item"`;
        
        return `
            <div ${clickAttr}>
                <div class="order-header">
                    <div class="order-id">订单号: ${orderIdShort}${marketingTag}${expressTag}${packStatus}${gradeTag}${memberTag}${couponTag}</div>
                    <div class="order-status" style="color:${statusInfo?.color || '#666'}">${statusInfo?.name || order.status || ''}</div>
                </div>
                <div class="order-body">
                    <div class="order-product">
                        <div class="order-product-img" style="width:50px;height:50px;border-radius:8px;overflow:hidden;background:#f5f5f5;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                            <img src="${this.getProductImageLite(order.productId, order.qualityGrade || 'B')}" alt="${order.productName || ''}" style="width:100%;height:100%;object-fit:cover;"
                                 onerror="this.style.display='none';this.parentElement.innerHTML='<div style=\\'font-size:22px;\\'>${category?.icon || '📦'}</div>'">
                        </div>
                        <div class="order-product-info">
                            <div class="order-product-name">${order.productName || (product ? product.name : '商品')}</div>
                            <div class="order-product-price">¥${unitPrice.toFixed(2)} x ${quantity}</div>
                        </div>
                    </div>
                    <div style="font-size:12px;color:#999;">
                        买家: ${buyerName} | 收货地: ${cityName} | ${typeof formatDate === 'function' ? formatDate(createTime.day, createTime.hour) : `D${createTime.day} ${createTime.hour}:00`}
                    </div>
                    ${order.packageWeightKg ? `<div style="font-size:11px;color:#bbb;margin-top:2px;">包裹重量: ${order.packageWeightKg.toFixed(2)}kg</div>` : ''}
                    ${feeDisplay}
                    ${profitDisplay}
                </div>
                <div class="order-footer">
                    <div class="order-total">合计: <span>¥${totalAmount.toFixed(2)}</span></div>
                    <div class="order-actions" onclick="event.stopPropagation()">
                        ${order.status === 'pending_payment' ? `
                            <button class="btn btn-secondary btn-small" onclick="ui.cancelPendingOrder('${order.id}')">取消</button>
                        ` : ''}
                        ${order.status === 'pending_packing' ? `
                            <button class="btn btn-secondary btn-small" onclick="ui.packOrder('${order.id}')">📦 手动打包</button>
                        ` : ''}
                        ${order.status === 'pending_shipment' ? `
                            <button class="btn btn-primary btn-small" onclick="ui.shipOrder('${order.id}')">🚚 发货</button>
                        ` : ''}
                        ${order.status === 'shipped' ? `
                            <button class="btn btn-primary btn-small" onclick="ui.showOrderDetail('${order.id}')">详情</button>
                            <button class="btn btn-secondary btn-small" onclick="ui.showLogistics('${order.id}')">物流</button>
                        ` : ''}
                        ${order.status === 'completed' ? `
                            <button class="btn btn-primary btn-small" onclick="ui.showOrderDetail('${order.id}')">详情</button>
                            ${order.review ? `<button class="btn btn-secondary btn-small" onclick="ui.showReview('${order.id}')">评价</button>` : ''}
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    renderMarketingPage(state) {
        const currentTab = this.currentTab.marketing || 'campaigns';
        const tabs = [
            { id: 'campaigns', name: '营销推广' },
            { id: 'promo_activities', name: '促销活动' },
            { id: 'celebrities', name: '明星代言' },
            { id: 'coupons', name: '优惠券' },
            { id: 'promotions', name: '推广记录' }
        ];

        return `
            <div class="page">
                <div class="wb-subbar">
                    <button type="button" class="wb-back" onclick="ui.navigateTo('dashboard')">‹ 首页</button>
                    <div class="wb-subbar-title">营销推广</div>
                    <div style="font-size:11px;color:#e65100;margin-left:8px;">投放/促销/代言才会放量接单</div>
                </div>
                <div class="tabs">
                    ${tabs.map(tab => `
                        <div class="tab-item ${currentTab === tab.id ? 'active' : ''}" 
                             onclick="ui.switchTab('marketing', '${tab.id}')">${tab.name}</div>
                    `).join('')}
                </div>

                ${currentTab === 'campaigns' ? this.renderCampaigns(state) : ''}
                ${currentTab === 'promo_activities' ? this.renderPromoActivitiesPage(state) : ''}
                ${currentTab === 'celebrities' ? this.renderCelebrities(state) : ''}
                ${currentTab === 'coupons' ? this.renderCouponsPage(state) : ''}
                ${currentTab === 'promotions' ? this.renderPromotionLogs(state) : ''}
            </div>
        `;
    }

    renderPromoActivitiesPage(state) {
        const subTab = this._promoSubTab || 'list';
        const subTabs = [
            { id: 'list', name: '活动列表', icon: '📋' },
            { id: 'create', name: '创建活动', icon: '➕' },
            { id: 'stats', name: '数据统计', icon: '📊' }
        ];
        
        const stats = gameState.getPromotionStatistics();
        const activePromotions = gameState.getActivePromotions();
        
        return `
            <div class="card" style="margin-bottom:10px;">
                <div class="card-header">
                    <div class="card-title">🎪 促销活动中心</div>
                    <button class="btn btn-primary btn-sm" onclick="ui.switchPromoSubTab('create')">
                        ➕ 创建活动
                    </button>
                </div>
                <div style="padding:10px 12px;">
                    <div style="font-size:12px;color:#e65100;line-height:1.55;margin-bottom:10px;padding:8px 10px;background:#fff8e1;border-radius:8px;">
                        进行中的促销会当作营销动作：自然单闸门放开，订单量明显上升。开局即可创建秒杀/满减/拼团/盲盒。
                    </div>
                    <div class="stats-grid" style="grid-template-columns:repeat(4,1fr);gap:6px;">
                        <div style="background:linear-gradient(135deg,#e3f2fd,#bbdefb);padding:8px;border-radius:8px;text-align:center;">
                            <div style="font-size:16px;font-weight:700;color:#1565c0;">${stats.overview.totalCampaigns}</div>
                            <div style="font-size:10px;color:#1565c0;">总活动数</div>
                        </div>
                        <div style="background:linear-gradient(135deg,#e8f5e9,#c8e6c9);padding:8px;border-radius:8px;text-align:center;">
                            <div style="font-size:16px;font-weight:700;color:#2e7d32;">${stats.overview.activeCampaigns}</div>
                            <div style="font-size:10px;color:#2e7d32;">进行中</div>
                        </div>
                        <div style="background:linear-gradient(135deg,#fff3e0,#ffe0b2);padding:8px;border-radius:8px;text-align:center;">
                            <div style="font-size:16px;font-weight:700;color:#ef6c00;">${formatMoney(stats.overview.totalDiscountAmount)}</div>
                            <div style="font-size:10px;color:#ef6c00;">优惠金额</div>
                        </div>
                        <div style="background:linear-gradient(135deg,#fce4ec,#f8bbd0);padding:8px;border-radius:8px;text-align:center;">
                            <div style="font-size:16px;font-weight:700;color:#c2185b;">${formatMoney(stats.overview.totalSalesFromPromo)}</div>
                            <div style="font-size:10px;color:#c2185b;">活动GMV</div>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="tabs" style="margin-bottom:10px;">
                ${subTabs.map(tab => `
                    <div class="tab-item ${subTab === tab.id ? 'active' : ''}" 
                         onclick="ui.switchPromoSubTab('${tab.id}')" style="font-size:12px;">
                        ${tab.icon} ${tab.name}
                    </div>
                `).join('')}
            </div>
            
            ${subTab === 'list' ? this.renderPromoList(state) : ''}
            ${subTab === 'create' ? this.renderPromoCreateForm(state) : ''}
            ${subTab === 'stats' ? this.renderPromoStats(state, stats) : ''}
        `;
    }

    switchPromoSubTab(tabId) {
        this._promoSubTab = tabId;
        this._editingPromoId = null;
        this.render();
    }

    renderPromoList(state) {
        const campaigns = gameState.getPromotions();
        const statusFilter = this._promoStatusFilter || 'all';
        
        let filtered = campaigns;
        if (statusFilter !== 'all') {
            filtered = campaigns.filter(c => c.status === statusFilter);
        }
        
        const statusOptions = [
            { id: 'all', name: '全部' },
            { id: 'draft', name: '草稿' },
            { id: 'pending', name: '未开始' },
            { id: 'active', name: '进行中' },
            { id: 'paused', name: '已暂停' },
            { id: 'ended', name: '已结束' }
        ];
        
        const getTypeInfo = (type) => {
            const tid = (typeof normalizePromotionTypeId === 'function') ? normalizePromotionTypeId(type) : type;
            const types = Object.values(PROMOTION_TYPES || {});
            return types.find(t => t.id === tid || t.id === type) || { id: tid, name: '促销活动', icon: '📌', color: '#999' };
        };
        
        const getStatusInfo = (status) => {
            const statuses = (typeof PROMOTION_STATUS !== 'undefined') ? Object.values(PROMOTION_STATUS) : [];
            return statuses.find(s => s.id === status) || { id: status, name: '未知状态', color: '#999', icon: '❓' };
        };
        
        return `
            <div style="display:flex;gap:4px;margin-bottom:10px;flex-wrap:wrap;">
                ${statusOptions.map(opt => `
                    <button class="btn ${statusFilter === opt.id ? 'btn-primary' : 'btn-light'} btn-sm"
                            onclick="ui.setPromoStatusFilter('${opt.id}')" style="font-size:11px;padding:4px 8px;">
                        ${opt.name}
                    </button>
                `).join('')}
            </div>
            
            ${filtered.length === 0 ? `
                <div class="card" style="text-align:center;padding:40px 20px;color:#999;">
                    <div style="font-size:48px;margin-bottom:10px;">🎪</div>
                    <div>暂无促销活动</div>
                    <button class="btn btn-primary btn-sm" style="margin-top:15px;"
                            onclick="ui.switchPromoSubTab('create')">
                        ➕ 创建第一个活动
                    </button>
                </div>
            ` : filtered.map(campaign => {
                const typeInfo = getTypeInfo(campaign.type);
                const statusInfo = getStatusInfo(campaign.status);
                const rules = campaign.rules || {};
                const typeKey = (typeof normalizePromotionTypeId === 'function')
                    ? normalizePromotionTypeId(campaign.type)
                    : campaign.type;
                let ruleDesc = '';
                switch(typeKey) {
                    case 'fullReduction':
                    case 'full_reduction':
                        ruleDesc = (rules.tiers || []).map(t => `满${t.threshold}减${t.discount}`).join('，')
                            || (rules.threshold != null ? `满${rules.threshold}减${rules.discount || rules.reduction || 0}` : '满减活动');
                        break;
                    case 'discount':
                        ruleDesc = `${((Number(rules.rate) || 0) * 10).toFixed(1)}折${rules.minAmount ? '，满' + rules.minAmount + '可用' : ''}`;
                        break;
                    case 'coupon':
                        ruleDesc = `${rules.denomination || 0}元券，满${rules.minPurchase || 0}可用，共${rules.quantity || 0}张`;
                        break;
                    case 'flashSale':
                    case 'flash_sale': {
                        const rate = Number(rules.discountRate != null ? rules.discountRate : rules.rate) || 0;
                        ruleDesc = `${(rate * 10).toFixed(1)}折，限量${rules.stock || 0}件，已售${rules.sold || 0}`;
                        break;
                    }
                    case 'freeShipping':
                    case 'free_shipping':
                        ruleDesc = `满${rules.threshold || 0}元包邮`;
                        break;
                    case 'gift':
                        ruleDesc = `买赠活动，满${rules.minPurchase || 0}赠礼品`;
                        break;
                    case 'groupBuy':
                    case 'group_buy':
                        ruleDesc = `拼团${rules.groupSize || rules.minMembers || 2}人，优惠进行中`;
                        break;
                    case 'blindBox':
                    case 'blind_box':
                        ruleDesc = `盲盒福袋 ¥${rules.price || rules.boxPrice || '—'}`;
                        break;
                    default:
                        ruleDesc = typeInfo.name || '促销活动';
                }
                
                return `
                    <div class="card" style="margin-bottom:8px;border-left:4px solid ${typeInfo.color};">
                        <div style="padding:12px;">
                            <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                                <div style="flex:1;">
                                    <div style="font-weight:600;font-size:14px;margin-bottom:4px;">
                                        ${typeInfo.icon} ${escapeHtml(campaign.name)}
                                        <span class="badge" style="background:${statusInfo.color}20;color:${statusInfo.color};font-size:10px;margin-left:6px;">
                                            ${statusInfo.icon} ${statusInfo.name}
                                        </span>
                                    </div>
                                    <div style="font-size:11px;color:#666;margin-bottom:4px;">
                                        ${ruleDesc}
                                    </div>
                                    <div style="font-size:11px;color:#999;">
                                        📅 第${campaign.startTime.day}天${campaign.startTime.hour}点 - 第${campaign.endTime.day}天${campaign.endTime.hour}点
                                    </div>
                                </div>
                            </div>
                            <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;">
                                <div style="flex:1;display:flex;gap:8px;font-size:11px;color:#666;">
                                    <span>👥 ${campaign.statistics.participants}人参与</span>
                                    <span>💰 ${formatMoney(campaign.statistics.discountAmount)}优惠</span>
                                    <span>📦 ${campaign.statistics.orders}单</span>
                                </div>
                                <div style="display:flex;gap:4px;">
                                    ${campaign.status === 'draft' || campaign.status === 'pending' ? `
                                        <button class="btn btn-success btn-sm" onclick="ui.startPromotion('${campaign.id}')" style="font-size:11px;padding:3px 8px;">
                                            ▶️ 启动
                                        </button>
                                    ` : ''}
                                    ${campaign.status === 'active' ? `
                                        <button class="btn btn-warning btn-sm" onclick="ui.pausePromotion('${campaign.id}')" style="font-size:11px;padding:3px 8px;">
                                            ⏸️ 暂停
                                        </button>
                                    ` : ''}
                                    ${campaign.status === 'paused' ? `
                                        <button class="btn btn-success btn-sm" onclick="ui.resumePromotion('${campaign.id}')" style="font-size:11px;padding:3px 8px;">
                                            ▶️ 恢复
                                        </button>
                                    ` : ''}
                                    ${campaign.status !== 'active' ? `
                                        <button class="btn btn-primary btn-sm" onclick="ui.editPromotion('${campaign.id}')" style="font-size:11px;padding:3px 8px;">
                                            ✏️ 编辑
                                        </button>
                                        <button class="btn btn-light btn-sm" onclick="ui.duplicatePromotion('${campaign.id}')" style="font-size:11px;padding:3px 8px;">
                                            📋 复制
                                        </button>
                                        <button class="btn btn-danger btn-sm" onclick="ui.deletePromotionConfirm('${campaign.id}')" style="font-size:11px;padding:3px 8px;">
                                            🗑️
                                        </button>
                                    ` : ''}
                                    <button class="btn btn-info btn-sm" onclick="ui.viewPromotionStats('${campaign.id}')" style="font-size:11px;padding:3px 8px;">
                                        📊
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }).join('')}
        `;
    }

    setPromoStatusFilter(status) {
        this._promoStatusFilter = status;
        this.render();
    }

    renderPromoCreateForm(state) {
        const editingId = this._editingPromoId;
        const editing = editingId ? gameState.state.promotions.campaigns.find(c => c.id === editingId) : null;
        const day = state.gameTime.day;
        
        const selectedType = this._promoFormType || (editing?.type) || 'full_reduction';
        const formData = this._promoFormData || (editing ? {
            name: editing.name,
            description: editing.description,
            startDay: editing.startTime.day,
            startHour: editing.startTime.hour,
            endDay: editing.endTime.day,
            endHour: editing.endTime.hour,
            scope: editing.scope,
            ...editing.rules
        } : {
            name: '',
            description: '',
            startDay: day,
            startHour: 8,
            endDay: day + 7,
            endHour: 22,
            scope: 'all',
            rate: 0.8,
            threshold: 99,
            denomination: 10,
            minPurchase: 50,
            quantity: 100,
            validDays: 7,
            discountRate: 0.5,
            stock: 100,
            perUserLimit: 1,
            tiers: JSON.stringify(PROMOTION_DEFAULTS.fullReductionTiers)
        });
        
        const typeOptions = Object.values(PROMOTION_TYPES);
        
        return `
            <div class="card">
                <div class="card-header">
                    <div class="card-title">${editing ? '✏️ 编辑活动' : '➕ 创建新活动'}</div>
                </div>
                <div style="padding:12px;">
                    <div style="margin-bottom:12px;">
                        <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:#333;">活动类型</label>
                        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">
                            ${typeOptions.map(type => `
                                <button type="button"
                                    class="btn ${selectedType === type.id ? 'btn-primary' : 'btn-light'} btn-sm"
                                    onclick="ui.setPromoFormType('${type.id}')"
                                    style="font-size:11px;padding:8px 4px;text-align:center;display:flex;flex-direction:column;gap:2px;">
                                    <span style="font-size:18px;">${type.icon}</span>
                                    <span>${type.name}</span>
                                </button>
                            `).join('')}
                        </div>
                    </div>
                    
                    <div style="margin-bottom:12px;">
                        <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:#333;">活动名称</label>
                        <input type="text" id="promo_name" class="form-input" 
                               placeholder="请输入活动名称（如：新人大促）" 
                               value="${escapeHtml(formData.name || '')}"
                               style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:13px;">
                    </div>
                    
                    <div style="margin-bottom:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                        <div>
                            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:#333;">开始时间</label>
                            <div style="display:flex;gap:4px;">
                                <input type="number" id="promo_startDay" class="form-input" 
                                       value="${formData.startDay || day}" min="1"
                                       style="flex:1;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;">
                                <span style="display:flex;align-items:center;font-size:12px;color:#666;">天</span>
                                <input type="number" id="promo_startHour" class="form-input" 
                                       value="${formData.startHour || 8}" min="0" max="23"
                                       style="width:50px;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;">
                                <span style="display:flex;align-items:center;font-size:12px;color:#666;">时</span>
                            </div>
                        </div>
                        <div>
                            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:#333;">结束时间</label>
                            <div style="display:flex;gap:4px;">
                                <input type="number" id="promo_endDay" class="form-input" 
                                       value="${formData.endDay || day + 7}" min="1"
                                       style="flex:1;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;">
                                <span style="display:flex;align-items:center;font-size:12px;color:#666;">天</span>
                                <input type="number" id="promo_endHour" class="form-input" 
                                       value="${formData.endHour || 22}" min="0" max="23"
                                       style="width:50px;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;">
                                <span style="display:flex;align-items:center;font-size:12px;color:#666;">时</span>
                            </div>
                        </div>
                    </div>
                    
                    ${this.renderPromoTypeRules(selectedType, formData)}
                    
                    <div style="margin-bottom:12px;">
                        <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:#333;">适用范围</label>
                        <select id="promo_scope" class="form-input" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:13px;"
                                onchange="ui.setPromoScope(this.value)">
                            <option value="all" ${formData.scope === 'all' ? 'selected' : ''}>全场商品</option>
                            <option value="category" ${formData.scope === 'category' ? 'selected' : ''}>指定分类</option>
                        </select>
                    </div>
                    
                    <div style="display:flex;gap:8px;margin-top:15px;">
                        <button class="btn btn-primary" style="flex:1;" onclick="ui.savePromotion('${editingId || ''}')">
                            ${editing ? '💾 保存修改' : '✅ 创建活动'}
                        </button>
                        <button class="btn btn-light" onclick="ui.switchPromoSubTab('list')">
                            返回列表
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    renderPromoTypeRules(type, formData) {
        let html = '';
        switch(type) {
            case 'full_reduction':
                html = `
                    <div style="margin-bottom:12px;">
                        <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:#333;">满减阶梯（JSON格式）</label>
                        <textarea id="promo_tiers" class="form-input" rows="3"
                                  style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:12px;font-family:monospace;">${formData.tiers || JSON.stringify(PROMOTION_DEFAULTS.fullReductionTiers)}</textarea>
                        <div style="font-size:11px;color:#999;margin-top:4px;">格式：[{"threshold":99,"discount":10},{"threshold":199,"discount":25}]</div>
                    </div>
                `;
                break;
            case 'discount':
                html = `
                    <div style="margin-bottom:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                        <div>
                            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:#333;">折扣率（0.1-0.99）</label>
                            <input type="number" id="promo_rate" class="form-input" step="0.05" min="0.1" max="0.99"
                                   value="${formData.rate || 0.8}"
                                   style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:13px;">
                            <div style="font-size:11px;color:#666;margin-top:2px;">${((formData.rate || 0.8) * 10).toFixed(1)}折</div>
                        </div>
                        <div>
                            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:#333;">最低消费（元）</label>
                            <input type="number" id="promo_minAmount" class="form-input" min="0"
                                   value="${formData.minAmount || 0}"
                                   style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:13px;">
                            <div style="font-size:11px;color:#999;margin-top:2px;">0表示无门槛</div>
                        </div>
                    </div>
                `;
                break;
            case 'coupon':
                html = `
                    <div style="margin-bottom:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                        <div>
                            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:#333;">券面额（元）</label>
                            <input type="number" id="promo_denomination" class="form-input" min="1"
                                   value="${formData.denomination || 10}"
                                   style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:13px;">
                        </div>
                        <div>
                            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:#333;">使用门槛（元）</label>
                            <input type="number" id="promo_minPurchase" class="form-input" min="0"
                                   value="${formData.minPurchase || 50}"
                                   style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:13px;">
                        </div>
                        <div>
                            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:#333;">发放数量</label>
                            <input type="number" id="promo_quantity" class="form-input" min="1"
                                   value="${formData.quantity || 100}"
                                   style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:13px;">
                        </div>
                        <div>
                            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:#333;">有效期（天）</label>
                            <input type="number" id="promo_validDays" class="form-input" min="1"
                                   value="${formData.validDays || 7}"
                                   style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:13px;">
                        </div>
                    </div>
                `;
                break;
            case 'flash_sale':
                html = `
                    <div style="margin-bottom:12px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
                        <div>
                            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:#333;">折扣率</label>
                            <input type="number" id="promo_discountRate" class="form-input" step="0.1" min="0.1" max="0.9"
                                   value="${formData.discountRate || 0.5}"
                                   style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:13px;">
                        </div>
                        <div>
                            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:#333;">库存数量</label>
                            <input type="number" id="promo_stock" class="form-input" min="1"
                                   value="${formData.stock || 100}"
                                   style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:13px;">
                        </div>
                        <div>
                            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:#333;">每人限购</label>
                            <input type="number" id="promo_perUserLimit" class="form-input" min="1"
                                   value="${formData.perUserLimit || 1}"
                                   style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:13px;">
                        </div>
                    </div>
                `;
                break;
            case 'free_shipping':
                html = `
                    <div style="margin-bottom:12px;">
                        <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:#333;">包邮门槛（元）</label>
                        <input type="number" id="promo_threshold" class="form-input" min="0"
                               value="${formData.threshold || 99}"
                               style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:13px;">
                        <div style="font-size:11px;color:#666;margin-top:4px;">订单满此金额即可享受包邮</div>
                    </div>
                `;
                break;
            case 'gift':
                html = `
                    <div style="margin-bottom:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                        <div>
                            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:#333;">最低消费（元）</label>
                            <input type="number" id="promo_minPurchase" class="form-input" min="0"
                                   value="${formData.minPurchase || 0}"
                                   style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:13px;">
                        </div>
                        <div>
                            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:#333;">赠品数量</label>
                            <input type="number" id="promo_giftQuantity" class="form-input" min="1"
                                   value="${formData.giftQuantity || 1}"
                                   style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:13px;">
                        </div>
                    </div>
                `;
                break;
        }
        return html;
    }

    setPromoFormType(type) {
        this._promoFormType = type;
        // 若用户正在活动创建页的其他input里打字（焦点在可编辑元素），不立刻innerHtml重建以免丢焦点/闪退
        if (this._isEditableFocused()) {
            this.pendingRender = true;
            return;
        }
        this.render();
    }

    // 活动范围切换（全场/指定分类）：保存到表单内存中，不立即整页重建DOM
    setPromoScope(scope) {
        if (!this._promoFormData) this._promoFormData = {};
        this._promoFormData.scope = scope;
        // 同样：若此时焦点在可编辑元素，就不要重建DOM
        if (this._isEditableFocused()) {
            this.pendingRender = true;
            return;
        }
        this.render();
    }

    savePromotion(editingId) {
        const getName = (id) => {
            const el = document.getElementById(id);
            return el ? el.value.trim() : '';
        };
        const getNum = (id, defaultVal = 0) => {
            const el = document.getElementById(id);
            if (!el) return defaultVal;
            const v = parseFloat(el.value);
            return isNaN(v) ? defaultVal : v;
        };
        
        const name = getName('promo_name');
        if (!name) {
            this.showToast('请输入活动名称');
            return;
        }
        
        const type = this._promoFormType || 'full_reduction';
        const startDay = Math.floor(getNum('promo_startDay', 1));
        const startHour = Math.floor(getNum('promo_startHour', 8));
        const endDay = Math.floor(getNum('promo_endDay', startDay + 7));
        const endHour = Math.floor(getNum('promo_endHour', 22));
        const scopeEl = document.getElementById('promo_scope');
        const scope = scopeEl ? scopeEl.value : 'all';
        
        const rules = {};
        switch(type) {
            case 'full_reduction':
                try {
                    rules.tiers = JSON.parse(getName('promo_tiers') || '[]');
                } catch(e) {
                    this.showToast('满减阶梯格式错误');
                    return;
                }
                break;
            case 'discount':
                rules.rate = Math.max(0.1, Math.min(0.99, getNum('promo_rate', 0.8)));
                rules.minAmount = getNum('promo_minAmount', 0);
                break;
            case 'coupon':
                rules.denomination = getNum('promo_denomination', 10);
                rules.minPurchase = getNum('promo_minPurchase', 50);
                rules.quantity = Math.floor(getNum('promo_quantity', 100));
                rules.validDays = Math.floor(getNum('promo_validDays', 7));
                break;
            case 'flash_sale':
                rules.discountRate = Math.max(0.1, Math.min(0.9, getNum('promo_discountRate', 0.5)));
                rules.stock = Math.floor(getNum('promo_stock', 100));
                rules.perUserLimit = Math.floor(getNum('promo_perUserLimit', 1));
                break;
            case 'free_shipping':
                rules.threshold = getNum('promo_threshold', 99);
                break;
            case 'gift':
                rules.minPurchase = getNum('promo_minPurchase', 0);
                rules.giftQuantity = Math.floor(getNum('promo_giftQuantity', 1));
                rules.giftStock = 100;
                break;
        }
        
        const config = {
            name,
            type,
            status: 'pending',
            startTime: { day: startDay, hour: startHour },
            endTime: { day: endDay, hour: endHour },
            scope,
            rules
        };
        
        let result;
        if (editingId) {
            result = gameState.updatePromotion(editingId, { ...config, status: 'pending' });
        } else {
            result = gameState.createPromotion(config);
        }
        
        if (result.success) {
            this.showToast(editingId ? '活动已更新' : '活动创建成功');
            this._editingPromoId = null;
            this._promoFormType = null;
            this._promoFormData = null;
            this.switchPromoSubTab('list');
        } else {
            this.showToast(result.message || '操作失败');
        }
    }

    renderPromoStats(state, stats) {
        return `
            <div class="card">
                <div class="card-header">
                    <div class="card-title">📊 促销活动数据总览</div>
                </div>
                <div style="padding:12px;">
                    <div class="stats-grid" style="grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:15px;">
                        <div style="background:linear-gradient(135deg,#e8f5e9,#c8e6c9);padding:15px;border-radius:10px;">
                            <div style="font-size:24px;font-weight:700;color:#2e7d32;">${stats.overview.totalCampaigns}</div>
                            <div style="font-size:12px;color:#2e7d32;margin-top:4px;">🎪 总活动数</div>
                        </div>
                        <div style="background:linear-gradient(135deg,#fff3e0,#ffe0b2);padding:15px;border-radius:10px;">
                            <div style="font-size:24px;font-weight:700;color:#ef6c00;">${stats.overview.activeCampaigns}</div>
                            <div style="font-size:12px;color:#ef6c00;margin-top:4px;">🔥 进行中活动</div>
                        </div>
                        <div style="background:linear-gradient(135deg,#ffebee,#ffcdd2);padding:15px;border-radius:10px;">
                            <div style="font-size:24px;font-weight:700;color:#c62828;">${formatMoney(stats.overview.totalDiscountAmount)}</div>
                            <div style="font-size:12px;color:#c62828;margin-top:4px;">💰 累计优惠金额</div>
                        </div>
                        <div style="background:linear-gradient(135deg,#e3f2fd,#bbdefb);padding:15px;border-radius:10px;">
                            <div style="font-size:24px;font-weight:700;color:#1565c0;">${formatMoney(stats.overview.totalSalesFromPromo)}</div>
                            <div style="font-size:12px;color:#1565c0;margin-top:4px;">📈 活动带动GMV</div>
                        </div>
                    </div>
                    
                    <div class="stats-grid" style="grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:15px;">
                        <div style="background:#f5f5f5;padding:12px;border-radius:8px;text-align:center;">
                            <div style="font-size:18px;font-weight:700;color:#333;">${stats.overview.totalCouponsIssued}</div>
                            <div style="font-size:11px;color:#666;">🎫 发放优惠券</div>
                        </div>
                        <div style="background:#f5f5f5;padding:12px;border-radius:8px;text-align:center;">
                            <div style="font-size:18px;font-weight:700;color:#333;">${stats.overview.totalCouponsUsed}</div>
                            <div style="font-size:11px;color:#666;">✅ 已使用</div>
                        </div>
                        <div style="background:#f5f5f5;padding:12px;border-radius:8px;text-align:center;">
                            <div style="font-size:18px;font-weight:700;color:#333;">${stats.overview.couponUsageRate}</div>
                            <div style="font-size:11px;color:#666;">📊 使用率</div>
                        </div>
                    </div>
                    
                    <div style="font-size:13px;font-weight:600;margin-bottom:10px;color:#333;">各活动表现</div>
                    ${stats.campaigns.length === 0 ? `
                        <div style="text-align:center;padding:30px;color:#999;">暂无活动数据</div>
                    ` : `
                        <div style="max-height:400px;overflow-y:auto;">
                            <table style="width:100%;font-size:11px;border-collapse:collapse;">
                                <thead style="position:sticky;top:0;background:#f5f5f5;">
                                    <tr>
                                        <th style="padding:8px 6px;text-align:left;border-bottom:2px solid #ddd;">活动</th>
                                        <th style="padding:8px 6px;text-align:center;border-bottom:2px solid #ddd;">参与</th>
                                        <th style="padding:8px 6px;text-align:center;border-bottom:2px solid #ddd;">订单</th>
                                        <th style="padding:8px 6px;text-align:right;border-bottom:2px solid #ddd;">优惠</th>
                                        <th style="padding:8px 6px;text-align:right;border-bottom:2px solid #ddd;">GMV</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${stats.campaigns.map(c => `
                                        <tr style="border-bottom:1px solid #eee;">
                                            <td style="padding:8px 6px;">
                                                <span style="font-weight:500;">${escapeHtml(c.name)}</span>
                                                <span class="badge" style="font-size:9px;margin-left:4px;background:${PROMOTION_STATUS[c.status.toUpperCase()]?.color || '#999'}20;color:${PROMOTION_STATUS[c.status.toUpperCase()]?.color || '#999'};">
                                                    ${PROMOTION_STATUS[c.status.toUpperCase()]?.name || c.status}
                                                </span>
                                            </td>
                                            <td style="padding:8px 6px;text-align:center;">${c.participants}</td>
                                            <td style="padding:8px 6px;text-align:center;">${c.orders}</td>
                                            <td style="padding:8px 6px;text-align:right;color:#c62828;">${formatMoney(c.discount)}</td>
                                            <td style="padding:8px 6px;text-align:right;color:#2e7d32;font-weight:600;">${formatMoney(c.sales)}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    `}
                </div>
            </div>
            
            <div class="card" style="margin-top:10px;">
                <div class="card-header">
                    <div class="card-title">🎫 我的优惠券</div>
                </div>
                <div style="padding:12px;">
                    ${this.renderUserCoupons(state)}
                </div>
            </div>
        `;
    }

    renderUserCoupons(state) {
        const userCoupons = gameState.getUserCoupons();
        if (userCoupons.length === 0) {
            return '<div style="text-align:center;padding:20px;color:#999;font-size:12px;">暂无可用优惠券</div>';
        }
        return `
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;">
                ${userCoupons.slice(0, 12).map(uc => `
                    <div style="background:linear-gradient(135deg,#ff5722,#e64a19);color:#fff;padding:10px;border-radius:8px;position:relative;overflow:hidden;">
                        <div style="font-size:20px;font-weight:700;">¥${uc.denomination}</div>
                        <div style="font-size:10px;opacity:0.9;">满${uc.minPurchase}可用</div>
                        <div style="font-size:9px;opacity:0.7;margin-top:4px;">第${uc.expireDay}天到期</div>
                    </div>
                `).join('')}
            </div>
            ${userCoupons.length > 12 ? `<div style="text-align:center;margin-top:8px;font-size:11px;color:#666;">还有${userCoupons.length - 12}张优惠券</div>` : ''}
        `;
    }

    viewPromotionStats(campaignId) {
        this._viewingPromoStats = campaignId;
        this.showPromoStatsModal(campaignId);
    }

    showPromoStatsModal(campaignId) {
        const stats = gameState.getPromotionStatistics(campaignId);
        if (!stats) {
            this.showToast('活动不存在');
            return;
        }
        const campaign = gameState.state.promotions.campaigns.find(c => c.id === campaignId);
        const typeInfo = Object.values(PROMOTION_TYPES).find(t => t.id === campaign.type);
        
        this.showModal(`
            <div style="padding:15px;">
                <h3 style="margin:0 0 15px 0;font-size:16px;">📊 ${typeInfo.icon} ${escapeHtml(campaign.name)} - 数据详情</h3>
                <div class="stats-grid" style="grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:15px;">
                    <div style="background:#f5f5f5;padding:12px;border-radius:8px;text-align:center;">
                        <div style="font-size:20px;font-weight:700;">${stats.overview.participants}</div>
                        <div style="font-size:11px;color:#666;">参与人数</div>
                    </div>
                    <div style="background:#f5f5f5;padding:12px;border-radius:8px;text-align:center;">
                        <div style="font-size:20px;font-weight:700;">${stats.overview.orders}</div>
                        <div style="font-size:11px;color:#666;">转化订单</div>
                    </div>
                    <div style="background:#ffebee;padding:12px;border-radius:8px;text-align:center;">
                        <div style="font-size:18px;font-weight:700;color:#c62828;">${formatMoney(stats.overview.discountAmount)}</div>
                        <div style="font-size:11px;color:#c62828;">优惠金额</div>
                    </div>
                    <div style="background:#e8f5e9;padding:12px;border-radius:8px;text-align:center;">
                        <div style="font-size:18px;font-weight:700;color:#2e7d32;">${formatMoney(stats.overview.sales)}</div>
                        <div style="font-size:11px;color:#2e7d32;">带动销售</div>
                    </div>
                </div>
                <div style="display:flex;gap:8px;">
                    <button class="btn btn-light" onclick="ui.closeModal()" style="flex:1;">关闭</button>
                </div>
            </div>
        `);
    }

    startPromotion(campaignId) {
        const result = gameState.updatePromotion(campaignId, { status: 'active' });
        if (result.success) {
            this.showToast('活动已启动');
            this.render();
        } else {
            this.showToast(result.message);
        }
    }

    pausePromotion(campaignId) {
        const result = gameState.pausePromotion(campaignId);
        if (result.success) {
            this.showToast('活动已暂停');
            this.render();
        } else {
            this.showToast(result.message);
        }
    }

    resumePromotion(campaignId) {
        const result = gameState.resumePromotion(campaignId);
        if (result.success) {
            this.showToast('活动已恢复');
            this.render();
        } else {
            this.showToast(result.message);
        }
    }

    editPromotion(campaignId) {
        this._editingPromoId = campaignId;
        this._promoSubTab = 'create';
        this.render();
    }

    duplicatePromotion(campaignId) {
        const result = gameState.duplicatePromotion(campaignId);
        if (result.success) {
            this.showToast('活动已复制');
            this.render();
        } else {
            this.showToast(result.message);
        }
    }

    deletePromotionConfirm(campaignId) {
        if (confirm('确定要删除这个活动吗？删除后无法恢复。')) {
            const result = gameState.deletePromotion(campaignId);
            if (result.success) {
                this.showToast('活动已删除');
                this.render();
            } else {
                this.showToast(result.message);
            }
        }
    }
    
    renderPromotionLogs(state) {
        const logs = [...(state.marketing.promotionLogs || [])].sort((a, b) => b.timestamp - a.timestamp);
        const today = state.gameTime.day;
        
        // 汇总统计
        const todayLogs = logs.filter(l => l.day === today);
        const todayCost = todayLogs.reduce((s, l) => s + (l.cost || 0), 0);
        const todayOrders = todayLogs.reduce((s, l) => s + (l.generatedOrders || 0), 0);
        const todayExposure = todayLogs.reduce((s, l) => s + (l.exposureGiven || 0), 0);
        const totalCost = logs.reduce((s, l) => s + (l.cost || 0), 0);
        const totalOrders = logs.reduce((s, l) => s + (l.generatedOrders || 0), 0);
        
        // 性能优化：只预查找最新150条log涉及的orderIds，一次构建Map避免O(N*M)
        const needOrderIds = new Set();
        logs.slice(0, 150).forEach(l => (l.orderIds || []).forEach(id => needOrderIds.add(id)));
        const orderMap = new Map();
        if (needOrderIds.size > 0) {
            // 只遍历一次orders收集所需ID
            for (let i = 0; i < state.orders.length; i++) {
                const o = state.orders[i];
                if (needOrderIds.has(o.id)) orderMap.set(o.id, o);
                if (orderMap.size >= needOrderIds.size) break;
            }
        }
        
        const renderLog = (l) => {
            const targetCount = (l.targets || []).length || 1;
            const orderLinks = (l.orderIds || []).map(oid => {
                const o = orderMap.get(oid);
                if (!o) return null;
                return `<span class="badge" style="background:#f1f8e9;color:#33691e;margin:1px;">
                    ${(o.productName||'').slice(0,8)} x${o.quantity} ${formatMoney(o.totalAmount)}
                </span>`;
            }).filter(Boolean).join(' ');
            const avgExposurePerTarget = Math.round((l.exposureGiven || 0) / targetCount);
            const targets = (l.targets || []).map(t =>
                `<span class="badge" style="background:#e3f2fd;color:#0d47a1;margin:1px;font-size:10px;">
                    🎯 ${(t.title||'').slice(0,10)} (+${avgExposurePerTarget}曝光)
                </span>`
            ).join(' ');
            
            return `
                <div style="padding:10px 14px;border-bottom:1px solid #f0f0f0;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                        <div>
                            <div style="font-size:13px;font-weight:600;">
                                📣 ${l.employeeName||'推广员'} <span class="badge" style="background:#fff3e0;color:#e65100;margin-left:4px;">Lv.${l.employeeLevel||1}</span>
                            </div>
                            <div style="font-size:11px;color:#777;margin-top:2px;">
                                第${l.day}天 ${String(l.hour).padStart(2,'0')}:00 · 强度${l.strength||0} · 曝光+${l.exposureGiven||0}
                            </div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size:12px;color:#c62828;font-weight:700;">花费 ${formatMoney(l.cost||0)}</div>
                            ${l.agencyFee ? `<div style="font-size:10px;color:#ef6c00;">含广告公司 ${formatMoney(l.agencyFee)}</div>` : ''}
                            <div style="font-size:11px;color:${l.generatedOrders>0?'#2e7d32':'#999'};margin-top:2px;">
                                带来订单 ${l.generatedOrders||0} 单
                            </div>
                        </div>
                    </div>
                    ${targets ? `<div style="margin-top:4px;">${targets}</div>` : ''}
                    ${orderLinks ? `<div style="margin-top:4px;">🛒 订单：${orderLinks}</div>` : ''}
                </div>
            `;
        };
        
        const roi = gameState && typeof gameState.getPromotionROI === 'function'
            ? gameState.getPromotionROI()
            : { summary: { totalCost: 0, totalGmv: 0, totalOrders: 0, totalExposure: 0, roi: 0, netProfit: 0, totalRuns: logs.length, grade: '-', gradeColor: '#9e9e9e' }, employees: [], daily: [] };
        const s = roi.summary;
        const topEmployees = roi.employees.slice(0, 8);
        const maxCost = Math.max(1, ...topEmployees.map(e => e.cost), ...topEmployees.map(e => e.gmv));
        const empBarW = (v) => Math.max(2, Math.min(100, (v / maxCost) * 100));
        const daily = roi.daily.slice().reverse(); // 旧→新
        const maxDaily = Math.max(1, ...daily.map(d => Math.max(d.cost, d.gmv)));

        return `
            <div class="card">
                <div class="card-header">
                    <div class="card-title">📊 推广总览 & 渠道ROI分析</div>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <div style="font-size:11px;color:#666;">运营评级</div>
                        <div style="width:34px;height:34px;border-radius:50%;background:${s.gradeColor};color:#fff;font-weight:900;font-size:18px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px ${s.gradeColor}66;">${s.grade}</div>
                    </div>
                </div>
                <div style="padding:0 12px 12px;">
                    <div class="stats-grid" style="grid-template-columns:repeat(3,1fr);gap:8px;">
                        <div class="stat-item" style="background:linear-gradient(135deg,#ffebee,#ffcdd2);border-radius:10px;">
                            <div class="stat-value" style="font-size:15px;color:#c62828;">${formatMoney(s.totalCost)}</div>
                            <div class="stat-label" style="color:#c62828;">💰 累计投入</div>
                        </div>
                        <div class="stat-item" style="background:linear-gradient(135deg,#e8f5e9,#c8e6c9);border-radius:10px;">
                            <div class="stat-value" style="font-size:15px;color:#2e7d32;">${formatMoney(s.totalGmv)}</div>
                            <div class="stat-label" style="color:#2e7d32;">📈 推广GMV</div>
                        </div>
                        <div class="stat-item" style="background:${s.netProfit>=0?'linear-gradient(135deg,#e3f2fd,#bbdefb)':'linear-gradient(135deg,#fce4ec,#f8bbd0)'} ;border-radius:10px;">
                            <div class="stat-value" style="font-size:15px;color:${s.netProfit>=0?'#1565c0':'#c2185b'};">${s.netProfit>=0?'+':''}${formatMoney(s.netProfit)}</div>
                            <div class="stat-label" style="color:${s.netProfit>=0?'#1565c0':'#c2185b'};">💎 净收益</div>
                        </div>
                        <div class="stat-item" style="background:linear-gradient(135deg,#fff3e0,#ffe0b2);border-radius:10px;">
                            <div class="stat-value" style="font-size:15px;color:#ef6c00;">${s.roi.toFixed(2)}×</div>
                            <div class="stat-label" style="color:#ef6c00;">🎯 综合ROI</div>
                        </div>
                        <div class="stat-item" style="background:linear-gradient(135deg,#f3e5f5,#e1bee7);border-radius:10px;">
                            <div class="stat-value" style="font-size:15px;color:#7b1fa2;">${s.totalOrders}</div>
                            <div class="stat-label" style="color:#7b1fa2;">🛒 转化订单</div>
                        </div>
                        <div class="stat-item" style="background:linear-gradient(135deg,#ede7f6,#d1c4e9);border-radius:10px;">
                            <div class="stat-value" style="font-size:15px;color:#4527a0;">${s.totalCost>0 && s.totalOrders>0 ? formatMoney(s.totalCost/s.totalOrders) : '-'}</div>
                            <div class="stat-label" style="color:#4527a0;">🎫 CPA 获客</div>
                        </div>
                    </div>
                    <div style="font-size:12px;color:#666;margin-top:8px;padding:6px 10px;background:#fafafa;border-radius:6px;border-left:3px solid ${s.gradeColor};">
                        <b>解读：</b>累计推广 <b>${s.totalRuns||logs.length}</b> 次，曝光 <b>${s.totalExposure||0}</b> 次，
                        转化 <b>${s.totalOrders}</b> 单。综合ROI ${s.roi.toFixed(2)}× 为 <b style="color:${s.gradeColor};">${s.grade}级</b>
                        ${s.roi >= 3 ? '，推广效率优秀，请继续保持 🔥' :
                          s.roi >= 1.5 ? '，投入产出良好，可适当加大预算 💪' :
                          s.roi >= 1 ? '，刚回本线，建议优化投放策略 📈' :
                          s.totalCost > 0 ? '，<b style="color:#c62828;">投入>产出</b>，请暂停低ROI员工的推广并查看下方渠道分析 ⚠️' :
                          '，暂无推广数据，建议先投放推广员 📣'}
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <div class="card-title">👥 推广员渠道对比（Top ${topEmployees.length}）</div>
                    <div style="font-size:11px;color:#666;">按投入排序 · 绿色=GMV 橙色=成本</div>
                </div>
                <div style="padding:8px 14px 14px;">
                    ${topEmployees.length === 0 ? `
                        <div style="text-align:center;padding:30px;color:#999;font-size:13px;">暂无推广数据，招聘推广员后自动生成分析</div>
                    ` : topEmployees.map(e => {
                        const roiColor = e.roi >= 3 ? '#4caf50' : e.roi >= 1.5 ? '#2196f3' : e.roi >= 1 ? '#ff9800' : '#e53935';
                        return `
                            <div style="padding:10px 0;border-bottom:1px dashed #eee;">
                                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                                    <div style="font-size:13px;font-weight:600;">
                                        ${e.employeeName||'推广员'}
                                        <span class="badge" style="background:#fff3e0;color:#e65100;margin-left:4px;">Lv.${e.employeeLevel||1}</span>
                                        <span class="badge" style="background:#eceff1;color:#455a64;margin-left:3px;">${e.runs}次</span>
                                    </div>
                                    <div style="text-align:right;font-size:12px;">
                                        <span style="color:${roiColor};font-weight:700;">ROI ${e.roi.toFixed(2)}×</span>
                                        <span style="color:#666;margin-left:8px;">纯利 ${e.profit>=0?'+':''}${formatMoney(e.profit)}</span>
                                    </div>
                                </div>
                                <div style="position:relative;height:14px;background:#f5f5f5;border-radius:7px;overflow:hidden;">
                                    <div style="position:absolute;top:0;left:0;height:100%;width:${empBarW(e.cost)}%;background:linear-gradient(90deg,#ff9800,#ff5722);opacity:0.6;border-radius:7px;"></div>
                                    <div style="position:absolute;top:0;left:0;height:100%;width:${empBarW(e.gmv)}%;background:linear-gradient(90deg,#66bb6a,#2e7d32);opacity:0.85;border-radius:7px;"></div>
                                </div>
                                <div style="display:flex;justify-content:space-between;font-size:11px;color:#666;margin-top:5px;">
                                    <span>🛒 ${e.orders}单 · 📣 ${e.exposure}曝光</span>
                                    <span>投入 ${formatMoney(e.cost)} · GMV ${formatMoney(e.gmv)}${e.cpa>0?' · 单客'+formatMoney(e.cpa):''}</span>
                                </div>
                            </div>
                        `;
                    }).join('')}
                    ${topEmployees.some(e => e.cost > 0 && e.roi < 1) ? `
                        <div style="margin-top:12px;padding:10px;background:#ffebee;border-radius:8px;font-size:12px;color:#c62828;border-left:4px solid #e53935;">
                            ⚠️ <b>无效推广预警</b>：检测到 ${topEmployees.filter(e=>e.cost>0&&e.roi<1).length} 位推广员的 ROI < 1（投入>产出），
                            建议暂停其推广任务，改派客服/打包等岗位；或升级该员工后再进行推广（Lv越高推广转化率越好）。
                        </div>
                    ` : ''}
                </div>
            </div>

            ${daily.length >= 2 ? `
            <div class="card">
                <div class="card-header">
                    <div class="card-title">📅 日投入产出趋势（${daily.length}天）</div>
                    <div style="font-size:11px;color:#666;">🟩 GMV &nbsp; 🟧 成本</div>
                </div>
                <div style="padding:12px 14px 16px;overflow-x:auto;">
                    <div style="display:flex;align-items:flex-end;gap:8px;min-width:${daily.length*60}px;height:130px;">
                        ${daily.map(d => {
                            const gmvH = Math.max(2, (d.gmv / maxDaily) * 100);
                            const costH = Math.max(2, (d.cost / maxDaily) * 100);
                            const dayRoiColor = d.roi >= 1.5 ? '#4caf50' : d.roi >= 1 ? '#ff9800' : '#e53935';
                            return `
                                <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">
                                    <div style="height:14px;font-size:10px;color:${dayRoiColor};font-weight:700;">${d.roi}×</div>
                                    <div style="position:relative;width:100%;height:84px;display:flex;gap:2px;align-items:flex-end;">
                                        <div style="flex:1;height:${costH}%;background:linear-gradient(180deg,#ff9800,#ff5722);border-radius:3px 3px 0 0;" title="成本 ${formatMoney(d.cost)}"></div>
                                        <div style="flex:1;height:${gmvH}%;background:linear-gradient(180deg,#66bb6a,#2e7d32);border-radius:3px 3px 0 0;" title="GMV ${formatMoney(d.gmv)}"></div>
                                    </div>
                                    <div style="font-size:10px;color:#666;">D${d.day}</div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            </div>
            ` : ''}
            
            <div class="card">
                <div class="card-header">
                    <div class="card-title">📊 推广汇总</div>
                </div>
                <div class="stats-grid" style="grid-template-columns:repeat(2,1fr);padding:0 12px 12px;">
                    <div class="stat-item">
                        <div class="stat-value green" style="font-size:16px;">${todayExposure}</div>
                        <div class="stat-label">今日曝光赠送</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value" style="font-size:16px;color:#ff6b35;">${formatMoney(todayCost)}</div>
                        <div class="stat-label">今日推广支出</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value" style="font-size:16px;color:#4caf50;">${todayOrders}</div>
                        <div class="stat-label">今日推广带来订单</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value" style="font-size:16px;color:#795548;">${logs.length}</div>
                        <div class="stat-label">累计推广次数</div>
                    </div>
                </div>
                <div style="padding:0 15px 12px;font-size:12px;color:#555;">
                    累计推广支出 ${formatMoney(totalCost)} · 累计带来订单 ${totalOrders} 单
                </div>
            </div>
            
            <div class="card" style="padding:0;">
                <div style="padding:10px 15px;font-size:13px;font-weight:600;border-bottom:1px solid #eee;">
                    推广日志（最新500条内）
                </div>
                ${logs.length === 0 ? `
                    <div style="padding:40px;text-align:center;color:#999;">
                        暂无推广记录，招聘📣推广员或👔店长后，空闲时每小时自动为您推广
                    </div>
                ` : `
                    <div style="max-height:70vh;overflow-y:auto;">
                        ${logs.slice(0, 150).map(renderLog).join('')}
                        ${logs.length > 150 ? `
                            <div style="padding:10px;text-align:center;color:#999;font-size:12px;background:#fafafa;">
                                共 ${logs.length} 条日志，仅展示最新 150 条
                            </div>
                        ` : ''}
                    </div>
                `}
            </div>
        `;
    }

    renderCampaigns(state) {
        const activeCampaigns = (state.marketing.activeCampaigns || []).filter(c => c.status === 'active');
        const shopLevel = state.shop.level || 1;
        const runningTypes = new Set(activeCampaigns.map(c => c.type));
        const effectNow = (typeof gameState.getTotalMarketingEffect === 'function')
            ? gameState.getTotalMarketingEffect()
            : 1;
        const cap = (typeof MARKETING_EFFECT_CAP === 'number') ? MARKETING_EFFECT_CAP : 8;
        const channels = Object.values(MARKETING_TYPES || {});

        const typeLabel = (t) => {
            if (t === 'cpc') return '点击+抽成';
            if (t === 'cpm') return '展示+抽成';
            if (t === 'fee+commission') return '入场+抽成';
            return '一口价+抽成';
        };
        const commissionPct = (m) => (m && m.commission > 0) ? `${Math.round(m.commission * 100)}%` : '';

        return `
            <div style="font-size:12px;color:#666;line-height:1.6;margin:0 0 10px;padding:10px 12px;background:#fff8e1;border-radius:10px;">
                搜索广告、会员触达开局即可投放。同时可开「促销活动」或「明星代言」，有任一在跑才会放开订单量。
            </div>
            <div class="mk-summary">
                <div class="mk-summary-item">
                    <b>${activeCampaigns.length}</b>
                    <span>进行中</span>
                </div>
                <div class="mk-summary-item">
                    <b>${effectNow.toFixed(2)}x</b>
                    <span>流量倍率</span>
                </div>
                <div class="mk-summary-item">
                    <b>${channels.filter(m => shopLevel >= (m.unlockLevel || 1)).length}/${channels.length}</b>
                    <span>已解锁渠道</span>
                </div>
                <div class="mk-summary-item">
                    <b>${cap}x</b>
                    <span>倍率上限</span>
                </div>
            </div>

            ${activeCampaigns.length > 0 ? `
                <div class="card">
                    <div class="card-header">
                        <div class="card-title">进行中的投放</div>
                    </div>
                    ${activeCampaigns.map(c => {
                        const mType = MARKETING_TYPES[c.type] || {};
                        return `
                            <div class="list-item">
                                <div class="item-left">
                                    <div class="item-icon">${mType.icon || '📣'}</div>
                                    <div class="item-content">
                                        <div class="item-title">${mType.name || c.type}</div>
                                        <div class="item-desc">第${c.startTime.day}天开启 · 至第${c.endDay || '?'}天 · 成交抽成 ${mType.commission ? Math.round(mType.commission * 100) + '%' : '5%'} · 效果 ×${mType.effect || 1}</div>
                                    </div>
                                </div>
                                <button class="btn btn-secondary btn-xs"
                                    onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                                    onclick="event.stopPropagation();ui.stopCampaign('${c.id}')">停止</button>
                            </div>
                        `;
                    }).join('')}
                </div>
            ` : ''}

            <div class="card">
                <div class="card-header">
                    <div class="card-title">推广渠道</div>
                    <span style="font-size:11px;color:#999;">随店铺等级解锁</span>
                </div>
                <div class="mk-grid">
                    ${channels.map(m => {
                        const unlockLevel = m.unlockLevel || 1;
                        const isUnlocked = shopLevel >= unlockLevel;
                        const running = runningTypes.has(m.id);
                        return `
                            <button type="button" class="mk-card ${!isUnlocked ? 'locked' : ''} ${running ? 'running' : ''}"
                                ${isUnlocked ? `onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()" onclick="ui.showCampaignModal('${m.id}')"` : ''}>
                                <div class="mk-card-top">
                                    <span class="mk-card-icon">${m.icon || '📣'}</span>
                                    <span class="mk-card-tag">${commissionPct(m) ? '抽成' + commissionPct(m) : (m.tag || typeLabel(m.type))}</span>
                                </div>
                                <div class="mk-card-name">${m.name}</div>
                                <div class="mk-card-desc">${m.description}</div>
                                <div class="mk-card-foot">
                                    ${running ? '<span class="mk-card-run">投放中</span>'
                                        : (isUnlocked
                                            ? `<span class="mk-card-effect">×${m.effect}</span>`
                                            : `<span class="mk-card-lock">Lv.${unlockLevel} 解锁</span>`)}
                                </div>
                            </button>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    stopCampaign(campaignId) {
        try {
            const r = gameState.stopCampaign(campaignId);
            this.showToast((r && r.message) || '已停止');
        } catch (e) {
            this.showToast('停止失败');
        }
    }

    renderCelebrities(state) {
        const shopLv = (state.shop && state.shop.level) || 1;
        const celebrities = (typeof CELEBRITIES !== 'undefined' && Array.isArray(CELEBRITIES))
            ? CELEBRITIES : gameState.getAvailableCelebrities();
        const activeEndorsements = state.marketing.celebrityEndorsements.filter(e => e.status === 'active');

        return `
            ${activeEndorsements.length > 0 ? `
                <div class="card">
                    <div class="card-header">
                        <div class="card-title">当前代言</div>
                    </div>
                    ${activeEndorsements.map(e => {
                        const celeb = CELEBRITIES.find(c => c.id === e.celebrityId);
                        return `
                            <div class="celebrity-card" style="margin-bottom:5px;">
                                <div class="celebrity-avatar">⭐</div>
                                <div class="celebrity-info">
                                    <div class="celebrity-name">${celeb?.name}</div>
                                    <div class="celebrity-meta">粉丝: ${celeb?.fans}</div>
                                    <div style="font-size:12px;color:#4caf50;">曝光提升 ${((celeb?.exposureEffect - 1) * 100).toFixed(0)}%</div>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            ` : ''}

            <div style="font-size:12px;color:#666;line-height:1.6;margin:0 0 10px;padding:10px 12px;background:#fff8e1;border-radius:10px;">
                签约代言会放开接单量，并提升曝光与转化。网红/腰部主播开局可约，更高咖位随店铺等级解锁。
            </div>
            <div class="card">
                <div class="card-header">
                    <div class="card-title">明星/达人资源</div>
                </div>
                ${celebrities.map(celeb => {
                    const need = celeb.unlockLevel || 1;
                    const locked = shopLv < need;
                    return `
                    <div class="celebrity-card" style="cursor:${locked ? 'not-allowed' : 'pointer'};opacity:${locked ? '0.55' : '1'};" 
                         onclick="${locked ? `ui.showToast('需店铺 Lv.${need} 解锁 ${celeb.name}')` : `ui.showEndorsementModal('${celeb.id}')`}">
                        <div class="celebrity-avatar">
                            ${celeb.type === 'influencer' ? '📷' : celeb.type === 'streamer' ? '🎥' : celeb.type === 'blogger' ? '✍️' : celeb.type === 'star' ? '⭐' : '🌟'}
                        </div>
                        <div class="celebrity-info">
                            <div class="celebrity-name">${celeb.name}${locked ? ` <span style="font-size:10px;color:#f44336;">Lv.${need}解锁</span>` : ''}</div>
                            <div class="celebrity-meta">粉丝: ${celeb.fans} | 咖位 Lv.${celeb.level}</div>
                            <div class="celebrity-fee">代言费: ¥${celeb.fee.toLocaleString()}/30天</div>
                        </div>
                        <div class="item-arrow">${locked ? '🔒' : '›'}</div>
                    </div>`;
                }).join('')}
            </div>
        `;
    }

    renderServicePage(state) {
        try {
            if (typeof csUI !== 'undefined' && csUI && typeof csUI.renderServicePage === 'function') {
                return csUI.renderServicePage(state);
            }
            if (typeof AfterSalesUI !== 'undefined' && AfterSalesUI && typeof AfterSalesUI.renderServicePage === 'function') {
                return AfterSalesUI.renderServicePage(state);
            }
        } catch (e) {
            console.warn('[renderServicePage] ops UI fallback:', e);
        }
        const currentTab = this.currentTab.service || 'consultations';
        const tabs = [
            { id: 'consultations', name: '买家咨询' },
            { id: 'returns', name: '退换货' },
            { id: 'disputes', name: '纠纷处理' }
        ];

        return `
            <div class="page">
                <div class="tabs">
                    ${tabs.map(tab => `
                        <div class="tab-item ${currentTab === tab.id ? 'active' : ''}" 
                             onclick="ui.switchTab('service', '${tab.id}')">
                            ${tab.name}
                            <span class="badge" style="margin-left:4px;font-size:10px;">
                                ${state.customerService[tab.id]?.filter(i => i.status === 'pending').length || 0}
                            </span>
                        </div>
                    `).join('')}
                </div>

                ${currentTab === 'consultations' ? this.renderConsultations(state) : ''}
                ${currentTab === 'returns' ? this.renderReturns(state) : ''}
                ${currentTab === 'disputes' ? this.renderDisputes(state) : ''}
            </div>
        `;
    }

    renderConsultations(state) {
        const all = (state.customerService.consultations || []).slice().sort((a, b) => {
            const aTime = ((a.createTime && a.createTime.day) || 0) * 24 + ((a.createTime && a.createTime.hour) || 0);
            const bTime = ((b.createTime && b.createTime.day) || 0) * 24 + ((b.createTime && b.createTime.hour) || 0);
            return bTime - aTime;
        });
        const pending = all.filter(c => c.status === 'pending' || c.status === 'missed');
        const done = all.filter(c => c.status !== 'pending' && c.status !== 'missed');

        if (all.length === 0) {
            return `
                <div class="empty-state">
                    <div class="icon">💬</div>
                    <div class="text">暂无咨询</div>
                </div>
            `;
        }

        const replyText = (c) => {
            if (typeof c.reply === 'string' && c.reply) return c.reply;
            const msgs = c.messages || [];
            for (let i = msgs.length - 1; i >= 0; i--) {
                if (msgs[i] && msgs[i].role === 'staff') return msgs[i].content;
            }
            return '';
        };

        const row = (c, extra) => `
                    <div class="cs-item" style="padding:12px 15px;" onclick="ui.replyConsultation('${c.id}')">
                        <div class="cs-avatar">${(c.buyerName || '?').slice(0, 1)}</div>
                        <div class="cs-content">
                            <div class="cs-header">
                                <span class="cs-name">${c.buyerName}</span>
                                <span class="cs-time">${formatDate(c.createTime.day, c.createTime.hour)}</span>
                            </div>
                            <div class="cs-preview">${c.productName}: ${c.question}</div>
                            ${c.status === 'pending' ? '<span class="badge badge-red" style="margin-top:4px;">待回复</span>' : ''}
                            ${c.status === 'missed' ? '<span class="badge badge-gray" style="margin-top:4px;">已超时</span>' : ''}
                            ${extra && c.orderId ? `<div style="margin-top:6px;font-size:11px;color:#ef6c00;">📦 订单 ${String(c.orderNo || c.orderId).slice(-10)}</div>` : ''}
                            ${extra && replyText(c) ? `<div style="margin-top:4px;font-size:12px;color:#1565c0;background:#e3f2fd;padding:6px 8px;border-radius:6px;">↩️ ${replyText(c)}</div>` : ''}
                        </div>
                    </div>`;

        return `
            <div class="card" style="padding:0;">
                ${pending.map(c => row(c, false)).join('')}
                ${done.length ? `<div style="padding:10px 15px;font-size:12px;font-weight:800;color:#5d4037;border-top:1px dashed #eee;">📋 已咨询订单 · 我们的回复</div>` : ''}
                ${done.map(c => row(c, true)).join('')}
            </div>
        `;
    }

    renderReturns(state) {
        const returns = state.customerService.returns;

        if (returns.length === 0) {
            return `
                <div class="empty-state">
                    <div class="icon">↩️</div>
                    <div class="text">暂无退换货申请</div>
                </div>
            `;
        }

        return `
            <div class="card" style="padding:0;">
                ${returns.map(r => `
                    <div class="product-item" style="padding:12px 15px;">
                        <div class="product-image">📦</div>
                        <div class="product-info">
                            <div class="product-name">${r.productName}</div>
                            <div class="product-meta">买家: ${r.buyerName}</div>
                            <div class="product-meta">原因: ${r.reason}</div>
                            <div class="product-meta" style="color:#ff6b35;">退款金额: ¥${r.amount.toFixed(2)}</div>
                        </div>
                        ${r.status === 'pending' ? `
                            <div style="display:flex;flex-direction:column;gap:5px;">
                                <button class="btn btn-success btn-small" onclick="ui.approveReturn('${r.id}')">同意</button>
                                <button class="btn btn-danger btn-small" onclick="ui.rejectReturn('${r.id}')">拒绝</button>
                            </div>
                        ` : `<span class="badge">${r.status === 'approved' ? '已同意' : '已拒绝'}</span>`}
                    </div>
                `).join('')}
            </div>
        `;
    }

    renderDisputes(state) {
        const disputes = state.customerService.disputes;

        if (disputes.length === 0) {
            return `
                <div class="empty-state">
                    <div class="icon">⚖️</div>
                    <div class="text">暂无纠纷</div>
                </div>
            `;
        }

        return `
            <div class="card" style="padding:0;">
                ${disputes.map(d => `
                    <div class="product-item" style="padding:12px 15px;">
                        <div class="product-image">⚖️</div>
                        <div class="product-info">
                            <div class="product-name">纠纷单号: ${d.id.slice(-8)}</div>
                            <div class="product-meta">订单: ${d.orderId?.slice(-10)}</div>
                            <div class="product-meta">原因: ${d.reason}</div>
                        </div>
                        <span class="badge">${d.status === 'pending' ? '处理中' : d.status}</span>
                    </div>
                `).join('')}
            </div>
        `;
    }

    /** 财务概览区块折叠/展开 */
    toggleFinanceCollapse(key) {
        if (!this._financeCollapse || typeof this._financeCollapse !== 'object') {
            this._financeCollapse = { todayDetail: false, todayIncome: true, todayExpense: false };
        }
        this._financeCollapse[key] = !this._financeCollapse[key];
        this.render();
    }

    /** 单条财务流水行 HTML */
    _renderFinanceRecordRow(r) {
        const isIncome = r.type === 'income';
        const label = r.categoryLabel || (isIncome ? '收入' : '支出');
        const hour = (r.hour != null && r.hour !== '') ? `${r.hour}:00` : '';
        return `
            <div class="finance-record" style="padding:10px 15px;border-bottom:1px solid #f0f0f0;">
                <div class="finance-left" style="flex:1;min-width:0;">
                    <div class="finance-reason" style="word-break:break-word;">
                        <span class="badge" style="background:${isIncome?'#e8f5e9':'#ffebee'};color:${isIncome?'#2e7d32':'#c62828'};font-size:10px;margin-right:4px;">${label}</span>
                        ${r.reason || '未注明'}
                    </div>
                    <div class="finance-time">第${r.day ?? '?'}天 ${hour}</div>
                </div>
                <div class="finance-amount ${r.type}" style="flex-shrink:0;margin-left:8px;">
                    ${isIncome ? '+' : '-'}${formatMoneyFull(r.amount || 0)}
                </div>
            </div>
        `;
    }

    /** 按分类汇总一组流水 */
    _summarizeFinanceRecords(list) {
        const sum = {
            income_sales: 0, income_other: 0,
            expense_purchase: 0, expense_express: 0, expense_packaging: 0,
            expense_platform: 0,
            expense_salary: 0, expense_marketing: 0, expense_penalty: 0,
            expense_upgrade: 0, expense_other: 0,
            incomeTotal: 0, expenseTotal: 0
        };
        for (const r of list) {
            const amt = Number(r.amount) || 0;
            if (r.type === 'income') {
                sum.incomeTotal += amt;
                if (r.category === 'sales') sum.income_sales += amt;
                else sum.income_other += amt;
            } else {
                sum.expenseTotal += amt;
                const key = 'expense_' + (r.category || 'other');
                if (sum[key] !== undefined) sum[key] += amt;
                else sum.expense_other += amt;
            }
        }
        return sum;
    }

    renderFinancePage(state) {
        const currentTab = this.currentTab.finance || 'overview';
        const financeFilter = this._financeRecordFilter || 'all'; // all | today | income | expense
        const tabs = [
            { id: 'overview', name: '财务概览' },
            { id: 'today', name: '当日明细' },
            { id: 'records', name: '全部明细' }
        ];

        const currentDay = state.gameTime?.day || 1;
        const records = [...(state.finance.records || [])].sort((a, b) => {
            const tb = (b.timestamp || 0) - (a.timestamp || 0);
            if (tb !== 0) return tb;
            const db = (b.day || 0) - (a.day || 0);
            if (db !== 0) return db;
            return (b.hour || 0) - (a.hour || 0);
        });
        const totalIncome = records.filter(r => r.type === 'income').reduce((s, r) => s + (r.amount || 0), 0);
        const totalExpense = records.filter(r => r.type === 'expense').reduce((s, r) => s + (r.amount || 0), 0);
        const netProfit = totalIncome - totalExpense;

        // 当天全部流水（以 records 为准，保证与明细一致）
        const todayRecords = records.filter(r => r.day === currentDay);
        const todayIncomeRows = todayRecords.filter(r => r.type === 'income');
        const todayExpenseRows = todayRecords.filter(r => r.type === 'expense');
        const todaySum = this._summarizeFinanceRecords(todayRecords);
        const todayTotalIncome = todaySum.incomeTotal;
        const todayTotalExpense = todaySum.expenseTotal;
        const todayProfit = todayTotalIncome - todayTotalExpense;

        const todayStat = gameState ? gameState.getDayFinanceSummary(currentDay) : null;
        const todayOrders = (todayStat && todayStat.orders) || 0;

        const finCollapse = this._financeCollapse || { todayDetail: false, todayIncome: true, todayExpense: false };
        const incomeOpen = !!finCollapse.todayIncome;
        const expenseOpen = !!finCollapse.todayExpense;
        const detailOpen = !!finCollapse.todayDetail;

        const renderTodayLedger = () => `
            <div style="padding:0 0 8px;">
                <div onclick="ui.toggleFinanceCollapse('todayIncome')"
                     style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;margin-bottom:${incomeOpen ? '0' : '10px'};background:#f1f8e9;border-radius:10px;cursor:pointer;user-select:none;">
                    <div style="font-size:13px;color:#2e7d32;font-weight:700;">
                        ${incomeOpen ? '▼' : '▶'} 💹 今日收入（${todayIncomeRows.length}笔）
                    </div>
                    <div style="font-size:13px;color:#2e7d32;font-weight:800;">${formatMoneyFull(todayTotalIncome)}</div>
                </div>
                ${incomeOpen ? `
                <div style="background:#f9fbe7;border-radius:0 0 10px 10px;overflow:hidden;margin:-4px 0 14px;border:1px solid #e8f5e9;border-top:none;">
                    ${todayIncomeRows.length === 0
                        ? `<div style="padding:16px;text-align:center;color:#999;font-size:12px;">今日暂无收入记录</div>`
                        : todayIncomeRows.map(r => this._renderFinanceRecordRow(r)).join('')}
                </div>` : ''}

                <div onclick="ui.toggleFinanceCollapse('todayExpense')"
                     style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;margin-bottom:${expenseOpen ? '0' : '0'};background:#ffebee;border-radius:10px;cursor:pointer;user-select:none;">
                    <div style="font-size:13px;color:#c62828;font-weight:700;">
                        ${expenseOpen ? '▼' : '▶'} 💸 今日支出（${todayExpenseRows.length}笔）
                    </div>
                    <div style="font-size:13px;color:#c62828;font-weight:800;">${formatMoneyFull(todayTotalExpense)}</div>
                </div>
                ${expenseOpen ? `
                <div style="background:#fff8f6;border-radius:0 0 10px 10px;overflow:hidden;margin-top:-4px;border:1px solid #ffcdd2;border-top:none;">
                    ${todayExpenseRows.length === 0
                        ? `<div style="padding:16px;text-align:center;color:#999;font-size:12px;">今日暂无支出记录</div>`
                        : todayExpenseRows.map(r => this._renderFinanceRecordRow(r)).join('')}
                </div>` : ''}
            </div>
        `;

        const categoryRowsHtml = `
            <div style="font-size:13px;color:#333;font-weight:600;margin-bottom:8px;">📊 收入构成</div>
            <div style="background:#f5f5f5;border-radius:8px;padding:10px 12px;">
                <div class="list-item" style="padding:4px 0;">
                    <span class="item-left"><span class="item-content"><span class="item-title" style="font-weight:400;">🛒 销售收入</span></span></span>
                    <span style="color:#2e7d32;font-weight:600;">${formatMoneyFull(todaySum.income_sales)}</span>
                </div>
                <div class="list-item" style="padding:4px 0;">
                    <span class="item-left"><span class="item-content"><span class="item-title" style="font-weight:400;">🎁 其他收入</span></span></span>
                    <span style="color:#2e7d32;font-weight:600;">${formatMoneyFull(todaySum.income_other)}</span>
                </div>
            </div>
            <div style="font-size:13px;color:#333;font-weight:600;margin:14px 0 8px;">📋 支出构成</div>
            <div style="background:#fff5f5;border-radius:8px;padding:10px 12px;">
                ${[
                    ['📦 商品采购', todaySum.expense_purchase],
                    ['🚚 快递费用', todaySum.expense_express],
                    ['📦 包装物料', todaySum.expense_packaging],
                    ['🏛️ 平台抽成', todaySum.expense_platform],
                    ['👷 员工工资', todaySum.expense_salary],
                    ['📣 营销推广', todaySum.expense_marketing],
                    ['⚖️ 处罚赔付', todaySum.expense_penalty],
                    ['🏗️ 升级扩建', todaySum.expense_upgrade],
                    ['🧾 其他支出', todaySum.expense_other]
                ].map(([k, v]) => `
                    <div class="list-item" style="padding:4px 0;">
                        <span class="item-left"><span class="item-content"><span class="item-title" style="font-weight:400;">${k}</span></span></span>
                        <span style="color:#c62828;font-weight:600;">${formatMoneyFull(v)}</span>
                    </div>
                `).join('')}
            </div>
        `;

        const platformRatePct = (gameState && typeof gameState.getPlatformCommissionRate === 'function')
            ? Math.round(gameState.getPlatformCommissionRate() * 100)
            : 1;
        const platformPaidTotal = (gameState && typeof gameState.getPlatformCommissionPaid === 'function')
            ? gameState.getPlatformCommissionPaid()
            : (Number(state.finance?.platformCommissionPaid) || todaySum.expense_platform || 0);
        // 累计：优先存档累计；若为0则从全部流水汇总（兼容旧档）
        const platformPaidFromRecords = records
            .filter(r => r.type === 'expense' && (r.category === 'platform' || /平台抽成/.test(String(r.reason || ''))))
            .reduce((s, r) => s + (Number(r.amount) || 0), 0);
        const platformPaidDisplay = Math.max(platformPaidTotal, Math.round(platformPaidFromRecords * 100) / 100);

        let filteredRecords = records;
        if (financeFilter === 'today') filteredRecords = todayRecords;
        else if (financeFilter === 'income') filteredRecords = records.filter(r => r.type === 'income');
        else if (financeFilter === 'expense') filteredRecords = records.filter(r => r.type === 'expense');

        return `
            <div class="page">
                <div class="wb-subbar">
                    <button type="button" class="wb-back" onclick="ui.navigateTo('dashboard')">‹ 首页</button>
                    <div class="wb-subbar-title">财务中心</div>
                </div>
                <div class="tabs">
                    ${tabs.map(tab => `
                        <div class="tab-item ${currentTab === tab.id ? 'active' : ''}"
                             onclick="ui.switchTab('finance', '${tab.id}')">${tab.name}</div>
                    `).join('')}
                </div>

                ${currentTab === 'overview' ? `
                    <div class="stats-grid">
                        <div class="stat-item">
                            <div class="stat-value green">${formatMoney(totalIncome)}</div>
                            <div class="stat-label">累计收入</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value" style="color:#f44336;">${formatMoney(totalExpense)}</div>
                            <div class="stat-label">累计支出</div>
                        </div>
                        <div class="stat-item" style="grid-column: span 2;">
                            <div class="stat-value ${netProfit >= 0 ? 'green' : ''}" style="color:${netProfit < 0 ? '#f44336' : ''}">
                                ${formatMoney(netProfit)}
                            </div>
                            <div class="stat-label">累计净利润 · 流水 ${records.length} 笔（含采购员采购）</div>
                        </div>
                    </div>

                    <div class="card" style="background:linear-gradient(135deg,#fff8e1,#fff3e0);border:1px solid #ffe0b2;">
                        <div style="padding:14px 16px;display:flex;justify-content:space-between;align-items:center;gap:12px;">
                            <div>
                                <div style="font-size:13px;font-weight:800;color:#e65100;">🏛️ 平台抽成（成交额 ${platformRatePct}%）</div>
                                <div style="font-size:11px;color:#888;margin-top:4px;">
                                    今日已交 ${formatMoneyFull(todaySum.expense_platform)} · 每笔订单签收后自动扣除
                                </div>
                            </div>
                            <div style="text-align:right;">
                                <div style="font-size:11px;color:#888;">累计交给平台</div>
                                <div style="font-size:22px;font-weight:900;color:#e65100;font-variant-numeric:tabular-nums;">
                                    ${formatMoneyFull(platformPaidDisplay)}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="card">
                        <div class="card-header">
                            <div class="card-title">今日收支 · 第${currentDay}天</div>
                            <div style="font-size:11px;color:#888;">共 ${todayRecords.length} 笔流水</div>
                        </div>
                        <div class="stats-grid" style="grid-template-columns:repeat(2,1fr);padding:0 12px 12px;">
                            <div class="stat-item">
                                <div class="stat-value green" style="font-size:18px;">${formatMoney(todayTotalIncome)}</div>
                                <div class="stat-label">今日收入 · ${todayIncomeRows.length}笔</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-value" style="font-size:18px;color:#f44336;">${formatMoney(todayTotalExpense)}</div>
                                <div class="stat-label">今日支出 · ${todayExpenseRows.length}笔</div>
                            </div>
                            <div class="stat-item" style="grid-column: span 2;">
                                <div class="stat-value" style="font-size:20px;color:${todayProfit>=0?'#4caf50':'#f44336'};">
                                    ${formatMoney(todayProfit)}
                                </div>
                                <div class="stat-label">今日利润 · 订单 ${todayOrders} 个</div>
                            </div>
                        </div>
                        <div style="padding:0 15px 8px;">
                            ${categoryRowsHtml}
                            <div style="margin-top:10px;padding:10px 12px;border-radius:8px;background:${todayProfit>=0?'#e8f5e9':'#ffebee'};border:1px dashed ${todayProfit>=0?'#66bb6a':'#ef5350'};">
                                <div class="list-item" style="padding:0;">
                                    <span class="item-left"><span class="item-content"><span class="item-title" style="font-weight:700;">💰 今日利润 = 收入 − 支出</span></span></span>
                                    <span style="font-weight:800;color:${todayProfit>=0?'#2e7d32':'#c62828'};font-size:15px;">
                                        ${formatMoneyFull(todayProfit)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="card" style="padding:0;">
                        <div onclick="ui.toggleFinanceCollapse('todayDetail')"
                             style="display:flex;justify-content:space-between;align-items:center;padding:12px 15px;cursor:pointer;user-select:none;">
                            <div>
                                <div class="card-title" style="margin:0;">
                                    ${detailOpen ? '▼' : '▶'} 今日全部明细
                                </div>
                                <div style="font-size:11px;color:#888;margin-top:4px;">
                                    ${todayRecords.length} 笔 · 收入 ${formatMoney(todayTotalIncome)} / 支出 ${formatMoney(todayTotalExpense)}
                                    ${detailOpen ? '' : ' · 点击展开'}
                                </div>
                            </div>
                            <button class="btn btn-secondary btn-sm" style="font-size:11px;padding:4px 8px;"
                                    onclick="event.stopPropagation();ui.switchTab('finance','today')">${detailOpen ? '分类页' : '展开'}</button>
                        </div>
                        ${detailOpen ? `
                        <div style="padding:0 15px 12px;border-top:1px solid #f0f0f0;">
                            ${renderTodayLedger()}
                        </div>` : ''}
                    </div>

                    <div class="card">
                        <div class="card-header">
                            <div class="card-title">近期经营数据</div>
                        </div>
                        ${(state.finance.dailyStats || []).slice(-7).reverse().map(stat => {
                            const dayTotal = (stat.expense_purchase||0)+(stat.expense_express||0)+(stat.expense_packaging||0)+
                                            (stat.expense_platform||0)+
                                            (stat.expense_salary||0)+(stat.expense_marketing||0)+(stat.expense_penalty||0)+
                                            (stat.expense_upgrade||0)+(stat.expense_other||0);
                            return `
                            <div class="list-item">
                                <div class="item-left">
                                    <div class="item-content">
                                        <div class="item-title">第${stat.day}天${stat.day===currentDay?' · 今天':''}</div>
                                        <div class="item-desc">订单: ${stat.orders||0}个 · 支出: ${formatMoney(dayTotal)}</div>
                                    </div>
                                </div>
                                <div style="text-align:right;">
                                    <div style="font-size:14px;font-weight:bold;color:#4caf50;">
                                        ${formatMoney(stat.sales||0)}
                                    </div>
                                    <div style="font-size:11px;color:${(stat.profit||0)>=0?'#66bb6a':'#ef5350'};">
                                        利润: ${formatMoney(stat.profit||0)}
                                    </div>
                                </div>
                            </div>
                            `;
                        }).join('')}
                        ${(state.finance.dailyStats || []).length === 0 ? `
                            <div style="text-align:center;padding:20px;color:#999;font-size:13px;">暂无数据</div>
                        ` : ''}
                    </div>
                ` : ''}

                ${currentTab === 'today' ? `
                    <div class="card">
                        <div class="card-header">
                            <div class="card-title">第${currentDay}天 · 分类汇总</div>
                            <div style="font-size:11px;color:#888;">${todayRecords.length} 笔</div>
                        </div>
                        <div style="padding:8px 15px 12px;">
                            ${categoryRowsHtml}
                            <div style="margin-top:14px;padding:14px;border-radius:12px;background:${todayProfit>=0?'linear-gradient(135deg,#e8f5e9,#c8e6c9)':'linear-gradient(135deg,#ffebee,#ffcdd2)'};">
                                <div style="font-size:13px;color:#555;margin-bottom:6px;">💵 今日利润（订单 ${todayOrders} 个）</div>
                                <div style="font-size:26px;font-weight:900;color:${todayProfit>=0?'#2e7d32':'#c62828'};">
                                    ${formatMoney(todayProfit)}
                                </div>
                                <div style="font-size:11px;color:#666;margin-top:4px;">
                                    收入 ${formatMoneyFull(todayTotalIncome)} − 支出 ${formatMoneyFull(todayTotalExpense)}
                                    · 收入${todayIncomeRows.length}笔 / 支出${todayExpenseRows.length}笔
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="card" style="padding:12px 15px;">
                        <div class="card-header" style="padding:0 0 8px;">
                            <div class="card-title">今日全部流水明细</div>
                        </div>
                        ${renderTodayLedger()}
                    </div>
                ` : ''}

                ${currentTab === 'records' ? `
                    <div class="card" style="padding:12px 15px 8px;">
                        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
                            ${[
                                ['all', '全部'],
                                ['today', '仅今天'],
                                ['income', '仅收入'],
                                ['expense', '仅支出']
                            ].map(([id, name]) => `
                                <button class="btn ${financeFilter === id ? 'btn-primary' : 'btn-secondary'} btn-sm"
                                    style="font-size:11px;padding:4px 10px;"
                                    onclick="ui._financeRecordFilter='${id}';ui.switchTab('finance','records')">${name}</button>
                            `).join('')}
                        </div>
                        <div style="font-size:12px;color:#666;margin-bottom:4px;">
                            显示 ${filteredRecords.length} / ${records.length} 笔
                            ${financeFilter === 'today' ? `（第${currentDay}天）` : ''}
                        </div>
                    </div>
                    <div class="card" style="padding:0;">
                        ${filteredRecords.length === 0 ? `
                            <div style="text-align:center;padding:40px;color:#999;">暂无记录</div>
                        ` : filteredRecords.map(r => this._renderFinanceRecordRow(r)).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }

    renderProfilePage(state) {
        const level = gameState.getCurrentLevel();
        const nextLevel = SHOP_LEVELS.find(l => l.level === state.shop.level + 1);
        const playerName = state.player?.name || '店长';
        const empCount = (state.employees || []).filter(e => e && e.status !== 'resigned').length;
        const memberCount = state.members?.total || 0;
        const availCoupons = gameState.getAvailableCouponsForReceive().length;
        const unlockedAchievements = state.achievements?.unlocked?.length || 0;
        // 旧快递议价系统已下线：正常运行时用 ExpressState.getActivePartners()（见下方入口描述）
        const activeCouriers = 0;
        // 统一走 gameState 容量 API；店铺升级后对齐同级仓容（旧档读档即修 100000 满仓假象）
        let warehouseUsed = 0, warehouseCap = 100000, whLevel = 1;
        try {
            const whMod = (typeof window !== 'undefined' && window.warehouseState)
                || (typeof warehouseState !== 'undefined' ? warehouseState : null)
                || (gameState && gameState.warehouse)
                || null;
            if (whMod && typeof whMod.ensureLevelAtLeast === 'function' && state.shop) {
                const shopLv = parseInt(state.shop.level, 10) || 1;
                const whLv = (whMod.state && whMod.state.level) || 1;
                if (shopLv > whLv) whMod.ensureLevelAtLeast(shopLv, { silent: true });
            } else if (whMod && typeof whMod.syncCapacityToGameState === 'function') {
                // 等级已对齐时只回写数字，避免每次整页重建都做库位重算
                whMod.syncCapacityToGameState();
            }
            if (typeof gameState.getUsedCapacity === 'function') warehouseUsed = gameState.getUsedCapacity();
            if (typeof gameState.getWarehouseCapacity === 'function') warehouseCap = gameState.getWarehouseCapacity();
            if (whMod) {
                if (typeof whMod.getUsedCapacity === 'function') warehouseUsed = whMod.getUsedCapacity();
                if (typeof whMod.getCapacity === 'function') warehouseCap = whMod.getCapacity();
                if (whMod.state && whMod.state.level != null) whLevel = whMod.state.level;
            }
        } catch (_) {
            warehouseUsed = state.warehouse?.usedCapacity || state.warehouse?.used || 0;
            warehouseCap = state.warehouse?.capacity || 100000;
        }
        const warehousePct = Math.min(100, Math.round((warehouseUsed / Math.max(1, warehouseCap)) * 100));
        const isLive = state.livestream?.isLive;
        const attrPoints = state.player?.attributePoints || 0;
        void warehousePct; void isLive; void attrPoints;

        const profileGroups = (typeof AppNav !== 'undefined' && AppNav.buildCatalog)
            ? AppNav.buildCatalog(state, { surface: 'profile' })
            : [];
        const profileGridsHtml = profileGroups.map(g => `
                <div class="profile-section-title">
                    <span class="profile-section-dot"></span>
                    ${g.title}
                </div>
                <div class="profile-grid">
                    ${this._renderModuleTiles(g.items)}
                </div>`).join('');

        return `
            <div class="page profile-page">
                <!-- ① 顶部店铺信息卡（渐变背景，保留现有视觉风格） -->
                <div class="profile-hero-card brand-theme-${(state.shop && state.shop.brandBadge) || 'normal'}">
                    <div class="profile-hero-bg"></div>
                    <div class="profile-hero-content">
                        <div class="profile-avatar">
                            <span>🏪</span>
                        </div>
                        <div class="profile-hero-info">
                            <div class="profile-hero-row">
                                <span class="profile-shop-name">${state.shop.name}</span>
                                <span class="profile-shop-level">${level.name} · Lv.${state.shop.level}</span>
                                ${(() => {
                                    try {
                                        const badge = (typeof gameState !== 'undefined' && gameState.getBrandBadgeInfo)
                                            ? gameState.getBrandBadgeInfo()
                                            : ((typeof getBrandBadgeById === 'function')
                                                ? getBrandBadgeById(state.shop.brandBadge || 'normal')
                                                : null);
                                        if (!badge) return '';
                                        const bid = badge.id || 'normal';
                                        return `<span class="profile-brand-badge pbb-${bid}" title="${badge.desc || badge.name}">${badge.icon || ''} ${badge.name}</span>`;
                                    } catch (_) { return ''; }
                                })()}
                            </div>
                            <div class="profile-hero-sub">
                                店主：<b>${escapeHtml(playerName)}</b>
                                <span class="profile-divider">|</span>
                                ⭐ ${(typeof state.shop.rating === 'number' ? state.shop.rating : 5).toFixed(1)}
                                <span class="profile-divider">|</span>
                                信誉 ${state.shop.reputation}${nextLevel ? ' / ' + nextLevel.minReputation : ''}
                            </div>
                        </div>
                    </div>
                    <!-- 升级进度条（按销量门槛，信誉已不再作为自动升级条件） -->
                    ${nextLevel ? (() => {
                        const soldQty = (typeof gameState.getTotalSoldQuantity === 'function')
                            ? gameState.getTotalSoldQuantity()
                            : (state.shop.totalSales || 0);
                        const needQty = Number(nextLevel.minSalesQty) || 0;
                        const fee = Number(nextLevel.upgradeFee) || 0;
                        const pct = needQty > 0 ? Math.min(100, (soldQty / needQty) * 100) : 100;
                        const remain = Math.max(0, needQty - soldQty);
                        const tip = needQty > 0
                            ? (remain > 0
                                ? `距「${nextLevel.name}」还需销量 ${remain} 件${fee ? ` · 升级费 ¥${fee.toLocaleString()}` : ''}`
                                : `销量已达标，可付费升级「${nextLevel.name}」${fee ? `（¥${fee.toLocaleString()}）` : ''}`)
                            : `可升级「${nextLevel.name}」${fee ? ` · 升级费 ¥${fee.toLocaleString()}` : ''}`;
                        return `
                        <div class="profile-level-bar">
                            <div class="profile-level-fill" style="width:${pct}%;"></div>
                        </div>
                        <div class="profile-level-tip">${tip}</div>`;
                    })() : `
                        <div class="profile-level-bar"><div class="profile-level-fill" style="width:100%;background:linear-gradient(90deg,#ffd700,#fff);"></div></div>
                        <div class="profile-level-tip">🌟 已达到最高等级</div>
                    `}
                </div>

                <!-- ①b 品牌标识：缴纳品牌金升级品牌（紧邻店铺升级进度） -->
                ${(() => {
                    try {
                        const badges = (typeof BRAND_BADGES !== 'undefined') ? BRAND_BADGES : [];
                        if (!badges.length) return '';
                        const curId = state.shop.brandBadge || 'normal';
                        const unlockedList = Array.isArray(state.shop.unlockedBrandBadges) && state.shop.unlockedBrandBadges.length
                            ? state.shop.unlockedBrandBadges
                            : ['normal'];
                        const funds = Number(state.shop.funds) || 0;
                        const fmtFee = (fee) => fee >= 100000000 ? `${fee / 100000000}亿` : `${fee / 10000}万`;
                        const items = badges.map(b => {
                            const unlocked = unlockedList.indexOf(b.id) >= 0;
                            const active = curId === b.id;
                            const fee = Number(b.fee) || 0;
                            const need = fee > 0
                                ? (unlocked ? `已缴品牌金 ¥${fmtFee(fee)}` : `需缴品牌金 ¥${fmtFee(fee)}`)
                                : '免费默认';
                            let actionHtml = '';
                            if (active) {
                                actionHtml = '<span class="brand-badge-using">✦ 使用中</span>';
                            } else if (unlocked) {
                                actionHtml = `<button class="btn btn-primary btn-xs" onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()" onclick="ui.unlockBrandBadge('${b.id}')">启用</button>`;
                            } else if (fee <= 0 || funds >= fee) {
                                actionHtml = `<button class="btn btn-primary btn-xs" onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()" onclick="ui.unlockBrandBadge('${b.id}')">${fee > 0 ? '缴纳启用' : '启用'}</button>`;
                            } else {
                                actionHtml = '<span class="brand-badge-poor">资金不足</span>';
                            }
                            return `<div class="brand-badge-item bb-tier-${b.id} ${active ? 'active' : ''}">
                                <span class="brand-badge-icon">${b.icon || '🏷️'}</span>
                                <div class="brand-badge-head">
                                    <div class="brand-badge-name">${b.name}</div>
                                    <div class="brand-badge-need">${need}</div>
                                </div>
                                ${actionHtml}
                            </div>`;
                        }).join('');
                        return `
                            <div class="profile-brand-card">
                                <div class="profile-brand-header">
                                    <span style="font-weight:700;font-size:12px;color:#5d4037;">🏅 品牌标识</span>
                                    <span class="profile-brand-balance">余额 ¥${Math.round(funds).toLocaleString()}</span>
                                </div>
                                <div class="profile-brand-grid">${items}</div>
                            </div>
                            <style>
                                .profile-brand-card{
                                    margin:8px 14px 0;padding:8px 10px;border-radius:10px;
                                    background:linear-gradient(135deg,#fff8f2,#ffeede);
                                    border:1px solid #ffdfc2;
                                }
                                .profile-brand-header{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;}
                                .profile-brand-balance{font-size:10px;font-weight:700;color:#ff6b35;background:rgba(255,107,53,.12);padding:1px 7px;border-radius:999px;white-space:nowrap;}
                                .profile-brand-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:5px;}
                                .brand-badge-item{
                                    position:relative;overflow:hidden;
                                    padding:6px 7px;border-radius:8px;background:#fff;border:1px solid #f3e2d2;
                                    display:flex;align-items:center;gap:5px;
                                }
                                .brand-badge-icon{font-size:16px;line-height:1;flex-shrink:0;}
                                .brand-badge-head{flex:1;min-width:0;}
                                .brand-badge-name{font-weight:700;font-size:11px;color:#333;}
                                .brand-badge-need{font-size:9px;color:#ff8a50;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
                                .brand-badge-using{font-size:9px;font-weight:800;color:#ff6b35;white-space:nowrap;}
                                .brand-badge-poor{font-size:9px;color:#bbb;white-space:nowrap;}
                                .brand-badge-item .btn-xs{padding:2px 6px;font-size:10px;line-height:1.2;}
                            </style>
                        `;
                    } catch (_) { return ''; }
                })()}

                <!-- ② 核心数据条（4格快览） -->
                <div class="profile-stats-bar">
                    <div class="profile-stat-item">
                        <div class="profile-stat-value" style="color:#ff6b35;">${formatMoney(state.shop.funds)}</div>
                        <div class="profile-stat-label">💰 可用资金</div>
                    </div>
                    <div class="profile-stat-item">
                        <div class="profile-stat-value" style="color:#ff9800;">${state.shop.totalOrders}</div>
                        <div class="profile-stat-label">📦 总订单</div>
                    </div>
                    <div class="profile-stat-item">
                        <div class="profile-stat-value" style="color:#4caf50;">${state.shop.totalSales}</div>
                        <div class="profile-stat-label">🛒 总销量</div>
                    </div>
                    <div class="profile-stat-item rating-clickable" onclick="ui.showRatingDetail()" title="查看店铺评分详情" style="cursor:pointer;">
                        <div class="profile-stat-value" style="color:#2196f3;">⭐${(typeof state.shop.rating === 'number' ? state.shop.rating : 5).toFixed(1)}</div>
                        <div class="profile-stat-label">✨ 评分</div>
                    </div>
                </div>

                <!-- ③ 不常用功能回「我的」 -->
                ${profileGridsHtml}

                <!-- ④ 员工列表抽屉（默认隐藏区域，点击员工管理后滚动到此处展开） -->
                <div id="employeeSection" class="card" style="margin-top:14px;display:none;">
                    <div class="card-header">
                        <div class="card-title">👥 员工详情</div>
                        <div style="display:flex;gap:8px;align-items:center;">
                            <span style="color:#ff6b35;font-size:13px;cursor:pointer;" onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()" onclick="ui.showWelfareSystemModal()">🎁 福利</span>
                            <span style="color:#4caf50;font-size:13px;cursor:pointer;font-weight:600;" onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()" onclick="ui.upgradeEmployeeBatchAll()">🔋 批量升级</span>
                            <span style="color:#e53935;font-size:13px;cursor:pointer;font-weight:600;" onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()" onclick="ui.fireEmployeeBatchAll()">🔪 一键裁员</span>
                            <span style="color:#ff6b35;font-size:13px;cursor:pointer;" onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()" onclick="ui.showHireEmployeeModal()">+ 招聘</span>
                        </div>
                    </div>
                    ${state.employees.length === 0 ? `
                        <div style="text-align:center;padding:24px;color:#999;font-size:13px;">
                            暂无员工，点击右上角招聘
                        </div>
                    ` : `
                        <div id="employeeList" style="max-height:560px;overflow-y:auto;will-change:scroll-position;contain:layout paint;">
                            ${state.employees.map(emp => this._renderEmployeeCard(emp, state)).join('')}
                        </div>
                    `}
                </div>

                <div class="profile-section-title">
                    <span class="profile-section-dot"></span>
                    账号与设置
                </div>
                ${this._renderProfileSettings(state)}
            </div>
        `;
    }

    /**
     * 「我的」页 · 账号与设置（通知 / 声音 / 账号 / 关于）
     */
    _renderProfileSettings(state) {
        const click = 'onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"';
        const PREF = (typeof window !== 'undefined' && window.SUPPLY_OUTAGE_DNDPREF)
            ? window.SUPPLY_OUTAGE_DNDPREF
            : {
                levels: [
                    { value: 'all', name: '全部', desc: '每次货源断供立即提醒' },
                    { value: 'digest', name: '汇总', desc: '每天零点汇总为一条' },
                    { value: 'none', name: '静默', desc: '不弹窗，仅记入日志' }
                ],
                settingKey: 'supplyOutageNotifyLevel'
            };
        const outageCur = (state && state.settings && state.settings[PREF.settingKey]) || 'all';
        const outageMeta = PREF.levels.find(x => x.value === outageCur) || PREF.levels[0];
        const soundOn = (typeof SoundManager !== 'undefined')
            ? SoundManager.isEnabled()
            : (state?.settings?.soundEnabled !== false);
        const bgmOn = (typeof SoundManager !== 'undefined')
            ? SoundManager.isBgmEnabled()
            : !!(state?.settings?.bgmEnabled);
        const bgmVol = (typeof SoundManager !== 'undefined')
            ? Math.round(SoundManager.getBgmVolume() * 100)
            : Math.round(((state?.settings?.bgmVolume) || 0.35) * 100);
        const version = (typeof APP_VERSION_NAME !== 'undefined') ? APP_VERSION_NAME : '电商经营模拟器 v4.0.0';

        const seg = PREF.levels.map(lv => {
            const name = lv.value === 'all' ? '全部' : (lv.value === 'digest' ? '汇总' : (lv.value === 'none' ? '静默' : lv.name));
            return `<button type="button" class="ps-seg-item ${lv.value === outageCur ? 'active' : ''}"
                ${click} onclick="event.stopPropagation();ui.setSupplyOutageNotifyLevel('${lv.value}')">${name}</button>`;
        }).join('');

        const row = (opts) => {
            const tag = opts.action ? 'button' : 'div';
            const extra = opts.action
                ? `type="button" ${click} onclick="${opts.action}"`
                : '';
            const cls = `ps-row${opts.danger ? ' danger' : ''}${opts.action ? '' : ' static'}`;
            return `<${tag} class="${cls}" ${extra}>
                <div class="ps-icon" style="background:${opts.color};">${opts.icon}</div>
                <div class="ps-body">
                    <div class="ps-title">${opts.title}</div>
                    ${opts.desc ? `<div class="ps-desc">${opts.desc}</div>` : ''}
                </div>
                <div class="ps-right">${opts.right || ''}</div>
            </${tag}>`;
        };

        return `
            <div class="profile-settings">
                <div class="ps-group">
                    ${row({
                        icon: '📢',
                        color: 'linear-gradient(135deg,#42a5f5,#1e88e5)',
                        title: '货源断供通知',
                        desc: escapeHtml(outageMeta.desc || ''),
                        right: `<div class="ps-seg">${seg}</div>`
                    })}
                    ${row({
                        action: 'ui.toggleSoundEnabled()',
                        icon: '🔊',
                        color: 'linear-gradient(135deg,#66bb6a,#43a047)',
                        title: '游戏音效',
                        desc: soundOn ? '订单、到账与提示音已开启' : '已关闭短音效',
                        right: `<span class="ps-switch ${soundOn ? 'on' : ''}"></span>`
                    })}
                    ${row({
                        action: 'ui.toggleBgmEnabled()',
                        icon: '🎵',
                        color: 'linear-gradient(135deg,#ab47bc,#8e24aa)',
                        title: '背景音乐',
                        desc: bgmOn ? '循环播放中' : '已关闭背景音乐',
                        right: `<span class="ps-switch ${bgmOn ? 'on' : ''}"></span>`
                    })}
                    <div class="ps-row static">
                        <div class="ps-icon" style="background:linear-gradient(135deg,#ffb74d,#fb8c00);">🔉</div>
                        <div class="ps-body">
                            <div class="ps-title">音乐音量</div>
                            <div class="ps-vol">
                                <input type="range" min="0" max="100" value="${bgmVol}"
                                       onmousedown="event.stopPropagation();ui._markJustClicked()"
                                       ontouchstart="event.stopPropagation();ui._markJustClicked()"
                                       oninput="ui.setBgmVolume(this.value);var el=document.getElementById('psBgmVolLabel');if(el)el.textContent=this.value+'%'">
                                <span class="ps-vol-val" id="psBgmVolLabel">${bgmVol}%</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="ps-group">
                    ${row({
                        action: 'ui.showRenameModal()',
                        icon: '✏️',
                        color: 'linear-gradient(135deg,#ff8a65,#ff6b35)',
                        title: '修改店名',
                        desc: '店主姓名与店铺名称',
                        right: '<span class="ps-chevron">›</span>'
                    })}
                    ${row({
                        action: 'ui.showRedeemCodeModal()',
                        icon: '🎁',
                        color: 'linear-gradient(135deg,#ec407a,#d81b60)',
                        title: '兑换码',
                        desc: '输入礼包码领取奖励',
                        right: '<span class="ps-chevron">›</span>'
                    })}
                    ${row({
                        action: 'ui.showArchiveManagerModal()',
                        icon: '💾',
                        color: 'linear-gradient(135deg,#5c6bc0,#3949ab)',
                        title: '存档管理',
                        desc: '备份、导入与恢复进度',
                        right: '<span class="ps-chevron">›</span>'
                    })}
                </div>

                <div class="ps-group">
                    ${row({
                        action: 'ui.maybeShowNewbieGuide(true)',
                        icon: '📘',
                        color: 'linear-gradient(135deg,#ffb74d,#ff6b35)',
                        title: '新手教程',
                        desc: '再看一遍开局界面引导',
                        right: '<span class="ps-chevron">›</span>'
                    })}
                    ${row({
                        action: 'ui.showPrivacyPolicy()',
                        icon: '📜',
                        color: 'linear-gradient(135deg,#26a69a,#00897b)',
                        title: '隐私协议',
                        desc: '用户协议与隐私政策',
                        right: '<span class="ps-chevron">›</span>'
                    })}
                    ${row({
                        action: 'ui.resetGame()',
                        danger: true,
                        icon: '🔄',
                        color: 'linear-gradient(135deg,#ef5350,#e53935)',
                        title: '重新开始',
                        desc: '清空进度，回到第 1 天',
                        right: '<span class="ps-chevron">›</span>'
                    })}
                </div>
            </div>
            <div class="profile-footer">${version}</div>
        `;
    }

    /**
     * 滚动到指定 section（用于九宫格点击"员工管理"展开并滚动）
     */
    _scrollToSection(id) {
        if (id === 'employeeSection') {
            // 切换到员工详情：先显示
            const sec = document.getElementById(id);
            if (sec) {
                sec.style.display = '';
                // 平滑滚动到该区域
                setTimeout(() => {
                    sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 60);
            }
        }
    }

    /**
     * 渲染单个员工卡片（抽离复用）
     */
    _renderEmployeeCard(emp, state) {
        const typeInfo = (typeof EMPLOYEE_TYPES !== 'undefined' && EMPLOYEE_TYPES[emp.type]) || null;
        const task = emp.currentTask;
        let statusText = '空闲中';
        let statusColor = '#999';
        let statusIcon = '💤';
        let progressHtml = '';

        // 无 startTime / duration 的坏任务按空闲处理，避免白屏
        const taskTimeOk = !!(task && task.startTime
            && typeof task.startTime.day === 'number'
            && typeof task.duration === 'number' && task.duration > 0);
        if (task && taskTimeOk) {
            const now = state.gameTime || { day: 1, hour: 0 };
            const hoursPassed = (now.day - task.startTime.day) * 24 + ((now.hour || 0) - (task.startTime.hour || 0));
            const progress = Math.min(100, (hoursPassed / task.duration) * 100);
            const remaining = Math.max(0, task.duration - hoursPassed);

            if (task.type === 'pack') {
                const n = task.count || 1;
                statusText = n > 1 ? `打包中×${n}` : '打包中';
                statusColor = '#ff9800';
                statusIcon = '📦';
            } else if (task.type === 'ship') {
                statusText = '发货中';
                statusColor = '#2196f3';
                statusIcon = '🚚';
            } else if (task.type === 'consultation') {
                statusText = '接待中';
                statusColor = '#4caf50';
                statusIcon = '💬';
            } else if (task.type === 'marketing') {
                statusText = '推广中';
                statusColor = '#9c27b0';
                statusIcon = '📣';
            } else if (task.type === 'listing') {
                statusText = '上架中';
                statusColor = '#00897b';
                statusIcon = '🏷️';
            }

            progressHtml = `
                <div style="min-height:24px;margin-top:6px;">
                    <div style="display:flex;justify-content:space-between;font-size:11px;color:#999;margin-bottom:3px;">
                        <span>${statusIcon} ${statusText}</span>
                        <span>${remaining.toFixed(1)}小时</span>
                    </div>
                    <div style="height:4px;background:#eee;border-radius:2px;overflow:hidden;">
                        <div style="height:100%;width:${progress}%;background:${statusColor};border-radius:2px;transition:width 0.3s;"></div>
                    </div>
                </div>
            `;
        } else {
            progressHtml = `<div style="min-height:24px;margin-top:6px;"></div>`;
        }

        const level = emp.level || 1;
        const curExp = emp.exp || 0;
        const needExp = EMPLOYEE_LEVEL_CONFIG.expToNext(level);
        const expPct = Math.min(100, Math.round((curExp / needExp) * 100));
        const maxed = level >= EMPLOYEE_LEVEL_CONFIG.maxLevel;
        const realEff = gameState ? (gameState.getEmployeeEfficiency(emp) || 1) : 1;
        const stats = emp.stats || {};
        const packCap = (typeof EMPLOYEE_LEVEL_CONFIG.packCapacity === 'function')
            ? EMPLOYEE_LEVEL_CONFIG.packCapacity(level)
            : (2 + level);
        const welfare = (typeof EMPLOYEE_WELFARE_CONFIG !== 'undefined' && EMPLOYEE_WELFARE_CONFIG.getLevel)
            ? EMPLOYEE_WELFARE_CONFIG.getLevel(emp)
            : null;

        const hKey = 'D' + state.gameTime.day + 'H' + state.gameTime.hour;
        const hc = (stats.hourlyCounts && stats.hourlyCounts[hKey]) || {packed:0, shipped:0, consultation:0, marketing:0};
        const upCost = maxed ? 0 : EMPLOYEE_LEVEL_CONFIG.promotionCost(level);
        let totalUpCost = 0, lv = level;
        if (!maxed && gameState && gameState.state && gameState.state.shop) {
            let remain = gameState.state.shop.funds;
            let safety2 = 999;
            while (safety2-- > 0 && lv < EMPLOYEE_LEVEL_CONFIG.maxLevel) {
                const cc = EMPLOYEE_LEVEL_CONFIG.promotionCost(lv);
                if (remain >= cc) { totalUpCost += cc; remain -= cc; lv++; }
                else break;
            }
        }

        return `
            <div data-emp="${emp.id}" style="padding:10px 4px;border-bottom:1px solid #f0f0f0;contain:layout;">
                <div class="list-item" style="padding:4px 0;">
                    <div class="item-left">
                        <div class="item-icon">${typeInfo?.icon || '👤'}</div>
                        <div class="item-content" style="flex:1;">
                            <div style="display:flex;justify-content:space-between;align-items:center;">
                                <div class="item-title">
                                    ${emp.name}
                                    <span class="badge" style="background:#fff3e0;color:#e65100;margin-left:4px;">Lv.${level}</span>
                                    <span class="badge" style="background:#e3f2fd;color:#1565c0;margin-left:2px;">×${realEff.toFixed(2)}</span>
                                    ${welfare ? `<span class="badge" style="background:${welfare.bgColor};color:${welfare.color};margin-left:3px;border:1px solid ${welfare.color}44;" title="${welfare.name} · ${welfare.description}">${welfare.icon}${welfare.short}</span>` : ''}
                                    <span class="badge" style="background:#fff8e1;color:#ff6f00;margin-left:3px;">📦${packCap}单/批</span>
                                </div>
                                <span style="font-size:11px;color:${statusColor};font-weight:500;">${statusIcon} ${task ? '' : statusText}</span>
                            </div>
                            <div class="item-desc" style="margin-top:2px;">
                                ${typeInfo?.name || emp.type} · 
                                <span style="color:${emp.employmentType === 'parttime' ? '#ff9800' : '#4caf50'};">
                                    ${emp.employmentType === 'parttime' ? '兼职' : '全职'}
                                </span>
                                · ¥${emp.salary}/月
                                · 在职${emp.workDays||0}天
                            </div>
                            ${progressHtml}
                            <div style="min-height:26px;margin-top:6px;">
                                <div style="display:flex;justify-content:space-between;font-size:10px;color:#999;margin-bottom:2px;">
                                    <span>经验 ${maxed ? '(满级)' : curExp + '/' + needExp}</span>
                                    <span>${maxed ? '已满级' : '一键升级费 ' + formatMoney(totalUpCost || upCost)}</span>
                                </div>
                                <div style="height:4px;background:#eee;border-radius:2px;overflow:hidden;">
                                    <div style="height:100%;width:${maxed?100:expPct}%;background:linear-gradient(90deg,#ff9800,#ff5722);border-radius:2px;"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-top:6px;min-height:40px;">
                    <div style="background:#f5f5f5;border-radius:6px;padding:4px 5px;text-align:center;">
                        <div style="font-size:9px;color:#999;">打包</div>
                        <div style="font-size:11px;font-weight:700;color:#ff9800;">${stats.ordersPacked||0}</div>
                    </div>
                    <div style="background:#f5f5f5;border-radius:6px;padding:4px 5px;text-align:center;">
                        <div style="font-size:9px;color:#999;">发货</div>
                        <div style="font-size:11px;font-weight:700;color:#2196f3;">${stats.ordersShipped||0}</div>
                    </div>
                    <div style="background:#f5f5f5;border-radius:6px;padding:4px 5px;text-align:center;">
                        <div style="font-size:9px;color:#999;">客服</div>
                        <div style="font-size:11px;font-weight:700;color:#4caf50;">${stats.consultationsHandled||0}</div>
                    </div>
                    <div style="background:#f5f5f5;border-radius:6px;padding:4px 5px;text-align:center;">
                        <div style="font-size:9px;color:#999;">推广</div>
                        <div style="font-size:11px;font-weight:700;color:#9c27b0;">${stats.marketingRuns||0}</div>
                    </div>
                </div>
                <div style="background:#e8f5e9;border-radius:6px;padding:4px 6px;margin-top:4px;font-size:10px;color:#2e7d32;min-height:20px;">
                    🕐 当前小时 · 打包${hc.packed||0} 单 · 发货${hc.shipped||0} 单 · 客服${hc.consultation||0} · 推广${hc.marketing||0} 次
                </div>
                <div style="display:flex;gap:6px;margin-top:6px;min-height:28px;align-items:center;">
                    ${!maxed ? `
                        <button class="btn btn-small" style="flex:1;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border:none;"
                                onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                                onclick="ui.upgradeEmployeeOneKey('${emp.id}')">
                            🚀 一键升级
                        </button>
                    ` : `
                        <div style="flex:1;text-align:center;font-size:11px;color:#999;padding:4px 0;">🌟 已达最高等级</div>
                    `}
                    <button class="btn btn-small btn-danger"
                            onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                            onclick="event.stopPropagation();ui.fireEmployee('${emp.id}')">
                        解雇
                    </button>
                </div>
            </div>
        `;
    }

    switchTab(page, tab) {
        this._markJustClicked();
        this.currentTab[page] = tab;
        // ===== 性能优化：切换 orders 子 tab 时重置分页回第 1 页，避免停在旧页码导致空页 =====
        if (page === 'orders') {
            this._ordersPage = this._ordersPage || {};
            this._ordersPage[tab] = 1;
        }
        if (page === 'products') {
            this._listingsPage = 1;
        }
        // 宏任务渲染：避免与点击同栈卡死主线程
        setTimeout(() => {
            try { this.render(); } catch (e) { console.warn('[switchTab-render]', e); }
        }, 0);
    }

    bindEvents() {
        gameState.subscribe((state) => this.smartUpdate(state));
        
        // ========== 实时滚动位置监听（16ms节流）==========
        // 修复：下滑时被回弹到上面的问题。原 saveScrollPosition 只在 render() 时调用
        // 导致 500ms 节流渲染保存了中间旧值，再强行恢复打断用户滚动
        let _scrollSaveTimer = null;
        const mainContainer = document.getElementById('mainContainer');
        if (mainContainer) {
            mainContainer.addEventListener('scroll', () => {
                this._lastScrollTime = Date.now();
                // 16ms (~1帧) 节流：每秒最多保存60次，兼顾精度与性能
                if (!_scrollSaveTimer) {
                    _scrollSaveTimer = setTimeout(() => {
                        _scrollSaveTimer = null;
                        this.saveScrollPosition();
                    }, 16);
                }
            }, { passive: true });
        }

        // ========== 全局 Toast 通知监听 ==========
        // 解决 expressUI._showToast 等模块通过 eventBus 发出的 toast 无人接收的问题
        if (typeof eventBus !== 'undefined') {
            eventBus.on('toast:show', (data) => {
                if (data && data.message) {
                    this.showToast(data.message, data.duration || 2000);
                }
            });
            
            // 游戏引擎错误通知（safeCall / window.onerror），按 method 去抖；附带简短真实原因便于排查
            eventBus.on('game:error', (data) => {
                try {
                    const rawMsg = (data && (data.message || (data.error && data.error.message) || data.error)) || '';
                    const rawStr = String(rawMsg || '');
                    // 忽略浏览器噪音，避免误报「系统异常」吓到玩家
                    if (/ResizeObserver|Script error\.?|Loading chunk|ChunkLoadError|AbortError|ResizeObserver loop/i.test(rawStr)) {
                        return;
                    }
                    if (!this._gameErrorToastAt) this._gameErrorToastAt = Object.create(null);
                    const method = (data && data.method) || '_unknown';
                    const now = Date.now();
                    if (this._gameErrorToastAt[method] && now - this._gameErrorToastAt[method] < 30000) return;
                    this._gameErrorToastAt[method] = now;
                    const brief = rawStr.replace(/\s+/g, ' ').trim().slice(0, 48);
                    const msg = brief
                        ? `⚠️ 系统异常 [${method}]：${brief}`
                        : (data && data.method
                            ? `⚠️ 系统异常 [${data.method}]，部分功能可能受影响`
                            : '⚠️ 系统发生未知错误');
                    this.showToast(msg, 4500);
                } catch (_) {
                    try { this.showToast('⚠️ 系统发生未知错误', 3000); } catch (__) {}
                }
            });

            // 统一付款确认队列（快递单结、批量发货等自动触发）
            eventBus.on('payment:request', (req) => {
                try { this.enqueuePaymentRequest(req); } catch (e) { console.warn('[payment:request]', e); }
            });
        }
        
        document.addEventListener('visibilitychange', () => {
            // 启动后几秒内忽略：部分 WebView 开屏时会误报 hidden，导致引擎被停掉像黑屏卡死
            try {
                if (gameEngine && gameEngine._skipping) return;
                if (gameEngine && gameEngine._bootGraceUntil && Date.now() < gameEngine._bootGraceUntil) {
                    return;
                }
            } catch (_) {}
            if (document.hidden) {
                if (gameEngine.running) {
                    this.wasRunning = true;
                    gameEngine.stop();
                }
            } else {
                if (this.wasRunning) {
                    gameEngine.start({ immediate: true });
                    try {
                        if (typeof gameEngine.onResumedFromPause === 'function') gameEngine.onResumedFromPause();
                    } catch (_) {}
                    this.wasRunning = false;
                }
            }
        });
    }

    startLongPress(action, isIncrease = true) {
        if (this.longPressTimer) clearTimeout(this.longPressTimer);
        if (this.longPressInterval) clearInterval(this.longPressInterval);

        action();

        this.longPressTimer = setTimeout(() => {
            this.longPressInterval = setInterval(() => {
                action();
            }, this.longPressSpeed);
        }, this.longPressDelay);
    }

    stopLongPress() {
        if (this.longPressTimer) {
            clearTimeout(this.longPressTimer);
            this.longPressTimer = null;
        }
        if (this.longPressInterval) {
            clearInterval(this.longPressInterval);
            this.longPressInterval = null;
        }
    }

    toggleSoundEnabled() {
        try {
            const next = !(typeof SoundManager !== 'undefined' ? SoundManager.isEnabled() : true);
            if (typeof SoundManager !== 'undefined') SoundManager.setEnabled(next);
            else if (gameState?.state) {
                if (!gameState.state.settings) gameState.state.settings = {};
                gameState.state.settings.soundEnabled = next;
            }
            this.showToast(next ? '🔊 音效已开启' : '🔇 音效已关闭', 1200);
            this.forceRender && this.forceRender();
        } catch (e) {
            this.showToast('音效设置失败', 1500);
        }
    }

    unlockBrandBadge(badgeId) {
        try {
            if (!gameState || typeof gameState.unlockBrandBadge !== 'function') {
                this.showToast('无法解锁品牌标识');
                return;
            }
            const r = gameState.unlockBrandBadge(badgeId);
            this.showToast((r && r.message) || (r && r.success ? '已解锁' : '解锁失败'));
            if (r && r.success) this.forceRender && this.forceRender();
        } catch (e) {
            this.showToast('解锁失败');
        }
    }

    _renderChinaMapSvg() {
        return `<svg viewBox="0 0 1000 800" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
            <defs>
                <linearGradient id="seaG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#8ecae6"/>
                    <stop offset="100%" stop-color="#219ebc"/>
                </linearGradient>
                <linearGradient id="landG" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stop-color="#c8e6a0"/>
                    <stop offset="45%" stop-color="#a8c97a"/>
                    <stop offset="100%" stop-color="#7d9b52"/>
                </linearGradient>
                <filter id="landSh"><feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#1b4f72" flood-opacity=".25"/></filter>
            </defs>
            <rect width="1000" height="800" fill="url(#seaG)"/>
            <path fill="#5dade2" opacity=".35" d="M0,620 Q180,580 320,640 T700,700 T1000,660 L1000,800 L0,800 Z"/>
            <path filter="url(#landSh)" fill="url(#landG)" stroke="#5d7a3a" stroke-width="2"
                d="M210,210 C250,120 360,70 470,88 C560,60 650,78 730,130
                   C800,165 860,200 900,255 C930,310 915,355 870,370
                   C848,400 820,455 790,500 C770,545 740,600 690,640
                   C640,690 575,710 520,680 C470,705 410,700 355,655
                   C300,620 250,560 215,500 C170,450 155,380 168,320
                   C175,270 188,235 210,210 Z"/>
            <ellipse cx="575" cy="742" rx="28" ry="16" fill="url(#landG)" stroke="#5d7a3a" stroke-width="1.4"/>
            <ellipse cx="812" cy="575" rx="16" ry="28" fill="url(#landG)" stroke="#5d7a3a" stroke-width="1.4"/>
            <path fill="none" stroke="#6d8a48" stroke-width="1" opacity=".45"
                d="M470,88 L500,220 L560,390 M730,130 L640,280 L560,390 L500,500
                   M355,655 L430,520 L500,390 M215,500 L360,400 L500,390"/>
            <text x="430" y="300" fill="#3e5a24" font-size="22" font-weight="700" opacity=".35">中国</text>
            <text x="30" y="40" fill="#0d47a1" font-size="13" opacity=".7">仓储城市 · 示意地图</text>
        </svg>`;
    }

    showCityMapModal() {
        const cities = (typeof WAREHOUSE_CITIES !== 'undefined') ? WAREHOUSE_CITIES.slice() : [];
        const origins = (typeof ORIGIN_CITIES !== 'undefined') ? ORIGIN_CITIES : [];
        const allPins = cities.concat(origins);
        const layout = (typeof CITY_MAP_LAYOUT !== 'undefined') ? CITY_MAP_LAYOUT : {};
        const curId = gameState.state.warehouse?.city || gameState.state.shop?.city || 'yiwu';
        if (!this._cityMapSelectedId) this._cityMapSelectedId = curId;
        if (!allPins.find(c => c.id === this._cityMapSelectedId)) this._cityMapSelectedId = curId;
        const selected = allPins.find(c => c.id === this._cityMapSelectedId) || cities[0];
        const pins = allPins.map(c => {
            const pos = layout[c.id] || { x: 50, y: 50 };
            const active = c.id === this._cityMapSelectedId;
            const here = c.id === curId;
            const origin = !!c.originOnly;
            return `<button type="button" class="city-map-pin ${active ? 'active' : ''} ${here ? 'here' : ''} ${origin ? 'origin' : ''}"
                style="left:${pos.x}%;top:${pos.y}%;"
                onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                onclick="ui.selectCityMapPin('${c.id}')"
                title="${c.name}${origin ? '（原产地）' : ''}">
                <span class="city-map-pin-icon"><span></span></span>
                <span class="city-map-pin-name">${c.name}${here ? '·仓' : (origin ? '·产' : '')}</span>
            </button>`;
        }).join('');
        const adv = (selected.advantages || []).map(a => `<li>${escapeHtml(a)}</li>`).join('') || '<li>暂无</li>';
        const dis = (selected.disadvantages || []).map(a => `<li>${escapeHtml(a)}</li>`).join('') || '<li>暂无</li>';
        const isHere = selected.id === curId;
        const content = `
            <div class="city-map-wrap">
                <div class="city-map-canvas">
                    <div class="city-map-bg">${this._renderChinaMapSvg()}</div>
                    ${pins}
                </div>
                <div class="city-map-detail">
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                        <span style="font-size:28px;">${selected.icon || '🏭'}</span>
                        <div style="flex:1;">
                            <div style="font-weight:800;font-size:16px;">${escapeHtml(selected.name)} · ${escapeHtml(selected.province || '')}</div>
                            <div style="font-size:12px;color:#666;">${escapeHtml(selected.tagline || '')}</div>
                        </div>
                        <span style="font-size:11px;padding:3px 8px;border-radius:999px;background:${selected.difficultyColor || '#999'};color:#fff;">${escapeHtml(selected.difficulty || '')}</span>
                    </div>
                    <div style="font-size:12px;color:#555;margin-bottom:8px;line-height:1.5;">${escapeHtml(selected.description || '')}</div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;">
                        <div style="background:#e8f5e9;border-radius:8px;padding:8px;">
                            <div style="font-weight:700;color:#2e7d32;margin-bottom:4px;">✨ 优势</div>
                            <ul style="margin:0;padding-left:16px;line-height:1.6;">${adv}</ul>
                        </div>
                        <div style="background:#fff3e0;border-radius:8px;padding:8px;">
                            <div style="font-weight:700;color:#e65100;margin-bottom:4px;">⚠️ 劣势</div>
                            <ul style="margin:0;padding-left:16px;line-height:1.6;">${dis}</ul>
                        </div>
                    </div>
                    <div style="margin-top:10px;font-size:11px;color:#888;">当前仓库：${escapeHtml((getCityById(curId) || {}).name || curId)} · 点击地图节点可查看${selected.originOnly ? '原产地（对应商品从国外直发国内）' : '并搬仓'}</div>
                    <div style="margin-top:10px;display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:linear-gradient(135deg,#e3f2fd,#bbdefb);border-radius:10px;">
                        <div style="min-width:0;">
                            <div style="font-size:12px;font-weight:700;color:#1565c0;">🏛️ 城市政策补贴</div>
                            <div style="font-size:11px;color:#555;margin-top:2px;">${gameState.getCityPolicyInfo().claimedToday ? '今日已领取' : '当前城市每日补贴 ¥' + gameState.getCityPolicyInfo().subsidy}</div>
                        </div>
                        <button class="btn btn-primary btn-small" ${gameState.getCityPolicyInfo().claimedToday ? 'disabled' : ''}
                                onclick="ui.claimCitySubsidy()">领取</button>
                    </div>
                </div>
            </div>
            <style>
                .city-map-wrap{display:flex;flex-direction:column;gap:12px;}
                .city-map-canvas{position:relative;height:300px;border-radius:14px;overflow:hidden;border:1px solid #b0bec5;background:#7eb6d9;}
                .city-map-bg{position:absolute;inset:0;}
                .city-map-bg svg{width:100%;height:100%;display:block;}
                .city-map-pin{position:absolute;transform:translate(-50%,-100%);border:none;background:transparent;cursor:pointer;padding:0;text-align:center;z-index:2;}
                .city-map-pin-icon{display:inline-flex;width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);align-items:center;justify-content:center;background:#e53935;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.28);font-size:13px;}
                .city-map-pin-icon span{transform:rotate(45deg);display:block;line-height:1;}
                .city-map-pin-name{display:block;margin-top:3px;font-size:11px;font-weight:800;color:#1a237e;text-shadow:0 1px 0 #fff,0 0 4px #fff;}
                .city-map-pin.active .city-map-pin-icon{background:#2e7d32;transform:rotate(-45deg) scale(1.08);}
                .city-map-pin.origin .city-map-pin-icon{background:#5c6bc0;}
                .city-map-pin.origin.active .city-map-pin-icon{background:#303f9f;transform:rotate(-45deg) scale(1.08);}
                .city-map-pin.here .city-map-pin-icon{background:#ff6b35;box-shadow:0 0 0 3px rgba(255,107,53,.35);}
            </style>
        `;
        const isOrigin = !!selected.originOnly;
        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>
            ${isOrigin
                ? `<button class="btn btn-primary" disabled style="opacity:.7;">原产地直发·不可搬仓</button>`
                : (isHere
                ? `<button class="btn btn-primary" disabled style="opacity:.6;">已在${escapeHtml(selected.name)}</button>`
                : `<button class="btn btn-primary" onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()" onclick="ui.confirmCityMapMove('${selected.id}')">搬仓至${escapeHtml(selected.name)}</button>`)}
        `;
        this.showModal('🗺️ 仓储与原产地地图', content, footer, { width: '560px', modalId: 'cityMapModal' });
    }

    selectCityMapPin(cityId) {
        this._cityMapSelectedId = cityId;
        this.showCityMapModal();
    }

    confirmCityMapMove(cityId) {
        if (!gameState || typeof gameState.moveWarehouseCity !== 'function') {
            this.showToast('无法搬仓');
            return;
        }
        const city = (typeof getCityById === 'function') ? getCityById(cityId) : null;
        const name = (city && city.name) || cityId;
        if (!confirm(`确认将仓库搬迁至「${name}」？将按库存件数与货值收取搬仓费。`)) return;
        const r = gameState.moveWarehouseCity(cityId);
        if (r && r.success) {
            this.showToast(`已搬仓至 ${r.to}，费用 ¥${Math.round(r.cost || 0).toLocaleString()}`);
            this._cityMapSelectedId = cityId;
            this.closeModal();
            this.forceRender && this.forceRender();
        } else {
            this.showToast((r && r.message) || '搬仓失败');
        }
    }

    showOpsRiskModal() {
        const m = (gameState && typeof gameState.getOpsRiskMetrics === 'function')
            ? gameState.getOpsRiskMetrics()
            : { total: 0, cancelRate: 0, returnRate: 0, cancelRateCap: 0.1, returnRateCap: 0.1 };
        const banRemain = (gameState && typeof gameState.getShopPlatformBanRemainDays === 'function')
            ? gameState.getShopPlatformBanRemainDays() : 0;
        const last = gameState.state.shop?.lastOpsRiskPenalty;
        const pct = (v) => ((Number(v) || 0) * 100).toFixed(1) + '%';
        const bar = (rate, cap, danger) => {
            const w = Math.min(100, Math.round((rate || 0) * 100));
            const color = danger ? '#c62828' : (rate > cap * 0.85 ? '#ef6c00' : '#2e7d32');
            return `<div style="height:8px;background:#eee;border-radius:999px;overflow:hidden;margin-top:6px;">
                <div style="width:${w}%;height:100%;background:${color};"></div>
            </div>
            <div style="font-size:11px;color:#888;margin-top:4px;">阈值上限 ${pct(cap)}</div>`;
        };
        const content = `
                <div style="font-size:12px;color:#666;line-height:1.6;margin-bottom:12px;">
                近 ${m.windowDays || 30} 天统计：订单取消不限次数；商品退货率超过 <b>15%</b>（卖 100 最多退 15）可能被平台临时限流，或降低信誉与评分。
            </div>
            ${banRemain > 0 ? `<div style="padding:10px;background:#ffebee;border-radius:10px;margin-bottom:12px;color:#c62828;font-weight:700;">🚫 平台限流中，剩余约 ${banRemain} 天（暂停新单）</div>` : ''}
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                <div style="padding:12px;border:1px solid #eee;border-radius:12px;">
                    <div style="font-size:12px;color:#888;">订单取消率</div>
                    <div style="font-size:22px;font-weight:800;color:#333;">${pct(m.cancelRate)}</div>
                    <div style="font-size:11px;color:#999;">取消 ${m.cancelled||0} / 样本 ${m.total||0}</div>
                    <div style="height:8px;background:#eee;border-radius:999px;overflow:hidden;margin-top:6px;">
                        <div style="width:${Math.min(100, Math.round((m.cancelRate||0)*100))}%;height:100%;background:#2e7d32;"></div>
                    </div>
                    <div style="font-size:11px;color:#888;margin-top:4px;">订单取消无限制</div>
                </div>
                <div style="padding:12px;border:1px solid #eee;border-radius:12px;">
                    <div style="font-size:12px;color:#888;">商品退货率</div>
                    <div style="font-size:22px;font-weight:800;color:${m.returnBreached?'#c62828':'#333'};">${pct(m.returnRate)}</div>
                    <div style="font-size:11px;color:#999;">退货 ${m.returns||0} / 完成 ${m.completed||0}</div>
                    ${bar(m.returnRate, m.returnRateCap, m.returnBreached)}
                </div>
            </div>
            ${last ? `<div style="margin-top:12px;padding:10px;background:#fff8e1;border-radius:10px;font-size:12px;color:#5d4037;">
                最近处罚（第 ${last.day} 天）：${escapeHtml(last.message || last.type || '')}
            </div>` : '<div style="margin-top:12px;font-size:12px;color:#999;">暂无风控处罚记录</div>'}
        `;
        this.showModal('⚠️ 运营风险预警', content, `<button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>`, { width: '520px' });
    }

    toggleBgmEnabled() {
        try {
            const next = !(typeof SoundManager !== 'undefined' ? SoundManager.isBgmEnabled() : false);
            if (typeof SoundManager !== 'undefined') SoundManager.setBgmEnabled(next);
            else if (gameState?.state) {
                if (!gameState.state.settings) gameState.state.settings = {};
                gameState.state.settings.bgmEnabled = next;
            }
            this.showToast(next ? '🎵 背景音乐已开启' : '🎵 背景音乐已关闭', 1200);
            this.forceRender && this.forceRender();
        } catch (e) {
            this.showToast('背景音乐设置失败', 1500);
        }
    }

    setBgmVolume(val) {
        try {
            const v = Math.max(0, Math.min(100, parseInt(val, 10) || 0)) / 100;
            if (typeof SoundManager !== 'undefined') SoundManager.setBgmVolume(v);
            else if (gameState?.state) {
                if (!gameState.state.settings) gameState.state.settings = {};
                gameState.state.settings.bgmVolume = v;
            }
        } catch (_) {}
    }

    showToast(message, duration = 2000) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        document.body.appendChild(toast);
        try {
            if (typeof SoundManager !== 'undefined') {
                const text = String(message || '');
                if (/音效已开启/.test(text)) SoundManager.play('click', { volume: 0.3 });
                else if (/音效已关闭/.test(text)) SoundManager.play('close', { volume: 0.3 });
                else if (/失败|错误|不足|无法|❌/.test(text)) SoundManager.play('error', { volume: 0.28 });
                else if (/成功|到账|完成|✅|💰/.test(text)) SoundManager.play('success', { volume: 0.28 });
                else SoundManager.play('toast', { volume: 0.22 });
            }
        } catch (_) {}
        setTimeout(() => { toast.remove(); }, duration);
    }

    /**
     * 按 modalId / 标题查找已打开的同名弹窗（用于刷新而非叠层）
     */
    _findModalOverlay(title, modalId) {
        const overlays = Array.from(document.querySelectorAll('.modal-overlay'));
        if (modalId) {
            const byId = overlays.find(o =>
                (o.dataset && o.dataset.modalId === modalId) || o.id === modalId
            ) || document.getElementById(modalId);
            if (byId && byId.classList && byId.classList.contains('modal-overlay')) return byId;
        }
        if (title == null || title === '') return null;
        // 从上层往下找，优先命中当前可见的同名层
        for (let i = overlays.length - 1; i >= 0; i--) {
            const o = overlays[i];
            if (o.dataset && o.dataset.modalTitle === title) return o;
        }
        return null;
    }

    /**
     * 就地刷新已有弹窗的标题/内容/页脚（不新建、不改变层叠顺序）
     */
    _updateModalOverlay(overlay, title, content, footer = '', options = {}) {
        if (!overlay) return null;
        // 刷新已有弹窗时提到最上层：避免"刷新了下面那层，看起来还是叠着"
        try {
            if (overlay.parentNode === document.body && document.body.lastElementChild !== overlay) {
                document.body.appendChild(overlay);
            }
        } catch (_) {}
        overlay.dataset.modalTitle = title;
        if (options.modalId) {
            overlay.dataset.modalId = options.modalId;
            try { overlay.id = options.modalId; } catch (_) {}
        }
        if (options.modalClass) {
            String(options.modalClass).split(/\s+/).filter(Boolean).forEach(cls => {
                try { overlay.classList.add(cls); } catch (_) {}
            });
        }
        const titleEl = overlay.querySelector('.modal-title');
        if (titleEl) titleEl.innerHTML = title;
        const body = overlay.querySelector('.modal-body');
        if (body) {
            body.innerHTML = content;
            if (options.noBodyPadding) body.style.padding = '0';
            else if (body.getAttribute('style') === 'padding:0;' || body.style.padding === '0px') {
                body.removeAttribute('style');
            }
        }
        let foot = overlay.querySelector('.modal-footer');
        if (footer) {
            if (foot) {
                foot.innerHTML = footer;
            } else {
                const modal = overlay.querySelector('.modal') || overlay.querySelector('.modal-content');
                if (modal) {
                    foot = document.createElement('div');
                    foot.className = 'modal-footer';
                    foot.innerHTML = footer;
                    modal.appendChild(foot);
                }
            }
        } else if (foot) {
            foot.remove();
        }
        if (options.lockClose) {
            overlay.dataset.lockClose = '1';
            const closeEl = overlay.querySelector('[data-modal-close="1"]');
            if (closeEl) closeEl.style.display = 'none';
        }
        if (options.width) {
            const modal = overlay.querySelector('.modal');
            if (modal) modal.style.maxWidth = options.width;
        }
        return overlay;
    }

    _syncModalStackZIndex() {
        const overlays = document.querySelectorAll('.modal-overlay');
        overlays.forEach((o, i) => {
            o.style.zIndex = String(200 + i * 10);
        });
    }

    showModal(title, content, footer = '', options = {}) {
        // 兼容旧调用：第4参传字符串当 class/id
        if (typeof options === 'string') {
            options = { modalId: options, modalClass: options };
        }
        options = options || {};

        // 同标题 / 同 modalId 已打开时只刷新内容，避免经营入口切 Tab、重复点击叠多层
        // 不同标题仍可嵌套（如员工管理上再开招聘）
        const allowReplace = options.replace !== false;
        if (allowReplace) {
            const existing = this._findModalOverlay(title, options.modalId);
            if (existing) {
                return this._updateModalOverlay(existing, title, content, footer, options);
            }
        }

        // 支持多层嵌套弹窗，不再使用固定id，通过class管理，按DOM顺序最上层=最后一个
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay' + (options.modalClass ? (' ' + options.modalClass) : '');
        overlay.dataset.modalTitle = title;
        if (options.modalId) {
            overlay.dataset.modalId = options.modalId;
            try { overlay.id = options.modalId; } catch (_) {}
        }
        if (options.lockClose) overlay.dataset.lockClose = '1';
        const bodyStyle = options.noBodyPadding ? 'style="padding:0;"' : '';
        const widthStyle = options.width ? `style="max-width:${options.width};"` : '';
        overlay.innerHTML = `
            <div class="modal" ${widthStyle}>
                <div class="modal-header">
                    <div class="modal-title">${title}</div>
                    ${options.lockClose ? '' : '<div class="modal-close" data-modal-close="1">×</div>'}
                </div>
                <div class="modal-body" ${bodyStyle}>${content}</div>
                ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
            </div>
        `;
        document.body.appendChild(overlay);
        this._normalizeModalStack();   // 去重 + 限制可见层数（防 4 层叠在一起）

        // 统一用 addEventListener 绑定关闭按钮，不依赖行内 onclick
        const closeBtn = overlay.querySelector('[data-modal-close="1"]');
        if (closeBtn) closeBtn.addEventListener('click', () => this.closeModal());
        
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay && overlay.dataset.lockClose !== '1') {
                this.closeModal();
            }
        });
        // 返回 overlay，调用方可以继续对 modal 里的元素绑定事件
        return overlay;
    }

    closeModal(options) {
        const force = !!(options && options.force);
        // 连点锁：双击「×」/遮罩不会一次关掉两层（force 用于程序化关闭，不受此限）
        if (!force) {
            const now = Date.now();
            if (now - this._lastModalCloseAt < this._modalCloseLockMs) return;
            this._lastModalCloseAt = now;
        }
        // 关闭最上层（最后一个）弹窗，避免嵌套弹窗时按id查找导致关错层
        const overlays = document.querySelectorAll('.modal-overlay');
        if (overlays && overlays.length > 0) {
            const topOverlay = overlays[overlays.length - 1];
            // 现场支付 / 发薪确认：禁止 × / 遮罩关闭；确认支付成功后须 force 才能关
            if (!force && topOverlay.dataset && topOverlay.dataset.lockClose === '1') return;
            // 付款确认窗点 × / 遮罩关闭时走取消逻辑，避免卡住暂停与队列
            if (topOverlay.dataset && topOverlay.dataset.paymentConfirm === '1' && this._paymentModalOpen) {
                this._cancelPaymentConfirm();
                return;
            }
            // 关闭一个弹窗时，把它残留的同类重复层一起收掉（只保留"关闭"这个语义）
            const closedId = (topOverlay.dataset && topOverlay.dataset.modalId) || topOverlay.id || '';
            const closedTitle = (topOverlay.dataset && topOverlay.dataset.modalTitle) || '';
            topOverlay.remove();
            if (closedId || closedTitle) {
                this._modalLayers().forEach(el => {
                    const id = (el.dataset && el.dataset.modalId) || el.id || '';
                    const title = (el.dataset && el.dataset.modalTitle) || '';
                    if ((closedId && id === closedId) || (closedTitle && title === closedTitle)) {
                        if (el.dataset && el.dataset.lockClose === '1') return;
                        try { el.remove(); } catch (_) {}
                    }
                });
            }
        }
        this._normalizeModalStack();
        // 仅当所有弹窗都关闭时才整页重渲染，避免编辑中间态丢失
        const remaining = document.querySelectorAll('.modal-overlay');
        if (!remaining || remaining.length === 0) {
            try { this._stopLiveDanmakuUpdate(); } catch (_) {}
            this.render();
        }
        try { this._syncLiveHangBar(); } catch (_) {}
    }

    _syncLiveHangBar() {
        const liveOpen = !!(document.getElementById('liveCenterModal')
            || Array.from(document.querySelectorAll('.modal-overlay')).some(el => {
                const t = el.querySelector('.modal-title');
                return t && String(t.textContent || '').indexOf('直播中心') >= 0;
            }));
        const isLive = !!(typeof gameState !== 'undefined' && gameState.state
            && gameState.state.livestream && gameState.state.livestream.isLive);
        if (typeof liveUI === 'undefined' || !liveUI) return;
        if (isLive && !liveOpen && typeof liveUI.showHangBar === 'function') liveUI.showHangBar();
        else if (typeof liveUI.hideHangBar === 'function') liveUI.hideHangBar();
    }

    async showArchiveManagerModal() {
        if (typeof saveManager === 'undefined') {
            this.showToast('存档系统未加载', 2000);
            return;
        }
        this.showModal('💾 存档管理', '<div id="archiveManagerBody" style="padding:8px 4px;">加载中…</div>', '', { modalId: 'archiveManagerModal' });
        try {
            const info = await saveManager.getArchiveInfo();
            this._renderArchiveManagerContent(info);
        } catch (e) {
            const body = document.getElementById('archiveManagerBody');
            if (body) body.innerHTML = '<div style="color:#f44336;padding:12px;">加载存档信息失败: ' + (e.message || e) + '</div>';
        }
    }

    _renderArchiveManagerContent(info) {
        const body = document.getElementById('archiveManagerBody');
        if (!body) return;
        if (!info) { body.innerHTML = '<div style="color:#999;padding:12px;">无存档信息</div>'; return; }

        const capTier = info.capability ? info.capability.tier : 'C';
        const capText = { A: '完整支持 (IndexedDB + GZIP)', B: '部分支持 (IndexedDB)', C: '降级模式 (localStorage)' }[capTier] || '未知';
        const capColor = { A: '#1565c0', B: '#1565c0', C: '#e65100' }[capTier] || '#666';

        const main = info.slots && info.slots.main;
        // 存档摘要里的资金已混淆，展示前解码（旧档纯数字原样）
        const mainFunds = (typeof saveManager !== 'undefined' && typeof saveManager.decodeFunds === 'function')
            ? saveManager.decodeFunds(main && main.funds)
            : (main && main.funds);
        // 进度条按「原始体积」对照展示上限；IDB 实际硬上限更宽
        const rawSize = (main && main.rawSize) || 0;
        const displayCap = saveManager.MAX_ARCHIVE_SIZE || (888 * 1024 * 1024);
        const hardCap = (typeof saveManager._getMaxRawSize === 'function')
            ? saveManager._getMaxRawSize() : displayCap;
        const totalMB = (rawSize / 1024 / 1024).toFixed(2);
        const capMB = (displayCap / 1024 / 1024).toFixed(0);
        const pct = Math.min(100, (rawSize / displayCap * 100)).toFixed(1);
        const barColor = pct > 95 ? '#f44336' : pct > 80 ? '#ff9800' : '#4caf50';
        const liveOrders = (typeof gameState !== 'undefined' && gameState.state && Array.isArray(gameState.state.orders))
            ? gameState.state.orders.length : (main && main.orderCount) || 0;

        const mainText = main ? [
            '资金：¥' + ((mainFunds || 0)).toLocaleString(),
            '游戏进度：第' + (main.day || 0) + '天 ' + (main.hour || 0) + ':00',
            '店铺：' + (main.shopName || '-'),
            '订单数：' + liveOrders + '（档内 ' + (main.orderCount || 0) + '）/ 员工：' + (main.employeeCount || 0),
            '保存时间：' + new Date(main.timestamp).toLocaleString(),
            '哈希：' + (main.hash || '-').slice(0, 12),
            '硬上限：' + (hardCap / 1024 / 1024).toFixed(0) + 'MB（IndexedDB）'
        ].map(t => '<div style="font-size:12px;color:#555;line-height:1.8;">' + t + '</div>').join('') : '<div style="color:#999;font-size:12px;">无主档</div>';

        const historyList = (info.history && info.history.length > 0)
            ? info.history.map(h => '<div style="font-size:12px;color:#666;line-height:1.7;">📸 ' + new Date(h.timestamp).toLocaleString() + ' — ' + ((h.size || 0) / 1024).toFixed(1) + 'KB</div>').join('')
            : '<div style="color:#999;font-size:12px;">暂无历史快照</div>';

        // 手动槽位（slot1~slot3）：多档位功能
        const manualSlots = (typeof saveManager.listManualSlots === 'function') ? saveManager.listManualSlots() : [];
        const slotsHtml = manualSlots.map((s, i) => {
            const n = i + 1;
            let infoHtml;
            if (s.exists && s.meta) {
                let funds = s.meta.funds;
                try {
                    if (typeof saveManager.decodeFunds === 'function') funds = saveManager.decodeFunds(funds);
                } catch (_) {}
                infoHtml = '<span style="font-size:11px;color:#555;">第' + (s.meta.day || 0) + '天 · ¥' +
                    Number(funds || 0).toLocaleString() + '<br><span style="color:#999;">' +
                    new Date(s.meta.timestamp).toLocaleString() + '</span></span>';
            } else {
                infoHtml = '<span style="font-size:11px;color:#bbb;">空槽位</span>';
            }
            return `
                <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px dashed #eee;">
                    <span style="font-weight:700;font-size:13px;color:#333;width:52px;flex-shrink:0;">槽位 ${n}</span>
                    <span style="flex:1;line-height:1.5;min-width:0;">${infoHtml}</span>
                    <button type="button" class="btn btn-sm btn-primary" style="font-size:11px;padding:4px 8px;flex-shrink:0;"
                        onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                        onclick="ui._archiveSlotSave(${n})">保存</button>
                    ${s.exists ? `
                    <button type="button" class="btn btn-sm btn-secondary" style="font-size:11px;padding:4px 8px;flex-shrink:0;"
                        onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                        onclick="ui._archiveSlotLoad(${n})">载入</button>
                    <button type="button" class="btn btn-sm btn-danger" style="font-size:11px;padding:4px 8px;flex-shrink:0;"
                        onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                        onclick="ui._archiveSlotDelete(${n})">删除</button>` : ''}
                </div>`;
        }).join('');

        const warnTip = (info.warnLevel >= 2)
            ? '<div style="color:#f44336;margin-top:4px;font-size:12px;">⚠️ 存档已达上限，请立即清理！</div>'
            : (info.warnLevel >= 1)
                ? '<div style="color:#ff9800;margin-top:4px;font-size:12px;">⚠️ 存档接近上限，建议清理</div>'
                : '';

        body.innerHTML = `
            <div style="padding:4px;font-size:13px;line-height:1.6;">
                <div style="background:#e3f2fd;padding:8px 12px;border-radius:8px;margin-bottom:12px;color:${capColor};font-size:12px;">
                    🔧 存储模式：${capText}
                </div>
                <div style="margin-bottom:16px;">
                    <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:12px;">
                        <span>📦 原始体积（建议线）</span>
                        <span>${totalMB}MB / ${capMB}MB (${pct}%)</span>
                    </div>
                    <div style="height:8px;background:#e0e0e0;border-radius:4px;overflow:hidden;">
                        <div style="height:100%;width:${pct}%;background:${barColor};transition:width 0.3s;"></div>
                    </div>
                    ${warnTip}
                    <div style="font-size:11px;color:#999;margin-top:4px;">订单过多会撑大原始体积；压缩后通常只有几 MB，可点「清理订单」瘦身</div>
                </div>
                <div style="display:flex;gap:8px;margin-bottom:16px;">
                    <div style="flex:1;background:#f5f5f5;padding:10px;border-radius:8px;text-align:center;">
                        <div style="font-size:18px;font-weight:700;color:#2196f3;">${((main && main.compressedSize) || 0) / 1024 < 1024 ? ((main && main.compressedSize) || 0) / 1024 : (((main && main.compressedSize) || 0) / 1024 / 1024).toFixed(2) + 'M'}${((main && main.compressedSize) || 0) / 1024 < 1024 ? 'KB' : ''}</div>
                        <div style="font-size:11px;color:#666;">压缩后大小</div>
                    </div>
                    <div style="flex:1;background:#f5f5f5;padding:10px;border-radius:8px;text-align:center;">
                        <div style="font-size:18px;font-weight:700;color:#ff9800;">${((main && main.rawSize) || 0) / 1024 < 1024 ? ((main && main.rawSize) || 0) / 1024 : (((main && main.rawSize) || 0) / 1024 / 1024).toFixed(2) + 'M'}${((main && main.rawSize) || 0) / 1024 < 1024 ? 'KB' : ''}</div>
                        <div style="font-size:11px;color:#666;">原始大小</div>
                    </div>
                </div>
                <div style="background:#fafafa;padding:10px;border-radius:8px;margin-bottom:12px;">
                    <div style="font-weight:600;margin-bottom:6px;font-size:13px;">📄 主档信息</div>
                    ${mainText}
                </div>
                <div style="background:#fafafa;padding:10px;border-radius:8px;margin-bottom:12px;">
                    <div style="font-weight:600;margin-bottom:6px;font-size:13px;">📸 历史快照 (${(info.history || []).length}/${saveManager.HISTORY_MAX})</div>
                    ${historyList}
                </div>
                <div style="background:#fafafa;padding:10px;border-radius:8px;margin-bottom:12px;">
                    <div style="font-weight:600;margin-bottom:2px;font-size:13px;">🗂️ 手动槽位（多档位）</div>
                    <div style="font-size:11px;color:#999;margin-bottom:4px;">可存 3 份独立进度，随时来回切换（载入会覆盖当前进度）</div>
                    ${slotsHtml}
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
                    <button class="btn btn-primary" onclick="ui._archiveExport()" style="padding:10px;border:none;border-radius:8px;background:#00897b;color:#fff;cursor:pointer;font-size:13px;">📤 导出存档</button>
                    <button class="btn btn-secondary" onclick="ui._archiveImport()" style="padding:10px;border:none;border-radius:8px;background:#607d8b;color:#fff;cursor:pointer;font-size:13px;">📥 导入存档</button>
                </div>
                <div style="font-size:11px;color:#999;margin-bottom:14px;line-height:1.6;">导出 = 把存档打包成一段文本（含压缩与校验），可存网盘/电脑；重装或换设备后粘贴导入即可恢复进度</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:16px;">
                    <button class="btn btn-primary" onclick="ui._archiveForceSave()" style="padding:10px;border:none;border-radius:8px;background:#2196f3;color:#fff;cursor:pointer;font-size:13px;">💾 立即保存</button>
                    <button class="btn btn-secondary" onclick="ui._archiveCleanup({clearRedundant:true})" style="padding:10px;border:none;border-radius:8px;background:#607d8b;color:#fff;cursor:pointer;font-size:13px;">🧹 清理冗余</button>
                    <button class="btn btn-secondary" onclick="ui._archiveCleanup({clearOrders:true})" style="padding:10px;border:none;border-radius:8px;background:#607d8b;color:#fff;cursor:pointer;font-size:13px;">📋 清理订单</button>
                    <button class="btn btn-danger" onclick="ui._archiveCleanup({deleteBackups:true})" style="padding:10px;border:none;border-radius:8px;background:#f44336;color:#fff;cursor:pointer;font-size:13px;">🗑️ 删备份档</button>
                </div>
                ${info.lastError ? '<div style="color:#f44336;margin-top:12px;font-size:12px;">⚠️ 上次错误：' + info.lastError + '</div>' : ''}
                <div style="color:#999;margin-top:12px;font-size:11px;text-align:center;">存档采用三副本+9层恢复机制，保障数据安全</div>
            </div>
        `;

    }


    async _archiveCleanup(options) {
        if (typeof saveManager === 'undefined') return;
        const optDesc = { clearRedundant: '清理冗余', clearOrders: '清理订单', deleteBackups: '删除备份档' };
        const desc = optDesc[Object.keys(options || {})[0]] || '清理';
        // 危险操作二次确认
        if (options && (options.deleteBackups || options.clearRedundant)) {
            if (!confirm('确定要' + desc + '吗？此操作不可撤销。')) return;
        }
        if (options && options.clearOrders) {
            const n = (typeof gameState !== 'undefined' && gameState.state && gameState.state.orders)
                ? gameState.state.orders.length : 0;
            if (!confirm('将清理 2 天前已完成/取消的订单与过期运单（进行中订单保留）。\n当前订单约 ' + n + ' 条，是否继续？')) return;
        }
        this.showToast('正在' + desc + '…', 1000);
        try {
            const result = await saveManager.cleanupArchive(options);
            let tip = desc + '完成';
            if (result && result.details && result.details.orders) {
                const o = result.details.orders;
                tip = '已清理订单 ' + (o.removed || 0) + ' 条（' + o.before + '→' + o.after + '）';
            }
            this.showToast(tip, 2000);
            const info = await saveManager.getArchiveInfo();
            this._renderArchiveManagerContent(info);
        } catch (e) {
            this.showToast(desc + '失败: ' + (e.message || e), 2500);
        }
    }

    async _archiveForceSave() {
        if (typeof saveManager === 'undefined') return;
        this.showToast('正在保存…', 1000);
        try {
            const result = await saveManager.flushSave();
            this.showToast(result.success ? '保存成功 ✓' : '保存失败', 2000);
            const info = await saveManager.getArchiveInfo();
            this._renderArchiveManagerContent(info);
        } catch (e) {
            this.showToast('保存失败: ' + (e.message || e), 2500);
        }
    }

    showPrivacyPolicy() {
        const overlay = document.getElementById('privacyOverlay');
        const checkbox = document.getElementById('privacyAgree');
        const agreeBtn = document.getElementById('privacyAgreeBtn');
        const disagreeBtn = document.getElementById('privacyDisagree');
        const checkboxContainer = document.getElementById('privacyCheckboxWrap') || document.querySelector('.privacy-checkbox');
        const footer = document.querySelector('.privacy-footer');

        if (!overlay) return;
        try {
            if (typeof PrivacyFlow !== 'undefined' && PrivacyFlow.fillBody) PrivacyFlow.fillBody();
        } catch (_) {}
        overlay.classList.remove('hidden');

        // 查看模式：只读完整协议，不出现第二套「同意」流程
        if (checkboxContainer) checkboxContainer.style.display = 'none';
        if (disagreeBtn) disagreeBtn.style.display = 'none';
        if (agreeBtn) {
            agreeBtn.disabled = false;
            agreeBtn.textContent = '关闭';
            agreeBtn.setAttribute('data-view-only', '1');
            agreeBtn.onclick = () => this.hidePrivacyPolicy();
        }
        if (disagreeBtn) disagreeBtn.setAttribute('data-view-only', '1');
        if (checkbox) checkbox.checked = false;
    }

    hidePrivacyPolicy() {
        const overlay = document.getElementById('privacyOverlay');
        const checkboxContainer = document.getElementById('privacyCheckboxWrap') || document.querySelector('.privacy-checkbox');
        const agreeBtn = document.getElementById('privacyAgreeBtn');
        const disagreeBtn = document.getElementById('privacyDisagree');
        if (overlay) overlay.classList.add('hidden');
        // 恢复同意态控件（供浏览器首次启动使用）
        if (checkboxContainer) checkboxContainer.style.display = '';
        if (disagreeBtn) {
            disagreeBtn.style.display = '';
            disagreeBtn.textContent = '不同意并退出';
        }
        if (agreeBtn) {
            agreeBtn.textContent = '同意并进入';
            agreeBtn.disabled = true;
            agreeBtn.onclick = null;
            agreeBtn.removeAttribute('data-view-only');
        }
        if (disagreeBtn) disagreeBtn.removeAttribute('data-view-only');
    }

    showPurchaseModal(supplierId, productId, opts) {
        opts = opts || {};
        const supplier = SUPPLIERS.find(s => s.id === supplierId);
        const product = PRODUCTS.find(p => p.id === productId);
        const category = CATEGORIES.find(c => c.id === product.category);
        const availableGrades = supplier.availableGrades || ['B'];
        let defaultGrade = availableGrades.includes('B') ? 'B' : availableGrades[0];
        if (opts.grade && availableGrades.includes(opts.grade)) defaultGrade = opts.grade;
        const gradeInfo = QUALITY_GRADES[defaultGrade];
        let price = product.basePrice * supplier.priceMultiplier * gradeInfo.priceMultiplier;
        if (typeof gameState.applyPurchaseUnitPrice === 'function') price = gameState.applyPurchaseUnitPrice(price, product.category);
        else if (typeof gameState.applyNegotiationToPrice === 'function') price = gameState.applyNegotiationToPrice(price);
        const quality = Math.min(100, Math.max(0, gradeInfo.qualityBase + supplier.qualityBase * 0.3 + randomInt(-5, 5)));
        let deliveryDays = supplier.deliveryDays + product.procurementDays;
        if (typeof gameState.applyPurchaseLeadDays === 'function') deliveryDays = gameState.applyPurchaseLeadDays(deliveryDays, product.category);
        const minQty = Math.max(supplier.minOrder || 1, product.minOrder || 1);
        const startQty = Math.max(minQty, Math.min(100000, Math.floor(Number(opts.qty) || minQty)));

        const content = `
            <div style="text-align:center;margin-bottom:15px;">
                <div style="width:120px;height:120px;margin:0 auto;border-radius:12px;overflow:hidden;background:#f5f5f5;display:flex;align-items:center;justify-content:center;">
                    <img id="purchaseProductImg" src="${this.getProductImage(productId, defaultGrade)}" alt="${product.name}" style="width:100%;height:100%;object-fit:cover;" 
                         onerror="this.style.display='none';this.parentElement.innerHTML='<div style=\\'font-size:48px;\\'>${category.icon}</div>'">
                </div>
                <div style="font-size:16px;font-weight:bold;margin-top:10px;">${product.name}</div>
                <div style="font-size:11px;color:#1565c0;margin-top:4px;">商品ID：<code style="background:#e3f2fd;padding:1px 6px;border-radius:4px;font-weight:700;">${product.id}</code>（可用于自动采购计划）</div>
                <div style="color:#999;font-size:12px;margin-top:4px;">采购周期: ${deliveryDays}天${product.sellByGram ? ' · 按克计价' : ''}</div>
                <div style="color:#888;font-size:11px;margin-top:4px;">成交进价会在参考价上浮动（大路货±8% / 奢侈±12% / 黄金±15%），售价建议跟实际进价走</div>
            </div>
            <div class="form-group">
                <label class="form-label">批发商</label>
                <div style="font-size:14px;color:#666;">${supplier.name}</div>
            </div>
            <div class="form-group">
                <label class="form-label">品质等级</label>
                <div style="display:flex;gap:8px;">
                    ${Object.entries(QUALITY_GRADES).map(([key, grade]) => {
                        const isAvailable = availableGrades.includes(key);
                        const isSelected = key === defaultGrade;
                        const gradePrice = (product.basePrice * supplier.priceMultiplier * grade.priceMultiplier).toFixed(2);
                        return `
                            <div style="flex:1;padding:10px;border:2px solid ${isSelected ? '#ff6b35' : '#e0e0e0'};border-radius:8px;text-align:center;cursor:${isAvailable ? 'pointer' : 'not-allowed'};opacity:${isAvailable ? 1 : 0.4};"
                                 ${isAvailable ? `onclick="ui.selectGrade('${key}', '${supplierId}', '${productId}')"` : ''}
                                 id="grade_${key}">
                                <div style="font-size:14px;font-weight:bold;color:${isSelected ? '#ff6b35' : '#333'};">${grade.name}</div>
                                <div style="font-size:11px;color:#999;margin-top:2px;">${grade.description}</div>
                                <div style="font-size:12px;color:#ff6b35;font-weight:bold;margin-top:4px;">¥${gradePrice}</div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
            <div class="form-group">
                <label class="form-label">品质评分</label>
                <div style="font-size:14px;color:#666;"><span id="qualityDisplay">${Math.round(quality)}</span>分</div>
            </div>
            <div class="form-group">
                <label class="form-label">预计到货</label>
                <div style="font-size:14px;color:#666;">第${gameState.state.gameTime.day + deliveryDays}天左右</div>
            </div>
            <div class="form-group">
                <label class="form-label">起订量</label>
                <div style="font-size:14px;color:#666;">${supplier.minOrder}件</div>
            </div>
            <div class="form-group">
                <label class="form-label">购买数量 <span style="font-weight:400;color:#999;">（单次最多 100,000 件）</span></label>
                <div class="quantity-selector" style="width:fit-content;margin-bottom:10px;">
                    <button class="quantity-btn"
                            onmousedown="ui.startLongPress(() => ui.changeQty(-1))"
                            onmouseup="ui.stopLongPress()"
                            onmouseleave="ui.stopLongPress()"
                            ontouchstart="ui.startLongPress(() => ui.changeQty(-1))"
                            ontouchend="ui.stopLongPress()"
                            ontouchcancel="ui.stopLongPress()">-</button>
                    <input type="text" class="quantity-input" id="purchaseQty" value="${startQty.toLocaleString('en-US')}" readonly>
                    <button class="quantity-btn"
                            onmousedown="ui.startLongPress(() => ui.changeQty(1))"
                            onmouseup="ui.stopLongPress()"
                            onmouseleave="ui.stopLongPress()"
                            ontouchstart="ui.startLongPress(() => ui.changeQty(1))"
                            ontouchend="ui.stopLongPress()"
                            ontouchcancel="ui.stopLongPress()">+</button>
                </div>
                <div style="font-size:11px;color:#666;margin-bottom:6px;">💡 点击下方按钮可将对应数量累加到当前购买总数</div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    ${[100, 500, 1000, 5000, 10000, 50000, 100000].map(qty => {
                        const disabled = qty < supplier.minOrder;
                        return `
                            <div style="flex:1;min-width:60px;padding:8px 0;border:1px solid ${disabled ? '#e0e0e0' : '#1976d2'};border-radius:6px;text-align:center;cursor:${disabled ? 'not-allowed' : 'pointer'};color:${disabled ? '#ccc' : '#1976d2'};font-size:12px;font-weight:600;background:${disabled ? '#fafafa' : '#e3f2fd'};"
                                 onclick="${disabled ? '' : `ui.addQty(${qty})`}">
                                +${qty.toLocaleString('en-US')}件
                            </div>
                        `;
                    }).join('')}
                </div>
                <div style="margin-top:8px;padding:8px 10px;border-radius:8px;background:linear-gradient(135deg,#e8f5e9,#f1f8e9);border:1px solid #c8e6c9;font-size:11px;color:#2e7d32;line-height:1.6;">
                    🏷️ 批量优惠：≥1万件九五折 · ≥5万件九折 · ≥10万件八五折
                </div>
            </div>
            <div style="background:#fff8e1;padding:10px;border-radius:6px;text-align:center;">
                <div style="font-size:13px;color:#f57c00;">合计: <span id="purchaseTotal" style="font-size:18px;font-weight:bold;">${formatMoneyFull(price * startQty)}</span></div>
                <div id="purchaseDiscountTip" style="font-size:11px;color:#2e7d32;margin-top:4px;display:none;"></div>
            </div>
        `;

        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>
            <button class="btn btn-primary" onclick="ui.confirmPurchase()">确认进货</button>
        `;

        this.showModal('商品进货', content, footer);
        
        window._purchaseData = { 
            minQty: supplier.minOrder,
            maxQty: 100000,
            supplierId: supplierId,
            productId: productId,
            selectedGrade: defaultGrade,
            deliveryDays: deliveryDays,
            price: price,
            quality: quality
        };
        this._updatePurchaseTotalDisplay();
    }

    /** 进货数量阶梯折扣：≥1万 95折，≥5万 9折，≥10万 85折 */
    _getPurchaseQtyDiscount(qty) {
        const n = Math.max(0, parseInt(qty, 10) || 0);
        if (n >= 100000) return { rate: 0.85, label: '八五折', threshold: 100000 };
        if (n >= 50000) return { rate: 0.90, label: '九折', threshold: 50000 };
        if (n >= 10000) return { rate: 0.95, label: '九五折', threshold: 10000 };
        return { rate: 1, label: '', threshold: 0 };
    }

    _clampPurchaseQty(qty) {
        const data = window._purchaseData || {};
        const minQty = data.minQty || 1;
        const maxQty = data.maxQty || 100000;
        let n = Math.floor(Number(qty) || 0);
        if (!isFinite(n)) n = minQty;
        return Math.max(minQty, Math.min(maxQty, n));
    }

    _updatePurchaseTotalDisplay() {
        const data = window._purchaseData;
        const input = document.getElementById('purchaseQty');
        const totalEl = document.getElementById('purchaseTotal');
        if (!data || !input || !totalEl) return;
        const qty = this._clampPurchaseQty(String(input.value).replace(/,/g, ''));
        input.value = qty.toLocaleString('en-US');
        const unit = Number(data.price) || 0;
        const disc = this._getPurchaseQtyDiscount(qty);
        const original = unit * qty;
        const total = original * disc.rate;
        if (disc.rate < 1) {
            totalEl.innerHTML = `<span style="text-decoration:line-through;font-size:13px;color:#bbb;margin-right:6px;font-weight:400;">${formatMoneyFull(original)}</span>${formatMoneyFull(total)}`;
        } else {
            totalEl.textContent = formatMoneyFull(total);
        }
        const tipEl = document.getElementById('purchaseDiscountTip');
        if (tipEl) {
            if (disc.rate < 1) {
                const saved = original - total;
                tipEl.style.display = 'block';
                tipEl.textContent = `已享${disc.label}（单价 ¥${(unit * disc.rate).toFixed(2)}）· 节省 ${formatMoneyFull(saved)}`;
            } else {
                const need = 10000 - qty;
                tipEl.style.display = 'block';
                tipEl.style.color = '#888';
                tipEl.textContent = need > 0
                    ? `再买 ${need.toLocaleString('en-US')} 件可享九五折`
                    : '';
                if (need <= 0) tipEl.style.display = 'none';
            }
        }
    }

    selectGrade(grade, supplierId, productId) {
        const data = window._purchaseData;
        if (!data) return;

        data.selectedGrade = grade;

        const supplier = SUPPLIERS.find(s => s.id === supplierId);
        const product = PRODUCTS.find(p => p.id === productId);
        const gradeInfo = QUALITY_GRADES[grade];
        // 供应链模块:源头直采/独家代理的采购价优惠(默认乘数 1,无影响)
        const supplyMul = this._getSupplyMultiplier(supplierId);
        let price = product.basePrice * supplier.priceMultiplier * gradeInfo.priceMultiplier * supplyMul;
        if (typeof gameState.applyPurchaseUnitPrice === 'function') price = gameState.applyPurchaseUnitPrice(price, product.category);
        else if (typeof gameState.applyNegotiationToPrice === 'function') price = gameState.applyNegotiationToPrice(price);
        const quality = Math.min(100, Math.max(0, gradeInfo.qualityBase + supplier.qualityBase * 0.3 + randomInt(-5, 5)));

        data.price = price;
        data.quality = quality;

        // 更新UI
        Object.keys(QUALITY_GRADES).forEach(key => {
            const el = document.getElementById('grade_' + key);
            if (el) {
                el.style.borderColor = key === grade ? '#ff6b35' : '#e0e0e0';
                const nameEl = el.querySelector('div:first-child');
                if (nameEl) nameEl.style.color = key === grade ? '#ff6b35' : '#333';
            }
        });

        const qualityDisplay = document.getElementById('qualityDisplay');
        if (qualityDisplay) qualityDisplay.textContent = Math.round(quality);

        // 根据等级更新商品图片（ABC标识不同）
        const productImg = document.getElementById('purchaseProductImg');
        if (productImg && productId) {
            productImg.src = this.getProductImage(productId, grade);
        }

        this._updatePurchaseTotalDisplay();
    }

    changeQty(delta) {
        const input = document.getElementById('purchaseQty');
        const data = window._purchaseData;
        if (!input || !data) return;

        const maxQty = data.maxQty || 100000;
        let qty = (parseInt(String(input.value).replace(/,/g, ''), 10) || data.minQty) + delta;
        qty = this._clampPurchaseQty(qty);
        if ((parseInt(String(input.value).replace(/,/g, ''), 10) || 0) + delta > maxQty) {
            this.showToast(`单次最多进货 ${maxQty.toLocaleString('en-US')} 件`);
        }
        input.value = qty.toLocaleString('en-US');
        this._updatePurchaseTotalDisplay();
    }

    setQty(qty) {
        const input = document.getElementById('purchaseQty');
        const data = window._purchaseData;
        if (!input || !data) return;

        qty = this._clampPurchaseQty(qty);
        input.value = qty.toLocaleString('en-US');
        this._updatePurchaseTotalDisplay();
    }

    addQty(addend) {
        const input = document.getElementById('purchaseQty');
        const data = window._purchaseData;
        if (!input || !data) return;
        if (!isFinite(addend) || addend <= 0) return;

        const maxQty = data.maxQty || 100000;
        const current = parseInt(String(input.value).replace(/,/g, ''), 10) || data.minQty;
        let qty = current + Math.floor(addend);
        if (qty > maxQty) {
            const overflow = qty - maxQty;
            qty = maxQty;
            this.showToast(`单次最多进货 ${maxQty.toLocaleString('en-US')} 件，超出${overflow.toLocaleString('en-US')}件已截断`);
        }
        qty = this._clampPurchaseQty(qty);
        input.value = qty.toLocaleString('en-US');
        this._updatePurchaseTotalDisplay();

        const totalEl = document.getElementById('purchaseTotal');
        if (totalEl) {
            totalEl.animate([
                { transform: 'scale(1.05)', color: '#ff6b35' },
                { transform: 'scale(1)', color: '#f57c00' }
            ], { duration: 250, easing: 'ease-out' });
        }
    }

    confirmPurchase() {
        const data = window._purchaseData;
        if (!data) return;

        const qty = this._clampPurchaseQty(String(document.getElementById('purchaseQty').value).replace(/,/g, ''));
        const supplier = SUPPLIERS.find(s => s.id === data.supplierId);
        const product = PRODUCTS.find(p => p.id === data.productId);
        const gradeInfo = QUALITY_GRADES[data.selectedGrade];
        const supplyMul = this._getSupplyMultiplier(data.supplierId);
        let unitPrice = product.basePrice * supplier.priceMultiplier * gradeInfo.priceMultiplier * supplyMul;
        if (typeof gameState.applyPurchaseUnitPrice === 'function') unitPrice = gameState.applyPurchaseUnitPrice(unitPrice, product.category);
        else if (typeof gameState.applyNegotiationToPrice === 'function') unitPrice = gameState.applyNegotiationToPrice(unitPrice);
        if (typeof gameState.applyPurchaseSpotVariance === 'function') unitPrice = gameState.applyPurchaseSpotVariance(unitPrice, product);
        const quality = Math.min(100, Math.max(0, gradeInfo.qualityBase + supplier.qualityBase * 0.3 + randomInt(-5, 5)));
        const disc = this._getPurchaseQtyDiscount(qty);
        const paidUnit = Math.round(unitPrice * disc.rate * 100) / 100;
        const totalCost = Math.round(unitPrice * qty * disc.rate * 100) / 100;
        const deliveryDays = data.deliveryDays;
        const discNote = disc.rate < 1 ? ` · ${disc.label}` : '';
        const supplyNote = supplyMul < 1 ? ` · 供应链价×${supplyMul.toFixed(2)}` : '';

        // 供应链模块:账期赊购(先货后款),否则正常扣款
        let onCredit = false;
        if (typeof supplyState !== 'undefined' && supplyState && typeof supplyState.shouldUseCredit === 'function' && supplyState.shouldUseCredit(data.supplierId)) {
            onCredit = true;
        } else if (!gameState.spendFunds(totalCost, `进货 - ${product.name} x${qty.toLocaleString('en-US')} (${gradeInfo.name}${discNote}${supplyNote})`)) {
            this.showToast('资金不足！');
            return;
        }

        gameState.addPurchaseOrder({
            productId: data.productId,
            supplierId: data.supplierId,
            productName: product.name,
            quantity: qty,
            unitPrice: paidUnit,
            listUnitPrice: unitPrice,
            qtyDiscount: disc.rate,
            totalAmount: totalCost,
            quality: quality,
            qualityGrade: data.selectedGrade,
            deliveryDays: deliveryDays
        });
        if (onCredit) {
            try {
                const cr = supplyState.purchaseOnCredit(data.supplierId, totalCost);
                if (!cr || !cr.success) {
                    this.showToast('账期登记失败:' + (cr && cr.message));
                }
            } catch (_) {}
        }

        this.closeModal();
        const saveTip = disc.rate < 1
            ? `，已享${disc.label}省 ${formatMoneyFull(unitPrice * qty - totalCost)}`
            : '';
        this.showToast(`采购成功！预计第${gameState.state.gameTime.day + deliveryDays}天到货${onCredit ? '（账期付款）' : ''}${saveTip}`);
    }

    /** 供应链模块:某供应商当前采购价乘数(模块未加载返回 1) */
    _getSupplyMultiplier(supplierId) {
        try {
            if (typeof supplyState !== 'undefined' && supplyState && typeof supplyState.getEffectiveMultiplier === 'function') {
                return supplyState.getEffectiveMultiplier(supplierId);
            }
        } catch (_) {}
        return 1;
    }

    showSupplierProducts(supplierId) {
        const supplier = SUPPLIERS.find(s => s.id === supplierId);
        const shopLv = (gameState.state && gameState.state.shop && gameState.state.shop.level) || 1;
        const products = PRODUCTS.filter(p => supplier.categories.includes(p.category)
            && (typeof isProductUnlockedForShop !== 'function' || isProductUnlockedForShop(p, shopLv)));
        const category = CATEGORIES.find(c => c.id === products[0]?.category);
        const availableGrades = supplier.availableGrades || ['B'];
        const gradeColors = { A: '#4caf50', B: '#ff9800', C: '#999', S: '#7b1fa2', SS: '#c62828' };
        const grade0 = QUALITY_GRADES[availableGrades[0]] || QUALITY_GRADES.B;
        products.sort((a, b) => ((b.basePrice || 0) - (a.basePrice || 0)));

        const content = `
            <div style="font-size:13px;color:#666;margin-bottom:10px;">
                品质: ${supplier.qualityBase}分 | 起订: ${supplier.minOrder}件 | 配送: ${supplier.deliveryDays}天 · 已按金额从高到低
            </div>
            <input id="supplierProductSearch" type="search" placeholder="搜索商品" class="form-input" style="margin-bottom:10px;"
                oninput="ui.filterSupplierProducts()">
            <div style="font-size:12px;color:#999;margin-bottom:10px;">
                可提供品质: 
                ${availableGrades.map(g => `
                    <span class="badge" style="background:${gradeColors[g]};color:white;font-size:10px;margin-right:4px;">
                        ${QUALITY_GRADES[g]?.name || g}
                    </span>
                `).join('')}
            </div>
            ${products.map(p => {
                const gradeInfo = grade0;
                const priceNum = p.basePrice * supplier.priceMultiplier * gradeInfo.priceMultiplier;
                const price = priceNum.toFixed(2);
                const luxGrade = (p.category === 'luxury' && typeof getLuxuryDisplayGrade === 'function')
                    ? getLuxuryDisplayGrade(priceNum) : '';
                const unitTip = p.sellByGram ? ' /克' : '';
                const cat = CATEGORIES.find(c => c.id === p.category);
                const totalDelivery = supplier.deliveryDays + p.procurementDays;
                return `
                    <div class="product-item supplier-prod-row" data-name="${escapeHtml(p.name)}" data-id="${p.id}" style="padding:10px 0;">
                        <div class="product-image" style="width:50px;height:50px;border-radius:8px;overflow:hidden;background:#f5f5f5;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                            <img src="${p.image}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover;"
                                 onerror="this.style.display='none';this.parentElement.innerHTML='<div style=\\'font-size:22px;\\'>${cat?.icon || '📦'}</div>'">
                        </div>
                        <div class="product-info">
                            <div class="product-name" style="font-size:13px;">${p.name}${luxGrade ? ` <span class="badge" style="background:${gradeColors[luxGrade] || '#7b1fa2'};color:#fff;font-size:10px;">${luxGrade}</span>` : ''}</div>
                            <div class="product-price" style="font-size:14px;">¥${price}起${unitTip}</div>
                            <div class="product-meta" style="font-size:11px;">采购周期: ${totalDelivery}天${p.minOrder ? ' · 起订' + p.minOrder + (p.sellByGram ? '克' : '件') : ''}</div>
                        </div>
                        <button class="btn btn-primary btn-small" 
                                onclick="ui.showPurchaseModal('${supplierId}', '${p.id}')">进货</button>
                    </div>
                `;
            }).join('')}
        `;

        this.showModal(supplier.name, content);
    }

    filterSupplierProducts() {
        const q = String((document.getElementById('supplierProductSearch') || {}).value || '').trim().toLowerCase();
        const rows = document.querySelectorAll('.supplier-prod-row');
        rows.forEach(el => {
            const name = String(el.getAttribute('data-name') || '').toLowerCase();
            const id = String(el.getAttribute('data-id') || '').toLowerCase();
            el.style.display = (!q || name.indexOf(q) >= 0 || id.indexOf(q) >= 0) ? '' : 'none';
        });
    }

    /**
     * 缺员工提示弹窗：某项操作必须有对应岗位员工坐镇
     * roleType: 'customerService'（客服）| 'pricer'（改价员）
     */
    showStaffRequiredModal(roleType) {
        const roleMap = {
            customerService: { icon: '💬', name: '客服', desc: '上架商品需要客服坐镇：请先在「员工管理」招聘一名「客服」，之后即可手动上架商品（客服也可帮你自动上架）。' },
            pricer: { icon: '💲', name: '改价员', desc: '批量改价需要改价员操作：请先在「员工管理」招聘一名「改价员」，之后即可按成本比例批量调整在架商品售价。' }
        };
        const role = roleMap[roleType] || { icon: '👤', name: '员工', desc: '该操作需要先招聘对应岗位的员工。' };
        const content = `
            <div style="text-align:center;padding:14px 4px;">
                <div style="font-size:44px;margin-bottom:10px;">${role.icon}</div>
                <div style="font-size:15px;font-weight:800;color:#333;margin-bottom:8px;">需要${role.name}才能操作</div>
                <div style="font-size:13px;color:#666;line-height:1.8;">${role.desc}</div>
            </div>`;
        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">知道了</button>
            <button class="btn btn-primary" onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                onclick="ui.closeModal();ui.showHireEmployeeModal()">去招聘${role.name}</button>`;
        this.showModal(`需要${role.name}`, content, footer, { modalId: 'staffRequiredModal' });
    }

    showPublishModal(productId, suggestedPrice, qualityGrade = 'B', hasActiveListing = false) {
        const product = PRODUCTS.find(p => p.id === productId);
        if (!product) {
            this.showToast('无法上架：商品数据缺失（可能是退货入库异常）');
            return;
        }
        const category = CATEGORIES.find(c => c.id === product.category);
        const inventory = gameState.getInventoryQuantity(productId, qualityGrade);
        const gradeInfo = QUALITY_GRADES[qualityGrade] || QUALITY_GRADES.B;
        const gradeColors = { A: '#4caf50', B: '#ff9800', C: '#999' };

        // ===== 查找是否已有同 productId+qualityGrade 的 active listing（用于调整/编辑模式） =====
        const activeListing = hasActiveListing
            ? (gameState.state.listings || []).find(l =>
                l && l.productId === productId &&
                l.qualityGrade === qualityGrade &&
                l.status === 'active'
              )
            : null;
        const mode = activeListing ? 'edit' : 'create';
        // ===== 上架（新建）必须要有在职客服：没有客服不能上架商品（店主手动期除外）=====
        if (mode === 'create'
            && !this._isOwnerManualPhase()
            && !(typeof gameState.hasActiveCustomerService === 'function' && gameState.hasActiveCustomerService())) {
            this.showStaffRequiredModal('customerService');
            return;
        }
        const modalTitle = mode === 'edit' ? '调整上架商品' : '上架商品';
        const confirmBtnText = mode === 'edit' ? '确认调整' : '立即上架';
        const defaultTitle = activeListing && activeListing.title ? activeListing.title : product.name;

        const avgCost = (typeof gameState.getPricingCostBasis === 'function')
            ? gameState.getPricingCostBasis(productId, qualityGrade)
            : (gameState.getAverageCost(productId, qualityGrade) || 0);
        let dynSuggest = 0;
        try {
            if (typeof gameState.getSuggestedSellPrice === 'function') {
                dynSuggest = gameState.getSuggestedSellPrice(productId, qualityGrade);
            } else if (typeof gameState.calculateDynamicSellingPrice === 'function') {
                dynSuggest = gameState.calculateDynamicSellingPrice(productId, qualityGrade);
            }
        } catch (_) {}
        if (!(dynSuggest > 0)) {
            const passed = Number(suggestedPrice) || 0;
            dynSuggest = passed > 0 ? passed : Math.max(avgCost * 1.25, 0.01);
        }
        if (!(dynSuggest > 0)) dynSuggest = 0.01;
        dynSuggest = Math.round(dynSuggest * 100) / 100;
        const margin = dynSuggest - avgCost;
        const marginPct = avgCost > 0 ? Math.round((margin / avgCost) * 100) : 0;

        const defaultPrice = mode === 'edit' && typeof activeListing.price === 'number'
            ? activeListing.price
            : dynSuggest;
        const defaultGuarantee = activeListing && activeListing.guarantee ? activeListing.guarantee : '7day';

        const content = `
            <div style="text-align:center;margin-bottom:15px;">
                <div style="width:100px;height:100px;margin:0 auto;border-radius:10px;overflow:hidden;background:#f5f5f5;display:flex;align-items:center;justify-content:center;">
                    <img src="${this.getProductImage(productId, qualityGrade)}" alt="${product.name}" style="width:100%;height:100%;object-fit:cover;"
                         onerror="this.style.display='none';this.parentElement.innerHTML='<div style=\\'font-size:40px;\\'>${category?.icon}</div>'">
                </div>
                <div style="font-size:16px;font-weight:bold;margin-top:10px;">
                    ${product.name}
                    <span class="badge" style="margin-left:6px;background:${gradeColors[gradeInfo.grade]};color:white;font-size:10px;">${gradeInfo.name}</span>
                    ${mode === 'edit'
                        ? `<span class="badge" style="margin-left:6px;background:#4caf50;color:white;font-size:10px;">● 已上架中</span>`
                        : ''}
                </div>
                <div style="color:#999;font-size:13px;margin-top:2px;">可用库存: ${inventory}件</div>
                ${mode === 'edit'
                    ? `<div style="color:#ff6b35;font-size:12px;margin-top:4px;">本次修改将更新现有上架商品的信息（不会创建新的上架链接）</div>`
                    : ''}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
                <div style="background:#fff8e1;border-radius:8px;padding:10px;">
                    <div style="font-size:11px;color:#888;">平均成本</div>
                    <div style="font-size:16px;font-weight:800;color:#e65100;">¥${Number(avgCost).toFixed(2)}</div>
                </div>
                <div style="background:#e8f5e9;border-radius:8px;padding:10px;">
                    <div style="font-size:11px;color:#888;">建议售价</div>
                    <div style="font-size:16px;font-weight:800;color:#2e7d32;">¥${Number(dynSuggest).toFixed(2)}</div>
                    <div style="font-size:10px;color:#66bb6a;">毛利约 ¥${margin.toFixed(2)}（${marginPct}%）</div>
                </div>
            </div>
            <div style="font-size:11px;color:#888;margin-bottom:10px;line-height:1.5;">
                建议价按市场行情均价，并结合库存供需微调；过低会亏本，明显高于行情转化会下降
            </div>
            <div class="form-group">
                <label class="form-label">商品标题</label>
                <input type="text" class="form-input" id="listingTitle" value="${defaultTitle}" placeholder="请输入商品标题">
            </div>
            <div class="form-group">
                <label class="form-label">售价 (元)</label>
                <div style="display:flex;gap:8px;align-items:center;">
                    <input type="number" class="form-input" id="listingPrice" value="${defaultPrice}" placeholder="请输入售价" style="flex:1;">
                    <button class="btn btn-secondary btn-xs" type="button" onclick="document.getElementById('listingPrice').value='${dynSuggest}'">用建议价</button>
                    <button class="btn btn-secondary btn-xs" type="button" onclick="document.getElementById('listingPrice').value='${Math.round(avgCost * 1.5 * 100) / 100}'">成本×150%</button>
                </div>
            </div>
            <div class="form-group">
                <label class="form-label">售后保障</label>
                <select class="form-select" id="listingGuarantee">
                    <option value="7day" ${defaultGuarantee === '7day' ? 'selected' : ''}>七天无理由退换</option>
                    <option value="15day" ${defaultGuarantee === '15day' ? 'selected' : ''}>十五天无理由退换</option>
                    <option value="30day" ${defaultGuarantee === '30day' ? 'selected' : ''}>三十天无理由退换</option>
                </select>
            </div>
        `;

        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>
            <button class="btn btn-primary" onclick="ui.confirmPublish('${productId}', '${qualityGrade}', ${activeListing ? `'${activeListing.id}'` : 'null'})">${confirmBtnText}</button>
        `;

        this.showModal(modalTitle, content, footer);
    }

    confirmPublish(productId, qualityGrade = 'B', existingListingId = null) {
        // ===== 防线：新建上架必须有在职客服（店主手动期：未出第一单前可手动上架）=====
        if (!existingListingId
            && !this._isOwnerManualPhase()
            && !(typeof gameState.hasActiveCustomerService === 'function' && gameState.hasActiveCustomerService())) {
            this.closeModal();
            this.showStaffRequiredModal('customerService');
            return;
        }
        const title = document.getElementById('listingTitle').value.trim();
        const price = parseFloat(document.getElementById('listingPrice').value);
        const guarantee = document.getElementById('listingGuarantee').value;

        if (!title) {
            this.showToast('请输入商品标题');
            return;
        }

        if (isNaN(price) || price <= 0) {
            this.showToast('请输入有效价格');
            return;
        }

        const inventory = gameState.getInventoryQuantity(productId, qualityGrade);
        if (inventory <= 0) {
            this.showToast('库存不足，无法上架');
            return;
        }

        // ===== 关键修复：如果已有 active listing（编辑模式），则 update 它而不是创建新的 =====
        if (existingListingId) {
            gameState.updateListing(existingListingId, {
                title: title,
                price: price,
                guarantee: guarantee,
                suggestedPrice: price * 1.2,
                qualityGrade: qualityGrade
            });
            this.closeModal();
            this.showToast('上架信息已更新！');
            this.switchTab('products', 'listings');
            return;
        }

        gameState.addListing({
            productId: productId,
            title: title,
            price: price,
            status: 'active',
            guarantee: guarantee,
            suggestedPrice: price * 1.2,
            rating: 5,
            qualityGrade: qualityGrade
        });

        this.closeModal();
        this.showToast('商品上架成功！');
        this.switchTab('products', 'listings');
    }

    showEditPriceModal(listingId) {
        const listing = gameState.state.listings.find(l => l.id === listingId);
        if (!listing) return;
        
        const product = PRODUCTS.find(p => p.id === listing.productId);
        const category = CATEGORIES.find(c => c.id === product?.category);
        
        const content = `
            <div style="text-align:center;margin-bottom:15px;">
                <div style="width:80px;height:80px;margin:0 auto;border-radius:10px;overflow:hidden;background:#f5f5f5;display:flex;align-items:center;justify-content:center;">
                    <img src="${this.getProductImage(listing.productId, listing.qualityGrade || 'B')}" alt="${product.name}" style="width:100%;height:100%;object-fit:cover;"
                         onerror="this.style.display='none';this.parentElement.innerHTML='<div style=\\'font-size:32px;\\'>${category?.icon}</div>'">
                </div>
                <div style="font-size:15px;font-weight:bold;margin-top:10px;">${listing.title}</div>
                <div style="color:#999;font-size:12px;margin-top:4px;">当前售价: ¥${listing.price.toFixed(2)}</div>
            </div>
            <div class="form-group">
                <label class="form-label">新售价 (元)</label>
                <input type="number" class="form-input" id="editPrice" value="${listing.price}" placeholder="请输入新售价">
            </div>
            <div style="background:#fff8e1;padding:10px;border-radius:6px;">
                <div style="font-size:12px;color:#f57c00;line-height:1.5;">
                    💡 降价可以提高流量和转化率，但会减少利润；
                    涨价会降低流量，但每件利润更高。
                </div>
            </div>
        `;
        
        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>
            <button class="btn btn-primary" onclick="ui.confirmEditPrice('${listingId}')">确认修改</button>
        `;
        
        this.showModal('修改价格', content, footer);
    }

    confirmEditPrice(listingId) {
        const newPrice = parseFloat(document.getElementById('editPrice').value);
        
        if (isNaN(newPrice) || newPrice <= 0) {
            this.showToast('请输入有效价格');
            return;
        }
        
        const listing = gameState.state.listings.find(l => l.id === listingId);
        if (listing) {
            listing.price = newPrice;
            gameState.notify();
        }
        
        this.closeModal();
        this.showToast('价格修改成功！');
        this.render();
    }

    publishFromInventory(productId, qualityGrade = 'B') {
        if (productId == null || productId === '' || String(productId) === 'undefined' || String(productId) === 'null') {
            this.showToast('无法上架：商品ID无效（退货数据异常）');
            return;
        }
        const product = (typeof PRODUCTS !== 'undefined') ? PRODUCTS.find(p => p.id === productId) : null;
        if (!product) {
            this.showToast('无法上架：找不到商品档案');
            return;
        }
        let suggestedPrice = 0;
        try {
            if (typeof gameState.getSuggestedSellPrice === 'function') {
                suggestedPrice = gameState.getSuggestedSellPrice(productId, qualityGrade);
            } else if (typeof gameState.calculateDynamicSellingPrice === 'function') {
                suggestedPrice = gameState.calculateDynamicSellingPrice(productId, qualityGrade);
            }
        } catch (_) {}
        if (!(suggestedPrice > 0)) {
            const avgCost = gameState.getAverageCost(productId, qualityGrade) || 0;
            suggestedPrice = avgCost < 3000 ? avgCost * 2 : avgCost * 3;
        }
        this.showPublishModal(productId, suggestedPrice.toFixed(2), qualityGrade);
    }

    editListing(listingId) {
        const listing = gameState.state.listings.find(l => l.id === listingId);
        if (!listing) return;

        const avgCost = (typeof gameState.getPricingCostBasis === 'function')
            ? gameState.getPricingCostBasis(listing.productId, listing.qualityGrade)
            : (gameState.getAverageCost(listing.productId, listing.qualityGrade) || 0);
        let suggestedPrice = 0;
        try {
            if (typeof gameState.getSuggestedSellPrice === 'function') {
                suggestedPrice = gameState.getSuggestedSellPrice(listing.productId, listing.qualityGrade);
            } else if (typeof gameState.calculateDynamicSellingPrice === 'function') {
                suggestedPrice = gameState.calculateDynamicSellingPrice(listing.productId, listing.qualityGrade);
            }
        } catch (e) {}
        if (!(suggestedPrice > 0)) {
            suggestedPrice = avgCost < 3000 ? avgCost * 2 : avgCost * 3;
        }
        if (!(suggestedPrice > 0)) suggestedPrice = 0.01;
        suggestedPrice = Math.round(suggestedPrice * 100) / 100;

        let marketHeat = '正常';
        try {
            if (typeof gameState.getMarketSentiment === 'function') {
                const senti = gameState.getMarketSentiment(listing.productId, listing.qualityGrade);
                if (senti) {
                    const pressure = (senti.demand || 0.5) - (senti.supply || 0.5);
                    if (pressure > 0.15) marketHeat = '🔥 火爆';
                    else if (pressure > 0.05) marketHeat = '📈 偏热';
                    else if (pressure < -0.15) marketHeat = '🧊 冷淡';
                    else if (pressure < -0.05) marketHeat = '📉 偏冷';
                }
            }
        } catch (e) {}

        const originalPrice = listing.price;

        const content = `
            <div class="form-group">
                <label class="form-label">商品标题</label>
                <input type="text" class="form-input" id="editTitle" value="${listing.title}">
            </div>
            <div class="form-group">
                <label class="form-label">售价 (元)</label>
                <input type="number" class="form-input" id="editPrice" value="${listing.price}">
                <div style="margin-top:10px;padding:14px;border-radius:10px;background:linear-gradient(135deg,#e3f2fd,#e8f5e9);width:100%;font-size:13px;line-height:1.8;">
                    <div style="font-weight:bold;margin-bottom:6px;color:#1976d2;">价格参考（按市场行情 + 供需）</div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;">
                        <div>平均进货成本：</div><div style="font-weight:bold;">¥${avgCost.toFixed(2)}</div>
                        <div>动态建议价：</div><div style="font-weight:bold;color:#2e7d32;">¥${suggestedPrice.toFixed(2)}</div>
                        <div>供需热度：</div><div style="font-weight:bold;">${marketHeat}</div>
                        <div>原售价：</div><div style="font-weight:bold;color:#666;">¥${originalPrice.toFixed(2)}</div>
                    </div>
                </div>
            </div>
            <div class="form-group">
                <label class="form-label">商品状态</label>
                <select class="form-select" id="editStatus">
                    <option value="active" ${listing.status === 'active' ? 'selected' : ''}>上架中</option>
                    <option value="offline" ${listing.status === 'offline' ? 'selected' : ''}>下架</option>
                </select>
            </div>
        `;

        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>
            <button class="btn btn-primary" onclick="ui.saveListing('${listingId}')">保存</button>
        `;

        this.showModal('编辑商品', content, footer);
    }

    saveListing(listingId) {
        const title = document.getElementById('editTitle').value.trim();
        const price = parseFloat(document.getElementById('editPrice').value);
        const status = document.getElementById('editStatus').value;

        if (!title || isNaN(price) || price <= 0) {
            this.showToast('请填写完整信息');
            return;
        }

        const listing = gameState.state.listings.find(l => l.id === listingId);

        if (status === 'offline') {
            gameState.delistListing(listingId);
            if (listing && title) listing.title = title;
            if (listing && !isNaN(price)) listing.price = price;
            gameState.notify();
        } else {
            gameState.updateListing(listingId, {
                title: title,
                price: price,
                status: status
            });
        }

        this.closeModal();
        this.showToast(status === 'offline' ? '已下架' : '保存成功');
        this.render();
    }

    // 取消待付款订单
    cancelPendingOrder(orderId) {
        if (confirm('确定要取消这个订单吗？')) {
            const result = gameState.cancelPendingOrder(orderId);
            if (result.success) {
                this.showToast('订单已取消');
            } else {
                this.showToast('取消失败：' + (result.reason || '未知错误'));
            }
        }
    }

    packOrder(orderId) {
        const order = gameState.state.orders.find(o => o.id === orderId);
        if (!order || order.status !== 'pending_packing') return;

        const content = `
            <div style="text-align:center;margin-bottom:15px;">
                <div style="font-size:48px;">📦</div>
                <div style="font-size:16px;font-weight:bold;margin-top:8px;">订单打包</div>
            </div>
            <div class="form-group">
                <label class="form-label">商品名称</label>
                <div style="font-size:14px;color:#666;">${order.productName} x ${order.quantity}</div>
            </div>
            <div class="form-group">
                <label class="form-label">收货人</label>
                <div style="font-size:14px;color:#666;">${order.buyerName}</div>
            </div>
            <div class="form-group">
                <label class="form-label">收货地址</label>
                <div style="font-size:14px;color:#666;">${order.buyerAddress?.cityName || ''} ${order.buyerAddress?.detail || ''}</div>
            </div>
            <div class="form-group">
                <label class="form-label">包装材料</label>
                <select class="form-select" id="packMaterial">
                    <option value="standard">标准包装（纸箱+气泡膜）</option>
                    <option value="premium">精美包装（礼盒+填充棉）</option>
                    <option value="eco">环保包装（牛皮纸+纸浆模塑）</option>
                </select>
            </div>
            <div style="background:#f5f5f5;padding:10px;border-radius:6px;font-size:13px;color:#666;">
                <div>打包费: ¥${(order.fees?.packFee || 1).toFixed(2)}</div>
                <div>包装费: ¥${(order.fees?.packagingMaterialFee || 0.5).toFixed(2)}</div>
            </div>
        `;

        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>
            <button class="btn btn-primary" onclick="ui.confirmPack('${orderId}')">确认打包</button>
        `;

        this.showModal('订单打包', content, footer);
    }

    confirmPack(orderId) {
        const order = gameState.state.orders.find(o => o.id === orderId);
        if (!order) return;
        // 仅待打包可确认；已发货/员工打包中不可回退状态
        if (order.status !== 'pending_packing' || order.packed) {
            this.showToast('订单状态不允许打包');
            return;
        }
        if (order.beingPacked) {
            this.showToast('员工正在打包此订单，请稍候');
            return;
        }

        order.packed = true;
        order.packTime = { ...gameState.state.gameTime };
        order.packMaterial = document.getElementById('packMaterial')?.value || 'standard';
        // 打包完成后状态变更为待发货
        gameState.updateOrderStatus(orderId, 'pending_shipment');

        this.closeModal();
        this.showToast('打包完成！');
    }

    shipOrder(orderId) {
        const order = gameState.state.orders.find(o => o.id === orderId);
        if (!order || order.status !== 'pending_shipment') return;
        // 委托给新快递合作系统UI
        if (typeof expressUI !== 'undefined') {
            // 确保weightKg、fromCity、buyerCity已设置
            const product = PRODUCTS.find(p => p.id === order.productId);
            const warehouseCity = gameState.getWarehouseCity?.() || gameState.state.warehouse?.city || 'yiwu';
            const originCity = (typeof resolveShipFromCity === 'function')
                ? resolveShipFromCity(product, warehouseCity)
                : ((product && product.originCity) || warehouseCity);
            order.fromCity = originCity;
            if (!order.buyerCity) order.buyerCity = order.buyerCityId || 'shanghai';
            if (!order.weightKg && product) order.weightKg = (product.baseWeight * order.quantity) / 1000 + 0.1;
            this.closeModal();
            expressUI.showShipDialog(order);
            return;
        }
        // 降级兼容
        const result = gameEngine.shipOrder(order, 'standard');
        if (result) this.showToast('发货成功'); else this.showToast('发货失败');
    }

    selectExpress(expressType, orderId) {
        window._currentExpress = expressType;
        window._currentOrderId = orderId;
    }

    confirmShip(orderId) {
        const order = gameState.state.orders.find(o => o.id === orderId);
        if (!order) return;
        const expressType = window._currentExpress || 'standard';
        const result = gameEngine.shipOrder(order, expressType);
        if (result) { this.closeModal(); this.showToast('发货成功'); } else { this.showToast('发货失败'); }
    }

    showBatchShipModal() {
        this._markJustClicked();
        const state = gameState.state;
        let pendingOrders = [];
        try {
            if (typeof OrderPerf !== 'undefined' && OrderPerf.getStatusBucket) {
                OrderPerf.ensure(state.orders || []);
                const bucket = OrderPerf.getStatusBucket('pending_shipment') || [];
                for (let i = 0; i < bucket.length; i++) {
                    const o = bucket[i];
                    if (o && o.packed) pendingOrders.push(o);
                }
            }
        } catch (_) { pendingOrders = []; }
        if (!pendingOrders.length) {
            pendingOrders = (state.orders || []).filter(o => o.status === 'pending_shipment' && o.packed);
        }
        if (pendingOrders.length === 0) { this.showToast('没有待发货的订单'); return; }

        const defaultType = (typeof gameState.getDefaultExpress === 'function')
            ? (gameState.getDefaultExpress() || 'standard')
            : 'standard';
        const total = pendingOrders.length;
        const CHUNK = total > 800 ? 60 : (total > 300 ? 100 : 150);
        let success = 0, failed = 0, skipped = 0;
        const failMessages = [];

        this.showToast('🚚 批量发货中 0/' + total + '…', 1200);
        try { if (typeof gameState.beginNotifyBatch === 'function') gameState.beginNotifyBatch(); } catch (_) {}

        const finish = () => {
            try { if (typeof gameState.endNotifyBatch === 'function') gameState.endNotifyBatch(true); } catch (_) {}
            if (success === total) {
                this.showToast('🚚 批量发货成功！共' + success + '单全部发出');
            } else if (success > 0) {
                const tip = '🚚 批量发货完成：成功' + success + '单，失败' + failed + '单' + (skipped ? '，跳过' + skipped + '单' : '');
                this.showToast(tip + (failMessages.length ? '（前几笔：' + failMessages.slice(0, 5).join('|') + '）' : ''));
            } else {
                this.showToast('批量发货失败：' + failed + '单' + (failMessages.length ? '（' + failMessages.slice(0, 3).join('|') + '）' : ''));
            }
            this.pendingRender = true;
            this._schedulePostClickRender(120);
        };

        const runChunk = (start) => {
            this._interactionUntil = Date.now() + 800;
            try {
                const end = Math.min(start + CHUNK, total);
                for (let i = start; i < end; i++) {
                    const o = pendingOrders[i];
                    if (!o || o.status !== 'pending_shipment' || !o.packed) { skipped++; continue; }
                    try {
                        const expressToUse = o.expressServiceId || o.expressType || defaultType;
                        // 一键发货：现结当场扣款，不再逐单塞进付款确认队列
                        if (gameEngine.shipOrder(o, expressToUse, null, { confirmedPayment: true })) success++;
                        else {
                            failed++;
                            if (failMessages.length < 5) failMessages.push((o.id || '').substr(-6) + ':发货API返回失败');
                        }
                    } catch (e) {
                        failed++;
                        if (failMessages.length < 5) {
                            failMessages.push((o.id || '').substr(-6) + ':' + (e && e.message ? e.message.substr(0, 30) : '未知异常'));
                        }
                    }
                }
                if (end < total) {
                    if (end === CHUNK || end % (CHUNK * 3) === 0) {
                        try { this.showToast('🚚 批量发货中 ' + end + '/' + total + '…', 800); } catch (_) {}
                    }
                    setTimeout(() => runChunk(end), 0);
                } else {
                    finish();
                }
            } catch (e) {
                console.warn('[batchShip]', e);
                finish();
            }
        };
        setTimeout(() => runChunk(0), 0);
    }

    /**
     * 清理「幽灵打包锁」：订单标了 beingPacked，但已无员工任务在处理 → 允许一键打包接管
     */
    _releaseOrphanPackLocks() {
        try {
            const state = gameState.state;
            if (!state || !Array.isArray(state.orders)) return 0;
            const activePackIds = new Set();
            (state.employees || []).forEach(emp => {
                const t = emp && emp.currentTask;
                if (!t || t.type !== 'pack') return;
                (t.orderIds || (t.orderId ? [t.orderId] : [])).forEach(id => {
                    if (id) activePackIds.add(id);
                });
            });
            let released = 0;
            let pool = null;
            try {
                if (typeof OrderPerf !== 'undefined' && OrderPerf.getStatusBucket) {
                    OrderPerf.ensure(state.orders);
                    pool = OrderPerf.getStatusBucket('pending_packing');
                }
            } catch (_) { pool = null; }
            const list = pool || state.orders;
            for (let i = 0; i < list.length; i++) {
                const o = list[i];
                if (!o || o.status !== 'pending_packing' || !o.beingPacked) continue;
                if (activePackIds.has(o.id)) continue;
                o.beingPacked = false;
                o.beingPackedBy = null;
                released++;
            }
            return released;
        } catch (_) {
            return 0;
        }
    }

    showBatchPackModal() {
        this._markJustClicked();
        const state = gameState.state;
        // 先释放无员工承接的幽灵锁，再统计可打包单
        const released = this._releaseOrphanPackLocks();
        let lockedByStaff = 0;
        let pendingOrders = [];
        try {
            if (typeof OrderPerf !== 'undefined' && OrderPerf.getStatusBucket) {
                OrderPerf.ensure(state.orders || []);
                const bucket = OrderPerf.getStatusBucket('pending_packing') || [];
                for (let i = 0; i < bucket.length; i++) {
                    const o = bucket[i];
                    if (!o || o.packed) continue;
                    if (o.beingPacked) lockedByStaff++;
                    else pendingOrders.push(o);
                }
            }
        } catch (_) { pendingOrders = []; lockedByStaff = 0; }
        if (!pendingOrders.length && !lockedByStaff) {
            lockedByStaff = (state.orders || []).filter(o =>
                o && o.status === 'pending_packing' && !o.packed && o.beingPacked).length;
            pendingOrders = (state.orders || []).filter(o =>
                o && o.status === 'pending_packing' && !o.packed && !o.beingPacked);
        }
        if (pendingOrders.length === 0) {
            if (lockedByStaff > 0) {
                this.showToast(`有 ${lockedByStaff} 单正在由员工打包，请稍候或去「待打包」查看`);
            } else {
                this.showToast(released > 0
                    ? '已清理异常打包锁，但当前没有待打包订单'
                    : '没有待打包的订单（请切换到「待打包」页签）');
            }
            try {
                this.currentTab = this.currentTab || {};
                this.currentTab.orders = 'pending_packing';
                setTimeout(() => { try { this.render(); } catch (_) {} }, 0);
            } catch (_) {}
            return;
        }
        const now = { ...gameState.state.gameTime };
        const defaultPackMaterial = 'standard';
        const total = pendingOrders.length;
        const CHUNK = total > 800 ? 80 : (total > 300 ? 120 : 180);
        let success = 0, failedMaterial = 0, skipped = 0;
        const failMessages = [];

        this.showToast('📦 批量打包中 0/' + total + '…', 1200);
        try { if (typeof gameState.beginNotifyBatch === 'function') gameState.beginNotifyBatch(); } catch (_) {}

        const finish = () => {
            try { if (typeof gameState.endNotifyBatch === 'function') gameState.endNotifyBatch(true); } catch (_) {}
            if (success === total) {
                this.showToast('📦 批量打包成功！共' + success + '单');
            } else if (success > 0) {
                const tip = '📦 批量打包：成功' + success + '单，失败' + failedMaterial + '单' + (skipped ? '，跳过' + skipped + '单' : '');
                this.showToast(tip + (failMessages.length ? '（前几笔：' + failMessages.slice(0, 5).join('|') + '）' : ''));
            } else {
                this.showToast('批量打包失败：' + failedMaterial + '单' + (failMessages.length ? '（' + failMessages.slice(0, 3).join('|') + '）' : ''));
            }
            this.pendingRender = true;
            this._schedulePostClickRender(120);
        };

        const runChunk = (start) => {
            this._interactionUntil = Date.now() + 800;
            try {
                const end = Math.min(start + CHUNK, total);
                for (let i = start; i < end; i++) {
                    const o = pendingOrders[i];
                    if (!o || o.status !== 'pending_packing' || o.packed || o.beingPacked) { skipped++; continue; }
                    try {
                        o.packed = true;
                        o.packTime = { ...now };
                        o.packMaterial = defaultPackMaterial;
                        if (o.status === 'pending_packing') {
                            gameState.updateOrderStatus(o.id, 'pending_shipment', o);
                        }
                        success++;
                    } catch (e) {
                        failedMaterial++;
                        try { if (o) { o.packed = false; delete o.packTime; delete o.packMaterial; } } catch (_) {}
                        if (failMessages.length < 5) {
                            failMessages.push((o.id || '').substr(-6) + ':' + (e && e.message ? e.message.substr(0, 30) : '未知异常'));
                        }
                    }
                }
                if (end < total) {
                    if (end === CHUNK || end % (CHUNK * 3) === 0) {
                        try { this.showToast('📦 批量打包中 ' + end + '/' + total + '…', 800); } catch (_) {}
                    }
                    setTimeout(() => runChunk(end), 0);
                } else {
                    finish();
                }
            } catch (e) {
                console.warn('[batchPack]', e);
                finish();
            }
        };
        setTimeout(() => runChunk(0), 0);
    }

    selectBatchExpress(expressType) { window._batchExpress = expressType; }

    confirmBatchShip() {
        const orderIds = window._batchOrders || [];
        const expressType = window._batchExpress || 'standard';
        let successCount = 0;
        orderIds.forEach(orderId => {
            const order = gameState.state.orders.find(o => o.id === orderId);
            if (order && order.status === 'pending_shipment' && order.packed) {
                if (gameEngine.shipOrder(order, expressType)) successCount++;
            }
        });
        this.closeModal();
        if (successCount > 0) this.showToast('批量发货成功！' + successCount + '单已发货');
        else this.showToast('批量发货失败');
    }

    /**
     * 订单成本/利润拆解（已发货/已完成订单详情用）
     * 利润 = 实收 − 商品成本 − 打包费 − 包装耗用成本 − 紧急采购包装 − 快递费
     */
    _getOrderCostBreakdown(order) {
        const quantity = Math.max(1, Number(order.quantity) || 1);
        const unitPrice = Number(order.unitPrice) || 0;
        const revenue = Number(order.totalAmount);
        const revenueSafe = Number.isFinite(revenue) ? revenue : unitPrice * quantity;
        const goodsCost = Number(order.costAmount) || 0;
        const unitCost = goodsCost > 0 ? goodsCost / quantity : 0;

        const fees = order.fees || {};
        const packFee = Number(fees.packFee) || 0;
        const expressFee = Number(order.expressFee != null ? order.expressFee : fees.expressFee) || 0;
        const packagingCost = Number(
            fees.packagingCost != null
                ? fees.packagingCost
                : (order.materialsUsed && order.materialsUsed._statsPackagingFee)
        ) || Number(fees.packagingMaterialFee) || 0;
        let autoBuyCost = Number(fees.autoBuyCost) || 0;
        if (autoBuyCost <= 0 && fees.total != null) {
            // 兼容旧单：从 fees.total 反推紧急采购
            const inferred = (Number(fees.total) || 0) - packFee - (Number(fees.packagingMaterialFee) || 0) - expressFee;
            if (inferred > 0.009) autoBuyCost = Math.round(inferred * 100) / 100;
        }

        const materials = [];
        const used = order.materialsUsed || {};
        const allMats = (typeof PACKAGING_MATERIALS !== 'undefined') ? PACKAGING_MATERIALS : {};
        Object.keys(used).forEach(id => {
            if (!id || id.charAt(0) === '_') return;
            const qty = Number(used[id]);
            if (!(qty > 0)) return;
            const mat = allMats[id] || {};
            const unitMatCost = Number(mat.cost) || 0;
            materials.push({
                id,
                name: mat.name || id,
                icon: mat.icon || '📦',
                unit: mat.unit || '件',
                quantity: qty,
                unitCost: unitMatCost,
                subtotal: Math.round(unitMatCost * qty * 100) / 100
            });
        });
        materials.sort((a, b) => b.subtotal - a.subtotal);

        const platformRate = (typeof gameState !== 'undefined' && gameState && typeof gameState.getPlatformCommissionRate === 'function')
            ? gameState.getPlatformCommissionRate()
            : ((typeof SHOP_CONFIG !== 'undefined' && SHOP_CONFIG.platformCommissionRate != null)
                ? Number(SHOP_CONFIG.platformCommissionRate) : 0.01);
        let platformFee = Number(order.platformFee);
        if (!(platformFee >= 0) || (order.platformFee == null && !order._saleSettled)) {
            platformFee = Math.round(revenueSafe * platformRate * 100) / 100;
        }
        platformFee = Math.round((Number(platformFee) || 0) * 100) / 100;

        const totalCost = goodsCost + packFee + packagingCost + autoBuyCost + expressFee + platformFee;
        const profit = Math.round((revenueSafe - totalCost) * 100) / 100;
        const margin = revenueSafe > 0 ? Math.round((profit / revenueSafe) * 1000) / 10 : 0;

        return {
            quantity,
            unitPrice,
            revenue: Math.round(revenueSafe * 100) / 100,
            goodsCost: Math.round(goodsCost * 100) / 100,
            unitCost: Math.round(unitCost * 100) / 100,
            packFee: Math.round(packFee * 100) / 100,
            packagingCost: Math.round(packagingCost * 100) / 100,
            autoBuyCost: Math.round(autoBuyCost * 100) / 100,
            expressFee: Math.round(expressFee * 100) / 100,
            platformFee,
            platformRate,
            totalCost: Math.round(totalCost * 100) / 100,
            profit,
            margin,
            materials,
            packagingLevel: used._level || order.packMaterial || null,
            couponDiscount: Number(order.couponDiscount) || 0
        };
    }

    /** 已发货/已完成订单：货物与成本利润详情 */
    showOrderDetail(orderId) {
        const order = gameState.state.orders.find(o => o.id === orderId);
        if (!order) {
            this.showToast('订单不存在');
            return;
        }

        const cache = this._cache || {};
        const product = (cache.productsById && cache.productsById.get(order.productId)) ||
            (typeof PRODUCTS !== 'undefined' ? PRODUCTS.find(p => p.id === order.productId) : null);
        const category = product
            ? ((cache.categoriesById && cache.categoriesById.get(product.category)) ||
               (typeof CATEGORIES !== 'undefined' ? CATEGORIES.find(c => c.id === product.category) : null))
            : null;
        const statusInfo = (typeof ORDER_STATUS !== 'undefined')
            ? ORDER_STATUS.find(s => s.code === order.status)
            : null;
        const gradeInfo = (typeof QUALITY_GRADES !== 'undefined' && order.qualityGrade)
            ? QUALITY_GRADES[order.qualityGrade]
            : null;
        const bd = this._getOrderCostBreakdown(order);
        const profitColor = bd.profit >= 0 ? '#2e7d32' : '#c62828';
        const profitBg = bd.profit >= 0
            ? 'linear-gradient(135deg,#e8f5e9,#f1f8e9)'
            : 'linear-gradient(135deg,#ffebee,#fff5f5)';

        const esc = (typeof escapeHtml === 'function')
            ? escapeHtml
            : (s) => String(s == null ? '' : s)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');

        // 快递信息
        let expressName = '—';
        if (typeof ExpressData !== 'undefined' && order.expressCompanyId) {
            const company = ExpressData.getCompany(order.expressCompanyId);
            const service = company && company.services
                ? company.services.find(s => s.id === order.expressServiceId)
                : null;
            expressName = [company && company.name, service && service.name].filter(Boolean).join(' · ') || expressName;
        } else if (order.expressType && typeof EXPRESS_OPTIONS !== 'undefined' && EXPRESS_OPTIONS[order.expressType]) {
            expressName = EXPRESS_OPTIONS[order.expressType].name || order.expressType;
        } else if (order.expressType) {
            expressName = String(order.expressType);
        }

        const pkgLevelNames = { standard: '标准包装', premium: '精美包装', eco: '环保包装', legacy: '常规包装' };
        const pkgLevelLabel = bd.packagingLevel
            ? (pkgLevelNames[bd.packagingLevel] || bd.packagingLevel)
            : '—';

        const materialsHtml = bd.materials.length === 0
            ? `<div style="font-size:12px;color:#999;padding:8px 0;">暂无包装耗用记录（可能为旧订单）</div>`
            : bd.materials.map(m => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #f3f3f3;font-size:12px;">
                    <span style="color:#444;">${m.icon} ${esc(m.name)}</span>
                    <span style="color:#666;font-variant-numeric:tabular-nums;">
                        ${m.quantity % 1 === 0 ? m.quantity : m.quantity.toFixed(2)}${esc(m.unit)}
                        <span style="color:#999;margin-left:6px;">¥${m.subtotal.toFixed(2)}</span>
                    </span>
                </div>
            `).join('');

        const row = (label, value, opts = {}) => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;${opts.border ? 'border-top:1px dashed #e0e0e0;margin-top:4px;padding-top:10px;' : ''}font-size:${opts.big ? '14px' : '13px'};">
                <span style="color:${opts.labelColor || '#666'};font-weight:${opts.bold ? '700' : '400'};">${label}</span>
                <span style="color:${opts.color || '#333'};font-weight:${opts.bold ? '800' : '600'};font-variant-numeric:tabular-nums;">${value}</span>
            </div>
        `;

        const shipTime = order.shipTime || order.completeTime || null;
        const createTime = order.createTime || { day: '—', hour: 0 };
        const buyerAddr = order.buyerAddress || {};
        const weight = order.packageWeightKg || order.weightKg;

        const content = `
            <div style="display:flex;flex-direction:column;gap:12px;max-height:70vh;overflow-y:auto;padding:2px;">
                <!-- 商品卡片 -->
                <div style="display:flex;gap:12px;padding:12px;background:#fafafa;border-radius:12px;">
                    <div style="width:64px;height:64px;border-radius:10px;overflow:hidden;background:#eee;flex-shrink:0;display:flex;align-items:center;justify-content:center;">
                        <img src="${this.getProductImage(order.productId, order.qualityGrade || 'B')}" alt=""
                             style="width:100%;height:100%;object-fit:cover;"
                             onerror="this.style.display='none';this.parentElement.innerHTML='<div style=\\'font-size:28px;\\'>${(category && category.icon) || '📦'}</div>'">
                    </div>
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:15px;font-weight:800;color:#222;line-height:1.35;">${esc(order.productName || (product && product.name) || '商品')}</div>
                        <div style="font-size:12px;color:#888;margin-top:4px;">
                            ${(category && category.name) ? esc(category.name) + ' · ' : ''}
                            ${gradeInfo ? esc(gradeInfo.name) + ' · ' : ''}
                            ¥${bd.unitPrice.toFixed(2)} × ${bd.quantity}
                        </div>
                        <div style="margin-top:6px;">
                            <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;background:${(statusInfo && statusInfo.color) || '#9c27b0'}22;color:${(statusInfo && statusInfo.color) || '#9c27b0'};">
                                ${(statusInfo && statusInfo.name) || order.status}
                            </span>
                            ${order.isMember ? '<span style="margin-left:4px;display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;background:#fff3e0;color:#ef6c00;">👑会员</span>' : ''}
                        </div>
                    </div>
                </div>

                <!-- 订单信息 -->
                <div style="padding:12px 14px;background:#fff;border:1px solid #eee;border-radius:12px;">
                    <div style="font-size:13px;font-weight:800;color:#333;margin-bottom:8px;">📋 订单信息</div>
                    ${row('订单号', esc((order.id || '').slice(-12) || '—'))}
                    ${row('买家', esc(order.buyerName || '—'))}
                    ${row('收货地址', esc([buyerAddr.province, buyerAddr.cityName, buyerAddr.detail].filter(Boolean).join(' ') || '—'))}
                    ${row('下单时间', typeof formatDate === 'function' ? formatDate(createTime.day, createTime.hour) : `D${createTime.day} ${createTime.hour}:00`)}
                    ${shipTime ? row('发货时间', typeof formatDate === 'function' ? formatDate(shipTime.day, shipTime.hour) : `D${shipTime.day} ${shipTime.hour}:00`) : ''}
                    ${weight ? row('包裹重量', Number(weight).toFixed(2) + ' kg') : ''}
                    ${row('快递服务', esc(expressName))}
                    ${order.trackingNo || (order.logistics && order.logistics.trackingNumber)
                        ? row('运单号', esc(order.trackingNo || order.logistics.trackingNumber))
                        : ''}
                </div>

                <!-- 收入 -->
                <div style="padding:12px 14px;background:linear-gradient(135deg,#e3f2fd,#f5faff);border:1px solid #bbdefb;border-radius:12px;">
                    <div style="font-size:13px;font-weight:800;color:#1565c0;margin-bottom:8px;">💵 销售收入</div>
                    ${row('售价小计', `¥${(bd.unitPrice * bd.quantity).toFixed(2)}`)}
                    ${bd.couponDiscount > 0 ? row('优惠券抵扣', `-¥${bd.couponDiscount.toFixed(2)}`, { color: '#e91e63' }) : ''}
                    ${row('实收金额', `¥${bd.revenue.toFixed(2)}`, { bold: true, color: '#1565c0', border: true })}
                </div>

                <!-- 成本 -->
                <div style="padding:12px 14px;background:#fff;border:1px solid #eee;border-radius:12px;">
                    <div style="font-size:13px;font-weight:800;color:#333;margin-bottom:8px;">📦 成本明细</div>
                    ${row('商品成本价（单价）', `¥${bd.unitCost.toFixed(2)}`)}
                    ${row('商品成本合计', `¥${bd.goodsCost.toFixed(2)}`, { bold: true })}
                    ${row('打包人工费', `¥${bd.packFee.toFixed(2)}`)}
                    ${row('包装用品成本', `¥${bd.packagingCost.toFixed(2)}`)}
                    ${bd.autoBuyCost > 0 ? row('包装紧急采购', `¥${bd.autoBuyCost.toFixed(2)}`, { color: '#ef6c00' }) : ''}
                    ${row('快递费', `¥${bd.expressFee.toFixed(2)}`)}
                    ${row(`平台抽成（${Math.round((bd.platformRate || 0.01) * 100)}%）`, `¥${(bd.platformFee || 0).toFixed(2)}`, { color: '#e65100' })}
                    ${row('成本合计', `¥${bd.totalCost.toFixed(2)}`, { bold: true, color: '#c62828', border: true })}
                </div>

                <!-- 包装用品 -->
                <div style="padding:12px 14px;background:#fff8e1;border:1px solid #ffe082;border-radius:12px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <div style="font-size:13px;font-weight:800;color:#f57c00;">📮 包装用品</div>
                        <div style="font-size:11px;color:#999;">档位：${esc(pkgLevelLabel)}</div>
                    </div>
                    ${materialsHtml}
                    <div style="display:flex;justify-content:space-between;margin-top:8px;padding-top:8px;border-top:1px dashed #ffe082;font-size:12px;">
                        <span style="color:#666;">包装耗用合计</span>
                        <span style="font-weight:800;color:#ef6c00;">¥${bd.packagingCost.toFixed(2)}</span>
                    </div>
                </div>

                ${(() => {
                    try {
                        const csList = (gameState.state.customerService && gameState.state.customerService.consultations) || [];
                        const related = csList.filter(c => c && (c.orderId === order.id
                            || (c.buyerName === order.buyerName && c.productId === order.productId)));
                        if (!related.length) return '';
                        const last = related[related.length - 1];
                        const staffMsg = (last.messages || []).slice().reverse().find(m => m && m.role === 'staff');
                        const reply = (staffMsg && staffMsg.content) || (typeof last.reply === 'string' ? last.reply : '');
                        const q = last.question || ((last.messages || []).find(m => m.role === 'buyer') || {}).content || '';
                        return `
                <div style="padding:12px 14px;background:#f3f8ff;border:1px solid #bbdefb;border-radius:12px;">
                    <div style="font-size:13px;font-weight:800;color:#1565c0;margin-bottom:8px;">💬 买家咨询</div>
                    <div style="font-size:12px;color:#333;line-height:1.55;padding:8px 10px;background:#fff;border-radius:8px;">
                        <span style="color:#888;font-size:10px;">买家</span><br>${esc(q || '—')}
                    </div>
                    ${reply ? `
                    <div style="font-size:12px;color:#1a365d;line-height:1.55;padding:8px 10px;background:#e8f4ff;border-radius:8px;margin-top:8px;">
                        <span style="color:#1677ff;font-size:10px;font-weight:800;">我们的回复${last.staffName ? ' · ' + esc(last.staffName) : ''}</span><br>${esc(reply)}
                    </div>` : '<div style="font-size:11px;color:#999;margin-top:6px;">尚未回复</div>'}
                </div>`;
                    } catch (_) { return ''; }
                })()}

                <!-- 利润 -->
                <div style="padding:14px;background:${profitBg};border-radius:12px;border:1px solid ${bd.profit >= 0 ? '#c8e6c9' : '#ffcdd2'};">
                    <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:10px;">
                        <div>
                            <div style="font-size:12px;color:#666;margin-bottom:4px;">💰 订单利润</div>
                            <div style="font-size:26px;font-weight:900;color:${profitColor};font-variant-numeric:tabular-nums;">
                                ${bd.profit >= 0 ? '+' : ''}¥${bd.profit.toFixed(2)}
                            </div>
                        </div>
                        <div style="text-align:right;font-size:12px;color:#666;line-height:1.6;">
                            利润率 <b style="color:${profitColor};">${bd.margin}%</b><br>
                            实收 ¥${bd.revenue.toFixed(2)} − 成本 ¥${bd.totalCost.toFixed(2)}
                        </div>
                    </div>
                </div>
            </div>
        `;

        const footer = `
            ${(order.status === 'shipped' || order.waybillId || order.logistics)
                ? `<button class="btn btn-secondary" onclick="ui.closeModal();ui.showLogistics('${order.id}')">查看物流</button>`
                : ''}
            ${order.status === 'completed' && order.review
                ? `<button class="btn btn-secondary" onclick="ui.closeModal();ui.showReview('${order.id}')">查看评价详情</button>`
                : ''}
            <button class="btn btn-primary" onclick="ui.closeModal()">关闭</button>
        `;

        this.showModal('订单详情', content, footer, { width: '520px' });
    }

    showLogistics(orderId) {
        const order = gameState.state.orders.find(o => o.id === orderId);
        if (!order) return;

        // 优先使用新快递系统的运单跟踪
        if (typeof ExpressState !== 'undefined' && order.waybillId) {
            const wb = ExpressState.getWaybill(order.waybillId);
            if (wb) {
                const tracks = ExpressState.getTracksByWaybill(order.waybillId);
                const company = typeof ExpressData !== 'undefined' ? ExpressData.getCompany(wb.companyId) : null;
                const service = company ? company.services.find(s => s.id === wb.serviceId) : null;
                const tracksHtml = tracks.length > 0 ? tracks.slice().reverse().map(t => {
                    const isLatest = t === tracks[tracks.length - 1];
                    const day = t.time ? t.time.day : t.day;
                    const hour = t.time ? t.time.hour : t.hour;
                    return `<div style="display:flex;gap:10px;margin-bottom:10px;${isLatest ? 'font-weight:bold;color:#2196f3;' : 'color:#666;'}">
                        <div style="width:10px;height:10px;border-radius:50%;background:${isLatest ? '#2196f3' : '#ccc'};margin-top:5px;flex-shrink:0;"></div>
                        <div>
                            <div style="font-size:13px;">${t.description}</div>
                            <div style="font-size:11px;color:#999;margin-top:2px;">${t.location || ''} · 第${day}天${hour}时</div>
                        </div>
                    </div>`;
                }).join('') : '<div style="color:#999;text-align:center;padding:20px;">暂无物流信息</div>';
                const content = `
                    <div style="margin-bottom:12px;padding:10px;background:#f5f5f5;border-radius:8px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <div>
                                <div style="font-size:14px;font-weight:bold;">${company ? company.name : ''} ${service ? service.name : ''}</div>
                                <div style="font-size:12px;color:#666;">运单号：${wb.trackingNo}</div>
                            </div>
                            <span style="padding:3px 10px;border-radius:10px;font-size:12px;background:${wb.status === 'signed' || wb.status === 'delivered' ? '#e8f5e9' : wb.status === 'lost' ? '#ffebee' : '#e3f2fd'};color:${wb.status === 'signed' || wb.status === 'delivered' ? '#4caf50' : wb.status === 'lost' ? '#f44336' : '#2196f3'};">
                                ${typeof getLogisticsStatus !== 'undefined' ? getLogisticsStatus(wb.status).name : wb.status}
                            </span>
                        </div>
                    </div>
                    <div style="padding:5px 0;">${tracksHtml}</div>
                `;
                const footer = `
                    <button class="btn btn-secondary" onclick="ui.closeModal();ui.showOrderDetail('${order.id}')">订单详情</button>
                    <button class="btn btn-primary" onclick="ui.closeModal()">关闭</button>
                `;
                this.showModal('物流跟踪', content, footer);
                return;
            }
        }

        if (!order.logistics) order.logistics = { status: 'pending', updates: [] };
        const updates = order.logistics.updates || [];
        const express = order.expressType ? EXPRESS_OPTIONS[order.expressType] : null;
        const isLost = order.logistics.status === 'lost';
        
        // 计算距离
        const warehouseCity = gameState.getWarehouseCity();
        const buyerCity = order.buyerCityId || 'shanghai';
        const distance = getCityDistance(warehouseCity, buyerCity);
        const warehouseInfo = getCityInfo(warehouseCity);
        const buyerInfo = getCityInfo(buyerCity);
        
        let feeInfo = '';
        {
            const bd = this._getOrderCostBreakdown(order);
            const profitColor = bd.profit >= 0 ? '#4caf50' : '#f44336';
            feeInfo = `
                <div style="margin-bottom:15px;padding:10px;background:#fafafa;border-radius:8px;">
                    <div style="font-size:12px;color:#666;margin-bottom:6px;">发货费用明细
                        <a href="javascript:void(0)" style="float:right;color:#1976d2;font-size:11px;" onclick="ui.closeModal();ui.showOrderDetail('${order.id}')">查看完整详情 ›</a>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:12px;color:#666;margin-bottom:3px;">
                        <span>商品成本</span><span>¥${bd.goodsCost.toFixed(2)}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:12px;color:#666;margin-bottom:3px;">
                        <span>打包人工费</span><span>¥${bd.packFee.toFixed(2)}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:12px;color:#666;margin-bottom:3px;">
                        <span>包装用品</span><span>¥${bd.packagingCost.toFixed(2)}</span>
                    </div>
                    ${bd.autoBuyCost > 0 ? `<div style="display:flex;justify-content:space-between;font-size:12px;color:#ef6c00;margin-bottom:3px;">
                        <span>包装紧急采购</span><span>¥${bd.autoBuyCost.toFixed(2)}</span>
                    </div>` : ''}
                    <div style="display:flex;justify-content:space-between;font-size:12px;color:#666;">
                        <span>快递费</span><span>¥${bd.expressFee.toFixed(2)}</span>
                    </div>
                    <div style="border-top:1px dashed #ddd;margin-top:6px;padding-top:6px;display:flex;justify-content:space-between;">
                        <span style="font-size:12px;font-weight:bold;">成本合计</span>
                        <span style="font-size:13px;font-weight:bold;color:#ff6b35;">¥${bd.totalCost.toFixed(2)}</span>
                    </div>
                    <div style="border-top:1px dashed #ddd;margin-top:6px;padding-top:6px;display:flex;justify-content:space-between;">
                        <span style="font-size:12px;font-weight:bold;">订单利润</span>
                        <span style="font-size:13px;font-weight:bold;color:${profitColor};">¥${bd.profit.toFixed(2)}</span>
                    </div>
                </div>
            `;
        }
        
        let expressBadge = '';
        if (express) {
            expressBadge = `<span class="badge" style="background:${express.color};color:white;margin-left:8px;">${express.name}</span>`;
        }
        
        let lostWarning = '';
        if (isLost) {
            lostWarning = `
                <div style="margin-bottom:15px;padding:12px;background:#ffebee;border-radius:8px;border:1px solid #ffcdd2;">
                    <div style="font-size:13px;font-weight:bold;color:#c62828;margin-bottom:4px;">⚠️ 包裹丢失</div>
                    <div style="font-size:12px;color:#e57373;line-height:1.5;">
                        该包裹在运输途中丢失，已按快递服务条款进行赔付。
                    </div>
                </div>
            `;
        }

        const content = `
            ${lostWarning}
            <div style="margin-bottom:15px;padding:10px;background:#f0f4ff;border-radius:8px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                    <div style="text-align:center;flex:1;">
                        <div style="font-size:11px;color:#999;">发货地</div>
                        <div style="font-size:13px;font-weight:bold;color:#333;">${warehouseInfo.name}</div>
                    </div>
                    <div style="text-align:center;padding:0 10px;">
                        <div style="font-size:16px;">📦</div>
                        <div style="font-size:10px;color:#667eea;">${distance}km</div>
                    </div>
                    <div style="text-align:center;flex:1;">
                        <div style="font-size:11px;color:#999;">收货地</div>
                        <div style="font-size:13px;font-weight:bold;color:#333;">${buyerInfo.name}</div>
                    </div>
                </div>
                ${order.packageWeightKg ? `<div style="text-align:center;font-size:11px;color:#999;">包裹重量: ${order.packageWeightKg.toFixed(2)}kg</div>` : ''}
            </div>
            <div style="margin-bottom:15px;">
                <div style="font-size:13px;color:#666;margin-bottom:4px;">快递服务${expressBadge}</div>
                <div style="font-size:14px;font-weight:bold;">${order.logistics.company}</div>
            </div>
            <div style="margin-bottom:15px;">
                <div style="font-size:13px;color:#666;margin-bottom:4px;">物流单号</div>
                <div style="font-size:14px;font-weight:bold;">${order.logistics.trackingNumber}</div>
            </div>
            ${feeInfo}
            <div style="font-size:13px;color:#666;margin-bottom:8px;">物流轨迹</div>
            <div class="logistics-timeline">
                ${[...updates].reverse().map((u, idx) => `
                    <div class="logistics-item ${idx === 0 ? 'active' : ''}" style="${u.status === '包裹丢失' ? 'color:#f44336;' : ''}">
                        <div class="status">${u.status}</div>
                        <div class="time">${u.time}</div>
                        <div class="location">${u.location}</div>
                    </div>
                `).join('')}
            </div>
        `;

        const footer = `
            <button class="btn btn-primary btn-block" onclick="ui.closeModal()">确定</button>
        `;

        this.showModal('物流详情', content, footer);
    }

    showReview(orderId) {
        const order = gameState.state.orders.find(o => o.id === orderId);
        if (!order || !order.review) return;

        const stars = '⭐'.repeat(Math.floor(order.review.rating)) + '☆'.repeat(5 - Math.floor(order.review.rating));
        
        const content = `
            <div style="text-align:center;padding:10px 0;">
                <div style="font-size:24px;">${stars}</div>
                <div style="font-size:16px;font-weight:bold;margin-top:8px;">${order.review.rating}分</div>
            </div>
            <div style="background:#fafafa;padding:15px;border-radius:8px;">
                <div style="font-size:14px;color:#333;line-height:1.6;">"${order.review.content}"</div>
            </div>
            <div style="font-size:12px;color:#999;text-align:right;margin-top:8px;">
                —— ${order.buyerName} 第${order.review.day}天
            </div>
        `;

        const footer = `
            <button class="btn btn-primary btn-block" onclick="ui.closeModal()">知道了</button>
        `;

        this.showModal('买家评价', content, footer);
    }

    showRatingDetail(filter = 'all') {
        const stats = gameState.getRatingStats();
        this._ratingFilter = filter;

        const content = this.getRatingDetailContent(stats, filter);
        const footer = `
            <button class="btn btn-primary btn-block" onclick="ui.closeModal()">关闭</button>
        `;

        this.showModal('查看评价详情', content, footer, { modalId: 'ratingDetailModal' });
    }

    /** 单个上架商品的评价详情 */
    showListingReviews(listingId) {
        const listing = (gameState.state.listings || []).find(l => l.id === listingId);
        if (!listing) {
            this.showToast('商品不存在');
            return;
        }
        const reviews = Array.isArray(listing.reviews) ? listing.reviews.slice().sort((a, b) => (b.day || 0) - (a.day || 0)) : [];
        const avg = (typeof listing.rating === 'number' && !isNaN(listing.rating))
            ? Number(listing.rating)
            : (reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 5);
        const stars = (n) => '★'.repeat(Math.max(0, Math.min(5, Math.floor(n)))) + '☆'.repeat(5 - Math.max(0, Math.min(5, Math.floor(n))));
        const listHtml = reviews.length === 0
            ? `<div style="text-align:center;color:#999;padding:24px 0;">暂无文字评价（默认 ${avg.toFixed(1)} 分）</div>`
            : reviews.slice(0, 30).map(r => `
                <div style="padding:10px 0;border-bottom:1px solid #f0f0f0;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span style="color:#ff9800;">${stars(r.rating || 0)}</span>
                        <span style="font-size:11px;color:#999;">第${r.day || '?'}天</span>
                    </div>
                    <div style="margin-top:6px;font-size:13px;color:#333;line-height:1.5;">"${r.content || '默认好评'}"</div>
                </div>`).join('');
        const content = `
            <div style="padding:4px 0;">
                <div style="text-align:center;margin-bottom:12px;">
                    <div style="font-size:28px;font-weight:800;color:#ff9800;">${avg.toFixed(1)}</div>
                    <div style="color:#ff9800;font-size:18px;">${stars(avg)}</div>
                    <div style="font-size:12px;color:#888;margin-top:4px;">${listing.title || '商品'} · 共 ${reviews.length} 条</div>
                </div>
                <div style="max-height:360px;overflow:auto;">${listHtml}</div>
                <button class="btn btn-secondary btn-block" style="margin-top:12px;" onclick="ui.closeModal();ui.showRatingDetail()">查看店铺全部评价</button>
            </div>`;
        this.showModal('查看评价详情', content, `<button class="btn btn-primary btn-block" onclick="ui.closeModal()">关闭</button>`, { width: '520px' });
    }

    getRatingDetailContent(stats, filter) {
        const dist = stats.distribution;
        const total = stats.total || 1;

        const renderStars = (rating, size = 'normal') => {
            const full = '★'.repeat(Math.floor(rating));
            const empty = '☆'.repeat(5 - Math.floor(rating));
            const sizeClass = size === 'small' ? 'font-size:14px;' : 'font-size:20px;';
            return `<span style="color:#ff9800;${sizeClass}">${full}${empty}</span>`;
        };

        let reviewList = [];
        if (filter === 'all') {
            reviewList = stats.reviews.slice().sort((a, b) => b.review.day - a.review.day);
        } else if (filter === 'bad') {
            reviewList = gameState.getReviewsByRating(1, 2);
        } else if (filter === 'mid') {
            reviewList = gameState.getReviewsByRating(3, 3);
        } else if (filter === 'good') {
            reviewList = gameState.getReviewsByRating(4, 5);
        } else {
            const star = parseInt(filter);
            reviewList = gameState.getReviewsByRating(star, star);
        }

        const reviewListHtml = reviewList.length === 0 ? `
            <div class="rating-empty">
                <div style="font-size:40px;">📝</div>
                <div style="color:#999;margin-top:8px;">暂无评价</div>
            </div>
        ` : reviewList.slice(0, 20).map(order => {
            const rating = order.review.rating;
            const isBad = rating <= 2;
            const listing = gameState.state.listings.find(l => l.id === order.listingId);
            const productName = order.productName || (listing ? listing.name : '商品');
            return `
                <div class="review-item ${isBad ? 'review-bad' : ''}">
                    <div class="review-item-header">
                        <div class="review-user">
                            <div class="review-avatar">${order.buyerName ? order.buyerName.charAt(0) : '买'}</div>
                            <div>
                                <div class="review-username">${order.buyerName || '匿名买家'}</div>
                                <div class="review-time">第${order.review.day}天 · ${productName}</div>
                            </div>
                        </div>
                        <div class="review-rating">${renderStars(rating, 'small')}</div>
                    </div>
                    <div class="review-content">"${order.review.content}"</div>
                    ${isBad && !order.review.responded ? `
                        <div style="display:flex;gap:6px;margin-top:8px;">
                            <button class="btn btn-secondary btn-small" onclick="ui.respondToReview('${order.id}', 'apologize')">🙏 道歉安抚 ¥300</button>
                            <button class="btn btn-secondary btn-small" onclick="ui.respondToReview('${order.id}', 'appeal')">⚖️ 正式申诉 ¥800</button>
                        </div>` : (order.review.responded ? `
                        <div style="font-size:11px;color:#2e7d32;margin-top:8px;padding:6px 8px;background:#e8f5e9;border-radius:6px;">✅ 商家已回复：${order.review.response || ''}</div>` : '')}
                </div>
            `;
        }).join('');

        return `
            <div class="rating-detail">
                <div class="rating-overview">
                    <div class="rating-score">
                        <div class="rating-score-num">${stats.averageRating.toFixed(1)}</div>
                        <div class="rating-stars-big">${renderStars(stats.averageRating)}</div>
                        <div class="rating-total">共 ${stats.total} 条评价</div>
                    </div>
                    <div class="rating-distribution">
                        ${[5, 4, 3, 2, 1].map(star => `
                            <div class="rating-bar-row" onclick="ui.filterRating('${star}')">
                                <span class="rating-bar-label">${star}星</span>
                                <div class="rating-bar-container">
                                    <div class="rating-bar-fill" style="width: ${((dist[star] || 0) / total * 100).toFixed(1)}%"></div>
                                </div>
                                <span class="rating-bar-count">${dist[star] || 0}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <div class="rating-summary">
                    <div class="rating-summary-item">
                        <div class="rating-summary-count" style="color:#4caf50;">${stats.goodCount}</div>
                        <div class="rating-summary-label">好评</div>
                    </div>
                    <div class="rating-summary-item">
                        <div class="rating-summary-count" style="color:#ff9800;">${stats.midCount}</div>
                        <div class="rating-summary-label">中评</div>
                    </div>
                    <div class="rating-summary-item">
                        <div class="rating-summary-count" style="color:#f44336;">${stats.badCount}</div>
                        <div class="rating-summary-label">差评</div>
                    </div>
                    <div class="rating-summary-item">
                        <div class="rating-summary-count" style="color:#2196f3;">${stats.goodRate}%</div>
                        <div class="rating-summary-label">好评率</div>
                    </div>
                </div>

                <div class="rating-filter-tabs">
                    <div class="rating-filter-tab ${filter === 'all' ? 'active' : ''}" onclick="ui.filterRating('all')">全部</div>
                    <div class="rating-filter-tab ${filter === 'good' ? 'active' : ''}" onclick="ui.filterRating('good')">好评</div>
                    <div class="rating-filter-tab ${filter === 'mid' ? 'active' : ''}" onclick="ui.filterRating('mid')">中评</div>
                    <div class="rating-filter-tab ${filter === 'bad' ? 'active' : ''}" onclick="ui.filterRating('bad')">差评</div>
                </div>

                <div class="rating-reviews-list">
                    ${reviewListHtml}
                </div>
            </div>
        `;
    }

    filterRating(filter) {
        this._ratingFilter = filter;
        const stats = gameState.getRatingStats();
        const content = this.getRatingDetailContent(stats, filter);

        // 弹窗 overlay 的 id 为 ratingDetailModal（showModal 会把 modalId 写入 overlay.id）
        let modalBody = document.querySelector('#ratingDetailModal .modal-body');
        if (!modalBody) {
            // 兜底：旧版/无 id 场景下取最后一个打开的弹窗
            modalBody = document.querySelector('.modal-overlay:last-of-type .modal-body')
                || document.querySelector('.modal-overlay .modal-body');
        }
        if (modalBody) {
            modalBody.innerHTML = content;
        } else {
            // 弹窗 DOM 丢失：按当前筛选重建详情弹窗（保留筛选状态）
            this.showRatingDetail(this._ratingFilter || 'all');
        }
    }

    respondToReview(orderId, type) {
        const r = gameState.respondToReview(orderId, type);
        if (r && r.success) {
            this.showToast(r.message);
            // 刷新评价详情
            this.showRatingDetail(this._ratingFilter || 'all');
        } else {
            this.showToast((r && r.message) || '处理失败');
        }
    }

    replyConsultation(consultationId) {
        const consultation = gameState.state.customerService.consultations
            .find(c => c.id === consultationId);
        if (!consultation || consultation.status === 'replied') return;

        const quickReplies = [
            '亲，有货的哦，现在下单马上发~',
            '亲，我们一般24小时内发货~',
            '亲，已经是最低价了呢~',
            '亲，质量保证的，请放心购买~',
            '亲，支持七天无理由退换哦~',
            '亲，默认发圆通/中通快递~'
        ];

        const content = `
            <div style="font-size:13px;color:#666;margin-bottom:8px;">买家问题:</div>
            <div style="background:#f5f5f5;padding:12px;border-radius:8px;margin-bottom:15px;">
                <div style="font-size:14px;">${consultation.question}</div>
                <div style="font-size:12px;color:#999;margin-top:4px;">
                    关于: ${consultation.productName}
                </div>
            </div>
            <div style="font-size:13px;color:#666;margin-bottom:8px;">快捷回复:</div>
            <div style="display:grid;grid-template-columns:1fr;gap:8px;">
                ${quickReplies.map((r, i) => `
                    <button class="btn btn-secondary btn-small" style="text-align:left;"
                            onclick="ui.sendQuickReply('${consultationId}', ${i})">
                        ${r}
                    </button>
                `).join('')}
            </div>
        `;

        this.showModal('回复咨询', content);
    }

    sendQuickReply(consultationId, replyIndex) {
        const consultation = gameState.state.customerService.consultations
            .find(c => c.id === consultationId);
        if (!consultation) return;

        consultation.status = 'replied';
        consultation.reply = replyIndex;
        consultation.replyTime = { ...gameState.state.gameTime };
        
        gameState.addReputation(1);
        this.closeModal();
        this.showToast('回复成功 +1信誉');
    }

    approveReturn(returnId) {
        const returnItem = gameState.state.customerService.returns.find(r => r.id === returnId);
        if (!returnItem || returnItem.status !== 'pending') return;

        returnItem.status = 'approved';
        
        const order = gameState.state.orders.find(o => o.id === returnItem.orderId);
        if (order) {
            gameState.updateOrderStatus(returnItem.orderId, 'returned');
        }

        // ============= 通过 spendFunds 统一退款（支持欠款机制）=============
        // 注意：即使店铺暂时没钱，也必须履行退款承诺（进入欠款状态），不能出现"同意退款但钱没退"的逻辑bug
        if (returnItem.amount > 0) {
            const ok = gameState.spendFunds(returnItem.amount, `退货退款 - ${returnItem.productName}`);
            if (!ok) {
                // 超过欠款上限：提示用户（但退货状态已保持approved保证数据一致）
                this.showToast('⚠️ 已同意退货，但退款因达到欠款上限暂时挂账，请尽快补货清偿后系统自动处理');
            }
        }

        gameState.state.statistics.totalReturns++;
        gameState.addReputation(-2);
        
        this.showToast('已同意退货 -2信誉');
    }

    rejectReturn(returnId) {
        const returnItem = gameState.state.customerService.returns.find(r => r.id === returnId);
        if (!returnItem || returnItem.status !== 'pending') return;

        returnItem.status = 'rejected';

        if (Math.random() < 0.4) {
            gameState.addDispute({
                orderId: returnItem.orderId,
                reason: returnItem.reason,
                amount: returnItem.amount
            });
            gameState.addReputation(-5);
            this.showToast('买家提起纠纷 -5信誉');
        } else {
            this.showToast('已拒绝退货');
        }
    }

    showCampaignModal(campaignType) {
        const mType = MARKETING_TYPES[campaignType];
        if (!mType) return;
        const agency = (typeof gameState !== 'undefined' && gameState.getAdAgencyConfig)
            ? gameState.getAdAgencyConfig()
            : (typeof AD_AGENCY !== 'undefined' ? AD_AGENCY : { name: '星云广告公司', mediaCommissionRate: 0.02 });
        const agencyPct = Math.round((agency.mediaCommissionRate || 0.02) * 100);
        const agencyTip = `
            <div style="background:#eef5ff;padding:10px;border-radius:6px;margin-top:10px;font-size:12px;color:#1565c0;line-height:1.5;">
                📢 ${agency.name || '广告公司'}代投：媒体费另加 <b>${agencyPct}%</b> 服务费<br>
                推广带来的订单签收后，按成交额抽成 <b>${mType.commission ? Math.round(mType.commission * 100) : 5}%</b>
            </div>`;

        let content = '';
        if (mType.type === 'cpc') {
            content = `
                <div style="margin-bottom:15px;">
                    <div style="font-size:14px;color:#666;line-height:1.6;">
                        ${mType.description}
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">单次点击出价 (元)</label>
                    <input type="number" class="form-input" id="campaignBid" value="${mType.basePrice}" step="0.1" min="0.5">
                </div>
                <div class="form-group">
                    <label class="form-label">每日媒体预算 (元)</label>
                    <input type="number" class="form-input" id="campaignBudget" value="100" min="10">
                </div>
                <div class="form-group">
                    <label class="form-label">推广天数</label>
                    <input type="number" class="form-input" id="campaignDays" value="7" min="1" max="30">
                </div>
                ${agencyTip}
            `;
        } else if (mType.type === 'cpm') {
            const mediaEst = mType.basePrice * 10;
            const agencyEst = Math.round(mediaEst * (agency.mediaCommissionRate || 0.02) * 100) / 100;
            content = `
                <div style="margin-bottom:15px;">
                    <div style="font-size:14px;color:#666;line-height:1.6;">
                        ${mType.description}
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">展示次数 (千次)</label>
                    <input type="number" class="form-input" id="campaignViews" value="10" min="1">
                </div>
                <div class="form-group">
                    <label class="form-label">推广天数</label>
                    <input type="number" class="form-input" id="campaignDays" value="7" min="1" max="30">
                </div>
                <div style="background:#fff8e1;padding:10px;border-radius:6px;">
                    <div style="font-size:13px;color:#f57c00;">
                        媒体费约 ¥${mediaEst} + 广告公司 ¥${agencyEst} ≈ ¥${mediaEst + agencyEst}
                    </div>
                </div>
                ${agencyTip}
            `;
        } else {
            const agencyEst = Math.round(mType.basePrice * (agency.mediaCommissionRate || 0.02) * 100) / 100;
            content = `
                <div style="margin-bottom:15px;">
                    <div style="font-size:14px;color:#666;line-height:1.6;">
                        ${mType.description}
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">活动天数</label>
                    <input type="number" class="form-input" id="campaignDays" value="7" min="1" max="30">
                </div>
                <div style="background:#fff8e1;padding:10px;border-radius:6px;">
                    <div style="font-size:13px;color:#f57c00;line-height:1.5;">
                        入场费 ¥${mType.basePrice} + 广告公司 ¥${agencyEst}<br>
                        另：成交抽成 ${(mType.commission || 0) * 100}%（签收后从实收扣除）
                    </div>
                </div>
                ${agencyTip}
            `;
        }

        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>
            <button class="btn btn-primary" onclick="ui.confirmCampaign('${campaignType}')">开启推广</button>
        `;

        this.showModal(mType.name, content, footer);
    }

    confirmCampaign(campaignType) {
        const mType = MARKETING_TYPES[campaignType];
        const already = (gameState.state.marketing.activeCampaigns || [])
            .some(c => c.status === 'active' && c.type === campaignType);
        if (already) {
            this.showToast('该渠道已在投放中，请先停止或等到期');
            return;
        }
        const days = parseInt(document.getElementById('campaignDays')?.value || 7);
        
        let cost = 0;
        let campaign = { type: campaignType, endDay: gameState.state.gameTime.day + days };

        if (mType.type === 'cpc') {
            // CPC 按点击从日预算扣费，开户不预扣全额（避免与 handleMarketingCost 双重扣款）
            campaign.bidPrice = parseFloat(document.getElementById('campaignBid').value);
            campaign.dailyBudget = parseFloat(document.getElementById('campaignBudget').value);
            campaign.spentToday = 0;
            campaign._budgetDay = gameState.state.gameTime.day;
            cost = 0;
        } else if (mType.type === 'cpm') {
            campaign.views = parseInt(document.getElementById('campaignViews').value);
            cost = mType.basePrice * campaign.views;
        } else {
            cost = mType.basePrice;
        }

        if (cost > 0) {
            const charged = (typeof gameState.chargeMarketingSpend === 'function')
                ? gameState.chargeMarketingSpend(cost, `营销推广 - ${mType.name}`)
                : { ok: gameState.spendFunds(cost, `营销推广 - ${mType.name}`), agencyFee: 0 };
            if (!charged.ok) {
                this.showToast('资金不足（含广告公司服务费）！');
                return;
            }
        }

        gameState.addCampaign(campaign);
        this.closeModal();
        const agency = gameState.getAdAgencyConfig ? gameState.getAdAgencyConfig() : null;
        const pct = agency ? Math.round((agency.mediaCommissionRate || 0.02) * 100) : 2;
        const takePct = mType.commission ? Math.round(mType.commission * 100) : 5;
        this.showToast(mType.type === 'cpc'
            ? `${mType.name}已开启！点击扣费 + 广告公司${pct}% + 成交抽成${takePct}%`
            : `${mType.name}已开启！成交抽成 ${takePct}%（签收后扣）`);
    }

    showEndorsementModal(celebrityId) {
        const celebrity = CELEBRITIES.find(c => c.id === celebrityId);
        if (!celebrity) return;
        const shopLv = (gameState.state && gameState.state.shop && gameState.state.shop.level) || 1;
        if (shopLv < (celebrity.unlockLevel || 1)) {
            this.showToast(`需店铺 Lv.${celebrity.unlockLevel} 才能签约 ${celebrity.name}`);
            return;
        }

        const content = `
            <div style="text-align:center;padding:15px 0;">
                <div style="width:80px;height:80px;border-radius:50%;
                            background:linear-gradient(135deg,#667eea,#764ba2);
                            display:flex;align-items:center;justify-content:center;
                            font-size:36px;margin:0 auto;">
                    ⭐
                </div>
                <div style="font-size:18px;font-weight:bold;margin-top:10px;">${celebrity.name}</div>
                <div style="font-size:13px;color:#999;margin-top:4px;">粉丝: ${celebrity.fans}</div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:15px;">
                <div style="text-align:center;padding:10px;background:#f5f5f5;border-radius:8px;">
                    <div style="font-size:16px;font-weight:bold;color:#4caf50;">
                        +${((celebrity.exposureEffect - 1) * 100).toFixed(0)}%
                    </div>
                    <div style="font-size:11px;color:#999;">曝光提升</div>
                </div>
                <div style="text-align:center;padding:10px;background:#f5f5f5;border-radius:8px;">
                    <div style="font-size:16px;font-weight:bold;color:#ff9800;">
                        +${((celebrity.conversionBoost - 1) * 100).toFixed(0)}%
                    </div>
                    <div style="font-size:11px;color:#999;">转化提升</div>
                </div>
            </div>
            <div class="form-group">
                <label class="form-label">代言时长</label>
                <select class="form-select" id="endorseDays">
                    <option value="7">7天 - ¥${(celebrity.fee * 7 / 30).toFixed(0)}</option>
                    <option value="30" selected>30天 - ¥${celebrity.fee.toLocaleString()}</option>
                    <option value="90">90天 - ¥${(celebrity.fee * 2.5).toFixed(0)}</option>
                </select>
            </div>
            <div style="background:#fff8e1;padding:10px;border-radius:6px;text-align:center;">
                <div style="font-size:13px;color:#f57c00;">
                    代言费用: <span id="endorseFee" style="font-size:18px;font-weight:bold;">¥${celebrity.fee.toLocaleString()}</span>
                </div>
                <div style="font-size:11px;color:#ef6c00;margin-top:6px;">
                    另付广告公司经纪费约 ${Math.round((((typeof AD_AGENCY !== 'undefined' ? AD_AGENCY.endorsementCommissionRate : 0.1) || 0.1) * 100))}%
                </div>
            </div>
        `;

        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>
            <button class="btn btn-primary" onclick="ui.confirmEndorsement('${celebrityId}')">签约代言</button>
        `;

        this.showModal('明星代言', content, footer);

        window._currentCelebrity = celebrity;
        
        setTimeout(() => {
            const select = document.getElementById('endorseDays');
            if (select) {
                select.addEventListener('change', (e) => {
                    const days = parseInt(e.target.value);
                    let fee;
                    if (days === 7) fee = celebrity.fee * 7 / 30;
                    else if (days === 30) fee = celebrity.fee;
                    else fee = celebrity.fee * 2.5;
                    document.getElementById('endorseFee').textContent = `¥${fee.toFixed(0)}`;
                });
            }
        }, 100);
    }

    confirmEndorsement(celebrityId) {
        const celebrity = CELEBRITIES.find(c => c.id === celebrityId);
        if (!celebrity) return;
        const shopLv = (gameState.state && gameState.state.shop && gameState.state.shop.level) || 1;
        if (shopLv < (celebrity.unlockLevel || 1)) {
            this.showToast(`需店铺 Lv.${celebrity.unlockLevel} 才能签约 ${celebrity.name}`);
            return;
        }
        const days = parseInt(document.getElementById('endorseDays').value);
        
        let fee;
        if (days === 7) fee = celebrity.fee * 7 / 30;
        else if (days === 30) fee = celebrity.fee;
        else fee = celebrity.fee * 2.5;

        const agency = gameState.getAdAgencyConfig ? gameState.getAdAgencyConfig() : { endorsementCommissionRate: 0.1, name: '星云广告公司' };
        const charged = (typeof gameState.chargeMarketingSpend === 'function')
            ? gameState.chargeMarketingSpend(fee, `明星代言 - ${celebrity.name}`, {
                rate: agency.endorsementCommissionRate != null ? agency.endorsementCommissionRate : 0.1
            })
            : { ok: gameState.spendFunds(fee, `明星代言 - ${celebrity.name}`), agencyFee: 0 };
        if (!charged.ok) {
            this.showToast('资金不足（含广告公司经纪费）！');
            return;
        }

        gameState.addCelebrityEndorsement({
            celebrityId: celebrityId,
            endDay: gameState.state.gameTime.day + days,
            fee: fee,
            agencyFee: charged.agencyFee || 0
        });

        this.closeModal();
        this.showToast(`已签约 ${celebrity.name}！${charged.agencyFee ? '（含广告公司经纪费）' : ''}`);
    }

    showHireEmployeeModal() {
        // ===== 员工管理V2：转发到新员工管理界面的招聘 Tab =====
        try {
            if (typeof window !== 'undefined' && window.empUI && typeof empUI.showMain === 'function') {
                empUI.showMain('hire');
                return;
            }
        } catch (_) {}
        this._showHireEmployeeModalLegacy();
    }

    _showHireEmployeeModalLegacy() {
        const cityId = gameState.state.shop.city || gameState.state.warehouse?.city || 'yiwu';
        const cityInfo = getCityById(cityId);
        const salaryDiscount = getCitySalaryDiscount(cityId);
        const batchHint = '可点「×5 / ×10」一次招多人';
        
        const content = `
            <div style="font-size:12px;color:#666;margin-bottom:12px;text-align:center;">
                当前城市：${cityInfo?.name || '义乌'} · 
                ${salaryDiscount > 0 ? '工资水平低于全国平均' : salaryDiscount < 0 ? '工资水平高于全国平均' : '工资水平与全国持平'}
                <div style="margin-top:4px;color:#888;">${batchHint}</div>
            </div>
            <div style="font-size:13px;color:#666;margin-bottom:10px;">
                选择要招聘的员工类型
            </div>
            ${Object.entries(EMPLOYEE_TYPES).map(([key, type]) => {
                const fulltimeSalary = Math.round(type.baseSalary * EMPLOYMENT_TYPES.fulltime.salaryMultiplier * (1 - salaryDiscount));
                const parttimeSalary = Math.round(type.baseSalary * EMPLOYMENT_TYPES.parttime.salaryMultiplier * (1 - salaryDiscount));
                const batchBtns = (empType, monthly) => [5, 10].map(n => `
                    <button class="btn btn-xs btn-secondary" style="padding:4px 8px;font-size:11px;"
                        onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                        onclick="ui.hireEmployeeBatch('${key}','${empType}',${n})"
                        title="约 ¥${(monthly * n).toLocaleString()}/月人力成本">×${n}</button>
                `).join('');
                return `
                <div style="padding:12px 0;border-bottom:1px solid #f0f0f0;">
                    <div style="display:flex;gap:12px;align-items:flex-start;">
                        <div style="width:44px;height:44px;border-radius:10px;background:#f5f5f5;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">
                            ${type.icon}
                        </div>
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:15px;font-weight:bold;color:#333;">${type.name}</div>
                            <div style="font-size:11px;color:#999;margin-top:2px;line-height:1.4;">${type.description}</div>
                            <div style="display:flex;gap:8px;margin-top:10px;">
                                <div style="flex:1;padding:10px 8px;border-radius:8px;background:#e8f5e9;text-align:center;user-select:none;">
                                    <div style="font-size:12px;color:#2e7d32;font-weight:bold;cursor:pointer;"
                                         onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                                         onclick="ui.hireEmployee('${key}', 'fulltime')">全职 · ¥${fulltimeSalary}/月</div>
                                    <div style="font-size:10px;color:#4caf50;margin:4px 0 6px;">效率100% · 点上可招1人</div>
                                    <div style="display:flex;gap:4px;justify-content:center;flex-wrap:wrap;">${batchBtns('fulltime', fulltimeSalary)}</div>
                                </div>
                                <div style="flex:1;padding:10px 8px;border-radius:8px;background:#fff3e0;text-align:center;user-select:none;">
                                    <div style="font-size:12px;color:#e65100;font-weight:bold;cursor:pointer;"
                                         onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                                         onclick="ui.hireEmployee('${key}', 'parttime')">兼职 · ¥${parttimeSalary}/月</div>
                                    <div style="font-size:10px;color:#ff9800;margin:4px 0 6px;">效率65% · 点上可招1人</div>
                                    <div style="display:flex;gap:4px;justify-content:center;flex-wrap:wrap;">${batchBtns('parttime', parttimeSalary)}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            }).join('')}
        `;

        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>
        `;

        this.showModal('招聘员工', content, footer);
    }

    hireEmployee(typeId, employmentType = 'fulltime') {
        const typeInfo = EMPLOYEE_TYPES[typeId];
        const empTypeInfo = EMPLOYMENT_TYPES[employmentType];
        if (!typeInfo || !empTypeInfo) return;

        const result = gameState.hireEmployee(typeId, employmentType);
        if (result.success) {
            this.closeModal();
            this.showToast(`成功招聘${empTypeInfo.name}${typeInfo.name}！`);
            try { this._renderEmployeeManager(); } catch (_) {}
            try { this.forceRender(); } catch (_) {}
        } else {
            this.showToast(result.message || '招聘失败');
        }
    }

    hireEmployeeBatch(typeId, employmentType = 'fulltime', count = 5) {
        const typeInfo = EMPLOYEE_TYPES[typeId];
        const empTypeInfo = EMPLOYMENT_TYPES[employmentType];
        if (!typeInfo || !empTypeInfo) return;
        const n = Math.max(1, Math.min(50, Number(count) || 5));
        const cityId = gameState.state.shop.city || gameState.state.warehouse?.city || 'yiwu';
        const salaryDiscount = getCitySalaryDiscount(cityId);
        const monthly = Math.round(typeInfo.baseSalary * empTypeInfo.salaryMultiplier * (1 - salaryDiscount));
        const est = monthly * n;
        if (!confirm(`确认批量招聘 ${n} 名${empTypeInfo.name}${typeInfo.name}？\n预计月人力成本约 ¥${est.toLocaleString()}（不含社保等）。`)) {
            return;
        }
        const result = gameState.hireEmployeeBatch(typeId, employmentType, n);
        if (result && result.success) {
            this.closeModal();
            this.showToast(result.message || `已招聘 ${result.hired} 人`);
            try { this._renderEmployeeManager(); } catch (_) {}
            try { this.forceRender(); } catch (_) {}
        } else {
            this.showToast((result && result.message) || '批量招聘失败');
        }
    }

    fireEmployee(employeeId) {
        if (!confirm('确定要解雇这名员工吗？')) return;

        const result = gameState.fireEmployee(employeeId);
        if (result.success) {
            this.showToast('已解雇员工');
            try { this._renderEmployeeManager(); } catch (_) {}
            try { this.forceRender(); } catch (_) {}
        } else {
            this.showToast(result.message || '解雇失败');
        }
    }
    
    upgradeEmployee(employeeId) {
        const result = gameState.upgradeEmployee(employeeId);
        if (result.success) {
            this.showToast(result.levels > 0
                ? `🎓 培训成功！员工已升至 Lv.${result.newLevel}`
                : '✨ 已为员工补充经验');
        } else {
            this.showToast(result.message || '升级失败');
        }
    }

    // 单员工一键升级
    upgradeEmployeeOneKey(employeeId) {
        const result = gameState.upgradeEmployeeOneKey(employeeId);
        this.showToast(result.message || (result.success ? '✅ 升级成功' : '❌ 升级失败'));
        if (result && result.success) {
            try { this._renderEmployeeManager(); } catch (_) {}
        }
    }

    // 全员工批量升级（一键升级）
    upgradeEmployeeBatchAll() {
        const active = (gameState.state.employees || []).filter(e => e && e.status === 'active');
        if (!active.length) { this.showToast('暂无员工，先招聘～'); return; }
        const confirmRes = confirm(`确认一键升级？\n将为 ${active.length} 名在职员工自动升到资金可支持的最高等级。`);
        if (!confirmRes) return;
        const result = gameState.upgradeEmployeeBatchAll();
        this.showToast(result.message || (result.success ? '✅ 一键升级完成' : '❌ 升级失败'));
        if (result && result.success) {
            try { this._renderEmployeeManager(); } catch (_) {}
            try { this.forceRender(); } catch (_) {}
        }
    }

    // 一键裁员（批量解雇全部在职员工，宿舍床位同步释放）
    fireEmployeeBatchAll() {
        const active = (gameState.state.employees || []).filter(e => e && e.status === 'active');
        if (!active.length) { this.showToast('暂无在职员工'); return; }
        const confirmRes = confirm(`确认一键裁员？\n将解雇全部 ${active.length} 名在职员工（宿舍床位同步释放）。`);
        if (!confirmRes) return;
        const result = gameState.fireEmployeeBatchAll();
        this.showToast(result.message || (result.success ? '✅ 一键裁员完成' : '❌ 裁员失败'));
        if (result && result.success) {
            try { this._renderEmployeeManager(); } catch (_) {}
            try { this.forceRender(); } catch (_) {}
        }
    }

    // 员工福利体系展示模态框
    showWelfareSystemModal() {
        const welfareList = (typeof EMPLOYEE_WELFARE_CONFIG !== 'undefined') ? EMPLOYEE_WELFARE_CONFIG.filter(w => typeof w === 'object') : [];
        // 当前员工的福利分布统计
        const state = gameState.state;
        const empStats = {};
        (state.employees || []).forEach(emp => {
            const w = (EMPLOYEE_WELFARE_CONFIG.getLevel && EMPLOYEE_WELFARE_CONFIG.getLevel(emp)) || welfareList[0];
            empStats[w.level] = (empStats[w.level] || 0) + 1;
        });

        const content = `
            <div style="padding:4px 0;">
                <div style="background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border-radius:12px;padding:14px 16px;margin-bottom:12px;">
                    <div style="font-size:15px;font-weight:700;">🎁 员工福利等级体系</div>
                    <div style="font-size:12px;opacity:0.92;margin-top:4px;">员工达到 Lv/经验/在职天数 → 自动晋升对应档位 → 享受对应补贴</div>
                    <div style="font-size:11px;opacity:0.85;margin-top:6px;">当前：共 ${(state.employees||[]).length} 人 · ${welfareList.map(w=>`${w.icon}${empStats[w.level]||0}`).join(' · ')}</div>
                </div>
                <div style="display:flex;flex-direction:column;gap:10px;">
                    ${welfareList.map(w => `
                        <div style="border-radius:10px;padding:12px 14px;background:${w.bgColor};border:1px solid ${w.color}33;">
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                                <div style="font-size:14px;font-weight:700;color:${w.color};">
                                    ${w.icon} ${w.name}
                                    <span style="font-weight:400;font-size:11px;margin-left:6px;opacity:0.8;">
                                        需 Lv${w.minEmployeeLevel} · 累计Exp${w.minTotalExp} · 在职${w.minWorkDays}天
                                    </span>
                                </div>
                                <div style="font-size:11px;padding:2px 8px;border-radius:10px;background:${w.color};color:#fff;">
                                    ${empStats[w.level]||0} 人
                                </div>
                            </div>
                            <div style="font-size:11px;color:#555;margin-bottom:8px;">${w.description}</div>
                            <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px;">
                                ${w.benefits.map(b => `
                                    <div style="background:#ffffffcc;border-radius:6px;padding:5px 4px;text-align:center;">
                                        <div style="font-size:9px;color:#666;">${b.label}</div>
                                        <div style="font-size:11px;color:${w.color};font-weight:700;">${b.value}</div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>
                <div style="margin-top:14px;padding:10px 12px;background:#fff8e1;border-radius:8px;border-left:3px solid #ff9800;font-size:12px;color:#e65100;">
                    💡 <b>晋升说明</b>：系统会在每次渲染员工列表时，根据员工当前的Lv/累计经验/在职天数，自动匹配其对应的最高可享档位。
                    工资发薪日（每月）将自动叠加福利补贴发放。
                </div>
            </div>
        `;
        this.showModal('员工福利体系', content, '<button class="btn btn-primary" onclick="ui.closeModal()">我知道了</button>');
    }

    // ============================================================
    // 员工管理系统主界面
    // ============================================================

    showEmployeeManagerModal() {
        // ===== 员工管理V2：转发到新员工管理界面 =====
        try {
            if (typeof window !== 'undefined' && window.empUI && typeof empUI.showMain === 'function') {
                empUI.showMain('list');
                return;
            }
        } catch (_) {}
        this._employeeMgrTab = 'list';
        this._employeeFilter = { keyword: '', department: 'all', status: 'active' };
        this._selectedEmployeeId = null;
        try {
            this._renderEmployeeManager();
        } catch (e) {
            console.error('[showEmployeeManagerModal]', e);
            try { this.showToast('员工管理打开失败，已尝试兜底显示'); } catch (_) {}
            try {
                this.showModal('员工管理', `
                    <div style="padding:24px;text-align:center;color:#c62828;">
                        <div style="font-size:40px;margin-bottom:8px;">⚠️</div>
                        <div style="font-size:14px;margin-bottom:8px;">员工界面渲染异常</div>
                        <div style="font-size:12px;color:#666;">${escapeHtml(String(e && e.message || e))}</div>
                    </div>`,
                    '<button class="btn btn-primary" onclick="ui.closeModal()">关闭</button>');
            } catch (_) {}
        }
    }

    _renderEmployeeManager() {
        try {
        const state = gameState.state;
        // 精简界面：主入口只保留员工列表（薪酬/记录/奖金/宿舍逻辑保留，不暴露 Tab）
        this._employeeMgrTab = 'list';
        const employees = Array.isArray(state.employees) ? state.employees : [];
        
        // 顶部统计数据
        const activeEmps = employees.filter(e => e && e.status === 'active');
        let payrollPreview = { totals: { companyCost: 0, net: 0 } };
        try {
            payrollPreview = gameState.calculateAllPayroll() || payrollPreview;
        } catch (pe) {
            console.warn('[emp-mgr payroll]', pe);
        }
        const totalMonthlyCost = (payrollPreview.totals && payrollPreview.totals.companyCost) || 0;

        let content = `
            <div class="emp-mgr-container">
                <!-- 顶部汇总卡片 -->
                <div class="emp-summary-cards">
                    <div class="emp-summary-card" style="background:linear-gradient(135deg,#667eea,#764ba2);">
                        <div class="emp-summary-value">${activeEmps.length}</div>
                        <div class="emp-summary-label">在职员工</div>
                    </div>
                    <div class="emp-summary-card" style="background:linear-gradient(135deg,#f093fb,#f5576c);">
                        <div class="emp-summary-value">${formatMoney((payrollPreview.totals && payrollPreview.totals.net) || 0)}</div>
                        <div class="emp-summary-label">月实发工资</div>
                    </div>
                    <div class="emp-summary-card" style="background:linear-gradient(135deg,#4facfe,#00f2fe);">
                        <div class="emp-summary-value">${formatMoney(totalMonthlyCost)}</div>
                        <div class="emp-summary-label">月企业成本</div>
                    </div>
                </div>

                <!-- 内容区域：仅员工列表 -->
                <div class="emp-tab-content">
                    ${this._renderEmployeeListTab(state)}
                </div>
            </div>
        `;

        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>
            <button class="btn btn-secondary" style="background:linear-gradient(135deg,#43a047,#2e7d32);color:#fff;border:none;"
                onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                onclick="ui.upgradeEmployeeBatchAll()">🚀 一键升级</button>
            <button class="btn btn-secondary" style="background:linear-gradient(135deg,#e53935,#b71c1c);color:#fff;border:none;"
                onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                onclick="ui.fireEmployeeBatchAll()">🔪 一键裁员</button>
            <button class="btn btn-primary" onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()" onclick="ui.showHireEmployeeModal()">+ 招聘新员工</button>
        `;

        // showModal 同标题自动复用，避免叠多层
        return this.showModal('👥 员工管理', content, footer, {
            modalId: 'employeeManagerModal',
            modalClass: 'employee-manager-overlay'
        });
        } catch (e) {
            console.error('[_renderEmployeeManager]', e);
            try { this.showToast('员工管理渲染失败'); } catch (_) {}
            return this.showModal('👥 员工管理', `
                <div style="padding:28px;text-align:center;">
                    <div style="font-size:40px;margin-bottom:8px;">⚠️</div>
                    <div style="font-size:14px;color:#c62828;margin-bottom:6px;">渲染异常，请关闭后重试</div>
                    <div style="font-size:12px;color:#888;">${escapeHtml(String(e && e.message || e))}</div>
                </div>`,
                '<button class="btn btn-primary" onclick="ui.closeModal()">关闭</button>',
                { modalId: 'employeeManagerModal', modalClass: 'employee-manager-overlay' });
        }
    }

    _switchEmployeeTab(tabId) {
        // 高级 Tab 已隐藏，统一回到列表
        this._employeeMgrTab = 'list';
        this._renderEmployeeManager();
    }

    _renderEmployeeMgrTabContent(tab, state, payrollPreview) {
        // 主界面仅列表；其余渲染函数仍保留供发薪确认等流程内部复用
        switch (tab) {
            case 'list': return this._renderEmployeeListTab(state);
            case 'payroll': return this._renderPayrollTab(state, payrollPreview);
            case 'history': return this._renderPayrollHistoryTab(state);
            case 'config': return this._renderBonusConfigTab(state);
            case 'housing': return this._renderHousingTab(state);
            default: return this._renderEmployeeListTab(state);
        }
    }

    _renderHousingTab(state) {
        try {
            if (typeof gameState.cleanupHousingAssignments === 'function') {
                gameState.cleanupHousingAssignments();
            }
        } catch (_) {}
        const h = state.housing || { level: 0, beds: 0, buildings: [], assigned: {}, monthlyRentPerBed: 180, satisfaction: 60 };
        const active = (state.employees || []).filter(e => e && e.status === 'active');
        const occupied = (typeof gameState.getHousingOccupiedCount === 'function')
            ? gameState.getHousingOccupiedCount()
            : Object.keys(h.assigned || {}).filter(id => h.assigned[id] && active.some(e => String(e.id) === String(id))).length;
        const types = (typeof HOUSING_BUILDING_TYPES !== 'undefined') ? HOUSING_BUILDING_TYPES : [];
        const ownedList = (h.buildings || []).reduce((acc, b) => {
            acc[b.type] = (acc[b.type] || 0) + 1;
            return acc;
        }, {});
        return `
            <div style="font-size:13px;line-height:1.7;padding:4px;">
                <div style="padding:10px;background:#e8f5e9;border-radius:10px;margin-bottom:10px;">
                    已购 ${ (h.buildings || []).length } 栋 · 床位 ${occupied}/${h.beds || 0} · 满意度 ${h.satisfaction || 60}
                    <div style="font-size:11px;color:#666;">月租金约 ¥${h.monthlyRentPerBed || 180}/床（按入住人数扣，企业付）。人多了就再买一栋，没有 20 床上限。</div>
                </div>
                ${types.map(lv => `
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f0f0f0;gap:8px;">
                        <div><b>${lv.icon || ''} ${lv.name}</b>
                            <div style="font-size:11px;color:#888;">+${lv.beds}床 · 月租¥${lv.rent}/床 · 已购 ${ownedList[lv.id] || 0} 栋</div>
                        </div>
                        <button class="btn btn-primary btn-small"
                            onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                            onclick="event.stopPropagation();ui.buyHousingBuilding('${lv.id}')">购置 ¥${lv.cost.toLocaleString()}</button>
                    </div>`).join('')}
                <div style="margin-top:12px;padding:10px;background:#fff8e1;border-radius:10px;font-size:12px;color:#6d4c41;line-height:1.6;">
                    不用逐个分配。买楼或招聘后，<b>空床自动入住</b>。床位不够就再买，没排上的人暂住外面。
                </div>
                ${(h.beds || 0) <= 0
                    ? '<div style="color:#e65100;font-size:12px;margin:10px 0 0;">先升级宿舍，床位会自动分给在职员工。</div>'
                    : `<div style="margin-top:12px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
                        <div style="font-weight:700;">当前入住 ${occupied}/${h.beds || 0}${active.length > (h.beds || 0) ? ' · 床位不足 ' + (active.length - (h.beds || 0)) + ' 人未入住' : ''}</div>
                        <button class="btn btn-secondary btn-small"
                            onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                            onclick="event.stopPropagation();ui.rebalanceHousing()">按岗位重排</button>
                    </div>
                    <div style="margin-top:6px;">
                        ${active.filter(e => h.assigned && (h.assigned[e.id] || h.assigned[String(e.id)])).slice(0, 24).map(e =>
                            `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #f3f3f3;font-size:12px;">
                                <span>${escapeHtml(e.name)} · ${escapeHtml(e.position || '')}</span>
                                <span style="color:#2e7d32;">已入住</span>
                            </div>`
                        ).join('') || '<div style="color:#999;font-size:12px;">暂无入住</div>'}
                        ${occupied > 24 ? `<div style="color:#888;font-size:11px;padding-top:6px;">其余 ${occupied - 24} 人也已自动入住</div>` : ''}
                    </div>`}
            </div>`;
    }

    // ----- Tab1: 员工列表 -----
    _renderEmployeeListTab(state) {
        const filter = this._employeeFilter || { keyword: '', department: 'all', status: 'active' };
        let employees = [];
        try {
            employees = gameState.searchEmployees(filter.keyword, filter.department, filter.status) || [];
        } catch (e) {
            console.warn('[emp-list search]', e);
            employees = (state.employees || []).filter(e => e && (filter.status === 'all' || e.status === filter.status));
        }

        // 部门统计
        const deptCounts = {};
        (state.employees || []).forEach(e => {
            if (e && e.status === 'active') deptCounts[e.department] = (deptCounts[e.department] || 0) + 1;
        });

        // ===== 员工列表性能优化：限制渲染数量，避免后期人员众多时卡 =====
        const MAX_EMP_RENDER = 500;
        const totalEmps = employees.length;
        const hasMoreEmps = totalEmps > MAX_EMP_RENDER;
        if (hasMoreEmps) employees = employees.slice(0, MAX_EMP_RENDER);

        return `
            <!-- 搜索与筛选 -->
            <div class="emp-filter-bar">
                <div class="emp-search-box">
                    <span class="emp-search-icon">🔍</span>
                    <input type="text" class="emp-search-input" placeholder="搜索员工姓名/电话/岗位..." 
                           value="${filter.keyword}"
                           oninput="ui._onEmployeeSearch(this.value)" />
                </div>
                <div class="emp-dept-filter">
                    <select class="emp-select" onchange="ui._onEmployeeDeptFilter(this.value)">
                        <option value="all" ${filter.department === 'all' ? 'selected' : ''}>全部部门</option>
                        ${Object.values(DEPARTMENTS).map(d => `
                            <option value="${d.id}" ${filter.department === d.id ? 'selected' : ''}>${d.icon} ${d.name} (${deptCounts[d.id]||0})</option>
                        `).join('')}
                    </select>
                </div>
            </div>

            ${hasMoreEmps ? `
                <div style="padding:8px 15px;background:#e3f2fd;color:#1565c0;font-size:12px;text-align:center;margin:0 10px 8px;border-radius:8px;">
                    共 ${totalEmps} 名员工，仅展示前 ${MAX_EMP_RENDER} 名（可通过搜索/筛选定位具体员工）
                </div>
            ` : ''}

            <!-- 员工列表 -->
            <div class="emp-list">
                ${employees.length === 0 ? `
                    <div class="emp-empty">
                        <div style="font-size:48px;margin-bottom:12px;">👥</div>
                        <div style="font-size:14px;color:#666;margin-bottom:8px;">暂无员工</div>
                        <div style="font-size:12px;color:#999;">点击下方"招聘新员工"开始组建团队</div>
                    </div>
                ` : employees.map(emp => this._renderEmployeeListItem(emp, state)).join('')}
            </div>
        `;
    }

    _renderEmployeeListItem(emp, state) {
        try {
        if (!emp) return '';
        const typeInfo = (typeof EMPLOYEE_TYPES !== 'undefined' && EMPLOYEE_TYPES[emp.type]) || null;
        const deptInfo = (typeof DEPARTMENTS !== 'undefined' && DEPARTMENTS[emp.department]) || null;
        let welfare = null;
        try {
            if (typeof EMPLOYEE_WELFARE_CONFIG !== 'undefined' && EMPLOYEE_WELFARE_CONFIG.getLevel) {
                welfare = EMPLOYEE_WELFARE_CONFIG.getLevel(emp);
            }
        } catch (_) { welfare = null; }
        let slip = null;
        try {
            slip = gameState.calculateEmployeePayroll(emp);
        } catch (_) { slip = null; }
        const isWorking = !!(emp.currentTask && emp.currentTask.type);
        const empTypeInfo = (typeof EMPLOYMENT_TYPES !== 'undefined' && EMPLOYMENT_TYPES[emp.employmentType]) || null;

        return `
            <div class="emp-list-item" 
                 onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                 onclick="ui.showEmployeeDetailModal('${emp.id}')">
                <div class="emp-item-header">
                    <div class="emp-avatar" style="background:${deptInfo?.color || '#999'}22;">
                        <span style="font-size:24px;">${typeInfo?.icon || '👤'}</span>
                    </div>
                    <div class="emp-item-info">
                        <div class="emp-item-name">
                            ${escapeHtml(emp.name)}
                            <span class="emp-badge" style="background:#667eea22;color:#667eea;">Lv.${emp.level||1}</span>
                            ${welfare ? `<span class="emp-badge" style="background:${welfare.color}22;color:${welfare.color};">${welfare.icon}${welfare.short}</span>` : ''}
                            ${emp.employmentType === 'parttime' ? `<span class="emp-badge" style="background:#ff980022;color:#ff9800;">兼职</span>` : ''}
                        </div>
                        <div class="emp-item-meta">
                            <span style="color:${deptInfo?.color||'#999'};">${deptInfo?.icon||'🏢'} ${deptInfo?.name||emp.department}</span>
                            <span class="emp-dot">·</span>
                            <span>${typeInfo?.name||emp.position}</span>
                            <span class="emp-dot">·</span>
                            <span>在职${emp.workDays||0}天</span>
                        </div>
                    </div>
                    <div class="emp-item-salary">
                        <div class="emp-salary-value" style="${isWorking ? 'color:#4caf50;' : 'color:#ff9800;'}">
                            ${isWorking ? '🟢 工作中' : '💤 空闲'}
                        </div>
                        <div class="emp-salary-label">底薪¥${emp.baseSalary||2500}</div>
                        <div class="emp-salary-label" style="color:#e65100;">提成¥${Math.round((emp.pendingSalesCommission||0)+(emp.pendingStaffCommission||0))}</div>
                        <div class="emp-salary-label">预估实发¥${slip?.netSalary?.toLocaleString()||emp.salary}</div>
                    </div>
                </div>
                <div class="emp-item-stats">
                    <div class="emp-stat-mini">
                        <span class="emp-stat-mini-label">📦 打包</span>
                        <span class="emp-stat-mini-value">${emp.stats?.ordersPacked||0}</span>
                    </div>
                    <div class="emp-stat-mini">
                        <span class="emp-stat-mini-label">🚚 发货</span>
                        <span class="emp-stat-mini-value">${emp.stats?.ordersShipped||0}</span>
                    </div>
                    <div class="emp-stat-mini">
                        <span class="emp-stat-mini-label">💬 客服</span>
                        <span class="emp-stat-mini-value">${emp.stats?.consultationsHandled||0}</span>
                    </div>
                    <div class="emp-stat-mini">
                        <span class="emp-stat-mini-label">📣 推广</span>
                        <span class="emp-stat-mini-value">${emp.stats?.marketingRuns||0}</span>
                    </div>
                    <div class="emp-stat-mini">
                        <span class="emp-stat-mini-label">⏰ 加班</span>
                        <span class="emp-stat-mini-value">${emp.overtimeHours||0}h</span>
                    </div>
                </div>
                <div class="emp-item-actions" onclick="event.stopPropagation();">
                    <button class="emp-action-btn primary" onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()" onclick="ui.showAddBonusModal('${emp.id}')">🎁 发奖金</button>
                    <button class="emp-action-btn" onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()" onclick="ui.showAddOvertimeModal('${emp.id}')">⏰ 加班</button>
                    <button class="emp-action-btn" onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()" onclick="ui.upgradeEmployeeOneKey('${emp.id}')">🚀 一键升级</button>
                    <button class="emp-action-btn danger" onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()" onclick="ui.fireEmployee('${emp.id}')">解雇</button>
                </div>
            </div>
        `;
        } catch (e) {
            console.warn('[_renderEmployeeListItem]', emp && emp.id, e);
            return `<div class="emp-list-item" style="padding:12px;color:#c62828;font-size:12px;">员工卡片渲染失败：${escapeHtml((emp && emp.name) || '?')}</div>`;
        }
    }

    _onEmployeeSearch(val) {
        this._employeeFilter = this._employeeFilter || { keyword: '', department: 'all', status: 'active' };
        this._employeeFilter.keyword = val;
        // ===== 搜索框输入防抖：打字时不每按一个键就销毁/重建input节点（否则移动端输入法闪退） =====
        if (this._empSearchTimer) clearTimeout(this._empSearchTimer);
        this._empSearchTimer = setTimeout(() => {
            this._empSearchTimer = null;
            // 记录当前是否在搜索框上有焦点 + 光标位置，重建后恢复，保证连续打字不丢焦点
            const ae = document.activeElement;
            const isOnSearch = ae && (ae.classList && ae.classList.contains('emp-search-input'));
            const selStart = isOnSearch ? (ae.selectionStart || 0) : 0;
            const selEnd   = isOnSearch ? (ae.selectionEnd   || 0) : 0;

            this._renderEmployeeManager();

            if (isOnSearch) {
                const input = document.querySelector('.emp-search-input');
                if (input) {
                    try { input.focus(); } catch (e) {}
                    try { input.setSelectionRange(selStart, selEnd); } catch (e) {}
                }
            }
        }, 220);
    }

    _onEmployeeDeptFilter(val) {
        this._employeeFilter.department = val;
        this._renderEmployeeManager();
    }

    // ----- Tab2: 薪酬核算 -----
    _renderPayrollTab(state, payrollPreview) {
        const slips = payrollPreview.slips.filter(s => s !== null);
        const totals = payrollPreview.totals;
        const curDay = state.gameTime.day;
        const daysUntilPay = Math.max(0, 30 - (curDay % 30));

        return `
            <div class="payroll-summary">
                <div class="payroll-summary-main" style="background:linear-gradient(135deg,#4caf50,#2e7d32);">
                    <div class="payroll-total-label">本月应实发总额</div>
                    <div class="payroll-total-value">¥${totals.net.toLocaleString()}</div>
                    <div class="payroll-total-sub">${totals.count}名在职员工 · 每月1号发薪（需确认）· 距下次约${daysUntilPay === 30 ? 0 : daysUntilPay}天</div>
                </div>
                <div class="payroll-summary-grid">
                    <div class="payroll-summary-item">
                        <div class="psi-label">应发工资</div>
                        <div class="psi-value">¥${Math.round(totals.gross).toLocaleString()}</div>
                    </div>
                    <div class="payroll-summary-item">
                        <div class="psi-label">个人社保</div>
                        <div class="psi-value" style="color:#f44336;">-¥${Math.round(totals.social).toLocaleString()}</div>
                    </div>
                    <div class="payroll-summary-item">
                        <div class="psi-label">个人所得税</div>
                        <div class="psi-value" style="color:#f44336;">-¥${Math.round(totals.tax).toLocaleString()}</div>
                    </div>
                    <div class="payroll-summary-item">
                        <div class="psi-label">企业总成本</div>
                        <div class="psi-value" style="color:#ff9800;font-weight:700;">¥${Math.round(totals.companyCost).toLocaleString()}</div>
                    </div>
                </div>
            </div>

            <div class="payroll-note">
                💡 工资计算公式：基本工资 + 岗位工资 + 补贴/奖金 + 加班费 + 福利补贴 − 五险一金 − 个人所得税 = 实发工资
            </div>

            <!-- 员工工资单列表 -->
            <div class="section-title-sm">📋 员工工资明细（预览）</div>
            <div class="payroll-slips-list">
                ${slips.length === 0 ? `
                    <div class="emp-empty" style="padding:20px;">
                        <div style="font-size:32px;">💰</div>
                        <div style="color:#999;margin-top:6px;font-size:12px;">暂无在职员工</div>
                    </div>
                ` : slips.map(slip => this._renderSalarySlipRow(slip)).join('')}
            </div>
        `;
    }

    _renderSalarySlipRow(slip) {
        const commission = Math.round((slip.salesCommission || slip.items?.salesCommission || 0) + (slip.staffCommission || slip.items?.staffCommission || 0));
        return `
            <div class="salary-slip-row" onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                 onclick="ui.showSalarySlipDetail('${slip.employeeId}')">
                <div class="ssr-left">
                    <div class="ssr-name">${escapeHtml(slip.employeeName)}</div>
                    <div class="ssr-meta">${slip.department} · ${slip.position} · Lv.${slip.level} ${slip.welfare ? '· '+slip.welfare : ''}</div>
                    ${commission > 0 ? `<div class="ssr-meta" style="color:#e65100;">💰 提成 ¥${commission.toLocaleString()}（另计）</div>` : ''}
                </div>
                <div class="ssr-right">
                    <div class="ssr-salary">¥${slip.netSalary.toLocaleString()}</div>
                    <div class="ssr-detail">应发¥${Math.round(slip.grossSalary).toLocaleString()} · ${slip.taxBracket}</div>
                </div>
                <div class="ssr-arrow">›</div>
            </div>
        `;
    }

    // ----- Tab3: 发放记录 -----
    _renderPayrollHistoryTab(state) {
        const records = state.payroll?.records || [];
        return `
            <div class="payroll-history">
                ${records.length === 0 ? `
                    <div class="emp-empty" style="padding:40px 20px;">
                        <div style="font-size:48px;">📋</div>
                        <div style="color:#666;margin-top:8px;font-size:14px;">暂无工资发放记录</div>
                        <div style="color:#999;margin-top:4px;font-size:12px;">首次发薪后将在此处显示</div>
                    </div>
                ` : records.map(rec => `
                    <div class="payroll-history-card" style="cursor:pointer;"
                         onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                         onclick="ui.showPayrollRecordDetail('${rec.id}')">
                        <div class="ph-card-header">
                            <div>
                                <div class="ph-period">${rec.period || '月度工资'}</div>
                                <div class="ph-date">游戏第${rec.date?.day||1}天发放 · 点击查看工资条</div>
                            </div>
                            <div class="ph-amount">¥${Math.round(rec.netTotal).toLocaleString()}</div>
                        </div>
                        <div class="ph-card-stats">
                            <div class="ph-stat">
                                <span class="ph-stat-label">人数</span>
                                <span class="ph-stat-value">${rec.employeeCount}人</span>
                            </div>
                            <div class="ph-stat">
                                <span class="ph-stat-label">应发总额</span>
                                <span class="ph-stat-value">¥${Math.round(rec.grossTotal).toLocaleString()}</span>
                            </div>
                            <div class="ph-stat">
                                <span class="ph-stat-label">社保</span>
                                <span class="ph-stat-value" style="color:#f44336;">¥${Math.round(rec.socialTotal).toLocaleString()}</span>
                            </div>
                            <div class="ph-stat">
                                <span class="ph-stat-label">个税</span>
                                <span class="ph-stat-value" style="color:#f44336;">¥${Math.round(rec.taxTotal).toLocaleString()}</span>
                            </div>
                        </div>
                        <div class="ph-card-employees">
                            ${(rec.slips||[]).map(s => `
                                <span class="ph-emp-tag">${escapeHtml(s.employeeName)} ¥${Math.round(s.netSalary).toLocaleString()}</span>
                            `).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    showPayrollRecordDetail(recordId) {
        const slips = (gameState.state.payroll?.salarySlips || []).filter(s => s.payrollId === recordId);
        const rec = (gameState.state.payroll?.records || []).find(r => r.id === recordId);
        if (!slips.length && !rec) {
            this.showToast('未找到该期工资条');
            return;
        }
        const list = slips.length ? slips : (rec?.slips || []);
        const content = `
            <div style="font-size:13px;">
                <div style="margin-bottom:10px;color:#666;">${rec?.period || '月度工资'} · 第${rec?.date?.day || '?'}天 · ${list.length}人</div>
                ${list.map(s => {
                    const commission = Math.round((s.salesCommission || s.items?.salesCommission || 0) + (s.staffCommission || s.items?.staffCommission || 0));
                    return `
                    <div style="padding:10px;border:1px solid #eee;border-radius:10px;margin-bottom:8px;">
                        <div style="display:flex;justify-content:space-between;font-weight:700;">
                            <span>${escapeHtml(s.employeeName || s.name || '员工')}</span>
                            <span style="color:#2e7d32;">实发 ¥${Math.round(s.netSalary || 0).toLocaleString()}</span>
                        </div>
                        <div style="font-size:12px;color:#666;margin-top:4px;">
                            应发 ¥${Math.round(s.grossSalary || s.baseGrossCapped || 0).toLocaleString()}
                            ${commission > 0 ? ` · 提成 ¥${commission.toLocaleString()}` : ''}
                            ${s.items?.baseSalary != null ? ` · 底薪 ¥${Math.round(s.items.baseSalary).toLocaleString()}` : ''}
                        </div>
                    </div>`;
                }).join('')}
            </div>`;
        this.showModal('📋 历史工资条', content, `<button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>`, { width: '520px' });
    }

    // ----- Tab4: 奖金配置 -----
    _renderBonusConfigTab(state) {
        const config = state.payroll?.bonusConfig || {};
        const bonusItems = [
            { id: 'attendance', icon: '✅', name: '全勤奖', default: 200 },
            { id: 'meal', icon: '🍱', name: '餐补', default: 300 },
            { id: 'transport', icon: '🚌', name: '交通补贴', default: 200 },
            { id: 'highTemperature', icon: '🔥', name: '高温补贴(6-9月)', default: 150 }
        ];

        return `
            <div class="bonus-config">
                <div class="bonus-config-desc">
                    💡 配置固定补贴/奖金项目，开启后每月发薪时自动计入工资单。绩效奖金和加班费根据实际数据自动计算。
                </div>
                ${bonusItems.map(item => {
                    const cfg = config[item.id] || { enabled: true, amount: item.default };
                    return `
                        <div class="bonus-config-item">
                            <div class="bci-left">
                                <span class="bci-icon">${item.icon}</span>
                                <div>
                                    <div class="bci-name">${item.name}</div>
                                    <div class="bci-desc">标准金额 ¥${item.default}/月 · 可自定义金额</div>
                                </div>
                            </div>
                            <div class="bci-right">
                                <div class="bci-switch ${cfg.enabled ? 'on' : ''}" 
                                     onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                                     onclick="ui.toggleBonusConfig('${item.id}', ${!cfg.enabled})">
                                    <div class="bci-switch-dot"></div>
                                </div>
                                <input type="number" class="bci-amount-input" value="${cfg.amount||0}" min="0" step="10"
                                       onchange="ui.updateBonusAmount('${item.id}', this.value)" />
                            </div>
                        </div>
                    `;
                }).join('')}

                <div class="section-title-sm" style="margin-top:16px;">🎁 自定义奖金类型</div>
                <div style="display:flex;gap:8px;margin:8px 0;">
                    <input id="customBonusName" type="text" placeholder="名称如：项目奖" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:8px;">
                    <input id="customBonusAmt" type="number" placeholder="金额" min="0" step="50" style="width:100px;padding:8px;border:1px solid #ddd;border-radius:8px;">
                    <button class="btn btn-primary btn-xs" onclick="ui.addCustomBonusType()">添加</button>
                </div>
                <div style="font-size:11px;color:#888;margin-bottom:8px;">添加后可在员工「发奖金」中选用；手动奖金发薪时全额核算（不进月薪硬顶）。</div>
                ${(state.payroll?.customBonusTypes || []).map((t, idx) => `
                    <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:13px;">
                        <span>🎁 ${escapeHtml(t.name)} · 默认 ¥${t.amount||0}</span>
                        <button class="btn btn-danger btn-xs" onclick="ui.removeCustomBonusType(${idx})">删除</button>
                    </div>
                `).join('') || '<div style="color:#999;font-size:12px;">暂无自定义类型</div>'}

                <div class="section-title-sm" style="margin-top:16px;">📜 薪酬规则说明（按国家规定）</div>
                <div class="rules-card">
                    <div class="rule-item">
                        <div class="rule-title">🏛️ 五险一金（个人缴纳）</div>
                        <div class="rule-detail">养老8% · 医疗2% · 失业0.5% · 公积金7% = <b>17.5%</b></div>
                    </div>
                    <div class="rule-item">
                        <div class="rule-title">🏛️ 五险一金（企业缴纳）</div>
                        <div class="rule-detail">养老16% · 医疗9.5% · 失业0.5% · 工伤0.4% · 生育0.8% · 公积金7% = <b>34.2%</b></div>
                    </div>
                    <div class="rule-item">
                        <div class="rule-title">💵 个人所得税</div>
                        <div class="rule-detail">起征点¥5000，3%~45%七级超额累进税率</div>
                    </div>
                    <div class="rule-item">
                        <div class="rule-title">⏰ 加班工资</div>
                        <div class="rule-detail">工作日1.5倍 · 休息日2倍 · 法定节假日3倍</div>
                    </div>
                    <div class="rule-item">
                        <div class="rule-title">📅 计薪天数</div>
                        <div class="rule-detail">月计薪天数21.75天，日工资=月工资÷21.75，时薪=日工资÷8</div>
                    </div>
                </div>
            </div>
        `;
    }

    toggleBonusConfig(bonusId, enabled) {
        gameState.updateBonusConfig(bonusId, { enabled });
        this._renderEmployeeManager();
    }

    updateBonusAmount(bonusId, val) {
        const amount = Math.max(0, parseInt(val) || 0);
        gameState.updateBonusConfig(bonusId, { amount });
        this._renderEmployeeManager();
    }

    addCustomBonusType() {
        try {
            if (!gameState.state.payroll) gameState.state.payroll = {};
            if (!Array.isArray(gameState.state.payroll.customBonusTypes)) {
                gameState.state.payroll.customBonusTypes = [];
            }
            const name = (document.getElementById('customBonusName')?.value || '').trim();
            const amount = Math.max(0, parseInt(document.getElementById('customBonusAmt')?.value || '0', 10) || 0);
            if (!name) { this.showToast('请填写奖金名称'); return; }
            gameState.state.payroll.customBonusTypes.push({ name, amount });
            if (typeof gameState.notify === 'function') gameState.notify();
            this.showToast('已添加自定义奖金类型');
            this._renderEmployeeManager();
        } catch (e) {
            this.showToast('添加失败');
        }
    }

    removeCustomBonusType(idx) {
        try {
            const arr = gameState.state.payroll?.customBonusTypes;
            if (!Array.isArray(arr) || idx < 0 || idx >= arr.length) return;
            arr.splice(idx, 1);
            if (typeof gameState.notify === 'function') gameState.notify();
            this._renderEmployeeManager();
        } catch (_) {}
    }

    saveCustomCommissionRate() {
        try {
            const raw = (document.getElementById('customCommissionPct')?.value || '').trim();
            if (raw === '') {
                this.clearCustomCommissionRate();
                return;
            }
            const pct = parseFloat(raw);
            if (!isFinite(pct) || pct < 0 || pct > 20) {
                this.showToast('提成比例需在 0%～20%');
                return;
            }
            gameState.setState(s => {
                s.shop = s.shop || {};
                s.shop.customCommissionRate = Math.round(pct * 10) / 1000; // 保留1位小数%
            });
            this.showToast(`已设置营销提成 ${(pct).toFixed(1)}%`);
            if (document.querySelector('[data-modal-id="commissionCenterModal"]')) this.showCommissionCenter();
            else this._renderEmployeeManager();
        } catch (e) {
            this.showToast('保存失败');
        }
    }

    clearCustomCommissionRate() {
        try {
            gameState.setState(s => {
                s.shop = s.shop || {};
                s.shop.customCommissionRate = null;
            });
            this.showToast('已恢复阶梯提成');
            if (document.querySelector('[data-modal-id="commissionCenterModal"]')) this.showCommissionCenter();
            else this._renderEmployeeManager();
        } catch (_) {}
    }

    // ============================================================
    // 员工详情弹窗（信息查看 + 编辑）
    // ============================================================

    showEmployeeDetailModal(empId) {
        this._selectedEmployeeId = empId;
        this._empEditMode = false;
        this._renderEmployeeDetail();
    }

    _renderEmployeeDetail() {
        const emp = gameState.state.employees.find(e => e.id === this._selectedEmployeeId);
        if (!emp) { this.closeModal(); return; }

        const typeInfo = EMPLOYEE_TYPES[emp.type];
        const deptInfo = DEPARTMENTS[emp.department];
        const welfare = EMPLOYEE_WELFARE_CONFIG.getLevel(emp);
        const slip = gameState.calculateEmployeePayroll(emp);

        const content = `
            <div class="emp-detail">
                <!-- 头部信息 -->
                <div class="emp-detail-hero" style="background:linear-gradient(135deg,${deptInfo?.color||'#667eea'}aa,${deptInfo?.color||'#764ba2'});">
                    <div style="display:flex;align-items:center;gap:14px;">
                        <div style="width:60px;height:60px;border-radius:50%;background:rgba(255,255,255,0.25);display:flex;align-items:center;justify-content:center;font-size:32px;">
                            ${typeInfo?.icon||'👤'}
                        </div>
                        <div style="flex:1;color:#fff;">
                            ${this._empEditMode ? `
                                <input type="text" id="empEditName" value="${escapeHtml(emp.name)}" 
                                       class="emp-edit-name" placeholder="员工姓名" />
                            ` : `
                                <div style="font-size:18px;font-weight:700;">${escapeHtml(emp.name)}</div>
                            `}
                            <div style="font-size:12px;opacity:0.9;margin-top:4px;">
                                ${deptInfo?.icon||'🏢'} ${deptInfo?.name||emp.department} · ${typeInfo?.name||emp.position}
                                ${emp.employmentType==='parttime'?' · 兼职':' · 全职'}
                            </div>
                        </div>
                    </div>
                    ${welfare ? `
                        <div style="margin-top:10px;display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,0.2);padding:4px 10px;border-radius:12px;font-size:11px;color:#fff;">
                            ${welfare.icon} ${welfare.name} · ${welfare.description}
                        </div>
                    ` : ''}
                </div>

                <!-- 基本信息 -->
                <div class="info-section">
                    <div class="info-section-title">📋 基本信息</div>
                    <div class="info-grid">
                        <div class="info-item">
                            <div class="info-label">员工编号</div>
                            <div class="info-value">${emp.id.slice(-8).toUpperCase()}</div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">员工等级</div>
                            <div class="info-value">Lv.${emp.level||1} / ${EMPLOYEE_LEVEL_CONFIG.maxLevel}</div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">入职日期</div>
                            <div class="info-value">第${emp.joinDate?.day||emp.hireDate?.day||1}天</div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">在职天数</div>
                            <div class="info-value">${emp.workDays||0}天</div>
                        </div>
                        ${this._empEditMode ? `
                            <div class="info-item full">
                                <div class="info-label">联系电话</div>
                                <input type="tel" id="empEditPhone" value="${escapeHtml(emp.phone||'')}" class="emp-edit-input" placeholder="手机号" />
                            </div>
                            <div class="info-item full">
                                <div class="info-label">身份证号</div>
                                <input type="text" id="empEditIdCard" value="${escapeHtml(emp.idCard||'')}" class="emp-edit-input" placeholder="身份证号（选填）" />
                            </div>
                            <div class="info-item">
                                <div class="info-label">紧急联系人</div>
                                <input type="text" id="empEditEmergency" value="${escapeHtml(emp.emergencyContact||'')}" class="emp-edit-input" placeholder="姓名" />
                            </div>
                            <div class="info-item">
                                <div class="info-label">联系电话</div>
                                <input type="tel" id="empEditEmergencyPhone" value="${escapeHtml(emp.emergencyPhone||'')}" class="emp-edit-input" placeholder="电话" />
                            </div>
                            <div class="info-item full">
                                <div class="info-label">联系地址</div>
                                <input type="text" id="empEditAddress" value="${escapeHtml(emp.address||'')}" class="emp-edit-input" placeholder="地址（选填）" />
                            </div>
                            <div class="info-item">
                                <div class="info-label">绩效评分</div>
                                <input type="number" id="empEditPerf" value="${emp.performanceScore||100}" min="0" max="150" class="emp-edit-input" />
                            </div>
                            <div class="info-item">
                                <div class="info-label">基本工资</div>
                                <input type="number" id="empEditBaseSalary" value="${emp.baseSalary||0}" min="0" step="100" class="emp-edit-input" />
                            </div>
                        ` : `
                            <div class="info-item">
                                <div class="info-label">联系电话</div>
                                <div class="info-value">${emp.phone||'未填写'}</div>
                            </div>
                            <div class="info-item">
                                <div class="info-label">绩效评分</div>
                                <div class="info-value" style="color:${(emp.performanceScore||100)>=100?'#4caf50':'#ff9800'};">${emp.performanceScore||100}分</div>
                            </div>
                        `}
                    </div>
                </div>

                <!-- 本月工资预览 -->
                ${slip ? `
                    <div class="info-section">
                        <div class="info-section-title">💰 本月工资预览</div>
                        <div class="salary-preview">
                            <div class="salary-preview-main">
                                <div class="sp-label">实发工资</div>
                                <div class="sp-value">¥${slip.netSalary.toLocaleString()}</div>
                            </div>
                            <div class="salary-preview-detail">
                                <div class="sp-row">
                                    <span>基本工资</span>
                                    <span>¥${slip.items.baseSalary.toLocaleString()}</span>
                                </div>
                                <div class="sp-row">
                                    <span>岗位工资</span>
                                    <span>¥${slip.items.positionSalary.toLocaleString()}</span>
                                </div>
                                ${slip.items.allowances.map(a => `
                                    <div class="sp-row">
                                        <span>${a.icon} ${a.name}</span>
                                        <span style="color:#4caf50;">+¥${a.amount.toLocaleString()}</span>
                                    </div>
                                `).join('')}
                                ${slip.items.performanceBonus ? `
                                    <div class="sp-row">
                                        <span>📊 绩效奖金</span>
                                        <span style="color:#4caf50;">+¥${slip.items.performanceBonus.toLocaleString()}</span>
                                    </div>
                                ` : ''}
                                ${slip.items.overtimePay ? `
                                    <div class="sp-row">
                                        <span>⏰ 加班费(${slip.overtimeHours}h)</span>
                                        <span style="color:#4caf50;">+¥${slip.items.overtimePay.toLocaleString()}</span>
                                    </div>
                                ` : ''}
                                ${slip.items.customItems.map(a => `
                                    <div class="sp-row">
                                        <span>${a.icon} ${a.name}</span>
                                        <span style="color:${a.amount>=0?'#4caf50':'#f44336'};">${a.amount>=0?'+':''}¥${a.amount.toLocaleString()}</span>
                                    </div>
                                `).join('')}
                                <div class="sp-divider"></div>
                                ${slip.items.socialItems.map(a => `
                                    <div class="sp-row">
                                        <span>${a.icon} ${a.name}</span>
                                        <span style="color:#f44336;">-¥${Math.abs(a.amount).toLocaleString()}</span>
                                    </div>
                                `).join('')}
                                <div class="sp-row">
                                    <span>🏛️ 个人所得税 (${slip.items.taxBracket})</span>
                                    <span style="color:#f44336;">-¥${slip.incomeTax.toLocaleString()}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                ` : ''}

                <!-- 工作统计 -->
                <div class="info-section">
                    <div class="info-section-title">📊 累计工作统计</div>
                    <div class="emp-work-stats">
                        <div class="ws-item">
                            <div class="ws-icon" style="background:#ff980022;color:#ff9800;">📦</div>
                            <div class="ws-value">${emp.stats?.ordersPacked||0}</div>
                            <div class="ws-label">打包订单</div>
                        </div>
                        <div class="ws-item">
                            <div class="ws-icon" style="background:#2196f322;color:#2196f3;">🚚</div>
                            <div class="ws-value">${emp.stats?.ordersShipped||0}</div>
                            <div class="ws-label">发货订单</div>
                        </div>
                        <div class="ws-item">
                            <div class="ws-icon" style="background:#4caf5022;color:#4caf50;">💬</div>
                            <div class="ws-value">${emp.stats?.consultationsHandled||0}</div>
                            <div class="ws-label">客服咨询</div>
                        </div>
                        <div class="ws-item">
                            <div class="ws-icon" style="background:#9c27b022;color:#9c27b0;">📣</div>
                            <div class="ws-value">${emp.stats?.marketingRuns||0}</div>
                            <div class="ws-label">推广次数</div>
                        </div>
                    </div>
                </div>

                <!-- 经验进度 -->
                <div class="info-section">
                    <div class="info-section-title">📈 成长进度</div>
                    <div style="padding:0 4px;">
                        <div style="display:flex;justify-content:space-between;font-size:12px;color:#666;margin-bottom:4px;">
                            <span>Lv.${emp.level||1}</span>
                            <span>经验 ${emp.exp||0}/${emp.level>=EMPLOYEE_LEVEL_CONFIG.maxLevel?'MAX':EMPLOYEE_LEVEL_CONFIG.expToNext(emp.level||1)}</span>
                        </div>
                        <div style="height:8px;background:#eee;border-radius:4px;overflow:hidden;">
                            <div style="height:100%;width:${emp.level>=EMPLOYEE_LEVEL_CONFIG.maxLevel?100:Math.min(100,((emp.exp||0)/EMPLOYEE_LEVEL_CONFIG.expToNext(emp.level||1))*100)}%;background:linear-gradient(90deg,#667eea,#764ba2);border-radius:4px;transition:width 0.3s;"></div>
                        </div>
                        ${emp.level < EMPLOYEE_LEVEL_CONFIG.maxLevel ? `
                            <div style="margin-top:8px;font-size:11px;color:#999;">升级费用：¥${EMPLOYEE_LEVEL_CONFIG.promotionCost(emp.level||1).toLocaleString()}</div>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;

        const footer = `
            <button class="btn btn-secondary" onclick="ui._backToEmpList()">← 返回</button>
            ${this._empEditMode 
                ? `<button class="btn btn-primary" onclick="ui.saveEmployeeEdit()">💾 保存修改</button>`
                : `<button class="btn btn-primary" onclick="ui._enterEmpEditMode()">✏️ 编辑信息</button>`
            }
        `;

        this.showModal(`👤 ${escapeHtml(emp.name)}`, content, footer, 'emp-detail-modal');
    }

    _backToEmpList() {
        if (this._empEditMode) {
            this._empEditMode = false;
            this._renderEmployeeDetail();
        } else {
            this._selectedEmployeeId = null;
            this._renderEmployeeManager();
        }
    }

    _enterEmpEditMode() {
        this._empEditMode = true;
        this._renderEmployeeDetail();
    }

    saveEmployeeEdit() {
        const empId = this._selectedEmployeeId;
        const updates = {
            name: document.getElementById('empEditName')?.value?.trim(),
            phone: document.getElementById('empEditPhone')?.value?.trim(),
            idCard: document.getElementById('empEditIdCard')?.value?.trim(),
            emergencyContact: document.getElementById('empEditEmergency')?.value?.trim(),
            emergencyPhone: document.getElementById('empEditEmergencyPhone')?.value?.trim(),
            address: document.getElementById('empEditAddress')?.value?.trim(),
            performanceScore: parseInt(document.getElementById('empEditPerf')?.value) || 100,
            baseSalary: parseInt(document.getElementById('empEditBaseSalary')?.value) || 0,
            adjustReason: '手动编辑'
        };

        if (!updates.name) {
            this.showToast('员工姓名不能为空');
            return;
        }

        const result = gameState.updateEmployeeInfo(empId, updates);
        if (result.success) {
            this._empEditMode = false;
            this.showToast('✅ 员工信息已更新');
            this._renderEmployeeDetail();
        } else {
            this.showToast(result.message || '更新失败');
        }
    }

    // ============================================================
    // 发奖金弹窗
    // ============================================================
    showAddBonusModal(empId) {
        const emp = gameState.state.employees.find(e => e.id === empId);
        if (!emp) return;
        
        const content = `
            <div style="padding:10px 0;">
                <div style="text-align:center;margin-bottom:16px;">
                    <div style="font-size:36px;">🎁</div>
                    <div style="font-size:15px;font-weight:700;margin-top:8px;">给 ${escapeHtml(emp.name)} 发奖金/扣款</div>
                    <div style="font-size:12px;color:#999;margin-top:4px;">正数为奖金，负数为扣款</div>
                </div>
                <div style="margin-bottom:12px;">
                    <label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">项目名称</label>
                    <input type="text" id="bonusName" class="modal-input" placeholder="如：优秀员工奖、迟到扣款等" />
                </div>
                <div style="margin-bottom:12px;">
                    <label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">金额（元）</label>
                    <input type="number" id="bonusAmount" class="modal-input" placeholder="正数=奖金，负数=扣款" value="500" />
                </div>
                <div style="margin-bottom:12px;">
                    <label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">备注说明（可选）</label>
                    <textarea id="bonusReason" class="modal-input" rows="2" placeholder="发放/扣款原因"></textarea>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button class="quick-bonus-btn" onclick="document.getElementById('bonusName').value='优秀员工奖';document.getElementById('bonusAmount').value=500;">🌟优秀员工+500</button>
                    <button class="quick-bonus-btn" onclick="document.getElementById('bonusName').value='销售提成';document.getElementById('bonusAmount').value=1000;">💵提成+1000</button>
                    <button class="quick-bonus-btn" onclick="document.getElementById('bonusName').value='迟到扣款';document.getElementById('bonusAmount').value=-100;">⏰迟到-100</button>
                    <button class="quick-bonus-btn" onclick="document.getElementById('bonusName').value='差错扣款';document.getElementById('bonusAmount').value=-200;">❌差错-200</button>
                    ${(gameState.state.payroll?.customBonusTypes || []).map(t => `
                        <button class="quick-bonus-btn" onclick="document.getElementById('bonusName').value='${String(t.name||'').replace(/'/g,'')}';document.getElementById('bonusAmount').value=${Number(t.amount)||0};">🎁${escapeHtml(t.name)}+${Number(t.amount)||0}</button>
                    `).join('')}
                </div>
            </div>
        `;

        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>
            <button class="btn btn-primary" onclick="ui.confirmAddBonus('${empId}')">确认发放</button>
        `;

        this.showModal('🎁 发放奖金', content, footer);
    }

    confirmAddBonus(empId) {
        const name = document.getElementById('bonusName')?.value?.trim();
        const amount = parseFloat(document.getElementById('bonusAmount')?.value);
        const reason = document.getElementById('bonusReason')?.value?.trim();

        if (!name) { this.showToast('请填写项目名称'); return; }
        if (isNaN(amount) || amount === 0) { this.showToast('请填写有效金额'); return; }

        const result = gameState.addEmployeeBonus(empId, name, amount, reason);
        if (result.success) {
            this.closeModal();
            this.showToast(result.message);
            this._renderEmployeeManager();
        } else {
            this.showToast(result.message);
        }
    }

    // ============================================================
    // 加班登记弹窗
    // ============================================================
    showAddOvertimeModal(empId) {
        const emp = gameState.state.employees.find(e => e.id === empId);
        if (!emp) return;

        const content = `
            <div style="padding:10px 0;">
                <div style="text-align:center;margin-bottom:16px;">
                    <div style="font-size:36px;">⏰</div>
                    <div style="font-size:15px;font-weight:700;margin-top:8px;">登记 ${escapeHtml(emp.name)} 加班</div>
                    <div style="font-size:12px;color:#999;margin-top:4px;">按国家规定倍率计算加班费</div>
                </div>
                <div style="margin-bottom:12px;">
                    <label style="font-size:12px;color:#666;display:block;margin-bottom:6px;">加班类型</label>
                    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
                        ${Object.entries(OVERTIME_RATES).map(([key, cfg]) => `
                            <label class="ot-type-label">
                                <input type="radio" name="otType" value="${key}" ${key==='workday'?'checked':''} />
                                <div class="ot-type-card">
                                    <div class="ot-rate">${cfg.label}</div>
                                    <div class="ot-name">${cfg.name}</div>
                                </div>
                            </label>
                        `).join('')}
                    </div>
                </div>
                <div style="margin-bottom:12px;">
                    <label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">加班时长（小时）</label>
                    <input type="number" id="otHours" class="modal-input" placeholder="输入加班小时数" value="2" min="0.5" step="0.5" />
                </div>
                <div style="background:#f5f5f5;border-radius:8px;padding:10px;font-size:11px;color:#666;">
                    💡 时薪计算公式：月基本工资 ÷ 21.75天 ÷ 8小时
                </div>
            </div>
        `;

        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>
            <button class="btn btn-primary" onclick="ui.confirmAddOvertime('${empId}')">确认登记</button>
        `;

        this.showModal('⏰ 加班登记', content, footer);
    }

    confirmAddOvertime(empId) {
        const type = document.querySelector('input[name="otType"]:checked')?.value || 'workday';
        const hours = parseFloat(document.getElementById('otHours')?.value);

        if (isNaN(hours) || hours <= 0) { this.showToast('请输入有效加班时长'); return; }

        const result = gameState.addEmployeeOvertime(empId, hours, type);
        if (result.success) {
            this.closeModal();
            this.showToast(result.message);
            this._renderEmployeeManager();
        } else {
            this.showToast(result.message);
        }
    }

    // ============================================================
    // 工资单详情弹窗
    // ============================================================
    showSalarySlipDetail(empId) {
        const emp = gameState.state.employees.find(e => e.id === empId);
        if (!emp) return;
        this._selectedEmployeeId = empId;
        this._empEditMode = false;
        this._renderEmployeeDetail();
    }

    // ============================================================
    // 统一付款确认（快递费 / 纳税 / 法务受理费等：先弹窗确认再扣款）
    // ============================================================
    enqueuePaymentRequest(req) {
        if (!req) return;
        // 需扣款但金额为 0 的请求忽略；申报类请直接用 confirmPayment
        if (req.charge !== false && !(Number(req.amount) > 0)) return;
        if (!this._paymentQueue) this._paymentQueue = [];
        const id = req.id || (`pay_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
        if (this._paymentQueue.some(x => x.id === id)) return;
        this._paymentQueue.push({ ...req, id });
        if (this._paymentFlushTimer) clearTimeout(this._paymentFlushTimer);
        this._paymentFlushTimer = setTimeout(() => {
            this._paymentFlushTimer = null;
            this._flushPaymentQueue();
        }, 380);
    }

    _flushPaymentQueue() {
        if (this._paymentModalOpen) return;
        const queue = this._paymentQueue || [];
        if (!queue.length) return;
        const items = queue.splice(0, queue.length);
        const chargeItems = items.filter(i => i.charge !== false);
        const total = chargeItems.reduce((s, i) => s + (Number(i.amount) || 0), 0);
        const title = items.length === 1
            ? (items[0].title || '付款确认')
            : `付款确认（${items.length}笔）`;
        const detailHtml = items.map(i => {
            const amt = Number(i.amount) || 0;
            const line = i.detail || i.title || '费用';
            return `<div style="display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px dashed #eee;font-size:13px;">
                <span style="color:#555;">${line}</span>
                <strong style="color:#e65100;white-space:nowrap;">¥${amt.toFixed(2)}</strong>
            </div>`;
        }).join('');
        const forcePay = items.some(i => i.noCancel || i.category === 'tax' || i.category === 'salary' || i.category === 'express');
        const cat = items.find(i => i.category)?.category || (forcePay ? 'express' : '');
        const note = items.map(i => i.note).filter(Boolean).join('；')
            || (forcePay ? '须先付清。余额不足请申请贷款，否则店铺破产。' : '确认后从店铺资金扣款；取消则保持待付。');
        this.confirmPayment({
            title,
            amount: total,
            category: cat,
            year: items.find(i => i.year)?.year,
            month: items.find(i => i.month)?.month,
            billIds: items.map(i => i.billId).filter(Boolean),
            detailHtml,
            note,
            noCancel: forcePay,
            confirmText: total > 0 ? `现场支付 ¥${total.toFixed(2)}` : '确认',
            onConfirm: () => {
                let ok = 0, fail = 0;
                const failReasons = [];
                items.forEach(i => {
                    try {
                        const r = typeof i.execute === 'function' ? i.execute() : true;
                        if (r === false || (r && r.success === false)) {
                            fail++;
                            const why = (r && (r.message || r.msg)) || '未知原因';
                            if (failReasons.length < 3 && !failReasons.includes(why)) failReasons.push(why);
                        } else ok++;
                    } catch (e) {
                        fail++;
                        const why = (e && e.message) ? e.message : '执行异常';
                        if (failReasons.length < 3 && !failReasons.includes(why)) failReasons.push(why);
                    }
                });
                if (fail) {
                    const tip = failReasons.length ? `（${failReasons.join('；')}）` : '';
                    this.showToast(`支付完成 ${ok} 笔，失败 ${fail} 笔${tip}`);
                } else if (total > 0) this.showToast(`✅ 已支付 ¥${total.toFixed(2)}`);
                else this.showToast('✅ 已确认');
                try { if (typeof gameState !== 'undefined') gameState.notify(); } catch (_) {}
            }
        });
    }

    /**
     * 付款确认弹窗：确认后才执行 onConfirm（通常在回调里扣款）
     * @param {{ title?: string, amount?: number, detailHtml?: string, note?: string, confirmText?: string, onConfirm?: Function, onCancel?: Function }} opts
     */
    _getShopFunds() {
        try {
            return (typeof gameState !== 'undefined' && gameState.state && gameState.state.shop)
                ? (Number(gameState.state.shop.funds) || 0) : 0;
        } catch (_) { return 0; }
    }

    _isMandatoryPay(opts) {
        if (!opts) return false;
        const cat = opts.category || '';
        return !!(opts.noCancel || opts.mandatory
            || cat === 'tax' || cat === 'salary' || cat === 'express');
    }

    _isCashEnough(amount) {
        return !(Number(amount) > 0) || (this._getShopFunds() + 1e-6 >= Number(amount));
    }

    confirmPayment(opts = {}) {
        const title = opts.title || '付款确认';
        const amount = Math.round((Number(opts.amount) || 0) * 100) / 100;
        const detailHtml = opts.detailHtml || '';
        const mandatory = this._isMandatoryPay(opts);
        const noCancel = mandatory;
        const note = opts.note || (mandatory
            ? '必须先付清。余额不足可申请贷款，否则宣告破产。'
            : '');
        const confirmText = opts.confirmText || (amount > 0 ? `现场支付 ¥${amount.toFixed(2)}` : '确认');
        const funds = this._getShopFunds();
        const canAfford = this._isCashEnough(amount);

        let wasPaused = false;
        try {
            if (opts.category === 'salary') this._pauseTimeForSalaryConfirm();
            wasPaused = typeof gameState !== 'undefined' && typeof gameState.isPaused === 'function' && gameState.isPaused();
            if (!wasPaused && typeof gameState !== 'undefined' && typeof gameState.setPaused === 'function') {
                gameState.setPaused(true);
            }
        } catch (_) {}

        this._paymentModalOpen = true;
        this._paymentOpts = { ...opts, amount, title, noCancel: mandatory, category: opts.category };
        this._paymentCb = {
            onConfirm: opts.onConfirm,
            onCancel: opts.onCancel,
            wasPaused,
            amount,
            mandatory
        };

        const content = `
            <div style="padding:4px 2px;">
                <div style="text-align:center;margin-bottom:12px;">
                    <div style="font-size:40px;line-height:1;">💳</div>
                    <div style="font-size:16px;font-weight:700;color:#333;margin-top:8px;">${title}</div>
                    <div style="font-size:12px;color:#888;margin-top:4px;">${mandatory ? '必须先付清，余额不足请贷款或破产' : '请确认后再扣款，取消不会支付'}</div>
                </div>
                ${detailHtml ? `<div style="background:#fafafa;border-radius:10px;padding:10px 12px;margin-bottom:12px;">${detailHtml}</div>` : ''}
                <div style="background:linear-gradient(135deg,#fff3e0,#ffe0b2);border-radius:12px;padding:14px 16px;margin-bottom:10px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span style="font-size:13px;color:#666;">应付金额</span>
                        <strong style="font-size:22px;color:#e65100;">¥${amount.toFixed(2)}</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:12px;color:#888;margin-top:8px;">
                        <span>当前资金</span>
                        <span style="color:${canAfford ? '#555' : '#c62828'};">¥${Math.round(funds).toLocaleString()}${canAfford ? '' : '（不足 ¥' + Math.ceil(Math.max(0, amount - funds)).toLocaleString() + '）'}</span>
                    </div>
                </div>
                ${!canAfford && mandatory ? `<div style="font-size:12px;color:#c62828;background:#ffebee;padding:8px 10px;border-radius:8px;margin-bottom:8px;line-height:1.5;">余额不足，无法付款。请申请贷款补足，或宣告破产结束本局。</div>` : ''}
                ${note ? `<div style="font-size:12px;color:#666;line-height:1.5;margin-bottom:4px;">${note}</div>` : ''}
            </div>
        `;
        let footer;
        if (mandatory && !canAfford) {
            footer = `
            <button class="btn btn-secondary" style="flex:1;background:#1565c0;color:#fff;border-color:#1565c0;" onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()" onclick="ui.applyLoanForMandatoryPay()">申请贷款</button>
            <button class="btn btn-primary" style="flex:1;background:#c62828;border-color:#c62828;" onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()" onclick="ui.bankruptForMandatoryPay()">宣告破产</button>`;
        } else if (mandatory) {
            footer = `<button class="btn btn-primary" style="flex:1;background:linear-gradient(135deg,#ff9800,#ef6c00);" onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()" onclick="ui._confirmPaymentOk()">${confirmText}</button>`;
        } else {
            footer = `<button class="btn btn-secondary" style="flex:1;" onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()" onclick="ui._cancelPaymentConfirm()">取消</button>
            <button class="btn btn-primary" style="flex:1.2;background:linear-gradient(135deg,#ff9800,#ef6c00);" onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()" onclick="ui._confirmPaymentOk()">${confirmText}</button>`;
        }
        const overlay = this.showModal(title, content, footer, { width: '480px', lockClose: !!noCancel, modalId: 'mandatoryPayConfirmModal' });
        if (overlay) overlay.dataset.paymentConfirm = '1';
        return overlay;
    }

    _closePaymentOverlayOnly() {
        const overlays = document.querySelectorAll('.modal-overlay');
        if (!overlays || !overlays.length) return;
        const top = overlays[overlays.length - 1];
        if (top && top.dataset && top.dataset.paymentConfirm === '1') top.remove();
        const remaining = document.querySelectorAll('.modal-overlay');
        if (!remaining || remaining.length === 0) {
            try { this.render(); } catch (_) {}
        }
    }

    _confirmPaymentOk() {
        const cb = this._paymentCb;
        if (cb && cb.mandatory && !this._isCashEnough(cb.amount)) {
            this.showToast('余额不足，请先申请贷款或宣告破产');
            try { this.confirmPayment(this._paymentOpts || {}); } catch (_) {}
            return;
        }
        this._paymentCb = null;
        this._paymentModalOpen = false;
        this._closePaymentOverlayOnly();
        try {
            if (cb && typeof cb.onConfirm === 'function') cb.onConfirm();
        } catch (e) {
            console.warn('[confirmPayment]', e);
            this.showToast('支付执行异常');
        }
        try {
            const stillSalary = !!(typeof gameState !== 'undefined' && gameState.state && gameState.state._salaryConfirmPending);
            if ((this._paymentOpts && this._paymentOpts.category === 'salary') || this._salaryTimeHold) {
                if (!stillSalary) this._resumeTimeAfterSalaryConfirm();
            } else if (cb && !cb.wasPaused && typeof gameState !== 'undefined' && typeof gameState.setPaused === 'function') {
                gameState.setPaused(false);
            }
        } catch (_) {}
        setTimeout(() => { try { this._flushPaymentQueue(); } catch (_) {} }, 120);
    }

    applyLoanForMandatoryPay() {
        const opts = this._paymentOpts || {};
        const amount = Number((this._paymentCb && this._paymentCb.amount) || opts.amount) || 0;
        const need = Math.max(0, Math.ceil(amount - this._getShopFunds() + 0.99));
        const result = this._tryEmergencyLoan(need);
        if (result && result.success) {
            this.showToast(`贷款到账 ¥${Math.round(result.loaned || 0).toLocaleString()}，请继续支付`);
            try { this.confirmPayment(opts); } catch (_) {}
            return;
        }
        this.showToast((result && result.message) || '贷款失败，无法补足余额');
        try { this.confirmPayment(opts); } catch (_) {}
    }

    bankruptForMandatoryPay(reason) {
        const msg = reason || '无力支付快递费、工资或税款，店铺破产';
        try {
            const opts = this._paymentOpts || {};
            const missed = (typeof gameState !== 'undefined' && gameState.state
                && Array.isArray(gameState.state._salaryMissedPaydays))
                ? gameState.state._salaryMissedPaydays.slice() : [];
            gameState.state._adBailout = {
                reason: msg,
                amount: Number(opts.amount) || 0,
                category: opts.category || 'salary',
                year: opts.year || null,
                month: opts.month || null,
                billIds: opts.billIds || null,
                salaryMissed: missed
            };
        } catch (_) {}
        this._paymentCb = null;
        this._paymentModalOpen = false;
        this._closePaymentOverlayOnly();
        try {
            if (typeof gameEngine !== 'undefined' && typeof gameEngine._forceBankruptForUnpaidDues === 'function') {
                gameEngine._forceBankruptForUnpaidDues(msg);
            } else if (typeof gameState !== 'undefined' && typeof gameState.triggerEnding === 'function') {
                gameState.triggerEnding('bankrupt');
            }
        } catch (_) {}
        try { this.showForcedBankruptRestart(msg); } catch (_) {}
    }

    _tryEmergencyLoan(needAmount) {
        const need = Math.max(1, Math.ceil(Number(needAmount) || 0));
        if (typeof bankEngine === 'undefined' || typeof bankEngine.applyLoan !== 'function') {
            return { success: false, message: '银行系统不可用' };
        }
        if (typeof BankData === 'undefined' || !Array.isArray(BankData.loanProducts)) {
            return { success: false, message: '没有可申请的贷款产品' };
        }
        let shopLevel = 1, shopRep = 0, turnover = 0;
        try {
            const shop = gameState.state.shop || {};
            shopLevel = shop.level || 1;
            shopRep = shop.reputation || 0;
            turnover = Number(shop.totalSalesAmount || shop.totalRevenue || 0) || 0;
        } catch (_) {}
        const products = BankData.loanProducts.slice().sort((a, b) => (a.minLevel || 1) - (b.minLevel || 1));
        for (let i = 0; i < products.length; i++) {
            const p = products[i];
            if ((p.minLevel || 1) > shopLevel) continue;
            let maxLoan = p.maxAmount || need;
            try {
                if (typeof bankState !== 'undefined' && typeof bankState.getProductMaxLoan === 'function') {
                    maxLoan = bankState.getProductMaxLoan(p, shopLevel, shopRep, turnover);
                }
            } catch (_) {}
            const borrow = Math.min(maxLoan, Math.max(p.minAmount || 1, need));
            if (borrow + 1e-6 < need) continue;
            const term = p.minTerm || 90;
            const res = bankEngine.applyLoan(p.id, borrow, term);
            if (res && res.success) {
                return { success: true, loaned: borrow, message: res.message };
            }
            if (res && res.message) return { success: false, message: res.message };
        }
        return { success: false, message: '没有足够的贷款额度，只能宣告破产' };
    }

    _cancelPaymentConfirm() {
        const cb = this._paymentCb;
        this._paymentCb = null;
        this._paymentModalOpen = false;
        this._closePaymentOverlayOnly();
        try {
            if (cb && typeof cb.onCancel === 'function') cb.onCancel();
        } catch (_) {}
        try {
            if (cb && !cb.wasPaused && typeof gameState !== 'undefined' && typeof gameState.setPaused === 'function') {
                gameState.setPaused(false);
            }
        } catch (_) {}
        setTimeout(() => { try { this._flushPaymentQueue(); } catch (_) {} }, 120);
    }

    // ============================================================
    // 每月1号发薪确认弹窗（自动触发，确认后才扣款）
    // ============================================================
    _pauseTimeForSalaryConfirm() {
        try {
            if (!this._salaryTimeHold) {
                this._salaryTimeHold = {
                    wasPaused: !!(typeof gameState !== 'undefined' && gameState.isPaused && gameState.isPaused())
                };
            }
            if (typeof gameState.setPaused === 'function') gameState.setPaused(true);
            else if (gameState.state && gameState.state.gameTime) gameState.state.gameTime.isPaused = true;
            if (gameState.state && gameState.state._salaryConfirmPending) {
                gameState.state._salaryConfirmPending.wasPaused = this._salaryTimeHold.wasPaused;
            }
            try { this.refreshSkipDayBtn(); } catch (_) {}
        } catch (_) {}
    }

    _resumeTimeAfterSalaryConfirm() {
        try {
            const was = this._salaryTimeHold ? !!this._salaryTimeHold.wasPaused : false;
            this._salaryTimeHold = null;
            if (typeof gameState.setPaused === 'function') gameState.setPaused(!!was);
            else if (gameState.state && gameState.state.gameTime) gameState.state.gameTime.isPaused = !!was;
            try { this.refreshSkipDayBtn(); } catch (_) {}
        } catch (_) {}
    }

    showMonthlySalaryConfirmModal() {
        this._pauseTimeForSalaryConfirm();
        const state = gameState.state;
        const pending = state._salaryConfirmPending || {
            day: state.gameTime.day,
            period: `第${Math.floor((state.gameTime.day - 1) / 30) + 1}月`
        };
        const missed = Array.isArray(state._salaryMissedPaydays) ? state._salaryMissedPaydays : [pending.day];
        const months = Math.max(1, missed.length);
        const payrollPreview = gameState.calculateAllPayroll();
        const cost = payrollPreview.totals.companyCost || 0;
        const net = payrollPreview.totals.net || 0;
        const count = payrollPreview.totals.count || 0;
        const estTotal = cost * months;
        const funds = state.shop.funds || 0;
        const canAfford = funds + 1e-6 >= estTotal;

        const content = `
            <div style="padding:6px 2px 2px;">
                <div style="text-align:center;margin-bottom:14px;">
                    <div style="font-size:42px;line-height:1;">💵</div>
                    <div style="font-size:17px;font-weight:700;color:#333;margin-top:8px;">发薪日确认</div>
                    <div style="font-size:12px;color:#888;margin-top:4px;">每月1号发放工资，须现场确认支付后入账</div>
                </div>
                <div style="background:linear-gradient(135deg,#e8f5e9,#f1f8e9);border-radius:12px;padding:14px 16px;margin-bottom:12px;">
                    <div style="display:flex;justify-content:space-between;font-size:13px;color:#555;margin-bottom:6px;">
                        <span>发薪周期</span><strong style="color:#2e7d32;">${pending.period || ''}</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:13px;color:#555;margin-bottom:6px;">
                        <span>游戏日期</span><strong>第${pending.day}天（月初1号）</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:13px;color:#555;margin-bottom:6px;">
                        <span>在职员工</span><strong>${count}人</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:13px;color:#555;margin-bottom:6px;">
                        <span>本月实发合计</span><strong>¥${Math.round(net).toLocaleString()}</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:13px;color:#555;">
                        <span>企业总成本（含社保）</span><strong style="color:#e65100;">¥${Math.round(cost).toLocaleString()}</strong>
                    </div>
                    ${months > 1 ? `
                    <div style="margin-top:10px;padding-top:10px;border-top:1px dashed #a5d6a7;font-size:12px;color:#33691e;">
                        跳过期间含 <b>${months}</b> 个发薪日，确认后将连续发放 ${months} 次，预估支出约
                        <b>¥${Math.round(estTotal).toLocaleString()}</b>
                    </div>` : ''}
                </div>
                <div style="font-size:12px;color:${canAfford ? '#666' : '#c62828'};line-height:1.5;">
                    当前资金：¥${Math.round(funds).toLocaleString()}
                    ${canAfford ? '' : `（不足 ¥${Math.ceil(Math.max(0, estTotal - funds)).toLocaleString()}）`}
                </div>
                ${!canAfford ? `<div style="font-size:12px;color:#c62828;background:#ffebee;padding:8px 10px;border-radius:8px;margin-top:8px;line-height:1.5;">余额不足，无法发薪。请申请贷款补足，或宣告破产。</div>` : ''}
                <div style="font-size:11px;color:#999;margin-top:8px;line-height:1.45;">
                    💡 必须先付清工资。余额不足只能贷款或破产，无法关闭此窗口。
                </div>
            </div>
        `;
        const footer = canAfford
            ? `<button class="btn btn-primary" style="flex:1;background:linear-gradient(135deg,#4caf50,#2e7d32);" onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()" onclick="ui.confirmMonthlySalaryPay()">确认支付 ¥${Math.round(estTotal).toLocaleString()}</button>`
            : `<button class="btn btn-secondary" style="flex:1;background:#1565c0;color:#fff;border-color:#1565c0;" onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()" onclick="ui.applyLoanForSalaryPay()">申请贷款</button>
            <button class="btn btn-primary" style="flex:1;background:#c62828;border-color:#c62828;" onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()" onclick="ui.bankruptForMandatoryPay('无力支付员工工资，店铺破产')">宣告破产</button>`;
        this.showModal('📅 每月发薪确认', content, footer, { modalId: 'monthlySalaryConfirmModal', lockClose: true });
    }

    confirmMonthlySalaryPay() {
        if (typeof gameEngine === 'undefined' || typeof gameEngine.confirmMonthlySalary !== 'function') {
            this.showToast('发薪系统不可用');
            return;
        }
        const missed = Array.isArray(gameState.state._salaryMissedPaydays) ? gameState.state._salaryMissedPaydays : [];
        const months = Math.max(1, missed.length || 1);
        let est = 0;
        try {
            const preview = gameState.calculateAllPayroll();
            est = (preview.totals.companyCost || 0) * months;
        } catch (_) {}
        if (est > 0 && !this._isCashEnough(est)) {
            this.showToast('余额不足，请先申请贷款或宣告破产');
            try { this.showMonthlySalaryConfirmModal(); } catch (_) {}
            return;
        }
        const result = gameEngine.confirmMonthlySalary();
        if (result && result.success) {
            this.closeModal({ force: true });
            const monthsPaid = result.monthsPaid > 1 ? `（${result.monthsPaid}个月）` : '';
            this.showToast(`✅ 工资已发放${monthsPaid}，共支出 ¥${Math.round(result.totalPaid || 0).toLocaleString()}`);
            this._resumeTimeAfterSalaryConfirm();
        } else {
            this.showToast((result && result.message) || '发放失败');
            // 资金不足时刷新弹窗金额提示
            try { this.showMonthlySalaryConfirmModal(); } catch (_) {}
        }
    }

    applyLoanForSalaryPay() {
        const missed = Array.isArray(gameState.state._salaryMissedPaydays) ? gameState.state._salaryMissedPaydays : [];
        const months = Math.max(1, missed.length || 1);
        let est = 0;
        try {
            const preview = gameState.calculateAllPayroll();
            est = (preview.totals.companyCost || 0) * months;
        } catch (_) {}
        const need = Math.max(0, Math.ceil(est - this._getShopFunds() + 0.99));
        const result = this._tryEmergencyLoan(need);
        if (result && result.success) {
            this.showToast(`贷款到账 ¥${Math.round(result.loaned || 0).toLocaleString()}，请继续支付工资`);
        } else {
            this.showToast((result && result.message) || '贷款失败');
        }
        try { this.showMonthlySalaryConfirmModal(); } catch (_) {}
    }

    deferMonthlySalaryConfirm() {
        // 弹窗前玩家是否已暂停（deferMonthlySalary 会清掉 pending，必须先读）
        let wasPaused = false;
        try {
            wasPaused = !!(gameState.state && gameState.state._salaryConfirmPending && gameState.state._salaryConfirmPending.wasPaused);
        } catch (_) {}
        if (typeof gameEngine !== 'undefined' && typeof gameEngine.deferMonthlySalary === 'function') {
            gameEngine.deferMonthlySalary();
        }
        this.closeModal({ force: true });
        this._resumeTimeAfterSalaryConfirm();
    }

    // ============================================================
    // 执行发放工资（员工管理内手动）
    // ============================================================
    executePayroll() {
        const day = (gameState.state.gameTime && gameState.state.gameTime.day) || 1;
        const lastPaid = gameState.state.lastSalaryPayDay || 0;
        const periodStart = Math.floor((day - 1) / 30) * 30 + 1;
        const hasPending = !!(gameState.state._salaryConfirmPending
            || (gameState.state._salaryMissedPaydays || []).length);

        // 本月已发且无欠薪：禁止手动再发一遍
        if (!hasPending && lastPaid >= periodStart) {
            this.showToast('本月工资已发放，无需重复操作');
            return;
        }

        const payrollPreview = gameState.calculateAllPayroll();
        const cost = payrollPreview.totals.companyCost;
        const net = payrollPreview.totals.net;
        
        this.confirmPayment({
            title: '员工工资 · 现场支付',
            category: 'salary',
            noCancel: true,
            amount: cost,
            detailHtml: `<div style="font-size:13px;line-height:1.7;">
                <div>员工人数：<b>${payrollPreview.totals.count}人</b></div>
                <div>实发总额：<b>¥${Math.round(net).toLocaleString()}</b></div>
                <div>企业总成本（含社保）：<b style="color:#e65100;">¥${Math.round(cost).toLocaleString()}</b></div>
            </div>`,
            note: '须现场确认支付后才会扣款并发薪，发放后将重置月度考勤。',
            confirmText: `确认支付 ¥${Math.round(cost).toLocaleString()}`,
            onConfirm: () => {
                if (hasPending) {
                    const result = gameEngine.confirmMonthlySalary();
                    if (result && result.success) {
                        this.showToast(`✅ 工资已发放！共支出 ¥${Math.round(result.totalPaid || 0).toLocaleString()}`);
                    } else {
                        this.showToast((result && result.message) || '发放失败');
                    }
                    return;
                }
                const result = gameState.settleEmployeeSalaries();
                if (result.success) {
                    gameState.state._salaryConfirmPending = null;
                    gameState.state._salaryMissedPaydays = [];
                    gameState.state._salaryDeferredPayday = null;
                    this.showToast(`✅ 工资已发放！共支出 ¥${Math.round(result.record.companyCost).toLocaleString()}`);
                } else {
                    this.showToast(result.message || '发放失败');
                }
            }
        });
    }

    showRedeemCodeModal() {
        const content = `
            <div style="padding:10px 0;">
                <div style="text-align:center;margin-bottom:20px;">
                    <div style="font-size:48px;">🎁</div>
                    <div style="font-size:16px;font-weight:bold;color:#333;margin-top:8px;">兑换码领取</div>
                    <div style="font-size:12px;color:#999;margin-top:4px;">输入兑换码领取丰厚奖励</div>
                </div>
                <div style="margin-bottom:5px;">
                    <input type="text" id="redeemCodeInput" placeholder="请输入兑换码" 
                           style="width:100%;padding:12px;border:1px solid #e0e0e0;border-radius:8px;font-size:15px;box-sizing:border-box;outline:none;"
                           oninput="this.style.borderColor = this.value ? '#ff6b35' : '#e0e0e0'">
                </div>
            </div>
        `;

        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>
            <button class="btn btn-primary" onclick="ui.redeemCode()">立即兑换</button>
        `;

        this.showModal('兑换码', content, footer);
        
        setTimeout(() => {
            const input = document.getElementById('redeemCodeInput');
            if (input) {
                input.focus();
                input.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        ui.redeemCode();
                    }
                });
            }
        }, 100);
    }

    redeemCode() {
        const input = document.getElementById('redeemCodeInput');
        const code = input ? input.value : '';
        
        const result = gameState.redeemCode(code);
        if (result.success) {
            this.closeModal();
            try {
                if (typeof this.refreshSkipDayBtn === 'function') this.refreshSkipDayBtn();
            } catch (_) {}
            this.showToast(result.message, 'success');
        } else {
            this.showToast(result.message || '兑换失败');
            if (input) {
                input.style.borderColor = '#f44336';
                input.value = '';
                setTimeout(() => { input.style.borderColor = '#e0e0e0'; }, 500);
            }
        }
    }

    showAchievementsModal() {
        const state = gameState.state;
        const categories = {
            order: { name: '订单成就', icon: '📦' },
            sales: { name: '销售成就', icon: '💰' },
            profit: { name: '利润成就', icon: '📈' },
            review: { name: '评价成就', icon: '⭐' },
            product: { name: '商品成就', icon: '🛍️' },
            employee: { name: '员工成就', icon: '👥' },
            level: { name: '等级成就', icon: '🏅' },
            fun: { name: '趣味成就', icon: '🎮' }
        };

        const unlockedIds = (state.achievements && Array.isArray(state.achievements.unlocked))
            ? state.achievements.unlocked : [];
        const allAch = (typeof ACHIEVEMENTS !== 'undefined' && ACHIEVEMENTS) ? ACHIEVEMENTS : [];
        let content = `<div style="font-size:13px;color:#666;margin-bottom:12px;text-align:center;">
            已解锁 ${unlockedIds.length} / ${allAch.length} 个成就
        </div>`;

        Object.entries(categories).forEach(([catKey, catInfo]) => {
            const catAchievements = allAch.filter(a => a.category === catKey);
            if (catAchievements.length === 0) return;

            content += `
                <div style="margin-bottom:15px;">
                    <div style="font-size:14px;font-weight:bold;margin-bottom:8px;color:#333;">
                        ${catInfo.icon} ${catInfo.name}
                    </div>
                    <div style="display:grid;grid-template-columns:1fr;gap:8px;">
                        ${catAchievements.map(a => {
                            const unlocked = unlockedIds.indexOf(a.id) >= 0;
                            const rewardText = a.reward.type === 'money' 
                                ? `奖励: ¥${a.reward.value}` 
                                : `奖励: ${a.reward.buffType === 'traffic' ? '流量+' : '转化率+'}${(a.reward.value * 100).toFixed(0)}%`;
                            // ===== 成就进度（深化）：未解锁成就显示当前值/目标值进度条 =====
                            const metric = !unlocked && typeof gameState.getAchievementMetric === 'function'
                                ? gameState.getAchievementMetric(a) : null;
                            const unitLabel = metric ? (() => {
                                const t = metric.type;
                                if (t === 'totalSales' || t === 'totalProfit') return `¥${formatMoney(metric.current)} / ¥${formatMoney(metric.target)}`;
                                if (t === 'reputation') return `${metric.current.toFixed(1)} / ${metric.target} 星`;
                                if (t === 'shopLevel') return `Lv.${metric.current} / Lv.${metric.target}`;
                                if (t === 'days') return `第${metric.current} / ${metric.target} 天`;
                                if (t === 'activeListings') return `${metric.current} / ${metric.target} 款`;
                                if (t === 'employees') return `${metric.current} / ${metric.target} 人`;
                                return `${metric.current} / ${metric.target} ${t === 'goodReviews' || t === 'badReviews' ? '个' : '单'}`;
                            })() : '';
                            return `
                                <div style="padding:10px;border-radius:8px;
                                            background:${unlocked ? '#fff8e1' : '#fafafa'};
                                            display:flex;align-items:center;gap:10px;
                                            border:1px solid ${unlocked ? '#ffe082' : '#eee'};">
                                    <div style="font-size:28px;filter:${unlocked ? 'none' : 'grayscale(100%) opacity(0.4)'};">
                                        ${a.icon}
                                    </div>
                                    <div style="flex:1;">
                                        <div style="font-size:14px;font-weight:${unlocked ? 'bold' : 'normal'};
                                                    color:${unlocked ? '#333' : '#999'};">
                                            ${a.name}
                                        </div>
                                        <div style="font-size:12px;color:${unlocked ? '#666' : '#bbb'};margin-top:2px;">
                                            ${a.description}
                                        </div>
                                        <div style="font-size:11px;color:${unlocked ? '#ff9800' : '#ccc'};margin-top:3px;">
                                            ${rewardText}
                                        </div>
                                        ${metric ? `
                                        <div style="margin-top:6px;">
                                            <div style="font-size:10px;color:#999;margin-bottom:2px;">${unitLabel}</div>
                                            <div style="height:5px;background:#eee;border-radius:3px;overflow:hidden;">
                                                <div style="height:100%;width:${metric.pct}%;background:linear-gradient(90deg,#4fc3f7,#2196f3);border-radius:3px;"></div>
                                            </div>
                                        </div>` : ''}
                                    </div>
                                    ${unlocked ? '<div style="color:#4caf50;font-size:20px;">✓</div>' : ''}
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        });

        const footer = `
            <button class="btn btn-primary" onclick="ui.closeModal()">知道了</button>
        `;

        this.showModal('成就收集', content, footer, { modalId: 'achievementsModal' });
    }

    // ==================== 手动存档槽位 + 导出导入 ====================

    _archiveSlotSave(n) {
        if (typeof saveManager === 'undefined') { this.showToast('存档系统未加载', 2000); return; }
        const doSave = async () => {
            try {
                this.showToast('正在保存到槽位 ' + n + '…', 1000);
                await saveManager.flushSave();
                await saveManager.saveToManualSlot(n);
                this.showToast('已保存到槽位 ' + n);
                this._archiveRefreshManager();
            } catch (e) {
                this.showToast('保存失败: ' + ((e && e.message) || e), 3000);
            }
        };
        doSave();
    }

    _archiveSlotLoad(n) {
        if (typeof saveManager === 'undefined') { this.showToast('存档系统未加载', 2000); return; }
        if (!confirm('载入槽位 ' + n + ' 将覆盖当前进度并重新启动游戏。\n确定继续吗？')) return;
        const doLoad = async () => {
            try {
                await saveManager.loadManualSlot(n);
                // loadManualSlot 内部会整页重载
            } catch (e) {
                this.showToast('载入失败: ' + ((e && e.message) || e), 3000);
            }
        };
        doLoad();
    }

    _archiveSlotDelete(n) {
        if (typeof saveManager === 'undefined') { this.showToast('存档系统未加载', 2000); return; }
        if (!confirm('删除槽位 ' + n + ' 的存档？此操作不可撤销。')) return;
        const doDelete = async () => {
            try {
                await saveManager.deleteManualSlot(n);
                this.showToast('槽位 ' + n + ' 已删除');
                this._archiveRefreshManager();
            } catch (e) {
                this.showToast('删除失败: ' + ((e && e.message) || e), 3000);
            }
        };
        doDelete();
    }

    _archiveRefreshManager() {
        try {
            if (typeof saveManager !== 'undefined' && typeof saveManager.getArchiveInfo === 'function') {
                saveManager.getArchiveInfo().then((info) => this._renderArchiveManagerContent(info)).catch(() => {});
            }
        } catch (_) {}
    }

    _archiveExport() {
        if (typeof saveManager === 'undefined') { this.showToast('存档系统未加载', 2000); return; }
        const doExport = async () => {
            try {
                this.showToast('正在生成存档文件…', 1000);
                await saveManager.flushSave();
                const r = await saveManager.exportSaveText('main');
                this._exportResult = r;
                const content = `
                    <div style="padding:4px;">
                        <div style="font-size:12px;color:#666;margin-bottom:8px;line-height:1.6;">
                            存档文本已生成（约 <b>${r.sizeKB}KB</b>）。可「下载文件」保存到网盘/电脑，
                            或「复制」后粘贴到备忘录；换设备或重装后到存档管理点「导入存档」即可恢复进度。
                        </div>
                        <div style="font-size:11px;color:#c62828;background:#ffebee;padding:6px 8px;border-radius:6px;margin-bottom:8px;line-height:1.5;">
                            ⚠️ 该文本带防伪签名，请勿手动编辑任何一个字符；被改过的存档导入时会被直接拒绝。
                        </div>
                        <textarea id="exportSaveText" readonly
                            style="width:100%;height:120px;font-size:11px;font-family:monospace;box-sizing:border-box;padding:6px;">${escapeHtml(r.text)}</textarea>
                    </div>`;
                const footer = `
                    <button type="button" class="btn btn-primary" onclick="ui._archiveExportDownload()">⬇️ 下载文件</button>
                    <button type="button" class="btn btn-secondary" onclick="ui._archiveExportCopy()">📋 复制</button>
                    <button type="button" class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>`;
                this.showModal('📤 导出存档', content, footer, { modalId: 'exportSaveModal', width: '440px' });
            } catch (e) {
                this.showToast('导出失败: ' + ((e && e.message) || e), 3000);
            }
        };
        doExport();
    }

    _archiveExportDownload() {
        if (!this._exportResult || !this._exportResult.text) return;
        const text = this._exportResult.text;
        const d = new Date();
        const pad = (x) => String(x).padStart(2, '0');
        const name = '电商经营模拟器存档_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
            '_' + pad(d.getHours()) + pad(d.getMinutes()) + '.txt';

        // App 环境：写入公共下载目录（_downloads/Download）
        if (typeof plus !== 'undefined' && plus.io) {
            try {
                plus.io.requestFileSystem(plus.io.PUBLIC_DOWNLOADS, (fs) => {
                    fs.root.getFile(name, { create: true }, (fe) => {
                        fe.createWriter((w) => {
                            w.onwrite = () => this.showToast('已保存到下载目录：' + name, 3000);
                            w.onerror = () => this._archiveExportDownloadBlob(text, name);
                            try { w.write(text); } catch (_) { this._archiveExportDownloadBlob(text, name); }
                        }, () => this._archiveExportDownloadBlob(text, name));
                    }, () => this._archiveExportDownloadBlob(text, name));
                }, () => this._archiveExportDownloadBlob(text, name));
                return;
            } catch (_) {}
        }
        this._archiveExportDownloadBlob(text, name);
    }

    _archiveExportDownloadBlob(text, name) {
        try {
            const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = name;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                try { URL.revokeObjectURL(a.href); } catch (_) {}
                try { a.remove(); } catch (_) {}
            }, 1000);
            this.showToast('开始下载：' + name);
        } catch (e) {
            this.showToast('下载失败，请改用「复制」保存文本', 3000);
        }
    }

    _archiveExportCopy() {
        const ta = document.getElementById('exportSaveText');
        if (!ta) return;
        const done = () => this.showToast('已复制到剪贴板');
        try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                navigator.clipboard.writeText(ta.value).then(done, () => {
                    ta.select();
                    try { document.execCommand('copy'); } catch (_) {}
                    done();
                });
                return;
            }
        } catch (_) {}
        ta.select();
        try { document.execCommand('copy'); } catch (_) {}
        done();
    }

    _archiveImport() {
        if (typeof saveManager === 'undefined') { this.showToast('存档系统未加载', 2000); return; }
        const content = `
            <div style="padding:4px;">
                <div style="font-size:12px;color:#666;margin-bottom:8px;line-height:1.6;">
                    把之前导出的存档文本<b>完整粘贴</b>到下面，点「开始导入」恢复进度。
                    导入会<b>覆盖当前进度</b>并重启游戏，建议先把当前进度保存到手动槽位。
                </div>
                <textarea id="importSaveText" placeholder="在此粘贴存档文本…"
                    style="width:100%;height:150px;font-size:11px;font-family:monospace;box-sizing:border-box;padding:6px;"></textarea>
            </div>`;
        const footer = `
            <button type="button" class="btn btn-primary" onclick="ui._archiveDoImport()">开始导入</button>
            <button type="button" class="btn btn-secondary" onclick="ui.closeModal()">取消</button>`;
        this.showModal('📥 导入存档', content, footer, { modalId: 'importSaveModal', width: '440px' });
    }

    _archiveDoImport() {
        if (typeof saveManager === 'undefined') return;
        const ta = document.getElementById('importSaveText');
        const text = ta ? ta.value : '';
        if (!text || !String(text).trim()) { this.showToast('请先粘贴存档文本'); return; }
        if (!confirm('导入将覆盖当前进度并重新启动游戏。\n确定继续吗？')) return;
        const doImport = async () => {
            try {
                await saveManager.flushSave();
                const r = await saveManager.importSaveText(String(text).trim());
                // 导入时若体检重置过字段（异常数值），给出明确提示，避免玩家以为进度"被吞了"
                const fixed = (r && Array.isArray(r.sanitized)) ? r.sanitized : [];
                this.showToast(fixed.length
                    ? ('导入成功，异常数值已重置（' + fixed.join('、') + '），正在重启游戏…')
                    : '导入成功，正在重启游戏…', 2500);
                setTimeout(() => {
                    try { if (typeof location !== 'undefined' && location.reload) location.reload(); } catch (_) {}
                }, 900);
            } catch (e) {
                this.showToast('导入失败: ' + ((e && e.message) || e), 4000);
            }
        };
        doImport();
    }

    getSkipDayBtnLabel() {
        return '⏩ 跳1天';
    }

    refreshSkipDayBtn() {
        const b = document.getElementById('skipDayBtn');
        if (!b) return;
        try {
            if (typeof gameEngine !== 'undefined' && gameEngine && gameEngine._skipping) return;
        } catch (_) {}
        // 暂停时跳一天按钮禁用（与 1x/4x 一致），恢复后自动放开
        try {
            if (typeof gameState.isPaused === 'function' && gameState.isPaused()) {
                b.setAttribute('disabled', 'true');
                b.style.opacity = '0.4';
                b.style.pointerEvents = 'none';
                b.innerHTML = this.getSkipDayBtnLabel();
                b.title = '时间已暂停，点击 ▶ 恢复后才能跳天';
                return;
            }
        } catch (_) {}
        b.removeAttribute('disabled');
        b.style.opacity = '';
        b.style.pointerEvents = '';
        b.innerHTML = this.getSkipDayBtnLabel();
        // 剩余次数提示
        try {
            const q = (typeof gameState.getSkipDayQuota === 'function') ? gameState.getSkipDayQuota() : 0;
            b.title = `直接跳过一整天（会完整生成所有订单、执行每日结算）· 剩余 ${q} 次，用尽可看广告+5 或花1000万买1次`;
        } catch (_) {}
    }

    requestSkipDay() {
        // 暂停保护：时间暂停时不可跳天（与 1x/4x 同规则）
        try {
            if (typeof gameState.isPaused === 'function' && gameState.isPaused()) {
                this.refreshSkipDayBtn();
                this.showToast('⏸ 时间已暂停，请先点击 ▶ 恢复');
                return;
            }
        } catch (_) {}
        // 跳一天次数闸门：用尽弹「看广告/购买」补给弹窗
        let q = 0;
        try {
            q = (typeof gameState.getSkipDayQuota === 'function') ? gameState.getSkipDayQuota() : 0;
        } catch (_) {}
        if (!(q > 0)) {
            this.promptSkipDayQuotaAd();
            return;
        }
        try {
            if (typeof gameEngine !== 'undefined' && gameEngine && typeof gameEngine.skipDay === 'function') {
                gameEngine.skipDay(1);
            }
        } catch (e) {
            console.warn('[requestSkipDay]', e);
        }
    }

    /** 跳一天次数不足：看广告 +5 / 花1000万买1次 */
    promptSkipDayQuotaAd() {
        const add = (typeof RewardedAdManager !== 'undefined' && RewardedAdManager.QUOTA_PER_AD) || 5;
        this.showModal('跳一天次数不足', `
            <div style="font-size:13px;line-height:1.7;color:#444;">
                <div style="text-align:center;font-size:36px;margin-bottom:8px;">⏩</div>
                <div>跳一天次数已用尽。</div>
                <div style="margin-top:8px;">完整观看一条激励广告，可增加 <b style="color:#ff6b35;">${add}</b> 次跳一天。</div>
                <div style="margin-top:8px;">或花费 <b>¥1000万</b> 购买 1 次。</div>
            </div>`,
            `<button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>
             <button class="btn btn-secondary" onclick="ui.closeModal();ui.buyQuotaWithFunds('skipDay')">花1000万买1次</button>
             <button class="btn btn-primary" onclick="ui.closeModal();ui.watchAdForSkipDayQuota()">看广告 +${add}</button>`,
            { width: '420px', modalId: 'skipDayQuotaAdModal' });
    }

    watchAdForSkipDayQuota() {
        try {
            if (typeof RewardedAdManager === 'undefined' || !RewardedAdManager.showForQuota) {
                this.showToast('广告模块未加载');
                return;
            }
            RewardedAdManager.showForQuota('skipDay');
        } catch (e) {
            console.warn('[watchAdForSkipDayQuota]', e);
            this.showToast('广告启动失败');
        }
    }

    buyQuotaWithFunds(kind) {
        try {
            const r = gameState.buyActionQuota('skipDay');
            if (!r || !r.ok) {
                this.showToast((r && r.error) || '购买失败');
                return;
            }
            this.showToast(`已花费 ¥1000万，跳一天剩余 ${r.left} 次`);
            this.refreshSkipDayBtn();
        } catch (e) {
            this.showToast('购买失败');
        }
    }

    showEventLogModal() {
        const state = gameState.state;
        const ev = (state && state.events) || {};
        const eventLog = Array.isArray(ev.eventLog) ? ev.eventLog : [];
        const activeEvents = Array.isArray(ev.activeEvents) ? ev.activeEvents : [];

        let content = '';

        if (activeEvents.length > 0) {
            content += `
                <div style="margin-bottom:15px;">
                    <div style="font-size:14px;font-weight:bold;margin-bottom:8px;color:#333;">
                        ⏰ 进行中的事件
                    </div>
                    ${activeEvents.map(e => {
                        const src = (typeof RANDOM_EVENTS !== 'undefined' && Array.isArray(RANDOM_EVENTS))
                            ? RANDOM_EVENTS.find(x => x && x.id === e.id) : null;
                        const canCrisis = !!(src && src.crisis);
                        return `
                        <div style="padding:10px;border-radius:8px;
                                    background:${e.type === 'good' ? '#e8f5e9' : e.type === 'bad' ? '#ffebee' : '#e3f2fd'};
                                    margin-bottom:6px;display:flex;align-items:center;gap:10px;">
                            <div style="font-size:24px;">${e.icon}</div>
                            <div style="flex:1;">
                                <div style="font-size:13px;font-weight:bold;">${e.name}</div>
                                <div style="font-size:12px;color:#666;margin-top:2px;">${e.effect?.message || ''}</div>
                            </div>
                            <div style="text-align:right;">
                                <div style="font-size:12px;color:#666;white-space:nowrap;">剩余 ${e.remainingDuration}h</div>
                                ${canCrisis ? `<button class="btn btn-primary btn-small" style="margin-top:6px;" onclick="ui.closeModal();ui.showCrisisModal('${e.id}')">继续处理</button>` : ''}
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            `;
        }

        content += `
            <div style="font-size:14px;font-weight:bold;margin-bottom:8px;color:#333;">
                📜 历史事件
            </div>
        `;

        if (eventLog.length === 0) {
            content += `
                <div style="text-align:center;padding:30px;color:#999;font-size:13px;">
                    暂无事件记录<br>
                    <span style="font-size:12px;">经营过程中会随机触发各种事件</span>
                </div>
            `;
        } else {
            content += `
                <div style="max-height:300px;overflow-y:auto;">
                    ${eventLog.map(e => `
                        <div style="padding:10px 0;border-bottom:1px solid #f0f0f0;display:flex;gap:10px;">
                            <div style="font-size:24px;">${e.icon}</div>
                            <div style="flex:1;">
                                <div style="font-size:13px;font-weight:bold;color:#333;">${e.name}</div>
                                <div style="font-size:12px;color:#666;margin-top:2px;">${e.message}</div>
                                <div style="font-size:11px;color:#999;margin-top:3px;">第${e.day}天 ${e.hour}:00</div>
                            </div>
                            <div style="font-size:12px;
                                        color:${e.type === 'good' ? '#4caf50' : e.type === 'bad' ? '#f44336' : '#2196f3'};
                                        align-self:flex-start;">
                                ${e.type === 'good' ? '好事' : e.type === 'bad' ? '坏事' : '中性'}
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        const footer = `
            <button class="btn btn-primary" onclick="ui.closeModal()">知道了</button>
        `;

        this.showModal('事件记录', content, footer, { modalId: 'eventLogModal' });
    }

    _lbEsc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    _lbMoney(n) {
        const v = Number(n) || 0;
        if (typeof formatMoney === 'function') return formatMoney(v);
        return '¥' + Math.round(v).toLocaleString();
    }

    showLeaderboardModal(board) {
        if (typeof LeaderboardClient === 'undefined' || !LeaderboardClient.isOnline()) {
            this.showToast('排行榜暂未开放');
            return;
        }
        this._lbBoard = board || this._lbBoard || 'netWorth';
        const boards = (typeof LeaderboardClient !== 'undefined' && LeaderboardClient.BOARDS)
            ? LeaderboardClient.BOARDS
            : [
                { id: 'netWorth', name: '净资产', icon: '💎' },
                { id: 'funds', name: '资金', icon: '💰' },
                { id: 'sales', name: '流水', icon: '📈' },
                { id: 'reputation', name: '信誉', icon: '⭐' }
            ];
        const optIn = typeof LeaderboardClient !== 'undefined' && LeaderboardClient.isOptIn && LeaderboardClient.isOptIn();
        const injected = !!(gameState && gameState.state && gameState.state.settings && gameState.state.settings.moneyInjected);
        const apiBase = (typeof LeaderboardClient !== 'undefined' && LeaderboardClient.getBase)
            ? LeaderboardClient.getBase() : '';
        let mySnap = null;
        try {
            if (typeof LeaderboardClient !== 'undefined' && LeaderboardClient.collectSnapshot) {
                mySnap = LeaderboardClient.collectSnapshot(gameState);
            }
        } catch (_) {}

        const tabs = boards.map(b => {
            const on = b.id === this._lbBoard;
            return `<button type="button" class="btn ${on ? 'btn-primary' : 'btn-secondary'} btn-small"
                style="flex:1;min-width:0;padding:8px 4px;font-size:12px;"
                onclick="ui.showLeaderboardModal('${b.id}')">${b.icon} ${b.name}</button>`;
        }).join('');

        const content = `
            <div style="font-size:11px;color:#888;margin-bottom:8px;">服务器 ${this._lbEsc(apiBase)}</div>
            <div style="display:flex;gap:6px;margin-bottom:10px;">${tabs}</div>
            <div style="padding:10px;border-radius:10px;background:#f7f7f8;margin-bottom:10px;font-size:12px;color:#555;">
                <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;">
                    <input type="checkbox" ${optIn ? 'checked' : ''}
                        onchange="ui.toggleLeaderboardOptIn(this.checked)"
                        style="margin-top:2px;">
                    <span>同意把店名、资金、流水、信誉上传到全服榜（不含完整存档）</span>
                </label>
                ${injected ? '<div style="margin-top:8px;color:#c62828;">本存档使用过广告金/兑换码，成绩不会上报，避免刷榜。</div>' : ''}
                ${mySnap ? `<div style="margin-top:8px;color:#333;">本店快照：净资产 ${this._lbMoney(mySnap.netWorth)} · 流水 ${this._lbMoney(mySnap.sales)} · Lv.${mySnap.level} · 第${mySnap.days}天</div>` : ''}
            </div>
            <div id="lbBoardBody" style="min-height:180px;text-align:center;color:#999;padding:24px 8px;">正在连接全服榜…</div>
        `;
        const footer = `
            <button class="btn btn-secondary" onclick="ui.submitLeaderboardNow()">上报成绩</button>
            <button class="btn btn-primary" onclick="ui.closeModal()">关闭</button>
        `;
        this.showModal('🏅 全服排行榜', content, footer, { modalId: 'leaderboardModal', width: '520px' });
        this._loadLeaderboardBoard();
    }

    toggleLeaderboardOptIn(on) {
        if (typeof LeaderboardClient === 'undefined') return;
        LeaderboardClient.setOptIn(!!on);
        this.showToast(on ? '已开启上榜' : '已关闭上榜');
        if (on) this.submitLeaderboardNow(true);
    }

    submitLeaderboardNow(quiet) {
        if (typeof LeaderboardClient === 'undefined') {
            this.showToast('排行榜模块未加载');
            return;
        }
        if (!LeaderboardClient.isOptIn()) {
            LeaderboardClient.setOptIn(true);
        }
        LeaderboardClient.submit(gameState, true).then((data) => {
            if (data && data.skipped) {
                const map = {
                    money_injected: '本存档有注入资金，不能上榜',
                    opt_out: '尚未同意上榜',
                    throttle: '上报太频繁，稍后再试'
                };
                this.showToast(map[data.reason] || ('未上报：' + (data.reason || '已跳过')));
                return;
            }
            if (!quiet) this.showToast('成绩已提交');
            this._loadLeaderboardBoard();
        }).catch((e) => {
            this.showToast('上报失败：连不上服务器');
            console.warn('[排行榜] submit', e);
        });
    }

    _loadLeaderboardBoard() {
        const body = document.getElementById('lbBoardBody');
        if (!body) return;
        if (typeof LeaderboardClient === 'undefined' || typeof LeaderboardClient.fetchBoard !== 'function') {
            body.innerHTML = '排行榜客户端未加载';
            return;
        }
        const board = this._lbBoard || 'netWorth';
        LeaderboardClient.fetchBoard(board, 50).then((data) => {
            const rawList = data && (data.list || data.rows || data.items);
            const list = Array.isArray(rawList) ? rawList : (rawList ? [rawList] : []);
            const me = (data && data.me) || null;
            const myId = LeaderboardClient.getIdentity().playerId;
            let html = '';
            if (me && me.rank) {
                html += `<div style="margin-bottom:10px;padding:8px 10px;border-radius:8px;background:#fff3e0;font-size:13px;color:#e65100;text-align:left;">
                    我的排名 第 <b>${this._lbEsc(me.rank)}</b> 名
                    ${me.score != null ? ' · ' + (board === 'reputation' ? this._lbEsc(me.score) + ' 信誉' : this._lbMoney(me.score)) : ''}
                </div>`;
            }
            if (!list.length) {
                html += `<div style="padding:20px;color:#999;">暂无上榜数据<br><span style="font-size:12px;">同意上榜后点「上报成绩」</span></div>`;
                body.innerHTML = html;
                return;
            }
            html += '<div style="text-align:left;">';
            list.forEach((row, i) => {
                const rank = row.rank || (i + 1);
                const pid = String(row.playerId || '');
                const mine = pid && pid === myId;
                const score = row.score != null ? row.score : (row[board] != null ? row[board] : row.netWorth);
                const scoreText = board === 'reputation'
                    ? (Number(score) || 0).toFixed(0) + ' 信誉'
                    : this._lbMoney(score);
                const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
                html += `<div style="display:flex;gap:8px;align-items:center;padding:8px 4px;border-bottom:1px solid #f0f0f0;${mine ? 'background:#fff8e1;border-radius:6px;' : ''}">
                    <div style="width:36px;text-align:center;font-weight:700;color:#666;">${medal}</div>
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:13px;font-weight:700;color:#222;">${this._lbEsc(row.shopName || row.name || '未命名店铺')}${mine ? ' <span style="font-size:10px;color:#ef6c00;">我</span>' : ''}</div>
                        <div style="font-size:11px;color:#888;">${this._lbEsc(row.name || '店主')} · Lv.${this._lbEsc(row.level || 1)} · 第${this._lbEsc(row.days || 1)}天</div>
                    </div>
                    <div style="font-size:12px;font-weight:700;color:#d32f2f;white-space:nowrap;">${scoreText}</div>
                </div>`;
            });
            html += '</div>';
            const total = data && (data.total || data.count);
            if (total) html += `<div style="margin-top:8px;font-size:11px;color:#999;">全服 ${total} 家店铺</div>`;
            body.innerHTML = html;
        }).catch((e) => {
            console.warn('[排行榜] fetch', e);
            body.innerHTML = `<div style="color:#c62828;padding:12px 4px;">连不上排行榜服务器<br>
                <span style="font-size:12px;color:#888;">请确认 ECS 已启动排行榜服务（默认 http://8.163.49.40）</span></div>`;
        });
    }

    // ==================== 危机应对决策（事件系统深化） ====================
    showCrisisModal(eventId) {
        const event = (typeof RANDOM_EVENTS !== 'undefined' && Array.isArray(RANDOM_EVENTS))
            ? RANDOM_EVENTS.find(e => e && e.id === eventId) : null;
        if (!event || !event.crisis) return;
        const cost = Number(event.crisis.mitigateCost) || 0;
        const funds = (gameState.state.shop && gameState.state.shop.funds) || 0;
        const content = `
            <div style="padding:8px 2px;">
                <div style="text-align:center;font-size:44px;margin-bottom:10px;">${event.icon}</div>
                <div style="text-align:center;font-size:16px;font-weight:800;color:#c62828;margin-bottom:6px;">${event.name}</div>
                <div style="text-align:center;font-size:13px;color:#666;margin-bottom:16px;">${event.description}</div>
                <div style="display:flex;flex-direction:column;gap:10px;">
                    <button class="btn btn-primary" style="padding:14px;font-size:14px;${funds >= cost ? '' : 'opacity:0.6;'}"
                        onclick="ui.chooseCrisis('${event.id}', 'mitigate')">
                        🛡️ 花钱化解（¥${cost.toLocaleString()}）<br>
                        <span style="font-size:11px;font-weight:normal;">${event.crisis.mitigateDesc}</span>
                    </button>
                    <button class="btn btn-secondary" style="padding:14px;font-size:14px;"
                        onclick="ui.chooseCrisis('${event.id}', 'accept')">
                        😣 硬扛过去（免费）<br>
                        <span style="font-size:11px;font-weight:normal;">${event.crisis.acceptDesc}</span>
                    </button>
                </div>
            </div>`;
        this.showModal('⚠️ 危机应对', content, '', { modalId: 'crisisModal' });
    }

    chooseCrisis(eventId, action) {
        const r = gameState.resolveCrisisEvent(eventId, action);
        this.closeModal();
        if (r && r.success) {
            this.showToast(r.message);
        } else {
            this.showToast((r && r.message) || '操作失败');
        }
    }

    /**
     * 修改2c：切换货源断供通知级别（all/digest/none）
     */
    setSupplyOutageNotifyLevel(level) {
        try {
            if (!['all', 'digest', 'none'].includes(level)) level = 'all';
            if (!gameState || !gameState.state) return;
            gameState.setState(s => {
                if (!s.settings) s.settings = {};
                s.settings.supplyOutageNotifyLevel = level;
                s.settings.supplyOutageSilentMode = (level === 'none');
            });
            const PREF = (typeof window !== 'undefined' && window.SUPPLY_OUTAGE_DNDPREF)
                ? window.SUPPLY_OUTAGE_DNDPREF
                : { levels: [
                    { value: 'all', name: '全部通知' },
                    { value: 'digest', name: '每日汇总' },
                    { value: 'none', name: '完全静默' }
                ]};
            const curName = (PREF.levels.find(x => x.value === level) || {}).name || level;
            try { this.showToast('📢 货源断供通知已切换为：' + curName, 'success'); } catch (_) {}
            try { gameState.notify && gameState.notify(); } catch (_) {}
            try { gameState.saveDebounced && gameState.saveDebounced(); } catch (_) {}
        } catch (_e) {
            console.error('[setSupplyOutageNotifyLevel] err:', _e);
            try { this.showToast('设置失败：' + (_e && _e.message || _e), 'error'); } catch (__) {}
        }
    }

    showRenameModal() {
        const content = `
            <div class="form-group">
                <label class="form-label">店铺名称</label>
                <input type="text" class="form-input" id="newShopName" 
                       value="${gameState.state.shop.name}" maxlength="12"
                       oninput="ui.checkRenameInput()">
                <div style="text-align:right;font-size:12px;color:#999;margin-top:4px;" id="renameCharCount">
                    ${getCharCount(gameState.state.shop.name)}/12
                </div>
            </div>
            <div style="background:#fff3e0;border-radius:8px;padding:10px 12px;margin-bottom:15px;">
                <div style="font-size:12px;font-weight:bold;color:#e65100;margin-bottom:4px;">📝 命名规则</div>
                <ul style="font-size:11px;color:#ff6f00;line-height:1.6;padding-left:16px;margin:0;">
                    <li>长度2-12个字符，支持中文、英文、数字</li>
                    <li>可使用空格、·、-、_、& 等常用符号</li>
                    <li>请勿包含敏感词汇和违规内容</li>
                </ul>
            </div>
            <div id="renameErrorMsg" style="display:none;background:#ffebee;color:#c62828;padding:8px 10px;border-radius:6px;font-size:12px;margin-bottom:10px;"></div>
        `;

        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>
            <button class="btn btn-primary" id="renameConfirmBtn" onclick="ui.renameShop()">确定</button>
        `;

        this.showModal('修改店铺名称', content, footer);
    }

    checkRenameInput() {
        const input = document.getElementById('newShopName');
        const charCount = document.getElementById('renameCharCount');
        const errorMsg = document.getElementById('renameErrorMsg');
        const confirmBtn = document.getElementById('renameConfirmBtn');
        
        if (!input || !charCount) return;
        
        const value = input.value;
        const len = getCharCount(value);
        charCount.textContent = `${len}/12`;
        
        const result = validateShopName(value);
        
        if (value.length === 0) {
            if (errorMsg) errorMsg.style.display = 'none';
            if (confirmBtn) confirmBtn.disabled = true;
        } else if (result.valid) {
            if (errorMsg) errorMsg.style.display = 'none';
            if (confirmBtn) confirmBtn.disabled = false;
        } else {
            if (errorMsg) {
                errorMsg.textContent = result.message;
                errorMsg.style.display = 'block';
            }
            if (confirmBtn) confirmBtn.disabled = true;
        }
    }

    renameShop() {
        const newName = document.getElementById('newShopName').value.trim();
        const result = validateShopName(newName);
        
        if (!result.valid) {
            this.showToast(result.message);
            return;
        }

        gameState.setState(s => { s.shop.name = newName; });
        // 标记店铺名称已设置
        localStorage.setItem('ecommerce_sim_shop_name_set', 'true');
        this.closeModal();
        this.showToast('修改成功');
    }

    /** 欠费破产：看广告抵还款继续，或重新开局 */
    showForcedBankruptRestart(reason) {
        const msg = reason || '无力支付刚性费用，店铺已破产';
        try {
            if (typeof gameState !== 'undefined' && gameState.state && !gameState.state._adBailout) {
                let amount = 0;
                try {
                    if (typeof gameEngine !== 'undefined' && gameEngine.getOutstandingDues) {
                        amount = Number(gameEngine.getOutstandingDues().total) || 0;
                    }
                } catch (_) {}
                gameState.state._adBailout = { reason: msg, amount, category: 'mixed' };
            }
        } catch (_) {}
        this.showModal(
            '💀 店铺破产',
            `<div style="padding:16px;text-align:center;line-height:1.7;">
                <div style="font-size:42px;margin-bottom:8px;">💀</div>
                <div style="font-size:16px;font-weight:700;margin-bottom:8px;">经营失败</div>
                <div style="font-size:13px;color:#555;margin-bottom:10px;">${escapeHtml(msg)}</div>
                <div style="font-size:12px;color:#1565c0;background:#e3f2fd;padding:10px;border-radius:8px;margin-bottom:8px;">
                    看完广告可<b>抵扣本次还款</b>，店铺复活并继续经营。
                </div>
                <div style="font-size:12px;color:#c62828;background:#ffebee;padding:10px;border-radius:8px;">
                    不看广告则只能重新开局。
                </div>
            </div>`,
            `<button class="btn btn-primary" style="flex:1.3;background:#1565c0;border-color:#1565c0;"
                onclick="ui.watchAdForBankruptBailout()">📺 看广告抵还款</button>
             <button class="btn btn-secondary" style="flex:1;"
                onclick="ui.resetGame(true)">重新开局</button>`,
            { modalId: 'forcedBankruptModal', lockClose: true }
        );
    }

    watchAdForBankruptBailout() {
        try {
            if (typeof RewardedAdManager !== 'undefined' && RewardedAdManager.showForBailout) {
                RewardedAdManager.showForBailout();
                return;
            }
        } catch (e) {
            console.warn('[watchAdForBankruptBailout]', e);
        }
        this.showToast('广告模块不可用');
    }

    /** 看完广告：注入资金、结清本次刚性欠款、解除破产、继续游戏 */
    applyAdBailoutRescue() {
        const state = (typeof gameState !== 'undefined' && gameState.state) ? gameState.state : null;
        if (!state) return false;
        const bail = state._adBailout || {};
        let amount = Number(bail.amount) || 0;
        try {
            if (!(amount > 0) && typeof gameEngine !== 'undefined' && gameEngine.getOutstandingDues) {
                amount = Number(gameEngine.getOutstandingDues().total) || 0;
            }
        } catch (_) {}
        if (amount > 0 && typeof gameState.addFunds === 'function') {
            gameState.addFunds(amount, '广告抵还款（破产救援）');
        }
        const cat = bail.category || 'mixed';
        try {
            if (cat === 'salary' || cat === 'mixed') {
                if (typeof gameEngine !== 'undefined' && typeof gameEngine.confirmMonthlySalary === 'function') {
                    gameEngine.confirmMonthlySalary();
                }
            }
            if (cat === 'tax' && typeof TaxEngine !== 'undefined' && TaxEngine.payTaxes) {
                if (bail.year && bail.month) {
                    TaxEngine.payTaxes(gameState, bail.year, bail.month);
                } else {
                    const unpaid = (typeof TaxState !== 'undefined' && TaxState.getState)
                        ? (TaxState.getState().monthlyReports || []).filter(r => r && !r.paid && r.totalPayable > 0)
                        : [];
                    unpaid.forEach(r => TaxEngine.payTaxes(gameState, r.year, r.month));
                }
            }
            if (cat === 'express' && typeof ExpressEngine !== 'undefined' && ExpressEngine.payBill) {
                const ids = Array.isArray(bail.billIds) ? bail.billIds : [];
                if (ids.length) {
                    ids.forEach(id => { try { ExpressEngine.payBill(id); } catch (_) {} });
                } else if (typeof ExpressState !== 'undefined' && ExpressState.getUnpaidBills) {
                    (ExpressState.getUnpaidBills() || []).forEach(b => {
                        try { ExpressEngine.payBill(b.id); } catch (_) {}
                    });
                }
            }
            if (cat === 'mixed' && state.warehouse && (Number(state.warehouse.unpaidRent) || 0) > 0) {
                const rent = Number(state.warehouse.unpaidRent) || 0;
                if (gameState.spendFunds(rent, '广告抵扣仓库欠租')) {
                    state.warehouse.unpaidRent = 0;
                } else {
                    state.warehouse.unpaidRent = 0;
                }
            }
        } catch (e) {
            console.warn('[applyAdBailoutRescue] settle', e);
        }
        state.gameOver = false;
        if (state.ending && state.ending.id === 'bankrupt') state.ending = null;
        state._adBailout = null;
        try { if (typeof gameState.setPaused === 'function') gameState.setPaused(false); } catch (_) {}
        try {
            document.querySelectorAll('.modal-overlay').forEach(el => {
                if (el.id === 'forcedBankruptModal' || (el.dataset && el.dataset.modalId === 'forcedBankruptModal')) {
                    el.remove();
                }
            });
        } catch (_) {}
        try { if (typeof gameState.notify === 'function') gameState.notify(); } catch (_) {}
        try { if (typeof this.forceRender === 'function') this.forceRender(); else this.render(); } catch (_) {}
        try { this.refreshSkipDayBtn(); } catch (_) {}
        return true;
    }

    /**
     * 重新开始游戏
     * @param {boolean} [force=false] 破产强制重开时去掉「取消」
     */
    resetGame(force = false) {
        const footer = force
            ? `<button class="btn btn-primary" id="__resetOkBtn" style="background:#f44336;border-color:#f44336;">🔄 确认清除，重新开始</button>`
            : `<button class="btn btn-secondary" id="__resetCancelBtn">取消</button>
             <button class="btn btn-primary" id="__resetOkBtn" style="background:#f44336;border-color:#f44336;">
                🔄 确认清除，重新开始
             </button>`;
        this.showModal(
            force ? '💀 破产重开' : '⚠️ 重新开始游戏',
            `<div style="padding:8px 4px;line-height:1.7;color:#555;font-size:14px;">
                <div style="margin-bottom:12px;color:#f44336;font-weight:700;font-size:15px;">
                    ${force ? '店铺已破产，必须重新开局：' : '以下数据将被永久删除且无法恢复：'}
                </div>
                <ul style="margin:0 0 14px;padding-left:18px;">
                    <li>店铺资金、等级、信誉、会员</li>
                    <li>全部商品、库存、上架、订单</li>
                    <li>所有员工、营销、活动、成就</li>
                    <li>银行、客服、财务全部记录</li>
                    <li>设置、兑换码、标记位</li>
                </ul>
                <div style="background:#fff8e1;border:1px solid #ffe58f;border-radius:8px;padding:10px 12px;color:#ad6800;font-size:12.5px;">
                    💡 清除后将返回游戏启动界面，您需要重新填写
                    <b>店主姓名</b>、<b>店铺名称</b>，并重新选择<b>仓库城市</b>。
                </div>
            </div>`,
            footer,
            { modalId: 'resetGameConfirmModal' }
        );

        setTimeout(() => {
            const cancelBtn = document.getElementById('__resetCancelBtn');
            const okBtn = document.getElementById('__resetOkBtn');
            if (cancelBtn) cancelBtn.addEventListener('click', () => this.closeModal());
            if (okBtn) okBtn.addEventListener('click', () => this._doResetGame());
        }, 0);
    }

    async _doResetGame() {
        try {
            this.closeModal();
            this.showToast('正在清除数据…', 800);

            // 0. 先阻断存档写入并等待进行中的保存结束（防旧档在清空后写回）
            if (typeof saveManager !== 'undefined' && typeof saveManager.beginResetGate === 'function') {
                try { await saveManager.beginResetGate(); } catch (e) { console.warn('[resetGame] beginResetGate:', e); }
            }

            // 1. 停止游戏引擎 / 快照循环
            if (gameEngine) gameEngine.stop();
            if (typeof saveManager !== 'undefined') { try { saveManager.stopSnapshotLoop(); } catch (e) {} }

            // 2. 先清空磁盘存档，再重置内存（顺序很重要）
            if (typeof saveManager !== 'undefined') {
                try { await saveManager.fullReset(); } catch (e) { console.warn('[resetGame] 清空存档系统失败:', e); }
            }

            // 3. 内存回到第1天初始状态
            gameState.reset();

            // 4. 再清一次存档（吞掉可能刚结束的竞态写入）
            if (typeof saveManager !== 'undefined') {
                try { await saveManager.fullReset(); } catch (e) { /* ignore */ }
            }

            // 5. 兜底：再扫一遍清除剩余 key（bank_/cs_/temp_* 等）
            try {
                const toRemove = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (k && (k.startsWith('ecommerce_sim_') ||
                              k.startsWith('bank_') ||
                              k.startsWith('cs_') ||
                              k.startsWith('temp_shop_') ||
                              k.startsWith('temp_player_') ||
                              k.startsWith('temp_warehouse_'))) {
                        toRemove.push(k);
                    }
                }
                toRemove.forEach(k => localStorage.removeItem(k));
            } catch (e2) { /* ignore */ }
            try {
                sessionStorage.removeItem('ecommerce_sim_session_buffer');
                sessionStorage.removeItem('ecommerce_sim_save_emergency');
            } catch (_) {}

            // 6. 强制走「新建游戏」流程，禁止读档继续
            try {
                window.__ecommerceSimContinueSave = false;
                window.__forceNewGameFlow = true;
                window.__ecommerceSimFreshStart = true;
                window.__ecommerceSimInited = false;
                window.__ecommerceSimInitPromise = null;
                try { if (typeof gameEngine !== 'undefined' && gameEngine) gameEngine._bootedOnce = false; } catch (_) {}
                try { sessionStorage.setItem('ecommerce_sim_fresh_start', '1'); } catch (_) {}
            } catch (_) {}

            // 7. 清空当前页面 DOM，避免残留 UI
            try {
                const topHeader = document.getElementById('topHeader');
                const mainContainer = document.getElementById('mainContainer');
                const bottomNav = document.getElementById('bottomNav');
                if (topHeader) topHeader.innerHTML = '';
                if (mainContainer) mainContainer.innerHTML = '';
                if (bottomNav) bottomNav.innerHTML = '';
            } catch (e3) { /* ignore */ }

            // 8. 解除保存阻断（新建流程完成后允许写新档）
            if (typeof saveManager !== 'undefined' && typeof saveManager.endResetGate === 'function') {
                try { saveManager.endResetGate(); } catch (_) {}
            }

            // 9. 返回启动界面：店主信息 → 仓库城市 → initGame（第1天）
            setTimeout(() => {
                if (typeof checkPrivacyAndInit === 'function') {
                    checkPrivacyAndInit();
                } else {
                    window.location.reload();
                }
            }, 600);
        } catch (e) {
            console.error('[resetGame] 重置异常，兜底刷新：', e);
            try {
                if (typeof saveManager !== 'undefined') {
                    if (saveManager.beginResetGate) await saveManager.beginResetGate();
                    await saveManager.fullReset();
                    if (saveManager.endResetGate) saveManager.endResetGate();
                }
            } catch (_) {}
            try { gameState.reset(); } catch (_) {}
            try {
                window.__forceNewGameFlow = true;
                window.__ecommerceSimFreshStart = true;
                window.__ecommerceSimContinueSave = false;
            } catch (_) {}
            window.location.reload();
        }
    }

    // ==================== 会员中心（完整版） ====================
    showMemberCenterModal(tab = 'members') {
        const state = gameState.state;
        const player = state.player || {};
        const members = state.members || {};
        const stats = gameState.getMemberStatistics();
        const myLevel = gameState.getMemberLevelInfo(stats.shopMemberLevel);
        const nextLevel = gameState.getNextLevelGrowth(stats.shopMemberLevel);
        const tabs = [
            { id: 'members',    name: '顾客会员', icon: '👥' },
            { id: 'recharge',   name: '充值设置', icon: '💳' },
            { id: 'mall',       name: '积分兑换', icon: '🎁' },
            { id: 'points_log', name: '积分明细', icon: '📊' },
            { id: 'benefits',   name: '权益管理', icon: '⚙️' },
            { id: 'redeem_log', name: '兑换记录', icon: '📋' },
            { id: 'level',      name: '等级权益', icon: '🎖️' },
            { id: 'activities', name: '专属活动', icon: '🎉' },
            { id: 'stats',      name: '数据统计', icon: '📈' },
            { id: 'home',       name: '运营首页', icon: '🏠' },
            { id: 'profile',    name: '店主资料', icon: '👤' }
        ];

        // 确保初始化时更新店铺等级
        if (state.shop) {
            gameState.updateShopMemberLevel();
        }

        let tabContent = '';
        switch(tab) {
            case 'home': tabContent = this._renderMemberHome(player, members, stats, myLevel, nextLevel); break;
            case 'profile': tabContent = this._renderMemberProfile(player); break;
            case 'level': tabContent = this._renderMemberLevel(myLevel, nextLevel, stats); break;
            case 'members': tabContent = this._renderMemberList(members); break;
            case 'recharge': tabContent = this._renderMemberRecharge(members); break;
            case 'points_log': tabContent = this._renderPointsLog(members); break;
            case 'mall': tabContent = this._renderMemberMall(members); break;
            case 'benefits': tabContent = this._renderBenefitsManage(members); break;
            case 'redeem_log': tabContent = this._renderRedeemLog(members); break;
            case 'activities': tabContent = this._renderMemberActivities(members); break;
            case 'stats': tabContent = this._renderMemberStats(stats, members); break;
            default: tabContent = this._renderMemberHome(player, members, stats, myLevel, nextLevel);
        }

        const lockStyle = 'overflow-x:hidden;touch-action:pan-y;-webkit-user-select:none;user-select:none;';
        const headerBg = myLevel.bgColor?.includes('gradient') ? myLevel.bgColor : `linear-gradient(135deg,${myLevel.bgColor||'#ff9800'},${myLevel.bgColor||'#ff6b35'})`;

        const content = `
            <div style="width:100%;max-width:100%;overflow-x:hidden;${lockStyle}">
                <!-- 顶部：顾客会员运营 -->
                <div style="background:${headerBg};color:${myLevel.textColor||'#fff'};padding:16px 20px 12px;width:100%;max-width:100%;box-sizing:border-box;${lockStyle}">
                    <div style="font-size:16px;font-weight:900;">顾客会员中心</div>
                    <div style="font-size:11px;opacity:.9;margin-top:4px;line-height:1.5;">查询顾客积分与储值 · 积分兑换商品 · 设置充值赠送</div>
                </div>
                <!-- 快捷数据栏 -->
                <div style="display:grid;grid-template-columns:repeat(4,1fr);background:#fff;padding:10px 4px;border-bottom:1px solid #f0f0f0;">
                    <div style="text-align:center;padding:4px;" onclick="event.stopPropagation();ui.showMemberCenterModal('members')">
                        <div style="font-size:16px;font-weight:bold;color:#4caf50;">${stats.totalMembers}</div>
                        <div style="font-size:10px;color:#999;">顾客会员</div>
                    </div>
                    <div style="text-align:center;padding:4px;" onclick="event.stopPropagation();ui.showMemberCenterModal('points_log')">
                        <div style="font-size:16px;font-weight:bold;color:#ff6b35;">${stats.totalPoints}</div>
                        <div style="font-size:10px;color:#999;">顾客积分</div>
                    </div>
                    <div style="text-align:center;padding:4px;" onclick="event.stopPropagation();ui.showMemberCenterModal('recharge')">
                        <div style="font-size:16px;font-weight:bold;color:#00897b;">¥${Math.round(stats.totalWallet||0)}</div>
                        <div style="font-size:10px;color:#999;">储值余额</div>
                    </div>
                    <div style="text-align:center;padding:4px;" onclick="event.stopPropagation();ui.showMemberCenterModal('stats')">
                        <div style="font-size:16px;font-weight:bold;color:#2196f3;">${stats.activeMembers}</div>
                        <div style="font-size:10px;color:#999;">近7日活跃</div>
                    </div>
                </div>
                <!-- Tab导航：换行网格，避免横滑到「积分明细」后后面的页签被裁掉 -->
                <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));background:#fff;border-bottom:1px solid #f0f0f0;width:100%;box-sizing:border-box;">
                    ${tabs.map(t => `
                        <div class="member-tab ${tab===t.id?'active':''}"
                             data-member-tab="${t.id}"
                             onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                             onclick="event.preventDefault();event.stopPropagation();ui.showMemberCenterModal('${t.id}')"
                             style="padding:8px 2px 7px;text-align:center;font-size:10px;line-height:1.25;cursor:pointer;color:#666;border-bottom:2px solid transparent;word-break:break-all;${tab===t.id?'color:#ff6b35;border-bottom-color:#ff6b35;font-weight:700;background:#fff8f1;':''}">
                            <div style="font-size:14px;line-height:1.2;">${t.icon}</div>
                            <div>${t.name}</div>
                        </div>
                    `).join('')}
                </div>
                <!-- Tab内容 -->
                <div class="member-center-content" style="padding:12px 14px 16px;max-height:55vh;overflow-y:auto;${lockStyle}box-sizing:border-box;width:100%;background:#f5f5f5;">
                    ${tabContent}
                </div>
            </div>
        `;

        this.showModal('会员中心', content, '', { noBodyPadding: true, modalId: 'memberCenterModal' });
    }

    // 每日签到（积分成长，无广告）
    doDailySignIn() {
        const res = gameState.dailySignIn();
        if (res.success) {
            this.showToast('✅ ' + res.message);
            setTimeout(() => this.showMemberCenterModal('home'), 100);
        } else {
            this.showToast('❌ ' + res.message);
        }
    }

    toggleMemberDay() {
        const res = gameState.toggleMemberDay();
        this.showToast((res && res.message) || '已切换');
        setTimeout(() => this.showMemberCenterModal('home'), 100);
    }

    claimCitySubsidy() {
        const res = gameState.claimCitySubsidy();
        this.showToast((res && res.message) || '领取失败');
        setTimeout(() => this.showCityMapModal(), 150);
    }

    /** 每日任务领奖（DailyQuests 模块） */
    claimDailyQuest(id) {
        try {
            const res = (typeof DailyQuests !== 'undefined' && DailyQuests.claim)
                ? DailyQuests.claim(id) : { ok: false, message: '任务模块未加载' };
            this.showToast((res && res.message) || '领取失败');
            if (res && res.ok) this.render();
        } catch (e) {
            console.warn('[claimDailyQuest]', e);
            this.showToast('领取失败');
        }
    }

    /** 自有品牌中心：未解锁提示 / 创立表单 / 品牌状态 */
    showOwnBrandModal() {
        try {
            const state = gameState.state;
            const shop = state.shop || {};
            const lv = shop.level || 1;
            const closeFooter = `<button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>`;

            if (shop.hasOwnBrand) {
                const buff = shop.ownBrandBuff || {};
                const since = shop.ownBrandSinceDay || 1;
                const day = (state.gameTime && state.gameTime.day) || 1;
                const fac = (typeof OWN_BRAND_FACTORY !== 'undefined') ? OWN_BRAND_FACTORY : {};
                const factoryHtml = `<div style="background:#e8f5e9;border:1px solid #c8e6c9;border-radius:10px;padding:12px 14px;margin-top:12px;font-size:13px;color:#1b5e20;line-height:1.7;">
                        <div style="font-weight:800;">🏭 自有工厂已独立</div>
                        <div>扩产、下单、厂长和产线都在工厂中心。初始日产 ${fac.dailyCapacity || 240} 件。</div>
                        <button class="btn btn-primary" style="width:100%;margin-top:10px;" onclick="ui.closeModal();ui.showFactoryCenter()">打开工厂中心</button>
                    </div>`;
                const content = `
                    <div style="text-align:center;padding:10px 0;">
                        <div style="font-size:52px;">🏷️</div>
                        <div style="font-size:20px;font-weight:800;color:#333;margin-top:6px;">${escapeHtml(shop.ownBrandName || '自有品牌')}</div>
                        <div style="font-size:12px;color:#999;margin-top:4px;">第 ${since} 天创立 · 已运营 ${Math.max(0, day - since)} 天</div>
                    </div>
                    <div style="background:#fff8e1;border:1px solid #ffe082;border-radius:10px;padding:12px 14px;font-size:13px;color:#6d4c00;line-height:1.8;">
                        <div>✅ 全店转化率 <b>+${Math.round((buff.conversion || 0) * 100)}%</b></div>
                        <div>✅ 自然流量 <b>+${Math.round((buff.traffic || 0) * 100)}%</b></div>
                        <div>🏆 已达成结局徽章「品牌创始人」</div>
                    </div>
                    ${factoryHtml}`;
                this.showModal('🏷️ 自有品牌', content, closeFooter);
                return;
            }

            if (lv < 6) {
                const content = `
                    <div style="text-align:center;padding:14px 0;">
                        <div style="font-size:48px;">🔒</div>
                        <div style="font-size:15px;font-weight:700;color:#333;margin-top:8px;">店铺 Lv.6 皇冠店铺后解锁</div>
                        <div style="font-size:12px;color:#999;margin-top:6px;line-height:1.7;">
                            当前 Lv.${lv}。升级店铺可解锁奢侈品货源、海外贸易与自有品牌。
                        </div>
                    </div>`;
                this.showModal('🏷️ 自有品牌', content, closeFooter);
                return;
            }

            const defaultName = ((shop.name || '我的小店') + '牌').slice(0, 12);
            const content = `
                <div style="font-size:12px;color:#666;line-height:1.7;margin-bottom:12px;">
                    创立自有品牌，从「卖货」升级为「做品牌」：
                    <div style="background:#f5f5f5;border-radius:8px;padding:10px;margin-top:8px;">
                        <div>📈 全店转化率 <b>+8%</b></div>
                        <div>🌿 自然流量 <b>+10%</b></div>
                        <div>🏭 可购置工厂，生产自制服饰</div>
                        <div>🏆 达成结局徽章「品牌创始人」</div>
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">品牌名称（2~12 字）</label>
                    <input type="text" class="form-input" id="ownBrandNameInput" maxlength="12" value="${escapeHtml(defaultName)}" placeholder="请输入品牌名称">
                </div>
                <div style="font-size:13px;color:#e65100;font-weight:700;">品牌注册费：¥5,000,000（一次性）</div>`;
            const footer = `
                <button class="btn btn-secondary" onclick="ui.closeModal()">再想想</button>
                <button class="btn btn-primary" onclick="ui.confirmCreateOwnBrand()">🏷️ 创立品牌</button>`;
            this.showModal('🏷️ 创立自有品牌', content, footer);
        } catch (e) {
            console.warn('[showOwnBrandModal]', e);
            this.showToast('品牌中心打开失败');
        }
    }

    confirmCreateOwnBrand() {
        const input = document.getElementById('ownBrandNameInput');
        const name = input ? input.value : '';
        const res = gameState.createOwnBrand(name);
        this.showToast((res && res.message) || '操作失败');
        if (res && res.success) {
            this.closeModal();
            this.render();
            this.showOwnBrandModal();
        }
    }

    confirmBuyOwnFactory() {
        const res = gameState.buyOwnBrandFactory();
        this.showToast((res && res.message) || '操作失败');
        if (res && res.success) {
            this.closeModal();
            this.render();
            this.showFactoryCenter();
        }
    }

    confirmProduceOwnBrand() {
        const sel = document.getElementById('ownBrandSkuSelect');
        const qtyEl = document.getElementById('ownBrandProduceQty');
        const nameEl = document.getElementById('ownBrandCustomName');
        const tierEl = document.getElementById('ownBrandCostTier');
        const skuId = sel ? sel.value : '';
        const qty = qtyEl ? Number(qtyEl.value) : 0;
        const res = gameState.produceOwnBrand(skuId, qty, {
            customName: nameEl ? nameEl.value : '',
            costTier: tierEl ? tierEl.value : 'standard'
        });
        this.showToast((res && res.message) || '操作失败');
        if (res && res.success) {
            this.closeModal();
            this.showFactoryCenter();
        }
    }

    showFactoryCenter() {
        try {
            const state = gameState.state;
            const shop = state.shop || {};
            const closeFooter = `<button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>`;
            if (!shop.hasOwnBrand) {
                this.showModal('🏭 自有工厂', `<div style="padding:16px;text-align:center;line-height:1.7;">请先在「自有品牌」创立品牌后再购置工厂。</div>`,
                    closeFooter + `<button class="btn btn-primary" onclick="ui.closeModal();ui.showOwnBrandModal()">去创立品牌</button>`);
                return;
            }
            const fac = (typeof OWN_BRAND_FACTORY !== 'undefined') ? OWN_BRAND_FACTORY : {};
            const skus = (typeof OWN_BRAND_SKUS !== 'undefined') ? OWN_BRAND_SKUS : [];
            if (!shop.hasOwnFactory) {
                this.showModal('🏭 购置工厂', `
                    <div style="padding:8px 0;font-size:13px;line-height:1.7;color:#333;">
                        <div>${escapeHtml(fac.desc || '')}</div>
                        <div style="margin-top:8px;font-weight:700;color:#e65100;">购置费 ¥${(fac.cost || 2000000).toLocaleString()} · 初始日产 ${fac.dailyCapacity || 240} 件 · 出品 C 级</div>
                        <div style="font-size:12px;color:#666;margin-top:6px;">普通产线 ¥50万/+200件 · 高级产线 ¥120万/+200件并可做 B/A 品 · 最多 8 条</div>
                    </div>`,
                    closeFooter + `<button class="btn btn-primary" onclick="ui.confirmBuyOwnFactory()">购置工厂</button>`);
                return;
            }
            const f = (typeof gameState._ensureOwnFactory === 'function') ? gameState._ensureOwnFactory() : (shop.ownFactory || {});
            const day = (state.gameTime && state.gameTime.day) || 1;
            const cap = (typeof getFactoryDailyCapacity === 'function') ? getFactoryDailyCapacity(f) : (f.dailyCapacity || 240);
            if (f.usedDay !== day) { f.usedToday = 0; f.usedDay = day; }
            const left = Math.max(0, cap - (f.usedToday || 0));
            const hasAdv = (typeof factoryHasAdvancedLine === 'function') ? factoryHasAdvancedLine(f) : false;
            const hasDir = gameState.hasFactoryDirector && gameState.hasFactoryDirector();
            const lines = f.lines || [];
            const queue = f.queue || [];
            const maxLines = fac.maxLines || 8;
            const content = `
                <div style="font-size:13px;line-height:1.7;">
                    <div style="background:#e8f5e9;border-radius:10px;padding:12px;margin-bottom:10px;">
                        <div style="font-weight:800;">🏭 ${escapeHtml(f.name || fac.name || '服饰工厂')}</div>
                        <div>日产能 <b>${cap}</b> 件 · 今日已用 ${f.usedToday || 0} · 还可排 <b>${left}</b> 件</div>
                        <div style="font-size:11px;color:#555;">初级出 C 级；高级产线可做标准 B / 精做 A。下单不限量，成本一次结清，按日产排队。</div>
                    </div>
                    <div style="font-weight:700;margin-bottom:6px;">产线 ${lines.length}/${maxLines}</div>
                    ${lines.length ? lines.map(l => `<div style="font-size:12px;padding:4px 0;border-bottom:1px solid #f3f3f3;">${escapeHtml(l.name || l.type)} · +${l.capacity || 200}件/天</div>`).join('') : '<div style="font-size:12px;color:#999;">还没有额外产线</div>'}
                    <div style="display:flex;gap:8px;margin:8px 0 12px;flex-wrap:wrap;">
                        <button class="btn btn-primary btn-small" ${lines.length >= maxLines ? 'disabled' : ''} onclick="ui.confirmBuyFactoryLine('normal')">普通产线 ¥50万</button>
                        <button class="btn btn-primary btn-small" ${lines.length >= maxLines ? 'disabled' : ''} onclick="ui.confirmBuyFactoryLine('advanced')">高级产线 ¥120万</button>
                    </div>
                    <div style="background:#fff8e1;border-radius:10px;padding:10px;margin-bottom:12px;font-size:12px;">
                        厂长：${hasDir ? '已在职，开工等待 −2 天、废品更低' : '未招聘（员工管理 → 厂长，月薪约5500）'}
                        ${hasDir ? '' : '<button class="btn btn-secondary btn-small" style="margin-left:8px;" onclick="ui.closeModal();ui.showEmployeeManagerModal()">去招聘厂长</button>'}
                    </div>
                    <label class="form-label">款式</label>
                    <select id="ownBrandSkuSelect" class="form-input">
                        ${skus.map(s => `<option value="${s.id}">${escapeHtml(s.name)} · 底价¥${s.basePrice}</option>`).join('')}
                    </select>
                    <label class="form-label" style="margin-top:8px;">产品名称（可选）</label>
                    <input class="form-input" id="ownBrandCustomName" maxlength="16" placeholder="给这批货起个名字">
                    <label class="form-label" style="margin-top:8px;">成本档</label>
                    <select id="ownBrandCostTier" class="form-input">
                        <option value="cheap">省料 · 4折 · C级</option>
                        <option value="standard" selected>标准 · 5.2折 · ${hasAdv ? 'B级' : 'C级'}</option>
                        <option value="premium" ${hasAdv ? '' : 'disabled'}>精做 · 7折 · A级${hasAdv ? '' : '（需高级产线）'}</option>
                    </select>
                    <label class="form-label" style="margin-top:8px;">数量（不限，靠日产能排队）</label>
                    <input type="number" class="form-input" id="ownBrandProduceQty" min="1" value="100">
                    <button class="btn btn-primary" style="width:100%;margin-top:10px;" onclick="ui.confirmProduceOwnBrand()">下单生产（成本一次结清）</button>
                    ${queue.length ? `<div style="font-weight:700;margin:14px 0 6px;">生产队列</div>
                        ${queue.map(j => `<div style="font-size:12px;padding:5px 0;border-bottom:1px solid #f3f3f3;">
                            ${escapeHtml(j.displayName || '')} 剩${j.remaining}/${j.qty} · ${j.qualityGrade || 'C'} · 第${j.startDay}天开工
                        </div>`).join('')}` : ''}
                </div>`;
            this.showModal('🏭 自有工厂', content, closeFooter, { modalId: 'factoryCenterModal', width: '560px' });
        } catch (e) {
            console.warn('[showFactoryCenter]', e);
            this.showToast('工厂中心打开失败');
        }
    }

    confirmBuyFactoryLine(lineType) {
        const res = gameState.buyFactoryLine(lineType);
        this.showToast((res && res.message) || '操作失败');
        if (res && res.success) {
            this.closeModal();
            this.showFactoryCenter();
        }
    }

    /**
     * 广告激励签到：拉起 uni-ad 激励视频，完整观看后获得 ¥1,000,000 补贴
     * 唯一入口：首页统计区「签到广告」
     * @see https://uniapp.dcloud.net.cn/uni-ad/ad-rewarded-video.html
     */
    doAdSignIn() {
        try {
            if (typeof RewardedAdManager === 'undefined' || !RewardedAdManager.showForSignIn) {
                this.showToast('广告模块未加载');
                return;
            }
            if (RewardedAdManager.hasClaimedToday && RewardedAdManager.hasClaimedToday()) {
                this.showToast('今日已领取过广告签到奖励');
                return;
            }
            try { this.closeModal(); } catch (_) {}
            RewardedAdManager.showForSignIn();
        } catch (e) {
            console.warn('[doAdSignIn]', e);
            this.showToast('签到广告启动失败');
        }
    }

    // 首页
    _renderMemberHome(player, members, stats, myLevel, nextLevel) {
        const activities = gameState.getAvailableActivities();
        const orders = (gameState.state.orders || []).slice(-5).reverse();
        const signedToday = player.lastSignInDay === (gameState.state.gameTime?.day || 1);
        return `
            <!-- 今日签到卡片（会员积分签到，无广告） -->
            <div style="background:linear-gradient(135deg,#fff3e0,#ffe0b2);border-radius:12px;padding:12px 14px;margin-bottom:10px;display:flex;align-items:center;gap:10px;">
                <div style="font-size:32px;">📅</div>
                <div style="flex:1;">
                    <div style="font-weight:700;font-size:13px;color:#e65100;">连续签到 ${player.continuousSignIn||0} 天</div>
                    <div style="font-size:11px;color:#bf360c;margin-top:2px;">每日签到领取会员成长值（无广告）</div>
                </div>
                <button class="btn btn-primary btn-small" style="flex-shrink:0;font-weight:700;"
                        onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                        onclick="event.stopPropagation();ui.doDailySignIn()">
                    ${signedToday ? '今日已签' : '签到'}
                </button>
            </div>
            <!-- 会员日开关（深化）：开启后会员转化率 +5%、积分 ×1.5 -->
            <div style="background:linear-gradient(135deg,#e8f5e9,#c8e6c9);border-radius:12px;padding:10px 14px;margin-bottom:10px;display:flex;align-items:center;gap:10px;">
                <div style="font-size:28px;">👑</div>
                <div style="flex:1;">
                    <div style="font-weight:700;font-size:13px;color:#2e7d32;">会员日</div>
                    <div style="font-size:11px;color:#558b2f;margin-top:2px;">${gameState.getMemberDay() ? '已开启：会员转化率 +5%、积分 ×1.5' : '开启后吸引会员复购，转化率 +5%'}</div>
                </div>
                <button class="btn ${gameState.getMemberDay() ? 'btn-secondary' : 'btn-primary'} btn-small" style="flex-shrink:0;"
                        onclick="event.stopPropagation();ui.toggleMemberDay()">
                    ${gameState.getMemberDay() ? '关闭' : '开启'}
                </button>
            </div>
            <!-- 快捷功能入口 -->
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px;">
                ${[
                    {icon:'🎁',name:'积分兑换',tab:'mall',color:'#e91e63'},
                    {icon:'🎖️',name:'我的等级',tab:'level',color:'#ff9800'},
                    {icon:'⚙️',name:'权益管理',tab:'benefits',color:'#607d8b'},
                    {icon:'📋',name:'兑换记录',tab:'redeem_log',color:'#2196f3'}
                ].map(f=>`
                    <div style="background:#fff;border-radius:10px;padding:10px 6px;text-align:center;cursor:pointer;"
                         onclick="event.stopPropagation();ui.showMemberCenterModal('${f.tab}')">
                        <div style="font-size:24px;">${f.icon}</div>
                        <div style="font-size:11px;color:#333;margin-top:4px;font-weight:600;">${f.name}</div>
                    </div>
                `).join('')}
            </div>
            <!-- 当前权益一览 -->
            <div style="background:#fff;border-radius:12px;padding:12px;margin-bottom:10px;">
                <div style="font-weight:700;font-size:13px;color:#333;margin-bottom:8px;">🎖️ ${myLevel.name}专属权益</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;">
                    ${(myLevel.benefits||[]).map(b=>`
                        <span style="font-size:11px;padding:4px 8px;background:${myLevel.bgColor?.includes('gradient')?'#fff3e0':myLevel.bgColor+'22'};color:${myLevel.textColor||'#ff6b35'};border-radius:12px;font-weight:600;">${b}</span>
                    `).join('')}
                </div>
                <div style="font-size:11px;color:#999;margin-top:8px;padding-top:8px;border-top:1px dashed #f0f0f0;">
                    购物享${(myLevel.discount*10).toFixed(1)}折${myLevel.freeShipping?' · 全场包邮':''} · 积分${myLevel.pointsRate}倍
                </div>
            </div>
            <!-- 专属活动 -->
            ${activities.length>0?`
            <div style="background:#fff;border-radius:12px;padding:12px;margin-bottom:10px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="font-weight:700;font-size:13px;color:#333;">🎉 今日活动</div>
                    <span style="font-size:11px;color:#ff6b35;cursor:pointer;" onclick="event.stopPropagation();ui.showMemberCenterModal('activities')">查看全部 ›</span>
                </div>
                ${activities.slice(0,2).map(a=>`
                    <div style="display:flex;align-items:center;gap:8px;padding:8px;background:#fafafa;border-radius:8px;margin-bottom:6px;">
                        <span style="font-size:20px;">${a.icon}</span>
                        <div style="flex:1;">
                            <div style="font-size:12px;font-weight:600;">${a.title}</div>
                            <div style="font-size:10px;color:#999;">${a.desc}</div>
                        </div>
                        <button class="btn btn-small" style="background:#ff6b35;color:#fff;font-size:10px;padding:4px 10px;"
                                onclick="event.stopPropagation();ui.doJoinActivity('${a.id}')">参与</button>
                    </div>
                `).join('')}
            </div>
            `:''}
            <!-- 最近订单 -->
            <div style="background:#fff;border-radius:12px;padding:12px;">
                <div style="font-weight:700;font-size:13px;color:#333;margin-bottom:8px;">📦 最近订单</div>
                ${orders.length===0?`
                    <div style="text-align:center;padding:16px;color:#999;font-size:12px;">暂无订单记录</div>
                `:`
                    <div style="display:flex;flex-direction:column;gap:6px;">
                        ${orders.map(o=>{
                            const lv = o.isMember? (MEMBER_LEVELS.find(l=>l.level===(o.memberLevel||1))||MEMBER_LEVELS[0]) : null;
                            return `
                            <div style="display:flex;align-items:center;gap:8px;padding:8px;background:#fafafa;border-radius:8px;font-size:11px;">
                                <span style="font-size:16px;">${lv?lv.icon:'👤'}</span>
                                <div style="flex:1;min-width:0;">
                                    <div style="font-weight:600;">${escapeHtml(o.buyerName||'顾客')}</div>
                                    <div style="color:#999;font-size:10px;">第${o.createDay||1}天 · ${o.items?.length||0}件商品</div>
                                </div>
                                <div style="text-align:right;">
                                    <div style="font-weight:700;color:#ff6b35;">¥${o.totalAmount||0}</div>
                                    <div style="font-size:10px;color:#999;">${this._getOrderStatusText(o.status)}</div>
                                </div>
                            </div>`;
                        }).join('')}
                    </div>
                `}
            </div>
        `;
    }

    _getOrderStatusText(status) {
        const map = {
            'pending_payment': '待付款', 'pending_packing': '待打包', 'pending_shipment': '待发货',
            'shipped': '已发货', 'completed': '已完成', 'cancelled': '已取消', 'refunding': '退款中'
        };
        return map[status] || status;
    }

    // 个人资料
    _renderMemberProfile(player) {
        const genders = [{id:'male',icon:'👨',name:'男'},{id:'female',icon:'👩',name:'女'},{id:'secret',icon:'🙂',name:'保密'}];
        return `
            <div style="background:#fff;border-radius:12px;padding:14px;margin-bottom:10px;">
                <div style="text-align:center;margin-bottom:12px;">
                    <div style="font-size:60px;margin-bottom:8px;cursor:pointer;" onclick="event.stopPropagation();ui.showAvatarPicker()">${player.avatar||'👨‍💼'}</div>
                    <button class="btn btn-small" style="background:#f5f5f5;color:#666;font-size:11px;"
                            onclick="event.stopPropagation();ui.showAvatarPicker()">🔄 更换头像</button>
                </div>
                <div style="border-top:1px solid #f0f0f0;padding-top:12px;">
                    <div class="profile-field" style="margin-bottom:12px;">
                        <label style="font-size:11px;color:#999;display:block;margin-bottom:4px;">店主昵称</label>
                        <input type="text" id="profile_name" value="${escapeHtml(player.name||'')}" placeholder="请输入昵称(2-12字)" 
                               style="width:100%;padding:8px 10px;border:1px solid #e0e0e0;border-radius:8px;font-size:13px;box-sizing:border-box;" maxlength="12">
                    </div>
                    <div class="profile-field" style="margin-bottom:12px;">
                        <label style="font-size:11px;color:#999;display:block;margin-bottom:4px;">性别</label>
                        <div style="display:flex;gap:8px;" id="profile_gender">
                            ${genders.map(g=>`
                                <div data-gender="${g.id}" onclick="event.stopPropagation();ui.selectProfileGender('${g.id}')"
                                     style="flex:1;padding:8px;text-align:center;border-radius:8px;cursor:pointer;font-size:12px;border:2px solid ${player.gender===g.id?'#ff6b35':'#e0e0e0'};background:${player.gender===g.id?'#fff3e0':'#fff'};color:${player.gender===g.id?'#ff6b35':'#666'};">
                                    ${g.icon} ${g.name}
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    <div class="profile-field" style="margin-bottom:12px;">
                        <label style="font-size:11px;color:#999;display:block;margin-bottom:4px;">生日 (MM-DD)</label>
                        <input type="text" id="profile_birthday" value="${escapeHtml(player.birthday||'')}" placeholder="例如: 08-15" 
                               style="width:100%;padding:8px 10px;border:1px solid #e0e0e0;border-radius:8px;font-size:13px;box-sizing:border-box;" maxlength="5">
                    </div>
                    <div class="profile-field" style="margin-bottom:12px;">
                        <label style="font-size:11px;color:#999;display:block;margin-bottom:4px;">联系电话</label>
                        <input type="tel" id="profile_phone" value="${escapeHtml(player.phone||'')}" placeholder="选填" 
                               style="width:100%;padding:8px 10px;border:1px solid #e0e0e0;border-radius:8px;font-size:13px;box-sizing:border-box;" maxlength="20">
                    </div>
                    <div class="profile-field" style="margin-bottom:12px;">
                        <label style="font-size:11px;color:#999;display:block;margin-bottom:4px;">个人简介</label>
                        <textarea id="profile_bio" placeholder="介绍一下自己吧..." rows="2"
                                  style="width:100%;padding:8px 10px;border:1px solid #e0e0e0;border-radius:8px;font-size:13px;box-sizing:border-box;resize:none;">${escapeHtml(player.bio||'')}</textarea>
                    </div>
                    <button class="btn btn-primary" style="width:100%;padding:10px;background:linear-gradient(135deg,#ff6b35,#ff9800);border:none;font-weight:700;"
                            onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                            onclick="event.stopPropagation();ui.saveProfileInfo()">💾 保存资料</button>
                </div>
            </div>
            <div style="background:#fff;border-radius:12px;padding:14px;">
                <div style="font-weight:700;font-size:13px;color:#333;margin-bottom:8px;">📊 签到数据</div>
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center;">
                    <div><div style="font-size:18px;font-weight:bold;color:#ff6b35;">${player.signInDays||0}</div><div style="font-size:10px;color:#999;">累计签到</div></div>
                    <div><div style="font-size:18px;font-weight:bold;color:#4caf50;">${player.continuousSignIn||0}</div><div style="font-size:10px;color:#999;">连续签到</div></div>
                    <div><div style="font-size:18px;font-weight:bold;color:#2196f3;">${player.lastSignInDay||0}</div><div style="font-size:10px;color:#999;">上次签到(天)</div></div>
                </div>
            </div>
        `;
    }

    selectProfileGender(gender) {
        document.querySelectorAll('#profile_gender > div').forEach(el => {
            const g = el.dataset.gender;
            if (g === gender) {
                el.style.border = '2px solid #ff6b35';
                el.style.background = '#fff3e0';
                el.style.color = '#ff6b35';
            } else {
                el.style.border = '2px solid #e0e0e0';
                el.style.background = '#fff';
                el.style.color = '#666';
            }
        });
        this._profileGender = gender;
    }

    showAvatarPicker() {
        const avatars = AVATAR_PRESETS || ['👨‍💼','👩‍💼','🧑‍💻','👨‍🎓','👩‍🎓','🦊','🐱','🐶','🐼','🌟','💎','👑'];
        const current = gameState.state.player?.avatar || '👨‍💼';
        const content = `
            <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;padding:10px;">
                ${avatars.map(a=>`
                    <div onclick="event.stopPropagation();ui.pickAvatar('${a}')"
                         style="aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-size:28px;border-radius:12px;cursor:pointer;border:2px solid ${a===current?'#ff6b35':'#f0f0f0'};background:${a===current?'#fff3e0':'#fff'};">
                        ${a}
                    </div>
                `).join('')}
            </div>
        `;
        const footer = `<button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>`;
        this.showModal('选择头像', content, footer);
    }

    pickAvatar(avatar) {
        gameState.updatePlayerInfo({ avatar });
        this.closeModal();
        this.showToast('✅ 头像已更换');
        setTimeout(() => this.showMemberCenterModal('profile'), 100);
    }

    saveProfileInfo() {
        const name = document.getElementById('profile_name')?.value?.trim() || '';
        const birthday = document.getElementById('profile_birthday')?.value?.trim() || '';
        const phone = document.getElementById('profile_phone')?.value?.trim() || '';
        const bio = document.getElementById('profile_bio')?.value?.trim() || '';
        const gender = this._profileGender || gameState.state.player?.gender || 'secret';

        if (name.length < 2 || name.length > 12) {
            this.showToast('❌ 昵称长度需2-12个字符');
            return;
        }
        if (birthday && !/^\d{2}-\d{2}$/.test(birthday)) {
            this.showToast('❌ 生日格式错误，请输入MM-DD格式');
            return;
        }

        gameState.updatePlayerInfo({ name, gender, birthday, phone, bio });
        this.showToast('✅ 资料保存成功');
        setTimeout(() => {
            this.closeModal();
            if (typeof ui.render === 'function') ui.render();
        }, 200);
    }

    // 等级权益
    _renderMemberLevel(myLevel, nextLevel, stats) {
        return `
            <!-- 当前等级卡片 -->
            <div style="background:${myLevel.bgColor?.includes('gradient')?myLevel.bgColor:`linear-gradient(135deg,${myLevel.bgColor},${myLevel.bgColor})`};border-radius:12px;padding:16px;color:${myLevel.textColor||'#fff'};margin-bottom:12px;text-align:center;">
                <div style="font-size:48px;margin-bottom:4px;">${myLevel.icon}</div>
                <div style="font-size:20px;font-weight:900;">${myLevel.name}</div>
                <div style="font-size:11px;opacity:.85;margin-top:4px;">${myLevel.desc}</div>
                ${nextLevel?`
                <div style="margin-top:12px;background:rgba(0,0,0,0.15);border-radius:8px;height:10px;overflow:hidden;">
                    <div style="height:100%;background:#fff;width:${Math.min(100,(stats.totalGrowth/nextLevel.needGrowth)*100)}%;border-radius:8px;"></div>
                </div>
                <div style="font-size:11px;margin-top:4px;opacity:.9;">成长值 ${stats.totalGrowth} / ${nextLevel.needGrowth}，还需 ${nextLevel.needGrowth - stats.totalGrowth} 点升级</div>
                `:`<div style="margin-top:8px;font-size:12px;">🏆 已达最高等级，尊享全部权益！</div>`}
            </div>
            <!-- 权益详情 -->
            <div style="background:#fff;border-radius:12px;padding:12px;margin-bottom:10px;">
                <div style="font-weight:700;font-size:13px;margin-bottom:10px;">🎁 当前等级权益</div>
                <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">
                    ${[
                        {label:'购物折扣',value:`${(myLevel.discount*10).toFixed(1)}折`,icon:'🏷️',active:myLevel.discount<1},
                        {label:'全场包邮',value:myLevel.freeShipping?'已开启':'未开启',icon:'🚚',active:myLevel.freeShipping},
                        {label:'积分倍率',value:`${myLevel.pointsRate}倍`,icon:'⭐',active:true},
                        {label:'优先发货',value:myLevel.priorityShipping?'已开启':'未开启',icon:'⚡',active:myLevel.priorityShipping},
                        {label:'专属客服',value:myLevel.exclusiveService?'已开启':'未开启',icon:'💬',active:myLevel.exclusiveService},
                        {label:'生日礼包',value:myLevel.birthdayGift?'已开启':'未开启',icon:'🎂',active:myLevel.birthdayGift},
                        {label:'每月优惠券',value:`${myLevel.monthlyCoupons||0}张`,icon:'🎫',active:(myLevel.monthlyCoupons||0)>0},
                        {label:'VIP活动',value:myLevel.vipEvents?'邀请制':'未开放',icon:'🎉',active:myLevel.vipEvents}
                    ].map(b=>`
                        <div style="padding:8px;border-radius:8px;background:${b.active?'#fff3e0':'#f5f5f5'};text-align:center;">
                            <div style="font-size:18px;">${b.icon}</div>
                            <div style="font-size:10px;color:#999;margin-top:2px;">${b.label}</div>
                            <div style="font-size:12px;font-weight:700;color:${b.active?'#ff6b35':'#999'};">${b.value}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
            <!-- 全部等级一览 -->
            <div style="background:#fff;border-radius:12px;padding:12px;">
                <div style="font-weight:700;font-size:13px;margin-bottom:10px;">📊 全部等级体系</div>
                ${MEMBER_LEVELS.map(lv=>{
                    const isCurrent = lv.level === myLevel.level;
                    const locked = lv.level > myLevel.level;
                    return `
                    <div style="display:flex;align-items:center;gap:10px;padding:10px;border-radius:10px;margin-bottom:6px;${isCurrent?'background:linear-gradient(135deg,#fff3e0,#ffe0b2);border:2px solid #ff9800;':locked?'background:#fafafa;opacity:.7;':'background:#f9f9f9;'}">
                        <div style="font-size:28px;width:40px;text-align:center;${isCurrent?'filter:drop-shadow(0 2px 4px rgba(255,152,0,0.4))':''}">${lv.icon}</div>
                        <div style="flex:1;">
                            <div style="display:flex;align-items:center;gap:6px;">
                                <span style="font-weight:700;font-size:13px;${isCurrent?'color:#e65100;':''}">${lv.name}</span>
                                ${isCurrent?'<span style="font-size:9px;padding:1px 5px;background:#ff6b35;color:#fff;border-radius:8px;">当前</span>':''}
                                ${locked?'<span style="font-size:10px;color:#999;">🔒</span>':''}
                            </div>
                            <div style="font-size:10px;color:#999;margin-top:2px;">成长值${lv.minGrowth}+ / 消费¥${lv.minSpent}+</div>
                            <div style="font-size:10px;color:#666;margin-top:3px;">${(lv.benefits||[]).slice(0,3).join(' · ')}</div>
                        </div>
                        <div style="text-align:right;font-size:11px;">
                            <div style="font-weight:700;color:${locked?'#999':'#ff6b35'};">${(lv.discount*10).toFixed(1)}折</div>
                            <div style="color:#999;font-size:10px;">${lv.pointsRate}倍积分</div>
                        </div>
                    </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    // 顾客会员列表
    _renderMemberList(members) {
        const list = (members.list || []).slice().sort((a,b)=>(b.spent||0)-(a.spent||0));
        const filter = this._memberFilter || 'all';
        const filtered = filter==='all' ? list : list.filter(m=>m.level===parseInt(filter));
        return `
            <!-- 筛选 -->
            <div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;">
                ${[{k:'all',n:'全部',i:'👥'},{k:'1',n:'普通',i:'🌱'},{k:'2',n:'银卡',i:'🥈'},{k:'3',n:'金卡',i:'🥇'},{k:'4',n:'铂金',i:'💠'},{k:'5',n:'钻石',i:'💎'}].map(f=>`
                    <span onclick="event.stopPropagation();ui.setMemberFilter('${f.k}')"
                          style="padding:5px 10px;border-radius:14px;font-size:11px;cursor:pointer;
                          ${String(filter)===f.k?'background:linear-gradient(135deg,#ff6b35,#ff9800);color:#fff;font-weight:700;':'background:#fff;color:#666;'}">
                        ${f.i} ${f.n}${f.k==='all'?`(${list.length})`:`(${list.filter(m=>m.level===parseInt(f.k)).length})`}
                    </span>
                `).join('')}
            </div>
            <!-- 搜索框 -->
            <div style="background:#fff;border-radius:10px;padding:8px 12px;margin-bottom:10px;display:flex;align-items:center;gap:8px;">
                <span style="color:#999;">🔍</span>
                <input type="text" id="member_search" placeholder="搜索顾客昵称，查看积分/储值..." 
                       oninput="event.stopPropagation();ui.filterMemberSearch(this.value)"
                       style="flex:1;border:none;outline:none;font-size:12px;background:transparent;">
            </div>
            ${filtered.length===0?`
                <div style="background:#fff;border-radius:12px;padding:30px;text-align:center;color:#999;font-size:12px;">
                    暂无该等级会员<br><br>
                    <span style="font-size:11px;">💡 顾客消费后自动成为会员</span>
                </div>
            `:`
                <div style="display:flex;flex-direction:column;gap:6px;" id="member_list_container">
                    ${filtered.slice(0,50).map(m=>{
                        const lv = MEMBER_LEVELS.find(l=>l.level===m.level)||MEMBER_LEVELS[0];
                        return `
                        <div style="background:#fff;border-radius:10px;padding:10px;display:flex;align-items:center;gap:10px;cursor:pointer;"
                             onclick="event.stopPropagation();ui.showMemberDetail('${m.id}')">
                            <div style="width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;background:${lv.bgColor?.includes('gradient')?'#fff3e0':lv.bgColor+'22'}">${lv.icon}</div>
                            <div style="flex:1;min-width:0;">
                                <div style="font-size:13px;font-weight:700;display:flex;align-items:center;gap:4px;">
                                    ${escapeHtml(m.name)}
                                    <span style="font-size:9px;padding:1px 4px;background:${lv.bgColor?.includes('gradient')?'#e91e63':lv.bgColor};color:${lv.textColor||'#fff'};border-radius:6px;">${lv.name}</span>
                                </div>
                                <div style="font-size:10px;color:#999;margin-top:2px;">
                                    积分 <b style="color:#ff6b35;">${m.points||0}</b> · 储值 ¥${(m.wallet||0).toFixed(0)} · 消费¥${m.spent||0}
                                </div>
                            </div>
                            <div style="text-align:right;">
                                <div style="font-size:11px;color:#ff6b35;font-weight:700;">${m.points||0}积分</div>
                                <div style="font-size:10px;color:#00897b;">余额¥${(m.wallet||0).toFixed(0)}</div>
                            </div>
                        </div>
                        `;
                    }).join('')}
                </div>
                ${filtered.length>50?`<div style="text-align:center;padding:10px;font-size:11px;color:#999;">仅显示前50位会员</div>`:''}
            `}
        `;
    }

    setMemberFilter(key) {
        this._memberFilter = key;
        this.showMemberCenterModal('members');
    }

    _renderMemberRecharge(members) {
        const cfg = gameState.getMemberRechargeConfig();
        const rules = cfg.rules || [];
        const logs = members.rechargeLogs || [];
        const st = members.statistics || {};
        return `
            <div style="background:#fff;border-radius:12px;padding:12px;margin-bottom:10px;">
                <div style="display:flex;align-items:center;gap:10px;">
                    <div style="flex:1;">
                        <div style="font-weight:700;font-size:13px;">会员充值</div>
                        <div style="font-size:11px;color:#666;margin-top:3px;line-height:1.5;">开启后顾客可按档位充值，到账金额=实付+赠送。储值下单时优先抵扣。</div>
                    </div>
                    <button class="btn ${cfg.enabled ? 'btn-secondary' : 'btn-primary'} btn-small"
                            onclick="event.stopPropagation();ui.toggleMemberRecharge()">${cfg.enabled ? '已开启' : '未开启'}</button>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;">
                    <div style="background:#e0f2f1;border-radius:8px;padding:8px;text-align:center;">
                        <div style="font-size:15px;font-weight:800;color:#00695c;">¥${(st.totalRecharge||0).toFixed(0)}</div>
                        <div style="font-size:10px;color:#00695c;">累计实付</div>
                    </div>
                    <div style="background:#fff8e1;border-radius:8px;padding:8px;text-align:center;">
                        <div style="font-size:15px;font-weight:800;color:#f57f17;">¥${(st.totalRechargeBonus||0).toFixed(0)}</div>
                        <div style="font-size:10px;color:#f57f17;">累计赠送</div>
                    </div>
                </div>
            </div>
            <div style="background:#fff;border-radius:12px;padding:12px;margin-bottom:10px;">
                <div style="font-weight:700;font-size:13px;margin-bottom:8px;">充值奖励档位</div>
                <div style="font-size:11px;color:#888;margin-bottom:8px;">例如：充 1000 送 50，顾客到账 1050。</div>
                ${rules.map((r, i) => `
                    <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
                        <span style="font-size:11px;color:#666;width:28px;">充</span>
                        <input id="rcg_pay_${i}" type="number" value="${r.pay}" style="flex:1;padding:6px 8px;border:1px solid #eee;border-radius:8px;font-size:12px;">
                        <span style="font-size:11px;color:#666;">送</span>
                        <input id="rcg_bonus_${i}" type="number" value="${r.bonus}" style="flex:1;padding:6px 8px;border:1px solid #eee;border-radius:8px;font-size:12px;">
                        <button class="btn btn-small btn-secondary" onclick="event.stopPropagation();ui.removeRechargeRule(${i})">删</button>
                    </div>
                `).join('') || '<div style="font-size:12px;color:#999;padding:8px 0;">还没有档位，先加一条</div>'}
                <div style="display:flex;gap:8px;margin-top:8px;">
                    <button class="btn btn-secondary btn-small" onclick="event.stopPropagation();ui.addRechargeRuleRow()">＋ 增加档位</button>
                    <button class="btn btn-primary btn-small" onclick="event.stopPropagation();ui.saveRechargeRules(${rules.length})">保存奖励</button>
                </div>
            </div>
            <div style="background:#fff;border-radius:12px;padding:12px;">
                <div style="font-weight:700;font-size:13px;margin-bottom:8px;">最近充值</div>
                ${logs.length === 0 ? '<div style="font-size:12px;color:#999;text-align:center;padding:16px;">暂无记录。可在顾客详情里「去充值」，开启后顾客也会自行充值。</div>' : logs.slice(0, 20).map(l => `
                    <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f5f5f5;font-size:12px;">
                        <div>
                            <div style="font-weight:600;">${escapeHtml(l.memberName || '')}</div>
                            <div style="font-size:10px;color:#999;">第${l.day}天 ${String(l.hour||0).padStart(2,'0')}:00</div>
                        </div>
                        <div style="text-align:right;color:#00897b;font-weight:700;">+¥${(l.credited||0).toFixed(0)}<div style="font-size:10px;color:#999;font-weight:400;">付${l.pay} 送${l.bonus||0}</div></div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    toggleMemberRecharge() {
        const cfg = gameState.getMemberRechargeConfig();
        const res = gameState.setMemberRechargeEnabled(!cfg.enabled);
        this.showToast((res && res.message) || '已切换');
        this.showMemberCenterModal('recharge');
    }

    addRechargeRuleRow() {
        const cfg = gameState.getMemberRechargeConfig();
        const rules = (cfg.rules || []).slice();
        rules.push({ pay: 1000, bonus: 50 });
        gameState.saveMemberRechargeRules(rules);
        this.showMemberCenterModal('recharge');
    }

    removeRechargeRule(index) {
        const cfg = gameState.getMemberRechargeConfig();
        const rules = (cfg.rules || []).filter((_, i) => i !== index);
        gameState.saveMemberRechargeRules(rules);
        this.showMemberCenterModal('recharge');
    }

    saveRechargeRules(count) {
        const rules = [];
        for (let i = 0; i < count; i++) {
            const payEl = document.getElementById('rcg_pay_' + i);
            const bonusEl = document.getElementById('rcg_bonus_' + i);
            rules.push({
                pay: payEl ? Number(payEl.value) : 0,
                bonus: bonusEl ? Number(bonusEl.value) : 0
            });
        }
        const res = gameState.saveMemberRechargeRules(rules);
        this.showToast((res && res.message) || '已保存');
        this.showMemberCenterModal('recharge');
    }

    showMemberRechargeModal(memberId) {
        const member = gameState.findMemberById(memberId);
        if (!member) { this.showToast('会员不存在'); return; }
        const cfg = gameState.getMemberRechargeConfig();
        if (!cfg.enabled) {
            this.showToast('请先在「充值设置」里开启会员充值');
            this.showMemberCenterModal('recharge');
            return;
        }
        const rules = cfg.rules || [];
        const content = `
            <div style="font-size:13px;margin-bottom:10px;">顾客 <b>${escapeHtml(member.name)}</b> · 当前储值 ¥${(member.wallet||0).toFixed(2)}</div>
            ${rules.map(r => `
                <button class="btn btn-primary" style="width:100%;margin-bottom:8px;text-align:left;"
                        onclick="ui.doMemberRecharge('${member.id}', ${r.pay})">
                    充 ¥${r.pay}　送 ¥${r.bonus}　<span style="opacity:.85">到账 ¥${r.pay + r.bonus}</span>
                </button>
            `).join('') || '<div style="color:#999;font-size:12px;">请先配置充值档位</div>'}
        `;
        this.showModal('会员充值 - ' + member.name, content, '<button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>');
    }

    doMemberRecharge(memberId, pay) {
        const res = gameState.memberRecharge(memberId, pay);
        this.showToast((res && res.message) || '充值失败');
        if (res && res.success) {
            this.closeModal();
            setTimeout(() => this.showMemberDetail(memberId), 80);
        }
    }

    filterMemberSearch(keyword) {
        keyword = (keyword||'').trim().toLowerCase();
        const container = document.getElementById('member_list_container');
        if (!container) return;
        const members = gameState.state.members?.list || [];
        const filter = this._memberFilter || 'all';
        const filtered = members.filter(m=>{
            if (filter !== 'all' && m.level !== parseInt(filter)) return false;
            if (keyword && !(m.name||'').toLowerCase().includes(keyword)) return false;
            return true;
        }).sort((a,b)=>(b.spent||0)-(a.spent||0)).slice(0,50);
        
        container.innerHTML = filtered.map(m=>{
            const lv = MEMBER_LEVELS.find(l=>l.level===m.level)||MEMBER_LEVELS[0];
            return `<div style="background:#fff;border-radius:10px;padding:10px;display:flex;align-items:center;gap:10px;cursor:pointer;margin-bottom:6px;"
                        onclick="event.stopPropagation();ui.showMemberDetail('${m.id}')">
                <div style="width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;background:${lv.bgColor?.includes('gradient')?'#fff3e0':lv.bgColor+'22'}">${lv.icon}</div>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;font-weight:700;">${escapeHtml(m.name)}</div>
                    <div style="font-size:10px;color:#999;margin-top:2px;">积分${m.points||0} · 储值¥${(m.wallet||0).toFixed(0)} · 消费¥${m.spent||0}</div>
                </div>
                <div style="text-align:right;font-size:11px;color:#ff6b35;font-weight:700;">${m.points||0}分</div>
            </div>`;
        }).join('') || '<div style="text-align:center;padding:20px;color:#999;font-size:12px;">未找到匹配会员</div>';
    }

    showMemberDetail(memberId) {
        const member = gameState.findMemberById(memberId);
        if (!member) { this.showToast('❌ 会员不存在'); return; }
        const lv = MEMBER_LEVELS.find(l=>l.level===member.level)||MEMBER_LEVELS[0];
        const orderData = gameState.getMemberOrders(member.name, 'all', 1, 10);
        const config = gameState.getBenefitsConfig();
        const redeemEnabled = config.redeemRule.enabled;
        const content = `
            <div style="text-align:center;padding:10px 0;">
                <div style="width:60px;height:60px;margin:0 auto;border-radius:50%;background:${lv.bgColor?.includes('gradient')?'#fff3e0':lv.bgColor+'33'};display:flex;align-items:center;justify-content:center;font-size:32px;">${lv.icon}</div>
                <div style="font-size:18px;font-weight:900;margin-top:8px;">${escapeHtml(member.name)}</div>
                <span style="display:inline-block;margin-top:4px;padding:3px 10px;border-radius:12px;font-size:11px;color:${lv.textColor||'#fff'};background:${lv.bgColor?.includes('gradient')?'linear-gradient(135deg,#e91e63,#9c27b0)':lv.bgColor};">${lv.name}</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:12px 0;">
                <div style="text-align:center;padding:8px;background:#fff3e0;border-radius:8px;">
                    <div style="font-size:15px;font-weight:bold;color:#ff6b35;">¥${member.spent||0}</div>
                    <div style="font-size:10px;color:#999;">累计消费</div>
                </div>
                <div style="text-align:center;padding:8px;background:#e8f5e9;border-radius:8px;">
                    <div style="font-size:15px;font-weight:bold;color:#4caf50;">${member.orderCount||0}</div>
                    <div style="font-size:10px;color:#999;">订单数</div>
                </div>
                <div style="text-align:center;padding:8px;background:#e3f2fd;border-radius:8px;cursor:pointer;${redeemEnabled && (member.points||0)>0?'box-shadow:0 0 0 2px #ff6b35 inset;':''}"
                     onclick="event.stopPropagation();ui.showMemberRedeemModal('${member.id}')" title="点击去兑换">
                    <div style="font-size:15px;font-weight:bold;color:#1976d2;">${member.points||0}</div>
                    <div style="font-size:10px;color:#999;">积分${redeemEnabled && (member.points||0)>0?'·兑':''}</div>
                </div>
                <div style="text-align:center;padding:8px;background:#e0f2f1;border-radius:8px;">
                    <div style="font-size:15px;font-weight:bold;color:#00897b;">¥${(member.wallet||0).toFixed(0)}</div>
                    <div style="font-size:10px;color:#999;">储值余额</div>
                </div>
            </div>
            <div style="background:#f5f5f5;border-radius:8px;padding:10px;font-size:11px;color:#666;margin-bottom:12px;">
                <div>成长值：${member.growth||0} · 累计充值¥${(member.recharged||0).toFixed(0)} · 获赠¥${(member.rechargeBonus||0).toFixed(0)}</div>
                <div>加入时间：第${member.joinDay||1}天 · 最近下单：第${member.lastOrderDay||member.joinDay||1}天</div>
                <div>享${(lv.discount*10).toFixed(1)}折${lv.freeShipping?' · 包邮':''} · ${lv.pointsRate}倍积分</div>
            </div>
            <div style="background:#e0f2f1;border-radius:10px;padding:10px 12px;margin-bottom:12px;border-left:4px solid #00897b;">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                    <div>
                        <div style="font-weight:700;font-size:12px;color:#00695c;">💳 会员充值</div>
                        <div style="font-size:10px;color:#004d40;margin-top:2px;">按店铺充送规则入账储值，下单可抵扣</div>
                    </div>
                    <button class="btn btn-small" style="background:#00897b;color:#fff;border:none;"
                            onclick="event.stopPropagation();ui.showMemberRechargeModal('${member.id}')">去充值</button>
                </div>
            </div>
            <!-- 快捷操作：积分兑换 -->
            <div style="background:linear-gradient(135deg,#fff3e0,#ffe0b2);border-radius:10px;padding:10px 12px;margin-bottom:12px;border-left:4px solid #ff6b35;">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                    <div style="flex:1;min-width:0;">
                        <div style="font-weight:700;font-size:12px;color:#d84315;">🎁 会员积分兑换</div>
                        <div style="font-size:10px;color:#9c5b00;margin-top:2px;">
                            ${redeemEnabled?`当前可用 <b>${member.points||0}</b> 积分，点击右侧立即兑换`:'积分兑换暂未开放，请在权益管理中开启'}
                        </div>
                    </div>
                    <button class="btn btn-small"
                            ${redeemEnabled?'':'disabled style="opacity:.5;cursor:not-allowed;background:#ddd;color:#999;border:none;"'}
                            style="background:linear-gradient(135deg,#ff6b35,#ff9800);color:#fff;font-weight:600;border:none;flex-shrink:0;padding:6px 12px;"
                            onclick="event.stopPropagation();ui.showMemberRedeemModal('${member.id}')">
                        立即兑换
                    </button>
                </div>
            </div>
            <div style="font-weight:700;font-size:13px;margin-bottom:8px;">📦 最近订单 (${orderData.total}笔)</div>
            ${orderData.list.length===0?`<div style="text-align:center;padding:16px;color:#999;font-size:12px;background:#fafafa;border-radius:8px;">暂无订单记录</div>`:`
            <div style="max-height:200px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;">
                ${orderData.list.map(o=>`
                    <div style="padding:8px;background:#fafafa;border-radius:6px;font-size:11px;display:flex;justify-content:space-between;align-items:center;">
                        <span>第${o.createDay||1}天 · ${o.items?.length||0}件商品</span>
                        <span style="font-weight:700;color:#ff6b35;">¥${o.totalAmount||0}</span>
                    </div>
                `).join('')}
            </div>`}
        `;
        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>
            <button class="btn btn-secondary"
                    onclick="event.stopPropagation();ui.closeModal();ui.showMemberRechargeModal('${member.id}')">💳 充值</button>
            <button class="btn btn-primary"
                    ${redeemEnabled?'':'disabled style="opacity:.5;cursor:not-allowed;background:#aaa;"'}
                    onclick="event.stopPropagation();ui.closeModal();ui.showMemberRedeemModal('${member.id}')"
                    ${redeemEnabled?'':''}>🎁 帮TA兑换</button>
        `;
        this.showModal('会员详情 - ' + member.name, content, footer);
    }

    // 会员积分兑换弹窗（以指定会员身份兑换）
    showMemberRedeemModal(memberId) {
        const member = gameState.findMemberById(memberId);
        if (!member) { this.showToast('❌ 会员不存在'); return; }
        const lv = MEMBER_LEVELS.find(l=>l.level===member.level)||MEMBER_LEVELS[0];
        const config = gameState.getBenefitsConfig();
        const benefitTypes = (typeof BENEFIT_TYPES !== 'undefined') ? BENEFIT_TYPES : {};
        const points = member.points || 0;
        const memberLevel = member.level || 1;
        const allBenefits = gameState.getAvailableBenefits(memberLevel);
        const curCat = this._memberMallFilter || 'all';
        const filtered = curCat === 'all' ? allBenefits : allBenefits.filter(b=>b.type===curCat);

        const items = filtered.map(b => {
            const remain = Math.max(0, (b.stock||0) - (b.sold||0));
            const costOk = points >= b.pointsCost;
            const stockOk = remain > 0;
            const disabled = !costOk || !stockOk || !config.redeemRule.enabled;
            const reason = !config.redeemRule.enabled ? '暂未开放' : (!stockOk ? '已兑完' : (!costOk ? `差${b.pointsCost - points}分` : ''));
            const bLv = (typeof MEMBER_LEVELS !== 'undefined' ? MEMBER_LEVELS : []).find(l => l.level === b.minLevel) || { icon: '👤', name: '新会员' };
            const tInfo = benefitTypes[b.type] || { name: '权益', color: '#ff6b35' };
            const highlightStyle = costOk && stockOk && config.redeemRule.enabled
                ? `;box-shadow:0 0 0 2px #ff6b35;border-color:#ff6b35;background:linear-gradient(135deg,#fff8e1,#ffe0b2);`
                : '';
            return `
                <div style="background:#fff;border-radius:10px;padding:10px;${highlightStyle}">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <div style="font-size:28px;width:44px;height:44px;display:flex;align-items:center;justify-content:center;background:${tInfo.color}22;border-radius:10px;flex-shrink:0;">${b.icon}</div>
                        <div style="flex:1;min-width:0;">
                            <div style="display:flex;align-items:center;gap:6px;">
                                <span style="font-weight:700;font-size:13px;">${b.name}</span>
                                <span style="font-size:9px;padding:1px 5px;background:${tInfo.color}22;color:${tInfo.color};border-radius:8px;">${tInfo.name}</span>
                                ${costOk && stockOk && config.redeemRule.enabled ? '<span style="font-size:9px;padding:1px 5px;background:#e8f5e9;color:#2e7d32;border-radius:8px;">✨ 可兑换</span>' : ''}
                            </div>
                            <div style="font-size:10px;color:#999;margin-top:2px;line-height:1.4;">${b.desc||''}</div>
                            <div style="font-size:10px;color:#ff9800;margin-top:2px;">${bLv.icon}${bLv.name}+可兑 · 剩${remain}份 · 有效期${b.validDays||7}天</div>
                        </div>
                        <div style="text-align:right;flex-shrink:0;">
                            <div style="font-weight:800;color:#ff6b35;font-size:14px;">${b.pointsCost}分</div>
                            <button class="btn btn-small"
                                    ${disabled?'disabled style="margin-top:4px;opacity:.6;cursor:not-allowed;background:#eee;color:#999;border:none;padding:5px 10px;"':'style="margin-top:4px;background:linear-gradient(135deg,#ff6b35,#ff9800);color:#fff;border:none;font-weight:600;padding:5px 10px;"'}
                                    ${disabled?'':`onclick="event.preventDefault();event.stopPropagation();ui.confirmMemberRedeemBenefit('${member.id}','${b.id}')"`}>
                                ${reason || '立即兑换'}
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        const cats = [{ key:'all', name:'全部', icon:'🛍️' }, ...Object.values(benefitTypes).map(t=>({ key:t.id, name:t.name, icon:t.icon }))];

        const content = `
            <div style="padding:2px 2px;">
                <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:linear-gradient(135deg,${lv.bgColor?.includes('gradient')?'#fff3e0':lv.bgColor+'33'},#fff3e0);border-radius:10px;margin-bottom:10px;">
                    <div style="width:44px;height:44px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0;">${lv.icon}</div>
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:13px;font-weight:900;color:#333;">${escapeHtml(member.name)}<span style="font-size:10px;margin-left:4px;padding:1px 6px;background:${lv.bgColor?.includes('gradient')?'linear-gradient(135deg,#e91e63,#9c27b0)':lv.bgColor};color:${lv.textColor||'#fff'};border-radius:8px;">${lv.name}</span></div>
                        <div style="font-size:11px;color:#666;margin-top:2px;">
                            可用积分 <b style="font-size:16px;color:#d84315;">${points}</b>
                            <span style="margin-left:8px;">${config.redeemRule.enabled?'<span style="color:#4caf50;">● 兑换开放中</span>':'<span style="color:#f44336;">● 暂未开放</span>'}</span>
                        </div>
                    </div>
                </div>
                <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;">
                    ${cats.map(c=>`
                        <div class="mall-cat ${curCat===c.key?'on':''}"
                             onclick="event.preventDefault();event.stopPropagation();ui.setMemberMallFilter('${member.id}','${c.key}')"
                             style="padding:5px 10px;border-radius:14px;font-size:11px;cursor:pointer;user-select:none;flex-shrink:0;
                                    ${curCat===c.key?'background:linear-gradient(135deg,#ff9800,#ff6b35);color:#fff;font-weight:700;':'background:#fff;color:#555;'}">
                            ${c.icon} ${c.name}
                        </div>
                    `).join('')}
                </div>
                <div style="max-height:420px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding-right:2px;">
                    ${items || '<div style="text-align:center;padding:30px 0;color:#999;font-size:12px;background:#fff;border-radius:10px;">该会员暂无可用权益<br><span style="font-size:11px;">升级等级或等待补货</span></div>'}
                </div>
            </div>
        `;
        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>
            <button class="btn btn-primary" onclick="ui.closeModal();ui.showMemberCenterModal('mall');">去权益中心</button>
        `;
        this.showModal(`🎁 ${member.name} · 积分兑换`, content, footer);
    }

    setMemberMallFilter(memberId, key) {
        this._memberMallFilter = key;
        this.showMemberRedeemModal(memberId);
    }

    confirmMemberRedeemBenefit(memberId, benefitId) {
        const member = gameState.findMemberById(memberId);
        if (!member) { this.showToast('❌ 会员不存在'); return; }
        const config = gameState.getBenefitsConfig();
        const benefit = config.benefits.find(b=>b.id===benefitId);
        if (!benefit) { this.showToast('❌ 权益不存在'); return; }
        const curPoints = member.points||0;
        if (curPoints < benefit.pointsCost) { this.showToast('❌ 积分不足，还差 '+(benefit.pointsCost-curPoints)+' 分'); return; }
        const tInfo = (typeof BENEFIT_TYPES !== 'undefined' && BENEFIT_TYPES[benefit.type]) || { name: '权益' };
        const cc = `
            <div style="overflow-x:hidden;touch-action:pan-y;">
                <div style="text-align:center;padding:6px 0 14px;">
                    <div style="font-size:48px;margin-bottom:4px;">${benefit.icon}</div>
                    <div style="font-size:13px;color:#888;margin-bottom:2px;">代 <b style="color:#333;">${escapeHtml(member.name)}</b> 兑换</div>
                    <div style="font-size:15px;font-weight:900;">确认兑换「${benefit.name}」？</div>
                    <div style="font-size:11px;color:#999;margin-top:4px;">${tInfo.name} · ${benefit.desc||''}</div>
                </div>
                <div style="background:#fff8e1;border-radius:10px;padding:10px 12px;margin-bottom:10px;">
                    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px;">
                        <span style="color:#9c5b00;">当前积分</span><b style="color:#d84315;">${curPoints}</b>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px;">
                        <span style="color:#c62828;">扣减积分</span><b style="color:#c62828;">-${benefit.pointsCost}</b>
                    </div>
                    <div style="height:1px;background:#ffe0b2;margin:6px 0;"></div>
                    <div style="display:flex;justify-content:space-between;font-size:12px;">
                        <span style="color:#2e7d32;">兑换后剩余</span><b style="color:#2e7d32;font-size:14px;">${curPoints-benefit.pointsCost}</b>
                    </div>
                </div>
                <div style="font-size:11px;color:#666;line-height:1.6;background:#f5f5f5;border-radius:8px;padding:8px 10px;">
                    <div>📌 确认后将立即从【${escapeHtml(member.name)}】账户扣减积分</div>
                    <div>📌 虚拟权益即时到账，实物商品请等待发货</div>
                    <div>📌 兑换后${config.redeemRule.allowCancelMinutes||30}分钟内可取消</div>
                </div>
            </div>
        `;
        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal();ui.showMemberRedeemModal('${member.id}');">取消</button>
            <button class="btn btn-primary" onclick="ui.closeModal();ui.executeMemberRedeemBenefit('${member.id}','${benefitId}');">✅ 确认代兑换</button>
        `;
        this.showModal('兑换确认', cc, footer);
    }

    // 检查当前是否有包含指定关键词的弹窗处于打开状态
    _isModalOpen(titleKeyword) {
        const overlays = document.querySelectorAll('.modal-overlay');
        if (!overlays || overlays.length === 0) return false;
        for (let i = overlays.length - 1; i >= 0; i--) {
            const t = overlays[i].querySelector('.modal-title')?.textContent || '';
            if (t.includes(titleKeyword)) return true;
        }
        return false;
    }

    executeMemberRedeemBenefit(memberId, benefitId) {
        const member = gameState.findMemberById(memberId);
        if (!member) { this.showToast('❌ 会员数据异常'); return; }
        const res = gameState.redeemBenefit({ benefitId, memberId: member.id, memberName: member.name });
        if (res && res.success) {
            this.showToast('✅ 兑换成功！' + (res.rewardText || ''));
            setTimeout(()=>{
                // 如果底层是会员详情，关闭所有上层弹窗回到会员详情
                while (document.querySelectorAll('.modal-overlay').length > 1 &&
                       !this._isModalOpen('会员详情')) {
                    this.closeModal();
                }
                this.showMemberRedeemModal(memberId);
            }, 100);
        } else {
            this.showToast('❌ ' + ((res && res.message) || '兑换失败'));
            setTimeout(()=>this.showMemberRedeemModal(memberId), 200);
        }
    }

    // 积分明细
    _renderPointsLog(members) {
        const filter = this._pointsLogFilter || 'all';
        const logs = gameState.getPointsLogs(filter, 1, 50);
        const typeMap = POINTS_LOG_TYPES || {};
        return `
            <div style="background:linear-gradient(135deg,#fff3e0,#ffe0b2);border-radius:12px;padding:12px;margin-bottom:10px;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <div style="font-size:11px;color:#9c5b00;">顾客积分合计</div>
                        <div style="font-size:24px;font-weight:900;color:#d84315;">${(members.list||[]).reduce((s,m)=>s+(m.points||0),0)}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:11px;color:#9c5b00;">累计获得</div>
                        <div style="font-size:14px;font-weight:700;color:#2e7d32;">+${members.totalPointsEarned||0}</div>
                        <div style="font-size:11px;color:#c62828;">已消耗 -${members.totalPointsRedeemed||0}</div>
                    </div>
                </div>
            </div>
            <!-- 筛选 -->
            <div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;">
                ${[{k:'all',n:'全部',i:'📋'},{k:'earn',n:'收入',i:'📈'},{k:'spend',n:'支出',i:'📉'},{k:'earn_order',n:'消费',i:'🛒'},{k:'spend_redeem',n:'兑换',i:'🎁'}].map(f=>`
                    <span onclick="event.stopPropagation();ui.setPointsLogFilter('${f.k}')"
                          style="padding:5px 10px;border-radius:14px;font-size:11px;cursor:pointer;
                          ${filter===f.k?'background:linear-gradient(135deg,#4caf50,#2e7d32);color:#fff;font-weight:700;':'background:#fff;color:#666;'}">
                        ${f.i} ${f.n}
                    </span>
                `).join('')}
            </div>
            ${logs.length===0?`
                <div style="background:#fff;border-radius:12px;padding:30px;text-align:center;color:#999;font-size:12px;">暂无积分记录</div>
            `:`
                <div style="background:#fff;border-radius:12px;overflow:hidden;">
                    ${logs.map(l=>{
                        const typeInfo = typeMap[l.type]||{icon:'📝',name:l.type,color:'#666'};
                        const isEarn = l.amount > 0;
                        return `
                        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid #f5f5f5;">
                            <div style="width:36px;height:36px;border-radius:50%;background:${typeInfo.color}22;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">${typeInfo.icon}</div>
                            <div style="flex:1;min-width:0;">
                                <div style="font-size:12px;font-weight:600;">${typeInfo.name}</div>
                                <div style="font-size:10px;color:#999;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${l.desc||''} · 第${l.day}天${String(l.hour||0).padStart(2,'0')}:00</div>
                            </div>
                            <div style="font-weight:800;font-size:13px;color:${isEarn?'#4caf50':'#f44336'};">
                                ${isEarn?'+':''}${l.amount}
                            </div>
                        </div>
                        `;
                    }).join('')}
                </div>
            `}
        `;
    }

    setPointsLogFilter(key) {
        this._pointsLogFilter = key;
        this.showMemberCenterModal('points_log');
    }

    // 积分兑换（使用新权益系统）
    _renderMemberMall(members) {
        const player = gameState.state.player || {};
        // 确保店主有对应的会员记录
        let myMember = gameState.findMemberByName(player.name);
        if (!myMember && player.name) {
            myMember = gameState.addMember(player.name, 0);
            myMember.points = 500; // 初始赠送500积分用于测试
            myMember.level = 3; // 金卡等级，可以兑换所有权益
        }
        const points = myMember?.points || 0;
        const memberLevel = myMember?.level || player.memberLevel || 1;
        const config = gameState.getBenefitsConfig();
        const myBenefits = gameState.getAvailableBenefits(memberLevel);
        
        // 按类型分类
        const benefitTypes = (typeof BENEFIT_TYPES !== 'undefined') ? BENEFIT_TYPES : {};
        const typeList = Object.values(benefitTypes);
        
        const curCat = this._mallFilter || 'all';
        
        const filteredBenefits = curCat === 'all' 
            ? myBenefits 
            : myBenefits.filter(b => b.type === curCat);

        const items = filteredBenefits.map(b => {
            const remain = Math.max(0, (b.stock || 0) - (b.sold || 0));
            const costOk = points >= b.pointsCost;
            const stockOk = remain > 0;
            const disabled = !costOk || !stockOk || !config.redeemRule.enabled;
            const reason = !config.redeemRule.enabled ? '暂未开放' : (!stockOk ? '已兑完' : (!costOk ? `差${b.pointsCost - points}分` : ''));
            const lvlInfo = (typeof MEMBER_LEVELS !== 'undefined' ? MEMBER_LEVELS : []).find(l => l.level === b.minLevel) || { icon: '👤', name: '新会员' };
            const typeInfo = benefitTypes[b.type] || { name: '权益', color: '#ff6b35' };
            const highlightStyle = costOk && stockOk && config.redeemRule.enabled
                ? `;box-shadow:0 0 0 2px #ff6b35;background:linear-gradient(135deg,#fff8e1,#ffe0b2);`
                : '';
            return `
                <div style="background:#fff;border-radius:10px;padding:10px;${highlightStyle}">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <div style="font-size:28px;width:44px;height:44px;display:flex;align-items:center;justify-content:center;background:${typeInfo.color}22;border-radius:10px;flex-shrink:0;">${b.icon}</div>
                        <div style="flex:1;min-width:0;">
                            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                                <span style="font-weight:700;font-size:13px;">${b.name}</span>
                                <span style="font-size:9px;padding:1px 5px;background:${typeInfo.color}22;color:${typeInfo.color};border-radius:8px;">${typeInfo.name}</span>
                                ${costOk && stockOk && config.redeemRule.enabled ? '<span style="font-size:9px;padding:1px 5px;background:#e8f5e9;color:#2e7d32;border-radius:8px;animation:pulse 1.6s infinite;">✨ 可兑换</span>' : ''}
                            </div>
                            <div style="font-size:10px;color:#999;margin-top:2px;line-height:1.4;">${b.desc||''}</div>
                            <div style="font-size:10px;color:#ff9800;margin-top:2px;">${lvlInfo.icon}${lvlInfo.name}+可兑 · 剩${remain}份 · 有效期${b.validDays||7}天</div>
                        </div>
                        <div style="text-align:right;flex-shrink:0;">
                            <div style="font-weight:800;color:#ff6b35;font-size:14px;">${b.pointsCost}分</div>
                            <button class="btn btn-small"
                                    onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                                    ${disabled?'disabled style="margin-top:4px;opacity:.6;cursor:not-allowed;background:#eee;color:#999;border:none;padding:5px 10px;"':'style="margin-top:4px;background:linear-gradient(135deg,#ff6b35,#ff9800);color:#fff;border:none;font-weight:600;padding:5px 10px;"'}
                                    ${disabled?'':`onclick="event.preventDefault();event.stopPropagation();ui.confirmRedeemBenefit('${b.id}')"`}>
                                ${reason || '立即兑换'}
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // 分类标签
        const allCats = [
            { key: 'all', name: '全部', icon: '🛍️' },
            ...typeList.map(t => ({ key: t.id, name: t.name, icon: t.icon }))
        ];

        return `
            <div style="background:linear-gradient(135deg,#fff3e0,#ffe0b2);border-radius:10px;padding:10px 12px;margin-bottom:10px;">
                <div style="font-size:12px;color:#9c5b00;line-height:1.55;">顾客用自己的积分兑换券或店内商品。请到「顾客会员」点开该顾客再兑换；也可把上架商品加入兑换池。</div>
                <div style="margin-top:8px;display:flex;justify-content:space-between;align-items:center;">
                    <span style="font-size:11px;color:#9c5b00;">消费¥${config.pointsRule.yuanPerPoint||10}=1积分</span>
                    ${config.redeemRule.enabled ? '<span style="font-size:10px;color:#4caf50;font-weight:600;">● 兑换开放中</span>' : '<span style="font-size:10px;color:#f44336;font-weight:600;">● 暂未开放</span>'}
                </div>
                <button class="btn btn-primary btn-small" style="margin-top:8px;"
                        onclick="event.stopPropagation();ui.showAddListingRedeemModal()">＋ 加入店内商品兑换</button>
            </div>
            <div style="background:#f3e5f5;border-radius:10px;padding:10px 12px;margin-bottom:10px;border-left:4px solid #7b1fa2;font-size:11px;color:#4a148c;line-height:1.7;">
                <div style="font-weight:700;margin-bottom:4px;">📘 兑换规则</div>
                ✅ 每人每日限兑${config.redeemRule.dailyRedeemLimit||10}次<br>
                ✅ 兑换后${config.redeemRule.allowCancelMinutes||30}分钟内可取消<br>
                ✅ 虚拟权益（券/红包/信誉）即时到账，实物需等待发货
            </div>
            <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;">
                ${allCats.map(c => `
                    <div class="mall-cat ${curCat===c.key?'on':''}"
                         onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                         onclick="event.preventDefault();event.stopPropagation();ui.setMallFilter('${c.key}')"
                         style="padding:5px 10px;border-radius:14px;font-size:11px;cursor:pointer;user-select:none;flex-shrink:0;
                                ${curCat===c.key?'background:linear-gradient(135deg,#ff9800,#ff6b35);color:#fff;font-weight:700;':'background:#fff;color:#555;'}">
                        ${c.icon} ${c.name}
                    </div>
                `).join('')}
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;">
                ${items || '<div style="text-align:center;padding:30px 0;color:#999;font-size:12px;background:#fff;border-radius:10px;">该分类下暂无可用权益<br><span style="font-size:11px;">升级会员等级或等待补货</span></div>'}
            </div>
        `;
    }

    // 专属活动
    _renderMemberActivities(members) {
        const activities = gameState.getAvailableActivities();
        const allActivities = MEMBER_ACTIVITIES || [];
        const myLevel = members.memberLevel || 1;
        const joined = members.activitiesJoined || [];
        const today = gameState.state.gameTime?.day || 1;
        return `
            <div style="background:linear-gradient(135deg,#f3e5f5,#e1bee7);border-radius:12px;padding:12px;margin-bottom:10px;">
                <div style="font-weight:700;color:#6a1b9a;font-size:13px;">🎉 会员专属活动</div>
                <div style="font-size:11px;color:#8e24aa;margin-top:3px;">今日可用 ${activities.length} 个活动，升级解锁更多特权</div>
            </div>
            <!-- 今日可用活动 -->
            ${activities.length>0?`
            <div style="font-weight:700;font-size:12px;margin-bottom:6px;color:#4caf50;">✅ 今日可参与</div>
            <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">
                ${activities.map(a=>{
                    const key = a.id + '_' + today;
                    const isJoined = joined.includes(key);
                    return `
                    <div style="background:#fff;border-radius:10px;padding:12px;display:flex;align-items:center;gap:10px;">
                        <div style="width:44px;height:44px;border-radius:10px;background:linear-gradient(135deg,#e91e63,#9c27b0);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">${a.icon}</div>
                        <div style="flex:1;">
                            <div style="font-weight:700;font-size:13px;">${a.title}</div>
                            <div style="font-size:10px;color:#999;margin-top:2px;">${a.desc}</div>
                        </div>
                        <button class="btn btn-small" ${isJoined?'disabled':''}
                                style="${isJoined?'background:#e0e0e0;color:#999;':'background:linear-gradient(135deg,#e91e63,#9c27b0);color:#fff;font-weight:600;'}"
                                onclick="event.stopPropagation();ui.doJoinActivity('${a.id}')">
                            ${isJoined?'已参与':'立即参与'}
                        </button>
                    </div>
                    `;
                }).join('')}
            </div>
            `:`
            <div style="background:#fff;border-radius:10px;padding:20px;text-align:center;color:#999;font-size:12px;margin-bottom:12px;">
                😴 今日暂无可用活动<br><span style="font-size:11px;">升级会员等级或等待特定日期解锁</span>
            </div>
            `}
            <!-- 全部活动一览 -->
            <div style="font-weight:700;font-size:12px;margin-bottom:6px;color:#666;">📋 全部活动</div>
            <div style="display:flex;flex-direction:column;gap:6px;">
                ${allActivities.map(a=>{
                    const locked = myLevel < a.level;
                    return `
                    <div style="background:#fff;border-radius:8px;padding:10px;display:flex;align-items:center;gap:8px;opacity:${locked?0.6:1};">
                        <div style="font-size:20px;${locked?'filter:grayscale(1);':''}">${a.icon}</div>
                        <div style="flex:1;">
                            <div style="font-size:12px;font-weight:600;">${a.title} ${locked?`🔒${MEMBER_LEVELS.find(l=>l.level===a.level)?.name||'Lv.'+a.level}解锁`:''}</div>
                            <div style="font-size:10px;color:#999;">${a.desc}</div>
                        </div>
                    </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    doJoinActivity(activityId) {
        const res = gameState.joinActivity(activityId);
        if (res.success) {
            this.showToast('✅ ' + res.message);
            setTimeout(() => this.showMemberCenterModal('activities'), 100);
        } else {
            this.showToast('❌ ' + res.message);
        }
    }

    // 数据统计
    _renderMemberStats(stats, members) {
        const list = members.list || [];
        const benefitStats = gameState.getBenefitsStats();
        const allOrders = gameState.getAllRedeemOrders();
        const pendingOrders = allOrders.filter(o=>o.status==='pending'||o.status==='processing').length;
        const completedOrders = allOrders.filter(o=>o.status==='completed').length;
        const levelData = MEMBER_LEVELS.map(lv=>({
            ...lv,
            count: stats.levelDistribution?.[lv.level] || 0,
            ratio: list.length>0 ? ((stats.levelDistribution?.[lv.level]||0)/list.length*100).toFixed(0) : 0
        }));
        const maxCount = Math.max(...levelData.map(d=>d.count), 1);
        return `
            <!-- 核心数据卡片 -->
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:10px;">
                <div style="background:linear-gradient(135deg,#ff9800,#ff6b35);border-radius:12px;padding:12px;color:#fff;">
                    <div style="font-size:24px;font-weight:900;">${stats.totalMembers}</div>
                    <div style="font-size:11px;opacity:.9;margin-top:2px;">👥 会员总数</div>
                </div>
                <div style="background:linear-gradient(135deg,#4caf50,#2e7d32);border-radius:12px;padding:12px;color:#fff;">
                    <div style="font-size:24px;font-weight:900;">${stats.activeMembers}</div>
                    <div style="font-size:11px;opacity:.9;margin-top:2px;">⚡ 活跃会员(近7天)</div>
                </div>
                <div style="background:linear-gradient(135deg,#2196f3,#1565c0);border-radius:12px;padding:12px;color:#fff;">
                    <div style="font-size:24px;font-weight:900;">${stats.newMembersThisMonth}</div>
                    <div style="font-size:11px;opacity:.9;margin-top:2px;">🆕 本月新增(近30天)</div>
                </div>
                <div style="background:linear-gradient(135deg,#9c27b0,#6a1b9a);border-radius:12px;padding:12px;color:#fff;">
                    <div style="font-size:24px;font-weight:900;">¥${stats.averageSpent}</div>
                    <div style="font-size:11px;opacity:.9;margin-top:2px;">💰 人均消费</div>
                </div>
            </div>
            <!-- 积分统计 -->
            <div style="background:#fff;border-radius:12px;padding:12px;margin-bottom:10px;">
                <div style="font-weight:700;font-size:13px;margin-bottom:10px;">📊 积分数据</div>
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center;">
                    <div><div style="font-size:16px;font-weight:bold;color:#4caf50;">${stats.totalPointsEarned||0}</div><div style="font-size:10px;color:#999;">累计获得</div></div>
                    <div><div style="font-size:16px;font-weight:bold;color:#f44336;">${stats.totalPointsRedeemed||0}</div><div style="font-size:10px;color:#999;">累计消耗</div></div>
                    <div><div style="font-size:16px;font-weight:bold;color:#ff6b35;">${stats.totalPoints}</div><div style="font-size:10px;color:#999;">当前可用</div></div>
                </div>
            </div>
            <!-- 权益兑换统计 -->
            <div style="background:#fff;border-radius:12px;padding:12px;margin-bottom:10px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                    <div style="font-weight:700;font-size:13px;">🎁 权益兑换统计</div>
                    <span style="font-size:10px;color:#ff6b35;cursor:pointer;" onclick="event.stopPropagation();ui.showMemberCenterModal('benefits')">管理权益 ›</span>
                </div>
                <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;text-align:center;">
                    <div style="padding:8px;background:#fff3e0;border-radius:8px;">
                        <div style="font-size:18px;font-weight:bold;color:#ff6b35;">${benefitStats.totalRedeemCount||0}</div>
                        <div style="font-size:10px;color:#999;">累计兑换次数</div>
                    </div>
                    <div style="padding:8px;background:#e8f5e9;border-radius:8px;">
                        <div style="font-size:18px;font-weight:bold;color:#4caf50;">${benefitStats.totalRedeemMembers||0}</div>
                        <div style="font-size:10px;color:#999;">参与兑换人数</div>
                    </div>
                    <div style="padding:8px;background:#fce4ec;border-radius:8px;">
                        <div style="font-size:18px;font-weight:bold;color:#e91e63;">${benefitStats.totalPointsRedeemed||0}</div>
                        <div style="font-size:10px;color:#999;">兑换消耗积分</div>
                    </div>
                    <div style="padding:8px;background:#e3f2fd;border-radius:8px;">
                        <div style="font-size:18px;font-weight:bold;color:#2196f3;">¥${benefitStats.totalRedeemValue||0}</div>
                        <div style="font-size:10px;color:#999;">发放价值(元)</div>
                    </div>
                </div>
                ${pendingOrders>0?`
                <div style="margin-top:8px;padding:8px;background:#fff3e0;border-radius:8px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;"
                     onclick="event.stopPropagation();ui.showMemberCenterModal('redeem_log')">
                    <span style="font-size:11px;color:#e65100;">⏳ 有 ${pendingOrders} 个兑换待处理</span>
                    <span style="font-size:11px;color:#ff6b35;font-weight:600;">去处理 ›</span>
                </div>
                `:''}
            </div>
            <!-- 等级分布 -->
            <div style="background:#fff;border-radius:12px;padding:12px;margin-bottom:10px;">
                <div style="font-weight:700;font-size:13px;margin-bottom:10px;">🎖️ 会员等级分布</div>
                <div style="display:flex;flex-direction:column;gap:8px;">
                    ${levelData.map(d=>`
                        <div>
                            <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;">
                                <span>${d.icon} ${d.name}</span>
                                <span style="font-weight:600;">${d.count}人 (${d.ratio}%)</span>
                            </div>
                            <div style="background:#f5f5f5;border-radius:4px;height:8px;overflow:hidden;">
                                <div style="height:100%;width:${d.count/maxCount*100}%;border-radius:4px;background:${d.bgColor?.includes('gradient')?'linear-gradient(135deg,#e91e63,#9c27b0)':d.bgColor};transition:width 0.3s;"></div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
            <!-- 店铺会员等级 -->
            <div style="background:#fff;border-radius:12px;padding:12px;">
                <div style="font-weight:700;font-size:13px;margin-bottom:8px;">🏪 店铺会员等级</div>
                <div style="display:flex;align-items:center;gap:10px;padding:10px;background:linear-gradient(135deg,#fff3e0,#ffe0b2);border-radius:8px;">
                    <div style="font-size:36px;">${MEMBER_LEVELS.find(l=>l.level===stats.shopMemberLevel)?.icon||'🌱'}</div>
                    <div style="flex:1;">
                        <div style="font-weight:700;font-size:14px;color:#e65100;">${MEMBER_LEVELS.find(l=>l.level===stats.shopMemberLevel)?.name||'普通会员'}</div>
                        <div style="font-size:11px;color:#bf360c;">成长值 ${stats.totalGrowth} · 总销量 ¥${gameState.state.shop?.totalSales||0}</div>
                    </div>
                </div>
                <div style="margin-top:8px;font-size:11px;color:#666;line-height:1.6;">
                    💡 店铺会员等级由<b>成长值</b>和<b>累计销售额</b>共同决定，等级越高解锁更多会员权益和活动
                </div>
            </div>
        `;
    }

    setMallFilter(key) {
        this._mallFilter = key;
        this.showMemberCenterModal('mall');
    }

    setRedeemLogFilter(key) {
        this._redeemLogFilter = key;
        this.showMemberCenterModal('redeem_log');
    }

    showAddListingRedeemModal() {
        const listings = (gameState.state.listings || []).filter(l => l && l.status === 'active');
        if (!listings.length) {
            this.showToast('请先上架商品，再加入积分兑换');
            return;
        }
        const content = listings.slice(0, 30).map(l => {
            const stock = (typeof gameState.getSellableQuantity === 'function')
                ? gameState.getSellableQuantity(l.productId, l.qualityGrade || 'B') : (l.stock || 0);
            const suggest = Math.max(50, Math.round((l.price || 10) * 8));
            return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #f5f5f5;">
                <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;font-weight:700;">${escapeHtml(l.title || l.productName || '')}</div>
                    <div style="font-size:10px;color:#999;">售价¥${(l.price||0).toFixed(0)} · 库存${stock}</div>
                </div>
                <input id="rdm_pts_${l.id}" type="number" value="${suggest}" style="width:72px;padding:6px;border:1px solid #eee;border-radius:8px;font-size:12px;">
                <button class="btn btn-primary btn-small" onclick="ui.confirmAddListingRedeem('${l.id}')">加入</button>
            </div>`;
        }).join('');
        this.showModal('店内商品加入兑换', content, '<button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>');
    }

    confirmAddListingRedeem(listingId) {
        const el = document.getElementById('rdm_pts_' + listingId);
        const pts = el ? Number(el.value) : 0;
        const res = gameState.addListingAsRedeemBenefit(listingId, pts);
        this.showToast((res && res.message) || (res && res.success ? '已加入兑换池' : '加入失败'));
        if (res && res.success) {
            this.closeModal();
            this.showMemberCenterModal('mall');
        }
    }

    showPickMemberForRedeem(benefitId) {
        const list = ((gameState.state.members && gameState.state.members.list) || []).slice()
            .sort((a, b) => (b.points || 0) - (a.points || 0)).slice(0, 40);
        if (!list.length) {
            this.showToast('还没有顾客会员，等有人下单后再兑换');
            return;
        }
        const content = `<div style="font-size:12px;color:#666;margin-bottom:8px;">选择用谁的积分兑换</div>` + list.map(m => `
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f5f5f5;cursor:pointer;"
                 onclick="ui.closeModal();ui.showMemberRedeemModal('${m.id}')">
                <span style="font-weight:700;">${escapeHtml(m.name)}</span>
                <span style="color:#ff6b35;">${m.points||0}分 · 储值¥${(m.wallet||0).toFixed(0)}</span>
            </div>
        `).join('');
        this.showModal('选择顾客兑换', content, '<button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>');
    }

    // 权益兑换确认（新权益系统）
    confirmRedeemBenefit(benefitId) {
        this.showPickMemberForRedeem(benefitId);
        return;
        const player = gameState.state.player || {};
        const member = gameState.findMemberByName(player.name);
        if (!member) {
            this.showToast('❌ 请到顾客会员中为指定顾客兑换');
            return;
        }
        const config = gameState.getBenefitsConfig();
        const benefit = config.benefits.find(b => b.id === benefitId);
        if (!benefit) {
            this.showToast('❌ 权益不存在');
            return;
        }
        const curPoints = member.points || 0;
        if (curPoints < benefit.pointsCost) {
            this.showToast('❌ 积分不足，还差 ' + (benefit.pointsCost - curPoints) + ' 分');
            return;
        }
        const typeInfo = (typeof BENEFIT_TYPES !== 'undefined' && BENEFIT_TYPES[benefit.type]) || { name: '权益' };
        
        const confirmContent = `
            <div style="overflow-x:hidden;touch-action:pan-y;">
                <div style="text-align:center;padding:6px 0 14px;">
                    <div style="font-size:48px;margin-bottom:4px;">${benefit.icon}</div>
                    <div style="font-size:15px;font-weight:900;">确认兑换「${benefit.name}」？</div>
                    <div style="font-size:11px;color:#999;margin-top:4px;">${typeInfo.name} · ${benefit.desc||''}</div>
                </div>
                <div style="background:#fff8e1;border-radius:10px;padding:10px 12px;margin-bottom:10px;">
                    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px;">
                        <span style="color:#9c5b00;">当前积分</span>
                        <b style="color:#d84315;">${curPoints}</b>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px;">
                        <span style="color:#c62828;">扣减积分</span>
                        <b style="color:#c62828;">-${benefit.pointsCost}</b>
                    </div>
                    <div style="height:1px;background:#ffe0b2;margin:6px 0;"></div>
                    <div style="display:flex;justify-content:space-between;font-size:12px;">
                        <span style="color:#2e7d32;">兑换后剩余</span>
                        <b style="color:#2e7d32;font-size:14px;">${curPoints - benefit.pointsCost}</b>
                    </div>
                </div>
                <div style="font-size:11px;color:#666;line-height:1.6;background:#f5f5f5;border-radius:8px;padding:8px 10px;">
                    <div>📌 确认后将立即扣减积分</div>
                    <div>📌 虚拟权益即时到账，实物商品请等待发货</div>
                    <div>📌 兑换后${config.redeemRule.allowCancelMinutes||30}分钟内可取消</div>
                </div>
            </div>
        `;
        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal();ui.showMemberCenterModal('mall');">取消</button>
            <button class="btn btn-primary" onclick="ui.closeModal();ui.executeRedeemBenefit('${benefitId}');">✅ 确认兑换</button>
        `;
        this.showModal('积分兑换确认', confirmContent, footer);
    }

    executeRedeemBenefit(benefitId) {
        // 使用店主自己的会员身份兑换
        const player = gameState.state.player || {};
        const member = gameState.findMemberByName(player.name);
        
        if (!member) {
            this.showToast('❌ 会员数据异常，请重新打开积分兑换页面');
            setTimeout(() => this.showMemberCenterModal('mall'), 200);
            return;
        }
        
        const res = gameState.redeemBenefit({
            benefitId,
            memberId: member.id,
            memberName: member.name
        });
        
        if (res && res.success) {
            this.showToast('✅ ' + (res.message || '兑换成功'));
            setTimeout(() => this.showMemberCenterModal('redeem_log'), 100);
        } else {
            this.showToast('❌ ' + ((res && res.message) || '兑换失败'));
            setTimeout(() => this.showMemberCenterModal('mall'), 200);
        }
    }

    // 权益管理页面（卖家视角）
    _renderBenefitsManage(members) {
        const config = gameState.getBenefitsConfig();
        const stats = gameState.getBenefitsStats();
        const allBenefits = gameState.getAllBenefits();
        const benefitTypes = (typeof BENEFIT_TYPES !== 'undefined') ? BENEFIT_TYPES : {};
        const pendingCount = gameState.getPendingRedeemCount();
        
        return `
            <!-- 核心统计卡片 -->
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:10px;">
                <div style="background:linear-gradient(135deg,#ff9800,#ff6b35);border-radius:12px;padding:12px;color:#fff;">
                    <div style="font-size:22px;font-weight:900;">${stats.totalRedeemCount||0}</div>
                    <div style="font-size:11px;opacity:.9;margin-top:2px;">🎁 累计兑换</div>
                </div>
                <div style="background:linear-gradient(135deg,#4caf50,#2e7d32);border-radius:12px;padding:12px;color:#fff;">
                    <div style="font-size:22px;font-weight:900;">${stats.totalPointsRedeemed||0}</div>
                    <div style="font-size:11px;opacity:.9;margin-top:2px;">💎 积分消耗</div>
                </div>
                <div style="background:linear-gradient(135deg,#2196f3,#1565c0);border-radius:12px;padding:12px;color:#fff;">
                    <div style="font-size:22px;font-weight:900;">${allBenefits.filter(b=>b.enabled).length}/${allBenefits.length}</div>
                    <div style="font-size:11px;opacity:.9;margin-top:2px;">⚙️ 上架权益</div>
                </div>
                <div style="background:linear-gradient(135deg,${pendingCount>0?'#f44336':'#9e9e9e'},${pendingCount>0?'#c62828':'#757575'});border-radius:12px;padding:12px;color:#fff;cursor:pointer;"
                     onclick="event.stopPropagation();ui.showMemberCenterModal('redeem_log')">
                    <div style="font-size:22px;font-weight:900;">${pendingCount}</div>
                    <div style="font-size:11px;opacity:.9;margin-top:2px;">📋 待处理</div>
                </div>
            </div>

            <!-- 快速操作栏 -->
            <div style="display:flex;gap:8px;margin-bottom:10px;">
                <button class="btn btn-small" style="flex:1;background:linear-gradient(135deg,#607d8b,#455a64);color:#fff;font-weight:600;"
                        onclick="event.stopPropagation();ui.showBenefitsConfigModal()">
                    ⚙️ 规则配置
                </button>
                <button class="btn btn-small" style="flex:1;background:linear-gradient(135deg,#ff6b35,#ff9800);color:#fff;font-weight:600;"
                        onclick="event.stopPropagation();ui.showEditBenefitModal()">
                    ➕ 添加权益
                </button>
            </div>

            <!-- 兑换开关 -->
            <div style="background:#fff;border-radius:12px;padding:12px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;">
                <div>
                    <div style="font-weight:700;font-size:13px;">积分兑换开关</div>
                    <div style="font-size:11px;color:#999;margin-top:2px;">${config.redeemRule.enabled?'开放中，买家可正常兑换':'已关闭，买家无法兑换'}</div>
                </div>
                <label style="position:relative;display:inline-block;width:48px;height:26px;cursor:pointer;">
                    <input type="checkbox" ${config.redeemRule.enabled?'checked':''} 
                           onchange="event.stopPropagation();ui.toggleRedeemEnabled()"
                           style="opacity:0;width:0;height:0;">
                    <span style="position:absolute;inset:0;background:${config.redeemRule.enabled?'#4caf50':'#ccc'};border-radius:13px;transition:.3s;"></span>
                    <span style="position:absolute;top:3px;${config.redeemRule.enabled?'left:25px':'left:3px'};width:20px;height:20px;background:#fff;border-radius:50%;transition:.3s;box-shadow:0 2px 4px rgba(0,0,0,0.2);"></span>
                </label>
            </div>

            <!-- 权益列表 -->
            <div style="font-weight:700;font-size:12px;margin-bottom:6px;color:#333;">🎁 权益商品列表</div>
            <div style="display:flex;flex-direction:column;gap:8px;">
                ${allBenefits.map(b => {
                    const typeInfo = benefitTypes[b.type] || { name: '权益', color: '#ff6b35' };
                    const remain = b.stock - b.sold;
                    return `
                    <div style="background:#fff;border-radius:10px;padding:10px;opacity:${b.enabled?1:0.6};">
                        <div style="display:flex;align-items:flex-start;gap:8px;">
                            <div style="font-size:28px;width:40px;height:40px;display:flex;align-items:center;justify-content:center;background:${typeInfo.color}22;border-radius:10px;flex-shrink:0;">${b.icon}</div>
                            <div style="flex:1;min-width:0;">
                                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                                    <span style="font-weight:700;font-size:13px;">${b.name}</span>
                                    <span style="font-size:9px;padding:1px 5px;background:${typeInfo.color}22;color:${typeInfo.color};border-radius:8px;">${typeInfo.name}</span>
                                    ${b.enabled?'':'<span style="font-size:9px;padding:1px 5px;background:#eee;color:#999;border-radius:8px;">已下架</span>'}
                                </div>
                                <div style="font-size:10px;color:#999;margin-top:2px;line-height:1.4;">${b.desc||'暂无描述'}</div>
                                <div style="display:flex;gap:10px;font-size:10px;color:#666;margin-top:4px;">
                                    <span>💰 ${b.pointsCost}积分</span>
                                    <span>📦 库存${remain}/${b.stock}</span>
                                    <span>📊 已兑${b.sold}</span>
                                    <span>🎖️ Lv.${b.minLevel}+</span>
                                </div>
                            </div>
                        </div>
                        <div style="display:flex;gap:6px;margin-top:8px;padding-top:8px;border-top:1px solid #f0f0f0;">
                            <button class="btn btn-small" style="flex:1;font-size:10px;padding:4px 8px;"
                                    onclick="event.stopPropagation();ui.toggleBenefitEnabled('${b.id}')">
                                ${b.enabled?'下架':'上架'}
                            </button>
                            <button class="btn btn-small" style="flex:1;font-size:10px;padding:4px 8px;background:#2196f3;color:#fff;"
                                    onclick="event.stopPropagation();ui.showEditBenefitModal('${b.id}')">
                                编辑
                            </button>
                            <button class="btn btn-small" style="flex:1;font-size:10px;padding:4px 8px;background:#f44336;color:#fff;"
                                    onclick="event.stopPropagation();ui.deleteBenefitConfirm('${b.id}')">
                                删除
                            </button>
                        </div>
                    </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    // 兑换记录页面
    _renderRedeemLog(members) {
        const curFilter = this._redeemLogFilter || 'all';
        const allOrders = gameState.getAllRedeemOrders();
        
        const filters = [
            { key: 'all', name: '全部', count: allOrders.length },
            { key: 'pending', name: '待处理', count: allOrders.filter(o=>o.status==='pending').length },
            { key: 'processing', name: '处理中', count: allOrders.filter(o=>o.status==='processing').length },
            { key: 'shipped', name: '已发货', count: allOrders.filter(o=>o.status==='shipped').length },
            { key: 'completed', name: '已完成', count: allOrders.filter(o=>o.status==='completed').length },
            { key: 'cancelled', name: '已取消', count: allOrders.filter(o=>o.status==='cancelled').length }
        ];
        
        const filteredOrders = curFilter === 'all' 
            ? allOrders 
            : allOrders.filter(o => o.status === curFilter);

        const statusMap = {
            pending: { text: '待处理', color: '#ff9800', bg: '#fff3e0' },
            processing: { text: '处理中', color: '#2196f3', bg: '#e3f2fd' },
            shipped: { text: '已发货', color: '#9c27b0', bg: '#f3e5f5' },
            completed: { text: '已完成', color: '#4caf50', bg: '#e8f5e9' },
            cancelled: { text: '已取消', color: '#9e9e9e', bg: '#f5f5f5' }
        };

        const ordersHtml = filteredOrders.length === 0 
            ? '<div style="text-align:center;padding:30px 0;color:#999;font-size:12px;background:#fff;border-radius:10px;">暂无兑换记录</div>'
            : filteredOrders.map(o => {
                const status = statusMap[o.status] || statusMap.pending;
                const canCancel = o.status !== 'completed' && o.status !== 'cancelled' && Date.now() < o.cancelDeadline;
                const canProcess = o.status === 'pending';
                const canShip = o.status === 'processing';
                const canComplete = o.status === 'shipped' || o.status === 'processing';
                return `
                <div style="background:#fff;border-radius:10px;padding:10px;margin-bottom:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <div style="display:flex;align-items:center;gap:6px;">
                            <span style="font-size:20px;">${o.benefitIcon||'🎁'}</span>
                            <span style="font-weight:600;font-size:12px;">${o.benefitName}</span>
                        </div>
                        <span style="font-size:10px;padding:2px 8px;background:${status.bg};color:${status.color};border-radius:10px;font-weight:600;">${status.text}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:11px;color:#666;margin-bottom:6px;">
                        <span>👤 ${o.memberName} (Lv.${o.memberLevel})</span>
                        <span>💎 ${o.totalPoints}积分 · x${o.quantity}</span>
                    </div>
                    <div style="font-size:10px;color:#999;margin-bottom:6px;">
                        📅 第${o.createDay}天 ${o.createHour}:00 · ${o.rewardText||''}
                    </div>
                    ${o.trackingNo?`<div style="font-size:10px;color:#2196f3;margin-bottom:6px;">📦 物流单号：${o.trackingNo}</div>`:''}
                    ${o.remark?`<div style="font-size:10px;color:#666;margin-bottom:6px;background:#f5f5f5;padding:4px 6px;border-radius:4px;">📝 ${o.remark}</div>`:''}
                    <div style="display:flex;gap:6px;padding-top:6px;border-top:1px solid #f0f0f0;">
                        ${canProcess?`<button class="btn btn-small" style="flex:1;font-size:10px;padding:4px 8px;background:#2196f3;color:#fff;" onclick="event.stopPropagation();ui.processRedeemOrder('${o.id}','process')">开始处理</button>`:''}
                        ${canShip?`<button class="btn btn-small" style="flex:1;font-size:10px;padding:4px 8px;background:#9c27b0;color:#fff;" onclick="event.stopPropagation();ui.showShipRedeemModal('${o.id}')">发货</button>`:''}
                        ${canComplete?`<button class="btn btn-small" style="flex:1;font-size:10px;padding:4px 8px;background:#4caf50;color:#fff;" onclick="event.stopPropagation();ui.processRedeemOrder('${o.id}','complete')">完成</button>`:''}
                        ${canCancel?`<button class="btn btn-small" style="flex:1;font-size:10px;padding:4px 8px;background:#f44336;color:#fff;" onclick="event.stopPropagation();ui.cancelRedeemOrder('${o.id}')">取消</button>`:''}
                    </div>
                </div>
                `;
            }).join('');

        return `
            <!-- 筛选标签 -->
            <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px;">
                ${filters.map(f => `
                    <div style="padding:5px 10px;border-radius:14px;font-size:11px;cursor:pointer;user-select:none;flex-shrink:0;
                                ${curFilter===f.key?'background:linear-gradient(135deg,#ff9800,#ff6b35);color:#fff;font-weight:700;':'background:#fff;color:#555;'}"
                         onclick="event.stopPropagation();ui.setRedeemLogFilter('${f.key}')">
                        ${f.name}${f.count>0?` (${f.count})`:''}
                    </div>
                `).join('')}
            </div>
            <!-- 订单列表 -->
            <div style="display:flex;flex-direction:column;">
                ${ordersHtml}
            </div>
        `;
    }

    // 切换兑换开关
    toggleRedeemEnabled() {
        const config = gameState.getBenefitsConfig();
        gameState.updateRedeemRule({ enabled: !config.redeemRule.enabled });
        this.showToast(config.redeemRule.enabled ? '✅ 已开启兑换' : '⏸️ 已关闭兑换');
        this.showMemberCenterModal('benefits');
    }

    // 切换权益上架/下架
    toggleBenefitEnabled(benefitId) {
        const res = gameState.toggleBenefit(benefitId);
        if (res.success) {
            this.showToast(res.enabled ? '✅ 已上架' : '⏸️ 已下架');
            this.showMemberCenterModal('benefits');
        }
    }

    // 删除权益确认
    deleteBenefitConfirm(benefitId) {
        const config = gameState.getBenefitsConfig();
        const benefit = config.benefits.find(b => b.id === benefitId);
        if (!benefit) return;
        
        const confirmContent = `
            <div style="text-align:center;padding:10px;">
                <div style="font-size:48px;margin-bottom:10px;">⚠️</div>
                <div style="font-size:14px;font-weight:700;margin-bottom:8px;">确认删除「${benefit.name}」？</div>
                <div style="font-size:11px;color:#999;">删除后无法恢复，已兑换的订单不受影响</div>
            </div>
        `;
        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal();">取消</button>
            <button class="btn btn-primary" style="background:#f44336;" onclick="ui.closeModal();ui.doDeleteBenefit('${benefitId}')">确认删除</button>
        `;
        this.showModal('删除确认', confirmContent, footer);
    }

    doDeleteBenefit(benefitId) {
        const res = gameState.deleteBenefit(benefitId);
        if (res.success) {
            this.showToast('✅ 已删除');
            this.showMemberCenterModal('benefits');
        } else {
            this.showToast('❌ ' + (res.message || '删除失败'));
        }
    }

    // 处理兑换订单
    processRedeemOrder(orderId, action) {
        const res = gameState.processRedeemOrder(orderId, action);
        if (res.success) {
            const msg = { process: '已开始处理', ship: '已发货', complete: '已完成' }[action] || '操作成功';
            this.showToast('✅ ' + msg);
            this.showMemberCenterModal('redeem_log');
        } else {
            this.showToast('❌ ' + (res.message || '操作失败'));
        }
    }

    // 取消兑换订单
    cancelRedeemOrder(orderId) {
        const confirmContent = `
            <div style="text-align:center;padding:10px;">
                <div style="font-size:48px;margin-bottom:10px;">⚠️</div>
                <div style="font-size:14px;font-weight:700;margin-bottom:8px;">确认取消该兑换？</div>
                <div style="font-size:11px;color:#999;">积分将退还给会员，库存恢复</div>
            </div>
        `;
        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal();">取消</button>
            <button class="btn btn-primary" style="background:#f44336;" onclick="ui.closeModal();ui.doCancelRedeem('${orderId}')">确认取消</button>
        `;
        this.showModal('取消兑换', confirmContent, footer);
    }

    doCancelRedeem(orderId) {
        const res = gameState.processRedeemOrder(orderId, 'cancel', { reason: '卖家取消' });
        if (res.success) {
            this.showToast('✅ 已取消，积分已退还');
            this.showMemberCenterModal('redeem_log');
        } else {
            this.showToast('❌ ' + (res.message || '取消失败'));
        }
    }

    // 实物发货弹窗
    showShipRedeemModal(orderId) {
        const orders = gameState.state.members.redeemOrders;
        const order = orders.find(o => o.id === orderId);
        if (!order) return;
        
        const content = `
            <div style="padding:10px;">
                <div style="margin-bottom:12px;">
                    <div style="font-size:12px;font-weight:600;margin-bottom:4px;">订单信息</div>
                    <div style="font-size:11px;color:#666;background:#f5f5f5;padding:8px;border-radius:8px;">
                        ${order.benefitIcon} ${order.benefitName} x${order.quantity}<br>
                        会员：${order.memberName}<br>
                        消耗积分：${order.totalPoints}
                    </div>
                </div>
                <div>
                    <div style="font-size:12px;font-weight:600;margin-bottom:6px;">物流单号（选填）</div>
                    <input type="text" id="redeemTrackingNo" placeholder="请输入快递单号" 
                           style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:8px;font-size:12px;box-sizing:border-box;">
                </div>
            </div>
        `;
        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal();">取消</button>
            <button class="btn btn-primary" style="background:#9c27b0;" onclick="ui.closeModal();ui.doShipRedeem('${orderId}')">确认发货</button>
        `;
        this.showModal('实物发货', content, footer);
    }

    doShipRedeem(orderId) {
        const trackingNo = document.getElementById('redeemTrackingNo')?.value || '';
        const res = gameState.processRedeemOrder(orderId, 'ship', { trackingNo });
        if (res.success) {
            this.showToast('✅ 发货成功');
            this.showMemberCenterModal('redeem_log');
        } else {
            this.showToast('❌ ' + (res.message || '发货失败'));
        }
    }

    // 规则配置弹窗
    showBenefitsConfigModal() {
        const config = gameState.getBenefitsConfig();
        const pr = config.pointsRule;
        const rr = config.redeemRule;
        
        const content = `
            <div style="padding:8px;max-height:60vh;overflow-y:auto;">
                <div style="font-size:12px;font-weight:700;color:#ff6b35;margin-bottom:8px;">💎 积分获取规则</div>
                <div style="background:#f9f9f9;border-radius:8px;padding:10px;margin-bottom:12px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                        <span style="font-size:11px;">每消费N元=1积分</span>
                        <input type="number" id="cfg_yuanPerPoint" value="${pr.yuanPerPoint}" min="1" max="100"
                               style="width:60px;padding:4px 6px;border:1px solid #ddd;border-radius:4px;font-size:11px;text-align:center;">
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                        <span style="font-size:11px;">每日签到积分</span>
                        <input type="number" id="cfg_signInDaily" value="${pr.signInDaily}" min="0" max="100"
                               style="width:60px;padding:4px 6px;border:1px solid #ddd;border-radius:4px;font-size:11px;text-align:center;">
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                        <span style="font-size:11px;">文字评价积分</span>
                        <input type="number" id="cfg_reviewText" value="${pr.reviewText}" min="0" max="50"
                               style="width:60px;padding:4px 6px;border:1px solid #ddd;border-radius:4px;font-size:11px;text-align:center;">
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                        <span style="font-size:11px;">带图评价积分</span>
                        <input type="number" id="cfg_reviewImage" value="${pr.reviewImage}" min="0" max="100"
                               style="width:60px;padding:4px 6px;border:1px solid #ddd;border-radius:4px;font-size:11px;text-align:center;">
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span style="font-size:11px;">积分有效期(天，0=永久)</span>
                        <input type="number" id="cfg_pointsExpireDays" value="${pr.pointsExpireDays}" min="0" max="3650"
                               style="width:60px;padding:4px 6px;border:1px solid #ddd;border-radius:4px;font-size:11px;text-align:center;">
                    </div>
                </div>
                
                <div style="font-size:12px;font-weight:700;color:#4caf50;margin-bottom:8px;">🎁 兑换规则</div>
                <div style="background:#f9f9f9;border-radius:8px;padding:10px;margin-bottom:12px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                        <span style="font-size:11px;">最低兑换等级</span>
                        <select id="cfg_minLevel" style="width:80px;padding:4px;border:1px solid #ddd;border-radius:4px;font-size:11px;">
                            ${[1,2,3,4,5].map(lv=>`<option value="${lv}" ${rr.minLevelForRedeem===lv?'selected':''}>Lv.${lv} ${MEMBER_LEVELS.find(l=>l.level===lv)?.name||''}</option>`).join('')}
                        </select>
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                        <span style="font-size:11px;">每人每日兑换上限</span>
                        <input type="number" id="cfg_dailyLimit" value="${rr.dailyRedeemLimit}" min="1" max="100"
                               style="width:60px;padding:4px 6px;border:1px solid #ddd;border-radius:4px;font-size:11px;text-align:center;">
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                        <span style="font-size:11px;">库存预留时间(小时)</span>
                        <input type="number" id="cfg_stockHours" value="${rr.stockReserveHours}" min="1" max="168"
                               style="width:60px;padding:4px 6px;border:1px solid #ddd;border-radius:4px;font-size:11px;text-align:center;">
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                        <span style="font-size:11px;">自动确认收货(天)</span>
                        <input type="number" id="cfg_autoConfirm" value="${rr.autoConfirmDays}" min="1" max="30"
                               style="width:60px;padding:4px 6px;border:1px solid #ddd;border-radius:4px;font-size:11px;text-align:center;">
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span style="font-size:11px;">允许取消时间(分钟)</span>
                        <input type="number" id="cfg_cancelMin" value="${rr.allowCancelMinutes}" min="0" max="1440"
                               style="width:60px;padding:4px 6px;border:1px solid #ddd;border-radius:4px;font-size:11px;text-align:center;">
                    </div>
                </div>
                
                <div style="font-size:10px;color:#999;line-height:1.5;background:#fff8e1;padding:8px;border-radius:6px;">
                    ⚠️ 参数调整将即时生效，请谨慎操作。建议根据店铺运营情况逐步调整。
                </div>
            </div>
        `;
        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal();">取消</button>
            <button class="btn btn-primary" onclick="ui.closeModal();ui.saveBenefitsConfig()">保存配置</button>
        `;
        this.showModal('权益规则配置', content, footer, { width: '360px' });
    }

    saveBenefitsConfig() {
        const getVal = (id, def=0) => Number(document.getElementById(id)?.value) || def;
        gameState.updatePointsRule({
            yuanPerPoint: getVal('cfg_yuanPerPoint', 10),
            signInDaily: getVal('cfg_signInDaily', 2),
            reviewText: getVal('cfg_reviewText', 5),
            reviewImage: getVal('cfg_reviewImage', 15),
            pointsExpireDays: getVal('cfg_pointsExpireDays', 365)
        });
        gameState.updateRedeemRule({
            minLevelForRedeem: getVal('cfg_minLevel', 1),
            dailyRedeemLimit: getVal('cfg_dailyLimit', 10),
            stockReserveHours: getVal('cfg_stockHours', 24),
            autoConfirmDays: getVal('cfg_autoConfirm', 7),
            allowCancelMinutes: getVal('cfg_cancelMin', 30)
        });
        this.showToast('✅ 配置已保存');
        this.showMemberCenterModal('benefits');
    }

    // 添加/编辑权益弹窗
    showEditBenefitModal(benefitId = null) {
        const config = gameState.getBenefitsConfig();
        const benefit = benefitId ? config.benefits.find(b => b.id === benefitId) : null;
        const isEdit = !!benefit;
        const b = benefit || {
            name: '', icon: '🎁', type: 'coupon', pointsCost: 100, minLevel: 1,
            stock: 999, validDays: 7, desc: '', couponValue: 5, minOrderAmount: 30, amount: 1
        };
        const benefitTypes = (typeof BENEFIT_TYPES !== 'undefined') ? BENEFIT_TYPES : {};
        
        const content = `
            <div style="padding:8px;max-height:60vh;overflow-y:auto;">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
                    <div>
                        <div style="font-size:11px;margin-bottom:4px;">权益名称</div>
                        <input type="text" id="eb_name" value="${b.name}" placeholder="如：5元优惠券"
                               style="width:100%;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;box-sizing:border-box;">
                    </div>
                    <div>
                        <div style="font-size:11px;margin-bottom:4px;">图标(emoji)</div>
                        <input type="text" id="eb_icon" value="${b.icon}" placeholder="🎁"
                               style="width:100%;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;box-sizing:border-box;text-align:center;">
                    </div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
                    <div>
                        <div style="font-size:11px;margin-bottom:4px;">权益类型</div>
                        <select id="eb_type" style="width:100%;padding:6px;border:1px solid #ddd;border-radius:6px;font-size:12px;" onchange="ui.onBenefitTypeChange()">
                            ${Object.values(benefitTypes).map(t=>`<option value="${t.id}" ${b.type===t.id?'selected':''}>${t.icon} ${t.name}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <div style="font-size:11px;margin-bottom:4px;">所需积分</div>
                        <input type="number" id="eb_points" value="${b.pointsCost}" min="1"
                               style="width:100%;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;box-sizing:border-box;">
                    </div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px;">
                    <div>
                        <div style="font-size:11px;margin-bottom:4px;">最低等级</div>
                        <select id="eb_minLevel" style="width:100%;padding:6px;border:1px solid #ddd;border-radius:6px;font-size:12px;">
                            ${[1,2,3,4,5].map(lv=>`<option value="${lv}" ${b.minLevel===lv?'selected':''}>Lv.${lv}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <div style="font-size:11px;margin-bottom:4px;">库存数量</div>
                        <input type="number" id="eb_stock" value="${b.stock}" min="0"
                               style="width:100%;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;box-sizing:border-box;">
                    </div>
                    <div>
                        <div style="font-size:11px;margin-bottom:4px;">有效期(天)</div>
                        <input type="number" id="eb_validDays" value="${b.validDays}" min="1" max="365"
                               style="width:100%;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;box-sizing:border-box;">
                    </div>
                </div>
                
                <!-- 类型特定参数 -->
                <div id="eb_typeParams" style="background:#f9f9f9;border-radius:8px;padding:10px;margin-bottom:10px;">
                    <div style="font-size:11px;font-weight:600;margin-bottom:8px;color:#666;">⚙️ 类型参数</div>
                    <div id="eb_couponParams" style="display:${b.type==='coupon'?'block':'none'};">
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                            <div>
                                <div style="font-size:11px;margin-bottom:4px;">优惠券面额(元)</div>
                                <input type="number" id="eb_couponValue" value="${b.couponValue||5}" min="1"
                                       style="width:100%;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;box-sizing:border-box;">
                            </div>
                            <div>
                                <div style="font-size:11px;margin-bottom:4px;">最低消费(元)</div>
                                <input type="number" id="eb_minOrderAmount" value="${b.minOrderAmount||0}" min="0"
                                       style="width:100%;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;box-sizing:border-box;">
                            </div>
                        </div>
                    </div>
                    <div id="eb_amountParams" style="display:${['cash','freeship','reputation'].includes(b.type)?'block':'none'};">
                        <div style="font-size:11px;margin-bottom:4px;">数量/金额</div>
                        <input type="number" id="eb_amount" value="${b.amount||1}" min="1"
                               style="width:100%;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;box-sizing:border-box;">
                    </div>
                    <div id="eb_defaultParams" style="display:${['coupon','cash','freeship','reputation'].includes(b.type)?'none':'block'};">
                        <div style="font-size:11px;color:#999;">该类型无需额外参数，兑换后由店主手动处理</div>
                    </div>
                </div>
                
                <div style="margin-bottom:10px;">
                    <div style="font-size:11px;margin-bottom:4px;">权益描述</div>
                    <textarea id="eb_desc" rows="2" placeholder="请输入权益描述..."
                              style="width:100%;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;box-sizing:border-box;resize:none;">${b.desc||''}</textarea>
                </div>
                
                ${isEdit?`
                <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:#666;">
                    <input type="checkbox" id="eb_enabled" ${b.enabled!==false?'checked':''}>
                    <label for="eb_enabled">立即上架</label>
                    <span style="margin-left:auto;color:#999;">已兑换：${b.sold||0}</span>
                </div>
                `:''}
            </div>
        `;
        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal();">取消</button>
            <button class="btn btn-primary" onclick="ui.closeModal();ui.saveBenefit('${benefitId||''}')">${isEdit?'保存修改':'添加权益'}</button>
        `;
        this.showModal(isEdit?'编辑权益':'添加新权益', content, footer, { width: '360px' });
    }

    onBenefitTypeChange() {
        const type = document.getElementById('eb_type')?.value;
        const couponParams = document.getElementById('eb_couponParams');
        const amountParams = document.getElementById('eb_amountParams');
        const defaultParams = document.getElementById('eb_defaultParams');
        if (couponParams) couponParams.style.display = type === 'coupon' ? 'block' : 'none';
        if (amountParams) amountParams.style.display = ['cash','freeship','reputation'].includes(type) ? 'block' : 'none';
        if (defaultParams) defaultParams.style.display = ['coupon','cash','freeship','reputation'].includes(type) ? 'none' : 'block';
    }

    saveBenefit(benefitId) {
        const getVal = (id, def='') => document.getElementById(id)?.value || def;
        const getNum = (id, def=0) => Number(document.getElementById(id)?.value) || def;
        const type = getVal('eb_type', 'coupon');
        
        const data = {
            name: getVal('eb_name', '新权益'),
            icon: getVal('eb_icon', '🎁'),
            type: type,
            pointsCost: getNum('eb_points', 100),
            minLevel: getNum('eb_minLevel', 1),
            stock: getNum('eb_stock', 999),
            validDays: getNum('eb_validDays', 7),
            desc: getVal('eb_desc', ''),
            enabled: document.getElementById('eb_enabled')?.checked !== false
        };
        
        if (type === 'coupon') {
            data.couponValue = getNum('eb_couponValue', 5);
            data.minOrderAmount = getNum('eb_minOrderAmount', 0);
        }
        if (['cash','freeship','reputation'].includes(type)) {
            data.amount = getNum('eb_amount', 1);
        }
        
        let res;
        if (benefitId) {
            res = gameState.updateBenefit(benefitId, data);
        } else {
            res = gameState.addBenefit(data);
        }
        
        if (res.success) {
            this.showToast(benefitId ? '✅ 修改已保存' : '✅ 添加成功');
            this.showMemberCenterModal('benefits');
        } else {
            this.showToast('❌ ' + (res.message || '操作失败'));
        }
    }

    setHistoryFilter(key) {
        this._historyFilter = key;
        this.showMemberCenterModal('points_log');
    }
    
    // 保留旧的兑换记录渲染用于兼容
    _renderMemberHistory(members, history) {
        this._pointsLogFilter = 'all';
        return this._renderPointsLog(members);
    }

    /**
     * 会员主动兑换：先弹二次确认框
     */
    confirmRedeemReward(rewardId, pointsCost, afterPoints, rewardName) {
        const state = gameState.state;
        const members = state.members || { points: 0 };
        const curPoints = members.points || 0;
        if (curPoints < (pointsCost||0)) {
            this.showToast('❌ 积分不足，还差 ' + Math.max(0, (pointsCost||0) - curPoints) + ' 分');
            return;
        }
        const reward = (typeof MEMBER_REWARDS !== 'undefined' ? MEMBER_REWARDS : (window.MEMBER_REWARDS||[])).find(r => r.id === rewardId);
        const icon = reward?.icon || '🎁';
        const name = rewardName || reward?.name || rewardId;

        const confirmContent = `
            <div style="overflow-x:hidden;touch-action:pan-y;">
                <div style="text-align:center;padding:6px 0 14px;">
                    <div style="font-size:48px;margin-bottom:4px;">${icon}</div>
                    <div style="font-size:15px;font-weight:900;">确认兑换「${name}」？</div>
                </div>
                <div style="background:#fff8e1;border-radius:10px;padding:10px 12px;margin-bottom:10px;">
                    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px;">
                        <span style="color:#9c5b00;">当前积分</span>
                        <b style="color:#d84315;">${curPoints}</b>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px;">
                        <span style="color:#c62828;">扣减积分</span>
                        <b style="color:#c62828;">-${pointsCost}</b>
                    </div>
                    <div style="height:1px;background:#ffe0b2;margin:6px 0;"></div>
                    <div style="display:flex;justify-content:space-between;font-size:12px;">
                        <span style="color:#2e7d32;">兑换后剩余</span>
                        <b style="color:#2e7d32;font-size:14px;">${Math.max(0, curPoints - pointsCost)}</b>
                    </div>
                </div>
                <div style="font-size:11px;color:#666;line-height:1.6;background:#f5f5f5;border-radius:8px;padding:8px 10px;">
                    <div>📌 确认后将立即扣减积分并发放奖励</div>
                </div>
            </div>
        `;
        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal();ui.showMemberCenterModal('mall');">取消</button>
            <button class="btn btn-primary" onclick="ui.closeModal();ui.executeRedeemReward('${rewardId}');">✅ 确认兑换</button>
        `;
        this.showModal('积分兑换确认', confirmContent, footer);
    }

    executeRedeemReward(rewardId) {
        const res = gameState.redeemReward({ rewardId, owner: 'shop' });
        if (res && res.success) {
            this.showToast('✅ 兑换成功！' + (res.rewardText || ''));
            setTimeout(() => this.showMemberCenterModal('points_log'), 100);
        } else {
            this.showToast('❌ ' + ((res && res.message) || '兑换失败，请稍后重试'));
            setTimeout(() => this.showMemberCenterModal('mall'), 200);
        }
    }

    redeemReward(rewardId) {
        const reward = (typeof MEMBER_REWARDS !== 'undefined' ? MEMBER_REWARDS : (window.MEMBER_REWARDS||[])).find(r => r.id === rewardId);
        if (!reward) { this.showToast('❌ 奖品不存在'); return; }
        const pts = gameState.state.members?.points || 0;
        this.confirmRedeemReward(rewardId, reward.pointsCost, pts - reward.pointsCost, reward.name);
    }

    showCouponModal() {
        this.currentTab = this.currentTab || {};
        this.currentTab.marketing = 'coupons';
        this.navigateTo('marketing');
        return;
        const state = gameState.state;
        const stats = gameState.getCouponStatistics();
        const now = state.gameTime;
        const activeTemplates = gameState.getAvailableCouponsForReceive();
        
        // 按类型分组统计可领取的优惠券库存
        const couponStock = {};
        activeTemplates.forEach(t => {
            const remaining = t.quantity - t.receivedCount;
            if (remaining <= 0) return;
            const key = t.type + '_' + t.value + '_' + t.minAmount;
            if (!couponStock[key]) {
                let preset = COUPON_PRESETS.find(p => p.type === t.type && p.value === t.value && p.minAmount === t.minAmount);
                couponStock[key] = {
                    ...t,
                    icon: preset?.icon || '🎟️',
                    remaining: 0,
                    minExpireDays: 999
                };
            }
            couponStock[key].remaining += remaining;
            const daysToEnd = t.endDay - now.day;
            couponStock[key].minExpireDays = Math.min(couponStock[key].minExpireDays, daysToEnd);
        });
        const stockList = Object.values(couponStock);

        const quickQty = [1, 5, 10, 20, 50];

        const getValueText = (t) => {
            switch(t.type) {
                case 'fixed': return `减¥${t.value}`;
                case 'discount': return `${t.value}折`;
                case 'threshold': return `减¥${t.value}`;
                case 'freeship': return '包邮';
                default: return `¥${t.value}`;
            }
        };

        const content = `
            <div style="text-align:center;padding:15px 0;">
                <div style="font-size:48px;margin-bottom:10px;">🎫</div>
                <div style="font-size:18px;font-weight:bold;color:#333;">优惠券管理</div>
                <div style="font-size:13px;color:#999;margin-top:5px;">快捷发放优惠券吸引顾客</div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:15px 0;">
                <div style="text-align:center;padding:10px;background:#fff3e0;border-radius:8px;">
                    <div style="font-size:18px;font-weight:bold;color:#ff9800;">${stats.totalIssued}</div>
                    <div style="font-size:11px;color:#999;margin-top:2px;">累计发放</div>
                </div>
                <div style="text-align:center;padding:10px;background:#e3f2fd;border-radius:8px;">
                    <div style="font-size:18px;font-weight:bold;color:#2196f3;">${stats.totalReceived}</div>
                    <div style="font-size:11px;color:#999;margin-top:2px;">已领取</div>
                </div>
                <div style="text-align:center;padding:10px;background:#e8f5e9;border-radius:8px;">
                    <div style="font-size:18px;font-weight:bold;color:#4caf50;">${stats.totalUsed}</div>
                    <div style="font-size:11px;color:#999;margin-top:2px;">已使用</div>
                </div>
                <div style="text-align:center;padding:10px;background:#f3e5f5;border-radius:8px;">
                    <div style="font-size:18px;font-weight:bold;color:#9c27b0;">${activeTemplates.length}</div>
                    <div style="font-size:11px;color:#999;margin-top:2px;">进行中</div>
                </div>
            </div>
            
            <div style="margin-bottom:15px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <span style="font-weight:bold;color:#333;font-size:13px;">快捷发放</span>
                    <span style="font-size:11px;color:#999;">发放后顾客下单时可领取使用</span>
                </div>
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                    <span style="font-size:12px;color:#666;">数量:</span>
                    <div style="flex:1;display:flex;gap:4px;">
                        ${quickQty.map(q => `
                            <button class="btn btn-secondary btn-small" style="flex:1;padding:4px;font-size:11px;"
                                    onclick="ui.setCouponQty(${q})" id="qty_btn_${q}">${q}</button>
                        `).join('')}
                    </div>
                    <input type="number" id="couponQty" value="10" min="1" max="999"
                           style="width:50px;padding:4px;border:1px solid #ddd;border-radius:4px;font-size:12px;text-align:center;">
                </div>
                <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;">
                    ${COUPON_PRESETS.filter(c => c.type === 'fixed').map(type => `
                        <button class="btn btn-primary btn-small" style="font-size:11px;padding:6px;" 
                                onclick="ui.issueCoupon('${type.id}')">
                            ${type.icon} ${type.name}
                        </button>
                    `).join('')}
                    ${COUPON_PRESETS.filter(c => c.type === 'discount').map(type => `
                        <button class="btn btn-primary btn-small" style="font-size:11px;padding:6px;" 
                                onclick="ui.issueCoupon('${type.id}')">
                            ${type.icon} ${type.name}
                        </button>
                    `).join('')}
                    <button class="btn btn-primary btn-small" style="font-size:11px;padding:6px;grid-column:span 2;" 
                            onclick="ui.issueCoupon('free_shipping')">
                        🚚 包邮券
                    </button>
                </div>
            </div>
            
            ${stockList.length > 0 ? `
                <div style="margin-top:10px;">
                    <div style="font-weight:bold;margin-bottom:8px;color:#333;font-size:13px;">
                        可领取优惠券库存 (${stockList.reduce((s,t)=>s+t.remaining,0)}张)
                    </div>
                    <div style="max-height:180px;overflow-y:auto;border:1px solid #f0f0f0;border-radius:8px;">
                        ${stockList.map(info => {
                            return `
                                <div style="padding:10px;border-bottom:1px solid #f5f5f5;display:flex;align-items:center;gap:10px;">
                                    <div style="font-size:24px;">${info.icon}</div>
                                    <div style="flex:1;">
                                        <div style="font-size:13px;font-weight:bold;">${info.name}</div>
                                        <div style="font-size:11px;color:#999;">
                                            ${info.minAmount > 0 ? `满¥${info.minAmount}可用` : '无门槛'}
                                            · 剩余${Math.max(0, info.minExpireDays)}天结束
                                        </div>
                                    </div>
                                    <div style="text-align:right;">
                                        <div style="font-size:14px;font-weight:bold;color:#ff6b35;">${getValueText(info)}</div>
                                        <div style="font-size:11px;color:#999;">剩${info.remaining}张</div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            ` : `
                <div style="text-align:center;padding:20px;color:#999;font-size:13px;background:#fafafa;border-radius:8px;">
                    🎁 暂无进行中的优惠券<br>
                    <span style="font-size:11px;">选择数量后点击上方按钮发放优惠券</span>
                </div>
            `}
        `;

        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>
        `;

        this.showModal('优惠券管理', content, footer, { modalId: 'couponManageModal' });
        
        setTimeout(() => {
            this.setCouponQty(10);
        }, 100);
    }

    setCouponQty(qty) {
        const input = document.getElementById('couponQty');
        if (input) input.value = qty;
        
        [1, 5, 10, 20, 50].forEach(q => {
            const btn = document.getElementById(`qty_btn_${q}`);
            if (btn) {
                if (q === qty) {
                    btn.style.background = '#ff6b35';
                    btn.style.color = 'white';
                    btn.style.borderColor = '#ff6b35';
                } else {
                    btn.style.background = '';
                    btn.style.color = '';
                    btn.style.borderColor = '';
                }
            }
        });
    }

    issueCoupon(typeId) {
        const input = document.getElementById('couponQty');
        const count = parseInt(input?.value) || 1;
        
        const result = gameState.issueCoupon(typeId, count);
        if (result && result.length > 0) {
            const type = COUPON_PRESETS.find(t => t.id === typeId);
            this.showToast(`发放成功：${type?.name || '优惠券'} x${result.length}张`);
            this.closeModal();
            setTimeout(() => this.showCouponModal(), 200);
        } else {
            this.showToast('发放失败');
        }
    }

    showOfflineShops() {
        try {
            if (typeof shopsUI !== 'undefined' && shopsUI.init) {
                shopsUI.init(gameState, this, gameState.shops);
            }
            if (typeof shopsUI !== 'undefined' && shopsUI.openShopsModal) {
                shopsUI.openShopsModal();
                return;
            }
        } catch (e) {
            console.error(e);
        }
        this.showToast('门店系统未就绪');
    }

    showWarehouseModal(tab = 'overview') {
        // 包材已迁到九宫格「包装材料」，旧入口统一跳转
        if (tab === 'packaging' || tab === 'packagingMaterials') {
            this.showPackagingMaterialModal();
            return;
        }
        // 如果新仓储UI模块可用，使用新界面
        // tab='buyer'：九宫格「采购员」独立入口；其余为仓储管理（不再含采购员/包材 Tab）
        if (typeof window !== 'undefined' && window.whUI) {
            window.whUI.currentTab = tab || 'overview';
            window.whUI.show();
            return;
        }
        // 旧界面（向后兼容）
        this._warehouseTab = tab;
        const state = gameState.state;
        const wh = state.warehouse;
        
        // 基础数据
        const warehouseLevel = gameState.getWarehouseLevel();
        const warehouseCapacity = gameState.getWarehouseCapacity();
        const warehouseUsed = gameState.getUsedCapacity();
        const warehouseCity = gameState.getWarehouseCity();
        const cityInfo = getCityById(warehouseCity);
        const warehouseLevelInfo = WAREHOUSE_LEVELS.find(w => w.level === warehouseLevel);
        const upgradeCost = warehouseLevelInfo ? warehouseLevelInfo.upgradeCost : 0;
        const usagePercent = warehouseCapacity > 0 ? (warehouseUsed / warehouseCapacity * 100) : 0;
        const totalValue = gameState.getInventoryTotalValue();
        const alerts = gameState.getStockAlerts();
        const pmMaterials = gameState.getPackagingMaterials();
        const logs = [...(wh.logs || [])].sort((a,b) => b.timestamp - a.timestamp);
        const analytics = typeof gameState.getWarehouseAnalytics === 'function' ? gameState.getWarehouseAnalytics() : null;

        // 旧仓储兜底 Tab（包材已迁到九宫格「包装材料」）
        const tabs = [
            { id: 'overview', name: '概览', icon: '🏭' },
            { id: 'inventory', name: '库存', icon: '📦' },
            { id: 'logs', name: '记录', icon: '📋' },
            { id: 'alerts', name: '预警', icon: '⚠️', badge: alerts.length },
            { id: 'settings', name: '设置', icon: '⚙️' }
        ];

        const f = this._whLogFilter;
        const today = state.gameTime.day;
        const filteredLogs = logs.filter(l => {
            if (!l) return false;
            if (f.type !== 'all' && l.type !== f.type) return false;
            if (f.days > 0 && (today - (l.day || 0)) >= f.days) return false;
            return true;
        });

        // Tab内容映射
        let tabContent = '';
        switch(tab) {
            case 'overview':
                const lowStockItems = gameState.getInventoryList().filter(i => i.quantity <= (state.warehouse.lowStockThreshold||20));
                tabContent = this._renderWarehouseOverview(state, {
                    warehouseLevel, warehouseCapacity, warehouseUsed, usagePercent,
                    totalValue, cityInfo, warehouseLevelInfo, upgradeCost, analytics,
                    pmMaterials, alerts,
                    lowStockItems, threshold: state.warehouse.lowStockThreshold || 20
                });
                break;
            case 'inventory':
                tabContent = this._renderWarehouseInventory(state);
                break;
            case 'logs':
                tabContent = this._renderWarehouseLogs(filteredLogs, logs.length, f);
                break;
            case 'alerts':
                tabContent = this._renderWarehouseAlerts(alerts);
                break;
            case 'settings':
                tabContent = this._renderWarehouseSettings(state, { cityInfo, warehouseUsed, totalValue, upgradeCost });
                break;
        }

        const content = `
            <div style="margin:-20px -20px 0;">
                <div style="background:linear-gradient(135deg,#1976d2,#42a5f5);color:#fff;padding:14px 20px 10px;text-align:center;">
                    <div style="font-size:30px;">🏭</div>
                    <div style="font-size:16px;font-weight:900;">仓储管理</div>
                    <div style="font-size:11px;opacity:.85;margin-top:2px;">
                        ${cityInfo.icon}${cityInfo.name}仓库 · Lv.${warehouseLevel} · ${warehouseUsed}/${warehouseCapacity} · 货值${formatMoney(totalValue)}
                        ${alerts.length > 0 ? ` · <span style="color:#ffcdd2;">⚠️${alerts.length}项预警</span>` : ''}
                    </div>
                </div>
                <div style="display:flex;background:#fff;border-bottom:1px solid #f0f0f0;overflow-x:auto;">
                    ${tabs.map(t => `
                        <div style="flex:1;min-width:60px;padding:8px 2px;text-align:center;font-size:11px;cursor:pointer;color:#666;border-bottom:2px solid transparent;white-space:nowrap;position:relative;${tab===t.id?'color:#1976d2;border-bottom-color:#1976d2;font-weight:700;':''}"
                             onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                             onclick="ui.showWarehouseModal('${t.id}')">
                            ${t.icon}<br>${t.name}
                            ${t.badge ? `<span style="position:absolute;top:2px;right:8px;background:#f44336;color:#fff;font-size:9px;padding:0 4px;border-radius:6px;min-width:14px;text-align:center;">${t.badge}</span>` : ''}
                        </div>
                    `).join('')}
                </div>
                <div style="padding:10px 12px 14px;max-height:62vh;overflow-y:auto;">
                    ${tabContent}
                </div>
            </div>
        `;

        let footer;
        if (tab === 'overview') {
            footer = `
                <button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>
                <button class="btn btn-primary" onclick="ui.upgradeWarehouse()" ${!warehouseLevelInfo || warehouseLevel >= WAREHOUSE_LEVELS.length ? 'disabled style="opacity:0.5;"' : ''}>
                    ${warehouseLevel >= WAREHOUSE_LEVELS.length ? '已满级' : `升级仓库 (¥${(upgradeCost||0).toLocaleString()})`}
                </button>
            `;
        } else if (tab === 'packaging') {
            footer = `
                <button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>
                <button class="btn btn-primary" onclick="ui.showPackagingMaterialModal()">+ 采购包材</button>
            `;
        } else {
            footer = `<button class="btn btn-primary" onclick="ui.closeModal()">关闭</button>`;
        }

        this.showModal('仓储管理', content, footer, { noBodyPadding: true, modalId: 'warehouseLegacyModal' });
    }

    _renderWarehouseOverview(state, s) {
        const nextLv = WAREHOUSE_LEVELS.find(w => w.level === s.warehouseLevel + 1);
        const a = s.analytics;
        const age = a?.ageBuckets;
        const cats = a?.categories || [];
        const ageTotal = age ? (age.age0_7 + age.age7_30 + age.age30_90 + age.age90) || 1 : 1;

        return `
            ${a ? `
                <!-- 健康度大卡片 -->
                <div style="display:flex;gap:10px;margin-bottom:12px;align-items:center;
                            background:linear-gradient(135deg,${a.gradeColor}15,#ffffff);
                            border:1px solid ${a.gradeColor}44;border-radius:12px;padding:12px;">
                    <div style="width:68px;height:68px;border-radius:50%;
                                background:conic-gradient(${a.gradeColor} ${a.healthScore*3.6}deg,#eee 0);
                                display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <div style="width:54px;height:54px;border-radius:50%;background:#fff;
                                    display:flex;align-items:center;justify-content:center;flex-direction:column;">
                            <div style="font-weight:900;font-size:18px;color:${a.gradeColor};">${a.healthScore}</div>
                            <div style="font-size:9px;color:#888;">健康分</div>
                        </div>
                    </div>
                    <div style="flex:1;">
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                            <div style="font-weight:800;font-size:15px;color:#333;">库存健康评级：<span style="color:${a.gradeColor};">${a.healthGrade}</span></div>
                        </div>
                        <div style="font-size:10px;color:#666;line-height:1.55;">
                            容量${a.healthBreakdown.scoreCap}/30 · 预警${a.healthBreakdown.scoreStock}/30 · 周转${a.healthBreakdown.scoreTurn}/20 · 盘点${a.healthBreakdown.scoreCheck}/20
                        </div>
                        <div style="font-size:10px;color:#444;margin-top:4px;line-height:1.45;">
                            ${a.healthScore >= 80 ? '💚 状态优秀，合理控制库存' :
                              a.healthScore >= 60 ? '💛 状态一般，建议关注预警项' :
                              a.healthScore >= 45 ? '🧡 风险初显，建议：补货+清库存+盘点' :
                              '❤️ 需紧急优化：检查缺货SKU、清理滞销库存、及时盘点'}
                        </div>
                    </div>
                </div>

                <!-- 周转+近7/30日指标 -->
                <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px;">
                    <div style="background:#f3e5f5;border-radius:8px;padding:7px 4px;text-align:center;">
                        <div style="font-size:12px;font-weight:800;color:#6a1b9a;">${a.turnoverDays<999?a.turnoverDays+'天':'∞'}</div>
                        <div style="font-size:9px;color:#666;">周转天数</div>
                    </div>
                    <div style="background:#e8f5e9;border-radius:8px;padding:7px 4px;text-align:center;">
                        <div style="font-size:12px;font-weight:800;color:#2e7d32;">${a.turnoverRate}×</div>
                        <div style="font-size:9px;color:#666;">30日周转率</div>
                    </div>
                    <div style="background:#e3f2fd;border-radius:8px;padding:7px 4px;text-align:center;">
                        <div style="font-size:12px;font-weight:800;color:#0d47a1;">${a.out7}/${a.in7}</div>
                        <div style="font-size:9px;color:#666;">7日出/入(件)</div>
                    </div>
                    <div style="background:#fff3e0;border-radius:8px;padding:7px 4px;text-align:center;">
                        <div style="font-size:12px;font-weight:800;color:#e65100;">${a.out30}/${a.in30}</div>
                        <div style="font-size:9px;color:#666;">30日出/入(件)</div>
                    </div>
                </div>
            ` : ''}

            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px;">
                <div style="text-align:center;padding:10px;background:#e3f2fd;border-radius:10px;">
                    <div style="font-size:18px;font-weight:bold;color:#1976d2;">${s.warehouseCapacity}</div>
                    <div style="font-size:11px;color:#666;margin-top:2px;">总容量</div>
                </div>
                <div style="text-align:center;padding:10px;background:#fff3e0;border-radius:10px;">
                    <div style="font-size:18px;font-weight:bold;color:#ff6b35;">${s.warehouseUsed}</div>
                    <div style="font-size:11px;color:#666;margin-top:2px;">已占用 ${a?`SKU ${a.skuCount}`:''}</div>
                </div>
                <div style="text-align:center;padding:10px;background:#e8f5e9;border-radius:10px;">
                    <div style="font-size:18px;font-weight:bold;color:#4caf50;">${formatMoney(s.totalValue)}</div>
                    <div style="font-size:11px;color:#666;margin-top:2px;">货值(成本)</div>
                </div>
            </div>
            <div style="margin:10px 0 12px;">
                <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px;">
                    <span style="color:#666;">容量使用率</span>
                    <span style="color:#333;font-weight:bold;">${s.usagePercent.toFixed(1)}%</span>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width:${Math.min(100,s.usagePercent)}%;background:${s.usagePercent>90?'#f44336':s.usagePercent>70?'#ff9800':'#4caf50'};"></div>
                </div>
                ${nextLv?`<div style="font-size:10px;color:#666;margin-top:6px;text-align:right;">升到Lv.${nextLv.level} → 容量 ${nextLv.capacity}</div>`:''}
            </div>

            ${a && (a.slowQty>0 || a.topSlowSkus?.length) ? `
                <div style="background:#ffebee;border-radius:8px;padding:8px 10px;margin-bottom:10px;border-left:3px solid #e53935;">
                    <div style="font-size:12px;font-weight:700;color:#c62828;margin-bottom:4px;">
                        ⚠️ 滞销预警：${a.slowQty}件库龄>30天（约占 ${formatMoney(a.slowValue)}）
                    </div>
                    ${a.topSlowSkus && a.topSlowSkus.length ? `
                        <div style="display:flex;flex-direction:column;gap:2px;">
                            ${a.topSlowSkus.slice(0,4).map(sku=>`
                                <div style="display:flex;justify-content:space-between;font-size:10px;color:#b71c1c;">
                                    <span>🕐 ${sku.ageDays}天 · ${sku.productName?.slice(0,12)||''} (${sku.qualityGrade})</span>
                                    <span>${sku.quantity}件 · ${formatMoney(sku.costValue)}</span>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
            ` : ''}

            ${a && age ? `
                <div style="background:#fafafa;border-radius:8px;padding:10px 12px;margin-bottom:10px;">
                    <div style="font-weight:700;font-size:12px;color:#333;margin-bottom:6px;">📦 库龄结构分布</div>
                    <div style="display:flex;height:14px;border-radius:7px;overflow:hidden;">
                        <div style="height:100%;width:${(age.age0_7/ageTotal*100).toFixed(1)}%;background:#66bb6a;" title="0-7天: ${age.age0_7}件"></div>
                        <div style="height:100%;width:${(age.age7_30/ageTotal*100).toFixed(1)}%;background:#ffca28;" title="8-30天: ${age.age7_30}件"></div>
                        <div style="height:100%;width:${(age.age30_90/ageTotal*100).toFixed(1)}%;background:#ff7043;" title="31-90天: ${age.age30_90}件"></div>
                        <div style="height:100%;width:${(age.age90/ageTotal*100).toFixed(1)}%;background:#e53935;" title="90天+: ${age.age90}件"></div>
                    </div>
                    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-top:6px;font-size:9px;color:#666;text-align:center;">
                        <div>🟩 0-7天<br/><b>${age.age0_7}件</b></div>
                        <div>🟨 8-30天<br/><b>${age.age7_30}件</b></div>
                        <div>🟧 31-90天<br/><b>${age.age30_90}件</b></div>
                        <div>🟥 90天+<br/><b>${age.age90}件</b></div>
                    </div>
                </div>
            ` : ''}

            ${cats.length > 0 ? `
                <div style="background:#fafafa;border-radius:8px;padding:10px 12px;margin-bottom:10px;">
                    <div style="font-weight:700;font-size:12px;color:#333;margin-bottom:6px;">📊 分类货值分布（Top ${cats.length}）</div>
                    <div style="display:flex;flex-direction:column;gap:4px;">
                        ${cats.map((c,i) => {
                            const colors = ['#42a5f5','#66bb6a','#ffa726','#ab47bc','#ef5350','#26c6da','#ec407a','#78909c'];
                            const col = colors[i%colors.length];
                            return `
                                <div>
                                    <div style="display:flex;justify-content:space-between;font-size:10px;color:#555;margin-bottom:2px;">
                                        <span>${c.name}</span>
                                        <span>${formatMoney(c.costValue)} · ${c.valuePct}%</span>
                                    </div>
                                    <div style="height:6px;background:#eee;border-radius:3px;overflow:hidden;">
                                        <div style="height:100%;width:${c.valuePct}%;background:${col};"></div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            ` : ''}

            <div style="background:${s.cityInfo.difficultyColor}15;border-radius:10px;padding:12px 14px;margin-bottom:10px;">
                <div style="display:flex;align-items:center;gap:8px;">
                    <span style="font-size:20px;">${s.cityInfo.icon}</span>
                    <div style="flex:1;">
                        <div style="font-weight:700;font-size:13px;color:#333;">${s.cityInfo.name}仓库</div>
                        <div style="font-size:10px;color:#888;">${s.cityInfo.tagline||''} · 等级Lv.${s.warehouseLevel}</div>
                    </div>
                </div>
                <div style="font-size:11px;color:#666;line-height:1.5;margin-top:6px;">${s.cityInfo.description||''}</div>
            </div>
            <div style="margin-top:4px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="font-weight:700;font-size:13px;color:#333;">⚠️ 低库存预警 (<= ${s.threshold}件)
                        <button class="btn btn-small btn-secondary" style="padding:1px 6px;font-size:10px;margin-left:4px;" onclick="ui._changeLowStockThreshold()">调整</button>
                    </div>
                    <span style="font-size:11px;color:#f44336;">${s.lowStockItems.length}个SKU ${a?`（缺货${a.outOfStock}个）`:''}</span>
                </div>
                ${s.lowStockItems.length === 0 ? `
                    <div style="padding:16px;text-align:center;color:#4caf50;font-size:12px;background:#f1f8e9;border-radius:8px;">🎉 所有商品库存充足</div>
                ` : `
                    <div style="max-height:220px;overflow-y:auto;border-radius:8px;border:1px solid #ffebee;">
                        ${s.lowStockItems.slice(0,30).map(x => `
                            <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #fff3e0;">
                                <div style="flex:1;">
                                    <div style="font-size:12px;font-weight:600;">${x.productName}</div>
                                    <div style="font-size:10px;color:#888;">${x.qualityGrade} 成本¥${(x.costValue/(x.quantity||1)).toFixed(2)}/件 · 货值${formatMoney(x.costValue)}</div>
                                </div>
                                <div style="text-align:right;">
                                    <div style="font-size:13px;color:${x.quantity===0?'#c62828':'#ef6c00'};font-weight:800;">${x.quantity===0?'缺货':x.quantity+'件'}</div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `}
            </div>
        `;
    }
    
    _changeLowStockThreshold() {
        const cur = gameState.state.warehouse.lowStockThreshold || 20;
        const v = prompt('设置低库存预警阈值（件）：', cur);
        if (v == null) return;
        const n = parseInt(v, 10);
        if (!isFinite(n) || n < 0) { this.showToast('请输入有效数字'); return; }
        gameState.setLowStockThreshold(n);
        this.showToast('已设置为 '+n+' 件');
        this.showWarehouseModal('overview');
    }

    _setWhLogFilter(key, value) {
        if (!this._whLogFilter) this._whLogFilter = { type: 'all', days: 0 };
        this._whLogFilter[key] = value;
        this.showWarehouseModal('logs');
    }
    
    _renderWarehouseLogs(logs, totalCount = 0, filter = { type: 'all', days: 0 }) {
        const badgeOf = (type) => {
            switch (type) {
                case 'inbound': return {icon:'📥', txt:'入库', color:'#e8f5e9', txtColor:'#2e7d32'};
                case 'outbound': return {icon:'📤', txt:'出库', color:'#ffebee', txtColor:'#c62828'};
                case 'move': return {icon:'🚛', txt:'搬仓', color:'#e3f2fd', txtColor:'#0d47a1'};
                case 'check': return {icon:'📋', txt:'盘点', color:'#fff8e1', txtColor:'#e65100'};
                case 'adjust': return {icon:'🔧', txt:'调整', color:'#f3e5f5', txtColor:'#7b1fa2'};
                case 'package_in': return {icon:'📦', txt:'包材', color:'#e0f7fa', txtColor:'#006064'};
                default: return {icon:'📝', txt:'其他', color:'#f5f5f5', txtColor:'#666'};
            }
        };
        const typeOpts = [
            { k:'all',      n:'全部',  i:'🗂️' },
            { k:'inbound',  n:'入库',  i:'📥' },
            { k:'outbound', n:'出库',  i:'📤' },
            { k:'adjust',   n:'调整',  i:'🔧' },
            { k:'check',    n:'盘点',  i:'📋' },
            { k:'move',     n:'搬仓',  i:'🚛' }
        ];
        const daysOpts = [
            { k:0,  n:'全部' },
            { k:7,  n:'近7天' },
            { k:30, n:'近30天' }
        ];
        const curType = filter.type || 'all';
        const curDays = filter.days || 0;

        const filterBar = `
            <div style="background:#fafafa;border-radius:10px;padding:8px;margin-bottom:10px;border:1px solid #eee;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                    <div style="font-size:11px;font-weight:700;color:#555;">🔍 类型筛选</div>
                    <div style="font-size:11px;color:#777;">
                        显示 <b style="color:#1976d2;">${logs.length}</b> / 共 ${totalCount||logs.length} 条
                    </div>
                </div>
                <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px;">
                    ${typeOpts.map(t => `
                        <div onclick="ui._setWhLogFilter('type','${t.k}')"
                             style="flex:1;min-width:52px;padding:5px 2px;text-align:center;font-size:11px;
                                    border-radius:6px;cursor:pointer;
                                    ${curType===t.k
                                        ?'background:#1976d2;color:#fff;font-weight:700;'
                                        :'background:#fff;color:#555;border:1px solid #e0e0e0;'}">
                            ${t.i} ${t.n}
                        </div>
                    `).join('')}
                </div>
                <div style="font-size:11px;font-weight:700;color:#555;margin-bottom:4px;">⏱️ 时间范围</div>
                <div style="display:flex;gap:4px;">
                    ${daysOpts.map(d => `
                        <div onclick="ui._setWhLogFilter('days',${d.k})"
                             style="flex:1;padding:5px 2px;text-align:center;font-size:11px;
                                    border-radius:6px;cursor:pointer;
                                    ${curDays===d.k
                                        ?'background:#ff9800;color:#fff;font-weight:700;'
                                        :'background:#fff;color:#555;border:1px solid #e0e0e0;'}">
                            ${d.n}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        if (!logs || logs.length === 0) {
            return filterBar + `<div style="padding:40px 0;text-align:center;color:#999;font-size:12px;">当前筛选条件下暂无记录</div>`;
        }
        return filterBar + `
            <div style="display:flex;flex-direction:column;gap:6px;max-height:48vh;overflow-y:auto;">
                ${logs.slice(0, 150).map(l => {
                    const b = badgeOf(l.type);
                    let main = '';
                    if (l.type === 'inbound' || l.type === 'outbound') {
                        main = `<div style="font-size:12px;font-weight:600;">${l.productName||''} <span class="badge" style="background:#eee;margin-left:4px;">${l.qualityGrade||'B'}</span></div>
                                <div style="font-size:10px;color:#777;margin-top:2px;">
                                    ${l.quantity||0}件 · 成本${formatMoney(l.unitCost||0)}/件 · 合计${formatMoney(l.totalCost||0)}
                                    ${l.note ? ' · '+l.note : ''}
                                </div>`;
                    } else if (l.type === 'move') {
                        main = `<div style="font-size:12px;font-weight:600;">${l.fromCityName||''} → ${l.toCityName||''}</div>
                                <div style="font-size:10px;color:#777;margin-top:2px;">搬运 ${l.movedQty||0} 件 · 费用 ${formatMoney(l.moveCost||0)}</div>`;
                    } else if (l.type === 'check') {
                        const color = (l.valueDelta||0) >= 0 ? '#2e7d32' : '#c62828';
                        main = `<div style="font-size:12px;font-weight:600;">
                                    第${l.day}天盘点 · SKU${l.checkedSkuCount||0} / 件数${l.checkedQty||0}
                                </div>
                                <div style="font-size:10px;color:${color};margin-top:2px;font-weight:600;">
                                    ${l.financeNote||''} · 账面${formatMoney(l.bookValue||0)} · 差异${formatMoney(l.valueDelta||0)}
                                </div>
                                ${(l.detail && l.detail.length > 0) ? `
                                    <div style="margin-top:4px;font-size:10px;color:#666;line-height:1.4;">
                                        变动项举例：${l.detail.slice(0, 3).map(d => 
                                            `${d.productName?.slice(0,8)||''}${d.delta>0?'+'+d.delta:d.delta}`
                                        ).join('，')}${l.detail.length > 3 ? '…等'+l.detail.length+'项' : ''}
                                    </div>
                                ` : ''}`;
                    }
                    return `
                        <div style="border:1px solid #f0f0f0;border-radius:8px;padding:8px 10px;background:#fff;">
                            <div style="display:flex;gap:8px;align-items:flex-start;">
                                <span class="badge" style="background:${b.color};color:${b.txtColor};padding:3px 6px;font-size:10px;">${b.icon} ${b.txt}</span>
                                <div style="flex:1;">
                                    ${main}
                                </div>
                                <div style="font-size:10px;color:#999;text-align:right;white-space:nowrap;">
                                    第${l.day}天<br/>${String(l.hour||0).padStart(2,'0')}:00
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
            ${logs.length > 150 ? `<div style="padding:10px;text-align:center;color:#999;font-size:11px;">仅展示最新 150 条</div>` : ''}
        `;
    }
    
    _renderWarehouseMove(cityInfo, curQty, curValue) {
        const estimateCost = Math.max(50, Math.round(curQty * 0.5 + curValue * 0.01 + 50));
        const allCities = WAREHOUSE_CITIES || [];
        const fmtCityEffects = (c) => {
            const eff = c.effects || {};
            const parts = [];
            // 采购折扣（对象：按品类）
            if (eff.purchaseDiscount && typeof eff.purchaseDiscount === 'object') {
                const sub = Object.entries(eff.purchaseDiscount).map(([cat, v]) => {
                    const catNames = {daily:'日用',digital:'数码',clothing:'服装',food:'食品',beauty:'美妆',home:'家居',outdoor:'户外',luxury:'奢侈品',all:'全品类'};
                    const name = catNames[cat] || cat;
                    const pct = Math.round(Math.abs(v) * 100);
                    return v > 0 ? `${name}${pct}%off` : `${name}+${pct}%成本`;
                }).filter(Boolean);
                if (sub.length) parts.push('采购：' + sub.join('/'));
            } else if (typeof eff.purchaseDiscount === 'number' && eff.purchaseDiscount) {
                const pct = Math.round(Math.abs(eff.purchaseDiscount) * 100);
                parts.push(eff.purchaseDiscount > 0 ? `采购${pct}%off` : `采购+${pct}%成本`);
            }
            // 工资：正数=折扣（降薪），负数=增加（涨薪）
            if (eff.salaryDiscount !== undefined && eff.salaryDiscount !== 0) {
                const pct = Math.round(Math.abs(eff.salaryDiscount) * 100);
                parts.push(eff.salaryDiscount > 0 ? `工资-${pct}%` : `工资+${pct}%`);
            }
            // 运费折扣（正数=折扣）
            if (eff.shippingDiscount !== undefined && eff.shippingDiscount !== 0) {
                parts.push(`运费-${Math.round(Math.abs(eff.shippingDiscount)*100)}%`);
            }
            // 流量加成（小数，乘以100显示百分比）
            if (eff.trafficBonus !== undefined && eff.trafficBonus !== 0) {
                const pct = Math.round(eff.trafficBonus * 100);
                parts.push(pct > 0 ? `流量+${pct}%` : `流量${pct}%`);
            }
            // 初始资金
            if (eff.startMoney) parts.push(`赠金${formatMoney(eff.startMoney)}`);
            // 初始容量
            if (eff.startCapacity) parts.push(`+${eff.startCapacity}容量`);
            // 初始信誉
            if (eff.startReputation) parts.push(`信誉+${eff.startReputation}`);
            // A品销量加成
            if (eff.aGradeSalesBonus) parts.push(`A品销量+${Math.round(eff.aGradeSalesBonus*100)}%`);
            // 房租（每日）
            if (eff.rentCost) parts.push(`房租${formatMoney(eff.rentCost)}/日`);
            return parts.length ? parts.join(' · ') : '—';
        };
        return `
            <div style="background:#fff3e0;border-radius:8px;padding:10px 12px;font-size:11px;color:#7a4d00;margin-bottom:10px;">
                💡 搬仓费用 = 件数×0.5元 + 货值×1% + 跨区50元。当前库存${curQty}件、货值${formatMoney(curValue)}，预计约<b>${formatMoney(estimateCost)}</b>
            </div>
            <div style="font-weight:700;font-size:13px;color:#333;margin-bottom:6px;">当前仓库：${cityInfo.icon} ${cityInfo.name}
                <span class="badge" style="background:${cityInfo.difficultyColor}20;color:${cityInfo.difficultyColor};margin-left:6px;">${cityInfo.tagline}</span>
            </div>
            <div style="font-size:12px;color:#666;margin:8px 0 6px;">选择要迁移到的仓库城市：</div>
            <div style="display:flex;flex-direction:column;gap:6px;max-height:45vh;overflow-y:auto;">
                ${allCities.filter(c => c.id !== cityInfo.id).map(c => `
                    <div style="border:1px solid #eee;border-radius:10px;padding:10px;">
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span style="font-size:22px;">${c.icon}</span>
                            <div style="flex:1;">
                                <div style="font-size:13px;font-weight:700;">${c.name}</div>
                                <div style="font-size:10px;color:#888;">${c.province||''} · ${c.tagline||''} · <span style="color:${c.difficultyColor};">${c.difficulty||''}</span></div>
                                <div style="font-size:10px;color:#666;margin-top:2px;line-height:1.4;">${(c.description||'').slice(0,60)}</div>
                            </div>
                            <button class="btn btn-small btn-primary"
                                    onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                                    onclick="ui.moveWarehouse('${c.id}')">
                                🚛 搬仓
                            </button>
                        </div>
                        <div style="margin-top:6px;font-size:10px;color:#555;line-height:1.5;">
                            ✅ 优势：${(c.advantages||[]).join('；')||'—'}
                        </div>
                        <div style="margin-top:2px;font-size:10px;color:#888;line-height:1.5;">
                            🎯 数值效果：${fmtCityEffects(c)}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }
    
    moveWarehouse(cityId) {
        if (!confirm(`确认搬仓到该城市？将按实际库存收取搬仓费。`)) return;
        const r = gameState.moveWarehouseCity(cityId);
        if (r.success) {
            this.showToast(`✅ 已从${r.from}搬至${r.to}，${r.qty}件运费${formatMoney(r.cost)}`);
            this.showWarehouseModal('logs');
        } else {
            this.showToast('❌ ' + (r.message || '搬仓失败'));
        }
    }
    
    _renderWarehouseCheck(logs) {
        const checks = logs.filter(l => l.type === 'check');
        const last = checks[0];
        return `
            <div style="background:#fff8e1;border-radius:8px;padding:10px 12px;font-size:11px;color:#7a4d00;margin-bottom:10px;line-height:1.5;">
                📋 每日可盘点一次，系统会按实际仓库的常见误差模型（-1.0%~+0.5%）
                随机调整库存，盘盈盘亏将自动计入当天财务。建议经常盘点减少差异累积！
            </div>
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:10px;">
                <div style="text-align:center;padding:10px;background:#fafafa;border-radius:10px;">
                    <div style="font-size:16px;font-weight:800;">${gameState.getInventoryQuantity?Object.keys(Object.fromEntries(new Map(
                        (gameState.state.inventory||[]).map(i=>[i.productId+'|'+i.qualityGrade,1])
                    ))).length:0}</div>
                    <div style="font-size:11px;color:#666;margin-top:2px;">SKU数</div>
                </div>
                <div style="text-align:center;padding:10px;background:#fafafa;border-radius:10px;">
                    <div style="font-size:16px;font-weight:800;">${gameState.getUsedCapacity()}</div>
                    <div style="font-size:11px;color:#666;margin-top:2px;">总件数</div>
                </div>
                <div style="text-align:center;padding:10px;background:#fafafa;border-radius:10px;">
                    <div style="font-size:16px;font-weight:800;">${formatMoney(gameState.getInventoryTotalValue())}</div>
                    <div style="font-size:11px;color:#666;margin-top:2px;">账面货值</div>
                </div>
                <div style="text-align:center;padding:10px;background:#fafafa;border-radius:10px;">
                    <div style="font-size:16px;font-weight:800;">${checks.length}</div>
                    <div style="font-size:11px;color:#666;margin-top:2px;">历史盘点次数</div>
                </div>
            </div>
            <button class="btn btn-primary btn-block"
                    onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                    onclick="ui.doWarehouseCheck()"
                    style="background:linear-gradient(135deg,#ff9800,#ff6b35);border:none;">
                📦 立即盘点
            </button>
            ${last ? `
                <div style="margin-top:12px;">
                    <div style="font-weight:700;font-size:12px;color:#333;margin-bottom:6px;">最近一次盘点 (第${last.day}天)</div>
                    <div style="border-radius:8px;padding:10px 12px;background:${(last.valueDelta||0)>=0?'#e8f5e9':'#ffebee'};">
                        <div style="font-size:12px;font-weight:700;color:${(last.valueDelta||0)>=0?'#2e7d32':'#c62828'};">${last.financeNote||''}</div>
                        <div style="font-size:10px;color:#666;margin-top:4px;">
                            SKU${last.checkedSkuCount||0} · 件数${last.checkedQty||0} · 
                            变动项${last.changedCount||0} · 账面${formatMoney(last.bookValue||0)}
                        </div>
                        ${(last.detail && last.detail.length) ? `
                            <div style="margin-top:6px;font-size:10px;color:#555;line-height:1.5;">
                                ${last.detail.slice(0, 8).map(d => `
                                    <div style="display:flex;justify-content:space-between;border-top:1px dashed #eee;padding:2px 0;">
                                        <span>${d.productName?.slice(0,10)||''} <span style="color:#888;">${d.before}→${d.after}</span></span>
                                        <span style="color:${d.delta>0?'#2e7d32':'#c62828'};font-weight:700;">
                                            ${d.delta>0?'+':''}${d.delta} (${formatMoney(d.valueDelta||0)})
                                        </span>
                                    </div>
                                `).join('')}
                            </div>
                        ` : ''}
                    </div>
                </div>
            ` : ''}
        `;
    }
    
    doWarehouseCheck() {
        const r = gameState.doWarehouseCheck();
        if (r.success) {
            this.showToast(`✅ 盘点完成 · ${r.financeNote} · 变动${r.changedCount}项`);
            this.showWarehouseModal('settings');
        } else {
            this.showToast('❌ ' + (r.message || '盘点失败'));
        }
    }

    // ==================== 新增：库存列表Tab ====================
    _renderWarehouseInventory(state) {
        const filter = this._invFilter;
        const invList = gameState.getInventoryList(filter);
        const categories = [
            { id: 'all', name: '全部' },
            ...(Array.isArray(CATEGORIES) ? CATEGORIES.map((c) => ({ id: c.id, name: c.name })) : [])
        ];

        return `
            <!-- 搜索和筛选栏 -->
            <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;">
                <div style="flex:1;min-width:120px;position:relative;">
                    <span style="position:absolute;left:8px;top:50%;transform:translateY(-50%);">🔍</span>
                    <input type="text" value="${escapeHtml(filter.keyword)}" placeholder="搜索商品..."
                           style="width:100%;padding:6px 8px 6px 28px;border:1px solid #e0e0e0;border-radius:6px;font-size:12px;box-sizing:border-box;"
                           oninput="ui._onInvSearch(this.value)" />
                </div>
                <select style="padding:6px 8px;border:1px solid #e0e0e0;border-radius:6px;font-size:12px;background:#fff;"
                        onchange="ui._onInvCategoryFilter(this.value)">
                    ${categories.map(c => `<option value="${c.id}" ${filter.category===c.id?'selected':''}>${c.name}</option>`).join('')}
                </select>
            </div>
            <!-- 排序栏 -->
            <div style="display:flex;gap:4px;margin-bottom:8px;font-size:11px;overflow-x:auto;">
                ${[
                    {k:'quantity',n:'按数量'},
                    {k:'value',n:'按货值'},
                    {k:'name',n:'按名称'},
                    {k:'age',n:'按库龄'},
                    {k:'cost',n:'按成本'}
                ].map(s => `
                    <button style="padding:4px 8px;border:1px solid ${filter.sortBy===s.k?'#1976d2':'#e0e0e0'};border-radius:4px;background:${filter.sortBy===s.k?'#e3f2fd':'#fff'};color:${filter.sortBy===s.k?'#1976d2':'#666'};white-space:nowrap;cursor:pointer;"
                            onclick="ui._onInvSort('${s.k}')">
                        ${s.n}${filter.sortBy===s.k?(filter.sortDir==='desc'?'↓':'↑'):''}
                    </button>
                `).join('')}
            </div>
            <!-- 库存统计 -->
            <div style="font-size:11px;color:#666;margin-bottom:6px;">共 ${invList.length} 种商品，合计 ${gameState.getUsedCapacity()} 件</div>
            <!-- 库存列表 -->
            <div style="display:flex;flex-direction:column;gap:6px;">
                ${invList.length === 0 ? `
                    <div style="text-align:center;padding:30px 20px;color:#999;">
                        <div style="font-size:36px;">📦</div>
                        <div style="margin-top:8px;">暂无库存</div>
                        <div style="font-size:11px;margin-top:4px;">去批发市场进货吧</div>
                    </div>
                ` : invList.map(item => this._renderInventoryItem(item)).join('')}
            </div>
        `;
    }

    _renderInventoryItem(item) {
        const prod = item.product;
        const stockColor = item.quantity === 0 ? '#f44336' : item.quantity <= 20 ? '#ff9800' : '#4caf50';
        const ageColor = item.ageDays > 30 ? '#f44336' : item.ageDays > 14 ? '#ff9800' : '#4caf50';
        return `
            <div style="background:#fff;border:1px solid #f0f0f0;border-radius:8px;padding:8px;cursor:pointer;display:flex;gap:8px;align-items:center;"
                 onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                 onclick="ui.showProductInventoryDetail('${item.productId}')">
                <div style="width:40px;height:40px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;background:${prod?.color||'#f5f5f5'}22;">
                    ${prod?.icon||'📦'}
                </div>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.productName)}</div>
                    <div style="font-size:10px;color:#888;margin-top:2px;display:flex;gap:8px;">
                        <span>成本¥${item.avgCost}</span>
                        <span>库龄<span style="color:${ageColor};">${item.ageDays}天</span></span>
                    </div>
                </div>
                <div style="text-align:right;flex-shrink:0;">
                    <div style="font-size:14px;font-weight:700;color:${stockColor};">${item.quantity}</div>
                    <div style="font-size:10px;color:#888;">¥${item.totalValue.toLocaleString()}</div>
                </div>
                <div style="color:#ccc;font-size:16px;">›</div>
            </div>
        `;
    }

    _onInvSearch(val) {
        this._invFilter.keyword = val;
        this.showWarehouseModal('inventory');
        setTimeout(() => {
            const input = document.querySelector('input[placeholder="搜索商品..."]');
            if (input) { input.focus(); input.setSelectionRange(val.length, val.length); }
        }, 50);
    }

    _onInvCategoryFilter(val) {
        this._invFilter.category = val;
        this.showWarehouseModal('inventory');
    }

    _onInvSort(key) {
        if (this._invFilter.sortBy === key) {
            this._invFilter.sortDir = this._invFilter.sortDir === 'desc' ? 'asc' : 'desc';
        } else {
            this._invFilter.sortBy = key;
            this._invFilter.sortDir = 'desc';
        }
        this.showWarehouseModal('inventory');
    }

    // ==================== 新增：预警中心Tab ====================
    _renderWarehouseAlerts(alerts) {
        if (alerts.length === 0) {
            return `
                <div style="text-align:center;padding:40px 20px;">
                    <div style="font-size:48px;">✅</div>
                    <div style="font-size:14px;color:#4caf50;font-weight:700;margin-top:12px;">库存健康，无预警项</div>
                    <div style="font-size:11px;color:#888;margin-top:6px;">继续保持良好的库存管理习惯</div>
                </div>
            `;
        }

        return `
            <div style="margin-bottom:10px;">
                <div style="font-size:12px;color:#666;">共 ${alerts.length} 项预警需要处理</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;">
                ${alerts.map(a => {
                    if (a.material) {
                        return `
                            <div style="background:#fff3e0;border-left:3px solid ${a.level==='critical'?'#f44336':'#ff9800'};border-radius:0 6px 6px 0;padding:8px 10px;display:flex;align-items:center;gap:8px;">
                                <span style="font-size:20px;">${a.icon}</span>
                                <div style="flex:1;">
                                    <div style="font-size:12px;font-weight:600;">${a.name}库存不足</div>
                                    <div style="font-size:10px;color:#888;">当前: ${a.quantity}${a.unit}，建议补充至${a.threshold}${a.unit}以上</div>
                                </div>
                                <button class="btn btn-primary" style="padding:4px 10px;font-size:11px;"
                                        onclick="ui.closeModal();ui.showPackagingMaterialModal();">去采购</button>
                            </div>
                        `;
                    }
                    const levelColor = a.color || '#ff9800';
                    return `
                        <div style="background:#fff;border-left:3px solid ${levelColor};border-radius:0 6px 6px 0;padding:8px 10px;display:flex;align-items:center;gap:8px;cursor:pointer;"
                             onclick="ui.showProductInventoryDetail('${a.productId}')">
                            <span style="font-size:18px;">${a.icon}</span>
                            <div style="flex:1;min-width:0;">
                                <div style="font-size:12px;font-weight:600;">${escapeHtml(a.productName)}</div>
                                <div style="font-size:10px;color:#888;">
                                    ${a.type === 'outOfStock' ? '已缺货，请及时补货' : 
                                      a.type === 'lowStock' ? `库存仅剩${a.quantity}件` :
                                      a.type === 'slowMoving' ? `库龄${a.ageDays}天滞销中` : '超储'}
                                </div>
                            </div>
                            <div style="font-size:14px;font-weight:700;color:${levelColor};">${a.quantity}</div>
                            <span style="color:#ccc;">›</span>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    // ==================== 新增：设置Tab（原搬仓+盘点+阈值设置） ====================
    _renderWarehouseSettings(state, s) {
        const threshold = state.warehouse.lowStockThreshold || 20;
        return `
            <!-- 仓库升级卡片 -->
            <div style="background:linear-gradient(135deg,#e3f2fd,#bbdefb);border-radius:10px;padding:12px;margin-bottom:10px;">
                <div style="display:flex;align-items:center;gap:10px;">
                    <div style="font-size:32px;">🏭</div>
                    <div style="flex:1;">
                        <div style="font-weight:700;font-size:13px;">Lv.${s.warehouseLevel} ${s.warehouseLevelInfo?.name||''}</div>
                        <div style="font-size:11px;color:#666;margin-top:2px;">容量 ${gameState.getUsedCapacity()}/${gameState.getWarehouseCapacity()} · ${s.cityInfo.icon}${s.cityInfo.name}</div>
                    </div>
                </div>
                ${s.upgradeCost > 0 ? `
                    <button class="btn btn-primary btn-block" style="margin-top:8px;background:linear-gradient(135deg,#1976d2,#1565c0);border:none;"
                            onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                            onclick="ui.upgradeWarehouse()">
                        升级仓库 → Lv.${s.warehouseLevel+1} (¥${s.upgradeCost.toLocaleString()})
                    </button>
                ` : `<div style="text-align:center;margin-top:8px;color:#1976d2;font-size:12px;font-weight:600;">✨ 已达最高等级</div>`}
            </div>

            <!-- 低库存阈值设置 -->
            <div style="background:#fff;border:1px solid #f0f0f0;border-radius:8px;padding:10px;margin-bottom:10px;">
                <div style="font-weight:700;font-size:12px;margin-bottom:8px;">⚙️ 低库存预警阈值</div>
                <div style="display:flex;align-items:center;gap:8px;">
                    <span style="font-size:11px;color:#666;">当商品库存≤</span>
                    <input type="number" value="${threshold}" min="1" max="200"
                           style="width:60px;padding:4px 6px;border:1px solid #ddd;border-radius:4px;font-size:12px;text-align:center;"
                           onchange="ui._updateStockThreshold(this.value)" />
                    <span style="font-size:11px;color:#666;">件时预警</span>
                </div>
            </div>

            <!-- 搬仓迁移 -->
            ${this._renderWarehouseMove(s.cityInfo, s.warehouseUsed, s.totalValue)}

            <!-- 库存盘点 -->
            ${this._renderWarehouseCheckSimple(state)}
        `;
    }

    _renderWarehouseCheckSimple(state) {
        const logs = (state.warehouse.logs || []);
        const checks = logs.filter(l => l.type === 'check');
        const last = checks[0];
        return `
            <div style="background:#fff8e1;border-radius:8px;padding:10px;margin-top:10px;">
                <div style="font-weight:700;font-size:12px;margin-bottom:6px;">📦 库存盘点</div>
                <div style="font-size:11px;color:#7a4d00;line-height:1.5;margin-bottom:8px;">
                    每日可盘点一次，系统会模拟真实仓库误差（-1%~+0.5%），盘盈盘亏自动计入财务。
                </div>
                <button class="btn btn-primary btn-block" style="background:linear-gradient(135deg,#ff9800,#ff6b35);border:none;font-size:12px;"
                        onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                        onclick="ui.doWarehouseCheck()">
                    📋 立即盘点
                </button>
                ${last ? `
                    <div style="margin-top:8px;font-size:10px;color:#666;">
                        上次盘点(第${last.day}天): ${last.financeNote||''}
                    </div>
                ` : ''}
            </div>
        `;
    }

    _updateStockThreshold(val) {
        const n = Math.max(1, parseInt(val) || 20);
        gameState.setLowStockThreshold(n);
        this.showToast(`预警阈值已设置为 ${n} 件`);
        this.showWarehouseModal('settings');
    }

    // ==================== 新增：商品库存详情弹窗 ====================
    showProductInventoryDetail(productId) {
        this._selectedProductId = productId;
        this._renderProductInventoryDetail();
    }

    _renderProductInventoryDetail() {
        const detail = gameState.getProductInventoryDetail(this._selectedProductId);
        if (!detail) { this.closeModal(); return; }
        const prod = detail.product;

        const content = `
            <div style="padding:0;">
                <!-- 头部商品信息 -->
                <div style="background:linear-gradient(135deg,#1976d2,#42a5f5);color:#fff;padding:14px;border-radius:8px;margin-bottom:10px;">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <div style="width:50px;height:50px;border-radius:8px;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;font-size:28px;">
                            ${prod?.icon||'📦'}
                        </div>
                        <div style="flex:1;">
                            <div style="font-weight:700;font-size:14px;">${escapeHtml(detail.productName)}</div>
                            <div style="font-size:11px;opacity:0.8;margin-top:2px;">${prod?.category||''} · ID: ${detail.productId}</div>
                        </div>
                    </div>
                </div>

                <!-- 库存数据卡片 -->
                <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:10px;">
                    <div style="background:#f5f5f5;border-radius:8px;padding:10px;text-align:center;">
                        <div style="font-size:20px;font-weight:700;color:#1976d2;">${detail.totalQuantity}</div>
                        <div style="font-size:10px;color:#666;">当前库存(件)</div>
                    </div>
                    <div style="background:#f5f5f5;border-radius:8px;padding:10px;text-align:center;">
                        <div style="font-size:20px;font-weight:700;color:#4caf50;">¥${detail.avgCost}</div>
                        <div style="font-size:10px;color:#666;">平均成本</div>
                    </div>
                    <div style="background:#f5f5f5;border-radius:8px;padding:10px;text-align:center;">
                        <div style="font-size:20px;font-weight:700;color:#ff9800;">${detail.ageDays}天</div>
                        <div style="font-size:10px;color:#666;">库龄</div>
                    </div>
                    <div style="background:#f5f5f5;border-radius:8px;padding:10px;text-align:center;">
                        <div style="font-size:20px;font-weight:700;color:#9c27b0;">¥${detail.totalValue.toLocaleString()}</div>
                        <div style="font-size:10px;color:#666;">库存货值</div>
                    </div>
                </div>

                <!-- 批次信息 -->
                <div style="margin-bottom:10px;">
                    <div style="font-weight:700;font-size:12px;margin-bottom:6px;">📦 批次明细 (${detail.batchCount}批)</div>
                    <div style="max-height:100px;overflow-y:auto;">
                        ${detail.batches.map((b, i) => `
                            <div style="display:flex;justify-content:space-between;font-size:11px;padding:6px 8px;background:${i%2?'#fafafa':'#fff'};border-radius:4px;">
                                <span>批次${i+1} · 第${b.purchaseDay||'?'}天入库</span>
                                <span>×${b.quantity} · ¥${b.costPrice||0}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <!-- 库存操作 -->
                <div style="display:flex;gap:6px;margin-bottom:10px;">
                    <button style="flex:1;padding:8px;background:#e3f2fd;border:1px solid #90caf9;border-radius:6px;font-size:12px;cursor:pointer;color:#1976d2;"
                            onclick="ui.showInvAdjustModal('${detail.productId}', 1)">➕ 盘盈</button>
                    <button style="flex:1;padding:8px;background:#ffebee;border:1px solid #ef9a9a;border-radius:6px;font-size:12px;cursor:pointer;color:#c62828;"
                            onclick="ui.showInvAdjustModal('${detail.productId}', -1)">➖ 盘亏</button>
                    <button style="flex:1;padding:8px;background:#e8f5e9;border:1px solid #a5d6a7;border-radius:6px;font-size:12px;cursor:pointer;color:#2e7d32;"
                            onclick="ui.closeModal();ui.showMarketModal();">🛒 补货</button>
                </div>

                <!-- 出入库记录 -->
                <div>
                    <div style="font-weight:700;font-size:12px;margin-bottom:6px;">📋 最近出入库记录</div>
                    <div style="max-height:120px;overflow-y:auto;">
                        ${detail.logs.length === 0 ? `<div style="font-size:11px;color:#999;text-align:center;padding:10px;">暂无记录</div>` :
                            detail.logs.slice(0, 20).map(l => `
                                <div style="display:flex;justify-content:space-between;font-size:10px;padding:5px 8px;background:#fafafa;border-radius:4px;margin-bottom:2px;">
                                    <span>第${l.day}天 · ${l.type==='inbound'?'📥入库':l.type==='outbound'?'📤出库':l.type==='adjust'?'🔧调整':l.type}</span>
                                    <span style="color:${(l.quantity||0)>0?'#4caf50':'#f44336'};font-weight:600;">
                                        ${(l.quantity||0)>0?'+':''}${l.quantity||0}
                                    </span>
                                </div>
                            `).join('')}
                    </div>
                </div>
            </div>
        `;
        const footer = `
            <button class="btn btn-secondary" onclick="ui.showWarehouseModal('inventory')">← 返回</button>
        `;
        this.showModal(escapeHtml(detail.productName), content, footer);
    }

    showInvAdjustModal(productId, sign) {
        const isAdd = sign > 0;
        const prod = getProductById(productId);
        const content = `
            <div style="padding:10px 0;text-align:center;">
                <div style="font-size:36px;margin-bottom:8px;">${isAdd?'📥':'📤'}</div>
                <div style="font-weight:700;font-size:14px;margin-bottom:12px;">${isAdd?'盘盈（增加库存）':'盘亏（减少库存）'}</div>
                <div style="font-size:12px;color:#666;margin-bottom:12px;">${escapeHtml(prod?.name||productId)}</div>
                <div style="margin-bottom:12px;">
                    <input type="number" id="adjQty" value="1" min="1" 
                           style="width:100px;padding:8px;text-align:center;border:2px solid #1976d2;border-radius:8px;font-size:16px;font-weight:700;" />
                </div>
                <input type="text" id="adjReason" placeholder="原因备注（可选）"
                       style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:12px;box-sizing:border-box;" />
            </div>
        `;
        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>
            <button class="btn btn-primary" onclick="ui.confirmInvAdjust('${productId}', ${sign})">确认${isAdd?'盘盈':'盘亏'}</button>
        `;
        this.showModal(isAdd?'盘盈登记':'盘亏登记', content, footer);
    }

    confirmInvAdjust(productId, sign) {
        const qty = parseInt(document.getElementById('adjQty')?.value) || 0;
        const reason = document.getElementById('adjReason')?.value?.trim() || (sign > 0 ? '盘盈调整' : '盘亏调整');
        if (qty <= 0) { this.showToast('请输入有效数量'); return; }
        
        const result = gameState.adjustInventory(productId, qty * sign, reason);
        if (result.success) {
            this.closeModal();
            this.showToast('✅ ' + result.message);
            setTimeout(() => this.showProductInventoryDetail(productId), 100);
        } else {
            this.showToast('❌ ' + result.message);
        }
    }

    upgradeWarehouse() {
        const r = gameState.upgradeWarehouse();
        if (r.success) {
            this.showToast(`✅ 仓库升级成功 → Lv.${r.level}`);
            this.showWarehouseModal('overview');
        } else {
            this.showToast('❌ ' + (r.message || '升级失败'));
        }
    }

    showBankModal() {
        if (typeof bankUI !== 'undefined') {
            bankUI.showModal();
        } else {
            this.showToast('银行系统加载中...');
        }
    }

    switchBankTab(tab) {
        if (typeof bankUI !== 'undefined') {
            bankUI.switchTab(tab);
        }
    }

    doDeposit() {
        if (typeof bankUI !== 'undefined') {
            bankUI.doDeposit();
        }
    }

    doWithdraw() {
        if (typeof bankUI !== 'undefined') {
            bankUI.doWithdraw();
        }
    }

    showFixedDepositModal(productId) {
        if (typeof bankUI !== 'undefined') {
            bankUI.showFixedDepositModal(productId);
        }
    }

    confirmFixedDeposit(productId) {
        if (typeof bankUI !== 'undefined') {
            bankUI.confirmFixedDeposit(productId);
        }
    }

    confirmEarlyWithdraw(depositId) {
        if (typeof bankUI !== 'undefined') {
            bankUI.confirmEarlyWithdraw(depositId);
        }
    }

    showLoanModal(productId) {
        if (typeof bankUI !== 'undefined') {
            bankUI.showLoanModal(productId);
        }
    }

    confirmLoan(productId) {
        if (typeof bankUI !== 'undefined') {
            bankUI.confirmLoan(productId);
        }
    }

    repayLoan(loanId, amount) {
        if (typeof bankUI !== 'undefined') {
            bankUI.repayLoan(loanId);
        }
    }

    showPromotionModal() {
        const state = gameState.state;
        const promotions = state.promotions || { active: [], history: [] };
        const activeCount = promotions.active?.length || 0;

        const content = `
            <div style="text-align:center;padding:15px 0;">
                <div style="font-size:48px;margin-bottom:10px;">🎊</div>
                <div style="font-size:18px;font-weight:bold;color:#333;">促销活动</div>
                <div style="font-size:13px;color:#999;margin-top:5px;">创建促销活动，提升销量</div>
            </div>
            <div style="margin:15px 0;">
                <div style="font-size:14px;font-weight:bold;margin-bottom:10px;color:#333;">
                    进行中的活动 (${activeCount})
                </div>
                ${activeCount === 0 ? `
                    <div style="text-align:center;padding:20px;color:#999;font-size:13px;background:#fafafa;border-radius:8px;">
                        暂无进行中的促销活动
                    </div>
                ` : promotions.active.map(p => `
                    <div style="padding:10px;border:1px solid #eee;border-radius:8px;margin-bottom:8px;">
                        <div style="font-weight:bold;font-size:14px;">${p.name}</div>
                        <div style="font-size:12px;color:#999;margin-top:4px;">${p.description || ''}</div>
                    </div>
                `).join('')}
            </div>
            <div style="font-size:13px;color:#666;line-height:1.8;">
                <div style="font-weight:bold;margin-bottom:8px;color:#333;">促销类型:</div>
                <div>• 限时折扣</div>
                <div>• 满减活动</div>
                <div>• 买一送一</div>
                <div>• 秒杀活动</div>
            </div>
        `;

        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>
            <button class="btn btn-primary" onclick="ui.closeModal();ui.openPromoCreateFromHome();">创建活动</button>
        `;

        this.showModal('促销活动', content, footer);
    }

    openPromoCreateFromHome() {
        this.currentTab = this.currentTab || {};
        this.currentTab.marketing = 'promo_activities';
        this._promoSubTab = 'create';
        this._editingPromoId = null;
        this.currentPage = 'marketing';
        try { this.render(); } catch (e) { console.warn('[openPromoCreateFromHome]', e); }
    }

    _startLiveDanmakuUpdate() {
        this._stopLiveDanmakuUpdate();
        const tick = () => {
            try {
                const overlay = document.getElementById('liveCenterModal')
                    || Array.from(document.querySelectorAll('.modal-overlay')).find(el => {
                        const t = el.querySelector('.modal-title');
                        return t && String(t.textContent || '').indexOf('直播') >= 0;
                    });
                if (!overlay) {
                    this._stopLiveDanmakuUpdate();
                    return;
                }
                if (typeof liveUI !== 'undefined' && liveUI.updateDanmakus) liveUI.updateDanmakus();
                const viewersEl = overlay.querySelector('[data-live-viewers]');
                if (viewersEl && typeof liveState !== 'undefined' && liveState.getState) {
                    const st = liveState.getState();
                    if (st && st.isLive) viewersEl.textContent = String(st.viewers || 0);
                }
            } catch (_) {}
        };
        this._liveDanmakuTimer = setInterval(tick, 2500);
    }

    _stopLiveDanmakuUpdate() {
        if (this._liveDanmakuTimer) {
            clearInterval(this._liveDanmakuTimer);
            this._liveDanmakuTimer = null;
        }
    }

    showLivestreamModal() {
        // 使用新的直播中心系统
        if (typeof liveUI !== 'undefined' && typeof liveEngine !== 'undefined') {
            // 确保liveEngine和liveUI已初始化
            if (!this._liveModulesInitialized) {
                try {
                    if (typeof liveState !== 'undefined' && typeof liveState.init === 'function') {
                        liveState.init(gameState);
                    }
                } catch (e) { console.warn('[LiveState] init', e); }
                if (typeof liveEngine.init === 'function') {
                    liveEngine.init(gameState, this);
                }
                if (typeof liveUI.init === 'function') {
                    liveUI.init(gameState, this);
                }
                this._liveModulesInitialized = true;
                console.log('[UIManager] 直播模块初始化完成');
            }
            // 显示新直播中心
            liveUI.showLiveCenter();
            try { this._startLiveDanmakuUpdate(); } catch (_) {}
        } else {
            // 回退到旧版直播
            this._liveTab = this._liveTab || 'overview';
            this.renderLivestreamModal();
        }
    }

    renderLivestreamModal() {
        const state = gameState.state;
        const livestream = state.livestream || { isLive: false, viewers: 0, totalSales: 0 };
        const tab = this._liveTab;

        const tabs = [
            { id: 'overview', name: '概览', icon: '🏠' },
            { id: 'create', name: '创建直播', icon: '🎬' },
            { id: 'settings', name: '直播设置', icon: '⚙️' },
            { id: 'data', name: '数据中心', icon: '📊' }
        ];

        let tabContent = '';
        switch (tab) {
            case 'overview':
                tabContent = this.renderLiveOverviewTab(livestream);
                break;
            case 'create':
                tabContent = this.renderLiveCreateTab(livestream);
                break;
            case 'settings':
                tabContent = this.renderLiveSettingsTab(livestream);
                break;
            case 'data':
                tabContent = this.renderLiveDataTab(livestream);
                break;
        }

        const content = `
            <div style="margin-bottom:15px;">
                <div style="display:flex;background:#f5f5f5;border-radius:8px;padding:4px;">
                    ${tabs.map(t => `
                        <div style="flex:1;text-align:center;padding:8px 4px;border-radius:6px;cursor:pointer;
                                    font-size:13px;${tab === t.id ? 'background:#fff;color:#ff6b35;font-weight:bold;box-shadow:0 1px 3px rgba(0,0,0,0.1);' : 'color:#666;'}"
                             onclick="ui.switchLiveTab('${t.id}')">
                            <div style="font-size:18px;margin-bottom:2px;">${t.icon}</div>
                            <div>${t.name}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
            ${tabContent}
        `;

        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>
            ${livestream.isLive ? `
                <button class="btn btn-danger" onclick="ui.endLiveStream()">结束直播</button>
            ` : `
                <button class="btn btn-primary" onclick="ui.switchLiveTab('create')">创建直播</button>
            `}
        `;

        // 优先查找标题为"直播中心"的弹窗进行内容更新，找不到则新建
        const allOverlays = document.querySelectorAll('.modal-overlay');
        let existingModal = null;
        for (let i = allOverlays.length - 1; i >= 0; i--) {
            const titleEl = allOverlays[i].querySelector('.modal-title');
            if (titleEl && titleEl.textContent === '直播中心') {
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
            if (modalTitle) modalTitle.textContent = '直播中心';
        } else {
            this.showModal('直播中心', content, footer);
        }
    }

    switchLiveTab(tabId) {
        this._liveTab = tabId;
        this.renderLivestreamModal();
    }

    renderLiveOverviewTab(livestream) {
        if (livestream.isLive) {
            const streamer = livestream.streamer || {};
            const progress = Math.min(100, (livestream.duration / (livestream.plannedDuration || 4)) * 100);
            return `
                <div style="text-align:center;padding:10px 0;">
                    <div style="display:inline-block;position:relative;">
                        <div style="font-size:56px;">${streamer.icon || '🎥'}</div>
                        <div style="position:absolute;top:-5px;right:-10px;background:#f44336;color:#fff;
                                    font-size:10px;padding:2px 6px;border-radius:10px;animation:pulse 1s infinite;">
                            🔴 LIVE
                        </div>
                    </div>
                    <div style="font-size:18px;font-weight:bold;color:#333;margin-top:8px;">${streamer.name || '直播中'}</div>
                    <div style="font-size:12px;color:#f44336;margin-top:4px;">正在直播</div>
                </div>
                <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin:15px 0;">
                    <div style="text-align:center;padding:12px;background:#e3f2fd;border-radius:10px;">
                        <div style="font-size:22px;font-weight:bold;color:#2196f3;">${livestream.viewers || 0}</div>
                        <div style="font-size:11px;color:#999;margin-top:2px;">当前观看</div>
                    </div>
                    <div style="text-align:center;padding:12px;background:#fff3e0;border-radius:10px;">
                        <div style="font-size:22px;font-weight:bold;color:#ff9800;">${livestream.peakViewers || 0}</div>
                        <div style="font-size:11px;color:#999;margin-top:2px;">峰值人数</div>
                    </div>
                    <div style="text-align:center;padding:12px;background:#e8f5e9;border-radius:10px;">
                        <div style="font-size:22px;font-weight:bold;color:#4caf50;">¥${formatMoney(livestream.totalSales || 0)}</div>
                        <div style="font-size:11px;color:#999;margin-top:2px;">直播销售额</div>
                    </div>
                    <div style="text-align:center;padding:12px;background:#f3e5f5;border-radius:10px;">
                        <div style="font-size:22px;font-weight:bold;color:#9c27b0;">${livestream.orderCount || 0}</div>
                        <div style="font-size:11px;color:#999;margin-top:2px;">订单数</div>
                    </div>
                </div>
                <div style="margin-top:10px;">
                    <div style="display:flex;justify-content:space-between;font-size:12px;color:#666;margin-bottom:6px;">
                        <span>直播进度</span>
                        <span>${livestream.duration || 0} / ${livestream.plannedDuration || 4} 小时</span>
                    </div>
                    <div style="height:8px;background:#eee;border-radius:4px;overflow:hidden;">
                        <div style="height:100%;width:${progress}%;background:linear-gradient(90deg,#ff6b35,#ff9800);border-radius:4px;"></div>
                    </div>
                </div>
                ${livestream.settings?.showDiscount ? `
                    <div style="margin-top:12px;padding:10px;background:#fff3e0;border-radius:8px;font-size:12px;color:#e65100;">
                        🎁 直播间专属折扣：${Math.round((1 - (livestream.settings.discountRate || 0.9)) * 100)}% OFF
                    </div>
                ` : ''}
            `;
        } else {
            const history = livestream.history || [];
            const recentLive = history[0];
            const totalLiveCount = history.length;
            const totalSales = history.reduce((sum, h) => sum + (h.totalSales || 0), 0);
            const totalOrders = history.reduce((sum, h) => sum + (h.orderCount || 0), 0);

            return `
                <div style="text-align:center;padding:15px 0;">
                    <div style="font-size:56px;margin-bottom:10px;">🎥</div>
                    <div style="font-size:18px;font-weight:bold;color:#333;">直播中心</div>
                    <div style="font-size:13px;color:#999;margin-top:5px;">⏸️ 未开播</div>
                </div>
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:15px 0;">
                    <div style="text-align:center;padding:10px;background:#f5f5f5;border-radius:10px;">
                        <div style="font-size:18px;font-weight:bold;color:#333;">${totalLiveCount}</div>
                        <div style="font-size:11px;color:#999;margin-top:2px;">累计场次</div>
                    </div>
                    <div style="text-align:center;padding:10px;background:#f5f5f5;border-radius:10px;">
                        <div style="font-size:18px;font-weight:bold;color:#ff6b35;">¥${formatMoney(totalSales)}</div>
                        <div style="font-size:11px;color:#999;margin-top:2px;">总销售额</div>
                    </div>
                    <div style="text-align:center;padding:10px;background:#f5f5f5;border-radius:10px;">
                        <div style="font-size:18px;font-weight:bold;color:#4caf50;">${totalOrders}</div>
                        <div style="font-size:11px;color:#999;margin-top:2px;">总订单</div>
                    </div>
                </div>
                ${recentLive ? `
                    <div style="margin-top:10px;padding:12px;background:#f9f9f9;border-radius:10px;">
                        <div style="font-size:13px;font-weight:bold;color:#333;margin-bottom:8px;">📺 最近一场直播</div>
                        <div style="display:flex;align-items:center;">
                            <div style="font-size:28px;margin-right:10px;">${recentLive.streamer?.icon || '🎤'}</div>
                            <div style="flex:1;">
                                <div style="font-size:13px;font-weight:bold;">${recentLive.streamer?.name || '未知主播'}</div>
                                <div style="font-size:11px;color:#999;margin-top:2px;">
                                    时长 ${recentLive.duration || 0}h · 峰值 ${recentLive.peakViewers || 0}人
                                </div>
                            </div>
                            <div style="text-align:right;">
                                <div style="font-size:13px;font-weight:bold;color:#ff6b35;">¥${formatMoney(recentLive.totalSales || 0)}</div>
                                <div style="font-size:10px;color:#999;">销售额</div>
                            </div>
                        </div>
                    </div>
                ` : `
                    <div style="text-align:center;padding:20px;color:#999;font-size:12px;background:#fafafa;border-radius:8px;">
                        还没有直播记录，开始你的第一场直播吧！
                    </div>
                `}
            `;
        }
    }

    renderLiveCreateTab(livestream) {
        if (livestream.isLive) {
            return `
                <div style="text-align:center;padding:40px 20px;color:#999;">
                    <div style="font-size:48px;margin-bottom:10px;">🔴</div>
                    <div style="font-size:14px;">直播进行中，无法创建新直播</div>
                    <div style="font-size:12px;margin-top:5px;">请先结束当前直播</div>
                </div>
            `;
        }

        const selectedStreamer = this._liveCreateData?.streamerId || 'mid';
        const selectedDuration = this._liveCreateData?.duration || 4;
        const selectedProducts = this._liveCreateData?.productIds || [];
        const streamer = STREAMER_TYPES.find(s => s.id === selectedStreamer);
        const totalCost = streamer ? streamer.costPerHour * selectedDuration : 0;

        const activeListings = gameState.state.listings.filter(l => l.status === 'active');

        return `
            <div style="max-height:400px;overflow-y:auto;padding-right:5px;">
                <div style="margin-bottom:15px;">
                    <div style="font-size:14px;font-weight:bold;color:#333;margin-bottom:10px;">🎤 选择主播</div>
                    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">
                        ${STREAMER_TYPES.map(s => `
                            <div style="padding:10px;border:2px solid ${selectedStreamer === s.id ? '#ff6b35' : '#eee'};
                                        border-radius:10px;cursor:pointer;background:${selectedStreamer === s.id ? '#fff5f0' : '#fff'};"
                                 onclick="ui.selectLiveStreamer('${s.id}')">
                                <div style="display:flex;align-items:center;">
                                    <div style="font-size:28px;margin-right:8px;">${s.icon}</div>
                                    <div style="flex:1;">
                                        <div style="font-size:13px;font-weight:bold;">${s.name}</div>
                                        <div style="font-size:10px;color:#999;margin-top:2px;">${s.description}</div>
                                    </div>
                                </div>
                                <div style="display:flex;justify-content:space-between;font-size:11px;color:#666;margin-top:6px;">
                                    <span>粉丝: ${s.baseFans >= 10000 ? (s.baseFans/10000) + '万' : s.baseFans}</span>
                                    <span style="color:#ff6b35;font-weight:bold;">
                                        ${s.costPerHour === 0 ? '免费' : '¥' + s.costPerHour + '/h'}
                                    </span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <div style="margin-bottom:15px;">
                    <div style="font-size:14px;font-weight:bold;color:#333;margin-bottom:10px;">⏰ 直播时长</div>
                    <div style="display:flex;gap:8px;">
                        ${[2, 4, 6, 8].map(h => `
                            <div style="flex:1;text-align:center;padding:10px;border:2px solid ${selectedDuration === h ? '#ff6b35' : '#eee'};
                                        border-radius:8px;cursor:pointer;background:${selectedDuration === h ? '#fff5f0' : '#fff'};"
                                 onclick="ui.selectLiveDuration(${h})">
                                <div style="font-size:16px;font-weight:bold;color:${selectedDuration === h ? '#ff6b35' : '#333'};">${h}h</div>
                                <div style="font-size:10px;color:#999;margin-top:2px;">${h}小时</div>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <div style="margin-bottom:15px;">
                    <div style="font-size:14px;font-weight:bold;color:#333;margin-bottom:10px;">
                        🛍️ 直播选品 <span style="font-size:11px;color:#999;font-weight:normal;">(可选，不选则推荐全部商品)</span>
                    </div>
                    ${activeListings.length === 0 ? `
                        <div style="text-align:center;padding:15px;color:#999;font-size:12px;background:#fafafa;border-radius:8px;">
                            暂无上架商品，请先上架商品
                        </div>
                    ` : `
                        <div style="max-height:150px;overflow-y:auto;border:1px solid #eee;border-radius:8px;">
                            ${activeListings.slice(0, 10).map(listing => {
                                const product = PRODUCTS.find(p => p.id === listing.productId);
                                const isSelected = selectedProducts.includes(listing.productId);
                                return `
                                    <div style="display:flex;align-items:center;padding:8px 10px;border-bottom:1px solid #f0f0f0;cursor:pointer;"
                                             onclick="ui.toggleLiveProduct('${listing.productId}')">
                                        <div style="width:18px;height:18px;border:2px solid ${isSelected ? '#ff6b35' : '#ccc'};
                                                    border-radius:4px;margin-right:10px;display:flex;align-items:center;justify-content:center;
                                                    background:${isSelected ? '#ff6b35' : '#fff'};">
                                            ${isSelected ? '<span style="color:#fff;font-size:12px;">✓</span>' : ''}
                                        </div>
                                        <div style="font-size:24px;margin-right:8px;">${product?.icon || '📦'}</div>
                                        <div style="flex:1;">
                                            <div style="font-size:12px;font-weight:bold;">${listing.title}</div>
                                            <div style="font-size:10px;color:#999;">¥${formatMoney(listing.price)}</div>
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                        <div style="font-size:11px;color:#999;margin-top:5px;">
                            已选 ${selectedProducts.length} 件商品
                        </div>
                    `}
                </div>

                <div style="padding:12px;background:#f9f9f9;border-radius:10px;">
                    <div style="font-size:13px;font-weight:bold;color:#333;margin-bottom:8px;">💰 费用明细</div>
                    <div style="display:flex;justify-content:space-between;font-size:12px;color:#666;margin-bottom:4px;">
                        <span>主播费用</span>
                        <span>${streamer?.costPerHour === 0 ? '免费' : '¥' + streamer?.costPerHour + '/h × ' + selectedDuration + 'h'}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:bold;color:#ff6b35;margin-top:8px;padding-top:8px;border-top:1px solid #eee;">
                        <span>预计总费用</span>
                        <span>¥${formatMoney(totalCost)}</span>
                    </div>
                </div>
            </div>
            <div style="margin-top:15px;">
                <button class="btn btn-primary" style="width:100%;" onclick="ui.startLiveStream()">
                    🎬 开始直播
                </button>
            </div>
        `;
    }

    renderLiveSettingsTab(livestream) {
        const settings = livestream.settings || { autoEnd: true, showDiscount: true, discountRate: 0.9 };
        const discountRate = this._liveSettingsData?.discountRate ?? settings.discountRate ?? 0.9;

        return `
            <div style="padding:5px 0;">
                <div style="margin-bottom:20px;">
                    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid #f0f0f0;">
                        <div style="flex:1;">
                            <div style="font-size:14px;font-weight:bold;color:#333;">自动结束直播</div>
                            <div style="font-size:11px;color:#999;margin-top:2px;">达到设定时长后自动结束直播</div>
                        </div>
                        <div style="width:44px;height:24px;border-radius:12px;cursor:pointer;position:relative;
                                    background:${settings.autoEnd ? '#ff6b35' : '#ccc'};"
                             onclick="ui.toggleLiveSetting('autoEnd')">
                            <div style="position:absolute;top:2px;left:${settings.autoEnd ? '22px' : '2px'};
                                        width:20px;height:20px;background:#fff;border-radius:50%;transition:left 0.2s;"></div>
                        </div>
                    </div>
                </div>

                <div style="margin-bottom:20px;">
                    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid #f0f0f0;">
                        <div style="flex:1;">
                            <div style="font-size:14px;font-weight:bold;color:#333;">直播间专属折扣</div>
                            <div style="font-size:11px;color:#999;margin-top:2px;">开启后直播期间商品享专属折扣，提升转化率</div>
                        </div>
                        <div style="width:44px;height:24px;border-radius:12px;cursor:pointer;position:relative;
                                    background:${settings.showDiscount ? '#ff6b35' : '#ccc'};"
                             onclick="ui.toggleLiveSetting('showDiscount')">
                            <div style="position:absolute;top:2px;left:${settings.showDiscount ? '22px' : '2px'};
                                        width:20px;height:20px;background:#fff;border-radius:50%;transition:left 0.2s;"></div>
                        </div>
                    </div>
                </div>

                ${settings.showDiscount ? `
                    <div style="margin-bottom:20px;padding:15px;background:#fff5f0;border-radius:10px;">
                        <div style="font-size:14px;font-weight:bold;color:#333;margin-bottom:12px;">🎁 折扣力度</div>
                        <div style="display:flex;gap:8px;">
                            ${[
                                { rate: 0.95, label: '95折' },
                                { rate: 0.9, label: '9折' },
                                { rate: 0.85, label: '85折' },
                                { rate: 0.8, label: '8折' }
                            ].map(d => `
                                <div style="flex:1;text-align:center;padding:10px;border:2px solid ${discountRate === d.rate ? '#ff6b35' : '#ffd5c8'};
                                            border-radius:8px;cursor:pointer;background:${discountRate === d.rate ? '#ff6b35' : '#fff'};"
                                     onclick="ui.setLiveDiscount(${d.rate})">
                                    <div style="font-size:13px;font-weight:bold;color:${discountRate === d.rate ? '#fff' : '#ff6b35'};">${d.label}</div>
                                </div>
                            `).join('')}
                        </div>
                        <div style="font-size:11px;color:#999;margin-top:8px;">
                            💡 折扣越低，转化越高，但利润越少
                        </div>
                    </div>
                ` : ''}

                <div style="padding:12px;background:#f5f5f5;border-radius:10px;">
                    <div style="font-size:12px;color:#666;line-height:1.8;">
                        <div style="font-weight:bold;color:#333;margin-bottom:4px;">📝 直播说明</div>
                        <div>• 直播期间将获得额外流量加成</div>
                        <div>• 主播粉丝越多，观看人数越高</div>
                        <div>• 转化加成因主播能力而异</div>
                        <div>• 直播结束后数据自动保存</div>
                    </div>
                </div>
            </div>
        `;
    }

    renderLiveDataTab(livestream) {
        const history = livestream.history || [];

        if (history.length === 0) {
            return `
                <div style="text-align:center;padding:40px 20px;color:#999;">
                    <div style="font-size:48px;margin-bottom:10px;">📊</div>
                    <div style="font-size:14px;">暂无直播数据</div>
                    <div style="font-size:12px;margin-top:5px;">开始直播后，数据将在这里展示</div>
                </div>
            `;
        }

        const totalDuration = history.reduce((sum, h) => sum + (h.duration || 0), 0);
        const totalSales = history.reduce((sum, h) => sum + (h.totalSales || 0), 0);
        const totalOrders = history.reduce((sum, h) => sum + (h.orderCount || 0), 0);
        const totalPeakViewers = history.reduce((sum, h) => sum + (h.peakViewers || 0), 0);
        const avgViewers = history.length > 0 ? Math.floor(totalPeakViewers / history.length) : 0;

        return `
            <div style="padding:5px 0;">
                <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:15px;">
                    <div style="padding:12px;background:#e3f2fd;border-radius:10px;">
                        <div style="font-size:11px;color:#666;">累计场次</div>
                        <div style="font-size:20px;font-weight:bold;color:#2196f3;margin-top:4px;">${history.length} 场</div>
                    </div>
                    <div style="padding:12px;background:#fff3e0;border-radius:10px;">
                        <div style="font-size:11px;color:#666;">累计时长</div>
                        <div style="font-size:20px;font-weight:bold;color:#ff9800;margin-top:4px;">${totalDuration} h</div>
                    </div>
                    <div style="padding:12px;background:#e8f5e9;border-radius:10px;">
                        <div style="font-size:11px;color:#666;">总销售额</div>
                        <div style="font-size:20px;font-weight:bold;color:#4caf50;margin-top:4px;">¥${formatMoney(totalSales)}</div>
                    </div>
                    <div style="padding:12px;background:#f3e5f5;border-radius:10px;">
                        <div style="font-size:11px;color:#666;">总订单数</div>
                        <div style="font-size:20px;font-weight:bold;color:#9c27b0;margin-top:4px;">${totalOrders} 单</div>
                    </div>
                </div>

                <div style="margin-bottom:10px;">
                    <div style="font-size:14px;font-weight:bold;color:#333;margin-bottom:8px;">📋 直播记录</div>
                    <div style="max-height:300px;overflow-y:auto;">
                        ${history.slice(0, 20).map((record, idx) => `
                            <div style="padding:10px;border:1px solid #eee;border-radius:8px;margin-bottom:8px;">
                                <div style="display:flex;align-items:center;margin-bottom:8px;">
                                    <div style="font-size:24px;margin-right:8px;">${record.streamer?.icon || '🎤'}</div>
                                    <div style="flex:1;">
                                        <div style="font-size:13px;font-weight:bold;">${record.streamer?.name || '未知主播'}</div>
                                        <div style="font-size:10px;color:#999;">
                                            第${record.startTime?.day || '?'}天 ${(record.startTime?.hour ?? 0).toString().padStart(2, '0')}:00 开播
                                        </div>
                                    </div>
                                    <div style="text-align:right;">
                                        <div style="font-size:13px;font-weight:bold;color:#ff6b35;">¥${formatMoney(record.totalSales || 0)}</div>
                                        <div style="font-size:10px;color:#999;">${record.orderCount || 0}单</div>
                                    </div>
                                </div>
                                <div style="display:flex;gap:10px;font-size:11px;color:#666;">
                                    <span>⏱️ ${record.duration || 0}h</span>
                                    <span>👥 峰值 ${record.peakViewers || 0}</span>
                                    <span>📊 场均 ¥${record.duration > 0 ? formatMoney((record.totalSales || 0) / record.duration) : 0}/h</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    selectLiveStreamer(streamerId) {
        if (!this._liveCreateData) this._liveCreateData = { productIds: [] };
        this._liveCreateData.streamerId = streamerId;
        this.renderLivestreamModal();
    }

    selectLiveDuration(hours) {
        if (!this._liveCreateData) this._liveCreateData = { productIds: [] };
        this._liveCreateData.duration = hours;
        this.renderLivestreamModal();
    }

    toggleLiveProduct(productId) {
        if (!this._liveCreateData) this._liveCreateData = { productIds: [] };
        if (!this._liveCreateData.productIds) this._liveCreateData.productIds = [];
        
        const idx = this._liveCreateData.productIds.indexOf(productId);
        if (idx > -1) {
            this._liveCreateData.productIds.splice(idx, 1);
        } else {
            this._liveCreateData.productIds.push(productId);
        }
        this.renderLivestreamModal();
    }

    toggleLiveSetting(key) {
        const livestream = gameState.state.livestream;
        if (livestream.isLive) {
            this.showToast('直播中无法修改设置');
            return;
        }
        if (!livestream.settings) livestream.settings = { autoEnd: true, showDiscount: true, discountRate: 0.9 };
        livestream.settings[key] = !livestream.settings[key];
        gameState.notify();
        this.renderLivestreamModal();
    }

    setLiveDiscount(rate) {
        const livestream = gameState.state.livestream;
        if (livestream.isLive) {
            this.showToast('直播中无法修改折扣');
            return;
        }
        if (!livestream.settings) livestream.settings = { autoEnd: true, showDiscount: true, discountRate: 0.9 };
        livestream.settings.discountRate = rate;
        if (!this._liveSettingsData) this._liveSettingsData = {};
        this._liveSettingsData.discountRate = rate;
        gameState.notify();
        this.renderLivestreamModal();
    }

    startLiveStream() {
        if (!this._liveCreateData) {
            this._liveCreateData = { streamerId: 'mid', duration: 4, productIds: [] };
        }
        
        const streamerId = this._liveCreateData.streamerId || 'mid';
        const duration = this._liveCreateData.duration || 4;
        const productIds = this._liveCreateData.productIds || [];
        const settings = gameState.state.livestream.settings || { autoEnd: true, showDiscount: true, discountRate: 0.9 };

        const result = gameState.startLivestream(streamerId, productIds, duration, settings);
        if (result.success) {
            this.showToast('直播开始啦！');
            this._liveTab = 'overview';
            this.renderLivestreamModal();
        } else {
            this.showToast(result.message);
        }
    }

    endLiveStream() {
        const success = gameState.endLivestream();
        if (success) {
            this.showToast('直播已结束');
            this._liveTab = 'data';
            this.renderLivestreamModal();
        }
    }

    toggleLivestream() {
        const livestream = gameState.state.livestream;
        if (livestream.isLive) {
            this.endLiveStream();
        } else {
            this._liveTab = 'create';
            this.showLivestreamModal();
        }
    }

    showAttributeModal() {
            const state = gameState.state;
            const player = state.player || {
                attributePoints: 0,
                attributes: {
                    operation: 1,
                    selection: 1,
                    negotiation: 1,
                    management: 1,
                    luck: 1
                }
            };
            const attrs = player.attributes || {};
            const pts = Number(player.attributePoints) || 0;

            const attrList = [
                { key: 'operation', name: '运营', icon: '📈', desc: '提升店铺曝光和流量' },
                { key: 'selection', name: '选品', icon: '🎯', desc: '提升选品眼光和爆款率' },
                { key: 'negotiation', name: '谈判', icon: '🤝', desc: '降低采购成本' },
                { key: 'management', name: '管理', icon: '👔', desc: '提升员工效率' },
                { key: 'luck', name: '运气', icon: '🍀', desc: '增加好事概率' }
            ];

            const content = `
            <div style="text-align:center;padding:15px 0;">
                <div style="font-size:48px;margin-bottom:10px;">📊</div>
                <div style="font-size:18px;font-weight:bold;color:#333;">角色属性</div>
                <div style="font-size:13px;color:#e65100;margin-top:6px;line-height:1.5;">
                    店铺升级每级送 2 点；也可看广告为一项属性 +1（最高 Lv.20）
                </div>
                <div style="margin-top:8px;font-size:14px;font-weight:700;color:${pts > 0 ? '#1565c0' : '#888'};">
                    可用属性点 ${pts}
                </div>
            </div>
            <div style="margin:10px 0;">
                ${attrList.map(attr => {
                    const level = attrs[attr.key] || 1;
                    const canUpgrade = level < 20;
                    return `
                        <div style="display:flex;align-items:center;padding:12px 0;border-bottom:1px solid #f0f0f0;">
                            <div style="font-size:28px;margin-right:12px;">${attr.icon}</div>
                            <div style="flex:1;">
                                <div style="font-weight:bold;font-size:14px;color:#333;">${attr.name}</div>
                                <div style="font-size:12px;color:#999;margin-top:2px;">${attr.desc} · 每级约${
                            attr.key === 'operation' ? '+4%自然流量' :
                            attr.key === 'selection' ? '+3%转化' :
                            attr.key === 'negotiation' ? '-1.5%采购价' :
                            attr.key === 'management' ? '+2%员工效率' : '+好事概率'
                        }</div>
                            </div>
                            <div style="text-align:right;">
                                <div style="font-size:18px;font-weight:bold;color:#ff6b35;">Lv.${level}</div>
                                ${canUpgrade ? `
                                    <div style="display:flex;gap:4px;justify-content:flex-end;margin-top:4px;flex-wrap:wrap;">
                                        ${pts > 0 ? `<button class="btn btn-primary btn-small" style="padding:2px 8px;font-size:11px;"
                                            onclick="ui.spendAttributePoint('${attr.key}')">用点+1</button>` : ''}
                                        <button class="btn btn-secondary btn-small" style="padding:2px 8px;font-size:11px;"
                                            onclick="ui.upgradeAttribute('${attr.key}')">看广告+1</button>
                                    </div>
                                ` : '<div style="font-size:11px;color:#999;margin-top:4px;">已满级</div>'}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;

        const footer = `
            <button class="btn btn-primary" onclick="ui.closeModal()">确定</button>
        `;

        this.showModal('角色属性', content, footer, { modalId: 'attributeModal' });
    }

    spendAttributePoint(attrKey) {
        if (typeof gameState.spendAttributePoint !== 'function') {
            this.showToast('属性系统不可用');
            return;
        }
        const r = gameState.spendAttributePoint(attrKey, 20);
        this.showToast(r.message || (r.success ? `已升至 Lv.${r.level}` : '加点失败'));
        if (r.success) this.showAttributeModal();
    }

    upgradeAttribute(attrKey) {
        const attrs = (gameState.state && gameState.state.player && gameState.state.player.attributes) || {};
        if ((attrs[attrKey] || 1) >= 20) {
            this.showToast('该属性已满级');
            return;
        }
        if (typeof RewardedAdManager === 'undefined' || !RewardedAdManager.showForAttrUpgrade) {
            this.showToast('广告模块未加载');
            return;
        }
        this.closeModal();
        RewardedAdManager.showForAttrUpgrade(attrKey);
    }

    // ==================== 包装材料（3.6 极简重做：3 种核心材料，单一数据源同步） ====================
    /**
     * 包装材料入口（重做版）：
     * 只管理 3 种核心材料（纸箱/气泡膜/胶带），采购与消耗全部走 gameState 统一接口，
     * 与仓储模块共享同一库存对象，杜绝数据不一致。
     */
    showPackagingMaterialModal() {
        this._markJustClicked();
        const gs = gameState;
        const build = () => {
            const mats = gs.getPackagingMaterials();
            const CORE_KEYS = ['carton', 'bubbleWrap', 'tape'];
            const now = gs.state.gameTime;
            const dayStats = (gs.state.warehouse && gs.state.warehouse.packagingCostStats || {})['D' + now.day] || {};
            const totalValue = CORE_KEYS.reduce((s, id) => s + (mats[id] ? (mats[id].quantity || 0) * (mats[id].cost || 0) : 0), 0);
            const logs = (gs.state.warehouse && Array.isArray(gs.state.warehouse.packagingLogs))
                ? gs.state.warehouse.packagingLogs : [];
            const fmtQty = (v) => {
                const n = Number(v) || 0;
                return n >= 10 ? String(Math.round(n * 10) / 10) : (n >= 1 ? String(Math.round(n * 100) / 100) : String(Math.round(n * 1000) / 1000));
            };
            const rows = CORE_KEYS.map(id => {
                const m = mats[id];
                if (!m) return '';
                const qty = Number(m.quantity || 0);
                const low = m.lowStockThreshold || 20;
                const isLow = qty <= low;
                const tiers = (m.priceTiers || []).slice(0, 3).map(t => `¥${t.price.toFixed(2)}/${t.minQty}+`).join(' · ');
                return `
                    <div class="pkg3-card" style="${isLow ? 'border-color:#ffcc80;background:#fffdf7;' : ''}">
                        <div style="display:flex;align-items:center;gap:10px;">
                            <div style="width:42px;height:42px;border-radius:10px;background:linear-gradient(135deg,#fff3e0,#ffe0b2);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">${m.icon || '📦'}</div>
                            <div style="flex:1;min-width:0;">
                                <div style="font-size:14px;font-weight:800;display:flex;align-items:center;gap:6px;">
                                    ${m.name}
                                    ${isLow ? '<span style="font-size:10px;background:#ffebee;color:#c62828;padding:1px 6px;border-radius:8px;">⚠️ 低库存</span>' : ''}
                                </div>
                                <div style="font-size:11px;color:#999;margin-top:2px;">${tiers || `¥${m.cost.toFixed(2)}/${m.unit}`} · 预警线 ${low}${m.unit}</div>
                            </div>
                            <div style="text-align:right;flex-shrink:0;">
                                <div style="font-size:16px;font-weight:900;color:${isLow ? '#c62828' : '#2e7d32'};">${fmtQty(qty)}</div>
                                <div style="font-size:10px;color:#999;">${m.unit || ''}</div>
                            </div>
                        </div>
                        <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;">
                            <button class="btn btn-secondary btn-small" onclick="ui.pkgQuickBuy('${id}', 50)">+50</button>
                            <button class="btn btn-secondary btn-small" onclick="ui.pkgQuickBuy('${id}', 200)">+200</button>
                            <button class="btn btn-secondary btn-small" onclick="ui.pkgQuickBuy('${id}', 500)">+500</button>
                            <button class="btn btn-secondary btn-small" onclick="ui.pkgQuickBuy('${id}', 1000)">+1000</button>
                            <button class="btn btn-secondary btn-small" onclick="ui.pkgQuickBuy('${id}', 5000)">+5000</button>
                            <button class="btn btn-secondary btn-small" onclick="ui.pkgQuickBuy('${id}', 10000)">+10000</button>
                            <button class="btn btn-secondary btn-small" onclick="ui.pkgQuickBuy('${id}', 100000)">+10万</button>
                            <button class="btn btn-secondary btn-small" onclick="ui.showPackagingQtyModal('${id}')">自定义数量</button>
                        </div>
                    </div>`;
            }).join('');
            return `
                <div class="pkg3-wrap">
                    <div style="display:flex;gap:8px;margin-bottom:10px;">
                        <div style="flex:1;background:linear-gradient(135deg,#667eea,#764ba2);border-radius:10px;padding:10px;color:#fff;text-align:center;">
                            <div style="font-size:17px;font-weight:900;">${formatMoney(totalValue)}</div>
                            <div style="font-size:10px;opacity:.9;">库存总值</div>
                        </div>
                        <div style="flex:1;background:linear-gradient(135deg,#4facfe,#00f2fe);border-radius:10px;padding:10px;color:#fff;text-align:center;">
                            <div style="font-size:17px;font-weight:900;">${dayStats.ordersShipped || 0}</div>
                            <div style="font-size:10px;opacity:.9;">今日发货</div>
                        </div>
                        <div style="flex:1;background:linear-gradient(135deg,#f093fb,#f5576c);border-radius:10px;padding:10px;color:#fff;text-align:center;">
                            <div style="font-size:17px;font-weight:900;">${formatMoney((dayStats.packagingFeeByOrder || 0) + (dayStats.auto_emergency_cost || 0))}</div>
                            <div style="font-size:10px;opacity:.9;">今日包装成本</div>
                        </div>
                    </div>
                    <div style="font-size:12px;color:#666;line-height:1.6;background:#f3f7ff;border-left:3px solid #667eea;border-radius:8px;padding:8px 10px;margin-bottom:10px;">
                        🎯 <b>消耗规则</b>：纸箱 1个/单 · 气泡膜 0.3+0.15×件数 · 胶带 0.05卷/单。
                        库存不足时自动<b>紧急采购（加价50%）</b>，建议提前备货。
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:linear-gradient(135deg,#e8f5e9,#c8e6c9);border-radius:10px;margin-bottom:10px;">
                        <div style="min-width:0;">
                            <div style="font-size:13px;font-weight:700;color:#2e7d32;">🌿 环保包装</div>
                            <div style="font-size:11px;color:#558b2f;margin-top:2px;">${gameState.getEcoPackaging() ? '已启用：信誉 +3、退货率降低' : '启用后信誉 +3，退货率降低'}</div>
                        </div>
                        <button class="btn ${gameState.getEcoPackaging() ? 'btn-secondary' : 'btn-primary'} btn-small" style="flex-shrink:0;" onclick="ui.toggleEcoPackaging()">
                            ${gameState.getEcoPackaging() ? '停用' : '启用'}
                        </button>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:8px;">${rows}</div>
                    <button class="btn btn-primary btn-block" style="margin-top:10px;"
                        onclick="ui.pkgRestockAll()">⚡ 一键补货（低库存补到 3 倍预警线）</button>
                    <div style="margin-top:12px;">
                        <div style="font-size:12px;font-weight:700;color:#555;margin-bottom:6px;">📋 最近记录</div>
                        ${logs.length === 0
                            ? '<div style="text-align:center;color:#aaa;font-size:12px;padding:12px 0;">暂无出入库记录，发货/采购后这里会显示</div>'
                            : `<div style="max-height:180px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;">
                                ${logs.slice(0, 30).map(l => `
                                    <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:#fafafa;border-radius:8px;font-size:11px;">
                                        <span>${l.icon || '📦'}</span>
                                        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${l.materialName || l.type || '包装材料'}</span>
                                        <span style="color:${(l.subtype === 'ship' || l.type === 'outbound' || l.type === 'emergency_purchase') ? '#c62828' : '#2e7d32'};font-weight:700;">${(l.type === 'purchase' || l.type === 'inbound') ? '+' : ''}${l.quantity != null ? fmtQty(l.quantity) : ''}${l.unit || ''}</span>
                                        <span style="color:#999;">第${l.day || '?'}天</span>
                                    </div>`).join('')}
                            </div>`}
                    </div>
                </div>`;
        };
        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>
            <button class="btn btn-primary" onclick="ui.showPackagingMaterialModal()">🔄 刷新</button>`;
        this.showModal('📦 包装材料', build(), footer, { modalId: 'packagingModalV3', modalClass: 'pkg3-overlay' });
    }

    /** 快捷采购某核心材料（统一走 gameState.buyPackagingMaterial，与仓储模块共享库存） */
    pkgQuickBuy(materialId, qty) {
        const r = gameState.buyPackagingMaterial(materialId, qty);
        if (r && r.success) {
            this.showToast(`✅ 已采购 ${r.quantity} ${r.materialName || ''}，花费 ${formatMoney(r.cost)}`);
            this.showPackagingMaterialModal();
        } else {
            this.showToast((r && r.message) || '采购失败');
        }
    }

    toggleEcoPackaging() {
        const r = gameState.toggleEcoPackaging();
        this.showToast((r && r.message) || '已切换');
        this.showPackagingMaterialModal();
    }

    /** 自定义数量采购弹窗 */
    showPackagingQtyModal(materialId) {
        const mats = gameState.getPackagingMaterials();
        const m = mats[materialId];
        if (!m) { this.showToast('材料不存在'); return; }
        const tiers = (m.priceTiers || []).map(t => `≥${t.minQty}件 ¥${t.price.toFixed(2)}`).join(' · ');
        const content = `
            <div style="padding:4px 2px;">
                <div style="font-size:14px;font-weight:800;margin-bottom:6px;">${m.icon || '📦'} ${m.name}</div>
                <div style="font-size:11px;color:#999;margin-bottom:10px;">阶梯价：${tiers || `¥${m.cost.toFixed(2)}/${m.unit}`}</div>
                <div class="form-group">
                    <label class="form-label">采购数量（${m.unit || '个'}）</label>
                    <input type="number" class="form-input" id="pkg3Qty" value="100" min="1" step="1">
                </div>
            </div>`;
        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>
            <button class="btn btn-primary" onclick="ui.pkgConfirmCustomBuy('${materialId}')">确认采购</button>`;
        this.showModal('采购' + m.name, content, footer, { modalId: 'pkg3QtyModal' });
    }

    pkgConfirmCustomBuy(materialId) {
        const qty = parseInt((document.getElementById('pkg3Qty') || {}).value, 10);
        if (!(qty > 0)) { this.showToast('请输入有效数量'); return; }
        this.closeModal();
        this.pkgQuickBuy(materialId, qty);
    }

    /** 一键补货：低库存核心材料补到 3 倍预警线 */
    pkgRestockAll() {
        const gs = gameState;
        const mats = gs.getPackagingMaterials();
        const CORE_KEYS = ['carton', 'bubbleWrap', 'tape'];
        const plan = [];
        CORE_KEYS.forEach(id => {
            const m = mats[id];
            if (!m) return;
            const qty = Number(m.quantity || 0);
            const target = (m.lowStockThreshold || 20) * 3;
            if (qty < target) plan.push({ id, m, buy: Math.ceil(target - qty) });
        });
        if (!plan.length) {
            this.showToast('库存充足，无需补货');
            return;
        }
        let totalCost = 0;
        const bought = [];
        plan.forEach(p => {
            const r = gs.buyPackagingMaterial(p.id, p.buy);
            if (r && r.success) {
                totalCost += r.cost;
                bought.push(`${p.m.icon || ''}${p.m.name}+${r.quantity}`);
            }
        });
        if (bought.length) {
            this.showToast(`✅ 一键补货完成：${bought.join('、')}，共 ${formatMoney(totalCost)}`);
        } else {
            this.showToast('补货失败（资金不足或材料异常）');
        }
        this.showPackagingMaterialModal();
    }

    // ==================== 快递合作入口 ====================
    openExpressCenter(tab) {
        if (typeof expressUI !== 'undefined' && typeof expressUI.openCenter === 'function') {
            expressUI.openCenter(tab || 'partners');
        } else if (typeof ExpressUI !== 'undefined') {
            (new ExpressUI()).openCenter(tab || 'partners');
        } else {
            this.showToast('快递合作模块加载中，请稍候再试', 'error');
        }
    }

    // ==================== 优惠券管理系统 ====================
    
    renderCouponsPage(state) {
        const subTab = this.currentTab.couponsSub || 'manage';
        const stats = gameState.getCouponStatistics();
        const now = state.gameTime;
        
        return `
            <div class="page">
                <div class="coupon-stats-bar">
                    <div class="coupon-stat">
                        <div class="coupon-stat-value">${stats.activeTemplates}</div>
                        <div class="coupon-stat-label">进行中</div>
                    </div>
                    <div class="coupon-stat">
                        <div class="coupon-stat-value">${stats.totalReceived}</div>
                        <div class="coupon-stat-label">已领取</div>
                    </div>
                    <div class="coupon-stat">
                        <div class="coupon-stat-value">${stats.totalUsed}</div>
                        <div class="coupon-stat-label">已使用</div>
                    </div>
                    <div class="coupon-stat">
                        <div class="coupon-stat-value" style="color:#f44336;">¥${stats.totalDiscount.toFixed(0)}</div>
                        <div class="coupon-stat-label">优惠总额</div>
                    </div>
                </div>
                
                <div class="coupon-sub-tabs">
                    <div class="sub-tab ${subTab === 'manage' ? 'active' : ''}" onclick="ui.switchSubTab('couponsSub', 'manage')">🎫 优惠券管理</div>
                    <div class="sub-tab ${subTab === 'create' ? 'active' : ''}" onclick="ui.switchSubTab('couponsSub', 'create')">➕ 创建优惠券</div>
                    <div class="sub-tab ${subTab === 'records' ? 'active' : ''}" onclick="ui.switchSubTab('couponsSub', 'records')">📊 数据统计</div>
                </div>
                
                ${subTab === 'manage' ? this.renderCouponManage(state) : ''}
                ${subTab === 'create' ? this.renderCouponCreate() : ''}
                ${subTab === 'records' ? this.renderCouponRecords(state) : ''}
            </div>
        `;
    }
    
    switchSubTab(tabKey, value) {
        this.currentTab[tabKey] = value;
        this.render();
    }
    
    renderCouponManage(state) {
        const templates = [...(state.coupons.templates || [])].sort((a, b) => b.createTime.day - a.createTime.day);
        const now = state.gameTime;
        
        if (templates.length === 0) {
            return `
                <div class="empty-state">
                    <div style="font-size:64px;margin-bottom:16px;">🎫</div>
                    <div style="font-size:16px;color:#666;margin-bottom:8px;">还没有创建优惠券</div>
                    <div style="font-size:13px;color:#999;margin-bottom:20px;">创建优惠券吸引顾客下单，提升店铺转化率</div>
                    <button class="btn btn-primary" onclick="ui.switchSubTab('couponsSub', 'create')">立即创建优惠券</button>
                </div>
            `;
        }
        
        const getStatusBadge = (t) => {
            if (t.status === 'active') {
                if (now.day < t.startDay) return '<span class="coupon-badge" style="background:#fff3e0;color:#ef6c00;">未开始</span>';
                if (now.day > t.endDay) return '<span class="coupon-badge" style="background:#ffebee;color:#c62828;">已结束</span>';
                if (t.receivedCount >= t.quantity) return '<span class="coupon-badge" style="background:#f3e5f5;color:#7b1fa2;">已领完</span>';
                return '<span class="coupon-badge" style="background:#e8f5e9;color:#2e7d32;">进行中</span>';
            }
            if (t.status === 'paused') return '<span class="coupon-badge" style="background:#f5f5f5;color:#757575;">已暂停</span>';
            if (t.status === 'expired') return '<span class="coupon-badge" style="background:#ffebee;color:#c62828;">已过期</span>';
            if (t.status === 'depleted') return '<span class="coupon-badge" style="background:#f3e5f5;color:#7b1fa2;">已领完</span>';
            return '<span class="coupon-badge">草稿</span>';
        };
        
        const getCouponTypeInfo = (type) => {
            const types = {
                fixed: { icon: '💰', color: '#ff6b6b', name: '固定金额' },
                discount: { icon: '🏷️', color: '#feca57', name: '折扣券' },
                threshold: { icon: '🎫', color: '#54a0ff', name: '满减券' },
                freeship: { icon: '🚚', color: '#5f27cd', name: '免运费' }
            };
            return types[type] || types.fixed;
        };
        
        const getCouponValue = (t) => {
            switch(t.type) {
                case 'fixed': return `¥${t.value}`;
                case 'discount': return `${t.value}折`;
                case 'threshold': return `¥${t.value}`;
                case 'freeship': return '免邮';
                default: return `¥${t.value}`;
            }
        };
        
        return `
            <div class="coupon-list">
                ${templates.map(t => {
                    const typeInfo = getCouponTypeInfo(t.type);
                    const remaining = t.quantity - t.receivedCount;
                    const receiveRate = t.quantity > 0 ? Math.round(t.receivedCount / t.quantity * 100) : 0;
                    const useRate = t.receivedCount > 0 ? Math.round(t.usedCount / t.receivedCount * 100) : 0;
                    const isActive = t.status === 'active' && now.day >= t.startDay && now.day <= t.endDay && remaining > 0;
                    
                    return `
                        <div class="coupon-card" style="border-left:4px solid ${typeInfo.color};">
                            <div class="coupon-card-left" style="background:linear-gradient(135deg, ${typeInfo.color}22, ${typeInfo.color}11);">
                                <div class="coupon-icon" style="color:${typeInfo.color};">${typeInfo.icon}</div>
                                <div class="coupon-amount" style="color:${typeInfo.color};">${getCouponValue(t)}</div>
                                <div class="coupon-condition">${t.minAmount > 0 ? `满${t.minAmount}可用` : '无门槛'}</div>
                            </div>
                            <div class="coupon-card-right">
                                <div class="coupon-header">
                                    <div class="coupon-name">${escapeHtml(t.name)}</div>
                                    ${getStatusBadge(t)}
                                </div>
                                <div class="coupon-desc">${escapeHtml(t.description || typeInfo.name + '优惠券')}</div>
                                <div class="coupon-meta">
                                    <span>📅 第${t.startDay}天 - 第${t.endDay}天</span>
                                    <span>📋 领取${receiveRate}%</span>
                                    <span>✅ 使用${useRate}%</span>
                                </div>
                                <div class="coupon-progress">
                                    <div class="coupon-progress-bar" style="width:${receiveRate}%;background:${typeInfo.color};"></div>
                                </div>
                                <div class="coupon-actions">
                                    <button class="btn-mini" style="background:#2196f3;" onclick="ui.showEditCouponModal('${t.id}')">编辑</button>
                                    ${isActive ? `<button class="btn-mini" style="background:#ff9800;" onclick="ui.pauseCoupon('${t.id}')">暂停</button>` : ''}
                                    ${t.status === 'paused' ? `<button class="btn-mini" style="background:#4caf50;" onclick="ui.resumeCoupon('${t.id}')">启用</button>` : ''}
                                    <button class="btn-mini btn-danger" onclick="ui.deleteCouponConfirm('${t.id}')">删除</button>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }
    
    renderCouponCreate() {
        return `
            <div class="coupon-create-form card">
                <div class="form-group">
                    <label class="form-label">优惠券名称 *</label>
                    <input type="text" id="couponName" class="form-input" placeholder="例如：新人专享满减券" maxlength="20">
                </div>
                
                <div class="form-group">
                    <label class="form-label">优惠券类型 *</label>
                    <div class="coupon-type-selector">
                        <div class="coupon-type-item active" data-type="fixed" onclick="ui.selectCouponType(this)">
                            <div class="type-icon">💰</div>
                            <div class="type-name">固定金额</div>
                            <div class="type-desc">直接抵扣</div>
                        </div>
                        <div class="coupon-type-item" data-type="threshold" onclick="ui.selectCouponType(this)">
                            <div class="type-icon">🎫</div>
                            <div class="type-name">满减券</div>
                            <div class="type-desc">满额减免</div>
                        </div>
                        <div class="coupon-type-item" data-type="discount" onclick="ui.selectCouponType(this)">
                            <div class="type-icon">🏷️</div>
                            <div class="type-name">折扣券</div>
                            <div class="type-desc">比例折扣</div>
                        </div>
                        <div class="coupon-type-item" data-type="freeship" onclick="ui.selectCouponType(this)">
                            <div class="type-icon">🚚</div>
                            <div class="type-name">免运费</div>
                            <div class="type-desc">包邮优惠</div>
                        </div>
                    </div>
                </div>
                
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label" id="couponValueLabel">优惠金额 (元) *</label>
                        <input type="number" id="couponValue" class="form-input" placeholder="例如：10" min="1" max="9999" value="10">
                    </div>
                    <div class="form-group" id="minAmountGroup">
                        <label class="form-label">使用门槛 (元)</label>
                        <input type="number" id="couponMinAmount" class="form-input" placeholder="0表示无门槛" min="0" value="0">
                    </div>
                </div>
                
                <div class="form-group" id="maxDiscountGroup" style="display:none;">
                    <label class="form-label">最高优惠金额 (元)</label>
                    <input type="number" id="couponMaxDiscount" class="form-input" placeholder="0表示不限制" min="0" value="0">
                </div>
                
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">发放数量 *</label>
                        <input type="number" id="couponQuantity" class="form-input" placeholder="例如：100" min="1" max="10000" value="100">
                    </div>
                    <div class="form-group">
                        <label class="form-label">每人限领</label>
                        <input type="number" id="couponPerUser" class="form-input" placeholder="1" min="1" max="10" value="1">
                    </div>
                </div>
                
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">开始天数</label>
                        <input type="number" id="couponStartDay" class="form-input" value="${gameState.state.gameTime.day}" min="1">
                    </div>
                    <div class="form-group">
                        <label class="form-label">结束天数</label>
                        <input type="number" id="couponEndDay" class="form-input" value="${gameState.state.gameTime.day + 7}" min="1">
                    </div>
                </div>
                
                <div class="form-group">
                    <label class="form-label">领取后有效天数</label>
                    <input type="number" id="couponValidDays" class="form-input" value="7" min="1" max="30">
                </div>
                
                <div class="form-group">
                    <label class="form-label">适用范围</label>
                    <select id="couponScope" class="form-input" onchange="ui.onCouponScopeChange()">
                        <option value="all">全部商品</option>
                        <option value="category">指定分类</option>
                        <option value="product">指定商品</option>
                    </select>
                </div>
                
                <div id="couponScopeDetail" style="display:none;">
                    <div class="form-group">
                        <label class="form-label" id="couponScopeLabel">选择分类</label>
                        <div id="couponScopeOptions" class="scope-options"></div>
                    </div>
                </div>
                
                <div class="form-group">
                    <label class="form-label">优惠券描述</label>
                    <textarea id="couponDesc" class="form-input" rows="2" placeholder="简要描述优惠券使用规则（可选）"></textarea>
                </div>
                
                <div class="form-actions">
                    <button class="btn btn-secondary" onclick="ui.switchSubTab('couponsSub', 'manage')">取消</button>
                    <button class="btn btn-primary" onclick="ui.createCoupon()">🎫 创建优惠券</button>
                </div>
            </div>
            
            <div class="coupon-preview card" style="margin-top:12px;">
                <div class="card-title">🎁 优惠券预览</div>
                <div class="coupon-card coupon-card-preview">
                    <div class="coupon-card-left" id="couponPreviewLeft" style="background:linear-gradient(135deg, #ff6b6b22, #ff6b6b11);">
                        <div class="coupon-icon" id="couponPreviewIcon" style="color:#ff6b6b;">💰</div>
                        <div class="coupon-amount" id="couponPreviewAmount" style="color:#ff6b6b;">¥10</div>
                        <div class="coupon-condition" id="couponPreviewCondition">无门槛</div>
                    </div>
                    <div class="coupon-card-right">
                        <div class="coupon-name" id="couponPreviewName">新人专享券</div>
                        <div class="coupon-desc" id="couponPreviewDesc">固定金额优惠券</div>
                        <div class="coupon-meta">
                            <span>📅 长期有效</span>
                            <span>📋 限领1张</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
    
    renderCouponRecords(state) {
        const stats = gameState.getCouponStatistics();
        const analytics = (typeof gameState.getCouponAnalytics === 'function') ? gameState.getCouponAnalytics() : null;
        const userCoupons = [...(state.coupons.userCoupons || [])].sort((a, b) => {
            if (a.status === 'available' && b.status !== 'available') return -1;
            if (b.status === 'available' && a.status !== 'available') return 1;
            return b.receiveTime.day - a.receiveTime.day;
        });
        
        const statusLabels = {
            available: { text: '可使用', color: '#4caf50', bg: '#e8f5e9' },
            used: { text: '已使用', color: '#2196f3', bg: '#e3f2fd' },
            expired: { text: '已过期', color: '#9e9e9e', bg: '#f5f5f5' }
        };
        
        return `
            <div class="card">
                <div class="card-title">📊 优惠券数据概览</div>
                <div class="coupon-analytics-grid">
                    <div class="analytic-item">
                        <div class="analytic-value">${stats.totalTemplates}</div>
                        <div class="analytic-label">累计创建</div>
                    </div>
                    <div class="analytic-item">
                        <div class="analytic-value">${stats.totalIssued}</div>
                        <div class="analytic-label">总发行量</div>
                    </div>
                    <div class="analytic-item">
                        <div class="analytic-value" style="color:#2196f3;">${stats.totalReceived}</div>
                        <div class="analytic-label">总领取量</div>
                    </div>
                    <div class="analytic-item">
                        <div class="analytic-value" style="color:#4caf50;">${stats.totalUsed}</div>
                        <div class="analytic-label">总使用量</div>
                    </div>
                    <div class="analytic-item">
                        <div class="analytic-value" style="color:#ff9800;">${stats.totalExpired}</div>
                        <div class="analytic-label">过期数量</div>
                    </div>
                    <div class="analytic-item">
                        <div class="analytic-value" style="color:#f44336;">¥${stats.totalDiscount.toFixed(2)}</div>
                        <div class="analytic-label">优惠总金额</div>
                    </div>
                </div>
                
                <div class="coupon-rate-bars">
                    <div class="rate-item">
                        <div class="rate-label">领取率 <b>${stats.receiveRate}%</b></div>
                        <div class="rate-bar"><div class="rate-fill" style="width:${stats.receiveRate}%;background:#2196f3;"></div></div>
                    </div>
                    <div class="rate-item">
                        <div class="rate-label">使用率 <b>${stats.useRate}%</b></div>
                        <div class="rate-bar"><div class="rate-fill" style="width:${stats.useRate}%;background:#4caf50;"></div></div>
                    </div>
                </div>
            </div>
            
            ${analytics && analytics.templates.length ? `
            <div class="card" style="margin-top:12px;">
                <div class="card-title">🧮 核销 ROI 分析</div>
                <div style="font-size:12px;color:#666;margin-bottom:10px;line-height:1.7;">
                    累计让利 <b style="color:#f44336;">¥${analytics.overall.totalDiscount.toFixed(2)}</b>
                    · 撬动订单金额约 <b style="color:#4caf50;">¥${formatMoney(analytics.overall.estimatedGMV)}</b>
                    · 综合核销率 <b>${analytics.overall.useRate}%</b>
                </div>
                <div style="display:flex;flex-direction:column;gap:8px;">
                    ${analytics.templates.slice(0, 8).map((r, i) => `
                        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#f8f9fa;border-radius:8px;">
                            <span style="font-size:12px;color:#333;">
                                <span style="color:#bbb;margin-right:4px;">#${i + 1}</span>${escapeHtml(r.name)}
                                <span style="color:#999;font-size:11px;margin-left:6px;">领${r.received}·核${r.used}</span>
                            </span>
                            <span style="font-size:12px;font-weight:bold;color:${r.useRate >= 50 ? '#4caf50' : r.useRate >= 20 ? '#ff9800' : '#f44336'};">${r.useRate}%</span>
                        </div>`).join('')}
                </div>
            </div>` : ''}
            
            <div class="card" style="margin-top:12px;">
                <div class="card-title">📋 优惠券领取记录（最近${Math.min(50, userCoupons.length)}条）</div>
                ${userCoupons.length === 0 ? `
                    <div style="text-align:center;padding:40px;color:#999;">
                        <div style="font-size:48px;margin-bottom:12px;">📭</div>
                        <div>暂无领取记录，创建优惠券后顾客将自动领取使用</div>
                    </div>
                ` : `
                    <div class="coupon-records-list">
                        ${userCoupons.slice(0, 50).map(uc => {
                            const status = statusLabels[uc.status] || statusLabels.available;
                            return `
                                <div class="record-item">
                                    <div class="record-info">
                                        <div class="record-name">${escapeHtml(uc.name)}</div>
                                        <div class="record-meta">
                                            第${uc.receiveTime.day}天领取 · 
                                            ${uc.status === 'used' ? `订单${uc.orderId?.slice(-8) || ''}使用` : 
                                              uc.status === 'expired' ? '已过期' : `第${uc.expireDay}天过期`}
                                        </div>
                                    </div>
                                    <div class="record-amount" style="color:${status.color};">
                                        ${uc.type === 'freeship' ? '包邮' : uc.type === 'discount' ? `${uc.value}折` : `¥${uc.value}`}
                                    </div>
                                    <div class="record-status" style="background:${status.bg};color:${status.color};">${status.text}</div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                `}
            </div>
        `;
    }
    
    selectCouponType(el) {
        document.querySelectorAll('.coupon-type-item').forEach(item => item.classList.remove('active'));
        el.classList.add('active');
        const type = el.dataset.type;
        
        const valueLabel = document.getElementById('couponValueLabel');
        const minAmountGroup = document.getElementById('minAmountGroup');
        const maxDiscountGroup = document.getElementById('maxDiscountGroup');
        
        switch(type) {
            case 'fixed':
                valueLabel.textContent = '优惠金额 (元) *';
                minAmountGroup.style.display = 'block';
                maxDiscountGroup.style.display = 'none';
                break;
            case 'threshold':
                valueLabel.textContent = '减免金额 (元) *';
                minAmountGroup.style.display = 'block';
                document.getElementById('couponMinAmount').value = document.getElementById('couponMinAmount').value || 99;
                maxDiscountGroup.style.display = 'none';
                break;
            case 'discount':
                valueLabel.textContent = '折扣比例 (折) *';
                document.getElementById('couponValue').value = 9;
                minAmountGroup.style.display = 'block';
                maxDiscountGroup.style.display = 'block';
                break;
            case 'freeship':
                valueLabel.textContent = '免运费';
                document.getElementById('couponValue').value = 0;
                minAmountGroup.style.display = 'none';
                maxDiscountGroup.style.display = 'none';
                break;
        }
    }
    
    onCouponScopeChange() {
        const scope = document.getElementById('couponScope').value;
        const detail = document.getElementById('couponScopeDetail');
        const label = document.getElementById('couponScopeLabel');
        const options = document.getElementById('couponScopeOptions');
        
        if (scope === 'all') {
            detail.style.display = 'none';
            return;
        }
        
        detail.style.display = 'block';
        
        if (scope === 'category') {
            label.textContent = '选择适用分类';
            options.innerHTML = CATEGORIES.map(cat => `
                <label class="scope-option">
                    <input type="checkbox" value="${cat.id}" name="couponCategory"> ${cat.icon} ${cat.name}
                </label>
            `).join('');
        } else if (scope === 'product') {
            label.textContent = '选择适用商品';
            options.innerHTML = `
                <div style="font-size:12px;color:#999;margin-bottom:8px;">热门商品推荐：</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;">
                    ${PRODUCTS.slice(0, 30).map(p => `
                        <label class="scope-option" style="font-size:11px;">
                            <input type="checkbox" value="${p.id}" name="couponProduct"> ${p.name.slice(0, 8)}
                        </label>
                    `).join('')}
                </div>
            `;
        }
    }
    
    createCoupon() {
        const name = document.getElementById('couponName').value.trim();
        const typeItem = document.querySelector('.coupon-type-item.active');
        const type = typeItem ? typeItem.dataset.type : 'fixed';
        const value = parseFloat(document.getElementById('couponValue').value) || 0;
        const minAmount = parseFloat(document.getElementById('couponMinAmount').value) || 0;
        const maxDiscount = parseFloat(document.getElementById('couponMaxDiscount').value) || 0;
        const quantity = parseInt(document.getElementById('couponQuantity').value) || 100;
        const perUser = parseInt(document.getElementById('couponPerUser').value) || 1;
        const startDay = parseInt(document.getElementById('couponStartDay').value) || gameState.state.gameTime.day;
        const endDay = parseInt(document.getElementById('couponEndDay').value) || gameState.state.gameTime.day + 7;
        const validDays = parseInt(document.getElementById('couponValidDays').value) || 7;
        const scope = document.getElementById('couponScope').value;
        const desc = document.getElementById('couponDesc').value.trim();
        
        if (!name) {
            this.showToast('请输入优惠券名称');
            return;
        }
        
        if (type !== 'freeship' && value <= 0) {
            this.showToast('请设置有效的优惠金额/折扣');
            return;
        }
        
        if (type === 'discount' && (value < 1 || value >= 10)) {
            this.showToast('折扣比例应在1-9.9折之间');
            return;
        }
        
        if (endDay < startDay) {
            this.showToast('结束时间不能早于开始时间');
            return;
        }
        
        let scopeIds = [];
        if (scope === 'category') {
            scopeIds = Array.from(document.querySelectorAll('input[name="couponCategory"]:checked')).map(i => i.value);
        } else if (scope === 'product') {
            scopeIds = Array.from(document.querySelectorAll('input[name="couponProduct"]:checked')).map(i => i.value);
        }
        
        const result = gameState.createCouponTemplate({
            name,
            type,
            value: type === 'discount' ? value : value,
            minAmount: type === 'threshold' ? (minAmount || 99) : minAmount,
            maxDiscount,
            quantity,
            perUserLimit: perUser,
            startDay,
            endDay,
            validDays,
            scope,
            scopeIds,
            description: desc
        });
        
        if (result.success) {
            this.showToast('🎉 优惠券创建成功！');
            this.currentTab.couponsSub = 'manage';
            this.render();
        } else {
            this.showToast(result.message || '创建失败');
        }
    }
    
    pauseCoupon(templateId) {
        const result = gameState.pauseCoupon(templateId);
        if (result.success) {
            this.showToast('优惠券已暂停');
            this.render();
        } else {
            this.showToast(result.message);
        }
    }
    
    resumeCoupon(templateId) {
        const result = gameState.resumeCoupon(templateId);
        if (result.success) {
            this.showToast('优惠券已启用');
            this.render();
        } else {
            this.showToast(result.message);
        }
    }
    
    deleteCouponConfirm(templateId) {
        if (confirm('确定要删除这张优惠券吗？删除后无法恢复。')) {
            this.deleteCoupon(templateId);
        }
    }
    
    deleteCoupon(templateId) {
        const result = gameState.deleteCoupon(templateId);
        if (result.success) {
            this.showToast('优惠券已删除');
            this.render();
        } else {
            this.showToast(result.message);
        }
    }

    showEditCouponModal(templateId) {
        const t = gameState.state.coupons.templates.find(x => x.id === templateId);
        if (!t) { this.showToast('❌ 优惠券不存在'); return; }
        const types = {
            fixed:    { icon: '💰', name: '固定金额' },
            threshold:{ icon: '🎫', name: '满减券' },
            discount: { icon: '🏷️', name: '折扣券' },
            freeship: { icon: '🚚', name: '免运费' }
        };
        const ti = types[t.type] || types.fixed;
        const valueLabel = t.type === 'discount' ? '折扣比例 (折)' : '优惠金额 (元)';
        const content = `
            <div style="padding:6px 2px;">
                <div style="background:linear-gradient(135deg,#e3f2fd,#bbdefb);border-radius:10px;padding:12px;margin-bottom:14px;">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <div style="font-size:34px;">${ti.icon}</div>
                        <div>
                            <div style="font-size:16px;font-weight:900;color:#0d47a1;">编辑优惠券</div>
                            <div style="font-size:11px;color:#1565c0;margin-top:2px;">当前类型：${ti.name} · 已领取 ${t.receivedCount||0}/${t.quantity}</div>
                        </div>
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">优惠券名称 *</label>
                    <input type="text" id="edit_couponName" class="form-input" maxlength="20" value="${escapeHtml(t.name||'')}">
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">${valueLabel} *</label>
                        <input type="number" id="edit_couponValue" class="form-input" min="0.1" step="0.1" value="${t.value||0}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">使用门槛 (元)</label>
                        <input type="number" id="edit_couponMinAmount" class="form-input" min="0" value="${t.minAmount||0}">
                    </div>
                </div>
                ${t.type === 'discount' ? `
                <div class="form-group">
                    <label class="form-label">最高优惠金额 (元)，0表示不限制</label>
                    <input type="number" id="edit_couponMaxDiscount" class="form-input" min="0" value="${t.maxDiscount||0}">
                </div>` : `<input type="hidden" id="edit_couponMaxDiscount" value="${t.maxDiscount||0}">`}
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">发放数量 *</label>
                        <input type="number" id="edit_couponQuantity" class="form-input" min="${t.receivedCount||0}" max="100000" value="${t.quantity}">
                        <div style="font-size:10px;color:#e65100;margin-top:3px;">⚠️ 不能低于已领取数量 ${t.receivedCount||0}</div>
                    </div>
                    <div class="form-group">
                        <label class="form-label">每人限领</label>
                        <input type="number" id="edit_couponPerUser" class="form-input" min="1" max="99" value="${t.perUserLimit||1}">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">活动开始 (天)</label>
                        <input type="number" id="edit_couponStartDay" class="form-input" min="1" value="${t.startDay}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">活动结束 (天)</label>
                        <input type="number" id="edit_couponEndDay" class="form-input" min="1" value="${t.endDay}">
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">领取后有效天数</label>
                    <input type="number" id="edit_couponValidDays" class="form-input" min="1" max="365" value="${t.validDays||7}">
                </div>
                <div class="form-group">
                    <label class="form-label">优惠券描述</label>
                    <textarea id="edit_couponDesc" class="form-input" rows="2" maxlength="100" placeholder="简要描述使用规则">${escapeHtml(t.description||'')}</textarea>
                </div>
            </div>
        `;
        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal();">取消</button>
            <button class="btn btn-primary" onclick="ui.submitEditCoupon('${t.id}','${t.type}');">💾 保存修改</button>
        `;
        this.showModal('编辑优惠券 - ' + t.name, content, footer);
    }

    submitEditCoupon(templateId, type) {
        const name = document.getElementById('edit_couponName').value.trim();
        const value = parseFloat(document.getElementById('edit_couponValue').value) || 0;
        const minAmount = parseFloat(document.getElementById('edit_couponMinAmount').value) || 0;
        const maxDiscount = parseFloat(document.getElementById('edit_couponMaxDiscount').value) || 0;
        const quantity = parseInt(document.getElementById('edit_couponQuantity').value) || 0;
        const perUser = parseInt(document.getElementById('edit_couponPerUser').value) || 1;
        const startDay = parseInt(document.getElementById('edit_couponStartDay').value) || 1;
        const endDay = parseInt(document.getElementById('edit_couponEndDay').value) || 1;
        const validDays = parseInt(document.getElementById('edit_couponValidDays').value) || 7;
        const description = document.getElementById('edit_couponDesc').value.trim();

        if (!name) { this.showToast('❌ 请输入优惠券名称'); return; }
        if (type !== 'freeship' && value <= 0) { this.showToast('❌ 请设置有效的优惠值'); return; }
        if (type === 'discount' && (value < 1 || value >= 10)) { this.showToast('❌ 折扣范围 1-9.9 折'); return; }
        if (endDay < startDay) { this.showToast('❌ 结束时间不能早于开始时间'); return; }

        const updates = {
            name, value, minAmount, maxDiscount,
            quantity, perUserLimit: perUser,
            startDay, endDay, validDays, description
        };
        const result = gameState.updateCouponTemplate(templateId, updates);
        if (result.success) {
            this.closeModal();
            this.showToast(result.changed ? '✅ 优惠券已更新' : 'ℹ️ 没有检测到修改');
            this.render();
        } else {
            this.showToast('❌ ' + (result.message || '更新失败'));
        }
    }

    // ============== 2.3版本 新增：纳税中心弹窗 ==============
    showAfterSalesCenter() {
        try {
            if (typeof csUI !== 'undefined' && csUI && typeof csUI.show === 'function') {
                if (typeof gameState !== 'undefined' && typeof csUI.init === 'function') {
                    csUI.init(gameState, this);
                }
                csUI.show();
                return;
            }
            if (typeof AfterSalesUI !== 'undefined' && AfterSalesUI && typeof AfterSalesUI.show === 'function') {
                AfterSalesUI.init(gameState, this);
                AfterSalesUI.show();
                return;
            }
        } catch (e) {
            console.warn('[showAfterSalesCenter]', e);
        }
        // 兜底：仍跳转服务页
        this.navigateTo('service');
    }

    showTaxCenter() {
        try {
            if (typeof window.taxUI !== 'undefined' && window.taxUI && typeof window.taxUI.show === 'function') {
                window.taxUI.show();
                return;
            }
            if (typeof TaxUI !== 'undefined' && typeof gameState !== 'undefined') {
                const tax = new TaxUI(gameState, this);
                tax.show();
                return;
            }
            this.showToast('纳税中心模块未加载');
        } catch (e) {
            console.warn('[TaxCenter] error:', e);
            this.showToast('税务中心打开失败：' + e.message);
        }
    }

    // ============== 2.3版本 新增：法务中心弹窗 ==============
    showLegalCenter() {
        try {
            if (typeof window.legalUI !== 'undefined' && window.legalUI && typeof window.legalUI.show === 'function') {
                window.legalUI.show();
                return;
            }
            if (typeof legalUI !== 'undefined' && legalUI && typeof legalUI.show === 'function') {
                legalUI.show();
                return;
            }
            this.showToast('法务中心模块未加载');
        } catch (e) {
            console.warn('[LegalCenter] error:', e);
            this.showToast('法务中心打开失败：' + e.message);
        }
    }

    showOverseasCenter() {
        try {
            if (typeof window.overseasUI !== 'undefined' && window.overseasUI && typeof window.overseasUI.show === 'function') {
                window.overseasUI.show();
                return;
            }
            this.showToast('海外贸易模块未加载');
        } catch (e) {
            console.warn('[OverseasCenter] error:', e);
            this.showToast('海外中心打开失败：' + (e && e.message));
        }
    }

    openDashboard() {
        this.navigateTo('analytics');
    }

    setAnalyticsRange(range) {
        this._analyticsRange = range === 'all' ? 'all' : 'today';
        this._markJustClicked();
        this._lastRenderedPage = null;
        try { this.render(); } catch (_) {}
    }

    renderAnalyticsPage(state) {
        try {
            if (typeof dashboardUI !== 'undefined' && dashboardUI && typeof dashboardUI.renderPage === 'function') {
                return dashboardUI.renderPage(this._analyticsRange || 'today');
            }
        } catch (e) {
            console.warn('[analytics]', e);
        }
        return `<div class="page"><div class="empty-state"><div class="icon">📊</div>
            <div class="text">经营分析模块未加载</div></div></div>`;
    }

    showMoreOpsModal() {
        const items = (typeof AppNav !== 'undefined' && AppNav.flattenItems)
            ? AppNav.flattenItems(gameState && gameState.state)
            : [];
        const body = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:6px 0;">
            ${items.map(it => `<button class="btn btn-secondary" style="text-align:left;padding:12px 14px;" onclick="ui.closeModal();${it.action}">${it.icon} ${it.name}</button>`).join('')}
        </div>`;
        this.showModal('全部功能', body, '<button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>', { width: '420px' });
    }

    /** 宿舍操作后刷新独立宿舍弹窗（主员工页已不再挂宿舍 Tab） */
    _refreshHousingUI() {
        try {
            Array.from(document.querySelectorAll('.modal-overlay')).forEach(o => {
                if (o.dataset && (o.dataset.modalTitle === '🏠 员工宿舍' || o.dataset.modalId === 'housingCenterModal')) {
                    o.remove();
                }
            });
            this.showHousingCenter();
        } catch (e) {
            console.warn('[refreshHousingUI]', e);
        }
    }

    showHousingCenter() {
        try {
            // 宿舍入口已从员工主 Tab 隐藏；若外部调用则用独立弹窗，逻辑不变
            const state = gameState.state;
            const body = this._renderHousingTab(state);
            this.showModal('🏠 员工宿舍', body,
                '<button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>',
                { modalId: 'housingCenterModal' });
        } catch (e) {
            console.warn('[showHousingCenter]', e);
            this.showToast('宿舍系统打开失败');
        }
    }

    upgradeHousing(level) {
        this.buyHousingBuilding(level);
    }

    buyHousingBuilding(typeId) {
        try {
            const r = gameState.buyHousingBuilding(typeId);
            this.showToast(r.message || (r.success ? '购置成功' : '购置失败'));
            this._refreshHousingUI();
        } catch (e) {
            console.warn('[buyHousingBuilding]', e);
            this.showToast('宿舍购置失败');
        }
    }

    showCommissionCenter() {
        try {
            const state = gameState.state;
            const staffPct = ((typeof getStaffOrderCommissionRate === 'function')
                ? getStaffOrderCommissionRate(state.shop)
                : (state.shop.staffOrderCommissionRate || 0.001)) * 100;
            const mkPct = state.shop && state.shop.customCommissionRate != null
                ? (Number(state.shop.customCommissionRate) * 100).toFixed(1)
                : '';
            const pending = (state.employees || []).filter(e => e && e.status === 'active' && (e.pendingStaffCommission || 0) > 0)
                .sort((a, b) => (b.pendingStaffCommission || 0) - (a.pendingStaffCommission || 0))
                .slice(0, 12);
            const body = `
                <div style="font-size:13px;line-height:1.7;">
                    <div style="background:#fff8e1;border-radius:10px;padding:12px;margin-bottom:12px;color:#6d4c41;">
                        打包/发货/推广按成交额抽成；客服按处理单 0.8 元（月顶 800）；改价员 2 元/款（月顶 600）；律师按胜诉回款抽成（月顶 5000）。采购员仍走采购提成。
                    </div>
                    <div style="font-weight:700;margin-bottom:8px;">经手订单提成</div>
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
                        <input type="number" id="staffOrderCommissionPct" min="0.1" max="1" step="0.1"
                            value="${staffPct.toFixed(1)}" style="width:90px;padding:8px;border:1px solid #ddd;border-radius:8px;">
                        <span>%</span>
                        <button class="btn btn-primary btn-small" onclick="ui.saveStaffOrderCommissionRate()">保存</button>
                    </div>
                    <div style="font-size:11px;color:#888;margin-bottom:14px;">范围 0.1%～1%，默认 0.1%。随工资发放。采购员另走采购提成 0.001%。</div>
                    <div style="font-weight:700;margin-bottom:8px;">律师胜诉提成</div>
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
                        <input type="number" id="lawyerCommissionPct" min="3" max="8" step="0.5"
                            value="${((typeof gameState.getLawyerCommissionRate === 'function') ? gameState.getLawyerCommissionRate() : 0.05) * 100}"
                            style="width:90px;padding:8px;border:1px solid #ddd;border-radius:8px;">
                        <span>%</span>
                        <button class="btn btn-primary btn-small" onclick="ui.saveLawyerCommissionRate()">保存</button>
                    </div>
                    <div style="font-size:11px;color:#888;margin-bottom:14px;">范围 3%～8%，默认 5%，按回款计提，月顶 ¥5000。</div>
                    <div style="font-weight:700;margin-bottom:8px;">营销利润提成（推广员/店长）</div>
                    <div style="font-size:12px;color:#666;margin-bottom:8px;">只算推广带来的订单利润。空着则走 1%/2%/3% 阶梯。</div>
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                        <input type="number" id="customCommissionPct" min="0" max="20" step="0.1"
                            value="${mkPct}" placeholder="空=阶梯" style="width:90px;padding:8px;border:1px solid #ddd;border-radius:8px;">
                        <span>%</span>
                        <button class="btn btn-primary btn-small" onclick="ui.saveCustomCommissionRate()">保存</button>
                        <button class="btn btn-secondary btn-small" onclick="ui.clearCustomCommissionRate()">恢复阶梯</button>
                    </div>
                    ${pending.length ? `
                    <div style="font-weight:700;margin:16px 0 8px;">本月待发（前 ${pending.length}）</div>
                    ${pending.map(e => `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #f3f3f3;font-size:12px;">
                        <span>${escapeHtml(e.name)} · ${e.monthStaffOrders || 0} 单</span>
                        <span style="color:#e65100;">¥${Math.round(e.pendingStaffCommission || 0).toLocaleString()}</span>
                    </div>`).join('')}` : ''}
                </div>`;
            this.showModal('💰 员工提成', body,
                '<button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>',
                { modalId: 'commissionCenterModal' });
        } catch (e) {
            console.warn('[showCommissionCenter]', e);
            this.showToast('提成设置打开失败');
        }
    }

    saveLawyerCommissionRate() {
        try {
            const raw = (document.getElementById('lawyerCommissionPct')?.value || '').trim();
            const r = gameState.setLawyerCommissionRate(parseFloat(raw));
            this.showToast(r.message || (r.success ? '已保存' : '保存失败'));
            if (r.success) this.showCommissionCenter();
        } catch (e) {
            this.showToast('保存失败');
        }
    }

    saveStaffOrderCommissionRate() {
        try {
            const raw = (document.getElementById('staffOrderCommissionPct')?.value || '').trim();
            const pct = parseFloat(raw);
            const r = gameState.setStaffOrderCommissionRate(pct);
            this.showToast(r.message || (r.success ? '已保存' : '保存失败'));
            if (r.success) this.showCommissionCenter();
        } catch (e) {
            this.showToast('保存失败');
        }
    }

    toggleHousingAssign(empId, on) {
        try {
            const r = gameState.assignHousing(empId, !!on);
            if (!r.success) this.showToast(r.message || '分配失败');
            this._refreshHousingUI();
        } catch (e) {
            console.warn('[toggleHousingAssign]', e);
            this.showToast('宿舍分配失败');
        }
    }

    rebalanceHousing() {
        try {
            const r = gameState.rebalanceHousing();
            this.showToast(r.message || '已重新安排入住');
            this._refreshHousingUI();
        } catch (e) {
            console.warn('[rebalanceHousing]', e);
            this.showToast('宿舍安排失败');
        }
    }

    // ============== 2.3版本 新增：断供通知设置小弹窗 ==============
    showSupplyOutageSettings() {
        try {
            const state = gameState && gameState.state ? gameState.state : null;
            let currentLevel = (state && state.settings && state.settings.supplyOutageNotifyLevel) || (typeof localStorage !== 'undefined' ? (localStorage.getItem('supplyOutageNotifyLevel') || 'all') : 'all');
            // 兼容旧档的 daily/off 取值（引擎只认 all/digest/none）
            if (currentLevel === 'daily') currentLevel = 'digest';
            if (currentLevel === 'off') currentLevel = 'none';
            const levels = [
                { id: 'all', name: '全部通知', icon: '🔔', desc: '每次断货、断供都会立即弹出通知' },
                { id: 'digest', name: '每日汇总', icon: '📋', desc: '每天早上汇总一次昨日所有断供情况' },
                { id: 'none',   name: '关闭通知', icon: '🔕', desc: '不再推送任何断供提醒消息' }
            ];
            const content = `
                <div style="font-size:13px;">
                    <div style="background:#fafafa;border-radius:10px;padding:12px;margin-bottom:12px;font-size:12px;color:#555;line-height:1.7;">
                        <div style="font-weight:700;color:#333;margin-bottom:4px;">📦 断供/缺货通知等级</div>
                        选择希望接收的通知频度，避免爆单时消息刷屏
                    </div>
                    <div style="display:flex;flex-direction:column;gap:8px;">
                        ${levels.map(l => `
                            <label style="display:flex;align-items:center;gap:10px;padding:12px;border:2px solid ${currentLevel===l.id?'#ff6b35':'#eee'};border-radius:10px;cursor:pointer;background:${currentLevel===l.id?'#fff3e0':'#fff'};transition:all .2s;">
                                <input type="radio" name="supply_notify_level" value="${l.id}" ${currentLevel===l.id?'checked':''} style="accent-color:#ff6b35;width:16px;height:16px;">
                                <div style="flex:1;">
                                    <div style="font-weight:700;color:#333;font-size:13px;">${l.icon} ${l.name}</div>
                                    <div style="font-size:11px;color:#666;margin-top:2px;">${l.desc}</div>
                                </div>
                            </label>
                        `).join('')}
                    </div>
                </div>
            `;
            const footer = `
                <button class="btn btn-secondary" onclick="ui.closeModal();">取消</button>
                <button class="btn btn-primary" onclick="ui._saveSupplyOutageLevel();">保存设置</button>
            `;
            this._saveSupplyOutageLevel = () => {
                try {
                    const checked = document.querySelector('input[name="supply_notify_level"]:checked');
                    let lvl = checked ? checked.value : 'all';
                    // 兼容旧值 + 引擎只认 all/digest/none
                    if (lvl === 'daily') lvl = 'digest';
                    if (lvl === 'off') lvl = 'none';
                    if (!['all', 'digest', 'none'].includes(lvl)) lvl = 'all';
                    if (gameState && gameState.state) {
                        if (!gameState.state.settings) gameState.state.settings = {};
                        gameState.state.settings.supplyOutageNotifyLevel = lvl;
                        gameState.state.settings.supplyOutageSilentMode = (lvl === 'none');
                    }
                    if (typeof localStorage !== 'undefined') try { localStorage.setItem('supplyOutageNotifyLevel', lvl); } catch(_) {}
                    this.showToast('已保存：' + ({all:'全部通知',digest:'每日汇总',none:'关闭通知'}[lvl] || lvl));
                    this.closeModal();
                } catch (e) { this.showToast('保存失败：' + e.message); }
            };
            this.showModal('📦 断供通知设置', content, footer, { width: '460px' });
        } catch (e) {
            console.warn('[SupplyOutageSettings] error:', e);
            this.showToast('通知设置打开失败：' + e.message);
        }
    }

    claimTrafficBoost() {
        try {
            if (typeof RewardedAdManager === 'undefined' || !RewardedAdManager.showForTrafficBoost) {
                this.showToast('广告模块未加载');
                return;
            }
            if (RewardedAdManager.hasClaimedTrafficToday && RewardedAdManager.hasClaimedTrafficToday()) {
                this.showToast('今日流量包已领取');
                return;
            }
            RewardedAdManager.showForTrafficBoost();
        } catch (e) {
            this.showToast('流量包启动失败');
        }
    }

}

const ui = new UIManager();
if (typeof window !== 'undefined') {
    window.UIManager = UIManager;
    window.ui = ui;
}
