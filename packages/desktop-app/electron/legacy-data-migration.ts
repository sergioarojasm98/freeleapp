import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Leapp kept its data in ~/.Leapp; Freeleapp uses ~/.freeleapp. Keychain items are migrated lazily by AppKeychainService.
const legacyDirName = ".Leapp";
const dirName = ".freeleapp";
const markerName = ".migrated-from-leapp";
const renamedFiles: [string, string][] = [
  ["Leapp-lock.json", "freeleapp-lock.json"],
  ["Leapp-lock.backup.bin", "freeleapp-lock.backup.bin"],
];

export interface LegacyMigrationResult {
  migrated: boolean;
  reason: string;
}

/**
 * Copy Leapp's data folder into Freeleapp's on first run, before anything reads the configuration.
 * The original folder is left untouched as a backup, and the copy never overwrites existing Freeleapp files.
 */
export const migrateLegacyData = (homeDir: string = os.homedir()): LegacyMigrationResult => {
  const legacyDir = path.join(homeDir, legacyDirName);
  const dir = path.join(homeDir, dirName);
  const marker = path.join(dir, markerName);

  if (fs.existsSync(marker)) {
    return { migrated: false, reason: "already migrated" };
  }
  if (!fs.existsSync(legacyDir)) {
    return { migrated: false, reason: "no Leapp data found" };
  }

  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(path.join(dir, renamedFiles[0][1]))) {
    fs.writeFileSync(marker, JSON.stringify({ skippedAt: new Date().toISOString(), reason: "Freeleapp configuration already existed" }));
    return { migrated: false, reason: "Freeleapp configuration already existed" };
  }

  fs.cpSync(legacyDir, dir, { recursive: true, force: false, errorOnExist: false });
  for (const [from, to] of renamedFiles) {
    const source = path.join(dir, from);
    const target = path.join(dir, to);
    if (fs.existsSync(source) && !fs.existsSync(target)) {
      fs.renameSync(source, target);
    }
  }
  fs.writeFileSync(marker, JSON.stringify({ migratedAt: new Date().toISOString(), from: legacyDir }));
  return { migrated: true, reason: `copied ${legacyDir} to ${dir}` };
};
