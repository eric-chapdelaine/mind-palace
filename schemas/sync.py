"""Request/response schemas for sync endpoints."""
from pydantic import BaseModel


class SyncDomainResult(BaseModel):
    synced: int = 0
    total: int = 0
    errors: list[str] = []


class SyncResult(BaseModel):
    sleep: SyncDomainResult = SyncDomainResult()
    activities: SyncDomainResult = SyncDomainResult()
    meals: SyncDomainResult = SyncDomainResult()
