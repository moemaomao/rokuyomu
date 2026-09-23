<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import {
		getCategories,
		createThread,
		type ForumCategory
	} from '$lib/stores/forum';
	import { getUser } from '$lib/stores/auth.svelte';
	import { ArrowLeft } from 'lucide-svelte';

	let categories = $state<ForumCategory[]>([]);
	let categoryId = $state('');
	let title = $state('');
	let body = $state('');
	let mangaSource = $state('');
	let mangaId = $state('');
	let mangaTitle = $state('');
	let submitting = $state(false);
	let error = $state('');

	onMount(async () => {
		if (!getUser()) {
			error = 'Login required to create a thread.';
			return;
		}
		categories = await getCategories();
		const preId = $page.url.searchParams.get('id');
		const preSlug = $page.url.searchParams.get('category');
		if (preId) categoryId = preId;
		else if (preSlug) {
			const c = categories.find((x) => x.slug === preSlug);
			if (c) categoryId = c.id;
		} else if (categories[0]) categoryId = categories[0].id;
	});

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (!getUser()) {
			error = 'Login required';
			return;
		}
		const cat = categories.find((c) => c.id === categoryId);
		if (!cat) {
			error = 'Select a category';
			return;
		}
		submitting = true;
		error = '';
		try {
			const mangaRef =
				mangaSource.trim() && mangaId.trim()
					? {
							sourceId: mangaSource.trim(),
							mangaId: mangaId.trim(),
							title: mangaTitle.trim() || mangaId.trim()
						}
					: null;
			const id = await createThread({
				categoryId: cat.id,
				categorySlug: cat.slug,
				title,
				body,
				mangaRef
			});
			goto(`/community/thread/${id}`);
		} catch (err: any) {
			error = err?.message || 'Failed to create thread';
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>New thread | Community | Rokuyomu</title>
</svelte:head>

<div class="mx-auto max-w-2xl p-4 md:p-6">
	<a href="/community" class="mb-4 inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300">
		<ArrowLeft class="h-3.5 w-3.5" /> Community
	</a>

	<h1 class="mb-6 text-xl font-bold">New thread</h1>

	{#if error && !getUser()}
		<p class="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
			{error}
		</p>
	{:else}
		<form onsubmit={handleSubmit} class="space-y-4">
	<div>
		<label for="forum-category" class="mb-1 block text-xs font-medium text-zinc-400">Category</label>
		<select
			id="forum-category"
			bind:value={categoryId}
			class="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-violet-500"
		>
			{#each categories as c}
				<option value={c.id}>{c.name}</option>
			{/each}
		</select>
	</div>

	<div>
		<label for="forum-title" class="mb-1 block text-xs font-medium text-zinc-400">Title</label>
		<input
			id="forum-title"
			bind:value={title}
			maxlength="120"
			required
			placeholder="Thread title"
			class="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-violet-500"
		/>
	</div>

	<div>
		<label for="forum-body" class="mb-1 block text-xs font-medium text-zinc-400">Body</label>
		<textarea
			id="forum-body"
			bind:value={body}
			rows="8"
			required
			placeholder="Write your post… Use ||spoiler text|| for spoilers."
			class="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-violet-500"
		></textarea>
	</div>

			<details class="rounded-lg border border-zinc-800 p-3">
				<summary class="cursor-pointer text-xs text-zinc-400">Link a manga (optional)</summary>
				<div class="mt-3 grid gap-2 sm:grid-cols-3">
					<input
						bind:value={mangaSource}
						placeholder="sourceId"
						class="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs"
					/>
					<input
						bind:value={mangaId}
						placeholder="mangaId"
						class="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs"
					/>
					<input
						bind:value={mangaTitle}
						placeholder="Title"
						class="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs"
					/>
				</div>
			</details>

			{#if error}
				<p class="text-xs text-red-400">{error}</p>
			{/if}

			<button
				type="submit"
				disabled={submitting || !title.trim() || !body.trim()}
				class="rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
			>
				{submitting ? 'Creating…' : 'Create thread'}
			</button>
		</form>
	{/if}
</div>
