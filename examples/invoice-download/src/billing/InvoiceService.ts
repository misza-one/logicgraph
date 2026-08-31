export function canDownload(input: { paymentStatus: string; subscriptionStatus: string }): boolean {
  return input.paymentStatus === "PAID" && input.subscriptionStatus === "ACTIVE";
}
