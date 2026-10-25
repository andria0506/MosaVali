"""Consent sessions and revocation purge.

Everything derived from a consent lives inside its session object: the raw
bank data, profiles, model outputs, trade proposals, simulator runs and the
audit log. Revoking the consent deletes that object. The receipt keeps only
counts and the final audit-chain hash as proof of what was deleted.

The store is in-memory and single-process only: a server restart ends every
session, and a multi-worker deployment would need a shared store.
"""

import hmac
import secrets
import threading
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from .audit import AuditLog

SCOPES = ("balances", "transactions", "deposits", "loans")


@dataclass
class Session:
    consent_id: str
    token: str
    persona_id: str
    banks: list[str]
    scopes: list[str]
    created: datetime
    expires: datetime
    cash_at_home: float = 0.0
    timeout_bank: str | None = None
    accounts: list[dict] | None = None
    bank_status: dict = field(default_factory=dict)
    cache: dict = field(default_factory=dict)
    trades: list[dict] = field(default_factory=list)
    flights: dict = field(default_factory=dict)
    behaviour_score: int | None = None
    selected_mission: str | None = None
    selected_monthly: float | None = None
    acknowledged: list[str] = field(default_factory=list)
    goal: dict | None = None
    audit: AuditLog = field(default_factory=AuditLog)
    lock: object = field(default_factory=threading.Lock, repr=False, compare=False)

    def public(self) -> dict:
        return {"consent_id": self.consent_id, "persona_id": self.persona_id, "banks": self.banks,
                "scopes": self.scopes, "created": self.created.isoformat(), "expires": self.expires.isoformat(),
                "cash_at_home": self.cash_at_home, "bank_status": self.bank_status, "status": "active"}


class ConsentStore:
    def __init__(self):
        self._sessions: dict[str, Session] = {}
        self._lock = threading.Lock()

    def create(self, persona_id: str, banks: list[str], scopes: list[str], days: int, cash_at_home: float,
               timeout_bank: str | None) -> Session:
        now = datetime.now(timezone.utc)
        s = Session(consent_id=secrets.token_hex(8), token=secrets.token_urlsafe(24), persona_id=persona_id,
                    banks=banks, scopes=scopes, created=now, expires=now + timedelta(days=days),
                    cash_at_home=cash_at_home, timeout_bank=timeout_bank)
        with self._lock:
            self._sessions[s.consent_id] = s
        return s

    def get(self, consent_id: str, token: str | None) -> Session:
        s = self._sessions.get(consent_id)
        if s is None or token is None or not token.isascii() or not hmac.compare_digest(s.token, token):
            raise KeyError(consent_id)
        if s.expires < datetime.now(timezone.utc):
            with self._lock:
                self._sessions.pop(consent_id, None)
            raise KeyError(consent_id)
        return s

    def revoke(self, consent_id: str, token: str) -> dict:
        s = self.get(consent_id, token)
        s.audit.append("customer", "consent.revoked", {"consent_id": consent_id})
        receipt = {
            "consent_id": consent_id,
            "revoked_at": datetime.now(timezone.utc).isoformat(),
            "purged": {"access_tokens": 1, "accounts": len(s.accounts or []),
                       "transactions": sum(len(a.get("transactions", {}).get("booked", [])) for a in s.accounts or []),
                       "derived_results": len(s.cache), "trade_proposals": len(s.trades),
                       "simulator_runs": len(s.flights), "audit_entries": len(s.audit.entries)},
            "audit_head": s.audit.verify().get("head"),
        }
        with self._lock:
            self._sessions.pop(consent_id, None)
        return receipt

    def __contains__(self, consent_id: str) -> bool:
        return consent_id in self._sessions
