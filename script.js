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

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let allSongs = [];
let currentSongIndex = -1;
const audioPlayer = document.getElementById('main-audio');

// ==========================================
// 2. AUTHENTICATION
// ==========================================
auth.onAuthStateChanged(user => {
    if (user) {
        document.getElementById('auth-screen').style.display = 'none';
        document.getElementById('app-layout').style.display = 'flex';
        
        // Save user to DB so Admin sees them
        db.collection('users').doc(user.uid).set({
            name: user.displayName,
            email: user.email,
            lastLogin: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        fetchSongs();
    } else {
        document.getElementById('auth-screen').style.display = 'flex';
        document.getElementById('app-layout').style.display = 'none';
    }
});

document.getElementById('google-login-btn').addEventListener('click', () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider);
});

document.getElementById('logout-btn').addEventListener('click', () => auth.signOut());

// ==========================================
// 3. FETCH & DISPLAY SONGS
// ==========================================
function fetchSongs() {
    db.collection('songs').orderBy('createdAt', 'desc').onSnapshot(snapshot => {
        allSongs = [];
        snapshot.forEach(doc => allSongs.push({ id: doc.id, ...doc.data() }));
        renderLists(allSongs);
    });
}

function renderLists(songsToRender) {
    const mainList = document.getElementById('main-track-list');
    const malList = document.getElementById('malayalam-track-list');
    
    mainList.innerHTML = '';
    malList.innerHTML = '';

    if (songsToRender.length === 0) {
        mainList.innerHTML = '<p style="color:#aaa;">No tracks found.</p>';
        return;
    }

    songsToRender.forEach((song, index) => {
        const art = song.coverArt ? `<img src="${song.coverArt}">` : `<div style="width:100%;height:100%;background:#333;display:flex;align-items:center;justify-content:center;"><i class="fa-solid fa-music"></i></div>`;
        const html = `
            <div class="yt-list-item" onclick="playSong(${index})">
                <div class="yt-list-art-wrapper">${art}</div>
                <div class="yt-list-meta">
                    <h3>${song.title}</h3>
                    <p>${song.artist}</p>
                </div>
            </div>
        `;
        
        // Put in Malayalam list if tagged, otherwise put in main list
        if (song.isMalayalam) {
            malList.innerHTML += html;
        } else {
            mainList.innerHTML += html;
        }
    });
}

// ==========================================
// 4. GLASS SEARCH LOGIC
// ==========================================
document.getElementById('glass-search').addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = allSongs.filter(s => 
        s.title.toLowerCase().includes(term) || 
        s.artist.toLowerCase().includes(term)
    );
    renderLists(filtered);
});

// ==========================================
// 5. AUDIO PLAYER
// ==========================================
window.playSong = function(index) {
    currentSongIndex = index;
    const song = allSongs[index];
    
    document.getElementById('player-title').innerText = song.title;
    document.getElementById('player-artist').innerText = song.artist;
    
    const artImg = document.getElementById('player-art');
    if (song.coverArt) {
        artImg.src = song.coverArt;
        artImg.style.display = 'block';
    } else {
        artImg.style.display = 'none';
    }

    audioPlayer.src = song.url;
    audioPlayer.play();
    document.getElementById('play-pause-btn').innerHTML = '<i class="fa-solid fa-pause"></i>';
}

document.getElementById('play-pause-btn').addEventListener('click', () => {
    if (audioPlayer.paused) {
        audioPlayer.play();
        document.getElementById('play-pause-btn').innerHTML = '<i class="fa-solid fa-pause"></i>';
    } else {
        audioPlayer.pause();
        document.getElementById('play-pause-btn').innerHTML = '<i class="fa-solid fa-play"></i>';
    }
});

audioPlayer.addEventListener('timeupdate', () => {
    if (audioPlayer.duration) {
        const progress = (audioPlayer.currentTime / audioPlayer.duration) * 100;
        document.getElementById('audio-progress').value = progress;
    }
});

document.getElementById('audio-progress').addEventListener('input', (e) => {
    const seekTo = audioPlayer.duration * (e.target.value / 100);
    audioPlayer.currentTime = seekTo;
});

// Next / Prev 
document.getElementById('next-btn').addEventListener('click', () => {
    if (currentSongIndex < allSongs.length - 1) playSong(currentSongIndex + 1);
});
document.getElementById('prev-btn').addEventListener('click', () => {
    if (currentSongIndex > 0) playSong(currentSongIndex - 1);
});
