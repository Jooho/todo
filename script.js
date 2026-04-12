// Created: 2026-04-05 19:30
// Updated: 2026-04-05 23:00 — Session 1: dynamic categories, task detail modal, default date

// ============================================================
// Section 1: Constants & State
// ============================================================
const STORAGE_KEY = "my-tasks-data";
const FILTER_KEY = "my-tasks-filter";
const THEME_KEY = "my-tasks-theme";
const SETTINGS_KEY = "my-tasks-settings";
const CATEGORIES_KEY = "my-tasks-categories";
const ARCHIVE_KEY = "my-tasks-archive";

// Design Ref: §3.3 — Dynamic categories loaded from localStorage
const DEFAULT_CATEGORIES = [
    { id: "work", label: "Work", color: "#4A90E2" },
    { id: "personal", label: "Personal", color: "#27AE60" },
    { id: "study", label: "Study", color: "#8E44AD" },
];

// Dynamic categories — loaded at init
let categories = [];

function loadCategories() {
    try { const r = localStorage.getItem(CATEGORIES_KEY); if (r) return JSON.parse(r); } catch(_) {}
    return [...DEFAULT_CATEGORIES];
}
function saveCategories() { localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories)); }

// Returns { id: { label, color } } map for quick lookup
function getCategoryMap() {
    const m = {};
    for (const c of categories) m[c.id] = { label: c.label, color: c.color };
    return m;
}

// Get category info with fallback
function getCat(id) {
    const map = getCategoryMap();
    return map[id] || { label: id, color: "#888888" };
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = ["January","February","March","April","May","June",
                     "July","August","September","October","November","December"];

let tasks = [];
let activeFilter = "all";
let searchQuery = "";
let settings = { activeView: "list", calendarMode: "month", calendarDate: null };

// ============================================================
// Section 2: Storage
// ============================================================
function loadTasks() {
    try { const r = localStorage.getItem(STORAGE_KEY); if (r) return JSON.parse(r); } catch(_) {}
    return [];
}
function saveTasks() { if (!_useSupabase()) localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks)); }

function loadFilter() { return localStorage.getItem(FILTER_KEY) || "all"; }
function saveFilter() { localStorage.setItem(FILTER_KEY, activeFilter); }

function loadTheme() { return localStorage.getItem(THEME_KEY) || "light"; }
function saveTheme(t) { localStorage.setItem(THEME_KEY, t); }

function loadSettings() {
    try { const r = localStorage.getItem(SETTINGS_KEY); if (r) return JSON.parse(r); } catch(_) {}
    return { activeView: "list", calendarMode: "month", calendarDate: null };
}
function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }

function applyTheme(theme) {
    document.body.classList.toggle("dark", theme === "dark");
    const icon = document.getElementById("theme-icon");
    if (icon) icon.innerHTML = theme === "dark" ? "&#9788;" : "&#9790;";
    saveTheme(theme);
}
function toggleTheme() {
    const next = document.body.classList.contains("dark") ? "light" : "dark";
    applyTheme(next);
    showToast(next === "dark" ? "Dark mode on" : "Light mode on");
}

// ============================================================
// Section 3: Task CRUD — Supabase first, localStorage fallback
// ============================================================
function _useSupabase() { return DB.supabase && DB.isConnected && Auth.getUserId(); }

async function loadTasksFromSupabase() {
    if (!_useSupabase()) return;
    try {
        const { data, error } = await DB.supabase
            .from("tasks").select("*")
            .eq("user_id", Auth.getUserId())
            .eq("archived", false)
            .is("shared_calendar_id", null)
            .order("created_at", { ascending: true });
        if (error) { console.error("Load tasks error:", error); return; }
        tasks = (data || []).map(row => DB._rowToTask(row));
        renderAll();
    } catch (e) { console.error("Load tasks exception:", e); }
}

function addTask(text, category, dueDate, dueTime, description, sharedCalendarId, recurrence, recurrenceParentId) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const now = new Date().toISOString();
    const task = {
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
        text: trimmed,
        description: description || "",
        completed: false,
        category: category || "work",
        createdAt: now,
        updatedAt: now,
        dueDate: dueDate || formatDateKey(new Date()),
        dueTime: dueTime || null,
        shared_calendar_id: sharedCalendarId || null,
        recurrence: recurrence || null,
        recurrence_parent_id: recurrenceParentId || null,
    };

    if (_useSupabase()) {
        const row = DB._taskToRow(task);
        if (sharedCalendarId) row.shared_calendar_id = sharedCalendarId;
        DB.supabase.from("tasks").insert(row).then(({ error }) => {
            if (error) { showToast("Save failed: " + error.message); return; }
            showToast("Task added");
            // Reload from DB to stay in sync
            if (sharedCalendarId && typeof SharedCalendar !== "undefined") {
                SharedCalendar.loadSharedTasks().then(() => renderAll());
            } else {
                loadTasksFromSupabase();
            }
        });
    } else {
        tasks.push(task);
        saveTasks();
        renderAll();
        showToast("Task added");
    }
}

// Find task in personal or shared lists
function _findTask(id) {
    const t = tasks.find(t => t.id === id);
    if (t) return { task: t, isShared: false };
    if (typeof SharedCalendar !== "undefined") {
        const s = SharedCalendar._sharedTasks.find(t => t.id === id);
        if (s) return { task: s, isShared: true };
    }
    return null;
}

function _reloadSharedTasks() {
    if (typeof SharedCalendar !== "undefined") {
        SharedCalendar.loadSharedTasks().then(() => renderAll());
    }
}

function deleteTask(id) {
    const found = _findTask(id);
    const task = found ? found.task : null;

    // If part of recurring series (parent or child), show options
    if (task && (task.recurrence || task.recurrence_parent_id)) {
        _showRecurringDeleteDialog(task);
        return;
    }

    // Non-recurring: confirm then delete
    if (confirm("Delete this task permanently?")) {
        _doDeleteTasks([id]);
    }
}

function _doDeleteTasks(ids) {
    const idSet = new Set(ids);
    tasks = tasks.filter(t => !idSet.has(t.id));
    if (typeof SharedCalendar !== "undefined") {
        SharedCalendar._sharedTasks = SharedCalendar._sharedTasks.filter(t => !idSet.has(t.id));
    }
    renderAll();

    if (_useSupabase()) {
        DB.supabase.from("tasks").delete().in("id", ids).then(({ error }) => {
            if (error) showToast("Delete failed: " + error.message);
        });
    } else {
        saveTasks();
    }
}

function _getRecurringSeries(task) {
    const all = getAllTasks();
    const parentId = task.recurrence ? task.id : task.recurrence_parent_id;

    // First try: match by recurrence_parent_id
    if (parentId) {
        const byId = all.filter(t => t.id === parentId || t.recurrence_parent_id === parentId);
        if (byId.length > 1) return byId;
    }

    // Fallback: match by text + shared_calendar_id (for legacy tasks without parent_id)
    return all.filter(t =>
        t.text === task.text &&
        (t.shared_calendar_id || "") === (task.shared_calendar_id || "") &&
        (t.recurrence || t.recurrence_parent_id || (t.dueDate && task.recurrence))
    );
}

function _showRecurringDeleteDialog(task) {
    const existing = document.getElementById("rec-delete-overlay");
    if (existing) existing.remove();

    const series = _getRecurringSeries(task);
    const taskDate = task.dueDate || "";
    const futureInSeries = series.filter(t => (t.dueDate || "") >= taskDate && t.id !== task.id);
    const pastInSeries = series.filter(t => (t.dueDate || "") < taskDate);

    const overlay = document.createElement("div");
    overlay.id = "rec-delete-overlay";
    overlay.className = "popup-overlay";
    overlay.style.cssText = "display:flex;align-items:center;justify-content:center;z-index:200;";

    const dialog = document.createElement("div");
    dialog.style.cssText = "background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;max-width:360px;width:90%;box-shadow:0 8px 30px rgba(0,0,0,0.3);";

    const title = document.createElement("h3");
    title.style.cssText = "font-size:1rem;color:var(--text);margin:0 0 12px;";
    title.textContent = "Delete recurring task";

    const hint = document.createElement("div");
    hint.style.cssText = "font-size:0.82rem;color:var(--text-faint);margin-bottom:16px;";
    hint.textContent = `"${task.text}" — ${series.length} tasks in series`;

    dialog.appendChild(title);
    dialog.appendChild(hint);

    const options = [
        { label: "This task only", desc: "Delete just this one", ids: [task.id] },
        { label: "This and all future", desc: `Delete this + ${futureInSeries.length} future`, ids: [task.id, ...futureInSeries.map(t => t.id)] },
        { label: "All in series", desc: `Delete all ${series.length} tasks`, ids: series.map(t => t.id) },
    ];

    for (const opt of options) {
        const btn = document.createElement("button");
        btn.style.cssText = "display:block;width:100%;padding:10px 14px;margin-bottom:6px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text2);font-size:0.85rem;cursor:pointer;text-align:left;";
        btn.innerHTML = `<strong>${opt.label}</strong><br><span style="font-size:0.75rem;color:var(--text-faint);">${opt.desc}</span>`;
        btn.addEventListener("mouseenter", () => { btn.style.borderColor = "var(--danger)"; btn.style.color = "var(--danger)"; });
        btn.addEventListener("mouseleave", () => { btn.style.borderColor = "var(--border)"; btn.style.color = "var(--text2)"; });
        btn.addEventListener("click", () => {
            _doDeleteTasks(opt.ids);
            overlay.remove();
            showToast(`${opt.ids.length} task(s) deleted`);
            if (typeof DetailPanel !== "undefined") DetailPanel.close();
        });
        dialog.appendChild(btn);
    }

    const cancelBtn = document.createElement("button");
    cancelBtn.style.cssText = "display:block;width:100%;padding:10px;border:none;border-radius:8px;background:var(--surface3);color:var(--text-muted);font-size:0.85rem;cursor:pointer;margin-top:4px;";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => overlay.remove());
    dialog.appendChild(cancelBtn);

    overlay.appendChild(dialog);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
}

function toggleTask(id) {
    const found = _findTask(id);
    if (!found) return;
    const t = found.task;
    t.completed = !t.completed;

    if (_useSupabase()) {
        DB.supabase.from("tasks").update({
            completed: t.completed, updated_at: new Date().toISOString()
        }).eq("id", id).then(({ error }) => {
            if (error) showToast("Update failed: " + error.message);
            // Recurring task: no auto-create on complete (batch created on save)
            if (found.isShared) _reloadSharedTasks();
            else renderAll();
        });
    } else {
        saveTasks();
        renderAll();
    }
}

function _getNextDate(dateStr, recurrence) {
    const d = new Date(dateStr + "T00:00:00");
    const interval = recurrence.interval || 1;
    switch (recurrence.type) {
        case "daily": d.setDate(d.getDate() + interval); break;
        case "weekly": d.setDate(d.getDate() + 7 * interval); break;
        case "monthly": d.setMonth(d.getMonth() + interval); break;
        case "yearly": d.setFullYear(d.getFullYear() + interval); break;
    }
    return formatDateKey(d);
}

// Default: generate up to 3 months ahead when no end date
const RECURRENCE_MAX_MONTHS = 3;

function _generateRecurringTasks(task) {
    if (!task.recurrence) return;
    const rec = task.recurrence;
    const startDate = rec.startDate || task.dueDate || formatDateKey(new Date());
    // End date: use explicit endDate or default 3 months from start
    const maxDate = rec.endDate || (() => {
        const d = new Date(startDate + "T00:00:00");
        d.setMonth(d.getMonth() + RECURRENCE_MAX_MONTHS);
        return formatDateKey(d);
    })();

    let count = 0;
    let currentDate = startDate;

    // Check existing tasks to avoid duplicates
    const allTasks = getAllTasks();
    const existingDates = new Set(
        allTasks.filter(t => t.text === task.text && t.shared_calendar_id === task.shared_calendar_id)
            .map(t => t.dueDate)
    );

    const tasksToCreate = [];
    for (let i = 0; i < 365; i++) { // safety cap
        const nextDate = i === 0 ? currentDate : _getNextDate(currentDate, rec);
        currentDate = nextDate;

        if (nextDate > maxDate) break;
        if (existingDates.has(nextDate)) continue;

        tasksToCreate.push(nextDate);
        count++;
    }

    for (const date of tasksToCreate) {
        // Child tasks: no recurrence, linked to parent via recurrence_parent_id
        addTask(task.text, task.category, date, task.dueTime, task.description, task.shared_calendar_id || "", null, task.id);
    }

    if (count > 0) showToast(`${count} ${rec.type} tasks created`);
}

function _handleRecurrenceChange(task, newRecurrence, oldRecurrence) {
    const oldRec = oldRecurrence || null;
    const oldType = oldRec ? oldRec.type : null;
    const newType = newRecurrence ? newRecurrence.type : null;

    // No change at all
    if (oldType === newType && JSON.stringify(oldRec) === JSON.stringify(newRecurrence)) return;

    const today = formatDateKey(new Date());

    // If had old recurrence, delete future tasks in old series
    if (oldRec) {
        // Temporarily set old recurrence to find old series
        const savedRec = task.recurrence;
        task.recurrence = oldRec;
        const series = _getRecurringSeries(task);
        task.recurrence = savedRec;
        const futureIds = series
            .filter(t => t.id !== task.id && (t.dueDate || "") >= today)
            .map(t => t.id);
        if (futureIds.length > 0) {
            _doDeleteTasks(futureIds);
            showToast(`${futureIds.length} old recurring tasks removed`);
        }
    }

    // If new recurrence set, apply to task then generate new series
    if (newRecurrence) {
        task.recurrence = newRecurrence;
        setTimeout(() => {
            _generateRecurringTasks(task);
        }, 500);
    }
}

function updateTask(id, data) {
    const found = _findTask(id);
    if (!found) return false;
    const t = found.task;
    if (data.text !== undefined) { const s = data.text.trim(); if (!s) return false; t.text = s; }
    if (data.category !== undefined) t.category = data.category;
    if (data.dueDate !== undefined) t.dueDate = data.dueDate || null;
    if (data.dueTime !== undefined) t.dueTime = data.dueTime || null;
    if (data.description !== undefined) t.description = data.description;
    if (data.subtasks !== undefined) t.subtasks = data.subtasks;
    if (data.recurrence !== undefined) t.recurrence = data.recurrence;
    t.updatedAt = new Date().toISOString();

    if (_useSupabase()) {
        const row = DB._taskToRow(t);
        DB.supabase.from("tasks").update(row).eq("id", id).then(({ error }) => {
            if (error) showToast("Update failed: " + error.message);
            if (found.isShared) _reloadSharedTasks();
        });
    } else {
        saveTasks();
    }
    showToast("Task updated");
    return true;
}

function clearCompleted() {
    // Use filtered list (respects search + category filter)
    const filtered = getFilteredTasks();
    const completed = filtered.filter(t => t.completed);
    if (!completed.length) return;

    _showClearCompletedModal(completed);
}

function _showClearCompletedModal(completedTasks) {
    // Remove existing modal
    const existing = document.getElementById("clear-modal-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "clear-modal-overlay";
    overlay.className = "popup-overlay";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.zIndex = "200";

    const modal = document.createElement("div");
    modal.style.cssText = "background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;max-width:420px;width:90%;max-height:70vh;display:flex;flex-direction:column;gap:12px;box-shadow:0 8px 30px rgba(0,0,0,0.3);";

    const title = document.createElement("h3");
    title.textContent = `${completedTasks.length} completed task(s)`;
    title.style.cssText = "font-size:1rem;color:var(--text);margin:0;";
    modal.appendChild(title);

    const hint = document.createElement("div");
    hint.textContent = "Select action for each task, or use buttons below for all.";
    hint.style.cssText = "font-size:0.8rem;color:var(--text-faint);";
    modal.appendChild(hint);

    const listEl = document.createElement("div");
    listEl.style.cssText = "overflow-y:auto;max-height:40vh;display:flex;flex-direction:column;gap:4px;";

    const taskActions = []; // { id, action }

    for (const task of completedTasks) {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;background:var(--surface2);";

        const cat = getCat(task.category);
        const dot = document.createElement("span");
        dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${cat.color};flex-shrink:0;`;

        const text = document.createElement("span");
        text.style.cssText = "flex:1;font-size:0.85rem;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
        text.textContent = task.text;

        const select = document.createElement("select");
        select.style.cssText = "padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:0.75rem;background:var(--surface);color:var(--text2);";
        select.innerHTML = '<option value="archive">Archive</option><option value="delete">Delete</option><option value="skip">Skip</option>';

        const entry = { id: task.id, action: "archive" };
        taskActions.push(entry);
        select.addEventListener("change", () => { entry.action = select.value; });

        row.appendChild(dot);
        row.appendChild(text);
        row.appendChild(select);
        listEl.appendChild(row);
    }
    modal.appendChild(listEl);

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:8px;";

    const archiveAllBtn = document.createElement("button");
    archiveAllBtn.textContent = "Archive All";
    archiveAllBtn.style.cssText = "flex:1;padding:10px;border:none;border-radius:8px;background:var(--surface3);color:var(--text2);cursor:pointer;font-weight:600;";
    archiveAllBtn.addEventListener("click", () => {
        taskActions.forEach(e => e.action = "archive");
        _executeClearActions(taskActions);
        overlay.remove();
    });

    const deleteAllBtn = document.createElement("button");
    deleteAllBtn.textContent = "Delete All";
    deleteAllBtn.style.cssText = "flex:1;padding:10px;border:none;border-radius:8px;background:var(--danger-bg);color:var(--danger);cursor:pointer;font-weight:600;";
    deleteAllBtn.addEventListener("click", () => {
        taskActions.forEach(e => e.action = "delete");
        _executeClearActions(taskActions);
        overlay.remove();
    });

    const applyBtn = document.createElement("button");
    applyBtn.textContent = "Apply";
    applyBtn.style.cssText = "flex:1;padding:10px;border:none;border-radius:8px;background:var(--accent);color:#fff;cursor:pointer;font-weight:600;";
    applyBtn.addEventListener("click", () => {
        _executeClearActions(taskActions);
        overlay.remove();
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.style.cssText = "padding:10px 16px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text2);cursor:pointer;";
    cancelBtn.addEventListener("click", () => overlay.remove());

    btnRow.appendChild(archiveAllBtn);
    btnRow.appendChild(deleteAllBtn);
    btnRow.appendChild(applyBtn);
    btnRow.appendChild(cancelBtn);
    modal.appendChild(btnRow);

    overlay.appendChild(modal);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
}

function _showOverdueModal(overdueTasks) {
    const existing = document.getElementById("clear-modal-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "clear-modal-overlay";
    overlay.className = "popup-overlay";
    overlay.style.cssText = "display:flex;align-items:center;justify-content:center;z-index:200;";

    const modal = document.createElement("div");
    modal.style.cssText = "background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;max-width:460px;width:92%;max-height:80vh;display:flex;flex-direction:column;gap:12px;box-shadow:0 8px 30px rgba(0,0,0,0.3);";

    const title = document.createElement("h3");
    title.style.cssText = "font-size:1rem;color:var(--danger);margin:0;";
    title.textContent = `${overdueTasks.length} overdue task(s)`;
    modal.appendChild(title);

    // Reschedule date picker
    const rescheduleRow = document.createElement("div");
    rescheduleRow.style.cssText = "display:flex;align-items:center;gap:8px;";
    const rescheduleLabel = document.createElement("label");
    rescheduleLabel.style.cssText = "font-size:0.82rem;color:var(--text2);white-space:nowrap;";
    rescheduleLabel.textContent = "Reschedule to:";
    const datePicker = document.createElement("input");
    datePicker.type = "date"; datePicker.value = formatDateKey(new Date());
    datePicker.style.cssText = "padding:6px 8px;border:1px solid var(--border);border-radius:8px;font-size:0.82rem;background:var(--surface);color:var(--text2);flex:1;";
    rescheduleRow.appendChild(rescheduleLabel);
    rescheduleRow.appendChild(datePicker);
    modal.appendChild(rescheduleRow);

    // Task list
    const listEl = document.createElement("div");
    listEl.style.cssText = "overflow-y:auto;max-height:35vh;display:flex;flex-direction:column;gap:4px;";
    const taskActions = [];
    for (const task of overdueTasks) {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;background:var(--surface2);";
        const cat = getCat(task.category);
        const dot = document.createElement("span");
        dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${safeColor(cat.color)};flex-shrink:0;`;
        const text = document.createElement("span");
        text.style.cssText = "flex:1;font-size:0.82rem;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
        text.textContent = task.text;
        const dateSpan = document.createElement("span");
        dateSpan.style.cssText = "font-size:0.7rem;color:var(--danger);flex-shrink:0;";
        dateSpan.textContent = task.dueDate;
        const select = document.createElement("select");
        select.style.cssText = "padding:3px 6px;border:1px solid var(--border);border-radius:4px;font-size:0.72rem;background:var(--surface);color:var(--text2);";
        select.innerHTML = '<option value="reschedule">Reschedule</option><option value="archive">Archive</option><option value="delete">Delete</option><option value="skip">Skip</option>';
        const entry = { id: task.id, action: "reschedule" };
        taskActions.push(entry);
        select.addEventListener("change", () => { entry.action = select.value; });
        row.appendChild(dot); row.appendChild(text); row.appendChild(dateSpan); row.appendChild(select);
        listEl.appendChild(row);
    }
    modal.appendChild(listEl);

    // Bulk buttons
    const bulkRow = document.createElement("div");
    bulkRow.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;";
    const mkBtn = (label, style, fn) => {
        const b = document.createElement("button");
        b.textContent = label; b.style.cssText = `flex:1;padding:8px;border:none;border-radius:8px;cursor:pointer;font-weight:600;font-size:0.8rem;${style}`;
        b.addEventListener("click", fn); return b;
    };
    bulkRow.appendChild(mkBtn("Reschedule All", "background:var(--accent);color:#fff;", () => {
        taskActions.forEach(e => e.action = "reschedule");
        _executeClearActions(taskActions, datePicker.value); overlay.remove();
    }));
    bulkRow.appendChild(mkBtn("Archive All", "background:var(--surface3);color:var(--text2);", () => {
        taskActions.forEach(e => e.action = "archive");
        _executeClearActions(taskActions, datePicker.value); overlay.remove();
    }));
    bulkRow.appendChild(mkBtn("Delete All", "background:var(--danger-bg);color:var(--danger);", () => {
        taskActions.forEach(e => e.action = "delete");
        _executeClearActions(taskActions, datePicker.value); overlay.remove();
    }));
    modal.appendChild(bulkRow);

    const applyRow = document.createElement("div");
    applyRow.style.cssText = "display:flex;gap:8px;";
    applyRow.appendChild(mkBtn("Apply", "background:var(--accent);color:#fff;", () => {
        _executeClearActions(taskActions, datePicker.value); overlay.remove();
    }));
    applyRow.appendChild(mkBtn("Cancel", "background:var(--surface3);color:var(--text2);", () => overlay.remove()));
    modal.appendChild(applyRow);

    overlay.appendChild(modal);
    overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
}

function _executeClearActions(taskActions, rescheduleDate) {
    let archived = 0, deleted = 0, rescheduled = 0;
    const toDelete = [];

    for (const { id, action } of taskActions) {
        if (action === "archive") { archiveTask(id); archived++; }
        else if (action === "delete") { toDelete.push(id); deleted++; }
        else if (action === "reschedule" && rescheduleDate) {
            updateTask(id, { dueDate: rescheduleDate });
            rescheduled++;
        }
    }

    if (toDelete.length) {
        if (_useSupabase()) {
            DB.supabase.from("tasks").delete().in("id", toDelete).then(({ error }) => {
                if (error) showToast("Delete failed: " + error.message);
                else loadTasksFromSupabase();
            });
        } else {
            const ids = new Set(toDelete);
            tasks = tasks.filter(t => !ids.has(t.id));
            saveTasks(); renderAll();
        }
    }

    const parts = [];
    if (archived) parts.push(`${archived} archived`);
    if (deleted) parts.push(`${deleted} deleted`);
    if (rescheduled) parts.push(`${rescheduled} rescheduled to ${rescheduleDate}`);
    if (parts.length) showToast(parts.join(", "));
    renderAll(); // refresh overdue styling
}

// ============================================================
// Section 4: Helpers
// ============================================================
function getAllTasks() {
    let all = tasks.slice();
    if (typeof SharedCalendar !== "undefined" && SharedCalendar._sharedTasks.length) {
        // Add shared tasks, avoiding duplicates by id
        const ids = new Set(all.map(t => t.id));
        for (const t of SharedCalendar._sharedTasks) {
            if (!ids.has(t.id)) all.push(t);
        }
    }
    return all;
}

// Date filter: "today" | "all" | "YYYY-MM-DD"
let activeDateFilter = "today";

function getFilteredTasks() {
    let list = getAllTasks();

    // Date filter
    if (activeDateFilter === "today") {
        const today = formatDateKey(new Date());
        list = list.filter(t => (t.dueDate || "") === today);
    } else if (activeDateFilter !== "all") {
        list = list.filter(t => (t.dueDate || "") === activeDateFilter);
    }

    if (activeFilter !== "all") list = list.filter(t => t.category === activeFilter);
    if (searchQuery) { const q = searchQuery.toLowerCase(); list = list.filter(t => t.text.toLowerCase().includes(q)); }

    // Sort: newest first (by createdAt desc), completed at bottom
    return list.slice().sort((a, b) => {
        if (a.completed !== b.completed) return Number(a.completed) - Number(b.completed);
        return (b.createdAt || "") > (a.createdAt || "") ? 1 : -1;
    });
}

function getProgress(cat) {
    let list = getAllTasks();
    if (cat) list = list.filter(t => t.category === cat);
    const total = list.length, done = list.filter(t => t.completed).length;
    return { total, done, remaining: total - done, pct: total ? Math.round(done / total * 100) : 0 };
}

function getTodayCount() {
    const today = new Date().toDateString();
    return getAllTasks().filter(t => new Date(t.createdAt).toDateString() === today).length;
}

function timeAgo(iso) {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60) return "Just now";
    if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff/86400)}d ago`;
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function isDueSoon(task) {
    if (!task.dueDate || task.completed) return false;
    const due = new Date(task.dueDate + "T" + (task.dueTime || "23:59"));
    const diff = due - Date.now();
    return diff > 0 && diff < 24 * 60 * 60 * 1000;
}

function safeColor(c) { return /^#[0-9A-Fa-f]{3,8}$/.test(c) ? c : "#888888"; }

function formatDateKey(d) {
    return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
}

function escapeHtml(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

function highlightText(text) {
    if (!searchQuery) return escapeHtml(text);
    const e = escapeHtml(text), q = escapeHtml(searchQuery);
    return e.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")})`, "gi"), '<span class="highlight">$1</span>');
}

// Toast
let toastTimer = null;
// Copyable error dialog
function showErrorDialog(title, text) {
    // Remove existing
    const existing = document.getElementById("error-dialog-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "error-dialog-overlay";
    overlay.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:300;display:flex;align-items:center;justify-content:center;";

    const dialog = document.createElement("div");
    dialog.style.cssText = "background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px;max-width:500px;width:90%;max-height:60vh;display:flex;flex-direction:column;gap:12px;box-shadow:0 8px 30px rgba(0,0,0,0.3);";

    const h = document.createElement("h3");
    h.textContent = title;
    h.style.cssText = "font-size:1rem;color:var(--danger);";

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.readOnly = true;
    textarea.style.cssText = "width:100%;min-height:120px;padding:10px;border:1px solid var(--border);border-radius:8px;font-family:monospace;font-size:0.8rem;color:var(--text2);background:var(--surface2);resize:vertical;";

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:8px;";

    const copyBtn = document.createElement("button");
    copyBtn.textContent = "Copy";
    copyBtn.style.cssText = "flex:1;padding:10px;border:none;border-radius:8px;background:var(--accent);color:#fff;font-weight:600;cursor:pointer;";
    copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(text).then(() => { copyBtn.textContent = "Copied!"; setTimeout(() => copyBtn.textContent = "Copy", 1500); });
    });

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Close";
    closeBtn.style.cssText = "flex:1;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text2);cursor:pointer;";
    closeBtn.addEventListener("click", () => overlay.remove());

    btnRow.appendChild(copyBtn);
    btnRow.appendChild(closeBtn);
    dialog.appendChild(h);
    dialog.appendChild(textarea);
    dialog.appendChild(btnRow);
    overlay.appendChild(dialog);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
}

function showToast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg; el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2000);
}

// ============================================================
// Section 5: List View Rendering
// ============================================================
function renderAll() {
    renderDashboard();
    renderFilterButtons();
    renderCategorySelect();
    // Always update calendar data (even when not visible) so switching tabs is instant
    if (settings.activeView === "list") {
        renderTaskList();
        renderClearBtn();
    } else if (settings.activeView === "calendar") {
        Calendar.render();
    } else if (settings.activeView === "archive") {
        renderArchiveView();
    } else if (settings.activeView === "settings") {
        renderSettingsView();
    }
    // Pre-render calendar grid if it exists (so it's fresh when switching tabs)
    if (settings.activeView !== "calendar" && document.getElementById("cal-grid")) {
        Calendar.render();
    }
}

function renderDashboard() {
    // Progress bar — today's tasks only
    const todayTasks = _getTodayTasks();
    const allTodayTasks = getAllTasks().filter(t => t.dueDate === formatDateKey(new Date()));
    const todayDone = allTodayTasks.filter(t => t.completed).length;
    const todayTotal = allTodayTasks.length;
    const todayPct = todayTotal ? Math.round(todayDone / todayTotal * 100) : 0;

    const all = getProgress();
    document.getElementById("stats-text").textContent = `Today: ${todayDone}/${todayTotal} (${todayPct}%) · Total: ${all.done}/${all.total}`;
    document.getElementById("stats-today").textContent = `Overdue: ${_getOverdueTasks().length}`;
    document.getElementById("progress-fill").style.width = `${todayPct}%`;
    const todayRemaining = todayTasks.length;
    document.getElementById("remaining-badge").textContent = todayRemaining;
    document.getElementById("remaining-badge").title = `${todayRemaining} tasks today`;
    // Mobile progress
    const mpFill = document.getElementById("mobile-progress-fill");
    const mpText = document.getElementById("mobile-progress-text");
    if (mpFill) mpFill.style.width = `${todayPct}%`;
    if (mpText) mpText.textContent = `${todayDone}/${todayTotal} today`;

    const c = document.getElementById("dashboard-categories"); c.innerHTML = "";
    const todayKey = formatDateKey(new Date());
    for (const cat of categories) {
        const p = getProgress(cat.id);
        // Today stats for category
        const todayCatTasks = getAllTasks().filter(t => t.category === cat.id && t.dueDate === todayKey);
        const todayCatDone = todayCatTasks.filter(t => t.completed).length;
        const todayCatTotal = todayCatTasks.length;
        const todayPct = todayCatTotal ? Math.round(todayCatDone / todayCatTotal * 100) : 0;
        const el = document.createElement("div"); el.className = "cat-stat";
        el.style.cursor = "pointer";
        el.innerHTML = `<span class="cat-stat-dot" style="background:${safeColor(cat.color)}"></span>
            <div class="cat-stat-info">
              <div class="cat-stat-label">${escapeHtml(cat.label)}</div>
              <div class="cat-stat-nums">
                <span title="Today">Today ${todayCatDone}/${todayCatTotal}</span>
                <span class="cat-stat-sep">·</span>
                <span title="Total">All ${p.done}/${p.total}</span>
              </div>
            </div>
            <div class="cat-stat-bar"><div class="cat-stat-bar-fill" style="width:${todayPct}%;background:${safeColor(cat.color)}"></div></div>`;
        el.addEventListener("click", () => { activeFilter = cat.id; saveFilter(); setActiveView("list"); renderAll(); });
        c.appendChild(el);
    }
}

// renderFilters is now handled by renderFilterButtons() in Section 7

function renderTaskList() {
    // Show/hide overdue action button
    const overdueBtn = document.getElementById("overdue-action-btn");
    const overdueTasks = _getOverdueTasks();
    if (overdueBtn) {
        if (overdueTasks.length > 0) {
            overdueBtn.style.display = "";
            overdueBtn.textContent = `Handle ${overdueTasks.length} overdue`;
        } else {
            overdueBtn.style.display = "none";
        }
    }

    const list = document.getElementById("task-list"), filtered = getFilteredTasks();
    list.innerHTML = "";
    if (!filtered.length) {
        const e = document.createElement("li"); e.className = "empty-state";
        const msg = activeDateFilter === "today" ? "No tasks for today." :
            searchQuery ? `No results for "${searchQuery}"` :
            tasks.length === 0 ? "No tasks yet. Add one above!" : "No tasks in this category.";
        e.textContent = msg;
        list.appendChild(e); return;
    }
    for (const task of filtered) list.appendChild(createTaskElement(task));
}

function createTaskElement(task) {
    const cat = getCat(task.category);
    const li = document.createElement("li");
    const today = formatDateKey(new Date());
    const isOverdue = !task.completed && task.dueDate && task.dueDate < today;
    li.className = `task-item${task.completed ? " completed" : ""}${isOverdue ? " overdue" : ""}`;

    const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = task.completed;
    cb.addEventListener("change", () => { li.classList.add("completing"); setTimeout(() => toggleTask(task.id), 150); });

    const tag = document.createElement("span"); tag.className = "category-tag";
    tag.textContent = cat.label; tag.style.background = cat.color + "18"; tag.style.color = cat.color;

    const content = document.createElement("div"); content.className = "task-content";
    const textSpan = document.createElement("span"); textSpan.className = "task-text";
    textSpan.innerHTML = highlightText(task.text);

    const timeSpan = document.createElement("div"); timeSpan.className = "task-time";
    timeSpan.textContent = timeAgo(task.createdAt);

    content.appendChild(textSpan); content.appendChild(timeSpan);

    // Show due date with year
    if (task.dueDate) {
        const dueSpan = document.createElement("div");
        dueSpan.className = "task-due" + (isDueSoon(task) ? " due-soon" : "");
        const d = new Date(task.dueDate + "T00:00:00");
        const dateStr = d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", weekday: "short" });
        const recLabel = task.recurrence ? " \u{1F501} " + task.recurrence.type : (task.recurrence_parent_id ? " \u{1F501}" : "");
        dueSpan.textContent = dateStr + (task.dueTime ? " " + task.dueTime : "") + recLabel;
        content.appendChild(dueSpan);
    }

    // Show creator for shared tasks
    if (task.shared_calendar_id && typeof SharedCalendar !== "undefined") {
        const creator = SharedCalendar.getCreatorName(task.user_id);
        if (creator) {
            const creatorSpan = document.createElement("div");
            creatorSpan.className = "task-creator";
            creatorSpan.textContent = "by " + creator;
            content.appendChild(creatorSpan);
        }
    }

    // Show subtask progress
    let subs = task.subtasks;
    if (typeof subs === "string") try { subs = JSON.parse(subs); } catch(_) { subs = []; }
    if (Array.isArray(subs) && subs.length > 0) {
        task.subtasks = subs; // fix in place
        const done = subs.filter(s => s.completed).length;
        const total = subs.length;
        const left = total - done;
        const pct = Math.round((done / total) * 100);
        const subSpan = document.createElement("div");
        subSpan.className = "task-subtask-progress";
        if (done === total) {
            subSpan.innerHTML = `<span class="subtask-bar"><span class="subtask-bar-fill complete" style="width:100%"></span></span> <span class="subtask-done-label">All ${total} done</span>`;
            subSpan.classList.add("all-done");
        } else {
            subSpan.innerHTML = `<span class="subtask-bar"><span class="subtask-bar-fill" style="width:${pct}%"></span></span> <span class="subtask-count">${done}/${total}</span> <span class="subtask-left">${left} left</span>`;
        }
        content.appendChild(subSpan);
    }

    // Click anywhere on task row to open detail panel
    li.addEventListener("click", (e) => {
        // Don't open if clicking checkbox, delete button, or during edit
        if (e.target.type === "checkbox" || e.target.closest(".delete-btn")) return;
        if (typeof DetailPanel !== "undefined") {
            DetailPanel.open(task);
        } else {
            openDetailModal(task);
        }
    });
    textSpan.addEventListener("dblclick", (e) => { e.stopPropagation(); startEdit(li, task); });

    // Permission check for shared tasks
    const isShared = task.shared_calendar_id && typeof SharedCalendar !== "undefined";
    const canEdit = !isShared || SharedCalendar.canEditTask(task);
    const canDel = !isShared || SharedCalendar.canDeleteTask(task);

    if (!canEdit) {
        cb.disabled = true;
        li.classList.add("readonly");
    }

    const delBtn = document.createElement("button"); delBtn.className = "delete-btn";
    delBtn.textContent = "\u2715"; delBtn.title = "Delete";
    delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        li.classList.add("removing");
        deleteTask(task.id);
    });
    if (!canDel) delBtn.style.display = "none";

    li.appendChild(cb); li.appendChild(tag); li.appendChild(content); li.appendChild(delBtn);
    return li;
}

function startEdit(li, task) {
    const tag = li.querySelector(".category-tag"), content = li.querySelector(".task-content"), delBtn = li.querySelector(".delete-btn");
    tag.style.display = "none"; delBtn.style.display = "none";
    const form = document.createElement("div"); form.className = "edit-form";
    const input = document.createElement("input"); input.type = "text"; input.className = "edit-input"; input.value = task.text; input.maxLength = 200;
    const select = document.createElement("select"); select.className = "edit-select";
    for (const c of categories) { const o = document.createElement("option"); o.value = c.id; o.textContent = c.label; if (c.id === task.category) o.selected = true; select.appendChild(o); }
    const hint = document.createElement("span"); hint.className = "edit-hint"; hint.textContent = "Enter/Esc";
    form.appendChild(input); form.appendChild(select); form.appendChild(hint);
    content.replaceWith(form); input.focus(); input.select();
    let done = false;
    const finish = (save) => { if (done) return; done = true; if (save && input.value.trim()) updateTask(task.id, { text: input.value, category: select.value }); renderAll(); };
    input.addEventListener("keydown", e => { if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); });
    input.addEventListener("blur", () => setTimeout(() => { if (!done) finish(true); }, 150));
}

function renderClearBtn() {
    const btn = document.getElementById("clear-completed-btn");
    const filtered = getFilteredTasks();
    const count = filtered.filter(t => t.completed).length;
    btn.style.display = count > 0 ? "block" : "none";
    btn.textContent = `Clear ${count} completed`;
}

// ============================================================
// Section 5b: Task Detail Modal
// Design Ref: §4.2 — Task detail panel with description
// Plan SC: SC1 — description input/edit
// ============================================================
let _detailTaskId = null;
let _detailOverlay = null;

function openDetailModal(task) {
    _detailTaskId = task.id;
    const modal = document.getElementById("detail-modal");
    document.getElementById("detail-title").value = task.text;
    document.getElementById("detail-desc").value = task.description || "";
    document.getElementById("detail-date").value = task.dueDate || "";
    document.getElementById("detail-time").value = task.dueTime || "";

    // Populate category select dynamically
    const catSel = document.getElementById("detail-category");
    catSel.innerHTML = "";
    for (const c of categories) {
        const o = document.createElement("option");
        o.value = c.id; o.textContent = c.label;
        if (c.id === task.category) o.selected = true;
        catSel.appendChild(o);
    }

    // Metadata
    document.getElementById("detail-created").textContent = new Date(task.createdAt).toLocaleString();
    document.getElementById("detail-updated").textContent = task.updatedAt
        ? new Date(task.updatedAt).toLocaleString() : "-";

    modal.style.display = "";
    if (!_detailOverlay) {
        _detailOverlay = document.createElement("div");
        _detailOverlay.className = "popup-overlay";
        _detailOverlay.addEventListener("click", closeDetailModal);
        document.body.appendChild(_detailOverlay);
    }
    _detailOverlay.style.display = "";
    document.getElementById("detail-title").focus();
}

function closeDetailModal() {
    document.getElementById("detail-modal").style.display = "none";
    if (_detailOverlay) _detailOverlay.style.display = "none";
    _detailTaskId = null;
}

function saveDetailModal() {
    if (!_detailTaskId) return;
    const text = document.getElementById("detail-title").value;
    const desc = document.getElementById("detail-desc").value;
    const cat = document.getElementById("detail-category").value;
    const date = document.getElementById("detail-date").value;
    const time = document.getElementById("detail-time").value;
    if (updateTask(_detailTaskId, { text, description: desc, category: cat, dueDate: date, dueTime: time })) {
        closeDetailModal();
        renderAll();
    }
}

function archiveFromDetail() {
    if (!_detailTaskId) return;
    archiveTask(_detailTaskId);
    closeDetailModal();
}

// ============================================================
// Section 5c: Archive Core
// Design Ref: §3.2 — archived tasks stored separately
// Plan SC: SC2 — archive and restore
// ============================================================
let archivedTasks = [];

function loadArchive() {
    try { const r = localStorage.getItem(ARCHIVE_KEY); if (r) return JSON.parse(r); } catch(_) {}
    return [];
}
function saveArchive() { if (!_useSupabase()) localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archivedTasks)); }

async function loadArchivedFromSupabase() {
    if (!_useSupabase()) return;
    try {
        const { data } = await DB.supabase
            .from("tasks").select("*")
            .eq("user_id", Auth.getUserId())
            .eq("archived", true)
            .order("archived_at", { ascending: false });
        archivedTasks = (data || []).map(row => {
            const t = DB._rowToTask(row);
            t.archived = true;
            t.archivedAt = row.archived_at;
            return t;
        });
    } catch (e) { console.error("Load archive error:", e); }
}

function archiveTask(id) {
    let task;
    const idx = tasks.findIndex(t => t.id === id);
    if (idx >= 0) {
        task = tasks.splice(idx, 1)[0];
    } else if (typeof SharedCalendar !== "undefined") {
        const sIdx = SharedCalendar._sharedTasks.findIndex(t => t.id === id);
        if (sIdx >= 0) task = SharedCalendar._sharedTasks.splice(sIdx, 1)[0];
    }
    if (!task) return;
    task.archived = true;
    task.archivedAt = new Date().toISOString();
    archivedTasks.push(task);

    if (_useSupabase()) {
        DB.supabase.from("tasks").update({
            archived: true, archived_at: task.archivedAt, updated_at: task.archivedAt
        }).eq("id", id).then(({ error }) => {
            if (error) showToast("Archive failed: " + error.message);
        });
    } else {
        saveTasks(); saveArchive();
    }
    renderAll();
    showToast("Task archived");
}

function restoreTask(id) {
    const idx = archivedTasks.findIndex(t => t.id === id);
    if (idx < 0) return;
    const task = archivedTasks.splice(idx, 1)[0];
    delete task.archived;
    delete task.archivedAt;
    task.updatedAt = new Date().toISOString();
    tasks.push(task);

    if (_useSupabase()) {
        DB.supabase.from("tasks").update({
            archived: false, archived_at: null, updated_at: task.updatedAt
        }).eq("id", id).then(({ error }) => {
            if (error) showToast("Restore failed: " + error.message);
        });
    } else {
        saveTasks(); saveArchive();
    }
    renderAll();
    showToast("Task restored");
}

// ============================================================
// Section 6: Calendar Object
// Design Ref: §3 — Calendar object pattern with month/week/day renderers
// ============================================================
const Calendar = {
    get viewDate() {
        if (settings.calendarDate) return new Date(settings.calendarDate + "T00:00:00");
        return new Date();
    },
    set viewDate(d) { settings.calendarDate = formatDateKey(d); saveSettings(); },

    get mode() { return settings.calendarMode; },
    set mode(m) { settings.calendarMode = m; saveSettings(); },

    // --- Navigation ---
    prev() {
        const d = new Date(this.viewDate);
        if (this.mode === "month") d.setMonth(d.getMonth() - 1);
        else if (this.mode === "week") d.setDate(d.getDate() - 7);
        else d.setDate(d.getDate() - 1);
        this.viewDate = d; this.render();
    },
    next() {
        const d = new Date(this.viewDate);
        if (this.mode === "month") d.setMonth(d.getMonth() + 1);
        else if (this.mode === "week") d.setDate(d.getDate() + 7);
        else d.setDate(d.getDate() + 1);
        this.viewDate = d; this.render();
    },
    goToday() { this.viewDate = new Date(); this.render(); },
    setMode(m) {
        this.mode = m;
        document.querySelectorAll(".cal-mode-btn").forEach(b => b.classList.toggle("active", b.dataset.mode === m));
        this.render();
    },

    // --- Get tasks for a date ---
    getTasksForDate(dateKey) {
        // Personal tasks (no shared_calendar_id)
        let list = tasks.filter(t => t.dueDate === dateKey && !t.shared_calendar_id);
        // Shared calendar tasks (from SharedCalendar._sharedTasks)
        if (typeof SharedCalendar !== "undefined" && SharedCalendar._sharedTasks.length) {
            const shared = SharedCalendar._sharedTasks.filter(t => t.dueDate === dateKey);
            list = list.concat(shared);
        }
        if (activeFilter !== "all") list = list.filter(t => t.category === activeFilter);
        return list;
    },

    // --- Main render dispatcher ---
    render() {
        this.renderHeader();
        const grid = document.getElementById("cal-grid"); grid.innerHTML = "";
        if (this.mode === "month") this.renderMonth(grid);
        else if (this.mode === "week") this.renderWeek(grid);
        else this.renderDay(grid);
    },

    renderHeader() {
        const d = this.viewDate;
        let title = "";
        if (this.mode === "month") title = MONTH_NAMES[d.getMonth()] + " " + d.getFullYear();
        else if (this.mode === "week") {
            const ws = this.getWeekStart(d);
            const we = new Date(ws); we.setDate(we.getDate() + 6);
            title = `${ws.getMonth()+1}/${ws.getDate()} - ${we.getMonth()+1}/${we.getDate()}, ${we.getFullYear()}`;
        } else {
            title = `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} (${DAY_NAMES[(d.getDay()+6)%7]})`;
        }
        document.getElementById("cal-title").textContent = title;
    },

    // --- Month View ---
    // Plan SC: SC1 — month/week/day view switching
    renderMonth(grid) {
        const mg = document.createElement("div"); mg.className = "cal-month-grid";
        // Day headers
        for (const d of DAY_NAMES) {
            const h = document.createElement("div"); h.className = "cal-day-header"; h.textContent = d; mg.appendChild(h);
        }
        const vd = this.viewDate;
        const year = vd.getFullYear(), month = vd.getMonth();
        const firstDay = new Date(year, month, 1);
        const startWeekday = (firstDay.getDay() + 6) % 7; // Mon=0
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const prevMonthDays = new Date(year, month, 0).getDate();
        const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;

        for (let i = 0; i < totalCells; i++) {
            const cell = document.createElement("div"); cell.className = "cal-cell";
            let cellDate, isOther = false;
            if (i < startWeekday) {
                const day = prevMonthDays - startWeekday + i + 1;
                cellDate = new Date(year, month - 1, day); isOther = true;
            } else if (i >= startWeekday + daysInMonth) {
                const day = i - startWeekday - daysInMonth + 1;
                cellDate = new Date(year, month + 1, day); isOther = true;
            } else {
                cellDate = new Date(year, month, i - startWeekday + 1);
            }
            if (isOther) cell.classList.add("other-month");
            const dateKey = formatDateKey(cellDate);
            const todayKey = formatDateKey(new Date());
            if (dateKey === todayKey) cell.classList.add("today");

            const dateNum = document.createElement("div"); dateNum.className = "cal-cell-date";
            dateNum.textContent = cellDate.getDate(); cell.appendChild(dateNum);

            // Tasks
            const dayTasks = this.getTasksForDate(dateKey);
            const maxShow = 3;
            for (let j = 0; j < Math.min(dayTasks.length, maxShow); j++) {
                cell.appendChild(this.createChip(dayTasks[j]));
            }
            if (dayTasks.length > maxShow) {
                const more = document.createElement("div"); more.className = "cal-more-link";
                more.textContent = `+${dayTasks.length - maxShow} more`;
                more.addEventListener("click", (e) => { e.stopPropagation(); this.viewDate = cellDate; this.setMode("day"); });
                cell.appendChild(more);
            }

            // Click empty area → create task
            cell.addEventListener("click", () => this.showPopup(null, dateKey, null));

            // Drag & drop target
            cell.addEventListener("dragover", e => { e.preventDefault(); cell.classList.add("drag-over"); });
            cell.addEventListener("dragleave", () => cell.classList.remove("drag-over"));
            cell.addEventListener("drop", e => {
                e.preventDefault(); cell.classList.remove("drag-over");
                const tid = e.dataTransfer.getData("text/plain");
                if (tid) { updateTask(tid, { dueDate: dateKey }); renderAll(); }
            });

            mg.appendChild(cell);
        }
        grid.appendChild(mg);
    },

    createChip(task) {
        // Use calendar color for shared tasks, category color for personal
        const calColor = (typeof SharedCalendar !== "undefined") ? SharedCalendar.getTaskCalendarColor(task) : null;
        const cat = getCat(task.category);
        const color = calColor || cat.color;
        const chip = document.createElement("div"); chip.className = "cal-task-chip";
        if (task.completed) chip.classList.add("completed");
        if (isDueSoon(task)) chip.classList.add("due-soon");
        if (task.shared_calendar_id) chip.classList.add("shared");
        chip.style.background = color + "20"; chip.style.color = color;
        chip.textContent = (task.shared_calendar_id ? "👥 " : "") + (task.dueTime ? task.dueTime + " " : "") + task.text;
        chip.draggable = true;
        chip.addEventListener("dragstart", e => { e.stopPropagation(); e.dataTransfer.setData("text/plain", task.id); });
        chip.addEventListener("click", e => { e.stopPropagation(); if (typeof DetailPanel !== "undefined" && !DetailPanel.isMobile()) { DetailPanel.open(task); } else { this.showPopup(task, task.dueDate, task.dueTime); } });
        return chip;
    },

    // --- Week View ---
    renderWeek(grid) {
        const ws = this.getWeekStart(this.viewDate);
        const days = []; for (let i = 0; i < 7; i++) { const d = new Date(ws); d.setDate(d.getDate() + i); days.push(d); }
        const todayKey = formatDateKey(new Date());

        // All-day row — per-column, aligned with day headers
        const allday = document.createElement("div"); allday.className = "cal-allday-row";
        const adCorner = document.createElement("div"); adCorner.className = "cal-allday-corner"; adCorner.textContent = "All day";
        allday.appendChild(adCorner);
        for (const d of days) {
            const key = formatDateKey(d);
            const col = document.createElement("div"); col.className = "cal-allday-col";
            for (const t of this.getTasksForDate(key).filter(t => !t.dueTime)) col.appendChild(this.createChip(t));
            allday.appendChild(col);
        }
        grid.appendChild(allday);

        // Time grid
        const tg = document.createElement("div"); tg.className = "cal-time-grid";
        // Header row
        const hr = document.createElement("div"); hr.className = "cal-time-header-row";
        hr.style.gridTemplateColumns = "60px repeat(7, 1fr)";
        const corner = document.createElement("div"); corner.textContent = ""; hr.appendChild(corner);
        for (const d of days) {
            const h = document.createElement("div");
            h.textContent = DAY_NAMES[(d.getDay()+6)%7] + " " + d.getDate();
            if (formatDateKey(d) === todayKey) h.style.color = "var(--accent)";
            hr.appendChild(h);
        }
        tg.appendChild(hr);

        // Hour rows (6am to 23pm for cleaner view)
        for (let hour = 6; hour < 24; hour++) {
            const row = document.createElement("div"); row.className = "cal-time-row";
            row.style.gridTemplateColumns = "60px repeat(7, 1fr)";
            const label = document.createElement("div"); label.className = "cal-time-label";
            label.textContent = String(hour).padStart(2, "0") + ":00";
            row.appendChild(label);

            for (const d of days) {
                const cell = document.createElement("div"); cell.className = "cal-time-cell";
                const key = formatDateKey(d);
                // Place tasks at this hour
                const hourTasks = this.getTasksForDate(key).filter(t => t.dueTime && parseInt(t.dueTime) === hour);
                for (const t of hourTasks) {
                    const block = this.createTimeBlock(t); cell.appendChild(block);
                }
                // Click to create
                cell.addEventListener("click", () => this.showPopup(null, key, String(hour).padStart(2,"0") + ":00"));
                // Drop
                cell.addEventListener("dragover", e => { e.preventDefault(); cell.style.background = "var(--accent-light)"; });
                cell.addEventListener("dragleave", () => cell.style.background = "");
                cell.addEventListener("drop", e => {
                    e.preventDefault(); cell.style.background = "";
                    const tid = e.dataTransfer.getData("text/plain");
                    if (tid) { updateTask(tid, { dueDate: key, dueTime: String(hour).padStart(2,"0") + ":00" }); renderAll(); }
                });
                row.appendChild(cell);
            }

            // Current time indicator
            const now = new Date();
            if (hour === now.getHours()) {
                const nowMinPct = (now.getMinutes() / 60) * 100;
                const dayIdx = days.findIndex(d => formatDateKey(d) === todayKey);
                if (dayIdx >= 0) {
                    setTimeout(() => {
                        const cells = row.querySelectorAll(".cal-time-cell");
                        if (cells[dayIdx]) {
                            const line = document.createElement("div"); line.className = "cal-now-line";
                            line.style.top = nowMinPct + "%";
                            const dot = document.createElement("div"); dot.className = "cal-now-dot";
                            line.appendChild(dot);
                            cells[dayIdx].style.position = "relative";
                            cells[dayIdx].appendChild(line);
                        }
                    }, 0);
                }
            }
            tg.appendChild(row);
        }
        grid.appendChild(tg);
    },

    // --- Day View ---
    // Plan SC: SC1 — day view with hourly timeline
    renderDay(grid) {
        const d = this.viewDate;
        const dateKey = formatDateKey(d);
        const todayKey = formatDateKey(new Date());

        // All-day bar — tasks with this date but no specific time
        const alldayTasks = this.getTasksForDate(dateKey).filter(t => !t.dueTime);
        const allday = document.createElement("div"); allday.className = "cal-allday-bar";
        const adLabel = document.createElement("span"); adLabel.className = "cal-allday-label"; adLabel.textContent = "All day";
        allday.appendChild(adLabel);
        if (alldayTasks.length === 0) {
            const empty = document.createElement("span");
            empty.style.cssText = "font-size:0.75rem;color:var(--text-faint);line-height:22px;";
            empty.textContent = "No all-day tasks";
            allday.appendChild(empty);
        } else {
            for (const t of alldayTasks) allday.appendChild(this.createChip(t));
        }
        grid.appendChild(allday);

        // Time grid — single column
        const tg = document.createElement("div"); tg.className = "cal-time-grid";
        for (let hour = 0; hour < 24; hour++) {
            const row = document.createElement("div"); row.className = "cal-time-row";
            row.style.gridTemplateColumns = "60px 1fr";
            const label = document.createElement("div"); label.className = "cal-time-label";
            label.textContent = String(hour).padStart(2, "0") + ":00";
            row.appendChild(label);

            const cell = document.createElement("div"); cell.className = "cal-time-cell";
            const hourTasks = this.getTasksForDate(dateKey).filter(t => t.dueTime && parseInt(t.dueTime) === hour);
            for (const t of hourTasks) cell.appendChild(this.createTimeBlock(t));

            cell.addEventListener("click", () => this.showPopup(null, dateKey, String(hour).padStart(2,"0") + ":00"));
            cell.addEventListener("dragover", e => { e.preventDefault(); cell.style.background = "var(--accent-light)"; });
            cell.addEventListener("dragleave", () => cell.style.background = "");
            cell.addEventListener("drop", e => {
                e.preventDefault(); cell.style.background = "";
                const tid = e.dataTransfer.getData("text/plain");
                if (tid) { updateTask(tid, { dueDate: dateKey, dueTime: String(hour).padStart(2,"0") + ":00" }); renderAll(); }
            });
            row.appendChild(cell);

            // Now indicator
            const now = new Date();
            if (dateKey === todayKey && hour === now.getHours()) {
                setTimeout(() => {
                    const line = document.createElement("div"); line.className = "cal-now-line";
                    line.style.top = (now.getMinutes() / 60 * 100) + "%";
                    const dot = document.createElement("div"); dot.className = "cal-now-dot";
                    line.appendChild(dot); cell.style.position = "relative"; cell.appendChild(line);
                }, 0);
            }
            tg.appendChild(row);
        }
        grid.appendChild(tg);
    },

    createTimeBlock(task) {
        const calColor = (typeof SharedCalendar !== "undefined") ? SharedCalendar.getTaskCalendarColor(task) : null;
        const cat = getCat(task.category);
        const color = calColor || cat.color;
        const block = document.createElement("div"); block.className = "cal-time-block";
        if (task.completed) block.classList.add("completed");
        block.style.background = color + "30"; block.style.color = color;
        block.style.top = "2px"; block.style.height = "calc(100% - 4px)";
        block.textContent = (task.shared_calendar_id ? "👥 " : "") + task.text;
        block.draggable = true;
        block.addEventListener("dragstart", e => { e.stopPropagation(); e.dataTransfer.setData("text/plain", task.id); });
        block.addEventListener("click", e => { e.stopPropagation(); if (typeof DetailPanel !== "undefined" && !DetailPanel.isMobile()) { DetailPanel.open(task); } else { this.showPopup(task, task.dueDate, task.dueTime); } });
        return block;
    },

    // --- Popup CRUD ---
    // Plan SC: SC2 — calendar CRUD via popup
    _popupTaskId: null,
    _overlay: null,

    showPopup(task, dateKey, timeStr) {
        this._popupTaskId = task ? task.id : null;
        const popup = document.getElementById("task-popup");
        document.getElementById("popup-text").value = task ? task.text : "";
        document.getElementById("popup-date").value = dateKey || "";
        document.getElementById("popup-time").value = timeStr || (task ? task.dueTime || "" : "");
        document.getElementById("popup-cat").value = task ? task.category : "work";
        document.getElementById("popup-delete").style.display = task ? "" : "none";
        popup.style.display = "";

        // Overlay
        if (!this._overlay) {
            this._overlay = document.createElement("div"); this._overlay.className = "popup-overlay";
            this._overlay.addEventListener("click", () => this.closePopup());
            document.body.appendChild(this._overlay);
        }
        this._overlay.style.display = "";
        document.getElementById("popup-text").focus();
    },

    closePopup() {
        document.getElementById("task-popup").style.display = "none";
        if (this._overlay) this._overlay.style.display = "none";
        this._popupTaskId = null;
    },

    savePopup() {
        const text = document.getElementById("popup-text").value.trim();
        const date = document.getElementById("popup-date").value;
        const time = document.getElementById("popup-time").value;
        const cat = document.getElementById("popup-cat").value;
        if (!text) return;

        if (this._popupTaskId) {
            updateTask(this._popupTaskId, { text, category: cat, dueDate: date, dueTime: time });
        } else {
            addTask(text, cat, date, time);
        }
        this.closePopup(); renderAll();
    },

    deletePopupTask() {
        if (this._popupTaskId) { deleteTask(this._popupTaskId); this.closePopup(); }
    },

    // --- Helpers ---
    getWeekStart(d) {
        const r = new Date(d); const day = (r.getDay() + 6) % 7;
        r.setDate(r.getDate() - day); r.setHours(0,0,0,0); return r;
    },
};

// ============================================================
// Section 7: View Switching + Archive/Settings Rendering
// ============================================================
const ALL_VIEWS = ["list", "calendar", "archive", "settings"];

function setActiveView(view) {
    settings.activeView = view;
    saveSettings();
    for (const v of ALL_VIEWS) {
        const el = document.getElementById(v + "-view");
        if (el) el.style.display = v === view ? "" : "none";
    }
    document.querySelectorAll(".view-tab").forEach(b => b.classList.toggle("active", b.dataset.view === view));
    renderAll();
}

// --- Dynamic filter buttons ---
function renderFilterButtons() {
    const container = document.getElementById("filter-list");
    if (!container) return;
    container.innerHTML = "";
    // "All" button
    const allBtn = document.createElement("button");
    allBtn.className = "filter-btn" + (activeFilter === "all" ? " active" : "");
    allBtn.dataset.filter = "all";
    allBtn.innerHTML = '<span class="filter-icon">&#9776;</span> All';
    allBtn.addEventListener("click", () => { activeFilter = "all"; saveFilter(); renderAll(); });
    container.appendChild(allBtn);
    // Category buttons
    for (const cat of categories) {
        const btn = document.createElement("button");
        btn.className = "filter-btn" + (activeFilter === cat.id ? " active" : "");
        btn.dataset.filter = cat.id;
        btn.innerHTML = `<span class="filter-dot" style="background:${safeColor(cat.color)}"></span> ${escapeHtml(cat.label)}`;
        btn.addEventListener("click", () => { activeFilter = cat.id; saveFilter(); renderAll(); });
        container.appendChild(btn);
    }
}

// --- Dynamic category select (list view input) ---
function renderCategorySelect() {
    const sel = document.getElementById("category-select");
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = "";
    for (const cat of categories) {
        const o = document.createElement("option");
        o.value = cat.id; o.textContent = cat.label;
        sel.appendChild(o);
    }
    if (cur && categories.some(c => c.id === cur)) sel.value = cur;

    // Calendar select (for settings default-calendar only now; toolbar uses multi-select)
    const defaultCal = localStorage.getItem("my-tasks-default-calendar") || "";
    _populateCalendarSelect(document.getElementById("default-calendar-select"), defaultCal);
}

function _populateCalendarSelect(sel, selectedValue) {
    if (!sel) return;
    // Preserve user's manual selection, otherwise use provided default
    const cur = sel.dataset.userChanged === "true" ? sel.value : (selectedValue || "");
    sel.innerHTML = '<option value="">Personal</option>';
    if (typeof SharedCalendar !== "undefined") {
        for (const cal of SharedCalendar.calendars) {
            const o = document.createElement("option");
            o.value = cal.id; o.textContent = cal.name;
            sel.appendChild(o);
        }
    }
    // Set value (only works if option exists)
    if (cur) sel.value = cur;
    // If default doesn't match any option, stay on Personal
    if (sel.value !== cur && cur) sel.value = "";
}

// --- Archive view rendering ---
let archiveSearch = "";

function renderArchiveView() {
    const list = document.getElementById("archive-list");
    const empty = document.getElementById("archive-empty");
    const stats = document.getElementById("archive-stats");
    list.innerHTML = "";

    let filtered = archivedTasks.slice().reverse(); // newest first
    if (archiveSearch) {
        const q = archiveSearch.toLowerCase();
        filtered = filtered.filter(t => t.text.toLowerCase().includes(q) || (t.description || "").toLowerCase().includes(q));
    }
    if (activeFilter !== "all") {
        filtered = filtered.filter(t => t.category === activeFilter);
    }

    stats.textContent = `${filtered.length} archived task${filtered.length !== 1 ? "s" : ""} (${archivedTasks.length} total)`;
    empty.style.display = filtered.length === 0 ? "" : "none";

    for (const task of filtered) {
        const cat = getCat(task.category);
        const li = document.createElement("li");
        li.className = "archive-item";

        const dot = document.createElement("span");
        dot.className = "cat-item-dot";
        dot.style.background = cat.color;

        const text = document.createElement("span");
        text.className = "task-text";
        text.textContent = task.text;

        const date = document.createElement("span");
        date.className = "archive-date";
        date.textContent = task.archivedAt ? new Date(task.archivedAt).toLocaleDateString() : "";

        const restoreBtn = document.createElement("button");
        restoreBtn.className = "restore-btn";
        restoreBtn.textContent = "Restore";
        restoreBtn.addEventListener("click", () => restoreTask(task.id));

        li.appendChild(dot);
        li.appendChild(text);
        li.appendChild(date);
        li.appendChild(restoreBtn);
        list.appendChild(li);
    }
}

// --- Settings view rendering ---
function renderSettingsView() {
    renderCategoryList();
    loadSupabaseSettings();
    if (window._loadApiTokens && _useSupabase()) window._loadApiTokens();
    // Admin: show user management
    const umSection = document.getElementById("user-management-section");
    if (umSection && typeof Auth !== "undefined" && Auth.isAdmin()) {
        umSection.style.display = "";
        _renderUserManagement();
    } else if (umSection) {
        umSection.style.display = "none";
    }
    // Calendar pending requests (for all calendar owners)
    if (_useSupabase() && typeof SharedCalendar !== "undefined") {
        _renderCalendarRequests();
    }
}

async function _renderCalendarRequests() {
    const section = document.getElementById("calendar-requests-section");
    if (!section) return;

    // Find calendars I own
    const myCals = SharedCalendar.calendars.filter(c => c.owner_id === Auth.getUserId());
    if (!myCals.length) { section.style.display = "none"; return; }

    // Get pending members for my calendars
    const calIds = myCals.map(c => c.id);
    const { data: pendingMembers } = await DB.supabase
        .from("calendar_members").select("calendar_id, user_id, requested_role, joined_at")
        .in("calendar_id", calIds).eq("role", "pending");

    if (!pendingMembers || !pendingMembers.length) {
        section.style.display = "none";
        return;
    }

    section.style.display = "";
    const list = document.getElementById("calendar-requests-list");
    list.innerHTML = "";

    // Load profiles
    const userIds = pendingMembers.map(m => m.user_id);
    let profiles = {};
    if (userIds.length) {
        const { data } = await DB.supabase.from("profiles").select("id, display_name, email").in("id", userIds);
        if (data) data.forEach(p => { profiles[p.id] = p; });
    }

    for (const m of pendingMembers) {
        const cal = myCals.find(c => c.id === m.calendar_id);
        const profile = profiles[m.user_id] || {};
        const displayName = profile.display_name || profile.email || "Unknown";

        const row = document.createElement("div");
        row.className = "um-row";

        const info = document.createElement("div");
        info.style.cssText = "flex:1;min-width:0;";
        info.innerHTML = `<div style="font-size:0.85rem;font-weight:600;color:var(--text2);">${escapeHtml(displayName)}</div>
            <div style="font-size:0.72rem;color:var(--text-faint);">→ ${escapeHtml(cal?.name || "")} as ${m.requested_role || "viewer"}</div>`;

        const approveBtn = document.createElement("button");
        approveBtn.className = "um-btn approve"; approveBtn.textContent = "Approve";
        approveBtn.addEventListener("click", async () => {
            await SharedCalendar.updateMemberRole(m.calendar_id, m.user_id, m.requested_role || "viewer");
            showToast(displayName + " approved");
            _renderCalendarRequests();
        });

        const rejectBtn = document.createElement("button");
        rejectBtn.className = "um-btn reject"; rejectBtn.textContent = "Reject";
        rejectBtn.addEventListener("click", async () => {
            await SharedCalendar.removeMember(m.calendar_id, m.user_id);
            showToast(displayName + " rejected");
            _renderCalendarRequests();
        });

        row.appendChild(info);
        row.appendChild(approveBtn);
        row.appendChild(rejectBtn);
        list.appendChild(row);
    }
}

async function _renderUserManagement() {
    if (typeof Auth === "undefined" || !Auth.isAdmin()) return;
    const list = document.getElementById("user-management-list");
    if (!list) return;
    list.innerHTML = '<div style="color:var(--text-faint);font-size:0.8rem;">Loading...</div>';

    const users = await Auth.loadPendingUsers();
    list.innerHTML = "";

    if (!users.length) {
        list.innerHTML = '<div style="color:var(--text-faint);font-size:0.8rem;">No users</div>';
        return;
    }

    for (const u of users) {
        const row = document.createElement("div");
        row.className = "um-row";

        const email = document.createElement("span");
        email.className = "um-email";
        email.textContent = u.email;

        const status = document.createElement("span");
        status.className = "um-status " + u.status;
        status.textContent = u.status;

        const date = document.createElement("span");
        date.className = "um-date";
        date.textContent = u.reviewed_at ? new Date(u.reviewed_at).toLocaleDateString() : new Date(u.requested_at).toLocaleDateString();

        row.appendChild(email);
        row.appendChild(status);
        row.appendChild(date);

        if (u.email !== "ljhiyh@gmail.com") {
            if (u.status === "pending") {
                const approveBtn = document.createElement("button");
                approveBtn.className = "um-btn approve"; approveBtn.textContent = "Approve";
                approveBtn.addEventListener("click", async () => {
                    await Auth.approveUser(u.email);
                    showToast(u.email + " approved");
                    _renderUserManagement();
                });
                const rejectBtn = document.createElement("button");
                rejectBtn.className = "um-btn reject"; rejectBtn.textContent = "Reject";
                rejectBtn.addEventListener("click", async () => {
                    await Auth.rejectUser(u.email);
                    showToast(u.email + " rejected");
                    _renderUserManagement();
                });
                row.appendChild(approveBtn);
                row.appendChild(rejectBtn);
            } else {
                const removeBtn = document.createElement("button");
                removeBtn.className = "um-btn remove"; removeBtn.textContent = "Remove";
                removeBtn.addEventListener("click", async () => {
                    if (confirm("Remove " + u.email + "?")) {
                        await Auth.removeUser(u.email);
                        showToast(u.email + " removed");
                        _renderUserManagement();
                    }
                });
                row.appendChild(removeBtn);
            }
        }

        list.appendChild(row);
    }
}

function renderCategoryList() {
    const container = document.getElementById("cat-list");
    if (!container) return;
    container.innerHTML = "";

    for (const cat of categories) {
        const count = tasks.filter(t => t.category === cat.id).length;
        const item = document.createElement("div");
        item.className = "cat-item";
        item.innerHTML = `
            <span class="cat-item-dot" style="background:${safeColor(cat.color)}"></span>
            <span class="cat-item-label">${escapeHtml(cat.label)}</span>
            <span class="cat-item-count">${count} tasks</span>
        `;

        const delBtn = document.createElement("button");
        delBtn.className = "cat-del-btn";
        delBtn.textContent = "Delete";
        delBtn.addEventListener("click", () => {
            if (count > 0) {
                showToast(`Cannot delete: ${count} task(s) using "${cat.label}"`);
                return;
            }
            if (confirm(`Delete category "${cat.label}"?`)) {
                categories = categories.filter(c => c.id !== cat.id);
                saveCategories();
                renderAll();
            }
        });
        item.appendChild(delBtn);
        container.appendChild(item);
    }
}

function loadSupabaseSettings() {
    const urlEl = document.getElementById("sb-url");
    const keyEl = document.getElementById("sb-key");
    const statusEl = document.getElementById("sb-status");
    if (!urlEl || !keyEl) return;

    // Show current active connection values (defaults or saved)
    const DEFAULT_SB_URL = "https://urkytivapfgzenpvflce.supabase.co";
    const DEFAULT_SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVya3l0aXZhcGZnemVucHZmbGNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MTczMzMsImV4cCI6MjA5MDk5MzMzM30.mDIg_XXF0JRhLsAF-lDI349Wn7DDgNX6kiLygz_MYTk";

    let url = DEFAULT_SB_URL, key = DEFAULT_SB_KEY;
    try {
        const r = localStorage.getItem("my-tasks-supabase");
        if (r) {
            const s = JSON.parse(r);
            if (s.url && s.url.startsWith("http")) url = s.url;
            if (s.key && s.key.length > 10) key = s.key;
        }
    } catch(_) {}

    urlEl.value = url;
    keyEl.value = key;
    if (statusEl && DB.isConnected) {
        statusEl.textContent = "Connected";
        statusEl.className = "sb-status connected";
    }
}

function saveSupabaseSettings() {
    const url = document.getElementById("sb-url").value.trim();
    const key = document.getElementById("sb-key").value.trim();
    if (url && url.startsWith("http") && key && key.length > 10) {
        localStorage.setItem("my-tasks-supabase", JSON.stringify({ url, key }));
    }
}

// ============================================================
// Section 7b: Realtime subscription for personal tasks
// ============================================================
let _personalTasksSub = null;
let _realtimeTimer = null;

function _subscribePersonalTasks() {
    if (!DB.supabase || !Auth.getUserId()) return;
    if (_personalTasksSub) DB.supabase.removeChannel(_personalTasksSub);

    _personalTasksSub = DB.supabase
        .channel("personal-tasks-changes")
        .on("postgres_changes", {
            event: "*",
            schema: "public",
            table: "tasks",
            filter: `user_id=eq.${Auth.getUserId()}`,
        }, () => {
            // Debounce: avoid double-reload when our own CRUD triggers realtime
            clearTimeout(_realtimeTimer);
            _realtimeTimer = setTimeout(() => loadTasksFromSupabase(), 500);
        })
        .subscribe();
}

// ============================================================
// Section 7c: Voice Summary + Task Reminders
// ============================================================
function _getTodayTasks() {
    const today = formatDateKey(new Date());
    return getAllTasks().filter(t => t.dueDate === today && !t.completed);
}

function _getOverdueTasks() {
    const today = formatDateKey(new Date());
    return getAllTasks().filter(t => !t.completed && t.dueDate && t.dueDate < today);
}

function speakTodaySummary() {
    const todayTasks = _getTodayTasks();
    if (!todayTasks.length) {
        _speak("No tasks for today. Enjoy your day!");
        return;
    }

    const lines = [`You have ${todayTasks.length} task${todayTasks.length > 1 ? "s" : ""} for today.`];
    todayTasks.forEach((t, i) => {
        let line = `${i + 1}. ${t.text}`;
        if (t.dueTime) line += `, at ${t.dueTime}`;
        if (t.category) line += `, ${getCat(t.category).label}`;
        lines.push(line);
    });

    _speak(lines.join(". "));
    showToast(`${todayTasks.length} tasks for today`);
}

function _speak(text) {
    if (!window.speechSynthesis) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = 0.95;
    speechSynthesis.speak(u);
}

// --- Task Reminders ---
let _reminderTimers = [];
const REMINDER_KEY = "my-tasks-reminder";

function loadReminderSetting() {
    return localStorage.getItem(REMINDER_KEY) || "10"; // default 10 minutes
}

function saveReminderSetting(val) {
    localStorage.setItem(REMINDER_KEY, val);
}

function _requestNotificationPermission() {
    if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
    }
}

function _scheduleReminders() {
    // Clear existing timers
    _reminderTimers.forEach(t => clearTimeout(t));
    _reminderTimers = [];

    const reminderMinutes = parseInt(loadReminderSetting());
    if (!reminderMinutes || reminderMinutes <= 0) return;

    const now = Date.now();
    const todayTasks = _getTodayTasks().filter(t => t.dueTime);

    for (const task of todayTasks) {
        const dueStr = task.dueDate + "T" + task.dueTime + ":00";
        const dueTime = new Date(dueStr).getTime();
        const reminderTime = dueTime - reminderMinutes * 60000;
        const delay = reminderTime - now;

        if (delay > 0 && delay < 24 * 3600000) {
            const timer = setTimeout(() => {
                // Browser notification
                if ("Notification" in window && Notification.permission === "granted") {
                    new Notification("Task Reminder", {
                        body: `${task.text} — in ${reminderMinutes} minutes`,
                        icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📋</text></svg>",
                    });
                }
                // Also speak
                _speak(`Reminder: ${task.text} in ${reminderMinutes} minutes`);
                showToast(`Reminder: ${task.text}`);
            }, delay);
            _reminderTimers.push(timer);
        }
    }
}

// ============================================================
// Section 8: Events & Shortcuts
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
    tasks = loadTasks();
    activeFilter = loadFilter();
    settings = loadSettings();
    categories = loadCategories();
    archivedTasks = loadArchive();
    applyTheme(loadTheme());

    // Save join token from URL before anything else (survives login redirect)
    const joinParams = new URLSearchParams(window.location.search);
    const joinToken = joinParams.get("join");
    if (joinToken) {
        localStorage.setItem("my-tasks-pending-join", joinToken);
        window.history.replaceState({}, "", window.location.pathname);
    }

    // Auto-init Supabase + Auth
    // Default Supabase config (anon key is public, RLS protects data)
    const DEFAULT_SB_URL = "https://urkytivapfgzenpvflce.supabase.co";
    const DEFAULT_SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVya3l0aXZhcGZnemVucHZmbGNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MTczMzMsImV4cCI6MjA5MDk5MzMzM30.mDIg_XXF0JRhLsAF-lDI349Wn7DDgNX6kiLygz_MYTk";

    let sbUrl = DEFAULT_SB_URL;
    let sbKey = DEFAULT_SB_KEY;
    try {
        const sbRaw = localStorage.getItem("my-tasks-supabase");
        if (sbRaw) {
            const sb = JSON.parse(sbRaw);
            // Only override defaults if valid non-empty values
            if (sb.url && sb.url.startsWith("http")) sbUrl = sb.url;
            if (sb.key && sb.key.length > 10) sbKey = sb.key;
        }
    } catch(_) {}

    let supabaseReady = false;
    try {
        supabaseReady = DB.init(sbUrl, sbKey);
    } catch(e) {
        console.error("Supabase init failed:", e);
    }

    // Initialize Auth (shows login page or app)
    // After auth completes, initialize SharedCalendar
    if (typeof Auth !== "undefined") {
        Auth.init(supabaseReady ? DB.supabase : null).then(() => {
            if (Auth.getUserId() && DB.isConnected) {
                // DB is the source of truth — clear local data
                tasks = [];
                archivedTasks = [];
                localStorage.removeItem(STORAGE_KEY);
                localStorage.removeItem(ARCHIVE_KEY);
                // Load all data from Supabase
                loadTasksFromSupabase();
                loadArchivedFromSupabase();
                if (typeof SharedCalendar !== "undefined") SharedCalendar.init();
                // Realtime for personal tasks — auto-refresh on changes
                _subscribePersonalTasks();
                // Notifications + reminders
                _requestNotificationPermission();
                setTimeout(() => _scheduleReminders(), 2000);
            }
        });
    }

    // Login page events
    const googleBtn = document.getElementById("google-login-btn");
    if (googleBtn) googleBtn.addEventListener("click", () => {
        if (typeof Auth !== "undefined") Auth.signInWithGoogle();
    });
    const skipBtn = document.getElementById("login-skip");
    if (skipBtn) skipBtn.addEventListener("click", (e) => {
        e.preventDefault();
        if (typeof Auth !== "undefined") Auth.skipLogin();
    });
    const logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn) logoutBtn.addEventListener("click", () => {
        if (typeof Auth !== "undefined") Auth.signOut();
    });
    const pendingSignout = document.getElementById("pending-signout");
    if (pendingSignout) pendingSignout.addEventListener("click", () => {
        if (typeof Auth !== "undefined") Auth.signOut();
    });

    const input = document.getElementById("task-input");
    const catSelect = document.getElementById("category-select");
    const dueDateInput = document.getElementById("due-date-input");
    const dueTimeInput = document.getElementById("due-time-input");

    // Plan SC: SC5 — default date = today
    dueDateInput.value = formatDateKey(new Date());

    // All-day checkbox: hide time input when checked
    const alldayCheck = document.getElementById("allday-check");
    alldayCheck.addEventListener("change", () => {
        dueTimeInput.style.display = alldayCheck.checked ? "none" : "";
        if (alldayCheck.checked) dueTimeInput.value = "";
    });

    const calendarSelect = document.getElementById("calendar-select");

    // --- Calendar multi-select dropdown ---
    const calMultiBtn = document.getElementById("cal-multi-btn");
    const calMultiDropdown = document.getElementById("cal-multi-dropdown");
    let _selectedSharedCalIds = []; // shared calendars to ALSO add to

    function _updateCalMultiDropdown() {
        calMultiDropdown.innerHTML = "";
        const hint = document.createElement("div");
        hint.className = "cal-multi-hint";
        hint.textContent = "Also add to:";
        calMultiDropdown.appendChild(hint);

        if (typeof SharedCalendar === "undefined" || !SharedCalendar.calendars.length) {
            const empty = document.createElement("div");
            empty.className = "cal-multi-empty";
            empty.textContent = "No shared calendars";
            calMultiDropdown.appendChild(empty);
            return;
        }

        for (const cal of SharedCalendar.calendars) {
            if (!SharedCalendar.canEdit(cal.id)) continue; // only show calendars I can write to
            const label = document.createElement("label");
            label.className = "cal-multi-option";
            const cb = document.createElement("input");
            cb.type = "checkbox"; cb.value = cal.id;
            cb.checked = _selectedSharedCalIds.includes(cal.id);
            cb.addEventListener("change", () => {
                if (cb.checked) { if (!_selectedSharedCalIds.includes(cal.id)) _selectedSharedCalIds.push(cal.id); }
                else { _selectedSharedCalIds = _selectedSharedCalIds.filter(id => id !== cal.id); }
                _updateCalMultiBtnLabel();
            });
            const dot = document.createElement("span");
            dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${cal.color};flex-shrink:0;`;
            const span = document.createElement("span");
            span.textContent = cal.name;
            label.appendChild(cb); label.appendChild(dot); label.appendChild(span);
            calMultiDropdown.appendChild(label);
        }
    }

    function _updateCalMultiBtnLabel() {
        if (_selectedSharedCalIds.length === 0) {
            calMultiBtn.textContent = "+ Schedule";
        } else {
            const names = _selectedSharedCalIds.map(id => {
                const c = SharedCalendar.calendars.find(c => c.id === id);
                return c ? c.name : "?";
            });
            calMultiBtn.textContent = names.length <= 2 ? names.join(", ") : names[0] + " +" + (names.length - 1);
        }
    }

    calMultiBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = calMultiDropdown.style.display !== "none";
        calMultiDropdown.style.display = isOpen ? "none" : "";
        if (!isOpen) _updateCalMultiDropdown();
    });
    // Close dropdown on outside click
    document.addEventListener("click", (e) => {
        if (!e.target.closest("#cal-multi-select")) calMultiDropdown.style.display = "none";
    });

    const _resetInputs = () => {
        input.value = ""; dueDateInput.value = formatDateKey(new Date()); dueTimeInput.value = "";
        alldayCheck.checked = true; dueTimeInput.style.display = "none";
        _selectedSharedCalIds = [];
        _updateCalMultiBtnLabel();
        input.focus();
    };

    const handleAdd = (openDetail) => {
        if (!input.value.trim()) return;
        const text = input.value;
        const cat = catSelect.value;
        const date = dueDateInput.value;
        const time = alldayCheck.checked ? "" : dueTimeInput.value;

        // Create one task. If shared calendar selected, set shared_calendar_id.
        // Task belongs to the selected calendar (or Personal if none selected).
        const calId = _selectedSharedCalIds.length > 0 ? _selectedSharedCalIds[0] : "";
        addTask(text, cat, date, time, "", calId);

        if (openDetail) {
            const newTask = tasks[tasks.length - 1];
            if (newTask && typeof DetailPanel !== "undefined" && !DetailPanel.isMobile()) {
                setTimeout(() => DetailPanel.open(newTask), 200);
            }
        }

        _resetInputs();
    };

    // Add button: quick add
    document.getElementById("add-btn").addEventListener("click", () => {
        if (!input.value.trim()) return;
        handleAdd(false);
    });

    // Dropdown arrow: add with detail panel
    document.getElementById("add-detail-btn").addEventListener("click", () => {
        if (!input.value.trim()) { showToast("Enter a task first"); return; }
        handleAdd(true);
    });

    input.addEventListener("keydown", e => { if (e.key === "Enter") handleAdd(false); });

    // Sidebar collapse toggle: SVG rotates 180° via CSS
    document.getElementById("sidebar-toggle-btn").addEventListener("click", () => {
        document.body.classList.toggle("sidebar-collapsed");
    });

    // Search
    document.getElementById("search-input").addEventListener("input", e => { searchQuery = e.target.value; renderAll(); });

    // Filters — now dynamically rendered by renderFilterButtons()

    // Archive search
    // Set today's date in picker by default
    document.getElementById("date-filter-picker").value = formatDateKey(new Date());

    // Date filter buttons
    document.querySelectorAll(".date-filter-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".date-filter-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            activeDateFilter = btn.dataset.date;
            document.getElementById("date-filter-picker").value = "";
            renderAll();
        });
    });

    // Date picker
    document.getElementById("date-filter-picker").addEventListener("change", e => {
        if (!e.target.value) return;
        document.querySelectorAll(".date-filter-btn").forEach(b => b.classList.remove("active"));
        activeDateFilter = e.target.value;
        renderAll();
    });

    // Overdue action button
    document.getElementById("overdue-action-btn").addEventListener("click", () => {
        const overdueTasks = _getOverdueTasks();
        if (!overdueTasks.length) return;
        _showOverdueModal(overdueTasks);
    });

    document.getElementById("archive-search").addEventListener("input", e => {
        archiveSearch = e.target.value;
        renderArchiveView();
    });

    // Archive export
    document.getElementById("archive-export").addEventListener("click", () => {
        const blob = new Blob([JSON.stringify(archivedTasks, null, 2)], { type: "application/json" });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
        a.download = "archive-" + formatDateKey(new Date()) + ".json";
        a.click(); URL.revokeObjectURL(a.href); showToast("Archive exported");
    });

    // Settings — Add category
    // Default calendar setting
    document.getElementById("default-calendar-select").addEventListener("change", (e) => {
        localStorage.setItem("my-tasks-default-calendar", e.target.value);
        showToast(e.target.value ? "Default calendar set" : "Default: Personal");
    });

    document.getElementById("cat-add-btn").addEventListener("click", () => {
        const label = document.getElementById("cat-new-label").value.trim();
        const color = document.getElementById("cat-new-color").value;
        if (!label) return;
        const id = label.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
        if (categories.some(c => c.id === id)) { showToast("Category already exists"); return; }
        categories.push({ id, label, color });
        saveCategories();
        document.getElementById("cat-new-label").value = "";
        renderAll();
        showToast(`Category "${label}" added`);
    });

    // Settings — Supabase test connection
    document.getElementById("sb-test").addEventListener("click", async () => {
        saveSupabaseSettings();
        const url = document.getElementById("sb-url").value.trim();
        const key = document.getElementById("sb-key").value.trim();
        const statusEl = document.getElementById("sb-status");

        if (!url || !key) { statusEl.textContent = "Please enter URL and Key"; statusEl.className = "sb-status error"; return; }

        statusEl.textContent = "Connecting..."; statusEl.className = "sb-status";
        const ok = DB.init(url, key);
        if (!ok) { statusEl.textContent = "Failed to initialize SDK"; statusEl.className = "sb-status error"; return; }

        const result = await DB.testConnection();
        if (result.ok) {
            statusEl.textContent = "Connected"; statusEl.className = "sb-status connected";
            showToast("Supabase connected");
        } else {
            statusEl.textContent = "Error: " + result.error; statusEl.className = "sb-status error";
            showToast("Connection failed: " + result.error);
            console.error("Connection test error:", result);
        }
    });

    // Settings — Supabase sync
    document.getElementById("sb-sync").addEventListener("click", async () => {
        saveSupabaseSettings();
        const url = document.getElementById("sb-url").value.trim();
        const key = document.getElementById("sb-key").value.trim();
        if (!url || !key) { showToast("Set Supabase URL and Key first"); return; }

        // Check login status — RLS requires user_id
        if (typeof Auth !== "undefined" && !Auth.getUserId()) {
            showToast("Please sign in with Google first to sync");
            return;
        }

        if (!DB.isConnected) DB.init(url, key);
        if (!DB.isConnected) { showToast("Cannot connect to Supabase"); return; }

        showToast("Syncing...");
        const result = await DB.syncToSupabase(tasks, archivedTasks, categories);
        if (result.ok) {
            showToast(`Synced: ${result.tasks} tasks, ${result.archived} archived, ${result.categories} categories`);
        } else {
            const errText = result.errors.join("\n");
            showToast(`Sync failed: ${result.errors.length} error(s)`);
            console.error("Sync errors:", result.errors);
            showErrorDialog("Sync Errors", errText);
        }
    });

    // Settings — Data export/import all
    // --- API Tokens (multiple, with name + expiry) ---
    const API_BASE = DEFAULT_SB_URL + "/functions/v1/api-proxy";

    function _formatTimeRemaining(expiresAt) {
        if (!expiresAt) return { text: "Never expires", cls: "active" };
        const diff = new Date(expiresAt) - Date.now();
        if (diff <= 0) return { text: "Expired", cls: "expired" };
        const hours = Math.floor(diff / 3600000);
        if (hours < 1) return { text: `${Math.floor(diff / 60000)}m left`, cls: "warning" };
        if (hours < 24) return { text: `${hours}h left`, cls: "warning" };
        const days = Math.floor(hours / 24);
        if (days < 7) return { text: `${days}d left`, cls: "active" };
        return { text: `${days}d left`, cls: "active" };
    }

    async function loadApiTokens() {
        if (!_useSupabase()) return;
        const { data } = await DB.supabase.from("api_tokens")
            .select("*").eq("user_id", Auth.getUserId()).eq("is_active", true)
            .order("created_at", { ascending: false });

        const list = document.getElementById("api-token-list");
        list.innerHTML = "";

        if (!data || data.length === 0) {
            list.innerHTML = '<div style="font-size:0.8rem;color:var(--text-faint);padding:8px;">No active tokens</div>';
        } else {
            for (const tok of data) {
                const expiry = _formatTimeRemaining(tok.expires_at);
                const isExpired = expiry.cls === "expired";
                const item = document.createElement("div");
                item.className = "api-token-item" + (isExpired ? " expired" : "");

                item.innerHTML = `
                    <div class="api-token-item-info">
                        <div class="api-token-item-name">${escapeHtml(tok.name || "Unnamed")}</div>
                        <div class="api-token-item-meta">
                            <span class="api-token-item-prefix">${tok.token_prefix}••••</span>
                            &middot; Created ${new Date(tok.created_at).toLocaleDateString()}
                            ${tok.last_used_at ? "&middot; Last used " + new Date(tok.last_used_at).toLocaleDateString() : ""}
                        </div>
                    </div>
                    <span class="api-token-item-expiry ${expiry.cls}">${expiry.text}</span>
                `;

                const delBtn = document.createElement("button");
                delBtn.className = "api-token-del-btn";
                delBtn.textContent = "Delete";
                delBtn.addEventListener("click", async () => {
                    if (!confirm(`Delete token "${tok.name || "Unnamed"}"? API access with this token will stop.`)) return;
                    await DB.supabase.from("api_tokens")
                        .update({ is_active: false }).eq("id", tok.id);
                    showToast("Token deleted");
                    loadApiTokens();
                });
                item.appendChild(delBtn);
                list.appendChild(item);
            }
        }

        // API docs
        const docsCode = document.getElementById("api-docs-code");
        docsCode.textContent =
`# List tasks
curl -X POST ${API_BASE} \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"action":"list"}'

# Create task
curl -X POST ${API_BASE} \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"action":"create","text":"Buy milk","category":"work"}'

# Update / Delete / Toggle
curl -X POST ${API_BASE} \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -d '{"action":"update","id":"TASK_ID","completed":true}'`;
    }

    document.getElementById("api-token-generate").addEventListener("click", async () => {
        if (!_useSupabase()) { showToast("Sign in first"); return; }
        if (!Auth.getUserId()) { showToast("Please sign in with Google first"); return; }

        const tokenName = document.getElementById("api-token-name").value.trim() || "Unnamed";
        const expiryHours = document.getElementById("api-token-expiry").value;

        try {
            // Generate token: mtsk_ + 32 random chars
            const arr = new Uint8Array(24);
            crypto.getRandomValues(arr);
            const rawToken = "mtsk_" + Array.from(arr, b => b.toString(16).padStart(2, "0")).join("");
            const prefix = rawToken.substring(0, 13);

            // Hash token (SHA-256)
            const encoder = new TextEncoder();
            const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(rawToken));
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const tokenHash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

            // Calculate expiry
            let expiresAt = null;
            if (expiryHours) {
                expiresAt = new Date(Date.now() + parseInt(expiryHours) * 3600000).toISOString();
            }

            // Save to DB
            const { error } = await DB.supabase.from("api_tokens").insert({
                user_id: Auth.getUserId(),
                token_hash: tokenHash,
                token_prefix: prefix,
                name: tokenName,
                expires_at: expiresAt,
                is_active: true,
            });
            if (error) {
                showErrorDialog("Token Save Failed", error.message + "\n\nIf 'expires_at' column missing, run:\nALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;");
                return;
            }

            // Show full token ONCE
            const alert = document.getElementById("api-token-new-alert");
            alert.style.display = "";
            document.getElementById("api-token-new-value").textContent = rawToken;

            // Copy to clipboard
            navigator.clipboard.writeText(rawToken).then(() => showToast(`Token "${tokenName}" created & copied!`));

            // Reset form
            document.getElementById("api-token-name").value = "";

            // Reload list
            loadApiTokens();

        } catch (e) {
            console.error("Token generation error:", e);
            showErrorDialog("Token Generation Failed", e.message || String(e));
        }
    });

    document.getElementById("api-token-copy-new").addEventListener("click", () => {
        const val = document.getElementById("api-token-new-value").textContent;
        navigator.clipboard.writeText(val).then(() => showToast("Copied!"));
    });

    // Expose for renderSettingsView
    window._loadApiTokens = loadApiTokens;

    // Load tokens on settings view
    if (_useSupabase()) loadApiTokens();

    document.getElementById("data-export-all").addEventListener("click", () => {
        const data = { tasks, archivedTasks, categories, settings };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
        a.download = "my-tasks-full-" + formatDateKey(new Date()) + ".json";
        a.click(); URL.revokeObjectURL(a.href); showToast("All data exported");
    });
    document.getElementById("data-import-all").addEventListener("click", () => {
        document.getElementById("data-import-file").click();
    });
    document.getElementById("data-import-file").addEventListener("change", e => {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            try {
                const d = JSON.parse(ev.target.result);
                if (confirm("Import data? This will replace all current data.")) {
                    if (d.tasks) { tasks = d.tasks; saveTasks(); }
                    if (d.archivedTasks) { archivedTasks = d.archivedTasks; saveArchive(); }
                    if (d.categories) { categories = d.categories; saveCategories(); }
                    renderAll();
                    showToast("Data imported");
                }
            } catch(_) { showToast("Invalid file"); }
        };
        reader.readAsText(file); e.target.value = "";
    });

    // Theme
    document.getElementById("theme-toggle").addEventListener("click", toggleTheme);

    // Voice summary buttons (sidebar + mobile)
    document.getElementById("voice-summary-btn").addEventListener("click", speakTodaySummary);
    const mobileVoiceBtn = document.getElementById("mobile-voice-btn");
    if (mobileVoiceBtn) mobileVoiceBtn.addEventListener("click", speakTodaySummary);

    // Reminder setting
    const reminderSel = document.getElementById("reminder-setting");
    if (reminderSel) {
        reminderSel.value = loadReminderSetting();
        reminderSel.addEventListener("change", () => {
            saveReminderSetting(reminderSel.value);
            _scheduleReminders();
            showToast(reminderSel.value === "0" ? "Reminders off" : `Reminders: ${reminderSel.value} min before`);
        });
    }

    // Test buttons
    document.getElementById("test-voice-btn").addEventListener("click", speakTodaySummary);
    document.getElementById("test-notification-btn").addEventListener("click", () => {
        _requestNotificationPermission();
        if ("Notification" in window && Notification.permission === "granted") {
            new Notification("Test Reminder", { body: "This is a test notification from Todo Manager" });
            showToast("Notification sent");
        } else {
            showToast("Please allow notifications first");
        }
    });

    // Clear completed
    document.getElementById("clear-completed-btn").addEventListener("click", clearCompleted);

    // View tabs
    document.querySelectorAll(".view-tab").forEach(btn => {
        btn.addEventListener("click", () => setActiveView(btn.dataset.view));
    });

    // Calendar navigation
    document.getElementById("cal-prev").addEventListener("click", () => Calendar.prev());
    document.getElementById("cal-next").addEventListener("click", () => Calendar.next());
    document.getElementById("cal-today").addEventListener("click", () => Calendar.goToday());
    document.querySelectorAll(".cal-mode-btn").forEach(btn => {
        btn.addEventListener("click", () => Calendar.setMode(btn.dataset.mode));
    });

    // Calendar popup
    document.getElementById("popup-save").addEventListener("click", () => Calendar.savePopup());
    document.getElementById("popup-delete").addEventListener("click", () => Calendar.deletePopupTask());
    document.getElementById("popup-cancel").addEventListener("click", () => Calendar.closePopup());
    document.getElementById("popup-text").addEventListener("keydown", e => { if (e.key === "Enter") Calendar.savePopup(); if (e.key === "Escape") Calendar.closePopup(); });

    // Detail side panel init
    if (typeof DetailPanel !== "undefined") DetailPanel.init();

    // Key masking toggle
    document.getElementById("sb-key-toggle").addEventListener("click", () => {
        const input = document.getElementById("sb-key");
        const isPassword = input.type === "password";
        input.type = isPassword ? "text" : "password";
        document.getElementById("sb-key-toggle").textContent = isPassword ? "🙈" : "👁";
    });

    // Detail modal
    document.getElementById("detail-save").addEventListener("click", saveDetailModal);
    document.getElementById("detail-archive").addEventListener("click", archiveFromDetail);
    document.getElementById("detail-delete").addEventListener("click", () => {
        if (_detailTaskId && confirm("Delete this task permanently?")) {
            deleteTask(_detailTaskId);
            closeDetailModal();
        }
    });
    document.getElementById("detail-close").addEventListener("click", closeDetailModal);

    // Export/Import moved to Settings (data-export-all, data-import-all)

    // Keyboard shortcuts
    document.addEventListener("keydown", e => {
        if (e.altKey) {
            switch (e.key.toLowerCase()) {
                case "n": e.preventDefault(); setActiveView("list"); input.focus(); break;
                case "d": e.preventDefault(); toggleTheme(); break;
                case "l": e.preventDefault(); setActiveView("list"); break;
                case "c": e.preventDefault(); setActiveView("calendar"); break;
                case "t": e.preventDefault(); if (settings.activeView === "calendar") Calendar.goToday(); break;
                case "f": e.preventDefault(); document.getElementById("sidebar-toggle-btn").click(); break;
                case "1": e.preventDefault(); activeFilter = "all"; saveFilter(); renderAll(); break;
                case "2": e.preventDefault(); activeFilter = "work"; saveFilter(); renderAll(); break;
                case "3": e.preventDefault(); activeFilter = "personal"; saveFilter(); renderAll(); break;
                case "4": e.preventDefault(); activeFilter = "study"; saveFilter(); renderAll(); break;
            }
        }
    });

    // Shared Calendar events (init is handled by Auth.init callback above)
    document.getElementById("shared-cal-create").addEventListener("click", () => {
        if (typeof SharedCalendar !== "undefined") SharedCalendar.showCreateModal();
    });

    // Discover public calendars
    document.getElementById("discover-calendars-btn").addEventListener("click", async () => {
        if (typeof SharedCalendar === "undefined") return;
        const listEl = document.getElementById("discover-calendar-list");
        const isOpen = listEl.style.display !== "none";
        if (isOpen) { listEl.style.display = "none"; return; }

        listEl.style.display = "";
        listEl.innerHTML = '<div style="font-size:0.8rem;color:var(--text-faint);padding:6px;">Loading...</div>';
        const cals = await SharedCalendar.loadPublicCalendars();
        listEl.innerHTML = "";

        if (!cals.length) {
            listEl.innerHTML = '<div style="font-size:0.8rem;color:var(--text-faint);padding:6px;">No public calendars found</div>';
            return;
        }

        for (const cal of cals) {
            const item = document.createElement("div");
            item.className = "discover-item";
            const dot = document.createElement("span");
            dot.className = "sc-dot"; dot.style.background = cal.color;
            const name = document.createElement("span");
            name.className = "discover-name"; name.textContent = cal.name;
            const desc = document.createElement("span");
            desc.className = "discover-desc"; desc.textContent = cal.description || "";
            const roleSelect = document.createElement("select");
            roleSelect.className = "sm-role-select";
            for (const r of ["editor", "viewer"]) {
                const o = document.createElement("option"); o.value = r; o.textContent = r;
                roleSelect.appendChild(o);
            }
            const reqBtn = document.createElement("button");
            reqBtn.className = "discover-req-btn";
            if (cal._status === "pending") {
                reqBtn.textContent = "Cancel";
                reqBtn.className = "discover-req-btn cancel";
                roleSelect.disabled = true;
                reqBtn.addEventListener("click", async () => {
                    await DB.supabase.from("calendar_members")
                        .delete().eq("calendar_id", cal.id).eq("user_id", Auth.getUserId());
                    showToast("Request cancelled");
                    // Refresh list
                    document.getElementById("discover-calendars-btn").click();
                    setTimeout(() => document.getElementById("discover-calendars-btn").click(), 300);
                });
            } else {
                reqBtn.textContent = "Request";
                reqBtn.addEventListener("click", async () => {
                    await SharedCalendar.requestAccess(cal.id, roleSelect.value);
                    reqBtn.textContent = "Pending";
                    reqBtn.disabled = true;
                    roleSelect.disabled = true;
                });
            }
            item.appendChild(dot);
            const info = document.createElement("div");
            info.className = "discover-info";
            info.appendChild(name);
            if (cal.description) info.appendChild(desc);
            item.appendChild(info);
            item.appendChild(roleSelect);
            item.appendChild(reqBtn);
            listEl.appendChild(item);
        }
    });

    // Real-time duplicate name check while typing
    document.getElementById("sc-name").addEventListener("input", (e) => {
        const name = e.target.value.trim();
        const warning = document.getElementById("sc-name-warning");
        const isDupe = name && typeof SharedCalendar !== "undefined" && SharedCalendar.hasCalendarName(name);
        warning.style.display = isDupe ? "" : "none";
        e.target.classList.toggle("has-error", isDupe);
        document.getElementById("sc-create-btn").disabled = isDupe;
    });

    document.getElementById("sc-create-btn").addEventListener("click", async () => {
        const nameInput = document.getElementById("sc-name");
        const name = nameInput.value.trim();
        const color = document.getElementById("sc-color").value;
        const desc = document.getElementById("sc-desc").value;
        if (!name) { nameInput.focus(); return; }
        if (typeof SharedCalendar !== "undefined" && SharedCalendar.hasCalendarName(name)) {
            nameInput.focus(); nameInput.select(); return;
        }
        const isPublic = document.getElementById("sc-public").checked;
        await SharedCalendar.createCalendar(name, color, desc, isPublic);
        SharedCalendar.hideCreateModal();
    });
    document.getElementById("sc-cancel-btn").addEventListener("click", () => {
        if (typeof SharedCalendar !== "undefined") SharedCalendar.hideCreateModal();
    });
    document.getElementById("sm-close-btn").addEventListener("click", () => {
        if (typeof SharedCalendar !== "undefined") SharedCalendar.hideMembersModal();
    });

    // Apply saved view
    setActiveView(settings.activeView || "list");
    if (settings.calendarMode) {
        document.querySelectorAll(".cal-mode-btn").forEach(b => b.classList.toggle("active", b.dataset.mode === settings.calendarMode));
    }
});
