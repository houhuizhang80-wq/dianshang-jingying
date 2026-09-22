/**
 * shopsUI.js — 多店铺系统 UI（阶段A：地基）
 * 提供：店铺列表弹窗 / 开店弹窗（选类型+城市+确认）/ 店铺详情弹窗（概览+定价）。
 * 用法：shopsUI.openShopsModal()
 */

(function () {
    'use strict';

    let _gameState = null;
    let _ui = null;
    let _shops = null;
    let _hubTab = 'overview';
    let _pickedType = 'retail';

    function init(gameState, uiManager, shopsState) {
        _gameState = gameState;
        _ui = uiManager;
        _shops = shopsState;
        return { success: true };
    }

    function _ensureBound() {
        if (!_gameState && typeof gameState !== 'undefined') _gameState = gameState;
        if (!_ui && typeof ui !== 'undefined') _ui = ui;
        if (!_shops && _gameState && _gameState.shops) _shops = _gameState.shops;
        if (!_shops && typeof ShopsState !== 'undefined' && _gameState) {
            try {
                _shops = new ShopsState(_gameState);
                _shops.init(_gameState);
                _gameState.shops = _shops;
            } catch (_) {}
        }
    }

    function _gs() { _ensureBound(); return _gameState; }
    function _uiRef() { _ensureBound(); return _ui; }
    function _shopsRef() { _ensureBound(); return _shops; }

    function _fmt(n) {
        const v = Number(n) || 0;
        return '¥' + v.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }

    function _cityOptions() {
        const cityIds = (typeof WAREHOUSE_CITIES !== 'undefined') ? WAREHOUSE_CITIES : null;
        if (cityIds && Array.isArray(cityIds) && cityIds.length) {
            return cityIds.map(c => ({ id: c.id || c, name: c.name || c }));
        }
        const ALL = (typeof ALL_CITIES !== 'undefined') ? ALL_CITIES : null;
        if (ALL && Array.isArray(ALL) && ALL.length) {
            return ALL.map(c => ({ id: c.id || c, name: c.name || c }));
        }
        return ['杭州', '上海', '北京', '广州', '深圳', '成都'].map(c => ({ id: c, name: c }));
    }

    function switchHubTab(tab) {
        _hubTab = tab || 'overview';
        openShopsModal();
    }

    function _shopCard(s, types) {
        const t = types[s.type] || { icon: '🏪', name: s.type };
        const invCount = Object.keys(s.inventory || {}).length;
        const st = s.stats || {};
        const venue = (s.type === 'retail' && typeof RETAIL_VENUE_BY_ID !== 'undefined' && s.retail)
            ? RETAIL_VENUE_BY_ID[s.retail.venue] : null;
        const plat = (s.type === 'delivery' && typeof DELIVERY_PLATFORM_BY_ID !== 'undefined' && s.delivery)
            ? DELIVERY_PLATFORM_BY_ID[s.delivery.platform] : null;
        const extra = venue
            ? `${venue.icon} ${venue.name} · 会员${(s.retail && s.retail.members) || 0}`
            : (plat
                ? `${plat.icon} ${plat.name} · ${(s.delivery && s.delivery.rating) || '-'}分 · ${(s.delivery && s.delivery.kitchenOpen === false) ? '已打烊' : (s.delivery.radiusKm || 3) + 'km'}`
                : `库存${invCount}类`);
        return `
            <div style="display:flex;align-items:center;gap:10px;padding:12px;margin:8px 0;background:#fff;border-radius:12px;box-shadow:0 1px 6px rgba(0,0,0,.06);">
                <div style="font-size:28px;">${t.icon || '🏪'}</div>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:14px;font-weight:800;color:#222;">${s.name}</div>
                    <div style="font-size:11px;color:#888;margin-top:3px;">${t.name} · ${s.location || ''} · ${extra}</div>
                    <div style="font-size:11px;color:#555;margin-top:4px;">今日 ${_fmt(st.todayIncome || 0)} · 净利 ${_fmt(st.todayNet || 0)} · 月租 ${_fmt(s.rent || 0)}</div>
                </div>
                <button class="btn btn-sm btn-primary" onclick="shopsUI.openShopDetail('${s.id}')">经营</button>
            </div>`;
    }

    function openShopsModal() {
        const u = _uiRef();
        const sh = _shopsRef();
        if (!u || !sh) {
            try { (u || (typeof ui !== 'undefined' ? ui : null))?.showToast('门店系统未就绪，请刷新后再试'); } catch (_) {}
            return;
        }
        const types = (typeof SHOP_TYPES !== 'undefined') ? SHOP_TYPES : {};
        const all = sh.getChannelShops();
        const retail = all.filter(s => s && s.type === 'retail');
        const delivery = all.filter(s => s && s.type === 'delivery');
        const other = all.filter(s => s && s.type !== 'retail' && s.type !== 'delivery');
        const sum = (typeof sh.getOfflineSummary === 'function') ? sh.getOfflineSummary() : {
            retailCount: retail.length, deliveryCount: delivery.length,
            retailToday: 0, deliveryToday: 0, pendingTransfers: 0
        };
        const tab = _hubTab || 'overview';
        const tabs = [
            { id: 'overview', name: '总览' },
            { id: 'retail', name: `零售店 ${retail.length}` },
            { id: 'delivery', name: `外卖店 ${delivery.length}` },
            { id: 'open', name: '开新店' }
        ];
        const tabBar = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">
            ${tabs.map(t => `<button class="btn ${tab === t.id ? 'btn-primary' : 'btn-secondary'} btn-small" onclick="shopsUI.switchHubTab('${t.id}')">${t.name}</button>`).join('')}
        </div>`;

        let body = '';
        if (tab === 'overview') {
            body = `
                <div style="font-size:12px;color:#666;line-height:1.6;margin-bottom:10px;">
                    这里主做<strong>线下零售</strong>和<strong>外卖档口</strong>：零售拼选址、店员、到店体验；外卖拼平台、评分、出餐和配送半径。货从总仓调拨到店后，每天自动卖货扣库存。
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
                    <div style="background:#fff5f5;border-radius:12px;padding:12px;">
                        <div style="font-size:11px;color:#c62828;">🏬 零售店</div>
                        <div style="font-size:20px;font-weight:800;color:#c62828;">${sum.retailCount}</div>
                        <div style="font-size:11px;color:#888;">今日 ${_fmt(sum.retailToday)}</div>
                    </div>
                    <div style="background:#f0fff4;border-radius:12px;padding:12px;">
                        <div style="font-size:11px;color:#2e7d32;">🛵 外卖店</div>
                        <div style="font-size:20px;font-weight:800;color:#2e7d32;">${sum.deliveryCount}</div>
                        <div style="font-size:11px;color:#888;">今日 ${_fmt(sum.deliveryToday)}</div>
                    </div>
                </div>
                ${sum.pendingTransfers ? `<div style="font-size:12px;color:#e65100;margin-bottom:8px;">🚚 在途调拨 ${sum.pendingTransfers} 单</div>` : ''}
                ${retail.length + delivery.length
                    ? [...retail, ...delivery].map(s => _shopCard(s, types)).join('')
                    : '<div style="text-align:center;color:#999;padding:28px 8px;">还没有线下门店。<br>去「开新店」开一家零售店或外卖店。</div>'}`;
        } else if (tab === 'retail') {
            body = retail.length
                ? retail.map(s => _shopCard(s, types)).join('')
                : '<div style="text-align:center;color:#999;padding:28px;">暂无零售店。商场/临街/社区选址会直接影响客流和租金。</div>';
        } else if (tab === 'delivery') {
            body = delivery.length
                ? delivery.map(s => _shopCard(s, types)).join('')
                : '<div style="text-align:center;color:#999;padding:28px;">暂无外卖店。入驻美团/饿了么后靠评分和出餐接单。</div>';
        } else {
            body = _renderOpenShopBody();
        }

        const footer = tab === 'open'
            ? `<button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>
               <button class="btn btn-primary" onclick="shopsUI.confirmOpenShop()">确认开店</button>`
            : `<button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>
               <button class="btn btn-primary" onclick="shopsUI.switchHubTab('open')">＋ 开新店</button>`;

        u.showModal('🏪 线下门店', `
            <div style="padding:10px 8px;max-height:62vh;overflow:auto;">
                ${tabBar}${body}
                ${other.length && tab === 'overview' ? `<div style="margin-top:14px;font-size:12px;color:#888;">其他线上渠道 ${other.length} 家（拼多多/抖音等仍可在开店里开设）</div>${other.map(s => _shopCard(s, types)).join('')}` : ''}
            </div>`, footer, { noBodyPadding: true, modalId: 'shopsModal', width: '560px' });
    }

    function openOpenShopModal() {
        switchHubTab('open');
    }

    function _typeCard(tid, t, shopLv, picked) {
        const locked = t.unlockLevel > shopLv;
        const sel = picked === tid && !locked;
        return `
            <div onclick="${locked ? '' : "shopsUI.pickShopType('" + tid + "')"}"
                 id="shoptype_${tid}"
                 style="display:flex;align-items:center;gap:10px;padding:12px;margin:8px 0;background:${sel ? '#e3f2fd' : (locked ? '#f5f5f5' : '#fff')};border:2px solid ${sel ? '#1976d2' : (locked ? '#eee' : '#f0f0f0')};border-radius:12px;cursor:${locked ? 'not-allowed' : 'pointer'};opacity:${locked ? 0.55 : 1};">
                <div style="font-size:28px;">${t.icon || '🏪'}</div>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:14px;font-weight:800;color:#222;">${t.name}${locked ? ' <span style="font-size:10px;color:#f44336;">需Lv.' + t.unlockLevel + '</span>' : ''}</div>
                    <div style="font-size:11px;color:#777;margin-top:3px;line-height:1.45;">${t.desc || ''}</div>
                </div>
                <div style="text-align:right;font-size:11px;color:#555;white-space:nowrap;">
                    <div>开店 ${_fmt(t.openCost)}</div>
                    <div>月租 ${_fmt(t.rentBase)}</div>
                </div>
            </div>`;
    }

    function _renderOpenShopBody() {
        const shopLv = (_gs() && _gs().state.shop && _gs().state.shop.level) || 1;
        const types = (typeof SHOP_TYPES !== 'undefined') ? SHOP_TYPES : {};
        const cities = _cityOptions();
        const focusIds = ['retail', 'delivery'];
        const otherIds = Object.keys(types).filter(id => id !== 'online' && focusIds.indexOf(id) < 0);
        if (!_pickedType) _pickedType = 'retail';
        return `
            <div style="font-size:12px;color:#666;margin-bottom:8px;">先开<strong>线下零售</strong>或<strong>外卖档口</strong>（当前集团店铺 Lv.${shopLv}）</div>
            ${focusIds.map(id => types[id] ? _typeCard(id, types[id], shopLv, _pickedType) : '').join('')}
            ${otherIds.length ? `<details style="margin-top:8px;"><summary style="font-size:12px;color:#888;cursor:pointer;">其他线上渠道（拼多多 / 抖音小店）</summary>
                ${otherIds.map(id => _typeCard(id, types[id], shopLv, _pickedType)).join('')}
            </details>` : ''}
            <div style="font-size:12px;color:#888;margin:12px 0 6px;">开设城市</div>
            <select id="shopOpenCity" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:13px;background:#fff;">
                ${cities.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
            </select>
            <div style="font-size:11px;color:#999;margin-top:8px;line-height:1.5;">开店先付一次性费用；零售按选址收月租，外卖按平台抽成+骑手费日结。</div>
        `;
    }
    function pickShopType(typeId) {
        _pickedType = typeId;
        const types = (typeof SHOP_TYPES !== 'undefined') ? SHOP_TYPES : {};
        const t = types[typeId];
        Object.keys(types).forEach(id => {
            const el = document.getElementById('shoptype_' + id);
            if (el) {
                const locked = (types[id] && types[id].unlockLevel > ((_gs().state.shop && _gs().state.shop.level) || 1));
                el.style.borderColor = (id === typeId && !locked) ? '#1976d2' : (locked ? '#eee' : 'transparent');
            }
        });
        if (t && window.ui) window.ui.showToast(`已选：${t.name}（开店费 ${_fmt(t.openCost)}）`);
    }

    function confirmOpenShop() {
        const sh = _shopsRef();
        const u = _uiRef();
        if (!sh || !u) {
            try { (typeof ui !== 'undefined' && ui.showToast) && ui.showToast('门店系统未就绪'); } catch (_) {}
            return;
        }
        if (!_pickedType) { u.showToast('请先选择店铺类型'); return; }
        const cityEl = document.getElementById('shopOpenCity');
        const cityOpt = cityEl && cityEl.options && cityEl.selectedIndex >= 0
            ? cityEl.options[cityEl.selectedIndex] : null;
        const city = (cityOpt && (cityOpt.text || cityOpt.value)) || (cityEl ? cityEl.value : '') || '';
        const res = sh.openShop(_pickedType, city);
        u.showToast(res.message || (res.success ? '开店成功' : '开店失败'));
        if (res.success) {
            _hubTab = (_pickedType === 'delivery') ? 'delivery' : (_pickedType === 'retail' ? 'retail' : 'overview');
            _pickedType = 'retail';
            openShopsModal();
        }
    }

    /** 店铺详情弹窗：概览 + 库存 + 定价 */
    function openShopDetail(shopId) {
        const u = _uiRef();
        const sh = _shopsRef();
        if (!u || !sh) return;
        const shop = sh.getShopById(shopId);
        if (!shop) { u.showToast('店铺不存在'); return; }
        const types = (typeof SHOP_TYPES !== 'undefined') ? SHOP_TYPES : {};
        const t = types[shop.type] || { icon: '🏪', name: shop.type };

        // 库存列表（按品类简单展示）
        const inv = shop.inventory || {};
        const invIds = Object.keys(inv);
        let invHtml = '';
        if (invIds.length) {
            const PRODS = (typeof PRODUCTS !== 'undefined') ? PRODUCTS : [];
            invHtml = invIds.slice(0, 12).map(pid => {
                const p = PRODS.find(x => x && x.id === pid);
                const tag = (p && _shopsRef() && typeof _shopsRef().getChannelTag === 'function') ? _shopsRef().getChannelTag(p) : null;
                const tagHtml = tag ? `<span style="font-size:9px;padding:0 4px;border-radius:6px;background:#f3f4f6;color:#6b7280;margin-left:4px;">${tag.tag}</span>` : '';
                return `<div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;padding:4px 0;color:#555;border-bottom:1px dashed #eee;">
                    <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p ? p.name : pid}${tagHtml}</span><span style="white-space:nowrap;">×${inv[pid]}</span>
                </div>`;
            }).join('');
            if (invIds.length > 12) invHtml += `<div style="font-size:11px;color:#999;padding:4px 0;">…共 ${invIds.length} 类</div>`;
        } else {
            invHtml = '<div style="font-size:12px;color:#999;padding:8px 0;">暂无库存（调拨功能阶段B开放）</div>';
        }

        // 定价覆盖列表
        const ovr = shop.priceOverrides || {};
        const ovrIds = Object.keys(ovr);
        let ovrHtml = '';
        if (ovrIds.length) {
            const PRODS = (typeof PRODUCTS !== 'undefined') ? PRODUCTS : [];
            ovrHtml = ovrIds.slice(0, 8).map(pid => {
                const p = PRODS.find(x => x && x.id === pid);
                const base = p ? (p.basePrice || 0) : 0;
                return `<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;color:#555;border-bottom:1px dashed #eee;">
                    <span>${p ? p.name : pid}</span><span>${(ovr[pid] || 1).toFixed(2)}×（${_fmt(base * (ovr[pid] || 1))}）</span>
                </div>`;
            }).join('');
            if (ovrIds.length > 8) ovrHtml += `<div style="font-size:11px;color:#999;padding:4px 0;">…共 ${ovrIds.length} 项</div>`;
        } else {
            ovrHtml = '<div style="font-size:12px;color:#999;padding:8px 0;">跟随默认定价</div>';
        }

        // 员工列表
        const staffIds = (shop.staff) || [];
        let staffHtml = '';
        if (staffIds.length) {
            const emps = (_gs().state.employees) || [];
            staffHtml = staffIds.slice(0, 8).map(eid => {
                const emp = emps.find(e => e && e.id === eid);
                return `<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;color:#555;border-bottom:1px dashed #eee;">
                    <span>${emp ? (emp.name + ' · ' + (emp.type || '')) : eid}</span>
                    <span style="cursor:pointer;color:#f44336;" onclick="shopsUI.unassignStaff('${shop.id}','${eid}')">调回</span>
                </div>`;
            }).join('');
        } else {
            staffHtml = '<div style="font-size:12px;color:#999;padding:8px 0;">暂无员工，点「派员工」安排店长/店员（每人销量+8%起）</div>';
        }

        // 近7天销量图表（极简柱状）
        const hist = (shop.stats && shop.stats.dailyHistory) ? shop.stats.dailyHistory.slice(-7) : [];
        let chartHtml = '';
        if (hist.length) {
            const maxV = Math.max(1, ...hist.map(d => d.sales || 0));
            chartHtml = `<div style="display:flex;align-items:flex-end;gap:6px;height:60px;padding:6px 2px;">
                ${hist.map(d => {
                    const h = Math.max(3, Math.round(((d.sales || 0) / maxV) * 48));
                    return `<div style="flex:1;text-align:center;">
                        <div style="height:${h}px;background:linear-gradient(180deg,#4facfe,#667eea);border-radius:3px 3px 0 0;"></div>
                        <div style="font-size:9px;color:#999;margin-top:2px;">D${d.day}</div>
                    </div>`;
                }).join('')}
            </div>`;
        } else {
            chartHtml = '<div style="font-size:12px;color:#999;padding:8px 0;">暂无销量数据（开业后每日生成）</div>';
        }

        function dayNum() { return (_gs().state.gameTime && _gs().state.gameTime.day) || 1; }

        let opsHtml = '';
        if (shop.type === 'retail') {
            if (typeof sh._initOfflineFields === 'function') sh._initOfflineFields(shop);
            const venues = (typeof RETAIL_VENUES !== 'undefined') ? RETAIL_VENUES : [];
            const curV = (shop.retail && shop.retail.venue) || 'street';
            opsHtml = `
            <div style="background:#fff5f5;border-radius:12px;padding:10px;margin:8px 0;">
                <div style="font-size:13px;font-weight:800;color:#c62828;margin-bottom:6px;">🏬 零售经营</div>
                <div style="font-size:11px;color:#666;margin-bottom:8px;">到店客流看选址；没店员会严重掉销量。会员随销售慢慢涨，带动复购。</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;">
                    ${venues.map(v => `<button class="btn btn-small ${curV === v.id ? 'btn-primary' : 'btn-secondary'}" onclick="shopsUI.setRetailVenue('${shop.id}','${v.id}')">${v.icon} ${v.name}</button>`).join('')}
                </div>
                <div style="font-size:11px;color:#888;margin-top:8px;">会员 ${(shop.retail && shop.retail.members) || 0} 人 · 营业 9:00–21:00 · 试穿连带已计入日结</div>
            </div>`;
        } else if (shop.type === 'delivery') {
            if (typeof sh._initOfflineFields === 'function') sh._initOfflineFields(shop);
            const plats = (typeof DELIVERY_PLATFORMS !== 'undefined') ? DELIVERY_PLATFORMS : [];
            const curP = (shop.delivery && shop.delivery.platform) || 'meituan';
            const openKit = !(shop.delivery && shop.delivery.kitchenOpen === false);
            opsHtml = `
            <div style="background:#f0fff4;border-radius:12px;padding:10px;margin:8px 0;">
                <div style="font-size:13px;font-weight:800;color:#2e7d32;margin-bottom:6px;">🛵 外卖经营</div>
                <div style="font-size:11px;color:#666;margin-bottom:8px;">平台抽成换流量。评分低、没店员、档口打烊都会没单。配送越远覆盖越大但骑手费更高。</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
                    ${plats.map(p => `<button class="btn btn-small ${curP === p.id ? 'btn-primary' : 'btn-secondary'}" onclick="shopsUI.setDeliveryPlatform('${shop.id}','${p.id}')">${p.icon} ${p.name}</button>`).join('')}
                </div>
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;">
                    <span>评分 <b>${(shop.delivery && shop.delivery.rating) || 4.6}</b></span>
                    <span>半径</span>
                    <select id="delivRadius" onchange="shopsUI.setDeliveryRadius('${shop.id}', this.value)" style="padding:4px 6px;border-radius:6px;border:1px solid #ddd;">
                        ${[1,2,3,5,8].map(k => `<option value="${k}" ${(shop.delivery && shop.delivery.radiusKm) === k ? 'selected' : ''}>${k}公里</option>`).join('')}
                    </select>
                    <button class="btn btn-small ${openKit ? 'btn-primary' : 'btn-secondary'}" onclick="shopsUI.toggleKitchen('${shop.id}')">${openKit ? '档口出餐中' : '档口已打烊'}</button>
                </div>
            </div>`;
        }

        const actionHtml = shop.isMain ? '' : `
            <div class="shop-detail-actions">
                <button class="btn btn-primary" onclick="shopsUI.openTransferModal('${shop.id}')">调拨入库</button>
                <button class="btn" onclick="shopsUI.toggleShareInventory('${shop.id}')">${shop.shareInventory ? '关闭共享库存' : '开启共享库存'}</button>
                <button class="btn" onclick="shopsUI.openBulkPriceModal('${shop.id}')">批量调价</button>
                <button class="btn" onclick="shopsUI.openStaffModal('${shop.id}')">派员工</button>
                <button class="btn" onclick="shopsUI.openPromoModal('${shop.id}')">清仓促销</button>
                <button class="btn" onclick="shopsUI.openDecorModal('${shop.id}')">🎨 装修</button>
                <button class="btn" onclick="shopsUI.upgradeShop('${shop.id}')">升级 Lv.${(shop.level || 1) + 1}</button>
                <button class="btn" style="color:#f44336;border:1px solid #f44336;" onclick="shopsUI.confirmCloseShop('${shop.id}')">关闭店铺</button>
            </div>`;

        const content = `
            <div class="shop-detail-body">
            <div style="display:flex;align-items:center;gap:10px;padding-bottom:8px;border-bottom:1px solid #eee;margin-bottom:8px;">
                <div style="font-size:30px;">${t.icon || '🏪'}</div>
                <div style="flex:1;">
                    <div style="font-size:15px;font-weight:700;color:#333;">${shop.name}</div>
                    <div style="font-size:12px;color:#999;">${t.name || shop.type} · ${shop.location || ''}（${shop.region || ''}）</div>
                </div>
                <div style="text-align:right;font-size:12px;color:#666;">
                    <div>信誉 <b style="color:${shop.reputation >= 80 ? '#4caf50' : shop.reputation >= 50 ? '#ff9800' : '#f44336'};">${shop.reputation}</b></div>
                    <div>月租 ${_fmt(shop.rent)}</div>
                </div>
            </div>
            ${opsHtml}
            ${shop.stats ? `<div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
                <div style="flex:1;min-width:88px;text-align:center;background:#f6f9ff;border-radius:8px;padding:6px 4px;">
                    <div style="font-size:11px;color:#999;">今日销量</div>
                    <div style="font-size:14px;font-weight:700;color:#333;">${shop.stats.todaySales || 0}件</div>
                </div>
                <div style="flex:1;min-width:88px;text-align:center;background:#f0fdf4;border-radius:8px;padding:6px 4px;">
                    <div style="font-size:11px;color:#999;">今日收入</div>
                    <div style="font-size:14px;font-weight:700;color:#16a34a;">${_fmt(shop.stats.todayIncome || 0)}</div>
                </div>
                <div style="flex:1;min-width:88px;text-align:center;background:#fffbeb;border-radius:8px;padding:6px 4px;">
                    <div style="font-size:11px;color:#999;">累计收入</div>
                    <div style="font-size:14px;font-weight:700;color:#d97706;">${_fmt(shop.stats.totalIncome || 0)}</div>
                </div>
            </div>` : ''}
            ${shop.isMain ? '' : `
            <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;">
                <span style="font-size:11px;padding:2px 8px;border-radius:999px;background:#f3f4f6;color:#555;">Lv.${shop.level || 1}</span>
                ${shop.promotion && shop.promotion.endDay >= dayNum() ? `<span style="font-size:11px;padding:2px 8px;border-radius:999px;background:#fef3c7;color:#b45309;">🔥清仓 ${Math.round(shop.promotion.discountRate * 100)}%</span>` : ''}
                ${(shop.staff && shop.staff.length) ? `<span style="font-size:11px;padding:2px 8px;border-radius:999px;background:#e0f2fe;color:#0369a1;">👥员工${shop.staff.length}</span>` : ''}
                ${shop.type === 'delivery' ? `<span style="font-size:11px;padding:2px 8px;border-radius:999px;background:#dcfce7;color:#15803d;">🛵外卖</span>` : ''}
                ${shop.shareInventory ? `<span style="font-size:11px;padding:2px 8px;border-radius:999px;background:#fce7f3;color:#be185d;">🔗共享库存</span>` : ''}
            </div>`}
            <div style="font-size:13px;font-weight:700;color:#444;margin:8px 0 4px;">📦 库存（${invIds.length} 类）</div>
            ${invHtml}
            ${shop.isMain ? '' : `
            <div style="font-size:13px;font-weight:700;color:#444;margin:10px 0 4px;">👥 门店员工（${(shop.staff || []).length}人）</div>
            ${staffHtml}
            <div style="font-size:13px;font-weight:700;color:#444;margin:10px 0 4px;">📈 近7天销量</div>
            ${chartHtml}`}
            <div style="font-size:13px;font-weight:700;color:#444;margin:10px 0 4px;">💲 独立定价（${ovrIds.length} 项）</div>
            ${ovrHtml}
            <div style="font-size:11px;color:#aaa;margin-top:10px;">调拨：从总仓拨货到本店，含运输时间与运费；渠道店每日按渠道适配/价格弹性/信誉/员工/促销自动结算。</div>
            ${actionHtml}
            </div>
        `;
        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">返回</button>
        `;
        u.showModal('🏪 店铺详情', content, footer, { noBodyPadding: true, modalId: 'shopDetailModal', width: '560px' });
    }

    /** 调拨弹窗：选商品 + 数量 */
    function openTransferModal(shopId) {
        const u = _uiRef();
        const sh = _shopsRef();
        if (!u || !sh) return;
        const shop = sh.getShopById(shopId);
        if (!shop) return;
        const inv = ((_gs() && _gs().state && _gs().state.inventory) || []);
        const qtyMap = {};
        inv.forEach(it => {
            if (!it || !(it.quantity > 0) || !it.productId) return;
            qtyMap[it.productId] = (qtyMap[it.productId] || 0) + Number(it.quantity);
        });
        const rows = Object.keys(qtyMap).map(id => {
            const p = (typeof getProductById === 'function') ? getProductById(id) : null;
            const name = (p && p.name) || id;
            return { id, name, qty: qtyMap[id], price: (p && p.basePrice) || 0 };
        }).sort((a, b) => b.price - a.price);
        const options = rows.map(r => `<option value="${r.id}" data-name="${String(r.name).replace(/"/g, '')}">${r.name}（仓${r.qty}）</option>`);
        const prodSel = options.length
            ? `<input id="transferSearch" type="search" placeholder="搜索商品名 / ID" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:13px;margin-bottom:6px;box-sizing:border-box;" oninput="shopsUI.filterTransferOptions()">
               <select id="transferProd" size="${Math.min(10, options.length)}" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:13px;">${options.join('')}</select>
               <div style="font-size:11px;color:#888;margin-top:4px;">共 ${options.length} 种有货商品，按金额从高到低</div>`
            : '<div style="font-size:12px;color:#f44336;padding:8px 0;">总仓暂无库存，请先采购</div>';
        const content = `
            <div style="font-size:12px;color:#888;margin-bottom:6px;">调拨目标：${shop.name}（${shop.location}）</div>
            <div style="font-size:12px;color:#888;margin:6px 0;">选择商品（全部库存）</div>
            ${prodSel}
            <div style="font-size:12px;color:#888;margin:10px 0 6px;">调拨数量</div>
            <div style="display:flex;gap:6px;align-items:center;">
                <input type="number" id="transferQty" min="1" value="10" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:13px;box-sizing:border-box;" />
                <button class="btn btn-sm" style="white-space:nowrap;" onclick="shopsUI.applyRecommendQty('${shop.id}')">按推荐量</button>
            </div>
            <div id="transferRecommendTip" style="font-size:11px;color:#16a34a;margin-top:6px;"></div>
            <div style="font-size:11px;color:#aaa;margin-top:10px;">同城 2~4 小时送达，跨区域 8~24 小时；运费按重量计算，到货后自动入库。</div>
        `;
        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>
            <button class="btn btn-primary" onclick="shopsUI.confirmTransfer('${shop.id}')">确认调拨</button>
        `;
        u.showModal('🚚 库存调拨', content, footer, { noBodyPadding: true, modalId: 'transferModal' });
    }

    function filterTransferOptions() {
        const q = String((document.getElementById('transferSearch') || {}).value || '').trim().toLowerCase();
        const sel = document.getElementById('transferProd');
        if (!sel) return;
        const opts = sel.options;
        for (let i = 0; i < opts.length; i++) {
            const t = String(opts[i].text || '').toLowerCase();
            const id = String(opts[i].value || '').toLowerCase();
            opts[i].hidden = !!(q && t.indexOf(q) < 0 && id.indexOf(q) < 0);
        }
    }

    function confirmTransfer(shopId) {
        const u = _uiRef();
        const sh = _shopsRef();
        if (!u || !sh) return;
        const prodEl = document.getElementById('transferProd');
        const qtyEl = document.getElementById('transferQty');
        if (!prodEl || !prodEl.value) { u.showToast('请选择商品'); return; }
        const qty = parseInt(qtyEl ? qtyEl.value : '0', 10);
        const res = sh.createTransfer(shopId, prodEl.value, qty);
        u.showToast(res.message || (res.success ? '调拨已下单' : '调拨失败'));
        if (res.success) {
            u.closeModal();
            openShopDetail(shopId);
        }
    }

    function confirmCloseShop(shopId) {
        const u = _uiRef();
        const sh = _shopsRef();
        if (!u || !sh) return;
        if (!window.confirm('确认关闭该店铺？库存将作废，返还30%开店费。')) return;
        const res = sh.closeShop(shopId);
        u.showToast(res.message || '已关闭');
        u.closeModal();
        openShopsModal();
    }

    // ==================== P0-3：一键调拨推荐量 ====================
    function applyRecommendQty(shopId) {
        const u = _uiRef();
        const sh = _shopsRef();
        if (!u || !sh) return;
        const prodEl = document.getElementById('transferProd');
        const qtyEl = document.getElementById('transferQty');
        const tipEl = document.getElementById('transferRecommendTip');
        if (!prodEl || !prodEl.value) { u.showToast('请先选择商品'); return; }
        const r = sh.getRecommendTransferQty(shopId, prodEl.value);
        if (r.success) {
            if (qtyEl) qtyEl.value = r.recommend;
            if (tipEl) tipEl.innerHTML = `推荐调拨 ${r.recommend} 件（按7天安全库存，当前${r.current}，目标${r.target}）`;
        } else {
            if (tipEl) tipEl.innerHTML = `<span style="color:#f44336;">${r.message}</span>`;
        }
    }

    // ==================== P0-1：门店员工 ====================
    function openStaffModal(shopId) {
        const u = _uiRef();
        const sh = _shopsRef();
        if (!u || !sh) return;
        const shop = sh.getShopById(shopId);
        if (!shop) return;
        const emps = (_gs().state.employees || []).filter(e => e && e.status === 'active');
        const freeEmps = emps.filter(e => !shop.staff || shop.staff.indexOf(e.id) < 0);
        const options = freeEmps.length
            ? `<select id="staffPick" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:13px;">
                ${freeEmps.slice(0, 30).map(e => `<option value="${e.id}">${e.name}（${e.type || ''}·Lv.${e.level || 1}）</option>`).join('')}
              </select>`
            : '<div style="font-size:12px;color:#f44336;padding:8px 0;">无可用在职员工，请先在「员工管理」招聘</div>';
        const content = `
            <div style="font-size:12px;color:#888;margin-bottom:6px;">派往门店：${shop.name}</div>
            <div style="font-size:12px;color:#888;margin:6px 0;">选择员工（每人在店销量+8%起）</div>
            ${options}
        `;
        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>
            <button class="btn btn-primary" onclick="shopsUI.confirmAssignStaff('${shop.id}')">确认派遣</button>
        `;
        u.showModal('👥 派员工到店', content, footer, { noBodyPadding: true, modalId: 'staffModal' });
    }

    function confirmAssignStaff(shopId) {
        const u = _uiRef();
        const sh = _shopsRef();
        if (!u || !sh) return;
        const el = document.getElementById('staffPick');
        if (!el || !el.value) { u.showToast('请选择员工'); return; }
        const res = sh.assignStaff(shopId, el.value);
        u.showToast(res.message || '派遣结果');
        if (res.success) { u.closeModal(); openShopDetail(shopId); }
    }

    function unassignStaff(shopId, employeeId) {
        const u = _uiRef();
        const sh = _shopsRef();
        if (!u || !sh) return;
        const res = sh.unassignStaff(shopId, employeeId);
        u.showToast(res.message || '已调回');
        openShopDetail(shopId);
    }

    // ==================== P0-2：清仓促销 ====================
    function openPromoModal(shopId) {
        const u = _uiRef();
        const sh = _shopsRef();
        if (!u || !sh) return;
        const shop = sh.getShopById(shopId);
        if (!shop) return;
        const curRate = shop.promotion ? Math.round(shop.promotion.discountRate * 100) : 0;
        const content = `
            <div style="font-size:12px;color:#888;margin-bottom:6px;">清仓促销：${shop.name}</div>
            <div style="font-size:12px;color:#888;margin:6px 0;">折扣比例（0~50%）</div>
            <input type="number" id="promoRate" min="0" max="50" value="${curRate}" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:13px;box-sizing:border-box;" />
            <div style="font-size:12px;color:#888;margin:10px 0 6px;">持续天数（1~14）</div>
            <input type="number" id="promoDays" min="1" max="14" value="3" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:13px;box-sizing:border-box;" />
            <div style="font-size:11px;color:#aaa;margin-top:10px;">促销期间售价打折、销量放大（需求×1+2.2×折扣），适合清库存。</div>
        `;
        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>
            ${shop.promotion ? `<button class="btn" style="color:#f44336;" onclick="shopsUI.clearPromo('${shop.id}')">关闭促销</button>` : ''}
            <button class="btn btn-primary" onclick="shopsUI.confirmPromo('${shop.id}')">开启促销</button>
        `;
        u.showModal('🔥 清仓促销', content, footer, { noBodyPadding: true, modalId: 'promoModal' });
    }

    function confirmPromo(shopId) {
        const u = _uiRef();
        const sh = _shopsRef();
        if (!u || !sh) return;
        const rate = parseFloat(document.getElementById('promoRate') ? document.getElementById('promoRate').value : '0');
        const days = parseInt(document.getElementById('promoDays') ? document.getElementById('promoDays').value : '3', 10);
        const res = sh.setShopPromotion(shopId, rate / 100, days);
        u.showToast(res.message || '促销设置结果');
        if (res.success) { u.closeModal(); openShopDetail(shopId); }
    }

    function clearPromo(shopId) {
        const u = _uiRef();
        const sh = _shopsRef();
        if (!u || !sh) return;
        const res = sh.clearShopPromotion(shopId);
        u.showToast(res.message || '已关闭');
        u.closeModal();
        openShopDetail(shopId);
    }

    // ==================== P1-2：门店升级 ====================
    function upgradeShop(shopId) {
        const u = _uiRef();
        const sh = _shopsRef();
        if (!u || !sh) return;
        const res = sh.upgradeShop(shopId);
        u.showToast(res.message || '升级结果');
        if (res.success) openShopDetail(shopId);
    }

    // ==================== 阶段E：店铺装修 ====================
    function openDecorModal(shopId) {
        const u = _uiRef();
        const sh = _shopsRef();
        if (!u || !sh) return;
        const shop = sh.getShopById(shopId);
        if (!shop) return;
        const STYLES = (typeof SHOP_DECOR_STYLES !== 'undefined') ? SHOP_DECOR_STYLES : [];
        const cur = sh.getDecoration(shop);
        const curIdx = STYLES.findIndex(s => s.id === (cur && cur.id));
        const funds = (_gs().state.shop && _gs().state.shop.funds) || 0;
        const content = `
            <div style="font-size:12px;color:#888;margin-bottom:10px;">
                ${shop.name} · 当前装修「${cur ? cur.icon + ' ' + cur.name : '简陋装修'}」（客流 ×${cur ? cur.trafficBonus.toFixed(2) : '1.00'}）
            </div>
            ${STYLES.map((s, i) => {
                const owned = i <= curIdx;
                const canAfford = funds >= s.cost;
                const isNext = i === curIdx + 1;
                return `
                <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:${owned ? '#e8f5e9' : '#f8f9fa'};border-radius:10px;margin-bottom:8px;${owned ? '' : 'opacity:' + (isNext && !canAfford ? '0.6' : '1') + ';'}">
                    <div style="font-size:24px;">${s.icon}</div>
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:13px;font-weight:700;color:#333;">${s.name} ${owned ? '✅' : ''}</div>
                        <div style="font-size:11px;color:#888;">${s.desc} · 信誉 +${s.reputationBonus}</div>
                    </div>
                    <div style="text-align:right;flex-shrink:0;">
                        ${owned
                            ? '<span style="font-size:11px;color:#4caf50;">已拥有</span>'
                            : (isNext
                                ? `<button class="btn btn-primary btn-small" ${canAfford ? '' : 'disabled'} onclick="shopsUI.confirmDecor('${shopId}', '${s.id}')">¥${s.cost.toLocaleString()}</button>`
                                : '<span style="font-size:11px;color:#bbb;">需先完成上一档</span>')}
                    </div>
                </div>`;
            }).join('')}
        `;
        u.showModal('🎨 店铺装修', content, `
            <button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>`, {
            noBodyPadding: true, modalId: 'shopDecorModal'
        });
    }

    function confirmDecor(shopId, styleId) {
        const u = _uiRef();
        const sh = _shopsRef();
        if (!u || !sh) return;
        const res = sh.decorateShop(shopId, styleId);
        u.showToast(res.message || '装修结果');
        ui.closeModal();
        if (res.success) openShopDetail(shopId);
    }

    // ==================== 阶段C：共享库存开关 ====================
    function toggleShareInventory(shopId) {
        const u = _uiRef();
        const sh = _shopsRef();
        if (!u || !sh) return;
        const shop = sh.getShopById(shopId);
        if (!shop) return;
        const res = sh.setShareInventory(shopId, !shop.shareInventory);
        u.showToast(res.message || '已切换');
        openShopDetail(shopId);
    }

    // ==================== 阶段D：批量调价 ====================
    function openBulkPriceModal(shopId) {
        const u = _uiRef();
        const sh = _shopsRef();
        if (!u || !sh) return;
        const shop = sh.getShopById(shopId);
        if (!shop) return;
        // 品类选项
        const cats = {};
        (typeof PRODUCTS !== 'undefined' ? PRODUCTS : []).forEach(p => {
            if (p && p.category && !cats[p.category]) cats[p.category] = p.category;
        });
        const catSel = Object.keys(cats).map(c => `<option value="${c}">${c}</option>`).join('');
        const content = `
            <div style="font-size:12px;color:#888;margin-bottom:6px;">批量调价：${shop.name}</div>
            <div style="font-size:12px;color:#888;margin:6px 0;">调整范围</div>
            <select id="bulkScope" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:13px;">
                <option value="all">全部商品</option>
                <option value="stock">仅店内库存商品</option>
                <option value="category">指定品类</option>
            </select>
            <div id="bulkCatWrap" style="display:none;margin-top:8px;">
                <div style="font-size:12px;color:#888;margin:4px 0;">选择品类</div>
                <select id="bulkCat" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:13px;">${catSel}</select>
            </div>
            <div style="font-size:12px;color:#888;margin:10px 0 6px;">价格倍率（1.0=恢复默认）</div>
            <input type="number" id="bulkMul" min="0.1" max="50" step="0.1" value="1.2" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:13px;box-sizing:border-box;" />
            <div style="font-size:11px;color:#aaa;margin-top:10px;">批量将范围内商品定价设为 基础价×倍率；填 1.0 恢复默认定价。</div>
        `;
        const footer = `
            <button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>
            <button class="btn btn-primary" onclick="shopsUI.confirmBulkPrice('${shop.id}')">应用</button>
        `;
        u.showModal('💲 批量调价', content, footer, { noBodyPadding: true, modalId: 'bulkPriceModal' });
        // 绑定范围切换显示品类
        try {
            const scopeEl = document.getElementById('bulkScope');
            if (scopeEl) scopeEl.onchange = function () {
                const wrap = document.getElementById('bulkCatWrap');
                if (wrap) wrap.style.display = this.value === 'category' ? 'block' : 'none';
            };
        } catch (_) {}
    }

    function confirmBulkPrice(shopId) {
        const u = _uiRef();
        const sh = _shopsRef();
        if (!u || !sh) return;
        const scopeEl = document.getElementById('bulkScope');
        const mul = parseFloat(document.getElementById('bulkMul') ? document.getElementById('bulkMul').value : '1');
        const scope = scopeEl ? scopeEl.value : 'all';
        const cat = scope === 'category' ? (document.getElementById('bulkCat') ? document.getElementById('bulkCat').value : null) : null;
        const res = sh.bulkAdjustPrice(shopId, mul, scope, cat);
        u.showToast(res.message || '调价完成');
        if (res.success) { u.closeModal(); openShopDetail(shopId); }
    }

    function setRetailVenue(shopId, venueId) {
        const u = _uiRef(); const sh = _shopsRef();
        if (!u || !sh) return;
        const res = sh.setRetailVenue(shopId, venueId);
        u.showToast(res.message || '已更新选址');
        if (res.success) openShopDetail(shopId);
    }
    function setDeliveryPlatform(shopId, platformId) {
        const u = _uiRef(); const sh = _shopsRef();
        if (!u || !sh) return;
        const res = sh.setDeliveryPlatform(shopId, platformId);
        u.showToast(res.message || '已切换平台');
        if (res.success) openShopDetail(shopId);
    }
    function setDeliveryRadius(shopId, km) {
        const u = _uiRef(); const sh = _shopsRef();
        if (!u || !sh) return;
        const res = sh.setDeliveryRadius(shopId, km);
        u.showToast(res.message || '已调整半径');
        if (res.success) openShopDetail(shopId);
    }
    function toggleKitchen(shopId) {
        const u = _uiRef(); const sh = _shopsRef();
        if (!u || !sh) return;
        const res = sh.toggleKitchen(shopId);
        u.showToast(res.message || '已切换档口');
        if (res.success) openShopDetail(shopId);
    }

    const shopsUI = {
        init, openShopsModal, openOpenShopModal, switchHubTab, pickShopType, confirmOpenShop, openShopDetail, confirmCloseShop,
        setRetailVenue, setDeliveryPlatform, setDeliveryRadius, toggleKitchen,
        openTransferModal, confirmTransfer, applyRecommendQty, filterTransferOptions,
        openStaffModal, confirmAssignStaff, unassignStaff,
        openPromoModal, confirmPromo, clearPromo, upgradeShop, toggleShareInventory,
        openBulkPriceModal, confirmBulkPrice,
        openDecorModal, confirmDecor
    };
    if (typeof window !== 'undefined') window.shopsUI = shopsUI;
})();
