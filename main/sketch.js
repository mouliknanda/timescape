// A Tesseract in P5.js (4D to 3D Projection)

let angle = 0;
let points = [];
let hueVal = 0;
let video;
let handPose;
let hands = [];
let modelStatus = "Loading Model...";
let stars = [];
let bolts = [];
let showDebug = true;

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

  // Trail effect: Draw a semi-transparent plane over the view
  push();
  translate(0, 0, 0); // Center
  noStroke();
  fill(0, 0, 0, 10); // Low opacity black
  // Ensure the plane covers the screen regardless of camera
  // We reset the view for the background
  resetMatrix();
  camera(0, 0, (height / 2.0) / tan(PI * 30.0 / 180.0), 0, 0, 0, 0, 1, 0);
  plane(width * 2, height * 2);
  pop();

  // Clear depth buffer so new geometry draws on top
  drawingContext.clear(drawingContext.DEPTH_BUFFER_BIT);

  // Draw Stars
  push();
  noStroke();
  for (let s of stars) {
    // Twinkle
    let b = s.brightness + random(-20, 20);
    fill(b);
    push();
    translate(s.x, s.y, s.z);
    sphere(2);
    pop();
  }

  // Update and Draw Lightning Bolts
  for (let i = bolts.length - 1; i >= 0; i--) {
    let b = bolts[i];
    b.update();
    b.show();
    if (b.finished()) {
      bolts.splice(i, 1);
    }
  }
  pop();

  // Allow mouse interaction to rotate the whole view (fallback)
  if (hands.length === 0) {
    orbitControl();
  }

  // Interaction Variables
  let targetRotX = 0;
  let targetRotY = 0;
  let targetRotZ = 0;
  let newScale = scaleFactor;

  // If hands are detected
  if (hands.length > 0) {
    // 1. ROTATION CONTROL (Replaces Translation)

    // Calculate centroid of all detected hands for X/Y Rotation
    let sumX = 0;
    let sumY = 0;
    for (let hand of hands) {
      let indexTip = hand.keypoints[8];
      sumX += indexTip.x;
      sumY += indexTip.y;
    }
    let centerX = sumX / hands.length;
    let centerY = sumY / hands.length;

    // Map video coordinates (0-640, 0-480) to rotation angles (-PI to PI)
    // X movement controls Y-axis rotation (Yaw)
    // Y movement controls X-axis rotation (Pitch)
    targetRotY = map(centerX, 0, 640, -PI, PI);
    targetRotX = map(centerY, 0, 480, -PI, PI);

    // 2. SIZE & Z-ROTATION (if 2 hands)
    if (hands.length >= 2) {
      let h1 = hands[0].keypoints[8];
      let h2 = hands[1].keypoints[8];

      // Distance -> Scale
      let d = dist(h1.x, h1.y, h2.x, h2.y);
      newScale = map(d, 50, 400, 50, 400);
      scaleFactor = lerp(scaleFactor, newScale, 0.1); // Smooth transition

      // Angle between hands -> Z-Rotation (Roll)
      // Calculate angle relative to horizontal
      let angleBetween = atan2(h2.y - h1.y, h2.x - h1.x);
      targetRotZ = angleBetween;
    }

    // Apply Smoothing (Lerp) to rotations
    // This makes the rotation feel "heavy" and less jittery
    camRotX = lerp(camRotX, targetRotX, 0.1);
    camRotY = lerp(camRotY, targetRotY, 0.1);
    camRotZ = lerp(camRotZ, targetRotZ, 0.1);

    // Apply the Rotations to the Scene
    // We wrap the 3D scene in a push/pop so the rotation doesn't affect the hands later
    push();
    rotateX(camRotX);
    rotateY(camRotY);
    rotateZ(camRotZ);

    // Auto-rotation of the 4D object itself (The Tesseract folding)
    angle += 0.02;

    // We need to calculate the projected 3D points
    let projected3D = [];

    for (let i = 0; i < points.length; i++) {
      let v = points[i];

      // 1. ROTATION (4D)
      // Rotation in the ZW plane (creates the "inside-out" folding)
      let rotated = rotateZW(v, angle);

      // Optional: Add a second rotation for complexity (XY plane)
      rotated = rotateXY(rotated, angle * 0.5);

      // 2. PROJECTION (4D -> 3D)
      let wVal = 1 / (distance - rotated.w);

      let p = createVector(
        rotated.x * wVal,
        rotated.y * wVal,
        rotated.z * wVal
      );

      // Scale it up to see it on canvas
      p.mult(scaleFactor);

      projected3D.push(p);

      // Draw the vertices (corners)
      push();
      translate(p.x, p.y, p.z);
      noStroke();
      fill(255);
      sphere(4);
      pop();
    }

    // 3. CONNECT EDGES
    hueVal = (hueVal + 0.5) % 360;
    stroke(hueVal, 100, 100);
    strokeWeight(2);

    for (let i = 0; i < 16; i++) {
      for (let j = 0; j < 16; j++) {
        if (i !== j) {
          let diff = i ^ j;
          if ((diff & (diff - 1)) == 0) {
            connect(i, j, projected3D);
          }
        }
      }
    }
    pop(); // End of Tesseract 3D rotation context

    // 4. NEON HAND RENDERING & LIGHTNING (Now on 2D Plane / Screen Space)
    // Clear depth buffer so hands draw on top of the tesseract
    drawingContext.clear(drawingContext.DEPTH_BUFFER_BIT);

    for (let hand of hands) {
      drawNeonHand(hand);

      // LIGHTNING EMISSION
      // We still calculate lightning in a "pseudo-3D" space relative to the screen
      for (let i = 0; i < hand.keypoints.length; i++) {
        if (random() < 0.005) {
          let kp = hand.keypoints[i];
          // Simple mapping to 3D space approx (screen aligned)
          let wx = map(kp.x, 0, 640, -width / 2, width / 2);
          let wy = map(kp.y, 0, 480, -height / 2, height / 2);

          let dirX = random(-1, 1);
          let dirY = random(-1, 1);
          let dirZ = random(-1, 1);

          // normalize
          let mag = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ);
          dirX /= mag; dirY /= mag; dirZ /= mag;

          bolts.push(new Lightning(wx, wy, -50, dirX, dirY, dirZ));
        }
      }
    }
  }

  // --- DEBUG VIEW ---
  if (showDebug) {
    // We need to break out of the 3D rotation context to draw the HUD
    // Since we applied rotateX/Y/Z earlier, we need to pop or reset matrix.
    // Actually, 'drawNeonHand' was called INSIDE the rotation. 
    // This means the hands will visualy rotate WITH the cube, which might look weird 
    // if you want them to stay attached to the video feed.
    // 
    // Ideally: 
    // 1. Calculate Rotations based on Hand Input.
    // 2. Draw Tesseract (Rotated).
    // 3. Reset Matrix.
    // 4. Draw Neon Hands (Screen Space).
    // 5. Draw HUD.

    // Let's fix that order for better UX.
    // Note: I can't easily re-order the code block above without rewriting interaction logic.
    // But for the Debug View specifically, we can resetMatrix() which clears transforms.

    push();
    resetMatrix();
    // Switch to 2D-like orthographic projection for UI overlay
    camera(0, 0, (height / 2.0) / tan(PI * 30.0 / 180.0), 0, 0, 0, 0, 1, 0);
    ortho(-width / 2, width / 2, -height / 2, height / 2, 0, 1000);

    noLights();

    // Define debug view size and position
    let debugW = width * 0.25;
    let debugH = (debugW / 640) * 480; // Maintain aspect ratio
    let debugX = width / 2 - debugW - 10;
    let debugY = height / 2 - debugH - 10;

    // Draw video background
    translate(debugX, debugY);
    noStroke();
    fill(0);
    // rect(0, 0, debugW, debugH);

    // Draw video feed (Mirrored)
    push();
    translate(debugW, 0);
    scale(-1, 1);
    image(video, 0, 0, debugW, debugH);
    pop();

    // Draw detected hands in debug view
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

    // Draw border
    noFill();
    stroke(255);
    strokeWeight(2);
    rect(0, 0, debugW, debugH);

    // Draw Status Text
    noStroke();
    fill(255);
    textSize(16);
    textAlign(LEFT, TOP);
    text("Status: " + modelStatus, 10, -30);

    // Instructions
    textSize(14);
    text("1 Hand: Rotate X/Y", 10, debugH + 5);
    text("2 Hands: Zoom & Spin Z", 10, debugH + 25);
    text("Press 'D' to Hide Debug", 10, debugH + 45); // Added instruction

    pop();
  }
}

function keyPressed() {
  if (key === 'd' || key === 'D') {
    showDebug = !showDebug;
  }
}

function modelLoaded() {
  modelStatus = "Model Ready!";
  console.log("Model Loaded!");
  handPose.detectStart(video, gotHands);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
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
function drawNeonHand(hand) {
  let fingers = [
    [0, 1, 2, 3, 4],
    [0, 5, 6, 7, 8],
    [0, 9, 10, 11, 12],
    [0, 13, 14, 15, 16],
    [0, 17, 18, 19, 20]
  ];

  push();
  noFill();

  // To make the hands appear "flat" to the screen (overlay) while inside a rotated 3D context, 
  // we would normally use billboard techniques. 
  // However, letting them rotate in 3D space creates a cool "holographic projection" effect 
  // where your hands are part of the simulation.

  // Layer 1: Wide, faint (Halo)
  strokeWeight(25);
  stroke(190, 100, 100, 5);
  drawSkeleton(hand, fingers);

  // Layer 2: Medium-wide
  strokeWeight(15);
  stroke(190, 100, 100, 15);
  drawSkeleton(hand, fingers);

  // Layer 3: Medium
  strokeWeight(8);
  stroke(190, 100, 100, 40);
  drawSkeleton(hand, fingers);

  // Layer 4: Inner Glow
  strokeWeight(4);
  stroke(190, 80, 100, 80);
  drawSkeleton(hand, fingers);

  // Layer 5: Core (White/Blue)
  strokeWeight(2);
  stroke(190, 0, 100, 100);
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

  show() {
    push();
    noFill();

    // Glow
    strokeWeight(6);
    stroke(200, 80, 100, map(this.life, 0, 255, 0, 50));
    beginShape();
    for (let p of this.segments) {
      vertex(p.x, p.y, p.z);
    }
    endShape();

    // Core
    strokeWeight(2);
    stroke(200, 0, 100, map(this.life, 0, 255, 0, 100));
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