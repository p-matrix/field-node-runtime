# @pmatrix/field-node-runtime

P-MATRIX 4.0 Field Node Runtime — State Vector exchange, peer verification, local decision and enforcement for CLI Monitor integration.

> Internal dependency — automatically installed with `@pmatrix/openclaw-monitor`, `@pmatrix/claude-code-monitor`, `@pmatrix/cursor-monitor`, `@pmatrix/gemini-cli-monitor`.

---

## Architecture

### 4-Stage Chain

1. **Exchange** — Peer-to-peer State Vector sharing via WebSocket
2. **Verify** — Policy digest, freshness, integrity, risk sanity
3. **Decide** — Posture determination (maintain/caution/restrict/reject)
4. **PEP** — Policy Enforcement Point (callback-only, non-executive)

### State Vector (5 elements)

- `risk_info` — R(t) + 4-axis breakdown
- `lifecycle_info` — loop count, current mode
- `freshness_evidence` — timestamp, TTL
- `integrity_evidence` — SHA-256 signature
- `policy_digest` — sha256:\<hex\> policy hash

### R(t) Formula

```
R(t) = 1 - (BASELINE + NORM + (1 - STABILITY) + META_CONTROL) / 4
```

> stability is inverted: higher stability = more drift = higher risk

### Modules

| Module | Purpose |
|--------|---------|
| state-vector-builder | SV construction + R(t) computation |
| local-verifier | Peer SV verification |
| local-decider | Posture determination |
| local-pep | Callback-based policy enforcement |
| audit-emitter | Append-only audit events |
| peer-exchange-client | WS peer exchange |
| field-guard | 4.0 activation guard |
| file-adapter | IPC file adapter |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PMATRIX_FIELD_ID` | Yes (4.0) | Field identifier |
| `PMATRIX_FIELD_NODE_ID` | Yes (4.0) | Node identifier |
| `PMATRIX_FIELD_WS_URL` | No | WS endpoint override |

Both `PMATRIX_FIELD_ID` and `PMATRIX_FIELD_NODE_ID` must be set to activate 4.0 mode.

## License

Apache-2.0 — see [LICENSE](LICENSE)
