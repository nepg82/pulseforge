// Lightweight timer only; note timing remains on the Web Audio clock.
let timer = null;
self.onmessage = event => {
  if (event.data === "start") {
    if (timer !== null) clearInterval(timer);
    timer = setInterval(() => self.postMessage("tick"), 50);
  } else if (event.data === "stop") {
    if (timer !== null) clearInterval(timer);
    timer = null;
  }
};
