// js/firebase-config.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getFirestore, 
  collection, 
  addDoc, 
  getDocs, 
  doc, 
  deleteDoc,
  getDoc,
  setDoc 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

import { 
  getAuth, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signInWithPopup, 
  signOut 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
  // 🔴 請確保這裡貼上的是你專案的正確配置
  apiKey: "你的API_KEY",
  authDomain: "你的AUTH_DOMAIN",
  projectId: "你的PROJECT_ID",
  storageBucket: "你的STORAGE_BUCKET",
  messagingSenderId: "你的MESSAGING_SENDER_ID",
  appId: "你的APP_ID"
};

// 初始化：這裡只用 const 宣告，不要加上 export 關鍵字
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// 🟢 唯一導出區塊：每個名稱只會在這裡出現一次
export { 
  auth, 
  db, 
  googleProvider, 
  onAuthStateChanged, 
  signInWithPopup,
  signOut,
  collection, 
  addDoc, 
  getDocs, 
  doc, 
  deleteDoc, 
  getDoc, 
  setDoc 
};