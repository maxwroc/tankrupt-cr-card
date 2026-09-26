import { startDemo } from './main';

void startDemo().catch((error: unknown) => {
  const alert = document.getElementById('boot-error')!;
  alert.hidden = false;
  alert.textContent = `Demo could not start. Run npm run watch and open http://127.0.0.1:5000. ${String(error)}`;
});
