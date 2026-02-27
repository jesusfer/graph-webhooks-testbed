import esbuild from "esbuild";

const isWatch = process.argv.includes("--watch");
const isProd = process.argv.includes("--prod");

/** @type {import("esbuild").BuildOptions} */
const config = {
    entryPoints: ["src/frontend/app.ts"],
    bundle: true,
    outfile: "public/js/app.js",
    sourcemap: true,
    target: "es2024",
    format: "esm",
    minify: isProd,
    jsx: "automatic",
    jsxImportSource: "preact",
    logLevel: "info",
};

if (isWatch) {
    const ctx = await esbuild.context(config);
    await ctx.watch({
        delay: 1000,
    });
    console.log("Watching for changes...");
} else {
    await esbuild.build(config);
}
