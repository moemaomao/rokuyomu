<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import {
		getCategories,
		getRecentThreads,
		type ForumCategory,
		type ForumThread,
		formatForumDate
	} from '$lib/stores/forum';
	import { getUser } from '$lib/stores/auth.svelte';
	import { MessagesSquare, Plus, Pin, Lock, MessageCircle } from 'lucide-svelte';

	let categories = $state<ForumCategory[]>([]);
	let threads = $state<ForumThread[]>([]);
	let loading = $state(true);
	let error = $state('');

	onMount(async () => {
		try {
			const [cats, recent] = await Promise.all([getCategories(), getRecentThreads(25)]);
			categories = cats;
			threads = recent.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastReplyAt - a.lastReplyAt);
		} catch (e: any) {
			error = e?.message || 'Failed to load forum';
		} finally {
			loading = false;
		}
	});
</script>

<svelte:head>
	<title>Community | Rokuyomu</title>
</svelte:head>

<div class="mx-auto max-w-4xl p-4 md:p-6">
	<div class="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-4">
		<div>
			<h1 class="flex items-center gap-2 text-xl font-bold md:text-2xl">
				<MessagesSquare class="h-6 w-6 text-violet-400" />
				Community
			</h1>
			<p class="mt-1 text-xs text-zinc-500">Discuss manga, share recommendations, report issues.</p>
		</div>
		{#if getUser()}
			<a
				href="/community/new"
				class="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-violet-500"
			>
				<Plus class="h-4 w-4" />
				New thread
			</a>
		{:else}
			<p class="text-xs text-zinc-500">Login to post</p>
		{/if}
	</div>

	{#if loading}
		<p class="py-12 text-center text-sm text-zinc-500">Loading…</p>
	{:else if error}
		<p class="py-12 text-center text-sm text-red-400">{error}</p>
	{:else}
		<!-- Categories -->
		<section class="mb-8">
			<h2 class="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">Categories</h2>
			<div class="grid gap-2 sm:grid-cols-2">
				{#each categories as c}
					<a
						href="/community/category/{c.slug}?id={c.id}"
						class="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 transition hover:border-violet-500/40 hover:bg-zinc-900/70"
					>
						<p class="font-medium">{c.name}</p>
						<p class="mt-1 line-clamp-2 text-xs text-zinc-500">{c.description}</p>
						{#if c.threadCount != null}
							<p class="mt-2 text-[10px] text-zinc-600">{c.threadCount} threads</p>
						{/if}
					</a>
				{/each}
			</div>
		</section>

		<!-- Recent threads -->
		<section>
			<h2 class="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">Recent activity</h2>
			{#if threads.length === 0}
				<p class="rounded-xl border border-dashed border-zinc-800 py-10 text-center text-sm text-zinc-500">
					No threads yet. Be the first to start a discussion.
				</p>
			{:else}
				<ul class="divide-y divide-zinc-800 overflow-hidden rounded-xl border border-zinc-800">
					{#each threads as t}
						<li>
							<a
								href="/community/thread/{t.id}"
								class="flex gap-3 px-4 py-3 transition hover:bg-zinc-900/60"
							>
								<div class="min-w-0 flex-1">
									<div class="flex flex-wrap items-center gap-1.5">
										{#if t.pinned}
											<Pin class="h-3 w-3 text-amber-400" />
										{/if}
										{#if t.locked}
											<Lock class="h-3 w-3 text-zinc-500" />
										{/if}
										<span class="line-clamp-1 text-sm font-medium">{t.title}</span>
									</div>
									<p class="mt-0.5 text-[11px] text-zinc-500">
										{t.authorName} · {t.categorySlug}
										{#if t.mangaRef}
											· <span class="text-violet-400/80">{t.mangaRef.title}</span>
										{/if}
									</p>
								</div>
								<div class="shrink-0 text-right text-[11px] text-zinc-500">
									<div class="flex items-center justify-end gap-1">
										<MessageCircle class="h-3 w-3" />
										{t.replyCount}
									</div>
									<p class="mt-0.5">{formatForumDate(t.lastReplyAt)}</p>
								</div>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}
</div>
