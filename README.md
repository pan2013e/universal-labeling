# Universal Labeling

A browser-based labeling and resolution workspace for software engineering research datasets.

## Run

Install JavaScript tooling and run the Express/SQLite server:

```bash
npm install
npm run serve
```

Open `http://127.0.0.1:8000/`, or forward the port from a headless server:

```bash
ssh -L 8000:127.0.0.1:8000 <user>@<server>
```

Run the browser smoke test:

```bash
npx playwright install chromium
npm run test:e2e
```

The server stores centralized project state in `data/universal-labeling.sqlite` using SQLite WAL mode. Browser `localStorage` only stores small client state such as the current session token and active project id; project data, uploaded context, labels, and resolutions are saved in SQLite.

Useful environment variables:

```bash
PORT=8000
LABELING_DB_PATH=/path/to/universal-labeling.sqlite
LABELING_SECRET='replace-this-for-shared-use'
LABELING_FILE_ROOT=/path/to/datasets   # optional, disabled when unset
LABELING_FILE_MAX_BYTES=52428800       # optional per-file read limit, default 50 MiB
LABELING_JSON_BODY_LIMIT=120mb         # optional request body limit for large project saves
```

## Current Capabilities

- Uses a three-page interface: a dedicated Login page, a reviewer-facing Workspace page, and an admin Backend page for profile, roles, setup, and exports.
- Serves the web app from an Express server backed by a centralized SQLite database with WAL mode and a busy timeout for concurrent browser access.
- Provides simple username-based authentication. Usernames are unique, stored encrypted, and represented in project artifacts by a keyed hash rather than the real account name.
- Provides contextual help through rounded `?` buttons on the main workflow and key setup panels.
- Import JSON arrays, JSON objects, JSONL, CSV, and TSV.
- Import data either from browser uploads or, when enabled by `LABELING_FILE_ROOT`, from files under a scoped server filesystem root.
- Infer record identifiers, text, metadata, and code/diff fields.
- Record project metadata, the data source path/name, and additional uploaded or server-selected context files.
- Split imported parent records into derived labeling items from any array-like field, then attach per-item server context files through field-placeholder path templates.
- Select which imported data fields appear in the labeler-facing question context and drag the sample cards to reorder them.
- Choose all records or a deterministic random sample by percent/count; the live sample-size suggestion uses confidence level, margin of error, population proportion, and finite population size, with warnings for impossible sample requests.
- Configure a detailed labeling protocol with editable label rows, single-label or multi-label answers, optional workspace-added labels, instructions, confidence, optional uncertain-label handling, notes, and resolution policy.
- Manage project members with independent `admin`, `labeler`, and `resolver` roles. The project creator is automatically an admin, and admins can grant multiple roles to the same account.
- Keep account usernames separate from project participant names. Participant names are project-local identifiers, while exported user ids are hashed account identifiers.
- Filter page access, export actions, setup forms, and review queues by the active role; setup fields become immutable for non-admin roles.
- Edit participant names in the roster while keeping stable hashed user ids for assignments and annotations.
- Build per-item assignments with configurable labelers per item.
- Label assigned items, route disagreements to resolvers, and keep final resolutions.
- Export a clean project definition JSON for distribution to labelers/resolvers.
- Load a project definition as a named participant/user id and start labeling immediately.
- Autosave project state to SQLite and restore from exported full-state JSON when needed.
- Export raw labels as JSONL and final results as CSV.
- Report progress, exact agreement, unresolved disagreement count, label distribution, and participant throughput.

## Notes

The current authentication strategy is intentionally simple: possession of a username creates or resumes that account. Login returns the session token to the browser app and also sets a same-origin HTTP-only session cookie so direct same-origin API requests work after sign-in. For production, add passwords or SSO, audit logs, stricter conflict handling, and transport security.

Server filesystem browsing is disabled by default. When `LABELING_FILE_ROOT` is set, project admins can list and read only files whose real path remains inside that root; symlink/path traversal escapes are rejected.

For nested review datasets, import the parent JSONL, split an array field into derived labeling items, and attach per-item context with a template. For example, with `LABELING_FILE_ROOT=/home/zhiyuan/review-bench`, import `results_pipeline_funnel/stage5_agent_not_resolved_blank_review.jsonl`, split `reference_review_comments`, then attach `testgen_combined/{instance_id}/test_review_comment_{comment_index}.*`.

Project state has a versioned migration layer in both the browser and server. New protocol fields should be added with defaults in `createDefaultState()`, normalized in `normalizeState()`, and migrated in the server startup state migration so old SQLite rows, project-definition JSON files, and full-state JSON files continue to load. SQLite schema changes should be additive migrations guarded by `PRAGMA user_version` and column checks before prepared statements are initialized.
