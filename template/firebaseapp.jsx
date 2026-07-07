// initialize and export firebase app

// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
export const firebaseConfig = {
  apiKey: "AIzaSyABniQCelPg-ykVuWncKdvOtgzK15ZIs18",
  authDomain: "lead-dux.firebaseapp.com",
  projectId: "lead-dux",
  storageBucket: "lead-dux.firebasestorage.app",
  messagingSenderId: "19713060365",
  appId: "1:19713060365:web:421ae146cbc86873546f44",
  measurementId: "G-LM1CPP1E3P"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const analytics = getAnalytics(app);