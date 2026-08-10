# Incident Response Plan

## 1. Purpose

This document describes how we identify, respond to, and recover from security incidents affecting Beaver Notes.

## 2. Scope

This plan covers:

- Security vulnerabilities discovered in Beaver Notes
- Vulnerability reports from security researchers
- Integrity issues with releases or code signing

## 3. Incident Classification

### Severity Levels

| Level | Description | Response Time | Examples |
|-------|-------------|---------------|----------|
| Critical | Remote code execution, encryption bypass, key compromise | Immediate | RCE vulnerability, key extraction, auth bypass |
| High | Privilege escalation, data exposure, integrity attack | 24 hours | Local privilege escalation, note decryption without authorization |
| Medium | Limited impact vulnerability | 72 hours | XSS in editor, local file access beyond sandbox |
| Low | Minor issue, no immediate risk | 1 week | Information disclosure, missing security header |

## 4. Response Procedures

### Phase 1: Detection and Assessment (0-24 hours)

1. Identify the incident via security reports ([danielerolli@beavernotes.com](mailto:danielerolli@beavernotes.com)), GitHub issue reports, or dependency vulnerability alerts.
2. Assess severity: determine if user data is affected, assess exploitation difficulty, classify severity level.

### Phase 2: Containment (0-48 hours)

If a vulnerability is confirmed, prepare a fix. If a release is compromised, issue a warning via GitHub. If encryption is affected, notify users to rotate keys. Acknowledge the report within 72 hours and provide a timeline for the fix.

### Phase 3: Remediation (1-2 weeks)

Write the patch, test it thoroughly, and conduct a security review. Publish the patched version, update release notes with the security fix, and tag the security fix commit.

### Phase 4: Post-Incident Review

Document what happened, identify preventive measures, and update this plan if needed.

## 5. Vulnerability Disclosure Policy

### Scope

In scope: Beaver Notes desktop application, Beaver Notes mobile application (when released), build and release infrastructure.

Out of scope: third-party services, social engineering, issues requiring physical access to the user's device.

### Disclosure Timeline

1. Report received: acknowledgment within 72 hours
2. Assessment: initial severity assessment within 7 days
3. Fix developed: security fix developed and tested
4. Disclosure: coordinated disclosure after fix is available

### Safe Harbor

We support responsible disclosure and will not pursue legal action against security researchers who:

- Make a good faith effort to avoid privacy violations and data destruction
- Only interact with accounts you own or with explicit permission of the account holder
- Do not exploit a vulnerability beyond what is necessary to confirm its existence
- Report vulnerabilities promptly

## 6. Contact

| Contact | Details |
|---------|---------|
| Security Reports | [danielerolli@beavernotes.com](mailto:danielerolli@beavernotes.com) |

## 7. Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | August 8, 2026 | Beaver | Initial version |
