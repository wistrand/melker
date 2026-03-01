// Permission override utilities for CLI flags
// Merges --allow-* and --deny-* flags with policy permissions

import type { PolicyPermissions } from './types.ts';
import type { MelkerConfigCore as MelkerConfig } from '../config/config-core.ts';
import { expandShortcutsInPlace } from './shortcut-utils.ts';

// Array permission keys
const ARRAY_PERMISSIONS = ['read', 'write', 'net', 'run', 'env', 'ffi', 'sys'] as const;
// Boolean permission keys
const BOOLEAN_PERMISSIONS = ['all', 'ai', 'clipboard', 'keyring', 'browser', 'shader'] as const;

export interface PermissionOverrides {
  allow: Partial<PolicyPermissions>;
  deny: Partial<PolicyPermissions>;
}

export interface AppliedPermissions {
  permissions: PolicyPermissions;
  /** Deny values that should become --deny-X flags (when base has wildcard) */
  activeDenies: Partial<PolicyPermissions>;
}

/**
 * Normalize a config value to an array of strings.
 * CLI flags may be stored as a single string (possibly comma-separated) or as an array.
 */
function normalizeToArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    // Flatten any comma-separated values within the array
    const result = value.flatMap(v => typeof v === 'string' ? v.split(',') : v).filter(Boolean);
    return result.length > 0 ? result : undefined;
  }
  if (typeof value === 'string' && value.length > 0) {
    // Split comma-separated values
    const result = value.split(',').filter(Boolean);
    return result.length > 0 ? result : undefined;
  }
  return undefined;
}

/**
 * Extract permission overrides from config
 */
export function getPermissionOverrides(config: MelkerConfig): PermissionOverrides {
  const allow: Partial<PolicyPermissions> = {};
  const deny: Partial<PolicyPermissions> = {};

  // Extract array permissions
  for (const key of ARRAY_PERMISSIONS) {
    const allowValue = normalizeToArray(config.getValue(`allow.${key}`));
    const denyValue = normalizeToArray(config.getValue(`deny.${key}`));
    if (allowValue) allow[key] = allowValue;
    if (denyValue) deny[key] = denyValue;
  }

  // Extract boolean permissions
  for (const key of BOOLEAN_PERMISSIONS) {
    const allowValue = config.getValue(`allow.${key}`) as boolean | undefined;
    const denyValue = config.getValue(`deny.${key}`) as boolean | undefined;
    if (allowValue === true) (allow as Record<string, boolean>)[key] = true;
    if (denyValue === true) (deny as Record<string, boolean>)[key] = true;
  }

  return { allow, deny };
}

/**
 * Check if any overrides are present
 */
export function hasOverrides(overrides: PermissionOverrides): boolean {
  return Object.keys(overrides.allow).length > 0 || Object.keys(overrides.deny).length > 0;
}

/**
 * Apply permission overrides to policy permissions
 * Result = (base + allow) - deny
 * When base has wildcard (*), deny values become active denies (--deny-X flags)
 */
export function applyPermissionOverrides(
  base: PolicyPermissions | undefined,
  overrides: PermissionOverrides
): AppliedPermissions {
  const result: PolicyPermissions = { ...base };
  const activeDenies: Partial<PolicyPermissions> = {};

  // Validate array permission fields — catch e.g. "env": true instead of "env": ["*"]
  for (const key of ARRAY_PERMISSIONS) {
    const value = (result as Record<string, unknown>)[key];
    if (value !== undefined && !Array.isArray(value)) {
      throw new Error(
        `Invalid policy: "permissions.${key}" must be a string array, got ${typeof value} (${JSON.stringify(value)}).\n` +
        `  Use "${key}": ["*"] for unrestricted access, or "${key}": ["value1", "value2"] for specific values.`
      );
    }
  }

  // Handle deny.all first - clears everything
  if (overrides.deny.all) {
    return { permissions: {}, activeDenies: {} };
  }

  // Handle allow.all
  if (overrides.allow.all) {
    result.all = true;
  }

  // Apply array permission allows (merge)
  for (const key of ARRAY_PERMISSIONS) {
    const allowValues = overrides.allow[key] as string[] | undefined;
    if (allowValues?.length) {
      const existing = (result[key] as string[] | undefined) || [];
      // Skip if already has wildcard - adding specific values is redundant
      if (existing.includes('*')) continue;
      result[key] = [...new Set([...existing, ...allowValues])];
    }
  }

  // Apply boolean permission allows
  for (const key of BOOLEAN_PERMISSIONS) {
    if ((overrides.allow as Record<string, boolean>)[key] === true) {
      (result as Record<string, boolean>)[key] = true;
    }
  }

  // Handle shortcut denies BEFORE expansion - if denying a shortcut, don't expand it.
  // Preserve only non-denied shortcuts, then expand and clear the flags so
  // policyToDenoFlags doesn't expand them again.
  const effectiveAi = result.ai === true && !overrides.deny.ai;
  const effectiveClipboard = result.clipboard === true && !overrides.deny.clipboard;
  const effectiveKeyring = result.keyring === true && !overrides.deny.keyring;
  const effectiveBrowser = result.browser === true && !overrides.deny.browser;

  // Set only effective shortcuts for expansion
  result.ai = effectiveAi || undefined;
  result.clipboard = effectiveClipboard || undefined;
  result.keyring = effectiveKeyring || undefined;
  result.browser = effectiveBrowser || undefined;

  // Expand non-denied shortcuts into run/net arrays.
  // skipWildcard=false: always add commands since wildcards may be filtered by deny processing
  expandShortcutsInPlace(result, false);

  // Clear shortcut flags so policyToDenoFlags doesn't expand them again
  delete result.ai;
  delete result.clipboard;
  delete result.keyring;
  delete result.browser;

  // Apply array permission denies (filter out, or track as active denies for wildcards)
  for (const key of ARRAY_PERMISSIONS) {
    const denyValues = overrides.deny[key] as string[] | undefined;
    if (denyValues?.length && result[key]) {
      const existing = result[key] as string[];
      if (existing.includes('*')) {
        // Can't filter from wildcard - track as active deny for --deny-X flag
        activeDenies[key] = denyValues;
      } else {
        const denySet = new Set(denyValues);
        result[key] = existing.filter(v => !denySet.has(v));
        if ((result[key] as string[]).length === 0) {
          delete result[key];
        }
      }
    }
  }

  // Apply boolean permission denies
  // If 'all' is set and we're denying specific boolean permissions,
  // we need to expand 'all' into explicit permissions (minus the denied ones)
  const hasBooleanDenies = BOOLEAN_PERMISSIONS.some(
    key => (overrides.deny as Record<string, boolean>)[key] === true
  );

  if (result.all && hasBooleanDenies) {
    // Expand 'all' into explicit permissions for all boolean types that aren't denied
    delete result.all;
    for (const key of BOOLEAN_PERMISSIONS) {
      if (key === 'all') continue; // skip 'all' itself
      if ((overrides.deny as Record<string, boolean>)[key] !== true) {
        (result as Record<string, boolean>)[key] = true;
      }
    }
    // Also expand 'all' for array permissions to wildcard
    for (const key of ARRAY_PERMISSIONS) {
      if (!result[key] || (result[key] as string[]).length === 0) {
        result[key] = ['*'];
      }
    }
  } else {
    // No 'all' expansion needed, just delete denied boolean permissions
    for (const key of BOOLEAN_PERMISSIONS) {
      if ((overrides.deny as Record<string, boolean>)[key] === true) {
        delete (result as Record<string, boolean | undefined>)[key];
      }
    }
  }

  return { permissions: result, activeDenies };
}
