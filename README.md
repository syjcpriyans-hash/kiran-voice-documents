# Kiran Voice Documents

A mobile-first approval-note workflow for Kiran Gems.

The intended workflow is:

1. Upload the current Excel workbook.
2. Convert the selected worksheet into structured Supabase rows.
3. Speak the approval-note request in Indian English, Gujarati or Hindi.
4. Extract the recipient name directly from speech.
5. Match products and prices from the imported workbook data.
6. Review all names and numbers.
7. Reserve one safe serial reference in Supabase.
8. Generate the fixed-format PDF temporarily in the browser.
9. Write the same reference and transaction back to the master Excel workbook.
10. Download the PDF without storing generated PDFs in Supabase.

## What this first build already includes

- Mobile-first web interface.
- Chrome browser speech input with English, Gujarati and Hindi language choices.
- Typed fallback when microphone recognition is unavailable.
- Excel workbook inspection.
- Source-sheet selection.
- Structured workbook import into Supabase.
- One current workbook stored in a private Supabase Storage bucket.
- Approval-note preview based on the supplied photograph.
- Editable recipient and product fields.
- Atomic financial-year serial generation in PostgreSQL.
- Idempotency protection against accidental double-click serial duplication.
- Excel write-back into a temporary `Generated Documents` worksheet.
- Browser-side PDF generation and download.
- No generated PDF storage.

## Deliberately pending

These parts require the actual Excel workbook or a flat blank document template:

- Exact Excel column mapping.
- Product and price matching rules.
- Identification of the real product/packet serial-number column.
- Exact write-back sheet and cells.
- Pixel-accurate logos, fonts and coordinates.
- Final PDF/printing calibration.
- Supabase login restricted to the father and administrator.

## Environment variables

Copy `.env.example` to `.env.local` for local development, or add the same names in Vercel:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
GEMINI_API_KEY=
GEMINI_MODEL=
```

`SUPABASE_SECRET_KEY` must never appear in browser code, screenshots, GitHub commits or public messages.

## Database setup

Run this file once in the Supabase SQL Editor:

```text
supabase/migrations/001_initial.sql
```

The migration creates:

- workbook imports;
- structured workbook rows;
- workbook settings;
- document records;
- document line items;
- document serial sequences;
- the atomic `create_approval_note` function;
- a private `workbooks` Storage bucket.

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Vercel deployment

Import this GitHub repository into Vercel, add the environment variables, and deploy. Every future push to the main branch will trigger a new deployment.

## Important safety rule

AI may interpret speech, but it must not invent prices, calculate the official serial number or silently finalize the document. Prices come from workbook data, calculations come from deterministic code, and the father must confirm the preview before generation.
