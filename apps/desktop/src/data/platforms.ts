import type { PlatformDefinition, PlatformId } from "../types";

type CatalogEntry = Omit<PlatformDefinition, "status" | "accountLabel">;

// IDs, names and brand assets mirror the installed WechatSync adapter catalog.
// They are only used for presentation; login state always comes from its local bridge.
const catalog: CatalogEntry[] = [
  { id: "weixin", name: "微信公众号", shortName: "公众号", limit: "图文长文", iconUrl: "https://mp.weixin.qq.com/favicon.ico", homepage: "https://mp.weixin.qq.com" },
  { id: "zhihu", name: "知乎", shortName: "知乎", limit: "专栏文章", iconUrl: "https://static.zhihu.com/static/favicon.ico", homepage: "https://www.zhihu.com" },
  { id: "juejin", name: "掘金", shortName: "掘金", limit: "技术文章", iconUrl: "https://lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/static/favicons/favicon-32x32.png", homepage: "https://juejin.cn" },
  { id: "bilibili", name: "哔哩哔哩", shortName: "B站", limit: "专栏", iconUrl: "https://www.bilibili.com/favicon.ico", homepage: "https://member.bilibili.com/platform/upload/text" },
  { id: "csdn", name: "CSDN", shortName: "CSDN", limit: "Markdown 技术长文", iconUrl: "https://g.csdnimg.cn/static/logo/favicon32.ico", homepage: "https://editor.csdn.net/md/" },
  { id: "toutiao", name: "今日头条", shortName: "头条", limit: "图文", iconUrl: "https://sf1-ttcdn-tos.pstatp.com/obj/ttfe/pgcfe/sz/mp_logo.png", homepage: "https://mp.toutiao.com/profile_v4/graphic/publish" },
  { id: "xiaohongshu", name: "小红书", shortName: "小红书", limit: "图文笔记", homepage: "https://creator.xiaohongshu.com" },
  { id: "douyin", name: "抖音图文", shortName: "抖音", limit: "图文", iconUrl: "https://lf1-cdn-tos.bytegoofy.com/goofy/ies/douyin_web/public/favicon.ico", homepage: "https://creator.douyin.com" },
  { id: "weibo", name: "微博", shortName: "微博", limit: "文章", iconUrl: "https://weibo.com/favicon.ico", homepage: "https://card.weibo.com/article/v5/editor" },
  { id: "x", name: "X (Twitter)", shortName: "X", limit: "长文", iconUrl: "https://abs.twimg.com/favicons/twitter.3.ico", homepage: "https://x.com/compose/articles" },
  { id: "yuque", name: "语雀", shortName: "语雀", limit: "知识库文档", iconUrl: "https://gw.alipayobjects.com/zos/rmsportal/UTjFYEzMSYVwzxIGVhMu.png", homepage: "https://www.yuque.com/dashboard" },
  { id: "oschina", name: "开源中国", shortName: "OSCHINA", limit: "博客", iconUrl: "https://www.oschina.net/favicon.ico", homepage: "https://my.oschina.net" },
  { id: "cnblogs", name: "博客园", shortName: "博客园", limit: "博客", iconUrl: "https://www.cnblogs.com/favicon.ico", homepage: "https://www.cnblogs.com" },
  { id: "segmentfault", name: "思否", shortName: "思否", limit: "文章", iconUrl: "https://imgcache.iyiou.com/Company/2016-05-11/cf-segmentfault.jpg", homepage: "https://segmentfault.com/user/draft" },
  { id: "51cto", name: "51CTO", shortName: "51CTO", limit: "技术博客", iconUrl: "https://blog.51cto.com/favicon.ico", homepage: "https://blog.51cto.com/blogger/publish" },
  { id: "baijiahao", name: "百家号", shortName: "百家", limit: "图文", iconUrl: "https://www.baidu.com/favicon.ico", homepage: "https://baijiahao.baidu.com/" },
  { id: "dayu", name: "大鱼号", shortName: "大鱼", limit: "图文", iconUrl: "https://image.uc.cn/s/uae/g/1v/images/index/favicon.ico", homepage: "https://mp.dayu.com/dashboard/account/profile" },
  { id: "douban", name: "豆瓣", shortName: "豆瓣", limit: "日记", iconUrl: "https://www.douban.com/favicon.ico", homepage: "https://www.douban.com/note/create" },
  { id: "eastmoney", name: "东方财富", shortName: "东财", limit: "文章", iconUrl: "https://mp.eastmoney.com/collect/pc_article/favicon.ico", homepage: "https://mp.eastmoney.com" },
  { id: "imooc", name: "慕课手记", shortName: "慕课", limit: "技术文章", iconUrl: "https://www.imooc.com/favicon.ico", homepage: "https://www.imooc.com/article" },
  { id: "jianshu", name: "简书", shortName: "简书", limit: "文章", iconUrl: "https://www.jianshu.com/favicon.ico", homepage: "https://www.jianshu.com" },
  { id: "netease", name: "网易号", shortName: "网易", limit: "图文", iconUrl: "https://static.ws.126.net/163/f2e/news/yxybd_pc/resource/static/share-icon.png", homepage: "https://mp.163.com/#/article-publish" },
  { id: "smzdm", name: "什么值得买", shortName: "值买", limit: "投稿", iconUrl: "https://www.smzdm.com/favicon.ico", homepage: "https://post.smzdm.com/tougao/" },
  { id: "sohu", name: "搜狐号", shortName: "搜狐", limit: "图文", iconUrl: "https://mp.sohu.com/favicon.ico", homepage: "https://mp.sohu.com/mpfe/v3/main/first/page?newsType=1" },
  { id: "sohufocus", name: "搜狐焦点", shortName: "焦点", limit: "图文", iconUrl: "https://mp.focus.cn/favicon.ico", homepage: "https://mp.focus.cn/fe/index.html#/info/draft" },
  { id: "woshipm", name: "人人都是产品经理", shortName: "产品经理", limit: "文章", iconUrl: "https://www.woshipm.com/favicon.ico", homepage: "https://www.woshipm.com" },
  { id: "xueqiu", name: "雪球", shortName: "雪球", limit: "长文", iconUrl: "https://xqdoc.imedao.com/17aebcfb84a145d33fc18679.ico", homepage: "https://mp.xueqiu.com/writeV2" },
  { id: "yidian", name: "一点号", shortName: "一点", limit: "图文", iconUrl: "https://www.yidianzixun.com/favicon.ico", homepage: "https://mp.yidianzixun.com" },
  { id: "zip-download", name: "Markdown 下载", shortName: "下载", limit: "本地导出", iconUrl: "https://cdn-icons-png.flaticon.com/512/337/337946.png" },
];

export const platforms: PlatformDefinition[] = catalog.map((platform) => ({
  ...platform,
  status: "not_connected",
}));

export function platformDefinitionFor(id: PlatformId): PlatformDefinition {
  const known = catalog.find((platform) => platform.id === id);
  return known
    ? { ...known, status: "not_connected" }
    : {
        id,
        name: id,
        shortName: id.slice(0, 5),
        limit: "由浏览器插件适配",
        status: "not_connected",
      };
}
