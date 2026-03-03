// Base64 encoding (replaces jsr:@std/encoding/base64)
// Only receives Uint8Array inputs (verified across all 4 call sites)
export function encodeBase64(data: Uint8Array): string {
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// JWT decode (replaces jsr:@zaubrik/djwt)
// Used in src/oauth/jwt.ts only. Returns [header, payload, signature].
function base64urlDecode(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  return atob(padded);
}
export function decodeJwt(
  token: string,
): [Record<string, unknown>, Record<string, unknown>, Uint8Array] {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT');
  const header = JSON.parse(base64urlDecode(parts[0]));
  const payload = JSON.parse(base64urlDecode(parts[1]));
  const sig = Uint8Array.from(
    atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')),
    (c) => c.charCodeAt(0),
  );
  return [header, payload, sig];
}
