#!/usr/bin/env node
/**
 * Patches Tauri v2's generated Android project (`src-tauri/gen/android`) for
 * Googlebook / Chromebook (ChromeOS ARCVM), Android TV, and Android phones/tablets:
 *
 * 1. Sets stable compileSdk = 36, targetSdk = 34, minSdk = 26, monotonic versionCode,
 *    and adds Official Google Cast Framework (`play-services-cast-framework:22.0.0`) +
 *    `androidx.mediarouter:mediarouter:1.7.0`.
 * 2. Adds Wi-Fi / Multicast discovery permissions, registers `LumaCastOptionsProvider`,
 *    marks touchscreen/faketouch optional, enables usesCleartextTraffic="true" for HTTP IPTV,
 *    and sets resizeableActivity="true" + full configChanges.
 * 3. Writes `LumaCastOptionsProvider.kt` and injects `LumaAndroidWindow` (@JavascriptInterface)
 *    into `MainActivity.kt` for:
 *    - True ChromeOS ARCVM / Android OS immersive fullscreen + Back-gesture exit
 *    - Automatic Wi-Fi network discovery of Chromecast / Google TV / Android TV (`MediaRouter`
 *      active scan + `CastContext`) and AirPlay / LAN devices (`NsdManager` + `MulticastLock`),
 *      plus direct `RemoteMediaClient.load()` streaming without any external app chooser.
 * 4. Appends R8 / ProGuard keep rules so release APK minification preserves @JavascriptInterface
 *    and `LumaCastOptionsProvider`.
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
  : 80009;

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

if (!gradle.includes('play-services-cast-framework')) {
  gradle = gradle.replace(
    'dependencies {',
    `dependencies {\n` +
      `    implementation("androidx.mediarouter:mediarouter:1.7.0")\n` +
      `    implementation("com.google.android.gms:play-services-cast-framework:22.0.0")`
  );
}
fs.writeFileSync(gradlePath, gradle);
console.log(
  `Patched build.gradle.kts (compileSdk=36, targetSdk=34, minSdk=26, versionCode=${verCode}, Google Cast SDK 22.0.0)`
);

// Locate MainActivity.kt early so we know the exact Android package name
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
const mainDir = path.dirname(mainActivityPath);

// 2. Patch AndroidManifest.xml
const manifestPath = path.join(
  rootDir,
  'src-tauri/gen/android/app/src/main/AndroidManifest.xml'
);
let manifest = fs.readFileSync(manifestPath, 'utf8');

if (!manifest.includes('CHANGE_WIFI_MULTICAST_STATE')) {
  manifest = manifest.replace(
    '<uses-permission android:name="android.permission.INTERNET" />',
    `<uses-permission android:name="android.permission.INTERNET" />\n` +
      `    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />\n` +
      `    <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />\n` +
      `    <uses-permission android:name="android.permission.CHANGE_WIFI_MULTICAST_STATE" />`
  );
}

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

if (!manifest.includes('OPTIONS_PROVIDER_CLASS_NAME')) {
  manifest = manifest.replace(
    '</application>',
    `        <meta-data\n` +
      `            android:name="com.google.android.gms.cast.framework.OPTIONS_PROVIDER_CLASS_NAME"\n` +
      `            android:value="${androidPkg}.LumaCastOptionsProvider" />\n` +
      `    </application>`
  );
}

fs.writeFileSync(manifestPath, manifest);
console.log(
  'Patched AndroidManifest.xml with Wi-Fi Multicast permissions, CastOptionsProvider, and Chromebook support.'
);

// 3a. Write LumaCastOptionsProvider.kt alongside MainActivity.kt
const castProviderPath = path.join(mainDir, 'LumaCastOptionsProvider.kt');
const castProviderKotlin = `package ${androidPkg}

import android.content.Context
import com.google.android.gms.cast.CastMediaControlIntent
import com.google.android.gms.cast.framework.CastOptions
import com.google.android.gms.cast.framework.OptionsProvider
import com.google.android.gms.cast.framework.SessionProvider

class LumaCastOptionsProvider : OptionsProvider {
  override fun getCastOptions(context: Context): CastOptions {
    return CastOptions.Builder()
      .setReceiverApplicationId(CastMediaControlIntent.DEFAULT_MEDIA_RECEIVER_APPLICATION_ID)
      .build()
  }

  override fun getAdditionalSessionProviders(context: Context): MutableList<SessionProvider>? = null
}
`;
fs.writeFileSync(castProviderPath, castProviderKotlin);
console.log(`Created ${path.relative(rootDir, castProviderPath)}.`);

// 3b. Patch MainActivity.kt with LumaAndroidWindow fullscreen + native Cast/NSD network scanner
const patchedMain = `package ${androidPkg}

import android.app.UiModeManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.core.content.ContextCompat
import androidx.mediarouter.media.MediaRouteSelector
import androidx.mediarouter.media.MediaRouter
import com.google.android.gms.cast.CastMediaControlIntent
import com.google.android.gms.cast.MediaInfo
import com.google.android.gms.cast.MediaLoadRequestData
import com.google.android.gms.cast.MediaMetadata
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.CastSession
import com.google.android.gms.cast.framework.SessionManagerListener
import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.util.ArrayDeque
import java.util.concurrent.ConcurrentHashMap

class MainActivity : TauriActivity() {
  private data class PendingCastLoad(
    val streamUrl: String,
    val title: String,
    val subtitle: String,
    val mimeType: String,
    val isLive: Boolean,
    val positionSec: Double
  )

  @Volatile
  private var lumaImmersiveFullscreen: Boolean = false
  private var isTvDevice: Boolean = false
  private var tvImeWasVisible: Boolean = false
  private var lumaWebView: WebView? = null
  private var fullscreenBackCallback: OnBackPressedCallback? = null
  private val mainHandler = Handler(Looper.getMainLooper())

  private fun detectTelevisionDevice(): Boolean {
    return try {
      val uiModeManager = getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
      val isTvMode = uiModeManager?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION
      val hasLeanback = packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
      val isChromeOs = packageManager.hasSystemFeature("org.chromium.arc") ||
        packageManager.hasSystemFeature("org.chromium.arc.device_management")
      (isTvMode || hasLeanback) && !isChromeOs
    } catch (_: Throwable) {
      false
    }
  }

  // Native Google Cast & MediaRouter Discovery State
  private var mediaRouter: MediaRouter? = null
  private var routeSelector: MediaRouteSelector? = null
  private var castContext: CastContext? = null
  private var castScannerAttached: Boolean = false
  private var sessionListenerAttached: Boolean = false
  private var pendingCastLoad: PendingCastLoad? = null
  @Volatile
  private var connectedCastDeviceName: String? = null
  @Volatile
  private var latestCastSnapshotJson: String = "{\\"devices\\":[],\\"connectedDeviceName\\":null}"

  // NSD (_airplay._tcp & _googlecast._tcp) + MulticastLock State
  private var multicastLock: WifiManager.MulticastLock? = null
  private var nsdManager: NsdManager? = null
  private var airplayDiscoveryListener: NsdManager.DiscoveryListener? = null
  private var googlecastDiscoveryListener: NsdManager.DiscoveryListener? = null
  private val nsdResolveQueue = ArrayDeque<NsdServiceInfo>()
  private var nsdResolving: Boolean = false
  private val nsdDiscoveredDevices = ConcurrentHashMap<String, JSONObject>()

  private val mediaRouterCallback = object : MediaRouter.Callback() {
    override fun onRouteAdded(router: MediaRouter, route: MediaRouter.RouteInfo) {
      pushCastUpdateToJs()
    }

    override fun onRouteChanged(router: MediaRouter, route: MediaRouter.RouteInfo) {
      pushCastUpdateToJs()
    }

    override fun onRouteRemoved(router: MediaRouter, route: MediaRouter.RouteInfo) {
      pushCastUpdateToJs()
    }

    override fun onRouteSelected(router: MediaRouter, route: MediaRouter.RouteInfo, reason: Int) {
      connectedCastDeviceName = route.name
      pushCastUpdateToJs()
    }

    override fun onRouteUnselected(router: MediaRouter, route: MediaRouter.RouteInfo, reason: Int) {
      if (connectedCastDeviceName == route.name) {
        connectedCastDeviceName = null
      }
      pushCastUpdateToJs()
    }
  }

  private val castSessionListener = object : SessionManagerListener<CastSession> {
    override fun onSessionStarting(session: CastSession) {}

    override fun onSessionStarted(session: CastSession, sessionId: String) {
      connectedCastDeviceName = session.castDevice?.friendlyName ?: connectedCastDeviceName
      pendingCastLoad?.let { load ->
        pendingCastLoad = null
        loadMediaIntoSession(session, load)
      }
      pushCastUpdateToJs()
    }

    override fun onSessionStartFailed(session: CastSession, error: Int) {
      notifyCastErrorToJs("Chromecast session failed to start (code $error).")
      pushCastUpdateToJs()
    }

    override fun onSessionEnding(session: CastSession) {}

    override fun onSessionEnded(session: CastSession, error: Int) {
      connectedCastDeviceName = null
      pushCastUpdateToJs()
    }

    override fun onSessionResuming(session: CastSession, sessionId: String) {}

    override fun onSessionResumed(session: CastSession, wasSuspended: Boolean) {
      connectedCastDeviceName = session.castDevice?.friendlyName ?: connectedCastDeviceName
      pendingCastLoad?.let { load ->
        pendingCastLoad = null
        loadMediaIntoSession(session, load)
      }
      pushCastUpdateToJs()
    }

    override fun onSessionResumeFailed(session: CastSession, error: Int) {
      pushCastUpdateToJs()
    }

    override fun onSessionSuspended(session: CastSession, reason: Int) {}
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    isTvDevice = detectTelevisionDevice()
    if (isTvDevice) {
      // Android TV is always full-screen content-first (edge-to-edge + keep screen awake)
      applyLumaFullscreen(true, notifyJs = false)
      window.decorView.viewTreeObserver.addOnGlobalLayoutListener {
        try {
          val r = android.graphics.Rect()
          window.decorView.getWindowVisibleDisplayFrame(r)
          val screenHeight = window.decorView.rootView.height
          val keypadHeight = screenHeight - r.bottom
          val imeNowVisible = screenHeight > 0 && keypadHeight > screenHeight * 0.16
          if (tvImeWasVisible && !imeNowVisible) {
            lumaWebView?.requestFocus()
            lumaWebView?.evaluateJavascript(
              "window.dispatchEvent(new CustomEvent('luma-tv-ime-closed'));",
              null
            )
          }
          tvImeWasVisible = imeNowVisible
        } catch (_: Throwable) {}
      }
      val tvBackCallback = object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
          val wv = lumaWebView
          if (wv != null) {
            wv.evaluateJavascript(
              "(function(){ return window.__lumaHandleAndroidTvBack ? Boolean(window.__lumaHandleAndroidTvBack()) : false; })()"
            ) { result ->
              if (result != "true" && lumaImmersiveFullscreen && !isTvDevice) {
                applyLumaFullscreen(false, notifyJs = true)
              }
            }
          }
        }
      }
      onBackPressedDispatcher.addCallback(this, tvBackCallback)
    } else {
      val callback = object : OnBackPressedCallback(false) {
        override fun handleOnBackPressed() {
          applyLumaFullscreen(false, notifyJs = true)
        }
      }
      fullscreenBackCallback = callback
      onBackPressedDispatcher.addCallback(this, callback)
    }
    initCastSubsystemOnMainThread()
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    lumaWebView = webView
    webView.addJavascriptInterface(LumaWindowBridge(), "LumaAndroidWindow")
    if (isTvDevice) {
      webView.isFocusable = true
      webView.isFocusableInTouchMode = true
      webView.requestFocus()
    }
  }

  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (isTvDevice && event.action == KeyEvent.ACTION_DOWN) {
      val remoteAction: String? = when (event.keyCode) {
        KeyEvent.KEYCODE_CHANNEL_UP -> "channel-up"
        KeyEvent.KEYCODE_CHANNEL_DOWN -> "channel-down"
        KeyEvent.KEYCODE_GUIDE, KeyEvent.KEYCODE_TV_DATA_SERVICE -> "guide"
        KeyEvent.KEYCODE_INFO -> "info"
        KeyEvent.KEYCODE_SEARCH -> "search"
        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
        KeyEvent.KEYCODE_MEDIA_PLAY,
        KeyEvent.KEYCODE_MEDIA_PAUSE -> "play-pause"
        else -> null
      }
      if (remoteAction != null) {
        lumaWebView?.evaluateJavascript(
          "window.dispatchEvent(new CustomEvent('luma-tv-remote-key',{detail:{action:'$remoteAction'}}));",
          null
        )
        return true
      }
    }
    return super.dispatchKeyEvent(event)
  }

  override fun onDestroy() {
    stopNetworkDiscoveryInternal()
    try {
      if (sessionListenerAttached) {
        castContext?.sessionManager?.removeSessionManagerListener(
          castSessionListener,
          CastSession::class.java
        )
        sessionListenerAttached = false
      }
    } catch (_: Throwable) {}
    super.onDestroy()
  }

  private fun initCastSubsystemOnMainThread() {
    runOnUiThread {
      try {
        val category = CastMediaControlIntent.categoryForCast(
          CastMediaControlIntent.DEFAULT_MEDIA_RECEIVER_APPLICATION_ID
        )
        routeSelector = MediaRouteSelector.Builder()
          .addControlCategory(category)
          .build()
        mediaRouter = MediaRouter.getInstance(applicationContext)

        CastContext.getSharedInstance(this, ContextCompat.getMainExecutor(this))
          .addOnSuccessListener { ctx ->
            castContext = ctx
            if (!sessionListenerAttached) {
              ctx.sessionManager.addSessionManagerListener(
                castSessionListener,
                CastSession::class.java
              )
              sessionListenerAttached = true
            }
            ctx.sessionManager.currentCastSession?.castDevice?.friendlyName?.let {
              connectedCastDeviceName = it
            }
            pushCastUpdateToJs()
          }
      } catch (_: Throwable) {
        // Device without Google Play Services falls back seamlessly to NSD + Rust CastV2/AirPlay
      }
    }
  }

  private fun startNetworkDiscoveryInternal() {
    runOnUiThread {
      initCastSubsystemOnMainThread()

      // 1. Acquire Wi-Fi MulticastLock so Android Wi-Fi chip forwards mDNS advertisements
      try {
        if (multicastLock == null) {
          val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
          multicastLock = wifi?.createMulticastLock("luma_tv_cast_discovery")?.apply {
            setReferenceCounted(false)
          }
        }
        if (multicastLock?.isHeld == false) {
          multicastLock?.acquire()
        }
      } catch (_: Throwable) {}

      // 2. Attach active MediaRouter callback for Google Cast receivers
      try {
        val router = mediaRouter
        val selector = routeSelector
        if (router != null && selector != null) {
          if (castScannerAttached) {
            router.removeCallback(mediaRouterCallback)
          }
          router.addCallback(
            selector,
            mediaRouterCallback,
            MediaRouter.CALLBACK_FLAG_PERFORM_ACTIVE_SCAN or
              MediaRouter.CALLBACK_FLAG_REQUEST_DISCOVERY
          )
          castScannerAttached = true
        }
      } catch (_: Throwable) {}

      // 3. Start NSD mDNS discovery for both _airplay._tcp. and _googlecast._tcp.
      try {
        if (nsdManager == null) {
          nsdManager = getSystemService(Context.NSD_SERVICE) as? NsdManager
        }
        startNsdListenerForType("_airplay._tcp.", isAirPlay = true)
        startNsdListenerForType("_googlecast._tcp.", isAirPlay = false)
      } catch (_: Throwable) {}

      pushCastUpdateToJs()
    }
  }

  private fun startNsdListenerForType(serviceType: String, isAirPlay: Boolean) {
    val nsd = nsdManager ?: return
    if (isAirPlay && airplayDiscoveryListener != null) return
    if (!isAirPlay && googlecastDiscoveryListener != null) return

    val listener = object : NsdManager.DiscoveryListener {
      override fun onStartDiscoveryFailed(type: String?, errorCode: Int) {}
      override fun onStopDiscoveryFailed(type: String?, errorCode: Int) {}
      override fun onDiscoveryStarted(type: String?) {}
      override fun onDiscoveryStopped(type: String?) {}

      override fun onServiceFound(serviceInfo: NsdServiceInfo?) {
        if (serviceInfo == null) return
        mainHandler.post {
          nsdResolveQueue.addLast(serviceInfo)
          drainNsdResolveQueue()
        }
      }

      override fun onServiceLost(serviceInfo: NsdServiceInfo?) {
        if (serviceInfo == null) return
        val keysToRemove = nsdDiscoveredDevices
          .filterValues { obj ->
            obj.optString("name").equals(serviceInfo.serviceName.trim(), ignoreCase = true)
          }
          .keys
        for (k in keysToRemove) {
          nsdDiscoveredDevices.remove(k)
        }
        pushCastUpdateToJs()
      }
    }

    try {
      nsd.discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, listener)
      if (isAirPlay) {
        airplayDiscoveryListener = listener
      } else {
        googlecastDiscoveryListener = listener
      }
    } catch (_: Throwable) {}
  }

  private fun drainNsdResolveQueue() {
    if (nsdResolving) return
    val nsd = nsdManager ?: return
    val next = nsdResolveQueue.pollFirst() ?: return
    nsdResolving = true

    try {
      @Suppress("DEPRECATION")
      nsd.resolveService(next, object : NsdManager.ResolveListener {
        override fun onResolveFailed(serviceInfo: NsdServiceInfo?, errorCode: Int) {
          mainHandler.post {
            nsdResolving = false
            drainNsdResolveQueue()
          }
        }

        override fun onServiceResolved(resolved: NsdServiceInfo?) {
          if (resolved != null) {
            @Suppress("DEPRECATION")
            val hostAddr = resolved.host?.hostAddress
            val port = resolved.port
            if (!hostAddr.isNullOrBlank() && !hostAddr.contains(":") && port > 0) {
              val svcType = resolved.serviceType ?: ""
              val isAirPlay = svcType.contains("airplay", ignoreCase = true)
              val proto = if (isAirPlay) "airplay" else "chromecast"
              val attrs = resolved.attributes
              val fnBytes = attrs?.get("fn")
              val mdBytes = attrs?.get("md") ?: attrs?.get("model")
              val friendly = if (fnBytes != null && fnBytes.isNotEmpty()) {
                String(fnBytes, StandardCharsets.UTF_8).trim()
              } else {
                resolved.serviceName.trim()
              }
              val model = if (mdBytes != null && mdBytes.isNotEmpty()) {
                String(mdBytes, StandardCharsets.UTF_8).trim()
              } else if (isAirPlay) {
                "Apple TV / AirPlay"
              } else {
                "Chromecast"
              }

              val key = "lan:$proto:$hostAddr:$port"
              val obj = JSONObject().apply {
                put("id", key)
                put("name", friendly.ifBlank { if (isAirPlay) "Apple TV" else "Chromecast" })
                put("model", model)
                put("protocol", proto)
                put("source", "android-nsd")
                put("host", hostAddr)
                put("port", port)
              }
              nsdDiscoveredDevices[key] = obj
              pushCastUpdateToJs()
            }
          }
          mainHandler.post {
            nsdResolving = false
            drainNsdResolveQueue()
          }
        }
      })
    } catch (_: Throwable) {
      nsdResolving = false
    }
  }

  private fun stopNetworkDiscoveryInternal() {
    runOnUiThread {
      try {
        if (castScannerAttached) {
          mediaRouter?.removeCallback(mediaRouterCallback)
          castScannerAttached = false
        }
      } catch (_: Throwable) {}

      try {
        airplayDiscoveryListener?.let { nsdManager?.stopServiceDiscovery(it) }
      } catch (_: Throwable) {}
      airplayDiscoveryListener = null

      try {
        googlecastDiscoveryListener?.let { nsdManager?.stopServiceDiscovery(it) }
      } catch (_: Throwable) {}
      googlecastDiscoveryListener = null

      nsdResolveQueue.clear()
      nsdResolving = false

      try {
        if (multicastLock?.isHeld == true) {
          multicastLock?.release()
        }
      } catch (_: Throwable) {}
    }
  }

  private fun buildCastStateSnapshot(): JSONObject {
    val devicesArray = JSONArray()
    val seenChromecastNames = HashSet<String>()

    try {
      val router = mediaRouter
      val selector = routeSelector
      if (router != null && selector != null) {
        for (route in router.routes) {
          if (!route.isDefault && !route.isBluetooth && route.isEnabled && route.matchesSelector(selector)) {
            val cleanName = route.name.trim()
            if (cleanName.isNotEmpty()) {
              seenChromecastNames.add(cleanName.lowercase())
              val routeObj = JSONObject().apply {
                put("id", "route:\${route.id}")
                put("name", cleanName)
                put("model", (route.description ?: "Google Cast").trim().ifBlank { "Google Cast" })
                put("protocol", "chromecast")
                put("source", "android-mediarouter")
                put("isSelected", route.isSelected)
              }
              devicesArray.put(routeObj)
            }
          }
        }
      }
    } catch (_: Throwable) {}

    for (nsdObj in nsdDiscoveredDevices.values) {
      val proto = nsdObj.optString("protocol")
      val nameLower = nsdObj.optString("name").trim().lowercase()
      // Avoid listing duplicate Chromecast if MediaRouter already surfaced the same TV
      if (proto == "chromecast" && seenChromecastNames.contains(nameLower)) {
        continue
      }
      devicesArray.put(nsdObj)
    }

    return JSONObject().apply {
      put("devices", devicesArray)
      put("connectedDeviceName", connectedCastDeviceName ?: JSONObject.NULL)
    }
  }

  private fun pushCastUpdateToJs() {
    runOnUiThread {
      val snapshot = buildCastStateSnapshot().toString()
      latestCastSnapshotJson = snapshot
      lumaWebView?.evaluateJavascript(
        "window.dispatchEvent(new CustomEvent('luma-android-cast-update',{detail:$snapshot}));",
        null
      )
    }
  }

  private fun notifyCastErrorToJs(message: String) {
    runOnUiThread {
      val quoted = JSONObject.quote(message)
      lumaWebView?.evaluateJavascript(
        "window.dispatchEvent(new CustomEvent('luma-android-cast-error',{detail:{message:$quoted}}));",
        null
      )
    }
  }

  private fun loadMediaIntoSession(session: CastSession, load: PendingCastLoad) {
    try {
      val metadata = MediaMetadata(MediaMetadata.MEDIA_TYPE_MOVIE).apply {
        putString(MediaMetadata.KEY_TITLE, load.title)
        if (load.subtitle.isNotBlank()) {
          putString(MediaMetadata.KEY_SUBTITLE, load.subtitle)
        }
      }
      val streamType = if (load.isLive) {
        MediaInfo.STREAM_TYPE_LIVE
      } else {
        MediaInfo.STREAM_TYPE_BUFFERED
      }
      val mediaInfo = MediaInfo.Builder(load.streamUrl)
        .setStreamType(streamType)
        .setContentType(load.mimeType.ifBlank { "application/x-mpegurl" })
        .setMetadata(metadata)
        .build()

      val startMs = if (!load.isLive && load.positionSec > 2.0) {
        (load.positionSec * 1000.0).toLong()
      } else {
        0L
      }

      val request = MediaLoadRequestData.Builder()
        .setMediaInfo(mediaInfo)
        .setAutoplay(true)
        .setCurrentTime(startMs)
        .build()

      session.remoteMediaClient?.load(request)
    } catch (e: Throwable) {
      notifyCastErrorToJs(e.message ?: "Failed to load stream on Chromecast.")
    }
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
    if (hasFocus && (lumaImmersiveFullscreen || isTvDevice)) {
      applyLumaFullscreen(true, notifyJs = false)
    }
  }

  inner class LumaWindowBridge {
    @JavascriptInterface
    fun isTelevision(): Boolean = isTvDevice

    @JavascriptInterface
    fun showTvKeyboard() {
      runOnUiThread {
        val wv = lumaWebView ?: return@runOnUiThread
        wv.requestFocus()
        val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
        val shown = imm?.showSoftInput(wv, InputMethodManager.SHOW_IMPLICIT) ?: false
        if (!shown) {
          imm?.showSoftInput(wv, 0)
        }
      }
    }

    @JavascriptInterface
    fun hideTvKeyboard() {
      runOnUiThread {
        val wv = lumaWebView ?: return@runOnUiThread
        val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
        imm?.hideSoftInputFromWindow(wv.windowToken, 0)
      }
    }

    @JavascriptInterface
    fun exitApp() {
      runOnUiThread {
        finish()
      }
    }

    @JavascriptInterface
    fun setFullscreen(enabled: Boolean) {
      if (isTvDevice && !enabled) {
        applyLumaFullscreen(true, notifyJs = false)
        return
      }
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
    fun startCastScan(): String {
      startNetworkDiscoveryInternal()
      return latestCastSnapshotJson
    }

    @JavascriptInterface
    fun stopCastScan() {
      stopNetworkDiscoveryInternal()
    }

    @JavascriptInterface
    fun getCastStateJson(): String {
      pushCastUpdateToJs()
      return latestCastSnapshotJson
    }

    @JavascriptInterface
    fun connectAndCastRoute(
      deviceId: String,
      streamUrl: String,
      title: String,
      subtitle: String,
      mimeType: String,
      isLive: Boolean,
      positionSec: Double
    ): Boolean {
      if (!deviceId.startsWith("route:")) {
        return false
      }
      val rawRouteId = deviceId.removePrefix("route:")
      val load = PendingCastLoad(
        streamUrl = streamUrl.trim(),
        title = title,
        subtitle = subtitle,
        mimeType = mimeType,
        isLive = isLive,
        positionSec = positionSec
      )

      runOnUiThread {
        val router = mediaRouter
        val targetRoute = router?.routes?.firstOrNull { it.id == rawRouteId }
        if (targetRoute == null) {
          notifyCastErrorToJs("Selected Chromecast is no longer available on Wi-Fi.")
          return@runOnUiThread
        }

        val currentSession = castContext?.sessionManager?.currentCastSession
        if (targetRoute.isSelected && currentSession != null && currentSession.isConnected) {
          connectedCastDeviceName = targetRoute.name
          loadMediaIntoSession(currentSession, load)
          pushCastUpdateToJs()
        } else {
          pendingCastLoad = load
          connectedCastDeviceName = targetRoute.name
          router.selectRoute(targetRoute)
          pushCastUpdateToJs()
        }
      }
      return true
    }

    @JavascriptInterface
    fun stopCasting() {
      runOnUiThread {
        pendingCastLoad = null
        connectedCastDeviceName = null
        try {
          castContext?.sessionManager?.endCurrentSession(true)
        } catch (_: Throwable) {}
        try {
          mediaRouter?.unselect(MediaRouter.UNSELECT_REASON_STOPPED)
        } catch (_: Throwable) {}
        pushCastUpdateToJs()
      }
    }
  }
}
`;

fs.writeFileSync(mainActivityPath, patchedMain);
console.log(
  `Patched ${path.relative(rootDir, mainActivityPath)} with LumaAndroidWindow fullscreen + MediaRouter/Cast/NSD network scanner.`
);

// 4. Preserve @JavascriptInterface & LumaCastOptionsProvider under R8 / ProGuard release minification
const proguardPath = path.join(
  rootDir,
  'src-tauri/gen/android/app/proguard-rules.pro'
);
const keepRules = [
  '',
  '# Keep LumaAndroidWindow JavascriptInterface & Google Cast OptionsProvider in release builds',
  '-keepattributes JavascriptInterface',
  '-keepclassmembers class * {',
  '    @android.webkit.JavascriptInterface <methods>;',
  '}',
  '-keep class **.MainActivity$LumaWindowBridge { *; }',
  '-keep class **.LumaCastOptionsProvider { *; }',
  '',
].join('\n');

if (fs.existsSync(proguardPath)) {
  const existingPro = fs.readFileSync(proguardPath, 'utf8');
  if (!existingPro.includes('LumaCastOptionsProvider')) {
    fs.writeFileSync(proguardPath, existingPro + keepRules);
  }
} else {
  fs.writeFileSync(proguardPath, keepRules);
}
console.log(
  'Patched proguard-rules.pro with JavascriptInterface and LumaCastOptionsProvider keep rules.'
);
