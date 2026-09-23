/**
 * Forum store — Firestore-backed community forum for Rokuyomu.
 * Collections: forumCategories, forumThreads, forumPosts, communityChat
 */
import { browser } from '$app/environment';
import {
	collection,
	doc,
	getDoc,
	getDocs,
	addDoc,
	updateDoc,
	deleteDoc,
	query,
	where,
	orderBy,
	limit,
	serverTimestamp,
	increment,
	onSnapshot,
	type Timestamp
} from 'firebase/firestore';
import { db } from '$lib/firebase';
import { getUser } from '$lib/stores/auth.svelte';
import { isAdmin } from '$lib/admin';

export type ForumCategory = {
	id: string;
	name: string;
	slug: string;
	description: string;
	order: number;
	threadCount?: number;
};

export type ForumThread = {
	id: string;
	categoryId: string;
	categorySlug: string;
	title: string;
	body: string;
	authorId: string;
	authorName: string;
	authorPhoto?: string;
	mangaRef?: { sourceId: string; mangaId: string; title: string } | null;
	pinned: boolean;
	locked: boolean;
	replyCount: number;
	createdAt: number;
	lastReplyAt: number;
	lastReplyAuthor?: string;
};

export type ForumPost = {
	id: string;
	threadId: string;
	body: string;
	authorId: string;
	authorName: string;
	authorPhoto?: string;
	createdAt: number;
	editedAt?: number;
};

export type ChatMessage = {
	id: string;
	body: string;
	authorId: string;
	authorName: string;
	authorPhoto?: string;
	createdAt: number;
	editedAt?: number;
};

export const DEFAULT_CATEGORIES: Omit<ForumCategory, 'id'>[] = [
	{
		name: 'General',
		slug: 'general',
		description: 'General discussion about manga, manhwa, and the site.',
		order: 1
	},
	{
		name: 'Recommendations',
		slug: 'recommendations',
		description: 'Share and ask for title recommendations.',
		order: 2
	},
	{
		name: 'Chapter Discussion',
		slug: 'chapter-discussion',
		description: 'Talk about specific chapters (use spoiler tags).',
		order: 3
	},
	{
		name: 'Source & Site Issues',
		slug: 'source-issues',
		description: 'Broken sources, missing chapters, site bugs.',
		order: 4
	},
	{
		name: 'Requests',
		slug: 'requests',
		description: 'Request new sources or titles.',
		order: 5
	}
];

const CHAT_COL = 'communityChat';
const MAX_CHAT_BODY = 4000;
const MAX_IMAGE_BASE64 = 900_000;

function tsToMs(v: unknown): number {
	if (!v) return Date.now();
	if (typeof v === 'number') return v;
	const t = v as Timestamp;
	if (typeof t.toMillis === 'function') return t.toMillis();
	return Date.now();
}

function displayName(u: { displayName?: string | null; email?: string | null }): string {
	return (u.displayName || u.email?.split('@')[0] || 'User').slice(0, 40);
}

export async function ensureCategories(): Promise<ForumCategory[]> {
	if (!browser || !db) return [];
	const snap = await getDocs(query(collection(db, 'forumCategories'), orderBy('order', 'asc')));
	if (!snap.empty) {
		return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ForumCategory, 'id'>) }));
	}
	const created: ForumCategory[] = [];
	for (const c of DEFAULT_CATEGORIES) {
		const ref = await addDoc(collection(db, 'forumCategories'), { ...c, threadCount: 0 });
		created.push({ id: ref.id, ...c, threadCount: 0 });
	}
	return created;
}

export async function getCategories(): Promise<ForumCategory[]> {
	return ensureCategories();
}

export async function getRecentThreads(max = 20): Promise<ForumThread[]> {
	if (!browser || !db) return [];
	const snap = await getDocs(
		query(collection(db, 'forumThreads'), orderBy('lastReplyAt', 'desc'), limit(max))
	);
	return snap.docs.map(mapThread);
}

export async function getThreadsByCategory(
	categoryId: string,
	max = 50
): Promise<ForumThread[]> {
	if (!browser || !db) return [];
	const snap = await getDocs(
		query(
			collection(db, 'forumThreads'),
			where('categoryId', '==', categoryId),
			orderBy('lastReplyAt', 'desc'),
			limit(max)
		)
	);
	return snap.docs.map(mapThread);
}

function mapThread(d: { id: string; data: () => Record<string, unknown> }): ForumThread {
	const x = d.data();
	return {
		id: d.id,
		categoryId: String(x.categoryId || ''),
		categorySlug: String(x.categorySlug || ''),
		title: String(x.title || ''),
		body: String(x.body || ''),
		authorId: String(x.authorId || ''),
		authorName: String(x.authorName || 'User'),
		authorPhoto: x.authorPhoto ? String(x.authorPhoto) : undefined,
		mangaRef: (x.mangaRef as ForumThread['mangaRef']) || null,
		pinned: Boolean(x.pinned),
		locked: Boolean(x.locked),
		replyCount: Number(x.replyCount) || 0,
		createdAt: tsToMs(x.createdAt),
		lastReplyAt: tsToMs(x.lastReplyAt),
		lastReplyAuthor: x.lastReplyAuthor ? String(x.lastReplyAuthor) : undefined
	};
}

export async function getThread(threadId: string): Promise<ForumThread | null> {
	if (!browser || !db) return null;
	const snap = await getDoc(doc(db, 'forumThreads', threadId));
	if (!snap.exists()) return null;
	return mapThread(snap);
}

export async function getPosts(threadId: string): Promise<ForumPost[]> {
	if (!browser || !db) return [];
	const snap = await getDocs(
		query(
			collection(db, 'forumPosts'),
			where('threadId', '==', threadId),
			orderBy('createdAt', 'asc'),
			limit(200)
		)
	);
	return snap.docs.map((d) => {
		const x = d.data();
		return {
			id: d.id,
			threadId: String(x.threadId || ''),
			body: String(x.body || ''),
			authorId: String(x.authorId || ''),
			authorName: String(x.authorName || 'User'),
			authorPhoto: x.authorPhoto ? String(x.authorPhoto) : undefined,
			createdAt: tsToMs(x.createdAt),
			editedAt: x.editedAt ? tsToMs(x.editedAt) : undefined
		};
	});
}

export async function createThread(input: {
	categoryId: string;
	categorySlug: string;
	title: string;
	body: string;
	mangaRef?: ForumThread['mangaRef'];
}): Promise<string> {
	if (!browser || !db) throw new Error('Not available');
	const user = getUser();
	if (!user) throw new Error('Login required');

	const title = input.title.trim().slice(0, 120);
	const body = input.body.trim().slice(0, 8000);
	if (!title || !body) throw new Error('Title and body are required');

	const now = Date.now();
	const ref = await addDoc(collection(db, 'forumThreads'), {
		categoryId: input.categoryId,
		categorySlug: input.categorySlug,
		title,
		body,
		authorId: user.uid,
		authorName: displayName(user),
		authorPhoto: user.photoURL || '',
		mangaRef: input.mangaRef || null,
		pinned: false,
		locked: false,
		replyCount: 0,
		createdAt: now,
		lastReplyAt: now,
		lastReplyAuthor: displayName(user)
	});

	await addDoc(collection(db, 'forumPosts'), {
		threadId: ref.id,
		body,
		authorId: user.uid,
		authorName: displayName(user),
		authorPhoto: user.photoURL || '',
		createdAt: now,
		isOp: true
	});

	try {
		await updateDoc(doc(db, 'forumCategories', input.categoryId), {
			threadCount: increment(1)
		});
	} catch {
		/* ignore */
	}

	return ref.id;
}

export async function createReply(threadId: string, body: string): Promise<void> {
	if (!browser || !db) throw new Error('Not available');
	const user = getUser();
	if (!user) throw new Error('Login required');

	const text = body.trim().slice(0, 8000);
	if (!text) throw new Error('Reply cannot be empty');

	const thread = await getThread(threadId);
	if (!thread) throw new Error('Thread not found');
	if (thread.locked) throw new Error('Thread is locked');

	const now = Date.now();
	await addDoc(collection(db, 'forumPosts'), {
		threadId,
		body: text,
		authorId: user.uid,
		authorName: displayName(user),
		authorPhoto: user.photoURL || '',
		createdAt: now
	});

	await updateDoc(doc(db, 'forumThreads', threadId), {
		replyCount: increment(1),
		lastReplyAt: now,
		lastReplyAuthor: displayName(user)
	});
}

export async function deleteThread(threadId: string): Promise<void> {
	if (!browser || !db) return;
	const user = getUser();
	if (!user) throw new Error('Login required');

	const thread = await getThread(threadId);
	if (!thread) return;
	if (thread.authorId !== user.uid && !isAdmin(user.uid)) {
		throw new Error('Not allowed');
	}

	const posts = await getPosts(threadId);
	await Promise.all(posts.map((p) => deleteDoc(doc(db!, 'forumPosts', p.id))));
	await deleteDoc(doc(db, 'forumThreads', threadId));

	try {
		await updateDoc(doc(db, 'forumCategories', thread.categoryId), {
			threadCount: increment(-1)
		});
	} catch {
		/* ignore */
	}
}

export async function setThreadPinned(threadId: string, pinned: boolean): Promise<void> {
	const user = getUser();
	if (!user || !isAdmin(user.uid) || !db) throw new Error('Admin only');
	await updateDoc(doc(db, 'forumThreads', threadId), { pinned });
}

export async function setThreadLocked(threadId: string, locked: boolean): Promise<void> {
	const user = getUser();
	if (!user || !isAdmin(user.uid) || !db) throw new Error('Admin only');
	await updateDoc(doc(db, 'forumThreads', threadId), { locked });
}

// ── Community Chat ──────────────────────────────────────────────────────────

export async function getChatMessages(max = 80): Promise<ChatMessage[]> {
	if (!browser || !db) return [];
	const snap = await getDocs(
		query(collection(db, CHAT_COL), orderBy('createdAt', 'desc'), limit(max))
	);
	return snap.docs
		.map((d) => {
			const x = d.data();
			return {
				id: d.id,
				body: String(x.body || ''),
				authorId: String(x.authorId || ''),
				authorName: String(x.authorName || 'User'),
				authorPhoto: x.authorPhoto ? String(x.authorPhoto) : undefined,
				createdAt: tsToMs(x.createdAt),
				editedAt: x.editedAt ? tsToMs(x.editedAt) : undefined
			};
		})
		.reverse();
}

export function subscribeChatMessages(
	cb: (msgs: ChatMessage[]) => void,
	max = 80
): () => void {
	if (!browser || !db) return () => {};
	const q = query(collection(db, CHAT_COL), orderBy('createdAt', 'desc'), limit(max));
	return onSnapshot(q, (snap) => {
		const list = snap.docs
			.map((d) => {
				const x = d.data();
				return {
					id: d.id,
					body: String(x.body || ''),
					authorId: String(x.authorId || ''),
					authorName: String(x.authorName || 'User'),
					authorPhoto: x.authorPhoto ? String(x.authorPhoto) : undefined,
					createdAt: tsToMs(x.createdAt),
					editedAt: x.editedAt ? tsToMs(x.editedAt) : undefined
				};
			})
			.reverse();
		cb(list);
	});
}

export async function sendChatMessage(body: string): Promise<void> {
	if (!browser || !db) throw new Error('Not available');
	const user = getUser();
	if (!user) throw new Error('Login required');

	const text = body.trim().slice(0, MAX_CHAT_BODY);
	if (!text) throw new Error('Message cannot be empty');

	if (text.includes('data:image') && text.length > MAX_IMAGE_BASE64 + 200) {
		throw new Error('Image too large (max ~450KB)');
	}

	await addDoc(collection(db, CHAT_COL), {
		body: text,
		authorId: user.uid,
		authorName: displayName(user),
		authorPhoto: user.photoURL || '',
		createdAt: Date.now()
	});
}

export async function editChatMessage(id: string, body: string): Promise<void> {
	if (!browser || !db) throw new Error('Not available');
	const user = getUser();
	if (!user) throw new Error('Login required');

	const text = body.trim().slice(0, MAX_CHAT_BODY);
	if (!text) throw new Error('Message cannot be empty');

	const ref = doc(db, CHAT_COL, id);
	const snap = await getDoc(ref);
	if (!snap.exists()) throw new Error('Message not found');
	const data = snap.data();
	if (data.authorId !== user.uid && !isAdmin(user.uid)) {
		throw new Error('Not allowed');
	}

	await updateDoc(ref, { body: text, editedAt: Date.now() });
}

export async function deleteChatMessage(id: string): Promise<void> {
	if (!browser || !db) throw new Error('Not available');
	const user = getUser();
	if (!user) throw new Error('Login required');

	const ref = doc(db, CHAT_COL, id);
	const snap = await getDoc(ref);
	if (!snap.exists()) return;
	const data = snap.data();
	if (data.authorId !== user.uid && !isAdmin(user.uid)) {
		throw new Error('Not allowed');
	}
	await deleteDoc(ref);
}

export function formatForumDate(ms: number): string {
	const d = new Date(ms);
	const now = Date.now();
	const diff = now - ms;
	if (diff < 60_000) return 'just now';
	if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
	if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
	if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)}d ago`;
	return d.toLocaleDateString();
}

export function renderBodyHtml(raw: string): string {
	const escaped = raw
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
	const withBreaks = escaped.replace(/\n/g, '<br/>');
	return withBreaks.replace(
		/\|\|(.+?)\|\|/g,
		'<span class="spoiler" onclick="this.classList.toggle(\'revealed\')">$1</span>'
	);
}