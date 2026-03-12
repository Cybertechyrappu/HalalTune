// ==========================================
// 1. FIREBASE INITIALIZATION & AUTH STATE
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

// Global Auth Checker Wrapper
function requireAuth(actionCallback) {
    if (auth.currentUser) {
        actionCallback();
    } else {
        document.getElementById('auth-modal').classList.add('active');
    }
}

// ==========================================
// 2. MODAL & SIDEBAR UI LOGIC
// ==========================================
const menuBtn = document.getElementById('menu-btn');
const closeSidebarBtn = document.getElementById('close-menu-btn');
const sidebar = document.getElementById('sidebar');
const mobileOverlay = document.getElementById('mobile-overlay');

function toggleSidebar() {
    sidebar.classList.toggle('open');
    mobileOverlay.classList.toggle('active');
}
if (menuBtn) menuBtn.addEventListener('click', toggleSidebar);
if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', toggleSidebar);
if (mobileOverlay) mobileOverlay.addEventListener('click', toggleSidebar);

const profileTrigger = document.getElementById('profile-trigger');
const authModal = document.getElementById('auth-modal');
const closeModalBtn = document.getElementById('close-modal-btn');
const loginState = document.getElementById('login-state');
const profileState = document.getElementById('profile-state');
const topBarAvatar = document.getElementById('top-bar-avatar');

profileTrigger.addEventListener('click', () => authModal.classList.add('active'));
closeModalBtn.addEventListener('click', () => authModal.classList.remove('active'));
authModal.addEventListener('click', (e) => {
    if(e.target === authModal) authModal.classList.remove('active');
});

// Protect Like/Download buttons behind auth
document.querySelectorAll('.auth-action, .auth-required').forEach(el => {
    el.addEventListener('click', (e) => {
        e.preventDefault(); 
        e.stopPropagation(); 
        requireAuth(() => {
            const icon = el.querySelector('i');
            if(icon && icon.classList.contains('fa-regular')) {
                icon.classList.replace('fa-regular', 'fa-solid');
                icon.style.color = "var(--emerald)";
            } else if (icon && icon.classList.contains('fa-solid') && el.classList.contains('like-btn')) {
                icon.classList.replace('fa-solid', 'fa-regular');
                icon.style.color = "var(--text-muted)";
            }
        });
    });
});

document.getElementById('google-login-btn').addEventListener('click', () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    // Redirects the whole page to Google, which mobile browsers allow
    auth.signInWithRedirect(provider);
});

// Optional but recommended: Catch any errors when the page redirects back
auth.getRedirectResult().catch(err => {
    console.error("Auth Error: ", err);
    alert("Login Error: " + err.message);
});


document.getElementById('logout-btn').addEventListener('click', () => {
    auth.signOut().then(() => authModal.classList.remove('active'));
});

auth.onAuthStateChanged(user => {
    if (user) {
        loginState.style.display = 'none';
        profileState.style.display = 'flex';
        document.getElementById('modal-user-name').innerText = user.displayName || "User";
        document.getElementById('modal-user-email').innerText = user.email;
        if(user.photoURL) {
            document.getElementById('modal-profile-pic').src = user.photoURL;
            topBarAvatar.innerHTML = `<img src="${user.photoURL}" alt="Profile">`;
        }
    } else {
        loginState.style.display = 'flex';
        profileState.style.display = 'none';
        topBarAvatar.innerHTML = `<i class="fa-solid fa-user"></i>`;
    }
});

// ==========================================
// 3. CLOUDINARY UPLOAD WIDGET & FIRESTORE SAVE
// ==========================================
let uploadedAudioUrl = "";
let uploadedCoverUrl = "";

const cloudinaryWidget = cloudinary.createUploadWidget({
    cloudName: 'detke30vn', // Change this
    uploadPreset: 'halaltune_uploads', // Change this
    sources: ['local', 'url'], 
    multiple: true, 
    clientAllowedFormats: ['mp3', 'wav', 'png', 'jpg', 'jpeg'],
    maxFileSize: 50000000, 
    theme: "minimal",
    styles: { palette: { window: "#181818", sourceBg: "#0a0a0a", windowBorder: "#10b981", tabIcon: "#ffffff", action: "#10b981", inProgress: "#fbbf24", complete: "#10b981", textDark: "#000000", textLight: "#ffffff" } }
}, async (error, result) => {
    if (!error && result && result.event === "success") {
        if (result.info.resource_type === "video") { // Cloudinary puts audio under video
            uploadedAudioUrl = result.info.secure_url;
        } else if (result.info.resource_type === "image") {
            uploadedCoverUrl = result.info.secure_url;
        }
    }

    if (!error && result && result.event === "close") {
        if (uploadedAudioUrl) {
            saveTrackToDatabase();
        } else {
            uploadedCoverUrl = ""; 
        }
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
            title: trackTitle,
            artist: artistName,
            url: uploadedAudioUrl,
            coverArt: uploadedCoverUrl || "", 
            uploadedBy: auth.currentUser.uid,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        alert("Track successfully added to HalalTune!");
        uploadedAudioUrl = ""; uploadedCoverUrl = "";
        fetchTracks(); 
    } catch (error) {
        console.error("Error saving track to Firestore: ", error);
        alert("Failed to save track details to database.");
    }
}

// ==========================================
// 4. FULL SCREEN PLAYER SLIDE LOGIC
// ==========================================
const miniPlayer = document.getElementById('mini-player');
const fsPlayer = document.getElementById('full-screen-player');
const closeFsBtn = document.getElementById('close-fs-btn');

miniPlayer.addEventListener('click', (e) => {
    if (window.innerWidth <= 768 && !e.target.closest('button') && !e.target.closest('input')) {
        fsPlayer.classList.add('active');
    }
});

closeFsBtn.addEventListener('click', () => fsPlayer.classList.remove('active'));

let touchStartY = 0;
fsPlayer.addEventListener('touchstart', e => touchStartY = e.changedTouches[0].screenY);
fsPlayer.addEventListener('touchend', e => {
    let touchEndY = e.changedTouches[0].screenY;
    if (touchEndY - touchStartY > 100) fsPlayer.classList.remove('active');
});

// ==========================================
// 5. THREE.JS ELEGANT BACKGROUND
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

// ==========================================
// 6. AUDIO PLAYER (REAL FIRESTORE FETCH)
// ==========================================
const audio = document.getElementById('audio-element');
let currentTrackUrl = "";

const playBtnMini = document.getElementById('play-btn');
const playIconMini = playBtnMini.querySelector('i');
const progBarMini = document.getElementById('progress-bar');

const playBtnFs = document.getElementById('fs-play-btn');
const playIconFs = playBtnFs.querySelector('i');
const progBarFs = document.getElementById('fs-progress-bar');
const fsCurrentTime = document.getElementById('fs-current-time');
const fsTotalTime = document.getElementById('fs-total-time');

window.addEventListener('load', () => fetchTracks());

async function fetchTracks() {
    const grid = document.getElementById('track-list');
    grid.innerHTML = '<p style="color: var(--text-muted); grid-column: 1 / -1; text-align: center;">Loading library...</p>'; 

    try {
        const snapshot = await db.collection('songs').orderBy('createdAt', 'desc').get();
        grid.innerHTML = ''; 

        if (snapshot.empty) {
            grid.innerHTML = '<p style="color: var(--text-muted); grid-column: 1 / -1; text-align: center;">No tracks found. Use the Upload button to add some!</p>';
            return;
        }

        let index = 0;
        snapshot.forEach(doc => {
            const track = doc.data();
            const card = document.createElement('div');
            card.className = 'track-card';
            
            const artHtml = track.coverArt 
                ? `<img src="${track.coverArt}" alt="Cover" style="width: 100%; aspect-ratio: 1; border-radius: 6px; object-fit: cover; box-shadow: 0 4px 12px rgba(0,0,0,0.5);">`
                : `<div class="track-image-placeholder"><i class="fa-solid fa-music"></i></div>`;

            card.innerHTML = `
                ${artHtml}
                <div class="track-meta" style="margin-top: 10px;">
                    <h3 style="font-size: 0.9rem; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${track.title}</h3>
                    <p style="font-size: 0.8rem; color: var(--text-muted);">${track.artist}</p>
                </div>
            `;
            
            card.addEventListener('click', () => {
                document.getElementById('player-title').innerText = track.title;
                document.getElementById('player-artist').innerText = track.artist;
                document.getElementById('fs-player-title').innerText = track.title;
                document.getElementById('fs-player-artist').innerText = track.artist;
                
                const artContainers = [document.getElementById('player-art'), document.getElementById('fs-player-art')];
                artContainers.forEach(container => {
                    if(track.coverArt) {
                        container.innerHTML = `<img src="${track.coverArt}">`;
                    } else {
                        container.innerHTML = `<i class="fa-solid fa-music"></i>`;
                    }
                });

                audio.src = track.url;
                currentTrackUrl = track.url;
                audio.play();
                
                setPlayState(true);
                gsap.fromTo('#player-art, #fs-player-art', { scale: 0.8 }, { scale: 1, duration: 0.5, ease: "back.out(1.7)" });
            });

            grid.appendChild(card);
            gsap.from(card, { y: 20, opacity: 0, duration: 0.5, delay: index * 0.1 });
            index++;
        });
    } catch (error) {
        console.error("Error fetching tracks: ", error);
        grid.innerHTML = '<p style="color: #ff4d4d; grid-column: 1 / -1; text-align: center;">Error loading tracks.</p>';
    }
}

function setPlayState(isPlaying) {
    if (isPlaying) {
        playIconMini.classList.replace('fa-circle-play', 'fa-circle-pause');
        playIconFs.classList.replace('fa-circle-play', 'fa-circle-pause');
    } else {
        playIconMini.classList.replace('fa-circle-pause', 'fa-circle-play');
        playIconFs.classList.replace('fa-circle-pause', 'fa-circle-play');
    }
}

function togglePlay(e) {
    e.stopPropagation(); 
    if(!audio.src) return; 
    if (audio.paused) { audio.play(); setPlayState(true); } 
    else { audio.pause(); setPlayState(false); }
}

playBtnMini.addEventListener('click', togglePlay);
playBtnFs.addEventListener('click', togglePlay);

audio.addEventListener('timeupdate', () => {
    if (audio.duration) {
        const percent = (audio.currentTime / audio.duration) * 100;
        progBarMini.value = percent;
        progBarFs.value = percent;
        
        let cMins = Math.floor(audio.currentTime / 60);
        let cSecs = Math.floor(audio.currentTime % 60).toString().padStart(2, '0');
        fsCurrentTime.innerText = `${cMins}:${cSecs}`;
        
        let tMins = Math.floor(audio.duration / 60);
        let tSecs = Math.floor(audio.duration % 60).toString().padStart(2, '0');
        fsTotalTime.innerText = `${tMins}:${tSecs}`;
    }
});

function seekAudio(e) {
    e.stopPropagation();
    if(!audio.src) return;
    audio.currentTime = (e.target.value / 100) * audio.duration;
}

progBarMini.addEventListener('input', seekAudio);
progBarFs.addEventListener('input', seekAudio);

audio.addEventListener('ended', () => {
    setPlayState(false);
    progBarMini.value = 0; progBarFs.value = 0;
    fsCurrentTime.innerText = "0:00";
});
