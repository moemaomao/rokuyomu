<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import {
		getCategories,
		getThreadsByCategory,
		type ForumCategory,
		type ForumThread,
		formatForumDate
	} from '$lib/stores/forum';
	import { getUser } from '$lib/stores/auth.svelte';
	import { ArrowLeft, Plus, Pin, Lock, MessageCircle } from 'lucide-svelte';

	let category = $state<ForumCategory | null>(null);
	let threads = $state<ForumThread[]>([]);
	let loading = $state(true);
	let error = $state('');

	onMount(async () => {
		try {
			const slug = $page.params.slug || '';
			const id = $page.url.searchParams.get('id') || '';
			const cats = await getCategories();
			category = cats.find((c) => c.id === id || c.slug === slug) || null;
			if (!category) {
				error = 'Category not found';
				return;
			}
			threads = await getThreadsByCategory(category.id);
			threads = threads.sort(
				(a, b) => Number(b.pinned) - Number(a.pinned) || b.lastReplyAt - a.lastReplyAt
			);
		} catch (e: any) {
			error = e?.message || 'Failed to load';
		} finally {
			loading = false;
		}
	});
</script>

<svelte:head>
	<title>{category?.name || 'Category'} | Community | Rokuyomu</title>
</svelte:head>

<div class="mx-auto max-w-4xl p-4 md:p-6">
	<a href="/community" class="mb-4 inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300">
		<ArrowLeft class="h-3.5 w-3.5" /> Back to Community
	</a>

	<div class="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-4">
		<div>
			<h1 class="text-xl font-bold">{category?.name || '…'}</h1>
			{#if category}
				<p class="mt-1 text-xs text-zinc-500">{category.description}</p>
			{/if}
		</div>
		{#if getUser() && category}
			<a
				href="/community/new?category={category.slug}&id={category.id}"
				class="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-500"
			>
				<Plus class="h-4 w-4" /> New thread
			</a>
		{/if}
	</div>

	{#if loading}
		<p class="py-12 text-center text-sm text-zinc-500">Loading…</p>
	{:else if error}
		<p class="py-12 text-center text-sm text-red-400">{error}</p>
	{:else if threads.length === 0}
		<p class="rounded-xl border border-dashed border-zinc-800 py-10 text-center text-sm text-zinc-500">
			No threads in this category yet.
		</p>
	{:else}
		<ul class="divide-y divide-zinc-800 overflow-hidden rounded-xl border border-zinc-800">
			{#each threads as t}
				<li>
					<a href="/community/thread/{t.id}" class="flex gap-3 px-4 py-3 hover:bg-zinc-900/60">
						<div class="min-w-0 flex-1">
							<div class="flex flex-wrap items-center gap-1.5">
								{#if t.pinned}<Pin class="h-3 w-3 text-amber-400" />{/if}
								{#if t.locked}<Lock class="h-3 w-3 text-zinc-500" />{/if}
								<span class="line-clamp-1 text-sm font-medium">{t.title}</span>
							</div>
							<p class="mt-0.5 text-[11px] text-zinc-500">
								{t.authorName} · {formatForumDate(t.createdAt)}
							</p>
						</div>
						<div class="shrink-0 text-right text-[11px] text-zinc-500">
							<div class="flex items-center justify-end gap-1">
								<MessageCircle class="h-3 w-3" /> {t.replyCount}
							</div>
							<p class="mt-0.5">{formatForumDate(t.lastReplyAt)}</p>
						</div>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>
