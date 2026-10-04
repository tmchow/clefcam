import { it, expect, vi, beforeAll } from "vitest";
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from "jose";
let resolver: ReturnType<typeof createLocalJWKSet>;
vi.mock("jose", async () => {
  const actual = await vi.importActual<typeof import("jose")>("jose");
  return {
    ...actual,
    createRemoteJWKSet:
      () =>
      (...args: Parameters<typeof resolver>) =>
        resolver(...args),
  };
});
import worker, { type Env } from "../worker/index";
let privateKey: CryptoKey;
const env = {
  APP_HOST: "camera.example.test",
  ACCESS_ISSUER: "https://identity.example.test",
  ACCESS_AUD: "camera-audience",
  ALLOWED_EMAIL: "owner@example.test",
} as Env;
beforeAll(async () => {
  const keys = await generateKeyPair("RS256");
  privateKey = keys.privateKey;
  const jwk = await exportJWK(keys.publicKey);
  resolver = createLocalJWKSet({ keys: [{ ...jwk, kid: "test" }] });
});
async function token(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    email: env.ALLOWED_EMAIL,
    iss: env.ACCESS_ISSUER,
    aud: env.ACCESS_AUD,
    iat: now,
    exp: now + 3600,
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .sign(privateKey);
}
function req(jwt?: string, path = "/") {
  return new Request("https://camera.example.test" + path, {
    headers: jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {},
  });
}
it("rejects anonymous UI, assets and inference before touching bindings", async () => {
  for (const path of ["/", "/assets/app.js", "/api/evaluate"]) {
    const response = await worker.fetch(req(undefined, path), env);
    expect(response.status).toBe(403);
  }
});
it("accepts the owner and rejects invalid signed claims before serving assets", async () => {
  const fetch = vi.fn(async () => new Response("private app"));
  const bindings = { ...env, ASSETS: { fetch } as unknown as Fetcher };
  expect(await (await worker.fetch(req(await token()), bindings)).text()).toBe(
    "private app",
  );
  fetch.mockClear();
  const now = Math.floor(Date.now() / 1000);
  for (const claims of [
    { email: "other@example.test" },
    { aud: "wrong" },
    { iss: "https://other.example.test" },
    { exp: now - 1 },
    { exp: now + 86401 },
    { exp: undefined },
    { iat: undefined },
  ]) {
    expect(
      (await worker.fetch(req(await token(claims)), bindings)).status,
    ).toBe(403);
  }
  expect(
    (await worker.fetch(req((await token()).slice(0, -5) + "wrong"), bindings))
      .status,
  ).toBe(403);
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects alternate hostnames and missing configuration before serving assets", async () => {
  const jwt = await token(),
    fetch = vi.fn();
  const bindings = { ...env, ASSETS: { fetch } as unknown as Fetcher };
  expect(
    (
      await worker.fetch(
        new Request("https://preview.example.test", {
          headers: { "Cf-Access-Jwt-Assertion": jwt },
        }),
        bindings,
      )
    ).status,
  ).toBe(403);
  for (const key of [
    "APP_HOST",
    "ACCESS_ISSUER",
    "ACCESS_AUD",
    "ALLOWED_EMAIL",
  ])
    expect(
      (await worker.fetch(req(jwt), { ...bindings, [key]: "" })).status,
    ).toBe(403);
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects cross-origin inference and disabled inference", async () => {
  const jwt = await token();
  let response = await worker.fetch(
    new Request("https://camera.example.test/api/evaluate", {
      method: "POST",
      headers: {
        "Cf-Access-Jwt-Assertion": jwt,
        "Content-Type": "application/json",
        Origin: "https://evil.test",
      },
      body: "{}",
    }),
    { ...env, INFERENCE_ENABLED: "true" },
  );
  expect(response.status).toBe(403);
  response = await worker.fetch(
    new Request("https://camera.example.test/api/evaluate", {
      method: "POST",
      headers: {
        "Cf-Access-Jwt-Assertion": jwt,
        "Content-Type": "application/json",
        Origin: "https://camera.example.test",
      },
      body: "{}",
    }),
    { ...env, INFERENCE_ENABLED: "false" },
  );
  expect(response.status).toBe(503);
});
it("rejects empty, disabled and retired structured rules before touching budget or AI", async () => {
  const get = vi.fn(),
    run = vi.fn(),
    jwt = await token();
  const image =
    "data:image/jpeg;base64," +
    btoa(
      String.fromCharCode(
        255,
        216,
        255,
        192,
        0,
        11,
        8,
        0,
        32,
        0,
        32,
        1,
        1,
        17,
        0,
      ),
    );
  for (const rules of [
    [],
    [{ id: "mug", text: "A mug", enabled: false }],
    [
      {
        id: "legacy",
        text: "A mug",
        position: { subject: "Mug", quadrant: "top-left" },
      },
    ],
    [{ id: "position-hand-top-left", text: "A hand" }],
  ]) {
    const response = await worker.fetch(
      new Request("https://camera.example.test/api/evaluate", {
        method: "POST",
        headers: {
          "Cf-Access-Jwt-Assertion": jwt,
          "Content-Type": "application/json",
          Origin: "https://camera.example.test",
        },
        body: JSON.stringify({
          image,
          rules,
          version: 1,
          session: crypto.randomUUID(),
        }),
      }),
      {
        ...env,
        INFERENCE_ENABLED: "true",
        BUDGET: { get } as unknown as DurableObjectNamespace,
        AI: { run } as unknown as Ai,
      },
    );
    expect(response.status).toBe(400);
    expect(get).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  }
});

it("enforces authenticated payload limits before accessing the budget", async () => {
  const jwt = await token();
  const fetch = vi.fn<(request: Request) => Promise<Response>>();
  fetch.mockResolvedValue(Response.json({ accepted: true }));
  const get = vi.fn(() => ({ fetch }));
  const bindings = {
    ...env,
    INFERENCE_ENABLED: "true",
    BUDGET: {
      get,
      idFromName: vi.fn(() => "budget"),
    } as unknown as DurableObjectNamespace,
  };
  const image = (width = 32, height = 32) =>
    "data:image/jpeg;base64," +
    btoa(
      String.fromCharCode(
        255,
        216,
        255,
        192,
        0,
        11,
        8,
        height >> 8,
        height & 255,
        width >> 8,
        width & 255,
        1,
        1,
        17,
        0,
      ),
    );
  const body = {
    image: image(),
    rules: [{ id: "mug", text: "A mug" }],
    version: 1,
    session: crypto.randomUUID(),
  };
  const send = (value: unknown, length?: string) =>
    worker.fetch(
      new Request("https://camera.example.test/api/evaluate", {
        method: "POST",
        headers: {
          "Cf-Access-Jwt-Assertion": jwt,
          Origin: "https://camera.example.test",
          "Content-Type": "application/json",
          ...(length ? { "Content-Length": length } : {}),
        },
        body: JSON.stringify(value),
      }),
      bindings,
    );
  expect((await send(body)).status).toBe(200);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await fetch.mock.calls[0][0].json()).toMatchObject(body);
  get.mockClear();
  fetch.mockClear();
  for (const invalidImage of [
    "https://example.com/image.jpg",
    "data:image/jpeg;base64," +
      btoa(atob(image().split(",")[1]) + "\0".repeat(337500)),
    image(641),
    image(32, 641),
    image(0),
  ]) {
    expect((await send({ ...body, image: invalidImage })).status).toBe(400);
  }
  expect((await send(body, "460001")).status).toBe(413);
  // A valid frame with excess JSON padding reaches the streamed byte cap, even without a length header.
  expect((await send({ ...body, padding: "x".repeat(460001) })).status).toBe(
    413,
  );
  expect(get).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
