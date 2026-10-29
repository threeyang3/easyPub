import { fromMarkdown } from "mdast-util-from-markdown";
export interface BodyChange { start: number; end: number; before: string[]; after: string[]; imagesOnly: boolean; order?:number; imageRows?:boolean[]; afterStart?:number }
export interface SyncChange extends BodyChange { status: "ready" | "conflict" | "already"; targetStart: number; targetEnd: number; targetText: string[]; replacement: string[]; replacementOrigins?:Array<number|null> }

/** Exact line diff, bounded so a pasted/generated document cannot stall the workbench. */
export function bodyChanges(before: string, after: string): BodyChange[] {
  const allA=before.split("\n"),allB=after.split("\n");
  if(allA.length>10000||allB.length>10000)throw new Error("正文过长，无法安全预览同步差异；请先拆分文章");
  const indexedA=allA.map((line,index)=>({line,index})).filter(item=>item.line.trim()),indexedB=allB.map((line,index)=>({line,index})).filter(item=>item.line.trim());
  const a=indexedA.map(item=>item.line),b=indexedB.map(item=>item.line);
  const actualImages=new Set<number>();
  const visit=(node:any)=>{if(["code","inlineCode","html"].includes(node.type))return;if(node.type==="image"&&node.position.start.line===node.position.end.line)actualImages.add(node.position.start.line-1);node.children?.forEach(visit);};visit(fromMarkdown(after));
  if ((a.length + 1) * (b.length + 1) > 4_000_000) throw new Error("正文过长，无法安全预览同步差异；请先拆分文章");
  const width = b.length + 1, lcs = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
    lcs[i * width + j] = a[i] === b[j] ? 1 + lcs[(i + 1) * width + j + 1]
      : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
  }
  const changes: BodyChange[] = [];
  const anchors:Array<[number,number]>=[[-1,-1]];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { anchors.push([indexedA[i].index,indexedB[j].index]);i++;j++;continue; }
    if (j < b.length && (i === a.length || lcs[i * width + j + 1] > lcs[(i + 1) * width + j])) j++;
    else i++;
  }
  anchors.push([allA.length,allB.length]);
  for(let k=1;k<anchors.length;k++) {
    let start=anchors[k-1][0]+1,from=anchors[k-1][1]+1,end=anchors[k][0],to=anchors[k][1];
    while(start<end&&from<to&&allA[start]===allB[from]){start++;from++;}
    while(end>start&&to>from&&allA[end-1]===allB[to-1]){end--;to--;}
    if(start===end&&from===to)continue;
    const old=allA.slice(start,end),next=allB.slice(from,to);
    const imageRows=next.map((line,index)=>actualImages.has(from+index)&&/^!\[[^\n]*\]\([^\n]+\)\s*$/.test(line.trim()));
    changes.push({start, end, before: old, after: next, afterStart:from, imageRows,
      imagesOnly: old.every(line => !line.trim()) && imageRows.some(Boolean)
        && next.every((line,index) => !line.trim() || imageRows[index])});
  }
  const separated=changes.flatMap(change=>{
    if(change.imagesOnly)return [change];
    let start=0,end=change.after.length;
    while(start<end&&(!change.after[start].trim()||change.imageRows?.[start]))start++;
    if(start===end)return [change];
    if(!change.imageRows?.slice(0,start).some(Boolean))start=0;
    while(end>start&&(!change.after[end-1].trim()||change.imageRows?.[end-1]))end--;
    if(!change.imageRows?.slice(end).some(Boolean))end=change.after.length;
    return [
      ...(start?[{start:change.start,end:change.start,before:[],after:change.after.slice(0,start),afterStart:change.afterStart,imagesOnly:true}]:[]),
      {...change,after:change.after.slice(start,end),afterStart:(change.afterStart??0)+start},
      ...(end<change.after.length?[{start:change.end,end:change.end,before:[],after:change.after.slice(end),afterStart:(change.afterStart??0)+end,imagesOnly:true}]:[]),
    ];
  });
  return separated.map((change,order)=>({...change,order}));
}

export function reconcileChanges(base: string, sender: string, target: string): SyncChange[] {
  const local = bodyChanges(base, target), targetLines = target.split("\n");
  const offset = (position: number, end: boolean) => position + local.reduce((delta, change) =>
    delta + (change.end < position || change.end === position && (change.start !== change.end || end)
      ? change.after.length - (change.end - change.start) : 0), 0);
  return bodyChanges(base, sender).map(change => {
    const identical = local.find(other => other.start === change.start && other.end === change.end
      && other.after.join("\n") === change.after.join("\n"));
    const overlaps = local.filter(other => other.start === other.end && change.start === change.end
      ? other.start === change.start
      : other.start === other.end ? other.start >= change.start && other.start <= change.end
      : change.start === change.end ? change.start > other.start && change.start < other.end
      : other.start < change.end && other.end > change.start);
    const start = Math.min(change.start, ...overlaps.map(other => other.start));
    const end = Math.max(change.end, ...overlaps.map(other => other.end));
    const targetStart = offset(start, false), targetEnd = offset(end, true);
    // An overlapping target edit is shown as a whole replaceable region, including unchanged surrounding base lines.
    const baseLines = base.split("\n");
    return {...change, replacementOrigins:[...Array(change.start-start).fill(null), ...change.after.map((_,index)=>(change.afterStart??0)+index), ...Array(end-change.end).fill(null)], replacement: [...baseLines.slice(start, change.start), ...change.after, ...baseLines.slice(change.end, end)],
      status: identical ? "already" : overlaps.length ? "conflict" : "ready",
      targetStart, targetEnd, targetText: targetLines.slice(targetStart, targetEnd)};
  });
}

export function applySyncChanges(target: string, changes: SyncChange[]): string {
  return applySyncChangesWithOrigins(target,changes).body;
}
export function applySyncChangesWithOrigins(target: string, changes: SyncChange[]) {
  const lines = target.split("\n");
  const origins:Array<{side:"target"|"sender";line:number}|null> = lines.map((_,line)=>({side:"target",line}));
  const sorted = changes.filter(change => change.status !== "already").sort((a,b) => b.targetStart - a.targetStart || b.targetEnd - a.targetEnd || (b.order??0)-(a.order??0));
  for (let i=1;i<sorted.length;i++) if (sorted[i].targetEnd > sorted[i-1].targetStart) throw new Error("所选改动重叠，请分次同步并重新预览");
  for (const change of sorted) {
    lines.splice(change.targetStart, change.targetEnd-change.targetStart, ...change.replacement);
    origins.splice(change.targetStart,change.targetEnd-change.targetStart,...change.replacement.map((_,index)=>{
      const line=change.replacementOrigins?.[index];return line===undefined||line===null?null:{side:"sender" as const,line};
    }));
  }
  return {body:lines.join("\n"),origins};
}
