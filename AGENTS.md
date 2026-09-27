<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# Architecture rules

- Staff/photo writes go only through SECURITY DEFINER RPCs (open_tray_session, set_compartment, save_weight, assign_item_huids, …); tables grant SELECT only. Why: business rules (locks, HUID uniqueness, one open session per tray) live in one place.
- Declared totals (declared_tags, declared_pieces, declared_net_weight) live in `sublot_targets`, readable only by manager/auditor; `close_sublot` returns only a boolean. Declared values are immutable; removals go only through `remove_item`, which logs to immutable `item_removals` and increments `removed_*` (target = declared − removed; tolerance on declared_pieces). Why: blind reconciliation enforced by RLS, full audit of removals.
- Nothing is hard-deleted: soft-delete columns (`deleted_at/by/reason`, `removed_at`, `superseded_at`). Why: audit trail.
- Staff writes are queued in IndexedDB (`src/lib/offline.ts`) and replayed as RPCs; station screens overlay pending ops on a cached snapshot (`src/lib/station.ts`). Why: unreliable wifi must never lose work.
- Tag slots are one row per ser_no and assigned only inside `seal_sublot`. Why: ERP list is a gap list.
- `src/lib/batch.ts` builds the ordered batch for both manual export and the bot API (`/api/public/batches/*`, x-api-key hashed in `bot_clients`). Why: both modes read the same records.
- Login is username + PIN mapped to `username@staff.taggingline.app`; users are created only by managers via admin server functions; public signup is disabled.
- tsconfig relaxes noUncheckedIndexedAccess / noPropertyAccessFromIndexSignature / exactOptionalPropertyTypes / noImplicitReturns. Why: loosely-typed DB rows (`db` handle) across a large schema.
- Mode 1 export falls back to `src/lib/erp-template.ts` (exact 131-column ERP order) when a sublot has no stored headers. Why: sheet must match the ERP import format.
