import assert from "node:assert/strict";
import { test } from "vitest";

import {
  generateReleaseNotes,
  parseCommit,
} from "./generate-release-notes.mjs";

const commit = (overrides) => ({
  body: "",
  hash: "1234567890abcdef",
  shortHash: "1234567",
  subject: "chore(repo): update tooling",
  ...overrides,
});

test("parseCommit extracts conventional type, scope, and description", () => {
  assert.deepEqual(
    parseCommit(commit({ subject: "feat(admin): add revenue dashboard" })),
    {
      body: "",
      category: "feat",
      description: "add revenue dashboard",
      hash: "1234567890abcdef",
      scope: "admin",
      shortHash: "1234567",
      subject: "feat(admin): add revenue dashboard",
    },
  );
});

test("parseCommit detects breaking markers and footers", () => {
  assert.equal(
    parseCommit(commit({ subject: "feat(api)!: replace response format" }))
      .category,
    "breaking",
  );
  assert.equal(
    parseCommit(
      commit({
        body: "BREAKING CHANGE: old clients must migrate",
        subject: "refactor(api): replace response format",
      }),
    ).category,
    "breaking",
  );
});

test("parseCommit preserves non-conventional commits as other changes", () => {
  const parsed = parseCommit(commit({ subject: "Prepare public launch" }));
  assert.equal(parsed.category, "other");
  assert.equal(parsed.description, "Prepare public launch");
  assert.equal(parsed.scope, null);
});

test("generateReleaseNotes builds counts, sections, commit links, and comparison", () => {
  const notes = generateReleaseNotes({
    commits: [
      commit({ subject: "feat(admin): add revenue dashboard" }),
      commit({
        hash: "abcdef1234567890",
        shortHash: "abcdef1",
        subject: "fix(auth): reject expired sessions",
      }),
      commit({
        hash: "fedcba0987654321",
        shortHash: "fedcba0",
        subject: "Document deployment recovery",
      }),
    ],
    currentTag: "v1.2.0",
    previousTag: "v1.1.0",
    repository: "example/bonko",
  });

  assert.match(notes, /v1\.2\.0 includes \*\*3 commits\*\* since v1\.1\.0/);
  assert.match(notes, /\*\*1\*\* new feature/);
  assert.match(notes, /\*\*1\*\* fix/);
  assert.match(notes, /## Highlights/);
  assert.match(notes, /## New features/);
  assert.match(notes, /\*\*Admin\*\* — Add revenue dashboard/);
  assert.match(
    notes,
    /https:\/\/github\.com\/example\/bonko\/commit\/abcdef1234567890/,
  );
  assert.match(notes, /## Other changes/);
  assert.match(
    notes,
    /https:\/\/github\.com\/example\/bonko\/compare\/v1\.1\.0\.\.\.v1\.2\.0/,
  );
});

test("generateReleaseNotes handles an initial release without commits", () => {
  const notes = generateReleaseNotes({
    commits: [],
    currentTag: "v0.1.0",
    previousTag: null,
    repository: "example/bonko",
  });

  assert.match(notes, /first tagged release/);
  assert.match(notes, /No commits were found/);
  assert.match(notes, /https:\/\/github\.com\/example\/bonko\/tree\/v0\.1\.0/);
});
