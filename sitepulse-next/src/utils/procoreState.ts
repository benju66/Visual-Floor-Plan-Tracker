// Pure helpers for the Procore SSO OAuth round-trip (Security Hardening Phase 3).
//
// The `state` parameter carries a CSRF `nonce` (matched against an httpOnly cookie
// the `/start` route set) plus the in-app path to return to after login. Keeping
// the encode/decode + path-safety logic here (framework-free, no I/O) lets it be
// unit-tested exhaustively — the callback's open-redirect defense lives or dies on
// `isSafeReturnPath`.

/** Name of the httpOnly nonce cookie the `/start` route sets and the callback checks. */
export const PROCORE_NONCE_COOKIE = 'procore_oauth_nonce';

export interface ProcoreState {
  /** Random per-attempt value; must equal the httpOnly nonce cookie in the callback. */
  nonce: string;
  /** Where to send the user after login — only ever an in-app path (see isSafeReturnPath). */
  returnTo: string;
}

function toBase64Url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function fromBase64Url(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

/** Encode a state payload for the OAuth `state` query parameter. */
export function encodeState(state: ProcoreState): string {
  return toBase64Url(JSON.stringify({ nonce: state.nonce, returnTo: state.returnTo }));
}

/**
 * Decode an OAuth `state` value back into `{ nonce, returnTo }`. Returns `null` for
 * anything malformed (missing/blank input, non-base64, non-JSON, or missing the two
 * string fields) so a tampered `state` degrades to a clean rejection, never a throw.
 */
export function decodeState(raw: string | null | undefined): ProcoreState | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(fromBase64Url(raw));
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { nonce?: unknown }).nonce === 'string' &&
      typeof (parsed as { returnTo?: unknown }).returnTo === 'string'
    ) {
      const { nonce, returnTo } = parsed as { nonce: string; returnTo: string };
      return { nonce, returnTo };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * True only for a safe in-app redirect target: an absolute path on our own origin.
 * Rejects anything that could send the user off-site — a protocol-relative `//host`,
 * a backslash trick (`/\host`, browsers normalize `\`→`/`), an embedded scheme
 * (`https://…`, `javascript:…`), or a bare/relative path with no leading slash.
 */
export function isSafeReturnPath(path: string | null | undefined): boolean {
  if (!path || typeof path !== 'string') return false;
  if (!path.startsWith('/')) return false;   // must be an absolute in-app path
  if (path.startsWith('//')) return false;   // protocol-relative → external host
  if (path.includes('\\')) return false;     // backslash → external host after normalization
  if (path.includes('://')) return false;    // embedded scheme
  return true;
}
