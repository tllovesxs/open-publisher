(() => {
  "use strict";

  const ADAPTERS = {
    csdn: {
      domVersion: "csdn-editor-v1",
      titleSelectors: ["#txtTitle", "input[placeholder='请输入文章标题']"],
      bodySelectors: [
        ".CodeMirror textarea",
        "textarea.markdown_editor",
        ".monaco-editor textarea.inputarea",
      ],
    },
    toutiao: {
      domVersion: "toutiao-editor-v1",
      titleSelectors: [
        "textarea[placeholder='请输入文章标题（2～30个字）']",
        "textarea[placeholder*='文章标题']",
      ],
      bodySelectors: [
        ".ProseMirror[contenteditable='true']",
        "div[data-contents='true'][contenteditable='true']",
      ],
    },
    wechat: {
      domVersion: "wechat-editor-v1",
      titleSelectors: ["#title", "textarea[name='title']", "textarea[placeholder*='标题']"],
      bodySelectors: [
        ".edui-body-container[contenteditable='true']",
        "#js_editor[contenteditable='true']",
      ],
    },
  };

  function platformForLocation() {
    if (location.protocol !== "https:") return null;
    if (location.hostname === "editor.csdn.net") return "csdn";
    if (location.hostname === "mp.toutiao.com") return "toutiao";
    if (location.hostname === "mp.weixin.qq.com") return "wechat";
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

  function setNativeValue(element, value) {
    if (element instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(element, value);
    } else if (element instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(element, value);
    } else if (element instanceof HTMLElement && element.isContentEditable) {
      // Deliberately use textContent. Untrusted HTML is never injected into the platform page.
      element.textContent = value;
    } else {
      return false;
    }

    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
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
        diagnostics: {
          expected: task.expectedDomVersion,
          observed: adapter.domVersion,
        },
      };
    }

    const titleTarget = firstEditable(adapter.titleSelectors);
    const bodyTarget = firstEditable(adapter.bodySelectors);
    const missing = [];
    if (titleTarget === null) missing.push("title");
    if (bodyTarget === null) missing.push("body");
    if (missing.length > 0) {
      return {
        ok: false,
        status: "NEEDS_USER",
        reason: "DOM_VERSION_UNSUPPORTED",
        diagnostics: {
          domVersion: adapter.domVersion,
          missing,
        },
      };
    }

    const titleFilled = setNativeValue(titleTarget.element, task.article.title);
    const bodyFilled = setNativeValue(bodyTarget.element, task.article.body.content);
    if (!titleFilled || !bodyFilled) {
      return {
        ok: false,
        status: "NEEDS_USER",
        reason: "EDITOR_REJECTED_INPUT",
        diagnostics: {
          titleFilled,
          bodyFilled,
        },
      };
    }

    // No publish or save button is queried or clicked. The user reviews and saves the draft.
    return {
      ok: true,
      status: "DRAFT_FILLED",
      taskId: task.taskId,
      platform,
      domVersion: adapter.domVersion,
      requiresUserReview: true,
      filledFields: ["title", "body"],
    };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (
      sender.id !== chrome.runtime.id ||
      message?.type !== "OPEN_PUBLISHER_FILL_DRAFT" ||
      message.task?.action !== "FILL_DRAFT" ||
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
