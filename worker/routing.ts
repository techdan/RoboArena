/** URL routing for the Cloudflare room Worker. Pure so it runs under Vitest too. */

import { CODE_ALPHABET } from "../server/rooms.js";

const ROOM_CODE = new RegExp(`^[${CODE_ALPHABET}]{6}$`);

export type RoomRoute =
  | { readonly kind: "room"; readonly code: string }
  | { readonly kind: "new"; readonly requestId: string };

/**
 * `/rooms/<CODE>` reaches an existing room; `/rooms/new/<requestId>` reaches
 * the room a CreateRoom with that request id will own.
 */
export const parseRoomRoute = (pathname: string): RoomRoute | undefined => {
  const parts = pathname.split("/").filter((part) => part.length > 0);
  if (parts[0] !== "rooms") return undefined;
  if (parts.length === 2 && ROOM_CODE.test(parts[1]!)) return { kind: "room", code: parts[1]! };
  if (parts.length === 3 && parts[1] === "new") {
    const requestId = decodeURIComponent(parts[2]!);
    if (requestId.length > 0 && requestId.length <= 64) return { kind: "new", requestId };
  }
  return undefined;
};

/**
 * Every Durable Object owns one code, so a new room's code is chosen before
 * its first message arrives. Deriving it from the request id means a retried
 * CreateRoom reaches the same object and gets its cached answer instead of a
 * second room. 32 symbols divide 256 evenly, so the mapping is unbiased.
 */
export const roomCodeForRequest = async (requestId: string): Promise<string> => {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`roboarena-room:${requestId}`)),
  );
  return [...digest.slice(0, 6)].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
};
