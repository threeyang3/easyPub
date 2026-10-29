export function validateWechatArticleUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\\x00-\x1f\x7f]/.test(value)) throw new Error('请输入 HTTPS 微信公众号公开文章 URL');
  if (!/^https:\/\/mp\.weixin\.qq\.com\//.test(value)) throw new Error('仅支持 mp.weixin.qq.com 的 HTTPS 文章链接');
  if (!/^https:\/\/mp\.weixin\.qq\.com\/s(?:\/[A-Za-z0-9_-]+)?(?:\?[^#]*)?(?:#(?:rd|wechat_redirect))?$/.test(value)) throw new Error('公众号文章路径无效');
  const url = new URL(value);
  if (url.hostname !== 'mp.weixin.qq.com' || url.username || url.password || url.port) throw new Error('公众号文章 URL 格式无效');
  if (!/^\/s\/[A-Za-z0-9_-]+$/.test(url.pathname) && !(url.pathname === '/s' && ['__biz','mid','idx','sn'].every(key => url.searchParams.getAll(key).length === 1 && Boolean(url.searchParams.get(key))))) throw new Error('仅支持 /s/文章标识 或含 __biz、mid、idx、sn 的 /s 链接');
  if (url.href.length > 2048) throw new Error('公众号文章 URL 编码后过长');
  return url.href;
}
