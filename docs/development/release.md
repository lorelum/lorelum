# Prerelease workflow

This runbook is for maintainers publishing a Lorelum CLI prerelease. It describes the current
[`Release` workflow](../../.github/workflows/release.yml), which builds and verifies macOS Apple
Silicon, Linux x64, and Windows x64 archives before it creates a **draft** GitHub prerelease.
Publishing, checksums, and the supported installer smoke are separate gates; do not describe a
queued run, an Actions artifact, or an unpublished draft as released or installable.

## Version preparation and review

Select only the artifacts in the candidate, using independent SemVer values without a leading `v`.
Selectors: `--cli`, `--codex`, `--zcode`, `--cursor`, `--workbuddy`, `--claude`, `--omp`.

```sh
bun run release:version prepare --cli 0.1.0-alpha.7 --codex 0.1.0-alpha.8 --dry-run
bun run release:version prepare --cli 0.1.0-alpha.7 --codex 0.1.0-alpha.8
bun run release:version docs --cli 0.1.0-alpha.7
bun run release:version check
git diff
```

`--dry-run` lists old/new versions and exact files without writing; preview is optional. Review the
diff and `check` output before preparing the PR. For a Plugin-only candidate, select only that host:

```sh
bun run release:version prepare --zcode 0.2.0
```

A Plugin-only release uses the host's existing distribution and verification path; it does not
require a CLI version change, the CLI Release workflow, or a public CLI recommendation update.

`apps/site/content/public-release.json` owns the public CLI install recommendation, independently of
source versions. Bilingual installation and Agent pages use `<CliInstall platform="unix" />` or
`windows` to generate concrete commands for pages, copy buttons, and `agents.md`; do not repeat the
version in their prose or in README files.

For a CLI release that becomes the documented install target, update the recommendation during
version preparation and include it in the same release PR:

```sh
bun run release:version docs --cli 0.1.0-alpha.7
git diff -- apps/site/content/public-release.json
```

`docs` also supports `--dry-run` and only changes the recommendation, not manifests. It does not
verify remote availability, publish, or deploy. Do not wait for publication or installer smoke to
prepare this edit, open a separate recommendation-only PR, or require a second site deployment just
to change the version. The offline `check` checks
registered relationships and recommendation format without network requests or a site build.

For rollback, review the diff for the exact paths printed by the command, then select only its hunks:

```sh
git restore -p -- packages/cli/package.json bun.lock
```

Do not restore whole files containing other edits. Repeated targets leave files unchanged; invalid
input, missing fields, and mismatched originals fail before writing and name the affected argument
or file. A write failure attempts to restore every attempted file and reports restoration failures.
After forced termination or failed restoration, inspect the exact-path diff and selectively revert
this operation before retrying; there is no cross-file crash transaction.

## Release-note coverage

Before the version-preparation PR is ready for review, take the **complete commit range from the
previous published version tag to the proposed release commit**. Read every commit subject and body,
including merge, fixup, documentation, test, and CI commits; inspect the associated PR descriptions,
linked Issues, and relevant verification or benchmark records. Account for every commit in the
review, even when several commits belong to one user-facing change or a maintainer-only fixup does
not deserve its own note. Recheck the range if the candidate commit moves before running the Release
workflow.

Write [`scripts/release/release-notes.md`](../../scripts/release/release-notes.md) as a reader-facing
summary of that evidence, not a list of `feat` commits or a copy of the Git log. Cover the categories
that actually changed:

- New capabilities, with host-specific availability where it differs.
- Changes to existing behavior, such as defaults or text output.
- Bug fixes. Describe the problem a user encountered and the result after the fix; do not bury fixes
  under a generic “improvements” sentence. Include diagnostic or privacy fixes when applicable.
- Performance changes when supported by comparable before/after measurements. Give the workload,
  environment and method or link to a PR/record that does; distinguish measured results from expected
  benefits and avoid turning one machine's result into a platform guarantee.
- Upgrade or compatibility steps. Say which existing users need to act.
- Known material limitations or unresolved problems. Do not imply a separate Issue was fixed by a
  related change.
- Contributor-facing changes when they are substantial enough to help someone using the repository.

Keep the install commands, supported assets, checksums, previous-tag comparison link, and release
verification boundary accurate. Link the relevant PRs or Issues for detail; omit empty categories and
routine fixup commits from the published narrative after accounting for them in the review. Avoid
speculative benefits, incidental implementation details with no reader action, private evidence, and
temporary PR/CI status in the release notes. In the preparation PR body or a dedicated verification
record, keep a compact inventory for **every SHA in the reviewed range**: the associated PR/Issue
(when one exists), the change's reader impact, and whether it appears in the notes, is grouped with
another entry, or is omitted as a non-user-facing fixup. State which claims still need release-run
verification. This inventory makes coverage reviewable without dumping the entire Git log into the
published notes.

## Normal prerelease path

1. Prepare only the CLI and/or Plugin versions that belong in this candidate. Include the intended
   CLI install recommendation and affected documentation in the same PR. Run
   `bun run release:version check`, review the selected changes with `git diff`, and complete the
   release-note coverage review against the full range above. Merge the version-preparation PR only
   after its checks pass. Confirm that `origin/main` contains the intended selected versions,
   release notes, every relevant public Plugin/marketplace version surface, and user documentation.
2. In GitHub Actions, manually run **Release** from the verified `main` commit. If the candidate has
   moved, reconcile the release-note range before dispatch. Turn on **Create the
   annotated version tag and verified prerelease draft**, and enter the new `v<CLI version>` value
   in `tag` (for example, `v0.1.0-alpha.5`). Confirm the selected ref and SHA before dispatch: the
   workflow builds that SHA and checks the tag against `packages/cli/package.json`. Do not create or
   push a tag or create a GitHub Release yourself; the Action owns both steps.
   Manually run **Deploy site** once for the release documentation from the intended merged commit;
   it may run alongside the Release build, without waiting for publication or installer smoke.
   Merging to `main` does not deploy the site. See the
   [site deployment workflow](./site-deploy.md) for deployment details.
3. Wait for all three build jobs and the `draft · GitHub prerelease` job to complete. After the
   archives and metadata pass SHA-256 verification, the workflow creates and pushes an annotated tag
   at the packaged commit, then creates a prerelease **draft** with seven assets. If a tag or Release
   already exists, do not rerun the normal draft path or move the tag; inspect the existing state.
4. Read the draft back before publication. Confirm its tag and target commit, `isDraft: true`,
   `isPrerelease: true`, exactly these assets, and the expected checksums:

   - `lore-<version>-darwin-arm64.tar.gz` and `.metadata.json`
   - `lore-<version>-linux-x64.tar.gz` and `.metadata.json`
   - `lore-<version>-win32-x64.zip` and `.metadata.json`
   - `SHA256SUMS`

   Check the release-note URLs against the intended documentation. Site deployment is not a
   prerequisite for creating or publishing the release draft.

5. Change the verified draft to a published prerelease, then use the public installer in an isolated
   temporary directory and confirm the installed `lore --version` reports that exact version. Only
   after this smoke may a release be described as publicly available or installable.
6. Confirm the site deployment succeeded for the intended commit, the release-note links work, and
   the bilingual installation pages and `agents.md` show the prepared recommendation. This is
   deployment verification, not another version edit, PR, or deployment. Skip site deployment when
   a Plugin-only release has no site changes.

## Build-only candidates

Leaving the draft checkbox at its default unchecked state produces build artifacts only. It is useful
for an intentionally non-public candidate or a recovery investigation; it does not create or update
a GitHub Release.

Use the Actions UI for this boolean input. Do **not** invoke `gh workflow run -f
create_draft=false` as a build-only shortcut: a raw non-empty `false` value can satisfy the workflow
condition and schedule the draft job. If automation is necessary, use a typed JSON boolean and verify
the resulting run's job graph before treating it as build-only.

## Interrupted runs and recovery

An existing tag or draft is a recovery target, not an input to the normal workflow. The draft job
deliberately rejects an already-existing Release so it cannot overwrite or mix immutable release
assets. A failure after the Action pushes the tag but before it creates the draft leaves that tag
in place; inspect the run and verified assets before completing the draft manually. Never retag or
rerun the normal draft path against the existing tag.

If a normal run is interrupted after it creates a draft:

1. Stop treating the normal `create_draft` route as resumable. Do not rerun it while the draft exists.
2. Inspect the draft's current assets and the retained artifacts from the completed build jobs. Verify
   every archive and metadata file against its target `SHA256SUMS`, then compare the combined manifest
   with the draft before any upload.
3. Upload only verified missing assets to that existing draft. Read its full asset list and digests
   again before publishing.

Do not precreate an empty draft in anticipation of a normal run. That converts a normal publish into
a recovery case and blocks the workflow's own draft-creation guard.

## Boundaries

- This workflow does not publish packages to a registry and must not be used as authorization to do
  so.
- Tags are immutable release provenance. Never move, retag, or rewrite an existing version.
- A successful archive build shows package integrity on its matching runner. It does not by itself
  show that the public Release is available, that the installer can download it, or that Pack retrieval
  quality changed.
