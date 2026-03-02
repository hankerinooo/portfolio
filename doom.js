(function () {
  'use strict';

  // Self-contained xorshift32 PRNG — never touches Math.random (SES-safe)
  var _rng = 0xDEADBEEF;
  function rand() {
    _rng ^= _rng << 13;
    _rng ^= _rng >> 17;
    _rng ^= _rng << 5;
    return (_rng >>> 0) / 4294967296;
  }

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

  // DOM grid — replaces <canvas>; ad-blocker-safe
  var gridContainer = document.createElement('div');
  gridContainer.id = 'doom-grid';
  // color and font-family are inherited by all child spans
  gridContainer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;overflow:hidden;cursor:none;color:var(--ink);font-family:"Courier New",Courier,monospace;';
  overlay.appendChild(gridContainer);

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

  // Room label — shown in Fraunces at top-center when near an entrance
  var hudRoom = document.createElement('div');
  hudRoom.id = 'doom-hud-room';
  hudRoom.style.cssText = [
    'position:absolute',
    'top:3.5rem',
    'left:50%',
    'transform:translateX(-50%)',
    "font-family:'Fraunces',Georgia,serif",
    'font-weight:400',
    'font-size:2.5rem',
    'letter-spacing:-0.025em',
    'color:var(--ink)',
    'opacity:0.85',
    'text-align:center',
    'white-space:nowrap',
    'pointer-events:none',
    'display:none',
    'text-shadow:0 2px 12px rgba(0,0,0,0.4)'
  ].join(';') + ';';
  overlay.appendChild(hudRoom);

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
  // Map — portfolio level (46 cols × 36 rows)
  //
  // '#' = wall  '.' = floor
  // Columns are x, rows are y (MAP[y][x]).
  //
  // Bird's-eye layout:
  //
  //   col:  0         1         2         3         4
  //         0123456789012345678901234567890123456789012345
  //  y=0    ##############################################  top wall
  //  y=1-8  corridor (x=20-21), alcove right (x=22-23 at y=4-7)
  //  y=7-8  WIZARDS wing starts east (x=34-44)
  //  y=9-15 HUB (x=12-32) — corridor opens into hub
  //  y=11   AONUI wing begins west (x=2-10)
  //  y=11   WIZARDS doorway column opens (x=33, y=11-13)
  //  y=12   AONUI doorway column opens  (x=11, y=12-14)
  //  y=16   wall row — MTG doorway gap (x=22-24)
  //  y=17-29 MTG COMPANION square room (x=18-32)
  //  y=11-25 AONUI PORTAL main body (x=2-10)
  //  y=26-33 AONUI PORTAL L-extension (x=2-15)
  //  y=7-18  WIZARDS EVENTLINK long rectangle (x=34-44)
  // -------------------------------------------------------------------------
  var MAP = (function () {
    // Each string is one row; must be exactly 46 characters.
    var rows = [
      //0         1         2         3         4
      //0123456789012345678901234567890123456789012345
      '##############################################', // y=0
      '####################..########################', // y=1
      '####################..########################', // y=2  ← spawn
      '####################..########################', // y=3
      '####################....######################', // y=4  alcove starts
      '####################....######################', // y=5
      '####################....######################', // y=6
      '####################....##########...........#', // y=7  WIZARDS begins east
      '####################..############...........#', // y=8  alcove ends
      '############.....................#...........#', // y=9  hub begins
      '############.....................#...........#', // y=10
      '##.........#.................................#', // y=11 AONUI main + WIZARDS doorway open
      '##...........................................#', // y=12 AONUI doorway open; all three connected
      '##...........................................#', // y=13 both doorways still open
      '##...............................#...........#', // y=14 WIZARDS doorway closes; AONUI door open
      '##.........#.....................#...........#', // y=15 hub last row; AONUI doorway closes
      '##.........###########...#########...........#', // y=16 MTG doorway gap; WIZARDS continues
      '##.........#######...............#...........#', // y=17 MTG begins; WIZARDS continues
      '##.........#######...............#...........#', // y=18 WIZARDS last row
      '##.........#######...............#############', // y=19
      '##.........#######...............#############', // y=20
      '##.........#######...............#############', // y=21
      '##.........#######...............#############', // y=22
      '##.........#######...............#############', // y=23
      '##.........#######...............#############', // y=24
      '##.........#######...............#############', // y=25 AONUI main last row
      '##..............##...............#############', // y=26 AONUI L-ext begins
      '##..............##...............#############', // y=27
      '##..............##...............#############', // y=28
      '##..............##...............#############', // y=29 MTG last row
      '##..............##############################', // y=30 MTG done; L-ext continues
      '##..............##############################', // y=31
      '##..............##############################', // y=32
      '##..............##############################', // y=33 AONUI L-ext last row
      '##############################################', // y=34
      '##############################################'  // y=35
    ];
    return rows.map(function (r) {
      return r.split('').map(function (c) { return c === '#' ? 1 : 0; });
    });
  }());
  var MAP_H = MAP.length;
  var MAP_W = MAP[0].length;

  // -------------------------------------------------------------------------
  // Room entrances — proximity trigger points (center of each doorway)
  // When the player is within PROXIMITY_DIST tiles, the room name shows in HUD.
  // -------------------------------------------------------------------------
  var ENTRANCES = [
    { x: 33.5, y: 12.0, name: 'WIZARDS EVENTLINK' },
    { x: 23.0, y: 16.5, name: 'MTG COMPANION'     },
    { x: 11.5, y: 13.0, name: 'AONUI PORTAL'      }
  ];
  var PROXIMITY_DIST = 3; // tiles

  // -------------------------------------------------------------------------
  // Player
  // -------------------------------------------------------------------------
  // Spawn at the far end of the entry corridor, facing south toward the hub
  var player = { x: 20.5, y: 2.0, angle: Math.PI / 2 };
  var FOV = Math.PI / 3; // 60 degrees
  var MOVE_SPEED = 3.5;
  var ROT_SPEED = 0.003; // radians per pixel of mouse movement
  var WALL_CHARS = ['\u2588', '\u2593', '\u2592', '\u2591', '|', ':', '.', ' '];
  //                  █         ▓         ▒         ░
  var MAX_DEPTH = 28; // longer sightlines for a larger map

  // -------------------------------------------------------------------------
  // Grid sizing
  // -------------------------------------------------------------------------
  var GRID_COLS = 80;
  var gridRows = 40;
  var cellW = 1;
  var cellH = 1;
  var fontSize = 14;

  // cells[row][col] = <span> — populated by buildGrid()
  var cells = [];

  // Build (or rebuild) the full span grid to match current dimensions.
  // Uses a DocumentFragment for a single batched DOM insertion.
  function buildGrid(rows) {
    gridContainer.innerHTML = '';
    cells = [];
    var frag = document.createDocumentFragment();
    var spanStyle = [
      'display:inline-block',
      'width:' + cellW + 'px',
      'height:' + cellH + 'px',
      'font-size:' + fontSize + 'px',
      'line-height:1',
      'text-align:center',
      'overflow:hidden'
    ].join(';') + ';';
    var rowStyle = 'height:' + cellH + 'px;overflow:hidden;white-space:nowrap;';

    for (var r = 0; r < rows; r++) {
      var rowDiv = document.createElement('div');
      rowDiv.style.cssText = rowStyle;
      var rowCells = [];
      for (var c = 0; c < GRID_COLS; c++) {
        var span = document.createElement('span');
        span.textContent = ' ';
        span.style.cssText = spanStyle;
        rowDiv.appendChild(span);
        rowCells.push(span);
      }
      cells.push(rowCells);
      frag.appendChild(rowDiv);
    }
    gridContainer.appendChild(frag);
  }

  function recalcGrid() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    fontSize = Math.max(8, Math.floor(w / GRID_COLS));
    cellW = fontSize * 0.6; // monospace char width ≈ 0.6 × font size
    cellH = fontSize;
    gridRows = Math.floor(h / cellH);
    buildGrid(gridRows);
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
    try { overlay.requestPointerLock(); } catch (e) {}
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
  // Rendering — DOM span grid, no canvas required
  // -------------------------------------------------------------------------

  function render() {
    if (!cells.length) return;

    var halfRows = gridRows / 2;

    for (var col = 0; col < GRID_COLS; col++) {
      // Ray angle for this column
      var rayAngle = player.angle - FOV / 2 + (col / GRID_COLS) * FOV;
      var dist = castRay(player.x, player.y, rayAngle);
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
      var wallOpacity = (1.0 - t * 0.7).toFixed(2);

      for (var row = 0; row < gridRows; row++) {
        var span = cells[row][col];

        if (row < wallTop) {
          // Ceiling — sparse dots near the top
          var ceilDist = (halfRows - row) / halfRows;
          if (ceilDist < 0.3 && rand() < 0.02) {
            span.textContent = '.';
            span.style.opacity = '0.08';
          } else {
            span.textContent = ' ';
            span.style.opacity = '1';
          }
        } else if (row >= Math.max(0, wallTop) && row < Math.min(gridRows, wallBottom)) {
          // Wall
          if (wallChar !== ' ') {
            span.textContent = wallChar;
            span.style.opacity = wallOpacity;
          } else {
            span.textContent = ' ';
            span.style.opacity = '1';
          }
        } else {
          // Floor — dot density increases closer to the viewer
          var floorDist = (row - halfRows) / halfRows;
          if (floorDist > 0.1 && rand() < floorDist * 0.4) {
            span.textContent = '\u00B7';
            span.style.opacity = (0.2 * floorDist).toFixed(2);
          } else {
            span.textContent = ' ';
            span.style.opacity = '1';
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

  function gameLoop(timestamp) {
    animFrameId = requestAnimationFrame(gameLoop);

    // Sync lastTime on first tick using the rAF-provided DOMHighResTimeStamp
    // (avoids any dependency on performance.now() or Date.now())
    if (!lastTime) { lastTime = timestamp; return; }

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

    // Proximity — display room name when near a case-study entrance
    var nearRoom = null;
    var pd2 = PROXIMITY_DIST * PROXIMITY_DIST;
    for (var ei = 0; ei < ENTRANCES.length; ei++) {
      var ex = player.x - ENTRANCES[ei].x;
      var ey = player.y - ENTRANCES[ei].y;
      if (ex * ex + ey * ey < pd2) {
        nearRoom = ENTRANCES[ei].name;
        break;
      }
    }
    if (nearRoom) {
      hudRoom.textContent = nearRoom;
      hudRoom.style.display = 'block';
    } else {
      hudRoom.style.display = 'none';
    }
  }

  // -------------------------------------------------------------------------
  // Grid resize
  // -------------------------------------------------------------------------
  function resizeGrid() {
    recalcGrid();
  }

  // -------------------------------------------------------------------------
  // Start / Exit
  // -------------------------------------------------------------------------
  function startGame() {
    state = 'playing';
    title.style.display = 'none';
    hud.style.display = 'block';

    // Reset player to entry corridor, facing south toward the hub
    player.x = 20.5;
    player.y = 2.0;
    player.angle = Math.PI / 2;
    keys = {};

    recalcGrid();
    window.addEventListener('resize', resizeGrid);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousemove', onMouseMove);
    overlay.addEventListener('click', requestPointerLock);
    requestPointerLock();

    lastTime = 0; // gameLoop self-syncs on first tick from rAF timestamp
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
    hudRoom.style.display = 'none';
    window.removeEventListener('resize', resizeGrid);
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    document.removeEventListener('mousemove', onMouseMove);
    overlay.removeEventListener('click', requestPointerLock);
    try {
      if (document.pointerLockElement === overlay) document.exitPointerLock();
    } catch (e) {}
  }

  // Entry point
  window.initDoomMode = function () {
    overlay.style.display = 'block';
    state = 'title';
    title.style.display = 'block';
    hud.style.display = 'none';
    document.addEventListener('keydown', onKeyDown);
  };
})();
