"""
/sync — Sync data between integrations using the SyncProvider abstraction.

Each SyncProvider handles collecting and pushing records for its domain.
To add a new sync target, create a new provider in services/sync_providers/.
"""
from fastapi import APIRouter, Depends, HTTPException, Query

from integrations.google_calendar import GoogleCalendarClient, GoogleCalendarError, get_google_calendar_client
from services.sync_providers.garmin_provider import GarminSleepProvider, GarminActivityProvider

router = APIRouter(prefix="/sync", tags=["sync"])


# Registry of sync providers — add new ones here
PROVIDERS = [
    GarminSleepProvider(),
    GarminActivityProvider(),
]


@router.post("/to-google", status_code=200)
async def sync_to_google(
    include_sleep: bool = Query(default=True, description="Include Garmin sleep data"),
    include_activities: bool = Query(default=True, description="Include Garmin activities"),
    gcal: GoogleCalendarClient = Depends(get_google_calendar_client),
):
    """
    Sync data to Google Calendar using registered SyncProviders.

    Each provider collects records from its source, then pushes them to
    Google Calendar.  Events are updated in place if they already exist.
    """
    try:
        gcal_events = await gcal.list_events()
    except GoogleCalendarError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))

    results = {}

    for provider in PROVIDERS:
        name = provider.name
        # Skip providers the caller doesn't want
        if name == "sleep" and not include_sleep:
            continue
        if name == "activities" and not include_activities:
            continue

        records = await provider.collect()
        domain_result = await provider.push(records, gcal_events, gcal)
        results[name] = {
            "synced": domain_result.synced,
            "total": domain_result.total,
            "errors": domain_result.errors,
        }

    return results
