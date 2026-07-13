# Releasing packages

Releases use the two-phase Changesets workflow on `main`.

1. Feature PRs add or update files in `.changeset/`.
2. A push to `main` runs build and the installed-consumer smoke.
3. `changesets/action` updates `changeset-release/main` and opens/updates the version PR.
4. Merging that version PR runs the workflow again; with no pending changesets, the action calls
   `npm run release` and creates GitHub releases for newly published package versions.

The package manifests set `publishConfig.access: public` and `publishConfig.provenance: true`.
The workflow grants only the release job `id-token: write`, allowing npm to attach GitHub Actions
provenance to published artifacts.

Unreleased workspaces remain `private: true` even when they already have a package skeleton.
Changesets publish scans all non-private workspaces, not only names listed by the current release
plan. Remove `private` from a package only in the PR that prepares its first public release.

## Repository prerequisites

- Add an npm automation/granular access token as the repository secret `NPM_TOKEN`. The workflow
  maps it to both `NPM_TOKEN` and `NODE_AUTH_TOKEN` for Changesets/npm.
- In **Settings → Actions → General → Workflow permissions**, enable **Allow GitHub Actions to
  create and approve pull requests** so `changesets/action` can create the version PR.
- Keep the `main` environment and branch protections compatible with the release workflow's
  `contents: write`, `pull-requests: write`, and `id-token: write` permissions.

If the repository intentionally disallows bot-created PRs, a maintainer may open the PR manually
from `changeset-release/main` to `main`. This preserves the two phases, but the workflow run that
attempted to create the PR will remain failed. Publication still requires the npm credential.

## Verification

Before merging a version PR:

```sh
npm ci
npm run build
npm run smoke:nestjs
npm run smoke:prisma
npx changeset status
```

After the core/NestJS publish run for #17 succeeds, verify their exact public versions and
artifact metadata:

```sh
npm view activitylog-core version dist.integrity dist.attestations
npm view activitylog-nestjs version dist.integrity dist.attestations
```

After the Prisma/NextJS publish run for #19 succeeds, verify its public artifact separately:

```sh
npm view activitylog-nextjs version dist.integrity dist.attestations
```

Install the public versions into clean NestJS and Prisma consumers once more. Do not close a
release issue based only on a merged version PR; close it after registry reads and the matching
public consumer smoke succeed.
