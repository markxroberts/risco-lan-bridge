const fs = require('node:fs');
const { version } = require('../package.json');
const tag = process.env.RELEASE_TAG;
if (tag !== version) {
  const message = `Release tag ${JSON.stringify(tag)} does not match package.json version ${JSON.stringify(version)}. Update the package and lockfile, then create the release from that commit.`;
  console.error(`::error title=Release version mismatch::${message}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
  process.exitCode = 1;
} else {
  console.log(`Release version verified: ${version}`);
}
