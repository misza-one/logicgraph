import { canDownload } from "./InvoiceService";

export function DownloadInvoiceButton(input: { paymentStatus: string; subscriptionStatus: string }) {
  return canDownload(input) ? <button type="button">Download invoice</button> : null;
}
