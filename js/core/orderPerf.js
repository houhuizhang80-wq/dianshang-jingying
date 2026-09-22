/**
 * OrderPerf — 爆单 / 高订单量性能工具（可增量接入，不改玩法）
 *
 * 1. 按状态 Map 索引，整点只扫需推进的单
 * 2. 增量维护 counts，仪表盘 / Tab 角标 O(1)
 * 3. 分片任务 + 负载档位 + 轻量裁剪
 *
 * 注意：byStatus 是 Map，禁止 byStatus[status]，请用 getStatusBucket / get()
 * 全局：window.OrderPerf
 */
(function (global) {
    'use strict';

    var INDEX_THRESHOLD = 80;
    // 更早轻量裁剪，避免等堆到几千才清
    var LIGHT_PRUNE_AT = 900;
    var LIGHT_PRUNE_COOLDOWN_HOURS = 1;
    var EMPTY_ARR = [];

    function blankCounts() {
        return {
            pending_payment: { all: 0, visible: 0 },
            pending_packing: { all: 0, visible: 0 },
            pending_shipment: { all: 0, visible: 0 },
            shipped: { all: 0, visible: 0 },
            completed: { all: 0, visible: 0 },
            cancelled: { all: 0, visible: 0 },
            returned: { all: 0, visible: 0 },
            refunded: { all: 0, visible: 0 },
            unknown: { all: 0, visible: 0 },
            totalVisible: 0,
            todayOrders: 0,
            todayDay: -1
        };
    }

    function ensureBucket(counts, status) {
        if (!counts[status]) counts[status] = { all: 0, visible: 0 };
        return counts[status];
    }

    var OrderPerf = {
        version: 2,
        enabled: true,
        dirty: true,
        ordersRef: null,
        byStatus: null,
        byId: null,
        counts: blankCounts(),
        _lastLightPruneKey: -1,
        _stats: { rebuilds: 0, tickUses: 0, chunkRuns: 0 },

        getLoadLevel: function (n) {
            n = n || 0;
            if (n < 500) return 0;
            if (n < 2000) return 1;
            if (n < 5000) return 2;
            if (n < 12000) return 3;
            return 4;
        },

        getOrderCount: function (orders) {
            return (orders && orders.length) || 0;
        },

        markDirty: function () {
            this.dirty = true;
        },

        _incCount: function (status, hidden, delta) {
            var c = ensureBucket(this.counts, status || 'unknown');
            c.all += delta;
            if (!hidden) {
                c.visible += delta;
                this.counts.totalVisible += delta;
            }
            if (c.all < 0) c.all = 0;
            if (c.visible < 0) c.visible = 0;
            if (this.counts.totalVisible < 0) this.counts.totalVisible = 0;
        },

        _recomputeTodayOrders: function (today) {
            var day = (today == null) ? -1 : today;
            this.counts.todayDay = day;
            if (day < 0 || !this.byStatus) {
                this.counts.todayOrders = 0;
                return 0;
            }
            var n = 0;
            var keys = ['pending_payment', 'pending_packing', 'pending_shipment', 'shipped', 'completed'];
            for (var k = 0; k < keys.length; k++) {
                var arr = this.byStatus.get(keys[k]);
                if (!arr) continue;
                for (var i = 0, len = arr.length; i < len; i++) {
                    var o = arr[i];
                    if (o && !o.hidden && o.createTime && o.createTime.day === day) n++;
                }
            }
            this.counts.todayOrders = n;
            return n;
        },

        rebuild: function (orders) {
            var byStatus = new Map();
            var byId = new Map();
            var counts = blankCounts();
            if (orders && orders.length) {
                for (var i = 0, len = orders.length; i < len; i++) {
                    var o = orders[i];
                    if (!o) continue;
                    if (o.id != null) byId.set(o.id, o);
                    var s = o.status || 'unknown';
                    var arr = byStatus.get(s);
                    if (!arr) {
                        arr = [];
                        byStatus.set(s, arr);
                    }
                    arr.push(o);
                    var b = ensureBucket(counts, s);
                    b.all++;
                    if (!o.hidden) {
                        b.visible++;
                        counts.totalVisible++;
                    }
                }
            }
            this.byStatus = byStatus;
            this.byId = byId;
            this.counts = counts;
            this.ordersRef = orders || null;
            this.dirty = false;
            this._stats.rebuilds++;
            return this;
        },

        ensure: function (orders) {
            if (!this.enabled) return this;
            if (!orders) {
                this.markDirty();
                return this;
            }
            if (!this.dirty && this.ordersRef === orders && this.byStatus) return this;
            return this.rebuild(orders);
        },

        onAdded: function (order) {
            if (!this.enabled || !order) return;
            if (this.dirty || !this.byStatus) {
                this.markDirty();
                return;
            }
            if (order.id != null) this.byId.set(order.id, order);
            var s = order.status || 'pending_payment';
            var arr = this.byStatus.get(s);
            if (!arr) {
                arr = [];
                this.byStatus.set(s, arr);
            }
            arr.push(order);
            this._incCount(s, !!order.hidden, 1);
            if (!order.hidden && order.createTime && this.counts.todayDay >= 0
                && order.createTime.day === this.counts.todayDay) {
                this.counts.todayOrders++;
            }
        },

        onStatusChanged: function (order, prevStatus, nextStatus) {
            if (!this.enabled || !order) return;
            if (this.dirty || !this.byStatus) {
                this.markDirty();
                return;
            }
            if (prevStatus === nextStatus) return;
            // 爆单性能：swap-remove（桶内顺序无意义，渲染/推进都会自行排序或只看计数）
            var from = this.byStatus.get(prevStatus);
            if (from) {
                var idx = from.indexOf(order);
                if (idx >= 0) {
                    var lastIdx = from.length - 1;
                    if (idx !== lastIdx) from[idx] = from[lastIdx];
                    from.pop();
                }
            }
            var to = this.byStatus.get(nextStatus);
            if (!to) {
                to = [];
                this.byStatus.set(nextStatus, to);
            }
            to.push(order);
            if (order.id != null) this.byId.set(order.id, order);
            this._incCount(prevStatus || 'unknown', !!order.hidden, -1);
            this._incCount(nextStatus || 'unknown', !!order.hidden, 1);
        },

        onHiddenChanged: function (order, wasHidden, nowHidden) {
            if (!this.enabled || !order) return;
            if (this.dirty || !this.byStatus) {
                this.markDirty();
                return;
            }
            wasHidden = !!wasHidden;
            nowHidden = !!nowHidden;
            if (wasHidden === nowHidden) return;
            var s = order.status || 'unknown';
            var b = ensureBucket(this.counts, s);
            if (nowHidden) {
                b.visible = Math.max(0, b.visible - 1);
                this.counts.totalVisible = Math.max(0, this.counts.totalVisible - 1);
                if (order.createTime && this.counts.todayDay >= 0
                    && order.createTime.day === this.counts.todayDay) {
                    this.counts.todayOrders = Math.max(0, this.counts.todayOrders - 1);
                }
            } else {
                b.visible++;
                this.counts.totalVisible++;
                if (order.createTime && this.counts.todayDay >= 0
                    && order.createTime.day === this.counts.todayDay) {
                    this.counts.todayOrders++;
                }
            }
        },

        getStatusBucket: function (status, orders) {
            if (orders) this.ensure(orders);
            if (!this.byStatus) return EMPTY_ARR;
            return this.byStatus.get(status) || EMPTY_ARR;
        },

        getByStatus: function (status, orders) {
            var arr = this.getStatusBucket(status, orders);
            return arr.length ? arr.slice() : [];
        },

        getById: function (id, orders) {
            if (orders) this.ensure(orders);
            return (this.byId && this.byId.get(id)) || null;
        },

        getTabCounts: function (orders, today) {
            if (orders) this.ensure(orders);
            if (!this.counts) this.counts = blankCounts();
            if (today != null && today !== this.counts.todayDay) {
                this._recomputeTodayOrders(today);
            }
            var c = this.counts;
            var g = function (st) { return c[st] || { all: 0, visible: 0 }; };
            return {
                pendingPayment: g('pending_payment').visible,
                pendingPacking: g('pending_packing').visible,
                pendingShip: g('pending_shipment').visible,
                shipped: g('shipped').visible,
                completed: g('completed').all,
                cancelled: g('cancelled').all,
                all: c.totalVisible || 0,
                totalVisible: c.totalVisible || 0,
                todayOrders: c.todayOrders || 0
            };
        },

        getTickOrders: function (orders) {
            if (!this.enabled || !orders || !orders.length) return orders || [];
            if (orders.length < INDEX_THRESHOLD) return orders;

            this.ensure(orders);
            this._stats.tickUses++;
            var out = [];
            var pushAll = function (arr) {
                if (!arr) return;
                for (var i = 0, len = arr.length; i < len; i++) {
                    if (arr[i]) out.push(arr[i]);
                }
            };
            var pushIf = function (arr, pred) {
                if (!arr) return;
                for (var i = 0, len = arr.length; i < len; i++) {
                    var o = arr[i];
                    if (o && pred(o)) out.push(o);
                }
            };

            pushAll(this.byStatus.get('pending_payment'));
            pushAll(this.byStatus.get('shipped'));
            pushIf(this.byStatus.get('cancelled'), function (o) { return !o.hidden; });
            pushIf(this.byStatus.get('returned'), function (o) { return !o.hidden; });
            pushIf(this.byStatus.get('completed'), function (o) {
                return (!o.review && !o.reviewGenerated) || !o.hidden;
            });
            return out;
        },

        recommendPageSize: function (orderCount) {
            var n = orderCount || 0;
            if (n > 10000) return 20;
            if (n > 5000) return 30;
            if (n > 2000) return 40;
            if (n > 800) return 50;
            return 60;
        },

        shouldAutoPrune: function (orderCount) {
            return (orderCount || 0) > 800;
        },

        runChunked: function (items, worker, options) {
            var self = this;
            options = options || {};
            var chunkSize = options.chunkSize || 80;
            var pauseMs = options.pauseMs != null ? options.pauseMs : 0;
            var signal = options.signal;
            var list = items || [];
            self._stats.chunkRuns++;

            return new Promise(function (resolve, reject) {
                var i = 0;
                var processed = 0;

                function step() {
                    if (signal && signal.aborted) {
                        reject(new Error('aborted'));
                        return;
                    }
                    var end = Math.min(i + chunkSize, list.length);
                    try {
                        for (; i < end; i++) {
                            worker(list[i], i);
                            processed++;
                        }
                    } catch (e) {
                        reject(e);
                        return;
                    }
                    if (i >= list.length) {
                        resolve({ processed: processed });
                        return;
                    }
                    if (pauseMs > 0) {
                        setTimeout(step, pauseMs);
                    } else if (typeof requestAnimationFrame === 'function') {
                        requestAnimationFrame(function () { setTimeout(step, 0); });
                    } else {
                        setTimeout(step, 0);
                    }
                }

                step();
            });
        },

        scheduleIdle: function (fn, timeout) {
            if (typeof requestIdleCallback === 'function') {
                return requestIdleCallback(fn, { timeout: timeout || 800 });
            }
            return setTimeout(fn, 16);
        },

        maybeLightPrune: function (gs) {
            if (!this.enabled || !gs || typeof gs._pruneOldData !== 'function') return null;
            var orders = gs.state && gs.state.orders;
            var n = (orders && orders.length) || 0;
            var shopLv = 1;
            try { shopLv = (gs.state && gs.state.shop && gs.state.shop.level) || 1; } catch (_) {}
            // 店铺等级越高，越早开裁剪
            var threshold = shopLv >= 5 ? 600 : (shopLv >= 3 ? 750 : LIGHT_PRUNE_AT);
            if (n < threshold) return null;
            var gt = gs.state.gameTime || { day: 1, hour: 0 };
            var key = (gt.day || 0) * 24 + (gt.hour || 0);
            if (this._lastLightPruneKey >= 0 && (key - this._lastLightPruneKey) < LIGHT_PRUNE_COOLDOWN_HOURS) {
                return null;
            }
            this._lastLightPruneKey = key;
            var result = gs._pruneOldData(n > 2500 || shopLv >= 4);
            this.markDirty();
            return result;
        },

        getStats: function () {
            return {
                dirty: this.dirty,
                rebuilds: this._stats.rebuilds,
                tickUses: this._stats.tickUses,
                chunkRuns: this._stats.chunkRuns,
                statusKeys: this.byStatus ? Array.from(this.byStatus.keys()) : [],
                indexed: this.byId ? this.byId.size : 0,
                counts: this.counts
            };
        }
    };

    global.OrderPerf = OrderPerf;
})(typeof window !== 'undefined' ? window : globalThis);
