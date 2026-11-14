package com.cwallet

import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Size
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.animation.LinearInterpolator
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.regex.Pattern

enum class OverlayState {
    SEARCHING,   // No card / card partial (Amber)
    STABILIZING, // Card in frame, holding steady (Blue)
    LOCKED       // Card locked & scanning (Green)
}

class CardScannerActivity : AppCompatActivity() {

    private lateinit var previewView: PreviewView
    private lateinit var overlayView: ScannerOverlayView
    private lateinit var cameraExecutor: ExecutorService
    private lateinit var instructionPill: TextView
    private lateinit var orientationBtn: TextView
    private lateinit var chipNumber: TextView
    private lateinit var chipExpiry: TextView
    private lateinit var chipCvv: TextView
    private lateinit var chipName: TextView
    private lateinit var chipBank: TextView
    private lateinit var retryBtn: TextView
    private lateinit var proceedBtn: TextView

    private var camera: Camera? = null
    private var isTorchOn = false
    private var isCompleted = false
    private var isVerticalCard = false

    private var detectedCardNumber: String = ""
    private var detectedMonth: String = ""
    private var detectedYear: String = ""
    private var detectedCvv: String = ""
    private var detectedOwnerName: String = ""
    private var detectedBankName: String = ""
    private var detectedNetwork: String = ""
    private var detectedCardType: String = ""

    // Whole card detection & stability hold tracking to prevent wrong data
    private var isCardLocked = false
    private var cardStableFrames = 0
    private var cardFirstDetectedTimestamp = 0L
    private var lastCentroidX = 0f
    private var lastCentroidY = 0f
    private var pendingCardNumberCandidate = ""
    private var pendingCardNumberCount = 0
    private var pendingOwnerNameCandidate = ""
    private var pendingOwnerNameCount = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        cameraExecutor = Executors.newSingleThreadExecutor()

        val rootLayout = FrameLayout(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.BLACK)
        }

        // Camera PreviewView with tap-to-focus
        previewView = PreviewView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            scaleType = PreviewView.ScaleType.FILL_CENTER
            setOnTouchListener { _, event ->
                if (event.action == MotionEvent.ACTION_DOWN) {
                    val factory = meteringPointFactory
                    val point = factory.createPoint(event.x, event.y)
                    val action = FocusMeteringAction.Builder(point).build()
                    camera?.cameraControl?.startFocusAndMetering(action)
                }
                true
            }
        }
        rootLayout.addView(previewView)

        // Custom Card Overlay View (supports Horizontal and Vertical frames)
        overlayView = ScannerOverlayView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }
        rootLayout.addView(overlayView)

        // Top Control Bar: [✕ Cancel] [spacer] [⚡ Torch]
        val topBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = dp(44f)
                leftMargin = dp(14f)
                rightMargin = dp(14f)
            }
        }

        val closeBtn = TextView(this).apply {
            text = "✕"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            gravity = Gravity.CENTER
            setPadding(dp(10f), dp(6f), dp(10f), dp(6f))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#66000000"))
                cornerRadius = dp(20f).toFloat()
            }
            setOnClickListener {
                setResult(Activity.RESULT_CANCELED)
                finish()
            }
        }
        topBar.addView(closeBtn)

        val spacer1 = View(this).apply {
            layoutParams = LinearLayout.LayoutParams(0, 1, 1f)
        }
        topBar.addView(spacer1)

        val torchBtn = TextView(this).apply {
            text = "⚡"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            gravity = Gravity.CENTER
            setPadding(dp(10f), dp(6f), dp(10f), dp(6f))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#66000000"))
                cornerRadius = dp(20f).toFloat()
            }
            setOnClickListener {
                toggleTorch(this)
            }
        }
        topBar.addView(torchBtn)

        rootLayout.addView(topBar)

        // Bottom panel for real-time guidance, status chips, and Proceed action
        val bottomContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
                bottomMargin = dp(24f)
                leftMargin = dp(16f)
                rightMargin = dp(16f)
            }
        }

        // Guidance banner
        instructionPill = TextView(this).apply {
            text = "Position horizontal card inside frame\nDetails are detected automatically"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            gravity = Gravity.CENTER
            setLineSpacing(dp(2f).toFloat(), 1f)
            setPadding(dp(14f), dp(8f), dp(14f), dp(8f))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#CC000000"))
                cornerRadius = dp(12f).toFloat()
            }
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dp(8f)
            }
        }
        bottomContainer.addView(instructionPill)

        // Real-time detected status chips: [Card No] [Expiry] [CVV] [Name] [Bank]
        val chipsScroll = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dp(12f)
            }
        }
        val chipsRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        chipNumber = createStatusChip("Card No")
        chipExpiry = createStatusChip("Expiry")
        chipCvv = createStatusChip("CVV")
        chipName = createStatusChip("Name")
        chipBank = createStatusChip("Bank")

        chipsRow.addView(chipNumber)
        chipsRow.addView(chipExpiry)
        chipsRow.addView(chipCvv)
        chipsRow.addView(chipName)
        chipsRow.addView(chipBank)
        chipsScroll.addView(chipsRow)
        bottomContainer.addView(chipsScroll)

        // Secondary Action Row: [ 🔄 Retry ] and [ 🔄 Card: Horiz ]
        val secondaryRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dp(8f)
            }
        }

        retryBtn = TextView(this).apply {
            text = "🔄 Retry"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setPadding(dp(14f), dp(7f), dp(14f), dp(7f))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#80374151"))
                cornerRadius = dp(16f).toFloat()
                setStroke(dp(1f), Color.parseColor("#4DFFFFFF"))
            }
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                rightMargin = dp(10f)
            }
            setOnClickListener {
                resetScanning()
            }
        }
        secondaryRow.addView(retryBtn)

        // Orientation Toggle Button
        orientationBtn = TextView(this).apply {
            text = "🔄 Card: Horiz"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setPadding(dp(12f), dp(7f), dp(12f), dp(7f))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#80000000"))
                cornerRadius = dp(16f).toFloat()
                setStroke(dp(1f), Color.parseColor("#4DFFFFFF"))
            }
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
            setOnClickListener {
                toggleCardOrientation()
            }
        }
        secondaryRow.addView(orientationBtn)
        bottomContainer.addView(secondaryRow)

        // Proceed Button
        proceedBtn = TextView(this).apply {
            text = "Scan card to proceed"
            setTextColor(Color.parseColor("#9CA3AF"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            isEnabled = false
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#66374151"))
                cornerRadius = dp(12f).toFloat()
            }
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(46f)
            )
            setOnClickListener {
                triggerSuccessAndFinish()
            }
        }
        bottomContainer.addView(proceedBtn)

        rootLayout.addView(bottomContainer)

        setContentView(rootLayout)

        startCamera()
    }

    private fun createStatusChip(label: String): TextView {
        return TextView(this).apply {
            text = label
            setTextColor(Color.parseColor("#9CA3AF"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 10f)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setPadding(dp(8f), dp(4f), dp(8f), dp(4f))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#4D000000"))
                cornerRadius = dp(8f).toFloat()
                setStroke(dp(1f), Color.parseColor("#4B5563"))
            }
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                rightMargin = dp(4f)
            }
        }
    }

    private fun updateScannerUI() {
        if (isCompleted) return

        // 1. Update Chips
        if (detectedCardNumber.isNotEmpty()) {
            val digits = detectedCardNumber.filter { it.isDigit() }
            val last4 = if (digits.length >= 4) digits.takeLast(4) else digits
            chipNumber.text = "✓ ••$last4"
            chipNumber.setTextColor(Color.WHITE)
            (chipNumber.background as? GradientDrawable)?.apply {
                setColor(Color.parseColor("#10B981"))
                setStroke(dp(1f), Color.parseColor("#059669"))
            }
        }

        if (detectedMonth.isNotEmpty() && detectedYear.isNotEmpty()) {
            chipExpiry.text = "✓ $detectedMonth/$detectedYear"
            chipExpiry.setTextColor(Color.WHITE)
            (chipExpiry.background as? GradientDrawable)?.apply {
                setColor(Color.parseColor("#10B981"))
                setStroke(dp(1f), Color.parseColor("#059669"))
            }
        }

        if (detectedCvv.isNotEmpty()) {
            chipCvv.text = "✓ CVV: $detectedCvv"
            chipCvv.setTextColor(Color.WHITE)
            (chipCvv.background as? GradientDrawable)?.apply {
                setColor(Color.parseColor("#10B981"))
                setStroke(dp(1f), Color.parseColor("#059669"))
            }
        }

        if (detectedOwnerName.isNotEmpty()) {
            val shortName = if (detectedOwnerName.length > 10) detectedOwnerName.take(9) + "…" else detectedOwnerName
            chipName.text = "✓ $shortName"
            chipName.setTextColor(Color.WHITE)
            (chipName.background as? GradientDrawable)?.apply {
                setColor(Color.parseColor("#10B981"))
                setStroke(dp(1f), Color.parseColor("#059669"))
            }
        }

        if (detectedBankName.isNotEmpty()) {
            chipBank.text = "✓ $detectedBankName"
            chipBank.setTextColor(Color.WHITE)
            (chipBank.background as? GradientDrawable)?.apply {
                setColor(Color.parseColor("#10B981"))
                setStroke(dp(1f), Color.parseColor("#059669"))
            }
        }

        // 2. Dynamic Guidance text
        if (detectedCardNumber.isEmpty()) {
            instructionPill.text = when {
                !isCardLocked && cardStableFrames > 0 -> "Card detected! Hold steady...\nAligning card in frame"
                isCardLocked -> "Card locked! Reading card details..."
                isVerticalCard -> "Position full vertical card inside frame\nEnsure entire card fits in the box"
                else -> "Position full card inside frame\nEnsure entire card fits in the box"
            }
        } else if (detectedMonth.isEmpty() || detectedCvv.isEmpty()) {
            val missing = when {
                detectedMonth.isEmpty() && detectedCvv.isEmpty() -> "expiry (MM/YY) & CVV"
                detectedMonth.isEmpty() -> "expiry date (MM/YY)"
                else -> "CVV (flip card if on back)"
            }
            instructionPill.text = "✓ Card number detected!\nNow focus on $missing"
        } else if (detectedOwnerName.isEmpty()) {
            instructionPill.text = "✓ Expiry & CVV detected!\nNow focus on cardholder name"
        } else if (detectedBankName.isEmpty()) {
            instructionPill.text = "✓ Name detected!\nNow focus on bank name / logo"
        } else {
            instructionPill.text = "✓ All card details captured!"
        }

        // 3. Update Proceed Button
        if (detectedCardNumber.isNotEmpty()) {
            proceedBtn.isEnabled = true
            proceedBtn.text = "Proceed with Scanned Details →"
            proceedBtn.setTextColor(Color.WHITE)
            (proceedBtn.background as? GradientDrawable)?.apply {
                setColor(Color.parseColor("#10B981"))
                cornerRadius = dp(12f).toFloat()
            }
        }
    }

    private fun resetScanning() {
        detectedCardNumber = ""
        detectedMonth = ""
        detectedYear = ""
        detectedCvv = ""
        detectedOwnerName = ""
        detectedBankName = ""
        detectedNetwork = ""
        detectedCardType = ""

        isCardLocked = false
        cardStableFrames = 0
        cardFirstDetectedTimestamp = 0L
        lastCentroidX = 0f
        lastCentroidY = 0f
        pendingCardNumberCandidate = ""
        pendingCardNumberCount = 0
        pendingOwnerNameCandidate = ""
        pendingOwnerNameCount = 0

        overlayView.setOverlayState(OverlayState.SEARCHING)

        // Reset status chips
        resetChip(chipNumber, "Card No")
        resetChip(chipExpiry, "Expiry")
        resetChip(chipCvv, "CVV")
        resetChip(chipName, "Name")
        resetChip(chipBank, "Bank")

        // Reset proceed button
        proceedBtn.isEnabled = false
        proceedBtn.text = "Scan card to proceed"
        proceedBtn.setTextColor(Color.parseColor("#9CA3AF"))
        (proceedBtn.background as? GradientDrawable)?.apply {
            setColor(Color.parseColor("#66374151"))
            cornerRadius = dp(12f).toFloat()
        }

        // Reset instruction
        instructionPill.text = if (isVerticalCard) {
            "Position full vertical card inside frame\nEnsure entire card fits in the box"
        } else {
            "Position full card inside frame\nEnsure entire card fits in the box"
        }
    }

    private fun resetChip(chip: TextView, label: String) {
        chip.text = label
        chip.setTextColor(Color.parseColor("#9CA3AF"))
        (chip.background as? GradientDrawable)?.apply {
            setColor(Color.parseColor("#4D000000"))
            setStroke(dp(1f), Color.parseColor("#4B5563"))
        }
    }

    private fun toggleCardOrientation() {
        isVerticalCard = !isVerticalCard
        overlayView.setOrientation(isVerticalCard)
        orientationBtn.text = if (isVerticalCard) "🔄 Card: Vert" else "🔄 Card: Horiz"
        updateScannerUI()
    }

    private fun toggleTorch(view: TextView) {
        val cam = camera ?: return
        if (cam.cameraInfo.hasFlashUnit()) {
            isTorchOn = !isTorchOn
            cam.cameraControl.enableTorch(isTorchOn)
            view.setTextColor(if (isTorchOn) Color.parseColor("#F59E0B") else Color.WHITE)
        }
    }

    private fun startCamera() {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
        cameraProviderFuture.addListener({
            val cameraProvider = cameraProviderFuture.get()

            val preview = Preview.Builder().build().also {
                it.setSurfaceProvider(previewView.surfaceProvider)
            }

            val resolutionSelector = androidx.camera.core.resolutionselector.ResolutionSelector.Builder()
                .setResolutionStrategy(
                    androidx.camera.core.resolutionselector.ResolutionStrategy(
                        Size(1920, 1080),
                        androidx.camera.core.resolutionselector.ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER
                    )
                )
                .build()

            // High resolution (1080p) for crystal-clear fine print and embossed text
            val imageAnalysis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .setResolutionSelector(resolutionSelector)
                .build()

            val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

            imageAnalysis.setAnalyzer(cameraExecutor) { imageProxy ->
                analyzeImageProxy(imageProxy, recognizer)
            }

            val cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA

            try {
                cameraProvider.unbindAll()
                camera = cameraProvider.bindToLifecycle(
                    this, cameraSelector, preview, imageAnalysis
                )
            } catch (exc: Exception) {
                exc.printStackTrace()
            }

        }, ContextCompat.getMainExecutor(this))
    }

    @SuppressLint("UnsafeOptInUsageError")
    private fun analyzeImageProxy(
        imageProxy: ImageProxy,
        recognizer: com.google.mlkit.vision.text.TextRecognizer
    ) {
        if (isCompleted) {
            imageProxy.close()
            return
        }

        val mediaImage = imageProxy.image
        if (mediaImage == null) {
            imageProxy.close()
            return
        }

        val rotationDegrees = imageProxy.imageInfo.rotationDegrees
        val inputImage = InputImage.fromMediaImage(mediaImage, rotationDegrees)

        val isRotated = (rotationDegrees == 90 || rotationDegrees == 270)
        val imgWidth = if (isRotated) imageProxy.height else imageProxy.width
        val imgHeight = if (isRotated) imageProxy.width else imageProxy.height

        recognizer.process(inputImage)
            .addOnSuccessListener { visionText ->
                processTextResult(visionText, imgWidth, imgHeight)
            }
            .addOnFailureListener {
                // Continue to next frame on transient failure
            }
            .addOnCompleteListener {
                imageProxy.close()
            }
    }

    private fun processTextResult(visionText: Text, imgWidth: Int, imgHeight: Int) {
        if (isCompleted) return

        val viewWidth = previewView.width.toFloat()
        val viewHeight = previewView.height.toFloat()
        val cardBox = overlayView.getCardRect()

        // Wait until layout dimensions and card box are fully initialized
        if (viewWidth <= 0f || viewHeight <= 0f || imgWidth <= 0 || imgHeight <= 0 || cardBox.isEmpty) {
            return
        }

        // Aspect-fill coordinate mapping from camera image to preview screen
        val scale = maxOf(viewWidth / imgWidth.toFloat(), viewHeight / imgHeight.toFloat())
        val dispWidth = imgWidth * scale
        val dispHeight = imgHeight * scale
        val dx = (viewWidth - dispWidth) / 2f
        val dy = (viewHeight - dispHeight) / 2f

        // Expanded card box with slight margin (16dp)
        val expandedCardBox = RectF(cardBox).apply {
            inset(-dp(16f).toFloat(), -dp(16f).toFloat())
        }

        // Collect all text lines inside the cutout AND their bounding boxes
        val lines = mutableListOf<String>()
        val lineBoxes = mutableListOf<RectF>()
        for (block in visionText.textBlocks) {
            for (line in block.lines) {
                val box = line.boundingBox ?: continue
                val screenCenterX = box.centerX() * scale + dx
                val screenCenterY = box.centerY() * scale + dy

                // STRICT: Only scan and accept text positioned INSIDE the card cutout box!
                if (expandedCardBox.contains(screenCenterX, screenCenterY)) {
                    val text = line.text.trim()
                    if (text.isNotEmpty()) {
                        lines.add(text)
                        // Project full bounding box to screen coordinates
                        lineBoxes.add(RectF(
                            box.left * scale + dx,
                            box.top * scale + dy,
                            box.right * scale + dx,
                            box.bottom * scale + dy
                        ))
                    }
                }
            }
        }

        if (lines.isEmpty()) {
            if (isCardLocked || cardStableFrames > 0) {
                cardStableFrames = 0
                cardFirstDetectedTimestamp = 0L
                isCardLocked = false
                runOnUiThread {
                    overlayView.setOverlayState(OverlayState.SEARCHING)
                    updateScannerUI()
                }
            }
            return
        }

        // --- WHOLE CARD CONTAINMENT CHECK ---
        // Ensure the entire card is fully placed inside the box and not clipped by the frame.
        val margin = dp(14f).toFloat()
        val allWithinBounds = lineBoxes.all { box ->
            box.left >= cardBox.left - margin &&
            box.right <= cardBox.right + margin &&
            box.top >= cardBox.top - margin &&
            box.bottom <= cardBox.bottom + margin
        }

        // Check horizontal and vertical distribution across the cutout
        val minX = lineBoxes.minOf { it.left }
        val maxX = lineBoxes.maxOf { it.right }
        val minY = lineBoxes.minOf { it.top }
        val maxY = lineBoxes.maxOf { it.bottom }

        val widthCoverage = (maxX - minX) / cardBox.width()
        val heightCoverage = (maxY - minY) / cardBox.height()

        // Full card must have sufficient coverage across width (>= 30%) and height (>= 18%), with at least 2 text lines
        val hasAdequateCoverage = widthCoverage >= 0.30f && heightCoverage >= 0.18f && lines.size >= 2
        val wholeCardInside = allWithinBounds && hasAdequateCoverage

        if (!wholeCardInside) {
            cardStableFrames = 0
            cardFirstDetectedTimestamp = 0L
            isCardLocked = false
            runOnUiThread {
                overlayView.setOverlayState(OverlayState.SEARCHING)
                if (detectedCardNumber.isEmpty()) {
                    instructionPill.text = if (isVerticalCard) {
                        "Position full vertical card inside frame\nEnsure entire card fits in the box"
                    } else {
                        "Position full card inside frame\nEnsure entire card fits in the box"
                    }
                }
            }
            return
        }

        // --- STABILITY HOLD CHECK ---
        // Verify user is holding the card steady inside the box (no erratic shaking or rapid motion)
        val currentCentroidX = lineBoxes.map { it.centerX() }.average().toFloat()
        val currentCentroidY = lineBoxes.map { it.centerY() }.average().toFloat()
        val isSteady = Math.abs(currentCentroidX - lastCentroidX) < dp(25f) &&
                       Math.abs(currentCentroidY - lastCentroidY) < dp(25f)
        lastCentroidX = currentCentroidX
        lastCentroidY = currentCentroidY

        val now = System.currentTimeMillis()
        if (cardFirstDetectedTimestamp == 0L || !isSteady) {
            cardFirstDetectedTimestamp = now
            cardStableFrames = 1
        } else {
            cardStableFrames++
        }

        val holdDuration = now - cardFirstDetectedTimestamp

        // Require at least 500ms of steady hold across multiple frames before reading card data
        if (holdDuration < 500L || cardStableFrames < 3) {
            runOnUiThread {
                overlayView.setOverlayState(OverlayState.STABILIZING)
                if (detectedCardNumber.isEmpty()) {
                    instructionPill.text = "Card detected! Hold steady...\nAligning card in frame"
                }
            }
            return
        }

        // Card is locked & steady inside the box!
        isCardLocked = true
        runOnUiThread {
            overlayView.setOverlayState(OverlayState.LOCKED)
        }

        val fullText = lines.joinToString("\n")

        // 1. Extract valid Luhn card number with multi-frame confirmation to prevent OCR misreads
        val cardNumber = extractCardNumber(lines, fullText)
        if (cardNumber != null && cardNumber.isNotEmpty()) {
            if (cardNumber == pendingCardNumberCandidate) {
                pendingCardNumberCount++
            } else {
                pendingCardNumberCandidate = cardNumber
                pendingCardNumberCount = 1
            }

            // Confirm across 2 consecutive frames OR if already verified Luhn
            if (pendingCardNumberCount >= 2 || (detectedCardNumber.isEmpty() && pendingCardNumberCount >= 1 && isValidLuhn(cardNumber.filter { it.isDigit() }))) {
                if (detectedCardNumber.isEmpty()) {
                    vibrateSuccess()
                }
                detectedCardNumber = cardNumber
            }
        }

        // 2. Extract expiry
        val (month, year) = extractExpiry(lines, fullText)
        if (month.isNotEmpty() && year.isNotEmpty()) {
            detectedMonth = month
            detectedYear = year
        }

        // 3. Extract CVV (if card is flipped or printed)
        val cvv = extractCvv(lines, fullText, detectedCardNumber)
        if (cvv.isNotEmpty()) {
            detectedCvv = cvv
        }

        // 4. Extract network
        val network = extractNetwork(fullText, detectedCardNumber)
        if (network.isNotEmpty()) {
            detectedNetwork = network
        }

        // 5. Extract bank
        val bankName = extractBank(fullText)
        if (bankName.isNotEmpty()) {
            detectedBankName = bankName
        }

        // 6. Extract card type
        val cardType = extractCardType(fullText)
        if (cardType.isNotEmpty()) {
            detectedCardType = cardType
        }

        // 7. Extract cardholder name (filtered by position & verified across frames)
        if (detectedOwnerName.isEmpty()) {
            val ownerName = extractCardholderName(lines, lineBoxes, cardBox, detectedBankName)
            if (ownerName.isNotEmpty()) {
                if (ownerName == pendingOwnerNameCandidate) {
                    pendingOwnerNameCount++
                } else {
                    pendingOwnerNameCandidate = ownerName
                    pendingOwnerNameCount = 1
                }

                if (pendingOwnerNameCount >= 2) {
                    detectedOwnerName = ownerName
                }
            }
        }

        runOnUiThread {
            updateScannerUI()
        }
    }

    private fun extractCvv(lines: List<String>, fullText: String, cardNumber: String): String {
        // Build a set of digit sequences to EXCLUDE from CVV candidates
        val cardDigits = cardNumber.filter { it.isDigit() }
        val excludedDigits = mutableSetOf<String>()
        if (cardDigits.length >= 3) {
            for (i in 0..cardDigits.length - 3) {
                excludedDigits.add(cardDigits.substring(i, i + 3))
            }
        }
        if (detectedMonth.isNotEmpty()) excludedDigits.add(detectedMonth)
        if (detectedYear.isNotEmpty()) excludedDigits.add(detectedYear)

        fun isValidCvv(candidate: String): Boolean {
            if (candidate.length !in 3..4) return false
            if (candidate.all { it == candidate[0] }) return false
            if (excludedDigits.contains(candidate)) return false
            return true
        }

        // Pattern 1: Explicit labels like CVV 123, CVC: 456, CID: 1234, SECURITY CODE: 789
        val labeledRegex = Regex("""(?:\b(?:CVV2?|CVC2?|CID|SECURITY\s*CODE|SEC(?:URITY)?\s*(?:NO|NUM|NUMBER|CODE)?)\b)[\s:#\.-]*([0-9]{3,4})\b""", RegexOption.IGNORE_CASE)
        val labeledMatch = labeledRegex.find(fullText)
        if (labeledMatch != null) {
            val candidate = labeledMatch.groupValues[1]
            if (candidate.length in 3..4 && !candidate.all { it == candidate[0] }) return candidate
        }

        // Pattern 2: Line with CVV/CVC/CID label and next line with digits
        for (i in 0 until lines.size - 1) {
            val trimmed = lines[i].trim()
            if (trimmed.matches(Regex("""^(?:CVV2?|CVC2?|CID|SEC(?:URITY)?(?:\s*CODE)?)$""", RegexOption.IGNORE_CASE))) {
                val nextDigits = cleanOcrDigits(lines[i + 1].trim()).filter { it.isDigit() }
                if (nextDigits.length in 3..4 && !nextDigits.all { it == nextDigits[0] }) return nextDigits
            }
        }

        // Pattern 3: Signature strip pattern (last 4 digits + 3 CVV digits)
        val cleanDigits = cardNumber.filter { it.isDigit() }
        if (cleanDigits.length >= 4) {
            val last4 = cleanDigits.takeLast(4)
            val stripRegex = Regex("""\b$last4\s+([0-9]{3})\b""")
            val stripMatch = stripRegex.find(fullText)
            if (stripMatch != null) {
                val candidate = stripMatch.groupValues[1]
                if (candidate.length in 3..4 && !candidate.all { it == candidate[0] }) return candidate
            }
        }

        // Pattern 4: Standalone 3-digit number on card back (no label needed)
        val datePattern = Regex("""(?:0[1-9]|1[0-2])\s*[/\-\.]\s*[0-9]{2,4}""")
        for (line in lines) {
            val trimmed = line.trim()
            if (datePattern.containsMatchIn(trimmed)) continue
            if (trimmed.matches(Regex("""^[A-Za-z\s]+$"""))) continue
            val standaloneRegex = Regex("""\b([0-9]{3})\b""")
            for (match in standaloneRegex.findAll(trimmed)) {
                val candidate = match.groupValues[1]
                if (isValidCvv(candidate)) return candidate
            }
        }

        return ""
    }

    private fun triggerSuccessAndFinish() {
        if (isCompleted || detectedCardNumber.isEmpty()) return
        isCompleted = true

        overlayView.setDetectedState(true)
        vibrateSuccess()

        cameraExecutor.shutdown()

        overlayView.postDelayed({
            val resultIntent = Intent().apply {
                putExtra("cardNumber", detectedCardNumber)
                putExtra("month", detectedMonth)
                putExtra("year", detectedYear)
                putExtra("network", detectedNetwork)
                putExtra("bankName", detectedBankName)
                putExtra("cardType", detectedCardType)
                putExtra("ownerName", detectedOwnerName)
                putExtra("cvv", detectedCvv)
            }
            setResult(Activity.RESULT_OK, resultIntent)
            finish()
        }, 300)
    }

    private fun vibrateSuccess() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vibratorManager = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
                vibratorManager?.defaultVibrator?.vibrate(
                    VibrationEffect.createOneShot(80, VibrationEffect.DEFAULT_AMPLITUDE)
                )
            } else {
                @Suppress("DEPRECATION")
                val vibrator = getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
                vibrator?.vibrate(80)
            }
        } catch (_: Exception) {}
    }

    // --- High-Accuracy & Vertical Card Parsers ---

    private fun cleanOcrDigits(text: String): String {
        return text
            .replace(Regex("[OoQqDd]"), "0")
            .replace(Regex("[Il|\\]\\[!]"), "1")
            .replace(Regex("[Zz]"), "2")
            .replace(Regex("[Ss$]"), "5")
            .replace(Regex("[Gg]"), "6")
            .replace(Regex("[Bb]"), "8")
            .replace(Regex("[Tt]"), "7")
    }

    private fun extractCardNumber(lines: List<String>, fullText: String): String? {
        val pattern = Pattern.compile("\\b(?:\\d{4}[ -]?\\d{4}[ -]?\\d{4}[ -]?\\d{4}|\\d{4}[ -]?\\d{6}[ -]?\\d{4,5}|\\d{13,19})\\b")

        // Strategy 1: Check lines for standard formatted groupings
        for (line in lines) {
            val matcher = pattern.matcher(line)
            while (matcher.find()) {
                val clean = matcher.group().replace("\\D".toRegex(), "")
                if (isValidLuhn(clean)) {
                    return formatCardNumber(clean)
                }
            }
        }

        // Strategy 2: Check repaired lines with OCR character substitution
        for (line in lines) {
            val repaired = cleanOcrDigits(line)
            val matcher = pattern.matcher(repaired)
            while (matcher.find()) {
                val clean = matcher.group().replace("\\D".toRegex(), "")
                if (isValidLuhn(clean)) {
                    return formatCardNumber(clean)
                }
            }
        }

        // Strategy 3: Handle vertical cards where 4-digit groups are stacked across lines
        val fourDigitTokens = mutableListOf<String>()
        for (line in lines) {
            val trimmed = cleanOcrDigits(line.trim()).replace("\\D".toRegex(), "")
            if (trimmed.length == 4) {
                fourDigitTokens.add(trimmed)
            } else if (trimmed.length == 8) {
                fourDigitTokens.add(trimmed.substring(0, 4))
                fourDigitTokens.add(trimmed.substring(4, 8))
            }
        }

        for (i in 0..fourDigitTokens.size - 4) {
            val candidate = fourDigitTokens[i] + fourDigitTokens[i + 1] + fourDigitTokens[i + 2] + fourDigitTokens[i + 3]
            if (isValidLuhn(candidate)) {
                return formatCardNumber(candidate)
            }
        }

        // Strategy 4: Concatenated tokens across all text
        val allDigits = cleanOcrDigits(fullText).replace("[^\\d\\s-]".toRegex(), " ")
        val tokens = allDigits.trim().split("\\s+".toRegex()).filter { it.isNotEmpty() }

        for (i in 0..tokens.size - 4) {
            if (tokens[i].length == 4 && tokens[i + 1].length == 4 && tokens[i + 2].length == 4 && tokens[i + 3].length == 4) {
                val candidate = tokens[i] + tokens[i + 1] + tokens[i + 2] + tokens[i + 3]
                if (isValidLuhn(candidate)) {
                    return formatCardNumber(candidate)
                }
            }
        }

        // Amex 4-6-5
        for (i in 0..tokens.size - 3) {
            if (tokens[i].length == 4 && tokens[i + 1].length == 6 && tokens[i + 2].length == 5) {
                val candidate = tokens[i] + tokens[i + 1] + tokens[i + 2]
                if (isValidLuhn(candidate)) {
                    return formatCardNumber(candidate)
                }
            }
        }

        return null
    }

    private fun extractExpiry(lines: List<String>, fullText: String): Pair<String, String> {
        val expPattern = Pattern.compile("(?i)(?:VALID\\s+THRU|GOOD\\s+THRU|EXPIRES|EXP|VAL|THRU|MONTH\\/YEAR|MM\\/YY)?\\s*[:\\s]?\\s*(0[1-9]|1[0-2])\\s*[\\/\\-\\.\\s]\\s*([2-3][0-9])\\b")

        // Single line check
        for (line in lines) {
            val repaired = line.replace(Regex("(\\b[Oo])(?=[1-9]\\s*[\\/\\-\\.\\s])"), "0")
            val m = expPattern.matcher(repaired)
            if (m.find()) {
                val month = m.group(1)?.padStart(2, '0') ?: ""
                val year = m.group(2) ?: ""
                val mNum = month.toIntOrNull() ?: 0
                val yNum = year.toIntOrNull() ?: 0
                if (mNum in 1..12 && yNum in 24..39) {
                    return Pair(month, year)
                }
            }
        }

        // Multi-line check (e.g. line i has "EXP", line i+1 has "08/28")
        val datePattern = Pattern.compile("\\b(0[1-9]|1[0-2])\\s*[\\/\\-\\.\\s]\\s*([2-3][0-9])\\b")
        for (i in 0 until lines.size - 1) {
            val current = lines[i].uppercase()
            if (current.contains("VALID") || current.contains("THRU") || current.contains("EXP") || current.contains("DATE")) {
                val next = lines[i + 1].trim().replace(Regex("(\\b[Oo])(?=[1-9]\\s*[\\/\\-\\.\\s])"), "0")
                val m = datePattern.matcher(next)
                if (m.find()) {
                    val month = m.group(1)?.padStart(2, '0') ?: ""
                    val year = m.group(2) ?: ""
                    return Pair(month, year)
                }
            }
        }

        // Full text fallback
        val fullRepaired = fullText.replace(Regex("(\\b[Oo])(?=[1-9]\\s*[\\/\\-\\.\\s])"), "0")
        val m = expPattern.matcher(fullRepaired)
        if (m.find()) {
            val month = m.group(1)?.padStart(2, '0') ?: ""
            val year = m.group(2) ?: ""
            return Pair(month, year)
        }

        return Pair("", "")
    }

    private fun extractNetwork(fullText: String, cardNumber: String): String {
        val upper = fullText.uppercase()
        if (upper.contains("RUPAY")) return "RUPAY"
        if (upper.contains("VISA")) return "VISA"
        if (upper.contains("MASTERCARD")) return "MASTERCARD"
        if (upper.contains("AMEX") || upper.contains("AMERICAN EXPRESS")) return "AMEX"
        if (upper.contains("DINERS")) return "DINERS"
        if (upper.contains("DISCOVER")) return "DISCOVER"

        val clean = cardNumber.replace("\\D".toRegex(), "")
        return when {
            clean.startsWith("4") -> "VISA"
            clean.matches(Regex("^(5[1-5]|2[2-7]).*")) -> "MASTERCARD"
            clean.matches(Regex("^(60|65|81|82|508).*")) -> "RUPAY"
            clean.matches(Regex("^(34|37).*")) -> "AMEX"
            clean.matches(Regex("^(30[0-5]|3095|36|38|39).*")) -> "DINERS"
            clean.matches(Regex("^(6011|644|645).*")) -> "DISCOVER"
            else -> ""
        }
    }

    private fun extractBank(fullText: String): String {
        val upper = fullText.uppercase()
        val bankMap = mapOf(
            "HDFC" to "HD",
            "ICICI" to "IC",
            "AXIS" to "AX",
            "STATE BANK" to "SB",
            "SBI" to "SB",
            "KOTAK" to "KT",
            "IDFC" to "ID",
            "AMERICAN EXPRESS" to "AM",
            "CITI" to "CT",
            "RBL" to "RL",
            "BANK OF BARODA" to "BB",
            "BOB" to "BB",
            "ONECARD" to "BB",
            "ONE CARD" to "BB",
            "AU SMALL FINANCE" to "AU",
            "AU BANK" to "AU",
            "PUNJAB NATIONAL" to "PN",
            "PNB" to "PN",
            "CANARA" to "CN",
            "UNION BANK" to "UN",
            "YES BANK" to "YS",
            "STANDARD CHARTERED" to "SC",
            "DBS" to "DB",
            "FEDERAL BANK" to "FD",
            "FEDERAL" to "FD",
            "SCAPIA" to "FD",
            "FI MONEY" to "FD",
            "FI" to "FD",
            "JUPITER" to "FD",
            "NIYO" to "FD",
            "HSBC" to "HS",
            "INDUSIND" to "IN"
        )

        for ((key, code) in bankMap) {
            val p = Pattern.compile("\\b${Pattern.quote(key)}\\b", Pattern.CASE_INSENSITIVE)
            if (p.matcher(upper).find()) {
                return code
            }
        }

        return ""
    }

    private fun extractCardType(fullText: String): String {
        val upper = fullText.uppercase()
        if (upper.contains("DEBIT") && !upper.contains("CREDIT")) return "DEBIT"
        if (upper.contains("CREDIT") && !upper.contains("DEBIT")) return "CREDIT"
        return ""
    }

    private fun extractCardholderName(
        lines: List<String>,
        lineBoxes: List<RectF>?,
        cardBox: RectF?,
        bankCode: String
    ): String {
        val exclusions = setOf(
            "VALID", "THRU", "GOOD", "EXPIRES", "EXP", "DATE", "FROM", "MONTH", "YEAR", "VAL", "CVV", "CVC", "CID",
            "DEBIT", "CREDIT", "CARD", "CARDS", "PREPAID", "FOREX", "ATM", "CHIP", "SMART", "ELECTRON", "ELECTRONIC",
            "BANK", "BANKING", "FINANCE", "FINANCIAL", "FIN", "CUSTOMER", "CARE", "HELPLINE", "HELP", "SUPPORT",
            "ACCOUNT", "SERVICE", "SERVICES", "BRANCH", "OFFICE", "INDIA",
            "BUSINESS", "CORPORATE", "COMMERCIAL", "ENTERPRISE", "PLATINUM", "GOLD", "SILVER", "TITANIUM", "DIAMOND",
            "SIGNATURE", "INFINITE", "WORLD", "ELITE", "CLASSIC", "PREMIER", "PREMIUM", "PRIVILEGE", "SELECT",
            "PREFERRED", "PLUS", "PRIME", "PRO", "ZERO", "FIRST", "METAL", "BLACK", "WHITE", "EXCLUSIVE",
            "REWARDS", "REWARD", "POINTS", "POINT", "CASHBACK", "CLUB", "MILES",
            "MILLENNIA", "REGALIA", "INVENTIA", "SAPPHIRO", "RUBYX", "CORAL", "EMERALD", "MAGNUS", "BURGUNDY",
            "ATLAS", "APEX", "NEO", "ZONE", "ONE", "ONECARD", "SCAPIA", "FI", "JUPITER", "NIYO", "SLICE", "POSTPE", "LAZYPAY",
            "VISA", "MASTERCARD", "RUPAY", "AMEX", "AMERICAN", "EXPRESS", "DINERS", "DISCOVER", "JCB", "MAESTRO", "CIRRUS",
            "AUTHORIZED", "SIGNATURE", "NOT", "WITHOUT", "SIGNED", "SIGN", "HOLDER", "PROPERTY", "ISSUED", "RETURN",
            "FOUND", "PLEASE", "NEAREST", "TERMS", "CONDITIONS", "APPLY", "MEMBER", "SINCE", "CONTACTLESS",
            "DOMESTIC", "INTERNATIONAL", "GLOBAL", "NATIONAL", "CENTRAL", "STATE", "ONLY", "USE", "FOR",
            "CALL", "TOLL", "FREE", "LOST", "REPORT", "SECURITY", "SECURE", "CODE",
            "FLIPKART", "AMAZON", "PAYTM", "SWIGGY", "ZOMATO", "MYNTRA", "TATA", "TATANEU", "NEU", "RELIANCE", "JIO",
            "AIRTEL", "VODAFONE", "INDIANOIL", "IOCL", "BPCL", "HPCL", "OCTANE", "VISTARA", "INDIGO", "SPICEJET", "AIRINDIA",
            "MAKEMYTRIP", "MMT", "YATRA", "IRCTC", "BOOKMYSHOW", "PAY", "MONEY", "WALLET",
            "THE", "AND", "OR", "OF", "TO", "IN", "BY", "ON", "WITH", "AT", "IS", "IT", "BE", "ARE", "THIS", "THAT", "YOUR", "OUR", "ALL", "ANY", "IF", "AS", "AN"
        )

        for (i in lines.indices) {
            val line = lines[i]

            // 1. Geometrical check: cardholder name is NEVER in the top 35% of the card
            if (lineBoxes != null && cardBox != null && i < lineBoxes.size) {
                val box = lineBoxes[i]
                if (box.centerY() < cardBox.top + cardBox.height() * 0.35f) {
                    continue
                }
            }

            val trimmed = line.trim().uppercase()

            // Skip lines with digits or punctuation symbols
            if (trimmed.any { !it.isLetter() && it != ' ' && it != '.' }) continue

            // Letters and spaces only (allowing single dot for initial)
            val cleanLetters = trimmed.replace(".", "")
            if (!cleanLetters.matches(Regex("^[A-Z\\s]{3,30}$"))) continue

            val words = cleanLetters.split(Regex("\\s+")).filter { it.isNotEmpty() }
            if (words.size !in 2..4) continue

            // First and last words must be at least 2 characters
            if (words.first().length < 2 || words.last().length < 2) continue

            // At most one single-letter initial
            val singleLetterCount = words.count { it.length == 1 }
            if (singleLetterCount > 1) continue

            // Check exclusions
            val hasExclusion = words.any { exclusions.contains(it) || it == bankCode }
            if (hasExclusion) continue

            val totalLength = words.joinToString(" ").length
            if (totalLength !in 5..26) continue

            return words.joinToString(" ") { it.lowercase().replaceFirstChar { c -> c.uppercase() } }
        }

        return ""
    }

    private fun isValidLuhn(num: String): Boolean {
        if (num.length !in 13..19) return false
        var sum = 0
        var shouldDouble = false

        for (i in num.length - 1 downTo 0) {
            var digit = num[i].digitToIntOrNull() ?: return false
            if (shouldDouble) {
                digit *= 2
                if (digit > 9) digit -= 9
            }
            sum += digit
            shouldDouble = !shouldDouble
        }

        return sum % 10 == 0
    }

    private fun formatCardNumber(clean: String): String {
        return when {
            clean.length == 15 -> clean.replaceFirst(Regex("(\\d{4})(\\d{6})(\\d{5})"), "$1 $2 $3")
            clean.length == 14 -> clean.replaceFirst(Regex("(\\d{4})(\\d{6})(\\d{4})"), "$1 $2 $3")
            else -> clean.chunked(4).joinToString(" ")
        }
    }

    private fun dp(value: Float): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value,
            resources.displayMetrics
        ).toInt()
    }

    override fun onDestroy() {
        super.onDestroy()
        cameraExecutor.shutdown()
    }

    // --- Custom View for Card-Shaped Cutout and Scanning Laser ---
    inner class ScannerOverlayView(context: Context) : View(context) {

        private val maskPaint = Paint().apply {
            color = Color.parseColor("#B3000000") // 70% dark mask
            style = Paint.Style.FILL
        }

        private val clearPaint = Paint().apply {
            xfermode = PorterDuffXfermode(PorterDuff.Mode.CLEAR)
            isAntiAlias = true
        }

        private val framePaint = Paint().apply {
            color = Color.parseColor("#40FFFFFF")
            style = Paint.Style.STROKE
            strokeWidth = dp(1.5f).toFloat()
            isAntiAlias = true
        }



        private val cornerPaint = Paint().apply {
            color = Color.parseColor("#F59E0B") // Amber glow
            style = Paint.Style.STROKE
            strokeWidth = dp(4f).toFloat()
            strokeCap = Paint.Cap.ROUND
            isAntiAlias = true
        }

        private val laserPaint = Paint().apply {
            color = Color.parseColor("#10B981") // Emerald laser
            style = Paint.Style.STROKE
            strokeWidth = dp(2f).toFloat()
            isAntiAlias = true
        }

        private var cardRect = RectF()
        private var laserY = 0f
        private var laserAnimator: ValueAnimator? = null
        private var isDetected = false
        private var isVertical = false
        private var overlayState = OverlayState.SEARCHING

        init {
            setLayerType(LAYER_TYPE_SOFTWARE, null)
        }

        fun getCardRect(): RectF = RectF(cardRect)

        fun setOrientation(vertical: Boolean) {
            isVertical = vertical
            calculateCardRect(width, height)
            invalidate()
        }

        fun setOverlayState(state: OverlayState) {
            if (overlayState == state) return
            overlayState = state
            cornerPaint.color = when (state) {
                OverlayState.SEARCHING -> Color.parseColor("#F59E0B")
                OverlayState.STABILIZING -> Color.parseColor("#3B82F6")
                OverlayState.LOCKED -> Color.parseColor("#10B981")
            }
            postInvalidate()
        }

        fun setDetectedState(detected: Boolean) {
            setOverlayState(if (detected) OverlayState.LOCKED else OverlayState.SEARCHING)
            laserAnimator?.cancel()
            postInvalidate()
        }

        private fun calculateCardRect(w: Int, h: Int) {
            if (w <= 0 || h <= 0) return

            if (isVertical) {
                // Vertical card: aspect ratio 53.98 : 85.60 ~= 0.63
                val cardHeight = h * 0.58f
                val cardWidth = cardHeight / 1.586f
                val left = (w - cardWidth) / 2f
                val top = (h - cardHeight) / 2f - dp(10f)
                cardRect.set(left, top, left + cardWidth, top + cardHeight)
            } else {
                // Horizontal card: aspect ratio 85.60 : 53.98 ~= 1.586
                val cardWidth = w * 0.88f
                val cardHeight = cardWidth / 1.586f
                val left = (w - cardWidth) / 2f
                val top = (h - cardHeight) / 2f - dp(20f)
                cardRect.set(left, top, left + cardWidth, top + cardHeight)
            }

            // Restart animated scanning beam
            laserAnimator?.cancel()
            laserAnimator = ValueAnimator.ofFloat(cardRect.top, cardRect.bottom).apply {
                duration = 2000
                repeatCount = ValueAnimator.INFINITE
                repeatMode = ValueAnimator.REVERSE
                interpolator = LinearInterpolator()
                addUpdateListener { anim ->
                    laserY = anim.animatedValue as Float
                    invalidate()
                }
                start()
            }
        }

        override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
            super.onSizeChanged(w, h, oldw, oldh)
            calculateCardRect(w, h)
        }

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)

            val cornerRadius = dp(16f).toFloat()

            // 1. Draw dark background mask
            canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), maskPaint)

            // 2. Clear card cutout
            canvas.drawRoundRect(cardRect, cornerRadius, cornerRadius, clearPaint)

            // 3. Draw subtle card outline
            canvas.drawRoundRect(cardRect, cornerRadius, cornerRadius, framePaint)

            // 4. Draw corner guide brackets
            val bracketLen = dp(24f).toFloat()

            // Top-left
            canvas.drawLine(cardRect.left, cardRect.top + cornerRadius, cardRect.left, cardRect.top + cornerRadius + bracketLen, cornerPaint)
            canvas.drawLine(cardRect.left + cornerRadius, cardRect.top, cardRect.left + cornerRadius + bracketLen, cardRect.top, cornerPaint)

            // Top-right
            canvas.drawLine(cardRect.right, cardRect.top + cornerRadius, cardRect.right, cardRect.top + cornerRadius + bracketLen, cornerPaint)
            canvas.drawLine(cardRect.right - cornerRadius, cardRect.top, cardRect.right - cornerRadius - bracketLen, cardRect.top, cornerPaint)

            // Bottom-left
            canvas.drawLine(cardRect.left, cardRect.bottom - cornerRadius, cardRect.left, cardRect.bottom - cornerRadius - bracketLen, cornerPaint)
            canvas.drawLine(cardRect.left + cornerRadius, cardRect.bottom, cardRect.left + cornerRadius + bracketLen, cardRect.bottom, cornerPaint)

            // Bottom-right
            canvas.drawLine(cardRect.right, cardRect.bottom - cornerRadius, cardRect.right, cardRect.bottom - cornerRadius - bracketLen, cornerPaint)
            canvas.drawLine(cardRect.right - cornerRadius, cardRect.bottom, cardRect.right - cornerRadius - bracketLen, cardRect.bottom, cornerPaint)

            // 5. Draw animated scanning laser line if not completed
            if (!isDetected && laserY >= cardRect.top && laserY <= cardRect.bottom) {
                canvas.drawLine(cardRect.left + dp(8f), laserY, cardRect.right - dp(8f), laserY, laserPaint)
            }
        }
    }
}
