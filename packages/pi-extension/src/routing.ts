import type { BridgeMessageType, BridgeConfigV1 } from "@intent-bridge/core";

export interface PiInputLike {
  text: string;
  images?: readonly unknown[];
  source: "interactive" | "rpc" | "extension" | string;
  streamingBehavior?: "steer" | "followUp";
}

export type BypassReason =
  | "empty"
  | "small_talk"
  | "command"
  | "shell"
  | "extension"
  | "image_only"
  | "disabled"
  | "mode"
  | "unsupported";

const smallTalk = new Set([
  "merhaba",
  "selam",
  "selamlar",
  "günaydın",
  "iyi akşamlar",
  "nasılsın",
  "teşekkürler",
  "sağ ol",
  "tamam",
  "görüşürüz",
  "hi",
  "hello",
  "hey",
  "good morning",
  "how are you",
  "thanks",
  "thank you",
  "ok",
  "okay",
  "bye",
  "hola",
  "buenos días",
  "cómo estás",
  "gracias",
  "vale",
  "adiós",
]);

export function isSmallTalk(text: string): boolean {
  // ponytail: exact MVP-language set; extend only when corpus evidence demands it.
  return smallTalk.has(
    text
      .trim()
      .toLocaleLowerCase()
      .replace(/[.!?,…]+$/u, "")
      .trim(),
  );
}

export function eligibility(
  event: PiInputLike,
  config?: Pick<BridgeConfigV1, "enabled" | "mode">,
): { eligible: boolean; reason?: BypassReason } {
  if (event.images?.length && !event.text.trim())
    return { eligible: false, reason: "image_only" };
  if (!event.text.trim()) return { eligible: false, reason: "empty" };
  if (!event.images?.length && isSmallTalk(event.text))
    return { eligible: false, reason: "small_talk" };
  if (event.text.startsWith("/")) return { eligible: false, reason: "command" };
  if (event.text.startsWith("!")) return { eligible: false, reason: "shell" };
  if (event.source === "extension")
    return { eligible: false, reason: "extension" };
  if (event.source !== "interactive" && event.source !== "rpc")
    return { eligible: false, reason: "unsupported" };
  if (!config?.enabled) return { eligible: false, reason: "disabled" };
  if (config.mode === "off") return { eligible: false, reason: "mode" };
  return { eligible: true };
}

export function messageType(
  event: Pick<PiInputLike, "streamingBehavior">,
  hasPriorUserMessage: () => boolean,
): BridgeMessageType {
  if (event.streamingBehavior === "steer") return "steer";
  if (event.streamingBehavior === "followUp") return "follow_up";
  try {
    return hasPriorUserMessage() ? "normal" : "initial";
  } catch {
    return "normal";
  }
}
