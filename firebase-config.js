// ============================================================================
// FIREBASE CONFIGURATION — ADMIN APP (self-contained, no shared folder)
// ============================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, set, push, get, onValue, update, remove, child, query, orderByChild, limitToLast } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDAisnBAmG3qGyjA_lkzSDrWccNxyr2jMc",
  authDomain: "slice-investment.firebaseapp.com",
  databaseURL: "https://slice-investment-default-rtdb.firebaseio.com",
  projectId: "slice-investment",
  storageBucket: "slice-investment.firebasestorage.app",
  messagingSenderId: "263752083276",
  appId: "1:263752083276:web:03b4f22872ccec55c3d1e9",
  measurementId: "G-4J9033N8WS"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

export {
  app, db, auth,
  ref, set, push, get, onValue, update, remove, child, query, orderByChild, limitToLast,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail
};
