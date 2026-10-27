/** 内置行业插件包。服务端会扫描 plugins/ 目录（可以 DIY 新增）；浏览器演示直接用这里打包好的。 */
import type { PluginManifest } from '@inflow/contracts';
import crossBorder from '../../../plugins/cross-border-ecommerce/manifest.json';
import finance from '../../../plugins/finance/manifest.json';
import indieSite from '../../../plugins/indie-site/manifest.json';

export const BUILTIN_PLUGINS = [crossBorder, finance, indieSite] as unknown as PluginManifest[];
