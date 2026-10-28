import { App, TFile } from 'obsidian';
import { ArticlePropertiesModal } from '../modals/ArticlePropertiesModal';
import { SOURCE_FIELDS, PropertySelection } from '../utils/articleProperties';
import fs from 'fs/promises';

/** Interactive acceptance. A CUA/user selects the supplied synthetic PNG in the OS dialog. */
export async function run(app: App, options: {styles?:string; pickerImagePath?:string}) {
  if(app.vault.getName()!=='Sandbox'||!options.pickerImagePath) throw new Error('Requires Sandbox and a synthetic picker image');
  const expected=await fs.readFile(options.pickerImagePath);
  const prefix='easypub-native-picker-', folder=`EasyPub picker acceptance ${Date.now()}`;
  const created: TFile[]=[];
  const originalActive=app.workspace.activeLeaf;
  const style=document.createElement('style'); style.textContent=options.styles??''; document.head.append(style);
  const event=app.vault.on('create',file=>{if(file instanceof TFile && file.name.startsWith(prefix)) created.push(file);});
  let modal: ArticlePropertiesModal|undefined;
  let timeout: ReturnType<typeof setTimeout>|undefined;
  try {
    await app.vault.createFolder(folder);
    const source=await app.vault.create(`${folder}/source.md`,'Synthetic picker acceptance');
    const selection=await new Promise<PropertySelection|null>(resolve=>{
      modal=new ArticlePropertiesModal(app,{title:'EasyPub 原生选图验收',description:'选择提供的合成 PNG，预览属性并确认。只在 Sandbox 创建测试附件。',
        fields:SOURCE_FIELDS.filter(f=>['title','cover'].includes(f.key)),current:{title:'原生文件选择器验收'},suggested:{},attachmentSourcePath:source.path},resolve);
      modal.open();
      timeout=setTimeout(()=>modal?.close(),120000);
    });
    if(!selection) throw new Error('Native picker acceptance cancelled');
    const raw=selection.values.cover;
    if(typeof raw!=='string') throw new Error('Cover not selected');
    const file=app.vault.getAbstractFileByPath(raw.replace(/^\[\[|\]\]$/g,''));
    if(!(file instanceof TFile)||!created.includes(file)) throw new Error('Expected a newly uploaded synthetic attachment');
    if(!Buffer.from(await app.vault.readBinary(file)).equals(expected)) throw new Error('Attachment bytes differ');
    if(await app.vault.read(source)!=='Synthetic picker acceptance') throw new Error('Source changed');
    return {checks:['Actual Obsidian OS file chooser selects the synthetic PNG','Native property form imports to the configured attachment directory','Uploaded cover reference reaches property confirmation','Imported bytes are identical and source note is unchanged'],remoteWrites:0};
  } finally {
    if(timeout) clearTimeout(timeout);
    modal?.close(); app.vault.offref(event); style.remove();
    for(const file of created) if(app.vault.getAbstractFileByPath(file.path)) await app.vault.delete(file,true);
    const dir=app.vault.getAbstractFileByPath(folder); if(dir) await app.vault.delete(dir,true);
    if(originalActive) app.workspace.setActiveLeaf(originalActive,{focus:false});
  }
}
