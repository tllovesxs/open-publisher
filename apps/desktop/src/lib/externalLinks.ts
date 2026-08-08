import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

function normalizeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export async function openExternalUrl(value: string): Promise<boolean> {
  const url = normalizeExternalUrl(value);
  if (!url) return false;

  try {
    if (isTauri()) {
      await openUrl(url);
    } else {
      if (typeof window === "undefined") return false;
      window.open(url, "_blank", "noopener,noreferrer");
    }
    return true;
  } catch {
    return false;
  }
}

export function externalLinkClickHandler(value: string) {
  return (event: { preventDefault: () => void }): boolean => {
    const url = normalizeExternalUrl(value);
    if (!url) return false;
    event.preventDefault();
    void openExternalUrl(url);
    return true;
  };
}
