import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('builds a standalone local plugin inside the project after relocation', async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  await promisify(execFile)('npm', ['run', 'build:plugin:local'], { cwd: root });
  const entry = new URL('../../outputs/doubao-translate-local/dist/index.mjs', import.meta.url);
  expect(await stat(entry).catch(() => undefined), 'plugin output must stay inside the project').toBeDefined();
  const { DoubaoTranslatePlugin } = await import(entry.href);
  const plugin = await DoubaoTranslatePlugin({});
  const config: any = {};
  await plugin.config(config);
  expect(Object.keys(config.provider['doubao-translate'].models)).toHaveLength(3);
  expect(plugin.auth.provider).toBe('doubao-translate');
  const bundledLicense = await readFile(new URL('../../outputs/doubao-translate-local/LICENSE', import.meta.url));
  expect(bundledLicense).toEqual(await readFile(new URL('../../LICENSE', import.meta.url)));
});
