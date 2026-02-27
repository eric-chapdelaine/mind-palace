"""
/auth — OAuth authentication handlers.
"""
import httpx
from urllib.parse import urlencode
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse

from core.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/google")
async def google_auth():
    """
    Redirects to Google OAuth authorization page.
    After authorization, user is redirected to /auth/google/callback
    """
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="GOOGLE_CLIENT_ID not configured")
    
    callback_url = f"{settings.APP_URL}/auth/google/callback"
    
    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": callback_url,
        "response_type": "code",
        "scope": "https://www.googleapis.com/auth/calendar.events",
        "access_type": "offline",
        "prompt": "consent",
    }
    
    auth_url = f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"
    return RedirectResponse(url=auth_url)


@router.get("/google/callback")
async def google_callback(code: str = Query(...)):
    """
    Handles the OAuth callback, exchanges code for tokens.
    Returns the refresh token for the user to store.
    """
    if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
        raise HTTPException(status_code=503, detail="OAuth not configured")
    
    callback_url = f"{settings.APP_URL}/auth/google/callback"
    
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resp = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": settings.GOOGLE_CLIENT_ID,
                    "client_secret": settings.GOOGLE_CLIENT_SECRET,
                    "code": code,
                    "grant_type": "authorization_code",
                    "redirect_uri": callback_url,
                },
            )
        except httpx.RequestError as e:
            raise HTTPException(status_code=500, detail=f"Failed to contact Google: {e}")
    
    if resp.status_code != 200:
        raise HTTPException(status_code=400, detail=f"Token exchange failed: {resp.text}")
    
    data = resp.json()
    refresh_token = data.get("refresh_token")
    access_token = data.get("access_token")
    
    if not refresh_token:
        raise HTTPException(status_code=400, detail="No refresh token returned. It may have been previously granted.")
    
    return {
        "success": True,
        "message": "Authorization successful!",
        "refresh_token": refresh_token,
        "instructions": "Add the following to your .env file:\n"
                        f"GOOGLE_REFRESH_TOKEN={refresh_token}\n"
                        "Then restart the application."
    }


@router.get("/google/status")
async def google_status():
    """Check if Google Calendar is configured."""
    configured = bool(
        settings.GOOGLE_CLIENT_ID 
        and settings.GOOGLE_CLIENT_SECRET 
        and settings.GOOGLE_REFRESH_TOKEN
    )
    return {
        "configured": configured,
        "missing": [
            "GOOGLE_CLIENT_ID" if not settings.GOOGLE_CLIENT_ID else None,
            "GOOGLE_CLIENT_SECRET" if not settings.GOOGLE_CLIENT_SECRET else None,
            "GOOGLE_REFRESH_TOKEN" if not settings.GOOGLE_REFRESH_TOKEN else None,
        ] if not configured else []
    }
