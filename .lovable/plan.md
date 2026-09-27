# Tagging Line — Build Plan

A mobile-first tagging workflow app for Shreedevi Jewellers. The spec is large, so it ships in phases. Each phase leaves a working app.

## Phase 1 — Foundation
- Turn on Lovable Cloud (database, logins, file storage, live updates).
- Logins with a separate roles table: manager, staff, photo, auditor. Staff sign in with a PIN.
- Master data screens plus CSV import: branches (seed W/BZ, H/VP, G/DOM), vendors, product types, purities, trays (seed A = 6x3, B = 4x3), users.
- Full data model from the spec: every write is stamped with user and time, and nothing is hard-deleted.
- Staff are blocked from declared totals at the database level. Declared pcs and weight live in a separate table that staff cannot read.

## Phase 2 — Manager intake
- Create lots and sublots, then issue sublots to staff.
- Tag slot import from the ERP Excel file. One row per ser_no, gaps shown, plus the three wrong-file checks, the count warning and the standing re-export warning.
- HUID list import: format checks, a global duplicate block, confusable-character warnings, and total count and weight checked against the expected count.

## Phase 3 — Staff stations (core)
- Tray loading. The grid draws at the tray's real rows x columns, with the tray letter at the bottom edge. A tray can't be reused until its last session is cleared.
- Weighing and HUID station:
  - big on-screen number keypad
  - net weight worked out for you
  - warning if a weight looks out of line with the rest of the sublot
  - HUID suggestions matched by weight, for singles and pairs
  - search and manual entry as a fallback
  - "HUIDs remaining" counter
- Holds with notes.
- Blind reconciliation with an adjustable tolerance. When it fails, staff only see "call manager".

## Phase 4 — Offline tolerance
- All staff entries are saved on the device first and sent when the connection returns. Nothing is lost on a refresh.
- Online / syncing (N pending) / offline indicator.
- Offline HUID checks use the sublot's own list. Anything that clashes after syncing is flagged to the manager.

## Phase 5 — Photography
- Assign a photographer, plus a shot list you can view on a phone or print.
- ZIP upload matched by filename, reporting matched, missing, extra and duplicate photos. Single photos can be replaced. Images are stored as-is.

## Phase 6 — Seal and export
- Seal checks every precondition, puts items in physical order, and assigns tag slots in ascending order, skipping gaps (one slot per tag).
- ERP photo names come from an editable pattern (default A + IC + ser_no + .JPEG).
- Export mode 1: a filled copy of the 131-column sheet, using an editable field-to-column mapping.
- Export mode 2: the bot's REST connection with an API key per bot and halt on the first mismatch.
- Manual ZIP download: the filled sheet, batch.json, manifest.json, rename_map.csv and ERP-named photos.

## Phase 7 — Oversight
- Live WIP dashboard with ageing highlights.
- Throughput reports by user, station and date (manager and auditor only).

## Technical notes
- TanStack Start with server functions. The bot connection uses server routes under /api/public/batches/..., checked with a hashed API key.
- Row Level Security on every table. Role checks use has_role(). Declared totals sit in sublot_targets, which only manager and auditor can select.
- The schema leaves room for later additions: category, size, barcode and scale fields.

## To confirm
- Do staff PINs replace email logins for staff, with managers using email?
- Can you send a sample ERP export (the 131-column file) and a sample HUID list file?
