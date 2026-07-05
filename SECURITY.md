# Security Policy

## Supported Versions

Lorelum is in active early development. Security fixes are applied to the latest `main` branch only — there are no stable release lines yet.

| Version | Supported |
|---------|-----------|
| `main`  | ✅        |
| tagged releases | ✅ |

## Reporting a Vulnerability

**Please do NOT report security vulnerabilities via public GitHub issues.**

Report them privately instead:

- 📧 Email: **security@lorelum.com**
- 🔒 Preferred: use [GitHub's private vulnerability reporting](https://github.com/lorelum/lorelum/security/advisories/new)

Include the following if possible:
- A description of the issue and its potential impact
- Steps to reproduce (PoC, screenshots, or logs)
- Affected versions / commits
- Suggested fix (optional)

### Response timeline

| Step | Target |
|------|--------|
| Acknowledge receipt | within 48 hours |
| Initial assessment | within 5 business days |
| Fix or mitigation | depends on severity; we'll coordinate disclosure with you |

We follow **coordinated disclosure**. Once a fix is released, we'll credit you in the advisory unless you prefer to remain anonymous.

## Scope

**In scope:**
- The Lorelum CLI (`lore`) and local engine in this repository
- Security issues caused by how Lorelum parses, stores, or retrieves knowledge packs
- Injection risks via malicious pack content

**Out of scope:**
- Vulnerabilities in third-party dependencies (report to the upstream maintainer)
- Issues in the SaaS platform / enterprise components (separate private repos)
- Social engineering, physical attacks, DoS

## Security design notes

Lorelum retrieves and injects third-party knowledge-pack content into AI context. Treat **any community pack like any other open-source dependency** — review it before installing, just as you would a npm package. The registry will ship quality scoring and sensitive-info scanning, but human review is the final gate.
