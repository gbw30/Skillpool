// Writes public/third-party-notices.txt: the licenses of the packages whose code is sent to the
// browser. The build strips their notices from the bundle, and MIT and the like ask that they go
// with every copy. Run `npm run notices` after adding or upgrading a package that reaches the page.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const SHIPPED = ["next", "react", "react-dom", "scheduler", "motion", "framer-motion", "motion-dom", "motion-utils",
  "three", "@swc/helpers", "tslib", "styled-jsx", "client-only"];

const parts = SHIPPED.map((name) => {
  const dir = `node_modules/${name}`;
  const pkg = JSON.parse(readFileSync(`${dir}/package.json`, "utf8"));
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
  const text = file ? readFileSync(`${dir}/${file}`, "utf8").trim() : `${pkg.license} (no license file in the package)`;
  return `${"=".repeat(72)}\n${name} ${pkg.version} (${pkg.license})\n${"=".repeat(72)}\n\n${text}\n`;
});

writeFileSync("public/third-party-notices.txt", [
  "SkillPool uses the following open source software. Its own code is MIT licensed:",
  "https://github.com/gbw30/Skillpool/blob/main/LICENSE",
  "",
  "Fonts: Cormorant Garamond, Hanken Grotesk and Geist Mono, under the SIL Open Font License 1.1",
  "(https://openfontlicense.org). Each font file carries its own copyright notice and license.",
  "",
  ...parts,
].join("\n"));
