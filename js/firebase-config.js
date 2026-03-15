// js/firebase-config.js

// 1. 引入 Firebase 核心
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";

// 2. 引入 Firestore 模組
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

// 3. 引入 Auth 模組與所有必要工具
import { 
  getAuth, 
  GoogleAuthProvider, 
  onAuthStateChanged, // 👈 關鍵：監聽登入狀態
  signInWithPopup,    // 彈窗登入
  signOut             // 登出
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// 4. Firebase 配置 (請確認這裡的值是你專案專用的)
const firebaseConfig = {
  apiKey: "你的API_KEY",
  authDomain: "你的AUTH_DOMAIN",
  projectId: "你的PROJECT_ID",
  storageBucket: "你的STORAGE_BUCKET",
  messagingSenderId: "你的MESSAGING_SENDER_ID",
  appId: "你的APP_ID"
};

// 5. 初始化
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// 🟢 6. 統一匯出 (確保清單內每個名稱都與 main.js 對應)
export { 
  auth, 
  db, 
  googleProvider, 
  onAuthStateChanged, // 👈 匯出給 main.js 使用
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