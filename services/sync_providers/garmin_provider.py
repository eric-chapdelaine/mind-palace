"""Garmin sync providers for sleep and activities.

Implements the SyncProvider protocol for pushing Garmin data to
Google Calendar.
"""
from services.sync_providers import SyncDomainResult


class GarminSleepProvider:
    """Syncs Garmin sleep records to Google Calendar."""

    @property
    def name(self) -> str:
        return "sleep"

    async def collect(self) -> list[dict]:
        from integrations.garmin import get_garmin_client, GarminError
        try:
            garmin = get_garmin_client()
            return [
                {"record": r, "date_str": r.date.strftime("%Y-%m-%d")}
                for r in garmin.get_sleep_records()
                if r.bed_time_start and r.bed_time_end
            ]
        except GarminError:
            return []

    async def push(self, records, existing_events, gcal_client) -> SyncDomainResult:
        from integrations.google_calendar import GoogleCalendarError

        result = SyncDomainResult(total=len(records))

        event_map = {
            ep.get("extendedProperties", {}).get("private", {}).get("garmin_sleep_date"): eid
            for eid, ep in (
                (e.get("id"), e) for e in existing_events if e.get("id")
            )
            if ep.get("extendedProperties", {}).get("private", {}).get("garmin_sleep_date")
        }

        for item in records:
            record = item["record"]
            date_str = item["date_str"]
            event_id = event_map.get(date_str)

            try:
                event = record.to_calendar_event()
                if event_id:
                    await gcal_client.update_event_raw(event_id, event)
                else:
                    await gcal_client.create_event_raw(event)
                result.synced += 1
            except GoogleCalendarError as e:
                result.errors.append(f"Sleep {date_str}: {e}")

        return result


class GarminActivityProvider:
    """Syncs Garmin activities to Google Calendar."""

    @property
    def name(self) -> str:
        return "activities"

    async def collect(self) -> list[dict]:
        from integrations.garmin import get_garmin_client, GarminError
        try:
            garmin = get_garmin_client()
            return [
                {"record": a, "activity_id": str(a.activity_id)}
                for a in garmin.get_activities()
                if a.end_time
            ]
        except GarminError:
            return []

    async def push(self, records, existing_events, gcal_client) -> SyncDomainResult:
        from integrations.google_calendar import GoogleCalendarError

        result = SyncDomainResult(total=len(records))

        event_map = {
            ep.get("extendedProperties", {}).get("private", {}).get("garmin_activity_id"): eid
            for eid, ep in (
                (e.get("id"), e) for e in existing_events if e.get("id")
            )
            if ep.get("extendedProperties", {}).get("private", {}).get("garmin_activity_id")
        }

        for item in records:
            record = item["record"]
            activity_id = item["activity_id"]
            event_id = event_map.get(activity_id)

            try:
                event = record.to_calendar_event()
                if event_id:
                    await gcal_client.update_event_raw(event_id, event)
                else:
                    await gcal_client.create_event_raw(event)
                result.synced += 1
            except GoogleCalendarError as e:
                result.errors.append(f"Activity {activity_id}: {e}")

        return result
