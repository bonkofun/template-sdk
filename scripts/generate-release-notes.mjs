#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SEMVER_TAG =
  /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$/;

const CATEGORY_DEFINITIONS = [
  {
    key: "breaking",
    title: "Breaking changes",
    singular: "breaking change",
    plural: "breaking changes",
  },
  {
    key: "feat",
    title: "New features",
    singular: "new feature",
    plural: "new features",
  },
  { key: "fix", title: "Fixes", singular: "fix", plural: "fixes" },
  {
    key: "perf",
    title: "Performance",
    singular: "performance improvement",
    plural: "performance improvements",
  },
  {
    key: "style",
    title: "UI and styling",
    singular: "UI and styling change",
    plural: "UI and styling changes",
  },
  {
    key: "refactor",
    title: "Refactoring",
    singular: "refactor",
    plural: "refactors",
  },
  {
    key: "docs",
    title: "Documentation",
    singular: "documentation change",
    plural: "documentation changes",
  },
  {
    key: "test",
    title: "Tests",
    singular: "test change",
    plural: "test changes",
  },
  {
    key: "maintenance",
    title: "Maintenance",
    singular: "maintenance change",
    plural: "maintenance changes",
  },
  {
    key: "revert",
    title: "Reverts",
    singular: "revert",
    plural: "reverts",
  },
  {
    key: "other",
    title: "Other changes",
    singular: "other change",
    plural: "other changes",
  },
];

const TYPE_TO_CATEGORY = new Map([
  ["feat", "feat"],
  ["fix", "fix"],
  ["perf", "perf"],
  ["style", "style"],
  ["refactor", "refactor"],
  ["docs", "docs"],
  ["test", "test"],
  ["build", "maintenance"],
  ["ci", "maintenance"],
  ["chore", "maintenance"],
  ["revert", "revert"],
]);

function escapeMarkdown(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/([\\`*_[\]])/g, "\\$1");
}

function sentenceCase(value) {
  return value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`;
}

function scopeLabel(scope) {
  return sentenceCase(scope.replaceAll("-", " "));
}

export function parseCommit(commit) {
  const match = commit.subject.match(
    /^([a-z][a-z0-9-]*)(?:\(([^)]+)\))?(!)?:\s+(.+)$/,
  );

  if (!match) {
    return {
      ...commit,
      category: "other",
      description: commit.subject,
      scope: null,
    };
  }

  const [, type, scope, breakingMarker, description] = match;
  const hasBreakingFooter = /^BREAKING(?: CHANGE|-CHANGE):/m.test(commit.body ?? "");

  return {
    ...commit,
    category: breakingMarker || hasBreakingFooter
      ? "breaking"
      : (TYPE_TO_CATEGORY.get(type) ?? "other"),
    description,
    scope: scope ?? null,
  };
}

function commitBullet(commit, repository) {
  const description = escapeMarkdown(sentenceCase(commit.description));
  const scope = commit.scope
    ? `**${escapeMarkdown(scopeLabel(commit.scope))}** — `
    : "";
  const commitUrl = `https://github.com/${repository}/commit/${commit.hash}`;

  return `- ${scope}${description} ([\`${commit.shortHash}\`](${commitUrl}))`;
}

function pluralizedCommitCount(count) {
  return `${count} ${count === 1 ? "commit" : "commits"}`;
}

export function generateReleaseNotes({
  commits,
  currentTag,
  previousTag,
  repository,
}) {
  const parsedCommits = commits.map(parseCommit);
  const groupedCommits = new Map(
    CATEGORY_DEFINITIONS.map(({ key }) => [key, []]),
  );

  for (const commit of parsedCommits) {
    groupedCommits.get(commit.category).push(commit);
  }

  const lines = [`# ${currentTag}`, "", "## Release summary", ""];
  if (previousTag) {
    lines.push(
      `${currentTag} includes **${pluralizedCommitCount(parsedCommits.length)}** since ${previousTag}.`,
    );
  } else {
    lines.push(
      `${currentTag} is the first tagged release and includes **${pluralizedCommitCount(parsedCommits.length)}**.`,
    );
  }

  const summaries = CATEGORY_DEFINITIONS.flatMap((definition) => {
    const count = groupedCommits.get(definition.key).length;
    const label = count === 1 ? definition.singular : definition.plural;
    return count === 0 ? [] : [`- **${count}** ${label}`];
  });

  if (summaries.length > 0) {
    lines.push("", ...summaries);
  }

  const highlights = parsedCommits
    .filter(({ category }) => ["breaking", "feat", "perf"].includes(category))
    .slice(0, 5);

  if (highlights.length > 0) {
    lines.push(
      "",
      "## Highlights",
      "",
      ...highlights.map((commit) => commitBullet(commit, repository)),
    );
  }

  for (const definition of CATEGORY_DEFINITIONS) {
    const categoryCommits = groupedCommits.get(definition.key);
    if (categoryCommits.length === 0) {
      continue;
    }

    lines.push(
      "",
      `## ${definition.title}`,
      "",
      ...categoryCommits.map((commit) => commitBullet(commit, repository)),
    );
  }

  if (parsedCommits.length === 0) {
    lines.push("", "No commits were found in this release range.");
  }

  lines.push("", "## Compare changes", "");
  if (previousTag) {
    lines.push(
      `[View the full changelog](https://github.com/${repository}/compare/${previousTag}...${currentTag}).`,
    );
  } else {
    lines.push(
      `[View the release commit](https://github.com/${repository}/tree/${currentTag}).`,
    );
  }

  lines.push(
    "",
    "_This description was generated from the repository's commit history._",
    "",
  );

  return lines.join("\n");
}

function runGit(args, options = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    stdio: ["ignore", "pipe", options.ignoreErrors ? "ignore" : "inherit"],
  }).trim();
}

function findPreviousTag(currentTag) {
  let revision = currentTag;

  while (revision) {
    try {
      const candidate = runGit(
        ["describe", "--tags", "--abbrev=0", `${revision}^`],
        { ignoreErrors: true },
      );
      if (SEMVER_TAG.test(candidate)) {
        return candidate;
      }
      revision = candidate;
    } catch {
      return null;
    }
  }

  return null;
}

function readCommits(currentTag, previousTag) {
  const range = previousTag ? `${previousTag}..${currentTag}` : currentTag;
  const output = runGit([
    "log",
    "--no-merges",
    "--format=%H%x1f%h%x1f%s%x1f%b%x1e",
    range,
  ]);

  if (!output) {
    return [];
  }

  return output
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, shortHash, subject, body = ""] = record.split("\x1f");
      return { hash, shortHash, subject, body };
    });
}

function readRequiredArgument(name) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
}

function main() {
  const currentTag = readRequiredArgument("--tag");
  const repository = readRequiredArgument("--repository");
  const outputFile = readRequiredArgument("--output");

  if (!SEMVER_TAG.test(currentTag)) {
    throw new Error(`Invalid SemVer release tag: ${currentTag}`);
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error(`Invalid GitHub repository: ${repository}`);
  }

  runGit(["rev-parse", "--verify", `refs/tags/${currentTag}^{commit}`]);

  const previousTag = findPreviousTag(currentTag);
  const commits = readCommits(currentTag, previousTag);
  const notes = generateReleaseNotes({
    commits,
    currentTag,
    previousTag,
    repository,
  });

  writeFileSync(outputFile, notes, "utf8");
  process.stdout.write(
    `Generated ${outputFile} from ${commits.length} commits${previousTag ? ` since ${previousTag}` : ""}.\n`,
  );
}

const isMainModule =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMainModule) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Failed to generate release notes: ${message}\n`);
    process.exitCode = 1;
  }
}
