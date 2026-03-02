(function () {
  'use strict';

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
  canvas.style.cssText = 'width:100%;height:100%;display:block;';
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

  // Canvas sizing
  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  // Game loop placeholder
  function gameLoop() {
    ctx.fillStyle = '#1a1a14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    animFrameId = requestAnimationFrame(gameLoop);
  }

  // Keydown handler
  function onKeyDown(e) {
    if (e.key === 'Escape') {
      exitDoom();
      return;
    }
    if (state === 'title') {
      // Start game
      state = 'playing';
      title.style.display = 'none';
      hud.style.display = 'block';
      resizeCanvas();
      window.addEventListener('resize', resizeCanvas);
      animFrameId = requestAnimationFrame(gameLoop);
    }
  }

  // Exit
  function exitDoom() {
    if (animFrameId !== null) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    overlay.style.display = 'none';
    state = 'idle';
    window.removeEventListener('resize', resizeCanvas);
    document.removeEventListener('keydown', onKeyDown);
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
