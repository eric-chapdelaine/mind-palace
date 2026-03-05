"""
/sync — sync data between integrations (Google Calendar, Garmin).
"""
from fastapi import APIRouter, Depends, HTTPException, Query

from integrations.google_calendar import GoogleCalendarClient, GoogleCalendarError, get_google_calendar_client
from integrations.garmin import GarminError, get_garmin_client

router = APIRouter(prefix="/sync", tags=["sync"])


@router.post("/to-google", status_code=200)
async def sync_to_google(
    include_sleep: bool = Query(default=True, description="Include Garmin sleep data"),
    include_activities: bool = Query(default=True, description="Include Garmin activities"),
    gcal: GoogleCalendarClient = Depends(get_google_calendar_client),
):
    """
    Sync Garmin data to Google Calendar.
    
    - Optionally syncs Garmin sleep data as "Sleep" events
    - Optionally syncs Garmin activities as calendar events
    
    Events are tagged with source IDs for tracking.
    """
    results = {
        "sleep": {"synced": 0, "total": 0, "errors": []},
        "activities": {"synced": 0, "total": 0, "errors": []},
    }

    try:
        gcal_events = await gcal.list_events()
    except GoogleCalendarError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))

    # Sync Garmin sleep data
    garmin = None
    if include_sleep:
        try:
            garmin = get_garmin_client()
        except GarminError as e:
            results["sleep"]["errors"].append(f"Garmin unavailable: {e}")
        else:
            try:
                sleep_records = garmin.get_sleep_records()
            except GarminError as e:
                results["sleep"]["errors"].append(f"Failed to get sleep data: {e}")
            else:
                results["sleep"]["total"] = len(sleep_records)

                sleep_event_map = {
                    ep.get("extendedProperties", {}).get("private", {}).get("garmin_sleep_date"): eid
                    for eid, ep in ((e.get("id"), e) for e in gcal_events if e.get("id"))
                    if ep.get("extendedProperties", {}).get("private", {}).get("garmin_sleep_date")
                }

                for sleep in sleep_records:
                    if not sleep.bed_time_start or not sleep.bed_time_end:
                        continue

                    sleep_date_str = sleep.date.strftime("%Y-%m-%d")
                    event_id = sleep_event_map.get(sleep_date_str)

                    try:
                        event = sleep.to_calendar_event()
                        if event_id:
                            await gcal.update_sleep_event(event_id, event)
                        else:
                            await gcal.create_sleep_event(event)
                        results["sleep"]["synced"] += 1
                    except GoogleCalendarError as e:
                        results["sleep"]["errors"].append(f"Sleep {sleep_date_str}: {e}")

    # Sync Garmin activities
    if include_activities:
        if not garmin:
            try:
                garmin = get_garmin_client()
            except GarminError as e:
                results["activities"]["errors"].append(f"Garmin unavailable: {e}")

        if garmin:
            try:
                activities = garmin.get_activities()
            except GarminError as e:
                results["activities"]["errors"].append(f"Failed to get activities: {e}")
            else:
                results["activities"]["total"] = len(activities)

                activity_event_map = {
                    ep.get("extendedProperties", {}).get("private", {}).get("garmin_activity_id"): eid
                    for eid, ep in ((e.get("id"), e) for e in gcal_events if e.get("id"))
                    if ep.get("extendedProperties", {}).get("private", {}).get("garmin_activity_id")
                }

                for activity in activities:
                    if not activity.end_time:
                        continue

                    activity_id = str(activity.activity_id)
                    event_id = activity_event_map.get(activity_id)

                    try:
                        event = activity.to_calendar_event()
                        if event_id:
                            await gcal.update_activity_event(event_id, event)
                        else:
                            await gcal.create_activity_event(event)
                        results["activities"]["synced"] += 1
                    except GoogleCalendarError as e:
                        results["activities"]["errors"].append(f"Activity {activity_id}: {e}")

    return results
