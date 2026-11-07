<script lang="ts">
	import { onMount } from 'svelte';

	let isDarkMode = $state(true);

	onMount(() => {
		isDarkMode = document.documentElement.classList.contains('dark');
		const obs = new MutationObserver(() => {
			isDarkMode = document.documentElement.classList.contains('dark');
		});
		obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
		return () => obs.disconnect();
	});
</script>

<svelte:head>
	<title>About | Rokuyomu</title>
	<meta
		name="description"
		content="About Rokuyomu — Manga Source Base. How it works, multi-source aggregation, and fan scanlation sources."
	/>
</svelte:head>

<div class="mx-auto max-w-3xl px-4 py-8 sm:px-6">
	<h1 class="mb-2 text-2xl font-bold sm:text-3xl">About Rokuyomu</h1>
	<p class="mb-8 text-sm {isDarkMode ? 'text-zinc-400' : 'text-zinc-500'}">
		Manga Source Base
	</p>

	<div class="space-y-8 text-sm leading-relaxed {isDarkMode ? 'text-zinc-300' : 'text-zinc-700'}">
		<section>
			<h2 class="mb-3 text-lg font-semibold {isDarkMode ? 'text-white' : 'text-zinc-900'}">
				What is Rokuyomu?
			</h2>
			<p>
				Rokuyomu is a <strong>Manga Source Base</strong> — a single interface that brings together
				many fan scanlation websites into one place. Instead of jumping between different sites,
				you can browse, search, and read through a unified experience.
			</p>
			<p class="mt-3">
				We aggregate publicly available data from fan scanlation sources. We do
				<strong> not </strong> host official or licensed manga. All titles, covers, and chapters
				come from external scanlation sites.
			</p>
		</section>

		<section>
			<h2 class="mb-3 text-lg font-semibold {isDarkMode ? 'text-white' : 'text-zinc-900'}">
				How it works
			</h2>
			<ol class="list-decimal space-y-3 pl-5">
				<li>
					<strong>Source adapters</strong> — Each supported website has its own adapter that
					knows how to fetch the latest updates, manga details, and chapter pages from that site.
				</li>
				<li>
					<strong>Aggregation</strong> — When you open the homepage, Rokuyomu can pull the latest
					updates from one source or from multiple preferred sources you selected in Settings,
					then merge and sort them by newest first.
				</li>
				<li>
					<strong>Proxy</strong> — Cover images and some resources are loaded through our proxy
					so they display reliably. We do not store the actual manga files on our servers.
				</li>
				<li>
					<strong>Local data</strong> — Bookmarks, reading history, preferred sources, and theme
					are saved in your browser. If you log in, bookmarks and history can sync across devices.
				</li>
			</ol>
		</section>

		<section>
			<h2 class="mb-3 text-lg font-semibold {isDarkMode ? 'text-white' : 'text-zinc-900'}">
				Main features
			</h2>
			<ul class="list-disc space-y-2 pl-5">
				<li>
					<strong>Multi-source homepage</strong> — Choose which sources appear on the home page
					in Settings. Leave empty to browse one source at a time via the dropdown.
				</li>
				<li>
					<strong>Source dropdown</strong> — Switch between Indonesian, English, Japanese, and
					other language sources quickly.
				</li>
				<li>
					<strong>Bookmarks & History</strong> — Save titles and track what you’ve read, locally
					or synced when logged in.
				</li>
				<li>
					<strong>Search & filters</strong> — Search by title and filter by type where the source
					supports it.
				</li>
			</ul>
		</section>

		<section>
			<h2 class="mb-3 text-lg font-semibold {isDarkMode ? 'text-white' : 'text-zinc-900'}">
				Important notes
			</h2>
			<ul class="list-disc space-y-2 pl-5">
				<li>
					Content quality and availability depend entirely on the original scanlation sites.
					If a source is down or changes its structure, some titles may temporarily fail to load.
				</li>
				<li>
					Some sources include R18 / adult content. Please use the site responsibly and according
					to the laws in your country.
				</li>
				<li>
					Rokuyomu is built for convenience. Support the original creators and official releases
					whenever possible.
				</li>
			</ul>
		</section>
	</div>
</div>