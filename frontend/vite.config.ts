import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit(),
		tailwindcss(),
		SvelteKitPWA({
			registerType: 'autoUpdate',
			injectRegister: 'auto',
			strategies: 'generateSW',
			manifest: {
				name: 'Rokuyomu',
				short_name: 'Rokuyomu',
				description: 'Multi-source manga, comics & novel reader',
				theme_color: '#7c3aed',
				background_color: '#09090b',
				display: 'standalone',
				orientation: 'any',
				start_url: '/',
				scope: '/',
				icons: [
					{
						src: '/pwa-192x192.png',
						sizes: '192x192',
						type: 'image/png'
					},
					{
						src: '/pwa-512x512.png',
						sizes: '512x512',
						type: 'image/png'
					},
					{
						src: '/pwa-512x512.png',
						sizes: '512x512',
						type: 'image/png',
						purpose: 'maskable'
					}
				]
			},
			workbox: {
				globPatterns: [
					'**/*.{js,css,html,ico,png,svg,webp,woff,woff2,webmanifest}'
				],
				navigateFallback: '/',
				navigateFallbackDenylist: [
					/^\/api\//,
					/^\/~/,
					/\/[^/?]+\.[^/]+$/
				],
				navigationPreload: true,
				cleanupOutdatedCaches: true,
				clientsClaim: true,
				skipWaiting: true,
				runtimeCaching: [
					{
						urlPattern: ({ request }) => request.mode === 'navigate',
						handler: 'NetworkFirst',
						options: {
							cacheName: 'rokuyomu-pages',
							networkTimeoutSeconds: 3,
							expiration: {
								maxEntries: 64,
								maxAgeSeconds: 60 * 60 * 24 * 7 // 7 days
							},
							cacheableResponse: {
								statuses: [0, 200]
							}
						}
					},
					{
						urlPattern: ({ request }) =>
							request.destination === 'script' ||
							request.destination === 'style' ||
							request.destination === 'worker',
						handler: 'CacheFirst',
						options: {
							cacheName: 'rokuyomu-assets',
							expiration: {
								maxEntries: 128,
								maxAgeSeconds: 60 * 60 * 24 * 30
							},
							cacheableResponse: {
								statuses: [0, 200]
							}
						}
					},
					// Fonts
					{
						urlPattern: ({ request }) => request.destination === 'font',
						handler: 'CacheFirst',
						options: {
							cacheName: 'rokuyomu-fonts',
							expiration: {
								maxEntries: 32,
								maxAgeSeconds: 60 * 60 * 24 * 365
							},
							cacheableResponse: {
								statuses: [0, 200]
							}
						}
					},
					{
						urlPattern: ({ request, url }) =>
							request.destination === 'image' &&
							!url.pathname.startsWith('/api/'),
						handler: 'StaleWhileRevalidate',
						options: {
							cacheName: 'rokuyomu-images',
							expiration: {
								maxEntries: 200,
								maxAgeSeconds: 60 * 60 * 24 * 14
							},
							cacheableResponse: {
								statuses: [0, 200]
							}
						}
					},
					{
						urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
						handler: 'NetworkFirst',
						options: {
							cacheName: 'rokuyomu-api',
							networkTimeoutSeconds: 5,
							expiration: {
								maxEntries: 64,
								maxAgeSeconds: 60 * 60 * 6
							},
							cacheableResponse: {
								statuses: [0, 200]
							}
						}
					}
				]
			},
			devOptions: {
				enabled: true,
				type: 'module',
				navigateFallback: '/'
			},
			kit: {
				includeVersionFile: true
			}
		})
	]
});
