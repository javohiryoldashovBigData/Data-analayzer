  import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
  import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
  import { getFirestore, doc, setDoc, getDoc, addDoc, deleteDoc, collection, query, where, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

  const firebaseConfig = {
    apiKey: "AIzaSyDDl82Dyn6ixDIC0rwbkJykJ8toeab6lkI",
    authDomain: "data-analayzer.firebaseapp.com",
    projectId: "data-analayzer",
    storageBucket: "data-analayzer.firebasestorage.app",
    messagingSenderId: "577704444860",
    appId: "1:577704444860:web:6881cbd1d5cefbeb5421b9",
    measurementId: "G-KPG76GVFN6"
  };

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  window.daFirebase = { auth, db, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, doc, setDoc, getDoc, addDoc, deleteDoc, collection, query, where, orderBy, limit, getDocs };

  onAuthStateChanged(auth, (user)=>{
    if(window.daOnAuthChange) window.daOnAuthChange(user);
  });
