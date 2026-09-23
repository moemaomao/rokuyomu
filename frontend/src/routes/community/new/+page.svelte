<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { getCategories, createThread, type ForumCategory } from '$lib/stores/forum';
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
	let loadingCats = $state(true);

	const fieldClass =
		'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-violet-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500';

	onMount(async () => {
		if (!getUser()) {
			error = 'Login required to create a thread.';
			loadingCats = false;
			return;
		}
		try {
			categories = await getCategories();
			const preId = $page.url.searchParams.get('id');
			const preSlug = $page.url.searchParams.get('category');
			if (preId) categoryId = preId;
			else if (preSlug) {
				const c = categories.find((x) => x.slug === preSlug);
				if (c) categoryId = c.id;
			} else if (categories[0]) categoryId = categories[0].id;
		} catch (e: any) {
			error = e?.message || 'Failed to load categories';
		} finally {
			loadingCats = false;
		}
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
	<a
		href="/community"
		class="mb-4 inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
	>
		<ArrowLeft class="h-3.5 w-3.5" /> Community
	</a>

	<h1 class="mb-6 text-xl font-bold text-zinc-900 dark:text-zinc-100">New thread</h1>

	{#if error && !getUser()}
		<p
			class="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200"
		>
			{error}
		</p>
	{:else}
		<form onsubmit={handleSubmit} class="space-y-4">
			<div>
				<label for="forum-category" class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
					>Category</label
				>
				<select id="forum-category" bind:value={categoryId} class={fieldClass} disabled={loadingCats}>
					{#if loadingCats}
						<option value="">Loading…</option>
					{:else}
						{#each categories as c}
							<option value={c.id}>{c.name}</option>
						{/each}
					{/if}
				</select>
			</div>

			<div>
				<label for="forum-title" class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
					>Title</label
				>
				<input
					id="forum-title"
					bind:value={title}
					maxlength="120"
					required
					placeholder="Thread title"
					class={fieldClass}
				/>
			</div>

			<div>
				<label for="forum-body" class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
					>Body</label
				>
				<textarea
					id="forum-body"
					bind:value={body}
					rows="8"
					required
					placeholder="Write your post… Use ||spoiler text|| for spoilers."
					class={fieldClass}
				></textarea>
			</div>

			<details
				class="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
			>
				<summary class="cursor-pointer text-xs text-zinc-500">Link a manga (optional)</summary>
				<div class="mt-3 grid gap-2 sm:grid-cols-3">
					<input bind:value={mangaSource} placeholder="sourceId" class="{fieldClass} text-xs" />
					<input bind:value={mangaId} placeholder="mangaId" class="{fieldClass} text-xs" />
					<input bind:value={mangaTitle} placeholder="Title" class="{fieldClass} text-xs" />
				</div>
			</details>

			{#if error}
				<p class="text-xs text-red-500">{error}</p>
			{/if}

			<button
				type="submit"
				disabled={submitting || !title.trim() || !body.trim() || loadingCats}
				class="rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
			>
				{submitting ? 'Creating…' : 'Create thread'}
			</button>
		</form>
	{/if}
</div>
