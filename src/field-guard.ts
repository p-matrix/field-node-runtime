// =============================================================================
// @pmatrix/field-node-runtime — field-guard.ts
// 4.0 Field Mode Activation Guard
//
// 3-condition AND gate for CLI Monitor 4.0 activation:
//   1. PMATRIX_FIELD_ID env var set (required)
//   2. PMATRIX_FIELD_NODE_ID env var set (required)
//   3. MCP server running (architectural — if guard runs in MCP, MCP is running)
//
// Usage:
//   if (isField4Enabled()) {
//     const config = buildFieldConfigFromEnv(serverUrl, apiKey);
//     if (config) { const node = new FieldNode(config); node.start(); }
//   }
//
// References:
//   - Phase 6 개발자 지시서 TASK 6-6
//   - 개발기획서 v1.3 결정 6: 활성화 가드
// =============================================================================

import type { PartialFieldNodeConfig } from './types.js';

/**
 * Check if 4.0 Field mode is enabled.
 * Returns true only when both PMATRIX_FIELD_ID and PMATRIX_FIELD_NODE_ID
 * environment variables are set to non-empty values.
 */
export function isField4Enabled(): boolean {
  const fieldId = process.env['PMATRIX_FIELD_ID'];
  const nodeId = process.env['PMATRIX_FIELD_NODE_ID'];
  return !!(fieldId && fieldId.length > 0 && nodeId && nodeId.length > 0);
}

/**
 * Build FieldNodeConfig from environment variables.
 *
 * Env var → config mapping:
 *   serverUrl param      → serverApiUrl (as-is)
 *   serverUrl https→wss  → serverWsUrl (protocol swap)
 *   PMATRIX_FIELD_ID     → fieldId
 *   PMATRIX_FIELD_NODE_ID → nodeId
 *   PMATRIX_POLICY_DIGEST → policyDigest (optional, default "")
 *   PMATRIX_FIELD_WS_URL  → serverWsUrl override (optional)
 *   fieldModeEnabled      → true (always, since guard passed)
 *
 * @returns PartialFieldNodeConfig if guard passes, null otherwise
 */
export function buildFieldConfigFromEnv(
  serverUrl: string,
  apiKey: string,
): PartialFieldNodeConfig | null {
  if (!isField4Enabled()) return null;

  const fieldId = process.env['PMATRIX_FIELD_ID']!;
  const nodeId = process.env['PMATRIX_FIELD_NODE_ID']!;
  const policyDigest = process.env['PMATRIX_POLICY_DIGEST'] ?? '';

  // serverWsUrl: explicit env var or auto-convert https→wss, http→ws
  const wsUrl =
    process.env['PMATRIX_FIELD_WS_URL'] ||
    serverUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');

  return {
    serverApiUrl: serverUrl,
    serverWsUrl: wsUrl,
    apiKey,
    fieldId,
    nodeId,
    policyDigest,
    fieldModeEnabled: true,
  };
}
