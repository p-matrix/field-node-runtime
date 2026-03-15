# Changelog

All notable changes to `@pmatrix/field-node-runtime` will be documented in this file.

---

## [0.2.0] — 2026-03-15

### Added

- **State Vector Builder** — R(t) = 1 - (B + N + (1-S) + M) / 4, SHA-256 integrity
- **Local Verifier** — policy digest, freshness, integrity, risk sanity 4종 검증
- **Local Decider** — posture 결정 (maintain/caution/restrict/reject)
- **Local PEP** — 비실행 원칙 (콜백 전용, 직접 격리/추방 금지)
- **Audit Emitter** — append-only 큐, 자동 field_id/node_id 주입, batch flush
- **Peer Exchange Client** — WS ticket auth + api_key fallback, 4단계 체인
- **Field Guard** — PMATRIX_FIELD_ID + PMATRIX_FIELD_NODE_ID 활성화 가드
- **File Adapter** — atomic write (tmp→rename), fail-open IPC
- degraded SV 지원 (neutral 0.5 axes + degraded: true flag)
- 테스트 5종 (builder, verifier, decider, pep, audit)

## [0.1.0] — 2026-03-15

### Added

- Initial internal release — 4.0 Field Node Runtime core
