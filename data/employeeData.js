/**
 * 员工管理模块（V2 重制）- 数据与配置
 * 提供：任务指派类型、培训课程、职级晋升阶梯、模块状态默认值
 * 依赖：data/gameData.js（EMPLOYEE_TYPES / EMPLOYMENT_TYPES / EMPLOYEE_LEVEL_CONFIG 等既有常量）
 */

// ==================== 任务指派（专注方向） ====================
// focusTask 为空表示「自动调度」：沿用 gameEngine 的智能积压调度
const EMP_TASK_TYPES = [
    { id: null, name: '自动调度', icon: '🤖', focusBonus: 0, desc: '按岗位专长与订单积压自动分配任务' },
    { id: 'pack',         name: '打包', icon: '📦', focusBonus: 0.25, desc: '专注订单打包，打包效率提升' },
    { id: 'ship',         name: '发货', icon: '🚚', focusBonus: 0.25, desc: '专注打印面单与发货，发货效率提升' },
    { id: 'consultation', name: '客服', icon: '💬', focusBonus: 0.25, desc: '专注客户咨询与售后处理' },
    { id: 'marketing',    name: '推广', icon: '📣', focusBonus: 0.25, desc: '专注营销推广，推广强度提升' },
    { id: 'listing',      name: '上架', icon: '🛍️', focusBonus: 0.25, desc: '专注商品上架，上架效率提升' },
    { id: 'pricing',      name: '改价', icon: '💲', focusBonus: 0.25, desc: '专注自动改价，改价效率提升' },
    { id: 'procurement',  name: '采购', icon: '🛒', focusBonus: 0.25, desc: '专注采购补货与供应链对接' }
];

// 专注任务效率加成（倍数增量，例如 0.25 = +25%）
const EMP_FOCUS_BONUS = 0.25;
// 专注任务经验加成倍率（1.5 = 该任务获得 1.5 倍经验）
const EMP_FOCUS_EXP_MULT = 1.5;

const EMP_TASK_BY_ID = {};
EMP_TASK_TYPES.forEach(t => { if (t.id) EMP_TASK_BY_ID[t.id] = t; });

// ==================== 培训课程体系 ====================
// skill: 加成技能键；allSkills=true 表示全技能加成
// buff: 完成后的永久效率加成（累加到 emp.trainingBuffs[skill]）
const TRAINING_COURSES = {
    pack_basic: { id: 'pack_basic', name: '打包基础实训', icon: '📦', skill: 'pack', durationDays: 2, cost: 1200, buff: 0.12, expGain: 40, desc: '打包效率 +12%' },
    pack_pro:   { id: 'pack_pro',   name: '打包进阶特训', icon: '🚀', skill: 'pack', durationDays: 4, cost: 3000, buff: 0.25, expGain: 120, desc: '打包效率 +25%' },
    ship_basic: { id: 'ship_basic', name: '发货基础实训', icon: '🚚', skill: 'ship', durationDays: 2, cost: 1200, buff: 0.12, expGain: 40, desc: '发货效率 +12%' },
    ship_pro:   { id: 'ship_pro',   name: '发货进阶特训', icon: '🚀', skill: 'ship', durationDays: 4, cost: 3000, buff: 0.25, expGain: 120, desc: '发货效率 +25%' },
    cs_basic:   { id: 'cs_basic',   name: '客服话术实训', icon: '💬', skill: 'consultation', durationDays: 2, cost: 1200, buff: 0.12, expGain: 40, desc: '客服效率 +12%' },
    cs_pro:     { id: 'cs_pro',     name: '金牌客服特训', icon: '🏆', skill: 'consultation', durationDays: 4, cost: 3000, buff: 0.25, expGain: 120, desc: '客服效率 +25%' },
    mkt_basic:  { id: 'mkt_basic',  name: '营销基础课程', icon: '📣', skill: 'marketing', durationDays: 2, cost: 1500, buff: 0.12, expGain: 40, desc: '推广强度 +12%' },
    mkt_pro:    { id: 'mkt_pro',    name: '爆款营销特训', icon: '🔥', skill: 'marketing', durationDays: 4, cost: 4000, buff: 0.25, expGain: 120, desc: '推广强度 +25%' },
    listing_course:  { id: 'listing_course',  name: '上架优化课程', icon: '🛍️', skill: 'listing', durationDays: 2, cost: 1500, buff: 0.20, expGain: 50, desc: '上架效率 +20%' },
    pricing_course:  { id: 'pricing_course',  name: '智能定价课程', icon: '💲', skill: 'pricing', durationDays: 2, cost: 1500, buff: 0.20, expGain: 50, desc: '改价效率 +20%' },
    procurement_course: { id: 'procurement_course', name: '供应链谈判课程', icon: '🛒', skill: 'procurement', durationDays: 3, cost: 2500, buff: 0.20, expGain: 80, desc: '采购效率 +20%' },
    mgmt_course: { id: 'mgmt_course', name: '管理进阶课程', icon: '💼', skill: null, allSkills: true, durationDays: 5, cost: 8000, buff: 0.10, expGain: 300, desc: '全技能效率 +10%' }
};

// 单技能培训加成上限（防止无限叠加）
const TRAINING_SKILL_BUFF_CAP = 0.6;
// 培训中状态
const TRAINING_STATUS = { ONGOING: 'ongoing', DONE: 'done', CANCELLED: 'cancelled' };

// ==================== 职级晋升阶梯 ====================
// 按 Lv / 在职天数 / 累计经验 自动晋升；salaryMult 叠加到工资（经 _recalculateEmployeeSalary）
// 数值平衡：倍率放缓（最高 +20%），避免满级团队月薪失控（曾致 10 人团队月薪 78k+ 击穿经营现金流）
const EMP_RANKS = [
    { id: 'intern', name: '实习生',   icon: '🌱', minLevel: 1,  minWorkDays: 0,  minExp: 0,    salaryMult: 1.00 },
    { id: 'staff',  name: '正式员工', icon: '👤', minLevel: 2,  minWorkDays: 3,  minExp: 30,   salaryMult: 1.03 },
    { id: 'senior', name: '资深员工', icon: '⭐', minLevel: 4,  minWorkDays: 10, minExp: 150,  salaryMult: 1.06 },
    { id: 'sup',    name: '主管',     icon: '🎖️', minLevel: 6,  minWorkDays: 20, minExp: 400,  salaryMult: 1.10 },
    { id: 'mgr',    name: '经理',     icon: '💼', minLevel: 8,  minWorkDays: 35, minExp: 900,  salaryMult: 1.15 },
    { id: 'dir',    name: '总监',     icon: '👑', minLevel: 10, minWorkDays: 55, minExp: 1800, salaryMult: 1.20 }
];

// ==================== 忠诚度·情绪·排班系统 ====================
// 排班类型：影响员工心情（白班稳定、晚班更累但覆盖 24h 履约）
const SHIFT_TYPES = [
    { id: 'auto',  name: '自动排班', icon: '🤖', moodDaily: 0,    desc: '按订单负载自动安排' },
    { id: 'day',   name: '白班',     icon: '☀️', moodDaily: 0.6,  desc: '固定日间工作，状态稳定' },
    { id: 'night', name: '晚班',     icon: '🌙', moodDaily: -0.8, desc: '覆盖夜间履约，但更累' }
];
const SHIFT_BY_ID = {};
SHIFT_TYPES.forEach(s => { SHIFT_BY_ID[s.id] = s; });

// 心情档位（影响工作效率倍率 effMult）
const MOOD_LEVELS = [
    { min: 80, label: '高涨', icon: '😄', effMult: 1.10 },
    { min: 60, label: '良好', icon: '🙂', effMult: 1.00 },
    { min: 40, label: '一般', icon: '😐', effMult: 0.90 },
    { min: 20, label: '低落', icon: '😞', effMult: 0.75 },
    { min: 0,  label: '崩溃', icon: '😡', effMult: 0.55 }
];

// 忠诚度档位（影响每日离职概率 resignDaily）
// 原 1%/5%/12% 每日过猛（「一般」约 26%/月）；现约 4.4%/16%/45% 每月
const LOYALTY_LEVELS = [
    { min: 80, label: '忠诚', icon: '💚', resignDaily: 0 },
    { min: 60, label: '稳定', icon: '💙', resignDaily: 0 },
    { min: 40, label: '一般', icon: '💛', resignDaily: 0.0015 },
    { min: 20, label: '动摇', icon: '🧡', resignDaily: 0.006 },
    { min: 0,  label: '离心', icon: '❤️‍🔥', resignDaily: 0.02 }
];
/** 主动离职缓冲天数（期间无工资、不接新任务，仍占编制） */
const RESIGN_NOTICE_DAYS = 7;

// 团队建设活动（一次性提升全员心情/忠诚度）
const TEAM_BUILDING_ACTIONS = [
    { id: 'tea',    name: '下午茶',   icon: '🧋', cost: 2000,  moodBoost: 8,  loyaltyBoost: 2,  desc: '低成本小确幸，全员心情 +8' },
    { id: 'bonus',  name: '发红包',   icon: '🧧', cost: 5000,  moodBoost: 14, loyaltyBoost: 5,  desc: '每人一份红包，心情 +14' },
    { id: 'dinner', name: '团建聚餐', icon: '🍲', cost: 8000,  moodBoost: 18, loyaltyBoost: 6,  desc: '提振士气，心情 +18' },
    { id: 'outing', name: '团建出游', icon: '🎉', cost: 20000, moodBoost: 32, loyaltyBoost: 12, desc: '大幅凝聚团队，心情 +32' }
];

// 个人幸福福利（可单独发给某位员工，提升幸福值=心情）
const EMP_HAPPINESS_PERKS = [
    { id: 'snack',   name: '零食补给', icon: '🍪', cost: 800,  moodBoost: 6,  loyaltyBoost: 1, desc: '小零食暖心，幸福 +6' },
    { id: 'meal',    name: '工作餐',   icon: '🍱', cost: 1500, moodBoost: 10, loyaltyBoost: 2, desc: '管一顿饭，幸福 +10' },
    { id: 'gift',    name: '节日礼包', icon: '🎁', cost: 2800, moodBoost: 15, loyaltyBoost: 4, desc: '礼品到人，幸福 +15' },
    { id: 'redpack', name: '个人红包', icon: '🧧', cost: 4000, moodBoost: 20, loyaltyBoost: 5, desc: '现金红包，幸福 +20' },
    { id: 'relax',   name: '带薪放松', icon: '🧖', cost: 6500, moodBoost: 28, loyaltyBoost: 8, desc: '放半天假，幸福 +28' }
];

// 员工模块附加状态默认值（挂在 gameState.state.employeeModule，随主存档持久化）
function getEmployeeModuleDefaults() {
    return {
        version: 2,
        settings: { autoPromote: true, moodSystemEnabled: true },
        trainingRecords: [],   // [{id, empId, empName, courseId, courseName, startDay, endDay, cost, status, finishDay}]
        promotionLog: [],      // [{id, empId, empName, fromRankId, toRankId, day, salaryMult}]
        focusChangeLog: [],    // [{id, empId, empName, taskId, day}]（最近50条）
        teamBuildingLog: [],   // [{id, actionId, actionName, cost, day}]（最近50条）
        resignationLog: [],    // [{id, empId, empName, reason, day}]（最近50条）
        welfareGrantLog: []    // [{id, empId, empName, perkId, perkName, cost, moodBoost, day}]
    };
}

// 新员工补充字段（写入 employee 对象自身，随 state.employees 持久化）
function getEmployeeExtraDefaults() {
    return {
        focusTask: null,       // EMP_TASK_TYPES 的 id；null=自动调度
        rank: 'intern',        // EMP_RANKS 的 id
        _rankSalaryMult: 1.0,  // 当前职级工资倍率（_recalculateEmployeeSalary 使用）
        training: null,        // { courseId, startDay, endDay }；培训中才有
        trainingBuffs: {},     // { [skill]: 累计加成 }
        loyalty: 60,           // 忠诚度 0~100（影响离职风险）
        mood: 70,              // 心情 0~100（影响工作效率）
        shift: 'auto',         // SHIFT_TYPES 的 id
        overtimeHoursToday: 0, // 当日加班（心情结算用，跨日清零）
        resignEffectiveDay: null
    };
}

// 导出兼容（浏览器全局 + Node 测试）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        EMP_TASK_TYPES, EMP_TASK_BY_ID, EMP_FOCUS_BONUS, EMP_FOCUS_EXP_MULT,
        TRAINING_COURSES, TRAINING_SKILL_BUFF_CAP, TRAINING_STATUS,
        EMP_RANKS,
        SHIFT_TYPES, SHIFT_BY_ID, MOOD_LEVELS, LOYALTY_LEVELS, TEAM_BUILDING_ACTIONS, EMP_HAPPINESS_PERKS,
        RESIGN_NOTICE_DAYS,
        getEmployeeModuleDefaults, getEmployeeExtraDefaults
    };
}
