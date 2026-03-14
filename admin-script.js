// ==========================================
// 1. FIREBASE INIT & AUTH
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyD7bc74wJSIRi1_BhDqFjEMG2mE3noBm4g",
    authDomain: "halaltune-6c908.firebaseapp.com",
    projectId: "halaltune-6c908",
    storageBucket: "halaltune-6c908.firebasestorage.app",
    messagingSenderId: "159242961546",
    appId: "1:159242961546:web:65bdcd9c3fee61c661e373"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

// ==========================================
// 2. CONSTANTS
// ==========================================
const LANGUAGES = ['arabic', 'malayalam', 'english', 'urdu', 'others'];
const LANG_LABELS = { arabic:'Arabic', malayalam:'Malayalam', english:'English', urdu:'Urdu', others:'Others' };

// Resolve existing isMalayalam boolean to new language string
function resolveLanguage(songData) {
    if (songData.language && LANGUAGES.includes(songData.language.toLowerCase())) {
        return songData.language.toLowerCase();
    }
    if (songData.isMalayalam === true) return 'malayalam';
    return 'others';
}

// ==========================================
// 3. STATE
// ==========================================
let allSongsCache = [];
let currentDbTab  = 'all';
let allUsersCache = [];

// ==========================================
// 4. AUTH FLOW
// ==========================================
auth.onAuthStateChanged(user => {
    if (user && user.email === 'admin@halaltune.com') {
        document.getElementById('admin-login-screen').style.display = 'none';
        document.getElementById('admin-dashboard').style.display    = 'flex';
        fetchDatabaseData();
        fetchTotalUsers();
    } else {
        document.getElementById('admin-login-screen').style.display = 'flex';
        document.getElementById('admin-dashboard').style.display    = 'none';
    }
});

document.getElementById('unlock-btn').addEventListener('click', () => {
    const email  = document.getElementById('admin-email-input').value.trim();
    const pass   = document.getElementById('admin-pass-input').value;
    const errEl  = document.getElementById('login-error');
    const btn    = document.getElementById('unlock-btn');
    if (!email || !pass) {
        errEl.innerText = 'Please enter both email and password.';
        errEl.style.display = 'block';
        return;
    }
    btn.innerText = 'Authenticating...';
    auth.signInWithEmailAndPassword(email, pass)
        .then(() => { btn.innerText = 'Secure Login'; errEl.style.display = 'none'; })
        .catch(() => { btn.innerText = 'Secure Login'; errEl.innerText = 'Invalid Email or Password'; errEl.style.display = 'block'; });
});

document.getElementById('lock-btn').addEventListener('click', () => {
    auth.signOut().then(() => {
        document.getElementById('admin-email-input').value = '';
        document.getElementById('admin-pass-input').value  = '';
    });
});

// ==========================================
// 5. BATCH QUEUE & METADATA
// ==========================================
let batchQueue = [];

const dropZone        = document.getElementById('drop-zone');
const batchInput      = document.getElementById('batch-audio-input');
const triggerBtn      = document.getElementById('trigger-upload-btn');
const queueContainer  = document.getElementById('batch-queue-container');
const queueDiv        = document.getElementById('upload-queue');
const queueCountEl    = document.getElementById('queue-count');
const startBatchBtn   = document.getElementById('start-batch-btn');

triggerBtn.addEventListener('click', e => { e.stopPropagation(); batchInput.click(); });
dropZone.addEventListener('click',   () => batchInput.click());
dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    processSelectedFiles(e.dataTransfer.files);
});
batchInput.addEventListener('change', e => processSelectedFiles(e.target.files));

async function processSelectedFiles(files) {
    if (!files || !files.length) return;
    queueContainer.style.display = 'block';
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.type.startsWith('audio/')) continue;
        const qItem = {
            id:          'q_' + Date.now() + '_' + i,
            file,
            title:       file.name.replace(/\.[^/.]+$/, ''),
            artist:      'Unknown Artist',
            coverBase64: null,
            status:      'extracting',
            language:    'others'   // default language
        };
        batchQueue.push(qItem);
        renderQueue();
        await extractMetadata(qItem);
        renderQueue();
    }
}

function extractMetadata(qItem) {
    return new Promise(resolve => {
        window.jsmediatags.read(qItem.file, {
            onSuccess(tag) {
                qItem.title  = tag.tags.title  || qItem.title;
                qItem.artist = tag.tags.artist || 'Unknown Artist';
                if (tag.tags.picture) {
                    let b64 = '';
                    for (let i = 0; i < tag.tags.picture.data.length; i++)
                        b64 += String.fromCharCode(tag.tags.picture.data[i]);
                    qItem.coverBase64 = `data:${tag.tags.picture.format};base64,${btoa(b64)}`;
                }
                qItem.status = 'pending';
                resolve();
            },
            onError() { qItem.status = 'pending'; resolve(); }
        });
    });
}

function renderQueue() {
    queueCountEl.innerText = batchQueue.length;
    queueDiv.innerHTML     = '';
    batchQueue.forEach(item => {
        const artHtml = item.coverBase64
            ? `<img src="${item.coverBase64}">`
            : `<i class="fa-solid fa-music" style="color:#666;"></i>`;

        const selectId = 'lang_' + item.id;
        const options  = LANGUAGES.map(l =>
            `<option value="${l}" ${item.language === l ? 'selected' : ''}>${LANG_LABELS[l]}</option>`
        ).join('');

        const div = document.createElement('div');
        div.className = 'queue-item';
        div.id = item.id;
        div.innerHTML = `
            <div class="q-art">${artHtml}</div>
            <div class="q-info">
                <div class="q-title">${escHtml(item.title)}</div>
                <div class="q-artist">${escHtml(item.artist)}</div>
                <div class="lang-select-row">
                    <span class="lang-select-label">Language:</span>
                    <select class="lang-select" id="${selectId}">
                        ${options}
                    </select>
                </div>
            </div>
            <div class="q-status ${item.status}" id="status_${item.id}">${item.status}</div>`;

        div.querySelector('#' + selectId).addEventListener('change', e => {
            item.language = e.target.value;
        });
        queueDiv.appendChild(div);
    });
}

function updateItemStatus(id, text, cls) {
    const el = document.getElementById('status_' + id);
    if (el) { el.innerText = text; el.className = 'q-status ' + cls; }
}

// ==========================================
// 6. BATCH UPLOAD WITH DUPLICATE DETECTION
// ==========================================
let duplicateResolve = null;
document.getElementById('duplicate-delete-btn').addEventListener('click', () => { if (duplicateResolve) duplicateResolve('delete'); });
document.getElementById('duplicate-skip-btn').addEventListener('click',   () => { if (duplicateResolve) duplicateResolve('skip');   });

function showDuplicateModal(title, existingDocId) {
    return new Promise(resolve => {
        document.getElementById('duplicate-msg').innerText =
            `"${title}" already exists in the database. Delete the existing entry and upload the new file?`;
        document.getElementById('duplicate-modal').style.display = 'flex';
        duplicateResolve = action => {
            document.getElementById('duplicate-modal').style.display = 'none';
            duplicateResolve = null;
            resolve({ action, existingDocId });
        };
    });
}

startBatchBtn.addEventListener('click', async () => {
    if (!batchQueue.length) return;
    startBatchBtn.disabled = true;
    batchInput.disabled    = true;

    for (let i = 0; i < batchQueue.length; i++) {
        const item = batchQueue[i];
        if (item.status === 'done' || item.status === 'extracting') continue;

        try {
            // Duplicate check
            const dup = allSongsCache.find(s =>
                s.title.trim().toLowerCase()  === item.title.trim().toLowerCase() &&
                s.artist.trim().toLowerCase() === item.artist.trim().toLowerCase()
            );
            if (dup) {
                updateItemStatus(item.id, 'Duplicate!', 'error');
                const { action, existingDocId } = await showDuplicateModal(item.title, dup.id);
                if (action === 'delete') {
                    await db.collection('songs').doc(existingDocId).delete();
                } else {
                    updateItemStatus(item.id, 'Skipped', 'pending');
                    continue;
                }
            }

            updateItemStatus(item.id, 'Uploading', 'uploading');

            // Upload cover art
            let finalCoverUrl = '';
            if (item.coverBase64) {
                const imgForm = new FormData();
                imgForm.append('file',           item.coverBase64);
                imgForm.append('upload_preset',  'halaltune_uploads');
                const imgRes  = await fetch('https://api.cloudinary.com/v1_1/detke30vn/auto/upload', { method:'POST', body:imgForm });
                const imgData = await imgRes.json();
                if (imgData.secure_url) finalCoverUrl = imgData.secure_url;
            }

            // Upload audio
            updateItemStatus(item.id, 'Uploading Audio', 'uploading');
            const audioForm = new FormData();
            audioForm.append('file',          item.file);
            audioForm.append('upload_preset', 'halaltune_uploads');
            const audioRes  = await fetch('https://api.cloudinary.com/v1_1/detke30vn/auto/upload', { method:'POST', body:audioForm });
            const audioData = await audioRes.json();
            if (!audioData.secure_url) throw new Error('Audio upload failed');

            // Save to Firestore
            updateItemStatus(item.id, 'Saving', 'uploading');
            await db.collection('songs').add({
                title:         item.title,
                artist:        item.artist,
                url:           audioData.secure_url,
                coverArt:      finalCoverUrl,
                language:      item.language,
                isMalayalam:   item.language === 'malayalam', // backwards compat
                streamCount:   0,
                downloadCount: 0,
                likeCount:     0,
                listeners:     [],
                uploadedBy:    auth.currentUser.uid,
                createdAt:     firebase.firestore.FieldValue.serverTimestamp()
            });

            item.status = 'done';
            updateItemStatus(item.id, 'Done', 'done');

        } catch (err) {
            console.error('Upload failed for', item.title, err);
            item.status = 'error';
            updateItemStatus(item.id, 'Error', 'error');
        }
    }

    startBatchBtn.disabled = false;
    batchInput.disabled    = false;
    startBatchBtn.innerHTML = '<i class="fa-solid fa-check"></i> Uploads Complete (Click to clear)';
    startBatchBtn.onclick   = () => location.reload();
});

// ==========================================
// 7. DB TABS
// ==========================================
document.querySelectorAll('.db-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.db-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentDbTab = tab.getAttribute('data-dbtab');
        renderSongList();
    });
});

// ==========================================
// 8. LIVE DATABASE
// ==========================================
function fetchDatabaseData() {
    db.collection('songs').orderBy('createdAt', 'desc').onSnapshot(snapshot => {
        let totalStreams = 0, totalDownloads = 0, totalLikes = 0;
        const globalListeners = new Set();

        allSongsCache = [];
        snapshot.forEach(doc => {
            const d = doc.data();
            totalStreams    += d.streamCount   || 0;
            totalDownloads  += d.downloadCount || 0;
            totalLikes      += d.likeCount     || 0;
            (d.listeners || []).forEach(u => globalListeners.add(u));
            allSongsCache.push({ id: doc.id, ...d });
        });

        renderSongList();
        document.getElementById('stat-total-songs').innerText     = snapshot.size;
        document.getElementById('stat-total-streams').innerText   = totalStreams;
        document.getElementById('stat-total-listeners').innerText = globalListeners.size;
        document.getElementById('stat-total-downloads').innerText = totalDownloads;
        document.getElementById('stat-total-likes').innerText     = totalLikes;
    });
}

function renderSongList() {
    const listDiv = document.getElementById('admin-song-list');
    listDiv.innerHTML = '';

    const filtered = currentDbTab === 'all'
        ? allSongsCache
        : allSongsCache.filter(s => resolveLanguage(s) === currentDbTab);

    if (!filtered.length) {
        listDiv.innerHTML = '<p style="text-align:center;color:#aaa;padding:20px 0;">No tracks found.</p>';
        return;
    }

    filtered.forEach(track => {
        const lang      = resolveLanguage(track);
        const langLabel = LANG_LABELS[lang] || 'Others';

        const item = document.createElement('div');
        item.className = 'admin-song-item';
        item.innerHTML = `
            <div class="admin-song-info">
                <h4>
                    <span class="db-lang-badge ${lang}">${langLabel}</span>
                    ${escHtml(track.title)}
                </h4>
                <p>${escHtml(track.artist)}</p>
            </div>
            <div class="admin-song-stats">
                <span class="stream-badge"><i class="fa-solid fa-play"></i> ${track.streamCount || 0}</span>
                <span class="stream-badge"><i class="fa-solid fa-users"></i> ${(track.listeners || []).length}</span>
                <div class="action-btns">
                    <button class="icon-btn lang-btn"   title="Change Language"><i class="fa-solid fa-language"></i></button>
                    <button class="icon-btn delete-btn" title="Delete Track"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>`;

        item.querySelector('.delete-btn').addEventListener('click', () => deleteTrack(track.id, track.title));
        item.querySelector('.lang-btn').addEventListener('click',   () => openLangModal(track.id, track.title, lang));

        listDiv.appendChild(item);
    });
}

async function deleteTrack(trackId, trackTitle) {
    if (confirm(`WARNING: Permanently delete "${trackTitle}"?`))
        await db.collection('songs').doc(trackId).delete();
}

// ==========================================
// 9. CHANGE LANGUAGE MODAL
// ==========================================
let langModalTrackId    = null;
let langModalCurrentLang = null;

function resetLangModalButtons(activeLang) {
    document.querySelectorAll('.lang-select-btn').forEach(btn => {
        const lang    = btn.getAttribute('data-lang');
        btn.innerText = LANG_LABELS[lang] || lang;
        btn.disabled  = false;
        btn.classList.toggle('active', lang === (activeLang || ''));
    });
}

function openLangModal(trackId, trackTitle, currentLang) {
    langModalTrackId     = trackId;
    langModalCurrentLang = currentLang;
    document.getElementById('lang-modal-title').innerText = 'Song: ' + trackTitle;
    // Always restore button labels & highlight current lang before showing
    resetLangModalButtons(currentLang);
    document.getElementById('lang-modal').style.display = 'flex';
}

function closeLangModal() {
    document.getElementById('lang-modal').style.display = 'none';
    // Reset button labels so they are clean for next open
    resetLangModalButtons(null);
    langModalTrackId     = null;
    langModalCurrentLang = null;
}

document.getElementById('close-lang-modal').addEventListener('click', closeLangModal);
document.getElementById('lang-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('lang-modal')) closeLangModal();
});

document.querySelectorAll('.lang-select-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        if (!langModalTrackId) return;
        const newLang  = btn.getAttribute('data-lang');
        const trackId  = langModalTrackId; // capture before async

        // Disable all buttons and show saving state only on clicked btn
        document.querySelectorAll('.lang-select-btn').forEach(b => {
            b.disabled = true;
            b.classList.remove('active');
        });
        btn.classList.add('active');
        btn.innerText = 'Saving...';

        try {
            await db.collection('songs').doc(trackId).update({
                language:    newLang,
                isMalayalam: newLang === 'malayalam'
            });
            // Success: close cleanly (resetLangModalButtons called inside closeLangModal)
            closeLangModal();
        } catch (err) {
            console.error('Failed to update language', err);
            // Restore all buttons on failure so user can retry
            resetLangModalButtons(langModalCurrentLang);
            alert('Failed to update language. Please try again.');
        }
    });
});

// ==========================================
// 10. REGISTERED USERS
// ==========================================
function fetchTotalUsers() {
    db.collection('users').onSnapshot(snap => {
        allUsersCache = [];
        snap.forEach(doc => allUsersCache.push({ id: doc.id, ...doc.data() }));
        document.getElementById('stat-total-users').innerText = allUsersCache.length;
    });
}

document.getElementById('stat-users-card').addEventListener('click', openUsersModal);

function openUsersModal() {
    document.getElementById('users-modal').style.display = 'flex';
    document.getElementById('user-search-input').value   = '';
    renderUsersList(allUsersCache);
}

document.getElementById('close-users-modal').addEventListener('click', () => {
    document.getElementById('users-modal').style.display = 'none';
});
document.getElementById('users-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('users-modal'))
        document.getElementById('users-modal').style.display = 'none';
});
document.getElementById('user-search-input').addEventListener('input', e => {
    const term = e.target.value.toLowerCase();
    renderUsersList(
        !term ? allUsersCache : allUsersCache.filter(u =>
            (u.email || '').toLowerCase().includes(term) ||
            (u.displayName || '').toLowerCase().includes(term)
        )
    );
});

function renderUsersList(users) {
    const listEl   = document.getElementById('users-list');
    const countEl  = document.getElementById('users-count-label');
    listEl.innerHTML = '';
    countEl.innerText = `${users.length} user${users.length !== 1 ? 's' : ''}`;

    if (!users.length) {
        listEl.innerHTML = '<p style="text-align:center;color:#555;padding:30px 0;">No users found.</p>';
        return;
    }

    users.forEach(user => {
        const item = document.createElement('div');
        item.className = 'user-item';

        const avatarContent = user.photoURL
            ? `<img src="${user.photoURL}" onerror="this.parentElement.innerHTML='<i class=\\'fa-solid fa-user\\'></i>'">`
            : `<i class="fa-solid fa-user"></i>`;

        let joinedText = '';
        if (user.createdAt?.seconds) joinedText = `Joined ${new Date(user.createdAt.seconds * 1000).toLocaleDateString()}`;
        else if (user.lastLogin?.seconds) joinedText = `Last seen ${new Date(user.lastLogin.seconds * 1000).toLocaleDateString()}`;

        item.innerHTML = `
            <div class="user-avatar">${avatarContent}</div>
            <div class="user-info">
                <div class="user-name">${escHtml(user.displayName || 'Anonymous User')}</div>
                <div class="user-email">${escHtml(user.email || user.id)}</div>
                ${joinedText ? `<div class="user-joined">${joinedText}</div>` : ''}
            </div>
            <button class="user-remove-btn"><i class="fa-solid fa-trash"></i> Remove</button>`;

        item.querySelector('.user-remove-btn').addEventListener('click', () =>
            removeUser(user.id, user.email || user.displayName || user.id)
        );
        listEl.appendChild(item);
    });
}

async function removeUser(uid, label) {
    if (!confirm(`Remove user "${label}" from the database?\n\nNote: This removes their Firestore record only, not their auth account.`)) return;
    try {
        await db.collection('users').doc(uid).delete();
    } catch (err) {
        console.error('Failed to remove user', err);
        alert('Failed to remove user. Check console.');
    }
}

// ==========================================
// 11. UTILS
// ==========================================
function escHtml(str) {
    return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
