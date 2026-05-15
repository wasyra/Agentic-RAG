export function documentStatusBadgeVariant(
  status: string,
): "warning" | "info" | "success" | "danger" | "neutral" {
  switch (status) {
    case "pending":
      return "warning";
    case "processing":
      return "info";
    case "indexed":
      return "success";
    case "error":
      return "danger";
    default:
      return "neutral";
  }
}

export function formatDocError(msg: string): string {
  return msg.replace(/^\[GoogleGenerativeAI Error\]:\s*/i, "").trim();
}

export function documentStatusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "En cola";
    case "processing":
      return "Indexando…";
    case "indexed":
      return "Listo";
    case "error":
      return "Error";
    default:
      return status;
  }
}
