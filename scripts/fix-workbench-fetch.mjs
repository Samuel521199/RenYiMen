import fs from "fs";
import path from "path";

const ROOTS = [
  "src/app/(platform)/workbench",
  "src/workbench/components",
  "src/workbench/lib/video-workflow.ts",
];

function collectFiles(entry) {
  const abs = path.resolve(entry);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isFile()) return [abs];
  const out = [];
  for (const name of fs.readdirSync(abs)) {
    if (name === "api.ts" || name === "auth.ts") continue;
    out.push(...collectFiles(path.join(abs, name)));
  }
  return out;
}

function ensureImport(content) {
  if (!content.includes("workbenchFetch")) return content;
  if (content.includes('from "@workbench/lib/api"')) {
    if (/workbenchFetch/.test(content) && !/import[\s\S]*workbenchFetch/.test(content)) {
      return content.replace(
        /import\s+\{([^}]+)\}\s+from\s+"@workbench\/lib\/api";/,
        (m, imports) => {
          if (imports.includes("workbenchFetch")) return m;
          return `import {${imports.trim()}, workbenchFetch } from "@workbench/lib/api";`;
        },
      );
    }
    return content;
  }
  const importLine = 'import { workbenchFetch, resolveWorkbenchApiUrl } from "@workbench/lib/api";\n';
  const useClient = content.startsWith('"use client"') || content.startsWith("'use client'");
  if (useClient) {
    const lines = content.split("\n");
    const idx = lines.findIndex((l) => l.includes("use client"));
    lines.splice(idx + 1, 0, importLine.trimEnd());
    return lines.join("\n");
  }
  return importLine + content;
}

for (const root of ROOTS) {
  for (const file of collectFiles(root).filter((f) => /\.tsx?$/.test(f))) {
    let content = fs.readFileSync(file, "utf8");
    let next = content;

    next = next.replace(/\bfetch\(\s*`(\/api\/[^`]+)`/g, "workbenchFetch(`$1`");
    next = next.replace(/\bfetch\(\s*"(\/api\/[^"]+)"/g, 'workbenchFetch("$1"');
    next = next.replace(/\bfetch\(\s*'(\/api\/[^']+)'/g, "workbenchFetch('$1'");

    // `/workflows/...` frontend routes (not API)
    next = next.replace(/(?<!\/workbench)([`'"])\/workflows\//g, "$1/workbench/workflows/");

    // Top-level workbench routes that were copied from standalone app
    const routeRewrites = [
      [/href="\/gallery(\?|"|$)/g, 'href="/workbench/gallery$1'],
      [/href='\/gallery(\?|'|$)/g, "href='/workbench/gallery$1"],
      [/href="\/assets"/g, 'href="/workbench/assets"'],
      [/href='\/assets'/g, "href='/workbench/assets'"],
      [/href="\/tasks"/g, 'href="/workbench/tasks"'],
      [/href='\/tasks'/g, "href='/workbench/tasks'"],
      [/href="\/workflows"/g, 'href="/workbench/workflows"'],
      [/href='\/workflows'/g, "href='/workbench/workflows'"],
      [/router\.push\("\/workflows"\)/g, 'router.push("/workbench/workflows")'],
      [/router\.push\('\/workflows'\)/g, "router.push('/workbench/workflows')"],
      [/router\.push\("\/tasks"\)/g, 'router.push("/workbench/tasks")'],
      [/router\.push\("\/login"\)/g, 'router.push("/auth/signin?callbackUrl=/workbench/videos")'],
    ];
    for (const [pattern, replacement] of routeRewrites) {
      next = next.replace(pattern, replacement);
    }

    if (next !== content) {
      next = ensureImport(next);
      fs.writeFileSync(file, next);
      console.log("fixed:", path.relative(process.cwd(), file));
    }
  }
}

console.log("done");
