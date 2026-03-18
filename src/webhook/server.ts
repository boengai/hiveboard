import { Webhooks } from "@octokit/webhooks";
import { consola } from "consola";
import type { Config } from "../config/schema.ts";
import type { Orchestrator } from "../orchestrator/orchestrator.ts";
import {
  handleIssuesCancellation,
  handleIssuesLabeled,
  type IssuesEventPayload,
  type IssuesLabeledPayload,
} from "./handlers.ts";

export interface WebhookServerOptions {
  config: Config;
  orchestrator: Orchestrator;
}

/** Create and start the webhook HTTP server. */
export function startWebhookServer(
  options: WebhookServerOptions,
): ReturnType<typeof Bun.serve> {
  const { config, orchestrator } = options;
  const webhookSecret = config.webhook.secret;

  // Set up Octokit webhook handler for signature verification
  const webhooks = webhookSecret
    ? new Webhooks({ secret: webhookSecret })
    : null;

  const server = Bun.serve({
    port: config.webhook.port,
    hostname: config.webhook.host,

    async fetch(req) {
      const url = new URL(req.url);

      // Health check
      if (url.pathname === "/health" && req.method === "GET") {
        const status = orchestrator.getStatus();
        return Response.json({ ok: true, ...status });
      }

      // Webhook endpoint
      if (url.pathname === "/webhook" && req.method === "POST") {
        return handleWebhookRequest(req, config, orchestrator, webhooks);
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  consola.info(
    `Webhook server listening on ${config.webhook.host}:${config.webhook.port}`,
  );

  return server;
}

async function handleWebhookRequest(
  req: Request,
  config: Config,
  orchestrator: Orchestrator,
  webhooks: Webhooks | null,
): Promise<Response> {
  const body = await req.text();

  // Verify signature if secret is configured
  if (webhooks) {
    const signature = req.headers.get("x-hub-signature-256") ?? "";
    try {
      await webhooks.verify(body, signature);
    } catch {
      consola.warn("Webhook signature verification failed");
      return new Response("Unauthorized", { status: 401 });
    }
  }

  const event = req.headers.get("x-github-event");
  if (!event) {
    return new Response("Missing x-github-event header", { status: 400 });
  }

  const payload = JSON.parse(body);

  try {
    if (event === "issues") {
      switch (payload.action) {
        case "labeled":
          await handleIssuesLabeled(
            payload as IssuesLabeledPayload,
            config,
            orchestrator,
          );
          break;

        case "unlabeled":
        case "closed":
          handleIssuesCancellation(payload as IssuesEventPayload, orchestrator);
          break;

        default:
          consola.debug(`Ignoring issues.${payload.action} event`);
      }
    } else {
      consola.debug(`Ignoring ${event} event`);
    }
  } catch (err) {
    consola.error(`Error handling webhook ${event}.${payload.action}:`, err);
    return new Response("Internal Server Error", { status: 500 });
  }

  return new Response("OK", { status: 200 });
}
