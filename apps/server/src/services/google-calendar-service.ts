import type { TaskRepository } from "@mind-palace/database";
import type {
  CalendarEventTask,
  CalendarSyncConfig,
  CalendarSyncResult,
  IntegrationConnection,
} from "@mind-palace/shared";
import type { CalendarImportService } from "./calendar-import-service.js";
import { GoogleCalendarClient } from "./google-calendar-client.js";

const DEFAULT_CONFIG: CalendarSyncConfig = {
  calendarId: "primary",
  calendarSummary: null,
  timeZone: "America/New_York",
  importAllDay: false,
  windowDays: 30,
};

/** A mapping row is stale-proof by id only; use `updated` when Google provides it. */
function isNewer(left: string | null, right: string | null): boolean {
  if (!left) return false;
  if (!right) return true;
  return new Date(left).getTime() > new Date(right).getTime();
}

/**
 * Two-way Google Calendar sync over the `calendar_event` task set: one task ⇄ one event.
 *
 * `sync()` is a reconcile, not an event stream: pull first (Google is authoritative for
 * commitments), then push local `calendar_event` tasks back. Because the desired state is
 * recomputed from SQLite on every pass, a failed or skipped push self-heals on the next tick —
 * there is no outbox to get stuck.
 *
 * Echo safety has two halves: the pull skips an event that is not newer than our `lastPushedAt`,
 * and an unmapped event carrying `mindPalaceTaskId` is adopted instead of duplicated.
 */
export class GoogleCalendarService {
  private inFlight: Promise<CalendarSyncResult> | null = null;
  private pendingPush: NodeJS.Timeout | null = null;
  readonly client: GoogleCalendarClient;

  constructor(
    private readonly tasks: TaskRepository,
    private readonly calendar: CalendarImportService,
    redirectUri: string,
  ) {
    this.client = new GoogleCalendarClient(redirectUri);
  }

  /** Connected iff the token file holds a refresh token (a disconnected file is `{}`). */
  isConnected(): boolean {
    return Boolean(this.client.readStore()?.refreshToken);
  }

  status(): IntegrationConnection & { syncCursor: string | null; config: CalendarSyncConfig | null } {
    const stored = this.tasks.getCalendarStatus();
    return { ...stored, connected: this.isConnected() };
  }

  /** The live config: the DB row once connected, defaults before the first sync. */
  private config(): CalendarSyncConfig {
    const stored = this.tasks.getCalendarStatus().config;
    return stored ?? DEFAULT_CONFIG;
  }

  /** Coalesce bursts of local edits (a drag fires several PATCHes) into one sync pass. */
  queuePush(): void {
    if (!this.isConnected()) return;
    if (this.pendingPush) clearTimeout(this.pendingPush);
    this.pendingPush = setTimeout(() => {
      this.pendingPush = null;
      this.sync().catch((error: unknown) => {
        console.error(`Google Calendar push failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, 750);
    this.pendingPush.unref?.();
  }

  /** Pull, then push. Concurrent callers share the in-flight pass. */
  async sync(): Promise<CalendarSyncResult> {
    if (!this.isConnected()) throw new Error("Google Calendar is not connected; connect an account first.");
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.reconcile().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async reconcile(): Promise<CalendarSyncResult> {
    const accountId = this.tasks.calendarAccountId();
    const config = this.config();
    const result: CalendarSyncResult = { pulled: 0, pushed: 0, deleted: 0, skipped: 0, syncedAt: "" };
    try {
      await this.pull(accountId, config, result);
      await this.push(accountId, config, result);
      this.tasks.markCalendarSynced(null);
    } catch (error) {
      this.tasks.markCalendarSynced(error instanceof Error ? error.message : String(error));
      throw error;
    }
    result.syncedAt = new Date().toISOString();
    return result;
  }

  /** Google → tasks. Applies only what is newer than our own last write for that event. */
  private async pull(
    accountId: number,
    config: CalendarSyncConfig,
    result: CalendarSyncResult,
    useCursor = true,
  ): Promise<void> {
    const cursor = useCursor ? this.tasks.getCalendarStatus().syncCursor : null;
    const now = new Date();
    const from = new Date(now.getTime() - 86_400_000).toISOString();
    const to = new Date(now.getTime() + config.windowDays * 86_400_000).toISOString();
    const listed = await this.client.listEvents(config.calendarId, { from, to }, cursor);

    // An expired syncToken means the window must be rebuilt from scratch; ids keep it idempotent.
    if (listed.expiredCursor) {
      this.tasks.saveCalendarSyncCursor(null);
      return this.pull(accountId, config, result, false);
    }

    for (const event of listed.events) {
      let mapping = this.tasks.findTaskMapping(accountId, event.id);
      // Our own last write coming back: nothing changed remotely since, so the mirror is current.
      // Compare against the event stamp we recorded from Google (`externalUpdatedAt`), never against
      // our own `last_pushed_at`: the two clocks differ by a few hundred ms and a local "now" that
      // lands behind Google's stamp would make every pass look like a remote edit.
      if (mapping && event.status !== "cancelled" && !isNewer(event.updatedAt, mapping.externalUpdatedAt)) {
        result.skipped += 1;
        continue;
      }
      if (event.status === "cancelled") {
        // Keep the mapping row: it is what stops the same event id from being re-created.
        // A tombstoned mapping means we already handled this deletion; re-applying it would bump
        // the task's `updated_at` every pass and make the push chase its own tail.
        if (!mapping || mapping.externalDeletedAt) {
          result.skipped += 1;
          continue;
        }
        this.calendar.importCalendarEvent(accountId, event);
        this.tasks.markMappingDeleted(accountId, event.id);
        result.pulled += 1;
        continue;
      }
      if (!mapping) {
        // A lost mapping row but our own marker: adopt the event instead of duplicating it.
        const markedTaskId = event.mindPalaceTaskId;
        if (markedTaskId !== null) {
          const task = this.tasks.listTasks().find((candidate) => candidate.id === markedTaskId);
          if (task?.tags.some((tag) => tag.publicId === "mind-palace:calendar_event")) {
            this.tasks.mapExternalTask(accountId, event.id, markedTaskId, event.updatedAt ?? undefined);
            mapping = this.tasks.findTaskMapping(accountId, event.id);
          }
        }
      }
      const outcome = this.calendar.importCalendarEvent(accountId, event, { importAllDay: config.importAllDay });
      if (outcome.outcome === "skipped" || outcome.taskId === null) {
        result.skipped += 1;
        continue;
      }
      // The rows we just wrote are exactly what Google holds, so the push must not re-send them.
      if (event.updatedAt) this.tasks.touchMappingPushed(accountId, event.id, event.updatedAt);
      this.tasks.markMappingSynced(accountId, event.id, outcome.taskId);
      result.pulled += 1;
    }

    this.tasks.saveCalendarSyncCursor(listed.nextSyncToken ?? null, config);
  }

  /** Tasks → Google. Desired state recomputed from the mirrored task set every pass. */
  private async push(accountId: number, config: CalendarSyncConfig, result: CalendarSyncResult): Promise<void> {
    const now = Date.now();
    const horizon = now + config.windowDays * 86_400_000;
    const desired = this.tasks.listCalendarEventTasks();
    const seen = new Set<string>();
    for (const task of desired) {
      if (task.externalId) seen.add(task.externalId);
      const gone = task.kanbanStatus === "cancelled"
        || task.lifecycleStatus === "cancelled"
        || task.lifecycleStatus === "archived";
      if (gone) {
        // The event goes away, the mapping row stays: it is what stops a cancelled task from
        // being re-created if the same event id is ever seen again.
        if (task.externalId && !task.externalDeletedAt) {
          await this.client.deleteEvent(config.calendarId, task.externalId);
          this.tasks.markMappingDeleted(accountId, task.externalId);
          result.deleted += 1;
        }
        continue;
      }
      // Past commitments are history; leave them alone rather than rewriting old events.
      if (new Date(task.endAt).getTime() < now) continue;
      if (new Date(task.startAt).getTime() > horizon) continue;

      const event = this.calendar.desiredEvent(task, config.timeZone);
      if (!task.externalId) {
        const inserted = await this.client.insertEvent(config.calendarId, event);
        this.tasks.mapExternalTask(accountId, inserted.id, task.taskId, inserted.updated ?? undefined);
        this.tasks.touchMappingPushed(accountId, inserted.id, inserted.updated);
        this.tasks.markMappingSynced(accountId, inserted.id, task.taskId);
        // Count it as seen, or the orphan sweep below would immediately delete what we just made.
        seen.add(inserted.id);
        result.pushed += 1;
        continue;
      }
      // Everything local is already mirrored (a pull or an earlier push wrote the watermark).
      if (task.localSyncedAt && !this.changedSince(task)) continue;
      const patched = await this.client.patchEvent(config.calendarId, task.externalId, event);
      this.tasks.touchMappingPushed(accountId, task.externalId, patched.updated);
      this.tasks.markMappingSynced(accountId, task.externalId, task.taskId);
      result.pushed += 1;
    }

    // Events whose task lost its calendar block: cancel the task's mirror so it is not orphaned.
    for (const mapping of this.tasks.listCalendarMappings(accountId)) {
      if (seen.has(mapping.externalId) || mapping.externalDeletedAt) continue;
      await this.client.deleteEvent(config.calendarId, mapping.externalId);
      this.tasks.markMappingDeleted(accountId, mapping.externalId);
      result.deleted += 1;
    }
  }

  /** Did the local side (task or its commitment block) move after what we already mirrored? */
  private changedSince(task: CalendarEventTask): boolean {
    if (!task.localSyncedAt) return true;
    if (isNewer(task.taskUpdatedAt, task.localSyncedAt)) return true;
    return task.blockUpdatedAt !== null && isNewer(task.blockUpdatedAt, task.localSyncedAt);
  }
}
