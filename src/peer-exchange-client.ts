// =============================================================================
// @pmatrix/field-node-runtime — peer-exchange-client.ts
// 4.0 Protocol Stage 1: WebSocket State Vector 교환
//
// Connects to P-MATRIX server Field WebSocket endpoint.
// Sends own State Vector, receives peer State Vectors.
// Delegates to LocalVerifier (Stage 2) → LocalDecider (Stage 3) → LocalPEP (Stage 4).
//
// WS endpoint (Phase 2): WS /v1/fields/{field_id}/exchange
// Phase 1: connects but endpoint may redirect — graceful degradation.
//
// References:
//   - Field 개발기획서 v1.2 §4-2 (4단계 체인)
//   - Room WebSocket 인프라 재활용 (Phase 2 연결)
// =============================================================================

import WebSocket from 'ws';
import type {
  StateVector,
  VerificationResult,
  ModeTransition,
  PepResult,
  WsEnvelope,
} from './types.js';
import { verifyStateVector } from './local-verifier.js';
import { decide, applyFieldAdvisory } from './local-decider.js';
import { LocalPEP } from './local-pep.js';
import { AuditEmitter } from './audit-emitter.js';

// ─── Event callbacks ──────────────────────────────────────────────────────────

export interface PeerExchangeCallbacks {
  onPeerVerified?: (result: VerificationResult) => void;
  onTransition?: (transition: ModeTransition) => void;
  onEnforced?: (result: PepResult) => void;
  onConnected?: () => void;
  onDisconnected?: (code: number, reason: string) => void;
  onError?: (err: Error) => void;
}

export interface PeerExchangeClientOptions {
  wsUrl: string;                  // wss://api.pmatrix.io/v1/fields/{id}/exchange
  apiKey: string;
  nodeId: string;
  fieldId: string;
  localPolicyDigest: string;
  pep: LocalPEP;
  auditEmitter: AuditEmitter;
  deciderOptions?: { cautionThreshold?: number; restrictThreshold?: number };
  callbacks?: PeerExchangeCallbacks;
  reconnectDelayMs?: number;
  debug?: boolean;
}

// ─── PeerExchangeClient ───────────────────────────────────────────────────────

export class PeerExchangeClient {
  private ws: WebSocket | null = null;
  private connected = false;
  private destroyed = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private readonly opts: PeerExchangeClientOptions;
  private readonly _knownPeers = new Set<string>();

  constructor(opts: PeerExchangeClientOptions) {
    this.opts = opts;
  }

  /** Connect to Field WebSocket exchange endpoint.
   *  Step 1: POST /ws-ticket to get short-lived JWT ticket.
   *  Step 2: Connect WS with ?ticket= (no API key in URL). */
  connect(): void {
    if (this.destroyed) return;
    void this._connectWithTicket();
  }

  private async _connectWithTicket(): Promise<void> {
    try {
      // Derive REST base URL from WS URL (wss → https, strip /exchange path)
      const restBase = this.opts.wsUrl
        .replace(/^wss:/, 'https:')
        .replace(/^ws:/, 'http:')
        .replace(/\/exchange$/, '');

      const ticketUrl = `${restBase}/ws-ticket`;
      const res = await fetch(ticketUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.opts.apiKey}`,
        },
        body: JSON.stringify({
          node_id: this.opts.nodeId,
          agent_id: this.opts.fieldId, // agent_id sourced from field config
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        this.log(`ws-ticket request failed: HTTP ${res.status}`);
        this._scheduleReconnect();
        return;
      }

      const { ticket } = (await res.json()) as { ticket: string };
      const url = `${this.opts.wsUrl}?ticket=${encodeURIComponent(ticket)}`;
      this._connectWs(url);
    } catch (err) {
      // Fail-open: ticket endpoint may not exist yet — fall back to api_key
      // TODO(Phase 2): ticket 안정화 후 api_key URL fallback 제거 필수 (URL 쿼리 노출 위험)
      this.log('ws-ticket fetch failed, falling back to api_key:', err);
      const url = `${this.opts.wsUrl}?api_key=${encodeURIComponent(this.opts.apiKey)}&node_id=${encodeURIComponent(this.opts.nodeId)}`;
      this._connectWs(url);
    }
  }

  private _connectWs(url: string): void {
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      this.connected = true;
      this.log('connected to Field exchange');
      this.opts.callbacks?.onConnected?.();
    });

    this.ws.on('message', (data) => {
      try {
        const envelope = JSON.parse(data.toString()) as WsEnvelope;
        void this.handleEnvelope(envelope);
      } catch (err) {
        this.log('message parse error:', err);
      }
    });

    this.ws.on('close', (code, reason) => {
      this.connected = false;
      this._knownPeers.clear(); // C-3: reset peer tracking on disconnect
      const reasonStr = reason.toString();
      this.log(`disconnected: code=${code} reason=${reasonStr}`);
      this.opts.callbacks?.onDisconnected?.(code, reasonStr);
      this._scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      this.log('ws error:', err.message);
      this.opts.callbacks?.onError?.(err);
    });
  }

  private _scheduleReconnect(): void {
    if (!this.destroyed) {
      const delay = this.opts.reconnectDelayMs ?? 5000;
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    }
  }

  /** Send own State Vector to peers via server relay */
  sendStateVector(sv: StateVector): void {
    if (!this.connected || !this.ws) {
      this.log('not connected — SV send skipped');
      return;
    }

    const envelope: WsEnvelope = {
      type: 'state_vector',
      node_id: this.opts.nodeId,
      field_id: this.opts.fieldId,
      payload: sv,
      sent_at: new Date().toISOString(),
    };

    this.ws.send(JSON.stringify(envelope));
    this.opts.auditEmitter.emitExchange('*peers', sv); // Stage 1 audit
  }

  /** Disconnect and stop reconnecting */
  destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.ws?.close();
    this.ws = null;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  /** Number of known peers (tracked by verify-decide-enforce invocations) */
  get peerCount(): number {
    return this._knownPeers.size;
  }

  // ─── Internal message handling ──────────────────────────────────────────────

  private async handleEnvelope(envelope: WsEnvelope): Promise<void> {
    switch (envelope.type) {
      case 'state_vector': {
        // Received peer SV — run Stage 2 → 3 → 4 chain
        const peerSv = envelope.payload as StateVector;
        await this.runVerifyDecideEnforce(peerSv);
        break;
      }
      case 'field_advisory': {
        // Server advisory signal (field mode) — pass to LocalDecider
        const advisory = envelope.payload as { agent_id: string; advisory_action: string };
        const transition = applyFieldAdvisory(advisory.agent_id, advisory.advisory_action);
        this.opts.auditEmitter.emitDecide(transition);
        this.opts.callbacks?.onTransition?.(transition);

        const pepResult = await this.opts.pep.enforce(transition);
        this.opts.auditEmitter.emitEnforce(pepResult);
        this.opts.callbacks?.onEnforced?.(pepResult);
        break;
      }
      case 'ping':
        this.ws?.send(JSON.stringify({ type: 'pong', node_id: this.opts.nodeId, field_id: this.opts.fieldId, payload: {}, sent_at: new Date().toISOString() }));
        break;
      default:
        this.log('unknown envelope type:', envelope.type);
    }
  }

  private async runVerifyDecideEnforce(peerSv: StateVector): Promise<void> {
    // Track known peers for peerCount
    this._knownPeers.add(peerSv.integrity_evidence.node_id);

    // Stage 2: Verify
    const verifyResult = verifyStateVector(peerSv, {
      localPolicyDigest: this.opts.localPolicyDigest,
    });
    this.opts.auditEmitter.emitVerify(verifyResult);
    this.opts.callbacks?.onPeerVerified?.(verifyResult);

    // Stage 3: Decide
    const transition = decide(verifyResult, this.opts.deciderOptions);
    this.opts.auditEmitter.emitDecide(transition);
    this.opts.callbacks?.onTransition?.(transition);

    // Stage 4: Enforce
    const pepResult = await this.opts.pep.enforce(transition);
    this.opts.auditEmitter.emitEnforce(pepResult);
    this.opts.callbacks?.onEnforced?.(pepResult);
  }

  private log(...args: unknown[]): void {
    if (this.opts.debug) {
      console.error('[PeerExchangeClient]', ...args);
    }
  }
}
