// Created: 2026-04-06
// detail-panel.js — Right side detail panel for desktop
// Design Ref: §3 — DetailPanel object, desktop vs mobile branching

const DetailPanel = {
    _taskId: null,
    _isOpen: false,
    _snapshot: null, // snapshot of field values to detect changes
    _dirty: false,

    isMobile() { return window.innerWidth <= 768; },

    open(task) {
        if (this.isMobile()) {
            if (typeof openDetailModal === "function") openDetailModal(task);
            return;
        }
        this._taskId = task.id;
        this._isOpen = true;
        this._dirty = false;
        this.render(task);
        this._takeSnapshot();
        this._updateSaveBtn();
        document.getElementById("detail-panel").style.display = "flex";
        document.querySelector(".main-content").classList.add("panel-open");
    },

    close() {
        this._taskId = null;
        this._isOpen = false;
        this._dirty = false;
        this._snapshot = null;
        document.getElementById("detail-panel").style.display = "none";
        document.querySelector(".main-content").classList.remove("panel-open");
    },

    _takeSnapshot() {
        this._snapshot = {
            title: document.getElementById("dp-title").value,
            desc: document.getElementById("dp-desc").value,
            cat: document.getElementById("dp-category").value,
            date: document.getElementById("dp-date").value,
            time: document.getElementById("dp-time").value,
            allday: document.getElementById("dp-allday").checked,
            recurrence: document.getElementById("dp-recurrence") ? document.getElementById("dp-recurrence").value : "",
            recStart: document.getElementById("dp-rec-start") ? document.getElementById("dp-rec-start").value : "",
            recEnd: document.getElementById("dp-rec-end") ? document.getElementById("dp-rec-end").value : "",
            showDaily: document.getElementById("dp-show-daily") ? document.getElementById("dp-show-daily").checked : false,
        };
    },

    _checkDirty() {
        if (!this._snapshot) return false;
        const s = this._snapshot;
        return (
            document.getElementById("dp-title").value !== s.title ||
            document.getElementById("dp-desc").value !== s.desc ||
            document.getElementById("dp-category").value !== s.cat ||
            document.getElementById("dp-date").value !== s.date ||
            document.getElementById("dp-time").value !== s.time ||
            document.getElementById("dp-allday").checked !== s.allday ||
            (document.getElementById("dp-recurrence") ? document.getElementById("dp-recurrence").value : "") !== s.recurrence ||
            (document.getElementById("dp-rec-start") ? document.getElementById("dp-rec-start").value : "") !== s.recStart ||
            (document.getElementById("dp-rec-end") ? document.getElementById("dp-rec-end").value : "") !== s.recEnd ||
            (document.getElementById("dp-show-daily") ? document.getElementById("dp-show-daily").checked : false) !== (s.showDaily || false)
        );
    },

    _updateSaveBtn() {
        this._dirty = this._checkDirty();
        const btn = document.getElementById("dp-save");
        if (btn) btn.disabled = !this._dirty;
    },

    render(task) {
        const isShared = task.shared_calendar_id && typeof SharedCalendar !== "undefined";
        const canEdit = !isShared || SharedCalendar.canEditTask(task);
        const canDel = !isShared || SharedCalendar.canDeleteTask(task);

        document.getElementById("dp-title").value = task.text || "";
        document.getElementById("dp-desc").value = task.description || "";
        document.getElementById("dp-date").value = task.dueDate || "";
        const isAllDay = !task.dueTime;
        document.getElementById("dp-allday").checked = isAllDay;
        document.getElementById("dp-time").value = task.dueTime || "";
        document.getElementById("dp-time").style.display = isAllDay ? "none" : "";
        document.getElementById("dp-created").textContent = task.createdAt ? new Date(task.createdAt).toLocaleString() : "-";
        document.getElementById("dp-updated").textContent = task.updatedAt ? new Date(task.updatedAt).toLocaleString() : "-";

        // Recurrence
        const recSel = document.getElementById("dp-recurrence");
        const recStart = document.getElementById("dp-rec-start");
        const recEnd = document.getElementById("dp-rec-end");
        const isChild = !task.recurrence && task.recurrence_parent_id;
        if (recSel) {
            if (isChild) {
                // Child of recurring series — show as read-only
                recSel.value = "";
                recSel.disabled = true;
                recSel.title = "Edit recurrence from the original task";
            } else {
                recSel.value = (task.recurrence && task.recurrence.type) || "";
                recSel.disabled = !canEdit;
                recSel.title = "";
            }
            const hasRec = !!recSel.value;
            document.getElementById("dp-date").style.display = hasRec ? "none" : "";
            if (recStart) {
                recStart.style.display = hasRec ? "" : "none";
                recStart.value = (task.recurrence && task.recurrence.startDate) || task.dueDate || "";
                recStart.disabled = !canEdit || isChild;
            }
            if (recEnd) {
                recEnd.style.display = hasRec ? "" : "none";
                recEnd.value = (task.recurrence && task.recurrence.endDate) || "";
                recEnd.disabled = !canEdit || isChild;
            }
        }

        // Reminders
        this.renderReminders(task);

        // Show daily until due date
        const showDailyCb = document.getElementById("dp-show-daily");
        if (showDailyCb) {
            showDailyCb.checked = !!task.show_daily;
            showDailyCb.disabled = !canEdit;
        }

        // Show creator for shared tasks
        const creatorEl = document.getElementById("dp-creator-row");
        if (creatorEl) {
            if (isShared) {
                const name = SharedCalendar.getCreatorName(task.user_id);
                document.getElementById("dp-creator").textContent = name || "Unknown";
                creatorEl.style.display = "";
            } else {
                creatorEl.style.display = "none";
            }
        }

        // Disable editing for viewers
        document.getElementById("dp-title").readOnly = !canEdit;
        document.getElementById("dp-desc").readOnly = !canEdit;
        document.getElementById("dp-date").disabled = !canEdit;
        document.getElementById("dp-time").disabled = !canEdit;
        document.getElementById("dp-allday").disabled = !canEdit;
        document.getElementById("dp-save").style.display = canEdit ? "" : "none";
        document.getElementById("dp-archive").style.display = canEdit ? "" : "none";
        document.getElementById("dp-delete").style.display = canDel ? "" : "none";
        const subtaskInput = document.getElementById("dp-subtask-input");
        const subtaskBtn = document.getElementById("dp-subtask-add-btn");
        if (subtaskInput) subtaskInput.disabled = !canEdit;
        if (subtaskBtn) subtaskBtn.disabled = !canEdit;

        // Populate category select
        const sel = document.getElementById("dp-category");
        sel.innerHTML = "";
        if (typeof categories !== "undefined") {
            for (const c of categories) {
                const o = document.createElement("option");
                o.value = c.id; o.textContent = c.label;
                if (c.id === task.category) o.selected = true;
                sel.appendChild(o);
            }
        }

        // Render subtasks
        this.renderSubtasks();

        // Populate shared calendar list (checkboxes, no Personal)
        const calList = document.getElementById("dp-calendar-list");
        if (calList && typeof SharedCalendar !== "undefined") {
            calList.innerHTML = "";
            const writableCals = SharedCalendar.calendars.filter(c => SharedCalendar.canEdit(c.id));
            if (writableCals.length === 0) {
                calList.innerHTML = '<div style="font-size:0.78rem;color:var(--text-faint);">No shared calendars</div>';
            } else {
                for (const cal of writableCals) {
                    const label = document.createElement("label");
                    label.className = "dp-cal-option";
                    const cb = document.createElement("input");
                    cb.type = "checkbox"; cb.value = cal.id;
                    cb.checked = cal.id === task.shared_calendar_id;
                    cb.disabled = !canEdit;
                    const dot = document.createElement("span");
                    dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${cal.color};flex-shrink:0;`;
                    const name = document.createElement("span");
                    name.textContent = cal.name;
                    label.appendChild(cb); label.appendChild(dot); label.appendChild(name);
                    calList.appendChild(label);
                }
            }
        }
    },

    save() {
        if (!this._taskId) return;
        const recType = document.getElementById("dp-recurrence") ? document.getElementById("dp-recurrence").value : "";
        const recStartDate = document.getElementById("dp-rec-start") ? document.getElementById("dp-rec-start").value : "";
        const recEndDate = document.getElementById("dp-rec-end") ? document.getElementById("dp-rec-end").value : "";
        const data = {
            text: document.getElementById("dp-title").value,
            description: document.getElementById("dp-desc").value,
            category: document.getElementById("dp-category").value,
            dueDate: document.getElementById("dp-date").value,
            dueTime: document.getElementById("dp-allday").checked ? "" : document.getElementById("dp-time").value,
            recurrence: recType ? {
                type: recType,
                interval: 1,
                startDate: recStartDate || null,
                endDate: recEndDate || null,
            } : null,
            show_daily: document.getElementById("dp-show-daily") ? document.getElementById("dp-show-daily").checked : false,
            auto_complete: document.getElementById("dp-auto-complete") ? document.getElementById("dp-auto-complete").checked : false,
        };

        // Capture old recurrence BEFORE updateTask changes it
        const foundBefore = typeof _findTask === "function" ? _findTask(this._taskId) : null;
        const oldRecurrence = foundBefore && foundBefore.task.recurrence ? { ...foundBefore.task.recurrence } : null;

        // Update the task itself
        if (typeof updateTask === "function") updateTask(this._taskId, data);

        // Recurrence changed: delete future tasks from old series, generate new
        if (typeof _handleRecurrenceChange === "function" && foundBefore) {
            _handleRecurrenceChange(foundBefore.task, data.recurrence, oldRecurrence);
        }

        // Update shared_calendar_id if changed
        const calList = document.getElementById("dp-calendar-list");
        if (calList && typeof _useSupabase === "function" && _useSupabase()) {
            const checked = calList.querySelector("input[type=checkbox]:checked");
            const newCalId = checked ? checked.value : null;
            const found = typeof _findTask === "function" ? _findTask(this._taskId) : null;
            const oldCalId = found ? (found.task.shared_calendar_id || null) : null;
            if (newCalId !== oldCalId) {
                DB.supabase.from("tasks").update({
                    shared_calendar_id: newCalId
                }).eq("id", this._taskId).then(() => {
                    if (typeof loadTasksFromSupabase === "function") loadTasksFromSupabase();
                    if (typeof SharedCalendar !== "undefined") SharedCalendar.loadSharedTasks().then(() => { if (typeof renderAll === "function") renderAll(); });
                });
            }
        }

        if (typeof renderAll === "function") renderAll();
        const found2 = typeof _findTask === "function" ? _findTask(this._taskId) : null;
        if (found2) this.render(found2.task);
    },

    archive() {
        if (!this._taskId) return;
        if (typeof archiveTask === "function") archiveTask(this._taskId);
        this.close();
    },

    deleteCurrent() {
        if (!this._taskId) return;
        const id = this._taskId;
        const found = typeof _findTask === "function" ? _findTask(id) : null;
        // If recurring, show dialog (don't close panel yet)
        if (found && found.task && found.task.recurrence) {
            if (typeof deleteTask === "function") deleteTask(id);
            return; // dialog will handle close
        }
        // Non-recurring
        if (typeof deleteTask === "function") deleteTask(id);
        this.close();
    },

    // --- Reminder management ---
    renderReminders(task) {
        const list = document.getElementById("dp-reminder-list");
        if (!list) return;
        list.innerHTML = "";
        const reminders = (task && task.reminders) || [];
        const units = ["minutes", "hours", "days"];

        reminders.forEach((r, i) => {
            const item = document.createElement("div");
            item.className = "dp-reminder-item";
            item.addEventListener("click", (e) => e.stopPropagation());

            const beforeInput = document.createElement("input");
            beforeInput.type = "number"; beforeInput.min = "1"; beforeInput.max = "9999";
            beforeInput.className = "dp-reminder-before"; beforeInput.value = r.before || 10;
            beforeInput.addEventListener("change", () => {
                const t = this._getTask(); if (!t) return;
                t.reminders[i].before = parseInt(beforeInput.value) || 10;
                this._saveReminders(t);
            });

            const unitSel = document.createElement("select");
            unitSel.className = "dp-reminder-unit";
            units.forEach(u => {
                const o = document.createElement("option"); o.value = u; o.textContent = u;
                if (u === r.unit) o.selected = true;
                unitSel.appendChild(o);
            });
            unitSel.addEventListener("change", () => {
                const t = this._getTask(); if (!t) return;
                t.reminders[i].unit = unitSel.value;
                this._saveReminders(t);
            });

            const label = document.createElement("span");
            label.style.cssText = "font-size:0.75rem;color:var(--text-faint);";
            label.textContent = "before due";

            const del = document.createElement("button");
            del.className = "dp-reminder-del"; del.textContent = "✕";
            del.addEventListener("click", (e) => {
                e.stopPropagation();
                const t = this._getTask(); if (!t) return;
                t.reminders.splice(i, 1);
                this._saveReminders(t);
            });

            item.appendChild(beforeInput); item.appendChild(unitSel); item.appendChild(label); item.appendChild(del);
            list.appendChild(item);
        });
    },

    _saveReminders(task) {
        if (typeof updateTask === "function") {
            updateTask(this._taskId, { reminders: task.reminders });
        }
        this.renderReminders(task);
        if (typeof _scheduleTaskReminders === "function") _scheduleTaskReminders();
    },

    // --- Subtask management ---
    _getTask() {
        // Search both personal and shared tasks
        const found = typeof _findTask === "function" ? _findTask(this._taskId) : null;
        return found ? found.task : tasks.find(t => t.id === this._taskId);
    },

    renderSubtasks() {
        const task = this._getTask();
        const list = document.getElementById("dp-subtask-list");
        if (!list) return;
        list.innerHTML = "";
        const subs = (task && task.subtasks) || [];
        const taskDueDate = task ? (task.dueDate || "") : "";
        const today = typeof formatDateKey === "function" ? formatDateKey(new Date()) : new Date().toISOString().split("T")[0];

        for (let i = 0; i < subs.length; i++) {
            const sub = subs[i];
            const isSubOverdue = !sub.completed && sub.dueDate && sub.dueDate < today;
            const item = document.createElement("div");
            item.className = "dp-subtask-item" + (sub.completed ? " done" : "") + (isSubOverdue ? " overdue" : "");
            item.addEventListener("click", (e) => e.stopPropagation());

            const cb = document.createElement("input");
            cb.type = "checkbox"; cb.checked = !!sub.completed;
            cb.addEventListener("change", (e) => {
                e.stopPropagation();
                const currentTask = this._getTask();
                if (!currentTask || !currentTask.subtasks[i]) return;
                currentTask.subtasks[i].completed = cb.checked;
                this._saveSubtasks();
            });

            const text = document.createElement("span");
            text.className = "dp-subtask-text"; text.textContent = sub.text;
            text.title = "Click to edit";
            text.style.cursor = "text";
            text.addEventListener("click", (e) => {
                e.stopPropagation();
                const input = document.createElement("input");
                input.type = "text"; input.value = sub.text;
                input.style.cssText = "flex:1;padding:2px 4px;border:1px solid var(--accent);border-radius:4px;font-size:0.85rem;background:var(--surface);color:var(--text2);outline:none;";
                item.replaceChild(input, text);
                input.focus(); input.select();
                const save = () => {
                    const newText = input.value.trim();
                    if (newText && newText !== sub.text) {
                        const currentTask = this._getTask();
                        if (currentTask && currentTask.subtasks[i]) {
                            currentTask.subtasks[i].text = newText;
                            this._saveSubtasks();
                        }
                    } else {
                        item.replaceChild(text, input);
                    }
                };
                input.addEventListener("keydown", (e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") save();
                    if (e.key === "Escape") item.replaceChild(text, input);
                });
                input.addEventListener("blur", save);
                input.addEventListener("click", (e) => e.stopPropagation());
            });

            // Date picker for subtask — use index to avoid stale closure
            const datePicker = document.createElement("input");
            datePicker.type = "date"; datePicker.className = "dp-subtask-date";
            datePicker.value = sub.dueDate || "";
            datePicker.max = taskDueDate;
            datePicker.title = "Subtask due date";
            const subIndex = i;
            datePicker.addEventListener("change", (e) => {
                e.stopPropagation();
                const currentTask = this._getTask();
                if (!currentTask || !currentTask.subtasks[subIndex]) return;
                currentTask.subtasks[subIndex].dueDate = datePicker.value || null;
                this._saveSubtasks();
            });

            const del = document.createElement("button");
            del.className = "dp-subtask-del"; del.textContent = "✕";
            del.addEventListener("click", (e) => {
                e.stopPropagation();
                const currentTask = this._getTask();
                if (!currentTask) return;
                currentTask.subtasks.splice(i, 1);
                this._saveSubtasks();
            });

            // Put date before text so picker opens to the right (within panel)
            item.appendChild(cb); item.appendChild(datePicker); item.appendChild(text); item.appendChild(del);
            list.appendChild(item);
        }

        // Auto-complete toggle
        const autoEl = document.getElementById("dp-auto-complete");
        if (autoEl) {
            autoEl.checked = !!(task && task.auto_complete);
            autoEl.disabled = subs.length === 0;
            autoEl.parentElement.style.opacity = subs.length === 0 ? "0.4" : "1";
        }
    },

    addSubtask(text) {
        const trimmed = text.trim();
        if (!trimmed) return;
        const task = this._getTask();
        if (!task) return;
        if (!task.subtasks) task.subtasks = [];
        const todayDate = typeof formatDateKey === "function" ? formatDateKey(new Date()) : new Date().toISOString().split("T")[0];
        task.subtasks.push({ text: trimmed, completed: false, dueDate: todayDate });
        // Auto-enable auto_complete when first subtask added
        if (task.subtasks.length === 1 && !task.auto_complete) {
            task.auto_complete = true;
        }
        this._saveSubtasks();
    },

    _saveSubtasks() {
        const task = this._getTask();
        if (!task) return;
        // Auto-complete/uncomplete main task based on subtask state
        if (task.auto_complete && task.subtasks && task.subtasks.length > 0) {
            const allDone = task.subtasks.every(s => s.completed);
            if (allDone && !task.completed) {
                if (typeof toggleTask === "function") toggleTask(this._taskId);
            } else if (!allDone && task.completed) {
                if (typeof toggleTask === "function") toggleTask(this._taskId);
            }
        }
        if (typeof updateTask === "function") {
            updateTask(this._taskId, { subtasks: task.subtasks });
        }
        this.renderSubtasks();
        if (typeof renderAll === "function") renderAll();
    },

    init() {
        document.getElementById("dp-close").addEventListener("click", () => this.close());
        document.getElementById("dp-allday").addEventListener("change", (e) => {
            document.getElementById("dp-time").style.display = e.target.checked ? "none" : "";
            if (e.target.checked) document.getElementById("dp-time").value = "";
            this._updateSaveBtn();
        });

        // Change detection on all fields
        for (const id of ["dp-title", "dp-desc", "dp-date", "dp-time"]) {
            document.getElementById(id).addEventListener("input", () => this._updateSaveBtn());
        }
        document.getElementById("dp-category").addEventListener("change", () => this._updateSaveBtn());
        if (document.getElementById("dp-show-daily")) {
            document.getElementById("dp-show-daily").addEventListener("change", () => this._updateSaveBtn());
        }
        if (document.getElementById("dp-add-reminder-btn")) {
            document.getElementById("dp-add-reminder-btn").addEventListener("click", (e) => {
                e.stopPropagation();
                const task = this._getTask(); if (!task) return;
                if (!task.reminders) task.reminders = [];
                task.reminders.push({ before: 10, unit: "minutes" });
                this._saveReminders(task);
            });
        }
        if (document.getElementById("dp-recurrence")) {
            document.getElementById("dp-recurrence").addEventListener("change", () => {
                this._updateSaveBtn();
                const hasRec = !!document.getElementById("dp-recurrence").value;
                // Toggle dueDate vs start/end
                document.getElementById("dp-date").style.display = hasRec ? "none" : "";
                const recStart = document.getElementById("dp-rec-start");
                const recEnd = document.getElementById("dp-rec-end");
                if (recStart) {
                    recStart.style.display = hasRec ? "" : "none";
                    if (hasRec && !recStart.value) {
                        const today = new Date();
                        recStart.value = today.getFullYear() + "-" + String(today.getMonth()+1).padStart(2,"0") + "-" + String(today.getDate()).padStart(2,"0");
                    }
                }
                if (recEnd) recEnd.style.display = hasRec ? "" : "none";
                this._updateSaveBtn();
            });
            if (document.getElementById("dp-rec-start"))
                document.getElementById("dp-rec-start").addEventListener("change", () => this._updateSaveBtn());
            if (document.getElementById("dp-rec-end"))
                document.getElementById("dp-rec-end").addEventListener("change", () => this._updateSaveBtn());
        }

        // Subtask add
        document.getElementById("dp-subtask-input").addEventListener("click", (e) => e.stopPropagation());
        document.getElementById("dp-subtask-input").addEventListener("mousedown", (e) => e.stopPropagation());
        document.getElementById("dp-subtask-input").addEventListener("mouseup", (e) => e.stopPropagation());
        document.getElementById("dp-subtask-add-btn").addEventListener("click", (e) => { e.stopPropagation();
            const input = document.getElementById("dp-subtask-input");
            this.addSubtask(input.value);
            input.value = ""; input.focus();
        });
        document.getElementById("dp-subtask-input").addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                this.addSubtask(e.target.value);
                e.target.value = "";
            }
        });
        document.getElementById("dp-save").addEventListener("click", () => {
            this.save();
            this._takeSnapshot();
            this._updateSaveBtn();
        });
        document.getElementById("dp-archive").addEventListener("click", () => this.archive());
        document.getElementById("dp-delete").addEventListener("click", () => this.deleteCurrent());

        // Click outside panel to close
        document.addEventListener("click", (e) => {
            if (!this._isOpen) return;
            const panel = document.getElementById("detail-panel");
            // Ignore clicks inside panel, on task items, or on add buttons
            if (panel.contains(e.target)) return;
            if (e.target.closest(".task-item, .cal-task-chip, .cal-time-block, #add-btn, #add-detail-btn")) return;
            this.close();
        });

        // Close panel on window resize to mobile
        window.addEventListener("resize", () => {
            if (this._isOpen && this.isMobile()) this.close();
        });
    },
};
