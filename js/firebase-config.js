const firebaseConfig = {
  apiKey:            "AIzaSyDr9jBIz1j9JPGclgue3sqak7r3CBEsnFU",
  authDomain:        "paired-a18ad.firebaseapp.com",
  databaseURL:       "https://paired-a18ad-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "paired-a18ad",
  storageBucket:     "paired-a18ad.firebasestorage.app",
  messagingSenderId: "626941116718",
  appId:             "1:626941116718:web:057a6eed212d3f1d753abf"
};

firebase.initializeApp(firebaseConfig);
const db   = firebase.database();
const auth = firebase.auth();
const authReady = new Promise((resolve, reject) => {
  const unsub = auth.onAuthStateChanged(user => {
    if (user) { unsub(); resolve(user); }
    else { auth.signInAnonymously().catch(reject); }
  }, reject);
});
