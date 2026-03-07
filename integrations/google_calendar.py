"""
Google Calendar integration using OAuth2.

Provides both task-specific convenience methods and generic event
create/update methods used by SyncProviders.
"""
import httpx
from urllib.parse import quote
from core.config import settings


class GoogleCalendarError(Exception):
    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.status_code = status_code


class GoogleCalendarClient:
    def __init__(self):
        if not settings.GOOGLE_CLIENT_ID:
            raise GoogleCalendarError("GOOGLE_CLIENT_ID is not set", status_code=503)
        if not settings.GOOGLE_CLIENT_SECRET:
            raise GoogleCalendarError("GOOGLE_CLIENT_SECRET is not set", status_code=503)
        if not settings.GOOGLE_REFRESH_TOKEN:
            raise GoogleCalendarError("GOOGLE_REFRESH_TOKEN is not set", status_code=503)
        if not settings.GOOGLE_CALENDAR_ID:
            raise GoogleCalendarError("GOOGLE_CALENDAR_ID is not set", status_code=503)

        self.calendar_id = settings.GOOGLE_CALENDAR_ID
        self.client_id = settings.GOOGLE_CLIENT_ID
        self.client_secret = settings.GOOGLE_CLIENT_SECRET
        self.refresh_token = settings.GOOGLE_REFRESH_TOKEN
        self._access_token: str | None = None

    async def _get_access_token(self) -> str:
        if self._access_token:
            return self._access_token

        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "refresh_token": self.refresh_token,
                    "grant_type": "refresh_token",
                },
            )

        if resp.status_code != 200:
            raise GoogleCalendarError(f"Failed to get access token: {resp.text}", status_code=501)

        self._access_token = resp.json()["access_token"]
        assert self._access_token is not None
        return self._access_token

    def _get_url(self, endpoint: str) -> str:
        return f"https://www.googleapis.com/calendar/v3/calendars/{quote(self.calendar_id, safe='')}/{endpoint}"

    async def _headers(self) -> dict:
        token = await self._get_access_token()
        return {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

    # --- Generic event methods (used by SyncProviders) ---

    async def create_event_raw(self, event: dict) -> dict:
        """Create a calendar event from a raw event dict."""
        async with httpx.AsyncClient(timeout=10) as client:
            try:
                resp = await client.post(
                    self._get_url("events"),
                    json=event,
                    headers=await self._headers(),
                )
            except httpx.RequestError as e:
                raise GoogleCalendarError(f"Could not reach Google: {e}", status_code=503)

        if resp.status_code not in (200, 201):
            raise GoogleCalendarError(f"Google Calendar error: {resp.text}", status_code=resp.status_code)
        return resp.json()

    async def update_event_raw(self, event_id: str, event: dict) -> dict:
        """Update a calendar event from a raw event dict."""
        async with httpx.AsyncClient(timeout=10) as client:
            try:
                resp = await client.patch(
                    f"{self._get_url('events')}/{event_id}",
                    json=event,
                    headers=await self._headers(),
                )
            except httpx.RequestError as e:
                raise GoogleCalendarError(f"Could not reach Google: {e}", status_code=503)

        if resp.status_code not in (200, 201):
            raise GoogleCalendarError(f"Google Calendar error: {resp.text}", status_code=resp.status_code)
        return resp.json()

    async def delete_event(self, event_id: str) -> None:
        """Delete a calendar event."""
        async with httpx.AsyncClient(timeout=10) as client:
            try:
                resp = await client.delete(
                    f"{self._get_url('events')}/{event_id}",
                    headers=await self._headers(),
                )
            except httpx.RequestError as e:
                raise GoogleCalendarError(f"Could not reach Google: {e}", status_code=503)

        if resp.status_code not in (200, 204):
            raise GoogleCalendarError(f"Google Calendar error: {resp.text}", status_code=resp.status_code)

    async def list_events(self) -> list[dict]:
        """List events from the calendar."""
        async with httpx.AsyncClient(timeout=10) as client:
            try:
                resp = await client.get(
                    self._get_url("events"),
                    headers=await self._headers(),
                )
            except httpx.RequestError as e:
                raise GoogleCalendarError(f"Could not reach Google: {e}", status_code=503)

        if resp.status_code != 200:
            raise GoogleCalendarError(f"Google Calendar error: {resp.text}", status_code=resp.status_code)

        return resp.json().get("items", [])

    # --- Convenience aliases (backwards compat) ---

    async def create_sleep_event(self, event: dict) -> dict:
        return await self.create_event_raw(event)

    async def update_sleep_event(self, event_id: str, event: dict) -> dict:
        return await self.update_event_raw(event_id, event)

    async def create_activity_event(self, event: dict) -> dict:
        return await self.create_event_raw(event)

    async def update_activity_event(self, event_id: str, event: dict) -> dict:
        return await self.update_event_raw(event_id, event)


_client: "GoogleCalendarClient | None" = None


def get_google_calendar_client() -> GoogleCalendarClient:
    global _client
    if _client is None:
        _client = GoogleCalendarClient()
    return _client
