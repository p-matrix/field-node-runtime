# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.2.x   | Yes       |
| < 0.2   | No        |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub Issues.**

If you discover a security vulnerability in `@pmatrix/field-node-runtime`, please report it by emailing:

**architect@p-matrix.io**

Include the following in your report:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

You will receive a response within **72 hours**. We will keep you informed of the progress and notify you when the issue is resolved.

## Scope

This policy covers:
- The `@pmatrix/field-node-runtime` npm package
- State Vector exchange, peer verification, local decision and enforcement modules

## Out of Scope

- Vulnerabilities in the P-MATRIX server (report to architect@p-matrix.io separately)
- The content of agents monitored by consumer packages
- Third-party dependencies (report to the respective maintainers)

## Security Design Notes

`@pmatrix/field-node-runtime` is designed with **fail-open** principles:
- All IPC and network operations catch errors silently
- Audit events are append-only (no modification or deletion)
- SHA-256 integrity signatures prevent State Vector tampering
- No agent content (prompts, responses) is accessed or transmitted
