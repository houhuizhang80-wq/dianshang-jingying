/**
 * 员工管理模块（V2 重制）- 全新界面
 * 主入口 empUI.showMain([tab])；弹窗复用 ui.showModal（同 modalId 自动刷新不叠层）。
 * 页面结构：顶部汇总 + Tab（员工/招聘/培训/晋升/薪酬/福利/幸福）+ 列表。
 */
function initEmployeeUI(employeeState, gameState, ui) {
    const empUI = {
        employeeState,
        gameState,
        ui,
        _tab: 'list',
        _filter: { status: 'active', type: 'all', keyword: '' },

        // ==================== 主入口 ====================
        showMain(tab = null) {
            if (tab) this._tab = tab;
            if (this._tab === 'task') this._tab = 'happiness';
            try {
                this._render();
            } catch (e) {
                console.error('[empUI.showMain]', e);
                try { this.ui.showToast('员工管理界面渲染异常，请重试'); } catch (_) {}
            }
        },

        switchTab(tab) {
            this._tab = tab;
            this._render();
        },

        _rerender() {
            this._render();
        },

        _render() {
            const state = this.gameState.state;
            const summary = this.employeeState.getSummary();
            const gs = this.gameState;

            const tabs = [
                { id: 'list', name: '员工', icon: '👥' },
                { id: 'hire', name: '招聘', icon: '➕' },
                { id: 'training', name: '培训', icon: '🎓' },
                { id: 'rank', name: '晋升', icon: '🏅' },
                { id: 'payroll', name: '薪酬', icon: '💰' },
                { id: 'welfare', name: '福利', icon: '🎁' },
                { id: 'happiness', name: '幸福', icon: '😊' }
            ];

            const content = `
                <div class="emv2-container">
                    <div class="emv2-summary">
                        <div class="emv2-sum-card" style="background:linear-gradient(135deg,#667eea,#764ba2);">
                            <div class="emv2-sum-value">${summary.active + (summary.resigning || 0)}</div>
                            <div class="emv2-sum-label">在职员工</div>
                        </div>
                        <div class="emv2-sum-card" style="background:linear-gradient(135deg,#f093fb,#f5576c);">
                            <div class="emv2-sum-value">${summary.trainingCount}</div>
                            <div class="emv2-sum-label">培训中</div>
                        </div>
                        <div class="emv2-sum-card" style="background:linear-gradient(135deg,#4facfe,#00f2fe);">
                            <div class="emv2-sum-value">${formatMoney((summary.payrollPreview.totals && summary.payrollPreview.totals.companyCost) || 0)}</div>
                            <div class="emv2-sum-label">月企业成本</div>
                        </div>
                        <div class="emv2-sum-card" style="background:linear-gradient(135deg,#43e97b,#38f9d7);">
                            <div class="emv2-sum-value">${summary.avgLevel}</div>
                            <div class="emv2-sum-label">平均等级</div>
                        </div>
                    </div>
                    <div class="emv2-tabs">
                        ${tabs.map(t => `
                            <div class="emv2-tab ${this._tab === t.id ? 'active' : ''}" onclick="empUI.switchTab('${t.id}')">
                                <span class="emv2-tab-icon">${t.icon}</span><span>${t.name}</span>
                            </div>`).join('')}
                    </div>
                    <div class="emv2-body">
                        ${this._renderTabBody()}
                    </div>
                </div>`;

            const footer = `
                <button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>
                <button class="btn btn-primary" onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                    onclick="empUI.openHire()">+ 招聘新员工</button>
                <button class="btn" style="background:linear-gradient(135deg,#e53935,#b71c1c);color:#fff;border:none;"
                    onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                    onclick="empUI.confirmFireAll()">🔪 一键裁员</button>`;

            return this.ui.showModal('👥 员工管理', content, footer, {
                modalId: 'employeeMgrModalV2',
                modalClass: 'emv2-overlay'
            });
        },

        _renderTabBody() {
            switch (this._tab) {
                case 'list': return this._renderListTab();
                case 'hire': return this._renderHireTab();
                case 'training': return this._renderTrainingTab();
                case 'rank': return this._renderRankTab();
                case 'payroll': return this._renderPayrollTab();
                case 'welfare': return this._renderWelfareTab();
                case 'happiness': return this._renderHappinessTab();
                default: return this._renderListTab();
            }
        },

        // ==================== Tab：员工列表 ====================
        _renderListTab() {
            const f = this._filter;
            const list = this.employeeState.list({ status: f.status, keyword: f.keyword, types: f.type === 'all' ? null : [f.type] });
            const typeOptions = Object.keys(EMPLOYEE_TYPES || {});
            const statusCounts = this.employeeState.getSummary();

            return `
                <div class="emv2-filter">
                    <div class="emv2-filter-row">
                        <input type="text" class="emv2-search" id="emv2Keyword" placeholder="🔍 搜索姓名 / 岗位" value="${escapeHtml(f.keyword || '')}"
                               oninput="empUI.onKeyword(this.value)">
                        <button class="btn btn-primary btn-small" onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                            onclick="empUI.openHire()">+ 招聘</button>
                        <button class="btn btn-secondary btn-small" onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                            onclick="empUI.openTeamBuilding()">🎉 团队建设</button>
                    </div>
                    <div class="emv2-filter-row">
                        <button class="emv2-chip ${f.status === 'active' ? 'on' : ''}" onclick="empUI.setStatusFilter('active')">在职 ${statusCounts.active + (statusCounts.resigning || 0)}</button>
                        ${statusCounts.resigning ? `<button class="emv2-chip ${f.status === 'resigning' ? 'on' : ''}" onclick="empUI.setStatusFilter('resigning')">待离职 ${statusCounts.resigning}</button>` : ''}
                        <button class="emv2-chip ${f.status === 'onleave' ? 'on' : ''}" onclick="empUI.setStatusFilter('onleave')">休假 ${statusCounts.onleave}</button>
                        <button class="emv2-chip ${f.status === 'all' ? 'on' : ''}" onclick="empUI.setStatusFilter('all')">在职+休假</button>
                        <select class="emv2-select" onchange="empUI.setTypeFilter(this.value)">
                            <option value="all">全部岗位</option>
                            ${typeOptions.map(t => `<option value="${t}" ${f.type === t ? 'selected' : ''}>${EMPLOYEE_TYPES[t].icon || ''} ${EMPLOYEE_TYPES[t].name}</option>`).join('')}
                        </select>
                    </div>
                </div>
                ${list.length === 0
                    ? `<div class="emv2-empty"><div class="emv2-empty-icon">👥</div><div>暂无符合条件的员工</div>
                       <button class="btn btn-primary" style="margin-top:12px;" onclick="empUI.openHire()">去招聘</button></div>`
                    : `<div class="emv2-list">${list.map(e => this._renderEmpCard(e)).join('')}</div>`}`;
        },

        _renderEmpCard(e) {
            const typeInfo = EMPLOYEE_TYPES[e.type] || {};
            const rank = e.rankInfo;
            const day = (this.gameState.state.gameTime && this.gameState.state.gameTime.day) || 1;
            const statusLabel = this._statusTag(e, day);
            const training = e.trainingInfo
                ? `<span class="emv2-tag info">🎓 ${escapeHtml(e.trainingInfo.course.name)} ${e.trainingInfo.passedDays}/${e.trainingInfo.totalDays}天</span>` : '';
            return `
                <div class="emv2-emp-card ${e.status !== 'active' ? 'dim' : ''}" onclick="empUI.openDetail('${e.id}')">
                    <div class="emv2-emp-avatar" style="background:linear-gradient(135deg,#e8eaf6,#c5cae9);">${typeInfo.icon || '👤'}</div>
                    <div class="emv2-emp-main">
                        <div class="emv2-emp-name">
                            ${escapeHtml(e.name || typeInfo.name)}
                            ${statusLabel} ${training}
                        </div>
                        <div class="emv2-emp-sub">
                            ${rank.icon} ${rank.name} · Lv.${e.level || 1} · 月薪 ${formatMoney(e.salaryWithRank || e.salary || 0)}
                        </div>
                        <div class="emv2-emp-sub2">😊 幸福 ${(e.moodInfo && e.moodInfo.mood != null) ? e.moodInfo.mood : (e.mood || 70)}${e.trainingBuffTotal > 0 ? ` · 培训加成+${Math.round(e.trainingBuffTotal * 100)}%` : ''}</div>
                        ${this._renderMoodBar(e)}
                    </div>
                    <div class="emv2-emp-side">
                        ${e.status === 'active' || e.status === 'resigning' ? `<button class="btn btn-primary btn-small" onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                            onclick="event.stopPropagation();empUI.openDetail('${e.id}')">详情</button>` : ''}
                    </div>
                </div>`;
        },

        /** 心情/忠诚度迷你进度条（卡片内） */
        _renderMoodBar(e) {
            if (e.status !== 'active') return '';
            const m = e.moodInfo;
            if (!m) return '';
            const bar = (label, icon, val, color) => `
                <div class="emv2-moodbar" title="${label} ${val}">
                    <span class="emv2-moodbar-icon">${icon}</span>
                    <span class="emv2-moodbar-label">${label}</span>
                    <span class="emv2-moodbar-track"><span class="emv2-moodbar-fill" style="width:${val}%;background:${color};"></span></span>
                    <span class="emv2-moodbar-val">${val}</span>
                </div>`;
            return `
                <div class="emv2-moodbars">
                    ${bar('幸福', m.moodLevel.icon, m.mood, '#4caf50')}
                    ${bar('忠诚', m.loyaltyLevel.icon, m.loyalty, '#3f8efc')}
                </div>`;
        },

        _statusTag(emp, day) {
            if (!emp || emp.status === 'active') return '';
            if (emp.status === 'onleave') return '<span class="emv2-tag warn">休假中</span>';
            if (emp.status === 'resigning') {
                const left = Math.max(0, (emp.resignEffectiveDay || 0) - (day || 0));
                return `<span class="emv2-tag warn">待离职${left > 0 ? ' ' + left + '天' : ''} · 无薪</span>`;
            }
            return '<span class="emv2-tag muted">已离职</span>';
        },

        onKeyword(val) {
            this._filter.keyword = val;
        },
        setStatusFilter(status) {
            this._filter.status = (status === 'resigned') ? 'active' : status;
            this._render();
        },
        setTypeFilter(type) {
            this._filter.type = type;
            this._render();
        },

        // ==================== Tab：招聘 ====================
        openHire() {
            this._tab = 'hire';
            this._render();
        },

        _renderHireTab() {
            const cityId = this.gameState.state.shop.city || 'yiwu';
            const salaryDiscount = (typeof getCitySalaryDiscount === 'function') ? getCitySalaryDiscount(cityId) : 0;
            return `
                <div class="emv2-hire">
                    <div class="emv2-hint">💰 本城市薪资系数：${(1 - salaryDiscount).toFixed(2)} · 底薪均为月薪制，月底统一发放</div>
                    <div class="emv2-list">
                        ${Object.keys(EMPLOYEE_TYPES || {}).map(key => {
                            const t = EMPLOYEE_TYPES[key];
                            const fullSalary = Math.round(t.baseSalary * (EMPLOYMENT_TYPES.fulltime.salaryMultiplier || 1) * (1 - salaryDiscount));
                            const partSalary = Math.round(t.baseSalary * (EMPLOYMENT_TYPES.parttime.salaryMultiplier || 1) * (1 - salaryDiscount));
                            return `
                            <div class="emv2-hire-card">
                                <div class="emv2-hire-icon">${t.icon}</div>
                                <div class="emv2-hire-main">
                                    <div class="emv2-hire-name">${t.name} <span style="font-size:11px;color:#999;">效率 ×${t.efficiency}</span></div>
                                    <div class="emv2-hire-desc">${escapeHtml(t.description || '')}</div>
                                    <div class="emv2-hire-salary">全职 ${formatMoney(fullSalary)}/月 · 兼职 ${formatMoney(partSalary)}/月</div>
                                </div>
                                <div class="emv2-hire-actions">
                                    <button class="btn btn-primary btn-small" onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                                        onclick="empUI.hireOne('${key}')">招聘</button>
                                    <button class="btn btn-secondary btn-small" onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                                        onclick="empUI.hireBatchPrompt('${key}')">批量</button>
                                </div>
                            </div>`;
                        }).join('')}
                    </div>
                    <div class="emv2-hint2">💡 采购员招聘后会自动同步到「采购中心 → 采购员」并创建每日补货计划；律师可为法务模块效力。</div>
                </div>`;
        },

        hireOne(typeId) {
            const r = this.employeeState.hire(typeId, 'fulltime');
            if (r && r.success) {
                this.ui.showToast(`✅ 成功招聘「${r.employee.name}」`);
                this._render();
            } else {
                this.ui.showToast((r && r.message) || '招聘失败');
            }
        },

        hireBatchPrompt(typeId) {
            const t = EMPLOYEE_TYPES[typeId];
            const content = `
                <div style="padding:8px 2px;">
                    <div style="font-size:13px;color:#666;margin-bottom:12px;">批量招聘 ${t.icon} ${t.name}，一次最多 50 名</div>
                    <div class="emv2-quick-row">
                        ${[1, 2, 3, 5, 10].map(n => `
                            <button class="btn ${n === 5 ? 'btn-primary' : 'btn-secondary'} btn-small" onclick="empUI.hireBatch('${typeId}', ${n})">${n}名</button>`).join('')}
                    </div>
                </div>`;
            this.ui.showModal(`批量招聘${t.name}`, content,
                '<button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>', { modalId: 'emv2HireBatch' });
        },

        hireBatch(typeId, count) {
            const r = this.employeeState.hireBatch(typeId, 'fulltime', count);
            this.ui.closeModal();
            if (r && r.success) {
                this.ui.showToast(`✅ 成功批量招聘 ${r.hired} 名`);
                this._render();
            } else {
                this.ui.showToast((r && r.message) || '批量招聘失败');
            }
        },

        // ==================== Tab：幸福福利 ====================
        _renderHappinessTab() {
            const emps = this.employeeState.list({ status: 'active' });
            const perks = (typeof EMP_HAPPINESS_PERKS !== 'undefined') ? EMP_HAPPINESS_PERKS : [];
            const funds = (this.gameState.state.shop && this.gameState.state.shop.funds) || 0;
            const avgMood = emps.length
                ? Math.round(emps.reduce((s, e) => s + (e.mood || 70), 0) / emps.length)
                : 0;
            if (!emps.length) {
                return `<div class="emv2-empty"><div class="emv2-empty-icon">😊</div><div>暂无在职员工，招聘后即可发放幸福福利</div></div>`;
            }
            return `
                <div class="emv2-hint">😊 给员工加福利可提升幸福值（心情）。幸福越高效率越好；资金余额 ${formatMoney(funds)} · 全员平均幸福 ${avgMood}</div>
                <div class="emv2-section-title">🎁 一键全员发放</div>
                <div class="emv2-focus-row" style="margin-bottom:10px;">
                    ${perks.map(p => {
                        const total = p.cost * emps.length;
                        const ok = funds >= total;
                        return `<button class="emv2-chip2" ${ok ? '' : 'disabled style="opacity:.5;"'}
                            onclick="empUI.grantPerk('all','${p.id}')">${p.icon} ${p.name}<br><span style="font-size:10px;font-weight:400;">全员 ${formatMoney(total)} · 幸福+${p.moodBoost}</span></button>`;
                    }).join('')}
                </div>
                <div class="emv2-section-title">👤 单独发放</div>
                <div class="emv2-list">
                    ${emps.map(e => {
                        const m = e.moodInfo || this.employeeState.getMoodSummary(e);
                        return `
                        <div class="emv2-task-card">
                            <div class="emv2-task-head">
                                <div>
                                    <div class="emv2-emp-name">${escapeHtml(e.name)} <span style="font-size:11px;color:#999;">${(EMPLOYEE_TYPES[e.type] || {}).name || ''} · Lv.${e.level || 1}</span></div>
                                    <div class="emv2-emp-sub2">${m.moodLevel.icon} 幸福 ${m.mood}（${m.moodLevel.label}）· 效率 ×${m.moodLevel.effMult.toFixed(2)}</div>
                                </div>
                            </div>
                            <div class="emv2-progress" style="margin:4px 0 8px;"><div class="emv2-progress-in" style="width:${m.mood}%;background:#4caf50;"></div></div>
                            <div class="emv2-focus-row">
                                ${perks.map(p => `
                                    <button class="emv2-chip2" onclick="empUI.grantPerk('${e.id}','${p.id}')">${p.icon} ${p.name} ${formatMoney(p.cost)}</button>`).join('')}
                            </div>
                        </div>`;
                    }).join('')}
                </div>`;
        },

        grantPerk(empId, perkId) {
            const r = this.employeeState.grantHappinessPerk(empId, perkId);
            this.ui.showToast((r && r.message) || '发放失败');
            if (r && r.success) {
                if (this._detailEmpId) this._renderDetail();
                else this._render();
            }
        },

        // ==================== Tab：培训 ====================
        _renderTrainingTab() {
            const emps = this.employeeState.list({ status: 'active' });
            if (!emps.length) {
                return `<div class="emv2-empty"><div class="emv2-empty-icon">🎓</div><div>暂无在职员工</div></div>`;
            }
            const records = (this.employeeState.state.trainingRecords || []).slice(0, 10);
            return `
                <div class="emv2-hint">🎓 培训完成后永久提升对应技能效率（单技能上限 +${Math.round(TRAINING_SKILL_BUFF_CAP * 100)}%），并获得经验</div>
                <div class="emv2-list">
                    ${emps.map(e => {
                        const ti = e.trainingInfo;
                        return `
                        <div class="emv2-emp-card">
                            <div class="emv2-emp-avatar">${(EMPLOYEE_TYPES[e.type] || {}).icon || '👤'}</div>
                            <div class="emv2-emp-main">
                                <div class="emv2-emp-name">${escapeHtml(e.name)} ${ti ? `<span class="emv2-tag info">🎓 ${escapeHtml(ti.course.name)}</span>` : ''}</div>
                                <div class="emv2-emp-sub">
                                    ${ti
                                        ? `<div class="emv2-progress"><div class="emv2-progress-in" style="width:${ti.pct}%;"></div></div>
                                           <div class="emv2-emp-sub2">第${ti.passedDays}/${ti.totalDays}天 · 剩${ti.daysLeft}天</div>`
                                        : `<div class="emv2-emp-sub2">培训加成：${e.trainingBuffTotal > 0 ? '+' + Math.round(e.trainingBuffTotal * 100) + '%' : '无'}</div>`}
                                </div>
                            </div>
                            <div class="emv2-emp-side">
                                ${ti
                                    ? `<button class="btn btn-secondary btn-small" onclick="empUI.cancelTraining('${e.id}')">取消</button>`
                                    : `<button class="btn btn-primary btn-small" onclick="empUI.openCourseList('${e.id}')">选课程</button>`}
                            </div>
                        </div>`;
                    }).join('')}
                </div>
                ${records.length ? `
                <div class="emv2-section-title">📋 最近培训记录</div>
                <div class="emv2-log-list">
                    ${records.map(r => `
                        <div class="emv2-log-item">
                            <span>${escapeHtml(r.empName)}</span>
                            <span style="color:#666;">${escapeHtml(r.courseName)}</span>
                            <span class="emv2-tag ${r.status === 'done' ? 'ok' : r.status === 'cancelled' ? 'muted' : 'info'}">${r.status === 'done' ? '已完成' : r.status === 'cancelled' ? '已取消' : '进行中'}</span>
                        </div>`).join('')}
                </div>` : ''}`;
        },

        openCourseList(empId) {
            const emp = (this.gameState.state.employees || []).find(e => e && e.id === empId);
            if (!emp) return;
            const courses = Object.values(TRAINING_COURSES || {});
            const content = `
                <div style="font-size:13px;color:#666;margin-bottom:10px;">为 <b>${escapeHtml(emp.name)}</b> 选择培训课程（培训期间不能参加其他课程）</div>
                <div class="emv2-course-list">
                    ${courses.map(c => {
                        const capped = c.skill && this.employeeState.getTrainingBuff(emp, c.skill) >= TRAINING_SKILL_BUFF_CAP;
                        return `
                        <div class="emv2-course-card ${capped ? 'capped' : ''}">
                            <div class="emv2-course-head">
                                <span class="emv2-course-icon">${c.icon}</span>
                                <div>
                                    <div class="emv2-course-name">${escapeHtml(c.name)}</div>
                                    <div class="emv2-course-desc">${escapeHtml(c.desc)} · ${c.durationDays}天 · 经验+${c.expGain}</div>
                                </div>
                                <div class="emv2-course-cost">${formatMoney(c.cost)}</div>
                            </div>
                            <button class="btn ${capped ? 'btn-secondary' : 'btn-primary'} btn-small btn-block"
                                ${capped ? 'disabled' : ''}
                                onclick="empUI.startTraining('${emp.id}', '${c.id}')">${capped ? '已达上限' : '报名培训'}</button>
                        </div>`;
                    }).join('')}
                </div>`;
            this.ui.showModal(`🎓 ${emp.name} 的培训课程`, content,
                '<button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>',
                { modalId: 'emv2CourseList', modalClass: 'emv2-overlay' });
        },

        startTraining(empId, courseId) {
            const r = this.employeeState.startTraining(empId, courseId);
            if (r && r.success) {
                this.ui.closeModal();
                this.ui.showToast(`🎓 ${r.message}`);
                this._render();
            } else {
                this.ui.showToast((r && r.message) || '报名失败');
            }
        },

        cancelTraining(empId) {
            const r = this.employeeState.cancelTraining(empId);
            this.ui.showToast((r && r.message) || '操作失败');
            this._render();
        },

        // ==================== Tab：晋升 ====================
        _renderRankTab() {
            const emps = this.employeeState.list({ status: 'active' });
            const log = (this.employeeState.state.promotionLog || []).slice(0, 10);
            return `
                <div class="emv2-hint">🏅 满足等级 / 在职天数 / 累计经验即可自动晋升，职级越高工资倍率越高</div>
                <div class="emv2-rank-ladder">
                    ${EMP_RANKS.map((r, i) => `
                        <div class="emv2-rank-step">
                            <div class="emv2-rank-badge">${r.icon}</div>
                            <div class="emv2-rank-name">${r.name}</div>
                            <div class="emv2-rank-req">Lv.${r.minLevel}+ · ${r.minWorkDays}天 · ${r.minExp}经验</div>
                            <div class="emv2-rank-sal">工资 ×${r.salaryMult.toFixed(2)}</div>
                            ${i < EMP_RANKS.length - 1 ? '<div class="emv2-rank-arrow">→</div>' : ''}
                        </div>`).join('')}
                </div>
                ${emps.length ? `
                <div class="emv2-section-title">👥 员工职级进度</div>
                <div class="emv2-list">
                    ${emps.map(e => {
                        const next = e.nextRankInfo;
                        const pcts = next ? [
                            Math.min(100, Math.round((e.level || 1) / next.minLevel * 100)),
                            Math.min(100, Math.round((e.workDays || 0) / next.minWorkDays * 100)),
                            Math.min(100, Math.round((e._totalExpAccum || 0) / next.minExp * 100))
                        ] : [100, 100, 100];
                        const pct = Math.min.apply(null, pcts);
                        return `
                        <div class="emv2-emp-card">
                            <div class="emv2-emp-avatar">${e.rankInfo.icon}</div>
                            <div class="emv2-emp-main">
                                <div class="emv2-emp-name">${escapeHtml(e.name)} <span class="emv2-tag ok">${e.rankInfo.name}</span></div>
                                <div class="emv2-emp-sub2">
                                    ${next
                                        ? `距「${next.name}」需 Lv.${next.minLevel}(${e.level || 1}) / ${next.minWorkDays}天(${e.workDays || 0}) / ${next.minExp}经验(${Math.round(e._totalExpAccum || 0)})`
                                        : '已达最高职级 🎉'}
                                </div>
                                <div class="emv2-progress" style="margin-top:6px;"><div class="emv2-progress-in" style="width:${pct}%;"></div></div>
                            </div>
                        </div>`;
                    }).join('')}
                </div>` : ''}
                ${log.length ? `
                <div class="emv2-section-title">📜 晋升记录</div>
                <div class="emv2-log-list">
                    ${log.map(l => `<div class="emv2-log-item"><span>${escapeHtml(l.empName)}</span><span style="color:#666;">${escapeHtml(l.fromRankId)} → ${escapeHtml(l.toRankId)}</span><span class="emv2-tag ok">第${l.day}天</span></div>`).join('')}
                </div>` : ''}`;
        },

        // ==================== Tab：薪酬 ====================
        _renderPayrollTab() {
            const gs = this.gameState;
            let payroll = { totals: { net: 0, gross: 0, companyCost: 0, count: 0 }, slips: [] };
            try { payroll = gs.calculateAllPayroll() || payroll; } catch (_) {}
            const records = (gs.state.payroll && gs.state.payroll.records) || [];
            const lastPayDay = (gs.state.payroll && gs.state.payroll.lastPayrollDay) || 0;
            const nextPayDay = Math.ceil((gs.state.gameTime.day || 1) / 30) * 30 + 1;
            return `
                <div class="emv2-hint">💰 发薪日：每月1号（30天制）· 下次第 ${nextPayDay} 天${lastPayDay ? ` · 上次发放：第${lastPayDay}天` : ''}</div>
                <div class="emv2-summary" style="margin-bottom:10px;">
                    <div class="emv2-sum-card" style="background:linear-gradient(135deg,#667eea,#764ba2);">
                        <div class="emv2-sum-value">${payroll.totals.count}</div>
                        <div class="emv2-sum-label">应发人数</div>
                    </div>
                    <div class="emv2-sum-card" style="background:linear-gradient(135deg,#f093fb,#f5576c);">
                        <div class="emv2-sum-value">${formatMoney(payroll.totals.net)}</div>
                        <div class="emv2-sum-label">实发合计</div>
                    </div>
                    <div class="emv2-sum-card" style="background:linear-gradient(135deg,#4facfe,#00f2fe);">
                        <div class="emv2-sum-value">${formatMoney(payroll.totals.companyCost)}</div>
                        <div class="emv2-sum-label">企业成本</div>
                    </div>
                </div>
                <div style="display:flex;gap:8px;margin-bottom:12px;">
                    <button class="btn btn-primary" onmousedown="ui._markJustClicked()" ontouchstart="ui._markJustClicked()"
                        onclick="ui.showMonthlySalaryConfirmModal()">📅 发放本月工资</button>
                </div>
                <div class="emv2-section-title">📋 工资单明细</div>
                <div class="emv2-list">
                    ${(payroll.slips || []).length
                        ? payroll.slips.map(s => `
                            <div class="emv2-pay-row">
                                <div>
                                    <div class="emv2-emp-name">${escapeHtml(s.employeeName || s.name || s.empName || '员工')}</div>
                                    <div class="emv2-emp-sub2">${escapeHtml(s.position || '')} · ${escapeHtml(s.employmentType || '')} · Lv.${s.level || 1}</div>
                                </div>
                                <div class="emv2-pay-amt">${formatMoney(s.netSalary != null ? s.netSalary : (s.net || s.total || 0))}</div>
                            </div>`).join('')
                        : '<div class="emv2-empty" style="padding:20px;"><div>暂无在职员工工资单</div></div>'}
                </div>
                ${records.length ? `
                <div class="emv2-section-title">🗂️ 发放历史（最近${records.length}次）</div>
                <div class="emv2-log-list">
                    ${records.slice(0, 8).map(r => `
                        <div class="emv2-log-item">
                            <span>第${(r.date && r.date.day) || (r.payDay || r.day) || '?'}天</span>
                            <span style="color:#666;">${r.employeeCount || 0}人 · 实发 ${formatMoney(r.netTotal != null ? r.netTotal : (r.grossTotal || 0))}</span>
                            <button class="btn btn-secondary btn-small" onclick="ui.showPayrollRecordDetail('${r.id}')">查看</button>
                        </div>`).join('')}
                </div>` : ''}`;
        },

        // ==================== Tab：福利 ====================
        _renderWelfareTab() {
            const gs = this.gameState;
            const housing = gs._ensureHousing ? (() => { try { return gs._ensureHousing(); } catch (_) { return null; } })() : null;
            const occupied = (gs.getHousingOccupiedCount)
                ? gs.getHousingOccupiedCount()
                : (housing && housing.assigned ? Object.keys(housing.assigned).filter(id => housing.assigned[id]).length : 0);
            const welfareActive = (gs.state.employees || []).filter(e => e && e.status === 'active' && e.level >= 3).length;
            return `
                <div class="emv2-welfare">
                    <div class="emv2-welfare-card" onclick="ui.showWelfareSystemModal()">
                        <div class="emv2-welfare-icon">🎁</div>
                        <div class="emv2-welfare-main">
                            <div class="emv2-emp-name">员工福利体系</div>
                            <div class="emv2-emp-sub2">按员工等级解锁餐补/交通补/年终奖等福利，发薪时自动叠加</div>
                        </div>
                        <div class="emv2-emp-side"><button class="btn btn-primary btn-small">查看详情</button></div>
                    </div>
                    <div class="emv2-welfare-card" style="opacity:.85;">
                        <div class="emv2-welfare-icon">🏠</div>
                        <div class="emv2-welfare-main">
                            <div class="emv2-emp-name">员工宿舍</div>
                            <div class="emv2-emp-sub2">入口在「我的」，当前 ${occupied} 人入住</div>
                        </div>
                    </div>
                    <div class="emv2-welfare-card" onclick="empUI.switchTab('happiness')">
                        <div class="emv2-welfare-icon">😊</div>
                        <div class="emv2-welfare-main">
                            <div class="emv2-emp-name">幸福福利</div>
                            <div class="emv2-emp-sub2">零食、工作餐、红包等可单独或全员发放，直接提升幸福值</div>
                        </div>
                        <div class="emv2-emp-side"><button class="btn btn-primary btn-small">去发放</button></div>
                    </div>
                    <div class="emv2-welfare-card" style="cursor:default;">
                        <div class="emv2-welfare-icon">🧧</div>
                        <div class="emv2-welfare-main">
                            <div class="emv2-emp-name">奖金与加班</div>
                            <div class="emv2-emp-sub2">在员工详情里可为员工发放临时奖金、登记加班时长</div>
                        </div>
                        <div class="emv2-emp-side"><span class="emv2-tag ok">详情页操作</span></div>
                    </div>
                    <div class="emv2-hint2" style="margin-top:12px;">💡 员工等级越高解锁的福利档位越多（详见福利体系），福利补贴随每月工资发放。</div>
                </div>`;
        },

        // ==================== 员工详情 ====================
        openDetail(empId) {
            const emp = (this.gameState.state.employees || []).find(e => e && e.id === empId);
            if (!emp || emp.status === 'resigned') { this.ui.showToast('员工不存在'); return; }
            this._detailEmpId = empId;
            this._renderDetail();
        },

        _renderDetail() {
            const emp = (this.gameState.state.employees || []).find(e => e && e.id === this._detailEmpId);
            if (!emp) return;
            const typeInfo = EMPLOYEE_TYPES[emp.type] || {};
            const rank = this.employeeState.getRankOf(emp);
            const next = this.employeeState.getNextRankOf(emp);
            const ti = this.employeeState.getTrainingInfo(emp);
            const moodInfo = this.employeeState.getMoodSummary(emp);
            const st = emp.stats || {};
            const cityId = this.gameState.state.shop.city || 'yiwu';
            const salaryDiscount = (typeof getCitySalaryDiscount === 'function') ? getCitySalaryDiscount(cityId) : 0;
            const day = (this.gameState.state.gameTime && this.gameState.state.gameTime.day) || 1;
            const statusTag = this._statusTag(emp, day);

            const content = `
                <div class="emv2-detail">
                    <div class="emv2-detail-head">
                        <div class="emv2-emp-avatar" style="width:56px;height:56px;font-size:28px;">${typeInfo.icon || '👤'}</div>
                        <div>
                            <div class="emv2-emp-name" style="font-size:17px;">${escapeHtml(emp.name)} ${statusTag}</div>
                            <div class="emv2-emp-sub">${typeInfo.name} · ${rank.icon}${rank.name} · Lv.${emp.level || 1} · ${EMP_TYPES_empLabel(emp)}</div>
                        </div>
                    </div>

                    <div class="emv2-section-title">😊 幸福福利</div>
                    <div class="emv2-emp-sub2" style="margin-bottom:6px;">
                        ${moodInfo.moodLevel.icon} 幸福 <b>${moodInfo.mood}</b>（${moodInfo.moodLevel.label}）
                    </div>
                    <div class="emv2-focus-row">
                        ${((typeof EMP_HAPPINESS_PERKS !== 'undefined') ? EMP_HAPPINESS_PERKS : []).map(p => `
                            <button class="emv2-chip2" onclick="empUI.grantPerk('${emp.id}','${p.id}')">${p.icon} ${p.name} ${formatMoney(p.cost)}</button>`).join('')}
                    </div>

                    <div class="emv2-section-title">🎓 培训</div>
                    ${ti
                        ? `<div class="emv2-progress"><div class="emv2-progress-in" style="width:${ti.pct}%;"></div></div>
                           <div class="emv2-emp-sub2">「${escapeHtml(ti.course.name)}」第${ti.passedDays}/${ti.totalDays}天 · 剩余${ti.daysLeft}天
                           <button class="btn btn-secondary btn-small" style="margin-left:8px;" onclick="empUI.cancelTrainingFromDetail()">取消培训</button></div>`
                        : `<div class="emv2-emp-sub2">当前无培训 · 培训加成合计 ${emp.trainingBuffs ? '+' + Math.round(Object.values(emp.trainingBuffs).reduce((a, b) => a + b, 0) * 100) + '%' : '无'}
                           <button class="btn btn-primary btn-small" style="margin-left:8px;" onclick="empUI.openCourseList('${emp.id}')">选课程</button></div>`}

                    <div class="emv2-section-title">🏅 职级</div>
                    <div class="emv2-emp-sub2">
                        当前：${rank.name}（工资 ×${rank.salaryMult.toFixed(2)}）
                        ${next ? ` · 下一级「${next.name}」需 Lv.${next.minLevel} / ${next.minWorkDays}天 / ${next.minExp}经验（当前 ${emp.level || 1} / ${emp.workDays || 0} / ${Math.round(emp._totalExpAccum || 0)}）` : ' · 已达最高职级'}
                    </div>

                    <div class="emv2-section-title">📊 工作表现</div>
                    <div class="emv2-stat-grid">
                        <div class="emv2-stat"><b>${st.ordersPacked || 0}</b><span>累计打包</span></div>
                        <div class="emv2-stat"><b>${st.ordersShipped || 0}</b><span>累计发货</span></div>
                        <div class="emv2-stat"><b>${st.consultationsHandled || 0}</b><span>接待咨询</span></div>
                        <div class="emv2-stat"><b>${st.marketingRuns || 0}</b><span>推广次数</span></div>
                        <div class="emv2-stat"><b>${emp.workDays || 0}</b><span>在职天数</span></div>
                        <div class="emv2-stat"><b>${Math.round(emp._totalExpAccum || 0)}</b><span>累计经验</span></div>
                    </div>

                    <div class="emv2-section-title">💰 薪酬</div>
                    <div class="emv2-emp-sub2">月薪 ${formatMoney(emp.salaryWithRank || emp.salary || 0)}（底薪 ${formatMoney(emp.baseSalary || 0)} · 城市系数 ${(1 - salaryDiscount).toFixed(2)} · 职级 ×${rank.salaryMult.toFixed(2)}）</div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
                        <button class="btn btn-secondary btn-small" onclick="ui.showSalarySlipDetail('${emp.id}')">工资条</button>
                        <button class="btn btn-secondary btn-small" onclick="ui.showAddBonusModal('${emp.id}')">发奖金</button>
                        <button class="btn btn-secondary btn-small" onclick="ui.showAddOvertimeModal('${emp.id}')">记加班</button>
                    </div>

                    <div class="emv2-section-title">❤️ 幸福·忠诚度·排班</div>
                    <div class="emv2-emp-sub2">
                        ${moodInfo.moodLevel.icon} 幸福 <b>${moodInfo.mood}</b>（${moodInfo.moodLevel.label}，效率 ×${moodInfo.moodLevel.effMult.toFixed(2)}）
                        <div class="emv2-progress" style="margin-top:4px;"><div class="emv2-progress-in" style="width:${moodInfo.mood}%;background:#4caf50;"></div></div>
                    </div>
                    <div class="emv2-emp-sub2" style="margin-top:6px;">
                        ${moodInfo.loyaltyLevel.icon} 忠诚度 <b>${moodInfo.loyalty}</b>（${moodInfo.loyaltyLevel.label}）
                        <div class="emv2-progress" style="margin-top:4px;"><div class="emv2-progress-in" style="width:${moodInfo.loyalty}%;background:#3f8efc;"></div></div>
                    </div>
                    <div class="emv2-emp-sub2" style="margin-top:8px;">🕐 排班：
                        ${SHIFT_TYPES.map(s => `
                            <button class="emv2-chip2 ${emp.shift === s.id ? 'on' : ''}"
                                onclick="empUI.setShift('${emp.id}', '${s.id}')">${s.icon} ${s.name}</button>`).join('')}
                    </div>
                </div>`;

            const footer = `
                <button class="btn btn-secondary" onclick="empUI.backToMain()">返回列表</button>
                ${emp.status === 'active' ? `
                <button class="btn btn-secondary" style="background:linear-gradient(135deg,#43a047,#2e7d32);color:#fff;border:none;"
                    onclick="ui.upgradeEmployeeOneKey('${emp.id}')">⬆️ 一键升级</button>
                <button class="btn" style="background:linear-gradient(135deg,#e53935,#b71c1c);color:#fff;border:none;"
                    onclick="empUI.confirmFire('${emp.id}')">解雇</button>` : ''}
                <button class="btn btn-primary" onclick="empUI.backToMain()">完成</button>`;

            this.ui.showModal('👤 员工详情', content, footer, {
                modalId: 'emv2Detail',
                modalClass: 'emv2-overlay'
            });
        },

        setFocusFromDetail(taskId) {
            const r = this.employeeState.setFocusTask(this._detailEmpId, taskId);
            if (r && r.success) {
                const info = this.employeeState.getFocusTaskInfo(r.employee);
                this.ui.showToast(`🎯 已切换为「${info.name}」`);
            } else {
                this.ui.showToast((r && r.message) || '设置失败');
            }
            this._renderDetail();
        },

        cancelTrainingFromDetail() {
            const r = this.employeeState.cancelTraining(this._detailEmpId);
            this.ui.showToast((r && r.message) || '操作失败');
            this._renderDetail();
        },

        confirmFire(empId) {
            const emp = (this.gameState.state.employees || []).find(e => e && e.id === empId);
            const content = `
                <div style="padding:8px 2px;">
                    <div style="font-size:14px;margin-bottom:8px;">确定解雇 <b>${escapeHtml(emp ? emp.name : '该员工')}</b> 吗？</div>
                    <div style="font-size:12px;color:#999;">解雇后该员工将不再工作，此操作不可撤销（历史工资记录保留）。</div>
                </div>`;
            this.ui.showModal('⚠️ 确认解雇', content, `
                <button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>
                <button class="btn" style="background:linear-gradient(135deg,#e53935,#b71c1c);color:#fff;border:none;"
                    onclick="empUI.doFire('${empId}')">确认解雇</button>`, { modalId: 'emv2ConfirmFire' });
        },

        doFire(empId) {
            const r = this.employeeState.fire(empId);
            this.ui.closeModal();
            if (r && r.success) {
                this.ui.showToast('已解雇');
            } else {
                this.ui.showToast((r && r.message) || '解雇失败');
            }
            this._tab = 'list';
            this._render();
        },

        // ==================== 一键裁员 ====================
        confirmFireAll() {
            const active = (this.gameState.state.employees || []).filter(e => e && e.status === 'active');
            if (!active.length) {
                this.ui.showToast('暂无在职员工');
                return;
            }
            const content = `
                <div style="padding:8px 2px;">
                    <div style="font-size:14px;margin-bottom:8px;">确定一键裁员吗？</div>
                    <div style="font-size:12px;color:#999;line-height:1.7;">
                        将解雇全部 <b style="color:#c62828;">${active.length}</b> 名在职员工，宿舍床位同步释放。<br>
                        历史工资记录保留，此操作不可撤销。
                    </div>
                </div>`;
            this.ui.showModal('⚠️ 确认一键裁员', content, `
                <button class="btn btn-secondary" onclick="ui.closeModal()">取消</button>
                <button class="btn" style="background:linear-gradient(135deg,#e53935,#b71c1c);color:#fff;border:none;"
                    onclick="empUI.doFireAll()">确认一键裁员</button>`, { modalId: 'emv2ConfirmFireAll' });
        },

        doFireAll() {
            const r = this.employeeState.fireAll();
            this.ui.closeModal();
            if (r && r.success) {
                this.ui.showToast(`✅ 已一键解雇 ${r.fired || ''} 名员工`);
            } else {
                this.ui.showToast((r && r.message) || '一键裁员失败');
            }
            this._tab = 'list';
            this._filter.status = 'all';
            this._render();
        },

        // ==================== 排班 / 团队建设 ====================
        setShift(empId, shiftId) {
            const r = this.employeeState.setShift(empId, shiftId);
            this.ui.showToast((r && r.message) || '操作失败');
            this._renderDetail();
        },

        openTeamBuilding() {
            const active = (this.gameState.state.employees || []).filter(e => e && e.status === 'active');
            const funds = (this.gameState.state.shop && this.gameState.state.shop.funds) || 0;
            const content = `
                <div style="padding:4px 2px;">
                    <div style="font-size:13px;color:#666;margin-bottom:10px;">
                        当前 <b>${active.length}</b> 名在职员工 · 资金 ${formatMoney(funds)}<br>
                        团队建设可一次性提升全员心情与忠诚度，心情过低时建议及时安排。
                    </div>
                    ${TEAM_BUILDING_ACTIONS.map(a => {
                        const canAfford = funds >= a.cost;
                        return `
                        <div class="emv2-emp-card" style="margin-bottom:8px;${canAfford ? '' : 'opacity:0.55;'}">
                            <div class="emv2-emp-avatar">${a.icon}</div>
                            <div class="emv2-emp-main">
                                <div class="emv2-emp-name">${a.name}</div>
                                <div class="emv2-emp-sub2">${a.desc} · 忠诚 +${a.loyaltyBoost}</div>
                            </div>
                            <div class="emv2-emp-side">
                                <button class="btn btn-primary btn-small" ${canAfford ? '' : 'disabled'}
                                    onclick="empUI.doTeamBuilding('${a.id}')">${formatMoney(a.cost)}</button>
                            </div>
                        </div>`;
                    }).join('')}
                </div>`;
            this.ui.showModal('🎉 团队建设', content, `
                <button class="btn btn-secondary" onclick="ui.closeModal()">关闭</button>`, {
                modalId: 'emv2TeamBuilding', modalClass: 'emv2-overlay'
            });
        },

        doTeamBuilding(actionId) {
            const r = this.employeeState.teamBuilding(actionId);
            this.ui.closeModal();
            this.ui.showToast((r && r.message) || '操作失败');
            if (r && r.success) this._render();
        },

        backToMain() {
            this._detailEmpId = null;
            this._tab = 'list';
            this._render();
        }
    };

    return empUI;
}

function EMP_TYPES_empLabel(emp) {
    const et = EMPLOYMENT_TYPES && EMPLOYMENT_TYPES[emp.employmentType];
    return et ? et.name : '全职';
}

// 导出兼容（浏览器全局 + Node 测试）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { initEmployeeUI };
}
