import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

/**
 * Transport for Google Calendar: the credential file, the refresh-token grant, and the five REST
 * calls the sync needs. No sync logic here — `GoogleCalendarService` decides what to write.
 *
 * Enablement is authentication, exactly like Garmin: the integration is connected iff the token
 * file exists on disk. Delete the file and the app behaves as if the feature were never installed.
 */

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
/** Events only — the sync never needs to manage calendars themselves. */
const SCOPE = "https://www.googleapis.com/auth/calendar.events";

export interface GoogleTokenStore {
  refreshToken: string;
  accessToken: string | null;
  /** ISO timestamp; a token inside the skew window is refreshed before use. */
  expiresAt: string | null;
  calendarId: string;
  calendarSummary: string | null;
  accountEmail: string | null;
}

/** A Google event normalized to what the task model needs. Raw payloads are never stored. */
export interface NormalizedCalendarEvent {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  updatedAt: string | null;
  status: "confirmed" | "tentative" | "cancelled";
  /** `start.date` (no time) — skipped by default per the plan's D3. */
  allDay: boolean;
  /** Set on events this app created; lets a pull adopt an event whose mapping row was lost. */
  mindPalaceTaskId: number | null;
}

/** The shape we write back to Google for one `calendar_event` task. */
export interface DesiredEvent {
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  timeZone: string;
  taskId: number;
}

interface GoogleEventResource {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  updated?: string;
  etag?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  extendedProperties?: { private?: Record<string, string> };
}

interface GoogleEventList {
  items?: GoogleEventResource[];
  nextSyncToken?: string;
}

function tokenStorePath(): string {
  const override = process.env.GOOGLE_CALENDAR_TOKEN_STORE;
  if (override) return resolve(override.replace(/^~(?=\/)/, homedir()));
  return resolve(homedir(), ".config/mind-palace/google-calendar.json");
}

/** OAuth app credentials: env first, then the `installed` JSON Google's console downloads. */
function oauthClient(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (clientId && clientSecret) return { clientId, clientSecret };
  const candidates = [
    process.env.GOOGLE_CALENDAR_CLIENT_FILE,
    resolve(dirname(tokenStorePath()), "google-oauth-client.json"),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const parsed = JSON.parse(readFileSync(candidate, "utf8")) as {
      installed?: { client_id?: string; client_secret?: string };
      web?: { client_id?: string; client_secret?: string };
    };
    const item = parsed.installed ?? parsed.web;
    if (item?.client_id && item.client_secret) {
      return { clientId: item.client_id, clientSecret: item.client_secret };
    }
  }
  throw new Error("Google Calendar is not configured: set GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET (or place google-oauth-client.json beside the token store).");
}

/** Pending consent `state` values, so a stray callback cannot complete someone else's grant. */
const pendingStates = new Set<string>();

export class GoogleCalendarClient {
  constructor(private readonly redirectUri: string) {}

  isConnected(): boolean {
    return existsSync(tokenStorePath());
  }

  tokenStorePath(): string {
    return tokenStorePath();
  }

  readStore(): GoogleTokenStore | null {
    const path = tokenStorePath();
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as GoogleTokenStore;
  }

  private writeStore(store: GoogleTokenStore): void {
    const path = tokenStorePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  }

  /** Consent URL for the installed-app loopback flow; `state` is verified in `completeAuth`. */
  authUrl(): string {
    const { clientId } = oauthClient();
    const state = randomBytes(16).toString("hex");
    pendingStates.add(state);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: SCOPE,
      access_type: "offline",
      prompt: "consent",
      state,
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  /** Exchange the code, resolve the primary calendar, and write the token file. */
  async completeAuth(code: string, state: string): Promise<void> {
    if (!pendingStates.delete(state)) throw new Error("Unknown or already-used Google consent state; start the connect flow again.");
    const { clientId, clientSecret } = oauthClient();
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!response.ok) throw new Error(`Google token exchange failed: ${response.status} ${await response.text()}`);
    const body = await response.json() as { access_token: string; refresh_token?: string; expires_in: number };
    if (!body.refresh_token) {
      throw new Error("Google did not return a refresh token; revoke the app's access and connect again with consent.");
    }
    const store: GoogleTokenStore = {
      refreshToken: body.refresh_token,
      accessToken: body.access_token,
      expiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString(),
      calendarId: "primary",
      calendarSummary: null,
      accountEmail: null,
    };
    // Write first so `api()` can authenticate; then resolve the primary calendar's real id/name.
    this.writeStore(store);
    const primary = await this.primaryCalendar();
    this.writeStore({ ...store, calendarId: primary.id, calendarSummary: primary.summary });
  }

  /** The account's primary calendar: its id is what `config_json.calendarId` points at. */
  async primaryCalendar(): Promise<{ id: string; summary: string | null }> {
    const body = await this.api<{ items?: Array<{ id: string; summary?: string; primary?: boolean }> }>(
      "/users/me/calendarList?minAccessRole=writer",
    );
    const primary = body.items?.find((item) => item.primary) ?? body.items?.[0];
    if (!primary) throw new Error("Google returned no writable calendar for this account.");
    return { id: primary.id, summary: primary.summary ?? null };
  }

  /** Drop the credentials; tasks and mappings are deliberately kept (re-connecting re-links them). */
  disconnect(): void {
    const path = tokenStorePath();
    if (existsSync(path)) writeFileSync(path, "{}\n", { mode: 0o600 });
    // `isConnected` treats an empty-object store as disconnected (see below), so no unlink needed.
  }

  /**
   * Incremental pull. `syncToken` and `timeMin/timeMax` must never be sent together — Google
   * rejects that combination, so the cursor path sends only the token.
   */
  async listEvents(
    calendarId: string,
    window: { from: string; to: string },
    syncToken: string | null,
  ): Promise<{ events: NormalizedCalendarEvent[]; nextSyncToken: string | null; expiredCursor: boolean }> {
    const params = new URLSearchParams({ singleEvents: "true", maxResults: "2500", showDeleted: "true" });
    if (syncToken) {
      params.set("syncToken", syncToken);
    } else {
      params.set("timeMin", window.from);
      params.set("timeMax", window.to);
      params.set("orderBy", "startTime");
    }
    try {
      const body = await this.api<GoogleEventList>(`/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`);
      return {
        events: (body.items ?? []).map(normalizeEvent).filter((event): event is NormalizedCalendarEvent => event !== null),
        nextSyncToken: body.nextSyncToken ?? null,
        expiredCursor: false,
      };
    } catch (error) {
      // 410 means the token aged out (or was invalidated); the caller re-walks the window.
      if (error instanceof GoogleApiError && error.status === 410) {
        return { events: [], nextSyncToken: null, expiredCursor: true };
      }
      throw error;
    }
  }

  async insertEvent(calendarId: string, event: DesiredEvent): Promise<{ id: string; updated: string | null }> {
    const body = await this.api<GoogleEventResource>(`/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: "POST",
      body: JSON.stringify(eventPayload(event)),
    });
    return { id: body.id, updated: body.updated ?? null };
  }

  async patchEvent(calendarId: string, externalId: string, event: DesiredEvent): Promise<{ updated: string | null }> {
    const body = await this.api<GoogleEventResource>(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(externalId)}`,
      { method: "PATCH", body: JSON.stringify(eventPayload(event)) },
    );
    return { updated: body.updated ?? null };
  }

  /** Deleting an event Google already dropped is success for our purposes (404/410 tolerated). */
  async deleteEvent(calendarId: string, externalId: string): Promise<void> {
    try {
      await this.api(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(externalId)}`, { method: "DELETE" });
    } catch (error) {
      if (error instanceof GoogleApiError && (error.status === 404 || error.status === 410)) return;
      throw error;
    }
  }

  /** Authenticated request with one transparent refresh-and-retry on a 401. */
  private async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    let token = await this.accessToken();
    const send = (bearer: string) => fetch(`${CALENDAR_API}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    });
    let response = await send(token);
    if (response.status === 401) {
      token = await this.accessToken(true);
      response = await send(token);
    }
    if (!response.ok) throw new GoogleApiError(response.status, await response.text());
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }

  /** Cached access token; refreshed when expired, forced, or missing. */
  private async accessToken(force = false): Promise<string> {
    const store = this.readStore();
    if (!store?.refreshToken) throw new Error("Google Calendar is not authenticated; connect it first.");
    const expiresAt = store.expiresAt ? new Date(store.expiresAt).getTime() : 0;
    // 60s skew: a token that expires mid-request is treated as expired.
    if (!force && store.accessToken && expiresAt - 60_000 > Date.now()) return store.accessToken;
    const { clientId, clientSecret } = oauthClient();
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: store.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      // A revoked refresh token cannot be repaired by retrying; surface it as a reconnect prompt.
      throw new Error(response.status === 400
        ? `Google Calendar authorization expired or was revoked; reconnect the integration. (${detail})`
        : `Google token refresh failed: ${response.status}`);
    }
    const body = await response.json() as { access_token: string; expires_in: number; refresh_token?: string };
    this.writeStore({
      ...store,
      accessToken: body.access_token,
      expiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString(),
      // Google only rotates a refresh token when it hands a new one back.
      refreshToken: body.refresh_token ?? store.refreshToken,
    });
    return body.access_token;
  }
}

export class GoogleApiError extends Error {
  constructor(readonly status: number, readonly body: string) {
    super(`Google Calendar request failed: ${status} ${body.slice(0, 400)}`);
  }
}

function eventPayload(event: DesiredEvent): Record<string, unknown> {
  return {
    summary: event.title,
    description: event.description ?? undefined,
    start: { dateTime: event.startAt, timeZone: event.timeZone },
    end: { dateTime: event.endAt, timeZone: event.timeZone },
    // Lets a human (and a re-import after a lost mapping) tell which task owns the event.
    extendedProperties: { private: { mindPalaceTaskId: String(event.taskId) } },
  };
}

/** Timed events keep their instant; all-day events resolve to local midnight of their date. */
function normalizeEvent(event: GoogleEventResource): NormalizedCalendarEvent | null {
  if (!event.id || !event.start || !event.end) return null;
  const allDay = Boolean(event.start.date);
  const startAt = event.start.dateTime ?? (event.start.date ? `${event.start.date}T00:00:00` : null);
  const endAt = event.end.dateTime ?? (event.end.date ? `${event.end.date}T00:00:00` : null);
  if (!startAt || !endAt) return null;
  const status = event.status === "cancelled" ? "cancelled" : event.status === "tentative" ? "tentative" : "confirmed";
  return {
    id: event.id,
    title: event.summary?.trim() || "(untitled event)",
    description: event.description ?? null,
    startAt,
    endAt,
    updatedAt: event.updated ?? null,
    status,
    allDay,
    mindPalaceTaskId: Number(event.extendedProperties?.private?.mindPalaceTaskId) || null,
  };
}
