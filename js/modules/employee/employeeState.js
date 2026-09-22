/**
 * 员工管理模块（V2 重制）- 状态与核心业务
 * 数据归属：员工列表沿用 gameState.state.employees（存档兼容）；
 *           模块附加状态挂在 gameState.state.employeeModule（随主存档持久化）。
 * 职责：招聘/解雇、任务指派（专注方向）、培训、职级晋升、汇总统计。
 * 工资/福利/宿舍等既有能力继续复用 gameState 的 API。
 */
class EmployeeState {
    constructor(gameState) {
        this.gameState = gameState;
        this.state = null;
        this.listeners = [];
    }

    /** 初始化：挂载模块状态 + 迁移旧员工字段 */
    init(gameState) {
        if (gameState) this.gameState = gameState;
        const gs = this.gameState.state;
        if (!gs.employeeModule || typeof gs.employeeModule !== 'object') {
            gs.employeeModule = getEmployeeModuleDefaults();
        }
        this.state = gs.employeeModule;
        this.ensureDefaults();
        // 员工字段迁移（老存档员工没有 focusTask/rank/training 等）
        const employees = Array.isArray(gs.employees) ? gs.employees : (gs.employees = []);
        employees.forEach(emp => { if (emp) this._ensureEmployeeFields(emp, true); });
        return this.state;
    }

    ensureDefaults() {
        const d = getEmployeeModuleDefaults();
        const s = this.state;
        if (s.version == null) s.version = d.version;
        if (!s.settings || typeof s.settings !== 'object') s.settings = JSON.parse(JSON.stringify(d.settings));
        else if (s.settings.autoPromote == null) s.settings.autoPromote = true;
        if (!Array.isArray(s.trainingRecords)) s.trainingRecords = [];
        if (!Array.isArray(s.promotionLog)) s.promotionLog = [];
        if (!Array.isArray(s.focusChangeLog)) s.focusChangeLog = [];
        if (!Array.isArray(s.teamBuildingLog)) s.teamBuildingLog = [];
        if (!Array.isArray(s.resignationLog)) s.resignationLog = [];
        if (!Array.isArray(s.welfareGrantLog)) s.welfareGrantLog = [];
    }

    /** 补齐员工新字段（init 时 silent 不触发保存） */
    _ensureEmployeeFields(emp, silent = false) {
        if (!emp || typeof emp !== 'object') return;
        const d = getEmployeeExtraDefaults();
        if (emp.focusTask === undefined) emp.focusTask = d.focusTask;
        if (!emp.rank) emp.rank = d.rank;
        if (typeof emp._rankSalaryMult !== 'number' || emp._rankSalaryMult <= 0) emp._rankSalaryMult = d._rankSalaryMult;
        if (emp.training === undefined) emp.training = d.training;
        if (!emp.trainingBuffs || typeof emp.trainingBuffs !== 'object' || Array.isArray(emp.trainingBuffs)) {
            emp.trainingBuffs = {};
        }
        // ===== 忠诚度·情绪·排班字段 =====
        if (typeof emp.loyalty !== 'number' || emp.loyalty < 0) emp.loyalty = d.loyalty;
        if (typeof emp.mood !== 'number' || emp.mood < 0) emp.mood = d.mood;
        if (!emp.shift) emp.shift = d.shift;
        if (typeof emp.overtimeHoursToday !== 'number') emp.overtimeHoursToday = 0;
        if (emp.resignEffectiveDay === undefined) emp.resignEffectiveDay = null;
        if (!silent) this._save();
    }

    _save() {
        try {
            if (this.gameState && typeof this.gameState.saveDebounced === 'function') {
                this.gameState.saveDebounced();
            }
        } catch (_) {}
    }

    _gs() { return this.gameState; }

    _emitToast(message, type = 'success') {
        try {
            if (typeof eventBus !== 'undefined' && eventBus.emit) {
                eventBus.emit('toast:show', { message, type });
            } else if (typeof ui !== 'undefined' && ui && typeof ui.showToast === 'function') {
                ui.showToast(message);
            }
        } catch (_) {}
    }

    // ==================== 招聘 / 解雇 ====================
    /** 招聘一名员工（复用 gameState.hireEmployee，补齐新字段） */
    hire(typeId, employmentType = 'fulltime', customInfo = {}) {
        const r = this.gameState.hireEmployee(typeId, employmentType, customInfo);
        if (r && r.success && r.employee) {
            this._ensureEmployeeFields(r.employee);
        }
        return r;
    }

    hireBatch(typeId, employmentType = 'fulltime', count = 5) {
        const r = this.gameState.hireEmployeeBatch(typeId, employmentType, count);
        if (r && r.success && Array.isArray(r.employees)) {
            r.employees.forEach(emp => this._ensureEmployeeFields(emp));
        }
        return r;
    }

    fire(employeeId) {
        const r = this.gameState.fireEmployee(employeeId);
        return r || { success: false, message: '解雇失败' };
    }

    /** 一键裁员：批量解雇全部在职员工（宿舍床位/采购员状态同步释放） */
    fireAll(opts) {
        const r = (typeof this.gameState.fireEmployeeBatchAll === 'function')
            ? this.gameState.fireEmployeeBatchAll(opts)
            : { success: false, message: '当前版本不支持一键裁员' };
        return r || { success: false, message: '一键裁员失败' };
    }

    setStatus(employeeId, status, reason = '') {
        return this.gameState.setEmployeeStatus(employeeId, status, reason);
    }

    // ==================== 任务指派（专注方向） ====================
    /**
     * 设置员工专注任务。taskId 为 EMP_TASK_TYPES 的 id 或 null（自动调度）。
     */
    setFocusTask(empId, taskId) {
        const emp = (this.gameState.state.employees || []).find(e => e && e.id === empId);
        if (!emp) return { success: false, message: '员工不存在' };
        if (taskId != null && !EMP_TASK_BY_ID[taskId]) {
            return { success: false, message: '无效的任务类型' };
        }
        emp.focusTask = taskId || null;
        try {
            const log = this.state.focusChangeLog;
            log.unshift({
                id: 'fc_' + Date.now() + '_' + Math.floor(Math.random() * 1e4),
                empId: emp.id, empName: emp.name, taskId: emp.focusTask,
                day: (this.gameState.state.gameTime && this.gameState.state.gameTime.day) || 1
            });
            if (log.length > 50) log.length = 50;
        } catch (_) {}
        this._save();
        return { success: true, employee: emp, focusTask: emp.focusTask };
    }

    getFocusTaskInfo(emp) {
        if (!emp) return null;
        const task = emp.focusTask ? EMP_TASK_BY_ID[emp.focusTask] : null;
        return task || EMP_TASK_TYPES[0];
    }

    /** 专注加成倍数（1 + bonus）；非专注返回 1 */
    getFocusBonus(emp, skillType) {
        if (!emp || !emp.focusTask || !skillType) return 1;
        if (emp.focusTask !== skillType) return 1;
        const task = EMP_TASK_BY_ID[emp.focusTask];
        return 1 + ((task && typeof task.focusBonus === 'number') ? task.focusBonus : EMP_FOCUS_BONUS);
    }

    /** 专注经验倍率 */
    getFocusExpMult(emp, action) {
        if (!emp || !emp.focusTask || !action) return 1;
        return emp.focusTask === action ? EMP_FOCUS_EXP_MULT : 1;
    }

    /** 任务看板：在职员工 + 专注方向 + 近期产出 */
    getTaskBoard() {
        const emps = (this.gameState.state.employees || []).filter(e => e && e.status === 'active');
        return emps.map(emp => {
            const st = emp.stats || {};
            const focus = this.getFocusTaskInfo(emp);
            return {
                id: emp.id,
                name: emp.name,
                type: emp.type,
                typeName: (EMPLOYEE_TYPES[emp.type] && EMPLOYEE_TYPES[emp.type].name) || emp.position || emp.type,
                level: emp.level || 1,
                rank: this.getRankOf(emp),
                focus,
                stats: {
                    ordersPacked: st.ordersPacked || 0,
                    ordersShipped: st.ordersShipped || 0,
                    consultationsHandled: st.consultationsHandled || 0,
                    marketingRuns: st.marketingRuns || 0,
                    marketingOrdersGenerated: st.marketingOrdersGenerated || 0
                }
            };
        });
    }

    // ==================== 培训 ====================
    /** 开始培训：扣款 + 挂载 training 进度 */
    startTraining(empId, courseId) {
        const emp = (this.gameState.state.employees || []).find(e => e && e.id === empId);
        if (!emp) return { success: false, message: '员工不存在' };
        if (emp.status !== 'active') return { success: false, message: '该员工不在职，无法参加培训' };
        const course = TRAINING_COURSES[courseId];
        if (!course) return { success: false, message: '课程不存在' };
        if (emp.training) {
            return { success: false, message: `该员工正在参加「${TRAINING_COURSES[emp.training.courseId]?.name || '其他课程'}」` };
        }
        // 加成上限校验
        if (course.skill && this.getTrainingBuff(emp, course.skill) >= TRAINING_SKILL_BUFF_CAP) {
            return { success: false, message: '该技能培训加成已达上限，换一门课程吧' };
        }
        const day = (this.gameState.state.gameTime && this.gameState.state.gameTime.day) || 1;
        if (!this.gameState.spendFunds(course.cost, `员工培训 - ${emp.name}：${course.name}`)) {
            return { success: false, message: `资金不足，培训需要 ${formatMoney(course.cost)}` };
        }
        emp.training = {
            courseId: course.id,
            startDay: day,
            endDay: day + course.durationDays - 1
        };
        const record = {
            id: 'tr_' + Date.now() + '_' + Math.floor(Math.random() * 1e4),
            empId: emp.id, empName: emp.name,
            courseId: course.id, courseName: course.name,
            startDay: day, endDay: emp.training.endDay,
            cost: course.cost, status: TRAINING_STATUS.ONGOING, finishDay: null
        };
        this.state.trainingRecords.unshift(record);
        if (this.state.trainingRecords.length > 200) this.state.trainingRecords.length = 200;
        this._save();
        return { success: true, message: `「${emp.name}」开始参加「${course.name}」（第${day}~${emp.training.endDay}天）`, training: emp.training };
    }

    /** 取消培训（返还 50% 费用） */
    cancelTraining(empId) {
        const emp = (this.gameState.state.employees || []).find(e => e && e.id === empId);
        if (!emp || !emp.training) return { success: false, message: '该员工没有进行中的培训' };
        const course = TRAINING_COURSES[emp.training.courseId];
        const record = this.state.trainingRecords.find(r => r && r.empId === empId && r.status === TRAINING_STATUS.ONGOING);
        emp.training = null;
        if (record) record.status = TRAINING_STATUS.CANCELLED;
        if (course) {
            const refund = Math.round(course.cost * 0.5);
            this.gameState.addFunds(refund, `培训取消退款 - ${emp.name}：${course.name}`);
        }
        this._save();
        return { success: true, message: '培训已取消，退还 50% 费用' };
    }

    /** 每日推进培训（由 EmployeeEngine 在跨日时调用） */
    tickTraining(day) {
        const finished = [];
        const emps = (this.gameState.state.employees || []).filter(e => e && e.status === 'active' && e.training);
        emps.forEach(emp => {
            if ((day || 0) < emp.training.endDay) return;
            const course = TRAINING_COURSES[emp.training.courseId];
            emp.training = null;
            if (!course) return;
            // 永久加成
            const buffKey = course.allSkills ? '__all__' : course.skill;
            if (!emp.trainingBuffs) emp.trainingBuffs = {};
            emp.trainingBuffs[buffKey] = ((emp.trainingBuffs[buffKey] || 0) + course.buff);
            // 经验
            const expSkill = course.skill || (EMP_TYPES_primarySkill(emp)) || 'pack';
            try { this.gameState.addEmployeeExp(emp.id, expSkill, course.expGain || 0); } catch (_) {}
            const record = this.state.trainingRecords.find(r => r && r.empId === emp.id && r.status === TRAINING_STATUS.ONGOING);
            if (record) { record.status = TRAINING_STATUS.DONE; record.finishDay = day; }
            finished.push({ empId: emp.id, empName: emp.name, courseId: course.id, courseName: course.name });
        });
        if (finished.length) this._save();
        return finished;
    }

    /** 查询某员工某技能的培训加成（已封顶） */
    getTrainingBuff(emp, skill) {
        if (!emp || !emp.trainingBuffs) return 0;
        let total = 0;
        Object.keys(emp.trainingBuffs).forEach(k => {
            if (k === '__all__' || k === skill) total += (emp.trainingBuffs[k] || 0);
        });
        return Math.min(total, TRAINING_SKILL_BUFF_CAP);
    }

    /** 员工当前培训进度描述 */
    getTrainingInfo(emp) {
        if (!emp || !emp.training) return null;
        const course = TRAINING_COURSES[emp.training.courseId];
        const day = (this.gameState.state.gameTime && this.gameState.state.gameTime.day) || 1;
        if (!course) return null;
        const total = Math.max(1, (emp.training.endDay - emp.training.startDay) + 1);
        const passed = Math.max(0, Math.min(total, day - emp.training.startDay + 1));
        return {
            course, totalDays: total, passedDays: passed,
            daysLeft: Math.max(0, emp.training.endDay - day),
            pct: Math.min(100, Math.round(passed / total * 100))
        };
    }

    // ==================== 职级晋升 ====================
    getRankIndex(rankId) {
        const i = EMP_RANKS.findIndex(r => r.id === rankId);
        return i >= 0 ? i : 0;
    }

    getRankOf(emp) {
        if (!emp) return EMP_RANKS[0];
        return EMP_RANKS[this.getRankIndex(emp.rank)] || EMP_RANKS[0];
    }

    /** 依据 Lv/在职天数/累计经验 计算应得职级 */
    computeRank(emp) {
        if (!emp) return EMP_RANKS[0];
        const level = emp.level || 1;
        const workDays = emp.workDays || 0;
        const exp = emp._totalExpAccum || 0;
        let rank = EMP_RANKS[0];
        for (let i = EMP_RANKS.length - 1; i >= 0; i--) {
            const r = EMP_RANKS[i];
            if (level >= r.minLevel && workDays >= r.minWorkDays && exp >= r.minExp) {
                rank = r;
                break;
            }
        }
        return rank;
    }

    getNextRankOf(emp) {
        const cur = this.getRankOf(emp);
        const idx = EMP_RANKS.indexOf(cur);
        if (idx < 0 || idx >= EMP_RANKS.length - 1) return null;
        return EMP_RANKS[idx + 1];
    }

    /** 单个员工晋升检查（自动晋升） */
    checkPromotion(emp) {
        if (!emp || emp.status !== 'active') return null;
        const target = this.computeRank(emp);
        const current = this.getRankOf(emp);
        if (target === current) return null;
        emp.rank = target.id;
        emp._rankSalaryMult = target.salaryMult;
        try { this.gameState._recalculateEmployeeSalary(emp); } catch (_) {}
        const day = (this.gameState.state.gameTime && this.gameState.state.gameTime.day) || 1;
        this.state.promotionLog.unshift({
            id: 'pl_' + Date.now() + '_' + Math.floor(Math.random() * 1e4),
            empId: emp.id, empName: emp.name,
            fromRankId: current.id, toRankId: target.id, day, salaryMult: target.salaryMult
        });
        if (this.state.promotionLog.length > 100) this.state.promotionLog.length = 100;
        this._save();
        return { empId: emp.id, empName: emp.name, from: current, to: target, day };
    }

    /** 全员晋升检查（跨日时调用） */
    checkAllPromotions() {
        if (this.state.settings.autoPromote === false) return [];
        const promoted = [];
        (this.gameState.state.employees || []).forEach(emp => {
            const r = this.checkPromotion(emp);
            if (r) promoted.push(r);
        });
        promoted.forEach(p => {
            this._emitToast(`${p.to.icon} ${p.empName} 晋升为「${p.to.name}」！工资倍率 ${p.to.salaryMult.toFixed(2)}`, 'success');
        });
        return promoted;
    }

    // ==================== 忠诚度·情绪·排班 ====================
    _clamp(v, min, max) {
        return Math.max(min, Math.min(max, v));
    }

    getMoodLevel(mood) {
        const m = (typeof mood === 'number' ? mood : 70);
        return MOOD_LEVELS.find(l => m >= l.min) || MOOD_LEVELS[MOOD_LEVELS.length - 1];
    }

    getLoyaltyLevel(loyalty) {
        const l = (typeof loyalty === 'number' ? loyalty : 60);
        return LOYALTY_LEVELS.find(x => l >= x.min) || LOYALTY_LEVELS[LOYALTY_LEVELS.length - 1];
    }

    /** 员工心情对工作效率的倍率（供 gameState.getEmployeeTaskEfficiency 叠加） */
    getMoodEfficiencyMult(emp) {
        if (!emp || this.state.settings.moodSystemEnabled === false) return 1;
        return this.getMoodLevel(emp.mood).effMult;
    }

    /** 员工详情里展示用的心情/忠诚度/排班汇总 */
    getMoodSummary(emp) {
        if (!emp) return null;
        return {
            mood: emp.mood,
            moodLevel: this.getMoodLevel(emp.mood),
            loyalty: emp.loyalty,
            loyaltyLevel: this.getLoyaltyLevel(emp.loyalty),
            shift: SHIFT_BY_ID[emp.shift] || SHIFT_TYPES[0]
        };
    }

    /** 排班：切换员工班次 */
    setShift(empId, shiftId) {
        const emp = (this.gameState.state.employees || []).find(e => e && e.id === empId);
        if (!emp) return { success: false, message: '员工不存在' };
        if (!SHIFT_BY_ID[shiftId]) return { success: false, message: '无效的班次' };
        emp.shift = shiftId;
        this._save();
        return { success: true, message: `「${emp.name}」已调整为「${SHIFT_BY_ID[shiftId].name}」`, shift: shiftId };
    }

    /** 团队建设：扣款 + 全员心情/忠诚度提升 */
    teamBuilding(actionId) {
        const action = TEAM_BUILDING_ACTIONS.find(a => a.id === actionId);
        if (!action) return { success: false, message: '活动不存在' };
        const active = (this.gameState.state.employees || []).filter(e => e && e.status === 'active');
        if (!active.length) return { success: false, message: '当前没有在职员工' };
        if (!this.gameState.spendFunds(action.cost, `团队建设 - ${action.name}`)) {
            return { success: false, message: `资金不足，${action.name}需要 ${formatMoney(action.cost)}` };
        }
        active.forEach(emp => {
            emp.mood = this._clamp(Math.round((emp.mood || 60) + action.moodBoost), 0, 100);
            emp.loyalty = this._clamp(Math.round((emp.loyalty || 60) + action.loyaltyBoost), 0, 100);
        });
        const day = (this.gameState.state.gameTime && this.gameState.state.gameTime.day) || 1;
        this.state.teamBuildingLog.unshift({
            id: 'tb_' + Date.now() + '_' + Math.floor(Math.random() * 1e4),
            actionId: action.id, actionName: action.name, cost: action.cost, day
        });
        if (this.state.teamBuildingLog.length > 50) this.state.teamBuildingLog.length = 50;
        this._save();
        return { success: true, message: `${action.icon} ${action.name}完成！全员心情 +${action.moodBoost}，忠诚度 +${action.loyaltyBoost}`, action };
    }

    /**
     * 给指定员工发放幸福福利。empId 为 'all' 时全员各发一份。
     */
    grantHappinessPerk(empId, perkId) {
        const perk = (typeof EMP_HAPPINESS_PERKS !== 'undefined' ? EMP_HAPPINESS_PERKS : []).find(p => p.id === perkId);
        if (!perk) return { success: false, message: '福利不存在' };
        const all = empId === 'all';
        const targets = (this.gameState.state.employees || []).filter(e => e && e.status === 'active' && (all || e.id === empId));
        if (!targets.length) return { success: false, message: all ? '当前没有在职员工' : '员工不存在或已离职' };
        const cost = perk.cost * targets.length;
        if (!this.gameState.spendFunds(cost, `幸福福利「${perk.name}」×${targets.length}`)) {
            return { success: false, message: `资金不足，需要 ${formatMoney(cost)}` };
        }
        const day = (this.gameState.state.gameTime && this.gameState.state.gameTime.day) || 1;
        targets.forEach(emp => {
            emp.mood = this._clamp(Math.round((emp.mood || 60) + perk.moodBoost), 0, 100);
            emp.loyalty = this._clamp(Math.round((emp.loyalty || 60) + perk.loyaltyBoost), 0, 100);
            this.state.welfareGrantLog.unshift({
                id: 'wg_' + Date.now() + '_' + Math.floor(Math.random() * 1e4),
                empId: emp.id, empName: emp.name, perkId: perk.id, perkName: perk.name,
                cost: perk.cost, moodBoost: perk.moodBoost, day
            });
        });
        if (this.state.welfareGrantLog.length > 80) this.state.welfareGrantLog.length = 80;
        this._save();
        const who = all ? `全员 ${targets.length} 人` : targets[0].name;
        return {
            success: true,
            message: `${perk.icon} 已为${who}发放「${perk.name}」，幸福 +${perk.moodBoost}`,
            perk, count: targets.length, cost
        };
    }

    /**
     * 每日结算：更新全员心情/忠诚度，处理低忠诚离职。
     * 由 EmployeeEngine 在跨日时调用。返回 { resignations: [...], moodEvents: [...] }
     */
    updateDailyMoodAndLoyalty(day) {
        const resignations = [];
        const moodEvents = [];
        const allEmps = this.gameState.state.employees || [];

        // 缓冲期满：正式离岗并从名单移除
        (allEmps.filter(e => e && e.status === 'resigning')).forEach(emp => {
            if ((emp.resignEffectiveDay || 0) > day) return;
            const name = emp.name;
            const loyalty = emp.loyalty;
            try {
                if (typeof this.gameState.fireEmployee === 'function') {
                    this.gameState.fireEmployee(emp.id);
                } else {
                    this.gameState.setEmployeeStatus(emp.id, 'resigned', '离职缓冲期满');
                }
            } catch (_) {}
            this.state.resignationLog.unshift({
                id: 'rs_' + Date.now() + '_' + Math.floor(Math.random() * 1e4),
                empId: emp.id, empName: name, reason: '离职缓冲期满离岗', day
            });
            if (this.state.resignationLog.length > 50) this.state.resignationLog.length = 50;
            resignations.push({ empName: name, loyalty, phase: 'left' });
        });

        const emps = (this.gameState.state.employees || []).filter(e => e && e.status === 'active');
        if (!emps.length) {
            if (resignations.length) this._save();
            return { resignations, moodEvents };
        }

        emps.forEach(emp => {
            // ---- 心情漂移因子 ----
            let delta = 0;
            const todayOt = Number(emp.overtimeHoursToday) || 0;
            delta -= Math.min(6, todayOt * 0.7);
            delta -= Math.min(2, (emp.overtimeHours || 0) * 0.04);
            emp.overtimeHoursToday = 0;
            // 请假休息恢复
            delta += Math.min(10, (emp.leaveDays || 0) * 3);
            // 全勤奖励
            if (emp.attendancePerfect) delta += 3;
            // 培训中轻微压力
            if (emp.training) delta -= 2;
            // 绩效反馈
            if ((emp.performanceScore || 100) >= 120) delta += 5;
            else if ((emp.performanceScore || 100) < 70) delta -= 5;
            // 排班影响
            const shift = SHIFT_BY_ID[emp.shift] || SHIFT_TYPES[0];
            delta += shift.moodDaily * 3;
            if (emp.housingAssigned) delta += 1.2;
            // 薪酬满意度（相对基准工资）
            const levelMult = 1 + 0.12 * ((emp.level || 1) - 1);
            const fairSalary = (emp.baseSalary || 0) * levelMult * (emp._rankSalaryMult || 1);
            const salarySatisfaction = this._clamp(((emp.salary || 0) / Math.max(1, fairSalary) - 1) * 100, -25, 25);
            delta += salarySatisfaction * 0.15;
            // 随机波动
            delta += (Math.random() * 6) - 3;
            // 缓慢回归中性（60）
            delta += (60 - (emp.mood || 60)) * 0.08;
            emp.mood = this._clamp(Math.round((emp.mood || 60) + delta), 0, 100);

            // ---- 忠诚度漂移因子 ----
            let ldelta = 0;
            if (emp.mood >= 70) ldelta += 2;
            else if (emp.mood < 40) ldelta -= 4;
            else if (emp.mood < 55) ldelta -= 1;
            if (salarySatisfaction < -10) ldelta -= 2;
            else if (salarySatisfaction > 10) ldelta += 2;
            if (emp.housingAssigned) ldelta += 2;
            ldelta += (60 - (emp.loyalty || 60)) * 0.03;
            emp.loyalty = this._clamp(Math.round((emp.loyalty || 60) + ldelta), 0, 100);

            // ---- 低忠诚离职：先进入 7 天无薪缓冲 ----
            const loyaltyLevel = this.getLoyaltyLevel(emp.loyalty);
            if (loyaltyLevel.resignDaily > 0 && Math.random() < loyaltyLevel.resignDaily) {
                let notice = { success: false };
                try {
                    if (typeof this.gameState.beginEmployeeResignation === 'function') {
                        notice = this.gameState.beginEmployeeResignation(emp.id, '忠诚度过低主动离职');
                    } else {
                        this.gameState.setEmployeeStatus(emp.id, 'resigning', '员工主动离职');
                        const nd = (typeof RESIGN_NOTICE_DAYS === 'number') ? RESIGN_NOTICE_DAYS : 7;
                        emp.resignEffectiveDay = day + nd;
                        notice = { success: true, days: nd, effectiveDay: emp.resignEffectiveDay };
                    }
                } catch (_) {}
                if (emp.type === 'buyer') {
                    try {
                        const wh = (typeof window !== 'undefined' && window.warehouseState)
                            || this.gameState.warehouse || null;
                        if (wh && typeof wh.syncBuyersFromEmployees === 'function') {
                            wh.gameState = wh.gameState || this.gameState;
                            wh.syncBuyersFromEmployees();
                        }
                    } catch (_) {}
                }
                const record = {
                    id: 'rs_' + Date.now() + '_' + Math.floor(Math.random() * 1e4),
                    empId: emp.id, empName: emp.name, reason: '忠诚度过低提交离职', day,
                    effectiveDay: notice.effectiveDay || emp.resignEffectiveDay
                };
                this.state.resignationLog.unshift(record);
                if (this.state.resignationLog.length > 50) this.state.resignationLog.length = 50;
                resignations.push({
                    empName: emp.name, loyalty: emp.loyalty, phase: 'notice',
                    days: notice.days || ((typeof RESIGN_NOTICE_DAYS === 'number') ? RESIGN_NOTICE_DAYS : 7)
                });
            }

            // ---- 心情极端事件记录 ----
            if (emp.mood <= 15 && emp.status === 'active') {
                moodEvents.push({ empName: emp.name, mood: emp.mood, type: 'low' });
            } else if (emp.mood >= 90 && emp.status === 'active') {
                moodEvents.push({ empName: emp.name, mood: emp.mood, type: 'high' });
            }
        });

        if (resignations.length || moodEvents.length) this._save();
        return { resignations, moodEvents };
    }

    // ==================== 汇总 / 查询 ====================
    /** 模块总览统计 */
    getSummary() {
        const emps = (this.gameState.state.employees || []).filter(Boolean);
        const active = emps.filter(e => e.status === 'active');
        const resigning = emps.filter(e => e.status === 'resigning');
        const onleave = emps.filter(e => e.status === 'onleave');
        const resigned = emps.filter(e => e.status === 'resigned');
        const trainingCount = active.filter(e => e.training).length;
        let payrollPreview = { totals: { net: 0, companyCost: 0 } };
        try { payrollPreview = this.gameState.calculateAllPayroll() || payrollPreview; } catch (_) {}
        const avgLevel = active.length
            ? Math.round(active.reduce((s, e) => s + (e.level || 1), 0) / active.length * 10) / 10
            : 0;
        const byType = {};
        active.forEach(e => {
            const key = e.type || 'other';
            byType[key] = (byType[key] || 0) + 1;
        });
        return {
            total: emps.length,
            active: active.length,
            resigning: resigning.length,
            onleave: onleave.length,
            resigned: resigned.length,
            trainingCount,
            avgLevel,
            byType,
            payrollPreview
        };
    }

    /** 部门分布（用于列表筛选） */
    getDepartments() {
        const set = {};
        (this.gameState.state.employees || []).forEach(e => {
            if (!e) return;
            const dept = e.department || 'other';
            const deptName = (EMPLOYEE_DEPARTMENT_MAP && EMPLOYEE_DEPARTMENT_MAP[e.type]) || dept;
            set[deptName] = (set[deptName] || 0) + 1;
        });
        return Object.keys(set).map(k => ({ name: k, count: set[k] })).sort((a, b) => b.count - a.count);
    }

    /** 列表查询（复用 gameState.searchEmployees，附加职级/培训/专注信息） */
    list(filter = {}) {
        let list;
        try {
            list = this.gameState.searchEmployees(filter.keyword || '', filter.department || '', filter.status || 'all');
        } catch (_) {
            list = (this.gameState.state.employees || []).filter(Boolean);
        }
        if (Array.isArray(filter.types) && filter.types.length) {
            list = list.filter(e => filter.types.includes(e.type));
        }
        if (filter.status === 'resigned') return [];
        list = list.filter(e => e && e.status !== 'resigned');
        return list.map(e => ({
            ...e,
            rankInfo: this.getRankOf(e),
            nextRankInfo: this.getNextRankOf(e),
            focusInfo: this.getFocusTaskInfo(e),
            trainingInfo: this.getTrainingInfo(e),
            trainingBuffTotal: Object.keys(e.trainingBuffs || {}).reduce((s, k) => s + (e.trainingBuffs[k] || 0), 0),
            moodInfo: this.getMoodSummary(e)
        }));
    }
}

// 主技能兜底（避免依赖 gameState 私有方法）
function EMP_TYPES_primarySkill(emp) {
    try {
        const ti = EMPLOYEE_TYPES[emp && emp.type];
        if (ti && ti.primarySkill) return ti.primarySkill;
    } catch (_) {}
    return (emp && emp.skills && emp.skills[0]) || 'pack';
}

// 导出兼容（浏览器全局 + Node 测试）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { EmployeeState };
}
