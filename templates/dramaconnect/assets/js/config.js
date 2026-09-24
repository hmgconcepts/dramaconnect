/**
 * ============================================================================
 * __DC_APP_NAME__ v14.0 — Global Configuration
 * ============================================================================
 * __DC_ORG_NAME__ Management System.
 *
 * IMPORTANT (load order): the Supabase JS library MUST be loaded BEFORE this
 * file, e.g.:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 * The CDN build registers a global object named `supabase` (the library
 * namespace) which exposes `createClient`. We use that to build OUR client and
 * store it in the global `sb`.
 *
 * SECURITY NOTE: The anon/publishable key below is SAFE to expose in the
 * browser — it only grants the access allowed by your Row Level Security (RLS)
 * policies. NEVER place the service_role key here.
 * ============================================================================
 */
const CONFIG = {
    SUPABASE_URL: '__SUPABASE_URL__',
    SUPABASE_KEY: '__SUPABASE_ANON_KEY__',

    APP_NAME: '__DC_APP_NAME__',
    APP_VERSION: 'v14.0',
    PROVINCE: '__DC_PROVINCE__',
    CURRENCY: '__DC_CURRENCY__',

    // Feature flags — toggle modules on/off without deleting code.
    FEATURES: {
        announcements: true,
        events: true,
        casting: true,
        budgets: true,
        activityLog: true,
        pwa: true,
        darkMode: true
    },

    DEVELOPER: {
        name: 'Adewale Samson Adeagbo',
        brand: 'HMG Concepts',
        portfolio: 'https://cssadewale.pages.dev',
        agency: 'https://hmgconcepts.pages.dev'
    }
};

/**
 * Initialize the Supabase Client into the global `sb`.
 *
 * The original (buggy) code used `const supabase = supabase.createClient(...)`,
 * which redeclares `supabase`, shadows the library, and references it before
 * initialization → "supabase is not defined". We avoid that entirely by reading
 * `createClient` off `window.supabase` and storing the client as `sb`.
 */
var sb = null;

(function initSupabase() {
    if (typeof window.supabase === 'undefined' || typeof window.supabase.createClient !== 'function') {
        console.error(
            '[DramaConnect] Supabase library not found. Ensure ' +
            '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script> ' +
            'is loaded BEFORE config.js.'
        );
        document.addEventListener('DOMContentLoaded', function () {
            if (window.UI && UI.toast) {
                UI.toast('Connection library failed to load. Check your internet and refresh.', 'error', 8000);
            }
        });
        return;
    }
    sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true }
    });
    window.sb = sb;
    window.supabaseClient = sb;
    window.CONFIG = CONFIG;

    // The Drive scheduler is initialized after every parser-loaded script has
    // evaluated. Automatic checks never initiate Google OAuth.
    window.addEventListener('load', function () {
        if (window.DriveSync) window.DriveSync.initScheduler();
    }, { once: true });
})();
