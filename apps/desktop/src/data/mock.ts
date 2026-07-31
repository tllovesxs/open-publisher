import type { PlatformDefinition } from "../types";

export const platforms: PlatformDefinition[] = [
  {
    id: "wechat",
    name: "微信公众号",
    shortName: "公众号",
    limit: "长文 · 图文混排",
    status: "not_connected",
  },
  {
    id: "csdn",
    name: "CSDN",
    shortName: "CSDN",
    limit: "技术长文 · Markdown",
    status: "not_connected",
  },
  {
    id: "toutiao",
    name: "今日头条",
    shortName: "头条",
    limit: "信息流 · 强开场",
    status: "not_connected",
  },
];
