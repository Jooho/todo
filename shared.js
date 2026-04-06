// Created: 2026-04-06
// shared.js — Shared Calendar: CRUD, members, invite, sidebar UI
// Design Ref: §2 — SharedCalendar object

const SharedCalendar = {
    calendars: [],
    enabledCalendarIds: [],
    _sharedTasks: [],
    _memberRoles: {},   // { calId: "owner"|"editor"|"viewer" }
    _currentCalId: null,

    // --- Init ---
    async init() {
        if (!DB.supabase || !DB.isConnected) return;
        const saved = localStorage.getItem("my-tasks-enabled-calendars");
        if (saved) try { this.enabledCalendarIds = JSON.parse(saved); } catch(_) {}
        await this.loadCalendars();
        await this.loadSharedTasks();
        this.renderCalendarList();
        this.subscribeToChanges();
        this._checkJoinLink();
        // Re-render to update calendar dropdowns
        if (typeof renderAll === "function") renderAll();
    },

    // --- Permissions ---
    getMyRole(calId) {
        return this._memberRoles[calId] || "viewer";
    },

    canEdit(calId) {
        const role = this.getMyRole(calId);
        return role === "owner" || role === "editor";
    },

    canDelete(calId) {
        const role = this.getMyRole(calId);
        return role === "owner";
    },

    canDeleteTask(task) {
        if (!task.shared_calendar_id) return true; // personal task
        const role = this.getMyRole(task.shared_calendar_id);
        if (role === "owner") return true; // owner can delete any task
        if (role === "editor" && task.user_id === Auth.getUserId()) return true; // editor can delete own
        return false;
    },

    canEditTask(task) {
        if (!task.shared_calendar_id) return true;
        return this.canEdit(task.shared_calendar_id);
    },

    // --- CRUD ---
    async loadCalendars() {
        if (!DB.supabase) return;
        try {
            // Calendars I own
            const { data: owned } = await DB.supabase
                .from("shared_calendars").select("*").eq("owner_id", Auth.getUserId());
            // Calendars I'm a member of
            const { data: memberships } = await DB.supabase
                .from("calendar_members").select("calendar_id").eq("user_id", Auth.getUserId());
            const memberCalIds = (memberships || []).map(m => m.calendar_id);
            let memberCals = [];
            if (memberCalIds.length) {
                const { data } = await DB.supabase
                    .from("shared_calendars").select("*").in("id", memberCalIds);
                memberCals = data || [];
            }
            // Merge and dedupe
            const all = [...(owned || []), ...memberCals];
            const seen = new Set();
            this.calendars = all.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; });

            // Load my roles for all calendars
            this._memberRoles = {};
            for (const c of this.calendars) {
                if (c.owner_id === Auth.getUserId()) {
                    this._memberRoles[c.id] = "owner";
                }
            }
            if (memberCalIds.length) {
                const { data: myMemberships } = await DB.supabase
                    .from("calendar_members").select("calendar_id, role")
                    .eq("user_id", Auth.getUserId());
                if (myMemberships) {
                    for (const m of myMemberships) {
                        if (!this._memberRoles[m.calendar_id]) this._memberRoles[m.calendar_id] = m.role;
                    }
                }
            }
        } catch (e) { console.error("Load calendars error:", e); }
    },

    // Check if a calendar name already exists in user's list
    hasCalendarName(name) {
        return this.calendars.some(c => c.name.toLowerCase() === name.toLowerCase());
    },

    async createCalendar(name, color, description) {
        if (!DB.supabase) { showToast("Supabase not connected"); return null; }
        if (!Auth.getUserId()) { showToast("Please sign in first"); return null; }
        // Duplicate name check
        if (this.hasCalendarName(name)) {
            showToast(`Calendar "${name}" already exists. Choose a different name.`);
            return null;
        }
        try {
            console.log("Creating calendar:", { name, color, owner: Auth.getUserId() });
            const { data, error } = await DB.supabase.from("shared_calendars").insert({
                name, color, description: description || "",
                owner_id: Auth.getUserId(),
            }).select().single();
            if (error) {
                console.error("Create calendar error:", error);
                showErrorDialog("Create Calendar Failed", error.message + "\n\nDetails: " + JSON.stringify(error, null, 2));
                return null;
            }
            // Add owner as member
            const { error: memberErr } = await DB.supabase.from("calendar_members").insert({
                calendar_id: data.id, user_id: Auth.getUserId(), role: "owner",
            });
            if (memberErr) console.error("Add owner as member error:", memberErr);
            await this.loadCalendars();
            this.enabledCalendarIds.push(data.id);
            this._saveEnabled();
            this.renderCalendarList();
            showToast(`Calendar "${name}" created`);
            return data;
        } catch (e) {
            console.error("Create calendar exception:", e);
            showErrorDialog("Create Calendar Error", e.message);
            return null;
        }
    },

    async deleteCalendar(calId) {
        if (!DB.supabase) return;
        if (!confirm("Delete this shared calendar and all its tasks?")) return;
        try {
            await DB.supabase.from("shared_calendars").delete().eq("id", calId);
            await this.loadCalendars();
            this.enabledCalendarIds = this.enabledCalendarIds.filter(id => id !== calId);
            this._saveEnabled();
            this.renderCalendarList();
            await this.loadSharedTasks();
            if (typeof renderAll === "function") renderAll();
            showToast("Calendar deleted");
        } catch (e) { console.error(e); }
    },

    // --- Members ---
    async getMembers(calId) {
        if (!DB.supabase) return [];
        try {
            const { data } = await DB.supabase
                .from("calendar_members").select("*").eq("calendar_id", calId);
            return data || [];
        } catch (e) { return []; }
    },

    async inviteMember(calId, email, role) {
        if (!DB.supabase) return;
        // Find user by email (requires profiles or auth.users access)
        // For now, we'll use the invite link approach
        showToast("Use the invite link to add members");
    },

    async removeMember(calId, userId) {
        if (!DB.supabase) return;
        try {
            await DB.supabase.from("calendar_members")
                .delete().eq("calendar_id", calId).eq("user_id", userId);
            showToast("Member removed");
        } catch (e) { console.error(e); }
    },

    async updateMemberRole(calId, userId, role) {
        if (!DB.supabase) return;
        try {
            await DB.supabase.from("calendar_members")
                .update({ role }).eq("calendar_id", calId).eq("user_id", userId);
            showToast("Role updated");
        } catch (e) { console.error(e); }
    },

    // --- Invite Link ---
    getInviteLink(cal) {
        if (!cal || !cal.invite_link_token) return "";
        return window.location.origin + window.location.pathname + "?join=" + cal.invite_link_token;
    },

    async joinByLink(token) {
        if (!DB.supabase || !Auth.getUserId()) return;
        try {
            // Fetch calendar info + owner email
            const { data: cal } = await DB.supabase
                .from("shared_calendars").select("id, name, color, description, owner_id").eq("invite_link_token", token).single();
            if (!cal) { showToast("Invalid invite link"); return; }

            // Check if already member
            const { data: existing } = await DB.supabase
                .from("calendar_members").select("id")
                .eq("calendar_id", cal.id).eq("user_id", Auth.getUserId()).maybeSingle();
            if (existing) { showToast("Already a member of " + cal.name); return; }

            // Get owner name from profiles
            let ownerName = "Unknown";
            try {
                const { data: ownerProfile } = await DB.supabase
                    .from("profiles").select("display_name, email")
                    .eq("id", cal.owner_id).single();
                if (ownerProfile) ownerName = ownerProfile.display_name || ownerProfile.email;
            } catch(_) {}

            // Ask user to confirm joining
            const accepted = confirm(
                `You've been invited to a shared calendar:\n\n` +
                `  📅 ${cal.name}\n` +
                `  ${cal.description ? "📝 " + cal.description + "\n" : ""}` +
                `  👤 Created by: ${ownerName}\n\n` +
                `Do you want to join this calendar?`
            );
            if (!accepted) { showToast("Invitation declined"); return; }

            // Check name conflict
            let displayName = cal.name;
            if (this.hasCalendarName(cal.name)) {
                const newName = prompt(
                    `You already have a calendar named "${cal.name}".\nEnter a different display name:`,
                    cal.name + " (shared)"
                );
                if (!newName || !newName.trim()) { showToast("Join cancelled"); return; }
                displayName = newName.trim();
            }

            await DB.supabase.from("calendar_members").insert({
                calendar_id: cal.id, user_id: Auth.getUserId(), role: "viewer",
            });
            await this.loadCalendars();

            // If renamed, save local alias
            if (displayName !== cal.name) {
                const aliases = JSON.parse(localStorage.getItem("my-tasks-cal-aliases") || "{}");
                aliases[cal.id] = displayName;
                localStorage.setItem("my-tasks-cal-aliases", JSON.stringify(aliases));
            }

            this.enabledCalendarIds.push(cal.id);
            this._saveEnabled();
            this.renderCalendarList();
            await this.loadSharedTasks();
            if (typeof renderAll === "function") renderAll();
            showToast(`Joined "${displayName}"`);
        } catch (e) { console.error(e); showToast("Join failed"); }
    },

    _checkJoinLink() {
        // Check URL parameter first
        const params = new URLSearchParams(window.location.search);
        const token = params.get("join");
        if (token) {
            // Save token and clean URL — token survives login redirect
            localStorage.setItem("my-tasks-pending-join", token);
            window.history.replaceState({}, "", window.location.pathname);
        }

        // Process any pending join (from URL or saved before login)
        const pendingToken = localStorage.getItem("my-tasks-pending-join");
        if (pendingToken && Auth.getUserId()) {
            localStorage.removeItem("my-tasks-pending-join");
            this.joinByLink(pendingToken);
        }
    },

    // --- Shared Tasks ---
    async loadSharedTasks() {
        if (!DB.supabase || !this.enabledCalendarIds.length) {
            this._sharedTasks = [];
            return;
        }
        try {
            const { data } = await DB.supabase
                .from("tasks").select("*")
                .in("shared_calendar_id", this.enabledCalendarIds)
                .eq("archived", false);
            this._sharedTasks = (data || []).map(row => ({
                id: row.id, text: row.text, description: row.description || "",
                category: row.category, completed: row.completed,
                dueDate: row.due_date, dueTime: row.due_time,
                createdAt: row.created_at, updatedAt: row.updated_at,
                shared_calendar_id: row.shared_calendar_id,
                user_id: row.user_id,
                subtasks: row.subtasks || [],
            }));
            // Load profiles for creator display
            const userIds = [...new Set(this._sharedTasks.map(t => t.user_id).filter(Boolean))];
            await this.loadProfiles(userIds);
        } catch (e) { console.error(e); this._sharedTasks = []; }
    },

    getTaskCalendarColor(task) {
        if (!task.shared_calendar_id) return null;
        const cal = this.calendars.find(c => c.id === task.shared_calendar_id);
        return cal ? cal.color : null;
    },

    // --- Toggle ---
    toggleCalendar(calId) {
        const idx = this.enabledCalendarIds.indexOf(calId);
        if (idx >= 0) this.enabledCalendarIds.splice(idx, 1);
        else this.enabledCalendarIds.push(calId);
        this._saveEnabled();
        this.loadSharedTasks().then(() => {
            this.renderCalendarList();
            this.subscribeToChanges(); // re-subscribe with updated calendar list
            if (typeof renderAll === "function") renderAll();
        });
    },

    _saveEnabled() {
        localStorage.setItem("my-tasks-enabled-calendars", JSON.stringify(this.enabledCalendarIds));
    },

    // --- UI: Sidebar calendar list ---
    renderCalendarList() {
        const container = document.getElementById("calendar-list");
        if (!container) return;
        container.innerHTML = "";

        const aliases = JSON.parse(localStorage.getItem("my-tasks-cal-aliases") || "{}");

        for (const cal of this.calendars) {
            const enabled = this.enabledCalendarIds.includes(cal.id);
            const displayName = aliases[cal.id] || cal.name;
            const item = document.createElement("div");
            item.className = "sc-item";

            const cb = document.createElement("input");
            cb.type = "checkbox"; cb.checked = enabled;
            cb.addEventListener("change", () => this.toggleCalendar(cal.id));

            const dot = document.createElement("span");
            dot.className = "sc-dot"; dot.style.background = cal.color;

            const name = document.createElement("span");
            name.className = "sc-name"; name.textContent = displayName;

            const gear = document.createElement("button");
            gear.className = "sc-gear"; gear.textContent = "⚙";
            gear.title = "Manage";
            gear.addEventListener("click", (e) => { e.stopPropagation(); this.showMembersModal(cal.id); });

            item.appendChild(cb);
            item.appendChild(dot);
            item.appendChild(name);
            item.appendChild(gear);
            container.appendChild(item);
        }
    },

    // --- UI: Create Modal ---
    showCreateModal() {
        const modal = document.getElementById("shared-create-modal");
        if (!modal) return;
        document.getElementById("sc-name").value = "";
        document.getElementById("sc-color").value = "#FF6B6B";
        document.getElementById("sc-desc").value = "";
        modal.style.display = "";
        // Overlay
        this._showOverlay(() => this.hideCreateModal());
        document.getElementById("sc-name").focus();
    },

    hideCreateModal() {
        document.getElementById("shared-create-modal").style.display = "none";
        this._hideOverlay();
    },

    // --- UI: Members Modal ---
    async showMembersModal(calId) {
        this._currentCalId = calId;
        const cal = this.calendars.find(c => c.id === calId);
        if (!cal) return;
        const isOwner = cal.owner_id === Auth.getUserId();

        // Calendar info
        document.getElementById("sm-cal-name").textContent = cal.name;
        document.getElementById("sm-cal-desc").textContent = cal.description || "";
        document.getElementById("sm-cal-dot").style.background = cal.color;

        const modal = document.getElementById("shared-members-modal");
        modal.style.display = "";
        this._showOverlay(() => this.hideMembersModal());

        // Invite link
        const link = this.getInviteLink(cal);
        document.getElementById("sm-link-display").value = link;
        document.getElementById("sm-copy-link").onclick = () => {
            navigator.clipboard.writeText(link).then(() => showToast("Link copied!"));
        };

        // Danger zone: only owner can delete
        const dangerZone = document.getElementById("sm-danger-zone");
        dangerZone.style.display = isOwner ? "" : "none";
        document.getElementById("sm-delete-cal").onclick = () => {
            this.deleteCalendar(calId);
            this.hideMembersModal();
        };

        // Load members + profiles
        const members = await this.getMembers(calId);
        const list = document.getElementById("sm-member-list");
        list.innerHTML = "";

        // Fetch profiles for all member user_ids
        const userIds = members.map(m => m.user_id);
        let profiles = {};
        if (userIds.length) {
            try {
                const { data } = await DB.supabase
                    .from("profiles").select("id, email, display_name, avatar_url")
                    .in("id", userIds);
                if (data) data.forEach(p => profiles[p.id] = p);
            } catch(_) {}
        }

        for (const m of members) {
            const profile = profiles[m.user_id] || {};
            const isMe = m.user_id === Auth.getUserId();
            const displayName = isMe ? "You" : (profile.display_name || profile.email || "Unknown");
            const email = profile.email || "";

            const row = document.createElement("div");
            row.className = "sm-member-row";

            // Avatar
            if (profile.avatar_url) {
                const img = document.createElement("img");
                img.className = "sm-member-avatar"; img.src = profile.avatar_url; img.alt = "";
                row.appendChild(img);
            } else {
                const placeholder = document.createElement("div");
                placeholder.className = "sm-member-avatar";
                placeholder.textContent = displayName.charAt(0).toUpperCase();
                row.appendChild(placeholder);
            }

            // Name + email
            const info = document.createElement("div");
            info.className = "sm-member-info";
            info.innerHTML = `<div class="sm-member-name">${displayName}</div>` +
                (email && !isMe ? `<div class="sm-member-email">${email}</div>` : "");
            row.appendChild(info);

            // Role: owner sees dropdown to change role, others see badge
            if (isOwner && !isMe && m.role !== "owner") {
                const roleSelect = document.createElement("select");
                roleSelect.className = "sm-role-select";
                for (const r of ["editor", "viewer"]) {
                    const o = document.createElement("option");
                    o.value = r; o.textContent = r;
                    if (r === m.role) o.selected = true;
                    roleSelect.appendChild(o);
                }
                roleSelect.addEventListener("change", async () => {
                    await this.updateMemberRole(calId, m.user_id, roleSelect.value);
                    this.showMembersModal(calId); // refresh
                });
                row.appendChild(roleSelect);

                const removeBtn = document.createElement("button");
                removeBtn.className = "sm-remove-btn"; removeBtn.textContent = "Remove";
                removeBtn.addEventListener("click", async () => {
                    if (confirm(`Remove ${displayName} from this calendar?`)) {
                        await this.removeMember(calId, m.user_id);
                        this.showMembersModal(calId);
                    }
                });
                row.appendChild(removeBtn);
            } else {
                const badge = document.createElement("span");
                badge.className = "sm-member-role-badge " + m.role;
                badge.textContent = m.role;
                row.appendChild(badge);
            }

            list.appendChild(row);
        }
    },

    hideMembersModal() {
        document.getElementById("shared-members-modal").style.display = "none";
        this._hideOverlay();
        this._currentCalId = null;
    },

    // --- Realtime ---
    _subscription: null,

    subscribeToChanges() {
        if (!DB.supabase || !this.enabledCalendarIds.length) return;
        this.unsubscribe(); // clean up previous

        this._subscription = DB.supabase
            .channel("shared-tasks-changes")
            .on("postgres_changes", {
                event: "*",
                schema: "public",
                table: "tasks",
                filter: `shared_calendar_id=in.(${this.enabledCalendarIds.join(",")})`,
            }, (payload) => {
                console.log("Realtime event:", payload.eventType);
                // Reload shared tasks and re-render
                this.loadSharedTasks().then(() => {
                    if (typeof renderAll === "function") renderAll();
                });
            })
            .subscribe((status) => {
                if (status === "SUBSCRIBED") console.log("Realtime: subscribed to shared tasks");
            });
    },

    unsubscribe() {
        if (this._subscription) {
            DB.supabase.removeChannel(this._subscription);
            this._subscription = null;
        }
    },

    // --- Profile cache for creator names ---
    _profileCache: {},

    async loadProfiles(userIds) {
        if (!DB.supabase || !userIds.length) return;
        const uncached = userIds.filter(id => !this._profileCache[id]);
        if (!uncached.length) return;
        try {
            const { data } = await DB.supabase
                .from("profiles").select("id, display_name, email, avatar_url")
                .in("id", uncached);
            if (data) data.forEach(p => this._profileCache[p.id] = p);
        } catch(_) {}
    },

    getCreatorName(userId) {
        if (!userId) return "";
        if (userId === Auth.getUserId()) return "You";
        const p = this._profileCache[userId];
        return p ? (p.display_name || p.email || "Unknown") : "";
    },

    // --- Overlay helper ---
    _overlay: null,
    _showOverlay(onClose) {
        if (!this._overlay) {
            this._overlay = document.createElement("div");
            this._overlay.className = "popup-overlay";
            document.body.appendChild(this._overlay);
        }
        this._overlay.onclick = onClose;
        this._overlay.style.display = "";
    },
    _hideOverlay() {
        if (this._overlay) this._overlay.style.display = "none";
    },
};
