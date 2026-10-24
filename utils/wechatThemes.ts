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
  editorial: '杂志编排', paper: '温柔奶油', noir: '深夜电台', bloom: '轻盈花园', cobalt: '蓝调手记', cinnabar: '朱砂书卷', mono: '黑白档案',
};
export const WECHAT_ACCENTS: Record<WechatAccent, string> = {preset: '', teal: '#28735c', blue: '#285c91', amber: '#8b642e', rose: '#a34460'};
export const COMPONENT_LABELS: Record<WechatLayoutComponent, string> = {plain: '正文', intro: '导语', 'highlight-card': '重点卡片', quote: '引文', conclusion: '总结'};
const SERIF = '"Songti SC","STSong","Noto Serif CJK SC",Georgia,serif';
const SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
const MONO = '"SFMono-Regular",Consolas,"Liberation Mono",monospace';
export interface WechatThemeDesign {
  description: string; font: string; accent: string; canvas: string; surface: string; text: string; muted: string; line: string;
  motif: 'bar' | 'line' | 'band' | 'center' | 'plain'; dark?: boolean;
}
export const WECHAT_THEME_DESIGNS: Record<WechatThemeId, WechatThemeDesign> = {
  default: {description: '熟悉的青绿与清晰层级', font: SANS, accent: '#28735c', canvas: '#ffffff', surface: '#f3f6f4', text: '#292d32', muted: '#53635b', line: '#d9dfdc', motif: 'bar'},
  essay: {description: '宋体长文 · 从容留白', font: SERIF, accent: '#8b642e', canvas: '#ffffff', surface: '#f7f3ed', text: '#34302b', muted: '#766b5e', line: '#e5dcd0', motif: 'plain'},
  research: {description: '理性蓝调 · 清晰结构', font: SANS, accent: '#285c91', canvas: '#ffffff', surface: '#f2f6fb', text: '#293541', muted: '#5b6e80', line: '#d7e1ec', motif: 'line'},
  event: {description: '醒目标题 · 有力节奏', font: SANS, accent: '#a34460', canvas: '#ffffff', surface: '#faf1f4', text: '#302c32', muted: '#75636c', line: '#ead9df', motif: 'band'},
  minimal: {description: '纯净黑白 · 克制强调', font: SANS, accent: '#4f6b61', canvas: '#ffffff', surface: '#f5f7f6', text: '#252927', muted: '#68736e', line: '#dfe5e1', motif: 'plain'},
  editorial: {description: '宋体大标题 · 杂志质感', font: SERIF, accent: '#aa523d', canvas: '#ffffff', surface: '#f8f2eb', text: '#252d35', muted: '#69716f', line: '#ded9d0', motif: 'line'},
  paper: {description: '奶油纸色 · 温暖阅读', font: SERIF, accent: '#936644', canvas: '#fbf7ef', surface: '#fffcf6', text: '#4a4036', muted: '#796958', line: '#e8dccb', motif: 'plain'},
  noir: {description: '深色画布 · 温柔金色', font: SANS, accent: '#edc889', canvas: '#19232e', surface: '#24323f', text: '#e7edf2', muted: '#bac8d2', line: '#40515f', motif: 'line', dark: true},
  bloom: {description: '鼠尾草绿 · 轻盈柔和', font: SANS, accent: '#3f735f', canvas: '#f7faf6', surface: '#eaf1e8', text: '#33483d', muted: '#667d6d', line: '#d6e3d5', motif: 'bar'},
  cobalt: {description: '明亮钴蓝 · 当代手记', font: SANS, accent: '#315efb', canvas: '#ffffff', surface: '#eef2ff', text: '#28344f', muted: '#637395', line: '#d7e0ff', motif: 'band'},
  cinnabar: {description: '朱砂与墨 · 书卷气息', font: SERIF, accent: '#9b322c', canvas: '#fffdf8', surface: '#faf2e8', text: '#392f29', muted: '#7d685b', line: '#e5d7c5', motif: 'center'},
  mono: {description: '黑白强对比 · 档案秩序', font: SANS, accent: '#202020', canvas: '#ffffff', surface: '#f3f3f1', text: '#252525', muted: '#626262', line: '#bdbdb7', motif: 'band'},
};
export function themePalette(theme: WechatThemeId, accent: WechatAccent) {
  const design = WECHAT_THEME_DESIGNS[theme];
  const darkAccents = {teal: '#83c9b5', blue: '#9dbcf5', amber: '#edc889', rose: '#eda9b7'};
  return {...design, accent: accent === 'preset' ? design.accent : design.dark ? darkAccents[accent] : WECHAT_ACCENTS[accent]};
}
export function themeStyles(theme: WechatThemeId, accent: WechatAccent): Record<string, string> {
  const palette = themePalette(theme, accent), color = palette.accent;
  const styles = {...WECHAT_TEMPLATE};
  if (theme === 'default') {
    if (!['teal', 'preset'].includes(accent)) {
      styles.h1 = styles.h1.replace(/color:[^;]+;/, `color:${color};`);
      styles.h2 = styles.h2.replace(/border-left:3px solid [^;]+;/, `border-left:3px solid ${color};`);
      styles.a = `color:${color};text-decoration:underline;`;
    }
    return styles;
  }
  styles.section = `font-family:${palette.font};font-size:16px;line-height:1.9;color:${palette.text};background:${palette.canvas};overflow-wrap:break-word;`;
  styles.p = 'margin:0 0 22px;font-size:16px;line-height:1.9;';
  styles.h1 = `margin:24px 0 24px;font-size:27px;line-height:1.5;font-weight:bold;color:${color};`;
  styles.h2 = `margin:32px 0 18px;padding-bottom:9px;border-bottom:1px solid ${color};font-size:21px;line-height:1.6;font-weight:bold;color:${color};`;
  styles.h3 = `margin:26px 0 14px;font-size:18px;line-height:1.7;font-weight:bold;color:${palette.text};`;
  styles.blockquote = `margin:24px 0;padding:12px 18px;border-left:3px solid ${color};background:${palette.surface};color:${palette.muted};`;
  styles.a = `color:${color};text-decoration:underline;`;
  styles.pre = `margin:24px 0;padding:16px;background:${palette.surface};color:${palette.text};border:1px solid ${palette.line};border-radius:5px;font-size:13px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;`;
  styles.code = `font-family:${MONO};background:${palette.surface};font-size:0.9em;white-space:pre-wrap;`;
  styles.th = `border:1px solid ${palette.line};padding:10px 8px;background:${palette.surface};text-align:left;overflow-wrap:anywhere;`;
  styles.td = `border:1px solid ${palette.line};padding:10px 8px;text-align:left;overflow-wrap:anywhere;`;
  styles.hr = `border:0;border-top:1px solid ${palette.line};margin:32px 0;`;
  if (theme === 'essay') {
    styles.p = 'margin:0 0 25px;font-size:17px;line-height:2;';
    styles.h1 = `margin:28px 0;font-size:28px;line-height:1.6;font-weight:bold;color:${palette.text};`;
    styles.h2 = `margin:36px 0 22px;font-size:21px;line-height:1.6;font-weight:bold;color:${color};`;
  } else if (theme === 'event' || theme === 'cobalt') {
    styles.h1 = `margin:22px 0 26px;font-size:29px;line-height:1.45;font-weight:bold;color:${palette.text};`;
    styles.h2 = `margin:30px 0 18px;padding:11px 15px;background:${color};color:#fff;font-size:20px;line-height:1.6;font-weight:bold;`;
  } else if (theme === 'minimal') {
    styles.h1 = `margin:24px 0 28px;font-size:26px;line-height:1.55;font-weight:bold;color:${palette.text};`;
    styles.h2 = `margin:34px 0 18px;font-size:20px;line-height:1.65;font-weight:bold;color:${palette.text};`;
    styles.blockquote = `margin:24px 0;padding-left:18px;border-left:2px solid ${palette.line};color:${palette.muted};`;
  } else if (theme === 'editorial') {
    styles.h1 = `margin:26px 0 30px;padding-bottom:20px;border-bottom:2px solid ${palette.text};font-size:29px;line-height:1.55;font-weight:bold;letter-spacing:1px;color:${palette.text};`;
    styles.h2 = `margin:38px 0 20px;padding-top:12px;border-top:2px solid ${color};font-size:22px;line-height:1.6;font-weight:bold;color:${palette.text};`;
    styles.p = 'margin:0 0 24px;font-size:17px;line-height:1.95;';
    styles.blockquote = `margin:28px 0;padding:14px 20px;border-left:2px solid ${color};color:${palette.muted};font-size:17px;`;
  } else if (theme === 'paper') {
    styles.section += 'padding:22px 18px;';
    styles.h1 = `margin:8px 0 28px;font-size:27px;line-height:1.6;font-weight:bold;color:${palette.text};`;
    styles.h2 = `margin:34px 0 20px;font-size:21px;line-height:1.7;font-weight:bold;color:${color};`;
    styles.p = 'margin:0 0 24px;font-size:17px;line-height:2;';
  } else if (theme === 'noir') {
    styles.section += 'padding:24px 18px;';
    styles.h1 = `margin:8px 0 28px;font-size:28px;line-height:1.6;font-weight:bold;color:${color};`;
    styles.h2 = `margin:34px 0 20px;padding-bottom:12px;border-bottom:1px solid ${palette.line};font-size:21px;line-height:1.6;font-weight:bold;color:${color};`;
    styles.img += 'border-radius:6px;';
  } else if (theme === 'bloom') {
    styles.section += 'padding:22px 18px;';
    styles.h1 = `margin:8px 0 28px;font-size:27px;line-height:1.6;font-weight:bold;color:${color};`;
    styles.h2 = `margin:32px 0 20px;padding:8px 12px;border-left:3px solid ${color};background:${palette.surface};font-size:20px;line-height:1.7;font-weight:bold;color:${palette.text};`;
    styles.img += 'border-radius:8px;';
  } else if (theme === 'cinnabar') {
    styles.section += 'padding:22px 16px;';
    styles.h1 = `margin:12px 0 30px;padding-bottom:20px;border-bottom:1px solid ${color};font-size:28px;line-height:1.6;font-weight:bold;letter-spacing:2px;text-align:center;color:${palette.text};`;
    styles.h2 = `margin:36px 0 22px;font-size:21px;line-height:1.7;font-weight:bold;letter-spacing:3px;text-align:center;color:${color};`;
    styles.p = 'margin:0 0 25px;font-size:17px;line-height:2.05;';
    styles.blockquote = `margin:28px 0;padding:16px 12px;border-top:1px solid ${palette.line};border-bottom:1px solid ${palette.line};color:${palette.muted};`;
  } else if (theme === 'mono') {
    styles.h1 = `margin:22px 0 28px;padding-bottom:18px;border-bottom:3px solid ${palette.text};font-size:29px;line-height:1.45;font-weight:bold;color:${palette.text};`;
    styles.h2 = `margin:32px 0 20px;padding:10px 13px;background:${palette.text};color:#fff;font-size:19px;line-height:1.6;font-weight:bold;letter-spacing:1px;`;
    styles.pre = styles.pre.replace('border-radius:5px;', 'border-radius:0;');
  }
  return styles;
}

export function componentStyle(component: WechatLayoutComponent, accent: WechatAccent, theme: WechatThemeId = 'default'): string {
  const p = themePalette(theme, accent), color = p.accent;
  if (component === 'plain') return '';
  const styles = {
    intro: `margin:20px 0 28px;padding:17px 18px;border-left:3px solid ${color};background:${p.surface};font-size:18px;line-height:1.9;`,
    'highlight-card': `margin:24px 0;padding:18px;border:1px solid ${color};border-radius:4px;background:${p.surface};`,
    quote: `margin:26px 0;padding:14px 18px;border-left:3px solid ${color};color:${p.muted};`,
    conclusion: `margin:32px 0 22px;padding-top:18px;border-top:2px solid ${color};font-weight:bold;`,
  };
  if (theme === 'minimal') {
    styles.intro = `margin:20px 0 30px;padding:0 0 0 18px;border-left:2px solid ${color};font-size:18px;line-height:1.95;`;
    styles['highlight-card'] = `margin:26px 0;padding:16px 0 16px 18px;border-left:2px solid ${color};background:${p.surface};`;
  } else if (theme === 'editorial') {
    styles.intro = `margin:22px 0 30px;padding:20px;border-top:2px solid ${color};background:${p.surface};font-size:18px;line-height:1.95;`;
    styles['highlight-card'] = `margin:26px 0;padding:20px;border-top:2px solid ${color};background:${p.surface};`;
  } else if (['paper', 'bloom', 'noir'].includes(theme)) {
    styles.intro = `margin:20px 0 28px;padding:20px;border-radius:10px;background:${p.surface};font-size:18px;line-height:1.95;`;
    styles['highlight-card'] = `margin:26px 0;padding:20px;border:1px solid ${p.line};border-radius:10px;background:${p.surface};`;
  } else if (theme === 'cinnabar') {
    styles.intro = `margin:24px 0 30px;padding:18px 12px;border-top:1px solid ${color};border-bottom:1px solid ${p.line};font-size:18px;line-height:2;`;
    styles['highlight-card'] = `margin:26px 0;padding:18px 12px;border-top:1px solid ${p.line};border-bottom:1px solid ${p.line};background:${p.surface};`;
    styles.quote = `margin:28px 0;padding:18px 12px;border-top:1px solid ${color};border-bottom:1px solid ${p.line};color:${p.muted};`;
  } else if (theme === 'mono') {
    styles['highlight-card'] = `margin:24px 0;padding:18px;border:2px solid ${p.text};background:${p.canvas};`;
  } else if (theme === 'cobalt') {
    styles['highlight-card'] = `margin:24px 0;padding:18px;border-left:4px solid ${color};background:${p.surface};`;
  }
  return styles[component];
}
