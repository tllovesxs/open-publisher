import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { availableSkills, defaultAgents } from "../data/contentStudio";
import { AgentsPage } from "./AgentsPage";

describe("AgentsPage Skill library", () => {
  it("adds a declarative Skill and assigns it to the selected agent", () => {
    const onChange = vi.fn();
    const onSkillsChange = vi.fn();
    render(
      <AgentsPage
        agents={defaultAgents}
        onChange={onChange}
        onSkillsChange={onSkillsChange}
        skills={availableSkills}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "新建 Skill" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "术语统一" } });
    fireEvent.change(screen.getByLabelText("用途说明"), { target: { value: "统一产品术语" } });
    fireEvent.change(screen.getByLabelText("工作指令"), { target: { value: "保持术语与产品词表一致。" } });
    fireEvent.click(screen.getByRole("button", { name: "添加并分配" }));

    expect(onSkillsChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: "术语统一", isBuiltIn: false })]),
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: "research", skillIds: expect.arrayContaining([expect.stringMatching(/^skill-/)]) }),
      ]),
    );
  });

  it("rejects imported files without a safe declarative Skill manifest", async () => {
    render(
      <AgentsPage
        agents={defaultAgents}
        onChange={vi.fn()}
        onSkillsChange={vi.fn()}
        skills={availableSkills}
      />,
    );
    const input = screen.getByLabelText("导入 skill.json");
    const file = new File([JSON.stringify({ name: "unsafe" })], "skill.json", { type: "application/json" });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("缺少 runtime");
  });

  it("imports a declarative skill manifest but rejects executable entrypoints", async () => {
    const onSkillsChange = vi.fn();
    render(
      <AgentsPage
        agents={defaultAgents}
        onChange={vi.fn()}
        onSkillsChange={onSkillsChange}
        skills={availableSkills}
      />,
    );
    const input = screen.getByLabelText("导入 skill.json");
    const safe = new File([JSON.stringify({
      name: "术语约束",
      description: "统一产品名词。",
      runtime: { kind: "declarative", apiVersion: "1.0" },
      permissions: { platformWrites: false },
      declaration: {
        objective: "统一术语。",
        instructions: ["使用产品词表。"],
        guardrails: ["不要编造术语。"],
      },
    })], "skill.json", { type: "application/json" });
    fireEvent.change(input, { target: { files: [safe] } });
    await waitFor(() => expect(onSkillsChange).toHaveBeenCalled());
    expect(onSkillsChange).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ name: "术语约束", instructions: expect.stringContaining("统一术语") }),
    ]));

    const executable = new File([JSON.stringify({
      name: "不安全 Skill",
      description: "不应导入。",
      runtime: { kind: "python", apiVersion: "1.0", entrypoint: "run.py" },
      declaration: {
        objective: "不执行。",
        instructions: ["无"],
        guardrails: ["无"],
      },
    })], "unsafe.json", { type: "application/json" });
    fireEvent.change(input, { target: { files: [executable] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("不能导入可执行代码");
  });
});
