#import "CardScannerModule.h"
#import <AVFoundation/AVFoundation.h>
#import <Vision/Vision.h>
#import <React/RCTUtils.h>

@interface CardScannerViewController : UIViewController <AVCaptureVideoDataOutputSampleBufferDelegate>

@property (nonatomic, copy) void (^completionHandler)(NSDictionary *cardData);
@property (nonatomic, copy) void (^cancelHandler)(void);

@end

@implementation CardScannerViewController {
  AVCaptureSession *_captureSession;
  AVCaptureVideoPreviewLayer *_previewLayer;
  AVCaptureDevice *_cameraDevice;
  dispatch_queue_t _videoDataQueue;
  
  UIView *_overlayView;
  CAShapeLayer *_maskLayer;
  CAShapeLayer *_frameLayer;
  CAShapeLayer *_cornerLayer;
  CALayer *_laserLayer;
  
  UIButton *_torchButton;
  UIButton *_retryButton;
  UIButton *_orientationButton;
  UILabel *_instructionLabel;
  UILabel *_chipNumber;
  UILabel *_chipExpiry;
  UILabel *_chipCvv;
  UILabel *_chipName;
  UILabel *_chipBank;
  UIButton *_proceedButton;
  
  NSString *_detectedCardNumber;
  NSString *_detectedMonth;
  NSString *_detectedYear;
  NSString *_detectedCvv;
  NSString *_detectedOwnerName;
  NSString *_detectedBankName;
  NSString *_detectedNetwork;
  NSString *_detectedCardType;
  
  CGRect _cardRect;
  BOOL _isCompleted;
  BOOL _isTorchOn;
  BOOL _isVerticalMode;
  
  // Whole card detection & stability hold tracking to avoid wrong data
  BOOL _isCardLocked;
  NSInteger _cardStableFrames;
  NSTimeInterval _cardFirstDetectedTimestamp;
  CGFloat _lastCentroidX;
  CGFloat _lastCentroidY;
  NSString *_pendingCardNumberCandidate;
  NSInteger _pendingCardNumberCount;
  NSString *_pendingOwnerNameCandidate;
  NSInteger _pendingOwnerNameCount;
}

- (void)viewDidLoad {
  [super viewDidLoad];
  self.view.backgroundColor = [UIColor blackColor];
  
  _videoDataQueue = dispatch_queue_create("com.cwallet.cardscanner.queue", DISPATCH_QUEUE_SERIAL);
  
  [self setupCamera];
  [self setupOverlay];
  [self setupControls];
}

- (void)viewDidLayoutSubviews {
  [super viewDidLayoutSubviews];
  _previewLayer.frame = self.view.bounds;
  [self updateOverlayLayout];
}

- (void)setupCamera {
  _captureSession = [[AVCaptureSession alloc] init];
  _captureSession.sessionPreset = AVCaptureSessionPreset1920x1080; // High resolution for fine-print cards
  
  _cameraDevice = [AVCaptureDevice defaultDeviceWithMediaType:AVMediaTypeVideo];
  if (!_cameraDevice) return;
  
  NSError *error = nil;
  AVCaptureDeviceInput *input = [AVCaptureDeviceInput deviceInputWithDevice:_cameraDevice error:&error];
  if (error || ![_captureSession canAddInput:input]) return;
  [_captureSession addInput:input];
  
  // Continuous autofocus
  if ([_cameraDevice isFocusModeSupported:AVCaptureFocusModeContinuousAutoFocus]) {
    if ([_cameraDevice lockForConfiguration:nil]) {
      _cameraDevice.focusMode = AVCaptureFocusModeContinuousAutoFocus;
      [_cameraDevice unlockForConfiguration];
    }
  }
  
  AVCaptureVideoDataOutput *videoOutput = [[AVCaptureVideoDataOutput alloc] init];
  videoOutput.alwaysDiscardsLateVideoFrames = YES;
  [videoOutput setSampleBufferDelegate:self queue:_videoDataQueue];
  
  if ([_captureSession canAddOutput:videoOutput]) {
    [_captureSession addOutput:videoOutput];
  }
  
  AVCaptureConnection *connection = [videoOutput connectionWithMediaType:AVMediaTypeVideo];
  if ([connection isVideoOrientationSupported]) {
    connection.videoOrientation = AVCaptureVideoOrientationPortrait;
  }
  
  _previewLayer = [AVCaptureVideoPreviewLayer layerWithSession:_captureSession];
  _previewLayer.videoGravity = AVLayerVideoGravityResizeAspectFill;
  _previewLayer.frame = self.view.bounds;
  [self.view.layer addSublayer:_previewLayer];
  
  dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_HIGH, 0), ^{
    [self->_captureSession startRunning];
  });
}

- (void)setupOverlay {
  _overlayView = [[UIView alloc] initWithFrame:self.view.bounds];
  _overlayView.userInteractionEnabled = NO;
  [self.view addSubview:_overlayView];
  
  _maskLayer = [CAShapeLayer layer];
  _maskLayer.fillColor = [UIColor colorWithWhite:0.0 alpha:0.7].CGColor;
  _maskLayer.fillRule = kCAFillRuleEvenOdd;
  [_overlayView.layer addSublayer:_maskLayer];
  
  _frameLayer = [CAShapeLayer layer];
  _frameLayer.strokeColor = [UIColor colorWithWhite:1.0 alpha:0.25].CGColor;
  _frameLayer.fillColor = [UIColor clearColor].CGColor;
  _frameLayer.lineWidth = 1.5;
  [_overlayView.layer addSublayer:_frameLayer];
  
  _cornerLayer = [CAShapeLayer layer];
  _cornerLayer.strokeColor = [UIColor colorWithRed:245/255.0 green:158/255.0 blue:11/255.0 alpha:1.0].CGColor; // Amber
  _cornerLayer.fillColor = [UIColor clearColor].CGColor;
  _cornerLayer.lineWidth = 4.0;
  _cornerLayer.lineCap = kCALineCapRound;
  [_overlayView.layer addSublayer:_cornerLayer];
  
  _laserLayer = [CALayer layer];
  _laserLayer.backgroundColor = [UIColor colorWithRed:16/255.0 green:185/255.0 blue:129/255.0 alpha:0.9].CGColor; // Emerald
  [_overlayView.layer addSublayer:_laserLayer];
}

- (void)updateOverlayLayout {
  CGSize size = self.view.bounds.size;
  CGFloat cardWidth;
  CGFloat cardHeight;
  
  if (_isVerticalMode) {
    // Vertical card: aspect ratio 53.98 : 85.60 ~= 0.63
    cardHeight = size.height * 0.58;
    cardWidth = cardHeight / 1.586;
  } else {
    // Horizontal card: aspect ratio 85.60 : 53.98 ~= 1.586
    cardWidth = size.width * 0.88;
    cardHeight = cardWidth / 1.586;
  }
  
  CGFloat left = (size.width - cardWidth) / 2.0;
  CGFloat top = (size.height - cardHeight) / 2.0 - (_isVerticalMode ? 10.0 : 20.0);
  
  _cardRect = CGRectMake(left, top, cardWidth, cardHeight);
  CGFloat radius = 16.0;
  
  // 1. Dark mask with cutout
  UIBezierPath *path = [UIBezierPath bezierPathWithRect:self.view.bounds];
  UIBezierPath *cutout = [UIBezierPath bezierPathWithRoundedRect:_cardRect cornerRadius:radius];
  [path appendPath:cutout];
  _maskLayer.path = path.CGPath;
  
  // 2. Subtle frame
  _frameLayer.path = cutout.CGPath;
  
  // 3. Corner guide brackets
  CGFloat len = 24.0;
  UIBezierPath *corners = [UIBezierPath bezierPath];
  
  // Top-left
  [corners moveToPoint:CGPointMake(left, top + radius + len)];
  [corners addLineToPoint:CGPointMake(left, top + radius)];
  [corners moveToPoint:CGPointMake(left + radius, top)];
  [corners addLineToPoint:CGPointMake(left + radius + len, top)];
  
  // Top-right
  CGFloat right = left + cardWidth;
  [corners moveToPoint:CGPointMake(right, top + radius + len)];
  [corners addLineToPoint:CGPointMake(right, top + radius)];
  [corners moveToPoint:CGPointMake(right - radius, top)];
  [corners addLineToPoint:CGPointMake(right - radius - len, top)];
  
  // Bottom-left
  CGFloat bottom = top + cardHeight;
  [corners moveToPoint:CGPointMake(left, bottom - radius - len)];
  [corners addLineToPoint:CGPointMake(left, bottom - radius)];
  [corners moveToPoint:CGPointMake(left + radius, bottom)];
  [corners addLineToPoint:CGPointMake(left + radius + len, bottom)];
  
  // Bottom-right
  [corners moveToPoint:CGPointMake(right, bottom - radius - len)];
  [corners addLineToPoint:CGPointMake(right, bottom - radius)];
  [corners moveToPoint:CGPointMake(right - radius, bottom)];
  [corners addLineToPoint:CGPointMake(right - radius - len, bottom)];
  
  _cornerLayer.path = corners.CGPath;
  
  // 4. Scanning laser beam animation
  [_laserLayer removeAllAnimations];
  _laserLayer.frame = CGRectMake(left + 8, top, cardWidth - 16, 2);
  
  CABasicAnimation *laserAnim = [CABasicAnimation animationWithKeyPath:@"position.y"];
  laserAnim.fromValue = @(top + 8);
  laserAnim.toValue = @(bottom - 8);
  laserAnim.duration = 2.0;
  laserAnim.repeatCount = HUGE_VALF;
  laserAnim.autoreverses = YES;
  laserAnim.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionLinear];
  [_laserLayer addAnimation:laserAnim forKey:@"laserAnimation"];
}

- (void)setupControls {
  // Top bar view
  UIView *topBar = [[UIView alloc] initWithFrame:CGRectMake(0, 44, self.view.bounds.size.width, 50)];
  [self.view addSubview:topBar];
  
  // Close Button (solid vector xmark)
  UIButton *closeBtn = [UIButton buttonWithType:UIButtonTypeSystem];
  UIImageSymbolConfiguration *closeConfig = [UIImageSymbolConfiguration configurationWithPointSize:17 weight:UIImageSymbolWeightBold];
  UIImage *closeImg = [UIImage systemImageNamed:@"xmark" withConfiguration:closeConfig];
  [closeBtn setImage:closeImg forState:UIControlStateNormal];
  closeBtn.tintColor = [UIColor whiteColor];
  closeBtn.frame = CGRectMake(16, 5, 40, 40);
  closeBtn.backgroundColor = [UIColor colorWithWhite:0.0 alpha:0.4];
  closeBtn.layer.cornerRadius = 20;
  [closeBtn addTarget:self action:@selector(handleClose) forControlEvents:UIControlEventTouchUpInside];
  [topBar addSubview:closeBtn];
  
  // Torch Button (solid bolt icon)
  _torchButton = [UIButton buttonWithType:UIButtonTypeSystem];
  UIImageSymbolConfiguration *torchConfig = [UIImageSymbolConfiguration configurationWithPointSize:18 weight:UIImageSymbolWeightMedium];
  UIImage *torchImg = [UIImage systemImageNamed:@"bolt.fill" withConfiguration:torchConfig];
  [_torchButton setImage:torchImg forState:UIControlStateNormal];
  _torchButton.tintColor = [UIColor whiteColor];
  _torchButton.frame = CGRectMake(self.view.bounds.size.width - 56, 5, 40, 40);
  _torchButton.backgroundColor = [UIColor colorWithWhite:0.0 alpha:0.4];
  _torchButton.layer.cornerRadius = 20;
  [_torchButton addTarget:self action:@selector(toggleTorch) forControlEvents:UIControlEventTouchUpInside];
  [topBar addSubview:_torchButton];
  
  // Bottom container for real-time guidance, status chips, and Proceed action
  UIView *bottomContainer = [[UIView alloc] init];
  bottomContainer.translatesAutoresizingMaskIntoConstraints = NO;
  [self.view addSubview:bottomContainer];
  
  _instructionLabel = [[UILabel alloc] init];
  _instructionLabel.text = @"Position horizontal card inside frame\nDetails are detected automatically";
  _instructionLabel.textColor = [UIColor whiteColor];
  _instructionLabel.font = [UIFont systemFontOfSize:12 weight:UIFontWeightMedium];
  _instructionLabel.numberOfLines = 2;
  _instructionLabel.textAlignment = NSTextAlignmentCenter;
  _instructionLabel.backgroundColor = [UIColor colorWithWhite:0.0 alpha:0.75];
  _instructionLabel.layer.cornerRadius = 10;
  _instructionLabel.layer.masksToBounds = YES;
  _instructionLabel.translatesAutoresizingMaskIntoConstraints = NO;
  [bottomContainer addSubview:_instructionLabel];

  // Status chips stack: [Card No] [Expiry] [CVV] [Name] [Bank]
  UIStackView *chipsStack = [[UIStackView alloc] init];
  chipsStack.axis = UILayoutConstraintAxisHorizontal;
  chipsStack.distribution = UIStackViewDistributionFillEqually;
  chipsStack.spacing = 4;
  chipsStack.translatesAutoresizingMaskIntoConstraints = NO;
  
  _chipNumber = [self createStatusChip:@"Card No"];
  _chipExpiry = [self createStatusChip:@"Expiry"];
  _chipCvv = [self createStatusChip:@"CVV"];
  _chipName = [self createStatusChip:@"Name"];
  _chipBank = [self createStatusChip:@"Bank"];
  
  [chipsStack addArrangedSubview:_chipNumber];
  [chipsStack addArrangedSubview:_chipExpiry];
  [chipsStack addArrangedSubview:_chipCvv];
  [chipsStack addArrangedSubview:_chipName];
  [chipsStack addArrangedSubview:_chipBank];
  [bottomContainer addSubview:chipsStack];
  
  // Secondary controls row: [ Retry ] and [ Card: Horizontal / Vertical ]
  UIStackView *secondaryRow = [[UIStackView alloc] init];
  secondaryRow.axis = UILayoutConstraintAxisHorizontal;
  secondaryRow.distribution = UIStackViewDistributionFillEqually;
  secondaryRow.spacing = 10;
  secondaryRow.translatesAutoresizingMaskIntoConstraints = NO;

  _retryButton = [UIButton buttonWithType:UIButtonTypeSystem];
  UIImageSymbolConfiguration *retryConfig = [UIImageSymbolConfiguration configurationWithPointSize:13 weight:UIImageSymbolWeightSemibold];
  UIImage *retryImg = [UIImage systemImageNamed:@"arrow.clockwise" withConfiguration:retryConfig];
  [_retryButton setImage:retryImg forState:UIControlStateNormal];
  [_retryButton setTitle:@" Retry" forState:UIControlStateNormal];
  [_retryButton setTitleColor:[UIColor whiteColor] forState:UIControlStateNormal];
  _retryButton.tintColor = [UIColor whiteColor];
  _retryButton.titleLabel.font = [UIFont systemFontOfSize:13 weight:UIFontWeightBold];
  _retryButton.backgroundColor = [UIColor colorWithRed:55/255.0 green:65/255.0 blue:81/255.0 alpha:0.7];
  _retryButton.layer.cornerRadius = 18;
  _retryButton.layer.borderWidth = 1.0;
  _retryButton.layer.borderColor = [UIColor colorWithWhite:1.0 alpha:0.3].CGColor;
  [_retryButton addTarget:self action:@selector(handleRetry) forControlEvents:UIControlEventTouchUpInside];
  [secondaryRow addArrangedSubview:_retryButton];

  // Orientation Toggle Button (at bottom panel - solid card icon)
  _orientationButton = [UIButton buttonWithType:UIButtonTypeSystem];
  UIImageSymbolConfiguration *cardConfig = [UIImageSymbolConfiguration configurationWithPointSize:13 weight:UIImageSymbolWeightSemibold];
  UIImage *cardImg = [UIImage systemImageNamed:@"rectangle.fill" withConfiguration:cardConfig];
  [_orientationButton setImage:cardImg forState:UIControlStateNormal];
  [_orientationButton setTitle:@" Card: Horizontal" forState:UIControlStateNormal];
  [_orientationButton setTitleColor:[UIColor whiteColor] forState:UIControlStateNormal];
  _orientationButton.tintColor = [UIColor whiteColor];
  _orientationButton.titleLabel.font = [UIFont systemFontOfSize:13 weight:UIFontWeightBold];
  _orientationButton.backgroundColor = [UIColor colorWithWhite:0.0 alpha:0.5];
  _orientationButton.layer.cornerRadius = 18;
  _orientationButton.layer.borderWidth = 1.0;
  _orientationButton.layer.borderColor = [UIColor colorWithWhite:1.0 alpha:0.3].CGColor;
  [_orientationButton addTarget:self action:@selector(toggleOrientation) forControlEvents:UIControlEventTouchUpInside];
  [secondaryRow addArrangedSubview:_orientationButton];
  [bottomContainer addSubview:secondaryRow];
  
  // Proceed button
  _proceedButton = [UIButton buttonWithType:UIButtonTypeSystem];
  [_proceedButton setTitle:@"Scan card to proceed" forState:UIControlStateNormal];
  [_proceedButton setTitleColor:[UIColor colorWithRed:156/255.0 green:163/255.0 blue:175/255.0 alpha:1.0] forState:UIControlStateNormal];
  _proceedButton.titleLabel.font = [UIFont systemFontOfSize:14 weight:UIFontWeightBold];
  _proceedButton.backgroundColor = [UIColor colorWithRed:55/255.0 green:65/255.0 blue:81/255.0 alpha:0.7];
  _proceedButton.layer.cornerRadius = 12;
  _proceedButton.enabled = NO;
  [_proceedButton addTarget:self action:@selector(handleProceed) forControlEvents:UIControlEventTouchUpInside];
  _proceedButton.translatesAutoresizingMaskIntoConstraints = NO;
  [bottomContainer addSubview:_proceedButton];
  
  [NSLayoutConstraint activateConstraints:@[
    [bottomContainer.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor constant:16],
    [bottomContainer.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor constant:-16],
    [bottomContainer.bottomAnchor constraintEqualToAnchor:self.view.safeAreaLayoutGuide.bottomAnchor constant:-20],
    
    [_instructionLabel.topAnchor constraintEqualToAnchor:bottomContainer.topAnchor],
    [_instructionLabel.centerXAnchor constraintEqualToAnchor:bottomContainer.centerXAnchor],
    [_instructionLabel.leadingAnchor constraintGreaterThanOrEqualToAnchor:bottomContainer.leadingAnchor constant:8],
    [_instructionLabel.trailingAnchor constraintLessThanOrEqualToAnchor:bottomContainer.trailingAnchor constant:-8],
    [_instructionLabel.heightAnchor constraintEqualToConstant:40],
    
    [chipsStack.topAnchor constraintEqualToAnchor:_instructionLabel.bottomAnchor constant:8],
    [chipsStack.leadingAnchor constraintEqualToAnchor:bottomContainer.leadingAnchor],
    [chipsStack.trailingAnchor constraintEqualToAnchor:bottomContainer.trailingAnchor],
    [chipsStack.heightAnchor constraintEqualToConstant:26],
    
    [secondaryRow.topAnchor constraintEqualToAnchor:chipsStack.bottomAnchor constant:8],
    [secondaryRow.centerXAnchor constraintEqualToAnchor:bottomContainer.centerXAnchor],
    [secondaryRow.widthAnchor constraintEqualToConstant:280],
    [secondaryRow.heightAnchor constraintEqualToConstant:36],
    
    [_proceedButton.topAnchor constraintEqualToAnchor:secondaryRow.bottomAnchor constant:8],
    [_proceedButton.leadingAnchor constraintEqualToAnchor:bottomContainer.leadingAnchor],
    [_proceedButton.trailingAnchor constraintEqualToAnchor:bottomContainer.trailingAnchor],
    [_proceedButton.heightAnchor constraintEqualToConstant:46],
    [_proceedButton.bottomAnchor constraintEqualToAnchor:bottomContainer.bottomAnchor]
  ]];
}

- (UILabel *)createStatusChip:(NSString *)title {
  UILabel *label = [[UILabel alloc] init];
  label.text = title;
  label.textColor = [UIColor colorWithRed:156/255.0 green:163/255.0 blue:175/255.0 alpha:1.0];
  label.font = [UIFont systemFontOfSize:10 weight:UIFontWeightBold];
  label.textAlignment = NSTextAlignmentCenter;
  label.backgroundColor = [UIColor colorWithWhite:0.0 alpha:0.4];
  label.layer.cornerRadius = 6;
  label.layer.borderWidth = 1;
  label.layer.borderColor = [UIColor colorWithRed:75/255.0 green:85/255.0 blue:99/255.0 alpha:1.0].CGColor;
  label.layer.masksToBounds = YES;
  return label;
}

- (void)updateScannerUI {
  if (_isCompleted) return;
  
  // 1. Update Chips
  if (_detectedCardNumber.length > 0) {
    _chipNumber.text = [NSString stringWithFormat:@"✓ %@", _detectedCardNumber];
    _chipNumber.textColor = [UIColor whiteColor];
    _chipNumber.backgroundColor = [UIColor colorWithRed:16/255.0 green:185/255.0 blue:129/255.0 alpha:1.0];
    _chipNumber.layer.borderColor = [UIColor colorWithRed:5/255.0 green:150/255.0 blue:105/255.0 alpha:1.0].CGColor;
  }
  
  if (_detectedMonth.length > 0 && _detectedYear.length > 0) {
    _chipExpiry.text = [NSString stringWithFormat:@"✓ %@/%@", _detectedMonth, _detectedYear];
    _chipExpiry.textColor = [UIColor whiteColor];
    _chipExpiry.backgroundColor = [UIColor colorWithRed:16/255.0 green:185/255.0 blue:129/255.0 alpha:1.0];
    _chipExpiry.layer.borderColor = [UIColor colorWithRed:5/255.0 green:150/255.0 blue:105/255.0 alpha:1.0].CGColor;
  }
  
  if (_detectedCvv.length > 0) {
    _chipCvv.text = [NSString stringWithFormat:@"✓ CVV: %@", _detectedCvv];
    _chipCvv.textColor = [UIColor whiteColor];
    _chipCvv.backgroundColor = [UIColor colorWithRed:16/255.0 green:185/255.0 blue:129/255.0 alpha:1.0];
    _chipCvv.layer.borderColor = [UIColor colorWithRed:5/255.0 green:150/255.0 blue:105/255.0 alpha:1.0].CGColor;
  }
  
  if (_detectedOwnerName.length > 0) {
    _chipName.text = [NSString stringWithFormat:@"✓ %@", _detectedOwnerName];
    _chipName.textColor = [UIColor whiteColor];
    _chipName.backgroundColor = [UIColor colorWithRed:16/255.0 green:185/255.0 blue:129/255.0 alpha:1.0];
    _chipName.layer.borderColor = [UIColor colorWithRed:5/255.0 green:150/255.0 blue:105/255.0 alpha:1.0].CGColor;
  }
  
  if (_detectedBankName.length > 0) {
    _chipBank.text = [NSString stringWithFormat:@"✓ %@", _detectedBankName];
    _chipBank.textColor = [UIColor whiteColor];
    _chipBank.backgroundColor = [UIColor colorWithRed:16/255.0 green:185/255.0 blue:129/255.0 alpha:1.0];
    _chipBank.layer.borderColor = [UIColor colorWithRed:5/255.0 green:150/255.0 blue:105/255.0 alpha:1.0].CGColor;
  }
  
  // 2. Guidance text
  if (!_detectedCardNumber || _detectedCardNumber.length == 0) {
    if (!_isCardLocked && _cardStableFrames > 0) {
      _instructionLabel.text = @"Card detected! Hold steady...\nAligning card in frame";
    } else if (_isCardLocked) {
      _instructionLabel.text = @"Card locked! Reading card details...";
    } else {
      _instructionLabel.text = _isVerticalMode ? @"Position full vertical card inside frame\nEnsure entire card fits in the box" : @"Position full card inside frame\nEnsure entire card fits in the box";
    }
  } else if (!_detectedMonth || _detectedMonth.length == 0 || !_detectedCvv || _detectedCvv.length == 0) {
    NSString *missing = (!_detectedMonth || _detectedMonth.length == 0) && (!_detectedCvv || _detectedCvv.length == 0) ? @"expiry (MM/YY) & CVV" : ((!_detectedMonth || _detectedMonth.length == 0) ? @"expiry date (MM/YY)" : @"CVV (flip card if on back)");
    _instructionLabel.text = [NSString stringWithFormat:@"✓ Card number detected!\nNow focus on %@", missing];
  } else if (!_detectedOwnerName || _detectedOwnerName.length == 0) {
    _instructionLabel.text = @"✓ Expiry & CVV detected!\nNow focus on cardholder name";
  } else if (!_detectedBankName || _detectedBankName.length == 0) {
    _instructionLabel.text = @"✓ Name detected!\nNow focus on bank name / logo";
  } else {
    _instructionLabel.text = @"✓ All card details captured!";
  }
  
  // 3. Update Proceed button
  if (_detectedCardNumber.length > 0) {
    _proceedButton.enabled = YES;
    [_proceedButton setTitle:@"Proceed with Scanned Details" forState:UIControlStateNormal];
    [_proceedButton setTitleColor:[UIColor whiteColor] forState:UIControlStateNormal];
    _proceedButton.backgroundColor = [UIColor colorWithRed:16/255.0 green:185/255.0 blue:129/255.0 alpha:1.0];
  }
}

- (void)handleProceed {
  if (_isCompleted || !_detectedCardNumber || _detectedCardNumber.length == 0) return;
  _isCompleted = YES;
  
  [self triggerSuccessWithCardNumber:_detectedCardNumber
                               month:_detectedMonth
                                year:_detectedYear
                             network:_detectedNetwork
                            bankName:_detectedBankName
                            cardType:_detectedCardType
                           ownerName:_detectedOwnerName
                                 cvv:_detectedCvv];
}

- (void)handleRetry {
  _detectedCardNumber = @"";
  _detectedMonth = @"";
  _detectedYear = @"";
  _detectedCvv = @"";
  _detectedOwnerName = @"";
  _detectedBankName = @"";
  _detectedNetwork = @"";
  _detectedCardType = @"";

  _isCardLocked = NO;
  _cardStableFrames = 0;
  _cardFirstDetectedTimestamp = 0;
  _lastCentroidX = 0;
  _lastCentroidY = 0;
  _pendingCardNumberCandidate = nil;
  _pendingCardNumberCount = 0;
  _pendingOwnerNameCandidate = nil;
  _pendingOwnerNameCount = 0;

  _cornerLayer.strokeColor = [UIColor colorWithRed:245/255.0 green:158/255.0 blue:11/255.0 alpha:1.0].CGColor;

  [self resetStatusChip:_chipNumber title:@"Card No"];
  [self resetStatusChip:_chipExpiry title:@"Expiry"];
  [self resetStatusChip:_chipCvv title:@"CVV"];
  [self resetStatusChip:_chipName title:@"Name"];
  [self resetStatusChip:_chipBank title:@"Bank"];

  _proceedButton.enabled = NO;
  [_proceedButton setTitle:@"Scan card to proceed" forState:UIControlStateNormal];
  [_proceedButton setTitleColor:[UIColor colorWithRed:156/255.0 green:163/255.0 blue:175/255.0 alpha:1.0] forState:UIControlStateNormal];
  _proceedButton.backgroundColor = [UIColor colorWithRed:55/255.0 green:65/255.0 blue:81/255.0 alpha:0.7];

  _instructionLabel.text = _isVerticalMode ? @"Position full vertical card inside frame\nEnsure entire card fits in the box" : @"Position full card inside frame\nEnsure entire card fits in the box";
}

- (void)resetStatusChip:(UILabel *)chip title:(NSString *)title {
  chip.text = title;
  chip.textColor = [UIColor colorWithRed:156/255.0 green:163/255.0 blue:175/255.0 alpha:1.0];
  chip.backgroundColor = [UIColor colorWithWhite:0.0 alpha:0.4];
  chip.layer.borderColor = [UIColor colorWithRed:75/255.0 green:85/255.0 blue:99/255.0 alpha:1.0].CGColor;
}

- (void)toggleOrientation {
  _isVerticalMode = !_isVerticalMode;
  [self updateOverlayLayout];
  
  UIImageSymbolConfiguration *cardConfig = [UIImageSymbolConfiguration configurationWithPointSize:13 weight:UIImageSymbolWeightSemibold];
  if (_isVerticalMode) {
    UIImage *vertImg = [UIImage systemImageNamed:@"rectangle.portrait.fill" withConfiguration:cardConfig];
    [_orientationButton setImage:vertImg forState:UIControlStateNormal];
    [_orientationButton setTitle:@" Card: Vertical" forState:UIControlStateNormal];
    _instructionLabel.text = @"Position vertical card inside frame\nDetails are detected automatically";
  } else {
    UIImage *horizImg = [UIImage systemImageNamed:@"rectangle.fill" withConfiguration:cardConfig];
    [_orientationButton setImage:horizImg forState:UIControlStateNormal];
    [_orientationButton setTitle:@" Card: Horizontal" forState:UIControlStateNormal];
    _instructionLabel.text = @"Position horizontal card inside frame\nDetails are detected automatically";
  }
}

- (void)handleClose {
  if (_isCompleted) return;
  _isCompleted = YES;
  [_captureSession stopRunning];
  if (self.cancelHandler) {
    self.cancelHandler();
  }
  [self dismissViewControllerAnimated:YES completion:nil];
}

- (void)toggleTorch {
  if (!_cameraDevice || ![_cameraDevice hasTorch]) return;
  
  NSError *error = nil;
  if ([_cameraDevice lockForConfiguration:&error]) {
    _isTorchOn = !_isTorchOn;
    _cameraDevice.torchMode = _isTorchOn ? AVCaptureTorchModeOn : AVCaptureTorchModeOff;
    [_cameraDevice unlockForConfiguration];
    
    _torchButton.tintColor = _isTorchOn ? [UIColor colorWithRed:245/255.0 green:158/255.0 blue:11/255.0 alpha:1.0] : [UIColor whiteColor];
  }
}

#pragma mark - AVCaptureVideoDataOutputSampleBufferDelegate

- (void)captureOutput:(AVCaptureOutput *)output
didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer
       fromConnection:(AVCaptureConnection *)connection
{
  if (_isCompleted) return;
  
  CVImageBufferRef pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer);
  if (!pixelBuffer) return;
  
  size_t bufferWidth = CVPixelBufferGetWidth(pixelBuffer);
  size_t bufferHeight = CVPixelBufferGetHeight(pixelBuffer);
  
  // Portrait video buffer orientation (kCGImagePropertyOrientationRight)
  CGFloat imgWidth = (CGFloat)bufferHeight;
  CGFloat imgHeight = (CGFloat)bufferWidth;
  
  CGFloat viewWidth = self.view.bounds.size.width;
  CGFloat viewHeight = self.view.bounds.size.height;
  
  CGFloat scale = MAX(viewWidth / imgWidth, viewHeight / imgHeight);
  CGFloat dispWidth = imgWidth * scale;
  CGFloat dispHeight = imgHeight * scale;
  CGFloat dx = (viewWidth - dispWidth) / 2.0;
  CGFloat dy = (viewHeight - dispHeight) / 2.0;
  
  VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] initWithCompletionHandler:^(VNRequest * _Nonnull req, NSError * _Nullable error) {
    if (error || self->_isCompleted) return;
    
    CGRect expandedCardRect = CGRectInset(self->_cardRect, -16.0, -16.0);
    NSMutableArray<NSString *> *lines = [NSMutableArray array];
    
    NSMutableArray<NSValue *> *lineBoxes = [NSMutableArray array];
    for (VNRecognizedTextObservation *obs in req.results) {
      VNRecognizedText *topCandidate = [[obs topCandidates:1] firstObject];
      if (topCandidate && topCandidate.string.length > 0) {
        // Vision coordinates: normalized with (0,0) at bottom-left
        CGFloat normCenterX = obs.boundingBox.origin.x + obs.boundingBox.size.width / 2.0;
        CGFloat normCenterY = 1.0 - (obs.boundingBox.origin.y + obs.boundingBox.size.height / 2.0);
        
        CGFloat screenX = normCenterX * imgWidth * scale + dx;
        CGFloat screenY = normCenterY * imgHeight * scale + dy;
        CGPoint screenPoint = CGPointMake(screenX, screenY);
        
        // STRICT: Only scan and accept text positioned INSIDE the card cutout box!
        if (CGRectContainsPoint(expandedCardRect, screenPoint)) {
          NSString *text = [topCandidate.string stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
          [lines addObject:text];
          
          // Project full bounding box to screen coordinates for card presence detection
          CGFloat normLeft = obs.boundingBox.origin.x;
          CGFloat normTop = 1.0 - (obs.boundingBox.origin.y + obs.boundingBox.size.height);
          CGFloat normWidth = obs.boundingBox.size.width;
          CGFloat normHeight = obs.boundingBox.size.height;
          CGRect screenBox = CGRectMake(
            normLeft * imgWidth * scale + dx,
            normTop * imgHeight * scale + dy,
            normWidth * imgWidth * scale,
            normHeight * imgHeight * scale
          );
          [lineBoxes addObject:[NSValue valueWithCGRect:screenBox]];
        }
      }
    }
    
    if (lines.count == 0) {
      if (self->_isCardLocked || self->_cardStableFrames > 0) {
        self->_cardStableFrames = 0;
        self->_cardFirstDetectedTimestamp = 0;
        self->_isCardLocked = NO;
        dispatch_async(dispatch_get_main_queue(), ^{
          self->_cornerLayer.strokeColor = [UIColor colorWithRed:245/255.0 green:158/255.0 blue:11/255.0 alpha:1.0].CGColor;
          [self updateScannerUI];
        });
      }
      return;
    }

    // --- WHOLE CARD CONTAINMENT CHECK ---
    // Ensure the entire card is fully placed inside the box and not clipped by the frame.
    CGFloat margin = 14.0;
    CGRect cardRect = self->_cardRect;
    BOOL allWithinBounds = YES;
    for (NSValue *boxVal in lineBoxes) {
      CGRect b = [boxVal CGRectValue];
      if (b.origin.x < cardRect.origin.x - margin ||
          CGRectGetMaxX(b) > CGRectGetMaxX(cardRect) + margin ||
          b.origin.y < cardRect.origin.y - margin ||
          CGRectGetMaxY(b) > CGRectGetMaxY(cardRect) + margin) {
        allWithinBounds = NO;
        break;
      }
    }

    CGFloat minX = CGFLOAT_MAX, maxX = -CGFLOAT_MAX;
    CGFloat minY = CGFLOAT_MAX, maxY = -CGFLOAT_MAX;
    CGFloat sumX = 0, sumY = 0;
    for (NSValue *boxVal in lineBoxes) {
      CGRect b = [boxVal CGRectValue];
      if (b.origin.x < minX) minX = b.origin.x;
      if (CGRectGetMaxX(b) > maxX) maxX = CGRectGetMaxX(b);
      if (b.origin.y < minY) minY = b.origin.y;
      if (CGRectGetMaxY(b) > maxY) maxY = CGRectGetMaxY(b);
      sumX += CGRectGetMidX(b);
      sumY += CGRectGetMidY(b);
    }

    CGFloat widthCoverage = (maxX - minX) / cardRect.size.width;
    CGFloat heightCoverage = (maxY - minY) / cardRect.size.height;
    BOOL hasAdequateCoverage = (widthCoverage >= 0.30) && (heightCoverage >= 0.18) && (lines.count >= 2);
    BOOL wholeCardInside = allWithinBounds && hasAdequateCoverage;

    if (!wholeCardInside) {
      self->_cardStableFrames = 0;
      self->_cardFirstDetectedTimestamp = 0;
      self->_isCardLocked = NO;
      dispatch_async(dispatch_get_main_queue(), ^{
        self->_cornerLayer.strokeColor = [UIColor colorWithRed:245/255.0 green:158/255.0 blue:11/255.0 alpha:1.0].CGColor;
        if (!self->_detectedCardNumber || self->_detectedCardNumber.length == 0) {
          self->_instructionLabel.text = self->_isVerticalMode ? @"Position full vertical card inside frame\nEnsure entire card fits in the box" : @"Position full card inside frame\nEnsure entire card fits in the box";
        }
      });
      return;
    }

    // --- STABILITY HOLD CHECK ---
    // Verify user is holding the card steady inside the box
    CGFloat currentCentroidX = sumX / (CGFloat)lineBoxes.count;
    CGFloat currentCentroidY = sumY / (CGFloat)lineBoxes.count;
    BOOL isSteady = (fabs(currentCentroidX - self->_lastCentroidX) < 25.0) &&
                    (fabs(currentCentroidY - self->_lastCentroidY) < 25.0);
    self->_lastCentroidX = currentCentroidX;
    self->_lastCentroidY = currentCentroidY;

    NSTimeInterval now = [[NSDate date] timeIntervalSince1970];
    if (self->_cardFirstDetectedTimestamp == 0 || !isSteady) {
      self->_cardFirstDetectedTimestamp = now;
      self->_cardStableFrames = 1;
    } else {
      self->_cardStableFrames++;
    }

    NSTimeInterval holdDuration = now - self->_cardFirstDetectedTimestamp;
    if (holdDuration < 0.5 || self->_cardStableFrames < 3) {
      dispatch_async(dispatch_get_main_queue(), ^{
        self->_cornerLayer.strokeColor = [UIColor colorWithRed:59/255.0 green:130/255.0 blue:246/255.0 alpha:1.0].CGColor; // Blue (hold steady)
        if (!self->_detectedCardNumber || self->_detectedCardNumber.length == 0) {
          self->_instructionLabel.text = @"Card detected! Hold steady...\nAligning card in frame";
        }
      });
      return;
    }

    // Card is locked & steady inside the box!
    self->_isCardLocked = YES;
    dispatch_async(dispatch_get_main_queue(), ^{
      self->_cornerLayer.strokeColor = [UIColor colorWithRed:16/255.0 green:185/255.0 blue:129/255.0 alpha:1.0].CGColor; // Green (locked)
    });

    [self processExtractedLines:lines lineBoxes:lineBoxes];
  }];
  
  request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
  request.usesLanguageCorrection = NO; // Disable dictionary correction for numbers and codes
  
  VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCVPixelBuffer:pixelBuffer orientation:kCGImagePropertyOrientationRight options:@{}];
  [handler performRequests:@[request] error:nil];
}

#pragma mark - Card Text Parsing

- (NSString *)cleanOcrDigits:(NSString *)text {
  NSMutableString *result = [text mutableCopy];
  NSRegularExpression *r1 = [NSRegularExpression regularExpressionWithPattern:@"[OoQqDd]" options:0 error:nil];
  [r1 replaceMatchesInString:result options:0 range:NSMakeRange(0, result.length) withTemplate:@"0"];
  NSRegularExpression *r2 = [NSRegularExpression regularExpressionWithPattern:@"[Il|\\]\\[!]" options:0 error:nil];
  [r2 replaceMatchesInString:result options:0 range:NSMakeRange(0, result.length) withTemplate:@"1"];
  NSRegularExpression *r3 = [NSRegularExpression regularExpressionWithPattern:@"[Zz]" options:0 error:nil];
  [r3 replaceMatchesInString:result options:0 range:NSMakeRange(0, result.length) withTemplate:@"2"];
  NSRegularExpression *r4 = [NSRegularExpression regularExpressionWithPattern:@"[Ss$]" options:0 error:nil];
  [r4 replaceMatchesInString:result options:0 range:NSMakeRange(0, result.length) withTemplate:@"5"];
  NSRegularExpression *r5 = [NSRegularExpression regularExpressionWithPattern:@"[Gg]" options:0 error:nil];
  [r5 replaceMatchesInString:result options:0 range:NSMakeRange(0, result.length) withTemplate:@"6"];
  NSRegularExpression *r6 = [NSRegularExpression regularExpressionWithPattern:@"[Bb]" options:0 error:nil];
  [r6 replaceMatchesInString:result options:0 range:NSMakeRange(0, result.length) withTemplate:@"8"];
  NSRegularExpression *r7 = [NSRegularExpression regularExpressionWithPattern:@"[Tt]" options:0 error:nil];
  [r7 replaceMatchesInString:result options:0 range:NSMakeRange(0, result.length) withTemplate:@"7"];
  return result;
}

- (void)processExtractedLines:(NSArray<NSString *> *)lines lineBoxes:(NSArray<NSValue *> *)lineBoxes {
  if (_isCompleted || lines.count == 0) return;
  
  NSString *fullText = [lines componentsJoinedByString:@"\n"];
  
  // 1. Extract valid Luhn card number with multi-frame confirmation to prevent OCR misreads
  NSString *cardNumber = [self extractCardNumber:lines fullText:fullText];
  if (cardNumber && cardNumber.length > 0) {
    if ([cardNumber isEqualToString:_pendingCardNumberCandidate]) {
      _pendingCardNumberCount++;
    } else {
      _pendingCardNumberCandidate = cardNumber;
      _pendingCardNumberCount = 1;
    }

    NSString *cleanDigits = [[cardNumber componentsSeparatedByCharactersInSet:[[NSCharacterSet decimalDigitCharacterSet] invertedSet]] componentsJoinedByString:@""];
    if (_pendingCardNumberCount >= 2 || (!_detectedCardNumber && _pendingCardNumberCount >= 1 && [self isValidLuhn:cleanDigits])) {
      if (!_detectedCardNumber || _detectedCardNumber.length == 0) {
        if (@available(iOS 10.0, *)) {
          UIImpactFeedbackGenerator *feedback = [[UIImpactFeedbackGenerator alloc] initWithStyle:UIImpactFeedbackStyleMedium];
          [feedback impactOccurred];
        }
      }
      _detectedCardNumber = cardNumber;
    }
  }
  
  // 2. Extract expiry (multi-line and single-line)
  NSDictionary *exp = [self extractExpiry:lines fullText:fullText];
  NSString *month = exp[@"month"] ?: @"";
  NSString *year = exp[@"year"] ?: @"";
  if (month.length > 0 && year.length > 0) {
    _detectedMonth = month;
    _detectedYear = year;
  }
  
  // 3. Extract CVV (if on back or front)
  NSString *cvv = [self extractCvv:lines fullText:fullText cardNumber:_detectedCardNumber ?: @""];
  if (cvv && cvv.length > 0) {
    _detectedCvv = cvv;
  }
  
  // 4. Extract network
  NSString *network = [self extractNetwork:fullText cardNumber:_detectedCardNumber ?: @""];
  if (network && network.length > 0) {
    _detectedNetwork = network;
  }
  
  // 5. Extract bank (supports standard + modern vertical brands)
  NSString *bankName = [self extractBank:fullText];
  if (bankName && bankName.length > 0) {
    _detectedBankName = bankName;
  }
  
  // 6. Extract card type
  NSString *cardType = [self extractCardType:fullText];
  if (cardType && cardType.length > 0) {
    _detectedCardType = cardType;
  }
  
  // 7. Extract cardholder name (filtered by position & verified across frames)
  if (!_detectedOwnerName || _detectedOwnerName.length == 0) {
    NSString *ownerName = [self extractCardholderName:lines lineBoxes:lineBoxes cardRect:_cardRect bankCode:_detectedBankName];
    if (ownerName && ownerName.length > 0) {
      if ([ownerName isEqualToString:_pendingOwnerNameCandidate]) {
        _pendingOwnerNameCount++;
      } else {
        _pendingOwnerNameCandidate = ownerName;
        _pendingOwnerNameCount = 1;
      }

      if (_pendingOwnerNameCount >= 2) {
        _detectedOwnerName = ownerName;
      }
    }
  }
  
  dispatch_async(dispatch_get_main_queue(), ^{
    [self updateScannerUI];
  });
}

- (NSString *)extractCvv:(NSArray<NSString *> *)lines fullText:(NSString *)fullText cardNumber:(NSString *)cardNumber {
  // Build exclusion set from card number digits and expiry
  NSString *cardDigits = [[cardNumber componentsSeparatedByCharactersInSet:[[NSCharacterSet decimalDigitCharacterSet] invertedSet]] componentsJoinedByString:@""];
  NSMutableSet<NSString *> *excludedDigits = [NSMutableSet set];
  if (cardDigits.length >= 3) {
    for (NSUInteger i = 0; i <= cardDigits.length - 3; i++) {
      [excludedDigits addObject:[cardDigits substringWithRange:NSMakeRange(i, 3)]];
    }
  }
  if (_detectedMonth.length > 0) [excludedDigits addObject:_detectedMonth];
  if (_detectedYear.length > 0) [excludedDigits addObject:_detectedYear];

  BOOL (^isBasicCvv)(NSString *) = ^BOOL(NSString *candidate) {
    if (candidate.length < 3 || candidate.length > 4) return NO;
    NSCharacterSet *firstCharSet = [NSCharacterSet characterSetWithCharactersInString:[candidate substringToIndex:1]];
    NSString *stripped = [[candidate componentsSeparatedByCharactersInSet:firstCharSet] componentsJoinedByString:@""];
    return stripped.length > 0;
  };

  BOOL (^isValidCvv)(NSString *) = ^BOOL(NSString *candidate) {
    if (!isBasicCvv(candidate)) return NO;
    if ([excludedDigits containsObject:candidate]) return NO;
    return YES;
  };

  // Pattern 1: Explicit labels like CVV 123, CVC: 456, CID: 1234, SECURITY CODE: 789
  NSRegularExpression *labeledRegex = [NSRegularExpression regularExpressionWithPattern:@"(?i)(?:\\b(?:CVV2?|CVC2?|CID|SECURITY\\s*CODE|SEC(?:URITY)?\\s*(?:NO|NUM|NUMBER|CODE)?)\\b)[\\s:#\\.-]*([0-9]{3,4})\\b" options:0 error:nil];
  NSTextCheckingResult *labeledMatch = [labeledRegex firstMatchInString:fullText options:0 range:NSMakeRange(0, fullText.length)];
  if (labeledMatch && labeledMatch.numberOfRanges > 1) {
    NSString *candidate = [fullText substringWithRange:[labeledMatch rangeAtIndex:1]];
    if (isBasicCvv(candidate)) return candidate;
  }

  // Pattern 2: Line with CVV/CVC/CID label and next line with digits
  for (NSUInteger i = 0; i + 1 < lines.count; i++) {
    NSString *trimmed = [lines[i] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
    NSRegularExpression *labelOnly = [NSRegularExpression regularExpressionWithPattern:@"^(?i)(?:CVV2?|CVC2?|CID|SEC(?:URITY)?(?:\\s*CODE)?)$" options:0 error:nil];
    if ([labelOnly numberOfMatchesInString:trimmed options:0 range:NSMakeRange(0, trimmed.length)] > 0) {
      NSString *repaired = [self cleanOcrDigits:[lines[i + 1] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]]];
      NSString *clean = [[repaired componentsSeparatedByCharactersInSet:[[NSCharacterSet decimalDigitCharacterSet] invertedSet]] componentsJoinedByString:@""];
      if (isBasicCvv(clean)) return clean;
    }
  }

  // Pattern 3: Signature strip pattern (last 4 digits + 3 CVV digits)
  if (cardDigits.length >= 4) {
    NSString *last4 = [cardDigits substringFromIndex:cardDigits.length - 4];
    NSString *stripPattern = [NSString stringWithFormat:@"\\b%@\\s+([0-9]{3})\\b", last4];
    NSRegularExpression *stripRegex = [NSRegularExpression regularExpressionWithPattern:stripPattern options:0 error:nil];
    NSTextCheckingResult *stripMatch = [stripRegex firstMatchInString:fullText options:0 range:NSMakeRange(0, fullText.length)];
    if (stripMatch && stripMatch.numberOfRanges > 1) {
      NSString *candidate = [fullText substringWithRange:[stripMatch rangeAtIndex:1]];
      if (isBasicCvv(candidate)) return candidate;
    }
  }

  // Pattern 4: Standalone 3-digit number on card back (no label needed)
  NSRegularExpression *datePattern = [NSRegularExpression regularExpressionWithPattern:@"(?:0[1-9]|1[0-2])\\s*[/\\-\\.]\\s*[0-9]{2,4}" options:0 error:nil];
  NSRegularExpression *alphaOnly = [NSRegularExpression regularExpressionWithPattern:@"^[A-Za-z\\s]+$" options:0 error:nil];
  NSRegularExpression *standaloneRegex = [NSRegularExpression regularExpressionWithPattern:@"\\b([0-9]{3})\\b" options:0 error:nil];

  for (NSString *line in lines) {
    NSString *trimmed = [line stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
    if ([datePattern numberOfMatchesInString:trimmed options:0 range:NSMakeRange(0, trimmed.length)] > 0) continue;
    if ([alphaOnly numberOfMatchesInString:trimmed options:0 range:NSMakeRange(0, trimmed.length)] > 0) continue;

    NSArray<NSTextCheckingResult *> *matches = [standaloneRegex matchesInString:trimmed options:0 range:NSMakeRange(0, trimmed.length)];
    for (NSTextCheckingResult *match in matches) {
      NSString *candidate = [trimmed substringWithRange:[match rangeAtIndex:1]];
      if (isValidCvv(candidate)) return candidate;
    }
  }

  return @"";
}

- (void)triggerSuccessWithCardNumber:(NSString *)cardNumber
                               month:(NSString *)month
                                year:(NSString *)year
                             network:(NSString *)network
                            bankName:(NSString *)bankName
                            cardType:(NSString *)cardType
                           ownerName:(NSString *)ownerName
                                 cvv:(NSString *)cvv
{
  _cornerLayer.strokeColor = [UIColor colorWithRed:16/255.0 green:185/255.0 blue:129/255.0 alpha:1.0].CGColor;
  [_laserLayer removeAllAnimations];
  _laserLayer.opacity = 0;
  
  if (@available(iOS 10.0, *)) {
    UINotificationFeedbackGenerator *generator = [[UINotificationFeedbackGenerator alloc] init];
    [generator notificationOccurred:UINotificationFeedbackTypeSuccess];
  }
  
  [_captureSession stopRunning];
  
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.3 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    NSDictionary *result = @{
      @"cardNumber": cardNumber ?: @"",
      @"month": month ?: @"",
      @"year": year ?: @"",
      @"network": network ?: @"",
      @"bankName": bankName ?: @"",
      @"cardType": cardType ?: @"",
      @"ownerName": ownerName ?: @"",
      @"cvv": cvv ?: @""
    };
    
    if (self.completionHandler) {
      self.completionHandler(result);
    }
    [self dismissViewControllerAnimated:YES completion:nil];
  });
}

#pragma mark - Helper Parsers

- (NSString *)extractCardNumber:(NSArray<NSString *> *)lines fullText:(NSString *)fullText {
  NSRegularExpression *regex = [NSRegularExpression regularExpressionWithPattern:@"\\b(?:\\d{4}[ -]?\\d{4}[ -]?\\d{4}[ -]?\\d{4}|\\d{4}[ -]?\\d{6}[ -]?\\d{4,5}|\\d{13,19})\\b" options:0 error:nil];
  
  // Strategy 1: Direct line match
  for (NSString *line in lines) {
    NSArray<NSTextCheckingResult *> *matches = [regex matchesInString:line options:0 range:NSMakeRange(0, line.length)];
    for (NSTextCheckingResult *match in matches) {
      NSString *raw = [line substringWithRange:match.range];
      NSString *clean = [[raw componentsSeparatedByCharactersInSet:[[NSCharacterSet decimalDigitCharacterSet] invertedSet]] componentsJoinedByString:@""];
      if ([self isValidLuhn:clean]) {
        return [self formatCardNumber:clean];
      }
    }
  }
  
  // Strategy 2: Repaired lines with OCR character substitution
  for (NSString *line in lines) {
    NSString *repaired = [self cleanOcrDigits:line];
    NSArray<NSTextCheckingResult *> *matches = [regex matchesInString:repaired options:0 range:NSMakeRange(0, repaired.length)];
    for (NSTextCheckingResult *match in matches) {
      NSString *raw = [repaired substringWithRange:match.range];
      NSString *clean = [[raw componentsSeparatedByCharactersInSet:[[NSCharacterSet decimalDigitCharacterSet] invertedSet]] componentsJoinedByString:@""];
      if ([self isValidLuhn:clean]) {
        return [self formatCardNumber:clean];
      }
    }
  }
  
  // Strategy 3: Handle vertically printed cards (stacked 4-digit groups)
  NSMutableArray<NSString *> *fourDigitTokens = [NSMutableArray array];
  for (NSString *line in lines) {
    NSString *repaired = [self cleanOcrDigits:[line stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]]];
    NSString *clean = [[repaired componentsSeparatedByCharactersInSet:[[NSCharacterSet decimalDigitCharacterSet] invertedSet]] componentsJoinedByString:@""];
    if (clean.length == 4) {
      [fourDigitTokens addObject:clean];
    } else if (clean.length == 8) {
      [fourDigitTokens addObject:[clean substringWithRange:NSMakeRange(0, 4)]];
      [fourDigitTokens addObject:[clean substringWithRange:NSMakeRange(4, 4)]];
    }
  }
  
  if (fourDigitTokens.count >= 4) {
    for (NSUInteger i = 0; i <= fourDigitTokens.count - 4; i++) {
      NSString *candidate = [NSString stringWithFormat:@"%@%@%@%@", fourDigitTokens[i], fourDigitTokens[i+1], fourDigitTokens[i+2], fourDigitTokens[i+3]];
      if ([self isValidLuhn:candidate]) {
        return [self formatCardNumber:candidate];
      }
    }
  }
  
  // Strategy 4: Full text
  NSArray<NSTextCheckingResult *> *matches = [regex matchesInString:fullText options:0 range:NSMakeRange(0, fullText.length)];
  for (NSTextCheckingResult *match in matches) {
    NSString *raw = [fullText substringWithRange:match.range];
    NSString *clean = [[raw componentsSeparatedByCharactersInSet:[[NSCharacterSet decimalDigitCharacterSet] invertedSet]] componentsJoinedByString:@""];
    if ([self isValidLuhn:clean]) {
      return [self formatCardNumber:clean];
    }
  }
  
  return nil;
}

- (NSDictionary *)extractExpiry:(NSArray<NSString *> *)lines fullText:(NSString *)fullText {
  NSRegularExpression *regex = [NSRegularExpression regularExpressionWithPattern:@"(?i)(?:VALID\\s+THRU|GOOD\\s+THRU|EXPIRES|EXP|VAL|THRU|MONTH\\/YEAR|MM\\/YY)?\\s*[:\\s]?\\s*(0[1-9]|1[0-2])\\s*[\\/\\-\\.\\s]\\s*([2-3][0-9])\\b" options:0 error:nil];
  
  // Single line match
  for (NSString *line in lines) {
    NSString *repaired = [line stringByReplacingOccurrencesOfString:@"O" withString:@"0"];
    NSTextCheckingResult *match = [regex firstMatchInString:repaired options:0 range:NSMakeRange(0, repaired.length)];
    if (match && match.numberOfRanges >= 3) {
      NSString *month = [repaired substringWithRange:[match rangeAtIndex:1]];
      NSString *year = [repaired substringWithRange:[match rangeAtIndex:2]];
      NSInteger mNum = [month integerValue];
      NSInteger yNum = [year integerValue];
      if (mNum >= 1 && mNum <= 12 && yNum >= 24 && yNum <= 39) {
        return @{ @"month": month ?: @"", @"year": year ?: @"" };
      }
    }
  }
  
  // Multi-line match (line i has "EXP", line i+1 has "08/28")
  NSRegularExpression *dateRegex = [NSRegularExpression regularExpressionWithPattern:@"\\b(0[1-9]|1[0-2])\\s*[\\/\\-\\.\\s]\\s*([2-3][0-9])\\b" options:0 error:nil];
  if (lines.count >= 2) {
    for (NSUInteger i = 0; i < lines.count - 1; i++) {
      NSString *curr = [lines[i] uppercaseString];
      if ([curr containsString:@"VALID"] || [curr containsString:@"THRU"] || [curr containsString:@"EXP"] || [curr containsString:@"DATE"]) {
        NSString *next = [lines[i + 1] stringByReplacingOccurrencesOfString:@"O" withString:@"0"];
        NSTextCheckingResult *m = [dateRegex firstMatchInString:next options:0 range:NSMakeRange(0, next.length)];
        if (m && m.numberOfRanges >= 3) {
          NSString *month = [next substringWithRange:[m rangeAtIndex:1]];
          NSString *year = [next substringWithRange:[m rangeAtIndex:2]];
          return @{ @"month": month ?: @"", @"year": year ?: @"" };
        }
      }
    }
  }
  
  // Full text fallback
  NSTextCheckingResult *match = [regex firstMatchInString:fullText options:0 range:NSMakeRange(0, fullText.length)];
  if (match && match.numberOfRanges >= 3) {
    NSString *month = [fullText substringWithRange:[match rangeAtIndex:1]];
    NSString *year = [fullText substringWithRange:[match rangeAtIndex:2]];
    return @{ @"month": month ?: @"", @"year": year ?: @"" };
  }
  
  return @{ @"month": @"", @"year": @"" };
}

- (NSString *)extractNetwork:(NSString *)fullText cardNumber:(NSString *)cardNumber {
  NSString *upper = [fullText uppercaseString];
  if ([upper containsString:@"RUPAY"]) return @"RUPAY";
  if ([upper containsString:@"VISA"]) return @"VISA";
  if ([upper containsString:@"MASTERCARD"]) return @"MASTERCARD";
  if ([upper containsString:@"AMEX"] || [upper containsString:@"AMERICAN EXPRESS"]) return @"AMEX";
  if ([upper containsString:@"DINERS"]) return @"DINERS";
  if ([upper containsString:@"DISCOVER"]) return @"DISCOVER";
  
  NSString *clean = [[cardNumber componentsSeparatedByCharactersInSet:[[NSCharacterSet decimalDigitCharacterSet] invertedSet]] componentsJoinedByString:@""];
  if ([clean hasPrefix:@"4"]) return @"VISA";
  if ([clean hasPrefix:@"34"] || [clean hasPrefix:@"37"]) return @"AMEX";
  if ([clean hasPrefix:@"51"] || [clean hasPrefix:@"52"] || [clean hasPrefix:@"53"] || [clean hasPrefix:@"54"] || [clean hasPrefix:@"55"]) return @"MASTERCARD";
  if ([clean hasPrefix:@"60"] || [clean hasPrefix:@"65"] || [clean hasPrefix:@"81"] || [clean hasPrefix:@"82"]) return @"RUPAY";
  if ([clean hasPrefix:@"6011"] || [clean hasPrefix:@"644"]) return @"DISCOVER";
  
  return @"";
}

- (NSString *)extractBank:(NSString *)fullText {
  NSString *upper = [fullText uppercaseString];
  NSDictionary *bankMap = @{
    @"HDFC": @"HD",
    @"ICICI": @"IC",
    @"AXIS": @"AX",
    @"STATE BANK": @"SB",
    @"SBI": @"SB",
    @"KOTAK": @"KT",
    @"IDFC": @"ID",
    @"AMERICAN EXPRESS": @"AM",
    @"CITI": @"CT",
    @"RBL": @"RL",
    @"BANK OF BARODA": @"BB",
    @"BOB": @"BB",
    @"ONECARD": @"BB",
    @"ONE CARD": @"BB",
    @"AU SMALL FINANCE": @"AU",
    @"AU BANK": @"AU",
    @"PUNJAB NATIONAL": @"PN",
    @"PNB": @"PN",
    @"CANARA": @"CN",
    @"UNION BANK": @"UN",
    @"YES BANK": @"YS",
    @"STANDARD CHARTERED": @"SC",
    @"DBS": @"DB",
    @"FEDERAL BANK": @"FD",
    @"FEDERAL": @"FD",
    @"SCAPIA": @"FD",
    @"FI MONEY": @"FD",
    @"FI": @"FD",
    @"JUPITER": @"FD",
    @"NIYO": @"FD",
    @"HSBC": @"HS",
    @"INDUSIND": @"IN"
  };
  
  for (NSString *key in bankMap) {
    NSString *pattern = [NSString stringWithFormat:@"\\b%@\\b", key];
    NSRegularExpression *p = [NSRegularExpression regularExpressionWithPattern:pattern options:NSRegularExpressionCaseInsensitive error:nil];
    if ([p numberOfMatchesInString:upper options:0 range:NSMakeRange(0, upper.length)] > 0) {
      return bankMap[key];
    }
  }
  
  return @"";
}

- (NSString *)extractCardType:(NSString *)fullText {
  NSString *upper = [fullText uppercaseString];
  if ([upper containsString:@"DEBIT"] && ![upper containsString:@"CREDIT"]) return @"DEBIT";
  if ([upper containsString:@"CREDIT"] && ![upper containsString:@"DEBIT"]) return @"CREDIT";
  return @"";
}

- (NSString *)extractCardholderName:(NSArray<NSString *> *)lines lineBoxes:(NSArray<NSValue *> *)lineBoxes cardRect:(CGRect)cardRect bankCode:(NSString *)bankCode {
  NSSet *exclusions = [NSSet setWithObjects:
    @"VALID", @"THRU", @"GOOD", @"EXPIRES", @"EXP", @"DATE", @"FROM", @"MONTH", @"YEAR", @"VAL", @"CVV", @"CVC", @"CID",
    @"DEBIT", @"CREDIT", @"CARD", @"CARDS", @"PREPAID", @"FOREX", @"ATM", @"CHIP", @"SMART", @"ELECTRON", @"ELECTRONIC",
    @"BANK", @"BANKING", @"FINANCE", @"FINANCIAL", @"FIN", @"CUSTOMER", @"CARE", @"HELPLINE", @"HELP", @"SUPPORT",
    @"ACCOUNT", @"SERVICE", @"SERVICES", @"BRANCH", @"OFFICE", @"INDIA",
    @"BUSINESS", @"CORPORATE", @"COMMERCIAL", @"ENTERPRISE", @"PLATINUM", @"GOLD", @"SILVER", @"TITANIUM", @"DIAMOND",
    @"SIGNATURE", @"INFINITE", @"WORLD", @"ELITE", @"CLASSIC", @"PREMIER", @"PREMIUM", @"PRIVILEGE", @"SELECT",
    @"PREFERRED", @"PLUS", @"PRIME", @"PRO", @"ZERO", @"FIRST", @"METAL", @"BLACK", @"WHITE", @"EXCLUSIVE",
    @"REWARDS", @"REWARD", @"POINTS", @"POINT", @"CASHBACK", @"CLUB", @"MILES",
    @"MILLENNIA", @"REGALIA", @"INVENTIA", @"SAPPHIRO", @"RUBYX", @"CORAL", @"EMERALD", @"MAGNUS", @"BURGUNDY",
    @"ATLAS", @"APEX", @"NEO", @"ZONE", @"ONE", @"ONECARD", @"SCAPIA", @"FI", @"JUPITER", @"NIYO", @"SLICE", @"POSTPE", @"LAZYPAY",
    @"VISA", @"MASTERCARD", @"RUPAY", @"AMEX", @"AMERICAN", @"EXPRESS", @"DINERS", @"DISCOVER", @"JCB", @"MAESTRO", @"CIRRUS",
    @"AUTHORIZED", @"SIGNATURE", @"NOT", @"WITHOUT", @"SIGNED", @"SIGN", @"HOLDER", @"PROPERTY", @"ISSUED", @"RETURN",
    @"FOUND", @"PLEASE", @"NEAREST", @"TERMS", @"CONDITIONS", @"APPLY", @"MEMBER", @"SINCE", @"CONTACTLESS",
    @"DOMESTIC", @"INTERNATIONAL", @"GLOBAL", @"NATIONAL", @"CENTRAL", @"STATE", @"ONLY", @"USE", @"FOR",
    @"CALL", @"TOLL", @"FREE", @"LOST", @"REPORT", @"SECURITY", @"SECURE", @"CODE",
    @"FLIPKART", @"AMAZON", @"PAYTM", @"SWIGGY", @"ZOMATO", @"MYNTRA", @"TATA", @"TATANEU", @"NEU", @"RELIANCE", @"JIO",
    @"AIRTEL", @"VODAFONE", @"INDIANOIL", @"IOCL", @"BPCL", @"HPCL", @"OCTANE", @"VISTARA", @"INDIGO", @"SPICEJET", @"AIRINDIA",
    @"MAKEMYTRIP", @"MMT", @"YATRA", @"IRCTC", @"BOOKMYSHOW", @"PAY", @"MONEY", @"WALLET",
    @"THE", @"AND", @"OR", @"OF", @"TO", @"IN", @"BY", @"ON", @"WITH", @"AT", @"IS", @"IT", @"BE", @"ARE", @"THIS", @"THAT", @"YOUR", @"OUR", @"ALL", @"ANY", @"IF", @"AS", @"AN", nil];
  
  NSRegularExpression *nameRegex = [NSRegularExpression regularExpressionWithPattern:@"^[A-Z\\s]{3,30}$" options:0 error:nil];
  
  for (NSUInteger i = 0; i < lines.count; i++) {
    // 1. Geometrical check: cardholder name is NEVER in the top 35% of the card
    if (lineBoxes && i < lineBoxes.count) {
      CGRect box = [lineBoxes[i] CGRectValue];
      if (CGRectGetMidY(box) < cardRect.origin.y + cardRect.size.height * 0.35) {
        continue;
      }
    }

    NSString *trimmed = [[lines[i] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]] uppercaseString];
    
    // Skip lines with digits or punctuation symbols
    BOOL hasInvalidChar = NO;
    for (NSUInteger cIdx = 0; cIdx < trimmed.length; cIdx++) {
      unichar c = [trimmed characterAtIndex:cIdx];
      if (!((c >= 'A' && c <= 'Z') || c == ' ' || c == '.')) {
        hasInvalidChar = YES;
        break;
      }
    }
    if (hasInvalidChar) continue;

    NSString *cleanLetters = [trimmed stringByReplacingOccurrencesOfString:@"." withString:@""];
    if ([nameRegex numberOfMatchesInString:cleanLetters options:0 range:NSMakeRange(0, cleanLetters.length)] > 0) {
      NSArray<NSString *> *words = [cleanLetters componentsSeparatedByCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
      NSMutableArray *cleanWords = [NSMutableArray array];
      for (NSString *w in words) {
        if (w.length > 0) [cleanWords addObject:w];
      }
      
      if (cleanWords.count >= 2 && cleanWords.count <= 4) {
        // First and last words must be >= 2 characters
        if ([cleanWords.firstObject length] < 2 || [cleanWords.lastObject length] < 2) continue;

        // At most one single-letter initial
        NSInteger singleLetterCount = 0;
        for (NSString *w in cleanWords) {
          if (w.length == 1) singleLetterCount++;
        }
        if (singleLetterCount > 1) continue;

        // Check exclusions
        BOOL hasExclusion = NO;
        for (NSString *w in cleanWords) {
          if ([exclusions containsObject:w] || (bankCode && [w isEqualToString:bankCode])) {
            hasExclusion = YES;
            break;
          }
        }
        
        if (!hasExclusion) {
          NSMutableArray *titleWords = [NSMutableArray array];
          for (NSString *w in cleanWords) {
            NSString *capitalized = [w capitalizedString];
            [titleWords addObject:capitalized];
          }
          NSString *result = [titleWords componentsJoinedByString:@" "];
          if (result.length >= 5 && result.length <= 26) {
            return result;
          }
        }
      }
    }
  }
  
  return @"";
}

- (BOOL)isValidLuhn:(NSString *)num {
  if (num.length < 13 || num.length > 19) return NO;
  
  NSInteger sum = 0;
  BOOL shouldDouble = NO;
  
  for (NSInteger i = num.length - 1; i >= 0; i--) {
    unichar c = [num characterAtIndex:i];
    if (c < '0' || c > '9') return NO;
    NSInteger digit = c - '0';
    
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  
  return (sum % 10 == 0);
}

- (NSString *)formatCardNumber:(NSString *)clean {
  if (clean.length == 15) {
    // Amex 4-6-5
    return [NSString stringWithFormat:@"%@ %@ %@",
            [clean substringWithRange:NSMakeRange(0, 4)],
            [clean substringWithRange:NSMakeRange(4, 6)],
            [clean substringWithRange:NSMakeRange(10, 5)]];
  } else if (clean.length == 14) {
    // Diners 4-6-4
    return [NSString stringWithFormat:@"%@ %@ %@",
            [clean substringWithRange:NSMakeRange(0, 4)],
            [clean substringWithRange:NSMakeRange(4, 6)],
            [clean substringWithRange:NSMakeRange(10, 4)]];
  } else {
    // Standard 16 digit: 4-4-4-4
    NSMutableString *formatted = [NSMutableString string];
    for (NSUInteger i = 0; i < clean.length; i += 4) {
      NSUInteger len = MIN((NSUInteger)4, clean.length - i);
      if (formatted.length > 0) [formatted appendString:@" "];
      [formatted appendString:[clean substringWithRange:NSMakeRange(i, len)]];
    }
    return formatted;
  }
}

@end

#pragma mark - CardScannerModule

@implementation CardScannerModule

RCT_EXPORT_MODULE(CardScannerModule);

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

RCT_EXPORT_METHOD(isCameraSupported:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  AVCaptureDevice *device = [AVCaptureDevice defaultDeviceWithMediaType:AVMediaTypeVideo];
  resolve(@(device != nil));
}

RCT_EXPORT_METHOD(scanCard:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    UIViewController *presentingVC = RCTPresentedViewController();
    if (!presentingVC) {
      reject(@"NO_VIEW_CONTROLLER", @"Cannot find presented view controller to display scanner", nil);
      return;
    }
    
    CardScannerViewController *scannerVC = [[CardScannerViewController alloc] init];
    scannerVC.modalPresentationStyle = UIModalPresentationFullScreen;
    
    scannerVC.completionHandler = ^(NSDictionary *cardData) {
      resolve(cardData);
    };
    
    scannerVC.cancelHandler = ^{
      resolve([NSNull null]);
    };
    
    [presentingVC presentViewController:scannerVC animated:YES completion:nil];
  });
}

@end
