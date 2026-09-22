/**
 * 开局：店主 / 店名 / 注册类型 → 仓库城市 → initGame
 */
(function (g) {
    'use strict';

    var SHOP_NAME_SET_KEY = 'ecommerce_sim_shop_name_set';
    var WAREHOUSE_CITY_SET_KEY = 'ecommerce_sim_warehouse_city_set';
    var selectedWarehouseCity = 'yiwu';
    var selectedEntityType = 'individual';
    var selectedTalent = 'normal';
    var ENTITY_TYPE_HINTS = {
        individual: '已选：个人店铺（税率最低，适合起步）',
        sole_trader: '已选：个体工商户（月收入超 10 万起征增值税 1%）',
        company: '已选：公司店铺（增值税与企税更规范，适合规模化）'
    };
    var RANDOM_SHOP_NAMES = [
        '小幸运杂货店', '阳光小卖部', '甜蜜小铺', '潮流先锋店', '品质生活馆',
        '优品仓', '快乐购物站', '时尚精品屋', '暖心小铺', '梦想杂货店',
        '星辰商城', '彩虹百货', '优品小店', '便利之家', '美好生活馆',
        '幸福小店', '时光杂货店', '宝藏小屋', '优品集结号', '物美价廉店'
    ];
    var RANDOM_OWNER_NAMES = [
        '小王', '小李', '阿强', '小美', '阿杰', '小雨', '小陈', '阿龙', '小琳', '阿伟',
        '小张', '小刘', '阿东', '小芳', '阿斌', '小燕', '阿涛', '小雪', '小周', '阿辉'
    ];

    function startGame() {
        if (typeof PrivacyFlow !== 'undefined' && PrivacyFlow.canEnterGame && !PrivacyFlow.canEnterGame()) {
            console.warn('[启动] 未通过隐私协议，拒绝进入游戏');
            if (PrivacyFlow.begin) {
                PrivacyFlow.begin(function () { startGame(); });
            }
            return;
        }
        if (typeof initGame === 'function') {
            initGame().catch(function (e) { console.error('initGame 启动失败:', e); });
        }
    }

    function showShopNameOverlay(isNewGame) {
        var overlay = document.getElementById('shopNameOverlay');
        var skipWrap = document.getElementById('shopNameSkipWrap');
        var confirmBtn = document.getElementById('shopNameConfirmBtn');
        var playerInput = document.getElementById('playerNameInput');
        var shopInput = document.getElementById('shopNameInput');
        if (overlay) overlay.classList.remove('hidden');
        if (skipWrap) skipWrap.style.display = isNewGame ? 'none' : 'block';
        if (confirmBtn) confirmBtn.textContent = isNewGame ? '下一步：选择仓库' : '确认修改';
        setTimeout(function () {
            if (playerInput && !playerInput.value) playerInput.focus();
            else if (shopInput && !shopInput.value) shopInput.focus();
        }, 300);
    }

    function hideShopNameOverlay() {
        var overlay = document.getElementById('shopNameOverlay');
        if (overlay) overlay.classList.add('hidden');
    }

    function validateAllPlayerInputs() {
        var playerName = ((document.getElementById('playerNameInput') || {}).value || '').trim();
        var shopName = ((document.getElementById('shopNameInput') || {}).value || '').trim();
        var errorMsg = document.getElementById('shopNameErrorMsg');
        var confirmBtn = document.getElementById('shopNameConfirmBtn');
        var playerInput = document.getElementById('playerNameInput');
        var shopInput = document.getElementById('shopNameInput');
        var firstError = null;
        var errorField = null;

        if (playerName.length === 0) {
            firstError = '请输入店主姓名';
            errorField = 'player';
        } else {
            var rp = validateShopName(playerName);
            if (!rp.valid) {
                firstError = '店主姓名：' + rp.message;
                errorField = 'player';
            }
        }
        if (!firstError) {
            if (shopName.length === 0) {
                firstError = '请输入店铺名称';
                errorField = 'shop';
            } else {
                var rs = validateShopName(shopName);
                if (!rs.valid) {
                    firstError = '店铺名称：' + rs.message;
                    errorField = 'shop';
                }
            }
        }

        if (errorMsg) {
            if (firstError) {
                errorMsg.textContent = firstError;
                errorMsg.classList.add('show');
            } else {
                errorMsg.classList.remove('show');
            }
        }
        if (playerInput) playerInput.classList.toggle('error', errorField === 'player');
        if (shopInput) shopInput.classList.toggle('error', errorField === 'shop');
        if (confirmBtn) confirmBtn.disabled = !!firstError;
        return !firstError;
    }

    function bindCharCount(inputId, countId, maxLen) {
        var input = document.getElementById(inputId);
        var count = document.getElementById(countId);
        if (!input || !count) return;
        input.addEventListener('input', function () {
            var len = getCharCount(this.value);
            count.textContent = len + '/' + maxLen;
            count.className = 'shop-name-char-count';
            if (len > maxLen) count.classList.add('error');
            else if (len > maxLen - 2) count.classList.add('warning');
        });
    }

    function bindShopNameEvents(isNewGame) {
        var playerInput = document.getElementById('playerNameInput');
        var shopInput = document.getElementById('shopNameInput');
        var confirmBtn = document.getElementById('shopNameConfirmBtn');
        var randomBtn = document.getElementById('shopNameRandomBtn');
        var skipBtn = document.getElementById('shopNameSkipBtn');
        var entityGrid = document.getElementById('entityTypeGrid');
        var entityHint = document.getElementById('entityTypeHint');

        if (entityGrid && !entityGrid._boundEntity) {
            entityGrid._boundEntity = true;
            entityGrid.addEventListener('click', function (e) {
                var card = e.target && e.target.closest ? e.target.closest('[data-entity-type]') : null;
                if (!card) return;
                var typeId = card.getAttribute('data-entity-type');
                if (!typeId) return;
                selectedEntityType = typeId;
                entityGrid.querySelectorAll('.entity-type-card').forEach(function (el) {
                    el.classList.toggle('selected', el.getAttribute('data-entity-type') === typeId);
                });
                if (entityHint) entityHint.textContent = ENTITY_TYPE_HINTS[typeId] || ('已选：' + typeId);
            });
        }
        if (entityGrid) {
            entityGrid.querySelectorAll('.entity-type-card').forEach(function (el) {
                el.classList.toggle('selected', el.getAttribute('data-entity-type') === selectedEntityType);
            });
        }
        if (entityHint) entityHint.textContent = ENTITY_TYPE_HINTS[selectedEntityType] || ENTITY_TYPE_HINTS.individual;

        bindCharCount('playerNameInput', 'playerNameCharCount', 12);
        bindCharCount('shopNameInput', 'shopNameCharCount', 12);
        [playerInput, shopInput].forEach(function (el) {
            if (!el) return;
            el.addEventListener('input', validateAllPlayerInputs);
            el.addEventListener('keypress', function (e) {
                if (e.key === 'Enter' && confirmBtn && !confirmBtn.disabled) confirmShopName();
            });
        });
        setTimeout(validateAllPlayerInputs, 50);

        if (randomBtn) {
            randomBtn.addEventListener('click', function () {
                var owner = RANDOM_OWNER_NAMES[Math.floor(Math.random() * RANDOM_OWNER_NAMES.length)];
                var shop = RANDOM_SHOP_NAMES[Math.floor(Math.random() * RANDOM_SHOP_NAMES.length)];
                if (playerInput) { playerInput.value = owner; playerInput.dispatchEvent(new Event('input')); }
                if (shopInput) { shopInput.value = shop; shopInput.dispatchEvent(new Event('input')); }
            });
        }
        if (confirmBtn) confirmBtn.addEventListener('click', confirmShopName);
        if (skipBtn) {
            skipBtn.addEventListener('click', function () {
                localStorage.setItem(SHOP_NAME_SET_KEY, 'true');
                localStorage.setItem('temp_player_name', '店主');
                localStorage.setItem('temp_player_address', '');
                localStorage.setItem('temp_entity_type', selectedEntityType || 'individual');
                localStorage.setItem('temp_talent', 'normal');
                if (!localStorage.getItem('temp_shop_name')) {
                    localStorage.setItem('temp_shop_name', '我的小店');
                }
                hideShopNameOverlay();
                startGame();
            });
        }
    }

    function confirmShopName() {
        var playerInput = document.getElementById('playerNameInput');
        var shopInput = document.getElementById('shopNameInput');
        if (!playerInput || !shopInput) return;
        if (!validateAllPlayerInputs()) return;

        var playerName = playerInput.value.trim();
        var shopName = shopInput.value.trim();
        localStorage.setItem(SHOP_NAME_SET_KEY, 'true');
        localStorage.setItem('temp_shop_name', shopName);
        localStorage.setItem('temp_player_name', playerName);
        localStorage.setItem('temp_player_address', '');
        localStorage.setItem('temp_entity_type', selectedEntityType || 'individual');

        if (typeof gameState !== 'undefined' && gameState && gameState.state) {
            gameState.setState(function (s) {
                s.shop.name = shopName;
                s.shop.entityType = selectedEntityType || 'individual';
                s.player = s.player || {};
                s.player.name = playerName;
                s.player.address = s.player.address || '';
            });
        }

        hideShopNameOverlay();
        if (localStorage.getItem(WAREHOUSE_CITY_SET_KEY) === 'true') {
            startGame();
        } else {
            // 新开局流程：店名 → 天赋 → 仓库城市
            showTalentOverlay(true);
            bindTalentEvents(true);
        }
    }

    // ==================== 开局天赋选择 ====================
    function showTalentOverlay(isNewGame) {
        var overlay = document.getElementById('talentOverlay');
        if (!overlay) { // 兜底：没有弹窗直接走仓库城市
            showWarehouseCityOverlay(isNewGame);
            bindWarehouseCityEvents(isNewGame);
            return;
        }
        overlay.classList.remove('hidden');
        renderTalentList();
    }

    function hideTalentOverlay() {
        var overlay = document.getElementById('talentOverlay');
        if (overlay) overlay.classList.add('hidden');
    }

    function renderTalentList() {
        var listContainer = document.getElementById('talentList');
        if (!listContainer) return;
        var talents = (typeof TALENTS !== 'undefined' && Array.isArray(TALENTS)) ? TALENTS : [];
        if (!talents.length) {
            listContainer.innerHTML = '<div style="padding:20px;text-align:center;color:#999;">天赋数据未加载</div>';
            return;
        }
        listContainer.innerHTML = talents.map(function (t) {
            return '<div class="city-card ' + (t.id === selectedTalent ? 'selected' : '') + '"' +
                ' data-talent-id="' + t.id + '"' +
                ' onclick="window.AppOnboardingSelectTalent && window.AppOnboardingSelectTalent(\'' + t.id + '\')">' +
                '<div class="city-card-icon">' + t.icon + '</div>' +
                '<div class="city-card-name">' + t.name + '</div>' +
                '<div class="city-card-tagline">' + t.description + '</div>' +
                '</div>';
        }).join('');
    }

    function selectTalent(talentId) {
        selectedTalent = talentId || 'normal';
        document.querySelectorAll('#talentList .city-card').forEach(function (card) {
            card.classList.toggle('selected', card.getAttribute('data-talent-id') === selectedTalent);
        });
    }

    function bindTalentEvents(isNewGame) {
        var confirmBtn = document.getElementById('talentConfirmBtn');
        var backBtn = document.getElementById('talentBackBtn');
        if (confirmBtn && !confirmBtn._boundTalent) {
            confirmBtn._boundTalent = true;
            confirmBtn.addEventListener('click', function () {
                localStorage.setItem('temp_talent', selectedTalent || 'normal');
                hideTalentOverlay();
                showWarehouseCityOverlay(true);
                bindWarehouseCityEvents(true);
            });
        }
        if (backBtn && !backBtn._boundTalent) {
            backBtn._boundTalent = true;
            backBtn.addEventListener('click', function () {
                hideTalentOverlay();
                showShopNameOverlay(isNewGame);
            });
        }
    }

    function showWarehouseCityOverlay(isNewGame) {
        var overlay = document.getElementById('warehouseCityOverlay');
        var backBtn = document.getElementById('warehouseCityBackBtn');
        if (overlay) overlay.classList.remove('hidden');
        if (backBtn) backBtn.style.display = isNewGame ? 'none' : 'block';
        renderWarehouseCityList();
        selectWarehouseCity('yiwu');
    }

    function hideWarehouseCityOverlay() {
        var overlay = document.getElementById('warehouseCityOverlay');
        if (overlay) overlay.classList.add('hidden');
    }

    function renderWarehouseCityList() {
        var listContainer = document.getElementById('warehouseCityList');
        if (!listContainer || typeof WAREHOUSE_CITIES === 'undefined') return;
        listContainer.innerHTML = WAREHOUSE_CITIES.map(function (city) {
            return '<div class="city-card ' + (city.id === selectedWarehouseCity ? 'selected' : '') + '"' +
                ' data-city-id="' + city.id + '"' +
                ' onclick="selectWarehouseCity(\'' + city.id + '\')">' +
                '<div class="city-card-icon">' + city.icon + '</div>' +
                '<div class="city-card-name">' + city.name + '</div>' +
                '<div class="city-card-tagline">' + city.tagline + '</div>' +
                '<span class="city-card-difficulty" style="color:' + city.difficultyColor + '">' + city.difficulty + '</span>' +
                '</div>';
        }).join('');
    }

    function selectWarehouseCity(cityId) {
        selectedWarehouseCity = cityId;
        var city = getCityById(cityId);
        document.querySelectorAll('.city-card').forEach(function (card) {
            card.classList.toggle('selected', card.dataset.cityId === cityId);
        });
        var iconEl = document.getElementById('cityDetailIcon');
        var nameEl = document.getElementById('cityDetailName');
        var taglineEl = document.getElementById('cityDetailTagline');
        var difficultyEl = document.getElementById('cityDifficultyBadge');
        var descEl = document.getElementById('cityDetailDesc');
        var advantagesEl = document.getElementById('cityAdvantages');
        var disadvantagesEl = document.getElementById('cityDisadvantages');
        if (iconEl) iconEl.textContent = city.icon;
        if (nameEl) nameEl.textContent = city.name;
        if (taglineEl) taglineEl.textContent = city.tagline;
        if (difficultyEl) {
            difficultyEl.textContent = city.difficulty;
            difficultyEl.style.background = city.difficultyColor + '20';
            difficultyEl.style.color = city.difficultyColor;
        }
        if (descEl) descEl.textContent = city.description;
        if (advantagesEl) advantagesEl.innerHTML = city.advantages.map(function (a) { return '<li>' + a + '</li>'; }).join('');
        if (disadvantagesEl) disadvantagesEl.innerHTML = city.disadvantages.map(function (d) { return '<li>' + d + '</li>'; }).join('');
    }

    function bindWarehouseCityEvents(isNewGame) {
        var confirmBtn = document.getElementById('warehouseCityConfirmBtn');
        var backBtn = document.getElementById('warehouseCityBackBtn');
        if (confirmBtn && !confirmBtn._boundCity) {
            confirmBtn._boundCity = true;
            confirmBtn.addEventListener('click', confirmWarehouseCity);
        }
        if (backBtn && !backBtn._boundCity) {
            backBtn._boundCity = true;
            backBtn.addEventListener('click', function () {
                hideWarehouseCityOverlay();
                // 新开局返回天赋选择，老档修改返回店名
                if (isNewGame && document.getElementById('talentOverlay')) {
                    showTalentOverlay(true);
                    bindTalentEvents(true);
                } else {
                    showShopNameOverlay(isNewGame);
                }
            });
        }
    }

    function confirmWarehouseCity() {
        showCityConfirmModal(getCityById(selectedWarehouseCity));
    }

    function showCityConfirmModal(city) {
        var confirmOverlay = document.createElement('div');
        confirmOverlay.id = 'cityConfirmOverlay';
        confirmOverlay.className = 'city-confirm-overlay';
        confirmOverlay.innerHTML =
            '<div class="city-confirm-modal">' +
            '<div class="city-confirm-header">' +
            '<div class="city-confirm-icon">' + city.icon + '</div>' +
            '<div class="city-confirm-title">确认选择「' + city.name + '」作为仓库地址？</div>' +
            '<div class="city-confirm-subtitle">' + city.tagline + ' · ' + city.province + '</div>' +
            '</div>' +
            '<div class="city-confirm-desc">' + city.description + '</div>' +
            '<div class="city-confirm-tip">💡 提示：仓库地址确定后不可更改，请谨慎选择</div>' +
            '<div class="city-confirm-actions">' +
            '<button class="btn btn-secondary" id="cityConfirmBackBtn">重新选择</button>' +
            '<button class="btn btn-primary" id="cityConfirmOkBtn">确认，开始创业</button>' +
            '</div></div>';
        document.body.appendChild(confirmOverlay);
        document.getElementById('cityConfirmBackBtn').addEventListener('click', function () {
            confirmOverlay.remove();
        });
        document.getElementById('cityConfirmOkBtn').addEventListener('click', function () {
            confirmOverlay.remove();
            proceedWithCity();
        });
    }

    function proceedWithCity() {
        localStorage.setItem(WAREHOUSE_CITY_SET_KEY, 'true');
        localStorage.setItem('temp_warehouse_city', selectedWarehouseCity);
        hideWarehouseCityOverlay();
        startGame();
    }

    async function afterPrivacy() {
        if (typeof PrivacyFlow !== 'undefined' && PrivacyFlow.canEnterGame && !PrivacyFlow.canEnterGame()) {
            console.warn('[启动] afterPrivacy 被拦截：未通过隐私协议');
            return;
        }
        var forceNew = !!g.__forceNewGameFlow;
        try { if (sessionStorage.getItem('ecommerce_sim_fresh_start') === '1') forceNew = true; } catch (_) {}
        if (forceNew) {
            g.__forceNewGameFlow = false;
            g.__ecommerceSimContinueSave = false;
            g.__ecommerceSimFreshStart = true;
            console.log('[启动] 重新开始：强制新建流程（第1天）');
            showShopNameOverlay(true);
            bindShopNameEvents(true);
            return;
        }

        var hasSave = false;
        try {
            if (typeof saveManager !== 'undefined') {
                if (typeof saveManager.hasAnySave === 'function') {
                    hasSave = saveManager.hasAnySave();
                } else {
                    hasSave = !!saveManager._lsGetRaw(saveManager.META_KEY_PREFIX + 'main');
                }
                if (!hasSave && typeof saveManager.probeIDBHasSave === 'function') {
                    hasSave = await saveManager.probeIDBHasSave();
                }
            }
        } catch (_) { hasSave = false; }

        if (hasSave) {
            console.log('[启动] 检测到存档（含旧版兼容），直接进入游戏（跳过店铺信息输入）');
            g.__ecommerceSimContinueSave = true;
            startGame();
        } else {
            g.__ecommerceSimContinueSave = false;
            showShopNameOverlay(true);
            bindShopNameEvents(true);
        }
    }

    g.AppOnboarding = {
        afterPrivacy: afterPrivacy,
        showShopNameOverlay: showShopNameOverlay,
        showWarehouseCityOverlay: showWarehouseCityOverlay
    };
    g.AppOnboardingSelectTalent = selectTalent;
    g.selectWarehouseCity = selectWarehouseCity;
    g.checkShopNameAndInit = afterPrivacy;
})(window);
