const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const appJsonPath = path.join(rootDir, 'app.json');

if (!fs.existsSync(appJsonPath)) {
  console.error('[sync-app-name] app.json not found at:', appJsonPath);
  process.exit(1);
}

const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
const appName = appJson.displayName || appJson.name || 'EWallet';

let changesCount = 0;

// 1. Sync Android strings.xml
const androidStringsPath = path.join(rootDir, 'android/app/src/main/res/values/strings.xml');
if (fs.existsSync(androidStringsPath)) {
  const content = fs.readFileSync(androidStringsPath, 'utf8');
  const updated = content.replace(
    /<string name="app_name">.*?<\/string>/,
    `<string name="app_name">${appName}</string>`
  );
  if (content !== updated) {
    fs.writeFileSync(androidStringsPath, updated, 'utf8');
    console.log(`[sync-app-name] Updated Android strings.xml -> "${appName}"`);
    changesCount++;
  }
}

// 2. Sync iOS Info.plist
const iosPlistPath = path.join(rootDir, 'ios/CWallet/Info.plist');
if (fs.existsSync(iosPlistPath)) {
  const content = fs.readFileSync(iosPlistPath, 'utf8');
  const updated = content.replace(
    /(<key>CFBundleDisplayName<\/key>\s*<string>)(.*?)(<\/string>)/,
    `$1${appName}$3`
  );
  if (content !== updated) {
    fs.writeFileSync(iosPlistPath, updated, 'utf8');
    console.log(`[sync-app-name] Updated iOS Info.plist -> "${appName}"`);
    changesCount++;
  }
}

// 3. Sync iOS LaunchScreen.storyboard
const storyboardPath = path.join(rootDir, 'ios/CWallet/LaunchScreen.storyboard');
if (fs.existsSync(storyboardPath)) {
  const content = fs.readFileSync(storyboardPath, 'utf8');
  const updated = content.replace(
    /(<label [^>]*id="GJd-Yh-RWb"[^>]*text=")(.*?)(")/,
    `$1${appName}$3`
  ).replace(
    /(<label [^>]*text=")(.*?)("[^>]*id="GJd-Yh-RWb")/,
    `$1${appName}$3`
  );
  if (content !== updated) {
    fs.writeFileSync(storyboardPath, updated, 'utf8');
    console.log(`[sync-app-name] Updated iOS LaunchScreen.storyboard -> "${appName}"`);
    changesCount++;
  }
}

if (changesCount === 0) {
  console.log(`[sync-app-name] All native configs already in sync with app.json ("${appName}")`);
}

