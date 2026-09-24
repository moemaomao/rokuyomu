/**
 * Verify Firebase ID token + check ADMIN_UIDS.
 * 1) Coba Google tokeninfo
 * 2) Fallback: decode JWT payload (cek exp + uid admin)
 */
import { isAdmin } from '$lib/admin';

function decodeJwtPayload(token: string): Record<string, unknown> | null {
	try {
		const parts = token.split('.');
		if (parts.length < 2) return null;
		const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
		const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
		const json = atob(padded);
		return JSON.parse(json) as Record<string, unknown>;
	} catch {
		return null;
	}
}

export async function verifyAdminFromRequest(
	request: Request
): Promise<{ ok: true; uid: string } | { ok: false; status: number; message: string }> {
	const authHeader = request.headers.get('authorization') || '';
	const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

	if (!token) {
		return { ok: false, status: 401, message: 'Missing Authorization Bearer token' };
	}

	// ── 1) Google tokeninfo (best effort) ──────────────────────────────────
	try {
		const res = await fetch(
			`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`,
			{ headers: { Accept: 'application/json' } }
		);
		if (res.ok) {
			const data = (await res.json()) as {
				sub?: string;
				user_id?: string;
				exp?: string;
			};
			const uid = data.sub || data.user_id || '';
			if (uid && isAdmin(uid)) {
				if (data.exp && Number(data.exp) * 1000 < Date.now()) {
					return { ok: false, status: 401, message: 'Token expired' };
				}
				return { ok: true, uid };
			}
			if (uid && !isAdmin(uid)) {
				return { ok: false, status: 403, message: 'Not an admin' };
			}
		}
	} catch (e) {
		console.warn('[verifyAdmin] tokeninfo failed, fallback JWT decode', e);
	}

	// ── 2) Fallback: decode JWT payload ────────────────────────────────────
	const payload = decodeJwtPayload(token);
	if (!payload) {
		return { ok: false, status: 401, message: 'Invalid token format' };
	}

	const uid = String(payload.sub || payload.user_id || '');
	if (!uid) {
		return { ok: false, status: 401, message: 'Token missing uid' };
	}

	const exp = Number(payload.exp);
	if (exp && exp * 1000 < Date.now() - 60_000) {
		// 60s clock skew tolerance
		return { ok: false, status: 401, message: 'Token expired — refresh page & login again' };
	}

	if (!isAdmin(uid)) {
		return { ok: false, status: 403, message: 'Not an admin' };
	}

	return { ok: true, uid };
}
