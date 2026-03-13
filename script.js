// ==========================================
// 0. PWA SERVICE WORKER REGISTRATION
// ==========================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => console.log(err));
    });
}

// ==========================================
// 1. FIREBASE INITIALIZATION
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
const db = firebase.firestore();

let allTracks = [];      
let currentQueue = [];
let currentTrackIndex = -1;
let isShuffle = false;
let isRepeat = false;
let likedSongIds = new Set();
let currentTab = 'all'; 

// Generate Local UID for Anonymous Listener Tracking
let localUserId = localStorage.getItem('halaltune_uid');
if (!localUserId) {
    localUserId = 'anon_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('halaltune_uid', localUserId);
}

// ==========================================
// 2. AUTHENTICATION (GOOGLE) & ROUTING
// ==========================================
const introScreen = document.getElementById('intro-screen');
const authScreen = document.getElementById('auth-screen');
const appMain = document.getElementById('app-main');

auth.onAuthStateChanged(user => {
    if (user) {
        db.collection('users').doc(user.uid).set({
            lastLogin: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        introScreen.style.display = 'none';
        authScreen.style.display = 'none';
        appMain.style.display = 'flex';
        gsap.to(appMain, { opacity: 1, duration: 0.5 });
        
        db.collection('users').doc(user.uid).collection('likes').onSnapshot(snap => {
            likedSongIds.clear(); 
            snap.forEach(doc => likedSongIds.add(doc.id));
            updateGlobalLikeButtons();
            
            if(currentTab === 'liked') renderList(getFilteredTracks());
            else {
                document.querySelectorAll('.list-like-btn').forEach(btn => {
                    const tid = btn.getAttribute('data-id');
                    const icon = btn.querySelector('i');
                    if(likedSongIds.has(tid)) {
                        btn.classList.add('liked');
                        icon.className = 'fa-solid fa-heart';
                    } else {
                        btn.classList.remove('liked');
                        icon.className = 'fa-regular fa-heart';
                    }
                });
            }
        });
        fetchAllTracks(); 
    } else {
        appMain.style.display = 'none';
        authScreen.style.display = 'none';
        introScreen.style.display = 'flex';
        gsap.to(introScreen, { opacity: 1, duration: 0.5 });
    }
});

document.getElementById('get-started-btn').addEventListener('click', () => {
    gsap.to(introScreen, { y: -50, opacity: 0, duration: 0.4, onComplete: () => {
        introScreen.style.display = 'none';
        authScreen.style.display = 'flex';
        gsap.fromTo(authScreen, { y: 50, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: 'power3.out' });
    }});
});

// Google Authentication
document.getElementById('google-login-btn').addEventListener('click', () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).then((result) => {
        console.log("Successfully logged in as: ", result.user.displayName);
    }).catch((error) => {
        console.error("Google Sign-In Error:", error);
        if (error.message.includes('disallowed_useragent') || error.code === 'auth/web-storage-unsupported') {
            alert("⚠️ GOOGLE SECURITY BLOCK ⚠️\n\nGoogle blocks logins inside code editors like Spck Preview.\n\nPlease open your standard Chrome browser and go to your localhost URL, or push to GitHub to test logging in!");
        } else {
            alert("Login Failed: " + error.message);
        }
    });
});

const logout = () => auth.signOut();
document.getElementById('logout-btn-desktop')?.addEventListener('click', logout);
document.getElementById('logout-btn-mobile')?.addEventListener('click', logout);

// ==========================================
// 3. FETCH, FILTER & RENDER LIST LOGIC
// ==========================================
const listContainer = document.getElementById('track-list');
const searchInput = document.getElementById('search-input');

async function fetchAllTracks() {
    listContainer.innerHTML = '<p style="text-align: center; color: #aaa; margin-top: 40px;">Loading library...</p>'; 
    try {
        const snapshot = await db.collection('songs').orderBy('createdAt', 'desc').get();
        allTracks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderList(getFilteredTracks());
    } catch (error) { 
        listContainer.innerHTML = '<p style="color: #ff4d4d; text-align: center;">Error loading tracks.</p>'; 
    }
}

function handleTabSwitch(tabName) {
    currentTab = tabName;
    document.querySelectorAll('.yt-nav-btn, .yt-chip, .yt-nav-item').forEach(btn => {
        if(btn.getAttribute('data-tab') === tabName) btn.classList.add('active');
        else btn.classList.remove('active');
    });
    renderList(getFilteredTracks());
}

document.querySelectorAll('.yt-nav-btn, .yt-chip, .yt-nav-item').forEach(btn => {
    if(btn.id && btn.id.includes('logout')) return;
    btn.addEventListener('click', () => handleTabSwitch(btn.getAttribute('data-tab')));
});

searchInput?.addEventListener('input', () => renderList(getFilteredTracks()));

function getFilteredTracks() {
    let tracks = allTracks;
    const term = searchInput?.value.toLowerCase() || "";
    if(term) tracks = tracks.filter(t => t.title.toLowerCase().includes(term) || t.artist.toLowerCase().includes(term));
    if(currentTab === 'liked') tracks = tracks.filter(t => likedSongIds.has(t.id));
    return tracks;
}

function renderList(trackArray) {
    listContainer.innerHTML = '';
    if(trackArray.length === 0) {
        listContainer.innerHTML = '<p style="text-align: center; color: #aaa; margin-top: 40px;">No tracks found.</p>';
        return;
    }

    trackArray.forEach((track, index) => {
        const item = document.createElement('div');
        item.className = 'yt-list-item';
        if(currentQueue.length > 0 && currentQueue[currentTrackIndex] && currentQueue[currentTrackIndex].id === track.id) {
            item.classList.add('active');
        }

        const isLiked = likedSongIds.has(track.id);
        const heartClass = isLiked ? 'fa-solid liked' : 'fa-regular';
        const artHtml = track.coverArt ? `<img src="${track.coverArt}">` : `<i class="fa-solid fa-music"></i>`;

        item.innerHTML = `
            <div class="yt-list-art-wrapper">
                ${artHtml}
                <div class="yt-list-play-overlay"><i class="fa-solid fa-play"></i></div>
            </div>
            <div class="yt-list-meta">
                <h3>${track.title}</h3>
                <p>${track.artist}</p>
            </div>
            <div class="yt-list-actions">
                <button class="list-like-btn ${isLiked ? 'liked' : ''}" data-id="${track.id}">
                    <i class="${heartClass} fa-heart"></i>
                </button>
            </div>
        `;
        
        item.addEventListener('click', (e) => {
            if(e.target.closest('.list-like-btn')) return;
            currentQueue = [...trackArray];
            currentTrackIndex = index;
            playTrack();
            document.querySelectorAll('.yt-list-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
        });

        item.querySelector('.list-like-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            toggleLike(track.id);
        });

        listContainer.appendChild(item);
    });
}

async function toggleLike(trackId) {
    if(!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    const likeRef = db.collection('users').doc(uid).collection('likes').doc(trackId);
    const songRef = db.collection('songs').doc(trackId);

    if (likedSongIds.has(trackId)) {
        await likeRef.delete(); 
        await songRef.update({ likeCount: firebase.firestore.FieldValue.increment(-1) });
    } else {
        await likeRef.set({ addedAt: firebase.firestore.FieldValue.serverTimestamp() });
        await songRef.update({ likeCount: firebase.firestore.FieldValue.increment(1) });
    }
}

function updateGlobalLikeButtons() {
    if(!currentQueue[currentTrackIndex]) return;
    const trackId = currentQueue[currentTrackIndex].id;
    const fsLikeBtn = document.getElementById('fs-like-btn');
    if(likedSongIds.has(trackId)) {
        fsLikeBtn.innerHTML = '<i class="fa-solid fa-heart"></i>';
        fsLikeBtn.classList.add('liked');
    } else {
        fsLikeBtn.innerHTML = '<i class="fa-regular fa-heart"></i>';
        fsLikeBtn.classList.remove('liked');
    }
}
document.getElementById('fs-like-btn').addEventListener('click', () => toggleLike(currentQueue[currentTrackIndex].id));

// ==========================================
// 4. AUDIO PLAYBACK & OS NOTIFICATION LOGIC
// ==========================================
const audio = document.getElementById('audio-element');

function playTrack() {
    if (currentQueue.length === 0 || currentTrackIndex < 0) return;
    const track = currentQueue[currentTrackIndex];

    document.getElementById('player-title').innerText = track.title;
    document.getElementById('player-artist').innerText = track.artist;
    document.getElementById('fs-player-title').innerText = track.title;
    document.getElementById('fs-player-artist').innerText = track.artist;
    
    document.getElementById('player-art').innerHTML = track.coverArt ? `<img src="${track.coverArt}">` : `<i class="fa-solid fa-music"></i>`;
    const artView = document.getElementById('fs-artwork-view');
    artView.innerHTML = track.coverArt ? `<img src="${track.coverArt}">` : `<div class="fs-art-placeholder"><i class="fa-solid fa-music"></i></div>`;

    updateGlobalLikeButtons();
    audio.src = track.url;
    audio.play();
    setPlayState(true);
    
    renderQueueUI();
    fetchLyrics(track.title, track.artist);
    renderRelated(track);
    setupMediaSession(track); // Setup the native OS notification

    const activeUid = auth.currentUser ? auth.currentUser.uid : localUserId;
    db.collection('songs').doc(track.id).update({
        streamCount: firebase.firestore.FieldValue.increment(1),
        listeners: firebase.firestore.FieldValue.arrayUnion(activeUid)
    }).catch(err => console.log(err));
}

// --- MEDIA SESSION API (Android/iOS Notification integration) ---
function setupMediaSession(track) {
    if ('mediaSession' in navigator) {
        // Set Notification Metadata (Title, Artist, Art)
        navigator.mediaSession.metadata = new MediaMetadata({
            title: track.title,
            artist: track.artist,
            album: 'HalalTune',
            artwork: [
                { src: track.coverArt || 'icon.png', sizes: '512x512', type: 'image/png' },
                { src: track.coverArt || 'icon.png', sizes: '192x192', type: 'image/png' }
            ]
        });

        // Hook up system hardware/notification buttons to our app's logic
        navigator.mediaSession.setActionHandler('play', () => { audio.play(); setPlayState(true); });
        navigator.mediaSession.setActionHandler('pause', () => { audio.pause(); setPlayState(false); });
        navigator.mediaSession.setActionHandler('previoustrack', () => playPrev());
        navigator.mediaSession.setActionHandler('nexttrack', () => playNext());
        
        // Connect the native system seekbar to our audio element
        navigator.mediaSession.setActionHandler('seekto', (details) => {
            if (details.fastSeek && 'fastSeek' in audio) {
                audio.fastSeek(details.seekTime);
            } else {
                audio.currentTime = details.seekTime;
            }
            updatePositionState();
        });
    }
}

// Keep the OS notification seekbar perfectly in sync with the song
function updatePositionState() {
    if ('mediaSession' in navigator && !isNaN(audio.duration)) {
        navigator.mediaSession.setPositionState({
            duration: audio.duration,
            playbackRate: audio.playbackRate,
            position: audio.currentTime
        });
    }
}

// Update the system seekbar whenever the track naturally progresses or metadata loads
audio.addEventListener('loadeddata', updatePositionState);
audio.addEventListener('seeked', updatePositionState);

// --- BUBBLE TABS LOGIC ---
const fsArtView = document.getElementById('fs-artwork-view');
const fsTabContentView = document.getElementById('fs-tab-content-view');
const bubbleBtns = document.querySelectorAll('.fs-bubble-btn');
const viewQueue = document.getElementById('fs-queue-view');
const viewLyrics = document.getElementById('fs-lyrics-view');
const viewRelated = document.getElementById('fs-related-view');

bubbleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-target');
        
        if(btn.classList.contains('active')) {
            btn.classList.remove('active');
            fsTabContentView.style.display = 'none';
            fsArtView.style.display = 'flex';
            return;
        }

        bubbleBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        fsArtView.style.display = 'none';
        fsTabContentView.style.display = 'block';
        viewQueue.style.display = 'none';
        viewLyrics.style.display = 'none';
        viewRelated.style.display = 'none';

        if(target === 'queue') viewQueue.style.display = 'block';
        if(target === 'lyrics') viewLyrics.style.display = 'block';
        if(target === 'related') viewRelated.style.display = 'block';
    });
});

function renderQueueUI() {
    viewQueue.innerHTML = '<div class="q-title-header">Up Next</div>';
    if (currentTrackIndex >= currentQueue.length - 1) {
        viewQueue.innerHTML += '<p class="lyrics-msg">End of queue.</p>';
        return;
    }
    let count = 0;
    for(let i = currentTrackIndex + 1; i < currentQueue.length; i++) {
        if(count >= 15) break; 
        const t = currentQueue[i];
        const item = document.createElement('div');
        item.className = 'q-item';
        const artHtml = t.coverArt ? `<img src="${t.coverArt}" class="q-item-art">` : `<div class="q-item-art"><i class="fa-solid fa-music"></i></div>`;
        item.innerHTML = `${artHtml}<div class="q-item-info"><span class="q-item-title">${t.title}</span><span class="q-item-artist">${t.artist}</span></div>`;
        
        item.addEventListener('click', () => {
            currentTrackIndex = i;
            playTrack();
            renderList(getFilteredTracks());
        });
        viewQueue.appendChild(item);
        count++;
    }
}

async function fetchLyrics(title, artist) {
    viewLyrics.innerHTML = '<p class="lyrics-msg">Searching for lyrics...</p>';
    try {
        const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`;
        const res = await fetch(url);
        if(!res.ok) throw new Error("Not found");
        const data = await res.json();
        if(data.plainLyrics) viewLyrics.innerHTML = `<pre class="lyrics-text">${data.plainLyrics}</pre>`;
        else throw new Error("No lyrics");
    } catch (err) {
        viewLyrics.innerHTML = '<p class="lyrics-msg">Lyrics not available for this track.</p>';
    }
}

function renderRelated(currentTrack) {
    viewRelated.innerHTML = '<div class="q-title-header">More Like This</div>';
    let related = allTracks.filter(t => t.artist === currentTrack.artist && t.id !== currentTrack.id);
    if(related.length === 0) related = allTracks.filter(t => t.id !== currentTrack.id).sort(() => 0.5 - Math.random()).slice(0, 5);

    related.forEach(t => {
        const item = document.createElement('div');
        item.className = 'q-item';
        const artHtml = t.coverArt ? `<img src="${t.coverArt}" class="q-item-art">` : `<div class="q-item-art"><i class="fa-solid fa-music"></i></div>`;
        item.innerHTML = `${artHtml}<div class="q-item-info"><span class="q-item-title">${t.title}</span><span class="q-item-artist">${t.artist}</span></div>`;
        
        item.addEventListener('click', () => {
            const idx = allTracks.findIndex(track => track.id === t.id);
            if(idx !== -1) {
                currentQueue = [...allTracks];
                currentTrackIndex = idx;
                playTrack();
                renderList(getFilteredTracks());
            }
        });
        viewRelated.appendChild(item);
    });
}

// --- CONTROLS ---
function playNext() {
    if(currentQueue.length === 0) return;
    if(isShuffle) currentTrackIndex = Math.floor(Math.random() * currentQueue.length);
    else { currentTrackIndex++; if(currentTrackIndex >= currentQueue.length) currentTrackIndex = 0; }
    playTrack();
    renderList(getFilteredTracks()); 
}

function playPrev() {
    if(currentQueue.length === 0) return;
    if(isShuffle) currentTrackIndex = Math.floor(Math.random() * currentQueue.length);
    else { currentTrackIndex--; if(currentTrackIndex < 0) currentTrackIndex = currentQueue.length - 1; }
    playTrack();
    renderList(getFilteredTracks());
}

document.getElementById('fs-next-btn').addEventListener('click', playNext);
document.getElementById('desk-next-btn')?.addEventListener('click', playNext);
document.getElementById('fs-prev-btn').addEventListener('click', playPrev);
document.getElementById('desk-prev-btn')?.addEventListener('click', playPrev);

const shuffleBtn = document.getElementById('fs-shuffle-btn');
shuffleBtn.addEventListener('click', () => {
    isShuffle = !isShuffle;
    shuffleBtn.classList.toggle('active', isShuffle);
});

const repeatBtn = document.getElementById('fs-repeat-btn');
repeatBtn.addEventListener('click', () => {
    isRepeat = !isRepeat;
    repeatBtn.classList.toggle('active', isRepeat);
});

const playBtns = [document.getElementById('play-btn'), document.getElementById('fs-play-btn')];
function setPlayState(isPlaying) {
    playBtns.forEach(btn => {
        const icon = btn.querySelector('i');
        if(isPlaying) icon.classList.replace('fa-play', 'fa-pause');
        else icon.classList.replace('fa-pause', 'fa-play');
    });
    
    // Update OS Notification playback state
    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }
}

playBtns.forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if(!audio.src) return;
    if(audio.paused) { audio.play(); setPlayState(true); } else { audio.pause(); setPlayState(false); }
}));

function updateM3Slider(bar, percent) {
    bar.value = percent;
    bar.style.background = `linear-gradient(to right, #ffffff ${percent}%, #333333 ${percent}%)`;
}

const miniBar = document.getElementById('progress-bar');
const fsBar = document.getElementById('fs-progress-bar');

audio.addEventListener('timeupdate', () => {
    if (audio.duration) {
        const percent = (audio.currentTime / audio.duration) * 100;
        updateM3Slider(miniBar, percent);
        updateM3Slider(fsBar, percent);
        
        let cMins = Math.floor(audio.currentTime / 60);
        let cSecs = Math.floor(audio.currentTime % 60).toString().padStart(2, '0');
        document.getElementById('fs-current-time').innerText = `${cMins}:${cSecs}`;
        
        let tMins = Math.floor(audio.duration / 60);
        let tSecs = Math.floor(audio.duration % 60).toString().padStart(2, '0');
        document.getElementById('fs-total-time').innerText = `${tMins}:${tSecs}`;
    }
});

function handleSeek(e) {
    e.stopPropagation();
    if(!audio.src) return;
    const percent = e.target.value;
    audio.currentTime = (percent / 100) * audio.duration;
    updateM3Slider(miniBar, percent);
    updateM3Slider(fsBar, percent);
}

miniBar.addEventListener('input', handleSeek);
fsBar.addEventListener('input', handleSeek);

audio.addEventListener('ended', () => {
    if(isRepeat) { audio.currentTime = 0; audio.play(); } 
    else { playNext(); }
});

// ==========================================
// 5. 3-DOT MENU & DOWNLOAD LOGIC
// ==========================================
const optionsModal = document.getElementById('options-modal');
document.getElementById('fs-menu-btn').addEventListener('click', () => {
    if(!currentQueue[currentTrackIndex]) return;
    optionsModal.style.display = 'flex';
});

document.getElementById('opt-close-btn').addEventListener('click', () => optionsModal.style.display = 'none');
optionsModal.addEventListener('click', (e) => { if(e.target === optionsModal) optionsModal.style.display = 'none'; });

document.getElementById('opt-download-btn').addEventListener('click', () => {
    if(!currentQueue[currentTrackIndex]) return;
    const track = currentQueue[currentTrackIndex];
    
    db.collection('songs').doc(track.id).update({
        downloadCount: firebase.firestore.FieldValue.increment(1)
    });
    
    window.open(track.url, '_blank');
    optionsModal.style.display = 'none';
});

document.getElementById('opt-share-btn').addEventListener('click', () => {
    if(!currentQueue[currentTrackIndex]) return;
    const track = currentQueue[currentTrackIndex];
    
    if (navigator.share) {
        navigator.share({
            title: `Listen to ${track.title} by ${track.artist}`,
            url: window.location.href
        }).catch(console.error);
    } else {
        alert("Link copied to clipboard!");
    }
    optionsModal.style.display = 'none';
});

// ==========================================
// 6. PLAYER SWIPE GESTURES
// ==========================================
const miniPlayer = document.getElementById('mini-player');
const fsPlayer = document.getElementById('full-screen-player');
const closeFsBtn = document.getElementById('close-fs-btn');

miniPlayer.addEventListener('click', (e) => {
    if (window.innerWidth <= 768 && !e.target.closest('button') && !e.target.closest('input')) fsPlayer.classList.add('active');
});
closeFsBtn.addEventListener('click', () => fsPlayer.classList.remove('active'));

let startY = 0;
miniPlayer.addEventListener('touchstart', e => startY = e.touches[0].clientY);
miniPlayer.addEventListener('touchend', e => {
    let endY = e.changedTouches[0].clientY;
    if (window.innerWidth <= 768 && startY - endY > 30) fsPlayer.classList.add('active'); 
});

fsPlayer.addEventListener('touchstart', e => startY = e.touches[0].clientY);
fsPlayer.addEventListener('touchend', e => {
    if(e.target.closest('.fs-scrollable-content') || e.target.closest('.options-content')) return;
    let endY = e.changedTouches[0].clientY;
    if (endY - startY > 80) fsPlayer.classList.remove('active'); 
});
