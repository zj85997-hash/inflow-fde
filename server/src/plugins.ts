import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { PluginManifest } from '@inflow/contracts';

const here = dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = join(here, '../../plugins');

export function loadPlugins(): PluginManifest[] {
  if (!existsSync(PLUGIN_DIR)) return [];
  const out: PluginManifest[] = [];
  for (const dir of readdirSync(PLUGIN_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const manifestPath = join(PLUGIN_DIR, dir.name, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    try {
      out.push(JSON.parse(readFileSync(manifestPath, 'utf8')));
    } catch (e) {
      console.warn(`插件 manifest 解析失败: ${manifestPath}`, e);
    }
  }
  return out;
}
