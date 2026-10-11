# Tag Flow Pro

Build "Tagging Line" — a jewellery tagging workflow app for Shreedevi
Jewellers, a multi-showroom gold retail chain in India.

It is an assembly-line data capture tool for the tagging department. It does
NOT connect to our ERP (Prime Jewellery) directly. It produces an export that
is fed into the ERP separately.

STACK: React + Supabase (Postgres, Auth, Storage, Realtime, Row Level
Security).

UI: Mobile-first. Staff work on phones and tablets at a workbench, often
one-handed, sometimes wearing gloves. Large touch targets, numeric keypads on
every weight field, high contrast, minimal scrolling. Speed matters more than
polish — this screen is used hundreds of times a day.

==========================================================
1. ROLES AND ACCESS
==========================================================
MANAGER   creates lots and sublots, imports tag slot lists and HUID lists,
          assigns work, sees all totals and variances, clears holds, seals
          batches, runs exports.
STAFF     tray loading, weighing, HUID assignment.
          MUST NOT see sublot declared totals (declared_pcs,
          declared_net_weight) anywhere, ever. Enforce this with Row Level
          Security at the database level, not by hiding UI elements.
PHOTO     photo shot lists, ZIP upload, photo verification.
AUDITOR   read-only across everything.

Every write is stamped with user_id and timestamp. Nothing is hard-deleted;
soft-delete with a reason and keep the row.

==========================================================
2. MASTER DATA (manager-editable, CSV importable)
==========================================================
branches
  branch_code   single letter used inside ERP item codes
  branch_name
  SEED:  W = BZ,  H = VP,  G = DOM

vendors
  code, name, active

product_types
  base_code            product code WITHOUT the branch letter (e.g. "BL" for
                       bali, "KC" for the sample data)
  name
  default_pcs          ring = 1, earring = 2, bangle_pair = 2
  huid_pieces_per_tag  same as default_pcs
  The ERP item code (IC) is computed as branch_code + base_code.
  W + BL = WBL.  Compute it; never store it per branch.

purities
  melting        91.66 / 92.50 / 75.00 / 70.00
  purity_label   916 / 925 / 750 / 700
  metal
  These two forms are one record. Selecting a purity sets both.

trays
  tray_code, tray_type, rows, columns, compartment_count,
  suitable_product_types[], active
  SEED:
    A : SMALL_18, 6 rows x 3 columns, 18 compartments
    B : LARGE_12, 4 rows x 3 columns, 12 compartments
  More tray types will be added later. Do not hard-code either layout.

users
  name, role, pin, active

TRAY PHYSICAL CONVENTION
The tray letter is printed on the FRONT edge of the physical tray. When that
letter faces the user, compartment 1 is TOP-LEFT. Compartments are numbered
row-major: top row left to right, then the next row left to right, and so on.

==========================================================
3. DATA MODEL
==========================================================
lots
  lot_no            manager-entered, also written on the physical packet
  branch_id, vendor_id, purity_id, melting,
  wastage_pct, making_value,
  making_type       percentage | per_gram | per_piece
  received_date, notes, status

sublots
  lot_id, sublot_no, product_type_id,
  declared_pcs            <-- HIDDEN FROM STAFF (RLS)
  declared_net_weight     <-- HIDDEN FROM STAFF (RLS)
  status: draft | issued | loading | weighing | photography | ready_to_seal |
          sealed | exported | closed | halted

tray_sessions
  sublot_id, tray_id,
  status: empty | loaded | weighed | photographed | tagged | cleared
  opened_by, opened_at, closed_at
  A tray cannot enter a new session until its previous session is 'cleared'.
  Enforce this hard — it prevents a half-tagged tray being refilled.

items                    ONE ROW PER TAG, not per piece
  tray_session_id, compartment_no, sublot_id, sequence,
  gross_weight   NUMERIC(10,3)
  less_weight    NUMERIC(10,3) DEFAULT 0.000
  net_weight     GENERATED ALWAYS AS (gross_weight - less_weight)
  pcs, narration TEXT,
  compcode, type, ic, ser_no       assigned tag slot
  actual_ser_no                    reported back after ERP entry
  photo_filename, photo_url,
  hold_flag      null | damaged | wrong_item | re_photo | weight_disputed
  hold_note,
  weighed_by, weighed_at, photo_matched_at
  UNIQUE (tray_session_id, compartment_no)

huid_pool
  sublot_id, huid, piece_weight,
  assigned_item_id, assigned_at, assigned_by
  UNIQUE (huid) GLOBALLY across the entire database, for all time

item_huids
  item_id, huid_pool_id, position (1 or 2)

tag_slots
  sublot_id, compcode, type, ic, ser_no, cmd,
  assigned_item_id, imported_at

==========================================================
4. MANAGER: CREATE LOT AND SUBLOTS
==========================================================
Create lot: lot number (manual entry, written on the packet), branch, vendor
from master, purity (sets melting and purity_label together), wastage %,
making value, making type, received date, notes.

Create sublots under the lot: product type, total pcs, total net weight.
Those two totals are the blind-reconciliation targets and must never be
visible to STAFF.

Issue sublot to staff (status -> issued).

==========================================================
5. TAG SLOT IMPORT — READ THIS CAREFULLY
==========================================================
The ERP exports an Excel sheet of AVAILABLE tag slots. It is NOT a contiguous
reserved block. It is a GAP LIST — the ERP fills holes in the series. A real
example: ser_no 66 to 128 with 80 and 109 absent, because those two slots are
already occupied by existing items.

The sheet has 131 columns. Only these are populated on export:
  COMPCODE   constant company prefix, currently always "A"
  type       BRANCH CODE — W (BZ), H (VP), G (DOM)
  IC         item code = branch_code + product base_code, e.g. "WKC", "WBL"
  ser_no     available serial number, integer, UNPADDED
  cmd        command flag, "C"
  markbyuser, imgyesno, newarrv     booleans, all FALSE

IMPORT RULES
  - parse only the populated columns above; ignore the other ~123
  - store each ser_no as its OWN ROW in tag_slots
  - NEVER store as a start/end range. NEVER assume the sequence is contiguous.
    Assuming contiguity would throw every tag number after the first gap out
    by one.
  - validate COMPCODE, type and IC are IDENTICAL across every row; reject a
    mixed file
  - reject if `type` does not match the branch selected on the lot
  - reject if `IC` does not begin with that branch's letter
  - reject if `IC` minus its first character does not equal the sublot's
    product_type.base_code
    These three checks catch a wrong-file import before any work is done.
  - display: available slot count, min ser_no, max ser_no, and the list of gaps
  - warn if available slot count < sublot declared_pcs
  - show a standing warning on this screen:
    "Re-export this list from the ERP immediately before starting the batch.
     Numbers consumed by other terminals since export will cause a mismatch."

The tag series is segmented by branch AND product type, so every batch imports
its own slot list. One sublot = one product type = one slot list.

==========================================================
6. HUID POOL IMPORT
==========================================================
The hallmarking centre supplies a list of INDIVIDUAL PIECES — one row per
piece, each with a weight and a 6-character HUID. The rows arrive in random
order and are NOT paired. For 14 earring pairs the file contains 28 rows.

ON IMPORT
  - HUID: exactly 6 characters, alphanumeric, auto-uppercase, trimmed
  - check uniqueness against EVERY HUID ever stored in the database. Hard
    block any duplicate and show which item already holds it.
  - warn on confusable characters (0/O, 1/I, 5/S, 8/B, 2/Z)
  - show total pieces and total weight of the list
  - compare piece count against declared_pcs x huid_pieces_per_tag and flag
    any mismatch to the manager

==========================================================
7. TRAY LOADING (staff)
==========================================================
Select sublot by the lot number printed on the packet, then select the tray
letter. The app opens a tray session and renders the compartment grid at the
tray's ACTUAL rows x columns, in physical orientation, with the tray letter
shown at the BOTTOM edge to match how the user is holding it.
A 6x3 tray must never render as 3x6.

Staff taps each filled compartment to mark it occupied. Empty compartments
stay empty. A sublot may span multiple trays.

==========================================================
8. WEIGHING AND HUID STATION (staff) — THE CORE SCREEN
==========================================================
Compartment grid, colour-coded by state:
  empty | loaded, awaiting weight | weighed | HUID assigned | photographed |
  on hold

Tap a compartment (or let it auto-advance) to open the entry panel:

  gross weight   numeric keypad, 3 decimals, required
  less weight    numeric keypad, 3 decimals, defaults to 0.000
                 There is NO stone/non-stone toggle. Non-stone items simply
                 leave it at zero.
  net weight     read-only, automatically gross - less
  pcs            pre-filled from product_type.default_pcs, editable
  narration      free text, optional
  HUID           see below

OUTLIER CHECK
If gross weight is more than 3x or less than 1/3 of the running average for
this sublot, show a confirm-before-save warning. Do not block — catches
decimal slips without obstructing genuine outliers.

HUID ASSIGNMENT BY WEIGHT MATCHING
When gross weight is entered, search unassigned huid_pool rows for this
sublot and suggest matches:

  pcs = 1 : single pool rows whose piece_weight is closest to the entered NET
            weight
  pcs = 2 : PAIRS of unassigned rows whose weights SUM closest to the entered
            net weight, ranked by (a) closeness of the sum and (b) how similar
            the two pieces are to each other — real earring pairs are nearly
            identical in weight

Show the top 3 suggestions as tappable cards displaying both weights and both
HUIDs. Tap to assign.

Always allow override: a search box filtering the remaining pool by any part
of a HUID, plus manual typed entry as a last resort.

RULES
  - number of HUID slots = pcs, all mandatory
  - a pool row can be consumed by only one item
  - the two HUIDs on a single tag cannot be identical
  - unassigning an item returns its HUIDs to the pool
  - persistent counter on screen: "HUIDs remaining: N"

A tray session closes when every occupied compartment has a weight and a
complete HUID set.

==========================================================
9. BLIND RECONCILIATION
==========================================================
When all trays for a sublot are weighed, staff taps "Close Sublot". Compare:
  entered pcs vs declared_pcs
  sum of net weights vs declared_net_weight
  tolerance: +/- 0.050g per 10 pieces (a configurable setting)
  HUID pool fully consumed (remaining = 0)

  PASS -> sublot moves to photography automatically
  FAIL -> sublot LOCKS.
          Staff see only: "Reconciliation failed — call manager."
          Manager sees the actual variance figures.
          NEVER show staff which item is wrong.

==========================================================
10. PHOTOGRAPHY — EXTERNAL APP PLUS UPLOAD
==========================================================
Photos are captured in a SEPARATE existing app, not in this one. This app
handles assignment and verification only.

10.1 Manager assigns a sublot to a photographer. The app generates a SHOT
     LIST: lot number, tray letters, occupied compartment numbers per tray,
     total expected photo count. Viewable on phone and printable.

10.2 The photographer shoots ONE image per occupied compartment, in tray
     order, naming each file:
         {lot_no}-{tray_code}-{compartment_no}.jpg
     with compartment zero-padded to 2 digits, e.g. L2609047-A-07.jpg

10.3 The photographer uploads the ZIP into this app. On upload:
     - parse filenames and match each to a compartment
     - report: matched / MISSING compartments / EXTRA unmatched files /
       duplicates
     - a sublot cannot reach ready_to_seal with any missing photo
     - allow re-upload of individual replacement files
     - store images AS-IS. Do NOT re-compress.

10.4 At seal, produce a renamed ZIP with ERP-ready filenames plus
     rename_map.csv (old filename, new filename, tray, compartment, ser_no).

     THE ERP PHOTO FILENAME IS DETERMINISTIC:
         COMPCODE + IC + ser_no + ".JPEG"
     Examples:
         COMPCODE "A" + IC "WKC" + ser_no 66  ->  AWKC66.JPEG
         COMPCODE "A" + IC "WBL" + ser_no 56  ->  AWBL56.JPEG

     ser_no is NOT zero-padded. Extension is uppercase .JPEG.
     Keep the pattern as an editable template setting with this as default.

     This same string is written to the `image` column in the export, and
     `imgyesno` is set TRUE for every item with a matched photo.

==========================================================
11. HOLDS
==========================================================
Any compartment can be flagged: damaged, wrong_item, re_photo,
weight_disputed — each with a note.

A sublot cannot be sealed while any hold is open. The manager can clear a
hold, or remove the item from the sublot entirely — which adjusts the
reconciliation target and returns its HUIDs to the pool.

==========================================================
12. SEAL AND TAG ASSIGNMENT
==========================================================
Tag slots are assigned ONLY at seal — never earlier. Early assignment would
leave gaps in the sequence whenever an item is pulled for a hold.

PRECONDITIONS TO SEAL
  reconciliation passed, all photos matched, zero open holds, HUID pool empty,
  enough available tag slots.

ON SEAL
  - order items physically: Tray A compartment 1..n, then Tray B 1..n, and so
    on, skipping unoccupied compartments. Write this as `sequence`.
  - assign tag slots in ASCENDING ser_no order from the available list,
    walking past gaps
  - ONE SLOT PER ITEM. A pair of earrings consumes ONE ser_no with pcs=2 and
    two HUIDs. Never two slots for one tag.
  - copy compcode, type, ic, ser_no onto each item
  - compute and store photo_filename = COMPCODE + IC + ser_no + ".JPEG"
  - lock the sublot against further edits

==========================================================
13. EXPORT — TWO MODES
==========================================================
MODE 1 (preferred, pending confirmation from the ERP vendor)
Emit a filled copy of the ERP's own 131-column sheet: one row per item, in
`sequence` order, cmd='C', preserving the exact column names and order of the
original export. Write captured values into:
  gw, nw, NARRATION, pcs, purity, carrat, MAKING, mkper, labrate,
  par_code, HUID, CATA, CATB, CATC, STNPCS, OW, image, imgyesno
Leave all other columns exactly as exported.
HUID is a comma-joined string: "ABC123" or "ABC123,DEF456".
Store HUIDs as separate rows internally; join only at export time.

MAKE THIS FIELD MAPPING A CONFIGURABLE SETTING — an editable table of
internal field -> sheet column — so it can be corrected without a code change.
The exact meaning of some ERP columns is still being confirmed.

MODE 2 (fallback — keystroke bot via REST API)
  POST /api/batches/{sublot_id}/tag-slots        import the slot list
  POST /api/batches/{sublot_id}/seal             lock and assign
  GET  /api/batches/{sublot_id}/items            ordered list for the bot
  POST /api/batches/{sublot_id}/items/{sequence}/result

GET returns one object per item, ordered by `sequence`, with the ERP fields in
the EXACT tab order of the ERP tagging screen so the bot is a dumb keystroke
replayer with no mapping logic:
  gross_weight, less_weight, melting, wastage_pct, narration, pcs,
  making_value, making_type, purity_label, vendor_code, huids

Plus, on every row, for verification (the ERP does not need these):
  sequence, compcode, type, ic, expected_ser_no, tray_code, compartment_no,
  photo_filename

POST result body: { actual_ser_no, status: "ok" | "failed", error_message }
If actual_ser_no != expected_ser_no, record the mismatch and set the sublot
status to 'halted'. The bot stops on the first mismatch rather than running a
whole batch onto wrong numbers.

Auth: API key per bot client, sent in a header.

Both modes read the same item records.

MANUAL DOWNLOAD
Also provide a manual ZIP for the manager containing: the filled sheet,
batch.json, manifest.json (counts, generated_at, generated_by),
rename_map.csv, and a photos/ folder with ERP-named files.

==========================================================
14. WIP DASHBOARD
==========================================================
Live view of every open tray session: sublot, lot number, tray letter, current
status, who is holding it, minutes at that station. Highlight anything past a
configurable ageing threshold. Realtime updates.

==========================================================
15. THROUGHPUT TRACKING
==========================================================
Record per-item timing at each station and per user. Report: items per hour by
user, by station, by date. Data collection only — no incentive logic, no
leaderboard, no rankings shown to staff.

==========================================================
16. OFFLINE TOLERANCE (REQUIRED)
==========================================================
The tagging room has unreliable wifi.
  - queue all text writes (weights, HUIDs, narration, compartment state)
    locally in IndexedDB; sync when the connection returns
  - persistent sync indicator: online / syncing (N pending) / offline
  - a page refresh or app restart must NEVER lose queued work
  - HUID global uniqueness needs connectivity. When offline, validate against
    the local sublot pool only, then re-validate on sync and flag any conflict
    loudly to the manager.

==========================================================
17. NOT IN SCOPE — but design the schema to accept these later
==========================================================
No category A/B/C entry. No size capture. No barcode or QR scanning — trays
and compartments are labelled physically and selected manually. No weighing-
scale serial integration — weights are typed. No image compression. No in-app
camera.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://jewel-tag-flow.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/fc84c14d-662b-4550-8bd2-0ddf0e1cfc90).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
