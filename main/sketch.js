// A Tesseract in P5.js (4D to 3D Projection)

let angle = 0;
let points = [];
let hueVal = 0;
let video;
let handPose;
let hands = [];
let modelStatus = "Loading Model...";
// Snapshot States
const SNAPSHOT_IDLE = 0;
const SNAPSHOT_ENTERING = 1; // Fade out background
const SNAPSHOT_ACTIVE = 2;   // Recording
const SNAPSHOT_EXITING = 3;  // Fade out trails, fade in background

let stars = [];
let bolts = [];
let showDebug = true;
let snapshotState = SNAPSHOT_IDLE;
let snapshotStart = 0;
let transitionStart = 0;
let sceneOpacity = 100; // 0-100 (HSB Alpha)
let artLayer; // Off-screen buffer for clean snapshots

// Configuration
const distance = 2; // Distance of the "4D camera"
let scaleFactor = 150; // Size on screen

// Interaction State (for smooth transitions)
let camRotX = 0;
let camRotY = 0;
let camRotZ = 0;

function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);
  colorMode(HSB, 360, 100, 100, 100);
  scaleFactor = min(width, height) / 4;

  // Setup video and handPose
  video = createCapture(VIDEO);
  video.size(640, 480);
  video.hide();
  handPose = ml5.handPose(video, { flipped: true }, modelLoaded);
  // detectStart will be called in modelLoaded

  // Initialize off-screen buffer
  artLayer = createGraphics(width, height, WEBGL);
  artLayer.colorMode(HSB, 360, 100, 100, 100);
  // Ensure we start with transparent buffer
  artLayer.clear();

  // Generate the 16 vertices of a hypercube
  // Coordinates are -1 or 1 for x, y, z, w
  for (let i = 0; i < 16; i++) {
    let x = (i & 1) ? 1 : -1;
    let y = (i & 2) ? 1 : -1;
    let z = (i & 4) ? 1 : -1;
    let w = (i & 8) ? 1 : -1;
    points.push(new P4Vector(x, y, z, w));
  }

  // Generate Stars
  for (let i = 0; i < 200; i++) {
    stars.push({
      x: random(-width, width),
      y: random(-height, height),
      z: random(-1000, -500), // Far background
      brightness: random(100, 255)
    });
  }
}

function draw() {
  // Force video update so detection works even when debug view is hidden
  video.loadPixels();

  // --- STATE MACHINE UPDATE ---
  if (snapshotState === SNAPSHOT_ENTERING) {
    // Fade Out Scene (100 -> 0)
    let elapsed = millis() - transitionStart;
    let duration = 1000; // 1 second fade
    sceneOpacity = map(elapsed, 0, duration, 100, 0, true);

    if (elapsed >= duration) {
      snapshotState = SNAPSHOT_ACTIVE;
      snapshotStart = millis();
      artLayer.clear(); // Start with transparent art layer
    }
  } else if (snapshotState === SNAPSHOT_EXITING) {
    // Fade In Scene (0 -> 100)
    let elapsed = millis() - transitionStart;
    let duration = 2000; // 2 second fade back
    sceneOpacity = map(elapsed, 0, duration, 0, 100, true);

    if (elapsed >= duration) {
      snapshotState = SNAPSHOT_IDLE;
      artLayer.clear(); // Free memory/cleanup
    }
  } else if (snapshotState === SNAPSHOT_ACTIVE) {
    sceneOpacity = 0;
    let elapsed = millis() - snapshotStart;
    if (elapsed > 10000) {
      // Time's up! Save and Exit
      // Save transparent PNG
      artLayer.save('tesseract_art_' + nf(year(), 4) + nf(month(), 2) + nf(day(), 2) + '_' + nf(hour(), 2) + nf(minute(), 2) + nf(second(), 2) + '.png');

      snapshotState = SNAPSHOT_EXITING;
      transitionStart = millis();
    }
  } else {
    sceneOpacity = 100;
  }

  // --- RENDERING ---

  // 1. Background / Clearing
  if (snapshotState === SNAPSHOT_ACTIVE || snapshotState === SNAPSHOT_ENTERING) {
    // In ACTIVE/ENTERING, we want a solid black background for the screen
    // (The artLayer remains transparent)
    background(0);
  } else {
    // IDLE or EXITING: Use trail effect
    push();
    translate(0, 0, 0);
    noStroke();
    fill(0, 0, 0, 10); // Trail fade
    resetMatrix();
    camera(0, 0, (height / 2.0) / tan(PI * 30.0 / 180.0), 0, 0, 0, 0, 1, 0);
    plane(width * 2, height * 2);
    pop();
  }

  // Clear depth buffer 
  drawingContext.clear(drawingContext.DEPTH_BUFFER_BIT);

  // 2. Draw Snapshot Art Layer (If Active or Exiting)
  if (snapshotState === SNAPSHOT_ACTIVE) {
    // Draw new Tesseract lines to artLayer
    if (hands.length > 0) {
      drawTesseract(artLayer);
    }
    // Display artLayer on screen (Opaque)
    push();
    resetMatrix();
    image(artLayer, -width / 2, -height / 2, width, height);
    pop();
  } else if (snapshotState === SNAPSHOT_EXITING) {
    // Fade out the afterimage
    // We do NOT draw new lines to artLayer
    // We draw the artLayer with fading opacity
    let artAlpha = map(sceneOpacity, 0, 100, 100, 0);
    push();
    resetMatrix();
    tint(255, artAlpha); // Apply alpha transparency to the image
    image(artLayer, -width / 2, -height / 2, width, height);
    pop();
  }

  // 3. Draw Background Elements (Stars) - Controlled by sceneOpacity
  if (sceneOpacity > 0) {
    drawStars(sceneOpacity);
  }

  // 4. Interaction & Hands
  // Update interaction logic always
  updateInteraction();

  // Draw Hands & Lightning - Controlled by sceneOpacity
  if (sceneOpacity > 0) {
    drawHandsAndLightning(sceneOpacity);
  }

  // 5. Draw Tesseract (Live View)
  // Only draw "Live" Tesseract in IDLE, ENTERING, or EXITING
  // In ACTIVE, we draw to artLayer (handled above)
  if (snapshotState !== SNAPSHOT_ACTIVE) {
    if (hands.length > 0 && sceneOpacity > 0) {
      drawingContext.clear(drawingContext.DEPTH_BUFFER_BIT);
      drawTesseract(null, sceneOpacity);
    }
  }

  // Allow Orbit Control if no hands
  if (snapshotState === SNAPSHOT_IDLE && hands.length === 0) {
    orbitControl();
  }

  // --- DEBUG VIEW ---
  // Debug view stays fully visible (user didn't say to fade UI)
  drawDebugView();
}

function drawStars(opacity) {
  push();
  noStroke();
  for (let s of stars) {
    // Twinkle
    let b = s.brightness + random(-20, 20);
    // Adjust brightness by global opacity
    let finalB = map(b, 0, 255, 0, 100); // map to HSB brightness
    fill(finalB, opacity);
    push();
    translate(s.x, s.y, s.z);
    sphere(2);
    pop();
  }
  pop();
}

function updateInteraction() {
  let targetRotX = 0;
  let targetRotY = 0;
  let targetRotZ = 0;
  let newScale = scaleFactor;

  if (hands.length > 0) {
    // 1. ROTATION CONTROL
    let sumX = 0;
    let sumY = 0;
    for (let hand of hands) {
      let indexTip = hand.keypoints[8];
      sumX += indexTip.x;
      sumY += indexTip.y;
    }
    let centerX = sumX / hands.length;
    let centerY = sumY / hands.length;

    targetRotY = map(centerX, 0, 640, -PI, PI);
    targetRotX = map(centerY, 0, 480, -PI, PI);

    // 2. SIZE & Z-ROTATION
    if (hands.length >= 2) {
      let h1 = hands[0].keypoints[8];
      let h2 = hands[1].keypoints[8];
      let d = dist(h1.x, h1.y, h2.x, h2.y);
      newScale = map(d, 50, 400, 50, 400);
      scaleFactor = lerp(scaleFactor, newScale, 0.1);
      let angleBetween = atan2(h2.y - h1.y, h2.x - h1.x);
      targetRotZ = angleBetween;
    }

    camRotX = lerp(camRotX, targetRotX, 0.1);
    camRotY = lerp(camRotY, targetRotY, 0.1);
    camRotZ = lerp(camRotZ, targetRotZ, 0.1);
  }
}

function drawHandsAndLightning(opacity) {
  // 4. NEON HAND RENDERING & LIGHTNING
  for (let hand of hands) {
    drawNeonHand(hand, opacity); // Pass opacity

    // LIGHTNING EMISSION
    const fingertips = [4, 8, 12, 16, 20];
    for (let i of fingertips) {
      if (random() < 0.002) {
        let kp = hand.keypoints[i];
        let wx = map(kp.x, 0, 640, -width / 2, width / 2);
        let wy = map(kp.y, 0, 480, -height / 2, height / 2);

        let dirX = random(-1, 1);
        let dirY = random(-1, 1);
        let dirZ = random(-1, 1);

        let mag = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ);
        dirX /= mag; dirY /= mag; dirZ /= mag;

        bolts.push(new Lightning(wx, wy, -50, dirX, dirY, dirZ));
      }
    }
  }

  // Draw Bolts
  for (let i = bolts.length - 1; i >= 0; i--) {
    let b = bolts[i];
    b.update();
    b.show(opacity); // Pass opacity
    if (b.finished()) {
      bolts.splice(i, 1);
    }
  }
}

function drawTesseract(pg, opacity = 100) {
  let ctx = pg ? pg : window;

  ctx.push();
  if (pg) {
    // If drawing to offscreen buffer, we need to replicate the camera transform?
    // OR just rotate. The main canvas has orbitControl/camera applied?
    // We are using rotateX/Y/Z which are model transforms.
    // But scaleFactor translates 4D points to 3D points. 
    // We just need to center it. 
    // WEBGL 0,0 is center.
    // If using artLayer, we might need clear background first? 
    // Snapshot mode accumulates, so NO clear.
  }

  ctx.rotateX(camRotX);
  ctx.rotateY(camRotY);
  ctx.rotateZ(camRotZ);

  // Auto-rotation of the 4D object itself
  // Note: 'angle' is global. We should increment it ONCE per frame, not per draw call.
  // Ideally update 'angle' in draw or updateInteraction.
  // Since draw() calls drawTesseract once per frame (either to artLayer OR null), it's fine to increment here?
  // Wait, snapshot mode draws to artLayer, normal draws to window. Both once per frame.
  // However, safest to increment outside. I'll put it back in draw() loop or just top of this function.
  // It is called exactly once per draw loop.
  angle += 0.02;

  let projected3D = [];

  for (let i = 0; i < points.length; i++) {
    let v = points[i];
    let rotated = rotateZW(v, angle);
    rotated = rotateXY(rotated, angle * 0.5);
    let wVal = 1 / (distance - rotated.w);
    let p = createVector(
      rotated.x * wVal,
      rotated.y * wVal,
      rotated.z * wVal
    );
    p.mult(scaleFactor);
    projected3D.push(p);

    ctx.push();
    ctx.translate(p.x, p.y, p.z);
    ctx.noStroke();
    ctx.fill(0, 0, 100, opacity); // Use opacity (White)
    ctx.sphere(4);
    ctx.pop();
  }

  hueVal = (hueVal + 0.5) % 360;
  ctx.stroke(hueVal, 100, 100, opacity); // Use opacity
  ctx.strokeWeight(3);

  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 16; j++) {
      if (i !== j) {
        let diff = i ^ j;
        if ((diff & (diff - 1)) == 0) {
          let a = projected3D[i];
          let b = projected3D[j];
          ctx.line(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }
    }
  }
  ctx.pop();
}

function drawDebugView() {
  if (showDebug) {
    push();
    resetMatrix();
    camera(0, 0, (height / 2.0) / tan(PI * 30.0 / 180.0), 0, 0, 0, 0, 1, 0);
    ortho(-width / 2, width / 2, -height / 2, height / 2, 0, 1000);
    noLights();

    let debugW = width * 0.25;
    let debugH = (debugW / 640) * 480;
    let debugX = width / 2 - debugW - 10;
    let debugY = height / 2 - debugH - 10;

    translate(debugX, debugY);
    noStroke();
    fill(0);

    push();
    translate(debugW, 0);
    scale(-1, 1);
    image(video, 0, 0, debugW, debugH);
    pop();

    if (hands.length > 0) {
      noFill();
      stroke(0, 255, 0);
      strokeWeight(2);
      for (let hand of hands) {
        for (let kp of hand.keypoints) {
          let kx = map(kp.x, 0, 640, 0, debugW);
          let ky = map(kp.y, 0, 480, 0, debugH);
          point(kx, ky);
        }
      }
    }

    noFill();
    stroke(255);
    strokeWeight(2);
    rect(0, 0, debugW, debugH);

    noStroke();
    fill(255);
    textSize(16);
    textAlign(LEFT, TOP);
    text("Status: " + modelStatus, 10, -30);

    textSize(14);
    text("1 Hand: Rotate X/Y", 10, debugH + 5);
    text("2 Hands: Zoom & Spin Z", 10, debugH + 25);
    text("Press 'D' to Hide Debug", 10, debugH + 45);

    if (snapshotState === SNAPSHOT_ENTERING) {
      fill(255, 255, 0);
      text("PREPARING SNAPSHOT...", 10, debugH + 65);
    } else if (snapshotState === SNAPSHOT_ACTIVE) {
      fill(255, 0, 0);
      text("SNAPSHOT MODE (Recording)", 10, debugH + 65);
    } else if (snapshotState === SNAPSHOT_EXITING) {
      fill(0, 255, 0);
      text("SAVED! Fading back...", 10, debugH + 65);
    } else {
      text("Press 'S' for Snapshot Mode", 10, debugH + 65);
    }

    pop();
  }
}

function keyPressed() {
  if (key === 'd' || key === 'D') {
    showDebug = !showDebug;
  }
  if (key === 's' || key === 'S') {
    if (snapshotState === SNAPSHOT_IDLE) {
      snapshotState = SNAPSHOT_ENTERING;
      transitionStart = millis();
    }
  }
}

function modelLoaded() {
  modelStatus = "Model Ready!";
  console.log("Model Loaded!");
  handPose.detectStart(video, gotHands);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  artLayer.resizeCanvas(windowWidth, windowHeight);
  scaleFactor = min(width, height) / 4;
}

function gotHands(results) {
  hands = results;
}

// Helper to draw a line between two 3D vectors
function connect(i, j, p3D) {
  let a = p3D[i];
  let b = p3D[j];
  line(a.x, a.y, a.z, b.x, b.y, b.z);
}

// --- MATH HELPERS ---

class P4Vector {
  constructor(x, y, z, w) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }
}

// Rotation matrix for the ZW plane
function rotateZW(p, theta) {
  let newZ = p.z * Math.cos(theta) - p.w * Math.sin(theta);
  let newW = p.z * Math.sin(theta) + p.w * Math.cos(theta);
  return new P4Vector(p.x, p.y, newZ, newW);
}

// Rotation matrix for the XY plane
function rotateXY(p, theta) {
  let newX = p.x * Math.cos(theta) - p.y * Math.sin(theta);
  let newY = p.x * Math.sin(theta) + p.y * Math.cos(theta);
  return new P4Vector(newX, newY, p.z, p.w);
}

// Helper to draw a neon hand
// NOTE: We now draw this BEFORE the rotation so it rotates with the cube.
// If you want hands to stay static, we'd need to inverse transform.
// But "holding" the cube feels better if the hand visuals exist in that space.
function drawNeonHand(hand, opacity = 100) {
  let fingers = [
    [0, 1, 2, 3, 4],
    [0, 5, 6, 7, 8],
    [0, 9, 10, 11, 12],
    [0, 13, 14, 15, 16],
    [0, 17, 18, 19, 20]
  ];

  push();
  noFill();
  strokeCap(ROUND);
  strokeJoin(ROUND);

  // Scale local opacity by global opacity ratio
  let alphaScale = opacity / 100.0;

  // Layer 1: Wide, faint (Halo)
  strokeWeight(60);
  stroke(190, 100, 100, 1 * alphaScale);
  drawSkeleton(hand, fingers);

  // Layer 2: Medium-wide
  strokeWeight(40);
  stroke(190, 100, 100, 2 * alphaScale);
  drawSkeleton(hand, fingers);

  // Layer 3: Medium
  strokeWeight(25);
  stroke(190, 100, 100, 4 * alphaScale);
  drawSkeleton(hand, fingers);

  // Layer 4: Inner Glow
  strokeWeight(14);
  stroke(190, 80, 100, 10 * alphaScale);
  drawSkeleton(hand, fingers);

  // Layer 5: Core (White/Blue)
  strokeWeight(7);
  stroke(190, 0, 100, 20 * alphaScale);
  drawSkeleton(hand, fingers);

  pop();
}

class Lightning {
  constructor(x, y, z, dirX, dirY, dirZ) {
    this.segments = [];
    this.life = 255;

    // Generate jagged path
    let px = x;
    let py = y;
    let pz = z;
    this.segments.push({ x: px, y: py, z: pz });

    // Base direction scaled up
    let stepSize = 20;

    for (let i = 0; i < 10; i++) {
      px += (dirX * stepSize) + random(-15, 15);
      py += (dirY * stepSize) + random(-15, 15);
      pz += (dirZ * stepSize) + random(-15, 15);
      this.segments.push({ x: px, y: py, z: pz });
    }
  }

  update() {
    this.life -= 15;
  }

  show(opacity = 100) {
    push();
    noFill();

    let alphaScale = opacity / 100.0;

    // Glow
    strokeWeight(15);
    stroke(200, 80, 100, map(this.life, 0, 255, 0, 50) * alphaScale);
    beginShape();
    for (let p of this.segments) {
      vertex(p.x, p.y, p.z);
    }
    endShape();

    // Core
    strokeWeight(5);
    stroke(200, 0, 100, map(this.life, 0, 255, 0, 100) * alphaScale);
    beginShape();
    for (let p of this.segments) {
      vertex(p.x, p.y, p.z);
    }
    endShape();

    pop();
  }

  finished() {
    return this.life < 0;
  }
}

function drawSkeleton(hand, fingers) {
  for (let finger of fingers) {
    beginShape();
    for (let i of finger) {
      let kp = hand.keypoints[i];
      let wx = map(kp.x, 0, 640, -width / 2, width / 2);
      let wy = map(kp.y, 0, 480, -height / 2, height / 2);
      // Place slightly behind tesseract but in front of stars
      vertex(wx, wy, -50);
    }
    endShape();
  }
}