// Legal copy that ships on every printed Sales Order. Hardcoded because
// the SO becomes a binding tax invoice on full payment (T&C #1) — these
// strings are the legal record. If 2990's incorporates a new entity or
// changes registered address, edit here and ship.
//
// A change here reaches the POS print page, the shared PDF, Sign & confirm
// and the Handover summary. The old Backend keeps its own copy, edited by
// hand (apps/backend/src/lib/pdf-common.ts, sales-order-pdf.ts).
//
// ⚠️ A Sales Order printed from Houzs ERP does NOT read this file: Houzs
// prints from its own copy (frontend/src/vendor/scm/lib/sales-order-pdf.ts
// there), which carries terms 1–5 only and no contact line. Owner
// 2026-11-15: leave it so for now.

export const COMPANY_LEGAL = {
  name:    '2990 HOME SDN. BHD.',
  ssm:     '202501060667',
  hqLines: [
    'E-28-02 & E-28-03, Menara SUEZCAP 2, KL Gateway,',
    'No. 2, Jalan Kerinchi, Gerbang Kerinchi Lestari,',
    '59200 Kuala Lumpur, Wilayah Persekutuan KL',
  ],
  /* Company contact number, printed under the letterhead address on every
     SO surface (this print page, the shared PDF, the Handover summary, and
     the Backend PDFs via pdf-common COMPANY.customerServicePhone — keep the
     two in sync like name/ssm/address). Labelled "Customer service": it is a
     line customers can call (owner 2026-11-15; it replaced the WhatsApp-only
     +60 11-2166 2990, which was labelled "WhatsApp" so nobody rang it). ONE
     number company-wide (Loo 2026-09-01): venues carry no phone of their own,
     since Houzs's project_venues master has no such column. Empty string =>
     the line is not rendered at all, so an unset number never prints a blank
     label on a legal document. */
  customerServicePhone: '+60 18-205 8603',
  showroomName: 'PJ Showroom',
  showroomLine: '51, Jln Utara, PJS 12, 46200 Petaling Jaya, Selangor',
  portalLabel:  "2990's Portal",
} as const;

/* Term 6 names cancellation as well as the deposit (owner 2026-11-15): a
   customer complained that the SO said the deposit was not refundable but
   never said the order could not be cancelled — and under 2990's rules it
   cannot, once a deposit is paid. It REPLACES the earlier "All deposits paid
   are not refundable." (2026-10-02) in the same slot, so the terms keep their
   numbers. */
export const RECEIPT_TERMS: readonly string[] = [
  'This sales order becomes a binding tax invoice once goods are delivered and full payment is reconciled.',
  'Balance due is payable in full before delivery. Bank transfer, DuitNow QR, and cheque accepted.',
  'Delivery date is best-effort and may shift ±3 working days subject to operation confirmation.',
  'Stair-carry surcharges (if any) are billed on this sales order and are not invoiced separately on the DO.',
  'Once the delivery date has been confirmed, any subsequent request to change or extend the date will incur a rescheduling surcharge.',
  'Once a deposit has been paid, this sales order cannot be cancelled and the deposit is not refundable.',
] as const;
