# Kiran Voice Documents — Google Sheets Upgrade

This upgrade removes operational use of Supabase. It reads terminology from the connected Google Sheet and records each confirmed memorandum in both `MEMO` and `SHEET1`.

## Before uploading the code

For the first test, create a copy of the Google Sheet and put the copy's spreadsheet ID in `GOOGLE_SHEET_ID`. Do not test the first write against the live business master.

Add these Vercel variables before deployment:

- `APP_BASIC_USER` — for example `kiran`
- `APP_BASIC_PASSWORD` — use a strong password known only to the father/admin
- `GOOGLE_SHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- existing `GEMINI_API_KEY`
- existing `GEMINI_MODEL`

## Files to create or replace

Create:
- `src/lib/google-sheets.ts`
- `src/lib/google-sheet-vocabulary.ts`
- `src/components/GoogleSheetStatus.tsx`
- `src/app/api/google-sheet/status/route.ts`
- `src/proxy.ts`

Replace:
- `src/app/page.tsx`
- `src/components/ApprovalNoteEditor.tsx`
- `src/app/api/documents/commit/route.ts`
- `src/app/api/interpret-audio/route.ts`
- `src/app/api/interpret/route.ts`
- `src/lib/types.ts`

No package installation, SQL migration, Google Apps Script, or Supabase change is required.

## What the write does

After the user confirms a memorandum:

1. Determine the next numeric memorandum number from `MEMO` column A.
2. Write one line per product into `MEMO`.
3. Write the same line items into `SHEET1`.
4. Keep `RETURN DATE`, confirmation person, confirmation date, and confirmation time blank during creation.
5. Write an idempotency record into a hidden `_SYSTEM_LOG` worksheet.
6. Apply all official writes in one atomic Google Sheets `batchUpdate`.
7. Download the PDF only after Google confirms the write.

## Important testing rule

The current mapping uses the next integer prefix found in `MEMO` column A as the memo number in `SHEET1`. Verify this rule with the father before switching from the test copy to the live master.

## After deployment

1. Open the website.
2. Enter the Basic Authentication username and password.
3. Confirm Step 1 says `Google Sheet connected`.
4. Create one two-line test memorandum.
5. Check the exact new rows in `MEMO`, `SHEET1`, and hidden `_SYSTEM_LOG`.
6. Do not switch the environment variable to the live master until all three locations are correct.
