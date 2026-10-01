# Writing sourced memories

Use the live tool schemas as the authority for accepted fields. All calls use
the selected instance's server. Never send `individualId`, a storage ID, or an
extra routing field. Check every returned `individualId` against the identity
recovered for this interaction.

## Create

Call `ezer_remember` with:

- `memoryId`: a new stable record ID, preferably a UUID.
- `operationId`: a different new ID for this specific write, retained with its
  exact payload until its outcome is known.
- `body`: compact, self-contained text with scope and uncertainty where relevant.
- `source`: `{ "reference": "...", "excerpt": "..." }` documenting the evidence.

Use an actual conversation/message identifier, document location, or tool-result
reference when available. If the host supplies no durable message link, use an
honest descriptive locator such as `conversation:2026-10-02:user-preference` and
say it is a descriptive locator, not a retrievable transcript. The excerpt must
faithfully quote the relevant available evidence. For a self-reflection, label
both its origin and uncertainty and cite supporting evidence; do not invent a
user quotation or source URL. Put evidence early enough to make listing previews
useful, without depending on a fixed body format.

IDs are 1–128 ASCII characters, start with an alphanumeric character, and otherwise
allow alphanumerics, `.`, `_`, `:`, and `-`. Nonblank text limits are 16,384 UTF-16
code units for body, 1,024 for source reference, 4,096 for excerpt, and 1,024 for
a revision reason. Keep notes comfortably below these limits.

## Correct

Read the latest record using `ezer_read({"memoryId": "..."})` without a revision.
Then call `ezer_revise` with the same memory ID, a new operation ID, replacement
body and source, `expectedRevision` from that read, and a concise `reason`.
Preserve still-valid information in the replacement. This appends history;
it does not erase previous bodies or sources.

## Interpret results and recover

Success contains a receipt with `individualId`, `memoryId`, `revision`,
`recordedAt`, and `changeSequence`. Read success contains a `memory` with the full
body, source, and reason. Prefer `structuredContent` when available; hosts may
expose the equivalent JSON text. A tool result with `isError: true` is a failure.

| Result                                                       | Action                                                                                                                                                                                  |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lost response, `UNAVAILABLE`, or `INTERNAL_ERROR` on a write | Retry at most once with the identical operation ID and complete payload. If still uncertain, report uncertainty; do not generate a fresh write that could duplicate the memory.         |
| `REVISION_CONFLICT`                                          | Read latest, reconcile the actual difference, and use a new operation ID only for the newly decided write. If it conflicts again, surface the concurrent change instead of looping.     |
| `OPERATION_CONFLICT`                                         | The operation ID has already been used for a different request. Stop and resolve the mismatch; never assume this request succeeded.                                                     |
| `ALREADY_EXISTS`                                             | Read the existing record before deciding whether this is an ID collision, redundant learning, or a correction. Never overwrite blindly.                                                 |
| `NOT_FOUND`                                                  | Recheck the record reference on this server. Do not search another Ezer or create a replacement automatically.                                                                          |
| `READ_NOT_GRANTED` / `WRITE_NOT_GRANTED`                     | Report the missing capability. Connection permission grants neither. With unreadable history, do not infer an empty memory or automatically create substitute identity/summary records. |
| `INVALID_INPUT`                                              | Check the live schema and limits. A corrected write uses a new operation ID; do not mutate a payload retained for an uncertain retry.                                                   |
| `CAPACITY_EXCEEDED`                                          | Stop writing and report the limit. Do not split or loop around it.                                                                                                                      |

A replayed success receipt can describe an older revision even after another
write: it confirms the original operation, not that the record is still current.
Start a fresh list without a cursor to observe new changes. Never reuse a cursor
across instances or treat a snapshot as a live subscription.
