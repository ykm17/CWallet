package com.ykm.ewallet

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.NotificationCompat

class CardOverlayService : Service() {

    private var windowManager: WindowManager? = null
    private var overlayView: View? = null
    private val handler = Handler(Looper.getMainLooper())
    private val autoDismissRunnable = Runnable { stopSelf() }

    companion object {
        const val CHANNEL_ID = "card_overlay_channel"
        const val NOTIFICATION_ID = 4001
        const val ACTION_DISMISS = "com.ykm.ewallet.ACTION_DISMISS_OVERLAY"
        const val AUTO_DISMISS_DELAY_MS = 3 * 60 * 1000L // 3 minutes
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_DISMISS) {
            stopSelf()
            return START_NOT_STICKY
        }

        val bankName = intent?.getStringExtra("bankName") ?: ""
        val cardName = intent?.getStringExtra("cardName") ?: ""
        val cardNumber = intent?.getStringExtra("cardNumber") ?: ""
        val last4 = intent?.getStringExtra("last4") ?: ""
        val expiry = intent?.getStringExtra("expiry") ?: ""
        val cvv = intent?.getStringExtra("cvv") ?: ""

        val notification = buildNotification(bankName, cardName, cardNumber, last4, expiry, cvv)
        try {
            startForeground(NOTIFICATION_ID, notification)
        } catch (_: Exception) {}

        showOverlayView(bankName, cardName, cardNumber, last4, expiry, cvv)

        // Reset auto dismiss timer
        handler.removeCallbacks(autoDismissRunnable)
        handler.postDelayed(autoDismissRunnable, AUTO_DISMISS_DELAY_MS)

        return START_NOT_STICKY
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Card Assistant",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows card details while making payments"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(
        bankName: String,
        cardName: String,
        cardNumber: String,
        last4: String,
        expiry: String,
        cvv: String
    ): Notification {
        val dismissIntent = Intent(this, CardOverlayService::class.java).apply {
            action = ACTION_DISMISS
        }
        val dismissPendingIntent = PendingIntent.getService(
            this,
            0,
            dismissIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
        )

        val appIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        }
        val appPendingIntent = PendingIntent.getActivity(
            this,
            1,
            appIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
        )

        val title = when {
            bankName.isNotEmpty() -> bankName
            cardName.isNotEmpty() -> cardName
            else -> "EWallet"
        }
        val content = if (cardNumber.isNotEmpty()) {
            "$cardNumber  |  EXP: ${expiry.ifEmpty { "--/--" }}  |  CVV: ${cvv.ifEmpty { "---" }}"
        } else {
            "EXP: ${expiry.ifEmpty { "--/--" }}  |  CVV: ${cvv.ifEmpty { "---" }}"
        }

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(content)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(appPendingIntent)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Dismiss", dismissPendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun showOverlayView(
        bankName: String,
        cardName: String,
        cardNumber: String,
        last4: String,
        expiry: String,
        cvv: String
    ) {
        removeOverlayView()

        val wm = windowManager ?: return

        val dp = { value: Float ->
            TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP,
                value,
                resources.displayMetrics
            ).toInt()
        }

        val layoutType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            layoutType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = dp(24f)
            y = dp(140f)
        }

        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager

        // Main root container: sleek, compact floating card matching CWallet app UI
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(10f), dp(8f), dp(10f), dp(8f))
            elevation = dp(8f).toFloat()

            background = GradientDrawable().apply {
                setColor(Color.parseColor("#111827")) // Obsidian theme
                cornerRadius = dp(12f).toFloat()
                setStroke(dp(1f), Color.parseColor("#374151")) // Refined border
            }
        }

        // Top row: [App badge "EWallet"] [Bank info] [Spacer] [Close ✕]
        val topRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 0, 0, dp(6f))
            }
        }

        // App badge ("EWallet" like before)
        val badge = TextView(this).apply {
            text = "EWallet"
            setTextColor(Color.parseColor("#F59E0B")) // Gold accent
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 9.5f)
            typeface = Typeface.DEFAULT_BOLD
            setPadding(dp(6f), dp(2.5f), dp(6f), dp(2.5f))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#1F2937"))
                cornerRadius = dp(4f).toFloat()
                setStroke(dp(0.8f), Color.parseColor("#374151"))
            }
            setOnClickListener {
                val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                }
                if (launchIntent != null) {
                    startActivity(launchIntent)
                }
                stopSelf()
            }
        }
        topRow.addView(badge)

        // Title text: Bank name
        val titleText = TextView(this).apply {
            val displayBank = when {
                bankName.isNotEmpty() -> bankName
                cardName.isNotEmpty() -> cardName
                else -> "Card"
            }
            text = displayBank
            setTextColor(Color.parseColor("#E4E4E7"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            typeface = Typeface.DEFAULT_BOLD
            setPadding(dp(6f), 0, dp(8f), 0)
            setOnClickListener {
                val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                }
                if (launchIntent != null) {
                    startActivity(launchIntent)
                }
                stopSelf()
            }
        }
        topRow.addView(titleText)

        // Close button (✕)
        val closeBtn = TextView(this).apply {
            text = "✕"
            setTextColor(Color.parseColor("#9CA3AF"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setPadding(dp(6f), dp(2f), dp(6f), dp(2f))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(dp(6f), 0, 0, 0)
            }
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#1F2937"))
                cornerRadius = dp(10f).toFloat()
            }
            setOnClickListener {
                stopSelf()
            }
        }
        topRow.addView(closeBtn)

        root.addView(topRow)

        // Row 2: Card Number clearly visible (never hidden) with tap-to-copy
        if (cardNumber.isNotEmpty()) {
            val numberRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(8f), dp(3.5f), dp(8f), dp(3.5f))
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    setMargins(0, 0, 0, dp(6f))
                }
                background = GradientDrawable().apply {
                    setColor(Color.parseColor("#1F2937"))
                    cornerRadius = dp(5f).toFloat()
                    setStroke(dp(0.8f), Color.parseColor("#374151"))
                }
                setOnClickListener {
                    val clean = cardNumber.replace("\\s+".toRegex(), "")
                    clipboard.setPrimaryClip(ClipData.newPlainText("Card Number", clean))
                    Toast.makeText(context, "Card number copied", Toast.LENGTH_SHORT).show()
                }
            }

            val numberText = TextView(this).apply {
                text = cardNumber
                setTextColor(Color.WHITE)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f)
                typeface = Typeface.MONOSPACE
                setTypeface(typeface, Typeface.BOLD)
                letterSpacing = 0.04f
            }
            numberRow.addView(numberText)

            val copyBadge = TextView(this).apply {
                text = "Copy"
                setTextColor(Color.parseColor("#9CA3AF"))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 8.5f)
                typeface = Typeface.DEFAULT_BOLD
                setPadding(dp(6f), 0, 0, 0)
            }
            numberRow.addView(copyBadge)

            root.addView(numberRow)
        }

        // Bottom row: [EXPIRY chip] [CVV chip]
        val dataRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }

        // Expiry Chip: [EXP  08/29]
        val expiryChip = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(8f), dp(4f), dp(8f), dp(4f))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#1F2937"))
                cornerRadius = dp(6f).toFloat()
                setStroke(dp(0.8f), Color.parseColor("#374151"))
            }
            setOnClickListener {
                if (expiry.isNotEmpty()) {
                    clipboard.setPrimaryClip(ClipData.newPlainText("Expiry", expiry))
                    Toast.makeText(context, "Expiry ($expiry) copied", Toast.LENGTH_SHORT).show()
                }
            }
        }

        val expiryLabel = TextView(this).apply {
            text = "EXP "
            setTextColor(Color.parseColor("#9CA3AF"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 8.5f)
            typeface = Typeface.DEFAULT_BOLD
        }
        val expiryVal = TextView(this).apply {
            text = expiry.ifEmpty { "--/--" }
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            typeface = Typeface.MONOSPACE
            setTypeface(typeface, Typeface.BOLD)
        }
        expiryChip.addView(expiryLabel)
        expiryChip.addView(expiryVal)
        dataRow.addView(expiryChip)

        // Spacer between chips
        val chipSpacer = View(this).apply {
            layoutParams = LinearLayout.LayoutParams(dp(6f), dp(1f))
        }
        dataRow.addView(chipSpacer)

        // CVV Chip: [CVV  123]
        val cvvChip = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(8f), dp(4f), dp(8f), dp(4f))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#1F2937"))
                cornerRadius = dp(6f).toFloat()
                setStroke(dp(0.8f), Color.parseColor("#374151"))
            }
            setOnClickListener {
                if (cvv.isNotEmpty()) {
                    clipboard.setPrimaryClip(ClipData.newPlainText("CVV", cvv))
                    Toast.makeText(context, "CVV ($cvv) copied", Toast.LENGTH_SHORT).show()
                }
            }
        }

        val cvvLabel = TextView(this).apply {
            text = "CVV "
            setTextColor(Color.parseColor("#9CA3AF"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 8.5f)
            typeface = Typeface.DEFAULT_BOLD
        }
        val cvvVal = TextView(this).apply {
            text = cvv.ifEmpty { "---" }
            setTextColor(Color.parseColor("#FBBF24")) // Gold CVV
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            typeface = Typeface.MONOSPACE
            setTypeface(typeface, Typeface.BOLD)
        }
        cvvChip.addView(cvvLabel)
        cvvChip.addView(cvvVal)
        dataRow.addView(cvvChip)

        root.addView(dataRow)

        // Enable Dragging on touch
        var initialX = 0
        var initialY = 0
        var initialTouchX = 0f
        var initialTouchY = 0f

        root.setOnTouchListener { view, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    initialX = params.x
                    initialY = params.y
                    initialTouchX = event.rawX
                    initialTouchY = event.rawY
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (event.rawX - initialTouchX).toInt()
                    val dy = (event.rawY - initialTouchY).toInt()
                    params.x = initialX + dx
                    params.y = initialY + dy
                    try {
                        wm.updateViewLayout(root, params)
                    } catch (_: Exception) {}
                    true
                }
                MotionEvent.ACTION_UP -> {
                    val totalMoved = Math.abs(event.rawX - initialTouchX) + Math.abs(event.rawY - initialTouchY)
                    if (totalMoved < dp(8f)) {
                        view.performClick()
                    }
                    true
                }
                else -> false
            }
        }

        try {
            wm.addView(root, params)
            overlayView = root
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun removeOverlayView() {
        overlayView?.let { view ->
            try {
                windowManager?.removeView(view)
            } catch (_: Exception) {}
            overlayView = null
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        handler.removeCallbacks(autoDismissRunnable)
        removeOverlayView()
    }
}

