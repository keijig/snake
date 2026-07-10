// ---- Setup ----------------------------------------------------------------
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");        // the "2d" drawing toolkit
const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");
const overlayEl = document.getElementById("overlay");
const overlayTitleEl = document.getElementById("overlayTitle");
const overlayMsgEl = document.getElementById("overlayMsg");
const muteEl = document.getElementById("mute");

const CELL = 20;                              // each grid square is 20px
const COLS = canvas.width / CELL;             // 400 / 20 = 20 columns
const ROWS = canvas.height / CELL;

// ---- Speed ----------------------------------------------------------------
// Snake starts slow and speeds up as you eat — floored so it stays playable.
// Gentle linear ramp: drops SPEEDUP ms per point until it hits MIN_DELAY.
// With these values the fastest speed isn't reached until ~score 40.
const BASE_DELAY = 150;                       // ms per tick at score 0
const MIN_DELAY = 90;                         // fastest we'll ever go
const SPEEDUP = 1.5;                          // ms shaved off per point
const delayFor = (s) => Math.max(MIN_DELAY, BASE_DELAY - s * SPEEDUP);

// When you turn, pull the next step forward to this soon after the last one —
// so a turn always shows up within ~EAGER_MIN ms no matter when you pressed,
// while still capping how fast the snake can actually step.
const EAGER_MIN = 60;

// ---- Persistence ----------------------------------------------------------
const HS_KEY = "snake.highScore";
function loadHighScore() {
  const n = Number(localStorage.getItem(HS_KEY));
  return Number.isFinite(n) ? n : 0;
}
function saveHighScore(n) {
  try { localStorage.setItem(HS_KEY, String(n)); } catch { /* storage disabled */ }
}

// ---- Sound ----------------------------------------------------------------
// Synthesized square-wave beeps via the Web Audio API — no asset files, fits
// the retro feel. The context must be created/resumed on a user gesture, so we
// spin it up on the first key press.
const MUTE_KEY = "snake.muted";
let muted = localStorage.getItem(MUTE_KEY) === "1";
let audioCtx = null;

function initAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
}

// one note; `when` is an offset in seconds for sequencing
function beep(freq, dur, when = 0, vol = 0.14, type = "square") {
  if (!audioCtx || muted) return;
  const t = audioCtx.currentTime + when;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);  // decay, no click
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + dur);
}

// "Twinkle Twinkle Little Star" — each bite plays the next note (C major).
const TWINKLE = [
  261.63, 261.63, 392.00, 392.00, 440.00, 440.00, 392.00,  // twinkle twinkle little star
  349.23, 349.23, 329.63, 329.63, 293.66, 293.66, 261.63,  // how i wonder what you are
];
let twinkleIdx = 0;

function sndEat() {
  beep(TWINKLE[twinkleIdx], 0.22, 0, 0.16, "triangle");    // soft bell-like twinkle
  twinkleIdx = (twinkleIdx + 1) % TWINKLE.length;          // loop the melody
}

const sndStart = () => { beep(523, 0.08); beep(784, 0.09, 0.08); };  // rising two-note

function sndOver() {
  if (!audioCtx || muted) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(440, t);
  osc.frequency.exponentialRampToValueAtTime(110, t + 0.4);  // descending sweep
  gain.gain.setValueAtTime(0.18, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + 0.4);
}

function setMute(on) {
  muted = on;
  localStorage.setItem(MUTE_KEY, on ? "1" : "0");
  muteEl.textContent = on ? "♪ off" : "♪ on";
}

// ---- Game state -----------------------------------------------------------
// state: "start" | "playing" | "paused" | "over"
let snake, direction, food, score, state, timer;
let highScore = loadHighScore();
let dirQueue = [];                            // buffered turns (fast corners)
let lastTickAt = 0;                           // ms of last move, for eager turns

function reset() {
  snake = [{ x: 10, y: 10 }];                 // array of segments; [0] is the head
  direction = { x: 1, y: 0 };                 // start moving right
  dirQueue = [];
  lastTickAt = 0;
  food = randomFood();
  score = 0;
  twinkleIdx = 0;                             // restart the melody each game
  scoreEl.textContent = "score 0";
  bestEl.textContent = "best " + highScore;
}

function randomFood() {
  // drop food on a random cell that isn't under the snake
  let pos;
  do {
    pos = { x: rand(COLS), y: rand(ROWS) };
  } while (snake.some((s) => s.x === pos.x && s.y === pos.y));
  return pos;
}

const rand = (n) => Math.floor(Math.random() * n);

// ---- Screens (overlay) ----------------------------------------------------
function showOverlay(title, msg) {
  overlayTitleEl.textContent = title;
  overlayMsgEl.textContent = msg;
  overlayEl.classList.remove("hidden");
}
function hideOverlay() {
  overlayEl.classList.add("hidden");
}

function goStart() {
  state = "start";
  reset();
  showOverlay("snake", "press space to start");
}

function startGame() {
  reset();
  state = "playing";
  hideOverlay();
  sndStart();
  loop();
}

function pauseGame() {
  if (state !== "playing") return;
  state = "paused";
  clearTimeout(timer);
  showOverlay("paused", "space to resume");
}

function resumeGame() {
  if (state !== "paused") return;
  state = "playing";
  hideOverlay();
  loop();
}

function gameOver() {
  state = "over";
  clearTimeout(timer);
  sndOver();
  if (score > highScore) {
    highScore = score;
    saveHighScore(highScore);
    bestEl.textContent = "best " + highScore;
    showOverlay("new best · " + score, "space to play again");
  } else {
    showOverlay("game over", "score " + score + " · space to play again");
  }
}

// ---- Input ----------------------------------------------------------------
const KEYS = {
  ArrowUp: { x: 0, y: -1 }, w: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 }, s: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 }, a: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 }, d: { x: 1, y: 0 },
};

// Buffer a turn. Validated against the last *queued* direction (or the current
// one if the queue is empty) so a fast corner like up-then-right keeps both
// turns instead of the second clobbering the first. Returns true if buffered.
function queueTurn(dir) {
  const ref = dirQueue.length ? dirQueue[dirQueue.length - 1] : direction;
  if (dir.x === ref.x && dir.y === ref.y) return false;        // same direction
  if (dir.x === -ref.x && dir.y === -ref.y) return false;      // 180° reversal
  if (dirQueue.length >= 2) return false;                      // buffer is full
  dirQueue.push(dir);
  return true;
}

document.addEventListener("keydown", (e) => {
  const key = e.key;

  initAudio();                                // unlock audio on first gesture

  // M toggles sound, on any screen.
  if (key === "m" || key === "M") {
    setMute(!muted);
    return;
  }

  // Space is the one control: start / pause / resume / restart.
  if (key === " ") {
    e.preventDefault();                       // stop the page from scrolling
    if (state === "start" || state === "over") startGame();
    else if (state === "playing") pauseGame();
    else if (state === "paused") resumeGame();
    return;
  }

  // Movement only matters while playing.
  if (state !== "playing") return;
  const dir = KEYS[key];
  if (!dir) return;
  if (!queueTurn(dir)) return;

  // Snappy: bring the next step forward so the turn shows up fast regardless of
  // when in the interval you pressed. Never sooner than EAGER_MIN after the last
  // step, so this can't be used to outrun the game's top speed.
  const elapsed = performance.now() - lastTickAt;
  clearTimeout(timer);
  if (elapsed >= EAGER_MIN) loop();
  else timer = setTimeout(loop, EAGER_MIN - elapsed);
});

// ---- Game loop (logic) ----------------------------------------------------
// Self-scheduling timeout so the delay can shrink as the score grows.
function loop() {
  if (state !== "playing") return;
  tick();
  lastTickAt = performance.now();
  if (state === "playing") timer = setTimeout(loop, delayFor(score));
}

function tick() {
  if (dirQueue.length) direction = dirQueue.shift();   // apply next buffered turn

  // new head = current head + direction
  const head = { x: snake[0].x + direction.x, y: snake[0].y + direction.y };

  // hit a wall? game over.
  const hitWall = head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS;
  // hit yourself? The tail is excluded — it vacates its cell this tick, so
  // moving into where the tail *was* is fine (and food never spawns on the
  // snake, so we can't grow into the tail).
  const hitSelf = snake.slice(0, -1).some((s) => s.x === head.x && s.y === head.y);
  if (hitWall || hitSelf) return gameOver();

  snake.unshift(head);                        // add new head to the front

  if (head.x === food.x && head.y === food.y) {
    score++;
    scoreEl.textContent = "score " + score;
    sndEat();
    food = randomFood();                      // grew: keep the tail (don't pop)
  } else {
    snake.pop();                              // didn't eat: remove tail (move)
  }
}

// ---- Rendering ------------------------------------------------------------
// A render loop keeps the board painted; the snake is drawn crisply at its
// grid cells — discrete hops, retro feel.
function render() {
  draw();
  requestAnimationFrame(render);
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawGrid();

  // food — warm amber with a phosphor glow
  ctx.save();
  ctx.shadowColor = "#e0af68";
  ctx.shadowBlur = 10;
  ctx.fillStyle = "#e0af68";
  ctx.fillRect(food.x * CELL + 3, food.y * CELL + 3, CELL - 6, CELL - 6);
  ctx.restore();

  // snake — one square per grid cell, with a phosphor glow
  ctx.save();
  ctx.shadowColor = "#4ade80";
  ctx.shadowBlur = 8;
  for (let i = 0; i < snake.length; i++) {
    ctx.fillStyle = i === 0 ? "#7dff9b" : "#4ade80";
    ctx.fillRect(snake[i].x * CELL + 1, snake[i].y * CELL + 1, CELL - 2, CELL - 2);
  }
  ctx.restore();
}

function drawGrid() {
  ctx.strokeStyle = "#0c140d";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < COLS; i++) {
    ctx.moveTo(i * CELL, 0);
    ctx.lineTo(i * CELL, canvas.height);
  }
  for (let j = 1; j < ROWS; j++) {
    ctx.moveTo(0, j * CELL);
    ctx.lineTo(canvas.width, j * CELL);
  }
  ctx.stroke();
}

// ---- Start ----------------------------------------------------------------
muteEl.textContent = muted ? "♪ off" : "♪ on";
goStart();
requestAnimationFrame(render);
