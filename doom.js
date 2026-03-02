(function () {
  'use strict';

  console.log('[DOOM] IIFE running — doom.js loaded OK');

  // Inject hover style for the trigger link (can't do :hover inline)
  var style = document.createElement('style');
  style.textContent = '#doom-trigger:hover { text-decoration: underline; }';
  document.head.appendChild(style);

  // State
  var state = 'idle'; // 'idle' | 'title' | 'playing'
  var animFrameId = null;

  // Build overlay
  var overlay = document.createElement('div');
  overlay.id = 'doom-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:#1a1a14;z-index:9999;display:none;overflow:hidden;';

  // Canvas
  var canvas = document.createElement('canvas');
  canvas.id = 'doom-canvas';
  canvas.style.cssText = 'width:100%;height:100%;display:block;cursor:none;';
  overlay.appendChild(canvas);

  var ctx = canvas.getContext('2d');

  // HUD
  var hud = document.createElement('div');
  hud.id = 'doom-hud';
  hud.style.cssText = "position:absolute;top:1rem;left:1rem;right:1rem;font-family:'Jost',system-ui,sans-serif;color:#EDE8E0;font-size:1rem;display:none;";
  var hudHp = document.createElement('span');
  hudHp.textContent = 'HP: 100';
  hudHp.style.marginRight = '2rem';
  var hudAmmo = document.createElement('span');
  hudAmmo.textContent = 'AMMO: 50';
  hudAmmo.style.marginRight = '2rem';
  var hudEnemies = document.createElement('span');
  hudEnemies.textContent = 'ENEMIES: 0';
  hud.appendChild(hudHp);
  hud.appendChild(hudAmmo);
  hud.appendChild(hudEnemies);
  overlay.appendChild(hud);

  // Title screen
  var title = document.createElement('div');
  title.id = 'doom-title';
  title.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;color:#EDE8E0;display:none;';

  var titleH1 = document.createElement('h1');
  titleH1.textContent = 'DOOM MODE';
  titleH1.style.cssText = "font-family:'Fraunces',Georgia,serif;font-weight:400;font-size:4rem;letter-spacing:-0.03em;margin:0 0 1rem;color:inherit;";

  var titleInstructions = document.createElement('p');
  titleInstructions.textContent = 'WASD to move, mouse to look, click to shoot, ESC to exit';
  titleInstructions.style.cssText = "font-family:'Jost',system-ui,sans-serif;font-size:1rem;opacity:0.8;margin:0 0 2rem;";

  var titlePrompt = document.createElement('p');
  titlePrompt.textContent = 'Press any key to begin';
  titlePrompt.style.cssText = "font-family:'Jost',system-ui,sans-serif;font-size:0.875rem;opacity:0.5;";

  title.appendChild(titleH1);
  title.appendChild(titleInstructions);
  title.appendChild(titlePrompt);
  overlay.appendChild(title);

  document.body.appendChild(overlay);

  // -------------------------------------------------------------------------
  // Map — rectangular room with a pillar in the middle
  // -------------------------------------------------------------------------
  var MAP = [
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,1,1,1,1,0,0,0,0,0,1],
    [1,0,0,0,0,0,1,1,1,1,0,0,0,0,0,1],
    [1,0,0,0,0,0,1,1,1,1,0,0,0,0,0,1],
    [1,0,0,0,0,0,1,1,1,1,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]
  ];
  var MAP_H = MAP.length;
  var MAP_W = MAP[0].length;

  // -------------------------------------------------------------------------
  // Player
  // -------------------------------------------------------------------------
  var player = { x: 3, y: 3, angle: 0 };
  var FOV = Math.PI / 3; // 60 degrees
  var MOVE_SPEED = 3.5;
  var ROT_SPEED = 0.003; // radians per pixel of mouse movement
  var WALL_CHARS = ['\u2588', '\u2593', '\u2592', '\u2591', '|', ':', '.', ' '];
  //                  █         ▓         ▒         ░
  var MAX_DEPTH = 16;

  // -------------------------------------------------------------------------
  // Grid sizing
  // -------------------------------------------------------------------------
  var GRID_COLS = 80;
  var gridRows = 40;
  var cellW = 1;
  var cellH = 1;
  var fontSize = 14;

  function recalcGrid() {
    var w = canvas.width;
    var h = canvas.height;
    fontSize = Math.max(8, Math.floor(w / GRID_COLS));
    cellW = fontSize * 0.6; // monospace char width ≈ 0.6 × font size
    cellH = fontSize;
    gridRows = Math.floor(h / cellH);
    console.log('[DOOM] recalcGrid — canvas:', w, 'x', h, '| fontSize:', fontSize, '| cellW:', cellW, '| cellH:', cellH, '| gridRows:', gridRows, '| GRID_COLS:', GRID_COLS);
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------
  var keys = {};

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      exitDoom();
      return;
    }
    if (state === 'title') {
      startGame();
      return;
    }
    keys[e.key.toLowerCase()] = true;
  }

  function onKeyUp(e) {
    keys[e.key.toLowerCase()] = false;
  }

  function onMouseMove(e) {
    if (state !== 'playing') return;
    player.angle += e.movementX * ROT_SPEED;
  }

  function requestPointerLock() {
    canvas.requestPointerLock();
  }

  // -------------------------------------------------------------------------
  // Raycasting
  // -------------------------------------------------------------------------

  function castRay(ox, oy, angle) {
    var sin = Math.sin(angle);
    var cos = Math.cos(angle);
    var dist = 0;
    var step = 0.02;

    while (dist < MAX_DEPTH) {
      dist += step;
      var tx = ox + cos * dist;
      var ty = oy + sin * dist;
      var mx = Math.floor(tx);
      var my = Math.floor(ty);
      if (mx < 0 || mx >= MAP_W || my < 0 || my >= MAP_H) return MAX_DEPTH;
      if (MAP[my][mx] === 1) return dist;
    }
    return MAX_DEPTH;
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  var _renderCallCount = 0;
  function render() {
    _renderCallCount++;
    if (_renderCallCount === 1) {
      console.log('[DOOM] render() called for first time');
      console.log('[DOOM] render — canvas.width:', canvas.width, '| canvas.height:', canvas.height);
      console.log('[DOOM] render — ctx:', ctx);
      console.log('[DOOM] render — GRID_COLS:', GRID_COLS, '| gridRows:', gridRows, '| cellW:', cellW, '| cellH:', cellH, '| fontSize:', fontSize);
      console.log('[DOOM] render — player:', JSON.stringify(player));
    }

    // Clear
    ctx.fillStyle = '#1a1a14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.font = fontSize + 'px "Courier New", Courier, monospace';
    ctx.textBaseline = 'top';

    var halfRows = gridRows / 2;

    for (var col = 0; col < GRID_COLS; col++) {
      // Ray angle for this column
      var rayAngle = player.angle - FOV / 2 + (col / GRID_COLS) * FOV;
      var dist = castRay(player.x, player.y, rayAngle);
      if (_renderCallCount === 1 && col === 0) {
        console.log('[DOOM] render col=0 — rayAngle:', rayAngle.toFixed(4), '| dist:', dist.toFixed(4));
      }

      // Fix fisheye
      var corrected = dist * Math.cos(rayAngle - player.angle);

      // Wall height in grid rows
      var wallHeight = Math.min(gridRows, Math.floor(gridRows / corrected));
      var wallTop = Math.floor(halfRows - wallHeight / 2);
      var wallBottom = wallTop + wallHeight;

      // Normalized distance 0..1
      var t = Math.min(corrected / MAX_DEPTH, 1);

      // Pick wall character from palette based on distance
      var charIdx = Math.min(Math.floor(t * WALL_CHARS.length), WALL_CHARS.length - 1);
      var wallChar = WALL_CHARS[charIdx];

      // Wall opacity: 1.0 at close, 0.3 at far
      var wallOpacity = 1.0 - t * 0.7;

      var x = col * cellW;

      // Ceiling
      for (var row = 0; row < wallTop; row++) {
        // Sparse periods for ceiling — only render occasionally
        var ceilDist = (halfRows - row) / halfRows;
        if (ceilDist < 0.3 && Math.random() < 0.02) {
          ctx.fillStyle = 'rgba(240,234,214,0.08)';
          ctx.fillText('.', x, row * cellH);
        }
      }

      // Wall
      if (wallChar !== ' ') {
        ctx.fillStyle = 'rgba(240,234,214,' + wallOpacity.toFixed(2) + ')';
        for (var row = Math.max(0, wallTop); row < Math.min(gridRows, wallBottom); row++) {
          ctx.fillText(wallChar, x, row * cellH);
        }
      }

      // Floor
      for (var row = wallBottom; row < gridRows; row++) {
        var floorDist = (row - halfRows) / halfRows;
        if (floorDist > 0.1) {
          // Dot density increases closer to viewer (larger row values)
          var dotChance = floorDist * 0.4;
          if (Math.random() < dotChance) {
            var floorOpacity = 0.2 * floorDist;
            ctx.fillStyle = 'rgba(240,234,214,' + floorOpacity.toFixed(2) + ')';
            ctx.fillText('\u00B7', x, row * cellH);
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Game loop
  // -------------------------------------------------------------------------
  var lastTime = 0;
  var frameDuration = 1000 / 30; // target 30fps

  var _loopCallCount = 0;
  function gameLoop(timestamp) {
    _loopCallCount++;
    if (_loopCallCount === 1) console.log('[DOOM] gameLoop() first tick — timestamp:', timestamp);
    animFrameId = requestAnimationFrame(gameLoop);

    var delta = timestamp - lastTime;
    if (delta < frameDuration) return;
    lastTime = timestamp - (delta % frameDuration);

    update(delta / 1000);
    render();
  }

  function update(dt) {
    dt = Math.min(dt, 0.1); // clamp to avoid huge jumps

    var cos = Math.cos(player.angle);
    var sin = Math.sin(player.angle);
    var speed = MOVE_SPEED * dt;
    var nx = player.x;
    var ny = player.y;

    if (keys['w']) { nx += cos * speed; ny += sin * speed; }
    if (keys['s']) { nx -= cos * speed; ny -= sin * speed; }
    if (keys['a']) { nx += sin * speed; ny -= cos * speed; }
    if (keys['d']) { nx -= sin * speed; ny += cos * speed; }

    // Collision — check with a small margin
    var margin = 0.2;
    if (MAP[Math.floor(player.y)][Math.floor(nx + (nx > player.x ? margin : -margin))] === 0) {
      player.x = nx;
    }
    if (MAP[Math.floor(ny + (ny > player.y ? margin : -margin))][Math.floor(player.x)] === 0) {
      player.y = ny;
    }
  }

  // -------------------------------------------------------------------------
  // Canvas sizing
  // -------------------------------------------------------------------------
  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    recalcGrid();
  }

  // -------------------------------------------------------------------------
  // Start / Exit
  // -------------------------------------------------------------------------
  function startGame() {
    console.log('[DOOM] startGame() called');
    state = 'playing';
    title.style.display = 'none';
    hud.style.display = 'block';

    // Reset player
    player.x = 3;
    player.y = 3;
    player.angle = 0;
    keys = {};

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('click', requestPointerLock);
    canvas.requestPointerLock();

    lastTime = performance.now();
    animFrameId = requestAnimationFrame(gameLoop);
  }

  function exitDoom() {
    if (animFrameId !== null) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    overlay.style.display = 'none';
    state = 'idle';
    keys = {};
    window.removeEventListener('resize', resizeCanvas);
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    document.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('click', requestPointerLock);
    if (document.pointerLockElement === canvas) {
      document.exitPointerLock();
    }
  }

  // Entry point
  window.initDoomMode = function () {
    console.log('[DOOM] initDoomMode() called — state was:', state);
    overlay.style.display = 'block';
    state = 'title';
    title.style.display = 'block';
    hud.style.display = 'none';
    document.addEventListener('keydown', onKeyDown);
  };
})();
