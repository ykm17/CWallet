package com.ykm.ewallet

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap

class CardOverlayModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "CardOverlayModule"

    @ReactMethod
    fun canDrawOverlays(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                promise.resolve(Settings.canDrawOverlays(reactContext))
            } else {
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun requestOverlayPermission() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(reactContext)) {
                val intent = Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:${reactContext.packageName}")
                ).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactContext.startActivity(intent)
            }
        } catch (e: Exception) {
            // Fallback to general settings
            try {
                val fallbackIntent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactContext.startActivity(fallbackIntent)
            } catch (_: Exception) {}
        }
    }

    @ReactMethod
    fun showCardOverlay(cardData: ReadableMap, promise: Promise) {
        try {
            val intent = Intent(reactContext, CardOverlayService::class.java).apply {
                putExtra("bankName", cardData.getString("bankName") ?: "")
                putExtra("cardName", cardData.getString("cardName") ?: "")
                putExtra("cardNumber", cardData.getString("cardNumber") ?: "")
                putExtra("last4", cardData.getString("last4") ?: "")
                putExtra("expiry", cardData.getString("expiry") ?: "")
                putExtra("cvv", cardData.getString("cvv") ?: "")
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                reactContext.startForegroundService(intent)
            } else {
                reactContext.startService(intent)
            }

            // Move the app to the background so the user is immediately on their previous app/browser
            val activity: Activity? = currentActivity
            activity?.moveTaskToBack(true)

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("OVERLAY_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun hideCardOverlay() {
        try {
            val intent = Intent(reactContext, CardOverlayService::class.java)
            reactContext.stopService(intent)
        } catch (_: Exception) {}
    }

    @ReactMethod
    fun minimizeApp() {
        try {
            currentActivity?.moveTaskToBack(true)
        } catch (_: Exception) {}
    }
}

