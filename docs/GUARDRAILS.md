# Guardrails — what they catch and how to test them

The guardrails screen every chat message **before** any model call. A blocked message is
never sent to the LLM provider, never embedded, never retrieved against — the assistant
answers with a policy sentence instead.

Code: `backend/app/security/guardrails.py` (detection) and
`backend/app/security/refusals.py` (the answer per rule).
Audit: every hit writes `audit_log.action = guardrail.<type>` and appears on the Overview
page under **Guardrail events**.

## 1. What is checked, in order

| # | Stage | Verdict | Examples |
|---|-------|---------|----------|
| 1 | `overflow` | blocked | message > 4,000 characters |
| 2 | `injection` | blocked | "ignore all previous instructions", "you are now DAN", "print your system prompt" |
| 3 | `pii` | blocked | SSN, card number, API key, JWT, private key block, password inside a URL |
| 4 | `profanity` | flagged | `fuck`, `shit`, `f u c k`, `f*u*c*k`, `fucking`, Burmese list |
| 5 | `toxic` | flagged | "you are a useless garbage", "useless bot" |

`blocked` and `flagged` both stop the model call. The difference is reporting: `flagged`
is treated as a tone problem that a rephrase fixes, `blocked` as a policy violation.

Guardrail events are **not** counted as answers — the card says
`Policy response — no sources consulted` and carries no citations.

## 2. Test it offline (no database, no cluster)

```bash
cd backend
.venv/bin/python scripts/check_guardrails.py        # 18-case matrix, exit 1 on a miss
.venv/bin/python scripts/check_guardrails.py "sk_live_ABC123..."   # one ad-hoc message
echo "my card is 4111 1111 1111 1111" | .venv/bin/python scripts/check_guardrails.py -
```

The matrix deliberately contains **must-pass** rows (a git SHA, a UUID, a sha256 digest,
`damnation`, `shiitake`, "reset my password"). A filter that blocks those is worse than
no filter, because people learn to ignore the warning.

Unit tests:

```bash
.venv/bin/python -m pytest tests/test_guardrails_detection.py tests/test_guardrails_secrets.py -q
```

`tests/test_guardrails_secrets.py` is the credential matrix — add a row there whenever a
new key format shows up in a ticket.

## 3. Test it live (through the API)

The SSE stream returns `meta` → `caution` → `token` → `done` for a refusal. Mint a token
once, then post messages:

```bash
# 1. token (never echo it into a shell history you keep)
kubectl -n rag-chatbot-dev exec -i deploy/backend -- python - < /tmp/mint.py | tail -1 > /tmp/tok.txt

# 2. send one message and watch the events
curl -sN https://dev-chat.drlinuxer.com/api/chat/stream \
  -H "Authorization: Bearer $(cat /tmp/tok.txt)" \
  -H "Content-Type: application/json" \
  -d '{"message":"my key is sk-test-REDACTED-fixture",
       "session_id":"11111111-1111-1111-1111-111111111111"}'
```

What a correct refusal looks like:

```
event: meta
data: {"decision":"guardrail","guardrail":{"type":"pii","action":"blocked"},"hits":[]}

event: caution
data: {"type":"pii","blocked":true,"message":"I can't accept that message because …"}

event: token
data: {"token":"I can't accept that message because …"}

event: done
data: {"message_id":"164","guardrail":"pii"}
```

Checklist:

- `decision` is `guardrail`, not `answer`
- `hits` is empty and no `event: sources` arrives
- the answer is the rule-specific refusal, and it does **not** quote the secret back
- `message_id` is non-empty (the refusal was stored, so it survives a reload)
- `audit_log` gained a `guardrail.pii` row

## 4. In the UI

1. Open **Chat**, paste a test key (use a fake one).
2. The answer card shows an amber strip: `Blocked by content policy · personal or secret
   data`, and the provenance reads `Policy response — no sources consulted`.
3. Reload the page — the refusal is still there.
4. **Overview → Guardrail events** shows the row with type `PII Leak Prevented` and risk
   level `Medium`.

## 5. Adding a rule

- **A new secret format**: append `(regex, label)` to `_PII_PATTERNS`, most specific
  first. Patterns compile with `re.IGNORECASE`, so a case-sensitive look-ahead needs the
  `(?-i:…)` scope (a plain `[A-Z]` also matches lowercase there).
- **A new abusive word**: add the root to `_PROFANITY_ROOTS` — the obfuscation handling
  (repeats, separators, suffixes) is generated from the root, do not write the pattern by
  hand.
- **A new refusal sentence**: `REFUSALS` in `refusals.py`. It must not echo the offending
  text and must tell the user what to change.

After any change: run the matrix, then `pytest tests/test_guardrails_*.py`, then bump the
backend tag and deploy.
