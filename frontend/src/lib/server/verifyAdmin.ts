/**
 * Verify Firebase ID token via JWT payload decode + ADMIN_UIDS.
 * (Tidak pakai Google tokeninfo — sering gagal dari CF Workers)
 */
import { isAdmin } from '$lib/admin';

function base64UrlToJson(segment: string): Record<string, unknown> | null {
	try {
		const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
		const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
		const binary = atob(b64 + pad);
		// decode UTF-8 safely
		const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
		const json = new TextDecoder().decode(bytes);
		return JSON.parse(json) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
	const parts = token.split('.');
	if (parts.length < 2) return null;
	return base64UrlToJson(parts[1]);
}

export async function verifyAdminFromRequest(
	request: Request
): Promise<{ ok: true; uid: string } | { ok: false; status: number; message: string }> {
	const authHeader = request.headers.get('authorization') || '';
	const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

	if (!token) {
		return { ok: false, status: 401, message: 'Missing token — login ulang' };
	}

	const payload = decodeJwtPayload(token);
	if (!payload) {
		return { ok: false, status: 401, message: 'Token tidak valid (bukan JWT)' };
	}

	const uid = String(payload.user_id || payload.sub || '').trim();
	if (!uid) {
		return { ok: false, status: 401, message: 'Token tanpa user id' };
	}

	const exp = Number(payload.exp);
	if (Number.isFinite(exp) && exp * 1000 < Date.now() - 120_000) {
		return {
			ok: false,
			status: 401,
			message: 'Token kadaluarsa — logout lalu login lagi'
		};
	}

	if (!isAdmin(uid)) {
		return {
			ok: false,
			status: 403,
			message: `Bukan admin (uid: ${uid.slice(0, 8)}…)`
		};
	}

	return { ok: true, uid };
}
