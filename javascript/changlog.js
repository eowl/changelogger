import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const config = {};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pkgName = process.argv[2];

function deriveBaseUrl() {
  try {
    const remoteUrl = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
    let url = remoteUrl;
    const sshMatch = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
    if (sshMatch) {
      return `https://${sshMatch[1]}/${sshMatch[2]}`;
    }
    url = url.replace(/\.git$/, '');
    return url;
  } catch {
    console.error('Warning: Cannot derive baseUrl from git remote. PR links may be incorrect.');
    return '';
  }
}

const baseUrl = config.baseUrl || deriveBaseUrl();
const tagFormat = config.tagFormat || (pkgName ? `${pkgName}@*` : 'v*');
const changelogPath = config.changelogPath || (pkgName
  ? path.join('packages', pkgName, 'CHANGELOG.md')
  : path.join(__dirname, 'CHANGELOG.md'));

if (pkgName) {
  const pkgDir = path.join(__dirname, 'packages', pkgName);
  if (!fs.existsSync(pkgDir)) {
    console.error(`Error: Directory not found: ${pkgDir}. Please check the package name.`);
    process.exit(1);
  }
  console.log(`Analyzing package: ${pkgName}...`);
} else {
  console.log('Running in single-package mode (no package argument provided).');
}

try {
  console.log(`Fetching latest tags from remote...`);
  execSync('git fetch origin --tags', { stdio: 'ignore' });

  const tagCmd = `git tag --list "${tagFormat}" --sort=-v:refname`;
  const tags = execSync(tagCmd, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);

  if (tags.length === 0) {
    console.error(`Warning: No tags matching "${tagFormat}" found. Cannot compare against a baseline version.`);
    process.exit(1);
  }

  const PREV_TAG = tags[0];
  console.log(`Found previous release tag: ${PREV_TAG}`);

  const pathFilter = pkgName ? ` -- "packages/${pkgName}"` : '';
  const logCmd = `git log ${PREV_TAG}..HEAD --merges --first-parent --format="---COMMIT---%n%s%n%b%n%an"${pathFilter}`;
  const logOutput = execSync(logCmd, { encoding: 'utf8' }).trim();

  let markdownLines = [];

  if (logOutput) {
    const commits = logOutput.split('---COMMIT---\n').filter(Boolean);

    commits.forEach(rawCommit => {
        const lines = rawCommit.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length < 2) return;

        const subject = lines[0];
        const author = lines[lines.length - 1].trim().toLowerCase();

        let prTitle = lines.length > 2 && !lines[1].startsWith('Merge pull request') ? lines[1] : subject;
        const prMatch = subject.match(/Merge pull request #(\d+)/i);

        if (prMatch) {
            const prNumber = prMatch[1];
            const prLink = `[#${prNumber}](${baseUrl}/pull/${prNumber})`;
            markdownLines.push(`* ${prTitle} by @${author} in ${prLink}`);
        } else {
            markdownLines.push(`* ${subject} by @${author}`);
        }
    });
  }

  const currentDate = new Date().toISOString().split('T')[0];
  let markdownText = `\n## [Unreleased] ${currentDate}\n\n`;
  markdownText += `### What's Changed\n`;

  if (markdownLines.length > 0) {
    markdownText += markdownLines.join('\n') + '\n';
  } else {
    markdownText += `* No new pull requests merged in this package.\n`;
  }
  markdownText += `\n**Full Changelog**: ${baseUrl}/compare/${PREV_TAG}...[Unreleased]\n`;

  const title = pkgName ? `# ${pkgName} Changelog\n` : `# Changelog\n`;

  if (fs.existsSync(changelogPath)) {
    let existingContent = fs.readFileSync(changelogPath, 'utf8');

    const unreleasedRegex = /##\s*\[Unreleased\][\s\S]*?(?=\n##\s*\[|$)/i;

    if (unreleasedRegex.test(existingContent)) {
      existingContent = existingContent.replace(unreleasedRegex, markdownText.trim());
      fs.writeFileSync(changelogPath, existingContent, 'utf8');
      console.log(`Found an existing [Unreleased] section. Successfully updated: ${changelogPath}`);
    } else {
      fs.writeFileSync(changelogPath, markdownText + '\n' + existingContent, 'utf8');
      console.log(`No [Unreleased] section found. Successfully prepended a new section: ${changelogPath}`);
    }
  } else {
    fs.writeFileSync(changelogPath, title + markdownText, 'utf8');
    console.log(`Created and wrote changelog file: ${changelogPath}`);
  }

} catch (error) {
  console.error("Execution failed. Error message:", error.message);
  process.exit(1);
}
