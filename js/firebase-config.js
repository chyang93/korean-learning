// js/firebase-config.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  get,
  onValue
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBz8pd1IRiU09U-XAm2VEMc1IKuExRh-Ek", // 🟢 你的正確密鑰
  authDomain: "korean-learning-fcab2.firebaseapp.com", // 🟢 修正後的網域
  databaseURL: "https://korean-learning-fcab2-default-rtdb.firebaseio.com",
  projectId: "korean-learning-fcab2",
  storageBucket: "korean-learning-fcab2.firebasestorage.app",
  messagingSenderId: "266796944546",
  appId: "1:266796944546:web:4f8e538cc07173f7f31bfb",
  measurementId: "G-5LFGG3N8EJ"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const rtdb = getDatabase(app);
const googleProvider = new GoogleAuthProvider();

export { 
  auth, 
  rtdb,
  googleProvider, 
  onAuthStateChanged, 
  signInWithPopup,
  signOut,
  ref,
  set,
  get,
  onValue
};