(() => {
  "use strict";

  // DOM selectors are intentionally isolated here. A platform change should only affect its adapter.
  const ADAPTERS = {
    csdn: {
      domVersion: "csdn-editor-v2",
      titleSelectors: ["#txtTitle", "input[placeholder*='文章标题']"],
      bodySelectors: [
        ".CodeMirror textarea",
        "textarea.markdown_editor",
        ".monaco-editor textarea.inputarea",
        "textarea[placeholder*='Markdown']",
      ],
      titleMode: "required",
    },
    wechat: {
      domVersion: "wechat-editor-v2",
      titleSelectors: ["#title", "textarea[name='title']", "textarea[placeholder*='标题']"],
      bodySelectors: [
        ".edui-body-container[contenteditable='true']",
        "#js_editor[contenteditable='true']",
        "[contenteditable='true'][data-placeholder*='正文']",
      ],
      titleMode: "required",
    },
    zhihu: {
      domVersion: "zhihu-write-v1",
      titleSelectors: [
        "textarea[placeholder*='标题']",
        "input[placeholder*='标题']",
        "textarea[aria-label*='标题']",
      ],
      bodySelectors: [
        "[data-contents='true'][contenteditable='true']",
        ".DraftEditor-root [contenteditable='true']",
        "div[contenteditable='true'][role='textbox']",
      ],
      titleMode: "required",
    },
    xiaohongshu: {
      domVersion: "xiaohongshu-note-v1",
      titleSelectors: [
        "input[placeholder*='标题']",
        "textarea[placeholder*='标题']",
        "input[aria-label*='标题']",
      ],
      bodySelectors: [
        "textarea[placeholder*='描述']",
        "textarea[placeholder*='正文']",
        "[contenteditable='true'][data-placeholder*='描述']",
        "div[contenteditable='true'][role='textbox']",
      ],
      // Some note composers only have a single caption field. Preserve the title in that case.
      titleMode: "prepend-if-missing",
    },
  };

  function platformForLocation() {
    if (location.protocol !== "https:") return null;
    if (location.hostname === "editor.csdn.net" && /^\/md(?:\/|$)/.test(location.pathname)) {
      return "csdn";
    }
    if (location.hostname === "mp.weixin.qq.com" && location.pathname === "/cgi-bin/appmsg") {
      return "wechat";
    }
    if (
      location.hostname === "zhuanlan.zhihu.com" &&
      /^\/write(?:\/|$)/.test(location.pathname)
    ) {
      return "zhihu";
    }
    if (
      location.hostname === "creator.xiaohongshu.com" &&
      /^\/publish(?:\/|$)/.test(location.pathname)
    ) {
      return "xiaohongshu";
    }
    return null;
  }

  function firstEditable(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        (element instanceof HTMLElement && element.isContentEditable)
      ) {
        return { element, selector };
      }
    }
    return null;
  }

  function dispatchTextEvents(element, value) {
    try {
      element.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          data: value,
          inputType: "insertText",
        }),
      );
    } catch {
      // Older Chromium builds still receive the following input/change events.
    }
    try {
      element.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: value,
          inputType: "insertText",
        }),
      );
    } catch {
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function overwriteContentEditable(element, value) {
    element.focus();
    const selection = window.getSelection();
    if (selection !== null) {
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    // Browser insertion triggers most React, Slate, and ProseMirror input paths without HTML injection.
    const inserted = document.execCommand("insertText", false, value);
    if (!inserted) {
      element.textContent = value;
    }
    dispatchTextEvents(element, value);
    return element.textContent === value || element.innerText === value;
  }

  function setNativeValue(element, value) {
    if (element instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(element, value);
    } else if (element instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(element, value);
    } else if (element instanceof HTMLElement && element.isContentEditable) {
      return overwriteContentEditable(element, value);
    } else {
      return false;
    }

    element.focus();
    dispatchTextEvents(element, value);
    return element.value === value;
  }

  function fillDraft(task) {
    const platform = platformForLocation();
    if (platform === null || platform !== task.platform) {
      return { ok: false, status: "NEEDS_USER", reason: "PLATFORM_MISMATCH" };
    }

    const adapter = ADAPTERS[platform];
    if (
      typeof task.expectedDomVersion === "string" &&
      task.expectedDomVersion !== adapter.domVersion
    ) {
      return {
        ok: false,
        status: "NEEDS_USER",
        reason: "DOM_VERSION_UNSUPPORTED",
        diagnostics: { expected: task.expectedDomVersion, observed: adapter.domVersion },
      };
    }

    const titleTarget = firstEditable(adapter.titleSelectors);
    const bodyTarget = firstEditable(adapter.bodySelectors);
    const missing = [];
    if (titleTarget === null && adapter.titleMode === "required") missing.push("title");
    if (bodyTarget === null) missing.push("body");
    if (missing.length > 0) {
      return {
        ok: false,
        status: "NEEDS_USER",
        reason: "DOM_VERSION_UNSUPPORTED",
        diagnostics: { domVersion: adapter.domVersion, missing },
      };
    }

    const bodyContent =
      titleTarget === null && adapter.titleMode === "prepend-if-missing"
        ? `${task.article.title}\n\n${task.article.body.content}`
        : task.article.body.content;
    const titleFilled = titleTarget === null || setNativeValue(titleTarget.element, task.article.title);
    const bodyFilled = setNativeValue(bodyTarget.element, bodyContent);
    if (!titleFilled || !bodyFilled) {
      return {
        ok: false,
        status: "NEEDS_USER",
        reason: "EDITOR_REJECTED_INPUT",
        diagnostics: { titleFilled, bodyFilled },
      };
    }

    // Saving and final publication stay entirely under the user's control.
    return {
      ok: true,
      status: "DRAFT_FILLED",
      taskId: task.taskId,
      platform,
      domVersion: adapter.domVersion,
      requiresUserReview: true,
      filledFields: titleTarget === null ? ["body"] : ["title", "body"],
    };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const taskExpiresAt = Date.parse(message?.task?.expiresAt ?? "");
    if (
      sender.id !== chrome.runtime.id ||
      message?.type !== "OPEN_PUBLISHER_FILL_DRAFT" ||
      message.task?.action !== "FILL_DRAFT" ||
      !Number.isFinite(taskExpiresAt) ||
      taskExpiresAt <= Date.now() ||
      message.task?.safety?.finalPublish !== false ||
      message.task?.safety?.requiresUserReview !== true
    ) {
      sendResponse({ ok: false, status: "NEEDS_USER", reason: "UNSAFE_OR_INVALID_TASK" });
      return false;
    }

    try {
      sendResponse(fillDraft(message.task));
    } catch (error) {
      sendResponse({
        ok: false,
        status: "NEEDS_USER",
        reason: "DOM_ADAPTER_FAILED",
        diagnostics: String(error),
      });
    }
    return false;
  });
})();
