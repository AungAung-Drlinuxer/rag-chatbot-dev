"""Small talk must be answered directly, never through retrieval.

The regression this guards: asking "Hi" ran the full RAG pipeline, produced a low
confidence answer built from unrelated context, and rendered three KB articles under a
greeting. Two properties have to hold at once, and they pull in opposite directions:

  * a greeting is recognised, so it costs no retrieval and cites no sources
  * a question that merely *starts* with a greeting is not swallowed, because
    "hi how do I reset my VPN password" is the most common real message of all
"""
from app.smalltalk import classify, normalise, reply

GREETING_ANSWER = "Hello! I'm your internal IT support assistant. How can I help you today?"


def test_plain_greetings_are_classified():
    for msg in ["Hi", "hi!", "Hello", "HELLO", "hey", "hi there", "Good morning",
                "မင်္ဂလာပါ", "  hi  "]:
        assert classify(msg) == "greeting", msg


def test_punctuation_and_emoji_do_not_hide_a_greeting():
    assert classify("Hi!! 👋") == "greeting"
    assert classify("hello...") == "greeting"
    assert classify("Good evening ✦") == "greeting"


def test_question_that_starts_with_a_greeting_is_not_small_talk():
    # The whole point: these must reach retrieval.
    for msg in [
        "hi how do I reset my VPN password",
        "hello, the printer on floor 3 is offline",
        "hey can you check if postgres is up",
        "good morning — I can't log in to Jira",
    ]:
        assert classify(msg) is None, msg


def test_long_messages_are_never_small_talk():
    assert classify("hi " + "x" * 80) is None


def test_thanks_bye_identity_and_ack_are_recognised():
    assert classify("thanks!") == "thanks"
    assert classify("thank you") == "thanks"
    assert classify("ကျေးဇူးတင်ပါတယ်") == "thanks"
    assert classify("bye") == "bye"
    assert classify("who are you?") == "identity"
    assert classify("what can you do") == "identity"
    assert classify("ok") == "ack"
    assert classify("Got it, thanks") in {"ack", "thanks"}


def test_how_are_you_is_its_own_kind():
    assert classify("how are you") == "how_are_you"
    assert classify("How's it going?") == "how_are_you"


def test_real_questions_are_left_alone():
    for msg in [
        "How do I restart PgBouncer?",
        "VPN drops every 20 minutes",
        "What is the escalation path for a P1?",
        "PostgreSQL is refusing connections",
        "what is the capital of France",
    ]:
        assert classify(msg) is None, msg


def test_empty_and_symbol_only_messages_are_not_small_talk():
    assert classify("") is None
    assert classify("   ") is None
    assert classify("???") is None
    assert classify("🚀") is None


def test_reply_is_deterministic_and_has_no_source_language():
    assert reply("greeting") == GREETING_ANSWER
    assert reply("greeting") == reply("greeting")
    assert "knowledge base" not in reply("greeting").lower()
    assert reply("unknown-kind") == GREETING_ANSWER


def test_normalise_keeps_burmese_letters():
    assert normalise("မင်္ဂလာပါ။") == "မင်္ဂလာပါ"
    assert normalise("  Hi   THERE!! ") == "hi there"
