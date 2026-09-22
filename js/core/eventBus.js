/**
 * 事件总线 - 模块间通信的核心
 * 发布-订阅模式，降低模块间耦合
 */
class EventBus {
    constructor() {
        this._events = {};
        this._onceEvents = {};
    }

    /**
     * 订阅事件
     * @param {string} event - 事件名
     * @param {Function} callback - 回调函数
     * @param {*} context - 回调上下文
     * @returns {EventBus}
     */
    on(event, callback, context = null) {
        if (!this._events[event]) {
            this._events[event] = [];
        }
        this._events[event].push({ callback, context });
        return this;
    }

    /**
     * 订阅一次事件
     * @param {string} event - 事件名
     * @param {Function} callback - 回调函数
     * @param {*} context - 回调上下文
     * @returns {EventBus}
     */
    once(event, callback, context = null) {
        if (!this._onceEvents[event]) {
            this._onceEvents[event] = [];
        }
        this._onceEvents[event].push({ callback, context });
        return this;
    }

    /**
     * 取消订阅
     * @param {string} event - 事件名
     * @param {Function} callback - 回调函数
     * @returns {EventBus}
     */
    off(event, callback = null) {
        if (!this._events[event]) return this;
        
        if (callback === null) {
            delete this._events[event];
        } else {
            this._events[event] = this._events[event].filter(
                item => item.callback !== callback
            );
        }
        return this;
    }

    /**
     * 发布事件
     * @param {string} event - 事件名
     * @param  {...any} args - 参数
     * @returns {EventBus}
     */
    emit(event, ...args) {
        // 执行持久订阅
        if (this._events[event]) {
            this._events[event].forEach(({ callback, context }) => {
                try {
                    callback.apply(context, args);
                } catch (e) {
                    console.error(`[EventBus] 事件 ${event} 执行出错:`, e);
                }
            });
        }

        // 执行一次性订阅
        if (this._onceEvents[event]) {
            const onceCallbacks = this._onceEvents[event];
            delete this._onceEvents[event];
            onceCallbacks.forEach(({ callback, context }) => {
                try {
                    callback.apply(context, args);
                } catch (e) {
                    console.error(`[EventBus] 一次性事件 ${event} 执行出错:`, e);
                }
            });
        }

        return this;
    }

    /**
     * 异步发布事件（下一个微任务执行）
     * @param {string} event - 事件名
     * @param  {...any} args - 参数
     * @returns {EventBus}
     */
    emitAsync(event, ...args) {
        Promise.resolve().then(() => this.emit(event, ...args));
        return this;
    }

    /**
     * 清除所有事件
     * @returns {EventBus}
     */
    clear() {
        this._events = {};
        this._onceEvents = {};
        return this;
    }

    /**
     * 检查是否有订阅者
     * @param {string} event - 事件名
     * @returns {boolean}
     */
    hasListeners(event) {
        return !!(this._events[event]?.length || this._onceEvents[event]?.length);
    }

    /**
     * 请求-响应模式：发送请求并等待第一个响应
     * @param {string} event - 请求事件名
     * @param {*} data - 请求数据
     * @param {number} timeout - 超时时间(ms)，默认100ms
     * @returns {Promise<*>} 响应数据
     */
    request(event, data = null, timeout = 100) {
        return new Promise((resolve, reject) => {
            const responseEvent = `${event}:response`;
            let responded = false;

            const timer = setTimeout(() => {
                if (!responded) {
                    reject(new Error(`Request ${event} timed out`));
                }
            }, timeout);

            this.once(responseEvent, (response) => {
                responded = true;
                clearTimeout(timer);
                resolve(response);
            });

            this.emit(event, data, (response) => {
                responded = true;
                clearTimeout(timer);
                resolve(response);
            });
        });
    }

    /**
     * 注册请求处理器
     * @param {string} event - 请求事件名
     * @param {Function} handler - 处理函数，返回响应数据
     */
    handle(event, handler) {
        this.on(event, async (data, respond) => {
            try {
                const response = await handler(data);
                if (typeof respond === 'function') {
                    respond(response);
                }
                this.emit(`${event}:response`, response);
            } catch (e) {
                console.error(`[EventBus] 请求处理器 ${event} 出错:`, e);
                if (typeof respond === 'function') {
                    respond({ error: e.message });
                }
                this.emit(`${event}:response`, { error: e.message });
            }
        });
    }
}

const eventBus = new EventBus();
