#!/usr/bin/env node
/**
 * # update_changelog.mjs
 *
 * This file tries to automatically update our `CHANGELOG.md` file, by relying
 * on the `version` given as argument and on the body of merge commits added
 * since the last time `CHANGELOG.md` was updated according to `git`.
 * Because there may be a lot of false positives and negatives with this method,
 * `CHANGELOG.md`` is then opened with the program referenced by the `$EDITOR`
 * environment variable so the user can perform ajustments.
 *
 * You can either run it directly as a script (run `node update_changelog.mjs -h`
 * to see the different options) or by requiring it as a node module.
 * If doing the latter you will obtain a function you will have to run with the
 * right options.
 */

import * as fs from "fs";
import readline from "readline";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { exec } from "child_process";

const currentDir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CHANGELOG_PATH = join(currentDir, "..", "CHANGELOG.md");

const NOTICE_OPENER_CLOSER = "---";
const NOTICE_PREFIX = `⚠️  The following "proposed additional changelog lines" were automatically
generated by our script by listing all merge commits since that file's last
updates.
It may have missed some.

You're expected to categorize, when pertinent, the following lines (and possibly
the other features we missed) by adding them into categories (\`# Features\` etc.),
like done for other versions below.
You're free to reword them so it make more sense in this changelog.

Once done, don't forget to remove this notice before exiting your editor.
The resulting file will be the one commited.

### Proposed additional changelog lines:
`;

// If true, this script is called directly
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = process.argv.slice(2);

  let version;
  let isDevRelease = false;
  for (const option of options) {
    if (option.startsWith("-")) {
      if (option === "-d" || option === "-dev") {
        isDevRelease = true;
      } else if (option === "-h" || option === "--help") {
        displayHelp();
        process.exit(0);
      } else {
        console.error("ERROR: Unrecognized option:", option);
        console.error(
          "More details on usage by calling node update_changelog.mjs --help",
        );
        process.exit(1);
      }
    } else if (version === undefined) {
      version = option;
    } else {
      console.error("ERROR: Unrecognized option:", option);
      console.error("More details on usage by calling node update_changelog.mjs --help");
      process.exit(1);
    }
  }

  if (version === undefined) {
    console.error("ERROR: Missing version argument.");
    console.error("More details on usage by calling node update_changelog.mjs --help");
    process.exit(1);
  }

  try {
    const version = process.argv[2];
    updateChangelog({ version, isDevRelease }).catch((err) => {
      console.error("ERROR:", err);
      process.exit(1);
    });
  } catch (err) {
    console.error("ERROR:", err);
    process.exit(1);
  }
}

/**
 * @param {Object} arg
 * @param {string} arg.version - The version you want to add to the changelog
 * @param {boolean} arg.isDevRelease - If `true`, this is only a dev release. It
 * will have a special syntax in the changelog.
 * @returns {Promise}
 */
export default async function updateChangelog({
  version,
  isDevRelease,
  changelogPath = DEFAULT_CHANGELOG_PATH,
}) {
  console.log(`Trying to automatically update the CHANGELOG at: ${changelogPath}`);
  const readStream = fs.createReadStream(changelogPath);
  const newTopH2 = isDevRelease ? `## Current dev build: v${version}` : `## v${version}`;

  let currentData = "";
  for await (const chunk of readStream) {
    currentData += String(chunk);

    let offset = 0;

    // Skip whitespace at the very beginning
    offset = skipWhileChar(currentData, offset, [" ", "\n", "\r"]);
    if (currentData.length <= offset + 2) {
      continue;
    }

    // Skip h1
    {
      assert(
        currentData.slice(offset, offset + 2) === "# ",
        `Unexpected characters "${currentData.slice(offset, offset + 2)}", ` +
          `where we would have expected a Markdown h1 ("# "), ` +
          `encountered at position ${offset} in "${changelogPath}"`,
      );
      offset += 2;

      // We don't care about the chapter content, skipt until it and a newline is encountered
      offset = skipUntilChar(currentData, offset, ["\n", "\r"]);
      offset = skipWhileChar(currentData, offset, ["\n", "\r"]);
    }

    // Skip everything until a header is encountered
    while (true) {
      offset = skipUntilChar(currentData, offset, ["#"]);
      if (currentData[offset] === undefined) {
        break;
      }
      let rewindingOffset = offset - 1;
      while (currentData[rewindingOffset] === " ") {
        rewindingOffset--;
      }
      if (
        currentData[rewindingOffset] === "\n" ||
        currentData[rewindingOffset] === "\r"
      ) {
        break;
      }
      offset += 1;
    }

    if (currentData.length <= offset + 3) {
      continue;
    }

    assert(
      currentData.slice(offset, offset + 3) === "## ",
      `Unexpected chars in "${changelogPath}" at position ${offset}: ` +
        currentData.slice(offset, offset + 3),
    );

    /** Hypothetical h2 offset if we were to prepend it to the current h2. */
    let prependTopH2Offset = offset;
    prependTopH2Offset--;
    while (currentData[prependTopH2Offset] === " ") {
      prependTopH2Offset--;
    }
    assert(
      currentData[prependTopH2Offset] === "\n" ||
        currentData[prependTopH2Offset] === "\r",
      `Unexpected char found when rewiding: ${currentData[prependTopH2Offset]}.`,
    );

    const topH2Offset = offset;
    offset += 3;
    offset = skipWhileChar(currentData, offset, [" "]);
    if (currentData[offset] === undefined) {
      continue;
    } else if (currentData[offset] === "v") {
      // A version is directly entered at that point
      // Try to find the end of the SEMVER version entered
      offset = skipUntilChar(currentData, offset, [" ", "\n", "\r"]);
      if (currentData[offset] !== undefined) {
        let defaultBehavior;
        const currentTopVersionNumber = currentData.slice(offset + 1, offset);
        const previousTopH2 = currentData.slice(topH2Offset, offset);
        if (version !== currentTopVersionNumber) {
          // That's not the one we want, add version on top in the preceding lines
          console.log("");
          console.warn("Top h2 in CHANGELOG.md seems to be for another version.");
          defaultBehavior = "prepend";
        } else if (currentData.slice(topH2Offset, offset) !== newTopH2) {
          console.log("");
          console.warn(
            "Top h2 in CHANGELOG.md was the same version but needs to be replaced.",
          );
          defaultBehavior = "replace";
        } else {
          console.log("Top h2 in CHANGELOG.md was already the version wanted.");
          defaultBehavior = "replace";
        }
        const behavior = await checkUpdateTypeWithUser(
          previousTopH2,
          newTopH2,
          defaultBehavior,
        );
        if (behavior === "abort") {
          return;
        } else if (behavior === "prepend") {
          await writeChangelogFile({
            changelogPath,
            readStream,
            alreadyReadData: currentData,
            newH2: newTopH2,
            baseOffset: prependTopH2Offset,
            replacingLength: 0,
          });
        } else {
          await writeChangelogFile({
            changelogPath,
            readStream,
            alreadyReadData: currentData,
            newH2: newTopH2,
            baseOffset: topH2Offset,
            replacingLength: previousTopH2.length,
          });
        }
        return;
      }
    } else {
      offset = skipUntilChar(currentData, offset, ["\n", "\r"]);
      if (currentData[offset] !== undefined) {
        const previousTopH2 = currentData.slice(topH2Offset, offset);
        if (previousTopH2 === newTopH2) {
          console.log("");
          console.log("Top h2 in CHANGELOG.md was already the one wanted.");
        } else {
          console.log("");
          console.warn("Replacing previous top h2 in CHANGELOG.md.");
        }
        const behavior = await checkUpdateTypeWithUser(
          previousTopH2,
          newTopH2,
          "replace",
        );
        if (behavior === "abort") {
          return;
        } else if (behavior === "prepend") {
          await writeChangelogFile({
            changelogPath,
            readStream,
            alreadyReadData: currentData,
            newH2: newTopH2,
            baseOffset: prependTopH2Offset,
            replacingLength: 0,
          });
        } else {
          await writeChangelogFile({
            changelogPath,
            readStream,
            alreadyReadData: currentData,
            newH2: newTopH2,
            baseOffset: topH2Offset,
            replacingLength: previousTopH2.length,
          });
        }
        return;
      }
    }
  }
  throw new Error(`Did not find where to put new release in ${changelogPath}: `);
}

/**
 * Check with the user whether we should replace the previous Markdown h2 found
 * inside the Changelog (`previousTopH2`) by our new h2 (`newTopH2`) or prepend
 * the new one relative to the old one.
 *
 * @param {string} previousTopH2 - The previous first h2 encountered in the
 * changelog.
 * @param {string} newTopH2 - The new h2 that should be put in the changelog.
 * @param {string} defaultBehaviour - The default behavior that should be taken.
 * Can be set to one of:
 *   - `"replace"`: `newTopH2` will replace `previousTopH2` by default
 *   - `"prepend"`: `newTopH2` will come before `previousTopH2` by default
 * @returns {Promise.<string>} - Promise resolving with the actual behavior to
 * take. Can be one of:
 *   - `"abort"`: Nothing should be done.
 *   - `"replace"`: `newTopH2` should replace `previousTopH2`.
 *   - `"prepend"`: `newTopH2` should come before `previousTopH2`.
 */
async function checkUpdateTypeWithUser(previousTopH2, newTopH2, defaultBehaviour) {
  assert(["replace", "prepend"].includes(defaultBehaviour), "Invalid `defaultBehaviour`");
  if (defaultBehaviour === "replace" && previousTopH2 !== newTopH2) {
    console.log("-");
    console.log(`replacing: "${previousTopH2}"`);
    console.log(`     with: "${newTopH2}"`);
    console.log("-");
    console.log("");
  }
  if (defaultBehaviour === "prepend") {
    console.log("-");
    console.log(`previous top h2: "${previousTopH2}"`);
    console.log(`     new top h2: "${newTopH2}"`);
    console.log("-");
    console.log("");
    console.log(
      "We will assume that the previous one was for a previous version and " +
        "prepend the new version on top.",
    );
  }
  const res = await readChar("Is this OK? [Y/n] ");
  switch (res.toLowerCase()) {
    case "":
    case "y":
    case "yes":
      console.log("Writing CHANGELOG.md...");
      return defaultBehaviour;
    case "n":
    case "no":
      console.log("");
      console.log("What do you want to do:");
      console.log(`  a: abort CHANGELOG.md modification`);
      console.log(
        `  r: replace previous top h2 (${previousTopH2}) with the one wanted (${newTopH2})`,
      );
      console.log(
        `  p: Put new h2 (${newTopH2}) before previous top h2 (${previousTopH2})`,
      );
      const res2 = await readChar("Your choice? [a/r/p] ");
      switch (res2.toLowerCase()) {
        case "":
        case "a":
        case "abort":
          console.warn("aborting CHANGELOG.md modification.");
          return "abort";
        case "r":
        case "replace":
          console.log("Writing CHANGELOG.md (replacing top h2)...");
          return "replace";
        case "p":
        case "prepend":
        case "put":
          console.log("Writing CHANGELOG.md (prepending h2)...");
          return "prepend";
        default:
          console.warn("Invalid input, aborting CHANGELOG.md mmodification.");
          return "abort";
      }
    default:
      console.warn("Invalid input, aborting CHANGELOG.md modification.");
      return "abort";
  }
}

/**
 * @param {string} args.changelogPath - Absolute path for the changelog file.
 * @param {fs.ReadStream} args.readStream - The `ReadStream` used to read the
 * changelog file.
 * @param {string} args.alreadyReadData - The already read data at the beginning
 * of the `readStream`.
 * @param {string} args.newH2 - The new Markdown h2 line to put inside
 * `changelogPath`. It might be followed by more generated lines listing updates
 * performed in the corresponding release.
 * @param {number} args.baseOffset - The offset in the string in `alreadyReadData
 * at which `newH2` should be put inside `changelogPath`.
 * @param {number} args.replacingLength - If set to a value superior to `0`, we
 * will remove everything that was in `changelogPath` between the `baseOffset`
 * and `baseOffset + replacingLength` offsets (in terms of JS Strings.
 * You want to set this value if you want to replace text from the previous
 * changelog.
 * @returns {Promise}
 */
async function writeChangelogFile({
  changelogPath,
  readStream,
  alreadyReadData,
  newH2,
  baseOffset,
  replacingLength,
}) {
  const lines = await getChangelogLines();

  // NOTE: We cannot directly seek in the write stream because our offset is
  // relative to the string obtained from `readStream`, not the actual byte
  // offset.
  const writeStream = fs.createWriteStream(changelogPath);

  // Prepend same thing that base file
  writeStream.write(alreadyReadData.slice(0, baseOffset));
  writeStream.write(newH2);
  if (lines.length > 0) {
    writeStream.write(
      "\n" +
        "\n" +
        NOTICE_OPENER_CLOSER +
        "\n\n" +
        NOTICE_PREFIX +
        "\n\n" +
        lines.map((l) => "- " + l).join("\n") +
        "\n\n" +
        NOTICE_OPENER_CLOSER,
    );
  }
  if (replacingLength <= 0) {
    writeStream.write("\n");
  }
  const remainingData = alreadyReadData.slice(
    baseOffset + replacingLength,
    alreadyReadData.length,
  );
  writeStream.write(remainingData);

  // TODO: There's surely a more readable and efficient way to do this.
  // I don't know how to browse Node.JS documentation though
  for await (const chunk of readStream) {
    writeStream.write(chunk);
  }
  return new Promise((res, rej) => {
    if (readStream.errored !== null) {
      rej(readStream.errored);
      return;
    }
    if (writeStream.errored !== null) {
      rej(writeStream.errored);
      return;
    }
    readStream.on("error", rej);
    writeStream.on("error", rej);
    writeStream.on("finish", () => {
      writeStream.close();
      res();
    });
  });
}

/**
 * @returns {Promise.<Array.<string>>}
 */
function getChangelogLines() {
  return new Promise((res, rej) => {
    exec(
      // NOTE: We use the NULL byte (%x00 in git syntax) to delimitate commits
      // subject and body because it seems to be forbidden in there.
      'git log --merges --pretty=format:"%x00%s%x00%b" $(git log --pretty=format:"%h" CHANGELOG.md | head -1)..HEAD',
      {},
      (error, stdout) => {
        if (error !== null) {
          rej(new Error("Unexpected error code when calling git-log: " + String(error)));
        }
        const splitted = stdout.split("\0").slice(1);
        if (splitted.length === 0) {
          res([]);
          return;
        }
        assert(
          splitted.length % 2 === 0,
          "Unexpected git-log output, length = " + String(splitted.length),
        );
        const linesToAdd = [];
        for (let i = 0; i < splitted.length; i += 2) {
          const mergeSubject = splitted[i];
          const mergeBody = splitted[i + 1];
          const match = mergeSubject.match(/ #\d+ /);
          if (match !== null) {
            const issueNumber = match[0].trim();
            linesToAdd.push(mergeBody.trim() + ` [${issueNumber}]`);
          }
        }
        res(linesToAdd);
      },
    );
  });
}

/**
 * Increment the offset into string into it points to one of the char provided
 * in `chars`.
 * @param {string} str
 * @param {number} offset
 * @param {Array.<string>} chars
 * @returns {number}
 */
function skipUntilChar(str, offset, chars) {
  while (offset < str.length && !chars.includes(str[offset])) {
    offset++;
  }
  return offset;
}

/**
 * Increment the offset into string into it points to another char than one
 * provided in `chars`.
 * @param {string} str
 * @param {number} offset
 * @param {Array.<string>} chars
 * @returns {number}
 */
function skipWhileChar(str, offset, chars) {
  while (offset < str.length && chars.includes(str[offset])) {
    offset++;
  }
  return offset;
}

/**
 * If the given `cond` is `false` throw an Error with `errorMsg` as a message.
 * @param {boolean} cond
 * @param {string} errorMsg
 */
function assert(cond, errorMsg) {
  if (!cond) {
    throw new Error(errorMsg);
  }
}

/**
 * @param {string} query
 * @returns {Promise.<string>}
 */
async function readChar(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(query, (res) => {
      rl.close();
      resolve(res);
    });
  });
}

/**
 * Display through `console.log` an helping message relative to how to run this
 * script.
 */
function displayHelp() {
  console.log(
    `update_changelog.mjs: Automatically update the CHANGELOG.md file.

Usage: node update_changelog.mjs [OPTIONS] <VERSION>

Options:
-h, --help             Display this help
-d, --dev              This is for a development release`,
  );
}
