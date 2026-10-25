"""MosaVali HTTP API.

Run:  uvicorn danazogi.api:app --reload   (from the backend folder)

Every session endpoint needs the consent token in the X-Consent-Token header.
Revoking a consent deletes everything derived from it.
"""

import math
import re
from collections.abc import Iterator
from pathlib import Path
from typing import Annotated, Literal

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field, field_validator, model_validator

from . import orchestrator as orch
from .consent import SCOPES, ConsentStore, Session
from .data.market import ASSETS, CPI_SOURCE, EPISODES, MACRO, market_snapshot
from .data.mock_open_banking import BANKS, PERSONAS, organiser_cards, persona_cards, probe_tbc_sandbox
from .data.organiser_xlsx import cached_tbc_status
from .data.replay import SOURCE as REPLAY_SOURCE
from .ml import registry

app = FastAPI(title="MosaVali", version="1.0.0")
store = ConsentStore()
MissionKey = Literal["protect", "goal", "balance", "growth"]
Monthly = Annotated[float | None, Query(ge=0, le=100_000, allow_inf_nan=False)]


class ConsentIn(BaseModel):
    persona_id: str
    banks: list[str]
    scopes: list[str] = Field(default_factory=lambda: list(SCOPES))
    duration_days: int = Field(90, ge=1, le=180)
    cash_at_home: float | None = Field(None, ge=0, le=1_000_000, allow_inf_nan=False)
    simulate_timeout: str | None = None


class SelectIn(BaseModel):
    mission: MissionKey
    acknowledge: list[str] = Field(default_factory=list)
    monthly: float | None = Field(None, ge=0, le=100_000, allow_inf_nan=False)


class TradeIn(BaseModel):
    decision: Literal["approve", "reject", "edit"]
    amount_gel: float | None = Field(None, gt=0, le=10_000_000, allow_inf_nan=False)


class SandboxStartIn(BaseModel):
    mission: MissionKey
    chapters: list[Literal["S08", "S15", "S20", "S22"]] | None = Field(None, max_length=4)


class SandboxStepIn(BaseModel):
    action: Literal["hold", "sell", "rebalance", "buy"] = "hold"
    until_decision: bool = False


class GoalIn(BaseModel):
    kind: Literal["car", "apartment", "education", "preserve", "retirement", "business"]
    amount: float = Field(gt=0, le=10_000_000, allow_inf_nan=False)
    currency: Literal["GEL", "USD"] = "GEL"
    years: int = Field(ge=1, le=15)


class StockCheckIn(BaseModel):
    profile: Literal["big_tech", "ge_bank", "local_small"]
    share: float = Field(0.10, ge=0.05, le=0.30, allow_inf_nan=False)
    mission: MissionKey | None = None
    monthly: float | None = Field(None, ge=0, le=100_000, allow_inf_nan=False)


class CustomCustomerIn(BaseModel):
    label: str = "Custom customer"
    age: int = Field(30, ge=18, le=90)
    region: Literal["tbilisi", "adjara", "imereti", "other"] = "tbilisi"
    household: int = Field(1, ge=1, le=8)
    bank: str = "MT"
    income_kind: Literal["salary", "pension", "business"] = "salary"
    monthly_income: float = Field(0.0, ge=0, le=100_000, allow_inf_nan=False)
    pay_day: int = Field(25, ge=1, le=28)
    rent: float = Field(0.0, ge=0, le=50_000, allow_inf_nan=False)
    utilities: float = Field(0.0, ge=0, le=50_000, allow_inf_nan=False)
    groceries: float = Field(0.0, ge=0, le=50_000, allow_inf_nan=False)
    transport: float = Field(0.0, ge=0, le=50_000, allow_inf_nan=False)
    delivery: float = Field(0.0, ge=0, le=50_000, allow_inf_nan=False)
    dining: float = Field(0.0, ge=0, le=50_000, allow_inf_nan=False)
    taxi: float = Field(0.0, ge=0, le=50_000, allow_inf_nan=False)
    other: float = Field(0.0, ge=0, le=50_000, allow_inf_nan=False)
    usd_loan_instalment: float = Field(0.0, ge=0, le=20_000, allow_inf_nan=False)
    usd_loan_balance: float = Field(0.0, ge=0, le=1_000_000, allow_inf_nan=False)
    gel_current: float = Field(0.0, ge=0, le=10_000_000, allow_inf_nan=False)
    gel_savings: float = Field(0.0, ge=0, le=10_000_000, allow_inf_nan=False)
    gel_term_deposit: float = Field(0.0, ge=0, le=10_000_000, allow_inf_nan=False)
    usd_savings: float = Field(0.0, ge=0, le=10_000_000, allow_inf_nan=False)
    cash_at_home: float = Field(0.0, ge=0, le=1_000_000, allow_inf_nan=False)
    goal: GoalIn

    @field_validator("label")
    @classmethod
    def _label(cls, v: str) -> str:
        v = v.strip()
        if not v:
            return "Custom customer"
        if len(v) > 40:
            raise ValueError("label must be at most 40 characters")
        return v

    @field_validator("bank")
    @classmethod
    def _bank(cls, v: str) -> str:
        if v not in BANKS:
            raise ValueError(f"Unknown bank {v}")
        return v

    @model_validator(mode="after")
    def _loan_pair(self):
        if (self.usd_loan_instalment > 0) != (self.usd_loan_balance > 0):
            raise ValueError("A USD loan instalment needs a balance, and a balance needs an instalment")
        return self


def session(consent_id: str, x_consent_token: str | None = Header(None)) -> Iterator[Session]:
    try:
        s = store.get(consent_id, x_consent_token)
    except KeyError:
        raise HTTPException(404, "Consent not found, expired or revoked")
    with s.lock:
        try:
            store.get(consent_id, x_consent_token)  # consent may have been revoked while waiting on the lock
        except KeyError:
            raise HTTPException(404, "Consent not found, expired or revoked")
        yield s


@app.exception_handler(orch.ComplianceError)
def _compliance(_, exc: orch.ComplianceError):
    return JSONResponse(status_code=409, content={"error": str(exc), **exc.detail})


@app.exception_handler(RequestValidationError)
def _request_validation(_, exc: RequestValidationError):
    return JSONResponse(status_code=422, content={
        "detail": jsonable_encoder(exc.errors(), custom_encoder={float: lambda v: v if math.isfinite(v) else str(v),
                                                                 ValueError: str})})


@app.exception_handler(ValueError)
def _value(_, exc: ValueError):
    return JSONResponse(status_code=422, content={"error": str(exc)})


@app.get("/api/health")
def health():
    return {"status": "ok", "models": orch.model_versions()}


@app.get("/api/personas")
def personas():
    return {"personas": persona_cards(), "organiser_customers": organiser_cards(),
            "tbc_sandbox": cached_tbc_status(), "banks": BANKS, "scopes": SCOPES,
            "synthetic": "All people, banks, merchants and transactions are synthetic."}


@app.get("/api/tbc-status")
def tbc_status(force: bool = False):
    return probe_tbc_sandbox(force=force)


@app.get("/api/market")
def market():
    return {"snapshot": market_snapshot(), "assets": [a.public() for a in ASSETS], "macro": MACRO,
            "episodes": EPISODES, "cpi_source": CPI_SOURCE, "replay_source": REPLAY_SOURCE}


@app.get("/api/models")
def models():
    return registry.model_cards()


@app.post("/api/consents", status_code=201)
def create_consent(body: ConsentIn):
    p = PERSONAS.get(body.persona_id)
    if p is None:
        raise HTTPException(404, "Unknown persona")
    if any(b not in p["banks"] for b in body.banks):
        raise HTTPException(422, "This customer has no accounts at one of the selected banks")
    banks = list(dict.fromkeys(body.banks))
    if not banks:
        raise HTTPException(422, "Select at least one bank where this customer has accounts")
    if any(x not in SCOPES for x in body.scopes):
        raise HTTPException(422, "Unknown consent scope")
    if not {"balances", "transactions"} <= set(body.scopes):
        raise HTTPException(422, "Balances and transactions are required for the analysis")
    if body.simulate_timeout and body.simulate_timeout not in banks:
        raise HTTPException(422, "simulate_timeout must be one of the selected banks")
    s = store.create(body.persona_id, banks, list(dict.fromkeys(body.scopes)), body.duration_days,
                     p["cash_at_home"] if body.cash_at_home is None else body.cash_at_home, body.simulate_timeout)
    s.audit.append("customer", "consent.granted", {"banks": banks, "scopes": s.scopes, "days": body.duration_days,
                                                   "cash_at_home_declared": s.cash_at_home})
    return {"consent_id": s.consent_id, "token": s.token, **s.public()}


@app.post("/api/custom-customers", status_code=201)
def custom_customer(body: CustomCustomerIn):
    from .data import custom_customer as cc
    from .data.mock_open_banking import _card
    try:
        pid = cc.create(body)
    except cc.LimitReached as e:
        raise HTTPException(409, str(e))
    return {"persona_id": pid, "persona": _card(PERSONAS[pid]),
            "synthetic": "Synthetic: generated from the numbers you typed, not bank data."}


@app.get("/api/consents/{consent_id}")
def get_consent(s: Session = Depends(session)):
    return s.public()


@app.delete("/api/consents/{consent_id}")
def revoke_consent(s: Session = Depends(session)):
    try:
        return store.revoke(s.consent_id, s.token)
    except KeyError:
        raise HTTPException(404, "Consent not found, expired or revoked")


@app.get("/api/sessions/{consent_id}/profile")
def profile(s: Session = Depends(session)):
    return orch.profile(s)


@app.put("/api/sessions/{consent_id}/goal")
def goal(body: GoalIn, s: Session = Depends(session)):
    return orch.update_goal(s, body.kind, body.amount, body.currency, body.years)


@app.get("/api/sessions/{consent_id}/missions")
def missions(monthly: Monthly = None, focus: MissionKey | None = None, s: Session = Depends(session)):
    return orch.missions_view(s, monthly, focus)


@app.get("/api/sessions/{consent_id}/funds")
def funds(monthly: Monthly = None, mission: MissionKey | None = None, s: Session = Depends(session)):
    return orch.funds_view(s, monthly, mission)


@app.post("/api/sessions/{consent_id}/stock-check")
def stock_check(body: StockCheckIn, s: Session = Depends(session)):
    return orch.stock_check(s, body.profile, body.share, body.mission, body.monthly)


@app.post("/api/sessions/{consent_id}/plan")
def select(body: SelectIn, s: Session = Depends(session)):
    return orch.select_mission(s, body.mission, body.acknowledge, body.monthly)


@app.get("/api/sessions/{consent_id}/explain")
def explain(mission: MissionKey, monthly: Monthly = None, s: Session = Depends(session)):
    return orch.explanation(s, mission, monthly)


@app.get("/api/sessions/{consent_id}/trades")
def trades(s: Session = Depends(session)):
    return {"mission": s.selected_mission, "monthly": s.selected_monthly, "trades": s.trades}


@app.post("/api/sessions/{consent_id}/trades/{trade_id}")
def decide(trade_id: str, body: TradeIn, s: Session = Depends(session)):
    try:
        return orch.decide_trade(s, trade_id, body.decision, body.amount_gel)
    except KeyError:
        raise HTTPException(404, "Unknown trade")


@app.get("/api/sessions/{consent_id}/instruction")
def instruction(s: Session = Depends(session)):
    return orch.instruction(s)


@app.post("/api/sessions/{consent_id}/sandbox")
def sandbox_start(body: SandboxStartIn, s: Session = Depends(session)):
    return orch.sandbox_start(s, body.mission, body.chapters)


@app.post("/api/sessions/{consent_id}/sandbox/{flight_id}/step")
def sandbox_step(flight_id: str, body: SandboxStepIn, s: Session = Depends(session)):
    if flight_id not in s.flights:
        raise HTTPException(404, "Unknown simulator run")
    return orch.sandbox_step(s, flight_id, body.action, body.until_decision)


@app.get("/api/sessions/{consent_id}/audit")
def audit(s: Session = Depends(session)):
    return orch.audit_view(s)


YAHOO = "https://query1.finance.yahoo.com"
YAHOO_HEADERS = {"User-Agent": "Mozilla/5.0 (MosaVali prototype)"}
# Read-only relay for the two Yahoo endpoints the webapp's market/news widgets use
# (mirrors the reference server/index.mjs). Anything else is a 404.
YAHOO_ALLOWED = re.compile(r"^(v1/finance/search|v8/finance/chart/)")


@app.get("/api/yahoo/{path:path}", include_in_schema=False)
async def yahoo_relay(path: str, request: Request) -> Response:
    if not YAHOO_ALLOWED.match(path):
        raise HTTPException(404)
    url = f"{YAHOO}/{path}"
    if request.url.query:
        url += f"?{request.url.query}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            upstream = await client.get(url, headers=YAHOO_HEADERS)
    except httpx.HTTPError:
        return JSONResponse({"error": "upstream unavailable"}, status_code=502)
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers={
            "Content-Type": upstream.headers.get("content-type") or "application/json",
            "Cache-Control": "public, max-age=300",
        },
    )


REPO = Path(__file__).resolve().parents[2]
WEBAPP_DIST = REPO / "webapp" / "dist"

if WEBAPP_DIST.exists():
    WEBAPP_INDEX = WEBAPP_DIST / "index.html"

    @app.get("/{full_path:path}", include_in_schema=False)
    def webapp_spa(full_path: str) -> Response:
        if full_path.startswith("api/"):
            raise HTTPException(404)
        candidate = (WEBAPP_DIST / full_path).resolve()
        if candidate.is_file() and candidate.is_relative_to(WEBAPP_DIST.resolve()):
            return FileResponse(candidate)
        return FileResponse(WEBAPP_INDEX)
