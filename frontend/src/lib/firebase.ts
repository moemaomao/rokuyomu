// src/lib/firebase.ts
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { browser } from '$app/environment';

const firebaseConfig = {
	apiKey: 'AIzaSyBWJ5WupXpwu-EekGCk1V56oT4aLaqLZuE',
	authDomain: 'rokuyomu-source-base.firebaseapp.com',
	projectId: 'rokuyomu-source-base',
	storageBucket: 'rokuyomu-source-base.firebasestorage.app',
	messagingSenderId: '268027896161',
	appId: '1:268027896161:web:925f90f775776435e02520',
	measurementId: 'G-3TCEMKTQRD'
};

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;

if (browser) {
	app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
	auth = getAuth(app);
	db = getFirestore(app);
}

export { app, auth, db };