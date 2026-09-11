import { EMPTY_GUID } from "./constants.mjs";

const SALES_CHANNELS = new Set(["all", "online", "offline"]);

export function normalizeSalesChannel(value = "all") {
  const channel = String(value || "all").toLowerCase();

  if (!SALES_CHANNELS.has(channel)) {
    throw new Error("Канал продаж должен быть all, online или offline");
  }

  return channel;
}
export function parseSalesChannel(value) {
  try {
    return normalizeSalesChannel(value);
  } catch {
    return "all";
  }
}

export function salesChannelFromOrder(orderKey) {
  return orderKey && orderKey !== EMPTY_GUID ? "online" : "offline";
}
