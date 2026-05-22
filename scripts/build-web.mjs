import esbuild from "esbuild";

const mode = process.argv[2] === "production" ? "production" : "development";
const outfile = "web/static/app.js";

await esbuild.build({
  entryPoints: ["web/ts/main.ts"],
  bundle: true,
  outfile,
  format: "esm",
  target: "esnext",
  minify: mode === "production",
  sourcemap: mode !== "production",
  define: {
    "process.env.NODE_ENV": JSON.stringify(mode),
  },
});
