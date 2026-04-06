// Created: 2026-04-06
// auth.js — Supabase Auth with Google OAuth + user approval system

const ADMIN_EMAIL = "ljhiyh@gmail.com";

const Auth = {
    user: null,
    _supabase: null,
    _initialized: false,
    _isApproved: false,
    _isAdmin: false,

    // Initialize: check existing session
    async init(supabaseClient) {
        if (!supabaseClient) {
            this.updateUI(false);
            return;
        }
        this._supabase = supabaseClient;

        try {
            const { data: { session } } = await this._supabase.auth.getSession();
            if (session) {
                this.user = session.user;
                await this._checkApproval();
            } else {
                this.updateUI(false);
            }
        } catch (e) {
            console.error("Auth init error:", e);
            this.updateUI(false);
        }

        this._supabase.auth.onAuthStateChange(async (event, session) => {
            if (event === "SIGNED_IN" && session) {
                this.user = session.user;
                await this._checkApproval();
            } else if (event === "SIGNED_OUT") {
                this.user = null;
                this._isApproved = false;
                this._isAdmin = false;
                this.updateUI(false);
            }
        });

        this._initialized = true;
    },

    // Check if user is approved
    async _checkApproval() {
        if (!this.user || !this._supabase) return;
        const email = this.user.email;
        this._isAdmin = email === ADMIN_EMAIL;

        // Admin is always approved
        if (this._isAdmin) {
            this._isApproved = true;
            this.updateUI(true);
            this._showUserInfo();
            this._loadData();
            this._subscribeApprovals();
            return;
        }

        // Check approved_users table
        try {
            const { data, error } = await this._supabase
                .from("approved_users")
                .select("status")
                .eq("email", email)
                .maybeSingle();

            if (error) {
                // Table might not exist yet — allow admin, block others
                console.error("Approval check error:", error);
                this._showPendingUI("Access check failed. Contact admin.");
                return;
            }

            if (!data) {
                // New user — register as pending
                await this._supabase.from("approved_users").insert({
                    email: email,
                    status: "pending",
                });
                // Notify admin via email
                this._sendNotification("access_request", { email });
                this._showPendingUI("Your access request has been sent. Please wait for admin approval.");
                return;
            }

            if (data.status === "approved") {
                this._isApproved = true;
                this.updateUI(true);
                this._showUserInfo();
                this._loadData();
            } else if (data.status === "rejected") {
                this._showPendingUI("Your access has been denied. Contact admin.");
            } else {
                this._showPendingUI("Your access request is pending. Please wait for admin approval.");
            }
        } catch (e) {
            console.error("Approval check exception:", e);
            this._showPendingUI("Access check failed.");
        }
    },

    _loadData() {
        if (typeof loadTasksFromSupabase === "function") loadTasksFromSupabase();
        if (typeof loadArchivedFromSupabase === "function") loadArchivedFromSupabase();
        if (typeof SharedCalendar !== "undefined" && DB.isConnected) SharedCalendar.init();
    },

    _showPendingUI(message) {
        const loginPage = document.getElementById("login-page");
        const app = document.getElementById("app-container");
        const pending = document.getElementById("pending-page");
        if (loginPage) loginPage.style.display = "none";
        if (app) app.style.display = "none";
        if (pending) {
            pending.style.display = "flex";
            const msgEl = document.getElementById("pending-message");
            if (msgEl) msgEl.textContent = message;
            const emailEl = document.getElementById("pending-email");
            if (emailEl) emailEl.textContent = this.user ? this.user.email : "";
        }
    },

    // Google OAuth sign in
    async signInWithGoogle() {
        if (!this._supabase) {
            if (typeof showToast === "function") showToast("Set up Supabase first in Settings");
            return;
        }
        try {
            const { error } = await this._supabase.auth.signInWithOAuth({
                provider: "google",
                options: {
                    redirectTo: window.location.href.split("?")[0].split("#")[0],
                },
            });
            if (error) {
                console.error("Google sign in error:", error);
                if (typeof showToast === "function") showToast("Login failed: " + error.message);
            }
        } catch (e) {
            console.error("Sign in error:", e);
            if (typeof showToast === "function") showToast("Login error");
        }
    },

    async signOut() {
        if (!this._supabase) return;
        try {
            await this._supabase.auth.signOut();
            this.user = null;
            this._isApproved = false;
            this._isAdmin = false;
            this.updateUI(false);
            // Hide pending page too
            const pending = document.getElementById("pending-page");
            if (pending) pending.style.display = "none";
            if (typeof showToast === "function") showToast("Signed out");
        } catch (e) {
            console.error("Sign out error:", e);
        }
    },

    getUser() { return this.user; },
    getUserId() { return this.user ? this.user.id : null; },
    isAdmin() { return this._isAdmin; },

    updateUI(isLoggedIn) {
        const loginPage = document.getElementById("login-page");
        const app = document.getElementById("app-container");
        const pending = document.getElementById("pending-page");
        if (loginPage) loginPage.style.display = isLoggedIn ? "none" : "flex";
        if (app) app.style.display = isLoggedIn ? "flex" : "none";
        if (pending) pending.style.display = "none";
        if (isLoggedIn) this._showUserInfo();
    },

    _showUserInfo() {
        const infoEl = document.getElementById("user-info");
        if (!infoEl) return;
        if (this.user) {
            const meta = this.user.user_metadata || {};
            const avatar = document.getElementById("user-avatar");
            const name = document.getElementById("user-name");
            if (avatar && meta.avatar_url) { avatar.src = meta.avatar_url; avatar.style.display = ""; }
            else if (avatar) { avatar.style.display = "none"; }
            const displayName = meta.full_name || meta.name || this.user.email || "User";
            if (name) name.textContent = displayName;
            infoEl.style.display = "flex";
            const firstName = displayName.split(" ")[0];
            const titleEl = document.getElementById("app-title");
            if (titleEl) titleEl.textContent = firstName + "'s Tasks";
            const mobileTitle = document.getElementById("mobile-title");
            if (mobileTitle) mobileTitle.textContent = firstName + "'s Tasks";
        } else {
            infoEl.style.display = "none";
        }
    },

    // --- Admin: load pending users ---
    async loadPendingUsers() {
        if (!this._isAdmin || !this._supabase) return [];
        try {
            const { data } = await this._supabase
                .from("approved_users")
                .select("*")
                .order("requested_at", { ascending: false });
            return data || [];
        } catch (e) { return []; }
    },

    // Realtime: admin gets notified of new access requests
    _approvalSub: null,
    _subscribeApprovals() {
        if (!this._isAdmin || !this._supabase) return;
        if (this._approvalSub) this._supabase.removeChannel(this._approvalSub);
        this._approvalSub = this._supabase
            .channel("approval-changes")
            .on("postgres_changes", { event: "*", schema: "public", table: "approved_users" }, () => {
                // Re-render user management if Settings is open
                if (typeof _renderUserManagement === "function") _renderUserManagement();
                if (typeof showToast === "function") showToast("New access request received");
            })
            .subscribe();
    },

    // Send notification email via Edge Function
    async _sendNotification(type, data) {
        if (!this._supabase) return;
        try {
            const { error } = await this._supabase.functions.invoke("send-notification", {
                body: { type, data },
            });
            if (error) console.error("Notification error:", error);
        } catch (e) { console.error("Notification send failed:", e); }
    },

    async approveUser(email) {
        if (!this._isAdmin || !this._supabase) return;
        await this._supabase.from("approved_users")
            .update({ status: "approved", reviewed_at: new Date().toISOString(), reviewed_by: ADMIN_EMAIL })
            .eq("email", email);
    },

    async rejectUser(email) {
        if (!this._isAdmin || !this._supabase) return;
        await this._supabase.from("approved_users")
            .update({ status: "rejected", reviewed_at: new Date().toISOString(), reviewed_by: ADMIN_EMAIL })
            .eq("email", email);
    },

    async removeUser(email) {
        if (!this._isAdmin || !this._supabase) return;
        if (email === ADMIN_EMAIL) return; // can't remove self
        await this._supabase.from("approved_users").delete().eq("email", email);
    },
};
