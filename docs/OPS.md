# Ops notes

## Branch protection (deferred)

Branch protection on a **private** repo requires GitHub Pro; it's free on public
repos. We skipped it at v1.0.0 (solo committer, CI already runs on every push).
Re-apply the moment the repo goes Pro/public or a second collaborator joins:

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
