/**
 * Entry point. Boots the game and surfaces fatal errors on screen so a broken
 * build is obvious rather than a black canvas.
 */
import { Game } from './Game.js';

async function main() {
  try {
    const game = new Game();
    window.galaxyExplorer = game; // handy for debugging / QA
    await game.boot();
  } catch (err) {
    console.error(err);
    const loading = document.getElementById('loading');
    const status = document.getElementById('loading-status');
    if (loading && status) {
      loading.classList.remove('hidden');
      status.innerHTML = `<span style="color:#ff5c7a">FATAL: ${String(err?.stack ?? err).replace(/\n/g, '<br>')}</span>`;
    }
  }
}

main();
