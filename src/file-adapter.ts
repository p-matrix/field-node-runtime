// =============================================================================
// @pmatrix/field-node-runtime — file-adapter.ts
// File-based IPC for transient hook ↔ persistent MCP communication
//
// Design:
//   - Unidirectional: hooks WRITE, MCP READS (no bidirectional contention)
//   - Sync I/O only (hooks are short-lived processes)
//   - Atomic write: write to temp file then rename
//   - Fail-open: any I/O error → return null / silently swallow, never throw
//   - File path: ~/.pmatrix/sessions/field-{sessionKey}.json
//
// Pattern source: claude-code-monitor/src/state-store.ts:162-176
//
// References:
//   - Phase 6 개발자 지시서 TASK 6-1
//   - 개발기획서 v1.3 §4 (IPC Adapter)
// =============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─── FieldState Interface ────────────────────────────────────────────────────

/**
 * IPC state written by hooks, read by MCP poller.
 * Partial writes are merged with existing state on disk.
 */
export interface FieldState {
  axes?: {
    baseline: number;
    norm: number;
    stability: number;
    meta_control: number;
  };
  currentRt?: number;
  currentMode?: string;
  totalTurns?: number;
  policyDigest?: string;
  updatedAt: string;
}

// ─── Path Helpers ────────────────────────────────────────────────────────────

function sessionsDir(): string {
  return path.join(os.homedir(), '.pmatrix', 'sessions');
}

/**
 * Sanitize session key for safe filesystem use.
 * Replace non-alphanumeric/dash/underscore chars with underscore.
 */
function safeKey(sessionKey: string): string {
  return sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function fieldStateFilePath(sessionKey: string): string {
  return path.join(sessionsDir(), `field-${safeKey(sessionKey)}.json`);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Write partial field state to disk (read-merge-atomic write).
 *
 * Hooks call this after each axis update. Only the provided fields
 * are merged on top of existing state. updatedAt is always set.
 *
 * Fail-open: errors silently swallowed.
 */
export function writeFieldState(
  sessionKey: string,
  partial: Partial<FieldState>,
): void {
  try {
    const dir = sessionsDir();
    fs.mkdirSync(dir, { recursive: true });

    const filepath = fieldStateFilePath(sessionKey);

    // Read existing state for merge
    let existing: FieldState | null = null;
    try {
      const raw = fs.readFileSync(filepath, 'utf-8');
      existing = JSON.parse(raw) as FieldState;
    } catch {
      // No existing file or corrupt — start fresh
    }

    // Merge: spread existing, then partial on top
    const merged: FieldState = {
      ...(existing ?? {}),
      ...partial,
      updatedAt: new Date().toISOString(),
    };

    // Merge axes deeply (partial.axes may have subset of fields)
    if (partial.axes && existing?.axes) {
      merged.axes = { ...existing.axes, ...partial.axes };
    }

    // Atomic write: temp file → rename
    const tmpPath = `${filepath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(merged, null, 2), 'utf-8');
    try {
      fs.renameSync(tmpPath, filepath);
    } catch {
      // Rename failed — clean up orphaned .tmp file
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  } catch {
    // Fail-open: field state write failure must not block hook response
  }
}

/**
 * Read field state from disk.
 *
 * MCP poller calls this periodically to check for hook updates.
 *
 * Fail-open: returns null on any error.
 */
export function readFieldState(sessionKey: string): FieldState | null {
  try {
    const filepath = fieldStateFilePath(sessionKey);
    const raw = fs.readFileSync(filepath, 'utf-8');
    return JSON.parse(raw) as FieldState;
  } catch {
    return null;
  }
}

/**
 * Delete field state file (called on session end).
 *
 * Fail-open: errors silently ignored.
 */
export function deleteFieldState(sessionKey: string): void {
  try {
    const filepath = fieldStateFilePath(sessionKey);
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }
  } catch {
    // ignore
  }
}

/**
 * Get the sessions directory path (for glob-based session discovery).
 * MCP poller uses this to find field-*.json files.
 */
export function getFieldSessionsDir(): string {
  return sessionsDir();
}
