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
            document.getElementById("dp-allday").checked !== s.allday
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

        // Populate calendar select
        const calSel = document.getElementById("dp-calendar");
        if (calSel) {
            calSel.innerHTML = '<option value="">Personal</option>';
            if (typeof SharedCalendar !== "undefined") {
                for (const cal of SharedCalendar.calendars) {
                    const o = document.createElement("option");
                    o.value = cal.id; o.textContent = cal.name;
                    if (cal.id === task.shared_calendar_id) o.selected = true;
                    calSel.appendChild(o);
                }
            }
        }
    },

    save() {
        if (!this._taskId) return;
        const newCalId = document.getElementById("dp-calendar") ? document.getElementById("dp-calendar").value : "";
        const data = {
            text: document.getElementById("dp-title").value,
            description: document.getElementById("dp-desc").value,
            category: document.getElementById("dp-category").value,
            dueDate: document.getElementById("dp-date").value,
            dueTime: document.getElementById("dp-allday").checked ? "" : document.getElementById("dp-time").value,
        };

        // Handle calendar change (Personal ↔ Shared)
        const task = tasks.find(t => t.id === this._taskId);
        const oldCalId = task ? task.shared_calendar_id : null;
        if (newCalId !== (oldCalId || "")) {
            data.shared_calendar_id = newCalId || null;
            // If moving to Supabase shared, need to update shared_calendar_id in DB
            if (typeof _useSupabase === "function" && _useSupabase()) {
                DB.supabase.from("tasks").update({
                    shared_calendar_id: newCalId || null
                }).eq("id", this._taskId).then(() => {
                    if (typeof loadTasksFromSupabase === "function") loadTasksFromSupabase();
                    if (typeof SharedCalendar !== "undefined") SharedCalendar.loadSharedTasks().then(() => { if (typeof renderAll === "function") renderAll(); });
                });
            }
        }

        if (typeof updateTask === "function" && updateTask(this._taskId, data)) {
            if (typeof renderAll === "function") renderAll();
            // Re-render panel with updated task
            const t = tasks.find(t => t.id === this._taskId);
            if (t) this.render(t);
        }
    },

    archive() {
        if (!this._taskId) return;
        if (typeof archiveTask === "function") archiveTask(this._taskId);
        this.close();
    },

    deleteCurrent() {
        if (!this._taskId) return;
        if (confirm("Delete this task permanently?")) {
            if (typeof deleteTask === "function") deleteTask(this._taskId);
            this.close();
        }
    },

    // --- Subtask management ---
    _getTask() {
        return tasks.find(t => t.id === this._taskId);
    },

    renderSubtasks() {
        const task = this._getTask();
        const list = document.getElementById("dp-subtask-list");
        if (!list) return;
        list.innerHTML = "";
        const subs = (task && task.subtasks) || [];

        for (let i = 0; i < subs.length; i++) {
            const sub = subs[i];
            const item = document.createElement("div");
            item.className = "dp-subtask-item" + (sub.completed ? " done" : "");

            const cb = document.createElement("input");
            cb.type = "checkbox"; cb.checked = !!sub.completed;
            cb.addEventListener("change", () => {
                sub.completed = cb.checked;
                this._saveSubtasks();
            });

            const text = document.createElement("span");
            text.className = "dp-subtask-text"; text.textContent = sub.text;

            const del = document.createElement("button");
            del.className = "dp-subtask-del"; del.textContent = "✕";
            del.addEventListener("click", () => {
                subs.splice(i, 1);
                this._saveSubtasks();
            });

            item.appendChild(cb); item.appendChild(text); item.appendChild(del);
            list.appendChild(item);
        }
    },

    addSubtask(text) {
        const trimmed = text.trim();
        if (!trimmed) return;
        const task = this._getTask();
        if (!task) return;
        if (!task.subtasks) task.subtasks = [];
        task.subtasks.push({ text: trimmed, completed: false });
        this._saveSubtasks();
    },

    _saveSubtasks() {
        const task = this._getTask();
        if (!task) return;
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

        // Subtask add
        document.getElementById("dp-subtask-add-btn").addEventListener("click", () => {
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
