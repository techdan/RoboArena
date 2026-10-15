/** Per-browser Boot Camp prompt memory and safe return-path handling. */

export const BOOT_CAMP_STORAGE_KEY = "roboarena:help:boot-camp:v1";
export type BootCampPromptState = "dismissed" | "completed";

const storage = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

/** True when the first-visit prompt should be shown (unknown storage shows it). */
export const shouldShowBootCampPrompt = (): boolean => {
  try {
    const value = storage()?.getItem(BOOT_CAMP_STORAGE_KEY);
    return value !== "dismissed" && value !== "completed";
  } catch {
    return true;
  }
};

export const rememberBootCamp = (state: BootCampPromptState): void => {
  try {
    storage()?.setItem(BOOT_CAMP_STORAGE_KEY, state);
  } catch {
    /* In-memory dismissal still works for this page view. */
  }
};

/**
 * Accept only same-origin absolute paths so `/boot-camp?next=` cannot be used
 * as an open redirect. Anything else returns home.
 */
export const safeReturnPath = (value: unknown): string => {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (value.length > 200 || [...value].some((char) => char.charCodeAt(0) < 0x20)) return "/";
  if (value.startsWith("/boot-camp")) return "/";
  return value;
};

export const bootCampHref = (returnTo?: string): string => {
  const safe = returnTo === undefined ? "/" : safeReturnPath(returnTo);
  return safe === "/" ? "/boot-camp" : `/boot-camp?next=${encodeURIComponent(safe)}`;
};
