import { initialMigration } from "./001-initial.js";
import { seedWorkflowsMigration } from "./002-seed-workflows.js";
import { manualWriteCompletionMigration } from "./003-manual-write-completion.js";
import { taskWorktreeIntentMigration } from "./004-task-worktree-intent.js";
import { streamlineQuestionWorkflowMigration } from "./005-streamline-question-workflow.js";
import { gateOrientedWorkflowsMigration } from "./006-gate-oriented-workflows.js";
import { mindPalaceCoreMigration } from "./007-mind-palace-core.js";
import { normalizePrototypeTasksMigration } from "./008-normalize-prototype-tasks.js";
import { optionalEstimatesAndExampleTagsMigration } from "./009-optional-estimates-and-example-tags.js";

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  initialMigration,
  seedWorkflowsMigration,
  manualWriteCompletionMigration,
  taskWorktreeIntentMigration,
  streamlineQuestionWorkflowMigration,
  gateOrientedWorkflowsMigration,
  mindPalaceCoreMigration,
  normalizePrototypeTasksMigration,
  optionalEstimatesAndExampleTagsMigration,
];
