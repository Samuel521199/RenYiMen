import fs from "fs";
import path from "path";

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const roots = [
  "src/app/(platform)/workbench",
  "src/workbench",
];

for (const root of roots) {
  const abs = path.resolve(root);
  if (!fs.existsSync(abs)) continue;
  for (const file of walk(abs).filter((f) => /\.(tsx?|jsx?)$/.test(f))) {
    let content = fs.readFileSync(file, "utf8");
    let next = content;
    next = next.replaceAll("@/lib/", "@workbench/lib/");
    next = next.replaceAll("@/components/", "@workbench/components/");
    next = next.replaceAll('"/workflows/', '"/workbench/workflows/');
    next = next.replaceAll('"/gallery/', '"/workbench/gallery/');
    next = next.replaceAll('"/assets/', '"/workbench/assets/');
    next = next.replaceAll('"/admin/', '"/workbench/admin/');
    next = next.replaceAll('"/tasks/', '"/workbench/tasks/');
    next = next.replaceAll('"/dashboard"', '"/workbench/dashboard"');
    next = next.replaceAll('"/review"', '"/workbench/review"');
    next = next.replaceAll('"/stats"', '"/workbench/stats"');
    next = next.replaceAll('"/instructions"', '"/workbench/instructions"');
    next = next.replaceAll('"/prompts"', '"/workbench/prompts"');
    next = next.replaceAll('"/videos"', '"/workbench/videos"');
    next = next.replaceAll('"/workbench/workbench/', '"/workbench/');
    next = next.replaceAll(
      'process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000"',
      '"/api/workbench"',
    );
    next = next.replaceAll("http://localhost:8000${", "/api/workbench${");
    next = next.replaceAll("`http://localhost:8000${", "`/api/workbench${");
    if (next !== content) fs.writeFileSync(file, next);
  }
}

const pages = walk(path.resolve("src/app/(platform)/workbench")).filter((f) =>
  f.endsWith(`${path.sep}page.tsx`),
);
console.log(`Updated workbench pages: ${pages.length}`);
