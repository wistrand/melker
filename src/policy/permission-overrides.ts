// Permission override utilities for CLI flags
// Merges --allow-* and --deny-* flags with policy permissions

import type { PolicyPermissions } from './types.ts';
import type { MelkerConfig } from '../config/config.ts';
import {
  AI_NET_HOSTS,
  getAvailableAICommands,
  getAvailableClipboardCommands,
  getAvailableKeyringCommands,
  getBrowserCommand,
} from './flags.ts';

// Array permission keys
const ARRAY_PERMISSIONS = ['read', 'write', 'net', 'run', 'env', 'ffi', 'sys'] as const;
// Boolean permission keys
const BOOLEAN_PERMISSIONS = ['all', 'ai', 'clipboard', 'keyring', 'browser', 'shader'] as const;

/**
 * Expand shortcut permissions (ai, clipboard, keyring, browser) into their component permissions.
 * This mirrors the expansion logic in policyToDenoFlags but operates on PolicyPermissions.
 */
function expandShortcuts(permissions: PolicyPermissions): PolicyPermissions {
  const p = { ...permissions };

  // Expand "ai" shortcut
  if (p.ai === true) {
    if (!p.run) p.run = [];
    for (const cmd of getAvailableAICommands()) {
      if (!p.run.includes(cmd)) p.run.push(cmd);
    }
    if (!p.net) p.net = [];
    for (const host of AI_NET_HOSTS) {
      if (!p.net.includes(host)) p.net.push(host);
    }
  }

  // Expand "clipboard" shortcut
  if (p.clipboard === true) {
    if (!p.run) p.run = [];
    for (const cmd of getAvailableClipboardCommands()) {
      if (!p.run.includes(cmd)) p.run.push(cmd);
    }
  }

  // Expand "keyring" shortcut
  if (p.keyring === true) {
    if (!p.run) p.run = [];
    for (const cmd of getAvailableKeyringCommands()) {
      if (!p.run.includes(cmd)) p.run.push(cmd);
    }
  }

  // Expand "browser" shortcut
  if (p.browser === true) {
    if (!p.run) p.run = [];
    const browserCmd = getBrowserCommand();
    if (!p.run.includes(browserCmd)) p.run.push(browserCmd);
  }

  return p;
}

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

  // Expand shortcuts before applying denies so that deny can filter expanded permissions
  const expanded = expandShortcuts(result);
  // Copy expanded arrays back to result
  if (expanded.run) result.run = expanded.run;
  if (expanded.net) result.net = expanded.net;
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
