import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ConfigSchema } from "../src/config/schema.ts";
import { GitHubClient } from "../src/github/client.ts";

/** Build a minimal valid config for testing. */
function minimalConfig() {
  return ConfigSchema.parse({
    tracker: {
      kind: "github",
      owner: "testorg",
      project_number: 1,
    },
  });
}

describe("GitHubClient.create() auth detection", () => {
  const savedEnv: Record<string, string | undefined> = {};
  const authKeys = [
    "GITHUB_TOKEN",
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_APP_INSTALLATION_ID",
  ];

  beforeEach(() => {
    for (const key of authKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of authKeys) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  test("throws when no auth env vars are set", async () => {
    const config = minimalConfig();
    await expect(GitHubClient.create(config)).rejects.toThrow(
      "GitHub auth not configured",
    );
  });

  test("throws with partial app auth (missing installation_id)", async () => {
    process.env.GITHUB_APP_ID = "123";
    process.env.GITHUB_APP_PRIVATE_KEY =
      "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----";
    // GITHUB_APP_INSTALLATION_ID intentionally missing

    const config = minimalConfig();
    await expect(GitHubClient.create(config)).rejects.toThrow(
      "GitHub auth not configured",
    );
  });

  test("creates client with GITHUB_TOKEN", async () => {
    process.env.GITHUB_TOKEN = "ghp_test123";
    const config = minimalConfig();
    const client = await GitHubClient.create(config);
    expect(client).toBeDefined();
    const token = await client.getAccessToken();
    expect(token).toBe("ghp_test123");
  });
});
