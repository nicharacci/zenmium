// zenmium-svc-cup2: Omaha-style update endpoint signed with CUP-ECDSA
// (S005/T4, Zenmium-owned glue around the vendored @imput/cup2 library).
// Clients send an update request carrying ?cup2key=<id>:<nonce> (and optional
// ?cup2hreq=<hex sha256 of body>); the response carries X-Cup-Server-Proof.

import { CupServer } from "@imput/cup2";

export type UpdateEntry = {
    version: string;
    codebase: string;
    hash_sha256: string;
    size: number;
};

const buildUpdateBody = (manifest: Record<string, UpdateEntry>, appids: string[]) => ({
    response: {
        protocol: "3.0",
        server: "zenmium-svc-cup2",
        app: (appids.length ? appids : Object.keys(manifest))
            .filter((id) => manifest[id])
            .map((appid) => {
                const m = manifest[appid];
                return {
                    appid,
                    status: "ok",
                    updatecheck: {
                        status: "ok",
                        urls: { url: [{ codebase: m.codebase }] },
                        manifest: {
                            version: m.version,
                            packages: {
                                package: [{
                                    name: `${appid}-${m.version}`,
                                    hash_sha256: m.hash_sha256,
                                    size: m.size,
                                    required: true,
                                }],
                            },
                            actions: {
                                action: [{ run: m.codebase, event: "postinstall" }],
                            },
                        },
                    },
                };
            }),
    },
});

const requestedAppIds = async (req: Request): Promise<string[]> => {
    try {
        const body = await req.clone().json();
        const apps = body?.request?.app;
        if (Array.isArray(apps)) {
            return apps.map((a) => a?.appid).filter((id) => typeof id === "string");
        }
    } catch {
        // non-JSON (e.g. Omaha XML) bodies: fall through to full manifest
    }
    return [];
};

export const createHandler = (
    cup: CupServer,
    manifest: Record<string, UpdateEntry>,
) =>
async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    if (url.pathname === "/healthz") {
        return new Response("ok\n");
    }
    if (url.pathname !== "/update") {
        return new Response("not found\n", { status: 404 });
    }

    const response = new Response(
        JSON.stringify(buildUpdateBody(manifest, await requestedAppIds(req))),
        { headers: { "content-type": "application/json" } },
    );

    if (!url.searchParams.has("cup2key")) {
        return response; // client did not request a proof
    }

    try {
        const ticket = await cup.makeTicket(req);
        return await cup.sign(response, ticket);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return new Response(`cup error: ${msg}\n`, { status: 400 });
    }
};

if (import.meta.main) {
    const keyId = Number(Deno.env.get("CUP2_KEY_ID") ?? "1");
    const b64 = Deno.env.get("CUP2_PRIVATE_KEY_PKCS8_B64");
    if (!b64) {
        throw new Error("CUP2_PRIVATE_KEY_PKCS8_B64 is required");
    }
    const key = await crypto.subtle.importKey(
        "pkcs8",
        Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign"],
    );

    const manifest: Record<string, UpdateEntry> = JSON.parse(
        Deno.env.get("UPDATE_MANIFEST_JSON") ?? "{}",
    );
    const port = Number(Deno.env.get("PORT") ?? "8080");
    Deno.serve({ port, hostname: "::" }, createHandler(new CupServer({ [keyId]: key }), manifest));
}
