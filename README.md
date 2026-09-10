# DayToDay - Smart Expense & Budget Tracker

A modern, fast, and feature-rich personal finance web application with offline synchronization, Google Authentication, PIN lock, biometric security, voice assistant, and analytics.

---

## Features
- **Offline First**: All expenses and wallet calculations work 100% offline with zero lag.
- **Biometric & PIN Security**: Quick fingerprint / WebAuthn biometric unlock or 4-digit security PIN.
- **Smart Voice Assistant**: Voice logging and financial balance queries.
- **Budget & Monthly Goals**: Set spending limits and track monthly progress.
- **Cloud Sync**: Seamless background synchronization with Firebase Firestore.
- **Export & Backup**: Export transactions to CSV/Excel and back up data directly to Google Drive.

---

## Quick Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
   cd YOUR_REPO_NAME
   ```

2. **Configure Credentials**:
   - Copy the example config file:
     ```bash
     cp config.example.js config.js
     ```
   - Open `config.js` and enter your **Firebase configuration** and **Google OAuth Client ID**.

3. **Run Locally**:
   - Open `index.html` directly in any modern browser, or run a local HTTP server:
     ```bash
     npx serve .
     # OR with Python:
     python -m http.server 3000
     ```
   - Navigate to `http://localhost:3000/`.

---

## Security
- `config.js` is included in `.gitignore` by default to prevent private API keys and tokens from being committed.
- Configure Firestore security rules using the provided [`firestore.rules`](./firestore.rules) file in Firebase Console.
