<script lang="ts">
	let { isDarkMode = true }: { isDarkMode?: boolean } = $props();
</script>

<footer
	class="border-t py-6 text-center text-sm
		{isDarkMode ? 'border-zinc-800/50 text-zinc-400' : 'border-zinc-200 text-zinc-600'}"
>
	<div class="mx-auto max-w-2xl space-y-2 px-4">
		<p>
			Rokuyomu is a Manga Source Base built to unify manga data and source integrations in one
			consistent system.
		</p>
		<p class="font-medium {isDarkMode ? 'text-zinc-200' : 'text-zinc-800'}">
			Rokuyomu — Manga Source Base.
		</p>
		<p class="text-xs {isDarkMode ? 'text-zinc-500' : 'text-zinc-500'}">
			A unified foundation for manga sources.
		</p>
		<p class="pt-1 text-xs space-x-3">
	<a
		href="/about"
		class="underline underline-offset-2 transition hover:opacity-80
			{isDarkMode ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-500 hover:text-zinc-800'}"
	>
		About
	</a>
	<span class="{isDarkMode ? 'text-zinc-600' : 'text-zinc-400'}">·</span>
	<a
		href="/privacy"
		class="underline underline-offset-2 transition hover:opacity-80
			{isDarkMode ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-500 hover:text-zinc-800'}"
	>
		Privacy Policy
	</a>
</p>
	</div>
</footer>