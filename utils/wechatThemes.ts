import { WechatThemeId, WechatAccent, WechatLayoutComponent } from "../types";

export const WECHAT_TEMPLATE: Record<string, string> = {
  section: "font-family: sans-serif;font-size:16px;line-height:1.8;color:#292d32;overflow-wrap:break-word;",
  p: "margin:0 0 20px;font-size:16px;line-height:1.8;",
  h1: "margin:32px 0 18px;font-size:24px;line-height:1.5;font-weight:bold;color:#184f42;",
  h2: "margin:28px 0 16px;padding-left:12px;border-left:3px solid #28735c;font-size:21px;line-height:1.5;font-weight:bold;",
  h3: "margin:24px 0 14px;font-size:18px;line-height:1.6;font-weight:bold;",
  h4: "margin:20px 0 12px;font-size:17px;line-height:1.6;font-weight:bold;",
  h5: "margin:20px 0 12px;font-size:16px;line-height:1.6;font-weight:bold;",
  h6: "margin:20px 0 12px;font-size:16px;line-height:1.6;font-weight:bold;",
  blockquote: "margin:22px 0;padding:12px 16px;border-left:3px solid #9ab8aa;background:#f3f6f4;color:#53635b;",
  ul: "margin:0 0 20px;padding-left:26px;", ol: "margin:0 0 20px;padding-left:26px;",
  li: "margin:6px 0;font-size:16px;line-height:1.8;",
  pre: "margin:20px 0;padding:16px;background:#f4f5f6;border:1px solid #e5e7eb;border-radius:4px;font-size:13px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;",
  code: "font-family:monospace;background:#f4f5f6;font-size:0.9em;white-space:pre-wrap;",
  table: "width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;table-layout:fixed;",
  th: "border:1px solid #d9dfdc;padding:8px;background:#f3f6f4;text-align:left;overflow-wrap:anywhere;",
  td: "border:1px solid #d9dfdc;padding:8px;text-align:left;overflow-wrap:anywhere;",
  img: "display:block;max-width:100%;height:auto;margin:22px auto;",
  a: "color:#28735c;text-decoration:underline;", strong: "font-weight:bold;", em: "font-style:italic;",
  del: "text-decoration:line-through;", hr: "border:0;border-top:1px solid #d9dfdc;margin:28px 0;",
};

export const WECHAT_THEMES: Record<WechatThemeId, string> = {
  default: '经典默认', essay: '人文阅读', research: '科技知识', event: '活动宣传', minimal: '简约通用',
};
export const WECHAT_ACCENTS: Record<WechatAccent, string> = {teal: '#28735c', blue: '#285c91', amber: '#8b642e', rose: '#a34460'};
export const COMPONENT_LABELS: Record<WechatLayoutComponent, string> = {plain: '正文', intro: '导语', 'highlight-card': '重点卡片', quote: '引文', conclusion: '总结'};
export function themeStyles(theme: WechatThemeId, accent: WechatAccent): Record<string, string> {
  const color = WECHAT_ACCENTS[accent];
  const styles = {...WECHAT_TEMPLATE};
  if (theme === 'default') {
    if (accent !== 'teal') {
      styles.h1 = styles.h1.replace(/color:[^;]+;/, `color:${color};`);
      styles.h2 = styles.h2.replace(/border-left:3px solid [^;]+;/, `border-left:3px solid ${color};`);
      styles.a = `color:${color};text-decoration:underline;`;
    }
    return styles;
  }
  styles.section = `font-family:sans-serif;font-size:16px;line-height:1.85;color:#292d32;overflow-wrap:break-word;`;
  styles.h1 = `margin:32px 0 20px;font-size:25px;line-height:1.5;font-weight:bold;color:${color};`;
  styles.h2 = `margin:30px 0 18px;padding-bottom:8px;border-bottom:1px solid ${color};font-size:21px;line-height:1.5;font-weight:bold;color:${color};`;
  styles.a = `color:${color};text-decoration:underline;`;
  styles.blockquote = `margin:24px 0;padding:12px 16px;border-left:3px solid ${color};background:#f5f6f7;color:#53635b;`;
  if (theme === 'essay') {
    styles.section += 'font-family:serif;';
    styles.p = 'margin:0 0 24px;font-size:17px;line-height:2;';
    styles.h2 = `margin:36px 0 22px;font-size:21px;line-height:1.6;font-weight:bold;color:${color};`;
  } else if (theme === 'event') {
    styles.h2 = `margin:28px 0 16px;padding:10px 14px;background:${color};color:#fff;font-size:21px;line-height:1.5;font-weight:bold;`;
    styles.p = 'margin:0 0 18px;font-size:16px;line-height:1.8;';
  } else if (theme === 'minimal') {
    styles.h1 = 'margin:30px 0 20px;font-size:24px;line-height:1.5;font-weight:bold;color:#222;';
    styles.h2 = 'margin:28px 0 16px;font-size:20px;line-height:1.6;font-weight:bold;color:#222;';
    styles.blockquote = 'margin:22px 0;padding-left:16px;border-left:2px solid #aaa;color:#666;';
  }
  return styles;
}
export function componentStyle(component: WechatLayoutComponent, accent: WechatAccent): string {
  const color = WECHAT_ACCENTS[accent];
  return {
    plain: '',
    intro: `margin:20px 0 26px;padding:16px;border-left:3px solid ${color};background:#f4f6f7;font-size:18px;line-height:1.9;`,
    'highlight-card': `margin:22px 0;padding:16px;border:1px solid ${color};border-radius:4px;background:#f7f8f9;`,
    quote: `margin:24px 0;padding:12px 18px;border-left:3px solid ${color};color:#53635b;`,
    conclusion: `margin:28px 0 20px;padding-top:16px;border-top:2px solid ${color};font-weight:bold;`,
  }[component];
}
