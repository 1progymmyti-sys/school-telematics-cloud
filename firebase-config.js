// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, onSnapshot, query, orderBy, limit, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage, ref, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyDP79ROPAP81q_0KlIfrQLXbc7d35n7jXg",
    authDomain: "school-telematics.firebaseapp.com",
    projectId: "school-telematics",
    storageBucket: "school-telematics.firebasestorage.app",
    messagingSenderId: "471189703911",
    appId: "1:471189703911:web:517148d693f1f0ff622642"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

// Export useful functions
export { db, storage, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, onSnapshot, query, orderBy, limit, ref, uploadString, getDownloadURL, setDoc };
