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
let likedSongs = JSON.parse(localStorage.getItem('halaltune_likes')) || [];
const audioPlayer = document.getElementById('main-audio');

// AUTH
auth.onAuthStateChanged(user => {
    if (user) {
        document.getElementById('auth-screen').style.display = 'none';
        document.getElementById('app-layout').style.display = 'flex';
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

// FETCH SONGS
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
    const likedList = document.getElementById('liked-track-list');
    
    mainList.innerHTML = '';
    malList.innerHTML = '';
    likedList.innerHTML = '';

    if (songsToRender.length === 0) {
        mainList.innerHTML = '<p style="color:#aaa;">No tracks found.</p>';
        return;
    }

    let hasLiked = false;

    songsToRender.forEach((song) => {
        // Find index in global allSongs array so playback matches correctly
        const globalIndex = allSongs.findIndex(s => s.id === song.id);
        const art = song.coverArt ? `<img src="${song.coverArt}">` : `<div style="width:100%;height:100%;background:#333;display:flex;align-items:center;justify-content:center;"><i class="fa-solid fa-music"></i></div>`;
        const isLiked = likedSongs.includes(song.id);
        
        const html = `
            <div class="yt-list-item" onclick="playSong(${globalIndex})">
                <div style="display:flex; align-items:center; flex:1;">
                    <div class="yt-list-art-wrapper">${art}</div>
                    <div class="yt-list-meta">
                        <h3>${song.title}</h3>
                        <p>${song.artist}</p>
                    </div>
                </div>
                <button class="yt-icon-btn" onclick="toggleLike(event, '${song.id}')">
                    <i class="${isLiked ? 'fa-solid' : 'fa-regular'} fa-heart" style="color: ${isLiked ? '#4CAF50' : '#aaa'}; font-size: 1rem;"></i>
                </button>
            </div>
        `;
        
        // Populate All Songs
        mainList.innerHTML += html;
        
        // Populate Malayalam
        if (song.isMalayalam) {
            malList.innerHTML += html;
        }

        // Populate Liked Songs
        if (isLiked) {
            likedList.innerHTML += html;
            hasLiked = true;
        }
    });

    if (!hasLiked) likedList.innerHTML = '<p style="color: #aaa;">No liked songs yet.</p>';
}

// LIKES SYSTEM
window.toggleLike = function(event, songId) {
    event.stopPropagation(); // Prevents song from playing when clicking heart
    if (likedSongs.includes(songId)) {
        likedSongs = likedSongs.filter(id => id !== songId);
    } else {
        likedSongs.push(songId);
    }
    localStorage.setItem('halaltune_likes', JSON.stringify(likedSongs));
    
    // Update currently playing UI if it's the active song
    if (currentSongIndex > -1 && allSongs[currentSongIndex].id === songId) {
        updateLikeBtnUI(songId);
    }
    renderLists(allSongs); // Refresh lists
}

function updateLikeBtnUI(songId) {
    const fsLikeBtn = document.getElementById('fs-like-btn');
    if (likedSongs.includes(songId)) {
        fsLikeBtn.classList.add('liked');
        fsLikeBtn.innerHTML = '<i class="fa-solid fa-heart"></i>';
    } else {
        fsLikeBtn.classList.remove('liked');
        fsLikeBtn.innerHTML = '<i class="fa-regular fa-heart"></i>';
    }
}

document.getElementById('fs-like-btn').addEventListener('click', () => {
    if (currentSongIndex > -1) {
        toggleLike(new Event('click'), allSongs[currentSongIndex].id);
    }
});

// SEARCH
document.getElementById('glass-search').addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = allSongs.filter(s => s.title.toLowerCase().includes(term) || s.artist.toLowerCase().includes(term));
    renderLists(filtered);
});

// AUDIO PLAYER LOGIC
window.playSong = function(index) {
    currentSongIndex = index;
    const song = allSongs[index];
    
    // Mini Player UI
    document.getElementById('mini-player-title').innerText = song.title;
    document.getElementById('mini-player-artist').innerText = song.artist;
    const miniArt = document.getElementById('mini-player-art');
    
    // FS Player UI
    document.getElementById('fs-title').innerText = song.title;
    document.getElementById('fs-artist').innerText = song.artist;
    const fsArt = document.getElementById('fs-art');
    const fsPlaceholder = document.getElementById('fs-placeholder');

    if (song.coverArt) {
        miniArt.src = song.coverArt; miniArt.style.display = 'block';
        fsArt.src = song.coverArt; fsArt.style.display = 'block';
        fsPlaceholder.style.display = 'none';
    } else {
        miniArt.style.display = 'none';
        fsArt.style.display = 'none';
        fsPlaceholder.style.display = 'block';
    }

    updateLikeBtnUI(song.id);

    audioPlayer.src = song.url;
    audioPlayer.play();
    updatePlayPauseIcons(true);
}

function updatePlayPauseIcons(isPlaying) {
    const icon = isPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
    const fsIcon = isPlaying ? '<i class="fa-solid fa-circle-pause"></i>' : '<i class="fa-solid fa-circle-play"></i>';
    document.getElementById('mini-play-pause-btn').innerHTML = icon;
    document.getElementById('fs-play-pause-btn').innerHTML = fsIcon;
}

function togglePlayPause() {
    if (audioPlayer.paused) {
        audioPlayer.play();
        updatePlayPauseIcons(true);
    } else {
        audioPlayer.pause();
        updatePlayPauseIcons(false);
    }
}

document.getElementById('mini-play-pause-btn').addEventListener('click', (e) => { e.stopPropagation(); togglePlayPause(); });
document.getElementById('fs-play-pause-btn').addEventListener('click', togglePlayPause);

function formatTime(seconds) {
    if (isNaN(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

audioPlayer.addEventListener('timeupdate', () => {
    if (audioPlayer.duration) {
        const progress = (audioPlayer.currentTime / audioPlayer.duration) * 100;
        document.getElementById('mini-progress').value = progress;
        document.getElementById('fs-progress').value = progress;
        document.getElementById('fs-time-current').innerText = formatTime(audioPlayer.currentTime);
        document.getElementById('fs-time-total').innerText = formatTime(audioPlayer.duration);
    }
});

function handleSeek(e) {
    const seekTo = audioPlayer.duration * (e.target.value / 100);
    audioPlayer.currentTime = seekTo;
}
document.getElementById('mini-progress').addEventListener('input', handleSeek);
document.getElementById('fs-progress').addEventListener('input', handleSeek);
// Prevent seeking from triggering fullscreen popup
document.getElementById('mini-progress').addEventListener('click', (e) => e.stopPropagation()); 

function nextSong(e) { if(e) e.stopPropagation(); if (currentSongIndex < allSongs.length - 1) playSong(currentSongIndex + 1); }
function prevSong(e) { if(e) e.stopPropagation(); if (currentSongIndex > 0) playSong(currentSongIndex - 1); }

document.getElementById('mini-next-btn').addEventListener('click', nextSong);
document.getElementById('fs-next-btn').addEventListener('click', nextSong);
document.getElementById('mini-prev-btn').addEventListener('click', prevSong);
document.getElementById('fs-prev-btn').addEventListener('click', prevSong);

// MAXIMIZE PLAYER LOGIC (Swipe Up / Click)
document.getElementById('mini-player-info').addEventListener('click', () => {
    if(currentSongIndex > -1) document.getElementById('fs-player').classList.add('active');
});
document.getElementById('close-fs-btn').addEventListener('click', () => {
    document.getElementById('fs-player').classList.remove('active');
});
