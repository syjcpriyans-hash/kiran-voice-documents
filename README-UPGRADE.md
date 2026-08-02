# Kiran Voice Documents — Operations Upgrade

This version keeps the final memo-numbering rule and pixel-identical PDF design unchanged for later. It adds the operational features that can be completed now.

## Included

- Voice-enabled Mark Returned workflow
  - updates SHEET1 Return Date
  - updates Confirm Person, confirmation Date and Time
  - updates MEMO status for app-created memorandums
- CUT. MASTER name matching
  - customer/party suggestions
  - broker/through suggestions
  - operator/confirmation-person suggestions
- MEMO terminology matching
  - actual historical shape + quality combinations only
  - size, shape, quality and colour validation
- strict confirmation and duplicate-row checks
- hidden `_SYSTEM_LOG` duplicate protection
- history search and PDF regeneration
- non-destructive VOID workflow
  - no row deletion
  - marks MEMO status VOID
  - adds reason to SHEET1 remarks
  - records void time/reason in `_SYSTEM_LOG`
- old Excel/Supabase import endpoints disabled
- Basic Authentication remains enabled

## Files created

- `src/components/ReturnWorkflow.tsx`
- `src/components/DocumentHistory.tsx`
- `src/components/VoidWorkflow.tsx`
- `src/app/api/master-data/route.ts`
- `src/app/api/history/route.ts`
- `src/app/api/returns/lookup/route.ts`
- `src/app/api/returns/interpret/route.ts`
- `src/app/api/returns/commit/route.ts`
- `src/app/api/voids/commit/route.ts`
- `src/lib/master-data.ts`
- `src/lib/return-workflow.ts`
- `src/lib/sheet-write.ts`

## Important behaviour

- New documents still use the current temporary internal numeric memo rule. The final official numbering rule is intentionally deferred.
- The current PDF layout remains the existing approximation. Exact visual calibration is intentionally deferred.
- A returned memorandum cannot be voided automatically.
- Historical rows without an `_SYSTEM_LOG` link can be marked returned using their official SHEET1 memo number, but cannot be voided automatically.
- Correcting an app-created memo uses this process:
  1. mark the incorrect memo VOID;
  2. open History;
  3. load the original document;
  4. edit the incorrect field;
  5. create a new replacement memo.

## Vercel variables required

- `GOOGLE_SHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `APP_BASIC_USER`
- `APP_BASIC_PASSWORD`

No new environment variable, Google permission or SQL migration is required.

The final numbering rule and exact PDF background/coordinates are intentionally not changed in this package.
