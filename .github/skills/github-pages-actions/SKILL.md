---
name: github-pages-actions
description: Build and deploy a static site to GitHub Pages with GitHub Actions. Use for CI/CD, base paths and deployment troubleshooting.
---

# GitHub Pages + Actions

- Repo Settings → Pages → Source: **GitHub Actions**.
- Workflow `.github/workflows/deploy.yml`: on push to `main` (+ `pull_request` for CI only) → checkout, setup-node (with npm cache), `npm ci`, lint, typecheck, test, build, `actions/upload-pages-artifact`, then a `deploy` job using `actions/deploy-pages` with `permissions: pages: write, id-token: write` and `environment: github-pages`.
- Project site URL is `https://bjornpijpops.github.io/tutoring/` → set the bundler `base` to `/tutoring/`.
- SPA routing: hash routing or copy `index.html` to `404.html`.
- Build-time config via repo Variables/Secrets (`vars.*`); only public values are bundled.
- Pin action versions; use least-privilege `permissions`; add `concurrency` group for deploys.
- Add the Pages URL to OAuth allowed origins/redirect URIs of the auth provider.
