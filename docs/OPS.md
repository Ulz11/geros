# Ops notes

## Branch protection (APPLIED when the repo went public)

Applied since the repo went public (free tier covers public repos). Both CI checks
are required and force-pushes/deletions to `main` are blocked. If it ever needs
re-applying:

```sh
gh api -X PUT repos/Ulz11/geros/branches/main/protection --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["Backend integration tests", "Frontend production build"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": false
}
EOF
```

The two contexts are the CI job names in `.github/workflows/ci.yml` — keep them
in sync if the jobs are renamed.

## Releases

- Tag releases as `vX.Y.Z` (annotated): `git tag -a v1.1.0 -m "..." && git push origin v1.1.0`,
  then `gh release create v1.1.0 --title ... --notes ...`.
- `v1.0.0` = first feature-complete, tested, self-provisioning build (PocketBase 0.39.1, Node 22).

## CI

- `.github/workflows/ci.yml` pins `PB_VERSION` — bump it together with the
  `pocketbase` JS SDK in `app/package.json` and re-run the test suite locally first.
- Action majors were chosen for the Node 24 runner runtime (June 2026 cutoff);
  `upload-artifact` needed v7 while checkout/setup-node were fine at v5.

## Restore (rehearsed, not theoretical)

`deploy/restore.sh` restores a nightly `backup.sh` archive:

```sh
bash /opt/geros/restore.sh /opt/geros/backups/geros-YYYYMMDD-HHMM.tar.gz
```

It stops the service, keeps the current `pb_data` aside as
`pb_data.before-restore-<stamp>` (a restore can never destroy data), unpacks the
backup's database + uploads, fixes ownership, and starts the service again.

The exact mechanics are drilled automatically in CI by
`backend/test/restore.test.mjs`: seed -> backup -> mutate -> restore -> verify
the snapshot state came back. If that test is green, the restore path works.
