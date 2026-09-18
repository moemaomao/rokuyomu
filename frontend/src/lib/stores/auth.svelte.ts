import { browser } from '$app/environment';
import {
	onAuthStateChanged,
	signInWithEmailAndPassword,
	createUserWithEmailAndPassword,
	signInWithPopup,
	GoogleAuthProvider,
	GithubAuthProvider,
	signOut,
	type User
} from 'firebase/auth';
import { auth } from '$lib/firebase';

let user = $state<User | null>(null);
let loading = $state(true);
let error = $state<string | null>(null);

if (browser && auth) {
	onAuthStateChanged(auth, (u) => {
		user = u;
		loading = false;
	});
}

export function getUser() {
	return user;
}

export function isLoading() {
	return loading;
}

export function getAuthError() {
	return error;
}

export function clearAuthError() {
	error = null;
}

export async function loginWithEmail(email: string, password: string) {
	if (!auth) return;
	error = null;
	try {
		await signInWithEmailAndPassword(auth, email, password);
	} catch (e: any) {
		error = e.message || 'Login gagal';
		throw e;
	}
}

export async function registerWithEmail(email: string, password: string) {
	if (!auth) return;
	error = null;
	try {
		await createUserWithEmailAndPassword(auth, email, password);
	} catch (e: any) {
		error = e.message || 'Register gagal';
		throw e;
	}
}

export async function loginWithGoogle() {
	if (!auth) return;
	error = null;
	try {
		const provider = new GoogleAuthProvider();
		await signInWithPopup(auth, provider);
	} catch (e: any) {
		error = e.message || 'Login Google gagal';
		throw e;
	}
}

export async function loginWithGithub() {
	if (!auth) return;
	error = null;
	try {
		const provider = new GithubAuthProvider();
		await signInWithPopup(auth, provider);
	} catch (e: any) {
		error = e.message || 'Login GitHub gagal';
		throw e;
	}
}

export async function logout() {
	if (!auth) return;
	await signOut(auth);
}