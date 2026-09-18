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