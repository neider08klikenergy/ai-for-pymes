import assert from "node:assert/strict";
import { test } from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-key";

const { validateMediaUrl, downloadAndStoreMedia } = await import("./media-handler.ts");

test("each provider may only make us download from its own host (SEC-08)", () => {
  assert.equal(validateMediaUrl("ycloud", "https://api.ycloud.com/v2/media/x"), true);
  assert.equal(validateMediaUrl("kapso", "https://api.kapso.ai/media/x?token=t"), true);
  assert.equal(validateMediaUrl("ycloud", "https://api.kapso.ai/media/x"), false);
  assert.equal(validateMediaUrl("kapso", "https://api.ycloud.com/v2/media/x"), false);
  assert.equal(validateMediaUrl("kapso", "https://api.kapso.ai.evil.com/x"), false);
  assert.equal(validateMediaUrl("ycloud", "not a url"), false);
  // Kapso también entrega por app.kapso.ai (Active Storage)
  assert.equal(validateMediaUrl("kapso", "https://app.kapso.ai/rails/active_storage/blobs/redirect/abc/img.jpeg"), true);
  assert.equal(validateMediaUrl("kapso", "http://app.kapso.ai/x"), false);
  assert.equal(validateMediaUrl("ycloud", "https://app.kapso.ai/x"), false);
});

test("the API key goes to YCloud only; Kapso URLs are pre-signed", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response("nope", { status: 404 }); // stop before storage
  }) as typeof fetch;
  try {
    const base = { workspaceId: "ws", conversationId: "conv" };
    await downloadAndStoreMedia({ ...base, provider: "ycloud", link: "https://api.ycloud.com/m", apiKey: "yk" });
    await downloadAndStoreMedia({ ...base, provider: "kapso", link: "https://api.kapso.ai/m?token=t", apiKey: "leak" });
    assert.deepEqual(
      (calls[0].init?.headers as Record<string, string>)["X-API-Key"],
      "yk",
    );
    assert.equal(calls[1].init, undefined, "no headers (and no key) for Kapso");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a link on the wrong host is refused without any request", async () => {
  let called = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    called = true;
    return new Response("", { status: 200 });
  }) as typeof fetch;
  try {
    const res = await downloadAndStoreMedia({
      provider: "kapso",
      link: "https://169.254.169.254/latest/meta-data",
      workspaceId: "ws",
      conversationId: "conv",
    });
    assert.equal(res, null);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("Zernio: API de Zernio y CDN de Meta (https); nada más", () => {
  assert.equal(validateMediaUrl("zernio", "https://zernio.com/api/v1/whatsapp/media/1"), true);
  assert.equal(validateMediaUrl("zernio", "https://scontent-bog1-1.cdninstagram.com/v/x.jpg"), true);
  assert.equal(validateMediaUrl("zernio", "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1"), true);
  assert.equal(validateMediaUrl("zernio", "https://scontent.xx.fbcdn.net/v/y.png"), true);
  assert.equal(validateMediaUrl("zernio", "http://zernio.com/api/v1/whatsapp/media/1"), false);
  assert.equal(validateMediaUrl("zernio", "https://evil.com/fbcdn.net"), false);
  assert.equal(validateMediaUrl("zernio", "https://fbcdn.net.evil.com/x"), false);
  assert.equal(validateMediaUrl("kapso", "https://zernio.com/api/v1/whatsapp/media/1"), false);
});
