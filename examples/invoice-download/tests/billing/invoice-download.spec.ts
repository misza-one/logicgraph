import { canDownload } from "../../src/billing/InvoiceService";

if (!canDownload({ paymentStatus: "PAID", subscriptionStatus: "ACTIVE" })) {
  throw new Error("paid active customer should download invoice");
}
