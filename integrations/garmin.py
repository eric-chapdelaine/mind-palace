"""
Garmin integration using garth library.
Requires: pip install garth
Authentication: garth.login() then garth.save("~/.garth")
"""
from datetime import datetime, timedelta, timezone, timezone
from typing import Optional

from core.config import settings


class GarminError(Exception):
    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.status_code = status_code


class SleepRecord:
    """Represents a single sleep record from Garmin."""
    def __init__(
        self,
        date: datetime,
        bed_time_start: Optional[datetime],
        bed_time_end: Optional[datetime],
        sleep_quality: Optional[float],
        deep_sleep_duration: Optional[int],
        light_sleep_duration: Optional[int],
        rem_sleep_duration: Optional[int],
        awake_duration: Optional[int],
        total_sleep_duration: Optional[int],
    ):
        self.date = date
        self.bed_time_start = bed_time_start
        self.bed_time_end = bed_time_end
        self.sleep_quality = sleep_quality
        self.deep_sleep_duration = deep_sleep_duration
        self.light_sleep_duration = light_sleep_duration
        self.rem_sleep_duration = rem_sleep_duration
        self.awake_duration = awake_duration
        self.total_sleep_duration = total_sleep_duration

    @property
    def duration_hours(self) -> Optional[float]:
        """Calculate sleep duration in hours."""
        if self.bed_time_start and self.bed_time_end:
            delta = self.bed_time_end - self.bed_time_start
            return delta.total_seconds() / 3600
        return None

    def to_calendar_event(self) -> dict:
        """Convert to Google Calendar event format."""
        if not self.bed_time_start or not self.bed_time_end:
            raise GarminError(f"No sleep times for {self.date}")

        quality_str = f" (Quality: {self.sleep_quality:.0f}%)" if self.sleep_quality else ""
        summary = f"Sleep{quality_str}"

        description_parts = []
        if self.sleep_quality:
            description_parts.append(f"Quality: {self.sleep_quality:.0f}%")
        if self.total_sleep_duration:
            hours = self.total_sleep_duration // 60
            mins = self.total_sleep_duration % 60
            description_parts.append(f"Total: {hours}h {mins}m")
        if self.deep_sleep_duration:
            description_parts.append(f"Deep: {self.deep_sleep_duration}m")
        if self.light_sleep_duration:
            description_parts.append(f"Light: {self.light_sleep_duration}m")
        if self.rem_sleep_duration:
            description_parts.append(f"REM: {self.rem_sleep_duration}m")

        return {
            "summary": summary,
            "description": "\n".join(description_parts),
            "start": {
                "dateTime": self.bed_time_start.isoformat(),
            },
            "end": {
                "dateTime": self.bed_time_end.isoformat(),
            },
            "extendedProperties": {
                "private": {"garmin_sleep_date": self.date.strftime("%Y-%m-%d")}
            },
        }


class GarminClient:
    def __init__(self):
        self._initialized = False

    def _ensure_client(self):
        if self._initialized:
            return

        try:
            import garth
        except ImportError:
            raise GarminError(
                "garth not installed. Run: pip install garth",
                status_code=503,
            )

        try:
            garth.resume("~/.garth")
            self._initialized = True
        except Exception as e:
            raise GarminError(
                f"Failed to resume Garmin session: {e}. "
                "Run: garth.login() then garth.save('~/.garth')",
                status_code=503,
            )

    def get_sleep_records(
        self,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
    ) -> list[SleepRecord]:
        """Fetch sleep records from Garmin Connect.

        Args:
            start_date: Optional start date filter (defaults to 7 days ago)
            end_date: Optional end date filter (defaults to today)

        Returns:
            List of SleepRecord objects
        """
        import garth

        self._ensure_client()

        if not start_date:
            start_date = datetime.now() - timedelta(days=7)
        if not end_date:
            end_date = datetime.now()

        records = []
        current = start_date
        while current <= end_date:
            try:
                sleep_data = garth.SleepData.get(current.strftime("%Y-%m-%d"))

                if sleep_data and sleep_data.daily_sleep_dto:
                    dto = sleep_data.daily_sleep_dto

                    bed_time_start = None
                    bed_time_end = None
                    # Convert GMT timestamp to local timezone (timezone-aware)
                    if dto.sleep_start_timestamp_gmt:
                        bed_time_start = datetime.fromtimestamp(
                            dto.sleep_start_timestamp_gmt / 1000
                        ).astimezone()
                    if dto.sleep_end_timestamp_gmt:
                        bed_time_end = datetime.fromtimestamp(
                            dto.sleep_end_timestamp_gmt / 1000
                        ).astimezone()

                    quality = None
                    if dto.sleep_scores and dto.sleep_scores.overall:
                        quality = dto.sleep_scores.overall.value

                    deep = dto.deep_sleep_seconds // 60 if dto.deep_sleep_seconds else None
                    light = dto.light_sleep_seconds // 60 if dto.light_sleep_seconds else None
                    rem = dto.rem_sleep_seconds // 60 if dto.rem_sleep_seconds else None
                    awake = dto.awake_sleep_seconds // 60 if dto.awake_sleep_seconds else None
                    total = dto.sleep_time_seconds // 60 if dto.sleep_time_seconds else None

                    records.append(SleepRecord(
                        date=current,
                        bed_time_start=bed_time_start,
                        bed_time_end=bed_time_end,
                        sleep_quality=quality,
                        deep_sleep_duration=deep,
                        light_sleep_duration=light,
                        rem_sleep_duration=rem,
                        awake_duration=awake,
                        total_sleep_duration=total,
                    ))
            except Exception as e:
                print(f"⚠️  Could not get sleep data for {current.date()}: {e}")

            current += timedelta(days=1)

        return records

    def get_latest_sleep(self) -> Optional[SleepRecord]:
        """Get the most recent sleep record."""
        records = self.get_sleep_records()
        return records[0] if records else None


_client: Optional[GarminClient] = None


def get_garmin_client() -> GarminClient:
    global _client
    if _client is None:
        _client = GarminClient()
    return _client
