"""
Vikunja integration.
Docs: https://vikunja.io/docs/api/
"""
from typing import Optional
import httpx
from core.config import settings


class VikunjaError(Exception):
    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.status_code = status_code


class VikunjaClient:
    def __init__(self):
        if not settings.VIKUNJA_TOKEN:
            raise VikunjaError("VIKUNJA_TOKEN is not set", status_code=503)
        self.base_url = settings.VIKUNJA_URL.rstrip("/")
        self.headers = {
            "Authorization": f"Bearer {settings.VIKUNJA_TOKEN}",
            "Content-Type": "application/json",
        }

    async def create_task(
        self,
        title: str,
        project_id: Optional[int] = None,
        notes: Optional[str] = None,
        due_date: Optional[str] = None,  # ISO 8601
    ) -> dict:
        pid = project_id or settings.VIKUNJA_INBOX_PROJECT_ID
        payload: dict = {"title": title}
        if notes:
            payload["description"] = notes
        if due_date:
            payload["due_date"] = due_date

        async with httpx.AsyncClient(timeout=10) as client:
            try:
                resp = await client.put(
                    f"{self.base_url}/projects/{pid}/tasks",
                    json=payload,
                    headers=self.headers,
                )
            except httpx.RequestError as e:
                raise VikunjaError(f"Could not reach Vikunja: {e}", status_code=503)

        if resp.status_code not in (200, 201):
            raise VikunjaError(
                f"Vikunja rejected the task: {resp.text}", status_code=resp.status_code
            )

        return resp.json()

    async def get_tasks(self, project_id: Optional[int] = None) -> list[dict]:
        pid = project_id or settings.VIKUNJA_INBOX_PROJECT_ID
        async with httpx.AsyncClient(timeout=10) as client:
            try:
                resp = await client.get(
                    f"{self.base_url}/projects/{pid}/tasks",
                    headers=self.headers,
                )
            except httpx.RequestError as e:
                raise VikunjaError(f"Could not reach Vikunja: {e}", status_code=503)

        if resp.status_code != 200:
            raise VikunjaError(f"Vikunja error: {resp.text}", status_code=resp.status_code)

        return resp.json()


# Module-level singleton — instantiated lazily so missing token doesn't crash startup
_client: Optional[VikunjaClient] = None


def get_vikunja_client() -> VikunjaClient:
    global _client
    if _client is None:
        _client = VikunjaClient()
    return _client
