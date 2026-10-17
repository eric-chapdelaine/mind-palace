/**
 * Request parsing for scheduler rules. Rules are data, so the route layer only has to validate
 * their shape: unknown effects are rejected so the table never holds behavior the worker cannot
 * compile.
 */

import {
  ruleEffectTypes,
  type RuleCondition,
  type RuleEffect,
  type RuleStrength,
  type SchedulerRuleInput,
} from "@mind-palace/shared";
import { requiredString } from "./validation.js";

function parseRuleStrength(value: unknown): RuleStrength {
  if (!value || typeof value !== "object") throw new Error("strength is required");
  const candidate = value as { kind?: unknown; weight?: unknown };
  if (candidate.kind === "hard") return { kind: "hard" };
  if (candidate.kind === "soft") {
    if (typeof candidate.weight !== "number") throw new Error("Soft rules need a numeric weight");
    return { kind: "soft", weight: candidate.weight };
  }
  throw new Error("strength.kind must be hard or soft");
}

/** Reject effects the worker does not implement so the rules table never holds dead behavior. */
function parseRuleEffect(value: unknown): RuleEffect {
  if (!value || typeof value !== "object" || typeof (value as { type?: unknown }).type !== "string") {
    throw new Error("effect.type is required");
  }
  const type = (value as { type: string }).type;
  if (!ruleEffectTypes.includes(type as (typeof ruleEffectTypes)[number])) {
    throw new Error(`Unknown rule effect '${type}'`);
  }
  return value as RuleEffect;
}

export function parseRuleInput(body: Record<string, unknown>): SchedulerRuleInput {
  const applies = body.applies;
  return {
    title: requiredString(body.title, "title"),
    ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
    ...(applies === null || (applies && typeof applies === "object") ? { applies: applies as RuleCondition | null } : {}),
    effect: parseRuleEffect(body.effect),
    strength: parseRuleStrength(body.strength),
    ...(typeof body.reason === "string" ? { reason: body.reason } : {}),
  };
}

export function parseRulePatch(body: Record<string, unknown>): Partial<SchedulerRuleInput> {
  const patch: Partial<SchedulerRuleInput> = {};
  if (typeof body.title === "string") patch.title = requiredString(body.title, "title");
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (body.applies === null) patch.applies = null;
  else if (body.applies && typeof body.applies === "object") patch.applies = body.applies as RuleCondition;
  if (body.effect !== undefined) patch.effect = parseRuleEffect(body.effect);
  if (body.strength !== undefined) patch.strength = parseRuleStrength(body.strength);
  if (typeof body.reason === "string") patch.reason = body.reason;
  return patch;
}
