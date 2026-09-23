<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import {
		getThread,
		getPosts,
		createReply,
		deleteThread,
		setThreadPinned,
		setThreadLocked,
		formatForumDate,
		renderBodyHtml,
		type ForumThread,
		type ForumPost
	} from '$lib/stores/forum';
	import { getUser } from '$lib/stores/auth.svelte';
	import { isAdmin } from '$lib/admin';
	import { ArrowLeft, Lock, Pin, Trash2, Send } from 'lucide-svelte';

	let thread = $state<ForumThread | null>(null);
	let posts = $state<ForumPost[]>([]);
	let loading = $state(true);
	let error = $state('');
	let replyBody = $state('');
	let sending = $state(false);
	let actionMsg = $state('');

	async function load() {
		const id = $page.params.id;
		if (!id) {
			error = 'Invalid thread';
			loading = false;
			return;
		}
		thread = await getThread(id);
		if (!thread) {
			error = 'Thread not found';
			loading = false;
			return;
		}
		posts = await getPosts(id);
		loading = false;
	}

	onMount(() => {
		load().catch((e) => {
			error = e?.message || 'Failed to load';
			loading = false;
		});
	});

	async function handleReply() {
		if (!thread || !replyBody.trim()) return;
		sending = true;
		actionMsg = '';
		try {
			await createReply(thread.id, replyBody);
			replyBody = '';
			posts = await getPosts(thread.id);
			thread = await getThread(thread.id);
		} catch (e: any) {
			actionMsg = e?.message || 'Failed to reply';
		} finally {
			sending = false;
		}
	}

	async function handleDelete() {
		if (!thread || !confirm('Delete this thread and all replies?')) return;
		try {
			await deleteThread(thread.id);
			goto('/community');
		} catch (e: any) {
			actionMsg = e?.message || 'Delete failed';
		}
	}

	async function togglePin() {
		if (!thread) return;
		try {
			await setThreadPinned(thread.id, !thread.pinned);
			thread = await getThread(thread.id);
		} catch (e: any) {
			actionMsg = e?.message || 'Failed';
		}
	}

	async function toggleLock() {
		if (!thread) return;
		try {
			await setThreadLocked(thread.id, !thread.locked);
			thread = await getThread(thread.id);
		} catch (e: any) {
			actionMsg = e?.message || 'Failed';
		}
	}

	function mangaHref(ref: NonNullable<ForumThread['mangaRef']>) {
		const clean = ref.mangaId.startsWith('/') ? ref.mangaId : `/${ref.mangaId}`;
		return `/manga/${ref.sourceId}${clean}`;
	}

	const fieldClass =
		'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-violet-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500';
</script>

<svelte:head>
	<title>{thread?.title || 'Thread'} | Community | Rokuyomu</title>
</svelte:head>

<div class="mx-auto max-w-3xl p-4 md:p-6">
	<a
		href="/community"
		class="mb-4 inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
	>
		<ArrowLeft class="h-3.5 w-3.5" /> Community
	</a>

	{#if error}
		<p class="py-12 text-center text-sm text-red-500">{error}</p>
	{:else if loading && !thread}
		<div class="space-y-3">
			<div class="h-8 w-2/3 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800"></div>
			<div class="h-4 w-1/3 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800"></div>
			<div class="mt-6 h-32 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900/50"></div>
		</div>
	{:else if thread}
		<header class="mb-6 border-b border-zinc-200 pb-4 dark:border-zinc-800">
			<div class="flex flex-wrap items-start justify-between gap-2">
				<div class="min-w-0 flex-1">
					<div class="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
						{#if thread.pinned}
							<span class="flex items-center gap-0.5 text-amber-500"
								><Pin class="h-3 w-3" /> Pinned</span
							>
						{/if}
						{#if thread.locked}
							<span class="flex items-center gap-0.5"><Lock class="h-3 w-3" /> Locked</span>
						{/if}
						<span class="capitalize">{thread.categorySlug}</span>
					</div>
					<h1 class="text-xl font-bold text-zinc-900 md:text-2xl dark:text-zinc-100">{thread.title}</h1>
					<p class="mt-1 text-xs text-zinc-500">
						by {thread.authorName} · {formatForumDate(thread.createdAt)}
					</p>
					{#if thread.mangaRef}
						<a
							href={mangaHref(thread.mangaRef)}
							class="mt-2 inline-block text-xs text-violet-600 hover:underline dark:text-violet-400"
						>
							Related: {thread.mangaRef.title}
						</a>
					{/if}
				</div>
				{#if getUser() && (getUser()!.uid === thread.authorId || isAdmin(getUser()!.uid))}
					<div class="flex flex-wrap gap-1.5">
						{#if isAdmin(getUser()!.uid)}
							<button
								type="button"
								onclick={togglePin}
								class="rounded-md border border-zinc-300 px-2 py-1 text-[10px] text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
							>
								{thread.pinned ? 'Unpin' : 'Pin'}
							</button>
							<button
								type="button"
								onclick={toggleLock}
								class="rounded-md border border-zinc-300 px-2 py-1 text-[10px] text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
							>
								{thread.locked ? 'Unlock' : 'Lock'}
							</button>
						{/if}
						<button
							type="button"
							onclick={handleDelete}
							class="flex items-center gap-1 rounded-md border border-red-500/40 px-2 py-1 text-[10px] text-red-500 hover:bg-red-500/10"
						>
							<Trash2 class="h-3 w-3" /> Delete
						</button>
					</div>
				{/if}
			</div>
		</header>

		{#if actionMsg}
			<p class="mb-3 text-xs text-red-500">{actionMsg}</p>
		{/if}

		<div class="space-y-4">
			{#each posts as p, i}
				<article
					class="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/30"
				>
					<div class="mb-2 flex items-center gap-2">
						{#if p.authorPhoto}
							<img src={p.authorPhoto} alt="" class="h-7 w-7 rounded-full object-cover" />
						{:else}
							<span
								class="flex h-7 w-7 items-center justify-center rounded-full bg-violet-600 text-[10px] font-bold text-white"
							>
								{p.authorName[0]?.toUpperCase() || 'U'}
							</span>
						{/if}
						<div>
							<p class="text-xs font-medium text-zinc-900 dark:text-zinc-100">{p.authorName}</p>
							<p class="text-[10px] text-zinc-500">
								{formatForumDate(p.createdAt)}
								{#if i === 0}<span class="ml-1 text-violet-600 dark:text-violet-400">OP</span>{/if}
							</p>
						</div>
					</div>
					<div class="forum-body text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
						{@html renderBodyHtml(p.body)}
					</div>
				</article>
			{/each}
		</div>

		{#if thread.locked}
			<p
				class="mt-6 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40"
			>
				This thread is locked.
			</p>
		{:else if getUser()}
			<form
				class="mt-6 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40"
				onsubmit={(e) => {
					e.preventDefault();
					handleReply();
				}}
			>
				<label for="forum-reply" class="mb-2 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
					>Reply</label
				>
				<textarea
					id="forum-reply"
					bind:value={replyBody}
					rows="4"
					placeholder="Write a reply… Use ||spoiler text|| for spoilers."
					class={fieldClass}
				></textarea>
				<button
					type="submit"
					disabled={sending || !replyBody.trim()}
					class="mt-3 flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
				>
					<Send class="h-3.5 w-3.5" />
					{sending ? 'Sending…' : 'Post reply'}
				</button>
			</form>
		{:else}
			<p class="mt-6 text-center text-xs text-zinc-500">Login to reply.</p>
		{/if}
	{/if}
</div>

<style>
	:global(.forum-body .spoiler) {
		background: #d4d4d8;
		color: transparent;
		border-radius: 4px;
		padding: 0 4px;
		cursor: pointer;
		user-select: none;
	}
	:global(html.dark .forum-body .spoiler) {
		background: #3f3f46;
	}
	:global(.forum-body .spoiler.revealed) {
		background: transparent;
		color: inherit;
	}
</style>
