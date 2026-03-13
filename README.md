<div align="center">
  <img src="icon.png" alt="HalalTune Logo" width="120" style="filter: brightness(0) invert(1);">
  
  <h1>HalalTune 🎧</h1>
  <p><em>Premium Spiritual Audio, curated for your soul.</em></p>

  <img src="https://img.shields.io/badge/Frontend-HTML%20%7C%20CSS%20%7C%20JS-black?style=for-the-badge" alt="Frontend">
  <img src="https://img.shields.io/badge/Backend-Firebase-FFCA28?style=for-the-badge&logo=firebase&logoColor=black" alt="Firebase">
  <img src="https://img.shields.io/badge/Storage-Cloudinary-3448C5?style=for-the-badge&logo=cloudinary&logoColor=white" alt="Cloudinary">
  <img src="https://img.shields.io/badge/Platform-PWA%20%7C%20Android-4CAF50?style=for-the-badge&logo=android&logoColor=white" alt="PWA">
</div>

---

## 📖 About The Project

**HalalTune** is a beautifully designed, distraction-free Progressive Web App (PWA) dedicated to streaming pure, vocal-only Islamic audio and nasheeds. 

Built with a premium **Pitch Black Monochrome (OLED-friendly)** aesthetic inspired by top-tier native music apps, it features a fluid, responsive UI that adapts flawlessly from desktop monitors to mobile screens. Behind the scenes, it utilizes a serverless Firebase architecture with a custom automated media pipeline.

## ✨ Key Features

### 🎧 Client App (For Listeners)
* **Seamless Authentication:** Frictionless Phone Number & OTP login via Firebase Auth.
* **Premium UI/UX:** Liquid glass UI components, native-feeling swipe gestures, and a persistent floating mini-player.
* **Dynamic Playback Engine:** * "Up Next" queue management with Shuffle and Repeat states.
  * Real-time automated **Lyrics Integration** (via LRCLIB API).
  * Algorithmic **"Related Tracks"** suggestion engine.
* **Personalized Library:** Save and manage "Liked Songs" instantly synchronized to the cloud.
* **Track Actions:** Slide-up 3-dot menu for downloading and native mobile link sharing.

### ⚙️ Admin Dashboard (For Creators)
* **Secure Access:** Hidden login portal protected by Firebase Email/Password authentication.
* **Smart Upload Pipeline:** * Automated **ID3 Metadata Extraction** (reads Title, Artist, and Cover Art directly from `.mp3`, `.m4a`, `.alac`, `.flac` files).
  * Dual-upload system automatically beams audio and Base64-extracted imagery to **Cloudinary**.
* **Live Analytics:** Real-time Firestore aggregation tracking Total Streams, Unique Listeners, Total Downloads, and Global Likes.
* **Database Management:** Instantly delete tracks or monitor live listener counts ticking up in real-time.

---

## 🛠️ Tech Stack & Architecture

* **Frontend:** Vanilla HTML5, CSS3 (Flexbox/Grid, Custom CSS Variables), Vanilla JavaScript (ES6+).
* **Animations:** GSAP (GreenSock Animation Platform) for buttery-smooth view transitions.
* **Backend & Database:** Firebase Firestore (NoSQL real-time listeners).
* **Authentication:** Firebase Auth (Phone/OTP for clients, Email/Password for Admin).
* **Media Storage & CDN:** Cloudinary REST API.
* **Utilities:** `jsmediatags` for binary audio metadata parsing.

---

## 📸 Screenshots
*(Note: Add your actual screenshots to a `/docs` folder and update these paths!)*

| Mobile Home | Full-Screen Player | Admin Dashboard |
|:---:|:---:|:---:|
| <img src="https://via.placeholder.com/250x500/000000/ffffff?text=Mobile+Home" width="250"> | <img src="https://via.placeholder.com/250x500/000000/ffffff?text=Max+Player" width="250"> | <img src="https://via.placeholder.com/250x500/121212/ffffff?text=Admin+Panel" width="250"> |

---

## 🚀 Getting Started

To run this project locally or deploy it yourself, follow these steps:

### 1. Clone the Repository
```bash
git clone [https://github.com/yourusername/halaltune.git](https://github.com/yourusername/halaltune.git)
cd halaltune
