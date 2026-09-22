// Local protocol check for the cup2 signing edge (S005/T4).
// Generates a throwaway ECDSA P-256 keypair, starts the same handler the
// container runs, sends a real CupClient-wrapped Omaha-style update request,
// and verifies the response: HTTP 200, Omaha-shaped body, and an
// X-Cup-Server-Proof that CupClient.verify() accepts.
//
// Run:  cd services/deploy/fly/cup2
//       deno run --allow-net --allow-env check.ts
// Requires deno; no deploy and no secrets needed.

import { CupClient, CupServer } from "@imput/cup2";
import { createHandler, type UpdateEntry } from "./main.ts";

const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
);

const manifest: Record<string, UpdateEntry> = {
    "zenmium-test-app": {
        version: "1.2.3",
        codebase: "https://zenmium-updates.fly.dev/assets/zenmium-1.2.3.dmg",
        hash_sha256: "00".repeat(32),
        size: 12345678,
    },
};

const handler = createHandler(new CupServer({ 1: pair.privateKey }), manifest);
const server = Deno.serve({ port: 0, onListen: () => {} }, handler);

let ok = true;
const check = (name: string, cond: boolean) => {
    console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
    if (!cond) ok = false;
};

try {
    const port = (server.addr as Deno.NetAddr).port;
    const client = new CupClient(1, pair.publicKey);

    const body = JSON.stringify({
        request: {
            protocol: "3.0",
            app: [{ appid: "zenmium-test-app", updatecheck: {} }],
        },
    });

    // wrap() sets ?cup2key=<id>:<nonce> and ?cup2hreq=<sha256(body)>
    const { request, ticket } = await client.wrap(
        new Request(`http://127.0.0.1:${port}/update`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
        }),
    );
    const res = await fetch(request);

    check("response status 200", res.status === 200);
    check(
        "X-Cup-Server-Proof header present",
        typeof res.headers.get("x-cup-server-proof") === "string",
    );

    const json = await res.clone().json();
    check(
        "response is Omaha-shaped (response.app[].updatecheck)",
        json?.response?.app?.[0]?.updatecheck?.status === "ok"
            && json.response.app[0].appid === "zenmium-test-app",
    );

    try {
        await client.verify(res, ticket);
        check("signature verifies via CupClient.verify", true);
    } catch {
        check("signature verifies via CupClient.verify", false);
    }

    // Negative path: no cup2key means the client did not request a proof.
    const unsigned = await fetch(`http://127.0.0.1:${port}/update`, { method: "POST", body });
    check(
        "unsigned response when cup2key absent",
        unsigned.status === 200 && unsigned.headers.get("x-cup-server-proof") === null,
    );
    await unsigned.body?.cancel();
} finally {
    await server.shutdown();
}

Deno.exit(ok ? 0 : 1);
