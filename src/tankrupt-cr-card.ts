import './custom-elements/tankrupt-cr-card';
import './custom-elements/tankrupt-card-editor';
import { CARD_TAG, VERSION } from './const';

declare global {
  interface Window {
    customCards?: { type: string; name: string; description: string; preview: boolean }[];
  }
}

window.customCards ??= [];
if (!window.customCards.some((card) => card.type === CARD_TAG)) {
  window.customCards.push({
    type: CARD_TAG,
    name: 'Tankrupt',
    description: 'Fuel and EV spending, powered by Custom Records.',
    preview: true,
  });
}
console.info(`Tankrupt ${VERSION}`);
