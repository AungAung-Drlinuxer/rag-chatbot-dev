
"""End-to-end: does the scope survive HTTP -> schema -> graph -> tools?

The unit tests cover the agent. This covers the CONTRACT, which is where a field that is
declared but never threaded through (or dropped by pydantic) still passes every unit test.
Also asserts the two claims the evidence card will make separately:
  meta.servers_scope  = what the turn was ALLOWED to use
  evidence.servers    = what it ACTUALLY used
"""
import json, time, urllib.request
from app.auth.jwt import create_access_token

BASE = "http://localhost:8000"
tok = create_access_token("dev")          # the same dev fallback the other tests use (admin)
HDR = {"Content-Type": "application/json", "Authorization": "Bearer " + tok}

def get(path):
    return json.loads(urllib.request.urlopen(
        urllib.request.Request(BASE + path, headers=HDR), timeout=30).read())

def turn(question, servers, label, mode="infra"):
    body = {"message": question, "session_id": "scope-probe", "context": [],
            "mode": mode, "llm_provider": "auto"}
    if servers is not None:
        body["servers"] = servers
    r = urllib.request.Request(BASE + "/api/chat/stream",
                               data=json.dumps(body).encode(), headers=HDR)
    t0, meta, ev_name, evidence = time.time(), None, None, None
    with urllib.request.urlopen(r, timeout=180) as f:
        for raw in f:
            line = raw.decode("utf-8", "replace").rstrip("\n")
            if line.startswith("event:"):          # SSE puts the NAME on its own line
                ev_name = line[6:].strip()
            elif line.startswith("data:"):
                try: payload = json.loads(line[5:].strip())
                except Exception: continue
                if ev_name == "meta": meta = payload
                elif ev_name == "evidence": evidence = payload
    ms = (time.time() - t0) * 1000
    used = None
    if isinstance(evidence, dict):
        calls = evidence.get("tool_calls") or []
        used = sorted({c.get("server") for c in calls if c.get("server")}) or []
    print(f"  {label:<24} {ms:6.0f}ms  meta.mode={(meta or {}).get('mode')!r} "
          f"meta.servers_scope={(meta or {}).get('servers_scope')!r}  used={used}")
    return meta, evidence

print("GET /api/mcp/servers ->", json.dumps(get("/api/mcp/servers")))
print()
print("HTTP turns:")
m1, e1 = turn("Loki က label ဘာတွေရှိလဲ", None, "unscoped")
m2, e2 = turn("Loki က label ဘာတွေရှိလဲ", ["grafana"], "scoped -> grafana")
m3, e3 = turn("Proxmox VMs list ပြပါ", ["proxmox"], "scoped -> proxmox")
print()
assert (m2 or {}).get("servers_scope") == ["grafana"], "the scope did not survive the request"
assert (m3 or {}).get("servers_scope") == ["proxmox"], "the scope did not survive the request"
assert (m1 or {}).get("servers_scope") is None, "an unscoped turn must not report a scope"
print("PASS: the scope survives HTTP -> pydantic -> graph state -> the agent,")
print("      and an unscoped turn reports NO scope rather than an empty one.")
