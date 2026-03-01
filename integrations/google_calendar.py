"""
Google Calendar integration using OAuth2.
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

    async def create_event(self, task: dict) -> dict:
        task_id = task.get("id")
        title = task.get("title", "Untitled")
        description = task.get("description", "")
        due_date = task.get("due_date")

        if not due_date or due_date == "0001-01-01T00:00:00Z":
            raise GoogleCalendarError("Task has no due date", status_code=400)

        from datetime import datetime
        dt = datetime.fromisoformat(due_date.replace("Z", "+00:00"))
        
        event = {
            "summary": title,
            "description": description,
            "start": {"date": dt.strftime("%Y-%m-%d")},
            "end": {"date": dt.strftime("%Y-%m-%d")},
            "extendedProperties": {
                "private": {"vikunja_task_id": str(task_id)}
            },
        }

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

    async def update_event(self, event_id: str, task: dict) -> dict:
        title = task.get("title", "Untitled")
        description = task.get("description", "")
        done = task.get("done", False)
        due_date = task.get("due_date")

        event = {"summary": title, "description": description}

        if done:
            event["status"] = "completed"
        elif due_date and due_date != "0001-01-01T00:00:00Z":
            from datetime import datetime
            dt = datetime.fromisoformat(due_date.replace("Z", "+00:00"))
            event["start"] = {"date": dt.strftime("%Y-%m-%d")}
            event["end"] = {"date": dt.strftime("%Y-%m-%d")}

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

    async def create_sleep_event(self, sleep_event: dict) -> dict:
        """Create a sleep event in Google Calendar.
        
        Args:
            sleep_event: Event dict with summary, description, start, end, extendedProperties
            
        Returns:
            Created event dict from Google Calendar
        """
        async with httpx.AsyncClient(timeout=10) as client:
            try:
                resp = await client.post(
                    self._get_url("events"),
                    json=sleep_event,
                    headers=await self._headers(),
                )
            except httpx.RequestError as e:
                raise GoogleCalendarError(f"Could not reach Google: {e}", status_code=503)

        if resp.status_code not in (200, 201):
            raise GoogleCalendarError(f"Google Calendar error: {resp.text}", status_code=resp.status_code)

        return resp.json()

    async def update_sleep_event(self, event_id: str, sleep_event: dict) -> dict:
        """Update an existing sleep event in Google Calendar.
        
        Args:
            event_id: The Google Calendar event ID to update
            sleep_event: Event dict with fields to update
            
        Returns:
            Updated event dict from Google Calendar
        """
        async with httpx.AsyncClient(timeout=10) as client:
            try:
                resp = await client.patch(
                    f"{self._get_url('events')}/{event_id}",
                    json=sleep_event,
                    headers=await self._headers(),
                )
            except httpx.RequestError as e:
                raise GoogleCalendarError(f"Could not reach Google: {e}", status_code=503)

        if resp.status_code not in (200, 201):
            raise GoogleCalendarError(f"Google Calendar error: {resp.text}", status_code=resp.status_code)

        return resp.json()

    async def list_events(self) -> list[dict]:
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


_client: "GoogleCalendarClient | None" = None


def get_google_calendar_client() -> GoogleCalendarClient:
    global _client
    if _client is None:
        _client = GoogleCalendarClient()
    return _client
