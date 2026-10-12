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
- Nothing is hard-deleted except whole lots via manager-only `delete_lot` (typed DELETE; logs to `lot_deletions`, purges via `app.purge` session flag). Everything else uses soft-delete columns. Why: audit trail, with an explicit manager escape hatch.
- Station screen is a step flow (`src/components/station/steps-*.tsx`); it live-refreshes via realtime on items/huid_pool/item_huids/tag_slots so several staff can share a sublot. Tag numbers/HUID lists can be read from images/PDFs by `src/lib/ocr.functions.ts` (AI gateway), always reviewed by the user before saving.
- Who-did-what comes from `station_events` (user_id defaults to auth.uid()) plus *_by columns. Why: one activity source for the manager view.
- Staff writes are queued in IndexedDB (`src/lib/offline.ts`) and replayed as RPCs; station screens overlay pending ops on a cached snapshot (`src/lib/station.ts`). Why: unreliable wifi must never lose work.
- Tag slots are one row per ser_no and assigned only inside `seal_sublot`. Why: ERP list is a gap list.
- `src/lib/batch.ts` builds the ordered batch for both manual export and the bot API (`/api/public/batches/*`, x-api-key hashed in `bot_clients`). Why: both modes read the same records.
- Login is username + PIN mapped to `username@staff.taggingline.app`; users are created only by managers via admin server functions; public signup is disabled.
- tsconfig relaxes noUncheckedIndexedAccess / noPropertyAccessFromIndexSignature / exactOptionalPropertyTypes / noImplicitReturns. Why: loosely-typed DB rows (`db` handle) across a large schema.
- Mode 1 export falls back to `src/lib/erp-template.ts` (exact 131-column ERP order) when a sublot has no stored headers. Why: sheet must match the ERP import format.
- Photography runs AFTER seal: close_sublot → ready_to_seal → seal (assigns tags + photo_filename) → assign_photographer → photography → device /complete → ready_to_export. Unseal (manager, logged in `sublot_unseals`) reverts to ready_to_seal. Why: photo names need tag numbers.
- Photos live in private bucket `item-photos/{sublot_id}/{filename}`, written only by server routes (`/api/public/photo/*`, x-api-key kind='photo'); bot routes require kind='bot'. Photo device responses never include weights or declared totals. Stored copies are purged once the bot confirms ERP delivery.
- Lots hold only branch, dates and packet totals (`lot_targets`, manager/auditor-only); vendor, purity, melting, wastage and making live on each sublot (old lot columns deprecated; `batch.ts` falls back to them). Why: one packet can mix vendors/charges per product type.
- Staff never receive huid_pool.piece_weight (column grant excludes it); HUID weight matching and search run in the SECURITY DEFINER `suggest_huids` RPC, which returns HUID strings only; managers read weights via `huid_pool_admin`. Why: summed piece weights equal the declared net weight.
- Station loading is a blind manual tap count — no RPC may return declared or remaining tag counts to staff. Why: blind reconciliation.
- Every /api/public/* handler is wrapped with `cors()` + `OPTIONS: preflight` from `src/lib/cors.server.ts`; origins come from the manager-edited `settings.cors_origins` allowlist, never a wildcard. Why: the photo PWA runs on another origin.
- Since 27 Sept, schema migrations live in drizzle/migrations (applied by the migration tool); supabase/migrations holds an index file pointing to them.
