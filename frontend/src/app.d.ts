/// <reference types="@sveltejs/kit" />
/// <reference types="vite-plugin-pwa/svelte" />
/// <reference types="vite-plugin-pwa/info" />
/// <reference types="vite-plugin-pwa/client" />

declare module 'virtual:pwa-info' {
	export const pwaInfo:
		| {
				webManifest: {
					href: string;
					linkTag: string;
				};
		  }
		| undefined;
}

declare module 'virtual:pwa-register' {
	export type RegisterSWOptions = {
		immediate?: boolean;
		onNeedRefresh?: () => void;
		onOfflineReady?: () => void;
		onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void;
		onRegisteredSW?: (swScriptUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
		onRegisterError?: (error: any) => void;
	};

	export function registerSW(options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void>;
}

declare global {
	namespace App {
		interface Locals {
			kv?: KVNamespace;
		}
		interface Platform {
			env: {
				MIKOROKU_CACHE: KVNamespace;
			};
			context: {
				waitUntil(promise: Promise<any>): void;
			};
			caches: CacheStorage & { default: Cache };
		}
	}
}

export {};