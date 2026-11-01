# Security Specification: Workshop Bus Boarding WebApp

## 1. Data Invariants
1. **People**: Participant entries require valid `id`, non-empty `name` (Korean, max 50 chars), `dept`, and `out` and `back` bus numbers in `{1, 2}`.
2. **Records**: Boarding records (`records/{recordId}`) require document ID matching `^[a-zA-Z0-9_-]+$`, `phase` in `['출발', '귀가']`, `status` in `['미탑승', '탑승', '불참', '개별이동']`, valid timestamp string `at`, and `by` in `['본인', '관리자', '관리자 초기화']`.
3. **Settings**: Phase/Bus settings (`settings/{phase_bus}`) must have valid `phase`, `bus` in `{1, 2}`, boolean `closed`, boolean `final`.
4. **Contacts**: Bus manager contacts require `bus` in `{1, 2}`, non-empty `name` and `phone`.
5. **Logs**: Append-only audit entries recording actor, action, timestamp, and details.
6. **Admin Isolation**: Admin password hashes and sensitive operational secrets are protected and validated server-side.

## 2. The "Dirty Dozen" Payloads (Attacks that MUST return PERMISSION_DENIED)
1. **Ghost Field on Person**: Injecting `{ id: "001", name: "홍길동", dept: "학교", out: 1, back: 1, isSuperAdmin: true }`
2. **Invalid Bus ID**: Setting `out: 99` or `back: -1`
3. **Record Status Poisoning**: Setting status to `"승인됨"` instead of allowed enum `['미탑승', '탑승', '불참', '개별이동']`
4. **Record Oversized Text**: Sending 100KB payload into `by` or `id`
5. **Junk Document ID**: Injecting path `/records/bad%20id!@#$`
6. **Setting Corrupt Phase**: Writing `phase: "점심"` into settings
7. **Setting Non-Boolean Closed**: Writing `closed: "no"` instead of boolean
8. **Contact Invalid Bus Number**: Setting `bus: 5`
9. **Log Identity Spoofing**: Attempting to overwrite existing immutable audit log
10. **Arbitrary Collection Write**: Attempting to write into `/admin_credentials/keys`
11. **Malicious Script Injection**: Storing `<script>alert(1)</script>` in `name` exceeding bounds
12. **Blanket Modification**: Attempting batch delete of root documents without validation

## 3. Test Runner Design
Validation helpers enforce `hasOnly()` keys, string length bounds, enum matching, and type safety across all collections.
