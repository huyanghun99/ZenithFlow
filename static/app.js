// ---- State ----
        const state = {
            tasks: [
                { id: 't1', title: '审查项目提案', status: 'inbox', context: '@电脑', tags: ['工作'], createdAt: new Date(), progress: 0, estimatedDuration: 30, isAllDay: false, reminderEnabled: false, reminderOffset: 15 },
                { id: 't2', title: '给市场团队发邮件', status: 'next', context: '@邮件', tags: ['工作'], createdAt: new Date(), progress: 0, estimatedDuration: 30, isAllDay: false, reminderEnabled: false, reminderOffset: 15 },
                { id: 't3', title: '买菜', status: 'inbox', context: '@外出', tags: ['个人'], createdAt: new Date(), progress: 0, estimatedDuration: 30, isAllDay: false, reminderEnabled: false, reminderOffset: 15 },
                { id: 't4', title: '周报', status: 'scheduled', startDate: new Date(new Date().setHours(10,0,0,0)), endDate: new Date(new Date().setHours(11,0,0,0)), estimatedDuration: 60, isAllDay: false, createdAt: new Date(), tags: [], progress: 0, reminderEnabled: true, reminderOffset: 10 },
                { id: 't5', title: '网站重构', status: 'scheduled', projectId: 'p1', startDate: new Date(new Date().setDate(new Date().getDate() + 1)), endDate: new Date(new Date().setDate(new Date().getDate() + 5)), progress: 20, createdAt: new Date(), tags: ['项目'], estimatedDuration: 60, isAllDay: true, reminderEnabled: false, reminderOffset: 15 }
            ],
            projects: [
                { id: 'p1', name: '网站重构', color: '#22C55E', tasks: ['t5'], status: 'active' }
            ],
            view: 'calendar',
            calendarView: 'day',
            kanbanFilter: 'all',
            // date range filter for kanban/gantt
            filter: {
                start: null, // Date
                end: null // Date
            },
            viewDate: new Date(),
            selectedTaskId: null,
            // clipboard
            clipboardTask: null, // deep-copied task payload (without id)
            calendarPasteTarget: null, // { date: Date, hour: number, minute: number, source: 'day'|'week'|'month' }
            // reminders
            reminded: {}, // { [taskId]: { [remindAtMs]: true } }
            reminderInterval: null,
            timer: {
                timeLeft: 25 * 60,
                isRunning: false,
                interval: null,
                mode: 'pomodoro'
            },
            sidebarCollapsed: false,
            isResizing: false,
            resizeTask: null,
            resizeStartY: 0,
            resizeStartHeight: 0,
            _calendarUserScrolled: false
        };


// ---- Persistence (Flask + SQLite) ----
const PERSIST = {
    enabled: true,
    debounceMs: 250,
    timer: null
};

function _isIsoDateString(v) {
    return (typeof v === 'string') && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v);
}

function _reviveDates(obj) {
    if (obj === null || obj === undefined) return obj;
    if (Array.isArray(obj)) return obj.map(_reviveDates);
    if (typeof obj === 'object') {
        for (const k of Object.keys(obj)) {
            const v = obj[k];
            if (_isIsoDateString(v)) obj[k] = new Date(v);
            else obj[k] = _reviveDates(v);
        }
    }
    return obj;
}

function exportPersistableState() {
    // Only keep what the prototype uses + user preferences; exclude runtime handles (intervals, DOM refs)
    const safe = {
        tasks: (state.tasks || []).map(t => ({
            ...t,
            // Dates stringify to ISO automatically, keep as Date objects here
        })),
        projects: (state.projects || []).map(p => ({ ...p })),
        view: state.view,
        calendarView: state.calendarView,
        kanbanFilter: state.kanbanFilter,
        filter: {
            start: state.filter?.start || null,
            end: state.filter?.end || null
        },
        viewDate: state.viewDate || new Date(),
        selectedTaskId: state.selectedTaskId || null,
        sidebarCollapsed: !!state.sidebarCollapsed,
        sidebarSections: state.sidebarSections || null,
        ganttExpanded: state.ganttExpanded || null
    };
    return safe;
}

function applyLoadedState(loaded) {
    if (!loaded || typeof loaded !== 'object') return false;

    // revive Date strings
    _reviveDates(loaded);

    // tasks/projects
    if (Array.isArray(loaded.tasks)) state.tasks = loaded.tasks;
    if (Array.isArray(loaded.projects)) state.projects = loaded.projects;

    // preferences (best-effort)
    if (loaded.view) state.view = loaded.view;
    if (loaded.calendarView) state.calendarView = loaded.calendarView;
    if (loaded.kanbanFilter) state.kanbanFilter = loaded.kanbanFilter;
    if (loaded.filter) state.filter = { start: loaded.filter.start || null, end: loaded.filter.end || null };
    if (loaded.viewDate) state.viewDate = loaded.viewDate;
    if (typeof loaded.selectedTaskId !== 'undefined') state.selectedTaskId = loaded.selectedTaskId;
    if (typeof loaded.sidebarCollapsed === 'boolean') state.sidebarCollapsed = loaded.sidebarCollapsed;
    if (loaded.sidebarSections) state.sidebarSections = loaded.sidebarSections;
    if (loaded.ganttExpanded) state.ganttExpanded = loaded.ganttExpanded;

    return true;
}

async function loadStateFromServer() {
    if (!PERSIST.enabled) return;
    try {
        const r = await fetch('/api/state', { headers: { 'Accept': 'application/json' }});
        if (!r.ok) return;
        const payload = await r.json();
        if (payload && payload.state) {
            const ok = applyLoadedState(payload.state);
            if (ok) {
                // ensure required defaults exist
                if (!state.filter) state.filter = { start: null, end: null };
                if (!state.timer) state.timer = { timeLeft: 25*60, isRunning: false, interval: null, mode: 'pomodoro' };
            }
        }
    } catch (e) {
        console.warn('[persist] load failed', e);
    }
}

async function saveStateToServerNow() {
    if (!PERSIST.enabled) return;
    try {
        const body = JSON.stringify({ state: exportPersistableState() });
        await fetch('/api/state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body
        });
    } catch (e) {
        console.warn('[persist] save failed', e);
    }
}

function schedulePersist() {
    if (!PERSIST.enabled) return;
    if (PERSIST.timer) clearTimeout(PERSIST.timer);
    PERSIST.timer = setTimeout(() => {
        PERSIST.timer = null;
        saveStateToServerNow();
    }, PERSIST.debounceMs);
}

function hookPersistence() {
    // Wrap key mutators without changing the prototype logic
    const wrap = (name) => {
        const fn = window[name];
        if (typeof fn !== 'function') return;
        window[name] = function(...args) {
            const res = fn.apply(this, args);
            schedulePersist();
            return res;
        };
    };

    // window-exposed mutators
    [
        'handleKanbanDrop','toggleTaskDone','deleteTask','updateTaskDescription','updateTaskContext',
        'updateTaskProject','updateTaskStatus','updateTaskReminderEnabled','updateTaskReminderOffset',
        'updateTaskTitle','saveProjectFromModal','deleteProject','editProject','setMonthViewPasteTarget',
        'handleDayViewDrop','handleWeekViewDrop','handleDropDate','startResize','toggleGanttProject',
        'selectTask','toggleSidebarSection','deselectTask'
    ].forEach(wrap);

    // internal function wrappers (best-effort)
    if (typeof addTask === 'function') {
        const _addTask = addTask;
        addTask = function(...args){ const r=_addTask.apply(this,args); schedulePersist(); return r; };
    }
    if (typeof addProject === 'function') {
        const _addProject = addProject;
        addProject = function(...args){ const r=_addProject.apply(this,args); schedulePersist(); return r; };
    }
    if (typeof updateTaskScheduleExact === 'function') {
        const _u = updateTaskScheduleExact;
        updateTaskScheduleExact = function(...args){ const r=_u.apply(this,args); schedulePersist(); return r; };
    }
    if (typeof handleResizeUp === 'function') {
        const _h = handleResizeUp;
        handleResizeUp = function(...args){ const r=_h.apply(this,args); schedulePersist(); return r; };
    }
    if (typeof switchView === 'function') {
        const _s = switchView;
        switchView = function(...args){ const r=_s.apply(this,args); schedulePersist(); return r; };
    }
    if (typeof navigateDate === 'function') {
        const _n = navigateDate;
        navigateDate = function(...args){ const r=_n.apply(this,args); schedulePersist(); return r; };
    }

    window.addEventListener('beforeunload', () => {
        // try flush
        try { navigator.sendBeacon && navigator.sendBeacon('/api/state', new Blob([JSON.stringify({state: exportPersistableState()})], {type:'application/json'})); }
        catch(e) {}
    });
}


        // ---- DOM ----
        const els = {
            sidebar: document.getElementById('left-sidebar'),
            sidebarToggle: document.getElementById('sidebar-toggle'),
            navLists: document.getElementById('nav-lists'),
            quickCapture: document.getElementById('quick-capture'),
            viewTabs: document.getElementById('view-tabs'),
            viewCalendar: document.getElementById('view-calendar'),
            viewKanban: document.getElementById('view-kanban'),
            viewGantt: document.getElementById('view-gantt'),
            kanbanContainer: document.getElementById('kanban-board-container'),
            kanbanFilterSelect: document.getElementById('kanban-project-filter'),
            calendarGrid: document.getElementById('calendar-grid'),
            calendarViewControls: document.getElementById('calendar-view-controls'),
            rangeFilterControls: document.getElementById('range-filter-controls'),
            filterStart: document.getElementById('filter-start'),
            filterEnd: document.getElementById('filter-end'),
            ganttContainer: document.getElementById('gantt-chart-container'),
            timerDisplay: document.getElementById('timer-display'),
            timerProgress: document.getElementById('timer-progress'),
            timerToggle: document.getElementById('timer-toggle'),
            timerReset: document.getElementById('timer-reset'),
            taskDetails: document.getElementById('task-details-panel'),
            currentDate: document.getElementById('current-date-display'),
            confetti: document.getElementById('confetti-canvas'),
            prevDayBtn: document.getElementById('prev-day'),
            nextDayBtn: document.getElementById('next-day')
        };

        const Icons = {
            inbox: `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path></svg>`,
            calendar: `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>`,
            list: `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>`,
            clock: `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`
        };

        // ---- Init ----
        function init() {
            initDefaultRangeFilter();
            renderSidebar();
            renderCalendar();
            renderKanban();
            renderGantt();
            setupEventListeners();
            updateTimerDisplay();
            updateDateDisplay();
            updateKanbanFilterOptions();
            syncRangeFilterInputs();
            updateTopRightControlsVisibility();
            // reminders loop
            startReminderLoop();
            // default right panel
            renderTodayTasksPanel();
        }

        function updateDateDisplay() {
            if (state.view !== 'calendar') {
                const options = { year: 'numeric', month: 'long', day: 'numeric' };
                els.currentDate.innerText = state.viewDate.toLocaleDateString('zh-CN', options);
                return;
            }

            if (state.calendarView === 'day') {
                const options = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' };
                els.currentDate.innerText = state.viewDate.toLocaleDateString('zh-CN', options);
            } else if (state.calendarView === 'week') {
                const start = getStartOfWeek(state.viewDate);
                const end = new Date(start);
                end.setDate(end.getDate() + 6);
                const fmt = (d) => `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
                els.currentDate.innerText = `${fmt(start)} - ${fmt(end)}`;
            } else {
                const options = { year: 'numeric', month: 'long' };
                els.currentDate.innerText = state.viewDate.toLocaleDateString('zh-CN', options);
            }
        }

        function setupEventListeners() {
            // View tabs
            els.viewTabs.addEventListener('click', (e) => {
                const btn = e.target.closest('button');
                if (!btn) return;
                switchView(btn.dataset.view);
            });

            // Kanban Filter
            els.kanbanFilterSelect.addEventListener('change', (e) => {
                state.kanbanFilter = e.target.value;
                schedulePersist();
                renderKanban();
            });

            // Range filters (Kanban/Gantt)
            if (els.filterStart && els.filterEnd) {
                els.filterStart.addEventListener('change', () => {
                    state.filter.start = els.filterStart.value ? new Date(els.filterStart.value + 'T00:00:00') : null;
                    schedulePersist();
                    renderKanban();
                    renderGantt();
                });
                els.filterEnd.addEventListener('change', () => {
                    state.filter.end = els.filterEnd.value ? new Date(els.filterEnd.value + 'T23:59:59') : null;
                    schedulePersist();
                    renderKanban();
                    renderGantt();
                });
            }

            // Calendar view controls
            els.calendarViewControls.addEventListener('click', (e) => {
                const btn = e.target.closest('button');
                if (!btn) return;
                state.calendarView = btn.dataset.calView;
                schedulePersist();
                updateCalendarViewButtons();
                updateDateDisplay();
                renderCalendar();
            });

            // Quick capture
            els.quickCapture.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && e.target.value.trim()) {
                    addTask(e.target.value.trim());
                    e.target.value = '';
                }
            });

            // Timer
            els.timerToggle.addEventListener('click', toggleTimer);
            els.timerReset.addEventListener('click', resetTimer);

            // Sidebar toggle
            els.sidebarToggle.addEventListener('click', () => {
                state.sidebarCollapsed = !state.sidebarCollapsed;
                schedulePersist();
                if (state.sidebarCollapsed) {
                    els.sidebar.style.width = '0px';
                    els.sidebar.style.padding = '0px';
                    els.sidebar.style.opacity = '0';
                    els.sidebar.style.borderRightWidth = '0';
                } else {
                    els.sidebar.style.width = '250px';
                    els.sidebar.style.padding = '';
                    els.sidebar.style.opacity = '1';
                    els.sidebar.style.borderRightWidth = '';
                }
            });

            // Date navigation
            els.prevDayBtn.addEventListener('click', () => navigateDate(-1));
            els.nextDayBtn.addEventListener('click', () => navigateDate(1));

            // Calendar scroll detection (avoid auto-scroll fighting user)
            els.viewCalendar.addEventListener('scroll', () => {
                state._calendarUserScrolled = true;
            }, { passive: true });

            // Calendar click to set paste target
            els.viewCalendar.addEventListener('click', (e) => {
                if (state.view !== 'calendar') return;
                // ignore clicks on task blocks
                if (e.target.closest('[id^="task-el-"]')) return;
                setPasteTargetFromCalendarClick(e);
            });

            // Keyboard shortcuts: Ctrl/Cmd + C / V
            window.addEventListener('keydown', (e) => {
                const isMac = navigator.platform.toLowerCase().includes('mac');
                const mod = isMac ? e.metaKey : e.ctrlKey;
                if (!mod) return;

                // avoid interfering with text inputs
                const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
                const isTyping = tag === 'input' || tag === 'textarea' || e.target?.isContentEditable;
                if (isTyping) return;

                if (e.key.toLowerCase() === 'c') {
                    if (state.selectedTaskId) {
                        copySelectedTaskToClipboard();
                        flashToast('已复制任务（Ctrl+V 粘贴到日历选择的时间）');
                        e.preventDefault();
                    }
                }
                if (e.key.toLowerCase() === 'v') {
                    if (state.clipboardTask && state.calendarPasteTarget) {
                        pasteTaskFromClipboard();
                        e.preventDefault();
                    }
                }
            });

            // Global resize
            window.addEventListener('mousemove', handleResizeMove);
            window.addEventListener('mouseup', handleResizeUp);
        }

        function navigateDate(direction) {
            const newDate = new Date(state.viewDate);
            if (state.view === 'calendar') {
                if (state.calendarView === 'day') newDate.setDate(newDate.getDate() + direction);
                else if (state.calendarView === 'week') newDate.setDate(newDate.getDate() + (direction * 7));
                else newDate.setMonth(newDate.getMonth() + direction);
            } else {
                newDate.setDate(newDate.getDate() + direction);
            }
            state.viewDate = newDate;
            updateDateDisplay();
            if (state.view === 'calendar') renderCalendar();
            else renderGantt();
        }

        function updateCalendarViewButtons() {
            Array.from(els.calendarViewControls.children).forEach(btn => {
                if (btn.dataset.calView === state.calendarView) {
                    btn.className = 'px-3 py-1 rounded text-xs font-medium transition-colors text-white bg-neutral-600 shadow-sm';
                } else {
                    btn.className = 'px-3 py-1 rounded text-xs font-medium transition-colors text-gray-400 hover:text-white hover:bg-neutral-700/50';
                }
            });
        }

        function switchView(viewName) {
            state.view = viewName;

            Array.from(els.viewTabs.children).forEach(btn => {
                if (btn.dataset.view === viewName) {
                    btn.className = 'px-3 py-1 rounded-md text-xs font-medium transition-all text-white bg-neutral-600 shadow-sm';
                } else {
                    btn.className = 'px-3 py-1 rounded-md text-xs font-medium transition-all text-gray-400 hover:text-white hover:bg-neutral-700/50';
                }
            });

            // Hide all
            els.viewCalendar.classList.add('hidden');
            els.viewKanban.classList.add('hidden');
            els.viewGantt.classList.add('hidden');

            // toggle top-right controls
            updateTopRightControlsVisibility();

            if (viewName === 'calendar') {
                els.viewCalendar.classList.remove('hidden');
                updateDateDisplay();
                renderCalendar();
            } else if (viewName === 'kanban') {
                els.viewKanban.classList.remove('hidden');
                updateKanbanFilterOptions();
                renderKanban();
            } else if (viewName === 'gantt') {
                els.viewGantt.classList.remove('hidden');
                renderGantt();
            }
        }

        function initDefaultRangeFilter() {
            const now = new Date();
            const start = new Date(now.getFullYear(), now.getMonth(), 1);
            const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
            state.filter.start = start;
            state.filter.end = end;
        }

        function syncRangeFilterInputs() {
            if (!els.filterStart || !els.filterEnd) return;
            const toISODate = (d) => {
                if (!d) return '';
                const yyyy = d.getFullYear();
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                return `${yyyy}-${mm}-${dd}`;
            };
            els.filterStart.value = toISODate(state.filter.start);
            els.filterEnd.value = toISODate(state.filter.end);
        }

        // ---- Data ----
        function addTask(inputStr) {
            let title = inputStr;
            let context = '';
            // Parse @Context
            const contextMatch = inputStr.match(/@(\S+)/);
            if (contextMatch) {
                context = contextMatch[0];
                title = title.replace(contextMatch[0], '').trim();
            }

            const newTask = {
                id: 't' + Date.now(),
                title: title,
                status: 'inbox',
                context: context,
                createdAt: new Date(),
                tags: [],
                progress: 0,
                estimatedDuration: 30,
                isAllDay: false
            };
            state.tasks.push(newTask);
            renderSidebar();
            if (state.view === 'calendar') renderCalendar();
            else if (state.view === 'kanban') renderKanban();
            else renderGantt();
        }

        function addProject() {
            openProjectModal({ mode: 'create' });
        }

        window.editProject = function(id) {
            const project = state.projects.find(p => p.id === id);
            if (!project) return;
            openProjectModal({ mode: 'edit', projectId: id, initialName: project.name, initialStatus: project.status || 'active' });
        };

        window.deleteProject = function(id) {
            openConfirmModal({
                title: '删除项目',
                message: '确定要删除此项目吗？项目中的任务将保留，但会失去关联。',
                confirmText: '删除',
                danger: true,
                onConfirm: () => {
                    state.projects = state.projects.filter(p => p.id !== id);
                    state.tasks.forEach(t => {
                        if (t.projectId === id) t.projectId = null;
                    });
                    renderSidebar();
                    renderTaskDetails(state.selectedTaskId);
                    updateKanbanFilterOptions();
                    schedulePersist();
                }
            });
        }

        function updateKanbanFilterOptions() {
            if (!els.kanbanFilterSelect) return;
            const currentVal = els.kanbanFilterSelect.value;
            let html = '<option value="all">所有项目</option>';
            html += '<option value="none">无项目</option>';
            state.projects
                .filter(p => (p.status || 'active') !== 'archived')
                .forEach(p => {
                    html += `<option value="${p.id}">${escapeHtml(p.name)}</option>`;
                });
            els.kanbanFilterSelect.innerHTML = html;
            // keep selection if possible
            if ([...els.kanbanFilterSelect.options].some(o => o.value === currentVal)) {
                els.kanbanFilterSelect.value = currentVal;
            } else {
                els.kanbanFilterSelect.value = 'all';
            }
        }

        // ---- Modal helpers (Project create/edit + confirm) ----
        function ensureModalRoot() {
            let root = document.getElementById('zf-modal-root');
            if (!root) {
                root = document.createElement('div');
                root.id = 'zf-modal-root';
                root.className = 'fixed inset-0 z-[200] hidden';
                document.body.appendChild(root);
            }
            return root;
        }

        function closeModal() {
            const root = ensureModalRoot();
            root.classList.add('hidden');
            root.innerHTML = '';
        }

        function openConfirmModal({ title, message, confirmText = '确认', cancelText = '取消', danger = false, onConfirm }) {
            const root = ensureModalRoot();
            root.classList.remove('hidden');

            root.innerHTML = `
                <div class="absolute inset-0 bg-black/50 zf-modal-backdrop" onclick="closeModal()"></div>
                <div class="absolute inset-0 flex items-center justify-center p-4">
                    <div class="w-full max-w-md rounded-2xl border border-neutral-700/60 bg-[#0B1220]/90 backdrop-blur shadow-2xl">
                        <div class="p-5 border-b border-neutral-800/70">
                            <div class="flex items-start justify-between gap-3">
                                <div>
                                    <div class="text-white font-extrabold">${escapeHtml(title || '')}</div>
                                    <div class="text-sm text-gray-400 mt-1">${escapeHtml(message || '')}</div>
                                </div>
                                <button class="text-gray-500 hover:text-white" onclick="closeModal()" title="关闭">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                </button>
                            </div>
                        </div>
                        <div class="p-5 flex items-center justify-end gap-2">
                            <button class="px-3 py-2 rounded-lg border border-neutral-700/70 bg-neutral-900/40 text-gray-200 hover:bg-neutral-800/60 text-sm" onclick="closeModal()">${escapeHtml(cancelText)}</button>
                            <button class="px-3 py-2 rounded-lg text-sm font-extrabold ${danger ? 'bg-red-500 text-white hover:bg-red-400' : 'bg-brand-500 text-neutral-900 hover:bg-brand-400'}" onclick="(function(){ closeModal(); (${onConfirm ? 'window.__zf_onConfirm && window.__zf_onConfirm()' : ''}); })()">${escapeHtml(confirmText)}</button>
                        </div>
                    </div>
                </div>
            `;

            // attach callback
            window.__zf_onConfirm = onConfirm;
        }

        // ---- Reminder modal ----
        function openReminderModal(task, remindAt) {
            const root = ensureModalRoot();
            root.classList.remove('hidden');

            const startStr = task.startDate ? new Date(task.startDate).toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }) : '';
            const offset = Number(task.reminderOffset ?? 0);
            const subtitle = offset === 0 ? '现在开始' : `还有 ${offset} 分钟开始`;

            root.innerHTML = `
                <div class="absolute inset-0 bg-black/55 zf-modal-backdrop" onclick="closeModal()"></div>
                <div class="absolute inset-0 flex items-center justify-center p-4">
                    <div class="w-full max-w-lg rounded-2xl border border-neutral-700/60 bg-[#0B1220]/92 backdrop-blur shadow-2xl" onclick="event.stopPropagation()">
                        <div class="p-5 border-b border-neutral-800/70">
                            <div class="flex items-start justify-between gap-3">
                                <div>
                                    <div class="text-white font-extrabold">任务提醒</div>
                                    <div class="text-sm text-gray-400 mt-1">${escapeHtml(subtitle)} · ${escapeHtml(startStr)}</div>
                                </div>
                                <button class="text-gray-500 hover:text-white" onclick="closeModal()" title="关闭">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                </button>
                            </div>
                        </div>
                        <div class="p-5">
                            <div class="rounded-xl border border-brand-500/30 bg-brand-500/10 p-4">
                                <div class="text-lg font-extrabold text-white">${escapeHtml(task.title)}</div>
                                <div class="mt-2 text-[12px] text-gray-400">${task.context ? escapeHtml(task.context) : ''}</div>
                            </div>
                            ${task.description ? `<div class="mt-3 text-sm text-gray-300 whitespace-pre-wrap">${escapeHtml(task.description)}</div>` : ''}
                        </div>
                        <div class="p-5 pt-0 flex items-center justify-end gap-2">
                            <button class="px-3 py-2 rounded-lg border border-neutral-700/70 bg-neutral-900/40 text-gray-200 hover:bg-neutral-800/60 text-sm" onclick="closeModal()">稍后</button>
                            <button class="px-3 py-2 rounded-lg bg-brand-500 text-neutral-900 hover:bg-brand-400 text-sm font-extrabold border border-brand-400/60 shadow-lg shadow-green-500/15" onclick="(function(){ closeModal(); selectTask('${task.id}'); })()">查看任务</button>
                        </div>
                    </div>
                </div>
            `;

            // sound (best-effort)
            try {
                new Audio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg').play().catch(()=>{});
            } catch(e) {}
        }

        function startReminderLoop() {
            if (state.reminderInterval) return;
            state.reminderInterval = setInterval(checkReminders, 30 * 1000);
            // do an immediate check on load
            setTimeout(checkReminders, 500);
        }

        function checkReminders() {
            const now = Date.now();
            state.tasks.forEach(t => {
                if (!t) return;
                if (!t.reminderEnabled) return;
                if (t.status !== 'scheduled' && t.status !== 'done') return;
                if (!t.startDate) return;
                if (t.isAllDay) return;

                const startMs = new Date(t.startDate).getTime();
                const offsetMin = Number(t.reminderOffset ?? 15);
                const remindAt = startMs - offsetMin * 60000;

                // only fire within a small window to avoid missing due to interval jitter
                const windowMs = 35 * 1000;
                if (now < remindAt || now > remindAt + windowMs) return;

                if (!state.reminded[t.id]) state.reminded[t.id] = {};
                if (state.reminded[t.id][remindAt]) return;

                state.reminded[t.id][remindAt] = true;
                openReminderModal(t, remindAt);
            });
        }

        function openProjectModal({ mode, projectId = null, initialName = '', initialStatus = 'active' }) {
            const root = ensureModalRoot();
            root.classList.remove('hidden');

            const title = mode === 'edit' ? '编辑项目' : '新建项目';
            const confirmText = mode === 'edit' ? '保存' : '创建';

            root.innerHTML = `
                <div class="absolute inset-0 bg-black/50 zf-modal-backdrop" onclick="closeModal()"></div>
                <div class="absolute inset-0 flex items-center justify-center p-4">
                    <div class="w-full max-w-md rounded-2xl border border-neutral-700/60 bg-[#0B1220]/92 backdrop-blur shadow-2xl" onclick="event.stopPropagation()">
                        <div class="p-5 border-b border-neutral-800/70">
                            <div class="flex items-center justify-between">
                                <div class="text-white font-extrabold">${escapeHtml(title)}</div>
                                <button class="text-gray-500 hover:text-white" onclick="closeModal()" title="关闭">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                </button>
                            </div>
                        </div>

                        <div class="p-5 space-y-4">
                            <div class="space-y-2">
                                <label class="text-xs font-bold text-gray-500 uppercase tracking-wide">项目名称</label>
                                <input id="zf-project-name" type="text" value="${escapeHtml(initialName)}" placeholder="例如：网站重构" class="w-full bg-neutral-900/40 border border-neutral-700/60 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20">
                            </div>

                            <div class="space-y-2">
                                <label class="text-xs font-bold text-gray-500 uppercase tracking-wide">项目状态</label>
                                <select id="zf-project-status" class="w-full bg-neutral-900/40 border border-neutral-700/60 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20">
                                    <option value="active" ${initialStatus === 'active' ? 'selected' : ''}>进行中</option>
                                    <option value="not_started" ${initialStatus === 'not_started' ? 'selected' : ''}>未开始</option>
                                    <option value="archived" ${initialStatus === 'archived' ? 'selected' : ''}>归档</option>
                                </select>
                                <div class="text-[11px] text-gray-500">归档项目将不会在侧边栏/筛选中展示（任务保留）。</div>
                            </div>
                        </div>

                        <div class="p-5 pt-0 flex items-center justify-end gap-2">
                            <button class="px-3 py-2 rounded-lg border border-neutral-700/70 bg-neutral-900/40 text-gray-200 hover:bg-neutral-800/60 text-sm" onclick="closeModal()">取消</button>
                            <button class="px-3 py-2 rounded-lg bg-[#A3E635] text-[#0B1220] hover:bg-[#86EFAC] active:bg-[#A3E635] text-sm font-extrabold border border-[#86EFAC]/60 shadow-lg shadow-lime-400/20 focus:outline-none focus:ring-2 focus:ring-[#A3E635]/50" onclick="saveProjectFromModal('${mode}', '${projectId || ''}')">${escapeHtml(confirmText)}</button>
                        </div>
                    </div>
                </div>
            `;

            // focus
            setTimeout(() => {
                const input = document.getElementById('zf-project-name');
                if (input) {
                    input.focus();
                    input.select();
                }
            }, 0);
        }

        window.saveProjectFromModal = function(mode, projectId) {
            const input = document.getElementById('zf-project-name');
            const statusSel = document.getElementById('zf-project-status');
            const name = (input?.value || '').trim();
            const status = (statusSel?.value || 'active');

            if (!name) {
                flashToast('请输入项目名称');
                return;
            }

            if (mode === 'edit') {
                const project = state.projects.find(p => p.id === projectId);
                if (!project) return;
                project.name = name;
                project.status = status;
                closeModal();

                // if archived: clear selection filter if it points to archived project
                if (state.kanbanFilter === project.id && status === 'archived') {
                    state.kanbanFilter = 'all';
                }

                renderSidebar();
                renderTaskDetails(state.selectedTaskId);
                updateKanbanFilterOptions();
                if (state.view === 'gantt') renderGantt();
                if (state.view === 'kanban') renderKanban();
                schedulePersist();
                return;
            }

            const id = 'p' + Date.now();
            const colors = ['#22C55E', '#A3E635', '#3B82F6', '#F59E0B', '#EC4899', '#8B5CF6'];
            const color = colors[state.projects.length % colors.length];
            state.projects.push({ id, name, color, tasks: [], status });
            closeModal();
            renderSidebar();
            updateKanbanFilterOptions();
            schedulePersist();
        }

        // ---- Top controls visibility & filters ----
        function updateTopRightControlsVisibility() {
            const isCalendar = state.view === 'calendar';
            const isRangeView = state.view === 'kanban' || state.view === 'gantt';

            // 1. Calendar View Controls (Day/Week/Month)
            // Use style.display to override Tailwind classes like 'md:flex'
            if (els.calendarViewControls) {
                els.calendarViewControls.style.display = isCalendar ? '' : 'none';
            }

            // 2. Date Navigation Controls (Prev/Today/Next) -> Only for Calendar
            const dateNav = document.getElementById('date-nav-controls');
            if (dateNav) {
                dateNav.style.display = isCalendar ? '' : 'none';
            }

            // 3. Range Filter Controls (Start/End Date) -> Only for Kanban/Gantt
            if (els.rangeFilterControls) {
                if (isRangeView) {
                    els.rangeFilterControls.style.display = ''; 
                    // Ensure it is visible even if class has 'hidden'
                    els.rangeFilterControls.classList.remove('hidden');
                    els.rangeFilterControls.classList.add('flex');
                } else {
                    els.rangeFilterControls.style.display = 'none';
                }
            }
        }

        // ---- Layout Logic for Overlaps ----
        function calculateTaskLayout(tasks) {
            if (!tasks || tasks.length === 0) return new Map();

            const sorted = [...tasks].sort((a, b) => {
                const startA = new Date(a.startDate).getTime();
                const startB = new Date(b.startDate).getTime();
                if (startA !== startB) return startA - startB;
                const durA = (a.endDate ? new Date(a.endDate) : 0) - (a.startDate ? new Date(a.startDate) : 0);
                const durB = (b.endDate ? new Date(b.endDate) : 0) - (b.startDate ? new Date(b.startDate) : 0);
                return durB - durA;
            });

            // Group interacting tasks
            const groups = [];
            let currentGroup = [];
            let groupEnd = 0;

            sorted.forEach(task => {
                const start = new Date(task.startDate).getTime();
                const end = task.endDate ? new Date(task.endDate).getTime() : start + (task.estimatedDuration||30)*60000;

                if (currentGroup.length === 0) {
                    currentGroup.push(task);
                    groupEnd = end;
                } else {
                    if (start < groupEnd) {
                        currentGroup.push(task);
                        if (end > groupEnd) groupEnd = end;
                    } else {
                        groups.push(currentGroup);
                        currentGroup = [task];
                        groupEnd = end;
                    }
                }
            });
            if (currentGroup.length > 0) groups.push(currentGroup);

            const results = new Map();

            // Process each group to assign columns
            groups.forEach(group => {
                const columns = [];
                group.forEach(task => {
                    let placed = false;
                    for (let i = 0; i < columns.length; i++) {
                        const col = columns[i];
                        const lastTask = col[col.length - 1];
                        const lastEnd = lastTask.endDate ? new Date(lastTask.endDate).getTime() : 0;
                        const thisStart = new Date(task.startDate).getTime();

                        if (lastEnd <= thisStart) {
                            col.push(task);
                            task._colIndex = i;
                            placed = true;
                            break;
                        }
                    }
                    if (!placed) {
                        columns.push([task]);
                        task._colIndex = columns.length - 1;
                    }
                });

                const totalCols = columns.length;
                group.forEach(task => {
                    results.set(task.id, {
                        colIndex: task._colIndex,
                        totalCols: totalCols
                    });
                });
            });

            return results;
        }

        // ---- Sidebar ----
        function renderSidebar() {
            const inboxTasks = state.tasks.filter(t => t.status === 'inbox');
            const nextTasks = state.tasks.filter(t => t.status === 'next');
            const waitingTasks = state.tasks.filter(t => t.status === 'waiting');
            const somedayTasks = state.tasks.filter(t => t.status === 'someday');
            const scheduledTasks = state.tasks.filter(t => t.status === 'scheduled');

            // collapsible GTD sections
            if (!state.sidebarSections) state.sidebarSections = {
                inbox: true,
                next: true,
                waiting: true,
                someday: true,
                scheduled: true
            };

            const createListHTML = (title, tasks, iconKey, sectionKey) => {
                const open = state.sidebarSections?.[sectionKey] !== false;
                return `
                    <div class="mt-4">
                        <button type="button" onclick="toggleSidebarSection('${sectionKey}')" class="w-full px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-2 hover:text-gray-300 transition-colors">
                            <span class="text-gray-600">${Icons[iconKey] || ''}</span>
                            <span class="text-left">${title}</span>
                            <span class="ml-auto bg-neutral-800 text-gray-400 py-0.5 px-1.5 rounded text-[10px] border border-neutral-700/50">${tasks.length}</span>
                            <span class="ml-2 text-gray-600">${open ? '▾' : '▸'}</span>
                        </button>
                        <div class="space-y-0.5 ${open ? '' : 'hidden'}">
                            ${tasks.map(task => `
                                <div draggable="true" ondragstart="handleDragStart(event, '${task.id}')"
                                    onclick="selectTask('${task.id}')"
                                    class="group flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md hover:bg-neutral-800 cursor-pointer draggable-source transition-colors ${state.selectedTaskId === task.id ? 'bg-neutral-800 text-brand-300' : 'text-gray-300'}">
                                    <div class="w-1.5 h-1.5 rounded-full ${getStatusColor(task.status)}"></div>
                                    <span class="truncate ${task.status === 'done' ? 'line-through text-gray-500' : ''}">${escapeHtml(task.title)}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            };

            const projectList = state.projects
                .filter(p => (p.status || 'active') !== 'archived')
                .map(p => ({ id: p.id, title: p.name, status: 'project', color: p.color }));

            const createProjectListHTML = (projects) => `
                <div class="mt-4">
                    <h3 class="px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                        <span class="text-gray-600">${Icons['list']}</span>
                        <span>项目</span>
                        <button onclick="addProject()" class="ml-auto bg-neutral-800 hover:bg-neutral-700 text-gray-400 hover:text-white p-0.5 rounded transition-colors" title="添加项目">
                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                        </button>
                    </h3>
                    <div class="space-y-0.5">
                        ${projects.map(p => `
                            <div ondblclick="editProject('${p.id}')" class="group flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md hover:bg-neutral-800 cursor-pointer ${state.selectedTaskId === null ? '' : ''}" title="双击重命名">
                                <div class="w-1.5 h-1.5 rounded-full" style="background-color: ${p.color}"></div>
                                <span class="truncate flex-1 text-gray-300">${escapeHtml(p.title)}</span>
                                <button onclick="deleteProject('${p.id}')" class="hidden group-hover:block text-gray-500 hover:text-red-400" title="删除项目">
                                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                </button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;

            els.navLists.innerHTML =
                createListHTML('收集箱', inboxTasks, 'inbox', 'inbox') +
                createListHTML('下一步行动', nextTasks, 'list', 'next') +
                createListHTML('等待', waitingTasks, 'list', 'waiting') +
                createListHTML('将来/也许', somedayTasks, 'list', 'someday') +
                createListHTML('排程', scheduledTasks, 'calendar', 'scheduled') +
                createProjectListHTML(projectList);
        }

        function getStatusColor(status) {
            switch(status) {
                case 'done': return 'bg-brand-500';
                case 'scheduled': return 'bg-brand-400';
                case 'next': return 'bg-amber-400';
                case 'waiting': return 'bg-amber-500';
                case 'project': return 'bg-blue-400';
                default: return 'bg-gray-500';
            }
        }

        window.selectTask = function(id) {
            state.selectedTaskId = id;
            renderSidebar();
            renderTaskDetails(id);
        }

        window.toggleSidebarSection = function(key) {
            if (!state.sidebarSections) state.sidebarSections = {};
            state.sidebarSections[key] = !(state.sidebarSections[key] !== false);
            renderSidebar();
        }

        window.deselectTask = function() {
            state.selectedTaskId = null;
            renderSidebar();
            renderTodayTasksPanel();
        }

        function renderTaskDetails(id) {
            const task = state.tasks.find(t => t.id === id);
            if (!task) {
                renderTodayTasksPanel();
                return;
            }

            const startStr = task.startDate ? new Date(task.startDate).toLocaleString('zh-CN') : '—';
            const endStr = task.endDate ? new Date(task.endDate).toLocaleString('zh-CN') : '—';

            // Detect hyperlinks
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const links = (task.description || '').match(urlRegex);
            let linksHtml = '';
            if (links && links.length > 0) {
                const uniqueLinks = [...new Set(links)];
                linksHtml = `
                    <div class="mt-3 pt-3 border-t border-neutral-800/50">
                        <div class="text-[10px] text-gray-500 mb-2 uppercase tracking-wide font-bold">检测到的链接</div>
                        <div class="flex flex-wrap gap-2">
                            ${uniqueLinks.map(link => {
                                let hostname = link;
                                try { hostname = new URL(link).hostname; } catch(e){}
                                return `<a href="${link}" target="_blank" class="text-xs text-brand-400 hover:text-brand-300 hover:underline flex items-center gap-1.5 bg-neutral-800/80 px-2 py-1.5 rounded border border-neutral-700/80 transition-all hover:border-brand-500/50">
                                    <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                                    ${hostname}
                                </a>`;
                            }).join('')}
                        </div>
                    </div>
                `;
            }

            els.taskDetails.innerHTML = `
                <div class="space-y-6 animate-pop relative">
                    <button onclick="deselectTask()" class="absolute -top-2 -right-2 p-1.5 text-gray-500 hover:text-white rounded-full hover:bg-neutral-700 transition-colors z-10" title="关闭详情">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>

                    <div class="flex items-center gap-3 border-b border-neutral-800 pb-4 mr-6">
                        <div class="relative flex items-center">
                            <input type="checkbox" ${task.status === 'done' ? 'checked' : ''} onchange="toggleTaskDone('${task.id}')"
                                class="peer h-6 w-6 cursor-pointer appearance-none rounded-md border border-neutral-600 bg-neutral-800 checked:bg-brand-500 checked:border-brand-500 transition-all">
                            <svg class="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 text-neutral-900 opacity-0 peer-checked:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                        </div>
                        <input type="text" value="${escapeHtml(task.title)}" onchange="updateTaskTitle('${task.id}', this.value)" class="flex-1 bg-transparent text-xl font-bold text-white focus:outline-none focus:ring-2 focus:ring-brand-500/50 rounded px-1 transition-all">
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-2">
                            <label class="text-xs font-bold text-gray-500 uppercase tracking-wide">状态</label>
                            <select onchange="updateTaskStatus('${task.id}', this.value)" class="w-full bg-neutral-800/50 rounded px-3 py-2 text-sm text-gray-300 focus:outline-none focus:ring-1 focus:ring-brand-500 border border-neutral-700/50">
                                <option value="inbox" ${task.status === 'inbox' ? 'selected' : ''}>收集箱</option>
                                <option value="next" ${task.status === 'next' ? 'selected' : ''}>下一步行动</option>
                                <option value="scheduled" ${task.status === 'scheduled' ? 'selected' : ''}>排程</option>
                                <option value="waiting" ${task.status === 'waiting' ? 'selected' : ''}>等待</option>
                                <option value="someday" ${task.status === 'someday' ? 'selected' : ''}>将来/也许</option>
                                <option value="done" ${task.status === 'done' ? 'selected' : ''}>已完成</option>
                            </select>
                        </div>
                        <div class="space-y-2">
                            <label class="text-xs font-bold text-gray-500 uppercase tracking-wide">项目</label>
                            <select onchange="updateTaskProject('${task.id}', this.value)" class="w-full bg-neutral-800/50 rounded px-3 py-2 text-sm text-gray-300 focus:outline-none focus:ring-1 focus:ring-brand-500 border border-neutral-700/50">
                                <option value="">(无项目)</option>
                                ${state.projects
                                    .filter(p => (p.status || 'active') !== 'archived')
                                    .map(p => `<option value="${p.id}" ${task.projectId === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                            </select>
                        </div>
                    </div>

                    <div class="space-y-2">
                        <label class="text-xs font-bold text-gray-500 uppercase tracking-wide">情境</label>
                        <input type="text" value="${escapeHtml(task.context || '')}" onchange="updateTaskContext('${task.id}', this.value)" placeholder="@电脑 / @电话" class="w-full bg-neutral-800/50 rounded px-3 py-2 text-sm text-brand-300 focus:outline-none focus:ring-1 focus:ring-brand-500 border border-neutral-700/50">
                    </div>

                    <div class="space-y-2">
                <label class="text-xs font-bold text-gray-500 uppercase tracking-wide">备注</label>
                <!-- 恢复textarea用于编辑，保持原有功能 -->
                <textarea id="task-desc-${task.id}" onchange="updateTaskDescription('${task.id}', this.value)" class="w-full h-40 bg-neutral-800/50 hover:bg-neutral-800 rounded-lg p-3 text-sm text-gray-300 focus:outline-none focus:ring-1 focus:ring-brand-500 resize-none transition-colors border border-neutral-700/50" placeholder="添加详细说明...">${escapeHtml(task.description || '')}</textarea>
                <!-- 添加富文本链接预览区域 -->
                ${(task.description || '').match(/(https?:\/\/[^\s]+)/g) ? `
                    <div class="mt-2 pt-2 border-t border-neutral-800/50">
                        <div class="text-[10px] text-gray-500 mb-2 uppercase tracking-wide font-bold">可点击链接</div>
                        <div class="flex flex-wrap gap-2">
                            ${[...new Set((task.description || '').match(/(https?:\/\/[^\s]+)/g))].map(link => {
                                let hostname = link;
                                try { hostname = new URL(link).hostname; } catch(e){}
                                return `<a href="${link}" target="_blank" class="text-sm text-brand-400 hover:text-brand-300 hover:underline flex items-center gap-1.5 bg-neutral-800/80 px-2 py-1.5 rounded border border-neutral-700/80 transition-all hover:border-brand-500/50">
                                    <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                                    ${hostname}
                                </a>`;
                            }).join('')}
                        </div>
                    </div>` : ''}
            </div>

                    <div class="p-3 bg-neutral-800/30 rounded border border-neutral-800">
                        <div class="text-xs text-gray-500 mb-2">时间盒</div>
                        <div class="grid grid-cols-2 gap-3 text-sm">
                            <div class="flex items-center gap-2"><span class="text-gray-500">开始：</span><span class="text-white">${startStr}</span></div>
                            <div class="flex items-center gap-2"><span class="text-gray-500">结束：</span><span class="text-white">${endStr}</span></div>
                            <div class="flex items-center gap-2"><span class="text-gray-500">预估：</span><span class="text-white">${task.estimatedDuration || 30} 分钟</span></div>
                            <div class="space-y-2">
                                <div class="flex items-center gap-2"><span class="text-gray-500">进度：</span><span class="text-white" id="task-progress-${task.id}">${task.progress ?? 0}%</span></div>
                                <input type="range" min="0" max="100" value="${task.progress ?? 0}" 
                                    oninput="updateTaskProgress('${task.id}', this.value)" 
                                    onchange="renderTaskDetails('${task.id}')" 
                                    class="w-full h-2 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-brand-500">
                            </div>
                        </div>
                    </div>

                    <div class="p-3 bg-neutral-800/30 rounded border border-neutral-800">
                        <div class="text-xs text-gray-500 mb-2">提醒</div>
                        <div class="flex items-center justify-between gap-3">
                            <label class="flex items-center gap-2 text-sm text-gray-200">
                                <input type="checkbox" ${task.reminderEnabled ? 'checked' : ''} onchange="updateTaskReminderEnabled('${task.id}', this.checked)" class="h-4 w-4 rounded border border-neutral-600 bg-neutral-900/40 accent-[#22C55E]">
                                <span>开启提醒</span>
                            </label>
                            <div class="flex items-center gap-2">
                                <span class="text-[11px] text-gray-500">时间</span>
                                <select ${task.reminderEnabled ? '' : 'disabled'} onchange="updateTaskReminderOffset('${task.id}', this.value)" class="bg-neutral-800/50 rounded px-2 py-1 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-brand-500 border border-neutral-700/50 disabled:opacity-40">
                                    <option value="15" ${Number(task.reminderOffset ?? 15) === 15 ? 'selected' : ''}>提前 15 分钟</option>
                                    <option value="10" ${Number(task.reminderOffset ?? 15) === 10 ? 'selected' : ''}>提前 10 分钟</option>
                                    <option value="5" ${Number(task.reminderOffset ?? 15) === 5 ? 'selected' : ''}>提前 5 分钟</option>
                                    <option value="0" ${Number(task.reminderOffset ?? 15) === 0 ? 'selected' : ''}>开始时</option>
                                </select>
                            </div>
                        </div>
                        <div class="text-[11px] text-gray-500 mt-2">仅对“排程”且有开始时间的任务生效（非全天）。</div>
                    </div>

                    <div class="pt-4 border-t border-neutral-800 mt-auto">
                        <button onclick="deleteTask('${task.id}')" class="w-full py-2 flex items-center justify-center gap-2 text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded transition-colors text-sm font-medium">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                            删除任务
                        </button>
                    </div>
                </div>
            `;
        }

        function escapeHtml(str) {
            return String(str)
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;')
                .replaceAll('"', '&quot;')
                .replaceAll("'", '&#039;');
        }

        function isSameDay(a, b) {
            return new Date(a).toDateString() === new Date(b).toDateString();
        }

        function getTaskRange(task) {
            if (!task.startDate) return null;
            const s = new Date(task.startDate);
            const e = task.endDate ? new Date(task.endDate) : new Date(s.getTime() + (task.estimatedDuration || 30) * 60000);
            return { s, e };
        }

        function renderTodayTasksPanel() {
            const today = new Date();
            today.setHours(0,0,0,0);

            const items = state.tasks
                .filter(t => {
                    // show scheduled/done with time today
                    if ((t.status === 'scheduled' || t.status === 'done') && t.startDate) {
                        return isSameDay(t.startDate, today);
                    }
                    return false;
                })
                .sort((a,b) => new Date(a.startDate) - new Date(b.startDate));

            const now = new Date();
            const current = items.find(t => {
                const r = getTaskRange(t);
                if (!r) return false;
                return now >= r.s && now <= r.e;
            });

            const renderRow = (t) => {
                const r = getTaskRange(t);
                const start = r ? fmtTime(r.s) : '—';
                const end = r ? fmtTime(r.e) : '—';
                const proj = state.projects.find(p => p.id === t.projectId);
                const color = proj ? proj.color : '#4B5563';
                return `
                    <div onclick="selectTask('${t.id}')" class="group cursor-pointer rounded-lg border border-neutral-800/80 bg-[#111827]/40 hover:bg-[#111827]/55 transition-colors p-3">
                        <div class="flex items-start gap-3">
                            <div class="mt-1 w-2 h-2 rounded-full" style="background:${t.status==='done' ? '#22C55E' : color}"></div>
                            <div class="min-w-0 flex-1">
                                <div class="text-sm font-semibold text-gray-100 truncate ${t.status === 'done' ? 'line-through text-gray-400' : ''}">${escapeHtml(t.title)}</div>
                                <div class="mt-1 flex items-center gap-2 text-[11px] text-gray-500">
                                    <span class="font-mono">${start}-${end}</span>
                                    ${proj ? `<span class="px-1.5 py-0.5 rounded border border-neutral-700/60 bg-neutral-900/40 text-gray-400 truncate max-w-[140px]">${escapeHtml(proj.name)}</span>` : `<span class="px-1.5 py-0.5 rounded border border-neutral-700/60 bg-neutral-900/40 text-gray-500">无项目</span>`}
                                    ${t.context ? `<span class="text-brand-300">${escapeHtml(t.context)}</span>` : ''}
                                </div>
                            </div>
                            <div class="text-[10px] text-gray-600">${t.progress ?? 0}%</div>
                        </div>
                    </div>
                `;
            };

            const currentHtml = current ? `
                <div class="mb-4">
                    <div class="text-[10px] text-gray-500 mb-2 uppercase tracking-widest font-bold">当前时间块</div>
                    <div class="rounded-xl border border-brand-500/30 bg-brand-500/10 p-3">
                        <div class="flex items-center justify-between gap-2">
                            <div class="min-w-0">
                                <div class="text-sm font-bold text-white truncate">${escapeHtml(current.title)}</div>
                                <div class="mt-1 text-[11px] text-brand-300 font-mono">${fmtTime(new Date(current.startDate))} - ${fmtTime(current.endDate ? new Date(current.endDate) : new Date(new Date(current.startDate).getTime() + (current.estimatedDuration||30)*60000))}</div>
                            </div>
                            <button class="text-xs px-2 py-1 rounded bg-[#22C55E] text-neutral-900 font-extrabold hover:bg-[#A3E635]" onclick="event.stopPropagation(); selectTask('${current.id}')">查看</button>
                        </div>
                    </div>
                </div>
            ` : `
                <div class="mb-4">
                    <div class="text-[10px] text-gray-500 mb-2 uppercase tracking-widest font-bold">当前时间块</div>
                    <div class="rounded-xl border border-neutral-800 bg-[#111827]/35 p-4 text-sm text-gray-500">当前没有正在进行的时间块</div>
                </div>
            `;

            els.taskDetails.innerHTML = `
                <div class="space-y-4">
                    <div class="flex items-center justify-between">
                        <div>
                            <div class="text-sm font-bold text-white">今日任务</div>
                            <div class="text-[11px] text-gray-500">${new Date().toLocaleDateString('zh-CN', { month:'long', day:'numeric', weekday:'short' })}</div>
                        </div>
                        <button class="text-[11px] px-2 py-1 rounded border border-neutral-700/70 bg-neutral-900/30 text-gray-300 hover:bg-neutral-800/40" onclick="state.view='calendar'; switchView('calendar'); state.viewDate=new Date(); updateDateDisplay(); renderCalendar();">打开日历</button>
                    </div>

                    ${currentHtml}

                    <div>
                        <div class="text-[10px] text-gray-500 mb-2 uppercase tracking-widest font-bold">今日已排程</div>
                        <div class="space-y-2">
                            ${items.length ? items.map(renderRow).join('') : `<div class="rounded-xl border border-neutral-800 bg-[#111827]/35 p-4 text-sm text-gray-500">今天还没有排程任务</div>`}
                        </div>
                    </div>
                </div>
            `;
        }

        // ---- Clipboard (Ctrl/Cmd+C / Ctrl/Cmd+V) ----
        function copySelectedTaskToClipboard() {
            const t = state.tasks.find(x => x.id === state.selectedTaskId);
            if (!t) return;
            // deep copy, strip id & dates handled on paste
            state.clipboardTask = JSON.parse(JSON.stringify({
                title: t.title,
                description: t.description || '',
                status: t.status,
                context: t.context || '',
                projectId: t.projectId || null,
                dependencies: Array.isArray(t.dependencies) ? [...t.dependencies] : [],
                progress: t.progress ?? 0,
                estimatedDuration: t.estimatedDuration ?? 30,
                actualDuration: t.actualDuration ?? null,
                isAllDay: !!t.isAllDay,
                reminderEnabled: !!t.reminderEnabled,
                reminderOffset: Number(t.reminderOffset ?? 15),
                tags: Array.isArray(t.tags) ? [...t.tags] : []
            }));
        }

        function pasteTaskFromClipboard() {
            const payload = state.clipboardTask;
            const target = state.calendarPasteTarget;
            if (!payload || !target) return;

            const newId = 't' + Date.now();
            const start = new Date(target.date);
            start.setHours(target.hour, target.minute, 0, 0);

            const durationMin = payload.estimatedDuration ?? 30;
            const end = new Date(start.getTime() + durationMin * 60000);

            const newTask = {
                id: newId,
                title: payload.title,
                description: payload.description || '',
                status: 'scheduled',
                context: payload.context || '',
                projectId: payload.projectId || null,
                startDate: start,
                endDate: end,
                dependencies: Array.isArray(payload.dependencies) ? [...payload.dependencies] : [],
                progress: payload.progress ?? 0,
                estimatedDuration: durationMin,
                actualDuration: payload.actualDuration ?? null,
                isAllDay: false,
                reminderEnabled: !!payload.reminderEnabled,
                reminderOffset: Number(payload.reminderOffset ?? 15),
                createdAt: new Date(),
                tags: Array.isArray(payload.tags) ? [...payload.tags] : []
            };

            state.tasks.push(newTask);
            state.selectedTaskId = newId;

            renderSidebar();
            renderCalendar();
            if (state.view === 'kanban') renderKanban();
            if (state.view === 'gantt') renderGantt();
            renderTaskDetails(newId);

            flashToast(`已粘贴到 ${fmtTime(start)}（${start.toLocaleDateString('zh-CN')}）`);
            // clear marker after paste
            state.calendarPasteTarget = null;
            renderCalendar();
        }

        function setPasteTargetFromCalendarClick(e) {
            const ROW_HEIGHT = 60;

            if (state.calendarView === 'day') {
                const rect = els.calendarGrid.getBoundingClientRect();
                const offsetY = e.clientY - rect.top;
                const totalMinutes = (offsetY / ROW_HEIGHT) * 60;
                const hour = clamp(Math.floor(totalMinutes / 60), 0, 23);
                const minute = snapMinutes(clamp(Math.floor(totalMinutes % 60), 0, 59), 15);
                state.calendarPasteTarget = { date: new Date(state.viewDate), hour, minute, source: 'day' };
                renderCalendar();
                return;
            }

            if (state.calendarView === 'week') {
                const col = e.target.closest('[data-week-col]');
                if (!col) return;
                const idx = Number(col.getAttribute('data-week-col'));
                if (Number.isNaN(idx)) return;

                const startOfWeek = getStartOfWeek(state.viewDate);
                const day = new Date(startOfWeek);
                day.setDate(day.getDate() + idx);

                const rect = col.getBoundingClientRect();
                const offsetY = e.clientY - rect.top;
                const totalMinutes = (offsetY / ROW_HEIGHT) * 60;
                const hour = clamp(Math.floor(totalMinutes / 60), 0, 23);
                const minute = snapMinutes(clamp(Math.floor(totalMinutes % 60), 0, 59), 15);

                state.calendarPasteTarget = { date: day, hour, minute, source: 'week' };
                renderCalendar();
                return;
            }

            // Month view click handled by setMonthViewPasteTarget()
        }

        window.setMonthViewPasteTarget = function(iso) {
            const d = new Date(iso);
            state.calendarPasteTarget = { date: d, hour: 9, minute: 0, source: 'month' };
            flashToast(`已选择 ${d.toLocaleDateString('zh-CN')} 09:00（Ctrl+V 粘贴）`);
        }

        function renderPasteTargetMarkerForDay() {
            if (!state.calendarPasteTarget || state.calendarPasteTarget.source !== 'day') return '';
            const ROW_HEIGHT = 60;
            const { hour, minute } = state.calendarPasteTarget;
            const top = ((hour * 60) + minute) * (ROW_HEIGHT / 60);
            return `
                <div class="absolute left-10 right-4 border-t border-brand-300/70 z-30 pointer-events-none" style="top:${top}px">
                    <div class="absolute -top-2 left-1 px-1.5 py-0.5 rounded bg-brand-500/15 border border-brand-500/30 text-[10px] text-brand-300 font-mono">粘贴目标 ${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}</div>
                </div>
            `;
        }

        function renderPasteTargetMarkerForWeek(dayDate) {
            if (!state.calendarPasteTarget || state.calendarPasteTarget.source !== 'week') return '';
            const sameDay = new Date(state.calendarPasteTarget.date).toDateString() === new Date(dayDate).toDateString();
            if (!sameDay) return '';
            const ROW_HEIGHT = 60;
            const { hour, minute } = state.calendarPasteTarget;
            const top = ((hour * 60) + minute) * (ROW_HEIGHT / 60);
            return `
                <div class="absolute left-0 right-0 border-t border-brand-300/70 z-30 pointer-events-none" style="top:${top}px">
                    <div class="absolute -top-2 left-1 px-1.5 py-0.5 rounded bg-brand-500/15 border border-brand-500/30 text-[10px] text-brand-300 font-mono">粘贴 ${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}</div>
                </div>
            `;
        }

        // lightweight toast
        function flashToast(text) {
            let el = document.getElementById('zf-toast');
            if (!el) {
                el = document.createElement('div');
                el.id = 'zf-toast';
                el.className = 'fixed bottom-5 left-1/2 -translate-x-1/2 z-[120] px-3 py-2 rounded-lg border border-neutral-700 bg-[#111827]/90 backdrop-blur text-xs text-gray-200 shadow-lg opacity-0 pointer-events-none transition-opacity';
                document.body.appendChild(el);
            }
            el.textContent = text;
            el.style.opacity = '1';
            clearTimeout(el._t);
            el._t = setTimeout(() => { el.style.opacity = '0'; }, 1500);
        }

        // ---- Calendar ----
        function renderCalendar() {
            if (state.calendarView === 'day') renderCalendarDay();
            else if (state.calendarView === 'week') renderCalendarWeekTimeGrid();
            else renderCalendarMonth();

            // default scroll to 07:00 for day/week so work hours are centered
            requestAnimationFrame(() => autoScrollCalendarToHour(7));
        }

        function autoScrollCalendarToHour(hour) {
            if (state.calendarView === 'month') return;
            // do not fight the user after they scroll
            if (state._calendarUserScrolled) return;

            const ROW_HEIGHT = 60;
            const target = Math.max(0, (hour * ROW_HEIGHT) - 120);
            
            // 对于周视图，滚动条在calendarGrid上；对于日视图，滚动条在viewCalendar上
            let container;
            if (state.calendarView === 'week') {
                container = els.calendarGrid;
            } else {
                container = els.viewCalendar;
            }
            
            if (container) {
                container.scrollTop = target;
            }
        }

        function getCurrentTimeTop(rowHeight) {
            const now = new Date();
            const hours = now.getHours();
            const minutes = now.getMinutes();
            return (hours * 60 + minutes) * (rowHeight / 60);
        }

        function renderTimeLine(rowHeight, isWeek = false) {
            // Only show if today
            const now = new Date();
            // Note: simplistic check. For Day view, need to check if viewDate is today. 
            // For Week view, we render it in the specific column that is today.

            // This function just returns the raw HTML line element positioned vertically
            const top = getCurrentTimeTop(rowHeight);
            return `
                <div class="absolute left-0 right-0 border-t-2 border-red-500 z-40 pointer-events-none flex items-center" style="top: ${top}px">
                    <div class="w-2 h-2 rounded-full bg-red-500 -ml-1 transform -translate-y-1/2"></div>
                </div>
            `;
        }

        function renderCalendarDay() {
            const ROW_HEIGHT = 60;
            els.calendarGrid.className = 'relative bg-[#151921] h-[1440px] shadow-inner rounded-lg border border-neutral-800 overflow-hidden';

            let gridHtml = '';
            gridHtml += `<div class="absolute top-0 bottom-0 left-10 w-px bg-neutral-800 pointer-events-none z-0"></div>`;
            for (let i = 0; i < 24; i++) {
                gridHtml += `
                    <div class="absolute w-full border-b border-neutral-800 text-[10px] text-gray-500 box-border pointer-events-none"
                         style="top: ${i * ROW_HEIGHT}px; height: ${ROW_HEIGHT}px;">
                        <span class="absolute -top-2 left-2 font-mono">${String(i).padStart(2,'0')}:00</span>
                    </div>
                `;
            }

            // Add Time Line if today
            if (state.viewDate.toDateString() === new Date().toDateString()) {
                gridHtml += renderTimeLine(ROW_HEIGHT);
            }

            // Paste target marker
            gridHtml += renderPasteTargetMarkerForDay();

            const dayTasks = state.tasks.filter(t => {
                // Modified: Include 'done' tasks if they have a startDate
                if ((t.status !== 'scheduled' && t.status !== 'done') || !t.startDate) return false;
                const d = new Date(t.startDate);
                return d.toDateString() === state.viewDate.toDateString();
            });

            const layoutMap = calculateTaskLayout(dayTasks);

            const tasksHtml = dayTasks.map(t => {
                const layout = layoutMap.get(t.id);
                return renderDayTaskBlock(t, layout);
            }).join('');

            els.calendarGrid.innerHTML = gridHtml + tasksHtml;

            els.calendarGrid.ondragover = allowDrop;
            els.calendarGrid.ondrop = handleDayViewDrop;
        }

        function renderDayTaskBlock(t, layout) {
            const ROW_HEIGHT = 60;
            const start = new Date(t.startDate);
            const end = t.endDate ? new Date(t.endDate) : new Date(start.getTime() + (t.estimatedDuration || 30) * 60000);

            let durationMinutes = (end - start) / 60000;
            if (durationMinutes < 15) durationMinutes = 15;

            const startMinutes = start.getHours() * 60 + start.getMinutes();
            const top = startMinutes * (ROW_HEIGHT / 60);
            const height = durationMinutes * (ROW_HEIGHT / 60);

            const doneStyle = t.status === 'done'
                ? 'bg-brand-500/20 border-brand-500 text-gray-300'
                : 'bg-neutral-800/90 border-brand-500 text-gray-100';

            const proj = state.projects.find(p => p.id === t.projectId);
            const borderColor = proj ? proj.color : '#4B5563';

            let leftStyle = 'left: 48px; right: 16px;';
            if (layout) {
                const widthPct = 100 / layout.totalCols;
                const leftPct = layout.colIndex * widthPct;
                leftStyle = `left: calc(48px + (100% - 64px) * ${leftPct/100}); width: calc((100% - 64px) * ${widthPct/100} - 2px);`;
            }

            // Extract width from leftStyle for conditional time display
            const widthMatch = leftStyle.match(/width: calc\((100% - 64px) \* ([\d.]+) - ([\d.]+)px\);/);
            const widthPercent = widthMatch ? parseFloat(widthMatch[2]) : 1;
            const shouldShowTime = height > 30 && widthPercent > 0.2; // Show time only if height > 30px and width > 20%

            return `
                <div draggable="true"
                     id="task-el-${t.id}"
                     ondragstart="handleDragStart(event, '${t.id}')"
                     onclick="selectTask('${t.id}')"
                     class="absolute rounded border-l-[3px] ${doneStyle} text-xs overflow-hidden cursor-move hover:z-20 hover:ring-1 hover:ring-brand-500 transition-all shadow-sm"
                     style="top:${top}px;height:${height}px;z-index:10; ${leftStyle} border-left-color: ${borderColor}">
                    <div class="p-1 pointer-events-none flex flex-col h-full">
                        <div class="font-bold truncate leading-tight text-[11px]">${escapeHtml(t.title)}</div>
                        ${shouldShowTime ? `<div class="opacity-75 text-[9px] mt-0.5">${fmtTime(start)} - ${fmtTime(end)}</div>` : ''}
                    </div>
                    <div class="absolute bottom-0 inset-x-0 h-2 cursor-ns-resize hover:bg-brand-500/30 transition-colors z-30"
                         onmousedown="startResize(event, '${t.id}')"></div>
                </div>
            `;
        }

        function getStartOfWeek(date) {
            const current = new Date(date);
            const dayOfWeek = current.getDay();
            const start = new Date(current);
            start.setHours(0,0,0,0);
            start.setDate(current.getDate() - dayOfWeek);
            return start;
        }

        function renderCalendarWeekTimeGrid() {
            const ROW_HEIGHT = 60;
            const startOfWeek = getStartOfWeek(state.viewDate);

            // make week view self-scrollable so the header can stick
            els.calendarGrid.className = 'bg-[#151921] rounded-lg border border-neutral-800 overflow-auto h-full';

            const weekDays = Array.from({length:7}).map((_,i) => {
                const d = new Date(startOfWeek);
                d.setDate(d.getDate() + i);
                return d;
            });

            const headerCells = weekDays.map(d => {
                const isToday = new Date().toDateString() === d.toDateString();
                return `
                    <div class="bg-[#111827]/90 backdrop-blur p-2 text-center border-l border-neutral-800 sticky-week-header">
                        <div class="text-[11px] text-gray-500">${d.toLocaleDateString('zh-CN', {weekday:'short'})}</div>
                        <div class="text-sm font-bold ${isToday ? 'text-brand-500' : 'text-white'}">${d.getMonth()+1}月${d.getDate()}日</div>
                    </div>
                `;
            }).join('');

            let bodyHtml = '';
            bodyHtml += `
                <div class="week-time-body">
                    <div class="absolute top-0 left-0 right-0 bottom-0 pointer-events-none">
                        ${Array.from({length:24}).map((_,h) => `
                            <div class="time-row-line" style="top:${h*ROW_HEIGHT}px;height:${ROW_HEIGHT}px;"></div>
                            <div class="time-label" style="top:${h*ROW_HEIGHT}px;">${String(h).padStart(2,'0')}:00</div>
                        `).join('')}
                    </div>
                </div>
            `;

            const dayCols = weekDays.map((d, i) => {
                const iso = d.toISOString();
                const isToday = new Date().toDateString() === d.toDateString();
                const timeLineHtml = isToday ? renderTimeLine(ROW_HEIGHT) : '';
                const pasteMarker = renderPasteTargetMarkerForWeek(d);
                return `
                    <div class="week-time-body border-l border-neutral-800 relative" data-week-col="${i}" ondragover="allowDrop(event)" ondrop="handleWeekViewDrop(event, '${iso}')">
                        ${timeLineHtml}
                        ${pasteMarker}
                        ${renderWeekDayTaskBlocks(d)}
                    </div>
                `;
            }).join('');

            els.calendarGrid.innerHTML = `
                <div class="week-time-grid">
                    <div class="bg-[#111827]/90 backdrop-blur p-2 text-center text-xs text-gray-500 flex items-center justify-center sticky-week-header sticky-time-col">时间</div>
                    ${headerCells}

                    <div class="bg-[#111827] sticky-time-col">${bodyHtml}</div>
                    ${dayCols}
                </div>
            `;
        }

        function renderWeekDayTaskBlocks(dayDate) {
            const ROW_HEIGHT = 60;
            const tasksForDay = state.tasks.filter(t => {
                // Modified: Include 'done' tasks
                if ((t.status !== 'scheduled' && t.status !== 'done') || !t.startDate) return false;
                const sd = new Date(t.startDate);
                return sd.toDateString() === dayDate.toDateString();
            });

            const layoutMap = calculateTaskLayout(tasksForDay);

            return tasksForDay.map(t => {
                const start = new Date(t.startDate);
                const end = t.endDate ? new Date(t.endDate) : new Date(start.getTime() + (t.estimatedDuration || 30) * 60000);
                let durationMinutes = (end - start) / 60000;
                if (durationMinutes < 15) durationMinutes = 15;
                const startMinutes = start.getHours() * 60 + start.getMinutes();
                const top = startMinutes * (ROW_HEIGHT / 60);
                const height = durationMinutes * (ROW_HEIGHT / 60);

                const proj = state.projects.find(p => p.id === t.projectId);
                const borderColor = proj ? proj.color : '#4B5563';

                const doneStyle = t.status === 'done'
                    ? 'bg-brand-500/20 text-gray-300'
                    : 'bg-neutral-800/90 text-gray-100';

                const layout = layoutMap.get(t.id);
                let style = `top:${top}px;height:${height}px;z-index:10;border-left-color:${borderColor};`;

                if (layout) {
                    const widthPct = 100 / layout.totalCols;
                    const leftPct = layout.colIndex * widthPct;
                    style += `left:${leftPct}%;width:calc(${widthPct}% - 1px);`;
                } else {
                    style += `left:2px;right:2px;`;
                }

                // Extract width from style for conditional time display
                const widthMatch = style.match(/width:calc\((\d+)% - ([\d.]+)px\);/);
                const widthPercent = widthMatch ? parseFloat(widthMatch[1]) : 100;
                const shouldShowTime = height > 30 && widthPercent > 20; // Show time only if height > 30px and width > 20%

                return `
                    <div draggable="true"
                        id="task-el-${t.id}"
                        ondragstart="handleDragStart(event, '${t.id}')"
                        onclick="selectTask('${t.id}')"
                        class="absolute rounded border-l-[3px] ${doneStyle} text-[10px] overflow-hidden cursor-move hover:z-20 hover:ring-1 hover:ring-brand-500 transition-all shadow-sm"
                        style="${style}">
                        <div class="p-1 pointer-events-none">
                            <div class="font-semibold truncate leading-tight">${escapeHtml(t.title)}</div>
                            ${shouldShowTime ? `<div class="opacity-70 text-[9px]">${fmtTime(start)} - ${fmtTime(end)}</div>` : ''}
                        </div>
                        <div class="absolute bottom-0 inset-x-0 h-2 cursor-ns-resize hover:bg-brand-500/30 transition-colors z-30"
                             onmousedown="startResize(event, '${t.id}')"></div>
                    </div>
                `;
            }).join('');
        }

        function renderCalendarMonth() {
            const current = new Date(state.viewDate);
            const year = current.getFullYear();
            const month = current.getMonth();

            const firstDayOfMonth = new Date(year, month, 1);
            const startDay = new Date(firstDayOfMonth);
            startDay.setDate(startDay.getDate() - startDay.getDay());

            els.calendarGrid.className = 'calendar-month-grid bg-[#151921] h-full overflow-y-auto rounded-lg border border-neutral-800';

            let html = '';
            const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
            weekDays.forEach(d => {
                html += `<div class="p-2 text-center text-xs text-gray-500 bg-[#111827] border-b border-neutral-800">${d}</div>`;
            });

            let dayIterator = new Date(startDay);
            for (let i=0; i<42; i++) {
                const isCurrentMonth = dayIterator.getMonth() === month;
                const isToday = new Date().toDateString() === dayIterator.toDateString();

                const tasksForDay = state.tasks.filter(t => {
                    // Modified: Include 'done' tasks
                    if ((t.status !== 'scheduled' && t.status !== 'done') || !t.startDate) return false;
                    const tDate = new Date(t.startDate);
                    return tDate.toDateString() === dayIterator.toDateString();
                });

                const cellBgClass = isToday 
                    ? 'bg-gradient-to-br from-brand-500/10 to-transparent' 
                    : 'bg-[#111827]';

                html += `
                    <div class="${cellBgClass} min-h-[100px] border-b border-r border-neutral-800 relative group hover:bg-neutral-800/30 transition-colors"
                        data-month-date="${dayIterator.toISOString()}"
                        onclick="setMonthViewPasteTarget('${dayIterator.toISOString()}')"
                        ondrop="handleDropDate(event, '${dayIterator.toISOString()}')" ondragover="allowDrop(event)">
                        <button type="button" class="p-1 text-right text-xs w-full ${isCurrentMonth ? (isToday ? 'text-brand-500 font-bold bg-brand-500/10 rounded w-6 h-6 ml-auto flex items-center justify-center' : 'text-gray-400') : 'text-neutral-700'}" onclick="event.stopPropagation(); state.viewDate = new Date('${dayIterator.toISOString()}'); updateDateDisplay();">
                            ${dayIterator.getDate()}
                        </button>
                        <div class="px-1 flex flex-col gap-1 overflow-y-auto max-h-[80px]">
                            ${tasksForDay.map(t => {
                                const proj = state.projects.find(p => p.id === t.projectId);
                                const color = proj ? proj.color : '#4B5563';
                                const bg = proj
                                    ? (t.status === 'done' ? 'rgba(34,197,94,0.10)' : 'rgba(34,197,94,0.08)')
                                    : (t.status === 'done' ? 'rgba(75,85,99,0.18)' : 'rgba(75,85,99,0.14)');
                                return `
                                <div class="px-1 py-0.5 rounded text-[10px] text-gray-200 truncate cursor-pointer hover:opacity-90 border border-neutral-800/40"
                                    style="background:${bg}; border-left: 2px solid ${color};"
                                    draggable="true" ondragstart="handleDragStart(event, '${t.id}')" onclick="selectTask('${t.id}')">
                                    ${escapeHtml(t.title)}
                                </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `;

                dayIterator.setDate(dayIterator.getDate() + 1);
            }

            els.calendarGrid.innerHTML = html;
        }

        function fmtTime(d) {
            return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        }

        // ---- Kanban Board ----
        function renderKanban() {
            if (!els.kanbanContainer) return;

            const columns = [
                { id: 'inbox', title: '收集箱', status: 'inbox', color: 'border-gray-500' },
                { id: 'next', title: '下一步行动', status: 'next', color: 'border-amber-400' },
                { id: 'waiting', title: '等待', status: 'waiting', color: 'border-amber-600' },
                { id: 'someday', title: '将来/也许', status: 'someday', color: 'border-gray-400' },
                { id: 'scheduled', title: '排程', status: 'scheduled', color: 'border-brand-400' },
                { id: 'done', title: '已完成', status: 'done', color: 'border-brand-500' }
            ];

            let html = '';

            columns.forEach(col => {
                const colTasks = state.tasks.filter(t => {
                    if (t.status !== col.status) return false;

                    // project filter
                    if (!(state.kanbanFilter === 'all' || (state.kanbanFilter === 'none' ? !t.projectId : t.projectId === state.kanbanFilter))) {
                        return false;
                    }

                    // date range filter for kanban: always include tasks without dates
                    // only filter tasks with dates
                    const { start, end } = state.filter || {};
                    if (!start && !end) return true;
                    
                    // tasks without dates should always be shown
                    if (!t.startDate) return true;
                    
                    // filter tasks with dates based on range
                    const s = new Date(t.startDate);
                    const e = t.endDate ? new Date(t.endDate) : new Date(s.getTime() + (t.estimatedDuration || 30) * 60000);
                    const rangeStart = start || new Date(-8640000000000000);
                    const rangeEnd = end || new Date(8640000000000000);
                    return e >= rangeStart && s <= rangeEnd;
                });

                html += `
                    <div class="flex-shrink-0 w-80 flex flex-col h-full bg-[#111827]/40 rounded-lg border border-neutral-700/50">
                        <div class="p-3 border-b border-neutral-700/50 flex items-center justify-between">
                            <div class="flex items-center gap-2 font-semibold text-sm text-gray-200">
                                <span class="w-2 h-2 rounded-full border-2 ${col.color}"></span>
                                ${col.title}
                            </div>
                            <span class="bg-neutral-800 text-gray-500 text-[10px] px-2 py-0.5 rounded-full">${colTasks.length}</span>
                        </div>
                        <div class="flex-1 overflow-y-auto p-2 space-y-2 min-h-0"
                             ondragover="allowDrop(event)"
                             ondrop="handleKanbanDrop(event, '${col.status}')">

                            ${colTasks.length === 0 ? `<div class="text-center text-gray-600 text-xs py-10">暂无任务</div>` : ''}

                            ${colTasks.map(t => {
                                const project = state.projects.find(p => p.id === t.projectId);
                                const pColor = project ? project.color : 'transparent';
                                const pName = project ? project.name : null;

                                return `
                                <div draggable="true" ondragstart="handleDragStart(event, '${t.id}')" onclick="selectTask('${t.id}')"
                                     class="group bg-[#1F2937] hover:bg-neutral-700 p-3 rounded shadow-sm border border-neutral-700 cursor-grab active:cursor-grabbing hover:border-neutral-500 transition-all relative overflow-hidden">
                                     ${project ? `<div class="absolute left-0 top-0 bottom-0 w-1" style="background:${pColor}"></div>` : ''}
                                     <div class="flex items-start justify-between gap-2 mb-1 pl-1">
                                        <span class="text-sm text-gray-200 line-clamp-2 leading-relaxed ${t.status === 'done' ? 'line-through text-gray-500' : ''}">${escapeHtml(t.title)}</span>
                                        ${t.status === 'done' ? '<svg class="w-4 h-4 text-brand-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>' : ''}
                                     </div>
                                     <div class="flex items-center gap-2 pl-1 mt-2">
                                        ${pName ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-neutral-900 text-gray-400 border border-neutral-700 truncate max-w-[100px]">${escapeHtml(pName)}</span>` : ''}
                                        ${t.context ? `<span class="text-[10px] text-gray-500">${escapeHtml(t.context)}</span>` : ''}
                                        ${t.estimatedDuration ? `<span class="ml-auto text-[10px] text-gray-600 flex items-center gap-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>${t.estimatedDuration}m</span>` : ''}
                                     </div>
                                </div>
                                `;
                            }).join('')}

                            <div class="h-12 w-full"></div>
                        </div>
                    </div>
                `;
            });

            els.kanbanContainer.innerHTML = html;
        }

        window.handleKanbanDrop = function(e, newStatus) {
            e.preventDefault();
            if (!draggedTaskId) return;
            const task = state.tasks.find(t => t.id === draggedTaskId);
            if (task && task.status !== newStatus) {
                if (newStatus === 'done' && task.status !== 'done') {
                    triggerConfetti();
                }
                task.status = newStatus;
                renderKanban();
                renderSidebar();
                renderTaskDetails(task.id);
                schedulePersist();
            }
            draggedTaskId = null;
        }

        // ---- Gantt ----
        function renderGantt() {
            const startDate = new Date(state.viewDate);
            startDate.setHours(0,0,0,0);

            // apply range filter if set; otherwise show window around viewDate
            const rangeStart = (state.filter && state.filter.start) ? new Date(state.filter.start) : new Date(startDate);
            const rangeEnd = (state.filter && state.filter.end) ? new Date(state.filter.end) : null;

            const dayWidth = 88;
            const rowHeight = 44;
            const headerHeight = 44;
            const totalDays = rangeEnd ? Math.max(7, Math.ceil((rangeEnd - rangeStart) / (1000*60*60*24)) + 1) : 14;
            const nameColWidth = 220;

            // init expanded map
            if (!state.ganttExpanded) state.ganttExpanded = {};
            state.projects
                .filter(p => (p.status || 'active') !== 'archived')
                .forEach(p => {
                    if (typeof state.ganttExpanded[p.id] === 'undefined') state.ganttExpanded[p.id] = true;
                });

            // tasks that belong to non-archived projects and have dates (range-filtered)
            const tasksByProject = new Map();
            state.projects
                .filter(p => (p.status || 'active') !== 'archived')
                .forEach(p => tasksByProject.set(p.id, []));
            state.tasks.forEach(t => {
                if (!t.projectId) return;
                if (!t.startDate || !t.endDate) return;

                const s = new Date(t.startDate);
                const e = new Date(t.endDate);
                const rs = rangeStart || new Date(-8640000000000000);
                const re = rangeEnd || new Date(8640000000000000);
                if (!(e >= rs && s <= re)) return;

                if (!tasksByProject.has(t.projectId)) tasksByProject.set(t.projectId, []);
                tasksByProject.get(t.projectId).push(t);
            });

            // Build render rows: project header row + task rows if expanded
            const rows = [];
            state.projects
                .filter(p => (p.status || 'active') !== 'archived')
                .forEach(p => {
                    const arr = tasksByProject.get(p.id) || [];
                    rows.push({ type: 'project', project: p, count: arr.length });
                    if (state.ganttExpanded[p.id]) {
                        arr
                            .sort((a,b)=> new Date(a.startDate)-new Date(b.startDate))
                            .forEach(t => rows.push({ type: 'task', project: p, task: t }));
                    }
                });

            const totalWidth = nameColWidth + (totalDays * dayWidth);
            const totalHeight = Math.max(520, headerHeight + (rows.length * rowHeight) + 20);

            // grid + header
            let svg = '';

            // name column background
            svg += `<rect x="0" y="0" width="${nameColWidth}" height="${totalHeight}" fill="#111827" opacity="0.9" />`;
            svg += `<line x1="${nameColWidth}" y1="0" x2="${nameColWidth}" y2="${totalHeight}" stroke="#374151" stroke-width="1" />`;

            for (let i=0; i<totalDays; i++) {
                const d = new Date(rangeStart);
                d.setDate(d.getDate() + i);
                const x = nameColWidth + (i * dayWidth);

                // vertical day grid
                svg += `<line x1="${x}" y1="0" x2="${x}" y2="${totalHeight}" stroke="#374151" stroke-width="1" stroke-dasharray="4 4" />`;

                const dayName = d.toLocaleDateString('zh-CN', { weekday: 'short' });
                const dayNum = d.getDate();
                const isToday = new Date().toDateString() === d.toDateString();

                if (isToday) {
                    svg += `<rect x="${x}" y="0" width="${dayWidth}" height="${headerHeight}" fill="#22C55E" opacity="0.12" />`;
                }

                svg += `<text x="${x + 6}" y="18" fill="${isToday ? '#A3E635' : '#6B7280'}" font-size="10" font-weight="700">${dayName}</text>`;
                svg += `<text x="${x + 6}" y="36" fill="${isToday ? '#86EFAC' : '#9CA3AF'}" font-size="14">${dayNum}</text>`;
            }

            // header baseline
            svg += `<line x1="0" y1="${headerHeight}" x2="${totalWidth}" y2="${headerHeight}" stroke="#374151" stroke-width="1" />`;

            // rows
            rows.forEach((r, idx) => {
                const yTop = headerHeight + (idx * rowHeight);
                const yMid = yTop + rowHeight/2;

                // row divider
                svg += `<line x1="0" y1="${yTop}" x2="${totalWidth}" y2="${yTop}" stroke="#0B1220" opacity="0.9" />`;

                if (r.type === 'project') {
                    // project header row background
                    svg += `<rect x="0" y="${yTop}" width="${totalWidth}" height="${rowHeight}" fill="#0B1220" opacity="0.55" />`;

                    // color dot
                    svg += `<circle cx="14" cy="${yMid}" r="5" fill="${r.project.color}" />`;

                    const caret = state.ganttExpanded[r.project.id] ? '▼' : '▶';
                    svg += `<text x="28" y="${yMid+5}" fill="#E5E7EB" font-size="12" font-weight="800">${caret} ${escapeHtml(r.project.name)}  <tspan fill="#6B7280" font-weight="600">(${r.count})</tspan></text>`;

                    // clickable overlay for toggle
                    svg += `<rect x="0" y="${yTop}" width="${nameColWidth}" height="${rowHeight}" fill="transparent" style="cursor:pointer" onclick="toggleGanttProject('${r.project.id}')" />`;
                } else {
                    const t = r.task;
                    const p = r.project;

                    // task label
                    svg += `<text x="16" y="${yMid+5}" fill="#D1D5DB" font-size="12" font-weight="600">${escapeHtml(t.title)}</text>`;
                    svg += `<rect x="0" y="${yTop}" width="${nameColWidth}" height="${rowHeight}" fill="transparent" style="cursor:pointer" onclick="selectTask('${t.id}')" />`;

                    const tStart = new Date(t.startDate);
                    const tEnd = new Date(t.endDate);

                    const diffDaysStart = (tStart - rangeStart) / (1000*60*60*24);
                    const diffDaysEnd = (tEnd - rangeStart) / (1000*60*60*24);

                    if (!(diffDaysEnd < 0 || diffDaysStart > totalDays)) {
                        const x = nameColWidth + Math.max(0, diffDaysStart * dayWidth);
                        const width = Math.min((diffDaysEnd - diffDaysStart) * dayWidth, (totalDays * dayWidth) - (x - nameColWidth));

                        const barY = yTop + 9;
                        const barH = 26;

                        svg += `
                            <g style="cursor:pointer" onclick="selectTask('${t.id}')">
                                <defs>
                                    <linearGradient id="grad-${t.id}" x1="0" y1="0" x2="1" y2="0">
                                        <stop offset="0%" stop-color="#22C55E" stop-opacity="0.85" />
                                        <stop offset="100%" stop-color="#A3E635" stop-opacity="0.85" />
                                    </linearGradient>
                                </defs>
                                <rect x="${x}" y="${barY}" width="${Math.max(6, width)}" height="${barH}" rx="7" fill="url(#grad-${t.id})" opacity="0.95" />
                                <rect x="${x}" y="${barY + barH - 4}" width="${Math.max(0, width * (t.progress || 0) / 100)}" height="4" rx="2" fill="#111827" opacity="0.35" />
                                <rect x="${x}" y="${barY}" width="${Math.max(6, width)}" height="${barH}" rx="7" fill="transparent" stroke="${p.color}" stroke-opacity="0.55" />
                            </g>
                        `;
                    }
                }
            });

            const rangeLabel = (state.filter?.start || state.filter?.end)
                ? `${(state.filter.start ? state.filter.start.toLocaleDateString('zh-CN') : '∞')} - ${(state.filter.end ? state.filter.end.toLocaleDateString('zh-CN') : '∞')}`
                : `${rangeStart.toLocaleDateString('zh-CN')} 起`;

            // Split gantt chart into fixed left column and scrollable right timeline
            els.ganttContainer.innerHTML = `
                <div class="flex items-center justify-between mb-3">
                    <div class="text-sm font-semibold text-white">项目甘特图</div>
                    <div class="text-[11px] text-gray-500">${escapeHtml(rangeLabel)} · 按项目分组，可展开/折叠（点击项目行）</div>
                </div>
                <div class="flex rounded-lg border border-neutral-800 overflow-hidden">
                    <!-- Fixed left column -->
                    <div class="w-[${nameColWidth}px] bg-[#111827]/90 border-r border-neutral-800 overflow-hidden">
                        <svg width="${nameColWidth}" height="${totalHeight}">
                            <!-- Name column background -->
                            <rect x="0" y="0" width="${nameColWidth}" height="${totalHeight}" fill="#111827" opacity="0.9" />
                            <!-- Vertical separator -->
                            <line x1="${nameColWidth}" y1="0" x2="${nameColWidth}" y2="${totalHeight}" stroke="#374151" stroke-width="1" />
                            <!-- Header -->
                            <text x="10" y="30" fill="#6B7280" font-size="12" font-weight="700">项目 / 任务</text>
                            <!-- Header baseline -->
                            <line x1="0" y1="${headerHeight}" x2="${nameColWidth}" y2="${headerHeight}" stroke="#374151" stroke-width="1" />
                            <!-- Project and task rows -->
                            ${rows.map((r, idx) => {
                                const yTop = headerHeight + (idx * rowHeight);
                                const yMid = yTop + rowHeight/2;
                                
                                let rowSvg = '';
                                // Row divider
                                rowSvg += `<line x1="0" y1="${yTop}" x2="${nameColWidth}" y2="${yTop}" stroke="#0B1220" opacity="0.9" />`;
                                
                                if (r.type === 'project') {
                                    // Project row background
                                    rowSvg += `<rect x="0" y="${yTop}" width="${nameColWidth}" height="${rowHeight}" fill="#0B1220" opacity="0.55" />`;
                                    // Project expand/collapse indicator
                                    const isExpanded = state.ganttExpanded[r.project.id];
                                    rowSvg += `<text x="12" y="${yMid + 4}" fill="#9CA3AF" font-size="10" cursor="pointer" onclick="toggleGanttProject('${r.project.id}')">${isExpanded ? '▾' : '▸'}</text>`;
                                    // Project name
                                    rowSvg += `<text x="24" y="${yMid + 4}" fill="#FFFFFF" font-size="13" font-weight="600" cursor="pointer" onclick="toggleGanttProject('${r.project.id}')">${escapeHtml(r.project.name)}</text>`;
                                    // Project task count
                                    rowSvg += `<text x="${nameColWidth - 30}" y="${yMid + 4}" fill="#6B7280" font-size="11">${r.count}</text>`;
                                } else {
                                    // Task row
                                    rowSvg += `<rect x="0" y="${yTop}" width="${nameColWidth}" height="${rowHeight}" fill="#111827" opacity="0.3" />`;
                                    // Task dot indicator
                                    rowSvg += `<circle cx="24" cy="${yMid}" r="4" fill="${r.project.color}" />`;
                                    // Task name
                                    rowSvg += `<text x="36" y="${yMid + 4}" fill="#D1D5DB" font-size="12">${escapeHtml(r.task.title)}</text>`;
                                    // Task progress
                                    if (r.task.progress > 0) {
                                        rowSvg += `<rect x="${nameColWidth - 80}" y="${yMid - 6}" width="70" height="12" fill="#374151" rx="2" />`;
                                        rowSvg += `<rect x="${nameColWidth - 80}" y="${yMid - 6}" width="${(70 * r.task.progress) / 100}" height="12" fill="${r.project.color}" rx="2" />`;
                                        rowSvg += `<text x="${nameColWidth - 40}" y="${yMid + 4}" fill="#D1D5DB" font-size="9" text-anchor="middle">${r.task.progress}%</text>`;
                                    }
                                }
                                return rowSvg;
                            }).join('')}
                        </svg>
                    </div>
                    <!-- Scrollable right column -->
                    <div class="flex-1 overflow-x-auto">
                        <svg width="${totalWidth - nameColWidth}" height="${totalHeight}" class="bg-[#0B1220]/40">
                            <!-- Timeline header -->
                            ${Array.from({length: totalDays}, (_, i) => {
                                const d = new Date(rangeStart);
                                d.setDate(d.getDate() + i);
                                const x = i * dayWidth;
                                const isToday = new Date().toDateString() === d.toDateString();
                                
                                let headerSvg = '';
                                if (isToday) {
                                    headerSvg += `<rect x="${x}" y="0" width="${dayWidth}" height="${headerHeight}" fill="#22C55E" opacity="0.12" />`;
                                }
                                headerSvg += `<text x="${x + 6}" y="18" fill="${isToday ? '#A3E635' : '#6B7280'}" font-size="10" font-weight="700">${d.toLocaleDateString('zh-CN', { weekday: 'short' })}</text>`;
                                headerSvg += `<text x="${x + 6}" y="36" fill="${isToday ? '#86EFAC' : '#9CA3AF'}" font-size="14">${d.getDate()}</text>`;
                                // Vertical day grid line
                                headerSvg += `<line x1="${x}" y1="0" x2="${x}" y2="${totalHeight}" stroke="#374151" stroke-width="1" stroke-dasharray="4 4" />`;
                                return headerSvg;
                            }).join('')}
                            <!-- Header baseline -->
                            <line x1="0" y1="${headerHeight}" x2="${totalWidth - nameColWidth}" y2="${headerHeight}" stroke="#374151" stroke-width="1" />
                            <!-- Task bars -->
                            ${rows.map((r, idx) => {
                                if (r.type !== 'task') return '';
                                
                                const task = r.task;
                                const project = r.project;
                                const yTop = headerHeight + (idx * rowHeight);
                                const barHeight = rowHeight - 12;
                                const barY = yTop + 6;
                                
                                // Calculate task position and width
                                const taskStart = new Date(task.startDate);
                                const taskEnd = new Date(task.endDate);
                                const taskDuration = Math.ceil((taskEnd - taskStart) / (1000 * 60 * 60 * 24)) + 1;
                                const startOffset = Math.max(0, Math.ceil((taskStart - rangeStart) / (1000 * 60 * 60 * 24)));
                                const barX = startOffset * dayWidth;
                                const barWidth = Math.max(10, taskDuration * dayWidth - 2);
                                
                                let taskSvg = '';
                                // Task bar background
                                taskSvg += `<rect x="${barX + 1}" y="${barY}" width="${barWidth}" height="${barHeight}" fill="${project.color}" opacity="0.3" rx="3" />`;
                                // Task bar progress
                                const progressWidth = (barWidth * task.progress) / 100;
                                taskSvg += `<rect x="${barX + 1}" y="${barY}" width="${progressWidth}" height="${barHeight}" fill="${project.color}" rx="3" />`;
                                // Task bar border
                                taskSvg += `<rect x="${barX + 1}" y="${barY}" width="${barWidth}" height="${barHeight}" fill="none" stroke="${project.color}" stroke-width="1" rx="3" opacity="0.7" />`;
                                return taskSvg;
                            }).join('')}
                        </svg>
                    </div>
                </div>
            `;
        }

        window.toggleGanttProject = function(projectId) {
            if (!state.ganttExpanded) state.ganttExpanded = {};
            state.ganttExpanded[projectId] = !state.ganttExpanded[projectId];
            renderGantt();
        }

        // ---- Drag & Drop ----
        let draggedTaskId = null;
        let dragCopyMode = false;
        window.handleDragStart = function(e, taskId) {
            if (state.isResizing) {
                e.preventDefault();
                return;
            }
            draggedTaskId = taskId;
            // Ctrl/Cmd + drag = copy
            const isMac = navigator.platform.toLowerCase().includes('mac');
            dragCopyMode = isMac ? e.metaKey : e.ctrlKey;
            e.dataTransfer.effectAllowed = dragCopyMode ? 'copy' : 'move';
            e.dataTransfer.setData('text/plain', taskId);
        };

        window.allowDrop = function(e) {
            e.preventDefault();
        };

        window.handleDayViewDrop = function(e) {
            e.preventDefault();
            if (!draggedTaskId) return;

            const rect = els.calendarGrid.getBoundingClientRect();
            const offsetY = e.clientY - rect.top;
            const ROW_HEIGHT = 60;

            const totalMinutes = (offsetY / ROW_HEIGHT) * 60;
            const hour = clamp(Math.floor(totalMinutes / 60), 0, 23);
            const minute = clamp(Math.floor(totalMinutes % 60), 0, 59);

            const snapped = snapMinutes(minute, 15);

            if (dragCopyMode) {
                // copy-on-drop
                const original = state.tasks.find(t => t.id === draggedTaskId);
                if (original) {
                    state.selectedTaskId = original.id;
                    copySelectedTaskToClipboard();
                    state.calendarPasteTarget = { date: new Date(state.viewDate), hour, minute: snapped, source: 'day' };
                    pasteTaskFromClipboard();
                }
                draggedTaskId = null;
                dragCopyMode = false;
                return;
            }

            updateTaskScheduleExact(draggedTaskId, state.viewDate, hour, snapped);
            dragCopyMode = false;
        };

        window.handleDropDate = function(e, dateStr) {
            e.preventDefault();
            if (!draggedTaskId) return;
            const date = new Date(dateStr);

            if (dragCopyMode) {
                const original = state.tasks.find(t => t.id === draggedTaskId);
                if (original) {
                    state.selectedTaskId = original.id;
                    copySelectedTaskToClipboard();
                    state.calendarPasteTarget = { date, hour: 9, minute: 0, source: 'month' };
                    pasteTaskFromClipboard();
                }
                draggedTaskId = null;
                dragCopyMode = false;
                return;
            }

            updateTaskScheduleExact(draggedTaskId, date, 9, 0);
            dragCopyMode = false;
        };

        window.handleWeekViewDrop = function(e, dayIso) {
            e.preventDefault();
            if (!draggedTaskId) return;

            const day = new Date(dayIso);

            const col = e.currentTarget;
            const rect = col.getBoundingClientRect();
            const offsetY = e.clientY - rect.top;
            const ROW_HEIGHT = 60;

            const totalMinutes = (offsetY / ROW_HEIGHT) * 60;
            const hour = clamp(Math.floor(totalMinutes / 60), 0, 23);
            const minute = clamp(Math.floor(totalMinutes % 60), 0, 59);
            const snapped = snapMinutes(minute, 15);

            if (dragCopyMode) {
                const original = state.tasks.find(t => t.id === draggedTaskId);
                if (original) {
                    state.selectedTaskId = original.id;
                    copySelectedTaskToClipboard();
                    state.calendarPasteTarget = { date: day, hour, minute: snapped, source: 'week' };
                    pasteTaskFromClipboard();
                }
                draggedTaskId = null;
                dragCopyMode = false;
                return;
            }

            updateTaskScheduleExact(draggedTaskId, day, hour, snapped);
            dragCopyMode = false;
        };

        function snapMinutes(minute, step) {
            return clamp(Math.round(minute / step) * step, 0, 59);
        }

        function clamp(n, min, max) {
            return Math.max(min, Math.min(max, n));
        }

        function updateTaskScheduleExact(taskId, dateObj, hour, minute) {
            const task = state.tasks.find(t => t.id === taskId);
            if (!task) return;

            let durationMs = (task.estimatedDuration || 30) * 60000;
            if (task.startDate && task.endDate) {
                durationMs = new Date(task.endDate) - new Date(task.startDate);
            }

            const newStart = new Date(dateObj);
            newStart.setHours(hour, minute, 0, 0);
            const newEnd = new Date(newStart.getTime() + durationMs);

            task.status = 'scheduled';
            task.startDate = newStart;
            task.endDate = newEnd;
            task.estimatedDuration = Math.round(durationMs / 60000);

            renderSidebar();
            renderCalendar();
            if (state.view === 'gantt') renderGantt();
            if (state.view === 'kanban') renderKanban();
            draggedTaskId = null;
        }

        // ---- Resizing ----
        window.startResize = function(e, taskId) {
            e.stopPropagation();
            e.preventDefault();

            state.isResizing = true;
            state.resizeTask = state.tasks.find(t => t.id === taskId);
            state.resizeStartY = e.clientY;

            const el = document.getElementById(`task-el-${taskId}`);
            state.resizeStartHeight = el ? el.offsetHeight : 0;

            document.body.style.cursor = 'ns-resize';
        };

        function handleResizeMove(e) {
            if (!state.isResizing || !state.resizeTask) return;
            const el = document.getElementById(`task-el-${state.resizeTask.id}`);
            if (!el) return;

            const deltaY = e.clientY - state.resizeStartY;
            const newHeight = Math.max(15, state.resizeStartHeight + deltaY);
            el.style.height = `${newHeight}px`;
        }

        function handleResizeUp(e) {
            if (!state.isResizing || !state.resizeTask) return;

            const deltaY = e.clientY - state.resizeStartY;
            const ROW_HEIGHT = 60;
            const addedMinutes = (deltaY / ROW_HEIGHT) * 60;

            const oldEnd = new Date(state.resizeTask.endDate || new Date(state.resizeTask.startDate).getTime() + (state.resizeTask.estimatedDuration||30)*60000);
            const newEnd = new Date(oldEnd.getTime() + addedMinutes * 60000);

            const coeff = 1000 * 60 * 5;
            const snappedEndTime = Math.round(newEnd.getTime() / coeff) * coeff;
            const minEnd = new Date(state.resizeTask.startDate).getTime() + 15 * 60000;

            state.resizeTask.endDate = new Date(Math.max(snappedEndTime, minEnd));
            state.resizeTask.estimatedDuration = Math.round((state.resizeTask.endDate - new Date(state.resizeTask.startDate)) / 60000);

            state.isResizing = false;
            state.resizeTask = null;
            document.body.style.cursor = '';

            renderCalendar();
            if (state.view === 'gantt') renderGantt();
            if (state.view === 'kanban') renderKanban();
        }

        // ---- Updates & deletion ----
        window.deleteTask = function(taskId) {
            if (confirm('确定要删除此任务吗？')) {
                state.tasks = state.tasks.filter(t => t.id !== taskId);
                state.selectedTaskId = null;
                renderSidebar();
                renderCalendar();
                renderGantt();
                renderKanban();
                renderTodayTasksPanel();
            }
        }

        window.updateTaskDescription = function(id, val) {
            const task = state.tasks.find(t => t.id === id);
            if (task) {
                task.description = val;
                schedulePersist();
                renderTaskDetails(id);
            }
        };

        window.updateTaskContext = function(id, val) {
            const task = state.tasks.find(t => t.id === id);
            if (task) task.context = val;
        };

        window.updateTaskProject = function(id, val) {
            const task = state.tasks.find(t => t.id === id);
            if (task) {
                task.projectId = val || null;
                renderGantt();
                if (state.view === 'kanban') renderKanban();
            }
        };

        window.updateTaskStatus = function(id, val) {
            const task = state.tasks.find(t => t.id === id);
            if (task) {
                task.status = val;
                renderSidebar();
                renderCalendar();
                if (state.view === 'kanban') renderKanban();
                renderTaskDetails(id);
            }
        };

        window.updateTaskReminderEnabled = function(id, enabled) {
            const task = state.tasks.find(t => t.id === id);
            if (!task) return;
            task.reminderEnabled = !!enabled;
            if (task.reminderEnabled && (task.reminderOffset === undefined || task.reminderOffset === null)) {
                task.reminderOffset = 15;
            }
            renderTaskDetails(id);
        };

        window.updateTaskReminderOffset = function(id, val) {
            const task = state.tasks.find(t => t.id === id);
            if (!task) return;
            task.reminderOffset = Number(val);
        };

        window.updateTaskTitle = function(id, val) {
            const task = state.tasks.find(t => t.id === id);
            if (task) {
                task.title = val;
                renderSidebar();
                renderCalendar();
                if (state.view === 'kanban') renderKanban();
            }
        };

        window.updateTaskProgress = function(id, val) {
            const task = state.tasks.find(t => t.id === id);
            if (task) {
                const progress = Number(val);
                task.progress = progress;
                
                // Update the span text in real-time
                const progressSpan = document.getElementById(`task-progress-${id}`);
                if (progressSpan) {
                    progressSpan.textContent = `${progress}%`;
                }
                
                renderGantt();
                schedulePersist();
            }
        };

        // ---- Timer ----
        function toggleTimer() {
            state.timer.isRunning = !state.timer.isRunning;
            els.timerToggle.innerText = state.timer.isRunning ? '暂停' : '开始';
            els.timerToggle.className = state.timer.isRunning
                ? 'bg-neutral-700 hover:bg-neutral-600 text-white font-medium py-1.5 px-8 rounded shadow transition-all'
                : 'bg-[#22C55E] hover:bg-[#A3E635] text-black font-extrabold py-1.5 px-8 rounded shadow-lg shadow-green-500/20 transition-all hover:scale-105 active:scale-95 border border-green-400/50';

            if (state.timer.isRunning) {
                state.timer.interval = setInterval(() => {
                    if (state.timer.timeLeft > 0) {
                        state.timer.timeLeft--;
                        updateTimerDisplay();
                    } else {
                        clearInterval(state.timer.interval);
                        state.timer.isRunning = false;
                        new Audio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg').play().catch(()=>{});
                        alert('专注时间结束！');
                    }
                }, 1000);
            } else {
                clearInterval(state.timer.interval);
            }
        }

        function resetTimer() {
            state.timer.isRunning = false;
            clearInterval(state.timer.interval);
            state.timer.timeLeft = 25 * 60;
            updateTimerDisplay();
            els.timerToggle.innerText = '开始';
            els.timerToggle.className = 'bg-[#22C55E] hover:bg-[#A3E635] text-black font-extrabold py-1.5 px-8 rounded shadow-lg shadow-green-500/20 transition-all hover:scale-105 active:scale-95 border border-green-400/50';
        }

        function updateTimerDisplay() {
            const m = Math.floor(state.timer.timeLeft / 60);
            const s = state.timer.timeLeft % 60;
            els.timerDisplay.innerText = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;

            const totalTime = 25 * 60;
            const progress = ((totalTime - state.timer.timeLeft) / totalTime) * 440;
            els.timerProgress.style.strokeDashoffset = progress;
        }

        // ---- Effects ----
        window.toggleTaskDone = function(taskId) {
            const task = state.tasks.find(t => t.id === taskId);
            if (!task) return;

            task.status = task.status === 'done' ? 'inbox' : 'done';
            if (task.status === 'done') triggerConfetti();

            renderSidebar();
            renderCalendar();
            if (state.view === 'kanban') renderKanban();
            renderTaskDetails(taskId);
            if (!state.selectedTaskId) renderTodayTasksPanel();
        }

        function triggerConfetti() {
            const canvas = els.confetti;
            const ctx = canvas.getContext('2d');
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;

            const particles = [];
            const particleCount = 120;

            for (let i=0; i<particleCount; i++) {
                particles.push({
                    x: window.innerWidth / 2,
                    y: window.innerHeight / 2,
                    vx: (Math.random() - 0.5) * 18,
                    vy: (Math.random() - 0.8) * 18,
                    life: 90,
                    color: i % 2 === 0 ? '#A3E635' : '#22C55E',
                    size: Math.random() * 4 + 2
                });
            }

            function animate() {
                ctx.clearRect(0,0,canvas.width,canvas.height);
                let active = false;

                particles.forEach(p => {
                    if (p.life > 0) {
                        active = true;
                        p.x += p.vx;
                        p.y += p.vy;
                        p.vy += 0.55;
                        p.life -= 1;
                        p.size *= 0.97;

                        ctx.fillStyle = p.color;
                        ctx.beginPath();
                        ctx.arc(p.x, p.y, p.size, 0, Math.PI*2);
                        ctx.fill();
                    }
                });

                if (active) requestAnimationFrame(animate);
                else ctx.clearRect(0,0,canvas.width,canvas.height);
            }
            animate();
        }

        updateCalendarViewButtons();

        async function boot() {
            await loadStateFromServer();
            hookPersistence();
            // ensure UI reflects loaded view choices
            updateCalendarViewButtons();
            // render from loaded state
            init();
            // after first render, persist seed if db empty
            schedulePersist();
        }

        boot();
