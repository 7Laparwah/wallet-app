// =============================================================================
// DayToDay App Configuration Template
// =============================================================================
// HOW TO USE:
// 1. Copy this file and rename it to "config.js" in the same directory:
//    cp config.example.js config.js
// 2. Fill in your own Firebase project credentials and Google OAuth client IDs below.
// 3. Keep config.js in your .gitignore so your private keys are NEVER pushed to GitHub.
// =============================================================================

window.APP_CONFIG = {
  // 1. Firebase Configuration (Get from: https://console.firebase.google.com -> Project Settings)
  firebaseConfig: {
    apiKey: "PASTE_YOUR_FIREBASE_API_KEY_HERE",
    authDomain: "your-project-id.firebaseapp.com",
    databaseURL: "https://your-project-id-default-rtdb.firebaseio.com",
    projectId: "your-project-id",
    storageBucket: "your-project-id.appspot.com",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID",
    measurementId: "YOUR_MEASUREMENT_ID"
  },

  // 2. Google OAuth 2.0 Web Client ID (Get from Google Cloud Console -> APIs & Credentials)
  googleClientId: "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com",

  // 3. Google Drive Backup Configuration (Optional)
  googleDriveClientId: "YOUR_GOOGLE_DRIVE_CLIENT_ID.apps.googleusercontent.com",
  googleDriveFolderId: "YOUR_GOOGLE_DRIVE_FOLDER_ID",

  // 4. Allowed login email whitelist (Leave empty [] to allow any authenticated user)
  allowedEmails: [],

  // 5. Default display name for greetings
  defaultUserName: "Friend"
};
