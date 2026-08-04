import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";
import { PageErrorBoundary } from "./PageErrorBoundary";

function FailingPanel(): ReactElement {
  throw new Error("stored panel data is invalid");
}

describe("PageErrorBoundary", () => {
  it("replaces a broken page with recovery actions instead of a blank application", () => {
    const onReturnToCreate = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <PageErrorBoundary onReturnToCreate={onReturnToCreate} resetKey="articles">
        <FailingPanel />
      </PageErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("这个页面暂时无法打开");
    fireEvent.click(screen.getByRole("button", { name: "返回创作" }));
    expect(onReturnToCreate).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });
});
