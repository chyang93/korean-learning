import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, 
  collection, 
  addDoc, 
  getDocs, 
  doc, 
  deleteDoc // 1. 這裡要 import
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBz8pd1IRiU09U-XAm2VEMc1IKuExRh-Ek",
  authDomain: "korean-learning-fcab2.firebaseapp.com",
  databaseURL: "https://korean-learning-fcab2-default-rtdb.firebaseio.com",
  projectId: "korean-learning-fcab2",
  storageBucket: "korean-learning-fcab2.firebasestorage.app",
  messagingSenderId: "266796944546",
  appId: "1:266796944546:web:4f8e538cc07173f7f31bfb",
  measurementId: "G-5LFGG3N8EJ"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

// 匯出登入/登出與 Firestore 操作函式
export { db, collection, addDoc, getDocs,signInWithPopup, onAuthStateChanged, signOut, doc, setDoc, getDoc, deleteDoc };
