// Created: 2026-04-06
// auth.js — Supabase Auth with Google OAuth
// Design Ref: §2 — Auth object, login/logout/session management

const Auth = {
    user: null,
    _supabase: null,
    _initialized: false,

    // Initialize: check existing session
    async init(supabaseClient) {
        if (!supabaseClient) {
            // No Supabase configured — show login page with setup message
            this.updateUI(false);
            return;
        }
        this._supabase = supabaseClient;

        // Check existing session
        try {
            const { data: { session } } = await this._supabase.auth.getSession();
            if (session) {
                this.user = session.user;
                this.updateUI(true);
            } else {
                // Not logged in — show login page
                this.updateUI(false);
            }
        } catch (e) {
            console.error("Auth init error:", e);
            // Error — stay on login page
            this.updateUI(false);
        }

        // Listen for auth state changes (handles OAuth redirect callback)
        this._supabase.auth.onAuthStateChange((event, session) => {
            if (event === "SIGNED_IN" && session) {
                this.user = session.user;
                this.updateUI(true);
                this._showUserInfo();
                // Load all data from Supabase after login
                if (typeof loadTasksFromSupabase === "function") loadTasksFromSupabase();
                if (typeof loadArchivedFromSupabase === "function") loadArchivedFromSupabase();
                if (typeof SharedCalendar !== "undefined" && DB.isConnected) {
                    SharedCalendar.init();
                }
            } else if (event === "SIGNED_OUT") {
                this.user = null;
                this.updateUI(false);
            }
        });

        this._initialized = true;
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
                    redirectTo: window.location.origin + window.location.pathname,
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

    // Sign out
    async signOut() {
        if (!this._supabase) return;
        try {
            await this._supabase.auth.signOut();
            this.user = null;
            this.updateUI(false);
            if (typeof showToast === "function") showToast("Signed out");
        } catch (e) {
            console.error("Sign out error:", e);
        }
    },

    // Get current user
    getUser() { return this.user; },

    // Get user ID for RLS
    getUserId() { return this.user ? this.user.id : null; },

    // Show/hide login page vs app
    updateUI(isLoggedIn) {
        const loginPage = document.getElementById("login-page");
        const app = document.getElementById("app-container");
        if (loginPage) loginPage.style.display = isLoggedIn ? "none" : "flex";
        if (app) app.style.display = isLoggedIn ? "flex" : "none";
        if (isLoggedIn) this._showUserInfo();
    },

    // Display user info in sidebar
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

            // Update app title to "Username's Tasks"
            const titleEl = document.getElementById("app-title");
            if (titleEl) {
                const firstName = displayName.split(" ")[0];
                titleEl.textContent = firstName + "'s Tasks";
            }
        } else {
            infoEl.style.display = "none";
        }
    },

    // Skip login (continue without auth)
    skipLogin() {
        this.updateUI(true);
    },
};
