#!/usr/bin/env bash
# pair-smoke.sh — paired-client smoke test for the internal control plane.
#
# Usage: pair-smoke.sh [path-to-Zenmium-binary-or-app]
#
# Mechanical proof of the v1 loop against the Go daemon:
#   hello -> workspace bind -> pair (scripted consent) -> token ->
#   MCP zenmium_session create -> zenmium_action observe -> navigate ->
#   zenmium_events
#
# With a real built Zenmium binary the same flow exercises the actual
# component extension; without one, a simulated extension over the relay
# socket stands in (the same frames the real extension sends).
set -euo pipefail

APP="${1:-}"
DATA_DIR="$(mktemp -d /tmp/zenmium-smoke.XXXXXX)"
D="${ZENMIUMD_BIN:-zenmiumd}"
CTL="${ZENMIUMCTL_BIN:-zenmiumctl}"
SOCK="$HOME/Library/Application Support/Zenmium/internal/control.sock"
BRIDGE_JSON="$DATA_DIR/bridge.json"

cleanup() {
  [[ -n "${DPID:-}" ]] && kill "$DPID" 2>/dev/null || true
  [[ -n "${EXT_PID:-}" ]] && kill "$EXT_PID" 2>/dev/null || true
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

echo "[smoke] data dir: $DATA_DIR"
"$D" -data-dir "$DATA_DIR" -no-kernel -bridge-file "$BRIDGE_JSON" &
DPID=$!
sleep 0.7

echo "[smoke] simulating extension over relay socket"
python3 - "$SOCK" <<'PY' &
import json, socket, struct, sys, time
sock = socket.socket(socket.AF_UNIX)
deadline = time.time() + 10
while True:
    try:
        sock.connect(sys.argv[1]); break
    except OSError:
        if time.time() > deadline: raise
        time.sleep(0.1)
def send(o):
    b = json.dumps(o).encode()
    sock.sendall(struct.pack("<I", len(b)) + b)
def recv():
    hdr = b""
    while len(hdr) < 4: hdr += sock.recv(4 - len(hdr))
    n = struct.unpack("<I", hdr)[0]
    buf = b""
    while len(buf) < n: buf += sock.recv(n - len(buf))
    return json.loads(buf)
send({"kind":"hello","nonce":"smoke-nonce","profileId":"Profile 1","profileName":"Default"})
assert recv()["kind"] == "bound"
while True:
    m = recv()
    k = m["kind"]
    if k == "pair.request":
        send({"kind":"pair.respond","pairId":m["pairId"],"approve":True})
    elif k == "exec":
        cmd = m.get("command")
        if cmd == "observe":
            send({"kind":"exec.result","id":m["id"],"ok":True,
                  "result":{"documentId":"doc-smoke-1","url":"https://fixture.local/"}})
        elif cmd == "navigate":
            send({"kind":"exec.result","id":m["id"],"ok":True,"result":{}})
            send({"kind":"watched","sessionId":m.get("sessionId",""),"url":"https://fixture.local/nav"})
        else:
            send({"kind":"exec.result","id":m["id"],"ok":True,"result":{}})
PY
EXT_PID=$!

echo "[smoke] pairing (auto-consent)"
"$CTL" pair -label smoke -caps observe,navigate -ttl 600 > "$DATA_DIR/pair.out"
TOKEN="$(grep '^token=' "$DATA_DIR/pair.out" | cut -d= -f2)"
[[ -n "$TOKEN" ]] || { echo "[smoke] no token"; exit 1; }
echo "[smoke] pair OK"

sleep 0.2
MCP_URL="$(python3 -c "import json;print(json.load(open('$BRIDGE_JSON'))['url'])")"
MCP_TOKEN="$(python3 -c "import json;print(json.load(open('$BRIDGE_JSON'))['token'])")"
WS_ID="$("$CTL" status | python3 -c "import json,sys;print(json.load(sys.stdin)['workspaces'][0]['id'])")"
echo "[smoke] workspace $WS_ID via bridge $MCP_URL"

mcp() {
  python3 - "$MCP_URL" "$MCP_TOKEN" "$1" <<'PY'
import json, sys, urllib.request
url, tok, body = sys.argv[1], sys.argv[2], sys.argv[3]
req = urllib.request.Request(url, data=body.encode(),
    headers={"Content-Type":"application/json","Authorization":"Bearer "+tok})
print(urllib.request.urlopen(req, timeout=10).read().decode())
PY
}

call() { # tool name, args json
  mcp "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":$2}}"
}

echo "[smoke] zenmium_capabilities"
call zenmium_capabilities "{\"grantToken\":\"$TOKEN\"}" | grep -q observe || { echo "[smoke] capabilities FAIL"; exit 1; }

echo "[smoke] zenmium_session create"
OUT="$(call zenmium_session "{\"grantToken\":\"$TOKEN\",\"op\":\"create\",\"workspaceId\":\"$WS_ID\"}")"
SID="$(echo "$OUT" | python3 -c "import json,sys;print(json.loads(json.load(sys.stdin)['result']['content'][0]['text'])['id'])")"
[[ "$SID" == control_* ]] || { echo "[smoke] session FAIL: $OUT"; exit 1; }
echo "[smoke] session $SID"

echo "[smoke] zenmium_action observe"
call zenmium_action "{\"grantToken\":\"$TOKEN\",\"sessionId\":\"$SID\",\"requestId\":\"s1\",\"command\":\"observe\"}" | grep -q documentId || { echo "[smoke] observe FAIL"; exit 1; }

echo "[smoke] zenmium_action navigate"
call zenmium_action "{\"grantToken\":\"$TOKEN\",\"sessionId\":\"$SID\",\"requestId\":\"s2\",\"command\":\"navigate\",\"args\":{\"url\":\"https://fixture.local/nav\"}}" | grep -q 'ok\\":true' || { echo "[smoke] navigate FAIL"; exit 1; }

echo "[smoke] zenmium_events"
call zenmium_events "{\"grantToken\":\"$TOKEN\",\"sessionId\":\"$SID\"}" | grep -q 'session.navigated\|action.ok' || { echo "[smoke] events FAIL"; exit 1; }

# Negative checks: Origin header and missing bearer must be refused.
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$MCP_URL" -H "Origin: https://evil.example" -H "Content-Type: application/json" -d '{}')
[[ "$code" == "403" ]] || { echo "[smoke] Origin guard FAIL ($code)"; exit 1; }
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$MCP_URL" -H "Content-Type: application/json" -d '{}')
[[ "$code" == "401" ]] || { echo "[smoke] bearer guard FAIL ($code)"; exit 1; }

echo "[smoke] PASS"
