<script>
#!/usr/bin/env node

/**
 * PWA Builder – Fetch any URL and build an APK
 * Usage: node build-apk-from-url.js <url>
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');
const http = require('http');
const { promisify } = require('util');
const mkdirp = require('mkdirp');
const { Readable } = require('stream');
const pipeline = promisify(require('stream').pipeline);

// --- Configuration ---
const TARGET_URL = process.argv[2] || 'https://hexsleuth.github.io/hexai_webapp/';
const PROJECT_NAME = 'hexai_webapp';
const OUTPUT_APK = './hexai_webapp-app.apk';

// --- Helper: Download a file ---
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const request = protocol.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: ${response.statusCode}`));
        return;
      }
      const file = fs.createWriteStream(dest);
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
      file.on('error', reject);
    });
    request.on('error', reject);
  });
}

// --- Step 1: Fetch the entire site using `wget` ---
function fetchWebsite(url, destDir) {
  console.log(`🌐 Fetching ${url} ...`);
  // Use wget to mirror the site (handles relative paths, assets, and recursion)
  const command = `wget --mirror --page-requisites --convert-links --adjust-extension --no-parent --directory-prefix=${destDir} ${url}`;
  try {
    execSync(command, { stdio: 'inherit' });
  } catch (err) {
    console.error('❌ wget failed. Make sure wget is installed.');
    process.exit(1);
  }
  // Move the fetched content to a known location
  const domain = new URL(url).hostname;
  const fetchedRoot = path.join(destDir, domain);
  if (!fs.existsSync(fetchedRoot)) {
    console.error('❌ Could not locate fetched content.');
    process.exit(1);
  }
  return fetchedRoot;
}

// --- Step 2: Create Capacitor project ---
function createCapacitorProject(sourceDir) {
  console.log('📦 Creating Capacitor project...');
  const projectDir = path.join(process.cwd(), PROJECT_NAME);
  if (fs.existsSync(projectDir)) {
    console.error(`❌ Directory ${PROJECT_NAME} already exists. Remove it first.`);
    process.exit(1);
  }

  // Use Capacitor CLI to init a new project
  execSync(`npx @capacitor/cli create ${PROJECT_NAME} ${PROJECT_NAME} com.hexai.app`, { stdio: 'inherit' });
  execSync(`cd ${PROJECT_NAME} && npm install @capacitor/android`, { stdio: 'inherit' });

  // Copy fetched web content into the project's `www` folder
  const wwwDir = path.join(projectDir, 'www');
  fs.rmSync(wwwDir, { recursive: true, force: true });
  fs.renameSync(sourceDir, wwwDir);

  // Add Android platform
  execSync(`cd ${PROJECT_NAME} && npx cap add android`, { stdio: 'inherit' });

  return projectDir;
}

// --- Step 3: Build the APK ---
function buildApk(projectDir) {
  console.log('🔨 Building APK...');
  execSync(`cd ${projectDir} && npx cap sync android`, { stdio: 'inherit' });
  execSync(`cd ${projectDir}/android && ./gradlew assembleRelease`, { stdio: 'inherit' });

  // Locate the APK
  const apkPath = path.join(projectDir, 'android/app/build/outputs/apk/release/app-release-unsigned.apk');
  if (!fs.existsSync(apkPath)) {
    console.error('❌ APK not found. Build may have failed.');
    process.exit(1);
  }
  // Sign the APK (optional but recommended) – we'll copy it as is for simplicity
  fs.copyFileSync(apkPath, OUTPUT_APK);
  console.log(`✅ APK generated: ${OUTPUT_APK}`);
}

// --- Main ---
async function main() {
  console.log('🚀 PWA → APK Builder (with URL fetching)\n');

  const tempDir = path.join(process.cwd(), 'temp-fetch');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

  try {
    // 1. Fetch the website
    const fetchedRoot = fetchWebsite(TARGET_URL, tempDir);

    // 2. Create Capacitor project
    const projectDir = createCapacitorProject(fetchedRoot);

    // 3. Build APK
    buildApk(projectDir);

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
    console.log('🧹 Cleanup done.');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
</script>
