import { readFile, writeFile } from "fs/promises";

const packageData = JSON.parse(await readFile("package.json", "utf8"));
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const versions = JSON.parse(await readFile("versions.json", "utf8"));

manifest.version = packageData.version;
versions[packageData.version] = manifest.minAppVersion;

await writeFile("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile("versions.json", `${JSON.stringify(versions, null, 2)}\n`);

console.log(`Synced EasyPub version ${packageData.version}`);
