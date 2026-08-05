/**
 * Sync release version across package manifests.
 * @param {string} version semver without leading "v"
 * @param {string} root repo root
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function writeJsonVersion(filePath, version) {
  const raw = readFileSync(filePath, "utf8");
  const json = JSON.parse(raw);
  json.version = version;
  writeFileSync(filePath, `${JSON.stringify(json, null, 2)}\n`, "utf8");
}

export function syncReleaseVersion(root, version) {
  if (!/^\d+\.\d+\.\d+([.-][\w.-]+)?$/.test(version)) {
    throw new Error(`Invalid semver version: ${version}`);
  }

  writeJsonVersion(join(root, "apps/vscode/package.json"), version);
  writeJsonVersion(join(root, "apps/desktop/package.json"), version);
  writeJsonVersion(join(root, "apps/bridge/package.json"), version);

  const tauriConfPath = join(root, "apps/desktop/src-tauri/tauri.conf.json");
  const tauriConf = JSON.parse(readFileSync(tauriConfPath, "utf8"));
  tauriConf.version = version;
  writeFileSync(tauriConfPath, `${JSON.stringify(tauriConf, null, 2)}\n`, "utf8");

  const cargoPath = join(root, "apps/desktop/src-tauri/Cargo.toml");
  let cargo = readFileSync(cargoPath, "utf8");
  cargo = cargo.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`);
  writeFileSync(cargoPath, cargo, "utf8");

  const gradleProps = join(root, "apps/jetbrains/gradle.properties");
  let props = readFileSync(gradleProps, "utf8");
  if (!/^pluginVersion=/m.test(props)) {
    throw new Error("gradle.properties missing pluginVersion=");
  }
  props = props.replace(/^pluginVersion=.*$/m, `pluginVersion=${version}`);
  writeFileSync(gradleProps, props, "utf8");

  console.log(`[release] synced manifests to ${version}`);
}
