package com.ykm.ewallet

import android.app.Activity
import android.content.Intent
import com.facebook.react.bridge.*

class CardScannerModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    private var scanPromise: Promise? = null

    companion object {
        const val REQUEST_CODE_CARD_SCAN = 4022
    }

    init {
        reactContext.addActivityEventListener(this)
    }

    override fun getName(): String = "CardScannerModule"

    @ReactMethod
    fun isCameraSupported(promise: Promise) {
        val packageManager = reactContext.packageManager
        val hasCamera = packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_CAMERA_ANY)
        promise.resolve(hasCamera)
    }

    @ReactMethod
    fun scanCard(promise: Promise) {
        val currentActivity = currentActivity
        if (currentActivity == null) {
            promise.reject("ACTIVITY_NOT_AVAILABLE", "Activity is not available to start scanner")
            return
        }

        scanPromise = promise

        try {
            val intent = Intent(currentActivity, CardScannerActivity::class.java)
            currentActivity.startActivityForResult(intent, REQUEST_CODE_CARD_SCAN)
        } catch (e: Exception) {
            scanPromise?.reject("SCAN_FAILED", e.message, e)
            scanPromise = null
        }
    }

    override fun onActivityResult(
        activity: Activity?,
        requestCode: Int,
        resultCode: Int,
        data: Intent?
    ) {
        if (requestCode != REQUEST_CODE_CARD_SCAN) return

        val promise = scanPromise ?: return
        scanPromise = null

        if (resultCode == Activity.RESULT_OK && data != null) {
            val map = Arguments.createMap().apply {
                putString("cardNumber", data.getStringExtra("cardNumber") ?: "")
                putString("month", data.getStringExtra("month") ?: "")
                putString("year", data.getStringExtra("year") ?: "")
                putString("network", data.getStringExtra("network") ?: "")
                putString("bankName", data.getStringExtra("bankName") ?: "")
                putString("cardType", data.getStringExtra("cardType") ?: "")
                putString("ownerName", data.getStringExtra("ownerName") ?: "")
                putString("cvv", data.getStringExtra("cvv") ?: "")
            }
            promise.resolve(map)
        } else {
            // Cancelled by user
            promise.resolve(null)
        }
    }

    override fun onNewIntent(intent: Intent?) {}
}

