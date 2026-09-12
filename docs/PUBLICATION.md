# Publication checks

Run `node scripts/check-publication.mjs` before committing. It checks tracked and unignored candidate files, plus the Git index, for private artifacts and credential patterns. Run `node --test tests/publication.test.mjs` to exercise the detector's positive and negative controls.

Before pushing, run `node scripts/check-publication.mjs --history`. This also scans every reachable Git blob. In a worktree, add `--secret-file /path/to/private.env` for credentials stored in another checkout. The script uses Node's dotenv parser and checks the repository environment files, the shared ADA environment, and the local Spark pairing secret. It reports paths, rule names and counts, never matched values.

The detector checks known local secret values, their URL-encoded and base64 forms, private key headers, common provider token formats, JWTs, literal bearer credentials, and Zoom passcodes of at least four characters. Named public placeholders are allowed; a match against a supplied local secret is always rejected. This is a bounded publication check, not a guarantee that every possible secret format is recognized. Review the staged diff as well.

Raw video, audio, screenshots under `video/src/`, rendered frames, model bundles, browser profiles, environment files, pairing secrets and local agent runtime state stay ignored. Source scripts under `video/` and redacted test receipts under `tests/evidence/` can be committed. An ignore rule does not remove a file that is already tracked; check `git ls-files -ci --exclude-standard` too.

The video scripts preserve the local production workflow. They need separately supplied media, fonts, dependencies and an authenticated browser for upload. They were syntax checked for this publication, not rerun. `video/concept.py` depicts a design goal; its animation is not evidence of meeting speech delivery or autonomous Takeover.
