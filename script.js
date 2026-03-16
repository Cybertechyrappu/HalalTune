// ==========================================
// 0. PWA SERVICE WORKER
// ==========================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => console.log(err));
    });
}

// ==========================================
// 1. FIREBASE INIT
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyD7bc74wJSIRi1_BhDqFjEMG2mE3noBm4g",
    authDomain: "halaltune-6c908.firebaseapp.com",
    projectId: "halaltune-6c908",
    storageBucket: "halaltune-6c908.firebasestorage.app",
    messagingSenderId: "159242961546",
    appId: "1:159242961546:web:65bdcd9c3fee61c661e373"
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

// ── Explicitly set persistence to LOCAL so the session survives
//    tab closes, browser restarts, and webview reloads on all platforms.
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {
    // Fallback silently — some browsers restrict IndexedDB
    auth.setPersistence(firebase.auth.Auth.Persistence.SESSION).catch(() => {});
});

// ── Enable Firestore offline persistence so cached data loads
//    even on slow/no connections (important for PWA)
db.enablePersistence({ synchronizeTabs: true }).catch(err => {
    if (err.code === 'failed-precondition') {
        // Multiple tabs open — persistence only works in one
        db.enablePersistence().catch(() => {});
    }
    // 'unimplemented' — browser doesn't support it, fail silently
});

// ==========================================
// 2. STATE
// ==========================================
let allTracks        = [];
let currentQueue     = [];
let currentTrackIndex = -1;
let isShuffle        = false;
let isRepeat         = false;
let likedSongIds     = new Set();
let currentTab       = 'all';   // 'all' | 'categories' | 'library' | 'liked'

// Per-section "see all" state
const seeAllState = { arabic: false, malayalam: false, english: false, urdu: false, others: false };

// Language categories — order matters (display order on screen)
const CATEGORIES = [
    { key: 'arabic',    label: 'Arabic'   },
    { key: 'malayalam', label: 'Malayalam' },
    { key: 'english',   label: 'English'  },
    { key: 'urdu',      label: 'Urdu'     },
    { key: 'others',    label: 'Others'   },
];
const PREVIEW_COUNT   = 5;
let speedDialPicks = [];   // shuffled once per page load, set when tracks are fetched
const RECENTS_MAX   = 8;    // max shown in Recents strip
const HISTORY_MAX   = 50;   // max stored in Firestore history

// In-memory history array — [{id, playedAt}] most-recent first
// Loaded from Firestore on login, cleared on logout
let historyList = [];

// Save a play to Firestore + update in-memory list
async function addToHistory(trackId) {
    const entry = { id: trackId, playedAt: Date.now() };

    // Update in-memory list (deduplicate, keep newest first)
    historyList = historyList.filter(e => e.id !== trackId);
    historyList.unshift(entry);
    if (historyList.length > HISTORY_MAX) historyList = historyList.slice(0, HISTORY_MAX);

    // Persist to Firestore if signed in
    if (auth.currentUser) {
        const uid = auth.currentUser.uid;
        db.collection('users').doc(uid).collection('history').doc(trackId).set({
            trackId,
            playedAt: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(() => {});
    }
}

// Load history from Firestore into memory
async function loadHistoryFromFirestore(uid) {
    try {
        const snap = await db.collection('users').doc(uid).collection('history')
            .orderBy('playedAt', 'desc')
            .limit(HISTORY_MAX)
            .get();
        historyList = snap.docs.map(doc => ({
            id:       doc.data().trackId,
            playedAt: doc.data().playedAt?.toMillis?.() || 0
        }));
    } catch { historyList = []; }
}

// Recent IDs for the home strip (first RECENTS_MAX from history)
function getRecentIds() {
    return historyList.slice(0, RECENTS_MAX).map(e => e.id);
}
// Full history IDs (up to HISTORY_MAX)
function getHistoryIds() {
    return historyList.map(e => e.id);
}
// Keep addToRecents as alias so existing call in playTrack still works
function addToRecents(trackId) { addToHistory(trackId); }

let localUserId = localStorage.getItem('halaltune_uid');
if (!localUserId) {
    localUserId = 'anon_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('halaltune_uid', localUserId);
}

// ==========================================
// 3. AUTH & ROUTING
// ==========================================
const introScreen = document.getElementById('intro-screen');
const authScreen  = document.getElementById('auth-screen');
const appMain     = document.getElementById('app-main');

// Show a neutral loading state instantly so there is no flash of the
// intro screen while Firebase resolves the cached session (~0.5–2 s).
introScreen.style.display  = 'none';
authScreen.style.display   = 'none';
appMain.style.display      = 'none';

// Skeleton / spinner shown while auth state resolves
const authLoadingEl = document.getElementById('auth-loading');
if (authLoadingEl) authLoadingEl.style.display = 'flex';

let appInitialised = false;  // guard — only run setup once per session
let _unsubLikes = null; // holds likes onSnapshot unsubscribe fn

auth.onAuthStateChanged(user => {
    // Hide the loading screen whatever happens
    if (authLoadingEl) authLoadingEl.style.display = 'none';

    if (user) {
        // ── Logged in ──────────────────────────────────────────────────────
        introScreen.style.display = 'none';
        authScreen.style.display  = 'none';
        appMain.style.display     = 'flex';
        appMain.style.opacity     = '1';   // set directly — skip GSAP to avoid
                                           // "invisible app" if animation misses

        // Update lastLogin in Firestore (fire-and-forget)
        db.collection('users').doc(user.uid).set(
            { lastLogin: firebase.firestore.FieldValue.serverTimestamp() },
            { merge: true }
        ).catch(() => {});

        // Populate profile UI with cached user data immediately
        populateProfileUI(user);

        // Only run heavy setup once (guard against onAuthStateChanged firing
        // multiple times in the same session, e.g. token refresh)
        if (!appInitialised) {
            appInitialised = true;

            // Likes listener — real-time (stored so we can unsubscribe on logout)
            _unsubLikes = db.collection('users').doc(user.uid).collection('likes').onSnapshot(
                snap => {
                    likedSongIds.clear();
                    snap.forEach(doc => likedSongIds.add(doc.id));
                    updateGlobalLikeButtons();
                    renderCurrentView();
                },
                () => {}
            );

            // Load history then fetch tracks (parallel)
            Promise.all([
                loadHistoryFromFirestore(user.uid),
                fetchAllTracks()
            ]).then(() => renderCurrentView()).catch(() => renderCurrentView());
        }

    } else {
        // ── Logged out ─────────────────────────────────────────────────────
        appInitialised = false;
        historyList    = [];
        if (_unsubLikes)  { _unsubLikes();  _unsubLikes  = null; }
        if (_unsubTracks) { _unsubTracks(); _unsubTracks = null; }
        likedSongIds.clear();
        allTracks = [];
        appMain.style.display    = 'none';
        authScreen.style.display = 'none';
        introScreen.style.display = 'flex';
        introScreen.style.opacity = '1';
    }
});

document.getElementById('get-started-btn').addEventListener('click', () => {
    gsap.to(introScreen, { y: -50, opacity: 0, duration: 0.4, onComplete: () => {
        introScreen.style.display = 'none';
        authScreen.style.display  = 'flex';
        gsap.fromTo(authScreen, { y: 50, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: 'power3.out' });
    }});
});

// Handle redirect result (fires when Google redirects back after signInWithRedirect).
// onAuthStateChanged handles the actual login — this just catches errors.
auth.getRedirectResult().then(result => {
    // Successful redirect — onAuthStateChanged fires automatically.
    if (result && result.user) {
        // Reset the login button label in case the page kept its state
        const btn = document.getElementById('google-login-btn');
        if (btn) {
            btn.disabled  = false;
            btn.innerHTML = '<i class="fa-brands fa-google"></i> Continue with Google';
        }
    }
}).catch(err => {
    // Ignore the "no redirect" non-error — only log real failures
    const ignoreCodes = ['auth/no-auth-event', 'auth/null-user'];
    if (!ignoreCodes.includes(err.code)) {
        console.warn('Redirect sign-in result:', err.code, err.message);
        // Reset the button if the redirect itself errored
        const btn = document.getElementById('google-login-btn');
        if (btn) {
            btn.disabled  = false;
            btn.innerHTML = '<i class="fa-brands fa-google"></i> Continue with Google';
        }
    }
});

document.getElementById('google-login-btn').addEventListener('click', () => {
    if (window.AndroidBridge && window.AndroidBridge.loginWithGoogle) {
        // Native Android bridge (HalalTune APK)
        window.AndroidBridge.loginWithGoogle();
        return;
    }

    const btn = document.getElementById('google-login-btn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Signing in...';

    const provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope('email');
    provider.addScope('profile');

    // Try popup first (works in real browsers + Firebase Hosting preview).
    // If the environment blocks popups (Spck webview, iframe, etc.),
    // automatically fall back to redirect — page reloads and
    // getRedirectResult() above catches the result.
    auth.signInWithPopup(provider).catch(err => {
        const blockedCodes = [
            'auth/popup-blocked',
            'auth/popup-closed-by-user',
            'auth/cancelled-popup-request',
            'auth/operation-not-supported-in-this-environment',
            'auth/web-storage-unsupported',
        ];
        if (blockedCodes.includes(err.code)) {
            // Show redirect message before the page navigates away
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Redirecting...';
            auth.signInWithRedirect(provider).catch(e => {
                btn.disabled = false;
                btn.innerHTML = '<i class="fa-brands fa-google"></i> Continue with Google';
                alert('Login failed: ' + e.message);
            });
        } else {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-brands fa-google"></i> Continue with Google';
            alert('Login failed: ' + err.message);
        }
    });
});

window.firebaseNativeLogin = function(idToken) {
    const credential = firebase.auth.GoogleAuthProvider.credential(idToken);
    auth.signInWithCredential(credential).catch(err => alert('Authentication Failed: ' + err.message));
};

// ==========================================
// EMAIL / PASSWORD AUTH (works in all envs)
// ==========================================
function setAuthError(msg) {
    const el = document.getElementById('auth-error');
    if (!el) return;
    el.innerText = msg;
    el.style.display = msg ? 'block' : 'none';
}

document.getElementById('email-signin-btn')?.addEventListener('click', async () => {
    const email = document.getElementById('auth-email')?.value.trim();
    const pass  = document.getElementById('auth-password')?.value;
    if (!email || !pass) { setAuthError('Please enter your email and password.'); return; }
    const btn = document.getElementById('email-signin-btn');
    btn.disabled = true;
    btn.innerText = 'Signing in...';
    setAuthError('');
    try {
        await auth.signInWithEmailAndPassword(email, pass);
    } catch (err) {
        const messages = {
            'auth/user-not-found':   'No account found with this email.',
            'auth/wrong-password':   'Incorrect password.',
            'auth/invalid-email':    'Please enter a valid email address.',
            'auth/too-many-requests':'Too many attempts. Please try again later.',
            'auth/invalid-credential': 'Incorrect email or password.',
        };
        setAuthError(messages[err.code] || err.message);
    }
    btn.disabled = false;
    btn.innerText = 'Sign In';
});

document.getElementById('email-signup-btn')?.addEventListener('click', async () => {
    const email = document.getElementById('auth-email')?.value.trim();
    const pass  = document.getElementById('auth-password')?.value;
    if (!email || !pass) { setAuthError('Please enter an email and password.'); return; }
    if (pass.length < 6) { setAuthError('Password must be at least 6 characters.'); return; }
    const btn = document.getElementById('email-signup-btn');
    btn.disabled = true;
    btn.innerText = 'Creating account...';
    setAuthError('');
    try {
        await auth.createUserWithEmailAndPassword(email, pass);
    } catch (err) {
        const messages = {
            'auth/email-already-in-use': 'An account already exists with this email.',
            'auth/invalid-email':        'Please enter a valid email address.',
            'auth/weak-password':        'Password is too weak. Use at least 6 characters.',
        };
        setAuthError(messages[err.code] || err.message);
    }
    btn.disabled = false;
    btn.innerText = 'Create account';
});

document.getElementById('forgot-password-btn')?.addEventListener('click', async () => {
    const email = document.getElementById('auth-email')?.value.trim();
    if (!email) { setAuthError('Enter your email address above first.'); return; }
    try {
        await auth.sendPasswordResetEmail(email);
        setAuthError('');
        alert('Password reset email sent! Check your inbox.');
    } catch (err) {
        setAuthError(err.message);
    }
});

const logout = () => auth.signOut();
document.getElementById('logout-btn-desktop')?.addEventListener('click', logout);

// ==========================================
// SEARCH OVERLAY (YT Music style)
// ==========================================
const SEARCH_HISTORY_MAX = 10;

function getSearchHistory() {
    try { return JSON.parse(localStorage.getItem('ht_search_history') || '[]'); }
    catch { return []; }
}
function addSearchHistory(term) {
    if (!term.trim()) return;
    let hist = getSearchHistory().filter(h => h.toLowerCase() !== term.toLowerCase());
    hist.unshift(term.trim());
    if (hist.length > SEARCH_HISTORY_MAX) hist = hist.slice(0, SEARCH_HISTORY_MAX);
    localStorage.setItem('ht_search_history', JSON.stringify(hist));
}
function removeSearchHistory(term) {
    const hist = getSearchHistory().filter(h => h !== term);
    localStorage.setItem('ht_search_history', JSON.stringify(hist));
}

function openSearchOverlay() {
    const overlay = document.getElementById('search-overlay');
    overlay.style.display = 'flex';
    requestAnimationFrame(() => overlay.classList.add('search-overlay-open'));
    const input = document.getElementById('search-input');
    input.value = '';
    document.getElementById('search-clear-btn').style.display = 'none';
    renderSearchBody('');
    setTimeout(() => input.focus(), 80);
    pushBackStack('search', closeSearchOverlay);
}

function closeSearchOverlay() {
    const overlay = document.getElementById('search-overlay');
    overlay.classList.remove('search-overlay-open');
    setTimeout(() => { overlay.style.display = 'none'; }, 260);
    // Clear search state so home view is restored
    const input = document.getElementById('search-input');
    if (input) input.value = '';
    renderCurrentView();
    PAGE_STACK.filter((_, i, arr) => arr.length - 1 === i && arr[i].name === 'search')
              .forEach(() => PAGE_STACK.pop());
}

function renderSearchBody(term) {
    const body = document.getElementById('search-overlay-body');
    if (!body) return;

    if (!term.trim()) {
        // Show recent searches
        const hist = getSearchHistory();
        const recentArtTracks = hist
            .map(h => allTracks.find(t =>
                t.title.toLowerCase().includes(h.toLowerCase()) ||
                t.artist.toLowerCase().includes(h.toLowerCase())
            ))
            .filter(Boolean)
            .slice(0, 6);

        let html = '';

        // Recent search art cards (horizontal)
        if (recentArtTracks.length > 0) {
            html += '<div class="so-recent-label">Recent searches</div>';
            html += '<div class="so-art-row">';
            recentArtTracks.forEach(t => {
                const art = t.coverArt
                    ? `<img src="${t.coverArt}" class="so-art-img">`
                    : `<div class="so-art-img so-art-fallback"><i class="fa-solid fa-music"></i></div>`;
                html += `<div class="so-art-card" data-title="${escHtml(t.title)}">
                    ${art}
                    <span class="so-art-label">${escHtml(t.title)}</span>
                </div>`;
            });
            html += '</div>';
        }

        // Recent text searches
        if (hist.length > 0) {
            if (recentArtTracks.length === 0)
                html += '<div class="so-recent-label">Recent searches</div>';
            hist.forEach(h => {
                html += `<div class="so-history-row" data-term="${escHtml(h)}">
                    <i class="fa-solid fa-clock-rotate-left so-history-icon"></i>
                    <span class="so-history-term">${escHtml(h)}</span>
                    <button class="so-history-remove" data-remove="${escHtml(h)}" aria-label="Remove">
                        <i class="fa-solid fa-arrow-up-left"></i>
                    </button>
                </div>`;
            });
        }

        if (!hist.length) {
            html = '<p class="so-empty">Search for songs or artists</p>';
        }

        body.innerHTML = html;

        // Wire art cards
        body.querySelectorAll('.so-art-card').forEach(card => {
            card.addEventListener('click', () => {
                const title = card.getAttribute('data-title');
                document.getElementById('search-input').value = title;
                document.getElementById('search-clear-btn').style.display = 'flex';
                renderSearchBody(title);
            });
        });

        // Wire history rows (tap to search)
        body.querySelectorAll('.so-history-row').forEach(row => {
            row.addEventListener('click', e => {
                if (e.target.closest('.so-history-remove')) return;
                const term = row.getAttribute('data-term');
                document.getElementById('search-input').value = term;
                document.getElementById('search-clear-btn').style.display = 'flex';
                renderSearchBody(term);
            });
        });

        // Wire remove buttons
        body.querySelectorAll('.so-history-remove').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                removeSearchHistory(btn.getAttribute('data-remove'));
                renderSearchBody('');
            });
        });

    } else {
        // Live search results
        const results = applySearchTerm(term, allTracks);
        if (!results.length) {
            body.innerHTML = '<p class="so-empty">No results found</p>';
            return;
        }
        // Save this term to history when showing results
        addSearchHistory(term);
        body.innerHTML = '<div class="so-results-label">Results</div>';
        const list = document.createElement('div');
        list.className = 'yt-track-list';
        renderTrackItems(results, list, results);
        body.appendChild(list);
    }
}

function applySearchTerm(term, tracks) {
    const t = term.toLowerCase().trim();
    if (!t) return tracks;
    return tracks.filter(tr =>
        tr.title.toLowerCase().includes(t)  ||
        tr.artist.toLowerCase().includes(t) ||
        (tr.language || '').toLowerCase().includes(t)
    );
}

// Wire search open button
document.getElementById('search-open-btn')?.addEventListener('click', openSearchOverlay);
document.getElementById('search-back-btn')?.addEventListener('click', closeSearchOverlay);

// Input events
document.getElementById('search-input')?.addEventListener('input', function() {
    const term = this.value;
    document.getElementById('search-clear-btn').style.display = term ? 'flex' : 'none';
    renderSearchBody(term);
});

// Enter key — save to history
document.getElementById('search-input')?.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && this.value.trim()) {
        addSearchHistory(this.value.trim());
        renderSearchBody(this.value.trim());
        this.blur();
    }
});

// Clear button
document.getElementById('search-clear-btn')?.addEventListener('click', function() {
    const input = document.getElementById('search-input');
    input.value = '';
    this.style.display = 'none';
    renderSearchBody('');
    input.focus();
});

// ==========================================
// PROFILE MODAL
// ==========================================
function openProfileModal() {
    // Prevent duplicate stack entries
    if (PAGE_STACK.some(e => e.name === 'profile')) return;
    document.getElementById('profile-modal').style.display = 'flex';
    requestAnimationFrame(() => {
        document.getElementById('profile-modal').classList.add('pm-open');
    });
    pushBackStack('profile', closeProfileModal);
}
function closeProfileModal() {
    const el = document.getElementById('profile-modal');
    el.classList.remove('pm-open');
    setTimeout(() => { el.style.display = 'none'; }, 300);
    const idx = PAGE_STACK.findIndex(e => e.name === 'profile');
    if (idx !== -1) PAGE_STACK.splice(idx, 1);
}

// Populate avatar + user info from Firebase user object
function populateProfileUI(user) {
    const imgHtml = user.photoURL
        ? `<img src="${escHtml(user.photoURL)}" alt="Profile" onerror="this.parentElement.innerHTML='<i class=fa-solid fa-user></i>'">`
        : '<i class="fa-solid fa-user"></i>';

    // Bottom nav avatar
    const bnAvatar = document.getElementById('bn-avatar');
    if (bnAvatar) bnAvatar.innerHTML = imgHtml;

    // Modal large avatar
    const pmAvatarLg = document.getElementById('pm-avatar-lg');
    if (pmAvatarLg) pmAvatarLg.innerHTML = imgHtml;

    const nameEl  = document.getElementById('pm-display-name');
    const emailEl = document.getElementById('pm-email');
    if (nameEl)  nameEl.innerText  = user.displayName || 'HalalTune User';
    if (emailEl) emailEl.innerText = user.email || '';
}

document.getElementById('profile-btn')?.addEventListener('click', openProfileModal);

// Bottom nav account button opens profile modal
document.getElementById('bn-account')?.addEventListener('click', openProfileModal);

// Bottom nav tab buttons
document.querySelectorAll('.bn-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        setActiveTab(tab);
    });
});
document.getElementById('pm-close-btn')?.addEventListener('click', closeProfileModal);
document.getElementById('profile-modal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('profile-modal')) closeProfileModal();
});

document.getElementById('pm-signout-btn')?.addEventListener('click', () => {
    closeProfileModal();
    setTimeout(() => auth.signOut(), 300);
});

document.getElementById('pm-switch-btn')?.addEventListener('click', () => {
    closeProfileModal();
    setTimeout(() => {
        auth.signOut().then(() => {
            const provider = new firebase.auth.GoogleAuthProvider();
            provider.setCustomParameters({ prompt: 'select_account' });
            auth.signInWithPopup(provider).catch(err => console.log(err));
        });
    }, 300);
});

document.getElementById('pm-history-btn')?.addEventListener('click', () => {
    closeProfileModal();
    setTimeout(() => openHistoryPage(), 300);
});

function openHistoryPage() {
    const page = document.getElementById('history-page');
    if (!page) return;
    renderHistoryPage();
    page.style.display = 'flex';
    requestAnimationFrame(() => page.classList.add('legal-open'));
    // Only push if not already on stack
    if (!PAGE_STACK.some(e => e.name === 'history'))
        pushBackStack('history', closeHistoryPage);
}

function closeHistoryPage() {
    const page = document.getElementById('history-page');
    if (!page) return;
    page.classList.remove('legal-open');
    setTimeout(() => { page.style.display = 'none'; }, 300);
    const idx = PAGE_STACK.findIndex(e => e.name === 'history');
    if (idx !== -1) PAGE_STACK.splice(idx, 1);
}

function renderHistoryPage() {
    const container = document.getElementById('history-list-container');
    if (!container) return;
    container.innerHTML = '';

    const ids = getHistoryIds();
    if (ids.length === 0) {
        container.innerHTML = '<p class="history-empty">No listening history yet. Play a song to get started.</p>';
        return;
    }

    const tracks = ids
        .map(id => allTracks.find(t => t.id === id))
        .filter(Boolean);

    if (tracks.length === 0) {
        container.innerHTML = '<p class="history-empty">No tracks found in your history.</p>';
        return;
    }

    tracks.forEach((track, index) => {
        const isPlaying = currentQueue.length > 0 &&
                          currentQueue[currentTrackIndex] &&
                          currentQueue[currentTrackIndex].id === track.id;

        const item = document.createElement('div');
        item.className = 'history-item' + (isPlaying ? ' history-item-active' : '');

        const artHtml = track.coverArt
            ? `<img src="${track.coverArt}" class="history-item-art" loading="lazy">`
            : `<div class="history-item-art history-item-art-fallback"><i class="fa-solid fa-music"></i></div>`;

        const catKey   = getCategory(track);
        const catMeta  = CATEGORIES.find(c => c.key === catKey);
        const badgeHtml = catMeta
            ? `<span class="history-lang-badge history-lang-${catKey}">${catMeta.label}</span>`
            : '';

        item.innerHTML = `
            ${artHtml}
            <div class="history-item-meta">
                <span class="history-item-title">${escHtml(track.title)}</span>
                <span class="history-item-artist">${escHtml(track.artist)}</span>
                ${badgeHtml}
            </div>
            <div class="history-item-actions">
                <i class="fa-solid ${isPlaying ? 'fa-pause' : 'fa-play'} history-play-icon"></i>
            </div>`;

        item.addEventListener('click', () => {
            // Play from full history queue
            currentQueue      = [...tracks];
            currentTrackIndex = index;
            playTrack();
            // Update active state in history list
            document.querySelectorAll('.history-item').forEach(el => el.classList.remove('history-item-active'));
            item.classList.add('history-item-active');
            item.querySelector('.history-play-icon').className = 'fa-solid fa-pause history-play-icon';
        });

        container.appendChild(item);
    });
}

document.getElementById('pm-help-btn')?.addEventListener('click', () => {
    closeProfileModal();
    window.open('mailto:support@halaltune.app?subject=Help%20%26%20Feedback', '_blank');
});

// Privacy & Terms pages
document.getElementById('pm-privacy-btn')?.addEventListener('click', () => {
    closeProfileModal();
    setTimeout(() => openPrivacyPage(), 300);
});
document.getElementById('pm-terms-btn')?.addEventListener('click', () => {
    closeProfileModal();
    setTimeout(() => openTermsPage(), 300);
});

document.getElementById('history-back-btn')?.addEventListener('click', closeHistoryPage);

// ==========================================
// HARDWARE / BROWSER BACK BUTTON STACK
// ==========================================
// We push a fake state whenever we open a page/modal so that the Android
// back button (popstate) can close it instead of leaving the app.
const PAGE_STACK = [];   // tracks what is currently "open" on top

function pushBackStack(name, closeFn) {
    PAGE_STACK.push({ name, closeFn });
    history.pushState({ htPage: name }, '');
}

function popBackStack() {
    PAGE_STACK.pop();
}

window.addEventListener('popstate', () => {
    if (PAGE_STACK.length > 0) {
        // closeFn already removes its own entry from PAGE_STACK via splice.
        // We only need to call it — NOT pop again afterwards.
        const top = PAGE_STACK[PAGE_STACK.length - 1];
        top.closeFn();
        // Re-push a state so the back button keeps working for remaining layers
        if (PAGE_STACK.length > 0) {
            history.pushState({ htPage: PAGE_STACK[PAGE_STACK.length - 1].name }, '');
        }
    }
});

// ── Back-stack helpers — defined here so wraps below can reference them ──────

// Privacy page
function openPrivacyPage() {
    const el = document.getElementById('privacy-page');
    el.style.display = 'flex';
    requestAnimationFrame(() => el.classList.add('legal-open'));
    if (!PAGE_STACK.some(e => e.name === 'privacy'))
        pushBackStack('privacy', closePrivacyPage);
}
function closePrivacyPage() {
    const el = document.getElementById('privacy-page');
    el.classList.remove('legal-open');
    setTimeout(() => { el.style.display = 'none'; }, 300);
    const idx = PAGE_STACK.findIndex(e => e.name === 'privacy');
    if (idx !== -1) PAGE_STACK.splice(idx, 1);
}

// Terms page
function openTermsPage() {
    const el = document.getElementById('terms-page');
    el.style.display = 'flex';
    requestAnimationFrame(() => el.classList.add('legal-open'));
    if (!PAGE_STACK.some(e => e.name === 'terms'))
        pushBackStack('terms', closeTermsPage);
}
function closeTermsPage() {
    const el = document.getElementById('terms-page');
    el.classList.remove('legal-open');
    setTimeout(() => { el.style.display = 'none'; }, 300);
    const idx = PAGE_STACK.findIndex(e => e.name === 'terms');
    if (idx !== -1) PAGE_STACK.splice(idx, 1);
}

// Rewire existing button handlers to use new named functions
document.getElementById('privacy-back-btn')?.addEventListener('click', closePrivacyPage);
document.getElementById('terms-back-btn')?.addEventListener('click',   closeTermsPage);

document.getElementById('history-clear-btn')?.addEventListener('click', async () => {
    if (!confirm('Clear your entire listening history?')) return;
    // Immediately clear in-memory and re-render — don't wait for Firestore
    historyList = [];
    renderHistoryPage();
    renderCurrentView(); // clears Recents strip instantly
    // Then delete from Firestore in background
    if (auth.currentUser) {
        try {
            const snap = await db.collection('users').doc(auth.currentUser.uid).collection('history').get();
            const batch = db.batch();
            snap.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
        } catch { /* fail silently */ }
    }
});

// ==========================================
// 4. LIQUID GLASS NAV
// ==========================================
function updateLiquidBubble(activeBtn) {
    const bubble = document.getElementById('liquid-bubble');
    const nav    = document.getElementById('liquid-nav');
    if (!bubble || !activeBtn || !nav) return;
    const navRect = nav.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();
    bubble.style.width     = btnRect.width + 'px';
    bubble.style.transform = `translateX(${btnRect.left - navRect.left - 5}px)`;
}

function updateBnBubble(activeBtn) {
    const bubble = document.getElementById('bn-bubble');
    const nav    = document.getElementById('bottom-nav');
    if (!bubble || !activeBtn || !nav) return;
    const navRect = nav.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();
    bubble.style.width  = btnRect.width  + 'px';
    bubble.style.height = (btnRect.height - 8) + 'px';
    bubble.style.left   = (btnRect.left - navRect.left) + 'px';
    bubble.style.top    = '4px';
}

function setActiveTab(tabName) {
    currentTab = tabName;
    Object.keys(seeAllState).forEach(k => seeAllState[k] = false);

    // Sync bottom nav + animate bubble
    document.querySelectorAll('.bn-btn[data-tab]').forEach(b => {
        const isActive = b.getAttribute('data-tab') === tabName;
        b.classList.toggle('active', isActive);
        if (isActive) updateBnBubble(b);
    });
    // Sync sidebar (desktop)
    document.querySelectorAll('.yt-nav-btn').forEach(b => {
        if (b.id && b.id.includes('logout')) return;
        b.classList.toggle('active', b.getAttribute('data-tab') === tabName);
    });

    renderCurrentView();
}

function initLiquidNav() {
    // Wire desktop sidebar nav buttons
    document.querySelectorAll('.yt-nav-btn').forEach(btn => {
        if (btn.id && btn.id.includes('logout')) return;
        btn.addEventListener('click', () => setActiveTab(btn.getAttribute('data-tab')));
    });
    // Position bottom nav bubble after layout settles
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const activebn = document.querySelector('.bn-btn.active');
            if (activebn) updateBnBubble(activebn);
        });
    });
}

// ==========================================
// 5. DATA
// ==========================================
const searchInput = document.getElementById('search-input');

let liquidNavReady = false;
let _unsubTracks = null;
function fetchAllTracks() {
    const area = document.getElementById('content-area');
    if (area) area.innerHTML = '<p style="text-align:center;color:#aaa;margin-top:40px;">Loading library...</p>';
    if (_unsubTracks) { _unsubTracks(); _unsubTracks = null; }
    _unsubTracks = db.collection('songs').orderBy('createdAt', 'desc').onSnapshot(
        snapshot => {
            allTracks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            speedDialPicks = computeSpeedDialPicks();
            if (!liquidNavReady) { initLiquidNav(); liquidNavReady = true; restorePlaybackSession(); handleDeepLink(); }
            renderCurrentView();
        },
        err => {
            console.error('fetchAllTracks error:', err);
            const liveArea = document.getElementById('content-area');
            if (liveArea) liveArea.innerHTML = '<p style="color:#ff4d4d;text-align:center;">Error loading tracks. Please refresh.</p>';
        }
    );
    // Return a promise-like so existing Promise.all call still works
    return Promise.resolve();
}

// search handled by overlay

// ---- helpers ----
function applySearch(tracks) {
    // In overlay mode the search input is always inside the overlay,
    // so the main content area is never filtered — just return all.
    return tracks;
}

function getCategory(track) {
    // Supports both old isMalayalam boolean and new language string field
    if (track.language) return track.language.toLowerCase();
    if (track.isMalayalam === true) return 'malayalam';
    return 'others';
}

function getTracksByCategory(cat) {
    return applySearch(allTracks.filter(t => getCategory(t) === cat));
}

function getLikedTracks() {
    return applySearch(allTracks.filter(t => likedSongIds.has(t.id)));
}

// ==========================================
// 6. RENDER
// ==========================================
async function renderCurrentView() {
    const area = document.getElementById('content-area');
    if (!area) return;
    area.innerHTML = '';

    if (currentTab === 'all') {
        renderAllView(area);
    } else if (currentTab === 'categories') {
        renderPlaylistView(area);
    } else if (currentTab === 'liked') {
        renderLikedView(area);
    } else if (currentTab === 'library') {
        await renderLibraryView(area);  // async — awaited so playlists render
    }
}

// ── Clears ALL card highlights (recents + speed-dial) then marks the
//    currently playing track with the correct glow + pause icon. ──────────────
function syncCardHighlights(playingTrackId) {
    // Clear every speed-dial card
    document.querySelectorAll('.speed-dial-card').forEach(card => {
        card.classList.remove('sd-playing');
        const icon = card.querySelector('.sd-play-ring i');
        if (icon) { icon.className = 'fa-solid fa-play'; }
    });

    // Clear every recents card
    document.querySelectorAll('.recents-card').forEach(card => {
        card.classList.remove('rc-playing');
        const icon = card.querySelector('.rc-play-ring i');
        if (icon) { icon.className = 'fa-solid fa-play'; }
    });

    if (!playingTrackId) return;

    // Highlight the matching speed-dial card
    document.querySelectorAll('.speed-dial-card').forEach(card => {
        if (card.dataset.trackId === playingTrackId) {
            card.classList.add('sd-playing');
            const icon = card.querySelector('.sd-play-ring i');
            if (icon) { icon.className = 'fa-solid fa-pause'; }
        }
    });

    // Highlight the matching recents card
    document.querySelectorAll('.recents-card').forEach(card => {
        if (card.dataset.trackId === playingTrackId) {
            card.classList.add('rc-playing');
            const icon = card.querySelector('.rc-play-ring i');
            if (icon) { icon.className = 'fa-solid fa-pause'; }
        }
    });
}

// Builds a random selection of up to 9 tracks for the Speed Dial.
// Called once per page load so the grid stays stable during a session
// but shows a fresh shuffle every time the user reopens the app.
function computeSpeedDialPicks() {
    // Prefer tracks that have cover art; fall back to everything if too few
    let pool = allTracks.filter(t => t.coverArt);
    if (pool.length < 3) pool = [...allTracks];

    // Weighted shuffle: bias toward higher-streamed tracks so popular songs
    // appear more often, but any track can show up.
    // Assign each track a random score multiplied by its relative popularity.
    const maxStreams = Math.max(...pool.map(t => t.streamCount || 0), 1);
    const weighted = pool.map(t => ({
        track: t,
        // score = random (0–1) boosted by how popular the track is (0–1 range)
        score: Math.random() * 0.6 + ((t.streamCount || 0) / maxStreams) * 0.4
    }));
    weighted.sort((a, b) => b.score - a.score);
    return weighted.slice(0, 9).map(w => w.track);
}

// ---------- SPEED DIAL (top of home) ----------
function renderSpeedDial(area) {
    // Use the pre-computed session picks (shuffled once on page load)
    const picks = speedDialPicks.length > 0 ? speedDialPicks : computeSpeedDialPicks();
    if (picks.length === 0) return;

    const section = document.createElement('div');
    section.className = 'speed-dial-section';

    const headerRow = document.createElement('div');
    headerRow.className = 'speed-dial-header';
    headerRow.innerHTML = `
        <div class="speed-dial-title-group">
            <span class="speed-dial-icon"><i class="fa-solid fa-bolt"></i></span>
            <span class="speed-dial-title">Speed Dial</span>
        </div>`;
    section.appendChild(headerRow);

    const grid = document.createElement('div');
    grid.className = 'speed-dial-grid';

    picks.forEach((track, index) => {
        const card = document.createElement('div');
        card.className = 'speed-dial-card';
        card.dataset.trackId = track.id;
        const isPlaying = currentQueue.length > 0 &&
                          currentQueue[currentTrackIndex] &&
                          currentQueue[currentTrackIndex].id === track.id;
        if (isPlaying) {
            card.classList.add('sd-playing');
        }

        const bgStyle = track.coverArt
            ? `background-image:url('${track.coverArt}')`
            : '';
        const noArtClass = track.coverArt ? '' : 'sd-no-art';

        card.innerHTML = `
            <div class="sd-art ${noArtClass}" style="${bgStyle}">
                ${!track.coverArt ? '<i class="fa-solid fa-music sd-music-icon"></i>' : ''}
                <div class="sd-play-ring"><i class="fa-solid ${isPlaying ? 'fa-pause' : 'fa-play'}"></i></div>
            </div>
            <div class="sd-info">
                <span class="sd-title">${escHtml(track.title)}</span>
            </div>`;

        card.addEventListener('click', () => {
            currentQueue      = [...picks];
            currentTrackIndex = index;
            playTrack();
            // syncCardHighlights() already called inside playTrack — nothing extra needed
        });

        grid.appendChild(card);
    });

    section.appendChild(grid);
    area.appendChild(section);
}

// ---------- RECENTS (horizontal scroll strip) ----------
function renderRecents(area) {
    const recentIds = getRecentIds();
    if (recentIds.length === 0) return;

    // Map ids → track objects (filter out any that no longer exist)
    const recentTracks = recentIds
        .map(id => allTracks.find(t => t.id === id))
        .filter(Boolean)
        .slice(0, RECENTS_MAX);

    if (recentTracks.length === 0) return;

    const section = document.createElement('div');
    section.className = 'recents-section';

    // Header row — "Recents" + "Show all" button like Spotify
    const header = document.createElement('div');
    header.className = 'recents-header';
    header.innerHTML = `
        <span class="recents-title">Recents</span>
        <button class="recents-show-all" id="recents-show-all-btn">Show all</button>`;
    section.appendChild(header);

    // Horizontal scroll strip
    const strip = document.createElement('div');
    strip.className = 'recents-strip';

    recentTracks.forEach((track, index) => {
        const isPlaying = currentQueue.length > 0 &&
                          currentQueue[currentTrackIndex] &&
                          currentQueue[currentTrackIndex].id === track.id;

        const card = document.createElement('div');
        card.className = 'recents-card' + (isPlaying ? ' rc-playing' : '');
        card.dataset.trackId = track.id;

        // rc-play-ring lives inside rc-art so overflow:hidden clips it flush — no gap
        const ringIcon = isPlaying ? 'fa-pause' : 'fa-play';
        const artHtml = track.coverArt
            ? `<div class="rc-art" style="background-image:url('${track.coverArt}')"><div class="rc-play-ring"><i class="fa-solid ${ringIcon}"></i></div></div>`
            : `<div class="rc-art rc-no-art"><i class="fa-solid fa-music"></i><div class="rc-play-ring"><i class="fa-solid ${ringIcon}"></i></div></div>`;

        card.innerHTML = `
            ${artHtml}
            <div class="rc-meta">
                <span class="rc-title">${escHtml(track.title)}</span>
                <span class="rc-artist">${escHtml(track.artist)}</span>
            </div>`;

        card.addEventListener('click', () => {
            currentQueue      = [...recentTracks];
            currentTrackIndex = index;
            playTrack();
            // syncCardHighlights() already called inside playTrack — nothing extra needed
        });

        strip.appendChild(card);
    });

    section.appendChild(strip);
    area.appendChild(section);

    // "Show all" opens the History page
    document.getElementById('recents-show-all-btn')?.addEventListener('click', () => {
        openHistoryPage();
    });
}

// ---------- ALL VIEW: Recents → Speed Dial → All Songs flat list ----------
function renderAllView(area) {
    const term = (searchInput?.value || '').trim();
    if (term) {
        // While searching show flat results
        const results = applySearch(allTracks);
        renderTrackItems(results, area, results);
        return;
    }

    // 1. Recents strip
    renderRecents(area);

    // 2. Speed Dial grid
    renderSpeedDial(area);

    // 3. All songs flat list with section heading
    if (allTracks.length > 0) {
        const allHeader = document.createElement('div');
        allHeader.className = 'section-title-row';
        allHeader.style.marginTop = '8px';
        allHeader.innerHTML = '<h2 class="section-heading"><span class="section-dot"></span>All Songs</h2>';
        area.appendChild(allHeader);

        const listEl = document.createElement('div');
        listEl.className = 'yt-track-list';
        renderTrackItems(allTracks, listEl, allTracks);
        area.appendChild(listEl);
    }
}

// ---------- PLAYLIST VIEW: language sections (no speed dial) ----------
function renderPlaylistView(area) {
    const term = (searchInput?.value || '').trim();
    let hasAnything = false;

    CATEGORIES.forEach(cat => {
        const tracks = getTracksByCategory(cat.key);
        if (tracks.length === 0) return;
        hasAnything = true;

        const section = document.createElement('div');
        section.className = 'song-section';
        section.id = 'section-' + cat.key;

        const header = document.createElement('div');
        header.className = 'section-title-row';

        const heading = document.createElement('h2');
        heading.className = 'section-heading';
        heading.innerHTML = `<span class="section-dot cat-dot-${cat.key}"></span>${cat.label}`;
        header.appendChild(heading);

        if (tracks.length > PREVIEW_COUNT) {
            const seeAllBtn = document.createElement('button');
            seeAllBtn.className = 'section-see-all';
            seeAllBtn.innerText = seeAllState[cat.key] ? 'Show Less' : 'See All';
            seeAllBtn.addEventListener('click', () => {
                seeAllState[cat.key] = !seeAllState[cat.key];
                renderCurrentView();
            });
            header.appendChild(seeAllBtn);
        }

        section.appendChild(header);

        const listEl = document.createElement('div');
        listEl.className = 'yt-track-list section-track-list';
        const visible = seeAllState[cat.key] ? tracks : tracks.slice(0, PREVIEW_COUNT);
        renderTrackItems(visible, listEl, tracks);
        section.appendChild(listEl);

        area.appendChild(section);
    });

    if (!hasAnything) {
        area.innerHTML = `<div class="dl-empty">
            <i class="fa-solid fa-layer-group dl-empty-icon"></i>
            <p>No tracks in the library yet.</p>
            <p style="font-size:.8rem;color:#555;">Songs uploaded by the admin will appear here.</p>
        </div>`;
    }
}

// ---------- LIKED VIEW ----------
function renderLikedView(area) {
    const header = document.createElement('div');
    header.className = 'section-title-row';
    header.style.marginBottom = '12px';
    header.innerHTML = '<h2 class="section-heading"><span class="section-dot"></span>Liked Songs</h2>';
    area.appendChild(header);

    const listEl = document.createElement('div');
    listEl.className = 'yt-track-list';
    const tracks = getLikedTracks();
    renderTrackItems(tracks, listEl, tracks);
    area.appendChild(listEl);
}

// ---------- Core track item renderer ----------
function renderTrackItems(trackArray, container, fullQueue) {
    if (trackArray.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:#aaa;margin-top:20px;">No tracks found.</p>';
        return;
    }

    trackArray.forEach((track, index) => {
        const item      = document.createElement('div');
        item.className  = 'yt-list-item';
        const isPlaying = currentQueue.length > 0 &&
                          currentQueue[currentTrackIndex] &&
                          currentQueue[currentTrackIndex].id === track.id;
        if (isPlaying) item.classList.add('active');

        const isLiked    = likedSongIds.has(track.id);
        const heartClass = isLiked ? 'fa-solid liked' : 'fa-regular';
        const artHtml    = track.coverArt
            ? `<img src="${track.coverArt}" loading="lazy">`
            : `<i class="fa-solid fa-music"></i>`;

        // Language badge (shown in 'all' view and 'playlist' view)
        const catKey  = getCategory(track);
        const catMeta = CATEGORIES.find(c => c.key === catKey);
        const badge   = (currentTab === 'all' || currentTab === 'categories') && catMeta
            ? `<span class="lang-badge lang-badge-${catKey}">${catMeta.label.substring(0,3).toUpperCase()}</span>`
            : '';

        item.innerHTML = `
            <div class="yt-list-art-wrapper">
                ${artHtml}
                <div class="yt-list-play-overlay"><i class="fa-solid fa-play"></i></div>
            </div>
            <div class="yt-list-meta">
                <h3>${escHtml(track.title)}</h3>
                <p>${escHtml(track.artist)}</p>
            </div>
            <div class="yt-list-actions">
                ${badge}
                <button class="list-like-btn ${isLiked ? 'liked' : ''}" data-id="${track.id}" aria-label="Like">
                    <i class="${heartClass} fa-heart"></i>
                </button>
            </div>`;

        item.addEventListener('click', e => {
            if (e.target.closest('.list-like-btn')) return;
            currentQueue      = [...fullQueue];
            currentTrackIndex = index;
            playTrack();
            // Mark active
            document.querySelectorAll('.yt-list-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
        });

        item.querySelector('.list-like-btn').addEventListener('click', e => {
            e.stopPropagation();
            toggleLike(track.id);
        });

        container.appendChild(item);
    });
}

function escHtml(str) {
    return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ==========================================
// 7. LIKES
// ==========================================
function toggleLike(trackId) {
    if (!auth.currentUser) return;
    // Optimistic UI — update in-memory set and buttons immediately
    const wasLiked = likedSongIds.has(trackId);
    if (wasLiked) likedSongIds.delete(trackId);
    else           likedSongIds.add(trackId);
    updateGlobalLikeButtons();
    // Update all list-item heart buttons for this track
    document.querySelectorAll(`.list-like-btn[data-id="${trackId}"]`).forEach(btn => {
        btn.classList.toggle('liked', !wasLiked);
        btn.querySelector('i').className = wasLiked ? 'fa-regular fa-heart' : 'fa-solid fa-heart liked';
    });

    // Persist to Firestore in background
    const uid     = auth.currentUser.uid;
    const likeRef = db.collection('users').doc(uid).collection('likes').doc(trackId);
    const songRef = db.collection('songs').doc(trackId);
    if (wasLiked) {
        likeRef.delete().catch(() => { likedSongIds.add(trackId); updateGlobalLikeButtons(); });
        songRef.update({ likeCount: firebase.firestore.FieldValue.increment(-1) }).catch(() => {});
    } else {
        likeRef.set({ addedAt: firebase.firestore.FieldValue.serverTimestamp() }).catch(() => {
            likedSongIds.delete(trackId); updateGlobalLikeButtons();
        });
        songRef.update({ likeCount: firebase.firestore.FieldValue.increment(1) }).catch(() => {});
    }
}

function updateGlobalLikeButtons() {
    if (!currentQueue[currentTrackIndex]) return;
    const trackId  = currentQueue[currentTrackIndex].id;
    const fsLikeBtn = document.getElementById('fs-like-btn');
    if (likedSongIds.has(trackId)) {
        fsLikeBtn.innerHTML = '<i class="fa-solid fa-heart"></i>';
        fsLikeBtn.classList.add('liked');
    } else {
        fsLikeBtn.innerHTML = '<i class="fa-regular fa-heart"></i>';
        fsLikeBtn.classList.remove('liked');
    }
}

document.getElementById('fs-like-btn').addEventListener('click', () => {
    if (currentQueue[currentTrackIndex]) toggleLike(currentQueue[currentTrackIndex].id);
});

// ==========================================
// 8. PLAYBACK
// ==========================================
const audio = document.getElementById('audio-element');

window.nativeControl = function(action, value) {
    if (!audio.src) return;
    if (action === 'PLAY')  { audio.play();  setPlayState(true);  }
    if (action === 'PAUSE') { audio.pause(); setPlayState(false); }
    if (action === 'NEXT')  playNext();
    if (action === 'PREV')  playPrev();
    if (action === 'SEEK')  audio.currentTime = value;
};

window.updateAndroidMedia = function() {
    if (window.AndroidBridge && window.AndroidBridge.updateMediaNotification && currentQueue[currentTrackIndex]) {
        const t  = currentQueue[currentTrackIndex];
        const dur = isNaN(audio.duration)    ? 0 : Math.floor(audio.duration);
        const pos = isNaN(audio.currentTime) ? 0 : Math.floor(audio.currentTime);
        window.AndroidBridge.updateMediaNotification(t.title, t.artist, t.coverArt || '', !audio.paused, dur, pos);
    }
};

audio.addEventListener('loadedmetadata', window.updateAndroidMedia);
audio.addEventListener('seeked',         window.updateAndroidMedia);

function savePlaybackSession() {
    if (!currentQueue.length || currentTrackIndex < 0) return;
    const track = currentQueue[currentTrackIndex];
    try {
        sessionStorage.setItem('ht_session', JSON.stringify({
            trackId:  track.id,
            position: audio.currentTime || 0,
            queue:    currentQueue.map(t => t.id),
            qIdx:     currentTrackIndex,
            shuffle:  isShuffle,
            repeat:   isRepeat
        }));
    } catch {}
}

function restorePlaybackSession() {
    try {
        const raw = sessionStorage.getItem('ht_session');
        if (!raw || !allTracks.length) return;
        const s = JSON.parse(raw);
        const queue = s.queue.map(id => allTracks.find(t => t.id === id)).filter(Boolean);
        if (!queue.length) return;
        currentQueue      = queue;
        currentTrackIndex = Math.min(s.qIdx, queue.length - 1);
        isShuffle = s.shuffle || false;
        isRepeat  = s.repeat  || false;
        document.getElementById('fs-shuffle-btn')?.classList.toggle('active', isShuffle);
        document.getElementById('fs-repeat-btn')?.classList.toggle('active', isRepeat);
        const track = currentQueue[currentTrackIndex];
        if (!track) return;
        // Update mini-player display without auto-playing
        document.getElementById('player-title').innerText  = track.title;
        document.getElementById('player-artist').innerText = track.artist;
        document.getElementById('fs-player-title').innerText  = track.title;
        document.getElementById('fs-player-artist').innerText = track.artist;
        document.getElementById('player-art').innerHTML =
            track.coverArt ? `<img src="${track.coverArt}">` : `<i class="fa-solid fa-music"></i>`;
        audio.src = track.url;
        audio.currentTime = s.position || 0;
        setPlayState(false);
        syncCardHighlights(track.id);
        document.getElementById('mini-player').style.display = 'flex';
        showDlToast('▶ Tap to resume: ' + track.title);
    } catch {}
}

// Save session every 5 seconds during playback
setInterval(() => { if (!audio.paused) savePlaybackSession(); }, 5000);

function playTrack() {
    if (!currentQueue.length || currentTrackIndex < 0) return;
    const track = currentQueue[currentTrackIndex];

    // Record this play in recents (localStorage)
    addToRecents(track.id);

    document.getElementById('player-title').innerText  = track.title;
    document.getElementById('player-artist').innerText = track.artist;
    document.getElementById('fs-player-title').innerText  = track.title;
    document.getElementById('fs-player-artist').innerText = track.artist;

    document.getElementById('player-art').innerHTML =
        track.coverArt ? `<img src="${track.coverArt}">` : `<i class="fa-solid fa-music"></i>`;

    const artView = document.getElementById('fs-artwork-view');
    artView.innerHTML = track.coverArt
        ? `<img src="${track.coverArt}" style="width:100%;height:100%;object-fit:cover;">`
        : `<div class="fs-art-placeholder"><i class="fa-solid fa-music"></i></div>`;

    updateGlobalLikeButtons();
    audio.src = track.url;
    audio.play().catch(() => setPlayState(false));
    setPlayState(true);
    // Sync card highlights across ALL card sections (recents + speed-dial)
    syncCardHighlights(track.id);
    renderQueueUI();
    fetchLyrics(track.title, track.artist);
    renderRelated(track);

    if (!window.AndroidBridge && 'mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: track.title, artist: track.artist, album: 'HalalTune',
            artwork: [{ src: track.coverArt || 'icon.png', sizes: '512x512', type: 'image/png' }]
        });
        navigator.mediaSession.setActionHandler('play',         () => { audio.play().catch(() => {}); setPlayState(true); });
        navigator.mediaSession.setActionHandler('pause',        () => { audio.pause(); setPlayState(false); });
        navigator.mediaSession.setActionHandler('previoustrack', () => playPrev());
        navigator.mediaSession.setActionHandler('nexttrack',    () => playNext());
        navigator.mediaSession.setActionHandler('seekto',       d  => { audio.currentTime = d.seekTime; });
    }

    // Only count a stream after 10 seconds of continuous playback
    const activeUid   = auth.currentUser ? auth.currentUser.uid : localUserId;
    const streamTrackId = track.id;
    clearTimeout(playTrack._streamTimer);
    playTrack._streamTimer = setTimeout(() => {
        // Guard: make sure the user is still on the same track
        if (currentQueue[currentTrackIndex]?.id !== streamTrackId) return;
        db.collection('songs').doc(streamTrackId).update({
            streamCount: firebase.firestore.FieldValue.increment(1),
            listeners:   firebase.firestore.FieldValue.arrayUnion(activeUid)
        }).catch(() => {});
    }, 10000);
}

function playNext() {
    if (!currentQueue.length) return;
    if (isShuffle) currentTrackIndex = Math.floor(Math.random() * currentQueue.length);
    else { currentTrackIndex++; if (currentTrackIndex >= currentQueue.length) currentTrackIndex = 0; }
    playTrack();
    renderCurrentView();
}

function playPrev() {
    if (!currentQueue.length) return;
    if (isShuffle) currentTrackIndex = Math.floor(Math.random() * currentQueue.length);
    else { currentTrackIndex--; if (currentTrackIndex < 0) currentTrackIndex = currentQueue.length - 1; }
    playTrack();
    renderCurrentView();
}

document.getElementById('fs-next-btn').addEventListener('click', playNext);
document.getElementById('desk-next-btn')?.addEventListener('click', playNext);
document.getElementById('fs-prev-btn').addEventListener('click', playPrev);
document.getElementById('desk-prev-btn')?.addEventListener('click', playPrev);

document.getElementById('fs-shuffle-btn').addEventListener('click', function() {
    isShuffle = !isShuffle;
    this.classList.toggle('active', isShuffle);
});
document.getElementById('fs-repeat-btn').addEventListener('click', function() {
    isRepeat = !isRepeat;
    this.classList.toggle('active', isRepeat);
});

const playBtns = [document.getElementById('play-btn'), document.getElementById('fs-play-btn')];
function setPlayState(isPlaying) {
    playBtns.forEach(btn => {
        const icon = btn.querySelector('i');
        if (icon) {
            // Reset completely — removes spinner, play, pause, all variants
            icon.className = isPlaying
                ? 'fa-solid fa-pause'
                : 'fa-solid fa-play';
        }
    });
    window.updateAndroidMedia();
}

playBtns.forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    if (!audio.src) return;
    if (audio.paused) { audio.play().catch(() => setPlayState(false)); setPlayState(true); } else { audio.pause(); setPlayState(false); }
}));

// ==========================================
// 9. PROGRESS / SEEK
// ==========================================
function updateSlider(bar, pct) {
    bar.value = pct;
    bar.style.background = `linear-gradient(to right,#fff ${pct}%,#333 ${pct}%)`;
}
const miniBar = document.getElementById('progress-bar');
const fsBar   = document.getElementById('fs-progress-bar');

audio.addEventListener('timeupdate', () => {
    if (!audio.duration) return;
    const pct = (audio.currentTime / audio.duration) * 100;
    updateSlider(miniBar, pct);
    updateSlider(fsBar, pct);
    const c = audio.currentTime, d = audio.duration;
    document.getElementById('fs-current-time').innerText =
        `${Math.floor(c/60)}:${String(Math.floor(c%60)).padStart(2,'0')}`;
    document.getElementById('fs-total-time').innerText =
        `${Math.floor(d/60)}:${String(Math.floor(d%60)).padStart(2,'0')}`;
});

function handleSeek(e) {
    e.stopPropagation();
    if (!audio.src) return;
    const pct = e.target.value;
    audio.currentTime = (pct / 100) * audio.duration;
    updateSlider(miniBar, pct);
    updateSlider(fsBar, pct);
}
miniBar.addEventListener('input', handleSeek);
fsBar.addEventListener('input', handleSeek);

audio.addEventListener('ended', () => {
    if (isRepeat) { audio.currentTime = 0; audio.play().catch(() => {}); } else playNext();
});

// Audio error — reset play state and toast user
audio.addEventListener('error', () => {
    setPlayState(false);  // full reset via new setPlayState
    showDlToast('Failed to load track. Check your connection.');
});

// Buffering — show spinner on play button
audio.addEventListener('waiting', () => {
    playBtns.forEach(btn => {
        const i = btn.querySelector('i');
        if (i) i.className = 'fa-solid fa-spinner fa-spin';
    });
});
audio.addEventListener('playing', () => {
    setPlayState(true); // restores correct icon after buffering
});
audio.addEventListener('canplay', () => {
    setPlayState(!audio.paused);
});

// ==========================================
// 10. FULLSCREEN PLAYER & BUBBLE TABS
// ==========================================
const fsArtView      = document.getElementById('fs-artwork-view');
const fsTabView      = document.getElementById('fs-tab-content-view');
const bubbleBtns     = document.querySelectorAll('.fs-bubble-btn');
const viewQueue      = document.getElementById('fs-queue-view');
const viewLyrics     = document.getElementById('fs-lyrics-view');
const viewRelated    = document.getElementById('fs-related-view');
const miniPlayer     = document.getElementById('mini-player');
const fsPlayer       = document.getElementById('full-screen-player');

const fsMainArea = document.getElementById('fs-artwork-view')?.closest('.fs-main-area') ||
                   document.querySelector('.fs-main-area');

bubbleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-target');
        if (btn.classList.contains('active')) {
            // Closing — go back to artwork
            btn.classList.remove('active');
            fsTabView.style.display  = 'none';
            fsArtView.style.display  = 'flex';
            fsMainArea?.classList.remove('fs-tabs-active');
            return;
        }
        bubbleBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        fsArtView.style.display  = 'none';
        fsTabView.style.display  = 'flex';   // flex so children can use flex:1
        fsMainArea?.classList.add('fs-tabs-active');
        [viewQueue, viewLyrics, viewRelated].forEach(v => v.style.display = 'none');
        if (target === 'queue')   viewQueue.style.display   = 'block';
        if (target === 'lyrics')  viewLyrics.style.display  = 'block';
        if (target === 'related') viewRelated.style.display = 'block';
    });
});

miniPlayer.addEventListener('click', e => {
    if (window.innerWidth <= 768 && !e.target.closest('button') && !e.target.closest('input'))
        fsPlayer.classList.add('active');
});
document.getElementById('close-fs-btn').addEventListener('click', () => fsPlayer.classList.remove('active'));

let startY = 0;
miniPlayer.addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive: true });
miniPlayer.addEventListener('touchend',   e => {
    if (window.innerWidth <= 768 && startY - e.changedTouches[0].clientY > 30)
        fsPlayer.classList.add('active');
});
fsPlayer.addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive: true });
fsPlayer.addEventListener('touchend',   e => {
    if (e.target.closest('.fs-scrollable-content') || e.target.closest('.options-content')) return;
    if (e.changedTouches[0].clientY - startY > 80) fsPlayer.classList.remove('active');
});

function renderQueueUI() {
    viewQueue.innerHTML = '<div class="q-title-header">Up Next</div>';
    if (currentTrackIndex >= currentQueue.length - 1) {
        viewQueue.innerHTML += '<p class="lyrics-msg">End of queue.</p>';
        return;
    }
    for (let i = currentTrackIndex + 1, count = 0; i < currentQueue.length && count < 15; i++, count++) {
        const t    = currentQueue[i];
        const item = document.createElement('div');
        item.className = 'q-item';
        const art = t.coverArt ? `<img src="${t.coverArt}" class="q-item-art">` : `<div class="q-item-art"><i class="fa-solid fa-music"></i></div>`;
        item.innerHTML = `${art}<div class="q-item-info"><span class="q-item-title">${escHtml(t.title)}</span><span class="q-item-artist">${escHtml(t.artist)}</span></div>`;
        item.addEventListener('click', () => { currentTrackIndex = i; playTrack(); renderCurrentView(); });
        viewQueue.appendChild(item);
    }
}

async function fetchLyrics(title, artist) {
    viewLyrics.innerHTML = '<p class="lyrics-msg">Searching for lyrics...</p>';

    const currentTrack = currentQueue[currentTrackIndex];

    // 1. Malayalam song — show Thirunabi Madh redirect chip
    if (currentTrack && getCategory(currentTrack) === 'malayalam') {
        const redirectUrl = currentTrack.lyricsRedirectUrl || '';
        viewLyrics.innerHTML = buildThirunabiChip(redirectUrl);
        // Wire click after inserting into DOM
        const chip = viewLyrics.querySelector('.thirunabi-chip');
        if (chip && redirectUrl) {
            chip.addEventListener('click', () => window.open(redirectUrl, '_blank', 'noopener'));
        }
        return;
    }

    // 2. Admin manually added lyrics — show them
    if (currentTrack?.lyrics && currentTrack.lyrics.trim()) {
        const providerHtml = currentTrack.lyricsProvider
            ? buildProviderBadge(currentTrack.lyricsProvider, currentTrack.lyricsProviderUrl)
            : '';
        viewLyrics.innerHTML =
            providerHtml +
            `<pre class="lyrics-text">${escHtml(currentTrack.lyrics)}</pre>`;
        return;
    }

    // 3. Fall back to LRCLib auto-fetch
    try {
        const res  = await fetch(`https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (data.plainLyrics) {
            viewLyrics.innerHTML =
                buildProviderBadge('LRCLib', 'https://lrclib.net') +
                `<pre class="lyrics-text">${escHtml(data.plainLyrics)}</pre>`;
        } else {
            viewLyrics.innerHTML = '<p class="lyrics-msg">Lyrics not available for this track.</p>';
        }
    } catch {
        viewLyrics.innerHTML = '<p class="lyrics-msg">Lyrics not available for this track.</p>';
    }
}

function buildThirunabiChip(url) {
    const hasUrl   = !!url;
    const tag      = hasUrl ? 'button' : 'div';
    const clickable = hasUrl ? 'thirunabi-chip thirunabi-chip-active' : 'thirunabi-chip';
    const arrowHtml = hasUrl
        ? '<i class="fa-solid fa-arrow-up-right-from-square tc-client-arrow"></i>'
        : '';
    return `
        <div class="thirunabi-chip-wrapper">
            <${tag} class="${clickable}">
                <div class="tc-client-icon">
                    <i class="fa-solid fa-mosque"></i>
                </div>
                <div class="tc-client-text">
                    <span class="tc-client-title">Thirunabi Madh</span>
                    <span class="tc-client-desc">${hasUrl
                        ? 'Tap to open lyrics in Thirunabi Madh'
                        : 'Lyrics available on Thirunabi Madh app'
                    }</span>
                </div>
                ${arrowHtml}
            </${tag}>
            <p class="tc-client-note">Malayalam lyrics are provided by our partner app</p>
        </div>`;
}

function buildProviderBadge(name, url) {
    if (url) {
        return `<a href="${escHtml(url)}" target="_blank" rel="noopener" class="lyrics-provider-badge">
            <i class="fa-solid fa-music"></i> Lyrics provided by ${escHtml(name)}
        </a>`;
    }
    return `<div class="lyrics-provider-badge">
        <i class="fa-solid fa-music"></i> Lyrics provided by ${escHtml(name)}
    </div>`;
}

function renderRelated(currentTrack) {
    viewRelated.innerHTML = '<div class="q-title-header">More Like This</div>';
    let related = allTracks.filter(t => t.artist === currentTrack.artist && t.id !== currentTrack.id);
    if (!related.length) related = allTracks.filter(t => t.id !== currentTrack.id).sort(() => 0.5 - Math.random()).slice(0, 5);
    related.forEach(t => {
        const item = document.createElement('div');
        item.className = 'q-item';
        const art = t.coverArt ? `<img src="${t.coverArt}" class="q-item-art">` : `<div class="q-item-art"><i class="fa-solid fa-music"></i></div>`;
        item.innerHTML = `${art}<div class="q-item-info"><span class="q-item-title">${escHtml(t.title)}</span><span class="q-item-artist">${escHtml(t.artist)}</span></div>`;
        item.addEventListener('click', () => {
            const idx = allTracks.findIndex(tr => tr.id === t.id);
            if (idx !== -1) { currentQueue = [...allTracks]; currentTrackIndex = idx; playTrack(); renderCurrentView(); }
        });
        viewRelated.appendChild(item);
    });
}

// ==========================================
// 11. OPTIONS MODAL
// ==========================================
// options-modal open handled by single capture listener below
document.getElementById('opt-close-btn').addEventListener('click', () => {
    document.getElementById('options-modal').style.display = 'none';
});
document.getElementById('options-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('options-modal'))
        document.getElementById('options-modal').style.display = 'none';
});
// ── IN-APP DOWNLOADS (Cache API) ──────────────────────────────────────────────
const DL_CACHE   = 'halaltune-downloads-v1';
const DL_STORE   = 'ht_downloads';   // localStorage key for metadata list

function getDownloadsMeta() {
    try { return JSON.parse(localStorage.getItem(DL_STORE) || '[]'); }
    catch { return []; }
}
function saveDownloadsMeta(list) {
    localStorage.setItem(DL_STORE, JSON.stringify(list));
}
function isDownloaded(trackId) {
    return getDownloadsMeta().some(d => d.id === trackId);
}
function isDownloadStale(trackId) {
    const meta  = getDownloadsMeta().find(d => d.id === trackId);
    const live  = allTracks.find(t => t.id === trackId);
    if (!meta || !live) return false;
    return live.url && meta.url && live.url !== meta.url;
}

async function downloadTrack(track) {
    const btn      = document.getElementById('opt-download-btn');
    const labelEl  = document.getElementById('opt-download-label');
    if (!track) return;

    if (isDownloaded(track.id)) {
        // Already downloaded — ask to remove
        if (confirm('Remove "' + track.title + '" from downloads?')) {
            const cache = await caches.open(DL_CACHE);
            await cache.delete(track.url);
            const list = getDownloadsMeta().filter(d => d.id !== track.id);
            saveDownloadsMeta(list);
            showDlToast('Removed from downloads');
            labelEl.textContent = 'Download for offline';
        }
        document.getElementById('options-modal').style.display = 'none';
        return;
    }

    // Start download
    labelEl.textContent = 'Downloading...';
    if (btn) btn.disabled = true;
    document.getElementById('options-modal').style.display = 'none';
    showDlToast('Downloading "' + track.title + '"…');

    try {
        const cache    = await caches.open(DL_CACHE);
        const response = await fetch(track.url);
        if (!response.ok) throw new Error('Network error');
        await cache.put(track.url, response);

        // Save metadata
        const list = getDownloadsMeta().filter(d => d.id !== track.id);
        list.unshift({
            id:        track.id,
            title:     track.title,
            artist:    track.artist,
            coverArt:  track.coverArt || '',
            url:       track.url,
            language:  track.language || '',
            savedAt:   Date.now()
        });
        saveDownloadsMeta(list);

        // Update Firestore download count (fire-and-forget)
        db.collection('songs').doc(track.id)
          .update({ downloadCount: firebase.firestore.FieldValue.increment(1) })
          .catch(() => {});

        showDlToast('✓ "' + track.title + '" saved for offline');
    } catch (err) {
        showDlToast('Download failed — check your connection');
        console.error('Download error:', err);
    } finally {
        // Always re-enable button and reset label regardless of outcome
        if (btn) btn.disabled = false;
        if (labelEl) {
        if (isDownloadStale(track.id)) labelEl.textContent = '⚠ Re-download (updated)';
        else if (isDownloaded(track.id)) labelEl.textContent = 'Remove download';
        else labelEl.textContent = 'Download for offline';
    }
    }
}

function showDlToast(msg) {
    const toast = document.getElementById('dl-toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.style.display = 'flex';
    toast.classList.add('dl-toast-show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
        toast.classList.remove('dl-toast-show');
        setTimeout(() => { toast.style.display = 'none'; }, 300);
    }, 3000);
}

// Single options-modal opener — sets download label then shows modal
document.getElementById('fs-menu-btn').addEventListener('click', () => {
    const track = currentQueue[currentTrackIndex];
    if (!track) return;
    const labelEl = document.getElementById('opt-download-label');
    if (labelEl) {
        if (isDownloadStale(track.id))      labelEl.textContent = '⚠ Re-download (updated)';
        else if (isDownloaded(track.id))    labelEl.textContent = 'Remove download';
        else                                labelEl.textContent = 'Download for offline';
    }
    document.getElementById('options-modal').style.display = 'flex';
});

document.getElementById('opt-download-btn').addEventListener('click', () => {
    const track = currentQueue[currentTrackIndex];
    if (!track) return;
    downloadTrack(track);
});

// ── DOWNLOADS VIEW ────────────────────────────────────────────────────────────
// ── LIBRARY VIEW (Downloads + Playlists) ─────────────────────────────────────
let librarySubTab = 'downloads'; // 'downloads' | 'playlists' | 'liked'

async function renderLibraryView(area) {
    // ── Build the persistent nav bar ──────────────────────────────────────────
    const subBar = document.createElement('div');
    subBar.className = 'lib-liquid-nav-wrap';
    subBar.id = 'lib-nav-wrap';
    subBar.innerHTML = `
        <div class="lib-liquid-nav" id="lib-liquid-nav">
            <div class="lib-liquid-bubble" id="lib-liquid-bubble"></div>
            <button class="lib-liquid-btn ${librarySubTab==='downloads'?'active':''}" data-sub="downloads">Downloads</button>
            <button class="lib-liquid-btn ${librarySubTab==='playlists'?'active':''}" data-sub="playlists">Playlists</button>
            <button class="lib-liquid-btn ${librarySubTab==='liked'?'active':''}" data-sub="liked">Liked</button>
        </div>`;
    area.appendChild(subBar);

    // ── Content container — only THIS gets swapped on sub-tab change ──────────
    const contentWrap = document.createElement('div');
    contentWrap.id = 'lib-content-wrap';
    area.appendChild(contentWrap);

    // ── Position bubble using offsetLeft (scroll-safe, always correct) ────────
    function positionBubble(targetBtn, animate) {
        const nav    = document.getElementById('lib-liquid-nav');
        const bubble = document.getElementById('lib-liquid-bubble');
        if (!nav || !bubble || !targetBtn) return;
        if (animate) bubble.classList.add('animated');
        bubble.style.width     = targetBtn.offsetWidth  + 'px';
        bubble.style.height    = targetBtn.offsetHeight + 'px';
        // offsetLeft on the button is relative to its offsetParent (the nav)
        bubble.style.transform = 'translateX(' + targetBtn.offsetLeft + 'px)';
    }

    // Initial position — after one rAF so the browser has measured the buttons
    requestAnimationFrame(() => {
        const active = subBar.querySelector('.lib-liquid-btn.active');
        positionBubble(active, false); // no animation on first render
    });

    // ── Wire tab buttons ──────────────────────────────────────────────────────
    subBar.querySelectorAll('.lib-liquid-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.getAttribute('data-sub') === librarySubTab) return; // same tab — no-op

            // Flip active class and animate bubble in-place (no re-render of nav)
            subBar.querySelectorAll('.lib-liquid-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            positionBubble(btn, true); // animated slide

            // Swap only the content below the nav
            librarySubTab = btn.getAttribute('data-sub');
            renderLibraryContent(contentWrap);
        });
    });

    // ── Render initial content ────────────────────────────────────────────────
    await renderLibraryContent(contentWrap);
}

async function renderLibraryContent(wrap) {
    wrap.innerHTML = '';
    if (librarySubTab === 'downloads') {
        renderDownloadsSection(wrap);
    } else if (librarySubTab === 'liked') {
        renderLikedSection(wrap);
    } else {
        await renderPlaylistsSection(wrap);
    }
}

function renderLikedSection(wrap) {
    const tracks = getLikedTracks();
    if (!tracks.length) {
        wrap.innerHTML = '<div class="dl-empty"><i class="fa-solid fa-heart dl-empty-icon" style="color:#ef4444;"></i>' +
            '<p>No liked songs yet.</p>' +
            '<p style="font-size:.8rem;color:#555;">Tap the heart on any song to save it here.</p></div>';
        return;
    }
    const listEl = document.createElement('div');
    listEl.className = 'yt-track-list';
    renderTrackItems(tracks, listEl, tracks);
    wrap.appendChild(listEl);
}

function renderDownloadsSection(area) {
    const list = getDownloadsMeta();
    if (!list.length) {
        area.innerHTML += '<div class="dl-empty"><i class="fa-solid fa-arrow-down-to-line dl-empty-icon"></i>' +
            '<p>No downloaded songs yet.</p>' +
            '<p style="font-size:.8rem;color:#555;">Tap ⋮ on any song to save it for offline.</p></div>';
        return;
    }
    const tracks = list.map(d => ({ id:d.id, title:d.title, artist:d.artist, coverArt:d.coverArt, url:d.url, language:d.language }));
    const listEl = document.createElement('div');
    listEl.className = 'yt-track-list';
    renderTrackItems(tracks, listEl, tracks);
    area.appendChild(listEl);
}

// ── PLAYLISTS ────────────────────────────────────────────────────────────────
let currentPlaylists = [];

async function loadUserPlaylists() {
    if (!auth.currentUser) return [];
    try {
        const snap = await db.collection('playlists')
            .where('ownerId', '==', auth.currentUser.uid)
            .orderBy('createdAt', 'desc')
            .get();
        currentPlaylists = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return currentPlaylists;
    } catch { return []; }
}

async function loadPublicPlaylists() {
    try {
        const snap = await db.collection('playlists')
            .where('visibility', '==', 'public')
            .orderBy('createdAt', 'desc')
            .limit(20)
            .get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => !auth.currentUser || p.ownerId !== auth.currentUser.uid);
    } catch { return []; }
}

async function renderPlaylistsSection(area) {
    area.innerHTML += '<div class="pl-loading"><i class="fa-solid fa-spinner fa-spin"></i></div>';
    const [mine, pub] = await Promise.all([loadUserPlaylists(), loadPublicPlaylists()]);
    // Remove loading
    const loading = area.querySelector('.pl-loading');
    if (loading) loading.remove();

    // Create button
    const createRow = document.createElement('div');
    createRow.className = 'pl-create-row';
    createRow.innerHTML = '<button class="pl-create-btn" id="pl-create-btn"><i class="fa-solid fa-plus"></i> Create Playlist</button>';
    createRow.querySelector('#pl-create-btn').addEventListener('click', openCreatePlaylistModal);
    area.appendChild(createRow);

    // My playlists
    if (mine.length) {
        const myHeader = document.createElement('div');
        myHeader.className = 'section-title-row';
        myHeader.innerHTML = '<h2 class="section-heading"><span class="section-dot"></span>My Playlists</h2>';
        area.appendChild(myHeader);
        renderPlaylistGrid(mine, area);
    }

    // Public playlists
    if (pub.length) {
        const pubHeader = document.createElement('div');
        pubHeader.className = 'section-title-row';
        pubHeader.style.marginTop = '20px';
        pubHeader.innerHTML = '<h2 class="section-heading"><span class="section-dot"></span>Public Playlists</h2>';
        area.appendChild(pubHeader);
        renderPlaylistGrid(pub, area);
    }

    if (!mine.length && !pub.length) {
        area.innerHTML += '<div class="dl-empty"><i class="fa-solid fa-list-music dl-empty-icon"></i>' +
            '<p>No playlists yet.</p><p style="font-size:.8rem;color:#555;">Create your first playlist above.</p></div>';
    }
}

function renderPlaylistGrid(playlists, area) {
    const grid = document.createElement('div');
    grid.className = 'pl-grid';
    playlists.forEach(pl => {
        const card = document.createElement('div');
        card.className = 'pl-card';
        const isOwner = auth.currentUser && pl.ownerId === auth.currentUser.uid;
        const visIcon = pl.visibility === 'private' ? '<i class="fa-solid fa-lock pl-vis-icon"></i>' : '';
        const artHtml = pl.coverArt
            ? `<img src="${pl.coverArt}" class="pl-card-art">`
            : `<div class="pl-card-art pl-card-art-fallback"><i class="fa-solid fa-music"></i></div>`;
        card.innerHTML = `
            ${artHtml}
            <div class="pl-card-info">
                <span class="pl-card-name">${escHtml(pl.name)}${visIcon}</span>
                <span class="pl-card-meta">${pl.trackCount || 0} songs${isOwner ? '' : ' · ' + escHtml(pl.ownerName || 'Unknown')}</span>
            </div>`;
        card.addEventListener('click', () => openPlaylistView(pl));
        grid.appendChild(card);
    });
    area.appendChild(grid);
}

// ── CREATE PLAYLIST MODAL ─────────────────────────────────────────────────────
let createPlVisibility = 'public';

function openCreatePlaylistModal() {
    document.getElementById('cpl-name-input').value  = '';
    document.getElementById('cpl-desc-input').value  = '';
    document.getElementById('cpl-error').style.display = 'none';
    createPlVisibility = 'public';
    document.querySelectorAll('.pl-vis-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-vis') === 'public'));
    document.getElementById('create-playlist-modal').style.display = 'flex';
}
document.getElementById('cpl-close-btn')?.addEventListener('click', () => {
    document.getElementById('create-playlist-modal').style.display = 'none';
});
document.getElementById('create-playlist-modal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('create-playlist-modal'))
        document.getElementById('create-playlist-modal').style.display = 'none';
});
document.querySelectorAll('.pl-vis-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        createPlVisibility = btn.getAttribute('data-vis');
        document.querySelectorAll('.pl-vis-btn').forEach(b => b.classList.toggle('active', b === btn));
    });
});
document.getElementById('cpl-save-btn')?.addEventListener('click', async () => {
    const name = document.getElementById('cpl-name-input').value.trim();
    const desc = document.getElementById('cpl-desc-input').value.trim();
    const errEl = document.getElementById('cpl-error');
    if (!name) { errEl.textContent = 'Please enter a playlist name.'; errEl.style.display = 'block'; return; }
    if (!auth.currentUser) { errEl.textContent = 'You must be signed in.'; errEl.style.display = 'block'; return; }
    const btn = document.getElementById('cpl-save-btn');
    btn.disabled = true; btn.textContent = 'Creating...';
    try {
        await db.collection('playlists').add({
            name, description: desc,
            visibility:  createPlVisibility,
            ownerId:     auth.currentUser.uid,
            ownerName:   auth.currentUser.displayName || 'User',
            tracks:      [],
            trackCount:  0,
            coverArt:    '',
            createdAt:   firebase.firestore.FieldValue.serverTimestamp()
        });
        document.getElementById('create-playlist-modal').style.display = 'none';
        librarySubTab = 'playlists';
        setActiveTab('library');
    } catch (err) {
        console.error('Create playlist error:', err);
        const msg = err.code === 'permission-denied'
            ? 'Permission denied. Add Firestore rules for the playlists collection (see console).'
            : 'Failed to create: ' + (err.message || 'Unknown error');
        errEl.textContent = msg; errEl.style.display = 'block';
    }
    btn.disabled = false; btn.textContent = 'Create Playlist';
});

// ── ADD TO PLAYLIST MODAL ─────────────────────────────────────────────────────
let addToPlaylistTrack = null;

document.getElementById('opt-playlist-btn')?.addEventListener('click', () => {
    addToPlaylistTrack = currentQueue[currentTrackIndex];
    if (!addToPlaylistTrack) return;
    document.getElementById('options-modal').style.display = 'none';
    openAddToPlaylistModal();
});

async function openAddToPlaylistModal() {
    document.getElementById('add-to-playlist-modal').style.display = 'flex';
    const listEl = document.getElementById('apl-list');
    listEl.innerHTML = '<p style="text-align:center;color:#555;padding:20px 0;">Loading...</p>';
    const mine = await loadUserPlaylists();
    listEl.innerHTML = '';
    if (!mine.length) {
        listEl.innerHTML = '<p style="text-align:center;color:#555;padding:20px;">No playlists yet. Create one first.</p>';
        return;
    }
    mine.forEach(pl => {
        const row = document.createElement('button');
        row.className = 'apl-row';
        const artHtml = pl.coverArt
            ? `<img src="${pl.coverArt}" class="apl-art">`
            : `<div class="apl-art apl-art-fallback"><i class="fa-solid fa-music"></i></div>`;
        row.innerHTML = `${artHtml}<span class="apl-name">${escHtml(pl.name)}</span>`;
        row.addEventListener('click', () => addTrackToPlaylist(pl));
        listEl.appendChild(row);
    });
}
document.getElementById('apl-close-btn')?.addEventListener('click', () => {
    document.getElementById('add-to-playlist-modal').style.display = 'none';
});
document.getElementById('apl-new-btn')?.addEventListener('click', () => {
    document.getElementById('add-to-playlist-modal').style.display = 'none';
    openCreatePlaylistModal();
});

async function addTrackToPlaylist(pl) {
    if (!addToPlaylistTrack) return;
    document.getElementById('add-to-playlist-modal').style.display = 'none';
    try {
        const tracks = pl.tracks || [];
        if (tracks.includes(addToPlaylistTrack.id)) { showDlToast('Already in "' + pl.name + '"'); return; }
        tracks.push(addToPlaylistTrack.id);
        // Use cover art of first track if playlist has none
        const coverArt = pl.coverArt || addToPlaylistTrack.coverArt || '';
        await db.collection('playlists').doc(pl.id).update({
            tracks, trackCount: tracks.length, coverArt
        });
        showDlToast('Added to "' + pl.name + '"');
    } catch { showDlToast('Failed to add. Try again.'); }
}

// ── PLAYLIST VIEW PAGE ─────────────────────────────────────────────────────────
async function openPlaylistView(pl) {
    const page = document.getElementById('playlist-view-page');
    document.getElementById('plv-title').textContent = pl.name;
    const isOwner = auth.currentUser && pl.ownerId === auth.currentUser.uid;
    const visText = pl.visibility === 'private' ? '🔒 Private' : '🌐 Public';
    document.getElementById('plv-meta').innerHTML =
        `<div class="plv-meta-inner">
            <span>${visText} · ${pl.trackCount || 0} songs</span>
            ${pl.description ? '<p>' + escHtml(pl.description) + '</p>' : ''}
        </div>`;

    // Load track objects in playlist order (not allTracks order)
    const trackIds = pl.tracks || [];
    const trackObjs = trackIds.map(id => allTracks.find(t => t.id === id)).filter(Boolean);
    const listEl = document.getElementById('plv-track-list');
    listEl.innerHTML = '';
    if (trackObjs.length) {
        renderTrackItems(trackObjs, listEl, trackObjs);
    } else {
        listEl.innerHTML = '<p style="text-align:center;color:#555;padding:30px 0;">This playlist is empty.</p>';
    }

    // Menu button — delete if owner
    const menuBtn = document.getElementById('plv-menu-btn');
    menuBtn.onclick = () => {
        if (!isOwner) return;
        if (confirm('Delete playlist "' + pl.name + '"?')) {
            db.collection('playlists').doc(pl.id).delete().then(() => {
                closePlaylistView();
                showDlToast('Playlist deleted');
                librarySubTab = 'playlists';
                setActiveTab('library');
            });
        }
    };
    menuBtn.style.display = isOwner ? 'block' : 'none';

    page.style.display = 'flex';
    requestAnimationFrame(() => page.classList.add('legal-open'));
    if (!PAGE_STACK.some(e => e.name === 'playlist-view'))
        pushBackStack('playlist-view', closePlaylistView);
}

function closePlaylistView() {
    const page = document.getElementById('playlist-view-page');
    if (!page) return;
    page.classList.remove('legal-open');
    setTimeout(() => { page.style.display = 'none'; }, 300);
    const idx = PAGE_STACK.findIndex(e => e.name === 'playlist-view');
    if (idx !== -1) PAGE_STACK.splice(idx, 1);
}
document.getElementById('plv-back-btn')?.addEventListener('click', closePlaylistView);
document.getElementById('opt-share-btn').addEventListener('click', () => {
    const track = currentQueue[currentTrackIndex];
    if (!track) return;
    // Deep link includes track ID so recipients land directly on the song
    const shareUrl = location.origin + location.pathname + '#song/' + track.id;
    if (navigator.share) {
        navigator.share({ title: track.title + ' — HalalTune', text: 'Listen to ' + track.title + ' by ' + track.artist, url: shareUrl }).catch(() => {});
    } else {
        navigator.clipboard?.writeText(shareUrl).then(() => showDlToast('Link copied!')).catch(() => showDlToast('Share: ' + shareUrl));
    }
    document.getElementById('options-modal').style.display = 'none';
});

// Handle deep-link on page load — play shared track when allTracks is ready
function handleDeepLink() {
    const hash = location.hash;
    if (!hash.startsWith('#song/')) return;
    const trackId = hash.slice(6);
    const track   = allTracks.find(t => t.id === trackId);
    if (!track) return;
    currentQueue      = [...allTracks];
    currentTrackIndex = allTracks.indexOf(track);
    playTrack();
    // Open fullscreen player automatically
    setTimeout(() => { document.getElementById('full-screen-player')?.classList.add('active'); }, 400);
    // Clear hash so refresh doesn't auto-play again
    history.replaceState(null, '', location.pathname);
}
