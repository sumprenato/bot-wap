const path = require("node:path");
const { build } = require("esbuild");

build({
  absWorkingDir: path.resolve(__dirname, ".."),
  entryPoints: ["frontend/site.jsx"],
  outfile: "public/assets/js/site.js",
  bundle: true,
  minify: true,
  jsx: "automatic",
  target: ["es2020"],
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "linked",
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
