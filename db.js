// Created: 2026-04-05 23:30
// db.js — Supabase data layer + sync engine
// Design Ref: §2 — Offline-first, localStorage primary, Supabase backup

const DB = {
    // --- Connection state ---
    supabase: null,
    isConnected: false,
    _statusEl: null,

    // --- Initialize Supabase client ---
    init(url, key) {
        if (!url || !key || !url.startsWith("http")) { this.isConnected = false; return false; }
        try {
            // supabase-js loaded via CDN exposes window.supabase
            if (typeof window.supabase === "undefined" || !window.supabase.createClient) {
                console.warn("Supabase SDK not loaded");
                this.isConnected = false;
                return false;
            }
            this.supabase = window.supabase.createClient(url, key);
            this.isConnected = true;
            return true;
        } catch (e) {
            console.error("Supabase init failed:", e);
            this.isConnected = false;
            return false;
        }
    },

    // --- Test connection ---
    async testConnection() {
        if (!this.supabase) return { ok: false, error: "Not initialized" };
        try {
            const { data, error } = await this.supabase.from("tasks").select("id").limit(1);
            if (error) return { ok: false, error: error.message };
            return { ok: true, count: data ? data.length : 0 };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    },

    disconnect() {
        this.supabase = null;
        this.isConnected = false;
    },

    // --- Sync: Push localStorage → Supabase ---
    async syncToSupabase(tasks, archivedTasks, categories) {
        if (!this.supabase) return { ok: false, error: "Not connected" };

        const results = { tasks: 0, archived: 0, categories: 0, errors: [] };

        // Sync active tasks
        for (const task of tasks) {
            try {
                const row = this._taskToRow(task);
                const { error } = await this.supabase.from("tasks").upsert(row, { onConflict: "id" });
                if (error) results.errors.push(`Task ${task.id}: ${error.message}`);
                else results.tasks++;
            } catch (e) { results.errors.push(`Task ${task.id}: ${e.message}`); }
        }

        // Sync archived tasks
        for (const task of archivedTasks) {
            try {
                const row = this._taskToRow(task);
                row.archived = true;
                row.archived_at = task.archivedAt || null;
                const { error } = await this.supabase.from("tasks").upsert(row, { onConflict: "id" });
                if (error) results.errors.push(`Archive ${task.id}: ${error.message}`);
                else results.archived++;
            } catch (e) { results.errors.push(`Archive ${task.id}: ${e.message}`); }
        }

        // Sync categories
        for (const cat of categories) {
            try {
                const { error } = await this.supabase.from("categories").upsert({
                    id: cat.id, label: cat.label, color: cat.color, sort_order: 0,
                    user_id: (typeof Auth !== "undefined" && Auth.getUserId()) ? Auth.getUserId() : null,
                }, { onConflict: "id" });
                if (error) results.errors.push(`Category ${cat.id}: ${error.message}`);
                else results.categories++;
            } catch (e) { results.errors.push(`Category ${cat.id}: ${e.message}`); }
        }

        results.ok = results.errors.length === 0;
        return results;
    },

    // --- Sync: Pull Supabase → localStorage ---
    async syncFromSupabase() {
        if (!this.supabase) return { ok: false, error: "Not connected" };

        try {
            // Fetch all tasks
            const { data: allTasks, error: tErr } = await this.supabase
                .from("tasks").select("*").order("created_at", { ascending: true });
            if (tErr) return { ok: false, error: tErr.message };

            // Fetch categories
            const { data: cats, error: cErr } = await this.supabase
                .from("categories").select("*").order("sort_order", { ascending: true });
            if (cErr) return { ok: false, error: cErr.message };

            // Split active vs archived
            const activeTasks = [];
            const archivedTasks = [];
            for (const row of (allTasks || [])) {
                const task = this._rowToTask(row);
                if (row.archived) {
                    task.archived = true;
                    task.archivedAt = row.archived_at;
                    archivedTasks.push(task);
                } else {
                    activeTasks.push(task);
                }
            }

            // Convert categories
            const categories = (cats || []).map(c => ({
                id: c.id, label: c.label, color: c.color
            }));

            return { ok: true, tasks: activeTasks, archivedTasks, categories };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    },

    // --- Row conversion helpers ---
    _taskToRow(task) {
        return {
            id: task.id,
            text: task.text,
            description: task.description || "",
            category: task.category || "work",
            completed: !!task.completed,
            archived: !!task.archived,
            archived_at: task.archivedAt || null,
            due_date: task.dueDate || null,
            due_time: task.dueTime || null,
            created_at: task.createdAt,
            updated_at: task.updatedAt || task.createdAt,
            user_id: (typeof Auth !== "undefined" && Auth.getUserId()) ? Auth.getUserId() : null,
            subtasks: task.subtasks || [],
            recurrence: task.recurrence || null,
            recurrence_parent_id: task.recurrence_parent_id || null,
        };
    },

    _rowToTask(row) {
        let subtasks = [];
        try { subtasks = typeof row.subtasks === "string" ? JSON.parse(row.subtasks) : (row.subtasks || []); } catch(_) {}
        return {
            id: row.id,
            text: row.text,
            description: row.description || "",
            category: row.category || "work",
            completed: !!row.completed,
            dueDate: row.due_date || null,
            dueTime: row.due_time || null,
            createdAt: row.created_at,
            updatedAt: row.updated_at || row.created_at,
            subtasks: subtasks,
            user_id: row.user_id || null,
            shared_calendar_id: row.shared_calendar_id || null,
            recurrence: typeof row.recurrence === "string" ? JSON.parse(row.recurrence) : (row.recurrence || null),
            recurrence_parent_id: row.recurrence_parent_id || null,
        };
    },
};
