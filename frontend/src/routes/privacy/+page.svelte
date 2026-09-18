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
	<title>Privacy Policy | Rokuyomu</title>
	<meta
		name="description"
		content="Privacy Policy of Rokuyomu — Manga Source Base. We only aggregate fan scanlation sources and do not host official content."
	/>
</svelte:head>

<div class="mx-auto max-w-3xl px-4 py-8 sm:px-6">
	<h1 class="mb-2 text-2xl font-bold sm:text-3xl">Privacy Policy</h1>
	<p class="mb-8 text-sm {isDarkMode ? 'text-zinc-400' : 'text-zinc-500'}">
		Last updated: September 16, 2026
	</p>

	<div class="space-y-8 text-sm leading-relaxed {isDarkMode ? 'text-zinc-300' : 'text-zinc-700'}">
		<section>
			<h2 class="mb-3 text-lg font-semibold {isDarkMode ? 'text-white' : 'text-zinc-900'}">
				1. About Rokuyomu
			</h2>
			<p>
				Rokuyomu is a <strong>Manga Source Base</strong> — an aggregator that collects and displays
				manga information from various third-party fan scanlation websites.
			</p>
			<p class="mt-3">
				<strong>We do not host any official or licensed manga content.</strong> All content shown
				on this website is scraped/aggregated from publicly available fan scanlation sources. We
				will never host or distribute official publisher releases.
			</p>
		</section>

		<section>
			<h2 class="mb-3 text-lg font-semibold {isDarkMode ? 'text-white' : 'text-zinc-900'}">
				2. Content Disclaimer
			</h2>
			<ul class="list-disc space-y-2 pl-5">
				<li>
					All manga titles, covers, chapters, and related data displayed on Rokuyomu come from
					external fan scanlation websites.
				</li>
				<li>
					We do not claim ownership of any manga content, artwork, or translations.
				</li>
				<li>
					If you are a rights holder and wish to request removal of certain aggregated links,
					please contact us. We will review and respond accordingly.
				</li>
				<li>
					Users are responsible for complying with the laws of their own country regarding
					access to fan-translated content.
				</li>
			</ul>
		</section>

		<section>
			<h2 class="mb-3 text-lg font-semibold {isDarkMode ? 'text-white' : 'text-zinc-900'}">
				3. Information We Collect
			</h2>
			<p class="mb-3">Rokuyomu collects minimal data:</p>
			<ul class="list-disc space-y-2 pl-5">
				<li>
					<strong>Local storage data</strong> — Reading history, bookmarks, preferred sources,
					and theme preference are stored in your browser (localStorage / cookies). This data
					stays on your device unless you log in.
				</li>
				<li>
					<strong>Account data (optional)</strong> — If you sign in with Google or GitHub, we
					receive basic profile information (email, display name, avatar) solely for
					synchronizing bookmarks and history across devices.
				</li>
				<li>
					<strong>Technical logs</strong> — Standard server logs (IP address, browser type,
					request path) may be collected temporarily for security and performance monitoring.
					We do not sell or share this data.
				</li>
			</ul>
		</section>

		<section>
			<h2 class="mb-3 text-lg font-semibold {isDarkMode ? 'text-white' : 'text-zinc-900'}">
				4. How We Use Your Data
			</h2>
			<ul class="list-disc space-y-2 pl-5">
				<li>To provide and improve the service (bookmarks, history, multi-source preferences).</li>
				<li>To maintain security and prevent abuse.</li>
				<li>We do <strong>not</strong> sell, rent, or share your personal data with third parties
					for advertising or marketing purposes.</li>
			</ul>
		</section>

		<section>
			<h2 class="mb-3 text-lg font-semibold {isDarkMode ? 'text-white' : 'text-zinc-900'}">
				5. Third-Party Services
			</h2>
			<p>
				Rokuyomu may use third-party services such as Firebase Authentication (for optional
				login) and Cloudflare (hosting / edge). These services have their own privacy policies.
				Content images and chapter data are loaded from external scanlation sites via our proxy;
				we do not store the actual manga files on our servers.
			</p>
		</section>

		<section>
			<h2 class="mb-3 text-lg font-semibold {isDarkMode ? 'text-white' : 'text-zinc-900'}">
				6. Cookies & Local Storage
			</h2>
			<p>
				We use cookies and localStorage only for essential functionality: theme preference,
				sidebar state, preferred sources, bookmarks, and reading history. You can clear this
				data anytime through your browser settings.
			</p>
		</section>

		<section>
			<h2 class="mb-3 text-lg font-semibold {isDarkMode ? 'text-white' : 'text-zinc-900'}">
				7. Children's Privacy
			</h2>
			<p>
				Rokuyomu is not directed at children under 13. Some sources contain adult (R18) content.
				Users are responsible for ensuring they meet the legal age requirements in their
				jurisdiction.
			</p>
		</section>

		<section>
			<h2 class="mb-3 text-lg font-semibold {isDarkMode ? 'text-white' : 'text-zinc-900'}">
				8. Changes to This Policy
			</h2>
			<p>
				We may update this Privacy Policy from time to time. The latest version will always be
				available on this page with an updated date.
			</p>
		</section>

		<section>
			<h2 class="mb-3 text-lg font-semibold {isDarkMode ? 'text-white' : 'text-zinc-900'}">
				9. Contact
			</h2>
			<p>
				If you have questions about this Privacy Policy or wish to request data removal, you can
				reach us via the Discord link or contact options available on the website.
			</p>
		</section>
	</div>
</div>