# Spec 05 — Registry

> **Status:** 🔨 Stub — content being ported.

The Registry hosts, indexes, and distributes Knowledge Packs.

## Public vs private

- **Public Registry** — like npmjs.com but for Knowledge Packs. Search, version history, downloads, quality scoring, official certification.
- **Private Registry (enterprise)** — private packs, team/org permissions, SSO, approval flows, audit logs, sensitive-info scanning, mirror sync.

## Quality scoring (sketch)

| Signal | Weight |
|---|---|
| Metadata completeness | 10% |
| Practice completeness | 20% |
| Decision-graph quality | 20% |
| Examples quality | 15% |
| Anti-pattern coverage | 15% |
| Community feedback | 10% |
| Maintenance cadence | 10% |

## Security

- Sensitive-info scan before publish
- `visibility` field required (public/private)
- Approval flow for enterprise packs
- Version yank/deprecate mechanism

<!-- TODO: port full publish flow, permission model, security mechanisms from private spec. -->
