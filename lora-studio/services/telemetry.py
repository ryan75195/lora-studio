"""Simple telemetry logging for LoRA Studio.

Logs AI builder queries, generation requests, and user actions
to a local JSONL file for analytics.
"""

import json
from datetime import datetime
from pathlib import Path
from services.config import PROJECT_ROOT

LOG_DIR = PROJECT_ROOT / "data" / "telemetry"
LOG_DIR.mkdir(parents=True, exist_ok=True)

LOG_FILE = LOG_DIR / "events.jsonl"


def log_event(event_type: str, data: dict) -> None:
    """Append an event to the telemetry log."""
    entry = {
        "timestamp": datetime.now().isoformat(),
        "event": event_type,
        **data,
    }
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def get_events(event_type: str = None, limit: int = 100) -> list:
    """Read recent events, optionally filtered by type."""
    if not LOG_FILE.exists():
        return []
    events = []
    for line in LOG_FILE.read_text(encoding="utf-8").strip().split("\n"):
        if not line:
            continue
        try:
            entry = json.loads(line)
            if event_type is None or entry.get("event") == event_type:
                events.append(entry)
        except json.JSONDecodeError:
            continue
    return events[-limit:]


def get_stats() -> dict:
    """Get summary stats from telemetry."""
    events = get_events(limit=10000)
    ai_queries = [e for e in events if e["event"] == "ai_chat"]
    generations = [e for e in events if e["event"] == "generate"]
    accepts = [e for e in events if e["event"] == "accept"]

    # Most common first prompts (new conversations)
    first_prompts = [e["prompt"] for e in ai_queries if e.get("turn") == 1]
    # Average turns per conversation
    conversations = {}
    for e in ai_queries:
        cid = e.get("conversation_id", "")
        if cid:
            conversations[cid] = max(conversations.get(cid, 0), e.get("turn", 1))
    avg_turns = sum(conversations.values()) / max(len(conversations), 1)

    return {
        "total_ai_queries": len(ai_queries),
        "total_generations": len(generations),
        "total_accepted": len(accepts),
        "unique_conversations": len(conversations),
        "avg_turns_per_conversation": round(avg_turns, 1),
        "recent_prompts": [e["prompt"] for e in ai_queries[-20:]],
        "lora_usage": {},
    }
