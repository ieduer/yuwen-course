const BILIBILI_REMOVED_KEY = "www.bilibili.com/video/bv1zg4y1h7fk";

export const REMOVED_WEB_RESOURCE_HOSTS = Object.freeze([
  "xue.bdfz.net",
]);

const REMOVED_WEB_RESOURCE_HOST_SET = new Set(REMOVED_WEB_RESOURCE_HOSTS);

export function webResourceKey(raw) {
  try {
    const url = raw instanceof URL
      ? new URL(raw.toString())
      : new URL(String(raw || "").replaceAll("&amp;", "&"));
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    const hostname = url.hostname.toLowerCase();
    const port = url.port ? `:${url.port}` : "";
    let pathname = url.pathname || "/";
    if (pathname !== "/") pathname = pathname.replace(/\/+$/, "");
    pathname = pathname.replace(/%[0-9a-f]{2}/gi, (escape) => escape.toUpperCase());
    const search = url.search.replace(/%[0-9a-f]{2}/gi, (escape) => escape.toUpperCase());
    if (
      hostname === "www.bilibili.com"
      && pathname.toLowerCase() === "/video/bv1zg4y1h7fk"
    ) return BILIBILI_REMOVED_KEY;
    return `${hostname}${port}${pathname}${search}`;
  } catch {
    return "";
  }
}

export const REMOVED_WEB_RESOURCE_URLS = Object.freeze([
  "https://www.bilibili.com/video/BV1Zg4y1H7fK/",
  "https://baike.baidu.com/item/%E6%9C%89%E6%84%9F",
  "https://aistudio.google.com/app/prompts",
  "https://aistudio.google.com/app/prompts/new_chat",
  "https://chat.deepseek.com/",
  "https://claude.ai/",
  "https://forum.rdfzer.com/c/general/4",
  "https://grok.com/",
  "https://labs.google/fx/tools/flow/unsupported-country",
  "https://mf.bdfzer.com/",
  "https://pkuschool.yuque.com/search?q=%E6%AF%94%E5%85%B4&type=content&scope=qrvbic&tab=group&p=1&sence=modal",
  "https://sites.google.com/view/pkuschool/cover3/xbs1/xbs4",
  "https://sites.google.com/view/pkuschool/cover3/xbs1/xbs6/xbs7",
  "https://www.digital.archives.go.jp/DAS/meta/listPhoto?LANG=eng&BID=F1000000000000107520&ID=&TYPE=dljpeg",
  "https://www.scdfz.org.cn/ztzl/hjczzsc/zzhy/content_30068",
  "https://z-library.sk/book/30273234/d175b9/%E5%A4%A7%E5%94%90%E7%AC%AC%E4%B8%80%E5%8F%A4%E6%83%91%E4%BB%94%E6%9D%8E%E7%99%BD%E5%AE%9E%E5%BD%95.html?ts=0729",
  "https://z-library.sk/book/41748134/f80433/%E9%97%BB%E4%B8%80%E5%A4%9A%E5%85%A8%E9%9B%86-6-%E5%94%90%E8%AF%97%E7%BC%96-%E4%B8%8A.html?ts=0929",
  "https://zh.m.wikipedia.org/w/index.php?title=%E9%B2%81%E8%BF%85%E4%BC%A0&action=edit&redlink=1",
  "https://zh.wikisource.org/w/index.php?title=%E5%A4%AA%E7%99%BD&action=edit&redlink=1",
]);

export const REMOVED_WEB_RESOURCE_KEYS = Object.freeze(
  REMOVED_WEB_RESOURCE_URLS.map(webResourceKey),
);

const REMOVED_WEB_RESOURCE_KEY_SET = new Set(REMOVED_WEB_RESOURCE_KEYS);

export function isRemovedWebResource(raw) {
  try {
    const url = raw instanceof URL ? raw : new URL(String(raw || "").replaceAll("&amp;", "&"));
    if (REMOVED_WEB_RESOURCE_HOST_SET.has(url.hostname.toLowerCase())) return true;
  } catch {
    return false;
  }
  const key = webResourceKey(raw);
  return Boolean(key && REMOVED_WEB_RESOURCE_KEY_SET.has(key));
}
