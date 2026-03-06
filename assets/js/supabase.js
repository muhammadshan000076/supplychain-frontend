// supabase.js - initialize client
const SUPABASE_URL = 'https://nnldteqvpalicpshvggi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ubGR0ZXF2cGFsaWNwc2h2Z2dpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyNjI0ODQsImV4cCI6MjA4NzgzODQ4NH0.4fEbXBX5oMU2_3tNWV7voB8a5VJOWt9zspikDpTWDvk';

// wait for supabase library to load
let supabaseClient = null;

function initSupabase() {
    if (!window.supabase) {
        console.error('Supabase library not loaded');
        setTimeout(initSupabase, 100);
        return;
    }
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    window.supabaseClient = supabaseClient;
}

// initialize on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSupabase);
} else {
    initSupabase();
}

// helper to get current session
async function getSession() {
    if (!supabaseClient) {
        await new Promise(resolve => {
            const check = setInterval(() => {
                if (supabaseClient) {
                    clearInterval(check);
                    resolve();
                }
            }, 100);
        });
    }
    const { data } = await supabaseClient.auth.getSession();
    return data.session;
}

// redirect if not logged in
async function requireAuth() {
    const session = await getSession();
    if (!session) {
        location.href = 'login.html';
    }
    return session;
}

// Demo seeding removed for production
