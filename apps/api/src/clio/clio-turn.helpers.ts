/**
 * Pure helper for re-running a Clio turn (P0-4: regenerate / edit-and-resend).
 *
 * Both modes re-run the conversation's last user turn WITHOUT persisting a new
 * user message, discarding the assistant turn(s) that came after it:
 *  - regenerate: re-use the last user message verbatim.
 *  - resend:     replace the last user message body with the edited text, then
 *                discard everything after it.
 *
 * Pure (no I/O) so it unit-tests under `src/**.spec.ts`; the service executes the
 * returned plan (update + delete) and re-streams a fresh assistant turn.
 */

export type TurnRerunMode = 'regenerate' | 'resend';

export interface RerunMessage {
  id: string;
  role: string;
  body: string;
}

export interface TurnRerunPlan {
  /** The user content to re-run with. */
  contentToUse: string;
  /** Message ids to delete — the assistant turn(s) after the last user message. */
  deleteMessageIds: string[];
  /** For 'resend', the last user message id whose body to update; else null. */
  updateUserMessageId: string | null;
}

/**
 * Plan a re-run. `messages` must be chronological (oldest first). Returns null
 * when there is no user message to re-run.
 */
export function planTurnRerun(
  messages: RerunMessage[],
  mode: TurnRerunMode,
  editedBody?: string,
): TurnRerunPlan | null {
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]!.role === 'user') {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx < 0) return null;

  const lastUser = messages[lastUserIdx]!;
  const deleteMessageIds = messages.slice(lastUserIdx + 1).map((m) => m.id);

  if (mode === 'resend') {
    const edited = (editedBody ?? '').trim();
    return {
      contentToUse: edited || lastUser.body,
      deleteMessageIds,
      updateUserMessageId: lastUser.id,
    };
  }
  return {
    contentToUse: lastUser.body,
    deleteMessageIds,
    updateUserMessageId: null,
  };
}
