// Policy module exports
// Allows apps to declare required permissions via embedded or external policy

export type {
  MelkerPolicy,
  PolicyPermissions,
  PolicyLoadResult,
  PolicyArgs,
  PolicyConfigProperty,
} from './types.ts';

export {
  loadPolicy,
  loadPolicyFromContent,
  hasPolicyTag,
  validatePolicy,
  formatPolicy,
} from './loader.ts';

export { policyToDenoFlags, formatDenoFlags } from './flags.ts';

export type { ApprovalRecord } from './approval.ts';

export {
  calculateApprovalHash,
  checkApproval,
  saveApproval,
  showApprovalPrompt,
  getApprovalFilePath,
  clearAllApprovals,
  revokeApproval,
  getApproval,
  checkLocalApproval,
  saveLocalApproval,
} from './approval.ts';
