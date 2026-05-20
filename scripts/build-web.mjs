import esbuild from "esbuild";

const mode = process.argv[2] === "production" ? "production" : "development";

await esbuild.build({
  entryPoints: ["web/ts/main.ts"],
  bundle: true,
  outfile: "web/static/app.js",
  format: "esm",
  minify: mode === "production",
  sourcemap: mode !== "production",
  define: {
    "process.env.NODE_ENV": JSON.stringify(mode),
  },
});
