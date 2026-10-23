import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { startControlRoom } from "../utils/controlRoomLauncher";

export async function runControlRoomLauncherTests() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "easy-pub 后台 "));
  const children = new Set<number>();
  const sessionFile = path.join(root, ".blog-admin/control-room.json");
  const script = `
    const fs = require('fs');
    fs.writeFileSync('spawn.json', JSON.stringify({pid:process.pid,args:process.argv.slice(2),cwd:process.cwd()}));
    fs.mkdirSync('.blog-admin',{recursive:true});
    fs.writeFileSync('.blog-admin/control-room.json',JSON.stringify({version:1,pid:process.pid,host:'127.0.0.1',port:12345,url:'http://127.0.0.1:12345/?token='+ 'a'.repeat(48)}));
    setInterval(()=>{},1000);
  `;
  try {
    await fs.mkdir(path.join(root, "admin"));
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({scripts:{gui:"node admin/server.js"}}));
    await fs.writeFile(path.join(root, "admin/server.js"), script);
    const [first, second] = await Promise.all([
      startControlRoom(root, async () => true),
      startControlRoom(root, async () => true),
    ]);
    children.add(first.pid);
    assert.equal(first.pid, second.pid, "simultaneous clicks share a single process");
    const spawn = JSON.parse(await fs.readFile(path.join(root, "spawn.json"), "utf8"));
    assert.deepEqual(spawn.args, ["--no-open", "--port=0"]);
    assert.equal(spawn.cwd, await fs.realpath(root));
    assert.equal((await startControlRoom(root, async () => true)).pid, first.pid, "reuse verified existing process");
    process.kill(first.pid);
    await new Promise(resolve => setTimeout(resolve, 150));
    children.delete(first.pid);
    // Leave the stale session on disk: it must not authenticate the next child.
    const restarted = await startControlRoom(root, async session => session.pid !== first.pid);
    children.add(restarted.pid);
    assert.notEqual(restarted.pid, first.pid);
    process.kill(restarted.pid);
    await new Promise(resolve => setTimeout(resolve, 150));
    children.delete(restarted.pid);
    await fs.rm(sessionFile);
    await fs.writeFile(path.join(root, "admin/server.js"), "process.exit(1)");
    await assert.rejects(startControlRoom(root, async () => true), /启动后退出/);
    await fs.writeFile(path.join(root, "admin/server.js"), script);
    await assert.rejects(startControlRoom(root, async () => false, 1000), /启动超时/);
    const timedOut = JSON.parse(await fs.readFile(path.join(root, "spawn.json"), "utf8")).pid;
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.throws(() => process.kill(timedOut, 0), /ESRCH/, "failed authentication stops only the new process");
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({scripts:{gui:"node other.js"}}));
    await assert.rejects(startControlRoom(root, async () => true), /不完整/);
    console.log("Control Room launch, reuse, concurrency, stale session, early exit and timeout tests passed");
  } finally {
    for (const pid of children) { try { process.kill(pid); } catch {} }
    await fs.rm(root, { recursive: true, force: true });
  }
}
