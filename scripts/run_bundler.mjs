#!/usr/bin/env node
/**
 * # run_bundler.mjs
 *
 * This file allows to create JavaScript bundles for the RxPlayer through our
 * bundlers with the right configuration.
 *
 * You can either run it directly as a script (run `node run_bundler.mjs -h`
 * to see the different options) or by requiring it as a node module.
 * If doing the latter you will obtain a function you will have to run with the
 * right options.
 */

import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import esbuild from "esbuild";
import getHumanReadableHours from "./utils/get_human_readable_hours.mjs";

/**
 * Run bundler with the given options.
 * @param {string} inputFile
 * @param {Object} options
 * @param {boolean} [options.minify] - If `true`, the output will be minified.
 * @param {boolean} [options.globalScope] - If `true`, enable global scope mode
 * (the `__GLOBAL_SCOPE__` global symbol will be set to `true` in the bundle).
 * @param {boolean} [options.production] - If `false`, the code will be compiled
 * in "development" mode, which has supplementary assertions.
 * @param {boolean} [options.watch] - If `true`, the RxPlayer's files involve
 * will be watched and the code re-built each time one of them changes.
 * @param {boolean} [options.silent] - If `true`, we won't output logs.
 * @param {string} [options.outfile] - Destination of the produced es2017
 * bundle. To ignore to skip ES2017 bundle generation.
 * @returns {Promise}
 */
export default async function runBundler(inputFile, options) {
  const minify = !!options.minify;
  const watch = !!options.watch;
  const isDevMode = !options.production;
  const isSilent = options.silent;
  const outfile = options.outfile;
  const globalScope = !!options.globalScope;

  if (outfile === undefined) {
    throw new Error("No output file has been provided");
  }

  const esbuildStepsPlugin = {
    name: "bundler-steps",
    setup(build) {
      build.onStart(() => logWarning(`Bundling of ${inputFile} started`));
      build.onEnd((result) => {
        if (result.errors.length > 0 || result.warnings.length > 0) {
          const { errors, warnings } = result;
          logWarning(
            `File re-bundle of ${inputFile} failed with ${errors.length} error(s) and ` +
              ` ${warnings.length} warning(s) `,
          );
          return;
        }
        if (outfile !== undefined) {
          logSuccess(`File updated at ${outfile}!`);
        }
      });
    },
  };

  const meth = watch ? "context" : "build";

  // Create a context for incremental builds
  try {
    const context = await esbuild[meth]({
      entryPoints: [inputFile],
      bundle: true,
      target: "es2017",
      minify,
      write: outfile !== undefined,
      outfile,
      plugins: [esbuildStepsPlugin],
      define: {
        "process.env.NODE_ENV": JSON.stringify(isDevMode ? "development" : "production"),
        __ENVIRONMENT__: JSON.stringify({
          PRODUCTION: 0,
          DEV: 1,
          CURRENT_ENV: isDevMode ? 1 : 0,
        }),
        __LOGGER_LEVEL__: JSON.stringify({ CURRENT_LEVEL: isDevMode ? "INFO" : "NONE" }),
        __GLOBAL_SCOPE__: JSON.stringify(globalScope),
      },
    });
    if (watch) {
      return context.watch();
    }
  } catch (err) {
    logError(`Bundling failed for ${inputFile}:`, err);
    throw err;
  }

  function logSuccess(msg) {
    if (!isSilent) {
      console.log(`\x1b[32m[${getHumanReadableHours()}]\x1b[0m`, msg);
    }
  }

  function logWarning(msg) {
    if (!isSilent) {
      console.log(`\x1b[33m[${getHumanReadableHours()}]\x1b[0m`, msg);
    }
  }

  function logError(msg) {
    if (!isSilent) {
      console.log(`\x1b[31m[${getHumanReadableHours()}]\x1b[0m`, msg);
    }
  }
}

// If true, this script is called directly
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  let shouldWatch = false;
  let shouldMinify = false;
  let production = false;
  let globalScope = false;
  let outputFile = "";
  let silent = false;

  if (args[0] === "-h" || args[0] === "--help") {
    displayHelp();
    process.exit(0);
  }
  for (let argOffset = 1; argOffset < args.length; argOffset++) {
    const currentArg = args[argOffset];
    switch (currentArg) {
      case "-h":
      case "--help":
        displayHelp();
        process.exit(0);
        break;

      case "-w":
      case "--watch":
        shouldWatch = true;
        break;

      case "-m":
      case "--minify":
        shouldMinify = true;
        break;

      case "-p":
      case "--production-mode":
        production = true;
        break;

      case "-g":
      case "--globals":
        globalScope = true;
        break;

      case "-s":
      case "--silent":
        silent = true;
        break;

      case "-o":
      case "--output":
        {
          argOffset++;
          const wantedOutput = args[argOffset];
          if (wantedOutput === undefined) {
            console.error("ERROR: no output file provided\n");
            displayHelp();
            process.exit(1);
          }
          outputFile = path.normalize(wantedOutput);
        }
        break;

      default: {
        console.error('ERROR: unknown option: "' + currentArg + '"\n');
        displayHelp();
        process.exit(1);
      }
    }
  }

  const inputFile = args[0];
  if (inputFile === undefined) {
    console.error("ERROR: no input file provided\n");
    displayHelp();
    process.exit(1);
  }

  const normalizedPath = path.normalize(inputFile);
  if (!fs.existsSync(normalizedPath)) {
    console.error(`ERROR: input file not found: ${inputFile}\n`);
    displayHelp();
    process.exit(1);
  }

  try {
    runBundler(normalizedPath, {
      watch: shouldWatch,
      minify: shouldMinify,
      production,
      globalScope,
      silent,
      outfile: outputFile,
    }).catch((err) => {
      console.error(`ERROR: ${err}\n`);
      process.exit(1);
    });
  } catch (err) {
    console.error(`ERROR: ${err}\n`);
    process.exit(1);
  }
}

/**
 * Display through `console.log` an helping message relative to how to run this
 * script.
 */
function displayHelp() {
  console.log(
    `run_bundler.mjs: Produce a RxPlayer bundle (a single JS file containing the RxPlayer).

Usage: node run_bundler.mjs <INPUT FILE> [OPTIONS]

Available options:
  -h, --help                  Display this help message.
  -o <PATH>, --output <PATH>  Mandatory: Specify the output file.
  -m, --minify                Minify the built bundle.
  -p, --production-mode       Build all files in production mode (less runtime checks, mostly).
  -g, --globals               Add the RxPlayer to the global scope.
  -s, --silent                Don't log to stdout/stderr when bundling.
  -w, --watch                 Re-build each time any of the files depended on changed.`,
  );
}
