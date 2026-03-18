import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateWorkspacePath } from "../src/workspace/path-safety.ts";

describe("validateWorkspacePath", () => {
  test("accepts valid path under root", async () => {
    const root = await mkdtemp(join(tmpdir(), "sym-test-"));
    const wsPath = join(root, "issue-42");
    await mkdir(wsPath);

    await expect(validateWorkspacePath(wsPath, root)).resolves.toBeUndefined();

    await rm(root, { recursive: true });
  });

  test("rejects path equal to root", async () => {
    const root = await mkdtemp(join(tmpdir(), "sym-test-"));

    await expect(validateWorkspacePath(root, root)).rejects.toThrow(
      "cannot be the root",
    );

    await rm(root, { recursive: true });
  });

  test("rejects path outside root", async () => {
    const root = await mkdtemp(join(tmpdir(), "sym-test-"));
    const outside = await mkdtemp(join(tmpdir(), "sym-outside-"));

    await expect(validateWorkspacePath(outside, root)).rejects.toThrow(
      "escapes root",
    );

    await rm(root, { recursive: true });
    await rm(outside, { recursive: true });
  });

  test("rejects symlink that escapes root", async () => {
    const root = await mkdtemp(join(tmpdir(), "sym-test-"));
    const outside = await mkdtemp(join(tmpdir(), "sym-outside-"));
    const link = join(root, "escape");
    await symlink(outside, link);

    await expect(validateWorkspacePath(link, root)).rejects.toThrow(
      "escapes root",
    );

    await rm(root, { recursive: true });
    await rm(outside, { recursive: true });
  });
});
