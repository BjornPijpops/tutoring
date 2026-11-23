---
name: static-site-auth-backend
description: Patterns for authentication, authorization and data on a static GitHub Pages site using managed backends. Use for login, access approval, roles and data security rules.
---

# Static site + auth/backend

GitHub Pages serves only static files, so there is no trusted server code. Therefore:

- Use a managed identity/data service supporting **Google and Microsoft** sign-in (e.g. Firebase Auth + Firestore, Supabase, or Entra/Google OIDC + serverless API). Pick and justify via ADR.
- **Authorization lives server-side** (database security rules / row-level security). Client checks are UX only.
- Access flow: sign in → record `AccessRequest(pending)` → tutor approves → role `tutee` granted → calendar readable. Unapproved users can read nothing but their own request.
- Tutor identity is a fixed allow-listed account/claim; tutees can never self-assign roles.
- Public client config (API keys/app IDs) may ship in the bundle; secrets never. Restrict allowed domains/redirect URIs to the Pages URL and localhost.
- Hide provider specifics behind an `AuthProvider` interface and repositories.
- Prevent double-booking with transactional/atomic writes server-side.
- Minimise stored PII (name, email, provider id); provide a deletion path.
- Handle SPA routing on Pages (hash routing or 404.html fallback) and the repo base path.
