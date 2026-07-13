import fs from "fs";
import path from "path";

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const roots = ["src/workbench", "src/app/(platform)/workbench"];
for (const root of roots) {
  for (const file of walk(path.resolve(root)).filter((f) => /\.tsx?$/.test(f))) {
    let content = fs.readFileSync(file, "utf8");
    const next = content.replaceAll(
      'localStorage.getItem("token")',
      'localStorage.getItem("workbench_token")',
    );
    if (next !== content) fs.writeFileSync(file, next);
  }
}
console.log("token keys updated");
