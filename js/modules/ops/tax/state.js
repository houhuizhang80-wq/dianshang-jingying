/**
 * 纳税中心 — State（存档键 state.tax）
 */
const TaxState = (function () {
    'use strict';

    let _state = null;
    let _gs = null;
    const _listeners = new Set();

    function _clone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    function _merge(target, defaults) {
        if (target == null || typeof target !== 'object') return _clone(defaults);
        const out = Array.isArray(target) ? [...target] : { ...target };
        for (const key of Object.keys(defaults)) {
            if (target[key] === undefined) out[key] = _clone(defaults[key]);
            else if (defaults[key] && typeof defaults[key] === 'object' && !Array.isArray(defaults[key])) {
                out[key] = _merge(target[key], defaults[key]);
            }
        }
        return out;
    }

    function _day() {
        try { return (_gs && _gs.state && _gs.state.gameTime && _gs.state.gameTime.day) || 1; }
        catch (_) { return 1; }
    }

    function _notify() {
        try { if (typeof eventBus !== 'undefined') eventBus.emit('tax:stateChanged', _state); } catch (_) {}
        _listeners.forEach(fn => { try { fn(_state); } catch (_) {} });
    }

    function init(gameState) {
        try {
            _gs = gameState;
            if (!gameState.state) gameState.state = {};
            if (!gameState.state.tax) gameState.state.tax = _clone(TAX_INITIAL_STATE);
            else gameState.state.tax = _merge(gameState.state.tax, TAX_INITIAL_STATE);
            _state = gameState.state.tax;
            // 旧档假周期 2024/1 → 对齐游戏开局真实年月
            try {
                const startY = (typeof GAME_START_DATE !== 'undefined' && GAME_START_DATE.year) ? GAME_START_DATE.year : 2026;
                const startM = (typeof GAME_START_DATE !== 'undefined' && GAME_START_DATE.month) ? GAME_START_DATE.month : 8;
                if (_state.currentPeriod && (_state.currentPeriod.year < 2026 || !_state.currentPeriod.year)) {
                    _state.currentPeriod.year = startY;
                    _state.currentPeriod.month = startM;
                }
                if (_state.currentPeriod && _state.currentPeriod.deductibleCosts
                    && _state.currentPeriod.deductibleCosts.platform == null) {
                    _state.currentPeriod.deductibleCosts.platform = 0;
                }
            } catch (_) {}
            _notify();
            return { success: true };
        } catch (e) {
            return { success: false, msg: e.message };
        }
    }

    function getState() { return _state; }

    function subscribe(cb) {
        _listeners.add(cb);
        return () => _listeners.delete(cb);
    }

    function addRecord(type, data) {
        if (!_state) return null;
        const record = {
            id: (typeof generateTaxId === 'function' ? generateTaxId('rec') : `rec_${Date.now()}`),
            type, data: data || {}, timestamp: Date.now(), day: _day()
        };
        _state.records.unshift(record);
        if (_state.records.length > 500) _state.records.pop();
        _notify();
        return record;
    }

    function createMonthlyReport(year, month, data) {
        if (!_state) return null;
        const idx = _state.monthlyReports.findIndex(r => r.year === year && r.month === month);
        const report = {
            id: (typeof generateTaxId === 'function' ? generateTaxId('month') : `month_${Date.now()}`),
            year, month, ...data, createdAt: Date.now()
        };
        if (idx >= 0) _state.monthlyReports[idx] = { ..._state.monthlyReports[idx], ...data, updatedAt: Date.now() };
        else _state.monthlyReports.push(report);
        _notify();
        return report;
    }

    function markDeclared(year, month) {
        if (!_state) return { success: false };
        const report = _state.monthlyReports.find(r => r.year === year && r.month === month);
        const today = _day();
        if (report) { report.declared = true; report.declareDate = today; }
        if (_state.currentPeriod.year === year && _state.currentPeriod.month === month) {
            _state.currentPeriod.declared = true;
            _state.currentPeriod.declareDate = today;
        }
        addRecord('declare', { year, month, day: today });
        _notify();
        return { success: true };
    }

    function markPaid(year, month, amount) {
        if (!_state) return { success: false };
        const report = _state.monthlyReports.find(r => r.year === year && r.month === month);
        const today = _day();
        if (report) {
            report.paid = true;
            report.payDate = today;
            report.paidAmount = amount || report.totalPayable;
        }
        if (_state.currentPeriod.year === year && _state.currentPeriod.month === month) {
            _state.currentPeriod.paid = true;
            _state.currentPeriod.payDate = today;
        }
        addRecord('pay', { year, month, amount: amount || 0, day: today });
        _notify();
        return { success: true };
    }

    function addWarning(msg, level) {
        if (!_state) return null;
        const warning = {
            id: (typeof generateTaxId === 'function' ? generateTaxId('warn') : `warn_${Date.now()}`),
            message: msg, level: level || 'info', timestamp: Date.now(), day: _day(), dismissed: false
        };
        _state.warnings.unshift(warning);
        if (_state.warnings.length > 100) _state.warnings.pop();
        _notify();
        return warning;
    }

    function clearPending(penaltyId) {
        if (!_state) return { success: false };
        const idx = _state.pendingPenalties.findIndex(p => p.id === penaltyId);
        if (idx < 0) return { success: false, msg: '未找到该处罚记录' };
        const removed = _state.pendingPenalties.splice(idx, 1)[0];
        addRecord('clear_penalty', { penaltyId, removed });
        _notify();
        return { success: true, removed };
    }

    function getMonthlyReport(year, month) {
        return (_state && _state.monthlyReports.find(r => r.year === year && r.month === month)) || null;
    }
    function getUnpaidReports() { return (_state && _state.monthlyReports.filter(r => !r.paid)) || []; }
    function getUndelcaredReports() { return (_state && _state.monthlyReports.filter(r => !r.declared)) || []; }

    function reset(gameState) {
        try {
            const gs = gameState || _gs;
            if (!gs || !gs.state) return { success: false };
            gs.state.tax = _clone(TAX_INITIAL_STATE);
            _state = gs.state.tax;
            _gs = gs;
            _notify();
            return { success: true };
        } catch (e) {
            return { success: false, msg: e.message };
        }
    }

    return {
        init, reset, getState, subscribe, addRecord, createMonthlyReport,
        markDeclared, markPaid, addWarning, clearPending,
        getMonthlyReport, getUnpaidReports, getUndelcaredReports
    };
})();

if (typeof window !== 'undefined') window.TaxState = TaxState;
