// Static file server for the zenmium-updates app (S005/T4, Zenmium-owned glue).
// Serves util/sparkler's output: appcast-<arch>.xml from APPCAST_PUBLIC_DIR,
// and when SERVE_ASSETS_LOCALLY is enabled, release binaries from ASSETS_DIR
// under /assets/<name> (sparkler emits relative `assets/<name>` enclosure URLs
// in that mode). Runs as the `web` process; sparkler runs as `worker` and only
// writes files.

const appcastDir = Deno.env.get("APPCAST_PUBLIC_DIR") ?? "/srv/appcasts";
const assetsDir = Deno.env.get("ASSETS_DIR") ?? "/srv/assets";
const port = Number(Deno.env.get("PORT") ?? "8080");

const contentType = (name: string) => {
    if (name.endsWith(".xml")) return "application/xml; charset=utf-8";
    if (name.endsWith(".json")) return "application/json; charset=utf-8";
    if (name.endsWith(".dmg")) return "application/octet-stream";
    return "application/octet-stream";
};

const safeName = (p: string) => {
    const name = p.split("/").pop() ?? "";
    return name === "" || name.startsWith(".") || name.includes("\\")
        ? undefined
        : name;
};

const serveFile = async (dir: string, name: string): Promise<Response> => {
    const fileName = safeName(name);
    if (!fileName) return new Response("not found\n", { status: 404 });
    try {
        const file = await Deno.open(`${dir}/${fileName}`);
        return new Response(file.readable, {
            headers: {
                "content-type": contentType(fileName),
                "cache-control": "public, max-age=300",
            },
        });
    } catch {
        return new Response("not found\n", { status: 404 });
    }
};

Deno.serve({ port }, (req) => {
    const url = new URL(req.url);
    if (req.method !== "GET" && req.method !== "HEAD") {
        return new Response("method not allowed\n", { status: 405 });
    }
    if (url.pathname === "/healthz") return new Response("ok\n");
    if (url.pathname.startsWith("/assets/")) {
        return serveFile(assetsDir, url.pathname.slice("/assets/".length));
    }
    return serveFile(appcastDir, url.pathname.replace(/^\//, ""));
});
