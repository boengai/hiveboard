import { describe, expect, test } from "bun:test";
import { parseRepoLabel } from "../src/labels/parse-repo.ts";

describe("parseRepoLabel", () => {
  const prefix = "repo:";
  const fallback = "default-org";

  test("parses simple repo name, uses fallback owner", () => {
    const result = parseRepoLabel(["repo:frontend"], prefix, fallback);
    expect(result).toEqual({ repoOwner: "default-org", repoName: "frontend" });
  });

  test("parses owner/repo format", () => {
    const result = parseRepoLabel(["repo:other-org/backend"], prefix, fallback);
    expect(result).toEqual({ repoOwner: "other-org", repoName: "backend" });
  });

  test("returns null when no repo label present", () => {
    const result = parseRepoLabel(
      ["action:implement", "status:running"],
      prefix,
      fallback,
    );
    expect(result).toBeNull();
  });

  test("returns null for empty value after prefix", () => {
    const result = parseRepoLabel(["repo:"], prefix, fallback);
    expect(result).toBeNull();
  });

  test("returns null for malformed owner/repo with missing name", () => {
    const result = parseRepoLabel(["repo:org/"], prefix, fallback);
    expect(result).toBeNull();
  });

  test("returns null for malformed owner/repo with missing owner", () => {
    const result = parseRepoLabel(["repo:/name"], prefix, fallback);
    expect(result).toBeNull();
  });

  test("picks first matching label", () => {
    const result = parseRepoLabel(
      ["repo:first", "repo:second"],
      prefix,
      fallback,
    );
    expect(result).toEqual({ repoOwner: "default-org", repoName: "first" });
  });

  test("works with custom prefix", () => {
    const result = parseRepoLabel(["target:myorg/myrepo"], "target:", fallback);
    expect(result).toEqual({ repoOwner: "myorg", repoName: "myrepo" });
  });
});
