// ---- Setup ----------------------------------------------------------------
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");        // the "2d" drawing toolkit
const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");
const overlayEl = document.getElementById("overlay");
const overlayTitleEl = document.getElementById("overlayTitle");
const overlayMsgEl = document.getElementById("overlayMsg");
const muteEl = document.getElementById("mute");

// touch devices get tap/swipe wording instead of keyboard wording
const TOUCH = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
const MSG = {
  start: TOUCH ? "tap to start" : "press space to start",
  resume: TOUCH ? "tap to resume" : "space to resume",
  again: TOUCH ? "tap to play again" : "space to play again",
};

const CELL = 20;                              // each grid square is 20px
const COLS = canvas.width / CELL;             // 400 / 20 = 20 columns
const ROWS = canvas.height / CELL;

// ---- Speed ----------------------------------------------------------------
// Snake starts slow and speeds up as you eat — floored so it stays playable.
// Linear ramp: 175ms at score 0 → 80ms at score 100 (slope 0.95ms/point),
// then keeps ramping down to a 50ms floor (~score 132) for elite runs.
const BASE_DELAY = 175;                       // ms per tick at score 0
const MIN_DELAY = 50;                         // fastest we'll ever go
const SPEEDUP = 0.95;                         // ms shaved off per point
const delayFor = (s) => Math.max(MIN_DELAY, BASE_DELAY - s * SPEEDUP);

// When you turn, pull the next step forward to this soon after the last one —
// so a turn always shows up within ~EAGER_MIN ms no matter when you pressed,
// while still capping how fast the snake can actually step.
const EAGER_MIN = 35;

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
let gameStartAt = 0;                          // ms the current run began (anti-cheat)
let awaitingMove = false;                     // started, but waiting for first direction

function reset() {
  snake = [{ x: 10, y: 10 }];                 // array of segments; [0] is the head
  direction = { x: 1, y: 0 };                 // default until the first input
  dirQueue = [];
  awaitingMove = false;
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
  overlayEl.classList.remove("hint");
  overlayTitleEl.style.display = "";
  overlayTitleEl.textContent = title;
  overlayMsgEl.textContent = msg;
  overlayEl.classList.remove("hidden");
}
function hideOverlay() {
  overlayEl.classList.add("hidden");
  overlayEl.classList.remove("hint");
  overlayTitleEl.style.display = "";
}

function goStart() {
  state = "start";
  reset();
  showOverlay("snake", MSG.start);
}

function startGame() {
  reset();
  state = "playing";
  awaitingMove = true;                         // sit still until a direction is given
  sndStart();
  hideOverlay();                               // arrows are drawn on the canvas instead
}

function pauseGame() {
  if (state !== "playing" || awaitingMove) return;
  state = "paused";
  clearTimeout(timer);
  showOverlay("paused", MSG.resume);
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
    showOverlay("new best · " + score, MSG.again);
  } else {
    showOverlay("game over", "score " + score + " · " + MSG.again);
  }
  // let the online leaderboard (if configured) record this run
  const durationMs = performance.now() - gameStartAt;
  document.dispatchEvent(new CustomEvent("snake:gameover", { detail: { score, durationMs } }));
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

// The one action shared by Space and a tap: start / pause / resume / restart.
function primaryAction() {
  if (state === "start" || state === "over") startGame();
  else if (state === "playing") pauseGame();
  else if (state === "paused") resumeGame();
}

// Apply a turn (from a key or a swipe) while playing.
function applyTurn(dir) {
  if (state !== "playing") return;

  // first input of the run: head off in that direction immediately (any way)
  if (awaitingMove) {
    awaitingMove = false;
    direction = dir;
    dirQueue = [];
    gameStartAt = performance.now();
    lastTickAt = performance.now();
    hideOverlay();
    loop();
    return;
  }

  if (!queueTurn(dir)) return;
  // Snappy: bring the next step forward so the turn shows up fast regardless of
  // when in the interval you pressed. Never sooner than EAGER_MIN after the last
  // step, so this can't be used to outrun the game's top speed.
  const elapsed = performance.now() - lastTickAt;
  clearTimeout(timer);
  if (elapsed >= EAGER_MIN) loop();
  else timer = setTimeout(loop, EAGER_MIN - elapsed);
}

document.addEventListener("keydown", (e) => {
  if (window.SNAKE_LOCKED) return;            // login gate is up — ignore game keys
  const key = e.key;

  initAudio();                                // unlock audio on first gesture

  if (key === "m" || key === "M") { setMute(!muted); return; }
  if (key === " ") { e.preventDefault(); primaryAction(); return; }

  const dir = KEYS[key];
  if (dir) applyTurn(dir);
});

// ---- Touch: swipe to turn, tap to start/pause/restart --------------------
let touchX = 0, touchY = 0, touching = false;
const SWIPE_MIN = 24;                         // px before a drag counts as a swipe

canvas.parentElement.addEventListener("touchstart", (e) => {
  if (window.SNAKE_LOCKED) return;
  initAudio();
  const t = e.changedTouches[0];
  touchX = t.clientX; touchY = t.clientY; touching = true;
  e.preventDefault();                         // no scroll/zoom on the board
}, { passive: false });

canvas.parentElement.addEventListener("touchmove", (e) => {
  if (touching) e.preventDefault();
}, { passive: false });

canvas.parentElement.addEventListener("touchend", (e) => {
  if (window.SNAKE_LOCKED || !touching) return;
  touching = false;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchX, dy = t.clientY - touchY;
  if (Math.abs(dx) < SWIPE_MIN && Math.abs(dy) < SWIPE_MIN) {
    primaryAction();                          // a tap
  } else if (Math.abs(dx) > Math.abs(dy)) {
    applyTurn({ x: dx > 0 ? 1 : -1, y: 0 });  // horizontal swipe
  } else {
    applyTurn({ x: 0, y: dy > 0 ? 1 : -1 });  // vertical swipe
  }
  e.preventDefault();
}, { passive: false });

// Tapping the ♪ indicator toggles sound (mobile has no keyboard).
muteEl.addEventListener("click", () => { initAudio(); setMute(!muted); });

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

  if (awaitingMove) drawStartArrows();
}

// four arrows around the head, gently pulsing — shown while waiting for the
// first direction of a run.
function drawStartArrows() {
  const cx = snake[0].x * CELL + CELL / 2;
  const cy = snake[0].y * CELL + CELL / 2;
  const d = 26;                                 // distance from head centre
  const pulse = 0.16 + 0.12 * (0.5 + 0.5 * Math.sin(performance.now() / 380));

  ctx.save();
  ctx.globalAlpha = pulse;                      // super-light blink
  ctx.fillStyle = "#7dd88f";
  ctx.font = "18px 'SF Mono', Menlo, ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("↑", cx, cy - d);
  ctx.fillText("↓", cx, cy + d);
  ctx.fillText("←", cx - d, cy);
  ctx.fillText("→", cx + d, cy);
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

// pause the game if the login gate takes over (e.g. the player logs out)
document.addEventListener("snake:lock", () => {
  if (state === "playing") pauseGame();
});

// ---- Start ----------------------------------------------------------------
muteEl.textContent = muted ? "♪ off" : "♪ on";
if (TOUCH) {
  const ch = document.getElementById("controlsHint");
  if (ch) ch.textContent = "swipe · tap";     // no keyboard on touch devices
}
goStart();
requestAnimationFrame(render);
