/**
 * 员工管理模块（V2 重制）- 引擎集成
 * 负责跨日结算：培训进度、职级自动晋升、事件通知。
 * 员工出勤/工资等既有逻辑仍由 gameEngine/gameState 处理，避免双写。
 */
class EmployeeEngine {
    constructor(employeeState, gameState, gameEngine) {
        this.empState = employeeState;
        this.gameState = gameState;
        this.gameEngine = gameEngine;
        this.initialized = false;
        this._lastTrainDay = 0;
        this._lastPromoDay = 0;
        this._lastMoodDay = 0;
    }

    init() {
        if (this.initialized) return;
        // gameEngine 实例未挂 eventBus 时回退全局 eventBus（与 gameEngine 内部 emit 一致）
        const bus = (this.gameEngine && this.gameEngine.eventBus)
            || (typeof eventBus !== 'undefined' ? eventBus : null);
        if (bus) {
            bus.on('game:dailyTick', this.onDailyTick.bind(this));
            bus.on('day:update', this.onDailyTick.bind(this)); // 兼容其他模块使用的事件名
        }
        this.initialized = true;
    }

    /** 跨日钩子（gameEngine 每次结算到新的一天时触发） */
    onDailyTick(payload) {
        try {
            const day = (payload && typeof payload === 'object' && payload.day)
                || (this.gameState.state.gameTime && this.gameState.state.gameTime.day)
                || 1;

            // 1. 培训推进（每日仅一次）
            if (this._lastTrainDay !== day) {
                this._lastTrainDay = day;
                const finished = this.empState.tickTraining(day);
                finished.forEach(f => {
                    const course = TRAINING_COURSES[f.courseId];
                    this._emitToast(`${course ? course.icon : '🎓'} ${f.empName} 完成培训「${f.courseName}」${course ? course.desc : ''}`, 'success');
                });
            }

            // 2. 职级晋升检查（每日仅一次）
            if (this._lastPromoDay !== day) {
                this._lastPromoDay = day;
                this.empState.checkAllPromotions();
            }

            // 3. 忠诚度·情绪·排班每日结算（每日仅一次）
            if (this._lastMoodDay !== day) {
                this._lastMoodDay = day;
                const r = this.empState.updateDailyMoodAndLoyalty(day);
                (r.resignations || []).forEach(x => {
                    if (x.phase === 'notice') {
                        this._emitToast(`📝 ${x.empName} 提交离职，${x.days || 7}天内无薪待岗，请尽快补人`, 'warning');
                    } else if (x.phase === 'left') {
                        this._emitToast(`😢 ${x.empName} 已离职离岗`, 'warning');
                    } else {
                        this._emitToast(`😢 ${x.empName} 因忠诚度过低（${x.loyalty}）主动离职，请及时关注团队状态`, 'warning');
                    }
                });
                (r.moodEvents || []).forEach(x => {
                    if (x.type === 'low') {
                        this._emitToast(`😞 ${x.empName} 心情跌至低谷（${x.mood}），工作效率大降，建议安排团队建设`, 'warning');
                    }
                });
            }
        } catch (e) {
            console.error('[EmployeeEngine] 跨日结算异常：', e);
        }
    }

    _emitToast(message, type) {
        try {
            if (this.gameEngine && this.gameEngine.eventBus && this.gameEngine.eventBus.emit) {
                this.gameEngine.eventBus.emit('toast:show', { message, type });
            } else if (typeof eventBus !== 'undefined' && eventBus.emit) {
                eventBus.emit('toast:show', { message, type });
            }
        } catch (_) {}
    }
}

let employeeEngineInstance = null;

function initEmployeeEngine(employeeState, gameState, gameEngine) {
    if (!employeeEngineInstance) {
        employeeEngineInstance = new EmployeeEngine(employeeState, gameState, gameEngine);
        employeeEngineInstance.init();
    }
    return employeeEngineInstance;
}

// 导出兼容（浏览器全局 + Node 测试）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { EmployeeEngine, initEmployeeEngine };
}
