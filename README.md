# 🎰 Roulette Admin Panel — v2.0

**Self-contained admin web app** for the Roulette Predictor system. Deploy this independently from the User app.

## 📁 Files

```
roulette-admin/
├── index.html             ← Main UI
├── styles.css             ← Dark neon theme
├── app.js                 ← All admin logic
├── firebase-config.js     ← Firebase wiring (no shared deps)
├── prediction-engine.js   ← AI engine (for the Test tab)
├── manifest.json          ← PWA manifest
└── README.md              ← This file
```

---

## 🚀 Quick Start

### 1. Configure Firebase (one-time)

In your **Firebase Console → slice-investment** project:

**Realtime Database → Rules:**
```json
{
  "rules": {
    ".read": "auth != null",
    ".write": "auth != null"
  }
}
```

**Authentication → Sign-in method →** enable **Email/Password**.

### 2. Host the folder

Pick any:
- **Firebase Hosting** (recommended): `firebase deploy`
- **Netlify / Vercel**: drag-drop the folder
- **GitHub Pages**: push & enable Pages
- **Local test**: `python3 -m http.server 8000` in this folder

### 3. First admin account

Open `index.html` → **Create Admin Account** with your email/password (6+ chars).

---

## ✨ What's New in v2.0

| Feature | Description |
|---|---|
| 🏠 **Overview Dashboard** | One-glance view: training spins, sessions, users, predictions, accuracy, today's activity |
| 💡 **Health Check** | Auto-detects issues (no data, low data, etc.) and warns you |
| 🔢 **Number Pad Upload** | Tap roulette numbers directly — auto-derives E/O & R/B |
| 🎲 **Multi-Table Tagging** | Tag every session/spin with a table identifier |
| 📝 **Session Notes** | Add free-form notes to any session |
| 🧠 **Test AI Tab** | Try the prediction engine yourself before users see it |
| 💾 **Backup & Restore** | Download the entire database; restore from JSON |
| ☠ **Wipe Confirmation** | Type-to-confirm prevents accidental data loss |
| 📊 **Number Frequency Chart** | Visualize 0–36 distribution |
| 📈 **Better Stats** | Separates E/O count from R/B count (no more fake data) |
| 🔍 **Search + Sort** | Filter sessions and users by multiple criteria |
| ↻ **Bulk Upload Progress** | Real-time progress bar for big imports |
| 🔧 **Fixed Paste Mode** | No longer fakes random colors when only E/O is given |
| 📱 **PWA Installable** | Add to home-screen on mobile |
| 🛡 **Better Errors** | Friendly messages for auth/network failures |
| ⌨ **Keyboard Shortcuts** | E/O/R/B in Test tab + Esc to close |

---

## 🗄 Firebase Data Schema

```
slice-investment-default-rtdb/
├── admins/{uid}                        ← admin accounts
├── users/{uid}                         ← end-user profiles
├── sessions/{sessionId}                ← uploaded data batches
│   └── { label, table, notes, count, data, uploadedBy, uploadedAt }
├── history/{entryId}                   ← flat per-spin index
│   └── { even_odd, color, number, timestamp, sessionId, table }
├── live_spins/{spinId}                 ← real-time admin entries
└── userPredictions/{uid}/{predId}      ← user prediction logs
```

---

## 🧠 The 5-Model AI Engine

| Model | What it does |
|---|---|
| **Markov Chain** (order 1–4) | Looks at recent context, finds historical "after this, came that" |
| **Pattern Match** | Searches the entire training set for the user's exact recent sub-sequence |
| **Streak Analyzer** | Detects current streak; estimates probability it breaks |
| **Bayesian** | Recency-weighted base rates with regression-to-mean correction |
| **Cyclic Detector** | Tests cycle lengths 2–12; predicts based on phase if pattern detected |

Outputs are weighted-averaged into a final ensemble probability. The engine adapts weights based on past accuracy.

---

## ⌨ Keyboard Shortcuts (Test AI tab)

| Key | Action |
|---|---|
| `E` `O` | Add Even / Odd |
| `R` `B` | Add Red / Black |
| `Backspace` | Undo |
| `Enter` | Run prediction |
| `Esc` | Close modal |

---

## ⚠ Disclaimer

European roulette has a built-in 2.7% house edge. **No prediction system can overcome true randomness.** This tool is for pattern study & entertainment, not guaranteed profit. Use responsibly.
