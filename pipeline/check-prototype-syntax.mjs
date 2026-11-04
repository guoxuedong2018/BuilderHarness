#!/usr/bin/env node
// 只读检查原型工程 src/ 下的 JS、JSX 与 Vue 脚本：语法，以及用了却没有声明、也没有 import 的标识符。
// 不执行产品代码；不替代模板编译、模块路径解析、浏览器主路径与视觉验证。
//
// 解析器借宿主依赖链（见 lib/undeclared.mjs），套件不装。借不到时：.js / .mjs / .vue 照常做语法检查，
// 「没引入」这一项和 .jsx 明确标成没查，结果里写清楚，不当成通过。TypeScript 文件不在本检查范围，同样列出来。
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

import { WEB_DIR } from './lib/paths.mjs';
import { ParserUnavailable, createUndeclaredFinder } from './lib/undeclared.mjs';

const webRoot = path.resolve(process.argv[2] || WEB_DIR);
const src = path.join(webRoot, 'src');
const hostRequire = createRequire(path.join(webRoot, 'package.json'));
let failures = 0;
let checked = 0;
let compiler;
let analyze;
let parserMissing = false;
const undeclared = []; // { file, line, column, name }
const exporters = new Map(); // 名字 → 导出它的文件，给漏引入的提示从哪儿引
const unchecked = { jsx: [], ts: [] };

function fail(file, message) {
  failures += 1;
  console.error(`✗ ${path.relative(webRoot, file)}\n${message}`);
}

function addExporter(name, file) {
  if (!exporters.has(name)) exporters.set(name, []);
  exporters.get(name).push(path.relative(webRoot, file));
}

/** 借宿主的解析器；借不到记一次，之后都按降级走 */
function finder() {
  if (analyze || parserMissing) return analyze;
  try {
    analyze = createUndeclaredFinder(hostRequire);
  } catch (error) {
    if (!(error instanceof ParserUnavailable)) throw error;
    parserMissing = true;
  }
  return analyze;
}

function collect(file, found, offset) {
  for (const name of found.exported) addExporter(name, file);
  for (const u of found.undeclared) {
    undeclared.push({
      file, name: u.name,
      line: offset.line + u.line - 1,
      column: (u.line === 1 ? offset.column + u.column : u.column) + 1,
    });
  }
}

// offset：脚本在文件里的起点（行从 1、列从 0），用来把脚本内坐标换回文件坐标
function checkJs(file, source, label = '', lang = 'js', offset = { line: 1, column: 0 }) {
  if (!['js', 'javascript'].includes(lang)) {
    fail(file, `${label} 的 ${lang} 需要对应解析器，本检查未验证，不能当成通过。`);
    return;
  }
  checked += 1;
  const result = spawnSync(process.execPath, ['--check', '--input-type=module'], {
    input: source, encoding: 'utf8', maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    fail(file, `${label}\n${result.error?.message || result.stderr}`.trim());
    return;
  }
  if (!finder()) return;
  try {
    collect(file, analyze(source), offset);
  } catch (error) {
    fail(file, `${label}\n无法做作用域分析：${error.message}`.trim());
  }
}

// JSX 只有 Babel 认得：语法与作用域一起查；借不到解析器就列进「没查」
function checkJsx(file, source) {
  if (!finder()) {
    unchecked.jsx.push(file);
    return;
  }
  checked += 1;
  try {
    collect(file, analyze(source, { jsx: true }), { line: 1, column: 0 });
  } catch (error) {
    const at = error.loc ? `:${error.loc.line}:${error.loc.column + 1}` : '';
    fail(file, `语法错误${at}：${error.message}`);
  }
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) { await walk(file); continue; }
    if (!entry.isFile()) continue;
    if (/\.(?:js|mjs)$/.test(file)) {
      checkJs(file, await readFile(file, 'utf8'));
    } else if (file.endsWith('.jsx')) {
      addExporter(path.basename(file, '.jsx'), file);
      checkJsx(file, await readFile(file, 'utf8'));
    } else if (/\.(?:ts|tsx|mts)$/.test(file) && !file.endsWith('.d.ts')) {
      unchecked.ts.push(file);
    } else if (file.endsWith('.vue')) {
      addExporter(path.basename(file, '.vue'), file);
      try {
        compiler ||= hostRequire('vue/compiler-sfc');
        const source = await readFile(file, 'utf8');
        const descriptor = compiler.parse({ source, filename: file });
        for (const error of descriptor.errors || []) fail(file, String(error));
        for (const [kind, block] of [['script', descriptor.script], ['script setup', descriptor.scriptSetup]]) {
          if (!block) continue;
          if (block.src || block.attrs?.src) {
            fail(file, `${kind} 使用外部 src；需单独验证外部脚本。`);
            continue;
          }
          const before = source.slice(0, block.start).split('\n');
          const line = before.length;
          checkJs(file, block.content, `<${kind}> 起始于源码第 ${line} 行；以下行号相对该脚本`,
            block.lang || block.attrs?.lang || 'js', { line, column: before[line - 1].length });
        }
      } catch (error) {
        fail(file, `无法解析 Vue 2.7 SFC：${error.message}`);
      }
    }
  }
}

function reportUndeclared() {
  if (undeclared.length === 0) return;
  console.error(`\n✗ 用了却没有声明、也没有 import（${undeclared.length} 处）：\n`);
  for (const u of undeclared) {
    const from = (exporters.get(u.name) || []).filter((f) => f !== path.relative(webRoot, u.file));
    const where = from.length ? `  ← ${from.slice(0, 2).join('、')} 导出了它` : '';
    console.error(`    ${path.relative(webRoot, u.file)}:${u.line}:${u.column}  ${u.name}${where}`);
  }
  console.error(
    '    → 补上 import 或声明；运行时一调用就 ReferenceError，生产构建里整页白屏。\n'
    + '      构建期 define 注入的常量在文件里写 /* global 名字 */；浏览器自带、清单漏收的全局，'
    + '补进 builderharness 的 pipeline/lib/undeclared.mjs。\n',
  );
}

/** 没查的说出来：降级不是通过 */
function reportUnchecked() {
  const list = (files) => files.slice(0, 3).map((f) => path.relative(webRoot, f)).join('、') + (files.length > 3 ? ' 等' : '');
  if (parserMissing) {
    console.warn(
      `\n⚠ 降级：宿主依赖里借不到 @babel/parser，「用了却没引入」这一项没查${unchecked.jsx.length ? `，${unchecked.jsx.length} 个 .jsx 连语法也没查（${list(unchecked.jsx)}）` : ''}。\n`
      + '  React 宿主装上 @vitejs/plugin-react（或直接装 @babel/parser）、Vue 宿主装好 vue 后重跑。',
    );
  }
  if (unchecked.ts.length) {
    console.warn(`\n⚠ ${unchecked.ts.length} 个 TypeScript 文件不在本检查范围（${list(unchecked.ts)}）：交给 tsc 或构建去查。`);
  }
}

try {
  if (!(await stat(src)).isDirectory()) throw new Error(`${src} 不是目录`);
  await walk(src);
  if (checked === 0 && failures === 0) throw new Error('没有检查到任何脚本，不能判为通过');
  reportUndeclared();
  reportUnchecked();
  const scope = parserMissing ? '未检查（降级）' : `${undeclared.length} 处`;
  console.log(`脚本检查：${checked} 个脚本，语法 ${failures} 处失败，未声明的标识符 ${scope}。`);
  console.log('此结果不证明模板、模块路径解析、业务闭环或视觉质量通过。');
  process.exitCode = failures || undeclared.length ? 1 : 0;
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
