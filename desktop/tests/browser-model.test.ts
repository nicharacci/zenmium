import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAddress } from "../src/shared/navigation.ts";

describe("address resolution", () => {
  it("keeps empty input and the supported blank page internal", () => {
    for (const input of ["", " \t\n", "about:blank", "  about:blank  "]) {
      assert.equal(resolveAddress(input), "about:blank", JSON.stringify(input));
    }
  });

  it("canonicalizes explicit web URLs without changing path, query, or fragment meaning", () => {
    const cases = [
      [
        "  HTTPS://Example.COM:443/a/../Docs?q=a%2Bb#Section  ",
        "https://example.com/Docs?q=a%2Bb#Section",
      ],
      ["http://example.com:80", "http://example.com/"],
      ["https://example.com/a b", "https://example.com/a%20b"],
      ["https://example.com:8443/path", "https://example.com:8443/path"],
    ];
    for (const [input, expected] of cases)
      assert.equal(resolveAddress(input!), expected, input);
  });

  it("recognizes bare hosts, IDNs, ports, queries, and fragments as HTTPS addresses", () => {
    const cases = [
      ["example.com", "https://example.com/"],
      [
        "sub-domain.example.com:8443/Docs",
        "https://sub-domain.example.com:8443/Docs",
      ],
      ["example.com?q=a%2Bb#part", "https://example.com/?q=a%2Bb#part"],
      ["example.com#part", "https://example.com/#part"],
      ["bücher.example", "https://xn--bcher-kva.example/"],
    ];
    for (const [input, expected] of cases)
      assert.equal(resolveAddress(input!), expected, input);
  });

  it("opens localhost and loopback development servers using HTTP by default", () => {
    const cases = [
      ["localhost", "http://localhost/"],
      [
        "LOCALHOST:3000/api?q=1#response",
        "http://localhost:3000/api?q=1#response",
      ],
      ["127.0.0.1", "http://127.0.0.1/"],
      ["127.0.0.1:5173/app", "http://127.0.0.1:5173/app"],
    ];
    for (const [input, expected] of cases)
      assert.equal(resolveAddress(input!), expected, input);
  });

  // A query or fragment is a valid host terminator even without an explicit slash.
  for (const [input, expected] of [
    ["localhost:3000?debug=1", "http://localhost:3000/?debug=1"],
    ["localhost#section", "http://localhost/#section"],
    ["127.0.0.1:3000?debug=1", "http://127.0.0.1:3000/?debug=1"],
    ["127.0.0.1#section", "http://127.0.0.1/#section"],
  ]) {
    it(`keeps ${input} on the local HTTP origin`, () => {
      assert.equal(resolveAddress(input!), expected);
    });
  }

  it("preserves explicit IPv4 and IPv6 schemes and ports", () => {
    const cases = [
      ["http://192.168.1.20:8080/status", "http://192.168.1.20:8080/status"],
      ["https://127.0.0.1:9443", "https://127.0.0.1:9443/"],
      ["http://[::1]:3000/", "http://[::1]:3000/"],
      [
        "https://[2001:db8::1]:8443/a?b=c#d",
        "https://[2001:db8::1]:8443/a?b=c#d",
      ],
    ];
    for (const [input, expected] of cases)
      assert.equal(resolveAddress(input!), expected, input);
  });

  it("recognizes a bare IPv4 address without treating it as a search", () => {
    assert.equal(
      resolveAddress("192.168.1.20:8443/status"),
      "https://192.168.1.20:8443/status"
    );
  });

  for (const [input, expected] of [
    ["[::1]:3000/", "http://[::1]:3000/"],
    ["[2001:db8::1]:8443/status", "https://[2001:db8::1]:8443/status"],
  ]) {
    it(`recognizes bare IPv6 address ${input}`, () => {
      assert.equal(resolveAddress(input!), expected);
    });
  }

  it("does not confuse a localhost-looking public domain with loopback", () => {
    assert.equal(
      resolveAddress("localhost.example.com/path"),
      "https://localhost.example.com/path"
    );
    assert.equal(
      resolveAddress("127.0.0.1.example.com"),
      "https://127.0.0.1.example.com/"
    );
  });

  for (const engine of ["duckduckgo", "google"] as const) {
    it(`encodes search text once for ${engine}`, () => {
      const query = "C++ & Rust / 100% ☕";
      const url = new URL(resolveAddress(`  ${query}  `, engine));
      assert.equal(
        url.origin,
        engine === "google"
          ? "https://www.google.com"
          : "https://duckduckgo.com"
      );
      assert.equal(url.pathname, engine === "google" ? "/search" : "/");
      assert.deepEqual([...url.searchParams], [["q", query]]);
      assert.equal(url.hash, "");
    });
  }

  it("searches phrases even when they contain a hostname", () => {
    for (const input of [
      "example.com documentation",
      "localhost development setup",
      "two\nwords",
    ]) {
      const url = new URL(resolveAddress(input));
      assert.equal(url.origin, "https://duckduckgo.com");
      assert.equal(url.searchParams.get("q"), input);
    }
  });

  for (const scheme of [
    "javascript",
    "data",
    "file",
    "chrome",
    "devtools",
    "vbscript",
  ]) {
    it(`rejects ${scheme} addresses before treating them as searches`, () => {
      for (const input of [
        `${scheme}:payload`,
        ` \t${scheme.toUpperCase()}:payload\n`,
      ]) {
        assert.throws(
          () => resolveAddress(input),
          /cannot be opened as a browser tab/,
          input
        );
      }
    });
  }

  it("never returns a privileged or executable target from scheme-like search text", () => {
    for (const input of [
      "java\tscript:alert(1)",
      "data :text/html,test",
      "about:config",
      "blob:https://example.com/id",
      "ftp://example.com/file",
    ]) {
      try {
        const result = resolveAddress(input);
        assert.ok(
          ["http:", "https:"].includes(new URL(result).protocol),
          `${input} resolved to ${result}`
        );
      } catch (error) {
        // Rejecting unsupported schemes is also safe; assertion failures are not.
        if (error instanceof assert.AssertionError) throw error;
        assert.ok(error instanceof Error);
      }
    }
  });

  it("rejects malformed explicit URLs and out-of-range ports", () => {
    for (const input of [
      "http://",
      "https://exa mple.com",
      "https://[::1",
      "http://localhost:65536",
      "192.168.1.999",
    ]) {
      assert.throws(() => resolveAddress(input), TypeError, input);
    }
  });

  it("is idempotent when a renderer-resolved address is submitted to main", () => {
    for (const input of [
      "example.com/Docs?a=%2B#b",
      "localhost:3000/",
      "127.0.0.1:8080/",
      "a search & query",
      "about:blank",
    ]) {
      const target = resolveAddress(input);
      assert.equal(resolveAddress(target), target, input);
    }
  });
});
