/**
 * Verify Firebase ID token via Google tokeninfo + check ADMIN_UIDS.
 */
import { isAdmin } from '$lib/admin';

export async function verifyAdminFromRequest(
    request: Request
): Promise<{ ok: true; uid: string } | { ok: false; status: number; message: string }> {
    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

    if (!token) {
        return { ok: false, status: 401, message: 'Missing Authorization Bearer token' };
    }

    try {
        const res = await fetch(
            `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`,
            { headers: { Accept: 'application/json' } }
        );

        if (!res.ok) {
            return { ok: false, status: 401, message: 'Invalid or expired token' };
        }

        const data = (await res.json()) as {
            sub?: string;
            user_id?: string;
            exp?: string;
        };
        const uid = data.sub || data.user_id || '';

        if (!uid) {
            return { ok: false, status: 401, message: 'Token missing uid' };
        }

        if (data.exp && Number(data.exp) * 1000 < Date.now()) {
            return { ok: false, status: 401, message: 'Token expired' };
        }

        if (!isAdmin(uid)) {
            return { ok: false, status: 403, message: 'Not an admin' };
        }

        return { ok: true, uid };
    } catch (e) {
        console.error('[verifyAdmin]', e);
        return { ok: false, status: 500, message: 'Token verification failed' };
    }
}
