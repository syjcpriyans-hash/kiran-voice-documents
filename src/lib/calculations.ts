import type { ApprovalItem } from "@/lib/types";

export function totalCarats(items: ApprovalItem[]): number {
  return Number(items.reduce((sum, item) => sum + (Number(item.carats) || 0), 0).toFixed(2));
}

export function formatIndianCurrency(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

export function formatApprovalDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date
    .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })
    .replaceAll(" ", "-");
}
