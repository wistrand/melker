# Plan: Signing .melker Files with Policy Tags

## Overview

A cryptographic signing system to verify that .melker files (especially those with `<policy>` tags) haven't been tampered with and come from trusted sources.

---

## 1. Signature Format Options

### Option A: Embedded Signature Tag
```xml
<melker>
  <policy>{"permissions": {"read": ["."]}}</policy>
  <signature algorithm="ed25519" keyid="abc123">
    base64-encoded-signature-here
  </signature>
  <!-- UI content -->
</melker>
```

**Pros**: Self-contained, single file distribution
**Cons**: Signature must exclude itself during verification (complexity)

### Option B: Detached Signature File
```
app.melker
app.melker.sig   (or app.melker.signature.json)
```

**Signature file format:**
```json
{
  "algorithm": "ed25519",
  "keyId": "abc123",
  "publicKey": "base64-public-key",
  "signature": "base64-signature",
  "timestamp": "2026-01-02T12:00:00Z",
  "fileHash": "sha256:abc..."
}
```

**Pros**: Simpler verification, file content unchanged
**Cons**: Two files to distribute

### Recommendation: Support Both
- Embedded for distribution (single file)
- Detached for development/CI workflows

---

## 2. Cryptographic Approach

### Algorithm: Ed25519
- Modern elliptic curve signature scheme
- Small keys (32 bytes) and signatures (64 bytes)
- Fast verification
- Available in Deno's Web Crypto API

### What Gets Signed
- **Entire file content** (excluding `<signature>` tag if embedded)
- Alternatively: Hash of file + metadata (timestamp, version)

### Key Format
```json
{
  "keyId": "sha256-fingerprint-first-16-chars",
  "algorithm": "ed25519",
  "publicKey": "base64-encoded",
  "created": "2026-01-02T00:00:00Z",
  "identity": "developer@example.com",
  "comment": "My signing key"
}
```

---

## 3. Trust Model Options

### Option A: Trust on First Use (TOFU)
- First run: prompt user to trust the key
- Store trusted keys in `~/.config/melker/trusted-keys/`
- Warn if key changes

### Option B: Explicit Key Trust
- User manually adds trusted keys
- `melker trust-key <keyfile>` or `melker trust-key <url>`
- More secure, less convenient

### Option C: Publisher Registry (Future)
- Central registry of verified publishers
- Similar to npm verified publishers
- Requires infrastructure

### Recommendation: Start with TOFU + Explicit Trust
- Default: TOFU with clear prompts
- Flag `--require-trusted-key` for strict mode
- Flag `--trust` to skip verification (existing flag)

---

## 4. CLI Commands

### Key Management
```bash
# Generate a new signing keypair
melker keygen --output ~/.config/melker/keys/mykey

# Creates:
#   mykey.private.json  (keep secret!)
#   mykey.public.json   (distribute)

# List trusted keys
melker keys --list

# Trust a public key
melker keys --trust path/to/key.public.json
melker keys --trust https://example.com/key.public.json

# Revoke trust
melker keys --revoke <keyid>
```

### Signing
```bash
# Sign a .melker file (creates embedded signature)
melker sign app.melker --key ~/.config/melker/keys/mykey.private.json

# Sign with detached signature
melker sign app.melker --key mykey.private.json --detached

# Verify a signature
melker verify app.melker
```

### Runtime Flags
```bash
# Normal run (TOFU behavior)
melker run app.melker

# Require signature from trusted key
melker run --require-signature app.melker

# Require signature, fail if missing
melker run --enforce-signature app.melker

# Skip signature verification (existing --trust flag)
melker run --trust app.melker
```

---

## 5. Verification Behavior

| Scenario | Default | --require-signature | --enforce-signature |
|----------|---------|---------------------|---------------------|
| No signature | Run | Run with warning | Fail |
| Valid signature, unknown key | TOFU prompt | TOFU prompt | Fail |
| Valid signature, trusted key | Run | Run | Run |
| Invalid signature | Fail | Fail | Fail |
| Signature, file modified | Fail | Fail | Fail |

---

## 6. File Structure

```
src/
  signing/
    mod.ts           - Exports
    types.ts         - SigningKey, Signature, VerifyResult types
    keygen.ts        - Key generation using Web Crypto
    sign.ts          - File signing logic
    verify.ts        - Signature verification
    keystore.ts      - Trusted key storage (~/.config/melker/keys/)
    embedded.ts      - Parse/inject <signature> tag
    detached.ts      - Handle .sig files
```

---

## 7. Policy Interaction

### Signed Policy Benefits
- Users can trust policy declarations haven't been tampered with
- Publishers can attest to minimal permissions
- Enables "verified minimal permissions" badge/indicator

### Policy + Signature Workflow
```
1. Developer creates app.melker with <policy>
2. Developer signs: melker sign app.melker
3. User downloads app.melker
4. Runtime verifies signature before applying policy
5. If valid + trusted, run with declared permissions
6. If invalid, refuse to run (security breach attempt)
```

---

## 8. Implementation Phases

### Phase 1: Core Signing
- Key generation (Ed25519)
- File signing (detached first, simpler)
- Signature verification
- Basic keystore

### Phase 2: Embedded Signatures
- `<signature>` tag parsing
- Sign-and-embed workflow
- Exclude signature during verification

### Phase 3: Trust Management
- TOFU implementation
- Trust prompts in terminal
- Key revocation

### Phase 4: Enhanced Features
- Timestamp verification
- Key expiration
- Multiple signatures (countersigning)
- URL-based key fetching

---

## 9. Security Considerations

1. **Private key protection**: Warn if key file has loose permissions
2. **Key rotation**: Support multiple keys, graceful deprecation
3. **Replay attacks**: Include timestamp, consider nonces for URLs
4. **Hash algorithm**: Use SHA-256 minimum
5. **Signature stripping**: Detect if `<signature>` was removed (hash mismatch)

---

## 10. Example Flow

```
$ melker sign examples/oauth_demo.melker --key ~/.config/melker/keys/dev.private.json
Signed examples/oauth_demo.melker
  Key ID: a1b2c3d4
  Algorithm: ed25519
  Signature embedded in <signature> tag

$ melker run examples/oauth_demo.melker
Verifying signature...
  Signed by: developer@example.com (a1b2c3d4)
  Key not in trusted keys.

  Trust this key? [y/N/always]: always

  Key a1b2c3d4 added to trusted keys.

Running with policy permissions:
  read: ["."]
  net: ["api.example.com", "localhost"]
  browser: true
```

---

This approach provides security without sacrificing usability, and can be implemented incrementally.
