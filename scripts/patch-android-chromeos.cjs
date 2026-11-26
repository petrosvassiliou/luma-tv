#!/usr/bin/env node
/**
 * Patches Tauri v2's generated Android project (`src-tauri/gen/android`) for
 * Googlebook / Chromebook (ChromeOS ARCVM), Android TV, and Android phones/tablets:
 *
 * 1. Sets stable compileSdk = 36, targetSdk = 34, minSdk = 26, and monotonic versionCode.
 * 2. Marks touchscreen/faketouch optional, enables usesCleartextTraffic="true" for HTTP IPTV,
 *    and sets resizeableActivity="true" + full configChanges so window resize/fullscreen never
 *    recreates the Activity.
 * 3. Injects `LumaAndroidWindow` (@JavascriptInterface) into `MainActivity.kt` so Luma's
 *    Fullscreen button toggles true ChromeOS ARCVM / Android OS immersive fullscreen
 *    (hiding captionBar, navigationBars, and statusBars + OnBackPressedCallback exit).
 * 4. Appends R8 / ProGuard keep rules so release APK minification preserves @JavascriptInterface.
 */

const fs = require('fs');
const path = require('path');

const rootDir = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const m = String(pkg.version).match(/^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?/);
const verCode = m
  ? Number(m[1]) * 1000000 +
    Number(m[2]) * 10000 +
    Number(m[3]) * 100 +
    (m[4] ? Number(m[4]) : 99)
  : 80005;

// 1. Patch app/build.gradle.kts
const gradlePath = path.join(
  rootDir,
  'src-tauri/gen/android/app/build.gradle.kts'
);
let gradle = fs.readFileSync(gradlePath, 'utf8');
gradle = gradle.replace(/compileSdk\s*=\s*\d+/g, 'compileSdk = 36');
gradle = gradle.replace(/targetSdk\s*=\s*\d+/g, 'targetSdk = 34');
gradle = gradle.replace(/minSdk\s*=\s*\d+/g, 'minSdk = 26');
gradle = gradle.replace(/versionCode\s*=\s*[^\n]+/g, `versionCode = ${verCode}`);
fs.writeFileSync(gradlePath, gradle);
console.log(
  `Patched build.gradle.kts (compileSdk=36, targetSdk=34, minSdk=26, versionCode=${verCode})`
);

// 2. Patch AndroidManifest.xml
const manifestPath = path.join(
  rootDir,
  'src-tauri/gen/android/app/src/main/AndroidManifest.xml'
);
let manifest = fs.readFileSync(manifestPath, 'utf8');
if (!manifest.includes('android.hardware.touchscreen')) {
  manifest = manifest.replace(
    '<application',
    `    <uses-feature android:name="android.hardware.touchscreen" android:required="false" />\n` +
      `    <uses-feature android:name="android.hardware.faketouch" android:required="false" />\n` +
      `    <uses-feature android:name="android.hardware.type.pc" android:required="false" />\n` +
      `    <application`
  );
}
if (/android:usesCleartextTraffic="[^"]*"/.test(manifest)) {
  manifest = manifest.replace(
    /android:usesCleartextTraffic="[^"]*"/g,
    'android:usesCleartextTraffic="true"'
  );
} else {
  manifest = manifest.replace(
    '<application',
    '<application android:usesCleartextTraffic="true"'
  );
}
if (!manifest.includes('resizeableActivity')) {
  manifest = manifest.replace(
    '<activity',
    '<activity android:resizeableActivity="true"'
  );
}
const desiredConfigChanges =
  'orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode';
if (!manifest.includes('smallestScreenSize')) {
  if (/android:configChanges="[^"]*"/.test(manifest)) {
    manifest = manifest.replace(
      /android:configChanges="[^"]*"/g,
      `android:configChanges="${desiredConfigChanges}"`
    );
  } else {
    manifest = manifest.replace(
      '<activity',
      `<activity android:configChanges="${desiredConfigChanges}"`
    );
  }
}
fs.writeFileSync(manifestPath, manifest);
console.log('Patched AndroidManifest.xml for Chromebook & HTTP IPTV compatibility.');

// 3. Patch MainActivity.kt with LumaAndroidWindow immersive fullscreen bridge
function findMainActivity(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findMainActivity(full);
      if (found) return found;
    } else if (entry.name === 'MainActivity.kt') {
      return full;
    }
  }
  return null;
}

const javaSrcRoot = path.join(
  rootDir,
  'src-tauri/gen/android/app/src/main/java'
);
const mainActivityPath = findMainActivity(javaSrcRoot);
if (!mainActivityPath) {
  throw new Error(`MainActivity.kt not found under ${javaSrcRoot}`);
}
const origMain = fs.readFileSync(mainActivityPath, 'utf8');
const pkgMatch = origMain.match(/^package\s+([^\s]+)/m);
const androidPkg = pkgMatch ? pkgMatch[1] : 'app.lumatv.client';

const patchedMain = `package ${androidPkg}

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback

class MainActivity : TauriActivity() {
  @Volatile
  private var lumaImmersiveFullscreen: Boolean = false
  private var lumaWebView: WebView? = null
  private var fullscreenBackCallback: OnBackPressedCallback? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val callback = object : OnBackPressedCallback(false) {
      override fun handleOnBackPressed() {
        applyLumaFullscreen(false, notifyJs = true)
      }
    }
    fullscreenBackCallback = callback
    onBackPressedDispatcher.addCallback(this, callback)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    lumaWebView = webView
    webView.addJavascriptInterface(LumaWindowBridge(), "LumaAndroidWindow")
  }

  private fun applyLumaFullscreen(enabled: Boolean, notifyJs: Boolean) {
    lumaImmersiveFullscreen = enabled
    runOnUiThread {
      fullscreenBackCallback?.isEnabled = enabled
      val win = window ?: return@runOnUiThread
      val decor = win.decorView

      if (enabled) {
        win.addFlags(
          WindowManager.LayoutParams.FLAG_FULLSCREEN or
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          win.setDecorFitsSystemWindows(false)
          win.insetsController?.let { controller ->
            controller.hide(WindowInsets.Type.systemBars())
            controller.systemBarsBehavior =
              WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
          }
        }
        @Suppress("DEPRECATION")
        decor.systemUiVisibility = (
          View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_FULLSCREEN
        )
      } else {
        win.clearFlags(
          WindowManager.LayoutParams.FLAG_FULLSCREEN or
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          win.setDecorFitsSystemWindows(true)
          win.insetsController?.show(WindowInsets.Type.systemBars())
        }
        @Suppress("DEPRECATION")
        decor.systemUiVisibility = View.SYSTEM_UI_FLAG_VISIBLE
      }

      if (notifyJs) {
        val stateLiteral = if (enabled) "true" else "false"
        lumaWebView?.evaluateJavascript(
          "window.dispatchEvent(new CustomEvent('luma-native-fullscreen-change',{detail:{fullscreen:$stateLiteral}}));",
          null
        )
      }
    }
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus && lumaImmersiveFullscreen) {
      applyLumaFullscreen(true, notifyJs = false)
    }
  }

  inner class LumaWindowBridge {
    @JavascriptInterface
    fun setFullscreen(enabled: Boolean) {
      applyLumaFullscreen(enabled, notifyJs = true)
    }

    @JavascriptInterface
    fun toggleFullscreen(): Boolean {
      val next = !lumaImmersiveFullscreen
      applyLumaFullscreen(next, notifyJs = true)
      return next
    }

    @JavascriptInterface
    fun isFullscreen(): Boolean = lumaImmersiveFullscreen

    @JavascriptInterface
    fun openCastSettings(): Boolean {
      return try {
        val castIntent = Intent(Settings.ACTION_CAST_SETTINGS).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        startActivity(castIntent)
        true
      } catch (_: Exception) {
        false
      }
    }

    @JavascriptInterface
    fun launchExternalCastChooser(
      streamUrl: String,
      title: String,
      mimeType: String
    ): Boolean {
      val trimmed = streamUrl.trim()
      if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
        return false
      }
      return try {
        val viewIntent = Intent(Intent.ACTION_VIEW).apply {
          setDataAndType(Uri.parse(trimmed), mimeType.ifBlank { "application/x-mpegurl" })
          putExtra(Intent.EXTRA_TITLE, title)
          putExtra("title", title)
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        val chooser = Intent.createChooser(viewIntent, "Cast or Play: $title").apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        startActivity(chooser)
        true
      } catch (_: Exception) {
        false
      }
    }
  }
}
`;

fs.writeFileSync(mainActivityPath, patchedMain);
console.log(
  `Patched ${path.relative(rootDir, mainActivityPath)} with LumaAndroidWindow immersive fullscreen bridge.`
);

// 4. Preserve @JavascriptInterface methods under R8 / ProGuard release minification
const proguardPath = path.join(
  rootDir,
  'src-tauri/gen/android/app/proguard-rules.pro'
);
const keepRules = [
  '',
  '# Keep LumaAndroidWindow JavascriptInterface methods in release builds',
  '-keepattributes JavascriptInterface',
  '-keepclassmembers class * {',
  '    @android.webkit.JavascriptInterface <methods>;',
  '}',
  '-keep class **.MainActivity$LumaWindowBridge { *; }',
  '',
].join('\n');

if (fs.existsSync(proguardPath)) {
  const existingPro = fs.readFileSync(proguardPath, 'utf8');
  if (!existingPro.includes('LumaWindowBridge')) {
    fs.writeFileSync(proguardPath, existingPro + keepRules);
  }
} else {
  fs.writeFileSync(proguardPath, keepRules);
}
console.log('Patched proguard-rules.pro with JavascriptInterface keep rules.');
