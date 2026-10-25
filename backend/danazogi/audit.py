"""Hash-chained audit log.

Every entry stores the hash of the previous entry, so editing or deleting any
past entry breaks verification. Entries record who acted (customer, an agent
or the system), what happened, and the model versions behind it.
"""

import hashlib
import json
from datetime import datetime, timezone

GENESIS = "0" * 64


class AuditLog:
    def __init__(self):
        self.entries: list[dict] = []

    def append(self, actor: str, event: str, details: dict | None = None, models: dict | None = None) -> dict:
        prev = self.entries[-1]["hash"] if self.entries else GENESIS
        entry = {"seq": len(self.entries) + 1, "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
                 "actor": actor, "event": event, "details": details or {}, "models": models or {}, "prev": prev}
        entry["hash"] = self._hash(entry)
        self.entries.append(entry)
        return entry

    @staticmethod
    def _hash(entry: dict) -> str:
        body = {k: v for k, v in entry.items() if k != "hash"}
        return hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()

    def verify(self) -> dict:
        prev = GENESIS
        for e in self.entries:
            if e["prev"] != prev or self._hash(e) != e["hash"]:
                return {"valid": False, "broken_at": e["seq"]}
            prev = e["hash"]
        return {"valid": True, "entries": len(self.entries), "head": prev}
