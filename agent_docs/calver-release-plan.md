# CalVer Release Plan

## Overview

Melker uses Calendar Versioning (CalVer) for releases. Releases are **git tags only** - no GitHub releases, changelogs, or package publishing.

## Version Format

```
YYYY.MM.PATCH
```

- `YYYY` - Four-digit year (2025, 2026, ...)
- `MM` - Two-digit month (01-12)
- `PATCH` - Incrementing number within the month, starting at 1

**Examples:**
- `2026.01.1` - First release in January 2026
- `2026.01.2` - Second release in January 2026
- `2026.02.1` - First release in February 2026

## Tagging Convention

Tags use the `v` prefix:

```
v2026.01.1
v2026.01.2
v2026.02.1
```

## Creating a Release

```bash
# Determine next version
git tag --list 'v2026.01.*' | sort -V | tail -1

# Create annotated tag (example: first release of Jan 2026)
git tag -a v2026.01.1 -m "v2026.01.1"

# Push tag
git push origin v2026.01.1
```

Annotated tags (`-a`) store tagger identity, date, and message - preferred over lightweight tags.

## Version Query Commands

```bash
# List all releases
git tag --list 'v*' | sort -V

# List releases for current month
git tag --list "v$(date +%Y.%m).*" | sort -V

# Get latest release
git tag --list 'v*' | sort -V | tail -1

# Get latest release for a specific year
git tag --list 'v2026.*' | sort -V | tail -1
```

## Rationale

- **Year.Month** provides temporal context without SemVer's implied compatibility promises
- **Patch number** allows multiple releases per month
- **Tags only** keeps releases lightweight - no ceremony, no artifacts
- **v prefix** is conventional and distinguishes version tags from other tags

## Migration from Current Scheme

Current commits use incrementing numbers (149, 148, ...). These are commit markers, not releases. The CalVer scheme starts fresh for actual releases.

## What a Release Means

A tag marks a point-in-time snapshot. Users can:
- Reference specific versions in imports: `https://raw.githubusercontent.com/.../v2026.01.1/mod.ts`
- Clone at a specific version: `git checkout v2026.01.1`
- Compare changes between releases: `git diff v2026.01.1..v2026.01.2`
