/**
 * MapState: the 3D galactic map.
 *
 * Shows the whole Milky Way, the player's jump range, plotted routes, region
 * information and the selected system's dossier. Jumping is executed here.
 */
import { GalaxyMapScene } from '../render/GalaxyMapScene.js';

export class MapState {
  constructor(game) {
    this.game = game;
    this.name = 'map';
    this.scene = null;
    this.selectedId = null;
    this.clickGuard = 0;
  }

  enter() {
    const game = this.game;
    if (!this.scene) {
      this.scene = new GalaxyMapScene(game.state);
      this.scene.build();
    } else {
      this.scene.updateRangeMesh();
      this.scene.updateRoute();
    }
    game.scene.add(this.scene.root);
    this.selectedId = game.state.location.systemId;
    this.scene.setSelected(this.selectedId);
    game.input.exitPointerLock();
    game.ui.showGalacticMap(this.scene, this);
    game.ui.hud.hide();
    game.bus.emit('map:opened', {});
  }

  exit() {
    this.game.scene.remove(this.scene.root);
    this.game.ui.hideGalacticMap();
    this.game.ui.hud.show();
  }

  /** Jump to the selected system if possible. */
  jump() {
    const game = this.game;
    const state = game.state;
    const targetId = this.selectedId;
    const check = state.ftl.canJump(state.location.systemId, targetId);
    if (!check.ok) {
      game.ui.notify(
        game.i18n.t('state.jumpUnavailable'),
        game.i18n.reason(check),
        'warn'
      );
      return false;
    }
    state.ftl.jump(targetId);
    state.stats.jumpsMade += 1;
    state.stats.distanceTravelledLy += check.distanceLy;
    state.addXp(100 + Math.round(check.distanceLy * 0.4));
    state.ftl.arrive(targetId);
    game.ui.hideGalacticMap();
    game.states.change('space');
    game.ui.notify(
      game.i18n.t('state.ftlComplete'),
      game.i18n.t('state.ftlCompleteBody', {
        d: check.distanceLy.toFixed(0), f: check.fuelCost,
      }),
      'ftl'
    );
    return true;
  }

  update(dt) {
    const game = this.game;
    this.scene.update(dt);

    // Click to select (ignore drags).
    this.clickGuard -= dt;
    if (game.input.justClicked(0) && this.clickGuard <= 0) {
      const rect = game.renderer.domElement.getBoundingClientRect();
      const pick = this.scene.pick(
        (game.input.lastClientX ?? rect.width / 2),
        (game.input.lastClientY ?? rect.height / 2),
        game.renderer.domElement
      );
      if (pick) {
        this.select(pick.id);
      }
    }
    if (game.input.justPressed('Escape') || game.input.justPressed('KeyM')) {
      game.ui.hideGalacticMap();
      game.states.change('space');
    }
    if (game.input.justPressed('KeyF')) {
      this.scene.focus(this.selectedId);
    }
    if (game.input.justPressed('KeyR')) {
      this.scene.resetView();
    }
  }

  select(id) {
    this.selectedId = id;
    this.scene.setSelected(id);
    this.game.ui.updateGalacticMapSelection(id);
  }
}
