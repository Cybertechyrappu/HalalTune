// ==========================================
// 1. FIREBASE INITIALIZATION & SECURE AUTH
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
const db = firebase.firestore();

// Global song snapshot cache for duplicate detection & rendering
let allSongsCache = [];
let currentDbTab = 'all'; // 'all' or 'malayalam'

auth.onAuthStateChanged(user => {
    if (user && user.email === 'admin@halaltune.com') {
        document.getElementById('admin-login-screen').style.display = 'none';
        document.getElementById('admin-dashboard').style.display = 'flex';
        fetchDatabaseData();
        fetchTotalUsers();
    } else {
        document.getElementById('admin-login-screen').style.display = 'flex';
        document.getElementById('admin-dashboard').style.display = 'none';
    }
});

document.getElementById('unlock-btn').addEventListener('click', () => {
    const email = document.getElementById('admin-email-input').value.trim();
    const pass = document.getElementById('admin-pass-input').value;
    const errorText = document.getElementById('login-error');
    const loginBtn = document.getElementById('unlock-btn');

    if (!email || !pass) {
        errorText.innerText = "Please enter both email and password.";
        errorText.style.display = 'block';
        return;
    }

    loginBtn.innerText = "Authenticating...";

    auth.signInWithEmailAndPassword(email, pass)
        .then(() => {
            loginBtn.innerText = "Secure Login";
            errorText.style.display = 'none';
        })
        .catch(error => {
            loginBtn.innerText = "Secure Login";
            errorText.innerText = "Invalid Email or Password";
            errorText.style.display = 'block';
        });
});

document.getElementById('lock-btn').addEventListener('click', () => {
    auth.signOut().then(() => {
        document.getElementById('admin-email-input').value = '';
        document.getElementById('admin-pass-input').value = '';
    });
});

// ==========================================
// 2. BATCH METADATA EXTRACTION & UI
// ==========================================
let batchQueue = [];

const dropZone = document.getElementById('drop-zone');
const batchInput = document.getElementById('batch-audio-input');
const triggerBtn = document.getElementById('trigger-upload-btn');
const queueContainer = document.getElementById('batch-queue-container');
const queueDiv = document.getElementById('upload-queue');
const queueCount = document.getElementById('queue-count');
const startBatchBtn = document.getElementById('start-batch-btn');

triggerBtn.addEventListener('click', (e) => { e.stopPropagation(); batchInput.click(); });
dropZone.addEventListener('click', () => batchInput.click());

dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    processSelectedFiles(e.dataTransfer.files);
});

batchInput.addEventListener('change', (e) => processSelectedFiles(e.target.files));

async function processSelectedFiles(files) {
    if (!files || files.length === 0) return;
    queueContainer.style.display = 'block';
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.type.startsWith('audio/')) continue;
        
        const uniqueId = 'q_' + Date.now() + '_' + i;
        
        const qItem = { 
            id: uniqueId, 
            file: file, 
            title: file.name.replace(/\.[^/.]+$/, ""),
            artist: "Unknown Artist", 
            coverBase64: null, 
            status: 'extracting',
            isMalayalam: false    // ← new field
        };
        
        batchQueue.push(qItem);
        renderQueue();
        
        await extractMetadata(qItem);
        renderQueue();
    }
}

function extractMetadata(qItem) {
    return new Promise((resolve) => {
        window.jsmediatags.read(qItem.file, {
            onSuccess: function(tag) {
                qItem.title = tag.tags.title || qItem.title;
                qItem.artist = tag.tags.artist || "Unknown Artist";
                
                if (tag.tags.picture) {
                    let base64String = "";
                    for (let i = 0; i < tag.tags.picture.data.length; i++) {
                        base64String += String.fromCharCode(tag.tags.picture.data[i]);
                    }
                    qItem.coverBase64 = `data:${tag.tags.picture.format};base64,${btoa(base64String)}`;
                }
                
                qItem.status = 'pending';
                resolve();
            },
            onError: function() {
                qItem.status = 'pending';
                resolve();
            }
        });
    });
}

function renderQueue() {
    queueCount.innerText = batchQueue.length;
    queueDiv.innerHTML = '';
    
    batchQueue.forEach(item => {
        const artHtml = item.coverBase64 
            ? `<img src="${item.coverBase64}" style="width:100%;height:100%;object-fit:cover;border-radius:6px;">` 
            : `<i class="fa-solid fa-music" style="color:#666;"></i>`;
        
        const toggleId = `ml_toggle_${item.id}`;

        const div = document.createElement('div');
        div.className = 'queue-item';
        div.id = item.id;
        div.innerHTML = `
            <div class="q-art">${artHtml}</div>
            <div class="q-info">
                <div class="q-title">${item.title}</div>
                <div class="q-artist">${item.artist}</div>
                <div class="malayalam-toggle-row">
                    <span class="ml-toggle-label">Malayalam</span>
                    <label class="ml-toggle">
                        <input type="checkbox" id="${toggleId}" ${item.isMalayalam ? 'checked' : ''}>
                        <span class="ml-toggle-slider"></span>
                    </label>
                </div>
            </div>
            <div class="q-status ${item.status}" id="status_${item.id}">${item.status}</div>
        `;

        div.querySelector(`#${toggleId}`).addEventListener('change', (e) => {
            item.isMalayalam = e.target.checked;
        });

        queueDiv.appendChild(div);
    });
}

function updateItemStatus(id, text, className) {
    const statusBadge = document.getElementById('status_' + id);
    if (statusBadge) {
        statusBadge.innerText = text;
        statusBadge.className = 'q-status ' + className;
    }
}

// ==========================================
// 3. BATCH UPLOAD WITH DUPLICATE DETECTION
// ==========================================

// Resolves when user picks "delete" or "skip" in the duplicate modal
let duplicateResolveCallback = null;

document.getElementById('duplicate-delete-btn')?.addEventListener('click', () => {
    if (duplicateResolveCallback) duplicateResolveCallback('delete');
});
document.getElementById('duplicate-skip-btn')?.addEventListener('click', () => {
    if (duplicateResolveCallback) duplicateResolveCallback('skip');
});

function showDuplicateModal(title, existingDocId) {
    return new Promise((resolve) => {
        document.getElementById('duplicate-msg').innerText = 
            `"${title}" already exists in the database. Do you want to delete the existing duplicate and upload the new file?`;
        document.getElementById('duplicate-modal').style.display = 'flex';
        
        duplicateResolveCallback = (action) => {
            document.getElementById('duplicate-modal').style.display = 'none';
            duplicateResolveCallback = null;
            resolve({ action, existingDocId });
        };
    });
}

startBatchBtn.addEventListener('click', async () => {
    if (batchQueue.length === 0) return;
    
    startBatchBtn.disabled = true;
    batchInput.disabled = true;
    
    for (let i = 0; i < batchQueue.length; i++) {
        let item = batchQueue[i];
        
        if (item.status === 'done' || item.status === 'extracting') continue;
        
        try {
            item.status = 'uploading';

            // --- DUPLICATE CHECK ---
            const existingMatch = allSongsCache.find(s => 
                s.title.trim().toLowerCase() === item.title.trim().toLowerCase() &&
                s.artist.trim().toLowerCase() === item.artist.trim().toLowerCase()
            );

            if (existingMatch) {
                updateItemStatus(item.id, 'Duplicate!', 'error');
                const { action, existingDocId } = await showDuplicateModal(item.title, existingMatch.id);
                if (action === 'delete') {
                    await db.collection('songs').doc(existingDocId).delete();
                } else {
                    item.status = 'error';
                    updateItemStatus(item.id, 'Skipped', 'pending');
                    continue;
                }
            }
            
            let finalCoverUrl = "";

            if (item.coverBase64) {
                updateItemStatus(item.id, 'Uploading Art', 'uploading');
                const imgFormData = new FormData();
                imgFormData.append('file', item.coverBase64);
                imgFormData.append('upload_preset', 'halaltune_uploads');
                
                const imgRes = await fetch('https://api.cloudinary.com/v1_1/detke30vn/auto/upload', { method: 'POST', body: imgFormData });
                const imgData = await imgRes.json();
                if (imgData.secure_url) finalCoverUrl = imgData.secure_url;
            }

            updateItemStatus(item.id, 'Uploading Audio', 'uploading');
            const audioFormData = new FormData();
            audioFormData.append('file', item.file);
            audioFormData.append('upload_preset', 'halaltune_uploads'); 
            
            const audioRes = await fetch('https://api.cloudinary.com/v1_1/detke30vn/auto/upload', { method: 'POST', body: audioFormData });
            const audioData = await audioRes.json();
            
            if (!audioData.secure_url) throw new Error("Audio upload failed");
            
            updateItemStatus(item.id, 'Saving', 'uploading');
            await db.collection('songs').add({
                title: item.title,
                artist: item.artist,
                url: audioData.secure_url,
                coverArt: finalCoverUrl, 
                isMalayalam: item.isMalayalam,   // ← save Malayalam flag
                streamCount: 0, 
                downloadCount: 0,
                likeCount: 0,
                listeners: [], 
                uploadedBy: auth.currentUser.uid,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            item.status = 'done';
            updateItemStatus(item.id, 'Done', 'done');
            
        } catch(e) {
            console.error("Failed to upload " + item.title, e);
            item.status = 'error';
            updateItemStatus(item.id, 'Error', 'error');
        }
    }
    
    startBatchBtn.disabled = false;
    batchInput.disabled = false;
    startBatchBtn.innerHTML = '<i class="fa-solid fa-check"></i> Uploads Complete (Click to clear)';
    startBatchBtn.onclick = () => location.reload();
});

// ==========================================
// 4. DATABASE TABS (All / Malayalam)
// ==========================================
document.querySelectorAll('.db-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.db-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentDbTab = tab.getAttribute('data-dbtab');
        renderSongList(allSongsCache);
    });
});

function renderSongList(songs) {
    const listDiv = document.getElementById('admin-song-list');
    listDiv.innerHTML = '';

    let filtered = songs;
    if (currentDbTab === 'malayalam') {
        filtered = songs.filter(s => s.isMalayalam === true);
    }

    if (filtered.length === 0) {
        listDiv.innerHTML = '<p style="text-align: center; color: #aaa;">No tracks found.</p>';
        return;
    }

    filtered.forEach(track => {
        const mlBadge = track.isMalayalam ? `<span class="ml-badge">ML</span>` : '';
        const item = document.createElement('div');
        item.className = 'admin-song-item';
        item.innerHTML = `
            <div class="admin-song-info">
                <h4>${mlBadge}${track.title}</h4>
                <p>${track.artist}</p>
            </div>
            <div class="admin-song-stats">
                <span class="stream-badge"><i class="fa-solid fa-play"></i> ${track.streamCount || 0}</span>
                <span class="stream-badge"><i class="fa-solid fa-users"></i> ${(track.listeners || []).length}</span>
                <div class="action-btns">
                    <button class="icon-btn delete-btn" title="Delete Track" data-id="${track.id}" data-title="${track.title.replace(/'/g, "\\'")}"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
        `;
        item.querySelector('.delete-btn').addEventListener('click', () => {
            deleteTrack(track.id, track.title);
        });
        listDiv.appendChild(item);
    });
}

// ==========================================
// 5. LIVE AGGREGATION DASHBOARD
// ==========================================
function fetchDatabaseData() {
    db.collection('songs').orderBy('createdAt', 'desc').onSnapshot(snapshot => {
        let totalStreams = 0;
        let totalDownloads = 0;
        let totalLikes = 0;
        let globalUniqueListeners = new Set();
        let totalSongs = snapshot.size;

        allSongsCache = [];

        snapshot.forEach(doc => {
            const track = doc.data();
            const trackId = doc.id;
            
            const streams = track.streamCount || 0;
            const dls = track.downloadCount || 0;
            const likes = track.likeCount || 0;
            const listenersArr = track.listeners || [];
            
            totalStreams += streams;
            totalDownloads += dls;
            totalLikes += likes;
            listenersArr.forEach(uid => globalUniqueListeners.add(uid));

            allSongsCache.push({ id: trackId, ...track });
        });

        renderSongList(allSongsCache);

        document.getElementById('stat-total-songs').innerText = totalSongs;
        document.getElementById('stat-total-streams').innerText = totalStreams;
        document.getElementById('stat-total-listeners').innerText = globalUniqueListeners.size;
        document.getElementById('stat-total-downloads').innerText = totalDownloads;
        document.getElementById('stat-total-likes').innerText = totalLikes;
    });
}

// ==========================================
// 6. REGISTERED USERS — WORKING COUNT + POPUP
// ==========================================
let allUsersCache = [];

function fetchTotalUsers() {
    // Real-time listener on the users collection
    db.collection('users').onSnapshot(snap => {
        allUsersCache = [];
        snap.forEach(doc => {
            allUsersCache.push({ id: doc.id, ...doc.data() });
        });
        document.getElementById('stat-total-users').innerText = allUsersCache.length;
    });
}

// Open the users modal when clicking the card
document.getElementById('stat-users-card')?.addEventListener('click', () => {
    openUsersModal();
});

function openUsersModal() {
    document.getElementById('users-modal').style.display = 'flex';
    document.getElementById('user-search-input').value = '';
    renderUsersList(allUsersCache);
}

document.getElementById('close-users-modal')?.addEventListener('click', () => {
    document.getElementById('users-modal').style.display = 'none';
});

document.getElementById('users-modal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('users-modal')) {
        document.getElementById('users-modal').style.display = 'none';
    }
});

document.getElementById('user-search-input')?.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = allUsersCache.filter(u => {
        const email = (u.email || '').toLowerCase();
        const name = (u.displayName || '').toLowerCase();
        return email.includes(term) || name.includes(term);
    });
    renderUsersList(filtered);
});

function renderUsersList(users) {
    const listEl = document.getElementById('users-list');
    const countLabel = document.getElementById('users-count-label');
    listEl.innerHTML = '';
    countLabel.innerText = `${users.length} user${users.length !== 1 ? 's' : ''}`;

    if (users.length === 0) {
        listEl.innerHTML = '<p style="text-align:center;color:#555;padding:30px 0;">No users found.</p>';
        return;
    }

    users.forEach(user => {
        const item = document.createElement('div');
        item.className = 'user-item';

        const avatarHtml = user.photoURL 
            ? `<img src="${user.photoURL}" onerror="this.parentElement.innerHTML='<i class=\\'fa-solid fa-user\\'></i>'">`
            : `<i class="fa-solid fa-user"></i>`;

        // Format join date if available
        let joinedText = '';
        if (user.createdAt && user.createdAt.seconds) {
            const date = new Date(user.createdAt.seconds * 1000);
            joinedText = `Joined ${date.toLocaleDateString()}`;
        } else if (user.lastLogin && user.lastLogin.seconds) {
            const date = new Date(user.lastLogin.seconds * 1000);
            joinedText = `Last seen ${date.toLocaleDateString()}`;
        }

        item.innerHTML = `
            <div class="user-avatar">${avatarHtml}</div>
            <div class="user-info">
                <div class="user-name">${user.displayName || 'Anonymous User'}</div>
                <div class="user-email">${user.email || user.id}</div>
                ${joinedText ? `<div class="user-joined">${joinedText}</div>` : ''}
            </div>
            <button class="user-remove-btn" data-uid="${user.id}">
                <i class="fa-solid fa-trash"></i> Remove
            </button>
        `;

        item.querySelector('.user-remove-btn').addEventListener('click', () => {
            removeUser(user.id, user.email || user.displayName || user.id);
        });

        listEl.appendChild(item);
    });
}

async function removeUser(uid, label) {
    if (!confirm(`Remove user "${label}" from the database?\n\nNote: This removes their data record. It does not delete their authentication account.`)) return;
    try {
        await db.collection('users').doc(uid).delete();
        // allUsersCache will update automatically via the onSnapshot listener
    } catch (e) {
        console.error('Failed to remove user', e);
        alert('Failed to remove user. Check console for details.');
    }
}

// ==========================================
// 7. DELETE TRACK
// ==========================================
window.deleteTrack = async function(trackId, trackTitle) {
    if (confirm(`WARNING: Permanently delete "${trackTitle}"?`)) {
        await db.collection('songs').doc(trackId).delete();
    }
};

function deleteTrack(trackId, trackTitle) {
    window.deleteTrack(trackId, trackTitle);
}
