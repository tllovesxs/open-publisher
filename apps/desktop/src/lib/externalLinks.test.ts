import { afterEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { externalLinkClickHandler, openExternalUrl } from "./externalLinks";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const isTauriMock = vi.mocked(isTauri);
const openUrlMock = vi.mocked(openUrl);

describe("external links", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    isTauriMock.mockReset();
    openUrlMock.mockReset();
  });

  it("opens HTTP(S) links with the Tauri system opener", async () => {
    isTauriMock.mockReturnValue(true);
    openUrlMock.mockResolvedValue();

    await expect(openExternalUrl("https://example.test/docs")).resolves.toBe(true);

    expect(openUrlMock).toHaveBeenCalledWith("https://example.test/docs");
  });

  it("uses a controlled browser fallback outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const windowOpen = vi.spyOn(window, "open").mockReturnValue(null);

    await expect(openExternalUrl("http://example.test/help")).resolves.toBe(true);

    expect(windowOpen).toHaveBeenCalledWith(
      "http://example.test/help",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("rejects non-HTTP protocols", async () => {
    isTauriMock.mockReturnValue(true);
    const windowOpen = vi.spyOn(window, "open").mockReturnValue(null);

    await expect(openExternalUrl("javascript:alert(1)")).resolves.toBe(false);
    await expect(openExternalUrl("file:///C:/private.txt")).resolves.toBe(false);

    expect(openUrlMock).not.toHaveBeenCalled();
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it("prevents WebView navigation only for accepted external links", async () => {
    isTauriMock.mockReturnValue(true);
    openUrlMock.mockResolvedValue();
    const externalEvent = { preventDefault: vi.fn() };
    const internalEvent = { preventDefault: vi.fn() };

    expect(externalLinkClickHandler("https://example.test")(externalEvent)).toBe(true);
    expect(externalLinkClickHandler("#section")(internalEvent)).toBe(false);
    await vi.waitFor(() => expect(openUrlMock).toHaveBeenCalledWith("https://example.test/"));

    expect(externalEvent.preventDefault).toHaveBeenCalledOnce();
    expect(internalEvent.preventDefault).not.toHaveBeenCalled();
  });
});
