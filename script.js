// ==========================================
// 1. FIREBASE INITIALIZATION & STATE
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

// Global App State
let allTracks = [];      // Holds all songs from DB
let likedSongIds = new Set(); // Holds IDs of songs the user liked
let currentPlayingTrackId = null; 

function requireAuth(actionCallback) {
    if (auth.currentUser) actionCallback();
    else document.getElementById('auth-modal').classList.add('active');
}

// ==========================================
// 2. UI MODALS & SIDEBAR TOGGLES
// ==========================================
const sidebar = document.getElementById('sidebar');
const mobileOverlay = document.getElementById('mobile-overlay');
function toggleSidebar() {
    sidebar.classList.toggle('open');
    mobileOverlay.classList.toggle('active');
}
document.getElementById('menu-btn').addEventListener('click', toggleSidebar);
document.getElementById('close-menu-btn').addEventListener('click', toggleSidebar);
mobileOverlay.addEventListener('click', toggleSidebar);

const authModal = document.getElementById('auth-modal');
document.getElementById('profile-trigger').addEventListener('click', () => authModal.classList.add('active'));
document.getElementById('close-modal-btn').addEventListener('click', () => authModal.classList.remove('active'));
authModal.addEventListener('click', (e) => { if(e.target === authModal) authModal.classList.remove('active'); });

document.getElementById('google-login-btn').addEventListener('click', () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithRedirect(provider);
});
auth.getRedirectResult().catch(err => {
    console.error("Auth Error: ", err);
    alert("Login Error: " + err.message);
});

document.getElementById('logout-btn').addEventListener('click', () => {
    auth.signOut().then(() => {
        authModal.classList.remove('active');
        likedSongIds.clear(); 
        renderView('home'); 
    });
});

// Watch Auth State & Fetch User Data
auth.onAuthStateChanged(user => {
    if (user) {
        document.getElementById('login-state').style.display = 'none';
        document.getElementById('profile-state').style.display = 'flex';
        document.getElementById('modal-user-name').innerText = user.displayName || "User";
        document.getElementById('modal-user-email').innerText = user.email;
        if(user.photoURL) document.getElementById('top-bar-avatar').innerHTML = `<img src="${user.photoURL}">`;
        
        // Fetch User's Liked Songs
        db.collection('users').doc(user.uid).collection('likes').get().then(snap => {
            snap.forEach(doc => likedSongIds.add(doc.id));
            updateGlobalLikeButtons();
        });
    } else {
        document.getElementById('login-state').style.display = 'flex';
        document.getElementById('profile-state').style.display = 'none';
        document.getElementById('top-bar-avatar').innerHTML = `<i class="fa-solid fa-user"></i>`;
    }
});

// ==========================================
// 3. SPA ROUTER (NAVIGATION LOGIC)
// ==========================================
const viewContainer = document.getElementById('dynamic-view');
const navItems = document.querySelectorAll('.nav-item');

navItems.forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        
        if(item.classList.contains('auth-required') && !auth.currentUser) {
            return authModal.classList.add('active');
        }

        navItems.forEach(nav => nav.classList.remove('active'));
        item.classList.add('active');
        
        if(window.innerWidth <= 768) toggleSidebar();
        
        const viewName = item.getAttribute('data-view');
        renderView(viewName);
    });
});

function renderView(viewName) {
    viewContainer.innerHTML = ''; 
    
    if (viewName === 'home') {
        viewContainer.innerHTML = `<h2 class="section-title">Recommended for You</h2><div class="content-grid" id="grid-container"></div>`;
        renderGrid(allTracks);
    } 
    else if (viewName === 'search') {
        viewContainer.innerHTML = `
            <div class="search-container">
                <i class="fa-solid fa-magnifying-glass"></i>
                <input type="text" id="search-input" class="search-input" placeholder="What do you want to listen to?">
            </div>
            <h2 class="section-title">Browse All</h2>
            <div class="content-grid" id="grid-container"></div>
        `;
        renderGrid(allTracks);
        
        document.getElementById('search-input').addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            const filtered = allTracks.filter(t => t.title.toLowerCase().includes(term) || t.artist.toLowerCase().includes(term));
            document.querySelector('.section-title').innerText = term ? "Top Results" : "Browse All";
            renderGrid(filtered);
        });
    }
    else if (viewName === 'liked') {
        viewContainer.innerHTML = `<h2 class="section-title">Liked Songs</h2><div class="content-grid" id="grid-container"></div>`;
        const likedTracks = allTracks.filter(t => likedSongIds.has(t.id));
        if(likedTracks.length === 0) viewContainer.innerHTML += `<p style="color: var(--text-muted);">You haven't liked any songs yet.</p>`;
        else renderGrid(likedTracks);
    }
    else if (viewName === 'library') {
        viewContainer.innerHTML = `<h2 class="section-title">Your Uploads</h2><div class="content-grid" id="grid-container"></div>`;
        const myTracks = allTracks.filter(t => t.uploadedBy === auth.currentUser.uid);
        if(myTracks.length === 0) viewContainer.innerHTML += `<p style="color: var(--text-muted);">You haven't uploaded anything.</p>`;
        else renderGrid(myTracks);
    }
    else if (viewName === 'albums') {
        viewContainer.innerHTML = `<h2 class="section-title">Albums</h2><p style="color: var(--text-muted);">Album grouping feature coming soon!</p>`;
    }
}

function renderGrid(trackArray) {
    const grid = document.getElementById('grid-container');
    grid.innerHTML = '';
    
    trackArray.forEach((track, index) => {
        const card = document.createElement('div');
        card.className = 'track-card';
        
        const isLiked = likedSongIds.has(track.id);
        const heartClass = isLiked ? 'fa-solid' : 'fa-regular';
        const heartColor = isLiked ? 'var(--emerald)' : 'var(--text-muted)';
        
        const artHtml = track.coverArt 
            ? `<img src="${track.coverArt}" style="width: 100%; aspect-ratio: 1; border-radius: 6px; object-fit: cover;">` 
            : `<div class="track-image-placeholder"><i class="fa-solid fa-music"></i></div>`;

        card.innerHTML = `
            ${artHtml}
            <button class="card-like-btn" data-id="${track.id}"><i class="${heartClass} fa-heart" style="color: ${heartColor};"></i></button>
            <div class="track-meta" style="margin-top: 10px;">
                <h3>${track.title}</h3>
                <p>${track.artist}</p>
            </div>
        `;
        
        card.addEventListener('click', (e) => {
            if(e.target.closest('.card-like-btn')) return; 
            playTrack(track);
        });

        card.querySelector('.card-like-btn').addEventListener('click', (e) => {
            requireAuth(() => toggleLike(track.id, e.currentTarget.querySelector('i')));
        });

        grid.appendChild(card);
        gsap.from(card, { y: 20, opacity: 0, duration: 0.5, delay: index * 0.05 });
    });
}

// ==========================================
// 4. LIKES & PLAYLIST CREATION LOGIC
// ==========================================
async function toggleLike(trackId, iconElement) {
    const uid = auth.currentUser.uid;
    const likeRef = db.collection('users').doc(uid).collection('likes').doc(trackId);

    if (likedSongIds.has(trackId)) {
        await likeRef.delete();
        likedSongIds.delete(trackId);
        if(iconElement) { iconElement.classList.replace('fa-solid', 'fa-regular'); iconElement.style.color = "var(--text-muted)"; }
    } else {
        await likeRef.set({ addedAt: firebase.firestore.FieldValue.serverTimestamp() });
        likedSongIds.add(trackId);
        if(iconElement) { iconElement.classList.replace('fa-regular', 'fa-solid'); iconElement.style.color = "var(--emerald)"; }
    }
    
    if(trackId === currentPlayingTrackId) updateGlobalLikeButtons();
    
    if(document.querySelector('.nav-item[data-view="liked"]').classList.contains('active')) {
        renderView('liked');
    }
}

function updateGlobalLikeButtons() {
    if(!currentPlayingTrackId) return;
    const isLiked = likedSongIds.has(currentPlayingTrackId);
    const icons = [document.querySelector('#mini-like-btn i'), document.querySelector('#fs-like-btn i')];
    
    icons.forEach(icon => {
        if(!icon) return;
        if(isLiked) { icon.classList.replace('fa-regular', 'fa-solid'); icon.style.color = "var(--emerald)"; }
        else { icon.classList.replace('fa-solid', 'fa-regular'); icon.style.color = "var(--text-muted)"; }
    });
}

document.getElementById('mini-like-btn').addEventListener('click', (e) => { e.stopPropagation(); requireAuth(() => toggleLike(currentPlayingTrackId, null)); });
document.getElementById('fs-like-btn').addEventListener('click', () => requireAuth(() => toggleLike(currentPlayingTrackId, null)));

document.getElementById('create-playlist-btn').addEventListener('click', (e) => {
    e.preventDefault();
    requireAuth(() => {
        const name = prompt("Name your new playlist:", "My Playlist");
        if(name) {
            db.collection('users').doc(auth.currentUser.uid).collection('playlists').add({ name: name, tracks: [], createdAt: firebase.firestore.FieldValue.serverTimestamp() });
            alert(`Playlist "${name}" created!`);
        }
    });
});

// ==========================================
// 5. CLOUDINARY UPLOAD WIDGET
// ==========================================
let uploadedAudioUrl = "";
let uploadedCoverUrl = "";

const cloudinaryWidget = cloudinary.createUploadWidget({
    cloudName: 'detke30vn', 
    uploadPreset: 'halaltune_uploads', 
    sources: ['local', 'url'], 
    multiple: true, 
    clientAllowedFormats: ['mp3', 'wav', 'png', 'jpg', 'jpeg'],
    maxFileSize: 50000000, 
    theme: "minimal",
    styles: { palette: { window: "#181818", sourceBg: "#0a0a0a", windowBorder: "#10b981", tabIcon: "#ffffff", action: "#10b981", inProgress: "#fbbf24", complete: "#10b981", textDark: "#000000", textLight: "#ffffff" } }
}, async (error, result) => {
    if (!error && result && result.event === "success") {
        if (result.info.resource_type === "video") uploadedAudioUrl = result.info.secure_url;
        else if (result.info.resource_type === "image") uploadedCoverUrl = result.info.secure_url;
    }

    if (!error && result && result.event === "close") {
        if (uploadedAudioUrl) saveTrackToDatabase();
        else uploadedCoverUrl = ""; 
    }
});

document.getElementById('upload-track-btn').addEventListener('click', (e) => {
    e.preventDefault();
    requireAuth(() => cloudinaryWidget.open());
});

async function saveTrackToDatabase() {
    const trackTitle = prompt("Enter Track Title:", "New Track");
    const artistName = prompt("Enter Artist Name:", auth.currentUser.displayName || "Unknown Artist");

    if (!trackTitle) return alert("Upload cancelled: A title is required.");

    try {
        await db.collection('songs').add({
            title: trackTitle, artist: artistName, url: uploadedAudioUrl, coverArt: uploadedCoverUrl || "", 
            uploadedBy: auth.currentUser.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        alert("Track successfully added to HalalTune!");
        uploadedAudioUrl = ""; uploadedCoverUrl = "";
        fetchAllTracks(); // Refresh data
    } catch (error) {
        console.error(error); alert("Failed to save track.");
    }
}

// ==========================================
// 6. FETCH LOGIC & AUDIO PLAYBACK
// ==========================================
window.addEventListener('load', () => fetchAllTracks());

async function fetchAllTracks() {
    if(viewContainer) viewContainer.innerHTML = '<p style="text-align: center;">Loading library...</p>'; 
    try {
        const snapshot = await db.collection('songs').orderBy('createdAt', 'desc').get();
        allTracks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // Ensure we only render home if a specific view isn't already active
        const activeNav = document.querySelector('.nav-item.active');
        if(activeNav) renderView(activeNav.getAttribute('data-view'));
        else renderView('home');

    } catch (error) { 
        console.error(error);
        if(viewContainer) viewContainer.innerHTML = '<p style="color: red; text-align: center;">Error loading tracks.</p>'; 
    }
}

const audio = document.getElementById('audio-element');
function playTrack(track) {
    currentPlayingTrackId = track.id;
    document.getElementById('player-title').innerText = track.title;
    document.getElementById('player-artist').innerText = track.artist;
    document.getElementById('fs-player-title').innerText = track.title;
    document.getElementById('fs-player-artist').innerText = track.artist;
    
    const artHtml = track.coverArt ? `<img src="${track.coverArt}">` : `<i class="fa-solid fa-music"></i>`;
    document.getElementById('player-art').innerHTML = artHtml;
    document.getElementById('fs-player-art').innerHTML = artHtml;

    updateGlobalLikeButtons();

    audio.src = track.url;
    audio.play();
    setPlayState(true);
    gsap.fromTo('#player-art, #fs-player-art', { scale: 0.8 }, { scale: 1, duration: 0.5, ease: "back.out(1.7)" });
}

const playBtns = [document.getElementById('play-btn'), document.getElementById('fs-play-btn')];
function setPlayState(isPlaying) {
    playBtns.forEach(btn => {
        const icon = btn.querySelector('i');
        if(isPlaying) icon.classList.replace('fa-circle-play', 'fa-circle-pause');
        else icon.classList.replace('fa-circle-pause', 'fa-circle-play');
    });
}

playBtns.forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if(!audio.src) return;
    if(audio.paused) { audio.play(); setPlayState(true); } else { audio.pause(); setPlayState(false); }
}));

audio.addEventListener('timeupdate', () => {
    if (audio.duration) {
        const percent = (audio.currentTime / audio.duration) * 100;
        document.getElementById('progress-bar').value = percent;
        document.getElementById('fs-progress-bar').value = percent;
        
        let cMins = Math.floor(audio.currentTime / 60);
        let cSecs = Math.floor(audio.currentTime % 60).toString().padStart(2, '0');
        document.getElementById('fs-current-time').innerText = `${cMins}:${cSecs}`;
        
        let tMins = Math.floor(audio.duration / 60);
        let tSecs = Math.floor(audio.duration % 60).toString().padStart(2, '0');
        document.getElementById('fs-total-time').innerText = `${tMins}:${tSecs}`;
    }
});

document.getElementById('progress-bar').addEventListener('input', e => audio.currentTime = (e.target.value / 100) * audio.duration);
document.getElementById('fs-progress-bar').addEventListener('input', e => audio.currentTime = (e.target.value / 100) * audio.duration);

audio.addEventListener('ended', () => {
    setPlayState(false);
    document.getElementById('progress-bar').value = 0; document.getElementById('fs-progress-bar').value = 0;
    document.getElementById('fs-current-time').innerText = "0:00";
});

// Full Screen Sliders
const fsPlayer = document.getElementById('full-screen-player');
document.getElementById('mini-player').addEventListener('click', (e) => {
    if (window.innerWidth <= 768 && !e.target.closest('button') && !e.target.closest('input')) fsPlayer.classList.add('active');
});
document.getElementById('close-fs-btn').addEventListener('click', () => fsPlayer.classList.remove('active'));

document.getElementById('download-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    requireAuth(() => { if(audio.src) window.open(audio.src, '_blank'); });
});

// ==========================================
// 7. THREE.JS ELEGANT BACKGROUND
// ==========================================
const canvas = document.querySelector('#bg-canvas');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
camera.position.z = 30;

const particlesGeometry = new THREE.BufferGeometry();
const posArray = new Float32Array(300 * 3);
for(let i = 0; i < 900; i++) posArray[i] = (Math.random() - 0.5) * 100;

particlesGeometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
const material = new THREE.PointsMaterial({ size: 0.12, color: 0x10b981 });
const particlesMesh = new THREE.Points(particlesGeometry, material);
scene.add(particlesMesh);

function animateBg() {
    requestAnimationFrame(animateBg);
    particlesMesh.rotation.y += 0.001;
    particlesMesh.rotation.x += 0.0005;
    renderer.render(scene, camera);
}
animateBg();
