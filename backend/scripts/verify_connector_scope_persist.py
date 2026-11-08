
"""Does the connector scope actually PERSIST and come back?

The unit tests cover validate_scope / _decode_scope. This covers the wiring: request field ->
session row -> list endpoint -> messages endpoint, which is where a column that is added but
never written (or written but never selected) still passes every unit test.
"""
import json, urllib.request, urllib.error, uuid
from app.auth.jwt import create_access_token

tok = create_access_token("AungAung")
H = {"Content-Type": "application/json", "Authorization": "Bearer " + tok}
B = "http://localhost:8000"

def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(B + path, data=data, headers=H, method=method)
    try:
        return json.loads(urllib.request.urlopen(r, timeout=120).read())
    except urllib.error.HTTPError as e:
        return {"__http__": e.code, "body": e.read()[:200].decode()}

def stream(msg, sid, servers=None):
    """POST /api/chat/stream and drain it (the stream persists the scope as a side effect)."""
    body = {"message": msg, "session_id": sid, "context": [], "mode": "infra",
            "llm_provider": "auto"}
    if servers is not None:
        body["servers"] = servers
    r = urllib.request.Request(B + "/api/chat/stream", data=json.dumps(body).encode(),
                               headers=H, method="POST")
    with urllib.request.urlopen(r, timeout=180) as f:
        for _ in f:
            pass

# a fresh conversation, scoped to grafana
sid = str(uuid.uuid4())
stream("Loki က label ဘာတွေရှိလဲ", sid, servers=["grafana"])
print("1. sent a scoped turn (servers=['grafana']) on", sid[:8])

# --- does the LIST endpoint report it?
convs = call("GET", "/api/conversations?limit=50")["conversations"]
mine = [c for c in convs if c["session_id"] == sid]
print("2. GET /api/conversations ->", json.dumps(mine[0]["connector_scope"]) if mine else "NOT LISTED",
      "(row found: %s)" % bool(mine))

# --- does the MESSAGES endpoint report it (that is what the page reads on reload)?
msgs = call("GET", "/api/conversations/%s/messages" % sid)
print("3. GET /api/conversations/{id}/messages -> connector_scope =",
      json.dumps(msgs.get("connector_scope")))

# --- PATCH: a bogus name must NOT be stored as a scope that matches nothing
patched = call("PATCH", "/api/conversations/%s" % sid, {"connector_scope": ["bogus", "GRAFANA"]})
print("4. PATCH connector_scope=['bogus','GRAFANA'] ->", json.dumps(patched))

back = call("GET", "/api/conversations/%s/messages" % sid)["connector_scope"]
print("5. read back ->", json.dumps(back))

# --- widening back to everything
widen = call("PATCH", "/api/conversations/%s" % sid, {"connector_scope": []})
print("6. PATCH connector_scope=[] (widen) ->", json.dumps(widen))
print("7. read back ->", json.dumps(call("GET", "/api/conversations/%s/messages" % sid)["connector_scope"]))

print()
ok = (bool(mine) and mine[0]["connector_scope"] == ["grafana"]
      and msgs.get("connector_scope") == ["grafana"]
      and patched.get("connector_scope") == ["grafana"]        # bogus dropped, case folded
      and back == ["grafana"]
      and widen.get("connector_scope") == []                   # [] = unscoped, stored as NULL
      and call("GET", "/api/conversations/%s/messages" % sid)["connector_scope"] == [])
print("PASS: the scope is written on the turn, read back by both endpoints, validated on"
      " write, and clears back to unscoped." if ok else "FAIL")

# clean up the probe conversation so it does not sit in the real sidebar
d = call("DELETE", "/api/conversations/%s" % sid)
print("cleanup:", json.dumps(d)[:80])
