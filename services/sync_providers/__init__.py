"""Generic sync provider abstraction.

Each domain that can sync to an external calendar/service implements the
``SyncProvider`` protocol.  The sync router iterates over registered
providers and calls ``collect()`` then ``push()`` for each.

To add a new sync target (e.g. meals to Google Calendar):
1. Create a new file in this package (e.g. ``meal_provider.py``).
2. Implement ``SyncProvider``.
3. Register it in ``PROVIDERS``.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable


@dataclass
class SyncDomainResult:
    synced: int = 0
    total: int = 0
    errors: list[str] = field(default_factory=list)


@runtime_checkable
class SyncProvider(Protocol):
    """Interface for domain-specific sync providers."""

    @property
    def name(self) -> str:
        """Short label for this domain (e.g. 'sleep', 'activities')."""
        ...

    async def collect(self) -> list[dict]:
        """Gather records to sync."""
        ...

    async def push(
        self, records: list[dict], existing_events: list[dict], gcal_client: object
    ) -> SyncDomainResult:
        """Push records to the external service."""
        ...
