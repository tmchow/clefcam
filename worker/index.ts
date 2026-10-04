import { FLASH } from "../src/model";
import { estimateUsd, validTokens } from "../src/metrics";
import { DurableObject } from "cloudflare:workers";
import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  validate,
  modelInput,
  parseAnswers,
  type Evaluation,
} from "./validation";
export interface Env {
  AI: Ai;
  ASSETS: Fetcher;
  BUDGET: DurableObjectNamespace;
  ACCESS_ISSUER: string;
  ACCESS_AUD: string;
  ALLOWED_EMAIL: string;
  APP_HOST: string;
  INFERENCE_ENABLED: string;
}
const keysets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
async function authorized(request: Request, env: Env) {
  if (
    !env.APP_HOST ||
    new URL(request.url).hostname !== env.APP_HOST ||
    !env.ACCESS_ISSUER ||
    !env.ACCESS_AUD ||
    !env.ALLOWED_EMAIL
  )
    return false;
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return false;
  try {
    let keys = keysets.get(env.ACCESS_ISSUER);
    if (!keys) {
      keys = createRemoteJWKSet(
        new URL(`${env.ACCESS_ISSUER}/cdn-cgi/access/certs`),
      );
      keysets.set(env.ACCESS_ISSUER, keys);
    }
    const { payload } = await jwtVerify(token, keys, {
      issuer: env.ACCESS_ISSUER,
      audience: env.ACCESS_AUD,
      algorithms: ["RS256"],
    });
    return (
      payload.email === env.ALLOWED_EMAIL &&
      typeof payload.exp === "number" &&
      typeof payload.iat === "number" &&
      payload.exp - payload.iat <= 86400
    );
  } catch {
    return false;
  }
}
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!(await authorized(request, env)))
      return new Response(
        "Private camera. Sign in through Cloudflare Access.",
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    const url = new URL(request.url);
    let response: Response;
    if (url.pathname === "/api/evaluate") {
      if (request.method !== "POST")
        return json({ error: "Method not allowed" }, 405);
      if (
        request.headers.get("Origin") !== url.origin ||
        request.headers.get("Content-Type")?.split(";")[0] !==
          "application/json"
      )
        return json({ error: "Invalid origin or content type" }, 403);
      if (env.INFERENCE_ENABLED !== "true")
        return json({ error: "Inference is disabled" }, 503);
      if (Number(request.headers.get("Content-Length")) > 460000)
        return json({ error: "Frame too large" }, 413);
      let input: Evaluation;
      try {
        const reader = request.body?.getReader();
        if (!reader) throw new Error("Missing body");
        let total = 0;
        const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > 460000) {
            await reader.cancel();
            return json({ error: "Frame too large" }, 413);
          }
          chunks.push(value);
        }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        input = validate(JSON.parse(new TextDecoder().decode(bytes)));
      } catch {
        return json(
          { error: "Invalid frame or rules", code: "invalid_frame_or_rules" },
          400,
        );
      }
      response = await env.BUDGET.get(
        env.BUDGET.idFromName("private-camera-budget"),
      ).fetch(
        new Request("https://budget/evaluate", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      );
    } else if (url.pathname === "/api/usage") {
      response = await env.BUDGET.get(
        env.BUDGET.idFromName("private-camera-budget"),
      ).fetch("https://budget/usage");
    } else if (url.pathname.startsWith("/api/"))
      return json({ error: "Not found" }, 404);
    else response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set(
      "Permissions-Policy",
      "camera=(self), microphone=(), geolocation=()",
    );
    headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    return new Response(response.body, { status: response.status, headers });
  },
};
type Ledger = {
  calls: number;
  day: string;
  daily: number;
  last: number;
  inputTokens: number;
  unknownUsage: number;
  reservedUnits?: number;
  dailyUnits?: number;
  estimatedUsd?: number;
  // Compatibility only: preserve historical costs from the retired model.
  tokensByModel?: Record<string, number>;
};
export class Budget extends DurableObject<Env> {
  private busy = false;
  async fetch(request: Request) {
    if (new URL(request.url).pathname === "/usage") {
      const ledger = await this.ctx.storage.get<Ledger>("ledger");
      return json(ledger || { calls: 0, inputTokens: 0, unknownUsage: 0 });
    }
    if (this.busy) return json({ error: "A check is already running" }, 429);
    this.busy = true;
    try {
      const input = (await request.json()) as Evaluation;
      const model = FLASH.id;
      const now = Date.now(),
        day = new Date(now).toISOString().slice(0, 10);
      const allowed = await this.ctx.storage.transaction(async (tx) => {
        const ledger = (await tx.get<Ledger>("ledger")) || {
          calls: 0,
          day,
          daily: 0,
          last: 0,
          inputTokens: 0,
          unknownUsage: 0,
        };
        const session = (await tx.get<number>(`session:${input.session}`)) || 0;
        if (ledger.day !== day) {
          ledger.day = day;
          ledger.daily = 0;
          ledger.dailyUnits = 0;
        }
        // Migrate historical Flash reservations without resetting them.
        const usedUnits = ledger.reservedUnits ?? ledger.calls;
        const dayUnits = ledger.dailyUnits ?? ledger.daily;
        // Reserve one unit per Flash check, including failures. Preserve all prior
        // weighted reservations; removing a model must never refund its usage.
        // 2,000 units × 65,536 tokens × $0.09/M < $11.80.
        if (
          usedUnits + 1 > 2000 ||
          dayUnits + 1 > 300 ||
          session + 1 > 120 ||
          now - ledger.last < 1400
        )
          return false;
        ledger.reservedUnits = usedUnits + 1;
        ledger.dailyUnits = dayUnits + 1;
        ledger.calls++;
        ledger.daily++;
        ledger.last = now;
        ledger.unknownUsage++;
        await tx.put("ledger", ledger);
        await tx.put(`session:${input.session}`, session + 1);
        return true;
      });
      if (!allowed)
        return json({ error: "Private demo usage limit reached" }, 429);
      const start = Date.now();
      let raw: unknown;
      try {
        raw = await this.env.AI.run(
          FLASH.binding as Parameters<Ai["run"]>[0],
          modelInput(input),
        );
      } catch {
        return json(
          { error: "Could not evaluate this frame", code: "ai_binding_error" },
          502,
        );
      }
      const tokens = validTokens(
        (raw as { usage?: { input_tokens?: unknown } })?.usage?.input_tokens,
      );
      if (tokens !== null) {
        const ledger = (await this.ctx.storage.get<Ledger>("ledger"))!;
        const retiredTokens = ledger.tokensByModel?.clef ?? 0;
        ledger.estimatedUsd =
          (ledger.estimatedUsd ??
            estimateUsd(ledger.inputTokens - retiredTokens) +
              (retiredTokens * 0.24) / 1_000_000) + estimateUsd(tokens);
        ledger.inputTokens += tokens;
        ledger.unknownUsage--;
        await this.ctx.storage.put("ledger", ledger);
      }
      return json({
        version: input.version,
        states: parseAnswers(raw, input.rules),
        elapsedMs: Date.now() - start,
        measurementSource: "workers-ai",
        model,
        complete: [
          ...input.rules,
          ...(input.rules.length > 1 ? [{ id: "scope" }] : []),
        ].every((rule) => {
          const answer = (
            raw as {
              answers?: Record<string, { type?: string; noul?: unknown }>;
            }
          )?.answers?.[rule.id];
          return (
            answer?.type === "noul" &&
            typeof answer.noul === "number" &&
            Number.isFinite(answer.noul) &&
            answer.noul >= 0 &&
            answer.noul <= 1
          );
        }),
        usage: {
          inputTokens: tokens,
          inputUsdPerMillion: FLASH.rate,
          estimatedUsd: tokens === null ? null : estimateUsd(tokens),
        },
      });
    } finally {
      this.busy = false;
    }
  }
}
