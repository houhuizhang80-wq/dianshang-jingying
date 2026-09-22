/**
 * 售后客服 — State（clean ops）
 * 存档键：gameState.state.customerService
 * 全局别名：csState / AfterSalesState
 */
const AfterSalesState = (function () {
    'use strict';

    let _gs = null;
    const _cs = () => _gs.state.customerService;
    const _now = () => ({ ..._gs.state.gameTime });
    const _hours = (a, b) => ((a.day - 1) * 24 + (a.hour || 0)) - ((b.day - 1) * 24 + (b.hour || 0));
    const _id = (p) => (typeof generateId === 'function' ? generateId(p) : `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`);

    function _ensureStructure(cs) {
        const base = (typeof CS_INITIAL_STATE_STRUCTURE !== 'undefined')
            ? JSON.parse(JSON.stringify(CS_INITIAL_STATE_STRUCTURE))
            : { consultations: [], returns: [], disputes: [], appeals: [], logs: [], notifications: [], statistics: {} };
        if (!cs.consultations) cs.consultations = [];
        if (!cs.returns) cs.returns = [];
        if (!cs.disputes) cs.disputes = [];
        if (!cs.appeals) cs.appeals = [];
        if (!cs.logs) cs.logs = [];
        if (!cs.notifications) cs.notifications = [];
        if (!cs.statistics) cs.statistics = { ...base.statistics };
        const s = cs.statistics;
        ['totalConsultations', 'totalReturns', 'totalDisputes', 'totalAppeals',
            'avgResponseTime', 'resolutionRate', 'returnApproveRate', 'inspectionPassRate', 'buyerSatisfaction'
        ].forEach(k => { if (typeof s[k] !== 'number') s[k] = 0; });
        for (const r of cs.returns) {
            if (r.inspection === undefined) r.inspection = null;
            if (r.inspectionResult === undefined) r.inspectionResult = null;
            if (r.refundRatio === undefined) r.refundRatio = null;
        }
    }

    function init(gameState) {
        _gs = gameState;
        if (!gameState.state.customerService) {
            gameState.state.customerService = JSON.parse(JSON.stringify(
                typeof CS_INITIAL_STATE_STRUCTURE !== 'undefined' ? CS_INITIAL_STATE_STRUCTURE : {
                    consultations: [], returns: [], disputes: [], appeals: [], logs: [], notifications: [],
                    statistics: { totalConsultations: 0, totalReturns: 0, totalDisputes: 0, totalAppeals: 0,
                        avgResponseTime: 0, resolutionRate: 0, returnApproveRate: 0, inspectionPassRate: 0, buyerSatisfaction: 0 }
                }
            ));
        }
        _ensureStructure(gameState.state.customerService);
    }

    function reset() {
        if (!_gs || !_gs.state) return;
        const structure = (typeof CS_INITIAL_STATE_STRUCTURE !== 'undefined')
            ? CS_INITIAL_STATE_STRUCTURE
            : { consultations: [], returns: [], disputes: [], appeals: [], logs: [], notifications: [], statistics: {} };
        _gs.state.customerService = JSON.parse(JSON.stringify(structure));
    }

    function _addLog(type, data) {
        const log = { id: _id('cs_log'), type, label: (typeof CS_LOG_LABEL !== 'undefined' && CS_LOG_LABEL[type]) || type, data: data || {}, operator: 'system', time: _now() };
        _cs().logs.unshift(log);
        if (_cs().logs.length > 1000) _cs().logs = _cs().logs.slice(0, 1000);
        return log;
    }

    function _addNotification(content, type = 'info', refId = null) {
        const notif = { id: _id('notif'), content, type, refId, read: false, time: _now() };
        _cs().notifications.unshift(notif);
        if (_cs().notifications.length > 500) _cs().notifications = _cs().notifications.slice(0, 500);
        return notif;
    }

    /** 有效商品 ID：非空，且不是字面量 undefined/null */
    function _isValidProductId(pid) {
        if (pid == null || pid === '') return false;
        const s = String(pid);
        return s !== 'undefined' && s !== 'null' && s !== 'NaN';
    }

    function _lookupProduct(pid) {
        if (!_isValidProductId(pid)) return null;
        try {
            if (typeof getProductById === 'function') {
                const p = getProductById(pid);
                if (p) return p;
            }
        } catch (_) {}
        try {
            if (typeof PRODUCTS !== 'undefined' && Array.isArray(PRODUCTS)) {
                return PRODUCTS.find(p => p && p.id === pid) || null;
            }
        } catch (_) {}
        return null;
    }

    function _matchProductByName(name) {
        if (!name || typeof PRODUCTS === 'undefined' || !Array.isArray(PRODUCTS)) return null;
        const n = String(name).trim();
        if (!n || n === 'undefined') return null;
        const exact = PRODUCTS.find(p => p && p.name === n);
        if (exact) return exact;
        // 自定义上架标题常含商品名：优先最长匹配，降低误命中
        let best = null;
        for (const p of PRODUCTS) {
            if (!p || !p.name) continue;
            if (n.indexOf(p.name) >= 0) {
                if (!best || p.name.length > best.name.length) best = p;
            }
        }
        return best;
    }

    /**
     * 解析退货应回库的 productId：售后单 → 原订单 → 上架单 → 商品名匹配
     */
    function _resolveReturnProductId(r) {
        if (!r) return null;
        if (_lookupProduct(r.productId)) return r.productId;
        try {
            if (r.listingId && _gs && _gs.state && Array.isArray(_gs.state.listings)) {
                const listing = _gs.state.listings.find(l => l && l.id === r.listingId);
                if (listing && _lookupProduct(listing.productId)) return listing.productId;
            }
        } catch (_) {}
        try {
            if (r.orderId && _gs && _gs.state && Array.isArray(_gs.state.orders)) {
                const order = _gs.state.orders.find(o => o && o.id === r.orderId);
                if (order) {
                    if (_lookupProduct(order.productId)) return order.productId;
                    if (order.listingId && Array.isArray(_gs.state.listings)) {
                        const listing = _gs.state.listings.find(l => l && l.id === order.listingId);
                        if (listing && _lookupProduct(listing.productId)) return listing.productId;
                    }
                    const byOrderName = _matchProductByName(order.productName);
                    if (byOrderName) return byOrderName.id;
                }
            }
        } catch (_) {}
        const byName = _matchProductByName(r.productName);
        if (byName) return byName.id;
        return _isValidProductId(r.productId) ? r.productId : null;
    }

    function _returnAddress() {
        try {
            const shop = _gs && _gs.state && _gs.state.shop;
            const name = (shop && shop.name) ? `${shop.name} 售后中心` : '店铺售后中心';
            const province = (shop && shop.province) || '浙江省';
            const city = (shop && shop.city) || '杭州市';
            const district = (shop && shop.district) || '西湖区';
            const addr = (shop && shop.address) || '文三路xxx号';
            const warehouse = `（售后质检仓 ${(shop && shop.warehouseName) ? shop.warehouseName : 'A01'}）`;
            return `${province}${city}${district}${addr}${warehouse} - ${name} - 客服部 400-xxxx-xxxx`;
        } catch (_) {
            return '浙江省杭州市西湖区文三路xxx号售后质检仓A01 - 店铺售后中心 - 客服部 400-xxxx-xxxx';
        }
    }

    function _refreshInspectionRate() {
        const done = _cs().returns.filter(x => x.inspectionResult === 'pass' || x.inspectionResult === 'fail');
        const pass = done.filter(x => x.inspectionResult === 'pass').length;
        _cs().statistics.inspectionPassRate = done.length > 0 ? pass / done.length : 0;
    }

    function _refreshApproveRate() {
        const audited = _cs().returns.filter(x => x.auditResult !== null);
        const approved = audited.filter(x => x.auditResult === true).length;
        _cs().statistics.returnApproveRate = audited.length > 0 ? approved / audited.length : 0;
    }

    /** 是否已雇佣在职客服（未雇客服时售后不自动审核/不自动回复） */
    function hasActiveCsStaff() {
        if (!_gs || !_gs.state) return false;
        return (_gs.state.employees || []).some(e =>
            e && e.status === 'active' &&
            (e.type === 'customerService' || e.position === 'customerService')
        );
    }

    // ---------- 咨询 ----------
    function createConsultation(data) {
        const c = {
            id: _id('cs'), listingId: data.listingId, productId: data.productId, productName: data.productName,
            buyerName: data.buyerName || (typeof generateBuyerName === 'function' ? generateBuyerName() : '买家'),
            orderId: data.orderId || null,
            orderNo: data.orderNo || (data.orderId ? String(data.orderId).slice(-10) : null),
            question: data.question, createTime: _now(), status: CONSULTATION_STATUS.PENDING,
            messages: [], replyTime: null, resolvedTime: null, staffName: null, tags: data.tags || []
        };
        c.messages.push({ role: 'buyer', name: c.buyerName, content: c.question, time: c.createTime });
        _cs().consultations.push(c);
        _cs().statistics.totalConsultations++;
        _addLog(CS_LOG_TYPES.CONSULTATION_CREATED, { id: c.id, buyerName: c.buyerName });
        _addNotification(`💬 新咨询：${c.buyerName} - ${c.productName}`, 'info', c.id);
        // 未雇客服：不自动回复，留给玩家手动处理
        if (hasActiveCsStaff() && typeof AUTO_REPLY_KEYWORDS !== 'undefined') {
            const q = String(c.question || '').toLowerCase();
            for (const rule of AUTO_REPLY_KEYWORDS) {
                if (rule.keywords.some(kw => q.includes(String(kw).toLowerCase()))) {
                    setTimeout(() => replyConsultation(c.id, rule.reply, '智能客服-小助手', true), 500);
                    break;
                }
            }
        }
        return c;
    }

    function replyConsultation(consultationId, replyContent, staffName, isAuto) {
        const c = _cs().consultations.find(x => x.id === consultationId);
        if (!c || c.status === CONSULTATION_STATUS.CLOSED || c.status === CONSULTATION_STATUS.RESOLVED) return null;
        const now = _now();
        const staff = staffName || (CS_STAFF_NAMES && CS_STAFF_NAMES[0]) || '客服';
        c.messages.push({ role: 'staff', name: staff, content: replyContent, time: now, isAuto: !!isAuto });
        c.status = CONSULTATION_STATUS.REPLIED;
        c.reply = replyContent;
        c.replyTime = now;
        c.staffName = staff;
        const hours = Math.max(_hours(c.replyTime, c.createTime), 0.5);
        const stats = _cs().statistics;
        const total = stats.totalConsultations || 1;
        stats.avgResponseTime = ((stats.avgResponseTime * (total - 1)) + hours) / total;
        _addLog(CS_LOG_TYPES.CONSULTATION_REPLIED, { id: c.id, staff, isAuto: !!isAuto });
        return c;
    }

    function buyerFollowUp(consultationId, content) {
        const c = _cs().consultations.find(x => x.id === consultationId);
        if (!c) return null;
        c.messages.push({ role: 'buyer', name: c.buyerName, content, time: _now() });
        c.status = CONSULTATION_STATUS.PENDING;
        _addNotification(`💬 买家追问：${c.buyerName}`, 'warning', c.id);
        return c;
    }

    function resolveConsultation(consultationId) {
        const c = _cs().consultations.find(x => x.id === consultationId);
        if (!c) return null;
        c.status = CONSULTATION_STATUS.RESOLVED;
        c.resolvedTime = _now();
        const resolved = _cs().consultations.filter(x => x.status === 'resolved' || x.status === 'closed').length;
        _cs().statistics.resolutionRate = resolved / Math.max(_cs().statistics.totalConsultations, 1);
        _addLog(CS_LOG_TYPES.CONSULTATION_RESOLVED, { id: c.id });
        return c;
    }

    function markConsultationMissed(consultationId) {
        const c = _cs().consultations.find(x => x.id === consultationId);
        if (!c) return null;
        c.status = CONSULTATION_STATUS.MISSED;
        _addLog(CS_LOG_TYPES.CONSULTATION_MISSED, { id: c.id });
        if (_gs && _gs.addReputation) _gs.addReputation(-1);
        return c;
    }

    // ---------- 退换货 ----------
    function createReturn(data) {
        const qg = (data.qualityGrade === 'A' || data.qualityGrade === 'B' || data.qualityGrade === 'C')
            ? data.qualityGrade : null;
        const unitCost = (parseFloat(data.unitCost) > 0) ? parseFloat(data.unitCost)
            : ((parseFloat(data.costPrice) > 0) ? parseFloat(data.costPrice) : 0);
        // 创建时补全 productId，避免后续退货入库写出「undefined」库存
        let resolvedPid = _resolveReturnProductId(data);
        if (!resolvedPid && data) resolvedPid = _resolveReturnProductId({
            productId: data.productId, orderId: data.orderId, productName: data.productName
        });
        let productName = data.productName;
        if ((!productName || productName === 'undefined') && resolvedPid) {
            const prod = _lookupProduct(resolvedPid);
            if (prod && prod.name) productName = prod.name;
        }
        const item = {
            id: _id('ret'), orderId: data.orderId, orderNo: data.orderNo, productId: resolvedPid || data.productId || null,
            productName: productName, productImage: data.productImage, quantity: data.quantity || 1,
            listingId: data.listingId || null,
            buyerName: data.buyerName, type: data.type || RETURN_TYPES.RETURN_REFUND,
            reasonId: data.reasonId, reasonText: data.reasonText || '', description: data.description || '',
            images: data.images || [],
            amount: (typeof data.amount === 'number' && isFinite(data.amount)) ? data.amount : (Number(data.amount) || 0),
            // 原单品质/成本：退货入库按真实成本入账，避免 0 元免费货
            qualityGrade: qg || 'B',
            unitCost,
            costPrice: unitCost,
            alreadyRefunded: !!data.alreadyRefunded, createTime: _now(), status: RETURN_STATUS.PENDING,
            auditTime: null, auditResult: null, auditReply: '', auditStaff: null,
            returnAddress: data.returnAddress || _returnAddress(),
            buyerCarrier: null, buyerTrackingNo: null, buyerShipTime: null, sellerReceiveTime: null,
            inspection: null, inspectionResult: null, inspectionFailReason: '', refundRatio: null,
            refundAmount: null, refundTime: null, newProductId: null, newOrderId: null,
            timeline: [], logs: []
        };
        item.timeline.push({ status: RETURN_STATUS.PENDING, time: item.createTime, label: RETURN_STATUS_LABEL.pending.name, note: '买家提交退换货申请' });
        _cs().returns.push(item);
        _cs().statistics.totalReturns++;
        _addLog(CS_LOG_TYPES.RETURN_CREATED, { id: item.id, type: item.type });
        const typeMeta = (RETURN_TYPE_LABEL && RETURN_TYPE_LABEL[item.type]) || { icon: '📦', name: '退换货' };
        _addNotification(`${typeMeta.icon} 新${typeMeta.name}申请：${item.productName || '商品'} - ¥${(Number(item.amount) || 0).toFixed(2)}`, 'warning', item.id);

        // 已雇客服时：退货退款自动同意、仅退款自动驳回；未雇客服则保持 pending，由玩家手动处理
        if (!data.skipAutoPolicy && hasActiveCsStaff()) {
            try {
                if (item.type === RETURN_TYPES.RETURN_REFUND) {
                    setTimeout(() => auditReturn(item.id, true, '客服自动同意：退货退款（商品寄回售后仓质检后入库）', '客服'), 80);
                } else if (item.type === RETURN_TYPES.REFUND_ONLY) {
                    setTimeout(() => auditReturn(item.id, false, '客服默认驳回：仅退款需核实（可申请平台介入或法务申诉）', '客服'), 80);
                }
            } catch (_) { /* ignore */ }
        }
        return item;
    }

    function auditReturn(returnId, approved, reply, staffName) {
        const r = _cs().returns.find(x => x.id === returnId);
        if (!r || r.status !== RETURN_STATUS.PENDING) return null;
        const now = _now();
        r.auditTime = now;
        r.auditResult = approved;
        r.auditReply = reply || '';
        r.auditStaff = staffName || (CS_STAFF_NAMES && CS_STAFF_NAMES[0]) || '客服';
        if (approved) {
            r.status = RETURN_STATUS.APPROVED;
            r.timeline.push({ status: RETURN_STATUS.APPROVED, time: now, label: RETURN_STATUS_LABEL.approved.name, note: reply ? `商家已通过：${reply}` : '商家审核通过' });
            _addLog(CS_LOG_TYPES.RETURN_APPROVED, { id: r.id, staff: r.auditStaff });
            if (r.type === RETURN_TYPES.REFUND_ONLY) setTimeout(() => _processRefund(r), 300);
        } else {
            r.status = RETURN_STATUS.REJECTED;
            r.timeline.push({ status: RETURN_STATUS.REJECTED, time: now, label: RETURN_STATUS_LABEL.rejected.name, note: reply ? `拒绝原因：${reply}` : '申请被商家拒绝' });
            _addLog(CS_LOG_TYPES.RETURN_REJECTED, { id: r.id, staff: r.auditStaff });
            _addNotification(`退换货申请被拒绝：${r.productName} - ${reply || '未说明原因'}`, 'error', r.id);
            if (Math.random() < 0.5) {
                setTimeout(() => createDispute({
                    orderId: r.orderId, productName: r.productName, buyerName: r.buyerName,
                    typeId: 'refund', reason: '退换货被拒，申请平台介入', amount: r.amount, returnId: r.id
                }), 500);
            }
        }
        _refreshApproveRate();
        return r;
    }

    function buyerShipReturn(returnId, carrier, trackingNo) {
        const r = _cs().returns.find(x => x.id === returnId);
        if (!r || (r.status !== RETURN_STATUS.APPROVED && r.status !== RETURN_STATUS.REJECTED)) return null;
        r.buyerCarrier = carrier;
        r.buyerTrackingNo = trackingNo;
        r.buyerShipTime = _now();
        r.status = RETURN_STATUS.BUYER_SHIPPED;
        r.timeline.push({ status: RETURN_STATUS.BUYER_SHIPPED, time: r.buyerShipTime, label: RETURN_STATUS_LABEL.buyer_shipped.name, note: `买家已通过 ${carrier} 寄回，单号：${trackingNo}` });
        _addLog(CS_LOG_TYPES.RETURN_BUYER_SHIPPED, { id: r.id, carrier, trackingNo });
        return r;
    }

    function sellerReceiveReturn(returnId) {
        const r = _cs().returns.find(x => x.id === returnId);
        if (!r || r.status !== RETURN_STATUS.BUYER_SHIPPED) return null;
        r.sellerReceiveTime = _now();
        r.status = RETURN_STATUS.SELLER_RECEIVED;
        r.timeline.push({ status: RETURN_STATUS.SELLER_RECEIVED, time: r.sellerReceiveTime, label: RETURN_STATUS_LABEL.seller_received.name, note: '商家已收到退回商品，转交售后客服进行质量检测' });
        _addLog(CS_LOG_TYPES.RETURN_SELLER_RECEIVED, { id: r.id });
        setTimeout(() => startCsInspection(r.id), 200);
        return r;
    }

    function startCsInspection(returnId, staffName) {
        const r = _cs().returns.find(x => x.id === returnId);
        if (!r) return null;
        if (r.status !== RETURN_STATUS.SELLER_RECEIVED && r.status !== RETURN_STATUS.APPROVED) return null;
        const now = _now();
        const staff = staffName || (CS_STAFF_NAMES && CS_STAFF_NAMES[Math.floor(Math.random() * CS_STAFF_NAMES.length)]) || '客服';
        r.status = RETURN_STATUS.CS_INSPECTION;
        r.inspection = { staff, startTime: now, endTime: null, grade: null, gradeId: null, gradeName: null, itemScores: {}, details: '', totalScore: 0, refundRatio: null };
        r.timeline.push({ status: RETURN_STATUS.CS_INSPECTION, time: now, label: RETURN_STATUS_LABEL.cs_inspection.name, note: `售后客服【${staff}】已开始质检` });
        _addLog(CS_LOG_TYPES.RETURN_CS_INSPECTION_START, { id: r.id, staff });
        return r;
    }

    function _computeInspection(r) {
        const cfg = (typeof CS_INSPECTION_CONFIG !== 'undefined') ? CS_INSPECTION_CONFIG : {
            grades: [{ id: 'A', name: '完好', icon: '🟢', passRate: 1, refundRatio: 1 }],
            checkItems: ['外观'], passThreshold: 0.6
        };
        const items = cfg.checkItems || ['外观'];
        const grades = cfg.grades || [];
        const qualityReasons = ['quality', 'mismatch', 'damaged', 'fake', 'missing'];
        const bias = qualityReasons.includes(r.reasonId || '') ? -0.18 : 0.22;
        const itemScores = {};
        let total = 0;
        for (const it of items) {
            const s = Math.max(0, Math.min(100, 62 + Math.round(Math.random() * 35) + Math.round(bias * 40)));
            itemScores[it] = s;
            total += s;
        }
        const avg = total / items.length;
        let grade;
        if (avg >= 94) grade = grades.find(g => g.id === 'A_PLUS') || grades[0];
        else if (avg >= 80) grade = grades.find(g => g.id === 'A') || grades[0];
        else if (avg >= 65) grade = grades.find(g => g.id === 'B') || grades[0];
        else if (avg >= 45) grade = grades.find(g => g.id === 'C') || grades[0];
        else grade = grades.find(g => g.id === 'D') || grades[grades.length - 1];
        const noise = (Math.random() - 0.5) * 0.12;
        const composite = Math.min(1, Math.max(0, (grade.passRate || 0) + noise));
        const passed = composite >= (cfg.passThreshold || 0.6);
        const refundRatio = passed ? (grade.refundRatio != null ? grade.refundRatio : 1) : 0;
        let details = passed
            ? (refundRatio < 1 ? `轻微使用痕迹，按 ${(refundRatio * 100).toFixed(0)}% 比例退款` : '商品完好，全额退款')
            : (grade.id === 'D' ? '商品严重损坏/缺少配件，不满足退款条件' : '综合评分未达通过阈值');
        return { grade, itemScores, avg, passed, refundRatio, details };
    }

    function completeCsInspection(returnId, overrides, staffName) {
        const r = _cs().returns.find(x => x.id === returnId);
        if (!r) return null;
        if (!r.inspection) startCsInspection(returnId, staffName);
        if (r.status !== RETURN_STATUS.CS_INSPECTION) return null;
        const now = _now();
        const compute = _computeInspection(r);
        const grade = (overrides && overrides.grade) ? overrides.grade : compute.grade;
        const passed = overrides && typeof overrides.passed === 'boolean' ? overrides.passed : compute.passed;
        const refundRatio = overrides && typeof overrides.refundRatio === 'number'
            ? overrides.refundRatio : (passed ? compute.refundRatio : 0);
        const failReason = (overrides && overrides.failReason) ? overrides.failReason : (passed ? '' : compute.details);

        r.inspection.endTime = now;
        r.inspection.gradeId = grade.id;
        r.inspection.gradeName = grade.name;
        r.inspection.gradeIcon = grade.icon || '';
        r.inspection.itemScores = (overrides && overrides.itemScores) || compute.itemScores;
        r.inspection.totalScore = parseFloat(compute.avg.toFixed(2));
        r.inspection.refundRatio = refundRatio;
        r.inspection.details = (overrides && overrides.details) || compute.details;
        if (staffName) r.inspection.staff = staffName;
        r.refundRatio = refundRatio;

        if (passed) {
            r.status = RETURN_STATUS.INSPECTION_PASS;
            r.inspectionResult = 'pass';
            r.timeline.push({ status: RETURN_STATUS.INSPECTION_PASS, time: now, label: RETURN_STATUS_LABEL.inspection_pass.name,
                note: `质检通过（${grade.icon || ''}${grade.name}），退款比例 ${(refundRatio * 100).toFixed(0)}%` });
            _addLog(CS_LOG_TYPES.RETURN_CS_INSPECTION_PASS, { id: r.id, grade: grade.id, ratio: refundRatio });
            if (r.type === RETURN_TYPES.EXCHANGE) setTimeout(() => _processExchange(r), 300);
            else {
                if (r.type === RETURN_TYPES.RETURN_REFUND) _restock(r);
                setTimeout(() => executeRefundAfterInspection(r.id), 200);
            }
        } else {
            r.status = RETURN_STATUS.INSPECTION_FAIL;
            r.inspectionResult = 'fail';
            r.inspectionFailReason = failReason;
            r.timeline.push({ status: RETURN_STATUS.INSPECTION_FAIL, time: now, label: RETURN_STATUS_LABEL.inspection_fail.name,
                note: `质检不通过（${grade.icon || ''}${grade.name}）。${failReason}` });
            _addLog(CS_LOG_TYPES.RETURN_CS_INSPECTION_FAIL, { id: r.id, grade: grade.id, reason: failReason });
            _addNotification(`🚫 质检不通过：${r.productName} - ${failReason || '商品不符合退款条件'}`, 'error', r.id);
            if (Math.random() < 0.5) {
                setTimeout(() => createDispute({
                    orderId: r.orderId, orderNo: r.orderNo, productName: r.productName, buyerName: r.buyerName,
                    typeId: 'quality', reason: '质检不通过，买家不服，要求平台介入并保留法律上诉权利', amount: r.amount, returnId: r.id
                }), 600);
            } else {
                setTimeout(() => {
                    r.status = RETURN_STATUS.CLOSED;
                    r.timeline.push({ status: RETURN_STATUS.CLOSED, time: _now(), label: RETURN_STATUS_LABEL.closed.name, note: '质检不通过，售后关闭；买家可在 72 小时内提交法律上诉' });
                }, 400);
            }
        }
        _refreshInspectionRate();
        return r;
    }

    /**
     * 质检等级 ≠ 商品品质等级：
     * - 质检 A/A_PLUS/B（完好/轻微痕迹）→ 按原订单品质回库（默认 B）
     * - 质检 C（明显瑕疵）→ 降为 C 品
     * - 质检 D → 不回库
     * 严禁把「完好」映射成卖场 A 品并以 0 成本入库。
     */
    function _mapInspectionToSellableGrade(inspectionGradeId, originalGrade) {
        const orig = (originalGrade === 'A' || originalGrade === 'B' || originalGrade === 'C') ? originalGrade : 'B';
        if (inspectionGradeId === 'D') return null;
        if (inspectionGradeId === 'C') return 'C';
        return orig;
    }

    function _resolveRestockUnitCost(r, qualityGrade) {
        const tryNum = (v) => {
            const n = parseFloat(v);
            return (n > 0) ? n : 0;
        };
        let cost = tryNum(r && r.unitCost) || tryNum(r && r.costPrice);
        if (!(cost > 0) && r && r.orderId && _gs && _gs.state && Array.isArray(_gs.state.orders)) {
            try {
                const order = _gs.state.orders.find(o => o && o.id === r.orderId);
                if (order) {
                    cost = tryNum(order.unitCost) || tryNum(order.costPrice) || tryNum(order.avgCost);
                    // 订单只有售价时，用售价的合理进货占比兜底（避免 0 成本）
                    if (!(cost > 0) && tryNum(order.unitPrice) > 0) {
                        cost = Math.round(tryNum(order.unitPrice) * 0.55 * 100) / 100;
                    }
                }
            } catch (_) {}
        }
        if (!(cost > 0) && _gs) {
            try {
                const wh = _gs.warehouse || _gs._warehouseState;
                if (wh && typeof wh._estimatePurchaseUnitCost === 'function') {
                    cost = tryNum(wh._estimatePurchaseUnitCost(r.productId, qualityGrade || 'B'));
                }
            } catch (_) {}
        }
        if (!(cost > 0) && _gs && typeof _gs.getAverageCost === 'function') {
            try { cost = tryNum(_gs.getAverageCost(r.productId, qualityGrade || null)); } catch (_) {}
        }
        if (!(cost > 0)) {
            try {
                const product = (typeof getProductById === 'function')
                    ? getProductById(r.productId)
                    : ((typeof PRODUCTS !== 'undefined') ? PRODUCTS.find(p => p.id === r.productId) : null);
                if (product && product.basePrice > 0) {
                    cost = Math.round(product.basePrice * 0.7 * 100) / 100;
                }
            } catch (_) {}
        }
        return cost > 0 ? cost : 1;
    }

    function _restock(r) {
        if (!r || r._restockedToWarehouse) return;
        const inspGrade = (r.inspection && r.inspection.gradeId) || 'B';
        if (inspGrade === 'D') return;
        const qty = Math.max(1, Number(r.quantity) || 1);

        // 回库前强制解析有效 productId，禁止写入 undefined 幽灵库存
        const productId = _resolveReturnProductId(r);
        if (!productId || !_isValidProductId(productId)) {
            try {
                console.warn('[afterSales._restock] 跳过入库：无法解析 productId', r && r.id, r && r.productName);
            } catch (_) {}
            return;
        }
        if (r.productId !== productId) r.productId = productId;
        if ((!r.productName || r.productName === 'undefined') && _lookupProduct(productId)) {
            r.productName = _lookupProduct(productId).name;
        }

        // 原订单品质（卖场 A/B/C），不是质检档位
        let originalGrade = (r.qualityGrade === 'A' || r.qualityGrade === 'B' || r.qualityGrade === 'C')
            ? r.qualityGrade : 'B';
        if (!(r.qualityGrade === 'A' || r.qualityGrade === 'B' || r.qualityGrade === 'C')
            && r.orderId && _gs && _gs.state && Array.isArray(_gs.state.orders)) {
            try {
                const order = _gs.state.orders.find(o => o && o.id === r.orderId);
                if (order && (order.qualityGrade === 'A' || order.qualityGrade === 'B' || order.qualityGrade === 'C')) {
                    originalGrade = order.qualityGrade;
                }
            } catch (_) {}
        }
        const qualityGrade = _mapInspectionToSellableGrade(inspGrade, originalGrade);
        if (!qualityGrade) return;
        const costPrice = _resolveRestockUnitCost(r, qualityGrade);

        try {
            const wh = _gs && (_gs.warehouse || _gs._warehouseState);
            if (wh && typeof wh.createInboundOrder === 'function') {
                const res = wh.createInboundOrder('return', [{
                    productId,
                    quantity: qty,
                    costPrice,
                    qualityGrade,
                    purchaseOrderId: 'return_' + r.id
                }], `售后退货入库:${r.id || ''}`);
                if (res && res.success) {
                    r._restockedToWarehouse = true;
                    r.restockCostPrice = costPrice;
                    r.restockQualityGrade = qualityGrade;
                    return;
                }
            }
            // 兜底：显式 prepaid + 正成本，禁止 0 元采购入库
            if (_gs && typeof _gs.addInventory === 'function') {
                _gs.addInventory({
                    productId,
                    quantity: qty,
                    costPrice,
                    qualityGrade,
                    purchaseOrderId: 'return_' + r.id
                }, { silent: true, prepaid: true });
                r._restockedToWarehouse = true;
                r.restockCostPrice = costPrice;
                r.restockQualityGrade = qualityGrade;
            }
        } catch (_) { /* optional */ }
    }

    function executeRefundAfterInspection(returnId) {
        const r = _cs().returns.find(x => x.id === returnId);
        if (!r) return null;
        if (r.status !== RETURN_STATUS.INSPECTION_PASS) {
            if (r.status === RETURN_STATUS.SELLER_RECEIVED) {
                startCsInspection(r.id);
                return setTimeout(() => executeRefundAfterInspection(returnId), 300);
            }
            return null;
        }
        return _processRefund(r);
    }

    function _processRefund(r) {
        if (!r || r._refundProcessing || r.alreadyRefunded || r.status === RETURN_STATUS.COMPLETED) return r;
        r._refundProcessing = true;
        r.status = RETURN_STATUS.REFUNDING;
        const ratio = r.refundRatio != null ? r.refundRatio : 1;
        const refundAmount = parseFloat((r.amount * Math.max(0, Math.min(1, ratio))).toFixed(2));
        r.timeline.push({ status: RETURN_STATUS.REFUNDING, time: _now(), label: RETURN_STATUS_LABEL.refunding.name,
            note: `退款处理中，按质检比例 ${(ratio * 100).toFixed(0)}%，预计退款 ¥${refundAmount.toFixed(2)}` });
        setTimeout(() => {
            r.status = RETURN_STATUS.COMPLETED;
            r.refundAmount = refundAmount;
            r.refundTime = _now();
            r.timeline.push({ status: RETURN_STATUS.COMPLETED, time: r.refundTime, label: RETURN_STATUS_LABEL.completed.name,
                note: `退款完成 ¥${refundAmount.toFixed(2)}` });
            if (!r.alreadyRefunded && _gs && typeof _gs.spendFunds === 'function' && refundAmount > 0) {
                r.alreadyRefunded = true;
                _gs.spendFunds(refundAmount, `售后退款 - ${r.productName}`);
            }
            if (r.type === RETURN_TYPES.REFUND_ONLY) {
                r.goodsReturned = false;
                r.goodsKeptByBuyer = true;
            } else if (r._restockedToWarehouse || r.sellerReceiveTime) {
                r.goodsReturned = true;
                r.goodsKeptByBuyer = false;
            }
            r._refundProcessing = false;
            _addLog(CS_LOG_TYPES.RETURN_REFUNDED, { id: r.id, amount: refundAmount, ratio });
            _addLog(CS_LOG_TYPES.RETURN_COMPLETED, { id: r.id });
            _addNotification(`💰 退款完成：${r.productName} - ¥${refundAmount.toFixed(2)}`, 'success', r.id);
        }, 600);
        return r;
    }

    /** 买家不退货但已拿到退款（平台强退 / 仅退款） */
    function forceRefundKeepGoods(returnId, note) {
        const r = _cs().returns.find(x => x.id === returnId);
        if (!r || r.alreadyRefunded || r.status === RETURN_STATUS.COMPLETED) return null;
        r.goodsReturned = false;
        r.goodsKeptByBuyer = true;
        r.auditReply = (r.auditReply || '') + (note ? ('；' + note) : '');
        return _processRefund(r);
    }

    function _processExchange(r) {
        r.status = RETURN_STATUS.EXCHANGING;
        r.timeline.push({ status: RETURN_STATUS.EXCHANGING, time: _now(), label: RETURN_STATUS_LABEL.exchanging.name, note: '商家正在安排换货发货' });
        setTimeout(() => {
            r.status = RETURN_STATUS.COMPLETED;
            r.newOrderId = _id('exg_ord');
            r.timeline.push({ status: RETURN_STATUS.COMPLETED, time: _now(), label: RETURN_STATUS_LABEL.completed.name, note: `换货已发出：${r.newOrderId.slice(-10)}` });
            _addLog(CS_LOG_TYPES.RETURN_COMPLETED, { id: r.id, type: 'exchange' });
        }, 800);
        return r;
    }

    // ---------- 纠纷 ----------
    function createDispute(data) {
        const typeInfo = (typeof DISPUTE_TYPES !== 'undefined' && DISPUTE_TYPES.find(t => t.id === data.typeId)) || { name: '其他争议', icon: '📝' };
        const d = {
            id: _id('dis'), orderId: data.orderId, orderNo: data.orderNo, productName: data.productName,
            buyerName: data.buyerName, typeId: data.typeId, typeName: typeInfo.name, typeIcon: typeInfo.icon,
            reason: data.reason, amount: data.amount || 0, returnId: data.returnId || null,
            createTime: _now(), status: DISPUTE_STATUS.ACCEPTED,
            buyerEvidences: [], sellerEvidences: [], mediations: [], arbitration: null, timeline: [], logs: []
        };
        d.timeline.push({ status: DISPUTE_STATUS.ACCEPTED, time: d.createTime, label: DISPUTE_STATUS_LABEL.accepted.name, note: `买家发起纠纷（${d.typeName}）` });
        if (data.buyerEvidence) d.buyerEvidences.push({ role: 'buyer', content: data.buyerEvidence, time: d.createTime });
        _cs().disputes.push(d);
        _cs().statistics.totalDisputes++;
        if (_gs && _gs.addReputation) _gs.addReputation(-2);
        _addLog(CS_LOG_TYPES.DISPUTE_CREATED, { id: d.id, typeId: d.typeId });
        _addNotification(`⚖️ 新纠纷：${d.typeIcon}${d.typeName} - ${d.productName}`, 'error', d.id);
        setTimeout(() => {
            d.status = DISPUTE_STATUS.EVIDENCE;
            d.timeline.push({ status: DISPUTE_STATUS.EVIDENCE, time: _now(), label: DISPUTE_STATUS_LABEL.evidence.name, note: '请双方在24小时内提交相关证据' });
            _addLog(CS_LOG_TYPES.DISPUTE_EVIDENCE, { id: d.id });
        }, 500);
        return d;
    }

    function addSellerEvidence(disputeId, content, type) {
        const d = _cs().disputes.find(x => x.id === disputeId);
        if (!d) return null;
        d.sellerEvidences.push({ role: 'seller', type: type || 'text', content, time: _now() });
        return d;
    }
    function addBuyerEvidence(disputeId, content, type) {
        const d = _cs().disputes.find(x => x.id === disputeId);
        if (!d) return null;
        d.buyerEvidences.push({ role: 'buyer', type: type || 'text', content, time: _now() });
        return d;
    }
    function startMediation(disputeId, note) {
        const d = _cs().disputes.find(x => x.id === disputeId);
        if (!d) return null;
        d.status = DISPUTE_STATUS.MEDIATION;
        d.timeline.push({ status: DISPUTE_STATUS.MEDIATION, time: _now(), label: DISPUTE_STATUS_LABEL.mediation.name, note: note || '平台客服介入调解' });
        d.mediations.push({ type: 'start', note: note || '平台客服介入调解', time: _now() });
        _addLog(CS_LOG_TYPES.DISPUTE_MEDIATION, { id: d.id });
        return d;
    }
    function addMediationRecord(disputeId, operator, note) {
        const d = _cs().disputes.find(x => x.id === disputeId);
        if (!d) return null;
        d.mediations.push({ operator, note, time: _now() });
        return d;
    }
    function startArbitration(disputeId) {
        const d = _cs().disputes.find(x => x.id === disputeId);
        if (!d) return null;
        d.status = DISPUTE_STATUS.ARBITRATION;
        d.timeline.push({ status: DISPUTE_STATUS.ARBITRATION, time: _now(), label: DISPUTE_STATUS_LABEL.arbitration.name, note: '进入平台仲裁程序' });
        _addLog(CS_LOG_TYPES.DISPUTE_ARBITRATION, { id: d.id });
        return d;
    }
    function executeArbitration(disputeId) {
        const d = _cs().disputes.find(x => x.id === disputeId);
        if (!d || d.status !== DISPUTE_STATUS.ARBITRATION) return null;
        let buyerWinRate = (typeof ARBITRATION_RULES !== 'undefined' ? ARBITRATION_RULES.buyerWinRate : 0.7);
        buyerWinRate += (d.buyerEvidences.length - d.sellerEvidences.length) * 0.05;
        buyerWinRate = Math.max(0.1, Math.min(0.95, buyerWinRate));
        const buyerWins = Math.random() < buyerWinRate;
        const compensation = buyerWins ? parseFloat((d.amount * (0.5 + Math.random() * 0.5)).toFixed(2)) : 0;
        d.arbitration = { time: _now(), buyerWins, compensation, rate: buyerWinRate.toFixed(2) };
        d.status = buyerWins ? DISPUTE_STATUS.RULED_BUYER : DISPUTE_STATUS.RULED_SELLER;
        d.timeline.push({ status: d.status, time: d.arbitration.time, label: (buyerWins ? DISPUTE_STATUS_LABEL.ruled_buyer : DISPUTE_STATUS_LABEL.ruled_seller).name,
            note: buyerWins ? `买家胜诉，赔付 ¥${compensation.toFixed(2)}` : '商家胜诉，无需赔付' });
        if (buyerWins && _gs && typeof _gs.spendFunds === 'function' && compensation > 0) _gs.spendFunds(compensation, `纠纷仲裁赔付 - ${d.productName}`);
        if (buyerWins && _gs && _gs.addReputation) _gs.addReputation(-3);
        _addLog(CS_LOG_TYPES.DISPUTE_RULED, { id: d.id, buyerWins, compensation });
        setTimeout(() => {
            d.status = DISPUTE_STATUS.COMPLETED;
            d.timeline.push({ status: DISPUTE_STATUS.COMPLETED, time: _now(), label: DISPUTE_STATUS_LABEL.completed.name, note: '纠纷处理完成' });
            _addLog(CS_LOG_TYPES.DISPUTE_COMPLETED, { id: d.id, buyerWins });
        }, 500);
        return d;
    }

    // ---------- 法律上诉（CS 侧表单流程） ----------
    function canFileAppeal(source) {
        const cfg = (typeof APPEAL_CONFIG !== 'undefined') ? APPEAL_CONFIG : { fileWithinHours: 72 };
        const limit = cfg.fileWithinHours || 72;
        if (!source) return { ok: false, reason: '来源不存在' };
        const r = typeof source === 'string'
            ? (_cs().returns.find(x => x.id === source) || _cs().disputes.find(x => x.id === source))
            : source;
        if (!r) return { ok: false, reason: '关联的售后单/纠纷不存在' };
        let lastBadTime = null;
        let reasonText = '';
        if (r.auditResult === false) {
            lastBadTime = r.auditTime;
            reasonText = r.type === RETURN_TYPES.REFUND_ONLY ? '仅退款申请被商家拒绝' : '退换货申请被商家拒绝';
        }
        if (r.inspectionResult === 'fail') {
            lastBadTime = (r.inspection && r.inspection.endTime) || r.sellerReceiveTime;
            reasonText = '售后客服质检不通过，退款被拒';
        }
        if (r.status === DISPUTE_STATUS.RULED_SELLER && r.arbitration) {
            lastBadTime = r.arbitration.time;
            reasonText = '平台仲裁判决商家胜诉';
        }
        if (!lastBadTime) return { ok: false, reason: '当前结果不满足法律上诉条件' };
        const hours = _hours(_now(), lastBadTime);
        if (hours > limit) return { ok: false, reason: `已超过上诉期（${limit}小时）` };
        return { ok: true, reason: reasonText, remainingHours: Math.max(0, limit - hours) };
    }

    function createAppeal(form) {
        if (!form) return { ok: false, reason: '上诉表单为空' };
        if (!form.returnId && !form.disputeId) return { ok: false, reason: '缺少关联的售后单号或纠纷单号' };
        let source = null, sourceType = null;
        if (form.returnId) { source = _cs().returns.find(x => x.id === form.returnId); sourceType = 'return'; }
        if (!source && form.disputeId) { source = _cs().disputes.find(x => x.id === form.disputeId); sourceType = 'dispute'; }
        if (!source) return { ok: false, reason: '关联单不存在' };
        const check = canFileAppeal(source);
        if (!check.ok) return { ok: false, reason: check.reason };
        const grounds = ((typeof APPEAL_GROUNDS !== 'undefined' ? APPEAL_GROUNDS : []).find(g => g.id === form.groundId))
            || { id: 'other', name: '其他民事纠纷', weight: 1.0 };
        const claimIds = Array.isArray(form.claimIds) ? form.claimIds : [];
        const claimInfos = claimIds.map(cid => (APPEAL_CLAIM_TYPES || []).find(c => c.id === cid)).filter(Boolean);
        let amount = parseFloat(form.claimAmount || (source.amount || 0));
        if (!(amount >= 0) || !Number.isFinite(amount)) amount = 0;
        const softCap = Math.max((parseFloat(source.amount) || 0) * 3, 100);
        amount = Math.min(amount, softCap, 1000000);
        amount = Math.round(amount * 100) / 100;
        const now = _now();
        const appeal = {
            id: _id('apl'),
            caseNo: `APL-${String(now.day).padStart(3, '0')}-${String(_cs().appeals.length + 1).padStart(4, '0')}`,
            sourceType, returnId: form.returnId || null, disputeId: form.disputeId || null,
            returnNo: source.orderNo || source.id, productName: source.productName || '', buyerName: source.buyerName || '',
            amount: source.amount || 0, groundId: grounds.id, groundName: grounds.name, groundWeight: grounds.weight,
            reason: String(form.reason || '').slice(0, 1000),
            evidences: Array.isArray(form.evidences) ? form.evidences.slice(0, 20).map(e => ({ type: e.type || 'text', content: String(e.content || '').slice(0, 1000), uploadTime: now })) : [],
            claims: claimInfos.map(c => ({ id: c.id, name: c.name, icon: c.icon })),
            claimAmount: amount, demandStatement: String(form.demandStatement || '').slice(0, 1000),
            createTime: now, acceptedTime: null, reviewTime: null, scheduledTime: null, ruledTime: null,
            compensatedTime: null, closedTime: null, status: APPEAL_STATUS.SUBMITTED,
            courtFeeRefund: null, compensation: 0, buyerWins: null, ruleNote: '', timeline: [], logs: []
        };
        appeal.timeline.push({ status: APPEAL_STATUS.SUBMITTED, time: now, label: APPEAL_STATUS_LABEL.submitted.name,
            note: `买家提交法律上诉：${grounds.name}（诉求金额 ¥${amount.toFixed(2)}）` });
        _cs().appeals.push(appeal);
        _cs().statistics.totalAppeals = (_cs().statistics.totalAppeals || 0) + 1;
        _addLog(CS_LOG_TYPES.APPEAL_CREATED, { id: appeal.id, groundId: appeal.groundId });
        _addNotification(`⚖️ 新法律上诉：${appeal.productName} - ${grounds.name}`, 'error', appeal.id);
        return { ok: true, data: appeal };
    }

    function acceptAppeal(appealId) {
        const a = _cs().appeals.find(x => x.id === appealId);
        if (!a || a.status !== APPEAL_STATUS.SUBMITTED) return null;
        a.acceptedTime = _now();
        a.status = APPEAL_STATUS.ACCEPTED;
        a.timeline.push({ status: APPEAL_STATUS.ACCEPTED, time: a.acceptedTime, label: APPEAL_STATUS_LABEL.accepted.name, note: `法院已受理，案号 ${a.caseNo}` });
        _addLog(CS_LOG_TYPES.APPEAL_ACCEPTED, { id: a.id });
        return a;
    }
    function reviewAppeal(appealId, note) {
        const a = _cs().appeals.find(x => x.id === appealId);
        if (!a || a.status !== APPEAL_STATUS.ACCEPTED) return null;
        a.reviewTime = _now();
        a.status = APPEAL_STATUS.REVIEWING;
        a.timeline.push({ status: APPEAL_STATUS.REVIEWING, time: a.reviewTime, label: APPEAL_STATUS_LABEL.reviewing.name, note: note || '证据与材料审核中' });
        _addLog(CS_LOG_TYPES.APPEAL_REVIEWING, { id: a.id });
        return a;
    }
    function scheduleAppealHearing(appealId, info) {
        const a = _cs().appeals.find(x => x.id === appealId);
        if (!a || a.status !== APPEAL_STATUS.REVIEWING) return null;
        a.scheduledTime = _now();
        a.status = APPEAL_STATUS.HEARING_SCHEDULED;
        a.timeline.push({ status: APPEAL_STATUS.HEARING_SCHEDULED, time: a.scheduledTime, label: APPEAL_STATUS_LABEL.hearing_scheduled.name, note: info || '已排期开庭' });
        _addLog(CS_LOG_TYPES.APPEAL_HEARING_SCHEDULED, { id: a.id });
        return a;
    }

    function ruleAppeal(appealId, override) {
        const a = _cs().appeals.find(x => x.id === appealId);
        if (!a) return null;
        if (![APPEAL_STATUS.HEARING_SCHEDULED, APPEAL_STATUS.REVIEWING, APPEAL_STATUS.ACCEPTED].includes(a.status)) return null;
        const cfg = (typeof APPEAL_CONFIG !== 'undefined') ? APPEAL_CONFIG : { buyerWinBase: 0.48, courtFeeBase: 50 };
        let buyerWinRate = cfg.buyerWinBase || 0.48;
        buyerWinRate += Math.min(0.1, (a.evidences ? a.evidences.length : 0) * 0.02);
        buyerWinRate += (a.groundWeight || 1) * 0.05 - 0.05;
        const buyerWins = (override && typeof override.buyerWins === 'boolean') ? override.buyerWins : Math.random() < buyerWinRate;
        const claimIds = (a.claims || []).map(c => c.id);
        let multiplier = 1;
        if (claimIds.includes('triple')) multiplier = 3;
        else if (claimIds.includes('ten')) multiplier = 10;
        else if (claimIds.includes('compensation')) multiplier = 1.5;
        // 赔偿硬顶 100 万，避免「诉求×十倍」绕过金额限制
        let compensation = buyerWins ? parseFloat((a.claimAmount * multiplier).toFixed(2)) : 0;
        if (compensation > 1000000) compensation = 1000000;
        a.ruledTime = _now();
        a.buyerWins = buyerWins;
        a.compensation = compensation;
        a.status = buyerWins ? APPEAL_STATUS.RULED_BUYER : APPEAL_STATUS.RULED_SELLER;
        a.ruleNote = buyerWins
            ? `法院判决：买家胜诉。商家需赔偿 ¥${compensation.toFixed(2)}，并承担案件受理费 ¥${(cfg.courtFeeBase || 50).toFixed(2)}`
            : `法院判决：商家胜诉。驳回上诉请求，案件受理费 ¥${(cfg.courtFeeBase || 50).toFixed(2)} 由买家承担`;
        a.timeline.push({ status: a.status, time: a.ruledTime, label: (buyerWins ? APPEAL_STATUS_LABEL.ruled_buyer : APPEAL_STATUS_LABEL.ruled_seller).name, note: a.ruleNote });
        _addLog(CS_LOG_TYPES.APPEAL_RULED, { id: a.id, buyerWins, compensation });
        if (_gs && _gs.addReputation) _gs.addReputation(buyerWins ? -5 : 1);
        if (buyerWins && compensation > 0) setTimeout(() => executeAppealCompensation(a.id), 500);
        else {
            setTimeout(() => {
                a.status = APPEAL_STATUS.COMPLETED;
                a.closedTime = _now();
                a.timeline.push({ status: APPEAL_STATUS.COMPLETED, time: a.closedTime, label: APPEAL_STATUS_LABEL.completed.name, note: '本案已结案' });
                _addLog(CS_LOG_TYPES.APPEAL_COMPLETED, { id: a.id, buyerWins });
            }, 400);
        }
        _addNotification(`⚖️ 法律上诉判决：${a.productName} - ${buyerWins ? `买家胜诉，需赔 ¥${compensation.toFixed(2)}` : '商家胜诉'}`, buyerWins ? 'error' : 'success', a.id);
        return a;
    }

    function executeAppealCompensation(appealId) {
        const a = _cs().appeals.find(x => x.id === appealId);
        if (!a || a.buyerWins !== true) return null;
        if (a._compensating || a.status === APPEAL_STATUS.COMPENSATED || a.status === APPEAL_STATUS.COMPLETED) return a;
        a._compensating = true;
        const compensation = a.compensation || 0;
        a.compensatedTime = _now();
        a.status = APPEAL_STATUS.COMPENSATED;
        a.timeline.push({ status: APPEAL_STATUS.COMPENSATED, time: a.compensatedTime, label: APPEAL_STATUS_LABEL.compensated.name, note: `已执行赔偿 ¥${compensation.toFixed(2)}` });
        if (_gs && typeof _gs.spendFunds === 'function' && compensation > 0) {
            _gs.spendFunds(compensation, `法律上诉赔偿 - ${a.productName}（案号 ${a.caseNo}）`);
        }
        _addLog(CS_LOG_TYPES.APPEAL_COMPENSATED, { id: a.id, compensation });
        const fee = (typeof APPEAL_CONFIG !== 'undefined' ? APPEAL_CONFIG.courtFeeBase : 50) || 50;
        if (_gs && typeof _gs.spendFunds === 'function') _gs.spendFunds(fee, `法律上诉案件受理费 - ${a.caseNo}`);
        a.courtFeeRefund = fee;
        setTimeout(() => {
            a.status = APPEAL_STATUS.COMPLETED;
            a.closedTime = _now();
            a.timeline.push({ status: APPEAL_STATUS.COMPLETED, time: a.closedTime, label: APPEAL_STATUS_LABEL.completed.name,
                note: `本案已结案：赔偿 ¥${compensation.toFixed(2)} + 受理费 ¥${fee.toFixed(2)}` });
            _addLog(CS_LOG_TYPES.APPEAL_COMPLETED, { id: a.id, buyerWins: true });
        }, 400);
        return a;
    }

    function getAppealsBySource(sourceId) {
        return _cs().appeals.filter(a => a.returnId === sourceId || a.disputeId === sourceId);
    }

    function getPendingItems() {
        return {
            consultations: _cs().consultations.filter(c => c.status === CONSULTATION_STATUS.PENDING),
            returns: _cs().returns.filter(r =>
                r.status === RETURN_STATUS.PENDING || r.status === RETURN_STATUS.BUYER_SHIPPED ||
                r.status === RETURN_STATUS.CS_INSPECTION || r.status === RETURN_STATUS.INSPECTION_PASS),
            disputes: _cs().disputes.filter(d =>
                [DISPUTE_STATUS.ACCEPTED, DISPUTE_STATUS.EVIDENCE, DISPUTE_STATUS.MEDIATION, DISPUTE_STATUS.ARBITRATION].includes(d.status)),
            appeals: _cs().appeals.filter(a => ['submitted', 'accepted', 'reviewing', 'hearing_scheduled'].includes(a.status))
        };
    }

    function getUnreadNotifications() { return _cs().notifications.filter(n => !n.read); }
    function markNotificationRead(notifId) {
        const n = _cs().notifications.find(x => x.id === notifId);
        if (n) n.read = true;
        return n;
    }

    function getStatistics() {
        if (!_gs || !_gs.state) {
            if (typeof gameState !== 'undefined' && gameState) {
                try { init(gameState); } catch (_) {}
            }
        }
        if (!_gs || !_gs.state || !_gs.state.customerService) {
            return {
                pendingConsultations: 0, pendingReturns: 0, pendingDisputes: 0, pendingAppeals: 0,
                inspectionPassRate: 0, returnApproveRate: 0, resolutionRate: 0, avgResponseTime: 0,
                totalConsultations: 0, totalReturns: 0, totalDisputes: 0, totalAppeals: 0, totalAppealsClosed: 0
            };
        }
        const cs = _cs();
        _ensureStructure(cs);
        const stats = { ...(cs.statistics || {}) };
        stats.avgResponseTime = parseFloat((stats.avgResponseTime || 0).toFixed(1));
        stats.resolutionRate = parseFloat(((stats.resolutionRate || 0) * 100).toFixed(1));
        stats.returnApproveRate = parseFloat(((stats.returnApproveRate || 0) * 100).toFixed(1));
        stats.inspectionPassRate = parseFloat(((stats.inspectionPassRate || 0) * 100).toFixed(1));
        stats.totalAppeals = stats.totalAppeals || 0;
        stats.pendingConsultations = (cs.consultations || []).filter(c => c.status === 'pending').length;
        stats.pendingReturns = (cs.returns || []).filter(r =>
            ['pending', 'buyer_shipped', 'seller_received', 'cs_inspection', 'inspection_pass', 'refunding', 'exchanging'].includes(r.status)).length;
        stats.pendingDisputes = (cs.disputes || []).filter(d =>
            ['accepted', 'evidence', 'mediation', 'arbitration'].includes(d.status)).length;
        stats.pendingAppeals = (cs.appeals || []).filter(a =>
            ['submitted', 'accepted', 'reviewing', 'hearing_scheduled'].includes(a.status)).length;
        stats.totalAppealsClosed = (cs.appeals || []).filter(a => ['completed', 'closed'].includes(a.status)).length;
        return stats;
    }

    function simulateBuyerReaction(consultationId) {
        const c = _cs().consultations.find(x => x.id === consultationId);
        if (!c || c.status !== CONSULTATION_STATUS.REPLIED) return null;
        if (Math.random() < 0.6) resolveConsultation(consultationId);
        else buyerFollowUp(consultationId, '还有个问题想再确认下...');
        return c;
    }

    /** 买家对客服回复的模拟回应（像真实客服对话：多数满意、偶有追问） */
    function buyerSimulateFollowUp(consultationId) {
        const c = _cs().consultations.find(x => x.id === consultationId);
        if (!c || (c.status !== CONSULTATION_STATUS.REPLIED && c.status !== CONSULTATION_STATUS.PENDING)) return null;
        const roll = Math.random();
        const replies = [
            '好的，谢谢～',
            '嗯嗯明白了，那我再考虑一下',
            '能不能再优惠一点？包邮吗？',
            '大概什么时候能发货呀？'
        ];
        const content = replies[Math.floor(roll * replies.length) % replies.length];
        c.messages.push({ role: 'buyer', name: c.buyerName, content, time: _now() });
        c.status = CONSULTATION_STATUS.PENDING;
        _addNotification(`💬 买家回应：${c.buyerName}`, 'info', c.id);
        return c;
    }

    /** 解决后记录买家满意度（好/中/差 → 5/3/1 分），影响服务统计与信誉 */
    function addConsultationSatisfaction(consultationId, rating) {
        const c = _cs().consultations.find(x => x.id === consultationId);
        if (!c) return null;
        c.satisfaction = rating; // good | neutral | bad
        const st = _cs().statistics;
        st.ratedConsultations = (st.ratedConsultations || 0) + 1;
        st.satisfactionSum = (st.satisfactionSum || 0) + (rating === 'good' ? 5 : (rating === 'neutral' ? 3 : 1));
        st.avgSatisfaction = Math.round((st.satisfactionSum / st.ratedConsultations) * 10) / 10;
        if (_gs && typeof _gs.addReputation === 'function') {
            try {
                if (rating === 'bad') _gs.addReputation(-1);
                else if (rating === 'good') _gs.addReputation(0.5);
            } catch (_) {}
        }
        _addLog(CS_LOG_TYPES.CONSULTATION_RESOLVED, { id: c.id, satisfaction: rating });
        return c;
    }

    return {
        init, reset, hasActiveCsStaff,
        createConsultation, replyConsultation, buyerFollowUp, resolveConsultation, markConsultationMissed,
        buyerSimulateFollowUp, addConsultationSatisfaction,
        createReturn, auditReturn, buyerShipReturn, sellerReceiveReturn,
        startCsInspection, completeCsInspection, executeRefundAfterInspection, forceRefundKeepGoods,
        getReturnAddress: (returnId) => {
            const r = _cs().returns.find(x => x.id === returnId);
            return r ? r.returnAddress : _returnAddress();
        },
        createDispute, addSellerEvidence, addBuyerEvidence, startMediation, addMediationRecord, startArbitration, executeArbitration,
        canFileAppeal, createAppeal, acceptAppeal, reviewAppeal, scheduleAppealHearing, ruleAppeal, executeAppealCompensation, getAppealsBySource,
        getPendingItems, getUnreadNotifications, markNotificationRead, getStatistics,
        simulateBuyerReaction, addNotification: _addNotification, addLog: _addLog
    };
})();

const csState = AfterSalesState;
if (typeof window !== 'undefined') {
    window.AfterSalesState = AfterSalesState;
    window.csState = AfterSalesState;
}
